import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {
  INPUT_PLAN_GATES_V1,
  INPUT_PLAN_TARGET_SHA_V1,
  runR16ListeningInputPlanProbeV1,
  type InputPlanProbeReceiptV1,
} from './signal-listening-input-plan.synthetic.fixture';

const native=process.env.NOISIA_R16_LISTENING_INPUT_PLAN_PG==='true';
const pure=process.env.NOISIA_R16_LISTENING_INPUT_PLAN_PURE==='true';
assert.ok(!(native&&pure),'native and pure input-plan observer modes must remain separate');

const nativeTitle='native Listening input plan observes the original RR read without replay';

test(nativeTitle,{skip:!native},async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','native input-plan observation is restricted to the isolated CI lab');
  assert.notEqual(process.env.NOISIA_R16_LISTENING_INPUT_PLAN_PURE,'true');
  const directory=process.env.R16_LISTENING_INPUT_PLAN_EVIDENCE_DIR;
  assert.ok(directory,'native input-plan evidence directory is required');

  const receipt:InputPlanProbeReceiptV1=await runR16ListeningInputPlanProbeV1(directory);
  const observerPath=join(directory,'input-plan-observer.json');
  const measurementPath=join(directory,'input-plan-measurement.json');
  const persisted=JSON.parse(await readFile(observerPath,'utf8')) as InputPlanProbeReceiptV1;
  const measurement=JSON.parse(await readFile(measurementPath,'utf8')) as Record<string,unknown>;
  assert.deepEqual(persisted,receipt,'persisted observer receipt must match the returned report');

  assert.equal(receipt.contract,'r16-listening-input-plan-v1');
  assert.equal(receipt.status,'observed');
  assert.equal(receipt.findings,'INCONCLUSIVE','plan observation is descriptive and does not establish query attribution');
  assert.equal(receipt.diagnostic_only,true);
  assert.equal(receipt.h1_accepted,false);
  assert.equal(receipt.cpu,'UNKNOWN');
  assert.equal(receipt.owned_scope,'accredited_ci_lab_database');
  assert.equal(receipt.provider_mode,'unmodified_driver_synthetic_transport');
  assert.equal(receipt.external_provider_spend_micro_usd,0);
  assert.equal(receipt.external_provider_requests,0);
  assert.ok(receipt.evidence_basis.length>0);
  assert.deepEqual(Object.keys(receipt.gates).sort(),[...INPUT_PLAN_GATES_V1].sort());
  for(const gate of INPUT_PLAN_GATES_V1)assert.equal(receipt.gates[gate],true,gate+' must be explicitly observed');

  const observation=receipt.observation;
  assert.ok(observation);
  assert.equal(observation.status,'observed');
  assert.ok(observation.ordinal_seen>=65,'the first eligible observation is ordinal 65 and later matching reads must not retarget it');
  assert.equal(observation.selected_count,1);
  assert.equal(observation.original_executions,1);
  assert.equal(observation.original_succeeded,true);
  assert.equal(observation.query_raw_match,true);
  assert.equal(observation.result_reference_preserved,true);
  assert.equal(observation.bind_count,9);
  assert.ok(Number.isSafeInteger(observation.root_argument_count)&&Number(observation.root_argument_count)>0);
  assert.ok(Number.isSafeInteger(observation.returned_rows)&&Number(observation.returned_rows)>=0);
  assert.equal(observation.rr_read_only,true);
  assert.equal(observation.context_stable,true);
  assert.equal(observation.settings_restored,true);
  assert.equal(observation.rollback_reset_confirmed,false);
  assert.equal(observation.discarded,false);
  assert.equal(observation.loss,false);
  assert.equal(observation.parent_present,true);
  assert.equal(observation.nested_present,true);
  assert.equal(observation.library_loaded,true);
  assert.equal(observation.library_unloaded,false,'auto_explain remains loaded until the observed backend ends');
  assert.ok(observation.notices>=2);
  assert.ok(observation.input_bytes>0&&observation.input_bytes<=64*1024*1024);
  assert.match(String(observation.context?.backend_sha256),/^sha256:[a-f0-9]{64}$/u);
  assert.match(String(observation.context?.role_sha256),/^sha256:[a-f0-9]{64}$/u);
  assert.match(String(observation.context?.database_sha256),/^sha256:[a-f0-9]{64}$/u);
  assert.match(String(observation.context?.search_path_sha256),/^sha256:[a-f0-9]{64}$/u);
  assert.match(String(observation.context?.snapshot_sha256),/^sha256:[a-f0-9]{64}$/u);
  assert.ok(observation.plans.length>=2&&observation.plans.length<=128);
  assert.ok(observation.plans.some(plan=>plan.query_template_sha256===INPUT_PLAN_TARGET_SHA_V1));
  assert.ok(observation.plans.some(plan=>plan.query_template_sha256!==INPUT_PLAN_TARGET_SHA_V1));
  for(const plan of observation.plans){
    assert.equal(plan.variants,'NOT_COLLECTED');
    assert.ok(Number.isSafeInteger(plan.occurrences)&&plan.occurrences>0);
    assert.ok(plan.first.nodes>0&&plan.first.nodes<=512);
    assert.ok(plan.first.bytes>0&&plan.first.bytes<=4*1024*1024);
    assert.match(plan.first.sanitized_sha256,/^sha256:[a-f0-9]{64}$/u);
    assert.equal(plan.first.plan.query_template_sha256,plan.query_template_sha256);
  }
  const observerJson=JSON.stringify(observation);
  assert.doesNotMatch(observerJson,/Query Text|PRIVATE_|\b(?:SELECT|FROM|WHERE)\b/u,'raw SQL, plan expressions and fixture identifiers must not be persisted');

  assert.equal(measurement.contract,'r16-listening-input-plan-measurement-v1');
  assert.equal(measurement.status,'observed');
  assert.equal(measurement.diagnostic_only,true);
  assert.equal(measurement.h1_accepted,false);
  assert.equal(measurement.cpu,'UNKNOWN');
  const measured=measurement.measurement as Record<string,unknown>;
  assert.equal(measured.roots,32768);
  assert.equal(measured.requests,65536);
  assert.equal(measured.unresolved_roots,0);
  assert.equal(measured.source_tree_sha256,receipt.source.before?.source_tree_sha256);
  assert.match(String(measured.original_measurement_sha256),/^sha256:[a-f0-9]{64}$/u);
  const driverGates=measured.unmodified_driver_capacity_gates_not_acceptance as Record<string,unknown>;
  assert.equal(driverGates.native_processing_complete,true,'the original workload must finish, without requiring its speed threshold');
  assert.equal(driverGates.serving,true,'the original listening serving checks must finish');
  assert.equal(driverGates.expected_primary_request_count,true,'the original synthetic request cardinality must remain intact');
  assert.equal(measurement.provider_mode,'unmodified_driver_synthetic_transport');
  assert.equal(measurement.external_provider_spend_micro_usd,0);
  assert.equal(measurement.external_provider_requests,0);
  assert.ok(typeof measurement.evidence_basis==='string'&&measurement.evidence_basis.length>0);

  assert.equal(receipt.source.expected_git?.head_sha,process.env.GITHUB_SHA);
  assert.ok(receipt.source.expected_git?.file_count&&receipt.source.expected_git.file_count>0);
  assert.deepEqual(receipt.source.before,receipt.source.expected_git);
  assert.deepEqual(receipt.source.after,receipt.source.expected_git);
  assert.deepEqual(Object.keys(receipt.closure).sort(),[
    'active_borrowed','admin_closed','callback_complete','callback_entered','database_identity_matched',
    'factory_returned_normally','observed_backends','observed_backends_absent','release_failures',
  ].sort());
  assert.equal(receipt.closure.callback_entered,true);
  assert.equal(receipt.closure.callback_complete,true);
  assert.equal(receipt.closure.factory_returned_normally,true);
  assert.ok(receipt.closure.observed_backends>0);
  assert.equal(receipt.closure.observed_backends_absent,true);
  assert.equal(receipt.closure.admin_closed,true);
  assert.equal(receipt.closure.database_identity_matched,true);
  assert.equal(receipt.closure.active_borrowed,0);
  assert.equal(receipt.closure.release_failures,0);
  assert.ok(!Object.hasOwn(receipt.closure,'own_database_absent'),'the factory uses the accredited CI database, not a clone');
  assert.deepEqual(receipt.storage,{storage_owned:true,storage_closed:true,storage_absent:true});
});
