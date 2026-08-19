import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";

const execFileAsync = promisify(execFile);
const DATABASE_URL_ENV = "NOISIA_SIGNAL_BACKFILL_INTEGRATION_URL";
const APPROVAL_ENV = "NOISIA_SIGNAL_BACKFILL_INTEGRATION_APPROVED";
const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(dbRoot, "migrations");
const runner = join(dbRoot, "scripts", "apply-signal-workspace-data-plane-migration.ts");
const backfill = join(dbRoot, "scripts", "backfill-signal-workspace-data-plane.ts");

const IDS = {
  orgA: "71000000-0000-4000-8000-000000000001",
  orgB: "71000000-0000-4000-8000-000000000002",
  userA: "71000000-0000-4000-8000-000000000101",
  userB: "71000000-0000-4000-8000-000000000102",
  brandA: "71000000-0000-4000-8000-000000000201",
  brandB: "71000000-0000-4000-8000-000000000202",
  methodology: "71000000-0000-4000-8000-000000000301",
  corpusA: "71000000-0000-4000-8000-000000000401",
  corpusA2: "71000000-0000-4000-8000-000000000403",
  corpusB: "71000000-0000-4000-8000-000000000402",
  sourceA: "71000000-0000-4000-8000-000000000501",
  sourceA2: "71000000-0000-4000-8000-000000000503",
  sourceB: "71000000-0000-4000-8000-000000000502",
  batchA1: "71000000-0000-4000-8000-000000000601",
  batchA2: "71000000-0000-4000-8000-000000000602",
  batchB: "71000000-0000-4000-8000-000000000603",
  mentionA1: "71000000-0000-4000-8000-000000000701",
  mentionA2: "71000000-0000-4000-8000-000000000702",
  mentionB: "71000000-0000-4000-8000-000000000703"
} as const;

type BackfillResult = {
  ok: boolean;
  writes_performed: boolean;
  content_changed: boolean;
  unresolved_count: number;
  selection: { kind: string; brand_slug?: string };
  affected_workspaces: Array<{ workspace_key: string; brand_slug: string }>;
  before: BackfillSummary;
  after: BackfillSummary;
};

type BackfillSummary = {
  canonical_roots: number;
  aliases: number;
  import_memberships: number;
  attributions: number;
  active_operational_memberships: number;
  content_hashes: {
    aggregate: string;
    domains: Record<string, { row_count: number; digest: string }>;
    by_workspace: Array<{ aggregate: string; domains: Record<string, { row_count: number; digest: string }> }>;
  };
};

function integrationUrl() {
  const value = process.env[DATABASE_URL_ENV]?.trim();
  if (!value || process.env[APPROVAL_ENV] !== "true") return null;
  const parsed = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /(backfill|runner|smoke|throwaway)/u);
  return value;
}

function targetFingerprint(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const identity = [
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//, ""),
    parsed.username
  ].join("|");
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}

async function runBackfill(
  databaseUrl: string,
  mode: "dry-run" | "apply" | "verify" | "analyze",
  options: { brandSlug?: string; allWorkspaces?: boolean; env?: NodeJS.ProcessEnv } = {}
) {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", backfill], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_MODE: mode,
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_BRAND_SLUG: options.brandSlug ?? "",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_WORKSPACE_ID: "",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES:
        options.allWorkspaces ? "true" : "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES_APPROVED:
        options.allWorkspaces ? "true" : "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_APPROVED:
        mode === "apply" ? "true" : "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ANALYZE_APPROVED:
        mode === "analyze" ? "true" : "false",
      ...options.env
    },
    maxBuffer: 8 * 1024 * 1024
  });
  return JSON.parse(result.stdout) as BackfillResult;
}

async function resetThrough0058(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= 58)
      .sort();
    for (const file of files) {
      await client.query(await readFile(join(migrationDir, file), "utf8"));
    }
  } finally {
    await client.end();
  }
}

async function seedFixture(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO organizations (id, slug, legal_name, display_name, status) VALUES
        ('${IDS.orgA}', 'backfill-org-a', 'Backfill Org A', 'Backfill Org A', 'active'),
        ('${IDS.orgB}', 'backfill-org-b', 'Backfill Org B', 'Backfill Org B', 'active');
      INSERT INTO users (id, email, full_name, user_type, primary_role, organization_id, status) VALUES
        ('${IDS.userA}', 'backfill-a@example.test', 'Backfill A', 'client', 'brand_manager', '${IDS.orgA}', 'active'),
        ('${IDS.userB}', 'backfill-b@example.test', 'Backfill B', 'client', 'brand_manager', '${IDS.orgB}', 'active');
      INSERT INTO brands (id, organization_id, slug, name, display_name, countries, status) VALUES
        ('${IDS.brandA}', '${IDS.orgA}', 'backfill-brand-a', 'Backfill Brand A', 'Backfill Brand A', ARRAY['MX']::char(2)[], 'active'),
        ('${IDS.brandB}', '${IDS.orgB}', 'backfill-brand-b', 'Backfill Brand B', 'Backfill Brand B', ARRAY['MX']::char(2)[], 'active');
      INSERT INTO methodologies (id, slug, name, version, status, manifest_yaml) VALUES
        ('${IDS.methodology}', 'backfill-methodology', 'Backfill methodology', '1.0.0', 'active', '{}'::jsonb);
      INSERT INTO study_corpora (
        id, name, brand_id, methodology_id, methodology_version_at_creation,
        business_question, decision_to_inform, status
      ) VALUES
        ('${IDS.corpusA}', 'Backfill A', '${IDS.brandA}', '${IDS.methodology}', '1.0.0', 'Question A', 'Decision A', 'corpus_approved'),
        ('${IDS.corpusA2}', 'Backfill A alias', '${IDS.brandA}', '${IDS.methodology}', '1.0.0', 'Question A2', 'Decision A2', 'corpus_approved'),
        ('${IDS.corpusB}', 'Backfill B', '${IDS.brandB}', '${IDS.methodology}', '1.0.0', 'Question B', 'Decision B', 'corpus_approved');
      INSERT INTO data_sources (
        id, study_corpus_id, organization_id, brand_id, source_type, provider,
        connection_method, name, role, status
      ) VALUES
        ('${IDS.sourceA}', '${IDS.corpusA}', '${IDS.orgA}', '${IDS.brandA}', 'social-listening', 'fixture', 'csv', 'Source A', '{"scope":"primary_brand"}', 'active'),
        ('${IDS.sourceA2}', '${IDS.corpusA2}', '${IDS.orgA}', '${IDS.brandA}', 'social-listening', 'fixture', 'csv', 'Source A2', '{"scope":"primary_brand"}', 'active'),
        ('${IDS.sourceB}', '${IDS.corpusB}', '${IDS.orgB}', '${IDS.brandB}', 'social-listening', 'fixture', 'csv', 'Source B', '{"scope":"primary_brand"}', 'active');
      INSERT INTO import_batches (
        id, study_corpus_id, mention_type, entity_kind, entity_label,
        source_system, imported_by_user_id, status
      ) VALUES
        ('${IDS.batchA1}', '${IDS.corpusA}', 'brand', 'primary_brand', 'Backfill Brand A', 'fixture', '${IDS.userA}', 'completed'),
        ('${IDS.batchA2}', '${IDS.corpusA2}', 'brand', 'primary_brand', 'Backfill Brand A', 'fixture', '${IDS.userA}', 'completed'),
        ('${IDS.batchB}', '${IDS.corpusB}', 'brand', 'primary_brand', 'Backfill Brand B', 'fixture', '${IDS.userB}', 'completed');
    `);
    const mentions = [
      [IDS.mentionA1, IDS.corpusA, IDS.batchA1, "backfill-a-1", "a".repeat(64)],
      [IDS.mentionA2, IDS.corpusA2, IDS.batchA2, "backfill-a-2", "a".repeat(64)],
      [IDS.mentionB, IDS.corpusB, IDS.batchB, "backfill-b-1", "b".repeat(64)]
    ];
    for (const row of mentions) {
      await client.query(`
        INSERT INTO mentions (
          id, study_corpus_id, external_id, source_system, source_file_id,
          text_hash, text_clean, text_snippet, text_length, language,
          published_at, platform, resolved_platform, quality_score, inclusion_status
        ) VALUES (
          $1::uuid, $2::uuid, $4, 'fixture', $3::uuid,
          $5, 'Deterministic backfill mention with enough governed text',
          'Deterministic backfill mention', 55, 'es',
          '2026-01-01T00:00:00Z'::timestamptz, 'x', 'x', 8, 'included'
        )
      `, row);
    }
  } finally {
    await client.end();
  }
}

async function applyRunner(databaseUrl: string) {
  await execFileAsync(process.execPath, ["--import", "tsx", runner], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE: "apply",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_SCHEMA_APPLY_APPROVED: "true"
    },
    maxBuffer: 8 * 1024 * 1024
  });
}

test("backfill selection is mandatory and all-workspace mode is explicit", async () => {
  await assert.rejects(
    runBackfill("postgres://postgres:postgres@localhost:1/backfill_throwaway", "dry-run"),
    /Select exactly one scope/u
  );
  await assert.rejects(
    runBackfill("postgres://postgres:postgres@localhost:1/backfill_throwaway", "analyze", {
      brandSlug: "backfill-brand-a"
    }),
    /analyze is clone-wide/u
  );
  await assert.rejects(
    runBackfill("postgres://postgres:postgres@localhost:1/backfill_throwaway", "dry-run", {
      brandSlug: "backfill-brand-a",
      env: {
        NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES_APPROVED: "true"
      }
    }),
    /ALL_WORKSPACES_APPROVED=true is only valid/u
  );
});

test("remote apply and analyze require independent fingerprint, isolation, restore and approval", async () => {
  const databaseUrl = "postgres://backfill:placeholder@example.invalid/preview_clone";
  const base = {
    NOISIA_REMOTE_DATABASE_TARGET: "preview",
    NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALLOW_REMOTE: "true",
    NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ISOLATED_TARGET_CONFIRMED: "true",
    NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_TARGET_FINGERPRINT:
      targetFingerprint(databaseUrl),
    NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_REFERENCE: "restore-point-123",
    NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_VERIFIED: "true"
  };
  await assert.rejects(
    runBackfill(databaseUrl, "apply", {
      brandSlug: "laika",
      env: { ...base, NOISIA_REMOTE_DATABASE_TARGET: "" }
    }),
    /requires a real preview or staging target/u
  );
  await assert.rejects(
    runBackfill(databaseUrl, "apply", {
      brandSlug: "laika",
      env: { ...base, NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_APPROVED: "false" }
    }),
    /BACKFILL_APPROVED=true/u
  );
  await assert.rejects(
    runBackfill(databaseUrl, "apply", {
      brandSlug: "laika",
      env: {
        ...base,
        NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ISOLATED_TARGET_CONFIRMED: "false"
      }
    }),
    /BACKFILL_ISOLATED_TARGET_CONFIRMED=true/u
  );
  await assert.rejects(
    runBackfill(databaseUrl, "apply", {
      brandSlug: "laika",
      env: {
        ...base,
        NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_TARGET_FINGERPRINT:
          targetFingerprint(databaseUrl),
        NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_TARGET_FINGERPRINT: ""
      }
    }),
    /BACKFILL_TARGET_FINGERPRINT must match/u
  );
  await assert.rejects(
    runBackfill(databaseUrl, "apply", {
      brandSlug: "laika",
      env: { ...base, NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_REFERENCE: "" }
    }),
    /BACKFILL_RESTORE_REFERENCE must identify/u
  );
  await assert.rejects(
    runBackfill(databaseUrl, "apply", {
      brandSlug: "laika",
      env: { ...base, NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_VERIFIED: "false" }
    }),
    /BACKFILL_RESTORE_VERIFIED=true/u
  );
  await assert.rejects(
    runBackfill(databaseUrl, "analyze", {
      allWorkspaces: true,
      env: { ...base, NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ANALYZE_APPROVED: "false" }
    }),
    /ANALYZE_APPROVED=true/u
  );
});

test("selected backfill hashes governed content and is content-idempotent", async (t) => {
  const databaseUrl = integrationUrl();
  if (!databaseUrl) {
    t.skip(`Set ${DATABASE_URL_ENV} and ${APPROVAL_ENV}=true for disposable Postgres integration.`);
    return;
  }
  await resetThrough0058(databaseUrl);
  await seedFixture(databaseUrl);
  await applyRunner(databaseUrl);

  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query(`
      DELETE FROM signal_population_memberships;
      DELETE FROM signal_mention_attributions;
      DELETE FROM signal_mention_study_memberships;
      DELETE FROM signal_mention_import_memberships;
    `);
  } finally {
    await client.end();
  }

  const first = await runBackfill(databaseUrl, "apply", { brandSlug: "backfill-brand-a" });
  const second = await runBackfill(databaseUrl, "apply", { brandSlug: "backfill-brand-a" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.writes_performed, true);
  assert.equal(second.writes_performed, true);
  assert.equal(first.unresolved_count, 0);
  assert.equal(second.unresolved_count, 0);
  assert.equal(first.selection.kind, "brand_slug");
  assert.equal(first.selection.brand_slug, "backfill-brand-a");
  assert.equal(first.affected_workspaces.length, 1);
  assert.equal(first.after.canonical_roots, 1);
  assert.equal(first.after.aliases, 1);
  assert.equal(first.after.content_hashes.domains.canonical_roots?.row_count, 1);
  assert.equal(first.after.content_hashes.domains.canonical_aliases?.row_count, 1);
  assert.equal(first.after.content_hashes.domains.import_provenance?.row_count, 2);
  assert.equal(first.after.content_hashes.domains.attributions?.row_count, 2);
  assert.equal(first.after.content_hashes.domains.operational_population_memberships?.row_count, 1);
  assert.equal(first.after.content_hashes.domains.current_population_pointers?.row_count, 1);
  assert.equal(second.content_changed, false);
  assert.equal(first.after.content_hashes.aggregate, second.after.content_hashes.aggregate);
  assert.deepEqual(first.after.content_hashes.domains, second.after.content_hashes.domains);

  const allWorkspaceEvidence = await runBackfill(databaseUrl, "dry-run", {
    allWorkspaces: true
  });
  assert.equal(allWorkspaceEvidence.selection.kind, "all_workspaces");
  assert.equal(allWorkspaceEvidence.writes_performed, false);
  assert.equal(allWorkspaceEvidence.affected_workspaces.length, 2);
  assert.equal(allWorkspaceEvidence.after.content_hashes.by_workspace.length, 2);

  const verifyClient = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await verifyClient.connect();
  try {
    const brandB = await verifyClient.query<{ import_memberships: number; attributions: number }>(`
      SELECT
        (SELECT count(*)::int FROM signal_mention_import_memberships membership
         JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
         WHERE workspace.brand_id = $1::uuid) AS import_memberships,
        (SELECT count(*)::int FROM signal_mention_attributions attribution
         JOIN signal_workspaces workspace ON workspace.id = attribution.workspace_id
         WHERE workspace.brand_id = $1::uuid) AS attributions
    `, [IDS.brandB]);
    assert.deepEqual(brandB.rows[0], { import_memberships: 0, attributions: 0 });
    await verifyClient.query(`
      UPDATE signal_mention_attributions attribution
      SET entity_label = 'Semantically changed without changing row counts'
      FROM signal_workspaces workspace
      WHERE workspace.id = attribution.workspace_id
        AND workspace.brand_id = $1::uuid
    `, [IDS.brandA]);
  } finally {
    await verifyClient.end();
  }
  const changed = await runBackfill(databaseUrl, "verify", { brandSlug: "backfill-brand-a" });
  assert.equal(changed.writes_performed, false);
  assert.equal(changed.after.attributions, second.after.attributions);
  assert.notEqual(
    changed.after.content_hashes.domains.attributions?.digest,
    second.after.content_hashes.domains.attributions?.digest
  );
  assert.notEqual(changed.after.content_hashes.aggregate, second.after.content_hashes.aggregate);
});
