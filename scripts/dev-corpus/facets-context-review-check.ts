/** Transactional MFP PostgreSQL check: a membership CE request keeps old facets visible until confirmation. No provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import { requestConceptMembershipsV1 } from "../../infrastructure/db/signal-concept-memberships";
import type { LabelingDatabaseV1 } from "../../infrastructure/db/signal-mention-facets";

type CheckClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  release(): void;
};

await main(async () => {
  const identity = JSON.parse(await readFile(".data/dev-corpus/identity.json", "utf8"));
  const pool = await openDatabase();
  const client: CheckClient = await pool.connect();
  let assertions = 0;
  let passed = false;
  let step = "preflight";
  const previousMembershipFlag=process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;
  const previousFacetsFlag=process.env.NOISIA_MENTION_FACETS_ENABLED;
  try {
    process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED="true";
    process.env.NOISIA_MENTION_FACETS_ENABLED="true";
    await client.query("BEGIN");
    const viewBefore=(await client.query<{reloptions:string[]|null;relacl:string[]|null}>(
      "SELECT reloptions,relacl FROM pg_class WHERE oid='signal_mention_facets_current_v1'::regclass")).rows[0]!;
    await client.query(await readFile("infrastructure/db/migrations/0258_signal_membership_context_review.sql","utf8"));
    const viewAfter=(await client.query<{reloptions:string[]|null;relacl:string[]|null}>(
      "SELECT reloptions,relacl FROM pg_class WHERE oid='signal_mention_facets_current_v1'::regclass")).rows[0]!;
    assert.deepEqual(viewAfter,viewBefore,"0258 preserves view options and grants"); assertions++;
    await client.query(`INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by)
      VALUES($1,'concept_membership',$2),($1,'mention_facets',$2) ON CONFLICT(workspace_id,feature) DO NOTHING`,
      [identity.workspace_id,identity.internal_user_id]);
    const active = (await client.query<{ n: number }>(
      "SELECT count(*)::int n FROM signal_labeling_runs WHERE workspace_id=$1 AND kind IN ('facets','membership') AND status IN('queued','running')",
      [identity.workspace_id],
    )).rows[0]!.n;
    assert.equal(active, 0, "the check requires a quiescent fixture"); assertions++;
    const latest = (await client.query<{ version_no: number; digest:string; context: { entities: Array<{entity_id:string;kind:"primary_brand"|"competitor"|"category";name:string;aliases:string[];disambiguation:string|null}> } }>(
      "SELECT version_no,digest,context FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1",
      [identity.workspace_id],
    )).rows[0];
    assert.ok(latest, "a completed CE fixture is required"); assertions++;
    const primary = latest.context.entities.find((entity) => entity.kind === "primary_brand");
    assert.ok(primary); assertions++;
    step = "historical_call";
    const baseRun = (await client.query<{ id: string; call_id: string; labeler_version_id: string; labeler_digest: string; entity_context_digest: string }>(
      `SELECT r.id,c.id call_id,r.labeler_version_id,v.labeler_digest,r.entity_context_digest
       FROM signal_labeling_runs r JOIN signal_labeler_versions v ON v.id=r.labeler_version_id
       JOIN signal_labeling_calls c ON c.run_id=r.id
       WHERE r.workspace_id=$1 AND r.kind='facets' AND v.status<>'retired'
       ORDER BY r.created_at DESC,c.created_at DESC LIMIT 1`,
      [identity.workspace_id],
    )).rows[0];
    assert.ok(baseRun, "a historical facets call is required as a synthetic label reference"); assertions++;
    assert.equal(baseRun.entity_context_digest,latest.digest); assertions++;
    step = "pending_root";
    const root = (await client.query<{root_id:string;input_digest:string}>(
      `SELECT root_id,input_digest FROM signal_mention_facets_current_v1
       WHERE workspace_id=$1 AND status='pending' ORDER BY root_id LIMIT 1`,
      [identity.workspace_id],
    )).rows[0];
    assert.ok(root,"an eligible pending root is required"); assertions++;
    step = "choose_labeler";
    await client.query(
      `INSERT INTO signal_workspace_labelers(workspace_id,kind,labeler_version_id) VALUES($1,'facets',$2)
       ON CONFLICT(workspace_id,kind) DO UPDATE SET labeler_version_id=excluded.labeler_version_id`,
      [identity.workspace_id,baseRun.labeler_version_id],
    );
    const facets = {
      entities:{value:[{entity_id:primary.entity_id,kind:"primary_brand",salience:"main"}],confidence:"high",abstained:false},
      unrelated_reason:null,
      voice:{value:"individual",confidence:"high",abstained:false},
      act:{value:"opinion",confidence:"high",abstained:false},
      spam_or_bot:{value:false,confidence:"high",abstained:false},
      language:{value:"es",confidence:"high",abstained:false},
      asunto:{value:null,confidence:"high",abstained:false},
    };
    step = "insert_fixture_label";
    await client.query(
      `INSERT INTO signal_mention_facet_labels(workspace_id,root_id,input_digest,labeler_digest,entity_context_digest,
       facet_schema_version,status,facets,relevance,effective_entities_digest,call_id)
       VALUES($1,$2,$3,$4,$5,'mention-facets-v1','labeled',$6::jsonb,'relevant',
       signal_labeling_digest_v1(($6::jsonb)#>'{entities,value}'),$7)`,
      [identity.workspace_id,root.root_id,root.input_digest,baseRun.labeler_digest,latest.digest,JSON.stringify(facets),baseRun.call_id],
    );
    step = "baseline";
    const baseline = (await client.query<{root_id:string;status:string;facets:unknown;entity_context_digest:string}>(
      `SELECT root_id,status,facets,entity_context_digest FROM signal_mention_facets_current_v1
       WHERE workspace_id=$1 AND root_id=$2`,
      [identity.workspace_id,root.root_id],
    )).rows;
    assert.equal(baseline.length,1); assertions++;
    assert.equal(baseline[0]!.status,"labeled"); assertions++;
    assert.equal(baseline[0]!.entity_context_digest,latest.digest); assertions++;
    const currentTerms = new Set([primary.name,...primary.aliases]);
    const shortAlias = [..."0123456789abcdef"].map((suffix) => `q${suffix}`).find((term) => !currentTerms.has(term));
    assert.ok(shortAlias,"a free two-character alias is required"); assertions++;
    step = "new_context";
    await client.query(
      "UPDATE brands SET brand_seed_handles=array_append(COALESCE(brand_seed_handles,ARRAY[]::text[]),$2) WHERE id=$1",
      [identity.brand_id,shortAlias],
    );
    // Keep the real product request inside the outer fixture rollback.
    const nested = {query:<Row extends Record<string,unknown>>(sql:string,values?:unknown[])=>client.query<Row>(sql,values),
      connect:async()=>({query:<Row extends Record<string,unknown>>(sql:string,values?:unknown[])=>
        client.query<Row>(sql==="BEGIN"?"SAVEPOINT membership_request":sql==="COMMIT"?"RELEASE SAVEPOINT membership_request":
          sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT membership_request":sql,values),release:()=>{}})} as unknown as LabelingDatabaseV1;
    step = "membership_request";
    const request = await requestConceptMembershipsV1({database:nested,workspace_id:identity.workspace_id,
      actor_user_id:identity.internal_user_id,idempotency_key:`pg-membership-context-${randomUUID()}`,
      provider_available:true,concept:{concept_key:"review_fixture",label:"Review fixture",scope:"all_conversations",
        definition:"Synthetic membership check only",inclusion:[],exclusion:[],positive_examples:[],negative_examples:[],
        definition_digest:`sha256:${"0".repeat(64)}`}});
    const runId=request.run_id;
    const waiting=(await client.query<{kind:string;waiting_full_confirmation:boolean;entity_context_version_no:number}>(
      "SELECT kind,waiting_full_confirmation,entity_context_version_no FROM signal_labeling_runs WHERE id=$1",[runId])).rows[0]!;
    assert.equal(waiting.kind,"membership"); assertions++;
    assert.equal(waiting.waiting_full_confirmation,true); assertions++;
    assert.equal(waiting.entity_context_version_no,latest.version_no+1); assertions++;
    step = "pending_view";
    const pending = (await client.query<{root_id:string;status:string;facets:unknown;entity_context_digest:string;pending_context_review:boolean}>(
      `SELECT root_id,status,facets,entity_context_digest,pending_context_review FROM signal_mention_facets_current_v1
       WHERE workspace_id=$1 AND root_id=ANY($2::uuid[]) ORDER BY root_id`,
      [identity.workspace_id,baseline.map((row) => row.root_id)],
    )).rows;
    assert.equal(pending.length,baseline.length); assertions++;
    for (let i=0;i<baseline.length;i++) {
      assert.equal(pending[i]!.status,baseline[i]!.status); assertions++;
      assert.deepEqual(pending[i]!.facets,baseline[i]!.facets); assertions++;
      assert.equal(pending[i]!.entity_context_digest,baseline[i]!.entity_context_digest); assertions++;
      assert.equal(pending[i]!.pending_context_review,true); assertions++;
    }
    step = "confirm";
    await client.query(
      "UPDATE signal_labeling_runs SET waiting_full_confirmation=false,full_recalculation_confirmed=true WHERE id=$1",
      [runId],
    );
    step = "confirmed_view";
    const confirmed = (await client.query<{status:string;facets:unknown;pending_context_review:boolean}>(
      "SELECT status,facets,pending_context_review FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2",
      [identity.workspace_id,baseline[0]!.root_id],
    )).rows[0]!;
    assert.equal(confirmed.pending_context_review,false); assertions++;
    assert.equal(confirmed.facets,null); assertions++;
    assert.equal(confirmed.status,"pending"); assertions++;
    passed = true;
  } catch (error) {
    console.error(JSON.stringify({fixture_step:step,pg_code:typeof error === "object" && error !== null && "code" in error ? error.code : null}));
    throw error;
  } finally {
    if(previousMembershipFlag===undefined)delete process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;
    else process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED=previousMembershipFlag;
    if(previousFacetsFlag===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;
    else process.env.NOISIA_MENTION_FACETS_ENABLED=previousFacetsFlag;
    try { await client.query("ROLLBACK"); }
    finally { client.release(); await pool.end(); }
  }
  if (passed) console.log(JSON.stringify({status:"pass",check:"membership_context_review",assertions,provider_calls:0,rollback:true}));
});
