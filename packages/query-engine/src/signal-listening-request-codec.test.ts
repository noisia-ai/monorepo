import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {signalWorkspaceEmbeddingDigestV1 as legacyDigest} from './signal-workspace-embeddings-v1';
import {SIGNAL_LISTENING_REQUEST_VERSION_V1,signalListeningBaseTemplateV1,compileSignalListeningSnapshotV1,
 readSignalListeningSnapshotV1,signalListeningSnapshotWorkV1,buildSignalListeningCompiledRequestV1,
 buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,validateSignalListeningConfigurationV1,type SignalListeningInputV1,type SignalListeningConfigurationV1} from './signal-listening-contracts';
import type {JevRequestV1} from './signal-mention-facets-jev-v1';

const run={id:'run-é-é-😀',entity_context_digest:'sha256:context'};
function configuration(){
 const base=signalListeningBaseTemplateV1({category:'bicycles café é',lexicon_terms:['bike','é','é']});
 return{...base,instructions:'  rules “é” é 😀 \\ / \n\t "quoted"  ',questions:[...base.questions,...['a0','a_0','z0','z_0'].map(key=>({key,type:'choice' as const,text:`¿${key} café é 😀?`,scope:'consumer_category' as const,origin:'brand_os' as const,human_locked:false,
  options:[{key:'a0',definition:'é\n"quoted"'},{key:'a_0',definition:'é\\😀'}]}))]};
}
function input(keys=['voice','promotion']):SignalListeningInputV1{return{root_id:'root',input_digest:'sha256:input',text:'  root text é é 😀\n"\\  ',title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01',language:'es',map_id:'map',configuration_digest:'sha256:configuration',question_keys:keys,
 question_digests:Object.fromEntries(keys.map(k=>[k,'sha256:'+k])),scope_basis:Object.fromEntries(keys.filter(k=>!['voice','promotion'].includes(k)).map(k=>[k,'basis:'+k]))};}
function baseline(r:typeof run,i:SignalListeningInputV1,q:JevRequestV1){return legacyDigest({request_version:SIGNAL_LISTENING_REQUEST_VERSION_V1,run_id:r.id,root_id:i.root_id,input_digest:i.input_digest,entity_context_digest:r.entity_context_digest,question_digests:i.question_digests,scope_basis:i.scope_basis,request:q});}
function oldBytes(value:unknown):string{
 const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v;
 return JSON.stringify(ordered(value));
}

test('compiled codec preserves full legacy digest and original HTTP wire bytes for every subset and config version',()=>{
 const base=configuration();assert.notDeepEqual(['a0','a_0'].sort(),['a0','a_0'].sort((a,b)=>a.localeCompare(b)));
 for(const config of [base,{...base,instructions:base.instructions+' new version',questions:base.questions.slice().reverse()}]){
  const snapshot=compileSignalListeningSnapshotV1(config),work=signalListeningSnapshotWorkV1(snapshot),keys=config.questions.map(q=>q.key);
  for(let mask=1;mask<(1<<keys.length);mask++){
   const selected=keys.filter((_,n)=>mask&(1<<n)).reverse(),i=input(selected),q=buildSignalListeningCompiledRequestV1(i,snapshot),old=buildSignalListeningJevRequestV1(i,config);
   assert.equal(JSON.stringify(q),JSON.stringify(old));assert.deepEqual(Buffer.from(JSON.stringify(q)),Buffer.from(JSON.stringify(old)));
   assert.equal(signalListeningRequestDigestV1(run,i,q),baseline(run,i,old));
   assert.equal(signalListeningRequestDigestV1(run,i,q),'sha256:'+createHash('sha256').update(oldBytes({request_version:SIGNAL_LISTENING_REQUEST_VERSION_V1,run_id:run.id,root_id:i.root_id,input_digest:i.input_digest,entity_context_digest:run.entity_context_digest,question_digests:i.question_digests,scope_basis:i.scope_basis,request:old})).digest('hex'));
   assert.equal(Object.isFrozen(q),false);assert.equal(Object.isFrozen(q.questions),false);assert.equal(Object.isFrozen(q.questions[selected[0]!]!),false);
  }
  assert.deepEqual(signalListeningSnapshotWorkV1(snapshot),work);assert.equal(readSignalListeningSnapshotV1(snapshot).configuration.model,'jev-1.13.0');
 }
});

test('each root, state, input digest, scope, question digest and run context stays live on every call',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration()),i=input(['a_0','a0']),q=buildSignalListeningCompiledRequestV1(i,snapshot);
 const before=signalListeningRequestDigestV1(run,i,q);
 for(const [r,next]of [[{...run,id:'another'},i],[{...run,entity_context_digest:'another'},i],[run,{...i,root_id:'another'}],[run,{...i,input_digest:'another'}],[run,{...i,question_digests:{a0:'another',a_0:'digest'}}],[run,{...i,scope_basis:{a0:'new base'}}]] as const){
  const actual=signalListeningRequestDigestV1(r,next,q);assert.equal(actual,baseline(r,next,q));assert.notEqual(actual,before);
 }
 q.state='changed root state';assert.equal(signalListeningRequestDigestV1(run,i,q),baseline(run,i,q));assert.notEqual(signalListeningRequestDigestV1(run,i,q),before);
 const fresh=compileSignalListeningSnapshotV1({...configuration(),instructions:'Changed instructions'}),next=buildSignalListeningCompiledRequestV1(i,fresh);assert.notEqual(signalListeningRequestDigestV1(run,i,next),before);
});

test('mutable requests, plain clones and caller JSON/toJSON never gain private provenance',()=>{
 const config=configuration(),snapshot=compileSignalListeningSnapshotV1(config),i=input(['a0','a_0','voice']);
 const change:Array<(q:JevRequestV1)=>void>=[q=>{q.model='other';},q=>{q.state=null;},q=>{q.questions.a0!.instructions={rules:'changed'};},q=>{q.questions.a0!.criteria={a0:'changed'};},q=>{delete q.questions.a0;},q=>{q.questions.extra=q.questions.voice!;},q=>{Object.setPrototypeOf(q.questions.a0!,null);},q=>{Object.defineProperty(q.questions.a0!,'toJSON',{enumerable:true,value:()=>({caller:'owned hook'})});},q=>{Object.defineProperty(q.questions.a0!.criteria!,'toJSON',{enumerable:true,value:()=>({caller:'nested hook'})});}];
 for(const mutate of change){const q=buildSignalListeningCompiledRequestV1(i,snapshot);mutate(q);assert.equal(signalListeningRequestDigestV1(run,i,q),baseline(run,i,q));}
 for(const q of [buildSignalListeningJevRequestV1(i,config),structuredClone(buildSignalListeningCompiledRequestV1(i,snapshot)),JSON.parse(JSON.stringify(buildSignalListeningCompiledRequestV1(i,snapshot))) as JevRequestV1])assert.equal(signalListeningRequestDigestV1(run,i,q),baseline(run,i,q));
 const original=JSON.stringify(buildSignalListeningCompiledRequestV1(i,snapshot));const mutable=buildSignalListeningCompiledRequestV1(i,snapshot);(mutable.questions.voice!.instructions as {rules:string}).rules='changed';assert.equal(JSON.stringify(buildSignalListeningCompiledRequestV1(i,snapshot)),original);
});

test('getters on request/question/criteria and dynamic digests or basis are evaluated exactly as the old digest',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration());
 for(const where of ['request','wire','criteria','digests','basis']as const){
  const make=()=>{const i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot);let reads=0;
   const getter=()=>{reads++;if(where==='digests'||where==='basis')(q.questions.voice!.instructions as {rules:string}).rules='mutated '+reads;return 'getter '+reads;};
   if(where==='request')Object.defineProperty(q,'state',{get:getter,enumerable:true,configurable:true});
   if(where==='wire')Object.defineProperty(q.questions.voice!,'instructions',{get:getter,enumerable:true,configurable:true});
   if(where==='criteria')Object.defineProperty(q.questions.voice!.criteria!,'individual',{get:getter,enumerable:true,configurable:true});
   if(where==='digests')Object.defineProperty(i.question_digests,'voice',{get:getter,enumerable:true,configurable:true});
   if(where==='basis')Object.defineProperty(i.scope_basis,'voice',{get:getter,enumerable:true,configurable:true});
   return{i,q,reads:()=>reads};};
  const a=make(),b=make();assert.equal(signalListeningRequestDigestV1(run,a.i,a.q),baseline(run,b.i,b.q));assert.equal(a.reads(),b.reads());assert.equal(a.reads(),1);
 }
});

test('nested proxies, custom prototypes, nulls, cycles and old errors use the original fallback without extra observations',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration());
 for(const where of ['request','questions','wire','criteria','digests','basis']as const){
  const make=()=>{const i=input();let q=buildSignalListeningCompiledRequestV1(i,snapshot),observations=0;const handler={ownKeys(target:object){observations++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target:object,k:PropertyKey){observations++;return Reflect.getOwnPropertyDescriptor(target,k);},get(target:object,k:PropertyKey,receiver:unknown){observations++;return Reflect.get(target,k,receiver);}};
   const proxy=<T extends object>(value:T)=>new Proxy<T>(value,handler);
   if(where==='request')q=proxy(q);if(where==='questions')q.questions=proxy(q.questions);if(where==='wire')q.questions.voice=proxy(q.questions.voice!);if(where==='criteria')q.questions.voice!.criteria=proxy(q.questions.voice!.criteria!);if(where==='digests')i.question_digests=proxy(i.question_digests);if(where==='basis')i.scope_basis=proxy(i.scope_basis);
   return{i,q,observations:()=>observations};};
  const a=make(),b=make();assert.equal(signalListeningRequestDigestV1(run,a.i,a.q),baseline(run,b.i,b.q));assert.equal(a.observations(),b.observations());
 }
 for(const value of [null,undefined,7,BigInt(7),{self:null}]as unknown[]){
  const i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot);q.state=value;
  if(value&&typeof value==='object')(value as {self:unknown}).self=value;
  let expected:unknown;try{expected=baseline(run,i,q);}catch(e){expected=e;}
  if(expected instanceof Error)assert.throws(()=>signalListeningRequestDigestV1(run,i,q),{name:expected.name,message:expected.message});else assert.equal(signalListeningRequestDigestV1(run,i,q),expected);
 }
 const q=buildSignalListeningCompiledRequestV1(input(),snapshot);Object.defineProperty(q.questions.voice!.criteria!,'individual',{get(){throw new TypeError('same caller failure');},enumerable:true});assert.throws(()=>signalListeningRequestDigestV1(run,input(),q),{name:'TypeError',message:'same caller failure'});
});

test('large snapshot cache overflow preserves the full configured set and original clone/digest behavior',()=>{
 const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bike']}),config={...base,questions:[...base.questions,...Array.from({length:24},(_,n)=>({key:'large_'+String(n).padStart(2,'0'),type:'choice' as const,text:'large '+n,scope:'all' as const,origin:'brand_os' as const,human_locked:false,options:Array.from({length:32},(_,k)=>({key:'option_'+k,definition:'😀'.repeat(400)}))}))]};
 const snapshot=compileSignalListeningSnapshotV1(config),i=input(['large_23','voice']),q=buildSignalListeningCompiledRequestV1(i,snapshot),old=buildSignalListeningJevRequestV1(i,config);assert.equal(JSON.stringify(q),JSON.stringify(old));assert.equal(signalListeningRequestDigestV1(run,i,q),baseline(run,i,old));assert.equal(readSignalListeningSnapshotV1(snapshot).configuration.questions.length,26);
});

test('ignored symbols, non-enumerable hooks, prototypes and revoked proxies retain old observations/errors',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration());
 for(const kind of ['hidden','symbol','prototype']as const){
  const i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot);let calls=0;const getter=()=>{calls++;throw new Error('must remain unread');};
  if(kind==='hidden')Object.defineProperty(q.questions.voice!.criteria!,'hidden',{get:getter,enumerable:false});
  if(kind==='symbol')Object.defineProperty(q.questions.voice!.criteria!,Symbol('hidden'),{get:getter,enumerable:true});
  if(kind==='prototype')Object.setPrototypeOf(q.questions.voice!.criteria!,Object.defineProperty({},'hidden',{get:getter,enumerable:true}));
  assert.equal(signalListeningRequestDigestV1(run,i,q),baseline(run,i,q));assert.equal(calls,0);
 }
 for(const target of ['criteria','basis']as const){
  const i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot),pair=Proxy.revocable({},{});
  if(target==='criteria')q.questions.voice!.criteria=pair.proxy;else i.scope_basis=pair.proxy as Record<string,string>;
  pair.revoke();let old:Error|undefined;try{baseline(run,i,q);}catch(e){old=e as Error;}
  assert.ok(old);assert.throws(()=>signalListeningRequestDigestV1(run,i,q),{name:old.name,message:old.message});
 }
});

test('run/input getter capture order and caller mutations before hashing remain unchanged',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration());
 for(const field of ['id','entity_context_digest','root_id','input_digest','question_digests','scope_basis']as const){
  const make=()=>{const r={...run},i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot);let calls=0;const target=field==='id'||field==='entity_context_digest'?r:i;const original=(target as Record<string,unknown>)[field];
   Object.defineProperty(target,field,{get(){calls++;q.state='changed during '+field;return original;},enumerable:true});return{r,i,q,calls:()=>calls};};
  const a=make(),b=make();assert.equal(signalListeningRequestDigestV1(a.r,a.i,a.q),baseline(b.r,b.i,b.q));assert.equal(a.calls(),1);assert.equal(b.calls(),1);
 }
});


test('descriptor guards never fall through to inherited getters for deleted question fields',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration()),i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot);let reads=0;
 delete q.questions.promotion!.criteria;Object.defineProperty(q.questions.promotion!,'replacement',{value:'plain',enumerable:true});
 const before=Object.getOwnPropertyDescriptor(Object.prototype,'criteria');
 try{Object.defineProperty(Object.prototype,'criteria',{get(){reads++;throw new Error('inherited descriptor lookup');},configurable:true});
  assert.equal(signalListeningRequestDigestV1(run,i,q),baseline(run,i,q));assert.equal(reads,0);
 }finally{if(before)Object.defineProperty(Object.prototype,'criteria',before);else Reflect.deleteProperty(Object.prototype,'criteria');}
});


test('exotic builder inputs preserve the previous late-selection result instead of adding codec errors',()=>{
 const config=configuration(),snapshot=compileSignalListeningSnapshotV1(config),wireMap=new Map(Object.entries(buildSignalListeningJevRequestV1({text:'x',question_keys:config.questions.map(q=>q.key)},config).questions));
 const oldCompiled=(i:Pick<SignalListeningInputV1,'text'|'question_keys'>):JevRequestV1=>{
  if(!i.text.trim()||!i.question_keys.length||i.question_keys.length>256||new Set(i.question_keys).size!==i.question_keys.length||i.question_keys.some(k=>!wireMap.has(k)))throw Error('listening_input_invalid');
  return{model:'jev-1.13.0',state:i.text,questions:Object.fromEntries([...i.question_keys].sort().map(k=>[k,structuredClone(wireMap.get(k)!)]))};
 };
 for(const key of ['missing',{toString:()=> 'voice'} as unknown as string]){
  const make=()=>{let reads=0;return{i:{text:'body',get question_keys(){reads++;return reads<=5?['voice']:[key];}},reads:()=>reads};};
  const a=make(),b=make(),actual=buildSignalListeningCompiledRequestV1(a.i,snapshot),old=oldCompiled(b.i);assert.deepEqual(actual,old);assert.equal(a.reads(),b.reads());assert.equal(signalListeningRequestDigestV1(run,input(),actual),baseline(run,input(),old));
 }
});

test('changed reflection intrinsics and accessors are ignored exactly like the old digest',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration()),i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot);
 const own=Object.getOwnPropertyDescriptor,define=Object.defineProperty;
 for(const [owner,key]of [[Object,'getOwnPropertyDescriptor'],[Object,'getOwnPropertyDescriptors'],[Object,'getPrototypeOf'],[Object,'hasOwn'],[Reflect,'ownKeys']]as const){
  const descriptor=own(owner,key)!;
  for(const accessor of [false,true]){
   let observations=0,actual:unknown,expected:unknown;
   try{
    const hook=()=>{observations++;throw Error('reflection hook must not be observed');};
    define(owner,key,accessor?{get:hook,configurable:true}:{...descriptor,value:hook});
    expected=baseline(run,i,q);actual=signalListeningRequestDigestV1(run,i,q);
   }finally{define(owner,key,descriptor);}
   assert.equal(actual,expected);assert.equal(observations,0,key);
  }
 }
});

test('changed canonicalizer/builder callbacks fall back before extra array/map/weakmap observations',()=>{
 const snapshot=compileSignalListeningSnapshotV1(configuration()),i=input(),q=buildSignalListeningCompiledRequestV1(i,snapshot);
 const own=Object.getOwnPropertyDescriptor,define=Object.defineProperty;
 for(const [owner,key]of [[Array,'isArray'],[Array.prototype,'map'],[Array.prototype,'every'],[Array.prototype,'some'],[Map.prototype,'get'],[WeakMap.prototype,'get']]as const){
  const descriptor=own(owner,key)!;let observations=0,actual:unknown,expected:unknown,oldCount=0,newCount=0;
  try{define(owner,key,{...descriptor,value:function(this:unknown,...args:unknown[]){observations++;return Reflect.apply(descriptor.value,this,args);}});
   expected=baseline(run,i,q);oldCount=observations;observations=0;actual=signalListeningRequestDigestV1(run,i,q);newCount=observations;
  }finally{define(owner,key,descriptor);}
  assert.equal(actual,expected);assert.equal(newCount,oldCount,key);
 }
});

// Independent b95 compile oracle: especially hash(identity) BEFORE wire creation.
function oldCompiledSnapshot(value:unknown){
 const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
 const config=freeze(validateSignalListeningConfigurationV1(value)),configuration_digest=legacyDigest(config);
 const identity=freeze({kind:'mass_labeling',provider:'typesafe',model:config.model,prompt_digest:configuration_digest,
  schema_digest:legacyDigest({version:SIGNAL_LISTENING_REQUEST_VERSION_V1,answers:'question-digest-cache-v1'}),params:{request_version:SIGNAL_LISTENING_REQUEST_VERSION_V1,configuration:config,configuration_digest,input_usd_per_mtok:.042,defined_universal_limit:8,defined_candidates:4,discovered_candidates:4}});
 Object.freeze({});const identity_digest=legacyDigest(identity);
 const wire=(q:SignalListeningConfigurationV1['questions'][number])=>{const instructions={rules:config.instructions,question:q.text};return q.type==='choice'?{type:'choice',instructions,criteria:Object.fromEntries(q.options.map(o=>[o.key,o.definition]))}:{type:'noul',instructions,criteria:{true:q.positive,false:q.negative}};};
 const wires=new Map(config.questions.map(q=>[q.key,freeze(wire(q))]));return{identity,identity_digest,wires};
}

test('changed intrinsics before compile preserve literal identity-hash-before-wires callback order',()=>{
 const config=configuration(),oldStringify=JSON.stringify,oldValues=Object.values;let events:string[]=[];
 const stringify=((v:unknown,...args:unknown[])=>{if(v&&typeof v==='object'&&(v as {kind?:unknown}).kind==='mass_labeling')events.push('identity hash');return Reflect.apply(oldStringify,JSON,[v,...args]);}) as typeof JSON.stringify;
 const values=((v:object)=>{if(Object.hasOwn(v,'instructions')&&Object.hasOwn(v,'criteria'))events.push('wire');return oldValues(v);}) as typeof Object.values;
 let expected:ReturnType<typeof oldCompiledSnapshot>|undefined,actual:ReturnType<typeof readSignalListeningSnapshotV1>|undefined,oldEvents:string[]=[],newEvents:string[]=[];
 try{JSON.stringify=stringify;Object.values=values;expected=oldCompiledSnapshot(config);oldEvents=events;events=[];actual=readSignalListeningSnapshotV1(compileSignalListeningSnapshotV1(config));newEvents=events;
 }finally{JSON.stringify=oldStringify;Object.values=oldValues;}
 assert.deepEqual(newEvents,oldEvents);assert.equal(newEvents[0],'identity hash');assert.equal(newEvents.filter(e=>e==='wire').length,config.questions.length);
 assert.ok(expected&&actual);assert.deepEqual(actual.identity,expected.identity);assert.equal(actual.identity_digest,expected.identity_digest);
});

test('changed array callbacks before building retain the literal old builder observations',()=>{
 const config=configuration(),snapshot=compileSignalListeningSnapshotV1(config),i=input(),wires=new Map(Object.entries(buildSignalListeningJevRequestV1({text:'x',question_keys:config.questions.map(q=>q.key)},config).questions));
 const oldBuilder=():JevRequestV1=>{
  if(!i.text.trim()||!i.question_keys.length||i.question_keys.length>256||new Set(i.question_keys).size!==i.question_keys.length||i.question_keys.some(k=>!wires.has(k)))throw Error('listening_input_invalid');
  return{model:'jev-1.13.0',state:i.text,questions:Object.fromEntries([...i.question_keys].sort().map(k=>[k,structuredClone(wires.get(k)!)]))};
 };
 const own=Object.getOwnPropertyDescriptor,define=Object.defineProperty;
 for(const [owner,key]of [[Array,'isArray'],[Array.prototype,'map'],[Array.prototype,'every'],[Array.prototype,'some']]as const){
  const descriptor=own(owner,key)!;let observations=0,oldCount=0,newCount=0,expected:JevRequestV1|undefined,actual:JevRequestV1|undefined;
  try{define(owner,key,{...descriptor,value:function(this:unknown,...args:unknown[]){observations++;return Reflect.apply(descriptor.value,this,args);}});
   expected=oldBuilder();oldCount=observations;observations=0;actual=buildSignalListeningCompiledRequestV1(i,snapshot);newCount=observations;
  }finally{define(owner,key,descriptor);}
  assert.deepEqual(actual,expected);assert.equal(newCount,oldCount,key);
 }
});


test('changed Buffer.byteLength disables optional reuse without adding hooks before or after compile',()=>{
 const config=configuration(),own=Object.getOwnPropertyDescriptor,define=Object.defineProperty,descriptor=own(Buffer,'byteLength')!;
 const compiled=compileSignalListeningSnapshotV1(config),i=input(),q=buildSignalListeningCompiledRequestV1(i,compiled);
 for(const mode of ['count','throw','accessor']as const){
  let calls=0,oldCalls=0,newCalls=0,oldIdentity:ReturnType<typeof oldCompiledSnapshot>|undefined,newIdentity:ReturnType<typeof readSignalListeningSnapshotV1>|undefined,actualDigest:unknown,oldDigest:unknown;
  const hook=(...args:unknown[])=>{calls++;if(mode!=='count')throw Error('Buffer hook must remain unread');return Reflect.apply(descriptor.value,Buffer,args);};
  try{define(Buffer,'byteLength',mode==='accessor'?{get:hook,configurable:true}:{...descriptor,value:hook});
   oldIdentity=oldCompiledSnapshot(config);oldCalls=calls;calls=0;newIdentity=readSignalListeningSnapshotV1(compileSignalListeningSnapshotV1(config));newCalls=calls;
   calls=0;oldDigest=baseline(run,i,q);oldCalls+=calls;calls=0;actualDigest=signalListeningRequestDigestV1(run,i,q);newCalls+=calls;
   const fresh=buildSignalListeningCompiledRequestV1(i,compiled);assert.equal(JSON.stringify(fresh),JSON.stringify(q));
  }finally{define(Buffer,'byteLength',descriptor);}
  assert.equal(newCalls,oldCalls);assert.equal(calls,0);assert.equal(actualDigest,oldDigest);assert.ok(newIdentity&&oldIdentity);assert.deepEqual(newIdentity.identity,oldIdentity.identity);assert.equal(newIdentity.identity_digest,oldIdentity.identity_digest);
 }
});
