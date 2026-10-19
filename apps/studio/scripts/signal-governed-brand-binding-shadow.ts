import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSignalFilterV1 } from "@noisia/query-engine";

import { pool } from "../src/lib/db";
import { runSignalGovernedBrandBindingShadowV1 } from
  "../src/lib/data-os/signal-governed-brand-shadow";
import {
  resolveSignalWorkspaceForUser,
  type SignalWorkspaceUser
} from "../src/lib/data-os/signal-workspace";

const EXPECTED_DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const ENV_PREFIX = "NOISIA_SIGNAL_GOVERNED_BINDING_SHADOW";

const databaseUrl = required("DATABASE_URL");
assertReadOnlyStagingTarget(databaseUrl);

const workspaceSlug = canonicalKey(required(`${ENV_PREFIX}_WORKSPACE_SLUG`));
const actorEmail = required(`${ENV_PREFIX}_ACTOR_EMAIL`).trim().toLowerCase();
const dateStart = required(`${ENV_PREFIX}_PERIOD_START`);
const dateEnd = required(`${ENV_PREFIX}_PERIOD_END`);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultOutput = resolve(repositoryRoot, ".data", "signal-governed-serving", "05b");
const outputDirectory = safeOutputDirectory(
  process.env[`${ENV_PREFIX}_OUTPUT_DIRECTORY`] ?? defaultOutput,
  repositoryRoot
);
const targetIdentity = {
  classification: process.env.NOISIA_REMOTE_DATABASE_TARGET,
  direct_fingerprint: fingerprint(databaseUrl),
  project_ref_hash: projectRefHash(databaseUrl)
};

try {
  const actorResult = await pool.query<{
    id: string;
    user_type: string;
    organization_id: string | null;
  }>(`
    SELECT id::text, user_type, organization_id::text
    FROM users
    WHERE lower(email) = $1 AND status = 'active'
    LIMIT 1
  `, [actorEmail]);
  const actorRow = actorResult.rows[0];
  if (!actorRow || actorRow.user_type !== "noisia_internal") {
    throw new Error("Binding shadow actor must resolve to one active internal user.");
  }
  const actor: SignalWorkspaceUser = {
    id: actorRow.id,
    userType: actorRow.user_type,
    organizationId: actorRow.organization_id
  };
  const workspace = await resolveSignalWorkspaceForUser(actor, { workspaceSlug });
  if (!workspace || workspace.subject.type !== "brand") {
    throw new Error("Authorized brand workspace was not found.");
  }
  const filter = normalizeSignalFilterV1({
    contract_version: "signal-backend-v1",
    date_range: { start: dateStart, end: dateEnd },
    timezone: workspace.timezone,
    granularity: process.env[`${ENV_PREFIX}_GRANULARITY`] ?? "month",
    dimensions: {}
  });
  const timings: Record<string, number> = {};
  const startedAt = performance.now();
  const evidence = await runSignalGovernedBrandBindingShadowV1({
    workspace,
    actor,
    filter,
    onModuleTiming(moduleKey, durationMs) {
      timings[moduleKey] = durationMs;
    }
  });
  const totalDurationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  const workspaceIdentityHash = sha256([
    workspace.id,
    workspace.subject.id,
    workspace.organizationId
  ].join("|"));
  const publicArtifact = {
    ...evidence.public_evidence,
    target: targetIdentity,
    workspace_identity_hash: workspaceIdentityHash,
    timing_ms: {
      by_module: Object.fromEntries(
        ["brand-monitoring", "mentions", "topics-narratives"].map((moduleKey) => [
          moduleKey,
          timings[moduleKey] ?? null
        ])
      ),
      total: totalDurationMs
    },
    writes_performed: false,
    operational_pointer_followed: false
  };
  const privateArtifact = {
    ...evidence.private_identity,
    workspace_slug: workspace.slug,
    actor_user_id: actor.id,
    target: targetIdentity
  };

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  const publicPath = resolve(outputDirectory, "binding-shadow.sanitized.json");
  const privatePath = resolve(outputDirectory, "binding-shadow.private.json");
  const publicContent = `${JSON.stringify(publicArtifact, null, 2)}\n`;
  const privateContent = `${JSON.stringify(privateArtifact, null, 2)}\n`;
  await writeFile(publicPath, publicContent, { mode: 0o600 });
  await writeFile(privatePath, privateContent, { mode: 0o600 });
  await chmod(publicPath, 0o600);
  await chmod(privatePath, 0o600);

  process.stdout.write(`${JSON.stringify({
    contract_version: publicArtifact.contract_version,
    read_only: true,
    writes_performed: false,
    target: targetIdentity,
    workspace_identity_hash: workspaceIdentityHash,
    gate_passed: publicArtifact.gate_passed,
    unexplained_count: publicArtifact.cross_module.unexplained_count,
    operational_pointer_followed: false,
    timing_ms: publicArtifact.timing_ms,
    artifacts: {
      sanitized: relativeArtifactPath(publicPath, repositoryRoot),
      private: relativeArtifactPath(privatePath, repositoryRoot),
      mode: "0600",
      sanitized_sha256: sha256(publicContent),
      private_sha256: sha256(privateContent)
    }
  }, null, 2)}\n`);
} finally {
  await pool.end();
}

function assertReadOnlyStagingTarget(value: string) {
  const parsed = new URL(value);
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Current-binding shadow CLI is reserved for the audited staging target.");
  }
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  const observedFingerprint = fingerprint(value);
  if (!["preview", "staging"].includes(target)
    || process.env[`${ENV_PREFIX}_ALLOW_REMOTE`] !== "true"
    || process.env[`${ENV_PREFIX}_READ_ONLY_APPROVED`] !== "true"
    || process.env[`${ENV_PREFIX}_NO_APP_CONNECTIONS_CONFIRMED`] !== "true"
    || process.env[`${ENV_PREFIX}_TARGET_FINGERPRINT`] !== observedFingerprint
    || observedFingerprint !== EXPECTED_DIRECT_FINGERPRINT
    || projectRefHash(value) !== EXPECTED_PROJECT_REF_HASH) {
    throw new Error("Binding shadow target is not the explicitly audited noisia-staging project.");
  }
  if (process.env.DATABASE_SSL !== "true") {
    throw new Error("DATABASE_SSL=true is required for the staging shadow.");
  }
}

function fingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
  ].join("|"));
}

function projectRefHash(value: string) {
  const parsed = new URL(value);
  const projectRef = /^db\.([a-z0-9]+)\.supabase\.co$/u
    .exec(parsed.hostname.toLowerCase())?.[1];
  if (!projectRef) throw new Error("Direct connection does not expose a Supabase project ref.");
  return sha256(projectRef);
}

function safeOutputDirectory(input: string, root: string) {
  const output = resolve(input);
  const allowedRoot = resolve(root, ".data");
  if (output !== allowedRoot && !output.startsWith(`${allowedRoot}/`)) {
    throw new Error("Shadow evidence output must stay below the repository .data directory.");
  }
  return output;
}

function relativeArtifactPath(path: string, root: string) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function canonicalKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)) {
    throw new Error("Workspace slug must be canonical.");
  }
  return normalized;
}
