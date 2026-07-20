import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStudyContextPayload,
  looksLikeStudyContext,
  mergeContextBlock
} from "./study-intake-context";

const laikaDiagnosticExcerpt = `
Laika — Contexto de diagnóstico (para estudio en Noisia)
Documento de contexto. Consolida todo lo analizado en el engagement de Laika.

0. Qué es Laika
E-commerce de mascotas en México. Vende alimento, farmacia, arenas, accesorios y premios.

3. Base de clientes y el problema central de recurrencia
Primer salto a Member sano: ~18%.
Segundo salto roto: solo ~18% de los Members recompra.

9. Calidad de datos — QUÉ FALTA RECONCILIAR
Dos series de ventas rotuladas USD no cuadran. No tratar cifras firmes hasta cerrar moneda,
CAC y funnel app-vs-web.

Notas de uso para el estudio
¿Cómo debería Laika convertir el e-commerce y la membresía en una estrategia rentable de recompra?
Tratar margen, funnel y recompra como hallazgos nuevos que cambian la narrativa.
`;

test("long diagnostic input is promoted from business question into study context", () => {
  assert.equal(looksLikeStudyContext(laikaDiagnosticExcerpt), true);

  const payload = buildStudyContextPayload({
    businessQuestion: laikaDiagnosticExcerpt,
    studyContext: "Brief previo de Discovery.",
    sourceSnapshots: [
      {
        name: "Laika diagnóstico.md",
        kind: "brief",
        text: "Funnel app-vs-web, CAC y margen deben reconciliarse antes de decidir inversión."
      }
    ]
  });

  assert.equal(payload.rawQuestionIsContext, true);
  assert.match(payload.questionCandidate, /Laika convertir el e-commerce/i);
  assert.match(payload.studyContext, /Contexto pegado originalmente en Business Question/);
  assert.match(payload.studyContext, /Laika diagnóstico\.md/);
  assert.match(payload.studyContext, /Brief previo de Discovery/);
});

test("long diagnostic input without an explicit question infers a decision question", () => {
  const diagnosticWithoutQuestion = laikaDiagnosticExcerpt.replace(
    "¿Cómo debería Laika convertir el e-commerce y la membresía en una estrategia rentable de recompra?",
    "Tratar margen, funnel y recompra como hallazgos nuevos que cambian la narrativa."
  );

  const payload = buildStudyContextPayload({
    businessQuestion: diagnosticWithoutQuestion
  });

  assert.equal(payload.rawQuestionIsContext, true);
  assert.match(payload.questionCandidate, /Qué decisiones debe priorizar Laika/i);
  assert.match(payload.questionCandidate, /recompra/i);
  assert.doesNotMatch(payload.questionCandidate, /Contexto de diagn[oó]stico/i);
});

test("short business question stays as the canonical question", () => {
  const payload = buildStudyContextPayload({
    businessQuestion: "¿Qué barreras frenan la recompra de Members de Laika?",
    studyContext: ""
  });

  assert.equal(payload.rawQuestionIsContext, false);
  assert.equal(payload.questionCandidate, "¿Qué barreras frenan la recompra de Members de Laika?");
  assert.equal(payload.studyContext, "");
});

test("mergeContextBlock preserves traceability without duplicating pasted context", () => {
  const first = mergeContextBlock("", "Contexto original", laikaDiagnosticExcerpt);
  const second = mergeContextBlock(first, "Contexto original", laikaDiagnosticExcerpt);

  assert.equal(first, second);
  assert.match(second, /Contexto original/);
});
