import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {loadMentionFacetsStatusV1} from '../signal-labeling-runs';
import {loadMentionFacetBrowserV1,type LabelingDatabaseV1} from '../signal-mention-facets';
import {loadConceptMembershipsStatusV1} from '../signal-concept-memberships';
import {loadSignalWorkspaceTopicProjectionStatusWithQueryableV1} from '../signal-workspace-topic-projection';
const projectionReader=(args:Parameters<typeof loadMentionFacetsStatusV1>[0])=>loadSignalWorkspaceTopicProjectionStatusWithQueryableV1({...args,queryable:args.database});
const id='10000000-0000-4000-8000-000000000001';
async function capturePanelQuery(reader: typeof loadMentionFacetsStatusV1 | typeof loadMentionFacetBrowserV1 | typeof loadConceptMembershipsStatusV1 | typeof projectionReader) {
      const captured: {sql:string;params:unknown[]}[]=[];
      const sentinel=new Error('captured actual panel query');
      const mock={release(){},async query(sql:string,params:unknown[]=[]):Promise<{rows:any[]}>{
        if(sql.includes('WITH roots AS MATERIALIZED')||sql.includes('WITH display_roots AS MATERIALIZED')||sql.includes('membership-status-items')||sql.includes('WITH runs AS MATERIALIZED')){
          captured.push({sql,params});throw sentinel;
        }
        if(sql.includes('workspace.status workspace_status'))return {rows:[{workspace_status:'active',brand_status:'active',actor_status:'active',
          user_type:'noisia_internal',primary_role:'noisia_admin',organization_status:'active',brand_same_organization:true}]};
        if(sql.includes('transaction_timestamp()'))return {rows:[{observed_at:'2026-10-11T12:00:00Z'}]};
        if(sql.includes('AS brand_name'))return {rows:[{workspace_id:id,brand_id:id,brand_name:'Example',brand_slug:'example'}]};
        if(sql.includes("'primary_brand'::text AS scope"))return {rows:[{scope:'primary_brand',entity_id:id,entity_label:'Example',aliases:[],disambiguation:null}]};
        if(sql.includes('SELECT EXISTS(SELECT 1 FROM signal_workspace_features'))return {rows:[{enabled:true}]};
        return {rows:[]};
      }};
      const database={connect:async()=>mock,query:mock.query} as unknown as LabelingDatabaseV1;
      await assert.rejects(reader({database,workspace_id:id,actor_user_id:id,limit:30}),error=>error===sentinel);
      assert.equal(captured.length,1);
      return captured[0]!;
}
test('MFP panel readers preserve authorization and produce one bounded scoped query',async()=>{
  const previous=process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED, previousFacets=process.env.NOISIA_MENTION_FACETS_ENABLED;process.env.NOISIA_MENTION_FACETS_ENABLED='true';process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED='true';
  try {for(const reader of [loadMentionFacetsStatusV1,loadMentionFacetBrowserV1,loadConceptMembershipsStatusV1,projectionReader]) {
    const {sql,params}=await capturePanelQuery(reader);
    assert.equal(params[0],id);
    if(reader===projectionReader){assert.match(sql,/selected AS MATERIALIZED/);assert.match(sql,/signal_workspace_projection_assignments_current_v1/);}
    assert.equal([...sql.matchAll(/FROM signal_mention_facets_current_v1/g)].length,reader===projectionReader?0:1);
    if(reader!==loadMentionFacetsStatusV1&&reader!==projectionReader)assert.ok(params.includes(31));
  }}finally{if(previous===undefined)delete process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;else process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED=previous;
    if(previousFacets===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=previousFacets;}
});
test('MFP panels: PostgreSQL plans the exact workspace-scoped counts, quotes and bounded pages produced by each reader',{
  skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:30_000,
},async()=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
  const c=await pool.connect();
  const previous=process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED, previousFacets=process.env.NOISIA_MENTION_FACETS_ENABLED;process.env.NOISIA_MENTION_FACETS_ENABLED='true';
  process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED='true';
  try{
    await c.query('BEGIN READ ONLY');
    for(const reader of [loadMentionFacetsStatusV1,loadMentionFacetBrowserV1,loadConceptMembershipsStatusV1,projectionReader]){
      const {sql,params}=await capturePanelQuery(reader);
      assert.equal(params[0],id);
    if(reader===projectionReader){assert.match(sql,/selected AS MATERIALIZED/);assert.match(sql,/signal_workspace_projection_assignments_current_v1/);}
      assert.match(sql,/(?:WHERE|AND) (?:[a-z]+\.)?workspace_id=\$1/);
      assert.equal([...sql.matchAll(/FROM signal_mention_facets_current_v1/g)].length,reader===projectionReader?0:1,'one current-facet projection per workspace read');
      await c.query(`EXPLAIN ${sql}`,params);
      if(reader!==loadMentionFacetsStatusV1&&reader!==projectionReader)assert.ok(params.includes(31),'bounded page plus next-cursor sentinel');
    }
  }finally{
    if(previous===undefined)delete process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;else process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED=previous;
    if(previousFacets===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=previousFacets;
    await c.query('ROLLBACK');c.release();await pool.end();
  }
});

test('MFP projection paging retains separate latest and latest-complete receipts and live revocation guards',{
  skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:300_000,
},async()=>{
  const {randomUUID}=await import('node:crypto');
  const {seedSignalTopicEditorialRenewalSourceV1}=await import('./signal-topic-editorial-renewal.synthetic.fixture');
  const {incrementalProjectionFixtureV1}=await import('./signal-workspace-incremental-projection.fixture');
  const {requestSignalWorkspaceTopicProjectionV1}=await import('../signal-workspace-topic-projection');
  const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);
  const pool=await openDatabase(),raw=await pool.connect();
  try{
    await raw.query('BEGIN ISOLATION LEVEL READ COMMITTED');let sequence=0;const stack:string[]=[];
    const query=async(sql:string,params?:unknown[])=>{
      if(sql.startsWith('BEGIN')){const key=`panel_read_${++sequence}`;stack.push(key);return raw.query(`SAVEPOINT ${key}`);}
      if(sql==='COMMIT')return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if(sql==='ROLLBACK'){const key=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${key}`);return raw.query(`RELEASE SAVEPOINT ${key}`);}
      return raw.query(sql,params);
    };
    const scoped=Object.assign(Object.create(raw),{query,release(){}});
    const database=Object.assign(Object.create(pool),{query,connect:async()=>scoped}) as pg.Pool;
    const clusterIds=[randomUUID(),randomUUID()] as const,done=new Error('panel selection acceptance complete');let checked=false;
    await assert.rejects(seedSignalTopicEditorialRenewalSourceV1({database,scoped,query,cleanup:async()=>{},projection:{
      cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'synthetic-panel-selection'}},
      onCheckpoint:async checkpoint=>{
        await incrementalProjectionFixtureV1(checkpoint,clusterIds,{migrations_applied:true,onParentProjection:async previous=>{
          const materialization=(await query("SELECT input_snapshot->'source_projection'->>'materialization_artifact_id' id FROM signal_classification_generations WHERE id=$1::uuid",[previous.generation_id])).rows[0].id;
          const next=await requestSignalWorkspaceTopicProjectionV1({...checkpoint.access,engine_execution_id:checkpoint.lease.execution_id,materialization_artifact_id:materialization,idempotency_key:randomUUID()});
          const parity=async()=>{
           const rows=(await query(`SELECT signal_workspace_projection_source_current_v1(g) AND NOT EXISTS(
             SELECT 1 FROM signal_classification_assignments a WHERE a.generation_id=g.id
              AND NOT signal_workspace_classification_assignment_current_v1(a,g)) old,
              signal_workspace_projection_assignments_current_v1(g) current
             FROM signal_classification_generations g WHERE g.id=ANY($1::uuid[])`,[[previous.generation_id,next.generation_id]])).rows;
           assert.equal(rows.length,2);for(const row of rows)assert.equal(row.current,row.old);
          };
          await parity();
          const localRows=(await query(`SELECT signal_workspace_classification_assignment_current_v1(a,g) old,
            signal_workspace_classification_assignment_row_current_v1(a,g) current,
            signal_workspace_classification_assignment_row_current_v1(jsonb_populate_record(NULL::signal_classification_assignments,
              to_jsonb(a)||jsonb_build_object('canonical_root_id',gen_random_uuid())),g) corrupt_root,
            signal_workspace_classification_assignment_row_current_v1(jsonb_populate_record(NULL::signal_classification_assignments,
              to_jsonb(a)||jsonb_build_object('definition_digest','sha256:'||repeat('0',64))),g) corrupt_definition
            FROM signal_classification_assignments a JOIN signal_classification_generations g ON g.id=a.generation_id
            WHERE a.generation_id=$1 AND a.membership_basis='computed_cluster'`,[previous.generation_id])).rows;
          assert.ok(localRows.length);for(const row of localRows){assert.equal(row.old,true);assert.equal(row.current,true);
           assert.equal(row.corrupt_root,false);assert.equal(row.corrupt_definition,false);}
          const read=()=>loadSignalWorkspaceTopicProjectionStatusWithQueryableV1({...checkpoint.access,queryable:database});
          const result=await read();
          assert.equal(result.latest_run?.generation_id,next.generation_id,'new queued generation remains latest');
          assert.equal(result.latest_complete?.generation_id,previous.generation_id,'prior complete generation remains separately visible');
          assert.equal(result.latest_complete?.is_current,true);
          await query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1::uuid",[checkpoint.access.workspace_id]);
          await parity();
          const revoked=await read();
          assert.equal(revoked.latest_run?.generation_id,next.generation_id);
          assert.equal(revoked.latest_complete?.generation_id,previous.generation_id,'revocation preserves historical receipt');
          assert.equal(revoked.latest_complete?.is_current,false,'bounded selection never bypasses live source authority');
          checked=true;throw done;
        }});
      },
    }}),error=>error===done);
    assert.equal(checked,true);
  }finally{await raw.query('ROLLBACK');raw.release();await pool.end();}
});
