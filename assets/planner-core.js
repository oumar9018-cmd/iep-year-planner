/*
 * IEP Year Planner — core date math.
 * Pure functions, no DOM, no network. Used by site/planner.html in the browser
 * and by tests/planner-tests.js under Node.
 *
 * Counting conventions (stated on the planner page, in plain language):
 *  - "Calendar days": the consent date is day 0; the deadline is consent + N days.
 *  - "School / instructional / business days": counted Monday–Friday starting the
 *    first weekday after the consent date. This EXCLUDES public holidays and
 *    school breaks, which vary by district — the planner labels every school-day
 *    result an approximation and says the district calendar controls.
 *  - Annual review: due 12 months after the previous annual review
 *    (34 CFR 300.324(b): review "not less than annually").
 *  - Reevaluation: due 3 years after the last evaluation
 *    (34 CFR 300.303(b)(2): at least once every 3 years, unless parent and
 *    school agree in writing that it is unnecessary — the planner shows the
 *    3-year date as the outside date).
 *  - Transition: planning must be in the IEP in effect on the date the child
 *    turns the state's transition age (federal: 16, 34 CFR 300.320(b)).
 */
(function (global) {
  "use strict";

  function parseISO(s) {
    var p = s.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function toISO(d) {
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function addCalendarDays(iso, n) {
    var d = parseISO(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
  }
  function isWeekday(d) {
    var w = d.getUTCDay();
    return w >= 1 && w <= 5;
  }
  // Count n weekdays starting the first weekday AFTER `iso` (iso is day 0).
  function addSchoolDays(iso, n) {
    var d = parseISO(iso);
    var counted = 0;
    while (counted < n) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (isWeekday(d)) counted++;
    }
    return toISO(d);
  }
  function addMonths(iso, n) {
    var d = parseISO(iso);
    var day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return toISO(d);
  }
  function addYears(iso, n) {
    return addMonths(iso, n * 12);
  }
  function pretty(iso) {
    var months = ["January","February","March","April","May","June","July",
      "August","September","October","November","December"];
    var d = parseISO(iso);
    return months[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  }

  // rule: { value: number|null,
  //         dayKind: "calendar"|"school"|"business"|"dual"|null,
  //         dayTypeLabel: string,
  //         dual: {school_days, calendar_days}|null,
  //         clockStart: "consent"|"referral"|"dual",
  //         status: "verified"|"partial"|"unverified" }
  // transition: number (age in years, may be fractional) or {months, label}
  // inputs: { startDate, lastAnnualReview, lastEvaluation, childDob } — ISO strings or ""
  //   startDate = the date the state's clock starts (consent date in most
  //   states; the date the school received the referral in CT/NC/VA).
  // Returns: [{kind, title, dueISO, dueText, basis, approx:boolean}]
  function computeDeadlines(rule, transition, inputs) {
    var out = [];
    var startPhrase = (rule && rule.clockStart === "referral")
      ? "from the date the school received the referral"
      : "from the date you signed consent";

    if (inputs.startDate) {
      if (rule && rule.dayKind === "dual" && rule.dual) {
        var dSchool = addSchoolDays(inputs.startDate, rule.dual.school_days);
        var dCal = addCalendarDays(inputs.startDate, rule.dual.calendar_days);
        var dDual = dSchool < dCal ? dSchool : dCal;
        out.push({
          kind: "evaluation",
          title: "Initial evaluation deadline",
          dueISO: dDual,
          dueText: pretty(dDual),
          basis: "Your state sets two limits — " + rule.dual.school_days + " school days (" +
            pretty(dSchool) + ") or " + rule.dual.calendar_days + " calendar days (" +
            pretty(dCal) + ") — and the earlier date applies. Counted " + startPhrase + ".",
          approx: true
        });
      } else if (rule && rule.value != null && rule.dayKind) {
        var due = (rule.dayKind === "calendar")
          ? addCalendarDays(inputs.startDate, rule.value)
          : addSchoolDays(inputs.startDate, rule.value);
        var basisTxt = rule.value + " " + rule.dayTypeLabel + " " + startPhrase + " (your state's timeline).";
        if (rule.clockStart === "dual") {
          basisTxt += " Your state also runs a second clock from the written referral — check your state's page.";
        }
        out.push({
          kind: "evaluation",
          title: "Initial evaluation deadline",
          dueISO: due,
          dueText: pretty(due),
          basis: basisTxt,
          approx: rule.dayKind !== "calendar"
        });
      } else {
        out.push({
          kind: "evaluation",
          title: "Initial evaluation deadline (federal baseline)",
          dueISO: addCalendarDays(inputs.startDate, 60),
          dueText: pretty(addCalendarDays(inputs.startDate, 60)),
          basis: "60 calendar days from consent — the federal IDEA baseline (34 CFR 300.301). We could not verify your state's own timeline from an official source; check your state's page and your Parent Center.",
          approx: false
        });
      }
    }

    if (inputs.lastAnnualReview) {
      var ar = addMonths(inputs.lastAnnualReview, 12);
      out.push({
        kind: "annual",
        title: "Next annual IEP review due by",
        dueISO: ar,
        dueText: pretty(ar),
        basis: "The IEP must be reviewed at least once every 12 months (federal rule, 34 CFR 300.324).",
        approx: false
      });
    }

    if (inputs.lastEvaluation) {
      var tr = addYears(inputs.lastEvaluation, 3);
      out.push({
        kind: "triennial",
        title: "Reevaluation due by (3-year rule)",
        dueISO: tr,
        dueText: pretty(tr),
        basis: "A reevaluation must happen at least once every 3 years unless you and the school agree in writing that it is not needed (federal rule, 34 CFR 300.303).",
        approx: false
      });
    }

    var tMonths = null, tLabel = null;
    if (typeof transition === "number" && transition) {
      tMonths = Math.round(transition * 12); tLabel = String(transition);
    } else if (transition && transition.months) {
      tMonths = transition.months; tLabel = transition.label || String(transition.months / 12);
    }
    if (inputs.childDob && tMonths) {
      var turns = addMonths(inputs.childDob, tMonths);
      out.push({
        kind: "transition",
        title: "Transition planning must be in the IEP by",
        dueISO: turns,
        dueText: pretty(turns),
        basis: "Transition planning must be included in the IEP that is in effect when your child turns " +
          tLabel + " in your state — so it is normally added at the annual review just before this birthday.",
        approx: false
      });
    }

    out.sort(function (a, b) { return a.dueISO < b.dueISO ? -1 : 1; });
    return out;
  }

  var api = {
    parseISO: parseISO, toISO: toISO,
    addCalendarDays: addCalendarDays, addSchoolDays: addSchoolDays,
    addMonths: addMonths, addYears: addYears,
    pretty: pretty, computeDeadlines: computeDeadlines
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PlannerCore = api;
})(typeof window !== "undefined" ? window : globalThis);
