/*
 * IEP Year Planner — contenido «Qué sigue» (mirror en español de
 * tools/what-next.js).
 * Datos puros + ayudantes pequeños, sin DOM, sin red. Lo usa la
 * calculadora pública en español (tools/planner-v2-es.js) y
 * tests/spanish-tests.js bajo Node. Canónico en tools/;
 * tools/build-site-v2.py lo copia a site-v2/assets/what-next-es.js —
 * el mismo patrón que planner-core.js.
 *
 * Expone la MISMA API y el MISMO global (IEPWhatNext) que la versión
 * en inglés: una página carga una sola de las dos versiones, nunca
 * ambas, así que el código de renderizado es idéntico en estructura.
 *
 * Un bloque por cada TIPO de fecha límite, igual que los tipos que
 * planner-core.js devuelve de computeDeadlines: "evaluation",
 * "annual", "triennial", "transition". Cada bloque:
 *   meaning  — qué es la fecha límite, en 1–2 frases sencillas.
 *   ifPasses — qué suele pasar si la fecha pasa, en palabras
 *              tranquilas y basadas en hechos. Nunca acusatorio,
 *              nunca una promesa sobre resultados legales.
 *   steps    — 3–4 cosas concretas que un padre o una madre puede
 *              hacer después.
 *   cite     — las reglas federales en que se apoya el bloque
 *              (34 CFR Parte 300), en letra pequeña. Las citas se
 *              quedan en su forma oficial, sin traducir.
 * Cada bloque renderizado termina con DISCLAIMER.
 * Glosario fijo: tools/i18n_es.py.
 */
(function (global) {
  "use strict";

  var DISCLAIMER = "Información general tomada de las reglas federales publicadas — no es asesoría legal.";

  var BLOCKS = {
    evaluation: {
      meaning: "Esta es la fecha para la cual la escuela debe terminar de evaluar a su hijo o hija, contando desde que usted dio su consentimiento por escrito. La evaluación decide si su hijo o hija califica para la educación especial y qué ayuda puede necesitar.",
      ifPasses: "Si la fecha pasa y no hay una evaluación terminada, su hijo o hija sigue esperando: los servicios no pueden comenzar hasta que se decide la elegibilidad. Un plazo vencido no le quita ningún derecho a su hijo o hija, y la escuela sigue obligada a completar la evaluación.",
      steps: [
        "Pregunte por escrito en qué punto está la evaluación — un correo electrónico a la escuela está bien — y guarde una copia con la fecha en que lo envió.",
        "Pida un aviso previo por escrito: la explicación escrita de la escuela sobre lo que propone o se niega a hacer, y por qué.",
        "Comuníquese con el Centro de Padres de su estado (Parent Training and Information Center, PTI): ayuda gratuita e independiente de personas que conocen el proceso local. La página de su estado en este sitio tiene el enlace.",
        "Si escribir no lo resuelve, las reglas federales ofrecen opciones formales: una queja estatal (la agencia estatal por lo general debe decidir dentro de 60 días), la mediación o una audiencia de debido proceso."
      ],
      cite: "Reglas federales: 34 CFR 300.301 (plazo de la evaluación), 300.503 (aviso previo por escrito), 300.504 (garantías procesales), 300.151–153 (quejas estatales), 300.506 (mediación), 300.507 (debido proceso)."
    },
    annual: {
      meaning: "El IEP debe revisarse — y actualizarse cuando haga falta — al menos una vez cada 12 meses. La revisión anual revisa el avance en las metas actuales y fija el plan para el año siguiente.",
      ifPasses: "Si la fecha de revisión pasa, el IEP actual por lo general se mantiene vigente y los servicios continúan bajo ese plan, pero las metas y los servicios pueden quedar desactualizados a medida que su hijo o hija cambia. No tiene que esperar la fecha anual: puede pedir una reunión de revisión en cualquier momento.",
      steps: [
        "Escriba a la escuela pidiendo que se programe la revisión anual, y guarde una copia de su solicitud.",
        "Antes de la reunión, anote qué ha cambiado: avances logrados, nuevas preocupaciones, cualquier cosa a la que las metas actuales ya no se ajusten.",
        "En la reunión usted puede estar de acuerdo o en desacuerdo con partes del plan; pida un aviso previo por escrito de todo lo que la escuela proponga o se niegue a cambiar.",
        "Si usted y la escuela no logran ponerse de acuerdo, las opciones incluyen la mediación, una queja estatal o el debido proceso; su Centro de Padres puede repasarlas con usted, gratis."
      ],
      cite: "Reglas federales: 34 CFR 300.324(b) (revisión al menos una vez al año), 300.503 (aviso previo por escrito), 300.504 (garantías procesales), 300.151–153 (quejas estatales), 300.506 (mediación), 300.507 (debido proceso)."
    },
    triennial: {
      meaning: "Al menos una vez cada 3 años la escuela debe reevaluar: volver a revisar si su hijo o hija todavía califica y qué necesita ahora, a menos que usted y la escuela acuerden por escrito que no hace falta una reevaluación.",
      ifPasses: "Si la fecha de los 3 años pasa, el IEP actual continúa, pero las decisiones pueden basarse en información vieja. Una reevaluación no tiene que esperar la marca de los 3 años: puede pedir una antes si cree que las necesidades de su hijo o hija han cambiado.",
      steps: [
        "Ponga su solicitud por escrito — pedir que se programe la reevaluación, o una antes de tiempo — y guarde una copia. La escuela le pedirá su consentimiento antes de comenzarla.",
        "Comparta todo lo nuevo que el equipo debería tomar en cuenta: informes médicos, cambios en casa, preocupaciones de los maestros, sus propias observaciones.",
        "Si la escuela se niega a hacer una reevaluación que usted pidió, debe explicarle por qué en un aviso previo por escrito.",
        "Si no está de acuerdo con los resultados de la evaluación de la escuela, puede pedir una evaluación educativa independiente; la mediación, las quejas estatales y el debido proceso también siguen disponibles."
      ],
      cite: "Reglas federales: 34 CFR 300.303 (reevaluación), 300.502 (evaluación educativa independiente), 300.503 (aviso previo por escrito), 300.504 (garantías procesales), 300.151–153 (quejas estatales), 300.506 (mediación), 300.507 (debido proceso)."
    },
    transition: {
      meaning: "La planificación de la transición prepara a su hijo o hija para la vida después de la escuela: educación adicional, trabajo y vida independiente. Debe formar parte del IEP vigente cuando su hijo o hija alcanza la edad de transición de su estado.",
      ifPasses: "Si esta fecha pasa sin planificación de la transición en el IEP, el plan está incompleto, pero todavía puede agregarse. Puede pedir una reunión para incluirla en lugar de esperar la próxima revisión anual.",
      steps: [
        "Pida por escrito que la planificación de la transición se agregue en la próxima reunión del IEP: no necesita esperar la revisión anual.",
        "Asegúrese de que su hijo o hija sea invitado a cualquier reunión donde se hable de la transición: la escuela debe invitarlo.",
        "Pregunte qué evaluaciones se usarán para fijar las metas para después de la escuela y qué agencias externas (como rehabilitación vocacional) serán invitadas.",
        "Si la escuela no agrega la planificación de la transición, pida un aviso previo por escrito que explique por qué, y repáselo gratis con su Centro de Padres."
      ],
      cite: "Reglas federales: 34 CFR 300.320(b) (servicios de transición en el IEP), 300.321(b) (quiénes son invitados), 300.503 (aviso previo por escrito), 300.504 (garantías procesales)."
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

  // La fecha límite que un padre o una madre debería mirar primero,
  // de la lista de un niño: la más vencida si alguna ya pasó (es la
  // que más ha esperado); si no, la fecha próxima más cercana. "Hoy"
  // cuenta como próxima, no como vencida. Igual que la noción de
  // «siguiente» de la versión en inglés — computeDeadlines ordena
  // por fecha de vencimiento, así que esta es la primera fila de una
  // lista ordenada — pero no supone que la entrada llegue ordenada
  // y nunca la modifica.
  function pickNextDeadline(deadlines, todayISO) {
    if (!deadlines || !deadlines.length) return null;
    var sorted = deadlines.slice().sort(function (a, b) {
      return a.dueISO < b.dueISO ? -1 : a.dueISO > b.dueISO ? 1 : 0;
    });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].dueISO < todayISO) return sorted[i]; // la más vencida
    }
    return sorted[0]; // la próxima más cercana (o vence hoy)
  }
  // ¿Es `target` la fecha límite elegida como siguiente de la misma
  // lista? Se compara por tipo + fecha de vencimiento, el par que
  // identifica una fila para un niño.
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
