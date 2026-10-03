import assert from "node:assert/strict";
import test from "node:test";

import { classifyMonthlyCutMentions } from "./monthly-cut";

test("monthly cut classifier creates reusable signal groups across lenses", () => {
  const groups = classifyMonthlyCutMentions([
    {
      id: "mention-1",
      text: "La portabilidad me da miedo porque puedo perder mi numero y soporte tarda.",
      sentiment: -0.5,
      quality: 82
    },
    {
      id: "mention-2",
      text: "Pago mas, pero la cobertura y los datos me rinden mejor.",
      sentiment: 0.2,
      quality: 77
    },
    {
      id: "mention-3",
      text: "La red me da confianza y la marca cumple.",
      sentiment: 0.4,
      quality: 88
    }
  ]);

  assert.deepEqual(
    groups.map((group) => `${group.methodologySlug}:${group.signalType}`).sort(),
    [
      "narrative-ownership:narrative",
      "triggers-barriers:barrier",
      "triggers-barriers:trigger",
      "value-perception-matrix:value"
    ].sort()
  );
  const narrative = groups.find((group) => group.methodologySlug === "narrative-ownership");
  assert.equal(narrative?.mentionIds.length, 1);
  assert.ok(narrative?.matchedTerms.includes("confianza"));
});

test("monthly cut classifier returns empty groups when no pack matches", () => {
  const groups = classifyMonthlyCutMentions([
    { id: "mention-1", text: "Hoy comi pasta y vi una pelicula sin relacion con la marca." }
  ]);

  assert.deepEqual(groups, []);
});
