import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertR16ListeningSyntheticPreflightV1} from './listening-preflight';
import {r16ListeningWorkloadV1,R16_LISTENING_PREREGISTRATION_V1 as registration} from './listening-workload';
import {startR16HttpFilesystemStorageV1} from './http-filesystem-storage';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
const env={NOISIA_SIGNAL_LISTENING_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_JEV_STREAMING_V2_ENABLED:'true'};
test('local preflight performs the production private bucket HTTP check; simulator quotas cannot alter real ones',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r16-listening-preflight-')),server=await startR16HttpFilesystemStorageV1(directory);
 try{
  let http=0;const storage=createWorkspaceEngineStorageV1({url:server.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files',fetch:async(...args)=>{http++;return fetch(...args);}});
  const workload=r16ListeningWorkloadV1('defined_consumer_second_pass');
  await assertR16ListeningSyntheticPreflightV1({storage,storage_url:server.base_url,...workload,env});assert.equal(http,1);
  assert.equal(registration.simulator_quotas.requests_per_second,10000);assert.equal(registration.simulator_quotas.input_tokens_per_second,10000000);
  assert.equal(registration.simulator_quotas.real_provider_quotas_modified,false);assert.equal(registration.expected_primary_http_calls_per_resolved_root,2);
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
test('missing flags, configuration drift, remote Storage or readiness failure block preflight',async()=>{
 const workload=r16ListeningWorkloadV1('defined_consumer_second_pass');let calls=0;
 const storage:WorkspaceEngineStorageV1={assertReady:async()=>{calls++;throw Error('private bucket unavailable');},put:async()=>{throw Error('unexpected put');},get:async()=>{throw Error('unexpected get');}};
 const args={...workload,storage,storage_url:'http://127.0.0.1:1',env};
 for(const key of Object.keys(env))await assert.rejects(assertR16ListeningSyntheticPreflightV1({...args,env:{...env,[key]:'false'}}),/explicit_flags/);
 await assert.rejects(assertR16ListeningSyntheticPreflightV1({...args,configuration_digest:'sha256:'+'0'.repeat(64)}),/frozen_configuration/);
 await assert.rejects(assertR16ListeningSyntheticPreflightV1({...args,storage_url:'https://storage.example.test'}),/storage_not_local/);assert.equal(calls,0);
 await assert.rejects(assertR16ListeningSyntheticPreflightV1(args),/private bucket unavailable/);assert.equal(calls,1);
 await assert.rejects(assertR16ListeningSyntheticPreflightV1({...args,storage:{}as WorkspaceEngineStorageV1}),/preflight_missing/);
});
