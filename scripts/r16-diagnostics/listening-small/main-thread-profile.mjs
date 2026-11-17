import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import inspector from 'node:inspector';
import {open,mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {hrtime,cpuUsage,resourceUsage} from 'node:process';
import {isMainThread} from 'node:worker_threads';

export const MAIN_THREAD_PROFILE_INTERVAL_US_V1=10_000;
export const MAIN_THREAD_PROFILE_MAX_BYTES_V1=32*1024*1024;
export const MAIN_THREAD_CLK_TCK_TIMEOUT_MS_V1=2_000;

const plainObject=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const monotonicNs=()=>hrtime.bigint();
const safeCpu=(value)=>{
  assert.ok(plainObject(value),'main_thread_profile_cpu_sample_invalid');
  for(const key of ['user','system'])assert.ok(Number.isSafeInteger(value[key])&&value[key]>=0,'main_thread_profile_cpu_sample_invalid');
  return{user_us:value.user,system_us:value.system,total_us:value.user+value.system};
};
const safeResource=(value)=>{
  assert.ok(plainObject(value),'main_thread_profile_resource_sample_invalid');
  const allowed=['userCPUTime','systemCPUTime','maxRSS','sharedMemorySize','unsharedDataSize','unsharedStackSize','minorPageFault','majorPageFault',
    'swappedOut','fsRead','fsWrite','ipcSent','ipcReceived','signalsCount','voluntaryContextSwitches','involuntaryContextSwitches'];
  const result={};
  for(const key of allowed){
    const item=value[key];
    assert.ok(Number.isSafeInteger(item)&&item>=0,'main_thread_profile_resource_sample_invalid');
    result[key]=item;
  }
  return result;
};

export function readClockTicksV1(exec=execFileSync){
 const raw=exec('getconf',['CLK_TCK'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:MAIN_THREAD_CLK_TCK_TIMEOUT_MS_V1,maxBuffer:128});
 const ticksPerSecond=Number(String(raw).trim());
 assert.ok(Number.isSafeInteger(ticksPerSecond)&&ticksPerSecond>0&&ticksPerSecond<=10_000_000,'main_thread_proc_clk_tck_invalid');
 return ticksPerSecond;
}

export function createProcMainThreadCpuReaderV1(options={}){
  const pid=options.pid??process.pid,mainThread=options.isMainThread??isMainThread;
  const parse=options.parseProcStatV1,readText=options.readText??((path)=>readFileSync(path,'utf8'));
  const getClockTicks=options.getClockTicks??(()=>readClockTicksV1(options.execFileSync??execFileSync));
  assert.ok(typeof parse==='function','main_thread_proc_parser_missing');
  if(!mainThread)return async()=>({status:'unknown',reason:'not_main_thread'});
  const ticksPerSecond=Number(String(getClockTicks()).trim());
  assert.ok(Number.isSafeInteger(ticksPerSecond)&&ticksPerSecond>0&&ticksPerSecond<=10_000_000,'main_thread_proc_clk_tck_invalid');
  return async()=>{
    const before=monotonicNs();
    const task=parse(readText(`/proc/self/task/${pid}/stat`));
    const process=parse(readText('/proc/self/stat'));
    const after=monotonicNs();
    assert.equal(task.pid,pid,'main_thread_proc_task_pid_mismatch');
    assert.equal(process.pid,pid,'main_thread_proc_process_pid_mismatch');
    assert.equal(task.starttime_ticks,process.starttime_ticks,'main_thread_proc_identity_mismatch');
    const user=BigInt(task.utime_ticks),system=BigInt(task.stime_ticks);
    assert.ok(user>=0n&&system>=0n,'main_thread_proc_cpu_counter_invalid');
    return{status:'captured',source:'proc_main_thread_task_stat',pid,starttime_ticks:task.starttime_ticks,
      user_ticks:user.toString(),system_ticks:system.toString(),total_ticks:(user+system).toString(),ticks_per_second:ticksPerSecond,
      read_bracket:{start_ns:before.toString(),end_ns:after.toString(),duration_ns:(after-before).toString()}};
  };
}

export function compareProcMainThreadCpuV1(start,end){
  if(!start||!end||start.status!=='captured'||end.status!=='captured')return{status:'unknown',reason:'main_thread_cpu_sample_missing'};
  if(start.pid!==end.pid||start.starttime_ticks!==end.starttime_ticks||start.ticks_per_second!==end.ticks_per_second)
    return{status:'unknown',reason:'main_thread_identity_changed'};
  const user=BigInt(end.user_ticks)-BigInt(start.user_ticks),system=BigInt(end.system_ticks)-BigInt(start.system_ticks);
  if(user<0n||system<0n)return{status:'unknown',reason:'main_thread_cpu_counter_decreased'};
  return{status:'captured',pid:start.pid,starttime_ticks:start.starttime_ticks,ticks_per_second:start.ticks_per_second,
    user_ticks:user.toString(),system_ticks:system.toString(),total_ticks:(user+system).toString(),
    conversion:'ticks_only_no_wall_clock_attribution'};
}

export function sanitizeV8MainThreadProfileV1(profile){
  assert.ok(plainObject(profile)&&Array.isArray(profile.nodes)&&Array.isArray(profile.samples)&&Array.isArray(profile.timeDeltas),
    'main_thread_profile_format_invalid');
  assert.ok(profile.nodes.length>0&&profile.nodes.length<=800_000,'main_thread_profile_node_count_invalid');
  assert.ok(profile.samples.length>0&&profile.samples.length<=800_000,'main_thread_profile_sample_count_invalid');
  assert.equal(profile.timeDeltas.length,profile.samples.length,'main_thread_profile_sample_delta_count_mismatch');
  assert.ok(Number.isFinite(profile.startTime)&&Number.isFinite(profile.endTime)&&profile.endTime>profile.startTime,
    'main_thread_profile_v8_range_invalid');
  const nodes=profile.nodes.map((node)=>{
    assert.ok(plainObject(node)&&Number.isSafeInteger(node.id)&&node.id>0&&plainObject(node.callFrame),
      'main_thread_profile_node_invalid');
    const name=node.callFrame.functionName;
    assert.ok(typeof name==='string'&&name.length<=256&&!/[\u0000-\u001f\u007f]/u.test(name),
      'main_thread_profile_function_name_invalid');
    const children=node.children??[];
    assert.ok(Array.isArray(children)&&children.length<=800_000
      &&children.every((child)=>Number.isSafeInteger(child)&&child>0),'main_thread_profile_children_invalid');
    const hitCount=node.hitCount??0;
    assert.ok(Number.isSafeInteger(hitCount)&&hitCount>=0,'main_thread_profile_hit_count_invalid');
    return{id:node.id,function_name:name,hit_count:hitCount,children:[...children]};
  });
  const ids=new Set(nodes.map((node)=>node.id));
  assert.equal(ids.size,nodes.length,'main_thread_profile_duplicate_node_id');
  const samples=profile.samples.map((sample)=>{
    assert.ok(Number.isSafeInteger(sample)&&ids.has(sample),'main_thread_profile_sample_node_missing');return sample;
  });
  const timeDeltas=profile.timeDeltas.map((delta)=>{
    assert.ok(Number.isSafeInteger(delta)&&delta>=0,'main_thread_profile_time_delta_invalid');return delta;
  });
  return{contract:'r16-v8-main-thread-profile-v1',profiler:'V8 CPU sampling',interval_us:MAIN_THREAD_PROFILE_INTERVAL_US_V1,
    v8_start_time_us:profile.startTime,v8_end_time_us:profile.endTime,nodes,samples,time_deltas_us:timeDeltas,
    urls_embedded:false,source_text_embedded:false,raw_query_or_values_recorded:false};
}

function post(session,method,params){
  return new Promise((resolvePromise,reject)=>{
    const done=(error,result)=>error?reject(new Error(`main_thread_profile_${method.toLowerCase().replaceAll('.','_')}_failed`)):resolvePromise(result??{});
    if(params===undefined)session.post(method,done);else session.post(method,params,done);
  });
}

export function createMainThreadProfileCaptureV1(options={}){
  const sessionFactory=options.sessionFactory??(()=>new inspector.Session());
  const clock=options.monotonicNs??monotonicNs;
  const cpuUsageFn=options.cpuUsage??cpuUsage;
  const resourceUsageFn=options.resourceUsage??resourceUsage;
  const threadCpuReader=options.threadCpuReader??null;
  const mainThread=options.isMainThread??isMainThread;
  const maxProfileBytes=options.maxProfileBytes??MAIN_THREAD_PROFILE_MAX_BYTES_V1;
  assert.ok(Number.isSafeInteger(maxProfileBytes)&&maxProfileBytes>0&&maxProfileBytes<=MAIN_THREAD_PROFILE_MAX_BYTES_V1,
    'main_thread_profile_max_bytes_invalid');
  let session=null,state='created',startSamples=null,startCall=null,windowStartNs=null;
  let stopPromise=null;

  const readSnapshot=async()=>{
    const before=clock();
    const cpu=safeCpu(cpuUsageFn());
    const resource=safeResource(resourceUsageFn());
    let thread={status:'unknown',reason:'main_thread_reader_unavailable'};
    if(mainThread&&typeof threadCpuReader==='function'){
      try{thread=await threadCpuReader();}catch{thread={status:'unknown',reason:'main_thread_reader_failed'};}
    }else if(!mainThread)thread={status:'unknown',reason:'not_main_thread'};
    const after=clock();
    return{clock:'process.hrtime.bigint',read_bracket:{start_ns:before.toString(),end_ns:after.toString(),duration_ns:(after-before).toString()},
      process_cpu:cpu,process_resource_usage:resource,main_thread_cpu:thread};
  };

  async function start(){
    assert.equal(state,'created','main_thread_profile_start_state_invalid');
    assert.equal(mainThread,true,'main_thread_profile_requires_main_thread');
    session=sessionFactory();
    session.connect();state='connected';
    try{
      await post(session,'Profiler.enable');
      await post(session,'Profiler.setSamplingInterval',{interval:MAIN_THREAD_PROFILE_INTERVAL_US_V1});
      const before=clock();await post(session,'Profiler.start');const after=clock();
      startCall={start_ns:before.toString(),end_ns:after.toString(),duration_ns:(after-before).toString()};
      startSamples=await readSnapshot();windowStartNs=clock();state='recording';
      return{window_start_ns:windowStartNs.toString(),start_call:startCall,start_samples:startSamples,
        scope:'classification_and_serving',inspector_coverage:'main_thread_only'};
    }catch(error){
      state='failed';try{session.disconnect();}catch{}
      throw error;
    }
  }

  async function stop(outputPath){
    if(stopPromise)return stopPromise;
    stopPromise=(async()=>{
      assert.equal(state,'recording','main_thread_profile_stop_state_invalid');
      const endSamples=await readSnapshot();const windowEndNs=clock();
      const before=clock();let stopped;let primaryError;
      try{stopped=await post(session,'Profiler.stop');}catch(error){primaryError=error;}
      const after=clock();
      let disconnectError;
      try{session.disconnect();}catch{disconnectError=new Error('main_thread_profile_disconnect_failed');}
      state='stopped';
      if(primaryError&&disconnectError)throw new AggregateError([primaryError,disconnectError],'main_thread_profile_stop_and_disconnect_failed');
      if(primaryError)throw primaryError;if(disconnectError)throw disconnectError;
      const profile=sanitizeV8MainThreadProfileV1(stopped?.profile);
      const bytes=Buffer.from(`${JSON.stringify(profile)}\n`,'utf8');
      assert.ok(bytes.byteLength>0&&bytes.byteLength<=maxProfileBytes,'main_thread_profile_size_limit_exceeded');
      const path=resolve(outputPath);await mkdir(dirname(path),{recursive:true});
      const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
      return{contract:'r16-main-thread-profile-capture-v1',status:'captured',path,bytes:bytes.byteLength,
        sha256:createHash('sha256').update(bytes).digest('hex'),scope:'classification_and_serving_boundary_bracketed',coverage:'main_thread_only',
        process_scope:'whole_process_all_threads',worker_thread_cpu:'unknown',
        window:{clock:'process.hrtime.bigint',start_ns:windowStartNs.toString(),end_ns:windowEndNs.toString(),
          elapsed_ns:(windowEndNs-windowStartNs).toString(),
          sampling_window_relation:'inspector_start_precedes_workload_and_stop_follows; exact_cross_clock_overlap_unknown',
          profile_sampling_overlap:'unknown_v8_clock_bridge',
          start_call:startCall,stop_call:{start_ns:before.toString(),end_ns:after.toString(),duration_ns:(after-before).toString()}},
        process_cpu:{start:startSamples.process_cpu,end:endSamples.process_cpu,
          delta_us:{user:endSamples.process_cpu.user_us-startSamples.process_cpu.user_us,
            system:endSamples.process_cpu.system_us-startSamples.process_cpu.system_us,
            total:endSamples.process_cpu.total_us-startSamples.process_cpu.total_us},
          resource_usage_start:startSamples.process_resource_usage,resource_usage_end:endSamples.process_resource_usage,
          resource_usage_max_rss_scope:'process_lifetime_high_water_kib',main_thread_start:startSamples.main_thread_cpu,
          main_thread_end:endSamples.main_thread_cpu,
          main_thread_delta:compareProcMainThreadCpuV1(startSamples.main_thread_cpu,endSamples.main_thread_cpu)},
        sampling:{interval_us:MAIN_THREAD_PROFILE_INTERVAL_US_V1,per_sample_overhead:'unknown',
          start_stop_control_overhead_measured:true,heap_profile:false,capacity_claim:false},
        v8_profile:{start_time_us:profile.v8_start_time_us,end_time_us:profile.v8_end_time_us,
          sample_count:profile.samples.length,node_count:profile.nodes.length,clock_bridge:'unknown',
          sample_time_is_not_exact_cpu:true,source_text_embedded:false,urls_embedded:false}};
    })();
    return stopPromise;
  }
  return{start,stop,get state(){return state;}};
}
