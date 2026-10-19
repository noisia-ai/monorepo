import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  signalDataUsagePurposesForModuleViewV1,
  type SignalClientGovernedViewModuleKeyV1,
  type SignalFilterV1
} from "@noisia/query-engine";
import pg from "pg";

import {
  loadSignalGovernedViewBindingSetPreflightV1,
  promoteSignalGovernedViewBindingSetV1,
  withdrawSignalGovernedViewBindingSetV1
} from "../src/lib/data-os/signal-governed-view-bindings";
import {
  ensureSignalGovernedViewPolicyDraftV1,
  reconcileSignalGovernedViewPolicyCandidateV1,
  resolveSignalGovernedViewPolicyDraftGovernanceV1,
  signalGovernedViewPolicyIdentityV1
} from "../src/lib/data-os/signal-governed-view-policy";
import { runSignalGovernedViewBindingShadowV1 } from
  "../src/lib/data-os/signal-governed-view-shadow";
import {
  createPostgresSignalGovernedViewResolverStore,
  resolveSignalGovernedViewV1
} from "../src/lib/data-os/signal-governed-view-resolver";
import {
  resolveSignalGovernedMultiViewFilterV1,
  resolveSignalGovernedBindingResumeV1,
  resolveSignalGovernedMultiViewRestorePointV1,
  runSignalGovernedBindingPhaseWithCompensationV1
} from
  "../src/lib/data-os/signal-governed-multi-view-rehearsal";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "../src/lib/data-os/signal-workspace";

const DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const VIEWS = ["competition", "category", "all-governed"] as const;
const MODULES = [
  "brand-monitoring",
  "mentions",
  "topics-narratives"
] as const satisfies readonly SignalClientGovernedViewModuleKeyV1[];
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION_DIRECTORY = resolve(REPOSITORY_ROOT, "infrastructure/db/migrations");
const OUTPUT_DIRECTORY = resolve(
  REPOSITORY_ROOT,
  ".data/signal-governed-serving/backend-06"
);
const APPLICATION_PREFIX = "noisia-backend-06-multi-view";

type ViewKey = (typeof VIEWS)[number];
type Mode = "preflight" | "apply" | "verify";
type Queryable = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};

type WorkspaceIdentity = {
  workspace_id: string;
  organization_id: string;
  brand_id: string;
  workspace_slug: string;
  workspace_name: string;
  workspace_status: string;
  timezone: string;
};

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeKey(kind: string, value: string) {
  return `${kind}_${sha256(`${kind}:${value}`).slice(7, 19)}`;
}

function sanitizedErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Backend 06 rehearsal failed.";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu,"[database-url-redacted]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
      "[id-redacted]");
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readMode(): Mode {
  const value = (process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_REHEARSAL_MODE
    ?? "preflight").trim().toLowerCase();
  if (value === "preflight" || value === "apply" || value === "verify") return value;
  throw new Error("Multi-view rehearsal mode must be preflight, apply or verify.");
}

function connectionFingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
  ].join("|"));
}

function projectRef(value: string, kind: "direct" | "pooler") {
  const parsed = new URL(value);
  if (kind === "direct") {
    const match = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname.toLowerCase());
    if (!match?.[1]) throw new Error("Direct URL does not expose a Supabase project ref.");
    return match[1];
  }
  const username = /^postgres\.([a-z0-9]+)$/u.exec(
    decodeURIComponent(parsed.username).toLowerCase()
  );
  if (username?.[1]) return username[1];
  const host = /^([a-z0-9]+)\.[a-z0-9.-]*pooler\.supabase\.com$/u.exec(
    parsed.hostname.toLowerCase()
  );
  if (!host?.[1]) throw new Error("Pooler URL does not expose a Supabase project ref.");
  return host[1];
}

function ssl() {
  return process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
}

function assertRemoteGuards(mode: Mode, directUrl: string, poolerUrl: string) {
  if (process.env.NOISIA_REMOTE_DATABASE_TARGET !== "preview") {
    throw new Error("Backend 06 is restricted to an explicitly classified preview target.");
  }
  if (process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_REHEARSAL_ALLOW_REMOTE !== "true") {
    throw new Error("Backend 06 remote read approval is required.");
  }
  if (connectionFingerprint(directUrl) !== DIRECT_FINGERPRINT
    || connectionFingerprint(poolerUrl) !== POOLER_FINGERPRINT) {
    throw new Error("Backend 06 connection fingerprint mismatch.");
  }
  const directRef = projectRef(directUrl, "direct");
  const poolerRef = projectRef(poolerUrl, "pooler");
  if (directRef !== poolerRef || sha256(directRef) !== PROJECT_REF_HASH) {
    throw new Error("Direct and pooler URLs do not identify audited noisia-staging.");
  }
  const restore = resolveSignalGovernedMultiViewRestorePointV1(required(
    "NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_RESTORE_POINT_AT"
  ));
  if (process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_RESTORE_VERIFIED !== "true"
    || required("NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_RESTORE_REFERENCE").length < 8) {
    throw new Error("Backend 06 requires a fresh, verified restore point.");
  }
  if (mode === "apply") {
    if (process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_REHEARSAL_APPLY_APPROVED !== "true"
      || process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_ISOLATED_TARGET_CONFIRMED !== "true"
      || !/^sha256:[0-9a-f]{64}$/u.test(
        process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_EXPECTED_PROTECTED_DIGEST ?? ""
      )) {
      throw new Error("Backend 06 apply guards are incomplete.");
    }
  }
  return {
    project_ref_hash: PROJECT_REF_HASH,
    ...restore
  };
}

async function connect(value: string, name: string) {
  const client = new pg.Client({
    connectionString: value,
    ssl: ssl(),
    application_name: `${APPLICATION_PREFIX}-${name}`
  });
  await client.connect();
  return client;
}

async function localMigrationChecksums() {
  const rows = [];
  for (let ordinal = 59; ordinal <= 73; ordinal += 1) {
    const prefix = String(ordinal).padStart(4, "0");
    const files = [
      "0059_signal_workspace_owned_data_plane.sql",
      "0060_signal_operational_population_serving.sql",
      "0061_signal_operational_membership_invalidation_shadow_outbox.sql",
      "0062_signal_strategic_consumption.sql",
      "0063_signal_strategic_run_outbox_recovery.sql",
      "0064_signal_semantic_scope_hardening.sql",
      "0065_signal_semantic_resolution.sql",
      "0066_signal_semantic_resolution_message_batches.sql",
      "0067_signal_canonical_mention_governance.sql",
      "0068_signal_governed_views_population_policies.sql",
      "0069_signal_data_governance_policies.sql",
      "0070_signal_semantic_base_isolation.sql",
      "0071_signal_governed_brand_binding_withdrawal.sql",
      "0072_signal_governed_brand_binding_set_integrity.sql",
      "0073_signal_governed_multi_view_binding_sets.sql"
    ];
    const file = files.find((entry) => entry.startsWith(prefix));
    if (!file) throw new Error(`Local migration ${prefix} is unavailable.`);
    rows.push({ ordinal, migration_name: file, checksum_sha256: sha256(await readFile(
      resolve(MIGRATION_DIRECTORY, file)
    )) });
  }
  return rows;
}

async function inspectLedger(client: Queryable) {
  const expected = await localMigrationChecksums();
  const rows = (await client.query<{
    migration_name: string;
    ordinal: number;
    checksum_sha256: string;
    disposition: string;
  }>(`
    SELECT migration_name,ordinal,checksum_sha256,disposition
    FROM ${LEDGER} WHERE ordinal BETWEEN 59 AND 73 ORDER BY ordinal
  `)).rows;
  if (rows.length !== expected.length) {
    throw new Error("Backend 06 requires an exact 0059-0073 migration ledger.");
  }
  for (const item of expected) {
    const persisted = rows.find((row) => row.ordinal === item.ordinal);
    if (!persisted || persisted.migration_name !== item.migration_name
      || persisted.checksum_sha256 !== item.checksum_sha256
      || !["applied","adopted","prerequisite_repaired"].includes(persisted.disposition)
      || (item.ordinal === 73 && persisted.disposition !== "applied")) {
      throw new Error(`Migration ledger mismatch at ${String(item.ordinal).padStart(4, "0")}.`);
    }
  }
  return { rows, digest: sha256(stableJson(rows)) };
}

async function inspectWorkspace(client: Queryable): Promise<WorkspaceIdentity> {
  const rows = (await client.query<WorkspaceIdentity>(`
    SELECT workspace.id::text AS workspace_id,workspace.organization_id::text,
      workspace.brand_id::text,workspace.slug AS workspace_slug,
      brand.name AS workspace_name,workspace.status AS workspace_status,workspace.timezone
    FROM brands brand JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
    WHERE brand.slug='laika'
  `)).rows;
  if (rows.length !== 1 || rows[0]!.workspace_status !== "active") {
    throw new Error("Backend 06 requires exactly one active Laika workspace.");
  }
  return rows[0]!;
}

async function inspectActor(client: Queryable, workspaceId: string): Promise<SignalWorkspaceUser> {
  const rows = (await client.query<{
    id: string;
    user_type: string;
    organization_id: string | null;
  }>(`
    SELECT actor.id::text,actor.user_type,actor.organization_id::text
    FROM signal_population_policy_bundles brand_bundle
    JOIN users actor ON actor.id=COALESCE(
      brand_bundle.activated_by_user_id,brand_bundle.created_by_user_id
    )
    WHERE brand_bundle.workspace_id=$1::uuid
      AND brand_bundle.policy_key='operational-brand-governed'
      AND brand_bundle.policy_version=1 AND actor.status='active'
      AND actor.user_type='noisia_internal'
      AND signal_data_governance_actor_is_valid($1::uuid,actor.id)
    ORDER BY (brand_bundle.status='active') DESC,brand_bundle.updated_at DESC LIMIT 1
  `, [workspaceId])).rows;
  const actor = rows[0];
  if (!actor) throw new Error("No internal server-owned actor can execute Backend 06.");
  return { id: actor.id, userType: actor.user_type, organizationId: actor.organization_id };
}

async function loadWorkspace(
  client: Queryable,
  identity: WorkspaceIdentity
): Promise<ResolvedSignalWorkspace> {
  const corpora = (await client.query<{
    id: string;
    name: string | null;
    role: "operational" | "strategic" | "legacy";
    status: string;
    valid_from: string;
    methodology_slug: string | null;
    output_id: string | null;
  }>(`
    SELECT corpus.id::text,corpus.name,relation.role,corpus.status,
      relation.valid_from::text,methodology.slug AS methodology_slug,
      (SELECT output.id::text FROM published_outputs output
       WHERE output.study_corpus_id=corpus.id AND output.status='published'
         AND output.archived_at IS NULL ORDER BY output.published_at DESC NULLS LAST LIMIT 1
      ) AS output_id
    FROM signal_workspace_corpora relation
    JOIN study_corpora corpus ON corpus.id=relation.study_corpus_id
    LEFT JOIN methodologies methodology ON methodology.id=corpus.methodology_id
    WHERE relation.workspace_id=$1::uuid AND relation.valid_to IS NULL
    ORDER BY relation.role,relation.valid_from DESC
  `, [identity.workspace_id])).rows;
  return {
    contractVersion: "signal-backend-v1",
    id: identity.workspace_id,
    organizationId: identity.organization_id,
    slug: identity.workspace_slug,
    name: identity.workspace_name,
    subject: { type: "brand", id: identity.brand_id },
    timezone: identity.timezone,
    status: identity.workspace_status,
    corpora: corpora.map((corpus) => ({
      id: corpus.id,
      name: corpus.name,
      role: corpus.role,
      status: corpus.status,
      validFrom: corpus.valid_from,
      methodologySlug: corpus.methodology_slug,
      outputId: corpus.output_id
    }))
  };
}

async function digestRows(client: Queryable, sql: string, values: unknown[] = []) {
  return (await client.query<{ row_count: number; digest: string }>(`
    SELECT count(*)::int AS row_count,
      'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(value.*)::text,
        E'\\n' ORDER BY to_jsonb(value.*)::text),''),'UTF8')),'hex') AS digest
    FROM (${sql}) value
  `, values)).rows[0]!;
}

async function inspectProtectedState(client: Queryable, workspaceId: string) {
  // node-postgres serializes one query at a time per Client. Keep these snapshots
  // explicitly sequential so a remote rehearsal never relies on its deprecated
  // concurrent-query queueing behaviour.
  const v1 = await digestRows(client, `
      SELECT population.*,membership.mention_id,membership.membership_status,
        membership.membership_reason,membership.removed_at
      FROM signal_population_definitions population
      LEFT JOIN signal_population_memberships membership ON membership.population_id=population.id
      WHERE population.workspace_id=$1::uuid
        AND population.population_key='primary-brand-operational'
        AND population.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    `, [workspaceId]);
  const base = await digestRows(client, `
      SELECT population.*,membership.mention_id,membership.membership_status,
        membership.membership_reason,membership.removed_at
      FROM signal_population_definitions population
      LEFT JOIN signal_population_memberships membership ON membership.population_id=population.id
      WHERE population.workspace_id=$1::uuid
        AND population.definition->>'contract_version'
          ='signal-operational-primary-brand-semantic-v2'
    `, [workspaceId]);
  const brand = await digestRows(client, `
      SELECT protected.kind,protected.payload FROM (
        SELECT 'bundle'::text AS kind,to_jsonb(bundle) AS payload
        FROM signal_population_policy_bundles bundle
        WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key='operational-brand-governed'
        UNION ALL SELECT 'derivation',to_jsonb(derivation)
        FROM signal_governed_view_population_derivations derivation
        JOIN signal_population_policy_bundles bundle ON bundle.id=derivation.policy_bundle_id
        WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key='operational-brand-governed'
        UNION ALL SELECT 'resolved-membership',to_jsonb(membership)
        FROM signal_population_memberships membership
        JOIN signal_governed_view_population_derivations derivation
          ON derivation.resolved_population_id=membership.population_id
        JOIN signal_population_policy_bundles bundle ON bundle.id=derivation.policy_bundle_id
        WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key='operational-brand-governed'
        UNION ALL SELECT 'compilation',to_jsonb(compilation)
        FROM signal_population_policy_compilations compilation
        JOIN signal_population_policy_bundles bundle ON bundle.id=compilation.policy_bundle_id
        WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key='operational-brand-governed'
        UNION ALL SELECT 'binding',to_jsonb(binding)
        FROM signal_governed_view_bindings binding
        JOIN signal_population_policy_bundles bundle ON bundle.id=binding.policy_bundle_id
        WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key='operational-brand-governed'
        UNION ALL SELECT 'binding-event',to_jsonb(event)
        FROM signal_governed_view_binding_events event
        WHERE event.workspace_id=$1::uuid AND event.view_key='brand'
        UNION ALL SELECT 'binding-set-operation',to_jsonb(operation)
        FROM signal_governed_brand_binding_set_operations operation
        WHERE operation.workspace_id=$1::uuid AND operation.view_key='brand'
        UNION ALL SELECT 'binding-set-item',to_jsonb(item)
        FROM signal_governed_brand_binding_set_operation_items item
        WHERE item.workspace_id=$1::uuid AND item.view_key='brand'
      ) protected
    `, [workspaceId]);
  const pointers = await digestRows(
    client,
    `SELECT * FROM signal_workspace_population_pointers ORDER BY id`
  );
  const semantic = await digestRows(client, `
      SELECT assertion.*,event.id AS review_event_id,event.action AS review_action,
        event.created_at AS review_at,to_jsonb(event) AS review_event
      FROM signal_mention_attributions assertion
      LEFT JOIN signal_mention_attribution_review_events event
        ON event.attribution_id=assertion.id
      WHERE assertion.workspace_id=$1::uuid
        AND assertion.attribution_basis='mention_semantic'
    `, [workspaceId]);
  const otherWorkspaces = await digestRows(client, `
      SELECT protected.kind,protected.payload FROM (
        SELECT 'bundle'::text AS kind,to_jsonb(bundle) AS payload
        FROM signal_population_policy_bundles bundle WHERE bundle.workspace_id<>$1::uuid
        UNION ALL SELECT 'population',to_jsonb(population)
        FROM signal_population_definitions population WHERE population.workspace_id<>$1::uuid
        UNION ALL SELECT 'population-membership',to_jsonb(membership)
        FROM signal_population_memberships membership
        JOIN signal_population_definitions population ON population.id=membership.population_id
        WHERE population.workspace_id<>$1::uuid
        UNION ALL SELECT 'population-pointer',to_jsonb(pointer)
        FROM signal_workspace_population_pointers pointer WHERE pointer.workspace_id<>$1::uuid
        UNION ALL SELECT 'semantic-assertion',to_jsonb(assertion)
        FROM signal_mention_attributions assertion
        WHERE assertion.workspace_id<>$1::uuid
          AND assertion.attribution_basis='mention_semantic'
        UNION ALL SELECT 'semantic-review-event',to_jsonb(event)
        FROM signal_mention_attribution_review_events event
        JOIN signal_mention_attributions assertion ON assertion.id=event.attribution_id
        WHERE assertion.workspace_id<>$1::uuid
        UNION ALL SELECT 'derivation',to_jsonb(derivation)
        FROM signal_governed_view_population_derivations derivation
        WHERE derivation.workspace_id<>$1::uuid
        UNION ALL SELECT 'resolved-membership',to_jsonb(membership)
        FROM signal_population_memberships membership
        JOIN signal_governed_view_population_derivations derivation
          ON derivation.resolved_population_id=membership.population_id
        WHERE derivation.workspace_id<>$1::uuid
        UNION ALL SELECT 'compilation',to_jsonb(compilation)
        FROM signal_population_policy_compilations compilation
        WHERE compilation.workspace_id<>$1::uuid
        UNION ALL SELECT 'binding',to_jsonb(binding)
        FROM signal_governed_view_bindings binding WHERE binding.workspace_id<>$1::uuid
        UNION ALL SELECT 'binding-event',to_jsonb(event)
        FROM signal_governed_view_binding_events event WHERE event.workspace_id<>$1::uuid
        UNION ALL SELECT 'binding-set-operation',to_jsonb(operation)
        FROM signal_governed_brand_binding_set_operations operation
        WHERE operation.workspace_id<>$1::uuid
        UNION ALL SELECT 'binding-set-item',to_jsonb(item)
        FROM signal_governed_brand_binding_set_operation_items item
        WHERE item.workspace_id<>$1::uuid
        UNION ALL SELECT 'governance-evaluation',to_jsonb(evaluation)
        FROM signal_data_governance_evaluations evaluation
        WHERE evaluation.workspace_id<>$1::uuid
        UNION ALL SELECT 'governance-evaluation-item',to_jsonb(item)
        FROM signal_data_governance_evaluation_items item
        WHERE item.workspace_id<>$1::uuid
        UNION ALL SELECT 'watermark',to_jsonb(watermark)
        FROM signal_data_watermarks watermark WHERE watermark.workspace_id<>$1::uuid
        UNION ALL SELECT 'governance-invalidation',to_jsonb(invalidation)
        FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.workspace_id<>$1::uuid
        UNION ALL SELECT 'quality-policy',to_jsonb(policy)
        FROM signal_quality_policies policy WHERE policy.workspace_id<>$1::uuid
        UNION ALL SELECT 'retention-policy',to_jsonb(policy)
        FROM signal_retention_policies policy WHERE policy.workspace_id<>$1::uuid
        UNION ALL SELECT 'licensing-policy',to_jsonb(policy)
        FROM signal_licensing_policies policy WHERE policy.workspace_id<>$1::uuid
        UNION ALL SELECT 'licensing-usage',to_jsonb(usage)
        FROM signal_licensing_policy_usages usage
        JOIN signal_licensing_policies policy ON policy.id=usage.licensing_policy_id
        WHERE policy.workspace_id<>$1::uuid
        UNION ALL SELECT 'provenance-policy-binding',to_jsonb(binding)
        FROM signal_provenance_policy_bindings binding WHERE binding.workspace_id<>$1::uuid
      ) protected
    `, [workspaceId]);
  const syncs = await digestRows(
    client,
    `SELECT id,workspace_id,data_source_id,status,started_at,finished_at
      FROM source_sync_runs WHERE status='running' ORDER BY id`
  );
  const state = { v1, base, brand, pointers, semantic, other_workspaces: otherWorkspaces, syncs };
  return { ...state, aggregate_digest: sha256(stableJson(state)) };
}

async function inspectCompilationInputs(client: Queryable, workspaceId: string) {
  const mentions = await digestRows(client, `
      SELECT mention.id,mention.canonical_mention_id,mention.inclusion_status,
        mention.quality_score,mention.quality_flags,mention.updated_at,
        assertion.id AS assertion_id,assertion.scope,assertion.entity_type,
        assertion.entity_id,assertion.review_status,assertion.eligibility_status,
        assertion.is_current,assertion.updated_at AS assertion_updated_at
      FROM mentions mention
      LEFT JOIN signal_mention_attributions assertion
        ON assertion.workspace_id=mention.workspace_id AND assertion.mention_id=mention.id
       AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
      WHERE mention.workspace_id=$1::uuid AND mention.canonical_mention_id=mention.id
    `, [workspaceId]);
  const entities = await digestRows(client, `
      SELECT governed.* FROM (
        SELECT workspace.id AS workspace_id,'primary_brand'::text AS scope,
          'brand'::text AS entity_type,workspace.brand_id AS entity_id,
          workspace.status AS authority_status
        FROM signal_workspaces workspace WHERE workspace.id=$1::uuid
        UNION ALL
        SELECT workspace.id,'competitor','competitor',competitor.id,
          CASE WHEN seed.active THEN 'active' ELSE 'retired' END
        FROM signal_workspaces workspace JOIN competitors competitor
          ON competitor.brand_id=workspace.brand_id
        JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
        WHERE workspace.id=$1::uuid
        UNION ALL
        SELECT workspace.id,entity.entity_type,entity.entity_type,entity.id,entity.status
        FROM signal_workspaces workspace JOIN intelligence_entities entity
          ON entity.organization_id=workspace.organization_id
         AND entity.brand_id=workspace.brand_id
        WHERE workspace.id=$1::uuid AND entity.entity_type IN ('category','reference')
      ) governed
    `, [workspaceId]);
  const provenance = await digestRows(client, `
      SELECT membership.*,batch.status AS import_status,batch.created_at AS import_created_at,
        source.status AS source_status,source.updated_at AS source_updated_at
      FROM signal_mention_import_memberships membership
      JOIN import_batches batch ON batch.id=membership.import_batch_id
      JOIN data_sources source ON source.id=membership.data_source_id
      WHERE membership.workspace_id=$1::uuid
    `, [workspaceId]);
  const governance = await digestRows(client, `
      SELECT object_kind,object_id,version,status,effective_from,effective_to,
        retain_until,definition_hash,detail
      FROM (
        SELECT 'quality'::text AS object_kind,quality.id AS object_id,
          quality.policy_version::text AS version,quality.status,quality.effective_from,
          quality.effective_to,NULL::timestamptz AS retain_until,
          quality.definition_hash,NULL::jsonb AS detail
        FROM signal_quality_policies quality WHERE quality.workspace_id=$1::uuid
        UNION ALL
        SELECT 'retention',retention.id,retention.policy_version::text,retention.status,
          retention.effective_from,retention.effective_to,retention.retain_until,
          retention.definition_hash,NULL::jsonb
        FROM signal_retention_policies retention WHERE retention.workspace_id=$1::uuid
        UNION ALL
        SELECT 'licensing',licensing.id,licensing.policy_version::text,licensing.status,
          licensing.effective_from,licensing.effective_to,NULL,
          licensing.definition_hash,COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'usage',usage.usage_purpose,'decision',usage.decision
          ) ORDER BY usage.usage_purpose) FROM signal_licensing_policy_usages usage
          WHERE usage.licensing_policy_id=licensing.id),'[]'::jsonb)
        FROM signal_licensing_policies licensing WHERE licensing.workspace_id=$1::uuid
        UNION ALL
        SELECT 'provenance-binding',binding.id,binding.binding_version::text,binding.status,
          binding.effective_from,binding.effective_to,NULL,binding.definition_hash,
          jsonb_build_object('source',binding.data_source_id,'import',binding.import_batch_id,
            'quality',binding.quality_policy_id,'retention',binding.retention_policy_id,
            'licensing',binding.licensing_policy_id)
        FROM signal_provenance_policy_bindings binding WHERE binding.workspace_id=$1::uuid
      ) authority
    `, [workspaceId]);
  const state = { mentions,entities,provenance,governance };
  return { ...state,aggregate_digest: sha256(stableJson(state)) };
}

async function inspectConnections(client: Queryable) {
  const row = (await client.query<{
    active_incompatible: number;
    named_apps: number;
    active_writers: number;
  }>(`
    SELECT count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name NOT LIKE '${APPLICATION_PREFIX}%')::int AS active_incompatible,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND COALESCE(application_name,'') ~* '(studio|worker|bullmq)')::int AS named_apps,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND query !~* '^\\s*(select|show|set|begin|commit|rollback)')::int AS active_writers
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
  if (row.active_incompatible > 0 || row.named_apps > 0 || row.active_writers > 0) {
    throw new Error("An incompatible application or writer is connected to noisia-staging.");
  }
  return row;
}

async function inspectQualityPolicy(client: Queryable, workspaceId: string) {
  const rows = (await client.query<{ quality_policy_id: string }>(`
    SELECT quality.id::text AS quality_policy_id
    FROM signal_population_policy_bundles bundle
    JOIN signal_quality_policies quality ON quality.id=bundle.quality_policy_id
      AND quality.workspace_id=bundle.workspace_id
    WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key='operational-brand-governed'
      AND bundle.policy_version=1 AND bundle.status='active'
      AND quality.status='active' AND quality.canonical_root_disposition='evaluate'
      AND quality.effective_from<=now()
      AND (quality.effective_to IS NULL OR quality.effective_to>now())
  `, [workspaceId])).rows;
  if (rows.length !== 1) throw new Error("Backend 06 requires the active 04B quality authority.");
  return rows[0]!.quality_policy_id;
}

async function inspectViewDryRun(
  client: Queryable,
  workspace: WorkspaceIdentity,
  viewKey: ViewKey,
  moduleKey: SignalClientGovernedViewModuleKeyV1
) {
  const usages = signalDataUsagePurposesForModuleViewV1(moduleKey, viewKey);
  const row = (await client.query<{
    governed_entity_count: number;
    candidate_root_count: number;
    authorized_root_count: number;
    known_blocked_count: number;
    governance_unknown_count: number;
    candidate_digest: string;
    expected_membership_digest: string;
    period_start: string;
    period_end: string;
  }>(`
    WITH entities AS (
      SELECT governed.scope,governed.entity_type,governed.entity_id
      FROM (
        SELECT 'primary_brand'::text AS scope,'brand'::text AS entity_type,
          workspace.brand_id AS entity_id FROM signal_workspaces workspace
        WHERE workspace.id=$1::uuid
        UNION ALL
        SELECT 'competitor','competitor',competitor.id FROM competitors competitor
        JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active
        WHERE competitor.brand_id=$2::uuid
        UNION ALL
        SELECT entity.entity_type,entity.entity_type,entity.id FROM intelligence_entities entity
        WHERE entity.organization_id=$3::uuid AND entity.brand_id=$2::uuid
          AND entity.entity_type IN ('category','reference') AND entity.status='active'
      ) governed WHERE CASE $4::text
        WHEN 'competition' THEN governed.scope='competitor'
        WHEN 'category' THEN governed.scope='category'
        WHEN 'all-governed' THEN governed.scope IN (
          'primary_brand','competitor','category','reference'
        ) ELSE false END
    ), roots AS (
      SELECT DISTINCT mention.id,mention.published_at,mention.quality_score,
        COALESCE(mention.quality_flags,'[]'::jsonb) AS quality_flags
      FROM mentions mention JOIN signal_mention_attributions assertion
        ON assertion.workspace_id=mention.workspace_id AND assertion.mention_id=mention.id
      JOIN entities ON entities.scope=assertion.scope
        AND entities.entity_type=assertion.entity_type AND entities.entity_id=assertion.entity_id
      WHERE mention.workspace_id=$1::uuid AND mention.canonical_mention_id=mention.id
        AND mention.inclusion_status='included'
        AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
        AND assertion.review_status='approved' AND assertion.eligibility_status='eligible'
    ), paths AS (
      SELECT root.id AS mention_id,
        CASE WHEN binding.id IS NULL OR quality.id IS NULL OR retention.id IS NULL
          OR licensing.id IS NULL THEN 'unknown'
          WHEN quality.canonical_root_disposition<>'evaluate' THEN 'unknown'
          WHEN quality.min_quality_score IS NOT NULL
            AND COALESCE(root.quality_score,-1)<quality.min_quality_score THEN 'known_blocked'
          WHEN EXISTS (SELECT 1 FROM unnest(quality.required_quality_flags) required(flag)
            WHERE NOT (root.quality_flags ? required.flag)) THEN 'known_blocked'
          WHEN EXISTS (SELECT 1 FROM unnest(quality.forbidden_quality_flags) forbidden(flag)
            WHERE root.quality_flags ? forbidden.flag) THEN 'known_blocked'
          WHEN retention.retention_state='not_available' THEN 'unknown'
          WHEN retention.retention_state='blocked'
            OR (retention.retention_mode='until' AND retention.retain_until<=now())
            THEN 'known_blocked'
          WHEN EXISTS (SELECT 1 FROM unnest($5::text[]) required(purpose)
            WHERE NOT EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage
              WHERE usage.licensing_policy_id=licensing.id
                AND usage.usage_purpose=required.purpose AND usage.decision='allowed'))
            THEN CASE WHEN EXISTS (SELECT 1 FROM unnest($5::text[]) required(purpose)
              JOIN signal_licensing_policy_usages usage
                ON usage.licensing_policy_id=licensing.id
               AND usage.usage_purpose=required.purpose AND usage.decision='prohibited')
              THEN 'known_blocked' ELSE 'unknown' END
          ELSE 'authorized' END AS state
      FROM roots root
      LEFT JOIN mentions provenance_mention
        ON provenance_mention.workspace_id=$1::uuid
       AND provenance_mention.canonical_mention_id=root.id
      LEFT JOIN signal_mention_import_memberships membership
        ON membership.workspace_id=$1::uuid AND membership.mention_id=provenance_mention.id
      LEFT JOIN import_batches batch ON batch.id=membership.import_batch_id
      LEFT JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=$1::uuid
          AND candidate.data_source_id=membership.data_source_id
          AND candidate.status='active' AND candidate.effective_from<=now()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
          AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
        ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,
          candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
      LEFT JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
        AND quality.status='active' AND quality.effective_from<=now()
        AND (quality.effective_to IS NULL OR quality.effective_to>now())
      LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.status='active' AND retention.effective_from<=now()
        AND (retention.effective_to IS NULL OR retention.effective_to>now())
      LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.status='active' AND licensing.effective_from<=now()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>now())
    ), decisions AS (
      SELECT root.id,CASE WHEN bool_or(paths.state='authorized') THEN 'authorized'
        WHEN bool_or(paths.state='known_blocked') THEN 'known_blocked' ELSE 'unknown' END AS state
      FROM roots root LEFT JOIN paths ON paths.mention_id=root.id GROUP BY root.id
    ) SELECT (SELECT count(*)::int FROM entities) AS governed_entity_count,
      (SELECT count(*)::int FROM roots) AS candidate_root_count,
      count(*) FILTER (WHERE state='authorized')::int AS authorized_root_count,
      count(*) FILTER (WHERE state='known_blocked')::int AS known_blocked_count,
      count(*) FILTER (WHERE state='unknown')::int AS governance_unknown_count,
      'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(id::text,',' ORDER BY id),''),
        'UTF8')),'hex') AS candidate_digest,
      'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(id::text,',' ORDER BY id)
        FILTER (WHERE state='authorized'),''),'UTF8')),'hex') AS expected_membership_digest
      ,(SELECT min((root.published_at AT TIME ZONE $6)::date)::text FROM roots root)
        AS period_start
      ,(SELECT max((root.published_at AT TIME ZONE $6)::date)::text FROM roots root)
        AS period_end
    FROM decisions
  `, [workspace.workspace_id,workspace.brand_id,workspace.organization_id,viewKey,usages,
    workspace.timezone])).rows[0]!;
  if (row.governed_entity_count === 0 || row.candidate_root_count === 0
    || row.governance_unknown_count > 0 || !row.period_start || !row.period_end) {
    throw new Error(`${viewKey}/${moduleKey} has no governed roots or unresolved governance.`);
  }
  return { module_key: moduleKey,view_key: viewKey,usage_purposes: usages,...row };
}

function assertDryRunMatchesCompilation(args: {
  viewKey: ViewKey;
  dryRun: Awaited<ReturnType<typeof inspectViewDryRun>>[];
  compilations: Awaited<ReturnType<typeof compileView>>;
}) {
  for (const compilation of args.compilations.normal) {
    const expected = args.dryRun.find((entry) => entry.view_key === args.viewKey
      && entry.module_key === compilation.module_key);
    if (!expected || expected.authorized_root_count !== compilation.actual_membership_count
      || expected.expected_membership_digest !== compilation.actual_membership_digest
      || compilation.governance_unknown_count !== 0) {
      throw new Error(`${args.viewKey}/${compilation.module_key} differs from its independent dry-run.`);
    }
  }
}

async function readOnlySnapshot(value: string, name: string) {
  const client = await connect(value, name);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='45s'");
    const database = (await client.query<{ database_name: string }>(
      "SELECT current_database() AS database_name"
    )).rows[0]!.database_name;
    const ledger = await inspectLedger(client);
    const workspace = await inspectWorkspace(client);
    const actor = await inspectActor(client, workspace.workspace_id);
    const qualityPolicyId = await inspectQualityPolicy(client, workspace.workspace_id);
    const protectedState = await inspectProtectedState(client, workspace.workspace_id);
    const compilationInputs = await inspectCompilationInputs(client,workspace.workspace_id);
    const dryRun = [];
    for (const viewKey of VIEWS) {
      for (const moduleKey of MODULES) {
        dryRun.push(await inspectViewDryRun(client,workspace,viewKey,moduleKey));
      }
    }
    const filter = resolveSignalGovernedMultiViewFilterV1(dryRun,workspace.timezone);
    await client.query("ROLLBACK");
    return {
      database_name_hash: sha256(database),ledger,workspace,
      actor_key: safeKey("actor",actor.id),quality_policy_key: safeKey("quality",qualityPolicyId),
      protected_state: protectedState,dry_run: dryRun,filter,filter_digest: sha256(stableJson(filter))
      ,compilation_inputs: compilationInputs
    };
  } finally {
    await client.end();
  }
}

function sanitizeSnapshot(value: Awaited<ReturnType<typeof readOnlySnapshot>>) {
  return {
    database_name_hash: value.database_name_hash,
    ledger_digest: value.ledger.digest,
    workspace_identity_hash: sha256(stableJson(value.workspace)),
    actor_key: value.actor_key,
    quality_policy_key: value.quality_policy_key,
    protected_state_digest: value.protected_state.aggregate_digest,
    compilation_inputs_digest: value.compilation_inputs.aggregate_digest,
    filter: value.filter,
    filter_digest: value.filter_digest,
    dry_run: value.dry_run
  };
}

async function createPreflight(directUrl: string, poolerUrl: string) {
  const [pooler, direct] = await Promise.all([
    readOnlySnapshot(poolerUrl,"pooler"),readOnlySnapshot(directUrl,"direct")
  ]);
  const directPublic = sanitizeSnapshot(direct);
  const poolerPublic = sanitizeSnapshot(pooler);
  if (stableJson(directPublic) !== stableJson(poolerPublic)) {
    throw new Error("Direct and pooler snapshots do not reconcile.");
  }
  const client = await connect(directUrl,"connection-audit");
  try {
    const connections = await inspectConnections(client);
    return { direct,directPublic,connections };
  } finally {
    await client.end();
  }
}

async function ensurePopulationWatermarks(args: {
  client: Queryable;
  workspaceId: string;
  viewKey: ViewKey;
  moduleKey: SignalClientGovernedViewModuleKeyV1;
  populationId: string;
  evaluationId: string;
}) {
  const sources = (await args.client.query<{
    source_id: string;
    study_corpus_id: string | null;
    latest_import_batch_id: string;
    accepted_at: string;
    max_observed_at: string;
    corpus_revision: number | null;
    lineage_digest: string;
  }>(`
    WITH selected AS (
      SELECT item.mention_id,membership.id AS import_membership_id,
        membership.data_source_id,membership.import_batch_id
      FROM signal_data_governance_evaluation_items item
      JOIN signal_mention_import_memberships membership
        ON membership.id=item.import_membership_id
      WHERE item.evaluation_id=$2::uuid AND item.decision='included'
    ), latest AS (
      SELECT DISTINCT ON (selected.data_source_id) selected.data_source_id,
        selected.import_batch_id,import.created_at,
        COALESCE(import.contributed_by_study_corpus_id,import.study_corpus_id) AS study_corpus_id
      FROM selected JOIN import_batches import ON import.id=selected.import_batch_id
      ORDER BY selected.data_source_id,import.created_at DESC,import.id DESC
    ) SELECT selected.data_source_id::text AS source_id,
      latest.study_corpus_id::text AS study_corpus_id,
      latest.import_batch_id::text AS latest_import_batch_id,
      latest.created_at::text AS accepted_at,max(mention.published_at)::text AS max_observed_at,
      (SELECT corpus.corpus_revision::int FROM study_corpora corpus
        JOIN signal_workspace_corpora relation ON relation.study_corpus_id=corpus.id
          AND relation.workspace_id=$1::uuid AND relation.valid_to IS NULL
        WHERE corpus.id=latest.study_corpus_id) AS corpus_revision,
      'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|',
        selected.import_membership_id::text,selected.mention_id::text,
        selected.import_batch_id::text,selected.data_source_id::text),E'\\n'
        ORDER BY selected.import_membership_id),''),'UTF8')),'hex') AS lineage_digest
    FROM selected JOIN latest ON latest.data_source_id=selected.data_source_id
    JOIN mentions mention ON mention.id=selected.mention_id
    GROUP BY selected.data_source_id,latest.import_batch_id,latest.created_at,
      latest.study_corpus_id
  `, [args.workspaceId,args.evaluationId])).rows;
  if (sources.length === 0 || sources.some((source) => !source.max_observed_at
    || !source.study_corpus_id || source.corpus_revision == null)) {
    throw new Error(`${args.viewKey}/${args.moduleKey} has no exact observed corpus lineage.`);
  }
  const created: Array<{ watermark_id: string; source_key: string; created: boolean }> = [];
  for (const source of sources) {
    const sourceKey = `governed-${args.viewKey}-${args.moduleKey}-${safeKey(
      "source",source.source_id
    )}-${source.lineage_digest.slice(7)}`;
    const existing = await args.client.query<{
      id: string;
      study_corpus_id: string | null;
      corpus_revision: number;
      last_import_batch_id: string | null;
      max_observed_at: string;
      accepted_at: string;
      lineage_digest: string | null;
    }>(`
      SELECT id::text,study_corpus_id::text,corpus_revision,last_import_batch_id::text,
        max_observed_at::text,accepted_at::text,metadata->>'lineage_digest' AS lineage_digest
      FROM signal_data_watermarks
      WHERE workspace_id=$1::uuid AND population_id=$2::uuid
        AND data_source_id=$3::uuid AND source_key=$4
    `, [args.workspaceId,args.populationId,source.source_id,sourceKey]);
    if (existing.rows.length > 1) throw new Error("Population watermark identity is ambiguous.");
    if (existing.rows[0]) {
      const persisted = existing.rows[0];
      if (persisted.study_corpus_id !== source.study_corpus_id
        || persisted.corpus_revision !== source.corpus_revision
        || persisted.last_import_batch_id !== source.latest_import_batch_id
        || Date.parse(persisted.max_observed_at) !== Date.parse(source.max_observed_at)
        || Date.parse(persisted.accepted_at) !== Date.parse(source.accepted_at)
        || persisted.lineage_digest !== source.lineage_digest) {
        throw new Error(`${args.viewKey}/${args.moduleKey} persisted watermark lineage drifted.`);
      }
      created.push({ watermark_id: existing.rows[0].id,source_key: sourceKey,created: false });
      continue;
    }
    const inserted = await args.client.query<{ id: string }>(`
      INSERT INTO signal_data_watermarks (
        workspace_id,study_corpus_id,population_id,data_source_id,source_key,
        corpus_revision,last_import_batch_id,max_observed_at,accepted_at,materialized_at,
        source_freshness_state,data_freshness_state,stale_after,metadata
      ) VALUES ($1::uuid,$12::uuid,$2::uuid,$3::uuid,$4,$5::int,$6::uuid,$7::timestamptz,
        $8::timestamptz,clock_timestamp(),'not_available','not_available',NULL,
        jsonb_build_object('contract_version','signal-governed-multi-view-watermark-v1',
          'module_key',$9::text,'view_key',$10::text,'lineage_digest',$11::text,
          'freshness_measurement','not_available')) RETURNING id::text
    `, [args.workspaceId,args.populationId,source.source_id,sourceKey,source.corpus_revision,
      source.latest_import_batch_id,source.max_observed_at,source.accepted_at,args.moduleKey,
      args.viewKey,source.lineage_digest,source.study_corpus_id]);
    created.push({ watermark_id: inserted.rows[0]!.id,source_key: sourceKey,created: true });
  }
  return created;
}

async function loadExistingBundle(client: Queryable, workspaceId: string, viewKey: ViewKey) {
  const identity = signalGovernedViewPolicyIdentityV1(viewKey);
  const rows = (await client.query<{
    id: string;
    status: "draft" | "active";
    quality_policy_id: string | null;
    data_governance_contract_status: string;
  }>(`
    SELECT id::text,status,quality_policy_id::text,data_governance_contract_status
    FROM signal_population_policy_bundles
    WHERE workspace_id=$1::uuid AND policy_key=$2 AND policy_version=$3
  `, [workspaceId,identity.policy_key,identity.policy_version])).rows;
  if (rows.length > 1) throw new Error(`${viewKey} policy identity is ambiguous.`);
  return rows[0] ?? null;
}

async function inspectBundleEntityAuthority(args: {
  client: Queryable;
  workspaceId: string;
  viewKey: ViewKey;
  policyBundleId: string;
}) {
  const result = await args.client.query<{
    current_entities_valid: boolean;
    registry_matches: boolean;
  }>(`
    WITH registry AS (
      SELECT governed.scope,governed.entity_type,governed.entity_id
      FROM (
        SELECT 'primary_brand'::text AS scope,'brand'::text AS entity_type,
          workspace.brand_id AS entity_id
        FROM signal_workspaces workspace WHERE workspace.id=$3::uuid
          AND workspace.status='active'
        UNION ALL
        SELECT 'competitor','competitor',competitor.id FROM signal_workspaces workspace
        JOIN competitors competitor ON competitor.brand_id=workspace.brand_id
        JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active
        WHERE workspace.id=$3::uuid
        UNION ALL
        SELECT entity.entity_type,entity.entity_type,entity.id
        FROM signal_workspaces workspace JOIN intelligence_entities entity
          ON entity.organization_id=workspace.organization_id
         AND entity.brand_id=workspace.brand_id
        WHERE workspace.id=$3::uuid AND entity.status='active'
          AND entity.entity_type IN ('category','reference')
      ) governed WHERE CASE $2::text
        WHEN 'competition' THEN governed.scope='competitor'
        WHEN 'category' THEN governed.scope='category'
        WHEN 'all-governed' THEN governed.scope IN (
          'primary_brand','competitor','category','reference'
        ) ELSE false END
    ), frozen AS (
      SELECT scope,entity_type,entity_id FROM signal_population_policy_entities
      WHERE workspace_id=$3::uuid AND policy_bundle_id=$1::uuid
    ) SELECT signal_governed_view_bundle_scopes_match_v1($1::uuid,$2)
        AS current_entities_valid,
      NOT EXISTS (SELECT * FROM registry EXCEPT SELECT * FROM frozen)
        AND NOT EXISTS (SELECT * FROM frozen EXCEPT SELECT * FROM registry)
        AS registry_matches
    FROM signal_population_policy_bundles bundle
    WHERE bundle.id=$1::uuid AND bundle.workspace_id=$3::uuid
  `, [args.policyBundleId,args.viewKey,args.workspaceId]);
  if (result.rows[0]?.current_entities_valid !== true) {
    throw new Error(`${args.viewKey} bundle does not match live governed entity authority.`);
  }
  return result.rows[0].registry_matches;
}

async function compileView(args: {
  client: Queryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: ViewKey;
  qualityPolicyId: string;
}) {
  let bundle = await loadExistingBundle(args.client,args.workspace.id,args.viewKey);
  if (!bundle) {
    const draft = await ensureSignalGovernedViewPolicyDraftV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
    });
    bundle = {
      id: draft.policy_bundle_id,status: "draft",quality_policy_id: null,
      data_governance_contract_status: "not_available"
    };
  }
  const registryMatches = await inspectBundleEntityAuthority({
    client: args.client,workspaceId: args.workspace.id,viewKey: args.viewKey,
    policyBundleId: bundle.id
  });
  if (!registryMatches) {
    throw new Error(`${args.viewKey} requires bundle_version_required for registry changes.`);
  }
  if (bundle.status === "draft") {
    await resolveSignalGovernedViewPolicyDraftGovernanceV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
      policyBundleId: bundle.id,qualityPolicyId: args.qualityPolicyId,queryable: args.client
    });
    if (!await inspectBundleEntityAuthority({
      client: args.client,workspaceId: args.workspace.id,viewKey: args.viewKey,
      policyBundleId: bundle.id
    })) {
      throw new Error(`${args.viewKey} draft does not contain the exact server-owned registry.`);
    }
  }
  const normal = [];
  for (const moduleKey of MODULES) {
    let result = await reconcileSignalGovernedViewPolicyCandidateV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
      policyBundleId: bundle.id,moduleKey,reconcileMemberships: true,queryable: args.client
    });
    if (result.governance_unknown_count === null
      || result.governance_unknown_count > 0
      || result.blocking_reasons.includes("data-governance-not-available")) {
      throw new Error(`${args.viewKey}/${moduleKey} has unresolved governance.`);
    }
    if (result.blocking_reasons.some((reason) => reason !== "data-watermark-not-available")) {
      throw new Error(`${args.viewKey}/${moduleKey} failed compilation: ${result.blocking_reasons.join(",")}`);
    }
    if (!result.governance_evaluation_id) {
      throw new Error(`${args.viewKey}/${moduleKey} did not persist a governance evaluation.`);
    }
    await ensurePopulationWatermarks({
      client: args.client,workspaceId: args.workspace.id,viewKey: args.viewKey,moduleKey,
      populationId: result.population_id,evaluationId: result.governance_evaluation_id
    });
    result = await reconcileSignalGovernedViewPolicyCandidateV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
      policyBundleId: bundle.id,moduleKey,reconcileMemberships: true,queryable: args.client
    });
    if (result.compilation_status !== "ready" || result.governance_unknown_count !== 0
      || !result.policy_matches_memberships || result.alias_membership_count !== 0) {
      throw new Error(`${args.viewKey}/${moduleKey} is not ready after observed watermarking.`);
    }
    normal.push(result);
  }
  const reverse = [];
  for (const moduleKey of [...MODULES].reverse()) {
    const result = await reconcileSignalGovernedViewPolicyCandidateV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
      policyBundleId: bundle.id,moduleKey,reconcileMemberships: true,queryable: args.client
    });
    const first = normal.find((entry) => entry.module_key === moduleKey)!;
    if (result.population_id !== first.population_id
      || result.actual_membership_digest !== first.actual_membership_digest
      || result.compiled_plan_hash !== first.compiled_plan_hash) {
      throw new Error(`${args.viewKey}/${moduleKey} is order-dependent.`);
    }
    reverse.push(result);
  }
  return { policy_bundle_id: bundle.id,normal,reverse };
}

function operationKey(workspaceId: string, viewKey: ViewKey, action: string) {
  return `backend-06:${workspaceId}:${viewKey}:${action}`;
}

async function operationExists(client: Queryable, workspaceId: string, rawKey: string) {
  const result = await client.query<{ present: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM signal_governed_brand_binding_set_operations
      WHERE workspace_id=$1::uuid AND idempotency_key=$2) AS present
  `, [workspaceId,sha256(rawKey.trim())]);
  return result.rows[0]?.present === true;
}

async function loadPromoteOperationCount(
  client: Queryable,
  workspaceId: string,
  viewKey: ViewKey
) {
  return (await client.query<{ operation_count: number }>(`
    SELECT count(*)::int AS operation_count
    FROM signal_governed_brand_binding_set_operations
    WHERE workspace_id=$1::uuid AND view_key=$2 AND action='promote'
  `,[workspaceId,viewKey])).rows[0]!.operation_count;
}

async function currentBindingsMatchPromoteOperation(args: {
  client: Queryable;
  workspaceId: string;
  viewKey: ViewKey;
  rawKey: string;
}) {
  return (await args.client.query<{ matches: boolean }>(`
    WITH expected AS (
      SELECT item.module_key,item.next_binding_id
      FROM signal_governed_brand_binding_set_operations operation
      JOIN signal_governed_brand_binding_set_operation_items item
        ON item.operation_id=operation.id
      WHERE operation.workspace_id=$1::uuid AND operation.view_key=$2
        AND operation.action='promote' AND operation.idempotency_key=$3
    ), current_set AS (
      SELECT module_key,id AS next_binding_id FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid AND view_key=$2 AND binding_status='current'
    ) SELECT NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM current_set)
      AND NOT EXISTS (SELECT * FROM current_set EXCEPT SELECT * FROM expected) AS matches
  `,[args.workspaceId,args.viewKey,sha256(args.rawKey.trim())])).rows[0]?.matches === true;
}

async function loadOwnCompensationProof(args: {
  client: Queryable;
  workspaceId: string;
  viewKey: ViewKey;
  promoteCount: number;
}) {
  const rawKey = operationKey(args.workspaceId,args.viewKey,
    `compensate-after-promote-${args.promoteCount}`);
  if (!await operationExists(args.client,args.workspaceId,rawKey)) return null;
  await loadOperationProof({ client: args.client,workspaceId: args.workspaceId,
    viewKey: args.viewKey,rawKey,action: "withdraw-to-absence" });
  return rawKey;
}

async function findKnownCurrentPromote(args: {
  client: Queryable;
  workspaceId: string;
  viewKey: ViewKey;
  finalKey: string;
  promoteCount: number;
}) {
  const candidates = [args.finalKey,...Array.from({ length: args.promoteCount },(_,index) =>
    operationKey(args.workspaceId,args.viewKey,`recovery-after-compensation-${index+1}`))];
  for (const rawKey of candidates) {
    if (await operationExists(args.client,args.workspaceId,rawKey)
      && await currentBindingsMatchPromoteOperation({ ...args,rawKey })) return rawKey;
  }
  return null;
}

async function loadOperationProof(args: {
  client: Queryable;
  workspaceId: string;
  viewKey: ViewKey;
  rawKey: string;
  action: "promote" | "withdraw-to-absence";
}) {
  const result = await args.client.query<{
    action: string;
    view_key: string;
    item_count: number;
    event_count: number;
    transition_valid: boolean;
    module_keys: string[];
  }>(`
    SELECT operation.action,operation.view_key,
      count(item.operation_id)::int AS item_count,count(event.id)::int AS event_count,
      array_agg(DISTINCT item.module_key ORDER BY item.module_key) AS module_keys,
      bool_and(event.workspace_id=operation.workspace_id
        AND event.module_key=item.module_key AND event.view_key=item.view_key
        AND CASE WHEN operation.action='promote'
          THEN item.next_binding_id IS NOT NULL AND event.next_binding_id=item.next_binding_id
          ELSE item.previous_binding_id IS NOT NULL AND item.next_binding_id IS NULL
            AND event.previous_binding_id=item.previous_binding_id
            AND event.next_binding_id IS NULL END) AS transition_valid
    FROM signal_governed_brand_binding_set_operations operation
    JOIN signal_governed_brand_binding_set_operation_items item
      ON item.operation_id=operation.id
    JOIN signal_governed_view_binding_events event ON event.id=item.binding_event_id
    WHERE operation.workspace_id=$1::uuid AND operation.idempotency_key=$2
    GROUP BY operation.id,operation.action,operation.view_key
  `, [args.workspaceId,sha256(args.rawKey.trim())]);
  const row = result.rows[0];
  if (!row || row.action !== args.action || row.view_key !== args.viewKey
    || row.item_count !== MODULES.length || row.event_count !== MODULES.length
    || !row.transition_valid) {
    throw new Error(`${args.viewKey}/${args.action} persisted operation proof is invalid.`);
  }
  return row;
}

async function loadPersistedAbsenceProof(args: {
  client: Queryable;
  workspaceId: string;
  viewKey: ViewKey;
  withdrawKey: string;
  promoteKey: string;
}) {
  const row = (await args.client.query<{
    withdraw_count: number;
    promote_count: number;
    ordered_transition: boolean;
    module_keys: string[];
  }>(`
    WITH withdrawn AS (
      SELECT item.module_key,event.created_at
      FROM signal_governed_brand_binding_set_operations operation
      JOIN signal_governed_brand_binding_set_operation_items item
        ON item.operation_id=operation.id
      JOIN signal_governed_view_binding_events event ON event.id=item.binding_event_id
      WHERE operation.workspace_id=$1::uuid AND operation.view_key=$2
        AND operation.action='withdraw-to-absence' AND operation.idempotency_key=$3
    ), promoted AS (
      SELECT item.module_key,event.created_at
      FROM signal_governed_brand_binding_set_operations operation
      JOIN signal_governed_brand_binding_set_operation_items item
        ON item.operation_id=operation.id
      JOIN signal_governed_view_binding_events event ON event.id=item.binding_event_id
      WHERE operation.workspace_id=$1::uuid AND operation.view_key=$2
        AND operation.action='promote' AND operation.idempotency_key=$4
    ) SELECT (SELECT count(*)::int FROM withdrawn) AS withdraw_count,
      (SELECT count(*)::int FROM promoted) AS promote_count,
      (SELECT max(created_at) FROM withdrawn)<=(SELECT min(created_at) FROM promoted)
        AS ordered_transition,
      ARRAY(SELECT module_key FROM withdrawn ORDER BY module_key) AS module_keys
  `,[args.workspaceId,args.viewKey,sha256(args.withdrawKey.trim()),
    sha256(args.promoteKey.trim())])).rows[0]!;
  if (row.withdraw_count !== MODULES.length || row.promote_count !== MODULES.length
    || !row.ordered_transition || stableJson(row.module_keys) !== stableJson([...MODULES].sort())) {
    throw new Error(`${args.viewKey} persisted absence transition is invalid.`);
  }
  return row;
}

async function exerciseBindingLifecycle(args: {
  client: Queryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: ViewKey;
}) {
  const firstKey = operationKey(args.workspace.id,args.viewKey,"promote");
  const withdrawKey = operationKey(args.workspace.id,args.viewKey,"withdraw");
  const finalKey = operationKey(args.workspace.id,args.viewKey,"re-promote");
  const finalExists = await operationExists(args.client,args.workspace.id,finalKey);
  if (finalExists) {
    await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
      viewKey: args.viewKey,rawKey: firstKey,action: "promote" });
    const withdrawalProof = await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
      viewKey: args.viewKey,rawKey: withdrawKey,action: "withdraw-to-absence" });
    await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
      viewKey: args.viewKey,rawKey: finalKey,action: "promote" });
    await loadPersistedAbsenceProof({ client: args.client,workspaceId: args.workspace.id,
      viewKey: args.viewKey,withdrawKey,promoteKey: finalKey });
    let final = await loadSignalGovernedViewBindingSetPreflightV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
    });
    let recovered = false;
    const promoteCount = await loadPromoteOperationCount(
      args.client,args.workspace.id,args.viewKey
    );
    const knownCurrentKey = final.current_binding_count === MODULES.length
      ? await findKnownCurrentPromote({ client: args.client,workspaceId: args.workspace.id,
        viewKey: args.viewKey,finalKey,promoteCount }) : null;
    const compensationKey = final.current_binding_count === 0
      ? await loadOwnCompensationProof({ client: args.client,workspaceId: args.workspace.id,
        viewKey: args.viewKey,promoteCount }) : null;
    const resume = resolveSignalGovernedBindingResumeV1({
      currentBindingCount: final.current_binding_count,
      currentMatchesKnownPromote: knownCurrentKey != null,
      ownCompensationProven: compensationKey != null
    });
    if (resume === "recover") {
      const recoveryKey = operationKey(args.workspace.id,args.viewKey,
        `recovery-after-compensation-${promoteCount}`);
      await promoteSignalGovernedViewBindingSetV1({
        workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
        expectedSetDigest: final.set_digest,idempotencyKey: recoveryKey,queryable: args.client
      });
      await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
        viewKey: args.viewKey,rawKey: recoveryKey,action: "promote" });
      final = await loadSignalGovernedViewBindingSetPreflightV1({
        workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
      });
      recovered = true;
      if (!await currentBindingsMatchPromoteOperation({
        client: args.client,workspaceId: args.workspace.id,viewKey: args.viewKey,
        rawKey: recoveryKey
      })) throw new Error(`${args.viewKey} recovery binding IDs do not match its operation.`);
    }
    if (final.current_binding_count !== MODULES.length) {
      throw new Error(`${args.viewKey} final idempotency record has no complete binding set.`);
    }
    return { resumed: true,recovered,withdraw_resolution: "not_available" as const,
      withdraw_evidence: withdrawalProof.module_keys.map((moduleKey) => ({
        module_key: moduleKey,resolution: "not_available" as const,
        reason: "persisted-ordered-withdraw-to-absence-transition" as const
      })),final };
  }
  const firstExists = await operationExists(args.client,args.workspace.id,firstKey);
  if (!firstExists) {
    const preflight = await loadSignalGovernedViewBindingSetPreflightV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
    });
    if (preflight.current_binding_count !== 0) {
      throw new Error(`${args.viewKey} has unexplained current bindings before rehearsal.`);
    }
    const promoted = await promoteSignalGovernedViewBindingSetV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
      expectedSetDigest: preflight.set_digest,idempotencyKey: firstKey,queryable: args.client
    });
    const replay = await promoteSignalGovernedViewBindingSetV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
      expectedSetDigest: preflight.set_digest,idempotencyKey: firstKey,queryable: args.client
    });
    if (!replay.replayed || stableJson(replay.items) !== stableJson(promoted.items)) {
      throw new Error(`${args.viewKey} promote retry was not idempotent.`);
    }
    await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
      viewKey: args.viewKey,rawKey: firstKey,action: "promote" });
  }
  const withdrawExists = await operationExists(args.client,args.workspace.id,withdrawKey);
  let recoveredBeforeWithdraw = false;
  if (firstExists && !withdrawExists) {
    const current = await loadSignalGovernedViewBindingSetPreflightV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
    });
    if (current.current_binding_count === 0) {
      const promoteCount = await loadPromoteOperationCount(
        args.client,args.workspace.id,args.viewKey
      );
      const compensationKey = await loadOwnCompensationProof({
        client: args.client,workspaceId: args.workspace.id,viewKey: args.viewKey,promoteCount
      });
      resolveSignalGovernedBindingResumeV1({ currentBindingCount: 0,
        currentMatchesKnownPromote: false,ownCompensationProven: compensationKey != null });
      const recoveryKey = operationKey(args.workspace.id,args.viewKey,
        `recovery-after-compensation-${promoteCount}`);
      await promoteSignalGovernedViewBindingSetV1({
        workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
        expectedSetDigest: current.set_digest,idempotencyKey: recoveryKey,queryable: args.client
      });
      await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
        viewKey: args.viewKey,rawKey: recoveryKey,action: "promote" });
      recoveredBeforeWithdraw = true;
    }
  }
  if (!withdrawExists) {
    const preflight = await loadSignalGovernedViewBindingSetPreflightV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
    });
    if (preflight.current_binding_count !== MODULES.length) {
      throw new Error(`${args.viewKey} cannot exercise atomic withdrawal from partial state.`);
    }
    await withdrawSignalGovernedViewBindingSetV1({
      workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
      expectedSetDigest: preflight.set_digest,idempotencyKey: withdrawKey,queryable: args.client
    });
    await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
      viewKey: args.viewKey,rawKey: withdrawKey,action: "withdraw-to-absence" });
  }
  const withdrawn = await loadSignalGovernedViewBindingSetPreflightV1({
    workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
  });
  if (withdrawn.current_binding_count !== 0) {
    throw new Error(`${args.viewKey} withdrawal did not resolve to absence.`);
  }
  const resolverStore = createPostgresSignalGovernedViewResolverStore(
    async <Row>(sql: string,values: unknown[]) =>
      (await args.client.query(sql,values)).rows as Row[]
  );
  const withdrawEvidence = [];
  for (const moduleKey of MODULES) {
    withdrawEvidence.push(await assertRejectsNotAvailable(() => resolveSignalGovernedViewV1(
      args.workspace,{ module_key: moduleKey,view_key: args.viewKey },resolverStore
    ),moduleKey));
  }
  await promoteSignalGovernedViewBindingSetV1({
    workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
    expectedSetDigest: withdrawn.set_digest,idempotencyKey: finalKey,queryable: args.client
  });
  const final = await loadSignalGovernedViewBindingSetPreflightV1({
    workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
  });
  if (final.current_binding_count !== MODULES.length) {
    throw new Error(`${args.viewKey} final binding set is incomplete.`);
  }
  await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
    viewKey: args.viewKey,rawKey: finalKey,action: "promote" });
  return { resumed: firstExists || withdrawExists,recovered: recoveredBeforeWithdraw,
    withdraw_resolution: "not_available" as const,
    withdraw_evidence: withdrawEvidence,final };
}

async function compensateAfterVerifyFailure(args: {
  directUrl: string;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  initialBindingCounts: Partial<Record<ViewKey,number>>;
}) {
  const client = await connect(args.directUrl,"verify-compensation");
  const evidence = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[
      "noisia:backend-06:laika:multi-view"
    ]);
    for (const viewKey of [...VIEWS].reverse()) {
      if (args.initialBindingCounts[viewKey] !== 0) continue;
      evidence.push({ view_key: viewKey,...await compensateViewBindings({
        client,workspace: args.workspace,actor: args.actor,viewKey
      }) });
    }
    return evidence;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[
      "noisia:backend-06:laika:multi-view"
    ]).catch(() => undefined);
    await client.end();
  }
}

async function compensateViewBindings(args: {
  client: Queryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: ViewKey;
}) {
  const preflight = await loadSignalGovernedViewBindingSetPreflightV1({
    workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
  });
  if (preflight.current_binding_count === 0) return { already_absent: true };
  if (preflight.current_binding_count !== MODULES.length) {
    throw new Error(`${args.viewKey} compensation refuses a partial current binding set.`);
  }
  const key = operationKey(args.workspace.id,args.viewKey,
    `compensate-after-promote-${await loadPromoteOperationCount(
      args.client,args.workspace.id,args.viewKey
    )}`);
  await withdrawSignalGovernedViewBindingSetV1({
    workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,
    expectedSetDigest: preflight.set_digest,idempotencyKey: key,queryable: args.client
  });
  await loadOperationProof({ client: args.client,workspaceId: args.workspace.id,
    viewKey: args.viewKey,rawKey: key,action: "withdraw-to-absence" });
  const absent = await loadSignalGovernedViewBindingSetPreflightV1({
    workspace: args.workspace,actor: args.actor,viewKey: args.viewKey,queryable: args.client
  });
  if (absent.current_binding_count !== 0) {
    throw new Error(`${args.viewKey} compensation failed to restore binding absence.`);
  }
  return { already_absent: false,withdraw_set_digest: absent.set_digest };
}

async function assertRejectsNotAvailable(run: () => Promise<unknown>, label: string) {
  try {
    await run();
  } catch (error) {
    const candidate = error as { code?: unknown;details?: { reason?: unknown } };
    if (candidate?.code === "not_available"
      && candidate.details?.reason === "governed_view_binding_not_available") {
      return { module_key: label,resolution: "not_available" as const,
        reason: "governed_view_binding_not_available" as const };
    }
    throw error;
  }
  throw new Error(`${label} unexpectedly resolved after withdraw-to-absence.`);
}

async function runShadows(args: {
  client: pg.Client;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  filter: SignalFilterV1;
}) {
  const evidence: Array<{
    view_key: ViewKey;
    normal: Awaited<ReturnType<typeof runSignalGovernedViewBindingShadowV1>>;
    reverse: Awaited<ReturnType<typeof runSignalGovernedViewBindingShadowV1>>;
  }> = [];
  for (const viewKey of VIEWS) {
    await args.client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const normal = await runSignalGovernedViewBindingShadowV1({
      workspace: args.workspace,actor: args.actor,viewKey,
      filter: args.filter,queryable: args.client
    });
    await args.client.query("COMMIT");
    await args.client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const reverse = await runSignalGovernedViewBindingShadowV1({
      workspace: args.workspace,actor: args.actor,viewKey,
      executionOrder: [...MODULES].reverse(),filter: args.filter,
      queryable: args.client
    });
    await args.client.query("COMMIT");
    if (!normal.public_evidence.gate_passed
      || normal.public_evidence.cross_module.operational_pointer_followed
      || normal.public_evidence.cross_module.unexplained_count !== 0
      || normal.public_evidence.evidence_digest !== reverse.public_evidence.evidence_digest) {
      throw new Error(`${viewKey} shadow reconciliation failed.`);
    }
    evidence.push({ view_key: viewKey,normal,reverse });
  }
  const cursorIsolation = MODULES.map((moduleKey) => ({
    module_key: moduleKey,
    values: evidence.map((entry) => entry.normal.public_evidence.modules.find(
      (module) => module.module_key === moduleKey
    )!.serving_identity.cursor_isolation_hash)
  }));
  const etagIsolation = MODULES.map((moduleKey) => ({
    module_key: moduleKey,
    values: evidence.map((entry) => entry.normal.public_evidence.modules.find(
      (module) => module.module_key === moduleKey
    )!.serving_identity.etag_seed)
  }));
  const populationIsolation = MODULES.map((moduleKey) => ({
    module_key: moduleKey,
    values: evidence.map((entry) => entry.normal.private_identity.modules.find(
      (module) => module.module_key === moduleKey
    )!.population_id)
  }));
  if ([...cursorIsolation,...etagIsolation,...populationIsolation].some((entry) =>
    new Set(entry.values).size !== VIEWS.length)) {
    throw new Error("Backend 06 cross-view serving identities are not isolated.");
  }
  await args.client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const union = (await args.client.query<{
    module_key: string;
    expected_count: number;
    actual_count: number;
    missing_count: number;
    extra_count: number;
    duplicate_count: number;
    scope_counts: Record<string,number>;
  }>(`
    WITH compilation AS (
      SELECT compilation.module_key,compilation.governance_evaluation_id,
        compilation.population_id,compilation.policy_bundle_id
      FROM signal_population_policy_compilations compilation
      JOIN signal_population_policy_bundles bundle ON bundle.id=compilation.policy_bundle_id
      WHERE compilation.workspace_id=$1::uuid AND compilation.view_key='all-governed'
        AND compilation.is_current AND compilation.compilation_status='ready'
        AND bundle.status='active'
    ), scoped AS (
      SELECT DISTINCT compilation.module_key,assertion.mention_id,assertion.scope
      FROM compilation
      JOIN signal_data_governance_evaluation_items item
        ON item.evaluation_id=compilation.governance_evaluation_id
       AND item.decision='included'
      JOIN signal_mention_attributions assertion
        ON assertion.workspace_id=$1::uuid AND assertion.mention_id=item.mention_id
       AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
       AND assertion.review_status='approved' AND assertion.eligibility_status='eligible'
      JOIN signal_population_policy_entities entity
        ON entity.policy_bundle_id=compilation.policy_bundle_id
       AND entity.scope=assertion.scope AND entity.entity_type=assertion.entity_type
       AND entity.entity_id=assertion.entity_id
      WHERE assertion.scope IN ('primary_brand','competitor','category','reference')
    ), expected AS (
      SELECT DISTINCT module_key,mention_id FROM scoped
    ), actual AS (
      SELECT compilation.module_key,membership.mention_id
      FROM compilation JOIN signal_population_memberships membership
        ON membership.population_id=compilation.population_id
      WHERE membership.membership_status='included'
    ), modules AS (SELECT unnest($2::text[]) AS module_key)
    SELECT modules.module_key,
      (SELECT count(*)::int FROM expected WHERE expected.module_key=modules.module_key)
        AS expected_count,
      (SELECT count(*)::int FROM actual WHERE actual.module_key=modules.module_key)
        AS actual_count,
      (SELECT count(*)::int FROM expected WHERE expected.module_key=modules.module_key
        AND NOT EXISTS (SELECT 1 FROM actual WHERE actual.module_key=expected.module_key
          AND actual.mention_id=expected.mention_id)) AS missing_count,
      (SELECT count(*)::int FROM actual WHERE actual.module_key=modules.module_key
        AND NOT EXISTS (SELECT 1 FROM expected WHERE expected.module_key=actual.module_key
          AND expected.mention_id=actual.mention_id)) AS extra_count,
      (SELECT count(*)::int FROM (SELECT mention_id FROM actual
        WHERE actual.module_key=modules.module_key GROUP BY mention_id HAVING count(*)>1) duplicate)
        AS duplicate_count,
      COALESCE((SELECT jsonb_object_agg(scope,root_count ORDER BY scope) FROM (
        SELECT scope,count(DISTINCT mention_id)::int AS root_count FROM scoped
        WHERE scoped.module_key=modules.module_key GROUP BY scope
      ) counts),'{}'::jsonb) AS scope_counts
    FROM modules ORDER BY modules.module_key
  `,[args.workspace.id,MODULES])).rows;
  await args.client.query("COMMIT");
  if (union.length !== MODULES.length || union.some((entry) => entry.expected_count === 0
    || entry.expected_count !== entry.actual_count || entry.missing_count !== 0
    || entry.extra_count !== 0 || entry.duplicate_count !== 0)) {
    throw new Error("Backend 06 all-governed SQL union does not match its memberships.");
  }
  return { views: evidence,cross_view: {
    cursor_isolation: cursorIsolation.map((entry) => ({ module_key: entry.module_key,
      distinct_count: new Set(entry.values).size })),
    etag_isolation: etagIsolation.map((entry) => ({ module_key: entry.module_key,
      distinct_count: new Set(entry.values).size })),
    population_isolation: populationIsolation.map((entry) => ({ module_key: entry.module_key,
      distinct_count: new Set(entry.values).size })),
    all_governed_union: union
  } };
}

async function applyRehearsal(args: {
  directUrl: string;
  preflight: Awaited<ReturnType<typeof createPreflight>>;
}) {
  const expected = required("NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_EXPECTED_PROTECTED_DIGEST");
  if (args.preflight.direct.protected_state.aggregate_digest !== expected) {
    throw new Error("Backend 06 protected-state compare-and-swap failed before apply.");
  }
  const client = await connect(args.directUrl,"apply");
  const compensationEvidence: unknown[] = [];
  let initialBindingCounts: Partial<Record<ViewKey,number>> = {};
  let sessionLockHeld = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[
      "noisia:backend-06:laika:multi-view"
    ]);
    sessionLockHeld = true;
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const connections = await inspectConnections(client);
    const identity = await inspectWorkspace(client);
    const protectedBefore = await inspectProtectedState(client,identity.workspace_id);
    if (protectedBefore.aggregate_digest !== expected) {
      throw new Error("Protected state changed after the Backend 06 lock.");
    }
    const compilationInputs = await inspectCompilationInputs(client,identity.workspace_id);
    if (compilationInputs.aggregate_digest
      !== args.preflight.direct.compilation_inputs.aggregate_digest) {
      throw new Error("Compilation inputs changed between Backend 06 preflight and apply.");
    }
    const lockedDryRun = [];
    for (const viewKey of VIEWS) {
      for (const moduleKey of MODULES) {
        lockedDryRun.push(await inspectViewDryRun(client,identity,viewKey,moduleKey));
      }
    }
    const lockedFilter = resolveSignalGovernedMultiViewFilterV1(
      lockedDryRun,identity.timezone
    );
    if (stableJson(lockedDryRun) !== stableJson(args.preflight.direct.dry_run)
      || sha256(stableJson(lockedFilter)) !== args.preflight.direct.filter_digest) {
      throw new Error("Observed filter or candidate dry-run changed after the Backend 06 lock.");
    }
    const actor = await inspectActor(client,identity.workspace_id);
    const workspace = await loadWorkspace(client,identity);
    const qualityPolicyId = await inspectQualityPolicy(client,identity.workspace_id);
    const compilations = [];
    for (const viewKey of VIEWS) {
      const compilation = await compileView({ client,workspace,actor,viewKey,qualityPolicyId });
      assertDryRunMatchesCompilation({
        viewKey,dryRun: args.preflight.direct.dry_run,compilations: compilation
      });
      compilations.push(compilation);
    }
    const protectedAfterCompilation = await inspectProtectedState(client,identity.workspace_id);
    if (protectedAfterCompilation.aggregate_digest !== expected) {
      throw new Error("Compilation mutated a protected brand/V1/base/pointer invariant.");
    }
    await client.query("COMMIT");
    await writeArtifact("phase-compilation.private.json",{
      contract_version: "signal-backend-06-phase-v1",phase: "compiled",
      filter_digest: args.preflight.direct.filter_digest,compilations
    });
    const initialBindingEntries: Array<[ViewKey, number]> = [];
    for (const viewKey of VIEWS) {
      initialBindingEntries.push([
        viewKey,(await loadSignalGovernedViewBindingSetPreflightV1({
        workspace,actor,viewKey,queryable: client
        })).current_binding_count
      ]);
    }
    initialBindingCounts = Object.fromEntries(initialBindingEntries) as Record<ViewKey,number>;
    const bindingPhase = await runSignalGovernedBindingPhaseWithCompensationV1({
      views: VIEWS,
      async promote(viewKey) {
        const before = await loadSignalGovernedViewBindingSetPreflightV1({
          workspace,actor,viewKey,queryable: client
        });
        try {
          const lifecycle = await exerciseBindingLifecycle({ client,workspace,actor,viewKey });
          return { created_by_invocation: before.current_binding_count === 0,result: {
            view_key: viewKey,...lifecycle
          } };
        } catch (error) {
          if (before.current_binding_count === 0) {
            compensationEvidence.push({ failed_view: viewKey,
              result: await compensateViewBindings({ client,workspace,actor,viewKey }) });
          }
          throw error;
        }
      },
      async shadow() {
        return runShadows({ client,workspace,actor,filter: lockedFilter });
      },
      async postcondition() {
        const protectedAfter = await inspectProtectedState(client,identity.workspace_id);
        if (protectedAfter.aggregate_digest !== expected) {
          throw new Error("Backend 06 changed a protected brand/V1/base/pointer invariant.");
        }
        const inputsAfter = await inspectCompilationInputs(client,identity.workspace_id);
        if (inputsAfter.aggregate_digest !== compilationInputs.aggregate_digest) {
          throw new Error("Backend 06 compilation inputs drifted during apply or shadow.");
        }
      },
      async compensate(viewKey) {
        await compensateViewBindings({ client,workspace,actor,viewKey });
      },
      async onPhase(phase) {
        if (phase.kind === "compensated") compensationEvidence.push(phase);
        await writeArtifact(`phase-bindings-${phase.kind}-${phase.view}.private.json`,{
          contract_version: "signal-backend-06-phase-v1",phase,
          filter_digest: args.preflight.direct.filter_digest
        });
      }
    });
    const lifecycles = bindingPhase.promoted.map((entry) => entry.result);
    const shadows = bindingPhase.shadow;
    const protectedAfter = await inspectProtectedState(client,identity.workspace_id);
    return { connections,identity,actor,workspace,protectedBefore,protectedAfter,
      filter: lockedFilter,filter_digest: args.preflight.direct.filter_digest,
      initialBindingCounts,compilations,lifecycles,shadows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const unsafe: string[] = [];
    for (const viewKey of VIEWS) {
      if (initialBindingCounts[viewKey] !== 0) continue;
      try {
        const count = (await client.query<{ binding_count: number }>(`
          SELECT count(*)::int AS binding_count FROM signal_governed_view_bindings
          WHERE workspace_id=(SELECT workspace.id FROM signal_workspaces workspace
            JOIN brands brand ON brand.id=workspace.brand_id WHERE brand.slug='laika')
            AND view_key=$1 AND binding_status='current'
        `,[viewKey])).rows[0]!.binding_count;
        if (count !== 0) unsafe.push(viewKey);
      } catch {
        unsafe.push(viewKey);
      }
    }
    await writeArtifact("failure-compensation.private.json",{
      contract_version: "signal-backend-06-failure-v1",
      error: sanitizedErrorMessage(error),compensation: compensationEvidence,
      restored_initial_absence: unsafe.length === 0,unsafe_views: unsafe
    });
    if (unsafe.length > 0) {
      throw new AggregateError([error],
        `Backend 06 compensation left current bindings for ${unsafe.join(",")}.`);
    }
    throw error;
  } finally {
    if (sessionLockHeld) {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[
        "noisia:backend-06:laika:multi-view"
      ]).catch(() => undefined);
    }
    await client.end();
  }
}

async function verifyRehearsal(args: {
  directUrl: string;
  expectedProtectedDigest: string;
  expectedCompilationInputsDigest: string;
  filter: SignalFilterV1;
}) {
  const client = await connect(args.directUrl,"verify");
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity = await inspectWorkspace(client);
    const actor = await inspectActor(client,identity.workspace_id);
    const workspace = await loadWorkspace(client,identity);
    const protectedState = await inspectProtectedState(client,identity.workspace_id);
    if (protectedState.aggregate_digest !== args.expectedProtectedDigest) {
      throw new Error("Backend 06 verify detected protected-state drift.");
    }
    const compilationInputs = await inspectCompilationInputs(client,identity.workspace_id);
    if (compilationInputs.aggregate_digest !== args.expectedCompilationInputsDigest) {
      throw new Error("Backend 06 verify detected compilation-input drift.");
    }
    const bindings = [];
    for (const viewKey of VIEWS) {
      const preflight = await loadSignalGovernedViewBindingSetPreflightV1({
        workspace,actor,viewKey,queryable: client
      });
      if (preflight.policy_status !== "active" || preflight.current_binding_count !== MODULES.length
        || preflight.modules.some((module) => module.governance_unknown_count !== 0)) {
        throw new Error(`${viewKey} final binding state is not active and complete.`);
      }
      bindings.push(preflight);
    }
    await client.query("ROLLBACK");
    const shadows = await runShadows({ client,workspace,actor,filter: args.filter });
    return { identity,protectedState,compilationInputs,bindings,shadows };
  } finally {
    await client.end();
  }
}

async function writeArtifact(name: string, value: unknown) {
  await mkdir(OUTPUT_DIRECTORY,{ recursive: true,mode: 0o700 });
  await chmod(OUTPUT_DIRECTORY,0o700);
  const path = resolve(OUTPUT_DIRECTORY,name);
  const content = `${JSON.stringify(value,null,2)}\n`;
  await writeFile(path,content,{ mode: 0o600 });
  await chmod(path,0o600);
  return { path: `.data/signal-governed-serving/backend-06/${name}`,sha256: sha256(content) };
}

function sanitizeCompilation(
  value: Awaited<ReturnType<typeof compileView>>
) {
  return {
    policy_bundle_key: safeKey("bundle",value.policy_bundle_id),
    modules: value.normal.map((module) => ({
      module_key: module.module_key,view_key: module.view_key,
      population_ref: safeKey("population",module.population_id),
      population_definition_hash: module.population_definition_hash,
      membership_count: module.actual_membership_count,
      membership_digest: module.actual_membership_digest,
      compiled_plan_hash: module.compiled_plan_hash,
      compilation_status: module.compilation_status,
      governance_unknown_count: module.governance_unknown_count,
      usage_purposes: module.usage_purposes
    })),
    reverse_order_same: value.reverse.every((module) => {
      const normal = value.normal.find((entry) => entry.module_key === module.module_key)!;
      return module.population_id === normal.population_id
        && module.actual_membership_digest === normal.actual_membership_digest
        && module.compiled_plan_hash === normal.compiled_plan_hash;
    })
  };
}

async function main() {
  const mode = readMode();
  const directUrl = required("DATABASE_URL");
  const poolerUrl = required("NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_POOLER_DATABASE_URL");
  const restore = assertRemoteGuards(mode,directUrl,poolerUrl);
  const preflight = await createPreflight(directUrl,poolerUrl);
  const identityEvidence = {
    contract_version: "signal-backend-06-target-identity-v1",
    target: "noisia-staging",read_only: true,writes_performed: false,
    direct_fingerprint: DIRECT_FINGERPRINT,pooler_fingerprint: POOLER_FINGERPRINT,
    project_ref_hash: PROJECT_REF_HASH,same_project: true,same_database_state: true,
    restore_point: restore,...preflight.directPublic,
    connections: { ...preflight.connections,application_names_redacted: true }
  };
  const artifacts = [
    await writeArtifact("preflight.private.json",preflight.direct),
    await writeArtifact("preflight.sanitized.json",identityEvidence)
  ];
  if (mode === "preflight") {
    console.log(JSON.stringify({ ok: true,mode,...identityEvidence,artifacts },null,2));
    return;
  }
  const expectedProtectedDigest = mode === "apply"
    ? required("NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_EXPECTED_PROTECTED_DIGEST")
    : preflight.direct.protected_state.aggregate_digest;
  let applied: Awaited<ReturnType<typeof applyRehearsal>> | null = null;
  if (mode === "apply") {
    applied = await applyRehearsal({ directUrl,preflight });
    try {
      const sanitized = {
        contract_version: "signal-backend-06-apply-v1",writes_performed: true,
        workspace_key: safeKey("workspace",applied.workspace.id),
        actor_key: safeKey("actor",applied.actor.id),
        protected_state_before: applied.protectedBefore.aggregate_digest,
        protected_state_after: applied.protectedAfter.aggregate_digest,
        filter: applied.filter,filter_digest: applied.filter_digest,
        views: applied.compilations.map(sanitizeCompilation),
        lifecycles: applied.lifecycles.map((entry) => ({
          view_key: entry.view_key,resumed: entry.resumed,
          recovered: entry.recovered,
          withdraw_evidence: entry.withdraw_evidence,
          current_binding_count: entry.final.current_binding_count,
          set_digest: entry.final.set_digest
        })),
        shadows: applied.shadows.views.map((entry) => ({
          view_key: entry.view_key,evidence_digest: entry.normal.public_evidence.evidence_digest,
          reverse_order_same: entry.normal.public_evidence.evidence_digest
            === entry.reverse.public_evidence.evidence_digest,
          operational_pointer_followed: false,
          unexplained_count: entry.normal.public_evidence.cross_module.unexplained_count,
          gate_passed: entry.normal.public_evidence.gate_passed
        })),
        cross_view: applied.shadows.cross_view
      };
      artifacts.push(await writeArtifact("apply.private.json",applied));
      artifacts.push(await writeArtifact("apply.sanitized.json",sanitized));
    } catch (error) {
      const compensation = await compensateAfterVerifyFailure({ directUrl,
        workspace: applied.workspace,actor: applied.actor,
        initialBindingCounts: applied.initialBindingCounts });
      await writeArtifact("evidence-failure-compensation.private.json",{
        contract_version: "signal-backend-06-evidence-failure-v1",
        error: sanitizedErrorMessage(error),compensation
      }).catch(() => undefined);
      throw error;
    }
  }
  let verified: Awaited<ReturnType<typeof verifyRehearsal>>;
  try {
    verified = await verifyRehearsal({
      directUrl,expectedProtectedDigest,
      expectedCompilationInputsDigest: preflight.direct.compilation_inputs.aggregate_digest,
      filter: preflight.direct.filter
    });
  } catch (error) {
    if (applied) {
      const compensation = await compensateAfterVerifyFailure({
        directUrl,workspace: applied.workspace,actor: applied.actor,
        initialBindingCounts: applied.initialBindingCounts
      });
      await writeArtifact("verify-failure-compensation.private.json",{
        contract_version: "signal-backend-06-verify-failure-v1",
        error: sanitizedErrorMessage(error),compensation
      });
    }
    throw error;
  }
  const verifyEvidence = {
    contract_version: "signal-backend-06-verify-v1",read_only: true,writes_performed: false,
    protected_state_digest: verified.protectedState.aggregate_digest,
    compilation_inputs_digest: verified.compilationInputs.aggregate_digest,
    filter: preflight.direct.filter,filter_digest: preflight.direct.filter_digest,
    views: verified.bindings.map((binding) => ({
      view_key: binding.view_key,policy_key: binding.policy_key,
      policy_version: binding.policy_version,current_binding_count: binding.current_binding_count,
      set_digest: binding.set_digest,
      modules: binding.modules.map((module) => ({
        module_key: module.module_key,population_ref: safeKey("population",module.population_id),
        membership_digest: module.membership_digest,
        compiled_plan_hash: module.compiled_plan_hash,
        governance_unknown_count: module.governance_unknown_count
      }))
    })),
    shadows: verified.shadows.views.map((entry) => ({
      view_key: entry.view_key,evidence_digest: entry.normal.public_evidence.evidence_digest,
      reverse_order_same: entry.normal.public_evidence.evidence_digest
        === entry.reverse.public_evidence.evidence_digest,
      operational_pointer_followed: false,
      unexplained_count: entry.normal.public_evidence.cross_module.unexplained_count,
      gate_passed: entry.normal.public_evidence.gate_passed
    })),
    cross_view: verified.shadows.cross_view,
    gate_passed: true
  };
  artifacts.push(await writeArtifact("verify.private.json",verified));
  artifacts.push(await writeArtifact("verify.sanitized.json",verifyEvidence));
  console.log(JSON.stringify({ ok: true,mode,...verifyEvidence,artifacts },null,2));
}

main().catch((error) => {
  console.error(sanitizedErrorMessage(error));
  process.exitCode = 1;
});
