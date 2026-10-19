import { createHash } from "node:crypto";

import {
  SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS,
  type SignalClientGovernedViewKeyV1,
  type SignalClientGovernedViewModuleKeyV1
} from "@noisia/query-engine";

import {
  loadSignalGovernedBrandBindingSetPreflightV1,
  promoteSignalGovernedBrandBindingSetV1,
  withdrawSignalGovernedBrandBindingSetToBridgeV1,
  type SignalGovernedBrandBindingClient
} from "@/lib/data-os/signal-governed-brand-bindings";
import { signalGovernedViewPolicyIdentityV1 } from "@/lib/data-os/signal-governed-view-policy";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

const CONTRACT = "signal-governed-view-binding-set-v1" as const;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type SignalGovernedViewBindingModuleStateV1 = {
  module_key: SignalClientGovernedViewModuleKeyV1;
  population_id: string;
  population_key: string;
  population_version: number;
  population_definition_hash: string;
  membership_digest: string;
  policy_compilation_id: string;
  compiled_plan_hash: string;
  source_watermark_hash: string;
  governance_data_watermark_id: string;
  governance_unknown_count: number;
  next_policy_transition_at: string | null;
  current_binding_id: string | null;
  current_binding_digest: string | null;
  current_binding_population_id: string | null;
  current_binding_compilation_id: string | null;
};

export type SignalGovernedViewBindingSetPreflightV1 = {
  contract_version: typeof CONTRACT;
  workspace_id: string;
  view_key: SignalClientGovernedViewKeyV1;
  policy_bundle_id: string;
  policy_key: string;
  policy_version: number;
  policy_status: "draft" | "active";
  policy_definition_hash: string;
  set_digest: string;
  current_binding_count: number;
  modules: SignalGovernedViewBindingModuleStateV1[];
};

export type SignalGovernedViewBindingSetOperationResultV1 = {
  operation_id: string;
  view_key: SignalClientGovernedViewKeyV1;
  action: "promote" | "withdraw-to-bridge" | "withdraw-to-absence";
  request_digest: string;
  result_digest: string;
  idempotency_key: string;
  replayed: boolean;
  items: Array<{
    module_key: SignalClientGovernedViewModuleKeyV1;
    previous_binding_id: string | null;
    next_binding_id: string | null;
    binding_event_id: string;
  }>;
};

type PreflightRow = SignalGovernedViewBindingModuleStateV1 & {
  workspace_id: string;
  policy_bundle_id: string;
  policy_key: string;
  policy_version: number;
  policy_status: string;
  policy_definition_hash: string;
  bundle_effective_from: string;
  bundle_effective_to: string | null;
  authorized_modules: string[];
  derivation_policy_definition_hash: string;
  derivation_compiled_plan_hash: string;
  compilation_policy_definition_hash: string;
  compilation_population_definition_hash: string;
  compilation_membership_digest: string;
  compilation_status: string;
  compilation_is_current: boolean;
  invalidation_count: number;
};

export async function loadSignalGovernedViewBindingSetPreflightV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  queryable?: SignalGovernedBrandBindingClient;
}): Promise<SignalGovernedViewBindingSetPreflightV1> {
  assertWriterAuthority(args.workspace,args.actor);
  if (args.viewKey === "brand") {
    const result = await loadSignalGovernedBrandBindingSetPreflightV1(args);
    return { ...result,contract_version: CONTRACT,view_key: "brand" };
  }
  if (args.queryable) return loadPreflight(args.queryable,args.workspace.id,args.viewKey);
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    return await loadPreflight(client,args.workspace.id,args.viewKey);
  } finally {
    client.release();
  }
}

export async function promoteSignalGovernedViewBindingSetV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  expectedSetDigest: string;
  idempotencyKey: string;
  queryable?: SignalGovernedBrandBindingClient;
}): Promise<SignalGovernedViewBindingSetOperationResultV1> {
  if (args.viewKey === "brand") {
    const result = await promoteSignalGovernedBrandBindingSetV1(args);
    return { ...result,view_key: "brand" };
  }
  return runOperation({ ...args,viewKey: args.viewKey as Exclude<SignalClientGovernedViewKeyV1,"brand">,
    action: "promote" });
}

export async function withdrawSignalGovernedViewBindingSetV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  expectedSetDigest: string;
  idempotencyKey: string;
  queryable?: SignalGovernedBrandBindingClient;
}): Promise<SignalGovernedViewBindingSetOperationResultV1> {
  if (args.viewKey === "brand") {
    const result = await withdrawSignalGovernedBrandBindingSetToBridgeV1(args);
    return { ...result,view_key: "brand" };
  }
  return runOperation({ ...args,viewKey: args.viewKey as Exclude<SignalClientGovernedViewKeyV1,"brand">,
    action: "withdraw-to-absence" });
}

async function runOperation(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: Exclude<SignalClientGovernedViewKeyV1,"brand">;
  expectedSetDigest: string;
  idempotencyKey: string;
  action: "promote" | "withdraw-to-absence";
  queryable?: SignalGovernedBrandBindingClient;
  attempt?: number;
}): Promise<SignalGovernedViewBindingSetOperationResultV1> {
  assertWriterAuthority(args.workspace,args.actor);
  if (!HASH_PATTERN.test(args.expectedSetDigest)) throw new Error("Expected binding-set digest is invalid.");
  const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
  const identity = signalGovernedViewPolicyIdentityV1(args.viewKey);
  const requestDigest = hash(stableJson({
    contract_version: CONTRACT,workspace_id: args.workspace.id,actor_user_id: args.actor.id,
    view_key: args.viewKey,action: args.action,policy_key: identity.policy_key,
    expected_set_digest: args.expectedSetDigest
  }));
  const acquired = args.queryable ? null : await acquireClient();
  const client = args.queryable ?? acquired!;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
      `${args.workspace.id}:${args.viewKey}:binding-set`
    ]);
    const replay = await loadPersistedOperation(client,args.workspace.id,idempotencyKey);
    if (replay) {
      if (replay.view_key !== args.viewKey
        || replay.action !== args.action || replay.request_digest !== requestDigest
        || replay.actor_user_id !== args.actor.id) {
        throw new Error("Governed view binding-set idempotency key was reused incompatibly.");
      }
      await client.query("COMMIT");
      return { ...replay,replayed: true };
    }
    const preflight = await loadPreflight(client,args.workspace.id,args.viewKey);
    if (preflight.set_digest !== args.expectedSetDigest) {
      throw new Error("Governed view binding-set compare-and-swap failed.");
    }
    assertPreflightReady(preflight,args.action);
    const items: SignalGovernedViewBindingSetOperationResultV1["items"] = [];
    for (const moduleState of preflight.modules) {
      const eventKey = hash(stableJson({
        contract_version: CONTRACT,parent_idempotency_key: idempotencyKey,
        action: args.action,module_key: moduleState.module_key,view_key: args.viewKey
      }));
      let nextBindingId: string | null;
      if (args.action === "promote") {
        const promoted = await client.query<{ binding_id: string }>(`
          SELECT promote_signal_governed_view_binding(
            $1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,'promote',$7
          )::text AS binding_id
        `,[args.workspace.id,moduleState.module_key,args.viewKey,preflight.policy_bundle_id,
          moduleState.population_id,args.actor.id,eventKey]);
        nextBindingId = promoted.rows[0]!.binding_id;
      } else {
        if (!moduleState.current_binding_id || !moduleState.current_binding_digest) {
          throw new Error(`Cannot withdraw missing ${args.viewKey} binding for ${moduleState.module_key}.`);
        }
        await client.query(`
          SELECT withdraw_signal_governed_view_binding(
            $1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7
          )
        `,[args.workspace.id,moduleState.module_key,args.viewKey,args.actor.id,
          moduleState.current_binding_id,moduleState.current_binding_digest,eventKey]);
        nextBindingId = null;
      }
      const event = await client.query<{ id: string }>(`
        SELECT id::text FROM signal_governed_view_binding_events
        WHERE workspace_id=$1::uuid AND idempotency_key=$2
      `,[args.workspace.id,eventKey]);
      if (event.rowCount !== 1) throw new Error(`Binding event missing for ${moduleState.module_key}/${args.viewKey}.`);
      items.push({ module_key: moduleState.module_key,previous_binding_id: moduleState.current_binding_id,
        next_binding_id: nextBindingId,binding_event_id: event.rows[0]!.id });
    }
    const observed = await loadCurrentCount(client,args.workspace.id,args.viewKey);
    if ((args.action === "promote" && observed !== SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS.length)
      || (args.action === "withdraw-to-absence" && observed !== 0)) {
      throw new Error("Governed view binding-set transition was not atomic.");
    }
    const resultDigest = hash(stableJson({ contract_version: CONTRACT,view_key: args.viewKey,
      action: args.action,items }));
    const operation = await client.query<{ id: string }>(`
      INSERT INTO signal_governed_brand_binding_set_operations (
        workspace_id,view_key,action,policy_bundle_id,actor_user_id,
        request_digest,result_digest,idempotency_key
      ) VALUES ($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7,$8)
      RETURNING id::text
    `,[args.workspace.id,args.viewKey,args.action,preflight.policy_bundle_id,args.actor.id,
      requestDigest,resultDigest,idempotencyKey]);
    const operationId = operation.rows[0]!.id;
    for (const item of items) {
      await client.query(`
        INSERT INTO signal_governed_brand_binding_set_operation_items (
          operation_id,workspace_id,module_key,view_key,previous_binding_id,
          next_binding_id,binding_event_id
        ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid)
      `,[operationId,args.workspace.id,item.module_key,args.viewKey,item.previous_binding_id,
        item.next_binding_id,item.binding_event_id]);
    }
    await client.query("COMMIT");
    return { operation_id: operationId,view_key: args.viewKey,action: args.action,
      request_digest: requestDigest,result_digest: resultDigest,idempotency_key: idempotencyKey,
      replayed: false,items };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isSerializationFailure(error) && (args.attempt ?? 0)<2) {
      return runOperation({ ...args,queryable: client,attempt: (args.attempt ?? 0)+1 });
    }
    throw error;
  } finally {
    acquired?.release?.();
  }
}

async function loadPreflight(
  queryable: SignalGovernedBrandBindingClient,
  workspaceId: string,
  viewKey: Exclude<SignalClientGovernedViewKeyV1,"brand">
): Promise<SignalGovernedViewBindingSetPreflightV1> {
  const identity = signalGovernedViewPolicyIdentityV1(viewKey);
  const result = await queryable.query<PreflightRow>(`
    SELECT bundle.workspace_id::text,bundle.id::text AS policy_bundle_id,bundle.policy_key,
      bundle.policy_version,bundle.status AS policy_status,bundle.definition_hash AS policy_definition_hash,
      bundle.effective_from::text AS bundle_effective_from,bundle.effective_to::text AS bundle_effective_to,
      bundle.authorized_modules,derivation.module_key,
      derivation.policy_definition_hash AS derivation_policy_definition_hash,
      derivation.compiled_plan_hash AS derivation_compiled_plan_hash,
      population.id::text AS population_id,population.population_key,
      population.version AS population_version,population.definition_hash AS population_definition_hash,
      population.membership_digest,compilation.id::text AS policy_compilation_id,
      compilation.compiled_plan_hash,
      compilation.policy_definition_hash AS compilation_policy_definition_hash,
      compilation.population_definition_hash AS compilation_population_definition_hash,
      compilation.membership_digest AS compilation_membership_digest,
      compilation.source_watermark_hash,compilation.governance_data_watermark_id::text,
      compilation.governance_unknown_count,compilation.next_policy_transition_at::text,
      compilation.compilation_status,compilation.is_current AS compilation_is_current,
      (SELECT count(*)::int FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=compilation.id) AS invalidation_count,
      binding.id::text AS current_binding_id,
      signal_governed_view_binding_digest_v1(binding.id) AS current_binding_digest,
      binding.population_id::text AS current_binding_population_id,
      binding.policy_compilation_id::text AS current_binding_compilation_id
    FROM signal_population_policy_bundles bundle
    JOIN signal_governed_view_population_derivations derivation
      ON derivation.workspace_id=bundle.workspace_id AND derivation.policy_bundle_id=bundle.id
     AND derivation.view_key=$2
    JOIN signal_population_definitions population ON population.id=derivation.resolved_population_id
      AND population.workspace_id=derivation.workspace_id
    JOIN signal_population_policy_compilations compilation
      ON compilation.workspace_id=derivation.workspace_id
     AND compilation.policy_bundle_id=derivation.policy_bundle_id
     AND compilation.population_id=derivation.resolved_population_id
     AND compilation.module_key=derivation.module_key AND compilation.view_key=derivation.view_key
     AND compilation.is_current
    LEFT JOIN signal_governed_view_bindings binding
      ON binding.workspace_id=derivation.workspace_id AND binding.module_key=derivation.module_key
     AND binding.view_key=derivation.view_key AND binding.binding_status='current'
    WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key=$3
      AND bundle.policy_version=(SELECT max(candidate.policy_version)
        FROM signal_population_policy_bundles candidate
        WHERE candidate.workspace_id=$1::uuid AND candidate.policy_key=$3)
    ORDER BY derivation.module_key
  `,[workspaceId,viewKey,identity.policy_key]);
  const rows = result.rows;
  const expectedModules = [...SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS].sort();
  if (rows.length !== expectedModules.length
    || stableJson(rows.map((row)=>row.module_key).sort())!==stableJson(expectedModules)) {
    throw new Error(`${viewKey} binding-set requires exactly three module derivations.`);
  }
  const first = rows[0]!;
  const now = Date.now();
  for (const row of rows) {
    if (row.workspace_id!==workspaceId || row.policy_bundle_id!==first.policy_bundle_id
      || row.policy_key!==identity.policy_key || row.policy_version!==first.policy_version
      || !["draft","active"].includes(row.policy_status)
      || Date.parse(row.bundle_effective_from)>now
      || (row.bundle_effective_to!==null && Date.parse(row.bundle_effective_to)<=now)
      || !expectedModules.every((module)=>row.authorized_modules.includes(module))
      || row.derivation_policy_definition_hash!==row.policy_definition_hash
      || row.derivation_compiled_plan_hash!==row.compiled_plan_hash
      || row.compilation_policy_definition_hash!==row.policy_definition_hash
      || row.compilation_population_definition_hash!==row.population_definition_hash
      || row.compilation_membership_digest!==row.membership_digest
      || row.compilation_status!=="ready" || !row.compilation_is_current
      || row.invalidation_count!==0 || !row.governance_data_watermark_id
      || row.governance_unknown_count!==0
      || (row.next_policy_transition_at!==null && Date.parse(row.next_policy_transition_at)<=now)) {
      throw new Error(`Governed ${viewKey} binding preflight failed for ${row.module_key}.`);
    }
  }
  const modules = rows.map((row)=>({
    module_key: row.module_key,population_id: row.population_id,population_key: row.population_key,
    population_version: row.population_version,population_definition_hash: row.population_definition_hash,
    membership_digest: row.membership_digest,policy_compilation_id: row.policy_compilation_id,
    compiled_plan_hash: row.compiled_plan_hash,source_watermark_hash: row.source_watermark_hash,
    governance_data_watermark_id: row.governance_data_watermark_id,
    governance_unknown_count: row.governance_unknown_count,next_policy_transition_at: row.next_policy_transition_at,
    current_binding_id: row.current_binding_id,current_binding_digest: row.current_binding_digest,
    current_binding_population_id: row.current_binding_population_id,
    current_binding_compilation_id: row.current_binding_compilation_id
  })) as SignalGovernedViewBindingModuleStateV1[];
  const setDigest = hash(stableJson({ contract_version: CONTRACT,workspace_id: workspaceId,
    view_key: viewKey,policy_bundle_id: first.policy_bundle_id,
    policy_definition_hash: first.policy_definition_hash,policy_status: first.policy_status,modules }));
  return { contract_version: CONTRACT,workspace_id: workspaceId,view_key: viewKey,
    policy_bundle_id: first.policy_bundle_id,policy_key: identity.policy_key,
    policy_version: first.policy_version,policy_status: first.policy_status as "draft"|"active",
    policy_definition_hash: first.policy_definition_hash,set_digest: setDigest,
    current_binding_count: modules.filter((module)=>module.current_binding_id).length,modules };
}

function assertPreflightReady(
  preflight: SignalGovernedViewBindingSetPreflightV1,
  action: "promote"|"withdraw-to-absence"
) {
  if (preflight.current_binding_count!==0
    && preflight.current_binding_count!==SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS.length) {
    throw new Error("Partial governed view binding-set state is not recoverable implicitly.");
  }
  const exactCurrent = preflight.modules.every((module)=>!module.current_binding_id || (
    module.current_binding_population_id===module.population_id
    && module.current_binding_compilation_id===module.policy_compilation_id
    && module.current_binding_digest!==null
  ));
  const currentAuditable = preflight.modules.every((module)=>!module.current_binding_id
    || module.current_binding_digest!==null);
  if (!currentAuditable || (action==="withdraw-to-absence" && !exactCurrent)) {
    throw new Error("Current governed view binding-set is incompatible.");
  }
  if (action==="withdraw-to-absence"
    && preflight.current_binding_count!==SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS.length) {
    throw new Error("Atomic binding withdrawal requires three current governed bindings.");
  }
}

async function loadPersistedOperation(
  queryable: SignalGovernedBrandBindingClient,
  workspaceId: string,
  idempotencyKey: string
) {
  const operation = await queryable.query<{
    operation_id: string;
    view_key: SignalClientGovernedViewKeyV1;
    action: "promote"|"withdraw-to-absence";
    request_digest: string;
    result_digest: string;
    idempotency_key: string;
    actor_user_id: string;
  }>(`
    SELECT id::text AS operation_id,view_key,action,request_digest,result_digest,
      idempotency_key,actor_user_id::text
    FROM signal_governed_brand_binding_set_operations
    WHERE workspace_id=$1::uuid AND idempotency_key=$2
  `,[workspaceId,idempotencyKey]);
  if (!operation.rows[0]) return null;
  const items = await queryable.query<SignalGovernedViewBindingSetOperationResultV1["items"][number]>(`
    SELECT module_key,previous_binding_id::text,next_binding_id::text,binding_event_id::text
    FROM signal_governed_brand_binding_set_operation_items
    WHERE operation_id=$1::uuid ORDER BY module_key
  `,[operation.rows[0].operation_id]);
  if (items.rowCount!==SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS.length) {
    throw new Error("Persisted governed view binding-set result is incomplete.");
  }
  return { ...operation.rows[0],items: items.rows };
}

async function loadCurrentCount(
  queryable: SignalGovernedBrandBindingClient,
  workspaceId: string,
  viewKey: Exclude<SignalClientGovernedViewKeyV1,"brand">
) {
  const result = await queryable.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM signal_governed_view_bindings
    WHERE workspace_id=$1::uuid AND view_key=$2
      AND module_key=ANY($3::text[]) AND binding_status='current'
  `,[workspaceId,viewKey,[...SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS]]);
  return result.rows[0]?.count ?? 0;
}

async function acquireClient(): Promise<SignalGovernedBrandBindingClient> {
  const { pool } = await import("@/lib/db");
  return pool.connect();
}

function assertWriterAuthority(workspace: ResolvedSignalWorkspace,actor: SignalWorkspaceUser) {
  if (workspace.status!=="active" || workspace.subject.type!=="brand"
    || actor.userType!=="noisia_internal") {
    throw new Error("Governed view bindings require an internal actor and active brand workspace.");
  }
}

function normalizeIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length<8 || normalized.length>500) {
    throw new Error("Idempotency-Key must be between 8 and 500 characters.");
  }
  return hash(normalized);
}

function isSerializationFailure(error: unknown) {
  return typeof error==="object" && error!==null && "code" in error && error.code==="40001";
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value==="object") {
    return `{${Object.entries(value as Record<string,unknown>)
      .sort(([left],[right])=>left.localeCompare(right))
      .map(([key,entry])=>`${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
