import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  signalLicensingPolicyDefinitionHashV1,
  signalPopulationPolicyDefinitionHashV1,
  signalProvenancePolicyBindingDefinitionHashV1,
  signalQualityPolicyDefinitionHashV1,
  signalRetentionPolicyDefinitionHashV1,
  type SignalPopulationPolicyBundleDefinitionV1
} from "@noisia/query-engine";
import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_DATA_GOVERNANCE_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_DATA_GOVERNANCE_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

const IDS = {
  organizationA: "70000000-0000-4000-8000-000000000001",
  organizationB: "70000000-0000-4000-8000-000000000002",
  actorA: "70000000-0000-4000-8000-000000000101",
  actorB: "70000000-0000-4000-8000-000000000102",
  brandA: "70000000-0000-4000-8000-000000000201",
  brandB: "70000000-0000-4000-8000-000000000202",
  sourceA: "70000000-0000-4000-8000-000000000301",
  bundleA: "70000000-0000-4000-8000-000000000401",
  qualityA: "70000000-0000-4000-8000-000000000501",
  retentionA: "70000000-0000-4000-8000-000000000502",
  licensingA: "70000000-0000-4000-8000-000000000503",
  bindingA: "70000000-0000-4000-8000-000000000504"
} as const;

test("0069 makes relational data-governance authority mandatory without moving V1", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 68);
    const fixture = await seedFixture(client);
    const v1Before = await operationalV1State(client, fixture.workspaceA);

    await applyMigration(client, "0069_signal_data_governance_policies.sql");
    await applyMigration(client, "0069_signal_data_governance_policies.sql");

    assert.deepEqual(await operationalV1State(client, fixture.workspaceA), v1Before);
    assert.deepEqual(await row(client, `
      SELECT
        (SELECT count(*)::int FROM signal_quality_policies) AS quality_policies,
        (SELECT count(*)::int FROM signal_retention_policies) AS retention_policies,
        (SELECT count(*)::int FROM signal_licensing_policies) AS licensing_policies,
        (SELECT count(*)::int FROM signal_provenance_policy_bindings) AS provenance_bindings,
        (SELECT count(*)::int FROM signal_data_governance_evaluations) AS evaluations,
        (SELECT count(*)::int FROM signal_governed_view_population_derivations) AS population_derivations,
        (SELECT count(*)::int FROM signal_governed_view_bindings) AS governed_bindings
    `), {
      quality_policies: 0,
      retention_policies: 0,
      licensing_policies: 0,
      provenance_bindings: 0,
      evaluations: 0,
      population_derivations: 0,
      governed_bindings: 0
    });

    // Parent + child licensing creation is one statement. An injected failure
    // between the parent and its usages rolls everything back, and the exact
    // same request remains retryable.
    const atomicLicenseKey = hash("atomic-license-create");
    const atomicLicenseDefinition = {
      workspace_id: fixture.workspaceA,
      policy_key: "atomic-license",
      policy_version: 1,
      approval_evidence_hash: hash("atomic-license-evidence"),
      usages: [
        { usage_purpose: "client-derived-metrics" as const, decision: "allowed" as const }
      ]
    };
    const atomicLicenseHash = signalLicensingPolicyDefinitionHashV1(atomicLicenseDefinition);
    await client.query(`
      CREATE OR REPLACE FUNCTION fail_fixture_license_usage_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'fixture failure between licensing parent and usages';
      END $$
    `);
    await client.query(`CREATE TRIGGER trg_fail_fixture_license_usage
      BEFORE INSERT ON signal_licensing_policy_usages
      FOR EACH ROW EXECUTE FUNCTION fail_fixture_license_usage_insert()`);
    await assert.rejects(client.query(`
      SELECT * FROM create_signal_licensing_policy_draft(
        $1::uuid,$2::uuid,$3::uuid,'atomic-license',1,$4,
        ARRAY['client-derived-metrics']::text[],ARRAY['allowed']::text[],
        $5,$6
      )
    `, [IDS.organizationA, fixture.workspaceA, IDS.actorA,
      atomicLicenseDefinition.approval_evidence_hash, atomicLicenseHash, atomicLicenseKey]));
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_licensing_policies
      WHERE workspace_id=$1::uuid AND creation_idempotency_key=$2
    `, [fixture.workspaceA, atomicLicenseKey]), 0);
    await client.query("DROP TRIGGER trg_fail_fixture_license_usage ON signal_licensing_policy_usages");
    await client.query("DROP FUNCTION fail_fixture_license_usage_insert()");
    const atomicLicenseRetry = await row<{ created: boolean }>(client, `
      SELECT created FROM create_signal_licensing_policy_draft(
        $1::uuid,$2::uuid,$3::uuid,'atomic-license',1,$4,
        ARRAY['client-derived-metrics']::text[],ARRAY['allowed']::text[],
        $5,$6
      )
    `, [IDS.organizationA, fixture.workspaceA, IDS.actorA,
      atomicLicenseDefinition.approval_evidence_hash, atomicLicenseHash, atomicLicenseKey]);
    assert.equal(atomicLicenseRetry.created, true);
    assert.deepEqual(await row(client, `
      SELECT count(DISTINCT policy.id)::int AS parents,count(usage.id)::int AS usages
      FROM signal_licensing_policies policy
      LEFT JOIN signal_licensing_policy_usages usage ON usage.licensing_policy_id=policy.id
      WHERE policy.workspace_id=$1::uuid AND policy.creation_idempotency_key=$2
    `, [fixture.workspaceA, atomicLicenseKey]), { parents: 1, usages: 1 });

    // Advisory locking makes creation and activation safe under independent
    // connections, not merely under a caller-owned transaction.
    const concurrentDefinition = {
      workspace_id: fixture.workspaceA,
      policy_key: "concurrent-quality",
      policy_version: 1,
      min_quality_score: 4,
      required_quality_flags: [] as string[],
      forbidden_quality_flags: [] as string[],
      canonical_root_disposition: "evaluate" as const
    };
    const concurrentHash = signalQualityPolicyDefinitionHashV1(concurrentDefinition);
    const concurrentKey = hash("concurrent-quality-create");
    const createSql = `SELECT object_id::text,created FROM create_signal_quality_policy_draft(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::text[],$8::text[],$9,$10,$11
    )`;
    const peer = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
    await peer.connect();
    try {
      const created = await Promise.all([
        client.query(createSql, [
          IDS.organizationA, fixture.workspaceA, IDS.actorA, concurrentDefinition.policy_key,
          1, 4, [], [], "evaluate", concurrentHash, concurrentKey
        ]),
        peer.query(createSql, [
          IDS.organizationA, fixture.workspaceA, IDS.actorA, concurrentDefinition.policy_key,
          1, 4, [], [], "evaluate", concurrentHash, concurrentKey
        ])
      ]);
      assert.equal(created.flatMap((result) => result.rows).filter((item) => item.created).length, 1);
      const oldPolicyId = String(created[0]!.rows[0]!.object_id);
      const oldInputHash = hash(`activate-old:${oldPolicyId}`);
      const oldActivationKey = hash("activate-old-quality");
      await client.query(`SELECT * FROM activate_signal_data_governance_object(
        $1::uuid,$2::uuid,'quality-policy',$3::uuid,$4,$5
      )`, [fixture.workspaceA, IDS.actorA, oldPolicyId, oldInputHash, oldActivationKey]);

      const replacementDefinition = { ...concurrentDefinition, policy_version: 2 };
      const replacement = await row<{ object_id: string }>(client, `
        SELECT object_id::text FROM create_signal_quality_policy_draft(
          $1::uuid,$2::uuid,$3::uuid,$4,2,4,ARRAY[]::text[],ARRAY[]::text[],
          'evaluate',$5,$6
        )
      `, [
        IDS.organizationA, fixture.workspaceA, IDS.actorA, replacementDefinition.policy_key,
        signalQualityPolicyDefinitionHashV1(replacementDefinition), hash("replacement-quality-create")
      ]);
      await client.query(`
        CREATE OR REPLACE FUNCTION fail_fixture_activation_after_retirement()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action='activate' THEN
            RAISE EXCEPTION 'fixture failure after prior retirement';
          END IF;
          RETURN NEW;
        END $$
      `);
      await client.query(`CREATE TRIGGER trg_fail_fixture_activation
        BEFORE INSERT ON signal_data_governance_policy_events
        FOR EACH ROW EXECUTE FUNCTION fail_fixture_activation_after_retirement()`);
      const replacementInputHash = hash(`activate-replacement:${replacement.object_id}`);
      const replacementKey = hash("activate-replacement-quality");
      await assert.rejects(client.query(`SELECT * FROM activate_signal_data_governance_object(
        $1::uuid,$2::uuid,'quality-policy',$3::uuid,$4,$5
      )`, [fixture.workspaceA, IDS.actorA, replacement.object_id, replacementInputHash, replacementKey]));
      assert.deepEqual(await row(client, `
        SELECT
          (SELECT status FROM signal_quality_policies WHERE id=$1::uuid) AS previous_status,
          (SELECT status FROM signal_quality_policies WHERE id=$2::uuid) AS replacement_status,
          (SELECT count(*)::int FROM signal_data_governance_policy_events
            WHERE workspace_id=$3::uuid AND idempotency_key=$4) AS replacement_events
      `, [oldPolicyId, replacement.object_id, fixture.workspaceA, replacementKey]), {
        previous_status: "active", replacement_status: "draft", replacement_events: 0
      });
      await client.query("DROP TRIGGER trg_fail_fixture_activation ON signal_data_governance_policy_events");
      await client.query("DROP FUNCTION fail_fixture_activation_after_retirement() ");
      const activated = await Promise.all([
        client.query(`SELECT * FROM activate_signal_data_governance_object(
          $1::uuid,$2::uuid,'quality-policy',$3::uuid,$4,$5
        )`, [fixture.workspaceA, IDS.actorA, replacement.object_id, replacementInputHash, replacementKey]),
        peer.query(`SELECT * FROM activate_signal_data_governance_object(
          $1::uuid,$2::uuid,'quality-policy',$3::uuid,$4,$5
        )`, [fixture.workspaceA, IDS.actorA, replacement.object_id, replacementInputHash, replacementKey])
      ]);
      assert.equal(activated.flatMap((result) => result.rows).filter((item) => item.activated).length, 1);
      assert.equal(await scalar<number>(client, `
        SELECT count(*)::int FROM signal_data_governance_policy_events
        WHERE workspace_id=$1::uuid AND idempotency_key=$2
      `, [fixture.workspaceA, replacementKey]), 1);
    } finally {
      await peer.end();
    }

    const policyDefinition = brandPolicyDefinition(fixture.workspaceA, IDS.brandA);
    const policyHash = signalPopulationPolicyDefinitionHashV1(policyDefinition);
    await client.query(`
      INSERT INTO signal_population_policy_bundles (
        id,workspace_id,policy_key,policy_version,status,authorized_modules,
        allowed_scopes,acceptance_status,quality_contract_status,
        quality_policy_key,quality_policy_version,min_quality_score,
        required_quality_flags,forbidden_quality_flags,eligibility_policy,
        deduplication_policy,visibility_class,denominator_key,
        retention_policy_ref,licensing_policy_ref,data_governance_contract_status,
        required_usage_purposes,definition_hash,created_by_user_id
      ) VALUES (
        $1::uuid,$2::uuid,'operational-brand-governed',1,'draft',
        ARRAY['brand-monitoring','mentions','topics-narratives']::text[],
        ARRAY['primary_brand']::text[],'included','resolved',
        'fixture-quality',1,NULL,ARRAY[]::text[],ARRAY[]::text[],
        'semantic-approved-eligible','canonical-root','client-safe',
        'eligible-canonical-roots','fixture-retention','fixture-license',
        'not_available',ARRAY[]::text[],$3,$4::uuid
      )
    `, [IDS.bundleA, fixture.workspaceA, policyHash, IDS.actorA]);
    await client.query(`
      INSERT INTO signal_population_policy_entities (
        workspace_id,policy_bundle_id,scope,entity_type,entity_id
      ) VALUES ($1::uuid,$2::uuid,'primary_brand','brand',$3::uuid)
    `, [fixture.workspaceA, IDS.bundleA, IDS.brandA]);
    const candidate = await row<{
      id: string;
      version: number;
      definition_hash: string;
      membership_digest: string;
    }>(client, `
      SELECT id::text,version,definition_hash,membership_digest
      FROM signal_population_definitions
      WHERE workspace_id=$1::uuid AND status='draft'
        AND definition->>'contract_version'='signal-operational-primary-brand-semantic-v2'
      LIMIT 1
    `, [fixture.workspaceA]);
    await expectSqlState(client, "23514", `
      INSERT INTO signal_population_policy_compilations (
        workspace_id,policy_bundle_id,population_id,compilation_version,
        compiled_plan_hash,policy_definition_hash,population_version,
        population_definition_hash,membership_digest,source_watermark_hash,
        compilation_status,compiled_by_user_id
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$6,$7,$8,$9,'ready',$10::uuid)
    `, [
      fixture.workspaceA, IDS.bundleA, candidate.id, hash("fake-plan"), policyHash,
      candidate.version, candidate.definition_hash, candidate.membership_digest,
      hash("watermark"), IDS.actorA
    ]);

    const qualityDefinition = {
      workspace_id: fixture.workspaceA,
      policy_key: "fixture-quality",
      policy_version: 1,
      min_quality_score: 5,
      required_quality_flags: [] as string[],
      forbidden_quality_flags: [] as string[],
      canonical_root_disposition: "evaluate" as const
    };
    await expectSqlState(client, "23514", `
      INSERT INTO signal_quality_policies (
        organization_id,workspace_id,policy_key,policy_version,min_quality_score,
        definition_hash,created_by_user_id,creation_idempotency_key
      ) VALUES ($1::uuid,$2::uuid,'unauthorized-quality',1,5,$3,$4::uuid,$5)
    `, [
      IDS.organizationA, fixture.workspaceA,
      signalQualityPolicyDefinitionHashV1({ ...qualityDefinition, policy_key: "unauthorized-quality" }),
      IDS.actorB, hash("unauthorized-quality")
    ]);
    await client.query(`
      INSERT INTO signal_quality_policies (
        id,organization_id,workspace_id,policy_key,policy_version,status,min_quality_score,
        required_quality_flags,forbidden_quality_flags,canonical_root_disposition,
        definition_hash,created_by_user_id,activated_by_user_id,activated_at,
        creation_idempotency_key
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'active',$6,$7::text[],$8::text[],$9,
        $10,$11::uuid,$11::uuid,now(),$12)
    `, [
      IDS.qualityA, IDS.organizationA, fixture.workspaceA, qualityDefinition.policy_key,
      qualityDefinition.policy_version, qualityDefinition.min_quality_score,
      qualityDefinition.required_quality_flags, qualityDefinition.forbidden_quality_flags,
      qualityDefinition.canonical_root_disposition,
      signalQualityPolicyDefinitionHashV1(qualityDefinition), IDS.actorA, hash("quality-create")
    ]);
    const retentionDefinition = {
      workspace_id: fixture.workspaceA,
      policy_key: "fixture-retention",
      policy_version: 1,
      retention_state: "allowed" as const,
      retention_mode: "indefinite" as const,
      retain_until: null,
      expiry_action: "block_use" as const,
      approval_evidence_hash: hash("retention-evidence")
    };
    await client.query(`
      INSERT INTO signal_retention_policies (
        id,organization_id,workspace_id,policy_key,policy_version,status,
        retention_state,retention_mode,retain_until,expiry_action,approval_evidence_hash,
        definition_hash,created_by_user_id,approved_by_user_id,approved_at,
        creation_idempotency_key
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'active',$6,$7,$8::timestamptz,$9,$10,
        $11,$12::uuid,$12::uuid,now(),$13)
    `, [
      IDS.retentionA, IDS.organizationA, fixture.workspaceA, retentionDefinition.policy_key,
      retentionDefinition.policy_version, retentionDefinition.retention_state,
      retentionDefinition.retention_mode, retentionDefinition.retain_until,
      retentionDefinition.expiry_action, retentionDefinition.approval_evidence_hash,
      signalRetentionPolicyDefinitionHashV1(retentionDefinition), IDS.actorA,
      hash("retention-create")
    ]);
    const licensingDefinition = {
      workspace_id: fixture.workspaceA,
      policy_key: "fixture-license",
      policy_version: 1,
      approval_evidence_hash: hash("license-evidence"),
      usages: [
        { usage_purpose: "client-derived-metrics" as const, decision: "allowed" as const },
        { usage_purpose: "client-mention-list" as const, decision: "allowed" as const },
        { usage_purpose: "client-text-or-excerpt" as const, decision: "allowed" as const }
      ]
    };
    await client.query(`
      INSERT INTO signal_licensing_policies (
        id,organization_id,workspace_id,policy_key,policy_version,status,
        approval_evidence_hash,definition_hash,created_by_user_id,creation_idempotency_key
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'draft',$6,$7,$8::uuid,$9)
    `, [
      IDS.licensingA, IDS.organizationA, fixture.workspaceA,
      licensingDefinition.policy_key, licensingDefinition.policy_version,
      licensingDefinition.approval_evidence_hash,
      signalLicensingPolicyDefinitionHashV1(licensingDefinition), IDS.actorA,
      hash("license-create")
    ]);
    for (const usage of licensingDefinition.usages) {
      await client.query(`
        INSERT INTO signal_licensing_policy_usages (
          workspace_id,licensing_policy_id,usage_purpose,decision
        ) VALUES ($1::uuid,$2::uuid,$3,$4)
      `, [fixture.workspaceA, IDS.licensingA, usage.usage_purpose, usage.decision]);
    }
    await client.query(`
      UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2::uuid,
        approved_at=now(),updated_at=now() WHERE id=$1::uuid
    `, [IDS.licensingA, IDS.actorA]);
    const bindingDefinition = {
      workspace_id: fixture.workspaceA,
      data_source_id: IDS.sourceA,
      import_batch_id: null,
      binding_version: 1,
      quality_policy_id: IDS.qualityA,
      retention_policy_id: IDS.retentionA,
      licensing_policy_id: IDS.licensingA
    };
    await client.query(`
      INSERT INTO signal_provenance_policy_bindings (
        id,workspace_id,data_source_id,import_batch_id,binding_version,status,
        quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,
        created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,NULL,1,'active',$4::uuid,$5::uuid,$6::uuid,
        $7,$8::uuid,$8::uuid,now(),$9)
    `, [
      IDS.bindingA, fixture.workspaceA, IDS.sourceA, IDS.qualityA, IDS.retentionA,
      IDS.licensingA, signalProvenancePolicyBindingDefinitionHashV1(bindingDefinition),
      IDS.actorA, hash("binding-create")
    ]);

    // Every compound writer is safe under the same-key concurrent retry,
    // including parent+children licensing and source/import bindings.
    const writerPeer = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
    await writerPeer.connect();
    try {
      const concurrentRetention = {
        ...retentionDefinition,
        policy_key: "concurrent-retention",
        policy_version: 2
      };
      const concurrentRetentionKey = hash("concurrent-retention-create");
      const retentionArgs = [
        IDS.organizationA, fixture.workspaceA, IDS.actorA,
        concurrentRetention.policy_key, concurrentRetention.policy_version,
        concurrentRetention.retention_state, concurrentRetention.retention_mode,
        concurrentRetention.retain_until, concurrentRetention.expiry_action,
        concurrentRetention.approval_evidence_hash,
        signalRetentionPolicyDefinitionHashV1(concurrentRetention), concurrentRetentionKey
      ];
      const retentionSql = `SELECT object_id::text,created FROM create_signal_retention_policy_draft(
        $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12
      )`;
      const retentionWrites = await Promise.all([
        client.query(retentionSql, retentionArgs), writerPeer.query(retentionSql, retentionArgs)
      ]);
      assert.equal(retentionWrites.flatMap((result) => result.rows)
        .filter((item) => item.created).length, 1);

      const concurrentLicense = {
        ...licensingDefinition,
        policy_key: "concurrent-license",
        policy_version: 2
      };
      const concurrentLicenseKey = hash("concurrent-license-create");
      const licenseArgs = [
        IDS.organizationA, fixture.workspaceA, IDS.actorA,
        concurrentLicense.policy_key, concurrentLicense.policy_version,
        concurrentLicense.approval_evidence_hash,
        concurrentLicense.usages.map((usage) => usage.usage_purpose),
        concurrentLicense.usages.map((usage) => usage.decision),
        signalLicensingPolicyDefinitionHashV1(concurrentLicense), concurrentLicenseKey
      ];
      const licenseSql = `SELECT object_id::text,created FROM create_signal_licensing_policy_draft(
        $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::text[],$8::text[],$9,$10
      )`;
      const licenseWrites = await Promise.all([
        client.query(licenseSql, licenseArgs), writerPeer.query(licenseSql, licenseArgs)
      ]);
      assert.equal(licenseWrites.flatMap((result) => result.rows)
        .filter((item) => item.created).length, 1);
      assert.equal(await scalar<number>(client, `
        SELECT count(*)::int FROM signal_licensing_policy_usages usage
        JOIN signal_licensing_policies policy ON policy.id=usage.licensing_policy_id
        WHERE policy.workspace_id=$1::uuid AND policy.creation_idempotency_key=$2
      `, [fixture.workspaceA, concurrentLicenseKey]), concurrentLicense.usages.length);

      const concurrentBinding = { ...bindingDefinition, binding_version: 2 };
      const concurrentBindingKey = hash("concurrent-binding-create");
      const bindingArgs = [
        fixture.workspaceA, IDS.actorA, IDS.sourceA, null,
        concurrentBinding.binding_version, IDS.qualityA, IDS.retentionA, IDS.licensingA,
        signalProvenancePolicyBindingDefinitionHashV1(concurrentBinding), concurrentBindingKey
      ];
      const bindingSql = `SELECT object_id::text,created FROM create_signal_provenance_policy_binding_draft(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8::uuid,$9,$10
      )`;
      const bindingWrites = await Promise.all([
        client.query(bindingSql, bindingArgs), writerPeer.query(bindingSql, bindingArgs)
      ]);
      assert.equal(bindingWrites.flatMap((result) => result.rows)
        .filter((item) => item.created).length, 1);
    } finally {
      await writerPeer.end();
    }
    await expectSqlState(client, "23514", `
      INSERT INTO signal_provenance_policy_bindings (
        workspace_id,data_source_id,binding_version,status,quality_policy_id,
        retention_policy_id,licensing_policy_id,definition_hash,
        created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key
      ) VALUES ($1::uuid,$2::uuid,2,'active',$3::uuid,$4::uuid,$5::uuid,$6,
        $7::uuid,$7::uuid,now(),$8)
    `, [
      fixture.workspaceB, IDS.sourceA, IDS.qualityA, IDS.retentionA, IDS.licensingA,
      hash("cross-workspace-binding"), IDS.actorA, hash("cross-workspace-create")
    ]);

    await client.query(`
      UPDATE signal_retention_policies SET status='retired',effective_to=now(),updated_at=now()
      WHERE id=$1::uuid
    `, [IDS.retentionA]);
    await expectSqlState(client, "23514", `
      INSERT INTO signal_provenance_policy_bindings (
        workspace_id,data_source_id,binding_version,status,quality_policy_id,
        retention_policy_id,licensing_policy_id,definition_hash,
        created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key
      ) VALUES ($1::uuid,$2::uuid,2,'active',$3::uuid,$4::uuid,$5::uuid,$6,
        $7::uuid,$7::uuid,now(),$8)
    `, [
      fixture.workspaceA, IDS.sourceA, IDS.qualityA, IDS.retentionA, IDS.licensingA,
      hash("retired-binding"), IDS.actorA, hash("retired-binding-create")
    ]);
    await expectSqlState(client, "55000", `DELETE FROM signal_retention_policies WHERE id=$1::uuid`, [IDS.retentionA]);
    assert.deepEqual(await operationalV1State(client, fixture.workspaceA), v1Before);
    assert.equal(await scalar<number>(client, "SELECT count(*)::int FROM signal_governed_view_bindings"), 0);
  } finally {
    await client.end();
  }
});

async function seedFixture(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id,slug,legal_name,display_name,status) VALUES
      ($1::uuid,'governance-a','Governance A','Governance A','active'),
      ($2::uuid,'governance-b','Governance B','Governance B','active')
  `, [IDS.organizationA, IDS.organizationB]);
  await client.query(`
    INSERT INTO users (id,email,full_name,user_type,primary_role,organization_id,status) VALUES
      ($1::uuid,'governance-a@example.test','Governance A','noisia_internal','noisia_admin',$3::uuid,'active'),
      ($2::uuid,'governance-b@example.test','Governance B','agency_client','client_admin',$4::uuid,'active')
  `, [IDS.actorA, IDS.actorB, IDS.organizationA, IDS.organizationB]);
  await client.query(`
    INSERT INTO brands (id,organization_id,slug,name,display_name,countries,status) VALUES
      ($1::uuid,$3::uuid,'governance-brand-a','Governance A','Governance A',ARRAY['MX']::char(2)[],'active'),
      ($2::uuid,$4::uuid,'governance-brand-b','Governance B','Governance B',ARRAY['MX']::char(2)[],'active')
  `, [IDS.brandA, IDS.brandB, IDS.organizationA, IDS.organizationB]);
  const workspaceA = await scalar<string>(client, "SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid", [IDS.brandA]);
  const workspaceB = await scalar<string>(client, "SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid", [IDS.brandB]);
  await client.query(`
    INSERT INTO data_sources (
      id,workspace_id,organization_id,brand_id,source_type,provider,
      connection_method,name,role,status
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','fixture',
      'csv','Governance fixture',jsonb_build_object('ownership','workspace'),'active')
  `, [IDS.sourceA, workspaceA, IDS.organizationA, IDS.brandA]);
  return { workspaceA, workspaceB };
}

function brandPolicyDefinition(workspaceId: string, brandId: string): SignalPopulationPolicyBundleDefinitionV1 {
  return {
    contract_version: "signal-governed-views-v1",
    workspace_id: workspaceId,
    policy_key: "operational-brand-governed",
    policy_version: 1,
    authorized_modules: ["brand-monitoring", "mentions", "topics-narratives"],
    allowed_scopes: ["primary_brand"],
    allowed_entities: [{ scope: "primary_brand", entity_type: "brand", entity_id: brandId }],
    acceptance_status: "included",
    quality_contract_status: "resolved",
    quality_policy_key: "fixture-quality",
    quality_policy_version: 1,
    min_quality_score: null,
    required_quality_flags: [],
    forbidden_quality_flags: [],
    eligibility_policy: "semantic-approved-eligible",
    deduplication_policy: "canonical-root",
    visibility_class: "client-safe",
    denominator_key: "eligible-canonical-roots",
    period_start: null,
    period_end: null,
    timezone: null,
    retention_policy_ref: "fixture-retention",
    licensing_policy_ref: "fixture-license",
    data_governance_contract_status: "not_available",
    quality_policy_id: null,
    required_usage_purposes: []
  };
}

async function operationalV1State(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT to_jsonb(pointer.*) AS pointer,to_jsonb(definition.*) AS definition,
      COALESCE((SELECT jsonb_agg(to_jsonb(membership.*) ORDER BY membership.mention_id)
        FROM signal_population_memberships membership
        WHERE membership.population_id=pointer.population_id),'[]'::jsonb) AS memberships
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition ON definition.id=pointer.population_id
    WHERE pointer.workspace_id=$1::uuid AND pointer.purpose='operational'
  `, [workspaceId]);
}

async function applyMigrationsThrough(client: pg.Client, maximum: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= maximum)
    .sort();
  for (const file of files) await applyMigration(client, file);
}

async function applyMigration(client: pg.Client, file: string) {
  await client.query("BEGIN");
  try {
    await client.query(await readFile(join(migrationDir, file), "utf8"));
    await client.query("COMMIT");
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

async function expectSqlState(client: pg.Client, expected: string, sql: string, params: unknown[] = []) {
  await assert.rejects(client.query(sql, params), (error: unknown) => (error as { code?: string }).code === expected);
}

async function scalar<T>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(sql, params);
  const value = Object.values(result.rows[0] ?? {})[0];
  assert.notEqual(value, undefined);
  return value as T;
}

async function row<T extends Record<string, unknown>>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<T>(sql, params);
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

function hash(seed: string) {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}
