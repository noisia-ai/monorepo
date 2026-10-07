import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  signalQualityPolicyDefinitionHashV1,
  signalRetentionPolicyDefinitionHashV1,
  signalProvenancePolicyBindingDefinitionHashV1,
} from "@noisia/query-engine";
import { selectMembershipInputsV1 } from "../signal-concept-memberships";
import { assertHybridProviderRightsBeforeSubmitV1, selectHybridClaudeInputsV1 } from "../signal-hybrid-runs";
import { writeHybridMembershipDecisionPageV1, type HybridDecisionInputV1 } from "../signal-hybrid-membership";
import type { LabelingRunV1 } from "../signal-labeling-runs";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

test("settled JEV positive is not reselected after restart; Claude alone inherits it", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 120_000,
}, async () => {
  const database = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" });
  const client = await database.connect();
  try {
    assert.equal((await client.query("SELECT current_database() name")).rows[0].name, "noisia_mfp_ci");
    await client.query("BEGIN");
    const fixture = await createProcessingPolicyIdentitiesV1({ database, scoped: client });
    const { workspace_id: workspace, organization_id: organization, brand_id: brand } = fixture.first;
    const actor = fixture.actors.internal;
    const source = randomUUID(), batch = randomUUID(), root = randomUUID();
    const quality = randomUUID(), retention = randomUUID(), license = randomUUID();
    const digest = sha("fixture-digest"), text = "Synthetic discussion about bicycle brakes";
    await client.query(`INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,
      connection_method,name,status,source_contract_version,source_key)
      VALUES($1,$2,$3,$4,'social-listening','fixture','csv','H1 selector','active',
      'signal-data-source-connector-v1',$5)`, [source, workspace, organization, brand,
      `source-sha256-${createHash("sha256").update(source).digest("hex")}`]);
    await client.query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,source_file_name,status)
      VALUES($1,$2,$3,'fixture','h1-selector.csv','completed')`, [batch, workspace, source]);
    await client.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,
      external_id,source_system,text_hash,text_clean,text_length,published_at,platform,inclusion_status)
      VALUES($1::uuid,$2,$3,$1::uuid,'h1-selector',$1::uuid::text,'fixture',$4,$5,$6,now(),'web','included')`,
      [root, workspace, source, sha(text), text, text.length]);
    await client.query(`INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id)
      VALUES($1,$2,$3,$4)`, [workspace, root, batch, source]);
    const qualityHash = signalQualityPolicyDefinitionHashV1({ workspace_id: workspace,
      policy_key: "h1-quality", policy_version: 1, min_quality_score: null,
      required_quality_flags: [], forbidden_quality_flags: [], canonical_root_disposition: "evaluate" });
    const retentionHash = signalRetentionPolicyDefinitionHashV1({ workspace_id: workspace,
      policy_key: "h1-retention", policy_version: 1, retention_state: "allowed",
      retention_mode: "indefinite", retain_until: null, expiry_action: "block_use",
      approval_evidence_hash: sha("retention approval") });
    const bindingHash = signalProvenancePolicyBindingDefinitionHashV1({ workspace_id: workspace,
      data_source_id: source, import_batch_id: null, binding_version: 1,
      quality_policy_id: quality, retention_policy_id: retention, licensing_policy_id: license });
    await client.query(`INSERT INTO signal_quality_policies(id,organization_id,workspace_id,policy_key,policy_version,
      status,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
      VALUES($1,$2,$3,'h1-quality',1,'active',$4,$5,$5,now(),$4)`, [quality, organization, workspace, qualityHash, actor]);
    await client.query(`INSERT INTO signal_retention_policies(id,organization_id,workspace_id,policy_key,
      policy_version,status,retention_state,retention_mode,expiry_action,approval_evidence_hash,
      definition_hash,created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
      VALUES($1,$2,$3,'h1-retention',1,'active','allowed','indefinite','block_use',$4,$5,$6,$6,now(),$5)`,
      [retention, organization, workspace, sha("retention approval"), retentionHash, actor]);
    await client.query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,
      policy_version,status,approval_evidence_hash,definition_hash,created_by_user_id,
      approved_by_user_id,approved_at,creation_idempotency_key)
      VALUES($1,$2,$3,'h1-license',1,'draft',$4,$5,$6,NULL,NULL,$5)`,
      [license, organization, workspace, sha("license approval"), sha("license"), actor]);
    await client.query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
      VALUES($1,$2,'client-derived-metrics','allowed'),($1,$2,'client-mention-list','allowed'),
      ($1,$2,'client-text-or-excerpt','allowed'),($1,$2,'llm-processing','allowed')`, [workspace, license]);
    await client.query(`UPDATE signal_licensing_policies SET
      definition_hash=signal_licensing_policy_definition_hash(id) WHERE id=$1`, [license]);
    await client.query(`UPDATE signal_licensing_policies SET status='active',
      approved_by_user_id=$2, approved_at=now() WHERE id=$1`, [license, actor]);
    await client.query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,binding_version,
      status,quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,
      activated_by_user_id,activated_at,creation_idempotency_key)
      VALUES($1,$2,1,'active',$3,$4,$5,$6,$7,$7,now(),$6)`,
      [workspace, source, quality, retention, license, bindingHash, actor]);
    assert.deepEqual((await client.query(`SELECT metrics,evidence FROM signal_membership_evidence_rights_v1
      WHERE workspace_id=$1 AND root_id=$2`, [workspace, root])).rows[0], { metrics: true, evidence: true });

    const prep = randomUUID(), asset = sha(text);
    const revision = (await client.query<{ input_revision: string }>(
      "SELECT input_revision::text FROM signal_corpus_preparation_input_state WHERE workspace_id=$1", [workspace])).rows[0]!.input_revision;
    await client.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,status,phase,
      input_revision,completed_at,worker_job_id) VALUES($1,$2,$3,'completed','complete',$4,now(),$5)`,
      [prep, workspace, actor, revision, `h1-selector-${prep}`]);
    await client.query(`INSERT INTO signal_corpus_text_assets(workspace_id,text_sha256,chunk_policy_version,full_text)
      VALUES($1,$2,'corpus-text-chunks-v1',$3)`, [workspace, asset, text]);
    await client.query(`INSERT INTO signal_corpus_preparation_items(workspace_id,run_id,root_id,asset_sha256,
      disposition,root_metadata,provenance,fingerprint) VALUES($1,$2,$3,$4,'eligible','{}','[]',$5)`,
      [workspace, prep, root, asset, digest]);
    const entity = { kind: "primary_brand", entity_id: brand, label: "Synthetic brand" };
    const context = sha("entity-context");
    await client.query(`INSERT INTO signal_entity_context_versions(workspace_id,version_no,digest,context,
      diff,affected_mode,affected_count) VALUES($1,1,$2,$3::jsonb,'{}','targeted',0)`,
      [workspace, context, JSON.stringify({ entities: [entity] })]);
    const facetVersion = randomUUID(), facetRun = randomUUID(), facetCall = randomUUID();
    await client.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,
      labeler_digest,identity) VALUES($1,'facets','typesafe','jev-1.13.0',$2,$2,$3,'{}')`,
      [facetVersion, digest, sha("facet-labeler")]);
    await client.query(`INSERT INTO signal_workspace_labelers(workspace_id,kind,labeler_version_id)
      VALUES($1,'facets',$2)`, [workspace, facetVersion]);
    const pendingFacet = (await client.query<{ input_digest: string }>(`SELECT input_digest FROM signal_mention_facets_current_v1
      WHERE workspace_id=$1 AND root_id=$2`, [workspace, root])).rows[0];
    assert.ok(pendingFacet, "the real prepared facet view exposes the root");
    await client.query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,
      preparation_run_id,entity_context_digest,entity_context_version_no,status,estimated_micro_usd,
      idempotency_key,request_digest,actor_user_id)
      VALUES($1,$2,'facets',$3,$4,$5,1,'completed',0,$6,$7,$8)`,
      [facetRun, workspace, facetVersion, prep, context, `facet-${facetRun}`, digest, actor]);
    await client.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,
      custom_id,request_digest,request,inputs,status,reserved_micro_usd,settled_micro_usd,
      raw_sha256,raw_storage_key,raw_size_bytes,results_applied,budget_date,budget_timezone)
      VALUES($1,$2,$3,'typesafe','jev-1.13.0','sync',$4,$5,'{}','[]','settled',1,1,$7,
      $6,2,true,current_date,'UTC')`, [facetCall, facetRun, workspace, `facet-${facetCall}`, digest, `private/${facetCall}`, sha("[]")]);
    const facets = { entities: { value: [entity], abstained: false },
      spam_or_bot: { value: false, abstained: false }, voice: { value: "unknown", abstained: false },
      act: { value: "other", abstained: false } };
    await client.query(`INSERT INTO signal_mention_facet_labels(workspace_id,root_id,input_digest,
      labeler_digest,entity_context_digest,facet_schema_version,status,facets,relevance,
      effective_entities_digest,call_id) VALUES($1,$2,$3,$4,$5,'mention-facets-v1','labeled',
      $6::jsonb,'relevant',signal_labeling_digest_v1($7::jsonb),$8)`,
      [workspace, root, pendingFacet.input_digest, sha("facet-labeler"), context,
        JSON.stringify(facets), JSON.stringify([entity]), facetCall]);
    const currentFacet = (await client.query<{ relevance: string; status: string }>(`SELECT relevance,status
      FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2`, [workspace, root])).rows[0];
    assert.equal(currentFacet?.relevance, "relevant");
    assert.equal(currentFacet.status, "labeled");

    const taxonomy = randomUUID(), rules = randomUUID(), model = randomUUID();
    await client.query("INSERT INTO taxonomies(id,taxonomy_key,name,scope) VALUES($1,$2,'H1 synthetic','workspace')",
      [taxonomy, `h1-${taxonomy}`]);
    await client.query(`INSERT INTO tagging_rule_sets(id,rule_set_key,taxonomy_id,rules)
      VALUES($1,$2,$3,'{}')`, [rules, `h1-${rules}`, taxonomy]);
    await client.query(`INSERT INTO tagging_model_versions(id,model_key,version,tagging_rule_set_id)
      VALUES($1,$2,'v1',$3)`, [model, `h1-${model}`, rules]);
    await client.query(`INSERT INTO signal_taxonomy_profiles(workspace_id,taxonomy_id,kind,version,status,
      context_hash,rule_set_id,model_version_id,metadata)
      VALUES($1,$2,'topic',1,'draft',$3,$4,$5,$6::jsonb)`,
      [workspace, taxonomy, digest, rules, model, JSON.stringify({ contract_version: "signal-topic-catalog-v1", catalog_role: "working" })]);
    const concept = { concept_key: "bicycle_brakes", label: "Bicycle brakes", scope: "all_conversations",
      definition: "Mentions of bicycle brakes", inclusion: [], exclusion: [], positive_examples: [],
      negative_examples: [], definition_digest: sha("bicycle definition") };
    await client.query(`INSERT INTO taxonomy_terms(taxonomy_id,term_key,label,metadata)
      VALUES($1,$2,$3,$4::jsonb)`, [taxonomy, concept.concept_key, concept.label,
      JSON.stringify({ topic: { ...concept, origin: "manual", lifecycle: "active" } })]);
    const route = sha("hybrid-route"), jevVersion = randomUUID();
    await client.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,
      schema_digest,labeler_digest,identity) VALUES($1,'membership','typesafe','jev-1.13.0',
      $2,$2,$3,'{}')`, [jevVersion, digest, sha("jev-stage")]);
    await client.query(`INSERT INTO signal_hybrid_membership_routes(workspace_id,route,route_digest,
      jev_labeler_digest,claude_labeler_digest,jev_facets_labeler_version_id,configured_by_user_id)
      VALUES($1,'hybrid_h1',$2,$3,$4,$5,$6)`, [workspace, route, sha("jev-judge"), sha("claude-confirm"), facetVersion, actor]);
    const work = (id: string) => ({ id, workspace_id: workspace, cursor_root_id: null, labeler_digest: route,
      membership_snapshot: { concepts: [concept], preview: false, sample_root_ids: null,
        hybrid_stage: "jev", route_digest: route } }) as unknown as LabelingRunV1;
    const first = await selectMembershipInputsV1(client, work(randomUUID()), true);
    assert.equal(first.length, 1, "the real JEV selector initially finds the pair");
    assert.equal(first[0]!.evaluated_concepts[0]!.concept_key, concept.concept_key);

    const policy = randomUUID();
    await client.query(`INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by)
      VALUES($1,'mention_facets',$2),($1,'concept_membership',$2)`, [workspace, actor]);
    await client.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,
      valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      VALUES($1,$2,1,'draft',now()-interval '1 minute','infinity','UTC',1100000,$3)`, [policy, organization, actor]);
    for (const [action, provider, modelName] of [
      ["concept_membership_jev", "typesafe", "jev-1.13.0"],
      ["concept_membership_claude", "anthropic", "claude-sonnet-5-5"],
    ]) {
      const config = JSON.stringify({ provider, model: modelName });
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,
        provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        VALUES($1,$2,'provider',$3,$4,$5::jsonb,signal_semantic_context_digest_json_v2($5::jsonb),NULL,false)`,
      [policy, action, provider, modelName, config]);
    }
    await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policy]);
    const admit = async (action: string, target: string) => {
      const receipt = (await client.query<{result:{receipt:{id:string}}}>(`SELECT admit_signal_processing_v1(
        $1::uuid,$2::uuid,$3,$4::uuid,$5,$6,NULL,false) result`,
      [workspace, actor, action, target, randomUUID(), digest])).rows[0]!.result.receipt;
      return receipt.id;
    };

    const jevRun = randomUUID(), jevCall = randomUUID();
    const jevAdmission = await admit("concept_membership_jev", jevRun);
    await client.query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,
      preparation_run_id,entity_context_digest,entity_context_version_no,status,estimated_micro_usd,
      idempotency_key,request_digest,actor_user_id,membership_snapshot,processing_admission_id)
      VALUES($1,$2,'membership',$3,$4,$5,1,'completed',1,$6,$7,$8,$9::jsonb,$10)`,
      [jevRun, workspace, jevVersion, prep, context, `jev-${jevRun}`, digest, actor,
        JSON.stringify({ hybrid_stage: "jev", route_digest: route, concepts: [concept], preview: false }),
        jevAdmission]);
    const input = first[0]!;
    const result: Omit<HybridDecisionInputV1,"text"> = { root_id: root, root_fingerprint: input.root_fingerprint,
      concept_key: concept.concept_key, definition_digest: concept.definition_digest,
      entity_context_digest: input.entity_context_digest,
      effective_entities_digest: input.effective_entities_digest,
      jev: { verdict: "belongs", probability: 0.8, citation: { quote: text, start: 0, end: text.length } },
      jev_call_id: jevCall, claude: null, claude_call_id: null, rationale: null };
    const rawJev = JSON.stringify([result]);
    await client.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,
      transport,custom_id,request_digest,request,inputs,status,reserved_micro_usd,
      settled_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,results_applied,results,budget_date,budget_timezone)
      VALUES($1,$2,$3,'typesafe','jev-1.13.0','sync',$4,$5,'{}',$6::jsonb,
      'settled',2,2,$9,$7,$10,true,$8::jsonb,current_date,'UTC')`,
      [jevCall, jevRun, workspace, `jev-${jevCall}`, digest, JSON.stringify([input]),
        `private/${jevCall}`, rawJev, sha(rawJev), Buffer.byteLength(rawJev)]);
    const beforeSubmit = () => assertHybridProviderRightsBeforeSubmitV1(client,
      { id: jevRun, workspace_id: workspace } as LabelingRunV1, [{ id: jevCall }]);
    await beforeSubmit();
    await client.query("SAVEPOINT rights_revoked");
    await client.query("UPDATE data_sources SET status='inactive' WHERE id=$1", [source]);
    await assert.rejects(beforeSubmit(), /hybrid_provider_rights_changed/u,
      "a persisted call cannot be submitted after source rights disappear");
    await client.query("ROLLBACK TO SAVEPOINT rights_revoked");
    await beforeSubmit();
    const current = (await client.query<{ verdict: string }>(`SELECT verdict FROM signal_concept_memberships_current_v1
      WHERE workspace_id=$1 AND root_id=$2 AND concept_key=$3`, [workspace, root, concept.concept_key])).rows[0];
    assert.equal(current?.verdict, "pending", "Claude has not confirmed this JEV positive");
    assert.deepEqual(await selectMembershipInputsV1(client, work(jevRun), true), [],
      "an interrupted JEV run cannot reserve the settled pair again");
    assert.deepEqual(await selectMembershipInputsV1(client, work(randomUUID()), true), [],
      "a new JEV run with the same route cannot charge the pair again");
    const claude = await selectHybridClaudeInputsV1(client, { ...work(randomUUID()),
      membership_snapshot: { concepts: [concept], hybrid_stage: "claude", route_digest: route, jev_run_id: jevRun } } as unknown as LabelingRunV1);
    assert.equal(claude.length, 1, "Claude alone inherits the positive pair");
    assert.equal(claude[0]!.jev_by_concept?.[concept.concept_key]?.call_id, jevCall);
    assert.deepEqual(await selectHybridClaudeInputsV1(client, { ...work(randomUUID()),
      membership_snapshot: { concepts: [concept], hybrid_stage: "claude", route_digest: route, jev_run_id: jevRun } } as unknown as LabelingRunV1), claude,
    "a restarted Claude read retains the same JEV receipt without a new JEV call");

    const claudeVersion = randomUUID(), claudeRun = randomUUID(), claudeCall = randomUUID();
    await client.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,
      schema_digest,labeler_digest,identity) VALUES($1,'membership','anthropic','claude-sonnet-5-5',
      $2,$2,$3,'{}')`, [claudeVersion, digest, sha("claude-stage")]);
    const claudeAdmission = await admit("concept_membership_claude", claudeRun);
    await client.query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,
      preparation_run_id,entity_context_digest,entity_context_version_no,status,estimated_micro_usd,
      idempotency_key,request_digest,actor_user_id,membership_snapshot,processing_admission_id)
      VALUES($1,$2,'membership',$3,$4,$5,1,'completed',1,$6,$7,$8,$9::jsonb,$10)`,
      [claudeRun, workspace, claudeVersion, prep, context, `claude-${claudeRun}`, digest, actor,
        JSON.stringify({ hybrid_stage: "claude", route_digest: route, jev_run_id: jevRun,
          concepts: [concept], preview: false }), claudeAdmission]);
    const excerpt = "bicycle brakes", start = text.indexOf(excerpt);
    const claudeDecision = { verdict: "not_belongs", citation: { quote: excerpt, start, end: start + excerpt.length } } as const;
    const confirmed = { ...result, claude: claudeDecision, claude_call_id: claudeCall };
    const insertCall = async (args: { id: string; run: string; provider: string; model: string;
      inputs: unknown[]; result: unknown }) => {
      const raw = JSON.stringify([args.result]);
      await client.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,
        transport,custom_id,request_digest,request,inputs,status,reserved_micro_usd,
        settled_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,results_applied,results,
        budget_date,budget_timezone)
        VALUES($1,$2,$3,$4,$5,'sync',$6,$7,'{}',$8::jsonb,'settled',2,2,$9,$10,$11,
        true,$12::jsonb,current_date,'UTC')`,
      [args.id, args.run, workspace, args.provider, args.model, `h1-${args.id}`, digest,
        JSON.stringify(args.inputs), sha(raw), `private/${args.id}`, Buffer.byteLength(raw), raw]);
    };
    await insertCall({ id: claudeCall, run: claudeRun, provider: "anthropic", model: "claude-sonnet-5-5",
      inputs: claude, result: confirmed });
    const wrongJev = randomUUID(), wrongClaude = randomUUID();
    await insertCall({ id: wrongJev, run: jevRun, provider: "typesafe", model: "jev-1.13.0", inputs: [input],
      result: { ...result, concept_key: "wrong_concept", jev_call_id: wrongJev } });
    await insertCall({ id: wrongClaude, run: claudeRun, provider: "anthropic", model: "claude-sonnet-5-5",
      inputs: claude, result: { ...confirmed, concept_key: "wrong_concept", claude_call_id: wrongClaude } });
    const decision = { ...confirmed, text };
    const write = (candidate: typeof decision) => writeHybridMembershipDecisionPageV1({
      client, workspace_id: workspace, route_digest: route, decisions: [candidate],
    });
    await assert.rejects(write({ ...decision, jev_call_id: wrongJev }), /hybrid_settled_receipt_required/u,
      "a settled JEV call for another pair cannot support this decision");
    await assert.rejects(write({ ...decision, claude_call_id: wrongClaude }), /hybrid_settled_receipt_required/u,
      "a settled Claude call for another pair cannot support this decision");
    assert.equal((await write(decision)).persisted, 1);
    assert.deepEqual((await client.query<{ verdict: string; source: string }>(`
      SELECT verdict,source FROM signal_concept_memberships_current_v1
      WHERE workspace_id=$1 AND root_id=$2 AND concept_key=$3`,
      [workspace, root, concept.concept_key])).rows[0], { verdict: "review_required", source: "model" });
    await client.query(`INSERT INTO signal_concept_membership_overrides(workspace_id,root_id,concept_key,
      definition_digest,root_fingerprint,verdict,actor_user_id)
      VALUES($1,$2,$3,$4,$5,'belongs',$6)`,
      [workspace, root, concept.concept_key, concept.definition_digest, input.root_fingerprint, actor]);
    assert.deepEqual((await client.query<{ verdict: string; source: string }>(`
      SELECT verdict,source FROM signal_concept_memberships_current_v1
      WHERE workspace_id=$1 AND root_id=$2 AND concept_key=$3`,
      [workspace, root, concept.concept_key])).rows[0], { verdict: "belongs", source: "human" });
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await database.end();
  }
});
