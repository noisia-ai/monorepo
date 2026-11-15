import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {openR16LocalPostgresV1,openR16CiPostgresV1} from './signal-r16-local-pg.fixture';
import {createMassLabelingConcurrencyDatabaseV1} from './signal-mass-labeling-concurrent.synthetic.fixture';
import {syntheticImportedWorkspaceFixtureV1} from './signal-client-workspace-entry.synthetic.fixture';

test('attribution invalidation preserves canonical roots and outbox with bounded identity lookups',{
 skip:process.env.NOISIA_R16_IMPORT_INVALIDATION_PG!=='true',timeout:600000},async()=>{
 const admin=await(process.env.GITHUB_ACTIONS==='true'?openR16CiPostgresV1():openR16LocalPostgresV1()),clone=await createMassLabelingConcurrencyDatabaseV1(admin),c=await clone.pool.connect();
 try{
  await c.query('BEGIN');const tx={database:clone.pool,scoped:c,query:c.query.bind(c),cleanup:async()=>{}};
  const started=performance.now(),first=await syntheticImportedWorkspaceFixtureV1(tx,undefined,{root_count:1537,batch_size:512});
  const second=await syntheticImportedWorkspaceFixtureV1(tx,undefined,{root_count:3,batch_size:3}),imported=performance.now()-started;
  const census=(await c.query(`SELECT (SELECT count(*) FROM mentions WHERE workspace_id=$1)::int mentions,
   (SELECT count(*) FROM signal_mention_attributions WHERE workspace_id=$1)::int attributions,
   (SELECT count(*) FROM signal_mention_import_memberships WHERE workspace_id=$1)::int memberships,
   (SELECT count(*) FROM signal_semantic_review_projection_dirty_roots WHERE workspace_id=$1)::int dirty,
   (SELECT dirty_root_count FROM signal_semantic_review_projection_state WHERE workspace_id=$1) state`,[first.workspace_id])).rows[0];
  assert.deepEqual(census,{mentions:1537,attributions:1537,memberships:1537,dirty:1537,state:1537});
  const duplicate=randomUUID();await c.query(`INSERT INTO mentions SELECT(jsonb_populate_record(NULL::mentions,to_jsonb(m)||jsonb_build_object(
   'id',$2::uuid,'canonical_mention_id',m.id,'provider_record_id',$2::uuid::text,'external_id',$2::uuid::text,'text_hash','sha256:'||repeat('f',64)))).*
   FROM mentions m WHERE m.id=$1`,[first.roots[0],duplicate]);
  const pendingBatch=randomUUID();await c.query(`INSERT INTO import_batches SELECT(jsonb_populate_record(NULL::import_batches,to_jsonb(b)||jsonb_build_object(
   'id',$2::uuid,'status','pending','source_file_hash','sha256:'||repeat('e',64)))).* FROM import_batches b WHERE b.id=$1`,[first.batch_id,pendingBatch]);
  // Exercise the actual trigger with a transition relation, including malformed
  // tenant identities, without weakening the attribution-table admission guards.
  await c.query(`CREATE TEMP TABLE attribution_transition_probe(workspace_id uuid,mention_id uuid,import_batch_id uuid,attribution_basis text);
   CREATE TRIGGER attribution_transition_probe_insert AFTER INSERT ON attribution_transition_probe REFERENCING NEW TABLE AS new_rows
   FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_semantic_review_from_attributions_v1()`);
  const legacyFile=await readFile(new URL('./0082_signal_semantic_review_resolution_scale.sql',import.meta.url),'utf8'),a=legacyFile.indexOf('CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_from_attributions_v1()');
  const legacy=legacyFile.slice(a,legacyFile.indexOf('DROP TRIGGER IF EXISTS trg_signal_semantic_review_attribution_insert',a));
  const current=(await c.query<{body:string}>(`SELECT pg_get_functiondef('invalidate_signal_semantic_review_from_attributions_v1()'::regprocedure) body`)).rows[0]!.body;
  const row=(workspace_id:string,mention_id:string,import_batch_id:string|null,attribution_basis='source_intent')=>({workspace_id,mention_id,import_batch_id,attribution_basis});
  const cases=[
   [row(first.workspace_id,first.roots[0]!,first.batch_id)],
   [row(first.workspace_id,duplicate,first.batch_id),row(first.workspace_id,first.roots[0]!,first.batch_id)],
   [row(first.workspace_id,first.roots[1]!,pendingBatch)],
   [row(first.workspace_id,first.roots[1]!,pendingBatch,'mention_semantic')],
   [row(first.workspace_id,first.roots[2]!,null,'mention_semantic'),row(second.workspace_id,second.roots[0]!,second.batch_id)],
   [row(second.workspace_id,first.roots[0]!,second.batch_id)],
  ];
  const snapshots=[];
  for(const definition of [legacy,current]){
   await c.query('SAVEPOINT invalidation_arm');await c.query(definition);const arm=[];
   for(const rows of cases){
    for(const table of ['signal_semantic_review_projection_dirty_roots','signal_semantic_review_projection_outbox','signal_semantic_review_projection_state'])await c.query(`DELETE FROM ${table} WHERE workspace_id=ANY($1::uuid[])`,[[first.workspace_id,second.workspace_id]]);
    for(let attempt=0;attempt<2;attempt++)await c.query(`INSERT INTO attribution_transition_probe SELECT * FROM jsonb_to_recordset($1::jsonb)
     AS r(workspace_id uuid,mention_id uuid,import_batch_id uuid,attribution_basis text)`,[JSON.stringify(rows)]);
    arm.push({dirty:(await c.query('SELECT workspace_id,mention_id,reason FROM signal_semantic_review_projection_dirty_roots ORDER BY workspace_id,mention_id')).rows,
     state:(await c.query('SELECT workspace_id,status,full_rebuild_required,dirty_root_count,last_reason FROM signal_semantic_review_projection_state ORDER BY workspace_id')).rows,
     outbox:(await c.query('SELECT workspace_id,status,reason,count(*)::int copies FROM signal_semantic_review_projection_outbox GROUP BY workspace_id,status,reason ORDER BY workspace_id')).rows});
   }snapshots.push(arm);await c.query('ROLLBACK TO SAVEPOINT invalidation_arm');await c.query('RELEASE SAVEPOINT invalidation_arm');
  }
  assert.deepEqual(snapshots[1],snapshots[0],'canonical, duplicate, semantic, incomplete-import, tenant and retry cases preserve historical invalidation');
  assert.equal(snapshots[1]![1]!.dirty.length,1);assert.equal(snapshots[1]![2]!.dirty.length,0);assert.equal(snapshots[1]![3]!.dirty.length,1);assert.equal(snapshots[1]![5]!.dirty.length,0);
  assert.ok(snapshots[1]!.every(x=>x.outbox.every(o=>o.copies===1)));
  const plan=(await c.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT canonical.id FROM(VALUES($1::uuid,$2::uuid)) changed(workspace_id,mention_id)
   CROSS JOIN LATERAL(SELECT observed.workspace_id,observed.canonical_mention_id FROM mentions observed
    WHERE observed.workspace_id=changed.workspace_id AND observed.id=changed.mention_id OFFSET 0) observed
   CROSS JOIN LATERAL(SELECT root.id FROM mentions root WHERE root.workspace_id=observed.workspace_id
    AND root.id=observed.canonical_mention_id OFFSET 0) canonical`,[first.workspace_id,first.roots[0]])).rows[0]!['QUERY PLAN'][0].Plan;
  const scans:Array<Record<string,unknown>>=[];const visit=(n:Record<string,unknown>)=>{if(n['Relation Name']==='mentions')scans.push(n);for(const child of(n.Plans??[])as Array<Record<string,unknown>>)visit(child);};visit(plan);
  assert.equal(scans.length,2);assert.ok(scans.every(n=>n['Actual Loops']===1&&n['Actual Rows']===1));assert.ok(Number(plan['Shared Hit Blocks'])<100);
  console.log('# attribution lookup roots=1537 import_ms='+Math.round(imported)+' lookup_shared_hits='+plan['Shared Hit Blocks']+' equivalent_cases='+cases.length);
  await c.query('ROLLBACK');
 }finally{await c.query('ROLLBACK').catch(()=>undefined);c.release();await clone.cleanup();await admin.end();}
});
