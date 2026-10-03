import { createHash } from "node:crypto";
import {
  parseSignalWorkspaceClassificationOutcomeV1,
  parseSignalWorkspaceInterestDecisionOutputV1,
  signalWorkspaceEmbeddingDigestV1,
  signalWorkspaceClassificationReuseKeyV1,
  type SignalWorkspaceClassificationIdentityV1,
  type SignalWorkspaceClassificationOutcomeV1,
  type SignalWorkspaceInterestDecisionParsedV1,
  type SignalWorkspaceInterestDecisionRequestV1
} from "@noisia/query-engine";

const shaPattern = /^sha256:[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const fail = (code: string): never => { throw new Error(`workspace_interest_outcome_${code}`); };

/** The caller must verify the settled Claude receipt, registered model, effective
 * model status and policy row in DB. Their identifiers alone grant no authority. */
export type SignalWorkspaceInterestDecisionVerifiedAuthorityV1 = {
  model_version_id: string;
  model_receipt_digest: string;
  model_receipt_output_digest: string;
  approval_policy_id: string | null;
};

/** This adapter is valid only for a classification snapshot containing exactly
 * the interest in `request`; its catalog/compiler digests prove that constraint.
 * The DB must recheck the receipt and current authority before persistence. */
export function buildSignalWorkspaceInterestDecisionOutcomesV1(args: {
  request: SignalWorkspaceInterestDecisionRequestV1;
  parsed: SignalWorkspaceInterestDecisionParsedV1;
  identity: SignalWorkspaceClassificationIdentityV1;
  compiler_digest: string;
  authority: SignalWorkspaceInterestDecisionVerifiedAuthorityV1;
}): SignalWorkspaceClassificationOutcomeV1[] {
  const { request, identity, authority } = args;
  const parsed = parseSignalWorkspaceInterestDecisionOutputV1({ request, output: args.parsed.output });
  if (parsed.output_digest !== args.parsed.output_digest || !shaPattern.test(authority.model_receipt_digest)
    || authority.model_receipt_output_digest !== parsed.output_digest) return fail("model_receipt_mismatch");
  if (!uuidPattern.test(authority.model_version_id)
    || authority.approval_policy_id !== null && !uuidPattern.test(authority.approval_policy_id)) return fail("authority_invalid");
  const interest = request.interest;
  if (identity.workspace_id !== request.workspace_id || identity.context_digest !== request.context_digest
    || identity.decision_policy_digest !== request.decision_policy_digest
    || !shaPattern.test(args.compiler_digest)
    || identity.catalog_digest !== signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key,
      definition_digest: interest.definition_digest, definition_revision: interest.definition_revision }])
    || identity.compiler_digest !== signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key,
      compiler_digest: args.compiler_digest }])) return fail("classification_identity_mismatch");

  const decisions = new Map(parsed.output.decisions.map(decision => [decision.root_id, decision]));
  return request.roots.map(source => {
    const decision = decisions.get(source.root_id)!;
    const coverageHash = createHash("sha256");
    const assetHash = createHash("sha256");
    let offset = 0;
    for (let index = 0; index < source.chunks.length; index++) {
      const chunk = source.chunks[index]!;
      if (chunk.chunk_index !== index || chunk.start !== offset || chunk.end !== offset + chunk.text.length)
        return fail("chunk_coverage_incomplete");
      coverageHash.update(JSON.stringify([chunk.chunk_index, chunk.start, chunk.end, chunk.chunk_sha256]) + "\n");
      assetHash.update(chunk.text, "utf8");
      offset = chunk.end;
    }
    if (`sha256:${assetHash.digest("hex")}` !== source.asset_sha256) return fail("chunk_coverage_incomplete");
    const root = { root_id: source.root_id, fingerprint: source.fingerprint,
      correction_digest: source.correction_digest };
    const evidence_digest = signalWorkspaceEmbeddingDigestV1({ contract_version: request.contract_version,
      request_digest: request.request_digest, output_digest: parsed.output_digest, decision });
    const lineage_digest = signalWorkspaceEmbeddingDigestV1({ evidence_digest,
      model_receipt_digest: authority.model_receipt_digest, model_version_id: authority.model_version_id,
      classification_identity: identity });
    const disposition: "approved" | "rejected" = decision.verdict === "belongs" ? "approved" : "rejected";
    if (decision.verdict === "belongs" && authority.approval_policy_id === null) return fail("approval_policy_required");
    const assignments = decision.verdict === "insufficient" ? [] : [{
      taxonomy_term_id: interest.taxonomy_term_id, term_key: interest.term_key,
      definition_revision: interest.definition_revision, definition_digest: interest.definition_digest,
      disposition, resolution_method: "model" as const, model_version_id: authority.model_version_id,
      labeling_function_version_id: null, approval_policy_id: disposition === "approved" ? authority.approval_policy_id : null,
      decided_by_user_id: null, correction_operation_id: null, score: null,
      evidence_digest, lineage_digest
    }];
    const outcome: SignalWorkspaceClassificationOutcomeV1 = {
      contract_version: "signal-workspace-classification-v1", root,
      reuse_key: signalWorkspaceClassificationReuseKeyV1(identity, root),
      resolution_state: decision.verdict === "insufficient" ? "abstained" : disposition,
      has_unresolved_topics: false,
      reason_code: `interest_${decision.verdict}`,
      technical_error_code: null,
      evidence_digest: signalWorkspaceEmbeddingDigestV1({ evidence_digest, lineage_digest,
        verdict: decision.verdict, approval_policy_id: disposition === "approved" ? authority.approval_policy_id : null }),
      coverage: { expected_chunks: source.chunks.length, processed_chunks: source.chunks.length,
        chunk_coverage_digest: `sha256:${coverageHash.digest("hex")}` },
      decisions: assignments
    };
    return parseSignalWorkspaceClassificationOutcomeV1({ identity, root, outcome });
  });
}
