import type {JevProviderV1} from '../providers/typesafe-jev';
import {isJevPhaseProviderV3,isJevPhaseStoreV3} from '../providers/jev-phase-provider-v3';
import type {JevPhaseClosedBindingV3} from './signal-jev-response-budget-v3';

/** Three additional logical64-byte slots/call: weak entry header, call key,
 * send/row mode flag (the marker retires before the row exists). No projected input, string, RAW, JSON tree or numeric vector is
 * copied. Eighty fixed slots pay the scope/WeakSet/closure/binding references
 * and registry/scalar overhead plus the bounded scalar Full observer
 * (38 worker slots +42 observer slots; private inventory lists each group).
 * Preflight/descriptor/key scratch is strictly synchronous and non-reentrant,
 * reusing the P packing scratch prepaid by the legacy_capture profile. */
export const JEV_LISTENING_METADATA_SLOTS_V3=3;
export const JEV_LISTENING_METADATA_FIXED_BYTES_V3=80*64;
/** Up to five nonempty JSON arrays: settle/replay/results/answers/failures.
 * The last two partition calls. One frame byte/query times five copies. */
export const JEV_LISTENING_QUERY_FRAME_BYTES_V3=5*5;
const mappers=new WeakSet<object>();
const bindings=new WeakMap<object,{provider:JevProviderV1;mapper:object;store:object;admit:unknown;settle:unknown;apply:unknown}>();
/** Constructor-only registration of the private Listening mapper, not a
 * predicate over a generic hook's returned shape. */
export function registerJevListeningMetadataMapperV3(mapper:object):void{mappers.add(mapper);}
export function bindJevListeningMetadataV3(binding:JevPhaseClosedBindingV3,provider:JevProviderV1,mapper:object,
 store:object&{admitAndMarkSelected?:unknown;settlePage?:unknown;apply?:unknown},recovery:boolean):void{
 if(recovery||!mappers.has(mapper)||!isJevPhaseProviderV3(provider)||!isJevPhaseStoreV3(store)
  ||typeof store.admitAndMarkSelected!=='function'||typeof store.settlePage!=='function'||typeof store.apply!=='function')return;
 bindings.set(binding,{provider,mapper,store,admit:store.admitAndMarkSelected,settle:store.settlePage,apply:store.apply});
}
export function isJevListeningMetadataBindingV3(binding:unknown,provider:JevProviderV1,mapper:object,
 store:{admitAndMarkSelected?:unknown;settlePage?:unknown;apply?:unknown}):boolean{
 if(!binding||typeof binding!=='object')return false;const entry=bindings.get(binding);
 return Boolean(entry&&entry.provider===provider&&entry.mapper===mapper&&mappers.has(mapper)
  &&isJevPhaseProviderV3(provider)&&isJevPhaseStoreV3(entry.store)
  &&entry.admit===store.admitAndMarkSelected&&entry.settle===store.settlePage&&entry.apply===store.apply);
}
const plain=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'
 &&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));
const own=(v:object,key:string):unknown=>{const d=Object.getOwnPropertyDescriptor(v,key);return d&&'value'in d?d.value:undefined;};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,hash=/^sha256:[0-9a-f]{64}$/u,key=/^[a-z][a-z0-9_]{0,63}$/u;
const fixed=(v:object,name:string)=>{const d=Object.getOwnPropertyDescriptor(v,name)!;Object.defineProperty(v,name,{...d,writable:false,configurable:false});};

/** Called ONLY for final, fresh Native clones in validateBeforeCommit after
 * capture+ledger credit was claimed. Constructor provenance matters: plain
 * fields cannot prove the absence of Proxy traps. The audited Native factory
 * constructs these with object spread + cloneNativePostgresJsonV1; no producer
 * mutates their input/request graph after this callback. Initial/reserved,
 * generic feed, injected adapters and recovery never call this operation.
 * Every premise is checked before the first mutation. Unsupported forms return
 * false without partial sealing, extra sends or a post-payment rejection.
 * Mapper AND SQL read these SAME sealed input objects, not a shadow quote.
 * Operational call status/raw_body/results_applied are deliberately untouched. */
export function createJevListeningMetadataScopeV3(run:object){
 const sealed=new WeakSet<object>();
 const eligible=(call:object):boolean=>{
   if(sealed.has(call))return true;
   if(!plain(call)||!plain(run))return false;
   const id=own(call,'id'),inputs=own(call,'inputs'),request=own(call,'request'),context=own(run,'entity_context_digest');
   if(typeof id!=='string'||!uuid.test(id)||typeof context!=='string'||!hash.test(context)
    ||!Array.isArray(inputs)||inputs.length!==1||!plain(request))return false;
   const input=own(inputs,'0');if(!plain(input))return false;
   const root=own(input,'root_id'),digest=own(input,'input_digest'),keys=own(input,'question_keys'),digests=own(input,'question_digests'),questions=own(request,'questions');
   if(typeof root!=='string'||!uuid.test(root)||typeof digest!=='string'||!hash.test(digest)
    ||!Array.isArray(keys)||keys.length<1||keys.length>256||!plain(digests)||!plain(questions))return false;
   // Native already bounded these own-key arrays to <=256. Together with the
   // descriptors and loop scalars they fit the prepaid P synchronous scratch;
   // this is not a general parser for arbitrary injected object graphs.
   const digestKeys=Object.keys(digests),requestKeys=Object.keys(questions);
   if(digestKeys.length!==keys.length||requestKeys.length!==keys.length)return false;
   for(let i=0;i<keys.length;i++){
    const name=own(keys,String(i));
    if(typeof name!=='string'||!key.test(name)||keys.indexOf(name)!==i
     ||!digestKeys.includes(name)||!requestKeys.includes(name))return false;
    const value=own(digests,name),question=own(questions,name);
    if(typeof value!=='string'||!hash.test(value)||!plain(question))return false;
   }
   return true;
 };
 return{
  canSealNativeBeforeCommit:eligible,
  sealNativeBeforeCommit(call:object):boolean{
   if(sealed.has(call))return true;if(!eligible(call))return false;
   const inputs=own(call,'inputs')as unknown[],input=own(inputs,'0')as Record<string,unknown>,request=own(call,'request')as Record<string,unknown>;
   const digests=own(input,'question_digests')as object,keys=own(input,'question_keys')as object,questions=own(request,'questions')as object;
   Object.freeze(digests);Object.freeze(keys);Object.freeze(input);Object.freeze(inputs);
   Object.freeze(questions);Object.freeze(request);
   fixed(call,'inputs');fixed(call,'request');fixed(call,'id');fixed(run,'entity_context_digest');
   sealed.add(call);return true;
  },
  // Retire the weak receipt marker at response handoff (or send finally).
  // The input remains immutable through SQL; its existing call credit and F
  // own it. The fixed ledger is never refunded per marker or reused as R.
  takeQuestionSlots(call:object):number|undefined{
   if(!sealed.delete(call))return undefined;
   const inputs=own(call,'inputs') as unknown[],input=own(inputs,'0') as Record<string,unknown>;
   return(own(input,'question_keys')as unknown[]).length;
  },
 };
}


export type JevListeningMetadataCountersV3={response_metadata_native_rows?:number;
 response_metadata_legacy_received_rows?:number;response_metadata_legacy_terminal_rows?:number};
/** Scalar-only measurement state: forty-two fixed logical slots are reserved in
 * the shared profile for this observer; no IDs/RAW/params/metric objects stay.
 * Stream invocations are sequential WITHIN a job and each emits a zero triple
 * before submission. A zero after nonzero is therefore a new contiguous
 * window; an arbitrary nonzero decrease is invalid, never guessed as a reset.
 * beginJob resets only the last triple, not cumulative totals. Re-emissions
 * add zero. Received counters increment ONLY after F was actually claimed; terminal
 * rows are independent and may overlap those same received calls.
 * This is a branch receipt, never an H1 gate or throughput measurement. */
export function createJevListeningMetadataReceiptV3(){
 let jobs=0,samples=0,missing=0,invalid=0,resets=0,hasLast=false;
 let lastNative=0,lastLegacy=0,lastTerminal=0,native=0,legacy=0,terminal=0;
 return{
  beginJob(){jobs++;hasLast=false;lastNative=0;lastLegacy=0;lastTerminal=0;},
  observe(metrics:JevListeningMetadataCountersV3){
   const n=metrics.response_metadata_native_rows,l=metrics.response_metadata_legacy_received_rows,t=metrics.response_metadata_legacy_terminal_rows;
   if(n===undefined&&l===undefined&&t===undefined){missing++;return;}
   if(typeof n!=='number'||typeof l!=='number'||typeof t!=='number'
    ||!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(l)||l<0||!Number.isSafeInteger(t)||t<0){invalid++;return;}
   samples++;
   if(hasLast&&n===0&&l===0&&t===0&&(lastNative>0||lastLegacy>0||lastTerminal>0)){
    resets++;lastNative=0;lastLegacy=0;lastTerminal=0;return;
   }
   if(hasLast&&(n<lastNative||l<lastLegacy||t<lastTerminal)){invalid++;return;}
   const nextNative=native+(n-lastNative),nextLegacy=legacy+(l-lastLegacy),nextTerminal=terminal+(t-lastTerminal);
   if(!Number.isSafeInteger(nextNative)||!Number.isSafeInteger(nextLegacy)||!Number.isSafeInteger(nextTerminal)){invalid++;return;}
   native=nextNative;legacy=nextLegacy;terminal=nextTerminal;lastNative=n;lastLegacy=l;lastTerminal=t;hasLast=true;
  },
  snapshot(){const complete=samples>0&&missing===0&&invalid===0;
   return{contract_version:'jev-listening-metadata-v3' as const,observed:complete&&native>0,complete_counters:complete,
    native_received_rows:native,legacy_received_rows:legacy,legacy_terminal_rows:terminal,
    samples,contiguous_window_resets:resets,jobs,missing_samples:missing,invalid_samples:invalid};
  },
 };
}
