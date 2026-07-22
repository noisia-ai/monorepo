import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_WORKSPACE_BACKFILL_ALLOW_REMOTE";

function loadEnvironment() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repoDir = resolve(appDir, "../..");
  for (const path of [resolve(appDir, ".env.local"), resolve(repoDir, ".env.local")]) {
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
      const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
      const key = match?.[1];
      const rawValue = match?.[2]?.trim();
      if (!key || rawValue === undefined || process.env[key] !== undefined) continue;
      process.env[key] = (
        (rawValue.startsWith('"') && rawValue.endsWith('"'))
        || (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) ? rawValue.slice(1, -1) : rawValue;
    }
  }
}

function isApplyMode() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
  return args.includes("--apply");
}

const eligibleCorporaCte = `
  WITH eligible_corpora AS (
    SELECT
      sc.id AS study_corpus_id,
      sc.brand_id,
      sc.theme_id,
      COALESCE(b.organization_id, t.organization_id) AS organization_id,
      CASE
        WHEN sc.brand_id IS NOT NULL AND (
          EXISTS (
            SELECT 1 FROM themes slug_peer
            WHERE slug_peer.organization_id = b.organization_id
              AND slug_peer.slug = b.slug
          )
          OR EXISTS (
            SELECT 1 FROM signal_workspaces slug_peer
            WHERE slug_peer.organization_id = b.organization_id
              AND slug_peer.slug = b.slug
              AND slug_peer.brand_id IS DISTINCT FROM sc.brand_id
          )
        ) THEN b.slug || '-brand'
        WHEN sc.theme_id IS NOT NULL AND (
          EXISTS (
            SELECT 1 FROM brands slug_peer
            WHERE slug_peer.organization_id = t.organization_id
              AND slug_peer.slug = t.slug
          )
          OR EXISTS (
            SELECT 1 FROM signal_workspaces slug_peer
            WHERE slug_peer.organization_id = t.organization_id
              AND slug_peer.slug = t.slug
              AND slug_peer.theme_id IS DISTINCT FROM sc.theme_id
          )
        ) THEN t.slug || '-theme'
        ELSE COALESCE(b.slug, t.slug)
      END AS subject_slug,
      m.slug AS methodology_slug,
      EXISTS (
        SELECT 1 FROM published_outputs po WHERE po.study_corpus_id = sc.id
      ) AS has_published_output
    FROM study_corpora sc
    JOIN methodologies m ON m.id = sc.methodology_id
    LEFT JOIN brands b ON b.id = sc.brand_id
    LEFT JOIN themes t ON t.id = sc.theme_id
    WHERE COALESCE(b.organization_id, t.organization_id) IS NOT NULL
      AND (
        (sc.brand_id IS NOT NULL AND b.organization_id IS NOT NULL)
        OR (sc.theme_id IS NOT NULL AND t.organization_id IS NOT NULL)
      )
  )
`;

async function summarize(pool: import("pg").Pool) {
  const result = await pool.query<{
    eligible_corpora: number;
    distinct_subjects: number;
    workspaces_missing: number;
    memberships_missing: number;
  }>(`${eligibleCorporaCte}
    SELECT
      COUNT(*)::int AS eligible_corpora,
      COUNT(DISTINCT (organization_id, brand_id, theme_id))::int AS distinct_subjects,
      COUNT(DISTINCT (organization_id, brand_id, theme_id)) FILTER (WHERE sw.id IS NULL)::int AS workspaces_missing,
      COUNT(*) FILTER (WHERE swc.id IS NULL)::int AS memberships_missing
    FROM eligible_corpora ec
    LEFT JOIN signal_workspaces sw
      ON sw.organization_id = ec.organization_id
     AND sw.brand_id IS NOT DISTINCT FROM ec.brand_id
     AND sw.theme_id IS NOT DISTINCT FROM ec.theme_id
    LEFT JOIN signal_workspace_corpora swc
      ON swc.workspace_id = sw.id
     AND swc.study_corpus_id = ec.study_corpus_id
     AND swc.valid_to IS NULL
  `);
  return result.rows[0] ?? {
    eligible_corpora: 0,
    distinct_subjects: 0,
    workspaces_missing: 0,
    memberships_missing: 0
  };
}

async function applyBackfill(pool: import("pg").Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaces = await client.query(`${eligibleCorporaCte}
      INSERT INTO signal_workspaces (
        organization_id, brand_id, theme_id, slug, timezone, status, metadata
      )
      SELECT DISTINCT ON (organization_id, brand_id, theme_id)
        organization_id,
        brand_id,
        theme_id,
        subject_slug,
        'America/Mexico_City',
        'active',
        '{"backfill":"signal-workspace-v1"}'::jsonb
      FROM eligible_corpora
      ORDER BY organization_id, brand_id, theme_id, subject_slug
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const memberships = await client.query(`${eligibleCorporaCte}
      INSERT INTO signal_workspace_corpora (
        workspace_id, study_corpus_id, role, metadata
      )
      SELECT
        sw.id,
        ec.study_corpus_id,
        CASE
          WHEN ec.methodology_slug = 'signal-pulse' THEN 'operational'
          WHEN ec.methodology_slug = 'triggers-barriers' THEN 'strategic'
          ELSE 'legacy'
        END,
        jsonb_build_object(
          'backfill', 'signal-workspace-v1',
          'published_output_seen', ec.has_published_output
        )
      FROM eligible_corpora ec
      JOIN signal_workspaces sw
        ON sw.organization_id = ec.organization_id
       AND sw.brand_id IS NOT DISTINCT FROM ec.brand_id
       AND sw.theme_id IS NOT DISTINCT FROM ec.theme_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM signal_workspace_corpora current_membership
        WHERE current_membership.workspace_id = sw.id
          AND current_membership.study_corpus_id = ec.study_corpus_id
          AND current_membership.valid_to IS NULL
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    await client.query("COMMIT");
    return {
      workspaces_inserted: workspaces.rowCount ?? 0,
      memberships_inserted: memberships.rowCount ?? 0
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  loadEnvironment();
  const apply = isApplyMode();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const [{ pool }, { requireSafeDatabaseReadTarget, requireSafeDatabaseWriteTarget }] = await Promise.all([
    import("../src/lib/db"),
    import("../../../infrastructure/db/seeds/connection")
  ]);
  const guard = {
    operation: apply ? "Signal workspace backfill" : "Signal workspace backfill dry-run",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  };
  if (apply) requireSafeDatabaseWriteTarget(databaseUrl, guard);
  else requireSafeDatabaseReadTarget(databaseUrl, guard);

  try {
    const before = await summarize(pool);
    const applied = apply
      ? await applyBackfill(pool)
      : { workspaces_inserted: 0, memberships_inserted: 0 };
    const after = apply ? await summarize(pool) : before;
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      before,
      applied,
      after,
      identifiers_redacted: true
    }, null, 2));
    if (!apply) {
      console.log(`Dry-run only. Re-run with --apply and ${ALLOW_REMOTE_ENV}=true for an approved staging/preview target.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
