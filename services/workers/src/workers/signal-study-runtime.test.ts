import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_ROLES_V1,createSignalStudyTemplateSnapshotV1,
 buildSignalStudyExecutionConfigurationV1,buildSignalStudyConfiguredAxesRequestV1,signalListeningBaseTemplateV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalStudyV1} from '@noisia/query-engine';
import {signalStudyRuntimeJobV1,type StudyRuntimeStoreV1,type StudyRuntimeLeaseV1,type StudyRuntimeSourceV1,
 type StudyRuntimeStepV1,type StudyRuntimeStepPlanV1,type StudyRuntimeReceiptV1,type StudyRuntimeOutputV1} from './signal-study-runtime';
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
  embedding_proof:{embedding_call_id:randomUUID(),embedding_run_id:randomUUID(),vector_digest:digest(vector),text_sha256:sha(text)}};}),
  selection:{scope:'listening_consumer_cut' as const,source_listening_digest:configuration.source_listening.configuration_digest,cut_digest:digest(study.cut),eligible_root_ids_digest:digest(Array.from({length:count},(_,i)=>'root_'+i).sort()),eligible_roots:count,pending_base_roots:0,corpus_roots:83_000},
  embedding_space_digest:digest('synthetic-vectors'),sampling_seed:'sealed-synthetic-seed',query_terms:['bicycle'],problem_terms:['problem'],brand_baseline_roots:count,human_revision_digest:digest('human-2'),max_roots:1000,max_bytes:8*1024*1024};
 const source:StudyRuntimeSourceV1={...body,source_digest:digest(body)};
 const lease:StudyRuntimeLeaseV1={execution_id,workspace_id,execution_token:randomUUID(),source_digest:source.source_digest,configuration_digest:digest(configuration),human_revision_digest:body.human_revision_digest};
 const journal=new Map<string,StudyRuntimeStepV1>(),sends:StudyRuntimeStepPlanV1[]=[],events:string[]=[];
 let output:StudyRuntimeOutputV1|undefined,mark:'sent'|'stale'|'budget_exhausted'='sent',renew=true,preflightError=false,sendError=false,persistAck=false,commitAck=false,finish=true,repair=false,dominant=false,fitCalls=0;
 const store:StudyRuntimeStoreV1={claim:async()=>lease,renew:async()=>renew,release:async()=>{events.push('release');},source:async()=>source,
  step:async(_l,p)=>journal.get(p.key)??null,
  plan:async(_l,p)=>{const value={...p,status:'planned' as const};journal.set(p.key,value);return value;},
  markSent:async(_l,p)=>{events.push('mark');if(mark==='sent')journal.get(p.key)!.status='sent';return mark;},
  persistReceipt:async(_l,p,r)=>{events.push('raw');Object.assign(journal.get(p.key)!,{receipt:r,status:'raw'});if(persistAck){persistAck=false;throw Error('lost raw ACK');}},
  settle:async()=>{events.push('settle');return'settled';},
  commit:async(_l,p,value,value_digest)=>{events.push('commit');Object.assign(journal.get(p.key)!,{status:'committed',value,value_digest});if(commitAck){commitAck=false;throw Error('lost commit ACK');}return true;},
  unknown:async(_l,p)=>{journal.get(p.key)!.status='unknown';},finish:async(_l,value)=>{output=value;return finish;}};
 const drivers={preflight:async()=>{if(preflightError)throw Error('not ready');},
  fit:async(plan:{plan_digest:string;rows:Array<{root_id:string}>})=>{fitCalls++;return{plan_digest:plan.plan_digest,
   groups:plan.rows.length?[{key:'group_a',root_ids:plan.rows.filter(r=>Number(r.root_id.slice(5))%2===0).map(r=>r.root_id)},
    {key:'group_b',root_ids:plan.rows.filter(r=>Number(r.root_id.slice(5))%2===1).map(r=>r.root_id)}].filter(g=>g.root_ids.length):[],unassigned_root_ids:[]};},
  send:async(plan:StudyRuntimeStepPlanV1)=>{
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
   if(payload.groups)value={contract_version:'signal-study-motive-output-v1',input_digest,insufficient_group_keys:[],motives:payload.groups.map((g:{group_key:string;rows:Array<{root_id:string}>},i:number)=>({key:i?'motive_b':'motive_a',name:'Synthetic force '+i,definition:'Synthetic force evidence '+i,group_keys:[g.group_key],evidence_root_ids:[g.rows[0]!.root_id]}))};
   else if(payload.affected_keys){dominant=false;value={contract_version:'signal-study-contrast-output-v1',input_digest,definitions:payload.motives.map((m:{key:string;sample:Array<{root_id:string}>})=>({key:m.key,name:'Contrasted force',definition:'A narrower synthetic force',contrast_reason:'Synthetic contrast',evidence_root_ids:[m.sample[0]!.root_id]}))};}
   else{const passB=payload.motives[0].sampling.independence==='disjoint'&&sends.filter(p=>p.kind==='sonnet'&&p.request_body.includes('"diagnostics"')).length%2===0;
    value={contract_version:'signal-study-layer-output-v1',input_digest,motives:payload.motives.map((m:{key:string;sample:Array<{root_id:string;text:string}>})=>{
     const a=m.key==='motive_a',layer=repair&&!payload.contrast_rule&&passB?(a?'personal':'psychological'):(a?'psychological':'personal');
     return{motive_key:m.key,partitions:[{key:a?'force_a':'force_b',name:'Partition '+m.key,definition:'Evidence-backed synthetic force',sample_root_ids:m.sample.map(r=>r.root_id),layer,
      diagnostics:payload.diagnostics.map((d:{key:string;layer:string})=>({key:d.key,result:d.layer===layer?'yes':'no',force_disappears_without:d.layer===layer,reason:'Synthetic counterfactual'})),
      evidence:{root_id:m.sample[0]!.root_id,quote:'feel calm',private_person_names:[]},normative_evidence:null,permission_override:null}]};})};
   }
   return receipt({model:'claude-sonnet-4-6',content:[{type:'text',text:JSON.stringify(value)}],usage:{input_tokens:10,output_tokens:5}});
  }};
 return{execution_id,lease,source,journal,sends,events,store,drivers,get output(){return output;},get fitCalls(){return fitCalls;},
  set mark(v:typeof mark){mark=v;},set renew(v:boolean){renew=v;},set preflightError(v:boolean){preflightError=v;},set sendError(v:boolean){sendError=v;},
  set persistAck(v:boolean){persistAck=v;},set commitAck(v:boolean){commitAck=v;},set finish(v:boolean){finish=v;},set repair(v:boolean){repair=v;},set dominant(v:boolean){dominant=v;}};
}

test('automatic saved-template pipeline pools directions, blind samples, cached vectors and directional output; restart sends nothing',async()=>{
 const f=fixture(),result=await signalStudyRuntimeJobV1(f.execution_id,f);assert.equal(result.status,'completed');assert.equal(f.fitCalls,1);
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
 const f=fixture(2);f.sendError=true;await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/physical timeout/);f.sendError=false;
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal(f.sends.length,1);
 for(const flag of ['persistAck','commitAck']as const){const g=fixture(0); // No paid calls in the empty control.
  assert.equal((await signalStudyRuntimeJobV1(g.execution_id,g)).status,'completed');
  const h=fixture();h[flag]=true;await assert.rejects(signalStudyRuntimeJobV1(h.execution_id,h),/lost .* ACK/);
  const first=h.sends[0]!.key;await signalStudyRuntimeJobV1(h.execution_id,h);assert.equal(h.sends.filter(p=>p.key===first).length,1);
 }
});
test('invalid complete flag or UTF-8 remains unknown even if JSON body could parse',async()=>{
 for(const mode of ['incomplete','invalid_utf8']as const){const f=fixture(2),send=f.drivers.send;
  f.drivers.send=async p=>{const r=await send(p);if(mode==='incomplete')return{...r,complete:false};const b=Buffer.from([255]);return{...r,body_base64:b.toString('base64'),body_bytes:1,sha256:sha(b)};};
  assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal(f.sends.length,1);assert.equal(f.events.includes('settle'),false);
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
test('matching persisted axes cache avoids new axes charges; an incompatible cache and bad vector fail before transport',async()=>{
 const f=fixture();for(const [i,root]of f.source.roots.entries())root.axes_cache={jev_call_id:randomUUID(),text_sha256:root.text_sha256,request_sha256:sha(JSON.stringify(buildSignalStudyConfiguredAxesRequestV1({text:root.text},f.source.configuration))),question_configuration_digest:f.source.configuration.question_configuration_digest,
  answers:{study_direction:choice(['trigger','barrier','mixed','none'],i%2?'barrier':'trigger'),study_target:choice(['category','own_brand','competitor_brand','alternative'],'category'),study_use:choice(['literal','figurative_or_ironic','other'],'literal')}};
 sealSource(f);assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'completed');
 assert.equal(f.sends.filter(p=>p.kind==='jev'&&p.request_body.includes('study_direction')).length,0);assert.equal(f.sends.filter(p=>p.kind==='jev').length,160);
 const g=fixture(2);g.source.roots[0]!.axes_cache={jev_call_id:randomUUID(),text_sha256:'wrong',request_sha256:'wrong',question_configuration_digest:digest('wrong-config'),answers:{}};sealSource(g);
 await assert.rejects(signalStudyRuntimeJobV1(g.execution_id,g),/axes_cache_binding_invalid/);assert.equal(g.sends.length,0);
 const h=fixture(2);h.source.roots[0]!.vector=Array(1024).fill(0);h.source.roots[0]!.embedding_proof.vector_digest=digest(h.source.roots[0]!.vector);sealSource(h);
 await assert.rejects(signalStudyRuntimeJobV1(h.execution_id,h),/cached_source_invalid/);assert.equal(h.sends.length,0);
});
test('lease expiration drains observed receipt but authorizes no further sends or interpretation',async()=>{
 const f=fixture(2),send=f.drivers.send;f.renew=false;
 f.drivers.send=async plan=>{const observed=await send(plan);await new Promise(resolve=>setTimeout(resolve,12));return observed;};
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,{...f,renewal_ms:1})).status,'lease_lost');
 assert.equal(f.sends.length,1);assert.equal(f.journal.values().next().value?.status,'raw');assert.equal(f.events.includes('commit'),false);assert.equal(f.output,undefined);
});
test('numerical output cannot invent roots or omit members from the sealed pooled census',async()=>{
 const f=fixture(2);f.drivers.fit=async plan=>({plan_digest:plan.plan_digest,groups:[{key:'invented',root_ids:['unseen-root']}],unassigned_root_ids:[]});
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/numeric_population_invalid/);
 assert.equal(f.sends.filter(p=>p.kind==='sonnet').length,0);assert.equal(f.output,undefined);
});
test('lost markSent ACK never causes HTTP and native cut/count/bounds remain mandatory',async()=>{
 const f=fixture(2),mark=f.store.markSent;f.store.markSent=async(...args)=>{await mark(...args);throw Error('lost sent ACK');};
 await assert.rejects(signalStudyRuntimeJobV1(f.execution_id,f),/lost sent ACK/);assert.equal(f.sends.length,0);
 assert.equal((await signalStudyRuntimeJobV1(f.execution_id,f)).status,'outcome_unknown');assert.equal(f.sends.length,0);
 const g=fixture(2);g.source.selection.eligible_roots=1;sealSource(g);await assert.rejects(signalStudyRuntimeJobV1(g.execution_id,g),/selection_binding_invalid/);assert.equal(g.sends.length,0);
 const h=fixture(2);h.source.max_bytes=100;sealSource(h);await assert.rejects(signalStudyRuntimeJobV1(h.execution_id,h),/source_bound_exceeded/);assert.equal(h.sends.length,0);
 const i=fixture(2);i.source.roots[0]!.base_answers.promotion={type:'noul',noul:.9};sealSource(i);
 await assert.rejects(signalStudyRuntimeJobV1(i.execution_id,i),/native_cut_mismatch/);assert.equal(i.sends.length,0);
});
