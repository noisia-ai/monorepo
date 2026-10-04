/** Remote PostgreSQL rollback check. Optional candidate DDL, synthetic changes and labeled-root edits all roll back. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {openDatabase,main} from './guard.mjs';
import {syntheticImportedWorkspaceFixtureV1} from '../../infrastructure/db/migrations/signal-client-workspace-entry.synthetic.fixture';
import {createSignalSentioneCsvIngester} from '../../infrastructure/db/sentione-csv-ingest';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
await main(async()=>{
 const pool=await openDatabase();const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const installed=(await client.query("SELECT to_regclass('signal_mention_content_revisions') IS NOT NULL present")).rows[0].present;
  if(!installed){
   if(!process.argv.includes('--candidate-migration'))throw new Error('mfp_candidate_migration_required');
   await client.query(await readFile(new URL('../../infrastructure/db/migrations/0241_signal_import_content_revisions.sql',import.meta.url),'utf8'));
  }
  const signature=(await client.query(`SELECT
   to_regprocedure('stage_signal_mention_content_revisions_v1(uuid,jsonb)') IS NOT NULL staged,
   to_regprocedure('apply_signal_mention_content_revisions_v1(uuid)') IS NOT NULL published,
   (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches'
     AND column_name IN('content_revision_mode','content_revision_base_batch_id')) batch_columns,
   (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='signal_mention_content_revisions'
     AND column_name IN('previous_digest','next_digest','source_system','provider_record_id')) revision_columns`)).rows[0];
  assert.deepEqual(signature,{staged:true,published:true,batch_columns:2,revision_columns:4});
  await client.query('SAVEPOINT synthetic_fixture');
  const query=(sql:string,values?:unknown[])=>client.query(sql,values);
  const database={query,connect:async()=>({query,release(){}})} as unknown as Parameters<typeof syntheticImportedWorkspaceFixtureV1>[0]['database'];
  const f=await syntheticImportedWorkspaceFixtureV1({database,query,scoped:client,cleanup:async()=>{}});
  await query('UPDATE import_batches SET completed_at=clock_timestamp() WHERE id=$1',[f.batch_id]);
  const root=(await query('SELECT * FROM mentions WHERE id=$1',[f.roots[0]])).rows[0];
  // This historical typed observation is synthetic; production staging/publish guards stay enabled.
  await query(`INSERT INTO signal_provider_mention_observations(workspace_id,data_source_id,import_batch_id,mention_id,
   provider_key,provider_record_key_hash,provider_schema_version,provider_header_hash,observation_version,observation_hash,published_at)
   VALUES($1,$2,$3,$4,'sentione',$5,'sentione-csv-47-v1',$6,1,$6,clock_timestamp())`,
   [f.workspace_id,f.source_id,f.batch_id,root.id,`sha256:${sha(root.provider_record_id)}`,`sha256:${sha('synthetic header')}`]);
  const batch=async(base:string,mode='revise_existing')=>{
   const id=randomUUID();
   // Construct a sealed pre-existing worker job, independent of Brand OS / UI.
   // Replica mode is fixture setup only; all assertions execute normal triggers.
   await query("SET LOCAL session_replication_role='replica'");
   await query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,source_file_name,status,
    ingestion_phase,expected_file_size_bytes,upload_protocol,worker_job_id,imported_by_user_id,
    content_revision_mode,content_revision_base_batch_id)
    VALUES($1,$2,$3,'synthetic','synthetic-revision.csv','processing','processing',100,'server-stream',$1,$4,$5,$6)`,
    [id,f.workspace_id,f.source_id,f.actor_user_id,mode,mode==='revise_existing'?base:null]);
   await query("SET LOCAL session_replication_role='origin'");return id;
  };
  const makeContent=(text:string)=>({...root,text_raw:text,text_clean:text,text_hash:sha(text.toLowerCase()),text_length:text.length,text_snippet:text});
  const payload=(content:ReturnType<typeof makeContent>)=>JSON.stringify([{mention_id:root.id,content}]);
  const stage=(id:string,content:ReturnType<typeof makeContent>)=>query('SELECT * FROM stage_signal_mention_content_revisions_v1($1,$2::jsonb)',[id,payload(content)]);
  const text=async()=>(await query('SELECT text_clean FROM mentions WHERE id=$1',[root.id])).rows[0].text_clean;
  const complete=(id:string,hash=sha(id))=>query('SELECT * FROM complete_signal_workspace_import_v1($1,$1::text,$2,1,1,0,0,100)',[id,hash]);
  let checks=0;
  const reject=async(operation:()=>Promise<unknown>,pattern:RegExp)=>{
   await query('SAVEPOINT rejected');await assert.rejects(operation,pattern);
   await query('ROLLBACK TO SAVEPOINT rejected');await query('RELEASE SAVEPOINT rejected');checks++;
  };
  const first=await batch(f.batch_id),content=makeContent('A synthetic revised bicycle review with a delayed delivery.');
  assert.equal((await stage(first,content)).rows.length,1);assert.equal(await text(),root.text_clean);checks++;
  assert.equal((await stage(first,content)).rows.length,1);
  assert.equal((await query('SELECT count(*)::int n FROM signal_mention_content_revisions WHERE import_batch_id=$1',[first])).rows[0].n,1);checks++;
  await reject(()=>stage(first,makeContent('Competing text for the very same synthetic import and ID.')),/content_revision_conflicting_rows/);
  await reject(()=>query("UPDATE signal_mention_content_revisions SET next_content='{}' WHERE import_batch_id=$1",[first]),/content_revision_immutable/);
  await reject(()=>query("UPDATE import_batches SET content_revision_mode='append_only' WHERE id=$1",[first]),/content_revision_seal_immutable/);
  const beforeRevision=(await query('SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=$1',[f.workspace_id])).rows[0]?.input_revision;
  await query('SAVEPOINT publish_failure');
  await complete(first);assert.equal(await text(),content.text_clean);
  await query('ROLLBACK TO SAVEPOINT publish_failure');await query('RELEASE SAVEPOINT publish_failure');
  assert.equal(await text(),root.text_clean);assert.equal((await query('SELECT status FROM import_batches WHERE id=$1',[first])).rows[0].status,'processing');checks++;
  await complete(first);assert.equal(await text(),content.text_clean);
  const afterRevision=(await query('SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=$1',[f.workspace_id])).rows[0]?.input_revision;
  if(beforeRevision!==undefined)assert.ok(BigInt(afterRevision)>BigInt(beforeRevision));checks++;
  assert.equal((await complete(first)).rows[0].accepted,true);assert.equal(await text(),content.text_clean);checks++;
  const history=(await query('SELECT previous_content,next_content FROM signal_mention_content_revisions WHERE import_batch_id=$1',[first])).rows[0];
  assert.equal(history.previous_content.text_clean,root.text_clean);assert.equal(history.next_content.text_clean,content.text_clean);checks++;
  const replay=await batch(first);
  const replayResult=(await complete(replay,sha(first))).rows[0];assert.equal(replayResult.accepted,false);assert.equal(replayResult.accepted_batch_id,first);checks++;
  const stale=await batch(f.batch_id);
  await stage(stale,makeContent('A synthetic stale edit must never overwrite a newer source.'));
  await reject(()=>complete(stale),/content_revision_base_stale/);assert.equal(await text(),content.text_clean);
  const next=await batch(first);await stage(next,makeContent('A further synthetic edit for the current source and ID.'));
  await query('SAVEPOINT revoke');await query("UPDATE users SET status='inactive' WHERE id=$1",[f.actor_user_id]);
  await reject(()=>complete(next),/processing_forbidden|content_revision_forbidden/);
  await query('ROLLBACK TO SAVEPOINT revoke');await query('RELEASE SAVEPOINT revoke');
  await query('SAVEPOINT rights');await query("UPDATE signal_provenance_policy_bindings SET effective_to=clock_timestamp() WHERE workspace_id=$1 AND data_source_id=$2",[f.workspace_id,f.source_id]);
  await reject(()=>complete(next),/content_revision_rights_unavailable/);
  await query('ROLLBACK TO SAVEPOINT rights');await query('RELEASE SAVEPOINT rights');
  await query('SAVEPOINT shared');
  await query(`INSERT INTO signal_provider_mention_observations(workspace_id,data_source_id,import_batch_id,mention_id,
    provider_key,provider_record_key_hash,provider_schema_version,provider_header_hash,observation_version,observation_hash,published_at)
    VALUES($1,$2,$3,$4,'sentione',$5,'sentione-csv-47-v1',$6,1,$6,clock_timestamp())`,
    [f.workspace_id,f.source_id,f.batch_id,root.id,`sha256:${sha('different provider record')}`,`sha256:${sha('synthetic header')}`]);
  await reject(()=>complete(next),/content_revision_conflict/);
  await query('ROLLBACK TO SAVEPOINT shared');await query('RELEASE SAVEPOINT shared');
  // Same bytes previously accepted in append-only must reach the explicit revision path.
  const append=await batch(first,'append_only');await complete(append,sha('same file new mode'));
  const explicit=await batch(append);await stage(explicit,makeContent('The explicit revision accepts a file already accepted append-only.'));
  assert.equal((await complete(explicit,sha('same file new mode'))).rows[0].accepted,true);checks++;
  // Real parser + SQL persistence exercises source-local IDs and legacy defaults.
  const secondSource=randomUUID();
  await query(`INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,source_key,status)
   VALUES($1,$2,$3,$4,'social_listening','synthetic','manual','Second synthetic source',$5,'active')`,
   [secondSource,f.workspace_id,f.organization_id,f.brand_id,`source-sha256-${sha(secondSource)}`]);
  const sourceBatch=randomUUID();await query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,status)
   VALUES($1,$2,$3,'synthetic','processing')`,[sourceBatch,f.workspace_id,secondSource]);
  const csv=`id,text,date\n${root.provider_record_id},An independent synthetic provider uses this ID for different content.,2026-09-01T12:00:00Z\n`;
  const parsed=await createSignalSentioneCsvIngester(database).ingestSentioneCsvStream({workspaceId:f.workspace_id,dataSourceId:secondSource,
   importBatchId:sourceBatch,sourceFileName:'synthetic.csv',stream:new Blob([csv]).stream()});
  assert.equal(parsed.stats.included_count,1);assert.equal(parsed.stats.duplicate_count,0);checks++;
  const sameSourceBatch=randomUUID();await query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,status)
   VALUES($1,$2,$3,'listening_csv','processing')`,[sameSourceBatch,f.workspace_id,f.source_id]);
  const csvSameSystem=`id,text,date\n${root.provider_record_id},A second source system may reuse an ID in the same connector.,2026-09-01T12:00:00Z\n`;
  const independent=await createSignalSentioneCsvIngester(database).ingestSentioneCsvStream({workspaceId:f.workspace_id,dataSourceId:f.source_id,
   importBatchId:sameSourceBatch,sourceFileName:'synthetic-system.csv',stream:new Blob([csvSameSystem]).stream()});
  assert.equal(independent.stats.included_count,1);assert.equal(independent.stats.duplicate_count,0);checks++;
  await query('ROLLBACK TO SAVEPOINT synthetic_fixture');await query('RELEASE SAVEPOINT synthetic_fixture');
  // Existing private labels are observed and edited only inside this rollback.
  // No label fabrication: the fixture must already have a current model verdict.
  const identityPath=process.argv.find(value=>value.startsWith('--identity='))?.slice('--identity='.length);
  if(!identityPath)throw new Error('mfp_labeled_fixture_identity_required');
  const identity=JSON.parse(await readFile(identityPath,'utf8'));
  const labeled=(await query(`SELECT m.*,c.concept_key,c.verdict,f.facets,f.input_digest
   FROM signal_concept_memberships_current_v1 c JOIN signal_mention_facets_current_v1 f USING(workspace_id,root_id)
   JOIN mentions m ON m.id=c.root_id WHERE c.workspace_id=$1 AND c.source='model' AND c.verdict='belongs'
    AND m.data_source_id=$2 AND f.status='labeled'
    AND NOT EXISTS(SELECT 1 FROM signal_mention_facet_overrides o WHERE o.root_id=m.id AND o.superseded_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_concept_membership_overrides o WHERE o.root_id=m.id AND o.superseded_at IS NULL)
   LIMIT 1`,[identity.workspace_id,identity.source_id])).rows[0];
  assert.ok(labeled,'The private fixture must have a current model membership and facet before this check');
  const labelCounts=async()=>(await query(`SELECT
   (SELECT count(*)::int FROM signal_mention_facet_labels WHERE workspace_id=$1 AND root_id=$2) facets,
   (SELECT count(*)::int FROM signal_concept_memberships WHERE workspace_id=$1 AND root_id=$2) memberships,
   (SELECT count(*)::int FROM signal_mention_facet_overrides WHERE workspace_id=$1 AND root_id=$2) facet_overrides,
   (SELECT count(*)::int FROM signal_concept_membership_overrides WHERE workspace_id=$1 AND root_id=$2) membership_overrides`,[identity.workspace_id,labeled.id])).rows[0];
  await query(`INSERT INTO signal_mention_facet_overrides(workspace_id,root_id,dimension,value,actor_user_id)
   VALUES($1,$2,'voice',$3::jsonb,$4)`,[identity.workspace_id,labeled.id,JSON.stringify(labeled.facets.voice),identity.actor_user_id]);
  await query(`INSERT INTO signal_concept_membership_overrides(workspace_id,root_id,concept_key,verdict,actor_user_id)
   VALUES($1,$2,$3,'belongs',$4)`,[identity.workspace_id,labeled.id,labeled.concept_key,identity.actor_user_id]);
  const retained=await labelCounts();assert.ok(retained.facets>0&&retained.memberships>0);
  assert.equal((await query('SELECT source FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2 AND concept_key=$3',
   [identity.workspace_id,labeled.id,labeled.concept_key])).rows[0].source,'human');checks++;
  const liveBatch=randomUUID();
  const base=(await query("SELECT id FROM import_batches WHERE workspace_id=$1 AND data_source_id=$2 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1",[identity.workspace_id,identity.source_id])).rows[0].id;
  await query("SET LOCAL session_replication_role='replica'");
  await query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,source_file_name,status,
    ingestion_phase,expected_file_size_bytes,upload_protocol,worker_job_id,imported_by_user_id,content_revision_mode,content_revision_base_batch_id)
    VALUES($1,$2,$3,'listening_csv','rollback-only.csv','processing','processing',100,'server-stream',$1,$4,'revise_existing',$5)`,
   [liveBatch,identity.workspace_id,identity.source_id,identity.actor_user_id,base]);
  await query("SET LOCAL session_replication_role='origin'");
  const changedText=labeled.text_clean+' [Synthetic rollback revision: previous content retained.]';
  const nextContent={...labeled,text_raw:changedText,text_clean:changedText,text_hash:sha(changedText.toLowerCase()),text_length:changedText.length,text_snippet:changedText.slice(0,300)};
  await query('SELECT * FROM stage_signal_mention_content_revisions_v1($1,$2::jsonb)',[liveBatch,JSON.stringify([{mention_id:labeled.id,content:nextContent}])]);
  await complete(liveBatch);
  // No new preparation is run: neither old citations nor human projection can be served as current.
  assert.equal((await query('SELECT count(*)::int n FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2',[identity.workspace_id,labeled.id])).rows[0].n,0);
  assert.equal((await query('SELECT count(*)::int n FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2',[identity.workspace_id,labeled.id])).rows[0].n,0);
  assert.deepEqual(await labelCounts(),retained);checks++;
  await query('ROLLBACK');
  assert.equal((await query('SELECT text_clean FROM mentions WHERE id=$1',[labeled.id])).rows[0].text_clean,labeled.text_clean);checks++;
  console.log(JSON.stringify({stage:'import_content_revisions',status:'passed',real_postgres:true,synthetic_fixture:true,
   checks,rolled_back:true,provider_calls:0,production_acceptance:false}));
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();await pool.end();}
});
