import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createWorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import assert from "node:assert/strict";
import test from "node:test";
import {
  massLabelingJevIdentityV1,
  massLabelingJevIdentityV2,
  entityContextDigestV1,
  labelerDigestV1,
  type MassLabelingInputV1,
  type MassLabelingResultV1,
} from "@noisia/query-engine";
import type { LabelingRunV1, LabelingCallV1 } from "@noisia/db";
import { processMassLabelingJevV1, signalMassLabelingJevJobV1, MASS_LABELING_JEV_PENDING_RUNS_SQL_V1 } from "./signal-mass-labeling-jev";
import { createTypesafeJevClientV1, type JevProviderV1, type JevRequestV1 } from "../providers/typesafe-jev";

type Store = Parameters<typeof processMassLabelingJevV1>[0]["store"];
function fixture(count: number, product = false) {
  const context = {
    entities: [
      {
        entity_id: "category",
        kind: "category" as const,
        name: "cerveja",
        aliases: [],
        disambiguation: null,
      },
    ],
  };
  const identity = product ? massLabelingJevIdentityV2({ category: "tea", candidate_language: "original",
    interests: [{ key: "travel", name: "Travel", definition: "Travel and tourism" }] }) : massLabelingJevIdentityV1();
  const run: LabelingRunV1 = {
    id: "run",
    workspace_id: "workspace",
    actor_user_id: "actor",
    kind: "mass_labeling",
    identity,
    labeler_digest: labelerDigestV1(identity),
    entity_context_digest: entityContextDigestV1(context),
    entity_context_version_no: 1,
    context,
    lease_token: "lease",
    cursor_root_id: null,
    cap_micro_usd: "1000000",
    processing_admission_id: "admission",
    status: "running",
    error_code: null,
  };
  const calls: LabelingCallV1<MassLabelingInputV1>[] = [],
    results: MassLabelingResultV1[] = [],
    events: string[] = [];
  let selected = false;
  const store: Store = {
    async claim() {
      return run.status === "completed" ? null : run;
    },
    async release() {},
    async renew() {},
    async fail(_run,code) {
      run.status = "failed";run.error_code=code;
    },
    async refresh() {
      return { status: run.status, error_code: run.error_code ?? null };
    },
    async calls() {
      return calls.filter((call) => !call.results_applied);
    },
    async inputs() {
      if (selected) return [];
      selected = true;
      return Array.from({ length: count }, (_, index) => ({
        root_id: `root-${index}`,
        input_digest: `input-${index}`,
        text: `Conversa sobre cerveja ${index}`,
        title: null,
        platform: null,
        content_type: null,
        author: null,
        published_at: "2026-01-01T00:00:00Z",
        language: "pt",
        map_id: "map",
        map_digest: "digest",
        chunk_index: 1,
        candidates: [
          {
            topic_key: "consumo",
            name: "Consumo",
            definition: "Motivos de consumo",
            similarity: 0.9,
          },
        ],
      }));
    },
    async reserve(_run, proposals) {
      const page = proposals.map((proposal, index) => ({
        ...proposal,
        id: `call-${index}`,
        status: "reserved" as const,
        raw_body: null,
        results_applied: false,
        provider_batch_id: null,
        retry_depth: 0,
      }));
      calls.push(...page);
      return page;
    },
    async markSubmitting(_run, page) {
      page.forEach((call) => {
        call.status = "submitting";
      });
    },
    async requeueUnsent(_run, page) {
      for(const call of page){assert.equal(call.raw_body,null);assert.equal(call.results_applied,false);call.status='reserved';}
    },
    async markSubmitted() {},
    async recoverUnknownBatch() {},
    async releaseUnknown() {},
    async clearUnknownFailure() {},
    async markFailed(_run, page, unknown) {
      page.forEach((call) => {
        if (["reserved", "submitting", "submitted"].includes(call.status)) call.status = unknown ? "unknown" : "failed";
      });
    },
    async persistRaw(_run, call, raw) {
      events.push(`raw:${call.id}`);
      call.raw_body = raw;
    },
    async persistRawPage() {
      throw new Error("mass raw must persist per response");
    },
    async settle(_run, call) {
      call.status = "settled";
    },
    async settlePage(_run, page) {
      events.push("settle");
      page.forEach((row) => {
        assert.ok(row.call.raw_body);
        row.call.status = "settled";
      });
    },
    async apply(_run, page) {
      events.push("apply");
      page.forEach((row) => {
        results.push(...row.results);
        row.call.results_applied = true;
      });
    },
    async finish() {
      const status = calls.some((call) => call.status === "unknown")
        ? ("failed" as const)
        : ("completed" as const);
      run.status = status;
      return status;
    },
  };
  let transports = 0;
  const response = (request: JevRequestV1) => ({
    body: JSON.stringify({
      model: request.model,
      usage: { input_tokens: 100, output_tokens: 0 },
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([key, question]) => [
          key,
          question.type === "noul"
            ? { type: "noul", noul: 0.8 }
            : {
                type: "choice",
                choice: Object.keys(question.criteria)[0]!,
                confidence: 0.8,
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((choice, index, all) => [
                    choice,
                    index === 0 ? 0.8 : 0.2 / (all.length - 1),
                  ]),
                ),
              },
        ]),
      ),
    }),
    http_status: 200,
    latency_ms: 1,
  });
  const provider: JevProviderV1 = {
    async evaluate(request) {
      transports++;
      return response(request);
    },
  };
  return {
    run,
    calls,
    results,
    events,
    store,
    provider,
    response,
    transports: () => transports,
  };
}

test("mass classifier preserves probabilities and replays stored responses without a new send", async () => {
  const f = fixture(2);
  assert.equal(
    (
      await processMassLabelingJevV1({
        run_id: f.run.id,
        store: f.store,
        provider: f.provider,
      })
    ).status,
    "completed",
  );
  assert.equal(f.transports(), 2);
  assert.equal(f.results.length, 2);
  assert.deepEqual(f.results[0]?.probabilities?.topic_0, {
    type: "noul",
    noul: 0.8,
  });
  assert.ok(f.events.indexOf("apply") > f.events.indexOf("settle"));
  f.calls.forEach((call) => {
    call.results_applied = false;
  });
  f.run.status = "running";
  await processMassLabelingJevV1({
    run_id: f.run.id,
    store: f.store,
    provider: f.provider,
  });
  assert.equal(f.transports(), 2);
  assert.equal(f.results.length, 4);
});

test(
  "a completed response is durable while another request is still outstanding",
  { timeout: 10000 },
  async () => {
    const f = fixture(2);
    let releaseSecond!: () => void, firstStored!: () => void;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const stored = new Promise<void>((resolve) => {
      firstStored = resolve;
    });
    const persist = f.store.persistRaw;
    f.store.persistRaw = async (run, call, raw) => {
      await persist(run, call, raw);
      if (call.id === "call-0") firstStored();
    };
    let index = 0;
    const provider: JevProviderV1 = {
      async evaluate(request) {
        if (index++ === 1) await second;
        return f.response(request);
      },
    };
    const running = processMassLabelingJevV1({
      run_id: f.run.id,
      store: f.store,
      provider,
    });
    await stored;
    assert.ok(f.calls[0]?.raw_body);
    assert.equal(f.calls[1]?.raw_body, null);
    assert.equal(f.results.length, 0);
    releaseSecond();
    await running;
    assert.equal(f.results.length, 2);
  },
);

test("raw-only recovery never selects or reserves a new mention", async () => {
  const f = fixture(1);
  let inputs = 0,
    reservations = 0;
  f.store.inputs = async () => {
    inputs++;
    throw new Error("must_not_select");
  };
  f.store.reserve = async () => {
    reservations++;
    throw new Error("must_not_reserve");
  };
  const result = await processMassLabelingJevV1({
    run_id: f.run.id,
    store: f.store,
    provider: {
      evaluate: async () => {
        throw new Error("must_not_send");
      },
    },
    recovery_only: true,
  });
  assert.equal(result.status, "recovery_unavailable");
  assert.equal(inputs, 0);
  assert.equal(reservations, 0);
  assert.equal(f.transports(), 0);
});

test("product worker sends one durable request per root including interests and replays without spending", async () => {
  const f = fixture(2, true);
  await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  assert.equal(f.calls.length, 2);
  assert.equal(f.transports(), 2);
  for (const call of f.calls) {
    assert.equal(call.inputs.length, 1);
    assert.deepEqual(Object.keys((call.request as JevRequestV1).questions), ["promotion", "voice", "trigger_barrier", "topic_0", "interest_travel"]);
    assert.match(JSON.stringify((call.request as JevRequestV1).questions.trigger_barrier), /consume or buy tea/u);
  }
  assert.deepEqual(f.results[0]?.probabilities?.interest_travel, { type: "noul", noul: .8 });
  f.calls.forEach(call => { call.results_applied = false; }); f.run.status = "running";
  await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  assert.equal(f.transports(), 2);
});

for (const denial of ["none", "kill_switch", "provider", "workspace"] as const) test(`the actual mass-labeling job preserves all gates with injected runtime dependencies (${denial})`, async () => {
  const f = fixture(1, true);
  const priorMass = process.env.NOISIA_MASS_LABELING_ENABLED, priorJev = process.env.NOISIA_JEV_PROVIDER_ENABLED;
  process.env.NOISIA_MASS_LABELING_ENABLED = denial === "kill_switch" ? "false" : "true";
  process.env.NOISIA_JEV_PROVIDER_ENABLED = "true";
  let preflights = 0;
  const query = async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("SELECT run.workspace_id,labeler.identity")) { assert.deepEqual(params, [f.run.id]); return { rows: [{ workspace_id: f.run.workspace_id, request_version: "mass-labeling-jev-v2" }] }; }
    if (sql.includes("FROM signal_workspace_features")) { assert.deepEqual(params, [f.run.workspace_id, "mass_labeling"]); return { rows: [{ enabled: denial !== "workspace" }] }; }
    if (sql.startsWith("SELECT run.workspace_id,run.actor_user_id")) return { rows: [] };
    throw new Error("unexpected_job_database_query");
  };
  const database = { query, async connect() { return { query, release() {} }; } } as unknown as NonNullable<Parameters<typeof signalMassLabelingJevJobV1>[1]>["database"];
  const fetchImpl: typeof fetch = async (input, init) => {
    preflights++;
    assert.equal(input, "https://api.typesafe.ai/v1/models"); assert.equal(init?.method, "GET");
    assert.deepEqual(init?.headers, { Authorization: "Bearer synthetic-not-a-secret" });
    return new Response("{}", { status: denial === "provider" ? 401 : 200 });
  };
  const invoke = () => signalMassLabelingJevJobV1({ data: { run_id: f.run.id } }, {
    database, store: f.store, provider: f.provider, provider_preflight: { api_key: "synthetic-not-a-secret", fetch_impl: fetchImpl },
  });
  try {
    if (denial === "none") { assert.equal((await invoke()).status, "completed"); assert.equal(f.transports(), 1); }
    else { await assert.rejects(invoke(), new RegExp(denial === "kill_switch" ? "provider_disabled" : denial === "provider" ? "provider_unavailable" : "not_enabled")); assert.equal(f.transports(), 0); }
    assert.equal(preflights, denial === "kill_switch" ? 0 : 1);
  } finally {
    if (priorMass === undefined) delete process.env.NOISIA_MASS_LABELING_ENABLED; else process.env.NOISIA_MASS_LABELING_ENABLED = priorMass;
    if (priorJev === undefined) delete process.env.NOISIA_JEV_PROVIDER_ENABLED; else process.env.NOISIA_JEV_PROVIDER_ENABLED = priorJev;
  }
});

for (const limit of [2, 24] as const) test(`product keeps at most ${Math.min(limit, 8)} responses in flight through slow receipt persistence`, async () => {
  const f = fixture(200, true);
  const persist = f.store.persistRaw;
  let active = 0, peak = 0;
  const client = createTypesafeJevClientV1({ enabled: true, api_key: "synthetic-not-a-secret", concurrency: limit,
    fetch: async (_input, init) => new Response((await f.provider.evaluate(JSON.parse(String(init?.body)))).body, { status: 200 }) });
  const provider: JevProviderV1 = { ...client, async evaluate(request, options) {
    active++; peak = Math.max(peak, active);
    return client.evaluate(request, options);
  } };
  f.store.persistRaw = async (run, call, raw) => {
    try { await delay(3); await persist(run, call, raw); }
    finally { active--; }
  };
  const result = await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider });
  assert.equal(result.status, "completed");
  assert.equal(peak, Math.min(limit, 8));
  assert.equal(active, 0);
  assert.equal(f.transports(), 200);
  assert.equal(f.calls.length, 200);
  assert.equal(new Set(f.calls.map(call => call.inputs[0]!.root_id)).size, 200);
  assert.ok(f.calls.every(call => call.status === "settled" && call.results_applied));
  await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider });
  assert.equal(f.transports(), 200);
});

test("legacy mass transport retains its existing page concurrency", async () => {
  const f = fixture(200), persist = f.store.persistRaw;
  let active = 0, peak = 0;
  const provider: JevProviderV1 = { async evaluate(request) {
    active++; peak = Math.max(peak, active); return f.provider.evaluate(request);
  } };
  f.store.persistRaw = async (run, call, raw) => {
    try { await delay(3); await persist(run, call, raw); } finally { active--; }
  };
  assert.equal((await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider })).status, "completed");
  assert.equal(peak, 200); assert.equal(f.transports(), 200); assert.equal(active, 0);
});

for (const exhausted of [false, true]) test(`200 native requests retain their slots through private Storage readback (${exhausted ? "exhausted throttle" : "transient throttle"})`, { timeout: 15000 }, async () => {
  const f = fixture(200, true), directory = await mkdtemp(join(tmpdir(), "noisia-receipt-pressure-"));
  f.run.workspace_id = "00000000-0000-4000-8000-000000000001";
  f.run.id = "00000000-0000-4000-8000-000000000002";
  const objects = new Map<string, Uint8Array>();
  const persist = f.store.persistRaw;
  let active = 0, peak = 0, throttles = 0, verified = 0;
  const storage = createWorkspaceEngineStorageV1({ url: "https://example.supabase.co", service_role_key: "synthetic-not-a-secret",
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("/bucket/")) return Response.json({ id: "corpus-files", public: false });
      const key = url.split("/corpus-files/")[1]!;
      if (init?.method === "POST") {
        objects.set(key, Uint8Array.from(init.body as Uint8Array)); return Response.json({ Key: key });
      }
      await delay(2);
      if (key.includes("response-call-0.json.") && key.endsWith(".parts.json") && (exhausted || throttles === 0)) {
        throttles++; return new Response("", { status: 429, headers: { "retry-after": "0" } });
      }
      const body = objects.get(key);
      if (!body) return new Response("", { status: 404 });
      if (key.endsWith(".parts.json")) verified++;
      return new Response(new Uint8Array(body));
    } });
  const provider: JevProviderV1 = { ...f.provider, max_concurrency: 24, async evaluate(request) {
    active++; peak = Math.max(peak, active); return f.provider.evaluate(request);
  } };
  f.store.persistRaw = async (run, call, raw) => {
    try {
      const file = join(directory, `response-${call.id}.json`);
      await writeFile(file, raw, { mode: 0o600 });
      await storage.put({ workspace_id: run.workspace_id, execution_id: run.id, file,
        sha256: `sha256:${createHash("sha256").update(raw).digest("hex")}`, size_bytes: Buffer.byteLength(raw), media_type: "application/json" });
      await persist(run, call, raw);
    } finally { active--; }
  };
  try {
    const result = await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider });
    assert.equal(peak, 8); assert.equal(active, 0);
    assert.equal(result.status, exhausted ? "failed" : "completed");
    assert.equal(f.transports(), 200); assert.equal(f.calls.length, 200);
    assert.equal(verified, exhausted ? 199 : 200); assert.equal(throttles, exhausted ? 4 : 1);
    assert.equal(f.calls.filter(call => call.status === "unknown").length, exhausted ? 1 : 0);
    assert.equal(f.calls.filter(call => call.status === "settled").length, exhausted ? 199 : 200);
    assert.equal(objects.size, 400, "every paid body and its immutable manifest survives the final readback throttle");
    await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider });
    assert.equal(f.transports(), 200, "a stopped or finished page never resends a paid root");
    console.log(`# product receipt pressure ${JSON.stringify({ roots: 200, provider_limit: 24, peak_through_readback: peak, verified, throttles, unresolved: exhausted ? 1 : 0, external_provider_calls: 0 })}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("product lease loss keeps in-flight receipts and cancels unsent roots under the end-to-end limit", async () => {
  const f = fixture(200, true), persist = f.store.persistRaw;
  let httpSends = 0;
  const provider = createTypesafeJevClientV1({ enabled: true, api_key: "synthetic-not-a-secret", concurrency: 24,
    fetch: async (_input, init) => { httpSends++; return new Response(f.response(JSON.parse(String(init?.body))).body, { status: 200 }); } });
  f.store.renew = async () => { throw new Error("labeling_lease_lost"); };
  f.store.persistRaw = async (run, call, raw) => { await delay(20); await persist(run, call, raw); };
  await assert.rejects(processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider, lease_renewal_ms: 5 }), /labeling_lease_lost/);
  assert.equal(httpSends, 8);
  assert.equal(f.calls.filter(call => call.raw_body !== null).length, 8);
  assert.equal(f.calls.filter(call => call.status === "failed").length, 192);
  assert.equal(f.results.length, 0);
  assert.ok(!f.events.includes("settle"));
  await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider, recovery_only: true });
  assert.equal(httpSends, 8);
  assert.equal(f.results.length, 8);
});

const streaming = { max_in_flight: 32, flush_size: 8, max_flushes: 2,
  max_buffered_bytes: 16 * 1024 * 1024, flush_interval_ms: 10, window_size: 200 };
test('streaming overlaps provider sends and bounded durable page writes, never parsing before durability', async () => {
  const f = fixture(96, true); let activeWrites = 0, maxWrites = 0, completedDuringWrite = 0;
  const provider: JevProviderV1 = { max_concurrency: 32, max_response_bytes: 16384,
    async evaluate(request) { await delay(2); if (activeWrites) completedDuringWrite++; return f.response(request); } };
  f.store.persistRawPage = async (_run, rows) => {
    activeWrites++; maxWrites = Math.max(maxWrites, activeWrites);
    await delay(15);
    for (const row of rows) row.call.raw_body = row.raw;
    f.events.push(`page:${rows.length}`); activeWrites--;
  };
  const outcome = await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider, execution: streaming });
  assert.equal(outcome.status, 'completed'); assert.equal(outcome.labeled, 96);
  assert.equal(outcome.unresolved_billing_requests, 0); assert.equal(f.results.length, 96);
  assert.equal(maxWrites, 2); assert.ok(completedDuringWrite > 0, 'HTTP responses continue during durable writes');
  assert.ok(f.events.indexOf('settle') > f.events.findIndex(event => event.startsWith('page:')));
});
test('streaming storage failure preserves unknown outcome and never resends it', async () => {
  const f = fixture(32, true);
  f.store.persistRawPage = async () => { throw Error('storage_down'); };
  await assert.rejects(processMassLabelingJevV1({ run_id:f.run.id,store:f.store,provider:{...f.provider,max_response_bytes:16384},execution:streaming }), /storage_down/);
  assert.equal(f.results.length, 0, 'storage failures preserve responses for recovery instead of applying a substitute');
  assert.ok(f.calls.some(call => call.status === 'unknown'));
  assert.equal(f.events.includes('settle'), false);
});
test('streaming rate observation failure cannot turn applied paid calls unknown', async () => {
  const f = fixture(8, true);
  f.store.persistRawPage = async (_run, rows) => { for (const row of rows) row.call.raw_body = row.raw; };
  const provider: JevProviderV1 = { ...f.provider, max_response_bytes:16384, async observeUsage(){ throw Error('redis_down'); } };
  await assert.rejects(processMassLabelingJevV1({run_id:f.run.id,store:f.store,provider,execution:streaming}), /redis_down/);
  assert.equal(f.results.length,8); assert.ok(f.calls.every(call => call.status === 'settled' && call.results_applied));
});

test('streaming keeps one lease across successive input windows without the polling cooldown',async()=>{
  const f=fixture(512,true), inputs=await f.store.inputs(f.run);let cursor=0,claims=0,releases=0;
  f.store.inputs=async()=>inputs.slice(cursor,cursor+=128);
  const reserve=f.store.reserve;
  f.store.reserve=async(run,proposals)=>{const base=f.calls.length;const rows=await reserve(run,proposals);for(const [index,row]of rows.entries())row.id=`call-${base+index}`;return rows;};
  const claim=f.store.claim;f.store.claim=async(id)=>{claims++;return claim(id);};
  f.store.release=async()=>{releases++;};
  f.store.finish=async()=>{const status=f.results.length===512?'completed':'running';f.run.status=status;return status;};
  f.store.persistRawPage=async(_run,rows)=>{for(const row of rows)row.call.raw_body=row.raw;};
  const outcome=await processMassLabelingJevV1({run_id:f.run.id,store:f.store,provider:{...f.provider,max_response_bytes:16384},execution:{...streaming,window_size:128}});
  assert.equal(outcome.status,'completed');assert.equal(outcome.labeled,512);assert.equal(outcome.roots,512);
  assert.equal(claims,1);assert.equal(releases,1);assert.equal(f.transports(),512);
});

test('streaming restart never resends a submitting call without a durable receipt',async()=>{
  const f=fixture(1,true);
  await processMassLabelingJevV1({run_id:f.run.id,store:f.store,provider:f.provider});
  const call=f.calls[0]!;call.status='submitting';call.results_applied=false;call.raw_body=null;
  f.run.status='running';f.results.length=0;let sent=0;
  const outcome=await processMassLabelingJevV1({run_id:f.run.id,store:f.store,
    provider:{max_response_bytes:16384,evaluate:async()=>{sent++;throw Error('must_not_send');}},execution:streaming});
  assert.equal(sent,0);assert.equal(outcome.status,'failed');assert.equal(call.status,'unknown');
  assert.equal(f.results.length,1);assert.equal(f.results[0]!.status,'error');assert.equal(call.results_applied,true);
});

test('streaming seals a 529 with usage zero, stops new sends and applies technical errors without settlement', {timeout:10000}, async () => {
  const f = fixture(64, true), durable = new Map<string, string>();
  let sends = 0, observations = 0;
  f.store.persistRawPage = async (_run, rows) => { for (const row of rows) {
    durable.set(row.call.id, row.raw); row.call.raw_body = row.raw;
  } };
  const provider: JevProviderV1 = { max_concurrency: 4, max_response_bytes: 16384,
    async evaluate(request) {
      if (sends++ === 0) return { http_status: 529, latency_ms: 1,
        body: JSON.stringify({ error: 'busy', usage: { input_tokens: 0, output_tokens: 0 } }) };
      await delay(10); return f.response(request);
    }, async observeUsage() { observations++; } };
  const outcome = await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider,
    execution: { ...streaming, max_in_flight: 4 } });
  assert.equal(sends, 4, 'only the already in-flight responses may finish after a rejection');
  assert.equal(outcome.status, 'failed'); assert.equal(outcome.unresolved_billing_requests, 1);
  assert.equal(f.calls[0]!.status, 'unknown'); assert.equal(f.calls[0]!.results_applied, true);
  assert.equal(JSON.parse(durable.get(f.calls[0]!.id)!).http_status, 529);
  assert.equal(observations, 3, 'unknown usage is not a quota refund or calibration sample');
  assert.equal(f.results.filter(row => row.status === 'labeled').length, 3);
  assert.equal(f.results.filter(row => row.status === 'error').length, 1);
  assert.equal(f.calls.filter(call=>call.status==='reserved'&&!call.results_applied).length,60,'never-evaluated roots keep their reservation without a final technical result');
  assert.equal(f.calls.filter(call => call.status === 'settled').length, 3);
  await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider, execution: streaming });
  assert.equal(sends, 4, 'an ambiguous rejection never authorizes another send');
});

test('streaming releases applied raw bodies instead of retaining them for an entire input window', {timeout:10000}, async () => {
  const f = fixture(48, true); let sends = 0, retainedApplied = false;
  f.store.persistRawPage = async (_run, rows) => { for (const row of rows) row.call.raw_body = row.raw; };
  const provider: JevProviderV1 = { max_concurrency: 1, max_response_bytes: 16384,
    async evaluate(request) {
      if (sends++ > 8 && f.calls.some(call => call.results_applied && call.raw_body !== null)) retainedApplied = true;
      await delay(2); return f.response(request);
    } };
  const outcome = await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider,
    execution: { ...streaming, flush_size: 1, max_in_flight: 1, max_flushes: 1 } });
  assert.equal(outcome.status, 'completed'); assert.equal(outcome.labeled, 48);
  assert.equal(retainedApplied, false);
  assert.ok(f.calls.every(call => call.raw_body === null));
});

test('streaming reserves codec working memory until durable flush finishes', {timeout:10000}, async () => {
  const f = fixture(16, true); let beforeDurability = 0, durable = false;
  const snapshots: Array<{in_flight:number;reserved_working_bytes:number;active_flushes:number}> = [];
  f.store.persistRawPage = async (_run, rows) => {
    await delay(20); for (const row of rows) row.call.raw_body = row.raw;
    durable = true;
  };
  const provider: JevProviderV1 = { max_concurrency: 16, max_response_bytes: 16384,
    async evaluate(request) { if (!durable) beforeDurability++; return f.response(request); } };
  const outcome = await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider,
    execution: { ...streaming, max_in_flight: 16, max_flushes: 1, max_buffered_bytes: 1024 * 1024 },
    observe_stream: metrics => { snapshots.push(metrics); } });
  assert.equal(outcome.status, 'completed'); assert.equal(outcome.labeled, 16);
  assert.equal(beforeDurability, 2, 'body receipt cannot release the capacity reserved for JSONL copies');
  assert.ok(snapshots.every(s => s.reserved_working_bytes >= 0 && s.reserved_working_bytes <= 1024 * 1024));
  assert.ok(snapshots.some(s => s.in_flight === 0 && s.active_flushes > 0 && s.reserved_working_bytes > 0),
    'the measured reservation includes flushes after all HTTP requests returned');
  assert.equal(snapshots.at(-1)!.reserved_working_bytes, 0);
});

test('streaming observer failure cannot interrupt settlement or change the outcome', async () => {
  const f = fixture(8, true);
  f.store.persistRawPage = async (_run, rows) => { for (const row of rows) row.call.raw_body = row.raw; };
  const outcome = await processMassLabelingJevV1({ run_id:f.run.id,store:f.store,
    provider:{...f.provider,max_response_bytes:16384},execution:streaming,
    observe_stream:() => { throw Error('observer_down'); } });
  assert.equal(outcome.status,'completed');assert.equal(f.results.length,8);
  assert.ok(f.calls.every(call => call.status==='settled' && call.results_applied));
});

for (const fault of ['apply', 'settlement_ack', 'application_ack'] as const) test(`streaming preserves valid paid responses after a ${fault} failure`, async () => {
  const f = fixture(8, true), durable = new Map<string, string>();
  f.store.persistRawPage = async (_run, rows) => { for (const row of rows) {
    durable.set(row.call.id, row.raw); row.call.raw_body = row.raw;
  } };
  const calls = f.store.calls;
  f.store.calls = async run => {
    const rows = await calls(run);
    for (const call of rows) if (!call.raw_body && durable.has(call.id)) call.raw_body = durable.get(call.id)!;
    return rows;
  };
  const apply = f.store.apply, settle = f.store.settlePage;
  const claim = f.store.claim;
  f.store.claim = async id => f.run.status === 'failed' && !f.calls.some(call => call.status === 'unknown') ? null : claim(id);
  f.store.finish = async () => {
    const state: 'running' | 'failed' | 'completed' = f.calls.some(call => durable.has(call.id) && !call.results_applied) ? 'running'
      : f.calls.some(call => call.status === 'unknown') ? 'failed' : 'completed';
    f.run.status = state; return state;
  };
  let injected = false, applyAttempts = 0;
  f.store.apply = async (run, rows) => {
    applyAttempts++;
    if (fault === 'apply' && !injected) { injected = true; throw Error('apply_commit_failed'); }
    await apply(run, rows);
    if (fault === 'application_ack' && !injected) { injected = true; throw Error('application_ack_lost'); }
  };
  f.store.settlePage = async (run, rows) => {
    await settle(run, rows);
    if (fault === 'settlement_ack' && !injected) { injected = true; throw Error('settlement_ack_lost'); }
  };
  const invoke = () => processMassLabelingJevV1({ run_id:f.run.id,store:f.store,
    provider:{...f.provider,max_response_bytes:16384},execution:streaming });
  await assert.rejects(invoke(), fault === 'apply' ? /apply_commit_failed/
    : fault === 'settlement_ack' ? /settlement_ack_lost/ : /application_ack_lost/);
  if (fault === 'application_ack') {
    assert.equal(f.results.length,8);assert.ok(f.results.every(result => result.status==='labeled'));
    assert.equal(f.run.status,'completed','the ledger reconciles an applied commit without an unreclaimable failed run');
    assert.equal((await invoke()).status,'not_claimed');
  } else {
    assert.equal(f.results.length,0,'a database failure cannot replace valid model evidence with a technical label');
    assert.ok(f.calls.every(call => call.status==='settled' && !call.results_applied));
    assert.equal(f.run.status,'running','pending raw remains automatically reclaimable');
    assert.equal(applyAttempts,fault==='apply'?1:0,'no second technical apply after a persistence failure');
    assert.equal((await invoke()).status,'completed');
  }
  assert.equal(f.transports(),8,'recovery reads durable responses without another physical attempt');
  assert.equal(f.results.length,8);assert.ok(f.results.every(result => result.status==='labeled'));
  assert.ok(f.calls.every(call => call.status==='settled' && call.results_applied));
});


test('legacy drainer selects only its two request versions and keeps the lease/poll guards',()=>{
  assert.match(MASS_LABELING_JEV_PENDING_RUNS_SQL_V1,/request_version.*IN\('mass-labeling-jev-v1','mass-labeling-jev-v2'\)/);
  assert.match(MASS_LABELING_JEV_PENDING_RUNS_SQL_V1,/NOT run.waiting_full_confirmation/);
  assert.match(MASS_LABELING_JEV_PENDING_RUNS_SQL_V1,/run.next_poll_at<=now\(\)/);
  assert.match(MASS_LABELING_JEV_PENDING_RUNS_SQL_V1,/run.lease_until<now\(\)/);
});
for(const version of ['mass-labeling-jev-v1','mass-labeling-jev-v2','listening-jev-v1','unknown-version'])
  test(`mass-labeling job fences request owner before claiming (${version})`,async()=>{
    const legacy=version==='mass-labeling-jev-v1'||version==='mass-labeling-jev-v2';
    const f=fixture(1,version!=='mass-labeling-jev-v1');let claims=0;
    const claim=f.store.claim;f.store.claim=async id=>{claims++;return claim(id);};
    const savedMass=process.env.NOISIA_MASS_LABELING_ENABLED,savedJev=process.env.NOISIA_JEV_PROVIDER_ENABLED;
    process.env.NOISIA_MASS_LABELING_ENABLED='true';process.env.NOISIA_JEV_PROVIDER_ENABLED='true';
    const query=async(sql:string)=>{
      if(sql.startsWith('SELECT run.workspace_id,labeler.identity')){
        assert.match(sql,/request_version.*IN\('mass-labeling-jev-v1','mass-labeling-jev-v2'\)/);
        // An untrusted/stale adapter returning a foreign owner is fenced again in code.
        return{rows:[{workspace_id:f.run.workspace_id,request_version:version}]};
      }
      if(sql.includes('FROM signal_workspace_features')){assert.ok(legacy);return{rows:[{enabled:true}]};}
      if(sql.startsWith('SELECT run.workspace_id,run.actor_user_id'))return{rows:[]};
      throw Error('unexpected_owner_query');
    };
    const database={query,async connect(){return{query,release(){}};}}as unknown as NonNullable<Parameters<typeof signalMassLabelingJevJobV1>[1]>['database'];
    try{
      const call=()=>signalMassLabelingJevJobV1({data:{run_id:f.run.id}},{database,store:f.store,provider:f.provider,
        provider_preflight:{api_key:`synthetic-coexistence-${version}`,fetch_impl:async()=>new Response('{}',{status:200})}});
      if(legacy){assert.equal((await call()).status,'completed');assert.equal(claims,1);assert.equal(f.transports(),1);}
      else{await assert.rejects(call(),/mass_labeling_not_enabled/);assert.equal(claims,0);assert.equal(f.transports(),0);}
    }finally{
      if(savedMass===undefined)delete process.env.NOISIA_MASS_LABELING_ENABLED;else process.env.NOISIA_MASS_LABELING_ENABLED=savedMass;
      if(savedJev===undefined)delete process.env.NOISIA_JEV_PROVIDER_ENABLED;else process.env.NOISIA_JEV_PROVIDER_ENABLED=savedJev;
    }
  });


for(const fault of ['raw_page_write','settlement_ack','apply_ack']as const)
  test(`streaming ${fault} leaves never-evaluated reservations pending and resumes all roots without duplicate HTTP`,async()=>{
    const f=fixture(3,true),raws=new Map<string,string>(),sent=new Set<string>();let injected=false;
    const calls=f.store.calls;
    f.store.calls=async run=>{const rows=await calls(run);for(const call of rows)call.raw_body=raws.get(call.id)??null;return rows;};
    f.store.markFailed=async(_run,rows,unknown)=>{for(const call of rows)if(['reserved','submitting','submitted'].includes(call.status))call.status=unknown?'unknown':'failed';};
    const requeued:string[]=[];
    f.store.requeueUnsent=async(_run,rows)=>{for(const call of rows){assert.ok(!sent.has(call.id),'evaluate-started IDs must never be requeued');assert.ok(!raws.has(call.id));assert.equal(call.results_applied,false);call.status='reserved';requeued.push(call.id);}};
    f.store.finish=async()=>{
      const unknown=f.calls.some(call=>call.status==='unknown'),active=f.calls.some(call=>['reserved','submitting','submitted'].includes(call.status)||call.status==='settled'&&!call.results_applied);
      f.run.error_code=unknown?'labeling_outcome_unknown':null;const status=active?'running' as const:unknown?'failed' as const:'completed' as const;f.run.status=status;return status;
    };
    f.store.persistRawPage=async(_run,rows)=>{for(const row of rows){raws.set(row.call.id,row.raw);row.call.raw_body=row.raw;}await delay(1);
      if(fault==='raw_page_write'&&!injected){injected=true;throw Error('synthetic_after_durable_write');}};
    const settle=f.store.settlePage,apply=f.store.apply;
    f.store.settlePage=async(run,rows)=>{await settle(run,rows);if(fault==='settlement_ack'&&!injected){injected=true;throw Error('synthetic_after_settlement_commit');}};
    f.store.apply=async(run,rows)=>{await apply(run,rows);if(fault==='apply_ack'&&!injected){injected=true;throw Error('synthetic_after_apply_commit');}};
    const provider:JevProviderV1={max_concurrency:1,max_response_bytes:16384,async evaluate(request){
      const call=f.calls.find(call=>call.request===request)!;assert.ok(call);assert.ok(!sent.has(call.id),'no physical request may replay');sent.add(call.id);
      await delay(8);return f.response(request);
    }};
    const args={run_id:f.run.id,store:f.store,provider,execution:{...streaming,max_in_flight:1,flush_size:1,max_flushes:1,window_size:3}};
    await assert.rejects(processMassLabelingJevV1(args),/synthetic_after_/);
    assert.equal(sent.size,2);assert.deepEqual(requeued,['call-2']);
    assert.equal(f.calls[2]!.status,'reserved');assert.equal(f.calls[2]!.results_applied,false);
    const recovered=await processMassLabelingJevV1(args);
    assert.equal(recovered.status,'completed');assert.equal(sent.size,3);
    assert.ok(f.calls.every(call=>call.status==='settled'&&call.results_applied));
    assert.equal(f.results.length,3);assert.ok(f.results.every(result=>result.status==='labeled'));
  });
