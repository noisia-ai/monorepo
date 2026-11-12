import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createSignalSentioneCsvIngester } from "../sentione-csv-ingest";
import { createMassLabelingProductDatabaseFixtureV1 } from "./signal-mass-labeling-product-database.synthetic.fixture";

// The CI fixture pins PostgreSQL 17 and creates its own synthetic database.
// Local opt-in targets must also be disposable and explicitly named for this test.
const ci = process.env.GITHUB_ACTIONS === "true" && process.env.NOISIA_MFP_PG_CI === "true";
const target = process.env.NOISIA_SENTIONE_LOOKUP_TEST_URL;

test("canonical chunk lookup keeps recovery semantics and bounded reads with stale workspace statistics", {
  skip: !ci && !target, timeout: 240_000
}, async (context) => {
  const fixture = ci ? await createMassLabelingProductDatabaseFixtureV1() : null;
  let local: pg.Client | undefined;
  let client: pg.Client | pg.PoolClient;
  if (fixture) {
    client = await fixture.database.connect();
  } else {
    const url = new URL(target!);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.match(url.pathname, /^\/noisia_sentione_lookup_test_/u);
    assert.equal(url.search, "", "connection overrides are prohibited");
    assert.equal(url.hash, "", "connection fragments are prohibited");
    local = new pg.Client({ connectionString: url.toString(), ssl: false });
    await local.connect();
    client = local;
  }
  const schema = `lookup_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE mentions (
        id uuid PRIMARY KEY, canonical_mention_id uuid, workspace_id uuid,
        text_hash text, provider_record_id text, data_source_id uuid,
        source_system text, source_file_id uuid, inclusion_status text,
        external_id text, synthetic_payload text
      ) WITH (autovacuum_enabled=false);
      CREATE INDEX idx_mentions_text_hash ON mentions(text_hash);
      CREATE UNIQUE INDEX uq_mentions_workspace_text_canonical
        ON mentions(workspace_id,text_hash,
          (CASE WHEN left(external_id,7)='revise:' THEN coalesce(provider_record_id,'') ELSE '' END))
        WHERE canonical_mention_id=id;
      CREATE UNIQUE INDEX uq_mentions_workspace_provider_canonical
        ON mentions(workspace_id,source_system,
          (CASE WHEN left(external_id,7)='revise:' THEN data_source_id::text ELSE '' END),provider_record_id)
        WHERE canonical_mention_id=id;
      CREATE TABLE import_batches(id uuid PRIMARY KEY, workspace_id uuid,
        data_source_id uuid, supersedes_import_batch_id uuid);
      CREATE TABLE signal_mention_import_memberships(
        workspace_id uuid, mention_id uuid, import_batch_id uuid, ingestion_disposition text,
        UNIQUE(mention_id,import_batch_id));
      CREATE INDEX idx_membership_workspace
        ON signal_mention_import_memberships(workspace_id,mention_id);
    `);
    const foreign = randomUUID(), workspace = randomUUID(), source = randomUUID();
    const current = randomUUID(), predecessor = randomUUID(), otherSource = randomUUID();
    await client.query(`INSERT INTO import_batches VALUES
      ($1,$3,$4,$2),($2,$3,$4,NULL)`, [current, predecessor, workspace, source]);
    const seed = `INSERT INTO mentions
      SELECT id,id,$1::uuid,md5(i::text),'provider-'||i,$2::uuid,'listening_csv',
        $3::uuid,CASE WHEN i%7=0 THEN 'excluded' ELSE 'included' END,
        'ordinary-'||i,repeat(md5(i::text),32)
      FROM (SELECT gen_random_uuid() id,i FROM generate_series(1,100000)i) generated`;
    await client.query(seed, [foreign, source, predecessor]);
    await client.query("ANALYZE mentions");
    // New workspaces have no table statistics yet during a normal first import.
    await client.query(seed, [workspace, source, predecessor]);
    await client.query(`INSERT INTO signal_mention_import_memberships
      SELECT workspace_id,id,CASE WHEN provider_record_id='provider-1' THEN $2::uuid ELSE $3::uuid END,
        inclusion_status FROM mentions WHERE workspace_id=$1 AND provider_record_id=ANY($4::text[])`,
    [workspace, current, predecessor, ["provider-1", "provider-2"]]);
    const [noncanonical, revised] = [randomUUID(), randomUUID()];
    await client.query(`INSERT INTO mentions(id,canonical_mention_id,workspace_id,text_hash,
      provider_record_id,data_source_id,source_system,source_file_id,inclusion_status,external_id)
      VALUES($1,NULL,$3,md5('1'),'provider-1',$4,'listening_csv',$5,'included','uncanonical'),
        ($2,$2,$3,md5('revision'),'provider-revision',$6,'listening_csv',$5,'included','revise:fixture')`,
    [noncanonical, revised, workspace, source, predecessor, otherSource]);
    const query = await captureLookup();
    const candidateStart = query.indexOf(", candidate_rows AS MATERIALIZED (");
    const projection = query.indexOf("\n        SELECT mention.id,mention.text_hash", candidateStart);
    assert.ok(candidateStart > 0 && projection > candidateStart);
    const oracle = (query.slice(0, candidateStart) + query.slice(projection))
      .replace("FROM candidate_rows mention", "FROM mentions mention")
      + ` AND (($7::boolean=false AND mention.text_hash=ANY($3::text[]))
        OR (mention.source_system='listening_csv' AND mention.provider_record_id=ANY($4::text[])
          AND ($7::boolean=false OR mention.data_source_id=$6::uuid)))`;
    const normalize = (rows: pg.QueryResultRow[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
    for (const [name, start, count] of [["existing", 1, 500], ["absent", 200001, 500], ["mixed", 99751, 500]] as const) {
      const numbers = Array.from({ length: count }, (_, index) => start + index);
      const params = [workspace, current, numbers.map(hash), numbers.map(value => `provider-${value}`), predecessor, source, false];
      const expected = normalize((await client.query(oracle, params)).rows);
      const actual = normalize((await client.query(query, params)).rows);
      assert.deepEqual(actual, expected, `${name}: identity, ownership and recovery dispositions`);
      assert.equal(actual.length, name === "existing" ? 500 : name === "absent" ? 0 : 250);
      assert.ok(actual.every(row => row.id !== noncanonical));
      if (name === "existing") {
        assert.equal(actual.find(row => row.provider_record_id === "provider-2")?.predecessor_disposition, "included");
        assert.equal(actual.find(row => row.provider_record_id === "provider-3")?.origin_disposition, "included");
      }
      const baseline = (await client.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${oracle}`, params)).rows[0]["QUERY PLAN"][0];
      const optimized = (await client.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query}`, params)).rows[0]["QUERY PLAN"][0];
      const nodes = flatten(optimized.Plan);
      assert.ok(nodes.some(node => node["Index Name"] === "idx_mentions_text_hash" && String(node["Index Cond"]).includes("text_hash")));
      assert.ok(nodes.some(node => String(node["Index Cond"]).includes("provider_record_id")));
      assert.ok(optimized.Plan["Shared Hit Blocks"] + optimized.Plan["Shared Read Blocks"]
        < (baseline.Plan["Shared Hit Blocks"] + baseline.Plan["Shared Read Blocks"]) / 2,
      `${name}: candidate lookups must avoid reading the full workspace heap`);
      context.diagnostic(JSON.stringify({ distribution: name, roots: actual.length,
        baseline_ms: baseline["Execution Time"], optimized_ms: optimized["Execution Time"],
        baseline_buffers: baseline.Plan["Shared Hit Blocks"] + baseline.Plan["Shared Read Blocks"],
        optimized_buffers: optimized.Plan["Shared Hit Blocks"] + optimized.Plan["Shared Read Blocks"] }));
    }
    for (const revise of [false, true]) {
      const params = [workspace, current, [hash(1), hash("revision")], ["provider-1", "provider-revision"], predecessor, source, revise];
      assert.deepEqual(normalize((await client.query(query, params)).rows), normalize((await client.query(oracle, params)).rows));
      const rows = (await client.query(query, params)).rows;
      assert.equal(rows.some(row => row.id === revised), !revise, "explicit revisions only resolve their own data source");
      const currentRow = rows.find(row => row.provider_record_id === "provider-1");
      assert.equal(currentRow?.already_in_batch, true);
      assert.equal(currentRow?.ingestion_disposition, "included");
      assert.equal(currentRow?.origin_disposition, "included");
    }
  } finally {
    try { await client.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally {
      if (local) await local.end();
      else (client as pg.PoolClient).release();
      await fixture?.cleanup();
    }
  }
});

const hash = (value: string | number) => createHash("md5").update(String(value)).digest("hex");
type Plan = Record<string, unknown> & { Plans?: Plan[] };
const flatten = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(flatten)];

async function captureLookup(): Promise<string> {
  let captured = "";
  const sentinel = new Error("lookup captured before persistence");
  const pool = { async query(sql: string) {
    if (sql.includes("WITH RECURSIVE recovery_lineage")) { captured = sql; throw sentinel; }
    return { rows: [] };
  } };
  const bytes = new TextEncoder().encode('Created;id;Content of posts\n2026-08-01T12:00:00Z;synthetic;A synthetic message with enough content to be imported.\n');
  await assert.rejects(createSignalSentioneCsvIngester(pool as never).ingestSentioneCsvStream({
    workspaceId: randomUUID(), dataSourceId: randomUUID(), importBatchId: randomUUID(),
    sourceFileName: "synthetic.csv", stream: new ReadableStream({ start(controller) {
      controller.enqueue(bytes); controller.close();
    } })
  }), error => error === sentinel);
  assert.ok(captured);
  return captured;
}
