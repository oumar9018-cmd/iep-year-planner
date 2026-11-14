/*
 * IEP Year Planner — "What happens next" content.
 * Pure data + tiny helpers, no DOM, no network. Used by the public
 * planner (tools/planner-v2.js), the app (assets/app.js) and the
 * meeting-prep pack, and by tests/whatnext-tests.js under Node.
 * Canonical in tools/; tools/build-site-v2.py copies it to
 * site-v2/assets/what-next.js — the same pattern as planner-core.js.
 *
 * One block per deadline KIND, matching the kinds planner-core.js
 * returns from computeDeadlines: "evaluation", "annual", "triennial",
 * "transition". Each block:
 *   meaning  — what the deadline is, in 1–2 plain sentences.
 *   ifPasses — what generally happens if the date passes, in calm
 *              factual words. Never accusatory, never a promise
 *              about legal outcomes.
 *   steps    — 3–4 concrete things a parent can do next.
 *   cite     — the federal rules the block rests on (34 CFR Part 300),
 *              shown as small print.
 * Every rendered block ends with DISCLAIMER.
 */
(function (global) {
  "use strict";

  var DISCLAIMER = "General information from published federal rules — not legal advice.";

  var BLOCKS = {
    evaluation: {
      meaning: "This is the date by which the school should finish evaluating your child, counting from when you gave written consent. The evaluation decides whether your child qualifies for special education and what help they may need.",
      ifPasses: "If the date passes with no finished evaluation, your child keeps waiting — services cannot start until eligibility is decided. A missed timeline does not take away any of your child's rights, and the school is still expected to complete the evaluation.",
      steps: [
        "Ask in writing where the evaluation stands — an email to the school is fine — and keep a copy with the date you sent it.",
        "Ask for prior written notice: the school's written explanation of what it is proposing or refusing, and why.",
        "Contact your state's Parent Center (Parent Training and Information Center) — free, independent help from people who know the local process. Your state page on this site links to it.",
        "If writing does not resolve it, federal rules provide formal options: a state complaint (the state agency generally must decide within 60 days), mediation, or a due process hearing."
      ],
      cite: "Federal rules: 34 CFR 300.301 (evaluation timeline), 300.503 (prior written notice), 300.504 (procedural safeguards), 300.151–153 (state complaints), 300.506 (mediation), 300.507 (due process)."
    },
    annual: {
      meaning: "The IEP must be reviewed — and updated where needed — at least once every 12 months. The annual review checks progress on the current goals and sets the plan for the year ahead.",
      ifPasses: "If the review date passes, the current IEP usually stays in place and services continue under it — but goals and services can drift out of date as your child changes. You do not have to wait for the yearly date: you can ask for a review meeting at any time.",
      steps: [
        "Write to the school asking for the annual review to be scheduled, and keep a copy of your request.",
        "Before the meeting, note what has changed — progress made, new concerns, anything the current goals no longer fit.",
        "At the meeting you may agree or disagree with parts of the plan; ask for prior written notice of anything the school proposes or refuses to change.",
        "If you and the school cannot agree, the options include mediation, a state complaint, or due process — your Parent Center can talk them through with you, free."
      ],
      cite: "Federal rules: 34 CFR 300.324(b) (review at least annually), 300.503 (prior written notice), 300.504 (procedural safeguards), 300.151–153 (state complaints), 300.506 (mediation), 300.507 (due process)."
    },
    triennial: {
      meaning: "At least once every 3 years the school must reevaluate — look again at whether your child still qualifies and what they need now — unless you and the school agree in writing that a reevaluation is not needed.",
      ifPasses: "If the 3-year date passes, the existing IEP continues, but decisions may rest on old information. A reevaluation does not have to wait for the 3-year mark — you can request one sooner if you believe your child's needs have changed.",
      steps: [
        "Put your request in writing — asking for the reevaluation to be scheduled, or for an earlier one — and keep a copy. The school will ask for your consent before it starts.",
        "Share anything new the team should consider: medical reports, changes at home, teacher concerns, your own observations.",
        "If the school declines a reevaluation you asked for, it must explain why in a prior written notice.",
        "If you disagree with the school's evaluation results, you can ask for an independent educational evaluation; mediation, state complaints and due process also remain open."
      ],
      cite: "Federal rules: 34 CFR 300.303 (reevaluation), 300.502 (independent educational evaluation), 300.503 (prior written notice), 300.504 (procedural safeguards), 300.151–153 (state complaints), 300.506 (mediation), 300.507 (due process)."
    },
    transition: {
      meaning: "Transition planning prepares your child for life after school — further education, work, and independent living. It must be part of the IEP that is in effect when your child reaches your state's transition age.",
      ifPasses: "If this date passes without transition planning in the IEP, the plan is incomplete — but it can still be added. You can ask for a meeting to put it in place rather than waiting for the next annual review.",
      steps: [
        "Ask in writing for transition planning to be added at the next IEP meeting — you do not need to wait for the annual review.",
        "Make sure your child is invited to any meeting where transition is discussed — the school must invite them.",
        "Ask what assessments will be used to set the post-school goals, and which outside agencies (such as vocational rehabilitation) will be invited.",
        "If the school will not add transition planning, ask for prior written notice explaining why, and talk it through free with your Parent Center."
      ],
      cite: "Federal rules: 34 CFR 300.320(b) (transition services in the IEP), 300.321(b) (who is invited), 300.503 (prior written notice), 300.504 (procedural safeguards)."
    }
  };

  function blockFor(kind) {
    return BLOCKS[kind] || null;
  }
  function kinds() {
    return Object.keys(BLOCKS);
  }
  function firstStep(kind) {
    var b = BLOCKS[kind];
    return b && b.steps.length ? b.steps[0] : "";
  }

  // The deadline a parent should look at first, from one child's list:
  // if anything is past due, the MOST RECENTLY missed one (the latest
  // due date among the overdue) — the freshest miss is the most
  // fixable, and it is usually the one blocking everything else; a
  // deadline missed months ago should not outrank it. Otherwise the
  // earliest upcoming date. "Today" counts as upcoming, not overdue.
  // Does not assume the input arrives sorted, and never mutates it.
  function pickNextDeadline(deadlines, todayISO) {
    if (!deadlines || !deadlines.length) return null;
    var sorted = deadlines.slice().sort(function (a, b) {
      return a.dueISO < b.dueISO ? -1 : a.dueISO > b.dueISO ? 1 : 0;
    });
    var next = null;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].dueISO < todayISO) next = sorted[i]; // latest overdue so far
      else break;
    }
    return next || sorted[0]; // most recently missed, else earliest upcoming (or due today)
  }
  // Is `target` the picked next deadline of the same list? Compared by
  // kind + due date, the pair that identifies a row for one child.
  function isNextDeadline(deadlines, target, todayISO) {
    var next = pickNextDeadline(deadlines, todayISO);
    return !!(next && target && next.kind === target.kind && next.dueISO === target.dueISO);
  }

  var api = {
    BLOCKS: BLOCKS,
    DISCLAIMER: DISCLAIMER,
    blockFor: blockFor,
    kinds: kinds,
    firstStep: firstStep,
    pickNextDeadline: pickNextDeadline,
    isNextDeadline: isNextDeadline
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.IEPWhatNext = api;
})(typeof window !== "undefined" ? window : globalThis);
