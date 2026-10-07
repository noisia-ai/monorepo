import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";

const fixtureKeyPattern = /^jev-policy-[a-z0-9]{6,}$/u;
const providers = { anthropic: "claude-sonnet-5-5", typesafe: "jev-1.13.0" } as const;

type PolicyActionSnapshot = { action: string; kind: string; provider: string | null; model: string | null;
  configuration: Record<string, unknown>; configuration_digest: string;
  max_execution_micro_usd: string | null; automatic_allowed: boolean };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Testable invariant shared with the persisted successor-policy check. */
export function assertOnlyMentionFacetsChangedV1(before: PolicyActionSnapshot[], after: PolicyActionSnapshot[],
  provider: string, model: string) {
  const oldByAction = new Map(before.map(row => [row.action, row]));
  const newByAction = new Map(after.map(row => [row.action, row]));
  if (oldByAction.size !== before.length || newByAction.size !== after.length || oldByAction.size !== newByAction.size)
    throw new Error("mfp_jev_policy_copy_mismatch");
  for (const [action, old] of oldByAction) {
    const next = newByAction.get(action);
    if (!next) throw new Error("mfp_jev_policy_copy_mismatch");
    const expected = action === "mention_facets" ? { ...old, provider, model, configuration_digest: undefined,
      configuration: { ...old.configuration, provider, model } } : old;
    const nextComparable = { ...next, configuration_digest: action === "mention_facets" ? undefined : next.configuration_digest };
    if (canonical(expected) !== canonical(nextComparable)) throw new Error("mfp_jev_policy_copy_mismatch");
  }
  if (!oldByAction.has("mention_facets")) throw new Error("mfp_jev_policy_action_required");
}

export function assertMfpJevPolicyFixtureV1(fixture_key: string, organization_slug: string) {
  if (!fixtureKeyPattern.test(fixture_key) || organization_slug !== `mfp-${fixture_key}`)
    throw new Error("mfp_jev_policy_fixture_required");
}

/** Change only mention_facets in an MFP disposable fixture. Planning is read-only and
 * rolls back; execution is an internal operator action, never a client policy API. */
export async function switchMfpMentionFacetsProviderV1(args: {
  database: Pick<Pool, "connect">;
  fixture_key: string;
  workspace_id: string;
  organization_id: string;
  actor_user_id: string;
  provider: keyof typeof providers;
  execute?: boolean;
}) {
  assertMfpJevPolicyFixtureV1(args.fixture_key, `mfp-${args.fixture_key}`);
  const model = providers[args.provider];
  const client = await args.database.connect();
  let phase = "begin";
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout='10s'");
    phase = "scope";
    const scope = (await client.query<{ organization_id: string; organization_slug: string }>(
      `SELECT w.organization_id,o.slug organization_slug FROM signal_workspaces w
       JOIN organizations o ON o.id=w.organization_id WHERE w.id=$1 FOR SHARE OF w,o`,
      [args.workspace_id],
    )).rows[0];
    if (!scope || scope.organization_id !== args.organization_id)
      throw new Error("mfp_jev_policy_scope_invalid");
    assertMfpJevPolicyFixtureV1(args.fixture_key, scope.organization_slug);

    phase = "policy_lock";
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))", [scope.organization_id]);
    phase = "policy";
    const policies = (await client.query<{
      id: string; version: string; valid_until: string; budget_timezone: string; daily_cap_micro_usd: string | null;
    }>(`SELECT id,version::text,valid_until::text,budget_timezone,daily_cap_micro_usd::text
      FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'
      AND valid_from<=now() AND valid_until>now() FOR UPDATE`, [scope.organization_id])).rows;
    if (policies.length !== 1) throw new Error("mfp_jev_policy_active_required");
    const prior = policies[0]!;

    phase = "authority";
    await client.query("SELECT signal_processing_lock_v1($1,(now() AT TIME ZONE $2)::date)", [scope.organization_id, prior.budget_timezone]);
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspace_id,
      actor_user_id: args.actor_user_id, lock_authority: true });
    if (!caps.can_request_processing) throw new Error("mfp_jev_policy_forbidden");
    const actor = (await client.query(`SELECT 1 FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal'
      AND primary_role IN('noisia_admin','founder','admin') FOR SHARE`, [args.actor_user_id])).rows[0];
    if (!actor) throw new Error("mfp_jev_policy_creator_forbidden");

    phase = "blockers";
    const blockers = (await client.query<Record<string, number>>(`SELECT
      (SELECT count(*)::int FROM signal_labeling_runs r JOIN signal_workspaces w ON w.id=r.workspace_id
        WHERE w.organization_id=$1 AND r.status IN('queued','running')) labeling_runs,
      (SELECT count(*)::int FROM signal_labeling_calls call JOIN signal_workspaces w ON w.id=call.workspace_id
        WHERE w.organization_id=$1 AND call.status IN('reserved','submitting','submitted','unknown')) labeling_calls,
      (SELECT count(*)::int FROM signal_labeling_calls call JOIN signal_workspaces w ON w.id=call.workspace_id
        WHERE w.organization_id=$1 AND call.raw_storage_key IS NOT NULL AND NOT call.results_applied) unapplied_raw,
      (SELECT count(*)::int FROM signal_workspace_embedding_runs r JOIN signal_workspaces w ON w.id=r.workspace_id
        WHERE w.organization_id=$1 AND r.status IN('queued','running','outcome_unknown')) embedding_runs`, [scope.organization_id])).rows[0]!;
    phase = "actions";
    const actions = (await client.query<{ action: string; provider: string | null; model: string | null;
      max_execution_micro_usd: string | null; matches: boolean }>(`SELECT action,provider,model,max_execution_micro_usd::text,
      provider=$2 AND model=$3 AND configuration->>'provider'=$2 AND configuration->>'model'=$3 matches
      FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action`, [prior.id, args.provider, model])).rows;
    const mention = actions.find(action => action.action === "mention_facets");
    if (!mention) throw new Error("mfp_jev_policy_action_required");
    const blocked = Object.values(blockers).some(count => count > 0);
    const receipt = { stage: "jev_policy", provider: args.provider, model, execute: args.execute === true,
      blockers, action_count: actions.length, prior_version: prior.version,
      daily_cap_micro_usd: prior.daily_cap_micro_usd, mention_cap_micro_usd: mention.max_execution_micro_usd,
      other_actions_preserved: true };
    if (args.execute !== true || blocked || mention.matches) {
      phase = "plan";
      await client.query("ROLLBACK");
      return { ...receipt, status: blocked ? "blocked" : mention.matches ? "unchanged" : "planned" };
    }

    phase = "draft";
    const next = (await client.query<{ id: string; version: string }>(`INSERT INTO signal_processing_policy_versions
      (organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      SELECT $1,COALESCE(max(version),0)+1,'draft',now(),$2::timestamptz,$3,$4,$5
      FROM signal_processing_policy_versions WHERE organization_id=$1 RETURNING id,version::text`,
      [scope.organization_id, prior.valid_until, prior.budget_timezone, prior.daily_cap_micro_usd, args.actor_user_id])).rows[0]!;
    phase = "copy";
    await client.query(`WITH copied AS (
      SELECT action,kind,CASE WHEN action='mention_facets' THEN $3 ELSE provider END provider,
        CASE WHEN action='mention_facets' THEN $4 ELSE model END model,
        CASE WHEN action='mention_facets' THEN configuration||jsonb_build_object('provider',$3::text,'model',$4::text) ELSE configuration END configuration,
        configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2)
      INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
        configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,action,kind,provider,model,configuration,CASE WHEN action='mention_facets'
        THEN signal_semantic_context_digest_json_v2(configuration) ELSE configuration_digest END,
        max_execution_micro_usd,automatic_allowed FROM copied`, [next.id, prior.id, args.provider, model]);
    phase = "compare";
    const actionSnapshots = await client.query<PolicyActionSnapshot>(`SELECT action,kind,provider,model,configuration,
      configuration_digest,max_execution_micro_usd::text,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action` , [prior.id]);
    const successorSnapshots = await client.query<PolicyActionSnapshot>(`SELECT action,kind,provider,model,configuration,
      configuration_digest,max_execution_micro_usd::text,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action` , [next.id]);
    assertOnlyMentionFacetsChangedV1(actionSnapshots.rows, successorSnapshots.rows, args.provider, model);
    const configPreserved = (await client.query(`SELECT 1 FROM signal_processing_policy_actions a
      JOIN signal_processing_policy_actions b ON b.action=a.action AND b.policy_version_id=$2
      WHERE a.policy_version_id=$1 AND a.action='mention_facets' AND b.provider=$3 AND b.model=$4
      AND b.configuration=a.configuration||jsonb_build_object('provider',$3::text,'model',$4::text)`,
      [prior.id, next.id, args.provider, model])).rows.length === 1;
    if (!configPreserved) throw new Error("mfp_jev_policy_copy_mismatch");
    phase = "transition";
    if ((await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active' RETURNING id", [prior.id])).rowCount !== 1
      || (await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1 AND status='draft' RETURNING id", [next.id])).rowCount !== 1)
      throw new Error("mfp_jev_policy_transition_conflict");
    phase = "seal";
    const sealed = (await client.query(`SELECT 1 FROM signal_processing_policy_versions p
      JOIN signal_processing_policy_versions old ON old.id=$2
      WHERE p.id=$1 AND p.status='active' AND p.policy_digest IS NOT NULL AND old.status='revoked'
      AND ROW(p.valid_until,p.budget_timezone,p.daily_cap_micro_usd) IS NOT DISTINCT FROM ROW(old.valid_until,old.budget_timezone,old.daily_cap_micro_usd)
      AND (SELECT count(*) FROM signal_processing_policy_versions WHERE organization_id=p.organization_id AND status='active')=1`, [next.id, prior.id])).rows.length === 1;
    if (!sealed) throw new Error("mfp_jev_policy_seal_invalid");
    phase = "commit";
    await client.query("COMMIT");
    return { ...receipt, status: "activated", version: next.version };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : undefined;
    throw Object.assign(new Error("mfp_jev_policy_operation_failed"), { phase, code: message });
  } finally { client.release(); }
}
