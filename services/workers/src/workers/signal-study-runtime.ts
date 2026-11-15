import {createHash} from 'node:crypto';
import type{StudyNumericManifestV1}from'./signal-study-numeric';
import {
 validateSignalStudyExecutionConfigurationV1,buildSignalStudyConfiguredAxesRequestV1,resolveSignalStudyConfiguredAxesV1,signalStudyConfiguredCutV1,
 buildSignalStudyMotiveFitPlanV1,buildSignalStudyMotivePopulationV1,sampleSignalStudyGroupV1,signalStudyConfirmedCentroidV1,
 buildSignalStudyMotiveReviewV1,validateSignalStudyMotiveReviewV1,buildSignalStudyConfiguredLayerReviewV1,validateSignalStudyLayerReviewV1,
 signalStudyLayerStabilityV1,applySignalStudyBoundaryRecodeV1,signalStudyJevMotiveConfigurationV1,buildSignalStudyMotiveRequestV1,
 signalStudyDominancePlanV1,buildSignalStudyContrastReviewV1,validateSignalStudyContrastReviewV1,buildSignalStudySummaryV1,
 signalStudyQueryBiasV1,verifySignalStudyVerbatimV1,assertSignalStudyRootsV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalStudyExecutionConfigurationV1,type SignalStudyRootV1,type SignalStudyMotiveV1,type SignalStudyMembershipV1,
 type SignalStudyEditorialRequestV1,type SignalStudyLayerDecisionV1,type SignalListeningConfigurationV1,signalStudyJevAxesConfigurationV1,
} from '@noisia/query-engine';
type JevRequestV1=ReturnType<typeof buildSignalStudyConfiguredAxesRequestV1>;
type JevAnswerV1=Parameters<typeof resolveSignalStudyConfiguredAxesV1>[1][string];

/** No default store/queue/provider exists here. These interfaces require a native
 * owner, financial ledger and verified private custody before runtime wiring.
 * Every mutation must recheck lease, source, policy and human revision under CAS.
 * A callback implementation is not evidence that those DB guarantees exist. */
export type StudyRuntimeLeaseV1={execution_id:string;workspace_id:string;execution_token:string;
 source_digest:string;configuration_digest:string;human_revision_digest:string};
export type StudyRuntimeRootV1=Omit<SignalStudyRootV1,'axes'>&{base_answers:Record<string,JevAnswerV1>;
 attributes?:Record<string,string[]>;question_cache?:StudyRuntimeJevCacheV1[];embedding_proof:{embedding_call_id:string;embedding_run_id:string;preparation_run_id:string|null;input_contract:string;proof_json:string;proof_digest:string;vector_json:string;vector_digest:string;text_sha256:string}};
/** roots is ONLY the native selected consumer cut, never the whole corpus.
 * The DB loader must select/count IDs and octet sizes before hydration; external
 * corpus/query baselines remain aggregate counts. A cut beyond the native bound
 * requires a paged/spooled adapter, not silently excluding eligible roots. */
export type StudyRuntimeSourceV1={configuration:SignalStudyExecutionConfigurationV1;roots:StudyRuntimeRootV1[];
 selection:{scope:'listening_consumer_cut';source_listening_digest:string;cut_digest:string;eligible_root_ids_digest:string;
  eligible_roots:number;pending_base_roots:number;corpus_roots:number};
 embedding_space_digest:string;source_preparation_run_ids:string[];sampling_seed:string;query_terms:string[];problem_terms:string[];query_metadata?:{query_terms_declared:boolean;problem_terms_declared:boolean};brand_baseline_roots:number;
 source_digest:string;human_revision_digest:string;max_roots:number;max_bytes:number};
export type StudyRuntimeReceiptV1={body_base64:string;body_bytes:number;sha256:string;complete:boolean;http_status:number|null;provider_request_id:string|null};
export type StudyRuntimeStepPlanV1={key:string;kind:'sonnet';request_body:string;request_sha256:string;source_digest:string};
export type StudyRuntimeStepV1=StudyRuntimeStepPlanV1&{status:'planned'|'sent'|'raw'|'committed'|'unknown';
 receipt?:StudyRuntimeReceiptV1;value?:unknown;value_digest?:string};
export type StudyRuntimeNumericPlanV1=Omit<StudyRuntimeStepPlanV1,'kind'>&{kind:'numeric';fit_plan_digest:string};
export type StudyRuntimeNumericComputedV1={value:StudyRuntimeNumericV1;manifest_json:string;manifest_sha256:string;
 artifacts:Array<{name:string;file:string;sha256:string;size_bytes:number}>;dispose():Promise<void>};
export type StudyRuntimeStoredNumericV1={value:StudyRuntimeNumericV1;value_digest:string;manifest_json:string;manifest_sha256:string;verified:true}
 |{status:'pending';manifest_sha256:string};
export type StudyRuntimeStageDependencyV1={kind:'sonnet_step'|'numeric_checkpoint'|'jev_batch';key:string;digest:string};
export type StudyRuntimeJevCacheV1={question_key:string;identity_digest:string;state_sha256:string;jev_call_id:string;answer:JevAnswerV1;
 receipt_page:{page_id:string;sha256:string;verified:true}};
export type StudyRuntimeJevBatchPlanV1={contract_version:'signal-study-jev-batch-v1';execution_id:string;workspace_id:string;
 source_digest:string;stage:string;model:'jev-1.13.0';stage_configuration:SignalListeningConfigurationV1;stage_configuration_digest:string;stage_dependencies:StudyRuntimeStageDependencyV1[];requests:Array<{root_id:string;request_body:string;request_sha256:string}>;plan_digest:string};
export type StudyRuntimeJevBatchCheckpointV1={batch_id:string;plan_digest:string;
 status:'planned'|'running'|'completed'|'outcome_unknown'|'stale'|'budget_exhausted';checkpoint_digest:string;
 results:Array<{root_id:string;request_sha256:string;call_id:string;complete:boolean;http_status:number;
 receipt_page:{page_id:string;sha256:string;verified:true};response:unknown}>};
/** Cache identity is individual question + exact input/model, not an unrelated
 * global configuration revision. A human edit invalidates only that identity. */
export function studyRuntimeJevQuestionIdentityV1(request:JevRequestV1,key:string){
 if(!request.questions[key])throw Error('study_runtime_question_missing');
 return digest({contract_version:'signal-study-jev-question-identity-v1',model:request.model,state:request.state,key,question:request.questions[key]});
}
export type StudyRuntimeStoreV1={
 claim(execution_id:string):Promise<StudyRuntimeLeaseV1|null>;
 renew(lease:StudyRuntimeLeaseV1):Promise<boolean>;release(lease:StudyRuntimeLeaseV1):Promise<void>;
 source(lease:StudyRuntimeLeaseV1):Promise<StudyRuntimeSourceV1|null>;
 /** CPU is separate from the paid send journal. Null means NO immutable intent.
  * Pending/verified intents recover remote custody only; never trigger a refit.
  * persistNumeric stages/readbacks ALL artifacts before inserting that intent. */
 numericCheckpoint(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeNumericPlanV1):Promise<StudyRuntimeStoredNumericV1|null>;
 persistNumeric(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeNumericPlanV1,value:StudyRuntimeNumericComputedV1):Promise<StudyRuntimeStoredNumericV1>;
 /** Native H1 consumer owner: immutable plan, per-identity financial admission,
  * partial cached answers, page-custody/batch-settlement and memory/rate gates.
  * Preparing/reloading MUST NOT reset sent/unknown calls or reserve them again. */
 prepareJevBatch(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeJevBatchPlanV1):Promise<{batch_id:string;plan_digest:string}|null>;
 jevBatchCheckpoint(lease:StudyRuntimeLeaseV1,batch_id:string):Promise<StudyRuntimeJevBatchCheckpointV1|null>;
 /** Existing journal is immutable. Reading and every CAS validate owner/source.
  * plan MUST NOT turn sent/unknown back into planned or reserve a second call. */
 step(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1):Promise<StudyRuntimeStepV1|null>;
 plan(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1):Promise<StudyRuntimeStepV1|null>;
 markSent(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1):Promise<'sent'|'stale'|'budget_exhausted'>;
 /** Upload + readback custody survives ACK loss. Recovery step() exposes raw;
  * must accept observed bytes for reconciliation even after worker lease loss. */
 persistReceipt(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1,receipt:StudyRuntimeReceiptV1):Promise<void>;
 settle(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1):Promise<'settled'|'unknown'>;
 commit(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1,value:unknown,value_digest:string):Promise<boolean>;
 /** Retains receipt/money, never installs a fabricated technical response. */
 unknown(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1,code:string):Promise<void>;
 finish(lease:StudyRuntimeLeaseV1,output:StudyRuntimeOutputV1,output_digest:string):Promise<boolean>;
};
export type StudyRuntimeNumericV1={plan_digest:string;groups:Array<{key:string;root_ids:string[]}>;unassigned_root_ids:string[]};
export type StudyRuntimeDriversV1={
 /** Uses the SAME native H1 shared-account factory/calibration, RPS/TPS,
  * cohort concurrency, memory bounds, page receipts and batch settlement as
  * Listening. Reads persisted plan by ID; no per-root artifacts or retries.
  * Must stop new sends on lease/flag loss and drain/custody admitted siblings. */
 runJevBatch(args:{lease:StudyRuntimeLeaseV1;batch_id:string;plan_digest:string;signal:AbortSignal;should_stop:()=>boolean}):Promise<void>;
 preflight(plan:StudyRuntimeStepPlanV1):Promise<void>;
 /** One physical HTTP request, zero SDK retries, receipt even for truncation.
  * Sonnet transport must enforce claude-sonnet-4-6, no global key fallback. */
 send(plan:StudyRuntimeStepPlanV1,signal:AbortSignal):Promise<StudyRuntimeReceiptV1>;
 /** Only the existing numerical BERTopic path, sealed cached vectors, no LLM,
  * no Voyage/import and no invented groups. Persist artifacts before returning. */
 fit(args:{lease:StudyRuntimeLeaseV1;numeric_plan:StudyRuntimeNumericPlanV1;fit_plan:ReturnType<typeof buildSignalStudyMotiveFitPlanV1>;signal:AbortSignal}):Promise<StudyRuntimeNumericComputedV1>;
};
export type StudyRuntimeOutputV1={contract_version:'signal-study-runtime-output-v1';status:'directional';source_digest:string;
 configuration_digest:string;summary:ReturnType<typeof buildSignalStudySummaryV1>;query_bias:ReturnType<typeof signalStudyQueryBiasV1>;
 stability:ReturnType<typeof signalStudyLayerStabilityV1>|null;dominance:ReturnType<typeof signalStudyDominancePlanV1>|null;
 verified_evidence:ReturnType<typeof verifySignalStudyVerbatimV1>[];insufficient_group_keys:string[];
 promotion:{status:'explicit_action_required';automatic:false}};
class Paused extends Error {constructor(readonly status:string,readonly progress?:{batch_id:string;completed:number;total:number}){super(status);}}
const sha=(value:string|Buffer)=>'sha256:'+createHash('sha256').update(value).digest('hex');
function fail(code:string):never{throw Error('study_runtime_'+code);}
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;
function receiptBody(receipt:StudyRuntimeReceiptV1):string{
 const bytes=Buffer.from(receipt.body_base64,'base64');
 if(bytes.toString('base64')!==receipt.body_base64||bytes.length!==receipt.body_bytes||bytes.length>8*1024*1024||sha(bytes)!==receipt.sha256)fail('receipt_invalid');
 if(!receipt.complete||receipt.http_status!==200)throw new Paused('outcome_unknown');
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new Paused('outcome_unknown');}
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

/** Runs only an already admitted owner. Restart replays pure derivation from
 * immutable committed steps; a physical ambiguous outcome never gets resent.
 * No latest-Listening update or automatic Brand OS promotion is possible. */
export async function signalStudyRuntimeJobV1(execution_id:string,options:{store:StudyRuntimeStoreV1;drivers:StudyRuntimeDriversV1;
 should_stop?:()=>boolean;renewal_ms?:number}){
 if(!uuid.test(execution_id))fail('execution_invalid');
 const {store,drivers}=options,claimed=await store.claim(execution_id);if(!claimed)return{status:'not_claimed'};
 const lease:StudyRuntimeLeaseV1=claimed;
 const abort=new AbortController();let lost=false,renewal:Promise<void>|undefined;
 const interval=options.renewal_ms??30_000;
 if(interval<1||interval>60_000||!Number.isSafeInteger(interval)){await store.release(lease);fail('renewal_invalid');}
 const timer=setInterval(()=>{if(renewal||lost)return;renewal=store.renew(lease).then(ok=>{if(!ok){lost=true;abort.abort();}})
  .catch(()=>{lost=true;abort.abort();}).finally(()=>{renewal=undefined;});},interval);timer.unref?.();
 const active=async()=>{if(renewal)await renewal;if(lost||options.should_stop?.())throw new Paused(lost?'lease_lost':'stopped');};
 try{
  if(lease.execution_id!==execution_id||!uuid.test(lease.workspace_id)||!uuid.test(lease.execution_token))fail('lease_invalid');
  const raw=await store.source(lease);if(!raw)throw new Paused('stale');
  const configuration=validateSignalStudyExecutionConfigurationV1(raw.configuration),{source_digest,...source}=raw;
  if(source_digest!==digest(source)||source_digest!==lease.source_digest||digest(configuration)!==lease.configuration_digest
   ||raw.human_revision_digest!==lease.human_revision_digest||configuration.study.workspace_id!==lease.workspace_id)fail('source_binding_invalid');
  if(!Number.isSafeInteger(raw.max_roots)||raw.max_roots<1||raw.roots.length>raw.max_roots||!Number.isSafeInteger(raw.max_bytes)
   ||raw.max_bytes<1||Buffer.byteLength(JSON.stringify(raw))>raw.max_bytes||!raw.sampling_seed)fail('source_bound_exceeded');
  const selection=raw.selection;
  if(selection?.scope!=='listening_consumer_cut'||selection.source_listening_digest!==configuration.source_listening.configuration_digest
   ||selection.cut_digest!==digest(configuration.study.cut)||selection.eligible_root_ids_digest!==digest(raw.roots.map(r=>r.root_id).sort())
   ||selection.eligible_roots!==raw.roots.length||!Number.isSafeInteger(selection.pending_base_roots)||selection.pending_base_roots<0
   ||!Number.isSafeInteger(selection.corpus_roots)||selection.corpus_roots<selection.eligible_roots+selection.pending_base_roots)fail('selection_binding_invalid');
  if(selection.pending_base_roots)throw new Paused('awaiting_base');
  if(new Set(raw.roots.map(r=>r.root_id)).size!==raw.roots.length||raw.roots.some(r=>!uuid.test(r.embedding_proof.embedding_call_id)
   ||!uuid.test(r.embedding_proof.embedding_run_id)||r.embedding_proof.vector_digest!==digest(r.vector)
   ||r.embedding_proof.text_sha256!==(r.selected_fragment?.text_sha256??r.text_sha256)))fail('cached_vector_proof_invalid');
  for(const r of raw.roots){
   const fragment=r.selected_fragment;
   if(!r.root_id||!r.text.trim()||sha(r.text)!==r.text_sha256||!Number.isFinite(Date.parse(r.occurred_at))||!r.channel.trim()||r.vector.length!==1024||r.vector.some(v=>!Number.isFinite(v))
    ||!Number.isFinite(Math.hypot(...r.vector))||Math.abs(Math.hypot(...r.vector)-1)>.0001
    ||fragment&&(!Number.isSafeInteger(fragment.start)||!Number.isSafeInteger(fragment.end)||fragment.start<0||fragment.end<=fragment.start
     ||fragment.end>r.text.length||r.text.slice(fragment.start,fragment.end)!==fragment.text||sha(fragment.text)!==fragment.text_sha256))fail('cached_source_invalid');
   if(r.question_cache&&(new Set(r.question_cache.map(c=>c.identity_digest)).size!==r.question_cache.length
    ||r.question_cache.some(c=>!uuid.test(c.jev_call_id)||!uuid.test(c.receipt_page.page_id)||c.receipt_page.verified!==true
     ||!/^sha256:[a-f0-9]{64}$/u.test(c.receipt_page.sha256)||![r.text_sha256,r.selected_fragment?.text_sha256].includes(c.state_sha256))))fail('question_cache_binding_invalid');
  }

  const dependencies=new Map<string,StudyRuntimeStageDependencyV1>();
  const dependency=(d:StudyRuntimeStageDependencyV1)=>dependencies.set(d.kind+':'+d.key,d);
  async function step<T>(stage:string,kind:StudyRuntimeStepPlanV1['kind'],request_body:string,interpret:(value:unknown)=>T,
   ):Promise<T>{
   const request_sha256=sha(request_body),plan={key:digest({execution_id,source_digest,stage,request_sha256}),kind,request_body,request_sha256,source_digest};
   let journal=await store.step(lease,plan);
   if(!journal){await active();journal=await store.plan(lease,plan);}
   if(!journal)throw new Paused('stale');
   if(journal.key!==plan.key||journal.request_sha256!==plan.request_sha256||journal.request_body!==request_body||journal.kind!==kind||journal.source_digest!==source_digest)fail('journal_binding_invalid');
   if(journal.status==='committed'){
    if(journal.value_digest!==digest(journal.value))fail('checkpoint_invalid');dependency({kind:'sonnet_step',key:plan.key,digest:journal.value_digest});return interpret(journal.value);
   }
   if(journal.status==='unknown'||journal.status==='sent')throw new Paused('outcome_unknown');
   if(journal.status==='planned'){
    await active();await drivers.preflight(plan);await active();
    const marked=await store.markSent(lease,plan);if(marked!=='sent')throw new Paused(marked);
    // Nothing after this boundary may retry the physical operation. Even an ACK
    // lost from markSent leaves sent in the native journal and blocks a resend.
    let receipt:StudyRuntimeReceiptV1;
    try{
     receipt=await drivers.send(plan,abort.signal);
    }catch(error){await store.unknown(lease,plan,'study_physical_outcome_unknown').catch(()=>undefined);throw error;}
    await store.persistReceipt(lease,plan,receipt);journal=await store.step(lease,plan);
    if(!journal?.receipt||journal.status!=='raw'||digest(journal.receipt)!==digest(receipt))throw new Paused('receipt_pending');
   }
   if(journal.status!=='raw'||!journal.receipt)throw new Paused('receipt_pending');
   let value:unknown;
   try{value=JSON.parse(receiptBody(journal.receipt));}catch(error){await store.unknown(lease,plan,'study_response_unknown').catch(()=>undefined);throw error;}
   if(await store.settle(lease,plan)!=='settled')throw new Paused('outcome_unknown');
   await active();let result:T;
   try{result=interpret(value);}catch(error){await store.unknown(lease,plan,'study_response_invalid').catch(()=>undefined);throw error;}
   if(!await store.commit(lease,plan,value,digest(value)))throw new Paused('stale');dependency({kind:'sonnet_step',key:plan.key,digest:digest(value)});return result;
  }
  const sourceById=new Map(raw.roots.map(root=>[root.root_id,root]));
  async function jevBatch(stage:string,inputs:Array<{root_id:string;request:JevRequestV1}>,stage_configuration:SignalListeningConfigurationV1){
   const answers=new Map<string,Record<string,JevAnswerV1>>(),requests:StudyRuntimeJevBatchPlanV1['requests']=[];
   for(const {root_id,request}of inputs){
    const cache=sourceById.get(root_id)?.question_cache??[],known:Record<string,JevAnswerV1>={},missing:JevRequestV1['questions']={};
    for(const [key,question]of Object.entries(request.questions)){
     const hit=cache.find(c=>c.question_key===key&&c.identity_digest===studyRuntimeJevQuestionIdentityV1(request,key));
     if(hit)Object.assign(known,jevResponse({...request,questions:{[key]:question}},{model:request.model,answers:{[key]:hit.answer}}));else missing[key]=question;
    }
    answers.set(root_id,known);
    if(Object.keys(missing).length){const request_body=JSON.stringify({...request,questions:missing});requests.push({root_id,request_body,request_sha256:sha(request_body)});}
   }
   if(!requests.length)return answers;
   const body={contract_version:'signal-study-jev-batch-v1' as const,execution_id,workspace_id:lease.workspace_id,source_digest,stage,model:'jev-1.13.0' as const,stage_configuration,stage_configuration_digest:digest(stage_configuration),stage_dependencies:stage==='axes'?[]:[...dependencies.values()].sort((a,b)=>(a.kind+a.key).localeCompare(b.kind+b.key)),requests};
   const plan={...body,plan_digest:digest(body)};await active();const owner=await store.prepareJevBatch(lease,plan);
   if(!owner)throw new Paused('stale');if(!uuid.test(owner.batch_id)||owner.plan_digest!==plan.plan_digest)fail('batch_owner_invalid');
   let checkpoint=await store.jevBatchCheckpoint(lease,owner.batch_id);
   const checked=()=>{
    if(!checkpoint)return;
    const {checkpoint_digest,...value}=checkpoint;
    if(checkpoint.batch_id!==owner.batch_id||checkpoint.plan_digest!==plan.plan_digest||digest(value)!==checkpoint_digest)fail('batch_checkpoint_invalid');
   };
   checked();
   if(checkpoint?.status==='outcome_unknown'||checkpoint?.status==='stale'||checkpoint?.status==='budget_exhausted')throw new Paused(checkpoint.status);
   if(checkpoint?.status!=='completed'){
    await active();await drivers.runJevBatch({lease,batch_id:owner.batch_id,plan_digest:plan.plan_digest,signal:abort.signal,should_stop:()=>lost||Boolean(options.should_stop?.())});
    checkpoint=await store.jevBatchCheckpoint(lease,owner.batch_id);checked();await active();
   }
   if(!checkpoint||checkpoint.status==='planned'||checkpoint.status==='running')throw new Paused('waiting_batch',{batch_id:owner.batch_id,completed:checkpoint?.results.length??0,total:requests.length});
   if(checkpoint.status!=='completed')throw new Paused(checkpoint.status);
   const expected=new Map(requests.map(r=>[r.root_id,r]));
   if(checkpoint.results.length!==expected.size||new Set(checkpoint.results.map(r=>r.root_id)).size!==expected.size)fail('batch_coverage_incomplete');
   for(const row of checkpoint.results){const request=expected.get(row.root_id);
    if(!request||row.request_sha256!==request.request_sha256||!uuid.test(row.call_id)||!uuid.test(row.receipt_page.page_id)
     ||row.receipt_page.verified!==true||!/^sha256:[a-f0-9]{64}$/u.test(row.receipt_page.sha256))fail('batch_custody_invalid');
    if(!row.complete||row.http_status!==200)throw new Paused('outcome_unknown');
    Object.assign(answers.get(row.root_id)!,jevResponse(JSON.parse(request.request_body),row.response));
   }
   dependency({kind:'jev_batch',key:owner.batch_id,digest:checkpoint.checkpoint_digest});return answers;
  }
  const editorial=<T>(stage:string,request:SignalStudyEditorialRequestV1,validate:(request:SignalStudyEditorialRequestV1,value:unknown)=>T)=>
   step(stage,'sonnet',request.request_body,value=>{
    const body=value as {model?:string;content?:Array<{type:string;text?:string}>};
    if(body.model!=='claude-sonnet-4-6'||!Array.isArray(body.content)||body.content.filter(c=>c.type==='text').length!==1)fail('sonnet_response_invalid');
    return validate(request,JSON.parse(body.content!.find(c=>c.type==='text')!.text!));
   });
  const snapshot=configuration.template_snapshot,study=configuration.study;
  // Base answers are native Listening cache only. Never ask/pay voice/promotion.
  const cut=raw.roots.filter(root=>{
   const status=signalStudyConfiguredCutV1({configuration,text:root.text,occurred_at:root.occurred_at,answers:root.base_answers,attributes:root.attributes});
   if(status==='awaiting_base')throw new Paused('awaiting_base');if(status!=='included')fail('native_cut_mismatch');return true;
  });
  const axesAnswers=await jevBatch('axes',cut.map(root=>({root_id:root.root_id,request:buildSignalStudyConfiguredAxesRequestV1({text:root.text},configuration)})),signalStudyJevAxesConfigurationV1(configuration));
  const roots:SignalStudyRootV1[]=cut.map(root=>({...root,axes:resolveSignalStudyConfiguredAxesV1(configuration,axesAnswers.get(root.root_id)!)}));
  assertSignalStudyRootsV1(roots);
  const query_bias=signalStudyQueryBiasV1({query_terms:raw.query_terms,problem_terms:raw.problem_terms,metadata:raw.query_metadata,subject_roots:roots.filter(r=>r.axes.aggregate==='subject').length,brand_baseline_roots:raw.brand_baseline_roots});
  const population=buildSignalStudyMotivePopulationV1(roots),fit=buildSignalStudyMotiveFitPlanV1({study,template_snapshot:snapshot,roots,embedding_space_digest:raw.embedding_space_digest});
  const request_body=JSON.stringify(fit),numericPlan:StudyRuntimeNumericPlanV1={kind:'numeric',fit_plan_digest:fit.plan_digest,source_digest,request_body,request_sha256:sha(request_body),
   key:digest({execution_id,source_digest,stage:'numeric-cpu-v1',request_sha256:sha(request_body)})};
  let checkpoint=await store.numericCheckpoint(lease,numericPlan);
  if(!checkpoint){await active();const computed=await drivers.fit({lease,numeric_plan:numericPlan,fit_plan:fit,signal:abort.signal});
   try{await active();checkpoint=await store.persistNumeric(lease,numericPlan,computed);}finally{await computed.dispose();}
  }
  if('status'in checkpoint)throw new Paused('waiting_numeric');
  if(checkpoint.verified!==true||sha(checkpoint.manifest_json)!==checkpoint.manifest_sha256||digest(checkpoint.value)!==checkpoint.value_digest)fail('numeric_checkpoint_invalid');
  let manifest:StudyNumericManifestV1;try{manifest=JSON.parse(checkpoint.manifest_json);}catch{fail('numeric_checkpoint_invalid');}
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))fail('numeric_checkpoint_invalid');
  if(manifest.contract_version!=='signal-study-numeric-v1'||manifest.source_digest!==source_digest||manifest.request_sha256!==numericPlan.request_sha256
   ||manifest.fit_plan_digest!==fit.plan_digest||manifest.execution_id!==execution_id||manifest.workspace_id!==lease.workspace_id||manifest.study_digest!==configuration.study_digest
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
  const output:StudyRuntimeOutputV1={contract_version:'signal-study-runtime-output-v1',status:'directional',source_digest,configuration_digest:lease.configuration_digest,
   summary:buildSignalStudySummaryV1({study,template_snapshot:snapshot,roots,motives,memberships,cut_root_ids:roots.map(r=>r.root_id),unresolved_root_ids:[]}),
   query_bias,
   stability,dominance,verified_evidence,insufficient_group_keys:discovered.insufficient_group_keys,promotion:{status:'explicit_action_required',automatic:false}};
  await active();if(!await store.finish(lease,output,digest(output)))throw new Paused('stale');return{status:'completed',output};
 }catch(error){if(error instanceof Paused)return{status:error.status,...(error.progress?{progress:error.progress}:{})};throw error;}
 finally{clearInterval(timer);if(renewal)await renewal;await store.release(lease);}
}
