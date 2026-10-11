import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
function fixture(denied = 0, failure = false) {
  const calls: string[] = [];
  const dependencies: Record<string, unknown> = {
    "../../../../topics/_lib": {
      loadSignalWorkspaceContextForTopics: async (id: string) => {
        assert.equal(id, "workspace"); calls.push("access");
        return denied ? { response: Response.json({ error: "denied" }, { status: denied }) }
          : { session: { appUser: { id: "authenticated-actor" } }, workspace: { timezone: "America/Mexico_City" } };
      },
      topicResponse: (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }),
      topicError: (_error: unknown, code: string) => Response.json({ error: code }, { status: 503 }),
    },
    "@/lib/data-os/signal-workspace-topics-native": {
      loadNativeSignalTopicReadBundleV1: async (scope: unknown, term: string, params: URLSearchParams, kind: string) => {
        calls.push("bundle"); assert.deepEqual(scope, { workspace_id: "workspace", actor_user_id: "authenticated-actor", timezone: "America/Mexico_City" });
        assert.equal(term, "service"); assert.equal(kind, "topic"); assert.equal(params.get("scope_digest"), "sha256:current");
        assert.equal(params.get("cursor"), "root-keyset");
        if (failure) throw Error("private database detail");
        return { contract_version: "signal-workspace-topic-read-bundle-v1" };
      },
    },
  };
  const source = readFileSync(new URL("../../app/api/data-os/signal/[workspaceId]/topics-narratives/[kind]/[termKey]/inspection/route.ts", import.meta.url), "utf8");
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    (name: string) => { assert.ok(name in dependencies); return dependencies[name]; }, exports);
  const get = exports.GET as (request: Request, context: { params: Promise<{ workspaceId: string; kind: string; termKey: string }> }) => Promise<Response>;
  return { calls, read: (kind = "topic", view = "all_conversations") => get(new Request(`https://noisia.invalid/inspection?view=${view}&scope_digest=sha256:current&cursor=root-keyset`),
    { params: Promise.resolve({ workspaceId: "workspace", kind, termKey: "service" }) }) };
}
test("inspection preserves workspace authority before the one combined read and private no-store", async () => {
  const f = fixture(), response = await f.read(); assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.deepEqual(f.calls, ["access", "bundle"]);
});
test("inspection fails closed for revoked access, unsupported kind/view and sanitized read failures", async () => {
  for (const code of [401, 403, 404]) { const f = fixture(code); assert.equal((await f.read()).status, code); assert.deepEqual(f.calls, ["access"]); }
  for (const [kind, view] of [["noise", "all_conversations"], ["topic", "brand"]]) {
    const f = fixture(); assert.equal((await f.read(kind, view)).status, 404); assert.deepEqual(f.calls, []);
  }
  const f = fixture(0, true), response = await f.read(); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "workspace_topic_inspection_unavailable" });
});

test("page bundle route scopes the first detail and evidence before exposing a fresh snapshot", async () => {
  const source = readFileSync(new URL("../../app/api/data-os/signal/[workspaceId]/topics-narratives/page/route.ts", import.meta.url), "utf8");
  for (const denied of [0, 401, 403, 404]) {
    const calls: string[] = [], exports: Record<string, unknown> = {};
    const dependencies: Record<string, unknown> = {
      "@/lib/data-os/signal-imported-serving": { allowImportedSignalFallbackV1: () => true },
      "../../topics/_lib": {
        loadSignalWorkspaceContextForTopics: async () => { calls.push("access"); return denied ? { response: Response.json({}, { status: denied }) }
          : { session: { appUser: { id: "actor" } }, workspace: { timezone: "UTC" } }; },
        topicResponse: (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }),
        topicError: () => Response.json({}, { status: 503 }),
      },
      "@/lib/data-os/signal-workspace-topics-native": { loadNativeSignalTopicsPageV1: async (scope: unknown) => {
        calls.push("page"); assert.deepEqual(scope, { workspace_id: "workspace", actor_user_id: "actor", timezone: "UTC", imported_fallback: true });
        return { contract_version: "signal-workspace-topic-read-bundle-v1" };
      } },
    };
    new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
      (name: string) => { assert.ok(name in dependencies); return dependencies[name]; }, exports);
    const get = exports.GET as (request: Request, context: { params: Promise<{ workspaceId: string }> }) => Promise<Response>;
    const response = await get(new Request("https://noisia.invalid/page?view=all_conversations"), { params: Promise.resolve({ workspaceId: "workspace" }) });
    assert.equal(response.status, denied || 200); assert.deepEqual(calls, denied ? ["access"] : ["access", "page"]);
    if (!denied) assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});
