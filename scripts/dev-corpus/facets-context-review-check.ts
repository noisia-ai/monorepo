/** Transactional MFP PostgreSQL check: provisional full CE keeps serving old labels. No provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import { canonicalEntityContextV1, diffEntityContextV1, entityContextDigestV1 } from "../../packages/query-engine/src/signal-entity-context-v1";

await main(async () => {
  const identity = JSON.parse(await readFile(".data/dev-corpus/identity.json", "utf8"));
  const pool = await openDatabase();
  const client = await pool.connect();
  let assertions = 0;
  let passed = false;
  try {
    await client.query("BEGIN");
    const active = (await client.query<{ n: number }>(
      "SELECT count(*)::int n FROM signal_labeling_runs WHERE workspace_id=$1 AND kind='facets' AND status IN('queued','running')",
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
    const baseRun = (await client.query<{ id: string }>(
      "SELECT id FROM signal_labeling_runs WHERE workspace_id=$1 AND kind='facets' AND status='completed' ORDER BY completed_at DESC LIMIT 1",
      [identity.workspace_id],
    )).rows[0];
    assert.ok(baseRun); assertions++;
    const baseline = (await client.query<{root_id:string;status:string;facets:unknown;entity_context_digest:string}>(
      `SELECT root_id,status,facets,entity_context_digest FROM signal_mention_facets_current_v1
       WHERE workspace_id=$1 AND status IN('labeled','abstained','refused') ORDER BY root_id LIMIT 5`,
      [identity.workspace_id],
    )).rows;
    assert.ok(baseline.length > 0); assertions++;
    const currentTerms = new Set([primary.name,...primary.aliases]);
    const shortAlias = [..."0123456789abcdef"].map((suffix) => `q${suffix}`).find((term) => !currentTerms.has(term));
    assert.ok(shortAlias,"a free two-character alias is required"); assertions++;
    const context = canonicalEntityContextV1({entities:latest.context.entities.map((entity) => entity.entity_id === primary.entity_id
      ? {...entity,aliases:[...entity.aliases,shortAlias]} : entity)});
    const diff = diffEntityContextV1(latest.context,context);
    assert.equal(diff.affected_mode,"full"); assertions++;
    const digest = entityContextDigestV1(context), version = latest.version_no + 1, runId = randomUUID();
    await client.query(
      `INSERT INTO signal_entity_context_versions(workspace_id,version_no,digest,parent_digest,context,diff,affected_mode,affected_count)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'full',0)`,
      [identity.workspace_id,version,digest,latest.digest,JSON.stringify(context),JSON.stringify(diff)],
    );
    await client.query(
      `INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,entity_context_digest,
       entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,actor_user_id,
       processing_admission_id,waiting_full_confirmation,full_recalculation_confirmed)
       SELECT $1,workspace_id,kind,labeler_version_id,preparation_run_id,$2,$3,'queued',0,$1::text,$1::text,
       actor_user_id,processing_admission_id,true,false FROM signal_labeling_runs WHERE id=$4`,
      [runId,digest,version,baseRun.id],
    );
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
    await client.query(
      "UPDATE signal_labeling_runs SET waiting_full_confirmation=false,full_recalculation_confirmed=true WHERE id=$1",
      [runId],
    );
    const confirmed = (await client.query<{status:string;facets:unknown;pending_context_review:boolean}>(
      "SELECT status,facets,pending_context_review FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2",
      [identity.workspace_id,baseline[0]!.root_id],
    )).rows[0]!;
    assert.equal(confirmed.pending_context_review,false); assertions++;
    assert.equal(confirmed.facets,null); assertions++;
    assert.equal(confirmed.status,"pending"); assertions++;
    passed = true;
  } finally {
    try { await client.query("ROLLBACK"); }
    finally { client.release(); await pool.end(); }
  }
  if (passed) console.log(JSON.stringify({status:"pass",check:"facets_context_review",assertions,provider_calls:0,rollback:true}));
});
