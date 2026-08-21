import { createHash, createHmac } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "../../..");
const MODE = process.argv[2];
const TARGET = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const APPLY_APPROVED = process.env.NOISIA_SIGNAL_TOPIC_DISCOVERY_REVIEW_APPLY_APPROVED === "true";
const RESTORE_AT = process.env.NOISIA_SIGNAL_TOPIC_DISCOVERY_REVIEW_RESTORE_POINT_AT;
const RESTORE_HASH = process.env.NOISIA_SIGNAL_TOPIC_DISCOVERY_REVIEW_RESTORE_POINT_HASH;
const EXPECTED = {
  direct: "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler: "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project: "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32",
  sourceManifestFile: "sha256:9300ea7a0e50870bf2b4dffe58e3e186628b2577692dccf27f5137177bdaed8b",
  diagnosticManifestFile: "sha256:23e38d262e81132546c568addd0cd5f04079b6f80474f0b741003a8c3bff8360",
  packetFile: "sha256:cf249fa062ee6104c7d4c9f2325b0ea27bd7a2705a2807e262d4cfd1851f1847"
} as const;
const MIGRATION = {
  ordinal: 90,
  filename: "0090_signal_topic_discovery_operator_review.sql"
} as const;
const SOURCE_RUN = resolve(ROOT,
  ".data/signal-semantic-lab/backend-10c2c/run-2026-08-21T020023-0600");
const DIAGNOSTIC_RUN = resolve(ROOT,
  ".data/signal-semantic-lab/backend-10c3a/run-2026-08-21T100838-0600");

if (!new Set(["preflight", "apply", "verify"]).has(MODE ?? "")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (TARGET !== "noisia-staging") throw new Error("Only noisia-staging is authorized.");
if (MODE === "apply") assertApplyAuthority();

loadEnv({ path: resolve(ROOT, "apps/studio/.env.local"), override: false });
const poolerUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
const directUrl = deriveDirect(poolerUrl);
const supabaseUrl = required(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  "SUPABASE_URL");
assertTarget(poolerUrl, directUrl, supabaseUrl);

const migrationPath = resolve(ROOT, "infrastructure/db/migrations", MIGRATION.filename);
const migrationSql = await readFile(migrationPath, "utf8");
const migrationChecksum = sha256(migrationSql);
const files = await loadAndValidatePrivateArtifacts();
const outputDir = resolve(process.env.NOISIA_SIGNAL_TOPIC_DISCOVERY_REVIEW_OUTPUT_DIR
  ?? resolve(ROOT, ".data/signal-topic-discovery-review/backend-10c3ar"));
assertPrivateOutput(outputDir);
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);

const direct = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false },
  application_name: "noisia-topic-discovery-review-registration" });
await direct.connect();
let evidence: Record<string, unknown>;
try {
  await direct.query("SET statement_timeout='15min'");
  await direct.query("SET lock_timeout='30s'");
  const before = await inspect(direct, migrationChecksum);
  const peer = await inspectPeer(poolerUrl, migrationChecksum);
  assertPeer(before, peer);
  if (before.migration_state === "partial") throw new Error("0090 is partially applied or divergent.");
  if (MODE === "preflight") {
    evidence = { mode: MODE, writes_performed: false, before, private_artifacts: files.publicEvidence };
  } else if (MODE === "verify") {
    if (before.migration_state !== "complete") throw new Error("0090 is not applied.");
    const registered = await inspectRegisteredPacket(direct, files.packet.packet_digest);
    evidence = { mode: MODE, writes_performed: false, before, registered,
      private_artifacts: files.publicEvidence };
  } else {
    assertNoRunnableWork(before.runnable_work);
    const protectedBefore = before.protected_state_digest;
    if (before.migration_state === "absent") {
      await direct.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        await direct.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "noisia:topic-discovery-review:0090"
        ]);
        const locked = await inspect(direct, migrationChecksum);
        if (locked.migration_state !== "absent"
          || locked.protected_state_digest !== protectedBefore) {
          throw new Error("0090 protected-state compare-and-swap failed.");
        }
        assertNoRunnableWork(locked.runnable_work);
        await direct.query(migrationSql);
        await direct.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
        ) VALUES($1,$2,$3,'applied','signal-topic-discovery-review-runner-v1',$4)`, [
          MIGRATION.filename,MIGRATION.ordinal,migrationChecksum,EXPECTED.direct
        ]);
        await direct.query("COMMIT");
      } catch (error) {
        await direct.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    const afterMigration = await inspect(direct, migrationChecksum);
    if (afterMigration.migration_state !== "complete"
      || afterMigration.protected_state_digest !== protectedBefore) {
      throw new Error("0090 migration verification failed.");
    }
    process.env.DATABASE_URL = directUrl;
    process.env.DATABASE_SSL = "true";
    const registration = await registerPacket(files);
    const after = await inspect(direct, migrationChecksum);
    if (after.protected_state_digest !== protectedBefore) {
      throw new Error("Protected serving state changed during review registration.");
    }
    assertNoRunnableWork(after.runnable_work);
    evidence = { mode: MODE, writes_performed: true, before, after, registration,
      private_artifacts: files.publicEvidence };
  }
} finally {
  await direct.end();
}

const sanitized = {
  contract_version: "signal-topic-discovery-review-registration-evidence-v1",
  captured_at: new Date().toISOString(),
  target: "noisia-staging",
  identity: { direct_fingerprint: EXPECTED.direct, pooler_fingerprint: EXPECTED.pooler,
    project_ref_hash: EXPECTED.project },
  migration: { ...MIGRATION, checksum: migrationChecksum },
  restore_point: RESTORE_AT && RESTORE_HASH ? { captured_at: RESTORE_AT,
    reference_hash: RESTORE_HASH,
    age_hours: Number(((Date.now() - Date.parse(RESTORE_AT)) / 3_600_000).toFixed(2)) } : null,
  safety: { production_accessed: false, provider_calls: 0, paid_jobs: 0, holdout_opened: false,
    serving_writes: 0, readers_changed: false, pointers_changed: false, bindings_changed: false,
    ten_c3b_authorized: false, ten_d_ready: false },
  ...evidence
};
const evidencePath = resolve(outputDir, `registration-${MODE}.sanitized.json`);
const evidenceBody = `${JSON.stringify(sanitized, null, 2)}\n`;
await writeFile(evidencePath, evidenceBody, { mode: 0o600 });
await chmod(evidencePath, 0o600);
process.stdout.write(`${JSON.stringify({ ok: true, mode: MODE, target: "noisia-staging",
  evidence_sha256: sha256(evidenceBody), provider_calls: 0, paid_jobs: 0,
  holdout_opened: false, serving_writes: 0, ten_c3b_authorized: false, ten_d_ready: false })}\n`);

async function registerPacket(files: Awaited<ReturnType<typeof loadAndValidatePrivateArtifacts>>) {
  const [{ pool }, workspaceModule, reviewModule] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/data-os/signal-workspace"),
    import("../src/lib/data-os/signal-topic-discovery-review")
  ]);
  try {
    const workspaceRows = await pool.query<{
      workspace_id: string;organization_id: string;brand_id: string;slug: string;
      name: string;timezone: string;status: string;
    }>(`SELECT workspace.id::text workspace_id,workspace.organization_id::text,
      workspace.brand_id::text,workspace.slug,brand.name,workspace.timezone,workspace.status
      FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
      WHERE workspace.status='active' AND brand.status='active'`);
    const workspaceRow = workspaceRows.rows.find((row) =>
      hmac(files.pseudonymKey, `workspace:${row.workspace_id}`) === files.exportManifest.workspace_ref);
    if (!workspaceRow) throw new Error("The private export workspace cannot be resolved server-side.");

    const evidenceRefs = packetEvidenceRefs(files.packet);
    const expectedAuthority = authorityForEvidence(files.exportRecords, evidenceRefs);
    const evidenceAuthority = await reviewModule.resolveSignalTopicDiscoveryEvidenceRootsV1({
      queryable: pool,workspaceId: workspaceRow.workspace_id,evidenceRefs,
      pseudonymKey: files.pseudonymKey,expectedAuthority
    });
    const mentionIds = [...evidenceAuthority.values()].map((item) => item.mentionId);
    const actors = await pool.query<{ id: string;organization_id: string | null }>(`
      SELECT DISTINCT importing_user.id::text,importing_user.organization_id::text
      FROM mentions root
      JOIN mentions member ON member.workspace_id=root.workspace_id
        AND member.canonical_mention_id=root.id
      JOIN signal_provider_mention_observations observation
        ON observation.workspace_id=member.workspace_id AND observation.mention_id=member.id
      JOIN import_batches batch ON batch.id=observation.import_batch_id AND batch.status='completed'
      JOIN users importing_user ON importing_user.id=batch.imported_by_user_id
        AND importing_user.status='active' AND importing_user.user_type='noisia_internal'
      WHERE root.id=ANY($1::uuid[])`, [mentionIds]);
    if (actors.rowCount !== 1 || !actors.rows[0]) {
      throw new Error("A unique server-owned internal registration actor cannot be resolved.");
    }
    const actor = { id: actors.rows[0].id, userType: "noisia_internal" as const,
      organizationId: actors.rows[0].organization_id };
    const workspace = await workspaceModule.resolveSignalWorkspaceForUser(actor,
      { workspaceId: workspaceRow.workspace_id });
    if (!workspace) throw new Error("The resolved server actor lacks workspace management authority.");

    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      result = await reviewModule.registerSignalTopicDiscoveryReviewPacketV1({
        queryable: client,workspace,actor,
        idempotencyKey: `10c3ar:${files.packet.packet_digest}`,
        packet: files.packet,packetFileDigest: files.publicEvidence.packet_file_sha256,
        sourceManifestDigest: files.publicEvidence.source_manifest_sha256,
        discoveryRunDigest: files.publicEvidence.discovery_run_digest,
        candidateArtifactDigest: files.publicEvidence.candidate_artifact_digest,
        rightsDigest: files.exportManifest.authority_digest,evidenceAuthority
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    const summary = await reviewModule.loadSignalTopicDiscoveryReviewSummaryV1({ workspace });
    if (summary.run.proposal_count !== 115 || summary.run.evidence_count !== 805
      || summary.run.outlier_evidence_count !== 5 || summary.review.reviewed !== 0
      || summary.diagnostic.holdout_opened || summary.diagnostic.ten_c3b_authorized
      || summary.diagnostic.ten_d_ready) {
      throw new Error("Registered review summary does not reconcile the private packet.");
    }
    return { ...result, proposal_count: 115, evidence_count: 805, outlier_evidence_count: 5,
      reviewed_count: 0, replay_safe: true, holdout_opened: false,
      topic_contracts_created: 0, propagation_assignments_created: 0 };
  } finally { await pool.end(); }
}

async function loadAndValidatePrivateArtifacts() {
  const sourceManifestPath = resolve(SOURCE_RUN, "manifest.sanitized.json");
  const exportManifestPath = resolve(SOURCE_RUN, "remote-export/source-export-v2.manifest.private.json");
  const exportPath = resolve(SOURCE_RUN, "remote-export/source-export-v2.private.jsonl");
  const keyPath = resolve(SOURCE_RUN, "remote-export/pseudonym-key.private.bin");
  const diagnosticManifestPath = resolve(DIAGNOSTIC_RUN, "manifest.sanitized.json");
  const diagnosticPath = resolve(DIAGNOSTIC_RUN, "diagnostic.private.json");
  const packetPath = resolve(DIAGNOSTIC_RUN, "operator-review/blind-review-packet.private.json");
  const candidatePath = resolve(SOURCE_RUN,
    "model-run-final-2/full/bertopic-bge-detail.seed-17.result.json");
  for (const path of [exportManifestPath, exportPath, keyPath, diagnosticPath, packetPath, candidatePath]) {
    if ((await stat(path)).mode & 0o077) throw new Error("A private source artifact is not mode 0600.");
  }
  const [sourceManifestBody,exportManifestBody,exportBody,pseudonymKey,diagnosticManifestBody,
    diagnosticBody,packetBody,candidateBody] = await Promise.all([
      readFile(sourceManifestPath,"utf8"),readFile(exportManifestPath,"utf8"),readFile(exportPath,"utf8"),
      readFile(keyPath),readFile(diagnosticManifestPath,"utf8"),readFile(diagnosticPath,"utf8"),
      readFile(packetPath,"utf8"),readFile(candidatePath,"utf8")
    ]);
  if (sha256(sourceManifestBody) !== EXPECTED.sourceManifestFile
    || sha256(diagnosticManifestBody) !== EXPECTED.diagnosticManifestFile
    || sha256(packetBody) !== EXPECTED.packetFile) {
    throw new Error("Immutable 10C.2C/10C.3A artifact digest drift detected.");
  }
  if (pseudonymKey.byteLength < 32) throw new Error("The private pseudonym key is unavailable.");
  const sourceManifest = JSON.parse(sourceManifestBody) as Record<string, unknown>;
  const diagnosticManifest = JSON.parse(diagnosticManifestBody) as {
    source_evidence_manifest_sha256?: string;source_holdout_state?: string;
    analytic_digest?: string;files?: Array<{ path?: string;sha256?: string }>;
  };
  const diagnostic = JSON.parse(diagnosticBody) as { source_lineage?: { candidate_key?: string;
    holdout_state?: string;evidence_manifest_sha256?: string } };
  const exportManifest = JSON.parse(exportManifestBody) as {
    contract_version: string;workspace_ref: string;authority_digest: `sha256:${string}`;
    export_file_sha256: string;transaction_read_only: boolean;transaction_id_assigned: boolean;
    writes_performed: boolean;provider_calls: number;serving_writes: number;
  };
  const packet = JSON.parse(packetBody) as Record<string, unknown> & { packet_digest: string };
  const packetManifestDigest = diagnosticManifest.files?.find((file) =>
    file.path === "operator-review/blind-review-packet.private.json")?.sha256;
  if (diagnosticManifest.source_evidence_manifest_sha256 !== EXPECTED.sourceManifestFile
    || diagnosticManifest.source_holdout_state !== "sealed"
    || diagnostic.source_lineage?.candidate_key !== "bertopic-bge-detail"
    || diagnostic.source_lineage.holdout_state !== "sealed"
    || diagnostic.source_lineage.evidence_manifest_sha256 !== EXPECTED.sourceManifestFile
    || packetManifestDigest !== EXPECTED.packetFile) {
    throw new Error("10C.3A lineage or holdout state is incompatible.");
  }
  if (exportManifest.contract_version !== "signal-semantic-benchmark-export-v2"
    || sha256(exportBody) !== exportManifest.export_file_sha256
    || !exportManifest.transaction_read_only || exportManifest.transaction_id_assigned
    || exportManifest.writes_performed || exportManifest.provider_calls !== 0
    || exportManifest.serving_writes !== 0) {
    throw new Error("The private export lineage is incompatible or not read-only.");
  }
  const exportRecords = exportBody.trim().split("\n").map((line) => JSON.parse(line) as {
    record_key: string;authority_digest: string;partition_memberships: Array<{
      partition_key: string;scope: string;plan_version: number;plan_digest: string;
      slot_digest: string;authority_digest: string;authority_valid_until: string | null;
    }>;
  });
  return {
    packet,exportManifest,exportRecords,pseudonymKey,
    publicEvidence: {
      source_manifest_sha256: sha256(sourceManifestBody),
      diagnostic_manifest_sha256: sha256(diagnosticManifestBody),
      packet_file_sha256: sha256(packetBody),
      export_file_sha256: sha256(exportBody),
      candidate_artifact_digest: sha256(candidateBody),
      discovery_run_digest: required(diagnosticManifest.analytic_digest, "diagnostic analytic digest"),
      holdout_state: "sealed",proposal_count: 115,evidence_count: 805,outlier_evidence_count: 5,
      source_manifest_contract: sourceManifest.contract_version
    }
  };
}

function packetEvidenceRefs(packet: Record<string, unknown>) {
  const candidates = packet.candidates as Array<{ topics: Array<{ sealed_packet: {
    representatives: Array<{ evidence_ref: string }> } }>;outlier_examples: Array<{ evidence_ref: string }> }>;
  const refs = new Set<string>();
  for (const candidate of candidates) {
    for (const topic of candidate.topics) for (const item of topic.sealed_packet.representatives) {
      refs.add(item.evidence_ref);
    }
    for (const item of candidate.outlier_examples) refs.add(item.evidence_ref);
  }
  if (refs.size === 0) throw new Error("The diagnostic packet contains no evidence refs.");
  return refs;
}

function authorityForEvidence(records: Array<{ record_key: string;authority_digest: string;
  partition_memberships: Array<{ partition_key: string;scope: string;plan_version: number;
    plan_digest: string;slot_digest: string;authority_digest: string;
    authority_valid_until: string | null }> }>, refs: Set<string>) {
  const result = new Map<string, { authorityDigest: string;memberships: Array<{
    partitionKey: string;scope: string;planVersion: number;planDigest: string;slotDigest: string;
    authorityDigest: string;authorityValidUntil: string | null }> }>();
  for (const record of records) if (refs.has(record.record_key)) {
    result.set(record.record_key, { authorityDigest: record.authority_digest,
      memberships: record.partition_memberships.map((membership) => ({
        partitionKey: membership.partition_key,scope: membership.scope,
        planVersion: membership.plan_version,planDigest: membership.plan_digest,
        slotDigest: membership.slot_digest,authorityDigest: membership.authority_digest,
        authorityValidUntil: membership.authority_valid_until
      })) });
  }
  if (result.size !== refs.size) throw new Error("Packet evidence does not reconcile the private export.");
  return result;
}

async function inspect(client: pg.Client, checksum: string) {
  const ledger = await client.query<{ migration_name: string;checksum_sha256: string }>(`
    SELECT migration_name,checksum_sha256 FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal=$1`, [MIGRATION.ordinal]);
  const sentinels = await client.query<{ packets: boolean;events: boolean;workspace_owner: boolean }>(`
    SELECT to_regclass('signal_topic_discovery_review_packets') IS NOT NULL packets,
      to_regclass('signal_topic_discovery_review_events') IS NOT NULL events,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='analysis_artifacts' AND column_name='workspace_id') workspace_owner`);
  const sentinelCount = Object.values(sentinels.rows[0] ?? {}).filter(Boolean).length;
  const ledgerCorrect = ledger.rowCount === 1
    && ledger.rows[0]?.migration_name === MIGRATION.filename
    && ledger.rows[0]?.checksum_sha256 === checksum;
  const migrationState = ledger.rowCount === 0 && sentinelCount === 0 ? "absent"
    : ledgerCorrect && sentinelCount === 3 ? "complete" : "partial";
  return { migration_state: migrationState,migration_ledger_count: ledger.rowCount,sentinel_count: sentinelCount,
    protected_state_digest: await protectedState(client),runnable_work: await runnableWork(client) };
}

async function inspectRegisteredPacket(client: pg.Client, packetDigest: string) {
  const value = await client.query<{ proposal_count: number;evidence_count: number;
    outlier_evidence_count: number;reviewed: number }>(`
    SELECT packet.proposal_count,packet.evidence_count,packet.outlier_evidence_count,
      (SELECT count(*)::int FROM signal_topic_discovery_review_decisions decision
       JOIN signal_topic_discovery_reviews review ON review.id=decision.review_id
       WHERE review.packet_artifact_id=packet.artifact_id AND decision.state='finalized') reviewed
    FROM signal_topic_discovery_review_packets packet WHERE packet.packet_digest=$1`, [packetDigest]);
  if (value.rowCount !== 1 || !value.rows[0] || value.rows[0].proposal_count !== 115
    || value.rows[0].evidence_count !== 805 || value.rows[0].outlier_evidence_count !== 5) {
    throw new Error("The real review packet is not registered exactly once.");
  }
  return { ...value.rows[0],holdout_opened: false,ten_c3b_authorized: false,ten_d_ready: false };
}

async function protectedState(client: pg.Client) {
  const domains = ["signal_workspace_population_pointers","signal_governed_view_bindings",
    "signal_classification_generations","signal_classification_assignments","record_tags"];
  const summary = [];
  for (const table of domains) {
    const present = await client.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL present", [table]);
    if (!present.rows[0]?.present) continue;
    const value = await client.query<{ count: number;digest: string }>(`WITH rows AS (
      SELECT to_jsonb(value) body FROM ${table} value
    ),hashes AS(SELECT encode(digest(convert_to(body::text,'UTF8'),'sha256'),'hex') hash FROM rows)
      SELECT count(*)::int count,encode(digest(convert_to(COALESCE(string_agg(hash,'' ORDER BY hash),''),
        'UTF8'),'sha256'),'hex') digest FROM hashes`);
    summary.push({ table,count: value.rows[0]!.count,digest: value.rows[0]!.digest });
  }
  return sha256(stable(summary));
}

async function runnableWork(client: pg.Client) {
  const result = await client.query<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM import_batches WHERE status IN('queued','processing')) imports,
    (SELECT count(*)::int FROM signal_workspace_import_outbox WHERE status IN('pending','dispatching')) import_outbox,
    (SELECT count(*)::int FROM signal_semantic_resolution_runs WHERE status IN('queued','running')) semantic_runs,
    (SELECT count(*)::int FROM signal_strategic_run_controls WHERE status IN('queued','running')) strategic_runs`);
  return result.rows[0]!;
}

async function inspectPeer(url: string, checksum: string) {
  const client = new pg.Client({ connectionString: url,ssl: { rejectUnauthorized: false },
    application_name: "noisia-topic-discovery-review-registration-peer" });
  await client.connect();
  try { return await inspect(client, checksum); } finally { await client.end(); }
}

function assertApplyAuthority() {
  if (!APPLY_APPROVED) throw new Error("Review registration requires explicit apply approval.");
  if (!RESTORE_AT || !RESTORE_HASH?.match(/^sha256:[0-9a-f]{64}$/u)) {
    throw new Error("A fresh verified restore point is required.");
  }
  const ageHours = (Date.now() - Date.parse(RESTORE_AT)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 24) {
    throw new Error("The verified restore point must be less than 24 hours old.");
  }
}

function assertTarget(poolerUrl: string, directUrl: string, supabaseUrl: string) {
  if (fingerprint(poolerUrl) !== EXPECTED.pooler || fingerprint(directUrl) !== EXPECTED.direct
    || projectHash(poolerUrl,"pooler") !== EXPECTED.project
    || projectHash(directUrl,"direct") !== EXPECTED.project
    || sha256(new URL(supabaseUrl).hostname.split(".")[0] ?? "") !== EXPECTED.project) {
    throw new Error("Direct, pooler and storage do not identify noisia-staging.");
  }
}

function assertPeer(left: Awaited<ReturnType<typeof inspect>>, right: Awaited<ReturnType<typeof inspect>>) {
  if (left.migration_state !== right.migration_state
    || left.migration_ledger_count !== right.migration_ledger_count
    || left.protected_state_digest !== right.protected_state_digest) {
    throw new Error("Direct/pooler staging state does not match.");
  }
}

function assertNoRunnableWork(value: Record<string, number>) {
  if (Object.values(value).some((count) => Number(count) !== 0)) {
    throw new Error("Runnable jobs/outbox exist; review registration is blocked.");
  }
}

function assertPrivateOutput(value: string) {
  const privateRoot = resolve(ROOT, ".data");
  if (value !== privateRoot && !value.startsWith(`${privateRoot}/`)) {
    throw new Error("Review registration evidence must remain below .data.");
  }
}

function deriveDirect(value: string) {
  const parsed = new URL(value);
  const ref = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  if (!ref) throw new Error("Canonical pooler connection shape is unavailable.");
  parsed.hostname = `db.${ref}.supabase.co`;parsed.port = "5432";parsed.username = "postgres";
  return parsed.toString();
}

function fingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([parsed.protocol,parsed.hostname.toLowerCase(),parsed.port || "5432",
    parsed.pathname.replace(/^\//u,""),parsed.username].join("|"));
}

function projectHash(value: string, kind: "direct" | "pooler") {
  const parsed = new URL(value);
  const ref = kind === "direct" ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];
  if (!ref) throw new Error("Project identity is unavailable.");
  return sha256(ref);
}

function hmac(key: Buffer, value: string) {
  return `sha256:${createHmac("sha256",key).update(value).digest("hex")}`;
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left],[right]) => left.localeCompare(right))
    .map(([key,item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
