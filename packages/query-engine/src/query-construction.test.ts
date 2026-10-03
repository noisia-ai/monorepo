import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQueryConstructionPlan,
  validateConstructedQuery,
  type QueryConstructionInput
} from "./query-construction";

const laikaInput: QueryConstructionInput = {
  methodologySlug: "triggers-barriers",
  subject: {
    type: "brand",
    name: "Laika Mascotas",
    industry: "Pet Care & Animal Supplies",
    industrySub: "Pet Food / Pet eCommerce",
    countries: ["Mexico (MX)"],
    handles: ["@laikamascotas"]
  },
  brandSeeds: ["Laika MX", "Laika Mexico", "laika.com.mx"],
  categorySeeds: ["tienda de mascotas", "alimento para mascotas"],
  competitorEntities: [
    { name: "Petco Mexico", aliases: ["Petco MX"] },
    { name: "Maskota" }
  ],
  triggerTerms: ["me convencio", "volvi a comprar"],
  barrierTerms: ["no me conviene", "no me llego"],
  targetWindowMonths: 12
};

test("exploratory T&B captures Laika broadly and moves themes to post-ingest tags", () => {
  const plan = buildQueryConstructionPlan(laikaInput);

  assert.equal(plan.mode, "exploratory");
  assert.equal(plan.recommended_variant, "permissive");
  assert.match(plan.permissive.brand, /Laika Mascotas/i);
  assert.match(plan.permissive.brand, /AND NOT/i);
  assert.match(plan.permissive.brand, /Laika Studios/i);
  assert.doesNotMatch(plan.permissive.brand, /me convencio/i);
  assert.doesNotMatch(plan.permissive.brand, /no me conviene/i);
  assert.equal(plan.tag_plan.application, "post_ingest");
  assert.match(
    plan.tag_plan.tags.find((tag) => tag.key === "trigger")?.expression ?? "",
    /me convencio/i
  );
  assert.match(
    plan.tag_plan.tags.find((tag) => tag.key === "barrier")?.expression ?? "",
    /no me llego/i
  );
  assert.deepEqual(plan.provider_config.languages, ["es", "en"]);
  assert.deepEqual(plan.provider_config.country, {
    mode: "open",
    values: [],
    rationale: "Country queda abierto por default porque la geolocalizacion social es incompleta; mercado se valida post-ingesta."
  });
  assert.equal(plan.provider_config.recommended_sources.includes("app_reviews"), true);
  assert.equal(plan.provider_config.recommended_sources.includes("google_reviews"), true);

  const validation = validateConstructedQuery({
    query: plan.permissive.brand,
    scope: "brand",
    input: laikaInput,
    plan
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test("rejects the over-filtered Laika query that motivated the redesign", () => {
  const plan = buildQueryConstructionPlan(laikaInput);
  const validation = validateConstructedQuery({
    query: '("Laika Mascotas" OR "Laika MX" OR "Laika Mexico") AND ("lo compre porque" OR "me convencio" OR "no me conviene" OR "me frena")',
    scope: "brand",
    input: laikaInput,
    plan
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((issue) => issue.code === "exploratory_theme_gate"), true);
  assert.equal(validation.errors.some((issue) => issue.code === "missing_preemptive_noise"), true);
});

test("rejects Laika as a bare homonym even with preemptive exclusions", () => {
  const plan = buildQueryConstructionPlan(laikaInput);
  const validation = validateConstructedQuery({
    query: '(Laika) AND NOT ("Laika Studios" OR "perra Laika")',
    scope: "brand",
    input: laikaInput,
    plan
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((issue) => issue.code === "unsafe_bare_anchor"), true);
});

test("materializes one governed query per competitor entity", () => {
  const plan = buildQueryConstructionPlan(laikaInput);

  assert.deepEqual(
    plan.permissive.competitor_entities.map((entry) => entry.entity),
    ["Petco Mexico", "Maskota"]
  );
  assert.match(plan.permissive.competitor_entities[0]?.query ?? "", /Petco Mexico/i);
  assert.doesNotMatch(plan.permissive.competitor_entities[0]?.query ?? "", /Maskota/i);

  const grouped = validateConstructedQuery({
    query: plan.permissive.competitors_legacy_union ?? "",
    scope: "competitors",
    input: laikaInput,
    plan
  });
  assert.equal(grouped.valid, false);
  assert.equal(grouped.errors.some((issue) => issue.code === "grouped_competitors"), true);
});

test("marks catalog handles as requiring operational verification", () => {
  const plan = buildQueryConstructionPlan(laikaInput);
  const queryWithHandle = `(@laikamascotas OR "Laika Mascotas") AND NOT ("Laika Studios")`;
  const validation = validateConstructedQuery({
    query: queryWithHandle,
    scope: "brand",
    input: laikaInput,
    plan
  });

  assert.equal(validation.warnings.some((issue) => issue.code === "unverified_handle"), true);
});

const paymentsInput: QueryConstructionInput = {
  methodologySlug: "service-alert-detection",
  subject: {
    type: "brand",
    name: "Visa",
    industry: "Financial Services",
    industrySub: "Payment networks and cards",
    countries: ["Mexico (MX)", "Brasil (BR)"]
  },
  brandSeeds: ["Visa Banorte", "Visa Itau"],
  categorySeeds: ["tarjeta de credito", "cartao de credito"],
  competitorEntities: [
    { name: "Mastercard", aliases: ["Mastercard Mexico"] },
    { name: "American Express", aliases: ["Amex"] }
  ]
};

test("payments detection compiles bilingual, balanced and ambiguity-safe queries", () => {
  const plan = buildQueryConstructionPlan(paymentsInput);
  const query = plan.themed?.brand ?? "";

  assert.equal(plan.mode, "detection");
  assert.equal(plan.recommended_variant, "themed");
  assert.equal(plan.domain_profiles.includes("payments_cards"), true);
  assert.deepEqual(plan.provider_config.languages, ["es", "en", "pt"]);
  assert.equal(plan.anchors.brand.includes("Visa"), false);
  assert.equal(plan.unsafe_bare_terms.some((warning) => warning.term === "Visa"), true);
  assert.match(query, /tarjeta Visa/i);
  assert.match(query, /cartao Visa/i);
  assert.match(query, /AND NOT/i);
  assert.match(query, /PIX cartao/i);
  assert.equal(plan.theme_terms.triggers.some((term) => term === "resolv*"), true);
  assert.equal(plan.theme_terms.barriers.some((term) => term === "bloque*"), true);
  assert.equal(plan.theme_terms.barriers.some((term) => /^"PIX cartao"~10$/i.test(term)), true);

  const validation = validateConstructedQuery({
    query,
    scope: "brand",
    input: paymentsInput,
    plan
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test("contextualizes every payment competitor without merging entities", () => {
  const plan = buildQueryConstructionPlan(paymentsInput);
  const mastercard = plan.themed?.competitor_entities.find((entry) => entry.entity === "Mastercard");
  const amex = plan.themed?.competitor_entities.find((entry) => entry.entity === "American Express");
  const mastercardPositive = (mastercard?.query ?? "").split(/\s+AND\s+NOT\s+/i)[0] ?? "";
  const amexPositive = (amex?.query ?? "").split(/\s+AND\s+NOT\s+/i)[0] ?? "";

  assert.match(mastercardPositive, /tarjeta Mastercard/i);
  assert.match(mastercardPositive, /cartao Mastercard/i);
  assert.doesNotMatch(mastercardPositive, /American Express|Amex/i);
  assert.match(amexPositive, /tarjeta American Express/i);
  assert.doesNotMatch(amexPositive, /Mastercard/i);

  const validation = validateConstructedQuery({
    query: mastercard?.query ?? "",
    scope: "competitors",
    input: paymentsInput,
    plan,
    competitorEntity: "Mastercard"
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test("applies payment ambiguity rules to a competitor entity, not only the study subject", () => {
  const input: QueryConstructionInput = {
    ...paymentsInput,
    subject: {
      ...paymentsInput.subject,
      name: "Mastercard"
    },
    brandSeeds: ["Mastercard Mexico"],
    competitorEntities: [{ name: "Visa", aliases: ["Visa Mexico"] }]
  };
  const plan = buildQueryConstructionPlan(input);
  const visa = plan.themed?.competitor_entities[0];
  const positive = (visa?.query ?? "").split(/\s+AND\s+NOT\s+/i)[0] ?? "";

  assert.equal(plan.unsafe_bare_terms.some((warning) => warning.term === "Visa"), true);
  assert.doesNotMatch(positive, /\(Visa(?:\s+OR|\))/i);
  assert.match(positive, /tarjeta Visa/i);
  assert.match(positive, /cartao Visa/i);

  const validation = validateConstructedQuery({
    query: visa?.query ?? "",
    scope: "competitors",
    input,
    plan,
    competitorEntity: "Visa"
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test("rejects ambiguous standalone payment terms", () => {
  const plan = buildQueryConstructionPlan(paymentsInput);
  const validation = validateConstructedQuery({
    query: '("Visa" OR PIX OR Nu OR Elo OR tarjeta) AND ("me bloquearon la tarjeta") AND NOT ("visa de turista")',
    scope: "brand",
    input: paymentsInput,
    plan
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.filter((issue) => issue.code === "ambiguous_standalone_term").length >= 4, true);
  assert.equal(validation.errors.some((issue) => issue.code === "unsafe_bare_anchor"), true);
});

test("rejects a bare ambiguous brand even when the NOT block exists", () => {
  const plan = buildQueryConstructionPlan(paymentsInput);
  const validation = validateConstructedQuery({
    query: '(Visa) AND (bloque* OR resolv*) AND NOT ("visa de turista")',
    scope: "brand",
    input: paymentsInput,
    plan
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((issue) => issue.code === "unsafe_bare_anchor"), true);
});

test("rejects literal long-form social phrases without proximity", () => {
  const plan = buildQueryConstructionPlan(paymentsInput);
  const validation = validateConstructedQuery({
    query: '("Visa") AND ("el banco no me regresa mi dinero") AND NOT ("visa de turista")',
    scope: "brand",
    input: paymentsInput,
    plan
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((issue) => issue.code === "long_exact_phrase"), true);
});
