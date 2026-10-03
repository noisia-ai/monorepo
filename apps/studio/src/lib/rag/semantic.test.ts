import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const { buildSignalSemanticContextSql } = await import("./semantic");

test("Signal chat semantic retrieval prefers live published evidence and baseline corpus scope", () => {
  const sql = buildSignalSemanticContextSql({ liveStore: true });

  assert.match(sql, /LEFT JOIN tb_analyses/);
  assert.match(sql, /sc\.base_corpus_id/);
  assert.match(sql, /array_remove\(ARRAY\[os\.study_corpus_id, os\.base_corpus_id\]/);
  assert.match(sql, /signal_observations so/);
  assert.match(sql, /so\.published_output_id = os\.output_id/);
  assert.match(sql, /corpus_snapshot_mentions/);
});

test("Signal chat semantic fallback keeps old T&B snapshot path when live schema is absent", () => {
  const sql = buildSignalSemanticContextSql({ liveStore: false });

  assert.match(sql, /LEFT JOIN tb_analyses/);
  assert.match(sql, /sc\.base_corpus_id/);
  assert.doesNotMatch(sql, /signal_observations so/);
  assert.match(sql, /corpus_snapshot_mentions/);
});
