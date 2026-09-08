export const SIGNAL_WORKSPACE_CORPUS_READINESS_CONTRACT_V1 = "signal-workspace-corpus-readiness-v1" as const;

export type SignalWorkspaceCorpusReadinessV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_CORPUS_READINESS_CONTRACT_V1;
  workspace_id: string;
  /** PostgreSQL statement time, UTC with six fractional digits; keep string precision. */
  observed_at: string;
  state: "awaiting_import" | "received" | "needs_attention";
  accepted_files: number;
  records_read: number;
  dispositions: { included: number; excluded: number; duplicates: number };
  projection: {
    observations: number;
    linked_roots: number;
    included_roots: number;
    excluded_roots: number;
    roots_with_text: number;
  };
  /** Rights cover llm-processing only, not publishing or serving. Semantic counts partition
   * rights-eligible included roots; an acquisition scope is never a semantic assertion. */
  eligibility: {
    rights_eligible_roots: number;
    rights_blocked_roots: number;
    semantic_eligible_roots: number;
    semantic_pending_roots: number;
  };
  reconciliation_errors: string[];
};

export type SignalWorkspaceCorpusReadinessQueryableV1 = {
  query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};

type AggregateRow = Record<string, string | number>;

/** The caller owns actor authorization. One aggregate statement reads one MVCC snapshot;
 * no excerpts, sampled population, legacy corpus, or stored preparation claim is returned. */
export async function loadSignalWorkspaceCorpusReadinessStoreV1(args: {
  queryable: SignalWorkspaceCorpusReadinessQueryableV1;
  workspace_id: string;
}): Promise<SignalWorkspaceCorpusReadinessV1> {
  const result = await args.queryable.query<AggregateRow>(`
    WITH accepted AS MATERIALIZED (
      SELECT batch.id,batch.data_source_id,batch.record_count,batch.included_count,
        batch.excluded_count,batch.duplicate_count,batch.provider_observation_projection_state,
        batch.provider_observation_count
      FROM import_batches batch
      WHERE batch.workspace_id=$1::uuid AND batch.status='completed'
    ), links AS MATERIALIZED (
      SELECT membership.import_batch_id,membership.data_source_id,membership.mention_id,
        root.id root_id
      FROM signal_mention_import_memberships membership
      JOIN accepted batch ON batch.id=membership.import_batch_id
        AND batch.data_source_id=membership.data_source_id
      LEFT JOIN mentions origin ON origin.id=membership.mention_id AND origin.workspace_id=$1::uuid
      LEFT JOIN mentions root ON root.id=origin.canonical_mention_id
        AND root.workspace_id=$1::uuid AND root.canonical_mention_id=root.id
      WHERE membership.workspace_id=$1::uuid
    ), roots AS MATERIALIZED (
      SELECT root.id,root.inclusion_status,
        NULLIF(btrim(root.text_clean),'') IS NOT NULL has_text
      FROM mentions root
      WHERE root.workspace_id=$1::uuid AND root.canonical_mention_id=root.id
        AND EXISTS(SELECT 1 FROM links WHERE links.root_id=root.id)
    ), observations AS MATERIALIZED (
      SELECT observation.id,observation.import_batch_id,observation.mention_id
      FROM signal_provider_mention_observations observation
      JOIN accepted batch ON batch.id=observation.import_batch_id
        AND batch.data_source_id=observation.data_source_id
      WHERE observation.workspace_id=$1::uuid
    ), authorized_imports AS MATERIALIZED (
      -- Reuse governed-data policy precedence: an effective import binding overrides
      -- the source binding. A complete allowed path is required; do not mix policies.
      SELECT batch.id import_batch_id,batch.data_source_id
      FROM accepted batch
      JOIN data_sources source ON source.id=batch.data_source_id
        AND source.workspace_id=$1::uuid AND source.status='active'
      JOIN LATERAL (
        SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=batch.data_source_id
          AND candidate.status='active' AND candidate.effective_from<=now()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
          AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
        ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id
        LIMIT 1
      ) binding ON true
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.workspace_id=$1::uuid AND retention.status='active'
        AND retention.effective_from<=now() AND (retention.effective_to IS NULL OR retention.effective_to>now())
        AND retention.retention_state='allowed'
        AND (retention.retention_mode='indefinite'
          OR (retention.retention_mode='until' AND retention.retain_until>now()))
      JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.workspace_id=$1::uuid AND licensing.status='active'
        AND licensing.effective_from<=now() AND (licensing.effective_to IS NULL OR licensing.effective_to>now())
      WHERE EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage
        WHERE usage.workspace_id=$1::uuid AND usage.licensing_policy_id=licensing.id
          AND usage.usage_purpose='llm-processing' AND usage.decision='allowed')
    ), authorized_paths AS MATERIALIZED (
      SELECT DISTINCT link.root_id,link.import_batch_id,link.data_source_id
      FROM links link JOIN roots root ON root.id=link.root_id
      JOIN authorized_imports authorized ON authorized.import_batch_id=link.import_batch_id
        AND authorized.data_source_id=link.data_source_id
      WHERE root.inclusion_status='included'
    ), eligible AS MATERIALIZED (
      -- Paths already contain included roots with complete rights. Aggregate them once;
      -- a correlated EXISTS here can repeatedly scan the entire materialized path set.
      SELECT path.root_id id,bool_or(assertion.id IS NOT NULL) semantic_eligible
      FROM authorized_paths path
      LEFT JOIN signal_mention_attributions assertion ON assertion.workspace_id=$1::uuid
        AND assertion.mention_id=path.root_id AND assertion.import_batch_id=path.import_batch_id
        AND assertion.data_source_id=path.data_source_id
        AND assertion.attribution_basis='mention_semantic' AND assertion.is_current=true
        AND assertion.review_status='approved' AND assertion.eligibility_status='eligible'
      GROUP BY path.root_id
    ) SELECT
      to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,
      (SELECT count(*) FROM accepted) accepted_files,
      (SELECT COALESCE(sum(record_count),0) FROM accepted) records_read,
      (SELECT COALESCE(sum(included_count),0) FROM accepted) included,
      (SELECT COALESCE(sum(excluded_count),0) FROM accepted) excluded,
      (SELECT COALESCE(sum(duplicate_count),0) FROM accepted) duplicates,
      (SELECT count(*) FROM observations) observations,
      (SELECT count(*) FROM roots) linked_roots,
      (SELECT count(*) FROM roots WHERE inclusion_status='included') included_roots,
      (SELECT count(*) FROM roots WHERE inclusion_status='excluded') excluded_roots,
      (SELECT count(*) FROM roots WHERE has_text) roots_with_text,
      (SELECT count(*) FROM eligible) rights_eligible_roots,
      (SELECT count(*) FROM eligible WHERE semantic_eligible) semantic_eligible_roots,
      (SELECT count(*) FROM accepted WHERE record_count IS NULL OR included_count IS NULL
        OR excluded_count IS NULL OR duplicate_count IS NULL
        OR least(record_count,included_count,excluded_count,duplicate_count)<0
        OR record_count::bigint<>included_count::bigint+excluded_count::bigint+duplicate_count::bigint) invalid_counters,
      (SELECT count(*) FROM accepted batch WHERE NOT EXISTS(
        SELECT 1 FROM data_sources source WHERE source.id=batch.data_source_id
          AND source.workspace_id=$1::uuid)) invalid_sources,
      (SELECT count(*) FROM links WHERE root_id IS NULL) invalid_root_links,
      (SELECT count(*) FROM accepted batch WHERE batch.included_count::bigint+batch.excluded_count::bigint>0
        AND NOT EXISTS(SELECT 1 FROM links WHERE links.import_batch_id=batch.id)) missing_import_links,
      (SELECT count(*) FROM observations observation WHERE NOT EXISTS(
        SELECT 1 FROM links WHERE links.import_batch_id=observation.import_batch_id
          AND links.mention_id=observation.mention_id AND links.root_id IS NOT NULL)) unlinked_observations,
      (SELECT count(*) FROM accepted batch WHERE batch.provider_observation_projection_state='ready'
        AND batch.provider_observation_count IS DISTINCT FROM (SELECT count(*) FROM observations
          WHERE observations.import_batch_id=batch.id)) observation_count_mismatches,
      (SELECT count(*) FROM roots WHERE inclusion_status='included' AND NOT has_text) missing_included_text,
      (SELECT count(*) FROM roots WHERE inclusion_status NOT IN ('included','excluded')) pending_inclusion
  `, [args.workspace_id]);
  const row = result.rows[0];
  if (!row) throw new Error("workspace_corpus_readiness_unavailable");
  const observedAt = row.observed_at;
  if (typeof observedAt !== "string") throw new Error("workspace_corpus_readiness_observed_at_invalid");
  const timestamp = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/u.exec(observedAt);
  if (!timestamp) throw new Error("workspace_corpus_readiness_observed_at_invalid");
  const year = Number(timestamp[1]), month = Number(timestamp[2]), day = Number(timestamp[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  if (year === 0 || day > daysInMonth) throw new Error("workspace_corpus_readiness_observed_at_invalid");
  const count = (key: string) => {
    const raw = row[key];
    if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d+$/u.test(raw))) {
      throw new Error("workspace_corpus_readiness_count_invalid");
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("workspace_corpus_readiness_count_invalid");
    return value;
  };
  const reconciliationErrors: string[] = [];
  for (const [key, code] of [
    ["invalid_counters", "accepted_import_counters_mismatch"],
    ["invalid_sources", "accepted_import_source_unavailable"],
    ["invalid_root_links", "canonical_root_link_invalid"],
    ["missing_import_links", "accepted_import_membership_missing"],
    ["unlinked_observations", "provider_observation_membership_missing"],
    ["observation_count_mismatches", "provider_observation_count_mismatch"],
    ["missing_included_text", "included_root_text_missing"],
    ["pending_inclusion", "canonical_inclusion_pending"]
  ]) if (count(key!) > 0) reconciliationErrors.push(code!);
  const acceptedFiles = count("accepted_files"), includedRoots = count("included_roots");
  const rightsEligible = count("rights_eligible_roots"), semanticEligible = count("semantic_eligible_roots");
  if (rightsEligible > includedRoots || semanticEligible > rightsEligible) {
    throw new Error("workspace_corpus_readiness_count_invalid");
  }
  const rightsBlocked = includedRoots - rightsEligible;
  return {
    contract_version: SIGNAL_WORKSPACE_CORPUS_READINESS_CONTRACT_V1,
    workspace_id: args.workspace_id,
    observed_at: observedAt,
    state: reconciliationErrors.length > 0 ? "needs_attention"
      : acceptedFiles === 0 ? "awaiting_import" : "received",
    accepted_files: acceptedFiles, records_read: count("records_read"),
    dispositions: { included: count("included"), excluded: count("excluded"), duplicates: count("duplicates") },
    projection: { observations: count("observations"), linked_roots: count("linked_roots"),
      included_roots: includedRoots, excluded_roots: count("excluded_roots"), roots_with_text: count("roots_with_text") },
    eligibility: { rights_eligible_roots: rightsEligible, rights_blocked_roots: rightsBlocked,
      semantic_eligible_roots: semanticEligible, semantic_pending_roots: rightsEligible - semanticEligible },
    reconciliation_errors: reconciliationErrors
  };
}
