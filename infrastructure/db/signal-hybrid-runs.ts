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
      FROM signal_labeling_calls call CROSS JOIN LATERAL jsonb_array_elements(call.results) result
      JOIN signal_concept_memberships_current_v1 current ON current.workspace_id=$3
        AND current.root_id=(result->>'root_id')::uuid AND current.root_fingerprint=result->>'root_fingerprint'
        AND current.concept_key=result->>'concept_key'
        AND current.definition_digest=result->>'definition_digest'
        AND current.entity_context_digest=result->>'entity_context_digest'
        AND current.effective_entities_digest=result->>'effective_entities_digest'
        AND current.labeler_digest=$4 AND current.verdict='pending'
      JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=current.workspace_id
        AND rights.root_id=current.root_id AND rights.metrics AND rights.evidence
      WHERE call.run_id=$1 AND call.status='settled' AND call.results_applied
        AND result#>>'{jev,verdict}'='belongs'
        AND ($2::uuid IS NULL OR (result->>'root_id')::uuid>$2::uuid)
    ), selected_roots AS (
      SELECT DISTINCT root_id FROM candidates ORDER BY root_id LIMIT 200
    ) SELECT candidate.input,candidate.result,candidate.jev_call_id FROM candidates candidate
      JOIN selected_roots selected ON selected.root_id=candidate.root_id
    ORDER BY candidate.root_id,candidate.result->>'concept_key'`,
    [prior,run.cursor_root_id,run.workspace_id,snapshot(run).route_digest])).rows;
  const grouped = new Map<string,HybridStageInputV1>();
  for (const row of rows) {
    const concept = snapshot(run).concepts.find(item => item.concept_key === row.result.concept_key &&
      item.definition_digest === row.result.definition_digest);
    if (!concept || row.result.jev.verdict !== "belongs") return fail("hybrid_jev_result_invalid");
    const input = grouped.get(row.input.root_id) ?? { ...row.input,evaluated_concepts:[],jev_by_concept:{} };
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
