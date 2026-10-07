import type { PoolClient } from "pg";
import { conceptSetDigestV1, type ConceptForJudgeV1, type HybridClaudeDecisionV1,
  type HybridJevDecisionV1, type MembershipInputV1 } from "@noisia/query-engine";
import { loadMembershipConceptsV1, selectMembershipInputsV1 } from "./signal-concept-memberships";
import { createSignalLabelingStoreV1, SignalLabelingError, type LabelingRunV1 } from "./signal-labeling-runs";
import { writeHybridMembershipDecisionPageV1, type HybridMembershipStageV1 } from "./signal-hybrid-membership";
import type { LabelingDatabaseV1 } from "./signal-mention-facets";

type Snapshot = { hybrid_stage: HybridMembershipStageV1; route_digest: string; jev_run_id: string | null;
  concepts: ConceptForJudgeV1[] };
export type HybridStageInputV1 = MembershipInputV1 & {
  jev_by_concept?: Record<string,{ decision: HybridJevDecisionV1; call_id: string }>;
};
export type HybridStageResultV1 = {
  root_id: string; root_fingerprint: string; concept_key: string; definition_digest: string;
  entity_context_digest: string; effective_entities_digest: string;
  jev: HybridJevDecisionV1; jev_call_id: string;
  claude: HybridClaudeDecisionV1 | null; claude_call_id: string | null;
  rationale: string | null;
};

/** Reconcile a paid, durable JEV reply for a pair that was already served.
 * The prior decision remains authoritative; only the duplicate call ledger is repaired. */
export type HybridDuplicateReceiptArgsV1 = {
  database: LabelingDatabaseV1; workspace_id: string; idempotency_key: string;
  call_id: string; raw_sha256: string; usage: unknown; settled_micro_usd: number;
  result: HybridStageResultV1;
};
export async function reconcileHybridDuplicateJevReceiptOnClientV1(client: PoolClient,
  args: Omit<HybridDuplicateReceiptArgsV1,"database">) {
    // Serialize with route selection and human overrides before reading the current view.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
      [args.workspace_id]);
    const run=(await client.query<{id:string;route_digest:string}>(`SELECT id,
      membership_snapshot->>'route_digest' route_digest FROM signal_labeling_runs
      WHERE workspace_id=$1 AND idempotency_key=$2 AND kind='membership' AND status='failed'
        AND error_code='hybrid_raw_receipt_needs_review'
        AND membership_snapshot->>'hybrid_stage'='jev' AND lease_token IS NULL FOR UPDATE`,
      [args.workspace_id,args.idempotency_key])).rows[0];
    if(!run) throw new SignalLabelingError("hybrid_duplicate_run_invalid");
    const call=(await client.query<{id:string;inputs:HybridStageInputV1[];settled_micro_usd:string}>(`
      SELECT id,inputs,settled_micro_usd::text FROM signal_labeling_calls
      WHERE run_id=$1 AND workspace_id=$2 AND id=$3 AND status='failed'
        AND raw_storage_key IS NOT NULL AND raw_sha256=$4 AND raw_size_bytes IS NOT NULL
        AND NOT results_applied AND results IS NULL AND usage=$5::jsonb
        AND settled_micro_usd=$6 FOR UPDATE`,[run.id,args.workspace_id,args.call_id,
      args.raw_sha256,JSON.stringify(args.usage),args.settled_micro_usd])).rows[0];
    const input=call?.inputs[0],concept=input?.evaluated_concepts[0],result=args.result;
    if(!call||call.inputs.length!==1||input?.evaluated_concepts.length!==1||
      result.jev_call_id!==call.id||result.claude_call_id!==null||result.claude!==null||
      result.jev.verdict!=="not_belongs"||result.root_id!==input.root_id||
      result.root_fingerprint!==input.root_fingerprint||result.concept_key!==concept?.concept_key||
      result.definition_digest!==concept.definition_digest||
      result.entity_context_digest!==input.entity_context_digest||
      result.effective_entities_digest!==input.effective_entities_digest)
      throw new SignalLabelingError("hybrid_duplicate_receipt_invalid");
    const others=(await client.query<{invalid:number}>(`SELECT count(*) FILTER(WHERE
      status<>'failed' OR raw_storage_key IS NOT NULL OR results_applied)::int invalid
      FROM signal_labeling_calls WHERE run_id=$1 AND id<>$2`,[run.id,call.id])).rows[0]!.invalid;
    if(others) fail("hybrid_duplicate_run_calls_changed");
    const served=(await client.query<{count:number}>(`SELECT count(*)::int count
      FROM signal_hybrid_membership_decisions h
      JOIN signal_labeling_calls prior ON prior.id=h.jev_call_id AND prior.workspace_id=h.workspace_id
        AND prior.status='settled' AND prior.results_applied AND prior.raw_storage_key IS NOT NULL
        AND prior.raw_sha256 IS NOT NULL AND prior.raw_size_bytes IS NOT NULL
      JOIN signal_labeling_runs prior_run ON prior_run.id=prior.run_id
        AND prior_run.workspace_id=h.workspace_id AND prior_run.kind='membership'
        AND prior_run.membership_snapshot->>'hybrid_stage'='jev'
        AND prior_run.membership_snapshot->>'route_digest'=h.route_digest
      JOIN signal_concept_memberships_current_v1 current ON current.workspace_id=h.workspace_id
        AND current.root_id=h.root_id AND current.root_fingerprint=h.root_fingerprint
        AND current.concept_key=h.concept_key AND current.definition_digest=h.definition_digest
        AND current.entity_context_digest=h.entity_context_digest
        AND current.effective_entities_digest=h.effective_entities_digest
        AND current.labeler_digest=h.route_digest AND current.source='model'
        AND current.verdict=h.verdict AND NOT current.requires_override_review
      JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=h.workspace_id
        AND rights.root_id=h.root_id AND rights.metrics AND rights.evidence
      WHERE h.workspace_id=$1 AND h.route_digest=$2 AND h.root_id=$3::uuid
        AND h.root_fingerprint=$4 AND h.concept_key=$5 AND h.definition_digest=$6
        AND h.entity_context_digest=$7 AND h.effective_entities_digest=$8
        AND h.verdict='not_belongs' AND h.jev->>'verdict'='not_belongs'
        AND h.jev_call_id<>$9::uuid`,[args.workspace_id,run.route_digest,result.root_id,
      result.root_fingerprint,result.concept_key,result.definition_digest,
      result.entity_context_digest,result.effective_entities_digest,call.id])).rows[0]!.count;
    if(served!==1) fail("hybrid_duplicate_prior_receipt_missing");
    const changed=await client.query(`UPDATE signal_labeling_calls SET status='settled',
      results_applied=true,results=$3::jsonb,raw_storage_verified_at=now(),
      raw_storage_verified_key=raw_storage_key,updated_at=now()
      WHERE run_id=$1 AND id=$2 AND status='failed' AND NOT results_applied`,
      [run.id,call.id,JSON.stringify([result])]);
    if(changed.rowCount!==1) fail("hybrid_duplicate_receipt_conflict");
    await client.query(`UPDATE signal_labeling_runs SET error_code='hybrid_duplicate_receipt_reconciled',
      updated_at=now() WHERE id=$1`,[run.id]);
    return {reconciled:true,settled_micro_usd:args.settled_micro_usd};
}
export async function reconcileHybridDuplicateJevReceiptV1(args: HybridDuplicateReceiptArgsV1) {
  const client=await args.database.connect();
  try {
    await client.query("BEGIN");
    const result=await reconcileHybridDuplicateJevReceiptOnClientV1(client,args);
    await client.query("COMMIT");
    return result;
  } catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
const fail = (code: string): never => { throw new SignalLabelingError(code); };
function snapshot(run: LabelingRunV1): Snapshot {
  const value = (run as LabelingRunV1 & {membership_snapshot?:Snapshot}).membership_snapshot;
  if (!value || !["jev","claude"].includes(value.hybrid_stage) || !value.route_digest || !value.concepts)
    return fail("hybrid_snapshot_invalid");
  return value;
}
/** Recheck evidence and external processing on one current provenance before dispatch. */
export async function assertHybridProviderRightsBeforeSubmitV1(client: PoolClient, run: LabelingRunV1,
  calls: {id:string}[]) {
  if (!calls.length) return;
  const counts = (await client.query<{found:number;allowed:number;one_input:boolean|null}>(`
    SELECT count(*)::int found,count(*) FILTER(WHERE provider.allowed IS NOT NULL)::int allowed,
      bool_and(jsonb_array_length(call.inputs)=1) one_input
    FROM signal_labeling_calls call
    LEFT JOIN LATERAL jsonb_array_elements(call.inputs) input ON true
    LEFT JOIN LATERAL (
      SELECT 1 allowed FROM signal_mention_import_memberships path
      JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=path.workspace_id
        AND batch.data_source_id=path.data_source_id AND batch.status='completed'
      JOIN data_sources source ON source.id=path.data_source_id AND source.workspace_id=path.workspace_id
        AND source.status='active'
      JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=path.workspace_id
      JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=path.workspace_id AND candidate.data_source_id=path.data_source_id
          AND candidate.status='active' AND candidate.effective_from<=now()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
          AND (candidate.import_batch_id=path.import_batch_id OR candidate.import_batch_id IS NULL)
        ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
      JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id
        AND license.workspace_id=path.workspace_id AND license.status='active'
        AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.workspace_id=path.workspace_id AND retention.status='active'
        AND retention.retention_state='allowed' AND retention.effective_from<=now()
        AND (retention.effective_to IS NULL OR retention.effective_to>now())
        AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
      WHERE path.workspace_id=call.workspace_id AND origin.canonical_mention_id::text=input->>'root_id'
        AND NOT EXISTS (SELECT 1 FROM (VALUES ('llm-processing'),('client-derived-metrics'),
          ('client-mention-list'),('client-text-or-excerpt')) required(purpose) WHERE NOT EXISTS (
          SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=path.workspace_id
            AND usage.licensing_policy_id=license.id AND usage.usage_purpose=required.purpose
            AND usage.decision='allowed'))
      LIMIT 1
    ) provider ON true
    WHERE call.run_id=$1 AND call.workspace_id=$2 AND call.id=ANY($3::uuid[])`,
    [run.id,run.workspace_id,calls.map(call=>call.id)])).rows[0]!;
  if (counts.found!==calls.length || counts.allowed!==calls.length || !counts.one_input)
    fail("hybrid_provider_rights_changed");
}
export async function selectHybridClaudeInputsV1(client: LabelingDatabaseV1 | PoolClient, run: LabelingRunV1): Promise<HybridStageInputV1[]> {
  const prior = snapshot(run).jev_run_id;
  if (!prior) return fail("hybrid_jev_run_missing");
  const rows = (await client.query<{input:MembershipInputV1;result:HybridStageResultV1;jev_call_id:string}>(`
    WITH candidates AS MATERIALIZED (
      SELECT call.id jev_call_id,call.inputs->0 input,result,
        (result->>'root_id')::uuid root_id
      FROM signal_labeling_calls call JOIN signal_labeling_runs prior ON prior.id=call.run_id
      CROSS JOIN LATERAL jsonb_array_elements(call.results) result
      JOIN signal_concept_memberships_current_v1 current ON current.workspace_id=$2
        AND current.root_id=(result->>'root_id')::uuid AND current.root_fingerprint=result->>'root_fingerprint'
        AND current.concept_key=result->>'concept_key'
        AND current.definition_digest=result->>'definition_digest'
        AND current.entity_context_digest=result->>'entity_context_digest'
        AND current.effective_entities_digest=result->>'effective_entities_digest'
        AND current.labeler_digest=$3 AND current.verdict='pending'
      JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=current.workspace_id
        AND rights.root_id=current.root_id AND rights.metrics AND rights.evidence
      WHERE prior.workspace_id=$2 AND prior.kind='membership' AND prior.status IN('completed','failed')
        AND prior.membership_snapshot->>'hybrid_stage'='jev'
        AND prior.membership_snapshot->>'route_digest'=$3
        AND call.status='settled' AND call.results_applied
        AND result#>>'{jev,verdict}'='belongs'
        AND ($1::uuid IS NULL OR (result->>'root_id')::uuid>$1::uuid)
    ), selected_roots AS (
      SELECT DISTINCT root_id FROM candidates ORDER BY root_id LIMIT 200
    ) SELECT candidate.input,candidate.result,candidate.jev_call_id FROM candidates candidate
      JOIN selected_roots selected ON selected.root_id=candidate.root_id
    ORDER BY candidate.root_id,candidate.result->>'concept_key'`,
    [run.cursor_root_id,run.workspace_id,snapshot(run).route_digest])).rows;
  const grouped = new Map<string,HybridStageInputV1>();
  for (const row of rows) {
    const concept = snapshot(run).concepts.find(item => item.concept_key === row.result.concept_key &&
      item.definition_digest === row.result.definition_digest);
    if (!concept || row.result.jev.verdict !== "belongs") return fail("hybrid_jev_result_invalid");
    const input = grouped.get(row.input.root_id) ?? { ...row.input,evaluated_concepts:[],jev_by_concept:{} };
    if (input.jev_by_concept?.[concept.concept_key]) return fail("hybrid_duplicate_jev_result");
    input.evaluated_concepts.push(concept);
    // Claude calls are one concept at a time; the value is read in the provider proposal.
    input.jev_by_concept ??= {};
    input.jev_by_concept[concept.concept_key] = { decision:row.result.jev,call_id:row.jev_call_id };
    grouped.set(row.input.root_id,input);
  }
  return [...grouped.values()];
}

/** Both stages use the common lease/admission/reserve/raw/settle/apply store. */
export function createHybridMembershipStageStoreV1(stage: HybridMembershipStageV1,
  options: Omit<Parameters<typeof createSignalLabelingStoreV1>[0],"adapter">) {
  const inputs = async (client: LabelingDatabaseV1 | PoolClient, run: LabelingRunV1): Promise<HybridStageInputV1[]> => {
    if (snapshot(run).hybrid_stage !== stage) return fail("hybrid_stage_changed");
    return stage === "jev" ? selectMembershipInputsV1(client,run,true) : selectHybridClaudeInputsV1(client,run);
  };
  return createSignalLabelingStoreV1<HybridStageInputV1,HybridStageResultV1>({ ...options,
    adapter: { kind:"membership",hybrid_stage:stage,
      policy_action:stage === "jev" ? "concept_membership_jev" : "concept_membership_claude",
      transport:"sync",persist_results_before_write:true,inputs,
      authority:async (client,run) => {
        const s = snapshot(run);
        const route = (await client.query<{route_digest:string}>(
          "SELECT route_digest FROM signal_hybrid_membership_routes WHERE workspace_id=$1",[run.workspace_id])).rows[0];
        if (route?.route_digest !== s.route_digest || s.hybrid_stage !== stage) return fail("hybrid_route_changed");
        if (conceptSetDigestV1(await loadMembershipConceptsV1(client,run.workspace_id)) !== conceptSetDigestV1(s.concepts))
          return fail("hybrid_concepts_changed");
      },
      beforeSubmit:assertHybridProviderRightsBeforeSubmitV1,
      pending:async (client,run) => (await inputs(client,run)).length,
      write:async (client,run,pages) => {
        const decisions = pages.flatMap(page => page.results
          .filter(result => stage === "claude" || result.jev.verdict !== "belongs")
          .map(result => {
            if (stage === "jev" ? result.jev_call_id !== page.call.id || result.claude_call_id !== null
              : result.claude_call_id !== page.call.id) return fail("hybrid_result_call_changed");
            const input = page.call.inputs.find(item => item.root_id === result.root_id);
            if (!input || !input.evaluated_concepts.some(concept => concept.concept_key === result.concept_key &&
              concept.definition_digest === result.definition_digest)) return fail("hybrid_result_input_changed");
            return { ...result,text:input.text };
          }));
        if (decisions.length) await writeHybridMembershipDecisionPageV1({client,workspace_id:run.workspace_id,
          route_digest:snapshot(run).route_digest,decisions});
      },
    },
  });
}
