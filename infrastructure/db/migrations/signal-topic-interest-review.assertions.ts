import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import {
  SIGNAL_TOPIC_INTEREST_REVIEW_CONFIGURATION_V1,
  signalTopicDefinitionDigestV1,
  signalTopicDefinitionSchemaV1,
  signalTopicEditorialDigestV1,
  type SignalTopicDefinitionV1,
} from "@noisia/query-engine";
import type { SyntheticTransactionV1 } from "./signal-client-workspace-entry.synthetic.fixture";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";

export const INTEREST_PREPARATION_ASSERTION_NAMES = Object.freeze([
  "0183 preacceptance: preparation table, functions and immutable trigger are installed",
  "0183 preacceptance: fixed provider configuration and canonical digests match TypeScript",
  "0183 preacceptance: ECMAScript trimming, line ordering and UTF-16 lengths match",
  "0183 preacceptance: definition normalization and meaning digests match TypeScript",
  "0183 preacceptance: definition capacity boundaries and invalid identities fail closed",
  "0183 preacceptance: private table RLS and public/client ACLs remain closed",
  "0183 preacceptance: absent source and unauthorized actors cannot prepare or load",
  "0183 preacceptance: no preparation, execution, admission, outbox or cost is created",
] as const);

const FUNCTIONS = [
  "signal_topic_interest_review_configuration_v1", "signal_topic_interest_review_trim_v1",
  "signal_topic_interest_review_utf16_length_v1", "signal_topic_interest_review_lines_v1",
  "signal_topic_interest_review_definition_v1", "signal_topic_interest_review_working_profile_v1",
  "signal_topic_interest_review_catalog_v1", "signal_topic_interest_review_plan_valid_v1",
  "signal_topic_interest_review_can_read_v1", "signal_topic_interest_review_preparation_guard_v1",
  "prepare_signal_topic_interest_review_v1", "load_signal_topic_interest_review_preparation_v1",
] as const;
const EMPTY_TABLES = [
  "signal_topic_interest_review_preparations", "signal_processing_policy_versions",
  "signal_processing_policy_actions", "signal_processing_admissions", "engine_cost_events",
  "signal_topic_consolidation_runs", "signal_topic_consolidation_executions", "signal_topic_consolidation_outbox",
  "signal_topic_editorial_executions", "signal_topic_editorial_requests", "signal_topic_editorial_calls",
  "signal_topic_editorial_outbox", "signal_topic_editorial_request_keys",
] as const;

function definition(overrides: Partial<SignalTopicDefinitionV1> = {}): SignalTopicDefinitionV1 {
  const body: SignalTopicDefinitionV1 = {
    term_key: "synthetic_bicycle_repairs", label: "Synthetic bicycle repairs",
    definition: "Invented bicycle repair experiences.", scope: "primary_brand",
    inclusion: ["Repair appointments"], exclusion: ["Unrelated names"],
    positive_examples: ["My invented bicycle was repaired"], negative_examples: ["An unrelated story"],
    lifecycle: "draft", origin: "manual", source: null, definition_revision: 1,
    definition_digest: signalTopicEditorialDigestV1("synthetic placeholder"),
    created_at: "2026-09-24T00:00:00.000Z", updated_at: "2026-09-24T00:00:00.000Z", ...overrides,
  };
  body.definition_digest = signalTopicDefinitionDigestV1(body);
  return body;
}

/** PREACCEPTANCE ONLY. The caller installs exact 0183 inside an approved empty
 * synthetic transaction and owns physical rollback plus post-rollback verification.
 * query must use the shared nested-transaction/savepoint harness. No connection,
 * environment, DDL, provider, SQL replacement or disabled trigger lives here.
 *
 * These cases do NOT certify successful preparation/load/replay, current-source
 * drift, catalog selection or full review/matrix capacity. Those require the
 * pending composed semantic-context + numeric-source fixture. There are no skips.
 */
export async function assertSignalTopicInterestReviewPreparationV1(
  t: Pick<TestContext, "test">, tx: SyntheticTransactionV1,
) {
  const { query } = tx;
  const scalar = async (sql: string, params: unknown[] = []): Promise<unknown> =>
    (await query(sql, params)).rows[0]?.value;
  const normalized = (body: unknown) => scalar(
    "SELECT signal_topic_interest_review_definition_v1($1::jsonb) value", [JSON.stringify(body)],
  );
  const counts = async () => {
    const result: Record<string, number> = {};
    // Identifiers come exclusively from the fixed local allowlist above.
    for (const table of EMPTY_TABLES) result[table] = Number(await scalar(`SELECT count(*)::int value FROM ${table}`));
    return result;
  };
  const baseline = await counts();
  assert.ok(Object.values(baseline).every(value => value === 0), "preacceptance requires an empty synthetic target");
  const rejected = async (sql: string, params: unknown[], code: string, message: string) => {
    await query("BEGIN");
    try { await assert.rejects(query(sql, params), { code, message }, "the real SQL guard must reject without changing state"); }
    finally { await query("ROLLBACK"); }
  };

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[0], async () => {
    const installed = (await query(`
      SELECT p.proname name,p.prosecdef security_definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname COLLATE "C"`, [FUNCTIONS])).rows as Array<{ name: string; security_definer: boolean }>;
    assert.deepEqual(installed.map(row => row.name), [...FUNCTIONS].sort(), "all twelve actual SQL functions must be installed once");
    assert.ok(installed.every(row => !row.security_definer), "no new function elevates the caller");
    const trigger = (await query(`SELECT t.tgenabled,p.proname,t.tgtype::int type FROM pg_trigger t
      JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.signal_topic_interest_review_preparations'::regclass
      AND t.tgname='topic_interest_review_preparation_guard' AND NOT t.tgisinternal`)).rows;
    assert.deepEqual(trigger, [{ tgenabled: "O", proname: "signal_topic_interest_review_preparation_guard_v1", type: 31 }],
      "the guard runs BEFORE every INSERT/UPDATE/DELETE row");
  });

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[1], async () => {
    assert.deepEqual(await scalar("SELECT signal_topic_interest_review_configuration_v1() value"),
      SIGNAL_TOPIC_INTEREST_REVIEW_CONFIGURATION_V1, "SQL binds the same fixed model, prompt, schema and prices");
    for (const body of [null, "Synthetic \"quoted\" text\n🚲", { z: 1, a: [true, null, "é", "e\u0301"] },
      { "\uE000": "private-use", "🚲": "astral", "a": "ASCII" }]) {
      assert.equal(await scalar("SELECT signal_topic_editorial_digest_json_v1($1::jsonb) value", [JSON.stringify(body)]),
        signalTopicEditorialDigestV1(body), "SQL canonical JSON and JavaScript hashing must agree, including Unicode key order");
    }
  });

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[2], async () => {
    const whitespace = "\t\n\v\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";
    for (const text of ["", `${whitespace}Synthetic 🚲${whitespace}`, "e\u0301🚲", "\u200Bkept\u0085"]) {
      const row = (await query("SELECT signal_topic_interest_review_trim_v1($1) trimmed,signal_topic_interest_review_utf16_length_v1($1)::text units", [text])).rows[0];
      assert.equal(row?.trimmed, text.trim(), "SQL trimming follows ECMAScript, not generic Unicode whitespace");
      assert.equal(row?.units, String(text.length), "astral symbols consume two UTF-16 code units");
    }
    const lines = [" z ", "a", "z", "\uFEFFb\u00A0", "", " ", "a", "Z"];
    for (const deduplicate of [false, true]) {
      const trimmed = lines.map(line => line.trim());
      assert.deepEqual(await scalar("SELECT signal_topic_interest_review_lines_v1($1::jsonb,$2) value", [JSON.stringify(lines), deduplicate]),
        deduplicate ? [...new Set(trimmed.filter(Boolean))] : trimmed, "deduplication preserves first occurrence and case without sorting");
    }
  });

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[3], async () => {
    const fixtures: SignalTopicDefinitionV1[] = [
      definition({ label: "\uFEFF Synthetic 🚲 \u00A0", definition: "\u2003 Invented repairs. \n",
        inclusion: [" z ", "a", "z"], exclusion: [" noisy ", "noisy"], discovery_guidance: false, definition_revision: 7 }),
      ...(["primary_brand", "competitor", "category", "all_conversations"] as const).map(scope => definition({ scope })),
      ...(["manual", "historical_taxonomy", "corpus_discovery", "evidence_candidate", "discovered", "workspace_discovery"] as const)
        .flatMap(origin => [undefined, false, true].map(discovery_guidance => definition({ origin, discovery_guidance }))),
      definition({ lifecycle: "archived", source: { run_key: "invented-run", candidate_key: "invented-candidate", candidate_digest: null } }),
    ];
    for (const body of fixtures) {
      // JSON roundtrip also matches actual wire omission of optional undefined fields.
      const expected = signalTopicDefinitionSchemaV1.parse(JSON.parse(JSON.stringify(body)));
      assert.deepEqual(await normalized(body), expected, "SQL returns exactly the same normalized, digest-verified definition");
    }
    const optional: Record<string, unknown> = { ...definition({ inclusion: [], exclusion: [], positive_examples: [], negative_examples: [] }) };
    for (const key of ["source", "inclusion", "exclusion", "positive_examples", "negative_examples"]) delete optional[key];
    assert.deepEqual(await normalized(optional), signalTopicDefinitionSchemaV1.parse(optional), "default arrays and null source preserve historical definition meaning");
  });

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[4], async () => {
    const boundary = definition({ label: "🚲".repeat(80), definition: "🚲".repeat(750),
      inclusion: Array.from({ length: 16 }, () => "🚲".repeat(120)),
      source: { run_key: "🚲".repeat(100), candidate_key: "c".repeat(200), candidate_digest: null } });
    assert.deepEqual(await normalized(boundary), signalTopicDefinitionSchemaV1.parse(boundary), "exact UTF-16 and array limits remain valid");
    const oversized = [definition({ label: `${boundary.label}a` }), definition({ definition: `${boundary.definition}a` }),
      definition({ inclusion: ["🚲".repeat(120) + "a"] }), definition({ exclusion: Array.from({ length: 17 }, () => "same") }),
      definition({ source: { run_key: "🚲".repeat(100) + "a", candidate_key: "candidate", candidate_digest: null } })];
    for (const body of oversized) {
      assert.equal(signalTopicDefinitionSchemaV1.safeParse(body).success, false, "oversized fixture exceeds the real TS contract");
      assert.equal(await normalized(body), null, "SQL rejects capacity overflow before returning a definition");
    }
    const valid = definition();
    for (const body of [{ ...valid, definition: "Changed meaning without new digest" }, { ...valid, term_key: "invalid-key" },
      { ...valid, unexpected: true }, { ...valid, definition_revision: 0 }, { ...valid, scope: "unknown" },
      { ...valid, inclusion: [null] }, { ...valid, source: { run_key: "x", candidate_key: "y", extra: true } }]) {
      assert.equal(await normalized(body), null, "malformed identity, meaning or structure must fail closed");
    }
  });

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[5], async () => {
    assert.equal(await scalar("SELECT relrowsecurity value FROM pg_class WHERE oid='public.signal_topic_interest_review_preparations'::regclass"), true,
      "private evidence storage has row-level security enabled");
    assert.equal(await scalar("SELECT count(*)::int value FROM pg_policy WHERE polrelid='public.signal_topic_interest_review_preparations'::regclass"), 0,
      "no public/client row policy exposes snapshots");
    assert.equal(await scalar(`SELECT count(*)::int value FROM pg_class c,
      LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.signal_topic_interest_review_preparations'::regclass AND a.grantee=0`), 0, "PUBLIC has no table grant");
    assert.equal(await scalar(`SELECT count(*)::int value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE n.nspname='public' AND p.proname=ANY($1::text[]) AND a.grantee=0`, [FUNCTIONS]), 0, "PUBLIC has no function execution grant");
    for (const role of (await query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname")).rows as Array<{ rolname: string }>) {
      assert.equal(await scalar("SELECT has_table_privilege($1,'public.signal_topic_interest_review_preparations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') value", [role.rolname]),
        false, "client roles cannot access the table through direct or inherited grants");
      assert.equal(await scalar(`SELECT bool_or(has_function_privilege($1,p.oid,'EXECUTE')) value FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($2::text[])`, [role.rolname, FUNCTIONS]),
        false, "client roles cannot call the private functions through direct or inherited grants");
    }
  });

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[6], async () => {
    // Identity-only fixture: real brand provisioning and grants; no corpus, ready
    // source, fake SQL functions, paid permission or provider result is created.
    const identity = await createProcessingPolicyIdentitiesV1(tx), workspace = identity.first.workspace_id;
    const missing = randomUUID(), prepare = "SELECT prepare_signal_topic_interest_review_v1($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5)";
    const load = "SELECT load_signal_topic_interest_review_preparation_v1($1::uuid,$2::uuid,$3::uuid)";
    assert.equal(await scalar("SELECT signal_topic_editorial_source_v1($1::uuid) value", [missing]), null, "absent numeric source cannot become current");
    assert.equal(await scalar("SELECT signal_topic_interest_review_working_profile_v1($1::uuid) value", [workspace]), null, "empty workspace has no invented catalog");
    assert.equal(await scalar("SELECT signal_topic_interest_review_catalog_v1($1::uuid,$2::uuid) value", [workspace, missing]), null, "absent working catalog is unavailable");
    assert.equal(await scalar("SELECT signal_topic_interest_review_plan_valid_v1($1::uuid,$2::uuid,$3::jsonb) value", [workspace, missing, "{}"]), false,
      "absent plan/source is not a valid review; this does not certify full matrix validation");
    for (const actor of [missing, identity.actors.noGrant, identity.actors.suspended, identity.actors.foreignAdmin, identity.actors.secondAdmin]) {
      assert.equal(await scalar("SELECT signal_topic_interest_review_can_read_v1($1::uuid,$2::uuid) value", [workspace, actor]), false,
        "missing, revoked-scope, suspended and cross-workspace actors cannot read");
      await rejected(prepare, [workspace, actor, missing, "{}", randomUUID()], "42501", "topic_interest_review_forbidden");
      await rejected(load, [workspace, actor, missing], "42501", "topic_interest_review_forbidden");
    }
    for (const actor of [identity.actors.internal, identity.actors.readGrant]) {
      assert.equal(await scalar("SELECT signal_topic_interest_review_can_read_v1($1::uuid,$2::uuid) value", [workspace, actor]), true,
        "current read authority is sufficient without a spending grant");
      await rejected(prepare, [workspace, actor, missing, "{}", randomUUID()], "23514", "topic_interest_review_source_stale");
      await rejected(load, [workspace, actor, missing], "P0002", "topic_interest_review_preparation_missing");
    }
    await rejected(prepare, [workspace, identity.actors.internal, missing, "{}", "bad"], "22023", "topic_interest_review_request_invalid");
  });

  await t.test(INTEREST_PREPARATION_ASSERTION_NAMES[7], async () => {
    assert.deepEqual(await counts(), baseline, "all preparation, paid-policy, numeric/editorial execution, queue and cost tables remain empty");
  });
}
