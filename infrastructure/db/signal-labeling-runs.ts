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
import { admitSignalProcessingWithClientV1 } from "./signal-processing-policy";
import {
  inspectFacetContextChangeV1,
  registerFacetContextV1,
  selectFacetInputsV1,
  writeFacetResultsV1,
  type LabelingDatabaseV1,
} from "./signal-mention-facets";
export type LabelingRunV1 = {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  kind: "facets" | "membership";
  labeler_digest: string;
  identity: LabelerIdentity;
  entity_context_digest: string;
  entity_context_version_no: number;
  context: EntityContextV1;
  lease_token: string;
  cursor_root_id: string | null;
  cap_micro_usd: string | null;
  processing_admission_id: string;
  status: string;
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
    results_applied: boolean;
    provider_batch_id: string | null;
    retry_depth: number;
  };
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
    const counts = (
      await c.query<{ status: string; relevance: string; count: number }>(
        `SELECT CASE WHEN root_id=ANY($2::uuid[]) THEN 'pending' ELSE status END status,CASE WHEN root_id=ANY($2::uuid[]) THEN 'unknown' ELSE relevance END relevance,count(*)::int count FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 GROUP BY 1,2`,
        [args.workspace_id, change.changed ? change.affected : []],
      )
    ).rows;
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
    const estimate = await estimatePopulation(
      c,
      args.workspace_id,
      labeler,
      change.context,
      change.changed ? change.affected : [],
      !selectedLabeler ||
        labelerDigestV1(selectedLabeler) !== labelerDigestV1(labeler),
    );
    return {
      contract_version: "mention-facets-status-v1",
      counts,
      latest,
      entity_context_digest: change.digest,
      stale_count: change.changed ? change.affected.length : 0,
      affected_mode: change.diff.affected_mode,
      pending,
      estimated_micro_usd: estimate.estimated_micro_usd,
      estimated_full_micro_usd: (
        await estimatePopulation(
          c,
          args.workspace_id,
          labeler,
          change.context,
          [],
          true,
        )
      ).estimated_micro_usd,
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
    await authorize(c, args.workspace_id, args.actor_user_id, true);
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
    const action =
      identity.kind === "facets" ? "mention_facets" : "concept_membership";
    const policy = (
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
    const change = await registerFacetContextV1(
      c,
      args.workspace_id,
      (args.full_recalculation ?? false) || supersededFull,
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
    const estimate =
      prepared ??
      (await estimatePopulation(
        c,
        args.workspace_id,
        identity,
        change.context,
      ));
    const pending = estimate.roots,
      estimated = estimate.estimated_micro_usd;
    const waiting =
      !!change.previous &&
      change.changed &&
      change.diff.affected_mode === "full" &&
      !args.full_recalculation;
    const admission = await admitSignalProcessingWithClientV1(c, {
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
        admission.receipt.id,
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
    `SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)
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
    kind: "facets" | "membership";
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
    authority?: (client: PoolClient, run: LabelingRunV1) => Promise<void>;
  };
  database: LabelingDatabaseV1;
  /** Runtime preflight, cached by the existing private storage adapter. */
  assertRawReady?: () => Promise<void>;
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
  async function lock(c: PoolClient, run: LabelingRunV1) {
    const found = (
      await c.query(
        `SELECT id FROM signal_labeling_runs WHERE id=$1 AND lease_token=$2 AND lease_until>now() FOR UPDATE`,
        [run.id, run.lease_token],
      )
    ).rows[0];
    if (!found) fail("labeling_lease_lost");
  }
  async function authority(c: PoolClient, run: LabelingRunV1, amount: number) {
    // Policy lifecycle triggers take this lock. Read only after acquiring it so a
    // revocation committed while this call waited cannot leave stale authority.
    await c.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||organization_id::text,0))
       FROM signal_workspaces WHERE id=$1`,
      [run.workspace_id],
    );
    const policy = (
      await c.query<{
        organization_id: string;
        budget_date: string;
        budget_timezone: string;
        daily_cap_micro_usd: string | null;
        max_execution_micro_usd: string | null;
        provider: string;
        model: string;
      }>(
        `SELECT w.organization_id,p.budget_timezone,(now() AT TIME ZONE p.budget_timezone)::date::text budget_date,p.daily_cap_micro_usd::text,a.max_execution_micro_usd::text,a.provider,a.model
   FROM signal_workspaces w JOIN signal_processing_admissions admission ON admission.id=$2 AND admission.workspace_id=w.id AND admission.target_id=$3
   JOIN signal_processing_policy_versions p ON p.id=admission.policy_version_id JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action=admission.action
   WHERE w.id=$1 AND p.status='active' AND p.valid_from<=now() AND p.valid_until>now()`,
        [run.workspace_id, run.processing_admission_id, run.id],
      )
    ).rows[0];
    if (
      !policy ||
      policy.provider !== run.identity.provider ||
      policy.model !== run.identity.model
    )
      fail("labeling_policy_changed");
    await c.query("SELECT signal_processing_lock_v1($1,$2::date)", [
      policy.organization_id,
      policy.budget_date,
    ]);
    await authorize(c, run.workspace_id, run.actor_user_id, true, run.kind === "membership" ? "concept_membership" : "mention_facets");
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
    if (
      (run.cap_micro_usd !== null &&
        spent + amount > Number(run.cap_micro_usd)) ||
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
    async claim(runId: string): Promise<LabelingRunV1 | null> {
      return tx(db, async (c) => {
        const token = randomUUID();
        const row = (
          await c.query(
            `UPDATE signal_labeling_runs SET lease_token=$2,lease_until=now()+interval '10 minutes',status='running',updated_at=now()
   WHERE id=$1 AND kind=$3 AND status IN('queued','running') AND NOT waiting_full_confirmation AND (lease_until IS NULL OR lease_until<now()) RETURNING id`,
            [runId, token, options.adapter?.kind ?? "facets"],
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
    async fail(run: LabelingRunV1, code: string) {
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
        await c.query(
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
    async release(run: LabelingRunV1) {
      await db.query(
        `UPDATE signal_labeling_runs SET lease_token=NULL,lease_until=NULL,next_poll_at=now()+interval '30 seconds' WHERE id=$1 AND lease_token=$2`,
        [run.id, run.lease_token],
      );
    },
    async inputs(run: LabelingRunV1) {
      if (options.adapter) return options.adapter.inputs(db, run);
      return selectFacetInputsV1(
        db,
        run.workspace_id,
        run.cursor_root_id,
        200,
      ) as Promise<Input[]>;
    },
    async reserve(
      run: LabelingRunV1,
      proposals: LabelingCallProposalV1<Input>[],
      advanceCursor = true,
    ): Promise<LabelingCallV1<Input>[]> {
      return tx(db, async (c) => {
        await lock(c, run);
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
        if (advanceCursor) {
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
    async calls(run: LabelingRunV1): Promise<LabelingCallV1<Input>[]> {
      const calls = (
        await db.query<LabelingCallV1<Input>>(
          "SELECT * FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at,id",
          [run.id],
        )
      ).rows.map((call) => ({ ...call, raw_body: call.raw_body ?? null }));
      for (const call of calls) {
        const stored = call as LabelingCallV1<Input> & {
          raw_storage_key?: string | null;
          raw_sha256?: string | null;
          raw_size_bytes?: string | number | null;
        };
        if (stored.raw_storage_key && stored.raw_sha256 && !call.raw_body && !call.results_applied) {
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
    async markSubmitting(run: LabelingRunV1, calls: LabelingCallV1<Input>[]) {
      await options.assertRawReady?.();
      await tx(db, async (c) => {
        await lock(c, run);
        await authority(c, run, 0);
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
    async markFailed(
      run: LabelingRunV1,
      calls: LabelingCallV1<Input>[],
      unknown: boolean,
    ) {
      await db.query(
        `UPDATE signal_labeling_calls SET status=$3,updated_at=now() WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status IN('reserved','submitting','submitted')`,
        [run.id, calls.map((x) => x.id), unknown ? "unknown" : "failed"],
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
        `UPDATE signal_labeling_calls SET raw_sha256=$3,raw_storage_key=$4,raw_size_bytes=$5,updated_at=now() WHERE run_id=$1 AND id=$2 AND (raw_sha256 IS NULL OR raw_sha256=$3 AND raw_storage_key=$4 AND raw_size_bytes=$5) RETURNING id`,
        [run.id, call.id, sha, key, Buffer.byteLength(raw)],
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
        `UPDATE signal_labeling_calls SET status='settled',usage=$3::jsonb,settled_micro_usd=$4,stop_reason=$5,refusal_category=$6,updated_at=now()
   WHERE run_id=$1 AND id=$2 AND raw_sha256 IS NOT NULL AND (status<>'settled' OR settled_micro_usd=$4 AND usage=$3::jsonb) RETURNING id`,
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
        `UPDATE signal_labeling_calls c SET status='settled',usage=x.usage,settled_micro_usd=x.cost,stop_reason=x.stop_reason,refusal_category=x.refusal_category,updated_at=now()
   FROM jsonb_to_recordset($2::jsonb) x(id uuid,usage jsonb,cost bigint,stop_reason text,refusal_category text)
   WHERE c.run_id=$1 AND c.id=x.id AND c.raw_sha256 IS NOT NULL AND (c.status<>'settled' OR c.settled_micro_usd=x.cost AND c.usage=x.usage) RETURNING c.id`,
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
        await lock(c, run);
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
        await c.query(
          `UPDATE signal_labeling_calls call SET results_applied=true,results=page.results
           FROM jsonb_to_recordset($2::jsonb) page(id uuid,results jsonb)
           WHERE call.run_id=$1 AND call.id=page.id`,
          [
            run.id,
            JSON.stringify(
              pages.map((p) => ({ id: p.call.id, results: p.results })),
            ),
          ],
        );
      });
    },
    async finish(run: LabelingRunV1) {
      return tx(db, async (c) => {
        await lock(c, run);
        const calls = (
          await c.query(
            `SELECT count(*) FILTER(WHERE status='unknown')::int unknown,count(*) FILTER(WHERE status IN('reserved','submitting','submitted') OR raw_storage_key IS NOT NULL AND NOT results_applied)::int active FROM signal_labeling_calls WHERE run_id=$1`,
            [run.id],
          )
        ).rows[0]!;
        const pending = options.adapter
          ? await options.adapter.pending(c, run)
          : Number(
              (
                await c.query(
                  `SELECT count(*) count FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND status='pending'`,
                  [run.workspace_id],
                )
              ).rows[0]!.count,
            );
        const available = (
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
            "SELECT error_code FROM signal_labeling_runs WHERE id=$1",
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
          `UPDATE signal_labeling_runs SET status=$2,error_code=CASE WHEN $3>0 THEN 'labeling_outcome_unknown' ELSE error_code END,counts=jsonb_build_object('pending',$4::int),completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,
          [run.id, state, calls.unknown, pending],
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
