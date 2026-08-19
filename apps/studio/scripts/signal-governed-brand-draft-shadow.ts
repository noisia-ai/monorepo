import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeSignalFilterV1,
  normalizeSignalGovernedViewModuleKeyV1
} from "@noisia/query-engine";

import { pool } from "../src/lib/db";
import { runSignalBrandDraftShadowV1 } from "../src/lib/data-os/signal-governed-brand-shadow";
import {
  resolveSignalWorkspaceForUser,
  type SignalWorkspaceUser
} from "../src/lib/data-os/signal-workspace";

const databaseUrl = required("DATABASE_URL");
const workspaceSlug = canonicalKey(required("NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_WORKSPACE_SLUG"));
const actorEmail = required("NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_ACTOR_EMAIL").trim().toLowerCase();
const moduleKey = normalizeSignalGovernedViewModuleKeyV1(
  required("NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_MODULE_KEY")
);
const dateStart = required("NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_PERIOD_START");
const dateEnd = required("NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_PERIOD_END");

assertReadOnlyTarget(databaseUrl);

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
  throw new Error("Draft shadow actor must resolve to one active internal user.");
}
const actor: SignalWorkspaceUser = {
  id: actorRow.id,
  userType: actorRow.user_type,
  organizationId: actorRow.organization_id
};
const workspace = await resolveSignalWorkspaceForUser(actor, { workspaceSlug });
if (!workspace) throw new Error("Authorized brand workspace was not found.");

const filter = normalizeSignalFilterV1({
  contract_version: "signal-backend-v1",
  date_range: { start: dateStart, end: dateEnd },
  timezone: workspace.timezone,
  granularity: process.env.NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_GRANULARITY ?? "month",
  dimensions: {}
});
const evidence = await runSignalBrandDraftShadowV1({
  workspace,
  actor,
  moduleKey,
  filter
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outputDirectory = resolve(repositoryRoot, ".data", "signal-governed-brand-shadow");
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const baseName = `${workspaceSlug}-${moduleKey}`;
const publicPath = resolve(outputDirectory, `${baseName}.public.json`);
const privatePath = resolve(outputDirectory, `${baseName}.private.json`);
await writeFile(publicPath, `${JSON.stringify(evidence.public_evidence, null, 2)}\n`, { mode: 0o600 });
await writeFile(privatePath, `${JSON.stringify(evidence.private_identity, null, 2)}\n`, { mode: 0o600 });

process.stdout.write(`${JSON.stringify({
  ...evidence.public_evidence,
  evidence_files: {
    public: `.data/signal-governed-brand-shadow/${baseName}.public.json`,
    private: `.data/signal-governed-brand-shadow/${baseName}.private.json`,
    private_mode: "0600"
  }
}, null, 2)}\n`);
await pool.end();

function assertReadOnlyTarget(value: string) {
  const parsed = new URL(value);
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) return;
  const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
  if (!(["preview", "staging"].includes(target ?? ""))
    || process.env.NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_ALLOW_REMOTE !== "true"
    || process.env.NOISIA_SIGNAL_GOVERNED_BRAND_SHADOW_READ_ONLY_APPROVED !== "true") {
    throw new Error("Remote draft shadow requires an explicitly classified read-only preview/staging target.");
  }
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
