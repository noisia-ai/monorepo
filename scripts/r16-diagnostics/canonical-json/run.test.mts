import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {guard,artifactPath,observationError,verdict,writePrivateArtifact} from './run.mjs';
import {fixtures,timedSql} from './candidate.mjs';
const env={GITHUB_ACTIONS:'true',NOISIA_R16_CANONICAL_READONLY:'true',NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:51772/noisia_mfp_ci'};
test('requires actual CI, explicit opt-in, exact owned loopback target and numeric run IDs',()=>{
 guard(env);
 for(const patch of [{GITHUB_ACTIONS:'false'},{NOISIA_R16_CANONICAL_READONLY:''},{NOISIA_R16_LOCAL_PG_LAB:'other'},{GITHUB_RUN_ID:'../escape'},{GITHUB_RUN_ATTEMPT:'0'},{DATABASE_URL:'postgresql://postgres:x@localhost:51772/noisia_mfp_ci'},{DATABASE_URL:env.DATABASE_URL+'?sslmode=disable'},{DATABASE_URL:env.DATABASE_URL.replace('noisia_mfp_ci','production')}])assert.throws(()=>guard({...env,...patch}));
});
test('artifact destination cannot escape its run directory',()=>{
 assert.equal(artifactPath('/tmp/repo','123','2'),'/tmp/repo/.data/piloto-masivo/r16/canonical-json/123-2/result.json');
 for(const id of ['../x','123/other','','01','-1'])assert.throws(()=>artifactPath('/tmp/repo',id,'1'));
});
test('timeouts and stack exhaustion are censored, other errors never claim equivalence',()=>{
 assert.deepEqual(observationError({code:'57014'}),{state:'censored',code:'57014'});
 assert.equal(observationError({code:'54001'}).state,'censored');
 assert.equal(observationError({code:'42501'}).state,'error');
 assert.equal(observationError(new Error('secret detail')).code,'unknown');
 assert.equal(verdict([{complete:false,equal:null}],[]),'censored-no-equivalence-proof');
 assert.equal(verdict([{complete:true,equal:false}],[]),'rejected-byte-mismatch');
});
test('slower candidate is rejected and faster helper never accepts H1',()=>{
 const rows=[{complete:true,equal:true}];
 assert.equal(verdict(rows,[{arm:'old',ms:2},{arm:'candidate',ms:3}]),'rejected-not-faster');
 assert.equal(verdict(rows,[{arm:'old',ms:3},{arm:'candidate',ms:2}]),'diagnostic-only-faster-not-production-proof');
});
test('fixtures preserve SQL NULL, JSON null, exact numeric text and 32 independent large cases',()=>{
 const cases=fixtures();assert.equal(new Set(cases.map(x=>x.id)).size,cases.length);
 assert.equal(cases.find(x=>x.id==='sql-null')!.json,null);
 assert.equal(cases.find(x=>x.id==='json-null')!.json,'null');
 assert.equal(cases.find(x=>x.id==='numeric-precision')!.json,'12345678901234567890.123456789012345678901');
 assert.equal(cases.filter(x=>x.id.startsWith('warmup-large-')).length,32);
 assert.ok(cases.filter(x=>x.deep).every(x=>x.json!.startsWith('[')));
});
test('both timing arms use the same fixture Var and consume one materialized result identically',()=>{
 for(const single of [true,false]){
  assert.equal(timedSql('old',single).replace('public.signal_labeling_json_v1','FUNCTION'),timedSql('candidate',single).replace('pg_temp.r16_json_flat_v1','FUNCTION'));
  assert.match(timedSql('old',single),/serialized AS MATERIALIZED/u);
  assert.match(timedSql('old',single),/octet_length\(value\)/u);
 }
});

test('private evidence is mode 0600 and never overwrites an earlier receipt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r16-canonical-pure-'));
 const dest=join(dir,'run','result.json');
 try{
  await writePrivateArtifact(dest,{diagnostic_only:true});
  assert.equal((await stat(dest)).mode&0o777,0o600);
  const bytes=await readFile(dest,'utf8');
  await assert.rejects(writePrivateArtifact(dest,{changed:true}),{code:'EEXIST'});
  assert.equal(await readFile(dest,'utf8'),bytes);
 }finally{await rm(dir,{recursive:true});}
});
