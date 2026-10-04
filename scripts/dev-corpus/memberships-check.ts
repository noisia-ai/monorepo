/** Opt-in private PostgreSQL test. All DDL/data rollback; provider is simulated. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import {
  createSignalTopicStoreV1,
  updateSignalTopicStoreV1,
} from "../../infrastructure/db/signal-topic-catalog";
import {
  requestConceptMembershipsV1,
  createConceptMembershipStoreV1,
  loadConceptMembershipsStatusV1,
  loadMembershipConceptsV1,
  overrideConceptMembershipsV1,
  selectConceptMembershipV1,
  loadConceptMembershipPreviewV1,
} from "../../infrastructure/db/signal-concept-memberships";
import {
  loadSignalWorkspaceTopicsOverviewV1,
  loadSignalWorkspaceTopicEvidenceV1,
} from "../../infrastructure/db/signal-workspace-topics-serving";
import { runConceptMembershipTickV1 } from "../../services/workers/src/workers/signal-concept-membership-batch";
import { overrideMentionFacetV1 } from "../../infrastructure/db/signal-mention-facets";
import { provisionSignalLabelingPolicyV1 } from "../../infrastructure/db/signal-labeling-policy-provisioning";
await main(async () => {
  const pool = await openDatabase(),
    client = await pool.connect();
  let assertions = 0,
    sends = 0;
  const check = (value: unknown, message: string) => {
    assert.ok(value, message);
    assertions++;
  };
  const identity = JSON.parse(
    await readFile(
      process.env.NOISIA_MFP_IDENTITY_FILE ?? ".data/dev-corpus/identity.json",
      "utf8",
    ),
  );
  const before = (
    await client.query("SELECT count(*)::int calls FROM signal_labeling_calls")
  ).rows[0].calls;
  try {
    await client.query("BEGIN");
    if (
      !(
        await client.query(
          "SELECT to_regclass('signal_concept_memberships') IS NOT NULL installed",
        )
      ).rows[0].installed
    )
      for (const file of [
        "0226_signal_concept_memberships.sql",
        "0227_signal_membership_selection.sql",
        "0228_signal_membership_evidence_rights.sql",
      ])
        await client.query(
          await readFile(`infrastructure/db/migrations/${file}`, "utf8"),
        );
    let serial = 0;
    const stack: string[] = [];
    const query = async (sql: any, values?: any) => {
      if (typeof sql === "string" && /^BEGIN\b/iu.test(sql)) {
        const savepoint = `membership_${++serial}`;
        stack.push(savepoint);
        return client.query(`SAVEPOINT ${savepoint}`);
      }
      if (sql === "COMMIT")
        return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === "ROLLBACK") {
        const s = stack.pop()!;
        await client.query(`ROLLBACK TO SAVEPOINT ${s}`);
        return client.query(`RELEASE SAVEPOINT ${s}`);
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
      initiator_user_id: access.actor_user_id,
      creator_user_id: access.actor_user_id,
      upgrade_existing: true,
      daily_cap_micro_usd: null,
      cap_micro_usd: null,
    });
    for (const [index, scope] of ["primary_brand", "competitor"].entries())
      await createSignalTopicStoreV1({
        pool: database,
        ...access,
        idempotency_key: `mfp-member-fixture-${index}`,
        input: {
          label: `MFP fixture ${scope}`,
          scope: scope as "primary_brand" | "competitor",
          definition: "A direct documented experience of the named entity.",
          inclusion: ["Documented experience"],
          exclusion: ["Hypothetical scenario"],
          positive_examples: ["I used the product."],
          negative_examples: ["I might use it."],
        },
      });
    const concepts = await loadMembershipConceptsV1(
      client,
      access.workspace_id,
    );
    check(concepts.length >= 2, "real working catalog contains both concepts");
    const root = (
      await client.query(
        "SELECT * FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND relevance='relevant' ORDER BY root_id LIMIT 1",
        [access.workspace_id],
      )
    ).rows[0];
    check(root, "real relevant root required");
    const ce = (
      await client.query(
        "SELECT context FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1",
        [access.workspace_id],
      )
    ).rows[0].context;
    const entities = ["primary_brand", "competitor"]
      .map((kind) => ce.entities.find((e: any) => e.kind === kind))
      .filter(Boolean)
      .map((e: any, i: number) => ({
        entity_id: e.entity_id,
        kind: e.kind,
        salience: i ? "secondary" : "main",
      }));
    await overrideMentionFacetV1({
      ...access,
      root_id: root.root_id,
      dimension: "entities",
      value: { value: entities, confidence: "high", abstained: false },
    });
    const batches = new Map<string, any[]>();
    const state = (id: string) => ({
      id,
      processing_status: "ended" as const,
      request_counts: {
        processing: 0,
        succeeded: 1,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
      ended_at: "now",
      results_url: null,
    });
    const provider = {
      async create(requests: any[]) {
        sends++;
        const id = `fake-${sends}`;
        batches.set(id, requests);
        return state(id);
      },
      async get(id: string) {
        return state(id);
      },
      async cancel(id: string) {
        return state(id);
      },
      async *results(batch: { id: string }) {
        for (const request of batches.get(batch.id) ?? []) {
          const inputs = JSON.parse(request.params.messages[0].content).roots;
          const roots = Object.fromEntries(
            inputs.map((r: any) => [
              `r${r.root_ordinal}`,
              {
                memberships: r.evaluated_concepts.map(
                  (concept_key: string) => ({
                    concept_key,
                    verdict: "belongs",
                    span_ids: [r.spans.find((s: any) => s.text.trim()).span_id],
                    rationale:
                      "Synthetic transport fixture, not semantic evidence.",
                  }),
                ),
              },
            ]),
          );
          const item = {
            custom_id: request.custom_id,
            result: {
              type: "succeeded" as const,
              message: {
                stop_reason: "end_turn",
                content: [
                  { type: "thinking", thinking: "" },
                  {
                    type: "text",
                    text: JSON.stringify({
                      contract_version: "concept-membership-judge-v1",
                      roots,
                    }),
                  },
                ],
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            },
          };
          yield { item, rawText: JSON.stringify(item) };
        }
      },
    };
    const store = createConceptMembershipStoreV1({
      database,
      storeRaw: async (a) => `mock://${a.run_id}/${a.call_id}`,
    });
    const finish = async (id: string) => {
      for (let page = 0; page < 1000; page++) {
        const r = await runConceptMembershipTickV1({
          run_id: id,
          store,
          provider,
        });
        if (r.status === "completed") return;
        if (r.status === "failed")
          throw new Error("mfp_membership_fixture_failed");
      }
      throw new Error("mfp_membership_fixture_no_progress");
    };
    const initial = await requestConceptMembershipsV1({
      ...access,
      idempotency_key: "mfp-membership-check-first",
      provider_available: true,
    });
    check(initial.cap_micro_usd === null, "strict cap remains absent");
    await finish(initial.run_id);
    let status = await loadConceptMembershipsStatusV1(access);
    check(
      status.counts.every((r: any) => r.verdict !== "pending"),
      "all compatible pairs have a state",
    );
    const pairs = (
      await client.query(
        "SELECT * FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2",
        [access.workspace_id, root.root_id],
      )
    ).rows;
    check(pairs.length >= 2, "secondary competitor is evaluated");
    const callsBefore = sends;
    const replay = await requestConceptMembershipsV1({
      ...access,
      idempotency_key: "mfp-membership-check-first",
      provider_available: false,
    });
    check(
      replay.replayed && replay.run_id === initial.run_id,
      "idempotent request needs no provider",
    );
    const reused = await requestConceptMembershipsV1({
      ...access,
      idempotency_key: "mfp-membership-check-reuse",
      provider_available: true,
    });
    await finish(reused.run_id);
    check(sends === callsBefore, "fresh run reuses every current pair");
    const target = concepts[0]!;
    const selection = await selectConceptMembershipV1({
      ...access,
      idempotency_key: "mfp-membership-check-select",
      selection: {
        concept_key: target.concept_key,
        selected: true,
        expected_selection_revision: 0,
      },
    });
    check(
      selection.generation_id === null,
      "new selection never requires a V2 generation",
    );
    process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED = "true";
    const overview = await loadSignalWorkspaceTopicsOverviewV1({
      ...access,
      imported_fallback: true,
    });
    check(
      overview?.terms.some(
        (t) => t.term_key === target.concept_key && t.mention_count > 0,
      ),
      "Signal contains selected concept",
    );
    const evidence = await loadSignalWorkspaceTopicEvidenceV1({
      ...access,
      term_key: target.concept_key,
      expected_scope_digest: overview!.scope_digest,
    });
    check(evidence.items.length > 0, "Signal displays current evidence");
    check(
      evidence.items.every(
        (item) =>
          !item.quote ||
          item.text.slice(
            item.evidence_fragment!.start,
            item.evidence_fragment!.end,
          ) === item.quote,
      ),
      "Signal quotes match original root offsets",
    );
    await overrideConceptMembershipsV1({
      ...access,
      overrides: [
        {
          root_id: root.root_id,
          concept_key: target.concept_key,
          verdict: "not_belongs",
        },
      ],
    });
    const corrected = await loadSignalWorkspaceTopicsOverviewV1({
      ...access,
      imported_fallback: true,
    });
    check(
      corrected!.scope_digest !== overview!.scope_digest,
      "human correction invalidates evidence cursor",
    );
    const term = (
      await client.query(
        "SELECT topic FROM signal_membership_concepts_v1 WHERE workspace_id=$1 AND concept_key=$2",
        [access.workspace_id, target.concept_key],
      )
    ).rows[0].topic;
    await updateSignalTopicStoreV1({
      pool: database,
      ...access,
      term_key: target.concept_key,
      idempotency_key: "mfp-membership-check-edit",
      input: {
        definition: term.definition + " The experience must be first-hand.",
        expected_definition_revision: term.definition_revision,
        expected_definition_digest: term.definition_digest,
      },
    });
    const edited = await requestConceptMembershipsV1({
      ...access,
      idempotency_key: "mfp-membership-check-edited",
      provider_available: true,
    });
    await finish(edited.run_id);
    const evaluated = (
      await client.query(
        "SELECT inputs FROM signal_labeling_calls WHERE run_id=$1",
        [edited.run_id],
      )
    ).rows
      .flatMap((r: {inputs: unknown[]}) => r.inputs)
      .flatMap((r: any) => r.evaluated_concepts);
    check(
      evaluated.length > 0 &&
        evaluated.every((c: any) => c.concept_key === target.concept_key),
      "definition change recalculates only that concept",
    );
    check(
      (
        await client.query(
          "SELECT verdict,source FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2 AND concept_key=$3",
          [access.workspace_id, root.root_id, target.concept_key],
        )
      ).rows[0].source === "human",
      "human correction survives model recalculation",
    );
    const membershipsBefore = (
      await client.query(
        "SELECT count(*)::int n FROM signal_concept_memberships",
      )
    ).rows[0].n;
    const preview = await requestConceptMembershipsV1({
      ...access,
      idempotency_key: "mfp-membership-check-preview",
      provider_available: true,
      concept: target,
    });
    await finish(preview.run_id);
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM signal_concept_memberships",
        )
      ).rows[0].n === membershipsBefore,
      "preview does not populate current membership",
    );
    const previewRead = await loadConceptMembershipPreviewV1({
      ...access,
      run_id: preview.run_id,
    });
    check(previewRead.items.length <= 30, "preview is bounded by roots");
    const beforeEntities = (
      await client.query(
        "SELECT count(*)::int n FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id<>$2 AND verdict='belongs'",
        [access.workspace_id, root.root_id],
      )
    ).rows[0].n;
    await overrideMentionFacetV1({
      ...access,
      root_id: root.root_id,
      dimension: "entities",
      value: {
        value: entities.filter((e: any) => e.kind === "primary_brand"),
        confidence: "high",
        abstained: false,
      },
    });
    const afterEntities = (
      await client.query(
        "SELECT m.concept_key,m.verdict,c.scope FROM signal_concept_memberships_current_v1 m JOIN signal_membership_concepts_v1 c USING(workspace_id,concept_key) WHERE m.workspace_id=$1 AND m.root_id=$2",
        [access.workspace_id, root.root_id],
      )
    ).rows;
    check(
      afterEntities.every((r: any) => r.scope !== "competitor"),
      "human entity correction removes incompatible decisions",
    );
    check(
      afterEntities.some((r: any) => r.verdict === "pending"),
      "changed entities invalidate affected model pairs",
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id<>$2 AND verdict='belongs'",
          [access.workspace_id, root.root_id],
        )
      ).rows[0].n === beforeEntities,
      "entity correction preserves other roots",
    );
    await client.query("SAVEPOINT ce_fence");
    const version = (
      await client.query(
        "SELECT * FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1",
        [access.workspace_id],
      )
    ).rows[0];
    const other = (
      await client.query(
        "SELECT root_id FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND relevance='relevant' AND root_id<>$2 ORDER BY root_id LIMIT 1",
        [access.workspace_id, root.root_id],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO signal_entity_context_versions(workspace_id,version_no,digest,parent_digest,context,diff,affected_mode,affected_count) VALUES($1,$2,$3,$4,$5::jsonb,'{}'::jsonb,'targeted',1)",
      [
        access.workspace_id,
        version.version_no + 1,
        "sha256:" + "b".repeat(64),
        version.digest,
        JSON.stringify(version.context),
      ],
    );
    await client.query(
      "INSERT INTO signal_entity_context_affected_roots(workspace_id,version_no,root_id) VALUES($1,$2,$3)",
      [access.workspace_id, version.version_no + 1, other.root_id],
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2 AND source='model'",
          [access.workspace_id, other.root_id],
        )
      ).rows[0].n === 0,
      "affected CE version fences stale membership",
    );
    await client.query("ROLLBACK TO SAVEPOINT ce_fence");
    // Permissions are current data, independent of paid/model authority.
    await client.query("SAVEPOINT deny_metrics");
    await client.query(
      "UPDATE signal_licensing_policies SET status='retired' WHERE workspace_id=$1 AND status='active'",
      [access.workspace_id],
    );
    status = await loadConceptMembershipsStatusV1(access);
    check(
      status.items.length === 0 && status.counts.length === 0,
      "revoked metric rights hide decisions and counts",
    );
    check(
      (
        await loadConceptMembershipPreviewV1({
          ...access,
          run_id: preview.run_id,
        })
      ).items.length === 0,
      "preview respects revoked metric rights",
    );
    await client.query("ROLLBACK TO SAVEPOINT deny_metrics");
    await client.query("ROLLBACK");
    check(
      (
        await client.query(
          "SELECT count(*)::int calls FROM signal_labeling_calls",
        )
      ).rows[0].calls === before,
      "entire fixture rolled back",
    );
    console.log(
      JSON.stringify({
        status: "passed",
        assertions,
        simulated_batch_submissions: sends,
        provider_calls: 0,
        actual_micro_usd: 0,
        rolled_back: true,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});
