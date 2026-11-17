import assert from 'node:assert/strict';
import test from 'node:test';
import {ANSWER_JOIN_NATIVE_TITLES_V1,ANSWER_JOIN_PURE_TITLES_V1,parseAnswerJoinNativeTAPV1,parseAnswerJoinPureTAPV1} from './answer-join-native-harness.mjs';

const targetSha='5d5ed883b9e9921900d82bbfcb2f2817a546fd41';
const probeSha='a'.repeat(40);
const pureTap=(titles=ANSWER_JOIN_PURE_TITLES_V1,summary={tests:10,pass:10,fail:0,cancelled:0,skipped:0},plan=10)=>Buffer.from(
 `TAP version 13\n${titles.map((title,i)=>`ok ${i+1} - ${title}`).join('\n')}\n1..${plan}\n${Object.entries(summary).map(([k,v])=>`# ${k} ${v}`).join('\n')}\n`);
const nativeTap=(result,titles=ANSWER_JOIN_NATIVE_TITLES_V1,summary={tests:5,pass:5,fail:0,cancelled:0,skipped:0},plan=5)=>Buffer.from(
 `TAP version 13\n${titles.map((title,i)=>`ok ${i+1} - ${title}`).join('\n')}\n# answer join RESULT ${JSON.stringify(result)}\n1..${plan}\n${Object.entries(summary).map(([k,v])=>`# ${k} ${v}`).join('\n')}\n`);

test('answer join pure parser binds the exact ten test names and git pair',()=>{
 const receipt=parseAnswerJoinPureTAPV1(pureTap(),{exitStatus:0,targetSha,probeSha});
 assert.equal(receipt.contract,'r16-diagnostic-pure-suite-v1');assert.equal(receipt.status,'verified');
 assert.equal(receipt.requested_target_sha,targetSha);assert.equal(receipt.target_git_sha_after,targetSha);
 assert.deepEqual(receipt.titles,[...ANSWER_JOIN_PURE_TITLES_V1]);
});
test('answer join pure parser rejects skipped and TODO cases',()=>{
 for(const suffix of [' # SKIP unavailable',' # TODO later']){
  const titles=[...ANSWER_JOIN_PURE_TITLES_V1];titles[0]+=suffix;
  assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(titles),{exitStatus:0,targetSha,probeSha}),/answer_join_pure_titles_invalid|answer_join_pure_test_not_run/u);
 }
});
test('answer join pure parser rejects extra, missing, reordered, or renamed cases',()=>{
 const changed=[...ANSWER_JOIN_PURE_TITLES_V1];changed[0]='unexpected title';
 assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(changed),{exitStatus:0,targetSha,probeSha}),/answer_join_pure_titles_invalid/u);
 assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(ANSWER_JOIN_PURE_TITLES_V1.slice(1)),{exitStatus:0,targetSha,probeSha}),/answer_join_pure_test_count_invalid/u);
 assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(ANSWER_JOIN_PURE_TITLES_V1,undefined,9),{exitStatus:0,targetSha,probeSha}),/answer_join_pure_plan_invalid/u);
});
test('answer join pure parser rejects nonzero exits and malformed bindings',()=>{
 assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(),{exitStatus:1,targetSha,probeSha}),/answer_join_pure_exit_invalid/u);
 assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(),{exitStatus:0,targetSha:'bad',probeSha}),/answer_join_target_sha_invalid/u);
 assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(),{exitStatus:0,targetSha,probeSha:'bad'}),/answer_join_probe_sha_invalid/u);
});
test('answer join pure parser requires a unique complete TAP summary',()=>{
 assert.throws(()=>parseAnswerJoinPureTAPV1(pureTap(ANSWER_JOIN_PURE_TITLES_V1,{tests:10,pass:9,fail:1,cancelled:0,skipped:0}),{exitStatus:0,targetSha,probeSha}),/answer_join_pure_counts_invalid/u);
 assert.throws(()=>parseAnswerJoinPureTAPV1(Buffer.concat([pureTap(),Buffer.from('# tests 10\n')]),{exitStatus:0,targetSha,probeSha}),/answer_join_tap_summary_invalid/u);
});
test('answer join native parser rejects status, contract, and target drift',()=>{
 const minimal={contract:'wrong',status:'observed',diagnostic_only:true,test_only:true,h1_accepted:false,gain_claim:false,migration_created:false,
  source:targetSha,probe:probeSha,base_source:'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1',failures:[]};
 assert.throws(()=>parseAnswerJoinNativeTAPV1(nativeTap(minimal),{exitStatus:0,targetSha,probeSha}),/answer_join_result_contract_invalid/u);
 assert.throws(()=>parseAnswerJoinNativeTAPV1(nativeTap({...minimal,contract:'r16-answer-guard-join-native-oracle-v1',source:probeSha}),{exitStatus:0,targetSha,probeSha}),/answer_join_result_target_mismatch/u);
});
test('answer join native parser rejects malformed results and wrong exact case list',()=>{
 const minimal={contract:'r16-answer-guard-join-native-oracle-v1',status:'observed',diagnostic_only:true,test_only:true,h1_accepted:false,gain_claim:false,migration_created:false,
  source:targetSha,probe:probeSha,base_source:'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1',failures:[]};
 assert.throws(()=>parseAnswerJoinNativeTAPV1(nativeTap(minimal,[...ANSWER_JOIN_NATIVE_TITLES_V1,'extra']),{exitStatus:0,targetSha,probeSha}),/answer_join_native_test_count_invalid/u);
 assert.throws(()=>parseAnswerJoinNativeTAPV1(Buffer.from(nativeTap(minimal).toString().replace('{"contract"','{broken')), {exitStatus:0,targetSha,probeSha}),/answer_join_result_json_invalid/u);
});
test('answer join native parser reassembles TAP continuation chunks before JSON validation',()=>{
 const prefix='# \\# answer join RESULT ',json=JSON.stringify({contract:'wrong',padding:'x'.repeat(20_000)}),lines=[];
 lines.push(prefix+json.slice(0,8192));
 for(let offset=8192;offset<json.length;offset+=8192)lines.push('# '+json.slice(offset,offset+8192));
 const tap=Buffer.from(`TAP version 13\n${ANSWER_JOIN_NATIVE_TITLES_V1.map((title,i)=>`ok ${i+1} - ${title}`).join('\n')}\n${lines.join('\n')}\n1..5\n# tests 5\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n`);
 assert.throws(()=>parseAnswerJoinNativeTAPV1(tap,{exitStatus:0,targetSha,probeSha}),/answer_join_result_contract_invalid/u);
});
test('answer join native parser rejects skips and unsuccessful summary even with a result',()=>{
 const minimal={contract:'r16-answer-guard-join-native-oracle-v1',status:'observed',diagnostic_only:true,test_only:true,h1_accepted:false,gain_claim:false,migration_created:false,
  source:targetSha,probe:probeSha,base_source:'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1',failures:[]};
 const titles=[...ANSWER_JOIN_NATIVE_TITLES_V1];titles[0]+=' # SKIP not run';
 assert.throws(()=>parseAnswerJoinNativeTAPV1(nativeTap(minimal,titles),{exitStatus:0,targetSha,probeSha}),/answer_join_native_titles_invalid|answer_join_native_test_not_run/u);
 assert.throws(()=>parseAnswerJoinNativeTAPV1(nativeTap(minimal,ANSWER_JOIN_NATIVE_TITLES_V1,{tests:5,pass:4,fail:1,cancelled:0,skipped:0}),{exitStatus:0,targetSha,probeSha}),/answer_join_native_counts_invalid/u);
});
test('answer join native parser requires both source trees to retain requested SHAs',()=>{
 const minimal={contract:'r16-answer-guard-join-native-oracle-v1',status:'observed',diagnostic_only:true,test_only:true,h1_accepted:false,gain_claim:false,migration_created:false,
  source:targetSha,probe:probeSha,base_source:'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1',failures:[]};
 assert.throws(()=>parseAnswerJoinNativeTAPV1(nativeTap(minimal),{exitStatus:0,targetSha,probeSha,targetAfter:'b'.repeat(40)}),/answer_join_target_after_mismatch/u);
 assert.throws(()=>parseAnswerJoinNativeTAPV1(nativeTap(minimal),{exitStatus:0,targetSha,probeSha,probeAfter:'b'.repeat(40)}),/answer_join_probe_after_mismatch/u);
});
test('answer join TAP byte caps are enforced before parsing',()=>{
 assert.throws(()=>parseAnswerJoinPureTAPV1(Buffer.alloc(2_000_001,0x20),{exitStatus:0,targetSha,probeSha}),/answer_join_pure_tap_too_large/u);
});
