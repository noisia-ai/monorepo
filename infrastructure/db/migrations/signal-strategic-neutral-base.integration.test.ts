import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_STRATEGIC_NEUTRAL_BASE_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_STRATEGIC_NEUTRAL_BASE_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

test("0076 requires the neutral attributable base for strategic derivations", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file)
        && file <= "0076_signal_strategic_neutral_base.sql")
      .sort();
    for (const file of files) await client.query(await readFile(join(migrationDir, file), "utf8"));
    await client.query(await readFile(join(migrationDir, "0076_signal_strategic_neutral_base.sql"), "utf8"));

    const definitions = await client.query<{ signature: string; definition: string }>(`
      SELECT signature,pg_get_functiondef(signature::regprocedure) AS definition FROM (VALUES
        ('enforce_signal_governed_view_population_derivation()'),
        ('ensure_signal_strategic_population_derivation_v1(uuid,uuid,uuid,text,text,uuid)')
      ) function(signature)
    `);
    assert.equal(definitions.rowCount, 2);
    for (const row of definitions.rows) {
      assert.match(row.definition, /'all-governed'/u);
      assert.doesNotMatch(row.definition,
        /target_workspace_id,\s*'brand',\s*target_base_population_id/u);
    }

    await client.query("SET session_replication_role=replica");
    try {
      await client.query(`INSERT INTO signal_population_definitions (
        id,workspace_id,population_key,version,purpose,status,acceptance_status,
        allowed_scopes,definition_hash,policy_key,policy_version,membership_digest,definition
      ) VALUES
      ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000010',
       'primary-brand-semantic',1,'operational','draft','included',ARRAY['primary_brand'],
       'sha256:'||repeat('1',64),'primary-brand-semantic','2','sha256:'||repeat('2',64),
       '{"contract_version":"signal-operational-primary-brand-semantic-v2"}'::jsonb),
      ('76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000010',
       'attributable-semantic',1,'operational','draft','included',
       ARRAY['primary_brand','competitor','category','reference'],
       'sha256:'||repeat('3',64),'attributable-semantic','1','sha256:'||repeat('4',64),
       '{"contract_version":"signal-operational-attributable-semantic-v1"}'::jsonb)`);
    } finally {
      await client.query("SET session_replication_role=origin");
    }
    const base = await client.query<{ brand_as_all: boolean; neutral_as_all: boolean }>(`
      SELECT
        signal_governed_view_base_contract_is_valid_v1(
          '76000000-0000-4000-8000-000000000010','all-governed',
          '76000000-0000-4000-8000-000000000001') AS brand_as_all,
        signal_governed_view_base_contract_is_valid_v1(
          '76000000-0000-4000-8000-000000000010','all-governed',
          '76000000-0000-4000-8000-000000000002') AS neutral_as_all
    `);
    assert.deepEqual(base.rows, [{ brand_as_all: false, neutral_as_all: true }]);
    const automatic = await client.query<{ total: number }>(`
      SELECT ((SELECT count(*) FROM signal_population_policy_bundles)
        +(SELECT count(*) FROM signal_governed_view_population_derivations)
        +(SELECT count(*) FROM signal_population_policy_compilations)
        +(SELECT count(*) FROM signal_governed_view_bindings))::integer AS total
    `);
    assert.equal(automatic.rows[0]!.total, 0);
  } finally {
    await client.end();
  }
});

function requireDisposableLocalDatabase(url: string) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
      || !/(test|qa|fixture|tmp|local|smoke)/iu.test(parsed.pathname)) {
    throw new Error("0076 integration requires an explicitly disposable local database.");
  }
}
