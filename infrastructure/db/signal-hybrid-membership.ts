import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  conceptSetDigestV1,
  decideHybridMembershipV1,
  labelerDigestV1,
  llmCostMicroUsdV1,
  llmPriceV1,
  signalWorkspaceEmbeddingDigestV1,
  type LabelerIdentity,
  type HybridClaudeDecisionV1,
  type HybridJevDecisionV1,
  type MembershipInputV1,
} from "@noisia/query-engine";
import { loadMembershipConceptsV1 } from "./signal-concept-memberships";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { signalWorkspaceFeatureEnabledV1 } from "./signal-workspace-features";
import { requestMentionFacetsV1, SignalLabelingError } from "./signal-labeling-runs";
import type { LabelingDatabaseV1 } from "./signal-mention-facets";
import { hybridH1ClaudeAdmissionPopulationSqlV1, hybridH1JevAdmissionPopulationSqlV1 } from "./signal-hybrid-admission-population";

const fail = (code: string, status = 409): never => { throw new SignalLabelingError(code, status); };
const jevDigest = signalWorkspaceEmbeddingDigestV1({ contract_version: "mfp-hybrid-h1-jev-v1", model: "jev-1.13.0", question: "noul", threshold: 0.4 });
const claudeDigest = signalWorkspaceEmbeddingDigestV1({ contract_version:"mfp-hybrid-claude-confirm-v1",
  model:"claude-sonnet-5-5",thinking:"adaptive",effort:"medium" });
export const hybridH1RouteDigestV1 = (jevFacetsLabelerDigest: string) => signalWorkspaceEmbeddingDigestV1({
  contract_version: "mfp-hybrid-h1-v1", jev_facets_labeler_digest: jevFacetsLabelerDigest,
  jev_judge_labeler_digest: jevDigest, claude_labeler_digest: claudeDigest,
});
export type HybridMembershipStageV1 = "jev" | "claude";
export function hybridMembershipStageIdentityV1(stage: HybridMembershipStageV1, route_digest: string): LabelerIdentity {
  return { kind: "membership", provider: stage === "jev" ? "typesafe" : "anthropic",
    model: stage === "jev" ? "jev-1.13.0" : "claude-sonnet-5-5",
    prompt_digest: stage === "jev" ? jevDigest : claudeDigest,
    schema_digest: signalWorkspaceEmbeddingDigestV1({ contract_version:"mfp-hybrid-h1-stage-result-v1",stage }),
    params: { contract_version:"mfp-hybrid-h1-stage-v1",stage,route_digest } };
}

/** Stage admissions are separate because the common ledger requires one provider/model per run. */
export async function requestHybridMembershipStageV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  stage: HybridMembershipStageV1; route_digest: string; idempotency_key: string;
  provider_available: boolean; budget_micro_usd?: number | null; cap_micro_usd?: number | null;
}) {
  const identity = hybridMembershipStageIdentityV1(args.stage, args.route_digest);
  return requestMentionFacetsV1({ ...args, identity, adapter: {
    request_identity: { contract_version:"mfp-hybrid-h1-stage-request-v1",stage:args.stage,route_digest:args.route_digest },
    policy_action: args.stage === "jev" ? "concept_membership_jev" : "concept_membership_claude",
    feature: "concept_membership", select_labeler: false,
    validateIdentity: candidate => { if (labelerDigestV1(candidate) !== labelerDigestV1(identity)) fail("hybrid_stage_identity_changed"); },
    prepare: async (client, workspace, _runId, _labeler, context) => {
      const route = (await client.query<{route_digest:string;jev_facets_labeler_version_id:string}>(
        "SELECT route_digest,jev_facets_labeler_version_id FROM signal_hybrid_membership_routes WHERE workspace_id=$1 FOR UPDATE",
        [workspace])).rows[0];
      if (!route || route.route_digest !== args.route_digest) return fail("hybrid_route_changed");
      const selected = (await client.query<{labeler_version_id:string}>(
        "SELECT labeler_version_id FROM signal_workspace_labelers WHERE workspace_id=$1 AND kind='facets'",
        [workspace])).rows[0];
      if (selected?.labeler_version_id !== route.jev_facets_labeler_version_id) return fail("hybrid_facets_labeler_changed");
      const concepts = await loadMembershipConceptsV1(client, workspace);
      if (!concepts.length) return fail("hybrid_concepts_required");
      let jev_run_id: string | null = null;
      if (args.stage === "claude") {
        const prior = (await client.query<{id:string;unknown:number}>(`SELECT run.id,
          (SELECT count(*)::int FROM signal_labeling_calls call WHERE call.run_id=run.id AND
            (call.status IN('reserved','submitting','submitted','unknown') OR NOT call.results_applied)) unknown
          FROM signal_labeling_runs run WHERE run.workspace_id=$1 AND run.kind='membership'
            AND run.status='completed' AND run.membership_snapshot->>'hybrid_stage'='jev'
            AND run.membership_snapshot->>'route_digest'=$2 ORDER BY run.completed_at DESC LIMIT 1`,
          [workspace, args.route_digest])).rows[0];
        if (!prior || prior.unknown) return fail("hybrid_jev_stage_incomplete");
        jev_run_id = prior.id;
        const active = (await client.query<{count:number}>(`SELECT count(*)::int count
          FROM signal_labeling_runs run WHERE run.workspace_id=$1 AND run.kind='membership'
            AND run.membership_snapshot->>'hybrid_stage'='jev'
            AND run.membership_snapshot->>'route_digest'=$2 AND run.status IN('queued','running')`,
          [workspace,args.route_digest])).rows[0]!.count;
        const remaining = (await client.query<{pairs:number}>(hybridH1JevAdmissionPopulationSqlV1,
          [workspace,args.route_digest])).rows[0]!.pairs;
        if (active || remaining) return fail("hybrid_jev_stage_incomplete");
      }
      const population = args.stage === "jev"
        ? (await client.query<{roots:number;pairs:number;characters:string}>(
          hybridH1JevAdmissionPopulationSqlV1, [workspace,args.route_digest])).rows[0]!
        : (await client.query<{roots:number;pairs:number;characters:string}>(
          hybridH1ClaudeAdmissionPopulationSqlV1, [workspace,args.route_digest])).rows[0]!;
      const jevPrice=Number(process.env.NOISIA_JEV_INPUT_USD_PER_MTOK);
      if (args.stage === "jev" && (!Number.isFinite(jevPrice) || jevPrice <= 0))
        return fail("hybrid_jev_price_required");
      // Advisory estimate only. The shared ledger checks the actual reservation and settlement.
      const estimated_micro_usd=llmCostMicroUsdV1({
        input_tokens:Math.ceil(Number(population.characters)/3.5)+population.pairs*500,
        output_tokens:args.stage === "claude" ? population.pairs*512 : 0,
        cache_read_input_tokens:0,cache_creation_input_tokens:0,
        cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}},
      llmPriceV1(args.stage === "jev" ? "typesafe" : "anthropic",
        args.stage === "jev" ? "jev-1.13.0" : "claude-sonnet-5-5","sync",jevPrice));
      return { roots:population.roots,estimated_micro_usd,
        snapshot:{ hybrid_stage:args.stage,route_digest:args.route_digest,jev_run_id,concepts,
          context_digest:signalWorkspaceEmbeddingDigestV1(context),preview:false,sample_root_ids:null },
        concept_set_digest:conceptSetDigestV1(concepts) };
    },
    persist: async (client, runId, prepared) => {
      await client.query("UPDATE signal_labeling_runs SET membership_snapshot=$2::jsonb,concept_set_digest=$3 WHERE id=$1",
        [runId,JSON.stringify(prepared.snapshot),prepared.concept_set_digest]);
    },
  } });
}

async function transaction<T>(database: LabelingDatabaseV1, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function authorize(client: PoolClient, workspace_id: string, actor_user_id: string, edit = false) {
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id, actor_user_id, lock_authority: edit });
  if (edit ? !caps.can_edit_topics || !caps.can_request_processing : !caps.can_view) fail("hybrid_forbidden", 403);
  if (!await signalWorkspaceFeatureEnabledV1({ queryable: client, workspace_id, feature: "concept_membership" }) ||
      !await signalWorkspaceFeatureEnabledV1({ queryable: client, workspace_id, feature: "mention_facets" }))
    fail("hybrid_not_enabled", 404);
  return caps;
}

/** Route selection is explicit, workspace scoped and reversible. No provider is invoked here. */
export async function configureHybridMembershipRouteV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  route: "standard" | "hybrid_h1"; provider_available: boolean;
}) {
  if (args.route === "hybrid_h1" && !args.provider_available) fail("hybrid_provider_unavailable", 503);
  return transaction(args.database, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))", [args.workspace_id]);
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    const active = (await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM signal_labeling_runs run WHERE run.workspace_id=$1
        AND run.kind IN('facets','membership') AND (run.status IN('queued','running') OR EXISTS(
          SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=run.id
            AND (call.status IN('reserved','submitting','submitted','unknown')
              OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied)))`,
      [args.workspace_id])).rows[0]!.count;
    if (active) fail("hybrid_run_active");
    const existing = (await client.query<{route_digest:string;jev_facets_labeler_version_id:string;
      prior_facets_labeler_version_id:string|null}>(
      "SELECT route_digest,jev_facets_labeler_version_id,prior_facets_labeler_version_id FROM signal_hybrid_membership_routes WHERE workspace_id=$1 FOR UPDATE",
      [args.workspace_id])).rows[0];
    const currentFacets = (await client.query<{labeler_version_id:string}>(
      "SELECT labeler_version_id FROM signal_workspace_labelers WHERE workspace_id=$1 AND kind='facets' FOR UPDATE",
      [args.workspace_id])).rows[0]?.labeler_version_id ?? null;
    if (args.route === "standard") {
      if (existing) {
        if (currentFacets !== existing.jev_facets_labeler_version_id) fail("hybrid_facets_labeler_changed");
        if (existing.prior_facets_labeler_version_id)
          await client.query("UPDATE signal_workspace_labelers SET labeler_version_id=$2 WHERE workspace_id=$1 AND kind='facets'",
            [args.workspace_id, existing.prior_facets_labeler_version_id]);
        else await client.query("DELETE FROM signal_workspace_labelers WHERE workspace_id=$1 AND kind='facets'", [args.workspace_id]);
        await client.query("DELETE FROM signal_hybrid_membership_routes WHERE workspace_id=$1", [args.workspace_id]);
      }
      return { route: "standard" as const, route_digest: null };
    }
    if (existing) {
      if (currentFacets !== existing.jev_facets_labeler_version_id) fail("hybrid_facets_labeler_changed");
      return { route: "hybrid_h1" as const, route_digest: existing.route_digest };
    }
    const population = (await client.query<{roots:number}>(
      "SELECT count(*)::int roots FROM signal_mention_facets_current_v1 WHERE workspace_id=$1", [args.workspace_id])).rows[0]!.roots;
    if (!population) fail("hybrid_facets_required");
    const jevFacets = (await client.query<{id:string;labeler_digest:string;roots:number}>(`
      SELECT version.id,version.labeler_digest,count(DISTINCT label.root_id)::int roots
      FROM signal_labeler_versions version JOIN signal_mention_facet_labels label ON label.labeler_digest=version.labeler_digest
      JOIN signal_mention_facets_current_v1 current ON current.workspace_id=label.workspace_id AND current.root_id=label.root_id
        AND current.input_digest=label.input_digest AND NOT current.requires_context_review
        AND current.entity_context_digest=label.entity_context_digest
      WHERE label.workspace_id=$1 AND version.kind='facets' AND version.provider='typesafe'
        AND version.model='jev-1.13.0' AND version.status<>'retired' AND label.status IN('labeled','abstained')
      GROUP BY version.id,version.labeler_digest HAVING count(DISTINCT label.root_id)=$2
      ORDER BY version.id LIMIT 1`, [args.workspace_id, population])).rows[0];
    if (!jevFacets) return fail("hybrid_facets_incomplete");
    const routeDigest = hybridH1RouteDigestV1(jevFacets.labeler_digest);
    await client.query(`INSERT INTO signal_workspace_labelers(workspace_id,kind,labeler_version_id) VALUES($1,'facets',$2)
      ON CONFLICT(workspace_id,kind) DO UPDATE SET labeler_version_id=excluded.labeler_version_id`,
      [args.workspace_id, jevFacets.id]);
    await client.query(`INSERT INTO signal_hybrid_membership_routes(workspace_id,route,route_digest,jev_labeler_digest,
      claude_labeler_digest,jev_facets_labeler_version_id,prior_facets_labeler_version_id,configured_by_user_id)
      VALUES($1,'hybrid_h1',$2,$3,$4,$5,$6,$7)`,
      [args.workspace_id, routeDigest, jevDigest, claudeDigest, jevFacets.id, currentFacets, args.actor_user_id]);
    return { route: "hybrid_h1" as const, route_digest: routeDigest };
  });
}

export async function loadHybridMembershipRouteV1(args: { database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string }) {
  return transaction(args.database, async client => {
    await authorize(client, args.workspace_id, args.actor_user_id);
    const selected = (await client.query<{route:string;route_digest:string}>(
      "SELECT route,route_digest FROM signal_hybrid_membership_routes WHERE workspace_id=$1", [args.workspace_id])).rows[0];
    return selected ?? { route: "standard", route_digest: null };
  });
}

/** Review data is withheld unless the same rights view allows evidence for this root. */
export async function loadHybridMembershipReviewQueueV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; limit?: number;
}) {
  return transaction(args.database, async client => {
    const caps = await authorize(client, args.workspace_id, args.actor_user_id);
    const limit = Math.min(100, Math.max(1, args.limit ?? 50));
    const items = (await client.query(`SELECT h.root_id,h.concept_key,h.definition_digest,h.jev,h.claude,h.created_at,
      CASE WHEN rights.evidence THEN f.full_text ELSE NULL END text,NOT rights.evidence evidence_withheld
      FROM signal_concept_memberships_current_v1 current
      JOIN signal_hybrid_membership_routes route ON route.workspace_id=current.workspace_id AND route.route_digest=current.labeler_digest
      JOIN signal_hybrid_membership_decisions h ON h.workspace_id=current.workspace_id AND h.root_id=current.root_id
        AND h.root_fingerprint=current.root_fingerprint AND h.concept_key=current.concept_key AND h.definition_digest=current.definition_digest
        AND h.entity_context_digest=current.entity_context_digest AND h.effective_entities_digest=current.effective_entities_digest
        AND h.route_digest=route.route_digest
      JOIN signal_mention_facets_current_v1 f ON f.workspace_id=h.workspace_id AND f.root_id=h.root_id
      JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=h.workspace_id AND rights.root_id=h.root_id AND rights.metrics
      WHERE current.workspace_id=$1 AND current.verdict='review_required'
      ORDER BY h.root_id,h.concept_key LIMIT $2`, [args.workspace_id, limit])).rows;
    return { route: "hybrid_h1", can_override: caps.can_edit_topics, items: items.map(item =>
      item.evidence_withheld ? { ...item, jev: { verdict: item.jev.verdict, probability: item.jev.probability },
        claude: { verdict: item.claude.verdict }, text: null } : item) };
  });
}

export type HybridDecisionInputV1 = {
  root_id: string; root_fingerprint: string; concept_key: string; definition_digest: string;
  entity_context_digest: string; effective_entities_digest: string; text: string;
  jev: HybridJevDecisionV1; jev_call_id: string;
  claude: HybridClaudeDecisionV1 | null; claude_call_id: string | null; rationale: string | null;
};
export function hybridDecisionRecordV1(input: HybridDecisionInputV1) {
  const result = decideHybridMembershipV1(input.text, input.jev, input.claude);
  if (result.verdict === "pending") fail("hybrid_pending_decision");
  const citation = result.verdict === "belongs" && input.claude?.citation ? [input.claude.citation] : [];
  const stored = { ...input, text:undefined, verdict:result.verdict, citation };
  const result_digest = `sha256:${createHash("sha256").update(JSON.stringify(stored)).digest("hex")}`;
  return { ...stored, result_digest };
}
/** One page write. The caller must supply settled, durable provider receipts. */
export async function writeHybridMembershipDecisionPageV1(args: {
  client: PoolClient; workspace_id: string; route_digest: string; decisions: HybridDecisionInputV1[];
}) {
  if (!args.decisions.length || args.decisions.length > 200) fail("hybrid_page_invalid", 400);
  const selected = (await args.client.query<{route_digest:string}>(
    "SELECT route_digest FROM signal_hybrid_membership_routes WHERE workspace_id=$1 FOR UPDATE", [args.workspace_id])).rows[0];
  if (!selected || selected.route_digest !== args.route_digest) fail("hybrid_route_changed");
  const rows = args.decisions.map(hybridDecisionRecordV1);
  const matched = (await args.client.query<{count:number}>(`SELECT count(*)::int count FROM jsonb_to_recordset($2::jsonb)
    r(root_id uuid,root_fingerprint text,concept_key text,definition_digest text,entity_context_digest text,effective_entities_digest text)
    JOIN signal_concept_memberships_current_v1 current ON current.workspace_id=$1 AND current.root_id=r.root_id
      AND current.root_fingerprint=r.root_fingerprint AND current.concept_key=r.concept_key AND current.definition_digest=r.definition_digest
      AND current.entity_context_digest=r.entity_context_digest AND current.effective_entities_digest=r.effective_entities_digest
    JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=current.workspace_id AND rights.root_id=current.root_id
      AND rights.metrics AND rights.evidence`, [args.workspace_id, JSON.stringify(rows)])).rows[0]!.count;
  if (matched !== rows.length) fail("hybrid_population_or_rights_changed");
  const receipts = (await args.client.query<{count:number}>(`SELECT count(*)::int count FROM jsonb_to_recordset($2::jsonb)
    r(root_id uuid,root_fingerprint text,concept_key text,definition_digest text,
      entity_context_digest text,effective_entities_digest text,jev jsonb,claude jsonb,
      jev_call_id uuid,claude_call_id uuid)
    JOIN signal_labeling_calls j ON j.id=r.jev_call_id AND j.workspace_id=$1 AND j.status='settled'
      AND j.provider='typesafe' AND j.model='jev-1.13.0' AND j.results_applied
      AND j.raw_sha256 IS NOT NULL AND j.raw_storage_key IS NOT NULL AND j.raw_size_bytes IS NOT NULL
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(j.results) result
        WHERE result->>'root_id'=r.root_id::text AND result->>'root_fingerprint'=r.root_fingerprint
          AND result->>'concept_key'=r.concept_key AND result->>'definition_digest'=r.definition_digest
          AND result->>'entity_context_digest'=r.entity_context_digest
          AND result->>'effective_entities_digest'=r.effective_entities_digest
          AND result->>'jev_call_id'=j.id::text AND result->'jev'=r.jev)
    JOIN signal_labeling_runs jr ON jr.id=j.run_id AND jr.workspace_id=$1
      AND jr.membership_snapshot->>'hybrid_stage'='jev' AND jr.membership_snapshot->>'route_digest'=$3
    JOIN signal_processing_admissions ja ON ja.id=jr.processing_admission_id AND ja.action='concept_membership_jev'
    LEFT JOIN signal_labeling_calls c ON c.id=r.claude_call_id AND c.workspace_id=$1 AND c.status='settled'
      AND c.provider='anthropic' AND c.model='claude-sonnet-5-5' AND c.results_applied
      AND c.raw_sha256 IS NOT NULL AND c.raw_storage_key IS NOT NULL AND c.raw_size_bytes IS NOT NULL
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.results) result
        WHERE result->>'root_id'=r.root_id::text AND result->>'root_fingerprint'=r.root_fingerprint
          AND result->>'concept_key'=r.concept_key AND result->>'definition_digest'=r.definition_digest
          AND result->>'entity_context_digest'=r.entity_context_digest
          AND result->>'effective_entities_digest'=r.effective_entities_digest
          AND result->>'jev_call_id'=j.id::text AND result->>'claude_call_id'=c.id::text
          AND result->'jev'=r.jev AND result->'claude'=r.claude)
    LEFT JOIN signal_labeling_runs cr ON cr.id=c.run_id AND cr.workspace_id=$1
      AND cr.membership_snapshot->>'hybrid_stage'='claude' AND cr.membership_snapshot->>'route_digest'=$3
    LEFT JOIN signal_processing_admissions ca ON ca.id=cr.processing_admission_id AND ca.action='concept_membership_claude'
    WHERE (r.claude_call_id IS NULL AND r.claude IS NULL) OR ca.id IS NOT NULL`,
    [args.workspace_id,JSON.stringify(rows),args.route_digest])).rows[0]!.count;
  if (receipts !== rows.length) fail("hybrid_settled_receipt_required");
  await args.client.query(`INSERT INTO signal_hybrid_membership_decisions(workspace_id,root_id,root_fingerprint,concept_key,definition_digest,
      entity_context_digest,effective_entities_digest,route_digest,result_digest,jev_call_id,claude_call_id,
      verdict,jev,claude,citation,rationale)
    SELECT $1,r.root_id,r.root_fingerprint,r.concept_key,r.definition_digest,r.entity_context_digest,r.effective_entities_digest,$2,
      r.result_digest,r.jev_call_id,r.claude_call_id,r.verdict,r.jev,r.claude,r.citation,r.rationale
    FROM jsonb_to_recordset($3::jsonb) r(root_id uuid,root_fingerprint text,concept_key text,definition_digest text,
      entity_context_digest text,effective_entities_digest text,result_digest text,jev_call_id uuid,claude_call_id uuid,
      verdict text,jev jsonb,claude jsonb,citation jsonb,rationale text)
    ON CONFLICT DO NOTHING`, [args.workspace_id, args.route_digest, JSON.stringify(rows)]);
  const persisted = (await args.client.query<{count:number}>(`SELECT count(*)::int count FROM jsonb_to_recordset($2::jsonb) r(
      root_fingerprint text,concept_key text,definition_digest text,entity_context_digest text,effective_entities_digest text,result_digest text)
    JOIN signal_hybrid_membership_decisions h ON h.workspace_id=$1 AND h.route_digest=$3 AND h.root_fingerprint=r.root_fingerprint
      AND h.concept_key=r.concept_key AND h.definition_digest=r.definition_digest AND h.entity_context_digest=r.entity_context_digest
      AND h.effective_entities_digest=r.effective_entities_digest AND h.result_digest=r.result_digest`,
      [args.workspace_id, JSON.stringify(rows), args.route_digest])).rows[0]!.count;
  if (persisted !== rows.length) fail("hybrid_replay_conflict");
  return { persisted };
}

/** Reproject one settled Claude answer after verifying its immutable raw receipt outside the transaction.
 * Only a model error caused by the old rationale-length parser can be replaced. */
export type HybridClaudeReparseArgsV1 = { database: LabelingDatabaseV1; workspace_id: string;
  route_digest: string; run_id: string; call_id: string; raw_sha256: string;
  usage: unknown; settled_micro_usd: number; corrected: HybridDecisionInputV1 };
export async function reconcileHybridClaudeParseOnClientV1(client: PoolClient,
  args: Omit<HybridClaudeReparseArgsV1,"database">) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
    [args.workspace_id]);
  const route=(await client.query<{route_digest:string}>(
    "SELECT route_digest FROM signal_hybrid_membership_routes WHERE workspace_id=$1 FOR UPDATE",
    [args.workspace_id])).rows[0];
  const run=(await client.query<{id:string}>(`SELECT id FROM signal_labeling_runs WHERE id=$1 AND workspace_id=$2
    AND kind='membership' AND status='completed' AND lease_token IS NULL
    AND membership_snapshot->>'hybrid_stage'='claude'
    AND membership_snapshot->>'route_digest'=$3 FOR UPDATE`,
    [args.run_id,args.workspace_id,args.route_digest])).rows[0];
  if(!run||route?.route_digest!==args.route_digest)
    return fail("hybrid_claude_reparse_route_or_run_changed");
  const call=(await client.query<{inputs:MembershipInputV1[];results:Omit<HybridDecisionInputV1,"text">[]}>(`
    SELECT inputs,results FROM signal_labeling_calls WHERE id=$1 AND run_id=$2 AND workspace_id=$3
      AND provider='anthropic' AND model='claude-sonnet-5-5' AND status='settled'
      AND results_applied AND raw_storage_key IS NOT NULL AND raw_sha256=$4
      AND raw_size_bytes IS NOT NULL AND usage=$5::jsonb AND settled_micro_usd=$6 FOR UPDATE`,
    [args.call_id,run.id,args.workspace_id,args.raw_sha256,JSON.stringify(args.usage),
      args.settled_micro_usd])).rows[0];
  if(!call||call.inputs.length!==1||call.results.length!==1)
    return fail("hybrid_claude_reparse_pair_invalid");
  const input=call.inputs[0],old=call.results[0],corrected=args.corrected;
  if(!input||!old||input.evaluated_concepts.length!==1)
    return fail("hybrid_claude_reparse_pair_invalid");
  const concept=input.evaluated_concepts[0]!;
  if(old.claude?.verdict!=="error"||
    corrected.claude?.verdict==="error"||corrected.claude?.verdict==="refused"||
    corrected.claude_call_id!==args.call_id||corrected.jev_call_id!==old.jev_call_id||
    corrected.text!==input.text||corrected.root_id!==input.root_id||
    corrected.root_fingerprint!==input.root_fingerprint||
    corrected.concept_key!==concept.concept_key||
    corrected.definition_digest!==concept.definition_digest||
    corrected.entity_context_digest!==input.entity_context_digest||
    corrected.effective_entities_digest!==input.effective_entities_digest||
    old.root_id!==corrected.root_id||old.root_fingerprint!==corrected.root_fingerprint||
    old.concept_key!==corrected.concept_key||old.definition_digest!==corrected.definition_digest||
    old.entity_context_digest!==corrected.entity_context_digest||
    old.effective_entities_digest!==corrected.effective_entities_digest||
    old.claude_call_id!==args.call_id||
    signalWorkspaceEmbeddingDigestV1(old.jev)!==signalWorkspaceEmbeddingDigestV1(corrected.jev)||
    corrected.rationale!==old.rationale) return fail("hybrid_claude_reparse_pair_invalid");
  const prior=hybridDecisionRecordV1({...old,text:input.text});
  const next=hybridDecisionRecordV1(corrected);
  if(prior.verdict!=="error"||!["belongs","review_required"].includes(next.verdict))
    fail("hybrid_claude_reparse_verdict_invalid");
  const current=(await client.query<{verdict:string;source:string;requires_override_review:boolean}>(`
    SELECT current.verdict,current.source,current.requires_override_review
    FROM signal_concept_memberships_current_v1 current
    JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=current.workspace_id
      AND rights.root_id=current.root_id AND rights.metrics AND rights.evidence
    WHERE current.workspace_id=$1 AND current.root_id=$2::uuid AND current.root_fingerprint=$3
      AND current.concept_key=$4 AND current.definition_digest=$5
      AND current.entity_context_digest=$6 AND current.effective_entities_digest=$7
      AND current.labeler_digest=$8`,[args.workspace_id,corrected.root_id,corrected.root_fingerprint,
    corrected.concept_key,corrected.definition_digest,corrected.entity_context_digest,
    corrected.effective_entities_digest,args.route_digest])).rows[0];
  if(current?.source!=="model"||current.verdict!=="error"||current.requires_override_review)
    fail("hybrid_claude_reparse_authority_changed");
  const served=(await client.query<{result_digest:string;jev:HybridJevDecisionV1;claude:HybridClaudeDecisionV1}>(`
    SELECT result_digest,jev,claude FROM signal_hybrid_membership_decisions
    WHERE workspace_id=$1 AND root_id=$2::uuid AND root_fingerprint=$3 AND concept_key=$4
      AND definition_digest=$5 AND entity_context_digest=$6 AND effective_entities_digest=$7
      AND route_digest=$8 AND jev_call_id=$9 AND claude_call_id=$10 AND verdict='error' FOR UPDATE`,
    [args.workspace_id,corrected.root_id,corrected.root_fingerprint,corrected.concept_key,
      corrected.definition_digest,corrected.entity_context_digest,corrected.effective_entities_digest,
      args.route_digest,corrected.jev_call_id,args.call_id])).rows[0];
  if(!served||signalWorkspaceEmbeddingDigestV1(served.jev)!==signalWorkspaceEmbeddingDigestV1(old.jev)||
    signalWorkspaceEmbeddingDigestV1(served.claude)!==signalWorkspaceEmbeddingDigestV1(old.claude))
    return fail("hybrid_claude_reparse_served_changed");
  const updatedResult={...old,claude:corrected.claude};
  const callUpdate=await client.query(`UPDATE signal_labeling_calls SET results=$3::jsonb,
    raw_storage_verified_at=now(),raw_storage_verified_key=raw_storage_key,
    stop_reason='hybrid_claude_rationale_reparsed',updated_at=now()
    WHERE id=$1 AND run_id=$2 AND results=$4::jsonb AND status='settled' AND results_applied`,
    [args.call_id,run.id,JSON.stringify([updatedResult]),JSON.stringify(call.results)]);
  if(callUpdate.rowCount!==1) fail("hybrid_claude_reparse_call_conflict");
  const decisionUpdate=await client.query(`UPDATE signal_hybrid_membership_decisions SET
    result_digest=$3,verdict=$4,claude=$5::jsonb,citation=$6::jsonb
    WHERE workspace_id=$1 AND claude_call_id=$2 AND result_digest=$7 AND verdict='error'`,
    [args.workspace_id,args.call_id,next.result_digest,next.verdict,
      JSON.stringify(next.claude),JSON.stringify(next.citation),served.result_digest]);
  if(decisionUpdate.rowCount!==1) fail("hybrid_claude_reparse_decision_conflict");
  return {reparsed:true,verdict:next.verdict};
}
export async function reconcileHybridClaudeParseV1(args: HybridClaudeReparseArgsV1) {
  const client=await args.database.connect();
  try {
    await client.query("BEGIN");
    const result=await reconcileHybridClaudeParseOnClientV1(client,args);
    await client.query("COMMIT");
    return result;
  } catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
