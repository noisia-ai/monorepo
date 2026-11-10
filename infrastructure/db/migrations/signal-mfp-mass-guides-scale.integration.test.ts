import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { prepareWorkspaceCorpusTextChunksV1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import { loadSignalWorkspaceMassLabelingGuidesV1 } from "../signal-workspace-mass-labeling-profile";

// Frozen pre-optimization query is the regression oracle for membership,
// duplicate weighting, Unicode extraction and the exact serialized centroid.
const previousQuery = `
    WITH embedded AS MATERIALIZED (
      SELECT run.id,run.preparation_run_id,run.config_digest FROM signal_workspace_embedding_runs run
      JOIN signal_corpus_preparation_input_state state USING(workspace_id)
      WHERE run.workspace_id=$1::uuid AND run.input_contract='corpus' AND run.status='completed'
        AND run.input_revision=state.input_revision AND run.config_digest=$2
        AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())
      ORDER BY run.completed_at DESC,run.id DESC LIMIT 1
    ), fragments AS MATERIALIZED (
      SELECT DISTINCT chunk.value->>'sha256' chunk_sha256,
        signal_topic_utf16_fragment_v1(asset.full_text,(chunk.value->>'start')::int,(chunk.value->>'end')::int) text,
        cache.embedding
      FROM embedded JOIN signal_corpus_preparation_items item ON item.run_id=embedded.preparation_run_id
        AND item.workspace_id=$1::uuid AND item.disposition='eligible'
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
        AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') chunk(value)
      JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$1::uuid
        AND cache.config_digest=embedded.config_digest AND cache.chunk_sha256=chunk.value->>'sha256'
    ), matched AS (
      SELECT seed.scope,fragment.chunk_sha256,fragment.embedding
      FROM jsonb_to_recordset($3::jsonb) seed(scope text,names text[]) CROSS JOIN fragments fragment
      WHERE EXISTS(SELECT 1 FROM unnest(seed.names) name WHERE length(name)>=3
        AND strpos(lower(fragment.text),lower(name))>0)
    ) SELECT scope,avg(embedding)::text vector,
      'sha256:'||encode(sha256(convert_to(string_agg(chunk_sha256,'' ORDER BY chunk_sha256),'UTF8')),'hex') members_digest
      FROM matched GROUP BY scope ORDER BY scope`;

const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

test("mass guides preserve the full eligible population and exact digests at 84k roots", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 240_000,
}, async () => {
  const database = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 1 });
  const client = await database.connect();
  try {
    assert.equal((await client.query("SELECT current_database() name")).rows[0].name, "noisia_mfp_ci");
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='90s'");
    await client.query("SET LOCAL search_path=pg_temp,public,pg_catalog");
    // Temporary relations isolate this read regression from every migrated
    // product table and authorization fixture in the same CI database.
    await client.query(`CREATE TEMP TABLE signal_corpus_preparation_input_state(workspace_id uuid PRIMARY KEY,input_revision bigint);
      CREATE TEMP TABLE signal_workspace_embedding_runs(id uuid,workspace_id uuid,preparation_run_id uuid,
        config_digest text,input_contract text,status text,input_revision bigint,policy_valid_until timestamptz,completed_at timestamptz);
      CREATE TEMP TABLE signal_corpus_preparation_items(workspace_id uuid,run_id uuid,asset_sha256 text,chunk_policy_version text,disposition text);
      CREATE TEMP TABLE signal_corpus_text_assets(workspace_id uuid,text_sha256 text,chunk_policy_version text,full_text text,chunks jsonb,
        PRIMARY KEY(workspace_id,text_sha256,chunk_policy_version));
      CREATE TEMP TABLE signal_workspace_chunk_embeddings(workspace_id uuid,config_digest text,chunk_sha256 text,embedding vector(1024),
        PRIMARY KEY(workspace_id,config_digest,chunk_sha256));`);
    const workspace = randomUUID(), otherWorkspace = randomUUID(), preparation = randomUUID(), oldPreparation = randomUUID();
    const config = SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest;
    const sourceTexts = [
      "Cerveja e café com a marca sintética.",
      "A cerva, a ceva e o litrão aparecem na conversa inventada.",
      "🍺😀 Cerveja e uma marca sintética no mesmo fragmento.",
      "x".repeat(1398) + "😀cerveja depois da borda.",
      "😀".repeat(699) + " cerva 😀 cerveja em outro fragmento.",
      "Uma conversa sem a categoria nem marcas.",
      "cerveja".repeat(700),
      "BrandSynthetic e cerveja têm um exemplo comum.",
    ];
    const assets = Array.from({ length: 256 }, (_, index) => {
      const full_text = sourceTexts[index % sourceTexts.length]! + ` registro sintético ${index}`;
      const text_sha256 = hash(full_text);
      return { text_sha256, full_text, chunks: prepareWorkspaceCorpusTextChunksV1(full_text, text_sha256) };
    });
    for (const full_text of ["cerva exclusiva de outra origem", "cerveja exclusiva da preparação anterior"]) {
      const text_sha256 = hash(full_text);
      assets.push({ text_sha256,full_text,chunks:prepareWorkspaceCorpusTextChunksV1(full_text,text_sha256) });
    }
    await client.query("INSERT INTO signal_corpus_preparation_input_state VALUES($1,2),($2,2)", [workspace, otherWorkspace]);
    await client.query(`INSERT INTO signal_workspace_embedding_runs VALUES
      ($1,$2,$3,$4,'corpus','completed',2,NULL,clock_timestamp()),
      ($5,$2,$6,$4,'corpus','completed',1,NULL,clock_timestamp()+interval '1 hour')`,
      [randomUUID(),workspace,preparation,config,randomUUID(),oldPreparation]);
    await client.query(`INSERT INTO signal_corpus_text_assets
      SELECT $1,text_sha256,'corpus-text-chunks-v1',full_text,chunks
      FROM jsonb_to_recordset($2::jsonb) a(text_sha256 text,full_text text,chunks jsonb)`, [workspace,JSON.stringify(assets)]);
    await client.query(`INSERT INTO signal_corpus_preparation_items
      SELECT $1,$2,($3::text[])[1+(n%256)],'corpus-text-chunks-v1','eligible' FROM generate_series(0,1023) n`,
      [workspace,preparation,assets.map(asset => asset.text_sha256)]);
    // A repeated chunk across multiple assets has one cache vector. Roots that
    // share an asset or a matching alias never multiply its centroid weight.
    const chunks = new Map<string, string>();
    for (const asset of assets) for (const chunk of asset.chunks.chunks)
      chunks.set(chunk.sha256,asset.full_text.slice(chunk.start,chunk.end));
    const vectors = [...chunks].map(([chunk_sha256], ordinal) => ({ chunk_sha256,
      embedding: JSON.stringify(Array.from({ length: 1024 }, (_, dimension) =>
        dimension < 16 ? Math.sin(ordinal * 19 + dimension * 7) / 8 : 0)) }));
    await client.query(`INSERT INTO signal_workspace_chunk_embeddings
      SELECT $1,$2,chunk_sha256,embedding::vector FROM jsonb_to_recordset($3::jsonb) v(chunk_sha256 text,embedding text)`,
      [workspace,config,JSON.stringify(vectors)]);
    await client.query(`INSERT INTO signal_corpus_preparation_items VALUES
      ($1,$2,$3,'corpus-text-chunks-v1','excluded'),($1,$4,$3,'corpus-text-chunks-v1','eligible'),
      ($5,$2,$3,'corpus-text-chunks-v1','eligible')`,
      [workspace,preparation,assets[256]!.text_sha256,oldPreparation,otherWorkspace]);
    await client.query(`INSERT INTO signal_corpus_preparation_items VALUES
      ($1,$2,$3,'corpus-text-chunks-v1','eligible')`,
      [workspace,oldPreparation,assets[257]!.text_sha256]);
    await client.query("ANALYZE signal_corpus_preparation_items; ANALYZE signal_corpus_text_assets; ANALYZE signal_workspace_chunk_embeddings");
    const metadata = { workspace_id:workspace, brand_id:randomUUID(), brand_name:"BrandSynthetic",brand_slug:"synthetic",
      brand_handles:[],description:null,industry:"Cerveja",industry_sub:null,countries:["BR"] };
    const identities = [{scope:"primary_brand",entity_id:metadata.brand_id,entity_label:"BrandSynthetic",aliases:["cerva","cerva"]},
      {scope:"competitor",entity_id:randomUUID(),entity_label:"Synthetic competitor",aliases:["ceva","litrão","cerveja"]}];
    let optimizedSql = "", parameters: unknown[] = [];
    const queryable = { async query<Row extends Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:Row[]}> {
      if(sql.includes("WITH embedded AS MATERIALIZED")) { optimizedSql=sql;parameters=values??[];return client.query(sql,values); }
      if(sql.includes("FROM signal_workspaces workspace")) return {rows:[metadata as unknown as Row]};
      if(sql.includes("SELECT 'primary_brand'::text AS scope")) return {rows:identities as unknown as Row[]};
      if(sql.includes("SELECT 'brand_objective' AS kind")) return {rows:[]};
      throw new Error("Unexpected guide metadata query");
    } };
    const optimized = await loadSignalWorkspaceMassLabelingGuidesV1({queryable,workspace_id:workspace});
    const currentRows = (await client.query(optimizedSql,parameters)).rows;
    const previousRows = (await client.query(previousQuery,parameters)).rows;
    assert.deepEqual(currentRows,previousRows,"membership digests and serialized float32 centroids match the previous query");
    const fragmentProjection = " SELECT chunk_sha256,text FROM fragments ORDER BY chunk_sha256,text";
    const currentFragments = optimizedSql.split(" SELECT matched.scope")[0]! + fragmentProjection;
    const previousFragments = previousQuery.split(" SELECT scope,avg")[0]! + fragmentProjection;
    assert.deepEqual((await client.query(currentFragments,parameters)).rows,
      (await client.query(previousFragments,parameters)).rows,"every UTF-16 fragment matches the previous decoder");
    assert.equal(optimized.guides.length,3);
    assert.deepEqual(optimized.guides.map(guide=>guide.guide_key),["scope:category","scope:competitor","scope:primary_brand"]);
    const astralAsset = assets[2]!;
    for (const [start,end] of [[-1,1],[0,1401],[0,astralAsset.chunks.code_units+1],[1,3],[0,1],[4,3],[2147483647,2147483647]]) {
      await client.query("SAVEPOINT invalid_offsets");
      try {
        const chunks = { ...astralAsset.chunks,chunks:[{start,end,sha256:astralAsset.chunks.chunks[0]!.sha256}] };
        await client.query("UPDATE signal_corpus_text_assets SET chunks=$2::jsonb WHERE text_sha256=$1",
          [astralAsset.text_sha256,JSON.stringify(chunks)]);
        for (const statement of [currentFragments,previousFragments]) {
          await client.query("SAVEPOINT decoder_attempt");
          await assert.rejects(client.query(statement,parameters),error=>
            error instanceof Error && "code" in error && error.code==="22023");
          await client.query("ROLLBACK TO SAVEPOINT decoder_attempt");
        }
      } finally { await client.query("ROLLBACK TO SAVEPOINT invalid_offsets"); }
    }
    await client.query(`INSERT INTO signal_corpus_preparation_items
      SELECT $1,$2,($3::text[])[1+(n%256)],'corpus-text-chunks-v1','eligible' FROM generate_series(1024,83961) n`,
      [workspace,preparation,assets.map(asset => asset.text_sha256)]);
    await client.query("ANALYZE signal_corpus_preparation_items");
    assert.equal((await client.query("SELECT count(*)::int n FROM signal_corpus_preparation_items WHERE run_id=$1 AND workspace_id=$2 AND disposition='eligible'",[preparation,workspace])).rows[0].n,83962);
    const second = await loadSignalWorkspaceMassLabelingGuidesV1({queryable,workspace_id:workspace});
    assert.deepEqual(second,optimized,"guide hashes and numerical order are reproducible");
    console.log("mass_guides_scale_exact_parity",JSON.stringify({roots:83962,assets:assets.length,chunks:chunks.size,scopes:optimized.guides.length}));
  } finally {
    await client.query("ROLLBACK");client.release();await database.end();
  }
});
