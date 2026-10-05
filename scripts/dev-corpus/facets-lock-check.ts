/** Opt-in after the single reviewed SQL installation. No provider transport. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { main, openDatabase, verifyDisposableFixtureInDatabase } from "./guard.mjs";
import {
  createSignalLabelingStoreV1,
  requestMentionFacetsV1,
  type LabelingRunV1,
} from "../../infrastructure/db/signal-labeling-runs";
import { facetCallProposalV1 } from "../../services/workers/src/workers/signal-mention-facets-batch";
import {
  facetLabelerIdentityV1,
  groupFacetInputsV1,
} from "../../packages/query-engine/src/signal-mention-facets-v1";
await main(async () => {
  const database = await openDatabase();
  const identity = JSON.parse(
    await readFile(".data/dev-corpus/identity.json", "utf8"),
  );
  await verifyDisposableFixtureInDatabase(database, identity, "facets-lock-check");
  const prior =
    (
      await database.query(
        "SELECT labeler_version_id FROM signal_workspace_labelers WHERE workspace_id=$1 AND kind='facets'",
        [identity.workspace_id],
      )
    ).rows[0]?.labeler_version_id ?? null;
  const store = createSignalLabelingStoreV1({
    database,
    storeRaw: async () => {
      throw new Error("mfp_lock_probe_must_not_store_raw");
    },
  });
  let run: LabelingRunV1 | null = null;
  let fixtureLabeler: string | null = null;
  let continueReserve = () => {};
  try {
    const labeler = facetLabelerIdentityV1();
    labeler.params = {
      ...labeler.params,
      simulation: "concurrency-no-transport",
    };
    const requested = await requestMentionFacetsV1({
      database,
      workspace_id: identity.workspace_id,
      actor_user_id: identity.internal_user_id,
      identity: labeler,
      idempotency_key: `pg-lock-${randomUUID()}`,
      provider_available: true,
    });
    run = await store.claim(requested.run_id);
    assert.ok(run);
    fixtureLabeler = (
      await database.query(
        "SELECT labeler_version_id FROM signal_labeling_runs WHERE id=$1",
        [run.id],
      )
    ).rows[0].labeler_version_id;
    const inputs = await store.inputs(run);
    assert.equal(inputs.length, 200);
    let announceRunLock = () => {};
    const hasRunLock = new Promise<void>((resolve) => {
      announceRunLock = resolve;
    });
    const renewEntered = new Promise<void>((resolve) => {
      continueReserve = resolve;
    });
    let lockObserved = false,
      renewObserved = false;
    const instrument = (role: "reserve" | "renew") => ({
      query: database.query.bind(database),
      async connect() {
        const client = await database.connect();
        await client.query("SET statement_timeout='5s'");
        return {
          async query(sql: any, values?: any) {
            const locksRun =
              typeof sql === "string" &&
              sql.includes("SELECT id FROM signal_labeling_runs") &&
              sql.includes("FOR UPDATE");
            if (role === "renew" && locksRun) {
              renewObserved = true;
              continueReserve();
            }
            const result = await client.query(sql, values);
            if (role === "reserve" && locksRun) {
              lockObserved = true;
              announceRunLock();
              await renewEntered;
            }
            // With the previous inverted order this releases reserve only after renewal owns the day lock,
            // forcing the concrete run/day cycle instead of relying on timing luck.
            if (
              role === "renew" &&
              typeof sql === "string" &&
              sql.includes("SELECT signal_processing_lock_v1")
            ) {
              renewObserved = true;
              continueReserve();
            }
            return result;
          },
          release() {
            client.release();
          },
        };
      },
    });
    const reservationStore = createSignalLabelingStoreV1({
      database: instrument("reserve") as any,
      storeRaw: async () => "unused",
    });
    const renewalStore = createSignalLabelingStoreV1({
      database: instrument("renew") as any,
      storeRaw: async () => "unused",
    });
    const proposals = groupFacetInputsV1(
      inputs,
      JSON.stringify(run.context).length,
      run.identity,
    ).map((group) => facetCallProposalV1(run!, group));
    const reservation = reservationStore.reserve(run, proposals);
    const timeout = setTimeout(() => continueReserve(), 5000);
    try {
      await Promise.race([
        hasRunLock,
        reservation.then(() => {
          throw new Error("mfp_probe_run_lock_not_observed");
        }),
      ]);
      const outcomes = await Promise.allSettled([
        reservation,
        renewalStore.renew(run),
      ]);
      const failed = outcomes.find((outcome) => outcome.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    } finally {
      clearTimeout(timeout);
      continueReserve();
    }
    assert.ok(lockObserved && renewObserved);
    const calls = await store.calls(run);
    assert.equal(calls.length, proposals.length);
    assert.ok(calls.every((call) => call.status === "reserved"));
    console.log(
      JSON.stringify({
        stage: "facets_lock_order",
        status: "passed",
        roots: inputs.length,
        calls: calls.length,
        connections: 2,
        provider_real_calls: 0,
      }),
    );
  } finally {
    continueReserve();
    if (run) {
      await store.fail(run, "concurrency_probe_complete");
      await store.release(run);
      if (prior) {
        await database.query(
          "UPDATE signal_workspace_labelers SET labeler_version_id=$3 WHERE workspace_id=$1 AND kind='facets' AND labeler_version_id=$2",
          [identity.workspace_id, fixtureLabeler, prior],
        );
      } else {
        await database.query(
          "DELETE FROM signal_workspace_labelers WHERE workspace_id=$1 AND kind='facets' AND labeler_version_id=$2",
          [identity.workspace_id, fixtureLabeler],
        );
      }
      const remaining = (
        await database.query(
          "SELECT count(*)::int count FROM signal_labeling_calls WHERE run_id=$1 AND status<>'failed'",
          [run.id],
        )
      ).rows[0].count;
      assert.equal(remaining, 0);
    }
    await database.end();
  }
});
