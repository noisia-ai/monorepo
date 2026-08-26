import assert from "node:assert/strict";
import test from "node:test";

import { formatAdminDate } from "./AdminWorkspacePrimitives";

test("Admin dates render identically during UTC SSR and Mexico City hydration", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const serverText = formatAdminDate(
      "2026-08-21T04:48:05.538645+00:00",
      "es-MX"
    );
    process.env.TZ = "America/Mexico_City";
    const clientText = formatAdminDate(
      "2026-08-21T04:48:05.538645+00:00",
      "es-MX"
    );

    assert.equal(serverText, "21 ago 2026");
    assert.equal(clientText, serverText);
    assert.equal(formatAdminDate(
      "2026-08-21T04:48:05.538645+00:00",
      "es-MX",
      { dateStyle: "medium", timeZone: "America/Mexico_City" }
    ), "20 ago 2026", "callers can still request an explicit product timezone");
  } finally {
    process.env.TZ = previousTimezone;
  }
});

test("date-only Admin values stay on their canonical day in every runtime timezone", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Kiritimati";
    const farEast = formatAdminDate("2026-08-20", "es-MX");
    process.env.TZ = "America/Adak";
    const farWest = formatAdminDate("2026-08-20", "es-MX");
    assert.equal(farEast, "20 ago 2026");
    assert.equal(farWest, farEast);
  } finally {
    process.env.TZ = previousTimezone;
  }
});
