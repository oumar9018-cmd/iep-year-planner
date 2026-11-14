/* IEP Year Planner — app data layer + page controllers.
 * Loads AFTER auth.js (needs window.IEPAuth) and, for deadline math,
 * planner-core.js + states-data.js (window.PlannerCore / window.IEP_STATES).
 *
 * Persistence rule: everything real lives in Supabase. localStorage
 * holds ONLY the auth session, so a refresh — or a different device —
 * shows exactly the same children, documents and notes.
 */
(function () {
  "use strict";

  var SUPABASE_URL = window.IEPAuth.SUPABASE_URL;
  var ANON_KEY = window.IEPAuth.ANON_KEY;

  var PLAN_LIMITS = {
    free:    { label: "Free",    children: 1, documents: 5 },
    monthly: { label: "Monthly", children: 5, documents: 200 },
    yearly:  { label: "Yearly",  children: 5, documents: 200 }
  };

  var session = null;
  var profile = null;

  // ---------- small helpers ---------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function todayISO() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function daysBetween(aISO, bISO) {
    var core = window.PlannerCore;
    if (!core) return 0;
    return Math.round((core.parseISO(bISO) - core.parseISO(aISO)) / 86400000);
  }
  function showMsg(text, kind) {
    var el = $("#app-msg");
    if (!el) return;
    el.hidden = false;
    el.className = "app-msg " + (kind || "info");
    el.textContent = text;
    if (kind !== "error") setTimeout(function () { el.hidden = true; }, 5000);
  }

  // ---------- REST -------------------------------------------------------
  function headers(extra) {
    var h = {
      "apikey": ANON_KEY,
      "Authorization": "Bearer " + (session ? session.access_token : ANON_KEY),
      "Content-Type": "application/json"
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function parseBody(r) {
    return r.text().then(function (t) {
      var body = null;
      try { body = t ? JSON.parse(t) : null; } catch (e) {}
      if (!r.ok) {
        var msg = (body && (body.message || body.msg || body.error)) || ("Request failed (" + r.status + ")");
        var err = new Error(msg);
        err.status = r.status;
        throw err;
      }
      return body;
    });
  }
  function api(path, options, retry) {
    var opts = options || {};
    // Never mutate `options`: its headers are the caller's extras, and a
    // retry must rebuild the full header set with the FRESH session token.
    var fetchOpts = { method: opts.method || "GET", headers: headers(opts.headers), body: opts.body };
    return fetch(SUPABASE_URL + "/rest/v1/" + path, fetchOpts).then(function (r) {
      if (r.status === 401 && !retry) {
        // Token may have just expired — refresh once and retry.
        return window.IEPAuth.ensureSession().then(function (fresh) {
          if (fresh) { session = fresh; return api(path, options, true); }
          throw new Error("Your session expired. Please sign in again.");
        });
      }
      return parseBody(r);
    });
  }
  function apiGet(table, query) { return api(table + "?" + query, { method: "GET" }); }
  function apiInsert(table, row) {
    return api(table, {
      method: "POST",
      headers: { "Prefer": "return=representation" },
      body: JSON.stringify(row)
    });
  }
  function apiPatch(table, query, fields) {
    return api(table + "?" + query, {
      method: "PATCH",
      headers: { "Prefer": "return=representation" },
      body: JSON.stringify(fields)
    });
  }
  function apiDelete(table, query) { return api(table + "?" + query, { method: "DELETE" }); }

  // ---------- Storage ------------------------------------------------------
  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }
  function storageUpload(path, file) {
    return fetch(SUPABASE_URL + "/storage/v1/object/documents/" + encodePath(path), {
      method: "POST",
      headers: {
        "apikey": ANON_KEY,
        "Authorization": "Bearer " + session.access_token,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false"
      },
      body: file
    }).then(function (r) { return parseBody(r); });
  }
  function storageDelete(path) {
    return fetch(SUPABASE_URL + "/storage/v1/object/documents", {
      method: "DELETE",
      headers: headers(),
      body: JSON.stringify({ prefixes: [path] })
    }).then(function (r) { return parseBody(r); });
  }
  function storageSignedUrl(path, expiresIn) {
    return fetch(SUPABASE_URL + "/storage/v1/object/sign/documents/" + encodePath(path), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ expiresIn: expiresIn || 3600 })
    }).then(function (r) { return parseBody(r); }).then(function (body) {
      if (!body || !body.signedURL) throw new Error("Could not create a download link.");
      return SUPABASE_URL + "/storage/v1" + body.signedURL;
    });
  }

  // ---------- profile + plan ----------------------------------------------
  function planKey() { return (profile && PLAN_LIMITS[profile.plan]) ? profile.plan : "free"; }
  function limits() { return PLAN_LIMITS[planKey()]; }

  function loadProfile() {
    return apiGet("profiles", "id=eq." + session.user.id + "&select=*").then(function (rows) {
      if (rows && rows.length) { profile = rows[0]; return profile; }
      // No row yet (the DB trigger normally creates one) — create it.
      var fresh = { id: session.user.id, display_name: "", state: "", plan: "free" };
      return apiInsert("profiles", fresh).then(function (created) {
        profile = (created && created[0]) || fresh;
        return profile;
      }).catch(function () { profile = fresh; return profile; });
    });
  }

  // ---------- deadlines -----------------------------------------------------
  function deadlinesForChild(child) {
    var core = window.PlannerCore;
    if (!core) return [];
    var s = (window.IEP_STATES || {})[child.state] || null;
    var rule = s
      ? { value: s.value, dayKind: s.dayKind, dayTypeLabel: s.dayTypeLabel, dual: s.dual, clockStart: s.clockStart, status: s.status,
          referralDays: s.referralDays || null, absenceExtension: !!s.absenceExtension }
      : { value: null, dayKind: null, dayTypeLabel: "", dual: null, clockStart: "consent", status: "unverified" };
    var transition = s ? { months: s.transitionMonths, label: s.transitionLabel } : null;
    var inputs = {
      startDate: child.eval_date || "",
      referralDate: child.referral_date || "",
      absentDays: child.absent_days || 0,
      lastAnnualReview: child.last_annual_review || "",
      lastEvaluation: child.last_evaluation || "",
      childDob: child.dob || ""
    };
    var verifiedOn = (s && s.verifiedOn) ? core.pretty(s.verifiedOn) : "";
    return core.computeDeadlines(rule, transition, inputs).map(function (d) {
      return {
        childId: child.id, childName: child.name,
        kind: d.kind, title: d.title, dueISO: d.dueISO, dueText: d.dueText,
        basis: d.basis, approx: d.approx, verifiedOn: verifiedOn,
        daysLeft: daysBetween(todayISO(), d.dueISO)
      };
    });
  }
  function allDeadlines(children) {
    var out = [];
    children.forEach(function (c) { out = out.concat(deadlinesForChild(c)); });
    out.sort(function (a, b) { return a.dueISO < b.dueISO ? -1 : 1; });
    return out;
  }
  function deadlineBadge(d) {
    if (d.daysLeft < 0) return '<span class="badge overdue">' + Math.abs(d.daysLeft) + ' days overdue</span>';
    if (d.daysLeft === 0) return '<span class="badge soon">Due today</span>';
    if (d.daysLeft <= 30) return '<span class="badge soon">In ' + d.daysLeft + ' days</span>';
    return '<span class="badge ok">In ' + d.daysLeft + ' days</span>';
  }

  // ---------- shell ---------------------------------------------------------
  function fillStateSelect(sel, value) {
    if (!sel) return;
    var data = window.IEP_STATES || {};
    var abbrs = Object.keys(data).sort(function (a, b) { return data[a].name < data[b].name ? -1 : 1; });
    sel.innerHTML = '<option value="">Select a state…</option>' + abbrs.map(function (a) {
      return '<option value="' + a + '">' + esc(data[a].name) + '</option>';
    }).join("");
    if (value) sel.value = value;
  }
  function fillChildSelect(sel, children, includeNone) {
    if (!sel) return;
    sel.innerHTML = (includeNone ? '<option value="">No specific child</option>' : "") +
      children.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join("");
  }
  function initShell(page) {
    $all("[data-user-email]").forEach(function (el) { el.textContent = session.user.email; });
    $all(".appnav a").forEach(function (a) {
      if (a.getAttribute("data-nav") === page) a.classList.add("active");
    });
    $all(".signout-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.IEPAuth.signOut().then(function () { window.location.href = window.IEPAuth.loginUrl(); });
      });
    });
    $all("select.state-select").forEach(function (sel) { fillStateSelect(sel, sel.getAttribute("data-value") || ""); });
  }

  // ---------- data loaders ---------------------------------------------------
  function loadChildren() {
    return apiGet("children", "user_id=eq." + session.user.id + "&select=*&order=created_at.asc");
  }
  function loadDocuments() {
    return apiGet("documents", "user_id=eq." + session.user.id + "&select=*&order=created_at.desc");
  }
  function loadMeetings() {
    return apiGet("meetings", "user_id=eq." + session.user.id + "&select=*&order=date.desc");
  }

  // ==========================================================================
  // PAGE: dashboard
  // ==========================================================================
  function initDashboard() {
    Promise.all([loadChildren(), loadMeetings()]).then(function (res) {
      var children = res[0] || [], meetings = res[1] || [];
      var name = (profile && profile.display_name) || "";
      var greet = $("#dash-greeting");
      if (greet) greet.textContent = name ? "Welcome back, " + name : "Welcome back";

      var cbox = $("#dash-children");
      if (!children.length) {
        cbox.innerHTML = '<div class="empty"><p>No children added yet.</p>' +
          '<a class="btn" href="children.html">Add your child</a></div>';
      } else {
        cbox.innerHTML = children.map(function (c) {
          var next = deadlinesForChild(c)[0];
          var stateName = (window.IEP_STATES && window.IEP_STATES[c.state]) ? window.IEP_STATES[c.state].name : c.state;
          return '<article class="card child-card"><h3>' + esc(c.name) + '</h3>' +
            '<p class="meta">' + esc(stateName || "State not set") + '</p>' +
            (next
              ? '<p class="next">Next: <strong>' + esc(next.title) + '</strong> — ' + esc(next.dueText) + '</p>' + deadlineBadge(next)
              : '<p class="meta">Add dates on the Children page to see deadlines.</p>') +
            '</article>';
        }).join("");
      }

      var deadlines = allDeadlines(children);
      var dbox = $("#dash-deadlines");
      if (!deadlines.length) {
        dbox.innerHTML = '<p class="meta">No deadlines yet. Add a child with their key dates and deadlines will appear here automatically.</p>';
      } else {
        dbox.innerHTML = deadlines.slice(0, 6).map(function (d) {
          return '<div class="deadline-row"><div class="deadline-main"><strong>' + esc(d.title) + '</strong>' +
            '<span class="meta"> · ' + esc(d.childName) + '</span><div class="meta">' + esc(d.dueText) +
            (d.approx ? ' <span title="Counted Monday–Friday without holidays or school breaks">(approx.)</span>' : '') +
            (d.verifiedOn ? ' · Rules last verified ' + esc(d.verifiedOn) : '') +
            '</div></div>' + deadlineBadge(d) + '</div>';
        }).join("");
      }

      var today = todayISO();
      var upcoming = meetings.filter(function (m) { return m.date >= today; })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 3);
      var mbox = $("#dash-meetings");
      if (mbox) {
        mbox.innerHTML = upcoming.length
          ? upcoming.map(function (m) {
              return '<div class="deadline-row"><div class="deadline-main"><strong>' + esc(m.title) + '</strong>' +
                '<div class="meta">' + esc(window.PlannerCore ? window.PlannerCore.pretty(m.date) : m.date) + '</div></div></div>';
            }).join("")
          : '<p class="meta">No upcoming meetings logged.</p>';
      }
    }).catch(function (err) { showMsg(err.message, "error"); });
  }

  // ==========================================================================
  // PAGE: children
  // ==========================================================================
  function initChildren() {
    var form = $("#child-form");
    var listEl = $("#children-list");
    var note = $("#limit-note");
    var childrenCache = [];

    // Referral-date field appears only for states whose evaluation clock
    // needs it (CT/NC/VA referral clocks, MD's second clock); the absence
    // field only for Texas (19 TAC §89.1011). Driven by states-data flags.
    function syncConditionalFields() {
      var s = (window.IEP_STATES || {})[$("#c-state").value] || null;
      var refRow = $("#c-referral-row"), absRow = $("#c-absent-row"), refHint = $("#c-referral-hint");
      if (refRow) refRow.hidden = !(s && s.needsReferral);
      if (absRow) absRow.hidden = !(s && s.absenceExtension);
      if (refHint && s) {
        refHint.textContent = s.clockStart === "dual"
          ? "Your state runs two clocks — this referral date drives the second one (90 days). The earlier of the two dates applies."
          : "In your state, the evaluation clock starts on the date the school receives the referral — not the consent date.";
      }
    }
    $("#c-state").addEventListener("change", syncConditionalFields);

    function render() {
      var lim = limits();
      if (note) {
        note.innerHTML = childrenCache.length >= lim.children
          ? 'Your <strong>' + lim.label + '</strong> plan covers ' + lim.children + (lim.children === 1 ? ' child' : ' children') +
            ' — you have reached the limit. <a href="plans.html">See plans</a> to track more children.'
          : 'Your <strong>' + lim.label + '</strong> plan covers ' + lim.children + (lim.children === 1 ? ' child' : ' children') +
            ' (' + childrenCache.length + ' added).';
      }
      var submit = $("#child-submit");
      if (submit && !$("#c-id").value) submit.disabled = childrenCache.length >= lim.children;
      if (!childrenCache.length) {
        listEl.innerHTML = '<div class="empty"><p>No children yet. Add your first child with the form.</p></div>';
        return;
      }
      listEl.innerHTML = childrenCache.map(function (c) {
        var next = deadlinesForChild(c)[0];
        var stateName = (window.IEP_STATES && window.IEP_STATES[c.state]) ? window.IEP_STATES[c.state].name : c.state;
        return '<article class="card child-card"><h3>' + esc(c.name) + '</h3>' +
          '<p class="meta">' + esc(stateName || "State not set") +
          (c.dob ? ' · Born ' + esc(window.PlannerCore.pretty(c.dob)) : '') + '</p>' +
          (next ? '<p class="next">Next: <strong>' + esc(next.title) + '</strong> — ' + esc(next.dueText) + '</p>' + deadlineBadge(next) : '') +
          '<div class="card-actions"><button class="btn small" data-edit="' + c.id + '">Edit</button>' +
          '<button class="btn small danger" data-del="' + c.id + '">Delete</button></div></article>';
      }).join("");
      $all("[data-edit]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var c = childrenCache.filter(function (x) { return x.id === btn.getAttribute("data-edit"); })[0];
          if (!c) return;
          $("#c-id").value = c.id;
          $("#c-name").value = c.name || "";
          $("#c-dob").value = c.dob || "";
          fillStateSelect($("#c-state"), c.state || "");
          syncConditionalFields();
          $("#c-referral").value = c.referral_date || "";
          $("#c-absent").value = (c.absent_days != null ? c.absent_days : "");
          $("#c-eval").value = c.eval_date || "";
          $("#c-annual").value = c.last_annual_review || "";
          $("#c-eval3").value = c.last_evaluation || "";
          $("#child-submit").textContent = "Save changes";
          $("#child-submit").disabled = false;
          $("#child-cancel").hidden = false;
          form.scrollIntoView({ behavior: "smooth" });
        });
      });
      $all("[data-del]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-del");
          var c = childrenCache.filter(function (x) { return x.id === id; })[0];
          if (!window.confirm("Delete " + (c ? c.name : "this child") + "? Their documents stay saved but will no longer be linked to a child.")) return;
          apiDelete("children", "id=eq." + id).then(function () {
            showMsg("Child deleted.");
            refresh();
          }).catch(function (err) { showMsg(err.message, "error"); });
        });
      });
    }
    function refresh() {
      loadChildren().then(function (rows) { childrenCache = rows || []; render(); })
        .catch(function (err) { showMsg(err.message, "error"); });
    }
    $("#child-cancel").addEventListener("click", function () {
      form.reset();
      $("#c-id").value = "";
      $("#child-submit").textContent = "Add child";
      $("#child-cancel").hidden = true;
      syncConditionalFields();
      render();
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var id = $("#c-id").value;
      var row = {
        user_id: session.user.id,
        name: $("#c-name").value.trim(),
        dob: $("#c-dob").value || null,
        state: $("#c-state").value || "",
        eval_date: $("#c-eval").value || null,
        last_annual_review: $("#c-annual").value || null,
        last_evaluation: $("#c-eval3").value || null
      };
      // New columns (see supabase/iep-accuracy-round1.sql — must be applied
      // before this ships): only sent for states that use them, so saves for
      // every other state keep working even before the migration runs.
      var sRow = (window.IEP_STATES || {})[row.state] || null;
      if (sRow && sRow.needsReferral) row.referral_date = $("#c-referral").value || null;
      if (sRow && sRow.absenceExtension) {
        var av = parseInt($("#c-absent").value, 10);
        row.absent_days = (av > 0) ? av : null;
      }
      if (!row.name) { showMsg("Please enter your child's name.", "error"); return; }
      if (!id && childrenCache.length >= limits().children) {
        showMsg("Your " + limits().label + " plan covers " + limits().children + " child(ren). See Plans to track more.", "error");
        return;
      }
      var patch = { name: row.name, dob: row.dob, state: row.state, eval_date: row.eval_date, last_annual_review: row.last_annual_review, last_evaluation: row.last_evaluation };
      if ("referral_date" in row) patch.referral_date = row.referral_date;
      if ("absent_days" in row) patch.absent_days = row.absent_days;
      var op = id
        ? apiPatch("children", "id=eq." + id, patch)
        : apiInsert("children", row);
      op.then(function () {
        showMsg(id ? "Changes saved." : "Child added.");
        form.reset();
        $("#c-id").value = "";
        $("#child-submit").textContent = "Add child";
        $("#child-cancel").hidden = true;
        syncConditionalFields();
        refresh();
      }).catch(function (err) { showMsg(err.message, "error"); });
    });
    syncConditionalFields();
    refresh();
  }

  // ==========================================================================
  // PAGE: documents
  // ==========================================================================
  function initDocuments() {
    var form = $("#doc-form");
    var listEl = $("#doc-list");
    var countEl = $("#doc-count");
    var docsCache = [];
    var childrenCache = [];

    function childName(id) {
      var c = childrenCache.filter(function (x) { return x.id === id; })[0];
      return c ? c.name : "";
    }
    function render() {
      var lim = limits();
      if (countEl) {
        countEl.innerHTML = docsCache.length + ' of ' + lim.documents + ' files on your <strong>' + lim.label + '</strong> plan.' +
          (docsCache.length >= lim.documents ? ' Limit reached — <a href="plans.html">see plans</a> for more space.' : '');
      }
      $("#doc-submit").disabled = docsCache.length >= lim.documents;
      if (!docsCache.length) {
        listEl.innerHTML = '<div class="empty"><p>No documents yet. Upload IEPs, evaluations and letters to keep them in one private place.</p></div>';
        return;
      }
      listEl.innerHTML = docsCache.map(function (d) {
        return '<div class="doc-row"><div class="doc-main"><strong>' + esc(d.title) + '</strong>' +
          '<div class="meta">' + esc(window.PlannerCore.pretty(d.created_at.slice(0, 10))) +
          (d.child_id ? ' · ' + esc(childName(d.child_id)) : '') + '</div></div>' +
          '<div class="card-actions"><button class="btn small" data-dl="' + d.id + '">Download</button>' +
          '<button class="btn small danger" data-del="' + d.id + '">Delete</button></div></div>';
      }).join("");
      $all("[data-dl]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var d = docsCache.filter(function (x) { return x.id === btn.getAttribute("data-dl"); })[0];
          if (!d) return;
          btn.disabled = true;
          storageSignedUrl(d.storage_path, 3600).then(function (url) {
            btn.disabled = false;
            window.open(url, "_blank");
          }).catch(function (err) { btn.disabled = false; showMsg(err.message, "error"); });
        });
      });
      $all("[data-del]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var d = docsCache.filter(function (x) { return x.id === btn.getAttribute("data-del"); })[0];
          if (!d) return;
          if (!window.confirm("Delete \"" + d.title + "\" permanently?")) return;
          storageDelete(d.storage_path)
            .then(function () { return apiDelete("documents", "id=eq." + d.id); })
            .then(function () { showMsg("Document deleted."); refresh(); })
            .catch(function (err) { showMsg(err.message, "error"); });
        });
      });
    }
    function refresh() {
      Promise.all([loadDocuments(), loadChildren()]).then(function (res) {
        docsCache = res[0] || [];
        childrenCache = res[1] || [];
        fillChildSelect($("#doc-child"), childrenCache, true);
        render();
      }).catch(function (err) { showMsg(err.message, "error"); });
    }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fileInput = $("#doc-file");
      var file = fileInput.files && fileInput.files[0];
      if (!file) { showMsg("Choose a file to upload.", "error"); return; }
      if (docsCache.length >= limits().documents) {
        showMsg("Your " + limits().label + " plan holds " + limits().documents + " files. See Plans for more space.", "error");
        return;
      }
      if (file.size > 10 * 1024 * 1024) { showMsg("That file is over 10 MB. Please upload a smaller file.", "error"); return; }
      var safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "document";
      var path = session.user.id + "/" + Date.now() + "-" + safe;
      var childId = $("#doc-child").value || null;
      var title = $("#doc-title").value.trim() || file.name;
      var submit = $("#doc-submit");
      submit.disabled = true;
      submit.textContent = "Uploading…";
      storageUpload(path, file)
        .then(function () {
          return apiInsert("documents", { user_id: session.user.id, child_id: childId, title: title, storage_path: path });
        })
        .then(function () {
          showMsg("Document saved.");
          form.reset();
          refresh();
        })
        .catch(function (err) {
          // Best effort: don't leave an orphaned file with no record.
          storageDelete(path).catch(function () {});
          showMsg(err.message, "error");
        })
        .then(function () { submit.disabled = false; submit.textContent = "Upload document"; });
    });
    refresh();
  }

  // ==========================================================================
  // PAGE: notes (meetings log)
  // ==========================================================================
  function initNotes() {
    var form = $("#note-form");
    var listEl = $("#note-list");
    var notesCache = [];
    var childrenCache = [];

    function childName(id) {
      var c = childrenCache.filter(function (x) { return x.id === id; })[0];
      return c ? c.name : "";
    }
    function render() {
      if (!notesCache.length) {
        listEl.innerHTML = '<div class="empty"><p>No meetings logged yet. Add IEP meetings, calls and school emails here so nothing is forgotten.</p></div>';
        return;
      }
      listEl.innerHTML = notesCache.map(function (m) {
        return '<article class="card note-card"><div class="deadline-row"><div class="deadline-main">' +
          '<strong>' + esc(m.title) + '</strong><div class="meta">' +
          esc(window.PlannerCore.pretty(m.date)) + (m.child_id ? ' · ' + esc(childName(m.child_id)) : '') +
          '</div></div><button class="btn small danger" data-del="' + m.id + '">Delete</button></div>' +
          (m.notes ? '<p class="note-body">' + esc(m.notes) + '</p>' : '') + '</article>';
      }).join("");
      $all("[data-del]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (!window.confirm("Delete this log entry?")) return;
          apiDelete("meetings", "id=eq." + btn.getAttribute("data-del"))
            .then(function () { showMsg("Entry deleted."); refresh(); })
            .catch(function (err) { showMsg(err.message, "error"); });
        });
      });
    }
    function refresh() {
      Promise.all([loadMeetings(), loadChildren()]).then(function (res) {
        notesCache = res[0] || [];
        childrenCache = res[1] || [];
        fillChildSelect($("#n-child"), childrenCache, true);
        render();
      }).catch(function (err) { showMsg(err.message, "error"); });
    }
    $("#n-date").value = todayISO();
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var row = {
        user_id: session.user.id,
        child_id: $("#n-child").value || null,
        date: $("#n-date").value || todayISO(),
        title: $("#n-title").value.trim(),
        notes: $("#n-notes").value.trim()
      };
      if (!row.title) { showMsg("Give the entry a title (for example: Annual review meeting).", "error"); return; }
      apiInsert("meetings", row).then(function () {
        showMsg("Entry saved.");
        form.reset();
        $("#n-date").value = todayISO();
        refresh();
      }).catch(function (err) { showMsg(err.message, "error"); });
    });
    refresh();
  }

  // ==========================================================================
  // PAGE: settings
  // ==========================================================================
  function initSettings() {
    $("#set-email").textContent = session.user.email;
    $("#set-name").value = profile.display_name || "";
    fillStateSelect($("#set-state"), profile.state || "");
    $("#set-plan").innerHTML = '<strong>' + limits().label + '</strong> plan · ' +
      limits().children + (limits().children === 1 ? ' child' : ' children') + ', ' +
      limits().documents + ' documents. <a href="plans.html">Compare plans</a>';
    $("#set-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      apiPatch("profiles", "id=eq." + session.user.id, {
        display_name: $("#set-name").value.trim(),
        state: $("#set-state").value || ""
      }).then(function (rows) {
        if (rows && rows[0]) profile = rows[0];
        showMsg("Settings saved.");
      }).catch(function (err) { showMsg(err.message, "error"); });
    });
  }

  // ==========================================================================
  // PAGE: plans
  // ==========================================================================
  function initPlans() {
    var current = planKey();
    $all("[data-plan-card]").forEach(function (card) {
      if (card.getAttribute("data-plan-card") === current) {
        card.classList.add("current");
        var badge = document.createElement("span");
        badge.className = "badge ok current-badge";
        badge.textContent = "Your plan";
        card.appendChild(badge);
      }
    });
    var note = $("#pay-note");
    $all(".paid-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (note) {
          note.hidden = false;
          note.textContent = "Card payments open soon — your free plan keeps working. We will email you the moment paid plans launch; nothing is charged today.";
        }
      });
    });
  }

  // ---------- boot ---------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    if (!page) return;
    window.IEPAuth.requireAuth()
      .then(function (s) {
        session = s;
        return loadProfile();
      })
      .then(function () {
        initShell(page);
        ({ dashboard: initDashboard, children: initChildren, documents: initDocuments,
           notes: initNotes, settings: initSettings, plans: initPlans })[page]();
      })
      .catch(function (err) {
        if (err && err.message !== "not-signed-in") showMsg(err.message || "Something went wrong loading your account.", "error");
      });
  });

  window.IEPApp = {
    PLAN_LIMITS: PLAN_LIMITS,
    deadlinesForChild: deadlinesForChild,
    getProfile: function () { return profile; },
    getSession: function () { return session; }
  };
})();
