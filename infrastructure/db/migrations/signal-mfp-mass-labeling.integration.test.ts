import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import test from "node:test";
import type {Pool} from "pg";
import {buildMassLabelingJevRequestV1, mapMassLabelingJevResponseV1, massLabelingJevIdentityV1,
  signalWorkspaceEmbeddingDigestV1 as digest, llmPriceV1, llmCostMicroUsdV1} from "@noisia/query-engine";
import {seedComposedFixture,quoteComposedFixture,startComposedFixture,semanticConfiguration} from "./signal-brand-context-composed.fixture";
import {seedSignalTopicEditorialRenewalSourceV1, snapshotSignalTopicEditorialRenewalSyntheticHistoryV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import {createMassLabelingMapV1, createMassLabelingStoreV1, requestMassLabelingV1,
  continueMassLabelingV1, provisionMassLabelingPolicyV1, selectMassLabelingTopicsV1,
  correctMassLabelingTopicV1, exportMassLabelingSnapshotV1, measureMassLabelingSmokeV1} from "../signal-mass-labeling";
import {loadSignalWorkspaceTopicsOverviewV1, loadSignalWorkspaceTopicEvidenceV1,
  loadSignalWorkspaceTopicDetailV1} from "../signal-workspace-topics-serving";
import * as editorialMoney from "../signal-workspace-engine-interpretation";
import {SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as globalConfiguration,buildMassLabelingConsolidationRequestV1} from "@noisia/query-engine";
import {persistSignalWorkspaceEngineArtifactV1} from "../signal-workspace-engine";
import {jevUsageV1} from "../../../services/workers/src/workers/signal-jev-labeling-page";
import {validateJevResponseV1} from "../../../services/workers/src/providers/typesafe-jev";

test("mass labeling seals full population, bills once, and serves probability pages with live tenant/rights fences", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 300_000,
}, async () => {
  const {openDatabase} = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const pool: Pool = await openDatabase(), raw = await pool.connect();
  const flag = process.env.NOISIA_MASS_LABELING_ENABLED;
  process.env.NOISIA_MASS_LABELING_ENABLED = "true";
  try {
    await raw.query("BEGIN");
    let sequence = 0; const stack: string[] = [];
    const query = async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("BEGIN")) {const save = `mass_${++sequence}`; stack.push(save); return raw.query(`SAVEPOINT ${save}`);}
      if (sql === "COMMIT") return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === "ROLLBACK") {const save = stack.pop()!; await raw.query(`ROLLBACK TO SAVEPOINT ${save}`); return raw.query(`RELEASE SAVEPOINT ${save}`);}
      // The outer transaction supplies the snapshot for exported/read-only entrypoints.
      if (sql.startsWith("SET TRANSACTION")) return raw.query("SELECT 1");
      return raw.query(sql, values);
    };
    const scoped = Object.assign(Object.create(raw), {query, release() {}});
    const database = Object.assign(Object.create(pool), {query, connect: async () => scoped}) as Pool;
    let consolidationArtifactId="",consolidationRaw="";
    const seed = await seedSignalTopicEditorialRenewalSourceV1({database, scoped, query, cleanup: async () => {},
      numeric_daily_cap_micro_usd: 1_000_000, projection: {interpretation_configuration:globalConfiguration,engine_config: {profile_version: "workspace-bertopic-mass-labeling-v1", fixture: true},
        onCheckpoint: async fixture => {
          if(fixture.proposals.length!==2)return;
          const assignment=[...fixture.bodies.entries()].find(([key])=>key.endsWith("/assignments.guided.jsonl"))![1];
          const group_id=`guided:${JSON.parse(assignment.trim().split("\n")[0]!).stable_cluster_id}`;
          const sourceGroups=[{group_id,cluster_digest:digest({group_id}),name:"Synthetic repair conversation",
            definition:"Experiences repairing bicycles.",status:"coherent" as const,source_artifact_id:fixture.proposals[1]!.artifact_id}];
          const batch=buildMassLabelingConsolidationRequestV1({workspace_id:fixture.access.workspace_id,
            source_engine_execution_id:fixture.lease.execution_id,source_groups:sourceGroups});
          const sourceGroupsDigest=batch.source_groups_digest;
          const output={topics:[{topic_key:"bicycle_repairs",name:"Bicycle repairs",definition:"Experiences repairing bicycles.",group_ids:[group_id]}],excluded_groups:[]};
          const rawResponse=JSON.stringify({id:"msg_synthetic_global",type:"message",role:"assistant",model:globalConfiguration.model,
            stop_reason:"end_turn",content:[{type:"text",text:JSON.stringify(output)}],usage:{input_tokens:100,output_tokens:50}});
          consolidationRaw=JSON.stringify({contract_version:"workspace-mass-labeling-consolidation-v1",workspace_id:fixture.access.workspace_id,
            source_engine_execution_id:fixture.lease.execution_id,source_groups:sourceGroups,source_groups_digest:sourceGroupsDigest,
            raw_response:rawResponse,output});
          const call=await editorialMoney.reserveSignalWorkspaceEngineInterpretationV1({...fixture.access,execution_id:fixture.lease.execution_id,
            idempotency_key:randomUUID(),request_digest:batch.request_digest,
            configuration:batch.configuration,reserved_micro_usd:batch.reserved_micro_usd,
            budget_timezone:"America/Mexico_City",daily_cap_micro_usd:30_000_000,execution_token:fixture.lease.execution_token,
            mass_labeling_stage:{stage:"global-consolidation-v1",source_groups_digest:sourceGroupsDigest}});
          const token={database,call_id:call.call_id,attempt_token:call.attempt_token};
          await editorialMoney.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:fixture.lease.execution_token});
          const responseSha=`sha256:${createHash("sha256").update(rawResponse).digest("hex")}`;
          await editorialMoney.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{
            storage_key:`workspace-engine/${fixture.access.workspace_id}/${fixture.lease.execution_id}/global-raw.json`,
            sha256:responseSha,size_bytes:Buffer.byteLength(rawResponse),http_status:200,provider_request_id:null}});
          await editorialMoney.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:50,
            cache_read_input_tokens:0,cache_creation_input_tokens:0}});
          const artifact=await persistSignalWorkspaceEngineArtifactV1({database,lease:fixture.lease,
            artifact:{artifact_key:"mass-labeling-consolidation.json",artifact_type:"engine_proposals",title:"Synthetic global consolidation",
              storage_key:`workspace-engine/${fixture.access.workspace_id}/${fixture.lease.execution_id}/mass-labeling-consolidation.json`,
              sha256:`sha256:${createHash("sha256").update(consolidationRaw).digest("hex")}`,
              size_bytes:Buffer.byteLength(consolidationRaw),media_type:"application/json",metadata:{
                contract_version:"workspace-mass-labeling-consolidation-v1",source_engine_execution_id:fixture.lease.execution_id,
                stage:"global-consolidation-v1",source_groups_digest:sourceGroupsDigest,call_id:call.call_id,request_digest:call.request_digest,response_sha256:responseSha}}});
          consolidationArtifactId=artifact.artifact_id;
        }}});
    const access = {database, workspace_id: seed.scope.workspace_id, actor_user_id: seed.scope.actor_user_id};
    const foreignActor = randomUUID();
    await query(`INSERT INTO users(id,email,user_type,primary_role,status)
      VALUES($1,$2,'client','client_admin','active')`, [foreignActor, `${foreignActor}@example.invalid`]);
    await query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2)",
      [access.workspace_id, access.actor_user_id]);
    const artifact = (await query(`SELECT id,content FROM analysis_artifacts
      WHERE engine_execution_id=$1 AND artifact_key='assignments.guided.jsonl'`, [seed.source_engine_execution_id])).rows[0]!;
    const assignmentsRaw = seed.projection.bodies.get(artifact.content.storage_key)!;
    assert.ok(assignmentsRaw);
    const groupId = `guided:${JSON.parse(assignmentsRaw.trim().split("\n")[0]!).stable_cluster_id}`;
    const mapArgs = {...access, source_engine_execution_id: seed.source_engine_execution_id,
      assignments_artifact_id: artifact.id, assignments_raw: assignmentsRaw,
      consolidation_artifact_id:consolidationArtifactId,consolidation_raw:consolidationRaw,
      catalog: [{topic_key: "bicycle_repairs", name: "Bicycle repairs", definition: "Experiences repairing bicycles.", group_ids: [groupId]}]};
    await assert.rejects(createMassLabelingMapV1({...mapArgs, actor_user_id: foreignActor}), /mass_labeling_forbidden/);
    await assert.rejects(createMassLabelingMapV1({...mapArgs, assignments_raw: assignmentsRaw+" "}), /mass_labeling_source_invalid/);
    const map = await createMassLabelingMapV1(mapArgs);
    assert.equal((await createMassLabelingMapV1(mapArgs)).map_id, map.map_id);
    assert.equal((await query("SELECT count(*)::int n FROM signal_mass_labeling_items WHERE map_id=$1", [map.map_id])).rows[0].n, 3);
    await query("SAVEPOINT semantic_sibling");
    const semantic=await seedComposedFixture(database,"mass-policy-sibling",{optionalStrictCaps:true});
    const semanticQuote=await quoteComposedFixture(database,semantic);
    assert.ok(semanticQuote.quote_digest);
    const semanticRun=await startComposedFixture(database,semantic,semanticQuote.quote_digest,randomUUID(),
      {...semanticConfiguration,platform_hard_cap_micro_usd:null});
    await query("SET CONSTRAINTS ALL IMMEDIATE");await query("SET CONSTRAINTS ALL DEFERRED");
    const pilotBrand=randomUUID();
    await query(`INSERT INTO brands(id,organization_id,slug,name,status) VALUES($1,$2,$3,'Synthetic pilot sibling','active')`,
      [pilotBrand,semantic.organizationId,`mass-pilot-${pilotBrand}`]);
    const pilotWorkspace=(await query("SELECT id FROM signal_workspaces WHERE brand_id=$1",[pilotBrand])).rows[0]!.id;
    await query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2)",
      [pilotWorkspace,semantic.internalActorId]);
    const policyCount=(await query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1",[semantic.organizationId])).rows[0]!.n;
    for(const status of ["queued","processing","validating"]) {
      await query("SAVEPOINT semantic_status");
      await query("UPDATE signal_semantic_context_proposal_runs SET status=$2 WHERE id=$1",[semanticRun.run_id,status]);
      await assert.rejects(provisionMassLabelingPolicyV1({database,workspace_id:pilotWorkspace,
        actor_user_id:semantic.internalActorId,cap_micro_usd:1_000_000}),/mass_labeling_policy_active_work/);
      assert.equal((await query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1",[semantic.organizationId])).rows[0]!.n,policyCount);
      await query("ROLLBACK TO SAVEPOINT semantic_status");await query("RELEASE SAVEPOINT semantic_status");
    }
    await query("ROLLBACK TO SAVEPOINT semantic_sibling");await query("RELEASE SAVEPOINT semantic_sibling");
    const beforeActions = (await query(`SELECT action,configuration,configuration_digest,max_execution_micro_usd::text
      FROM signal_processing_policy_actions WHERE policy_version_id=(SELECT id FROM signal_processing_policy_versions
      WHERE organization_id=$1 AND status='active') ORDER BY action`, [seed.identity.organization_id])).rows;
    const sourceBefore=(await query("SELECT signal_topic_consolidation_source_binding_v1($1) binding",[seed.source_engine_execution_id])).rows[0]!.binding;
    const historyBefore = await snapshotSignalTopicEditorialRenewalSyntheticHistoryV1({query});
    await query("SAVEPOINT active_sibling");
    const siblingBrand=randomUUID(),siblingPrep=randomUUID(),siblingLabeler=randomUUID(),siblingRun=randomUUID();
    await query(`INSERT INTO brands(id,organization_id,slug,name,status) VALUES($1,$2,$3,'Synthetic sibling','active')`,
      [siblingBrand,seed.identity.organization_id,`mass-sibling-${siblingBrand}`]);
    const sibling=(await query("SELECT id FROM signal_workspaces WHERE brand_id=$1",[siblingBrand])).rows[0]!.id;
    await query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id)
      VALUES($1,$2,$3,$4)`,[siblingPrep,sibling,access.actor_user_id,`mass-sibling-${siblingRun}`]);
    await query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
      VALUES($1,'facets','anthropic','claude-sonnet-5-5',$2,$2,$3,'{}')`,[siblingLabeler,digest({fixture:true}),digest({siblingLabeler})]);
    await query(`INSERT INTO signal_entity_context_versions(workspace_id,version_no,digest,context,diff,affected_mode,affected_count)
      VALUES($1,1,$2,'{"entities":[]}'::jsonb,'{}'::jsonb,'targeted',0)`,[sibling,digest({fixture:true})]);
    await query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,
      entity_context_digest,entity_context_version_no,estimated_micro_usd,idempotency_key,request_digest,actor_user_id)
      VALUES($1,$2,'facets',$3,$4,$5,1,0,$6,$5,$7)`,[siblingRun,sibling,siblingLabeler,siblingPrep,digest({fixture:true}),randomUUID(),access.actor_user_id]);
    await assert.rejects(provisionMassLabelingPolicyV1({...access,cap_micro_usd:1_000_000}),/mass_labeling_policy_active_work/);
    await query("ROLLBACK TO SAVEPOINT active_sibling");
    await provisionMassLabelingPolicyV1({...access, cap_micro_usd: 1_000_000});
    assert.deepEqual((await query("SELECT signal_topic_consolidation_source_binding_v1($1) binding",[seed.source_engine_execution_id])).rows[0]!.binding,sourceBefore);
    const historyAfter = await snapshotSignalTopicEditorialRenewalSyntheticHistoryV1({query});
    for(const [table,before] of Object.entries(historyBefore)) {
      if(!["signal_processing_policy_versions","signal_processing_policy_actions"].includes(table))
        assert.deepEqual(historyAfter[table],before,`policy rotation preserves ${table} byte for byte`);
    }
    assert.equal((await query(`SELECT count(*)::int n FROM signal_processing_policy_actions action
      JOIN signal_processing_policy_versions policy ON policy.id=action.policy_version_id
      WHERE policy.organization_id=$1 AND policy.status='active' AND action.action='concept_membership_jev'`,[seed.identity.organization_id])).rows[0].n,0);
    const afterActions = (await query(`SELECT action,configuration,configuration_digest,max_execution_micro_usd::text
      FROM signal_processing_policy_actions WHERE policy_version_id=(SELECT id FROM signal_processing_policy_versions
      WHERE organization_id=$1 AND status='active') AND action<>'mass_labeling_jev' ORDER BY action`, [seed.identity.organization_id])).rows;
    assert.deepEqual(afterActions, beforeActions);
    const request = {...access, map_id: map.map_id, idempotency_key: randomUUID(), identity: massLabelingJevIdentityV1(),
      provider_available: true, cap_micro_usd: 1_000_000};
    const admitted = await requestMassLabelingV1(request);
    assert.equal((await requestMassLabelingV1({...request, provider_available: false})).run_id, admitted.run_id);
    const raws = new Map<string,string>();
    const store = createMassLabelingStoreV1({database,
      storeRaw: async ({call_id, raw_text}) => {raws.set(call_id, raw_text); return `private/${call_id}`;},
      loadRaw: async ({call_id}) => raws.get(call_id)!, assertRawReady: async () => {}});
    // The legacy store must never claim this independently typed run.
    const {createSignalLabelingStoreV1} = await import("../signal-labeling-runs");
    assert.equal(await createSignalLabelingStoreV1({database, storeRaw: async () => "unused"}).claim(admitted.run_id), null);
    const run = await store.claim(admitted.run_id); assert.ok(run);
    const inputs = await store.inputs(run); assert.equal(inputs.length, 3);
    const price = llmPriceV1("typesafe", "jev-1.13.0", "sync", 0.042);
    const proposals = inputs.map(input => {
      const payload = buildMassLabelingJevRequestV1(input, run.context);
      return {custom_id: `mass_${digest({run: run.id, root: input.root_id}).slice(7)}`,
        request_digest: digest(payload), request: payload, inputs: [input], reserved_micro_usd: 50};
    });
    const calls = await store.reserve(run, proposals); assert.equal(calls.length, 3);
    await query("SET LOCAL enable_seqscan=off");
    const plan=(await query("EXPLAIN (FORMAT JSON) SELECT 1 FROM signal_mass_labeling_call_roots WHERE run_id=$1 AND root_id=$2",
      [run.id,inputs[0]!.root_id])).rows[0]!["QUERY PLAN"];
    assert.match(JSON.stringify(plan),/signal_mass_labeling_call_roots_pkey/);
    await query("SET LOCAL enable_seqscan=on");
    await store.markSubmitting(run, calls);
    for (const [index,call] of calls.entries()) {
      const payload = call.request as ReturnType<typeof buildMassLabelingJevRequestV1>;
      const answers = Object.fromEntries(Object.entries(payload.questions).map(([key, question]) => {
        if (question.type === "noul") return [key, {type: "noul", noul: key === "topic_0" ? [0.95, 0.7, 0.9][index] : key === "relevance" ? 0.95 : 0.05}];
        const keys = Object.keys(question.criteria), chosen = key === "voice" ? "individual" : "none";
        return [key, {type: "choice", choice: chosen, confidence: 0.99,
          probabilities: Object.fromEntries(keys.map(choice => [choice, choice === chosen ? 1 : 0]))}];
      }));
      const response = {body: JSON.stringify({model: "jev-1.13.0", answers, usage: {input_tokens: 100, output_tokens: 0}}), http_status: 200, latency_ms: 1};
      await store.persistRaw(run, call, JSON.stringify(response));
      const parsed = validateJevResponseV1(payload, response), usage = jevUsageV1(parsed.usage);
      await store.settle(run, call, {usage, settled_micro_usd: llmCostMicroUsdV1(usage, price)});
      await store.apply(run, [{call, results: [mapMassLabelingJevResponseV1(call.inputs[0]!, run.context, parsed)]}]);
    }
    assert.equal(await store.finish(run), "completed");
    await store.release(run);
    const booked = (await query("SELECT id,usage,settled_micro_usd,raw_sha256 FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id", [run.id])).rows;
    await assert.rejects(selectMassLabelingTopicsV1({...access, map_id: map.map_id, topic_keys: ["bicycle_repairs"], expected_revision: 0}), /mass_labeling_full_population_required/);
    const smoke = await measureMassLabelingSmokeV1({...access,run_id:run.id});
    assert.equal(smoke.metrics.technical_failure,false);
    assert.equal(smoke.metrics.intermediate_roots,1);
    await continueMassLabelingV1({...access, run_id: run.id});
    assert.equal((await continueMassLabelingV1({...access, run_id: run.id})).replayed, true);
    const continuation = await store.claim(run.id); assert.ok(continuation);
    assert.equal((await store.inputs(continuation)).length, 0);
    assert.equal(await store.finish(continuation), "completed");
    await store.release(continuation);
    assert.deepEqual((await query("SELECT id,usage,settled_micro_usd,raw_sha256 FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id", [run.id])).rows, booked);
    await selectMassLabelingTopicsV1({...access, map_id: map.map_id, topic_keys: ["bicycle_repairs"], expected_revision: 0});
    const view = await loadSignalWorkspaceTopicsOverviewV1(access); assert.ok(view?.is_current);
    assert.equal(view.denominator, 3);
    assert.equal(view.terms[0]!.mention_count, 2, "an exact 0.7 probability remains unclassified");
    const evidenceArgs = {...access, term_key: "bicycle_repairs", expected_scope_digest: view.scope_digest, limit: 1};
    const page1 = await loadSignalWorkspaceTopicEvidenceV1(evidenceArgs), page2 = await loadSignalWorkspaceTopicEvidenceV1({...evidenceArgs, cursor: page1.next_cursor});
    assert.equal(page1.items[0]!.mention_id, calls[0]!.inputs[0]!.root_id);
    assert.equal(page2.items[0]!.mention_id, calls[2]!.inputs[0]!.root_id);
    assert.equal(page1.items[0]!.quote, null);
    assert.equal((await loadSignalWorkspaceTopicDetailV1(evidenceArgs)).mention_count, 2);
    await correctMassLabelingTopicV1({...access, map_id: map.map_id, root_id: page1.items[0]!.mention_id,
      topic_key: "bicycle_repairs", belongs: false, decided_via: "human_ui"});
    const changed = await loadSignalWorkspaceTopicsOverviewV1(access); assert.equal(changed?.terms[0]!.mention_count, 1);
    await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({...evidenceArgs,cursor:page1.next_cursor}), /workspace_topics_scope_changed/);
    await query("SAVEPOINT rights_revoked");
    await query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[access.workspace_id]);
    const withheld=await loadSignalWorkspaceTopicsOverviewV1(access);
    assert.equal(withheld?.denominator,0,"current source rights withhold every metric immediately");
    await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({...evidenceArgs,expected_scope_digest:changed!.scope_digest}),
      /workspace_topics_evidence_stale|workspace_topics_scope_changed/);
    await query("ROLLBACK TO SAVEPOINT rights_revoked");
    await query("SAVEPOINT excluded_root");
    await query("UPDATE mentions SET inclusion_status='excluded' WHERE workspace_id=$1 AND id=$2",[access.workspace_id,page2.items[0]!.mention_id]);
    const excluded=await loadSignalWorkspaceTopicsOverviewV1(access);
    assert.equal(excluded?.denominator,2);
    assert.equal(excluded?.terms[0]!.mention_count,0,"excluded canonical roots cannot retain mass topic membership");
    await query("ROLLBACK TO SAVEPOINT excluded_root");
    const exported = await exportMassLabelingSnapshotV1({...access, map_id: map.map_id});
    assert.equal(exported.items.length, 3); assert.equal(exported.calls.length, 3);
    await assert.rejects(exportMassLabelingSnapshotV1({...access, actor_user_id: foreignActor, map_id: map.map_id}), /mass_labeling_forbidden/);
    const privileges = (await query(`SELECT has_table_privilege('anon','signal_mass_labeling_results','SELECT') anon,
      has_table_privilege('authenticated','signal_mass_labeling_results','SELECT') authenticated`)).rows[0];
    assert.deepEqual(privileges, {anon: false, authenticated: false});
    await query("SAVEPOINT immutable");
    await assert.rejects(query("UPDATE signal_mass_labeling_results SET probabilities='{}' WHERE map_id=$1", [map.map_id]), /mass_labeling_history_is_immutable/);
    await query("ROLLBACK TO SAVEPOINT immutable");
    await query("UPDATE users SET status='suspended' WHERE id=$1", [access.actor_user_id]);
    await assert.rejects(loadSignalWorkspaceTopicsOverviewV1(access), /workspace_topics_forbidden/);
  } finally {
    await raw.query("ROLLBACK").catch(() => undefined); raw.release(); await pool.end();
    if (flag === undefined) delete process.env.NOISIA_MASS_LABELING_ENABLED; else process.env.NOISIA_MASS_LABELING_ENABLED = flag;
  }
});
