import assert from 'node:assert/strict';
import test from 'node:test';
import {assertSignalListeningStudyPolicyBudgetV1,quoteSignalListeningStudyPolicyV1} from '../signal-listening-study-policy';
const allocation={budget_micro_usd:15000000,discovery_cap_micro_usd:9000000,study_cap_micro_usd:5000000,prototype_cap_micro_usd:1000000};
test('visible R16 allocation conserves exact integer money and never authorizes an oversubscribed provider pair',()=>{
 assertSignalListeningStudyPolicyBudgetV1(allocation);
 assertSignalListeningStudyPolicyBudgetV1({...allocation,prototype_cap_micro_usd:null});
 for(const key of Object.keys(allocation) as Array<keyof typeof allocation>)for(const value of [0,-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>assertSignalListeningStudyPolicyBudgetV1({...allocation,[key]:value}),/r16_policy_budget_invalid/);
 assert.throws(()=>assertSignalListeningStudyPolicyBudgetV1({...allocation,study_cap_micro_usd:6000000}),/r16_policy_budget_invalid/);
 assert.throws(()=>assertSignalListeningStudyPolicyBudgetV1({...allocation,budget_micro_usd:Number.MAX_SAFE_INTEGER,discovery_cap_micro_usd:Number.MAX_SAFE_INTEGER}),/r16_policy_budget_invalid/);
});
test('invalid visible allocation fails before connecting or changing operator authority',async()=>{
 let connects=0;
 const database={connect:async()=>{connects++;throw Error('unexpected connection');}};
 await assert.rejects(quoteSignalListeningStudyPolicyV1({database,...allocation,budget_micro_usd:1,workspace_id:'00000000-0000-4000-8000-000000000001',actor_user_id:'00000000-0000-4000-8000-000000000002',expected_policy_id:'00000000-0000-4000-8000-000000000003',expected_policy_digest:'sha256:'+'a'.repeat(64),valid_until:'2026-12-01T00:00:00Z'}),/r16_policy_budget_invalid/);
 assert.equal(connects,0);
});
