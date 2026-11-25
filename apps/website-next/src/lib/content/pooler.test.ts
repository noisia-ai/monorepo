import assert from "node:assert/strict";
import { test } from "node:test";
import { poolerBusy } from "./pooler";

test("poolerBusy spots a full pooler and nothing else", () => {
  assert.equal(poolerBusy({ code: "XX000", message: "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15" }), true);
  assert.equal(poolerBusy({ code: "53300", message: "sorry, too many clients already" }), true);
  assert.equal(poolerBusy({ code: "42P01", message: 'relation "content.x" does not exist' }), false);
  assert.equal(poolerBusy(new Error("Connection terminated unexpectedly")), false);
  assert.equal(poolerBusy(undefined), false);
});
