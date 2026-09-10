/** Small, local product-schema compatibility proof. No corpus clone, remote URL, provider or
 * Lab migration is used. All migration DDL and probe rows roll back; the empty proof DB remains. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { verifySignalTopicResultExportSourceLocalV1 } from "./export-signal-topic-evaluation-result-local-v1";
import { createSignalTopicEvaluationLabDockerWritePoolV2 } from "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { runSignalTopicEvaluationLabDockerV1 } from "./signal-topic-evaluation-lab-docker-transport-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME } from "./signal-topic-evaluation-lab-host-provenance-v2";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const TARGET = "noisia_topic_result_product_0122_proof_20260906";
const LABEL = "noisia-owned-empty-product-schema-proof-0122-v1";
const CONFIRMATION = "PROVE_0122_PRODUCT_SCHEMA_WITHOUT_LAB_OR_CORPUS_CLONE";
const IMPORT_MIGRATION = "0122_signal_topic_evaluation_v2_historical_result_import.sql";

function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`topic_product_schema_proof_${code}`);
}

export async function proofSignalTopicResultProductSchemaLocalV1(environment: NodeJS.ProcessEnv) {
  ensure(environment.NOISIA_RUNTIME_PROFILE === "local_disposable_lab_v1"
    && environment.NOISIA_TOPIC_PRODUCT_SCHEMA_PROOF_ENABLED === "true"
    && environment.NOISIA_TOPIC_PRODUCT_SCHEMA_PROOF_CONFIRMATION === CONFIRMATION, "disabled");
  // Anchor the fixed local Docker/socket/system identity before creating the tiny fixture DB.
  const source = await verifySignalTopicResultExportSourceLocalV1();
  const inventory = await runSignalTopicEvaluationLabDockerV1(["exec", "--interactive",
    SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME, "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align",
    "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", "postgres", "--command",
    `SELECT json_build_object('exists',EXISTS(SELECT 1 FROM pg_database WHERE datname='${TARGET}'),
      'label',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${TARGET}'))::text`]);
  const existing = JSON.parse(inventory) as { exists: boolean; label: string | null };
  if (existing.exists) ensure(existing.label === LABEL, "existing_database_not_owned");
  else {
    await runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
      "createdb", "--username", "postgres", "--template", "template0", TARGET]);
    await runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
      "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", "postgres",
      "--command", `COMMENT ON DATABASE ${TARGET} IS '${LABEL}'`]);
  }
  const pool = createSignalTopicEvaluationLabDockerWritePoolV2({ clone_name: TARGET });
  const before = (await pool.query<{ relations: number; bytes: number; system_identifier: string }>(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public') relations,pg_database_size(current_database())::bigint::float8 bytes,
    (pg_control_system()).system_identifier::text system_identifier`)).rows[0];
  ensure(before?.relations === 0 && before.bytes < 64 * 1024 * 1024
    && before.system_identifier === source.receipt.server_system_identifier, "target_not_empty_or_bounded");

  const directory = resolve(ROOT, "infrastructure/db/migrations");
  const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/u.test(file)
    && (Number(file.slice(0, 4)) <= 113 || file.startsWith("0115_"))).sort();
  ensure(files.length === 115 && files[0]?.startsWith("0000_")
    && files.at(-1)?.startsWith("0115_") && !files.some((file) => /^011[46-9]_|^012[0-1]_/u.test(file)),
  "product_chain_invalid");
  const runner = await readFile(resolve(ROOT,
    "infrastructure/db/scripts/apply-signal-workspace-data-plane-migration.ts"), "utf8");
  const ledgerTemplate = /async function createLedger\(client: pg.Client\) \{\s*await client.query\(`([\s\S]*?)`\);/u
    .exec(runner)?.[1];
  ensure(typeof ledgerTemplate === "string" && ledgerTemplate.includes("CREATE TABLE IF NOT EXISTS ${LEDGER}"),
    "product_ledger_bootstrap_missing");
  const ledgerSql = ledgerTemplate.replaceAll("${LEDGER}", "signal_workspace_data_plane_migration_ledger");
  ensure(!ledgerSql.includes("${"), "product_ledger_template_unsupported");
  const ledgerDigest = `sha256:${createHash("sha256").update(ledgerSql).digest("hex")}`;
  const manifest: Array<{ file: string; checksum: string }> = [];
  const outer = await pool.connect();
  let failure: unknown;
  let applied = 0;
  let visibleRelations = 0;
  let guardExecuted = false;
  let referenceCount = 0;
  try {
    await outer.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await outer.query("SET LOCAL statement_timeout='120s'");
    // The product's release runner owns this ledger, not a numbered SQL migration. Reuse its
    // exact CREATE statement; it stays empty (in particular, no Lab ordinal is fabricated).
    await outer.query("DO $product_ledger$ BEGIN EXECUTE $1; END $product_ledger$", [ledgerSql]);
    for (const file of [...files, IMPORT_MIGRATION]) {
      const sql = await readFile(resolve(directory, file), "utf8");
      manifest.push({ file, checksum: `sha256:${createHash("sha256").update(sql).digest("hex")}` });
      // The local adapter safely binds the whole trusted migration as one string. No untrusted
      // artifact SQL, privileged remote session or outside transaction is involved.
      try { await outer.query("DO $product_ddl$ BEGIN EXECUTE $1; END $product_ddl$", [sql]); }
      catch (error) { throw new Error(`topic_product_schema_proof_migration_${file.slice(0, 4)}_failed`, { cause: error }); }
      applied += 1;
    }
    const catalog = (await outer.query<{ relations: number; lab_objects: number; import_objects: number;
      outbox_absent: boolean; origin: boolean; runtime_profile: boolean }>(`SELECT
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public') relations,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='noisia_topic_evaluation_lab' OR c.relname LIKE 'signal_topic_evaluation_v2_candidate_refinement_%') lab_objects,
      (SELECT count(*)::int FROM pg_class WHERE relname IN('signal_topic_evaluation_v2_archived_refinements',
        'signal_topic_evaluation_v2_result_import_receipts') AND relkind='r') import_objects,
      to_regclass('public.signal_topic_evaluation_v2_execution_outbox') IS NULL outbox_absent,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='signal_topic_evaluation_v2_runs' AND column_name='origin') origin,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='signal_topic_evaluation_v2_execution_authorizations' AND column_name='runtime_profile') runtime_profile`)).rows[0];
    ensure(catalog && catalog.lab_objects === 0 && catalog.import_objects === 2 && catalog.outbox_absent
      && catalog.origin && catalog.runtime_profile, "product_catalog_mismatch");
    visibleRelations = catalog.relations;

    const migration = await readFile(resolve(directory, IMPORT_MIGRATION), "utf8");
    const referencedTables = [...new Set([...migration.matchAll(
      /\b(?:FROM|JOIN|REFERENCES|ALTER TABLE|ON)\s+((?:signal_[a-z0-9_]+)|users|mentions|data_sources)\b/gu
    )].map((match) => match[1]!))];
    const referenceRows = await outer.query<{ present: boolean }>(`SELECT bool_and(to_regclass(name) IS NOT NULL) present
      FROM unnest($1::text[]) name`, [referencedTables]);
    ensure(referenceRows.rows[0]?.present, "referenced_product_relation_missing");
    referenceCount = referencedTables.length;
    // Run the actual migration's imported-brief guard against a temporary empty projection.
    // A missing run must reach its closed domain error, not an undefined Lab table/column.
    await outer.query(`CREATE TEMP TABLE product_brief_guard_probe AS
      SELECT * FROM signal_topic_evaluation_v2_retrievals WITH NO DATA`);
    await outer.query(`CREATE TRIGGER product_brief_guard_probe BEFORE INSERT ON product_brief_guard_probe
      FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_import_brief_v1()`);
    await outer.query(`DO $guard_probe$ DECLARE rejected boolean:=false; BEGIN
      BEGIN INSERT INTO product_brief_guard_probe(run_id,workspace_id,retrieval_index,operation)
        VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',0,'evaluation_brief');
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM<>'Topic evaluation brief requires its original Lab or imported-result authority.' THEN RAISE; END IF;
        rejected:=true;
      END;
      IF NOT rejected THEN RAISE EXCEPTION 'Product import brief guard did not reject the missing run.'; END IF;
    END $guard_probe$`);
    guardExecuted = true;
    await outer.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (error) { failure = error; }
  finally {
    try { await outer.query("ROLLBACK"); } catch { /* ON_ERROR_STOP disconnect rolls back all DDL. */ }
    outer.release();
  }
  const after = (await pool.query<{ relations: number; bytes: number }>(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public') relations,pg_database_size(current_database())::bigint::float8 bytes`)).rows[0];
  ensure(after?.relations === 0 && after.bytes < 64 * 1024 * 1024, "rollback_not_empty_or_bounded");
  if (failure) throw failure;
  const result = { status: "pass", contract_version: "topic-result-product-schema-local-proof-v1",
    migration_manifest: manifest, migration_manifest_digest: signalTopicEvaluationDigestV2(manifest),
    proof: { migrations_executed: applied, import_tables: 2, product_relations: visibleRelations,
      referenced_relations_present: referenceCount, actual_brief_guard_executed: guardExecuted,
      exact_product_runner_ledger_schema_digest: ledgerDigest,
      migration_0114_not_required: true, lab_migrations_and_objects_absent: true, outer_rollback: true,
      imported_result_editor_on_product_schema: "not_executed_no_21195_member_fixture" },
    final: { empty_owned_database_preserved: true, database_bytes: after.bytes, public_relations: after.relations },
    effects: { source_clone_writes: 0, provider_calls: 0, remote: 0, publication: 0, serving: 0 } };
  const evidence = resolve(ROOT, ".data/signal-topic-evaluation/lab-2u");
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const evidenceDigest = signalTopicEvaluationDigestV2(result);
  const evidencePath = resolve(evidence, `product-schema-proof-${evidenceDigest.slice(7)}.json`);
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { ...result, migration_manifest: undefined, evidence_digest: evidenceDigest, evidence_path: evidencePath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  proofSignalTopicResultProductSchemaLocalV1(process.env).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof Error && /^topic_product_schema_proof_[a-z0-9_]+$/u.test(error.message)
      ? error.message : "topic_product_schema_proof_failed";
    const cause = error instanceof Error ? error.cause as { sqlstate?: string } | undefined : undefined;
    process.stderr.write(`${JSON.stringify({ error: message, sqlstate: cause?.sqlstate ?? null })}\n`);
    process.exitCode = 1;
  });
}
