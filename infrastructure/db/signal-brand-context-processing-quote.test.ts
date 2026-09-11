import assert from "node:assert/strict";
import test from "node:test";
import { brandContextSnapshotFixtureV1 } from "./signal-brand-context.test-helpers";
import { loadSignalBrandContextProcessingQuoteV1, readSignalBrandContextProcessingQuoteWithQueryableV1 } from "./signal-brand-context-processing-quote";
import { SignalProcessingPolicyError } from "./signal-processing-policy";
import { SignalSemanticContextProposalExecutionError } from "./signal-semantic-context-proposal";

const workspace = "10000000-0000-4000-8000-000000000001";
const actor = "10000000-0000-4000-8000-000000000002";
const organization = "10000000-0000-4000-8000-000000000003";
const brand = "10000000-0000-4000-8000-000000000004";
const profile = "10000000-0000-4000-8000-000000000005";
const policyId = "10000000-0000-4000-8000-000000000006";
const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const authority = { workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client",
  primary_role: "client_admin", same_organization: true, brand_access_level: "admin", organization_status: "active", brand_same_organization: true };
const semantic = { action: "brand_context_proposal", kind: "provider", provider: "anthropic", model: "claude-sonnet-4-6",
  configuration_digest: hash("a"), max_execution_micro_usd: "500000", automatic_allowed: false };
const prototype = { action: "topic_prototype_embeddings", kind: "provider", provider: "voyage", model: "voyage-4-large",
  configuration_digest: hash("b"), max_execution_micro_usd: "20000", automatic_allowed: true };
const policy = { id: policyId, version: "9007199254740993", status: "active", policy_digest: hash("c"),
  valid_from: "2026-09-11T00:00:00Z", valid_until: "2026-09-12T23:00:00Z", budget_timezone: "America/Mexico_City",
  daily_cap_micro_usd: "1000000", budget_date: "2026-09-11", current: true,
  exposure: { confirmed_micro_usd: "100000", reserved_micro_usd: "100000", ambiguous_micro_usd: "100000", total_micro_usd: "300000" },
  actions: [semantic, prototype] };
const health = { brand_context_proposal: true, topic_prototype_embeddings: true };
type Options = { policy?: typeof policy | null; authority?: Partial<typeof authority>; countries?: string[];
  source?: "missing" | "stale"; brief?: Record<string, unknown>; knowledge?: string; error?: Error;
  quotedAt?: string; expiresAt?: string; budgetDate?: string };
function fixture(options: Options = {}) {
  const row = options.policy === undefined ? structuredClone(policy) : options.policy;
  const snapshot = brandContextSnapshotFixtureV1(organization, options.countries);
  const statements: string[] = [];
  const queryable = { async query(sql: string, values?: unknown[]) {
    statements.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(sql) || sql.startsWith("BEGIN ")) return { rows: [], rowCount: 0 };
    assert.match(sql.trim(), /^(SELECT|WITH)\b/u);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|admit_signal_processing_v1|pg_advisory|FOR SHARE)\b/u);
    let rows: unknown[];
    if (sql.includes("grant_access.access_level")) {
      assert.equal(values?.length, 2); assert.equal(String(values?.[0]).toLowerCase(), workspace);
      rows = [{ ...authority, ...options.authority }];
    } else if (sql.includes("signal_processing_org_exposure_v1")) {
      assert.match(sql, /policy.organization_id=w.organization_id/u);
      rows = row ? [row] : [];
    } else if (sql.includes("FROM signal_workspaces w JOIN brands b")) {
      assert.match(sql, /b.organization_id=w.organization_id/u);
      rows = [{ organization_id: organization, brand_id: brand, timezone: "America/Mexico_City" }];
    } else if (sql.includes("FROM brand_os_profiles profile")) {
      assert.deepEqual(values, [brand, organization]);
      if (options.error) throw options.error;
      rows = options.source === "missing" ? [] : [{ id: profile, version: 1, digest: options.source === "stale" ? hash("d") : snapshot.digest,
        countries: snapshot.snapshot.countries }];
    } else if (sql.includes("FROM brands brand WHERE")) rows = [snapshot.snapshot];
    else if (sql.includes("FROM signal_acquisition_plans")) rows = options.brief ? [{ brief: options.brief }] : [];
    else if (sql.includes("FROM brand_knowledge_sources source")) {
      assert.match(sql, /source.study_corpus_id IS NULL/u);
      assert.deepEqual(values, [organization, brand]);
      rows = [{ id: brand, source_kind: "note", file_hash: null, content_digest: options.knowledge ?? hash("e"), updated_at: "2026-09-11" }];
    } else if (sql.includes("FROM knowledge_chunks chunk")) {
      assert.match(sql, /source.study_corpus_id IS NULL/u); rows = [];
    } else if (sql.includes("WITH quote_clock")) {
      assert.deepEqual(values, [row?.budget_timezone ?? null, row?.valid_until ?? null]);
      assert.match(sql, /LEAST\(instant\+interval '5 minutes',\$2::timestamptz/u);
      assert.match(sql, /\(\(\(instant AT TIME ZONE \$1\)::date\+1\)::timestamp AT TIME ZONE \$1\)/u);
      rows = [{ quoted_at: options.quotedAt ?? "2026-09-11T18:00:00Z", budget_date: row ? options.budgetDate ?? row.budget_date : null,
        expires_at: row ? options.expiresAt ?? "2026-09-11T18:05:00Z" : null }];
    } else throw new Error(`Unexpected query: ${sql.slice(0, 70)}`);
    return { rows, rowCount: rows.length };
  } } as Parameters<typeof readSignalBrandContextProcessingQuoteWithQueryableV1>[0]["queryable"];
  return { queryable, statements };
}
const read = (options: Options = {}, action_availability = health) => readSignalBrandContextProcessingQuoteWithQueryableV1({
  ...fixture(options), workspace_id: workspace, actor_user_id: actor, action_availability });

test("workspace quote derives both exact policy ceilings, source and exposure while keeping joint admission closed", async () => {
  const f = fixture();
  const value = await readSignalBrandContextProcessingQuoteWithQueryableV1({ ...f, workspace_id: workspace,
    actor_user_id: actor, action_availability: health });
  assert.equal(value.contract_version, "brand-context-processing-quote-v1");
  assert.equal(value.quote_status, "quoted"); assert.equal(value.can_request_processing, true);
  assert.equal(value.can_start, false); assert.equal(value.blocked_reason, "joint_admission_required");
  assert.equal(value.maximum_total_micro_usd, "520000"); assert.equal(value.remaining_micro_usd, "700000");
  assert.deepEqual(value.exposure, policy.exposure); assert.equal(value.policy?.version, "9007199254740993");
  assert.equal(value.quote_expires_at, "2026-09-11T18:05:00.000Z"); assert.match(value.quote_digest!, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(value.actions.map(a => [a.action, a.provider, a.model, a.configuration_digest]), [
    [semantic.action, semantic.provider, semantic.model, semantic.configuration_digest],
    [prototype.action, prototype.provider, prototype.model, prototype.configuration_digest] ]);
  assert.equal(value.source?.primary_locale, "es-MX"); assert.equal(value.actions.length, 2);
  assert.doesNotMatch(JSON.stringify(value), /admission_not_after|confirmation|target_id|api_key|configuration"/u);
  assert.ok(f.statements.every(sql => /^\s*(SELECT|WITH)\b/u.test(sql)));
});

test("digest binds actor, policy version/configuration/caps, source and balance; extra runtime amounts cannot override policy", async () => {
  const original = await read();
  for (const option of [ { policy: { ...policy, version: "2" } }, { policy: { ...policy, policy_digest: hash("f") } },
    { policy: { ...policy, actions: [{ ...semantic, configuration_digest: hash("f") }, prototype] } },
    { policy: { ...policy, actions: [{ ...semantic, max_execution_micro_usd: "499999" }, prototype] } },
    { knowledge: hash("f") }, { countries: ["JP"] },
    { policy: { ...policy, exposure: { ...policy.exposure, reserved_micro_usd: "100001", total_micro_usd: "300001" } } } ]) {
    const changed = await read(option); assert.equal(changed.quote_status, "quoted"); assert.notEqual(changed.quote_digest, original.quote_digest);
  }
  const args = { ...fixture(), workspace_id: workspace, actor_user_id: brand, action_availability: health,
    runtime: { semantic: { platform_hard_cap_micro_usd: 1n } }, execution_cap_micro_usd: "1", organization_id: brand };
  const otherActor = await readSignalBrandContextProcessingQuoteWithQueryableV1(args);
  assert.notEqual(otherActor.quote_digest, original.quote_digest); assert.equal(otherActor.maximum_total_micro_usd, "520000");
  assert.doesNotThrow(() => JSON.stringify(otherActor));
});

test("one provider or unrelated enabled action cannot quote the two-stage workflow", async () => {
  for (const action_availability of [undefined, {}, { brand_context_proposal: true }, { topic_prototype_embeddings: true },
    { topic_interpretation: true, corpus_embeddings: true }]) {
    const value = await readSignalBrandContextProcessingQuoteWithQueryableV1({ ...fixture(), workspace_id: workspace,
      actor_user_id: actor, action_availability });
    assert.equal(value.quote_status, "action_unavailable"); assert.equal(value.quote_digest, null); assert.equal(value.can_start, false);
  }
});

test("missing action and incompatible model/config digest fail closed without substituting another action", async () => {
  for (const entry of [ { actions: [semantic], status: "action_missing" },
    { actions: [{ ...semantic, action: "topic_interpretation" }, prototype], status: "action_missing" },
    { actions: [semantic, { ...prototype, model: "voyage-4" }], status: "action_incompatible" },
    { actions: [semantic, { ...prototype, automatic_allowed: false }], status: "action_incompatible" },
    { actions: [{ ...semantic, configuration_digest: "unsealed" }, prototype], status: "action_incompatible" },
    { actions: [{ ...semantic, max_execution_micro_usd: "0" }, prototype], status: "action_incompatible" } ]) {
    const value = await read({ policy: { ...policy, actions: entry.actions } });
    assert.equal(value.quote_status, entry.status); assert.equal(value.quote_digest, null); assert.equal(value.can_start, false);
  }
});

test("daily balance must cover both full ceilings; neither ceiling is silently reduced", async () => {
  for (const daily_cap_micro_usd of ["800000", "300000"]) {
    const value = await read({ policy: { ...policy, daily_cap_micro_usd } });
    assert.equal(value.quote_status, "daily_cap_insufficient"); assert.equal(value.maximum_total_micro_usd, "520000");
    assert.equal(value.actions[0]?.max_execution_micro_usd, "500000"); assert.equal(value.quote_digest, null);
  }
});

test("zero Voyage cap requires actual plan coverage; a policy ceiling alone cannot claim cache recovery", async () => {
  const value = await read({ policy: { ...policy, actions: [semantic, { ...prototype, max_execution_micro_usd: "0" }] } });
  assert.equal(value.quote_status, "cache_coverage_required"); assert.equal(value.quote_digest, null); assert.equal(value.can_start, false);
});

test("missing, revoked and expired policy preserve read state with no admissible quote", async () => {
  for (const [candidate, status] of [[null, "policy_missing"], [{ ...policy, status: "revoked", current: false }, "policy_revoked"],
    [{ ...policy, current: false }, "policy_expired"], [{ ...policy, valid_until: "2026-09-11T18:00:00Z" }, "policy_expired"]] as const) {
    const value = await read({ policy: candidate });
    assert.equal(value.quote_status, status); assert.equal(value.quote_digest, null); assert.equal(value.can_start, false);
  }
});

test("read-only roles and revoked processing authority cannot become processing permission", async () => {
  for (const overrides of [ { primary_role: "client_viewer", brand_access_level: "read" }, { brand_access_level: "comment" },
    { primary_role: "brand_manager" }, { organization_status: "suspended" },
    { user_type: "noisia_internal", primary_role: "analyst" } ]) {
    const value = await read({ authority: overrides });
    assert.equal(value.can_request_processing, false); assert.equal(value.quote_status, "processing_forbidden");
    assert.equal(value.quote_digest, null); assert.equal(value.can_start, false);
  }
});

test("foreign tenant, revoked grant and inactive actor stop before policy/source reads", async () => {
  for (const overrides of [{ same_organization: false }, { brand_access_level: "none" }, { actor_status: "suspended" }]) {
    const f = fixture({ authority: overrides });
    await assert.rejects(readSignalBrandContextProcessingQuoteWithQueryableV1({ ...f, workspace_id: workspace, actor_user_id: actor }),
      (error: unknown) => error instanceof SignalProcessingPolicyError && error.code === "processing_forbidden" && error.status === 403);
    assert.equal(f.statements.length, 1);
  }
});

test("missing or stale Brand OS is a typed read state; unrelated failures propagate", async () => {
  for (const source of ["missing", "stale"] as const) {
    const value = await read({ source }); assert.equal(value.quote_status, source === "missing" ? "source_required" : "source_stale");
    assert.equal(value.source, null); assert.equal(value.quote_digest, null);
  }
  const failure = new Error("connection lost"); await assert.rejects(read({ error: failure }), error => error === failure);
});

test("quote locales are derived from current Brand OS without forcing MX", async () => {
  for (const [country, locale] of [["JP", "ja-JP"], ["BR", "pt-BR"]]) {
    const value = await read({ countries: [country!] }); assert.equal(value.source?.primary_locale, locale);
    assert.deepEqual(value.source?.markets, [country]); assert.equal(value.quote_status, "quoted");
  }
  const empty = await read({ countries: [] });
  assert.equal(empty.quote_status, "locale_required"); assert.equal(empty.quote_digest, null);
});

test("malformed stored countries block the quote with typed locale state instead of RangeError", async () => {
  for (const country of ["1X", "12", "M-", "419", "éX"]) {
    const value = await read({ countries: [country] });
    assert.equal(value.quote_status, "locale_required"); assert.equal(value.quote_digest, null);
    assert.equal(value.can_start, false); assert.equal(value.source, null);
  }
  const plan = await read({ brief: { countries: ["1X"], languages: ["es-MX"], primary_locale: "es-MX", timezone: "UTC" } });
  assert.equal(plan.quote_status, "locale_required"); assert.equal(plan.quote_digest, null);
  const unrelated = new SignalSemanticContextProposalExecutionError("brand_workspace_required", 422);
  await assert.rejects(read({ error: unrelated }), error => error === unrelated);
});

test("database clock controls expiry; budget rollover cannot reuse previous-day exposure", async () => {
  const nearMidnight = await read({ quotedAt: "2026-09-12T05:59:59Z", expiresAt: "2026-09-12T06:00:00Z" });
  assert.equal(nearMidnight.quote_expires_at, "2026-09-12T06:00:00.000Z");
  const rollover = await read({ budgetDate: "2026-09-12", quotedAt: "2026-09-12T06:00:00Z" });
  assert.equal(rollover.quote_status, "budget_date_changed"); assert.equal(rollover.quote_digest, null);
});

test("public loader owns one read-only snapshot and always releases; no admissions or run writes", async () => {
  for (const fail of [false, true]) {
    const f = fixture(fail ? { authority: { same_organization: false } } : {});
    const expected = fail ? null : await readSignalBrandContextProcessingQuoteWithQueryableV1({
      ...fixture(), workspace_id: workspace, actor_user_id: actor, action_availability: health
    });
    const query = async (sql: string, values?: unknown[]) => {
      if (sql.includes("signal_brand_context_processing_quote_v1")) {
        assert.deepEqual(values, [workspace, actor]);
        return { rows: [{ quote_digest: hash("f"), observed_at: "2026-09-11T18:00:00Z",
          quote_expires_at: "2026-09-11T18:05:00Z", budget_date: expected!.budget_date,
          remaining_micro_usd: expected!.remaining_micro_usd,
          ...expected!.exposure, policy_id: expected!.policy!.id, policy_version: expected!.policy!.version,
          policy_digest: expected!.policy!.digest,
          semantic_configuration_digest: expected!.actions[0]!.configuration_digest,
          prototype_configuration_digest: expected!.actions[1]!.configuration_digest,
          semantic_cap_micro_usd: expected!.actions[0]!.max_execution_micro_usd,
          prototype_cap_micro_usd: expected!.actions[1]!.max_execution_micro_usd,
          source_authority_digest: expected!.source!.authority_digest }], rowCount: 1 };
      }
      return f.queryable.query(sql, values);
    };
    const database = { async connect() { return { query,
      release() { f.statements.push("release"); } }; } } as unknown as Parameters<typeof loadSignalBrandContextProcessingQuoteV1>[0]["database"];
    const promise = loadSignalBrandContextProcessingQuoteV1({ database, workspace_id: workspace, actor_user_id: actor, action_availability: health });
    if (fail) await assert.rejects(promise); else assert.equal((await promise).can_start, false);
    assert.equal(f.statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.deepEqual(f.statements.slice(-2), [fail ? "ROLLBACK" : "COMMIT", "release"]);
  }
});
