import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {r16NativeCommitBoundaryV1,createR16PutFaultV1} from './listening-fault-injections';
import {startR16HttpFilesystemStorageV1} from './http-filesystem-storage';
import {createWorkspaceEngineStorageV1,buildWorkspaceEngineStorageKeyV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
test('precommit failure executes ROLLBACK instead of COMMIT; ACK loss follows real COMMIT',async()=>{
 for(const mode of['rollback_before_commit','ack_after_commit']as const){
  const sql:string[]=[];let durable=false;
  const query=async(statement:string)=>{sql.push(statement);durable=statement==='COMMIT';return{durable};};
  await assert.rejects(r16NativeCommitBoundaryV1('COMMIT',mode,query),mode==='rollback_before_commit'?/precommit_rollback/:/commit_ack_lost/);
  assert.deepEqual(sql,[mode==='rollback_before_commit'?'ROLLBACK':'COMMIT']);assert.equal(durable,mode==='ack_after_commit');
 }
 let calls=0;const result=await r16NativeCommitBoundaryV1('SELECT 1','rollback_before_commit',async sql=>{calls++;return sql;});
 assert.equal(result,'SELECT 1');assert.equal(calls,1);
});
test('put rejection writes zero blobs and preserves no raw stash; ACK loss leaves exact remotely readable bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r16-write-boundary-')),server=await startR16HttpFilesystemStorageV1(join(directory,'objects'));
 try{
  const bytes=Buffer.from('{"synthetic":"exact observed bytes"}\n'),file=join(directory,'page.jsonl');await writeFile(file,bytes);
  const sha256='sha256:'+createHash('sha256').update(bytes).digest('hex'),workspace_id=randomUUID(),execution_id=randomUUID();
  const base=createWorkspaceEngineStorageV1({url:server.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
  const input={workspace_id,execution_id,file,sha256,size_bytes:bytes.length,media_type:'application/x-ndjson'};
  const storage_key=buildWorkspaceEngineStorageKeyV1(workspace_id,execution_id,'page.jsonl',sha256),stored={storage_key,sha256,size_bytes:bytes.length,media_type:input.media_type};
  const rejected=createR16PutFaultV1(base,'reject_before_put');await assert.rejects(rejected.storage.put(input),/rejected_before_blob/);
  assert.equal(server.metrics().object_puts,0);assert.ok(rejected.injected);
  await assert.rejects(base.get({workspace_id,execution_id,stored,destination:join(directory,'missing')}));
  // A different case's actual successful put creates the blob. Nothing in the
  // rejected case retains/reuploads the file to manufacture recovery.
  const ack=createR16PutFaultV1(base,'ack_after_put');await assert.rejects(ack.storage.put(input),/storage_ack_lost/);
  assert.ok(server.metrics().object_puts>0);const puts=server.metrics().object_puts;
  const destination=join(directory,'recovered');await base.get({workspace_id,execution_id,stored,destination});
  assert.deepEqual(await readFile(destination),bytes);assert.equal(server.metrics().object_puts,puts,'ACK recovery must only read existing bytes');
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});

test('one-of-three page and transaction oracles select only the affected IDs, not unrelated sibling states',async()=>{
 const {selectR16AffectedCallsV1:select,r16AffectedPageMembersV1:members}=await import('./listening-fault-injections');
 const rows=[{id:'a',results_applied:false},{id:'b',results_applied:true},{id:'c',results_applied:true}];
 const one=members({sha256:'page-sha',member_count:1},'page-sha',['a']);assert.deepEqual(one,['a']);
 assert.ok(select(rows,one).every(row=>!row.results_applied),'single rolled-back page ignores committed siblings');
 assert.ok(select(rows,['b','c']).every(row=>row.results_applied),'committed transaction subset ignores rolled-back sibling');
 assert.throws(()=>members({sha256:'page-sha',member_count:3},'page-sha',['a']),/affected_page_invalid/);
 assert.throws(()=>members({sha256:'other',member_count:1},'page-sha',['a']),/affected_page_invalid/);
 for(const ids of[[],['a','a'],['foreign']])assert.throws(()=>select(rows,ids),/affected_calls_invalid/);
 assert.throws(()=>select([...rows,rows[0]!],['a']),/affected_calls_invalid/);
});
