/** Real PostgreSQL contract test, private MFP only. All DDL/data rolls back. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import {
  retireSignalCompetitorsV1,
  createOrReactivateSignalCompetitorsV1,
} from "../../apps/studio/src/lib/data-os/signal-competitor-lifecycle";
import { provisionSignalLabelingPolicyV1 } from "../../infrastructure/db/signal-labeling-policy-provisioning";
import {
  requestMentionFacetsV1,
  createSignalLabelingStoreV1,
  confirmMentionFacetsV1,
  loadMentionFacetsStatusV1,
} from "../../infrastructure/db/signal-labeling-runs";
import {
  inspectFacetContextChangeV1,
  registerFacetContextV1,
  overrideMentionFacetV1,
} from "../../infrastructure/db/signal-mention-facets";
import {
  runMentionFacetsTickV1,
  facetCallProposalV1,
} from "../../services/workers/src/workers/signal-mention-facets-batch";
import {
  facetLabelerIdentityLegacyV1,
  facetInputDigestV1,
} from "../../packages/query-engine/src/signal-mention-facets-v1";
import { entityContextDigestV1 } from "../../packages/query-engine/src/signal-entity-context-v1";
await main(async () => {
  const pool = await openDatabase(),
    client = await pool.connect();
  let assertions = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    assertions++;
  };
  try {
    const baseline = (
      await client.query(
        "SELECT (SELECT count(*) FROM mentions)::int mentions,(SELECT count(*) FROM signal_corpus_preparation_items)::int prepared",
      )
    ).rows[0];
    check(
      (
        await client.query(
          "SELECT to_regclass('signal_labeling_runs') IS NULL absent",
        )
      ).rows[0].absent,
    );
    await client.query("BEGIN");
    for (const file of [
      "0221_signal_labeling_core.sql",
      "0222_signal_entity_context_versions.sql",
      "0223_signal_mention_facets.sql",
      "0224_signal_optional_strict_caps.sql",
    ])
      await client.query(
        await readFile(`infrastructure/db/migrations/${file}`, "utf8"),
      );
    let serial = 0;
    const stack: string[] = [];
    // Store transactions become savepoints on this one real connection. No test DB clone.
    const query = async (text: any, values?: any) => {
      const sql = typeof text === "string" ? text : "";
      if (/^BEGIN\b/iu.test(sql)) {
        const name = `facet_check_${++serial}`;
        stack.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (/^COMMIT$/iu.test(sql)) {
        return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      }
      if (/^ROLLBACK$/iu.test(sql)) {
        const name = stack.pop()!;
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      return client.query(text, values);
    };
    const database = {
      query,
      async connect() {
        return { query, release() {} };
      },
    } as any;
    const identity = JSON.parse(
      await readFile(".data/dev-corpus/identity.json", "utf8"),
    );
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
    const context = (
      await inspectFacetContextChangeV1(client, identity.workspace_id)
    ).context;
    const labeler = facetLabelerIdentityLegacyV1();
    labeler.params = { ...labeler.params, simulation: "postgres-rollback" };
    const run = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-facets-initial",
      provider_available: true,
    });
    check(!run.replayed);
    const store = createSignalLabelingStoreV1({
      database,
      storeRaw: async (args) => `mock://${args.run_id}/${args.call_id}`,
    });
    let sends = 0;
    let technicalError = false;
    const batches = new Map<string, any[]>();
    const state = (id: string) => ({
      id,
      processing_status: "ended" as const,
      request_counts: {
        processing: 0,
        succeeded: batches.get(id)!.length,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
      ended_at: new Date().toISOString(),
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
        sends += requests.length;
        const id = `msgbatch_mock${sends}`;
        batches.set(
          id,
          requests.map((request) => {
            const inputs = JSON.parse(request.params.messages[0].content);
            const dim = (value: any) => ({
              value,
              confidence: "high",
              abstained: false,
            });
            const first = context.entities[0]!;
            return {
              custom_id: request.custom_id,
              result: {
                type: "succeeded",
                message: {
                  stop_reason: technicalError ? "pause_turn" : "end_turn",
                  usage: { input_tokens: 0, output_tokens: 0 },
                  content: [
                    { type: "thinking", thinking: "" },
                    {
                      type: "text",
                      text: JSON.stringify({
                        roots: inputs.map(
                          (input: any, root_ordinal: number) => ({
                            root_ordinal,
                            facets: {
                              entities: dim([
                                {
                                  entity_id: first.entity_id,
                                  kind: first.kind,
                                  salience: "main",
                                },
                              ]),
                              unrelated_reason: null,
                              voice: dim("individual"),
                              act: dim("opinion"),
                              spam_or_bot: dim(false),
                              language: dim(input.language ?? "es"),
                              asunto: dim(null),
                            },
                          }),
                        ),
                      }),
                    },
                  ],
                },
              },
            };
          }),
        );
        return state(id);
      },
      async get(id: string) {
        return state(id);
      },
      async cancel() {
        throw new Error("unused");
      },
      async *results(batch: any) {
        for (const item of batches.get(batch.id)!)
          yield { item, rawText: JSON.stringify(item) };
      },
    };
    const started = Date.now();
    for (let i = 0; i < 20; i++) {
      const result = await runMentionFacetsTickV1({
        run_id: run.run_id,
        store,
        provider,
      });
      if (result.status === "completed") break;
    }
    const initial = await loadMentionFacetsStatusV1(access);
    check(initial.pending === 0);
    check(initial.counts.reduce((n, c) => n + c.count, 0) > 800);
    const elapsed = Date.now() - started;
    check(elapsed < 120000);
    const previousSends = sends;
    const replay = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-facets-initial",
      provider_available: true,
    });
    check(replay.replayed);
    await runMentionFacetsTickV1({ run_id: run.run_id, store, provider });
    check(sends === previousSends);
    // Known billed technical failure is visible but never poisons semantic cache.
    const errorIdentity = {
      ...labeler,
      params: { ...labeler.params, variant: "technical-error-recovery" },
    };
    technicalError = true;
    const errored = await requestMentionFacetsV1({
      ...access,
      identity: errorIdentity,
      idempotency_key: "pg-technical-error",
      provider_available: true,
    });
    for (let i = 0; i < 20; i++) {
      if (
        (
          await runMentionFacetsTickV1({
            run_id: errored.run_id,
            store,
            provider,
          })
        ).status === "completed"
      )
        break;
    }
    const technical = await loadMentionFacetsStatusV1(access);
    check(technical.counts.every((row) => row.status === "error"));
    const afterError = sends;
    await runMentionFacetsTickV1({ run_id: errored.run_id, store, provider });
    check(sends === afterError);
    check(
      (
        await client.query(
          "SELECT count(*)::int count FROM signal_mention_facet_labels WHERE call_id IN(SELECT id FROM signal_labeling_calls WHERE run_id=$1)",
          [errored.run_id],
        )
      ).rows[0].count === 0,
    );
    technicalError = false;
    const recovered = await requestMentionFacetsV1({
      ...access,
      identity: errorIdentity,
      idempotency_key: "pg-technical-retry",
      provider_available: true,
    });
    for (let i = 0; i < 20; i++) {
      if (
        (
          await runMentionFacetsTickV1({
            run_id: recovered.run_id,
            store,
            provider,
          })
        ).status === "completed"
      )
        break;
    }
    check(
      (await loadMentionFacetsStatusV1(access)).counts.every(
        (row) => row.status === "labeled",
      ),
    );
    check(sends > afterError);
    const restoreLabeler = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-restore-labeler",
      provider_available: true,
    });
    await runMentionFacetsTickV1({
      run_id: restoreLabeler.run_id,
      store,
      provider,
    });
    // Canonical SQL/TS digest parity including Unicode and punctuation.
    const sample = (
      await client.query(
        `SELECT root_id,input_digest,asset_sha256,title,platform,content_type,author FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 LIMIT 1`,
        [identity.workspace_id],
      )
    ).rows[0];
    check(
      sample.input_digest ===
        facetInputDigestV1({
          text_sha256: sample.asset_sha256,
          title: sample.title,
          platform: sample.platform,
          content_type: sample.content_type,
          author: sample.author,
        }),
    );
    const primary = context.entities.find((e) => e.kind === "primary_brand")!;
    const competitor = context.entities.find((e) => e.kind === "competitor")!;
    const dim = (value: any) => ({
      value,
      confidence: "high",
      abstained: false,
    });
    await overrideMentionFacetV1({
      ...access,
      root_id: sample.root_id,
      dimension: "entities",
      value: dim([
        { entity_id: primary.entity_id, kind: primary.kind, salience: "main" },
      ]),
    });
    const overridden = (
      await client.query(
        "SELECT facets FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2",
        [identity.workspace_id, sample.root_id],
      )
    ).rows[0];
    check(overridden.facets.entities.value[0].entity_id === primary.entity_id);
    // Narrative change leaves CE and cache untouched.
    const before = entityContextDigestV1(context);
    await client.query(
      "UPDATE brand_os_profiles SET metadata=metadata||'{\"mfp_narrative_test\":\"changed narrative\"}'::jsonb WHERE brand_id=$1 AND status='active'",
      [identity.brand_id],
    );
    check(
      (await inspectFacetContextChangeV1(client, identity.workspace_id))
        .digest === before,
    );
    // Add an alias that occurs in the corpus. It is a temporary fixture and never leaves this rollback.
    const texts: string[] = (
      await client.query(
        "SELECT full_text FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 LIMIT 20",
        [identity.workspace_id],
      )
    ).rows.map((r: { full_text: string }) => r.full_text);
    const alias = texts
      .flatMap((t) => t.match(/[\p{L}]{7,}/gu) ?? [])
      .find((t) => !context.entities.some((e) => e.aliases.includes(t)))!;
    check(!!alias);
    const seed = (
      await client.query(
        "SELECT competitor_brand_seed_id FROM competitors WHERE id=$1",
        [competitor.entity_id],
      )
    ).rows[0].competitor_brand_seed_id;
    const oldAliases = (
      await client.query("SELECT aliases FROM brand_seeds WHERE id=$1", [seed])
    ).rows[0].aliases;
    await client.query(
      "UPDATE brand_seeds SET aliases=aliases||ARRAY[$2::text] WHERE id=$1",
      [seed, alias],
    );
    const change = await inspectFacetContextChangeV1(
      client,
      identity.workspace_id,
    );
    check(change.changed);
    check(change.affected.length > 0);
    check(change.diff.affected_mode === "targeted");
    const changed = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-facets-alias",
      provider_available: true,
    });
    const pending = (
      await client.query(
        "SELECT count(*)::int count FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND status='pending'",
        [identity.workspace_id],
      )
    ).rows[0].count;
    check(pending === change.affected.length);
    for (let i = 0; i < 20; i++) {
      if (
        (
          await runMentionFacetsTickV1({
            run_id: changed.run_id,
            store,
            provider,
          })
        ).status === "completed"
      )
        break;
    }
    // Full after targeted holds the same content digest but fences all older CE labels.
    const fullAfterTargeted = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-full-after-targeted",
      provider_available: true,
      full_recalculation: true,
    });
    const fullPending = (
      await client.query(
        "SELECT count(*)::int count FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND status='pending'",
        [identity.workspace_id],
      )
    ).rows[0].count;
    check(
      fullPending ===
        initial.counts.reduce((n, c) => n + c.count, 0) -
          change.affected.length,
    );
    for (let i = 0; i < 20; i++) {
      if (
        (
          await runMentionFacetsTickV1({
            run_id: fullAfterTargeted.run_id,
            store,
            provider,
          })
        ).status === "completed"
      )
        break;
    }
    check((await loadMentionFacetsStatusV1(access)).pending === 0);
    // Return A: version advances while old A cache is reused.
    await client.query("UPDATE brand_seeds SET aliases=$2 WHERE id=$1", [
      seed,
      oldAliases,
    ]);
    const returned = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-facets-return-a",
      provider_available: true,
    });
    const beforeReturn = sends;
    await runMentionFacetsTickV1({ run_id: returned.run_id, store, provider });
    check(sends === beforeReturn);
    check((await loadMentionFacetsStatusV1(access)).pending === 0);
    // Retirement is targeted while the reusable competitor seed remains active.
    await retireSignalCompetitorsV1(
      {
        brandId: identity.brand_id,
        actor: {
          id: identity.internal_user_id,
          userType: "noisia_internal",
          organizationId: null,
        },
        idempotencyKey: `pg-retire-${assertions}`,
        competitorIds: [competitor.entity_id],
        evidence: "MFP rollback lifecycle contract",
      },
      { database },
    );
    const retirement = await inspectFacetContextChangeV1(
      client,
      identity.workspace_id,
    );
    check(retirement.diff.affected_mode === "targeted");
    check(retirement.diff.labeled_entity_ids.includes(competitor.entity_id));
    const competitorSeed = (
      await client.query(
        "SELECT canonical_name,vertical,sub_vertical,country FROM brand_seeds WHERE id=$1",
        [seed],
      )
    ).rows[0];
    await createOrReactivateSignalCompetitorsV1(
      {
        brandId: identity.brand_id,
        actor: {
          id: identity.internal_user_id,
          userType: "noisia_internal",
          organizationId: null,
        },
        idempotencyKey: "pg-reactivate-competitor",
        names: [competitorSeed.canonical_name],
        vertical: competitorSeed.vertical,
        subVertical: competitorSeed.sub_vertical,
        country: competitorSeed.country,
      },
      { database },
    );
    // A strict maximum is optional, but a configured tiny maximum prevents any transport.
    const cappedIdentity = {
      ...labeler,
      params: { ...labeler.params, variant: "strict-cap" },
    };
    const capped = await requestMentionFacetsV1({
      ...access,
      identity: cappedIdentity,
      idempotency_key: "pg-strict-cap",
      provider_available: true,
      cap_micro_usd: 1,
    });
    await assert.rejects(
      runMentionFacetsTickV1({ run_id: capped.run_id, store, provider }),
      /labeling_cap_exhausted/u,
    );
    assertions++;
    check(
      (
        await client.query(
          "SELECT count(*)::int count FROM signal_labeling_calls WHERE run_id=$1",
          [capped.run_id],
        )
      ).rows[0].count === 0,
    );
    // A separate pending batch remains recoverable even when another call is uncertain.
    const mixedIdentity = {
      ...labeler,
      params: { ...labeler.params, variant: "unknown-plus-pending-batch" },
    };
    const mixed = await requestMentionFacetsV1({
      ...access,
      identity: mixedIdentity,
      idempotency_key: "pg-mixed-recovery",
      provider_available: true,
    });
    const mixedRun = (await store.claim(mixed.run_id))!;
    const mixedInputs = (await store.inputs(mixedRun)).slice(0, 2);
    const mixedCalls = await store.reserve(
      mixedRun,
      mixedInputs.map((input) => facetCallProposalV1(mixedRun, [input])),
    );
    await store.markSubmitting(mixedRun, mixedCalls);
    const knownBatch = await provider.create([
      { custom_id: mixedCalls[1]!.custom_id, params: mixedCalls[1]!.request },
    ]);
    await store.markSubmitted(mixedRun, [mixedCalls[1]!], knownBatch.id);
    await store.markFailed(mixedRun, [mixedCalls[0]!], true);
    await store.release(mixedRun);
    let mixedPolls = 0;
    const delayedProvider = {
      ...provider,
      async get(id: string) {
        mixedPolls++;
        return mixedPolls === 1
          ? { ...state(id), processing_status: "in_progress" as const }
          : state(id);
      },
    };
    check(
      (
        await runMentionFacetsTickV1({
          run_id: mixed.run_id,
          store,
          provider: delayedProvider,
        })
      ).status === "running",
    );
    check(
      (
        await client.query(
          "SELECT status FROM signal_labeling_runs WHERE id=$1",
          [mixed.run_id],
        )
      ).rows[0].status === "running",
    );
    check(
      (
        await runMentionFacetsTickV1({
          run_id: mixed.run_id,
          store,
          provider: delayedProvider,
        })
      ).status === "failed",
    );
    const mixedRows = (
      await client.query(
        "SELECT status,results_applied,settled_micro_usd FROM signal_labeling_calls WHERE run_id=$1 ORDER BY status",
        [mixed.run_id],
      )
    ).rows;
    check(
      mixedRows.length === 2 &&
        mixedRows.some(
          (row: {
            status: string;
            results_applied: boolean;
            settled_micro_usd: string | null;
          }) =>
            row.status === "settled" &&
            row.results_applied &&
            row.settled_micro_usd === "0",
        ) &&
        mixedRows.some((row: { status: string }) => row.status === "unknown"),
    );
    // A new key may process unaffected roots, never duplicate an uncertain submitted input.
    const unknownIdentity = {
      ...labeler,
      params: { ...labeler.params, variant: "unknown" },
    };
    const unknown = await requestMentionFacetsV1({
      ...access,
      identity: unknownIdentity,
      idempotency_key: "pg-unknown-first",
      provider_available: true,
    });
    const { AnthropicBatchTransportError } = await import(
      "../../services/workers/src/providers/anthropic-message-batches"
    );
    const uncertainProvider = {
      ...provider,
      async create() {
        throw new AnthropicBatchTransportError("unknown", "submission_unknown");
      },
    };
    await assert.rejects(
      runMentionFacetsTickV1({
        run_id: unknown.run_id,
        store,
        provider: uncertainProvider,
      }),
    );
    assertions++;
    await runMentionFacetsTickV1({ run_id: unknown.run_id, store, provider });
    const successor = await requestMentionFacetsV1({
      ...access,
      identity: unknownIdentity,
      idempotency_key: "pg-unknown-successor",
      provider_available: true,
    });
    for (let i = 0; i < 20; i++) {
      if (
        (
          await runMentionFacetsTickV1({
            run_id: successor.run_id,
            store,
            provider,
          })
        ).status === "failed"
      )
        break;
    }
    const duplicates = (
      await client.query(
        `SELECT count(*)::int count FROM signal_labeling_calls a CROSS JOIN LATERAL jsonb_array_elements(a.inputs) ar
      JOIN signal_labeling_calls b ON b.run_id=$2 CROSS JOIN LATERAL jsonb_array_elements(b.inputs) br
      WHERE a.run_id=$1 AND ar->>'root_id'=br->>'root_id'`,
        [unknown.run_id, successor.run_id],
      )
    ).rows[0].count;
    check(duplicates === 0);
    // Short alias requires explicit confirmation of the same queued run.
    await client.query(
      "UPDATE brand_seeds SET aliases=aliases||ARRAY['zz'] WHERE id=$1",
      [seed],
    );
    const full = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-facets-short",
      provider_available: true,
    });
    check(full.waiting_full_confirmation);
    // A waiting, unsent scope can be superseded safely when CE changes again.
    await client.query(
      "UPDATE brand_seeds SET aliases=aliases||ARRAY['temporary scope change'] WHERE id=$1",
      [seed],
    );
    const replacement = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key: "pg-stale-waiting-replacement",
      provider_available: true,
    });
    check(replacement.waiting_full_confirmation);
    check(
      (
        await client.query(
          "SELECT status FROM signal_labeling_runs WHERE id=$1",
          [full.run_id],
        )
      ).rows[0].status === "canceled",
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int count FROM signal_labeling_calls WHERE run_id=$1",
          [full.run_id],
        )
      ).rows[0].count === 0,
    );
    const fullContext = await inspectFacetContextChangeV1(
      client,
      identity.workspace_id,
    );
    await confirmMentionFacetsV1({
      ...access,
      run_id: replacement.run_id,
      entity_context_digest: fullContext.digest,
    });
    check(
      !(
        await client.query(
          "SELECT waiting_full_confirmation FROM signal_labeling_runs WHERE id=$1",
          [replacement.run_id],
        )
      ).rows[0].waiting_full_confirmation,
    );
    for (let i = 0; i < 20; i++) {
      if (
        (
          await runMentionFacetsTickV1({
            run_id: replacement.run_id,
            store,
            provider,
          })
        ).status === "completed"
      )
        break;
    }
    check((await loadMentionFacetsStatusV1(access)).pending === 0);
    // A human correction survives retirement, but cannot serve an absent entity as valid.
    await overrideMentionFacetV1({
      ...access,
      root_id: sample.root_id,
      dimension: "entities",
      value: dim([
        {
          entity_id: competitor.entity_id,
          kind: competitor.kind,
          salience: "main",
        },
      ]),
    });
    // Lifecycle is an entity deletion even when its reusable seed stays active.
    await retireSignalCompetitorsV1(
      {
        brandId: identity.brand_id,
        actor: {
          id: identity.internal_user_id,
          userType: "noisia_internal",
          organizationId: null,
        },
        idempotencyKey: `pg-retire-${assertions}`,
        competitorIds: [competitor.entity_id],
        evidence: "MFP rollback lifecycle contract",
      },
      { database },
    );
    const retired = await inspectFacetContextChangeV1(
      client,
      identity.workspace_id,
    );
    check(
      !retired.context.entities.some(
        (e) => e.entity_id === competitor.entity_id,
      ),
    );
    await registerFacetContextV1(client, identity.workspace_id);
    const needsReview = (
      await client.query(
        "SELECT status,facets,requires_context_review,error_code FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2",
        [identity.workspace_id, sample.root_id],
      )
    ).rows[0];
    check(
      needsReview.status === "error" &&
        needsReview.requires_context_review &&
        needsReview.facets === null &&
        needsReview.error_code === "override_entity_context_changed",
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int count FROM signal_mention_facet_overrides WHERE workspace_id=$1 AND root_id=$2 AND dimension='entities' AND superseded_at IS NULL",
          [identity.workspace_id, sample.root_id],
        )
      ).rows[0].count === 1,
    );
    await overrideMentionFacetV1({
      ...access,
      root_id: sample.root_id,
      dimension: "entities",
      value: dim([
        { entity_id: primary.entity_id, kind: primary.kind, salience: "main" },
      ]),
    });
    const reviewed = (
      await client.query(
        "SELECT requires_context_review FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2",
        [identity.workspace_id, sample.root_id],
      )
    ).rows[0];
    check(!reviewed.requires_context_review);
    check(
      (
        await client.query(
          "SELECT count(*)::int count FROM signal_mention_facet_overrides WHERE workspace_id=$1 AND root_id=$2 AND dimension='entities' AND superseded_at IS NOT NULL",
          [identity.workspace_id, sample.root_id],
        )
      ).rows[0].count >= 2,
    );
    await client.query("ROLLBACK");
    const after = (
      await client.query(
        "SELECT (SELECT count(*) FROM mentions)::int mentions,(SELECT count(*) FROM signal_corpus_preparation_items)::int prepared,to_regclass('signal_labeling_runs') IS NULL rolled_back",
      )
    ).rows[0];
    check(after.rolled_back);
    check(
      after.mentions === baseline.mentions &&
        after.prepared === baseline.prepared,
    );
    console.log(
      JSON.stringify({
        stage: "facets_pg_rollback",
        assertions,
        eligible: initial.counts.reduce((n, c) => n + c.count, 0),
        initial_calls: previousSends,
        alias_affected: change.affected.length,
        initial_write_elapsed_ms: elapsed,
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
        stage: "facets_pg_rollback_failed",
        assertions,
        sqlstate: diagnostic.code,
        position: diagnostic.position,
        frames: diagnostic.stack?.split("\n").slice(1, 5),
      }),
    );
    throw error;
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
