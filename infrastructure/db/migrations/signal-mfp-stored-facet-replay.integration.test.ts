import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createMigratedLabelingFixture} from '../../../scripts/dev-corpus/migrated-labeling-fixture';
import {loadFacetEntityContextV1} from '../signal-mention-facets';
import {replayStoredFacetResultsV1} from '../signal-facet-stored-replay';
import {entityContextDigestV1,facetLabelerIdentityLegacyV1} from '@noisia/query-engine';

// Acceptance: immutable paid raw repairs nine only; neither the 791 labels nor money changes.
test('stored facet writer repairs nine from paid raw, is idempotent and rolls back stale/conflicting pages',{
 skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:60_000,
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect(),previous=process.env.NOISIA_MENTION_FACETS_ENABLED;process.env.NOISIA_MENTION_FACETS_ENABLED='true';
 try{
  await c.query('BEGIN');const f=await createMigratedLabelingFixture(pool,c);
  const context=await loadFacetEntityContextV1(c,f.workspaceId),digest=entityContextDigestV1(context);
  await c.query('UPDATE signal_entity_context_versions SET context=$2,digest=$3 WHERE workspace_id=$1',[f.workspaceId,JSON.stringify(context),digest]);
  await c.query('UPDATE signal_labeler_versions SET identity=$2 WHERE id=$1',[f.labelerId,JSON.stringify(facetLabelerIdentityLegacyV1())]);
  await c.query("INSERT INTO signal_workspace_labelers(workspace_id,kind,labeler_version_id) VALUES($1,'facets',$2) ON CONFLICT(workspace_id,kind) DO UPDATE SET labeler_version_id=excluded.labeler_version_id",[f.workspaceId,f.labelerId]);
  await c.query("INSERT INTO signal_workspace_features(workspace_id,feature) VALUES($1,'mention_facets') ON CONFLICT DO NOTHING",[f.workspaceId]);
  const schema=`facet_replay_${randomUUID().replaceAll('-','')}`;
  await c.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public,extensions;
   CREATE TABLE signal_labeling_runs (LIKE public.signal_labeling_runs INCLUDING ALL);
   CREATE TABLE signal_labeling_calls (LIKE public.signal_labeling_calls INCLUDING ALL);
   CREATE TABLE signal_mention_facet_labels (LIKE public.signal_mention_facet_labels INCLUDING ALL);
   CREATE TABLE population(root_id uuid,input_digest text,status text,labeler_digest text,requires_context_review boolean DEFAULT false);
   CREATE FUNCTION signal_workspace_mention_facets_read_v1(uuid) RETURNS SETOF population LANGUAGE sql AS 'SELECT * FROM population';`);
  await c.query(`INSERT INTO signal_labeling_runs SELECT * FROM public.signal_labeling_runs WHERE id=$1`,[f.runId]);
  await c.query("UPDATE signal_labeling_runs SET entity_context_digest=$1,status='completed',lease_until=NULL",[digest]);
  const ld=`sha256:${'4'.repeat(64)}`,raws=new Map<string,string>(),ids=Array.from({length:901},()=>randomUUID());
  const dim=<T,>(value:T)=>({value,confidence:'high',abstained:false});
  const facets={entities:dim([{entity_id:context.entities[0]!.entity_id,kind:'primary_brand',salience:'main'}]),unrelated_reason:null,
   voice:dim('individual'),act:dim('experience'),spam_or_bot:dim(false),language:dim('es'),asunto:dim('word '.repeat(13).trim())};
  const population=ids.map((root_id,index)=>({root_id,input_digest:`sha256:${createHash('sha256').update(root_id).digest('hex')}`,status:index<791?'labeled':'error',labeler_digest:ld}));
  await c.query(`INSERT INTO population(root_id,input_digest,status,labeler_digest) SELECT root_id,input_digest,status,labeler_digest
   FROM jsonb_to_recordset($1) r(root_id uuid,input_digest text,status text,labeler_digest text)`,[JSON.stringify(population)]);
  const validCall=randomUUID();
  await c.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,status,reserved_micro_usd,settled_micro_usd,budget_date,budget_timezone,raw_sha256,raw_storage_key,raw_size_bytes)
   VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$1,$4,'{}','[]','settled',0,7,current_date,'UTC',$4,'private',0)`,[validCall,f.runId,f.workspaceId,ld]);
  await c.query(`INSERT INTO signal_mention_facet_labels(workspace_id,root_id,input_digest,labeler_digest,entity_context_digest,facet_schema_version,status,facets,relevance,effective_entities_digest,call_id)
   SELECT $1,root_id,input_digest,$2,$3,'mention-facets-v1','labeled','{}','unknown',$2,$4 FROM population WHERE status='labeled'`,[f.workspaceId,ld,digest,validCall]);
  for(const row of population.slice(791,800)){
   const id=randomUUID(),custom=`replay-${id}`,input={root_id:row.root_id,input_digest:row.input_digest,text:'Synthetic category experience',title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01',language:'es'};
   const raw=JSON.stringify({custom_id:custom,result:{type:'succeeded',message:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({roots:[{root_ordinal:0,facets}]})}],usage:{input_tokens:100,output_tokens:20}}}});
   raws.set(id,raw);const result={root_id:row.root_id,input_digest:row.input_digest,entity_context_digest:digest,status:'error',error_code:'invalid_facets'};
   await c.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,status,reserved_micro_usd,settled_micro_usd,budget_date,budget_timezone,results_applied,results,raw_sha256,raw_storage_key,raw_size_bytes)
    VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}',$6,'settled',10,3,current_date,'UTC',true,$7,$8,'private', $9)`,
    [id,f.runId,f.workspaceId,custom,ld,JSON.stringify([input]),JSON.stringify([result]),`sha256:${createHash('sha256').update(raw).digest('hex')}`,Buffer.byteLength(raw)]);
  }
  let savepoint=0;const stack:string[]=[];
  const query=async(sql:string,params?:unknown[])=>{
   if(sql==='BEGIN'){const name=`replay_save_${++savepoint}`;stack.push(name);return c.query(`SAVEPOINT ${name}`);}
   if(sql==='COMMIT')return c.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
   if(sql==='ROLLBACK'){const name=stack.pop()!;await c.query(`ROLLBACK TO SAVEPOINT ${name}`);return c.query(`RELEASE SAVEPOINT ${name}`);}
   return c.query(sql,params);
  };
  const database={query,connect:async()=>({query,release(){}})} as unknown as pg.Pool;
  const args={database,workspace_id:f.workspaceId,actor_user_id:f.actorId,run_id:f.runId,loadRaw:async({call_id}:{call_id:string})=>raws.get(call_id)!};
  const money=async()=>JSON.stringify((await c.query('SELECT id,status,settled_micro_usd,reserved_micro_usd,usage,raw_sha256,raw_storage_key FROM signal_labeling_calls ORDER BY id')).rows);
  const valid=async()=>JSON.stringify((await c.query("SELECT to_jsonb(label) row FROM signal_mention_facet_labels label WHERE root_id=ANY($1::uuid[]) ORDER BY root_id",[ids.slice(0,791)])).rows);
  const beforeMoney=await money(),beforeValid=await valid();
  // A changed source prevents any page from applying.
  await c.query("UPDATE population SET input_digest='changed' WHERE root_id=$1",[ids[795]]);
  await assert.rejects(replayStoredFacetResultsV1(args),/facet_replay_source_changed/);
  assert.equal((await c.query('SELECT count(*)::int count FROM signal_mention_facet_labels')).rows[0].count,791);
  await c.query('UPDATE population SET input_digest=$2 WHERE root_id=$1',[ids[795],population[795]!.input_digest]);
  await c.query(`CREATE FUNCTION reject_repair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_write_failure'; END $$;
   CREATE TRIGGER reject_repair BEFORE UPDATE ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION reject_repair()`);
  await assert.rejects(replayStoredFacetResultsV1(args),/synthetic_write_failure/);
  assert.equal((await c.query('SELECT count(*)::int count FROM signal_mention_facet_labels')).rows[0].count,791,'label inserts roll back if updating provenance fails');
  await c.query('DROP TRIGGER reject_repair ON signal_labeling_calls');
  await assert.rejects(replayStoredFacetResultsV1({...args,loadRaw:async receipt=>args.loadRaw(receipt)+' '}),/facet_replay_receipt_invalid/);
  const result=await replayStoredFacetResultsV1(args);assert.equal(result.replayed_root_ids.length,9);assert.equal(result.recovery_root_ids.length,101);
  assert.equal(result.provider_sends,0);assert.equal(result.additional_settlement_micro_usd,0);
  assert.equal((await c.query('SELECT count(*)::int count FROM signal_mention_facet_labels')).rows[0].count,800);
  assert.equal((await replayStoredFacetResultsV1(args)).replayed_root_ids.length,0);
  assert.equal(await money(),beforeMoney);assert.equal(await valid(),beforeValid);
  assert.equal((await c.query("SELECT count(*)::int count FROM signal_mention_facet_labels WHERE facets#>>'{asunto,abstained}'='true'")).rows[0].count,9);
  await c.query("UPDATE users SET status='suspended' WHERE id=$1",[f.actorId]);await assert.rejects(replayStoredFacetResultsV1(args),/facet_replay_forbidden/);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();if(previous===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=previous;}
});
