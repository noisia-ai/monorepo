import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("./migrations/0166_signal_brand_context_source_authority_digest.sql", import.meta.url),
  "utf8",
);

test("0166 preserves source authority while hashing knowledge members linearly", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION signal_brand_context_processing_source_current_v1\(target_generation uuid\)/u);
  assert.match(sql, /profile\.id IS DISTINCT FROM generation\.brand_os_profile_id/u);
  assert.match(sql, /profile\.version IS DISTINCT FROM generation\.brand_os_profile_version/u);
  assert.match(sql, /profile\.metadata->>'snapshot_hash' IS DISTINCT FROM generation\.brand_os_digest/u);
  assert.match(sql, /profile\.metadata->'countries' IS DISTINCT FROM to_jsonb\(brand\.countries\)/u);
  assert.match(sql, /signal_semantic_context_digest_json_v2\(brand_snapshot\) IS DISTINCT FROM generation\.brand_os_digest/u);
  assert.match(sql, /string_agg\('\{"digest":"'/u);
  assert.match(sql, /string_agg\('\{"content_digest":"sha256:'/u);
  assert.match(sql, /current_knowledge:=signal_semantic_context_digest_v1/u);
  assert.doesNotMatch(sql, /jsonb_agg\(jsonb_build_object\('id',source\.id::text,'kind'/u);
  assert.match(sql, /status IN\('current','draft'\)/u);
  assert.match(sql, /current_locale_digest IS DISTINCT FROM generation\.locale_context_digest/u);
  assert.match(sql, /current_knowledge=generation\.knowledge_digest/u);
  assert.match(sql, /workspace_authority_digest INTO artifact_digest/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION signal_brand_context_processing_source_current_v1\(uuid\) FROM PUBLIC/u);
  assert.match(sql, /ARRAY\['anon','authenticated'\]/u);
});
