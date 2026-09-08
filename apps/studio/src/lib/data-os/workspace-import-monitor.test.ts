import assert from "node:assert/strict";
import test from "node:test";
import { canConfirmImportUpload, confirmWorkspaceImportUpload, pollWorkspaceImport, refreshAfterImportCompletion, replaceMonitoredImport, reportWorkspaceImportUploadFailure } from "./workspace-import-monitor";

test("a prior file cannot replace the visible result of a later upload", () => {
  const first = { id: "first", status: "completed" }, second = { id: "second", status: "processing" };
  assert.deepEqual(replaceMonitoredImport(second, first), second);
  assert.equal(replaceMonitoredImport(null, first), null);
  assert.deepEqual(replaceMonitoredImport(second, { ...second, status: "completed" }), { ...second, status: "completed" });
});
test("a delayed finalize response cannot move a terminal result back to queued", () => {
  for (const status of ["completed", "failed"]) {
    const terminal = { id: "one", status, phase: status, records: 904 };
    assert.equal(replaceMonitoredImport(terminal, { ...terminal, status: "queued", phase: "uploading", records: 0 }), terminal);
    assert.equal(replaceMonitoredImport(terminal, { ...terminal, status: "processing", records: 0 }), terminal);
  }
  const processing = { id: "one", status: "processing" };
  assert.equal(replaceMonitoredImport(processing, { ...processing, status: "queued" }), processing);
});
test("uncertain finalization can be repeated after reload with the same file ID and stable key", async () => {
  const calls: Array<{ url: string; method: string; key: string | null; body: unknown }> = [];
  let failBeforeApply = true;
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET",
      key: new Headers(init?.headers).get("Idempotency-Key"), body: JSON.parse(String(init?.body)) });
    if (failBeforeApply) { failBeforeApply = false; return Response.json({}, { status: 503 }); }
    return Response.json({ import: { id: "one", status: "queued", phase: "queued" } });
  };
  const request = { url: "/imports/one", importId: "one", transport };
  await assert.rejects(confirmWorkspaceImportUpload(request), /import_finalize_unavailable/);
  // The receipt loaded from history contains everything needed; no local upload key or File is reused.
  assert.equal(canConfirmImportUpload({ id: "one", status: "queued", phase: "uploading" }), true);
  assert.equal(canConfirmImportUpload({ id: "one", status: "queued", phase: "queued" }), false);
  const result = await confirmWorkspaceImportUpload(request);
  assert.equal(result.id, "one");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { url: "/imports/one", method: "POST", key: "complete-upload:one", body: { action: "complete-upload" } });
  assert.deepEqual(calls[1], calls[0]);
});
test("an ambiguous finalize response performs no fail-upload, and a later completed replay is accepted", async () => {
  const actions: string[] = [];
  let applied = false;
  const transport: typeof fetch = async (_url, init) => {
    actions.push(JSON.parse(String(init?.body)).action);
    if (!applied) { applied = true; throw new TypeError("Network response lost after apply"); }
    return Response.json({ import: { id: "one", status: "completed" } });
  };
  const request = { url: "/imports/one", importId: "one", transport };
  await assert.rejects(confirmWorkspaceImportUpload(request), /response lost/);
  assert.equal((await confirmWorkspaceImportUpload(request)).status, "completed");
  assert.deepEqual(actions, ["complete-upload", "complete-upload"]);
});
test("finalization surfaces an incomplete file without silently uploading or cancelling it", async () => {
  let requests = 0;
  await assert.rejects(confirmWorkspaceImportUpload({ url: "/imports/one", importId: "one",
    transport: async () => { requests++; return Response.json({ error: "upload_size_mismatch" }, { status: 409 }); } }), /upload_size_mismatch/);
  assert.equal(requests, 1);
});
test("monitor follows one import until completion using only uncached reads", async () => {
  const states = ["queued", "processing", "completed"], seen: string[] = [], methods: string[] = [];
  await pollWorkspaceImport({ url: "/imports/one", importId: "one", signal: new AbortController().signal,
    onProgress: (item) => { seen.push(item.status); }, pause: async () => {},
    transport: async (_url, init) => { assert.equal(init?.cache, "no-store"); methods.push(init?.method ?? "GET");
      return Response.json({ import: { id: "one", status: states.shift() } }); } });
  assert.deepEqual(seen, ["queued", "processing", "completed"]);
  assert.deepEqual(methods, ["GET", "GET", "GET"]);
});
test("closing the view aborts pending reads without another progress update or server mutation", async () => {
  const controller = new AbortController(), seen: string[] = [];
  await assert.rejects(pollWorkspaceImport({ url: "/imports/one", importId: "one", signal: controller.signal,
    onProgress: (item) => { seen.push(item.status); },
    transport: async () => { controller.abort(); return Response.json({ import: { id: "one", status: "completed" } }); } }),
  { name: "AbortError" });
  assert.deepEqual(seen, []);
});
test("a transient status error remains a read failure; retry resumes the same import", async () => {
  const controller = new AbortController(); let writes = 0;
  await assert.rejects(pollWorkspaceImport({ url: "/imports/one", importId: "one", signal: controller.signal,
    onProgress: () => {}, transport: async (_url, init) => { if (init?.method === "POST") writes++; return Response.json({}, { status: 503 }); } }), /import_status_unavailable/);
  const terminal = await pollWorkspaceImport({ url: "/imports/one", importId: "one", signal: controller.signal,
    onProgress: () => {}, transport: async () => Response.json({ import: { id: "one", status: "completed" } }) });
  assert.equal(terminal.id, "one"); assert.equal(writes, 0);
});
test("a response for a different file is rejected instead of displayed", async () => {
  await assert.rejects(pollWorkspaceImport({ url: "/imports/one", importId: "one", signal: new AbortController().signal,
    onProgress: () => assert.fail("wrong file was displayed"),
    transport: async () => Response.json({ import: { id: "two", status: "completed" } }) }), /identity_mismatch/);
});
test("closing a completed import suppresses its delayed page refresh while the next file starts", async () => {
  const firstReader = new AbortController(); let finishState!: () => void; let refreshes = 0;
  const pending = refreshAfterImportCompletion({ signal: firstReader.signal,
    refreshState: () => new Promise<void>((resolve) => { finishState = resolve; }), refreshPage: () => { refreshes++; } });
  firstReader.abort(); // Close completed Localiza before its state read finishes.
  const second = { id: "second", status: "queued", phase: "uploading" };
  finishState(); await pending;
  assert.equal(refreshes, 0);
  assert.equal(second.phase, "uploading");
});
test("a reported transport cancellation replaces the queued UI receipt with the actual failed server receipt", async () => {
  const queued = { id: "second", status: "queued", phase: "uploading" };
  const failed = await reportWorkspaceImportUploadFailure({ url: "/imports/second", importId: "second", key: "creation-key", code: "upload_aborted",
    transport: async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { action: "fail-upload", failure_code: "upload_aborted" });
      return Response.json({ import: { id: "second", status: "failed", phase: "failed" } });
    } });
  assert.deepEqual(replaceMonitoredImport(queued, failed), { id: "second", status: "failed", phase: "failed" });
  assert.equal(canConfirmImportUpload(failed), false);
});
