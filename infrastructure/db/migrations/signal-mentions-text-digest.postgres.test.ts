import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const enabled = process.env.NOISIA_MENTIONS_DIGEST_PG_TEST_APPROVED === "true";

test("0167 backfills and maintains byte-exact digests under PostgreSQL constraints", { skip: !enabled, timeout: 90_000 }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55439");
  assert.match(url.pathname, /^\/noisia_(national_import_test|projection_test)_\d+$/u);
  const client = new pg.Client({ connectionString: url.href, ssl: false });
  await client.connect();
  try {
    await client.query("BEGIN");
    assert.equal((await client.query(`SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='mentions' AND column_name='text_clean_sha256') absent`)).rows[0]!.absent, true);
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    await client.query(await readFile(new URL("./0167_signal_mentions_text_digest.sql", import.meta.url), "utf8"));
    const publicAcl = (await client.query(`SELECT NOT EXISTS(
      SELECT 1 FROM pg_proc function CROSS JOIN LATERAL
        aclexplode(COALESCE(function.proacl,acldefault('f',function.proowner))) privilege
      WHERE function.oid='backfill_signal_mention_text_clean_sha256_v1(integer)'::regprocedure
        AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') revoked`)).rows[0]!.revoked;
    assert.equal(publicAcl, true, "PUBLIC cannot execute the operational backfill helper");
    const publicStateAcl = (await client.query(`SELECT NOT EXISTS(
      SELECT 1 FROM pg_class relation CROSS JOIN LATERAL
        aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) privilege
      WHERE relation.oid='signal_mention_text_digest_backfill_state'::regclass AND privilege.grantee=0) revoked`)).rows[0]!.revoked;
    assert.equal(publicStateAcl, true, "PUBLIC cannot read or mutate operational backfill state");
    const apiAcl = (await client.query(`SELECT role.rolname,
      (has_function_privilege(role.oid,'backfill_signal_mention_text_clean_sha256_v1(integer)'::regprocedure,'EXECUTE')
       OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'SELECT')
       OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'INSERT')
       OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'UPDATE')
       OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'DELETE')) allowed
      FROM pg_roles role WHERE role.rolname=ANY(ARRAY['anon','authenticated'])`)).rows as Array<{ rolname: string; allowed: boolean }>;
    assert.ok(apiAcl.every(row => !row.allowed), "API roles cannot use the operational backfill helper or state");
    const source = (await client.query<{ id: string; workspace_id: string; study_corpus_id: string | null }>(
      "SELECT id,workspace_id,study_corpus_id FROM data_sources ORDER BY id LIMIT 1")).rows[0];
    assert.ok(source, "sealed local fixture must contain a data source");
    const legacyId = randomUUID(), legacyText = `Legacy Mixed-Case ${legacyId}`;
    await client.query("ALTER TABLE mentions DISABLE TRIGGER trg_signal_mention_text_clean_sha256");
    await client.query(`INSERT INTO mentions(id,workspace_id,study_corpus_id,data_source_id,canonical_mention_id,
      provider_record_id,external_id,source_system,text_hash,text_clean,text_length,published_at,platform,inclusion_status)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$1::uuid,$5,$5||'-external',$5,
        encode(sha256(convert_to(lower($6),'UTF8')),'hex'),$6,char_length($6),now(),'fixture','included')`,
    [legacyId, source.workspace_id, source.study_corpus_id, source.id, `digest-${legacyId}`, legacyText]);
    await client.query("ALTER TABLE mentions ENABLE TRIGGER trg_signal_mention_text_clean_sha256");
    assert.equal((await client.query("SELECT text_clean_sha256 FROM mentions WHERE id=$1::uuid", [legacyId])).rows[0]!.text_clean_sha256, null);
    const pending = Number((await client.query("SELECT count(*)::int pending FROM mentions WHERE text_clean_sha256 IS NULL")).rows[0]!.pending);
    assert.ok(pending >= 1);
    await client.query("SAVEPOINT premature_finalize");
    await assert.rejects(client.query(await readFile(new URL("./0168_signal_mentions_text_digest_finalize.sql", import.meta.url), "utf8")),
      (error: unknown) => Boolean(error && typeof error === "object" && "message" in error
        && error.message === "signal_mentions_text_digest_backfill_incomplete"));
    await client.query("ROLLBACK TO SAVEPOINT premature_finalize");
    await client.query("RELEASE SAVEPOINT premature_finalize");
    const batchSize = 1_000, progress: number[] = [];
    for (;;) {
      const changed = Number((await client.query("SELECT backfill_signal_mention_text_clean_sha256_v1($1) changed", [batchSize])).rows[0]!.changed);
      progress.push(changed);
      if (changed === 0) break;
    }
    assert.ok(progress.slice(0, -1).every(changed => changed > 0 && changed <= batchSize));
    assert.equal(progress.at(-1), 0, "bounded backfill is restartable and signals completion");
    assert.equal(progress.slice(0, -1).reduce((sum, changed) => sum + changed, 0), pending,
      "all historical NULL rows are drained without assuming the fixture census");

    await client.query("ALTER TABLE mentions DISABLE TRIGGER trg_signal_mention_text_clean_sha256");
    await client.query("UPDATE mentions SET text_clean_sha256=NULL WHERE id=$1::uuid", [legacyId]);
    await client.query("ALTER TABLE mentions ENABLE TRIGGER trg_signal_mention_text_clean_sha256");
    await client.query("UPDATE mentions SET platform=platform WHERE id=$1::uuid", [legacyId]);
    assert.notEqual((await client.query("SELECT text_clean_sha256 FROM mentions WHERE id=$1::uuid", [legacyId])).rows[0]!.text_clean_sha256, null,
      "an ordinary metadata update repairs a legacy NULL without hashing unchanged valid rows");

    await client.query("ALTER TABLE mentions DISABLE TRIGGER trg_signal_mention_text_clean_sha256");
    await client.query("UPDATE mentions SET text_clean_sha256=NULL WHERE id=$1::uuid", [legacyId]);
    await client.query("ALTER TABLE mentions ENABLE TRIGGER trg_signal_mention_text_clean_sha256");
    assert.equal((await client.query("SELECT backfill_signal_mention_text_clean_sha256_v1($1) changed", [batchSize])).rows[0]!.changed, 1,
      "the helper resets its cursor and drains a NULL introduced behind it");
    assert.equal((await client.query("SELECT backfill_signal_mention_text_clean_sha256_v1($1) changed", [batchSize])).rows[0]!.changed, 0,
      "the helper reports completion only after the reset pass is empty");
    await client.query(await readFile(new URL("./0168_signal_mentions_text_digest_finalize.sql", import.meta.url), "utf8"));
    const prepared = (await client.query(`SELECT
      (SELECT is_nullable='YES' FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mentions' AND column_name='text_clean_sha256') nullable,
      (SELECT NOT convalidated FROM pg_constraint WHERE conname='mentions_text_clean_sha256_present') present_unvalidated,
      to_regprocedure('backfill_signal_mention_text_clean_sha256_v1(integer)') IS NOT NULL helper_present`)).rows[0]!;
    assert.deepEqual(prepared, { nullable: true, present_unvalidated: true, helper_present: true },
      "0168 does not retain an ACCESS EXCLUSIVE lock while validation scans run");
    await client.query(await readFile(new URL("./0169_signal_mentions_text_digest_validate.sql", import.meta.url), "utf8"));
    assert.equal((await client.query(`SELECT text_clean_sha256=
      'sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex') exact FROM mentions WHERE id=$1::uuid`, [legacyId])).rows[0]!.exact, true);

    const insertedId = randomUUID(), insertedText = `Mixed-Case byte exact PostgreSQL fixture ${insertedId}`;
    const inserted = (await client.query<{ text_clean_sha256: string; expected: string }>(`INSERT INTO mentions(id,workspace_id,study_corpus_id,
      data_source_id,canonical_mention_id,provider_record_id,external_id,source_system,text_hash,text_clean,text_length,
      published_at,platform,inclusion_status)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$1::uuid,$5,$5||'-external',$5,
        encode(sha256(convert_to(lower($6),'UTF8')),'hex'),$6,char_length($6),now(),'fixture','included')
      RETURNING text_clean_sha256,
        'sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex') expected`,
    [insertedId, source.workspace_id, source.study_corpus_id, source.id, `digest-${insertedId}`, insertedText])).rows[0]!;
    assert.equal(inserted.text_clean_sha256, inserted.expected);

    const repaired = (await client.query<{ text_clean_sha256: string; expected: string }>(`UPDATE mentions
      SET text_clean_sha256=$2 WHERE id=$1::uuid RETURNING text_clean_sha256,
      'sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex') expected`,
    [insertedId, `sha256:${"0".repeat(64)}`])).rows[0]!;
    assert.equal(repaired.text_clean_sha256, repaired.expected, "trigger repairs direct digest adulteration");

    const changed = (await client.query<{ text_clean_sha256: string; expected: string }>(`UPDATE mentions
      SET text_clean=text_clean||' changed' WHERE id=$1::uuid RETURNING text_clean_sha256,
      'sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex') expected`, [insertedId])).rows[0]!;
    assert.equal(changed.text_clean_sha256, changed.expected, "text update recomputes the digest");

    await client.query("SAVEPOINT invalid_digest");
    await client.query("ALTER TABLE mentions DISABLE TRIGGER trg_signal_mention_text_clean_sha256");
    await assert.rejects(client.query("UPDATE mentions SET text_clean_sha256=$2 WHERE id=$1::uuid",
      [insertedId, `sha256:${"f".repeat(64)}`]), (error: unknown) => Boolean(error && typeof error === "object"
        && "constraint" in error && error.constraint === "mentions_text_clean_sha256_exact"));
    await client.query("ROLLBACK TO SAVEPOINT invalid_digest");
    await client.query("RELEASE SAVEPOINT invalid_digest");

    assert.equal((await client.query("SELECT to_regprocedure('backfill_signal_mention_text_clean_sha256_v1(integer)') IS NULL removed")).rows[0]!.removed, true);
    assert.equal((await client.query("SELECT to_regclass('signal_mention_text_digest_backfill_state') IS NULL removed")).rows[0]!.removed, true);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});
