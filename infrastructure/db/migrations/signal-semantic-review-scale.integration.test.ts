import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";

import pg from "pg";

import {
  loadSignalSemanticReviewQueueV1,
  reconcileSignalSemanticReviewProjectionV1
} from "../signal-semantic-review";
import {
  applySignalSemanticResolutionResultBatchV2,
  loadSignalSemanticResolutionPreflightDataV2,
  loadSignalSemanticResolutionSelectionV2
} from "../signal-semantic-resolution";

const DATABASE_URL = process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_INTEGRATION_APPROVED === "true";

const IDS = {
  organization: "82000000-0000-4000-8000-000000000001",
  user: "82000000-0000-4000-8000-000000000002",
  brand: "82000000-0000-4000-8000-000000000003",
  workspace: "82000000-0000-4000-8000-000000000004",
  sourceAllowed: "82000000-0000-4000-8000-000000000101",
  sourceQuality: "82000000-0000-4000-8000-000000000102",
  sourceDenied: "82000000-0000-4000-8000-000000000103",
  sourceExpired: "82000000-0000-4000-8000-000000000104",
  sourceIncomplete: "82000000-0000-4000-8000-000000000105",
  batchAllowed: "82000000-0000-4000-8000-000000000201",
  batchQuality: "82000000-0000-4000-8000-000000000202",
  batchDenied: "82000000-0000-4000-8000-000000000203",
  batchExpired: "82000000-0000-4000-8000-000000000204",
  batchIncomplete: "82000000-0000-4000-8000-000000000205",
  qualityAllowed: "82000000-0000-4000-8000-000000000301",
  qualityMinimum: "82000000-0000-4000-8000-000000000302",
  retention: "82000000-0000-4000-8000-000000000303",
  licenseAllowed: "82000000-0000-4000-8000-000000000304",
  licenseDenied: "82000000-0000-4000-8000-000000000305",
  resolutionRun: "82000000-0000-4000-8000-000000000401",
  resolutionChild: "82000000-0000-4000-8000-000000000402",
  resolutionOutbox: "82000000-0000-4000-8000-000000000403",
  budgetRun: "82000000-0000-4000-8000-000000000411",
  budgetChildOne: "82000000-0000-4000-8000-000000000412",
  budgetChildTwo: "82000000-0000-4000-8000-000000000413"
} as const;

const ROOT_COUNT = 120_003;
const SHA_EMPTY = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("Semantic Review 100K projection pages by index and preflight excludes incomplete or unauthorized roots", {
  skip: !DATABASE_URL || !APPROVED,
  timeout: 240_000
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await applyAllMigrations(client);
    await seedScaleFixture(client);

    let queryCount = 0;
    const measured = {
      query: async (sql: string, values?: unknown[]) => {
        queryCount += 1;
        return client.query(sql, values);
      }
    };
    const warmFirstPage: number[] = [];
    let firstPage = await loadSignalSemanticReviewQueueV1(measured, {
      workspace_id: IDS.workspace,
      filters: { state: "unresolved" },
      limit: 50
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const started = performance.now();
      firstPage = await loadSignalSemanticReviewQueueV1(client, {
        workspace_id: IDS.workspace,
        filters: { state: "unresolved" },
        limit: 50
      });
      warmFirstPage.push(performance.now() - started);
    }
    assert.equal(queryCount, 5, "queue request is a fixed five reads, independent of population size");
    assert.equal(firstPage.records.length, 50);
    assert.equal(firstPage.page.total_filtered, ROOT_COUNT + 3);
    assert.ok(firstPage.page.next_cursor);
    assert.ok(percentile(warmFirstPage, 0.95) <= 1_500, "warm first-page p95 exceeds 1.5 seconds");

    const cursorTimings: number[] = [];
    let cursorPage = firstPage;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const started = performance.now();
      cursorPage = await loadSignalSemanticReviewQueueV1(client, {
        workspace_id: IDS.workspace,
        filters: { state: "unresolved" },
        cursor: firstPage.page.next_cursor,
        limit: 50
      });
      cursorTimings.push(performance.now() - started);
    }
    assert.equal(cursorPage.records.length, 50);
    assert.equal(new Set([
      ...firstPage.records.map((item) => item.mention_id),
      ...cursorPage.records.map((item) => item.mention_id)
    ]).size, 100);
    assert.ok(percentile(cursorTimings, 0.95) <= 1_000, "warm cursor p95 exceeds one second");

    const explain = await client.query<{ "QUERY PLAN": unknown }>(`
      EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
      SELECT mention_id
      FROM signal_semantic_review_projection_items
      WHERE workspace_id=$1::uuid AND generation=1 AND queue_state='unresolved'
      ORDER BY published_at DESC,mention_id DESC LIMIT 51
    `, [IDS.workspace]);
    const plan = JSON.stringify(explain.rows[0]?.["QUERY PLAN"]);
    assert.match(plan, /Index Scan|Index Only Scan/);
    assert.doesNotMatch(plan, /Seq Scan/);

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const before = await protectedCounts(client);
    const preflight = await loadSignalSemanticResolutionPreflightDataV2(client, IDS.workspace);
    const selection = await loadSignalSemanticResolutionSelectionV2(client, {
      workspace_id: IDS.workspace,
      projection_snapshot_digest: preflight.projection_snapshot_digest,
      population_digest: preflight.population_digest,
      governance_digest: preflight.governance_digest
    });
    const after = await protectedCounts(client);
    await client.query("COMMIT");
    assert.deepEqual(after, before, "free preflight is read-only");
    assert.equal(preflight.accepted_root_count, ROOT_COUNT + 3);
    assert.equal(preflight.incomplete_provenance_count, 1);
    assert.equal(preflight.quality_excluded_count, 1);
    assert.equal(preflight.licensing_denied_count, 1);
    assert.equal(preflight.licensing_expired_count, 1);
    assert.equal(preflight.llm_eligible_count, ROOT_COUNT);
    assert.equal(preflight.unresolved_count, ROOT_COUNT);
    assert.equal(selection.length, ROOT_COUNT, "selection is complete and never truncated at 100K");
    assert.equal(selection.some((item) => specialIds().includes(item.mention_id)), false);

    await seedResolutionApplicationFixture(client);
    let applicationQueries=0;
    const applying={query:async(sql:string,values?:unknown[])=>{
      applicationQueries+=1;return client.query(sql,values);
    }};
    const resultPayload=[
      {
        provider_custom_id:"mention_82000000000040008000000000000001",mention_id:rootId(1),
        result_status:"succeeded" as const,
        decision:{mention_id:rootId(1),classifications:[{scope:"unattributed" as const,
          entity_id:null,confidence:0.2,rationale:"Insufficient governed evidence."}]},
        classifications:[{scope:"unattributed" as const,entity_id:null,
          entity_type:"unattributed" as const,entity_label:null,confidence:0.2,
          rationale:"Insufficient governed evidence."}],input_tokens:10,output_tokens:5,
        cache_creation_input_tokens:0,cache_read_input_tokens:0,cost_usd:"0.000053",error_code:null
      },
      {
        provider_custom_id:"mention_82000000000040008000000000000002",mention_id:rootId(2),
        result_status:"errored" as const,decision:null,classifications:[],input_tokens:0,
        output_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0,
        cost_usd:"0.000000",error_code:"provider_fixture_error"
      }
    ];
    await client.query("BEGIN");
    const application=await applySignalSemanticResolutionResultBatchV2(applying,{
      run_id:IDS.resolutionRun,child_batch_id:IDS.resolutionChild,
      reviewer_user_id:IDS.user,model_version:"fake-provider-v1",results:resultPayload
    });
    await client.query("COMMIT");
    assert.deepEqual({applied:application.applied,failed:application.failed}, {applied:1,failed:1});
    assert.equal(applicationQueries,7,"result application uses a fixed seven set-based queries per chunk");
    assert.deepEqual(await client.query(`SELECT review_status,eligibility_status,
      approved_by_user_id,approval_source,approved_at FROM signal_mention_attributions
      WHERE workspace_id=$1::uuid AND mention_id=$2::uuid
        AND attribution_basis='mention_semantic'`,[IDS.workspace,rootId(1)]).then((queryResult)=>queryResult.rows[0]),{
      review_status:"pending",eligibility_status:"not_eligible",approved_by_user_id:null,
      approval_source:null,approved_at:null
    },"provider results remain non-serving proposals even at any confidence");
    const assertionCount=await scalar(client,`SELECT count(*) FROM signal_mention_attributions
      WHERE workspace_id=$1::uuid AND mention_id=$2::uuid
        AND attribution_basis='mention_semantic'`,[IDS.workspace,rootId(1)]);
    const reviewEventCount=await scalar(client,`SELECT count(*) FROM signal_mention_attribution_review_events
      WHERE workspace_id=$1::uuid`,[IDS.workspace]);
    await client.query("BEGIN");
    const replay=await applySignalSemanticResolutionResultBatchV2(client,{
      run_id:IDS.resolutionRun,child_batch_id:IDS.resolutionChild,
      reviewer_user_id:IDS.user,model_version:"fake-provider-v1",results:resultPayload
    });
    await client.query("COMMIT");
    assert.equal(replay.replayed,2);
    assert.deepEqual({applied:replay.applied,failed:replay.failed},{applied:0,failed:0});
    assert.equal(await scalar(client,`SELECT count(*) FROM signal_mention_attributions
      WHERE workspace_id=$1::uuid AND mention_id=$2::uuid
        AND attribution_basis='mention_semantic'`,[IDS.workspace,rootId(1)]),assertionCount);
    assert.equal(await scalar(client,`SELECT count(*) FROM signal_mention_attribution_review_events
      WHERE workspace_id=$1::uuid`,[IDS.workspace]),reviewEventCount);

    await exerciseDurableResolutionLifecycle(client);

    const invalidated = rootId(1);
    await client.query(`SELECT queue_signal_semantic_review_projection_refresh_v1(
      $1::uuid,$2::uuid,'assertion_changed',false
    )`, [IDS.workspace, invalidated]);
    const claim = await client.query<{ lease_token: string }>(`
      SELECT lease_token::text FROM claim_signal_semantic_review_projection_v1(1,900)
    `);
    assert.ok(claim.rows[0]?.lease_token);
    const incremental = await reconcileSignalSemanticReviewProjectionV1(client, {
      workspace_id: IDS.workspace,
      lease_token: claim.rows[0]!.lease_token,
      page_size: 500
    });
    assert.equal(incremental.projected_root_count, ROOT_COUNT + 3);
    assert.equal(incremental.projected, ROOT_COUNT + 3);
    assert.equal(await scalar(client, `SELECT dirty_root_count::int FROM signal_semantic_review_projection_state
      WHERE workspace_id=$1::uuid`,[IDS.workspace]), 0);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      roots: ROOT_COUNT + 4,
      accepted_projection_roots: ROOT_COUNT + 3,
      selected_roots: selection.length,
      child_batches_at_50000: Math.ceil(selection.length / 50_000),
      queue_query_count: queryCount,
      warm_first_page_p95_ms: round(percentile(warmFirstPage, 0.95)),
      warm_cursor_p95_ms: round(percentile(cursorTimings, 0.95)),
      explain_uses_index: true,
      writes_during_preflight: 0,
      provider_calls: 0
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
});

async function seedScaleFixture(client: pg.Client) {
  await client.query("SET session_replication_role=replica");
  try {
    await client.query(`INSERT INTO organizations(id,slug,legal_name,status)
      VALUES($1::uuid,'semantic-scale','Semantic Scale','active')`, [IDS.organization]);
    await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
      VALUES($1::uuid,'semantic-scale@example.test','Scale operator','noisia_internal','admin',$2::uuid,'active')`, [IDS.user, IDS.organization]);
    await client.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,status,brand_seed_handles)
      VALUES($1::uuid,$2::uuid,'semantic-scale','Semantic Scale','Semantic Scale','active',ARRAY['@semanticscale'])`, [IDS.brand, IDS.organization]);
    await client.query(`INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,timezone,status)
      VALUES($1::uuid,$2::uuid,$3::uuid,'semantic-scale','America/Mexico_City','active')`, [IDS.workspace, IDS.organization, IDS.brand]);
    const sources = [IDS.sourceAllowed, IDS.sourceQuality, IDS.sourceDenied, IDS.sourceExpired, IDS.sourceIncomplete];
    for (const [index, source] of sources.entries()) {
      await client.query(`INSERT INTO data_sources(
        id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,
        name,status,source_key,governed_scope,governed_entity_type,governed_entity_id,
        scope_policy_version,scope_review_status,scope_approval_source,scope_approved_at
      ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','fixture','csv',
        $5,'active',$6,'primary_brand','brand',$4::uuid,'1','approved','fixture',now())`, [
        source, IDS.workspace, IDS.organization, IDS.brand, `Scale source ${index + 1}`,
        `source-sha256-${source.replaceAll("-", "").padEnd(64, String(index)).slice(0,64)}`
      ]);
    }
    const batches = [
      [IDS.batchAllowed, IDS.sourceAllowed, "completed"],
      [IDS.batchQuality, IDS.sourceQuality, "completed"],
      [IDS.batchDenied, IDS.sourceDenied, "completed"],
      [IDS.batchExpired, IDS.sourceExpired, "completed"],
      [IDS.batchIncomplete, IDS.sourceIncomplete, "failed"]
    ] as const;
    for (const [batch, source, status] of batches) {
      await client.query(`INSERT INTO import_batches(
        id,workspace_id,data_source_id,source_system,source_file_name,status
      ) VALUES($1::uuid,$2::uuid,$3::uuid,'fixture',$4,$5)`, [
        batch, IDS.workspace, source, `${status}-${batch}.csv`, status
      ]);
    }
    await seedPolicies(client);
    await client.query(`
      INSERT INTO mentions(
        id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,
        source_system,text_hash,text_clean,text_snippet,text_length,language,published_at,
        platform,resolved_platform,quality_score,inclusion_status,quality_flags
      )
      SELECT ('82000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,$1::uuid,$2::uuid,
        ('82000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
        'record-'||value,'external-'||value,'fixture',
        'sha256:'||encode(sha256(convert_to('root-'||value,'UTF8')),'hex'),
        'Unresolved neutral semantic record '||value,'Unresolved record',36,'es',
        '2026-08-12T00:00:00Z'::timestamptz-(value||' seconds')::interval,
        'web','web',10,'included','[]'::jsonb
      FROM generate_series(1,$3::int) value
    `, [IDS.workspace, IDS.sourceAllowed, ROOT_COUNT]);
    const special = [
      [specialIds()[0]!, IDS.sourceQuality, 1],
      [specialIds()[1]!, IDS.sourceDenied, 10],
      [specialIds()[2]!, IDS.sourceExpired, 10],
      [specialIds()[3]!, IDS.sourceIncomplete, 10]
    ] as const;
    for (const [mention, source, quality] of special) {
      await client.query(`INSERT INTO mentions(
        id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,
        source_system,text_hash,text_clean,text_snippet,text_length,language,published_at,
        platform,resolved_platform,quality_score,inclusion_status,quality_flags
      ) VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,$1,$1,'fixture',
        'sha256:'||encode(sha256(convert_to($1::text,'UTF8')),'hex'),'Special governed root',
        'Special root',23,'es','2026-08-13T00:00:00Z','web','web',$4,'included','[]'::jsonb)`, [
        mention, IDS.workspace, source, quality
      ]);
    }
    await client.query(`
      INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id)
      SELECT $1::uuid,('82000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
        $2::uuid,$3::uuid FROM generate_series(1,$4::int) value
    `, [IDS.workspace, IDS.batchAllowed, IDS.sourceAllowed, ROOT_COUNT]);
    for (const [mention, source, , batch] of [
      [specialIds()[0]!, IDS.sourceQuality, 1, IDS.batchQuality],
      [specialIds()[1]!, IDS.sourceDenied, 10, IDS.batchDenied],
      [specialIds()[2]!, IDS.sourceExpired, 10, IDS.batchExpired],
      [specialIds()[3]!, IDS.sourceIncomplete, 10, IDS.batchIncomplete]
    ] as const) {
      await client.query(`INSERT INTO signal_mention_import_memberships(
        workspace_id,mention_id,import_batch_id,data_source_id
      ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, [IDS.workspace, mention, batch, source]);
    }
    await client.query(`
      INSERT INTO signal_mention_attributions(
        workspace_id,mention_id,data_source_id,import_batch_id,scope,entity_type,entity_id,
        entity_label,confidence,review_status,attribution_source,policy_version,
        attribution_basis,eligibility_status,is_current
      ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'primary_brand','brand',$5::uuid,
        'Semantic Scale',1,'pending','fixture','1','source_intent','not_eligible',true)
    `, [IDS.workspace, rootId(1), IDS.sourceAllowed, IDS.batchAllowed, IDS.brand]);
    await client.query(`
      INSERT INTO signal_semantic_review_projection_items(
        workspace_id,generation,mention_id,queue_state,published_at,platform,excerpt,title,
        source_intents,source_ids,proposed_assertions,proposed_scopes,current_scopes,
        confidence_bands,current_assertions,candidate_resolution,character_count,
        context_hash,projection_hash
      )
      SELECT mention.workspace_id,1,mention.id,'unresolved',mention.published_at,
        'web',mention.text_snippet,mention.title,
        jsonb_build_array(jsonb_build_object(
          'attribution_id',mention.id::text,'data_source_id',mention.data_source_id::text,
          'source_name','Scale source','import_batch_id',membership.import_batch_id::text,
          'scope','primary_brand','entity_type','brand','entity_id',$2::text,
          'entity_label','Semantic Scale','review_status','approved','policy_version','1'
        )),ARRAY[mention.data_source_id], '[]'::jsonb,ARRAY[]::text[],ARRAY[]::text[],
        ARRAY[]::text[],'[]'::jsonb,'no_governed_identity_match',length(mention.text_clean),
        'sha256:'||encode(sha256(convert_to(mention.id::text||'|context','UTF8')),'hex'),
        'sha256:'||encode(sha256(convert_to(mention.id::text||'|projection','UTF8')),'hex')
      FROM mentions mention
      JOIN signal_mention_import_memberships membership
        ON membership.workspace_id=mention.workspace_id AND membership.mention_id=mention.id
      JOIN import_batches batch ON batch.id=membership.import_batch_id AND batch.status='completed'
      WHERE mention.workspace_id=$1::uuid
    `, [IDS.workspace, IDS.brand]);
    await client.query(`INSERT INTO signal_semantic_review_projection_state(workspace_id)
      VALUES($1::uuid)`,[IDS.workspace]);
    await client.query(`INSERT INTO signal_semantic_review_projection_outbox(
      workspace_id,status,reason,lease_token,lease_expires_at
    ) VALUES($1::uuid,'processing','fixture',$2::uuid,now()+interval '15 minutes')`,[
      IDS.workspace,rootId(800_000_000_001)
    ]);
    await client.query("ANALYZE mentions");
    await client.query("ANALYZE signal_mention_import_memberships");
    await client.query("ANALYZE signal_semantic_review_projection_items");
    const authority=await client.query<{refreshed:number}>(`
      SELECT refresh_signal_semantic_review_resolution_authority_v1(
        $1::uuid,1
      )::int AS refreshed
    `,[IDS.workspace]);
    assert.equal(Number(authority.rows[0]?.refreshed),ROOT_COUNT+3);
    await client.query(`SELECT * FROM complete_signal_semantic_review_projection_v1(
      $1::uuid,1,$2,$3,$4::uuid
    )`,[IDS.workspace,hash("identity"),hash("governance"),rootId(800_000_000_001)]);
  } finally {
    await client.query("SET session_replication_role=origin");
  }
  await client.query("ANALYZE signal_semantic_review_projection_items");
}

async function seedResolutionApplicationFixture(client:pg.Client){
  await client.query(`
    INSERT INTO signal_mention_attributions(
      workspace_id,mention_id,data_source_id,import_batch_id,scope,entity_type,entity_id,
      entity_label,confidence,review_status,attribution_source,policy_version,
      attribution_basis,eligibility_status,is_current
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'primary_brand','brand',$5::uuid,
      'Semantic Scale',1,'pending','fixture','1','source_intent','not_eligible',true)
    ON CONFLICT DO NOTHING
  `,[IDS.workspace,rootId(2),IDS.sourceAllowed,IDS.batchAllowed,IDS.brand]);
  await client.query(`
    INSERT INTO signal_semantic_resolution_runs(
      id,workspace_id,requested_by_user_id,status,model_version,policy_key,policy_version,
      queue_digest,total_items,budget_threshold_usd,budget_cap_usd,estimated_cost_usd,
      over_budget_confirmed,projection_snapshot_digest,population_digest,governance_digest,
      pricing_version,input_usd_per_million_tokens,output_usd_per_million_tokens,
      preflight_digest,request_digest,idempotency_key,estimated_cost_micro_usd,
      hard_cap_micro_usd,provider_batch_item_limit,child_batch_count
    ) VALUES($1::uuid,$2::uuid,$3::uuid,'running','fake-provider-v1',
      'signal-semantic-claude-resolution','3',$4,2,40,100,1,true,$4,$4,$4,
      'fixture-pricing',1.5,7.5,$4,$4,$4,1000000,100000000,50000,1)
  `,[IDS.resolutionRun,IDS.workspace,IDS.user,hash("resolution-fixture")]);
  await client.query(`
    INSERT INTO signal_semantic_resolution_child_batches(
      id,run_id,workspace_id,ordinal,item_count,estimated_input_tokens,
      estimated_output_tokens,estimated_cost_usd,estimated_cost_micro_usd
    ) VALUES($1::uuid,$2::uuid,$3::uuid,1,2,100,100,1,1000000)
  `,[IDS.resolutionChild,IDS.resolutionRun,IDS.workspace]);
  await client.query(`
    INSERT INTO signal_semantic_resolution_run_items(
      run_id,workspace_id,mention_id,context_hash,provider_custom_id,child_batch_id
    ) VALUES
      ($1::uuid,$2::uuid,$3::uuid,$5,'mention_82000000000040008000000000000001',$6::uuid),
      ($1::uuid,$2::uuid,$4::uuid,$5,'mention_82000000000040008000000000000002',$6::uuid)
  `,[IDS.resolutionRun,IDS.workspace,rootId(1),rootId(2),hash("context-fixture"),IDS.resolutionChild]);
  await client.query(`INSERT INTO signal_semantic_resolution_child_outbox(
    id,workspace_id,run_id,child_batch_id,status,completed_at
  ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'completed',now())`,[
    IDS.resolutionOutbox,IDS.workspace,IDS.resolutionRun,IDS.resolutionChild
  ]);
}

async function exerciseDurableResolutionLifecycle(client:pg.Client){
  await client.query(`UPDATE signal_semantic_resolution_child_batches SET
    status='partial',completed_items=1,failed_items=1,completed_at=now()
    WHERE id=$1::uuid`,[IDS.resolutionChild]);
  await client.query(`UPDATE signal_semantic_resolution_runs SET
    status='partial',completed_items=1,failed_items=1,failed_child_batch_count=1,
    completed_at=now() WHERE id=$1::uuid`,[IDS.resolutionRun]);
  const resumeKey=hash("resume-fixture");
  const resumed=await client.query<{child_batch_id:string;replayed:boolean}>(`
    SELECT child_batch_id::text,replayed FROM resume_signal_semantic_resolution_child_v1(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5
    )`,[IDS.workspace,IDS.resolutionRun,IDS.resolutionChild,IDS.user,resumeKey]);
  assert.equal(resumed.rows[0]?.replayed,false);
  const resumedChild=resumed.rows[0]?.child_batch_id;
  assert.ok(resumedChild);
  const replay=await client.query<{child_batch_id:string;replayed:boolean}>(`
    SELECT child_batch_id::text,replayed FROM resume_signal_semantic_resolution_child_v1(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5
    )`,[IDS.workspace,IDS.resolutionRun,IDS.resolutionChild,IDS.user,resumeKey]);
  assert.deepEqual(replay.rows[0],{child_batch_id:resumedChild,replayed:true});
  assert.equal(await scalar(client,`SELECT count(*) FROM signal_semantic_resolution_item_attempts
    WHERE child_batch_id=$1::uuid`,[IDS.resolutionChild]),2);
  assert.equal(await scalar(client,`SELECT count(*) FROM signal_semantic_resolution_child_batches
    WHERE run_id=$1::uuid AND status='superseded'`,[IDS.resolutionRun]),1);
  assert.equal(await scalar(client,`SELECT count(*) FROM signal_semantic_resolution_run_items
    WHERE run_id=$1::uuid AND child_batch_id=$2::uuid AND status='pending'`,[
      IDS.resolutionRun,resumedChild
    ]),1);

  const cancelKey=hash("cancel-fixture");
  const canceled=await client.query<{status:string}>(`SELECT
    request_cancel_signal_semantic_resolution_run_v1($1::uuid,$2::uuid,$3::uuid,$4) AS status`,
    [IDS.workspace,IDS.resolutionRun,IDS.user,cancelKey]);
  assert.equal(canceled.rows[0]?.status,"canceled");
  const cancelReplay=await client.query<{status:string}>(`SELECT
    request_cancel_signal_semantic_resolution_run_v1($1::uuid,$2::uuid,$3::uuid,$4) AS status`,
    [IDS.workspace,IDS.resolutionRun,IDS.user,cancelKey]);
  assert.equal(cancelReplay.rows[0]?.status,"canceled");
  assert.equal(await scalar(client,`SELECT count(*) FROM signal_semantic_resolution_run_events
    WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[IDS.workspace,cancelKey]),1);

  const contractHash=hash("budget-lifecycle");
  await client.query(`INSERT INTO signal_semantic_resolution_runs(
    id,workspace_id,requested_by_user_id,status,model_version,policy_key,policy_version,
    queue_digest,total_items,budget_threshold_usd,budget_cap_usd,estimated_cost_usd,
    over_budget_confirmed,projection_snapshot_digest,population_digest,governance_digest,
    pricing_version,input_usd_per_million_tokens,output_usd_per_million_tokens,
    preflight_digest,request_digest,idempotency_key,estimated_cost_micro_usd,
    hard_cap_micro_usd,provider_batch_item_limit,child_batch_count
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'queued','fake-provider-v1','signal-semantic-claude-resolution',
    '3',$4,2,40,0.000010,0.000010,true,$4,$4,$4,'fixture-pricing',1.5,7.5,$4,$4,$4,
    10,10,1,2)`,[IDS.budgetRun,IDS.workspace,IDS.user,contractHash]);
  await client.query(`INSERT INTO signal_semantic_resolution_child_batches(
    id,run_id,workspace_id,ordinal,item_count,estimated_input_tokens,estimated_output_tokens,
    estimated_cost_usd,estimated_cost_micro_usd
  ) VALUES($1::uuid,$3::uuid,$4::uuid,1,1,1,1,0.000006,6),
    ($2::uuid,$3::uuid,$4::uuid,2,1,1,1,0.000006,6)`,[
      IDS.budgetChildOne,IDS.budgetChildTwo,IDS.budgetRun,IDS.workspace
    ]);
  await client.query(`INSERT INTO signal_semantic_resolution_child_outbox(
    workspace_id,run_id,child_batch_id,status
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'pending'),($1::uuid,$2::uuid,$4::uuid,'pending')`,[
    IDS.workspace,IDS.budgetRun,IDS.budgetChildOne,IDS.budgetChildTwo
  ]);
  const dispatches=await client.query<{outbox_id:string;child_batch_id:string;lease_token:string}>(`
    SELECT outbox_id::text,child_batch_id::text,lease_token::text
    FROM claim_signal_semantic_resolution_child_dispatch_v1(2,60,8)
    WHERE run_id=$1::uuid ORDER BY child_batch_id`,[IDS.budgetRun]);
  assert.equal(dispatches.rowCount,2);
  for(const dispatch of dispatches.rows){
    await client.query(`SELECT complete_signal_semantic_resolution_child_dispatch_v1($1::uuid,$2::uuid)`,[
      dispatch.outbox_id,dispatch.lease_token
    ]);
  }
  const executionLeases=new Map<string,string>();
  for(const dispatch of dispatches.rows){
    const claim=await client.query<{lease_token:string}>(`SELECT
      claim_signal_semantic_resolution_child_execution_v1($1::uuid,$2::uuid,60)::text AS lease_token`,[
        dispatch.outbox_id,dispatch.child_batch_id
      ]);
    executionLeases.set(dispatch.child_batch_id,claim.rows[0]!.lease_token);
  }
  const firstLease=executionLeases.get(IDS.budgetChildOne)!;
  await client.query(`UPDATE signal_semantic_resolution_child_batches
    SET lease_expires_at=now()-interval '1 second' WHERE id=$1::uuid`,[IDS.budgetChildTwo]);
  const reclaimed=await client.query<{outbox_id:string;lease_token:string;attempt:number}>(`
    SELECT outbox_id::text,lease_token::text,attempt::int
    FROM claim_signal_semantic_resolution_child_dispatch_v1(1,60,8)
    WHERE child_batch_id=$1::uuid`,[IDS.budgetChildTwo]);
  assert.equal(reclaimed.rows[0]?.attempt,2,"expired dispatched work is reclaimed after restart");
  await client.query(`SELECT complete_signal_semantic_resolution_child_dispatch_v1($1::uuid,$2::uuid)`,[
    reclaimed.rows[0]!.outbox_id,reclaimed.rows[0]!.lease_token
  ]);
  const reexecution=await client.query<{lease_token:string}>(`SELECT
    claim_signal_semantic_resolution_child_execution_v1($1::uuid,$2::uuid,60)::text AS lease_token`,[
      reclaimed.rows[0]!.outbox_id,IDS.budgetChildTwo
    ]);
  const secondLease=reexecution.rows[0]!.lease_token;
  assert.equal(await scalar(client,`SELECT reserve_signal_semantic_resolution_child_budget_v1(
    $1::uuid,$2::uuid)`,[IDS.budgetChildOne,firstLease]),6);
  await client.query("BEGIN");
  await client.query("SAVEPOINT cap_guard");
  await assert.rejects(client.query(`SELECT reserve_signal_semantic_resolution_child_budget_v1(
    $1::uuid,$2::uuid)`,[IDS.budgetChildTwo,secondLease]),/hard cap would be exceeded/);
  await client.query("ROLLBACK TO SAVEPOINT cap_guard");
  await client.query(`SELECT settle_signal_semantic_resolution_child_budget_v1(
    $1::uuid,$2::uuid,2,1,6)`,[IDS.budgetChildOne,firstLease]);
  await client.query("SAVEPOINT settlement_guard");
  await assert.rejects(client.query(`SELECT settle_signal_semantic_resolution_child_budget_v1(
    $1::uuid,$2::uuid,2,1,7)`,[IDS.budgetChildOne,firstLease]),/exceeds its reservation/);
  await client.query("ROLLBACK TO SAVEPOINT settlement_guard");
  await client.query("COMMIT");
  const budgetCancelKey=hash("budget-cancel-fixture");
  const canceling=await client.query<{status:string}>(`SELECT
    request_cancel_signal_semantic_resolution_run_v1($1::uuid,$2::uuid,$3::uuid,$4) AS status`,[
      IDS.workspace,IDS.budgetRun,IDS.user,budgetCancelKey
    ]);
  assert.equal(canceling.rows[0]?.status,"canceling");
  assert.equal(await scalar(client,`SELECT count(*) FROM signal_semantic_resolution_child_batches
    WHERE run_id=$1::uuid AND status='provider'`,[IDS.budgetRun]),2,
  "cancel never pretends an active provider batch stopped before worker cooperation");
  const outboxByChild=new Map(dispatches.rows.map((row)=>[row.child_batch_id,row.outbox_id]));
  assert.equal((await client.query<{status:string}>(`SELECT fail_signal_semantic_resolution_child_v1(
    $1::uuid,$2::uuid,$3::uuid,'operator_cancel_fixture') AS status`,[
      outboxByChild.get(IDS.budgetChildOne),IDS.budgetChildOne,firstLease
    ])).rows[0]?.status,"canceling");
  assert.equal((await client.query<{status:string}>(`SELECT fail_signal_semantic_resolution_child_v1(
    $1::uuid,$2::uuid,$3::uuid,'operator_cancel_fixture') AS status`,[
      outboxByChild.get(IDS.budgetChildTwo),IDS.budgetChildTwo,secondLease
    ])).rows[0]?.status,"canceled");
}

async function seedPolicies(client: pg.Client) {
  await client.query(`
    INSERT INTO signal_quality_policies(id,organization_id,workspace_id,policy_key,policy_version,
      status,min_quality_score,canonical_root_disposition,definition_hash,created_by_user_id,
      activated_by_user_id,activated_at,creation_idempotency_key) VALUES
      ($1::uuid,$3::uuid,$4::uuid,'scale-quality',1,'active',NULL,'evaluate',$5,$6::uuid,$6::uuid,now(),
       'sha256:'||encode(sha256(convert_to('scale-quality','UTF8')),'hex')),
      ($2::uuid,$3::uuid,$4::uuid,'scale-quality-minimum',1,'active',5,'evaluate',$5,$6::uuid,$6::uuid,now(),
       'sha256:'||encode(sha256(convert_to('scale-quality-minimum','UTF8')),'hex'))
  `, [IDS.qualityAllowed, IDS.qualityMinimum, IDS.organization, IDS.workspace, hash("definition"), IDS.user]);
  await client.query(`
    INSERT INTO signal_retention_policies(id,organization_id,workspace_id,policy_key,policy_version,
      status,retention_state,retention_mode,expiry_action,approval_evidence_hash,definition_hash,created_by_user_id,
      approved_by_user_id,approved_at,creation_idempotency_key) VALUES
      ($1::uuid,$2::uuid,$3::uuid,'scale-retention',1,'active','allowed','indefinite','block_use',
       'sha256:'||encode(sha256(convert_to('scale-retention-evidence','UTF8')),'hex'),
       $4,$5::uuid,$5::uuid,now(),
       'sha256:'||encode(sha256(convert_to('scale-retention','UTF8')),'hex'))
  `, [IDS.retention, IDS.organization, IDS.workspace, hash("definition"), IDS.user]);
  await client.query(`
    INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,
      status,approval_evidence_hash,definition_hash,created_by_user_id,approved_by_user_id,approved_at,
      creation_idempotency_key) VALUES
      ($1::uuid,$3::uuid,$4::uuid,'scale-license',1,'active',
       'sha256:'||encode(sha256(convert_to('scale-license-evidence','UTF8')),'hex'),
       $5,$6::uuid,$6::uuid,now(),
       'sha256:'||encode(sha256(convert_to('scale-license','UTF8')),'hex')),
      ($2::uuid,$3::uuid,$4::uuid,'scale-license-denied',1,'active',
       'sha256:'||encode(sha256(convert_to('scale-license-denied-evidence','UTF8')),'hex'),
       $5,$6::uuid,$6::uuid,now(),
       'sha256:'||encode(sha256(convert_to('scale-license-denied','UTF8')),'hex'))
  `, [IDS.licenseAllowed, IDS.licenseDenied, IDS.organization, IDS.workspace, hash("definition"), IDS.user]);
  await client.query(`
    INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
    VALUES($1::uuid,$2::uuid,'llm-processing','allowed'),
      ($1::uuid,$3::uuid,'llm-processing','prohibited')
  `, [IDS.workspace, IDS.licenseAllowed, IDS.licenseDenied]);
  const bindings = [
    [IDS.sourceAllowed, IDS.qualityAllowed, IDS.licenseAllowed, null],
    [IDS.sourceQuality, IDS.qualityMinimum, IDS.licenseAllowed, null],
    [IDS.sourceDenied, IDS.qualityAllowed, IDS.licenseDenied, null],
    [IDS.sourceExpired, IDS.qualityAllowed, IDS.licenseAllowed, "2026-08-01T00:00:00Z"],
    [IDS.sourceIncomplete, IDS.qualityAllowed, IDS.licenseAllowed, null]
  ] as const;
  for (const [source, quality, license, effectiveTo] of bindings) {
    await client.query(`INSERT INTO signal_provenance_policy_bindings(
      workspace_id,data_source_id,binding_version,status,quality_policy_id,
      retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,
      activated_by_user_id,activated_at,effective_from,effective_to,creation_idempotency_key
    ) VALUES($1::uuid,$2::uuid,1,'active',$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,
      $7::uuid,now(),'2026-01-01T00:00:00Z',$8::timestamptz,$9)`, [
      IDS.workspace, source, quality, IDS.retention, license, hash(`binding-${source}`), IDS.user,
      effectiveTo, hash(`binding-key-${source}`)
    ]);
  }
}

async function protectedCounts(client: pg.Client) {
  const result = await client.query(`SELECT
    (SELECT count(*)::int FROM signal_semantic_resolution_runs) AS runs,
    (SELECT count(*)::int FROM signal_semantic_resolution_run_items) AS items,
    (SELECT count(*)::int FROM signal_semantic_resolution_child_batches) AS children,
    (SELECT count(*)::int FROM signal_semantic_resolution_child_outbox) AS outbox`);
  return result.rows[0];
}

async function applyAllMigrations(client: pg.Client) {
  const { readdir, readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const directory = dirname(fileURLToPath(import.meta.url));
  const files = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const file of files) await client.query(await readFile(join(directory, file), "utf8"));
}

function rootId(value: number) {
  return `82000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function specialIds() {
  return [rootId(900_000_000_001), rootId(900_000_000_002), rootId(900_000_000_003), rootId(900_000_000_004)];
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function scalar(client: pg.Client, sql: string, values: unknown[] = []) {
  const result = await client.query(sql, values);
  return Number(Object.values(result.rows[0] ?? {})[0]);
}

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? Number.POSITIVE_INFINITY;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function requireDisposableLocalDatabase(value: string) {
  const url = new URL(value);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname));
  assert.match(url.pathname, /semantic|test|integration|smoke/);
}
