import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {fork,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {monitorEventLoopDelay,PerformanceObserver,performance} from 'node:perf_hooks';
import {join} from 'node:path';
export const STORE_OPERATIONS=new Set(['inputs','calls','reserve','markSubmitting','persistRawPage','persistRaw','settlePage','settle','apply','finish','claim','release']);
const INNER_PLAN_QUERY_LABELS=new Map([
 ['sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680','metadata'],
 ['sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04','hydrate'],
]);
const PLAN_NUMBERS=['Plan Rows','Plan Width','Actual Rows','Actual Loops','Startup Cost','Total Cost','Actual Startup Time','Actual Total Time',
 'Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks','Temp Read Blocks','Temp Written Blocks'];
const PLAN_NAMES=['Node Type','Relation Name','Alias','Index Name','Join Type'];
const SAFE_CTE_NAMES=new Set(['allowed_roots','selected_items','items','prepared','qs']);
const SAFE_NODE_TYPES=new Set(['Aggregate','Append','Bitmap Heap Scan','Bitmap Index Scan','CTE Scan','Custom Scan','Foreign Scan','Function Scan',
 'Gather','Gather Merge','GroupAggregate','Hash','HashAggregate','Hash Join','Incremental Sort','Index Only Scan','Index Scan','Limit','LockRows',
 'Materialize','Memoize','Merge Append','Merge Join','ModifyTable','Nested Loop','ProjectSet','Recursive Union','Result','Sample Scan','Seq Scan',
 'SetOp','Sort','Subquery Scan','Tid Scan','Unique','Values Scan','WindowAgg','WorkTable Scan']);
export function queryHash(value:unknown){const sql=typeof value==='string'?value:(value as {text?:unknown})?.text;return typeof sql==='string'?'sha256:'+createHash('sha256').update(sql.replace(/\s+/gu,' ').trim()).digest('hex'):null;}
function safeName(value:unknown){return typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u.test(value)?value:'redacted';}
function safePlanNode(value:any):any{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const result:Record<string,unknown>={};
 for(const key of PLAN_NAMES)if(value[key]!==undefined)result[key]=key==='Node Type'
  ?(typeof value[key]==='string'&&SAFE_NODE_TYPES.has(value[key])?value[key]:'redacted'):safeName(value[key]);
 for(const key of ['CTE Name','Subplan Name'])if(typeof value[key]==='string'&&SAFE_CTE_NAMES.has(value[key]))result[key]=value[key];
 for(const key of PLAN_NUMBERS)if(typeof value[key]==='number'&&Number.isFinite(value[key]))result[key]=value[key];
 for(const key of ['Parallel Aware','Async Capable'])if(typeof value[key]==='boolean')result[key]=value[key];
 if(Array.isArray(value.Plans))result.Plans=value.Plans.map(safePlanNode).filter(Boolean);
 return result;
}
/** Parses the NOTICE only in memory. Raw PostgreSQL messages and text fields are never retained. */
export function safeAutoExplainNotice(notice:unknown){
 const message=(notice as {message?:unknown}|null)?.message;
 if(typeof message!=='string'||message.length>1_000_000)return null;
 const planKey=message.search(/"Plan"\s*:/u);if(planKey<0)return null;
 const start=message.lastIndexOf('{',planKey);if(start<0)return null;
 try{
  const parsed=JSON.parse(message.slice(start));
  const plan=safePlanNode(parsed?.Plan);if(!plan)return null;
  return{planning_time_ms:typeof parsed['Planning Time']==='number'&&Number.isFinite(parsed['Planning Time'])?parsed['Planning Time']:null,
    execution_time_ms:typeof parsed['Execution Time']==='number'&&Number.isFinite(parsed['Execution Time'])?parsed['Execution Time']:null,plan};
 }catch{return null;}
}
export function innerPlanQueryLabel(hash:string|null){return hash?INNER_PLAN_QUERY_LABELS.get(hash)??null:null;}
export function assertInnerPlanCaptureGuard(env:NodeJS.ProcessEnv,database:string,role:string){
 if(env.GITHUB_ACTIONS!=='true'||env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true'||database!=='noisia_mfp_ci'||role!=='postgres')
  throw Error('observer_inner_plan_capture_denied');
 const url=new URL(env.DATABASE_URL??'');
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.pathname!=='/noisia_mfp_ci'||url.username!=='postgres'||!url.port||url.search||url.hash)
  throw Error('observer_inner_plan_capture_denied');
}
export function verifiedInnerPlanScopeV1(identity:any,database:string,role:string){
 return identity?.database===database&&identity?.role===role&&identity?.isolation==='repeatable read'&&identity?.read_only==='on'&&identity?.superuser===true;
}
/** Capture a single original SELECT inside a verified RR/RO transaction. Setup failures roll back to the owned savepoint and do not retry setup. */
export async function captureInnerPlanQueryV1(args:{client:any;query:()=>Promise<any>;query_hash:string;root_count:number;database:string;role:string}){
 const {client,query,query_hash,root_count,database,role}=args;
 const label=innerPlanQueryLabel(query_hash);
 if(!label||root_count<1024)return{result:await query(),observation:null};
 assertInnerPlanCaptureGuard(process.env,database,role);
 const started=performance.now(),notices:any[]=[];let savepoint=false,setupStage='savepoint',result:any,queryError:unknown,queryElapsed=0;
 const onNotice=(notice:unknown)=>{const plan=safeAutoExplainNotice(notice);if(plan&&notices.length<1)notices.push(plan);};
 client.on('notice',onNotice);
 const rollback=async()=>{if(savepoint){await client.query('ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1');await client.query('RELEASE SAVEPOINT r16_inner_plan_capture_v1');savepoint=false;}};
 try{
  try{
   await client.query('SAVEPOINT r16_inner_plan_capture_v1');savepoint=true;
   setupStage='verify_transaction_scope';
   const verified=await client.query(`SELECT current_database() AS database,current_user AS role,
    current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only,
    r.rolsuper AS superuser FROM pg_roles r WHERE r.rolname=current_user`);
   if(!verifiedInnerPlanScopeV1(verified.rows?.[0],database,role))throw Error('capture_scope_unverified');
   setupStage='logging_configuration';
   await client.query("SET LOCAL log_min_messages = 'WARNING'");
   await client.query("SET LOCAL client_min_messages = 'NOTICE'");
   await client.query("SET LOCAL log_statement = 'none'");
   await client.query('SET LOCAL log_parameter_max_length = 0');
   setupStage='load_auto_explain';
   await client.query("LOAD 'auto_explain'");
   setupStage='auto_explain_configuration';
   await client.query('SET LOCAL auto_explain.log_parameter_max_length = 0');
   await client.query("SET LOCAL auto_explain.log_level = 'NOTICE'");
   await client.query('SET LOCAL auto_explain.log_min_duration = 0');
   await client.query('SET LOCAL auto_explain.log_nested_statements = on');
   await client.query('SET LOCAL auto_explain.log_analyze = on');
   await client.query('SET LOCAL auto_explain.log_buffers = on');
   await client.query('SET LOCAL auto_explain.log_timing = off');
   await client.query("SET LOCAL auto_explain.log_format = 'json'");
   await client.query('SET LOCAL auto_explain.log_verbose = off');
  }catch{
   await rollback();
   const queryStarted=performance.now();const original=await query();queryElapsed=performance.now()-queryStarted;
   const captureWall=performance.now()-started;
   const reason=setupStage==='verify_transaction_scope'?'transaction_scope_unverified':setupStage==='load_auto_explain'
    ?'auto_explain_load_unavailable':'capture_setup_unavailable';
   return{result:original,observation:{query_hash,label,status:'inner_plan_unavailable',reason,capture_wall_ms:captureWall,instrumentation_overhead_ms:Math.max(0,captureWall-queryElapsed),overhead_included:true}};
  }
  const queryStarted=performance.now();try{result=await query();}catch(error){queryError=error;}finally{queryElapsed=performance.now()-queryStarted;}
  await rollback();
  if(queryError)throw queryError;
  const captureWall=performance.now()-started;
  return{result,observation:{query_hash,label,status:notices.length?'captured':'plan_notice_unavailable',capture_wall_ms:captureWall,
    instrumentation_overhead_ms:Math.max(0,captureWall-queryElapsed),overhead_included:true,...(notices[0]?{plan:notices[0]}:{})}};
 }finally{
  if(savepoint){await rollback();}
  client.off('notice',onNotice);
 }
}
export function safeWaitRow(row:any){
 if(!Number.isSafeInteger(row.pid)||row.pid<1)throw Error('observer_invalid_pid');
 const event=(x:unknown)=>x===null?null:typeof x==='string'&&/^[a-zA-Z0-9_]{1,80}$/u.test(x)?x:'redacted';
 return{pid:row.pid,wait_event_type:event(row.wait_event_type),wait_event:event(row.wait_event),blocking_pids:Array.isArray(row.blocking_pids)?row.blocking_pids.filter((x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0):[]};
}
export function boundedEvents(limit=200000){const events:unknown[]=[];let dropped=0;return{push(event:unknown){if(events.length<limit)events.push(event);else dropped++;},snapshot:()=>({events:[...events],dropped,limit})};}
export async function closeOwnedChild(child:ChildProcess){
 if(child.exitCode!==null||child.signalCode!==null)return;
 await new Promise<void>(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
 const timer=setTimeout(()=>{child.kill('SIGKILL');},3000);child.once('exit',finish);child.once('error',finish);
 if(child.connected)child.send({kind:'stop'},()=>{});else child.kill('SIGTERM');});
}
export async function finishListeningObserver<T>(observer:{close():Promise<void>;snapshot():T}){await observer.close();return observer.snapshot();}
export function createListeningObserver(){
 const performanceOrigin=performance.now(),origin=process.hrtime.bigint(),now=()=>Number(process.hrtime.bigint()-origin)/1e6,events=boundedEvents(),scope=new AsyncLocalStorage<string>();
 const delay=monitorEventLoopDelay({resolution:20});delay.enable();
 let previous=now();const heartbeat=setInterval(()=>{const at=now();events.push({kind:'heartbeat',at_ms:at,gap_ms:at-previous,heap:process.memoryUsage(),resource:process.resourceUsage()});previous=at;},250);
 const gc=new PerformanceObserver(list=>{for(const entry of list.getEntries())events.push({kind:'gc',at_ms:now(),start_ms:entry.startTime-performanceOrigin,end_ms:entry.startTime-performanceOrigin+entry.duration,duration_ms:entry.duration,gc_kind:(entry as any).detail?.kind??null});});gc.observe({entryTypes:['gc']});
 let closing=false;const detach:Array<()=>void>=[];let child:ChildProcess|undefined;const pids=new Set<number>();let samplerStatus='not_started';
 let planRootCount=0;const planCounts=new Map<string,number>(),planObservations:unknown[]=[];
 function pid(value:any){if(Number.isSafeInteger(value?.processID)&&value.processID>0&&!pids.has(value.processID)){pids.add(value.processID);if(child?.connected)child.send({kind:'pids',pids:[...pids]},()=>{});}}
 function query(owner:any){return async(...args:any[])=>{pid(owner);const start=now(),op=scope.getStore()??'unlabeled',hash=queryHash(args[0]);try{
  const label=innerPlanQueryLabel(hash),count=label?(planCounts.get(hash!)??0):0;
  if(label&&planRootCount>=1024&&count<2&&typeof owner.on==='function'&&typeof owner.off==='function'){
   planCounts.set(hash!,count+1);
   const captured=await captureInnerPlanQueryV1({client:owner,query:()=>owner.query(...args),query_hash:hash!,root_count:planRootCount,database:'noisia_mfp_ci',role:'postgres'});
   if(captured.observation)planObservations.push(captured.observation);return captured.result;
  }
  return await owner.query(...args);
 }finally{events.push({kind:'query',operation:op,hash,pid:Number.isSafeInteger(owner.processID)?owner.processID:null,start_ms:start,end_ms:now()});}};}
 return{
 wrapDatabase(database:any){database.on?.('acquire',pid);detach.push(()=>database.off?.('acquire',pid));return new Proxy(database,{get(target,key){if(key==='query')return query(target);if(key==='connect')return async()=>{const c=await target.connect();pid(c);return new Proxy(c,{get(t,k){if(k==='query')return query(t);const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});},
 wrapStore(store:any){return new Proxy(store,{get(t,k){const value=Reflect.get(t,k);if(typeof k!=='string'||!STORE_OPERATIONS.has(k)||typeof value!=='function')return typeof value==='function'?value.bind(t):value;return async(...args:any[])=>{const operation=k==='calls'&&Array.isArray(args[1]?.call_ids)?'hydrate':k;const start=now();try{return await scope.run(operation,()=>value.apply(t,args));}finally{events.push({kind:'store',operation,start_ms:start,end_ms:now()});}};}});},
 async startSampler(args:{target:string;url:string;database:string}){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true')throw Error('observer_sampler_ci_only');
  const url=new URL(args.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='postgresql:'||!/^noisia_[a-z0-9_]+$/u.test(args.database))throw Error('observer_sampler_target_invalid');
  samplerStatus='starting';child=fork(fileURLToPath(import.meta.url),['--sampler'],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true'},execArgv:process.execArgv});
  child.on('message',(m:any)=>{if(m?.kind==='waits'&&Array.isArray(m.rows)){try{events.push({kind:'pg_waits',at_ms:m.at_ms,rows:m.rows.map(safeWaitRow)});}catch{samplerStatus='invalid_sample';}}else if(m?.kind==='ready')samplerStatus='ready';else if(m?.kind==='failed')samplerStatus='failed';});
  child.on('error',()=>{samplerStatus='failed';});child.on('exit',()=>{if(!closing)samplerStatus='exited_early';});child.send({kind:'init',...args,origin:String(origin),pids:[...pids]},()=>{});
 },
 setInnerPlanRootCount(value:number){if(!Number.isSafeInteger(value)||value<0)throw Error('observer_invalid_root_count');planRootCount=value;},
 snapshot(){return{contract_version:'r16-neutral-observer-v1',...events.snapshot(),sampler_status:samplerStatus,fixture_pids:[...pids],inner_plan_observations:[...planObservations],event_loop_delay_ms:{min:delay.count?delay.min/1e6:0,max:delay.max/1e6,mean:delay.count?delay.mean/1e6:0,p50:delay.percentile(50)/1e6,p99:delay.percentile(99)/1e6},diagnostic_only:true,h1_accepted:false};},
 async close(){closing=true;clearInterval(heartbeat);gc.disconnect();delay.disable();for(const remove of detach)remove();if(child)await closeOwnedChild(child);},
 };
}
async function sampler(){
 let pool:any,stopped=false,ids:number[]=[],origin=0n,timer:ReturnType<typeof setTimeout>|undefined;
 const send=(m:unknown)=>{if(process.connected)process.send?.(m);};
 async function close(){if(stopped)return;stopped=true;clearTimeout(timer);await pool?.end().catch(()=>{});if(process.connected)process.disconnect?.();}
 process.on('disconnect',()=>{void close();});
 process.on('message',async(m:any)=>{try{
  if(m?.kind==='stop'){await close();return;}
  if(m?.kind==='pids'){ids=m.pids.filter((x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0);return;}
  if(m?.kind!=='init'||pool)return;
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true')throw Error('denied');
  const url=new URL(m.url);if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||!/^noisia_[a-z0-9_]+$/u.test(m.database))throw Error('denied');url.pathname='/'+m.database;
  const require=createRequire(join(m.target,'infrastructure/db/package.json'));const {Pool}=require('pg');
  pool=new Pool({connectionString:url.href,ssl:false,max:1,connectionTimeoutMillis:2000,statement_timeout:1000,application_name:'r16-neutral-wait-sampler'});
  origin=BigInt(m.origin);ids=m.pids;const check=await pool.query('SELECT current_database() database');if(check.rows[0]?.database!==m.database)throw Error('denied');send({kind:'ready'});
  const sample=async()=>{if(stopped)return;try{const result=await pool.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blocking_pids FROM pg_stat_activity WHERE datname=$1 AND pid=ANY($2::int[])`,[m.database,ids]);send({kind:'waits',at_ms:Number(process.hrtime.bigint()-origin)/1e6,rows:result.rows.map(safeWaitRow)});}catch{send({kind:'failed'});}if(!stopped)timer=setTimeout(()=>{void sample();},250);};void sample();
 }catch{send({kind:'failed'});await close();}});
}
if(process.argv.includes('--sampler'))await sampler();
