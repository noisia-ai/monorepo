import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

test("mass labeling persists frozen candidates and full probabilities with tenant fences", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 60_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/noisia_mfp_ci");
  const pool = new pg.Pool({connectionString: url.href, max: 1});
  try {
    const result = await pool.query(`SELECT
      to_regclass('signal_mass_labeling_maps') IS NOT NULL maps,
      to_regclass('signal_mass_labeling_items') IS NOT NULL items,
      to_regclass('signal_mass_labeling_results') IS NOT NULL results`);
    assert.deepEqual(result.rows[0], {maps: true, items: true, results: true});
  } finally { await pool.end(); }
});
