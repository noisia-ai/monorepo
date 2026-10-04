import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkTarget } from './guard.mjs';
import { parseCsv, csv } from './csv.mjs';
import { matchingEntities, selectGold, importGold } from './gold.mjs';
const target = JSON.parse(await readFile(new URL('./target.json', import.meta.url),'utf8'));
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
