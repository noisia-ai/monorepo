/** Read-only MFP H1 census. Prints no IDs, text, raw receipts or credentials. */
import { mkdir, writeFile } from "node:fs/promises";
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "./fixture-identity";

const directory = ".data/dev-corpus/voyage-real/hybrid-h1-r5";
void main(async () => {
  if (!process.argv.includes("--real")) throw new Error("mfp_hybrid_census_real_flag_required");
  const phase = process.argv.find(arg => arg.startsWith("--phase="))?.slice(8);
  if (phase !== "before" && phase !== "after") throw new Error("mfp_hybrid_census_phase_required");
  const identity = await loadMfpEvalIdentity();
  const database = await openDatabase();
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = (await client.query<{slug:string;organization_id:string}>(`
      SELECT organization.slug,workspace.organization_id FROM signal_workspaces workspace
      JOIN organizations organization ON organization.id=workspace.organization_id WHERE workspace.id=$1`,
      [identity.workspace_id])).rows[0];
    if (!scope || scope.organization_id !== identity.organization_id ||
      scope.slug !== `mfp-${identity.fixture_key}`) throw new Error("mfp_hybrid_census_fixture_invalid");
    const census = (await client.query<Record<string,string|number|boolean|null>>(`SELECT
      (SELECT count(*)::int FROM signal_mention_facets_current_v1 WHERE workspace_id=$1) roots,
      (SELECT count(*)::int FROM signal_membership_evidence_rights_v1
        WHERE workspace_id=$1 AND metrics AND evidence) evidence_authorized_roots,
      (SELECT count(*)::int FROM signal_hybrid_membership_routes WHERE workspace_id=$1) selected_routes,
      (SELECT count(*)::int FROM signal_processing_policy_versions
        WHERE organization_id=$2 AND status='active' AND valid_from<=now() AND valid_until>now()) active_policies,
      (SELECT daily_cap_micro_usd::text FROM signal_processing_policy_versions
        WHERE organization_id=$2 AND status='active' AND valid_from<=now() AND valid_until>now()
        LIMIT 1) active_policy_daily_cap_micro_usd,
      (SELECT count(*)::int FROM signal_processing_policy_actions action
        JOIN signal_processing_policy_versions policy ON policy.id=action.policy_version_id
        WHERE policy.organization_id=$2 AND policy.status='active') active_actions,
      (SELECT count(*)::int FROM signal_processing_policy_actions action
        JOIN signal_processing_policy_versions policy ON policy.id=action.policy_version_id
        WHERE policy.organization_id=$2 AND policy.status='active'
          AND action.action IN('concept_membership_jev','concept_membership_claude')) hybrid_actions,
      (SELECT count(*)::int FROM signal_labeling_runs WHERE workspace_id=$1 AND kind='membership'
        AND membership_snapshot->>'hybrid_stage' IN('jev','claude')) hybrid_runs,
      (SELECT count(*)::int FROM signal_labeling_runs WHERE workspace_id=$1 AND kind='membership'
        AND membership_snapshot->>'hybrid_stage' IN('jev','claude')
        AND status IN('queued','running')) active_hybrid_runs,
      (SELECT count(*)::int FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
        WHERE run.workspace_id=$1 AND run.membership_snapshot->>'hybrid_stage' IN('jev','claude')
          AND (call.status IN('reserved','submitting','submitted','unknown')
            OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied)) unsettled_hybrid_calls,
      (SELECT count(*)::int FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
        WHERE run.workspace_id=$1 AND run.membership_snapshot->>'hybrid_stage' IN('jev','claude')
          AND call.status='unknown') unknown_hybrid_calls,
      (SELECT COALESCE(sum(call.settled_micro_usd),0)::text FROM signal_labeling_calls call
        JOIN signal_labeling_runs run ON run.id=call.run_id
        WHERE run.workspace_id=$1 AND run.membership_snapshot->>'hybrid_stage'='jev'
          AND call.status='settled') jev_settled_micro_usd,
      (SELECT COALESCE(sum(call.settled_micro_usd),0)::text FROM signal_labeling_calls call
        JOIN signal_labeling_runs run ON run.id=call.run_id
        WHERE run.workspace_id=$1 AND run.membership_snapshot->>'hybrid_stage'='claude'
          AND call.status='settled') claude_settled_micro_usd,
      (SELECT count(*)::int FROM signal_hybrid_membership_decisions WHERE workspace_id=$1) hybrid_decisions,
      (SELECT COALESCE(sum(call.settled_micro_usd),0)::text FROM signal_labeling_calls call
        JOIN signal_labeling_runs run ON run.id=call.run_id
        JOIN signal_labeler_versions version ON version.id=run.labeler_version_id
        WHERE run.workspace_id=$1 AND run.kind='facets' AND version.provider='typesafe'
          AND version.model='jev-1.13.0' AND call.status='settled') jev_facets_settled_micro_usd,
      (SELECT count(*)::int FROM signal_hybrid_membership_decisions
        WHERE workspace_id=$1 AND verdict='review_required') review_required,
      (SELECT count(*)::int FROM signal_concept_membership_overrides
        WHERE workspace_id=$1 AND superseded_at IS NULL) current_human_overrides`,
      [identity.workspace_id, identity.organization_id])).rows[0]!;
    await client.query("ROLLBACK");
    const receipt = { contract_version: "mfp-hybrid-h1-census-v1", phase, observed_at: new Date().toISOString(), ...census };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${directory}/census-${phase}.json`, JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify(receipt));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await database.end();
  }
});
