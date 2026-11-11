import assert from "node:assert/strict";
import type {Pool,PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import {drainSignalTopicClassificationOutboxV1} from "../../../services/workers/src/workers/signal-topic-classification-outbox";

/** Adverse transport-only shadows preserve real native actor/feature authority.
 * No production trigger is disabled and every shadow is rolled back. */
export async function assertNativePaidReplayOutboxV2(args:{database:Pool;client:PoolClient;execution_id:string}){
 const {client,execution_id}=args;
 await client.query('BEGIN');
 try{
  await client.query('SET LOCAL search_path=pg_temp,public,extensions,pg_catalog');
  for(const table of ['signal_mass_labeling_global_receipt_decisions','engine_cost_events','signal_corpus_preparation_input_state'])
   await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
  await client.query('INSERT INTO pg_temp.signal_mass_labeling_global_receipt_decisions SELECT * FROM public.signal_mass_labeling_global_receipt_decisions WHERE execution_id=$1',[execution_id]);
  await client.query('INSERT INTO pg_temp.engine_cost_events SELECT * FROM public.engine_cost_events WHERE catalog_execution_id=$1',[execution_id]);
  await client.query(`INSERT INTO pg_temp.signal_corpus_preparation_input_state SELECT s.* FROM public.signal_corpus_preparation_input_state s
    JOIN public.signal_topic_catalog_executions e ON e.workspace_id=s.workspace_id WHERE e.id=$1`,[execution_id]);
  const scoped={query:client.query.bind(client),connect:async()=>{throw Error('unexpected nested transport transaction');}} as unknown as Pool;
  let sends=0;
  const drain=()=>drainSignalTopicClassificationOutboxV1({database:scoped,schedule:async()=>({requeued:0}),queue:{getJob:async()=>null,add:async()=>{sends++;throw Error('invalid replay must stay held');}}});
  const cases:Array<[string,string,unknown[]]>=[
   ['foreign workspace','UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET workspace_id=$1',[randomUUID()]],
   ['foreign actor','UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET created_by_user_id=$1',[randomUUID()]],
   ['foreign execution','UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET execution_id=$1',[randomUUID()]],
   ['foreign call','UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET call_id=$1',[randomUUID()]],
   ['changed input',"UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET input_digest='sha256:'||repeat('0',64)",[]],
   ['changed fit',"UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET fit_checkpoint_digest='sha256:'||repeat('0',64)",[]],
   ['changed source',"UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET source_groups_digest='sha256:'||repeat('0',64)",[]],
   ['changed decision',"UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET decision=jsonb_set(decision,'{request_digest}',to_jsonb('sha256:'||repeat('0',64)))",[]],
   ['legacy decision',`UPDATE pg_temp.signal_mass_labeling_global_receipt_decisions SET decision=jsonb_set(decision,'{contract_version}','"workspace-mass-labeling-receipt-recovery-v1"')`,[]],
   ['unsettled raw',"UPDATE pg_temp.engine_cost_events SET call_state='response_persisted' WHERE metadata ? 'mass_labeling_stage'",[]],
   ['incomplete raw',`UPDATE pg_temp.engine_cost_events SET metadata=jsonb_set(metadata,'{response_complete}','false') WHERE metadata ? 'mass_labeling_stage'`,[]],
   ['missing raw',"UPDATE pg_temp.engine_cost_events SET response_storage_key=NULL WHERE metadata ? 'mass_labeling_stage'",[]],
   ['changed raw',"UPDATE pg_temp.engine_cost_events SET response_sha256='sha256:'||repeat('0',64) WHERE metadata ? 'mass_labeling_stage'",[]],
   ['stale source','UPDATE pg_temp.signal_corpus_preparation_input_state SET input_revision=input_revision+1',[]],
  ];
  for(const [name,query,values] of cases){
   await client.query('SAVEPOINT held_replay');
   try{await client.query(query,values);assert.deepEqual(await drain(),{claimed:0,dispatched:0,failed:0,dead_lettered:0},name);}
   finally{await client.query('ROLLBACK TO SAVEPOINT held_replay');}
  }
  assert.equal(sends,0);
  await client.query("UPDATE public.signal_topic_classification_outbox SET status='failed',attempt_count=8 WHERE execution_id=$1",[execution_id]);
  await drain();
  const stopped=(await client.query(`SELECT e.status,o.status dispatch FROM public.signal_topic_catalog_executions e
    JOIN public.signal_topic_classification_outbox o ON o.execution_id=e.id WHERE e.id=$1`,[execution_id])).rows[0];
  assert.deepEqual(stopped,{status:'failed',dispatch:'dead_letter'});
 }finally{await client.query('ROLLBACK');}
}
