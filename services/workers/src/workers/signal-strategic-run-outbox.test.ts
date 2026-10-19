import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Workers owns strategic run outbox startup, periodic drain and graceful shutdown", async () => {
  const [drainer, entrypoint, studio] = await Promise.all([
    readFile(new URL("./signal-strategic-run-outbox.ts", import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../../../apps/studio/src/lib/data-os/signal-strategic-consumption.ts", import.meta.url),
      "utf8"
    )
  ]);
  assert.match(drainer, /FOR UPDATE SKIP LOCKED/u);
  assert.match(drainer, /status IN \('pending', 'failed'\)/u);
  assert.match(drainer, /status = 'dispatching'/u);
  assert.match(drainer, /candidates\.previous_status = 'dispatching'/u);
  assert.match(drainer, /previous_attempt >= args\.maxAttempts/u);
  assert.match(drainer, /lease_expires_at/u);
  assert.match(drainer, /attempt >= \$1::integer/u);
  assert.match(drainer, /status = 'dead_letter'/u);
  assert.match(drainer, /signal-tb-\$\{tbAnalysisId\}/u);
  assert.match(drainer, /await args\.queue\.getJob\(jobId\)/u);
  assert.match(drainer, /removeOnComplete: \{ age: 60 \* 60 \* 24 \* 14, count: 2_000 \}/u);
  assert.match(drainer, /removeOnFail: \{ age: 60 \* 60 \* 24 \* 30, count: 2_000 \}/u);
  assert.match(drainer, /setInterval/u);
  assert.match(entrypoint, /startSignalStrategicRunOutboxDrainer\(\)/u);
  assert.match(entrypoint, /await strategicRunOutboxDrainer\.close\(\)/u);
  assert.match(entrypoint, /await closeTbAnalysisProducer\(\)/u);
  assert.doesNotMatch(studio, /getTbAnalysisQueue|queue\.add\(/u);
  assert.match(studio, /launch_signal_tb_strategic_run_v2\(/u);
  assert.doesNotMatch(studio, /INSERT INTO signal_strategic_run_outbox/u);
});
