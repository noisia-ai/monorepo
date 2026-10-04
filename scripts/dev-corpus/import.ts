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
    const {createWorkspaceImportUploadV1,finalizeWorkspaceImportUploadV1}=await import('../../apps/studio/src/lib/data-os/workspace-async-import');
    const {uploadWorkspaceImportMultipartStreamV1}=await import('../../apps/studio/src/lib/data-os/workspace-import-storage');
    const access={workspace,actor,access:'manual-import' as const,sourceId:identity.source_id};
    const created=await createWorkspaceImportUploadV1({...access,fileName:basename(path),fileSizeBytes:(await stat(path)).size,contentType:'text/csv',
      idempotencyKey:key,contributedByStudyCorpusId:null,supersedesImportBatchId:null,acquisition:{sourceKey:identity.source_key,slotKey:'primary-brand',
        queryEvidence:{class:'unavailable',queryVersion:null,reason:'provider_did_not_embed_query'},period:{start:start!,end:end!,timezone:identity.timezone}}});
    if(created.upload)await uploadWorkspaceImportMultipartStreamV1({upload:created.upload,body:Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,contentType:'text/csv'});
    await finalizeWorkspaceImportUploadV1({...access,importBatchId:created.batch.id,idempotencyKey:key});
    const batch=(await pool.query('SELECT status,worker_job_id FROM import_batches WHERE id=$1',[created.batch.id])).rows[0];
    if(batch.status!=='completed'){
      const {ingestMentionsCsvJob}=await import('../../services/workers/src/workers/mentions-csv-ingest');
      await runJob('ingest_mentions_csv',batch.worker_job_id,{workspaceId:workspace.id,dataSourceId:identity.source_id,importBatchId:created.batch.id,sourceFileName:basename(path)},ingestMentionsCsvJob);
    }
    const result=(await pool.query('SELECT status,record_count,included_count,excluded_count,duplicate_count FROM import_batches WHERE id=$1',[created.batch.id])).rows[0];
    console.log(JSON.stringify({stage:'import',...result,replayed:created.replayed,provider_calls:0}));
  } finally {await pool.end();}
});
