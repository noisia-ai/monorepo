import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  formatAdminCalendarDate,
  formatAdminInstant
} from "./AdminWorkspacePrimitives";

test("legacy implicit instant formatting reproduces the original React hydration mismatch", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const serverText = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" })
      .format(new Date("2026-08-21T04:48:05.538645+00:00"));
    process.env.TZ = "America/Mexico_City";
    const clientText = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" })
      .format(new Date("2026-08-21T04:48:05.538645+00:00"));
    assert.equal(serverText, "21 ago 2026");
    assert.equal(clientText, "20 ago 2026");
    assert.notEqual(clientText, serverText);
  } finally {
    process.env.TZ = previousTimezone;
  }
});

test("explicit instant formatting is SSR/client-stable for Mexico City, UTC+12 and UTC+14", () => {
  const value = "2026-08-21T04:48:05.538645+00:00";
  const previousTimezone = process.env.TZ;
  try {
    for (const runtimeTimezone of ["UTC", "America/Mexico_City", "Etc/GMT-12", "Pacific/Kiritimati"]) {
      process.env.TZ = runtimeTimezone;
      assert.equal(formatAdminInstant(value, "es-MX", "America/Mexico_City"), "20 ago 2026");
      assert.equal(formatAdminInstant(value, "es-MX", "Etc/GMT-12"), "21 ago 2026");
      assert.equal(formatAdminInstant(value, "es-MX", "Pacific/Kiritimati"), "21 ago 2026");
    }
    assert.throws(
      () => formatAdminInstant(value, "es-MX", ""),
      /requires an explicit product timezone/u
    );
  } finally {
    process.env.TZ = previousTimezone;
  }
});

test("calendar dates retain their canonical civil day in every runtime timezone", () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const runtimeTimezone of ["UTC", "America/Mexico_City", "Etc/GMT-12", "Pacific/Kiritimati"]) {
      process.env.TZ = runtimeTimezone;
      assert.equal(formatAdminCalendarDate("2026-08-20", "es-MX"), "20 ago 2026");
    }
    assert.equal(formatAdminCalendarDate("2026-02-30", "es-MX"), "2026-02-30");
  } finally {
    process.env.TZ = previousTimezone;
  }
});

test("Governance preparation passes its declared workspace timezone to every governed instant", async () => {
  const source = await readFile(
    new URL("./GovernancePreparationManager.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /formatAdminDate/u);
  assert.match(source, /timezone=\{initial\.workspace\.timezone\}/u);
  assert.match(source, /formatAdminInstant\(current\.approved_at \?\? current\.effective_from, locale, timezone\)/u);
  assert.match(source, /formatAdminInstant\(item\.created_at, locale, timezone\)/u);
});
