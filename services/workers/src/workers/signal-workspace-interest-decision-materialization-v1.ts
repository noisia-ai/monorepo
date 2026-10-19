import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  claimSignalWorkspaceClassificationV1,
  commitSignalWorkspaceClassificationPageV1,
  finishSignalWorkspaceClassificationV1,
  readSignalWorkspaceClassificationPageV1,
  type SignalWorkspaceClassificationDatabaseV1,
  type SignalWorkspaceClassificationLeaseV1,
  type SignalWorkspaceClassificationPageV1,
} from "@noisia/db";
import {
  buildSignalWorkspaceInterestDecisionRequestV1,
  parseSignalWorkspaceClassificationOutcomeV1,
  parseSignalWorkspaceInterestDecisionOutputV1,
  signalWorkspaceClassificationResolutionV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceClassificationOutcomeV1,
  type SignalWorkspaceInterestDecisionRequestV1,
} from "@noisia/query-engine";
import { buildSignalWorkspaceInterestDecisionOutcomesV1 } from "./signal-workspace-interest-decision-outcome";
import { SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_CONFIGURATION_V1 } from "./signal-workspace-interest-decision-batch-v1";

type Database = SignalWorkspaceClassificationDatabaseV1;
type Stores = {
  claim: typeof claimSignalWorkspaceClassificationV1;
  readPage: typeof readSignalWorkspaceClassificationPageV1;
  commitPage: typeof commitSignalWorkspaceClassificationPageV1;
  finish: typeof finishSignalWorkspaceClassificationV1;
};
const defaultStores: Stores = {
  claim: claimSignalWorkspaceClassificationV1,
  readPage: readSignalWorkspaceClassificationPageV1,
  commitPage: commitSignalWorkspaceClassificationPageV1,
  finish: finishSignalWorkspaceClassificationV1,
};
const digest = /^sha256:[0-9a-f]{64}$/u;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const fail = (code: string): never => { throw new Error(`workspace_interest_materialization_${code}`); };

type Scope = {
  owner_id: string;
  generation_id: string;
  taxonomy_profile_id: string;
  compiler_digest: string;
  expected_roots: number;
  term_key: string;
  taxonomy_term_id: string;
  definition_digest: string;
};
type Authority = { model_version_id: string; approval_policy_id: string };
type Receipt = {
  request_id: string;
  call_id: string;
  request: SignalWorkspaceInterestDecisionRequestV1;
  request_digest: string;
  output_text: string;
  output_digest: string;
  raw_sha256: string;
};
type Evidence = {
  id: string;
  request_id: string;
  call_id: string;
  root_id: string;
  term_key: string;
  taxonomy_term_id: string;
  root_fingerprint: string;
  asset_sha256: string;
  verdict: string;
  rationale: string;
  citations: unknown;
  output_digest: string;
  decision_digest: string;
};

/** The owner, generation and classification execution must be the same pilot.
 * A prior generation's assignment is never copied into this generation. */
async function readScope(database: Database, lease: SignalWorkspaceClassificationLeaseV1): Promise<Scope> {
  const rows = (await database.query<Scope>(`SELECT owner.id owner_id,generation.id generation_id,
      generation.taxonomy_profile_id,generation.input_snapshot->'topics'->0->>'compiler_digest' compiler_digest,
      owner.expected_roots,owner.term_key,owner.taxonomy_term_id::text,owner.definition_digest
    FROM signal_topic_catalog_executions execution
    JOIN signal_classification_generations generation ON generation.id=execution.generation_id
    JOIN signal_interest_decision_owners_v1 owner ON owner.generation_id=generation.id
    JOIN signal_topic_catalog_executions source ON source.id=owner.source_execution_id
      AND source.workspace_id=owner.workspace_id
    WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid
      AND generation.workspace_id=execution.workspace_id
      AND generation.status='open'
      AND generation.input_snapshot->'identity'=$3::jsonb
      AND generation.input_snapshot->>'interest_term_key'=owner.term_key
      AND generation.input_snapshot->'topics'->0->>'taxonomy_term_id'=owner.taxonomy_term_id::text
      AND generation.input_snapshot->'topics'->0->'definition'->>'definition_digest'=owner.definition_digest
      AND jsonb_array_length(generation.input_snapshot->'topics')=1
      AND owner.workspace_id=execution.workspace_id AND owner.status='completed'
      AND owner.manifest_complete AND owner.expected_roots=execution.denominator
      AND source.input_contract='workspace-topic-computation-v1' AND source.status='ready'
      AND source.processed_roots=source.denominator AND source.processed_chunks=source.expected_chunks
      AND source.preparation_run_id=generation.preparation_run_id
      AND source.embedding_run_id=generation.embedding_run_id
      AND source.taxonomy_profile_id=generation.taxonomy_profile_id
      AND source.input_revision=generation.input_revision
      AND source.input_snapshot->>'context_digest'=generation.input_snapshot->>'context_digest'
      AND (source.policy_valid_until IS NULL OR source.policy_valid_until>clock_timestamp())`,
    [lease.execution_id, lease.workspace_id, JSON.stringify(lease.identity)])).rows;
  if (rows.length !== 1 || !digest.test(rows[0]!.compiler_digest)) return fail("owner_or_source_unavailable");
  return rows[0]!;
}

/** Model/policy are read from the registered and currently approved authority.
 * The assignment trigger checks the same rows again inside each page commit. */
async function readAuthority(database: Database, lease: SignalWorkspaceClassificationLeaseV1,
  scope: Scope): Promise<Authority> {
  const rows = (await database.query<Authority>(`SELECT model.id::text model_version_id,policy.id::text approval_policy_id
    FROM tagging_model_versions model
    JOIN signal_interest_decision_platform_benchmarks_v1 benchmark
      ON benchmark.id::text=model.configuration->>'platform_benchmark_id'
    JOIN signal_classification_approval_policies policy
      ON policy.model_version_id=model.id
    WHERE model.registry_contract_version='signal-tagging-model-registry-v1'
      AND model.provider='anthropic' AND model.taxonomy_profile_id=$1::uuid
      AND model.artifact_digest=$2
      AND model.configuration->'provider_config'=$6::jsonb
      AND model.configuration->'workspace_classification_identity'=$3::jsonb
      AND model.dataset_digest=benchmark.dataset_digest
      AND model.gold_set_digest=benchmark.labels_digest
      AND benchmark.model_artifact_digest=model.artifact_digest
      AND benchmark.provider_config_digest=model.artifact_digest
      AND benchmark.prompt_digest=$7
      AND benchmark.approved_at<=clock_timestamp()
      AND (SELECT event.status FROM signal_tagging_model_version_events event
        WHERE event.workspace_id=$4::uuid AND event.model_version_id=model.id AND event.effective_at<=clock_timestamp()
        ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved'
      AND policy.workspace_id=$4::uuid AND policy.taxonomy_profile_id=$1::uuid
      AND policy.authority_kind='model' AND policy.status='approved'
      AND policy.definition_hash=$5
      AND policy.effective_from<=clock_timestamp()
      AND (policy.effective_to IS NULL OR policy.effective_to>clock_timestamp())
    LIMIT 2`, [scope.taxonomy_profile_id,lease.identity.engine_artifact_digest,
    JSON.stringify(lease.identity),lease.workspace_id,lease.identity.decision_policy_digest,
    JSON.stringify(SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_CONFIGURATION_V1),
    SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_CONFIGURATION_V1.prompt_digest])).rows;
  if (rows.length !== 1) return fail("model_policy_authority_unavailable");
  return rows[0]!;
}

async function readAcceptedEvidence(database: Database, ownerId: string, rootIds: string[]) {
  const receipts = (await database.query<Receipt>(`SELECT DISTINCT ON (request.id)
      request.id::text request_id,call.id::text call_id,request.request,request.request_digest,
      call.output_text,call.output_digest,call.raw_sha256
    FROM signal_interest_decision_request_roots_v1 requested
    JOIN signal_interest_decision_requests_v1 request
      ON request.id=requested.request_id AND request.owner_id=requested.owner_id
    JOIN signal_interest_decision_root_evidence_v1 evidence
      ON evidence.owner_id=requested.owner_id AND evidence.request_id=request.id
        AND evidence.root_id=requested.root_id
    JOIN signal_interest_decision_calls_v1 call
      ON call.id=evidence.call_id AND call.request_id=request.id AND call.owner_id=request.owner_id
    WHERE requested.owner_id=$1::uuid AND requested.root_id=ANY($2::uuid[])
      AND call.status='settled' AND call.validation_status='accepted'
    ORDER BY request.id`, [ownerId,rootIds])).rows;
  if (!receipts.length) return fail("settled_receipt_missing");
  const evidence = (await database.query<Evidence>(`SELECT evidence.id::text,evidence.request_id::text,
      evidence.call_id::text,evidence.root_id::text,evidence.term_key,evidence.taxonomy_term_id::text,
      evidence.root_fingerprint,evidence.asset_sha256,evidence.verdict,evidence.rationale,
      evidence.citations,evidence.output_digest,evidence.decision_digest
    FROM signal_interest_decision_root_evidence_v1 evidence
    WHERE evidence.owner_id=$1::uuid AND evidence.request_id=ANY($2::uuid[])
    ORDER BY evidence.request_id,evidence.root_id`,
    [ownerId,receipts.map(receipt => receipt.request_id)])).rows;
  return { receipts, evidence };
}

function applyHumanCorrection(outcome: SignalWorkspaceClassificationOutcomeV1,
  corrections: SignalWorkspaceClassificationPageV1["items"][number]["corrections"],
  lease: SignalWorkspaceClassificationLeaseV1, scope: Scope) {
  if (corrections.length === 0) return outcome;
  if (corrections.length !== 1 || corrections[0]!.resolution_method !== "human"
    || corrections[0]!.term_key !== scope.term_key
    || corrections[0]!.taxonomy_term_id !== scope.taxonomy_term_id
    || corrections[0]!.definition_digest !== scope.definition_digest)
    return fail("correction_scope_invalid");
  const decision = corrections[0]!;
  const updated: SignalWorkspaceClassificationOutcomeV1 = {
    ...outcome, decisions: [decision],
    resolution_state: signalWorkspaceClassificationResolutionV1([decision],false),
    reason_code: "interest_human_override",
    evidence_digest: signalWorkspaceEmbeddingDigestV1({ decision: outcome.evidence_digest,
      correction: decision.evidence_digest }),
  };
  return parseSignalWorkspaceClassificationOutcomeV1({ identity: lease.identity, root: outcome.root, outcome: updated });
}

function buildPage(lease: SignalWorkspaceClassificationLeaseV1, scope: Scope, authority: Authority,
  page: SignalWorkspaceClassificationPageV1, receipts: Receipt[], evidence: Evidence[]) {
  const saved = new Map(evidence.map(row => [row.root_id,row]));
  if (saved.size !== evidence.length) return fail("duplicate_root_evidence");
  const byRoot = new Map<string,SignalWorkspaceClassificationOutcomeV1>();
  for (const receipt of receipts) {
    if (!digest.test(receipt.raw_sha256) || receipt.output_digest !== sha(receipt.output_text)
      || receipt.request.request_digest !== receipt.request_digest) return fail("settled_receipt_digest_invalid");
    const { request_digest: _requestDigest, ...body } = receipt.request;
    const request = buildSignalWorkspaceInterestDecisionRequestV1(body);
    if (request.request_digest !== receipt.request_digest
      || request.interest.term_key !== scope.term_key
      || request.interest.taxonomy_term_id !== scope.taxonomy_term_id
      || request.interest.definition_digest !== scope.definition_digest)
      return fail("request_digest_invalid");
    const rawOutput: unknown = JSON.parse(receipt.output_text);
    const parsed = parseSignalWorkspaceInterestDecisionOutputV1({ request, output: rawOutput });
    const rawDecisions = new Map(parsed.output.decisions.map(decision => [decision.root_id,
      (rawOutput as { decisions: typeof parsed.output.decisions }).decisions.find(raw => raw.root_id === decision.root_id)!]));
    const evidenceByRoot: Record<string,{id:string;output_digest:string;decision_digest:string}> = {};
    for (const decision of parsed.output.decisions) {
      const row = saved.get(decision.root_id), rawDecision = rawDecisions.get(decision.root_id);
      if (!row || row.request_id !== receipt.request_id || row.call_id !== receipt.call_id
        || row.term_key !== request.interest.term_key || row.taxonomy_term_id !== request.interest.taxonomy_term_id
        || row.root_fingerprint !== decision.root_fingerprint || row.asset_sha256 !== decision.asset_sha256
        || row.verdict !== decision.verdict || row.rationale !== decision.rationale
        || !isDeepStrictEqual(row.citations,rawDecision?.citations)
        || row.output_digest !== receipt.output_digest || !digest.test(row.decision_digest))
        return fail("saved_evidence_mismatch");
      evidenceByRoot[decision.root_id] = { id: row.id, output_digest: row.output_digest,
        decision_digest: row.decision_digest };
    }
    const outcomes = buildSignalWorkspaceInterestDecisionOutcomesV1({ request, parsed,
      identity: lease.identity, compiler_digest: scope.compiler_digest,
      authority: { model_version_id: authority.model_version_id,
        approval_policy_id: authority.approval_policy_id,
        model_receipt_digest: receipt.raw_sha256,
        model_receipt_output_digest: receipt.output_digest,
        evidence_by_root_id: evidenceByRoot } });
    for (const outcome of outcomes) byRoot.set(outcome.root.root_id,outcome);
  }
  return page.items.map(item => {
    const outcome = byRoot.get(item.root.root_id);
    if (!outcome || outcome.root.fingerprint !== item.root.fingerprint
      || outcome.root.correction_digest !== item.root.correction_digest
      || outcome.coverage.expected_chunks !== item.root.expected_chunks
      || outcome.coverage.chunk_coverage_digest !== item.root.chunk_coverage_digest)
      return fail("classification_page_source_mismatch");
    return applyHumanCorrection(outcome,item.corrections,lease,scope);
  });
}

/** Materializes only a completed SQL0211 owner into its own classification
 * generation. Each page commit is atomic with the existing generation cursor;
 * a lost acknowledgement is recovered by reclaiming the execution lease. */
export async function materializeSignalWorkspaceInterestDecisionV1(args: {
  database: Database; execution_id: string; worker_job_id: string;
  stores?: Stores; page_size?: number;
}) {
  const stores = args.stores ?? defaultStores;
  const size = args.page_size ?? 32;
  if (!Number.isSafeInteger(size) || size < 1 || size > 64)
    return fail("page_size_invalid");
  const claimed = await stores.claim({ database: args.database,
    execution_id: args.execution_id, worker_job_id: args.worker_job_id });
  if (!claimed) return { execution_id: args.execution_id, replayed: true };
  let lease = claimed;
  const scope = await readScope(args.database,lease);
  const authority = await readAuthority(args.database,lease,scope);
  for (;;) {
    const page = await stores.readPage({ database: args.database,lease,limit:size });
    if (!page.items.length && !page.done) return fail("empty_nonfinal_page");
    if (page.items.length) {
      const roots = page.items.map(item => item.root.root_id);
      if (new Set(roots).size !== roots.length || roots.some((id,index) =>
        index > 0 && id <= roots[index-1]! || lease.cursor_root_id !== null && id <= lease.cursor_root_id!))
        return fail("classification_page_sequence_invalid");
      const { receipts,evidence } = await readAcceptedEvidence(args.database,scope.owner_id,roots);
      const outcomes = buildPage(lease,scope,authority,page,receipts,evidence);
      const next = await stores.commitPage({ database: args.database,lease,outcomes });
      if (next.execution_id !== lease.execution_id || next.workspace_id !== lease.workspace_id
        || next.execution_token !== lease.execution_token || next.input_digest !== lease.input_digest
        || signalWorkspaceEmbeddingDigestV1(next.identity) !== signalWorkspaceEmbeddingDigestV1(lease.identity)
        || next.cursor_root_id !== roots.at(-1)) return fail("checkpoint_invalid");
      lease = next;
    }
    if (page.done) break;
  }
  return stores.finish({ database: args.database,lease });
}
