import assert from "node:assert/strict";
import test from "node:test";
import { createBrandSchema, updateBrandSchema } from "./brand";
import { validationError } from "../api/responses";

const input = { organization_id: "10000000-0000-4000-8000-000000000001", name: "Synthetic Brand",
  slug: "synthetic-brand", timezone: "America/Mexico_City" };

test("Brand OS create and update reject malformed or unassigned countries with 422", async () => {
  for (const schema of [createBrandSchema, updateBrandSchema]) {
    for (const country of ["1X", "12", "M-", "419", "éX", "ZZ", "XX"]) {
      const parsed = schema.safeParse({ ...input, countries: [country] });
      assert.equal(parsed.success, false, country);
      if (parsed.success) assert.fail("invalid country was accepted");
      assert.equal(validationError(parsed.error).status, 422);
      assert.ok(parsed.error.issues.some(issue => issue.path.join(".") === "countries.0"));
    }
  }
});

test("Brand OS accepts ISO alpha-2 codes and keeps lowercase input normalization", () => {
  for (const schema of [createBrandSchema, updateBrandSchema]) {
    const parsed = schema.parse({ ...input, countries: ["mx", "JP", "br", "US", "GB", "PR"] });
    assert.deepEqual(parsed.countries, ["MX", "JP", "BR", "US", "GB", "PR"]);
  }
});
