import {createHash} from 'node:crypto';
import {conceptSetDigestV1,parseAnthropicResponseV1,parseMembershipGroupWithRationaleNormalizationV1,type MembershipInputV1,type MembershipResultV1} from '@noisia/query-engine';
import {loadMembershipConceptsV1,writeConceptMembershipResultsV1,type MembershipRunV1} from './signal-concept-memberships';
import {inspectFacetContextChangeV1,type LabelingDatabaseV1} from './signal-mention-facets';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {signalWorkspaceFeatureEnabledV1} from './signal-workspace-features';
import type {LabelingCallV1} from './signal-labeling-runs';
type StoredCall=LabelingCallV1<MembershipInputV1>&{results:MembershipResultV1[];raw_storage_key:string;raw_size_bytes:string;raw_sha256:string;settled_micro_usd:string};
/** Terminal V1 receipts only. No provider, admission, reservation or settlement capability. */
export async function replayStoredMembershipResultsV1(args:{
 database:LabelingDatabaseV1;workspace_id:string;actor_user_id:string;run_id:string;
 loadRaw:(receipt:{workspace_id:string;run_id:string;call_id:string;storage_key:string;raw_sha256:string;size_bytes:number})=>Promise<string>;
}){
 const c=await args.database.connect();
 try{
  await c.query('BEGIN');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[args.workspace_id]);
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({...args,queryable:c,lock_authority:true});
  if(!caps.can_request_processing||!await signalWorkspaceFeatureEnabledV1({queryable:c,workspace_id:args.workspace_id,feature:'concept_membership'}))throw new Error('membership_replay_forbidden');
  const run=(await c.query<MembershipRunV1>(`SELECT r.*,v.identity,v.labeler_digest,ce.context FROM signal_labeling_runs r
   JOIN signal_labeler_versions v ON v.id=r.labeler_version_id
   JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no
   WHERE r.id=$1 AND r.workspace_id=$2 AND r.kind='membership' AND r.status IN('completed','failed')
    AND (r.lease_until IS NULL OR r.lease_until<now()) AND NOT EXISTS(SELECT 1 FROM signal_labeling_runs active
     WHERE active.workspace_id=r.workspace_id AND active.kind='membership' AND active.status IN('queued','running')) FOR UPDATE OF r`,[args.run_id,args.workspace_id])).rows[0];
  if(!run||run.membership_snapshot?.preview||run.identity.params.standard_judge_version===2||run.identity.params.hybrid_citation_quality===true||run.membership_snapshot.route_digest)throw new Error('membership_replay_run_invalid');
  const context=await inspectFacetContextChangeV1(c,args.workspace_id);
  if(context.digest!==run.entity_context_digest)throw new Error('membership_replay_context_changed');
  if(conceptSetDigestV1(await loadMembershipConceptsV1(c,args.workspace_id))!==conceptSetDigestV1(run.membership_snapshot.concepts))throw new Error('membership_replay_concepts_changed');
  const selected=(await c.query<{labeler_digest:string}>(`SELECT v.labeler_digest FROM signal_labeler_versions v
   LEFT JOIN signal_workspace_labelers chosen ON chosen.workspace_id=$1 AND chosen.kind='membership' AND chosen.labeler_version_id=v.id
   WHERE v.kind='membership' AND v.status<>'retired' AND (chosen.workspace_id IS NOT NULL OR v.status='approved')
   ORDER BY (chosen.workspace_id IS NOT NULL) DESC,v.approved_at DESC NULLS LAST,v.created_at DESC LIMIT 1`,[args.workspace_id])).rows[0];
  if(selected?.labeler_digest!==run.labeler_digest)throw new Error('membership_replay_labeler_changed');
  const calls=(await c.query<StoredCall>(`SELECT * FROM signal_labeling_calls WHERE run_id=$1 AND workspace_id=$2 AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(COALESCE(results,'[]')) result WHERE result->>'verdict'='error'
   AND result->>'error_code'='membership_item_schema_invalid') ORDER BY id FOR UPDATE`,[run.id,args.workspace_id])).rows;
  const current=(await c.query<{root_id:string;root_fingerprint:string;concept_key:string;definition_digest:string;entity_context_digest:string;effective_entities_digest:string;labeler_digest:string;verdict:string;source:string}>(
   'SELECT root_id,root_fingerprint,concept_key,definition_digest,entity_context_digest,effective_entities_digest,labeler_digest,verdict,source FROM signal_workspace_concept_memberships_read_v1($1::uuid)',[args.workspace_id])).rows;
  const pages:Array<{call_id:string;raw_sha256:string;results:MembershipResultV1[];repaired:MembershipResultV1[]}>=[];
  for(const call of calls){
   const size=Number(call.raw_size_bytes),settled=Number(call.settled_micro_usd);
   if(call.status!=='settled'||!call.results_applied||call.settled_micro_usd===null||!Number.isSafeInteger(settled)||settled<0||!call.raw_storage_key||!call.raw_sha256||!Number.isSafeInteger(size)||size<0)throw new Error('membership_replay_receipt_invalid');
   const raw=await args.loadRaw({workspace_id:args.workspace_id,run_id:run.id,call_id:call.id,storage_key:call.raw_storage_key,raw_sha256:call.raw_sha256,size_bytes:size});
   if(Buffer.byteLength(raw)!==size||`sha256:${createHash('sha256').update(raw).digest('hex')}`!==call.raw_sha256)throw new Error('membership_replay_receipt_invalid');
   const receipt=JSON.parse(raw);
   if(receipt.custom_id!==call.custom_id||receipt.result?.type!=='succeeded')throw new Error('membership_replay_receipt_invalid');
   const response=parseAnthropicResponseV1(receipt.result.message);
   if(response.status!=='ok')throw new Error('membership_replay_response_invalid');
   const parsed=parseMembershipGroupWithRationaleNormalizationV1(response.text!,call.inputs,'end_turn',run.identity.params.explicit_verdicts===true);
   if(parsed.split)throw new Error('membership_replay_response_invalid');
   const repaired:MembershipResultV1[]=[];
   // Repair the whole affected root, including its explicit negative, only when its
   // semantic fields validate and at least one bounded rationale was normalized.
   const roots=new Set(call.results.filter(r=>r.verdict==='error'&&r.error_code==='membership_item_schema_invalid').map(r=>r.root_id));
   for(const root of roots){
    const results=parsed.results.filter(r=>r.root_id===root),input=call.inputs.find(i=>i.root_id===root);
    if(!input||results.length!==input.evaluated_concepts.length||results.some(r=>r.verdict==='error')||!results.some(r=>r.normalizations?.length))throw new Error('membership_replay_target_invalid');
    for(const result of results){
     const prior=call.results.find(r=>r.root_id===root&&r.concept_key===result.concept_key);
     const row=current.find(r=>r.root_id===root&&r.concept_key===result.concept_key);
     if(!prior||prior.verdict!=='error'||prior.error_code!=='membership_item_schema_invalid'||!row||row.verdict!=='error'||row.source==='human'
      ||row.labeler_digest!==run.labeler_digest||row.root_fingerprint!==result.root_fingerprint||row.definition_digest!==result.definition_digest
      ||row.entity_context_digest!==result.entity_context_digest||row.effective_entities_digest!==result.effective_entities_digest
      ||prior.input_digest!==result.input_digest||prior.root_fingerprint!==result.root_fingerprint||prior.definition_digest!==result.definition_digest
      ||prior.entity_context_digest!==result.entity_context_digest||prior.effective_entities_digest!==result.effective_entities_digest)throw new Error('membership_replay_source_changed');
     repaired.push(result);
    }
   }
   pages.push({call_id:call.id,raw_sha256:call.raw_sha256,repaired,results:call.results.map(prior=>repaired.find(r=>r.root_id===prior.root_id&&r.concept_key===prior.concept_key)??prior)});
  }
  await writeConceptMembershipResultsV1(c,run,pages.flatMap(page=>page.repaired.map(result=>({...result,call_id:page.call_id}))));
  if(pages.length){const changed=await c.query(`UPDATE signal_labeling_calls call SET results=page.results,updated_at=now()
   FROM jsonb_to_recordset($2::jsonb) page(call_id uuid,raw_sha256 text,results jsonb)
   WHERE call.run_id=$1 AND call.id=page.call_id AND call.raw_sha256=page.raw_sha256 AND call.status='settled' AND call.results_applied RETURNING call.id`,[run.id,JSON.stringify(pages)]);
   if(changed.rowCount!==pages.length)throw new Error('membership_replay_receipt_conflict');}
  await c.query('COMMIT');return{replayed_pairs:pages.reduce((n,p)=>n+p.repaired.length,0),provider_sends:0,additional_settlement_micro_usd:0};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
