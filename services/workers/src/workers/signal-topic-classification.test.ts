import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSignalTopicEmbeddingTextV1,
  buildSignalTopicNegativeEmbeddingTextV1,
  type SignalTopicDefinitionV1
} from "@noisia/query-engine";

import { canClaimSignalTopicExecutionV1 } from "./signal-topic-execution";

const topic: SignalTopicDefinitionV1 = {
  term_key: "delivery_friction",
  label: "Problemas de entrega",
  definition: "Experiencias donde la entrega tarda, falla o llega incompleta.",
  scope: "primary_brand",
  inclusion: ["pedido retrasado"],
  exclusion: ["entrega de premios"],
  positive_examples: ["Mi pedido lleva una semana tarde"],
  negative_examples: ["La ceremonia entregó premios"],
  lifecycle: "draft",
  origin: "manual",
  source: null,
  definition_revision: 1,
  definition_digest: `sha256:${"a".repeat(64)}`,
  created_at: "2026-09-07T12:00:00.000Z",
  updated_at: "2026-09-07T12:00:00.000Z"
};

test("topic embeddings separate positive meaning, inherited context and negative boundaries", () => {
  const before = buildSignalTopicEmbeddingTextV1(topic, "Marca de ecommerce en México");
  const after = buildSignalTopicEmbeddingTextV1({ ...topic, label: "Entrega y pedidos" },
    "Marca de ecommerce en México");
  assert.equal(after, before);
  assert.match(before, /Experiencias donde la entrega/u);
  assert.match(before, /Positive examples: Mi pedido lleva una semana tarde/u);
  assert.match(before, /Brand context: Marca de ecommerce en México/u);
  assert.doesNotMatch(before, /entrega de premios|La ceremonia entregó premios/u);
  assert.doesNotMatch(before, /Problemas de entrega/u);
  const negative = buildSignalTopicNegativeEmbeddingTextV1(topic);
  assert.match(negative, /Excluded meanings: entrega de premios/u);
  assert.match(negative, /Negative examples: La ceremonia entregó premios/u);
});

test("only a BullMQ retry may reclaim an execution left running by an interrupted worker", () => {
  assert.equal(canClaimSignalTopicExecutionV1("queued", false), true);
  assert.equal(canClaimSignalTopicExecutionV1("failed", false), true);
  assert.equal(canClaimSignalTopicExecutionV1("running", false), false);
  assert.equal(canClaimSignalTopicExecutionV1("running", true), true);
  assert.equal(canClaimSignalTopicExecutionV1("completed", true), false);
});

test("paid definition embeddings are budgeted and fail closed after an uncertain provider outcome", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  assert.match(source, /embedding_cost_cap_micro_usd/u);
  assert.match(source, /estimateSignalTopicEmbeddingCostMicroUsdV1/u);
  assert.match(source, /pricing_version,request_digest,input_digests/u);
  assert.match(source, /input_digests && \$3::text\[\]/u);
  assert.doesNotMatch(source, /SIGNAL_TOPIC_EMBEDDING_HARD_CAP_MICRO_USD/u);
  assert.match(source, /signal_topic_embedding_calls/u);
  assert.ok(source.indexOf("status='sent_unknown'") < source.indexOf("await embedTexts"));
  assert.match(source, /topic_embedding_outcome_unknown/u);
  assert.match(source, /settled_micro_usd=reserved_micro_usd/u);
});

test("calibrated publication versions authorities when their governed definition changes", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  assert.match(source, /catalog_definition_digest: execution\.definition_digest/u);
  assert.match(source, /SELECT id::text,version,definition_hash,status FROM signal_labeling_function_versions/u);
  assert.match(source, /functionVersion = Number\(priorFunction\?\.version \?\? 0\) \+ 1/u);
  assert.match(source, /policyVersion = Number\(priorPolicy\?\.version \?\? 0\) \+ 1/u);
  assert.match(source, /priorPolicy\.labeling_function_version_id === labelingFunction\.labeling_function_version_id/u);
});

test("unvalidated semantic and lexical retrieval stays doubtful until an operator or policy approves it", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  const classify = source.slice(source.indexOf("function classifySuggestion"),
    source.indexOf("async function claimExecution"));
  assert.match(classify, /calibratedThreshold !== null && score >= args\.calibratedThreshold\) disposition = "relevant"/u);
  assert.match(classify, /lexical\.matched \|\| \(score !== null && score >= DOUBT_RETRIEVAL_SCORE\)\) disposition = "doubt"/u);
  assert.doesNotMatch(classify, /RELEVANT_RETRIEVAL_SCORE\)\) disposition = "relevant"/u);
});

test("publication revalidates the exact snapshot and supersedes same-profile generations", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
  assert.ok(source.indexOf("const currentSnapshot = await verifyExecutionSnapshot")
    < source.indexOf("SELECT complete_signal_topic_catalog_profile_v1"));
  assert.match(source, /currentSnapshot\.population_digest/u);
  assert.match(source, /ORDER BY generation_version DESC,id DESC LIMIT 1/u);
  assert.match(source, /supersedesGenerationId/u);
  assert.match(source, /generation_version: generationVersion, supersedes_generation_id/u);
});

test("publication becomes completed only after governed Signal materialization has a topic receipt", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  assert.match(source, /signalMaterializationJob/u);
  assert.match(source, /topic-catalog-signal-materialization-v1/u);
  assert.match(source, /INSERT INTO record_feature_values/u);
  assert.match(source, /topic_processed_marker_count_mismatch/u);
  assert.match(source, /metric_key='topic\.volume'/u);
  assert.match(source, /usable_topic_volume_rows/u);
  assert.match(source, /signal_topic_volume_rows/u);
  assert.match(source, /empty_topic_volume_rows/u);
  assert.match(source, /active_topic_count === 0/u);
  const materialize = source.slice(source.indexOf("async function materializePublicationInSignal"),
    source.indexOf("function classifySuggestion"));
  assert.ok(materialize.indexOf("await signalMaterializationJob")
    < materialize.indexOf("SET status='completed',progress=100"));
  assert.match(source, /signalMaterializationJob\(\{ data \} as Job<SignalMaterializeJobDataV1>, client\)/u);
  assert.match(source, /const completion = await materializePublicationInSignal\(execution, receipt, client\);\s+await client\.query\("COMMIT"\)/u);
  assert.doesNotMatch(source, /function publicationReceipt/u);
});

test("catalog activation, projection, Signal rows and execution completion share one transaction", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  const project = source.slice(source.indexOf("async function projectPublication"),
    source.indexOf("async function materializePublicationInSignal"));
  const begin = project.indexOf('await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")');
  const activation = project.indexOf("SELECT complete_signal_topic_catalog_profile_v1");
  const materialization = project.indexOf("await materializePublicationInSignal");
  const commit = project.indexOf('await client.query("COMMIT")');
  assert.ok(begin >= 0 && begin < activation && activation < materialization && materialization < commit);
});

test("publication rejects scopes without a governed Signal output", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  assert.match(source, /activeTopics\.some\(\(topic\) => topic\.definition\.scope !== "primary_brand"\)/u);
  assert.match(source, /throw new Error\("topic_signal_scope_unsupported"\)/u);
});

test("classification authority shares the database transaction timestamp", async () => {
  const source = await readFile(new URL("./signal-topic-classification.ts", import.meta.url), "utf8");
  const register = source.slice(source.indexOf("async function registerCalibratedAuthorities"),
    source.indexOf("async function loadRoots"));
  assert.match(register, /SELECT transaction_timestamp\(\)::text effective_from/u);
  assert.doesNotMatch(register, /const effectiveFrom = new Date\(\)/u);
});
