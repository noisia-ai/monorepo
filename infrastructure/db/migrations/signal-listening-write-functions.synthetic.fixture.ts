import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {Pool,PoolClient} from 'pg';
import {startupErrorTreeV1} from './signal-listening-startup-prefix.synthetic.fixture';

export type ListeningWritePhaseV1='reserve'|'mark'|'apply';
export type ListeningWriteTemplatesV1=Record<ListeningWritePhaseV1,string>;
const phases:ListeningWritePhaseV1[]=['reserve','mark','apply'];
const MAX_FUNCTIONS=64,MAX_CAPTURE_BYTES=128*1024,MAX_RECEIPT_BYTES=2*1024*1024;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function known(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}
export function extractListeningWriteTemplatesV1(source:{labeling:string;listening:string}):ListeningWriteTemplatesV1{
 const literals=(text:string)=>[...text.matchAll(/`([^`]+)`/gu)].map(match=>match[1]!);
 const reserve=literals(source.labeling).filter(sql=>sql.startsWith('INSERT INTO signal_labeling_calls(run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,retry_depth,budget_date,budget_timezone)'));
 const mark=literals(source.labeling).filter(sql=>sql.startsWith("UPDATE signal_labeling_calls SET status='submitting',updated_at=now() WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status='reserved' RETURNING id"));
 const apply=literals(source.listening).filter(sql=>sql.startsWith('INSERT INTO signal_listening_answers(workspace_id,root_id,input_digest,entity_context_digest,'));
 known(reserve.length===1&&apply.length===1&&mark.length===2&&new Set(mark).size===1,'write_functions_source_templates');
 const templates={reserve:reserve[0]!,mark:mark[0]!,apply:apply[0]!};known(Object.values(templates).every(sql=>!sql.includes('${')),'write_functions_source_interpolation');return templates;
}
export function classifyListeningWriteV1(sql:unknown,templates:ListeningWriteTemplatesV1):ListeningWritePhaseV1|null{
 return typeof sql==='string'?phases.find(phase=>sql===templates[phase])??null:null;
}
/** Counts only synthetic bind data. Mark roots come from the unchanged Native
 * Reserve result, not from an authority/cache shortcut or a second SQL lookup. */
export function listeningWriteBatchV1(phase:ListeningWritePhaseV1,binds:unknown,rootsForMark:(ids:readonly string[])=>readonly string[]){
 known(Array.isArray(binds)&&binds.length===(phase==='reserve'?8:phase==='mark'?2:4),'write_functions_bind_count');
 const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
 let rows:unknown[],roots:unknown[];
 if(phase==='mark'){known(Array.isArray(binds[1])&&binds[1].length<=512&&binds[1].every(uuid),'write_functions_mark_ids');rows=binds[1];roots=[...rootsForMark([...binds[1]])];known(roots.length===rows.length,'write_functions_mark_roots');}
 else{const encoded=binds[phase==='reserve'?5:3];known(typeof encoded==='string'&&Buffer.byteLength(encoded)<=4*1024*1024,'write_functions_synthetic_bind_bytes');const decoded:unknown=JSON.parse(encoded);known(Array.isArray(decoded)&&decoded.length<=512,'write_functions_bind_rows');rows=decoded;roots=rows.map(value=>{known(value!==null&&typeof value==='object','write_functions_bind_record');const record=value as Record<string,unknown>;if(phase==='apply')return record.root_id;known(Array.isArray(record.inputs)&&record.inputs.length===1&&record.inputs[0]!==null&&typeof record.inputs[0]==='object','write_functions_reserve_root');return(record.inputs[0] as Record<string,unknown>).root_id;});}
 known(roots.every(uuid),'write_functions_batch_roots');return{proposed_rows:rows.length,batch_roots:new Set(roots).size,bind_count:binds.length};
}
export type WriteFunctionCounterV1={oid:string;name:string;calls:number;total_time:number;self_time:number;language:'sql'|'plpgsql'|'c'|'internal';volatility:'i'|'s'|'v';security_definer:boolean;proconfig_sha256:string;prosrc_sha256:string;signature_sha256:string};
export function writeFunctionDeltasV1(before:WriteFunctionCounterV1[],after:WriteFunctionCounterV1[]){
 known(before.length<=MAX_FUNCTIONS&&after.length<=MAX_FUNCTIONS,'write_functions_counter_cap');
 const checked=(rows:WriteFunctionCounterV1[])=>{const map=new Map<string,WriteFunctionCounterV1>();for(const row of rows){known(/^[1-9][0-9]*$/u.test(row.oid)&&!map.has(row.oid)&&[row.calls,row.total_time,row.self_time].every(value=>Number.isFinite(value)&&value>=0)&&Number.isSafeInteger(row.calls),'write_functions_counter_invalid');map.set(row.oid,row);}return map;};
 const b=checked(before),a=checked(after),ids=[...new Set([...b.keys(),...a.keys()])].sort();known(ids.length<=MAX_FUNCTIONS,'write_functions_counter_cap');
 return ids.map(oid=>{const first=b.get(oid),last=a.get(oid);if(!first||!last)return{oid,status:'UNKNOWN' as const,reason:!first?'baseline_absent' as const:'after_absent' as const,newly_created_between_samples:!first&&!!last,raw_after:last?{calls:last.calls,total_time:last.total_time,self_time:last.self_time}:null,calls:'UNKNOWN' as const,total_time:'UNKNOWN' as const,self_time:'UNKNOWN' as const};
  known(first.name===last.name&&first.prosrc_sha256===last.prosrc_sha256&&first.proconfig_sha256===last.proconfig_sha256&&first.signature_sha256===last.signature_sha256&&first.language===last.language&&first.volatility===last.volatility&&first.security_definer===last.security_definer,'write_functions_catalog_changed');
  known(last.calls>=first.calls&&last.total_time>=first.total_time&&last.self_time>=first.self_time,'write_functions_counter_decreased');return{oid,status:'known' as const,calls:last.calls-first.calls,total_time:last.total_time-first.total_time,self_time:last.self_time-first.self_time};});
}
type QueryResult={rows:Record<string,unknown>[];rowCount:number|null};
type Query=(...args:unknown[])=>unknown;
type Identity={backend:string;database:string;invoker:string;session_role:string;isolation:string;read_only:string;search_path:string;track_functions:'none'|'pl'|'all';transaction_started:string;backend_transaction_started:string};
const identitySql=`SELECT pg_backend_pid()::text backend,current_database() database,current_user invoker,session_user session_role,
 current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only,current_setting('search_path') search_path,
 current_setting('track_functions') track_functions,transaction_timestamp()::text transaction_started,a.xact_start::text backend_transaction_started
 FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_backend_pid()`;
const countersSql=`SELECT s.funcid::text oid,p.proname name,s.calls::float8 calls,s.total_time::float8 total_time,s.self_time::float8 self_time,
 l.lanname language,p.provolatile volatility,p.prosecdef security_definer,p.proconfig,p.prosrc,pg_catalog.pg_get_function_identity_arguments(p.oid) signature
 FROM pg_catalog.pg_stat_xact_user_functions s JOIN pg_catalog.pg_proc p ON p.oid=s.funcid
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' ORDER BY s.funcid LIMIT 65`;
const restoreTracking={none:"SET LOCAL track_functions='none'",pl:"SET LOCAL track_functions='pl'",all:"SET LOCAL track_functions='all'"} as const;
export type WriteFunctionsReceiptV1={contract:'r16-listening-write-functions-v1';status:'observed'|'failed'|'INCONCLUSIVE';diagnostic_only:true;h1_accepted:false;cpu:'UNKNOWN';closed:boolean;function_coverage:'TRACKED_PUBLIC_ROWS_ONLY_MISSING_UNKNOWN';captures:Array<Record<string,unknown>>;gates:{three_original_statements:boolean;native_commit_ack:boolean;identity_and_settings_restored:boolean;counters_known:boolean;no_recording_loss:boolean}};
/** Financial acceptance may tolerate absent statistics, never a missing or
 * failed write observation. Read only own data fields; no diagnostic getters. */
export function assertListeningWriteStructureV1(value:unknown):asserts value is WriteFunctionsReceiptV1{
 const bytes=(object:unknown)=>{let json:string|undefined;try{json=JSON.stringify(object);}catch{throw new Error('write_functions_structure_serialization');}known(typeof json==='string','write_functions_structure_serialization');return Buffer.byteLength(json);};
 const read=(object:unknown,key:string,optional=false):unknown=>{known(object!==null&&typeof object==='object','write_functions_structure_object');const d=Object.getOwnPropertyDescriptor(object,key);if(!d&&optional)return undefined;known(d&&'value'in d,'write_functions_structure_data');return d.value;};
 const array=(object:unknown,max:number):unknown[]=>{known(Array.isArray(object),'write_functions_structure_array');const n=read(object,'length');known(typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=max,'write_functions_structure_array_cap');const rows:unknown[]=[];for(let i=0;i<n;i++)rows.push(read(object,String(i)));return rows;};
 known(read(value,'contract')==='r16-listening-write-functions-v1'&&read(value,'diagnostic_only')===true&&read(value,'h1_accepted')===false&&read(value,'cpu')==='UNKNOWN'&&read(value,'closed')===true,'write_functions_structure_contract');
 known(bytes(value)<=MAX_RECEIPT_BYTES,'write_functions_structure_receipt_bytes');
 const gates=read(value,'gates');for(const key of ['three_original_statements','native_commit_ack','identity_and_settings_restored','no_recording_loss'])known(read(gates,key)===true,'write_functions_structure_gate');const countersKnown=read(gates,'counters_known');known(typeof countersKnown==='boolean','write_functions_structure_counters_gate');
 const captures=array(read(value,'captures'),3);known(captures.length===3,'write_functions_structure_capture_count');const seen=new Set<string>();let allKnown=true;
 for(const row of captures){known(bytes(row)<=MAX_CAPTURE_BYTES,'write_functions_structure_capture_bytes');const phase=read(row,'phase');known(typeof phase==='string'&&phases.includes(phase as ListeningWritePhaseV1)&&!seen.has(phase),'write_functions_structure_phases');seen.add(phase);
  known(read(row,'original_executions')===1&&read(row,'stage')==='committed','write_functions_structure_execution');for(const key of ['original_succeeded','result_reference_preserved','native_commit_ack','identity_same','settings_restored'])known(read(row,key)===true,'write_functions_structure_write');
  for(const key of ['safe_error_tree','failure_stage','transaction_rolled_back','capture_payload_rejected_over_bytes','capture_bytes_observed'])known(read(row,key,true)===undefined,'write_functions_structure_failure');
  const proposed=read(row,'proposed_rows'),roots=read(row,'batch_roots'),changed=read(row,'row_count'),elapsed=read(row,'elapsed_dml_ms');known(typeof proposed==='number'&&Number.isSafeInteger(proposed)&&proposed>0&&proposed<=512&&typeof roots==='number'&&Number.isSafeInteger(roots)&&roots>0&&roots<=proposed,'write_functions_structure_batch');
  known(typeof changed==='number'&&Number.isSafeInteger(changed)&&changed>=0&&typeof elapsed==='number'&&Number.isFinite(elapsed)&&elapsed>=0&&read(row,'bind_count')===(phase==='reserve'?8:phase==='mark'?2:4),'write_functions_structure_result');
  array(read(row,'before'),64);array(read(row,'after'),64);const deltas=array(read(row,'deltas'),64);if(!deltas.length)allKnown=false;
  for(const delta of deltas){const status=read(delta,'status');if(status==='UNKNOWN'){allKnown=false;known(['baseline_absent','after_absent'].includes(read(delta,'reason') as string),'write_functions_structure_unknown_reason');for(const key of ['calls','total_time','self_time'])known(read(delta,key)==='UNKNOWN','write_functions_structure_unknown_not_zero');}else{known(status==='known','write_functions_structure_delta');for(const key of ['calls','total_time','self_time']){const n=read(delta,key);known(typeof n==='number'&&Number.isFinite(n)&&n>=0,'write_functions_structure_delta_value');}}}
 }
 known(countersKnown===allKnown&&read(value,'status')===(countersKnown?'observed':'INCONCLUSIVE'),'write_functions_structure_status');
}
/** Only the store receives this adapter. Pool.query and every observer query retain
 * the original Pool; no proxy, new connection pool, replay or DML text change. */
export function createListeningWriteFunctionObserverV1(args:{database:Pool;eligible:()=>boolean;templates:ListeningWriteTemplatesV1;known_function_names:readonly string[];roots_for_mark:(ids:readonly string[])=>readonly string[]}){
 const captured=new Set<ListeningWritePhaseV1>(),active=new Set<PoolClient>(),catalogNames=new Set(args.known_function_names),captures:Array<Record<string,unknown>>=[];
 known([...catalogNames].every(name=>/^[a-z][a-z0-9_]{0,127}$/u.test(name)),'write_functions_catalog_names');
 let closed=false,failed=false;
 const receipt:WriteFunctionsReceiptV1={contract:'r16-listening-write-functions-v1',status:'INCONCLUSIVE',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',closed:false,function_coverage:'TRACKED_PUBLIC_ROWS_ONLY_MISSING_UNKNOWN',captures,gates:{three_original_statements:false,native_commit_ack:false,identity_and_settings_restored:false,counters_known:false,no_recording_loss:true}};
 const snapshot=()=>{receipt.closed=closed;receipt.gates.three_original_statements=captures.length===3&&phases.every(phase=>captures.some(row=>row.phase===phase&&row.original_executions===1&&row.original_succeeded===true));receipt.gates.native_commit_ack=captures.length===3&&captures.every(row=>row.native_commit_ack===true);receipt.gates.identity_and_settings_restored=captures.length===3&&captures.every(row=>row.identity_same===true&&row.settings_restored===true);receipt.gates.counters_known=captures.length===3&&captures.every(row=>Array.isArray(row.deltas)&&row.deltas.length>0&&row.deltas.every(delta=>(delta as {status?:unknown}).status==='known'));receipt.status=failed?'failed':closed&&Object.values(receipt.gates).every(value=>value===true)?'observed':'INCONCLUSIVE';return receipt;};
 function cap(row:Record<string,unknown>){const bytes=Buffer.byteLength(JSON.stringify(row));if(bytes<=MAX_CAPTURE_BYTES)return;failed=true;receipt.gates.no_recording_loss=false;for(const key of ['before','after','deltas'])delete row[key];row.capture_payload_rejected_over_bytes=true;row.capture_bytes_observed=bytes;throw new Error('write_functions_capture_bytes');}
 const database=Object.assign(Object.create(args.database) as Pool,{query:args.database.query.bind(args.database),connect:async()=>{
  known(!closed,'write_functions_closed');const client=await args.database.connect();known(!active.has(client),'write_functions_double_checkout');active.add(client);
  const queryDescriptor=Object.getOwnPropertyDescriptor(client,'query'),releaseDescriptor=Object.getOwnPropertyDescriptor(client,'release'),originalQuery=client.query as unknown as Query,originalRelease=client.release;
  let begun=false,uncertain=false,released=false,observing=false,primaryKnown=false,primaryError:unknown;const transactionCaptures:Array<Record<string,unknown>>=[],rollbackSecondary:unknown[]=[];
  const original=(...values:unknown[])=>Reflect.apply(originalQuery,client,values) as Promise<QueryResult>;
  const identity=async()=>{const result=await original(identitySql);known(result.rows.length===1,'write_functions_identity_rows');const row=result.rows[0]!;
   for(const key of ['backend','database','invoker','session_role','isolation','read_only','search_path','track_functions','transaction_started','backend_transaction_started'])known(typeof row[key]==='string'&&(row[key] as string).length>0,'write_functions_identity_shape');
   known(['none','pl','all'].includes(row.track_functions as string)&&['read committed','repeatable read','serializable','read uncommitted'].includes(row.isolation as string)&&row.read_only==='off','write_functions_identity_settings');return row as unknown as Identity;};
  const counters=async()=>{const rows=(await original(countersSql)).rows;known(rows.length<=MAX_FUNCTIONS,'write_functions_counter_cap');return rows.map(row=>{known(typeof row.oid==='string'&&typeof row.name==='string'&&catalogNames.has(row.name),'write_functions_unknown_catalog_function');
    known(['sql','plpgsql','c','internal'].includes(row.language as string)&&['i','s','v'].includes(row.volatility as string)&&typeof row.security_definer==='boolean'&&typeof row.prosrc==='string'&&typeof row.signature==='string'&&(row.proconfig===null||Array.isArray(row.proconfig)&&row.proconfig.every(value=>typeof value==='string')),'write_functions_catalog_shape');
    const value={oid:row.oid,name:row.name,calls:row.calls,total_time:row.total_time,self_time:row.self_time,language:row.language,volatility:row.volatility,security_definer:row.security_definer,proconfig_sha256:sha(JSON.stringify(row.proconfig)),prosrc_sha256:sha(row.prosrc),signature_sha256:sha(row.signature)} as WriteFunctionCounterV1;
    known([value.calls,value.total_time,value.self_time].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)&&Number.isSafeInteger(value.calls),'write_functions_counter_invalid');return value;});};
  const identityKey=(value:Identity)=>sha(JSON.stringify([value.backend,value.database,value.invoker,value.session_role,value.isolation,value.read_only,value.search_path,value.transaction_started,value.backend_transaction_started]));
  const wrappedQuery=function(...values:unknown[]):unknown{
   const sql=values[0];if(observing){failed=true;uncertain=true;throw new Error('write_functions_concurrent_client_query');}if(typeof sql!=='string'||typeof values.at(-1)==='function')return Reflect.apply(originalQuery,client,values);
   const phase=classifyListeningWriteV1(sql,args.templates);
   if(phase&&!captured.has(phase)&&args.eligible()){
    captured.add(phase);observing=true;const row:Record<string,unknown>={phase,template_sha256:sha(sql),bind_count:Array.isArray(values[1])?values[1].length:0,original_executions:0,original_succeeded:false,native_commit_ack:false,identity_same:false,settings_restored:false,counters:'UNKNOWN',elapsed_dml_ms:null,stage:'before'};captures.push(row);transactionCaptures.push(row);
    return(async()=>{try{known(begun,'write_functions_requires_native_begin');const beforeIdentity=await identity();Object.assign(row,listeningWriteBatchV1(phase,values[1],args.roots_for_mark));row.context={transaction_identity_sha256:identityKey(beforeIdentity),isolation:beforeIdentity.isolation,snapshot:'MAY_CHANGE_READ_COMMITTED',invoker_sha256:sha(beforeIdentity.invoker),search_path_sha256:sha(beforeIdentity.search_path),original_track_functions:beforeIdentity.track_functions,native_begin_observed:true,between_samples:'only_original_public_statement',stats_queries:'pg_catalog_only',planning_and_trigger_work_included:true};
      await original("SET LOCAL track_functions='all'");row.before=await counters();cap(row);row.stage='original';row.original_executions=1;const start=performance.now();let result:QueryResult;
      try{result=await original(...values);}finally{row.elapsed_dml_ms=performance.now()-start;}row.original_succeeded=true;
      row.stage='after';row.after=await counters();row.deltas=writeFunctionDeltasV1(row.before as WriteFunctionCounterV1[],row.after as WriteFunctionCounterV1[]);
      row.stage='restore';await original(restoreTracking[beforeIdentity.track_functions]);const afterIdentity=await identity();row.identity_same=identityKey(beforeIdentity)===identityKey(afterIdentity);row.settings_restored=afterIdentity.track_functions===beforeIdentity.track_functions;known(row.identity_same&&row.settings_restored,'write_functions_identity_or_setting_changed');
      known(result.rowCount===null||Number.isSafeInteger(result.rowCount)&&result.rowCount>=0,'write_functions_row_count');row.row_count=result.rowCount;row.result_reference_preserved=true;row.stage='awaiting_native_commit';cap(row);return result;
     }catch(primary){primaryKnown=true;primaryError=primary;failed=true;row.failure_stage=row.stage;row.safe_error_tree=startupErrorTreeV1(primary);row.stage='failed';throw primary;}finally{observing=false;}})();
   }
   return(async()=>{try{const result=await original(...values);if(/^BEGIN(?:\s|$)/u.test(sql)){known(!begun,'write_functions_nested_begin');begun=true;}else if(sql==='COMMIT'){for(const row of transactionCaptures){row.native_commit_ack=true;row.stage='committed';}transactionCaptures.length=0;begun=false;primaryKnown=false;primaryError=undefined;}else if(sql==='ROLLBACK'){for(const row of transactionCaptures){row.native_commit_ack=false;row.transaction_rolled_back=true;row.rollback_reset_confirmed=true;}transactionCaptures.length=0;begun=false;}return result;
    }catch(error){if(/^BEGIN(?:\s|$)/u.test(sql)||sql==='COMMIT'||sql==='ROLLBACK')uncertain=true;if(transactionCaptures.length){failed=true;for(const row of transactionCaptures){row.native_commit_ack=false;row.safe_error_tree??=startupErrorTreeV1(error);if(sql==='ROLLBACK')row.rollback_reset_confirmed=false;}}if(sql==='ROLLBACK'&&primaryKnown){rollbackSecondary.push(error);throw new AggregateError([primaryError,error],'write_functions_primary_and_rollback_failed',{cause:primaryError});}if(!primaryKnown){primaryKnown=true;primaryError=error;}throw error;}})();
  };
  const releaseOnce=(error?:Error|boolean)=>{
   known(!released,'write_functions_release_repeated');released=true;const secondary:unknown[]=[];
   try{if(queryDescriptor)Object.defineProperty(client,'query',queryDescriptor);else delete(client as unknown as {query?:unknown}).query;}catch(restore){secondary.push(restore);}
   try{if(releaseDescriptor)Object.defineProperty(client,'release',releaseDescriptor);else delete(client as unknown as {release?:unknown}).release;}catch(restore){secondary.push(restore);}
   try{originalRelease.call(client,uncertain||begun||secondary.length>0?true:error);}catch(release){secondary.push(release);}finally{active.delete(client);}
   if(secondary.length){failed=true;const combined=primaryKnown?new AggregateError([primaryError,...rollbackSecondary,...secondary],'write_functions_primary_and_cleanup_failed',{cause:primaryError}):secondary.length===1?secondary[0]:new AggregateError(secondary,'write_functions_cleanup_failed');throw combined;}
  };
  try{Object.defineProperty(client,'query',{configurable:true,writable:true,value:wrappedQuery});Object.defineProperty(client,'release',{configurable:true,writable:true,value:releaseOnce});return client;
  }catch(primary){failed=true;uncertain=true;primaryKnown=true;primaryError=primary;releaseOnce(true);throw primary;}

 }});
 return{database,snapshot,close(){known(!closed,'write_functions_close_repeated');closed=true;if(active.size!==0)failed=true;known(active.size===0,'write_functions_client_still_borrowed');for(const row of captures)cap(row);snapshot();}};
}
