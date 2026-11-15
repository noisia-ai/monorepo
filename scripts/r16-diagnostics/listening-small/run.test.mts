import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertListeningSmallGuardV1,captureCalibrationObservationV1,runListeningSmallDiagnosticV1} from './run.mjs';

test('diagnostic CLI has no database side effect without explicit run flag',async()=>{
  assert.doesNotThrow(()=>assertListeningSmallGuardV1({},[]));
  assert.deepEqual(await runListeningSmallDiagnosticV1(),{
    diagnostic_only:true,h1_accepted:false,status:'no_database_action',
  });
});

test('diagnostic run requires real GitHub Actions and explicit opt-in',()=>{
  assert.throws(()=>assertListeningSmallGuardV1({},['--run']),/diagnostic_requires_github_actions/u);
  assert.throws(()=>assertListeningSmallGuardV1({GITHUB_ACTIONS:'true'},['--run']),/diagnostic_opt_in_required/u);
});

test('diagnostic run rejects provider credentials before any target access',()=>{
  const env:NodeJS.ProcessEnv={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',TYPESAFE_API_KEY:'unexpected'};
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/provider_credentials_forbidden/u);
  delete env.TYPESAFE_API_KEY;
  env.NOISIA_R16_SONNET_API_KEY='unexpected';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/provider_credentials_forbidden/u);
});

test('diagnostic run binds target and artifact to this workflow workspace',()=>{
  const env={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',GITHUB_WORKSPACE:'/tmp/work',
    R16_DIAGNOSTIC_TARGET_ROOT:'/tmp/work/target',R16_DIAGNOSTIC_PROBE_ROOT:'/tmp/work/probe',
    R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'a'.repeat(40),R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'b'.repeat(40),
    R16_DIAGNOSTIC_ARTIFACT:'/tmp/work/evil/result.json',
    DATABASE_URL:'postgresql://postgres:pw@127.0.0.1:5432/noisia_mfp_ci',
    R16BENCH_REDIS_URL:'redis://127.0.0.1:6379'};
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/artifact_path_not_bound/u);
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/target';
  env.R16_DIAGNOSTIC_ARTIFACT='/tmp/work/artifacts/r16-listening-small/result.json';
  assert.doesNotThrow(()=>assertListeningSmallGuardV1(env,['--run']));
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/elsewhere';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/target_root_outside_workspace/u);
});

test('calibration observations preserve native phase shapes from the query-engine contract',async()=>{
  const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;
  assert.ok(target,'pure test needs the checked out public target root');
  const [contracts,calibration]=await Promise.all([
    import(pathToFileURL(join(target,'packages/query-engine/src/signal-listening-contracts.ts')).href),
    import(pathToFileURL(join(target,'packages/query-engine/src/signal-listening-calibration.ts')).href),
  ]) as any;
  const configuration=contracts.signalListeningBaseTemplateV1({category:'synthetic fixture category',lexicon_terms:['synthetic']});
  configuration.questions.push({key:'consumer_test_v1',type:'noul',text:'Synthetic consumer classification',
    scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined',
    positive:'Synthetic consumer topic applies',negative:'Synthetic consumer topic does not apply'});
  const baseKeys=configuration.questions.filter(question=>question.origin==='base').map(question=>question.key);
  const consumerKeys=configuration.questions.filter(question=>question.scope==='consumer_category').map(question=>question.key);
  const base=calibration.signalListeningCalibrationShapeV1(configuration,{question_keys:baseKeys});
  const consumer=calibration.signalListeningCalibrationShapeV1(configuration,{question_keys:consumerKeys});
  assert.equal(base.phase,'base');
  assert.equal(consumer.phase,'consumer_category');
  const shapeDigests=[base.shape_digest,consumer.shape_digest];
  const captured=captureCalibrationObservationV1({warmup:true,selected_roots:32,max_in_flight:32,shape_digests:shapeDigests});
  shapeDigests.pop();
  assert.deepEqual(captured.shape_digests,[base.shape_digest,consumer.shape_digest]);
});
