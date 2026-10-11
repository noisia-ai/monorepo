import assert from 'node:assert/strict';
import test from 'node:test';
import type { SignalTopicEditorialScreeningPlanV2 } from '@noisia/query-engine';
import { estimateTopicEditorialMicroUsd } from './topic-editorial-estimate';
const plan = (text: string, count=1) => ({expected_group_count:count,requests:Array.from({length:count},()=>({
  provider_request:{params:{messages:[{content:text}]}},configuration:{max_output_tokens:8192,
    input_micro_usd_per_million_tokens:1500000,output_micro_usd_per_million_tokens:7500000}}))} as unknown as SignalTopicEditorialScreeningPlanV2);

test('forecast includes global paid stages and grows with groups and full evidence', () => {
  const one = Number(estimateTopicEditorialMicroUsd(plan('evidence')));
  assert.ok(one > 2048 * 7.5, 'screening alone cannot represent the whole editorial cost');
  assert.ok(Number(estimateTopicEditorialMicroUsd(plan('evidence'.repeat(10000)))) > one);
  assert.ok(Number(estimateTopicEditorialMicroUsd(plan('evidence',13))) > one);
  const capped = {...plan('evidence'),hard_cap_micro_usd:'30000000'};
  assert.equal(estimateTopicEditorialMicroUsd(capped),String(one), 'a policy cap must never become the cost estimate');
});
