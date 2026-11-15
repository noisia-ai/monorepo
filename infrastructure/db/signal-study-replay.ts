import {createHash} from 'node:crypto';
import type{PoolClient}from'pg';
import type{StudyRuntimeRootV1,StudyRuntimeSourceV1,StudyRuntimeStepPlanV1,StudyRuntimeNumericPlanV1,StudyRuntimeJevBatchPlanV1,StudyRuntimeStageDependencyV1,StudyRuntimeOutputV1,StudyRuntimeJevBatchCheckpointV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyRuntimeJevQuestionIdentityV1}from'../../services/workers/src/workers/signal-study-runtime';
import {
 validateSignalStudyExecutionConfigurationV1,buildSignalStudyConfiguredAxesRequestV1,resolveSignalStudyConfiguredAxesV1,signalStudyConfiguredCutV1,
 buildSignalStudyMotiveFitPlanV1,buildSignalStudyMotivePopulationV1,sampleSignalStudyGroupV1,signalStudyConfirmedCentroidV1,
 buildSignalStudyMotiveReviewV1,validateSignalStudyMotiveReviewV1,buildSignalStudyConfiguredLayerReviewV1,validateSignalStudyLayerReviewV1,
 signalStudyLayerStabilityV1,applySignalStudyBoundaryRecodeV1,signalStudyJevMotiveConfigurationV1,buildSignalStudyMotiveRequestV1,
 signalStudyDominancePlanV1,buildSignalStudyContrastReviewV1,validateSignalStudyContrastReviewV1,buildSignalStudySummaryV1,
 signalStudyQueryBiasV1,verifySignalStudyVerbatimV1,assertSignalStudyRootsV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type StudyNumericManifestV1,type SignalStudyExecutionConfigurationV1,type SignalStudyRootV1,type SignalStudyMotiveV1,type SignalStudyMembershipV1,
 type SignalStudyEditorialRequestV1,type SignalStudyLayerDecisionV1,type SignalListeningConfigurationV1,signalStudyJevAxesConfigurationV1,
} from '@noisia/query-engine';

type JevRequestV1=ReturnType<typeof buildSignalStudyConfiguredAxesRequestV1>;
type JevAnswerV1=Parameters<typeof resolveSignalStudyConfiguredAxesV1>[1][string];
const sha=(v:string)=>'sha256:'+createHash('sha256').update(v).digest('hex');
function fail(code:string):never{throw Error('study_replay_'+code);}
export type SignalStudyReplayOperationV1=
 |{kind:'sonnet';plan:StudyRuntimeStepPlanV1;editorial:SignalStudyEditorialRequestV1}
 |{kind:'jev';plan:StudyRuntimeJevBatchPlanV1}
 |{kind:'numeric';plan:StudyRuntimeNumericPlanV1;fit:ReturnType<typeof buildSignalStudyMotiveFitPlanV1>;roots:Array<SignalStudyRootV1&StudyRuntimeRootV1>}
 |{kind:'output';output:StudyRuntimeOutputV1};
class NextOperation extends Error{constructor(readonly operation:SignalStudyReplayOperationV1){super('study_next_operation');}}
/** Native replay consumes only immutable, committed journal entries. It derives
 * the next request from the frozen source and the shared pure compilers; caller
 * request bodies, counters, proposed motives and global latest config have no
 * authority here. No Store facade, paid operation or transaction is simulated. */
export async function replaySignalStudyWithClientV1(c:PoolClient,execution_id:string,raw:StudyRuntimeSourceV1,
 override?:{key:string;value:unknown}):Promise<{operation:SignalStudyReplayOperationV1;override_validated:boolean;resolved_motives?:SignalStudyMotiveV1[]}>{
 let override_validated=false;
 try{
 const configuration=validateSignalStudyExecutionConfigurationV1(raw.configuration),source_digest=raw.source_digest;
 const dependencies=new Map<string,StudyRuntimeStageDependencyV1>();
 const dependency=(d:StudyRuntimeStageDependencyV1)=>dependencies.set(d.kind+':'+d.key,d);
 const sourceById=new Map(raw.roots.map(root=>[root.root_id,root]));
 async function editorial<T>(stage:string,request:SignalStudyEditorialRequestV1,validate:(request:SignalStudyEditorialRequestV1,value:unknown)=>T):Promise<T>{
  const request_body=request.request_body,request_sha256=sha(request_body),plan:StudyRuntimeStepPlanV1={kind:'sonnet',request_body,request_sha256,source_digest,key:digest({execution_id,source_digest,stage,request_sha256})};
  const saved=(await c.query<{request_body:string;request_sha256:string;value:unknown;value_digest:string;status:string}>('SELECT request_body,request_sha256,value,value_digest,status FROM signal_study_steps WHERE execution_id=$1 AND step_key=$2',[execution_id,plan.key])).rows[0];
  if(saved&&(saved.request_body!==request_body||saved.request_sha256!==request_sha256))fail('step_binding_invalid');
  const replacement=override?.key===plan.key,value=replacement?override.value:saved?.status==='committed'?saved.value:undefined;
  if(value===undefined)throw new NextOperation({kind:'sonnet',plan,editorial:request});
  if(!replacement&&saved?.value_digest!==digest(value))fail('step_checkpoint_invalid');
  const body=value as{model?:string;stop_reason?:string;content?:Array<{type:string;text?:string}>};
  if(body.model!=='claude-sonnet-4-6'||body.stop_reason!=='end_turn'||!Array.isArray(body.content)||body.content.filter(e=>e.type==='text').length!==1)fail('sonnet_response_invalid');
  const result=validate(request,JSON.parse(body.content.find(e=>e.type==='text')!.text!));
  if(replacement)override_validated=true;dependency({kind:'sonnet_step',key:plan.key,digest:digest(value)});return result;
 }
 async function jevBatch(stage:string,inputs:Array<{root_id:string;request:JevRequestV1}>,stage_configuration:SignalListeningConfigurationV1){
  const answers=new Map<string,Record<string,JevAnswerV1>>(),requests:StudyRuntimeJevBatchPlanV1['requests']=[];
  for(const {root_id,request}of inputs){
   const cache=sourceById.get(root_id)?.question_cache??[],known:Record<string,JevAnswerV1>={},missing:JevRequestV1['questions']={};
   for(const[key,question]of Object.entries(request.questions)){
    const hit=cache.find(entry=>entry.question_key===key&&entry.identity_digest===studyRuntimeJevQuestionIdentityV1(request,key));
    if(hit)Object.assign(known,jevResponse({...request,questions:{[key]:question}},{model:request.model,answers:{[key]:hit.answer}}));else missing[key]=question;
   }
   answers.set(root_id,known);if(Object.keys(missing).length){const request_body=JSON.stringify({...request,questions:missing});requests.push({root_id,request_body,request_sha256:sha(request_body)});}
  }
  if(!requests.length)return answers;
  const body={contract_version:'signal-study-jev-batch-v1' as const,execution_id,workspace_id:configuration.study.workspace_id,source_digest,stage,model:'jev-1.13.0' as const,stage_configuration,stage_configuration_digest:digest(stage_configuration),stage_dependencies:stage==='axes'?[]:[...dependencies.values()].sort((a,b)=>(a.kind+a.key).localeCompare(b.kind+b.key)),requests};
  const plan={...body,plan_digest:digest(body)};
  const batch=(await c.query<{id:string;status:string;checkpoint:StudyRuntimeJevBatchCheckpointV1|null}>('SELECT id,status,checkpoint FROM signal_study_jev_batches WHERE execution_id=$1 AND stage=$2 AND plan_digest=$3',[execution_id,stage,plan.plan_digest])).rows[0];
  if(!batch||batch.status!=='completed'||!batch.checkpoint)throw new NextOperation({kind:'jev',plan});
  const checkpoint=batch.checkpoint,{checkpoint_digest,...value}=checkpoint;
  if(digest(value)!==checkpoint_digest||checkpoint.batch_id!==batch.id||checkpoint.plan_digest!==plan.plan_digest||checkpoint.status!=='completed'||checkpoint.results.length!==requests.length||new Set(checkpoint.results.map(e=>e.root_id)).size!==requests.length)fail('batch_checkpoint_invalid');
  const expected=new Map(requests.map(e=>[e.root_id,e]));
  for(const row of checkpoint.results){const req=expected.get(row.root_id);if(!req||row.request_sha256!==req.request_sha256||row.receipt_page.verified!==true||!row.complete||row.http_status!==200)fail('batch_custody_invalid');Object.assign(answers.get(row.root_id)!,jevResponse(JSON.parse(req.request_body),row.response));}
  dependency({kind:'jev_batch',key:batch.id,digest:checkpoint.checkpoint_digest});return answers;
 }
function jevResponse(request:JevRequestV1,value:unknown):Record<string,JevAnswerV1>{
 const response=value as {model?:unknown;answers?:Record<string,JevAnswerV1>};
 if(response?.model!==request.model||!response.answers||Object.keys(response.answers).sort().join(',')!==Object.keys(request.questions).sort().join(','))fail('jev_response_invalid');
 for(const [key,q] of Object.entries(request.questions)){
  const a=response.answers![key];if(!a||a.type!==q.type)fail('jev_response_invalid');
  if(a.type==='noul'){if(!Number.isFinite(a.noul)||a.noul<0||a.noul>1)fail('jev_response_invalid');}
  else{const keys=Object.keys(q.criteria??{}).sort();
   if(!keys.includes(a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1
    ||Object.keys(a.probabilities).sort().join(',')!==keys.join(',')||Object.values(a.probabilities).some(p=>!Number.isFinite(p)||p<0||p>1)
    ||Math.abs(Object.values(a.probabilities).reduce((sum,p)=>sum+p,0)-1)>.001)fail('jev_response_invalid');
  }
 }
 return response.answers!;
}

  const snapshot=configuration.template_snapshot,study=configuration.study;
  // Base answers are native Listening cache only. Never ask/pay voice/promotion.
  const cut=raw.roots.filter(root=>{
   const status=signalStudyConfiguredCutV1({configuration,text:root.text,occurred_at:root.occurred_at,answers:root.base_answers,attributes:root.attributes});
   if(status==='awaiting_base')fail('base_pending');if(status!=='included')fail('native_cut_mismatch');return true;
  });
  const axesAnswers=await jevBatch('axes',cut.map(root=>({root_id:root.root_id,request:buildSignalStudyConfiguredAxesRequestV1({text:root.text},configuration)})),signalStudyJevAxesConfigurationV1(configuration));
  const roots:Array<SignalStudyRootV1&StudyRuntimeRootV1>=cut.map(root=>({...root,axes:resolveSignalStudyConfiguredAxesV1(configuration,axesAnswers.get(root.root_id)!)}));
  assertSignalStudyRootsV1(roots);
  const query_bias=signalStudyQueryBiasV1({query_terms:raw.query_terms,problem_terms:raw.problem_terms,metadata:raw.query_metadata,subject_roots:roots.filter(r=>r.axes.aggregate==='subject').length,brand_baseline_roots:raw.brand_baseline_roots});
  const population=buildSignalStudyMotivePopulationV1(roots),fit=buildSignalStudyMotiveFitPlanV1({study,template_snapshot:snapshot,roots,embedding_space_digest:raw.embedding_space_digest});
  const request_body=JSON.stringify(fit),numericPlan:StudyRuntimeNumericPlanV1={kind:'numeric',fit_plan_digest:fit.plan_digest,source_digest,request_body,request_sha256:sha(request_body),
   key:digest({execution_id,source_digest,stage:'numeric-cpu-v1',request_sha256:sha(request_body)})};
  const checkpoint=(await c.query<{value:import('../../services/workers/src/workers/signal-study-runtime').StudyRuntimeNumericV1;value_digest:string;manifest_json:string;manifest_sha256:string;verification_status:string}>('SELECT value,value_digest,manifest_json,manifest_sha256,verification_status FROM signal_study_numeric_checkpoints WHERE execution_id=$1 AND numeric_key=$2',[execution_id,numericPlan.key])).rows[0];
  if(!checkpoint||checkpoint.verification_status!=='verified')throw new NextOperation({kind:'numeric',plan:numericPlan,fit,roots});
  if(sha(checkpoint.manifest_json)!==checkpoint.manifest_sha256||digest(checkpoint.value)!==checkpoint.value_digest)fail('numeric_checkpoint_invalid');
  let manifest:StudyNumericManifestV1;try{manifest=JSON.parse(checkpoint.manifest_json);}catch{fail('numeric_checkpoint_invalid');}
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))fail('numeric_checkpoint_invalid');
  if(manifest.contract_version!=='signal-study-numeric-v1'||manifest.source_digest!==source_digest||manifest.request_sha256!==numericPlan.request_sha256
   ||manifest.fit_plan_digest!==fit.plan_digest||manifest.execution_id!==execution_id||manifest.workspace_id!==configuration.study.workspace_id||manifest.study_digest!==configuration.study_digest
   ||manifest.cut_digest!==digest(study.cut)||manifest.numeric_config_digest!==digest(fit.configuration)||manifest.seed_digest!==digest(raw.sampling_seed))fail('numeric_checkpoint_invalid');
  const numeric=checkpoint.value;
  if(!numeric||numeric.plan_digest!==fit.plan_digest||!Array.isArray(numeric.groups)||!Array.isArray(numeric.unassigned_root_ids)
   ||numeric.groups.some(g=>!g||typeof g.key!=='string'||!Array.isArray(g.root_ids)||g.root_ids.some(id=>typeof id!=='string'||!id))
   ||numeric.unassigned_root_ids.some(id=>typeof id!=='string'||!id))fail('numeric_invalid');
  const ids=[...numeric.groups.flatMap(g=>g.root_ids),...numeric.unassigned_root_ids],expected=population.roots.map(r=>r.root_id).sort();
  const grouped=numeric.groups.reduce((sum,g)=>sum+g.root_ids.length,0),unassigned=numeric.unassigned_root_ids.length;
  // A separately rehashed value is not a second authority over the sealed
  // manifest. Bind the exact grouping before it can select paid editorial data.
  if(!Array.isArray(manifest.groups)||!Array.isArray(manifest.unassigned_root_ids)
   ||digest(numeric)!==digest({plan_digest:manifest.fit_plan_digest,groups:manifest.groups,unassigned_root_ids:manifest.unassigned_root_ids})
   ||digest(manifest.numeric_config)!==digest(fit.configuration)||manifest.embedding_space_digest!==raw.embedding_space_digest
   ||manifest.root_count!==expected.length||manifest.grouped_count!==grouped||manifest.unassigned_count!==unassigned
   ||grouped+unassigned!==manifest.root_count||!/^sha256:[a-f0-9]{64}$/u.test(manifest.input_manifest_sha256)
   ||(expected.length===0?manifest.status!=='empty'||manifest.output_manifest_sha256!==null
    :!['completed','insufficient_population'].includes(manifest.status)||!/^sha256:[a-f0-9]{64}$/u.test(manifest.output_manifest_sha256??''))
   ||manifest.status==='insufficient_population'&&(grouped!==0||unassigned!==expected.length))fail('numeric_checkpoint_invalid');
  if(new Set(numeric.groups.map(g=>g.key)).size!==numeric.groups.length||numeric.groups.some(g=>!g.root_ids.length||!/^[a-z][a-z0-9_]{0,63}$/u.test(g.key))
   ||new Set(ids).size!==ids.length||ids.sort().join(',')!==expected.join(','))fail('numeric_population_invalid');
  dependency({kind:'numeric_checkpoint',key:numericPlan.key,digest:checkpoint.manifest_sha256});
  const byRoot=new Map(roots.map(r=>[r.root_id,r]));
  const samples=(key:string,ids:string[])=>{const selected=ids.map(id=>byRoot.get(id)??fail('sample_root_missing'));
   return sampleSignalStudyGroupV1({study_digest:configuration.study_digest,group_key:key,roots:selected,centroid:signalStudyConfirmedCentroidV1(selected),seed:raw.sampling_seed,random_count:35,far_count:5});};
  const discovered=numeric.groups.length?await editorial('motives',buildSignalStudyMotiveReviewV1({study,template_snapshot:snapshot,samples:numeric.groups.map(g=>samples(g.key,g.root_ids)[0])}),validateSignalStudyMotiveReviewV1):{motives:[],insufficient_group_keys:[]};
  let motives:SignalStudyMotiveV1[]=discovered.motives.map(m=>({...m,centroid:signalStudyConfirmedCentroidV1(m.group_keys.flatMap(key=>numeric.groups.find(g=>g.key===key)!.root_ids).map(id=>byRoot.get(id)!)),layer:'unclear',human_locked:false}));
  const motiveRoots=new Map(discovered.motives.map(m=>[m.key,m.group_keys.flatMap(key=>numeric.groups.find(g=>g.key===key)!.root_ids)]));
  const pair=async(keys:string[],recode?:{attempt:1;boundary_keys:string[];contrast_rule:string})=>{
   const decisions:SignalStudyLayerDecisionV1[]=[];
   for(const pass of ['a','b']as const){
    const batches:SignalStudyLayerDecisionV1[]=[];
    for(let offset=0;offset<keys.length;offset+=40){const batch=keys.slice(offset,offset+40),request=buildSignalStudyConfiguredLayerReviewV1({configuration,pass,
     recode:recode?{...recode,boundary_keys:batch}:undefined,
     motives:motives.filter(m=>batch.includes(m.key)).map(m=>({...m,sample:samples(m.key,motiveRoots.get(m.key)!)[pass==='a'?0:1]}))});
     batches.push(await editorial('layers:'+pass+':'+(recode?'repair':'initial')+':'+offset,request,validateSignalStudyLayerReviewV1));}
    decisions.push({...batches[0]!,request_digest:digest(batches.map(b=>b.request_digest)),motives:batches.flatMap(b=>b.motives)});
   }
   return decisions as [SignalStudyLayerDecisionV1,SignalStudyLayerDecisionV1];
  };
  let stability:StudyRuntimeOutputV1['stability']=null,decisions:[SignalStudyLayerDecisionV1,SignalStudyLayerDecisionV1]|undefined;
  if(motives.length){decisions=await pair(motives.map(m=>m.key));stability=signalStudyLayerStabilityV1(...decisions);
   if(stability.action==='recode_boundary_once'){
    const repaired=applySignalStudyBoundaryRecodeV1({initial:decisions,recoded:await pair(stability.boundary_keys,{attempt:1,boundary_keys:stability.boundary_keys,contrast_rule:'Recode only the recorded boundary set under the same frozen diagnostics; preserve distinct forces.'})});
    decisions=repaired.decisions;stability=repaired.stability;
   }
   // Split identities remain distinct, never averaged or assigned by majority.
   motives=decisions[0].motives.flatMap(m=>m.partitions.map(p=>({key:p.key,name:p.name,definition:p.definition,
    centroid:signalStudyConfirmedCentroidV1(p.sample_root_ids.map(id=>byRoot.get(id)!)),layer:stability?.action==='stable'?p.layer:'unclear',human_locked:false,
    ...(stability?.action==='stable'&&p.permission_overridden?{permission_override:{permission:p.permission,reason:p.permission_override!.reason}}:{})})));
  }
  let memberships:SignalStudyMembershipV1[]=[];
  const classify=async(selected:SignalStudyRootV1[],candidates:SignalStudyMotiveV1[],stage:string)=>{
   const config=signalStudyJevMotiveConfigurationV1(configuration,candidates),rows:SignalStudyMembershipV1[]=[];
   const inputs=selected.flatMap(root=>{const request=buildSignalStudyMotiveRequestV1(root,candidates,config);return request?[{root_id:root.root_id,request}]:[];});
   const result=await jevBatch(stage,inputs,config);
   for(const root of inputs)for(const [key,answer]of Object.entries(result.get(root.root_id)!)){
    if(answer.type!=='noul')fail('motive_response_invalid');rows.push({root_id:root.root_id,motive_key:key,probability:answer.noul,source:'jev',human_locked:false});
   }return rows;
  };
  if(motives.length)memberships=await classify(population.roots,motives,'membership');
  let dominance=roots.length&&motives.length?signalStudyDominancePlanV1({roots,motives,memberships,cut_root_ids:roots.map(r=>r.root_id)}):null;
  if(dominance?.motive_keys.length){
   const affected=dominance.motive_keys,request=buildSignalStudyContrastReviewV1({study,template_snapshot:snapshot,affected_keys:affected,
    motives:motives.map(m=>({...m,sample:samples(m.key,memberships.filter(row=>row.motive_key===m.key&&row.probability>=.7).map(row=>row.root_id).length?
     memberships.filter(row=>row.motive_key===m.key&&row.probability>=.7).map(row=>row.root_id):population.roots.map(r=>r.root_id))[0]}))});
   const contrasted=await editorial('dominance_contrast',request,validateSignalStudyContrastReviewV1);
   motives=motives.map(m=>{const d=contrasted.definitions.find(d=>d.key===m.key);return d?{...m,name:d.name,definition:d.definition}:m;});
   const target=new Set(dominance.reask_root_ids);
   memberships=[...memberships.filter(row=>!target.has(row.root_id)||!affected.includes(row.motive_key)||row.human_locked),
    ...await classify(population.roots.filter(r=>target.has(r.root_id)),motives.filter(m=>affected.includes(m.key)),'dominance_membership')];
   dominance=signalStudyDominancePlanV1({roots,motives,memberships,cut_root_ids:roots.map(r=>r.root_id)});
  }
  const verified_evidence=decisions?.flatMap(d=>d.motives.flatMap(m=>m.partitions.flatMap(p=>[p.evidence,p.normative_evidence].filter(e=>e!==null)
   .map(e=>verifySignalStudyVerbatimV1(byRoot.get(e.root_id)!,e.quote,e.private_person_names)))))??[];
  const output:StudyRuntimeOutputV1={contract_version:'signal-study-runtime-output-v1',status:'directional',source_digest,configuration_digest:digest(configuration),
   summary:buildSignalStudySummaryV1({study,template_snapshot:snapshot,roots,motives,memberships,cut_root_ids:roots.map(r=>r.root_id),unresolved_root_ids:[]}),
   query_bias,
   stability,dominance,verified_evidence,insufficient_group_keys:discovered.insufficient_group_keys,promotion:{status:'explicit_action_required',automatic:false}};

 return{operation:{kind:'output',output},override_validated,resolved_motives:motives};
 }catch(error){if(error instanceof NextOperation)return{operation:error.operation,override_validated};throw error;}
}
