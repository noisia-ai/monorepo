import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalLabelingStoreV1, type LabelingRunV1 } from './signal-labeling-runs';

test('create failure metadata persists without body/secrets while unknown and DNC remain distinct', async () => {
  const queries: Array<{sql:string;values:unknown[]}> = [];
  const store = createSignalLabelingStoreV1({
    database: { query: async (sql:string,values:unknown[]) => { queries.push({sql,values}); return {rows:[]}; } } as never,
    storeRaw: async () => { throw new Error('must not persist private error body'); },
  });
  const error = Object.assign(new Error('sk-secret private source'), {
    name: 'AnthropicBatchTransportError', code: 'batch_http_400', httpStatus:400,
    submission:'not_submitted', raw_body:'private provider body', provider_request_id:'private-id',
  });
  const run = {id:'run'} as LabelingRunV1;
  await store.markFailed(run, [{id:'call'}] as never, false, error);
  assert.equal(queries[0]?.values[2], 'failed');
  assert.deepEqual(JSON.parse(String(queries[0]?.values[3])), {
    contract_version:'labeling-create-failure-v1', error_class:'AnthropicBatchTransportError',
    code:'batch_http_400', http_status:400, submission:'not_submitted',
  });
  assert.match(queries[0]!.sql,/stop_reason/);
  assert.doesNotMatch(JSON.stringify(queries[0]!.values),/sk-secret|private/);
  await store.markFailed(run, [{id:'unknown'}] as never, true, Object.assign(error, {code:'batch_transport_or_response_invalid',httpStatus:undefined,submission:'submission_unknown'}));
  assert.equal(queries[1]?.values[2], 'unknown');
  assert.equal(JSON.parse(String(queries[1]?.values[3])).http_status,null);
  await store.markFailed(run, [{id:'unsafe'}] as never, true, Object.assign(error,{code:'batch_http_400 sk-secret',httpStatus:999}));
  assert.equal(JSON.parse(String(queries[2]?.values[3])).code,'unclassified_create_failure');
  assert.equal(JSON.parse(String(queries[2]?.values[3])).http_status,null);
  await store.markFailed(run, [{id:'legacy'}] as never, true);
  assert.equal(queries[3]?.values[3],null);
});
