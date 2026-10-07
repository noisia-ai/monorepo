import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHybridClaudeRequestV1, buildHybridJevQuestionV1, decideHybridMembershipV1, mapHybridJevAnswerV1, parseHybridClaudeAnswerV1 } from "./signal-hybrid-membership-v1";
import type { ConceptForJudgeV1, MembershipInputV1 } from "./signal-concept-membership-v1";

const text = "The customer rented a car after the flight.";
const quote = { quote: "rented a car", start: 13, end: 25 };
const jev = { verdict: "belongs" as const, probability: 0.4, citation: quote };

test("H1 requires Claude only for JEV positives and an exact literal citation for agreement", () => {
  assert.deepEqual(decideHybridMembershipV1(text, { ...jev, verdict: "not_belongs", probability: 0.3999 }, null), {
    verdict: "not_belongs", needs_claude: false, jev: { ...jev, verdict: "not_belongs", probability: 0.3999 }, claude: null,
  });
  assert.equal(decideHybridMembershipV1(text, jev, null).verdict, "pending");
  assert.equal(decideHybridMembershipV1(text, jev, { verdict: "belongs", citation: quote }).verdict, "belongs");
  assert.equal(decideHybridMembershipV1(text, jev, { verdict: "belongs", citation: { ...quote, quote: "fabricated" } }).verdict, "error");
});

test("H1 disagreement is review_required with both literal sources, never a served verdict", () => {
  for (const verdict of ["not_belongs", "insufficient"] as const) {
    const result = decideHybridMembershipV1(text, jev, { verdict, citation: quote });
    assert.equal(result.verdict, "review_required");
    assert.equal(result.jev.citation?.quote, quote.quote);
    assert.equal(result.claude?.citation?.quote, quote.quote);
  }
  assert.equal(decideHybridMembershipV1(text, jev, { verdict: "refused", citation: null }).verdict, "refused");
  assert.equal(decideHybridMembershipV1(text, { verdict: "error", probability: null, citation: null }, null).verdict, "error");
});

const concept = { concept_key: "rental_cars", label: "Rental cars", scope: "all_conversations",
  definition: "A completed car rental", inclusion: ["completed rental"], exclusion: ["flights only"],
  positive_examples: [], negative_examples: [], definition_digest: `sha256:${"a".repeat(64)}` } as ConceptForJudgeV1;
const input = { root_id: "11111111-1111-4111-8111-111111111111", input_digest: "sha256:x",
  root_fingerprint: "sha256:y", entity_context_digest: "sha256:z", effective_entities_digest: "sha256:q",
  text, title: null, platform: null, content_type: null, author: null, published_at: "2026-01-01", language: "en",
  entities: [], voice: null, act: null, evaluated_concepts: [concept] } as MembershipInputV1;

test("JEV noul threshold is frozen and Claude references must resolve to a source span", () => {
  const request = buildHybridJevQuestionV1(input, concept);
  assert.equal(request.questions.membership?.type, "noul");
  const answer = mapHybridJevAnswerV1(input, { model: "jev-1.13.0", usage: { input_tokens: 1, output_tokens: 0 },
    answers: { membership: { type: "noul", noul: 0.4 } } });
  assert.equal(answer.verdict, "belongs");
  assert.equal(answer.citation?.quote, text);
  const claudeRequest = buildHybridClaudeRequestV1(input, concept, { entities: [] } as never);
  const content = JSON.parse(claudeRequest.messages[0]!.content);
  const span = content.mention.spans[0];
  const valid = parseHybridClaudeAnswerV1(input, JSON.stringify({ contract_version: "mfp-hybrid-claude-confirm-v1",
    verdict: "not_belongs", rationale: "Contrary context", span_id: span.span_id }));
  assert.equal(valid.verdict, "not_belongs");
  assert.equal(valid.citation?.quote, span.text);
  assert.equal(parseHybridClaudeAnswerV1(input, JSON.stringify({ contract_version: "mfp-hybrid-claude-confirm-v1",
    verdict: "belongs", rationale: "Invented", span_id: "other-root" })).verdict, "error");
});
