import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { anthropic } from "@ai-sdk/anthropic";
import {
  loadSignalSemanticResolutionGovernedContextV1,
  loadSignalSemanticReviewQueueV1,
  type SignalSemanticResolutionMentionContextV1,
  type SignalSemanticReviewQueueItemV1
} from "@noisia/db";
import {
  estimateSignalSemanticResolutionCostV1,
  SIGNAL_SEMANTIC_RESOLUTION_DEFAULT_MODEL,
  type SignalSemanticResolutionDecisionV1
} from "@noisia/query-engine";
import { config as loadEnv } from "dotenv";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import pg from "pg";

import { estimateModelCostUsd, positiveTokenInteger } from "../src/workers/engine-cost";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../../..");
loadEnv({ path: resolve(REPOSITORY_ROOT, "apps/studio/.env.local"), override: false });

const EVIDENCE_DIRECTORY = resolve(REPOSITORY_ROOT, ".data/signal-semantic-resolution-qa");
const PRIVATE_EVIDENCE_PATH = resolve(EVIDENCE_DIRECTORY, "readonly-private.json");
const REDACTED_EVIDENCE_PATH = resolve(EVIDENCE_DIRECTORY, "readonly-summary.json");
const FAILURE_EVIDENCE_PATH = resolve(EVIDENCE_DIRECTORY, "readonly-structure-failure-private.json");
const COST_CAP_USD = 5;
const PRIOR_ATTEMPT_COST_RESERVE_USD = 1;
const RUN_COST_CAP_USD = COST_CAP_USD - PRIOR_ATTEMPT_COST_RESERVE_USD;
const EXPECTED_CANDIDATES = 178;
const EXPECTED_UNRESOLVED = 551;
const MODEL = process.env.ANTHROPIC_MODEL_DEFAULT?.trim() || SIGNAL_SEMANTIC_RESOLUTION_DEFAULT_MODEL;

type QaGroup = "candidate" | "unresolved";
type QaBatch = {
  batch_id: string;
  group: QaGroup;
  records: SignalSemanticReviewQueueItemV1[];
};

type BatchEvidence = {
  batch_id: string;
  group: QaGroup;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  records: Array<{
    sample_key: string;
    queue_item: SignalSemanticReviewQueueItemV1;
    mention_context: SignalSemanticResolutionMentionContextV1;
    decision: SignalSemanticResolutionDecisionV1;
    exact_candidate_agreement: boolean | null;
    contract_issues: string[];
  }>;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");
  const {
    buildSignalSemanticResolutionPromptV1,
    mapSignalSemanticResolutionModelOutputV1,
    signalSemanticResolutionModelOutputSchemaV1
  } = await import(
    "../src/workers/signal-semantic-resolution-contract"
  );

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: databaseSslConfig(),
    statement_timeout: 600_000,
    application_name: "signal-semantic-resolution-readonly-qa"
  });
  const client = await pool.connect();
  let transactionOpen = false;
  let governedContext: Awaited<ReturnType<typeof loadSignalSemanticResolutionGovernedContextV1>>;
  let candidateItems: SignalSemanticReviewQueueItemV1[];
  let unresolvedItems: SignalSemanticReviewQueueItemV1[];
  let mentionContexts: SignalSemanticResolutionMentionContextV1[];

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const workspaceResult = await client.query<{ workspace_id: string; brand_slug: string }>(`
      SELECT workspace.id::text AS workspace_id, brand.slug AS brand_slug
      FROM signal_workspaces workspace
      JOIN brands brand ON brand.id = workspace.brand_id
      WHERE lower(brand.slug) = 'laika'
        AND workspace.status = 'active'
        AND brand.status = 'active'
      ORDER BY workspace.created_at, workspace.id
    `);
    if (workspaceResult.rowCount !== 1) throw new Error("Expected exactly one active Laika workspace.");
    const workspaceId = workspaceResult.rows[0]!.workspace_id;

    governedContext = await loadSignalSemanticResolutionGovernedContextV1(client, workspaceId);
    candidateItems = await loadAllQueueRecords(client, workspaceId, "candidate_pending");
    unresolvedItems = await loadAllQueueRecords(client, workspaceId, "unresolved");
    if (candidateItems.length !== EXPECTED_CANDIDATES || unresolvedItems.length !== EXPECTED_UNRESOLVED) {
      throw new Error(
        `Review queue changed: expected ${EXPECTED_CANDIDATES}/${EXPECTED_UNRESOLVED}, found ${candidateItems.length}/${unresolvedItems.length}.`
      );
    }

    const candidateSample = stratifiedSample(candidateItems, 30, "candidate-readonly-qa-v1");
    const unresolvedSample = stratifiedSample(unresolvedItems, 90, "unresolved-readonly-qa-v1");
    const selectedIds = [...candidateSample, ...unresolvedSample].map((item) => item.mention_id);
    mentionContexts = await loadMentionContexts(client, workspaceId, selectedIds);
    if (mentionContexts.length !== selectedIds.length) {
      throw new Error(`Expected ${selectedIds.length} mention contexts, found ${mentionContexts.length}.`);
    }
    await client.query("ROLLBACK");
    transactionOpen = false;

    const batches: QaBatch[] = [
      ...chunk(candidateSample, 10).map((records, index) => ({
        batch_id: `candidate-${index + 1}`,
        group: "candidate" as const,
        records
      })),
      ...chunk(unresolvedSample, 30).map((records, index) => ({
        batch_id: `unresolved-${index + 1}`,
        group: "unresolved" as const,
        records
      }))
    ];
    if (batches.length !== 6) throw new Error("Expected exactly six QA batches.");

    const contextById = new Map(mentionContexts.map((mention) => [mention.mention_id, mention]));
    const estimates = batches.map((batch) => estimateBatchCost(
      batch.records.map((record) => requiredContext(contextById, record.mention_id)),
      governedContext
    ));
    const totalEstimate = roundUsd(estimates.reduce((sum, estimate) => sum + estimate, 0));
    if (totalEstimate > RUN_COST_CAP_USD) {
      throw new Error(`Conservative estimate ${totalEstimate} exceeds the remaining USD ${RUN_COST_CAP_USD} cap.`);
    }

    const allowedEntityIds = governedEntityIds(governedContext);
    const evidence: BatchEvidence[] = [];
    let actualCostUsd = 0;
    for (const [index, batch] of batches.entries()) {
      const mentions = batch.records.map((record) => requiredContext(contextById, record.mention_id));
      if (actualCostUsd + estimates[index]! > RUN_COST_CAP_USD) {
        throw new Error(`Next batch could exceed the remaining USD ${RUN_COST_CAP_USD} cap.`);
      }
      const startedAt = Date.now();
      let response;
      try {
        response = await generateText({
          model: anthropic(MODEL),
          output: Output.object({
            schema: signalSemanticResolutionModelOutputSchemaV1,
            name: "signal_semantic_resolution_readonly_qa",
            description: "Read-only quality audit of governed Signal semantic classifications."
          }),
          prompt: buildSignalSemanticResolutionPromptV1({ governedContext, mentions }),
          temperature: 0,
          maxRetries: 0,
          maxOutputTokens: 7_000
        });
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) {
          await mkdir(EVIDENCE_DIRECTORY, { recursive: true, mode: 0o700 });
          const inputTokens = positiveTokenInteger(error.usage?.inputTokens);
          const outputTokens = positiveTokenInteger(error.usage?.outputTokens);
          const failedCost = estimateModelCostUsd({
            provider: "anthropic",
            model: MODEL,
            inputTokens,
            outputTokens
          });
          await writeFile(FAILURE_EVIDENCE_PATH, `${JSON.stringify({
            batch_id: batch.batch_id,
            model: MODEL,
            finish_reason: error.finishReason,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            estimated_actual_cost_usd: failedCost,
            error: error.message,
            cause: error.cause instanceof Error ? error.cause.message : null,
            raw_text: error.text,
            writes_performed: false
          }, null, 2)}\n`, { mode: 0o600 });
          await chmod(FAILURE_EVIDENCE_PATH, 0o600);
        }
        throw error;
      }
      const decisions = reconcileDecisions(
        mapSignalSemanticResolutionModelOutputV1(response.output, governedContext),
        mentions.map((mention) => mention.mention_id)
      );
      const contractIssues = decisionContractIssues(
        [...decisions.values()],
        allowedEntityIds,
        governedContext.workspace.brand_id
      );
      const inputTokens = positiveTokenInteger(response.totalUsage.inputTokens);
      const outputTokens = positiveTokenInteger(response.totalUsage.outputTokens);
      const batchCost = estimateModelCostUsd({
        provider: "anthropic",
        model: MODEL,
        inputTokens,
        outputTokens
      });
      if (batchCost === null) throw new Error(`Pricing unavailable for model ${MODEL}.`);
      actualCostUsd = roundUsd(actualCostUsd + batchCost);
      if (actualCostUsd > RUN_COST_CAP_USD) throw new Error(`Actual cost exceeded remaining USD ${RUN_COST_CAP_USD}.`);

      evidence.push({
        batch_id: batch.batch_id,
        group: batch.group,
        estimated_cost_usd: estimates[index]!,
        actual_cost_usd: batchCost,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        duration_ms: Date.now() - startedAt,
        records: batch.records.map((queueItem) => ({
          sample_key: sha256(queueItem.mention_id),
          queue_item: queueItem,
          mention_context: requiredContext(contextById, queueItem.mention_id),
          decision: decisions.get(queueItem.mention_id)!,
          exact_candidate_agreement: batch.group === "candidate"
            ? exactCandidateAgreement(queueItem, decisions.get(queueItem.mention_id)!)
            : null,
          contract_issues: contractIssues.get(queueItem.mention_id) ?? []
        }))
      });
      await writeEvidence({
        status: "running",
        model: MODEL,
        cost_cap_usd: COST_CAP_USD,
        prior_attempt_cost_reserve_usd: PRIOR_ATTEMPT_COST_RESERVE_USD,
        total_estimated_cost_usd: totalEstimate,
        actual_cost_usd: actualCostUsd,
        writes_performed: false,
        batches: evidence
      }, governedContext);
    }

    const summary = summarizeEvidence({
      model: MODEL,
      estimatedCostUsd: totalEstimate,
      actualCostUsd,
      candidatePopulation: candidateItems.length,
      unresolvedPopulation: unresolvedItems.length,
      evidence
    });
    await writeEvidence({
      status: "completed",
      ...summary,
      writes_performed: false,
      batches: evidence
    }, governedContext);
    console.log(JSON.stringify({
      ok: true,
      status: "completed",
      writes_performed: false,
      model: MODEL,
      sample: { candidate: 30, unresolved: 90, total: 120, batches: 6 },
      queue: { candidate: candidateItems.length, unresolved: unresolvedItems.length },
      estimated_cost_usd: totalEstimate,
      actual_cost_usd: actualCostUsd,
      candidate_exact_agreement: summary.candidate_exact_agreement,
      classification_counts: summary.classification_counts,
      low_confidence_classifications: summary.low_confidence_classifications,
      multi_entity_mentions: summary.multi_entity_mentions,
      private_evidence_path: PRIVATE_EVIDENCE_PATH,
      redacted_evidence_path: REDACTED_EVIDENCE_PATH
    }));
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function loadAllQueueRecords(
  client: pg.PoolClient,
  workspaceId: string,
  state: "candidate_pending" | "unresolved"
) {
  const records: SignalSemanticReviewQueueItemV1[] = [];
  let cursor: string | null = null;
  do {
    const page = await loadSignalSemanticReviewQueueV1(client, {
      workspace_id: workspaceId,
      filters: { state },
      cursor,
      limit: 100
    });
    records.push(...page.records);
    cursor = page.page.next_cursor;
  } while (cursor);
  return records;
}

async function loadMentionContexts(
  client: pg.PoolClient,
  workspaceId: string,
  mentionIds: string[]
) {
  const result = await client.query<SignalSemanticResolutionMentionContextV1>(`
    SELECT mention.id::text AS mention_id,
      mention.published_at::text,
      COALESCE(mention.resolved_platform, mention.platform) AS platform,
      mention.title,
      mention.text_clean AS text,
      COALESCE(
        mention.raw_metadata->>'thread_context',
        mention.raw_metadata->>'root_post_text',
        mention.raw_metadata->>'parent_text'
      ) AS thread_context,
      author.handle AS author_handle,
      author.display_name AS author_name,
      COALESCE(source.name, 'Unknown source') AS source_name,
      concat_ws(':', intent.scope, intent.entity_label) AS source_intent,
      NULL::jsonb AS prepared_decision
    FROM mentions mention
    LEFT JOIN authors author ON author.id = mention.author_id
    LEFT JOIN LATERAL (
      SELECT attribution.data_source_id, attribution.scope, attribution.entity_label
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = mention.workspace_id
        AND attribution.mention_id = mention.id
        AND attribution.attribution_basis = 'source_intent'
      ORDER BY attribution.created_at, attribution.id
      LIMIT 1
    ) intent ON true
    LEFT JOIN data_sources source ON source.id = intent.data_source_id
    WHERE mention.workspace_id = $1::uuid
      AND mention.canonical_mention_id = mention.id
      AND mention.id = ANY($2::uuid[])
    ORDER BY mention.published_at DESC, mention.id
  `, [workspaceId, mentionIds]);
  return result.rows;
}

function stratifiedSample(items: SignalSemanticReviewQueueItemV1[], count: number, seed: string) {
  const strata = new Map<string, SignalSemanticReviewQueueItemV1[]>();
  for (const item of items) {
    const proposed = item.proposed_assertions
      .map((candidate) => `${candidate.scope}:${candidate.confidence_band}`)
      .sort()
      .join("+") || "none";
    const intent = item.source_intent
      .map((source) => `${source.scope}:${source.source_name}`)
      .sort()
      .join("+") || "none";
    const key = `${item.platform}|${proposed}|${intent}`;
    const stratum = strata.get(key) ?? [];
    stratum.push(item);
    strata.set(key, stratum);
  }
  for (const [key, stratum] of strata) {
    stratum.sort((left, right) => sha256(`${seed}:${key}:${left.mention_id}`).localeCompare(
      sha256(`${seed}:${key}:${right.mention_id}`)
    ));
  }
  const selected: SignalSemanticReviewQueueItemV1[] = [];
  const orderedKeys = [...strata.keys()].sort((left, right) => sha256(`${seed}:${left}`).localeCompare(sha256(`${seed}:${right}`)));
  while (selected.length < count) {
    let progressed = false;
    for (const key of orderedKeys) {
      const item = strata.get(key)?.shift();
      if (!item) continue;
      selected.push(item);
      progressed = true;
      if (selected.length === count) break;
    }
    if (!progressed) break;
  }
  if (selected.length !== count) throw new Error(`Could only sample ${selected.length} of ${count} records.`);
  return selected;
}

function estimateBatchCost(
  mentions: SignalSemanticResolutionMentionContextV1[],
  context: Awaited<ReturnType<typeof loadSignalSemanticResolutionGovernedContextV1>>
) {
  return estimateSignalSemanticResolutionCostV1({
    mention_count: mentions.length,
    mention_character_count: mentions.reduce((sum, mention) => sum + JSON.stringify(mention).length, 0),
    context_character_count: JSON.stringify(context).length,
    batch_size: mentions.length
  }).estimated_cost_usd;
}

function governedEntityIds(
  context: Awaited<ReturnType<typeof loadSignalSemanticResolutionGovernedContextV1>>
) {
  const byScope = new Map<string, Set<string>>();
  for (const identity of context.identities) {
    const ids = byScope.get(identity.scope) ?? new Set<string>();
    ids.add(identity.entity_id);
    byScope.set(identity.scope, ids);
  }
  return byScope;
}

function decisionContractIssues(
  decisions: SignalSemanticResolutionDecisionV1[],
  governedIds: Map<string, Set<string>>,
  primaryBrandId: string
) {
  const issues = new Map<string, string[]>();
  for (const decision of decisions) {
    const decisionIssues: string[] = [];
    const scopes = decision.classifications.map((classification) => classification.scope);
    if (scopes.includes("unattributed") && scopes.length !== 1) {
      decisionIssues.push("unattributed_combined_with_other_scope");
    }
    const keys = new Set<string>();
    for (const classification of decision.classifications) {
      const key = `${classification.scope}:${classification.entity_id ?? "null"}`;
      if (keys.has(key)) decisionIssues.push("duplicate_classification");
      keys.add(key);
      if (classification.scope === "unattributed") {
        if (classification.entity_id !== null) decisionIssues.push("unattributed_has_entity_id");
        continue;
      }
      if (!classification.entity_id || !governedIds.get(classification.scope)?.has(classification.entity_id)) {
        decisionIssues.push("non_governed_entity_id");
      }
      if (classification.scope === "primary_brand" && classification.entity_id !== primaryBrandId) {
        decisionIssues.push("primary_brand_uses_wrong_entity_id");
      }
    }
    if (decisionIssues.length > 0) issues.set(decision.mention_id, [...new Set(decisionIssues)]);
  }
  return issues;
}

function reconcileDecisions(decisions: SignalSemanticResolutionDecisionV1[], expectedIds: string[]) {
  const expected = new Set(expectedIds);
  const indexed = new Map<string, SignalSemanticResolutionDecisionV1>();
  for (const decision of decisions) {
    if (!expected.has(decision.mention_id)) throw new Error("Claude returned an unexpected mention id.");
    if (indexed.has(decision.mention_id)) throw new Error("Claude returned a duplicate mention id.");
    indexed.set(decision.mention_id, decision);
  }
  if (indexed.size !== expected.size) throw new Error("Claude omitted one or more mention ids.");
  return indexed;
}

function exactCandidateAgreement(item: SignalSemanticReviewQueueItemV1, decision: SignalSemanticResolutionDecisionV1) {
  const proposed = item.proposed_assertions
    .map((candidate) => `${candidate.scope}:${candidate.entity_id}`)
    .sort();
  const resolved = decision.classifications
    .map((classification) => `${classification.scope}:${classification.entity_id ?? "null"}`)
    .sort();
  return JSON.stringify(proposed) === JSON.stringify(resolved);
}

function summarizeEvidence(args: {
  model: string;
  estimatedCostUsd: number;
  actualCostUsd: number;
  candidatePopulation: number;
  unresolvedPopulation: number;
  evidence: BatchEvidence[];
}) {
  const records = args.evidence.flatMap((batch) => batch.records);
  const classifications = records.flatMap((record) => record.decision.classifications);
  const counts = Object.fromEntries(
    ["primary_brand", "competitor", "category", "reference", "unattributed"]
      .map((scope) => [scope, classifications.filter((classification) => classification.scope === scope).length])
  );
  const candidate = records.filter((record) => record.exact_candidate_agreement !== null);
  const exact = candidate.filter((record) => record.exact_candidate_agreement).length;
  return {
    model: args.model,
    sample_count: records.length,
    batch_count: args.evidence.length,
    candidate_population: args.candidatePopulation,
    unresolved_population: args.unresolvedPopulation,
    estimated_cost_usd: args.estimatedCostUsd,
    actual_cost_usd: args.actualCostUsd,
    total_input_tokens: args.evidence.reduce((sum, batch) => sum + batch.input_tokens, 0),
    total_output_tokens: args.evidence.reduce((sum, batch) => sum + batch.output_tokens, 0),
    candidate_exact_agreement: { matches: exact, total: candidate.length, rate: exact / Math.max(1, candidate.length) },
    classification_counts: counts,
    low_confidence_classifications: classifications.filter((classification) => classification.confidence < 0.75).length,
    multi_entity_mentions: records.filter((record) => record.decision.classifications.length > 1).length,
    contract_errors: records.reduce((sum, record) => sum + record.contract_issues.length, 0),
    mentions_with_contract_errors: records.filter((record) => record.contract_issues.length > 0).length,
    transport_mode: "closed_governed_entity_refs_v2"
  };
}

async function writeEvidence(
  payload: Record<string, unknown>,
  context: Awaited<ReturnType<typeof loadSignalSemanticResolutionGovernedContextV1>>
) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true, mode: 0o700 });
  await writeFile(PRIVATE_EVIDENCE_PATH, `${JSON.stringify({ ...payload, governed_context: context }, null, 2)}\n`, { mode: 0o600 });
  await chmod(PRIVATE_EVIDENCE_PATH, 0o600);
  const labelById = new Map(context.identities.map((identity) => [identity.entity_id, identity.entity_label]));
  const batches = Array.isArray(payload.batches) ? payload.batches as BatchEvidence[] : [];
  const redactedBatches = batches.map((batch) => ({
    batch_id: batch.batch_id,
    group: batch.group,
    estimated_cost_usd: batch.estimated_cost_usd,
    actual_cost_usd: batch.actual_cost_usd,
    input_tokens: batch.input_tokens,
    output_tokens: batch.output_tokens,
    duration_ms: batch.duration_ms,
    records: batch.records.map((record) => ({
      sample_key: record.sample_key,
      platform: record.queue_item.platform,
      queue_state: record.queue_item.state,
      proposed: record.queue_item.proposed_assertions.map((candidate) => ({
        scope: candidate.scope,
        entity_label: candidate.entity_label,
        confidence_band: candidate.confidence_band
      })),
      resolved: record.decision.classifications.map((classification) => ({
        scope: classification.scope,
        entity_label: classification.entity_id ? labelById.get(classification.entity_id) ?? "governed_entity" : null,
        confidence: classification.confidence
      })),
      exact_candidate_agreement: record.exact_candidate_agreement
      ,contract_issues: record.contract_issues
    }))
  }));
  const { batches: _privateBatches, governed_context: _privateContext, ...publicPayload } = payload;
  await writeFile(REDACTED_EVIDENCE_PATH, `${JSON.stringify({
    ...publicPayload,
    workspace: { brand_slug: context.workspace.brand_slug },
    batches: redactedBatches
  }, null, 2)}\n`, { mode: 0o600 });
  await chmod(REDACTED_EVIDENCE_PATH, 0o600);
}

function requiredContext(
  contexts: Map<string, SignalSemanticResolutionMentionContextV1>,
  mentionId: string
) {
  const context = contexts.get(mentionId);
  if (!context) throw new Error("Selected mention context is missing.");
  return context;
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function databaseSslConfig() {
  const disabled = new Set(["0", "false", "no", "off", "disable", "disabled"]);
  const value = process.env.DATABASE_SSL?.trim().toLowerCase();
  return value && disabled.has(value) ? false : { rejectUnauthorized: false };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function roundUsd(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "semantic_resolution_readonly_qa_failed",
    writes_performed: false
  }));
  process.exitCode = 1;
});
