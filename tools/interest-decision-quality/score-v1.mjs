import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const shaPattern = /^sha256:[0-9a-f]{64}$/u;
const verdicts = new Set(["belongs", "not_belongs", "insufficient"]);
const memberships = new Set(["positive", "negative"]);
const roles = new Set(["supports", "contradicts", "context"]);
const thresholdNames = ["min_samples", "min_positive", "min_negative", "min_mixed",
  "min_precision_bps", "min_recall_bps", "min_specificity_bps", "min_mixed_accuracy_bps",
  "max_insufficient_rate_bps"];

function fail(code) { throw new Error(`interest_quality_${code}`); }
function object(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail(code);
}
function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}
// The benchmark thresholds are integer-only JSON, matching SQL0211's
// signal_semantic_context_canonical_json_v2 for these ASCII field names.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  if (typeof value === "number" && !Number.isSafeInteger(value)) fail("noninteger");
  return JSON.stringify(value);
}
function sha(value, code) { if (typeof value !== "string" || !shaPattern.test(value)) fail(code); }
function annotation(value) {
  object(value, ["actor_id", "membership", "mixed"], "annotation_invalid");
  if (typeof value.actor_id !== "string" || !value.actor_id.trim()
    || !memberships.has(value.membership) || typeof value.mixed !== "boolean") fail("annotation_invalid");
}
function validThresholds(value) {
  object(value, ["contract_version", ...thresholdNames], "thresholds_invalid");
  if (value.contract_version !== "signal-interest-decision-platform-quality-v1") fail("thresholds_invalid");
  for (const name of thresholdNames) {
    if (!Number.isSafeInteger(value[name]) || value[name] < (name.startsWith("min_") && !name.endsWith("bps") ? 1 : 0)
      || (name.endsWith("bps") && value[name] > 10_000)) fail("thresholds_invalid");
  }
}

/** Scores metadata only. No source text, quote, URL, author name or PII is accepted. */
export function scoreInterestDecisionQualityV1(input) {
  object(input, ["contract_version", "cohort", "labels", "predictions", "thresholds",
    "model_artifact_digest", "provider_config_digest", "prompt_digest"], "input_invalid");
  if (input.contract_version !== "signal-interest-decision-quality-input-v1") fail("input_invalid");
  for (const key of ["model_artifact_digest", "provider_config_digest", "prompt_digest"]) sha(input[key], "model_identity_invalid");
  object(input.cohort, ["dataset_digest", "sample_ids"], "cohort_invalid");
  sha(input.cohort.dataset_digest, "cohort_invalid");
  const ids = input.cohort.sample_ids;
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !id.trim())
    || new Set(ids).size !== ids.length || ids.join("\0") !== [...ids].sort().join("\0")) fail("cohort_invalid");
  if (!Array.isArray(input.labels) || !Array.isArray(input.predictions)) fail("coverage_invalid");
  validThresholds(input.thresholds);
  const labelById = new Map(), predictionById = new Map();
  for (const label of input.labels) {
    object(label, ["sample_id", "annotator_a", "annotator_b", "adjudication"], "label_invalid");
    annotation(label.annotator_a); annotation(label.annotator_b);
    if (label.annotator_a.actor_id === label.annotator_b.actor_id) fail("same_author");
    const agree = label.annotator_a.membership === label.annotator_b.membership
      && label.annotator_a.mixed === label.annotator_b.mixed;
    if (agree && label.adjudication !== null) fail("adjudication_invalid");
    if (!agree) {
      annotation(label.adjudication);
      if ([label.annotator_a.actor_id, label.annotator_b.actor_id].includes(label.adjudication.actor_id)) fail("same_author");
    }
    if (!ids.includes(label.sample_id) || labelById.has(label.sample_id)) fail("label_duplicate_or_foreign");
    labelById.set(label.sample_id, label);
  }
  for (const prediction of input.predictions) {
    object(prediction, ["sample_id", "verdict", "request_digest", "output_digest",
      "parser_receipt_digest", "citations"], "prediction_invalid");
    if (!ids.includes(prediction.sample_id) || predictionById.has(prediction.sample_id)) fail("prediction_duplicate_or_foreign");
    if (!verdicts.has(prediction.verdict) || !Array.isArray(prediction.citations)) fail("prediction_invalid");
    for (const key of ["request_digest", "output_digest", "parser_receipt_digest"]) sha(prediction[key], "prediction_unverified");
    const seenCitations = new Set();
    for (const citation of prediction.citations) {
      object(citation, ["citation_digest", "role", "literal_valid", "semantic_valid", "auditor_id"], "citation_unverified");
      sha(citation.citation_digest, "citation_unverified");
      if (seenCitations.has(citation.citation_digest) || !roles.has(citation.role)
        || typeof citation.literal_valid !== "boolean" || typeof citation.semantic_valid !== "boolean"
        || typeof citation.auditor_id !== "string" || !citation.auditor_id.trim()) fail("citation_unverified");
      seenCitations.add(citation.citation_digest);
    }
    if (prediction.verdict === "belongs" && !prediction.citations.some(c => c.role === "supports")
      || prediction.verdict === "not_belongs" && !prediction.citations.some(c => c.role === "contradicts" || c.role === "context"))
      fail("citation_unverified");
    predictionById.set(prediction.sample_id, prediction);
  }
  if (labelById.size !== ids.length || predictionById.size !== ids.length) fail("coverage_invalid");

  const counts = { positive_count: 0, negative_count: 0, mixed_count: 0,
    true_positive: 0, false_positive: 0, false_negative: 0, true_negative: 0,
    positive_insufficient: 0, negative_insufficient: 0, mixed_correct: 0 };
  const citations = { total: 0, invalid_literal: 0, invalid_semantic: 0, unaudited_independently: 0 };
  for (const id of ids) {
    const label = labelById.get(id), prediction = predictionById.get(id);
    const gold = label.adjudication ?? label.annotator_a;
    const positive = gold.membership === "positive";
    counts[positive ? "positive_count" : "negative_count"]++;
    if (gold.mixed) counts.mixed_count++;
    for (const citation of prediction.citations) {
      citations.total++;
      if (!citation.literal_valid) citations.invalid_literal++;
      if (!citation.semantic_valid) citations.invalid_semantic++;
      if ([label.annotator_a.actor_id, label.annotator_b.actor_id, label.adjudication?.actor_id]
        .includes(citation.auditor_id)) citations.unaudited_independently++;
    }
    if (prediction.verdict === "insufficient") counts[positive ? "positive_insufficient" : "negative_insufficient"]++;
    else if (positive) counts[prediction.verdict === "belongs" ? "true_positive" : "false_negative"]++;
    else counts[prediction.verdict === "not_belongs" ? "true_negative" : "false_positive"]++;
    if (gold.mixed && (positive ? prediction.verdict === "belongs" : prediction.verdict === "not_belongs")
      && prediction.citations.length && prediction.citations.every(c => c.literal_valid && c.semantic_valid)
      && !prediction.citations.some(c => [label.annotator_a.actor_id, label.annotator_b.actor_id,
        label.adjudication?.actor_id].includes(c.auditor_id))) counts.mixed_correct++;
  }
  const sampleCount = counts.positive_count + counts.negative_count;
  const ratioBps = (num, den) => den ? Math.floor(num * 10_000 / den) : null;
  const metrics_bps = { precision: ratioBps(counts.true_positive, counts.true_positive + counts.false_positive),
    recall: ratioBps(counts.true_positive, counts.positive_count),
    specificity: ratioBps(counts.true_negative, counts.negative_count),
    mixed_accuracy: ratioBps(counts.mixed_correct, counts.mixed_count),
    insufficient_rate: ratioBps(counts.positive_insufficient + counts.negative_insufficient, sampleCount) };
  const t = input.thresholds;
  // Compare the original fractions. Flooring the displayed basis points would
  // make a just-over-limit insufficient rate appear to pass SQL0211's guard.
  const meetsMinimum = (numerator, denominator, minimum) => denominator > 0
    && numerator * 10_000 >= denominator * minimum;
  const meetsMaximum = (numerator, denominator, maximum) => denominator > 0
    && numerator * 10_000 <= denominator * maximum;
  const arithmetic_pass = sampleCount >= t.min_samples && counts.positive_count >= t.min_positive
    && counts.negative_count >= t.min_negative && counts.mixed_count >= t.min_mixed
    && meetsMinimum(counts.true_positive, counts.true_positive + counts.false_positive, t.min_precision_bps)
    && meetsMinimum(counts.true_positive, counts.positive_count, t.min_recall_bps)
    && meetsMinimum(counts.true_negative, counts.negative_count, t.min_specificity_bps)
    && meetsMinimum(counts.mixed_correct, counts.mixed_count, t.min_mixed_accuracy_bps)
    && meetsMaximum(counts.positive_insufficient + counts.negative_insufficient,
      sampleCount, t.max_insufficient_rate_bps);
  const labels = ids.map(id => labelById.get(id));
  const predictions = ids.map(id => predictionById.get(id));
  const body = { contract_version: "signal-interest-decision-quality-report-v1",
    dataset_digest: input.cohort.dataset_digest, cohort_digest: hash(input.cohort),
    labels_digest: hash(labels), predictions_digest: hash(predictions),
    model_artifact_digest: input.model_artifact_digest,
    provider_config_digest: input.provider_config_digest, prompt_digest: input.prompt_digest,
    thresholds: input.thresholds, thresholds_digest: hash(input.thresholds), sample_count: sampleCount,
    counts, metrics_bps, citations, arithmetic_pass,
    quality_pass: arithmetic_pass && citations.invalid_literal === 0
      && citations.invalid_semantic === 0 && citations.unaudited_independently === 0 };
  return { ...body, evaluation_evidence_digest: hash(body) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) fail("usage_input_json_required");
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  process.stdout.write(`${JSON.stringify(scoreInterestDecisionQualityV1(input), null, 2)}\n`);
}
