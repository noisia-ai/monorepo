import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import test from "node:test";
import type {Pool} from "pg";
import {buildMassLabelingJevRequestV1, mapMassLabelingJevResponseV1, massLabelingJevIdentityV1,
  signalWorkspaceEmbeddingDigestV1 as digest, llmPriceV1, llmCostMicroUsdV1} from "@noisia/query-engine";
import {seedComposedFixture,quoteComposedFixture,startComposedFixture,semanticConfiguration} from "./signal-brand-context-composed.fixture";
import {seedSignalTopicEditorialRenewalSourceV1,createSignalTopicEditorialRenewalSyntheticSavesV1,snapshotSignalTopicEditorialRenewalSyntheticHistoryV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import {createMassLabelingMapV1, createMassLabelingStoreV1, requestMassLabelingV1,
  continueMassLabelingV1, provisionMassLabelingPolicyV1, selectMassLabelingTopicsV1,
  correctMassLabelingTopicV1, exportMassLabelingSnapshotV1, measureMassLabelingSmokeV1} from "../signal-mass-labeling";
import {loadSignalWorkspaceTopicsOverviewV1, loadSignalWorkspaceTopicEvidenceV1,
  loadSignalWorkspaceTopicDetailV1} from "../signal-workspace-topics-serving";
import * as editorialMoney from "../signal-workspace-engine-interpretation";
import {SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as globalConfiguration,buildMassLabelingConsolidationRequestV1} from "@noisia/query-engine";
import {verifyMassLabelingSourceCheckpointsV1,type MassLabelingSourceCheckpointV1} from "../signal-mass-labeling-source";
import {persistSignalWorkspaceEngineArtifactV1,failSignalWorkspaceEngineV1,retrySignalWorkspaceEngineV1,claimSignalWorkspaceEngineV1} from "../signal-workspace-engine";
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
    let consolidationArtifactId="",consolidationRaw="",terminalCallId="",successorCallId="";
    let terminalBefore:unknown;
    let sourceCheckpoints:MassLabelingSourceCheckpointV1[]=[];
    const syntheticSaves=createSignalTopicEditorialRenewalSyntheticSavesV1(undefined,{brand_name:"Synthetic fixture"});
    const seed = await seedSignalTopicEditorialRenewalSourceV1({database, scoped, query, cleanup: async () => {},
      saves:syntheticSaves,
      numeric_daily_cap_micro_usd: 10_000_000, projection: {split_guided_groups:true,interpretation_configuration:globalConfiguration,engine_config: {profile_version: "workspace-bertopic-mass-labeling-v1", fixture: true},
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
          const output={topics:[{topic_key:"bicycle_repairs",name:"Bicycle repairs",definition:"Experiences repairing bicycles.",group_ids}],excluded_groups:[]};
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
      catalog: [{topic_key: "bicycle_repairs", name: "Bicycle repairs", definition: "Experiences repairing bicycles.", group_ids:groupIds}]};
    await assert.rejects(createMassLabelingMapV1({...mapArgs, actor_user_id: foreignActor}), /mass_labeling_forbidden/);
    await assert.rejects(createMassLabelingMapV1({...mapArgs, assignments_raw: assignmentsRaw+" "}), /mass_labeling_source_invalid/);
    await assert.rejects(createMassLabelingMapV1({...mapArgs,source_checkpoints:[]}),/mass_labeling_source_checkpoint_invalid/);
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
    await query("SAVEPOINT missing_mass_owner");
    await query("SELECT admit_signal_processing_v1($1,$2,'mass_labeling_jev',$3,$4,$5,1000000,false)",
      [access.workspace_id,access.actor_user_id,randomUUID(),randomUUID(),digest({missing_owner:true})]);
    await assert.rejects(query("SET CONSTRAINTS ALL IMMEDIATE"),/mass_labeling_admission_owner_required/);
    await query("ROLLBACK TO SAVEPOINT missing_mass_owner");await query("RELEASE SAVEPOINT missing_mass_owner");
    const admitted = await requestMassLabelingV1(request);
    await query("SET CONSTRAINTS ALL IMMEDIATE");await query("SET CONSTRAINTS ALL DEFERRED");
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
    await query("UPDATE users SET status='suspended' WHERE id=$1", [access.actor_user_id]);
    await assert.rejects(loadSignalWorkspaceTopicsOverviewV1(access), /workspace_topics_forbidden/);
  } finally {
    await raw.query("ROLLBACK").catch(() => undefined); raw.release(); await pool.end();
    if (flag === undefined) delete process.env.NOISIA_MASS_LABELING_ENABLED; else process.env.NOISIA_MASS_LABELING_ENABLED = flag;
  }
});
