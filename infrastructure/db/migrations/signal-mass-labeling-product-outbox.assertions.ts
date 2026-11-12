import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { SIGNAL_WORKSPACE_ENGINE_JOB_V1 } from "@noisia/query-engine";
import { drainSignalTopicClassificationOutboxV1 } from "../../../services/workers/src/workers/signal-topic-classification-outbox";

/** Real native admission and outbox first, then isolated malformed-owner cases.
 * Queue receipts are synthetic. This never consumes a numerical or paid job. */
export async function assertMassLabelingProductOutboxV1(args: {
  database: Pool; client: PoolClient; execution_id: string;
}) {
  const { database,client,execution_id } = args;
  const owner = (await database.query(`SELECT execution.*,outbox.worker_job_id
    FROM signal_topic_catalog_executions execution JOIN signal_topic_classification_outbox outbox
      ON outbox.execution_id=execution.id AND outbox.dispatch_kind='execution'
    WHERE execution.id=$1`, [execution_id])).rows[0]!;
  assert.ok(owner.processing_admission_id);
  const jobs = new Map<string, { name: string; getState(): Promise<string>; retry(): Promise<void> }>();
  const added: string[] = [];
  let loseAcknowledgement = false;
  const queue = {
    async getJob(id: string) { return jobs.get(id); },
    async add(name: string,data: unknown,options: Record<string,unknown>) {
      const id = String(options.jobId);
      assert.equal(name,SIGNAL_WORKSPACE_ENGINE_JOB_V1);
      assert.deepEqual(data,{ execution_id });
      assert.equal(options.attempts,1);
      added.push(id);
      jobs.set(id,{ name,getState:async () => "waiting",retry:async () => { assert.fail("waiting jobs are not retried"); } });
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw Object.assign(new Error("synthetic lost enqueue acknowledgement"),{ code:"ECONNRESET" });
      }
    },
  };
  const drain = (source: Pick<Pool,"query" | "connect"> = database) => drainSignalTopicClassificationOutboxV1({
    database:source,queue,schedule:async () => ({ requeued:0 }),
  });
  assert.deepEqual(await drain(),{ claimed:1,dispatched:1,failed:0,dead_lettered:0 });
  assert.deepEqual(added,[owner.worker_job_id]);
  assert.deepEqual(await drain(),{ claimed:0,dispatched:0,failed:0,dead_lettered:0 });

  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path=pg_temp,public,extensions,pg_catalog");
    // Public guards continue to read the actual fixture's actor and feature.
    // Only these transport owners/receipts are shadowed for adverse cases.
    for (const relation of ["signal_topic_catalog_executions","signal_topic_classification_outbox",
      "signal_processing_admissions","signal_processing_policy_versions"]) {
      await client.query(`CREATE TEMP TABLE ${relation} (LIKE public.${relation} INCLUDING DEFAULTS)`);
    }
    await client.query("INSERT INTO pg_temp.signal_topic_catalog_executions SELECT * FROM public.signal_topic_catalog_executions WHERE id=$1",[execution_id]);
    await client.query("INSERT INTO pg_temp.signal_topic_classification_outbox SELECT * FROM public.signal_topic_classification_outbox WHERE execution_id=$1",[execution_id]);
    await client.query("INSERT INTO pg_temp.signal_processing_admissions SELECT * FROM public.signal_processing_admissions WHERE id=$1",[owner.processing_admission_id]);
    await client.query(`INSERT INTO pg_temp.signal_processing_policy_versions SELECT policy.* FROM public.signal_processing_policy_versions policy
      JOIN pg_temp.signal_processing_admissions admission ON admission.policy_version_id=policy.id`);
    await client.query(`UPDATE pg_temp.signal_topic_classification_outbox
      SET status='pending',attempt_count=0,available_at=now(),dispatched_at=NULL`);
    const scoped = { query:client.query.bind(client),connect:async () => { throw new Error("unexpected nested connection"); } } as unknown as Pool;
    const blocked: Array<[string,string,unknown[]]> = [
      ["private v1","UPDATE pg_temp.signal_topic_catalog_executions SET input_snapshot=jsonb_set(input_snapshot-'mass_labeling_product','{engine_config,profile_version}','\"workspace-bertopic-mass-labeling-v1\"')",[]],
      ["private v2","UPDATE pg_temp.signal_topic_catalog_executions SET input_snapshot=jsonb_set(input_snapshot-'mass_labeling_product','{engine_config,profile_version}','\"workspace-bertopic-mass-labeling-v2\"')",[]],
      ["private v3","UPDATE pg_temp.signal_topic_catalog_executions SET input_snapshot=input_snapshot-'mass_labeling_product'",[]],
      ["string marker","UPDATE pg_temp.signal_topic_catalog_executions SET input_snapshot=jsonb_set(input_snapshot,'{mass_labeling_product}','\"true\"')",[]],
      ["changed profile","UPDATE pg_temp.signal_topic_catalog_executions SET input_snapshot=jsonb_set(input_snapshot,'{interpretation_config,call_configuration,max_output_tokens}','1')",[]],
      ["unknown numerical profile","UPDATE pg_temp.signal_topic_catalog_executions SET input_snapshot=jsonb_set(input_snapshot,'{engine_config,profile_version}','\"unapproved-synthetic-profile\"')",[]],
      ["missing receipt","UPDATE pg_temp.signal_topic_catalog_executions SET processing_admission_id=NULL",[]],
      ["foreign workspace","UPDATE pg_temp.signal_topic_catalog_executions SET workspace_id=$1",[randomUUID()]],
      ["foreign actor","UPDATE pg_temp.signal_processing_admissions SET actor_user_id=$1",[randomUUID()]],
      ["foreign organization","UPDATE pg_temp.signal_processing_admissions SET organization_id=$1",[randomUUID()]],
      ["foreign brand","UPDATE pg_temp.signal_processing_admissions SET brand_id=$1",[randomUUID()]],
      ["foreign target","UPDATE pg_temp.signal_processing_admissions SET target_id=$1",[randomUUID()]],
      ["changed request","UPDATE pg_temp.signal_processing_admissions SET request_digest='sha256:'||repeat('0',64)",[]],
      ["wrong action","UPDATE pg_temp.signal_processing_admissions SET action='corpus_embeddings'",[]],
      ["wrong model","UPDATE pg_temp.signal_processing_admissions SET model='unapproved-synthetic-model'",[]],
      ["wrong provider","UPDATE pg_temp.signal_processing_admissions SET provider='synthetic-other-provider'",[]],
      ["changed configuration","UPDATE pg_temp.signal_processing_admissions SET configuration='{}'",[]],
      ["expired receipt","UPDATE pg_temp.signal_processing_admissions SET admission_not_after=clock_timestamp()-interval '1 second'",[]],
      ["revoked policy","UPDATE pg_temp.signal_processing_policy_versions SET status='revoked'",[]],
      ["expired policy","UPDATE pg_temp.signal_processing_policy_versions SET valid_until=clock_timestamp()-interval '1 second'",[]],
      ["failed owner","UPDATE pg_temp.signal_topic_catalog_executions SET status='failed'",[]],
    ];
    for (const [name,statement,values] of blocked) {
      await client.query("SAVEPOINT rejected_owner");
      try {
        await client.query(statement,values);
        assert.deepEqual(await drain(scoped),{ claimed:0,dispatched:0,failed:0,dead_lettered:0 },name);
        const pending = (await client.query("SELECT status,attempt_count FROM pg_temp.signal_topic_classification_outbox")).rows[0];
        assert.deepEqual(pending,{ status:"pending",attempt_count:0 },name);
      } finally { await client.query("ROLLBACK TO SAVEPOINT rejected_owner"); }
    }
    // A retained Redis job repairs an ambiguous enqueue acknowledgement with
    // the same durable id and without adding or retrying another job.
    const syntheticJob = `synthetic-relay-${execution_id}`;
    await client.query("UPDATE pg_temp.signal_topic_classification_outbox SET worker_job_id=$1",[syntheticJob]);
    loseAcknowledgement = true;
    assert.deepEqual(await drain(scoped),{ claimed:1,dispatched:0,failed:1,dead_lettered:0 });
    await client.query("UPDATE pg_temp.signal_topic_classification_outbox SET available_at=now()");
    assert.deepEqual(await drain(scoped),{ claimed:1,dispatched:1,failed:0,dead_lettered:0 });
    assert.equal(added.filter(id => id===syntheticJob).length,1);
    assert.deepEqual(await drain(scoped),{ claimed:0,dispatched:0,failed:0,dead_lettered:0 });
    await client.query("SAVEPOINT exhausted_product");
    await client.query("UPDATE pg_temp.signal_topic_classification_outbox SET status='failed',attempt_count=8");
    await drain(scoped);
    assert.deepEqual((await client.query(`SELECT execution.status,outbox.status dispatch FROM pg_temp.signal_topic_catalog_executions execution
      JOIN pg_temp.signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id`)).rows[0],
      { status:"failed",dispatch:"dead_letter" });
    await client.query("ROLLBACK TO SAVEPOINT exhausted_product");
    await client.query("UPDATE pg_temp.signal_topic_catalog_executions SET input_snapshot=input_snapshot-'mass_labeling_product'");
    await client.query("UPDATE pg_temp.signal_topic_classification_outbox SET status='failed',attempt_count=8");
    await drain(scoped);
    assert.deepEqual((await client.query("SELECT status,attempt_count FROM pg_temp.signal_topic_classification_outbox")).rows[0],
      { status:"failed",attempt_count:8 });
  } finally { await client.query("ROLLBACK"); }
  console.log("native_product_outbox_admission_scope_and_replay_verified");
}
