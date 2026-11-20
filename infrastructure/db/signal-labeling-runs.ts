import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  facetLabelerIdentityV1,
  facetMaxRootsPerRequestV1,
  validateFacetLabelerIdentityV1,
  labelerDigestV1,
  signalWorkspaceEmbeddingDigestV1 as digest,
  type FacetInput,
  type FacetResult,
  type LabelerIdentity,
  type EntityContextV1,
  type LlmUsageV1,
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { signalWorkspaceFeatureEnabledV1, type SignalWorkspaceFeatureV1 } from "./signal-workspace-features";
import { admitSignalProcessingWithClientV1, type SignalProcessingAdmitArgsV1 } from "./signal-processing-policy";
import {
  inspectFacetContextChangeV1,
  registerFacetContextV1,
  selectFacetInputsV1,
  writeFacetResultsV1,
  type LabelingDatabaseV1,
} from "./signal-mention-facets";
import {createLabelingRawPageStoreV1} from "./signal-labeling-raw-page-store";
import {LABELING_RAW_PAGE_MAX_MEMBERS_V1,type LabelingRawPageStorageV1} from "./signal-labeling-raw-pages";
import {validateLabelingInputBoundsV1,type LabelingInputBoundsV1} from './signal-labeling-input-bounds';
import {planNativeListeningAdmissionPacketV1,nativeListeningAdmissionCoveredV1,nativeListeningAdmissionPacketBodyV1,
 validateNativeListeningAdmissionRowsV1,reconstructNativeListeningAdmissionRowsV1,validateNativeListeningAdmissionSelectionV1,NATIVE_LISTENING_COVERED_PROFILES_SQL_V1,
 NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1,NATIVE_LISTENING_ADMISSION_MARK_SQL_V1} from './signal-listening-native-admission';
export type {LabelingInputBoundsV1} from './signal-labeling-input-bounds';
export {nativeListeningAdmissionWorkspaceBoundV1,createNativeListeningAdmissionWorkspaceQuoteV1,type NativeListeningAdmissionWorkspaceQuoteV1} from './signal-listening-native-admission';
export type LabelingPolicyV1={organization_id:string;budget_date:string;budget_timezone:string;daily_cap_micro_usd:string|null;
 max_execution_micro_usd:string|null;provider:string;model:string;action:string;funding_receipt_id?:string|null;effective_total_cap_micro_usd?:string};
export type LabelingRequestPolicyV1=Pick<LabelingPolicyV1,"max_execution_micro_usd"|"provider"|"model">;
export type LabelingAdmissionRefV1={receipt:{id:string};processing_admission_id?:string|null};
export type LabelingRunV1 = {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  kind: "facets" | "membership" | "mass_labeling";
  labeler_digest: string;
  identity: LabelerIdentity;
  entity_context_digest: string;
  entity_context_version_no: number;
  context: EntityContextV1;
  lease_token: string;
  cursor_root_id: string | null;
  cap_micro_usd: string | null;
  processing_admission_id: string | null;
  status: string;
  created_at?: Date | string;
  error_code?: string | null;
};
export type LabelingCallProposalV1<Input extends FacetInput = FacetInput> = {
  custom_id: string;
  request_digest: string;
  request: Record<string, unknown>;
  inputs: Input[];
  reserved_micro_usd: number;
  retry_depth?: number;
};
/** Private native admission callbacks. Neither callback grants DB authority.
 * The selected proposals are not committed calls; validation happens before
 * COMMIT and the exact validated array is handed back only after its ACK. */
export type LabelingAdmissionSelectionV1<Input extends FacetInput = FacetInput> = {
  selectFresh(candidates:ReadonlyArray<LabelingCallProposalV1<Input>>):ReadonlyArray<LabelingCallProposalV1<Input>>;
  validateBeforeCommit(calls:ReadonlyArray<LabelingCallV1<Input>>,selected:ReadonlyArray<LabelingCallProposalV1<Input>>):void;
};
export type LabelingAdmissionResultV1<Input extends FacetInput = FacetInput> =
  |{kind:'committed';calls:ReadonlyArray<LabelingCallV1<Input>>}
  |{kind:'legacy'};
/** No post-DML failure permits automatic fallback or another attempt. A lost
 * COMMIT ACK remains unknown even when a later ROLLBACK command responds. */
export class LabelingAdmissionFailureV1 extends Error{
  readonly code:string|undefined;
  constructor(cause:unknown,readonly outcome:'rolled_back'|'unknown',readonly call_ids:ReadonlyArray<string>,readonly custom_ids:ReadonlyArray<string>){
    super(cause instanceof Error?cause.message:'labeling_native_admission_failed',{cause});this.name='LabelingAdmissionFailureV1';
    const primary=cause instanceof AggregateError?cause.cause:cause;
    this.code=primary&&typeof primary==='object'&&'code'in primary&&typeof primary.code==='string'?primary.code:undefined;
  }
}
export type LabelingCallV1<Input extends FacetInput = FacetInput> =
  LabelingCallProposalV1<Input> & {
    id: string;
    status:
      | "reserved"
      | "submitting"
      | "submitted"
      | "settled"
      | "failed"
      | "unknown";
    raw_body: string | null;
    /** Metadata does not load bytes: NULL raw_body is not proof of no receipt. */
    has_raw?:boolean;
    request_size_bytes?:number|string;
    input_size_bytes?:number|string;
    raw_storage_key?:string|null;
    raw_size_bytes?:number|string|null;
    raw_page_id?:string|null;
    raw_page_size_bytes?:number|string|null;
    results_applied: boolean;
    provider_batch_id: string | null;
    retry_depth: number;
    created_at?: Date | string;
    updated_at?: Date | string;
  };
/** Durable diagnostic allowlist; never serialize Error.message, cause or provider bodies. */
export function labelingCreateFailureReceiptV1(error: unknown): string | null {
  if (error === undefined) return null;
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const transport = e.name === "AnthropicBatchTransportError";
  const code = typeof e.code === "string" && (
    /^batch_http_[1-5][0-9]{2}$/u.test(e.code) ||
    ["batch_api_key_missing", "batch_timeout_invalid", "batch_request_count_invalid",
      "batch_request_invalid", "batch_request_not_serializable", "batch_request_envelope_too_large",
      "batch_transport_or_response_invalid"].includes(e.code)
  ) ? e.code : "unclassified_create_failure";
  const status = transport && Number.isInteger(e.httpStatus) &&
    Number(e.httpStatus) >= 100 && Number(e.httpStatus) <= 599 ? Number(e.httpStatus) : null;
  return JSON.stringify({
    contract_version: "labeling-create-failure-v1",
    error_class: transport ? "AnthropicBatchTransportError" : "Error",
    code: transport ? code : "unclassified_create_failure",
    http_status: status,
    ...(transport && e.providerReason === "credit_balance_insufficient"
      ? {provider_reason:"credit_balance_insufficient"} : {}),
    submission: transport && ["not_submitted", "submission_unknown", "read_failed"].includes(String(e.submission))
      ? e.submission : "submission_unknown",
  });
}
export class SignalLabelingError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}
function fail(code: string, status = 409): never {
  throw new SignalLabelingError(code, status);
}
const money = (v: number | null | undefined) => {
  if (v !== null && v !== undefined && (!Number.isSafeInteger(v) || v < 0))
    fail("labeling_money_invalid", 400);
  return v ?? null;
};
async function tx<T>(
  db: LabelingDatabaseV1,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function authorize(c: PoolClient, w: string, a: string, write: boolean, feature: SignalWorkspaceFeatureV1 = "mention_facets") {
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({
    queryable: c,
    workspace_id: w,
    actor_user_id: a,
    lock_authority: write,
  });
  if (write ? !caps.can_request_processing : !caps.can_view)
    fail("labeling_forbidden", 403);
  if (!await signalWorkspaceFeatureEnabledV1({queryable:c,workspace_id:w,feature})) fail("labeling_not_enabled",404);
}
async function estimatePopulation(
  c: PoolClient,
  workspace: string,
  identity: LabelerIdentity,
  context: EntityContextV1,
  affected: string[] = [],
  allPopulation = false,
) {
  const row = (
    await c.query<{ roots: number; characters: string; long_roots: number }>(
      `SELECT count(*)::int roots,COALESCE(sum(length(full_text)+COALESCE(length(title),0)),0)::text characters,
  count(*) FILTER (WHERE length(full_text)>12000)::int long_roots
  FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND ($3::boolean OR (status IN('pending','error') AND NOT requires_context_review) OR root_id=ANY($2::uuid[]))`,
      [workspace, affected, allPopulation],
    )
  ).rows[0]!;
  return estimatePopulationFromCounts(row, identity, context, allPopulation);
}
function estimatePopulationFromCounts(
  row: { roots: number; characters: string; long_roots: number },
  identity: LabelerIdentity, context: EntityContextV1, allPopulation: boolean,
) {
  const maxRoots =
    identity.provider === "typesafe" ? 1 : facetMaxRootsPerRequestV1(identity);
  const requests =
    identity.provider === "typesafe"
      ? row.roots
      : row.long_roots + Math.ceil((row.roots - row.long_roots) / maxRoots);
  const estimatedInput = Math.ceil(
    Number(row.characters) / 3.5 +
      ((JSON.stringify(context).length + 2400) / 3.5) * requests,
  );
  const inputRate =
    identity.provider === "typesafe"
      ? Number(identity.params.input_usd_per_mtok)
      : 1;
  if (!Number.isFinite(inputRate) || inputRate < 0)
    fail("labeling_price_required");
  const estimatedOutput =
    identity.provider === "typesafe" ? 0 : row.roots * 350;
  return {
    roots: row.roots,
    population_basis: allPopulation
      ? "all_eligible_for_new_labeler"
      : "pending_or_affected",
    target_labeler_digest: labelerDigestV1(identity),
    characters: Number(row.characters),
    estimated_requests: requests,
    max_roots_per_request: maxRoots,
    estimated_input_tokens: estimatedInput,
    estimated_output_tokens: estimatedOutput,
    input_usd_per_mtok: inputRate,
    output_usd_per_mtok: identity.provider === "typesafe" ? 0 : 5,
    estimated_micro_usd: Math.ceil(
      estimatedInput * inputRate + estimatedOutput * 5,
    ),
  };
}
export async function loadMentionFacetsStatusV1(args: {
  database: LabelingDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
  identity?: LabelerIdentity;
}) {
  return tx(args.database, async (c) => {
    await authorize(c, args.workspace_id, args.actor_user_id, false);
    const change = await inspectFacetContextChangeV1(c, args.workspace_id);
    // A single workspace projection supplies counts and both quote populations.
    const population = (await c.query<{
      counts: Array<{ status: string; relevance: string; count: number }>;
      pending: { roots: number; characters: string; long_roots: number };
      full: { roots: number; characters: string; long_roots: number };
    }>(`WITH roots AS MATERIALIZED (
      SELECT *, (status IN('pending','error') AND NOT requires_context_review) OR root_id=ANY($2::uuid[]) needs_work
      FROM signal_workspace_mention_facets_read_v1($1::uuid) WHERE workspace_id=$1
    ), counts AS (
      SELECT CASE WHEN root_id=ANY($2::uuid[]) THEN 'pending' ELSE status END status,
        CASE WHEN root_id=ANY($2::uuid[]) THEN 'unknown' ELSE relevance END relevance,count(*)::int count
      FROM roots GROUP BY 1,2
    ), metrics AS (
      SELECT count(*)::int roots,COALESCE(sum(length(full_text)+COALESCE(length(title),0)),0)::text characters,
        count(*) FILTER(WHERE length(full_text)>12000)::int long_roots,
        count(*) FILTER(WHERE needs_work)::int pending_roots,
        COALESCE(sum(length(full_text)+COALESCE(length(title),0)) FILTER(WHERE needs_work),0)::text pending_characters,
        count(*) FILTER(WHERE needs_work AND length(full_text)>12000)::int pending_long_roots FROM roots
    ) SELECT COALESCE((SELECT jsonb_agg(counts) FROM counts),'[]'::jsonb) counts,
      jsonb_build_object('roots',pending_roots,'characters',pending_characters,'long_roots',pending_long_roots) pending,
      jsonb_build_object('roots',roots,'characters',characters,'long_roots',long_roots) full FROM metrics`,
      [args.workspace_id, change.changed ? change.affected : []])).rows[0]!;
    const counts = population.counts;
    const latest =
      (
        await c.query(
          `SELECT r.id,r.status,r.counts,r.estimated_micro_usd::text,r.budget_micro_usd::text,r.cap_micro_usd::text,r.waiting_full_confirmation,r.error_code,
    COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled' OR c.status='failed' AND c.settled_micro_usd IS NOT NULL),0)::text settled_micro_usd,
    COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status IN('reserved','submitting','submitted','unknown')),0)::text reserved_micro_usd
    FROM signal_labeling_runs r LEFT JOIN signal_labeling_calls c ON c.run_id=r.id WHERE r.id=(SELECT id FROM signal_labeling_runs WHERE workspace_id=$1 AND kind='facets' ORDER BY created_at DESC LIMIT 1) GROUP BY r.id`,
          [args.workspace_id],
        )
      ).rows[0] ?? null;
    const pending = counts
      .filter((x) => x.status === "pending")
      .reduce((n, x) => n + x.count, 0);
    const selectedLabeler = (
      await c.query<{ identity: LabelerIdentity }>(
        `SELECT l.identity FROM signal_workspace_labelers w JOIN signal_labeler_versions l ON l.id=w.labeler_version_id WHERE w.workspace_id=$1 AND w.kind='facets'`,
        [args.workspace_id],
      )
    ).rows[0]?.identity;
    const labeler = args.identity ?? selectedLabeler ?? facetLabelerIdentityV1();
    if (labeler.provider === "anthropic") validateFacetLabelerIdentityV1(labeler);
    const allPopulation = !selectedLabeler || labelerDigestV1(selectedLabeler) !== labelerDigestV1(labeler);
    const estimate = estimatePopulationFromCounts(allPopulation ? population.full : population.pending, labeler, change.context, allPopulation);
    return {
      contract_version: "mention-facets-status-v1",
      counts,
      latest,
      entity_context_digest: change.digest,
      stale_count: change.changed ? change.affected.length : 0,
      affected_mode: change.diff.affected_mode,
      pending,
      estimated_micro_usd: estimate.estimated_micro_usd,
      estimated_full_micro_usd: estimatePopulationFromCounts(population.full, labeler, change.context, true).estimated_micro_usd,
      estimate,
    };
  });
}
export async function requestMentionFacetsV1(args: {
  database: LabelingDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
  idempotency_key: string;
  budget_micro_usd?: number | null;
  cap_micro_usd?: number | null;
  full_recalculation?: boolean;
  provider_available: boolean;
  identity?: LabelerIdentity;
  adapter?: {
    request_identity: unknown;
    /** Internal cohort policy: Listening scans its governed configuration/map/cache
     * population itself. Keep full intent, but append CE history only on a real
     * identity change. Classic/Study defaults and superseded-full fences remain.
     * Future audit trails intentionally contain fewer synthetic identical CEs. */
    context_registration?: "change_only";
    policy?: (client:PoolClient)=>Promise<LabelingRequestPolicyV1|null>;
    admit?: (client:PoolClient,args:SignalProcessingAdmitArgsV1)=>Promise<LabelingAdmissionRefV1>;
    /** A provider-specific membership stage must use its own governed action. */
    policy_action?: "concept_membership_jev" | "concept_membership_claude" | "mass_labeling_jev";
    feature?: SignalWorkspaceFeatureV1;
    validateIdentity: (identity: LabelerIdentity) => void;
    prepare: (
      client: PoolClient,
      workspace: string,
      runId: string,
      labeler: string,
      context: EntityContextV1,
    ) => Promise<{
      roots: number;
      estimated_micro_usd: number;
      snapshot: unknown;
      concept_set_digest: string;
    }>;
    persist: (
      client: PoolClient,
      runId: string,
      prepared: { snapshot: unknown; concept_set_digest: string },
    ) => Promise<void>;
    select_labeler?: boolean;
  };
}) {
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))
    fail("labeling_idempotency_key_invalid", 400);
  return tx(args.database, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
      [args.workspace_id],
    );
    // Match reservation/admission ordering: organization/day before actor rows.
    await c.query(
      `SELECT signal_processing_lock_v1(w.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date)
       FROM signal_workspaces w JOIN signal_processing_policy_versions p ON p.organization_id=w.organization_id AND p.status='active'
       WHERE w.id=$1`,
      [args.workspace_id],
    );
    await authorize(c, args.workspace_id, args.actor_user_id, true, args.adapter?.feature);
    // A replay belongs to its sealed labeler, even if the workspace later selects
    // another version. Explicit request identities still participate in the seal.
    const replay = (await c.query<{id:string;request_digest:string;identity:LabelerIdentity}>(
      `SELECT r.id,r.request_digest,l.identity FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
       WHERE r.workspace_id=$1 AND r.actor_user_id=$2 AND r.idempotency_key=$3`,
      [args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
    const selected = args.identity || replay ? undefined : (await c.query<{identity:LabelerIdentity;status:string}>(
      `SELECT l.identity,l.status FROM signal_workspace_labelers w JOIN signal_labeler_versions l ON l.id=w.labeler_version_id WHERE w.workspace_id=$1 AND w.kind='facets'`,
      [args.workspace_id])).rows[0];
    if (selected?.status === "retired") fail("labeling_labeler_retired");
    const identity = args.identity ?? replay?.identity ?? selected?.identity ?? facetLabelerIdentityV1(),
      ld = labelerDigestV1(identity),
      budget = money(args.budget_micro_usd),
      requestedCap = money(args.cap_micro_usd);
    if (args.adapter) args.adapter.validateIdentity(identity);
    else if (identity.provider === "anthropic") validateFacetLabelerIdentityV1(identity);
    const requestDigest = digest({
      labeler_digest: ld,
      budget_micro_usd: budget,
      cap_micro_usd: requestedCap,
      full_recalculation: args.full_recalculation ?? false,
      ...(args.adapter ? { adapter: args.adapter.request_identity } : {}),
    });
    if (replay) {
      if (replay.request_digest !== requestDigest)
        fail("labeling_idempotency_conflict");
      return { run_id: replay.id, replayed: true };
    }
    if (!args.provider_available) fail("labeling_provider_unavailable", 503);
    const active = (
      await c.query<{
        id: string;
        waiting_full_confirmation: boolean;
        entity_context_digest: string;
      }>(
        `SELECT id,waiting_full_confirmation,entity_context_digest FROM signal_labeling_runs WHERE workspace_id=$1 AND kind=$2 AND status IN('queued','running')`,
        [args.workspace_id, identity.kind],
      )
    ).rows[0];
    let supersededFull = false;
    if (active?.waiting_full_confirmation) {
      const current = await inspectFacetContextChangeV1(c, args.workspace_id);
      if (current.digest !== active.entity_context_digest) {
        const canceled = await c.query(
          `UPDATE signal_labeling_runs SET status='canceled',error_code='labeling_context_superseded',updated_at=now()
           WHERE id=$1 AND status='queued' AND waiting_full_confirmation
           AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id`,
          [active.id],
        );
        supersededFull = canceled.rows.length === 1;
      }
    }
    if (active && !supersededFull) fail("labeling_already_active");
    const prep = (
      await c.query<{ id: string }>(
        `SELECT r.id FROM signal_corpus_preparation_runs r JOIN signal_corpus_preparation_input_state s ON s.workspace_id=r.workspace_id AND s.input_revision=r.input_revision
    WHERE r.workspace_id=$1 AND r.status='completed' AND (r.policy_valid_until IS NULL OR r.policy_valid_until>now()) ORDER BY r.completed_at DESC LIMIT 1`,
        [args.workspace_id],
      )
    ).rows[0];
    if (!prep) fail("labeling_preparation_required");
    const action = args.adapter?.policy_action ??
      (identity.kind === "facets" ? "mention_facets" : "concept_membership");
    const policy = args.adapter?.policy ? await args.adapter.policy(c) : (
      await c.query<{
        max_execution_micro_usd: string | null;
        provider: string;
        model: string;
      }>(
        `SELECT a.max_execution_micro_usd::text,a.provider,a.model FROM signal_processing_policy_versions p
    JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id WHERE p.organization_id=(SELECT organization_id FROM signal_workspaces WHERE id=$1)
    AND p.status='active' AND p.valid_from<=now() AND p.valid_until>now() AND a.action=$2`,
        [args.workspace_id, action],
      )
    ).rows[0];
    if (
      !policy ||
      policy.provider !== identity.provider ||
      policy.model !== identity.model
    )
      fail("labeling_policy_unavailable");
    const policyCap =
      policy.max_execution_micro_usd === null
        ? null
        : Number(policy.max_execution_micro_usd);
    if (policyCap !== null && requestedCap !== null && requestedCap > policyCap)
      fail("labeling_policy_cap_exceeded");
    const cap = requestedCap ?? policyCap;
    const fullIntent = args.full_recalculation ?? false;
    const change = await registerFacetContextV1(
      c,
      args.workspace_id,
      supersededFull || (fullIntent && args.adapter?.context_registration !== "change_only"),
    );
    if (args.adapter) args.adapter.validateIdentity(identity);
    else if (identity.provider === "anthropic")
      validateFacetLabelerIdentityV1(identity);
    const labeler = (
      await c.query<{ id: string; status: string }>(
        `INSERT INTO signal_labeler_versions(kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT(labeler_digest) DO UPDATE SET labeler_digest=excluded.labeler_digest RETURNING id,status`,
        [
          identity.kind,
          identity.provider,
          identity.model,
          identity.prompt_digest,
          identity.schema_digest,
          ld,
          JSON.stringify(identity),
        ],
      )
    ).rows[0]!;
    if (labeler.status === "retired") fail("labeling_labeler_retired");
    if (args.adapter?.select_labeler !== false)
      await c.query(
        `INSERT INTO signal_workspace_labelers(workspace_id,kind,labeler_version_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id,kind) DO UPDATE SET labeler_version_id=excluded.labeler_version_id`,
        [args.workspace_id, identity.kind, labeler.id],
      );
    const runId = randomUUID();
    const prepared = args.adapter
      ? await args.adapter.prepare(
          c,
          args.workspace_id,
          runId,
          ld,
          change.context,
        )
      : null;
    const waiting =
      !!change.previous &&
      change.changed &&
      change.diff.affected_mode === "full" &&
      !args.full_recalculation;
    const estimate =
      prepared ??
      (await estimatePopulation(
        c,
        args.workspace_id,
        identity,
        change.context,
        change.changed ? change.affected : [],
        change.diff.affected_mode === "full",
      ));
    const pending = estimate.roots,
      estimated = estimate.estimated_micro_usd;
    const admission:LabelingAdmissionRefV1 = await (args.adapter?.admit??admitSignalProcessingWithClientV1)(c, {
      workspace_id: args.workspace_id,
      actor_user_id: args.actor_user_id,
      action,
      target_id: runId,
      idempotency_key: args.idempotency_key,
      request_digest: requestDigest,
      execution_cap_micro_usd: cap === null ? null : String(cap),
    });
    await c.query(
      `INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,entity_context_digest,entity_context_version_no,estimated_micro_usd,budget_micro_usd,cap_micro_usd,idempotency_key,request_digest,actor_user_id,processing_admission_id,full_recalculation_confirmed,waiting_full_confirmation,counts)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
      [
        runId,
        args.workspace_id,
        identity.kind,
        labeler.id,
        prep!.id,
        change.digest,
        (change.previous?.version_no ?? 0) + (change.changed ? 1 : 0),
        estimated,
        budget,
        cap,
        args.idempotency_key,
        requestDigest,
        args.actor_user_id,
        admission.processing_admission_id===undefined?admission.receipt.id:admission.processing_admission_id,
        args.full_recalculation ?? false,
        waiting,
        JSON.stringify({ pending, selected: 0 }),
      ],
    );
    if (args.adapter && prepared)
      await args.adapter.persist(c, runId, prepared);
    return {
      run_id: runId,
      replayed: false,
      waiting_full_confirmation: waiting,
      estimated_micro_usd: estimated,
      cap_micro_usd: cap,
    };
  });
}
export async function readSignalLabelingRunExposureV1(client: PoolClient, runId: string): Promise<string> {
  const row=(await client.query<{total:string}>(
    `SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd
      ELSE reserved_micro_usd END),0)::text total FROM signal_labeling_calls WHERE run_id=$1`,
    [runId],
  )).rows[0];
  return row?.total??"0";
}

export function createSignalLabelingStoreV1<
  Input extends FacetInput = FacetInput,
  Result = FacetResult,
>(options: {
  adapter?: {
    kind: "facets" | "membership" | "mass_labeling";
    policy?: (client:PoolClient,run:LabelingRunV1)=>Promise<LabelingPolicyV1|null>;
    hybrid_stage?: "jev" | "claude" | "citation";
    feature?: SignalWorkspaceFeatureV1;
    pending_calls_only?: boolean;
    /** Listening can drain previously paid raw receipts on a terminal run. */
    recover_failed_raw?: boolean;
    policy_action?: "concept_membership_jev" | "concept_membership_claude" | "mass_labeling_jev";
    /** H1 verifies each decision against this call's results in the same transaction. */
    persist_results_before_write?: boolean;
    /** Native page adapters only: mutations touch disjoint calls/results and
     * never update the run lifecycle. Requires durable page custody. */
    parallel_native_pages?: boolean;
    /** Server-owned Listening adapter only: selection derives from native
     * question receipts, never the generic run cursor. Requires parallel
     * native pages AND durable RAW page custody; not an identity/JSON flag. */
    reserve_selection?: 'native_listening_pending';
    bounded_inputs?:(client:PoolClient,run:LabelingRunV1,bounds:LabelingInputBoundsV1)=>Promise<Input[]>;
    has_inputs?:(client:PoolClient,run:LabelingRunV1)=>Promise<boolean>;
    inputs: (
      client: LabelingDatabaseV1 | PoolClient,
      run: LabelingRunV1,
    ) => Promise<Input[]>;
    write: (
      client: PoolClient,
      run: LabelingRunV1,
      pages: Array<{ call: LabelingCallV1<Input>; results: Result[] }>,
    ) => Promise<void>;
    pending: (client: PoolClient, run: LabelingRunV1) => Promise<number>;
    /** Listening counts unanswered roots and selectable questions from one
     * population snapshot; other adapters retain their existing callbacks. */
    pending_and_available?: (client:PoolClient,run:LabelingRunV1)=>Promise<{pending:number;available:boolean}>;
    authority?: (client: PoolClient, run: LabelingRunV1) => Promise<void>;
    beforeSubmit?: (client: PoolClient, run: LabelingRunV1, calls: LabelingCallV1<Input>[]) => Promise<void>;
  };
  database: LabelingDatabaseV1;
  /** Explicit R16 opt-in. Historical consumers keep their page of 200. */
  page_size?: number;
  rawPages?: LabelingRawPageStorageV1;
  /** Runtime preflight, cached by the existing private storage adapter. */
  assertRawReady?: () => Promise<void>;
  /** True only for a runtime writer that authenticates a byte-for-byte readback. */
  storeRawVerified?: boolean;
  storeRaw: (args: {
    workspace_id: string;
    run_id: string;
    call_id: string;
    raw_text: string;
    raw_sha256: string;
  }) => Promise<string>;
  loadRaw?: (args: {
    workspace_id: string;
    run_id: string;
    call_id: string;
    storage_key: string;
    raw_sha256: string;
    size_bytes: number;
  }) => Promise<string>;
}) {
  const db = options.database;
  const pageSize=options.page_size??200;
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>LABELING_RAW_PAGE_MAX_MEMBERS_V1)fail("labeling_page_size_invalid",400);
  async function lock(c: PoolClient, run: LabelingRunV1) {
    const found = (
      await c.query(
        `SELECT id FROM signal_labeling_runs WHERE id=$1 AND lease_token=$2 AND lease_until>now() FOR UPDATE`,
        [run.id, run.lease_token],
      )
    ).rows[0];
    if (!found) fail("labeling_lease_lost");
  }
  // Raw planning/attachment updates only its own page/calls. SHARE allows
  // disjoint pages to progress, while conflicting with every lease UPDATE.
  // Check the physical clock after acquiring the fence: a waiter cannot use
  // transaction-start `now()` to attach after its lease expired behind a writer.
  async function rawRunReadFence(c:PoolClient,run:LabelingRunV1){
    const found=(await c.query(`WITH raw_run_fence AS MATERIALIZED(
      SELECT id,lease_until FROM signal_labeling_runs
      WHERE id=$1 AND lease_token=$2 AND workspace_id=$3 FOR SHARE)
      SELECT id FROM raw_run_fence WHERE lease_until>clock_timestamp()`,
      [run.id,run.lease_token,run.workspace_id])).rows[0];
    if(!found)fail("labeling_lease_lost");
  }
  const rawPages=options.rawPages?createLabelingRawPageStoreV1({database:db,storage:options.rawPages,
    withRunReadFence:(run,fn)=>tx(db,async c=>{await rawRunReadFence(c,run);return fn(c);})}):null;
  const nativePendingReserve=options.adapter?.reserve_selection==='native_listening_pending'
    &&options.adapter.parallel_native_pages===true&&rawPages!==null;
  async function pageMutationFence(c:PoolClient,run:LabelingRunV1){
    if(options.adapter?.parallel_native_pages===true&&rawPages)await rawRunReadFence(c,run);
    else await lock(c,run);
  }
  async function lockMutationCalls(c:PoolClient,run:LabelingRunV1,calls:LabelingCallV1<Input>[],pages?:Array<{call:LabelingCallV1<Input>;results:Result[]}>){
    const ids=calls.map(call=>call.id);
    if(new Set(ids).size!==ids.length)fail('labeling_result_call_conflict');
    // Match raw planning/attachment's global call order. PostgreSQL compares
    // JSONB results without reserializing canonical numeric spellings in JS.
    const found=await c.query<{id:string}>(`SELECT id FROM signal_labeling_calls
      WHERE workspace_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE`,[run.workspace_id,run.id,ids]);
    if(found.rows.length!==calls.length)fail('labeling_result_call_conflict');
    if(!pages)return new Set<string>();
    // A separate statement sees the committed row after any lock wait. Never
    // approve a divergent replay from a pre-wait snapshot of results_applied.
    const checked=await c.query<{id:string;results_applied:boolean;replay_ok:boolean}>(`SELECT call.id,call.results_applied,
      (NOT call.results_applied OR call.results IS NOT DISTINCT FROM planned.results) replay_ok
      FROM signal_labeling_calls call JOIN jsonb_to_recordset($4::jsonb) planned(id uuid,results jsonb) ON planned.id=call.id
      WHERE call.workspace_id=$1 AND call.run_id=$2 AND call.id=ANY($3::uuid[])`,
      [run.workspace_id,run.id,ids,JSON.stringify(pages.map(page=>({id:page.call.id,results:page.results})))]);
    if(checked.rows.length!==calls.length)fail('labeling_result_call_conflict');
    if(checked.rows.some(row=>!row.replay_ok))fail('labeling_result_replay_conflict');
    return new Set(checked.rows.filter(row=>row.results_applied).map(row=>row.id));
  }

  async function registerMutationFence(c:PoolClient,run:LabelingRunV1,operation:'mark'|'apply'){
    // One deferred check per transaction covers waits after the initial fence,
    // including a delayed COMMIT; it never upgrades SHARE to UPDATE.
    await c.query(`INSERT INTO signal_labeling_page_mutation_fences(workspace_id,run_id,lease_token,operation)
      VALUES($1,$2,$3,$4)`,[run.workspace_id,run.id,run.lease_token,operation]);
  }
  async function authority(c: PoolClient, run: LabelingRunV1, amount: number) {
    // Policy lifecycle triggers take this lock. Read only after acquiring it so a
    // revocation committed while this call waited cannot leave stale authority.
    await c.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||organization_id::text,0))
       FROM signal_workspaces WHERE id=$1`,
      [run.workspace_id],
    );
    const policy: LabelingPolicyV1|null|undefined = options.adapter?.policy ? await options.adapter.policy(c,run) : (
      await c.query<{
        organization_id: string;
        budget_date: string;
        budget_timezone: string;
        daily_cap_micro_usd: string | null;
        max_execution_micro_usd: string | null;
        provider: string;
        model: string;
        action: string;
      }>(
        `SELECT w.organization_id,p.budget_timezone,(now() AT TIME ZONE p.budget_timezone)::date::text budget_date,p.daily_cap_micro_usd::text,a.max_execution_micro_usd::text,a.provider,a.model,a.action
   FROM signal_workspaces w JOIN signal_processing_admissions admission ON admission.id=$2 AND admission.workspace_id=w.id AND admission.target_id=$3
   JOIN signal_processing_policy_versions p ON p.id=admission.policy_version_id JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action=admission.action
   WHERE w.id=$1 AND p.status='active' AND p.valid_from<=now() AND p.valid_until>now()`,
        [run.workspace_id, run.processing_admission_id, run.id],
      )
    ).rows[0];
    if (
      !policy ||
      policy.provider !== run.identity.provider ||
      policy.model !== run.identity.model ||
      policy.action !== (options.adapter?.policy_action ?? (run.kind === "membership" ? "concept_membership" : "mention_facets"))
    )
      fail("labeling_policy_changed");
    await c.query("SELECT signal_processing_lock_v1($1,$2::date)", [
      policy.organization_id,
      policy.budget_date,
    ]);
    await authorize(c, run.workspace_id, run.actor_user_id, true,
      options.adapter?.feature ?? (run.kind === "membership" ? "concept_membership" : "mention_facets"));
    const current = await inspectFacetContextChangeV1(c, run.workspace_id);
    if (current.digest !== run.entity_context_digest)
      fail("labeling_context_changed");
    const prepared = (
      await c.query(
        `SELECT 1 FROM signal_labeling_runs r JOIN signal_corpus_preparation_runs p ON p.id=r.preparation_run_id JOIN signal_corpus_preparation_input_state s ON s.workspace_id=p.workspace_id AND s.input_revision=p.input_revision WHERE r.id=$1 AND p.status='completed' AND (p.policy_valid_until IS NULL OR p.policy_valid_until>now())`,
        [run.id],
      )
    ).rows[0];
    if (!prepared) fail("labeling_preparation_changed");
    await options.adapter?.authority?.(c, run);
    const exposure = (
      await c.query<{ total_micro_usd: string }>(
        `SELECT total_micro_usd::text FROM signal_processing_org_exposure_v1($1,$2::date,$3)`,
        [policy.organization_id, policy.budget_date, policy.budget_timezone],
      )
    ).rows[0]!;
    const spent = Number(await readSignalLabelingRunExposureV1(c,run.id));
    // Only the explicit scoped pilot successor can supersede its historical
    // run ceiling. Native admissions and all other labelers retain their cap.
    const effectiveRunCap = run.kind === "mass_labeling" && run.processing_admission_id === null && policy.funding_receipt_id
      ? policy.effective_total_cap_micro_usd ?? run.cap_micro_usd : run.cap_micro_usd;
    if (
      (effectiveRunCap !== null &&
        spent + amount > Number(effectiveRunCap)) ||
      (policy.max_execution_micro_usd !== null &&
        spent + amount > Number(policy.max_execution_micro_usd))
    )
      fail("labeling_cap_exhausted");
    if (
      policy.daily_cap_micro_usd !== null &&
      Number(exposure.total_micro_usd) + amount >
        Number(policy.daily_cap_micro_usd)
    )
      fail("labeling_daily_cap_exhausted");
    return policy;
  }
  return {
    ...(rawPages?{
      /** Only the live scheduler may provide IDs it never delivered to evaluate.
       * Missing raw alone is never evidence that a crashed process did not send. */
      async requeueUnsent(run:LabelingRunV1,calls:LabelingCallV1<Input>[]){
        if(!calls.length)return;
        if(new Set(calls.map(call=>call.id)).size!==calls.length)fail("labeling_unsent_requeue_conflict");
        await tx(db,async c=>{
          await lock(c,run);await authority(c,run,0);
          if(!(await c.query(`SELECT 1 FROM signal_labeling_runs WHERE id=$1 AND workspace_id=$2
            AND lease_token=$3::uuid AND lease_until>clock_timestamp()`,[run.id,run.workspace_id,run.lease_token])).rows.length)
            fail("labeling_lease_lost");
          await c.query("SELECT set_config('noisia.labeling_unsent_requeue_v1',$1,true)",
            [JSON.stringify({contract_version:'signal-labeling-unsent-requeue-v1',run_id:run.id,workspace_id:run.workspace_id,
              lease_token:run.lease_token,calls:calls.map(call=>({id:call.id,request_digest:call.request_digest}))})]);
          const changed=await c.query(`UPDATE signal_labeling_calls call SET status='reserved',stop_reason=NULL,updated_at=clock_timestamp()
            FROM jsonb_to_recordset($3::jsonb) known(id uuid,request_digest text)
            WHERE call.run_id=$1 AND call.workspace_id=$2 AND call.id=known.id AND call.request_digest=known.request_digest
              AND EXISTS(SELECT 1 FROM signal_labeling_runs held WHERE held.id=$1 AND held.workspace_id=$2
                AND held.lease_token=$4::uuid AND held.lease_until>clock_timestamp())
              AND call.status IN('submitting','reserved') AND call.provider_batch_id IS NULL
              AND call.raw_sha256 IS NULL AND call.raw_storage_key IS NULL AND call.raw_size_bytes IS NULL
              AND call.raw_storage_verified_at IS NULL AND call.raw_storage_verified_key IS NULL
              AND call.usage IS NULL AND call.settled_micro_usd IS NULL AND call.terminal_exposure_micro_usd=0
              AND NOT call.results_applied AND call.results IS NULL
              AND NOT EXISTS(SELECT 1 FROM signal_labeling_raw_page_members member
                WHERE member.workspace_id=call.workspace_id AND member.run_id=call.run_id AND member.call_id=call.id)
            RETURNING call.id`,[run.id,run.workspace_id,JSON.stringify(calls.map(call=>({id:call.id,request_digest:call.request_digest}))),run.lease_token]);
          await c.query("SELECT set_config('noisia.labeling_unsent_requeue_v1','',true)");
          if(changed.rows.length!==calls.length)fail("labeling_unsent_requeue_conflict");
        });
        for(const call of calls)call.status='reserved';
      },
    }:{}),
    async claim(runId: string): Promise<LabelingRunV1 | null> {
      return tx(db, async (c) => {
        const token = randomUUID();
        const row = (
          await c.query(
            `UPDATE signal_labeling_runs SET lease_token=$2,lease_until=now()+interval '10 minutes',status='running',updated_at=now()
   WHERE id=$1 AND kind=$3 AND ($4::text IS NULL OR membership_snapshot->>'hybrid_stage'=$4)
   AND (status IN('queued','running') OR status='failed' AND (
     error_code='labeling_outcome_unknown' AND EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=$1 AND c.status='unknown')
     OR ${options.adapter?.recover_failed_raw===true?`kind='mass_labeling'
       AND EXISTS(SELECT 1 FROM signal_labeler_versions l JOIN signal_listening_runs owner
         ON owner.run_id=signal_labeling_runs.id AND owner.workspace_id=signal_labeling_runs.workspace_id
         WHERE l.id=signal_labeling_runs.labeler_version_id AND l.identity#>>'{params,request_version}'='listening-jev-v1')
       AND EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=$1 AND c.workspace_id=signal_labeling_runs.workspace_id
         AND c.raw_storage_key IS NOT NULL AND NOT c.results_applied)`:'FALSE'})
   AND NOT EXISTS(SELECT 1 FROM signal_labeling_runs active WHERE active.workspace_id=signal_labeling_runs.workspace_id
     AND active.kind=signal_labeling_runs.kind AND active.id<>signal_labeling_runs.id AND active.status IN('queued','running')))
   AND NOT waiting_full_confirmation AND (lease_until IS NULL OR lease_until<now()) RETURNING id`,
            [runId, token, options.adapter?.kind ?? "facets", options.adapter?.hybrid_stage ?? null],
          )
        ).rows[0];
        if (!row) return null;
        await c.query(
          `UPDATE signal_labeling_calls SET status='unknown',updated_at=now() WHERE run_id=$1 AND status='submitting' AND raw_storage_key IS NULL`,
          [runId],
        );
        return (
          await c.query<LabelingRunV1>(
            `SELECT r.*,l.labeler_digest,l.identity,ce.context FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no WHERE r.id=$1`,
            [runId],
          )
        ).rows[0]!;
      });
    },
    async fail(run: LabelingRunV1, code: string,mode:{preserve_reserved?:boolean}={}) {
      await tx(db, async (c) => {
        await lock(c, run);
        if(code==="labeling_raw_receipt_invalid"){
          await c.query(`UPDATE signal_labeling_calls
            SET status='failed',settled_micro_usd=CASE WHEN status='reserved' THEN settled_micro_usd
              ELSE COALESCE(settled_micro_usd,reserved_micro_usd) END,updated_at=now()
            WHERE run_id=$1 AND (status IN('reserved','submitting','submitted','unknown')
              OR status='settled' AND NOT results_applied)`,[run.id]);
          await c.query(`UPDATE signal_labeling_runs SET error_code=$2,status='failed',updated_at=now() WHERE id=$1`,[run.id,code]);
          return;
        }
        if(!rawPages||mode.preserve_reserved!==true)await c.query(
          `UPDATE signal_labeling_calls SET status='failed',updated_at=now() WHERE run_id=$1 AND status='reserved'`,
          [run.id],
        );
        await c.query(
          `UPDATE signal_labeling_runs SET error_code=$2,status=CASE WHEN EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND (status='submitted' OR raw_storage_key IS NOT NULL AND NOT results_applied)) THEN 'running' ELSE 'failed' END,updated_at=now() WHERE id=$1`,
          [run.id, code],
        );
      });
    },
    async renew(run: LabelingRunV1) {
      await tx(db, async (c) => {
        await lock(c, run);
        if (!run.error_code) await authority(c, run, 0);
        const changed = await c.query(
          `UPDATE signal_labeling_runs SET lease_until=now()+interval '10 minutes' WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='running' RETURNING id`,
          [run.id, run.lease_token],
        );
        if (!changed.rows.length) fail("labeling_lease_lost");
      });
    },
    async release(run: LabelingRunV1, cadence: {immediate?:boolean}={}) {
      await db.query(
        `UPDATE signal_labeling_runs SET lease_token=NULL,lease_until=NULL,
         next_poll_at=CASE WHEN EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND status='unknown')
           THEN now()+interval '1 hour' WHEN $3::boolean AND error_code IS NULL THEN now()
           ELSE now()+interval '30 seconds' END WHERE id=$1 AND lease_token=$2`,
        [run.id, run.lease_token, cadence.immediate===true],
      );
    },
    async inputs(run: LabelingRunV1,bounds?:LabelingInputBoundsV1) {
      if(bounds){
        let read:LabelingInputBoundsV1;try{read=validateLabelingInputBoundsV1(bounds,pageSize);}catch{fail('labeling_input_bounds_invalid',400);}
        if(!options.adapter?.bounded_inputs)fail('labeling_bounded_inputs_unavailable',409);
        return tx(db,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
          return options.adapter!.bounded_inputs!(c,run,read);}).catch(error=>{
            if(error instanceof Error&&['labeling_input_memory_bound','labeling_input_metadata_invalid'].includes(error.message))fail(error.message,409);
            throw error;
          });
      }
      if (options.adapter) return options.adapter.inputs(db, run);
      return selectFacetInputsV1(
        db,
        run.workspace_id,
        run.cursor_root_id,
        pageSize,
      ) as Promise<Input[]>;
    },
    async reserve(
      run: LabelingRunV1,
      proposals: LabelingCallProposalV1<Input>[],
      advanceCursor = true,
    ): Promise<LabelingCallV1<Input>[]> {
      return tx(db, async (c) => {
        if(nativePendingReserve){
          await rawRunReadFence(c,run);
          // Serialize the existence snapshot with the SAME policy/day/actor
          // authority used below. Zero only reads exposure; it reserves no
          // money. A concurrent replay must observe the committed first call
          // before computing fresh cost, avoiding a false cap rejection.
          await authority(c,run,0);
        }else await lock(c, run);
        const existing = (
          await c.query<LabelingCallV1<Input>>(
            "SELECT * FROM signal_labeling_calls WHERE custom_id=ANY($1::text[])",
            [proposals.map((p) => p.custom_id)],
          )
        ).rows;
        const fresh = proposals.filter(
          (p) => !existing.some((e) => e.custom_id === p.custom_id),
        );
        const amount = fresh.reduce((n, p) => n + p.reserved_micro_usd, 0);
        const policy = await authority(c, run, amount);
        if (fresh.length)
          await c.query(
            `INSERT INTO signal_labeling_calls(run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,retry_depth,budget_date,budget_timezone)
   SELECT $1,$2,$3,$4,$5,x.custom_id,x.request_digest,x.request,x.inputs,x.reserved_micro_usd,COALESCE(x.retry_depth,0),$7::date,$8
   FROM jsonb_to_recordset($6::jsonb) x(custom_id text,request_digest text,request jsonb,inputs jsonb,reserved_micro_usd bigint,retry_depth integer) ON CONFLICT(custom_id) DO NOTHING`,
            [
              run.id,
              run.workspace_id,
              run.identity.provider,
              run.identity.model,
              run.identity.provider === "typesafe" ? "sync" : "batch",
              JSON.stringify(fresh),
              policy.budget_date,
              policy.budget_timezone,
            ],
          );
        if (advanceCursor && !nativePendingReserve) {
          const ids = proposals
            .flatMap((p) => p.inputs.map((i) => i.root_id))
            .sort();
          if (ids.length) {
            run.cursor_root_id = ids.at(-1)!;
            await c.query(
              "UPDATE signal_labeling_runs SET cursor_root_id=$2 WHERE id=$1",
              [run.id, run.cursor_root_id],
            );
          }
        }
        return (
          await c.query<LabelingCallV1<Input>>(
            "SELECT * FROM signal_labeling_calls WHERE run_id=$1 AND custom_id=ANY($2::text[]) ORDER BY custom_id",
            [run.id, proposals.map((p) => p.custom_id)],
          )
        ).rows;
      });
    },
    async calls(run: LabelingRunV1,read?:{metadata_only?:boolean;call_ids?:string[]}): Promise<LabelingCallV1<Input>[]> {
      if(read&&(!read.metadata_only&&read.call_ids===undefined||read.metadata_only!==undefined&&typeof read.metadata_only!=='boolean'
        ||read.call_ids!==undefined&&(!Array.isArray(read.call_ids)||read.call_ids.length>pageSize
          ||read.call_ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id))
          ||new Set(read.call_ids.map(id=>id.toLowerCase())).size!==read.call_ids.length)))fail('labeling_call_selection_invalid',400);
      const selected=read?await tx(db,async c=>{
        await lock(c,run);await authority(c,run,0);
        return (await c.query<LabelingCallV1<Input>>(`SELECT ${read.metadata_only?`call.id,call.custom_id,call.request_digest,call.status,call.results_applied,call.provider_batch_id,
            call.retry_depth,call.reserved_micro_usd,call.created_at,call.updated_at,call.raw_storage_key,
            '{}'::jsonb request,'[]'::jsonb inputs`:'call.*'},
          octet_length(call.request::text) request_size_bytes,octet_length(call.inputs::text) input_size_bytes,
          (call.raw_storage_key IS NOT NULL OR member.call_id IS NOT NULL) has_raw,
          member.page_id raw_page_id,page.size_bytes raw_page_size_bytes,
          COALESCE(member.raw_size_bytes,call.raw_size_bytes) raw_size_bytes
          FROM signal_labeling_calls call
          LEFT JOIN signal_labeling_raw_page_members member ON member.workspace_id=call.workspace_id AND member.run_id=call.run_id AND member.call_id=call.id
          LEFT JOIN signal_labeling_raw_pages page ON page.id=member.page_id AND page.workspace_id=call.workspace_id AND page.run_id=call.run_id
          WHERE call.run_id=$1 AND call.workspace_id=$2 AND NOT call.results_applied AND ($3::uuid[] IS NULL OR call.id=ANY($3::uuid[]))
          ORDER BY (call.raw_storage_key IS NOT NULL OR member.call_id IS NOT NULL) DESC,(call.status='unknown') DESC,
            member.page_id NULLS LAST,member.byte_offset NULLS LAST,call.created_at,call.id LIMIT $4`,
          [run.id,run.workspace_id,read.call_ids??null,pageSize])).rows;
      }):(await db.query<LabelingCallV1<Input>>(
          `SELECT * FROM signal_labeling_calls WHERE run_id=$1
           ${options.adapter?.pending_calls_only ? "AND NOT results_applied" : ""}
           ORDER BY created_at,id ${options.adapter?.pending_calls_only ? "LIMIT $2" : ""}`,
          options.adapter?.pending_calls_only?[run.id,pageSize]:[run.id],
        )).rows;
      const calls=selected.map(call=>({...call,raw_body:read?.metadata_only?null:call.raw_body??null}));
      if(read?.metadata_only)return calls;
      let pageCalls=new Set<string>();
      if(rawPages){
        try{pageCalls=await rawPages.loadCalls(run,calls.filter(c=>!c.results_applied));}
        catch(error){
          if(error instanceof SignalLabelingError)throw error;
          if(error instanceof SyntaxError||error instanceof Error&&["labeling_raw_page_invalid","labeling_raw_receipt_invalid",
            "workspace_engine_storage_object_missing","workspace_engine_storage_digest_invalid","workspace_engine_storage_part_invalid",
            "workspace_engine_storage_manifest_invalid","workspace_engine_storage_reference_invalid",
            "workspace_engine_storage_response_too_large"].includes(error.message))fail("labeling_raw_receipt_invalid",503);
          fail("labeling_raw_storage_unavailable",503);
        }
      }
      for (const call of calls) {
        const stored = call as LabelingCallV1<Input> & {
          raw_storage_key?: string | null;
          raw_sha256?: string | null;
          raw_size_bytes?: string | number | null;
        };
        if (!pageCalls.has(call.id) && stored.raw_storage_key && stored.raw_sha256 && !call.raw_body && !call.results_applied) {
          if (!options.loadRaw) fail("labeling_raw_loader_unavailable", 503);
          const size = Number(stored.raw_size_bytes);
          if (!Number.isSafeInteger(size) || size < 0) fail("labeling_raw_receipt_invalid", 503);
          try{call.raw_body = await options.loadRaw({ workspace_id: run.workspace_id, run_id: run.id,
            call_id: call.id, storage_key: stored.raw_storage_key, raw_sha256: stored.raw_sha256,
            size_bytes: size });}
          catch(error){
            if(error instanceof SyntaxError || error instanceof Error && ["workspace_engine_storage_object_missing",
              "workspace_engine_storage_digest_invalid","workspace_engine_storage_part_invalid",
              "workspace_engine_storage_manifest_invalid","workspace_engine_storage_reference_invalid",
              "workspace_engine_storage_response_too_large",
              "labeling_raw_receipt_invalid"].includes(error.message))
              fail("labeling_raw_receipt_invalid",503);
            fail("labeling_raw_storage_unavailable",503);
          }
          if (Buffer.byteLength(call.raw_body)!==size ||
            `sha256:${createHash("sha256").update(call.raw_body).digest("hex")}` !== stored.raw_sha256)
            fail("labeling_raw_receipt_invalid", 503);
        }
      }
      return calls;
    },
    async refresh(run: LabelingRunV1): Promise<{status:string;error_code:string|null}> {
      const row=(await db.query<{status:string;error_code:string|null}>(
        "SELECT status,error_code FROM signal_labeling_runs WHERE id=$1 AND lease_token=$2",
        [run.id,run.lease_token],
      )).rows[0];
      if(!row)fail("labeling_lease_lost");
      return row;
    },
    ...(nativePendingReserve?{
      /** Constructor-authenticated Listening only: one fresh, covered native
       * cohort. The ordinary INSERT and UPDATE retain both E statement guards.
       * Unlike the legacy path, a denied Mark rolls back its fresh reservation. */
      async admitAndMarkSelected(run:LabelingRunV1,proposals:LabelingCallProposalV1<Input>[],callbacks:LabelingAdmissionSelectionV1<Input>):Promise<LabelingAdmissionResultV1<Input>>{
        await options.assertRawReady?.();
        const plan=planNativeListeningAdmissionPacketV1(run,proposals,Math.min(pageSize,1024));
        const c=await db.connect();let discardClient=false,open=false,rollbackSent=false,rollbackAck=false,dmlSent=false,commitSent=false;
        let selected:ReadonlyArray<LabelingCallProposalV1<Input>>=[],ids:string[]=[],customIds:string[]=[];
        const legacy=async():Promise<LabelingAdmissionResultV1<Input>>=>{
          rollbackSent=true;await c.query('ROLLBACK');rollbackAck=true;open=false;return{kind:'legacy'};
        };
        const rejectAsync=(value:unknown)=>{
          if(value&&(['object','function'].includes(typeof value))&&typeof(value as {then?:unknown}).then==='function'){
            if(value instanceof Promise)void value.catch(()=>undefined);
            fail('labeling_admission_callback_invalid',400);
          }
        };
        try{
          await c.query('BEGIN');open=true;
          await pageMutationFence(c,run);await authority(c,run,0);
          if(!plan)return await legacy();
          // Preserve the original whole-row SELECT permissions and serialize
          // existence with the same policy lock as native reservations.
          const existing=await c.query('SELECT * FROM signal_labeling_calls WHERE custom_id=ANY($1::text[])',[proposals.map(p=>p.custom_id)]);
          if(existing.rows.length)return await legacy();
          const profiles=await c.query<{profile:unknown}>(NATIVE_LISTENING_COVERED_PROFILES_SQL_V1,
            [run.workspace_id,plan.configuration_digest,plan.model,[...new Set(plan.rows.map(row=>row.shape.shape_digest))],run.id]);
          if(!nativeListeningAdmissionCoveredV1(plan,profiles.rows.map(row=>row.profile)))return await legacy();
          if(typeof callbacks?.selectFresh!=='function'||typeof callbacks.validateBeforeCommit!=='function')fail('labeling_admission_callback_invalid',400);
          const selection:unknown=callbacks.selectFresh(proposals);rejectAsync(selection);
          if(!Array.isArray(selection))fail('labeling_admission_selection_invalid',400);
          selected=[...selection] as LabelingCallProposalV1<Input>[];
          const packet=nativeListeningAdmissionPacketBodyV1(plan,selected);
          customIds=selected.map(proposal=>proposal.custom_id);
          let calls:LabelingCallV1<Input>[]=[];
          if(selected.length){
            const amount=selected.reduce((sum,p)=>sum+BigInt(p.reserved_micro_usd),0n);
            if(amount>BigInt(Number.MAX_SAFE_INTEGER))fail('labeling_money_invalid',400);
            const policy=await authority(c,run,Number(amount));
            // From this point no failure, even an acknowledged rollback, can
            // return legacy or silently launch a second reservation attempt.
            dmlSent=true;
            const inserted=await c.query<Record<string,unknown>>(NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1,
              [run.id,run.workspace_id,run.identity.provider,run.identity.model,'sync',packet,policy.budget_date,policy.budget_timezone]);
            calls=reconstructNativeListeningAdmissionRowsV1(run,plan,selected,inserted.rows,'reserved');ids=calls.map(call=>call.id);
            await pageMutationFence(c,run);await authority(c,run,0);
            await lockMutationCalls(c,run,calls);await options.adapter?.beforeSubmit?.(c,run,calls);
            await rawRunReadFence(c,run);await registerMutationFence(c,run,'mark');
            const changed=await c.query<Record<string,unknown>>(NATIVE_LISTENING_ADMISSION_MARK_SQL_V1,[run.id,run.workspace_id,ids,packet]);
            calls=reconstructNativeListeningAdmissionRowsV1(run,plan,selected,changed.rows,'submitting');
          }
          const callsFingerprint=()=>createHash('sha256').update(JSON.stringify(calls)).digest('hex');
          const beforeValidation=callsFingerprint();
          const validation:unknown=callbacks.validateBeforeCommit(calls,selected);rejectAsync(validation);
          // A callback may register the roster/bytes but cannot poison what is
          // about to be committed or handed to evaluate after the ACK.
          if(callsFingerprint()!==beforeValidation)fail('labeling_admission_handoff_changed',400);
          validateNativeListeningAdmissionSelectionV1(plan,selected);
          validateNativeListeningAdmissionRowsV1(run,selected,calls,'submitting');
          commitSent=true;await c.query('COMMIT');open=false;return{kind:'committed',calls};
        }catch(primary){
          let cause=primary;
          if(commitSent)discardClient=true;
          if(open&&!rollbackSent){rollbackSent=true;try{await c.query('ROLLBACK');rollbackAck=true;open=false;}
            catch(rollback){discardClient=true;cause=new AggregateError([primary,rollback],'labeling_admission_body_and_rollback_failed',{cause:primary});}}
          if(!rollbackAck&&open)discardClient=true;
          if(dmlSent)throw new LabelingAdmissionFailureV1(cause,commitSent||!rollbackAck?'unknown':'rolled_back',Object.freeze([...ids]),Object.freeze([...customIds]));
          throw cause;
        }finally{c.release(discardClient);}
      },
      /** Select only already-committed, memory-owned calls after the common
       * authority wait. This callback grants no DB authority and receives no client. */
      async markSubmittingSelected(run:LabelingRunV1,selectCommitted:()=>ReadonlyArray<LabelingCallV1<Input>>):Promise<ReadonlyArray<LabelingCallV1<Input>>>{
        await options.assertRawReady?.();
        const c=await db.connect();let discardClient=false;
        try{
          await c.query("BEGIN");
          await pageMutationFence(c,run);await authority(c,run,0);
          const selected:unknown=selectCommitted();
          if(!Array.isArray(selected)){
            // Reject async selectors without awaiting them or leaking a rejected
            // native Promise as an unhandled rejection on this failure path.
            if(selected instanceof Promise)void selected.catch(()=>undefined);
            fail('labeling_mark_selection_invalid',400);
          }
          const calls:LabelingCallV1<Input>[]=[...selected];
          if(calls.length>pageSize||calls.some(call=>!call||typeof call.id!=='string'||!call.id||call.status!=='reserved'||Boolean(call.raw_body)))
            fail('labeling_mark_selection_invalid',400);
          if(calls.length){
            await lockMutationCalls(c,run,calls);
            await options.adapter?.beforeSubmit?.(c,run,calls);
            await rawRunReadFence(c,run);await registerMutationFence(c,run,'mark');
            const changed=await c.query(
              `UPDATE signal_labeling_calls SET status='submitting',updated_at=now() WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status='reserved' RETURNING id`,
              [run.id,calls.map(call=>call.id)]);
            if(changed.rows.length!==calls.length)fail('labeling_submission_conflict');
          }
          await c.query("COMMIT");return calls;
        }catch(primary){
          try{await c.query("ROLLBACK");}
          catch(rollback){discardClient=true;throw new AggregateError([primary,rollback],'labeling_mark_body_and_rollback_failed',{cause:primary});}
          throw primary;
        }finally{c.release(discardClient);}
      },
    }:{}),
    async markSubmitting(run: LabelingRunV1, calls: LabelingCallV1<Input>[]) {
      await options.assertRawReady?.();
      await tx(db, async (c) => {
        await pageMutationFence(c,run);
        await authority(c, run, 0);
        if(options.adapter?.parallel_native_pages===true&&rawPages)await lockMutationCalls(c,run,calls);
        await options.adapter?.beforeSubmit?.(c, run, calls);
        if(options.adapter?.parallel_native_pages===true&&rawPages){
          await rawRunReadFence(c,run);await registerMutationFence(c,run,'mark');
        }
        const changed = await c.query(
          `UPDATE signal_labeling_calls SET status='submitting',updated_at=now() WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status='reserved' RETURNING id`,
          [run.id, calls.map((x) => x.id)],
        );
        if (changed.rows.length !== calls.length)
          fail("labeling_submission_conflict");
      });
    },
    async markSubmitted(
      run: LabelingRunV1,
      calls: LabelingCallV1<Input>[],
      batchId: string | null,
    ) {
      await db.query(
        `UPDATE signal_labeling_calls SET status='submitted',provider_batch_id=$3,updated_at=now() WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status='submitting'`,
        [run.id, calls.map((x) => x.id), batchId],
      );
    },
    async recoverUnknownBatch(run: LabelingRunV1, calls: LabelingCallV1<Input>[], batchId: string) {
      await tx(db, async (c) => {
        await lock(c, run);
        const changed = await c.query(
          `UPDATE signal_labeling_calls SET status='submitted',provider_batch_id=$3,updated_at=now()
           WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status='unknown'
           AND (provider_batch_id IS NULL OR provider_batch_id=$3) RETURNING id`,
          [run.id, calls.map((call) => call.id), batchId],
        );
        if (changed.rows.length !== calls.length) fail("labeling_reconciliation_conflict");
      });
    },
    async releaseUnknown(run: LabelingRunV1, calls: LabelingCallV1<Input>[], reason: string) {
      await tx(db, async (c) => {
        await lock(c, run);
        const changed = await c.query(
          `UPDATE signal_labeling_calls SET status='failed',results_applied=true,
           results='[]'::jsonb,stop_reason=$3,updated_at=now()
           WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status='unknown'
             AND (provider_batch_id IS NULL OR $3 IN ('unresolvable_after_window','unresolvable_timestamp')) RETURNING id`,
          [run.id, calls.map((call) => call.id), reason],
        );
        if (changed.rows.length !== calls.length) fail("labeling_reconciliation_conflict");
        if (reason === "unresolvable_after_window" || reason === "unresolvable_timestamp")
          await c.query(`UPDATE signal_labeling_runs SET error_code=$2,updated_at=now() WHERE id=$1`,[run.id,`labeling_${reason}`]);
      });
    },
    async clearUnknownFailure(run: LabelingRunV1) {
      await tx(db, async (c) => {
        await lock(c, run);
        await c.query(
          `UPDATE signal_labeling_runs SET error_code=NULL,updated_at=now()
           WHERE id=$1 AND error_code='labeling_outcome_unknown'
           AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND status='unknown')`,
          [run.id],
        );
      });
    },
    async markFailed(
      run: LabelingRunV1,
      calls: LabelingCallV1<Input>[],
      unknown: boolean,
      createError?: unknown,
    ) {
      await db.query(
        `UPDATE signal_labeling_calls SET status=$3,stop_reason=COALESCE($4,stop_reason),updated_at=now() WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status IN('reserved','submitting','submitted')`,
        [run.id, calls.map((x) => x.id), unknown ? "unknown" : "failed", labelingCreateFailureReceiptV1(createError)],
      );
    },
    async persistRaw(
      run: LabelingRunV1,
      call: LabelingCallV1<Input>,
      raw: string,
    ) {
      const sha = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
      const key = await options.storeRaw({
        workspace_id: run.workspace_id,
        run_id: run.id,
        call_id: call.id,
        raw_text: raw,
        raw_sha256: sha,
      });
      const result = await db.query(
        `UPDATE signal_labeling_calls SET raw_sha256=$3,raw_storage_key=$4,raw_size_bytes=$5,
          raw_storage_verified_at=CASE WHEN $6 THEN COALESCE(raw_storage_verified_at,now()) ELSE raw_storage_verified_at END,
          raw_storage_verified_key=CASE WHEN $6 THEN $4 ELSE raw_storage_verified_key END,updated_at=now() WHERE run_id=$1 AND id=$2 AND (raw_sha256 IS NULL OR raw_sha256=$3 AND raw_storage_key=$4 AND raw_size_bytes=$5) RETURNING id`,
        [run.id, call.id, sha, key, Buffer.byteLength(raw), options.storeRawVerified === true],
      );
      if (!result.rows.length) fail("labeling_raw_conflict");
      call.raw_body = raw;
    },
    async settle(
      run: LabelingRunV1,
      call: LabelingCallV1<Input>,
      result: {
        usage: LlmUsageV1;
        settled_micro_usd: number;
        stop_reason?: string | null;
        refusal_category?: string;
      },
    ) {
      const changed = await db.query(
        // Once booked, the stored amount is the historical tariff receipt.
        // Replay validates identical usage and leaves that receipt byte-for-byte intact.
        `UPDATE signal_labeling_calls SET status='settled',usage=$3::jsonb,
          settled_micro_usd=CASE WHEN status='settled' THEN settled_micro_usd ELSE $4 END,
          stop_reason=CASE WHEN status='settled' THEN stop_reason ELSE $5 END,
          refusal_category=CASE WHEN status='settled' THEN refusal_category ELSE $6 END,
          updated_at=CASE WHEN status='settled' THEN updated_at ELSE now() END
   WHERE run_id=$1 AND id=$2 AND raw_sha256 IS NOT NULL AND (status<>'settled' OR usage=$3::jsonb) RETURNING id`,
        [
          run.id,
          call.id,
          JSON.stringify(result.usage),
          result.settled_micro_usd,
          result.stop_reason ?? null,
          result.refusal_category ?? null,
        ],
      );
      if (!changed.rows.length) fail("labeling_settlement_conflict");
    },
    async persistRawPage(
      run: LabelingRunV1,
      pages: Array<{ call: LabelingCallV1<Input>; raw: string }>,
    ) {
      if(!pages.length)return;
      if(rawPages)return rawPages.persist(run,pages);
      const receipts = [];
      for (const page of pages) {
        const sha = `sha256:${createHash("sha256").update(page.raw).digest("hex")}`;
        const key = await options.storeRaw({
          workspace_id: run.workspace_id,
          run_id: run.id,
          call_id: page.call.id,
          raw_text: page.raw,
          raw_sha256: sha,
        });
        receipts.push({ id: page.call.id, sha, key, size: Buffer.byteLength(page.raw) });
      }
      const changed = await db.query(
        `UPDATE signal_labeling_calls c SET raw_sha256=x.sha,raw_storage_key=x.key,raw_size_bytes=x.size,updated_at=now()
   FROM jsonb_to_recordset($2::jsonb) x(id uuid,sha text,key text,size bigint) WHERE c.run_id=$1 AND c.id=x.id AND (c.raw_sha256 IS NULL OR c.raw_sha256=x.sha AND c.raw_storage_key=x.key AND c.raw_size_bytes=x.size) RETURNING c.id`,
        [run.id, JSON.stringify(receipts.map(({id,sha,key,size})=>({id,sha,key,size})))],
      );
      if (changed.rows.length !== pages.length) fail("labeling_raw_conflict");
      for (const p of pages) p.call.raw_body = p.raw;
    },
    async settlePage(
      run: LabelingRunV1,
      pages: Array<{
        call: LabelingCallV1<Input>;
        usage: LlmUsageV1;
        settled_micro_usd: number;
        stop_reason?: string | null;
        refusal_category?: string;
      }>,
    ) {
      const changed = await db.query(
        `UPDATE signal_labeling_calls c SET status='settled',usage=x.usage,
          settled_micro_usd=CASE WHEN c.status='settled' THEN c.settled_micro_usd ELSE x.cost END,
          stop_reason=CASE WHEN c.status='settled' THEN c.stop_reason ELSE x.stop_reason END,
          refusal_category=CASE WHEN c.status='settled' THEN c.refusal_category ELSE x.refusal_category END,
          updated_at=CASE WHEN c.status='settled' THEN c.updated_at ELSE now() END
   FROM jsonb_to_recordset($2::jsonb) x(id uuid,usage jsonb,cost bigint,stop_reason text,refusal_category text)
   WHERE c.run_id=$1 AND c.id=x.id AND c.raw_sha256 IS NOT NULL AND (c.status<>'settled' OR c.usage=x.usage) RETURNING c.id`,
        [
          run.id,
          JSON.stringify(
            pages.map((p) => ({
              id: p.call.id,
              usage: p.usage,
              cost: p.settled_micro_usd,
              stop_reason: p.stop_reason ?? null,
              refusal_category: p.refusal_category ?? null,
            })),
          ),
        ],
      );
      if (changed.rows.length !== pages.length)
        fail("labeling_settlement_conflict");
    },
    async apply(
      run: LabelingRunV1,
      pages: Array<{ call: LabelingCallV1<Input>; results: Result[] }>,
    ) {
      await tx(db, async (c) => {
        await pageMutationFence(c,run);
        if(options.adapter?.parallel_native_pages===true&&rawPages){
          const applied=await lockMutationCalls(c,run,pages.map(page=>page.call),pages);
          pages=pages.filter(page=>!applied.has(page.call.id));if(!pages.length)return;
          await rawRunReadFence(c,run);await registerMutationFence(c,run,'apply');
        }
        const persistResults = async () => {
          const changed = await c.query(
          `UPDATE signal_labeling_calls call SET results_applied=true,results=page.results,updated_at=now()
           FROM jsonb_to_recordset($2::jsonb) page(id uuid,results jsonb)
           WHERE call.run_id=$1 AND call.id=page.id`,
          [run.id, JSON.stringify(pages.map((p) => ({ id: p.call.id, results: p.results })))],
          );
          if (changed.rowCount !== pages.length) fail("labeling_result_call_conflict");
        };
        if (options.adapter?.persist_results_before_write) await persistResults();
        if (options.adapter) await options.adapter.write(c, run, pages);
        else
          await writeFacetResultsV1(c, {
            workspace_id: run.workspace_id,
            labeler_digest: run.labeler_digest,
            call_id: pages[0]?.call.id ?? "",
            results: pages.flatMap((page) =>
              (page.results as FacetResult[]).map((r) => ({
                ...r,
                call_id: page.call.id,
              })),
            ),
          });
        if (!options.adapter?.persist_results_before_write) await persistResults();
      });
    },
    async finish(run: LabelingRunV1) {
      return tx(db, async (c) => {
        await lock(c, run);
        if(options.adapter?.hybrid_stage!==undefined)await c.query(`UPDATE signal_labeling_calls call
          SET status='unknown',stop_reason='provider_usage_invalid',updated_at=now()
          WHERE call.run_id=$1 AND call.status IN('submitted','unknown') AND call.results_applied
          AND call.settled_micro_usd IS NULL AND call.raw_storage_key IS NOT NULL
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(call.results,'[]'::jsonb)) result
            WHERE result->>'error_code' IN('provider_usage_invalid','provider_result_missing'))`,[run.id]);
        await c.query(`UPDATE signal_labeling_calls call SET status='failed',
          settled_micro_usd=CASE WHEN $2::boolean THEN call.settled_micro_usd
            ELSE COALESCE(call.settled_micro_usd,call.reserved_micro_usd) END,
          terminal_exposure_micro_usd=CASE WHEN $2::boolean AND call.settled_micro_usd IS NULL
            THEN call.reserved_micro_usd ELSE call.terminal_exposure_micro_usd END,
          stop_reason=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(call.results,'[]'::jsonb)) result
            WHERE result->>'error_code'='provider_usage_invalid') THEN 'provider_usage_invalid'
            ELSE 'provider_result_missing' END,updated_at=now()
          WHERE call.run_id=$1 AND call.status IN ('submitted','unknown') AND call.results_applied
          AND (NOT $2::boolean OR call.raw_storage_key IS NULL AND call.raw_sha256 IS NULL)
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(call.results,'[]'::jsonb)) result
            WHERE result->>'error_code' IN ('provider_usage_invalid','provider_result_missing'))`,[run.id,options.adapter?.hybrid_stage !== undefined]);
        const calls = (
          await c.query(
            `SELECT count(*) FILTER(WHERE status='unknown')::int unknown,count(*) FILTER(WHERE status IN('reserved','submitting','submitted') OR raw_storage_key IS NOT NULL AND NOT results_applied)::int active FROM signal_labeling_calls WHERE run_id=$1`,
            [run.id],
          )
        ).rows[0]!;
        const combined = options.adapter?.pending_and_available
          ? await options.adapter.pending_and_available(c,run) : null;
        const pending = combined ? combined.pending : options.adapter
          ? await options.adapter.pending(c, run)
          : Number(
              (
                await c.query(
                  `SELECT count(*) count FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND status='pending'`,
                  [run.workspace_id],
                )
              ).rows[0]!.count,
            );
        const available = combined ? Number(combined.available) : options.adapter?.has_inputs ? Number(await options.adapter.has_inputs(c,run)) : (
          options.adapter
            ? await options.adapter.inputs(c, run)
            : await selectFacetInputsV1(
                c,
                run.workspace_id,
                run.cursor_root_id,
                200,
              )
        ).length;
        const blocked = pending > 0 && available === 0 && !calls.active;
        const priorError = (
          await c.query<{ error_code: string | null }>(
            `SELECT CASE WHEN EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND stop_reason='provider_usage_invalid')
              THEN 'labeling_provider_usage_invalid'
              WHEN EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND stop_reason='provider_result_missing')
              THEN 'labeling_provider_result_missing'
              WHEN error_code='labeling_outcome_unknown' AND NOT EXISTS(
                SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND status='unknown') THEN NULL
              ELSE error_code END error_code FROM signal_labeling_runs WHERE id=$1`,
            [run.id],
          )
        ).rows[0]?.error_code;
        const state = calls.active
          ? "running"
          : calls.unknown || blocked || priorError
            ? "failed"
            : !pending && !available
              ? "completed"
              : "running";
        await c.query(
          `UPDATE signal_labeling_runs SET status=$2,error_code=CASE WHEN $3>0 THEN 'labeling_outcome_unknown' ELSE $5 END,counts=jsonb_build_object('pending',$4::int),completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,
          [run.id, state, calls.unknown, pending, priorError],
        );
        return state;
      });
    },
  };
}
export type SignalLabelingStoreV1 = ReturnType<
  typeof createSignalLabelingStoreV1<FacetInput, FacetResult>
>;
/** Confirms the already-admitted full CE transition, without changing its request or budget. */
export async function confirmMentionFacetsV1(args: {
  database: LabelingDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
  run_id: string;
  entity_context_digest: string;
}) {
  return tx(args.database, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
      [args.workspace_id],
    );
    await authorize(c, args.workspace_id, args.actor_user_id, true);
    const context = await inspectFacetContextChangeV1(c, args.workspace_id);
    if (context.digest !== args.entity_context_digest)
      fail("labeling_context_changed");
    const row = (
      await c.query(
        `UPDATE signal_labeling_runs SET waiting_full_confirmation=false,full_recalculation_confirmed=true,updated_at=now()
   WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3 AND entity_context_digest=$4 AND status='queued' AND waiting_full_confirmation RETURNING id`,
        [
          args.run_id,
          args.workspace_id,
          args.actor_user_id,
          args.entity_context_digest,
        ],
      )
    ).rows[0];
    if (!row) fail("labeling_confirmation_conflict");
    return { run_id: row.id, confirmed: true };
  });
}
