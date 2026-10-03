import assert from "node:assert/strict";
import test from "node:test";

import {
  signalAcquisitionImportSealDigestV1,
  signalAcquisitionImportSealDigestV2,
  signalAcquisitionPlanDigestV1,
  signalAcquisitionQueryDigestV1,
  validateSignalConnectorSourceInputV1,
  validateSignalAcquisitionImportInputV1,
  validateSignalAcquisitionImportInputV2,
  validateSignalAcquisitionQueryVersionInputV1,
  validateSignalAcquisitionSourceKeyV1,
  validateSignalProviderMentionObservationV1
} from "./signal-acquisition-plan-v1";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const sourceKey = `source-sha256-${"a".repeat(64)}`;
const slotKey = `competitor-sha256-${"b".repeat(64)}`;

test("acquisition plan hashes are independent from slot and query input order", () => {
  const slots = ["b", "a"].map((suffix, index) => ({
    slot_key: `competitor-sha256-${suffix.repeat(64)}`,
    slot_version: 1,
    scope: "competitor" as const,
    entity_type: "competitor" as const,
    entity_ref_hash: digest(suffix),
    entity_revision_digest: digest(index ? "c" : "d"),
    desired_state: "active" as const,
    position: index,
    reference_decision_hash: null
  }));
  const query = {
    slot_key: slots[0]!.slot_key,
    query_key: `query-sha256-${"9".repeat(64)}`,
    query_version: 1,
    source_key: sourceKey,
    provider_key: "sentione" as const,
    provider_syntax_version: "sentione-query-v1",
    provider_schema_version: "sentione-csv-47-v1" as const,
    query_hash: digest("e"),
    structured_terms: { include: ["z", "a"], exclude: [], aliases: [] },
    cadence: "manual" as const,
    default_period_start: null,
    default_period_end: null,
    timezone: "America/Mexico_City"
  };
  const plan = {
    workspace_ref_hash: digest("f"), plan_version: 1, brand_os_profile_version: 1,
    brand_os_digest: digest("1"), identity_catalog_digest: digest("2"), slots,
    queries: [query]
  };
  assert.equal(signalAcquisitionPlanDigestV1(plan), signalAcquisitionPlanDigestV1({
    ...plan, slots: [...slots].reverse(), queries: [...plan.queries].reverse()
  }));
  assert.equal(signalAcquisitionQueryDigestV1(query), signalAcquisitionQueryDigestV1({
    ...query, structured_terms: { ...query.structured_terms, include: ["a", "z"] }
  }));
});

test("public validators reject authority ids, SQL and unknown fields", () => {
  const base = {
    source_key: sourceKey, provider: "sentione", provider_syntax_version: "sentione-query-v1",
    provider_schema_version: "sentione-csv-47-v1", query_text: "brand terms",
    structured_terms: { include: [], exclude: [], aliases: [] }, cadence: "manual",
    default_period: { start: null, end: null, timezone: "America/Mexico_City" }
  };
  assert.throws(() => validateSignalAcquisitionQueryVersionInputV1({ ...base, workspace_id: "x" }), /unknown fields/u);
  assert.throws(() => validateSignalAcquisitionQueryVersionInputV1({ ...base, entity_id: "x" }), /unknown fields/u);
  assert.throws(() => validateSignalAcquisitionQueryVersionInputV1({ ...base, sql: "select 1" }), /unknown fields/u);
  assert.throws(() => validateSignalAcquisitionSourceKeyV1("source-id"), /invalid/u);
  assert.deepEqual(validateSignalConnectorSourceInputV1({
    contract_version: "signal-data-source-connector-v1", name: "Shared connector",
    provider: "sentione", source_type: "social-listening", connection_method: "manual-csv"
  }), {
    contract_version: "signal-data-source-connector-v1", name: "Shared connector",
    provider: "sentione", source_type: "social-listening", connection_method: "manual-csv"
  });
  assert.throws(() => validateSignalConnectorSourceInputV1({
    contract_version: "signal-data-source-connector-v1", name: "bad", provider: "sentione",
    source_type: "social-listening", connection_method: "manual-csv", scope: "primary_brand"
  }), /unknown fields/u);
});

test("import seal validates IANA timezone, period and stable digest", () => {
  const input = validateSignalAcquisitionImportInputV1({
    source_key: sourceKey, slot_key: slotKey, query_version: 2,
    period: { start: "2026-03-01", end: "2026-03-31", timezone: "America/Mexico_City" },
    file_name: "fixture.csv", file_size_bytes: 100, content_type: "text/csv",
    supersedes_import_key: null
  });
  assert.equal(input.period.timezone, "America/Mexico_City");
  assert.throws(() => validateSignalAcquisitionImportInputV1({ ...input, period: {
    start: "2026-03-31", end: "2026-03-01", timezone: "UTC"
  }}), /period/u);
  assert.throws(() => validateSignalAcquisitionImportInputV1({ ...input, workspace_id: "forbidden" }), /unknown fields/u);
  assert.throws(() => validateSignalAcquisitionImportInputV1({ ...input, file_name: "fixture.json" }), /file contract/u);
  const seal = {
    contract_version: "signal-acquisition-import-v1" as const,
    source_key: sourceKey, slot_key: slotKey, query_version: 2,
    capture_period_start: "2026-03-01", capture_period_end: "2026-03-31",
    capture_timezone: "America/Mexico_City", plan_digest: digest("1"),
    slot_digest: digest("2"), query_digest: digest("3"), brand_os_digest: digest("4"),
    identity_catalog_digest: digest("5"), provider_schema_version: "sentione-csv-47-v1" as const
  };
  assert.equal(signalAcquisitionImportSealDigestV1(seal), signalAcquisitionImportSealDigestV1({ ...seal }));
  assert.throws(()=>signalAcquisitionImportSealDigestV1({ ...seal,capture_period_start:"2026-04-01" }),/seal/u);
  assert.throws(()=>signalAcquisitionImportSealDigestV1({ ...seal,contract_version:"legacy" as never }),/seal/u);
});

test("query evidence v2 keeps browser attestation distinct from provider verification",()=>{
  const base={source_key:sourceKey,slot_key:slotKey,
    period:{start:"2026-03-01",end:"2026-03-31",timezone:"America/Mexico_City"},
    file_name:"historical.csv",file_size_bytes:100,content_type:"text/csv",
    supersedes_import_key:null};
  assert.equal(validateSignalAcquisitionImportInputV2({...base,query_evidence:{
    class:"operator_attested",query_version:3,reason:null,operator_confirmed:true
  }}).query_evidence.class,"operator_attested");
  assert.deepEqual(validateSignalAcquisitionImportInputV2({...base,query_evidence:{
    class:"unavailable",query_version:null,reason:"historical_export",operator_confirmed:true
  }}).query_evidence,{class:"unavailable",query_version:null,reason:"historical_export",
    operator_confirmed:true});
  assert.throws(()=>validateSignalAcquisitionImportInputV2({...base,query_evidence:{
    class:"provider_verified",query_version:3,reason:null,operator_confirmed:true
  }}),/not available to the browser/u);
  assert.throws(()=>validateSignalAcquisitionImportInputV2({...base,query_evidence:{
    class:"unavailable",query_version:3,reason:"historical_export",operator_confirmed:true
  }}),/must not reference/u);
  assert.throws(()=>validateSignalAcquisitionImportInputV2({...base,query_evidence:{
    class:"operator_attested",query_version:3,reason:null,operator_confirmed:false
  }}),/explicit operator confirmation/u);

  const common={contract_version:"signal-acquisition-import-v2" as const,source_key:sourceKey,
    slot_key:slotKey,capture_period_start:"2026-03-01",capture_period_end:"2026-03-31",
    capture_timezone:"America/Mexico_City",plan_digest:digest("1"),slot_digest:digest("2"),
    brand_os_digest:digest("4"),identity_catalog_digest:digest("5"),
    provider_schema_version:"sentione-csv-47-v1" as const,operator_actor_ref_hash:digest("6"),
    operator_attested_at:"2026-08-17T12:00:00.000Z"};
  const unavailable={...common,query_evidence_class:"unavailable" as const,query_version:null,
    query_evidence_reason:"historical_export" as const,provider_execution_reference_hash:null,
    query_digest:null};
  assert.equal(signalAcquisitionImportSealDigestV2(unavailable),signalAcquisitionImportSealDigestV2({...unavailable}));
  assert.throws(()=>signalAcquisitionImportSealDigestV2({...unavailable,query_digest:digest("7")}),/unavailable/u);
  const attested={...common,query_evidence_class:"operator_attested" as const,query_version:3,
    query_evidence_reason:null,provider_execution_reference_hash:null,query_digest:digest("7")};
  assert.doesNotThrow(()=>signalAcquisitionImportSealDigestV2(attested));
  assert.throws(()=>signalAcquisitionImportSealDigestV2({...attested,
    provider_execution_reference_hash:digest("8")}),/operator-attested/u);
});

test("industry labels cannot create category or reference authority", () => {
  const base = {
    source_key: sourceKey, provider: "sentione", provider_syntax_version: "sentione-query-v1",
    provider_schema_version: "sentione-csv-47-v1", query_text: "category terms",
    structured_terms: { include: [], exclude: [], aliases: [] }, cadence: "manual",
    default_period: { start: null, end: null, timezone: "UTC" }
  };
  assert.throws(() => validateSignalAcquisitionQueryVersionInputV1({ ...base, industry: "Retail" }), /unknown fields/u);
  assert.throws(() => validateSignalAcquisitionQueryVersionInputV1({ ...base, reference_decision: true }), /unknown fields/u);
});

test("typed provider observation validator is strict and operator-safe",()=>{
  const observation={
    provider_schema_version:"sentione-csv-47-v1",
    provider_header_hash:digest("1"),provider_record_key_hash:digest("2"),observation_hash:digest("3"),
    platform:"Facebook",provider_source_type:"Social media",provider_content_type:"Post",
    language_code:"es-MX",country_code:"mx",published_at:"2026-04-05T12:30:00-06:00",
    provider_collected_at:null,provider_sentiment_label:"positive",provider_sentiment_score:4.5,
    engagement_total:12,terms:[{kind:"provider-tag",value:"campaign"}]
  };
  assert.deepEqual(validateSignalProviderMentionObservationV1(observation),{
    ...observation,platform:"facebook",provider_source_type:"social media",provider_content_type:"post",
    language_code:"es-mx",country_code:"MX",published_at:"2026-04-05T18:30:00.000Z"
  });
  assert.throws(()=>validateSignalProviderMentionObservationV1({ ...observation,raw_metadata:{} }),/unknown fields/u);
  assert.throws(()=>validateSignalProviderMentionObservationV1({ ...observation,text:"secret" }),/unknown fields/u);
  assert.throws(()=>validateSignalProviderMentionObservationV1({ ...observation,provider_schema_version:"unknown" }),/unsupported/u);
});
