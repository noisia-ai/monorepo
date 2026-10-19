import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./0167_signal_mentions_text_digest.sql", import.meta.url), "utf8");
const prepare = readFileSync(new URL("./0168_signal_mentions_text_digest_finalize.sql", import.meta.url), "utf8");
const finalize = readFileSync(new URL("./0169_signal_mentions_text_digest_validate.sql", import.meta.url), "utf8");
const serving = readFileSync(new URL("../signal-workspace-topics-serving.ts", import.meta.url), "utf8");

test("0167 installs exact maintenance and a bounded restartable backfill", () => {
  assert.match(migration, /ALTER TABLE mentions ADD COLUMN text_clean_sha256 text/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON mentions/u);
  assert.match(migration, /ELSIF NEW\.text_clean IS DISTINCT FROM OLD\.text_clean[\s\S]*NEW\.text_clean_sha256 IS NULL[\s\S]*NEW\.text_clean_sha256 IS DISTINCT FROM OLD\.text_clean_sha256/u);
  assert.match(migration, /NEW\.text_clean_sha256 := 'sha256:'\|\|encode\(sha256\(convert_to\(NEW\.text_clean,'UTF8'\)\),'hex'\)/u);
  assert.ok(migration.indexOf("CREATE TRIGGER trg_signal_mention_text_clean_sha256")
    < migration.indexOf("ADD CONSTRAINT mentions_text_clean_sha256_exact"));
  assert.match(migration, /ADD CONSTRAINT mentions_text_clean_sha256_exact CHECK\([\s\S]*text_clean_sha256 IS NULL[\s\S]*\) NOT VALID/u);
  assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX/u);
  assert.match(migration, /CREATE TABLE signal_mention_text_digest_backfill_state/u);
  assert.match(migration, /REVOKE ALL ON signal_mention_text_digest_backfill_state FROM PUBLIC/u);
  assert.match(migration, /CREATE FUNCTION backfill_signal_mention_text_clean_sha256_v1\(p_limit integer DEFAULT 1000\)/u);
  assert.match(migration, /SELECT last_id INTO cursor_id FROM signal_mention_text_digest_backfill_state[\s\S]*FOR UPDATE/u);
  assert.match(migration, /id>cursor_id[\s\S]*ORDER BY id LIMIT p_limit/u);
  assert.match(migration, /IF NOT EXISTS\(SELECT 1 FROM mentions WHERE text_clean_sha256 IS NULL\)[\s\S]*RETURN 0/u);
  assert.match(migration, /cursor_id:=NULL;[\s\S]*SET last_id=NULL/u);
  assert.doesNotMatch(migration, /SKIP LOCKED/u);
  assert.match(migration, /p_limit<1 OR p_limit>10000/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION backfill_signal_mention_text_clean_sha256_v1\(integer\) FROM PUBLIC/u);
  assert.match(migration, /FROM anon/u);
  assert.match(migration, /FROM authenticated/u);
  assert.doesNotMatch(migration, /UPDATE mentions SET text_clean_sha256/u);
  assert.doesNotMatch(migration, /UPDATE mentions SET text_hash/u);
});

test("0168 refuses an incomplete backfill and only installs the unvalidated presence guard", () => {
  assert.match(prepare, /signal_mentions_text_digest_backfill_incomplete/u);
  assert.match(prepare, /ADD CONSTRAINT mentions_text_clean_sha256_present[\s\S]*NOT VALID/u);
  assert.doesNotMatch(prepare, /VALIDATE CONSTRAINT|ALTER COLUMN text_clean_sha256 SET NOT NULL|DROP FUNCTION/u);
});

test("0169 validates before taking the brief NOT NULL metadata lock and removes operational state", () => {
  assert.match(finalize, /VALIDATE CONSTRAINT mentions_text_clean_sha256_exact/u);
  assert.match(finalize, /VALIDATE CONSTRAINT mentions_text_clean_sha256_present/u);
  assert.ok(finalize.indexOf("VALIDATE CONSTRAINT mentions_text_clean_sha256_present")
    < finalize.indexOf("ALTER COLUMN text_clean_sha256 SET NOT NULL"));
  assert.match(finalize, /DROP FUNCTION backfill_signal_mention_text_clean_sha256_v1\(integer\)/u);
  assert.match(finalize, /DROP TABLE signal_mention_text_digest_backfill_state/u);
});

test("native mentions compares the current persisted digest with the immutable preparation manifest", () => {
  const population = serving.slice(serving.indexOf("const mentionsPopulationSql"), serving.indexOf("type MentionsSummary"));
  assert.match(population, /prepared\.asset_sha256=mention\.text_clean_sha256/u);
  assert.doesNotMatch(population, /sha256\(convert_to\(mention\.text_clean/u);
  assert.match(population, /prepared\.run_id=generation\.preparation_run_id/u);
  assert.doesNotMatch(serving, /prepared\.asset_sha256='sha256:'\|\|encode\(sha256\(convert_to\(mention\.text_clean/u);
});
