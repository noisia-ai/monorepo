import { createHash } from "node:crypto";

import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

export type SignalProductOperationActionV1 =
  | "create-source"
  | "import-source"
  | "reconcile-governed-view"
  | "reconcile-strategic-authority"
  | "promote-strategic-authority"
  | "reconcile-acquisition-plan"
  | "promote-acquisition-plan"
  | "create-acquisition-query"
  | "review-acquisition-query"
  | "seal-acquisition-brief"
  | "generate-acquisition-queries"
  | "retire-acquisition-slot"
  | "decide-acquisition-reference"
  | "create-competitor"
  | "retire-competitor"
  | "reactivate-competitor"
  | "seal-acquisition-import"
  | "authorize-acquisition-benchmark"
  | "register-topic-discovery-review"
  | "save-topic-discovery-review-draft"
  | "save-topic-discovery-outlier-draft"
  | "finalize-topic-discovery-review"
  | "supersede-topic-discovery-review"
  | "create-semantic-context-draft"
  | "reconcile-semantic-context-generation"
  | "append-semantic-context-proposals"
  | "decide-semantic-context-element"
  | "bulk-approve-semantic-context-elements"
  | "merge-semantic-context-elements"
  | "correct-semantic-context-element"
  | "annotate-semantic-context-element"
  | "resolve-semantic-context-annotation"
  | "repair-semantic-context-annotation-resolution"
  | "decide-semantic-context-locale-authority"
  | "edit-semantic-context-element-v1"
  | "create-semantic-context-element-v1"
  | "publish-semantic-context-generation";

export async function beginSignalProductOperationV1<T>(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  action: SignalProductOperationActionV1;
  idempotencyKey: string;
  input: unknown;
  semanticContextDecisionInput?: { payload: unknown; digest: string };
}): Promise<{ key: string; operationId: string; replay: T | null;created: boolean }> {
  const key = normalizeIdempotencyKey(args.idempotencyKey);
  const requestDigest = sha256(stableJson({
    contract_version: "signal-product-operation-v1",
    workspace_id: args.workspace.id,
    action: args.action,
    input: args.input
  }));
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `signal-product-operation:${args.workspace.id}:${key}`
  ]);
  const authority = await args.queryable.query<{ allowed: boolean }>(`
    SELECT workspace.organization_id=$2::uuid
      AND workspace.brand_id=$3::uuid
      AND workspace.status='active'
      AND signal_data_governance_actor_is_valid(workspace.id,$4::uuid) AS allowed
    FROM signal_workspaces workspace WHERE workspace.id=$1::uuid
  `, [args.workspace.id,args.workspace.organizationId,
    args.workspace.subject.type === "brand" ? args.workspace.subject.id : null,args.actor.id]);
  if (authority.rows[0]?.allowed !== true || args.actor.userType !== "noisia_internal") {
    throw new Error("Product operation is cross-workspace or unauthorized.");
  }
  const decisionInputRequired = args.action === "decide-semantic-context-element"
    || args.action === "bulk-approve-semantic-context-elements"
    || args.action === "resolve-semantic-context-annotation"
    || args.action === "repair-semantic-context-annotation-resolution"
    || args.action === "decide-semantic-context-locale-authority"
    || args.action === "edit-semantic-context-element-v1"
    || args.action === "create-semantic-context-element-v1";
  const decisionInputAllowed = decisionInputRequired
    || args.action === "correct-semantic-context-element"
    || args.action === "merge-semantic-context-elements";
  if ((decisionInputRequired && !args.semanticContextDecisionInput)
      || (!decisionInputAllowed && args.semanticContextDecisionInput)) {
    throw new Error("Semantic Context decisions require one sealed operation input.");
  }
  const inserted = args.semanticContextDecisionInput
    ? await args.queryable.query(`
      INSERT INTO signal_governance_control_operations (
        workspace_id,actor_user_id,action,request_digest,idempotency_key,status,
        semantic_context_decision_input,semantic_context_decision_input_digest
      ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,'in_progress',$6::jsonb,$7)
      ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id
    `,[args.workspace.id,args.actor.id,args.action,requestDigest,key,
      JSON.stringify(args.semanticContextDecisionInput.payload),args.semanticContextDecisionInput.digest])
    : await args.queryable.query(`
      INSERT INTO signal_governance_control_operations (
        workspace_id,actor_user_id,action,request_digest,idempotency_key,status
      ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,'in_progress')
      ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id
    `,[args.workspace.id,args.actor.id,args.action,requestDigest,key]);
  const selected = await args.queryable.query<{
    id: string; actor_user_id: string; action: string; request_digest: string; status: string; result: T | null;
    semantic_context_decision_input_digest: string | null;
  }>(args.semanticContextDecisionInput ? `
    SELECT id::text,actor_user_id::text,action,request_digest,status,result,
      semantic_context_decision_input_digest
    FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid AND idempotency_key=$2
    FOR UPDATE
  ` : `
    SELECT id::text,actor_user_id::text,action,request_digest,status,result,
      NULL::text AS semantic_context_decision_input_digest
    FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid AND idempotency_key=$2
    FOR UPDATE
  `,[args.workspace.id,key]);
  const row = selected.rows[0];
  if (!row || row.actor_user_id !== args.actor.id || row.action !== args.action
      || row.request_digest !== requestDigest
      || row.semantic_context_decision_input_digest
        !== (args.semanticContextDecisionInput?.digest ?? null)) {
    throw new Error("Idempotency-Key was reused with incompatible product input.");
  }
  if (row.status === "completed" && row.result !== null) return {
    key,operationId: row.id,replay: row.result,created: false
  };
  if (row.status !== "in_progress") throw new Error("Product operation has an invalid state.");
  return { key,operationId: row.id,replay: null,created: inserted.rowCount===1 };
}

export async function loadSignalProductOperationReplayV1<T>(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  action:SignalProductOperationActionV1;idempotencyKey:string;input:unknown;
  semanticContextDecisionInput?:{payload:unknown;digest:string};
}):Promise<T|null>{
  const key=normalizeIdempotencyKey(args.idempotencyKey);
  const requestDigest=sha256(stableJson({contract_version:"signal-product-operation-v1",
    workspace_id:args.workspace.id,action:args.action,input:args.input}));
  const selected=await args.queryable.query<{actor_user_id:string;action:string;request_digest:string;
    status:string;result:T|null;semantic_context_decision_input_digest:string|null}>(`SELECT actor_user_id::text,
      action,request_digest,status,result,semantic_context_decision_input_digest
    FROM signal_governance_control_operations WHERE workspace_id=$1::uuid AND idempotency_key=$2`,
  [args.workspace.id,key]);
  const row=selected.rows[0];if(!row)return null;
  if(row.actor_user_id!==args.actor.id||row.action!==args.action||row.request_digest!==requestDigest
      ||row.semantic_context_decision_input_digest!==(args.semanticContextDecisionInput?.digest??null))
    throw new Error("Idempotency-Key was reused with incompatible product input.");
  if(row.status!=="completed"||row.result===null)
    throw new Error("Product operation has an invalid state.");
  return row.result;
}

export async function completeSignalProductOperationV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspaceId: string;
  key: string;
  result: unknown;
}) {
  const updated = await args.queryable.query(`
    UPDATE signal_governance_control_operations
    SET status='completed',result=$3::jsonb,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE workspace_id=$1::uuid AND idempotency_key=$2 AND status='in_progress'
  `,[args.workspaceId,args.key,JSON.stringify(args.result)]);
  if (updated.rowCount !== 1) throw new Error("Product operation completion was not persisted.");
}

function normalizeIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 500) {
    throw new Error("Idempotency-Key must be between 8 and 500 characters.");
  }
  return sha256(`signal-product-operation-v1\u001f${normalized}`);
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string,unknown>)
      .sort(([left],[right]) => left.localeCompare(right))
      .map(([key,entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
