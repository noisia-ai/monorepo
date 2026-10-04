/** Focal PostgreSQL rollback on installed 0221–0225. No DDL and no provider transport. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import {
  createSignalLabelingStoreV1,
  requestMentionFacetsV1,
} from "../../infrastructure/db/signal-labeling-runs";
import { overrideMentionFacetV1 } from "../../infrastructure/db/signal-mention-facets";
import { provisionSignalLabelingPolicyV1 } from "../../infrastructure/db/signal-labeling-policy-provisioning";
import { facetLabelerIdentityV1 } from "../../packages/query-engine/src/signal-mention-facets-v1";
import { facetCallProposalV1 } from "../../services/workers/src/workers/signal-mention-facets-batch";
import type { FacetResult } from "../../packages/query-engine/src/signal-mention-labeler-v1";
const zeroUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation: {
    ephemeral_5m_input_tokens: 0,
    ephemeral_1h_input_tokens: 0,
  },
};
await main(async () => {
  const pool = await openDatabase(),
    client = await pool.connect();
  const identity = JSON.parse(
    await readFile(".data/dev-corpus/identity.json", "utf8"),
  );
  let assertions = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    assertions++;
  };
  const census = async () =>
    JSON.stringify(
      (
        await client.query(
          `SELECT
  (SELECT count(*) FROM signal_labeling_runs WHERE workspace_id=$1) runs,
  (SELECT count(*) FROM signal_labeling_calls WHERE workspace_id=$1) calls,
  (SELECT count(*) FROM signal_mention_facet_labels WHERE workspace_id=$1) labels,
  (SELECT count(*) FROM signal_mention_facet_overrides WHERE workspace_id=$1) overrides,
  (SELECT count(*) FROM signal_corpus_preparation_items WHERE workspace_id=$1) prepared`,
          [identity.workspace_id],
        )
      ).rows[0],
    );
  try {
    check(
      (
        await client.query(
          "SELECT to_regclass('signal_labeling_runs') IS NOT NULL installed",
        )
      ).rows[0].installed,
    );
    const before = await census();
    const oldView = (
      await client.query(
        "SELECT pg_get_viewdef('signal_mention_facets_current_v1'::regclass,true) definition",
      )
    ).rows[0].definition;
    await client.query("BEGIN");
    let serial = 0;
    const stack: string[] = [];
    const query = async (sql: any, values?: any) => {
      if (typeof sql === "string" && /^BEGIN\b/iu.test(sql)) {
        const name = `postinstall_${++serial}`;
        stack.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (sql === "COMMIT")
        return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === "ROLLBACK") {
        const name = stack.pop()!;
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      return client.query(sql, values);
    };
    const database = {
      query,
      async connect() {
        return { query, release() {} };
      },
    } as any;
    const access = {
      database,
      workspace_id: identity.workspace_id,
      actor_user_id: identity.internal_user_id,
    };
    await provisionSignalLabelingPolicyV1({
      ...access,
      initiator_user_id: identity.internal_user_id,
      creator_user_id: identity.internal_user_id,
      upgrade_existing: true,
      daily_cap_micro_usd: null,
      cap_micro_usd: null,
    });
    const labeler = facetLabelerIdentityV1();
    labeler.params = { ...labeler.params, simulation: "postinstall-focal" };
    const requested = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "postinstall-label-a",
      provider_available: true,
    });
    const store = createSignalLabelingStoreV1({
      database,
      storeRaw: async (args) => `mock://${args.run_id}/${args.call_id}`,
    });
    const run = (await store.claim(requested.run_id))!;
    check(run.identity.params.request_format === "required-ordinal-fields-v2");
    const inputs = (await store.inputs(run)).slice(0, 3);
    const calls = await store.reserve(
      run,
      inputs.map((input) => facetCallProposalV1(run, [input])),
    );
    await store.markSubmitting(run, calls);
    await store.persistRawPage(
      run,
      calls.map((call) => ({
        call,
        raw: JSON.stringify({ simulation: true, custom_id: call.custom_id }),
      })),
    );
    await store.settlePage(
      run,
      calls.map((call) => ({ call, usage: zeroUsage, settled_micro_usd: 0 })),
    );
    const dim = <T>(value: T) => ({
      value,
      confidence: "high" as const,
      abstained: false,
    });
    await store.apply(
      run,
      calls.map((call) => ({
        call,
        results: call.inputs.map(
          (input) =>
            ({
              root_id: input.root_id,
              input_digest: input.input_digest,
              entity_context_digest: run.entity_context_digest,
              status: "labeled",
              facets: {
                entities: dim([]),
                unrelated_reason: "off_topic",
                voice: dim("individual"),
                act: dim("opinion"),
                spam_or_bot: dim(false),
                language: dim("en"),
                asunto: dim("synthetic provider fixture"),
              },
            }) as FacetResult,
        ),
      })),
    );
    const current = async (root: string) =>
      (
        await client.query(
          "SELECT status,facets,relevance,refusal_category,error_code,requires_context_review,effective_entities_digest FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2",
          [identity.workspace_id, root],
        )
      ).rows[0];
    const rootA = inputs[0]!.root_id,
      rootB = inputs[1]!.root_id,
      rootC = inputs[2]!.root_id;
    // Confirm an identical model value: the entire coherent human decision must
    // survive when the next labeler has no semantic result.
    await overrideMentionFacetV1({
      ...access,
      root_id: rootC,
      dimension: "unrelated_reason",
      value: "off_topic",
    });
    await overrideMentionFacetV1({
      ...access,
      root_id: rootA,
      dimension: "unrelated_reason",
      value: null,
    });
    let row = await current(rootA);
    check(
      row.facets.entities.abstained &&
        row.facets.unrelated_reason === null &&
        row.relevance === "unknown",
    );
    await overrideMentionFacetV1({
      ...access,
      root_id: rootA,
      dimension: "unrelated_reason",
      value: "off_topic",
    });
    row = await current(rootA);
    check(
      !row.facets.entities.abstained &&
        row.facets.entities.value.length === 0 &&
        row.facets.unrelated_reason === "off_topic" &&
        row.relevance === "unrelated",
    );
    await overrideMentionFacetV1({
      ...access,
      root_id: rootA,
      dimension: "unrelated_reason",
      value: null,
    });
    row = await current(rootA);
    check(
      row.facets.entities.abstained &&
        row.facets.unrelated_reason === null &&
        row.relevance === "unknown",
    );
    const primary = run.context.entities.find(
      (entity) => entity.kind === "primary_brand",
    )!;
    const entities = dim([
      {
        entity_id: primary.entity_id,
        kind: primary.kind,
        salience: "main" as const,
      },
    ]);
    await overrideMentionFacetV1({
      ...access,
      root_id: rootB,
      dimension: "entities",
      value: entities,
    });
    row = await current(rootB);
    check(row.facets.unrelated_reason === null && row.relevance === "relevant");
    await assert.rejects(
      overrideMentionFacetV1({
        ...access,
        root_id: rootB,
        dimension: "unrelated_reason",
        value: "off_topic",
      }),
      /facets_override_contradiction/u,
    );
    assertions++;
    check(
      (await current(rootB)).facets.entities.value[0].entity_id ===
        primary.entity_id,
    );
    await overrideMentionFacetV1({
      ...access,
      root_id: rootB,
      dimension: "entities",
      value: dim([]),
    });
    row = await current(rootB);
    check(row.facets.entities.abstained && row.relevance === "unknown");
    for (const root of [rootA, rootB])
      await overrideMentionFacetV1({
        ...access,
        root_id: root,
        dimension: "entities",
        value: entities,
      });
    const entityDigest = (await current(rootA)).effective_entities_digest;
    await store.fail(run, "fixture_next_labeler");
    await store.release(run);
    const nextIdentity = {
      ...labeler,
      params: {
        ...labeler.params,
        thinking: { type: "between_tools" },
        effort: "low",
      },
    };
    const next = await requestMentionFacetsV1({
      ...access,
      identity: nextIdentity,
      idempotency_key: "postinstall-label-b",
      provider_available: true,
    });
    for (const root of [rootA, rootB]) {
      row = await current(root);
      check(
        row.status === "pending" &&
          row.relevance === "relevant" &&
          row.facets.entities.value[0].entity_id === primary.entity_id,
      );
      check(
        row.facets.voice.abstained &&
          row.facets.act.abstained &&
          row.facets.spam_or_bot.abstained &&
          row.facets.language.abstained &&
          row.facets.language.value === null &&
          row.facets.asunto.abstained &&
          row.facets.asunto.value === null,
      );
      check(row.effective_entities_digest === entityDigest);
    }
    const humanUnrelated = await current(rootC);
    check(
      humanUnrelated.status === "pending" &&
        humanUnrelated.relevance === "unrelated" &&
        !humanUnrelated.facets.entities.abstained &&
        humanUnrelated.facets.entities.value.length === 0 &&
        humanUnrelated.facets.unrelated_reason === "off_topic",
    );
    const nextRun = (await store.claim(next.run_id))!;
    const nextCalls = await store.reserve(
      nextRun,
      inputs.map((input) => facetCallProposalV1(nextRun, [input])),
    );
    await store.markSubmitting(nextRun, nextCalls);
    await store.persistRawPage(
      nextRun,
      nextCalls.map((call) => ({
        call,
        raw: JSON.stringify({ simulation: true, custom_id: call.custom_id }),
      })),
    );
    await store.settlePage(
      nextRun,
      nextCalls.map((call) => ({
        call,
        usage: zeroUsage,
        settled_micro_usd: 0,
      })),
    );
    await store.apply(
      nextRun,
      nextCalls.map((call) => ({
        call,
        results: call.inputs.map(
          (input) =>
            ({
              root_id: input.root_id,
              input_digest: input.input_digest,
              entity_context_digest: nextRun.entity_context_digest,
              status: input.root_id !== rootB ? "error" : "refused",
              ...(input.root_id !== rootB
                ? { error_code: "synthetic_technical_error" }
                : { refusal_category: "synthetic_refusal" }),
            }) as FacetResult,
        ),
      })),
    );
    const errored = await current(rootA),
      refused = await current(rootB);
    check(
      errored.status === "error" &&
        errored.error_code === "synthetic_technical_error" &&
        errored.relevance === "relevant",
    );
    check(
      refused.status === "refused" &&
        refused.refusal_category === "synthetic_refusal" &&
        refused.relevance === "relevant",
    );
    check(errored.facets.voice.abstained && refused.facets.voice.abstained);
    const humanError = await current(rootC);
    check(
      humanError.status === "error" &&
        humanError.relevance === "unrelated" &&
        !humanError.facets.entities.abstained &&
        humanError.facets.unrelated_reason === "off_topic" &&
        humanError.facets.voice.abstained,
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int count FROM signal_mention_facet_labels WHERE call_id=ANY($1::uuid[])",
          [nextCalls.map((call) => call.id)],
        )
      ).rows[0].count === 1,
    );
    await client.query("ROLLBACK");
    check((await census()) === before);
    check(
      (
        await client.query(
          "SELECT pg_get_viewdef('signal_mention_facets_current_v1'::regclass,true) definition",
        )
      ).rows[0].definition === oldView,
    );
    console.log(
      JSON.stringify({
        stage: "facets_postinstall_rollback",
        assertions,
        provider_real_calls: 0,
        rollback: true,
      }),
    );
  } catch (error) {
    const diagnostic = error as {
      code?: string;
      position?: string;
      stack?: string;
    };
    console.error(
      JSON.stringify({
        stage: "facets_postinstall_failed",
        assertions,
        sqlstate: diagnostic.code,
        position: diagnostic.position,
        frames: diagnostic.stack
          ?.split("\n")
          .filter((line) => line.trim().startsWith("at "))
          .slice(0, 4),
      }),
    );
    throw error;
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
