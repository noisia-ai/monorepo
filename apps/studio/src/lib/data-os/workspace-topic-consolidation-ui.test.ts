import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";

import { WorkspaceTopicConsolidationCard,
  validWorkspaceTopicConsolidationView, type WorkspaceTopicConsolidationView } from "../../components/brands/WorkspaceTopicConsolidationCard";

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
  assert.match(source, /"Idempotency-Key": crypto\.randomUUID\(\)/u);
  assert.doesNotMatch(source, /review_with_claude|authorize_interpretation|provider_execution_enabled:\s*true/u);
});
