/** Phase-specific logical application ownership. The legacy_capture mode
 * retains EXACTLY the old P=24B+64KiB through the completed provider/snapshot
 * boundary; it does not certify native transport, heap, H or RSS. The older
 * parameterized mode remains available for abstract/prospective tests only.
 * Explicit first-party provider+mapper identity is required in either mode. */
export type JevPhaseBudgetParametersV3=Readonly<{
  body_bound_bytes:number;header_bound_bytes?:number;capture_mode?:'legacy_capture';
  ledger_bytes:number;max_capture_bytes:number;max_retained_bytes:number;
  max_raw_wrapper_bytes:number;max_row_flush_bytes:number;flush_fixed_bytes:number;
  raw_member_overhead_bytes:number;max_page_bytes:number;
  max_pending_calls:number;max_active_flushes:number;max_flush_rows:number;
}>;
export type JevPhaseSharedBudgetV3={
  readonly limit:number;
  /** Same counter as inputs/Survey/Native. All callbacks are synchronous,
   * exact and non-reentrant; observers run after an owner transition. */
  used():number;tryClaim(bytes:number):boolean;release(bytes:number):void;
};
export type JevPhaseCallQuoteV3=Readonly<{
  capture_bytes:number;retained_bound_bytes:number;
  max_raw_wrapper_bytes:number;max_row_flush_bytes:number;
}>;
export type JevPhasePrefixQuoteV3=Readonly<{
  count:number;capture_bytes:number;headroom_delta_bytes:number;
  required_bytes:number;headroom_after_bytes:number;error_headroom_delta_bytes:number;error_headroom_after_bytes:number;
}>;
declare const captureBrand:unique symbol;
declare const flushBrand:unique symbol;
declare const bindingBrand:unique symbol;
export type JevPhaseCaptureLeaseV3={readonly[captureBrand]:'capture'};
export type JevPhaseFlushLeaseV3={readonly[flushBrand]:'flush'};
export type JevPhaseClosedBindingV3={readonly[bindingBrand]:'binding'};
export type JevPhaseSnapshotV3=Readonly<{
  owned_bytes:number;protected_bytes:number;error_protected_bytes:number;error_retained_bytes:number;capture_bytes:number;retained_bytes:number;flush_workspace_bytes:number;reserved_calls:number;retained_calls:number;
  flushing_calls:number;quarantined_calls:number;active_flushes:number;headroom_borrowed:boolean;closed:boolean;
  counter_uncertain:boolean;admission_closed:boolean;shared_used_bytes:number|null;
}>;

const MAX_BODY=2*1024*1024,MAX_HEADER=2*1024*1024,MAX_RAW=8*1024*1024,MAX_PAGE=32*1024*1024;
const integer=(n:unknown,min=0,max=Number.MAX_SAFE_INTEGER):n is number=>Number.isSafeInteger(n)&&Number(n)>=min&&Number(n)<=max;
const invalid=(code:string):never=>{throw Error('jev_phase_'+code);};
const add=(a:number,b:number)=>{const n=a+b;if(!integer(n))return invalid('arithmetic_overflow');return n;};
const objectLike=(x:unknown):x is object=>(typeof x==='object'&&x!==null)||typeof x==='function';
const encoded=(raw:number,overhead:number)=>add(Math.ceil(raw/3)*4,overhead);
const parameterKeys=['body_bound_bytes','header_bound_bytes','ledger_bytes','max_capture_bytes','max_retained_bytes',
  'max_raw_wrapper_bytes','max_row_flush_bytes','flush_fixed_bytes','raw_member_overhead_bytes','max_page_bytes',
  'max_pending_calls','max_active_flushes','max_flush_rows']as const;
function parameters(value:JevPhaseBudgetParametersV3):JevPhaseBudgetParametersV3{
  if(!objectLike(value))return invalid('profile_invalid');
  const mode=Object.getOwnPropertyDescriptor(value,'capture_mode');
  const legacy=Boolean(mode&&'value'in mode&&mode.value==='legacy_capture');
  const keys=legacy?parameterKeys.filter(key=>key!=='header_bound_bytes'):parameterKeys;
  if(Object.keys(value).length!==keys.length+(legacy?1:0))return invalid('profile_invalid');
  const copy:Record<string,number|string>={};if(legacy)copy.capture_mode='legacy_capture';
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!('value'in descriptor)||!integer(descriptor.value))return invalid('profile_invalid');copy[key]=descriptor.value;
  }
  const p=copy as unknown as JevPhaseBudgetParametersV3;
  if(!integer(p.body_bound_bytes,1,MAX_BODY)||!legacy&&!integer(p.header_bound_bytes,1,MAX_HEADER)
    ||p.max_capture_bytes<p.max_retained_bytes||p.max_retained_bytes<1||p.max_capture_bytes<p.body_bound_bytes
    ||!integer(p.max_raw_wrapper_bytes,1,MAX_RAW)||p.max_row_flush_bytes<2*p.max_raw_wrapper_bytes
    ||!integer(p.max_page_bytes,1,MAX_PAGE)||p.raw_member_overhead_bytes>p.max_page_bytes||encoded(p.max_raw_wrapper_bytes,p.raw_member_overhead_bytes)>p.max_page_bytes
    ||!integer(p.max_pending_calls,1,4096)||!integer(p.max_active_flushes,1,64)||!integer(p.max_flush_rows,1,4096))return invalid('profile_invalid');
  add(p.flush_fixed_bytes,p.max_row_flush_bytes);return Object.freeze(p);
}
const bindings=new WeakMap<object,{provider:object;mapper:object;profile:JevPhaseBudgetParametersV3}>();
/** First-party registration seam, NOT an externally supplied assertion or an
 * authorization capability. Current production code never calls it. A spread
 * or JSON clone cannot inherit a provider/mapper's registered object identity. */
export function registerJevPhaseClosedBindingV3(args:{provider_owner:object;mapper_owner:object;parameters:JevPhaseBudgetParametersV3}):JevPhaseClosedBindingV3{
  if(!objectLike(args.provider_owner)||!objectLike(args.mapper_owner))return invalid('binding_invalid');
  const profile=parameters(args.parameters),token=Object.freeze({})as JevPhaseClosedBindingV3;
  bindings.set(token,{provider:args.provider_owner,mapper:args.mapper_owner,profile});return token;
}
export function retireJevPhaseClosedBindingV3(binding:unknown):boolean{return objectLike(binding)&&bindings.delete(binding);}
export function resolveJevPhaseClosedBindingV3(args:{binding?:unknown;provider_owner:object;mapper_owner:object;recovery_only?:boolean}):JevPhaseBudgetParametersV3|null{
  if(args.recovery_only||!objectLike(args.binding))return null;
  const entry=bindings.get(args.binding);
  return entry&&entry.provider===args.provider_owner&&entry.mapper===args.mapper_owner?entry.profile:null;
}
export type JevPhaseBudgetOwnerV3={
  quoteCall(value:JevPhaseCallQuoteV3):JevPhaseCallQuoteV3;
  quotePrefix(quotes:readonly JevPhaseCallQuoteV3[],maxCount?:number,externalBytes?:number):JevPhasePrefixQuoteV3;
  /** Recomputes against current shared credit, before COMMIT. It may shrink
   * an old numeric quote, never expand outside this ordered proposal prefix. */
  reservePrefix(quotes:readonly JevPhaseCallQuoteV3[],maxCount?:number):Readonly<{quote:JevPhasePrefixQuoteV3;leases:readonly JevPhaseCaptureLeaseV3[]}>|null;
  transferToRetained(lease:JevPhaseCaptureLeaseV3,observed:{retained_bytes:number;raw_wrapper_bytes:number;row_flush_bytes:number}):void;
  releaseUnsent(lease:JevPhaseCaptureLeaseV3):void;
  /** Claim before splicing buffered rows or allocating RAW wrappers/codec. */
  takeFlushPrefix(leases:readonly JevPhaseCaptureLeaseV3[],maxRows?:number):Readonly<{lease:JevPhaseFlushLeaseV3;count:number;raw_page_bytes:number;working_bytes:number;additional_bytes:number;borrows_headroom:boolean}>|null;
  /** After the consume frame and ALL parsed/codec/SQL aliases have exited,
   * return only workspace. Retain immutable receipts in quarantine: no replay,
   * no new admission, no R credit and no false close before ledger ACK. */
  quarantineFlush(lease:JevPhaseFlushLeaseV3,retainWorkspace?:boolean):readonly JevPhaseCaptureLeaseV3[];
  reconcileQuarantined(leases:readonly JevPhaseCaptureLeaseV3[]):void;
  /** Only after RAW/settlement/APPLY/feedback handling or reconciliation. */
  finishFlush(lease:JevPhaseFlushLeaseV3):void;
  /** Semantic technical application only: never replays/decodes RAW and never
   * reopens a quarantined call. R stays quarantined until final ledger ACK. */
  takeTerminalWorkspace(costs:readonly number[],maxRows?:number):Readonly<{lease:JevPhaseFlushLeaseV3;count:number;working_bytes:number}>|null;
  snapshot():JevPhaseSnapshotV3;
  close():void;
};
/** null means LEGACY. In particular absent/foreign/recovery bindings cannot
 * create an owner, claim bytes or silently enable this experimental path. */
export function tryCreateJevPhaseBudgetOwnerV3(args:{binding?:unknown;provider_owner:object;mapper_owner:object;recovery_only?:boolean;shared:JevPhaseSharedBudgetV3}):JevPhaseBudgetOwnerV3|null{
  const resolved=resolveJevPhaseClosedBindingV3(args);if(!resolved)return null;
  const p:JevPhaseBudgetParametersV3=resolved,shared=args.shared;
  if(!integer(shared.limit,1)||typeof shared.used!=='function'||typeof shared.tryClaim!=='function'||typeof shared.release!=='function')return invalid('shared_invalid');
  type CallState={phase:'reserved'|'retained'|'flushing'|'quarantined';current:number;quote:JevPhaseCallQuoteV3;raw:number;work:number};
  type FlushState={rows:readonly JevPhaseCaptureLeaseV3[];additional:number;borrows:boolean;working:number};
  const quotes=new WeakSet<object>(),calls=new WeakMap<object,CallState>(),flushes=new WeakMap<object,FlushState>();
  let owned=0,G=0,E=0,errorRetained=0,captureOwned=0,retainedOwned=0,workspaceOwned=0,reserved=0,retained=0,flushing=0,quarantined=0,active=0,borrower:JevPhaseFlushLeaseV3|undefined,closed=false,busy=false,uncertain=false,admissionClosed=false,firstCounterError:unknown;
  const poison=(error:unknown):never=>{if(!uncertain){uncertain=true;firstCounterError=error;}throw firstCounterError;};
  function used(){
    let n:unknown;try{n=shared.used();}catch(error){return poison(error);}
    if(!integer(n)||n<owned||n>shared.limit)return poison(Error('jev_phase_shared_counter_drift'));return n;
  }
  function claim(n:number){
    if(!integer(n))return invalid('arithmetic_overflow');const before=used();if(n>shared.limit-before)return false;if(!n)return true;
    let ok:unknown;try{ok=shared.tryClaim(n);}catch(error){return poison(error);}
    const after=used();
    if(ok===false){if(after!==before)return poison(Error('jev_phase_shared_counter_drift'));return false;}
    if(ok!==true||after!==before+n)return poison(Error('jev_phase_shared_counter_drift'));owned=add(owned,n);return true;
  }
  function release(n:number){
    if(!integer(n)||n>owned)return invalid('release_invalid');if(!n)return;
    const before=used();try{shared.release(n);}catch(error){return poison(error);}
    // The known local delta is validated against the new owner floor.
    owned-=n;const after=used();if(after!==before-n)return poison(Error('jev_phase_shared_counter_drift'));
  }
  function mutate<T>(fn:()=>T):T{
    if(uncertain)throw firstCounterError;if(closed)return invalid('owner_closed');if(busy)return invalid('reentrant_transition');
    busy=true;try{return fn();}finally{busy=false;}
  }
  function row(lease:JevPhaseCaptureLeaseV3,phase?:CallState['phase']){
    if(!objectLike(lease))return invalid('capture_lease_invalid');const r=calls.get(lease);
    if(!r||phase!==undefined&&r.phase!==phase)return invalid('capture_lease_invalid');return r;
  }
  function checkedQuotes(list:readonly JevPhaseCallQuoteV3[],maxCount:number){
    if(!Array.isArray(list)||!integer(maxCount,0,list.length)||maxCount>p.max_pending_calls)return invalid('prefix_invalid');
    for(let i=0;i<maxCount;i++)if(!objectLike(list[i])||!quotes.has(list[i]!))return invalid('quote_invalid');
  }
  function prefix(list:readonly JevPhaseCallQuoteV3[],maxCount:number,externalBytes=0):JevPhasePrefixQuoteV3{
    checkedQuotes(list,maxCount);if(!integer(externalBytes))return invalid('prefix_invalid');const available=Math.max(0,shared.limit-used()-externalBytes),slots=admissionClosed?0:p.max_pending_calls-reserved-retained-flushing-quarantined;
    let captures=0,g=G,errorG=E,count=0,best:JevPhasePrefixQuoteV3={count:0,capture_bytes:0,headroom_delta_bytes:0,required_bytes:0,headroom_after_bytes:G,error_headroom_delta_bytes:0,error_headroom_after_bytes:E};
    for(let i=0;i<Math.min(maxCount,slots);i++){
      const q=list[i]!,nextG=Math.max(g,add(p.flush_fixed_bytes,q.max_row_flush_bytes)),nextE=p.capture_mode==='legacy_capture'?Math.max(errorG,nextG):E,delta=add(nextG-G,nextE-E),remaining=available-captures;
      // Compare before adding: an otherwise valid huge quote simply does not
      // fit. It must not overflow while proving that fact.
      if(delta>remaining||q.capture_bytes>remaining-delta)break;
      captures=add(captures,q.capture_bytes);g=nextG;errorG=nextE;const required=add(captures,add(g-G,errorG-E));count++;
      best={count,capture_bytes:captures,headroom_delta_bytes:g-G,required_bytes:required,headroom_after_bytes:g,error_headroom_delta_bytes:errorG-E,error_headroom_after_bytes:errorG};
    }
    return Object.freeze(best);
  }
  if(!claim(p.ledger_bytes))return null;
  return{
    quoteCall(value){return mutate(()=>{
      const keys=['capture_bytes','retained_bound_bytes','max_raw_wrapper_bytes','max_row_flush_bytes']as const;
      if(!objectLike(value)||Object.keys(value).length!==keys.length)return invalid('quote_invalid');
      const copy:Record<string,number>={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d)||!integer(d.value,1))return invalid('quote_invalid');copy[key]=d.value;}
      const q=copy as unknown as JevPhaseCallQuoteV3;
      if(q.capture_bytes>p.max_capture_bytes||q.retained_bound_bytes>q.capture_bytes||q.retained_bound_bytes>p.max_retained_bytes
        ||q.max_raw_wrapper_bytes>p.max_raw_wrapper_bytes||q.max_row_flush_bytes>p.max_row_flush_bytes||q.max_row_flush_bytes<2*q.max_raw_wrapper_bytes)return invalid('quote_invalid');
      add(p.flush_fixed_bytes,q.max_row_flush_bytes);Object.freeze(q);quotes.add(q);return q;
    });},
    quotePrefix(list,maxCount=list.length,externalBytes=0){return mutate(()=>prefix(list,maxCount,externalBytes));},
    reservePrefix(list,maxCount=list.length){return mutate(()=>{
      const q=prefix(list,maxCount);if(!q.count||!claim(q.required_bytes))return null;
      // Every token and its recipient exists before the caller's COMMIT ACK.
      const leases=Array.from({length:q.count},(_,i)=>{const token=Object.freeze({})as JevPhaseCaptureLeaseV3;
        calls.set(token,{phase:'reserved',current:list[i]!.capture_bytes,quote:list[i]!,raw:0,work:0});return token;});
      G=q.headroom_after_bytes;E=q.error_headroom_after_bytes;captureOwned+=q.capture_bytes;reserved+=leases.length;return Object.freeze({quote:q,leases:Object.freeze(leases)});
    });},
    transferToRetained(lease,observed){mutate(()=>{
      const r=row(lease,'reserved');
      if(!integer(observed.retained_bytes,0,r.quote.retained_bound_bytes)||observed.retained_bytes>r.current
        ||!integer(observed.raw_wrapper_bytes,1,r.quote.max_raw_wrapper_bytes)
        ||!integer(observed.row_flush_bytes,2*observed.raw_wrapper_bytes,r.quote.max_row_flush_bytes))return invalid('retained_bound_invalid');
      const excess=r.current-observed.retained_bytes;release(excess);
      captureOwned-=r.current;retainedOwned+=observed.retained_bytes;
      r.phase='retained';r.current=observed.retained_bytes;r.raw=observed.raw_wrapper_bytes;r.work=observed.row_flush_bytes;reserved--;retained++;
    });},
    releaseUnsent(lease){mutate(()=>{const r=row(lease,'reserved');release(r.current);captureOwned-=r.current;calls.delete(lease);reserved--;});},
    takeFlushPrefix(list,maxRows=p.max_flush_rows){return mutate(()=>{
      if(!Array.isArray(list)||!integer(maxRows,1,p.max_flush_rows))return invalid('flush_prefix_invalid');
      if(active>=p.max_active_flushes||!list.length)return null;
      const limit=Math.min(maxRows,list.length),seen=new Set<object>();
      // Validate before any claim; an alias cannot release a row twice.
      for(let i=0;i<limit;i++){row(list[i]!,'retained');if(seen.has(list[i]!))return invalid('flush_alias_invalid');seen.add(list[i]!);}
      const borrow=borrower===undefined,available=shared.limit-used(),workLimit=borrow?add(G,available):available;
      let count=0,page=0,work=p.flush_fixed_bytes,additional=0,errorDelta=0;if(work>workLimit)return null;
      for(let i=0;i<limit;i++){
        const r=row(list[i]!,'retained'),rowPage=encoded(r.raw,p.raw_member_overhead_bytes);
        if(rowPage>p.max_page_bytes-page||r.work>workLimit-work)break;
        const nextPage=add(page,rowPage),nextWork=add(work,r.work),extra=borrow?Math.max(0,nextWork-G):nextWork;
        const errorExtra=p.capture_mode==='legacy_capture'&&!errorRetained?Math.max(0,nextWork-E):0;
        if(extra>available||errorExtra>available-extra)break;
        count++;page=nextPage;work=nextWork;additional=extra;errorDelta=errorExtra;
      }
      if(!count)return null;if(!claim(add(additional,errorDelta)))return null;workspaceOwned+=additional;E=add(E,errorDelta);
      const token=Object.freeze({})as JevPhaseFlushLeaseV3,rows=Object.freeze(list.slice(0,count));
      for(const lease of rows)row(lease,'retained').phase='flushing';retained-=count;flushing+=count;active++;
      flushes.set(token,{rows,additional,borrows:borrow,working:work});if(borrow)borrower=token;
      return Object.freeze({lease:token,count,raw_page_bytes:page,working_bytes:work,additional_bytes:add(additional,errorDelta),borrows_headroom:borrow});
    });},
    quarantineFlush(lease,retainWorkspace=false){return mutate(()=>{
      if(!objectLike(lease))return invalid('flush_lease_invalid');const f=flushes.get(lease);if(!f)return invalid('flush_lease_invalid');
      if(f.borrows&&borrower!==lease)return invalid('headroom_owner_invalid');
      if(retainWorkspace){
        if(p.capture_mode!=='legacy_capture'||errorRetained||E<f.working)return invalid('error_escrow_invalid');
        errorRetained=f.working;
      }
      release(f.additional);workspaceOwned-=f.additional;admissionClosed=true;for(const token of f.rows)row(token,'flushing').phase='quarantined';
      flushing-=f.rows.length;quarantined+=f.rows.length;active--;flushes.delete(lease);
      if(f.borrows)borrower=undefined;return f.rows;
    });},
    reconcileQuarantined(list){mutate(()=>{
      if(!Array.isArray(list)||list.length>p.max_pending_calls)return invalid('quarantine_invalid');
      let bytes=0;const seen=new Set<object>();
      for(const lease of list){const r=row(lease,'quarantined');if(seen.has(lease))return invalid('quarantine_alias_invalid');seen.add(lease);bytes=add(bytes,r.current);}
      release(bytes);retainedOwned-=bytes;for(const lease of list)calls.delete(lease);quarantined-=list.length;
    });},
    finishFlush(lease){mutate(()=>{
      if(!objectLike(lease))return invalid('flush_lease_invalid');const f=flushes.get(lease);if(!f)return invalid('flush_lease_invalid');
      if(f.borrows&&borrower!==lease)return invalid('headroom_owner_invalid');let bytes=f.additional;
      for(const token of f.rows)bytes=add(bytes,row(token,'flushing').current);
      release(bytes);retainedOwned-=bytes-f.additional;workspaceOwned-=f.additional;for(const token of f.rows)calls.delete(token);flushing-=f.rows.length;active--;flushes.delete(lease);
      if(f.borrows)borrower=undefined; // G remains charged, even for a small flush.
    });},
    takeTerminalWorkspace(costs,maxRows=p.max_flush_rows){return mutate(()=>{
      if(!Array.isArray(costs)||!integer(maxRows,1,p.max_flush_rows)||active>=p.max_active_flushes)return null;
      const borrow=borrower===undefined,available=shared.limit-used();let count=0,work=p.flush_fixed_bytes,additional=0,errorDelta=0;
      for(const value of costs.slice(0,maxRows)){
        if(!integer(value,1,p.max_row_flush_bytes))return invalid('terminal_quote_invalid');
        const next=add(work,value),extra=borrow?Math.max(0,next-G):next,
          nextError=p.capture_mode==='legacy_capture'&&!errorRetained?Math.max(0,next-E):0;
        if(extra>available||nextError>available-extra)break;count++;work=next;additional=extra;errorDelta=nextError;
      }
      if(!count||!claim(add(additional,errorDelta)))return null;
      E=add(E,errorDelta);workspaceOwned+=additional;
      const lease=Object.freeze({})as JevPhaseFlushLeaseV3;flushes.set(lease,{rows:[],additional,borrows:borrow,working:work});
      active++;if(borrow)borrower=lease;return Object.freeze({lease,count,working_bytes:work});
    });},
    snapshot(){return Object.freeze({owned_bytes:owned,protected_bytes:G,error_protected_bytes:E,error_retained_bytes:errorRetained,capture_bytes:captureOwned,retained_bytes:retainedOwned,flush_workspace_bytes:workspaceOwned,reserved_calls:reserved,retained_calls:retained,
      flushing_calls:flushing,quarantined_calls:quarantined,active_flushes:active,headroom_borrowed:borrower!==undefined,closed,counter_uncertain:uncertain,admission_closed:admissionClosed,
      shared_used_bytes:uncertain?null:used()});},
    close(){mutate(()=>{if(reserved||retained||flushing||quarantined||active||borrower||errorRetained)return invalid('owner_busy');release(add(add(G,E),p.ledger_bytes));G=0;E=0;closed=true;});},
  };
}
