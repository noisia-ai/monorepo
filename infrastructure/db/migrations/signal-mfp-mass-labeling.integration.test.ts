import {assertMassLabelingOverviewProvenanceV1} from "./signal-mass-labeling-overview-provenance.assertions";
import {assertMassLabelingServingProjectionV1,assertMassLabelingProjectionBackfillV1} from "./signal-mass-labeling-serving-projection.assertions";
import {assertMassLabelingProductNativeV2} from "./signal-mass-labeling-product.synthetic.fixture";
import {assertMassLabelingStudyPolicyV1} from "./signal-mass-labeling-study-policy.assertions";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import test from "node:test";
import type {Pool} from "pg";
import {buildMassLabelingJevRequestV1, mapMassLabelingJevResponseV1, massLabelingJevIdentityV1,labelerDigestV1,facetLabelerIdentityV1,
  signalWorkspaceEmbeddingDigestV1 as digest, llmPriceV1, llmCostMicroUsdV1} from "@noisia/query-engine";
import {seedComposedFixture,quoteComposedFixture,startComposedFixture,semanticConfiguration} from "./signal-brand-context-composed.fixture";
import {seedSignalTopicEditorialRenewalSourceV1,createSignalTopicEditorialRenewalSyntheticSavesV1,snapshotSignalTopicEditorialRenewalSyntheticHistoryV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import {createMassLabelingMapV1, createMassLabelingStoreV1, requestMassLabelingV1,
  continueMassLabelingV1, provisionMassLabelingPolicyV1, selectMassLabelingTopicsV1,
  correctMassLabelingTopicV1, exportMassLabelingSnapshotV1, measureMassLabelingSmokeV1} from "../signal-mass-labeling";
import {loadSignalWorkspaceTopicsOverviewV1, loadSignalWorkspaceTopicEvidenceV1,
  loadSignalWorkspaceTopicDetailV1,loadSignalWorkspaceTopicsPageV1} from "../signal-workspace-topics-serving";
import {importMassLabelingR13V1} from "../signal-mass-labeling-r13";
import * as editorialMoney from "../signal-workspace-engine-interpretation";
import {SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as globalConfiguration,buildMassLabelingConsolidationRequestV1} from "@noisia/query-engine";
import {verifyMassLabelingSourceCheckpointsV1,type MassLabelingSourceCheckpointV1} from "../signal-mass-labeling-source";
import {persistSignalWorkspaceEngineArtifactV1,failSignalWorkspaceEngineV1,retrySignalWorkspaceEngineV1,claimSignalWorkspaceEngineV1} from "../signal-workspace-engine";
import {jevUsageV1} from "../../../services/workers/src/workers/signal-jev-labeling-page";
import {validateJevResponseV1} from "../../../services/workers/src/providers/typesafe-jev";

for(const authorization of ["rotation","scoped","scoped-scale","scoped-funding","product"] as const) test(`mass labeling seals full population, bills once, and serves probability pages with live tenant/rights fences (${authorization})`, {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 600_000,
}, async () => {
  const localization=(authorization==="rotation"||authorization==="product")?{original_language:"pt-BR",
    original:{name:"Reparos de bicicletas",definition:"Experiências reparando bicicletas."},
    en:{name:"Bicycle repairs",definition:"Experiences repairing bicycles."},
    es:{name:"Reparaciones de bicicletas",definition:"Experiencias reparando bicicletas."}}:undefined;
  const scopedMode=authorization!=="rotation"&&authorization!=="product",rootCount=authorization==="scoped-funding"?1002:authorization==="scoped-scale"?200:3;
  const {openDatabase} = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const pool: Pool = await openDatabase(), raw = await pool.connect();
  const flag = process.env.NOISIA_MASS_LABELING_ENABLED;
  process.env.NOISIA_MASS_LABELING_ENABLED = "true";
  try {
    await raw.query("BEGIN");
    let sequence = 0; const stack: string[] = [];
    let massPlanChecked = false,readQueries=0;
    const query = async (sql: string, values?: unknown[]) => {
      readQueries++;
      if (sql.startsWith("BEGIN")) {const save = `mass_${++sequence}`; stack.push(save); return raw.query(`SAVEPOINT ${save}`);}
      if (sql === "COMMIT") return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === "ROLLBACK") {const save = stack.pop()!; await raw.query(`ROLLBACK TO SAVEPOINT ${save}`); return raw.query(`RELEASE SAVEPOINT ${save}`);}
      // The outer transaction supplies the snapshot for exported/read-only entrypoints.
      if (sql.startsWith("SET TRANSACTION")) return raw.query("SELECT 1");
      if (sql.includes("WITH source_generation AS MATERIALIZED") && sql.includes("mass_memberships AS MATERIALIZED")) {
        assert.equal((sql.match(/FROM signal_mass_labeling_memberships_v1/gu) ?? []).length, 1,
          "overview, detail and evidence each read the frozen membership view once");
        assert.match(sql, /FROM signal_mass_labeling_memberships_v1\s+WHERE workspace_id=\$1::uuid AND map_id=\$2::uuid AND belongs/u);
        assert.doesNotMatch(sql, /EXISTS\(SELECT 1 FROM signal_mass_labeling_memberships_v1/u,
          "root resolution must reuse the shared membership roots");
        if (!massPlanChecked) {
          const explained = (await raw.query("EXPLAIN (FORMAT JSON) " + sql, values)).rows[0]!["QUERY PLAN"][0].Plan;
          type Plan = { "Subplan Name"?: string; "Node Type": string; Plans?: Plan[] };
          const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
          const roots = nodes(explained).find(node => node["Subplan Name"] === "CTE all_roots");
          assert.ok(roots);
          assert.equal(nodes(roots).some(node => node["Node Type"] === "Function Scan"), false,
            "candidate arrays must be expanded outside the per-root resolution plan");
          assert.equal(nodes(roots).some(node => node["Subplan Name"]?.startsWith("SubPlan")), false,
            "the root plan must not rerun a correlated membership subquery");
          massPlanChecked = true;
        }
      }
      if (sql.includes("HAVING count(*)=$3") && sql.includes("signal_mass_labeling_r13_interest_results")) {
        assert.equal((await raw.query("SELECT count(*)::int n FROM signal_mass_labeling_study_policies WHERE workspace_id=$1",[values?.[0]])).rows[0]!.n,0,
          "explicit study interests never rescan superseded R13 receipts");
      }
      if (sql.includes("expected_pairs") && sql.includes("signal_mass_labeling_root_segments")) {
        assert.doesNotMatch(sql,/jsonb_array_length|signal_mass_labeling_items/u,"coverage uses the cardinalities materialized with each frozen root");
      }
      if (sql.includes("consumer_indicators") || sql.includes("reviewed_consumers AS MATERIALIZED")) {
        assert.doesNotMatch(sql,/signal_mass_labeling_category_(?:pattern|matches)_/u,"Signal joins materialized lexical matches");
        assert.match(sql,/signal_mass_labeling_category_matches lexical/u);
      }
      return raw.query(sql, values);
    };
    const scoped = Object.assign(Object.create(raw), {query, release() {}});
    const database = Object.assign(Object.create(pool), {query, connect: async () => scoped}) as Pool;
    const denied=async(sql:string,args:unknown[],pattern:RegExp)=>{await query("SAVEPOINT denied_scoped_write");
      await assert.rejects(query(sql,args),pattern);await query("ROLLBACK TO SAVEPOINT denied_scoped_write");await query("RELEASE SAVEPOINT denied_scoped_write");};
    let scopedExtensionId="",scopedPolicyId="";
    let consolidationArtifactId="",consolidationRaw="",terminalCallId="",successorCallId="";
    let terminalBefore:unknown;
    let sourceCheckpoints:MassLabelingSourceCheckpointV1[]=[];
    const syntheticSaves=createSignalTopicEditorialRenewalSyntheticSavesV1(undefined,{brand_name:"Synthetic fixture"});
    const seed = await seedSignalTopicEditorialRenewalSourceV1({database, scoped, query, cleanup: async () => {},
      saves:syntheticSaves,
      root_count:rootCount,numeric_daily_cap_micro_usd: 10_000_000, projection: {split_guided_groups:true,interpretation_configuration:globalConfiguration,engine_config: {profile_version: "workspace-bertopic-mass-labeling-v1", fixture: true},
        onCheckpoint: async fixture => {
          if(fixture.proposals.length!==2)return;
          const assignment=[...fixture.bodies.entries()].find(([key])=>key.endsWith("/assignments.guided.jsonl"))![1];
          const group_ids=[...new Set(assignment.trim().split("\n").map(line=>`guided:${JSON.parse(line).stable_cluster_id}`))].sort();
          sourceCheckpoints=[...fixture.proposals];
          const sourceArgs={...fixture.access,source_engine_execution_id:fixture.lease.execution_id,
            source_checkpoints:sourceCheckpoints,lease:fixture.lease,expected_group_ids:group_ids};
          const verified=await verifyMassLabelingSourceCheckpointsV1(sourceArgs);
          const sourceGroups=verified.source_groups;
          const beforeCalls=(await query("SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1",[fixture.lease.execution_id])).rows[0]!.n;
          await assert.rejects(verifyMassLabelingSourceCheckpointsV1({...sourceArgs,
            claimed_source_groups:sourceGroups.map(group=>({...group,name:"Delivered baseline category",definition:"A substituted baseline definition."}))}),
            /mass_labeling_source_checkpoint_invalid/,"valid IDs cannot carry substituted baseline summary text");
          await assert.rejects(verifyMassLabelingSourceCheckpointsV1({...sourceArgs,source_checkpoints:sourceCheckpoints.slice(1)}),
            /mass_labeling_source_checkpoint_invalid/,"a source group cannot be omitted before the global call");
          await assert.rejects(verifyMassLabelingSourceCheckpointsV1({...sourceArgs,
            source_checkpoints:sourceCheckpoints.map(packet=>({...packet,body:packet.body+" "}))}),
            /mass_labeling_source_checkpoint_invalid/,"source bytes must match their durable SHA");
          assert.equal((await query("SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1",[fixture.lease.execution_id])).rows[0]!.n,beforeCalls,
            "invalid source groups never reserve a global paid call");
          const batch=buildMassLabelingConsolidationRequestV1({workspace_id:fixture.access.workspace_id,
            source_engine_execution_id:fixture.lease.execution_id,source_groups:sourceGroups});
          const sourceGroupsDigest=batch.source_groups_digest;
          const output={topics:[{topic_key:"bicycle_repairs",name:"Bicycle repairs",definition:"Experiences repairing bicycles.",group_ids,...(localization?{localization}:{})}],excluded_groups:[]};
          const rawResponse=JSON.stringify({id:"msg_synthetic_global",type:"message",role:"assistant",model:globalConfiguration.model,
            stop_reason:"end_turn",content:[{type:"text",text:JSON.stringify(output)}],usage:{input_tokens:100,output_tokens:50}});
          consolidationRaw=JSON.stringify({contract_version:"workspace-mass-labeling-consolidation-v1",workspace_id:fixture.access.workspace_id,
            source_engine_execution_id:fixture.lease.execution_id,source_groups:sourceGroups,source_groups_digest:sourceGroupsDigest,
            raw_response:rawResponse,output});
          const reservation={...fixture.access,execution_id:fixture.lease.execution_id,
            idempotency_key:randomUUID(),request_digest:batch.request_digest,
            configuration:batch.configuration,reserved_micro_usd:batch.reserved_micro_usd,
            budget_timezone:"America/Mexico_City",daily_cap_micro_usd:30_000_000,execution_token:fixture.lease.execution_token,
            mass_labeling_stage:{stage:"global-consolidation-v1" as const,source_groups_digest:sourceGroupsDigest}};
          const original=await editorialMoney.reserveSignalWorkspaceEngineInterpretationV1(reservation);
          const originalToken={database,call_id:original.call_id,attempt_token:original.attempt_token};
          await editorialMoney.markSignalWorkspaceEngineInterpretationSentV1({...originalToken,execution_token:fixture.lease.execution_token});
          await editorialMoney.failSignalWorkspaceEngineInterpretationV1({...originalToken,outcome:"outcome_unknown",error_code:"workspace_engine_mass_consolidation_transport_failed"});
          await failSignalWorkspaceEngineV1({database,lease:fixture.lease,error_code:"workspace_engine_mass_consolidation_transport_failed"});
          const sentAt=(await query("SELECT sent_at FROM engine_cost_events WHERE id=$1",[original.call_id])).rows[0]!.sent_at;
          await editorialMoney.reconcileSignalWorkspaceEngineTerminalV1({...originalToken,workspace_id:fixture.access.workspace_id,execution_id:fixture.lease.execution_id,
            expected_request_digest:batch.request_digest,verifier_user_id:fixture.access.actor_user_id,terminal:{source:"anthropic_console",provider_request_id:"req_synthetic_global_terminal",
              provider_model:batch.configuration.model,started_at:new Date(sentAt).toISOString(),ended_at:new Date().toISOString(),http_status:499,reason:"client_disconnected",
              usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0},
              evidence:{storage_key:`workspace-engine/${fixture.access.workspace_id}/${fixture.lease.execution_id}/terminal-proof.json`,sha256:digest("synthetic terminal proof"),size_bytes:24}}});
          await retrySignalWorkspaceEngineV1({...fixture.access,execution_id:fixture.lease.execution_id,idempotency_key:randomUUID()});
          const resumed=await claimSignalWorkspaceEngineV1({database,execution_id:fixture.lease.execution_id,worker_job_id:"synthetic-global-successor"});
          assert.ok(resumed);Object.assign(fixture.lease,resumed);
          const successorArgs={...reservation,execution_token:fixture.lease.execution_token,idempotency_key:`global:retry:${original.call_id}`,retry_of_call_id:original.call_id};
          await assert.rejects(editorialMoney.reserveSignalWorkspaceEngineInterpretationV1(successorArgs),/mass_labeling_global_terminal_billing_required/);
          await editorialMoney.settleSignalWorkspaceEngineTerminalBillingV1({...originalToken,workspace_id:fixture.access.workspace_id,execution_id:fixture.lease.execution_id,
            expected_provider_request_id:"req_synthetic_global_terminal",verifier_user_id:fixture.access.actor_user_id});
          terminalCallId=original.call_id;terminalBefore=(await query("SELECT row_to_json(call) body FROM engine_cost_events call WHERE id=$1",[original.call_id])).rows[0]!.body;
          await assert.rejects(editorialMoney.reserveSignalWorkspaceEngineInterpretationV1({...successorArgs,mass_labeling_stage:{...reservation.mass_labeling_stage,source_groups_digest:digest("another source")}}),/mass_labeling_global_successor_stage_mismatch/);
          await assert.rejects(editorialMoney.reserveSignalWorkspaceEngineInterpretationV1({...successorArgs,mass_labeling_stage:undefined}),/mass_labeling_global_successor_stage_mismatch/);
          await assert.rejects(editorialMoney.reserveSignalWorkspaceEngineInterpretationV1({...successorArgs,execution_token:randomUUID()}),/workspace_engine_interpretation_lease_conflict/);
          const budgetBefore=await editorialMoney.loadSignalWorkspaceEngineInterpretationBudgetV1({...fixture.access,execution_id:fixture.lease.execution_id});
          assert.equal(budgetBefore.terminal_reserved_micro_usd,0,"audited billing replaces the terminal reservation with its exact charge");
          const call=await editorialMoney.reserveSignalWorkspaceEngineInterpretationV1(successorArgs);
          const budgetAfter=await editorialMoney.loadSignalWorkspaceEngineInterpretationBudgetV1({...fixture.access,execution_id:fixture.lease.execution_id});
          assert.equal(budgetAfter.confirmed_micro_usd,budgetBefore.confirmed_micro_usd,"reserving the successor keeps all original charges");
          assert.equal(budgetAfter.reserved_micro_usd,budgetBefore.reserved_micro_usd+call.reserved_micro_usd);
          successorCallId=call.call_id;
          assert.equal((await editorialMoney.reserveSignalWorkspaceEngineInterpretationV1(successorArgs)).call_id,call.call_id);
          // Direct SQL cannot relabel a retry as another source or ordinary editorial work.
          for(const stage of [undefined,{...reservation.mass_labeling_stage,source_groups_digest:digest("another source")}]){
            await query("SAVEPOINT bad_global_stage");
            await assert.rejects(query(`INSERT INTO engine_cost_events SELECT (jsonb_populate_record(NULL::engine_cost_events,to_jsonb(call)||$2::jsonb)).*
              FROM engine_cost_events call WHERE id=$1`,[call.call_id,JSON.stringify({id:randomUUID(),idempotency_key:randomUUID(),attempt_token:randomUUID(),
                metadata:stage?{mass_labeling_stage:stage}:{}})]),/mass_labeling_global_successor_stage_mismatch/);
            await query("ROLLBACK TO SAVEPOINT bad_global_stage");await query("RELEASE SAVEPOINT bad_global_stage");
          }
          await query("SAVEPOINT duplicate_global_successor");
          await assert.rejects(query(`INSERT INTO engine_cost_events SELECT (jsonb_populate_record(NULL::engine_cost_events,to_jsonb(call)||$2::jsonb)).*
            FROM engine_cost_events call WHERE id=$1`,[call.call_id,JSON.stringify({id:randomUUID(),idempotency_key:randomUUID(),attempt_token:randomUUID()})]),/uq_workspace_interpretation_successor/);
          await query("ROLLBACK TO SAVEPOINT duplicate_global_successor");await query("RELEASE SAVEPOINT duplicate_global_successor");
          const token={database,call_id:call.call_id,attempt_token:call.attempt_token};
          await query("SAVEPOINT revoked_global_actor");
          await query("UPDATE users SET status='suspended' WHERE id=$1",[fixture.access.actor_user_id]);
          await assert.rejects(editorialMoney.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:fixture.lease.execution_token}),/workspace_engine_interpretation_forbidden/);
          await query("ROLLBACK TO SAVEPOINT revoked_global_actor");await query("RELEASE SAVEPOINT revoked_global_actor");
          assert.equal((await editorialMoney.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:fixture.lease.execution_token})).send_authorized,true);
          assert.equal((await editorialMoney.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:fixture.lease.execution_token})).send_authorized,false);
          await query("SAVEPOINT second_global_terminal");
          await editorialMoney.failSignalWorkspaceEngineInterpretationV1({...token,outcome:"outcome_unknown",error_code:"workspace_engine_mass_consolidation_transport_failed"});
          await failSignalWorkspaceEngineV1({database,lease:fixture.lease,error_code:"workspace_engine_mass_consolidation_transport_failed"});
          const childSent=(await query("SELECT sent_at FROM engine_cost_events WHERE id=$1",[call.call_id])).rows[0]!.sent_at;
          await editorialMoney.reconcileSignalWorkspaceEngineTerminalV1({...token,workspace_id:fixture.access.workspace_id,execution_id:fixture.lease.execution_id,
            expected_request_digest:batch.request_digest,verifier_user_id:fixture.access.actor_user_id,terminal:{source:"anthropic_console",provider_request_id:"req_synthetic_second_global_terminal",
              provider_model:batch.configuration.model,started_at:new Date(childSent).toISOString(),ended_at:new Date().toISOString(),http_status:499,reason:"client_disconnected",
              usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0},
              evidence:{storage_key:`workspace-engine/${fixture.access.workspace_id}/${fixture.lease.execution_id}/second-terminal-proof.json`,sha256:digest("second terminal proof"),size_bytes:21}}});
          await editorialMoney.settleSignalWorkspaceEngineTerminalBillingV1({...token,workspace_id:fixture.access.workspace_id,execution_id:fixture.lease.execution_id,
            expected_provider_request_id:"req_synthetic_second_global_terminal",verifier_user_id:fixture.access.actor_user_id});
          await assert.rejects(retrySignalWorkspaceEngineV1({...fixture.access,execution_id:fixture.lease.execution_id,idempotency_key:randomUUID()}),/workspace_engine_retry_unavailable/);
          await query("ROLLBACK TO SAVEPOINT second_global_terminal");await query("RELEASE SAVEPOINT second_global_terminal");
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
          await query("SAVEPOINT global_already_persisted");
          await assert.rejects(query(`INSERT INTO engine_cost_events SELECT (jsonb_populate_record(NULL::engine_cost_events,to_jsonb(call)||$2::jsonb)).*
            FROM engine_cost_events call WHERE id=$1`,[call.call_id,JSON.stringify({id:randomUUID(),idempotency_key:randomUUID(),attempt_token:randomUUID()})]),/mass_labeling_global_artifact_already_persisted/);
          await query("ROLLBACK TO SAVEPOINT global_already_persisted");await query("RELEASE SAVEPOINT global_already_persisted");
        }}});
    const access = {database, workspace_id: seed.scope.workspace_id, actor_user_id: seed.scope.actor_user_id};
    const foreignActor = randomUUID();
    await query(`INSERT INTO users(id,email,user_type,primary_role,status)
      VALUES($1,$2,'client','client_admin','active')`, [foreignActor, `${foreignActor}@example.invalid`]);
    await query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2) ON CONFLICT DO NOTHING",
      [access.workspace_id, access.actor_user_id]);
    const artifact = (await query(`SELECT id,content FROM analysis_artifacts
      WHERE engine_execution_id=$1 AND artifact_key='assignments.guided.jsonl'`, [seed.source_engine_execution_id])).rows[0]!;
    const assignmentsRaw = seed.projection.bodies.get(artifact.content.storage_key)!;
    assert.ok(assignmentsRaw);
    const groupIds=[...new Set(assignmentsRaw.trim().split("\n").map(line=>`guided:${JSON.parse(line).stable_cluster_id}`))].sort();
    const mapArgs = {...access, source_engine_execution_id: seed.source_engine_execution_id,
      assignments_artifact_id: artifact.id, assignments_raw: assignmentsRaw,
      consolidation_artifact_id:consolidationArtifactId,consolidation_raw:consolidationRaw,source_checkpoints:sourceCheckpoints,
      catalog: [{topic_key: "bicycle_repairs", name: "Bicycle repairs", definition: "Experiences repairing bicycles.", group_ids:groupIds,...(localization?{localization}:{})}]};
    await assert.rejects(createMassLabelingMapV1({...mapArgs, actor_user_id: foreignActor}), /mass_labeling_forbidden/);
    await assert.rejects(createMassLabelingMapV1({...mapArgs, assignments_raw: assignmentsRaw+" "}), /mass_labeling_source_invalid/);
    await assert.rejects(createMassLabelingMapV1({...mapArgs,source_checkpoints:[]}),/mass_labeling_source_checkpoint_invalid/);
    const map = await createMassLabelingMapV1(mapArgs);
    await assertMassLabelingServingProjectionV1(scoped.query,access.workspace_id,map.map_id);
    if(authorization==="product"){await assertMassLabelingProductNativeV2({...access,query:scoped.query,map_id:map.map_id});await assertMassLabelingServingProjectionV1(scoped.query,access.workspace_id,map.map_id);return;}
    const candidateSample=(await query("SELECT candidates FROM signal_mass_labeling_items WHERE map_id=$1 ORDER BY ordinal LIMIT 1",[map.map_id])).rows[0]!.candidates[0];
    assert.equal(candidateSample.name,localization?.original.name??"Bicycle repairs");
    assert.equal(candidateSample.definition,localization?.original.definition??"Experiences repairing bicycles.");
    const frozenCatalog=(await query("SELECT catalog FROM signal_mass_labeling_maps WHERE id=$1",[map.map_id])).rows[0]!.catalog;
    assert.equal(frozenCatalog[0].name,"Bicycle repairs");
    if(localization)assert.deepEqual(frozenCatalog[0].localization,localization);
    await query("SAVEPOINT projected_text_change");
    const firstRoot=(await query("SELECT root_id FROM signal_mass_labeling_items WHERE map_id=$1 ORDER BY ordinal LIMIT 1",[map.map_id])).rows[0]!.root_id;
    await query("UPDATE mentions SET text_clean='#synthetic' WHERE workspace_id=$1 AND id=$2",[access.workspace_id,firstRoot]);
    assert.equal((await query("SELECT conversation_segment FROM signal_mass_labeling_root_segments WHERE map_id=$1 AND root_id=$2",[map.map_id,firstRoot])).rows[0]!.conversation_segment,"hashtags");
    await query("ROLLBACK TO SAVEPOINT projected_text_change");await query("RELEASE SAVEPOINT projected_text_change");
    if(localization){
      await importMassLabelingR13V1({...access,map_id:map.map_id,translations:[{topic_key:"bicycle_repairs",...localization}]});
      assert.equal((await query("SELECT count(*)::int n FROM signal_mass_labeling_localizations WHERE map_id=$1",[map.map_id])).rows[0]!.n,0,
        "sealed catalog wording already supplies localization without a sidecar");
      await assert.rejects(importMassLabelingR13V1({...access,map_id:map.map_id,translations:[{topic_key:"bicycle_repairs",...localization,
        en:{...localization.en,name:"Changed canonical wording"}}]}),/r13_original_changed/);
    }


    assert.equal((await createMassLabelingMapV1(mapArgs)).map_id, map.map_id);
    assert.equal((await query("SELECT count(*)::int n FROM signal_mass_labeling_items WHERE map_id=$1", [map.map_id])).rows[0].n, rootCount);
    const siblingFixture=scopedMode?await import("./signal-mfp-mass-labeling-sibling.synthetic.fixture"):null;
    const sibling=siblingFixture?await siblingFixture.seedMassLabelingSiblingEditorialV1({database,scoped,query,cleanup:async()=>{},identity:seed.identity}):null;
    if(sibling){
      const window=(await query(`SELECT valid_from<=transaction_timestamp() AND valid_until>transaction_timestamp() transaction_valid,
        valid_from<=clock_timestamp() AND valid_until>clock_timestamp() wall_clock_valid
        FROM signal_processing_policy_versions WHERE id=$1 AND status='active'`,[sibling.policy_id])).rows[0];
      assert.deepEqual(window,{transaction_valid:true,wall_clock_valid:true},
        "the synthetic base covers both clocks even when the large setup outlasts one minute");
    }
    const siblingBefore=siblingFixture&&sibling?await siblingFixture.snapshotMassLabelingSiblingAuthorityV1({query,...sibling}):null;
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
    await query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2) ON CONFLICT DO NOTHING",
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
    const siblingWorkspace=(await query("SELECT id FROM signal_workspaces WHERE brand_id=$1",[siblingBrand])).rows[0]!.id;
    await query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id)
      VALUES($1,$2,$3,$4)`,[siblingPrep,siblingWorkspace,access.actor_user_id,`mass-sibling-${siblingRun}`]);
    await query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
      VALUES($1,'facets','anthropic','claude-sonnet-5-5',$2,$2,$3,'{}')`,[siblingLabeler,digest({fixture:true}),digest({siblingLabeler})]);
    await query(`INSERT INTO signal_entity_context_versions(workspace_id,version_no,digest,context,diff,affected_mode,affected_count)
      VALUES($1,1,$2,'{"entities":[]}'::jsonb,'{}'::jsonb,'targeted',0)`,[siblingWorkspace,digest({fixture:true})]);
    await query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,
      entity_context_digest,entity_context_version_no,estimated_micro_usd,idempotency_key,request_digest,actor_user_id)
      VALUES($1,$2,'facets',$3,$4,$5,1,0,$6,$5,$7)`,[siblingRun,siblingWorkspace,siblingLabeler,siblingPrep,digest({fixture:true}),randomUUID(),access.actor_user_id]);
    await assert.rejects(provisionMassLabelingPolicyV1({...access,cap_micro_usd:1_000_000}),/mass_labeling_policy_active_work/);
    await query("ROLLBACK TO SAVEPOINT active_sibling");
    if(scopedMode){
      const api=await import("../signal-mass-labeling-scoped-policy");
      const grantArgs={...access,map_id:map.map_id,cap_micro_usd:1_000_000};
      const grant=await api.provisionMassLabelingScopedPolicyV1(grantArgs);scopedExtensionId=grant.extension_id;scopedPolicyId=grant.policy_id;
      await assert.rejects(api.provisionMassLabelingScopedPolicyV1({...grantArgs,cap_micro_usd:1_000_001}),/scoped_policy_conflict/);
      await denied("UPDATE signal_mass_labeling_policy_extensions SET cap_micro_usd=cap_micro_usd+1 WHERE id=$1",[grant.extension_id],/append-only/);
      await denied("DELETE FROM signal_mass_labeling_policy_extensions WHERE id=$1",[grant.extension_id],/append-only/);
      await denied("UPDATE signal_processing_policy_actions SET max_execution_micro_usd=1 WHERE policy_version_id=$1",[grant.policy_id],/immutable/);
      await denied("DELETE FROM signal_processing_policy_actions WHERE policy_version_id=$1",[grant.policy_id],/immutable/);
      await denied("DELETE FROM signal_processing_policy_versions WHERE id=$1",[grant.policy_id],/history_retained/);
      await denied("UPDATE signal_processing_admissions SET execution_cap_micro_usd=1 WHERE id=$1",[sibling!.processing_admission_id],/immutable/);
      await denied("DELETE FROM signal_processing_admissions WHERE id=$1",[sibling!.processing_admission_id],/immutable/);
      const fk=(await query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='signal_processing_admissions'::regclass AND conname='fk_processing_admission_policy_action'" )).rows[0];
      assert.match(fk!.definition,/FOREIGN KEY \(policy_version_id, action\)/);
      const contender=await pool.connect();try{
        await contender.query("BEGIN");const held=(await contender.query(`SELECT pg_try_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0)) acquired`,[seed.identity.organization_id])).rows[0];
        assert.equal(held!.acquired,false,"a second physical transaction cannot cross the common organization lock");
      }finally{await contender.query("ROLLBACK");contender.release();}
      await query("SAVEPOINT short_scoped_admission");
      await (await import("../signal-mention-facets")).registerFacetContextV1(scoped,access.workspace_id);
      const shortRun=randomUUID(),shortAdmission=randomUUID(),identity=massLabelingJevIdentityV1(),labelDigest=labelerDigestV1(identity);
      await query(`INSERT INTO signal_labeler_versions(kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
        VALUES('mass_labeling','typesafe','jev-1.13.0',$1,$2,$3,$4::jsonb) ON CONFLICT(labeler_digest) DO NOTHING`,[identity.prompt_digest,identity.schema_digest,labelDigest,JSON.stringify(identity)]);
      await query(`INSERT INTO signal_mass_labeling_scoped_admissions(id,extension_id,organization_id,policy_version_id,workspace_id,map_id,actor_user_id,target_id,idempotency_key,request_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,receipt_digest)
        SELECT $1,e.id,e.organization_id,p.id,e.workspace_id,e.map_id,e.actor_user_id,$2,$3,$4,1000000,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone,
          least(p.valid_until,clock_timestamp()+interval '1 second'),'pending'
        FROM signal_mass_labeling_policy_extensions e JOIN signal_processing_policy_versions p ON p.id=e.base_policy_version_id WHERE e.id=$5`,[shortAdmission,shortRun,randomUUID(),digest("short scoped admission"),grant.extension_id]);
      await query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,concept_set_digest,entity_context_digest,entity_context_version_no,
        estimated_micro_usd,cap_micro_usd,idempotency_key,request_digest,actor_user_id,status,lease_token,lease_until)
        SELECT $1,m.workspace_id,'mass_labeling',l.id,m.preparation_run_id,m.map_digest,m.entity_context_digest,(SELECT max(version_no) FROM signal_entity_context_versions WHERE workspace_id=m.workspace_id),0,1000000,$2,$3,$4,'running',$5,clock_timestamp()+interval '1 hour'
        FROM signal_mass_labeling_maps m JOIN signal_labeler_versions l ON l.labeler_digest=$6 WHERE m.id=$7`,[shortRun,randomUUID(),digest("short scoped run"),access.actor_user_id,randomUUID(),labelDigest,map.map_id]);
      await query("INSERT INTO signal_mass_labeling_runs(workspace_id,map_id,run_id,smoke_root_limit) VALUES($1,$2,$3,1000)",[access.workspace_id,map.map_id,shortRun]);
      await query("SET CONSTRAINTS ALL IMMEDIATE");await query("SET CONSTRAINTS ALL DEFERRED");
      const shortCall=randomUUID();await query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,budget_date,budget_timezone)
        SELECT $1,a.target_id,a.workspace_id,'typesafe','jev-1.13.0','sync',$2,$3,'{}',jsonb_build_array(jsonb_build_object('root_id',i.root_id,'input_digest',i.input_digest,'map_id',i.map_id)),50,a.budget_date,a.budget_timezone
        FROM signal_mass_labeling_scoped_admissions a JOIN signal_mass_labeling_items i ON i.map_id=a.map_id WHERE a.id=$4 ORDER BY i.ordinal LIMIT 1`,[shortCall,randomUUID(),digest("never sent expiry fixture"),shortAdmission]);
      await query("SELECT pg_sleep(1.05)");
      await denied("UPDATE signal_labeling_calls SET status='submitting' WHERE id=$1",[shortCall],/scoped_admission_invalid/);
      await denied("UPDATE signal_mass_labeling_runs SET smoke_root_limit=NULL,continued_at=clock_timestamp() WHERE run_id=$1",[shortRun],/scoped_admission_invalid|smoke_review_required/);
      await query("ROLLBACK TO SAVEPOINT short_scoped_admission");await query("RELEASE SAVEPOINT short_scoped_admission");
      assert.equal((await api.provisionMassLabelingScopedPolicyV1(grantArgs)).extension_id,grant.extension_id);
      assert.equal((await query("SELECT signal_mass_labeling_scoped_identity_v1() digest")).rows[0]!.digest,labelerDigestV1(massLabelingJevIdentityV1()));
      await query("SAVEPOINT finite_common_budget");
      const otherAdmin=randomUUID();await query(`INSERT INTO users(id,email,user_type,primary_role,status,organization_id)
        VALUES($1,$2,'noisia_internal','noisia_admin','active',$3)`,[otherAdmin,`${otherAdmin}@example.invalid`,seed.identity.organization_id]);
      await assert.rejects(query(`INSERT INTO signal_mass_labeling_policy_extensions SELECT (jsonb_populate_record(NULL::signal_mass_labeling_policy_extensions,to_jsonb(e)||jsonb_build_object('id',$2::uuid,'actor_user_id',$3::uuid,'cap_micro_usd',p.daily_cap_micro_usd))).*
        FROM signal_mass_labeling_policy_extensions e JOIN signal_processing_policy_versions p ON p.id=e.base_policy_version_id WHERE e.id=$1`,[grant.extension_id,randomUUID(),otherAdmin]),/processing_daily_cap_exhausted/);
      await query("ROLLBACK TO SAVEPOINT finite_common_budget");await query("RELEASE SAVEPOINT finite_common_budget");
      await assert.rejects(provisionMassLabelingPolicyV1({...access,cap_micro_usd:1_000_000}),/mass_labeling_policy_active_work/);
    }else await provisionMassLabelingPolicyV1({...access, cap_micro_usd: 1_000_000});
    assert.deepEqual((await query("SELECT signal_topic_consolidation_source_binding_v1($1) binding",[seed.source_engine_execution_id])).rows[0]!.binding,sourceBefore);
    const historyAfter = await snapshotSignalTopicEditorialRenewalSyntheticHistoryV1({query});
    for(const [table,before] of Object.entries(historyBefore)) {
      if(scopedMode||!["signal_processing_policy_versions","signal_processing_policy_actions"].includes(table))
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
    await query("SAVEPOINT missing_mass_owner");
    if(scopedMode)await assert.rejects(query("SELECT admit_signal_processing_v1($1,$2,'mass_labeling_jev',$3,$4,$5,1000000,false)",
      [access.workspace_id,access.actor_user_id,randomUUID(),randomUUID(),digest({missing_owner:true})]),/processing_action_unavailable/);
    else{
      await query("SELECT admit_signal_processing_v1($1,$2,'mass_labeling_jev',$3,$4,$5,1000000,false)",
        [access.workspace_id,access.actor_user_id,randomUUID(),randomUUID(),digest({missing_owner:true})]);
      await assert.rejects(query("SET CONSTRAINTS ALL IMMEDIATE"),/mass_labeling_admission_owner_required/);
    }
    await query("ROLLBACK TO SAVEPOINT missing_mass_owner");await query("RELEASE SAVEPOINT missing_mass_owner");
    if(scopedMode){
      await assert.rejects(requestMassLabelingV1({...request,map_id:randomUUID(),idempotency_key:randomUUID()}),/policy_unavailable/);
      await assert.rejects(requestMassLabelingV1({...request,actor_user_id:foreignActor,idempotency_key:randomUUID()}));
    }
    const admitted = await requestMassLabelingV1(request);
    await query("SET CONSTRAINTS ALL IMMEDIATE");await query("SET CONSTRAINTS ALL DEFERRED");
    assert.equal((await requestMassLabelingV1({...request, provider_available: false})).run_id, admitted.run_id);
    if(scopedMode){
      const native=(await query("SELECT processing_admission_id FROM signal_labeling_runs WHERE id=$1",[admitted.run_id])).rows[0];assert.equal(native!.processing_admission_id,null);
      assert.equal((await query("SELECT count(*)::int n FROM signal_mass_labeling_scoped_admissions WHERE target_id=$1 AND extension_id=$2",[admitted.run_id,scopedExtensionId])).rows[0]!.n,1);
      await denied("UPDATE signal_labeling_runs SET cap_micro_usd=cap_micro_usd+1 WHERE id=$1",[admitted.run_id],/owner_immutable/);
      await denied("UPDATE signal_mass_labeling_scoped_admissions SET execution_cap_micro_usd=2 WHERE target_id=$1",[admitted.run_id],/append-only/);
      await denied("DELETE FROM signal_mass_labeling_scoped_admissions WHERE target_id=$1",[admitted.run_id],/append-only/);
      for(const native of [null,sibling!.processing_admission_id]){
        await query("SAVEPOINT null_is_not_authority");
        await query(`INSERT INTO signal_labeling_runs SELECT (jsonb_populate_record(NULL::signal_labeling_runs,to_jsonb(r)||$2::jsonb)).*
          FROM signal_labeling_runs r WHERE id=$1`,[admitted.run_id,JSON.stringify({id:randomUUID(),idempotency_key:randomUUID(),status:"failed",processing_admission_id:native})]);
        await assert.rejects(query("SET CONSTRAINTS ALL IMMEDIATE"),/scoped_admission_required|native_admission_invalid/);
        await query("ROLLBACK TO SAVEPOINT null_is_not_authority");await query("RELEASE SAVEPOINT null_is_not_authority");
      }
      for(const mutation of [{actor_user_id:foreignActor},{map_id:randomUUID()},{execution_cap_micro_usd:1_000_001}])await denied(
        `INSERT INTO signal_mass_labeling_scoped_admissions SELECT (jsonb_populate_record(NULL::signal_mass_labeling_scoped_admissions,to_jsonb(a)||$2::jsonb)).*
        FROM signal_mass_labeling_scoped_admissions a WHERE target_id=$1`,[admitted.run_id,JSON.stringify({id:randomUUID(),target_id:randomUUID(),idempotency_key:randomUUID(),...mutation})],/forbidden|scoped_admission_invalid/);
      await denied(`INSERT INTO signal_mass_labeling_scoped_admissions SELECT (jsonb_populate_record(NULL::signal_mass_labeling_scoped_admissions,to_jsonb(a)||$2::jsonb)).*
        FROM signal_mass_labeling_scoped_admissions a WHERE target_id=$1`,[admitted.run_id,JSON.stringify({id:randomUUID(),target_id:randomUUID(),idempotency_key:randomUUID()})],/extension_id_key/);
    }
    const raws = new Map<string,string>();
    const store = createMassLabelingStoreV1({database,
      storeRaw: async ({call_id, raw_text}) => {raws.set(call_id, raw_text); return `private/${call_id}`;},
      loadRaw: async ({call_id}) => raws.get(call_id)!, assertRawReady: async () => {}});
    // The legacy store must never claim this independently typed run.
    const {createSignalLabelingStoreV1} = await import("../signal-labeling-runs");
    assert.equal(await createSignalLabelingStoreV1({database, storeRaw: async () => "unused"}).claim(admitted.run_id), null);
    const run = await store.claim(admitted.run_id); assert.ok(run);
    const inputs = await store.inputs(run); assert.equal(inputs.length,Math.min(200,rootCount));
    if(authorization==="scoped-funding"){
      const {authorizeMassLabelingFullBudgetV1}=await import("../signal-mass-labeling-funding");
      const admission=(await query("SELECT * FROM signal_mass_labeling_scoped_admissions WHERE target_id=$1",[run.id])).rows[0]!;
      const fundingRequest={...access,map_id:map.map_id,run_id:run.id,idempotency_key:randomUUID(),
        total_cap_micro_usd:1_500_000,expected_prior_admission_id:admission.id,
        expected_prior_receipt_digest:admission.receipt_digest,expected_prior_cap_micro_usd:1_000_000,
        expected_smoke_metrics_digest:digest({not_sealed:true})};
      await assert.rejects(authorizeMassLabelingFullBudgetV1(fundingRequest),/funding_|smoke_/);
      const price=llmPriceV1("typesafe","jev-1.13.0","sync",0.042);
      const proposalsFor=(page:typeof inputs,reserved_micro_usd:number)=>page.map(input=>{
        const payload=buildMassLabelingJevRequestV1(input,run.context);
        return{custom_id:`funding_${digest({run:run.id,root:input.root_id}).slice(7)}`,request_digest:digest(payload),request:payload,inputs:[input],reserved_micro_usd};
      });
      const payPage=async(owner:typeof run,page:Awaited<ReturnType<typeof store.reserve>>)=>{
        await store.markSubmitting(owner,page);
        const outputs=page.map(call=>{
          const payload=call.request as ReturnType<typeof buildMassLabelingJevRequestV1>;
          const answers=Object.fromEntries(Object.entries(payload.questions).map(([key,question])=>{
            if(question.type==="noul")return[key,{type:"noul",noul:key==="topic_0"||key==="relevance"?0.95:0.05}];
            const chosen=key==="voice"?"individual":"none";
            return[key,{type:"choice",choice:chosen,confidence:0.99,probabilities:Object.fromEntries(Object.keys(question.criteria).map(choice=>[choice,choice===chosen?1:0]))}];
          }));
          const response={body:JSON.stringify({model:"jev-1.13.0",answers,usage:{input_tokens:100,output_tokens:0}}),http_status:200,latency_ms:1};
          const parsed=validateJevResponseV1(payload,response),usage=jevUsageV1(parsed.usage);
          return{call,response,usage,result:mapMassLabelingJevResponseV1(call.inputs[0]!,owner.context,parsed)};
        });
        await store.persistRawPage(owner,outputs.map(({call,response})=>({call,raw:JSON.stringify(response)})));
        await store.settlePage(owner,outputs.map(({call,usage})=>({call,usage,settled_micro_usd:llmCostMicroUsdV1(usage,price)})));
        await store.apply(owner,outputs.map(({call,result})=>({call,results:[result]})));
      };
      const smokeCallIds=new Set<string>();
      for(let pageNo=0;pageNo<5;pageNo++){
        const page=await store.inputs(run);assert.equal(page.length,200);
        const calls=await store.reserve(run,proposalsFor(page,50));assert.equal(calls.length,200);
        for(const call of calls){assert.ok(!smokeCallIds.has(call.id));smokeCallIds.add(call.id);}
        await payPage(run,calls);
      }
      assert.equal(smokeCallIds.size,1000);assert.equal((await store.inputs(run)).length,0);
      const smoke=await measureMassLabelingSmokeV1({...access,run_id:run.id});
      assert.equal(smoke.metrics.technical_failure,false);assert.ok(smoke.metrics_digest);
      fundingRequest.expected_smoke_metrics_digest=smoke.metrics_digest!;
      await assert.rejects(authorizeMassLabelingFullBudgetV1(fundingRequest),/funding_|smoke_/,
        "sealing 1,000 valid results does not authorize funding while the owner is still running");
      assert.equal(await store.finish(run),"completed");await store.release(run);
      const originalCalls=async()=>(await query("SELECT to_jsonb(c) body FROM signal_labeling_calls c WHERE run_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",[run.id,[...smokeCallIds]])).rows;
      const smokeBefore=await originalCalls();assert.equal(smokeBefore.length,1000);
      assert.equal(smokeBefore.reduce((sum,row)=>sum+Number(row.body.settled_micro_usd),0),5000);
      const ownerBefore=(await query("SELECT to_jsonb(r) owner,to_jsonb(m) mass FROM signal_labeling_runs r JOIN signal_mass_labeling_runs m ON m.run_id=r.id WHERE r.id=$1",[run.id])).rows[0]!;
      const extensionBefore=(await query("SELECT to_jsonb(e) body FROM signal_mass_labeling_policy_extensions e WHERE id=$1",[scopedExtensionId])).rows;
      const admissionBefore=(await query("SELECT to_jsonb(a) body FROM signal_mass_labeling_scoped_admissions a WHERE id=$1",[admission.id])).rows;
      for(const mutation of [{actor_user_id:foreignActor},{workspace_id:sibling!.workspace_id},{map_id:randomUUID()},
        {run_id:randomUUID()},{expected_prior_admission_id:randomUUID()},{expected_prior_receipt_digest:digest("other receipt")},
        {expected_prior_cap_micro_usd:999_999},{expected_smoke_metrics_digest:digest("other smoke")},{total_cap_micro_usd:1_000_000}]){
        await assert.rejects(authorizeMassLabelingFullBudgetV1({...fundingRequest,...mutation}),/forbidden|funding_|unavailable|smoke_|scoped_|map_stale/);
      }
      await query("SAVEPOINT funding_revoked_base");await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[scopedPolicyId]);
      await assert.rejects(authorizeMassLabelingFullBudgetV1(fundingRequest),/extension_invalid|funding_/);
      await query("ROLLBACK TO SAVEPOINT funding_revoked_base");await query("RELEASE SAVEPOINT funding_revoked_base");
      const authorized=await authorizeMassLabelingFullBudgetV1(fundingRequest);assert.equal(authorized.replayed,false);
      await denied("UPDATE signal_mass_labeling_funding_receipts SET total_cap_micro_usd=2500000 WHERE id=$1",[authorized.receipt.id],/append.only|immutable/);
      await denied("DELETE FROM signal_mass_labeling_funding_receipts WHERE id=$1",[authorized.receipt.id],/append.only|immutable/);
      const replay=await authorizeMassLabelingFullBudgetV1(fundingRequest);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,authorized.receipt);
      await assert.rejects(authorizeMassLabelingFullBudgetV1({...fundingRequest,total_cap_micro_usd:1_600_000}),/funding_|conflict/);
      await assert.rejects(authorizeMassLabelingFullBudgetV1({...fundingRequest,idempotency_key:randomUUID(),total_cap_micro_usd:1_600_000}),/funding_|conflict/,
        "a different request cannot append a second active ceiling to the same predecessor");
      assert.deepEqual((await query("SELECT to_jsonb(r) owner,to_jsonb(m) mass FROM signal_labeling_runs r JOIN signal_mass_labeling_runs m ON m.run_id=r.id WHERE r.id=$1",[run.id])).rows[0],ownerBefore,
        "authorization alone neither continues nor changes the historical run");
      assert.deepEqual(await originalCalls(),smokeBefore,"authorizing and replaying leaves every smoke receipt byte for byte intact");
      assert.deepEqual((await query("SELECT to_jsonb(e) body FROM signal_mass_labeling_policy_extensions e WHERE id=$1",[scopedExtensionId])).rows,extensionBefore);
      assert.deepEqual((await query("SELECT to_jsonb(a) body FROM signal_mass_labeling_scoped_admissions a WHERE id=$1",[admission.id])).rows,admissionBefore);
      const snapshot=await exportMassLabelingSnapshotV1({...access,map_id:map.map_id});
      assert.ok(snapshot.scoped_authority);assert.equal(snapshot.scoped_authority.effective_total_cap_micro_usd,"1500000");
      assert.equal(snapshot.scoped_authority.funding_receipts.length,1);assert.equal(snapshot.scoped_authority.funding_receipts[0]!.id,authorized.receipt.id);
      assert.equal(snapshot.scoped_authority.funding_receipts[0]!.prior_total_cap_micro_usd,"1000000");
      assert.equal(snapshot.scoped_authority.funding_receipts[0]!.total_cap_micro_usd,"1500000");
      assert.equal(snapshot.scoped_authority.call_authorities.length,1000);
      assert.ok(snapshot.scoped_authority.call_authorities.every((row:{scoped_admission_id:string;funding_receipt_id:string|null})=>row.scoped_admission_id===admission.id&&row.funding_receipt_id===null));
      await query("SAVEPOINT funded_base_revoked_before_continue");
      await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[scopedPolicyId]);
      await assert.rejects(continueMassLabelingV1({...access,run_id:run.id}),/extension_invalid/);
      assert.equal((await authorizeMassLabelingFullBudgetV1(fundingRequest)).replayed,true,"reading an existing authority never finances a new call");
      await query("ROLLBACK TO SAVEPOINT funded_base_revoked_before_continue");await query("RELEASE SAVEPOINT funded_base_revoked_before_continue");
      await continueMassLabelingV1({...access,run_id:run.id});assert.equal((await continueMassLabelingV1({...access,run_id:run.id})).replayed,true);
      const continuation=await store.claim(run.id);assert.ok(continuation);assert.equal(continuation.id,run.id);
      const remaining=await store.inputs(continuation);assert.equal(remaining.length,2);
      assert.ok(remaining.every(input=>!inputs.some(prior=>prior.root_id===input.root_id)));
      await assert.rejects(store.reserve(continuation,proposalsFor(remaining,800_000)),/cap_exhausted/,
        "the effective ceiling is 1.5M total rather than 1M plus 1.5M");
      assert.equal((await store.inputs(continuation)).length,2,"rejected page leaves no reservation or root ownership behind");
      await denied(`INSERT INTO signal_labeling_calls(run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,budget_date,budget_timezone)
        SELECT $1,$2,'typesafe','jev-1.13.0','sync',x.custom_id,x.request_digest,x.request,x.inputs,x.reserved_micro_usd,f.budget_date,f.budget_timezone
        FROM jsonb_to_recordset($3::jsonb) x(custom_id text,request_digest text,request jsonb,inputs jsonb,reserved_micro_usd bigint)
        JOIN signal_mass_labeling_funding_receipts f ON f.run_id=$1`,[run.id,run.workspace_id,JSON.stringify(proposalsFor(remaining,800_000))],/cap_exhausted/);
      assert.equal((await store.inputs(continuation)).length,2,"SQL over-cap page rolls back both reservations and their new authority bindings");
      const fullCalls=await store.reserve(continuation,proposalsFor(remaining,600_001));assert.equal(fullCalls.length,2);
      await denied("UPDATE signal_mass_labeling_call_authorities SET funding_receipt_id=NULL WHERE call_id=$1",[fullCalls[0]!.id],/append.only|immutable/);
      await denied("DELETE FROM signal_mass_labeling_call_authorities WHERE call_id=$1",[fullCalls[0]!.id],/append.only|immutable/);
      await query("SAVEPOINT retroactive_funding_binding");
      await query(`INSERT INTO signal_mass_labeling_call_authorities(call_id,scoped_admission_id,funding_receipt_id,workspace_id,run_id)
        VALUES($1,$2,$3,$4,$5)`,[[...smokeCallIds][0],admission.id,authorized.receipt.id,run.workspace_id,run.id]);
      await assert.rejects(query("SET CONSTRAINTS ALL IMMEDIATE"),/mass_labeling_funding_authority_invalid/,
        "a structurally valid link cannot retroactively attribute a paid smoke call to the successor");
      await query("ROLLBACK TO SAVEPOINT retroactive_funding_binding");await query("RELEASE SAVEPOINT retroactive_funding_binding");
      await query("SAVEPOINT cross_run_funding_binding");
      const facetIdentity=facetLabelerIdentityV1(),facetDigest=labelerDigestV1(facetIdentity),foreignRun=randomUUID(),foreignCall=randomUUID();
      await query(`INSERT INTO signal_labeler_versions(kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
        VALUES('facets',$1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(labeler_digest) DO NOTHING`,[facetIdentity.provider,facetIdentity.model,facetIdentity.prompt_digest,facetIdentity.schema_digest,facetDigest,JSON.stringify(facetIdentity)]);
      await query(`INSERT INTO signal_labeling_runs SELECT (jsonb_populate_record(NULL::signal_labeling_runs,to_jsonb(r)||jsonb_build_object('id',$2::uuid,'kind','facets',
        'labeler_version_id',(SELECT id FROM signal_labeler_versions WHERE labeler_digest=$3),'status','completed','idempotency_key',$4::text,'concept_set_digest',NULL,'cap_micro_usd',NULL))).*
        FROM signal_labeling_runs r WHERE id=$1`,[run.id,foreignRun,facetDigest,randomUUID()]);
      await query(`INSERT INTO signal_labeling_calls SELECT (jsonb_populate_record(NULL::signal_labeling_calls,to_jsonb(c)||
        jsonb_build_object('id',$2::uuid,'run_id',$3::uuid,'custom_id',$4::text,'provider',$5::text,'model',$6::text,'created_at',clock_timestamp()))).*
        FROM signal_labeling_calls c WHERE c.id=$1`,[fullCalls[0]!.id,foreignCall,foreignRun,randomUUID(),facetIdentity.provider,facetIdentity.model]);
      await query(`INSERT INTO signal_mass_labeling_call_authorities(call_id,scoped_admission_id,funding_receipt_id,workspace_id,run_id)
        VALUES($1,$2,$3,$4,$5)`,[foreignCall,admission.id,authorized.receipt.id,run.workspace_id,run.id]);
      await assert.rejects(query("SET CONSTRAINTS ALL IMMEDIATE"),/mass_labeling_funding_authority_invalid/,
        "a future call with an eligible root still cannot borrow authority from another run");
      await query("ROLLBACK TO SAVEPOINT cross_run_funding_binding");await query("RELEASE SAVEPOINT cross_run_funding_binding");
      const reservedSnapshot=await exportMassLabelingSnapshotV1({...access,map_id:map.map_id});
      for(const call of fullCalls)assert.equal(reservedSnapshot.scoped_authority!.call_authorities.find((row:{call_id:string})=>row.call_id===call.id)!.funding_receipt_id,authorized.receipt.id,
        "each successor call has an immutable funding authority before transmission");
      assert.equal((await query("SELECT sum(CASE WHEN settled_micro_usd IS NULL THEN reserved_micro_usd ELSE settled_micro_usd END)::text exposure FROM signal_labeling_calls WHERE run_id=$1",[run.id])).rows[0]!.exposure,"1205002");
      await query("SAVEPOINT funded_base_revoked_before_send");await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[scopedPolicyId]);
      await assert.rejects(store.markSubmitting(continuation,fullCalls),/extension_invalid/);
      await denied("UPDATE signal_labeling_calls SET status='submitting' WHERE id=$1",[fullCalls[0]!.id],/extension_invalid/);
      await query("ROLLBACK TO SAVEPOINT funded_base_revoked_before_send");await query("RELEASE SAVEPOINT funded_base_revoked_before_send");
      await payPage(continuation,fullCalls);
      assert.equal((await store.inputs(continuation)).length,0);assert.equal(await store.finish(continuation),"completed");await store.release(continuation);
      const final=await exportMassLabelingSnapshotV1({...access,map_id:map.map_id});assert.equal(final.calls.length,1002);assert.equal(final.items.length,1002);
      assert.deepEqual((await query(`SELECT count(*)::int rows,count(DISTINCT root_id)::int roots,count(DISTINCT call_id)::int calls
        FROM signal_mass_labeling_call_roots WHERE run_id=$1`,[run.id])).rows[0],{rows:1002,roots:1002,calls:1002},"every root has exactly one paid call");
      assert.deepEqual(await originalCalls(),smokeBefore,"continuation cannot rewrite or pay any smoke call again");
      const fundingReceipt=final.scoped_authority!.funding_receipts[0]!;
      const {quote:fundingQuote,receipt_digest:fundingReceiptDigest,...receiptPayload}=fundingReceipt;
      assert.equal(digest(fundingQuote),fundingReceipt.quote_digest,"quote hash is independently reproducible from the exact exported DTO");
      assert.equal(digest(receiptPayload),fundingReceiptDigest,"receipt hash binds every exported authority field");
      const smokeHashRows=final.calls.filter((call:{id:string})=>smokeCallIds.has(call.id)).sort((a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0).map((call)=>({
        id:call.id,run_id:call.run_id,model:call.model,status:call.status,reserved_micro_usd:call.reserved_micro_usd,settled_micro_usd:call.settled_micro_usd,
        terminal_exposure_micro_usd:call.terminal_exposure_micro_usd,usage:call.usage,request_digest:call.request_digest,raw_sha256:call.raw_sha256,
        results_applied:call.results_applied,budget_date:call.budget_date,budget_timezone:call.budget_timezone}));
      assert.equal(digest(smokeHashRows),fundingReceipt.smoke_calls_digest,"smoke hash remains reproducible after continuation");
      const exportPath=process.env.NOISIA_MFP_SYNTHETIC_EXPORT_PATH;
      if(exportPath){const {writeFile,chmod}=await import("node:fs/promises");await writeFile(exportPath,JSON.stringify(final),{mode:0o600});await chmod(exportPath,0o600);}
      assert.equal(final.run.cap_micro_usd,"1000000");assert.equal(final.scoped_authority!.effective_total_cap_micro_usd,"1500000");
      if(siblingFixture&&sibling)assert.deepEqual(await siblingFixture.snapshotMassLabelingSiblingAuthorityV1({query,...sibling}),siblingBefore,
        "funding authorization and continuation preserve the queued sibling and every base action");
      return;
    }
    if(authorization==="scoped-scale"){
      await query("SET LOCAL track_functions='pl'");
      const count=async()=>Number((await query("SELECT pg_stat_get_xact_function_calls('signal_mass_labeling_scoped_capacity_v1(uuid)'::regprocedure) n")).rows[0]!.n);
      const before=await count(),started=Date.now();
      const page=inputs.map(input=>{const payload=buildMassLabelingJevRequestV1(input,run.context);return{custom_id:`scale_${randomUUID()}`,request_digest:digest(payload),request:payload,inputs:[input],reserved_micro_usd:50};});
      const reserved=await store.reserve(run,page);assert.equal(reserved.length,200);
      assert.equal(await count()-before,1,"a 200-row reservation performs one complete SQL exposure check");
      await store.markSubmitting(run,reserved);
      assert.equal(await count()-before,2,"a 200-row send performs one additional complete SQL exposure check");
      console.log(`synthetic scoped page: 200 roots, reserve+send ${Date.now()-started}ms, 2 complete checks`);
      if(siblingFixture&&sibling)assert.deepEqual(await siblingFixture.snapshotMassLabelingSiblingAuthorityV1({query,...sibling}),siblingBefore);
      return;
    }
    const price = llmPriceV1("typesafe", "jev-1.13.0", "sync", 0.042);
    const proposals = inputs.map(input => {
      const payload = buildMassLabelingJevRequestV1(input, run.context);
      return {custom_id: `mass_${digest({run: run.id, root: input.root_id}).slice(7)}`,
        request_digest: digest(payload), request: payload, inputs: [input], reserved_micro_usd: 50};
    });
    if(scopedMode){
      await assert.rejects(store.reserve(run,[{...proposals[0]!,reserved_micro_usd:1_000_001}]),/cap_exhausted/);
      const rawInsert=`INSERT INTO signal_labeling_calls(run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,budget_date,budget_timezone)
        SELECT $1,$2,'typesafe','jev-1.13.0','sync',$3,$4,$5::jsonb,$6::jsonb,$7,a.budget_date,a.budget_timezone FROM signal_mass_labeling_scoped_admissions a WHERE a.target_id=$1`;
      await denied(rawInsert,[run.id,run.workspace_id,randomUUID(),proposals[0]!.request_digest,JSON.stringify(proposals[0]!.request),JSON.stringify(proposals[0]!.inputs),1_000_001],/cap_exhausted/);
      await denied(rawInsert,[run.id,randomUUID(),randomUUID(),proposals[0]!.request_digest,JSON.stringify(proposals[0]!.request),JSON.stringify(proposals[0]!.inputs),50],/scoped_call_invalid/);
      await denied(`INSERT INTO signal_labeling_calls(run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,budget_date,budget_timezone)
        SELECT a.target_id,a.workspace_id,'typesafe','jev-1.13.0','sync',gen_random_uuid()::text,$2,'{}',
          jsonb_build_array(jsonb_build_object('root_id',i.root_id,'input_digest',i.input_digest,'map_id',i.map_id)),600001,a.budget_date,a.budget_timezone
        FROM signal_mass_labeling_scoped_admissions a JOIN signal_mass_labeling_items i ON i.map_id=a.map_id WHERE a.target_id=$1 ORDER BY i.ordinal LIMIT 2`,
        [run.id,digest("atomic double reservation")],/cap_exhausted/);
      assert.equal((await query("SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1",[run.id])).rows[0]!.n,0,"an over-cap multi-row reservation rolls back every call and root link");
    }
    const calls = await store.reserve(run, proposals); assert.equal(calls.length, 3);
    await query("SET LOCAL enable_seqscan=off");
    const plan=(await query("EXPLAIN (FORMAT JSON) SELECT 1 FROM signal_mass_labeling_call_roots WHERE run_id=$1 AND root_id=$2",
      [run.id,inputs[0]!.root_id])).rows[0]!["QUERY PLAN"];
    assert.match(JSON.stringify(plan),/signal_mass_labeling_call_roots_pkey/);
    await query("SET LOCAL enable_seqscan=on");
    if(scopedMode){
      await query("SAVEPOINT revoked_before_send");await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[scopedPolicyId]);
      await assert.rejects(store.reserve(run,proposals),/extension_invalid/);
      await assert.rejects(store.markSubmitting(run,calls),/extension_invalid/);
      await denied("UPDATE signal_labeling_calls SET status='submitting' WHERE id=$1",[calls[0]!.id],/extension_invalid/);
      await query("ROLLBACK TO SAVEPOINT revoked_before_send");await query("RELEASE SAVEPOINT revoked_before_send");
    }
    await store.markSubmitting(run, calls);
    if(scopedMode){
      await denied("UPDATE signal_labeling_calls SET status='reserved' WHERE id=$1",[calls[0]!.id],/scoped_call_immutable/);
      await query("SAVEPOINT response_after_revocation");
      await query("UPDATE signal_labeling_calls SET status='unknown' WHERE id=$1",[calls[0]!.id]);
      await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[scopedPolicyId]);
      await denied("UPDATE signal_labeling_calls SET status='submitting' WHERE id=$1",[calls[0]!.id],/scoped_call_immutable/);
      assert.equal((await query("SELECT status FROM signal_labeling_calls WHERE id=$1",[calls[0]!.id])).rows[0]!.status,"unknown");
      await query("UPDATE signal_labeling_calls SET status='submitted' WHERE id=$1",[calls[0]!.id]);
      const usage=jevUsageV1({input_tokens:100,output_tokens:0});
      await store.persistRaw(run,calls[0]!,JSON.stringify({http_status:200,body:"synthetic paid raw"}));
      await store.settle(run,calls[0]!,{usage,settled_micro_usd:5});
      assert.equal((await query("SELECT status FROM signal_labeling_calls WHERE id=$1",[calls[0]!.id])).rows[0]!.status,"settled");
      assert.ok((await store.calls(run)).find(call=>call.id===calls[0]!.id)!.raw_body,"paid evidence remains readable after revocation");
      await query("ROLLBACK TO SAVEPOINT response_after_revocation");await query("RELEASE SAVEPOINT response_after_revocation");
    }
    for (const [index,call] of calls.entries()) {
      const payload = call.request as ReturnType<typeof buildMassLabelingJevRequestV1>;
      const answers = Object.fromEntries(Object.entries(payload.questions).map(([key, question]) => {
        if (question.type === "noul") return [key, {type: "noul", noul: key === "topic_0" ? [0.95, 0.7, 0.9][index] : key === "relevance" ? 0.95 : key === "promotion" && authorization === "scoped" && index === 2 ? .95 : 0.05}];
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
    if(scopedMode){
      const facetIdentity=facetLabelerIdentityV1(),facetDigest=labelerDigestV1(facetIdentity),foreignRun=randomUUID();
      await query(`INSERT INTO signal_labeler_versions(kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
        VALUES('facets',$1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(labeler_digest) DO NOTHING`,[facetIdentity.provider,facetIdentity.model,facetIdentity.prompt_digest,facetIdentity.schema_digest,facetDigest,JSON.stringify(facetIdentity)]);
      await query(`INSERT INTO signal_labeling_runs SELECT (jsonb_populate_record(NULL::signal_labeling_runs,to_jsonb(r)||jsonb_build_object('id',$2::uuid,'kind','facets',
        'labeler_version_id',(SELECT id FROM signal_labeler_versions WHERE labeler_digest=$3),'status','completed','idempotency_key',$4::text,'concept_set_digest',NULL,'cap_micro_usd',NULL))).*
        FROM signal_labeling_runs r WHERE id=$1`,[run.id,foreignRun,facetDigest,randomUUID()]);
      const spentBefore=await (await import("../signal-labeling-runs")).readSignalLabelingRunExposureV1(scoped,run.id);
      await denied("UPDATE signal_labeling_calls SET run_id=$2 WHERE id=$1",[calls[0]!.id,foreignRun],/scoped_call_immutable/);
      assert.equal(await (await import("../signal-labeling-runs")).readSignalLabelingRunExposureV1(scoped,run.id),spentBefore,"a paid call cannot leave its scoped owner or release its exposure");
      await denied("UPDATE signal_labeling_calls SET settled_micro_usd=0 WHERE id=$1",[calls[0]!.id],/scoped_call_immutable/);
      await denied("UPDATE signal_labeling_calls SET workspace_id=$2 WHERE id=$1",[calls[0]!.id,randomUUID()],/scoped_call_immutable/);
    }
    assert.equal(await store.finish(run), "completed");
    await store.release(run);
    if (authorization === "scoped" && sibling) {
      // A complete, FK-valid sibling item makes the old row-spread override observable.
      // These invented rows belong to this test's outer rollback transaction.
      const siblingMap = randomUUID();
      await query(`INSERT INTO signal_mass_labeling_maps SELECT (jsonb_populate_record(NULL::signal_mass_labeling_maps,
        to_jsonb(map)||jsonb_build_object('id',$2::uuid,'workspace_id',$3::uuid,
          'source_engine_execution_id',engine.id,'preparation_run_id',engine.preparation_run_id))).*
        FROM signal_mass_labeling_maps map CROSS JOIN LATERAL (
          SELECT id,preparation_run_id FROM signal_topic_catalog_executions WHERE workspace_id=$3::uuid
            AND preparation_run_id IS NOT NULL LIMIT 1) engine WHERE map.id=$1`,[map.map_id,siblingMap,sibling.workspace_id]);
      await query(`INSERT INTO signal_mass_labeling_topics(workspace_id,map_id,topic_key,definition_digest,centroid,group_ids)
        SELECT $3,$2,topic_key,definition_digest,centroid,group_ids FROM signal_mass_labeling_topics WHERE map_id=$1`,
        [map.map_id,siblingMap,sibling.workspace_id]);
      const siblingItem = (await query(`INSERT INTO signal_mass_labeling_items SELECT
        (jsonb_populate_record(NULL::signal_mass_labeling_items,to_jsonb(item)||jsonb_build_object(
          'workspace_id',$3::uuid,'map_id',$2::uuid,'root_id',mention.id))).*
        FROM signal_mass_labeling_items item CROSS JOIN LATERAL (
          SELECT id FROM mentions WHERE workspace_id=$3::uuid AND canonical_mention_id=id LIMIT 1) mention
        WHERE item.map_id=$1 AND item.ordinal=1 RETURNING *`,[map.map_id,siblingMap,sibling.workspace_id])).rows[0]!;
      assert.ok(siblingItem);
      await query(`INSERT INTO signal_mass_labeling_r13_interests(workspace_id,map_id,interest_key,name,definition,created_by_user_id)
        VALUES($1,$2,'sibling_interest','Sibling interest','Invented sibling interest',$3)`,
      [sibling.workspace_id,siblingMap,access.actor_user_id]);
      const snapshotR13 = async () => (await query(`SELECT
        (SELECT count(*)::int FROM signal_mass_labeling_r13_results WHERE workspace_id=$1) reviews,
        (SELECT count(*)::int FROM signal_mass_labeling_r13_interest_results WHERE workspace_id=$1) interest_results,
        (SELECT jsonb_agg(to_jsonb(i) ORDER BY interest_key) FROM signal_mass_labeling_r13_interests i WHERE workspace_id=$1) interests`,
      [sibling.workspace_id])).rows[0]!;
      const before = await snapshotR13();
      const answer = {type:"choice" as const,choice:"none" as const,confidence:.9,probabilities:{trigger:.05,barrier:.05,none:.9}};
      const first = calls[0]!.inputs[0]!;
      const receipt = {root_id:first.root_id,input_digest:first.input_digest,request_digest:digest("scope test request"),
        response_digest:digest("scope test response"),usage:{input_tokens:30,output_tokens:0}};
      const copied = JSON.parse(JSON.stringify({...receipt,...siblingItem,trigger_barrier:answer}));
      await assert.rejects(importMassLabelingR13V1({...access,map_id:map.map_id,results:[copied]}),/r13_scope_override/);
      for (const override of [{workspace_id:sibling.workspace_id},{map_id:siblingMap},{created_by_user_id:foreignActor},
        {actor_user_id:foreignActor},{interest_key:"sibling_interest"}]) {
        await assert.rejects(importMassLabelingR13V1({...access,map_id:map.map_id,
          results:[JSON.parse(JSON.stringify({...receipt,trigger_barrier:answer,...override}))]}),/r13_scope_override/);
        await assert.rejects(importMassLabelingR13V1({...access,map_id:map.map_id,interests:[{
          interest_key:"primary_interest",name:"Primary interest",definition:"Invented primary interest",
          results:[JSON.parse(JSON.stringify({...receipt,probability:.9,...override}))]}]}),/r13_scope_override/);
      }
      await assert.rejects(importMassLabelingR13V1({...access,map_id:map.map_id,interests:[{
        interest_key:"primary_interest",name:"Primary interest",definition:"Invented primary interest",
        results:[JSON.parse(JSON.stringify({...receipt,...siblingItem,probability:.9,interest_key:"sibling_interest"}))]}]}),/r13_scope_override/);
      assert.deepEqual(await snapshotR13(),before,"receipt JSON cannot write any sibling revision or interest");
      assert.equal((await query("SELECT count(*)::int n FROM signal_mass_labeling_r13_results WHERE workspace_id=$1",[access.workspace_id])).rows[0]!.n,0);
    }
    const booked = (await query("SELECT id,usage,settled_micro_usd,raw_sha256 FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id", [run.id])).rows;
    await assert.rejects(selectMassLabelingTopicsV1({...access, map_id: map.map_id, topic_keys: ["bicycle_repairs"], expected_revision: 0}), /mass_labeling_full_population_required/);
    const smoke = await measureMassLabelingSmokeV1({...access,run_id:run.id});
    assert.equal(smoke.metrics.technical_failure,false);
    assert.equal(smoke.metrics.intermediate_roots,1);
    if(scopedMode){
      await query("SAVEPOINT revoked_before_continuation");await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[scopedPolicyId]);
      await assert.rejects(continueMassLabelingV1({...access,run_id:run.id}),/extension_invalid/);
      await denied("UPDATE signal_mass_labeling_runs SET smoke_root_limit=NULL,continued_at=clock_timestamp() WHERE run_id=$1",[run.id],/extension_invalid/);
      await query("ROLLBACK TO SAVEPOINT revoked_before_continuation");await query("RELEASE SAVEPOINT revoked_before_continuation");
    }
    await continueMassLabelingV1({...access, run_id: run.id});
    assert.equal((await continueMassLabelingV1({...access, run_id: run.id})).replayed, true);
    const continuation = await store.claim(run.id); assert.ok(continuation);
    assert.equal((await store.inputs(continuation)).length, 0);
    assert.equal(await store.finish(continuation), "completed");
    await store.release(continuation);
    assert.deepEqual((await query("SELECT id,usage,settled_micro_usd,raw_sha256 FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id", [run.id])).rows, booked);
    await selectMassLabelingTopicsV1({...access, map_id: map.map_id, topic_keys: ["bicycle_repairs"], expected_revision: 0});
    await assertMassLabelingServingProjectionV1(scoped.query,access.workspace_id,map.map_id);
    const view = await loadSignalWorkspaceTopicsOverviewV1(access); assert.ok(view?.is_current);
    assert.equal(massPlanChecked,true,"the actual mass-labeling reader was planned and checked");
    assert.equal(view.denominator, 3);
    assert.equal(view.terms[0]!.mention_count, 2, "an exact 0.7 probability remains unclassified");
    if(authorization==="rotation"||authorization==="scoped"){
      await assert.rejects(loadSignalWorkspaceTopicsPageV1({...access,actor_user_id:foreignActor,defer_mass_inspection:true}),/workspace_topics_forbidden/);
      const fullStart=readQueries;
      const full=await loadSignalWorkspaceTopicsPageV1(access);
      const fullQueries=readQueries-fullStart,deferredStart=readQueries;
      const deferred=await loadSignalWorkspaceTopicsPageV1({...access,defer_mass_inspection:true});
      const deferredQueries=readQueries-deferredStart;
      assert.ok(full?.detail&&full.evidence);
      assert.equal(deferred?.detail,null);assert.equal(deferred?.evidence,null);
      assert.deepEqual({...deferred!.overview,observed_at:null},{...full!.overview,observed_at:null});
      assert.equal(deferredQueries,fullQueries-2,"the initial page skips exactly the detail and evidence queries");
    }
    const evidenceArgs = {...access, term_key: "bicycle_repairs", expected_scope_digest: view.scope_digest, limit: 1};
    const page1 = await loadSignalWorkspaceTopicEvidenceV1(evidenceArgs), page2 = await loadSignalWorkspaceTopicEvidenceV1({...evidenceArgs, cursor: page1.next_cursor});
    const sampled=[calls[0]!.inputs[0]!.root_id,calls[2]!.inputs[0]!.root_id].sort((a,b)=>
      createHash("md5").update(view.scope_digest+"bicycle_repairs"+a).digest("hex").localeCompare(
        createHash("md5").update(view.scope_digest+"bicycle_repairs"+b).digest("hex")));
    assert.equal(page1.items[0]!.mention_id,sampled[0]);
    assert.equal(page2.items[0]!.mention_id,sampled[1]);
    assert.deepEqual((await loadSignalWorkspaceTopicEvidenceV1(evidenceArgs)).items,page1.items,"sample order is reproducible");
    assert.equal(page2.next_cursor,null,"the sample cursor traverses every root once");
    assert.equal(page1.items[0]!.quote, null);
    assert.equal((await loadSignalWorkspaceTopicDetailV1(evidenceArgs)).mention_count, 2);
    if (authorization === "scoped") {
      const topic = mapArgs.catalog[0]!;
      const localization = {topic_key: topic.topic_key, original_language: "en",
        original: {name: topic.name, definition: topic.definition},
        en: {name: "Bicycle repairs", definition: "Personal accounts of repairing bicycles"},
        es: {name: "Reparación de bicicletas", definition: "Experiencias personales de reparación de bicicletas"}};
      const first = calls[0]!.inputs[0]!;
      const revision = {root_id: first.root_id, input_digest: first.input_digest,
        trigger_barrier: {type: "choice" as const, choice: "trigger" as const, confidence: .9,
          probabilities: {trigger: .9, barrier: .05, none: .05}},
        request_digest: digest("revision request"), response_digest: digest("revision response"),
        usage: {input_tokens: 80, output_tokens: 0}};
      const imported = await importMassLabelingR13V1({...access, map_id: map.map_id,
        translations: [localization], results: [revision]});
      assert.equal(imported.results, 1);
      await assert.rejects(importMassLabelingR13V1({...access,map_id:map.map_id,actor_user_id:foreignActor,
        results:[revision]}),/r13_forbidden/);
      await denied("UPDATE signal_mass_labeling_r13_results SET usage='{}' WHERE map_id=$1",[map.map_id],/r13_receipt_immutable/);
      assert.equal((await query("SELECT relrowsecurity yes FROM pg_class WHERE oid='signal_mass_labeling_r13_results'::regclass")).rows[0]!.yes,true);
      assert.equal((await query("SELECT has_table_privilege('anon','signal_mass_labeling_r13_results','SELECT') allowed")).rows[0]!.allowed,false);

      await importMassLabelingR13V1({...access, map_id: map.map_id, translations: [localization], results: [revision]});
      const revised = await loadSignalWorkspaceTopicsOverviewV1(access);
      assert.equal(revised!.terms[0]!.localization?.en.name, "Bicycle repairs");
      assert.deepEqual(revised!.consumer_indicators, {eligible: 2, category_matched: 2, category_excluded: 0, processed: 1, trigger: 1, barrier: 0, none: 0, intermediate: 0, unresolved: 1});
      assert.deepEqual(revised!.population_segments, {all: 3, conversation: 2, advertising: 1, hashtags: 0});
      const empty = await loadSignalWorkspaceTopicsOverviewV1({...access, conversation_segment: "advertising"});
      assert.equal(empty!.denominator, 1);
      const adPage = await loadSignalWorkspaceTopicEvidenceV1({...evidenceArgs, conversation_segment: "advertising",
        expected_scope_digest: empty!.scope_digest, cursor: undefined});
      assert.equal(adPage.items.length, 1);
      assert.equal(adPage.items[0]!.mention_id, calls[2]!.inputs[0]!.root_id);
      assert.equal((await loadSignalWorkspaceTopicDetailV1({...evidenceArgs, conversation_segment: "advertising",
        expected_scope_digest:empty!.scope_digest})).mention_count, 1);
      assert.notEqual(empty!.scope_digest, revised!.scope_digest);
      await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({...evidenceArgs, conversation_segment: "advertising",
        expected_scope_digest: revised!.scope_digest, cursor: page1.next_cursor}), /workspace_topics_scope_changed/);
      await assert.rejects(importMassLabelingR13V1({...access, map_id: map.map_id,
        results: [{...revision, input_digest: digest("wrong")}]}), /r13_input_changed/);
      await assert.rejects(importMassLabelingR13V1({...access, map_id: map.map_id,
        translations: [{...localization, original: {...localization.original, name: "Altered"}}]}), /r13_original_changed/);
      await assert.rejects(importMassLabelingR13V1({...access, map_id: map.map_id,
        results: [{...revision, request_digest: digest("different")}]}), /r13_receipt_conflict/);
      const interests = [{interest_key:"cycling_safety",name:"Cycling safety",definition:"Road safety and cycling precautions",
        results:calls.map((call,k) => ({...revision,root_id:call.inputs[0]!.root_id,input_digest:call.inputs[0]!.input_digest,
          probability:k===1?.95:.1}))}];
      await importMassLabelingR13V1({...access,map_id:map.map_id,interests});
      const enriched = await loadSignalWorkspaceTopicsOverviewV1(access);
      assert.equal(enriched!.terms.find(t=>t.term_key==="cycling_safety")!.basis,"defined_interest");
      assert.equal(enriched!.terms.find(t=>t.term_key==="cycling_safety")!.mention_count,1);
      const interestPage = await loadSignalWorkspaceTopicEvidenceV1({...access,term_key:"cycling_safety",
        expected_scope_digest:enriched!.scope_digest});
      assert.equal(interestPage.items.length,1);
      assert.equal(interestPage.items[0]!.mention_id,calls[1]!.inputs[0]!.root_id);
      assert.deepEqual((await query("SELECT signal_mass_labeling_r13_hashtags_v1($1) yes,signal_mass_labeling_r13_hashtags_v1($2) no", ["#cerveja #futebol!", "#cerveja 🍻"])).rows[0], {yes: true, no: false});
      const hashtagFixtures = [["#ação, #SãoPaulo",true],["#中文 #футбол",true],["#cerveja ordinary",false],["#cerveja\ufeff",true],["#cerveja\u0085",false],["#١",false],["#²",false]] as const;
      for (const [text,expected] of hashtagFixtures) assert.equal((await query("SELECT signal_mass_labeling_r13_hashtags_v1($1) yes",[text])).rows[0]!.yes,expected);
      await query("SAVEPOINT inherited_lexical_edit");
      const brand=(await query("SELECT brand_id FROM signal_workspaces WHERE id=$1",[access.workspace_id])).rows[0]!.brand_id;
      await query("UPDATE brands SET industry=$2,industry_sub=$3 WHERE id=$1",[brand,"\t\u00a0repair\ufeff","\u202fappointment\u3000"]);
      const inherited=await loadSignalWorkspaceTopicsOverviewV1(access);
      assert.equal(inherited!.is_current,true,"industry edits refresh the inherited lexical materialization");
      assert.notEqual(inherited!.scope_digest,enriched!.scope_digest);
      assert.ok((await query(`SELECT bool_and(cache.matched=signal_mass_labeling_category_matches_v1(mention.text_clean,defaults.lexicon_terms)) correct
        FROM signal_mass_labeling_category_matches cache JOIN mentions mention ON mention.workspace_id=cache.workspace_id AND mention.id=cache.root_id
        JOIN signal_mass_labeling_default_lexicons defaults ON defaults.workspace_id=cache.workspace_id
        WHERE cache.workspace_id=$1 AND cache.policy_revision=0`,[access.workspace_id])).rows[0]!.correct);
      await query("UPDATE signal_mass_labeling_default_lexicons SET lexicon_terms=ARRAY['outdated synthetic seed'] WHERE workspace_id=$1",[access.workspace_id]);
      assert.equal((await loadSignalWorkspaceTopicsOverviewV1(access))!.is_current,false,"a changed inherited seed set cannot be served as current");
      await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({...access,term_key:"bicycle_repairs"}),/workspace_topics_evidence_stale/);
      await query("ROLLBACK TO SAVEPOINT inherited_lexical_edit");await query("RELEASE SAVEPOINT inherited_lexical_edit");
      await assertMassLabelingStudyPolicyV1({...access,map_id:map.map_id,foreign_actor:foreignActor,root_id:first.root_id,input_digest:first.input_digest});

    }
    await correctMassLabelingTopicV1({...access, map_id: map.map_id, root_id: page1.items[0]!.mention_id,
      topic_key: "bicycle_repairs", belongs: false, decided_via: "human_ui"});
    await assertMassLabelingServingProjectionV1(scoped.query,access.workspace_id,map.map_id);
    if(authorization==="scoped")await assertMassLabelingProjectionBackfillV1(scoped.query,access.workspace_id,map.map_id);
    await query("SAVEPOINT missing_serving_projection");
    await query("DELETE FROM signal_mass_labeling_topic_probabilities WHERE map_id=$1 AND root_id=$2",[map.map_id,page1.items[0]!.mention_id]);
    await assert.rejects(loadSignalWorkspaceTopicsOverviewV1(access),/workspace_topics_materialization_incomplete/);
    await query("ROLLBACK TO SAVEPOINT missing_serving_projection");await query("RELEASE SAVEPOINT missing_serving_projection");
    const changed = await loadSignalWorkspaceTopicsOverviewV1(access); assert.equal(changed?.terms[0]!.mention_count, 1);
    if(authorization==="scoped")await assertMassLabelingOverviewProvenanceV1({...access,query:scoped.query});
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
    const editorial=exported.stage_receipts.editorial_calls;
    const terminal=editorial.find(row=>row.id===terminalCallId)!,successor=editorial.find(row=>row.id===successorCallId)!;
    assert.equal(editorial.length,4);assert.equal(terminal.call_state,"terminal_confirmed");assert.equal(terminal.response_http_status,null);
    assert.equal(terminal.response_complete,null);assert.equal(terminal.response_sha256,null);assert.equal(terminal.response_storage_key,null);assert.equal(terminal.response_size_bytes,null);
    assert.equal(terminal.metadata.provider_terminal_receipt.http_status,499);
    assert.equal(terminal.metadata.provider_terminal_receipt.reason,"client_disconnected");
    assert.equal(terminal.metadata.provider_terminal_billing_reconciliation.method,"audited_usage_pricing");
    assert.equal(terminal.settled_micro_usd,String(terminal.metadata.provider_terminal_billing_reconciliation.actual_micro_usd));
    assert.equal(successor.retry_of_call_id,terminal.id);assert.equal(successor.request_digest,terminal.request_digest);
    assert.deepEqual(successor.metadata.mass_labeling_stage,terminal.metadata.mass_labeling_stage);
    assert.equal(successor.call_state,"settled");assert.equal(successor.response_http_status,200);assert.equal(successor.response_complete,true);
    assert.ok(Number(successor.response_size_bytes)>0);assert.ok(successor.response_sha256);assert.ok(successor.response_storage_key);
    assert.equal(exported.stage_receipts.consolidation_artifact!.id,mapArgs.consolidation_artifact_id);
    assert.equal(exported.stage_receipts.consolidation_artifact!.metadata.call_id,successor.id);
    assert.equal(exported.stage_receipts.consolidation_artifact!.metadata.response_sha256,successor.response_sha256);
    assert.equal(exported.stage_receipts.consolidation_artifact!.content.sha256,exported.map.consolidation_digest);
    const ledgerSum=(await query("SELECT sum(settled_micro_usd)::text n FROM engine_cost_events WHERE catalog_execution_id=$1",[seed.source_engine_execution_id])).rows[0]!.n;
    assert.equal(editorial.reduce((total,row)=>total+BigInt(row.settled_micro_usd??0),0n).toString(),ledgerSum,"each distinct receipt is counted once");
    assert.deepEqual((await query("SELECT row_to_json(call) body FROM engine_cost_events call WHERE id=$1",[terminalCallId])).rows[0]!.body,terminalBefore,"successor, adoption, export preserve the terminal parent byte for byte");
    await assert.rejects(exportMassLabelingSnapshotV1({...access, actor_user_id: foreignActor, map_id: map.map_id}), /mass_labeling_forbidden/);
    const privileges = (await query(`SELECT has_table_privilege('anon','signal_mass_labeling_results','SELECT') anon,
      has_table_privilege('authenticated','signal_mass_labeling_results','SELECT') authenticated`)).rows[0];
    assert.deepEqual(privileges, {anon: false, authenticated: false});
    await query("SAVEPOINT immutable");
    await assert.rejects(query("UPDATE signal_mass_labeling_results SET probabilities='{}' WHERE map_id=$1", [map.map_id]), /mass_labeling_history_is_immutable/);
    await query("ROLLBACK TO SAVEPOINT immutable");
    if(scopedMode){
      // Rollback-only simulation of an externally replaced, short-lived base.
      await query("SAVEPOINT expired_scoped_base");
      const shortBase=(await query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
        SELECT organization_id,(SELECT max(version)+1 FROM signal_processing_policy_versions WHERE organization_id=p.organization_id),'draft',clock_timestamp(),clock_timestamp()+interval '1 second',budget_timezone,daily_cap_micro_usd,created_by_user_id
        FROM signal_processing_policy_versions p WHERE p.id=$1 RETURNING id`,[scopedPolicyId])).rows[0]!.id;
      await query(`INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
        FROM signal_processing_policy_actions WHERE policy_version_id=$1`,[scopedPolicyId,shortBase]);
      await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[scopedPolicyId]);
      await query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[shortBase]);
      const api=await import("../signal-mass-labeling-scoped-policy"),grant=await api.provisionMassLabelingScopedPolicyV1({...access,map_id:map.map_id,cap_micro_usd:1_000_000});
      await query("SELECT pg_sleep(1.05)");
      await denied("SELECT signal_mass_labeling_extension_base_v1($1)",[grant.extension_id],/extension_invalid/);
      await assert.rejects(requestMassLabelingV1({...request,idempotency_key:randomUUID()}),/extension_invalid/);
      await query("ROLLBACK TO SAVEPOINT expired_scoped_base");await query("RELEASE SAVEPOINT expired_scoped_base");
    }
    if(siblingFixture&&sibling)assert.deepEqual(await siblingFixture.snapshotMassLabelingSiblingAuthorityV1({query,...sibling}),siblingBefore,
      "scoped authority, smoke and continuation preserve every sibling row and base action");
    await query("UPDATE users SET status='suspended' WHERE id=$1", [access.actor_user_id]);
    await assert.rejects(loadSignalWorkspaceTopicsOverviewV1(access), /workspace_topics_forbidden/);
  } finally {
    await raw.query("ROLLBACK").catch(() => undefined); raw.release(); await pool.end();
    if (flag === undefined) delete process.env.NOISIA_MASS_LABELING_ENABLED; else process.env.NOISIA_MASS_LABELING_ENABLED = flag;
  }
});
