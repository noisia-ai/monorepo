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
