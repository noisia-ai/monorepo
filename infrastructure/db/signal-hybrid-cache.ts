import type {PoolClient} from 'pg';
import {labelerDigestV1,hybridCitationJudgeIdentityV1,hybridCitationVerifierIdentityV1,
 rethresholdHybridJevV1,type HybridJevDecisionV1,type MembershipInputV1} from '@noisia/query-engine';
import type {LabelingRunV1} from './signal-labeling-runs';
import {writeHybridMembershipDecisionPageV1,type HybridDecisionInputV1} from './signal-hybrid-membership';
import {hybridCompatibleJevRunSqlV1} from './signal-hybrid-semantic-cache-sql';
import {hybridUncertainPairSqlV1} from './signal-hybrid-admission-population';

const claude=hybridCitationJudgeIdentityV1(),verifier=hybridCitationVerifierIdentityV1();

/** Select the latest immutable probability on exact current pair provenance; no new ledger row. */
export const hybridCachedJevPairsSqlV1=`WITH current_pairs AS MATERIALIZED (
 SELECT * FROM signal_concept_memberships_current_v1 current WHERE workspace_id=$1 AND labeler_digest=$2 AND verdict='pending'
  AND root_id=ANY($3::uuid[]) AND ${hybridUncertainPairSqlV1}
), rights AS MATERIALIZED(SELECT root_id FROM signal_membership_evidence_rights_v1 WHERE workspace_id=$1 AND metrics AND evidence)
SELECT DISTINCT ON(current.root_id,current.concept_key) current.root_id::text, current.concept_key,
 input, result,call.id jev_call_id,run.membership_snapshot->>'route_digest' source_route_digest,
 CASE WHEN length(input->>'text')<=12000 AND confirmation_version.prompt_digest='${claude.prompt_digest}'
   AND confirmation_version.schema_digest='${claude.schema_digest}' AND confirmation_version.identity#>>'{params,effort}'='low'
   AND confirmation.status='settled' AND confirmation.results_applied
   AND (old.citation_call_id IS NULL OR verification_version.labeler_digest='${labelerDigestV1(verifier)}'
     AND verification.status='settled' AND verification.results_applied)
   THEN to_jsonb(old) END semantic_decision
FROM current_pairs current JOIN rights ON rights.root_id=current.root_id
JOIN signal_labeling_calls call ON call.workspace_id=$1 AND call.status='settled' AND call.results_applied
JOIN signal_labeling_runs run ON run.id=call.run_id AND run.membership_snapshot->>'hybrid_stage'='jev'
  AND (run.membership_snapshot->>'route_digest'=$2 OR ${hybridCompatibleJevRunSqlV1('run')})
CROSS JOIN LATERAL jsonb_array_elements(call.results) result
JOIN LATERAL jsonb_array_elements(call.inputs) input ON input->>'root_id'=result->>'root_id'
LEFT JOIN signal_hybrid_membership_decisions old ON old.workspace_id=$1 AND old.route_digest=run.membership_snapshot->>'route_digest'
 AND old.root_id=current.root_id AND old.root_fingerprint=current.root_fingerprint AND old.concept_key=current.concept_key
 AND old.definition_digest=current.definition_digest AND old.entity_context_digest=current.entity_context_digest
 AND old.effective_entities_digest=current.effective_entities_digest AND old.jev_call_id=call.id
 AND old.verdict IN('belongs','not_belongs','review_required','refused')
LEFT JOIN signal_labeling_calls confirmation ON confirmation.id=old.claude_call_id
LEFT JOIN signal_labeling_runs confirmation_run ON confirmation_run.id=confirmation.run_id
LEFT JOIN signal_labeler_versions confirmation_version ON confirmation_version.id=confirmation_run.labeler_version_id
LEFT JOIN signal_labeling_calls verification ON verification.id=old.citation_call_id
LEFT JOIN signal_labeling_runs verification_run ON verification_run.id=verification.run_id
LEFT JOIN signal_labeler_versions verification_version ON verification_version.id=verification_run.labeler_version_id
WHERE result->>'root_id'=current.root_id::text AND result->>'root_fingerprint'=current.root_fingerprint
 AND result->>'concept_key'=current.concept_key AND result->>'definition_digest'=current.definition_digest
 AND result->>'entity_context_digest'=current.entity_context_digest AND result->>'effective_entities_digest'=current.effective_entities_digest
 AND result#>>'{jev,verdict}' IN('belongs','not_belongs') AND result#>>'{jev,probability}' IS NOT NULL
 AND call.raw_storage_key IS NOT NULL AND call.raw_sha256 IS NOT NULL AND call.raw_size_bytes IS NOT NULL
ORDER BY current.root_id,current.concept_key,call.created_at DESC,call.id`;

export async function reuseHybridCachedJevV1(client:PoolClient,run:LabelingRunV1,inputs:MembershipInputV1[]){
 const route=(run as LabelingRunV1&{membership_snapshot:{route_digest:string}}).membership_snapshot.route_digest;
 const cached=(await client.query<{input:MembershipInputV1;result:HybridDecisionInputV1;source_route_digest:string;semantic_decision:HybridDecisionInputV1|null}>(hybridCachedJevPairsSqlV1,[run.workspace_id,route,inputs.map(i=>i.root_id)])).rows;
 const bySource=new Map<string,HybridDecisionInputV1[]>(),covered=new Set<string>();
 for(const row of cached){
  const jev=rethresholdHybridJevV1(row.result.jev as HybridJevDecisionV1);
  const decision=row.semantic_decision;
  if(jev.verdict==='not_belongs'||decision){
   const result:HybridDecisionInputV1={...(decision??row.result),text:row.input.text,jev,
    claude:jev.verdict==='not_belongs'?null:decision!.claude,claude_call_id:jev.verdict==='not_belongs'?null:decision!.claude_call_id,
    ...(jev.verdict==='not_belongs'?{citation_call_id:null,rationale:null}: {})};
   bySource.set(row.source_route_digest,[...(bySource.get(row.source_route_digest)??[]),result]);
  }
  covered.add(`${row.input.root_id}:${row.result.concept_key}`);
 }
 for(const [source,decisions] of bySource)for(let offset=0;offset<decisions.length;offset+=200)
  await writeHybridMembershipDecisionPageV1({client,workspace_id:run.workspace_id,route_digest:route,
   cached_route_digest:source,decisions:decisions.slice(offset,offset+200)});
 return inputs.map(input=>({...input,evaluated_concepts:input.evaluated_concepts.filter(c=>!covered.has(`${input.root_id}:${c.concept_key}`))})).filter(input=>input.evaluated_concepts.length);
}
