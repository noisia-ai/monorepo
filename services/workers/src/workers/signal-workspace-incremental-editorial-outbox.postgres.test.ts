import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME} from '@noisia/query-engine';
import {drainSignalTopicClassificationOutboxV1,topicExecutionJobNameV1} from './signal-topic-classification-outbox';
import {SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME as editorialJob} from './signal-workspace-incremental-editorial-job';

const url=process.env.NOISIA_INCREMENTAL_EDITORIAL_OUTBOX_TEST_DATABASE_URL;
test('real outbox SQL preserves failed editorial owners and recovers only an admitted durable dispatch',{
  skip:!url,timeout:30_000,
},async()=>{
  const parsed=new URL(url!);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname),'local database required');
  assert.match(parsed.pathname,/^\/noisia_[a-z0-9_]+$/u);
  const client=new pg.Client({connectionString:url,ssl:false});await client.connect();
  const workspace=randomUUID(),actor=randomUUID();
  try {
    await client.query('BEGIN');
    // Session-local shadows only. No migration, public fixture, provider or Redis.
    await client.query(`CREATE TEMP TABLE signal_topic_catalog_executions(
      id uuid PRIMARY KEY,workspace_id uuid,actor_user_id uuid,input_contract text,status text,
      input_snapshot jsonb DEFAULT '{}',error_code text,completed_at timestamptz,updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE signal_topic_classification_outbox(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid,workspace_id uuid,worker_job_id text,
      dispatch_kind text DEFAULT 'execution',attempt_count int DEFAULT 0,status text DEFAULT 'pending',
      error_code text,lease_token uuid,lease_expires_at timestamptz,available_at timestamptz DEFAULT now(),
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),dispatched_at timestamptz);`);
    assert.equal((await client.query("SELECT relnamespace=pg_my_temp_schema() temporary FROM pg_class WHERE oid='signal_topic_catalog_executions'::regclass")).rows[0].temporary,true);
    async function seed(status:string,outboxStatus:string,code:string|null=null,attempts=0,contract='workspace-incremental-editorial-v1') {
      const id=randomUUID(),job=`signal-workspace-incremental-editorial-${id}-1`;
      await client.query('INSERT INTO signal_topic_catalog_executions(id,workspace_id,actor_user_id,input_contract,status,error_code) VALUES($1,$2,$3,$4,$5,$6)',[id,workspace,actor,contract,status,code]);
      await client.query('INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id,status,error_code,attempt_count) VALUES($1,$2,$3,$4,$5,$6)',[id,workspace,job,outboxStatus,code,attempts]);
      return{id,job};
    }
    const waiting=await seed('queued','pending');
    const semantic=await seed('failed','failed','workspace_engine_interpretation_output_invalid',8);
    const unknown=await seed('failed','failed','workspace_engine_interpretation_outcome_unknown');
    const recoverable=await seed('failed','failed','workspace_incremental_editorial_transport_unavailable');
    const ready=await seed('ready','failed');
    const legacy=await seed('queued','pending',null,0,'legacy-topic-catalog-v1');
    const exhausted=await seed('queued','failed','workspace_incremental_editorial_transport_unavailable',8);
    const jobs=new Map<string,{name:string;getState:()=>Promise<string>;retry:()=>Promise<void>}>();
    const adds:string[]=[],retried:string[]=[];
    let loseAck=true;
    const queue={getJob:async(id:string)=>jobs.get(id),add:async(name:string,data:unknown,options:Record<string,unknown>)=>{
      const id=String(options.jobId);adds.push(id);
      assert.deepEqual(data,{execution_id:id===legacy.job?legacy.id:waiting.id});
      assert.equal(name,id===legacy.job?SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME:editorialJob);
      assert.equal(options.attempts,id===legacy.job?2:1);
      jobs.set(id,{name,getState:async()=> 'waiting',retry:async()=>{retried.push(id);}});
      if(id===waiting.job&&loseAck){loseAck=false;throw Object.assign(new Error('simulated accepted Redis ACK loss'),{code:'ECONNRESET'});}
    }};
    const database={query:client.query.bind(client)} as never;
    const drain=()=>drainSignalTopicClassificationOutboxV1({database,queue,schedule:async()=>({requeued:0})});
    assert.deepEqual(await drain(),{claimed:2,dispatched:1,failed:1,dead_lettered:0});
    assert.equal(adds.filter(id=>id===waiting.job).length,1);
    const dead=(await client.query('SELECT execution.status,execution.error_code,outbox.status dispatch FROM signal_topic_catalog_executions execution JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id WHERE execution.id=$1',[exhausted.id])).rows[0];
    assert.deepEqual(dead,{status:'failed',error_code:'workspace_incremental_editorial_transport_unavailable',dispatch:'dead_letter'});
    for(const row of [semantic,unknown,recoverable,ready]){
      const stored=(await client.query('SELECT status,error_code,attempt_count FROM signal_topic_classification_outbox WHERE execution_id=$1',[row.id])).rows[0];
      assert.equal(stored.status,'failed');assert.equal(stored.attempt_count,row===semantic?8:0);
    }
    assert.equal((await client.query('SELECT error_code FROM signal_topic_classification_outbox WHERE execution_id=$1',[waiting.id])).rows[0].error_code,'workspace_incremental_editorial_transport_unavailable');
    await client.query('UPDATE signal_topic_classification_outbox SET available_at=now() WHERE execution_id=$1',[waiting.id]);
    assert.deepEqual(await drain(),{claimed:1,dispatched:1,failed:0,dead_lettered:0});
    assert.equal(adds.filter(id=>id===waiting.job).length,1);assert.equal(retried.length,0);
    // Model the state produced by the separately PG-tested explicit requeue API.
    // A failed consumer is never automatically made eligible by the drainer.
    await client.query("UPDATE signal_topic_catalog_executions SET status='queued' WHERE id=$1",[recoverable.id]);
    await client.query("UPDATE signal_topic_classification_outbox SET status='pending' WHERE execution_id=$1",[recoverable.id]);
    jobs.set(recoverable.job,{name:editorialJob,getState:async()=> 'failed',retry:async()=>{retried.push(recoverable.job);}});
    assert.deepEqual(await drain(),{claimed:1,dispatched:1,failed:0,dead_lettered:0});
    assert.deepEqual(retried,[recoverable.job]);assert.equal(adds.includes(recoverable.job),false);
    const failed=(await client.query('SELECT status,error_code FROM signal_topic_catalog_executions WHERE id=$1',[unknown.id])).rows[0];
    assert.equal(failed.status,'failed');assert.equal(failed.error_code,'workspace_engine_interpretation_outcome_unknown');
    assert.equal(topicExecutionJobNameV1('workspace-incremental-editorial-v1'),editorialJob);
    assert.throws(()=>topicExecutionJobNameV1('workspace-incremental-editorial-v1',false,'engine_progress'),/contract_unknown/u);
    assert.throws(()=>topicExecutionJobNameV1('workspace-incremental-editorial-v1',false,'incremental_projection'),/contract_unknown/u);
  } finally {await client.query('ROLLBACK').catch(()=>undefined);await client.end();}
});
