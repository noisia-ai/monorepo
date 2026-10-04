import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { openDatabase, main } from './guard.mjs';
import { runJob } from './job';
await main(async()=>{
  const [path,start,end]=process.argv.slice(2);
  if(!path||!/^\d{4}-\d{2}-\d{2}$/u.test(start??'')||!/^\d{4}-\d{2}-\d{2}$/u.test(end??''))throw new Error('mfp_import_arguments_required');
  const identity=JSON.parse(await readFile('.data/dev-corpus/identity.json','utf8'));
  const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);
  const key=`mfp-import-${digest.digest('hex')}`;
  const pool=await openDatabase();
  try {
    const {db}=await import('../../apps/studio/src/lib/db');const {users}=await import('../../infrastructure/db');
    const actor=(await db.select().from(users)).find(row=>row.id===identity.actor_user_id);
    if(!actor)throw new Error('mfp_actor_missing');
    const {resolveSignalWorkspaceForUser}=await import('../../apps/studio/src/lib/data-os/signal-workspace');
    const workspace=await resolveSignalWorkspaceForUser(actor,{workspaceId:identity.workspace_id});
    if(!workspace)throw new Error('mfp_workspace_missing');
    const {createWorkspaceImportUploadV1,finalizeWorkspaceImportUploadV1,retryWorkspaceImportFromStorageV1}=await import('../../apps/studio/src/lib/data-os/workspace-async-import');
    const {uploadWorkspaceImportMultipartStreamV1}=await import('../../apps/studio/src/lib/data-os/workspace-import-storage');
    const access={workspace,actor,access:'manual-import' as const,sourceId:identity.source_id};
    const created=await createWorkspaceImportUploadV1({...access,fileName:basename(path),fileSizeBytes:(await stat(path)).size,contentType:'text/csv',
      idempotencyKey:key,contributedByStudyCorpusId:null,supersedesImportBatchId:null,acquisition:{sourceKey:identity.source_key,slotKey:'primary-brand',
        queryEvidence:{class:'unavailable',queryVersion:null,reason:'provider_did_not_embed_query'},period:{start:start!,end:end!,timezone:identity.timezone}}});
    let batchId=created.batch.id;
    // Follow the product recovery lineage; never re-upload a sealed failed object.
    for (;;) {
      const successor=(await pool.query('SELECT id FROM import_batches WHERE workspace_id=$1 AND supersedes_import_batch_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[workspace.id,batchId])).rows[0];
      if(!successor)break;batchId=successor.id;
    }
    const prior=(await pool.query('SELECT status FROM import_batches WHERE id=$1',[batchId])).rows[0];
    if(prior.status==='failed'){
      if(!process.argv.includes('--retry'))throw new Error('mfp_explicit_retry_required');
      const recovered=await retryWorkspaceImportFromStorageV1({...access,importBatchId:batchId,idempotencyKey:`mfp-import-retry-${batchId}`});
      batchId=recovered.batch.id;
    }else if(batchId===created.batch.id&&created.upload)await uploadWorkspaceImportMultipartStreamV1({upload:created.upload,body:Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,contentType:'text/csv'});
    if(prior.status!=='failed'&&batchId===created.batch.id)await finalizeWorkspaceImportUploadV1({...access,importBatchId:batchId,idempotencyKey:key});
    const batch=(await pool.query('SELECT status,worker_job_id FROM import_batches WHERE id=$1',[batchId])).rows[0];
    if(batch.status!=='completed'){
      const injectFailure=process.argv.includes('--test-fail-import');
      if(injectFailure&&!identity.fixture_key.endsWith('-recovery-check'))throw new Error('mfp_recovery_fixture_required');
      const {ingestMentionsCsvJob}=await import('../../services/workers/src/workers/mentions-csv-ingest');
      await runJob('ingest_mentions_csv',batch.worker_job_id,{workspaceId:workspace.id,dataSourceId:identity.source_id,importBatchId:batchId,sourceFileName:basename(path),testFailAfterRecords:injectFailure?1:undefined},ingestMentionsCsvJob);
    }
    const result=(await pool.query('SELECT status,record_count,included_count,excluded_count,duplicate_count FROM import_batches WHERE id=$1',[batchId])).rows[0];
    console.log(JSON.stringify({stage:'import',...result,replayed:created.replayed,provider_calls:0}));
  } finally {await pool.end();}
});
