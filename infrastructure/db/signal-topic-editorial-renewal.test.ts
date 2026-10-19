import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { quoteSignalTopicEditorialRenewalV1, renewSignalTopicEditorialExecutionV1 } from './signal-topic-editorial-renewal';

const database = { connect: async () => { throw new Error('database_reached'); } } as unknown as Pool;
const scope = {
  database,
  workspace_id: '979b8f96-3366-463d-8ee8-8c0cce460a71',
  actor_user_id: '10000000-0000-4000-8000-000000000001',
  execution_id: 'b82e0335-5e7b-42c0-af0e-a2e8c3cefba8',
};

test('editorial renewal accepts real UUID-shaped scope before opening the database', async () => {
  await assert.rejects(quoteSignalTopicEditorialRenewalV1(scope), /database_reached/u);
  await assert.rejects(renewSignalTopicEditorialExecutionV1({
    ...scope,
    idempotency_key: 'renewal-test-001',
    quote_reference: `v1.1234567890.${'a'.repeat(64)}`,
    confirmed_cap_micro_usd: '1000000',
  }), /database_reached/u);
});

test('editorial renewal rejects malformed scope before opening the database', async () => {
  await assert.rejects(quoteSignalTopicEditorialRenewalV1({ ...scope, execution_id: 'bad' }),
    /topic_editorial_renewal_invalid/u);
});
