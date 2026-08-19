import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  ensureSignalBrandPolicyDraftV1,
  reconcileSignalBrandPolicyCandidateV1,
  resolveSignalBrandPolicyDraftGovernanceV1
} from "./signal-governed-brand-policy";
import {
  loadSignalGovernedBrandBindingSetPreflightV1,
  promoteSignalGovernedBrandBindingSetV1,
  withdrawSignalGovernedBrandBindingSetToBridgeV1
} from "./signal-governed-brand-bindings";
import {
  ensureSignalGovernedViewPolicyDraftV1,
  reconcileSignalGovernedViewPolicyCandidateV1,
  resolveSignalGovernedViewPolicyDraftGovernanceV1
} from "./signal-governed-view-policy";
import {
  loadSignalGovernedViewBindingSetPreflightV1,
  promoteSignalGovernedViewBindingSetV1,
  withdrawSignalGovernedViewBindingSetV1
} from "./signal-governed-view-bindings";
import {
  activateSignalDataGovernanceObjectV1,
  ensureSignalLicensingPolicyDraftV1,
  ensureSignalProvenancePolicyBindingDraftV1,
  ensureSignalQualityPolicyDraftV1,
  ensureSignalRetentionPolicyDraftV1,
  loadSignalDataGovernancePreflightV1
} from "./signal-data-governance";
import {
  runSignalBrandDraftShadowV1,
  runSignalGovernedBrandBindingShadowV1
} from "./signal-governed-brand-shadow";
import { runSignalGovernedViewBindingShadowV1 } from "./signal-governed-view-shadow";
import {
  executeSignalGovernanceControlCommandV1,
  type SignalGovernanceControlCommandV1
} from "./signal-governance-control-plane";
import {
  loadSignalGovernedViewsProductPreflightV1,
  reconcileSignalGovernedViewProductV1,
  transitionSignalGovernedViewProductV1
} from "./signal-governed-view-orchestrator";
import {
  createPostgresSignalGovernedViewResolverStore,
  resolveSignalGovernedViewV1
} from "./signal-governed-view-resolver";
import {
  loadSignalStrategicProductStatusV1,
  reconcileSignalStrategicProductAuthorityV1
} from "./signal-strategic-product";
import { preflightSignalTbStrategicRun } from "./signal-strategic-consumption";
import { createWorkspaceDataSourceProductV1 } from "./workspace-ingestion";
import type { SignalOperationalReadScopeV1 } from "./signal-operational-read-scope";
import { loadSignalClientEvidenceAccessV1 } from "./signal-workspace-serving";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "./signal-workspace";

const DATABASE_URL = process.env.NOISIA_SIGNAL_GOVERNED_BRAND_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_GOVERNED_BRAND_INTEGRATION_APPROVED === "true";
const migrationDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../infrastructure/db/migrations"
);

after(async () => {
  const studioPool = (globalThis as { noisiaStudioPgPool?: pg.Pool }).noisiaStudioPgPool;
  if (studioPool) await studioPool.end();
});

const IDS = {
  organization: "69000000-0000-4000-8000-000000000001",
  otherOrganization: "69000000-0000-4000-8000-000000000002",
  actor: "69000000-0000-4000-8000-000000000101",
  brand: "69000000-0000-4000-8000-000000000201",
  otherBrand: "69000000-0000-4000-8000-000000000202",
  methodology: "69000000-0000-4000-8000-000000000301",
  strategicMethodology: "69000000-0000-4000-8000-000000000302",
  corpus: "69000000-0000-4000-8000-000000000401",
  competitorSeed: "69000000-0000-4000-8000-000000000501",
  competitor: "69000000-0000-4000-8000-000000000502",
  sourcePrimary: "69000000-0000-4000-8000-000000000601",
  sourceCompetitor: "69000000-0000-4000-8000-000000000602",
  sourceBlocked: "69000000-0000-4000-8000-000000000603",
  sourceAllowed: "69000000-0000-4000-8000-000000000604",
  sourceExpired: "69000000-0000-4000-8000-000000000605",
  sourceUnknown: "69000000-0000-4000-8000-000000000606",
  sourceDivergent: "69000000-0000-4000-8000-000000000607",
  batchPrimary: "69000000-0000-4000-8000-000000000701",
  batchCompetitor: "69000000-0000-4000-8000-000000000702",
  batchBlocked: "69000000-0000-4000-8000-000000000703",
  batchAllowed: "69000000-0000-4000-8000-000000000704",
  batchExpired: "69000000-0000-4000-8000-000000000705",
  batchUnknown: "69000000-0000-4000-8000-000000000706",
  batchAllowedSecond: "69000000-0000-4000-8000-000000000707",
  batchDivergent: "69000000-0000-4000-8000-000000000708",
  competitorRoot: "69000000-0000-4000-8000-000000000801",
  unattributedRoot: "69000000-0000-4000-8000-000000000802",
  v2OnlyRoot: "69000000-0000-4000-8000-000000000803",
  multiRoot: "69000000-0000-4000-8000-000000000804",
  aliasRoot: "69000000-0000-4000-8000-000000000805",
  aliasRow: "69000000-0000-4000-8000-000000000806",
  historicalRoot: "69000000-0000-4000-8000-000000000807",
  rejectedRoot: "69000000-0000-4000-8000-000000000808",
  lowQualityRoot: "69000000-0000-4000-8000-000000000809",
  provenanceMixedRoot: "69000000-0000-4000-8000-000000000810",
  provenanceMixedAlias: "69000000-0000-4000-8000-000000000811",
  licensingBlockedRoot: "69000000-0000-4000-8000-000000000812",
  retentionExpiredRoot: "69000000-0000-4000-8000-000000000813",
  governanceUnknownRoot: "69000000-0000-4000-8000-000000000814",
  importOverrideRoot: "69000000-0000-4000-8000-000000000815",
  doubleAllowedRoot: "69000000-0000-4000-8000-000000000816",
  doubleAllowedAlias: "69000000-0000-4000-8000-000000000817",
  pendingUnattributedRoot: "69000000-0000-4000-8000-000000000818",
  divergentLicenseRoot: "69000000-0000-4000-8000-000000000819",
  categoryEntity: "69000000-0000-4000-8000-000000000520",
  referenceEntity: "69000000-0000-4000-8000-000000000521",
  categoryRoot: "69000000-0000-4000-8000-000000000820",
  referenceRoot: "69000000-0000-4000-8000-000000000821"
} as const;

test("greenfield product services govern, publish and preflight a synthetic workspace", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 78);
    const fixture = await seedFixture(client);
    const v1Initial = await operationalV1State(client, fixture.workspace.id);
    const pointerBefore = await rows(client, `
      SELECT id::text,population_id::text,purpose,promoted_at::text
      FROM signal_workspace_population_pointers
      WHERE workspace_id=$1::uuid ORDER BY purpose
    `, [fixture.workspace.id]);
    await client.query(`
      INSERT INTO methodologies (id,slug,name,version,status,manifest_yaml)
      VALUES ($1::uuid,'triggers-barriers','Triggers & Barriers','1.0.0','active','{}'::jsonb)
    `, [IDS.strategicMethodology]);

    const runControl = async (
      idempotencyKey: string,
      command: Parameters<typeof executeSignalGovernanceControlCommandV1>[0]["command"]
    ) => runTransaction(client, () => executeSignalGovernanceControlCommandV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey,command
    }));
    const effectiveFrom = "2026-01-01T00:00:00.000Z";
    const effectiveTo = "2027-01-01T00:00:00.000Z";
    const qualityDraftCommand: SignalGovernanceControlCommandV1 = {
      action: "create-quality-draft",min_quality_score: 5,
      required_quality_flags: [],forbidden_quality_flags: [],
      canonical_root_disposition: "evaluate",effective_from: effectiveFrom,effective_to: effectiveTo
    };
    const qualityDraft = await runControl("greenfield-quality-draft",qualityDraftCommand);
    assert.deepEqual(await runControl("greenfield-quality-draft",qualityDraftCommand),qualityDraft);
    await assert.rejects(
      runControl("greenfield-quality-draft",{ ...qualityDraftCommand,min_quality_score: 6 }),
      /Idempotency-Key was reused/iu
    );
    const qualityActivation = await runControl("greenfield-quality-activate", {
      action: "activate-policy",policy_kind: "quality-policy",policy_version: 1
    });
    assert.deepEqual(await runControl("greenfield-quality-activate", {
      action: "activate-policy",policy_kind: "quality-policy",policy_version: 1
    }),qualityActivation);
    await runControl("greenfield-retention-draft", {
      action: "create-retention-draft",retention_state: "allowed",
      retention_mode: "indefinite",retain_until: null,expiry_action: "block_use",
      approval_evidence: "Synthetic operator-approved retention decision",
      effective_from: effectiveFrom,effective_to: effectiveTo
    });
    await runControl("greenfield-retention-activate", {
      action: "activate-policy",policy_kind: "retention-policy",policy_version: 1
    });
    await runControl("greenfield-license-draft", {
      action: "create-licensing-draft",approval_evidence: "Synthetic operator-approved usage decision",
      effective_from: effectiveFrom,effective_to: effectiveTo,
      usages: [
        { usage_purpose: "internal-qa", decision: "prohibited" },
        { usage_purpose: "client-derived-metrics", decision: "allowed" },
        { usage_purpose: "client-mention-list", decision: "allowed" },
        { usage_purpose: "client-text-or-excerpt", decision: "allowed" },
        { usage_purpose: "llm-processing", decision: "allowed" },
        { usage_purpose: "strategic-analysis", decision: "allowed" }
      ]
    });
    await runControl("greenfield-license-activate", {
      action: "activate-policy",policy_kind: "licensing-policy",policy_version: 1
    });
    for (const [sourceId,label] of [
      [IDS.sourcePrimary,"primary"], [IDS.sourceCompetitor,"competitor"]
    ] as const) {
      await runControl(`greenfield-${label}-binding-draft`, {
        action: "create-provenance-binding-draft",source_id: sourceId,
        import_batch_id: null,effective_from: effectiveFrom,effective_to: effectiveTo
      });
      await runControl(`greenfield-${label}-binding-activate`, {
        action: "activate-provenance-binding",source_id: sourceId,
        import_batch_id: null,binding_version: 1
      });
    }
    await client.query(`
      INSERT INTO signal_data_watermarks (
        workspace_id,study_corpus_id,population_id,data_source_id,source_key,
        corpus_revision,last_import_batch_id,max_observed_at,accepted_at,materialized_at,
        source_freshness_state,data_freshness_state
      ) VALUES
        ($1::uuid,NULL,NULL,$2::uuid,'greenfield-primary-import',1,$3::uuid,now(),now(),now(),'fresh','fresh'),
        ($1::uuid,NULL,NULL,$4::uuid,'greenfield-competitor-import',1,$5::uuid,now(),now(),now(),'fresh','fresh')
    `,[fixture.workspace.id,IDS.sourcePrimary,IDS.batchPrimary,IDS.sourceCompetitor,IDS.batchCompetitor]);
    const identityCommand = {
      action: "upsert-identity",entity_type: "category",
      canonical_name: "Synthetic category",external_id: null
    } as const;
    const identity = await runControl("greenfield-category-identity",identityCommand) as {
      entity_id: string; created: boolean;
    };
    assert.deepEqual(await runControl("greenfield-category-identity",identityCommand),identity);
    assert.equal(identity.created,true);
    const productSource = await runTransaction(client,() => createWorkspaceDataSourceProductV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey: "greenfield-category-source",
      input: { name: "Synthetic category source",provider: "synthetic-csv",
        source_type: "listening_export",connection_method: "manual_upload",
        scope: "category",entity_id: identity.entity_id }
    }));
    assert.deepEqual(await runTransaction(client,() => createWorkspaceDataSourceProductV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey: "greenfield-category-source",
      input: { name: "Synthetic category source",provider: "synthetic-csv",
        source_type: "listening_export",connection_method: "manual_upload",
        scope: "category",entity_id: identity.entity_id }
    })),productSource);
    await assert.rejects(runTransaction(client,() => createWorkspaceDataSourceProductV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey: "greenfield-category-source",
      input: { name: "Incompatible source",provider: "synthetic-csv",
        source_type: "listening_export",connection_method: "manual_upload",
        scope: "category",entity_id: identity.entity_id }
    })),/Idempotency-Key.*incompatible/iu);
    await runControl("greenfield-category-source-binding-draft",{
      action: "create-provenance-binding-draft",source_id: productSource.id,
      import_batch_id: null,effective_from: effectiveFrom,effective_to: effectiveTo
    });
    await runControl("greenfield-category-source-binding-activate",{
      action: "activate-provenance-binding",source_id: productSource.id,
      import_batch_id: null,binding_version: 1
    });
    const otherWorkspaceId = await scalar<string>(client,`
      SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid
    `,[IDS.otherBrand]);
    await assert.rejects(runTransaction(client,() => executeSignalGovernanceControlCommandV1({
      queryable: client,
      workspace: { ...fixture.workspace,id: otherWorkspaceId,slug: "other",name: "Other" },
      actor: fixture.actor,idempotencyKey: "greenfield-cross-workspace",
      command: { action: "reconcile-brand-os" }
    })),/cross-workspace|unauthorized/iu);
    await insertRoot(client,fixture.workspace.id,IDS.categoryRoot,IDS.sourcePrimary,IDS.batchPrimary,8);
    const category = await createAssertion(client,{
      workspaceId: fixture.workspace.id,mentionId: IDS.categoryRoot,
      sourceId: IDS.sourcePrimary,batchId: IDS.batchPrimary,scope: "category",
      entityType: "category",entityId: identity.entity_id,
      policyKey: "greenfield-category-review",seed: "greenfield-category"
    });
    await reviewAssertion(client,category,"approve","greenfield-category-review");
    const v1BeforeGoverned = await operationalV1State(client,fixture.workspace.id);
    assert.equal(v1BeforeGoverned.pointer_id,v1Initial.pointer_id);
    assert.equal(v1BeforeGoverned.population_id,v1Initial.population_id);
    assert.equal(v1BeforeGoverned.definition_hash,v1Initial.definition_hash);
    assert.equal(v1BeforeGoverned.included_count,(v1Initial.included_count as number)+1);
    assert.match(String(v1BeforeGoverned.membership_digest),/^sha256:[0-9a-f]{64}$/u);

    const initialStatus = await loadSignalGovernedViewsProductPreflightV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor
    });
    assert.equal(initialStatus.views.length,4);
    assert.ok(initialStatus.views.every((view) => view.applicable));
    const operationalSets = new Map<string,string>();
    for (const viewKey of ["brand","competition","category","all-governed"] as const) {
      const reconciled = await runTransaction(client, () => reconcileSignalGovernedViewProductV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor,viewKey,
        idempotencyKey: `greenfield-${viewKey}-reconcile`
      }));
      assert.equal(reconciled.modules.length,3);
      assert.ok(reconciled.modules.every((module) => module.state === "ready"
        && module.governance_unknown_count === 0 && module.denominator_count > 0));
      const reconcileReplay = await runTransaction(client, () => reconcileSignalGovernedViewProductV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor,viewKey,
        idempotencyKey: `greenfield-${viewKey}-reconcile`
      }));
      assert.deepEqual(reconcileReplay,reconciled);
      const ready = await loadSignalGovernedViewsProductPreflightV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor
      });
      const view = ready.views.find((candidate) => candidate.view_key === viewKey)!;
      assert.equal(view.state,"ready");
      assert.ok(view.set_digest);
      operationalSets.set(viewKey,view.set_digest!);
      const promoted = await runTransaction(client, () => transitionSignalGovernedViewProductV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor,
        viewKey,action: "promote",expectedSetDigest: view.set_digest!,
        idempotencyKey: `greenfield-${viewKey}-promote`
      }));
      assert.equal(promoted.action,"promote");
      const replay = await runTransaction(client, () => transitionSignalGovernedViewProductV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor,
        viewKey,action: "promote",expectedSetDigest: view.set_digest!,
        idempotencyKey: `greenfield-${viewKey}-promote`
      }));
      assert.equal(replay.result.replayed,true);
    }
    await assert.rejects(runTransaction(client, () => reconcileSignalGovernedViewProductV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,viewKey: "competition",
      idempotencyKey: "greenfield-brand-reconcile"
    })),/Idempotency-Key.*incompatible/iu);
    const current = await loadSignalGovernedViewsProductPreflightV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor
    });
    assert.ok(current.views.every((view) => view.state === "current"
      && view.modules.every((module) => module.current_binding)));
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid AND binding_status='current'
        AND module_key IN ('brand-monitoring','mentions','topics-narratives')
        AND view_key IN ('brand','competition','category','all-governed')
    `,[fixture.workspace.id]),12);

    const v1Memberships = new Map(current.views.flatMap((view) => view.modules.map((module) => [
      `${view.view_key}:${module.module_key}`,
      module.membership_digest
    ] as const)));
    await runControl("greenfield-quality-v2-draft",qualityDraftCommand);
    await runControl("greenfield-quality-v2-activate", {
      action: "activate-policy",policy_kind: "quality-policy",policy_version: 2
    });
    await runControl("greenfield-retention-v2-draft", {
      action: "create-retention-draft",retention_state: "allowed",
      retention_mode: "indefinite",retain_until: null,expiry_action: "block_use",
      approval_evidence: "Synthetic operator-approved retention v2 decision",
      effective_from: effectiveFrom,effective_to: effectiveTo
    });
    await runControl("greenfield-retention-v2-activate", {
      action: "activate-policy",policy_kind: "retention-policy",policy_version: 2
    });
    await runControl("greenfield-license-v2-draft", {
      action: "create-licensing-draft",approval_evidence: "Synthetic operator-approved usage v2 decision",
      effective_from: effectiveFrom,effective_to: effectiveTo,
      usages: [
        { usage_purpose: "internal-qa", decision: "prohibited" },
        { usage_purpose: "client-derived-metrics", decision: "allowed" },
        { usage_purpose: "client-mention-list", decision: "allowed" },
        { usage_purpose: "client-text-or-excerpt", decision: "allowed" },
        { usage_purpose: "llm-processing", decision: "allowed" },
        { usage_purpose: "strategic-analysis", decision: "allowed" }
      ]
    });
    await runControl("greenfield-license-v2-activate", {
      action: "activate-policy",policy_kind: "licensing-policy",policy_version: 2
    });
    for (const [sourceId,label] of [
      [IDS.sourcePrimary,"primary"], [IDS.sourceCompetitor,"competitor"]
    ] as const) {
      await runControl(`greenfield-${label}-binding-v2-draft`, {
        action: "create-provenance-binding-draft",source_id: sourceId,
        import_batch_id: null,effective_from: effectiveFrom,effective_to: effectiveTo
      });
      await runControl(`greenfield-${label}-binding-v2-activate`, {
        action: "activate-provenance-binding",source_id: sourceId,
        import_batch_id: null,binding_version: 2
      });
    }
    for (const viewKey of ["brand","competition","category","all-governed"] as const) {
      const reconciled = await runTransaction(client, () => reconcileSignalGovernedViewProductV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor,viewKey,
        idempotencyKey: `greenfield-${viewKey}-quality-v2-reconcile`
      }));
      assert.ok(reconciled.modules.every((module) => module.state === "ready"
        && module.membership_digest === v1Memberships.get(`${viewKey}:${module.module_key}`)));
      const ready = await loadSignalGovernedViewsProductPreflightV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor
      });
      const view = ready.views.find((candidate) => candidate.view_key === viewKey)!;
      assert.equal(view.state,"ready");
      assert.ok(view.set_digest);
      await runTransaction(client, () => transitionSignalGovernedViewProductV1({
        queryable: client,workspace: fixture.workspace,actor: fixture.actor,
        viewKey,action: "promote",expectedSetDigest: view.set_digest!,
        idempotencyKey: `greenfield-${viewKey}-quality-v2-promote`
      }));
    }
    const rolled = await loadSignalGovernedViewsProductPreflightV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor
    });
    assert.ok(rolled.views.every((view) => view.state === "current"
      && view.modules.every((module) => module.current_binding
        && module.membership_digest === v1Memberships.get(`${view.view_key}:${module.module_key}`))));
    assert.deepEqual(await rows(client,`
      SELECT policy_key,policy_version,status FROM signal_population_policy_bundles
      WHERE workspace_id=$1::uuid AND policy_key LIKE 'operational-%-governed'
      ORDER BY policy_key,policy_version
    `,[fixture.workspace.id]),[
      { policy_key: "operational-all-governed",policy_version: 1,status: "active" },
      { policy_key: "operational-all-governed",policy_version: 2,status: "active" },
      { policy_key: "operational-brand-governed",policy_version: 1,status: "active" },
      { policy_key: "operational-brand-governed",policy_version: 2,status: "active" },
      { policy_key: "operational-category-governed",policy_version: 1,status: "active" },
      { policy_key: "operational-category-governed",policy_version: 2,status: "active" },
      { policy_key: "operational-competition-governed",policy_version: 1,status: "active" },
      { policy_key: "operational-competition-governed",policy_version: 2,status: "active" }
    ]);

    for (const viewKey of ["brand","competition","category","all-governed"] as const) {
      const shadowClient = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
      await shadowClient.connect();
      try {
        await shadowClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const shadow = await runSignalGovernedViewBindingShadowV1({
          workspace: fixture.workspace,actor: fixture.actor,viewKey,
          filter: fixture.filter,queryable: shadowClient
        });
        assert.equal(shadow.public_evidence.cross_module.operational_pointer_followed,false);
        assert.equal(shadow.public_evidence.cross_module.unexplained_count,0);
        assert.equal(shadow.public_evidence.modules.length,3);
        assert.ok(shadow.public_evidence.modules.every((module) => module.denominator > 0));
        await shadowClient.query("COMMIT");
      } catch (error) {
        await shadowClient.query("ROLLBACK");
        throw error;
      } finally {
        await shadowClient.end();
      }
    }

    const strategicBefore = await loadSignalStrategicProductStatusV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor
    });
    assert.equal(strategicBefore.state,"blocked");
    const prepared = await runTransaction(client, () => reconcileSignalStrategicProductAuthorityV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey: "greenfield-strategic-prepare",promote: false
    }));
    assert.equal(prepared.status.state,"ready");
    assert.equal(prepared.authority.binding_current,false);
    assert.deepEqual(await runTransaction(client, () => reconcileSignalStrategicProductAuthorityV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey: "greenfield-strategic-prepare",promote: false
    })),prepared);
    await assert.rejects(runTransaction(client, () => reconcileSignalStrategicProductAuthorityV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey: "greenfield-strategic-prepare",promote: true
    })),/Idempotency-Key.*incompatible/iu);
    const strategic = await runTransaction(client, () => reconcileSignalStrategicProductAuthorityV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      idempotencyKey: "greenfield-strategic-promote",promote: true
    }));
    assert.equal(strategic.status.state,"current");
    assert.equal(strategic.authority.binding_current,true);

    const preflight = await preflightSignalTbStrategicRun({
      workspaceId: fixture.workspace.id,periodStart: "2026-01-01",periodEnd: "2026-12-31",
      timezone: "UTC",studySize: "small",hardCapUsd: 15
    }, {
      connect: async () => {
        const preflightClient = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
        await preflightClient.connect();
        return {
          query: preflightClient.query.bind(preflightClient),
          release: () => { void preflightClient.end(); }
        };
      },
      loadRuntimeReadiness: async () => ({
        queue_configured: true,worker_alive: true,
        provider_key_configured: true,recovery_ready: true
      }),
      env: {
        NODE_ENV: "test",ANTHROPIC_API_KEY: "configured-for-local-contract-test",
        NOISIA_SIGNAL_TB_MODEL: "claude-sonnet-4-6",
        NOISIA_SIGNAL_TB_PRICING_VERSION: "anthropic-public-2026-08-12",
        NOISIA_SIGNAL_TB_INPUT_USD_PER_MTOK: "3",
        NOISIA_SIGNAL_TB_OUTPUT_USD_PER_MTOK: "15",
        NOISIA_SIGNAL_TB_MAX_INPUT_TOKENS_PER_CALL: "120000",
        NOISIA_SIGNAL_TB_MAX_BUDGET_USD: "15",
        NOISIA_SIGNAL_TB_PAID_RUN_APPROVED: "true"
      }
    });
    assert.equal(preflight.ready,true);
    assert.equal(preflight.launch_authorized,true);
    assert.equal(preflight.jobs_enqueued,0);
    assert.equal(preflight.provider_calls,0);
    assert.ok(preflight.population && preflight.denominator && preflight.coverage
      && preflight.provider && preflight.budget && preflight.preflight_digest);
    assert.equal(preflight.provider.model,"claude-sonnet-4-6");
    assert.equal(preflight.coverage.abstained.availability,"not_available");
    assert.equal(preflight.coverage.abstained.count,null);
    assert.equal(await scalar<number>(client,`
      SELECT (SELECT count(*) FROM signal_strategic_run_controls)::int
        +(SELECT count(*) FROM signal_strategic_run_outbox)::int
        +(SELECT count(*) FROM signal_strategic_step_outbox)::int
    `),0);

    assert.ok(operationalSets.get("competition"));
    const competitionBeforeWithdraw = await loadSignalGovernedViewsProductPreflightV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor
    });
    const competitionDigest = competitionBeforeWithdraw.views.find(
      (view) => view.view_key === "competition"
    )!.set_digest!;
    const withdrawn = await runTransaction(client, () => transitionSignalGovernedViewProductV1({
      queryable: client,workspace: fixture.workspace,actor: fixture.actor,
      viewKey: "competition",action: "withdraw",expectedSetDigest: competitionDigest,
      idempotencyKey: "greenfield-competition-withdraw"
    }));
    assert.equal(withdrawn.action,"withdraw");
    for (const moduleKey of ["brand-monitoring","mentions","topics-narratives"] as const) {
      await assert.rejects(
        resolveSignalGovernedViewV1(
          fixture.workspace,
          { module_key: moduleKey,view_key: "competition" },
          createPostgresSignalGovernedViewResolverStore(async <Row>(sql: string,values: unknown[]) => {
            const result = await client.query(sql,values);
            return result.rows as Row[];
          })
        ),
        (error: unknown) => (error as { code?: string }).code === "not_available"
      );
    }
    assert.deepEqual(await operationalV1State(client,fixture.workspace.id),v1BeforeGoverned);
    assert.deepEqual(await rows(client, `
      SELECT id::text,population_id::text,purpose,promoted_at::text
      FROM signal_workspace_population_pointers
      WHERE workspace_id=$1::uuid ORDER BY purpose
    `,[fixture.workspace.id]),pointerBefore);
  } finally {
    await client.end();
  }
});

test("competition, category and all-governed compile and bind independently", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 73);
    const fixture = await seedFixture(client);
    await client.query(`
      INSERT INTO intelligence_entities (
        id,organization_id,brand_id,entity_type,canonical_name,status
      ) VALUES
        ($1::uuid,$3::uuid,$4::uuid,'category','Fixture category','active'),
        ($2::uuid,$3::uuid,$4::uuid,'reference','Fixture reference','active')
    `, [IDS.categoryEntity,IDS.referenceEntity,IDS.organization,IDS.brand]);
    await insertRoot(client,fixture.workspace.id,IDS.categoryRoot,IDS.sourcePrimary,IDS.batchPrimary,8);
    await insertRoot(client,fixture.workspace.id,IDS.referenceRoot,IDS.sourceCompetitor,IDS.batchCompetitor,8);
    const category = await createAssertion(client,{
      workspaceId: fixture.workspace.id,mentionId: IDS.categoryRoot,
      sourceId: IDS.sourcePrimary,batchId: IDS.batchPrimary,scope: "category",
      entityType: "category",entityId: IDS.categoryEntity,
      policyKey: "fixture-category-review",seed: "multi-view-category"
    });
    const reference = await createAssertion(client,{
      workspaceId: fixture.workspace.id,mentionId: IDS.referenceRoot,
      sourceId: IDS.sourceCompetitor,batchId: IDS.batchCompetitor,scope: "reference",
      entityType: "reference",entityId: IDS.referenceEntity,
      policyKey: "fixture-reference-review",seed: "multi-view-reference"
    });
    await reviewAssertion(client,category,"approve","multi-view-category-review");
    await reviewAssertion(client,reference,"approve","multi-view-reference-review");
    const v1Before = await operationalV1State(client, fixture.workspace.id);
    const brandBaseBefore = await semanticBaseState(client, fixture.workspace.id);
    const authorities = await createGovernanceAuthorities(client,fixture);
    const order = ["all-governed","category","competition"] as const;
    const first = new Map<string,string>();
    const bundles = new Map<(typeof order)[number],string>();
    for (const viewKey of order) {
      const draft = await ensureSignalGovernedViewPolicyDraftV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,queryable: client
      });
      bundles.set(viewKey,draft.policy_bundle_id);
      await resolveSignalGovernedViewPolicyDraftGovernanceV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,
        policyBundleId: draft.policy_bundle_id,
        qualityPolicyId: authorities.qualityPolicyId,queryable: client
      });
      for (const moduleKey of ["topics-narratives","mentions","brand-monitoring"] as const) {
        const blocked = await reconcileSignalGovernedViewPolicyCandidateV1({
          workspace: fixture.workspace,actor: fixture.actor,viewKey,
          policyBundleId: draft.policy_bundle_id,moduleKey,
          reconcileMemberships: true,queryable: client
        });
        assert.equal(blocked.compilation_status,"blocked");
        assert.ok(blocked.blocking_reasons.includes("data-watermark-not-available"));
        await client.query(`
          INSERT INTO signal_data_watermarks (
            workspace_id,study_corpus_id,population_id,data_source_id,source_key,
            corpus_revision,max_observed_at,accepted_at,materialized_at,
            source_freshness_state,data_freshness_state
          ) VALUES ($1::uuid,NULL,$2::uuid,$3::uuid,$4,1,now(),now(),now(),'fresh','fresh')
          ON CONFLICT DO NOTHING
        `,[fixture.workspace.id,blocked.population_id,IDS.sourcePrimary,`${viewKey}-${moduleKey}`]);
        const ready = await reconcileSignalGovernedViewPolicyCandidateV1({
          workspace: fixture.workspace,actor: fixture.actor,viewKey,
          policyBundleId: draft.policy_bundle_id,moduleKey,
          reconcileMemberships: true,queryable: client
        });
        assert.equal(ready.compilation_status,"ready");
        assert.equal(ready.alias_membership_count,0);
        assert.equal(ready.governance_unknown_count,0);
        first.set(`${viewKey}:${moduleKey}`,`${ready.population_id}:${ready.actual_membership_digest}`);
      }
    }
    for (const viewKey of [...order].reverse()) {
      const policyBundleId = bundles.get(viewKey)!;
      for (const moduleKey of ["brand-monitoring","mentions","topics-narratives"] as const) {
        const retry = await reconcileSignalGovernedViewPolicyCandidateV1({
          workspace: fixture.workspace,actor: fixture.actor,viewKey,
          policyBundleId,moduleKey,
          reconcileMemberships: true,queryable: client
        });
        assert.equal(`${retry.population_id}:${retry.actual_membership_digest}`,
          first.get(`${viewKey}:${moduleKey}`));
      }
      const preflight = await loadSignalGovernedViewBindingSetPreflightV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,queryable: client
      });
      const promoted = await promoteSignalGovernedViewBindingSetV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,
        expectedSetDigest: preflight.set_digest,
        idempotencyKey: `${viewKey}-binding-promote`,queryable: client
      });
      assert.equal(promoted.items.length,3);
      const current = await loadSignalGovernedViewBindingSetPreflightV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,queryable: client
      });
      assert.equal(current.current_binding_count,3);
      const replay = await promoteSignalGovernedViewBindingSetV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,
        expectedSetDigest: preflight.set_digest,
        idempotencyKey: `${viewKey}-binding-promote`,queryable: client
      });
      assert.equal(replay.replayed,true);
    }
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid AND binding_status='current'
        AND view_key IN ('competition','category','all-governed')
    `,[fixture.workspace.id]),9);
    const categoryCurrent = await loadSignalGovernedViewBindingSetPreflightV1({
      workspace: fixture.workspace,actor: fixture.actor,viewKey: "category",queryable: client
    });
    await assert.rejects(
      promoteSignalGovernedViewBindingSetV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey: "category",
        expectedSetDigest: categoryCurrent.set_digest,
        idempotencyKey: "competition-binding-promote",queryable: client
      }),
      /idempotency key was reused incompatibly/iu
    );
    const activeBundleId = bundles.get("competition")!;
    const activeDefinitionBefore = await row(client, `
      SELECT status,definition_hash,allowed_scopes,required_usage_purposes,updated_at::text
      FROM signal_population_policy_bundles WHERE id=$1::uuid
    `,[activeBundleId]);
    await assert.rejects(
      ensureSignalGovernedViewPolicyDraftV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey: "competition",queryable: client
      }),
      /incompatible governed content/iu
    );
    assert.deepEqual(await row(client, `
      SELECT status,definition_hash,allowed_scopes,required_usage_purposes,updated_at::text
      FROM signal_population_policy_bundles WHERE id=$1::uuid
    `,[activeBundleId]),activeDefinitionBefore);
    await client.query("BEGIN");
    const invalidatedCompilationId = await scalar<string>(client,`
      SELECT id::text FROM signal_population_policy_compilations
      WHERE workspace_id=$1::uuid AND policy_bundle_id=$2::uuid
        AND module_key='brand-monitoring' AND view_key='competition' AND is_current
    `,[fixture.workspace.id,activeBundleId]);
    await client.query(`
      INSERT INTO signal_data_governance_invalidations (
        workspace_id,policy_compilation_id,reason_code,object_kind,
        object_identity_hash,idempotency_key
      ) VALUES ($1::uuid,$2::uuid,'watermark-changed','watermark',$3,$4)
    `,[fixture.workspace.id,invalidatedCompilationId,
      hash("active-competition-watermark"),hash("active-competition-recompile")]);
    const recompiledActive = await reconcileSignalGovernedViewPolicyCandidateV1({
      workspace: fixture.workspace,actor: fixture.actor,viewKey: "competition",
      policyBundleId: activeBundleId,moduleKey: "brand-monitoring",
      reconcileMemberships: true,queryable: client
    });
    assert.equal(recompiledActive.compilation_status,"ready");
    assert.notEqual(recompiledActive.policy_compilation_id,invalidatedCompilationId);
    await client.query("ROLLBACK");
    const shadowByView = new Map<string,string>();
    const cursorByView = new Map<string,string>();
    const etagByView = new Map<string,string>();
    const governedShadowSql: string[] = [];
    const governedShadowQueryable = {
      async query<Row extends Record<string,unknown> = Record<string,unknown>>(
        sql: string,
        values?: unknown[]
      ) {
        governedShadowSql.push(sql);
        const result = await client.query(sql,values as never[] | undefined);
        return { rows: result.rows as Row[],rowCount: result.rowCount };
      }
    };
    for (const viewKey of order) {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const normal = await runSignalGovernedViewBindingShadowV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,
        filter: fixture.filter,queryable: governedShadowQueryable
      });
      await client.query("COMMIT");
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const reverse = await runSignalGovernedViewBindingShadowV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,
        filter: fixture.filter,
        executionOrder: ["topics-narratives","mentions","brand-monitoring"],
        queryable: governedShadowQueryable
      });
      await client.query("COMMIT");
      assert.equal(normal.public_evidence.gate_passed,true,
        JSON.stringify(normal.public_evidence,null,2));
      assert.equal(reverse.public_evidence.evidence_digest,
        normal.public_evidence.evidence_digest);
      assert.equal(normal.public_evidence.cross_module.unexplained_count,0);
      assert.equal(normal.public_evidence.cross_module.operational_pointer_followed,false);
      assert.ok(normal.public_evidence.modules.every((module) =>
        module.invariants.alias_memberships===0
        && module.invariants.policy_sql_matches_memberships
        && module.reader_checks.pagination_cursor_isolated
        && module.reader_checks.taxonomy_evidence_exact));
      shadowByView.set(viewKey,normal.public_evidence.evidence_digest);
      const mentions = normal.public_evidence.modules.find((module) =>
        module.module_key==="mentions")!;
      cursorByView.set(viewKey,mentions.serving_identity.cursor_isolation_hash);
      etagByView.set(viewKey,mentions.serving_identity.etag_seed);
    }
    assert.equal(new Set(shadowByView.values()).size,order.length);
    assert.equal(new Set(cursorByView.values()).size,order.length);
    assert.equal(new Set(etagByView.values()).size,order.length);
    const executedShadowSql = governedShadowSql.join("\n");
    assert.doesNotMatch(executedShadowSql,/signal_workspace_population_pointers/iu);
    assert.doesNotMatch(executedShadowSql,/signal_workspace_corpora/iu);
    assert.doesNotMatch(executedShadowSql,/JOIN\s+study_corpora/iu);
    assert.doesNotMatch(executedShadowSql,/published_outputs/iu);
    const allGovernedUnion = await row<{
      expected_count: number;
      actual_count: number;
      expected_only: number;
      actual_only: number;
      duplicate_count: number;
    }>(client,`
      WITH selected AS (
        SELECT compilation.governance_evaluation_id,population.id AS population_id
        FROM signal_population_policy_compilations compilation
        JOIN signal_population_definitions population ON population.id=compilation.population_id
        WHERE compilation.workspace_id=$1::uuid AND compilation.module_key='mentions'
          AND compilation.view_key='all-governed' AND compilation.is_current
      ), expected AS (
        SELECT DISTINCT item.mention_id FROM selected
        JOIN signal_data_governance_evaluation_items item
          ON item.evaluation_id=selected.governance_evaluation_id
        JOIN signal_mention_attributions assertion
          ON assertion.workspace_id=$1::uuid AND assertion.mention_id=item.mention_id
         AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
         AND assertion.review_status='approved' AND assertion.eligibility_status='eligible'
        JOIN signal_population_policy_entities entity
          ON entity.workspace_id=assertion.workspace_id
         AND entity.policy_bundle_id=$2::uuid
         AND entity.scope=assertion.scope AND entity.entity_type=assertion.entity_type
         AND entity.entity_id=assertion.entity_id
        WHERE item.decision='included' AND item.reason_code='policy_eligible'
      ), actual AS (
        SELECT membership.mention_id FROM selected
        JOIN signal_population_memberships membership
          ON membership.population_id=selected.population_id
        WHERE membership.workspace_id=$1::uuid AND membership.membership_status='included'
          AND membership.removed_at IS NULL
      ) SELECT
        (SELECT count(*)::int FROM expected) AS expected_count,
        (SELECT count(*)::int FROM actual) AS actual_count,
        (SELECT count(*)::int FROM (SELECT mention_id FROM expected
          EXCEPT SELECT mention_id FROM actual) missing) AS expected_only,
        (SELECT count(*)::int FROM (SELECT mention_id FROM actual
          EXCEPT SELECT mention_id FROM expected) extra) AS actual_only,
        (SELECT count(*)::int FROM (SELECT mention_id FROM actual GROUP BY mention_id
          HAVING count(*)>1) duplicate) AS duplicate_count
    `,[fixture.workspace.id,bundles.get("all-governed")!]);
    assert.ok(allGovernedUnion.expected_count > 0);
    assert.equal(allGovernedUnion.actual_count,allGovernedUnion.expected_count);
    assert.equal(allGovernedUnion.expected_only,0);
    assert.equal(allGovernedUnion.actual_only,0);
    assert.equal(allGovernedUnion.duplicate_count,0);
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_population_memberships membership
      JOIN signal_population_policy_compilations compilation
        ON compilation.population_id=membership.population_id
       AND compilation.module_key='mentions' AND compilation.view_key='all-governed'
       AND compilation.is_current
      WHERE membership.workspace_id=$1::uuid AND membership.mention_id=$2::uuid
        AND membership.membership_status='included' AND membership.removed_at IS NULL
    `,[fixture.workspace.id,IDS.multiRoot]),1);
    const liveAuthorityStore = createPostgresSignalGovernedViewResolverStore(
      async <Row>(sql:string,values:unknown[]) => (await client.query(sql,values)).rows as Row[]
    );
    await client.query("BEGIN");
    await client.query("UPDATE brand_seeds SET active=false WHERE id=$1::uuid",
      [IDS.competitorSeed]);
    assert.equal((await liveAuthorityStore.loadCurrentBinding({
      workspaceId: fixture.workspace.id,moduleKey:"mentions",viewKey:"competition"
    }))?.live_entity_authority_valid,false);
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query("UPDATE intelligence_entities SET status='retired' WHERE id=$1::uuid",
      [IDS.categoryEntity]);
    assert.equal((await liveAuthorityStore.loadCurrentBinding({
      workspaceId: fixture.workspace.id,moduleKey:"mentions",viewKey:"category"
    }))?.live_entity_authority_valid,false);
    await client.query("ROLLBACK");
    const unknownSource = await scalar<string>(client,`
      INSERT INTO data_sources (
        workspace_id,organization_id,brand_id,source_type,provider,connection_method,
        name,governed_scope,governed_entity_type,governed_entity_id,
        scope_policy_version,scope_review_status,scope_approved_by_user_id,
        scope_approval_source,scope_approved_at,role,status
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,'social-listening','fixture','csv',
        'Unknown rights','category','category',$4::uuid,
        'workspace-source-scope-v1','approved',$5::uuid,'fixture',now(),'{}'::jsonb,'active')
      RETURNING id::text
    `,[fixture.workspace.id,IDS.organization,IDS.brand,IDS.categoryEntity,IDS.actor]);
    assert.ok(unknownSource);
    for (const viewKey of [...order].reverse()) {
      const before = await loadSignalGovernedViewBindingSetPreflightV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,queryable: client
      });
      const withdrawn = await withdrawSignalGovernedViewBindingSetV1({
        workspace: fixture.workspace,actor: fixture.actor,viewKey,
        expectedSetDigest: before.set_digest,
        idempotencyKey: `${viewKey}-binding-withdraw`,queryable: client
      });
      assert.equal(withdrawn.items.length,3);
    }
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid AND binding_status='current'
        AND view_key IN ('competition','category','all-governed')
    `,[fixture.workspace.id]),0);
    assert.deepEqual(await operationalV1State(client,fixture.workspace.id),v1Before);
    assert.deepEqual(await semanticBaseState(client,fixture.workspace.id),brandBaseBefore);
  } finally {
    await client.end();
  }
});

test("brand draft policy reproduces semantic V2 and shadow never follows the operational pointer", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 71);
    const fixture = await seedFixture(client);
    const v1Before = await operationalV1State(client, fixture.workspace.id);

    const firstDraft = await ensureSignalBrandPolicyDraftV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    const secondDraft = await ensureSignalBrandPolicyDraftV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    assert.equal(firstDraft.created, true);
    assert.equal(secondDraft.created, false);
    assert.equal(secondDraft.policy_bundle_id, firstDraft.policy_bundle_id);
    assert.deepEqual(firstDraft.readiness.blocking_reasons, [
      "quality_policy_not_available",
      "data_governance_policy_not_available",
      "retention_policy_not_available",
      "licensing_policy_not_available"
    ]);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_bindings
    `), 0);

    const authorities = await createGovernanceAuthorities(client, fixture);
    await resolveSignalBrandPolicyDraftGovernanceV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      qualityPolicyId: authorities.qualityPolicyId,
      queryable: client
    });
    const semanticBaseBeforeCompilation = await semanticBaseState(client, fixture.workspace.id);
    const withoutWatermark = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.deepEqual(
      await semanticBaseState(client, fixture.workspace.id),
      semanticBaseBeforeCompilation
    );
    assert.equal(withoutWatermark.compilation_status, "blocked");
    assert.deepEqual(withoutWatermark.blocking_reasons, ["data-watermark-not-available"]);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_invalidations
      WHERE workspace_id=$1::uuid AND population_id=$2::uuid
    `, [fixture.workspace.id, withoutWatermark.population_id]), 0);
    await client.query(`
      INSERT INTO signal_data_watermarks (
        workspace_id,study_corpus_id,population_id,data_source_id,source_key,
        corpus_revision,max_observed_at,accepted_at,materialized_at,
        source_freshness_state,data_freshness_state
      ) VALUES ($1::uuid,NULL,$2::uuid,$3::uuid,'governance-initial',1,
        now(),now(),now(),'fresh','fresh')
    `, [fixture.workspace.id, withoutWatermark.population_id, IDS.sourcePrimary]);
    const reconciliation = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.deepEqual(
      await semanticBaseState(client, fixture.workspace.id),
      semanticBaseBeforeCompilation
    );
    assert.equal(reconciliation.compilation_status, "ready");
    assert.equal(reconciliation.expected_membership_count, 4);
    assert.equal(reconciliation.actual_membership_count, 4);
    assert.equal(reconciliation.alias_membership_count, 0);
    assert.equal(reconciliation.policy_matches_memberships, true);

    const reconciledAgain = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.equal(reconciledAgain.policy_compilation_id, reconciliation.policy_compilation_id);
    assert.equal(reconciledAgain.compilation_version, 2);
    assert.deepEqual(await operationalV1State(client, fixture.workspace.id), v1Before);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_bindings
    `), 0);

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const shadow = await runSignalBrandDraftShadowV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      moduleKey: "mentions",
      filter: fixture.filter,
      queryable: client
    });
    await client.query("COMMIT");
    assert.equal(
      shadow.public_evidence.gate_passed,
      true,
      JSON.stringify(shadow.public_evidence, null, 2)
    );
    assert.equal(shadow.public_evidence.invariants.operational_pointer_followed, false);
    assert.equal(shadow.public_evidence.invariants.alias_memberships, 0);
    assert.deepEqual(shadow.public_evidence.coverage.abstained, {
      availability: "not_available",
      count: null
    });
    assert.deepEqual(shadow.public_evidence.coverage.unattributed, {
      availability: "available",
      count: 1
    });
    assert.deepEqual(shadow.public_evidence.coverage.unreviewed, {
      availability: "available",
      count: 1
    });
    assert.deepEqual(shadow.public_evidence.legacy_differences.legacy_only_by_reason, {
      quality_not_eligible: 1,
      semantic_primary_rejected: 1,
      semantic_scope_competitor: 1,
      semantic_scope_unattributed: 1
    });
    assert.deepEqual(shadow.public_evidence.legacy_differences.governed_only_by_reason, {
      semantic_primary_brand_not_in_legacy: 1
    });

    // A stale population digest makes the server-owned draft resolver fail closed.
    await client.query(`
      INSERT INTO signal_population_memberships (
        population_id, workspace_id, mention_id, membership_status,
        membership_reason, effective_at, removed_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'included',
        'fixture-stale-membership', now(), NULL
      )
      ON CONFLICT (population_id, mention_id) DO UPDATE SET
        membership_status = 'included', removed_at = NULL,
        membership_reason = 'fixture-stale-membership'
    `, [reconciliation.population_id, fixture.workspace.id, IDS.competitorRoot]);
    await client.query(
      "SELECT refresh_signal_governed_view_population_membership_digest($1::uuid)",
      [reconciliation.population_id]
    );
    await assert.rejects(
      runSignalBrandDraftShadowV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        moduleKey: "mentions",
        filter: fixture.filter,
        queryable: client
      }),
      /unavailable|candidate/iu
    );
    const refreshed = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.equal(refreshed.compilation_version, 2);
    assert.equal(refreshed.policy_compilation_id, reconciliation.policy_compilation_id);
    assert.equal(refreshed.compilation_status, "ready");

    // A semantically incompatible compiled-plan hash is rejected relationally
    // before it can become visible to the draft resolver.
    await expectSqlState(client, "23514", `
      INSERT INTO signal_population_policy_compilations (
        workspace_id, policy_bundle_id, population_id, compilation_version,
        compiled_plan_hash, policy_definition_hash, population_version,
        population_definition_hash, membership_digest,
        source_watermark_hash, source_watermark_at,
        compilation_status, blocking_reasons, compiled_by_user_id,
        governance_evaluation_id, quality_policy_id, quality_policy_version,
        quality_policy_hash, retention_policy_digest, licensing_policy_digest,
        usage_purposes, authorized_root_count, quality_blocked_count,
        retention_blocked_count, licensing_blocked_count,
        governance_unknown_count, policy_evaluation_watermark, governance_digest,
        module_key,view_key,next_policy_transition_at,governance_data_watermark_id
      )
      SELECT workspace_id, policy_bundle_id, population_id, 4,
        $2, policy_definition_hash, population_version,
        population_definition_hash, membership_digest,
        source_watermark_hash, source_watermark_at,
        'ready', ARRAY[]::text[], $3::uuid,
        governance_evaluation_id, quality_policy_id, quality_policy_version,
        quality_policy_hash, retention_policy_digest, licensing_policy_digest,
        usage_purposes, authorized_root_count, quality_blocked_count,
        retention_blocked_count, licensing_blocked_count,
        governance_unknown_count, policy_evaluation_watermark, governance_digest,
        module_key,view_key,next_policy_transition_at,governance_data_watermark_id
      FROM signal_population_policy_compilations
      WHERE id = $1::uuid
    `, [refreshed.policy_compilation_id, hash("ac"), IDS.actor]);
    const hashRecovered = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.equal(hashRecovered.compilation_version, 2);
    assert.equal(hashRecovered.policy_compilation_id, refreshed.policy_compilation_id);
    assert.equal(hashRecovered.compilation_status, "ready");

    const edge = await seedGovernanceEdgeCases(client, fixture, authorities);
    const edgeReconciliation = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.ok(edgeReconciliation.governance_unknown_count !== null
      && edgeReconciliation.governance_unknown_count > 0);
    assert.equal(edgeReconciliation.compilation_status, "blocked");
    assert.ok(edgeReconciliation.blocking_reasons.includes("data-governance-not-available"));
    assert.deepEqual(await rows(client, `
      SELECT mention_id::text AS mention_id, decision, reason_code
      FROM signal_data_governance_evaluation_items
      WHERE evaluation_id=$1::uuid AND mention_id=ANY($2::uuid[])
      ORDER BY mention_id
    `, [edgeReconciliation.governance_evaluation_id, edge.rootIds]), [
      { mention_id: IDS.provenanceMixedRoot, decision: "included", reason_code: "policy_eligible" },
      { mention_id: IDS.licensingBlockedRoot, decision: "blocked", reason_code: "licensing_prohibited" },
      { mention_id: IDS.retentionExpiredRoot, decision: "blocked", reason_code: "retention_expired" },
      { mention_id: IDS.governanceUnknownRoot, decision: "blocked", reason_code: "no_authorized_provenance" },
      { mention_id: IDS.importOverrideRoot, decision: "blocked", reason_code: "licensing_prohibited" },
      { mention_id: IDS.doubleAllowedRoot, decision: "included", reason_code: "policy_eligible" }
    ]);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_population_memberships
      WHERE population_id=$1::uuid AND mention_id=ANY($2::uuid[])
        AND membership_status='included' AND removed_at IS NULL
    `, [edgeReconciliation.population_id, edge.rootIds]), 2);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_evaluation_items
      WHERE evaluation_id=$1::uuid AND mention_id=$2::uuid
    `, [edgeReconciliation.governance_evaluation_id, IDS.provenanceMixedRoot]), 1);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_evaluation_items
      WHERE evaluation_id=$1::uuid AND mention_id=$2::uuid
    `, [edgeReconciliation.governance_evaluation_id, IDS.doubleAllowedRoot]), 1);

    // The unknown source was not the selected provenance in the prior proof.
    // Activating its first valid route still has to invalidate every canonical
    // root reachable through import provenance, then change recompilation.
    const alternativeInvalidationsBefore = await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_invalidations
      WHERE policy_compilation_id=$1::uuid
    `, [edgeReconciliation.policy_compilation_id]);
    const alternativeBinding = await ensureSignalProvenancePolicyBindingDraftV1({
      queryable: client,
      actor: fixture.actor,
      definition: {
        workspace_id: fixture.workspace.id,
        data_source_id: IDS.sourceUnknown,
        import_batch_id: null,
        binding_version: 1,
        quality_policy_id: authorities.qualityPolicyId,
        retention_policy_id: authorities.retentionPolicyId,
        licensing_policy_id: authorities.licensingPolicyId
      },
      idempotencyKey: hash("previously-unselected-alternative-create")
    });
    await activateSignalDataGovernanceObjectV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      objectKind: "provenance-binding",
      objectId: alternativeBinding.binding_id,
      idempotencyKey: hash("previously-unselected-alternative-activate")
    });
    assert.ok(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_invalidations
      WHERE policy_compilation_id=$1::uuid
    `, [edgeReconciliation.policy_compilation_id]) > alternativeInvalidationsBefore);
    const withAlternative = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.equal(withAlternative.compilation_status, "ready");
    assert.equal(withAlternative.governance_unknown_count, 0);
    assert.deepEqual(await row(client, `
      SELECT decision,reason_code FROM signal_data_governance_evaluation_items
      WHERE evaluation_id=$1::uuid AND mention_id=$2::uuid
    `, [withAlternative.governance_evaluation_id, IDS.governanceUnknownRoot]), {
      decision: "included", reason_code: "policy_eligible"
    });
    assert.ok(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_invalidations
      WHERE workspace_id=$1::uuid
    `, [fixture.workspace.id]) > 0);
    const governancePreflight = await loadSignalDataGovernancePreflightV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      moduleKey: "mentions",
      viewKey: "brand"
    });
    assert.equal(governancePreflight.read_only, true);
    assert.equal(governancePreflight.writes_performed, false);
    assert.ok(governancePreflight.source_count >= 6);
    assert.ok(governancePreflight.roots_blocked_retention >= 1);
    assert.ok(governancePreflight.roots_blocked_licensing >= 1);
    assert.ok(governancePreflight.roots_with_authorized_provenance >= 2);
    assert.ok(governancePreflight.usage_authorization_gaps["client-text-or-excerpt"]! >= 1);
    await client.query(`
      INSERT INTO signal_data_watermarks (
        workspace_id,study_corpus_id,population_id,data_source_id,source_key,
        corpus_revision,max_observed_at,accepted_at,materialized_at,
        source_freshness_state,data_freshness_state
      ) VALUES ($1::uuid,NULL,$2::uuid,$3::uuid,'governance-fixture',1,
        now(),now(),now(),'fresh','fresh')
    `, [fixture.workspace.id, withAlternative.population_id, IDS.sourceCompetitor]);
    const invalidationsBeforeQualityChange = await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_invalidations
      WHERE policy_compilation_id=$1::uuid
    `, [withAlternative.policy_compilation_id]);
    await client.query(`
      UPDATE mentions SET quality_score=7,updated_at=now() WHERE id=$1::uuid
    `, [IDS.provenanceMixedRoot]);
    const invalidationsBeforePolicyChange = await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_invalidations
      WHERE policy_compilation_id=$1::uuid
    `, [withAlternative.policy_compilation_id]);
    assert.ok(invalidationsBeforePolicyChange > invalidationsBeforeQualityChange);
    const replacementBinding = await ensureSignalProvenancePolicyBindingDraftV1({
      queryable: client,
      actor: fixture.actor,
      definition: {
        workspace_id: fixture.workspace.id,
        data_source_id: IDS.sourceCompetitor,
        import_batch_id: null,
        binding_version: 2,
        quality_policy_id: authorities.qualityPolicyId,
        retention_policy_id: authorities.retentionPolicyId,
        licensing_policy_id: authorities.licensingPolicyId
      },
      idempotencyKey: hash("competitor-binding-v2-create")
    });
    await activateSignalDataGovernanceObjectV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      objectKind: "provenance-binding",
      objectId: replacementBinding.binding_id,
      idempotencyKey: hash("competitor-binding-v2-activate")
    });
    assert.ok(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_governance_invalidations
      WHERE policy_compilation_id=$1::uuid
    `, [withAlternative.policy_compilation_id]) > invalidationsBeforePolicyChange);
    assert.ok(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_data_invalidations
      WHERE workspace_id=$1::uuid AND population_id=$2::uuid
        AND source_key='data-governance-policy'
    `, [fixture.workspace.id, withAlternative.population_id]) > 0);

    // Temporal proof crosses four real clock boundaries without editing an
    // evaluation/compilation in place: policy/binding effective_from,
    // retain_until, policy effective_to and binding effective_to.
    await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    const temporalNow = Date.now();
    const temporalStart = new Date(temporalNow + 250).toISOString();
    const retainUntil = new Date(temporalNow + 550).toISOString();
    const licensingEnds = new Date(temporalNow + 850).toISOString();
    const bindingEnds = new Date(temporalNow + 1150).toISOString();
    const temporalRetention = await ensureSignalRetentionPolicyDraftV1({
      queryable: client,
      organizationId: IDS.organization,
      actor: fixture.actor,
      definition: {
        workspace_id: fixture.workspace.id,
        policy_key: "fixture-temporal-retention",
        policy_version: 1,
        retention_state: "allowed",
        retention_mode: "until",
        retain_until: retainUntil,
        expiry_action: "block_use",
        approval_evidence_hash: hash("temporal-retention-evidence")
      },
      idempotencyKey: hash("temporal-retention-create")
    });
    const temporalLicense = await ensureSignalLicensingPolicyDraftV1({
      queryable: client,
      organizationId: IDS.organization,
      actor: fixture.actor,
      definition: {
        workspace_id: fixture.workspace.id,
        policy_key: "fixture-temporal-license",
        policy_version: 1,
        approval_evidence_hash: hash("temporal-license-evidence"),
        usages: [
          { usage_purpose: "client-mention-list", decision: "allowed" },
          { usage_purpose: "client-text-or-excerpt", decision: "allowed" }
        ]
      },
      idempotencyKey: hash("temporal-license-create"),
      effectiveFrom: temporalStart,
      effectiveTo: licensingEnds
    });
    for (const [objectKind, objectId, seed] of [
      ["retention-policy", temporalRetention.policy_id, "temporal-retention-activate"],
      ["licensing-policy", temporalLicense.policy_id, "temporal-license-activate"]
    ] as const) {
      await activateSignalDataGovernanceObjectV1({
        queryable: client,
        workspaceId: fixture.workspace.id,
        actor: fixture.actor,
        objectKind,
        objectId,
        idempotencyKey: hash(seed)
      });
    }
    const temporalBinding = await ensureSignalProvenancePolicyBindingDraftV1({
      queryable: client,
      actor: fixture.actor,
      definition: {
        workspace_id: fixture.workspace.id,
        data_source_id: IDS.sourceUnknown,
        import_batch_id: null,
        binding_version: 2,
        quality_policy_id: authorities.qualityPolicyId,
        retention_policy_id: temporalRetention.policy_id,
        licensing_policy_id: temporalLicense.policy_id
      },
      idempotencyKey: hash("temporal-binding-create"),
      effectiveFrom: temporalStart,
      effectiveTo: bindingEnds
    });
    await activateSignalDataGovernanceObjectV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      objectKind: "provenance-binding",
      objectId: temporalBinding.binding_id,
      idempotencyKey: hash("temporal-binding-activate")
    });
    const beforeEffectiveFrom = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id,
      moduleKey: "mentions",
      reconcileMemberships: true,
      queryable: client
    });
    assert.deepEqual(await row(client, `
      SELECT decision,reason_code FROM signal_data_governance_evaluation_items
      WHERE evaluation_id=$1::uuid AND mention_id=$2::uuid
    `, [beforeEffectiveFrom.governance_evaluation_id, IDS.governanceUnknownRoot]), {
      decision: "blocked", reason_code: "no_authorized_provenance"
    });
    await waitPast(temporalStart);
    await assert.rejects(runSignalBrandDraftShadowV1({
      workspace: fixture.workspace, actor: fixture.actor, moduleKey: "mentions",
      filter: fixture.filter, queryable: client
    }), /unavailable|candidate/iu);
    const afterEffectiveFrom = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace, actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id, moduleKey: "mentions",
      reconcileMemberships: true, queryable: client
    });
    assert.equal(await scalar<string>(client, `SELECT reason_code FROM signal_data_governance_evaluation_items
      WHERE evaluation_id=$1::uuid AND mention_id=$2::uuid`, [
      afterEffectiveFrom.governance_evaluation_id, IDS.governanceUnknownRoot
    ]), "policy_eligible");
    await waitPast(retainUntil);
    await assert.rejects(runSignalBrandDraftShadowV1({
      workspace: fixture.workspace, actor: fixture.actor, moduleKey: "mentions",
      filter: fixture.filter, queryable: client
    }), /unavailable|candidate/iu);
    const afterRetention = await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace, actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id, moduleKey: "mentions",
      reconcileMemberships: true, queryable: client
    });
    assert.equal(await scalar<string>(client, `SELECT reason_code FROM signal_data_governance_evaluation_items
      WHERE evaluation_id=$1::uuid AND mention_id=$2::uuid`, [
      afterRetention.governance_evaluation_id, IDS.governanceUnknownRoot
    ]), "retention_expired");
    await waitPast(licensingEnds);
    await assert.rejects(runSignalBrandDraftShadowV1({
      workspace: fixture.workspace, actor: fixture.actor, moduleKey: "mentions",
      filter: fixture.filter, queryable: client
    }), /unavailable|candidate/iu);
    await reconcileSignalBrandPolicyCandidateV1({
      workspace: fixture.workspace, actor: fixture.actor,
      policyBundleId: firstDraft.policy_bundle_id, moduleKey: "mentions",
      reconcileMemberships: true, queryable: client
    });
    await waitPast(bindingEnds);
    await assert.rejects(runSignalBrandDraftShadowV1({
      workspace: fixture.workspace, actor: fixture.actor, moduleKey: "mentions",
      filter: fixture.filter, queryable: client
    }), /unavailable|candidate/iu);

    await expectSqlState(client, "23514", `
      INSERT INTO signal_population_policy_entities (
        workspace_id, policy_bundle_id, scope, entity_type, entity_id
      ) VALUES ($1::uuid, $2::uuid, 'primary_brand', 'brand', $3::uuid)
    `, [fixture.workspace.id, firstDraft.policy_bundle_id, IDS.otherBrand]);
    assert.deepEqual(await operationalV1State(client, fixture.workspace.id), v1Before);
  } finally {
    await client.end();
  }
});

test("module/view populations isolate divergent licensing in every reconciliation order", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 71);
    const fixture = await seedFixture(client);
    const draft = await ensureSignalBrandPolicyDraftV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    const authorities = await createGovernanceAuthorities(client, fixture);
    await resolveSignalBrandPolicyDraftGovernanceV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: draft.policy_bundle_id,
      qualityPolicyId: authorities.qualityPolicyId,
      queryable: client
    });
    await seedDivergentModuleLicense(client, fixture, authorities);
    const semanticBaseBefore = await semanticBaseState(client, fixture.workspace.id);
    const v1Before = await operationalV1State(client, fixture.workspace.id);

    const reconcileReady = async (moduleKey: "brand-monitoring" | "mentions" | "topics-narratives") => {
      let result = await reconcileSignalBrandPolicyCandidateV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        policyBundleId: draft.policy_bundle_id,
        moduleKey,
        reconcileMemberships: true,
        queryable: client
      });
      if (!result.blocking_reasons.includes("data-watermark-not-available")) return result;
      await client.query(`
        INSERT INTO signal_data_watermarks (
          workspace_id,study_corpus_id,population_id,data_source_id,source_key,
          corpus_revision,max_observed_at,accepted_at,materialized_at,
          source_freshness_state,data_freshness_state
        ) VALUES ($1::uuid,NULL,$2::uuid,$3::uuid,$4,1,
          now(),now(),now(),'fresh','fresh')
      `, [fixture.workspace.id, result.population_id, IDS.sourceDivergent, `governance-${moduleKey}`]);
      result = await reconcileSignalBrandPolicyCandidateV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        policyBundleId: draft.policy_bundle_id,
        moduleKey,
        reconcileMemberships: true,
        queryable: client
      });
      return result;
    };

    const monitoring = await reconcileReady("brand-monitoring");
    const mentions = await reconcileReady("mentions");
    const topics = await reconcileReady("topics-narratives");
    assert.equal(monitoring.compilation_status, "ready");
    assert.equal(mentions.compilation_status, "ready");
    assert.equal(topics.compilation_status, "ready");
    assert.equal(monitoring.actual_membership_count, 5);
    assert.equal(mentions.actual_membership_count, 4);
    assert.equal(topics.actual_membership_count, 5);
    const evidenceCounts: number[] = [];
    for (const result of [monitoring, mentions, topics]) {
      assert.equal(result.expected_membership_count, result.actual_membership_count);
      assert.equal(result.expected_membership_digest, result.actual_membership_digest);
      assert.equal(result.authorized_root_count, result.actual_membership_count);
      assert.match(result.source_watermark_hash, /^sha256:[0-9a-f]{64}$/u);
      assert.ok(result.source_watermark_at);
      assert.match(result.governance_digest ?? "", /^sha256:[0-9a-f]{64}$/u);
      assert.ok(result.governance_evaluation_id);
      const evidence = await row<{
        evidence_rows: number;
        canonical_roots: number;
        included_roots: number;
      }>(client, `
        SELECT count(*)::int AS evidence_rows,
          count(DISTINCT item.mention_id)::int AS canonical_roots,
          count(*) FILTER (WHERE item.decision='included')::int AS included_roots
        FROM signal_data_governance_evaluation_items item
        WHERE item.evaluation_id=$1::uuid
      `, [result.governance_evaluation_id]);
      assert.equal(evidence.evidence_rows, evidence.canonical_roots);
      assert.equal(evidence.included_roots, result.actual_membership_count);
      evidenceCounts.push(evidence.evidence_rows);
    }
    assert.equal(new Set(evidenceCounts).size, 1);
    assert.deepEqual(monitoring.usage_purposes, ["client-derived-metrics"]);
    assert.deepEqual(mentions.usage_purposes, ["client-mention-list", "client-text-or-excerpt"]);
    assert.deepEqual(topics.usage_purposes, ["client-derived-metrics"]);
    assert.equal(monitoring.licensing_blocked_count, 0);
    assert.equal(mentions.licensing_blocked_count, 1);
    assert.equal(topics.licensing_blocked_count, 0);
    assert.equal(new Set([
      monitoring.population_id,
      mentions.population_id,
      topics.population_id
    ]).size, 3);
    assert.notEqual(monitoring.actual_membership_digest, mentions.actual_membership_digest);
    assert.equal(monitoring.actual_membership_digest, topics.actual_membership_digest);
    assert.notEqual(monitoring.compiled_plan_hash, topics.compiled_plan_hash);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_population_policy_compilations
      WHERE workspace_id=$1::uuid AND policy_bundle_id=$2::uuid
        AND is_current AND compilation_status='ready'
        AND NOT EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
          WHERE invalidation.policy_compilation_id=signal_population_policy_compilations.id)
    `, [fixture.workspace.id, draft.policy_bundle_id]), 3);

    const evidenceReadScope = (
      result: typeof monitoring
    ): SignalOperationalReadScopeV1 => ({
      descriptor: {
        contract_version: "signal-workspace-data-plane-v1" as const,
        workspace_id: fixture.workspace.id,
        mode: "governed" as const,
        visible_source: "governed_population" as const,
        policy_key: "operational-primary-brand",
        population: {
          id: result.population_id,
          key: `${result.module_key}-brand-governed`,
          version: result.population_version,
          definition_hash: result.population_definition_hash,
          acceptance_status: "included" as const,
          allowed_scopes: ["primary_brand"]
        },
        legacy_corpus_id: null
      },
      workspace: fixture.workspace,
      mode: "governed" as const,
      visibleSource: "governed_population" as const,
      legacyCorpus: null,
      population: {
        id: result.population_id,
        key: `${result.module_key}-brand-governed`,
        version: result.population_version,
        definition_hash: result.population_definition_hash,
        acceptance_status: "included" as const,
        allowed_scopes: ["primary_brand"],
        quality_contract_status: "resolved",
        quality_policy_key: "fixture-quality",
        quality_policy_version: 1,
        min_quality_score: null,
        required_quality_flags: [],
        forbidden_quality_flags: [],
        period_start: null,
        period_end: null,
        timezone: null
      }
    });
    const monitoringEvidence = await loadSignalClientEvidenceAccessV1({
      workspace: fixture.workspace,
      metricReadScope: evidenceReadScope(monitoring),
      evidenceReadScope: evidenceReadScope(mentions),
      filter: fixture.filter,
      queryable: client
    });
    const topicsEvidence = await loadSignalClientEvidenceAccessV1({
      workspace: fixture.workspace,
      metricReadScope: evidenceReadScope(topics),
      evidenceReadScope: evidenceReadScope(mentions),
      filter: fixture.filter,
      queryable: client
    });
    assert.deepEqual(monitoringEvidence, {
      state: "available",
      metric_denominator_count: 5,
      evidence_constituent_count: 5,
      evidence_visible_count: 4,
      evidence_withheld_count: 1,
      reason: null
    });
    assert.deepEqual(topicsEvidence, monitoringEvidence);
    assert.deepEqual(await loadSignalClientEvidenceAccessV1({
      workspace: fixture.workspace,
      metricReadScope: evidenceReadScope(topics),
      evidenceReadScope: null,
      filter: fixture.filter,
      queryable: client
    }), {
      state: "not_available",
      metric_denominator_count: 5,
      evidence_constituent_count: 5,
      evidence_visible_count: null,
      evidence_withheld_count: null,
      reason: "mentions_capability_not_available"
    });
    assert.deepEqual(await rows(client, `
      SELECT compilation.module_key,
        EXISTS (SELECT 1 FROM signal_population_memberships membership
          WHERE membership.population_id=compilation.population_id
            AND membership.mention_id=$3::uuid
            AND membership.membership_status='included'
            AND membership.removed_at IS NULL) AS includes_divergent_root
      FROM signal_population_policy_compilations compilation
      WHERE compilation.workspace_id=$1::uuid AND compilation.policy_bundle_id=$2::uuid
        AND compilation.is_current
      ORDER BY compilation.module_key
    `, [fixture.workspace.id, draft.policy_bundle_id, IDS.divergentLicenseRoot]), [
      { module_key: "brand-monitoring", includes_divergent_root: true },
      { module_key: "mentions", includes_divergent_root: false },
      { module_key: "topics-narratives", includes_divergent_root: true }
    ]);

    const reverse = [
      await reconcileReady("topics-narratives"),
      await reconcileReady("mentions"),
      await reconcileReady("brand-monitoring")
    ];
    assert.deepEqual(reverse.map((result) => result.policy_compilation_id), [
      topics.policy_compilation_id,
      mentions.policy_compilation_id,
      monitoring.policy_compilation_id
    ]);
    assert.deepEqual(reverse.map((result) => result.actual_membership_count), [5, 4, 5]);

    const divergentLicenseId = await scalar<string>(client, `
      SELECT licensing_policy_id::text FROM signal_provenance_policy_bindings
      WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid
        AND import_batch_id IS NULL AND status='active'
    `, [fixture.workspace.id, IDS.sourceDivergent]);
    const invalidated = await scalar<number>(client, `
      SELECT invalidate_signal_data_governance_compilations(
        $1::uuid,'licensing-policy-changed','licensing-policy',$2::text,
        NULL,NULL,$2::uuid,NULL,ARRAY['client-mention-list']::text[]
      )
    `, [fixture.workspace.id, divergentLicenseId]);
    assert.equal(invalidated, 1);
    assert.deepEqual(await rows(client, `
      SELECT compilation.module_key,count(invalidation.id)::int AS invalidations
      FROM signal_population_policy_compilations compilation
      LEFT JOIN signal_data_governance_invalidations invalidation
        ON invalidation.policy_compilation_id=compilation.id
      WHERE compilation.id=ANY($1::uuid[])
      GROUP BY compilation.module_key ORDER BY compilation.module_key
    `, [[monitoring.policy_compilation_id, mentions.policy_compilation_id, topics.policy_compilation_id]]), [
      { module_key: "brand-monitoring", invalidations: 0 },
      { module_key: "mentions", invalidations: 1 },
      { module_key: "topics-narratives", invalidations: 0 }
    ]);
    const mentionsRecompiled = await reconcileReady("mentions");
    assert.notEqual(mentionsRecompiled.policy_compilation_id, mentions.policy_compilation_id);
    assert.equal(mentionsRecompiled.actual_membership_count, 4);
    assert.equal((await reconcileReady("brand-monitoring")).policy_compilation_id,
      monitoring.policy_compilation_id);
    assert.equal((await reconcileReady("topics-narratives")).policy_compilation_id,
      topics.policy_compilation_id);

    const bindingPreflight = await loadSignalGovernedBrandBindingSetPreflightV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    const promoted = await promoteSignalGovernedBrandBindingSetV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      expectedSetDigest: bindingPreflight.set_digest,
      idempotencyKey: "divergent-shadow-binding-set",
      queryable: client
    });
    assert.equal(promoted.items.length, 3);

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const normalShadow = await runSignalGovernedBrandBindingShadowV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      filter: fixture.filter,
      queryable: client
    });
    await client.query("COMMIT");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const reverseShadow = await runSignalGovernedBrandBindingShadowV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      filter: fixture.filter,
      executionOrder: ["topics-narratives", "mentions", "brand-monitoring"],
      queryable: client
    });
    await client.query("COMMIT");
    assert.equal(normalShadow.public_evidence.gate_passed, true,
      JSON.stringify(normalShadow.public_evidence, null, 2));
    assert.equal(reverseShadow.public_evidence.gate_passed, true,
      JSON.stringify(reverseShadow.public_evidence, null, 2));
    assert.equal(
      reverseShadow.public_evidence.evidence_digest,
      normalShadow.public_evidence.evidence_digest
    );
    assert.deepEqual(
      normalShadow.public_evidence.modules.map((module) => [
        module.module_key,
        module.denominator,
        module.population.membership_digest
      ]),
      [
        ["brand-monitoring", 5, monitoring.actual_membership_digest],
        ["mentions", 4, mentionsRecompiled.actual_membership_digest],
        ["topics-narratives", 5, topics.actual_membership_digest]
      ]
    );
    assert.equal(normalShadow.public_evidence.cross_module.distinct_population_refs, true);
    assert.equal(normalShadow.public_evidence.cross_module.operational_pointer_followed, false);
    assert.equal(normalShadow.public_evidence.cross_module.unexplained_count, 0);
    assert.ok(normalShadow.public_evidence.modules.every((module) =>
      module.invariants.alias_memberships === 0
      && module.invariants.policy_sql_matches_memberships
      && module.invariants.durable_watermark
      && module.reader_checks.pagination_cursor_isolated
    ));
    assert.doesNotMatch(
      JSON.stringify(normalShadow.public_evidence),
      /69000000-0000-4000-8000-[0-9]{12}/u,
      "sanitized evidence must not contain raw fixture identities"
    );

    const invalidationKey = hash("divergent-shadow-invalid-current");
    await client.query(`
      INSERT INTO signal_data_governance_invalidations (
        workspace_id,policy_compilation_id,reason_code,
        object_kind,object_identity_hash,idempotency_key
      ) VALUES ($1::uuid,$2::uuid,'watermark-changed',
        'watermark',$3,$3)
    `, [fixture.workspace.id, mentionsRecompiled.policy_compilation_id, invalidationKey]);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await assert.rejects(
      runSignalGovernedBrandBindingShadowV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        filter: fixture.filter,
        queryable: client
      }),
      /unavailable|binding/iu,
      "an invalid current binding must fail closed instead of following the bridge"
    );
    await client.query("ROLLBACK");

    assert.deepEqual(await semanticBaseState(client, fixture.workspace.id), semanticBaseBefore);
    assert.deepEqual(await operationalV1State(client, fixture.workspace.id), v1Before);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid AND binding_status='current'
    `, [fixture.workspace.id]), 3);
  } finally {
    await client.end();
  }
});

test("governed brand bindings promote, withdraw to bridge and re-promote atomically", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 71);
    const fixture = await seedFixture(client);
    const v1Before = await operationalV1State(client, fixture.workspace.id);
    const baseBefore = await semanticBaseState(client, fixture.workspace.id);
    const pointerBefore = await row(client, `
      SELECT id::text,population_id::text,purpose,promoted_at::text
      FROM signal_workspace_population_pointers
      WHERE workspace_id=$1::uuid AND purpose='operational'
    `, [fixture.workspace.id]);
    const draft = await ensureSignalBrandPolicyDraftV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    const authorityExpiry = new Date(Date.now() + 12_000).toISOString();
    const authorities = await createGovernanceAuthorities(client, fixture, {
      effectiveTo: authorityExpiry
    });
    await resolveSignalBrandPolicyDraftGovernanceV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      policyBundleId: draft.policy_bundle_id,
      qualityPolicyId: authorities.qualityPolicyId,
      queryable: client
    });
    const reconcileReady = async (
      moduleKey: "brand-monitoring" | "mentions" | "topics-narratives"
    ) => {
      let result = await reconcileSignalBrandPolicyCandidateV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        policyBundleId: draft.policy_bundle_id,
        moduleKey,
        reconcileMemberships: true,
        queryable: client
      });
      if (result.blocking_reasons.includes("data-watermark-not-available")) {
        await client.query(`
          INSERT INTO signal_data_watermarks (
            workspace_id,study_corpus_id,population_id,data_source_id,source_key,
            corpus_revision,max_observed_at,accepted_at,materialized_at,
            source_freshness_state,data_freshness_state
          ) VALUES ($1::uuid,NULL,$2::uuid,$3::uuid,$4,1,
            now(),now(),now(),'fresh','fresh')
        `, [fixture.workspace.id, result.population_id, IDS.sourcePrimary, `binding-${moduleKey}`]);
        result = await reconcileSignalBrandPolicyCandidateV1({
          workspace: fixture.workspace,
          actor: fixture.actor,
          policyBundleId: draft.policy_bundle_id,
          moduleKey,
          reconcileMemberships: true,
          queryable: client
        });
      }
      assert.equal(result.compilation_status, "ready");
      assert.equal(result.governance_unknown_count, 0);
      return result;
    };
    const compiled = [];
    for (const moduleKey of ["brand-monitoring", "mentions", "topics-narratives"] as const) {
      compiled.push(await reconcileReady(moduleKey));
    }
    const compilationStateBefore = await rows(client, `
      SELECT id::text,population_id::text,module_key,view_key,compilation_status,
        is_current,membership_digest,compiled_plan_hash
      FROM signal_population_policy_compilations
      WHERE workspace_id=$1::uuid AND policy_bundle_id=$2::uuid AND is_current
      ORDER BY module_key
    `, [fixture.workspace.id, draft.policy_bundle_id]);
    assert.equal(compilationStateBefore.length, 3);
    const initialPreflight = await loadSignalGovernedBrandBindingSetPreflightV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    assert.equal(initialPreflight.current_binding_count, 0);

    await client.query(`
      CREATE OR REPLACE FUNCTION fixture_fail_second_binding()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.module_key='mentions' THEN
          RAISE EXCEPTION 'fixture second promotion failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fixture_fail_second_binding
      BEFORE INSERT ON signal_governed_view_bindings
      FOR EACH ROW EXECUTE FUNCTION fixture_fail_second_binding();
    `);
    await assert.rejects(
      promoteSignalGovernedBrandBindingSetV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        expectedSetDigest: initialPreflight.set_digest,
        idempotencyKey: "binding-set-failure-atomic",
        queryable: client
      }),
      /fixture second promotion failure/iu
    );
    await client.query(`
      DROP TRIGGER fixture_fail_second_binding ON signal_governed_view_bindings;
      DROP FUNCTION fixture_fail_second_binding();
    `);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid
    `, [fixture.workspace.id]), 0);
    assert.equal(await scalar<string>(client, `
      SELECT status FROM signal_population_policy_bundles WHERE id=$1::uuid
    `, [draft.policy_bundle_id]), "draft");

    const promoted = await promoteSignalGovernedBrandBindingSetV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      expectedSetDigest: initialPreflight.set_digest,
      idempotencyKey: "binding-set-promote-first",
      queryable: client
    });
    assert.equal(promoted.replayed, false);
    assert.equal(promoted.items.length, 3);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid AND binding_status='current'
    `, [fixture.workspace.id]), 3);
    assert.equal(await scalar<string>(client, `
      SELECT status FROM signal_population_policy_bundles WHERE id=$1::uuid
    `, [draft.policy_bundle_id]), "active");
    for (const moduleKey of ["brand-monitoring", "mentions", "topics-narratives"] as const) {
      const descriptor = await resolveSignalGovernedViewV1(
        fixture.workspace,
        { module_key: moduleKey, view_key: "brand" }
      );
      assert.equal(descriptor.resolution_source, "governed-binding");
      assert.equal(
        descriptor.population?.population_id,
        compiled.find((entry) => entry.module_key === moduleKey)!.population_id
      );
    }
    const transactionResolverStore = createPostgresSignalGovernedViewResolverStore(
      async <Row>(sql: string, values: unknown[]) => {
        const result = await client.query(sql, values);
        return result.rows as Row[];
      }
    );
    const assertResolverFailsClosedAfterMutation = async (args: {
      label: string;
      sql: string;
      values?: unknown[];
      inspect?: (row: NonNullable<Awaited<ReturnType<
        typeof transactionResolverStore.loadCurrentBinding
      >>>) => void;
    }) => {
      await client.query("BEGIN");
      try {
        for (const statement of args.sql.split(";").map((part) => part.trim()).filter(Boolean)) {
          await client.query(
            statement,
            /\$[1-9][0-9]*/u.test(statement)
              ? (args.values ?? [fixture.workspace.id])
              : []
          );
        }
        const rawBinding = await transactionResolverStore.loadCurrentBinding({
          workspaceId: fixture.workspace.id,
          moduleKey: "mentions",
          viewKey: "brand"
        });
        assert.ok(rawBinding, `${args.label}: the invalid current authority must remain observable`);
        args.inspect?.(rawBinding);
        await assert.rejects(
          resolveSignalGovernedViewV1(
            fixture.workspace,
            { module_key: "mentions", view_key: "brand" },
            transactionResolverStore
          ),
          /unavailable/iu,
          `${args.label}: an invalid current binding must fail closed instead of following the bridge`
        );
      } finally {
        await client.query("ROLLBACK");
      }
    };
    await assertResolverFailsClosedAfterMutation({
      label: "inactive bundle",
      sql: `
        ALTER TABLE signal_population_policy_bundles DISABLE TRIGGER USER;
        UPDATE signal_population_policy_bundles
        SET status='draft',activated_by_user_id=NULL,activated_at=NULL
        WHERE id=(
          SELECT policy_bundle_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      inspect: (row) => assert.equal(row.policy_status, "draft")
    });
    await assertResolverFailsClosedAfterMutation({
      label: "expired bundle",
      sql: `
        ALTER TABLE signal_population_policy_bundles DISABLE TRIGGER USER;
        UPDATE signal_population_policy_bundles
        SET effective_from=statement_timestamp() - interval '2 days',
            effective_to=statement_timestamp() - interval '1 day'
        WHERE id=(
          SELECT policy_bundle_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      inspect: (row) => assert.ok(row.policy_effective_to)
    });
    await assertResolverFailsClosedAfterMutation({
      label: "future binding",
      sql: `
        UPDATE signal_governed_view_bindings
        SET effective_from = statement_timestamp() + interval '1 day'
        WHERE workspace_id=$1::uuid AND module_key='mentions'
          AND view_key='brand' AND binding_status='current'
      `,
      inspect: (row) => assert.ok(Date.parse(row.binding_effective_from) > Date.parse(row.evaluation_now))
    });
    await assertResolverFailsClosedAfterMutation({
      label: "expired binding",
      sql: `
        ALTER TABLE signal_governed_view_bindings DISABLE TRIGGER USER;
        ALTER TABLE signal_governed_view_bindings
          DROP CONSTRAINT signal_governed_view_binding_window;
        UPDATE signal_governed_view_bindings
        SET effective_to = statement_timestamp() - interval '1 second'
        WHERE workspace_id=$1::uuid AND module_key='mentions'
          AND view_key='brand' AND binding_status='current'
      `,
      inspect: (row) => assert.ok(row.binding_effective_to)
    });
    await assertResolverFailsClosedAfterMutation({
      label: "stale compilation",
      sql: `
        ALTER TABLE signal_population_policy_compilations DISABLE TRIGGER USER;
        UPDATE signal_population_policy_compilations
        SET compilation_status='stale', blocking_reasons=ARRAY['fixture-stale']::text[]
        WHERE id=(
          SELECT policy_compilation_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      inspect: (row) => assert.equal(row.compilation_status, "stale")
    });
    await assertResolverFailsClosedAfterMutation({
      label: "invalidated compilation",
      sql: `
        INSERT INTO signal_data_governance_invalidations (
          workspace_id,policy_compilation_id,reason_code,
          object_kind,object_identity_hash,idempotency_key
        ) SELECT $1::uuid,binding.policy_compilation_id,'watermark-changed',
          'watermark',$2,$2
        FROM signal_governed_view_bindings binding
        WHERE binding.workspace_id=$1::uuid AND binding.module_key='mentions'
          AND binding.view_key='brand' AND binding.binding_status='current'
      `,
      values: [fixture.workspace.id, hash("resolver-invalidated-compilation")],
      inspect: (row) => assert.equal(row.compilation_invalidated, true)
    });
    await assertResolverFailsClosedAfterMutation({
      label: "expired compilation",
      sql: `
        ALTER TABLE signal_population_policy_compilations DISABLE TRIGGER USER;
        ALTER TABLE signal_population_policy_compilations
          DROP CONSTRAINT signal_population_policy_compilation_transition;
        UPDATE signal_population_policy_compilations
        SET next_policy_transition_at=statement_timestamp() - interval '1 second'
        WHERE id=(
          SELECT policy_compilation_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      inspect: (row) => assert.equal(row.compilation_temporally_valid, false)
    });
    await assertResolverFailsClosedAfterMutation({
      label: "membership digest mismatch",
      sql: `
        ALTER TABLE signal_population_policy_compilations DISABLE TRIGGER USER;
        UPDATE signal_population_policy_compilations
        SET membership_digest=$2
        WHERE id=(
          SELECT policy_compilation_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      values: [fixture.workspace.id, hash("resolver-wrong-membership-digest")],
      inspect: (row) => assert.notEqual(
        row.compilation_membership_digest,
        row.membership_digest
      )
    });
    await assertResolverFailsClosedAfterMutation({
      label: "incompatible derivation",
      sql: `
        ALTER TABLE signal_governed_view_population_derivations DISABLE TRIGGER USER;
        UPDATE signal_governed_view_population_derivations
        SET compiled_plan_hash=$2
        WHERE workspace_id=$1::uuid AND module_key='mentions' AND view_key='brand'
      `,
      values: [fixture.workspace.id, hash("resolver-wrong-derivation-plan")],
      inspect: (row) => assert.equal(row.population_derivation_valid, false)
    });
    await assertResolverFailsClosedAfterMutation({
      label: "missing governance watermark",
      sql: `
        ALTER TABLE signal_population_policy_compilations DISABLE TRIGGER USER;
        UPDATE signal_population_policy_compilations
        SET governance_data_watermark_id=NULL
        WHERE id=(
          SELECT policy_compilation_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      inspect: (row) => assert.equal(row.governance_data_watermark_id, null)
    });
    const otherWorkspaceIdForResolver = await scalar<string>(client, `
      SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid
    `, [IDS.otherBrand]);
    await assertResolverFailsClosedAfterMutation({
      label: "cross-workspace governance watermark",
      sql: `
        ALTER TABLE signal_population_policy_compilations DISABLE TRIGGER USER;
        WITH foreign_population AS (
          SELECT id FROM signal_population_definitions
          WHERE workspace_id=$2::uuid ORDER BY version LIMIT 1
        ), foreign_watermark AS (
          INSERT INTO signal_data_watermarks (
            workspace_id,study_corpus_id,population_id,data_source_id,source_key,
            corpus_revision,max_observed_at,accepted_at,materialized_at,
            source_freshness_state,data_freshness_state
          ) SELECT $2::uuid,NULL,id,NULL,'resolver-cross-workspace',1,
            now(),now(),now(),'fresh','fresh'
          FROM foreign_population RETURNING id
        )
        UPDATE signal_population_policy_compilations
        SET governance_data_watermark_id=(SELECT id FROM foreign_watermark)
        WHERE id=(
          SELECT policy_compilation_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      values: [fixture.workspace.id, otherWorkspaceIdForResolver],
      inspect: (row) => assert.notEqual(
        row.governance_data_watermark_workspace_id,
        fixture.workspace.id
      )
    });
    await assertResolverFailsClosedAfterMutation({
      label: "cross-workspace compilation",
      sql: `
        ALTER TABLE signal_population_policy_compilations DISABLE TRIGGER USER;
        UPDATE signal_population_policy_compilations
        SET workspace_id=$2::uuid
        WHERE id=(
          SELECT policy_compilation_id FROM signal_governed_view_bindings
          WHERE workspace_id=$1::uuid AND module_key='mentions'
            AND view_key='brand' AND binding_status='current'
        )
      `,
      values: [fixture.workspace.id, otherWorkspaceIdForResolver],
      inspect: (row) => assert.equal(row.compilation_workspace_id, otherWorkspaceIdForResolver)
    });
    assert.equal(await transactionResolverStore.loadCurrentBinding({
      workspaceId: otherWorkspaceIdForResolver,
      moduleKey: "mentions",
      viewKey: "brand"
    }), null, "a binding from another workspace must not cross the resolver WHERE boundary");
    const replayedPromotion = await promoteSignalGovernedBrandBindingSetV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      expectedSetDigest: initialPreflight.set_digest,
      idempotencyKey: "binding-set-promote-first",
      queryable: client
    });
    assert.equal(replayedPromotion.replayed, true);
    assert.deepEqual(replayedPromotion.items, promoted.items);
    await assert.rejects(
      promoteSignalGovernedBrandBindingSetV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        expectedSetDigest: hash("incompatible-set"),
        idempotencyKey: "binding-set-promote-first",
        queryable: client
      }),
      /reused incompatibly/iu
    );

    const concurrentPreflight = await loadSignalGovernedBrandBindingSetPreflightV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    const [concurrentA, concurrentB] = await Promise.all([
      promoteSignalGovernedBrandBindingSetV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        expectedSetDigest: concurrentPreflight.set_digest,
        idempotencyKey: "binding-set-concurrent-same",
      }),
      promoteSignalGovernedBrandBindingSetV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        expectedSetDigest: concurrentPreflight.set_digest,
        idempotencyKey: "binding-set-concurrent-same",
      })
    ]);
    assert.deepEqual(concurrentA.items, concurrentB.items);
    assert.equal([concurrentA.replayed, concurrentB.replayed].filter(Boolean).length, 1);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_brand_binding_set_operations
      WHERE workspace_id=$1::uuid AND idempotency_key=$2
    `, [fixture.workspace.id, hash("binding-set-concurrent-same")]), 1);

    const withdrawPreflight = await loadSignalGovernedBrandBindingSetPreflightV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    const withdrawn = await withdrawSignalGovernedBrandBindingSetToBridgeV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      expectedSetDigest: withdrawPreflight.set_digest,
      idempotencyKey: "binding-set-withdraw-first",
      queryable: client
    });
    assert.equal(withdrawn.items.length, 3);
    assert.ok(withdrawn.items.every((item) => item.previous_binding_id && !item.next_binding_id));
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid AND binding_status='current'
    `, [fixture.workspace.id]), 0);
    for (const moduleKey of ["brand-monitoring", "mentions", "topics-narratives"] as const) {
      const descriptor = await resolveSignalGovernedViewV1(
        fixture.workspace,
        { module_key: moduleKey, view_key: "brand" }
      );
      assert.equal(descriptor.resolution_source, "operational-brand-bridge");
    }
    const withdrawnReplay = await withdrawSignalGovernedBrandBindingSetToBridgeV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      expectedSetDigest: withdrawPreflight.set_digest,
      idempotencyKey: "binding-set-withdraw-first",
      queryable: client
    });
    assert.equal(withdrawnReplay.replayed, true);
    assert.deepEqual(withdrawnReplay.items, withdrawn.items);

    await client.query("BEGIN");
    try {
      await client.query(`
        INSERT INTO signal_data_governance_invalidations (
          workspace_id,policy_compilation_id,reason_code,
          object_kind,object_identity_hash,idempotency_key
        ) VALUES ($1::uuid,$2::uuid,'watermark-changed',
          'watermark',$3,$4)
      `, [
        fixture.workspace.id,
        compiled[0]!.policy_compilation_id,
        hash("invalidated-object"),
        hash("invalidated-idempotency")
      ]);
      await assert.rejects(
        loadSignalGovernedBrandBindingSetPreflightV1({
          workspace: fixture.workspace,
          actor: fixture.actor,
          queryable: client
        }),
        /preflight failed/iu
      );
    } finally {
      await client.query("ROLLBACK");
    }

    await client.query("BEGIN");
    try {
      const currentCompilationId = await scalar<string>(client, `
        SELECT id::text FROM signal_population_policy_compilations
        WHERE workspace_id=$1::uuid AND module_key='mentions'
          AND view_key='brand' AND is_current
      `, [fixture.workspace.id]);
      await replaceCurrentCompilationForFixture(client, currentCompilationId, {
        status: "stale",
        blockingReasons: ["fixture-stale"]
      });
      await assert.rejects(
        loadSignalGovernedBrandBindingSetPreflightV1({
          workspace: fixture.workspace,
          actor: fixture.actor,
          queryable: client
        }),
        /preflight failed/iu
      );
    } finally {
      await client.query("ROLLBACK");
    }

    const bridgePreflight = await loadSignalGovernedBrandBindingSetPreflightV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      queryable: client
    });
    const rePromoted = await promoteSignalGovernedBrandBindingSetV1({
      workspace: fixture.workspace,
      actor: fixture.actor,
      expectedSetDigest: bridgePreflight.set_digest,
      idempotencyKey: "binding-set-promote-second",
      queryable: client
    });
    assert.equal(rePromoted.items.length, 3);
    assert.ok(rePromoted.items.every((item, index) =>
      item.next_binding_id !== promoted.items[index]!.next_binding_id));
    const stale = withdrawPreflight.modules[0]!;
    await assert.rejects(
      client.query(`
        SELECT withdraw_signal_governed_view_binding(
          $1::uuid,$2,'brand',$3::uuid,$4::uuid,$5,$6
        )
      `, [
        fixture.workspace.id,
        stale.module_key,
        fixture.actor.id,
        stale.current_binding_id,
        stale.current_binding_digest,
        hash("stale-single-withdraw")
      ]),
      (error: unknown) => (error as { code?: string }).code === "40001"
    );

    const otherWorkspaceId = await scalar<string>(client, `
      SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid
    `, [IDS.otherBrand]);
    await assert.rejects(
      loadSignalGovernedBrandBindingSetPreflightV1({
        workspace: {
          ...fixture.workspace,
          id: otherWorkspaceId,
          organizationId: IDS.otherOrganization,
          slug: "brand-policy-other",
          subject: { type: "brand", id: IDS.otherBrand }
        },
        actor: fixture.actor,
        queryable: client
      }),
      /requires exactly three/iu
    );

    await waitPast(authorityExpiry);
    await assert.rejects(
      loadSignalGovernedBrandBindingSetPreflightV1({
        workspace: fixture.workspace,
        actor: fixture.actor,
        queryable: client
      }),
      /preflight failed/iu
    );

    assert.deepEqual(await operationalV1State(client, fixture.workspace.id), v1Before);
    assert.deepEqual(await semanticBaseState(client, fixture.workspace.id), baseBefore);
    assert.deepEqual(await row(client, `
      SELECT id::text,population_id::text,purpose,promoted_at::text
      FROM signal_workspace_population_pointers
      WHERE workspace_id=$1::uuid AND purpose='operational'
    `, [fixture.workspace.id]), pointerBefore);
    assert.deepEqual(await rows(client, `
      SELECT id::text,population_id::text,module_key,view_key,compilation_status,
        is_current,membership_digest,compiled_plan_hash
      FROM signal_population_policy_compilations
      WHERE workspace_id=$1::uuid AND policy_bundle_id=$2::uuid AND is_current
      ORDER BY module_key
    `, [fixture.workspace.id, draft.policy_bundle_id]), compilationStateBefore);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_workspace_population_pointers
      WHERE workspace_id=$1::uuid AND population_id IN (
        SELECT resolved_population_id FROM signal_governed_view_population_derivations
        WHERE workspace_id=$1::uuid
      )
    `, [fixture.workspace.id]), 0);
    assert.deepEqual(await rows(client, `
      SELECT action,count(*)::int AS events
      FROM signal_governed_view_binding_events
      WHERE workspace_id=$1::uuid
      GROUP BY action ORDER BY action
    `, [fixture.workspace.id]), [
      { action: "promote", events: 9 },
      { action: "withdraw-to-bridge", events: 3 }
    ]);
  } finally {
    await client.end();
  }
});

async function createGovernanceAuthorities(
  client: pg.Client,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  options?: { effectiveTo?: string }
) {
  const quality = await ensureSignalQualityPolicyDraftV1({
    queryable: client,
    organizationId: IDS.organization,
    actor: fixture.actor,
    definition: {
      workspace_id: fixture.workspace.id,
      policy_key: "fixture-brand-quality",
      policy_version: 1,
      min_quality_score: 5,
      required_quality_flags: [],
      forbidden_quality_flags: [],
      canonical_root_disposition: "evaluate"
    },
    idempotencyKey: hash("quality-create"),
    effectiveTo: options?.effectiveTo
  });
  const retention = await ensureSignalRetentionPolicyDraftV1({
    queryable: client,
    organizationId: IDS.organization,
    actor: fixture.actor,
    definition: {
      workspace_id: fixture.workspace.id,
      policy_key: "fixture-retention",
      policy_version: 1,
      retention_state: "allowed",
      retention_mode: "indefinite",
      retain_until: null,
      expiry_action: "block_use",
      approval_evidence_hash: hash("retention-evidence")
    },
    idempotencyKey: hash("retention-create"),
    effectiveTo: options?.effectiveTo
  });
  const licensing = await ensureSignalLicensingPolicyDraftV1({
    queryable: client,
    organizationId: IDS.organization,
    actor: fixture.actor,
    definition: {
      workspace_id: fixture.workspace.id,
      policy_key: "fixture-license",
      policy_version: 1,
      approval_evidence_hash: hash("license-evidence"),
      usages: [
        { usage_purpose: "client-derived-metrics", decision: "allowed" },
        { usage_purpose: "client-mention-list", decision: "allowed" },
        { usage_purpose: "client-text-or-excerpt", decision: "allowed" }
      ]
    },
    idempotencyKey: hash("license-create"),
    effectiveTo: options?.effectiveTo
  });
  for (const [objectKind, objectId, seed] of [
    ["quality-policy", quality.policy_id, "quality-activate"],
    ["retention-policy", retention.policy_id, "retention-activate"],
    ["licensing-policy", licensing.policy_id, "license-activate"]
  ] as const) {
    await activateSignalDataGovernanceObjectV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      objectKind,
      objectId,
      idempotencyKey: hash(seed)
    });
  }
  for (const [sourceId, seed] of [
    [IDS.sourcePrimary, "primary-binding"],
    [IDS.sourceCompetitor, "competitor-binding"]
  ] as const) {
    const binding = await ensureSignalProvenancePolicyBindingDraftV1({
      queryable: client,
      actor: fixture.actor,
      definition: {
        workspace_id: fixture.workspace.id,
        data_source_id: sourceId,
        import_batch_id: null,
        binding_version: 1,
        quality_policy_id: quality.policy_id,
        retention_policy_id: retention.policy_id,
        licensing_policy_id: licensing.policy_id
      },
      idempotencyKey: hash(`${seed}-create`)
    });
    await activateSignalDataGovernanceObjectV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      objectKind: "provenance-binding",
      objectId: binding.binding_id,
      idempotencyKey: hash(`${seed}-activate`)
    });
  }
  return {
    qualityPolicyId: quality.policy_id,
    retentionPolicyId: retention.policy_id,
    licensingPolicyId: licensing.policy_id
  };
}

async function seedDivergentModuleLicense(
  client: pg.Client,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  authorities: {
    qualityPolicyId: string;
    retentionPolicyId: string;
    licensingPolicyId: string;
  }
) {
  await client.query(`
    INSERT INTO data_sources (
      id,workspace_id,organization_id,brand_id,source_type,provider,
      connection_method,name,governed_scope,governed_entity_type,
      governed_entity_id,scope_policy_version,scope_review_status,
      scope_approved_by_user_id,scope_approval_source,scope_approved_at,role,status
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','fixture',
      'csv','Divergent module rights','primary_brand','brand',$4::uuid,
      'workspace-source-scope-v1','approved',$5::uuid,'fixture',now(),
      jsonb_build_object('ownership','workspace'),'active')
  `, [IDS.sourceDivergent, fixture.workspace.id, IDS.organization, IDS.brand, IDS.actor]);
  await client.query(`
    INSERT INTO import_batches (
      id,workspace_id,data_source_id,contributed_by_study_corpus_id,
      mention_type,entity_kind,entity_label,source_system,
      imported_by_user_id,status,source_file_name
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'brand','primary_brand',
      'Fixture brand','fixture',$5::uuid,'completed','divergent.csv')
  `, [IDS.batchDivergent, fixture.workspace.id, IDS.sourceDivergent, IDS.corpus, IDS.actor]);
  const licensing = await ensureSignalLicensingPolicyDraftV1({
    queryable: client,
    organizationId: IDS.organization,
    actor: fixture.actor,
    definition: {
      workspace_id: fixture.workspace.id,
      policy_key: "fixture-module-divergent-license",
      policy_version: 1,
      approval_evidence_hash: hash("module-divergent-license-evidence"),
      usages: [
        { usage_purpose: "client-derived-metrics", decision: "allowed" },
        { usage_purpose: "client-mention-list", decision: "prohibited" },
        { usage_purpose: "client-text-or-excerpt", decision: "prohibited" }
      ]
    },
    idempotencyKey: hash("module-divergent-license-create")
  });
  await activateSignalDataGovernanceObjectV1({
    queryable: client,
    workspaceId: fixture.workspace.id,
    actor: fixture.actor,
    objectKind: "licensing-policy",
    objectId: licensing.policy_id,
    idempotencyKey: hash("module-divergent-license-activate")
  });
  const binding = await ensureSignalProvenancePolicyBindingDraftV1({
    queryable: client,
    actor: fixture.actor,
    definition: {
      workspace_id: fixture.workspace.id,
      data_source_id: IDS.sourceDivergent,
      import_batch_id: null,
      binding_version: 1,
      quality_policy_id: authorities.qualityPolicyId,
      retention_policy_id: authorities.retentionPolicyId,
      licensing_policy_id: licensing.policy_id
    },
    idempotencyKey: hash("module-divergent-binding-create")
  });
  await activateSignalDataGovernanceObjectV1({
    queryable: client,
    workspaceId: fixture.workspace.id,
    actor: fixture.actor,
    objectKind: "provenance-binding",
    objectId: binding.binding_id,
    idempotencyKey: hash("module-divergent-binding-activate")
  });
  await insertRoot(
    client,
    fixture.workspace.id,
    IDS.divergentLicenseRoot,
    IDS.sourceDivergent,
    IDS.batchDivergent,
    8
  );
  const assertion = await createPrimaryAssertion(
    client,
    fixture.workspace.id,
    IDS.divergentLicenseRoot,
    IDS.sourceDivergent,
    IDS.batchDivergent,
    "module-divergent"
  );
  await reviewAssertion(client, assertion, "approve", "module-divergent-review");
}

async function seedGovernanceEdgeCases(
  client: pg.Client,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  authorities: {
    qualityPolicyId: string;
    retentionPolicyId: string;
    licensingPolicyId: string;
  }
) {
  await client.query(`
    INSERT INTO data_sources (
      id,workspace_id,organization_id,brand_id,source_type,provider,
      connection_method,name,governed_scope,governed_entity_type,
      governed_entity_id,scope_policy_version,scope_review_status,
      scope_approved_by_user_id,scope_approval_source,scope_approved_at,role,status
    ) SELECT source_id,$1::uuid,$2::uuid,$3::uuid,'social-listening','fixture',
      'csv',source_name,'competitor','competitor',$4::uuid,
      'workspace-source-scope-v1','approved',$5::uuid,'fixture',now(),
      jsonb_build_object('ownership','workspace'),'active'
    FROM (VALUES
      ($6::uuid,'Blocked provenance'),($7::uuid,'Allowed provenance'),
      ($8::uuid,'Expired provenance'),($9::uuid,'Unknown provenance')
    ) source(source_id,source_name)
  `, [
    fixture.workspace.id, IDS.organization, IDS.brand, IDS.competitor, IDS.actor,
    IDS.sourceBlocked, IDS.sourceAllowed, IDS.sourceExpired, IDS.sourceUnknown
  ]);
  await client.query(`
    INSERT INTO import_batches (
      id,workspace_id,data_source_id,contributed_by_study_corpus_id,
      mention_type,entity_kind,competitor_id,entity_label,source_system,
      imported_by_user_id,status,source_file_name
    ) SELECT batch_id,$1::uuid,source_id,$2::uuid,'competitor','competitor',$3::uuid,
      'Fixture competitor','fixture',$4::uuid,'completed',file_name
    FROM (VALUES
      ($5::uuid,$6::uuid,'blocked.csv'),($7::uuid,$8::uuid,'allowed.csv'),
      ($9::uuid,$10::uuid,'expired.csv'),($11::uuid,$12::uuid,'unknown.csv'),
      ($13::uuid,$8::uuid,'allowed-second.csv')
    ) batch(batch_id,source_id,file_name)
  `, [
    fixture.workspace.id, IDS.corpus, IDS.competitor, IDS.actor,
    IDS.batchBlocked, IDS.sourceBlocked, IDS.batchAllowed, IDS.sourceAllowed,
    IDS.batchExpired, IDS.sourceExpired, IDS.batchUnknown, IDS.sourceUnknown,
    IDS.batchAllowedSecond
  ]);

  const retentionAllowed = await scalar<string>(client, `
    SELECT retention_policy_id::text FROM signal_provenance_policy_bindings
    WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid
      AND import_batch_id IS NULL AND status='active'
  `, [fixture.workspace.id, IDS.sourcePrimary]);
  const licensingAllowed = await scalar<string>(client, `
    SELECT licensing_policy_id::text FROM signal_provenance_policy_bindings
    WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid
      AND import_batch_id IS NULL AND status='active'
  `, [fixture.workspace.id, IDS.sourcePrimary]);
  const licensingBlocked = await ensureSignalLicensingPolicyDraftV1({
    queryable: client,
    organizationId: IDS.organization,
    actor: fixture.actor,
    definition: {
      workspace_id: fixture.workspace.id,
      policy_key: "fixture-license-prohibited",
      policy_version: 1,
      approval_evidence_hash: hash("license-prohibited-evidence"),
      usages: [
        { usage_purpose: "client-derived-metrics", decision: "allowed" },
        { usage_purpose: "client-mention-list", decision: "allowed" },
        { usage_purpose: "client-text-or-excerpt", decision: "prohibited" }
      ]
    },
    idempotencyKey: hash("license-prohibited-create")
  });
  const retentionExpired = await ensureSignalRetentionPolicyDraftV1({
    queryable: client,
    organizationId: IDS.organization,
    actor: fixture.actor,
    definition: {
      workspace_id: fixture.workspace.id,
      policy_key: "fixture-retention-expired",
      policy_version: 1,
      retention_state: "allowed",
      retention_mode: "until",
      retain_until: "2025-01-01T00:00:00Z",
      expiry_action: "block_use",
      approval_evidence_hash: hash("retention-expired-evidence")
    },
    idempotencyKey: hash("retention-expired-create")
  });
  for (const [objectKind, objectId, seed] of [
    ["licensing-policy", licensingBlocked.policy_id, "license-prohibited-activate"],
    ["retention-policy", retentionExpired.policy_id, "retention-expired-activate"]
  ] as const) {
    await activateSignalDataGovernanceObjectV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      objectKind,
      objectId,
      idempotencyKey: hash(seed)
    });
  }
  const bindingSpecs = [
    { source: IDS.sourceBlocked, batch: null, retention: retentionAllowed, licensing: licensingBlocked.policy_id, seed: "blocked-source" },
    { source: IDS.sourceAllowed, batch: null, retention: retentionAllowed, licensing: licensingAllowed, seed: "allowed-source" },
    { source: IDS.sourceExpired, batch: null, retention: retentionExpired.policy_id, licensing: licensingAllowed, seed: "expired-source" },
    { source: IDS.sourceAllowed, batch: IDS.batchAllowed, retention: retentionAllowed, licensing: licensingBlocked.policy_id, seed: "blocked-import" }
  ] as const;
  for (const spec of bindingSpecs) {
    const binding = await ensureSignalProvenancePolicyBindingDraftV1({
      queryable: client,
      actor: fixture.actor,
      definition: {
        workspace_id: fixture.workspace.id,
        data_source_id: spec.source,
        import_batch_id: spec.batch,
        binding_version: spec.batch ? 2 : 1,
        quality_policy_id: authorities.qualityPolicyId,
        retention_policy_id: spec.retention,
        licensing_policy_id: spec.licensing
      },
      idempotencyKey: hash(`${spec.seed}-create`)
    });
    await activateSignalDataGovernanceObjectV1({
      queryable: client,
      workspaceId: fixture.workspace.id,
      actor: fixture.actor,
      objectKind: "provenance-binding",
      objectId: binding.binding_id,
      idempotencyKey: hash(`${spec.seed}-activate`)
    });
  }

  await insertRoot(client, fixture.workspace.id, IDS.provenanceMixedRoot, IDS.sourceBlocked, IDS.batchBlocked, 8);
  await insertAliasFor(client, fixture.workspace.id, IDS.provenanceMixedAlias, IDS.provenanceMixedRoot, IDS.sourceAllowed, IDS.batchAllowedSecond);
  await insertRoot(client, fixture.workspace.id, IDS.licensingBlockedRoot, IDS.sourceBlocked, IDS.batchBlocked, 8);
  await insertRoot(client, fixture.workspace.id, IDS.retentionExpiredRoot, IDS.sourceExpired, IDS.batchExpired, 8);
  await insertRoot(client, fixture.workspace.id, IDS.governanceUnknownRoot, IDS.sourceUnknown, IDS.batchUnknown, 8);
  await insertRoot(client, fixture.workspace.id, IDS.importOverrideRoot, IDS.sourceAllowed, IDS.batchAllowed, 8);
  await insertRoot(client, fixture.workspace.id, IDS.doubleAllowedRoot, IDS.sourceAllowed, IDS.batchAllowedSecond, 8);
  await insertAliasFor(client, fixture.workspace.id, IDS.doubleAllowedAlias, IDS.doubleAllowedRoot, IDS.sourceCompetitor, IDS.batchCompetitor);
  for (const [mentionId, sourceId, batchId, seed] of [
    [IDS.provenanceMixedRoot, IDS.sourceBlocked, IDS.batchBlocked, "61"],
    [IDS.licensingBlockedRoot, IDS.sourceBlocked, IDS.batchBlocked, "63"],
    [IDS.retentionExpiredRoot, IDS.sourceExpired, IDS.batchExpired, "65"],
    [IDS.governanceUnknownRoot, IDS.sourceUnknown, IDS.batchUnknown, "67"],
    [IDS.importOverrideRoot, IDS.sourceAllowed, IDS.batchAllowed, "69"],
    [IDS.doubleAllowedRoot, IDS.sourceAllowed, IDS.batchAllowedSecond, "6b"]
  ] as const) {
    const assertion = await createPrimaryAssertion(
      client, fixture.workspace.id, mentionId, sourceId, batchId, seed
    );
    await reviewAssertion(client, assertion, "approve", nextHex(seed));
  }
  return {
    rootIds: [
      IDS.provenanceMixedRoot, IDS.licensingBlockedRoot, IDS.retentionExpiredRoot,
      IDS.governanceUnknownRoot, IDS.importOverrideRoot, IDS.doubleAllowedRoot
    ]
  };
}

async function seedFixture(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status) VALUES
      ($1::uuid, 'brand-policy-org', 'Brand Policy org', 'Brand Policy org', 'active'),
      ($2::uuid, 'brand-policy-other', 'Other org', 'Other org', 'active')
  `, [IDS.organization, IDS.otherOrganization]);
  await client.query(`
    INSERT INTO users (id, email, full_name, user_type, primary_role, organization_id, status)
    VALUES ($1::uuid, 'brand-policy-admin@example.test', 'Brand Policy admin',
      'noisia_internal', 'noisia_admin', $2::uuid, 'active')
  `, [IDS.actor, IDS.organization]);
  await client.query(`
    INSERT INTO brands (
      id, organization_id, slug, name, display_name, countries, status
    ) VALUES
      ($1::uuid, $3::uuid, 'brand-policy-fixture', 'Brand Policy Fixture',
       'Brand Policy Fixture', ARRAY['MX']::char(2)[], 'active'),
      ($2::uuid, $4::uuid, 'brand-policy-other', 'Other Brand',
       'Other Brand', ARRAY['MX']::char(2)[], 'active')
  `, [IDS.brand, IDS.otherBrand, IDS.organization, IDS.otherOrganization]);
  const workspaceId = await scalar<string>(client, `
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [IDS.brand]);
  await client.query("UPDATE signal_workspaces SET timezone = 'UTC' WHERE id = $1::uuid", [workspaceId]);
  await client.query(`
    INSERT INTO methodologies (id, slug, name, version, status, manifest_yaml)
    VALUES ($1::uuid, 'brand-policy-method', 'Brand policy method', '1.0.0', 'active', '{}'::jsonb)
  `, [IDS.methodology]);
  await client.query(`
    INSERT INTO study_corpora (
      id, name, brand_id, methodology_id, methodology_version_at_creation,
      business_question, decision_to_inform, status, corpus_revision
    ) VALUES (
      $1::uuid, 'Brand policy compatibility corpus', $2::uuid, $3::uuid, '1.0.0',
      'Fixture question', 'Fixture decision', 'corpus_approved', 1
    )
  `, [IDS.corpus, IDS.brand, IDS.methodology]);
  await client.query(`
    INSERT INTO signal_workspace_corpora (workspace_id,study_corpus_id,role)
    VALUES ($1::uuid,$2::uuid,'operational')
    ON CONFLICT DO NOTHING
  `,[workspaceId,IDS.corpus]);
  await client.query(`
    UPDATE signal_workspace_corpora
    SET role = 'operational'
    WHERE workspace_id = $1::uuid
      AND study_corpus_id = $2::uuid
      AND valid_to IS NULL
  `, [workspaceId, IDS.corpus]);
  await client.query(`
    INSERT INTO brand_seeds (id, canonical_name, aliases, detection_patterns, country, active)
    VALUES ($1::uuid, 'Fixture Competitor', ARRAY[]::text[],
      ARRAY['Fixture Competitor']::text[], 'MX', true)
  `, [IDS.competitorSeed]);
  await client.query(`
    INSERT INTO competitors (id, brand_id, competitor_brand_seed_id, priority)
    VALUES ($1::uuid, $2::uuid, $3::uuid, 1)
  `, [IDS.competitor, IDS.brand, IDS.competitorSeed]);
  await client.query(`
    INSERT INTO data_sources (
      id, workspace_id, organization_id, brand_id, source_type, provider,
      connection_method, name, governed_scope, governed_entity_type,
      governed_entity_id, scope_policy_version, scope_review_status,
      scope_approved_by_user_id, scope_approval_source, scope_approved_at,
      role, status
    ) VALUES
      ($2::uuid, $1::uuid, $3::uuid, $4::uuid, 'social-listening', 'fixture',
       'csv', 'Primary intent', 'primary_brand', 'brand', $4::uuid,
       'workspace-source-scope-v1', 'approved', $5::uuid, 'fixture', now(),
       jsonb_build_object('ownership', 'workspace'), 'active'),
      ($6::uuid, $1::uuid, $3::uuid, $4::uuid, 'social-listening', 'fixture',
       'csv', 'Competitor intent', 'competitor', 'competitor', $7::uuid,
       'workspace-source-scope-v1', 'approved', $5::uuid, 'fixture', now(),
       jsonb_build_object('ownership', 'workspace'), 'active')
  `, [
    workspaceId, IDS.sourcePrimary, IDS.organization, IDS.brand, IDS.actor,
    IDS.sourceCompetitor, IDS.competitor
  ]);
  await client.query(`
    INSERT INTO import_batches (
      id, workspace_id, data_source_id, contributed_by_study_corpus_id,
      mention_type, entity_kind, competitor_id, entity_label, source_system,
      imported_by_user_id, status, source_file_name
    ) VALUES
      ($1::uuid, $3::uuid, $4::uuid, $5::uuid,
       'brand', 'primary_brand', NULL, 'Fixture brand', 'fixture',
       $6::uuid, 'completed', 'primary.csv'),
      ($2::uuid, $3::uuid, $7::uuid, $5::uuid,
       'competitor', 'competitor', $8::uuid, 'Fixture competitor', 'fixture',
       $6::uuid, 'completed', 'competitor.csv')
  `, [
    IDS.batchPrimary, IDS.batchCompetitor, workspaceId, IDS.sourcePrimary,
    IDS.corpus, IDS.actor, IDS.sourceCompetitor, IDS.competitor
  ]);

  await insertRoot(client, workspaceId, IDS.competitorRoot, IDS.sourcePrimary, IDS.batchPrimary, 8);
  await insertRoot(client, workspaceId, IDS.unattributedRoot, IDS.sourcePrimary, IDS.batchPrimary, 8);
  await insertRoot(client, workspaceId, IDS.v2OnlyRoot, IDS.sourceCompetitor, IDS.batchCompetitor, 8);
  await insertRoot(client, workspaceId, IDS.multiRoot, IDS.sourcePrimary, IDS.batchPrimary, 8);
  await insertRoot(client, workspaceId, IDS.aliasRoot, IDS.sourcePrimary, IDS.batchPrimary, 8);
  await insertAlias(client, workspaceId);
  await insertRoot(client, workspaceId, IDS.historicalRoot, IDS.sourcePrimary, IDS.batchPrimary, 8);
  await insertRoot(client, workspaceId, IDS.rejectedRoot, IDS.sourcePrimary, IDS.batchPrimary, 8);
  await insertRoot(client, workspaceId, IDS.lowQualityRoot, IDS.sourcePrimary, IDS.batchPrimary, 2);
  await insertRoot(client, workspaceId, IDS.pendingUnattributedRoot, IDS.sourceCompetitor, IDS.batchCompetitor, 8);

  const competitorAssertion = await createAssertion(client, {
    workspaceId, mentionId: IDS.competitorRoot, sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary, scope: "competitor", entityType: "competitor",
    entityId: IDS.competitor, policyKey: "fixture-competitor-review", seed: "1"
  });
  await reviewAssertion(client, competitorAssertion, "approve", "2");
  const unattributedAssertion = await createAssertion(client, {
    workspaceId, mentionId: IDS.unattributedRoot, sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary, scope: "unattributed", entityType: "unattributed",
    entityId: null, policyKey: "fixture-unattributed-review", seed: "3"
  });
  await reviewAssertion(client, unattributedAssertion, "approve", "4");
  const v2OnlyAssertion = await createPrimaryAssertion(client, workspaceId, IDS.v2OnlyRoot, IDS.sourceCompetitor, IDS.batchCompetitor, "5");
  await reviewAssertion(client, v2OnlyAssertion, "approve", "6");
  const multiPrimary = await createPrimaryAssertion(client, workspaceId, IDS.multiRoot, IDS.sourcePrimary, IDS.batchPrimary, "7");
  await reviewAssertion(client, multiPrimary, "approve", "8");
  const multiCompetitor = await createAssertion(client, {
    workspaceId, mentionId: IDS.multiRoot, sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary, scope: "competitor", entityType: "competitor",
    entityId: IDS.competitor, policyKey: "fixture-competitor-review", seed: "9"
  });
  await reviewAssertion(client, multiCompetitor, "approve", "a");
  const aliasPrimary = await createPrimaryAssertion(client, workspaceId, IDS.aliasRoot, IDS.sourcePrimary, IDS.batchPrimary, "b");
  await reviewAssertion(client, aliasPrimary, "approve", "c");
  const historicalPending = await createPrimaryAssertion(client, workspaceId, IDS.historicalRoot, IDS.sourcePrimary, IDS.batchPrimary, "d");
  const superseding = await scalar<string>(client, `
    SELECT supersede_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, 'primary_brand', 'brand', $3::uuid,
      'Fixture brand', 0.99, 'human_reviewed_context', $4, '2', NULL,
      $5, 'fixture-review', '1', $6, $7
    )::text
  `, [
    historicalPending, IDS.actor, IDS.brand, hash("d"), hash("de"), hash("df"), hash("d0")
  ]);
  await reviewAssertion(client, superseding, "approve", "1");
  const rejected = await createPrimaryAssertion(client, workspaceId, IDS.rejectedRoot, IDS.sourcePrimary, IDS.batchPrimary, "2");
  await reviewAssertion(client, rejected, "reject", "3");
  const lowQuality = await createPrimaryAssertion(client, workspaceId, IDS.lowQualityRoot, IDS.sourcePrimary, IDS.batchPrimary, "4");
  await reviewAssertion(client, lowQuality, "approve", "5");
  await createAssertion(client, {
    workspaceId, mentionId: IDS.pendingUnattributedRoot, sourceId: IDS.sourceCompetitor,
    batchId: IDS.batchCompetitor, scope: "unattributed", entityType: "unattributed",
    entityId: null, policyKey: "fixture-unattributed-review", seed: "pending-unattributed"
  });

  const workspace: ResolvedSignalWorkspace = {
    contractVersion: "signal-backend-v1",
    id: workspaceId,
    organizationId: IDS.organization,
    slug: "brand-policy-fixture",
    name: "Brand Policy Fixture",
    subject: { type: "brand", id: IDS.brand },
    timezone: "UTC",
    status: "active",
    corpora: [{
      id: IDS.corpus,
      name: "Brand policy compatibility corpus",
      role: "operational",
      status: "corpus_approved",
      validFrom: "2026-01-01T00:00:00.000Z",
      methodologySlug: "brand-policy-method",
      outputId: null
    }]
  };
  const actor: SignalWorkspaceUser = {
    id: IDS.actor,
    userType: "noisia_internal",
    organizationId: IDS.organization
  };
  return {
    workspace,
    actor,
    filter: {
      contract_version: "signal-backend-v1",
      date_range: { start: "2026-01-01", end: "2026-12-31" },
      timezone: "UTC",
      granularity: "month",
      dimensions: {}
    } as const
  };
}

async function insertRoot(
  client: pg.Client,
  workspaceId: string,
  mentionId: string,
  sourceId: string,
  batchId: string,
  qualityScore: number
) {
  await client.query(`
    INSERT INTO mentions (
      id, workspace_id, study_corpus_id, data_source_id, canonical_mention_id,
      provider_record_id, external_id, source_system, source_file_id,
      text_hash, text_clean, text_snippet, text_length, language,
      published_at, platform, resolved_platform, quality_score,
      quality_flags, inclusion_status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $1::uuid,
      $1::text, $2::text || ':' || $1::text, 'fixture', $5::uuid,
      encode(sha256(convert_to($1::text, 'UTF8')), 'hex'),
      'Deterministic governed fixture', 'Governed fixture', 30, 'es',
      '2026-06-15T12:00:00Z', 'x', 'x', $6, '[]'::jsonb, 'included'
    )
  `, [mentionId, workspaceId, IDS.corpus, sourceId, batchId, qualityScore]);
  await client.query(`
    INSERT INTO signal_mention_import_memberships (
      workspace_id,mention_id,import_batch_id,data_source_id
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid)
    ON CONFLICT (mention_id,import_batch_id) DO NOTHING
  `,[workspaceId,mentionId,batchId,sourceId]);
}

async function insertAlias(client: pg.Client, workspaceId: string) {
  await client.query(`
    INSERT INTO mentions (
      id, workspace_id, study_corpus_id, data_source_id, canonical_mention_id,
      provider_record_id, external_id, source_system, source_file_id,
      text_hash, text_clean, text_snippet, text_length, language,
      published_at, platform, resolved_platform, quality_score,
      quality_flags, inclusion_status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      $1::text, $2::text || ':' || $1::text, 'fixture', $6::uuid,
      encode(sha256(convert_to($1::text, 'UTF8')), 'hex'),
      'Deterministic alias fixture', 'Alias fixture', 28, 'es',
      '2026-06-15T12:00:00Z', 'x', 'x', 8, '[]'::jsonb, 'included'
    )
  `, [
    IDS.aliasRow, workspaceId, IDS.corpus, IDS.sourcePrimary, IDS.aliasRoot, IDS.batchPrimary
  ]);
}

async function insertAliasFor(
  client: pg.Client,
  workspaceId: string,
  aliasId: string,
  canonicalId: string,
  sourceId: string,
  batchId: string
) {
  await client.query(`
    INSERT INTO mentions (
      id,workspace_id,study_corpus_id,data_source_id,canonical_mention_id,
      provider_record_id,external_id,source_system,source_file_id,
      text_hash,text_clean,text_snippet,text_length,language,
      published_at,platform,resolved_platform,quality_score,quality_flags,inclusion_status
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,
      $1::text,$2::text || ':' || $1::text,'fixture',$6::uuid,
      encode(sha256(convert_to($1::text,'UTF8')),'hex'),
      'Deterministic alias provenance','Alias provenance',28,'es',
      '2026-06-15T12:00:00Z','x','x',8,'[]'::jsonb,'included'
    )
  `, [aliasId, workspaceId, IDS.corpus, sourceId, canonicalId, batchId]);
  await client.query(`
    INSERT INTO signal_mention_import_memberships (
      workspace_id,mention_id,import_batch_id,data_source_id
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid)
    ON CONFLICT (mention_id,import_batch_id) DO NOTHING
  `, [workspaceId, canonicalId, batchId, sourceId]);
}

async function createPrimaryAssertion(
  client: pg.Client,
  workspaceId: string,
  mentionId: string,
  sourceId: string,
  batchId: string,
  seed: string
) {
  return createAssertion(client, {
    workspaceId,
    mentionId,
    sourceId,
    batchId,
    scope: "primary_brand",
    entityType: "brand",
    entityId: IDS.brand,
    policyKey: "fixture-brand-review",
    seed
  });
}

async function createAssertion(client: pg.Client, args: {
  workspaceId: string;
  mentionId: string;
  sourceId: string;
  batchId: string;
  scope: string;
  entityType: string;
  entityId: string | null;
  policyKey: string;
  seed: string;
}) {
  return scalar<string>(client, `
    SELECT create_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      $5, $6, $7::uuid, 'Fixture entity', 0.99,
      'human_reviewed_context', $8,
      $9, '1', NULL, $10
    )::text
  `, [
    args.workspaceId, args.mentionId, args.sourceId, args.batchId,
    args.scope, args.entityType, args.entityId, hash(args.seed),
    args.policyKey, hash(nextHex(args.seed))
  ]);
}

async function reviewAssertion(
  client: pg.Client,
  assertionId: string,
  decision: "approve" | "reject",
  seed: string
) {
  await client.query(`
    SELECT review_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, $3, 'fixture review',
      'fixture-review', '1', $4, $5
    )
  `, [assertionId, IDS.actor, decision, hash(seed), hash(nextHex(seed))]);
}

async function operationalV1State(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT pointer.id::text AS pointer_id,
      pointer.population_id::text AS population_id,
      definition.definition_hash,
      definition.membership_digest,
      count(membership.mention_id) FILTER (
        WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL
      )::int AS included_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        membership.mention_id::text, ',' ORDER BY membership.mention_id
      ) FILTER (WHERE membership.membership_status = 'included'
        AND membership.removed_at IS NULL), ''), 'UTF8')), 'hex') AS included_digest
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition ON definition.id = pointer.population_id
    LEFT JOIN signal_population_memberships membership
      ON membership.population_id = pointer.population_id
    WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
    GROUP BY pointer.id, pointer.population_id, definition.definition_hash,
      definition.membership_digest
  `, [workspaceId]);
}

async function semanticBaseState(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT definition.id::text AS population_id,
      definition.population_key,
      definition.version AS population_version,
      definition.definition_hash,
      definition.policy_key,
      definition.policy_version,
      definition.membership_digest,
      definition.status,
      definition.definition,
      count(membership.mention_id)::int AS membership_rows,
      count(membership.mention_id) FILTER (
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL
      )::int AS included_rows,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|',
        membership.mention_id::text,membership.membership_status,
        membership.membership_reason,COALESCE(membership.removed_at::text,'∅')
      ),E'\\n' ORDER BY membership.mention_id),''),'UTF8')),'hex') AS membership_rows_digest
    FROM signal_population_definitions definition
    LEFT JOIN signal_population_memberships membership
      ON membership.population_id=definition.id
    WHERE definition.workspace_id=$1::uuid
      AND definition.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
    GROUP BY definition.id
  `, [workspaceId]);
}

async function applyMigrationsThrough(client: pg.Client, maximum: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= maximum)
    .sort();
  for (const file of files) {
    await client.query("BEGIN");
    try {
      await client.query(await readFile(join(migrationDir, file), "utf8"));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

async function runTransaction<T>(client: pg.Client, operation: () => Promise<T>): Promise<T> {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

async function expectSqlState(
  client: pg.Client,
  expected: string,
  sql: string,
  params: unknown[] = []
) {
  await assert.rejects(
    client.query(sql, params),
    (error: unknown) => (error as { code?: string }).code === expected
  );
}

async function scalar<T>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(sql, params);
  const value = Object.values(result.rows[0] ?? {})[0];
  assert.notEqual(value, undefined);
  return value as T;
}

async function row<T extends Record<string, unknown>>(
  client: pg.Client,
  sql: string,
  params: unknown[] = []
) {
  const result = await client.query<T>(sql, params);
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

async function rows<T extends Record<string, unknown>>(
  client: pg.Client,
  sql: string,
  params: unknown[] = []
) {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

async function replaceCurrentCompilationForFixture(
  client: pg.Client,
  compilationId: string,
  replacement: {
    status: "ready" | "stale";
    blockingReasons: string[];
    nextPolicyTransitionAt?: string;
  }
) {
  await client.query(`
    UPDATE signal_population_policy_compilations
    SET is_current=false, retired_at=GREATEST(clock_timestamp(), compiled_at)
    WHERE id=$1::uuid
  `, [compilationId]);
  await client.query(`
    INSERT INTO signal_population_policy_compilations (
      workspace_id, policy_bundle_id, population_id, compilation_version,
      compiled_plan_hash, policy_definition_hash, population_version,
      population_definition_hash, membership_digest,
      source_watermark_hash, source_watermark_at,
      compilation_status, blocking_reasons, compiled_by_user_id,
      governance_evaluation_id, quality_policy_id, quality_policy_version,
      quality_policy_hash, retention_policy_digest, licensing_policy_digest,
      usage_purposes, authorized_root_count, quality_blocked_count,
      retention_blocked_count, licensing_blocked_count,
      governance_unknown_count, policy_evaluation_watermark, governance_digest,
      module_key,view_key,next_policy_transition_at,governance_data_watermark_id
    )
    SELECT workspace_id,policy_bundle_id,population_id,compilation_version+1,
      compiled_plan_hash,policy_definition_hash,population_version,
      population_definition_hash,membership_digest,
      source_watermark_hash,source_watermark_at,
      $2, $3::text[], compiled_by_user_id,
      governance_evaluation_id,quality_policy_id,quality_policy_version,
      quality_policy_hash,retention_policy_digest,licensing_policy_digest,
      usage_purposes,authorized_root_count,quality_blocked_count,
      retention_blocked_count,licensing_blocked_count,
      governance_unknown_count,policy_evaluation_watermark,governance_digest,
      module_key,view_key,COALESCE($4::timestamptz,next_policy_transition_at),
      governance_data_watermark_id
    FROM signal_population_policy_compilations WHERE id=$1::uuid
  `, [
    compilationId,
    replacement.status,
    replacement.blockingReasons,
    replacement.nextPolicyTransitionAt ?? null
  ]);
}

function hash(seed: string) {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

async function waitPast(isoTimestamp: string) {
  const waitMs = Math.max(0, Date.parse(isoTimestamp) - Date.now() + 75);
  await new Promise<void>((resolveWait) => setTimeout(resolveWait, waitMs));
}

function nextHex(seed: string) {
  if (seed.length > 1) return `${seed}-next`;
  return ((Number.parseInt(seed, 16) + 1) % 16).toString(16);
}
