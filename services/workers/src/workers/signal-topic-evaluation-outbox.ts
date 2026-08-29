import type { Pool } from "pg";

import { SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION,
  SIGNAL_TOPIC_EVALUATION_JOB_NAME } from "@noisia/query-engine";

type QueueLike = { add(name:string,data:unknown,options:Record<string,unknown>):Promise<unknown> };
type Options={database?:Pick<Pool,"connect">;queue?:QueueLike;interval_ms?:number;
  run_immediately?:boolean;enabled?:boolean};

export async function drainSignalTopicEvaluationOutboxV1(options:Options={}){
  if ((options.enabled ?? process.env.NOISIA_TOPIC_EVALUATION_ENABLED === "true") !== true) {
    return {claimed:0,dispatched:0,dead_lettered:0};
  }
  const database=options.database??(await import("../db/client")).pool;
  const queue=options.queue??(await import("../queues/data-os")).dataOsProducer;
  const client=await database.connect();
  let row:{run_id:string;worker_job_id:string}|undefined;
  try{
    await client.query("BEGIN");
    const claimed=await client.query<{run_id:string;worker_job_id:string}>(`WITH candidate AS(
      SELECT run_id FROM signal_topic_evaluation_outbox
      WHERE status='pending' AND dispatch_count=0 ORDER BY created_at,run_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE signal_topic_evaluation_outbox outbox SET status='dispatched',dispatch_count=1,
      dispatched_at=clock_timestamp() FROM candidate WHERE outbox.run_id=candidate.run_id
      RETURNING outbox.run_id::text,outbox.worker_job_id`);
    row=claimed.rows[0];await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  if(!row)return{claimed:0,dispatched:0,dead_lettered:0};
  try{
    await queue.add(SIGNAL_TOPIC_EVALUATION_JOB_NAME,{contract_version:SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION,
      run_id:row.run_id},{jobId:row.worker_job_id,attempts:1,removeOnComplete:{age:1_209_600,count:100},
      removeOnFail:{age:2_592_000,count:100}});
    return{claimed:1,dispatched:1,dead_lettered:0};
  }catch(error){
    const failure=await database.connect();try{await failure.query(`UPDATE signal_topic_evaluation_outbox
      SET status='dead_letter',error_code=$2 WHERE run_id=$1::uuid AND status='dispatched'`,
    [row.run_id,safeError(error)]);}finally{failure.release();}
    return{claimed:1,dispatched:0,dead_lettered:1};
  }
}

export function startSignalTopicEvaluationOutboxDrainerV1(options:Options={}){
  const enabled=options.enabled ?? process.env.NOISIA_TOPIC_EVALUATION_ENABLED === "true";
  if(!enabled){
    return{drainNow:()=>Promise.resolve({claimed:0,dispatched:0,dead_lettered:0}),
      close:async()=>undefined};
  }
  let closed=false;let inFlight:Promise<unknown>|null=null;
  const drainNow=()=>{if(closed)return Promise.resolve();if(inFlight)return inFlight;
    inFlight=drainSignalTopicEvaluationOutboxV1(options).finally(()=>{inFlight=null;});return inFlight;};
  const timer=setInterval(()=>{void drainNow();},options.interval_ms??5_000);timer.unref?.();
  if(options.run_immediately!==false)void drainNow();
  return{drainNow,close:async()=>{closed=true;clearInterval(timer);await inFlight;}};
}
function safeError(error:unknown){return(error instanceof Error?error.name:"unknown_error").slice(0,120);}
