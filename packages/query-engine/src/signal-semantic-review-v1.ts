import { createHash } from "node:crypto";

export const SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY = "signal-semantic-governed-identity";
export const SIGNAL_SEMANTIC_CANDIDATE_POLICY_VERSION = "1";
export const SIGNAL_SEMANTIC_CANDIDATE_MODEL_VERSION = "deterministic-governed-identity-v1";
export const SIGNAL_SEMANTIC_REVIEW_POLICY_KEY = "signal-semantic-human-review";
export const SIGNAL_SEMANTIC_REVIEW_POLICY_VERSION = "1";
export const SIGNAL_SEMANTIC_REVIEW_CURSOR_VERSION = "signal-semantic-review-v1";
export const SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME = "signal_semantic_review_projection_v1";

export type SignalSemanticScopeV1 =
  | "primary_brand"
  | "competitor"
  | "category"
  | "reference"
  | "unattributed";

export type SignalSemanticEntityTypeV1 =
  | "brand"
  | "competitor"
  | "category"
  | "reference"
  | "unattributed";

export type SignalSemanticEvidenceKindV1 =
  | "explicit_primary_brand"
  | "explicit_competitor_with_resolved_identity"
  | "explicit_category"
  | "multi_entity"
  | "human_reviewed_context"
  | "model_reviewed_context"
  | "governed_rule";

export type SignalSemanticConfidenceBandV1 = "high" | "medium" | "low";
export type SignalSemanticQueueStateV1 =
  | "candidate_pending"
  | "current_approved"
  | "current_rejected"
  | "unresolved"
  | "needs_context";

export type SignalSemanticIdentityTermKindV1 =
  | "canonical_name"
  | "alias"
  | "handle"
  | "account"
  | "domain";

export type SignalSemanticIdentityTermV1 = {
  value: string;
  kind: SignalSemanticIdentityTermKindV1;
};

export type SignalSemanticGovernedIdentityV1 = {
  scope: Exclude<SignalSemanticScopeV1, "unattributed">;
  entity_type: Exclude<SignalSemanticEntityTypeV1, "unattributed">;
  entity_id: string | null;
  entity_label: string;
  terms: SignalSemanticIdentityTermV1[];
};

export type SignalSemanticMentionSurfaceV1 = {
  kind: "text" | "title" | "author_handle" | "author_name" | "url_host" | "thread_context";
  value: string | null;
};

export type SignalSemanticCandidateInputV1 = {
  workspace_id: string;
  mention_id: string;
  brand_id: string;
  surfaces: SignalSemanticMentionSurfaceV1[];
  identities: SignalSemanticGovernedIdentityV1[];
};

export type SignalSemanticCandidateRationaleV1 = {
  code: "governed_identity_match";
  evidence_kind: SignalSemanticEvidenceKindV1;
  signal_kinds: SignalSemanticIdentityTermKindV1[];
  surface_kinds: SignalSemanticMentionSurfaceV1["kind"][];
  signal_count: number;
  signal_hashes: string[];
};

export type SignalSemanticCandidateV1 = {
  workspace_id: string;
  mention_id: string;
  scope: Exclude<SignalSemanticScopeV1, "unattributed">;
  entity_type: Exclude<SignalSemanticEntityTypeV1, "unattributed">;
  entity_id: string;
  entity_label: string;
  confidence: number;
  confidence_band: SignalSemanticConfidenceBandV1;
  evidence_kind: SignalSemanticEvidenceKindV1;
  evidence_hash: string;
  policy_key: typeof SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY;
  policy_version: typeof SIGNAL_SEMANTIC_CANDIDATE_POLICY_VERSION;
  model_version: typeof SIGNAL_SEMANTIC_CANDIDATE_MODEL_VERSION;
  idempotency_key: string;
  rationale: SignalSemanticCandidateRationaleV1;
};

export type SignalSemanticCandidateResolutionV1 = {
  mention_id: string;
  state: "candidate" | "unresolved" | "needs_context";
  candidates: SignalSemanticCandidateV1[];
  resolution_reason: "governed_identity_match" | "no_governed_identity_match" | "insufficient_context";
};

type MatchedSignal = {
  identity: SignalSemanticGovernedIdentityV1;
  termKind: SignalSemanticIdentityTermKindV1;
  surfaceKind: SignalSemanticMentionSurfaceV1["kind"];
  normalizedTerm: string;
};

type NormalizedIdentityTerm = {
  kind: SignalSemanticIdentityTermKindV1;
  normalized: string;
  original: string;
  boundaryPattern: RegExp | null;
};

type NormalizedMentionSurface = SignalSemanticMentionSurfaceV1 & {
  value: string;
  normalized: string;
  tokens: string[];
};

type PreparedIdentitySet = {
  identities: Array<{
    identity: SignalSemanticGovernedIdentityV1;
    terms: NormalizedIdentityTerm[];
  }>;
  ambiguousTerms: Set<string>;
};

const GENERIC_TERMS = new Set([
  "brand",
  "category",
  "categoria",
  "competitor",
  "competencia",
  "reference",
  "referencia",
  "mexico",
  "mx"
]);

const PREPARED_IDENTITY_CACHE = new WeakMap<
  SignalSemanticGovernedIdentityV1[],
  Map<string, PreparedIdentitySet>
>();

export function resolveSignalSemanticCandidatesV1(
  input: SignalSemanticCandidateInputV1
): SignalSemanticCandidateResolutionV1 {
  const surfaces = input.surfaces
    .map((surface) => {
      const value = cleanSemanticValue(surface.value);
      const normalized = normalizeSignalSemanticTextV1(value);
      return { ...surface, value, normalized, tokens: normalized ? normalized.split(" ") : [] };
    })
    .filter((surface): surface is NormalizedMentionSurface => Boolean(surface.value));
  if (surfaces.length === 0) {
    return {
      mention_id: input.mention_id,
      state: "needs_context",
      candidates: [],
      resolution_reason: "insufficient_context"
    };
  }

  const prepared = prepareIdentitySet(input.identities, input.brand_id);

  const matches: MatchedSignal[] = [];
  for (const item of prepared.identities) {
    for (const term of item.terms) {
      if (prepared.ambiguousTerms.has(term.normalized)) continue;
      for (const surface of surfaces) {
        if (matchesSemanticTerm(term, surface)) {
          matches.push({
            identity: item.identity,
            termKind: term.kind,
            surfaceKind: surface.kind,
            normalizedTerm: term.normalized
          });
        }
      }
    }
  }

  const byIdentity = new Map<string, MatchedSignal[]>();
  for (const match of matches) {
    const key = semanticIdentityKey(match.identity);
    const values = byIdentity.get(key) ?? [];
    values.push(match);
    byIdentity.set(key, values);
  }
  if (byIdentity.size === 0) {
    return {
      mention_id: input.mention_id,
      state: "unresolved",
      candidates: [],
      resolution_reason: "no_governed_identity_match"
    };
  }

  const multiEntity = byIdentity.size > 1;
  const candidates = [...byIdentity.values()]
    .map((identityMatches) => buildCandidate(input, identityMatches, multiEntity))
    .sort(compareSemanticCandidates);
  return {
    mention_id: input.mention_id,
    state: "candidate",
    candidates,
    resolution_reason: "governed_identity_match"
  };
}

export function signalSemanticConfidenceBandV1(confidence: number): SignalSemanticConfidenceBandV1 {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.75) return "medium";
  return "low";
}

export function signalSemanticCandidateSetDigestV1(
  resolutions: SignalSemanticCandidateResolutionV1[]
) {
  return sha256(stableJson(resolutions
    .map((resolution) => ({
      mention_id: resolution.mention_id,
      state: resolution.state,
      resolution_reason: resolution.resolution_reason,
      candidates: resolution.candidates.map((candidate) => ({
        scope: candidate.scope,
        entity_type: candidate.entity_type,
        entity_id: candidate.entity_id,
        confidence: candidate.confidence,
        evidence_kind: candidate.evidence_kind,
        evidence_hash: candidate.evidence_hash,
        idempotency_key: candidate.idempotency_key
      }))
    }))
    .sort((left, right) => left.mention_id.localeCompare(right.mention_id))));
}

export function signalSemanticStableHashV1(value: unknown) {
  return sha256(stableJson(value));
}

export function normalizeSignalSemanticTextV1(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9@._-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildCandidate(
  input: SignalSemanticCandidateInputV1,
  matches: MatchedSignal[],
  multiEntity: boolean
): SignalSemanticCandidateV1 {
  const identity = matches[0]!.identity;
  if (!identity.entity_id) {
    throw new Error("Semantic candidate identity must have a governed entity id.");
  }
  const evidenceKind = multiEntity
    ? "multi_entity"
    : identity.scope === "primary_brand"
      ? "explicit_primary_brand"
      : identity.scope === "competitor"
        ? "explicit_competitor_with_resolved_identity"
        : identity.scope === "category"
          ? "explicit_category"
          : "governed_rule";
  const signalKinds = unique(matches.map((match) => match.termKind)).sort();
  const surfaceKinds = unique(matches.map((match) => match.surfaceKind)).sort();
  const signalHashes = unique(matches.map((match) => sha256(match.normalizedTerm))).sort();
  const confidence = strongestConfidence(matches);
  const evidenceHash = sha256(stableJson({
    policy_key: SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY,
    policy_version: SIGNAL_SEMANTIC_CANDIDATE_POLICY_VERSION,
    workspace_id: input.workspace_id,
    mention_id: input.mention_id,
    scope: identity.scope,
    entity_type: identity.entity_type,
    entity_id: identity.entity_id,
    evidence_kind: evidenceKind,
    signal_kinds: signalKinds,
    surface_kinds: surfaceKinds,
    signal_hashes: signalHashes
  }));
  const idempotencyKey = sha256(stableJson({
    policy_key: SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY,
    policy_version: SIGNAL_SEMANTIC_CANDIDATE_POLICY_VERSION,
    workspace_id: input.workspace_id,
    mention_id: input.mention_id,
    scope: identity.scope,
    entity_type: identity.entity_type,
    entity_id: identity.entity_id,
    evidence_hash: evidenceHash
  }));
  return {
    workspace_id: input.workspace_id,
    mention_id: input.mention_id,
    scope: identity.scope,
    entity_type: identity.entity_type,
    entity_id: identity.entity_id,
    entity_label: identity.entity_label,
    confidence,
    confidence_band: signalSemanticConfidenceBandV1(confidence),
    evidence_kind: evidenceKind,
    evidence_hash: evidenceHash,
    policy_key: SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY,
    policy_version: SIGNAL_SEMANTIC_CANDIDATE_POLICY_VERSION,
    model_version: SIGNAL_SEMANTIC_CANDIDATE_MODEL_VERSION,
    idempotency_key: idempotencyKey,
    rationale: {
      code: "governed_identity_match",
      evidence_kind: evidenceKind,
      signal_kinds: signalKinds,
      surface_kinds: surfaceKinds,
      signal_count: signalHashes.length,
      signal_hashes: signalHashes
    }
  };
}

function isGovernedIdentityEligibleForProposal(
  identity: SignalSemanticGovernedIdentityV1,
  brandId: string
) {
  if (!identity.entity_id) return false;
  if (identity.scope === "primary_brand") {
    return identity.entity_type === "brand" && identity.entity_id === brandId;
  }
  if (identity.scope === "competitor") return identity.entity_type === "competitor";
  if (identity.scope === "category") return identity.entity_type === "category";
  return identity.scope === "reference" && identity.entity_type === "reference";
}

function prepareIdentitySet(
  identities: SignalSemanticGovernedIdentityV1[],
  brandId: string
): PreparedIdentitySet {
  const byBrand = PREPARED_IDENTITY_CACHE.get(identities) ?? new Map<string, PreparedIdentitySet>();
  const cached = byBrand.get(brandId);
  if (cached) return cached;
  const normalizedIdentities = identities
    .filter((identity) => isGovernedIdentityEligibleForProposal(identity, brandId))
    .map((identity) => ({ identity, terms: uniqueIdentityTerms(identity.terms) }));
  const ambiguousTerms = new Set<string>();
  const termOwners = new Map<string, Set<string>>();
  for (const item of normalizedIdentities) {
    for (const term of item.terms) {
      const key = semanticIdentityKey(item.identity);
      const owners = termOwners.get(term.normalized) ?? new Set<string>();
      owners.add(key);
      termOwners.set(term.normalized, owners);
      if (owners.size > 1) ambiguousTerms.add(term.normalized);
    }
  }
  const prepared = { identities: normalizedIdentities, ambiguousTerms };
  byBrand.set(brandId, prepared);
  PREPARED_IDENTITY_CACHE.set(identities, byBrand);
  return prepared;
}

function uniqueIdentityTerms(terms: SignalSemanticIdentityTermV1[]) {
  const seen = new Set<string>();
  const values: NormalizedIdentityTerm[] = [];
  for (const term of terms) {
    const original = cleanSemanticValue(term.value);
    const normalized = normalizeIdentityTerm(original, term.kind);
    if (!normalized || normalized.length < 3 || GENERIC_TERMS.has(normalized)) continue;
    const key = `${term.kind}:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const escaped = escapeRegExp(normalized).replace(/\\ /gu, "\\s+");
    values.push({
      kind: term.kind,
      normalized,
      original,
      boundaryPattern: term.kind === "canonical_name" || term.kind === "alias"
        ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "u")
        : null
    });
  }
  return values.sort((left, right) => `${left.kind}:${left.normalized}`.localeCompare(`${right.kind}:${right.normalized}`));
}

function matchesSemanticTerm(
  term: NormalizedIdentityTerm,
  surface: NormalizedMentionSurface
) {
  const normalizedSurface = surface.normalized;
  if (!normalizedSurface) return false;
  if (term.kind === "domain") {
    if (surface.kind !== "url_host") return false;
    const host = normalizedSurface.replace(/^www\./u, "");
    return host === term.normalized || host.endsWith(`.${term.normalized}`);
  }
  if (term.kind === "handle") {
    const handle = term.normalized.replace(/^@/u, "").replace(/[\s._-]+/gu, "");
    if (surface.kind === "author_handle") {
      return normalizedSurface.replace(/^@/u, "").replace(/[\s._-]+/gu, "") === handle;
    }
    return surface.kind === "text" || surface.kind === "title" || surface.kind === "thread_context"
      ? surface.tokens.some((token) => (
          token.startsWith("@") && token.slice(1).replace(/[._-]+/gu, "") === handle
        ))
      : false;
  }
  if (term.kind === "account") {
    return (surface.kind === "author_handle" || surface.kind === "author_name")
      && normalizedSurface === term.normalized;
  }
  if (!["text", "title", "thread_context", "author_name"].includes(surface.kind)) return false;
  return term.boundaryPattern?.test(normalizedSurface) ?? false;
}

function strongestConfidence(matches: MatchedSignal[]) {
  const scores = matches.map((match) => {
    if (match.termKind === "handle" || match.termKind === "domain" || match.termKind === "account") return 0.99;
    if (match.termKind === "canonical_name") return match.identity.scope === "category" ? 0.94 : 0.97;
    return match.identity.scope === "category" ? 0.9 : 0.94;
  });
  return Math.max(...scores);
}

function normalizeIdentityTerm(value: string, kind: SignalSemanticIdentityTermKindV1) {
  const normalized = normalizeSignalSemanticTextV1(value);
  if (kind === "domain") return normalized.replace(/^https?:\/\//u, "").replace(/^www\./u, "").split("/")[0] ?? "";
  if (kind === "handle") return `@${normalized.replace(/^@/u, "")}`;
  return normalized;
}

function semanticIdentityKey(identity: SignalSemanticGovernedIdentityV1) {
  return `${identity.scope}:${identity.entity_type}:${identity.entity_id ?? "none"}`;
}

function compareSemanticCandidates(left: SignalSemanticCandidateV1, right: SignalSemanticCandidateV1) {
  return `${left.scope}:${left.entity_type}:${left.entity_id}`.localeCompare(
    `${right.scope}:${right.entity_type}:${right.entity_id}`
  );
}

function cleanSemanticValue(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
