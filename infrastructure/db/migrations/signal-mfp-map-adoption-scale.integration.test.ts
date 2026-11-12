import assert from "node:assert/strict";
import { loadMassLabelingProductEstimateWithClientV2, estimateMassLabelingProductV2 } from "../signal-mass-labeling-product-estimate";
import { processingBatch } from "./signal-import-finalization.synthetic.fixture";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "../signal-mass-labeling-study-policy";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import type { PoolClient } from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareMassLabelingMapScoresV1, insertMassLabelingMapItemsV1, MASS_LABELING_MAP_SCORES_SQL_V1, MASS_LABELING_MAP_ITEM_INPUT_SQL_V1, MASS_LABELING_MAP_BATCH_CHUNKS_SQL_V1 } from "../signal-mass-labeling-map-sql";
import { signalMfpLegacyWorkspaceFixtureV1 } from "./signal-mfp-legacy-workspace.synthetic.fixture";
import { mapParitySetupSqlV1, mapOriginalScoresSqlV1, mapOriginalItemsSqlV1, withMapAdoptionPostgresFixtureV1 } from "./signal-mass-labeling-map.synthetic.fixture";

const enabled = process.env.NOISIA_MFP_PG_CI === "true";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const itemColumns = `workspace_id uuid,map_id uuid,root_id uuid,ordinal int,input_digest text,
  root_fingerprint text,chunk_index int,chunk_sha256 text,text text,candidates jsonb`;
type Plan = { "Node Type": string; "Relation Name"?: string; "Actual Loops"?: number; "Actual Rows"?:number; "Index Cond"?:string; "Local Hit Blocks"?:number; "Rows Removed by Filter"?:number; "Rows Removed by Index Recheck"?:number; "Rows Removed by Join Filter"?:number; Plans?: Plan[] };
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
async function analyzeCommittedCorpusV1() {
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const statistics=await openDatabase();
  try { await statistics.query("SET lock_timeout='2s'; ANALYZE public.mentions; ANALYZE public.signal_mass_labeling_items"); }
  finally { await statistics.end(); }
}


if (process.env.NOISIA_MFP_MAP_ABORT_CHILD !== "true") test("map SQL preserves exact vector bits, top eight, ties, UTF-16 fragments, digests and multilingual candidates", {
  skip: !enabled, timeout: 60_000,
}, async t => withMapAdoptionPostgresFixtureV1(t.signal, async fixture => {
    const client = fixture.scoped;
    await client.query("SET LOCAL search_path=pg_temp,public,extensions; SET LOCAL statement_timeout='30s'; SET LOCAL work_mem='4MB'; SET LOCAL enable_hashagg=off");
    await client.query(mapParitySetupSqlV1);
    const map = randomUUID(), workspace = randomUUID(), mapDigest = sha("synthetic parity map");
    await client.query("CREATE TEMP TABLE signal_mass_labeling_topics AS SELECT $1::uuid map_id,topic_key,centroid FROM topics", [map]);
    await client.query(`CREATE TEMP TABLE signal_mass_labeling_items(${itemColumns}); CREATE TEMP TABLE items_original(${itemColumns}); CREATE TEMP TABLE signal_mass_labeling_product_estimates(workspace_id uuid,map_id uuid PRIMARY KEY,root_count int,input_characters bigint)`);
    await client.query("CREATE TEMP TABLE root_avg_original AS SELECT root_id,avg(embedding) root_vector FROM mass_chunks GROUP BY root_id");
    await client.query(mapOriginalScoresSqlV1);
    const catalog = (await client.query("SELECT body FROM catalog")).rows[0].body;
    await client.query(mapOriginalItemsSqlV1, [workspace, map, JSON.stringify(catalog), mapDigest]);
    await prepareMassLabelingMapScoresV1(client, map);
    await client.query("SET LOCAL enable_mergejoin=off");
    await insertMassLabelingMapItemsV1(client, { workspace_id: workspace, map_id: map, catalog, map_digest: mapDigest, expected_roots: 2032 });
    assert.equal((await client.query("SHOW enable_mergejoin")).rows[0].enable_mergejoin,"off","success preserves a pre-existing disabled merge join preference");
    const difference = (await client.query(`SELECT
      (SELECT count(*)::int FROM ((SELECT root_id,vector_send(root_vector) FROM root_avg_original EXCEPT ALL SELECT root_id,vector_send(root_vector) FROM mass_root_vectors)
        UNION ALL (SELECT root_id,vector_send(root_vector) FROM mass_root_vectors EXCEPT ALL SELECT root_id,vector_send(root_vector) FROM root_avg_original)) d) root_vectors,
      (SELECT count(*)::int FROM ((SELECT topic_key,vector_send(centroid) FROM topics EXCEPT ALL SELECT topic_key,vector_send(centroid) FROM mass_topic_vectors)
        UNION ALL (SELECT topic_key,vector_send(centroid) FROM mass_topic_vectors EXCEPT ALL SELECT topic_key,vector_send(centroid) FROM topics)) d) centroids,
      (SELECT count(*)::int FROM ((SELECT root_id,topic_key,float8send(similarity),position FROM scores_old EXCEPT ALL SELECT root_id,topic_key,float8send(similarity),position FROM mass_scores)
        UNION ALL (SELECT root_id,topic_key,float8send(similarity),position FROM mass_scores EXCEPT ALL SELECT root_id,topic_key,float8send(similarity),position FROM scores_old)) d) scores,
      (SELECT count(*)::int FROM ((TABLE items_original EXCEPT ALL TABLE signal_mass_labeling_items)
        UNION ALL (TABLE signal_mass_labeling_items EXCEPT ALL TABLE items_original)) d) items,
      (SELECT count(*)::int FROM signal_mass_labeling_items) roots,
      (SELECT count(*)::int FROM mass_scores) scored`)).rows[0];
    const unicodeSize=(await client.query(`SELECT
      (SELECT input_characters::text FROM signal_mass_labeling_product_estimates) cached,
      (SELECT sum(length(text)+length(candidates::text))::text FROM items_original) original`)).rows[0];
    assert.equal(unicodeSize.cached,unicodeSize.original,"the cache preserves PostgreSQL Unicode and JSONB character counts");
    assert.deepEqual(difference, { root_vectors: 0, centroids: 0, scores: 0, items: 0, roots: 2032, scored: 16256 });
    const scoreSelect = MASS_LABELING_MAP_SCORES_SQL_V1;
    const range=(await client.query("SELECT min(root_id::text) first,max(root_id::text) last FROM mass_map_roots")).rows[0];
    const plan = (await client.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${scoreSelect}`, [range.first,range.last])).rows[0]["QUERY PLAN"][0].Plan as Plan;
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
    // Deliberately model an uncommitted first corpus while shared statistics
    // still describe an empty table. This is pinned to disposable PostgreSQL.
    await analyzeCommittedCorpusV1();
    const cold=(await transaction.query("SELECT reltuples::int rows FROM pg_class WHERE oid='public.mentions'::regclass")).rows[0];
    assert.equal(cold.rows,0);
    const f = await signalMfpLegacyWorkspaceFixtureV1({ transaction });
    const settings = await getMassLabelingStudyPolicyV1(f.access);
    await updateMassLabelingStudyPolicyV1({ ...f.access, ...settings, expected_revision: settings.revision,
      category: "Synthetic category", lexicon_terms: Array.from({ length: 129 }, (_, index) => `synthetic term ${index}`) });
    await f.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL work_mem='4MB'; SET LOCAL statement_timeout='90s'");
    await f.query(`CREATE TEMP TABLE map_vector_pool AS SELECT p,
      ('['||string_agg((sin(p*.173+j*.719)+cos(p*.317+j*.233))::real::text,',' ORDER BY j)||']')::vector(1024) embedding
      FROM generate_series(1,512) p CROSS JOIN generate_series(1,1024) j GROUP BY p`);
    await f.query("CREATE UNIQUE INDEX ON map_vector_pool(p)");
    await f.query(`CREATE TEMP TABLE mass_chunks ON COMMIT DROP AS
      SELECT md5($1||':root:'||r)::uuid root_id,'sha256:'||md5('finger:'||r)||md5('finger2:'||r) fingerprint,
        left(repeat(md5('text:'||r)||' ',970),size.length) full_text,chunk_index,md5(r::text||':'||chunk_index) chunk_sha256,0 start_offset,least(size.length,768) end_offset,
        (pool.embedding+array_fill(((r%10000)::real/1000000+chunk_index::real/10000000),ARRAY[1024])::vector)::vector(1024) embedding
      FROM (SELECT r,0 chunk_index FROM generate_series(1,$2::int) r UNION ALL SELECT r,1 FROM generate_series(1,$3::int-$2::int) r) roots
      JOIN map_vector_pool pool ON pool.p=(r%512)+1
      CROSS JOIN LATERAL (SELECT ((r-1)::bigint*10000/$2::int)::int percentile) bucket
      CROSS JOIN LATERAL (SELECT CASE WHEN r=$2 THEN 32001 WHEN bucket.percentile<=5000 THEN 194
        WHEN bucket.percentile<9000 THEN 484 WHEN bucket.percentile<9500 THEN 4521
        WHEN bucket.percentile<9890 THEN 7000 WHEN bucket.percentile<=9900 THEN 18180 ELSE 22000 END length) size`, [f.workspace_id, roots, chunks]);
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
    // A second backend sees zero committed corpus rows, as autovacuum would
    // during this fixture's uncommitted import. Keep this adversarial state;
    // the optional accurate arm measures statistics matching committed UAT.
    await analyzeCommittedCorpusV1();
    if(process.env.NOISIA_MFP_MAP_ACCURATE_STATS_PG_TEST==="true") await f.query("ANALYZE public.mentions");
    const mentionStatistics=(await f.query("SELECT reltuples::int estimated_rows,relpages pages FROM pg_class WHERE oid='public.mentions'::regclass")).rows[0];
    assert.equal(mentionStatistics.estimated_rows,process.env.NOISIA_MFP_MAP_ACCURATE_STATS_PG_TEST==="true"?roots+3:0);
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
    if(process.env.NOISIA_MFP_MAP_AUTO_EXPLAIN === "true") await f.query("LOAD 'auto_explain'; SET auto_explain.log_min_duration='10ms'; SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on; SET auto_explain.log_timing=off; SET auto_explain.log_nested_statements=on; SET auto_explain.log_format=json");
    const samples: Partial<Record<"scores"|"items"|"chunks",unknown[]>> = {};
    let maximumStatementMs=0,statements=0,verifyFirstInsert=true;
    const observed = {query: async(sql:string,values?:unknown[]) => {
      const started=performance.now();
      if(sql.includes("INSERT INTO signal_mass_labeling_items(") && verifyFirstInsert){
        assert.equal((await f.query("SHOW enable_mergejoin")).rows[0].enable_mergejoin,"off");
        verifyFirstInsert=false;
      }
      const result=await f.query(sql,values);
      maximumStatementMs=Math.max(maximumStatementMs,performance.now()-started); statements++;
      if(sql.startsWith("INSERT INTO mass_scores")) samples.scores=values;
      if(sql.startsWith("INSERT INTO mass_batch_chunks")) samples.chunks=values;
      if(sql.includes("INSERT INTO signal_mass_labeling_items(")) samples.items=values;
      return result;
    }} as unknown as Pick<PoolClient,"query">;
    const scoreStarted = performance.now();
    const scored = await prepareMassLabelingMapScoresV1(observed, map);
    const scoreMs = Math.round(performance.now()-scoreStarted);
    const scoringMaximumMs=maximumStatementMs,scoringStatements=statements;
    for(const preference of ["on","off"]){
      verifyFirstInsert=true;
      await f.query("SELECT set_config('enable_mergejoin',$1,true)",[preference]);
      let writesBeforeSqlError=0;
      const sqlFailure={query:async(sql:string,values?:unknown[])=>{
        const result=await observed.query(sql,values);
        if(sql.includes("INSERT INTO signal_mass_labeling_items(") && ++writesBeforeSqlError===1)
          await f.query("SELECT 1/0");
        return result;
      }} as unknown as Pick<PoolClient,"query">;
      await assert.rejects(insertMassLabelingMapItemsV1(sqlFailure,{workspace_id:f.workspace_id,map_id:map,
        catalog,map_digest:mapDigest,expected_roots:roots}),error=>error instanceof Error && "code" in error && error.code==="22012");
      assert.equal(writesBeforeSqlError,1);
      assert.equal((await f.query("SHOW enable_mergejoin")).rows[0].enable_mergejoin,preference);
      assert.equal((await f.query("SELECT 41+1 answer")).rows[0].answer,42,"an aborted SQL transaction is recovered before restoring plans");
    }
    await f.query("SET LOCAL enable_mergejoin=on");
    // Prime the unchanged trigger in this backend under the previous planner
    // preference, then lose the acknowledgement after two actual INSERTs.
    // Only this adversarial fixture bypasses the new planning fence, preserving
    // its old SPI plan across rollback so the real retry must invalidate it.
    await f.query("SAVEPOINT interrupted_adoption");
    let writes = 0;
    verifyFirstInsert=false;
    const interrupted = { query: async (sql: string, values?: unknown[]) => {
      let primingSql=sql;
      if(sql==="SET LOCAL enable_mergejoin=off; DISCARD PLANS") primingSql="SET LOCAL enable_mergejoin=on";
      else primingSql=sql.replaceAll("DISCARD PLANS; ","");
      const result = await observed.query(primingSql, values);
      if (sql.includes("INSERT INTO signal_mass_labeling_items(") && ++writes === 2)
        throw new Error("synthetic_map_batch_acknowledgement_lost");
      return result;
    } } as unknown as Pick<PoolClient, "query">;
    await assert.rejects(insertMassLabelingMapItemsV1(interrupted, { workspace_id: f.workspace_id, map_id: map,
      catalog, map_digest: mapDigest, expected_roots: roots }), /synthetic_map_batch_acknowledgement_lost/u);
    assert.equal(writes, 2);
    assert.equal((await f.query("SHOW enable_mergejoin")).rows[0].enable_mergejoin,"on","JavaScript interruption restores the previous planner preference");
    await f.query("ROLLBACK TO SAVEPOINT interrupted_adoption");
    await f.query("RELEASE SAVEPOINT interrupted_adoption");
    const rolledBack = (await f.query(`SELECT
      (SELECT count(*)::int FROM signal_mass_labeling_items WHERE map_id=$1) items,
      (SELECT count(*)::int FROM signal_mass_labeling_root_segments WHERE map_id=$1) segments,
      (SELECT count(*)::int FROM signal_mass_labeling_product_estimates WHERE map_id=$1) estimates,
      (SELECT count(*)::int FROM signal_mass_labeling_topic_probabilities WHERE map_id=$1) candidates,
      (SELECT count(*)::int FROM signal_mass_labeling_category_matches category JOIN mass_chunks chunk ON chunk.root_id=category.root_id
        AND chunk.chunk_index=0 WHERE category.workspace_id=$2) categories`, [map, f.workspace_id])).rows[0];
    assert.deepEqual(rolledBack, { items: 0, segments: 0, estimates: 0, candidates: 0, categories: 0 });
    console.log("map_adoption_acceptance", JSON.stringify({ phase: "rollback_verified_then_insert", roots }));
    const adversarialMaximumMs=Math.round(maximumStatementMs);
    maximumStatementMs=scoringMaximumMs; statements=scoringStatements; verifyFirstInsert=true;
    const insertStarted = performance.now();
    const inserted = await insertMassLabelingMapItemsV1(observed, { workspace_id: f.workspace_id, map_id: map,
      catalog, map_digest: mapDigest, expected_roots: roots });
    const insertMs = Math.round(performance.now()-insertStarted);
    assert.equal((await f.query("SHOW enable_mergejoin")).rows[0].enable_mergejoin,"on","successful adoption restores the previous planner preference");
    assert.equal((await f.query("SELECT to_regclass('pg_temp.mass_map_items') relation")).rows[0].relation, null, "candidate JSON is prepared only inside bounded root INSERTs");
    assert.equal(inserted.root_count, roots);
    assert.equal(scored.batch_count, Math.ceil(roots/1000));
    assert.ok(scored.maximum_batch_ms<90_000);
    assert.ok(inserted.maximum_prepare_ms<90_000);
    const cache=(await f.query(`SELECT root_count,input_characters::text characters FROM signal_mass_labeling_product_estimates WHERE map_id=$1`,[map])).rows[0];
    const cacheMissStarted=performance.now();
    const exact=(await f.query(`SELECT sum(length(text)+length(candidates::text))::text characters FROM signal_mass_labeling_items WHERE map_id=$1`,[map])).rows[0];
    const cacheMissMs=Math.round(performance.now()-cacheMissStarted);
    assert.deepEqual(cache,{root_count:roots,characters:exact.characters});
    assert.equal(inserted.input_characters,exact.characters);
    let cacheHitQueries=0;
    const hitClient={query:async(sql:string,values?:unknown[])=>{
      assert.ok(!sql.includes("length(item.candidates::text)"),"a new map quote does not reread/serialize candidate packets");
      cacheHitQueries++; return f.query(sql,values);
    }} as unknown as Pick<PoolClient,"query">;
    const configuration={category:"Synthetic category",candidate_language:"en" as const,interests:[]};
    const hitStarted=performance.now();
    const quote=await loadMassLabelingProductEstimateWithClientV2(hitClient,{workspace_id:f.workspace_id,map_id:map,configuration});
    const cacheHitMs=Math.round(performance.now()-hitStarted);
    assert.equal(cacheHitQueries,1);
    assert.equal(quote,estimateMassLabelingProductV2({roots,characters:Number(exact.characters)},configuration));
    const withInterest={...configuration,interests:[{key:"synthetic_interest",name:"Synthetic interest",definition:"A synthetic subject."}]};
    const changed=await loadMassLabelingProductEstimateWithClientV2(hitClient,{workspace_id:f.workspace_id,map_id:map,configuration:withInterest});
    assert.equal(changed,estimateMassLabelingProductV2({roots,characters:Number(exact.characters)},withInterest));
    assert.equal(cacheHitQueries,2,"interests are recalculated outside the immutable input-size cache");
    assert.equal(inserted.batch_count, Math.ceil(roots/1000));
    assert.ok(inserted.batch_count>=3);
    assert.ok(inserted.maximum_batch_ms<90_000);
    const counts = (await f.query(`SELECT
      (SELECT count(*)::int FROM mass_scores) scores,
      (SELECT count(*)::int FROM signal_mass_labeling_items WHERE map_id=$1) items,
      (SELECT count(*)::int FROM signal_mass_labeling_root_segments WHERE map_id=$1) segments,
      (SELECT count(*)::int FROM signal_mass_labeling_topic_probabilities WHERE map_id=$1) candidates`, [map])).rows[0];
    assert.deepEqual(counts, { scores: roots*8, items: roots, segments: roots, candidates: roots*8 });
    assert.ok(scoreMs+insertMs<600_000, "adoption stays within the native ten-minute materialization lease");
    const plans=[];
    for(const [kind,sql,values] of [["chunks",MASS_LABELING_MAP_BATCH_CHUNKS_SQL_V1,samples.chunks],["scores",MASS_LABELING_MAP_SCORES_SQL_V1,samples.scores],
      ["items",MASS_LABELING_MAP_ITEM_INPUT_SQL_V1,samples.items]] as const){
      const explained=(await f.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,values)).rows[0]["QUERY PLAN"][0];
      const reads=nodes(explained.Plan as Plan).filter(node=>["mass_chunks","mass_root_vectors","mass_scores","mass_map_roots"].includes(node["Relation Name"]??""));
      assert.ok(reads.length>0);
      for(const read of reads){
        if(fullScale) assert.match(read["Node Type"],/Index|Bitmap/u,"scale batches use indexed corpus ranges");
        assert.ok((read["Actual Rows"]??0)*(read["Actual Loops"]??1)<=1000*8,"a batch does not rescan the full corpus");
      }
      plans.push({kind,execution_ms:explained["Execution Time"],reads:reads.map(read=>({
        relation:read["Relation Name"],type:read["Node Type"],rows:read["Actual Rows"],loops:read["Actual Loops"],
        local_hits:read["Local Hit Blocks"],condition:read["Index Cond"]}))});
    }
    // Explain the exact migrated category statement with an equivalent bounded
    // transition table. Assert work by eligible roots, not a particular join.
    await f.query("SAVEPOINT category_plan_probe");
    await f.query("CREATE TEMP TABLE admitted_items ON COMMIT DROP AS SELECT * FROM signal_mass_labeling_items WHERE map_id=$1 AND ordinal>$2",[map,roots-1000]);
    const categoryBody=(await f.query("SELECT prosrc FROM pg_proc WHERE oid='materialize_signal_mass_labeling_category_item_v1()'::regprocedure")).rows[0].prosrc as string;
    const categorySql=categoryBody.slice(categoryBody.indexOf("WITH patterns AS MATERIALIZED"),categoryBody.indexOf("RETURN NULL;")).trim();
    assert.ok(categorySql.startsWith("WITH patterns AS MATERIALIZED"));
    await f.query("SET LOCAL enable_mergejoin=off; DISCARD PLANS");
    const categoryPlan=(await f.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${categorySql}`)).rows[0]["QUERY PLAN"][0];
    const mentionReads=nodes(categoryPlan.Plan as Plan).filter(node=>node["Relation Name"]==="mentions");
    assert.ok(mentionReads.length>0);
    const triggerMentionRows=mentionReads.reduce((sum,node)=>sum+((node["Actual Rows"]??0)+(node["Rows Removed by Filter"]??0)
      +(node["Rows Removed by Index Recheck"]??0))*(node["Actual Loops"]??1),0);
    const triggerMaximumRows=Math.max(...nodes(categoryPlan.Plan as Plan).map(node=>((node["Actual Rows"]??0)
      +(node["Rows Removed by Filter"]??0)+(node["Rows Removed by Join Filter"]??0))*(node["Actual Loops"]??1)));
    assert.ok(triggerMentionRows<=roots+1000,"at most one corpus pass is allowed for a small-table hash plan");
    assert.ok(triggerMaximumRows<=2*(roots+1000),"the category projection never multiplies corpus rows by admitted roots");
    await f.query("ROLLBACK TO SAVEPOINT category_plan_probe; DISCARD PLANS; RELEASE SAVEPOINT category_plan_probe");
    assert.equal((await f.query("SHOW enable_mergejoin")).rows[0].enable_mergejoin,"on");
    const storage=(await f.query(`SELECT pg_total_relation_size('mass_root_vectors')::text root_vectors_bytes,
      pg_total_relation_size('mass_map_roots')::text root_keys_bytes,
      pg_total_relation_size('mass_batch_chunks')::text last_batch_chunks_bytes,
      pg_total_relation_size('mass_candidate_catalog')::text catalog_bytes`)).rows[0];
    const textLengths=(await f.query(`SELECT round(avg(length(full_text)),2)::text mean,
      percentile_cont(ARRAY[.5,.95,.99]) WITHIN GROUP(ORDER BY length(full_text)) percentiles,max(length(full_text)) maximum
      FROM mass_chunks WHERE chunk_index=0`)).rows[0];
    assert.ok(maximumStatementMs<90_000);
    t.diagnostic(JSON.stringify({ roots, chunks, topics, text_lengths:textLengths,lexicon_terms:129,mention_statistics:mentionStatistics,trigger_mention_rows_read:triggerMentionRows,trigger_maximum_node_rows:triggerMaximumRows,trigger_plan_ms:categoryPlan["Execution Time"],storage, plans,
      maximum_statement_ms:Math.round(maximumStatementMs),adversarial_prior_plan_maximum_ms:adversarialMaximumMs,statements,cache_miss_aggregate_ms:cacheMissMs,cache_hit_ms:cacheHitMs,
      adoption_roots_per_second:Math.round(roots/((scoreMs+insertMs)/1000)), dimensions: 1024, work_mem: "4MB", statement_budget_ms: 90_000,
      score_ms: scoreMs, score_batches:scored.batch_count, maximum_score_ms:scored.maximum_batch_ms, root_aggregate_ms:scored.aggregate_ms, insert_with_guards_and_projections_ms: insertMs, ...inserted, counts }));
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
