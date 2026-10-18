import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createMigratedLabelingFixture} from '../../../scripts/dev-corpus/migrated-labeling-fixture';
import {loadFacetEntityContextV1} from '../signal-mention-facets';
import {replayStoredMembershipResultsV1} from '../signal-membership-stored-replay';
import {entityContextDigestV1,membershipLabelerIdentityV1,parseMembershipGroupV1,normalizeMembershipRationaleV2,type MembershipInputV1} from '@noisia/query-engine';

// Real PostgreSQL acceptance: one root's three decisions recover from the same paid raw;
// the immutable receipt, valid decisions and all money remain unchanged, including replay.
test('stored membership replay recovers all three decisions atomically without new settlement',{
 skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:60_000,
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect(),previous=process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED='true';
 try{
  await c.query('BEGIN');const f=await createMigratedLabelingFixture(pool,c,'membership');
  const context=await loadFacetEntityContextV1(c,f.workspaceId),digest=entityContextDigestV1(context),ld=`sha256:${'4'.repeat(64)}`;
  await c.query('UPDATE signal_entity_context_versions SET context=$2,digest=$3 WHERE workspace_id=$1',[f.workspaceId,JSON.stringify(context),digest]);
  await c.query('UPDATE signal_labeler_versions SET identity=$2 WHERE id=$1',[f.labelerId,JSON.stringify(membershipLabelerIdentityV1())]);
  await c.query("INSERT INTO signal_workspace_labelers(workspace_id,kind,labeler_version_id) VALUES($1,'membership',$2)",[f.workspaceId,f.labelerId]);
  await c.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'concept_membership',$2)",[f.workspaceId,f.actorId]);
  const concepts=['one','two','three'].map(concept_key=>({concept_key,label:concept_key,scope:'all_conversations' as const,definition:'A documented experience',inclusion:[],exclusion:[],positive_examples:[],negative_examples:[],definition_digest:ld}));
  const rootId=randomUUID(),fingerprint=(await c.query("SELECT signal_labeling_digest_v1(jsonb_build_object('root_id',$1::uuid,'input_digest',$2::text)) fingerprint",[rootId,ld])).rows[0].fingerprint;
  const input:MembershipInputV1={root_id:rootId,input_digest:ld,root_fingerprint:fingerprint,entity_context_digest:digest,effective_entities_digest:ld,text:'A real documented experience.',title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01',language:'en',entities:[],voice:'individual',act:'experience',evaluated_concepts:concepts};
  const schema=`membership_replay_${randomUUID().replaceAll('-','')}`;
  await c.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public,extensions;
   CREATE TABLE signal_labeling_runs (LIKE public.signal_labeling_runs INCLUDING ALL);
   CREATE TABLE signal_labeling_calls (LIKE public.signal_labeling_calls INCLUDING ALL);
   CREATE TABLE signal_concept_memberships (LIKE public.signal_concept_memberships INCLUDING ALL);
   CREATE TABLE signal_membership_concepts_v1(workspace_id uuid,concept_key text,topic jsonb,definition_digest text GENERATED ALWAYS AS(topic->>'definition_digest') STORED,scope text GENERATED ALWAYS AS(topic->>'scope') STORED);
   CREATE TABLE population(root_id uuid,root_fingerprint text,concept_key text,definition_digest text,entity_context_digest text,effective_entities_digest text,labeler_digest text,verdict text,source text);
   CREATE FUNCTION signal_workspace_concept_memberships_read_v1(uuid) RETURNS SETOF population LANGUAGE sql AS 'SELECT * FROM population';`);
  await c.query('INSERT INTO signal_labeling_runs SELECT * FROM public.signal_labeling_runs WHERE id=$1',[f.runId]);
  await c.query("UPDATE signal_labeling_runs SET entity_context_digest=$1,status='completed',lease_until=NULL,membership_snapshot=$2",[digest,JSON.stringify({preview:false,concepts,sample_root_ids:null})]);
  for(const concept of concepts){await c.query('INSERT INTO signal_membership_concepts_v1(workspace_id,concept_key,topic) VALUES($1,$2,$3)',[f.workspaceId,concept.concept_key,JSON.stringify(concept)]);await c.query("INSERT INTO population VALUES($1,$2,$3,$4,$5,$6,$7,'error','machine')",[input.root_id,fingerprint,concept.concept_key,ld,digest,ld,ld]);}
  const text=JSON.stringify({contract_version:'concept-membership-judge-v1',roots:{r0:{root_ordinal:0,memberships:concepts.slice(0,2).map((concept,i)=>({concept_key:concept.concept_key,verdict:'belongs',span_ids:['r0c0s0'],rationale:Array(33-i).fill('word').join(' ')}))}}});
  const errors=parseMembershipGroupV1(text,[input]).results;assert.equal(errors.length,3);assert.ok(errors.every(r=>r.verdict==='error'));
  const callId=randomUUID(),custom=`stored-${callId}`,raw=JSON.stringify({custom_id:custom,result:{type:'succeeded',message:{stop_reason:'end_turn',content:[{type:'text',text}],usage:{input_tokens:100,output_tokens:50}}}});
  await c.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,status,reserved_micro_usd,settled_micro_usd,budget_date,budget_timezone,results_applied,results,raw_sha256,raw_storage_key,raw_size_bytes)
   VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}',$6,'settled',100,73,current_date,'UTC',true,$7,$8,'private',$9)`,[callId,f.runId,f.workspaceId,custom,ld,JSON.stringify([input]),JSON.stringify(errors),`sha256:${createHash('sha256').update(raw).digest('hex')}`,Buffer.byteLength(raw)]);
  let savepoint=0;const stack:string[]=[];const query=async(sql:string,params?:unknown[])=>{if(sql==='BEGIN'){const name=`replay_save_${++savepoint}`;stack.push(name);return c.query(`SAVEPOINT ${name}`);}if(sql==='COMMIT')return c.query(`RELEASE SAVEPOINT ${stack.pop()!}`);if(sql==='ROLLBACK'){const name=stack.pop()!;await c.query(`ROLLBACK TO SAVEPOINT ${name}`);return c.query(`RELEASE SAVEPOINT ${name}`);}return c.query(sql,params);};
  const database={query,connect:async()=>({query,release(){}})} as unknown as pg.Pool;
  const args={database,workspace_id:f.workspaceId,actor_user_id:f.actorId,run_id:f.runId,loadRaw:async()=>raw};
  const money=async()=>JSON.stringify((await c.query('SELECT status,reserved_micro_usd,settled_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,usage FROM signal_labeling_calls ORDER BY id')).rows);
  const stableRoot=randomUUID();
  await c.query(`INSERT INTO signal_concept_memberships(workspace_id,root_id,root_fingerprint,concept_key,definition_digest,labeler_digest,entity_context_digest,effective_entities_digest,run_id,call_id,verdict,citations,rationale)
   VALUES($1,$2,$3,'one',$3,$3,$4,$3,$5,$6,'not_belongs','[]','Previously valid')`,[f.workspaceId,stableRoot,ld,digest,f.runId,callId]);
  const stable=async()=>JSON.stringify((await c.query('SELECT to_jsonb(m) row FROM signal_concept_memberships m WHERE root_id=$1',[stableRoot])).rows);
  const beforeStable=await stable();
  const before=await money();
  await c.query("UPDATE signal_membership_concepts_v1 SET topic=jsonb_set(topic,'{definition_digest}',to_jsonb('changed'::text)) WHERE concept_key='one'");
  await assert.rejects(replayStoredMembershipResultsV1(args));
  await c.query("UPDATE signal_membership_concepts_v1 SET topic=jsonb_set(topic,'{definition_digest}',to_jsonb($1::text)) WHERE concept_key='one'",[ld]);

  await c.query("UPDATE signal_labeling_runs SET status='running'");await assert.rejects(replayStoredMembershipResultsV1(args),/membership_replay_run_invalid/);await c.query("UPDATE signal_labeling_runs SET status='completed'");
  await c.query("UPDATE population SET source='human' WHERE concept_key='one'");await assert.rejects(replayStoredMembershipResultsV1(args),/membership_replay_source_changed/);await c.query("UPDATE population SET source='machine'");
  await c.query("UPDATE population SET root_fingerprint='changed' WHERE concept_key='two'");await assert.rejects(replayStoredMembershipResultsV1(args),/membership_replay_source_changed/);await c.query('UPDATE population SET root_fingerprint=$1',[fingerprint]);
  await assert.rejects(replayStoredMembershipResultsV1({...args,loadRaw:async()=>raw+' '}),/membership_replay_receipt_invalid/);
  await c.query(`CREATE FUNCTION reject_repair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_write_failure'; END $$; CREATE TRIGGER reject_repair BEFORE UPDATE ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION reject_repair()`);
  await assert.rejects(replayStoredMembershipResultsV1(args),/synthetic_write_failure/);assert.equal((await c.query('SELECT count(*)::int n FROM signal_concept_memberships')).rows[0].n,1);
  await c.query('DROP TRIGGER reject_repair ON signal_labeling_calls');
  // Execute the shipped 0268 SELECT, not a hand-written approximation of its precedence.
  // Only its source relation is redirected into this rollback-only schema.
  const nativeBody=(await c.query("SELECT prosrc FROM pg_proc WHERE oid='public.signal_workspace_concept_memberships_read_v1(uuid)'::regprocedure")).rows[0].prosrc as string;
  await c.query(`CREATE TABLE signal_mention_facets_current_v1 AS SELECT * FROM public.signal_mention_facets_current_v1 WITH NO DATA;
   CREATE TABLE signal_hybrid_membership_routes (LIKE public.signal_hybrid_membership_routes INCLUDING ALL);
   CREATE TABLE signal_hybrid_membership_decisions (LIKE public.signal_hybrid_membership_decisions INCLUDING ALL);
   CREATE TABLE signal_concept_membership_overrides (LIKE public.signal_concept_membership_overrides INCLUDING ALL);`);
  await c.query(`INSERT INTO signal_mention_facets_current_v1(workspace_id,root_id,input_digest,entity_context_digest,effective_entities_digest,relevance,requires_context_review,facets)
   VALUES($1,$2,$3,$4,$3,'relevant',false,'{}')`,[f.workspaceId,input.root_id,ld,digest]);
  await c.query('DROP FUNCTION signal_workspace_concept_memberships_read_v1(uuid)');
  await c.query(`CREATE FUNCTION signal_workspace_concept_memberships_read_v1(uuid) RETURNS SETOF public.signal_concept_memberships_current_v1 LANGUAGE sql STABLE AS ${"'"+nativeBody.replaceAll('public.','').replace('signal_workspace_mention_facets_read_v1($1)','signal_mention_facets_current_v1').replaceAll("'","''")+"'"}`);
  assert.deepEqual((await c.query('SELECT verdict FROM signal_workspace_concept_memberships_read_v1($1) ORDER BY concept_key',[f.workspaceId])).rows.map(r=>r.verdict),['error','error','error']);
  const result=await replayStoredMembershipResultsV1(args);assert.equal(result.replayed_pairs,3);assert.equal(result.provider_sends,0);assert.equal(result.additional_settlement_micro_usd,0);
  const rows=(await c.query('SELECT concept_key,verdict,citations,rationale FROM signal_concept_memberships WHERE root_id=$1 ORDER BY concept_key',[input.root_id])).rows;
  const expected=parseMembershipGroupV1(normalizeMembershipRationaleV2(text).text,[input]).results.map(({concept_key,verdict,citations,rationale})=>({concept_key,verdict,citations,rationale})).sort((a,b)=>a.concept_key.localeCompare(b.concept_key));assert.deepEqual(rows,expected);
  const recorded=(await c.query('SELECT results FROM signal_labeling_calls')).rows[0].results;assert.equal(recorded.filter((r:{normalizations?:unknown[]})=>r.normalizations?.length).length,2);
  assert.deepEqual((await c.query('SELECT concept_key,verdict,error_code FROM signal_workspace_concept_memberships_read_v1($1) ORDER BY concept_key',[f.workspaceId])).rows,expected.map(({concept_key,verdict})=>({concept_key,verdict,error_code:null})));
  assert.ok(recorded.every((r:{verdict:string;error_code?:string})=>r.verdict!=='error'&&!r.error_code));
  assert.equal((await replayStoredMembershipResultsV1(args)).replayed_pairs,0);assert.equal(await money(),before);assert.equal(await stable(),beforeStable);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();if(previous===undefined)delete process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;else process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED=previous;}
});
