/** Opt-in acceptance phases on the private real fixture; never sends provider requests. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import { inspectFacetContextChangeV1 } from "../../infrastructure/db/signal-mention-facets";
import { requestMentionFacetsV1 } from "../../infrastructure/db/signal-labeling-runs";
import { facetLabelerIdentityV1 } from "../../packages/query-engine/src/signal-mention-facets-v1";
import {
  canonicalEntityContextV1,
  diffEntityContextV1,
  entityContextDigestV1,
  isEntityContextAffectedV1,
} from "../../packages/query-engine/src/signal-entity-context-v1";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1,
} from "../../apps/studio/src/lib/data-os/signal-product-operation";

const path = ".data/dev-corpus/facets-alias-acceptance.json";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
await main(async () => {
  const phase = process.argv
    .find((arg) => arg.startsWith("--phase="))
    ?.slice(8);
  if (
    !["prepare", "add", "check-b", "restore", "verify", "replay"].includes(
      phase ?? "",
    )
  )
    throw new Error("mfp_alias_phase_required");
  const identity = JSON.parse(
    await readFile(".data/dev-corpus/identity.json", "utf8"),
  );
  const database = await openDatabase();
  const access = {
    database,
    workspace_id: identity.workspace_id,
    actor_user_id: identity.internal_user_id,
  };
  const census = async () =>
    (
      await database.query(
        `SELECT count(*)::int calls,
    COALESCE(sum(settled_micro_usd),0)::text settled,
    count(*) FILTER(WHERE status IN('submitting','unknown'))::int uncertain
    FROM signal_labeling_calls WHERE workspace_id=$1`,
        [identity.workspace_id],
      )
    ).rows[0];
  const roots = async () =>
    (
      await database.query(
        `SELECT root_id,title,full_text,facets,status,entity_context_digest,
    effective_entities_digest FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 ORDER BY root_id`,
        [identity.workspace_id],
      )
    ).rows;
  const goldHashes = async () =>
    Object.fromEntries(
      await Promise.all(
        ["gold-selection.json", "governed-entity-context.json"].map(
          async (name) => [
            name,
            hash(await readFile(`.data/dev-corpus/${name}`)),
          ],
        ),
      ),
    );
  const noActive = async () =>
    assert.equal(
      (
        await database.query(
          "SELECT count(*)::int n FROM signal_labeling_runs WHERE workspace_id=$1 AND status IN('queued','running')",
          [identity.workspace_id],
        )
      ).rows[0].n,
      0,
    );
  const save = async (state: any) =>
    writeFile(path, JSON.stringify(state), { mode: 0o600 });
  try {
    if (phase === "prepare") {
      await noActive();
      const change = await inspectFacetContextChangeV1(
        database,
        identity.workspace_id,
      );
      assert.equal(change.changed, false);
      const population = await roots();
      assert.ok(
        population.length > 0 &&
          population.every((row: any) =>
            ["labeled", "abstained", "refused"].includes(row.status),
          ),
      );
      const primary = change.context.entities.find(
        (entity) => entity.kind === "primary_brand",
      )!;
      const candidates = [
        ...new Set<string>(
          population.flatMap(
            (row: any) =>
              `${row.title ?? ""} ${row.full_text}`.match(/[\p{L}]{7,}/gu) ??
              [],
          ),
        ),
      ];
      let chosen:
        | { alias: string; affected: string[]; digest: string }
        | undefined;
      for (const alias of candidates) {
        if (
          change.context.entities.some((entity) =>
            [entity.name, ...entity.aliases].some(
              (term) => term.toLocaleLowerCase() === alias.toLocaleLowerCase(),
            ),
          )
        )
          continue;
        const next = canonicalEntityContextV1({
          entities: change.context.entities.map((entity) =>
            entity.entity_id === primary.entity_id
              ? { ...entity, aliases: [...entity.aliases, alias] }
              : entity,
          ),
        });
        const diff = diffEntityContextV1(change.context, next);
        if (diff.affected_mode !== "targeted") continue;
        const affected = population
          .filter((row: any) =>
            isEntityContextAffectedV1(diff, {
              title: row.title,
              text: row.full_text,
              entity_ids:
                row.facets?.entities.value.map(
                  (entity: any) => entity.entity_id,
                ) ?? [],
            }),
          )
          .map((row: any) => row.root_id);
        if (affected.length > 0 && affected.length < population.length) {
          chosen = { alias, affected, digest: entityContextDigestV1(next) };
          break;
        }
      }
      assert.ok(chosen, "mfp_selective_alias_not_found");
      const aliases = (
        await database.query(
          "SELECT brand_seed_handles FROM brands WHERE id=$1",
          [identity.brand_id],
        )
      ).rows[0].brand_seed_handles;
      const baseRun = (
        await database.query(
          "SELECT id,idempotency_key FROM signal_labeling_runs WHERE workspace_id=$1 AND status='completed' AND entity_context_digest=$2 ORDER BY created_at DESC LIMIT 1",
          [identity.workspace_id, change.digest],
        )
      ).rows[0];
      assert.ok(baseRun);
      const baseLedger = await census();
      assert.equal(baseLedger.uncertain, 0);
      const state = {
        workspace_id: identity.workspace_id,
        brand_id: identity.brand_id,
        original_aliases: aliases,
        base_digest: change.digest,
        base_version: change.previous!.version_no,
        base_run: baseRun,
        alias: chosen.alias,
        changed_digest: chosen.digest,
        affected: chosen.affected,
        population: population.map((row: any) => ({
          root_id: row.root_id,
          digest: hash(JSON.stringify(row.facets)),
          ce: row.entity_context_digest,
        })),
        base_ledger: baseLedger,
        gold_hashes: await goldHashes(),
        gold_template_hash: hash(
          await readFile(".data/dev-corpus/gold-template.csv"),
        ),
      };
      await writeFile(path, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      console.log(
        JSON.stringify({
          phase,
          eligible: population.length,
          affected: chosen.affected.length,
          provider_calls: 0,
        }),
      );
      return;
    }
    const state = JSON.parse(await readFile(path, "utf8"));
    assert.equal(state.workspace_id, identity.workspace_id);
    assert.equal(state.brand_id, identity.brand_id);
    // Human annotations may arrive during the demo. They never block restoration.
    if (phase !== "restore")
      assert.deepEqual(await goldHashes(), state.gold_hashes);
    if (phase === "replay") {
      const before = await census();
      const replay = await requestMentionFacetsV1({
        ...access,
        identity: facetLabelerIdentityV1(),
        idempotency_key: state.base_run.idempotency_key,
        provider_available: false,
      });
      assert.ok(replay.replayed && replay.run_id === state.base_run.id);
      assert.deepEqual(await census(), before);
      console.log(
        JSON.stringify({ phase, provider_calls: 0, ledger_unchanged: true }),
      );
      return;
    }
    await noActive();
    if (phase === "add" || phase === "restore") {
      const adding = phase === "add";
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
          [identity.workspace_id],
        );
        const row = (
          await client.query(
            `SELECT w.id,w.organization_id,w.slug,w.timezone,w.status,b.name,b.brand_seed_handles,
          u.user_type,u.organization_id actor_organization_id FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id
          JOIN users u ON u.id=$2 WHERE w.id=$1 AND b.id=$3 FOR UPDATE OF b`,
            [
              identity.workspace_id,
              identity.internal_user_id,
              identity.brand_id,
            ],
          )
        ).rows[0];
        assert.ok(row && row.user_type === "noisia_internal");
        const expected = adding
          ? state.original_aliases
          : [...(state.original_aliases ?? []), state.alias];
        const next = adding
          ? [...(state.original_aliases ?? []), state.alias]
          : state.original_aliases;
        const operation = await beginSignalProductOperationV1<{
          changed: boolean;
        }>({
          queryable: client,
          workspace: {
            contractVersion: "signal-backend-v1",
            id: row.id,
            organizationId: row.organization_id,
            slug: row.slug,
            name: row.name,
            subject: { type: "brand", id: identity.brand_id },
            timezone: row.timezone,
            status: row.status,
            corpora: [],
          },
          actor: {
            id: identity.internal_user_id,
            userType: row.user_type,
            organizationId: row.actor_organization_id,
          },
          action: "update-brand-context",
          idempotencyKey: `mfp-alias-${state.base_run.id}-${phase}`,
          input: {
            fixture_acceptance: true,
            previous_aliases_digest: hash(JSON.stringify(expected)),
            next_aliases_digest: hash(JSON.stringify(next)),
          },
        });
        if (!operation.replay) {
          assert.deepEqual(row.brand_seed_handles, expected);
          const changed = await client.query(
            "UPDATE brands SET brand_seed_handles=$2,updated_at=clock_timestamp() WHERE id=$1 AND brand_seed_handles IS NOT DISTINCT FROM $3::text[] RETURNING id",
            [identity.brand_id, next, expected],
          );
          assert.equal(changed.rowCount, 1);
          await completeSignalProductOperationV1({
            queryable: client,
            workspaceId: row.id,
            key: operation.key,
            result: { changed: true },
          });
        }
        const change = await inspectFacetContextChangeV1(
          client,
          identity.workspace_id,
        );
        assert.equal(
          change.digest,
          adding ? state.changed_digest : state.base_digest,
        );
        assert.equal(change.diff.affected_mode, "targeted");
        if (operation.replay) assert.deepEqual(row.brand_seed_handles, next);
        else if (adding)
          assert.deepEqual(
            [...change.affected].sort(),
            [...state.affected].sort(),
          );
        else {
          state.return_affected = change.affected;
          state.before_return_ledger = await census();
          await save(state);
        }
        await client.query("COMMIT");
        console.log(
          JSON.stringify({
            phase,
            affected: change.affected.length,
            provider_calls: 0,
            next_run_key: `mfp-alias-${state.base_run.id}-${adding ? "b" : "return-a"}`,
          }),
        );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return;
    }
    const change = await inspectFacetContextChangeV1(
      database,
      identity.workspace_id,
    );
    assert.equal(change.changed, false);
    const population = await roots();
    assert.equal(population.length, state.population.length);
    assert.ok(
      population.every((row: any) =>
        ["labeled", "abstained", "refused"].includes(row.status),
      ),
    );
    if (phase === "check-b") {
      assert.equal(change.digest, state.changed_digest);
      const baseline = new Map<string, any>(
        state.population.map((row: any) => [row.root_id, row]),
      );
      for (const row of population)
        if (!state.affected.includes(row.root_id)) {
          assert.equal(row.entity_context_digest, baseline.get(row.root_id).ce);
          assert.equal(
            hash(JSON.stringify(row.facets)),
            baseline.get(row.root_id).digest,
          );
        }
      const actual = (
        await database.query(
          `SELECT DISTINCT input->>'root_id' root_id FROM signal_labeling_calls call
        JOIN signal_labeling_runs run ON run.id=call.run_id CROSS JOIN LATERAL jsonb_array_elements(call.inputs) input
        WHERE call.workspace_id=$1 AND run.entity_context_digest=$2`,
          [identity.workspace_id, state.changed_digest],
        )
      ).rows
        .map((row: any) => row.root_id)
        .sort();
      assert.deepEqual(actual, [...state.affected].sort());
      console.log(
        JSON.stringify({
          phase,
          affected: actual.length,
          unaffected_preserved: population.length - actual.length,
          ledger: await census(),
        }),
      );
    } else {
      assert.equal(change.digest, state.base_digest);
      assert.ok(change.previous!.version_no >= state.base_version + 2);
      assert.deepEqual(await census(), state.before_return_ledger);
      for (const row of population)
        if (state.return_affected.includes(row.root_id))
          assert.equal(row.entity_context_digest, state.base_digest);
      console.log(
        JSON.stringify({
          phase,
          eligible: population.length,
          returned_affected: state.return_affected.length,
          restored_base_context: true,
          gold_selection_and_context_unchanged: true,
          gold_template_changed:
            hash(await readFile(".data/dev-corpus/gold-template.csv")) !==
            state.gold_template_hash,
          new_calls: 0,
          ledger_unchanged: true,
        }),
      );
    }
  } finally {
    await database.end();
  }
});
