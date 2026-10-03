export type CorpusExplorerFilters = {
  q: string;
  platform: string;
  finding: string;
  lens: string;
  signalIntent: string;
  entity: string;
  signal: string;
  evidenceRole: string;
  dateFrom: string;
  dateTo: string;
  sort: "relevance" | "newest" | "oldest";
  page: number;
  limit: number;
};

export type CorpusExplorerSql = {
  baseSql: string;
  whereSql: string;
  orderBy: string;
  values: unknown[];
  countValues: unknown[];
  limitParam: number;
  offsetParam: number;
};

export function buildCorpusExplorerSql(args: {
  scopedCorpusIds: string[];
  filters: CorpusExplorerFilters;
}): CorpusExplorerSql {
  const offset = (args.filters.page - 1) * args.filters.limit;
  const clauses = ["m.study_corpus_id = ANY($1::uuid[])", "m.inclusion_status <> 'excluded'"];
  const values: unknown[] = [args.scopedCorpusIds];
  let searchParamIndex: number | null = null;

  if (args.filters.q.trim()) {
    values.push(`%${args.filters.q.trim()}%`);
    searchParamIndex = values.length;
    clauses.push(`(
      m.text_clean ILIKE $${searchParamIndex}
      OR m.text_snippet ILIKE $${searchParamIndex}
      OR m.platform ILIKE $${searchParamIndex}
      OR m.source_file_name ILIKE $${searchParamIndex}
      OR m.batch_entity_label ILIKE $${searchParamIndex}
      OR f.finding_id ILIKE $${searchParamIndex}
      OR f.nombre_comercial ILIKE $${searchParamIndex}
      OR cs.canonical_title ILIKE $${searchParamIndex}
    )`);
  }
  if (args.filters.platform) {
    values.push(args.filters.platform);
    clauses.push(`m.resolved_platform = $${values.length}`);
  }
  if (args.filters.finding) {
    values.push(args.filters.finding);
    clauses.push(`f.finding_id = $${values.length}`);
  }
  if (args.filters.lens) {
    values.push(args.filters.lens);
    clauses.push(`mqs.lens_slug = $${values.length}`);
  }
  if (args.filters.signalIntent) {
    values.push(args.filters.signalIntent);
    clauses.push(`mqs.signal_intent = $${values.length}`);
  }
  if (args.filters.entity) {
    values.push(args.filters.entity);
    clauses.push(`(
      mqs.entity_id = $${values.length}
      OR mqs.corpus_entity_id::text = $${values.length}
      OR m.batch_entity_label = $${values.length}
      OR m.entity_label_from_batch = $${values.length}
    )`);
  }
  if (args.filters.signal) {
    values.push(args.filters.signal);
    clauses.push(`cs.id::text = $${values.length}`);
  }
  if (args.filters.evidenceRole) {
    values.push(args.filters.evidenceRole);
    clauses.push(`soe.evidence_role = $${values.length}`);
  }
  if (args.filters.dateFrom) {
    values.push(args.filters.dateFrom);
    clauses.push(`m.published_at >= $${values.length}::date`);
  }
  if (args.filters.dateTo) {
    values.push(args.filters.dateTo);
    clauses.push(`m.published_at < ($${values.length}::date + interval '1 day')`);
  }

  const orderBy = args.filters.sort === "oldest"
    ? "m.published_at ASC NULLS LAST"
    : args.filters.sort === "newest"
      ? "m.published_at DESC NULLS LAST"
      : searchParamIndex
        ? `CASE
             WHEN max(f.finding_id) ILIKE $${searchParamIndex} THEN 0
             WHEN max(f.nombre_comercial) ILIKE $${searchParamIndex} THEN 1
             WHEN max(cs.canonical_title) ILIKE $${searchParamIndex} THEN 2
             WHEN m.text_clean ILIKE $${searchParamIndex} THEN 3
             ELSE 4
           END, m.published_at DESC NULLS LAST`
        : "m.published_at DESC NULLS LAST";

  const baseSql = `
    WITH scoped_mentions AS (
      SELECT
        m.*,
        ib.mention_type AS batch_mention_type,
        ib.entity_kind AS batch_entity_kind,
        ib.entity_label AS entity_label_from_batch,
        ib.source_file_name
      FROM mentions m
      LEFT JOIN import_batches ib ON ib.id = m.source_file_id
    )
  `;
  const whereSql = clauses.join(" AND ");
  const countValues = [...values];
  values.push(args.filters.limit, offset);

  return {
    baseSql,
    whereSql,
    orderBy,
    values,
    countValues,
    limitParam: values.length - 1,
    offsetParam: values.length
  };
}
