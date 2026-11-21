import{studySourceRootWithAxesV1,studySourcePagesManifestV1}from'../../services/workers/src/workers/signal-study-source-pages';
import {createHash} from 'node:crypto';
import{studyTransactionV1,studyAuthorizeV1,type StudyAccessV1,type SignalStudyExecutionRecordV1}from'./signal-study-core';
import{withSignalStudySourceWithClientV1}from'./signal-study-source';
import type{PoolClient}from'pg';
import type{StudyRuntimeRootV1,StudyRuntimeSourceV1,StudyRuntimeStepPlanV1,StudyRuntimeNumericPlanV1,StudyRuntimeJevBatchPlanV1,StudyRuntimeStageDependencyV1,StudyRuntimeOutputV1,StudyRuntimeJevBatchCheckpointV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyRuntimeJevQuestionIdentityV1}from'../../services/workers/src/workers/signal-study-runtime';
import {
 validateSignalStudyExecutionConfigurationV1,buildSignalStudyConfiguredAxesRequestV1,resolveSignalStudyConfiguredAxesV1,signalStudyConfiguredCutV1,
 buildSignalStudyMotiveFitPlanV1,buildSignalStudyMotivePopulationV1,sampleSignalStudyGroupV1,signalStudyConfirmedCentroidV1,
 buildSignalStudyMotiveReviewV1,validateSignalStudyMotiveReviewV1,buildSignalStudyConfiguredLayerReviewV1,validateSignalStudyLayerReviewV1,
 signalStudyLayerStabilityV1,signalStudyBoundaryRuleStabilityV1,signalStudyUnmeasurableMotivePartitionsV1,SIGNAL_STUDY_UNMEASURED_LAYER_NOTE_V1,applySignalStudyBoundaryRecodeV1,signalStudyJevMotiveConfigurationV1,buildSignalStudyMotiveRequestV1,
 signalStudyDominancePlanV1,buildSignalStudyContrastReviewV1,validateSignalStudyContrastReviewV1,buildSignalStudySummaryV1,
 signalStudyQueryBiasV1,verifySignalStudyVerbatimV1,materializeSignalStudyEvidenceV1,SIGNAL_STUDY_EVIDENCE_ASSOCIATION_VERSION_V1,assertSignalStudyRootsV1,signalWorkspaceEmbeddingDigestV1 as digest,
 resolveSignalStudyDominanceReaskVersionV1,compileSignalStudyDominanceReaskV1,replaceSignalStudyDominanceMembershipsV1,
 SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1,compileSignalStudyBoundaryRuleBatchesV1,validateSignalStudyBoundaryRuleReviewV1,
 SIGNAL_STUDY_EDITORIAL_COMPILER_V2,compileSignalStudyDiscoveryBatchesV2,compileSignalStudyLayerPairV2,compileSignalStudyContrastBatchesV2,
 validateSignalStudyDiscoveryBatchPrefixV2,buildSignalStudyMotiveReconciliationV2,validateSignalStudyMotiveReconciliationV2,
 assertSignalStudyLayerDecisionPrefixV1,aggregateSignalStudyLayerBatchesV2,validateSignalStudyLayerBatchV2,
 type SignalStudyReconciliationRequestV2,type SignalStudyEditorialFormatStopV1,SignalStudyEditorialRequestSizeErrorV1,type StudyNumericManifestV1,type SignalStudyExecutionConfigurationV1,type SignalStudyRootV1,type SignalStudyMotiveV1,type SignalStudyMembershipV1,
 type SignalStudyEditorialRequestV1,type SignalStudyLayerDecisionV1,type SignalListeningConfigurationV1,signalStudyJevAxesConfigurationV1,
} from '@noisia/query-engine';

type JevRequestV1=ReturnType<typeof buildSignalStudyConfiguredAxesRequestV1>;
type JevAnswerV1=Parameters<typeof resolveSignalStudyConfiguredAxesV1>[1][string];
type EditorialRequestV1=SignalStudyEditorialRequestV1|SignalStudyReconciliationRequestV2;
const sha=(v:string)=>'sha256:'+createHash('sha256').update(v).digest('hex');
function fail(code:string):never{throw Error('study_replay_'+code);}
export type SignalStudyReplayOperationV1=
 |{kind:'sonnet';plan:StudyRuntimeStepPlanV1;editorial:EditorialRequestV1}
 |{kind:'jev';plan:StudyRuntimeJevBatchPlanV1}
 |{kind:'numeric';plan:StudyRuntimeNumericPlanV1;fit:ReturnType<typeof buildSignalStudyMotiveFitPlanV1>;roots:Array<SignalStudyRootV1&StudyRuntimeRootV1>}
 |{kind:'output';output:StudyRuntimeOutputV1}
 |{kind:'format_stop';stop:SignalStudyEditorialFormatStopV1};
export type SignalStudyLayerAgreementProofV1={eligible_count:number;pass_a_count:number;pass_a_digest:string|null;pass_b_count:number;pass_b_digest:string|null;denominator:number;coverage:number;observed_agreement:number|null;expected_agreement:number|null;kappa:number|null;estimation_status:'complete'|'not_estimable';not_estimable_reason:'no_passes'|'incomplete_coverage'|'expected_agreement_one'|null;action:'stable'|'recode_boundary_once'|'unstable_report'|'not_estimable';status:'not_measured'|'insufficient_data'|'not_estimable'|'below_threshold'|'acceptable';boundary_recoded_count:number};
type ReplayNextV1={operation:SignalStudyReplayOperationV1;override_validated:false;resolved_motives?:SignalStudyMotiveV1[];layer_agreement?:SignalStudyLayerAgreementProofV1};
export type SignalStudyCurrentStepValidationV1={plan:StudyRuntimeStepPlanV1;value_digest:string;checkpoint_digest:string};
class NextOperation extends Error{constructor(readonly operation:SignalStudyReplayOperationV1){super('study_next_operation');}}
class CurrentOperationValidated extends Error{constructor(readonly validation:SignalStudyCurrentStepValidationV1){super('study_current_operation_validated');}}
type CurrentTargetV1={plan:StudyRuntimeStepPlanV1;value:unknown};
/** Compile only the next reachable operation from immutable native ancestors. */
export async function replaySignalStudyWithClientV1(c:PoolClient,execution_id:string,raw:StudyRuntimeSourceV1):Promise<ReplayNextV1>{
 const result=await replayStudy(c,execution_id,raw);if('validation'in result)fail('unexpected_current_validation');return result;
}
/** This read-only validator grants no lease, admission or send authority. The
 * native commit owner separately requires the exact verified RAW and settlement.
 * A nominal sentinel stops after ALL current-value checks, before compiling any
 * successor. An unrelated compiler/SQL/protocol error can never imply success. */
export async function validateSignalStudyCurrentStepWithClientV1(c:PoolClient,execution_id:string,raw:StudyRuntimeSourceV1,target:CurrentTargetV1):Promise<SignalStudyCurrentStepValidationV1|null>{
 const result=await replayStudy(c,execution_id,raw,target);return'validation'in result?result.validation:null;
}
/** Native replay consumes only immutable, committed journal entries. It derives
 * the next request from the frozen source and the shared pure compilers; caller
 * request bodies, counters, proposed motives and global latest config have no
 * authority here. No Store facade, paid operation or transaction is simulated. */
async function replayStudy(c:PoolClient,execution_id:string,raw:StudyRuntimeSourceV1,
 target?:CurrentTargetV1):Promise<ReplayNextV1|{validation:SignalStudyCurrentStepValidationV1}>{
 try{
 const configuration=validateSignalStudyExecutionConfigurationV1(raw.configuration),source_digest=raw.source_digest,useV2=raw.editorial_compiler_version===SIGNAL_STUDY_EDITORIAL_COMPILER_V2;
 const dominanceReaskVersion=resolveSignalStudyDominanceReaskVersionV1(raw.dominance_reask_version);
 if(raw.evidence_association_version!==undefined&&raw.evidence_association_version!==SIGNAL_STUDY_EVIDENCE_ASSOCIATION_VERSION_V1)fail('evidence_association_version_invalid');
 if(raw.editorial_compiler_version!==undefined&&!useV2)fail('editorial_compiler_invalid');
 if(raw.layer_boundary_rule_version!==undefined&&(raw.layer_boundary_rule_version!==SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1||!useV2))fail('boundary_rule_version_invalid');
 const dependencies=new Map<string,StudyRuntimeStageDependencyV1>();
 const dependency=(d:StudyRuntimeStageDependencyV1)=>dependencies.set(d.kind+':'+d.key,d);
 const layerReceipts=new Map<'a'|'b',Array<{step_key:string;value_digest:string}>>();
 const sourceById=new Map(raw.roots.map(root=>[root.root_id,root])),resolvedById=new Map<string,SignalStudyRootV1>(),layerPrefixes=new Map<string,SignalStudyLayerDecisionV1[]>();
 async function editorial<T,R extends EditorialRequestV1>(stage:string,request:R,validate:(request:R,value:unknown)=>T):Promise<T>{
  const request_body=request.request_body,request_sha256=sha(request_body),plan:StudyRuntimeStepPlanV1={kind:'sonnet',request_body,request_sha256,source_digest,key:digest({execution_id,source_digest,stage,request_sha256})};
  const saved=(await c.query<{request_body:string;request_sha256:string;value:unknown;value_digest:string;status:string}>('SELECT request_body,request_sha256,value,value_digest,status FROM signal_study_steps WHERE execution_id=$1 AND step_key=$2',[execution_id,plan.key])).rows[0];
  if(saved&&(saved.request_body!==request_body||saved.request_sha256!==request_sha256))fail('step_binding_invalid');
  const replacement=target?.plan.key===plan.key;
  if(replacement&&(saved?.status!=='raw'||digest(target.plan)!==digest(plan)))fail('current_step_binding_invalid');
  const value=replacement?target.value:saved?.status==='committed'?saved.value:undefined;
  if(value===undefined)throw new NextOperation({kind:'sonnet',plan,editorial:request});
  if(!replacement&&saved?.value_digest!==digest(value))fail('step_checkpoint_invalid');
  const body=value as{model?:string;stop_reason?:string;content?:Array<{type:string;text?:string}>};
  if(body.model!=='claude-sonnet-4-6'||body.stop_reason!=='end_turn'||!Array.isArray(body.content)||body.content.filter(e=>e.type==='text').length!==1)fail('sonnet_response_invalid');
  const result=validate(request,JSON.parse(body.content.find(e=>e.type==='text')!.text!));
  if(request.mode==='layers'){
   if(!replacement&&saved?.status==='committed'&&request.pass){const receipts=layerReceipts.get(request.pass)??[];receipts.push({step_key:plan.key,value_digest:saved.value_digest});layerReceipts.set(request.pass,receipts);}
   const decision=result as SignalStudyLayerDecisionV1,scope=decision.pass+':'+decision.recode_attempt,previous=layerPrefixes.get(scope)??[];
   assertSignalStudyLayerDecisionPrefixV1(previous,decision);layerPrefixes.set(scope,[...previous,decision]);
   for(const motive of decision.motives)for(const partition of motive.partitions)for(const evidence of[partition.evidence,partition.normative_evidence])if(evidence){
    const root=resolvedById.get(evidence.root_id);if(!root)fail('current_evidence_source_missing');
    verifySignalStudyVerbatimV1(root,evidence.quote,evidence.private_person_names);
   }
  }
  dependency({kind:'sonnet_step',key:plan.key,digest:digest(value)});
  if(replacement)throw new CurrentOperationValidated({plan,value_digest:digest(value),checkpoint_digest:digest([...dependencies.values()].sort((a,b)=>(a.kind+a.key).localeCompare(b.kind+b.key)))});
  return result;
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
  const roots:Array<SignalStudyRootV1&StudyRuntimeRootV1>=cut.map(root=>studySourceRootWithAxesV1(root,resolveSignalStudyConfiguredAxesV1(configuration,axesAnswers.get(root.root_id)!)));
  assertSignalStudyRootsV1(roots);for(const root of roots)resolvedById.set(root.root_id,root);
  const query_bias=signalStudyQueryBiasV1({query_terms:raw.query_terms,problem_terms:raw.problem_terms,metadata:raw.query_metadata,subject_roots:roots.filter(r=>r.axes.aggregate==='subject').length,brand_baseline_roots:raw.brand_baseline_roots});
  const population=buildSignalStudyMotivePopulationV1(roots),fit=buildSignalStudyMotiveFitPlanV1({study,template_snapshot:snapshot,roots,embedding_space_digest:raw.embedding_space_digest,...(studySourcePagesManifestV1(raw)?{vector_storage:'native_paged_cache' as const}:{})});
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
  const discover=async()=>{
   if(!numeric.groups.length)return{motives:[],insufficient_group_keys:[]};
   const source_samples=numeric.groups.map(g=>samples(g.key,g.root_ids)[0]);
   if(!useV2)return editorial('motives',buildSignalStudyMotiveReviewV1({study,template_snapshot:snapshot,samples:source_samples}),validateSignalStudyMotiveReviewV1);
   const plan=compileSignalStudyDiscoveryBatchesV2({configuration,samples:source_samples});if(plan.status==='format_stop')throw new NextOperation({kind:'format_stop',stop:plan});
   const local_values:unknown[]=[];
   for(const node of plan.nodes){const local=await editorial(node.stage,node.request,(request,value)=>{const output=validateSignalStudyMotiveReviewV1(request,value);validateSignalStudyDiscoveryBatchPrefixV2(plan,[...local_values,output]);return output;});local_values.push(local);}
   const global=buildSignalStudyMotiveReconciliationV2({configuration,discovery_plan:plan,local_values});
   if('status'in global){if(global.status==='format_stop')throw new NextOperation({kind:'format_stop',stop:global});return global.value;}
   return editorial(global.stage,global,validateSignalStudyMotiveReconciliationV2);
  };
  const discovered=await discover();
  let motives:SignalStudyMotiveV1[]=discovered.motives.map(m=>({...m,centroid:signalStudyConfirmedCentroidV1(m.group_keys.flatMap(key=>numeric.groups.find(g=>g.key===key)!.root_ids).map(id=>byRoot.get(id)!)),layer:'unclear',human_locked:false}));
  const motiveRoots=new Map(discovered.motives.map(m=>[m.key,m.group_keys.flatMap(key=>numeric.groups.find(g=>g.key===key)!.root_ids)]));
  const pair=async(keys:string[],recode?:{attempt:1;boundary_keys:string[];contrast_rule:string})=>{
   if(useV2){const plan=compileSignalStudyLayerPairV2({configuration,recode,motives:motives.filter(m=>keys.includes(m.key)).map(m=>({...m,samples:samples(m.key,motiveRoots.get(m.key)!)}))});
    if(plan.status==='format_stop')throw new NextOperation({kind:'format_stop',stop:plan});const values:SignalStudyLayerDecisionV1[]=[];
    for(const node of plan.nodes)values.push(await editorial(node.stage,node.request,validateSignalStudyLayerBatchV2));
    return aggregateSignalStudyLayerBatchesV2(plan,values);
   }
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
  let boundary_recoded_count=0;
  let stability:StudyRuntimeOutputV1['stability']=null,decisions:[SignalStudyLayerDecisionV1,SignalStudyLayerDecisionV1]|undefined;
  if(motives.length){decisions=await pair(motives.map(m=>m.key));stability=raw.layer_boundary_rule_version?signalStudyBoundaryRuleStabilityV1(...decisions):signalStudyLayerStabilityV1(...decisions);
   if(stability.action==='recode_boundary_once'){
    let contrast_rule='Recode only the recorded boundary set under the same frozen diagnostics; preserve distinct forces.';
    if(raw.layer_boundary_rule_version!==undefined){
     if(raw.layer_boundary_rule_version!==SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1)fail('boundary_rule_version_invalid');
     const rulePlan=compileSignalStudyBoundaryRuleBatchesV1({configuration,initial:decisions,motives:motives.filter(m=>stability!.boundary_keys.includes(m.key))});
     if(rulePlan.status==='format_stop')throw new NextOperation({kind:'format_stop',stop:rulePlan});const ready=rulePlan;
     const rules:Array<{motive_key:string;contrast_rule:string;reason:string}>=[];
     for(const node of ready.nodes)rules.push(...(await editorial(node.stage,node.request,validateSignalStudyBoundaryRuleReviewV1)).rules);
     if(rules.map(r=>r.motive_key).sort().join(',')!==stability.boundary_keys.join(','))fail('boundary_rule_coverage_invalid');
     contrast_rule=JSON.stringify({contract_version:SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1,rules:rules.map(({motive_key,contrast_rule})=>({motive_key,contrast_rule}))});
    }
    const repaired=applySignalStudyBoundaryRecodeV1({initial:decisions,recoded:await pair(stability.boundary_keys,{attempt:1,boundary_keys:stability.boundary_keys,contrast_rule})});
    boundary_recoded_count=stability.boundary_keys.length;decisions=repaired.decisions;stability=repaired.stability;
   }
   // Split identities remain distinct, never averaged or assigned by majority.
   motives=(raw.layer_boundary_rule_version&&stability.kappa===null?signalStudyUnmeasurableMotivePartitionsV1(...decisions):decisions[0].motives).flatMap(m=>m.partitions.map(p=>({key:p.key,name:p.name,definition:p.definition,
    centroid:signalStudyConfirmedCentroidV1(p.sample_root_ids.map(id=>byRoot.get(id)!)),layer:stability?.action==='stable'?p.layer:'unclear',human_locked:false,
    ...(stability?.action==='stable'&&p.permission_overridden?{permission_override:{permission:p.permission,reason:p.permission_override!.reason}}:{})})));
  }
  let memberships:SignalStudyMembershipV1[]=[];
  const classify=async(selected:SignalStudyRootV1[],candidates:SignalStudyMotiveV1[],stage:string,affected?:readonly string[])=>{
   const reask=affected?compileSignalStudyDominanceReaskV1({version:dominanceReaskVersion,configuration,roots:selected,motives:candidates,memberships,affected_keys:affected}):null;
   const config=reask?.stage_configuration??signalStudyJevMotiveConfigurationV1(configuration,candidates),rows:SignalStudyMembershipV1[]=[];
   const inputs=reask?.inputs??selected.flatMap(root=>{const request=buildSignalStudyMotiveRequestV1(root,candidates,config);return request?[{root_id:root.root_id,request}]:[];});
   const result=await jevBatch(stage,inputs,config);
   for(const root of inputs)for(const [key,answer]of Object.entries(result.get(root.root_id)!)){
    if(answer.type!=='noul')fail('motive_response_invalid');rows.push({root_id:root.root_id,motive_key:key,probability:answer.noul,source:'jev',human_locked:false});
   }return rows;
  };
  if(motives.length)memberships=await classify(population.roots,motives,'membership');
  let dominance=roots.length&&motives.length?signalStudyDominancePlanV1({roots,motives,memberships,cut_root_ids:roots.map(r=>r.root_id)}):null;
  if(dominance?.motive_keys.length){
   const affected=dominance.motive_keys,contrastMotives=motives.map(m=>({...m,sample:samples(m.key,memberships.filter(row=>row.motive_key===m.key&&row.probability>=.7).map(row=>row.root_id).length?
     memberships.filter(row=>row.motive_key===m.key&&row.probability>=.7).map(row=>row.root_id):population.roots.map(r=>r.root_id))[0]}));
   const contrast=async()=>{if(!useV2)return editorial('dominance_contrast',buildSignalStudyContrastReviewV1({study,template_snapshot:snapshot,affected_keys:affected,motives:contrastMotives}),validateSignalStudyContrastReviewV1);
    const plan=compileSignalStudyContrastBatchesV2({configuration,motives:contrastMotives,affected_keys:affected});if(plan.status==='format_stop')throw new NextOperation({kind:'format_stop',stop:plan});
    const definitions:Array<ReturnType<typeof validateSignalStudyContrastReviewV1>['definitions'][number]>=[];
    for(const node of plan.nodes)definitions.push(...(await editorial(node.stage,node.request,validateSignalStudyContrastReviewV1)).definitions);
    return{definitions};};
   const contrasted=await contrast();
   motives=motives.map(m=>{const d=contrasted.definitions.find(d=>d.key===m.key);return d?{...m,name:d.name,definition:d.definition}:m;});
   const target=new Set(dominance.reask_root_ids);
   const reasked=await classify(population.roots.filter(r=>target.has(r.root_id)),motives,'dominance_membership',affected);
   memberships=replaceSignalStudyDominanceMembershipsV1({version:dominanceReaskVersion,memberships,reasked,target_root_ids:target,affected_keys:affected});
   dominance=signalStudyDominancePlanV1({roots,motives,memberships,cut_root_ids:roots.map(r=>r.root_id)});
  }
  const verified_evidence=materializeSignalStudyEvidenceV1(decisions,byRoot,raw.evidence_association_version);
  const summary=buildSignalStudySummaryV1({study,template_snapshot:snapshot,roots,motives,memberships,cut_root_ids:roots.map(r=>r.root_id),unresolved_root_ids:[]});
  if(raw.layer_boundary_rule_version&&stability?.kappa===null)summary.limitations.push(SIGNAL_STUDY_UNMEASURED_LAYER_NOTE_V1);
  const output:StudyRuntimeOutputV1={contract_version:'signal-study-runtime-output-v1',status:'directional',source_digest,configuration_digest:digest(configuration),
   summary,
   query_bias,
   stability,dominance,verified_evidence,insufficient_group_keys:discovered.insufficient_group_keys,promotion:{status:'explicit_action_required',automatic:false}};

 const eligible_count=stability?.total_motives??0,denominator=stability?.compared_motives??0;
 const pass=(index:0|1)=>{const decision=decisions?.[index],receipts=layerReceipts.get(index===0?'a':'b')??[];return{count:decision?.motives.length??0,digest:decision?.motives.length?digest({contract_version:'signal-study-layer-pass-proof-v1',execution_id,source_digest,pass:index===0?'a':'b',decision,committed_steps:receipts}):null};};
 const a=pass(0),b=pass(1),incomplete=denominator<eligible_count;
 const layer_agreement:SignalStudyLayerAgreementProofV1={eligible_count,pass_a_count:a.count,pass_a_digest:a.digest,pass_b_count:b.count,pass_b_digest:b.digest,denominator,coverage:eligible_count?denominator/eligible_count:0,observed_agreement:stability?.observed_agreement??null,expected_agreement:stability?.expected_agreement??null,kappa:stability?.kappa??null,estimation_status:stability?.estimation_status??'not_estimable',not_estimable_reason:!decisions?'no_passes':incomplete?'incomplete_coverage':stability?.expected_agreement===1?'expected_agreement_one':null,action:stability?.action??'not_estimable',status:!decisions?'not_measured':incomplete?'insufficient_data':stability?.kappa===null?'not_estimable':stability&&stability.kappa!==null&&stability.kappa<.8?'below_threshold':'acceptable',boundary_recoded_count};
 return{operation:{kind:'output',output},override_validated:false,resolved_motives:motives,layer_agreement};
 }catch(error){if(error instanceof CurrentOperationValidated)return{validation:error.validation};if(error instanceof NextOperation)return{operation:error.operation,override_validated:false};
  if(raw.editorial_compiler_version===undefined&&error instanceof SignalStudyEditorialRequestSizeErrorV1)return{operation:{kind:'format_stop',stop:{status:'format_stop',compiler_version:'legacy-v1',phase:'legacy-editorial',unit_keys:[],reason:'request_bytes',observed:error.request_bytes,limit:524288,estimate_profile:null}},override_validated:false};throw error;}

}

/** Rebuild κ from the exact native source and committed journal, without returning
 * samples or reading a newer configuration. Repeatable-read prevents an audit
 * proof from combining two custody snapshots. No claim, send or mutation occurs. */
export async function readSignalStudyStabilityProofV1(args:StudyAccessV1&{execution_id:string}){
 return studyTransactionV1(args.database,async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await studyAuthorizeV1(c,args,'view');
  const row=(await c.query<Pick<SignalStudyExecutionRecordV1,'id'|'workspace_id'|'configuration_id'|'source_roots'|'source_header'|'source_digest'|'configuration_digest'>&{output_digest:string}>(`SELECT p.id,p.workspace_id,p.configuration_id,p.source_roots,p.source_header,p.source_digest,p.configuration_digest,p.output_digest
   FROM signal_study_executions p JOIN signal_study_configuration_sources_v1 s ON s.study_configuration_id=p.configuration_id AND s.workspace_id=p.workspace_id
   WHERE p.id=$1 AND p.workspace_id=$2 AND p.status='completed' AND signal_study_generation_header_current_v1(s.generation_id)
   AND NOT EXISTS(SELECT 1 FROM signal_study_source_roots root WHERE root.execution_id=p.id AND NOT signal_listening_root_right_v1(p.workspace_id,root.root_id,'client-derived-metrics'))`,[args.execution_id,args.workspace_id])).rows[0];
  if(!row)return null;
  const replay=await withSignalStudySourceWithClientV1(c,row,source=>replaySignalStudyWithClientV1(c,row.id,source));
  if(replay.operation.kind!=='output'||digest(replay.operation.output)!==row.output_digest)fail('audit_output_integrity_invalid');
  const proof={contract_version:'signal-study-stability-proof-v1' as const,workspace_id:row.workspace_id,execution_id:row.id,
   compiler_version:row.source_header.editorial_compiler_version===SIGNAL_STUDY_EDITORIAL_COMPILER_V2?SIGNAL_STUDY_EDITORIAL_COMPILER_V2:'legacy-v1',configuration_digest:row.configuration_digest,source_digest:row.source_digest,output_digest:row.output_digest,stability:replay.operation.output.stability,layer_agreement:replay.layer_agreement!};
  return{...proof,proof_digest:digest(proof)};
 });
}
