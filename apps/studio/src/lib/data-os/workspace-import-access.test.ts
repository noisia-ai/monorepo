import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as queryEngine from "@noisia/query-engine";
import * as capabilities from "../../../../../infrastructure/db/signal-workspace-capabilities";
import * as roles from "../auth/roles";
import { loadSignalWorkspaceContextWithDependencies } from "./signal-workspace-context";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
type Module = Record<string, unknown>;
async function loadModule<T>(path: string, dependencies: Record<string, Module>): Promise<T> {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const exports: Module = {};
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText;
  new Function("require", "exports", compiled)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected fixture dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports as T;
}

async function fixture() {
  const actor = { id: actorId, userType: "client", primaryRole: "client_admin", status: "active", organizationId: "own-org" };
  let workspace = { id: workspaceId, status: "active", subject: { type: "brand", id: "own-brand" } };
  let grant: string | null = "comment", sameOrganization = true;
  const reads: string[] = [], writes: string[] = [];
  const pool = { async query(sql: string, params: unknown[]) {
    assert.match(sql, /access\.revoked_at IS NULL/u);
    assert.deepEqual(params, [workspaceId, actorId]);
    return { rows: [{ workspace_status: workspace.status, brand_status: "active", actor_status: actor.status,
      user_type: actor.userType, primary_role: actor.primaryRole, same_organization: sameOrganization,
      brand_access_level: grant }] };
  } };
  const contextDependencies = {
    getSession: async () => ({ appUser: actor }), isEnabled: () => true,
    canView: roles.canViewClientOutputs,
    resolveWorkspace: async (_actor: unknown, lookup: { workspaceId: string }) => (
      lookup.workspaceId === workspaceId && sameOrganization ? workspace : null
    )
  } as Parameters<typeof loadSignalWorkspaceContextWithDependencies>[1];
  const imported = await loadModule<typeof import("../../app/api/data-os/_lib/load-import")>(
    "../../app/api/data-os/_lib/load-import.ts", {
      "@noisia/db": capabilities,
      "@/lib/auth/session": { getAuthenticatedAppUser: contextDependencies.getSession },
      "@/lib/auth/roles": roles, "@/lib/db": { pool },
      "@/lib/data-os/serving": { isSignalWorkspaceApiEnabled: contextDependencies.isEnabled },
      "@/lib/data-os/signal-workspace": { resolveSignalWorkspaceForUser: contextDependencies.resolveWorkspace },
      "@/lib/data-os/signal-workspace-context": { loadSignalWorkspaceContextWithDependencies }
    });
  const dependencies = {
    "zod": await import("zod"), "@noisia/query-engine": queryEngine,
    "@/app/api/data-os/_lib/load-import": imported,
    "@/app/api/data-os/_lib/load": { loadSignalWorkspaceContextForManagement: (id: string) =>
      loadSignalWorkspaceContextWithDependencies(id, { ...contextDependencies, canView: roles.canManageCorpus }) },
    "@/lib/data-os/signal-acquisition-plan": {
      loadSignalAcquisitionPlanProductV1: async (args: { workspace: { id: string }; actor: { id: string }; access?: string }) => {
        assert.equal(args.workspace.id, workspaceId); assert.equal(args.actor.id, actorId);
        assert.equal(args.access, "manual-import"); reads.push("plan");
        return { state: "current", slots: [{ slot_key: "own-brand", scope: "primary_brand" }] };
      },
      withSignalAcquisitionTransactionV1: async () => { writes.push("plan"); throw new Error("Unexpected mutation"); }
    },
    "@/lib/data-os/workspace-ingestion": {
      listWorkspaceDataSources: async (id: string) => {
        assert.equal(id, workspaceId); reads.push("sources");
        return [{ sourceKey: "own-source", sourceContractVersion: "signal-data-source-connector-v1",
          name: "Synthetic source", createdAt: new Date(0), updatedAt: new Date(0), privateToken: "NEVER_RETURN" }];
      },
      createWorkspaceConnectorSourceProductInTransactionV1: async () => { writes.push("sources"); throw new Error("Unexpected mutation"); }
    }
  };
  const plan = await loadModule<typeof import("../../app/api/data-os/signal/[workspaceId]/acquisition-plan/route")>(
    "../../app/api/data-os/signal/[workspaceId]/acquisition-plan/route.ts", dependencies);
  const sources = await loadModule<typeof import("../../app/api/data-os/signal/[workspaceId]/sources/route")>(
    "../../app/api/data-os/signal/[workspaceId]/sources/route.ts", dependencies);
  const forbiddenService = new Proxy({}, { get: (_target, property) => () => {
    writes.push(String(property)); throw new Error("Unexpected internal service or provider call");
  } });
  const internalRoute = (relative: string) => loadModule<{ GET?: typeof plan.GET; POST: typeof plan.POST }>(
    `../../app/api/data-os/signal/[workspaceId]/acquisition-plan/${relative}/route.ts`, {
      ...dependencies,
      "@/lib/data-os/signal-acquisition-brief-management": forbiddenService,
      "@/lib/data-os/signal-acquisition-query-composer": forbiddenService,
      "@/lib/data-os/signal-acquisition-query-provider": forbiddenService
    });
  return { plan, sources, reads, writes, actor, workspace, internalRoute,
    revoke: () => { grant = null; }, viewer: () => { actor.primaryRole = "client_viewer"; grant = "read"; },
    internalTheme: () => { actor.userType = "noisia_internal"; actor.primaryRole = "noisia_admin";
      workspace = { ...workspace, subject: { type: "theme", id: "own-theme" } }; },
    moveTenant: () => { sameOrganization = false; } };
}
const context = (id = workspaceId) => ({ params: Promise.resolve({ workspaceId: id }) });
const request = (method = "GET") => new Request("https://noisia.invalid/api/data-os/signal/synthetic", { method,
  ...(method === "POST" ? { headers: { "Content-Type": "application/json", "Idempotency-Key": "synthetic-import-access" }, body: "{}" } : {}) });
function definedResponse(value: Response | undefined) { assert.ok(value); return value; }

test("assigned client admin reads the plan and safe sources with live import authority and private caching", async () => {
  const f = await fixture();
  for (const route of [f.plan, f.sources]) {
    const response = definedResponse(await route.GET(request(), context()));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control") ?? "", /private, no-store/u);
    assert.doesNotMatch(await response.text(), /NEVER_RETURN/u);
  }
  assert.deepEqual(f.reads, ["plan", "sources"]); assert.deepEqual(f.writes, []);
});

test("cross-workspace and cross-tenant reads stop before loading plan or source data", async () => {
  const f = await fixture();
  for (const route of [f.plan, f.sources]) assert.equal(definedResponse(await route.GET(request(), context(otherWorkspaceId))).status, 404);
  f.moveTenant();
  for (const route of [f.plan, f.sources]) assert.equal(definedResponse(await route.GET(request(), context())).status, 404);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});

test("revoked, suspended and read-only grants cannot use acquisition import reads", async () => {
  for (const deny of [(f: Awaited<ReturnType<typeof fixture>>) => f.revoke(),
    (f: Awaited<ReturnType<typeof fixture>>) => f.viewer(),
    (f: Awaited<ReturnType<typeof fixture>>) => { f.actor.status = "suspended"; }]) {
    const f = await fixture(); deny(f);
    for (const route of [f.plan, f.sources]) assert.equal(definedResponse(await route.GET(request(), context())).status, 403);
    assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
  }
});

test("client POST cannot reconcile a plan or create a source, including after permitted GET", async () => {
  const f = await fixture();
  for (const route of [f.plan, f.sources]) {
    assert.equal(definedResponse(await route.GET(request(), context())).status, 200);
    assert.equal(definedResponse(await route.POST(request("POST"), context())).status, 403);
  }
  assert.deepEqual(f.writes, []);
});

test("internal operator keeps plan and source GET access", async () => {
  const f = await fixture(); f.actor.userType = "noisia_internal"; f.actor.primaryRole = "noisia_admin";
  for (const route of [f.plan, f.sources]) assert.equal(definedResponse(await route.GET(request(), context())).status, 200);
});

test("internal theme workspace keeps generic source inventory access", async () => {
  const f = await fixture(); f.internalTheme();
  assert.equal(definedResponse(await f.sources.GET(request(), context())).status, 200);
  assert.deepEqual(f.reads, ["sources"]); assert.deepEqual(f.writes, []);
});

test("opening import reads grants no brief, generation, query, reference or promotion authority", async () => {
  const f = await fixture();
  for (const relative of ["brief", "query-generation", "promote", "reference-decisions", "slots/[slotKey]/query-versions"]) {
    const route = await f.internalRoute(relative);
    const params = { params: Promise.resolve({ workspaceId, slotKey: "own-brand" }) };
    if (route.GET) assert.equal(definedResponse(await route.GET(request(), params)).status, 403, `${relative} GET`);
    assert.equal(definedResponse(await route.POST(request("POST"), params)).status, 403, `${relative} POST`);
  }
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});

test("the next GET after grant revocation cannot reuse a previously permitted read", async () => {
  const f = await fixture();
  for (const route of [f.plan, f.sources]) assert.equal(definedResponse(await route.GET(request(), context())).status, 200);
  f.revoke();
  for (const route of [f.plan, f.sources]) assert.equal(definedResponse(await route.GET(request(), context())).status, 403);
  assert.deepEqual(f.reads, ["plan", "sources"]);
});
