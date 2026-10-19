import {
  SIGNAL_SEMANTIC_CONTEXT_EVIDENCE_RELATIONS,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ELEMENT_KINDS,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RELATION_KINDS,
  signalSemanticContextProposalDigestV1
} from "@noisia/query-engine";

export const SIGNAL_SEMANTIC_CONTEXT_AUTOMATIC_POLICY_VERSION =
  "signal-semantic-context-automatic-disposition-v1" as const;

export const SIGNAL_SEMANTIC_CONTEXT_AUTOMATIC_AUDIT_VERSION =
  "signal-semantic-context-automatic-audit-v1" as const;

const KEY_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const SOURCE_TYPES = new Set([
  "brand_os_profile", "brand_os_product", "brand_os_competitor", "brand_os_seed_term",
  "knowledge_source", "knowledge_chunk", "knowledge_assertion"
]);
const ELEMENT_KINDS = new Set<string>(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ELEMENT_KINDS);
const RELATION_KINDS = new Set<string>(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RELATION_KINDS);
const EVIDENCE_RELATIONS = new Set<string>(SIGNAL_SEMANTIC_CONTEXT_EVIDENCE_RELATIONS);
const SCOPES = new Set(["primary_brand", "category", "competitor", "reference"]);
const ENTITY_TYPES = new Set(["brand", "competitor", "product", "category"]);

export type SignalSemanticContextAutomaticPolicyProposalV1 = {
  element_key: string;
  element_kind: string;
  canonical_key: string;
  display_text: string;
  scope: string | null;
  entity_type: string | null;
  entity_id: string | null;
  locale: string | null;
  relation_kind: string | null;
  relation_target_key: string | null;
  confidence: number | null;
  origin_kind: "provider_proposal" | "server_projection";
  source_refs: Array<{ source_type: string; source_id: string; relation_type: string }>;
};

export type SignalSemanticContextAutomaticPolicyReasonV1 =
  | "evidence_missing"
  | "evidence_invalid"
  | "evidence_limited"
  | "evidence_contradictory"
  | "semantic_collision"
  | "relation_target_unresolved"
  | "locale_required"
  | "locale_not_in_parent_envelope"
  | "locale_specific_requires_operator_review";

export type SignalSemanticContextAutomaticPolicyDecisionV1 = {
  element_key: string;
  outcome: "ready" | "exception";
  reasons: SignalSemanticContextAutomaticPolicyReasonV1[];
  applicability: {
    state: "workspace_inherited" | "explicit_locale" | "unresolved";
    locale: string | null;
    locales: string[];
    markets: string[];
  };
  evidence_digest: string;
  parent_authority_digest: string;
  decision_digest: string;
};

export type SignalSemanticContextAutomaticPolicyInputV1 = {
  generation_key: string;
  parent_authority: {
    valid: boolean;
    parent_authority_digest: string;
    locales: string[];
    markets: string[];
  };
  proposals: SignalSemanticContextAutomaticPolicyProposalV1[];
  current_leaves: Array<{
    element_key: string;
    element_kind: string;
    canonical_key: string;
    locale: string | null;
    disposition: string;
    lifecycle_state: string;
  }>;
};

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalRefs(proposal: SignalSemanticContextAutomaticPolicyProposalV1) {
  return [...proposal.source_refs]
    .sort((left, right) => compareUtf8(left.source_type, right.source_type)
      || compareUtf8(left.source_id, right.source_id)
      || compareUtf8(left.relation_type, right.relation_type));
}

function semanticKey(proposal: Pick<SignalSemanticContextAutomaticPolicyProposalV1,
  "element_kind" | "canonical_key" | "locale">) {
  return `${proposal.element_kind}\u001f${proposal.canonical_key}\u001f${proposal.locale ?? ""}`;
}

function schemaValid(proposal: SignalSemanticContextAutomaticPolicyProposalV1) {
  if (!KEY_PATTERN.test(proposal.element_key) || !KEY_PATTERN.test(proposal.canonical_key)
      || !ELEMENT_KINDS.has(proposal.element_kind) || proposal.display_text.trim().length === 0
      || proposal.display_text.length > 500 || (proposal.scope !== null && !SCOPES.has(proposal.scope))
      || (proposal.locale !== null && !LOCALE_PATTERN.test(proposal.locale))
      || (proposal.entity_type === null) !== (proposal.entity_id === null)
      || (proposal.entity_type !== null && !ENTITY_TYPES.has(proposal.entity_type))
      || proposal.confidence !== null && (!Number.isFinite(proposal.confidence)
        || proposal.confidence < 0 || proposal.confidence > 1)) return false;
  if (proposal.element_kind === "typed_relation") {
    return proposal.relation_kind !== null && RELATION_KINDS.has(proposal.relation_kind)
      && proposal.relation_target_key !== null && KEY_PATTERN.test(proposal.relation_target_key);
  }
  return proposal.relation_kind === null && proposal.relation_target_key === null;
}

/**
 * Pure, deterministic policy. It consumes only already-resolved server authority; it does
 * not inspect provider prose or confidence when deciding readiness.
 */
export function evaluateSignalSemanticContextAutomaticPolicyV1(
  input: SignalSemanticContextAutomaticPolicyInputV1
) {
  if (!input.parent_authority.valid
      || !/^sha256:[0-9a-f]{64}$/u.test(input.parent_authority.parent_authority_digest)) {
    throw new Error("semantic_context_parent_authority_invalid");
  }
  const proposals = [...input.proposals].sort((left, right) => compareUtf8(left.element_key, right.element_key));
  const semanticCounts = new Map<string, number>();
  for (const proposal of proposals) {
    const key = semanticKey(proposal);
    semanticCounts.set(key, (semanticCounts.get(key) ?? 0) + 1);
  }
  for (const leaf of input.current_leaves) {
    if (leaf.lifecycle_state === "active" && !["rejected", "merged", "archived"].includes(leaf.disposition)) {
      const key = semanticKey(leaf);
      semanticCounts.set(key, (semanticCounts.get(key) ?? 0) + 1);
    }
  }

  const base = new Map<string, { reasons: SignalSemanticContextAutomaticPolicyReasonV1[];
    evidence_digest: string; applicability: SignalSemanticContextAutomaticPolicyDecisionV1["applicability"] }>();
  for (const proposal of proposals) {
    const reasons: SignalSemanticContextAutomaticPolicyReasonV1[] = [];
    const refs = canonicalRefs(proposal);
    const evidenceDigest = signalSemanticContextProposalDigestV1(refs);
    if (!schemaValid(proposal)) throw new Error("semantic_context_proposal_schema_invalid");
    if (refs.length === 0) reasons.push("evidence_missing");
    else if (refs.some((ref) => !SOURCE_TYPES.has(ref.source_type)
        || !EVIDENCE_RELATIONS.has(ref.relation_type))) reasons.push("evidence_invalid");
    if (refs.some((ref) => ref.relation_type === "limits")) reasons.push("evidence_limited");
    if (refs.some((ref) => ref.relation_type === "contradicts")) reasons.push("evidence_contradictory");
    if ((semanticCounts.get(semanticKey(proposal)) ?? 0) > 1) reasons.push("semantic_collision");
    let applicability: SignalSemanticContextAutomaticPolicyDecisionV1["applicability"];
    if (proposal.element_kind === "locale_variant") {
      if (proposal.locale === null) {
        reasons.push("locale_required");
        applicability = { state: "unresolved", locale: null, locales: [], markets: input.parent_authority.markets };
      } else if (!input.parent_authority.locales.includes(proposal.locale)) {
        reasons.push("locale_not_in_parent_envelope");
        applicability = { state: "unresolved", locale: proposal.locale, locales: [], markets: input.parent_authority.markets };
      } else {
        applicability = { state: "explicit_locale", locale: proposal.locale,
          locales: [proposal.locale], markets: input.parent_authority.markets };
      }
    } else if (proposal.locale !== null) {
      reasons.push("locale_specific_requires_operator_review");
      applicability = { state: "unresolved", locale: proposal.locale, locales: [], markets: input.parent_authority.markets };
    } else {
      applicability = { state: "workspace_inherited", locale: null,
        locales: input.parent_authority.locales, markets: input.parent_authority.markets };
    }
    base.set(proposal.element_key, { reasons: [...new Set(reasons)].sort(compareUtf8),
      evidence_digest: evidenceDigest, applicability });
  }

  // Resolve relation readiness to a fixed point. A relation cannot make itself (or a
  // cycle) ready merely because every node passed the non-relational checks.
  const currentTargets = new Set(input.current_leaves.filter((leaf) => leaf.lifecycle_state === "active"
    && leaf.disposition === "approved").map((leaf) => leaf.element_key));
  const readyTargets = new Set(currentTargets);
  for (const proposal of proposals) {
    if (proposal.element_kind !== "typed_relation"
        && (base.get(proposal.element_key)?.reasons.length ?? 1) === 0) {
      readyTargets.add(proposal.element_key);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const proposal of proposals) {
      if (proposal.element_kind !== "typed_relation" || readyTargets.has(proposal.element_key)
          || (base.get(proposal.element_key)?.reasons.length ?? 1) !== 0
          || proposal.relation_target_key === proposal.element_key
          || !proposal.relation_target_key || !readyTargets.has(proposal.relation_target_key)) continue;
      readyTargets.add(proposal.element_key);
      changed = true;
    }
  }
  for (const proposal of proposals) {
    if (proposal.element_kind !== "typed_relation") continue;
    if (!readyTargets.has(proposal.element_key)) {
      base.get(proposal.element_key)?.reasons.push("relation_target_unresolved");
    }
  }

  const decisions = proposals.map<SignalSemanticContextAutomaticPolicyDecisionV1>((proposal) => {
    const evaluated = base.get(proposal.element_key)!;
    const reasons = [...new Set(evaluated.reasons)].sort(compareUtf8);
    const outcome = reasons.length === 0 ? "ready" as const : "exception" as const;
    const decision = {
      contract_version: SIGNAL_SEMANTIC_CONTEXT_AUTOMATIC_POLICY_VERSION,
      generation_key: input.generation_key,
      element_key: proposal.element_key,
      outcome,
      reasons,
      applicability: evaluated.applicability,
      evidence_digest: evaluated.evidence_digest,
      parent_authority_digest: input.parent_authority.parent_authority_digest
    };
    return { element_key: proposal.element_key, outcome, reasons,
      applicability: evaluated.applicability, evidence_digest: evaluated.evidence_digest,
      parent_authority_digest: input.parent_authority.parent_authority_digest,
      decision_digest: signalSemanticContextProposalDigestV1(decision) };
  });
  const readyCount = decisions.filter((decision) => decision.outcome === "ready").length;
  return {
    contract_version: SIGNAL_SEMANTIC_CONTEXT_AUTOMATIC_POLICY_VERSION,
    parent_authority_digest: input.parent_authority.parent_authority_digest,
    decisions,
    ready_count: readyCount,
    exception_count: decisions.length - readyCount,
    policy_digest: signalSemanticContextProposalDigestV1({
      contract_version: SIGNAL_SEMANTIC_CONTEXT_AUTOMATIC_POLICY_VERSION,
      generation_key: input.generation_key,
      parent_authority_digest: input.parent_authority.parent_authority_digest,
      decisions: decisions.map((decision) => ({ element_key: decision.element_key,
        decision_digest: decision.decision_digest }))
    })
  };
}
