/* IEP Year Planner — page logic. Runs entirely in the browser.
 * No network calls are made from this page: dates typed here never leave
 * the device. Nothing you type here is uploaded or stored anywhere. */
(function () {
  "use strict";
  var data = window.IEP_STATES;
  var core = window.PlannerCore;
  var sel = document.getElementById("p-state");
  var note = document.getElementById("p-state-note");
  var startLabel = document.getElementById("p-start-label");
  var startHint = document.getElementById("p-start-hint");

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
        : "");
    if (s.clockStart === "referral") {
      startLabel.textContent = "Date the school received the referral (this starts your state's clock)";
      startHint.textContent = "Your state counts its timeline from the referral, not from consent.";
    } else {
      startLabel.textContent = "Date you signed consent for an initial evaluation";
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
      dual: s.dual, clockStart: s.clockStart, status: s.status
    };
    var inputs = {
      startDate: document.getElementById("p-start").value,
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
    var htmlOut = "<h2>Your deadlines</h2>";
    list.forEach(function (d) {
      htmlOut += "<div class='deadline'><div>" + d.title + "</div>" +
        "<div class='when'>" + d.dueText + "</div>" +
        "<div class='basis'>" + d.basis +
        (d.approx ? " Counted Monday to Friday, without holidays or school breaks — your district's calendar decides the exact date." : "") +
        "</div></div>";
    });
    htmlOut += "<p class='small'>Planning aids from published rules — not legal advice. " +
      "Your <a href='states/" + s.slug + ".html'>" + s.name + " state page</a> shows the official source for each figure.</p>";
    box.innerHTML = htmlOut;
  });
})();
