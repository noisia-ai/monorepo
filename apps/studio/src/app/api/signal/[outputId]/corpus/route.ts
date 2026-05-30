import { z } from "zod";

import { unauthorized, validationError } from "@/lib/api/responses";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { pool } from "@/lib/db";
import { getSignalOutputForUser } from "@/lib/data/signal";

export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().max(500).optional().default(""),
  platform: z.string().max(80).optional().default(""),
  finding: z.string().max(80).optional().default(""),
  dateFrom: z.string().max(20).optional().default(""),
  dateTo: z.string().max(20).optional().default(""),
  sort: z.enum(["relevance", "newest", "oldest"]).optional().default("relevance"),
  page: z.coerce.number().int().min(1).max(5000).optional().default(1),
  limit: z.coerce.number().int().min(20).max(500).optional().default(240)
});

export async function GET(
  request: Request,
  context: { params: Promise<{ outputId: string }> }
) {
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

  const filters = parsed.data;
  const offset = (filters.page - 1) * filters.limit;
  const clauses = ["m.study_corpus_id = $1", "m.inclusion_status <> 'excluded'"];
  const values: unknown[] = [output.studyCorpusId];

  if (filters.q.trim()) {
    values.push(`%${filters.q.trim()}%`);
    clauses.push(`(
      m.text_clean ILIKE $${values.length}
      OR m.text_snippet ILIKE $${values.length}
      OR m.platform ILIKE $${values.length}
      OR m.source_file_name ILIKE $${values.length}
      OR m.batch_entity_label ILIKE $${values.length}
    )`);
  }
  if (filters.platform) {
    values.push(filters.platform);
    clauses.push(`m.resolved_platform = $${values.length}`);
  }
  if (filters.finding) {
    values.push(filters.finding);
    clauses.push(`f.finding_id = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    clauses.push(`m.published_at >= $${values.length}::date`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    clauses.push(`m.published_at < ($${values.length}::date + interval '1 day')`);
  }

  const orderBy = filters.sort === "oldest"
    ? "m.published_at ASC NULLS LAST"
    : filters.sort === "newest"
      ? "m.published_at DESC NULLS LAST"
      : filters.q.trim()
        ? "CASE WHEN m.text_clean ILIKE $2 THEN 0 ELSE 1 END, m.published_at DESC NULLS LAST"
        : "m.published_at DESC NULLS LAST";

  const baseSql = `
    WITH scoped_mentions AS (
      SELECT
        m.*,
        ib.mention_type AS batch_mention_type,
        ib.entity_kind AS batch_entity_kind,
        ib.entity_label AS batch_entity_label,
        ib.source_file_name,
        CASE
          WHEN lower(COALESCE(m.raw_metadata->'row'->>'domain group', '')) LIKE '%tiktok%'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain', '')) LIKE '%tiktok%'
            OR lower(COALESCE(m.url, '')) LIKE '%tiktok%'
            OR lower(COALESCE(ib.source_file_name, '')) LIKE '%tiktok%' THEN 'tiktok'
          WHEN lower(COALESCE(m.raw_metadata->'row'->>'domain group', '')) LIKE '%twitter%'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain group', '')) = 'x'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain', '')) LIKE '%twitter%'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain', '')) LIKE '%x.com%'
            OR lower(COALESCE(m.url, '')) LIKE '%twitter.com%'
            OR lower(COALESCE(m.url, '')) LIKE '%x.com%' THEN 'x'
          WHEN lower(COALESCE(m.raw_metadata->'row'->>'domain group', '')) LIKE '%instagram%'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain', '')) LIKE '%instagram%'
            OR lower(COALESCE(m.url, '')) LIKE '%instagram%' THEN 'instagram'
          WHEN lower(COALESCE(m.raw_metadata->'row'->>'domain group', '')) LIKE '%facebook%'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain', '')) LIKE '%facebook%'
            OR lower(COALESCE(m.url, '')) LIKE '%facebook%'
            OR lower(COALESCE(m.url, '')) LIKE '%fb.com%' THEN 'facebook'
          WHEN lower(COALESCE(m.raw_metadata->'row'->>'domain group', '')) LIKE '%youtube%'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain', '')) LIKE '%youtube%'
            OR lower(COALESCE(m.url, '')) LIKE '%youtube%' THEN 'youtube'
          WHEN lower(COALESCE(m.raw_metadata->'row'->>'domain group', '')) LIKE '%reddit%'
            OR lower(COALESCE(m.raw_metadata->'row'->>'domain', '')) LIKE '%reddit%'
            OR lower(COALESCE(m.url, '')) LIKE '%reddit%' THEN 'reddit'
          WHEN lower(COALESCE(m.platform, '')) IN ('comment','comments','comentario','comentarios','video','short','shorts','post','posts','tweet','tweets','article','articles','reel','reels','story','stories','image','photo','photos') THEN 'unknown'
          ELSE COALESCE(NULLIF(lower(m.platform), ''), 'unknown')
        END AS resolved_platform
      FROM mentions m
      LEFT JOIN import_batches ib ON ib.id = m.source_file_id
    )
  `;
  const whereSql = clauses.join(" AND ");
  values.push(filters.limit, offset);
  const limitParam = values.length - 1;
  const offsetParam = values.length;

  const [countResult, rowsResult, facetsResult] = await Promise.all([
    pool.query<{ total: number }>(
      `
        ${baseSql}
        SELECT COUNT(DISTINCT m.id)::int AS total
        FROM scoped_mentions m
        LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
        LEFT JOIN tb_findings f ON f.id = mc.finding_id
        WHERE ${whereSql}
      `,
      values.slice(0, values.length - 2)
    ),
    pool.query(
      `
        ${baseSql}
        SELECT DISTINCT ON (m.id)
          m.id AS mention_id,
          m.text_clean AS text,
          m.text_snippet,
          m.resolved_platform AS platform,
          m.published_at::text AS published_at,
          m.sentiment_source,
          m.url,
          m.batch_mention_type AS mention_type,
          m.batch_entity_kind AS entity_kind,
          m.batch_entity_label AS entity_label,
          m.source_file_name,
          f.finding_id,
          f.nombre_comercial AS finding_name
        FROM scoped_mentions m
        LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
        LEFT JOIN tb_findings f ON f.id = mc.finding_id
        WHERE ${whereSql}
        ORDER BY m.id, ${orderBy}
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      values
    ),
    pool.query<{ platform: string; count: number }>(
      `
        ${baseSql}
        SELECT COALESCE(NULLIF(m.resolved_platform, ''), 'unknown') AS platform, COUNT(*)::int AS count
        FROM scoped_mentions m
        WHERE m.study_corpus_id = $1 AND m.inclusion_status <> 'excluded'
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 24
      `,
      [output.studyCorpusId]
    )
  ]);

  return Response.json({
    total: countResult.rows[0]?.total ?? 0,
    page: filters.page,
    limit: filters.limit,
    rows: rowsResult.rows,
    facets: {
      platforms: facetsResult.rows
    }
  });
}
