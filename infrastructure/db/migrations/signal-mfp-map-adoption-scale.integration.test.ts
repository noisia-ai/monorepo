import assert from "node:assert/strict";
import { processingBatch } from "./signal-import-finalization.synthetic.fixture";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "../signal-mass-labeling-study-policy";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { prepareMassLabelingMapScoresV1, insertMassLabelingMapItemsV1, MASS_LABELING_MAP_SCORES_SQL_V1 } from "../signal-mass-labeling-map-sql";
import { signalMfpLegacyWorkspaceFixtureV1 } from "./signal-mfp-legacy-workspace.synthetic.fixture";
import { mapParitySetupSqlV1, mapOriginalScoresSqlV1, mapOriginalItemsSqlV1 } from "./signal-mass-labeling-map.synthetic.fixture";

const enabled = process.env.NOISIA_MFP_PG_CI === "true";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const itemColumns = `workspace_id uuid,map_id uuid,root_id uuid,ordinal int,input_digest text,
  root_fingerprint text,chunk_index int,chunk_sha256 text,text text,candidates jsonb`;
type Plan = { "Node Type": string; "Relation Name"?: string; "Actual Loops"?: number; Plans?: Plan[] };
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];

test("map SQL preserves exact vector bits, top eight, ties, UTF-16 fragments, digests and multilingual candidates", {
  skip: !enabled, timeout: 60_000,
}, async () => {
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const pool: Pool = await openDatabase(), client = await pool.connect();
  try {
    await client.query("BEGIN");
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
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});

/** Exercise the exact production INSERT, including its migrated foreign keys,
 * indexes, category and serving projections. Corpus/provenance proof is tested
 * by the native worker acceptance; this fixture isolates adoption arithmetic. */
test("map adoption computes 83,962 roots and inserts all eight candidates within a bounded PostgreSQL statement budget", {
  skip: !enabled, timeout: 600_000,
}, async t => {
  const f = await signalMfpLegacyWorkspaceFixtureV1();
  try {
    const roots = 83_962, chunks = 127_117, topics = 111;
    const settings = await getMassLabelingStudyPolicyV1(f.access);
    await updateMassLabelingStudyPolicyV1({ ...f.access, ...settings, expected_revision: settings.revision,
      category: "Synthetic category", lexicon_terms: Array.from({ length: 98 }, (_, index) => `synthetic term ${index}`) });
    await f.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL work_mem='4MB'; SET LOCAL statement_timeout='180s'");
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
    const scoreStarted = performance.now();
    await prepareMassLabelingMapScoresV1(f.database, map);
    const scoreMs = Math.round(performance.now()-scoreStarted);
    const insertStarted = performance.now();
    const inserted = await insertMassLabelingMapItemsV1(f.database, { workspace_id: f.workspace_id, map_id: map,
      catalog, map_digest: mapDigest, expected_roots: roots });
    const insertMs = Math.round(performance.now()-insertStarted);
    assert.equal(inserted.root_count, roots);
    assert.equal(inserted.batch_count, 84);
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
  } finally { await f.cleanup(); }
});
