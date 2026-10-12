/** Opt-in private PostgreSQL test. All DDL/data rollback; provider is simulated. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import {
  overrideMentionFacetV1,
  loadMentionFacetBrowserV1,
} from "../../infrastructure/db/signal-mention-facets";
import { provisionSignalLabelingPolicyV1 } from "../../infrastructure/db/signal-labeling-policy-provisioning";
await main(async () => {
  const pool = await openDatabase(),
    client = await pool.connect();
  let assertions = 0,
    sends = 0;
  const started = Date.now();
  let phase = "setup",
    phaseStarted = started;
  const enter = (next: string) => {
    console.log(
      JSON.stringify({
        event: "phase",
        phase,
        elapsed_ms: Date.now() - phaseStarted,
        next,
      }),
    );
    phase = next;
    phaseStarted = Date.now();
  };
  const sqlCode = (error: unknown) => {
    const code = (error as { code?: unknown })?.code;
    return typeof code === "string" && /^[A-Z0-9]{5}$/u.test(code)
      ? code
      : null;
  };
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
    await client.query("SET LOCAL statement_timeout='60s'");
    enter("migrations");
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
    let serial = 0,
      planSerial = 0;
    const planDirectory = ".data/dev-corpus/membership-query-plans";
    const stack: Array<{ name: string; readOnly: boolean }> = [];
    const query = async (sql: any, values?: any) => {
      if (typeof sql === "string" && /^BEGIN\b/iu.test(sql)) {
        const savepoint = {
          name: `membership_${++serial}`,
          readOnly: /\bREAD ONLY\b/iu.test(sql.split(";")[0] ?? ""),
        };
        stack.push(savepoint);
        const result = await client.query(`SAVEPOINT ${savepoint.name}`);
        // Keep transaction-local settings used by the real serving wrapper.
        // Only the BEGIN itself is replaced by a fixture savepoint.
        const separator = sql.indexOf(";");
        const settings = separator >= 0 ? sql.slice(separator + 1).trim() : "";
        if (settings) await client.query(settings);
        return result;
      }
      if (sql === "COMMIT") {
        const savepoint = stack.pop()!;
        // A real read-only transaction ends its SET LOCAL settings at COMMIT.
        // Restore them here so later fixture calls cannot inherit planner knobs.
        if (savepoint.readOnly)
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint.name}`);
        return client.query(`RELEASE SAVEPOINT ${savepoint.name}`);
      }
      if (sql === "ROLLBACK") {
        const s = stack.pop()!.name;
        await client.query(`ROLLBACK TO SAVEPOINT ${s}`);
        return client.query(`RELEASE SAVEPOINT ${s}`);
      }
      const began = Date.now();
      try {
        if (
          typeof sql === "string" &&
          (sql.includes("/* membership-status-items */") ||
            sql.includes("/* membership-override-targets */") ||
            sql.includes("/* membership-preview-items */") ||
            sql.includes("mfp_memberships AS MATERIALIZED"))
        ) {
          const plan = await client.query(
            `EXPLAIN (FORMAT JSON) ${sql}`,
            values,
          );
          await mkdir(planDirectory, { recursive: true, mode: 0o700 });
          const file = `${planDirectory}/${started}-${++planSerial}.json`;
          await writeFile(
            file,
            JSON.stringify({ phase, plan: plan.rows }, null, 2),
            { flag: "wx", mode: 0o600 },
          );
          console.log(
            JSON.stringify({
              event: "private_plan_saved",
              phase,
              plan_number: planSerial,
            }),
          );
        }
        const result = await client.query(sql, values);
        const elapsed_ms = Date.now() - began;
        if (elapsed_ms >= 1000)
          console.log(
            JSON.stringify({ event: "slow_query", phase, elapsed_ms }),
          );
        return result;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "query_failed",
            phase,
            elapsed_ms: Date.now() - began,
            sql_code: sqlCode(error),
          }),
        );
        throw error;
      }
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
    enter("policy");
    await provisionSignalLabelingPolicyV1({
      ...access,
      initiator_user_id: access.actor_user_id,
      creator_user_id: access.actor_user_id,
      upgrade_existing: true,
      daily_cap_micro_usd: null,
      cap_micro_usd: null,
    });
    enter("catalog");
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
    enter("facet_fixture");
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
      async list(afterId?: string) {
        const ids = [...batches.keys()];
        const start = afterId ? ids.indexOf(afterId) + 1 : 0;
        const page = ids.slice(start).map(state);
        return { data: page, has_more: false, last_id: page.at(-1)?.id ?? null };
      },
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
    enter("initial_request");
    const initial = await requestConceptMembershipsV1({
      ...access,
      idempotency_key: "mfp-membership-check-first",
      provider_available: true,
    });
    check(initial.cap_micro_usd === null, "strict cap remains absent");
    enter("initial_batch");
    await finish(initial.run_id);
    enter("initial_status");
    let status = await loadConceptMembershipsStatusV1(access);
    check(
      status.counts.every((r: any) => r.verdict !== "pending"),
      "all compatible pairs have a state",
    );
    enter("concept_scoped_counts");
    const perConcept = (
      await client.query(
        `SELECT m.concept_key,count(*)::int total FROM signal_concept_memberships_current_v1 m
      WHERE m.workspace_id=$1 AND EXISTS(SELECT 1 FROM signal_membership_evidence_rights_v1 r WHERE r.workspace_id=m.workspace_id AND r.root_id=m.root_id AND r.metrics)
      GROUP BY m.concept_key ORDER BY m.concept_key`,
        [access.workspace_id],
      )
    ).rows;
    check(
      perConcept.length >= 2 && perConcept.every((r: any) => r.total > 0),
      "two nonempty concepts required for scoped counts",
    );
    for (const expected of perConcept.slice(0, 2)) {
      const scoped = await loadConceptMembershipsStatusV1({
        ...access,
        concept_key: expected.concept_key,
      });
      check(
        scoped.counts.reduce((total, row) => total + row.count, 0) ===
          expected.total,
        "concept counts exclude other concepts",
      );
      check(
        scoped.items.every((row) => row.concept_key === expected.concept_key),
        "counts and items share concept scope",
      );
    }
    const pairs = (
      await client.query(
        "SELECT * FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2",
        [access.workspace_id, root.root_id],
      )
    ).rows;
    check(pairs.length >= 2, "secondary competitor is evaluated");
    enter("replay_and_reuse");
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
    enter("selection");
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
    enter("signal_overview");
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
    enter("signal_evidence");
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
    enter("human_override");
    await overrideConceptMembershipsV1({
      ...access,
      overrides: [
        {
          root_id: root.root_id,
          concept_key: target.concept_key,
          verdict: "not_belongs",
          decided_via: "agent_assisted",
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
    enter("lazy_context_invalidation");
    await client.query("SAVEPOINT lazy_context");
    const readCensus = async () =>
      (
        await client.query(
          `SELECT
      (SELECT count(*)::int FROM signal_entity_context_versions WHERE workspace_id=$1) versions,
      (SELECT count(*)::int FROM signal_labeling_runs WHERE workspace_id=$1) runs,
      (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1) calls,
      (SELECT count(*)::int FROM signal_concept_memberships WHERE workspace_id=$1) memberships`,
          [access.workspace_id],
        )
      ).rows[0];
    const beforeLazyRead = await readCensus();
    // A real Brand OS edit, intentionally without registerFacetContextV1 or a new run.
    // This short alias requests the normal full affected-set path.
    await client.query(
      "UPDATE brands SET brand_seed_handles=COALESCE(brand_seed_handles,ARRAY[]::text[])||ARRAY['x'] WHERE id=$1",
      [identity.brand_id],
    );
    const staleHuman = await loadConceptMembershipsStatusV1({
      ...access,
      concept_key: target.concept_key,
      limit: 100,
    });
    check(
      staleHuman.stale_count > 0,
      "GET detects a live Brand OS alias change before CE registration",
    );
    const facetPopulation = await loadMentionFacetBrowserV1({
      ...access,
      limit: 1,
    });
    for (const relevance of [
      "relevant",
      "unrelated",
      "unknown",
      "spam",
    ] as const) {
      const expected =
        facetPopulation.distributions.find(
          (row) => row.dimension === "relevance" && row.value === relevance,
        )?.count ?? 0;
      check(
        staleHuman.population[relevance] === expected,
        "membership population matches live lazy facet relevance",
      );
    }
    check(
      staleHuman.population.without_concept === staleHuman.population.relevant,
      "without-concept counts only currently relevant roots and no stale model belongs",
    );
    const preserved = staleHuman.items.find(
      (row) => row.root_id === root.root_id,
    );
    check(
      preserved?.source === "human" &&
        preserved.verdict === "not_belongs" &&
        preserved.requires_context_review === false,
      "valid human membership survives lazy CE invalidation",
    );
    const otherConcept = concepts.find(
      (c) => c.concept_key !== target.concept_key,
    )!;
    const staleModel = await loadConceptMembershipsStatusV1({
      ...access,
      concept_key: otherConcept.concept_key,
      verdict: "pending",
      limit: 100,
    });
    check(
      staleModel.items.length > 0 &&
        staleModel.items.every(
          (row) =>
            row.verdict === "pending" &&
            row.source === "pending" &&
            Array.isArray(row.citations) &&
            row.citations.length === 0 &&
            row.rationale === null &&
            row.call_id === null,
        ),
      "affected model memberships are pending with no old evidence before a new run",
    );
    check(
      staleModel.counts.every((row) => row.verdict === "pending"),
      "counts use the same lazy pending projection",
    );
    const staleBelongs = await loadConceptMembershipsStatusV1({
      ...access,
      concept_key: otherConcept.concept_key,
      verdict: "belongs",
    });
    check(
      staleBelongs.items.length === 0,
      "verdict filter cannot recover stale belongs",
    );
    check(
      JSON.stringify(await readCensus()) === JSON.stringify(beforeLazyRead),
      "lazy status GET never registers CE or creates processing writes",
    );
    const { retireSignalCompetitorsV1 } = await import(
      "../../apps/studio/src/lib/data-os/signal-competitor-lifecycle"
    );
    const competitorEntity = entities.find(
      (entity: any) => entity.kind === "competitor",
    );
    check(
      competitorEntity,
      "competitor fixture required for human CE revalidation",
    );
    await retireSignalCompetitorsV1(
      {
        brandId: identity.brand_id,
        actor: {
          id: access.actor_user_id,
          userType: "noisia_internal",
          organizationId: null,
        },
        idempotencyKey: "mfp-membership-lazy-retire",
        competitorIds: [competitorEntity!.entity_id],
        evidence: "Membership lazy context rollback regression",
      },
      { database },
    );
    const staleRetired = await loadConceptMembershipsStatusV1({
      ...access,
      concept_key: target.concept_key,
      limit: 100,
    });
    check(
      staleRetired.population.relevant < staleHuman.population.relevant &&
        staleRetired.population.unknown > staleHuman.population.unknown,
      "retired effective entity moves human root from relevant to unknown aggregates",
    );
    check(
      staleRetired.population.without_concept ===
        staleRetired.population.relevant,
      "retired review root no longer inflates without-concept aggregate",
    );
    const invalidHuman = staleRetired.items.find(
      (row) => row.root_id === root.root_id,
    );
    check(
      invalidHuman?.verdict === "pending" &&
        invalidHuman.requires_context_review === true &&
        Array.isArray(invalidHuman.citations) &&
        invalidHuman.citations.length === 0,
      "human membership cannot display against a retired effective entity",
    );
    await client.query("ROLLBACK TO SAVEPOINT lazy_context");
    await client.query("RELEASE SAVEPOINT lazy_context");
    const term = (
      await client.query(
        "SELECT topic FROM signal_membership_concepts_v1 WHERE workspace_id=$1 AND concept_key=$2",
        [access.workspace_id, target.concept_key],
      )
    ).rows[0].topic;
    enter("definition_edit");
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
      .flatMap((r: { inputs: unknown[] }) => r.inputs)
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
    enter("preview");
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
    enter("entity_correction");
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
    enter("ce_fence");
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
    enter("license_revocation");
    await client.query("SAVEPOINT deny_metrics");
    const {
      ensureSignalLicensingPolicyDraftV1,
      activateSignalDataGovernanceObjectV1,
    } = await import(
      "../../apps/studio/src/lib/data-os/signal-data-governance"
    );
    const actor = {
      id: access.actor_user_id,
      userType: "noisia_internal" as const,
      organizationId: null,
    };
    const fixtureHash = (seed: string) =>
      `sha256:${createHash("sha256").update(seed).digest("hex")}`;
    const licenses = (
      await client.query(
        `SELECT p.organization_id,p.policy_key,
      (SELECT max(version.policy_version)+1 FROM signal_licensing_policies version WHERE version.workspace_id=p.workspace_id AND version.policy_key=p.policy_key) next_version
      FROM signal_licensing_policies p WHERE p.workspace_id=$1 AND p.status='active'`,
        [access.workspace_id],
      )
    ).rows;
    check(
      licenses.length > 0,
      "active license required for revocation fixture",
    );
    for (const license of licenses) {
      // Activating the successor retires the bound predecessor through the real
      // governance function, with effective_to and its append-only audit event.
      const draft = await ensureSignalLicensingPolicyDraftV1({
        queryable: client,
        organizationId: license.organization_id,
        actor,
        definition: {
          workspace_id: access.workspace_id,
          policy_key: license.policy_key,
          policy_version: license.next_version,
          approval_evidence_hash: fixtureHash(
            "membership-rights-rollback-evidence",
          ),
          usages: [
            { usage_purpose: "client-derived-metrics", decision: "prohibited" },
          ],
        },
        idempotencyKey: fixtureHash(
          `membership-rights-draft:${license.policy_key}`,
        ),
      });
      await activateSignalDataGovernanceObjectV1({
        queryable: client,
        workspaceId: access.workspace_id,
        actor,
        objectKind: "licensing-policy",
        objectId: draft.policy_id,
        idempotencyKey: fixtureHash(
          `membership-rights-activate:${license.policy_key}`,
        ),
      });
    }
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
    enter("final_rollback");
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
        elapsed_ms: Date.now() - started,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "fixture_failed",
        phase,
        elapsed_ms: Date.now() - phaseStarted,
        total_elapsed_ms: Date.now() - started,
        sql_code: sqlCode(error),
      }),
    );
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});
