import assert from 'node:assert/strict';
import test from 'node:test';
import {assertR16ListeningCapacityLocalEnvironmentV1} from './run-listening-capacity-lab';
const env={NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',R16_LISTENING_QUIET_LAB_CONFIRMED:'true',
 NOISIA_SIGNAL_LISTENING_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_JEV_STREAMING_V2_ENABLED:'true',
 DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci',R16BENCH_REDIS_URL:'redis://127.0.0.1:54322'};
test('capacity command only admits an explicit owned quiet loopback lab, never CI or a remote target',()=>{
 assert.doesNotThrow(()=>assertR16ListeningCapacityLocalEnvironmentV1(env));
 for(const change of [{NOISIA_R16_LOCAL_PG_LAB:'r16-durable-pages-pg17'},{GITHUB_ACTIONS:'true'},
  {R16_LISTENING_QUIET_LAB_CONFIRMED:'false'},{NOISIA_JEV_PROVIDER_ENABLED:undefined},
  {DATABASE_URL:'postgresql://postgres:synthetic@db.example.test/noisia_mfp_ci'},
  {DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/other'},
  {R16BENCH_REDIS_URL:'redis://cache.example.test:6379'}])
  assert.throws(()=>assertR16ListeningCapacityLocalEnvironmentV1({...env,...change}));
});

import {assertR16ListeningCiEnvironmentV1} from './run-listening-ci';
test('CI capacity retains a separate owned-loopback boundary and cannot become a local or remote override',()=>{
 const ci={...env,GITHUB_ACTIONS:'true',NOISIA_R16_NATIVE_FIXTURE_PG:'true'};
 assert.doesNotThrow(()=>assertR16ListeningCiEnvironmentV1(ci));
 for(const change of [{GITHUB_ACTIONS:undefined},{NOISIA_R16_LOCAL_PG_LAB:'r16-durable-pages-pg17'},
  {NOISIA_R16_NATIVE_FIXTURE_PG:'false'},{NOISIA_SIGNAL_LISTENING_ENABLED:undefined},
  {DATABASE_URL:'postgresql://postgres:synthetic@db.example.test/noisia_mfp_ci'},
  {R16BENCH_REDIS_URL:'redis://cache.example.test:6379'}])
  assert.throws(()=>assertR16ListeningCiEnvironmentV1({...ci,...change}));
 assert.throws(()=>assertR16ListeningCapacityLocalEnvironmentV1(ci),'CI cannot use the local command');
});
