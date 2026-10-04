import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDisposableFixture, checkTarget } from './guard.mjs';
import { parseCsv, csv } from './csv.mjs';
import { matchingEntities, selectGold, importGold } from './gold.mjs';
const target = JSON.parse(await readFile(new URL('./target.json', import.meta.url),'utf8'));
test('runtime stays idle by default and rejects worker startup outside the verified target', () => {
  const script = fileURLToPath(new URL('./runtime.mjs', import.meta.url));
  const idle = spawnSync(process.execPath, [script], { env: {}, encoding: 'utf8', timeout: 1000 });
  assert.deepEqual(JSON.parse(idle.stdout.trim()), { status: 'ready', execution: 'remote_private', automatic_work: false });
  assert.equal(idle.error?.code, 'ETIMEDOUT');
  const active = spawnSync(process.execPath, [script], { env: { NOISIA_MFP_WORKER_ENABLED: 'true' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(active.status, 1);
  assert.equal(JSON.parse(active.stderr.trim()).code, 'mfp_remote_execution_required');
});
const env = { RAILWAY_ENVIRONMENT_ID:target.environment_id, RAILWAY_ENVIRONMENT_NAME:'dev-test',
  RAILWAY_SERVICE_ID:target.runner_service_id, NOISIA_MFP_ENABLED:'true',
  DATABASE_URL:'postgresql://noisia_mfp:invented@pgvector.railway.internal:5432/noisia_mfp',
  REDIS_URL:'redis://:invented@mfp-redis.railway.internal:6379' };
test('only dedicated remote target is accepted', () => {
  assert.equal(checkTarget(env,target).db.pathname,'/noisia_mfp');
  for (const mutation of [{RAILWAY_ENVIRONMENT_NAME:'uat'},{RAILWAY_SERVICE_ID:'historical-runner'},
    {DATABASE_URL:env.DATABASE_URL.replace('noisia_mfp','noisia_dev')},
    {DATABASE_URL:env.DATABASE_URL.replace('pgvector.railway.internal','localhost')},
    {DATABASE_URL:env.DATABASE_URL+'?options=-csearch_path=other'}, {PGHOST:'localhost'},
    {REDIS_URL:env.REDIS_URL.replace('mfp-redis','shared-redis')}]) assert.throws(()=>checkTarget({...env,...mutation},target),/^Error: mfp_/u);
});
test('mutating concurrency probes require their own disposable fixture identity',()=>{
  assert.equal(assertDisposableFixture({fixture_key:'facets-lock-check-abc123'},'facets-lock-check').fixture_key,
    'facets-lock-check-abc123');
  assert.throws(()=>assertDisposableFixture({fixture_key:'voyage-real'},'facets-lock-check'),/disposable_fixture_required/u);
});
test('CSV round-trips quotes, accents and multiline text', () => {
  const data=[{a:'Descripción; uno',b:'Line 1\n"Line 2"'}];
  assert.deepEqual(parseCsv(csv(['a','b'],data)).records,data);
  assert.throws(()=>parseCsv('a,b\n"unfinished,b'),/unterminated/u);
});
const entities=[{entity_id:'a',name:'Bicycle A',kind:'primary_brand',aliases:['Bici Á']},
  {entity_id:'b',name:'Bicycle B',kind:'competitor',aliases:[]}];
const roots=Array.from({length:220},(_,i)=>({root_id:`root-${i}`,input_digest:`hash-${i}`,text:i<20?'Bici A versus Bicycle B':'A plain remark'}));
test('gold fixes strata and split, requires verified real comparison inputs',()=>{
  assert.equal(matchingEntities('bici a junto a Bicycle B',entities).length,2);
  assert.equal(matchingEntities('superbici a',entities).length,0);
  assert.throws(()=>selectGold(roots,entities,'seed'),/verified_comparisons/u);
  const selected=selectGold(roots,entities,'seed',roots.slice(0,20).map(root=>root.root_id));
  assert.equal(selected.length,150); assert.equal(selected.filter(row=>row.partition==='dev').length,90);
  assert.equal(selected.filter(row=>row.stratum==='comparison').length,15);
  assert.deepEqual(selected,selectGold([...roots].reverse(),entities,'seed',roots.slice(0,20).map(root=>root.root_id)));
});
test('gold import validates human dimensions, entity identity and source invariance',()=>{
  const selected=selectGold(roots,entities,'seed',roots.slice(0,20).map(root=>root.root_id));
  const rows=selected.map(row=>({...row,entities:'Bicycle A*; Bicycle B',entities_abstained:'false',unrelated_reason:'',
    voice:'individual',act:'opinion',spam_or_bot:'false',language:'es',asunto:'Comparación de bicicletas','concept:c':'belongs'}));
  assert.equal(importGold(rows,selected,{entities},['c']).length,150);
  assert.throws(()=>importGold([{...rows[0],entities:'Unknown'},...rows.slice(1)],selected,{entities},['c']),/unknown_entity/u);
  assert.throws(()=>importGold([{...rows[0],text:'changed'},...rows.slice(1)],selected,{entities},['c']),/source_changed/u);
});
test('brand route authenticates before delegating to shared service',async()=>{
  const source=await readFile(new URL('../../apps/studio/src/app/api/brands/route.ts',import.meta.url),'utf8');
  assert.match(source,/if \(!session\) return unauthorized\(\);\s*return createBrandForActorV1\(request, session.appUser\)/u);
});

test('sample preserves provider identity when distinct mentions have identical text',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mfp-sample-'));
  try{
    const source=join(root,'source'),output=join(root,'out');await mkdir(source);
    const records=Array.from({length:1200},(_,index)=>({id:`provider-${String(index).padStart(4,'0')}`,Title:'Title',
      'Content of posts':index<2?'Repeated post':'Post '+index}));
    await writeFile(join(source,'batch.csv'),csv(['id','Title','Content of posts'],records));
    const context=join(root,'context.json');await writeFile(context,JSON.stringify({entities:[]}));
    const script=fileURLToPath(new URL('./sample.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[script,source,context,output],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);
    const sampled=parseCsv(await readFile(join(output,'load1.csv'),'utf8')).records;
    assert.equal(sampled.length,1000);
    assert.deepEqual(sampled.slice(0,2).map(row=>row.id),['provider-0000','provider-0001']);
    assert.equal(sampled[0]['Content of posts'],sampled[1]['Content of posts']);
    const manifest=JSON.parse(await readFile(join(output,'sampling-manifest.json'),'utf8'));
    assert.equal(manifest.sampling,'provider-id-order-with-lexical-enrichment');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('job queues isolate concurrent work and recovery never converts unknown into retry',async()=>{
  const {queueNameForJob,recoveryIntent}=await import('./recovery.mjs');
  assert.notEqual(queueNameForJob('prepare-a'),queueNameForJob('embedding-b'));
  assert.equal(queueNameForJob('prepare-a'),queueNameForJob('prepare-a'));
  const failed={id:'run-a',status:'failed',retryable:true,updated_at:'2026-10-04T00:00:00Z',error_code:'workspace_embedding_definitely_not_sent',unknown_reserved_micro_usd:0};
  assert.throws(()=>recoveryIntent('embedding',{latest_run:failed},'original',false),/explicit_retry/u);
  assert.equal(recoveryIntent('embedding',{latest_run:{...failed,preparation_run_id:'old'}},'new',false,{preparation_run_id:'new'}).idempotency_key,'new');
  assert.equal(recoveryIntent('prepare',{latest_run:{...failed,input_revision:1}},'new',false,{input_revision:2}).idempotency_key,'new');
  assert.throws(()=>recoveryIntent('embedding',{is_current:true,latest_completed:{id:'done'},latest_run:{...failed,unknown_reserved_micro_usd:1}},'key',true),/requires_reconciliation/u);
  const unsnapshotted={latest_run:{...failed,input_revision:null}};
  assert.throws(()=>recoveryIntent('prepare',unsnapshotted,'original',false,{input_revision:1}),/explicit_retry/u);
  const successor=recoveryIntent('prepare',unsnapshotted,'original',true,{input_revision:1});
  assert.notEqual(successor.idempotency_key,'original');assert.equal(successor.resume_run_id,undefined);
  const retry=recoveryIntent('embedding',{latest_run:failed},'original',true);
  assert.equal(retry.resume_run_id,'run-a');assert.notEqual(retry.idempotency_key,'original');
  assert.deepEqual(retry,recoveryIntent('embedding',{latest_run:failed},'original',true));
  assert.throws(()=>recoveryIntent('embedding',{latest_run:{...failed,unknown_reserved_micro_usd:100}},'original',true),/requires_reconciliation/u);
  assert.throws(()=>recoveryIntent('embedding',{latest_run:{...failed,retryable:false}},'original',true),/not_retryable/u);
  assert.equal(recoveryIntent('prepare',{is_current:true,latest_completed:{id:'done'}},'key',true).kind,'completed');
});
