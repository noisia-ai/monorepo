import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import type { SignalSemanticReviewApiDependencies } from "./signal-semantic-review-api";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const api = await import("./signal-semantic-review-api");
const resolutionApi = await import("./signal-semantic-resolution-api");
const governanceApi = await import("./signal-admin-mention-governance-api");
const operatorModel = await import("./signal-admin-mention-operator");
const workspaceServing = await import("./signal-workspace-serving");

const WORKSPACE_ID = "71000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "71000000-0000-4000-8000-000000000002";
const USER_ID = "71000000-0000-4000-8000-000000000003";
const MENTION_ID = "71000000-0000-4000-8000-000000000004";

function authorized() {
  return {
    workspace: { id: WORKSPACE_ID },
    session: { appUser: { id: USER_ID } }
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadContext: async () => authorized(),
    listQueue: async () => ({ records: [] }),
    generateCandidates: async () => ({ writes_performed: false }),
    createAssertion: async () => ({ assertion_id: "assertion" }),
    reviewAssertion: async () => ({ assertion_id: "assertion" }),
    supersedeAssertion: async () => ({ assertion_id: "assertion" }),
    listHistory: async () => ({ events: [] }),
    ...overrides
  } as unknown as SignalSemanticReviewApiDependencies;
}

test("Semantic Review routes stop before data access when operator AuthZ fails", async () => {
  let listed = false;
  const response = await api.handleSignalSemanticReviewList(
    new Request(`https://studio.test/api/data-os/signal/${WORKSPACE_ID}/semantic-review`),
    WORKSPACE_ID,
    dependencies({
      loadContext: async () => ({ response: Response.json({ error: "forbidden" }, { status: 403 }) }),
      listQueue: async () => {
        listed = true;
        return { records: [] };
      }
    })
  );
  assert.equal(response.status, 403);
  assert.equal(listed, false);
});

test("Semantic Review list uses only the server-resolved workspace", async () => {
  let observedWorkspace: string | null = null;
  const response = await api.handleSignalSemanticReviewList(
    new Request(`https://studio.test/api/data-os/signal/${OTHER_WORKSPACE_ID}/semantic-review?limit=25`),
    OTHER_WORKSPACE_ID,
    dependencies({
      listQueue: async (args: { workspaceId: string }) => {
        observedWorkspace = args.workspaceId;
        return { records: [] };
      }
    })
  );
  assert.equal(response.status, 200);
  assert.equal(observedWorkspace, WORKSPACE_ID);
});

test("Semantic Review mention focus is canonical, server-scoped and composable after send_to_review", async () => {
  let observedMention: string | null | undefined = null;
  const response = await api.handleSignalSemanticReviewList(
    new Request(
      `https://studio.test/api/data-os/signal/${OTHER_WORKSPACE_ID}/semantic-review?mention=${MENTION_ID}&limit=1`
    ),
    OTHER_WORKSPACE_ID,
    dependencies({
      listQueue: async (args: { filters: { mention_id?: string } }) => {
        observedMention = args.filters.mention_id;
        return { records: [{ mention_id: MENTION_ID, state: "needs_context" }] };
      }
    })
  );
  assert.equal(response.status, 200);
  assert.equal(observedMention, MENTION_ID);
});

test("Semantic Review decisions always record the authenticated reviewer", async () => {
  let observedReviewer: string | null = null;
  const response = await api.handleSignalSemanticAssertionCreation(
    new Request(`https://studio.test/api/data-os/signal/${WORKSPACE_ID}/semantic-review/assertions`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "manual-review-001" },
      body: JSON.stringify({
        mention_id: MENTION_ID,
        scope: "primary_brand",
        entity_id: null,
        confidence: 0.95,
        rationale: "Explicit governed brand identity in the mention."
      })
    }),
    WORKSPACE_ID,
    dependencies({
      createAssertion: async (args: { reviewerUserId: string }) => {
        observedReviewer = args.reviewerUserId;
        return { assertion_id: "assertion" };
      }
    })
  );
  assert.equal(response.status, 201);
  assert.equal(observedReviewer, USER_ID);
});

test("Semantic Review rejects arbitrary reviewer fields and missing idempotency", async () => {
  const arbitraryReviewer = await api.handleSignalSemanticAssertionCreation(
    new Request(`https://studio.test/api/data-os/signal/${WORKSPACE_ID}/semantic-review/assertions`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "manual-review-002" },
      body: JSON.stringify({
        mention_id: MENTION_ID,
        scope: "unattributed",
        entity_id: null,
        confidence: 0.5,
        rationale: "Context is insufficient for a governed identity.",
        reviewer_user_id: "71000000-0000-4000-8000-000000000099"
      })
    }),
    WORKSPACE_ID,
    dependencies()
  );
  const missingKey = await api.handleSignalSemanticAssertionCreation(
    new Request(`https://studio.test/api/data-os/signal/${WORKSPACE_ID}/semantic-review/assertions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mention_id: MENTION_ID,
        scope: "unattributed",
        confidence: 0.5,
        rationale: "Context is insufficient for a governed identity."
      })
    }),
    WORKSPACE_ID,
    dependencies()
  );
  assert.equal(arbitraryReviewer.status, 400);
  assert.equal(missingKey.status, 400);
});

test("Semantic resolver GET polling is read-only and never enqueues a queued run", async () => {
  let enqueueCalls = 0;
  const dependenciesWithImpossibleEnqueue = {
    loadContext: async () => ({ workspace: { id: WORKSPACE_ID } }),
    loadLatest: async () => ({ run_id: "run-1", status: "queued" }),
    isUnavailableSchema: () => false,
    enqueue: async () => {
      enqueueCalls += 1;
    }
  };
  const response = await resolutionApi.handleSignalSemanticResolutionStatus(
    OTHER_WORKSPACE_ID,
    dependenciesWithImpossibleEnqueue
  );
  const payload = await response.json() as { available: boolean; run: { status: string } };
  assert.equal(response.status, 200);
  assert.equal(payload.available, true);
  assert.equal(payload.run.status, "queued");
  assert.equal(enqueueCalls, 0);
});

test("Semantic resolver GET stops before reading a run when operator AuthZ fails", async () => {
  let reads = 0;
  const response = await resolutionApi.handleSignalSemanticResolutionStatus(WORKSPACE_ID, {
    loadContext: async () => ({ response: Response.json({ error: "forbidden" }, { status: 403 }) }),
    loadLatest: async () => {
      reads += 1;
      return null;
    },
    isUnavailableSchema: () => false
  });
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});

test("Canonical mention governance fails before mutation when workspace AuthZ fails", async () => {
  let mutations = 0;
  const response = await governanceApi.handleSignalAdminMentionGovernanceMutation(
    new Request(`https://studio.test/api/data-os/signal/${OTHER_WORKSPACE_ID}/admin-mentions/${MENTION_ID}/governance`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "governance-test-001" },
      body: JSON.stringify({ action: "exclude", reason: "Operator rejected this mention." })
    }),
    OTHER_WORKSPACE_ID,
    MENTION_ID,
    {
      loadContext: async () => ({ response: Response.json({ error: "forbidden" }, { status: 403 }) }),
      mutate: async () => {
        mutations += 1;
        return {} as never;
      }
    }
  );
  assert.equal(response.status, 403);
  assert.equal(mutations, 0);
});

test("Canonical mention governance uses server-resolved workspace and authenticated actor", async () => {
  const observed: Array<{ workspaceId: string; actorUserId: string }> = [];
  const response = await governanceApi.handleSignalAdminMentionGovernanceMutation(
    new Request(`https://studio.test/api/data-os/signal/${OTHER_WORKSPACE_ID}/admin-mentions/${MENTION_ID}/governance`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "governance-test-002" },
      body: JSON.stringify({ action: "send_to_review", reason: "Needs governed semantic review." })
    }),
    OTHER_WORKSPACE_ID,
    MENTION_ID,
    {
      loadContext: async () => authorized(),
      mutate: async (args) => {
        observed.push(args);
        return {
          contract_version: "signal-canonical-mention-governance-v1",
          event_id: "event",
          canonical_mention_id: MENTION_ID,
          action: "send_to_review",
          inclusion_status: "included",
          exclusion_reason: null,
          was_replayed: false,
          changed: false,
          idempotency_key: "hash",
          population_pointer_changed: false
        } as const;
      }
    }
  );
  assert.equal(response.status, 201);
  assert.equal(observed[0]?.workspaceId, WORKSPACE_ID);
  assert.equal(observed[0]?.actorUserId, USER_ID);
});

test("Operator-safe values remove raw metadata and sensitive nested fields", () => {
  const safe = operatorModel.sanitizeOperatorValue({
    quality_state: "partial",
    duplicate: true,
    raw_metadata: { body: "must not leak" },
    source_url: "https://sensitive.example",
    nested: { score: 0.8, author_handle: "hidden", reason: "quality" }
  });
  assert.deepEqual(safe, {
    quality_state: "partial",
    duplicate: true,
    nested: { score: 0.8, reason: "quality" }
  });
  assert.doesNotMatch(JSON.stringify(safe), /raw_metadata|must not leak|sensitive\.example|author_handle/u);
});

test("Focused Admin mention detail composes canonical operator lineage without raw metadata", {
  skip: process.env.NOISIA_SIGNAL_ADMIN_MENTION_OPERATOR_INTEGRATION_APPROVED !== "true"
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    const workspace = await client.query<{ id: string }>(`
      SELECT id::text FROM signal_workspaces
      WHERE brand_id = '72000000-0000-4000-8000-000000000201'::uuid
    `);
    const workspaceId = workspace.rows[0]?.id;
    assert.ok(workspaceId);
    const detail = await operatorModel.loadSignalAdminMentionOperatorV1({
      workspaceId,
      mentionId: "72000000-0000-4000-8000-000000000608"
    });
    assert.ok(detail);
    assert.equal(detail.canonical.requested_via_alias, true);
    assert.equal(detail.canonical.mention_id, "72000000-0000-4000-8000-000000000601");
    assert.equal(detail.canonical.aliases.length, 2);
    assert.ok(detail.provenance.imports.length >= 1);
    assert.ok(detail.semantic.history.length >= 1);
    assert.ok(detail.operational.populations.length >= 1);
    assert.ok(detail.governance.latest_review_request);
    assert.doesNotMatch(JSON.stringify(detail), /raw_metadata|text_raw|profile_url/u);

    const facets = await operatorModel.loadSignalAdminMentionOperatorFacetsV1({ workspaceId });
    assert.equal(facets.scope, "all_workspace_canonical_roots");
    assert.ok((facets.facets.inclusion_status ?? []).reduce((total, item) => total + item.count, 0) > 100);
    assert.ok((facets.facets.resolution_state ?? []).length >= 1);

    const summaries = await operatorModel.loadSignalAdminMentionOperatorSummariesV1({
      workspaceId,
      mentionIds: [detail.canonical.mention_id]
    });
    const summary = summaries.get(detail.canonical.mention_id);
    assert.ok(summary);
    assert.equal(typeof summary.resolution_state, "string");
    assert.equal(typeof (summary.provenance as { import_count: number }).import_count, "number");
    assert.doesNotMatch(JSON.stringify(summary), /raw_metadata|text_raw|profile_url/u);

    const filterParams = new URLSearchParams(
      "inclusion_status=included&resolution_state=pending&minimum_quality_score=0.5"
    );
    const parsedFilter = operatorModel.parseSignalAdminMentionOperatorFiltersV1(filterParams);
    assert.equal(parsedFilter.active, true);
    assert.equal(filterParams.has("inclusion_status"), false);
    const matchingIds = await operatorModel.resolveSignalAdminMentionOperatorFilterIdsV1({
      workspaceId,
      filters: parsedFilter.filters
    });
    assert.ok(matchingIds.every((mentionId) => mentionId !== "72000000-0000-4000-8000-000000000608"));

    const resolvedWorkspace = {
      contractVersion: "signal-backend-v1" as const,
      id: workspaceId,
      organizationId: "72000000-0000-4000-8000-000000000101",
      slug: "semantic-laika",
      name: "Laika Mascotas",
      subject: { type: "brand" as const, id: "72000000-0000-4000-8000-000000000201" },
      timezone: "UTC",
      status: "active",
      corpora: []
    };
    const canonicalFilter = {
      contract_version: "signal-backend-v1" as const,
      timezone: "UTC",
      date_range: { start: "2026-06-01", end: "2026-06-30" },
      dimensions: {},
      granularity: "day" as const
    };
    for (const mentionId of [
      detail.canonical.mention_id,
      "72000000-0000-4000-8000-000000000608"
    ]) {
      const record = await workspaceServing.loadSignalWorkspaceCanonicalMentionByIdV1({
        workspace: resolvedWorkspace,
        filter: canonicalFilter,
        mentionId,
        isInternalUser: true
      });
      const operator = await operatorModel.loadSignalAdminMentionOperatorV1({ workspaceId, mentionId });
      assert.ok(record);
      assert.ok(operator);
      const response = workspaceServing.signalJsonResponse(
        new Request(`https://studio.test/admin-mentions?mention=${mentionId}`),
        { record, operator },
        { etagSeed: `admin-test:${record.subject_id}`, state: "fresh" }
      );
      assert.equal(response.status, 200);
      assert.doesNotMatch(await response.text(), /raw_metadata|text_raw|profile_url/u);
    }
    const firstPage = await workspaceServing.loadSignalWorkspaceCanonicalMentionsV1({
      workspace: resolvedWorkspace,
      filter: canonicalFilter,
      cursorScopeHash: parsedFilter.digest,
      limit: 100,
      isInternalUser: true
    });
    assert.equal(firstPage.records.length, 100);
    assert.ok(firstPage.page.next_cursor);
    const secondPage = await workspaceServing.loadSignalWorkspaceCanonicalMentionsV1({
      workspace: resolvedWorkspace,
      filter: canonicalFilter,
      cursorScopeHash: parsedFilter.digest,
      cursor: firstPage.page.next_cursor,
      limit: 100,
      isInternalUser: true
    });
    assert.ok(secondPage.records.length > 0);
    const firstIds = new Set(firstPage.records.map((record) => record.subject_id));
    assert.equal(secondPage.records.some((record) => firstIds.has(record.subject_id)), false);
    await assert.rejects(
      workspaceServing.loadSignalWorkspaceCanonicalMentionsV1({
        workspace: resolvedWorkspace,
        filter: canonicalFilter,
        cursorScopeHash: "sha256:operator-filter-changed",
        cursor: firstPage.page.next_cursor,
        limit: 100,
        isInternalUser: true
      }),
      (error: unknown) => error instanceof Error
        && error.message.includes("cursor does not match")
    );

    const crossWorkspace = await operatorModel.loadSignalAdminMentionOperatorV1({
      workspaceId,
      mentionId: "72000000-0000-4000-8000-000000000611"
    });
    assert.equal(crossWorkspace, null);
  } finally {
    await client.end();
  }
});
