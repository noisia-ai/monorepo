import assert from 'node:assert/strict';
import test from 'node:test';
import {serializeStandardV2ReportV1} from './standard-v2-artifacts';
test('final report JSON includes the global call delta, including zero, without mutating its input',()=>{
 const report={contract_version:'comparison',raw_audit:{serving_writes:0,provider_calls:0}};
 for(const delta of [0,3]){const written=JSON.parse(serializeStandardV2ReportV1(report,delta));assert.equal(written.raw_audit.global_non_experiment_call_delta,delta);assert.equal(written.raw_audit.serving_writes,0);}
 assert.deepEqual(report.raw_audit,{serving_writes:0,provider_calls:0});
 assert.throws(()=>serializeStandardV2ReportV1(report,NaN),/global_call_delta/);
});
