import assert from "node:assert/strict";
import test from "node:test";

import {
  filterCompatibleBaselineCorpora,
  getBaselineCompatibility,
  type BaselineCorpusOption
} from "./baseline-corpus";

const baseCandidate: BaselineCorpusOption = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Pet Care MX baseline",
  status: "corpus_approved",
  candidateType: "industry_baseline",
  subjectLabel: "Pet Care",
  brandId: null,
  brandName: null,
  themeId: "00000000-0000-4000-8000-000000000010",
  themeName: "Pet Care",
  themeSlug: "pet-care",
  methodologyId: "00000000-0000-4000-8000-000000000020",
  methodologySlug: "triggers-barriers",
  methodologyName: "Triggers & Barriers",
  methodologyVersion: "1.0",
  industryTags: ["Pet Care & Animal Supplies"],
  geoFocus: ["MX"],
  includedCount: 120,
  targetWindowMonths: 12,
  updatedAt: "2026-07-01T00:00:00.000Z",
  corpusFirstApprovedAt: "2026-07-01T00:00:00.000Z"
};

test("same-industry baseline is compatible for the selected brand study", () => {
  const result = getBaselineCompatibility(baseCandidate, {
    brandId: "00000000-0000-4000-8000-000000000100",
    methodologySlug: "triggers-barriers",
    industryTags: ["Pet Care & Animal Supplies", "Pet eCommerce"],
    geoFocus: ["MX"]
  });

  assert.equal(result.eligible, true);
  assert.ok(result.reasons.includes("industry_match"));
});

test("wrong industry baseline is filtered out", () => {
  const telecom = {
    ...baseCandidate,
    id: "00000000-0000-4000-8000-000000000002",
    name: "Telefonia MX baseline",
    themeSlug: "telefonia-mx",
    industryTags: ["Telecom"]
  };

  const result = getBaselineCompatibility(telecom, {
    brandId: "00000000-0000-4000-8000-000000000100",
    methodologySlug: "triggers-barriers",
    industryTags: ["Pet Care & Animal Supplies"],
    geoFocus: ["MX"]
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["industry_mismatch"]);
});

test("same-brand corpus wins over industry baseline when both are compatible", () => {
  const brandCorpus: BaselineCorpusOption = {
    ...baseCandidate,
    id: "00000000-0000-4000-8000-000000000003",
    name: "Laika 12M approved corpus",
    candidateType: "brand_reuse",
    subjectLabel: "Laika Mascotas",
    brandId: "00000000-0000-4000-8000-000000000100",
    brandName: "Laika Mascotas",
    themeId: null,
    themeName: null,
    themeSlug: null
  };

  const [first] = filterCompatibleBaselineCorpora([baseCandidate, brandCorpus], {
    brandId: "00000000-0000-4000-8000-000000000100",
    methodologySlug: "triggers-barriers",
    industryTags: ["Pet Care & Animal Supplies"],
    geoFocus: ["MX"]
  });

  assert.equal(first?.id, brandCorpus.id);
});

test("smoke corpora are never reusable even with enough mentions", () => {
  const smoke = {
    ...baseCandidate,
    name: "Telefonia MX baseline · smoke-mq18jsz5",
    themeSlug: "telefonia-smoke"
  };

  const result = getBaselineCompatibility(smoke, {
    brandId: "00000000-0000-4000-8000-000000000100",
    methodologySlug: "triggers-barriers",
    industryTags: ["Pet Care & Animal Supplies"],
    geoFocus: ["MX"]
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["not_reusable"]);
});
