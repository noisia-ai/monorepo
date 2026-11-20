import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {syntheticClientWorkspaceFixtureV1,syntheticImportedWorkspaceFixtureV1,type SyntheticTransactionV1} from './signal-client-workspace-entry.synthetic.fixture';

const identity={organization_id:'00000000-0000-4000-8000-000000000001',brand_id:'00000000-0000-4000-8000-000000000002',actor_user_id:'00000000-0000-4000-8000-000000000003',workspace_id:'00000000-0000-4000-8000-000000000004'};
const timestamp='2026-01-01T00:00:00.123456Z';
function capture(){
 const statements:{sql:string;values:unknown[]|undefined}[]=[];
 const stop=new Error('stop_at_real_preparation_connection');
 const query=async(sql:string,values?:unknown[])=>{statements.push({sql,values});return {rows:sql.startsWith('SELECT id FROM signal_workspaces')?[{id:identity.workspace_id}]:[],rowCount:1};};
 let atPreparation:typeof statements|undefined;
 const database={connect:async()=>{atPreparation=statements.slice();throw stop;}} as unknown as Pool;
 const tx:SyntheticTransactionV1={database,scoped:{} as PoolClient,query:query as never,cleanup:async()=>{}};
 return {tx,statements,stop,atPreparation:()=>atPreparation};
}
for(const explicit of [false,true])test(`timestamp seed ${explicit?'retains microseconds':'default adds no mutation'} before real preparation admission`,async()=>{
 const fixture=capture();
 await assert.rejects(syntheticClientWorkspaceFixtureV1(fixture.tx,{identity,...(explicit?{seed_published_at:timestamp}:{})}),error=>error===fixture.stop);
 const before=fixture.atPreparation();assert.ok(before,'the actual fixture reaches the real preparation connection only after import');
 const seeds=before.filter(row=>row.sql.startsWith('UPDATE mentions SET published_at='));
 assert.equal(seeds.length,explicit?1:0);
 assert.equal(before.filter(row=>row.sql.startsWith('INSERT INTO mentions')).length,3);
 if(explicit){
  const seed=seeds[0]!;assert.equal(before.at(-1),seed,'timestamp seed completes before preparation is admitted');
  assert.deepEqual(seed.values?.filter(value=>value===timestamp),[timestamp]);
  assert.equal(seed.values?.[0],identity.workspace_id);
  assert.match(seed.sql,/workspace_id=\$1 AND data_source_id=\$2 AND source_file_id=\$4/u);
  const source=before.find(row=>row.sql.startsWith('INSERT INTO data_sources'))!.values![0];
  const batch=before.find(row=>row.sql.startsWith('INSERT INTO import_batches'))!.values![0];
  assert.deepEqual(seed.values,[identity.workspace_id,source,timestamp,batch]);
 }
 assert.ok(before.every(row=>!row.sql.includes('UPDATE signal_corpus_preparation')&&!row.sql.includes('UPDATE signal_mass_labeling')),'seed never repairs freshness or frozen map state');
});
test('malformed synthetic timestamp is rejected before any source write',async()=>{
 for(const invalid of ['2026-01-01T00:00:00Z','2026-01-01T00:00:00.123Z',timestamp+"';SELECT 1"]){
  const fixture=capture();await assert.rejects(syntheticImportedWorkspaceFixtureV1(fixture.tx,identity,{seed_published_at:invalid}));assert.equal(fixture.statements.length,0);
 }
});
