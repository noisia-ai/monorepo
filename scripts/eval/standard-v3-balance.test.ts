import assert from 'node:assert/strict';
import test from 'node:test';
import {currentStageBalanceV3} from './standard-v3-balance';
test('paid stage requires a current observed balance and preserves funds coordinated for other lanes',()=>{
 const now=Date.parse('2026-10-18T10:00:00Z'),receipt={source:'anthropic_console',available_micro_usd:10_000_000,observed_at:new Date(now).toISOString(),reserved_for_other_lanes_micro_usd:4_000_000};
 assert.equal(currentStageBalanceV3(receipt,5_000_000,now),6_000_000);
 assert.throws(()=>currentStageBalanceV3(receipt,6_000_001,now),/credit_insufficient/);
 for(const value of [{...receipt,source:'historical_estimate'},{...receipt,observed_at:'2026-10-13T10:00:00Z'},{...receipt,observed_at:'invalid'},{...receipt,observed_at:new Date(now+1).toISOString()}])assert.throws(()=>currentStageBalanceV3(value,1,now),/current_balance_required/);
});
