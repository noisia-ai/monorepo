import type { PoolClient } from 'pg';
import { hybridCitationJudgeIdentityV1 } from '@noisia/query-engine';
import type { LabelingDatabaseV1 } from './signal-mention-facets';
import type { LabelingRunV1 } from './signal-labeling-runs';
import { requestHybridMembershipStageV1, type HybridMembershipStageV1 } from './signal-hybrid-membership';
import type { HybridStageInputV1, HybridStageResultV1 } from './signal-hybrid-runs';
import {hybridPairRetrySqlV1,hybridUncertainPairSqlV1} from './signal-hybrid-admission-population';

/** Previous receipt is the immutable input to verification or to the single citation repair. */
export async function selectHybridCitationInputsV1(client:LabelingDatabaseV1|PoolClient,run:LabelingRunV1):Promise<HybridStageInputV1[]> {
 const s=(run as LabelingRunV1&{membership_snapshot:{source_run_id:string;hybrid_stage:HybridMembershipStageV1;citation_retry:boolean;route_digest:string}}).membership_snapshot;
 const rows=(await client.query<{input:HybridStageInputV1;result:HybridStageResultV1}>(`WITH current_pairs AS MATERIALIZED (
   SELECT * FROM signal_concept_memberships_current_v1 current WHERE workspace_id=$2 AND labeler_digest=$3
     AND verdict IN('pending','error') AND ${hybridPairRetrySqlV1(s.hybrid_stage)} AND ${hybridUncertainPairSqlV1}
 ), rights AS MATERIALIZED (SELECT root_id FROM signal_membership_evidence_rights_v1 WHERE workspace_id=$2 AND metrics AND evidence)
 SELECT DISTINCT ON(p.root_id,p.concept_key) input,result FROM signal_labeling_calls call
 CROSS JOIN LATERAL jsonb_array_elements(call.results) result
 JOIN LATERAL jsonb_array_elements(call.inputs) input ON input->>'root_id'=result->>'root_id'
 JOIN current_pairs p ON p.root_id::text=result->>'root_id' AND p.root_fingerprint=result->>'root_fingerprint'
   AND p.concept_key=result->>'concept_key' AND p.definition_digest=result->>'definition_digest'
   AND p.entity_context_digest=result->>'entity_context_digest' AND p.effective_entities_digest=result->>'effective_entities_digest'
 JOIN rights ON rights.root_id=p.root_id
 WHERE call.run_id=$1 AND call.status='settled' AND call.results_applied
   AND result#>>'{claude,verdict}'='belongs'
   AND (NOT result ? 'citation_window' OR (SELECT count(DISTINCT item#>>'{citation_window,index}')
    FROM signal_labeling_calls covered CROSS JOIN LATERAL jsonb_array_elements(covered.results) item
    WHERE covered.run_id=call.run_id AND covered.status='settled' AND covered.results_applied
     AND item->>'root_id'=result->>'root_id' AND item->>'concept_key'=result->>'concept_key'
     AND item#>>'{claude,verdict}' IN('belongs','not_belongs','insufficient'))=(result#>>'{citation_window,count}')::int)
   AND ($4::boolean=false OR result#>>'{claude,verification,supported}'='false')
   AND ($5::uuid IS NULL OR p.root_id>$5::uuid)
 ORDER BY p.root_id,p.concept_key,call.created_at,call.id`,[s.source_run_id,run.workspace_id,s.route_digest,s.hybrid_stage==='claude',run.cursor_root_id])).rows;
 const grouped=new Map<string,HybridStageInputV1>();
 for(const row of rows){
  const concept=row.input.evaluated_concepts.find(c=>c.concept_key===row.result.concept_key&&c.definition_digest===row.result.definition_digest);
  if(!concept)throw new Error('hybrid_citation_source_invalid');
  const input=grouped.get(row.input.root_id)??{...row.input,evaluated_concepts:[],jev_by_concept:{},confirmation_by_concept:{}};
  if(input.confirmation_by_concept?.[concept.concept_key])throw new Error('hybrid_duplicate_confirmation');
  input.evaluated_concepts.push(concept);input.confirmation_by_concept??={};input.confirmation_by_concept[concept.concept_key]=row.result;
  input.jev_by_concept??={};input.jev_by_concept[concept.concept_key]={decision:row.result.jev,call_id:row.result.jev_call_id};
  if(s.hybrid_stage==='claude')input.citation_repair={reason:'The previous fragments did not independently support all necessary conditions. Reassess and select better decisive fragments.',previous_fragments:Object.values(input.confirmation_by_concept).flatMap(r=>r.claude?.citations??[])};
  grouped.set(input.root_id,input);
 }
 return [...grouped.values()].slice(0,200);
}

/** One idempotent successor per terminal source, under the existing governed admission. */
export async function requestHybridCitationFollowupV1(database:LabelingDatabaseV1,runId:string) {
 const run=(await database.query<LabelingRunV1&{membership_snapshot:{hybrid_stage:HybridMembershipStageV1;route_digest:string;citation_retry?:boolean}}>(`SELECT run.*,version.identity FROM signal_labeling_runs run
 JOIN signal_labeler_versions version ON version.id=run.labeler_version_id WHERE run.id=$1`,[runId])).rows[0];
 if(!run||!['completed','failed'].includes(run.status))return null;
 const s=run.membership_snapshot;
 if(!s||s.hybrid_stage==='jev'||s.hybrid_stage==='citation'&&s.citation_retry)return null;
 if(s.hybrid_stage==='claude'&&run.identity.prompt_digest!==hybridCitationJudgeIdentityV1().prompt_digest)return null;
 const candidates=(await database.query<{count:number}>(`SELECT count(*)::int count FROM signal_labeling_calls call
 CROSS JOIN LATERAL jsonb_array_elements(call.results) r WHERE call.run_id=$1 AND call.status='settled' AND call.results_applied
 AND r#>>'{claude,verdict}'='belongs' AND ($2::boolean=false OR r#>>'{claude,verification,supported}'='false')`,[runId,s.hybrid_stage==='citation'])).rows[0]!.count;
 if(!candidates)return null;
 const stage:HybridMembershipStageV1=s.hybrid_stage==='claude'?'citation':'claude';
 const receipt=await requestHybridMembershipStageV1({database,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id,
   stage,route_digest:s.route_digest,citation_retry:s.hybrid_stage==='citation'||s.citation_retry===true,
   source_run_id:run.id,idempotency_key:`h1-citation-${run.id}`,provider_available:true});
 return {run_id:receipt.run_id,stage};
}
