import assert from "node:assert/strict";
import test from "node:test";
import { formatSignalEvidenceDateV1 } from "./signal-evidence-date";

test("workspace evidence dates follow local civil days while preserving UTC fallback", () => {
  const instant = "2026-09-27T02:30:00.000Z";
  assert.equal(formatSignalEvidenceDateV1(instant, "es-MX", "America/Mexico_City"), "26 sep 2026");
  assert.equal(formatSignalEvidenceDateV1(instant, "es-MX", "UTC"), "27 sep 2026");
  assert.equal(formatSignalEvidenceDateV1(instant, "es-MX", "not/a-timezone"), "27 sep 2026");
});
