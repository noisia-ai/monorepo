import { createHash } from "node:crypto";

export const SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION =
  "signal-topics-narratives-v1" as const;
export const SIGNAL_TAXONOMY_ENRICHMENT_JOB_NAME =
  "signal.taxonomy-enrichment.v1" as const;
export const SIGNAL_TAXONOMY_ENRICHMENT_MAX_BATCH_SIZE = 50;
export const SIGNAL_TAXONOMY_ACCEPTANCE_POLICY_V1 = {
  version: "signal-taxonomy-acceptance-v1",
  pending_min_score: 0.65,
  pending_confidence: ["medium", "high"]
} as const;

export const SIGNAL_TAXONOMY_KINDS = ["topic", "narrative"] as const;
export type SignalTaxonomyKindV1 = (typeof SIGNAL_TAXONOMY_KINDS)[number];

export type SignalTaxonomyContextRefV1 = {
  source_type:
    | "brand_os_objective"
    | "brand_os_brief"
    | "brand_os_audience"
    | "knowledge_assertion"
    | "knowledge_chunk"
    | "mention_sample";
  source_id: string;
  version: string;
  content_hash: string;
};

export type SignalTaxonomyCandidateV1 = {
  term_key: string;
  label: string;
  definition: string;
  statement: string | null;
  examples: string[];
  exclusions: string[];
};

export type SignalTaxonomyProposalV1 = {
  contract_version: typeof SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION;
  kind: SignalTaxonomyKindV1;
  terms: SignalTaxonomyCandidateV1[];
  context_refs: SignalTaxonomyContextRefV1[];
  context_hash: string;
  provider: "anthropic" | "operator";
  model_version: string;
  prompt_hash: string;
};

export type SignalTaxonomyAssignmentV1 = {
  term_key: string;
  score: number;
  confidence: "low" | "medium" | "high";
  evidence: Array<{
    quote: string;
    start: number | null;
    end: number | null;
  }>;
};

export type SignalTaxonomyAssignmentDispositionV1 = "pending" | "rejected";

export type SignalTaxonomyMentionClassificationV1 = {
  mention_id: string;
  assignments: SignalTaxonomyAssignmentV1[];
  unclassified_reason: string | null;
};

export type SignalTaxonomyEnrichmentJobDataV1 = {
  contract_version: typeof SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION;
  run_id: string;
  workspace_id: string;
  study_corpus_id: string;
  profile_id: string;
  kind: SignalTaxonomyKindV1;
  corpus_revision: number;
  budget_cap_usd: number;
};

export type SignalTaxonomyCoverageV1 = {
  included_mentions: number;
  classified_mentions: number;
  unclassified_mentions: number;
  tag_assertions: number;
  pending_mentions: number;
  rejected_mentions: number;
  coverage: number | null;
  quality_state: "ready" | "partial" | "not_available" | "failed";
  limitations: string[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TERM_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const FORBIDDEN_METHOD_TERMS = new Set([
  "trigger",
  "triggers",
  "barrier",
  "barriers",
  "decision_layer",
  "decision_layers",
  "tb_layer",
  "observed_signal",
  "observed_signals",
  "finding",
  "findings",
  "opportunity",
  "opportunities",
  "recommendation",
  "recommendations"
]);

export function normalizeSignalTaxonomyProposalV1(
  input: unknown
): SignalTaxonomyProposalV1 {
  const value = objectValue(input, "taxonomy proposal");
  const kind = taxonomyKind(value.kind);
  const provider = value.provider === "anthropic" ? "anthropic" : value.provider === "operator"
    ? "operator"
    : invalid("provider must be anthropic or operator.");
  const rawTerms = arrayValue(value.terms, "terms");
  if (rawTerms.length === 0 || rawTerms.length > 100) {
    throw new Error("A taxonomy proposal requires between 1 and 100 terms.");
  }
  const terms = rawTerms.map((term) => normalizeCandidate(term, kind));
  const termKeys = new Set(terms.map((term) => term.term_key));
  if (termKeys.size !== terms.length) {
    throw new Error("Taxonomy proposal term_key values must be unique.");
  }
  const contextRefs = arrayValue(value.context_refs, "context_refs")
    .map(normalizeContextRef)
    .sort(compareContextRefs);
  if (contextRefs.length === 0) {
    throw new Error("A taxonomy proposal requires versioned context_refs.");
  }
  const contextHash = signalTaxonomyContextHashV1(contextRefs);
  if (value.context_hash != null && stringValue(value.context_hash, "context_hash") !== contextHash) {
    throw new Error("context_hash does not match the canonical context refs.");
  }
  return {
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
    kind,
    terms: terms.sort((left, right) => left.term_key.localeCompare(right.term_key)),
    context_refs: contextRefs,
    context_hash: contextHash,
    provider,
    model_version: boundedText(value.model_version, "model_version", 160),
    prompt_hash: hashValue(value.prompt_hash, "prompt_hash")
  };
}

export function signalTaxonomyContextHashV1(
  refs: SignalTaxonomyContextRefV1[]
) {
  const canonical = refs
    .map(normalizeContextRef)
    .sort(compareContextRefs)
    .map((ref) => [
      ref.source_type,
      ref.source_id,
      ref.version,
      ref.content_hash
    ]);
  return sha256(JSON.stringify(canonical));
}

export function signalTaxonomyProfileKeyV1(input: {
  workspace_id: string;
  kind: SignalTaxonomyKindV1;
  version: number;
}) {
  const workspaceId = uuidValue(input.workspace_id, "workspace_id");
  const version = positiveInteger(input.version, "version");
  return `signal_${workspaceId.replaceAll("-", "")}_${input.kind}_v${version}`;
}

export function signalTaxonomyEnrichmentIdempotencyKeyV1(input: {
  workspace_id: string;
  study_corpus_id: string;
  profile_id: string;
  corpus_revision: number;
}) {
  return sha256(JSON.stringify({
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
    workspace_id: uuidValue(input.workspace_id, "workspace_id"),
    study_corpus_id: uuidValue(input.study_corpus_id, "study_corpus_id"),
    profile_id: uuidValue(input.profile_id, "profile_id"),
    corpus_revision: nonnegativeInteger(input.corpus_revision, "corpus_revision")
  }));
}

export function normalizeSignalTaxonomyClassificationV1(
  input: unknown,
  allowedTermKeys: string[]
): SignalTaxonomyMentionClassificationV1 {
  const value = objectValue(input, "mention classification");
  const allowed = new Set(allowedTermKeys);
  const assignments = arrayValue(value.assignments ?? [], "assignments")
    .map((assignment) => {
      const item = objectValue(assignment, "assignment");
      const termKey = termKeyValue(item.term_key);
      if (!allowed.has(termKey)) {
        throw new Error(`Unknown taxonomy term in classification: ${termKey}`);
      }
      const score = numberValue(item.score, "score");
      if (score < 0 || score > 1) throw new Error("score must be between 0 and 1.");
      const confidence = item.confidence;
      if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
        throw new Error("confidence must be low, medium or high.");
      }
      const evidence = arrayValue(item.evidence, "evidence").map((rawEvidence) => {
        const evidenceItem = objectValue(rawEvidence, "evidence item");
        return {
          quote: boundedText(evidenceItem.quote, "evidence.quote", 500),
          start: nullableNonnegativeInteger(evidenceItem.start, "evidence.start"),
          end: nullableNonnegativeInteger(evidenceItem.end, "evidence.end")
        };
      });
      if (evidence.length === 0) {
        throw new Error("Every taxonomy assignment requires textual evidence.");
      }
      return {
        term_key: termKey,
        score,
        confidence: confidence as SignalTaxonomyAssignmentV1["confidence"],
        evidence
      };
    })
    .sort((left, right) => left.term_key.localeCompare(right.term_key));
  if (new Set(assignments.map((assignment) => assignment.term_key)).size !== assignments.length) {
    throw new Error("A mention classification cannot repeat a term.");
  }
  const unclassifiedReason = value.unclassified_reason == null
    ? null
    : boundedText(value.unclassified_reason, "unclassified_reason", 500);
  if (assignments.length === 0 && !unclassifiedReason) {
    throw new Error("An unclassified mention requires unclassified_reason.");
  }
  return {
    mention_id: uuidValue(value.mention_id, "mention_id"),
    assignments,
    unclassified_reason: unclassifiedReason
  };
}

export function signalTaxonomyCoverageV1(input: {
  included_mentions: number;
  classified_mentions: number;
  tag_assertions: number;
  pending_mentions?: number;
  rejected_mentions?: number;
  failed?: boolean;
}): SignalTaxonomyCoverageV1 {
  const included = nonnegativeInteger(input.included_mentions, "included_mentions");
  const classified = nonnegativeInteger(input.classified_mentions, "classified_mentions");
  const assertions = nonnegativeInteger(input.tag_assertions, "tag_assertions");
  const pending = nonnegativeInteger(input.pending_mentions ?? 0, "pending_mentions");
  const rejected = nonnegativeInteger(input.rejected_mentions ?? 0, "rejected_mentions");
  if (classified > included) throw new Error("classified_mentions cannot exceed included_mentions.");
  const limitations: string[] = [];
  if (pending > 0) limitations.push("classification_review_pending");
  if (classified < included) limitations.push("classification_coverage_incomplete");
  if (input.failed) limitations.push("classification_run_failed");
  const state = input.failed
    ? "failed"
    : included === 0
      ? "not_available"
      : limitations.length > 0
        ? "partial"
        : "ready";
  return {
    included_mentions: included,
    classified_mentions: classified,
    unclassified_mentions: included - classified,
    tag_assertions: assertions,
    pending_mentions: pending,
    rejected_mentions: rejected,
    coverage: included > 0 ? classified / included : null,
    quality_state: state,
    limitations
  };
}

export function signalTaxonomyAssignmentDispositionV1(
  assignment: SignalTaxonomyAssignmentV1
): SignalTaxonomyAssignmentDispositionV1 {
  if (assignment.evidence.length === 0) return "rejected";
  const confidenceEligible = assignment.confidence === "medium"
    || assignment.confidence === "high";
  return assignment.score >= SIGNAL_TAXONOMY_ACCEPTANCE_POLICY_V1.pending_min_score
    && confidenceEligible
    ? "pending"
    : "rejected";
}

function normalizeCandidate(
  input: unknown,
  kind: SignalTaxonomyKindV1
): SignalTaxonomyCandidateV1 {
  const value = objectValue(input, "taxonomy term");
  const termKey = termKeyValue(value.term_key);
  const normalizedLabel = boundedText(value.label, "label", 160);
  if (
    FORBIDDEN_METHOD_TERMS.has(termKey)
    || FORBIDDEN_METHOD_TERMS.has(normalizedLabel.toLowerCase().replaceAll(" ", "_"))
  ) {
    throw new Error("T&B codings, observed signals and editorial findings cannot be taxonomy terms.");
  }
  const statement = value.statement == null ? null : boundedText(value.statement, "statement", 300);
  if (kind === "narrative" && (!statement || !statement.includes(" "))) {
    throw new Error("Narrative candidates require an explicit propositional statement.");
  }
  if (kind === "topic" && statement) {
    throw new Error("Topic candidates cannot carry a narrative statement.");
  }
  const examples = normalizedTextArray(value.examples, "examples", 20);
  if (examples.length === 0) throw new Error("Every taxonomy term requires at least one example.");
  return {
    term_key: termKey,
    label: normalizedLabel,
    definition: boundedText(value.definition, "definition", 800),
    statement,
    examples,
    exclusions: normalizedTextArray(value.exclusions ?? [], "exclusions", 20)
  };
}

function normalizeContextRef(input: unknown): SignalTaxonomyContextRefV1 {
  const value = objectValue(input, "context ref");
  const sourceType = value.source_type;
  const validSourceTypes = new Set([
    "brand_os_objective",
    "brand_os_brief",
    "brand_os_audience",
    "knowledge_assertion",
    "knowledge_chunk",
    "mention_sample"
  ]);
  if (typeof sourceType !== "string" || !validSourceTypes.has(sourceType)) {
    throw new Error("Unsupported taxonomy context source_type.");
  }
  return {
    source_type: sourceType as SignalTaxonomyContextRefV1["source_type"],
    source_id: uuidValue(value.source_id, "context_ref.source_id"),
    version: boundedText(value.version, "context_ref.version", 120),
    content_hash: hashValue(value.content_hash, "context_ref.content_hash")
  };
}

function compareContextRefs(
  left: SignalTaxonomyContextRefV1,
  right: SignalTaxonomyContextRefV1
) {
  return [
    left.source_type.localeCompare(right.source_type),
    left.source_id.localeCompare(right.source_id),
    left.version.localeCompare(right.version),
    left.content_hash.localeCompare(right.content_hash)
  ].find((value) => value !== 0) ?? 0;
}

function objectValue(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${field} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function arrayValue(input: unknown, field: string): unknown[] {
  if (!Array.isArray(input)) throw new Error(`${field} must be an array.`);
  return input;
}

function stringValue(input: unknown, field: string) {
  if (typeof input !== "string") throw new Error(`${field} must be a string.`);
  return input;
}

function boundedText(input: unknown, field: string, maxLength: number) {
  const value = stringValue(input, field).normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!value || value.length > maxLength) {
    throw new Error(`${field} must contain between 1 and ${maxLength} characters.`);
  }
  return value;
}

function normalizedTextArray(input: unknown, field: string, maxItems: number) {
  const values = arrayValue(input, field).map((value) => boundedText(value, field, 500));
  if (values.length > maxItems) throw new Error(`${field} cannot exceed ${maxItems} items.`);
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function taxonomyKind(input: unknown): SignalTaxonomyKindV1 {
  if (input !== "topic" && input !== "narrative") {
    throw new Error("kind must be topic or narrative.");
  }
  return input;
}

function termKeyValue(input: unknown) {
  const value = stringValue(input, "term_key").normalize("NFC").trim().toLowerCase();
  if (!TERM_KEY_PATTERN.test(value)) throw new Error("term_key must be canonical snake_case.");
  return value;
}

function hashValue(input: unknown, field: string) {
  const value = stringValue(input, field);
  if (!HASH_PATTERN.test(value)) throw new Error(`${field} must be a sha256 hash.`);
  return value;
}

function uuidValue(input: unknown, field: string) {
  const value = stringValue(input, field).toLowerCase();
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
  return value;
}

function numberValue(input: unknown, field: string) {
  const value = typeof input === "number" ? input : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return value;
}

function positiveInteger(input: unknown, field: string) {
  const value = nonnegativeInteger(input, field);
  if (value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

function nonnegativeInteger(input: unknown, field: string) {
  const value = numberValue(input, field);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer.`);
  return value;
}

function nullableNonnegativeInteger(input: unknown, field: string) {
  if (input == null) return null;
  return nonnegativeInteger(input, field);
}

function invalid(message: string): never {
  throw new Error(message);
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
