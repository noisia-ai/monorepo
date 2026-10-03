import { createHash } from "node:crypto";

export const SIGNAL_ACQUISITION_PLAN_CONTRACT_VERSION = "signal-acquisition-plan-v1" as const;
export const SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION_V1 = "signal-acquisition-import-v1" as const;
export const SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION = "signal-acquisition-import-v2" as const;
export const SIGNAL_DATA_SOURCE_CONNECTOR_CONTRACT_VERSION = "signal-data-source-connector-v1" as const;
export const SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION = "sentione-csv-47-v1" as const;

export const SIGNAL_ACQUISITION_SCOPES = [
  "primary_brand", "competitor", "category", "reference"
] as const;
export const SIGNAL_ACQUISITION_CADENCES = [
  "manual", "ad-hoc", "daily", "weekly", "monthly"
] as const;
export const SIGNAL_ACQUISITION_PROVIDER_SCHEMAS = {
  sentione: [SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION]
} as const;
export const SIGNAL_ACQUISITION_QUERY_EVIDENCE_CLASSES = [
  "provider_verified", "operator_attested", "unavailable"
] as const;
export const SIGNAL_ACQUISITION_QUERY_UNAVAILABLE_REASONS = [
  "historical_export", "provider_did_not_embed_query", "source_context_unavailable", "other"
] as const;

export type SignalAcquisitionScopeV1 = typeof SIGNAL_ACQUISITION_SCOPES[number];
export type SignalAcquisitionCadenceV1 = typeof SIGNAL_ACQUISITION_CADENCES[number];
export type SignalAcquisitionQueryEvidenceClassV2 =
  typeof SIGNAL_ACQUISITION_QUERY_EVIDENCE_CLASSES[number];
export type SignalAcquisitionQueryUnavailableReasonV2 =
  typeof SIGNAL_ACQUISITION_QUERY_UNAVAILABLE_REASONS[number];

export type SignalAcquisitionSlotDefinitionV1 = {
  slot_key: string;
  slot_version: number;
  scope: SignalAcquisitionScopeV1;
  entity_type: "brand" | "competitor" | "category" | "reference";
  entity_ref_hash: string;
  entity_revision_digest: string;
  desired_state: "active" | "retired";
  position: number;
  reference_decision_hash: string | null;
};

export type SignalAcquisitionQueryDefinitionV1 = {
  slot_key: string;
  query_key: string;
  query_version: number;
  source_key: string;
  provider_key: "sentione";
  provider_syntax_version: string;
  provider_schema_version: typeof SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION;
  query_hash: string;
  structured_terms: { include: string[]; exclude: string[]; aliases: string[] };
  cadence: SignalAcquisitionCadenceV1;
  default_period_start: string | null;
  default_period_end: string | null;
  timezone: string;
};

export type SignalAcquisitionPlanDefinitionV1 = {
  workspace_ref_hash: string;
  plan_version: number;
  brand_os_profile_version: number;
  brand_os_digest: string;
  identity_catalog_digest: string;
  /** Optional until an operator seals the workspace-owned Acquisition Brief. */
  acquisition_brief_digest?: string | null;
  slots: SignalAcquisitionSlotDefinitionV1[];
  queries: SignalAcquisitionQueryDefinitionV1[];
};

export type SignalAcquisitionImportSealV1 = {
  contract_version: typeof SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION_V1;
  source_key: string;
  slot_key: string;
  query_version: number;
  capture_period_start: string;
  capture_period_end: string;
  capture_timezone: string;
  plan_digest: string;
  slot_digest: string;
  query_digest: string;
  brand_os_digest: string;
  identity_catalog_digest: string;
  provider_schema_version: typeof SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION;
};

export type SignalAcquisitionImportSealV2 = {
  contract_version: typeof SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION;
  source_key: string;
  slot_key: string;
  query_evidence_class: SignalAcquisitionQueryEvidenceClassV2;
  query_version: number | null;
  query_evidence_reason: SignalAcquisitionQueryUnavailableReasonV2 | null;
  provider_execution_reference_hash: string | null;
  operator_actor_ref_hash: string;
  operator_attested_at: string;
  capture_period_start: string;
  capture_period_end: string;
  capture_timezone: string;
  plan_digest: string;
  slot_digest: string;
  query_digest: string | null;
  brand_os_digest: string;
  identity_catalog_digest: string;
  provider_schema_version: typeof SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION;
};

export type SignalProviderMentionObservationV1 = {
  provider_schema_version: typeof SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION;
  provider_header_hash: string;
  provider_record_key_hash: string;
  observation_hash: string;
  platform: string | null;
  provider_source_type: string | null;
  provider_content_type: string | null;
  language_code: string | null;
  country_code: string | null;
  published_at: string;
  provider_collected_at: string | null;
  provider_sentiment_label: string | null;
  provider_sentiment_score: number | null;
  engagement_total: number | null;
  terms: Array<{ kind: "provider-tag" | "provider-keyword"; value: string }>;
};

const SHA = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_KEY = /^source-sha256-[0-9a-f]{64}$/u;
const SLOT_KEY = /^(primary-brand|(?:competitor|category|reference)-sha256-[0-9a-f]{64})$/u;
const QUERY_KEY = /^query-sha256-[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function validateSignalAcquisitionSourceKeyV1(value: unknown): string {
  if (typeof value !== "string" || !SOURCE_KEY.test(value)) {
    throw new Error("source_key is invalid");
  }
  return value;
}

export function validateSignalConnectorSourceInputV1(value: unknown) {
  const input = strictObject(value, [
    "contract_version", "name", "provider", "source_type", "connection_method"
  ], "connector source");
  if (input.contract_version !== SIGNAL_DATA_SOURCE_CONNECTOR_CONTRACT_VERSION) {
    throw new Error("source contract_version is unsupported");
  }
  const provider = requiredString(input.provider, "provider", 1, 80).toLowerCase();
  if (provider !== "sentione") throw new Error("provider is unsupported");
  return {
    contract_version: SIGNAL_DATA_SOURCE_CONNECTOR_CONTRACT_VERSION,
    name: requiredString(input.name, "name", 1, 160),
    provider,
    source_type: canonicalKey(input.source_type, "source_type"),
    connection_method: canonicalKey(input.connection_method, "connection_method")
  };
}

export function validateSignalAcquisitionSlotKeyV1(value: unknown): string {
  if (typeof value !== "string" || !SLOT_KEY.test(value)) {
    throw new Error("slot_key is invalid");
  }
  return value;
}

export function validateSignalAcquisitionPeriodV1(value: unknown) {
  const input = strictObject(value, ["start", "end", "timezone"], "period");
  const start = requiredString(input.start, "period.start");
  const end = requiredString(input.end, "period.end");
  const timezone = validateIanaTimezone(input.timezone);
  if (!DATE.test(start) || !DATE.test(end) || start > end) throw new Error("period is invalid");
  return { start, end, timezone };
}

export function validateSignalAcquisitionQueryVersionInputV1(value: unknown) {
  const input = strictObject(value, [
    "source_key", "provider", "provider_syntax_version", "provider_schema_version",
    "query_text", "structured_terms", "cadence", "default_period"
  ], "query version");
  const sourceKey = validateSignalAcquisitionSourceKeyV1(input.source_key);
  if (input.provider !== "sentione") throw new Error("provider is unsupported");
  if (input.provider_schema_version !== SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION) {
    throw new Error("provider_schema_version is unsupported");
  }
  const cadence = requiredString(input.cadence, "cadence");
  if (!(SIGNAL_ACQUISITION_CADENCES as readonly string[]).includes(cadence)) {
    throw new Error("cadence is unsupported");
  }
  const queryText = requiredString(input.query_text, "query_text", 1, 50_000);
  const syntax = requiredString(input.provider_syntax_version, "provider_syntax_version", 1, 100);
  const terms = strictObject(input.structured_terms, ["include", "exclude", "aliases"], "structured_terms");
  const structuredTerms = {
    include: stringArray(terms.include, "include"),
    exclude: stringArray(terms.exclude, "exclude"),
    aliases: stringArray(terms.aliases, "aliases")
  };
  const period = input.default_period === null ? null : validateNullablePeriod(input.default_period);
  return {
    source_key: sourceKey,
    provider: "sentione" as const,
    provider_syntax_version: syntax,
    provider_schema_version: SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION,
    query_text: queryText,
    structured_terms: structuredTerms,
    cadence: cadence as SignalAcquisitionCadenceV1,
    default_period: period
  };
}

export function validateSignalAcquisitionImportInputV1(value: unknown) {
  const input = strictObject(value, [
    "source_key", "slot_key", "query_version", "period", "file_name", "file_size_bytes",
    "content_type", "supersedes_import_key"
  ], "acquisition import");
  const queryVersion = integer(input.query_version, "query_version", 1);
  const fileSize = integer(input.file_size_bytes, "file_size_bytes", 1);
  const fileName = requiredString(input.file_name, "file_name", 1, 255);
  const contentType = requiredString(input.content_type, "content_type", 1, 200).toLowerCase();
  if (!fileName.toLowerCase().endsWith(".csv") || fileSize>2_000_000_000
      || !["text/csv","application/csv","application/vnd.ms-excel","application/octet-stream"].includes(contentType)) {
    throw new Error("acquisition import file contract is invalid");
  }
  return {
    source_key: validateSignalAcquisitionSourceKeyV1(input.source_key),
    slot_key: validateSignalAcquisitionSlotKeyV1(input.slot_key),
    query_version: queryVersion,
    period: validateSignalAcquisitionPeriodV1(input.period),
    file_name: fileName,
    file_size_bytes: fileSize,
    content_type: contentType,
    supersedes_import_key: input.supersedes_import_key === null || input.supersedes_import_key === undefined
      ? null : requiredString(input.supersedes_import_key, "supersedes_import_key", 1, 200)
  };
}

/**
 * Public/browser contract. Provider verification is deliberately absent: only a
 * server-owned connector adapter may create that evidence class.
 */
export function validateSignalAcquisitionImportInputV2(value: unknown) {
  const input = strictObject(value, [
    "source_key", "slot_key", "query_evidence", "period", "file_name", "file_size_bytes",
    "content_type", "supersedes_import_key"
  ], "acquisition import v2");
  const evidence = strictObject(input.query_evidence, [
    "class", "query_version", "reason", "operator_confirmed"
  ], "query evidence");
  if (evidence.operator_confirmed !== true) {
    throw new Error("query evidence requires explicit operator confirmation");
  }
  let queryEvidence:
    | { class: "operator_attested";query_version: number;reason: null;operator_confirmed: true }
    | { class: "unavailable";query_version: null;reason: SignalAcquisitionQueryUnavailableReasonV2;operator_confirmed: true };
  if (evidence.class === "operator_attested") {
    if (evidence.reason !== null) throw new Error("attested query cannot have an unavailable reason");
    queryEvidence = {
      class: "operator_attested",
      query_version: integer(evidence.query_version,"query_evidence.query_version",1),
      reason: null,
      operator_confirmed: true
    };
  } else if (evidence.class === "unavailable") {
    if (evidence.query_version !== null) throw new Error("unavailable query must not reference a version");
    const reason = requiredString(evidence.reason,"query_evidence.reason");
    if (!(SIGNAL_ACQUISITION_QUERY_UNAVAILABLE_REASONS as readonly string[]).includes(reason)) {
      throw new Error("query evidence reason is unsupported");
    }
    queryEvidence = { class: "unavailable",query_version: null,
      reason: reason as SignalAcquisitionQueryUnavailableReasonV2,operator_confirmed: true };
  } else {
    throw new Error("query evidence class is not available to the browser");
  }
  const fileSize = integer(input.file_size_bytes,"file_size_bytes",1);
  const fileName = requiredString(input.file_name,"file_name",1,255);
  const contentType = requiredString(input.content_type,"content_type",1,200).toLowerCase();
  if (!fileName.toLowerCase().endsWith(".csv") || fileSize>2_000_000_000
      || !["text/csv","application/csv","application/vnd.ms-excel","application/octet-stream"].includes(contentType)) {
    throw new Error("acquisition import file contract is invalid");
  }
  return {
    source_key: validateSignalAcquisitionSourceKeyV1(input.source_key),
    slot_key: validateSignalAcquisitionSlotKeyV1(input.slot_key),
    query_evidence: queryEvidence,
    period: validateSignalAcquisitionPeriodV1(input.period),
    file_name: fileName,file_size_bytes: fileSize,content_type: contentType,
    supersedes_import_key: input.supersedes_import_key === null || input.supersedes_import_key === undefined
      ? null : requiredString(input.supersedes_import_key,"supersedes_import_key",1,200)
  };
}

export function signalAcquisitionPlanDigestV1(value: SignalAcquisitionPlanDefinitionV1) {
  const canonical = {
    ...value,
    slots: [...value.slots].sort((a, b) => a.slot_key.localeCompare(b.slot_key)
      || a.slot_version - b.slot_version),
    queries: [...value.queries].sort((a, b) => a.slot_key.localeCompare(b.slot_key)
      || a.query_key.localeCompare(b.query_key) || a.query_version - b.query_version)
  };
  validateHashes(canonical);
  validatePlanDefinition(canonical);
  return sha256(stableJson(canonical));
}

export function signalAcquisitionSlotDigestV1(value: SignalAcquisitionSlotDefinitionV1) {
  validateHashes(value);
  validateSlotDefinition(value);
  return sha256(stableJson(value));
}

export function signalAcquisitionQueryDigestV1(value: SignalAcquisitionQueryDefinitionV1) {
  validateHashes(value);
  validateQueryDefinition(value);
  return sha256(stableJson({ ...value, structured_terms: normalizeTerms(value.structured_terms) }));
}

export function signalAcquisitionImportSealDigestV1(value: SignalAcquisitionImportSealV1) {
  if (value.contract_version!==SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION_V1
      || value.provider_schema_version!==SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION
      || !Number.isSafeInteger(value.query_version) || value.query_version<1
      || !DATE.test(value.capture_period_start) || !DATE.test(value.capture_period_end)
      || value.capture_period_start>value.capture_period_end) {
    throw new Error("acquisition import seal is invalid");
  }
  validateSignalAcquisitionSourceKeyV1(value.source_key);
  validateSignalAcquisitionSlotKeyV1(value.slot_key);
  validateIanaTimezone(value.capture_timezone);
  validateHashes(value);
  return sha256(stableJson(value));
}

export function signalAcquisitionImportSealDigestV2(value: SignalAcquisitionImportSealV2) {
  if (value.contract_version!==SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION
      || value.provider_schema_version!==SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION
      || !DATE.test(value.capture_period_start) || !DATE.test(value.capture_period_end)
      || value.capture_period_start>value.capture_period_end
      || !SHA.test(value.operator_actor_ref_hash)
      || !Number.isFinite(Date.parse(value.operator_attested_at))) {
    throw new Error("acquisition import v2 seal is invalid");
  }
  validateSignalAcquisitionSourceKeyV1(value.source_key);
  validateSignalAcquisitionSlotKeyV1(value.slot_key);
  validateIanaTimezone(value.capture_timezone);
  if (value.query_evidence_class === "provider_verified") {
    if (!Number.isSafeInteger(value.query_version) || (value.query_version ?? 0)<1
        || !value.query_digest || !value.provider_execution_reference_hash
        || value.query_evidence_reason!==null) {
      throw new Error("provider-verified query evidence is incomplete");
    }
  } else if (value.query_evidence_class === "operator_attested") {
    if (!Number.isSafeInteger(value.query_version) || (value.query_version ?? 0)<1
        || !value.query_digest || value.provider_execution_reference_hash!==null
        || value.query_evidence_reason!==null) {
      throw new Error("operator-attested query evidence is invalid");
    }
  } else if (value.query_evidence_class === "unavailable") {
    if (value.query_version!==null || value.query_digest!==null
        || value.provider_execution_reference_hash!==null
        || !value.query_evidence_reason
        || !(SIGNAL_ACQUISITION_QUERY_UNAVAILABLE_REASONS as readonly string[])
          .includes(value.query_evidence_reason)) {
      throw new Error("unavailable query evidence is invalid");
    }
  } else {
    throw new Error("query evidence class is invalid");
  }
  validateHashes(value);
  return sha256(stableJson(value));
}

export function validateSignalProviderMentionObservationV1(value: unknown): SignalProviderMentionObservationV1 {
  const input=strictObject(value,[
    "provider_schema_version","provider_header_hash","provider_record_key_hash","observation_hash",
    "platform","provider_source_type","provider_content_type","language_code","country_code",
    "published_at","provider_collected_at","provider_sentiment_label","provider_sentiment_score",
    "engagement_total","terms"
  ],"provider observation");
  if(input.provider_schema_version!==SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION){
    throw new Error("provider observation schema is unsupported");
  }
  for(const key of ["provider_header_hash","provider_record_key_hash","observation_hash"]){
    if(typeof input[key]!=="string"||!SHA.test(input[key] as string))throw new Error(`${key} is invalid`);
  }
  const platform=nullableCanonicalText(input.platform,"platform",80);
  const sourceType=nullableCanonicalText(input.provider_source_type,"provider_source_type",120);
  const contentType=nullableCanonicalText(input.provider_content_type,"provider_content_type",120);
  const language=nullableCode(input.language_code,"language_code",2,35);
  const country=nullableCode(input.country_code,"country_code",2,2);
  const published=isoTimestamp(input.published_at,"published_at");
  const collected=input.provider_collected_at===null?null:isoTimestamp(input.provider_collected_at,"provider_collected_at");
  const sentiment=input.provider_sentiment_label===null?null:requiredString(input.provider_sentiment_label,
    "provider_sentiment_label",1,120);
  const score=nullableFiniteNumber(input.provider_sentiment_score,"provider_sentiment_score");
  const engagement=nullableSafeInteger(input.engagement_total,"engagement_total");
  if(!Array.isArray(input.terms)||input.terms.length>1_000)throw new Error("terms must be an array");
  const terms=input.terms.map((entry)=>{
    const term=strictObject(entry,["kind","value"],"provider observation term");
    if(term.kind!=="provider-tag"&&term.kind!=="provider-keyword")throw new Error("term kind is invalid");
    return{kind:term.kind as "provider-tag"|"provider-keyword",
      value:requiredString(term.value,"term value",1,1_000)};
  });
  return{
    provider_schema_version:SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION,
    provider_header_hash:input.provider_header_hash as string,
    provider_record_key_hash:input.provider_record_key_hash as string,
    observation_hash:input.observation_hash as string,platform,
    provider_source_type:sourceType,provider_content_type:contentType,
    language_code:language,country_code:country,published_at:published,
    provider_collected_at:collected,provider_sentiment_label:sentiment,
    provider_sentiment_score:score,engagement_total:engagement,terms
  };
}

export function signalAcquisitionOperatorPlanShapeV1(value: {
  state: string; current: unknown; draft: unknown; slots: unknown[]; blockers: string[];
}) {
  return {
    contract_version: SIGNAL_ACQUISITION_PLAN_CONTRACT_VERSION,
    state: value.state,
    current_plan: value.current,
    draft_plan: value.draft,
    slots: value.slots,
    readiness: { ready_to_promote: value.blockers.length === 0, blockers: value.blockers }
  };
}

function validateNullablePeriod(value: unknown) {
  const input = strictObject(value, ["start", "end", "timezone"], "default_period");
  const start = input.start === null ? null : requiredString(input.start, "default_period.start");
  const end = input.end === null ? null : requiredString(input.end, "default_period.end");
  if ((start === null) !== (end === null)) throw new Error("default_period bounds must both be null or dates");
  if (start !== null && (!DATE.test(start) || !DATE.test(end!) || start > end!)) {
    throw new Error("default_period is invalid");
  }
  return { start, end, timezone: validateIanaTimezone(input.timezone) };
}

function validateIanaTimezone(value: unknown) {
  const timezone = requiredString(value, "timezone", 1, 100);
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0)); }
  catch { throw new Error("timezone must be a valid IANA name"); }
  return timezone;
}

function strictObject(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !keys.includes(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(",")}`);
  return input;
}

function requiredString(value: unknown, label: string, min = 1, max = 500) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`${label} length is invalid`);
  return normalized;
}

function integer(value: unknown, label: string, min: number) {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error(`${label} must be an integer`);
  return value as number;
}

function canonicalKey(value: unknown, label: string) {
  const key = requiredString(value, label, 1, 80).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(key)) throw new Error(`${label} is invalid`);
  return key;
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 2_000) throw new Error(`${label} must be an array`);
  return [...new Set(value.map((item) => requiredString(item, label, 1, 500)))].sort();
}

function normalizeTerms(value: { include: string[]; exclude: string[]; aliases: string[] }) {
  return {
    include: [...new Set(value.include.map(normalizeTerm))].sort(),
    exclude: [...new Set(value.exclude.map(normalizeTerm))].sort(),
    aliases: [...new Set(value.aliases.map(normalizeTerm))].sort()
  };
}

function normalizeTerm(value: string) { return value.normalize("NFKC").trim().replace(/\s+/gu, " "); }

function validateHashes(value: unknown) {
  const visit = (entry: unknown, key = "") => {
    if (key.endsWith("hash") || key.endsWith("digest") || key.endsWith("ref_hash")) {
      if (entry !== null && (typeof entry !== "string" || !SHA.test(entry))) {
        throw new Error(`${key} must be a sha256 digest`);
      }
      return;
    }
    if (Array.isArray(entry)) entry.forEach((item) => visit(item));
    else if (entry && typeof entry === "object") {
      Object.entries(entry as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(value);
}

function validatePlanDefinition(value: SignalAcquisitionPlanDefinitionV1) {
  if (!Number.isSafeInteger(value.plan_version) || value.plan_version<1
      || !Number.isSafeInteger(value.brand_os_profile_version) || value.brand_os_profile_version<1) {
    throw new Error("plan definition version is invalid");
  }
  value.slots.forEach(validateSlotDefinition);
  value.queries.forEach(validateQueryDefinition);
  const slotKeys=new Set(value.slots.map((slot)=>slot.slot_key));
  if(slotKeys.size!==value.slots.length || value.queries.some((query)=>!slotKeys.has(query.slot_key))){
    throw new Error("plan definition composition is invalid");
  }
}

function validateSlotDefinition(value:SignalAcquisitionSlotDefinitionV1){
  validateSignalAcquisitionSlotKeyV1(value.slot_key);
  if(!Number.isSafeInteger(value.slot_version)||value.slot_version<1
      || !Number.isSafeInteger(value.position)||value.position<0
      || !(SIGNAL_ACQUISITION_SCOPES as readonly string[]).includes(value.scope)
      || !["brand","competitor","category","reference"].includes(value.entity_type)
      || !["active","retired"].includes(value.desired_state)
      || (value.scope==="primary_brand"&&(value.entity_type!=="brand"||value.slot_key!=="primary-brand"))
      || (value.scope!=="primary_brand"&&(value.entity_type!==value.scope||value.slot_key==="primary-brand"))
      || (value.scope==="reference"&&value.desired_state==="active"&&!value.reference_decision_hash)
      || (value.scope!=="reference"&&value.reference_decision_hash!==null)){
    throw new Error("slot definition is invalid");
  }
}

function validateQueryDefinition(value:SignalAcquisitionQueryDefinitionV1){
  validateSignalAcquisitionSourceKeyV1(value.source_key);
  validateSignalAcquisitionSlotKeyV1(value.slot_key);
  if(!QUERY_KEY.test(value.query_key)||value.provider_key!=="sentione"
      || value.provider_schema_version!==SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION
      || !Number.isSafeInteger(value.query_version)||value.query_version<1
      || !(SIGNAL_ACQUISITION_CADENCES as readonly string[]).includes(value.cadence)
      || (value.default_period_start===null)!==(value.default_period_end===null)
      || (value.default_period_start!==null&&(!DATE.test(value.default_period_start)
        || !DATE.test(value.default_period_end!)||value.default_period_start>value.default_period_end!))){
    throw new Error("query definition is invalid");
  }
  validateIanaTimezone(value.timezone);
}

function nullableCanonicalText(value:unknown,label:string,max:number){
  if(value===null)return null;
  const text=requiredString(value,label,1,max).toLowerCase();
  if(!/^[\p{L}\p{N}][\p{L}\p{N} ._+:\/-]*$/u.test(text))throw new Error(`${label} is invalid`);
  return text;
}
function nullableCode(value:unknown,label:string,min:number,max:number){
  if(value===null)return null;
  const text=requiredString(value,label,min,max);
  if(!/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8})*$/u.test(text))throw new Error(`${label} is invalid`);
  return label==="country_code"?text.toUpperCase():text.toLowerCase();
}
function isoTimestamp(value:unknown,label:string){
  const text=requiredString(value,label,1,100);
  if(!/^\d{4}-\d{2}-\d{2}T/u.test(text)||!Number.isFinite(Date.parse(text)))throw new Error(`${label} is invalid`);
  return new Date(text).toISOString();
}
function nullableFiniteNumber(value:unknown,label:string){
  if(value===null)return null;
  if(typeof value!=="number"||!Number.isFinite(value))throw new Error(`${label} is invalid`);
  return value;
}
function nullableSafeInteger(value:unknown,label:string){
  if(value===null)return null;
  if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error(`${label} is invalid`);
  return value as number;
}

function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
