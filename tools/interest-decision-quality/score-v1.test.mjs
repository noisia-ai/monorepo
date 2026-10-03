import assert from "node:assert/strict";
import test from "node:test";
import { scoreInterestDecisionQualityV1 } from "./score-v1.mjs";

const sha = digit => `sha256:${digit.repeat(64)}`;
const annotation = (actor_id, membership, mixed) => ({ actor_id, membership, mixed });
function fixture() {
  const sample_ids = ["case-1", "case-2", "case-3", "case-4", "case-5", "case-6"];
  const truth = [["positive", false], ["positive", true], ["positive", false],
    ["negative", false], ["negative", true], ["negative", false]];
  const verdicts = ["belongs", "belongs", "insufficient", "not_belongs", "not_belongs", "belongs"];
  return { contract_version: "signal-interest-decision-quality-input-v1",
    cohort: { dataset_digest: sha("a"), sample_ids },
    model_artifact_digest: sha("b"), provider_config_digest: sha("c"), prompt_digest: sha("d"),
    thresholds: { contract_version: "signal-interest-decision-platform-quality-v1",
      min_samples: 6, min_positive: 3, min_negative: 3, min_mixed: 2,
      min_precision_bps: 5000, min_recall_bps: 5000, min_specificity_bps: 5000,
      min_mixed_accuracy_bps: 10000, max_insufficient_rate_bps: 2000 },
    labels: sample_ids.map((sample_id, index) => ({ sample_id,
      annotator_a: annotation("reviewer-a", ...truth[index]),
      annotator_b: annotation("reviewer-b", ...truth[index]), adjudication: null })),
    predictions: sample_ids.map((sample_id, index) => ({ sample_id, verdict: verdicts[index],
      request_digest: sha("e"), output_digest: sha("f"), parser_receipt_digest: sha("1"),
      citations: verdicts[index] === "insufficient" ? [] : [{ citation_digest: sha(String(index + 2)),
        role: verdicts[index] === "belongs" ? "supports" : "context",
        literal_valid: true, semantic_valid: true, auditor_id: "citation-reviewer" }] })) };
}

test("scores the exact SQL0211 arithmetic and returns sealed, text-free evidence", () => {
  const input = fixture(), report = scoreInterestDecisionQualityV1(input);
  assert.deepEqual(report.counts, { positive_count: 3, negative_count: 3, mixed_count: 2,
    true_positive: 2, false_positive: 1, false_negative: 0, true_negative: 2,
    positive_insufficient: 1, negative_insufficient: 0, mixed_correct: 2 });
  assert.deepEqual(report.metrics_bps, { precision: 6666, recall: 6666, specificity: 6666,
    mixed_accuracy: 10000, insufficient_rate: 1666 });
  assert.equal(report.quality_pass, true);
  assert.match(report.thresholds_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(report.evaluation_evidence_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(report).includes("case-1"), false, "no individual case appears in the report");
});

test("requires full sealed cohort coverage and independent annotations", () => {
  const missing = fixture(); missing.predictions.pop();
  assert.throws(() => scoreInterestDecisionQualityV1(missing), /coverage_invalid/u);
  const duplicate = fixture(); duplicate.labels[1].sample_id = duplicate.labels[0].sample_id;
  assert.throws(() => scoreInterestDecisionQualityV1(duplicate), /label_duplicate_or_foreign/u);
  const sameAuthor = fixture(); sameAuthor.labels[0].annotator_b.actor_id = "reviewer-a";
  assert.throws(() => scoreInterestDecisionQualityV1(sameAuthor), /same_author/u);
  const disagreement = fixture(); disagreement.labels[0].annotator_b.membership = "negative";
  assert.throws(() => scoreInterestDecisionQualityV1(disagreement), /annotation_invalid/u);
  disagreement.labels[0].adjudication = annotation("reviewer-c", "positive", false);
  assert.equal(scoreInterestDecisionQualityV1(disagreement).quality_pass, true);
});

test("cannot silently accept uncited, unaudited, semantically wrong, or raw-text inputs", () => {
  const noCitation = fixture(); noCitation.predictions[0].citations = [];
  assert.throws(() => scoreInterestDecisionQualityV1(noCitation), /citation_unverified/u);
  const noAudit = fixture(); delete noAudit.predictions[0].citations[0].semantic_valid;
  assert.throws(() => scoreInterestDecisionQualityV1(noAudit), /citation_unverified/u);
  const wrong = fixture(); wrong.predictions[0].citations[0].semantic_valid = false;
  assert.equal(scoreInterestDecisionQualityV1(wrong).quality_pass, false);
  assert.equal(scoreInterestDecisionQualityV1(wrong).citations.invalid_semantic, 1);
  const sameReviewer = fixture(); sameReviewer.predictions[0].citations[0].auditor_id = "reviewer-a";
  assert.equal(scoreInterestDecisionQualityV1(sameReviewer).quality_pass, false);
  const raw = fixture(); raw.predictions[0].citations[0].quote = "private source text";
  assert.throws(() => scoreInterestDecisionQualityV1(raw), /citation_unverified/u);
});

test("insufficient-rate threshold uses the exact fraction, not rounded display basis points", () => {
  const input = fixture(); input.thresholds.max_insufficient_rate_bps = 1666;
  const report = scoreInterestDecisionQualityV1(input);
  assert.equal(report.metrics_bps.insufficient_rate, 1666);
  assert.equal(report.arithmetic_pass, false, "one of six is above 16.66% in SQL arithmetic");
});
