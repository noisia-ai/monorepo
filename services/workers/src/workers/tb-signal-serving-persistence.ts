import type { PoolClient } from "pg";

import type {
  ActionStudioCard,
  StrategicOpportunityOutput
} from "@noisia/query-engine";
import {
  safeJsonStringifyForPostgres,
  sanitizeUnicodeForPostgresText
} from "./postgres-json";

export type TbSignalServingPersistenceResult = {
  strategicOpportunitiesInserted: number;
  opportunityFindingLinksInserted: number;
  actionStudioInserted: number;
  actionFindingLinksInserted: number;
  unmatchedFindingIds: string[];
};

type ReplaceTbSignalServingEntitiesArgs = {
  tbAnalysisId: string;
  strategicOpportunities: StrategicOpportunityOutput[];
  actionStudio: ActionStudioCard[];
  findingUuidByHumanId: ReadonlyMap<string, string>;
};

export function assertTbAnalysisAcceptsSynthesisWrite(status: string) {
  if (status === "approved_by_im" || status === "approved_by_kam") {
    throw new Error(
      "Approved T&B analyses are immutable; create a new analysis revision instead of rerunning Step 6."
    );
  }
}

export function assertTbServingFindingLinksResolved(unmatchedFindingIds: string[]) {
  if (unmatchedFindingIds.length > 0) {
    throw new Error(
      `Strategic opportunities or Action Studio reference unknown findings: ${unmatchedFindingIds.join(", ")}`
    );
  }
}

/**
 * Replaces the decision and execution entities produced by T&B Step 6.
 * The caller owns the transaction so meta_json, the operational playbook and
 * these relational serving rows either advance together or not at all.
 */
export async function replaceTbSignalServingEntities(
  client: PoolClient,
  args: ReplaceTbSignalServingEntitiesArgs
): Promise<TbSignalServingPersistenceResult> {
  const unmatched = new Set<string>();
  let opportunityFindingLinksInserted = 0;
  let actionFindingLinksInserted = 0;

  await client.query(`DELETE FROM tb_action_studio WHERE tb_analysis_id = $1`, [args.tbAnalysisId]);
  await client.query(`DELETE FROM tb_strategic_opportunities WHERE tb_analysis_id = $1`, [args.tbAnalysisId]);

  for (const [position, opportunity] of args.strategicOpportunities.entries()) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tb_strategic_opportunities (
         tb_analysis_id,
         opportunity_id,
         title,
         decision,
         why_now,
         level,
         source_mix,
         evidence_summary,
         what_to_do,
         success_signal,
         confidence,
         position,
         raw_data
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, $13::jsonb)
       RETURNING id`,
      [
        args.tbAnalysisId,
        sanitizeUnicodeForPostgresText(opportunity.opportunity_id),
        sanitizeUnicodeForPostgresText(opportunity.title),
        sanitizeUnicodeForPostgresText(opportunity.decision),
        sanitizeUnicodeForPostgresText(opportunity.why_now),
        opportunity.level,
        sanitizeTextArray(opportunity.source_mix),
        sanitizeUnicodeForPostgresText(opportunity.evidence_summary),
        sanitizeUnicodeForPostgresText(opportunity.what_to_do),
        sanitizeUnicodeForPostgresText(opportunity.success_signal),
        opportunity.confidence,
        position,
        safeJsonStringifyForPostgres(opportunity)
      ]
    );
    const opportunityUuid = inserted.rows[0]?.id;
    if (!opportunityUuid) {
      throw new Error(`Could not persist strategic opportunity ${opportunity.opportunity_id}.`);
    }

    const relatedFindingIds = uniqueFindingIds(opportunity.related_finding_ids);
    for (const [linkPosition, findingHumanId] of relatedFindingIds.entries()) {
      const findingUuid = args.findingUuidByHumanId.get(findingHumanId);
      if (!findingUuid) {
        unmatched.add(findingHumanId);
        continue;
      }
      await client.query(
        `INSERT INTO tb_opportunity_findings (opportunity_id, finding_id, position)
         VALUES ($1, $2, $3)`,
        [opportunityUuid, findingUuid, linkPosition]
      );
      opportunityFindingLinksInserted += 1;
    }
  }

  for (const [position, action] of args.actionStudio.entries()) {
    const primaryFindingHumanId = normalizedFindingId(action.primary_finding_id);
    const primaryFindingUuid = primaryFindingHumanId
      ? args.findingUuidByHumanId.get(primaryFindingHumanId) ?? null
      : null;
    if (primaryFindingHumanId && !primaryFindingUuid) unmatched.add(primaryFindingHumanId);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tb_action_studio (
         tb_analysis_id,
         action_id,
         target_team,
         kind,
         title,
         primary_finding_id,
         rationale,
         action_text,
         suggested_channel,
         suggested_format,
         success_signal,
         estimated_effort,
         estimated_impact,
         confidence,
         priority_rank,
         raw_data
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16::jsonb
       )
       RETURNING id`,
      [
        args.tbAnalysisId,
        sanitizeUnicodeForPostgresText(action.action_id),
        action.target_team,
        action.kind,
        sanitizeUnicodeForPostgresText(action.title),
        primaryFindingUuid,
        sanitizeUnicodeForPostgresText(action.rationale),
        sanitizeUnicodeForPostgresText(action.action_text),
        nullableText(action.suggested_channel),
        nullableText(action.suggested_format),
        sanitizeUnicodeForPostgresText(action.success_signal),
        action.estimated_effort,
        action.estimated_impact,
        action.confidence,
        action.priority_rank || position + 1,
        safeJsonStringifyForPostgres(action)
      ]
    );
    const actionUuid = inserted.rows[0]?.id;
    if (!actionUuid) throw new Error(`Could not persist Action Studio card ${action.action_id}.`);

    const findingIds = uniqueFindingIds([
      ...action.finding_ids,
      ...(primaryFindingHumanId ? [primaryFindingHumanId] : [])
    ]);
    for (const [linkPosition, findingHumanId] of findingIds.entries()) {
      const findingUuid = args.findingUuidByHumanId.get(findingHumanId);
      if (!findingUuid) {
        unmatched.add(findingHumanId);
        continue;
      }
      await client.query(
        `INSERT INTO tb_action_findings (action_id, finding_id, position)
         VALUES ($1, $2, $3)`,
        [actionUuid, findingUuid, linkPosition]
      );
      actionFindingLinksInserted += 1;
    }
  }

  return {
    strategicOpportunitiesInserted: args.strategicOpportunities.length,
    opportunityFindingLinksInserted,
    actionStudioInserted: args.actionStudio.length,
    actionFindingLinksInserted,
    unmatchedFindingIds: Array.from(unmatched).sort()
  };
}

function sanitizeTextArray(values: string[]) {
  return values.map((value) => sanitizeUnicodeForPostgresText(value));
}

function nullableText(value: string | null) {
  return value === null ? null : sanitizeUnicodeForPostgresText(value);
}

function normalizedFindingId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function uniqueFindingIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(normalizedFindingId).filter((value): value is string => Boolean(value))));
}
