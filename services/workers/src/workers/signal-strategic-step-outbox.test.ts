import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:1/noisia_unit";
process.env.DATABASE_SSL = "false";
process.env.REDIS_URL ??= "redis://localhost:1";

const {
  buildSignalStrategicStepJobId,
  drainSignalStrategicStepOutbox,
  signalStrategicStepBackoffSeconds
} = await import("./signal-strategic-step-outbox");
const {
  conservativeInputTokenCount,
  executeGovernedProviderBoundaryV1,
  signalTbMaxInputTokensPerCall,
  signalTbPlannedOperationMaxOutputTokens
} = await import("./tb-strategic-runtime-contract");

const claim = {
  outbox_id: "00000000-0000-4000-8000-000000000041",
  pipeline_step_id: "00000000-0000-4000-8000-000000000042",
  tb_analysis_id: "00000000-0000-4000-8000-000000000043",
  pipeline_step: "step1_open_pass",
  lease_token: "00000000-0000-4000-8000-000000000044",
  bullmq_job_id: buildSignalStrategicStepJobId(
    "sha256:1111111111111111111111111111111111111111111111111111111111111111"
  ),
  dispatch_attempt: 1
};

test("strategic step job identity and bounded backoff are deterministic", () => {
  assert.equal(
    buildSignalStrategicStepJobId(
      "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    ),
    "strategic-step-1111111111111111111111111111111111111111111111111111111111111111"
  );
  assert.equal(signalStrategicStepBackoffSeconds(1), 5);
  assert.equal(signalStrategicStepBackoffSeconds(99), 900);
});

test("provider reservation token estimate is a UTF-8 byte upper bound", () => {
  for (const prompt of [
    "a".repeat(10_000),
    "\u0000\u0001\u0002\n\t".repeat(500),
    "¿Qué cambió? 🐕‍🦺 中文 العربية".repeat(200)
  ]) {
    const bytes = Buffer.byteLength(prompt, "utf8");
    assert.equal(conservativeInputTokenCount(prompt), Math.max(1, bytes));
    // No text tokenizer can emit more non-empty byte-backed units than bytes.
    assert.ok(conservativeInputTokenCount(prompt) >= prompt.length);
  }
  assert.equal(conservativeInputTokenCount(""), 1);
  assert.equal(signalTbMaxInputTokensPerCall({
    NOISIA_SIGNAL_TB_MAX_INPUT_TOKENS_PER_CALL: "120000"
  }), 120_000);
  assert.throws(
    () => signalTbMaxInputTokensPerCall({}),
    /governed_strategic_input_token_bound_missing/u
  );
  assert.equal(signalTbPlannedOperationMaxOutputTokens("preflight", 31), 8_000);
  assert.equal(signalTbPlannedOperationMaxOutputTokens("step1-open-pass-2", 31), 4_000);
  assert.equal(signalTbPlannedOperationMaxOutputTokens("step6-humanizer", 31), 26_000);
  assert.throws(
    () => signalTbPlannedOperationMaxOutputTokens("step1-open-pass-3", 31),
    /governed_strategic_provider_operation_not_planned/u
  );
  assert.throws(
    () => signalTbPlannedOperationMaxOutputTokens("invented-step", 31),
    /governed_strategic_provider_operation_not_planned/u
  );
  assert.throws(
    () => signalTbMaxInputTokensPerCall({
      NOISIA_SIGNAL_TB_MAX_INPUT_TOKENS_PER_CALL: "0"
    }),
    /governed_strategic_input_token_bound_missing/u
  );
});

test("provider boundary releases only before dispatch and settles exact usage", async () => {
  const reservation = {
    reservationId: "reservation",
    runControlId: "control",
    idempotencyKey: `sha256:${"2".repeat(64)}`,
    estimatedInputTokens: 100,
    maxOutputTokens: 80
  };
  let invoked = 0;
  let released = 0;
  let settled = 0;
  await assert.rejects(
    executeGovernedProviderBoundaryV1({
      reservation,
      maxOutputTokens: 10,
      assertAuthority: async () => { throw new Error("authority_expired"); },
      releaseBeforeDispatch: async () => { released += 1; },
      invoke: async () => { invoked += 1; return { usage: {} }; },
      settle: async () => { settled += 1; }
    }),
    /authority_expired/u
  );
  assert.deepEqual({ invoked, released, settled }, { invoked: 0, released: 1, settled: 0 });

  released = 0;
  await assert.rejects(
    executeGovernedProviderBoundaryV1({
      reservation,
      maxOutputTokens: 10,
      assertAuthority: async () => undefined,
      releaseBeforeDispatch: async () => { released += 1; },
      invoke: async () => { invoked += 1; throw new Error("provider_disconnect"); },
      settle: async () => { settled += 1; }
    }),
    /provider_disconnect/u
  );
  assert.equal(released, 0);
  assert.equal(settled, 0);

  const result = await executeGovernedProviderBoundaryV1({
    reservation,
    maxOutputTokens: 10,
    assertAuthority: async () => undefined,
    releaseBeforeDispatch: async () => { released += 1; },
    invoke: async (maxOutputTokens) => {
      assert.equal(maxOutputTokens, 80);
      invoked += 1;
      return { usage: { inputTokens: 41, outputTokens: 17 } };
    },
    settle: async (_value, response) => {
      assert.deepEqual(response.usage, { inputTokens: 41, outputTokens: 17 });
      settled += 1;
    }
  });
  assert.deepEqual(result.usage, { inputTokens: 41, outputTokens: 17 });
  assert.equal(settled, 1);
});

test("drainer dispatches a claimed step once and acknowledges the lease", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("claim_signal_strategic_step_dispatch_v1")) return { rows: [claim] };
      if (sql.includes("complete_signal_strategic_step_dispatch_v1")) {
        return { rows: [{ completed: true }] };
      }
      throw new Error("unexpected query");
    }
  };
  const added: unknown[] = [];
  const queue = {
    getJob: async () => null,
    add: async (...args: unknown[]) => {
      added.push(args);
      return { id: claim.bullmq_job_id };
    }
  };
  const result = await drainSignalStrategicStepOutbox({
    database: database as never,
    queue: queue as never,
    leaseSeconds: 60,
    maxAttempts: 5,
    batchSize: 10
  });
  assert.deepEqual(result, {
    claimed: 1,
    dispatched: 1,
    reconciled: 0,
    failed: 0,
    dead_lettered: 0,
    lease_lost: 0
  });
  assert.equal(added.length, 1);
  assert.equal((added[0] as unknown[])[0], "tb_step_1_open_pass");
  assert.deepEqual((added[0] as unknown[])[1], {
    tbAnalysisId: claim.tb_analysis_id,
    pipelineStepId: claim.pipeline_step_id
  });
  assert.equal(((added[0] as unknown[])[2] as { jobId: string }).jobId, claim.bullmq_job_id);
  assert.match(calls.at(-1)?.sql ?? "", /complete_signal_strategic_step_dispatch_v1/u);
  assert.deepEqual(calls.at(-1)?.values, [claim.outbox_id, claim.lease_token, claim.bullmq_job_id]);
});

test("orphaned dispatch reconciles an already accepted BullMQ job without duplicate add", async () => {
  let adds = 0;
  const database = {
    query: async (sql: string) => sql.includes("claim_signal_strategic_step_dispatch_v1")
      ? { rows: [claim] }
      : { rows: [{ completed: true }] }
  };
  const result = await drainSignalStrategicStepOutbox({
    database: database as never,
    queue: {
      getJob: async () => ({ id: claim.bullmq_job_id }),
      add: async () => {
        adds += 1;
        return { id: claim.bullmq_job_id };
      }
    } as never,
    runImmediately: false
  });
  assert.equal(result.reconciled, 1);
  assert.equal(adds, 0);
});

test("queue failure is durably retried and terminal attempts dead-letter", async () => {
  for (const terminal of [false, true]) {
    const attempts = terminal ? 5 : 2;
    const statuses: string[] = [];
    const database = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.includes("claim_signal_strategic_step_dispatch_v1")) {
          return { rows: [{ ...claim, dispatch_attempt: attempts }] };
        }
        if (sql.includes("fail_signal_strategic_step_dispatch_v1")) {
          statuses.push(String((values ?? [])[3]));
          return { rows: [{ status: terminal ? "dead_letter" : "failed" }] };
        }
        throw new Error("unexpected query");
      }
    };
    const result = await drainSignalStrategicStepOutbox({
      database: database as never,
      queue: {
        getJob: async () => null,
        add: async () => {
          throw Object.assign(new Error("redis://secret@host failure"), { code: "ECONNRESET" });
        }
      } as never,
      maxAttempts: 5
    });
    assert.equal(terminal ? result.dead_lettered : result.failed, 1);
    assert.equal(statuses.length, 1);
    assert.doesNotMatch(statuses[0] ?? "", /redis:\/\//u);
    assert.match(statuses[0] ?? "", /\[redacted-url\]/u);
  }
});

test("runtime source registers drainer, heartbeat, lease CAS and provider settlement", async () => {
  const [entrypoint, queueSource, shared, preflight, comparative, corpusSql,
    coding, hierarchy, mobility, synthesis, qualityGates] = await Promise.all([
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    readFile(new URL("../queues/tb-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-shared.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-step-preflight.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-step-5-comparative.ts", import.meta.url), "utf8"),
    readFile(new URL("./corpus-sql.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-step-2-coding.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-step-3-hierarchy.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-step-4-mobility.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-step-6-synthesis.ts", import.meta.url), "utf8"),
    readFile(new URL("./tb-quality-gates.ts", import.meta.url), "utf8")
  ]);
  assert.match(entrypoint, /startSignalStrategicStepOutboxDrainer\(\)/u);
  assert.match(entrypoint, /await strategicStepOutboxDrainer\.close\(\)/u);
  assert.match(queueSource, /noisia:worker-alive:\$\{tbAnalysisQueueName\}/u);
  assert.match(queueSource, /resolveTbAnalysisQueueName\(\)/u);
  assert.match(queueSource, /TB_ANALYSIS_HEARTBEAT_TTL_SECONDS = 45/u);
  assert.match(shared, /governed_strategic_run_control_missing/u);
  assert.match(shared, /claim_signal_strategic_step_v1/u);
  assert.match(shared, /heartbeat_signal_strategic_step_v1/u);
  assert.match(shared, /assert_signal_strategic_runtime_authority_v1/u);
  assert.match(shared, /settle_signal_strategic_budget_v1/u);
  assert.match(shared, /reserve_signal_strategic_budget_tokens_v1/u);
  assert.match(shared, /persisted\.created !== true/u);
  assert.match(shared, /governed_strategic_input_token_bound_exceeded/u);
  assert.match(shared, /release_signal_strategic_budget_v1/u);
  assert.match(shared, /result\.usage/u);
  assert.match(preflight, /signal_strategic_sealed_sample_items/u);
  assert.match(comparative, /semantic\.attribution_basis='mention_semantic'/u);
  assert.doesNotMatch(comparative.match(/if \(await isGovernedStrategicRun[\s\S]*?return governed\.rows;/u)?.[0] ?? "", /import_batches/u);
  assert.match(corpusSql, /signal_strategic_sealed_sample_items/u);
  assert.match(corpusSql, /assertion\.attribution_basis='mention_semantic'/u);
  for (const source of [preflight, coding, hierarchy, mobility]) {
    assert.doesNotMatch(source, /response first|\.text\.slice\(0,\s*\d+\)/u);
  }
  assert.doesNotMatch(synthesis, /before="\$\{|after="\$\{/u);
  assert.match(
    synthesis,
    /if \(!await isGovernedStrategicRun\(tbAnalysisId\)\) \{\s*await enqueueSelectedEngineLensesAfterStep6Failure/u
  );
  assert.match(
    qualityGates,
    /governedStrategic\s*\? \{ status: "not_launched", reason: "governed_strategic_requires_explicit_engine_launch" \}/u
  );
});
