import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";

import { WorkspaceTopicConsolidationCard,
  validWorkspaceTopicConsolidationView, type WorkspaceTopicConsolidationView } from "../../components/brands/WorkspaceTopicConsolidationCard";
import { WorkspaceTopicConsolidationActivationCard } from "../../components/brands/WorkspaceTopicConsolidationActivationCard";
import { parseWorkspaceTopicConsolidationActivationStatusV1,
  submitWorkspaceTopicConsolidationActivationIntentV1, workspaceTopicConsolidationActivationIntentV1,
  workspaceTopicConsolidationSelectedConceptKeysV1,
  type WorkspaceTopicConsolidationActivationStatusV1 } from "./workspace-topic-consolidation-activation";

Object.assign(globalThis, { React });
const workspaceId = "00000000-0000-4000-8000-000000000001";
const value: WorkspaceTopicConsolidationView = {
  contract_version: "signal-topic-consolidation-status-v1", workspace_id: workspaceId,
  status: "ready_to_prepare", can_request: true, provider_execution_enabled: false,
  maximum_micro_usd: "0", confirmed_micro_usd: "0", reserved_micro_usd: "0",
  expected_group_count: 1_652, group_count: 0, source_execution_id: "00000000-0000-4000-8000-000000000002",
  quote_reference: `v1.1789000000.${"a".repeat(64)}`, quote_expires_at: "2026-09-13T00:00:00.000Z", execution: null
};
async function render(locale: "es-MX" | "en-US", current = value, onAction: ((action: "prepare_numeric") => void) | undefined = () => undefined) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "America/Mexico_City" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicConsolidationCard, { value: current, onAction })));
}

test("the C2 adapter fails closed on cross-workspace, incomplete, inflated or contradictory status", () => {
  assert.equal(validWorkspaceTopicConsolidationView(value, workspaceId), true);
  for (const changed of [
    { ...value, workspace_id: "another" },
    { ...value, expected_group_count: -1 },
    { ...value, group_count: 1_653 },
    { ...value, maximum_micro_usd: "1" },
    { ...value, confirmed_micro_usd: "1" },
    { ...value, provider_execution_enabled: "false" },
    { ...value, extra: true }
  ]) assert.equal(validWorkspaceTopicConsolidationView(changed, workspaceId), false);
});

for (const locale of ["es-MX", "en-US"] as const) {
  test(`${locale}: the full census is clear without presenting 1,652 rows, cost or invented dispositions`, async () => {
    const html = await render(locale);
    assert.ok(html.includes("1,652") || html.includes("1652"));
    assert.ok(html.includes(locale === "es-MX" ? "Convertir grupos en Topics útiles" : "Turn groups into useful Topics"));
    assert.ok(html.includes(locale === "es-MX" ? "No tendrás que aprobar grupo por grupo" : "not need to approve groups one by one"));
    assert.ok(html.includes(locale === "es-MX" ? "Esta preparación es gratuita" : "This preparation is free"));
    assert.doesNotMatch(html, /\$|USD|20\.00/u);
    assert.equal((html.match(/<button\b/g) ?? []).length, 1);
    assert.equal((html.match(/>No disponible<|>Unavailable</g) ?? []).length, 0);
    assert.match(html, /data-provider-execution="disabled"/u);
    assert.doesNotMatch(html, /api\/|fetch\(|approve 1,652|aprobar 1,652/u);
  });
  test(`${locale}: numeric completion shows the next editorial step without exposing a paid command`, async () => {
    const html = await render(locale, { ...value, status: "ready", group_count: 1_652, can_request: false,
      execution: { execution_id: "00000000-0000-4000-8000-000000000003", status: "ready", retry_available: false, error_code: null } });
    assert.equal((html.match(/<button\b/g) ?? []).length, 0);
    assert.ok(html.includes(locale === "es-MX" ? "La revisión editorial abarcará los" : "Editorial review will cover all"));
    assert.match(html, /data-provider-execution="disabled"/u);
    assert.doesNotMatch(html, /Autorizar|Authorize|provider_execution_enabled=true/u);
  });
  test(`${locale}: policy action and active work do not expose a paid or duplicate action`, async () => {
    const policy = await render(locale, { ...value, status: "policy_action_required", can_request: false }, undefined);
    const running = await render(locale, { ...value, status: "running", group_count: 826, can_request: false,
      execution: { execution_id: "00000000-0000-4000-8000-000000000003", status: "running", retry_available: false, error_code: null } }, undefined);
    assert.equal((policy.match(/<button\b/g) ?? []).length, 0);
    assert.ok(policy.includes(locale === "es-MX" ? "Activa la consolidación de Topics" : "Enable Topics consolidation"));
    assert.equal((running.match(/<button\b/g) ?? []).length, 0);
    assert.match(running, /progress[^>]*value="50"/u);
  });
}

test("the client wrapper calls only the provider-free consolidation endpoint and commands", async () => {
  const source = await readFile(new URL("../../components/brands/WorkspaceTopicConsolidationCard.tsx", import.meta.url), "utf8");
  assert.match(source, /topics\/consolidation/u);
  assert.match(source, /action: "prepare_numeric"/u);
  assert.match(source, /action: "retry_numeric"/u);
  assert.match(source, /workspaceTopicConsolidationIntentV1/u);
  assert.match(source, /previous: intent\.current/u);
  assert.match(source, /submitWorkspaceTopicConsolidationIntentV1/u);
  assert.doesNotMatch(source, /review_with_claude|authorize_interpretation|provider_execution_enabled:\s*true/u);
});

const digest = (index: number) => `sha256:${index.toString(16).padStart(64, "0")}`;
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const catalog = Array.from({ length: 24 }, (_, index) => {
  const semanticDigest = digest(index + 1);
  return { concept_key: `concept-${index + 1}`, concept_id: uuid(index + 10), kind: index % 2 ? "narrative" as const : "topic" as const,
    locale: "es-MX", semantic_identity_digest: semanticDigest, term_key: `consolidated_${semanticDigest.slice(7)}`,
    label: `Concept ${index + 1}`, definition: `Definition ${index + 1}`, definition_digest: semanticDigest,
    definition_revision: 1, created_at: "2026-09-12T12:00:00.000Z", updated_at: "2026-09-12T12:00:00.000Z" };
});
const activation: WorkspaceTopicConsolidationActivationStatusV1 = {
  contract_version: "signal-topic-consolidation-activation-status-v1", workspace_id: workspaceId, can_activate: true,
  active_revision: null,
  binding: { snapshot_id: null, legacy_generation_id: uuid(2), binding_revision: 0, selection_revision: 7, selection: {}, operation_id: null },
  revisions: [{ revision_id: uuid(3), revision: 2, revision_digest: digest(40), validated_at: "2026-09-12T12:00:00.000Z",
    snapshot_id: uuid(4), snapshot_digest: digest(41), source_valid: true, catalog }]
};
const activationRevision = activation.revisions[0]!;
async function renderActivation(locale: "es-MX" | "en-US", current = activation, selected = catalog.map(item => item.concept_key),
  overrides: Partial<ComponentProps<typeof WorkspaceTopicConsolidationActivationCard>> = {}) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "America/Mexico_City" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicConsolidationActivationCard, { value: current, selectedConceptKeys: selected,
      signalHref: "/signal/alexa-plus/topics-narratives", onToggle: () => undefined, onToggleAll: () => undefined,
      onActivate: () => undefined, onPrepare: () => undefined, onReplay: () => undefined, onRefresh: () => undefined, ...overrides })));
}

test("activation status fails closed on cross-workspace or incomplete snapshot data", () => {
  assert.deepEqual(parseWorkspaceTopicConsolidationActivationStatusV1(activation, workspaceId), activation);
  assert.equal(parseWorkspaceTopicConsolidationActivationStatusV1({ ...activation, workspace_id: uuid(99) }, workspaceId), null);
  assert.equal(parseWorkspaceTopicConsolidationActivationStatusV1({ ...activation, active_revision: 2 }, workspaceId), null);
  assert.equal(parseWorkspaceTopicConsolidationActivationStatusV1({ ...activation, revisions: [{ ...activation.revisions[0], snapshot_digest: null }] }, workspaceId), null);
  assert.equal(parseWorkspaceTopicConsolidationActivationStatusV1({ ...activation, revisions: [{ ...activation.revisions[0], catalog: [...catalog, ...catalog, ...catalog, ...catalog, ...catalog, ...catalog] }] }, workspaceId), null);
});

test("successor selection preserves exact semantic decisions while selecting new concepts by default", () => {
  const retained = catalog[0]!;
  const prior = { ...activation, binding: { ...activation.binding, snapshot_id: uuid(90), legacy_generation_id: null,
    selection: { legacy: { selected: false, definition_digest: retained.definition_digest, definition_revision: 1,
      generation_id: uuid(90), semantic_identity_digest: retained.semantic_identity_digest } } } };
  const selected = workspaceTopicConsolidationSelectedConceptKeysV1(prior, activationRevision);
  assert.equal(selected.includes(retained.concept_key), false);
  assert.equal(selected.includes(catalog[1]!.concept_key), true);
});

for (const locale of ["es-MX", "en-US"] as const) {
  test(`${locale}: validated proposal is compact, fully preselected and exposes one publication CTA`, async () => {
    const html = await renderActivation(locale);
    assert.match(html, /data-topic-activation-state="ready"/u);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 25);
    assert.equal((html.match(/checked=""/g) ?? []).length, 25);
    assert.equal((html.match(/admin-button admin-button--primary/g) ?? []).length, 1);
    assert.ok(html.includes(locale === "es-MX" ? "Publicar 24 en Signal" : "Publish 24 to Signal"));
    assert.match(html, /<dt>Topics<\/dt><dd>12<\/dd>/u);
    assert.match(html, new RegExp(`<dt>${locale === "es-MX" ? "Narrativas" : "Narratives"}</dt><dd>12</dd>`));
    assert.doesNotMatch(html, /textarea|taxonomy_terms|Aprobar|Approve/u);
  });
  test(`${locale}: unprepared, active, stale and replay states expose only their valid next action`, async () => {
    const unprepared = await renderActivation(locale, { ...activation, revisions: [{ ...activationRevision,
      snapshot_id: null, snapshot_digest: null, source_valid: null, catalog: null }] }, [], {});
    assert.match(unprepared, /data-topic-activation-state="prepare"/u);
    assert.ok(unprepared.includes(locale === "es-MX" ? "Preparar propuesta para Signal" : "Prepare proposal for Signal"));
    const activeSelection = Object.fromEntries(catalog.map(item => [item.term_key, { selected: true, definition_digest: item.definition_digest,
      definition_revision: 1, generation_id: uuid(4), semantic_identity_digest: item.semantic_identity_digest }]));
    const active = await renderActivation(locale, { ...activation, binding: { ...activation.binding, snapshot_id: uuid(4),
      legacy_generation_id: null, binding_revision: 1, selection_revision: 8, operation_id: uuid(5), selection: activeSelection }, active_revision: 2 });
    assert.match(active, /data-topic-activation-state="active"/u); assert.match(active, /href="\/signal\/alexa-plus\/topics-narratives"/u);
    assert.doesNotMatch(active, /type="checkbox"|Publish 24|Publicar 24/u);
    const stale = await renderActivation(locale, { ...activation, revisions: [{ ...activationRevision, source_valid: false }] });
    assert.match(stale, /data-topic-activation-state="stale"/u); assert.doesNotMatch(stale, /Publish 24|Publicar 24/u);
    const replay = await renderActivation(locale, activation, catalog.map(item => item.concept_key), { pending: true });
    assert.ok(replay.includes(locale === "es-MX" ? "Comprobar solicitud" : "Check request"));
    assert.doesNotMatch(replay, /Publish 24|Publicar 24/u);
    const denied = await renderActivation(locale, activation, catalog.map(item => item.concept_key), { value: null, accessDenied: true });
    assert.match(denied, /data-topic-activation-state="access_required"/u); assert.doesNotMatch(denied, /<button|admin-button--primary/u);
    const unavailable = await renderActivation(locale, activation, catalog.map(item => item.concept_key), { loadError: true });
    assert.match(unavailable, /data-topic-activation-state="error"/u); assert.doesNotMatch(unavailable, /Publish 24|Publicar 24/u);
    assert.ok(unavailable.includes(locale === "es-MX" ? "Actualizar estado" : "Refresh status"));
  });
}

test("activation replay preserves the idempotency key and sends every CAS fence with explicit selection", async () => {
  const body = { action: "activate" as const, snapshot_id: uuid(4), snapshot_digest: digest(41), revision_digest: digest(40),
    selected_concept_keys: catalog.map(item => item.concept_key), expected_binding_revision: 0, expected_selection_revision: 7,
    expected_snapshot_id: null, expected_legacy_generation_id: uuid(2) };
  const first = workspaceTopicConsolidationActivationIntentV1({ workspace_id: workspaceId, body, previous: null, createKey: () => "activation-key" });
  const replay = workspaceTopicConsolidationActivationIntentV1({ workspace_id: workspaceId, body: { ...body }, previous: first, createKey: () => "wrong-key" });
  assert.equal(replay.idempotency_key, "activation-key");
  const receipt = { operation_id: uuid(5), binding: { ...activation.binding, snapshot_id: uuid(4), legacy_generation_id: null,
    binding_revision: 1, selection_revision: 8, operation_id: uuid(5) }, replayed: true };
  const result = await submitWorkspaceTopicConsolidationActivationIntentV1(replay, async (url, init) => {
    assert.match(String(url), /topics\/consolidation\/activation$/u);
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "activation-key");
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    return Response.json(receipt);
  });
  assert.deepEqual(result, receipt);
});

test("free snapshot preparation sends only the validated revision identity", async () => {
  const body = { action: "prepare" as const, revision_id: uuid(3), revision_digest: digest(40) };
  const intent = workspaceTopicConsolidationActivationIntentV1({ workspace_id: workspaceId, body, previous: null,
    createKey: () => "prepare-activation-key" });
  const receipt = { snapshot_id: uuid(4), snapshot_digest: digest(41), denominator: 43_159, replayed: false, activation: "pending" as const };
  assert.deepEqual(await submitWorkspaceTopicConsolidationActivationIntentV1(intent, async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "prepare-activation-key");
    return Response.json(receipt);
  }), receipt);
});
