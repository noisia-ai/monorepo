export declare const MAIN_THREAD_PROFILE_INTERVAL_US_V1: 10000;
export declare const MAIN_THREAD_PROFILE_MAX_BYTES_V1: number;
export declare const MAIN_THREAD_CLK_TCK_TIMEOUT_MS_V1: 2000;
export declare function readClockTicksV1(exec?:(file:string,args:string[],options:Record<string,unknown>)=>string|Buffer):number;
export declare function parseMainThreadProcStatLineV1<T>(text:string,parseProcStatV1:(line:string)=>T):T;
export declare function createProcMainThreadCpuReaderV1(options:{pid?:number;isMainThread?:boolean;
  parseProcStatV1:(text:string)=>{pid:number;comm:string;state:string;utime_ticks:string;stime_ticks:string;starttime_ticks:string};
  readText?:(path:string)=>string;getClockTicks?:()=>string|number}):()=>Promise<{status:string;[key:string]:unknown}>;
export declare function compareProcMainThreadCpuV1(start:unknown,end:unknown):{status:'captured'|'unknown';[key:string]:unknown};
export declare function sanitizeV8MainThreadProfileV1(profile:unknown): {
  contract:'r16-v8-main-thread-profile-v1';profiler:'V8 CPU sampling';interval_us:10000;
  v8_start_time_us:number;v8_end_time_us:number;
  nodes:Array<{id:number;function_name:string;hit_count:number;children:number[]}>;
  samples:number[];time_deltas_us:number[];urls_embedded:false;source_text_embedded:false;raw_query_or_values_recorded:false;
};
export declare function createMainThreadProfileCaptureV1(options?:{
  sessionFactory?:()=>{connect():void;disconnect():void;post(method:string,paramsOrCallback?:unknown,callback?:((error:Error|null,result?:unknown)=>void)):void};
  monotonicNs?:()=>bigint;cpuUsage?:()=>{user:number;system:number};resourceUsage?:()=>Record<string,number>;
  threadCpuReader?:()=>Promise<unknown>|unknown;isMainThread?:boolean;maxProfileBytes?:number;
}):{
  start():Promise<{window_start_ns:string;start_call:{start_ns:string;end_ns:string;duration_ns:string};start_samples:unknown;
    scope:'classification_and_serving';inspector_coverage:'main_thread_only'}>;
  stop(outputPath:string):Promise<Record<string,unknown>>;
  readonly state:'created'|'connected'|'recording'|'stopped'|'failed';
};
