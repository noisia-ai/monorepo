import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_ROLES_V1,createSignalStudyTemplateSnapshotV1,
 buildSignalStudyExecutionConfigurationV1,buildSignalStudyConfiguredAxesRequestV1,signalListeningBaseTemplateV1,signalWorkspaceEmbeddingDigestV1 as digest,
 SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1,SIGNAL_STUDY_EDITORIAL_COMPILER_V2,type SignalStudyEditorialFormatStopV1,type SignalStudyV1} from '@noisia/query-engine';
import type{StudyNumericManifestV1}from'./signal-study-numeric';
import {signalStudyRuntimeJobV1,studyRuntimeJevQuestionIdentityV1,type StudyRuntimeJevBatchPlanV1,type StudyRuntimeJevBatchCheckpointV1,type StudyRuntimeStoreV1,type StudyRuntimeLeaseV1,type StudyRuntimeSourceV1,
 type StudyRuntimeStepV1,type StudyRuntimeStepPlanV1,type StudyRuntimeReceiptV1,type StudyRuntimeOutputV1,type StudyRuntimeNumericComputedV1,type StudyRuntimeNumericPlanV1,type StudyRuntimeStoredNumericV1} from './signal-study-runtime';
const sha=(s:string|Buffer)=>'sha256:'+createHash('sha256').update(s).digest('hex');
const receipt=(value:unknown):StudyRuntimeReceiptV1=>{const b=Buffer.from(JSON.stringify(value));return{body_base64:b.toString('base64'),body_bytes:b.length,sha256:sha(b),complete:true,http_status:200,provider_request_id:'synthetic-request'};};
const choice=(keys:string[],selected:string)=>({type:'choice' as const,choice:selected,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===selected?1:0]))});
function fixture(count=160){
 const execution_id=randomUUID(),workspace_id=randomUUID(),template={...structuredClone(SIGNAL_STUDY_TB_TEMPLATE_V1),version:'saved-runtime-v2'};
 template.diagnostics[1]!.question='Frozen saved monthly diagnostic.';
 const template_snapshot=createSignalStudyTemplateSnapshotV1({template,roles:SIGNAL_STUDY_TB_ROLES_V1,provenance:'human',revision:2,human_locked:true});
 const listening=signalListeningBaseTemplateV1({category:'synthetic bicycles',lexicon_terms:['bicycle']});
 const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id,corpus_id:randomUUID(),listening_configuration_id:randomUUID(),listening_configuration_digest:digest(listening),
  methodology:{key:'triggers_barriers',version:template.version,template_digest:template_snapshot.template_digest},
  subject:{kind:'category',name:'synthetic bicycles',category:'synthetic bicycles',own_brand:'Synthetic brand',competitors:[],alternatives:[]},business_question:'Synthetic forces?',
  cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'America/Sao_Paulo',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:2};
 const configuration=buildSignalStudyExecutionConfigurationV1({study,template_snapshot,source_listening:{configuration_id:study.listening_configuration_id,configuration_digest:study.listening_configuration_digest,configuration:listening}});
 const vector=Array.from({length:1024},(_,i)=>i===0?1:0);
 const body={configuration:structuredClone(configuration),roots:Array.from({length:count},(_,i)=>{const text=`id=${i} I enjoy a bicycle and feel calm with enough time.`;return{root_id:'root_'+i,text,text_sha256:sha(text),vector,
  occurred_at:'2026-02-01T00:00:00Z',channel:'synthetic',source_url:'https://example.com/'+i,listening_topic_keys:['topic'],private_person_names:[],
  base_answers:{voice:choice(['individual','brand'],'individual'),promotion:{type:'noul' as const,noul:.1}},
  embedding_proof:{embedding_call_id:randomUUID(),embedding_run_id:randomUUID(),preparation_run_id:null,input_contract:'synthetic-source',proof_json:'{}',proof_digest:sha('{}'),vector_json:JSON.stringify(vector),vector_digest:digest(vector),text_sha256:sha(text)}};}),
  selection:{scope:'listening_consumer_cut' as const,source_listening_digest:configuration.source_listening.configuration_digest,cut_digest:digest(study.cut),eligible_root_ids_digest:digest(Array.from({length:count},(_,i)=>'root_'+i).sort()),eligible_roots:count,pending_base_roots:0,corpus_roots:83_000},
  source_preparation_run_ids:[],embedding_space_digest:digest('synthetic-vectors'),sampling_seed:'sealed-synthetic-seed',query_terms:['bicycle'],problem_terms:['problem'],brand_baseline_roots:count,human_revision_digest:digest('human-2'),max_roots:1000,max_bytes:8*1024*1024};
 const source:StudyRuntimeSourceV1={...body,source_digest:digest(body)};
 const lease:StudyRuntimeLeaseV1={execution_id,workspace_id,execution_token:randomUUID(),source_digest:source.source_digest,configuration_digest:digest(configuration),human_revision_digest:body.human_revision_digest};
 type LoggedPlan=Omit<StudyRuntimeStepPlanV1,'kind'>&{kind:'jev'|'sonnet'|'numeric'};
 const numericCheckpoints=new Map<string,StudyRuntimeStoredNumericV1>();
 const journal=new Map<string,StudyRuntimeStepV1>(),sends:LoggedPlan[]=[],events:string[]=[];
 const batches=new Map<string,{plan:StudyRuntimeJevBatchPlanV1;status:StudyRuntimeJevBatchCheckpointV1['status'];results:StudyRuntimeJevBatchCheckpointV1['results'];
  raw:Array<{requests:StudyRuntimeJevBatchPlanV1['requests'];receipts:StudyRuntimeReceiptV1[];page_id:string;sha256:string}>}>();
 let inFlight=0,maxInFlight=0,maxBuffered=0,pageWrites=0,batchStop=false,batchRawAck=false,batchIncomplete=false,override=false;
 let output:StudyRuntimeOutputV1|undefined,mark:'sent'|'stale'|'budget_exhausted'='sent',renew=true,preflightError=false,sendError=false,persistAck=false,commitAck=false,finish=true,repair=false,dominant=false,fitCalls=0;
 const store:StudyRuntimeStoreV1={claim:async()=>lease,renew:async()=>renew,release:async()=>{events.push('release');},source:async()=>source,
  numericCheckpoint:async(_l,p)=>numericCheckpoints.get(p.key)??null,
  persistNumeric:async(_l,p,value)=>{const stored={value:value.value,value_digest:digest(value.value),manifest_json:value.manifest_json,manifest_sha256:value.manifest_sha256,verified:true as const};numericCheckpoints.set(p.key,stored);return stored;},
  prepareJevBatch:async(_l,plan)=>{
   assert.equal(plan.stage_configuration_digest,digest(plan.stage_configuration));
   if(plan.stage!=='axes'){assert.ok(plan.stage_dependencies.some(d=>d.kind==='numeric_checkpoint'));assert.ok(plan.stage_dependencies.some(d=>d.kind==='sonnet_step'));}
   let entry=[...batches.entries()].find(([,b])=>b.plan.plan_digest===plan.plan_digest);
   if(!entry){const id=randomUUID(),value={plan,status:'planned' as const,results:[],raw:[]};batches.set(id,value);entry=[id,value];}
   return{batch_id:entry[0],plan_digest:plan.plan_digest};
  },
  jevBatchCheckpoint:async(_l,id)=>{const b=batches.get(id)!;const body={batch_id:id,plan_digest:b.plan.plan_digest,status:b.status,results:b.results};return{...body,checkpoint_digest:digest(body)};},
  step:async(_l,p)=>journal.get(p.key)??null,
  plan:async(_l,p)=>{const value={...p,status:'planned' as const};journal.set(p.key,value);return value;},
  markSent:async(_l,p)=>{events.push('mark');if(mark==='sent')journal.get(p.key)!.status='sent';return mark;},
  persistReceipt:async(_l,p,r)=>{events.push('raw');Object.assign(journal.get(p.key)!,{receipt:r,status:'raw'});if(persistAck){persistAck=false;throw Error('lost raw ACK');}},
  settle:async()=>{events.push('settle');return'settled';},
  commit:async(_l,p,value,value_digest)=>{events.push('commit');Object.assign(journal.get(p.key)!,{status:'committed',value,value_digest});if(commitAck){commitAck=false;throw Error('lost commit ACK');}return true;},
  unknown:async(_l,p)=>{journal.get(p.key)!.status='unknown';},finish:async(_l,value)=>{output=value;return finish;}};
 const physicalSend=async(plan:LoggedPlan):Promise<StudyRuntimeReceiptV1>=>{
   sends.push(plan);events.push('send');if(sendError)throw Error('physical timeout');const body=JSON.parse(plan.request_body);
   if(plan.kind==='jev'){
    const id=Number(/id=(\d+)/u.exec(body.state)?.[1]);
    const answers=Object.fromEntries(Object.entries(body.questions as Record<string,{type:string;criteria:Record<string,unknown>}>).map(([key,q])=>{
     if(q.type==='choice'){const selected=key==='study_direction'?(id%2?'barrier':'trigger'):key==='study_target'?'category':'literal';return[key,choice(Object.keys(q.criteria),selected)];}
     const probability=dominant?(key==='force_a'?.9:.1):key===(id%2?'force_b':'force_a')?.9:.1;
     return[key,{type:'noul',noul:probability}];
    }));return receipt({model:'jev-1.13.0',answers,usage:{input_tokens:10,output_tokens:5}});
   }
   const payload=JSON.parse(body.messages[0].content).untrusted_data,input_digest=digest(payload);let value:unknown;
   if(payload.contract_version==='signal-study-reconciliation-input-v2')value={contract_version:'signal-study-reconciliation-output-v2',input_digest,clusters:payload.candidates.map((c:{candidate_id:string})=>({representative_id:c.candidate_id,member_ids:[c.candidate_id]}))};
   else if(payload.purpose==='rewrite_layer_boundary_rules')value={contract_version:SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1,input_digest,rules:payload.boundary_keys.map((motive_key:string)=>({motive_key,contrast_rule:'Separate the private counterfactual force from a resource constraint; never infer layer from shared vocabulary.',reason:'The original counterfactual diagnostics differed.'}))};
   else if(payload.groups)value={contract_version:'signal-study-motive-output-v1',input_digest,insufficient_group_keys:[],motives:payload.groups.map((g:{group_key:string;rows:Array<{root_id:string}>},i:number)=>({key:i?'motive_b':'motive_a',name:'Synthetic force '+i,definition:'Synthetic force evidence '+i,group_keys:[g.group_key],evidence_root_ids:[g.rows[0]!.root_id]}))};
   else if(payload.affected_keys){dominant=false;value={contract_version:'signal-study-contrast-output-v1',input_digest,definitions:payload.motives.map((m:{key:string;sample:Array<{root_id:string}>})=>({key:m.key,name:'Contrasted force',definition:'A narrower synthetic force',contrast_reason:'Synthetic contrast',evidence_root_ids:[m.sample[0]!.root_id]}))};}
   else{const passB=payload.motives[0].sampling.independence==='disjoint'&&sends.filter(p=>p.kind==='sonnet'&&p.request_body.includes('"diagnostics"')).length%2===0;
    value={contract_version:'signal-study-layer-output-v1',input_digest,motives:payload.motives.map((m:{key:string;name:string;partition_keys?:string[];sample:Array<{root_id:string;text:string}>})=>{
     const a=m.key==='motive_a'||Boolean(m.partition_keys&&m.name==='Synthetic force 0'),layer=repair&&!payload.contrast_rule&&passB?(a?'personal':'psychological'):(a?'psychological':'personal');
     return{motive_key:m.key,partitions:[{key:m.partition_keys?.[0]??(a?'force_a':'force_b'),name:'Partition '+m.key,definition:'Evidence-backed synthetic force',sample_root_ids:m.sample.map(r=>r.root_id),layer,
      diagnostics:payload.diagnostics.map((d:{key:string;layer:string})=>({key:d.key,result:d.layer===layer?'yes':'no',force_disappears_without:d.layer===layer,reason:'Synthetic counterfactual'})),
      evidence:{root_id:m.sample[0]!.root_id,quote:'feel calm',private_person_names:[]},normative_evidence:null,permission_override:override&&a?{permission:'partial',reason:'Exact stored analyst justification.'}:null}]};})};
   }
   return receipt({model:'claude-sonnet-4-6',content:[{type:'text',text:JSON.stringify(value)}],usage:{input_tokens:10,output_tokens:5}});
  };
 const drivers={preflight:async()=>{if(preflightError)throw Error('not ready');},
  send:(plan:StudyRuntimeStepPlanV1)=>physicalSend(plan),
  fit:async(args:{numeric_plan:StudyRuntimeNumericPlanV1;fit_plan:{plan_digest:string;configuration:unknown;rows:Array<{root_id:string}>}}):Promise<StudyRuntimeNumericComputedV1>=>{
   fitCalls++;const plan=args.fit_plan,value={plan_digest:plan.plan_digest,groups:plan.rows.length?[{key:'group_a',root_ids:plan.rows.filter(r=>Number(r.root_id.slice(5))%2===0).map(r=>r.root_id)},
    {key:'group_b',root_ids:plan.rows.filter(r=>Number(r.root_id.slice(5))%2===1).map(r=>r.root_id)}].filter(g=>g.root_ids.length):[],unassigned_root_ids:[]};
   const manifest:StudyNumericManifestV1={contract_version:'signal-study-numeric-v1',workspace_id,execution_id,source_digest:source.source_digest,study_digest:source.configuration.study_digest,cut_digest:digest(source.configuration.study.cut),
    request_sha256:args.numeric_plan.request_sha256,fit_plan_digest:plan.plan_digest,numeric_config:plan.configuration as StudyNumericManifestV1['numeric_config'],numeric_config_digest:digest(plan.configuration),seed_digest:digest(source.sampling_seed),
    embedding_space_digest:source.embedding_space_digest,proof_census_digest:digest(plan.rows.map(r=>r.root_id)),source_proofs_sha256:digest('synthetic-source-proofs'),
    source_preparation_run_ids:[],preparation_unknown_root_ids:plan.rows.map(r=>r.root_id),preparation_unknown_count:plan.rows.length,
    root_count:plan.rows.length,grouped_count:value.groups.reduce((n,g)=>n+g.root_ids.length,0),unassigned_count:value.unassigned_root_ids.length,status:plan.rows.length?'completed':'empty',
    input_manifest_sha256:digest('synthetic-input'),output_manifest_sha256:plan.rows.length?digest('synthetic-output'):null,groups:value.groups,unassigned_root_ids:value.unassigned_root_ids,artifacts:[]};
   const manifest_json=JSON.stringify(manifest);
   return{value,manifest_json,manifest_sha256:sha(manifest_json),artifacts:[],dispose:async()=>{}};
  },
  runJevBatch:async(args:{batch_id:string;signal:AbortSignal;should_stop:()=>boolean})=>{
   const b=batches.get(args.batch_id)!;if(preflightError)throw Error('not ready');
   if(mark!=='sent'){b.status=mark;return;}
   const isUnknown=()=>b.status==='outcome_unknown';
   const applyPages=()=>{let unknown=false;
    for(const page of b.raw){
     for(const [i,request]of page.requests.entries())if(!b.results.some(r=>r.root_id===request.root_id)){
      const observed=page.receipts[i]!;if(!observed.complete||observed.http_status!==200){unknown=true;continue;}b.results.push({root_id:request.root_id,request_sha256:request.request_sha256,call_id:randomUUID(),complete:true,http_status:200,
       receipt_page:{page_id:page.page_id,sha256:page.sha256,verified:true},response:JSON.parse(Buffer.from(observed.body_base64,'base64').toString('utf8'))});
     }
    }b.raw=[];if(unknown)b.status='outcome_unknown';return !unknown;
   };
   if(!applyPages())return;b.status='running';
   let pending:StudyRuntimeJevBatchPlanV1['requests']=[],receipts:StudyRuntimeReceiptV1[]=[];
   const flush=()=>{if(!pending.length)return;const page={requests:pending,receipts,page_id:randomUUID(),sha256:digest(receipts)};
    b.raw.push(page);pageWrites++;events.push('jev_page');pending=[];receipts=[];
    if(batchRawAck){batchRawAck=false;throw Error('lost page raw ACK');}applyPages();events.push('jev_settle_batch');
   };
   const missing=b.plan.requests.filter(r=>!b.results.some(v=>v.root_id===r.root_id));
   for(let offset=0;offset<missing.length;offset+=4){
    if(args.signal.aborted||args.should_stop())break;
    // HTTP concurrency only. Custody, settlement and apply happen ONCE per page.
    const cohort=missing.slice(offset,offset+4),observed=await Promise.all(cohort.map(async request=>{
     inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
     try{await new Promise(resolve=>setTimeout(resolve,1));const r=await physicalSend({key:digest({batch:args.batch_id,root:request.root_id}),kind:'jev',source_digest:b.plan.source_digest,request_body:request.request_body,request_sha256:request.request_sha256});
      return batchIncomplete&&request.root_id===b.plan.requests[0]?.root_id?{...r,complete:false}:r;
     }catch{return{body_base64:'',body_bytes:0,sha256:sha(''),complete:false,http_status:null,provider_request_id:null};}
     finally{inFlight--;}
    }));
    pending.push(...cohort);receipts.push(...observed);maxBuffered=Math.max(maxBuffered,pending.length);
    if(pending.length>=8||args.signal.aborted||offset+4>=missing.length)flush();
    if(isUnknown())return;if(batchStop&&pageWrites){batchStop=false;return;}
   }
   flush();if(!isUnknown()&&b.results.length===b.plan.requests.length)b.status='completed';
  },
 };
 return{execution_id,lease,source,journal,sends,events,store,drivers,batches,get output(){return output;},get fitCalls(){return fitCalls;},
  get maxInFlight(){return maxInFlight;},get maxBuffered(){return maxBuffered;},get pageWrites(){return pageWrites;},
  set batchStop(v:boolean){batchStop=v;},set batchRawAck(v:boolean){batchRawAck=v;},set batchIncomplete(v:boolean){batchIncomplete=v;},set override(v:boolean){override=v;},
  set mark(v:typeof mark){mark=v;},set renew(v:boolean){renew=v;},set preflightError(v:boolean){preflightError=v;},set sendError(v:boolean){sendError=v;},
  set persistAck(v:boolean){persistAck=v;},set commitAck(v:boolean){commitAck=v;},set finish(v:boolean){finish=v;},set repair(v:boolean){repair=v;},set dominant(v:boolean){dominant=v;}};
}

test('automatic saved-template pipeline pools directions, blind samples, cached vectors and directional output; restart sends nothing',async()=>{
 const f=fixture(),result=await signalStudyRuntimeJobV1(f.execution_id,f);assert.equal(result.status,'completed');assert.equal(f.fitCalls,1);assert.ok(f.maxInFlight>=2);assert.ok(f.maxBuffered<=8);assert.equal(f.pageWrites,40);
 assert.equal(f.source.selection.corpus_roots,83_000);assert.equal(f.source.roots.length,160); // Outside vectors are neither requested nor required.
 assert.equal(f.output?.summary.denominator,160);assert.equal(f.output?.stability?.kappa,1);assert.equal(f.output?.promotion.automatic,false);
 const jev=f.sends.filter(s=>s.kind==='jev');assert.equal(jev.length,320);for(const p of jev){const q=JSON.parse(p.request_body).questions;assert.equal('voice'in q,false);assert.equal('promotion'in q,false);assert.ok(Object.keys(q).length<=4);}
 const layers=f.sends.filter(p=>p.kind==='sonnet').map(p=>JSON.parse(JSON.parse(p.request_body).messages[0].content).untrusted_data).filter(p=>p.diagnostics);
 assert.equal(layers.length,2);assert.equal(layers[0].diagnostics[1].question,'Frozen saved monthly diagnostic.');
 for(let i=0;i<2;i++){const a=layers[0].motives[i].sample,b=layers[1].motives[i].sample;assert.equal(a.length,40);assert.equal(b.length,40);assert.equal(new Set([...a,...b].map(r=>r.root_id)).size,80);}
 assert.ok(f.output!.verified_evidence.length>=4);assert.equal(f.output!.summary.status,'directional');const count=f.sends.length;
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');assert.equal(f.sends.length,count);assert.equal(f.fitCalls,1);
 assert.ok(f.events.indexOf('raw')<f.events.indexOf('settle'));assert.ok(f.events.indexOf('settle')<f.events.indexOf('commit'));
});
test('CAS, preflight and cap block all physical requests',async()=>{
 for(const mark of ['stale','budget_exhausted']as const){const f=fixture(2);f.mark=mark;assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,mark);assert.equal(f.sends.length,0);}
 const f=fixture(2);f.preflightError=true;await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/not ready/);assert.equal(f.sends.length,0);assert.equal(f.events.includes('mark'),false);
});
test('physical ambiguity never resends, while lost raw/commit ACK recovers original paid response',async()=>{
 const f=fixture(2);f.sendError=true;assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');f.sendError=false;
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal(f.sends.length,2);
 for(const flag of ['persistAck','commitAck']as const){const g=fixture(0); // No paid calls in the empty control.
  assert.equal((await signalStudyRuntimeJobV1(g.execution_id,g)).status,'completed');
  const h=fixture();h[flag]=true;await assert.rejects(signalStudyRuntimeJobV1(h.execution_id,h),/lost .* ACK/);
  const first=h.sends[0]!.key;await signalStudyRuntimeJobV1(h.execution_id,h);assert.equal(h.sends.filter(p=>p.key===first).length,1);
 }
});
test('invalid complete flag or UTF-8 remains unknown even if JSON body could parse',async()=>{
 for(const mode of ['incomplete','invalid_utf8']as const){const f=fixture(),send=f.drivers.send;
  f.drivers.send=async p=>{const r=await send(p);if(mode==='incomplete')return{...r,complete:false};const b=Buffer.from([255]);return{...r,body_base64:b.toString('base64'),body_bytes:1,sha256:sha(b)};};
  assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,1);
 }
});
test('frozen source mismatch, base pending and human CAS win without publication',async()=>{
 const f=fixture(2);f.source.configuration.question_configuration.instructions='Mutated';await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/binding_invalid/);assert.equal(f.sends.length,0);
 const g=fixture(2);g.source.roots[0]!.base_answers={};const {source_digest:_old,...body}=g.source;g.source.source_digest=digest(body);g.lease.source_digest=g.source.source_digest;
 assert.equal((await signalStudyRuntimeJobV1(g.execution_id,g)).status,'awaiting_base');assert.equal(g.sends.length,0);
 const h=fixture(0);h.finish=false;assert.equal((await signalStudyRuntimeJobV1(h.execution_id,h)).status,'stale');
});
test('one boundary repair uses two new blind requests and dominance only reasks affected motive keys',async()=>{
 const f=fixture();f.repair=true;f.dominant=true;assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 const payloads=f.sends.filter(p=>p.kind==='sonnet').map(p=>JSON.parse(JSON.parse(p.request_body).messages[0].content).untrusted_data);
 assert.equal(payloads.filter(p=>p.diagnostics).length,4);assert.equal(payloads.filter(p=>p.diagnostics&&p.contrast_rule).length,2);
 assert.equal(f.output?.stability?.kappa,1);const contrast=payloads.find(p=>p.affected_keys);assert.deepEqual(contrast.affected_keys,['force_a']);
 const requests=f.sends.filter(p=>p.kind==='jev').map(p=>JSON.parse(p.request_body));assert.equal(requests.filter(r=>Object.keys(r.questions).join(',')==='force_a').length,160);
});
function sealSource(f:ReturnType<typeof fixture>){const{source_digest:_old,...body}=f.source;f.source.source_digest=digest(body);f.lease.source_digest=f.source.source_digest;}
test('individual question cache survives unrelated configuration revisions and emits only missing questions',async()=>{
 const f=fixture();for(const [i,root]of f.source.roots.entries()){
  const request=buildSignalStudyConfiguredAxesRequestV1({text:root.text},f.source.configuration),answer=choice(['trigger','barrier','mixed','none'],i%2?'barrier':'trigger');
  root.question_cache=[{question_key:'study_direction',identity_digest:studyRuntimeJevQuestionIdentityV1(request,'study_direction'),state_sha256:root.text_sha256,jev_call_id:randomUUID(),answer,
   receipt_page:{page_id:randomUUID(),sha256:digest('saved-page'),verified:true}}];
 }
 const c=f.source.configuration;c.study.revision++;c.study_digest=digest(c.study);c.question_configuration.study_digest=c.study_digest;c.question_configuration.revision++;
 c.question_configuration_digest=digest(c.question_configuration);f.lease.configuration_digest=digest(c);sealSource(f);
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 assert.equal(f.sends.filter(p=>p.kind==='jev'&&p.request_body.includes('study_direction')).length,0);
 const axes=f.sends.filter(p=>p.kind==='jev'&&p.request_body.includes('study_target'));assert.equal(axes.length,160);
 for(const p of axes)assert.equal(Object.keys(JSON.parse(p.request_body).questions).length,2);
 const g=fixture(2);g.source.roots[0]!.question_cache=[{question_key:'study_direction',identity_digest:digest('old'),state_sha256:'wrong',jev_call_id:randomUUID(),answer:{type:'noul',noul:0},receipt_page:{page_id:randomUUID(),sha256:digest('page'),verified:true}}];sealSource(g);
 await assert.rejects(signalStudyRuntimeJobV1(g.execution_id,g),/question_cache_binding_invalid/);assert.equal(g.sends.length,0);
 const h=fixture(2);h.source.roots[0]!.vector=Array(1024).fill(0);h.source.roots[0]!.embedding_proof.vector_digest=digest(h.source.roots[0]!.vector);sealSource(h);
 await assert.rejects(signalStudyRuntimeJobV1(h.execution_id,h),/cached_source_invalid/);assert.equal(h.sends.length,0);
});
test('lease expiration drains its HTTP cohort to page custody and admits no next cohort',async()=>{
 const f=fixture();f.renew=false;
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,{...f,renewal_ms:1})).status,'lease_lost');
 assert.ok(f.sends.length<=4);assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,0);assert.equal(f.events.includes('commit'),false);assert.equal(f.output,undefined);
 if(f.sends.length)assert.ok(f.pageWrites>=1);
});
test('numerical output cannot invent roots or omit members from the sealed pooled census',async()=>{
 const f=fixture(2);const fit=f.drivers.fit;f.drivers.fit=async args=>{const result=await fit(args),value={plan_digest:args.fit_plan.plan_digest,groups:[{key:'invented',root_ids:['unseen-root']}],unassigned_root_ids:['another-unseen-root']};
  const manifest=JSON.parse(result.manifest_json);Object.assign(manifest,{groups:value.groups,unassigned_root_ids:value.unassigned_root_ids,grouped_count:1,unassigned_count:1});
  const manifest_json=JSON.stringify(manifest);return{...result,value,manifest_json,manifest_sha256:sha(manifest_json)};};
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/numeric_population_invalid/);
 assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,0);assert.equal(f.output,undefined);
});
test('lost markSent ACK never causes HTTP and native cut/count/bounds remain mandatory',async()=>{
 const f=fixture(),mark=f.store.markSent;f.store.markSent=async(...args)=>{await mark(...args);throw Error('lost sent ACK');};
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/lost sent ACK/);assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,0);
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,0);
 const g=fixture(2);g.source.selection.eligible_roots=1;sealSource(g);await assert.rejects(signalStudyRuntimeJobV1(g.execution_id,g),/selection_binding_invalid/);assert.equal(g.sends.length,0);
 const h=fixture(2);h.source.max_bytes=100;sealSource(h);await assert.rejects(signalStudyRuntimeJobV1(h.execution_id,h),/source_bound_exceeded/);assert.equal(h.sends.length,0);
 const i=fixture(2);i.source.roots[0]!.base_answers.promotion={type:'noul',noul:.9};sealSource(i);
 await assert.rejects(signalStudyRuntimeJobV1(i.execution_id,i),/native_cut_mismatch/);assert.equal(i.sends.length,0);
});

test('partial durable batch pauses; restart reuses committed page and never repeats its HTTP',async()=>{
 const f=fixture();f.batchStop=true;const paused=await signalStudyRuntimeJobV1(f.execution_id,f);assert.equal(paused.status,'waiting_batch');assert.equal('progress'in paused?paused.progress?.completed:undefined,8);
 assert.equal(f.output,undefined);assert.equal(f.sends.length,8);assert.equal(f.pageWrites,1);
 const first=f.sends.map(p=>p.key);assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 for(const key of first)assert.equal(f.sends.filter(p=>p.key===key).length,1);assert.ok(f.maxInFlight>=2);assert.ok(f.maxBuffered<=8);
 assert.equal([...f.journal.values()].some(p=>(p.kind as string)==='jev'),false);assert.equal(f.pageWrites,40);
});
test('page raw ACK loss replays page settlement without HTTP; incomplete batch is never auto resent',async()=>{
 const f=fixture();f.batchRawAck=true;await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/lost page raw ACK/);
 const first=f.sends.map(p=>p.key);assert.equal(f.pageWrites,1);assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 for(const key of first)assert.equal(f.sends.filter(p=>p.key===key).length,1);
 const g=fixture();g.batchIncomplete=true;assert.equal((await signalStudyRuntimeJobV1(g.execution_id,g)).status,'outcome_unknown');assert.equal([...g.batches.values()][0]!.results.length,7);const count=g.sends.length;
 assert.equal((await signalStudyRuntimeJobV1(g.execution_id,g)).status,'outcome_unknown');assert.equal(g.sends.length,count);assert.equal(g.output,undefined);
});
test('stable explicit permission override keeps the exact recorded reason in final summary',async()=>{
 const f=fixture();f.override=true;assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 const motive=f.output!.summary.motives.find(m=>m.key==='force_a')!;assert.equal(motive.permission,'partial');assert.equal(motive.permission_overridden,true);
 assert.equal(motive.permission_override_reason,'Exact stored analyst justification.');
});

test('shutdown closes batch admission between cohorts and drains the admitted cohort as a page',async()=>{
 const f=fixture();assert.equal((await signalStudyRuntimeJobV1(f.execution_id,{...f,should_stop:()=>f.sends.length>=4})).status,'stopped');
 assert.equal(f.sends.length,4);assert.equal(f.pageWrites,1);assert.equal(f.output,undefined);assert.equal(f.sends.some(p=>p.kind==='sonnet'),false);
});
test('numeric CPU has no paid journal; a crash before intent can refit, but a pending immutable intent cannot',async()=>{
 const f=fixture(0),fit=f.drivers.fit;let attempts=0;
 f.drivers.fit=async args=>{attempts++;if(attempts===1)throw Error('free CPU crash before intent');return fit(args);};
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/free CPU crash/);
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');assert.equal(attempts,2);
 assert.equal(f.events.includes('mark'),false);assert.equal(f.journal.size,0);assert.equal(f.sends.length,0);
 const g=fixture(0);g.store.numericCheckpoint=async()=>({status:'pending',manifest_sha256:digest('planned-custody')});
 assert.equal((await signalStudyRuntimeJobV1(g.execution_id,g)).status,'waiting_numeric');assert.equal(g.fitCalls,0);assert.equal(g.events.includes('mark'),false);
});
test('numeric verified checkpoint survives lost persistence ACK with no refit and closes local artifact handles',async()=>{
 const f=fixture(0),persist=f.store.persistNumeric,fit=f.drivers.fit;let disposed=0,first=true;
 f.drivers.fit=async args=>{const result=await fit(args);return{...result,dispose:async()=>{disposed++;}};};
 f.store.persistNumeric=async(...args)=>{const result=await persist(...args);if(first){first=false;throw Error('lost numeric checkpoint ACK');}return result;};
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/lost numeric checkpoint ACK/);assert.equal(disposed,1);
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');assert.equal(f.fitCalls,1);assert.equal(f.events.includes('mark'),false);
});

test('numeric checkpoint rejects rehashed value-only or manifest-only group swaps and inconsistent sealed counts/config before Sonnet',async()=>{
 for(const tamper of ['value_groups','manifest_groups','root_count','grouped_count','unassigned_count','empty_status','insufficient_status','numeric_config']as const){
  const f=fixture(),persist=f.store.persistNumeric;
  f.store.persistNumeric=async(...args)=>{const checkpoint=structuredClone(await persist(...args));assert.ok('verified'in checkpoint);
   const manifest=JSON.parse(checkpoint.manifest_json)as StudyNumericManifestV1;
   if(tamper==='value_groups'){const groups=checkpoint.value.groups;[groups[0]!.root_ids,groups[1]!.root_ids]=[groups[1]!.root_ids,groups[0]!.root_ids];checkpoint.value_digest=digest(checkpoint.value);}
   if(tamper==='manifest_groups')[manifest.groups[0]!.root_ids,manifest.groups[1]!.root_ids]=[manifest.groups[1]!.root_ids,manifest.groups[0]!.root_ids];
   if(tamper==='root_count')manifest.root_count++;if(tamper==='grouped_count')manifest.grouped_count--;if(tamper==='unassigned_count')manifest.unassigned_count++;
   if(tamper==='empty_status')manifest.status='empty';if(tamper==='insufficient_status')manifest.status='insufficient_population';
   if(tamper==='numeric_config')(manifest.numeric_config as{seed:number}).seed++;
   checkpoint.manifest_json=JSON.stringify(manifest);checkpoint.manifest_sha256=sha(checkpoint.manifest_json);return checkpoint;
  };
  await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/study_runtime_numeric_/,'must reject '+tamper);
  assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,0,tamper);assert.equal(f.output,undefined,tamper);assert.equal(f.journal.size,0,tamper);
 }
});
test('empty numeric census cannot be relabeled completed by rehashing its manifest',async()=>{
 const f=fixture(0),persist=f.store.persistNumeric;f.store.persistNumeric=async(...args)=>{const checkpoint=await persist(...args);assert.ok('verified'in checkpoint);
  const manifest=JSON.parse(checkpoint.manifest_json);manifest.status='completed';checkpoint.manifest_json=JSON.stringify(manifest);checkpoint.manifest_sha256=sha(checkpoint.manifest_json);return checkpoint;};
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/study_runtime_numeric_/);assert.equal(f.sends.length,0);assert.equal(f.output,undefined);
});

test('flag flip during markSent preserves the sent reservation and prevents physical handoff; restart never resends it',async()=>{
 const f=fixture(),mark=f.store.markSent;let stopped=false,physicalBeforeMark=0;
 f.store.markSent=async(...args)=>{const result=await mark(...args);physicalBeforeMark=f.sends.length;stopped=true;return result;};
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,{...f,should_stop:()=>stopped})).status,'stopped');
 assert.equal(f.sends.length,physicalBeforeMark,'no physical operation after the flag flipped inside the awaited CAS');
 assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,0);
 const sent=[...f.journal.values()];assert.equal(sent.length,1);assert.equal(sent[0]!.status,'sent');assert.equal(sent[0]!.receipt,undefined);
 assert.ok(f.events.includes('release'));assert.equal(f.output,undefined);
 stopped=false;
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,{...f,should_stop:()=>stopped})).status,'outcome_unknown');
 assert.equal(f.sends.length,physicalBeforeMark);assert.equal([...f.journal.values()][0]!.status,'sent');
});

test('native receipt persistence reports unknown or sent as outcome_unknown before pending custody and never retries',async()=>{
 for(const state of['unknown','sent']as const){
  const f=fixture(),persist=f.store.persistReceipt,send=f.drivers.send;let settlements=0;
  f.drivers.send=async(...args)=>({...await send(...args),http_status:529,complete:false});
  f.store.persistReceipt=async(...args)=>{await persist(...args);f.journal.get(args[1].key)!.status=state;};
  f.store.settle=async()=>{settlements++;return'settled';};
  assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown',state);
  const count=f.sends.length;assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,1);
  assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown',state);
  assert.equal(f.sends.length,count);assert.equal(settlements,0);assert.equal(f.output,undefined);
 }
 const mismatch=fixture(),persist=mismatch.store.persistReceipt;let settlements=0;
 mismatch.store.persistReceipt=async(...args)=>{await persist(...args);const journal=mismatch.journal.get(args[1].key)!;
  journal.receipt={...journal.receipt!,sha256:'sha256:'+'0'.repeat(64)};};
 mismatch.store.settle=async()=>{settlements++;return'settled';};
 assert.equal((await signalStudyRuntimeJobV1(mismatch.execution_id,mismatch)).status,'receipt_pending');assert.equal(settlements,0);
});

function batchingFixture(){
 const f=fixture(),stops:SignalStudyEditorialFormatStopV1[]=[];
 f.source.editorial_compiler_version=SIGNAL_STUDY_EDITORIAL_COMPILER_V2;sealSource(f);
 f.store.recordFormatStop=async(_lease,stop)=>{stops.push(stop);};
 return{f,stops};
}
test('V2 discovery reconciles all local motives and uses identical canonical stages across restart',async()=>{
 const{f,stops}=batchingFixture();const result=await signalStudyRuntimeJobV1(f.execution_id,f);
 assert.equal(result.status,'completed');assert.equal(stops.length,0);assert.equal(f.output?.summary.denominator,160);assert.equal(f.output?.stability?.kappa,1);
 const sonnet=f.sends.filter(s=>s.kind==='sonnet');assert.equal(sonnet.length,4);
 const payloads=sonnet.map(s=>JSON.parse(JSON.parse(s.request_body).messages[0].content).untrusted_data);
 assert.equal(payloads.filter(p=>p.contract_version==='signal-study-reconciliation-input-v2').length,1);
 assert.equal(payloads.filter(p=>p.groups).flatMap(p=>p.groups).length,2);
 assert.equal(f.journal.size,4);const keys=[...f.journal.keys()].sort();
 const count=f.sends.length;assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');assert.equal(f.sends.length,count);assert.equal(f.fitCalls,1);assert.deepEqual([...f.journal.keys()].sort(),keys);
});
test('V2 preflights an oversized indivisible sample before any Sonnet and preserves complete cut',async()=>{
 const{f,stops}=batchingFixture();for(const root of f.source.roots){root.text+=' '+ 'x'.repeat(14000);root.text_sha256=sha(root.text);root.embedding_proof.text_sha256=root.text_sha256;}sealSource(f);
 const result=await signalStudyRuntimeJobV1(f.execution_id,f);assert.equal(result.status,'format_stop');assert.equal(stops.length,1);
 assert.equal(stops[0]!.reason,'request_bytes');assert.ok(stops[0]!.observed>524288);assert.equal(f.sends.filter(s=>s.kind==='sonnet').length,0);assert.equal(f.journal.size,0);
 assert.equal(f.source.roots.length,160);assert.equal(f.source.selection.eligible_roots,160);assert.equal(f.fitCalls,1);
 const before=f.sends.length;assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'format_stop');assert.equal(f.sends.length,before);assert.equal(f.fitCalls,1);
});
test('V2 requires durable format-stop authority before any batch or physical send',async()=>{
 const{f}=batchingFixture();delete f.store.recordFormatStop;
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/native_format_stop_store_required/u);assert.equal(f.sends.length,0);assert.equal(f.batches.size,0);assert.equal(f.fitCalls,0);
});

test('native deferred source completes the same methodology without inlining fit vectors and always disposes private custody',async()=>{
 const{createStudySourcePagesV1,bindStudySourcePagesV1}=await import('./signal-study-source-pages');
 const f=fixture(),pages=await createStudySourcePagesV1();
 try{
  for(const root of [...f.source.roots].sort((a,b)=>a.root_id<b.root_id?-1:a.root_id>b.root_id?1:0))await pages.append(root,{root_id:root.root_id});
  const done=await pages.finish(),{roots:_roots,source_digest:_digest,...oldHeader}=f.source,header={...oldHeader,source_storage:done.manifest};
  f.source.roots=done.roots;f.source.source_storage=done.manifest;f.source.source_digest=digest(header);f.lease.source_digest=f.source.source_digest;bindStudySourcePagesV1(f.source,pages);
  const fit=f.drivers.fit;let observed=false;
  f.drivers.fit=async args=>{const value=JSON.parse(args.numeric_plan.request_body);assert.equal(value.contract_version,'signal-study-motive-fit-plan-v2');assert.equal(value.vector_storage,'native_paged_cache');assert.ok(value.rows.every((row:Record<string,unknown>)=>!Object.hasOwn(row,'vector')));observed=true;return fit(args);};
  const result=await signalStudyRuntimeJobV1(f.execution_id,f);assert.equal(result.status,'completed');assert.equal(observed,true);assert.equal(f.output?.summary.denominator,160);assert.equal(f.output?.stability?.kappa,1);
  assert.throws(()=>done.roots[0]!.text,/disposed/);assert.throws(()=>pages.diagnostics(),/disposed/);
 }finally{await pages.dispose();}
});

test('new source rewrites boundary rules once before two blind recoders and restart reuses the journal',async()=>{
 const{f}=batchingFixture();f.source.layer_boundary_rule_version=SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1;sealSource(f);f.repair=true;
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 const sent=f.sends.filter(p=>p.kind==='sonnet').map(plan=>({plan,payload:JSON.parse(JSON.parse(plan.request_body).messages[0].content).untrusted_data}));
 const rules=sent.filter(x=>x.payload.purpose==='rewrite_layer_boundary_rules');assert.equal(rules.length,1);
 assert.equal(rules[0]!.payload.configuration_digest,digest(f.source.configuration));assert.equal(rules[0]!.payload.motives.length,2);
 assert.ok(rules[0]!.payload.motives.every((m:{initial_assessments:Array<{pass:string}>})=>m.initial_assessments.map(x=>x.pass).join(',')==='a,b'));
 const recoders=sent.filter(x=>x.payload.contrast_rule);assert.equal(recoders.length,2);
 for(const coder of recoders){assert.ok(!('initial_assessments'in coder.payload));assert.equal(coder.payload.contrast_rule.includes('Separate the private counterfactual'),true);assert.ok(JSON.parse(coder.payload.contrast_rule).rules.every((r:object)=>!('reason'in r)&&!('initial_assessments'in r)));assert.ok(sent.indexOf(coder)>sent.indexOf(rules[0]!));}
 assert.equal(f.output?.stability?.kappa,1);const count=f.sends.length;
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');assert.equal(f.sends.length,count);
});
test('new boundary-rule RAW ACK recovery never resends and invalid rules cannot publish',async()=>{
 const{f}=batchingFixture();f.source.layer_boundary_rule_version=SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1;sealSource(f);f.repair=true;
 const persist=f.store.persistReceipt;let interrupted=false;
 f.store.persistReceipt=async(...args)=>{await persist(...args);if(!interrupted&&args[1].request_body.includes('rewrite_layer_boundary_rules')){interrupted=true;throw Error('lost boundary raw ACK');}};
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/lost boundary raw ACK/);assert.equal(f.output,undefined);
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 assert.equal(f.sends.filter(p=>p.kind==='sonnet'&&p.request_body.includes('rewrite_layer_boundary_rules')).length,1);
 const{f:g}=batchingFixture();g.source.layer_boundary_rule_version=SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1;sealSource(g);g.repair=true;
 const send=g.drivers.send;g.drivers.send=async plan=>{const raw=await send(plan);if(!plan.request_body.includes('rewrite_layer_boundary_rules'))return raw;
  const value=JSON.parse(Buffer.from(raw.body_base64,'base64').toString('utf8'));const parsed=JSON.parse(value.content[0].text);parsed.rules[0].motive_key='outside_boundary';value.content[0].text=JSON.stringify(parsed);return receipt(value);};
 await assert.rejects(signalStudyRuntimeJobV1(g.execution_id,g),/boundary_rule_scope_invalid/);assert.equal(g.output,undefined);
 const before=g.sends.length;assert.equal((await signalStudyRuntimeJobV1(g.execution_id,g)).status,'outcome_unknown');assert.equal(g.sends.length,before);
 assert.equal(g.sends.filter(p=>p.kind==='sonnet'&&JSON.parse(JSON.parse(p.request_body).messages[0].content).untrusted_data.contrast_rule).length,0);
});
