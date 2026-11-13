import assert from 'node:assert/strict';
import test from 'node:test';
import {requireMonitoringInsightManagerV1,monitoringInsightBodyV1,monitoringInsightContextV1,monitoringInsightErrorV1} from './workspace-monitoring-insights';
import {MonitoringInsightsError} from '@noisia/db';
test('native insights accept only the bound segment/locale and fixed explicit budget',()=>{
 assert.doesNotThrow(()=>requireMonitoringInsightManagerV1('noisia_admin'));
 assert.throws(()=>requireMonitoringInsightManagerV1('client_admin'));
 assert.deepEqual(monitoringInsightContextV1(new Request('https://studio.invalid/insights')),{conversation_segment:'conversation',locale:'es-MX'});
 assert.deepEqual(monitoringInsightContextV1(new Request('https://studio.invalid/insights?conversation_segment=all&locale=en-US')),{conversation_segment:'all',locale:'en-US'});
 for(const query of ['date_from=2026-01-01','conversation_segment=conversation&conversation_segment=all','locale=pt-BR'])
  assert.throws(()=>monitoringInsightContextV1(new Request('https://studio.invalid/insights?'+query)));
 const body={quote_digest:'sha256:'+'a'.repeat(64),budget_cap_micro_usd:2000000};
 assert.equal(monitoringInsightBodyV1(body),true);
 for(const invalid of [{...body,budget_cap_micro_usd:2000001},{...body,packet:{}},{...body,scope:'other'}])assert.equal(monitoringInsightBodyV1(invalid),false);
});
test('only definitive domain rejections return 4xx; unknown commits stay opaque 503',async()=>{
 const rejected=monitoringInsightErrorV1(new MonitoringInsightsError('monitoring_insights_quote_changed'));
 assert.equal(rejected.status,409);assert.equal(rejected.headers.get('Cache-Control'),'private, no-store');
 const uncertain=monitoringInsightErrorV1(new Error('COMMIT lost: private database detail'));
 assert.equal(uncertain.status,503);
 assert.deepEqual(await uncertain.json(),{error:'monitoring_insights_temporarily_unavailable'});
});
