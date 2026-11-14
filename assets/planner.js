/* IEP Year Planner — page logic. Runs entirely in the browser.
 * No network calls are made from this page: dates typed here never leave
 * the device. Nothing you type here is uploaded or stored anywhere. */
(function () {
  "use strict";
  var data = window.IEP_STATES;
  var core = window.PlannerCore;
  var sel = document.getElementById("p-state");
  var note = document.getElementById("p-state-note");
  var startHint = document.getElementById("p-start-hint");
  var refRow = document.getElementById("p-referral-row");
  var refHint = document.getElementById("p-referral-hint");
  var absRow = document.getElementById("p-absent-row");

  var abbrs = Object.keys(data).sort(function (a, b) {
    return data[a].name < data[b].name ? -1 : 1;
  });
  abbrs.forEach(function (abbr) {
    var o = document.createElement("option");
    o.value = abbr;
    o.textContent = data[abbr].name;
    sel.appendChild(o);
  });

  var params = new URLSearchParams(window.location.search);
  var preset = params.get("state");
  if (preset && data[preset.toUpperCase()]) sel.value = preset.toUpperCase();

  function describeState() {
    var s = data[sel.value];
    var clockTxt = s.clockStart === "referral"
      ? "In " + s.name + " the evaluation clock starts when the school receives the referral."
      : s.clockStart === "dual"
        ? s.name + " runs two clocks — one from consent, one from referral."
        : "The clock starts on the date you sign consent.";
    note.textContent = s.name + ": initial evaluation " + s.value + " " + s.dayTypeLabel + ". " + clockTxt +
      (s.status !== "verified"
        ? " We are still double-checking one detail of this state's figures — see the state page."
        : "") +
      (s.verifiedOn ? " Rules last verified: " + core.pretty(s.verifiedOn) + "." : "");
    if (refRow) refRow.hidden = !s.needsReferral;
    if (absRow) absRow.hidden = !s.absenceExtension;
    if (s.clockStart === "referral") {
      if (refHint) refHint.textContent = "This date starts your state's clock — it matters more than the consent date here.";
      startHint.textContent = "If you only know the consent date, enter it and the planner will estimate from it — but the real clock started at referral, so the real deadline is likely sooner.";
    } else if (s.clockStart === "dual") {
      if (refHint) refHint.textContent = "Your state also runs a clock from the written referral (" + (s.referralDays || 90) + " days) — enter it to see the earlier of the two dates.";
      startHint.textContent = "Leave blank if your child already has an IEP and no new evaluation is pending.";
    } else {
      startHint.textContent = "Leave blank if your child already has an IEP and no new evaluation is pending.";
    }
  }
  sel.addEventListener("change", describeState);
  describeState();

  document.getElementById("planner-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var s = data[sel.value];
    var rule = {
      value: s.value, dayKind: s.dayKind, dayTypeLabel: s.dayTypeLabel,
      dual: s.dual, clockStart: s.clockStart, status: s.status,
      referralDays: s.referralDays || null,
      absenceExtension: !!s.absenceExtension
    };
    var refEl = document.getElementById("p-referral");
    var absEl = document.getElementById("p-absent");
    var inputs = {
      startDate: document.getElementById("p-start").value,
      referralDate: (s.needsReferral && refEl) ? refEl.value : "",
      absentDays: (s.absenceExtension && absEl) ? absEl.value : "",
      lastAnnualReview: document.getElementById("p-annual").value,
      lastEvaluation: document.getElementById("p-eval").value,
      childDob: document.getElementById("p-dob").value
    };
    var box = document.getElementById("results");
    var list = core.computeDeadlines(rule,
      { months: s.transitionMonths, label: s.transitionLabel }, inputs);
    if (!list.length) {
      box.innerHTML = "<div class='panel'><p>Enter at least one date above and the planner will work out the deadlines that follow from it.</p></div>";
      return;
    }
    if (window.iepTrack) window.iepTrack("planner_complete", sel.value);
    // "What happens next" — the full guide on the public planner (this
    // is the free trust surface; plan gating lives only in the app).
    // Content comes from the shared module (assets/what-next.js).
    var WN = window.IEPWhatNext;
    function whatNextHtml(d) {
      if (!WN) return "";
      var b = WN.blockFor(d.kind);
      if (!b) return "";
      var steps = b.steps.map(function (s) { return "<li>" + s + "</li>"; }).join("");
      return "<button type='button' class='btn btn-ghost btn-sm wn-toggle' aria-expanded='false'>What happens next</button>" +
        "<div class='wn-panel' hidden>" +
        "<p class='basis'>" + b.meaning + "</p>" +
        "<p class='wn-head'>If this date passes</p>" +
        "<p class='basis'>" + b.ifPasses + "</p>" +
        "<p class='wn-head'>Steps you can take</p>" +
        "<ol class='wn-steps'>" + steps + "</ol>" +
        "<p class='small'>" + b.cite + "</p>" +
        "<p class='small'>" + WN.DISCLAIMER + "</p>" +
        "</div>";
    }
    var htmlOut = "<h2>Your deadlines</h2>";
    list.forEach(function (d) {
      htmlOut += "<div class='deadline'><div>" + d.title + "</div>" +
        "<div class='when'>" + d.dueText + "</div>" +
        "<div class='basis'>" + d.basis +
        (d.approx ? " Counted Monday to Friday, without holidays or school breaks — your district's calendar decides the exact date." : "") +
        "</div>" + whatNextHtml(d) + "</div>";
    });
    htmlOut += "<p class='small'>Planning aids from published rules — estimated timelines, not legal advice. " +
      "Your <a href='states/" + s.slug + ".html'>" + s.name + " state page</a> shows the official source for each figure." +
      (s.verifiedOn ? " The " + s.name + " figures were last verified against that source on " + core.pretty(s.verifiedOn) + "." : "") +
      "</p>";
    box.innerHTML = htmlOut;
    Array.prototype.forEach.call(box.querySelectorAll(".wn-toggle"), function (btn) {
      btn.addEventListener("click", function () {
        var panel = btn.nextElementSibling;
        if (!panel) return;
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.textContent = open ? "Hide" : "What happens next";
      });
    });
  });
})();
