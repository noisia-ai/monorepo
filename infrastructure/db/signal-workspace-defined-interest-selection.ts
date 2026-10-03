import type { Pool, PoolClient } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { loadSignalWorkspaceClassificationInputV1, SignalWorkspaceClassificationError } from "./signal-workspace-classification";
import type { SignalWorkspaceDefinedInterestOverlayV1 } from "./signal-workspace-topics-serving";

type Database = Pick<Pool, "connect">;
type Scope = { database: Database; workspace_id: string; actor_user_id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hash = /^sha256:[a-f0-9]{64}$/u;
const key = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const requestKey = /^[A-Za-z0-9._:-]{8,200}$/u;
export class SignalWorkspaceDefinedInterestSelectionError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceDefinedInterestSelectionError"; }
}
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceDefinedInterestSelectionError(code, status); };

export type SignalWorkspaceDefinedInterestSelectionV1 = SignalWorkspaceDefinedInterestOverlayV1 & { operation_id: string } |
  Omit<SignalWorkspaceDefinedInterestOverlayV1, "selected"> & { selected: false; operation_id: string };
export type SignalWorkspaceDefinedInterestSelectionStatusV1 = {
  contract_version: "signal-workspace-defined-interest-selection-v1"; workspace_id: string;
  term_key: string; selection: SignalWorkspaceDefinedInterestSelectionV1 | null;
  servable: boolean; request_receipt: { selection: SignalWorkspaceDefinedInterestSelectionV1; replayed: boolean } | null;
};
function selection(value: unknown): SignalWorkspaceDefinedInterestSelectionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("defined_interest_selection_receipt_invalid", 503);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "definition_digest,definition_revision,generation_id,operation_id,selected,selection_digest,selection_revision,snapshot_id,taxonomy_term_id,term_key,workspace_id"
    || !["workspace_id", "generation_id", "taxonomy_term_id", "operation_id"].every(field => typeof row[field] === "string" && uuid.test(row[field]))
    || row.snapshot_id !== null && (typeof row.snapshot_id !== "string" || !uuid.test(row.snapshot_id))
    || typeof row.term_key !== "string" || !key.test(row.term_key)
    || typeof row.definition_digest !== "string" || !hash.test(row.definition_digest)
    || typeof row.selection_digest !== "string" || !hash.test(row.selection_digest)
    || typeof row.selected !== "boolean" || !Number.isSafeInteger(row.definition_revision) || (row.definition_revision as number) < 1
    || !Number.isSafeInteger(row.selection_revision) || (row.selection_revision as number) < 1)
    return fail("defined_interest_selection_receipt_invalid", 503);
  return row as SignalWorkspaceDefinedInterestSelectionV1;
}
async function tx<T>(args: Scope, readOnly: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!uuid.test(args.workspace_id) || !uuid.test(args.actor_user_id)) return fail("defined_interest_selection_scope_invalid", 422);
  const client = await args.database.connect();
  try {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client,
      workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, lock_authority: !readOnly });
    if (!caps.can_view || !readOnly && !caps.can_select_signal) return fail("defined_interest_selection_forbidden", 403);
    const result = await work(client);
    await client.query("COMMIT"); return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof SignalWorkspaceDefinedInterestSelectionError) throw error;
    if (error instanceof Error && /^defined_interest_selection_[a-z_]+$/u.test(error.message))
      throw new SignalWorkspaceDefinedInterestSelectionError(error.message,
        error.message.endsWith("forbidden") ? 403 : 409);
    throw error;
  } finally { client.release(); }
}

/** A stale stored selection is visible to its editor, but cannot be served. */
export async function loadSignalWorkspaceDefinedInterestSelectionV1(args: Scope & { term_key: string; idempotency_key?: string }):
Promise<SignalWorkspaceDefinedInterestSelectionStatusV1> {
  if (!key.test(args.term_key) || args.idempotency_key !== undefined && !requestKey.test(args.idempotency_key))
    return fail("defined_interest_selection_request_invalid", 422);
  return tx(args, true, async client => {
    const row = (await client.query<{ selection: unknown; servable: boolean; receipt: unknown;
      identity: { catalog_digest?: string; context_digest?: string; compiler_digest?: string;
        embedding_config_digest?: string } | null; correction_digest: string | null; profile_id: string | null }>(`
      SELECT CASE WHEN current_selection.workspace_id IS NULL THEN NULL ELSE jsonb_build_object(
        'workspace_id',current_selection.workspace_id,'snapshot_id',current_selection.snapshot_id,
        'generation_id',current_selection.generation_id,'taxonomy_term_id',current_selection.taxonomy_term_id,
        'term_key',current_selection.term_key,'definition_digest',current_selection.definition_digest,
        'definition_revision',current_selection.definition_revision,'selected',current_selection.selected,
        'selection_revision',current_selection.selection_revision,'selection_digest',current_selection.selection_digest,
        'operation_id',current_selection.operation_id) END selection,
      signal_defined_interest_selection_current_v1(workspace.id,$2) servable,
      generation.input_snapshot->'identity' identity,
      generation.input_snapshot->>'correction_digest' correction_digest,
      generation.taxonomy_profile_id::text profile_id,
      operation.result_selection receipt
      FROM signal_workspaces workspace
      LEFT JOIN signal_defined_interest_selections current_selection ON current_selection.workspace_id=workspace.id
        AND current_selection.term_key=$2
      LEFT JOIN signal_classification_generations generation ON generation.id=current_selection.generation_id
        AND generation.workspace_id=workspace.id
      LEFT JOIN signal_defined_interest_selection_operations operation ON operation.workspace_id=workspace.id
        AND operation.actor_user_id=$3::uuid AND operation.idempotency_key=$4
      WHERE workspace.id=$1::uuid`, [args.workspace_id, args.term_key, args.actor_user_id, args.idempotency_key ?? null])).rows[0];
    if (!row) return fail("defined_interest_selection_workspace_unavailable", 404);
    const stored = row.selection === null ? null : selection(row.selection);
    const receipt = row.receipt === null ? null : selection(row.receipt);
    if (stored && (stored.workspace_id !== args.workspace_id || stored.term_key !== args.term_key)
      || receipt && (receipt.workspace_id !== args.workspace_id || receipt.term_key !== args.term_key))
      return fail("defined_interest_selection_receipt_invalid", 503);
    let sourceCurrent = false;
    if (row.servable && stored?.selected && row.identity && row.correction_digest) {
      const current = await loadSignalWorkspaceClassificationInputV1({ queryable: client,
        workspace_id: args.workspace_id, actor_user_id: args.actor_user_id,
        interest_term_key: args.term_key }).catch(error => {
        if (error instanceof SignalWorkspaceClassificationError && ["workspace_classification_catalog_unavailable",
          "workspace_classification_interest_unavailable"].includes(error.code)) return null;
        throw error;
      });
      sourceCurrent = current !== null && current.taxonomy_profile_id === row.profile_id
        && row.identity.catalog_digest === current.catalog_digest
        && row.identity.context_digest === current.context_digest
        && row.identity.compiler_digest === current.compiler_digest
        && row.identity.embedding_config_digest === current.embedding_config_digest
        && row.correction_digest === current.correction_digest;
    }
    return { contract_version: "signal-workspace-defined-interest-selection-v1", workspace_id: args.workspace_id,
      term_key: args.term_key, selection: stored, servable: Boolean(sourceCurrent),
      request_receipt: receipt ? { selection: receipt, replayed: true } : null };
  });
}

export type SignalWorkspaceDefinedInterestSelectionCommandV1 = {
  term_key: string; selected: boolean; snapshot_id: string | null; expected_snapshot_digest: string | null;
  generation_id: string; taxonomy_term_id: string; definition_digest: string; definition_revision: number;
  expected_selection_revision: number;
};
/** Mutation and replay are one database transaction; scores never select. */
export async function mutateSignalWorkspaceDefinedInterestSelectionV1(args: Scope & {
  idempotency_key: string; command: SignalWorkspaceDefinedInterestSelectionCommandV1;
}): Promise<{ selection: SignalWorkspaceDefinedInterestSelectionV1; replayed: boolean }> {
  const command = args.command;
  if (!requestKey.test(args.idempotency_key) || !key.test(command.term_key) || typeof command.selected !== "boolean"
    || ![command.generation_id, command.taxonomy_term_id].every(id => uuid.test(id))
    || command.snapshot_id !== null && !uuid.test(command.snapshot_id)
    || (command.snapshot_id === null) !== (command.expected_snapshot_digest === null)
    || command.expected_snapshot_digest !== null && !hash.test(command.expected_snapshot_digest)
    || !hash.test(command.definition_digest)
    || !Number.isSafeInteger(command.definition_revision) || command.definition_revision < 1
    || !Number.isSafeInteger(command.expected_selection_revision) || command.expected_selection_revision < 0)
    return fail("defined_interest_selection_request_invalid", 422);
  return tx(args, false, async client => {
    const value = (await client.query<{ value: unknown }>(
      "SELECT mutate_signal_defined_interest_selection_v1($1::uuid,$2::uuid,$3,$4::jsonb) value",
      [args.workspace_id, args.actor_user_id, args.idempotency_key, JSON.stringify(command)])).rows[0]?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail("defined_interest_selection_receipt_invalid", 503);
    const row = value as { selection?: unknown; replayed?: unknown };
    const receipt = selection(row.selection);
    if (receipt.workspace_id !== args.workspace_id || receipt.term_key !== command.term_key
      || receipt.selected !== command.selected || typeof row.replayed !== "boolean")
      return fail("defined_interest_selection_receipt_invalid", 503);
    return { selection: receipt, replayed: row.replayed };
  });
}
