import {
  buildSignalWorkspaceInterestDecisionRequestFromSourcePageV1,
  type SignalWorkspaceInterestDecisionSourcePageV1,
} from "@noisia/db";
import { signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";
import { buildSignalWorkspaceInterestDecisionPageManifestV2,
  validateSignalWorkspaceInterestDecisionPageManifestV2 } from "./signal-workspace-interest-decision-batch-v2";
import { canonicalSignalInterestDecisionJsonV1 } from "./signal-workspace-interest-decision-preparation-v1";

const fail = (code: string): never => { throw new Error(`workspace_interest_preparation_v2_${code}`); };

/** Pure V2 page seal for the future versioned SQL appender. Source roots stay
 * V1 because they identify the same prepared corpus; provider bytes are V2. */
export function sealSignalWorkspaceInterestDecisionSourcePageV2(args: {
  page: SignalWorkspaceInterestDecisionSourcePageV1; decision_policy_digest: string;
}) {
  const sourceRequest = buildSignalWorkspaceInterestDecisionRequestFromSourcePageV1(
    args.page, args.decision_policy_digest);
  const { request_digest: _requestDigest, ...pageBody } = sourceRequest;
  const manifest = buildSignalWorkspaceInterestDecisionPageManifestV2({ page: pageBody,
    expected_root_ids: args.page.roots.map(root => root.root_id) });
  validateSignalWorkspaceInterestDecisionPageManifestV2(manifest);
  const { manifest_digest: _manifestDigest, ...manifestBody } = manifest;
  const canonical_page_body = canonicalSignalInterestDecisionJsonV1(pageBody);
  const canonical_manifest_body = canonicalSignalInterestDecisionJsonV1(manifestBody);
  const request_bodies = manifest.requests.map(item => {
    const { request_digest: _digest, ...requestBody } = item.request;
    return {
      request_body: canonicalSignalInterestDecisionJsonV1(requestBody),
      interest_body: canonicalSignalInterestDecisionJsonV1(item.request.interest),
      provider_core_body: canonicalSignalInterestDecisionJsonV1({
        request_digest: item.request.request_digest, configuration: manifest.configuration,
        params: item.provider_request.params,
      }),
      provider_body: JSON.stringify(item.provider_request),
    };
  });
  if (signalWorkspaceEmbeddingDigestV1(JSON.parse(canonical_page_body)) !== manifest.page_digest
    || signalWorkspaceEmbeddingDigestV1(JSON.parse(canonical_manifest_body)) !== manifest.manifest_digest
    || request_bodies.some((body, index) => {
      const item = manifest.requests[index]!;
      return signalWorkspaceEmbeddingDigestV1(JSON.parse(body.request_body)) !== item.request.request_digest
        || signalWorkspaceEmbeddingDigestV1(JSON.parse(body.provider_core_body)) !== item.provider_request_digest
        || Buffer.byteLength(body.provider_body, "utf8") !== item.provider_request_bytes;
    })) return fail("canonical_body_mismatch");
  return { manifest, canonical_manifest_body, canonical_page_body, request_bodies };
}
