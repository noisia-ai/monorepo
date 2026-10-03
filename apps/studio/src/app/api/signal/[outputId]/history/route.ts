import { z } from "zod";

import { unauthorized, validationError } from "@/lib/api/responses";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { pool } from "@/lib/db";
import { isUndefinedTableError } from "@/lib/db/errors";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { buildHistoryTimeline, groupHistorySignals, type HistoryRow } from "@/lib/live-intelligence/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  methodology: z.string().max(120).optional().default(""),
  signalType: z.string().max(80).optional().default(""),
  dateFrom: z.string().max(20).optional().default(""),
  dateTo: z.string().max(20).optional().default(""),
  limit: z.coerce.number().int().min(5).max(100).optional().default(40)
});

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json({ error: "not_found", message: "Signal output not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return validationError(parsed.error);

  const params: unknown[] = [];
  const scopeClauses: string[] = [];
  const filterClauses: string[] = [];
  const scopedCorpusIds = Array.from(new Set([output.studyCorpusId, output.baseCorpusId].flatMap((id) => id ? [id] : [])));
  if (output.brandId) {
    params.push(output.brandId);
    scopeClauses.push(`cs.brand_id = $${params.length}`);
  }
  if (output.themeId) {
    params.push(output.themeId);
    scopeClauses.push(`cs.theme_id = $${params.length}`);
  }
  params.push(scopedCorpusIds);
  scopeClauses.push(`so.study_corpus_id = ANY($${params.length}::uuid[])`);
  if (parsed.data.signalType) {
    params.push(parsed.data.signalType);
    filterClauses.push(`cs.signal_type = $${params.length}`);
  }
  if (parsed.data.methodology) {
    params.push(parsed.data.methodology);
    filterClauses.push(`cs.methodology_slug = $${params.length}`);
  }
  if (parsed.data.dateFrom) {
    params.push(parsed.data.dateFrom);
    filterClauses.push(`COALESCE(so.window_end, so.window_start) >= $${params.length}::date`);
  }
  if (parsed.data.dateTo) {
    params.push(parsed.data.dateTo);
    filterClauses.push(`COALESCE(so.window_start, so.window_end) <= $${params.length}::date`);
  }
  params.push(parsed.data.limit);
  const limitParam = params.length;

  let result;
  try {
    result = await pool.query<HistoryRow>(
      `
        WITH ranked_signals AS (
          SELECT
            cs.id,
            max(so.window_end) AS latest_window,
            max(so.frequency) AS latest_frequency
          FROM canonical_signals cs
          JOIN signal_observations so ON so.canonical_signal_id = cs.id
          LEFT JOIN published_outputs po ON po.id = so.published_output_id
          WHERE (${scopeClauses.join(" OR ")})
            AND (
              so.published_output_id IS NULL
              OR (po.status = 'published' AND po.archived_at IS NULL)
            )
            ${filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : ""}
          GROUP BY cs.id
          ORDER BY latest_window DESC NULLS LAST, latest_frequency DESC NULLS LAST
          LIMIT $${limitParam}
        ),
        evidence_counts AS (
          SELECT signal_observation_id, COUNT(*)::int AS evidence_count
          FROM signal_observation_evidence
          GROUP BY signal_observation_id
        ),
        evidence_samples AS (
          SELECT DISTINCT ON (signal_observation_id)
            signal_observation_id,
            quote
          FROM signal_observation_evidence
          WHERE COALESCE(quote, '') <> ''
          ORDER BY signal_observation_id, is_protagonist DESC, position ASC
        )
        SELECT
          cs.id::text AS canonical_signal_id,
          cs.canonical_title,
          cs.signal_type,
          cs.status AS signal_status,
          cs.first_seen_at::text,
          cs.last_seen_at::text,
          so.id::text AS observation_id,
          so.window_start::text,
          so.window_end::text,
          so.frequency,
          so.intensity::text,
          so.sentiment::text,
          so.composite_score::text,
          so.confidence,
          so.rank,
          so.delta_vs_previous::text,
          COALESCE(ec.evidence_count, 0)::int AS evidence_count,
          es.quote AS evidence_quote
        FROM ranked_signals rs
        JOIN canonical_signals cs ON cs.id = rs.id
        JOIN signal_observations so ON so.canonical_signal_id = cs.id
        LEFT JOIN published_outputs po ON po.id = so.published_output_id
        LEFT JOIN evidence_counts ec ON ec.signal_observation_id = so.id
        LEFT JOIN evidence_samples es ON es.signal_observation_id = so.id
        WHERE (
            so.published_output_id IS NULL
            OR (po.status = 'published' AND po.archived_at IS NULL)
          )
          ${filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : ""}
        ORDER BY cs.canonical_title ASC, so.window_start ASC NULLS LAST, so.created_at ASC
      `,
      params
    );
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json({
      ok: false,
      unavailable: true,
      reason: "live_intelligence_schema_missing",
      methodology: parsed.data.methodology,
      scope: {
        brand_id: output.brandId,
        theme_id: output.themeId,
        study_corpus_id: output.studyCorpusId,
        base_corpus_id: output.baseCorpusId
      },
      signals: [],
      timeline: []
    });
  }

  const signals = groupHistorySignals(result.rows);
  const timeline = buildHistoryTimeline(signals);

  return Response.json(
    {
      ok: true,
      methodology: parsed.data.methodology,
      scope: {
        brand_id: output.brandId,
        theme_id: output.themeId,
        study_corpus_id: output.studyCorpusId,
        base_corpus_id: output.baseCorpusId
      },
      signals,
      timeline
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
