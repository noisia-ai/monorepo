import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {materializeSignalTopicEditorialExecutionV1 as materialize,materializeSignalTopicEditorialWorkerExecutionV1 as worker} from './signal-topic-editorial-materialization';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner={workspace_id:id(1),actor_user_id:id(2),execution_id:id(3)};
const hash=(value:string)=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
function fixture(){
 const body=JSON.stringify({contract_version:'signal-topic-editorial-runner-v1',phase:'completed',execution_key:owner.execution_id,global:{result:{concepts:[{concept_key:'routine'}]}}});
 let status='review_ready',raw=body,digest=hash(body),count='1652',allowed=true,materialized=false,loseAck=false;let connections=0,writes=0;
 const trace:string[]=[];
 const client={query:async(sql:string,params?:unknown[])=>{trace.push(sql);
  if(sql.startsWith('SELECT workspace_id,actor_user_id')){assert.deepEqual(params,[owner.execution_id,`topic-editorial-${owner.execution_id}-1`]);return{rows:allowed?[owner]:[]};}
  if(sql.startsWith('SELECT status,state_body')){assert.deepEqual(params,[owner.execution_id,owner.workspace_id,owner.actor_user_id]);assert.match(sql,/signal_brand_context_processing_actor_v1\(\$2,\$3\)/u);
   return{rows:allowed?[{status,state_body:raw,state_digest:digest,expected_group_count:count}]:[]};}
  if(sql.startsWith('SELECT materialize_signal_topic_editorial_successor_v1')){
   assert.deepEqual(params,[owner.workspace_id,owner.actor_user_id,owner.execution_id,hash(body)]);
   const replayed=materialized;materialized=true;status='completed';writes++;
   return{rows:[{value:{contract_version:'signal-topic-editorial-materialization-v1',execution_id:owner.execution_id,revision_id:id(4),revision:1,status:'completed',concept_count:1,decision_count:1652,topic_count:1,narrative_count:0,noise_count:1651,unresolved_count:0,target_range_met:false,activation:'not_activated',replayed}}]};}
  if(sql==='COMMIT'&&materialized&&loseAck){loseAck=false;throw Error('connection interrupted after commit');}
  return{rows:[]};},release:()=>{connections--;}} as unknown as PoolClient;
 const database={connect:async()=>{connections++;return client;}};
 return{database,trace,get writes(){return writes;},get connections(){return connections;},loseAck:()=>{loseAck=true;},
  alter:(kind:string)=>{if(kind==='status')status='running';if(kind==='digest')digest=hash('changed');if(kind==='owner')allowed=false;if(kind==='count')count='0';if(kind==='body'){raw=JSON.stringify({phase:'completed',execution_key:id(9)});digest=hash(raw);}}};
}
test('Studio and Worker share scoped provider-free materialization from the exact sealed owner state',async()=>{
 const f=fixture();const first=await materialize({database:f.database,...owner});
 assert.equal(first.status,'completed');assert.equal(first.activation,'not_activated');assert.equal(first.replayed,false);
 const replay=await worker({database:f.database,execution_id:owner.execution_id,worker_job_id:`topic-editorial-${owner.execution_id}-1`});
 assert.equal(replay.revision_id,first.revision_id);assert.equal(replay.replayed,true);assert.equal(f.connections,0);
 assert.doesNotMatch(f.trace.join('\n'),/reserve_|mark_sent_|admission|provider|serving|selection/iu);
});
test('owner drift, damaged state and invalid coverage stop before materialization',async()=>{
 for(const kind of ['status','digest','owner','count','body']){const f=fixture();f.alter(kind);
  await assert.rejects(materialize({database:f.database,...owner}),/materialization_(scope_invalid|state_invalid|not_ready)/u);
  assert.equal(f.writes,0);assert.equal(f.connections,0);}
 const foreign=fixture();foreign.alter('owner');await assert.rejects(worker({database:foreign.database,execution_id:owner.execution_id,worker_job_id:`topic-editorial-${owner.execution_id}-1`}),/scope_invalid/u);
 assert.equal(foreign.writes,0);assert.equal(foreign.connections,0);
});
test('lost commit acknowledgement retries the already validated revision without another editorial execution',async()=>{
 const f=fixture();f.loseAck();await assert.rejects(materialize({database:f.database,...owner}),/connection interrupted/u);
 const replay=await materialize({database:f.database,...owner});assert.equal(replay.replayed,true);assert.equal(replay.revision_id,id(4));assert.equal(f.connections,0);
 assert.equal(f.trace.filter(sql=>sql.startsWith('SELECT materialize_')).length,2);
});
