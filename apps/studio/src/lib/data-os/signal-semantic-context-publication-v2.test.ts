import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalJsonV2,
  digestCanonicalJsonV2,
  SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2
} from "@/lib/data-os/signal-semantic-context-publication-v2";

const vectors: Array<{ name: string; value: unknown; canonical: string; digest: string }> = [
  {
    name: "quote, slash, backslash and controls",
    value: { s: "quote\" slash/ backslash\\ LF\n NUL\0" },
    canonical: "{\"s\":\"quote\\\" slash/ backslash\\\\ LF\\u000A NUL\\u0000\"}",
    digest: "sha256:c0998b854a4e659786347d2f3bdbed948fe8091f73161be23a18e21e50a53b41"
  },
  {
    name: "combining NFC",
    value: { s: "Cafe\u0301" },
    canonical: "{\"s\":\"Café\"}",
    digest: "sha256:d4f21edc957c8d5f5c6ba620f820dabb8b4afc2398a7603cf49e875cf2a36269"
  },
  {
    name: "astral scalar",
    value: { s: "🧠" },
    canonical: "{\"s\":\"🧠\"}",
    digest: "sha256:b2d883dfb70d681a2de3ee4bc8866c220e62896dc61a333cd348fe7a01c37283"
  },
  {
    name: "line and paragraph separators",
    value: { s: "a\u2028b\u2029c" },
    canonical: "{\"s\":\"a\\u2028b\\u2029c\"}",
    digest: "sha256:7970f45418dae559568b46bf9e8df590584d1f531ad30fe670521565d2b36cf4"
  },
  {
    name: "byte-ordered object and arrays",
    value: { b: 2, a: [3, { z: "last", a: "first" }] },
    canonical: "{\"a\":[3,{\"a\":\"first\",\"z\":\"last\"}],\"b\":2}",
    digest: "sha256:c707db5812c5616df37b78e3147bfb3ae755ffd7b0f716e42321a4ac92099111"
  }
];

for (const vector of vectors) {
  test(`canonical_json_v2 matches frozen vector: ${vector.name}`, () => {
    assert.equal(canonicalJsonV2(vector.value), vector.canonical);
    assert.equal(digestCanonicalJsonV2(vector.value), vector.digest);
  });
}

test("canonical_json_v2 rejects lone surrogates, floats, and normalized-key collisions", () => {
  assert.throws(() => canonicalJsonV2({ s: "\ud800" }), /canonical_json_v2_lone_surrogate/u);
  assert.throws(() => canonicalJsonV2({ s: "\udc00" }), /canonical_json_v2_lone_surrogate/u);
  assert.throws(() => canonicalJsonV2({ n: 1.5 }), /canonical_json_v2_integer_required/u);
  assert.throws(() => canonicalJsonV2({ "Café": 1, "Cafe\u0301": 2 }), /canonical_json_v2_key_collision/u);
});

test("canonical publish route exposes only V2 confirmation and preflight authority", async () => {
  const route = await readFile(new URL("../../app/api/data-os/signal/[workspaceId]/semantic-context/publish/route.ts",
    import.meta.url), "utf8");
  assert.match(route, /preflight_digest/u);
  assert.match(route, /z\.literal\(SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2\)/u);
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2, "publish_reviewed_semantic_context_v2");
  assert.doesNotMatch(route, /z\.literal\("publish_reviewed_semantic_context"\)/u);
  for (const browserOwned of ["candidate_pack_digest", "evidence_graph_digest", "review_graph_digest",
    "publication_authority_digest", "semantic_context_pack_digest", "element_id", "actor_user_id"]) {
    assert.doesNotMatch(route, new RegExp(browserOwned, "u"));
  }
});

test("management routes keep review authority server-owned and private", async () => {
  const routes = await Promise.all([
    "merge/route.ts",
    "corrections/route.ts",
    "annotations/route.ts",
    "publish/preflight/route.ts"
  ].map((path) => readFile(new URL(`../../app/api/data-os/signal/[workspaceId]/semantic-context/${path}`,
    import.meta.url), "utf8")));
  for (const route of routes) {
    assert.match(route, /loadSignalWorkspaceContextForSemanticContextManagement/u);
    assert.doesNotMatch(route, /evidence_(?:id|group_id)|actor_user_id|publication_authority_digest/u);
  }
  for (const route of routes.slice(0, 3)) {
    assert.match(route, /requireIdempotencyKey/u);
    assert.match(route, /\.strict\(\)/u);
  }
  for (const route of routes.slice(0, 2)) {
    assert.match(route, /annotation_key must be unique/u,
      "merge and correction reject repeated or contradictory annotation resolutions at Zod");
  }
  const service = await readFile(new URL("./signal-semantic-context-publication-v2.ts", import.meta.url), "utf8");
  assert.match(service, /semantic_context_duplicate_annotation_resolution/u,
    "the server writer independently rejects repeated annotation keys");
  assert.match(service, /draft_digest_ref/u);
  assert.doesNotMatch(service, /draft_digest:draftDigest/u,
    "operator-safe merge and correction responses never expose the complete draft digest");
  const shared = await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/_lib.ts", import.meta.url), "utf8");
  assert.match(shared, /private, no-store/u);
});

test("browser decisions retire V1 edit and route guided rejection through the atomic V2 writer", async () => {
  const route = await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/decisions/route.ts", import.meta.url), "utf8");
  assert.match(route, /semantic_context_edit_v1_retired/u);
  assert.ok(route.includes("},410)"));
  assert.doesNotMatch(route, /action:z\.literal\("edit"\)/u);
  assert.match(route, /rejectSignalSemanticContextElementProductV2/u);
  assert.match(route, /reason:z\.enum\(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2\)/u);
  assert.doesNotMatch(route, /workspace_id|authority_digest|proposal_model/u);
});

test("all remaining V1 review mutations reject stale authority and active runs server-side", async () => {
  const service = await readFile(new URL("./signal-semantic-context-pack.ts", import.meta.url), "utf8");
  assert.equal((service.match(/await assertV1ReviewMutationCurrent\(/gu) ?? []).length, 2,
    "single and bounded bulk V1 decisions use the same current-authority guard");
  assert.match(service, /\["queued","processing","validating"\]\.includes\(run\.status\)/u);
  assert.match(service, /run\.executable_outbox\|\|run\.reserved_budget/u);
  assert.match(service, /semantic_context_authority_drift/u);
});
