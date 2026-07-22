import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("SB-02 migration establishes stable Signal workspace identity and governed corpus scope", async () => {
  const migration = await readFile(resolve(process.cwd(), "migrations/0047_signal_workspace_identity.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS signal_workspaces/);
  assert.match(migration, /signal_workspaces_exactly_one_subject/);
  assert.match(migration, /uq_signal_workspaces_org_slug/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS signal_workspace_corpora/);
  assert.match(migration, /'operational', 'strategic', 'legacy'/);
  assert.match(migration, /uq_signal_workspace_corpora_active/);
  assert.match(migration, /enforce_signal_workspace_subject_organization/);
  assert.match(migration, /enforce_signal_workspace_corpus_scope/);
});

test("SB-02 backfill is dry-run by default, remote guarded, redacted and idempotent", async () => {
  const script = await readFile(resolve(process.cwd(), "../../apps/studio/scripts/backfill-signal-workspaces.ts"), "utf8");
  assert.match(script, /NOISIA_SIGNAL_WORKSPACE_BACKFILL_ALLOW_REMOTE/);
  assert.match(script, /requireSafeDatabaseReadTarget/);
  assert.match(script, /requireSafeDatabaseWriteTarget/);
  assert.match(script, /ON CONFLICT DO NOTHING/);
  assert.match(script, /identifiers_redacted: true/);
  assert.match(script, /sw\.organization_id = ec\.organization_id/);
});

