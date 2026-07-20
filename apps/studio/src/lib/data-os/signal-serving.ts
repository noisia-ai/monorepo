import { pool } from "@/lib/db";
import {
  REQUIRED_SIGNAL_DATA_REF_KEYS,
  SIGNAL_SERVING_CONTRACT_VERSION
} from "@/lib/signal/semantics";
import type { SignalServingReadiness } from "@/lib/data-os/signal-serving-assessment";

export {
  assessSignalServingReadiness,
  type SignalServingReadiness,
  type SignalServingReadinessAssessment,
  type SignalServingReadinessIssue
} from "@/lib/data-os/signal-serving-assessment";

export async function getSignalServingReadiness(args: {
  analysisId: string;
  snapshotId: string;
  outputId?: string | null;
  requireDataRefs?: boolean;
}): Promise<SignalServingReadiness> {
  const counts = await pool.query<{
    mentions: number;
    findings: number;
    findings_with_evidence: number;
    opportunities: number;
    citations: number;
    citation_links: number;
    tags: number;
    tag_terms: number;
    features: number;
    feature_keys: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM corpus_snapshot_mentions WHERE snapshot_id = $1::uuid) AS mentions,
        (SELECT COUNT(*)::int FROM tb_findings WHERE tb_analysis_id = $2::uuid) AS findings,
        (
          SELECT COUNT(DISTINCT finding.id)::int
          FROM tb_findings finding
          INNER JOIN tb_finding_citations citation ON citation.finding_id = finding.id
          INNER JOIN corpus_snapshot_mentions snapshot_mention
            ON snapshot_mention.snapshot_id = $1::uuid
           AND snapshot_mention.mention_id = citation.mention_id
          WHERE finding.tb_analysis_id = $2::uuid
        ) AS findings_with_evidence,
        (
          SELECT COUNT(*)::int
          FROM tb_recommendations
          WHERE tb_analysis_id = $2::uuid
            AND kind IN ('activation', 'friction_removal')
        ) AS opportunities,
        (
          SELECT COUNT(DISTINCT citation.mention_id)::int
          FROM tb_finding_citations citation
          INNER JOIN tb_findings finding ON finding.id = citation.finding_id
          INNER JOIN corpus_snapshot_mentions snapshot_mention
            ON snapshot_mention.snapshot_id = $1::uuid
           AND snapshot_mention.mention_id = citation.mention_id
          WHERE finding.tb_analysis_id = $2::uuid
        ) AS citations,
        (
          SELECT COUNT(*)::int
          FROM tb_finding_citations citation
          INNER JOIN tb_findings finding ON finding.id = citation.finding_id
          INNER JOIN corpus_snapshot_mentions snapshot_mention
            ON snapshot_mention.snapshot_id = $1::uuid
           AND snapshot_mention.mention_id = citation.mention_id
          WHERE finding.tb_analysis_id = $2::uuid
        ) AS citation_links,
        (
          SELECT COUNT(*)::int
          FROM record_tags tag
          INNER JOIN corpus_snapshot_mentions snapshot_mention
            ON snapshot_mention.snapshot_id = $1::uuid
           AND snapshot_mention.mention_id = tag.subject_id
          WHERE tag.tb_analysis_id = $2::uuid
            AND tag.subject_type = 'mention'
            AND COALESCE(tag.review_status, 'unreviewed') <> 'rejected'
        ) AS tags,
        (
          SELECT COUNT(DISTINCT tag.taxonomy_term_id)::int
          FROM record_tags tag
          INNER JOIN corpus_snapshot_mentions snapshot_mention
            ON snapshot_mention.snapshot_id = $1::uuid
           AND snapshot_mention.mention_id = tag.subject_id
          WHERE tag.tb_analysis_id = $2::uuid
            AND tag.subject_type = 'mention'
            AND COALESCE(tag.review_status, 'unreviewed') <> 'rejected'
        ) AS tag_terms,
        (
          SELECT COUNT(*)::int
          FROM record_feature_values feature
          INNER JOIN corpus_snapshot_mentions snapshot_mention
            ON snapshot_mention.snapshot_id = $1::uuid
           AND snapshot_mention.mention_id = feature.subject_id
          WHERE feature.tb_analysis_id = $2::uuid
            AND feature.subject_type = 'mention'
        ) AS features,
        (
          SELECT COUNT(DISTINCT feature.feature_key)::int
          FROM record_feature_values feature
          INNER JOIN corpus_snapshot_mentions snapshot_mention
            ON snapshot_mention.snapshot_id = $1::uuid
           AND snapshot_mention.mention_id = feature.subject_id
          WHERE feature.tb_analysis_id = $2::uuid
            AND feature.subject_type = 'mention'
        ) AS feature_keys
    `,
    [args.snapshotId, args.analysisId]
  );

  const refRows = args.outputId
    ? await pool.query<{ ref_key: string }>(
        `SELECT ref_key FROM dashboard_data_refs WHERE output_id = $1::uuid`,
        [args.outputId]
      )
    : { rows: [] as Array<{ ref_key: string }> };
  const present = Array.from(new Set(refRows.rows.map((row) => row.ref_key)));
  const missing = REQUIRED_SIGNAL_DATA_REF_KEYS.filter((key) => !present.includes(key));
  const refsEnforced = args.requireDataRefs ?? Boolean(args.outputId);
  const row = counts.rows[0];

  return {
    contractVersion: SIGNAL_SERVING_CONTRACT_VERSION,
    snapshotId: args.snapshotId,
    analysisId: args.analysisId,
    counts: {
      mentions: row?.mentions ?? 0,
      findings: row?.findings ?? 0,
      findingsWithEvidence: row?.findings_with_evidence ?? 0,
      opportunities: row?.opportunities ?? 0,
      citations: row?.citations ?? 0,
      citationLinks: row?.citation_links ?? 0,
      tags: row?.tags ?? 0,
      tagTerms: row?.tag_terms ?? 0,
      features: row?.features ?? 0,
      featureKeys: row?.feature_keys ?? 0
    },
    dataRefs: {
      required: REQUIRED_SIGNAL_DATA_REF_KEYS,
      present,
      missing,
      complete: missing.length === 0,
      enforced: refsEnforced
    }
  };
}
