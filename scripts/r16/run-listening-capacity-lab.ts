import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openR16LocalPostgresV1} from '../../infrastructure/db/migrations/signal-r16-local-pg.fixture';
import {captureR16SourceProvenanceV1} from './source-provenance';
import {createR16ListeningNativeFixtureV1} from './listening-native-fixture';
import {loadR16ListeningNativeCensusV1} from './listening-native-census';
import {runR16ListeningBenchmarkV1} from './run-listening-benchmark';

/** This command cannot provision, reset, migrate or select a remote target.
 * The orchestrator prepares the owned empty benchmark lab separately. */
export function assertR16ListeningCapacityLocalEnvironmentV1(env:NodeJS.ProcessEnv){
 assert.equal(env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17','r16_listening_capacity_owned_lab_required');
 assert.notEqual(env.GITHUB_ACTIONS,'true','r16_listening_capacity_local_command_not_ci');
 assert.equal(env.R16_LISTENING_QUIET_LAB_CONFIRMED,'true','r16_listening_capacity_quiet_lab_required');
 for(const flag of ['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED','NOISIA_JEV_STREAMING_V2_ENABLED'])
  assert.equal(env[flag],'true','r16_listening_capacity_explicit_flags_required');
 const pg=new URL(env.DATABASE_URL??''),redis=new URL(env.R16BENCH_REDIS_URL??'');
 assert.equal(pg.protocol,'postgresql:');assert.equal(pg.hostname,'127.0.0.1');
 assert.equal(pg.pathname,'/noisia_mfp_ci');assert.equal(pg.username,'postgres');assert.ok(pg.port);
 assert.equal(pg.search,'');assert.equal(pg.hash,'');
 assert.ok(['redis:','rediss:'].includes(redis.protocol)&&['127.0.0.1','localhost','[::1]'].includes(redis.hostname),
  'r16_listening_capacity_redis_not_local');
}

async function writePrivate(path:string,value:unknown){
 const handle=await open(path,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
}
const safeCode=(error:unknown)=>error instanceof Error&&/^(r16_|listening_|mass_labeling_|labeling_|workspace_engine_)[a-z0-9_]{1,140}$/u.test(error.message)
 ?error.message:'r16_listening_capacity_command_failed';

/** Measurements remain explicitly pending acceptance of the same-source native
 * fault pack. A fast run alone cannot close H1 or the R16 goal. */
export async function runR16ListeningCapacityLocalCommandV1(output_directory:string){
 assertR16ListeningCapacityLocalEnvironmentV1(process.env);
 const parent=resolve(output_directory);
 assert.match(parent,/\/\.data\/piloto-masivo\/r16(?:\/|$)/u,'r16_listening_capacity_private_artifact_path_required');
 const repo=resolve(fileURLToPath(new URL('../..',import.meta.url))),source=await captureR16SourceProvenanceV1(repo);
 // Never measure an accidentally mixed, actively edited source tree.
 assert.equal(source.tree_status_sha256,'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'r16_listening_capacity_source_must_be_clean');
 const pool=await openR16LocalPostgresV1();
 try{
  const ready=(await pool.query(`SELECT to_regclass('signal_listening_runs') IS NOT NULL
   AND to_regclass('signal_listening_answers') IS NOT NULL
   AND to_regprocedure('signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)') IS NOT NULL ready`)).rows[0]?.ready;
  assert.equal(ready,true,'r16_listening_capacity_migrations_required');
  const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM mentions) roots,
   (SELECT count(*)::int FROM signal_labeling_calls) calls,
   (SELECT count(*)::int FROM signal_listening_configurations) configurations`)).rows[0];
  assert.deepEqual(counts,{roots:0,calls:0,configurations:0},'r16_listening_capacity_empty_owned_lab_required');
 }finally{await pool.end();}
 await mkdir(parent,{recursive:true,mode:0o700});
 const directory=join(parent,'listening-'+new Date().toISOString().replace(/[:.]/gu,'-')+'-'+randomUUID());
 await mkdir(directory,{mode:0o700});
 try{
  const measured=await runR16ListeningBenchmarkV1({arm:'defined_consumer_second_pass',object_directory:join(directory,'objects'),
   redis_url:process.env.R16BENCH_REDIS_URL!,
   writePreregistration:value=>writePrivate(join(directory,'preregistration.json'),value),
   withNativeFixture:createR16ListeningNativeFixtureV1({loadNativeCensus:access=>loadR16ListeningNativeCensusV1(access)}),
  });
  await writePrivate(join(directory,'measurement.json'),measured);
  const capacity_observed=Object.values(measured.capacity_gates).every(value=>value===true);
  await writePrivate(join(directory,'measurement-status.json'),{capacity_observed,
   acceptance:'pending_native_fault_and_census_validation',goal_complete:false});
  return{directory,capacity_observed,acceptance:'pending_native_fault_and_census_validation' as const};
 }catch(error){
  const code=safeCode(error);
  await writePrivate(join(directory,'failure.json'),{code,goal_complete:false});
  throw Object.assign(Error(code),{artifact_directory:directory});
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--output-directory')throw Error('r16_listening_capacity_output_directory_required');
  const result=await runR16ListeningCapacityLocalCommandV1(args[1]!);
  process.stdout.write(JSON.stringify(result)+'\n');if(!result.capacity_observed)process.exitCode=1;
 }catch(error){process.stderr.write(JSON.stringify({error:safeCode(error)})+'\n');process.exitCode=1;}
}
