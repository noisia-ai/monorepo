import assert from "node:assert/strict";
import test from "node:test";

import { queryPackHasData, queryPackHasDirectCsv } from "./query-pack-readiness";

test("query pack readiness accepts provenance/fanout mention counts", () => {
  assert.equal(
    queryPackHasData({ id: "pack-vpm-category", status: "planned", mentionsReturned: 12 }, []),
    true
  );
  assert.equal(
    queryPackHasData({ id: "pack-vpm-category", status: "planned", mentionsReturned: 0, linkedMentionCount: 9 }, []),
    true
  );
});

test("query pack readiness accepts imported packs without a direct batch", () => {
  assert.equal(
    queryPackHasData({ id: "pack-narrative-brand", status: "imported", mentionsReturned: null }, []),
    true
  );
});

test("query pack readiness rejects completed CSVs with no included mentions", () => {
  assert.equal(
    queryPackHasData(
      { id: "pack-trust-risk", status: "planned", mentionsReturned: 0 },
      [{ queryPackId: "pack-trust-risk", status: "completed", includedCount: 0 }]
    ),
    false
  );
});

test("query pack readiness accepts a completed direct batch with included mentions", () => {
  assert.equal(
    queryPackHasData(
      { id: "pack-jfm", status: "planned", mentionsReturned: null },
      [{ queryPackId: "pack-jfm", status: "completed", includedCount: 7 }]
    ),
    true
  );
});

test("direct CSV readiness is stricter than shared provenance/fanout", () => {
  const pack = { id: "pack-narrative-brand", status: "imported", linkedMentionCount: 30 };

  assert.equal(queryPackHasData(pack, []), true);
  assert.equal(queryPackHasDirectCsv(pack, []), false);
  assert.equal(
    queryPackHasDirectCsv(pack, [{ queryPackId: "pack-narrative-brand", status: "completed", includedCount: 30 }]),
    true
  );
});
