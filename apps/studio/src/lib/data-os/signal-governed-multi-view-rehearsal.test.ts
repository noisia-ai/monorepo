import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SIGNAL_GOVERNED_MULTI_VIEW_MAX_RESTORE_AGE_MS,
  resolveSignalGovernedMultiViewFilterV1,
  resolveSignalGovernedBindingResumeV1,
  runSignalGovernedBindingPhaseWithCompensationV1,
  signalGovernedRegistryMatchesFrozenV1,
  resolveSignalGovernedMultiViewRestorePointV1
} from "./signal-governed-multi-view-rehearsal";

test("Backend 06 accepts a restore point exactly 24 hours old", () => {
  const now = Date.parse("2026-08-12T14:17:07.000Z");
  assert.deepEqual(resolveSignalGovernedMultiViewRestorePointV1(
    new Date(now - SIGNAL_GOVERNED_MULTI_VIEW_MAX_RESTORE_AGE_MS).toISOString(),
    now
  ), {
    restore_point_at: "2026-08-11T14:17:07.000Z",
    restore_point_age_hours: 24
  });
});

test("Backend 06 rejects stale, future and invalid restore points", () => {
  const now = Date.parse("2026-08-12T14:17:07.000Z");
  assert.throws(() => resolveSignalGovernedMultiViewRestorePointV1(
    new Date(now - SIGNAL_GOVERNED_MULTI_VIEW_MAX_RESTORE_AGE_MS - 1).toISOString(),
    now
  ), /no older than 24 hours/iu);
  assert.throws(() => resolveSignalGovernedMultiViewRestorePointV1(
    new Date(now + 1).toISOString(),now
  ), /no older than 24 hours/iu);
  assert.throws(() => resolveSignalGovernedMultiViewRestorePointV1("not-a-date",now),
    /no older than 24 hours/iu);
});

test("Backend 06 remote snapshot uses the real Review action and sequential pg queries", async () => {
  const source = await readFile(new URL(
    "../../../scripts/signal-governed-multi-view-staging-rehearsal.ts",
    import.meta.url
  ), "utf8");
  assert.match(source, /event\.action AS review_action/u);
  assert.doesNotMatch(source, /event\.decision/u);
  assert.doesNotMatch(source,
    /const \[v1, base, brand, pointers, semantic, otherWorkspaces, syncs\] = await Promise\.all/u);
  assert.doesNotMatch(source,
    /const \[mentions, entities, provenance, governance\] = await Promise\.all/u);
  assert.doesNotMatch(source,
    /initialBindingCounts = Object\.fromEntries\(await Promise\.all/u);
  assert.match(source,/count\(item\.operation_id\)::int AS item_count/u);
  assert.doesNotMatch(source,/count\(item\.id\)/u);
});

test("Backend 06 derives one stable filter from observed canonical-root periods", () => {
  assert.deepEqual(resolveSignalGovernedMultiViewFilterV1([
    { period_start: "2026-03-02",period_end: "2026-05-04" },
    { period_start: "2026-01-03",period_end: "2026-07-09" }
  ],"America/Mexico_City"), {
    contract_version: "signal-backend-v1",
    date_range: { start: "2026-01-03",end: "2026-07-09" },
    timezone: "America/Mexico_City",granularity: "month",dimensions: {}
  });
  assert.throws(() => resolveSignalGovernedMultiViewFilterV1([],"UTC"),
    /observed canonical-root date window/iu);
});

test("Backend 06 detects a missing zero-root governed entity", () => {
  assert.equal(signalGovernedRegistryMatchesFrozenV1(
    ["competitor:a"],["competitor:a","competitor:zero-root"]
  ),false);
});

test("Backend 06 never re-promotes an operator withdrawal as a rehearsal resume", () => {
  assert.equal(resolveSignalGovernedBindingResumeV1({
    currentBindingCount: 3,currentMatchesKnownPromote: true,ownCompensationProven: false
  }),"current");
  assert.equal(resolveSignalGovernedBindingResumeV1({
    currentBindingCount: 0,currentMatchesKnownPromote: false,ownCompensationProven: true
  }),"recover");
  assert.throws(() => resolveSignalGovernedBindingResumeV1({
    currentBindingCount: 0,currentMatchesKnownPromote: false,ownCompensationProven: false
  }),/refuses an unproven or stale binding resume state/iu);
  assert.throws(() => resolveSignalGovernedBindingResumeV1({
    currentBindingCount: 3,currentMatchesKnownPromote: false,ownCompensationProven: true
  }),/refuses an unproven or stale binding resume state/iu);
});

test("Backend 06 compensates only binding sets created before a shadow failure", async () => {
  const current = new Set<string>(["preexisting"]);
  const compensated: string[] = [];
  await assert.rejects(() => runSignalGovernedBindingPhaseWithCompensationV1({
    views: ["preexisting","category","all-governed"] as const,
    async promote(view) {
      current.add(view);
      return { created_by_invocation: view !== "preexisting",result: view };
    },
    async shadow() { throw new Error("forced shadow failure"); },
    async compensate(view) { current.delete(view);compensated.push(view); }
  }),/forced shadow failure/iu);
  assert.deepEqual(compensated,["all-governed","category"]);
  assert.deepEqual([...current],["preexisting"]);
});

test("Backend 06 compensates bindings when a post-shadow invariant fails", async () => {
  const current = new Set<string>();
  await assert.rejects(() => runSignalGovernedBindingPhaseWithCompensationV1({
    views: ["competition","category"] as const,
    async promote(view) { current.add(view);return { created_by_invocation: true,result: view }; },
    async shadow() { return { gate_passed: true }; },
    async postcondition() { throw new Error("protected-state drift"); },
    async compensate(view) { current.delete(view); }
  }),/protected-state drift/iu);
  assert.equal(current.size,0);
});
