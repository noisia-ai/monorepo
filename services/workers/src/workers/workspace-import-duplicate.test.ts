import assert from "node:assert/strict";
import test from "node:test";

import { completePreviouslyAcceptedWorkspaceImport } from "./workspace-import-duplicate";

function database(completion: { accepted: boolean; accepted_batch_id: string } | Error, found = true) {
  const events: string[] = [];
  let reads = 0;
  const client = {
    query: async (sql: string) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) { events.push(sql); return { rows: [] }; }
      if (reads++ === 0) return { rows: found ? [{ id: "accepted-id", record_count: 17 }] : [] };
      if (completion instanceof Error) throw completion;
      return { rows: [completion] };
    },
    release() { events.push("RELEASE"); }
  };
  return { events, pool: { connect: async () => client } as unknown as Parameters<typeof completePreviouslyAcceptedWorkspaceImport>[0]["pool"] };
}
const identity = { importBatchId: "recovery-id", workerJobId: "worker-id", verifiedHash: "a".repeat(64), verifiedBytes: 1234 };

test("a replay cannot commit a new acceptance or a different accepted authority", async () => {
  for (const outcome of [{ accepted: true, accepted_batch_id: "recovery-id" }, { accepted: false, accepted_batch_id: "other-id" }]) {
    const fixture = database(outcome);
    await assert.rejects(completePreviouslyAcceptedWorkspaceImport({ ...identity, pool: fixture.pool }), /lost its accepted authority/u);
    assert.deepEqual(fixture.events, ["BEGIN", "ROLLBACK", "RELEASE"]);
  }
});

test("a completion error releases its connection and rolls back the whole replay", async () => {
  const fixture = database(new Error("completion unavailable"));
  await assert.rejects(completePreviouslyAcceptedWorkspaceImport({ ...identity, pool: fixture.pool }), /completion unavailable/u);
  assert.deepEqual(fixture.events, ["BEGIN", "ROLLBACK", "RELEASE"]);
});

test("an unmatched verified file remains eligible for normal ingestion", async () => {
  const fixture = database(new Error("completion must not be called"), false);
  assert.equal(await completePreviouslyAcceptedWorkspaceImport({ ...identity, pool: fixture.pool }), null);
  assert.deepEqual(fixture.events, ["BEGIN", "COMMIT", "RELEASE"]);
});
