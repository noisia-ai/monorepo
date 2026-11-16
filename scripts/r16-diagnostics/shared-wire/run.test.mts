import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {guard,artifactPath,observationError,verdict,writePrivateArtifact,assertCurrentSeedRelations,currentSeedCounts} from './run.mjs';
import {fixtures,fixtureConfigurations,listeningPreimage,batchSql,batchSizes,sharedWireValidatorSql,validatorCanonicalProjectionSql} from './candidate.mjs';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '../../../packages/query-engine/src/signal-workspace-embeddings-v1.js';
import {signalListeningRequestDigestV1,compileSignalListeningSnapshotV1,readSignalListeningSnapshotV1,
 buildSignalListeningCompiledRequestV1,type SignalListeningInputV1} from '../../../packages/query-engine/src/signal-listening-contracts.js';

const env={GITHUB_ACTIONS:'true',NOISIA_R16_SHARED_WIRE_READONLY:'true',NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:51772/noisia_mfp_ci'};
test('counterfactual cannot open a non-CI, remote, unowned or provider-authenticated target',()=>{
 guard(env);
 for(const patch of [{GITHUB_ACTIONS:'false'},{NOISIA_R16_SHARED_WIRE_READONLY:''},{NOISIA_R16_LOCAL_PG_LAB:'other'},{GITHUB_RUN_ID:'../escape'},{GITHUB_RUN_ATTEMPT:'0'},{DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','localhost')},{DATABASE_URL:env.DATABASE_URL+'?sslmode=disable'},{DATABASE_URL:env.DATABASE_URL.replace('noisia_mfp_ci','production')},{ANTHROPIC_API_KEY:'synthetic-but-forbidden'},{TYPESAFE_API_KEY:'synthetic-but-forbidden'},{VOYAGE_API_KEY:'synthetic-but-forbidden'},{OPENAI_API_KEY:'synthetic-but-forbidden'}])assert.throws(()=>guard({...env,...patch}));
});
test('schema guard requires all four current seeds and rejects the retired relation even empty',()=>{
 const names=Object.keys(currentSeedCounts);
 assertCurrentSeedRelations([...names,'mentions','users']);
 assert.deepEqual(currentSeedCounts,{taxonomies:3,taxonomy_terms:6,methodology_taxonomy_bindings:3,signal_topic_context_identity_cuts_v1:1});
 assert.throws(()=>assertCurrentSeedRelations([...names,'signal_mention_text_digest_backfill_state']));
 for(const name of names)assert.throws(()=>assertCurrentSeedRelations(names.filter(x=>x!==name)));
});
test('evidence is private, bounded to its run and never replaces a receipt',async()=>{
 assert.equal(artifactPath('/tmp/repo','123','2'),'/tmp/repo/.data/piloto-masivo/r16/shared-wire-validator/123-2/result.json');
 for(const id of ['../x','123/other','','01','-1'])assert.throws(()=>artifactPath('/tmp/repo',id,'1'));
 const dir=await mkdtemp(join(tmpdir(),'r16-shared-wire-pure-')),dest=join(dir,'run','result.json');
 try{await writePrivateArtifact(dest,{diagnostic_only:true});assert.equal((await stat(dest)).mode&0o777,0o600);
  const bytes=await readFile(dest,'utf8');await assert.rejects(writePrivateArtifact(dest,{}),{code:'EEXIST'});assert.equal(await readFile(dest,'utf8'),bytes);
 }finally{await rm(dir,{recursive:true});}
});
test('censoring and unmatched or slower timing never establish equivalence or H1 acceptance',()=>{
 assert.equal(observationError({code:'54001'}).state,'censored');assert.equal(observationError({code:'57014'}).state,'censored');
 assert.equal(observationError(new Error('private raw detail')).code,'unknown');
 assert.equal(verdict([{complete:false,equal:null}],[]),'censored-no-equivalence-proof');
 assert.equal(verdict([{complete:true,equal:false}],[]),'rejected-byte-mismatch');
 assert.equal(verdict([{complete:true,equal:true}],[{context:'base:32',round:0,arm:'old',ms:2},{context:'base:32',round:0,arm:'candidate',ms:3}]),'rejected-not-faster');
 assert.equal(verdict([{complete:true,equal:true}],[{context:'base:32',round:0,arm:'old',ms:3},{context:'base:32',round:0,arm:'candidate',ms:2}]),'diagnostic-only-faster-not-production-proof');
 assert.equal(verdict([{complete:true,equal:true}],[{context:'base:32',round:0,arm:'old',ms:3},{context:'consumer:32',round:0,arm:'candidate',ms:2}]),'unavailable-timing');
});
test('current compiler produces the actual workload base2 and consumer2 identities',()=>{
 for(const phase of ['base','consumer']as const){
  const value=listeningPreimage(4,phase),keys=Object.keys(value.request.questions).sort();
  assert.equal(keys.length,2);assert.equal('topic_15' in value.request.questions,false);
  assert.deepEqual(Object.keys(value.question_digests).sort(),keys);
  assert.equal(Object.keys(value.scope_basis).length,phase==='base'?0:2);
  const input={root_id:value.root_id,input_digest:value.input_digest,question_digests:value.question_digests,scope_basis:value.scope_basis}as SignalListeningInputV1;
  assert.equal(signalListeningRequestDigestV1({id:value.run_id,entity_context_digest:value.entity_context_digest},input,value.request),digest(value));
 }
});
test('serialized fixture configuration round-trips through the actual canonical snapshot without changing any wire or interior Unicode',()=>{
 let questions=0;
 for(const f of fixtureConfigurations().filter(x=>x.configuration_json!==null)){
  const stored=JSON.parse(f.configuration_json!),snapshot=compileSignalListeningSnapshotV1(stored);
  const canonical=readSignalListeningSnapshotV1(snapshot).configuration;
  assert.deepEqual(stored,canonical,'SQL wire fixture must receive the exact canonical configuration consumed by the request compiler');
  const rebuilt=buildSignalListeningCompiledRequestV1({text:'synthetic',question_keys:canonical.questions.map(q=>q.key)},snapshot);
  assert.deepEqual(JSON.parse(f.json),rebuilt.questions);questions+=canonical.questions.length;
  if(f.id==='unicode'){
   assert.ok(stored.instructions.includes('é é 😀 "quoted" \\'));
   assert.ok(stored.instructions.includes('\n')&&stored.instructions.includes('\t'));
   assert.ok(stored.instructions.includes('\u2028\u2029 inside'));
   assert.ok(canonical.questions.every(q=>q.text.includes('"á" 😀')));
  }
 }
 assert.equal(questions,8,'the native strict check still covers all eight workload and Unicode wires');
});
test('native correctness cases include precision, duplicate-key collapse, fallbacks and heterogeneity without JS numeric parsing',()=>{
 const cases=fixtures();assert.equal(new Set(cases.map(x=>x.id)).size,cases.length);
 for(const id of ['sql-null','json-null','missing-key','extra-key','numeric-input-digest','numeric-wire','wire-mismatch','duplicate-keys','duplicate-question-keys','unicode','questions-null','request-null','heterogeneous-subset'])assert.ok(cases.some(x=>x.id===id),id);
 assert.equal(cases.find(x=>x.id==='sql-null')!.json,null);
 assert.ok(cases.find(x=>x.id==='numeric-input-digest')!.json!.includes('1234567890.1234567890123456789'));
 assert.deepEqual(batchSizes,[32,264,1024,4096]);
 // Syntax validation discards its result; fixture bytes are never reserialized.
 for(const value of cases)if(value.json!==null)assert.doesNotThrow(()=>JSON.parse(value.json!),value.id);
});
test('timing queries consume variable temp rows, full hashes and bytes; compilation is inside the candidate timed query',()=>{
 for(const arm of ['old','candidate']as const){const sql=batchSql(arm);
  assert.match(sql,/pg_temp\.r16_shared_wire_cases/u);assert.match(sql,/LIMIT \$2/u);
  assert.match(sql,/serialized AS MATERIALIZED/u);assert.match(sql,/octet_length\(canonical\)/u);assert.match(sql,/sha256\(convert_to\(canonical/u);
 }
 assert.match(batchSql('candidate'),/fragments AS MATERIALIZED/u);
 assert.match(batchSql('candidate'),/signal_labeling_json_v1\(wire\)/u);
});
test('native candidate refuses missing, repeated or already transformed canonical call boundaries',async()=>{
 const source=await readFile(new URL('../../../infrastructure/db/migrations/0329_signal_listening_expected_projection.sql',import.meta.url),'utf8');
 const sql=source.match(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\)/u)![1]!;
 const candidate=sharedWireValidatorSql(sql);
 assert.throws(()=>sharedWireValidatorSql(candidate),/shape/);
 assert.throws(()=>sharedWireValidatorSql(sql.replace('signal_labeling_digest_v1(','unrecognized_digest(')),/digest_shape/);
 assert.throws(()=>sharedWireValidatorSql(sql+sql),/shape/);
 assert.throws(()=>validatorCanonicalProjectionSql('SELECT 1','candidate'),/digest_shape/);
 // The eight-value oracle and flags must remain addressable independently;
 // neither a serializer-only SELECT nor a missing expected relation is enough.
 const {listeningExpectedProjectionOracleSqlV1}=await import('../../../infrastructure/db/migrations/signal-listening-statement-validator.oracle.js');
 assert.doesNotThrow(()=>listeningExpectedProjectionOracleSqlV1(candidate,true));
 assert.doesNotThrow(()=>validatorCanonicalProjectionSql(sql,'old'));
 assert.doesNotThrow(()=>validatorCanonicalProjectionSql(sql,'candidate'));
});
