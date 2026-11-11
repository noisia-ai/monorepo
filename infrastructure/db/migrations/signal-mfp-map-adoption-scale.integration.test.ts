import assert from "node:assert/strict";
import { processingBatch } from "./signal-import-finalization.synthetic.fixture";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "../signal-mass-labeling-study-policy";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import type { PoolClient } from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareMassLabelingMapScoresV1, insertMassLabelingMapItemsV1, MASS_LABELING_MAP_SCORES_SQL_V1 } from "../signal-mass-labeling-map-sql";
import { signalMfpLegacyWorkspaceFixtureV1 } from "./signal-mfp-legacy-workspace.synthetic.fixture";
import { mapParitySetupSqlV1, mapOriginalScoresSqlV1, mapOriginalItemsSqlV1, withMapAdoptionPostgresFixtureV1 } from "./signal-mass-labeling-map.synthetic.fixture";

const enabled = process.env.NOISIA_MFP_PG_CI === "true";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const itemColumns = `workspace_id uuid,map_id uuid,root_id uuid,ordinal int,input_digest text,
  root_fingerprint text,chunk_index int,chunk_sha256 text,text text,candidates jsonb`;
type Plan = { "Node Type": string; "Relation Name"?: string; "Actual Loops"?: number; Plans?: Plan[] };
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];

if (process.env.NOISIA_MFP_MAP_ABORT_CHILD !== "true") test("map SQL preserves exact vector bits, top eight, ties, UTF-16 fragments, digests and multilingual candidates", {
  skip: !enabled, timeout: 60_000,
}, async t => withMapAdoptionPostgresFixtureV1(t.signal, async fixture => {
    const client = fixture.scoped;
    await client.query("SET LOCAL search_path=pg_temp,public,extensions; SET LOCAL statement_timeout='30s'; SET LOCAL work_mem='4MB'; SET LOCAL enable_hashagg=off");
    await client.query(mapParitySetupSqlV1);
    const map = randomUUID(), workspace = randomUUID(), mapDigest = sha("synthetic parity map");
    await client.query("CREATE TEMP TABLE signal_mass_labeling_topics AS SELECT $1::uuid map_id,topic_key,centroid FROM topics", [map]);
    await client.query(`CREATE TEMP TABLE signal_mass_labeling_items(${itemColumns}); CREATE TEMP TABLE items_original(${itemColumns})`);
    await client.query(mapOriginalScoresSqlV1);
    const catalog = (await client.query("SELECT body FROM catalog")).rows[0].body;
    await client.query(mapOriginalItemsSqlV1, [workspace, map, JSON.stringify(catalog), mapDigest]);
    await prepareMassLabelingMapScoresV1(client, map);
    await insertMassLabelingMapItemsV1(client, { workspace_id: workspace, map_id: map, catalog, map_digest: mapDigest, expected_roots: 32 });
    const difference = (await client.query(`SELECT
      (SELECT count(*)::int FROM ((SELECT topic_key,vector_send(centroid) FROM topics EXCEPT ALL SELECT topic_key,vector_send(centroid) FROM mass_topic_vectors)
        UNION ALL (SELECT topic_key,vector_send(centroid) FROM mass_topic_vectors EXCEPT ALL SELECT topic_key,vector_send(centroid) FROM topics)) d) centroids,
      (SELECT count(*)::int FROM ((SELECT root_id,topic_key,float8send(similarity),position FROM scores_old EXCEPT ALL SELECT root_id,topic_key,float8send(similarity),position FROM mass_scores)
        UNION ALL (SELECT root_id,topic_key,float8send(similarity),position FROM mass_scores EXCEPT ALL SELECT root_id,topic_key,float8send(similarity),position FROM scores_old)) d) scores,
      (SELECT count(*)::int FROM ((TABLE items_original EXCEPT ALL TABLE signal_mass_labeling_items)
        UNION ALL (TABLE signal_mass_labeling_items EXCEPT ALL TABLE items_original)) d) items,
      (SELECT count(*)::int FROM signal_mass_labeling_items) roots,
      (SELECT count(*)::int FROM mass_scores) scored`)).rows[0];
    assert.deepEqual(difference, { centroids: 0, scores: 0, items: 0, roots: 32, scored: 256 });
    const scoreSelect = MASS_LABELING_MAP_SCORES_SQL_V1.replace(/^CREATE TEMP TABLE mass_scores ON COMMIT DROP AS/u, "");
    const plan = (await client.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${scoreSelect}`)).rows[0]["QUERY PLAN"][0].Plan as Plan;
    const scans = nodes(plan).filter(node => node["Relation Name"] === "mass_topic_vectors");
    assert.equal(scans.length, 1);
    assert.equal(scans[0]!["Actual Loops"], 1, "all roots share one inline catalog, rather than re-reading toasted centroids");
}));

/** Exercise the exact production INSERT, including its migrated foreign keys,
 * indexes, category and serving projections. Corpus/provenance proof is tested
 * by the native worker acceptance; this fixture isolates adoption arithmetic. */
// The regular workflow validates three real guarded batches. Reproduce the
// complete receipt with the same workflow environment plus
// NOISIA_MFP_MAP_ADOPTION_FULL_SCALE_PG_TEST=true and this test file.
const fullScale = process.env.NOISIA_MFP_MAP_ADOPTION_FULL_SCALE_PG_TEST === "true";
if (process.env.NOISIA_MFP_MAP_ABORT_CHILD !== "true") test(`map adoption preserves atomicity across guarded batches (${fullScale ? "83,962-root full scale" : "3,000-root CI regression"})`, {
  skip: !enabled, timeout: 600_000,
}, async t => withMapAdoptionPostgresFixtureV1(t.signal, async transaction => {
    const roots = fullScale ? 83_962 : 3_000, chunks = fullScale ? 127_117 : 4_500, topics = 111;
    console.log("map_adoption_acceptance", JSON.stringify({ phase: "fixture", roots, chunks, topics, full_scale: fullScale }));
    const f = await signalMfpLegacyWorkspaceFixtureV1({ transaction });
    const settings = await getMassLabelingStudyPolicyV1(f.access);
    await updateMassLabelingStudyPolicyV1({ ...f.access, ...settings, expected_revision: settings.revision,
      category: "Synthetic category", lexicon_terms: Array.from({ length: 98 }, (_, index) => `synthetic term ${index}`) });
    await f.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL work_mem='4MB'; SET LOCAL statement_timeout='90s'");
    await f.query(`CREATE TEMP TABLE map_vector_pool AS SELECT p,
      ('['||string_agg((sin(p*.173+j*.719)+cos(p*.317+j*.233))::real::text,',' ORDER BY j)||']')::vector(1024) embedding
      FROM generate_series(1,512) p CROSS JOIN generate_series(1,1024) j GROUP BY p`);
    await f.query("CREATE UNIQUE INDEX ON map_vector_pool(p)");
    await f.query(`CREATE TEMP TABLE mass_chunks ON COMMIT DROP AS
      SELECT md5($1||':root:'||r)::uuid root_id,'sha256:'||md5('finger:'||r)||md5('finger2:'||r) fingerprint,
        repeat(md5('text:'||r),24) full_text,chunk_index,md5(r::text||':'||chunk_index) chunk_sha256,0 start_offset,768 end_offset,
        (pool.embedding+array_fill(((r%10000)::real/1000000+chunk_index::real/10000000),ARRAY[1024])::vector)::vector(1024) embedding
      FROM (SELECT r,0 chunk_index FROM generate_series(1,$2::int) r UNION ALL SELECT r,1 FROM generate_series(1,$3::int-$2::int) r) roots
      JOIN map_vector_pool pool ON pool.p=(r%512)+1`, [f.workspace_id, roots, chunks]);
    await f.query("CREATE UNIQUE INDEX mass_chunks_root ON mass_chunks(root_id,chunk_index)");
    const source = (await f.query("SELECT data_source_id FROM mentions WHERE workspace_id=$1 LIMIT 1", [f.workspace_id])).rows[0];
    const workspaceScope = (await f.query("SELECT organization_id,brand_id FROM signal_workspaces WHERE id=$1", [f.workspace_id])).rows[0];
    // Quarantine these arithmetic-only fixture roots while seeding. This uses
    // the normal import guard and avoids reconciling a live semantic draft per
    // invented row; all item FK/category/serving triggers below remain enabled.
    const batch = await processingBatch(f.scoped, { organization: workspaceScope.organization_id, brand: workspaceScope.brand_id,
      actor: f.actor_user_id as ReturnType<typeof randomUUID>, workspace: f.workspace_id, source: source.data_source_id }, "synthetic map arithmetic", "synthetic.csv");
    await f.query(`INSERT INTO mentions(id,workspace_id,data_source_id,source_file_id,canonical_mention_id,
      provider_record_id,external_id,source_system,text_hash,text_clean,text_length,published_at,platform,inclusion_status,quality_score)
      SELECT root_id,$1,$2,$3,root_id,'scale-'||root_id,root_id::text,'listening_csv',
        encode(sha256(convert_to(root_id::text,'UTF8')),'hex'),full_text,length(full_text),'2026-08-01T12:00:00Z','web','included',7
      FROM mass_chunks WHERE chunk_index=0`, [f.workspace_id, source.data_source_id, batch.id]);
    const map = randomUUID(), mapDigest = sha(map);
    const execution = (await f.query(`SELECT e.preparation_run_id,e.input_revision,e.embedding_config_digest,
      e.result_summary->>'output_artifact_id' output_artifact_id,e.input_snapshot->>'context_digest' context_digest
      FROM signal_topic_catalog_executions e WHERE e.id=$1`, [f.engine_execution_id])).rows[0];
    const catalog = (await f.query(`SELECT jsonb_agg(jsonb_build_object('topic_key','topic_'||lpad(p::text,3,'0'),
      'name',left(md5(p::text)||md5('name'||p),55),'definition',d.definition,'group_ids',jsonb_build_array('guided:'||p),
      'localization',jsonb_build_object('original_language','pt',
        'original',jsonb_build_object('name',left(md5(p::text)||md5('original'||p),55),'definition',left(d.definition||md5('more'||p),346)),
        'en',jsonb_build_object('name',left(md5(p::text)||md5('name'||p),55),'definition',d.definition),
        'es',jsonb_build_object('name',left(md5(p::text)||md5('es'||p),55),'definition',left(d.definition||md5('spanish'||p)||'end',361)))) ORDER BY p) catalog
      FROM map_vector_pool CROSS JOIN LATERAL (SELECT left(string_agg(md5(p||':'||g),'' ORDER BY g),326) definition FROM generate_series(1,12)g)d WHERE p<=$1`, [topics])).rows[0].catalog;
    await f.query(`INSERT INTO signal_mass_labeling_maps(id,workspace_id,source_engine_execution_id,preparation_run_id,input_revision,
      embedding_config_digest,map_digest,entity_context_digest,assignments_artifact_id,assignments_digest,catalog,root_count,
      created_by_user_id,consolidation_artifact_id,consolidation_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$10,$11,$12,$9,$7)`,
      [map, f.workspace_id, f.engine_execution_id, execution.preparation_run_id, execution.input_revision,
        execution.embedding_config_digest, mapDigest, execution.context_digest, execution.output_artifact_id, JSON.stringify(catalog), roots, f.actor_user_id]);
    await f.query(`INSERT INTO signal_mass_labeling_topics(workspace_id,map_id,topic_key,definition_digest,group_ids,centroid)
      SELECT $1,$2,'topic_'||lpad(p::text,3,'0'),$3,ARRAY['guided:'||p],embedding FROM map_vector_pool WHERE p<=$4`,
      [f.workspace_id, map, sha("synthetic definitions"), topics]);
    await f.query("SET LOCAL statement_timeout='90s'");
    console.log("map_adoption_acceptance", JSON.stringify({ phase: "scoring", roots }));
    const scoreStarted = performance.now();
    await prepareMassLabelingMapScoresV1(f.database, map);
    const scoreMs = Math.round(performance.now()-scoreStarted);
    // A lost acknowledgement after two successful guarded INSERTs must not
    // leave any item or derived projection visible after transaction rollback.
    await f.query("SAVEPOINT interrupted_adoption");
    let writes = 0;
    const interrupted = { query: async (sql: string, values?: unknown[]) => {
      const result = await f.query(sql, values);
      if (sql.startsWith("INSERT INTO signal_mass_labeling_items(") && ++writes === 2)
        throw new Error("synthetic_map_batch_acknowledgement_lost");
      return result;
    } } as unknown as Pick<PoolClient, "query">;
    await assert.rejects(insertMassLabelingMapItemsV1(interrupted, { workspace_id: f.workspace_id, map_id: map,
      catalog, map_digest: mapDigest, expected_roots: roots }), /synthetic_map_batch_acknowledgement_lost/u);
    assert.equal(writes, 2);
    await f.query("ROLLBACK TO SAVEPOINT interrupted_adoption");
    await f.query("RELEASE SAVEPOINT interrupted_adoption");
    const rolledBack = (await f.query(`SELECT
      (SELECT count(*)::int FROM signal_mass_labeling_items WHERE map_id=$1) items,
      (SELECT count(*)::int FROM signal_mass_labeling_root_segments WHERE map_id=$1) segments,
      (SELECT count(*)::int FROM signal_mass_labeling_topic_probabilities WHERE map_id=$1) candidates,
      (SELECT count(*)::int FROM signal_mass_labeling_category_matches category JOIN mass_chunks chunk ON chunk.root_id=category.root_id
        AND chunk.chunk_index=0 WHERE category.workspace_id=$2) categories`, [map, f.workspace_id])).rows[0];
    assert.deepEqual(rolledBack, { items: 0, segments: 0, candidates: 0, categories: 0 });
    console.log("map_adoption_acceptance", JSON.stringify({ phase: "rollback_verified_then_insert", roots }));
    const insertStarted = performance.now();
    const inserted = await insertMassLabelingMapItemsV1(f.database, { workspace_id: f.workspace_id, map_id: map,
      catalog, map_digest: mapDigest, expected_roots: roots });
    const insertMs = Math.round(performance.now()-insertStarted);
    assert.equal(inserted.root_count, roots);
    assert.equal(inserted.batch_count, Math.ceil(roots/1000));
    assert.ok(inserted.batch_count>=3);
    assert.ok(inserted.maximum_batch_ms<90_000);
    const counts = (await f.query(`SELECT
      (SELECT count(*)::int FROM mass_scores) scores,
      (SELECT count(*)::int FROM signal_mass_labeling_items WHERE map_id=$1) items,
      (SELECT count(*)::int FROM signal_mass_labeling_root_segments WHERE map_id=$1) segments,
      (SELECT count(*)::int FROM signal_mass_labeling_topic_probabilities WHERE map_id=$1) candidates`, [map])).rows[0];
    assert.deepEqual(counts, { scores: roots*8, items: roots, segments: roots, candidates: roots*8 });
    assert.ok(scoreMs<90_000 && insertMs<600_000, "adoption stays within the native ten-minute materialization lease");
    t.diagnostic(JSON.stringify({ roots, chunks, topics, dimensions: 1024, work_mem: "4MB", statement_budget_ms: 90_000,
      score_ms: scoreMs, insert_with_guards_and_projections_ms: insertMs, ...inserted, counts }));
}));


if (process.env.NOISIA_MFP_MAP_ABORT_CHILD === "true") {
  test("map adoption abort witness", { timeout: 300 }, async t => withMapAdoptionPostgresFixtureV1(t.signal,
    async fixture => {
      console.log("map_abort_backend", (await fixture.query("SELECT pg_backend_pid() pid")).rows[0].pid);
      await fixture.query("SELECT pg_sleep(60)");
    }));
} else test("map test timeout destroys its owned PostgreSQL connection and exits without hanging cleanup", {
  skip: !enabled, timeout: 15_000,
}, async () => {
  const started = performance.now();
  const env: NodeJS.ProcessEnv = { ...process.env, NOISIA_MFP_MAP_ABORT_CHILD: "true" };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ["--test", "--import", "tsx", fileURLToPath(import.meta.url)],
    { env, encoding: "utf8", timeout: 8_000, maxBuffer: 1_000_000 });
  assert.equal(child.error, undefined, "the child exits naturally; no process timeout hides a leaked pool");
  assert.equal(child.status, 1);
  assert.match(child.stdout, /testTimeoutFailure/u);
  assert.ok(performance.now()-started<5_000);
  const backend = Number(child.stdout.match(/map_abort_backend (\d+)/u)?.[1]);
  assert.ok(Number.isInteger(backend) && backend>0);
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const observer = await openDatabase();
  try {
    let exists = true;
    for (let attempt=0; attempt<40 && exists; attempt++) {
      exists = (await observer.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1) alive", [backend])).rows[0].alive;
      if (exists) await new Promise(resolve => setTimeout(resolve,50));
    }
    assert.equal(exists,false,"the disconnected backend exits too; no sleeping transaction survives the test");
  } finally { await observer.end(); }
});
