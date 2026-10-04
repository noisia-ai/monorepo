import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as configuration } from "@noisia/query-engine";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";
import { admitSignalProcessingWithClientV1 as admit, type SignalProcessingAdmitArgsV1 } from "../signal-processing-policy";
import type { SignalWorkspaceEngineArtifactV1 } from "../signal-workspace-engine";
import { loadSignalDiscoveryPolicyV1 } from "../signal-workspace-discovery-policy";

// Real policy/admission SQL, invented identities, no provider or durable mutation.
// Root applies forward DDL separately on the identity-verified private MFP runner.
test("MFP self-service: nullable/strict admission, live client authority and exact money binding", {
  skip: process.env.NOISIA_MFP_DISCOVERY_SELF_SERVICE_PG_TEST !== "true"
}, async () => {
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const database: Pool = await openDatabase();
  const scoped = await database.connect();
  try {
    assert.equal((await scoped.query("SELECT current_database() name")).rows[0].name, "noisia_mfp");
    await scoped.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const ddl = [
      ["0231_signal_discovery_unrelated_state.sql", "SELECT position('unrelated' in pg_get_viewdef('signal_topic_consolidation_snapshot_roots_v1'::regclass))>0 present"],
      ["0232_signal_discovery_processing_admission.sql", "SELECT to_regprocedure('signal_workspace_engine_actor_v1(signal_topic_catalog_executions,uuid)') IS NOT NULL present"],
      ["0233_signal_discovery_editorial_optional_caps.sql", "SELECT to_regprocedure('signal_topic_discovery_run_v1(uuid)') IS NOT NULL present"]
    ] as const;
    for (const [file, probe] of ddl) if (!(await scoped.query(probe)).rows[0].present)
      await scoped.query(await readFile(new URL(file, import.meta.url), "utf8"));
    const f = await createProcessingPolicyIdentitiesV1({ database, scoped });
    const denied = async (run: () => Promise<unknown>, pattern: RegExp) => {
      await scoped.query("SAVEPOINT rejection");
      try { await assert.rejects(run, pattern); }
      finally { await scoped.query("ROLLBACK TO SAVEPOINT rejection"); await scoped.query("RELEASE SAVEPOINT rejection"); }
    };
    const makePolicy = async (org: string, cap: string | null, daily: string | null, version = 1) => {
      const id = randomUUID();
      await scoped.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,
        budget_timezone,daily_cap_micro_usd,created_by_user_id) VALUES($1,$2,$5,'draft',clock_timestamp()-interval '1 minute','infinity','UTC',$3,$4)`,
      [id, org, daily, f.actors.internal, version]);
      await scoped.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
        configuration_digest,max_execution_micro_usd,automatic_allowed) VALUES($1,'topic_interpretation','provider','anthropic',$2,$3::jsonb,
          signal_semantic_context_digest_json_v2($3::jsonb),$4,false)`, [id, configuration.model, JSON.stringify(configuration), cap]);
      await scoped.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [id]);
      return id;
    };
    const policy = await makePolicy(f.first.organization_id, null, null);
    await makePolicy(f.foreign.organization_id, "1000", "2000");
    const unlimited = await loadSignalDiscoveryPolicyV1(scoped, f.first.workspace_id);
    assert.equal(unlimited.policy_id, policy); assert.equal(unlimited.maximum_cap_micro_usd, null); assert.equal(unlimited.daily_cap_micro_usd, null);
    const input: SignalProcessingAdmitArgsV1 = { workspace_id: f.first.workspace_id, actor_user_id: f.actors.firstAdmin,
      action: "topic_interpretation", target_id: randomUUID(), idempotency_key: randomUUID(),
      request_digest: `sha256:${"a".repeat(64)}`, execution_cap_micro_usd: null };
    const accepted = await admit(scoped, input);
    assert.equal(accepted.receipt.execution_cap_micro_usd, null); assert.equal(accepted.receipt.actor_user_id, f.actors.firstAdmin);
    assert.equal(accepted.receipt.policy_version_id, policy); assert.equal(accepted.replayed, false);
    assert.deepEqual(await admit(scoped, input), { ...accepted, replayed: true });
    await denied(() => admit(scoped, { ...input, execution_cap_micro_usd: "1" }), /processing_idempotency_conflict/);
    const capacity = (changes: { actor?: string; workspace?: string; run?: string; receipt?: string | null; model?: string; cap?: string | null; amount?: number } = {}) => scoped.query(`
      SELECT signal_processing_capacity_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,ARRAY['topic_interpretation'],'anthropic',$5,$6::jsonb,$7::bigint,
        'interpretation',$8::uuid,$9::bigint,clock_timestamp())`, [changes.workspace ?? input.workspace_id, changes.actor ?? input.actor_user_id,
      changes.run ?? input.target_id, changes.receipt === undefined ? accepted.receipt.id : changes.receipt,
      changes.model ?? configuration.model, JSON.stringify(configuration), changes.cap ?? null, randomUUID(), changes.amount ?? 123]);
    await capacity({ amount: 100_000_000 }); // NULL imposes no invented ceiling, still bound to a receipt.
    await denied(() => capacity({ receipt: null }), /processing_admission_required/);
    await denied(() => capacity({ run: randomUUID() }), /processing_admission_invalid/);
    await denied(() => capacity({ model: "claude-opus-4-6" }), /processing_admission_invalid/);
    for (const actor of [f.actors.noGrant, f.actors.readGrant, f.actors.viewer, f.actors.suspended, f.actors.foreignAdmin]) {
      await denied(() => admit(scoped, { ...input, actor_user_id: actor, idempotency_key: randomUUID() }), /forbidden/);
      await denied(() => capacity({ actor }), /forbidden|processing_admission_invalid/);
    }
    await denied(() => admit(scoped, { ...input, workspace_id: f.foreign.workspace_id }), /forbidden/);
    await scoped.query("SAVEPOINT revoke_grant");
    await scoped.query("UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2", [f.actors.firstAdmin, f.first.brand_id]);
    await denied(() => admit(scoped, input), /forbidden/); // Replay also needs the live grant.
    await denied(() => capacity(), /forbidden/);
    await scoped.query("ROLLBACK TO SAVEPOINT revoke_grant"); await scoped.query("RELEASE SAVEPOINT revoke_grant");
    const strict = { ...input, workspace_id: f.foreign.workspace_id, actor_user_id: f.actors.foreignAdmin,
      target_id: randomUUID(), idempotency_key: randomUUID() };
    await denied(() => admit(scoped, strict), /processing_admission_invalid/);
    await denied(() => admit(scoped, { ...strict, execution_cap_micro_usd: "1001" }), /processing_admission_invalid/);
    const bounded = await admit(scoped, { ...strict, execution_cap_micro_usd: "1000" });
    assert.equal(bounded.receipt.execution_cap_micro_usd, "1000");
    await scoped.query("SAVEPOINT small_daily");
    await scoped.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [policy]);
    await makePolicy(f.first.organization_id, null, "1", 2);
    const smallInput = { ...input, target_id: randomUUID(), idempotency_key: randomUUID() };
    const small = await admit(scoped, smallInput);
    assert.equal(small.receipt.execution_cap_micro_usd, null, "a small explicit daily cap is not a per-execution cap");
    await capacity({ run: smallInput.target_id, receipt: small.receipt.id, amount: 1 });
    await denied(() => capacity({ run: smallInput.target_id, receipt: small.receipt.id, amount: 2 }), /processing_daily_cap_exhausted/);
    await scoped.query("ROLLBACK TO SAVEPOINT small_daily"); await scoped.query("RELEASE SAVEPOINT small_daily");
    // The helper accepts only the real MFP owner/actor, never a client legacy owner.
    const actorAllowed = async (actor: string, discovery: boolean) => (await scoped.query(`SELECT signal_workspace_engine_actor_v1(
      jsonb_populate_record(NULL::signal_topic_catalog_executions,$1::jsonb),$2::uuid) allowed`, [JSON.stringify({
      actor_user_id: f.actors.firstAdmin, workspace_id: f.first.workspace_id, input_contract: "workspace-topic-engine-v1",
      input_snapshot: discovery ? { discovery_population: {} } : {} }), actor])).rows[0].allowed;
    assert.equal(await actorAllowed(f.actors.firstAdmin, true), true);
    assert.equal(await actorAllowed(f.actors.firstAdmin, false), false);
    assert.equal(await actorAllowed(f.actors.internal, true), false);
    assert.equal((await scoped.query("SELECT count(*)::int n FROM engine_cost_events WHERE actor_user_id=$1", [f.actors.firstAdmin])).rows[0].n, 0);
    // Test the actual revision expression in isolated temporary context families.
    // Crossing a competitor window changes authority without rewriting the row.
    const families:Record<string,string[]>={signal_workspaces:['brand_id'],brands:[],brand_os_profiles:['brand_id'],
      brand_os_objectives:['brand_os_profile_id'],brand_os_briefs:['brand_os_profile_id'],brand_os_audiences:['brand_os_profile_id'],
      brand_os_products:['brand_os_profile_id'],brand_os_claims:['brand_os_profile_id'],brand_knowledge_sources:['brand_id'],
      knowledge_chunks:['knowledge_source_id'],knowledge_assertions:['knowledge_source_id'],competitors:['brand_id','competitor_brand_seed_id'],
      brand_seeds:[],intelligence_entities:['brand_id'],entity_aliases:['entity_id'],signal_acquisition_plans:['workspace_id']};
    for(const [table,columns] of Object.entries(families))await scoped.query(`CREATE TEMP TABLE ${table}(id uuid,
      ${columns.map(column=>`${column} uuid,`).join('')}valid_from date,valid_to date,effective_from timestamptz,effective_to timestamptz)`);
    const migration=await readFile(new URL('0233_signal_discovery_editorial_optional_caps.sql',import.meta.url),'utf8');
    const start=migration.indexOf('CREATE FUNCTION signal_workspace_discovery_context_revision_v1');
    const end=migration.indexOf('REVOKE ALL ON FUNCTION signal_workspace_discovery_context_revision_v1',start);
    await scoped.query(migration.slice(start,end).replace('CREATE FUNCTION signal_workspace_discovery_context_revision_v1',
      'CREATE FUNCTION pg_temp.discovery_context_revision_fixture').replace('SET search_path=public,extensions,pg_temp','SET search_path=pg_temp,public,extensions'));
    await scoped.query('INSERT INTO pg_temp.signal_workspaces(id,brand_id) VALUES($1,$1)',[f.first.workspace_id]);
    await scoped.query(`INSERT INTO pg_temp.competitors(id,brand_id,effective_to) VALUES($1,$1,clock_timestamp()+interval '500 milliseconds')`,[f.first.workspace_id]);
    const revision=async()=>(await scoped.query('SELECT pg_temp.discovery_context_revision_fixture($1) value',[f.first.workspace_id])).rows[0].value;
    const beforeWindow=await revision();
    await scoped.query("SELECT pg_sleep(greatest(0,extract(epoch FROM (effective_to-clock_timestamp())))+0.02) FROM pg_temp.competitors");
    assert.notEqual(await revision(),beforeWindow,'expiry must invalidate a source even without row mutation');
    await scoped.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally { await scoped.query("ROLLBACK"); scoped.release(); await database.end(); }
});

// Existing prepared/embedded corpus is read, never reimported or re-embedded.
// Only a new synthetic client, grant, policy successor and mocked transition receipts
// are created, all under physical rollback. No numerical fit or transport is executed.
test("MFP real corpus: client begin/outbox/claim, synthetic fit and ledger remain atomic", {
  skip: process.env.NOISIA_MFP_DISCOVERY_COMPOSED_PG_TEST !== "true"
}, async () => {
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const pool: Pool = await openDatabase(), raw = await pool.connect();
  const priorFlag = process.env.NOISIA_MENTION_FACETS_ENABLED;
  process.env.NOISIA_MENTION_FACETS_ENABLED = "true";
  try {
    await raw.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    for (const [file, probe] of [
      ["0231_signal_discovery_unrelated_state.sql", "SELECT position('unrelated' in pg_get_viewdef('signal_topic_consolidation_snapshot_roots_v1'::regclass))>0 present"],
      ["0232_signal_discovery_processing_admission.sql", "SELECT to_regprocedure('signal_workspace_engine_actor_v1(signal_topic_catalog_executions,uuid)') IS NOT NULL present"],
      ["0233_signal_discovery_editorial_optional_caps.sql", "SELECT to_regprocedure('signal_topic_discovery_run_v1(uuid)') IS NOT NULL present"]
    ]) if (!(await raw.query(probe!)).rows[0].present) await raw.query(await readFile(new URL(file!, import.meta.url), "utf8"));
    const identity = JSON.parse(await readFile("/app/.data/dev-corpus/voyage-real/.data/dev-corpus/identity.json", "utf8")) as {
      workspace_id: string; brand_id: string; internal_user_id: string };
    const scope = (await raw.query<{ organization_id: string; brand_id: string }>(
      "SELECT organization_id,brand_id FROM signal_workspaces WHERE id=$1", [identity.workspace_id])).rows[0]!;
    assert.equal(scope.brand_id, identity.brand_id);
    const clientActor = randomUUID();
    await raw.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
      VALUES($1,$2,'Synthetic MFP discovery client','client','client_admin',$3,'active')`, [clientActor, `${clientActor}@fixture.example.test`, scope.organization_id]);
    await raw.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,'admin')", [clientActor, scope.brand_id]);
    let serial = 0, failOutbox = false, tamperPopulation = false; const stack: string[] = [];
    const query = async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("BEGIN")) { const name = `discovery_${++serial}`; stack.push(name); return raw.query(`SAVEPOINT ${name}`); }
      if (sql === "COMMIT") return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === "ROLLBACK") { const name = stack.pop()!; await raw.query(`ROLLBACK TO SAVEPOINT ${name}`); return raw.query(`RELEASE SAVEPOINT ${name}`); }
      if (failOutbox && sql.startsWith("INSERT INTO signal_topic_classification_outbox")) throw new Error("synthetic_outbox_failure");
      if(tamperPopulation&&sql.startsWith('INSERT INTO signal_topic_catalog_executions(')){
        const altered=[...values!],snapshot=JSON.parse(String(altered[14]));
        snapshot.discovery_population.root_ids[0]=randomUUID();altered[14]=JSON.stringify(snapshot);
        return raw.query(sql,altered);
      }
      return raw.query(sql, values);
    };
    const client = Object.assign(Object.create(raw), { query, release() {} });
    const database = Object.assign(Object.create(pool), { query, connect: async () => client }) as Pool;
    const engine = await import("../signal-workspace-engine"), money = await import("../signal-workspace-engine-interpretation");
    const { createHash } = await import("node:crypto");
    const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
    const access = { database, workspace_id: identity.workspace_id, actor_user_id: clientActor };
    const { loadSignalWorkspaceCapabilitiesStoreV1 } = await import("../signal-workspace-capabilities");
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: database, ...access });
    assert.equal(capabilities.can_request_processing, true); assert.equal(capabilities.can_execute_topics, false);
    const deny = async (work: () => Promise<unknown>, pattern: RegExp) => {
      await raw.query("SAVEPOINT negative");
      try { await assert.rejects(work, pattern); }
      finally { await raw.query("ROLLBACK TO SAVEPOINT negative"); await raw.query("RELEASE SAVEPOINT negative"); }
    };
    for (const cap of [null, 1000]) {
      await raw.query("SAVEPOINT scenario");
      const oldPolicy = (await raw.query<{ id: string; budget_timezone: string; daily_cap_micro_usd: string | null; valid_until: string }>(
        "SELECT id,budget_timezone,daily_cap_micro_usd::text,valid_until::text FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'", [scope.organization_id])).rows[0];
      const policyId = randomUUID();
      await raw.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
        SELECT $1,$2,COALESCE(max(version),0)+1,'draft',clock_timestamp()-interval '1 second',$3::timestamptz,$4,$5::bigint,$6
        FROM signal_processing_policy_versions WHERE organization_id=$2`, [policyId, scope.organization_id,
      oldPolicy?.valid_until ?? "infinity", oldPolicy?.budget_timezone ?? "UTC", oldPolicy?.daily_cap_micro_usd ?? null, identity.internal_user_id]);
      if (oldPolicy) await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
        FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action NOT IN('topic_interpretation','topic_consolidation_numeric')`, [policyId, oldPolicy.id]);
      await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        VALUES($1,'topic_interpretation','provider','anthropic',$2,$3::jsonb,signal_semantic_context_digest_json_v2($3::jsonb),$4,false)`,
      [policyId, configuration.model, JSON.stringify(configuration), cap]);
      await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        SELECT $1,'topic_consolidation_numeric','free',config,signal_semantic_context_digest_json_v2(config),0,false
        FROM (SELECT signal_topic_consolidation_numeric_configuration_v1() config) configuration`, [policyId]);
      if (oldPolicy) await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [oldPolicy.id]);
      await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policyId]);
      const policy = await loadSignalDiscoveryPolicyV1(database, identity.workspace_id);
      const preflight = await engine.loadSignalWorkspaceEnginePreflightV1(access);
      assert.ok(preflight.embedding_run_id); assert.equal(preflight.missing_guides, 0);
      const request = { ...access, embedding_run_id: preflight.embedding_run_id, idempotency_key: randomUUID(),
        expected_catalog_digest: preflight.expected_catalog_digest, expected_context_digest: preflight.expected_context_digest,
        engine_config: { fixture: "mocked-transition-no-fit" }, parent_execution_id: null, claude_cap_micro_usd: cap,
        discovery_request_intent_digest: sha(`synthetic-client-intent-${cap}`),
        interpretation_config: { call_configuration: configuration, budget_timezone: policy.budget_timezone, daily_cap_micro_usd: policy.daily_cap_micro_usd } };
      const beforeAdmissions = (await raw.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE actor_user_id=$1", [clientActor])).rows[0].n;
      tamperPopulation=true;
      try { await assert.rejects(engine.beginSignalWorkspaceEngineV1({...request,idempotency_key:randomUUID()}),/Engine discovery population is stale/); }
      finally { tamperPopulation=false; }
      failOutbox = true;
      try { await assert.rejects(engine.beginSignalWorkspaceEngineV1({ ...request, idempotency_key: randomUUID() }), /synthetic_outbox_failure/); }
      finally { failOutbox = false; }
      assert.equal((await raw.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE actor_user_id=$1", [clientActor])).rows[0].n, beforeAdmissions);
      assert.equal((await raw.query("SELECT count(*)::int n FROM signal_topic_catalog_executions WHERE actor_user_id=$1", [clientActor])).rows[0].n, 0);
      const started = await engine.beginSignalWorkspaceEngineV1(request);
      assert.equal((await engine.beginSignalWorkspaceEngineV1(request)).execution_id, started.execution_id);
      const receipt = (await raw.query(`SELECT e.actor_user_id,e.processing_admission_id,a.target_id,a.actor_user_id admission_actor,
        a.execution_cap_micro_usd::text cap,(SELECT count(*)::int FROM signal_topic_classification_outbox o WHERE o.execution_id=e.id) outboxes
        FROM signal_topic_catalog_executions e JOIN signal_processing_admissions a ON a.id=e.processing_admission_id WHERE e.id=$1`, [started.execution_id])).rows[0];
      assert.equal(receipt.actor_user_id, clientActor); assert.equal(receipt.admission_actor, clientActor);
      assert.equal(receipt.target_id, started.execution_id); assert.equal(receipt.outboxes, 1); assert.equal(receipt.cap, cap === null ? null : String(cap));
      const replayArgs = { ...access, idempotency_key: request.idempotency_key, request_intent_digest: request.discovery_request_intent_digest };
      await raw.query("SAVEPOINT policy_replay");
      await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [policyId]);
      assert.deepEqual(await engine.replaySignalWorkspaceDiscoveryRequestV1(replayArgs), { execution_id: started.execution_id, replayed: true });
      assert.equal((await engine.beginSignalWorkspaceEngineV1(request)).execution_id, started.execution_id);
      const changedPolicy = randomUUID();
      await raw.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
        SELECT $1,organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id
        FROM signal_processing_policy_versions WHERE id=$2`, [changedPolicy, policyId]);
      await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        SELECT $1,action,kind,provider,model,configuration,configuration_digest,
          CASE WHEN action='topic_interpretation' THEN 500 ELSE max_execution_micro_usd END,automatic_allowed
        FROM signal_processing_policy_actions WHERE policy_version_id=$2`, [changedPolicy, policyId]);
      await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [changedPolicy]);
      assert.deepEqual(await engine.replaySignalWorkspaceDiscoveryRequestV1(replayArgs), { execution_id: started.execution_id, replayed: true });
      assert.equal((await raw.query("SELECT processing_admission_id FROM signal_topic_catalog_executions WHERE id=$1", [started.execution_id])).rows[0].processing_admission_id, receipt.processing_admission_id);
      await deny(() => engine.replaySignalWorkspaceDiscoveryRequestV1({ ...replayArgs, request_intent_digest: sha("contradictory intent") }), /idempotency_conflict/);
      await deny(() => engine.beginSignalWorkspaceEngineV1({ ...request, claude_cap_micro_usd: cap === null ? 1 : 999 }), /idempotency_conflict/);
      assert.equal((await raw.query("SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1", [started.execution_id])).rows[0].n, 1);
      assert.equal((await raw.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE actor_user_id=$1", [clientActor])).rows[0].n, beforeAdmissions + 1);
      await raw.query("ROLLBACK TO SAVEPOINT policy_replay"); await raw.query("RELEASE SAVEPOINT policy_replay");
      const lease = await engine.claimSignalWorkspaceEngineV1({ database, ...started, worker_job_id: "synthetic-discovery-transition" }); assert.ok(lease);
      assert.ok(lease.snapshot.discovery_population); assert.ok(lease.snapshot.expected_roots > 0);
      const coverage = { roots: lease.snapshot.expected_roots, chunks: lease.snapshot.expected_chunks, guides: lease.snapshot.expected_guides };
      await engine.heartbeatSignalWorkspaceEngineV1({ database, lease, exported: { ...coverage, stream_digest: sha("synthetic transition") }, phase: "fitting" });
      const artifact = (key: string, artifact_type: SignalWorkspaceEngineArtifactV1["artifact_type"]) => ({
        artifact_key: key, artifact_type, title: "Synthetic transition; no fit or provider", storage_key: `workspace-engine/${identity.workspace_id}/${started.execution_id}/${key}`,
        sha256: sha(key), size_bytes: 10, media_type: "application/json", metadata: { fixture: true } });
      const model = await engine.persistSignalWorkspaceEngineArtifactV1({ database, lease, artifact: artifact("model-manifest.json", "engine_model") });
      const output = await engine.persistSignalWorkspaceEngineArtifactV1({ database, lease, artifact: artifact("manifest.json", "engine_output") });
      const fit = { database, lease, model_artifact_id: model.artifact_id, output_artifact_id: output.artifact_id,
        result_kind: "computational_grouping" as const, coverage, model_configuration: { fixture: true }, runtime_kind: "python",
        artifact_format: "workspace-model-bundle-v1", license_key: "synthetic-test-only",
        interpretation_manifest: { unit_count: 1, unit_digest: sha(JSON.stringify("open:fixture") + "\n") } };
      await engine.checkpointSignalWorkspaceEngineFitV1(fit);
      const reserve = (amount: number) => money.reserveSignalWorkspaceEngineInterpretationV1({ ...access, ...started,
        execution_token: lease.execution_token, idempotency_key: randomUUID(), request_digest: sha(randomUUID()), configuration,
        reserved_micro_usd: amount, budget_timezone: policy.budget_timezone, daily_cap_micro_usd: policy.daily_cap_micro_usd });
      if (cap !== null) await deny(() => reserve(cap + 1), /cap_exceeded/);
      const call = await reserve(500), attempt = { database, call_id: call.call_id, attempt_token: call.attempt_token, execution_token: lease.execution_token };
      const ledger = (await raw.query("SELECT actor_user_id,processing_organization_id,budget_daily_cap_micro_usd::text daily FROM engine_cost_events WHERE id=$1", [call.call_id])).rows[0];
      assert.equal(ledger.actor_user_id, clientActor); assert.equal(ledger.processing_organization_id, scope.organization_id);
      assert.equal(ledger.daily, policy.daily_cap_micro_usd === null ? null : String(policy.daily_cap_micro_usd));
      await raw.query("SAVEPOINT revoke");
      await raw.query("UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2", [clientActor, scope.brand_id]);
      await deny(() => engine.beginSignalWorkspaceEngineV1(request), /forbidden/);
      await deny(() => engine.replaySignalWorkspaceDiscoveryRequestV1(replayArgs), /forbidden/);
      await deny(() => money.markSignalWorkspaceEngineInterpretationSentV1(attempt), /forbidden/);
      await raw.query("ROLLBACK TO SAVEPOINT revoke"); await raw.query("RELEASE SAVEPOINT revoke");
      assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(attempt)).send_authorized, true);
      if(cap===null)await (await import('./signal-discovery-editorial.synthetic.fixture')).exerciseDiscoveryEditorialV1({
        raw,...access,internal_user_id:identity.internal_user_id,organization_id:scope.organization_id,brand_id:scope.brand_id,
        source_execution_id:started.execution_id,root_id:lease.snapshot.discovery_population.root_ids[0]!});
      await raw.query("SET CONSTRAINTS ALL IMMEDIATE");
      await raw.query("ROLLBACK TO SAVEPOINT scenario"); await raw.query("RELEASE SAVEPOINT scenario");
    }
  } finally {
    await raw.query("ROLLBACK"); raw.release(); await pool.end();
    if (priorFlag === undefined) delete process.env.NOISIA_MENTION_FACETS_ENABLED; else process.env.NOISIA_MENTION_FACETS_ENABLED = priorFlag;
  }
});
