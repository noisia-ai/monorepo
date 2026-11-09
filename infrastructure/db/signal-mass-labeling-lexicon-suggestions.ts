import type { Pool } from "pg";
import { signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { loadMassLabelingStudyPolicyWithClientV1 } from "./signal-mass-labeling-study-policy";
import { SignalLabelingError } from "./signal-labeling-runs";

export function massLabelingLexiconDigestV1(policy: { category: string; lexicon_terms: string[] }) {
  return signalWorkspaceEmbeddingDigestV1({ category: policy.category, terms: [...policy.lexicon_terms].sort() });
}

/** A dismissal is idempotent and remains applicable while the category and terms are unchanged. */
export async function dismissMassLabelingLexiconSuggestionV1(args: {
  database: Pick<Pool, "connect">; workspace_id: string; actor_user_id: string;
  expected_revision: number; term: string;
}) {
  if (!Number.isSafeInteger(args.expected_revision) || args.expected_revision < 0
    || typeof args.term !== "string" || args.term.length > 200
    || !/^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)?$/u.test(args.term))
    throw new SignalLabelingError("lexicon_suggestion_invalid", 422);
  const client = await args.database.connect();
  try {
    await client.query("BEGIN; SET LOCAL search_path=public,extensions,pg_temp");
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args, lock_authority: true });
    if (!capabilities.can_edit_topics) throw new SignalLabelingError("study_policy_forbidden", 403);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mass-study-policy:'||$1,0))", [args.workspace_id]);
    const policy = await loadMassLabelingStudyPolicyWithClientV1(client, args.workspace_id);
    if (policy.revision !== args.expected_revision) throw new SignalLabelingError("study_policy_conflict", 409);
    await client.query(`INSERT INTO signal_mass_labeling_lexicon_dismissals
      (workspace_id,lexicon_digest,term,created_by_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [args.workspace_id, massLabelingLexiconDigestV1(policy), args.term, args.actor_user_id]);
    await client.query("COMMIT");
    return { contract_version: "mass-labeling-lexicon-dismissal-v1", workspace_id: args.workspace_id, term: args.term };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
