import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FACET_ROSTER_SQL,facetCallerRouteV1,facetCounterDeltaV1,facetInputSourcesV1,facetOutcomesEqualV1,facetPairVerdictV1,runFacetInputPreimageV1,writeFacetInputEvidenceV1} from './signal-facet-input-preimage.synthetic.fixture';

if(process.env.NOISIA_R16_FACET_INPUT_PREIMAGE_PURE==='true'){
 test('facet source oracle accepts only the exact one-expression preimage candidate',async()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
  const [old,candidate]=await Promise.all([
   readFile(join(root,'infrastructure/db/migrations/0258_signal_membership_context_review.sql'),'utf8'),
   readFile(join(root,'infrastructure/db/migrations/signal-facet-input-preimage.candidate.sql'),'utf8'),
  ]);
  const sources=facetInputSourcesV1(old,candidate);
  assert.match(sources.source_sha256,/^[a-f0-9]{64}$/u);
  assert.match(sources.candidate_sha256,/^[a-f0-9]{64}$/u);
  assert.ok(sources.canonical.includes('text_sha256'));
  assert.notEqual(sources.old,sources.candidate);
 });

 test('facet caller router redirects only the exact roster query once',async()=>{
  const calls:Array<{sql:string;values?:unknown[]}> = [];
  const query=(async(sql:string,values?:unknown[])=>{calls.push({sql,values});return{rows:[]};}) as never;
  const route=facetCallerRouteV1(query,'workspace-synthetic','new');
  await route.client.query(FACET_ROSTER_SQL,['workspace-synthetic']);
  await route.client.query('SELECT 1',[]);
  route.assertComplete();
  await assert.rejects(route.client.query(FACET_ROSTER_SQL,['workspace-synthetic']),/exactly once/u);
  assert.deepEqual(calls,[
   {sql:FACET_ROSTER_SQL.replace('signal_mention_facets_current_v1','pg_temp.r16_facet_input_new'),values:['workspace-synthetic']},
   {sql:'SELECT 1',values:[]},
  ]);
 });

 test('facet paired verdict enforces both median and per-pair bounds',()=>{
  const passing=facetPairVerdictV1([
   {arm:'old',ms:100},{arm:'new',ms:90},{arm:'new',ms:90},{arm:'old',ms:100},
  ]);
  assert.equal(passing.median_ratio,.9);
  assert.equal(passing.passed,true);
  const medianReject=facetPairVerdictV1([
   {arm:'old',ms:100},{arm:'new',ms:91},{arm:'new',ms:91},{arm:'old',ms:100},
  ]);
  assert.equal(medianReject.passed,false);
  const pairReject=facetPairVerdictV1([
   {arm:'old',ms:100},{arm:'new',ms:111},{arm:'new',ms:60},{arm:'old',ms:100},
  ]);
  assert.ok(pairReject.median_ratio<=.90,'median passes independently');
  assert.equal(pairReject.passed,false,'one pair above 1.10 rejects despite passing median');
  assert.throws(()=>facetPairVerdictV1([
   {arm:'old',ms:100},{arm:'new',ms:90},{arm:'old',ms:100},{arm:'new',ms:90},
  ]));
 });

 test('facet counter delta preserves UNKNOWN when a before or after baseline is absent',()=>{
  const before=[{funcid:'42',calls:'10',total_time:20,self_time:12}];
  const after=[{funcid:'42',calls:'14',total_time:32,self_time:18}];
  assert.deepEqual(facetCounterDeltaV1(before,after,'42'),{
   known:true,calls:'4',total_elapsed_ms:12,self_elapsed_ms:6,not_cpu:true,
  });
  assert.deepEqual(facetCounterDeltaV1([],after,'42'),{known:false,calls:null,reason:'absent_UNKNOWN'});
  assert.deepEqual(facetCounterDeltaV1(before,[],'42'),{known:false,calls:null,reason:'absent_UNKNOWN'});
 });

 test('facet role and error oracle refuses unknown paths and compares valid rejection outcomes',()=>{
  assert.equal(facetOutcomesEqualV1([
   {known:false},{known:false},{known:false},
  ]),false,'three unknown outcomes are not evidence of equal behavior');
  assert.equal(facetOutcomesEqualV1([
   {known:true,ok:false,sqlstate:'42501'},
   {known:true,ok:false,sqlstate:'42501'},
   {known:true,ok:false,sqlstate:'42501'},
  ]),true,'the same contractual authorization rejection is comparable');
  assert.equal(facetOutcomesEqualV1([
   {known:true,ok:false,sqlstate:'42501'},
   {known:false},
   {known:true,ok:false,sqlstate:'42501'},
  ]),false,'a mixture containing unknown remains inconclusive');
  assert.equal(facetOutcomesEqualV1([
   {known:true,ok:false,sqlstate:'SECRET'},
   {known:true,ok:false,sqlstate:'SECRET'},
   {known:true,ok:false,sqlstate:'SECRET'},
  ]),false,'invalid SQLSTATE is never treated as a known rejection');
 });

 test('facet evidence writer is private, size-bounded and create-once',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'r16-facet-preimage-pure-'));
  try{
   const value={contract:'r16-facet-input-preimage-v1',status:'observed'};
   await writeFacetInputEvidenceV1(directory,value);
   const path=join(directory,'facet-input-preimage.json');
   assert.deepEqual(JSON.parse(await readFile(path,'utf8')),value);
   assert.equal((await stat(path)).mode&0o777,0o600);
   await assert.rejects(writeFacetInputEvidenceV1(directory,{contract:'overwrite'}),{code:'EEXIST'});
   await assert.rejects(writeFacetInputEvidenceV1(directory,{large:'x'.repeat(2*1024*1024)}),/2MiB/u);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
}

test('native facet input preimage preserves view semantics and paired execution',{
 skip:process.env.NOISIA_R16_FACET_INPUT_PREIMAGE_PG!=='true',
},async()=>{
 assert.notEqual(process.env.NOISIA_R16_FACET_INPUT_PREIMAGE_PURE,'true','native and pure modes are separate');
 const directory=process.env.R16_FACET_INPUT_PREIMAGE_EVIDENCE_DIR;assert.ok(directory,'evidence directory required');
 const report=await runFacetInputPreimageV1(directory);
 assert.equal(report.contract,'r16-facet-input-preimage-v1');
 assert.equal(report.status,'observed');
 assert.equal(report.diagnostic_only,true);
 assert.equal(report.h1_accepted,false);
 assert.equal(report.cpu,'UNKNOWN');
 const gates=report.gates as Record<string,unknown>;
 const required=['semantics','roles_errors','native_counters','paired_wall','catalog_unchanged','closure_confirmed','source_binding'].sort();
 assert.deepEqual(Object.keys(gates).sort(),required);
 assert.ok(Object.values(gates).every(value=>typeof value==='boolean'));
 assert.equal(report.candidate_accepted,Object.values(gates).every(value=>value===true));
 const saved=JSON.parse(await readFile(join(directory,'facet-input-preimage.json'),'utf8')) as Record<string,unknown>;
 assert.deepEqual(saved,JSON.parse(JSON.stringify(report)),'native evidence writer must persist the complete returned report');
});
