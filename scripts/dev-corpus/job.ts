import { createRequire } from 'node:module';
import { queueNameForJob } from './recovery.mjs';
const requireWorker=createRequire(new URL('../../services/workers/package.json',import.meta.url));
/** Finite real BullMQ execution, on the dedicated private Redis only. */
export async function runJob(name:string,id:string,data:unknown,handler:(job:any)=>Promise<unknown>, retryFailed=false) {
  const {Queue,QueueEvents,Worker}=requireWorker('bullmq');
  const endpoint=new URL(process.env.REDIS_URL!);
  if (endpoint.hostname!=='mfp-redis.railway.internal') throw new Error('mfp_redis_target_mismatch');
  const connection={host:endpoint.hostname,port:Number(endpoint.port),username:decodeURIComponent(endpoint.username)||undefined,password:decodeURIComponent(endpoint.password),maxRetriesPerRequest:null};
  const queueName=queueNameForJob(id);
  const queue=new Queue(queueName,{connection}), events=new QueueEvents(queueName,{connection});
  const worker=new Worker(queueName,async(job:any)=>{
    if(job.name!==name || job.id!==id) throw new Error('mfp_unexpected_job');
    return handler(job);
  },{connection,concurrency:1});
  try {
    await events.waitUntilReady();
    const job=await queue.add(name,data,{jobId:id,attempts:1,removeOnComplete:false,removeOnFail:false});
    if(await job.getState()==='failed'){
      if(!retryFailed)throw new Error('mfp_queue_retry_required');
      await job.retry();
    }
    return await job.waitUntilFinished(events,600000);
  } finally {await worker.close();await events.close();await queue.close();}
}
