/** Guarded MFP operator tool. Plans by default; --execute seals a successor policy.
 * No provider I/O, admissions, source text, credentials, or public identifiers. */
import { readFile } from 'node:fs/promises';
import type { LabelingDatabaseV1 } from '../../infrastructure/db/signal-mention-facets';
import { main, openDatabase } from '../dev-corpus/guard.mjs';

void main(async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--execute' && !/^--provider=(anthropic|typesafe)$/u.test(arg))
    || args.filter(arg => arg.startsWith('--provider=')).length > 1) throw new Error('mfp_jev_policy_arguments_invalid');
  const provider = args.find(arg => arg.startsWith('--provider='))?.slice(11) ?? 'typesafe';
  const model = provider === 'typesafe' ? 'jev-1.13.0' : 'claude-sonnet-5-5';
  const execute = args.includes('--execute');
  const identity = JSON.parse(await readFile('.data/dev-corpus/identity.json', 'utf8'));
  const pool = await openDatabase();
  const database: LabelingDatabaseV1 = pool;
  const c = await database.connect();
  let phase: 'begin' | 'scope' | 'policy_lock' | 'policy' | 'authority' | 'blockers' | 'actions'
    | 'plan' | 'draft' | 'copy' | 'compare' | 'transition' | 'seal' | 'commit' = 'begin';
  try {
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await c.query("SET LOCAL lock_timeout='10s'");
    phase = 'scope';
    const scope = (await c.query<{ organization_id: string }>(
      'SELECT organization_id FROM signal_workspaces WHERE id=$1', [identity.workspace_id])).rows[0];
    if (!scope || scope.organization_id !== identity.organization_id) throw new Error('mfp_jev_policy_scope_invalid');
    phase = 'policy_lock';
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))", [scope.organization_id]);
    phase = 'policy';
    const policies = (await c.query<{
      id: string; version: string; valid_until: string; budget_timezone: string; daily_cap_micro_usd: string | null;
    }>(`SELECT id,version::text,valid_until::text,budget_timezone,daily_cap_micro_usd::text
      FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'
      AND valid_from<=now() AND valid_until>now() FOR UPDATE`, [scope.organization_id])).rows;
    if (policies.length !== 1) throw new Error('mfp_jev_policy_active_required');
    const prior = policies[0]!;
    phase = 'authority';
    // Preserve common policy -> day -> actor lock order, including inspection mode.
    await c.query("SELECT signal_processing_lock_v1($1,(now() AT TIME ZONE $2)::date)", [scope.organization_id, prior.budget_timezone]);
    const { loadSignalWorkspaceCapabilitiesStoreV1 } = await import('../../infrastructure/db/signal-workspace-capabilities');
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: c, workspace_id: identity.workspace_id,
      actor_user_id: identity.internal_user_id, lock_authority: true });
    if (!caps.can_request_processing) throw new Error('mfp_jev_policy_forbidden');
    const actor = (await c.query(`SELECT 1 FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal'
      AND primary_role IN('noisia_admin','founder','admin') FOR SHARE`, [identity.internal_user_id])).rows[0];
    if (!actor) throw new Error('mfp_jev_policy_creator_forbidden');
    phase = 'blockers';
    const blockers = (await c.query<Record<string, number>>(`SELECT
      (SELECT count(*)::int FROM signal_labeling_runs r JOIN signal_workspaces w ON w.id=r.workspace_id
        WHERE w.organization_id=$1 AND r.status IN('queued','running')) labeling_runs,
      (SELECT count(*)::int FROM signal_labeling_calls call JOIN signal_workspaces w ON w.id=call.workspace_id
        WHERE w.organization_id=$1 AND call.status IN('reserved','submitting','submitted','unknown')) labeling_calls,
      (SELECT count(*)::int FROM signal_labeling_calls call JOIN signal_workspaces w ON w.id=call.workspace_id
        WHERE w.organization_id=$1 AND call.raw_storage_key IS NOT NULL AND NOT call.results_applied) unapplied_raw,
      (SELECT count(*)::int FROM signal_workspace_embedding_runs r JOIN signal_workspaces w ON w.id=r.workspace_id
        WHERE w.organization_id=$1 AND r.status IN('queued','running','outcome_unknown')) embedding_runs`, [scope.organization_id])).rows[0]!;
    phase = 'actions';
    const actions = (await c.query<{ action: string; provider: string | null; model: string | null;
      max_execution_micro_usd: string | null; matches: boolean }>(`SELECT action,provider,model,max_execution_micro_usd::text,
      provider=$2 AND model=$3 AND configuration->>'provider'=$2 AND configuration->>'model'=$3 matches
      FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action`, [prior.id, provider, model])).rows;
    const mention = actions.find(action => action.action === 'mention_facets');
    if (!mention) throw new Error('mfp_jev_policy_action_required');
    const blocked = Object.values(blockers).some(count => count > 0);
    const receipt = { stage: 'jev_policy', provider, model, execute, blockers, action_count: actions.length,
      prior_version: prior.version, daily_cap_micro_usd: prior.daily_cap_micro_usd,
      mention_cap_micro_usd: mention.max_execution_micro_usd, other_actions_preserved: true };
    if (!execute || blocked || mention.matches) {
      phase = 'plan';
      await c.query('ROLLBACK');
      console.log(JSON.stringify({ ...receipt, status: blocked ? 'blocked' : mention.matches ? 'unchanged' : 'planned' }));
      if (execute && blocked) throw new Error('mfp_jev_policy_work_active');
      return;
    }
    phase = 'draft';
    const next = (await c.query<{ id: string; version: string }>(`INSERT INTO signal_processing_policy_versions
      (organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      SELECT $1,COALESCE(max(version),0)+1,'draft',now(),$2::timestamptz,$3,$4,$5
      FROM signal_processing_policy_versions WHERE organization_id=$1 RETURNING id,version::text`,
      [scope.organization_id, prior.valid_until, prior.budget_timezone, prior.daily_cap_micro_usd, identity.internal_user_id])).rows[0]!;
    phase = 'copy';
    await c.query(`WITH copied AS (
      SELECT action,kind,CASE WHEN action='mention_facets' THEN $3 ELSE provider END provider,
        CASE WHEN action='mention_facets' THEN $4 ELSE model END model,
        CASE WHEN action='mention_facets' THEN configuration||jsonb_build_object('provider',$3::text,'model',$4::text) ELSE configuration END configuration,
        configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2)
      INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
        configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,action,kind,provider,model,configuration,CASE WHEN action='mention_facets'
        THEN signal_semantic_context_digest_json_v2(configuration) ELSE configuration_digest END,
        max_execution_micro_usd,automatic_allowed FROM copied`, [next.id, prior.id, provider, model]);
    // Compare every action field in both directions. Only the three target fields and
    // their digest may differ on mention_facets; all caps and unrelated configuration stay exact.
    phase = 'compare';
    const difference = (await c.query<{ differences: number }>(`WITH old AS (
      SELECT action,(to_jsonb(a)-'policy_version_id')-CASE WHEN action='mention_facets'
        THEN ARRAY['provider','model','configuration','configuration_digest'] ELSE ARRAY[]::text[] END value
      FROM signal_processing_policy_actions a WHERE policy_version_id=$1), new AS (
      SELECT action,(to_jsonb(a)-'policy_version_id')-CASE WHEN action='mention_facets'
        THEN ARRAY['provider','model','configuration','configuration_digest'] ELSE ARRAY[]::text[] END value
      FROM signal_processing_policy_actions a WHERE policy_version_id=$2)
      SELECT count(*)::int differences FROM ((SELECT * FROM old EXCEPT SELECT * FROM new)
        UNION ALL (SELECT * FROM new EXCEPT SELECT * FROM old)) differences`, [prior.id, next.id])).rows[0]!;
    const configPreserved = (await c.query(`SELECT 1 FROM signal_processing_policy_actions a
      JOIN signal_processing_policy_actions b ON b.action=a.action AND b.policy_version_id=$2
      WHERE a.policy_version_id=$1 AND a.action='mention_facets' AND b.provider=$3 AND b.model=$4
      AND b.configuration=a.configuration||jsonb_build_object('provider',$3::text,'model',$4::text)`,
      [prior.id, next.id, provider, model])).rows.length === 1;
    if (difference.differences !== 0 || !configPreserved) throw new Error('mfp_jev_policy_copy_mismatch');
    phase = 'transition';
    if ((await c.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active' RETURNING id", [prior.id])).rowCount !== 1
      || (await c.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1 AND status='draft' RETURNING id", [next.id])).rowCount !== 1)
      throw new Error('mfp_jev_policy_transition_conflict');
    phase = 'seal';
    const sealed = (await c.query(`SELECT 1 FROM signal_processing_policy_versions p
      JOIN signal_processing_policy_versions old ON old.id=$2
      WHERE p.id=$1 AND p.status='active' AND p.policy_digest IS NOT NULL AND old.status='revoked'
      AND ROW(p.valid_until,p.budget_timezone,p.daily_cap_micro_usd) IS NOT DISTINCT FROM ROW(old.valid_until,old.budget_timezone,old.daily_cap_micro_usd)
      AND (SELECT count(*) FROM signal_processing_policy_versions WHERE organization_id=p.organization_id AND status='active')=1`, [next.id, prior.id])).rows.length === 1;
    if (!sealed) throw new Error('mfp_jev_policy_seal_invalid');
    phase = 'commit';
    await c.query('COMMIT');
    console.log(JSON.stringify({ ...receipt, status: 'activated', version: next.version }));
  } catch (error) {
    const sqlstate = error && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string' && /^[0-9A-Z]{5}$/u.test(error.code) ? error.code : undefined;
    const message = error instanceof Error && error.message.length <= 160 && /^[a-z_]+$/u.test(error.message)
      ? error.message : undefined;
    console.error(JSON.stringify({ stage: 'jev_policy_error', phase, sqlstate, message }));
    await c.query('ROLLBACK');
    throw error;
  } finally { c.release(); await pool.end(); }
});
