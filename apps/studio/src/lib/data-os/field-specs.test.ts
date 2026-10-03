import assert from "node:assert/strict";
import test from "node:test";

import { buildBrandDataOsFieldSpecs, buildStudyDataOsFieldSpecs } from "./field-specs";

test("study field specs convert audience chips into rule-ready CDP-like segments", () => {
  const specs = buildStudyDataOsFieldSpecs({
    businessQuestion: "How should Laika convert first-time buyers into recurrent members?",
    decisionToInform: "Retention / member lifecycle\nMessaging / value proposition",
    audienceSegment: "Laika Member inactivo · app/web · membresia pagada sin recompra en 90 dias",
    knownBarriers: "precio vs calidad percibida\nconfianza en entrega",
    knownTriggers: "salud preventiva\nreposicion de alimento",
    successCriteria: "aumentar recompra 90 dias +10%",
    geoFocus: ["MX"],
    targetWindowMonths: 12,
    sourceManifest: [
      {
        name: "ventas.xlsx",
        kind: "spreadsheet_archive",
        field_names: ["customer_id", "membership_status", "last_purchase_date", "repeat_purchase_count"],
        row_count: 1200
      }
    ]
  });

  assert.equal(specs.decisions[0]?.decision_type, "retention");
  assert.equal(specs.audiences[0]?.activation_readiness, "rule_ready");
  assert.equal(specs.audiences[0]?.membership_status, "inactive_member");
  assert.ok(specs.audiences[0]?.behavioral_rules.some((rule) => rule.field === "days_since_last_purchase"));
  assert.equal(specs.barriers[0]?.taxonomy, "price_value");
  assert.equal(specs.triggers[0]?.taxonomy, "quality_health");
  assert.equal(specs.success_metrics[0]?.target_direction, "increase");
  assert.equal(specs.source_contract.has_structured_sources, true);
});

test("brand field specs preserve catalog roles for aliases and competitors", () => {
  const specs = buildBrandDataOsFieldSpecs({
    brandName: "Laika Mascotas",
    brandSlug: "laika",
    industry: "Pet Care & Animal Supplies",
    industrySub: "Pet eCommerce\nPet Food",
    countries: ["MX"],
    aliases: ["Laika MX", "@laikamascotas"],
    competitors: [{ name: "Petco Mexico", priority: 1 }]
  });

  assert.equal(specs.identity.industry, "Pet Care & Animal Supplies");
  assert.ok(specs.seed_terms.some((term) => term.term === "@laikamascotas" && term.catalog_role === "brand_alias"));
  assert.ok(specs.seed_terms.some((term) => term.term === "Petco Mexico" && term.catalog_role === "competitive_seed"));
  assert.equal(specs.competitors[0]?.role, "direct_competitor");
  assert.deepEqual(specs.competitors[0]?.market_scope, ["MX"]);
});
