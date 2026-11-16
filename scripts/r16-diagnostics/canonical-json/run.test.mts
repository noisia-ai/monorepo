import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {guard,artifactPath,observationError,verdict,writePrivateArtifact,guardDiagnostic,assertCurrentSeedRelations,currentSeedCounts} from './run.mjs';
import {fixtures,timedSql,listeningPreimage} from './candidate.mjs';
import {SIGNAL_LISTENING_REQUEST_VERSION_V1,signalListeningRequestDigestV1,type SignalListeningInputV1} from '../../../packages/query-engine/src/signal-listening-contracts.js';
import {signalWorkspaceEmbeddingDigestV1} from '../../../packages/query-engine/src/signal-workspace-embeddings-v1.js';
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

test('large synthetic preimage is consumed by the real request digest contract',()=>{
 const preimage=listeningPreimage(4);
 assert.equal(preimage.request_version,SIGNAL_LISTENING_REQUEST_VERSION_V1);
 assert.deepEqual(Object.keys(preimage.request.questions).sort(),Array.from({length:16},(_,q)=>`topic_${q}`).sort());
 assert.deepEqual(Object.keys(preimage.question_digests).sort(),Object.keys(preimage.request.questions).sort());
 const base=listeningPreimage(4,'base');
 assert.deepEqual(Object.keys(base.request.questions).sort(),['promotion','voice']);
 assert.equal(base.request.questions.voice!.type,'choice');assert.equal(base.request.questions.promotion!.type,'noul');
 assert.deepEqual(Object.keys(base.question_digests).sort(),['promotion','voice']);assert.deepEqual(base.scope_basis,{});
 assert.deepEqual(Object.keys(preimage.scope_basis).sort(),Array.from({length:16},(_,q)=>`topic_${q}`).sort());
 assert.ok(!('voice' in preimage.scope_basis)&&!('promotion' in preimage.scope_basis));
 const basis=signalWorkspaceEmbeddingDigestV1({voice:'00000000-0000-4000-8000-000000000100',promotion:'00000000-0000-4000-8000-000000000101'});
 assert.ok(Object.values(preimage.scope_basis).every(value=>value===basis));
 const input:SignalListeningInputV1={root_id:preimage.root_id,input_digest:preimage.input_digest,question_digests:preimage.question_digests,scope_basis:preimage.scope_basis,text:String(preimage.request.state),title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01',language:'es',map_id:'00000000-0000-4000-8000-000000000300',question_keys:Object.keys(preimage.request.questions),configuration_digest:'sha256:'+'3'.repeat(64)};
 assert.equal(signalListeningRequestDigestV1({id:preimage.run_id,entity_context_digest:preimage.entity_context_digest},input,preimage.request),signalWorkspaceEmbeddingDigestV1(preimage));
});

test('schema guard failure preserves safe phase/table/count/code but excludes driver messages and values',()=>{
 const error={code:'ERR_ASSERTION',message:'secret raw query',query:'SELECT secret',actual:['customer payload']};
 const safe=guardDiagnostic(error,{phase:'schema-count',table:'taxonomies',actual_count:4,expected_count:3});
 assert.deepEqual(safe,{phase:'schema-count',code:'ERR_ASSERTION',table:'taxonomies',actual_count:4,expected_count:3});
 assert.doesNotMatch(JSON.stringify(safe),/secret|SELECT|customer|payload/u);
 assert.equal(guardDiagnostic({code:'42P01',detail:'raw values'},{phase:'schema-count',table:'taxonomies'}).code,'42P01');
 assert.equal(guardDiagnostic({code:'secret value'},{phase:'schema-relations'}).code,'unknown');
 assert.throws(()=>guardDiagnostic(error,{phase:'schema-count',table:'bad; SELECT secret'}));
 assert.throws(()=>guardDiagnostic(error,{phase:'schema-count',actual_count:NaN}));
 assert.throws(()=>guardDiagnostic(error,{phase:'schema-count',actual_count:-1}));
 assert.throws(()=>guardDiagnostic(error,{phase:'unknown' as never}));
});

test('current schema metadata requires four live seed relations and rejects retired backfill even if empty',()=>{
 const current=['taxonomies','taxonomy_terms','methodology_taxonomy_bindings','signal_topic_context_identity_cuts_v1'];
 assertCurrentSeedRelations([...current,'mentions','users']);
 assert.deepEqual(currentSeedCounts,{taxonomies:3,taxonomy_terms:6,methodology_taxonomy_bindings:3,signal_topic_context_identity_cuts_v1:1});
 assert.throws(()=>assertCurrentSeedRelations([...current,'signal_mention_text_digest_backfill_state']),/retired/u);
 for(const missing of current)assert.throws(()=>assertCurrentSeedRelations(current.filter(x=>x!==missing)),/must exist/u);
});
