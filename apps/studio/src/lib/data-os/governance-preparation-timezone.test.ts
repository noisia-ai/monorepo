import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { NextIntlClientProvider } from "next-intl";
import { GovernancePreparationManager, TimezoneForm } from "../../components/admin/GovernancePreparationManager";
import type { SignalGovernancePreparationV1 } from "./signal-governance-control-plane";

Object.assign(globalThis, { React });
const instant = "2026-09-08T02:12:00.000Z";
const policy = { policy_key: "local-policy", policy_version: 1, status: "active", effective_from: instant,
  effective_to: null, approved_at: instant, approved_by: "Test operator" };
const initial: SignalGovernancePreparationV1 = {
  contract_version: "signal-governance-control-plane-v1",
  workspace: { name: "Local fixture", slug: "local", timezone: "America/Mexico_City", status: "active" },
  checklist: [], policies: { quality: [policy], retention: [{ ...policy, approved_at: null }], licensing: [{ ...policy, usages: [] }] },
  sources: [], identities: { primary_brand: 1, competitors: 0, categories: 1, references: 0, brand_os_profile_version: 1 },
  semantic_review: { canonical_roots: 0, approved_eligible: 0, pending: 0, unattributed_final: 0 },
  governed_views: { ready_compilations: 0, current_bindings: 0, stale_or_invalidated: 0 },
  strategic: { compilation_ready: false, binding_current: false, authorized_provenance_routes: 0 }
};
const router: NonNullable<React.ContextType<typeof AppRouterContext>> = {
  back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}
};

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  test(`${locale}: governance approvals use the workspace day across server and browser system zones`, () => {
    const previousZone = process.env.TZ;
    const render = (workspaceZone: string, systemZone: string) => {
      process.env.TZ = systemZone;
      return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router },
        createElement(NextIntlClientProvider, { locale, messages, timeZone: workspaceZone } as ComponentProps<typeof NextIntlClientProvider>,
          createElement(GovernancePreparationManager, { workspaceId: "local-workspace", initial: {
            ...initial, workspace: { ...initial.workspace, timezone: workspaceZone }
          } }))));
    };
    try {
      for (const workspaceZone of ["America/Mexico_City", "Asia/Tokyo"]) {
        const server = render(workspaceZone, "UTC");
        const browser = render(workspaceZone, "America/Los_Angeles");
        assert.equal(server, browser, `${workspaceZone}: system TZ changed the SSR markup`);
        const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: workspaceZone }).format(new Date(instant));
        const expected = messages.AdminWorkspace.data.preparation.authorities.approval
          .replace("{actor}", "Test operator").replace("{date}", date);
        assert.equal(server.split(expected).length - 1, 3, "all three policy rows, including effective_from fallback, must use the workspace date");
      }
      assert.notEqual(render("America/Mexico_City", "UTC"), render("Asia/Tokyo", "UTC"), "the component must honor the workspace zone rather than hardcode UTC");
    } finally {
      if (previousZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousZone;
    }
  });
  test(`${locale}: governance timezone mutation uses the searchable IANA catalog`, () => {
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
      { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
      createElement(TimezoneForm, { busy: false, error: null, initial: "America/Mexico_City",
        submit: async () => {} })));
    assert.match(html, /name="timezone" type="hidden" value="America\/Mexico_City"/u);
    assert.match(html, /role="combobox"/u);
    assert.equal((html.match(/name="timezone"/gu) ?? []).length, 1);
    assert.doesNotMatch(html, /<input(?=[^>]*name="timezone")(?=[^>]*type="text")[^>]*>/u);
    assert.ok(html.includes(messages.AdminWorkspace.data.preparation.fields.timezoneHelp));
  });
}
