import assert from "node:assert/strict";
import test from "node:test";
import { mfpFacetTerminalReceipt, type MfpFacetRunObservation } from "./mfp-facet-receipt";
import { createMfpResourceReader } from "./mfp-resource-read";

test("facet completion refreshes dependent GET populations once, preserving the paid intent", async () => {
  const workspace = "synthetic-workspace", requests: string[] = [];
  const paidIntent = Object.freeze({ full_recalculation: false, idempotency_key: "original-paid-key" });
  const original = JSON.stringify(paidIntent);
  const read = createMfpResourceReader(async (endpoint, options) => {
    assert.equal(options.method, "GET"); requests.push(endpoint);
    return Response.json({ completed_roots: 901, relevant: 571 });
  });
  let previous: MfpFacetRunObservation | null = null;
  const poll = async (next: MfpFacetRunObservation) => {
    const receipt = mfpFacetTerminalReceipt(previous, next); previous = next;
    if (!receipt) return;
    await Promise.all([read(`/api/data-os/signal/${workspace}/facets?view=mentions`),
      read(`/api/data-os/signal/${workspace}/memberships?concept_key=saved-topic`),
      read(`/api/data-os/signal/${workspace}/topics/analysis`)]);
  };
  await poll({ workspace_id: workspace, id: "run-1", status: "running" });
  await poll({ workspace_id: workspace, id: "run-1", status: "running" });
  assert.equal(requests.length, 0);
  await poll({ workspace_id: workspace, id: "run-1", status: "completed" });
  assert.equal(requests.length, 3);
  await poll({ workspace_id: workspace, id: "run-1", status: "completed" });
  assert.equal(requests.length, 3, "repeated terminal polling does not reload or duplicate a command");
  await poll({ workspace_id: "other-workspace", id: "run-2", status: "completed" });
  assert.equal(requests.length, 3, "a workspace transition is not a receipt for the prior workspace");
  assert.equal(JSON.stringify(paidIntent), original);
});

test("initial terminal state needs no duplicate refresh; quick successor and failure still refresh", () => {
  const completed = { workspace_id: "workspace", id: "old", status: "completed" };
  assert.equal(mfpFacetTerminalReceipt(null, completed), null);
  assert.equal(mfpFacetTerminalReceipt(completed, { ...completed, id: "quick-successor" }), "workspace:quick-successor:completed");
  assert.equal(mfpFacetTerminalReceipt({ ...completed, status: "running" }, { ...completed, status: "failed" }), "workspace:old:failed");
  assert.equal(mfpFacetTerminalReceipt(completed, null), null);
});
