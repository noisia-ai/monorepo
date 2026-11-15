import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {fork,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {monitorEventLoopDelay,PerformanceObserver,performance} from 'node:perf_hooks';
import {join} from 'node:path';
export const STORE_OPERATIONS=new Set(['inputs','calls','reserve','markSubmitting','persistRawPage','persistRaw','settlePage','settle','apply','finish','claim','release']);
export function queryHash(value:unknown){const sql=typeof value==='string'?value:(value as {text?:unknown})?.text;return typeof sql==='string'?'sha256:'+createHash('sha256').update(sql.replace(/\s+/gu,' ').trim()).digest('hex'):null;}
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
 function pid(value:any){if(Number.isSafeInteger(value?.processID)&&value.processID>0&&!pids.has(value.processID)){pids.add(value.processID);if(child?.connected)child.send({kind:'pids',pids:[...pids]},()=>{});}}
 function query(owner:any){return async(...args:any[])=>{pid(owner);const start=now(),op=scope.getStore()??'unlabeled',hash=queryHash(args[0]);try{return await owner.query(...args);}finally{events.push({kind:'query',operation:op,hash,pid:Number.isSafeInteger(owner.processID)?owner.processID:null,start_ms:start,end_ms:now()});}};}
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
 snapshot(){return{contract_version:'r16-neutral-observer-v1',...events.snapshot(),sampler_status:samplerStatus,fixture_pids:[...pids],event_loop_delay_ms:{min:delay.count?delay.min/1e6:0,max:delay.max/1e6,mean:delay.count?delay.mean/1e6:0,p50:delay.percentile(50)/1e6,p99:delay.percentile(99)/1e6},diagnostic_only:true,h1_accepted:false};},
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
