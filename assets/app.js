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
    free:    { label: "Free",    children: 1, documents: 5,   services: 1,  serviceHistory: "month" },
    monthly: { label: "Monthly", children: 5, documents: 200, services: 10, serviceHistory: "all" },
    yearly:  { label: "Yearly",  children: 5, documents: 200, services: 10, serviceHistory: "all" }
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

  // ---------- "What happens next" guides --------------------------------
  // Content + next-deadline logic live in the shared module
  // (assets/what-next.js, canonical in tools/what-next.js). Styles for
  // the .wn-* classes are page-local (dashboard.html / children.html) —
  // app.css is not touched. Plan gating (the founder's doctrine): on
  // Free, the guide is FULL only for the child's next deadline (the
  // module's pickNextDeadline — a past-due deadline counts as next);
  // every other deadline shows the meaning + first step, with the
  // remaining steps behind a calm plans note. Paid shows all in full.
  function whatNextFull(childDeadlines, d) {
    if (planKey() !== "free") return true;
    var WN = window.IEPWhatNext;
    return WN ? WN.isNextDeadline(childDeadlines, d, todayISO()) : false;
  }
  function whatNextHtml(d, full) {
    var WN = window.IEPWhatNext;
    if (!WN) return "";
    var b = WN.blockFor(d.kind);
    if (!b) return "";
    var inner = '<p class="meta">' + esc(b.meaning) + "</p>";
    if (full) {
      inner += '<p class="wn-head">If this date passes</p>' +
        '<p class="meta">' + esc(b.ifPasses) + "</p>" +
        '<p class="wn-head">Steps you can take</p>' +
        '<ol class="wn-steps">' +
        b.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
        "</ol>";
    } else {
      inner += '<p class="wn-head">First step you can take</p>' +
        '<p class="meta">' + esc(b.steps[0]) + "</p>" +
        '<div class="limit-note">The full step-by-step guide for every deadline is part of paid plans — ' +
        "your " + limits().label + " plan shows it in full for the next deadline only. " +
        '<a href="plans.html">See plans</a></div>';
    }
    inner += '<p class="meta wn-cite">' + esc(b.cite) + "</p>" +
      '<p class="meta">' + esc(WN.DISCLAIMER) + "</p>";
    return '<div class="wn"><button class="btn small wn-toggle" type="button" aria-expanded="false">What happens next</button>' +
      '<div class="wn-panel" hidden>' + inner + "</div></div>";
  }
  function wireWhatNext(root) {
    $all(".wn-toggle", root || document).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var wrap = btn.parentElement;
        var panel = wrap ? wrap.querySelector(".wn-panel") : null;
        if (!panel) return;
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.textContent = open ? "Hide" : "What happens next";
      });
    });
  }

  // ---------- service-minutes math (pure — unit-tested via IEPApp) ------
  // Weeks run Monday–Sunday. A month's promised minutes are the weekly
  // promise prorated by the days in that month (perWeek × days ÷ 7) —
  // the explainable figure a "minutes per week" line in an IEP implies
  // for a whole month. Gaps are framed as "not yet logged": the log is
  // the parent's own record, never a verdict on the school.
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  function monthLabel(key) { return MONTH_NAMES[+key.slice(5, 7) - 1] + " " + key.slice(0, 4); }
  function monthKeyOf(iso) { return iso.slice(0, 7); }
  function shiftMonthKey(key, delta) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + delta;
    var d = new Date(Date.UTC(y, m, 1));
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1);
  }
  function monthRange(key) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7);
    var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return { key: key, start: key + "-01", end: key + "-" + p(days), days: days, label: monthLabel(key) };
  }
  function weekStartISO(iso) {
    var core = window.PlannerCore;
    var dow = core.parseISO(iso).getUTCDay(); // 0 = Sunday
    return core.addCalendarDays(iso, -((dow + 6) % 7)); // back to Monday
  }
  function sumLogsIn(logs, fromISO, toISO) {
    var delivered = 0, missed = 0;
    (logs || []).forEach(function (l) {
      if (l.date >= fromISO && l.date <= toISO) {
        delivered += (l.minutes_delivered || 0);
        if (l.missed) missed++;
      }
    });
    return { delivered: delivered, missed: missed };
  }
  // Summary for one service: the week containing `today`, plus the month
  // named by `viewKey` ("YYYY-MM"; defaults to today's month).
  function serviceSummary(service, logs, today, viewKey) {
    var perWeek = service.minutes_per_week || 0;
    var ws = weekStartISO(today);
    var wk = sumLogsIn(logs, ws, window.PlannerCore.addCalendarDays(ws, 6));
    var mr = monthRange(viewKey || monthKeyOf(today));
    var mPromised = Math.round(perWeek * mr.days / 7);
    var mo = sumLogsIn(logs, mr.start, mr.end);
    return {
      week: {
        start: ws, end: window.PlannerCore.addCalendarDays(ws, 6),
        promised: perWeek, delivered: wk.delivered, missed: wk.missed,
        gap: Math.max(0, perWeek - wk.delivered)
      },
      month: {
        key: mr.key, label: mr.label, start: mr.start, end: mr.end,
        promised: mPromised, delivered: mo.delivered, missed: mo.missed,
        gap: Math.max(0, mPromised - mo.delivered)
      }
    };
  }
  // Dashboard strip totals: every service's promise for the current week.
  function servicesWeekTotals(services, logs, today) {
    var ws = weekStartISO(today);
    var wk = sumLogsIn(logs, ws, window.PlannerCore.addCalendarDays(ws, 6));
    var promised = 0;
    (services || []).forEach(function (s) { promised += (s.minutes_per_week || 0); });
    return { promised: promised, delivered: wk.delivered, missed: wk.missed, gap: Math.max(0, promised - wk.delivered) };
  }

  // ---------- meeting-prep pack assembly (pure — unit-tested via IEPApp) --
  // The US school year starts September 1: before September, the school
  // year that is running began last September.
  function schoolYearStartISO(iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    return (m >= 9 ? y : y - 1) + "-09-01";
  }
  // School-year-to-date totals for one service, on the same proration
  // convention as the monthly figure (perWeek × days ÷ 7, rounded) —
  // here the days from September 1 through today, inclusive.
  function serviceYearSummary(service, logs, today) {
    var perWeek = service.minutes_per_week || 0;
    var start = schoolYearStartISO(today);
    var days = daysBetween(start, today) + 1;
    var promised = Math.round(perWeek * days / 7);
    var t = sumLogsIn(logs, start, today);
    return {
      start: start, end: today, days: days,
      promised: promised, delivered: t.delivered, missed: t.missed,
      gap: Math.max(0, promised - t.delivered)
    };
  }
  // Assemble one child's meeting-prep pack from already-loaded account
  // rows. Pure: no DOM, no network.
  // data: { documents, meetings, services, logs, questions } — the full
  // account lists; this filters to the child. Documents, notes and
  // services not linked to any child are included (a parent may not
  // have linked them, and the pack is where everything for the meeting
  // must show up); rows linked to a DIFFERENT child never appear.
  // Questions belong to one child only, so they filter strictly.
  // Plan scope follows the services history rule (serviceHistory):
  // free → each service carries week + current-month figures (year:
  // null) and notes are the latest 3; paid → a school-year summary is
  // added per service and the notes history is complete.
  function buildMeetingPack(child, data, today, plan) {
    var lim = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    var full = lim.serviceHistory === "all";
    data = data || {};
    function own(rows) {
      return (rows || []).filter(function (r) { return !r.child_id || r.child_id === child.id; });
    }
    var services = own(data.services).map(function (s) {
      var logs = (data.logs || []).filter(function (l) { return l.service_id === s.id; });
      return {
        id: s.id, name: s.name, minutesPerWeek: s.minutes_per_week || 0,
        summary: serviceSummary(s, logs, today, monthKeyOf(today)),
        year: full ? serviceYearSummary(s, logs, today) : null
      };
    });
    var notesAll = own(data.meetings);
    var stateName = (window.IEP_STATES && window.IEP_STATES[child.state])
      ? window.IEP_STATES[child.state].name : (child.state || "");
    return {
      childId: child.id, childName: child.name,
      state: child.state || "", stateName: stateName,
      generatedOn: today, fullScope: full,
      deadlines: deadlinesForChild(child),
      services: services,
      documents: own(data.documents),
      notes: full ? notesAll : notesAll.slice(0, 3),
      notesTotal: notesAll.length,
      questions: (data.questions || []).filter(function (q) { return q.child_id === child.id; })
    };
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
  function loadServices() {
    return apiGet("services", "user_id=eq." + session.user.id + "&select=*&order=created_at.asc");
  }
  function loadServiceLogs() {
    return apiGet("service_logs", "user_id=eq." + session.user.id + "&select=*&order=date.desc,created_at.desc");
  }
  function loadPrepQuestions() {
    return apiGet("prep_questions", "user_id=eq." + session.user.id + "&select=*&order=created_at.asc");
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
              ? '<p class="next">Next: <strong>' + esc(next.title) + '</strong> — ' + esc(next.dueText) + '</p>' + deadlineBadge(next) +
                // The card's deadline IS the child's next — full guide on every plan.
                whatNextHtml(next, true)
              : '<p class="meta">Add dates on the Children page to see deadlines.</p>') +
            '</article>';
        }).join("");
        wireWhatNext(cbox);
      }

      var deadlines = allDeadlines(children);
      var dbox = $("#dash-deadlines");
      if (!deadlines.length) {
        dbox.innerHTML = '<p class="meta">No deadlines yet. Add a child with their key dates and deadlines will appear here automatically.</p>';
      } else {
        // Per-child lists for the what-next gating (which of this
        // child's deadlines is their next one).
        var dlByChild = {};
        children.forEach(function (c) { dlByChild[c.id] = deadlinesForChild(c); });
        dbox.innerHTML = deadlines.slice(0, 6).map(function (d) {
          return '<div class="deadline-row"><div class="deadline-main"><strong>' + esc(d.title) + '</strong>' +
            '<div class="meta">' + esc(d.childName) + ' · ' + esc(d.dueText) +
            (d.approx ? ' <span title="Counted Monday–Friday without holidays or school breaks">(approx.)</span>' : '') +
            (d.verifiedOn ? ' · Rules last verified ' + esc(d.verifiedOn) : '') +
            '</div>' + whatNextHtml(d, whatNextFull(dlByChild[d.childId] || [], d)) + '</div>' + deadlineBadge(d) + '</div>';
        }).join("");
        wireWhatNext(dbox);
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

      // Services strip loads on its own chain: if the services tables
      // are not in place yet (iep-services.sql not run), the rest of the
      // dashboard must still render.
      var sbox = $("#dash-services");
      if (sbox) {
        Promise.all([loadServices(), loadServiceLogs()]).then(function (sres) {
          var services = sres[0] || [], serviceLogs = sres[1] || [];
          if (!services.length) {
            sbox.innerHTML = '<p class="meta">No services tracked yet. Log the minutes the IEP promises — speech, OT, and more — as they happen.</p>' +
              '<a class="btn small" href="services.html">Add a service</a>';
            return;
          }
          var tot = servicesWeekTotals(services, serviceLogs, todayISO());
          sbox.innerHTML = '<div class="deadline-row"><div class="deadline-main">' +
            '<strong>Promised ' + tot.promised + ' min · delivered ' + tot.delivered + ' min</strong>' +
            '<div class="meta">' + (tot.gap > 0
              ? tot.gap + ' min not yet logged this week'
              : 'Promised minutes covered this week') +
            ' · across ' + services.length + (services.length === 1 ? ' service' : ' services') + '</div></div>' +
            '<a class="btn small" href="services.html">Services</a></div>';
        }).catch(function () {
          sbox.innerHTML = '<p class="meta">Service minutes could not be loaded just now.</p>';
        });
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
          (next ? '<p class="next">Next: <strong>' + esc(next.title) + '</strong> — ' + esc(next.dueText) + '</p>' + deadlineBadge(next) +
            // The card's deadline IS the child's next — full guide on every plan.
            whatNextHtml(next, true) : '') +
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
      wireWhatNext(listEl);
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
  // PAGE: services (service-minutes log)
  // ==========================================================================
  function initServices() {
    var form = $("#svc-form");
    var listEl = $("#svc-list");
    var pagerEl = $("#svc-pager");
    var note = $("#svc-limit-note");
    var servicesCache = [], logsCache = [], childrenCache = [];
    var viewKey = monthKeyOf(todayISO()); // month shown in the entries lists
    var lastLogDate = todayISO();          // repeat logging stays on the day in use

    function historyLocked() { return limits().serviceHistory !== "all"; }
    function logsFor(serviceId) {
      return logsCache.filter(function (l) { return l.service_id === serviceId; });
    }
    function childName(id) {
      var c = childrenCache.filter(function (x) { return x.id === id; })[0];
      return c ? c.name : "";
    }
    function prettyDate(iso) { return window.PlannerCore ? window.PlannerCore.pretty(iso) : iso; }

    function renderPager() {
      var cur = monthKeyOf(todayISO());
      if (historyLocked()) {
        pagerEl.innerHTML = '<p class="meta">Showing <strong>' + monthLabel(cur) + '</strong> — your ' +
          limits().label + ' plan shows the current month. <a href="plans.html">See plans</a> for the full history.</p>';
        return;
      }
      pagerEl.innerHTML = '<div class="card-actions">' +
        '<button class="btn small" type="button" data-pager="-1">‹ Earlier</button>' +
        '<strong>' + monthLabel(viewKey) + '</strong>' +
        '<button class="btn small" type="button" data-pager="1"' + (viewKey >= cur ? " disabled" : "") + '>Later ›</button></div>';
      $all("[data-pager]", pagerEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var next = shiftMonthKey(viewKey, +btn.getAttribute("data-pager"));
          if (next > cur) next = cur;
          viewKey = next;
          render();
        });
      });
    }

    function render() {
      var lim = limits();
      var editing = !!$("#svc-id").value;
      if (!childrenCache.length) {
        note.innerHTML = 'Services are tracked per child — <a href="children.html">add your child</a> first, then add the services in their IEP.';
      } else if (servicesCache.length >= lim.services && !editing) {
        note.innerHTML = 'Your <strong>' + lim.label + '</strong> plan covers ' + lim.services +
          (lim.services === 1 ? ' service' : ' services') + ' — you have reached the limit. <a href="plans.html">See plans</a> to track more.';
      } else {
        note.innerHTML = 'Your <strong>' + lim.label + '</strong> plan covers ' + lim.services +
          (lim.services === 1 ? ' service' : ' services') + ' (' + servicesCache.length + ' added).';
      }
      $("#svc-submit").disabled = !childrenCache.length || (!editing && servicesCache.length >= lim.services);

      if (!servicesCache.length) {
        listEl.innerHTML = '<div class="empty"><p>No services yet. Add the first one with the form above — speech therapy, occupational therapy, counselling, and anything else the IEP promises.</p></div>';
        return;
      }
      var mr = monthRange(viewKey);
      var curStart = monthRange(monthKeyOf(todayISO())).start;
      listEl.innerHTML = servicesCache.map(function (s) {
        var logs = logsFor(s.id);
        var sum = serviceSummary(s, logs, todayISO(), viewKey);
        var entries = logs.filter(function (l) { return l.date >= mr.start && l.date <= mr.end; });
        var older = historyLocked()
          ? logs.filter(function (l) { return l.date < curStart; }).length : 0;
        var html = '<article class="card"><h3>' + esc(s.name) + '</h3>' +
          '<p class="meta">' + (s.child_id ? esc(childName(s.child_id)) + ' · ' : '') +
          'Promised ' + s.minutes_per_week + ' min/week</p>' +
          '<p class="meta">This week (Mon–Sun): logged <strong>' + sum.week.delivered + ' min</strong> of ' +
          sum.week.promised + ' min · ' + (sum.week.gap > 0 ? sum.week.gap + ' min not yet logged' : 'promised minutes covered') +
          (sum.week.missed ? ' · ' + sum.week.missed + (sum.week.missed === 1 ? ' session' : ' sessions') + ' marked missed' : '') + '</p>' +
          '<p class="meta">' + sum.month.label + ': logged <strong>' + sum.month.delivered + ' min</strong> of about ' +
          sum.month.promised + ' min · ' + (sum.month.gap > 0 ? sum.month.gap + ' min not yet logged' : 'promised minutes covered') +
          (sum.month.missed ? ' · ' + sum.month.missed + (sum.month.missed === 1 ? ' session' : ' sessions') + ' marked missed' : '') + '</p>' +
          '<form data-logform="' + s.id + '">' +
          '<label>Date <input type="date" class="lg-date" value="' + lastLogDate + '" required></label>' +
          '<label>Minutes delivered <input type="number" class="lg-minutes" min="1" max="1440" step="1" inputmode="numeric" placeholder="30"></label>' +
          '<label><input type="checkbox" class="lg-missed"> Missed — no session</label>' +
          '<label>Note (optional) <input type="text" class="lg-note" maxlength="200" placeholder="Optional note"></label>' +
          '<button class="btn small" type="submit">Log minutes</button></form>' +
          '<div>' + (entries.length ? entries.map(function (l) {
            return '<div class="doc-row"><div class="doc-main"><strong>' + esc(prettyDate(l.date)) + '</strong>' +
              (l.missed ? ' <span class="badge soon">Missed</span>' : '') +
              '<div class="meta">' + (l.missed ? 'No session' : l.minutes_delivered + ' min') +
              (l.note ? ' · ' + esc(l.note) : '') + '</div></div>' +
              '<div class="card-actions"><button class="btn small danger" type="button" data-log-del="' + l.id + '">Delete</button></div></div>';
          }).join("") : '<p class="meta">No entries logged in ' + mr.label + ' yet.</p>') + '</div>' +
          (older ? '<p class="meta">+ ' + older + (older === 1 ? ' earlier entry' : ' earlier entries') +
            ' saved — your ' + lim.label + ' plan shows this month. <a href="plans.html">See plans</a> for the full history.</p>' : '') +
          '<div class="card-actions"><button class="btn small" type="button" data-svc-edit="' + s.id + '">Edit</button>' +
          '<button class="btn small danger" type="button" data-svc-del="' + s.id + '">Delete service</button></div></article>';
        return html;
      }).join("");

      $all("[data-svc-edit]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var s = servicesCache.filter(function (x) { return x.id === btn.getAttribute("data-svc-edit"); })[0];
          if (!s) return;
          $("#svc-id").value = s.id;
          $("#svc-name").value = s.name || "";
          $("#svc-minutes").value = s.minutes_per_week || "";
          $("#svc-child").value = s.child_id || "";
          $("#svc-submit").textContent = "Save changes";
          $("#svc-submit").disabled = false;
          $("#svc-cancel").hidden = false;
          form.scrollIntoView({ behavior: "smooth" });
        });
      });
      $all("[data-svc-del]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var s = servicesCache.filter(function (x) { return x.id === btn.getAttribute("data-svc-del"); })[0];
          if (!s) return;
          if (!window.confirm("Delete \"" + s.name + "\" and all its log entries?")) return;
          apiDelete("services", "id=eq." + s.id)
            .then(function () { showMsg("Service deleted."); refresh(); })
            .catch(function (err) { showMsg(err.message, "error"); });
        });
      });
      $all("[data-log-del]", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (!window.confirm("Delete this log entry?")) return;
          apiDelete("service_logs", "id=eq." + btn.getAttribute("data-log-del"))
            .then(function () { showMsg("Entry deleted."); refresh(); })
            .catch(function (err) { showMsg(err.message, "error"); });
        });
      });
      $all(".lg-missed", listEl).forEach(function (box) {
        box.addEventListener("change", function () {
          var mins = box.closest("form").querySelector(".lg-minutes");
          if (mins) { mins.disabled = box.checked; if (box.checked) mins.value = ""; }
        });
      });
      $all("form[data-logform]", listEl).forEach(function (lf) {
        lf.addEventListener("submit", function (ev) {
          ev.preventDefault();
          var date = lf.querySelector(".lg-date").value;
          var missed = lf.querySelector(".lg-missed").checked;
          var minsRaw = lf.querySelector(".lg-minutes").value;
          var mins = missed ? 0 : parseInt(minsRaw, 10);
          if (!date) { showMsg("Pick the date of the session.", "error"); return; }
          if (date > todayISO()) { showMsg("That date is still in the future — log a session after it happens.", "error"); return; }
          if (historyLocked() && date < monthRange(monthKeyOf(todayISO())).start) {
            showMsg("Your " + limits().label + " plan logs entries for this month. See Plans for the full history.", "error");
            return;
          }
          if (!missed && !(mins > 0)) { showMsg("Enter the minutes delivered, or tick Missed if there was no session.", "error"); return; }
          lastLogDate = date;
          apiInsert("service_logs", {
            user_id: session.user.id,
            service_id: lf.getAttribute("data-logform"),
            date: date,
            minutes_delivered: mins,
            missed: missed,
            note: lf.querySelector(".lg-note").value.trim()
          }).then(function () { showMsg("Logged."); refresh(); })
            .catch(function (err) { showMsg(err.message, "error"); });
        });
      });
    }

    function refresh() {
      Promise.all([loadServices(), loadServiceLogs(), loadChildren()]).then(function (res) {
        servicesCache = res[0] || [];
        logsCache = res[1] || [];
        childrenCache = res[2] || [];
        var keepChild = $("#svc-child").value;
        fillChildSelect($("#svc-child"), childrenCache, false);
        if (keepChild) $("#svc-child").value = keepChild;
        renderPager();
        render();
      }).catch(function (err) { showMsg(err.message, "error"); });
    }

    $("#svc-cancel").addEventListener("click", function () {
      form.reset();
      $("#svc-id").value = "";
      $("#svc-submit").textContent = "Add service";
      $("#svc-cancel").hidden = true;
      render();
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var id = $("#svc-id").value;
      var row = {
        user_id: session.user.id,
        name: $("#svc-name").value.trim(),
        minutes_per_week: parseInt($("#svc-minutes").value, 10),
        child_id: $("#svc-child").value || null
      };
      if (!row.name) { showMsg("Give the service a name (for example: Speech therapy).", "error"); return; }
      if (!(row.minutes_per_week > 0)) { showMsg("Enter the minutes per week promised in the IEP.", "error"); return; }
      if (!id && servicesCache.length >= limits().services) {
        showMsg("Your " + limits().label + " plan covers " + limits().services + " service(s). See Plans to track more.", "error");
        return;
      }
      var op = id
        ? apiPatch("services", "id=eq." + id, { name: row.name, minutes_per_week: row.minutes_per_week, child_id: row.child_id })
        : apiInsert("services", row);
      op.then(function () {
        showMsg(id ? "Changes saved." : "Service added.");
        form.reset();
        $("#svc-id").value = "";
        $("#svc-submit").textContent = "Add service";
        $("#svc-cancel").hidden = true;
        refresh();
      }).catch(function (err) { showMsg(err.message, "error"); });
    });
    refresh();
  }

  // ==========================================================================
  // PAGE: meeting (meeting-prep pack)
  // ==========================================================================
  function initMeeting() {
    var packEl = $("#pack");
    var controlsEl = $("#mp-controls");
    var childrenCache = [], docsCache = [], meetingsCache = [],
        servicesCache = [], logsCache = [], questionsCache = [];
    var questionsOk = true;
    var selectedId = "";

    function prettyDate(iso) { return window.PlannerCore ? window.PlannerCore.pretty(iso) : iso; }
    function currentChild() {
      return childrenCache.filter(function (c) { return c.id === selectedId; })[0] || childrenCache[0] || null;
    }
    function gapText(gap) { return gap > 0 ? gap + " min not yet logged" : "promised minutes covered"; }
    function missedText(n) { return n ? " · " + n + (n === 1 ? " session" : " sessions") + " marked missed" : ""; }

    function renderPack() {
      var child = currentChild();
      if (!child) {
        packEl.innerHTML = '<div class="empty"><p>No children added yet.</p>' +
          '<a class="btn" href="children.html">Add your child</a></div>';
        return;
      }
      selectedId = child.id;
      var pack = buildMeetingPack(child, {
        documents: docsCache, meetings: meetingsCache, services: servicesCache,
        logs: logsCache, questions: questionsCache
      }, todayISO(), planKey());

      var html = '<div class="pack-head"><h2>' + esc(pack.childName) + '</h2>' +
        '<p class="meta">' + esc(pack.stateName || "State not set") + ' · Meeting prep pack · Prepared ' +
        esc(prettyDate(pack.generatedOn)) + '</p></div>';

      // ---- key deadlines (the engine's own rows, unmodified) ----
      html += '<section class="block"><h2>Key deadlines</h2>';
      if (!pack.deadlines.length) {
        html += '<p class="meta">No deadlines yet — add this child\u2019s key dates on the Children page and they will appear here automatically.</p>';
      } else {
        html += pack.deadlines.map(function (d) {
          // Compact what-next line (first step only) — part of the
          // printed pack, from the shared module.
          var wnStep = window.IEPWhatNext ? window.IEPWhatNext.firstStep(d.kind) : "";
          return '<div class="deadline-row"><div class="deadline-main"><strong>' + esc(d.title) + '</strong>' +
            '<div class="meta">' + esc(d.dueText) +
            (d.approx ? ' <span title="Counted Monday\u2013Friday without holidays or school breaks">(approx.)</span>' : '') +
            '<br>' + esc(d.basis) +
            (d.verifiedOn ? ' Rules last verified ' + esc(d.verifiedOn) + '.' : '') +
            (wnStep ? '<br>Next step: ' + esc(wnStep) : '') +
            '</div></div>' + deadlineBadge(d) + '</div>';
        }).join("");
      }
      html += '</section>';

      // ---- services: promised vs delivered ----
      html += '<section class="block"><h2>Services — promised vs delivered</h2>';
      if (!pack.services.length) {
        html += '<p class="meta">No services tracked yet — add them on the Services page and the promised-vs-delivered figures will appear here.</p>';
      } else {
        html += pack.services.map(function (s) {
          var w = s.summary.week, m = s.summary.month;
          return '<article class="card"><h3>' + esc(s.name) + '</h3>' +
            '<p class="meta">Promised ' + s.minutesPerWeek + ' min/week</p>' +
            '<p class="meta">This week (Mon\u2013Sun): logged <strong>' + w.delivered + ' min</strong> of ' + w.promised +
            ' min · ' + gapText(w.gap) + missedText(w.missed) + '</p>' +
            '<p class="meta">' + esc(m.label) + ': logged <strong>' + m.delivered + ' min</strong> of about ' + m.promised +
            ' min · ' + gapText(m.gap) + missedText(m.missed) + '</p>' +
            (s.year ? '<p class="meta">School year (from ' + esc(prettyDate(s.year.start)) + '): logged <strong>' +
              s.year.delivered + ' min</strong> of about ' + s.year.promised + ' min · ' + gapText(s.year.gap) +
              missedText(s.year.missed) + '</p>' : '') +
            '</article>';
        }).join("");
        if (!pack.fullScope) {
          html += '<div class="limit-note no-print">School-year service totals (from September 1) are part of paid plans — ' +
            'this pack shows this week and this month. <a href="plans.html">See plans</a></div>';
        }
      }
      html += '</section>';

      // ---- documents on file ----
      html += '<section class="block"><h2>Documents on file</h2>';
      if (!pack.documents.length) {
        html += '<p class="meta">No documents on file yet.</p>';
      } else {
        html += pack.documents.map(function (d) {
          return '<div class="doc-row"><div class="doc-main"><strong>' + esc(d.title) + '</strong>' +
            '<div class="meta">' + esc(prettyDate((d.created_at || "").slice(0, 10))) + '</div></div></div>';
        }).join("");
      }
      html += '</section>';

      // ---- recent notes ----
      html += '<section class="block"><h2>Recent notes</h2>';
      if (!pack.notes.length) {
        html += '<p class="meta">No notes logged yet.</p>';
      } else {
        html += pack.notes.map(function (n) {
          return '<article class="card note-card"><div class="deadline-row"><div class="deadline-main">' +
            '<strong>' + esc(n.title) + '</strong><div class="meta">' + esc(prettyDate(n.date)) +
            '</div></div></div>' +
            (n.notes ? '<p class="note-body">' + esc(n.notes) + '</p>' : '') + '</article>';
        }).join("");
        if (!pack.fullScope && pack.notesTotal > pack.notes.length) {
          var hiddenCount = pack.notesTotal - pack.notes.length;
          html += '<p class="meta no-print">+ ' + hiddenCount + ' earlier ' + (hiddenCount === 1 ? 'entry' : 'entries') +
            ' saved — your ' + limits().label + ' plan\u2019s pack shows the latest 3. ' +
            '<a href="plans.html">See plans</a> for the full history in the pack.</p>';
        }
      }
      html += '</section>';

      // ---- questions I want to ask ----
      html += '<section class="block"><h2>Questions I want to ask</h2>';
      if (!questionsOk) {
        html += '<p class="meta no-print">Your saved questions could not be loaded just now — the rest of the pack is complete.</p>';
      } else if (!pack.questions.length) {
        html += '<p class="meta">No questions yet — add the things you want to raise at the meeting.</p>';
      } else {
        html += pack.questions.map(function (q) {
          return '<div class="doc-row' + (q.done ? ' pq-done' : '') + '">' +
            '<label class="pq-label"><input type="checkbox" data-q-toggle="' + q.id + '"' + (q.done ? ' checked' : '') + '>' +
            '<span class="pq-glyph" aria-hidden="true">' + (q.done ? '\u2611' : '\u2610') + '</span>' +
            '<span class="pq-text">' + esc(q.text) + '</span></label>' +
            '<div class="card-actions"><button class="btn small danger no-print" type="button" data-q-del="' + q.id + '">Delete</button></div></div>';
        }).join("");
      }
      if (questionsOk) {
        html += '<form class="no-print" id="mp-qform"><label>Your question ' +
          '<input type="text" id="mp-qtext" maxlength="300" placeholder="What would you like to ask at the meeting?" autocomplete="off"></label>' +
          '<button class="btn small" type="submit">Add question</button></form>';
      }
      html += '</section>';

      html += '<p class="meta">Deadlines are estimates worked out from your state\u2019s published rules and the dates you saved — a planning aid, not legal advice. Service figures reflect only what you have logged.</p>';

      packEl.innerHTML = html;
      wirePack();
    }

    function wirePack() {
      var qform = $("#mp-qform");
      if (qform) {
        qform.addEventListener("submit", function (ev) {
          ev.preventDefault();
          var text = $("#mp-qtext").value.trim();
          if (!text) { showMsg("Type the question first.", "error"); return; }
          var child = currentChild();
          if (!child) return;
          apiInsert("prep_questions", {
            user_id: session.user.id, child_id: child.id, text: text, done: false
          }).then(function () { showMsg("Question added."); refresh(); })
            .catch(function (err) { showMsg(err.message, "error"); });
        });
      }
      $all("[data-q-toggle]", packEl).forEach(function (box) {
        box.addEventListener("change", function () {
          var id = box.getAttribute("data-q-toggle");
          var q = questionsCache.filter(function (x) { return x.id === id; })[0];
          var done = box.checked;
          apiPatch("prep_questions", "id=eq." + id, { done: done }).then(function () {
            if (q) q.done = done;
            var row = box.closest(".doc-row");
            if (row) {
              row.classList.toggle("pq-done", done);
              var glyph = row.querySelector(".pq-glyph");
              if (glyph) glyph.textContent = done ? "\u2611" : "\u2610";
            }
          }).catch(function (err) { box.checked = !done; showMsg(err.message, "error"); });
        });
      });
      $all("[data-q-del]", packEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (!window.confirm("Delete this question?")) return;
          apiDelete("prep_questions", "id=eq." + btn.getAttribute("data-q-del"))
            .then(function () { showMsg("Question deleted."); refresh(); })
            .catch(function (err) { showMsg(err.message, "error"); });
        });
      });
    }

    function refresh() {
      // The questions load rides on its own chain: until iep-prep.sql is
      // applied the table does not exist, and that must not break the
      // rest of the pack (same pattern as the dashboard services strip).
      var qLoad = loadPrepQuestions().then(function (qs) {
        questionsCache = qs || []; questionsOk = true;
      }, function () {
        questionsCache = []; questionsOk = false;
      });
      Promise.all([loadChildren(), loadDocuments(), loadMeetings(), loadServices(), loadServiceLogs(), qLoad])
        .then(function (res) {
          childrenCache = res[0] || [];
          docsCache = res[1] || [];
          meetingsCache = res[2] || [];
          servicesCache = res[3] || [];
          logsCache = res[4] || [];
          var keep = selectedId;
          fillChildSelect($("#mp-child"), childrenCache, false);
          selectedId = (keep && childrenCache.some(function (c) { return c.id === keep; }))
            ? keep : (childrenCache.length ? childrenCache[0].id : "");
          if (selectedId) $("#mp-child").value = selectedId;
          if (controlsEl) controlsEl.hidden = !childrenCache.length;
          renderPack();
        }).catch(function (err) { showMsg(err.message, "error"); });
    }

    $("#mp-child").addEventListener("change", function () {
      selectedId = this.value;
      renderPack();
    });
    $("#mp-print").addEventListener("click", function () { window.print(); });
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
      limits().documents + ' documents, ' +
      limits().services + (limits().services === 1 ? ' service' : ' services') +
      (limits().serviceHistory === 'all' ? ' with full minute history' : ' with this month of minute history') +
      '. <a href="plans.html">Compare plans</a>';
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
           notes: initNotes, services: initServices, meeting: initMeeting, settings: initSettings, plans: initPlans })[page]();
      })
      .catch(function (err) {
        if (err && err.message !== "not-signed-in") showMsg(err.message || "Something went wrong loading your account.", "error");
      });
  });

  window.IEPApp = {
    PLAN_LIMITS: PLAN_LIMITS,
    deadlinesForChild: deadlinesForChild,
    serviceSummary: serviceSummary,
    servicesWeekTotals: servicesWeekTotals,
    schoolYearStartISO: schoolYearStartISO,
    serviceYearSummary: serviceYearSummary,
    buildMeetingPack: buildMeetingPack,
    weekStartISO: weekStartISO,
    monthRange: monthRange,
    getProfile: function () { return profile; },
    getSession: function () { return session; }
  };
})();
