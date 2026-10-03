import assert from "node:assert/strict";
import test from "node:test";

import { resolveMarketCurrency } from "./source-market-currency";

test("resolves a single study market to its canonical currency", () => {
  assert.deepEqual(resolveMarketCurrency(["BO"]), {
    currencyCode: "BOB",
    status: "resolved",
    marketCodes: ["BO"],
    unmappedMarketCodes: []
  });
  assert.equal(resolveMarketCurrency(["MX"]).currencyCode, "MXN");
});

test("resolves multi-market studies only when they share one currency", () => {
  assert.deepEqual(resolveMarketCurrency(["EC", "US"]), {
    currencyCode: "USD",
    status: "resolved",
    marketCodes: ["EC", "US"],
    unmappedMarketCodes: []
  });
});

test("does not invent one currency for markets with different currencies", () => {
  const resolution = resolveMarketCurrency(["MX", "US"]);
  assert.equal(resolution.currencyCode, null);
  assert.equal(resolution.status, "ambiguous_market");
});

test("keeps unsupported and absent markets explicit", () => {
  assert.equal(resolveMarketCurrency([]).status, "missing_market");
  assert.deepEqual(resolveMarketCurrency(["AQ"]).unmappedMarketCodes, ["AQ"]);
  assert.equal(resolveMarketCurrency(["AQ"]).status, "unsupported_market");
});
