import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openR16CiPostgresV1} from '../../infrastructure/db/migrations/signal-r16-local-pg.fixture';
import {runR16ListeningFaultMatrixV1} from './run-listening-fault-matrix';
import {runR16ListeningBenchmarkV1} from './run-listening-benchmark';
import {createR16ListeningNativeFixtureV1} from './listening-native-fixture';
import {loadR16ListeningNativeCensusV1} from './listening-native-census';
import {R16QueryProfilerV1} from './query-profiler';
import {captureR16SourceProvenanceV1} from './source-provenance';

export function assertR16ListeningCiEnvironmentV1(env:NodeJS.ProcessEnv){
 assert.equal(env.GITHUB_ACTIONS,'true','r16_listening_ci_requires_real_ci');
 assert.equal(env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17','r16_listening_ci_owned_lab_required');
 for(const key of ['NOISIA_R16_NATIVE_FIXTURE_PG','NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED','NOISIA_JEV_STREAMING_V2_ENABLED'])
  assert.equal(env[key],'true','r16_listening_ci_explicit_flags_required');
 const pg=new URL(env.DATABASE_URL??''),redis=new URL(env.R16BENCH_REDIS_URL??'');
 assert.equal(pg.protocol,'postgresql:');assert.equal(pg.hostname,'127.0.0.1');assert.equal(pg.pathname,'/noisia_mfp_ci');
 assert.equal(pg.username,'postgres');assert.ok(pg.port);assert.equal(pg.search,'');assert.equal(pg.hash,'');
 assert.ok(['redis:','rediss:'].includes(redis.protocol)&&['127.0.0.1','localhost','[::1]'].includes(redis.hostname),'r16_listening_ci_redis_not_local');
}
async function writePrivate(path:string,value:unknown){const handle=await open(path,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}}
/** CI owns this disposable Docker lab; the fixture still attests its actual
 * image, loopback binding, database, server identity and pgvector extension. */
export async function runR16ListeningCiV1(){
 assertR16ListeningCiEnvironmentV1(process.env);
 const repo=resolve(fileURLToPath(new URL('../..',import.meta.url))),source=await captureR16SourceProvenanceV1(repo);
 assert.equal(source.tree_status_sha256,'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','r16_listening_ci_source_must_be_clean');
 const pool=await openR16CiPostgresV1();
 try{const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM mentions) roots,
  (SELECT count(*)::int FROM signal_labeling_calls) calls,(SELECT count(*)::int FROM signal_listening_configurations) configurations`)).rows[0];
  assert.deepEqual(counts,{roots:0,calls:0,configurations:0},'r16_listening_ci_empty_owned_lab_required');
 }finally{await pool.end();}
 const directory=resolve('.data/piloto-masivo/r16'),tag='listening-ci-'+randomUUID();
 await mkdir(directory,{recursive:true,mode:0o700});
 const faults=await runR16ListeningFaultMatrixV1({object_directory:join(directory,tag+'-fault-objects'),redis_url:process.env.R16BENCH_REDIS_URL!,
  writeArtifact:value=>writePrivate(join(directory,tag+'-fault-matrix.json'),value),
  writeCaseArtifact:value=>writePrivate(join(directory,tag+'-fault-case-'+randomUUID()+'.json'),value)});
 assert.equal(faults.source.source_tree_sha256,source.source_tree_sha256,'r16_listening_ci_fault_source_changed');
 assert.equal(faults.diagnostic_subset,false);assert.equal(faults.case_count,faults.required_case_count);
 const query_profiler=new R16QueryProfilerV1();
 const measurement=await runR16ListeningBenchmarkV1({arm:'defined_consumer_second_pass',object_directory:join(directory,tag+'-capacity-objects'),
  redis_url:process.env.R16BENCH_REDIS_URL!,query_profiler,
  writePreregistration:value=>writePrivate(join(directory,tag+'-preregistration.json'),value),
  withNativeFixture:createR16ListeningNativeFixtureV1({decorateDatabase:db=>query_profiler.wrapDatabase(db),
   loadNativeCensus:args=>loadR16ListeningNativeCensusV1(args)})});
 await writePrivate(join(directory,tag+'-measurement.json'),measurement);
 assert.equal(measurement.source_provenance.source_tree_sha256,faults.source.source_tree_sha256,'r16_listening_ci_capacity_source_changed');
 assert.ok(Object.values(measurement.capacity_gates).every(value=>value===true),'r16_listening_ci_capacity_rejected');
 return{native_faults:'complete',capacity_gates:measurement.capacity_gates,artifact_tag:tag};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await runR16ListeningCiV1())+'\n');}
 catch{process.stderr.write('r16_listening_ci_failed; inspect private synthetic artifacts\n');process.exitCode=1;}
}
