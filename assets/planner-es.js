/* IEP Year Planner — lógica de la página de la calculadora en español.
 * Mirror de tools/planner-v2.js: funciona por completo en el navegador,
 * sin llamadas de red — las fechas escritas aquí nunca salen del
 * dispositivo y no se guarda nada.
 *
 * Las FECHAS salen del mismo motor que la página en inglés
 * (planner-core.js → computeDeadlines, con los mismos datos de
 * assets/states-data.js): los números son idénticos; solo cambia el
 * idioma de los títulos y las explicaciones, que se generan aquí
 * (titleEs / basisEs) siguiendo rama por rama la misma lógica.
 * Las partes puras se exportan (IEPPlannerES) para las pruebas de
 * Node en tests/spanish-tests.js. Glosario fijo: tools/i18n_es.py. */
(function (global) {
  "use strict";

  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  // Traducción de cada etiqueta `day_type` de data/states.json
  // (las mismas 8 de DAY_TYPES_ES en tools/i18n_es.py).
  var DAY_TYPE_ES = {
    "calendar days": "días calendario",
    "school days": "días escolares",
    "days": "días",
    "business days": "días hábiles",
    "instructional days": "días de instrucción",
    "school working days": "días laborables escolares",
    "school days or 90 calendar days, whichever is less":
      "días escolares o 90 días calendario, lo que sea menor",
    "days (statute); calendar days per Arizona Dept. of Education guidance":
      "días (según la ley); días calendario según la guía del Departamento de Educación de Arizona"
  };
  function dayTypeEs(label) { return DAY_TYPE_ES[label] || label; }

  // "2026-11-03" → "3 de noviembre de 2026"
  function prettyEs(iso) {
    if (!iso) return "";
    var p = String(iso).split("-");
    return parseInt(p[2], 10) + " de " + MESES[parseInt(p[1], 10) - 1] + " de " + p[0];
  }

  // La misma construcción de regla que tools/planner-v2.js.
  function buildRule(s) {
    return {
      value: s.value, dayKind: s.dayKind, dayTypeLabel: s.dayTypeLabel,
      dual: s.dual, clockStart: s.clockStart, status: s.status,
      referralDays: s.referralDays || null,
      absenceExtension: !!s.absenceExtension
    };
  }

  function titleEs(d) {
    switch (d.kind) {
      case "evaluation":
        return d.title.indexOf("federal baseline") !== -1
          ? "Fecha límite de la evaluación inicial (referencia federal)"
          : "Fecha límite de la evaluación inicial";
      case "annual": return "Próxima revisión anual del IEP";
      case "triennial": return "Reevaluación (regla de los 3 años)";
      case "transition": return "La planificación de la transición debe estar en el IEP para esta fecha";
      default: return d.title;
    }
  }

  // La explicación («basis») en español, rama por rama igual que
  // planner-core.js construye la suya en inglés. Las fechas
  // intermedias de los relojes dobles se recalculan con las mismas
  // funciones del núcleo, así que coinciden por construcción.
  function basisEs(core, rule, transition, inputs, d) {
    inputs = inputs || {};
    var absent = parseInt(inputs.absentDays, 10);
    if (!(absent > 0)) absent = 0;
    var label = dayTypeEs(rule ? rule.dayTypeLabel : "");

    if (d.kind === "annual") {
      return "El IEP debe revisarse al menos una vez cada 12 meses (regla federal, 34 CFR 300.324).";
    }
    if (d.kind === "triennial") {
      return "Una reevaluación debe hacerse al menos una vez cada 3 años, a menos que usted y la escuela acuerden por escrito que no es necesaria (regla federal, 34 CFR 300.303).";
    }
    if (d.kind === "transition") {
      var tLabel = transition && transition.label ? transition.label : "";
      return "La planificación de la transición debe estar incluida en el IEP vigente cuando su hijo o hija cumple " +
        tLabel + " años en su estado; por eso normalmente se agrega en la revisión anual justo antes de ese cumpleaños.";
    }
    if (d.kind !== "evaluation") return d.basis || "";

    // evaluation — ¿qué fecha inicia el reloj?
    var evalStart = "", startNote = "";
    var startPhrase = "desde la fecha en que usted firmó el consentimiento";
    if (rule && rule.clockStart === "referral") {
      if (inputs.referralDate) {
        evalStart = inputs.referralDate;
        startPhrase = "desde la fecha en que la escuela recibió la remisión";
      } else if (inputs.startDate) {
        evalStart = inputs.startDate;
        startNote = " Precaución: el reloj de su estado comienza legalmente en la fecha en que la escuela recibe la remisión — que es anterior al consentimiento —, así que la fecha límite real probablemente sea antes que esta estimación. Ingrese la fecha de remisión para ver la cifra exacta.";
      }
    } else if (inputs.startDate) {
      evalStart = inputs.startDate;
    }

    if (rule && rule.clockStart === "dual" && rule.referralDays) {
      var dConsent = inputs.startDate
        ? ((rule.dayKind === "calendar") ? core.addCalendarDays(inputs.startDate, rule.value)
                                         : core.addSchoolDays(inputs.startDate, rule.value))
        : null;
      var dRef = inputs.referralDate ? core.addCalendarDays(inputs.referralDate, rule.referralDays) : null;
      if (dConsent && dRef) {
        return "Su estado usa dos relojes: " + rule.value + " " + label +
          " desde el consentimiento de los padres (" + prettyEs(dConsent) + ") y " + rule.referralDays +
          " días calendario desde la remisión escrita (" + prettyEs(dRef) + "): aplica la fecha más temprana.";
      } else if (dConsent) {
        return rule.value + " " + label + " desde el consentimiento de los padres (el plazo de su estado). Su estado también usa un segundo reloj — " +
          rule.referralDays + " días calendario desde la remisión escrita —; ingrese la fecha de remisión para ver si da una fecha más temprana.";
      }
      return rule.referralDays + " días calendario desde la fecha en que la escuela recibió la remisión escrita (el plazo de su estado). Su estado también usa un reloj desde el consentimiento de los padres: ingrese también la fecha de consentimiento para ver ambos.";
    }
    if (rule && rule.dayKind === "dual" && rule.dual) {
      var dSchool = core.addSchoolDays(evalStart, rule.dual.school_days);
      var dCal = core.addCalendarDays(evalStart, rule.dual.calendar_days);
      return "Su estado fija dos límites: " + rule.dual.school_days + " días escolares (" +
        prettyEs(dSchool) + ") o " + rule.dual.calendar_days + " días calendario (" +
        prettyEs(dCal) + "), y aplica la fecha más temprana. Contado " + startPhrase + "." + startNote;
    }
    if (rule && rule.value != null && rule.dayKind) {
      var absenceNote = "";
      if (rule.absenceExtension && absent > 0 && rule.dayKind !== "calendar") {
        absenceNote = " Esta estimación incluye " + absent + " día" + (absent === 1 ? "" : "s") +
          " escolar" + (absent === 1 ? "" : "es") + " extra porque su hijo o hija se ausentó " + absent +
          " día" + (absent === 1 ? "" : "s") + " durante la evaluación: Texas extiende el plazo por el número de días de ausencia cuando las ausencias llegan a 3 (19 TAC §89.1011).";
      }
      return rule.value + " " + label + " " + startPhrase + " (el plazo de su estado)." + absenceNote + startNote;
    }
    return "60 días calendario desde el consentimiento: la referencia federal de IDEA (34 CFR 300.301). No pudimos verificar el plazo propio de su estado en una fuente oficial; revise la página de su estado y a su Centro de Padres.";
  }

  // La nota bajo el selector de estado (describeState en la versión en
  // inglés), en español.
  function stateNoteEs(s) {
    var clockTxt = s.clockStart === "referral"
      ? "En " + s.name + " el reloj de la evaluación comienza cuando la escuela recibe la remisión."
      : s.clockStart === "dual"
        ? s.name + " usa dos relojes: uno desde el consentimiento y otro desde la remisión."
        : "El reloj comienza en la fecha en que usted firma el consentimiento.";
    return s.name + ": evaluación inicial de " + s.value + " " + dayTypeEs(s.dayTypeLabel) + ". " + clockTxt +
      (s.status !== "verified"
        ? " Todavía estamos verificando de nuevo un detalle de las cifras de este estado: vea la página del estado."
        : "") +
      (s.verifiedOn ? " Reglas verificadas por última vez: " + prettyEs(s.verifiedOn) + "." : "");
  }

  var pure = {
    DAY_TYPE_ES: DAY_TYPE_ES,
    dayTypeEs: dayTypeEs,
    prettyEs: prettyEs,
    buildRule: buildRule,
    titleEs: titleEs,
    basisEs: basisEs,
    stateNoteEs: stateNoteEs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  global.IEPPlannerES = pure;

  // ---------------- cableado de la página (solo navegador) -----------
  if (typeof document === "undefined") return;
  var form = document.getElementById("planner-form");
  if (!form) return;

  var data = global.IEP_STATES;
  var core = global.PlannerCore;
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

  var params = new URLSearchParams(global.location.search);
  var preset = params.get("state");
  if (preset && data[preset.toUpperCase()]) sel.value = preset.toUpperCase();

  function describeState() {
    var s = data[sel.value];
    note.textContent = stateNoteEs(s);
    if (refRow) refRow.hidden = !s.needsReferral;
    if (absRow) absRow.hidden = !s.absenceExtension;
    if (s.clockStart === "referral") {
      if (refHint) refHint.textContent = "Esta fecha inicia el reloj de su estado: aquí importa más que la fecha de consentimiento.";
      startHint.textContent = "Si solo conoce la fecha de consentimiento, ingrésela y la calculadora hará una estimación a partir de ella; pero el reloj real comenzó con la remisión, así que la fecha límite real probablemente sea antes.";
    } else if (s.clockStart === "dual") {
      if (refHint) refHint.textContent = "Su estado también usa un reloj desde la remisión escrita (" + (s.referralDays || 90) + " días): ingrésela para ver la más temprana de las dos fechas.";
      startHint.textContent = "Déjelo en blanco si su hijo o hija ya tiene un IEP y no hay una evaluación nueva pendiente.";
    } else {
      startHint.textContent = "Déjelo en blanco si su hijo o hija ya tiene un IEP y no hay una evaluación nueva pendiente.";
    }
  }
  sel.addEventListener("change", describeState);
  describeState();

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var s = data[sel.value];
    var rule = buildRule(s);
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
    var transition = { months: s.transitionMonths, label: s.transitionLabel };
    var list = core.computeDeadlines(rule, transition, inputs);
    if (!list.length) {
      box.innerHTML = "<div class='panel'><p>Ingrese al menos una fecha arriba y la calculadora calculará las fechas límite que se derivan de ella.</p></div>";
      return;
    }
    if (global.iepTrack) global.iepTrack("planner_complete", sel.value);
    // «Qué sigue»: la guía completa en la calculadora pública (es la
    // superficie gratuita de confianza; la limitación por plan vive
    // solo en la aplicación). Contenido del módulo compartido
    // (assets/what-next-es.js).
    var WN = global.IEPWhatNext;
    function whatNextHtml(d) {
      if (!WN) return "";
      var b = WN.blockFor(d.kind);
      if (!b) return "";
      var steps = b.steps.map(function (st) { return "<li>" + st + "</li>"; }).join("");
      return "<button type='button' class='btn btn-ghost btn-sm wn-toggle' aria-expanded='false'>Qué sigue</button>" +
        "<div class='wn-panel' hidden>" +
        "<p class='basis'>" + b.meaning + "</p>" +
        "<p class='wn-head'>Si esta fecha pasa</p>" +
        "<p class='basis'>" + b.ifPasses + "</p>" +
        "<p class='wn-head'>Pasos que puede dar</p>" +
        "<ol class='wn-steps'>" + steps + "</ol>" +
        "<p class='small'>" + b.cite + "</p>" +
        "<p class='small'>" + WN.DISCLAIMER + "</p>" +
        "</div>";
    }
    var htmlOut = "<h2>Sus fechas límite</h2>";
    list.forEach(function (d) {
      htmlOut += "<div class='deadline'><div>" + titleEs(d) + "</div>" +
        "<div class='when'>" + prettyEs(d.dueISO) + "</div>" +
        "<div class='basis'>" + basisEs(core, rule, transition, inputs, d) +
        (d.approx ? " Contado de lunes a viernes, sin días festivos ni recesos escolares: el calendario de su distrito escolar decide la fecha exacta." : "") +
        "</div>" + whatNextHtml(d) + "</div>";
    });
    htmlOut += "<p class='small'>Ayudas de planificación basadas en reglas publicadas: plazos estimados, no asesoría legal. " +
      "La <a href='states/" + s.slug + ".html'>página de " + s.name + "</a> muestra la fuente oficial de cada cifra." +
      (s.verifiedOn ? " Las cifras de " + s.name + " se verificaron por última vez contra esa fuente el " + prettyEs(s.verifiedOn) + "." : "") +
      "</p>";
    box.innerHTML = htmlOut;
    Array.prototype.forEach.call(box.querySelectorAll(".wn-toggle"), function (btn) {
      btn.addEventListener("click", function () {
        var panel = btn.nextElementSibling;
        if (!panel) return;
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.textContent = open ? "Ocultar" : "Qué sigue";
      });
    });
  });
})(typeof window !== "undefined" ? window : globalThis);
