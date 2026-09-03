import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { drainSignalTopicEvaluationV2ExecutionOutbox,
  startSignalTopicEvaluationV2ExecutionOutboxDrainer } from "./signal-topic-evaluation-v2-outbox";

test("V2 execution outbox is inert unless the explicit UAT flag is enabled", async () => {
  const mustNotTouchDatabase = { connect: async () => { throw new Error("database must remain untouched"); },
    query: async () => { throw new Error("database must remain untouched"); } };
  assert.deepEqual(await drainSignalTopicEvaluationV2ExecutionOutbox({ database: mustNotTouchDatabase,
    enabled: false }), { claimed: 0, dispatched: 0 });
  const drainer = startSignalTopicEvaluationV2ExecutionOutboxDrainer({ database: mustNotTouchDatabase,
    enabled: false });
  assert.deepEqual(await drainer.drainNow(), { claimed: 0, dispatched: 0 });
  await drainer.close();
});

test("V2 Worker is the only composition root that advances a durable dispatch intent", async () => {
  const [outbox, entrypoint, executionAuthority] = await Promise.all([
    readFile(new URL("./signal-topic-evaluation-v2-outbox.ts", import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../infrastructure/db/signal-topic-evaluation-v2.ts", import.meta.url), "utf8")
  ]);
  assert.match(outbox, /claimNextSignalTopicEvaluationV2ExecutionOutbox/u);
  assert.match(outbox, /NOISIA_TOPIC_EVALUATION_V2_EXECUTION_ENABLED/u);
  assert.match(outbox, /processSignalTopicEvaluationV2ProviderRun/u);
  assert.match(entrypoint, /startSignalTopicEvaluationV2ExecutionOutboxDrainer\(\)/u);
  assert.match(entrypoint, /await topicEvaluationV2OutboxDrainer\.close\(\)/u);
  assert.match(executionAuthority, /claimSignalTopicEvaluationV2ExecutionAuthorityWithClient/u);
  assert.match(executionAuthority, /topic_evaluation_v2_run_not_executable/u);
});

test("background V2 drain reports failures instead of creating an unhandled rejection", async () => {
  const errors: unknown[] = [];
  const drainer = startSignalTopicEvaluationV2ExecutionOutboxDrainer({ enabled: true,
    database: { connect: async () => { throw new Error("local dispatch unavailable"); } } as never,
    run_immediately: true,on_error: (error) => { errors.push(error); } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await drainer.close();
  assert.equal(errors.length,1);
  assert.match(String((errors[0] as Error).message),/local dispatch unavailable/u);
});
