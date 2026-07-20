import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDataOsCapabilities,
  buildDataOsCapabilityGuardrails
} from "./tb-data-os-capabilities";

test("separates available, review-required, and missing evidence domains", () => {
  const capabilities = buildDataOsCapabilities({
    rows: [
      {
        dataset_role: "ecommerce_sales",
        metric_family: "sales",
        accepted_observations: 12,
        review_observations: 2,
        rejected_observations: 0,
        temporal_observations: 12,
        accepted_records: 12,
        review_records: 0,
        rejected_records: 0,
        temporal_records: 12,
        months: 12,
        assets: 1,
        period_start: "2025-01-01",
        period_end: "2025-12-31"
      },
      {
        dataset_role: "web_analytics",
        metric_family: "sessions",
        accepted_observations: 0,
        review_observations: 8,
        rejected_observations: 0,
        temporal_observations: 0,
        accepted_records: 0,
        review_records: 8,
        rejected_records: 0,
        temporal_records: 0,
        months: 0,
        assets: 1,
        period_start: null,
        period_end: null
      }
    ],
    rawListeningFallbackObservations: 3331
  });

  assert.equal(capabilities.find((item) => item.key === "social_listening")?.status, "available");
  assert.equal(capabilities.find((item) => item.key === "social_listening")?.evidence_source, "mentions_fallback");
  assert.equal(capabilities.find((item) => item.key === "ecommerce_sales")?.status, "available");
  assert.equal(capabilities.find((item) => item.key === "web_analytics")?.status, "review_required");
  assert.equal(capabilities.find((item) => item.key === "crm_marketing")?.status, "missing");
});

test("does not misclassify generic context as commercial evidence", () => {
  const capabilities = buildDataOsCapabilities({
    rows: [
      {
        dataset_role: "uploaded_context",
        metric_family: "notes",
        accepted_observations: 30,
        review_observations: 0,
        rejected_observations: 0,
        temporal_observations: 0,
        accepted_records: 0,
        review_records: 0,
        rejected_records: 0,
        temporal_records: 0,
        months: 0,
        assets: 2,
        period_start: null,
        period_end: null
      }
    ]
  });

  assert.ok(capabilities.every((item) => item.status === "missing"));
});

test("emits explicit no-fabrication guardrails per missing domain", () => {
  const capabilities = buildDataOsCapabilities({ rows: [] });
  const guardrails = buildDataOsCapabilityGuardrails(capabilities);

  assert.ok(guardrails.some((line) => line.includes("Ecommerce sales") && line.includes("do not infer")));
  assert.ok(guardrails.some((line) => line.includes("Web analytics") && line.includes("do not infer")));
  assert.ok(guardrails.some((line) => line.includes("Social listening") && line.includes("do not infer")));
});
