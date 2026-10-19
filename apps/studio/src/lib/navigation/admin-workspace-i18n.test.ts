import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REQUIRED_PATHS = [
  "AdminWorkspace.navigation.items.dashboard",
  "AdminWorkspace.navigation.items.corpora",
  "AdminWorkspace.context.items.data",
  "AdminWorkspace.dashboard.priority.workspace_missing",
  "AdminWorkspace.brand.issues.items.review",
  "AdminWorkspace.data.create.primaryBrand",
  "AdminWorkspace.data.history.counts",
  "AdminWorkspace.reports.preflight.items.population",
  "AdminWorkspace.reports.launch.check",
  "AdminWorkspace.reports.launch.confirm",
  "AdminWorkspace.reports.launch.preflight.authorizationPending",
  "AdminWorkspace.reports.launch.errors.notAuthorized",
  "AdminWorkspace.settings.archive.subtitle",
  "AdminWorkspace.globalSettings.serving.deferred",
  "SignalV2.settings.data.noVisibleSources",
  "SignalV2.settings.profiles.kinds.topic",
  "SignalV2.settings.states.not_available"
] as const;

test("Admin and client-safe Settings contracts are translated in both locales", async () => {
  const locales = await Promise.all(["en-US", "es-MX"].map(async (locale) => ({
    locale,
    messages: JSON.parse(await readFile(
      new URL(`../../../messages/${locale}.json`, import.meta.url),
      "utf8"
    )) as Record<string, unknown>
  })));
  for (const { locale, messages } of locales) {
    for (const path of REQUIRED_PATHS) {
      const value = path.split(".").reduce<unknown>((current, key) => (
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined
      ), messages);
      assert.equal(typeof value, "string", `${locale} is missing ${path}`);
      assert.notEqual(value, path, `${locale} renders a raw key for ${path}`);
    }
  }
});
