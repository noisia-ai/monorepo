type MonthlyCutContext = {
  output_id: string;
  study_corpus_id: string;
  base_corpus_id: string | null;
  organization_id: string | null;
  brand_id: string | null;
  theme_id: string | null;
};

type MonthlyCutMentionRow = {
  id: string;
  study_corpus_id: string;
  source_file_id: string | null;
  text_clean: string;
  text_snippet: string | null;
  platform: string;
  resolved_platform: string | null;
  published_at: string;
  sentiment_score: string | null;
  quality_score: number | null;
  batch_entity_label: string | null;
};

type MonthlyCutPack = {
  key: string;
  methodologySlug: string;
  signalType: string;
  canonicalTitle: string;
  description: string;
  primaryTerms: string[];
  secondaryTerms: string[];
  minPrimaryTerms?: number;
  minTotalTerms?: number;
};

export type MonthlyCutClassificationInput = {
  id: string;
  text: string;
  sentiment?: number | null;
  quality?: number | null;
};

export type MonthlyCutClassifiedGroup = {
  key: string;
  methodologySlug: string;
  signalType: string;
  canonicalTitle: string;
  description: string;
  mentionIds: string[];
  matchedTerms: string[];
  averageSentiment: number | null;
  averageQuality: number | null;
};

export type MonthlyCutBackfillResult = {
  outputId: string;
  targetCorpusIds: string[];
  dateFrom: string;
  dateTo: string;
  importBatchId: string | null;
  totalMentions: number;
  matchedMentions: number;
  signalsCreatedOrUpdated: number;
  observationsCreatedOrUpdated: number;
  evidenceLinksCreated: number;
  groups: Array<MonthlyCutClassifiedGroup & {
    observationId: string | null;
    frequency: number;
    sharePct: number;
    deltaVsPrevious: number;
  }>;
};

export type RunMonthlyCutBackfillArgs = {
  outputId: string;
  dateFrom: string;
  dateTo: string;
  importBatchId?: string | null;
  targetCorpusId?: string | null;
};

const MONTHLY_CUT_SIGNAL_PACKS: MonthlyCutPack[] = [
  {
    key: "benefit-choice-trigger",
    methodologySlug: "triggers-barriers",
    signalType: "trigger",
    canonicalTitle: "Beneficio claro que facilita la eleccion",
    description: "La gente expresa razones concretas para elegir, quedarse o recomendar.",
    primaryTerms: ["recomiendo", "recomendado", "facil", "funciona", "rapido", "me gusta", "vale la pena", "conectado", "internet", "datos", "cobertura", "ahorro", "descuento", "promocion"],
    secondaryTerms: ["calidad", "confianza", "tranquilo", "protegido", "sin problema", "me ayuda", "resuelve"],
    minPrimaryTerms: 1,
    minTotalTerms: 1
  },
  {
    key: "support-continuity-friction",
    methodologySlug: "triggers-barriers",
    signalType: "barrier",
    canonicalTitle: "Soporte y continuidad como friccion de cambio",
    description: "La conversacion se frena por soporte, continuidad, cobros, espera o miedo a perder servicio.",
    primaryTerms: ["portabilidad", "soporte", "servicio al cliente", "atencion", "falla", "fallo", "cae", "lento", "problema", "queja", "esperando", "cobro", "cancelar", "no resuelve", "sin respuesta", "autorizacion", "siniestro"],
    secondaryTerms: ["miedo", "perder", "caro", "molesto", "pesimo", "no sirve", "no pude", "tarda", "mal servicio"],
    minPrimaryTerms: 1,
    minTotalTerms: 1
  },
  {
    key: "price-value-equation",
    methodologySlug: "value-perception-matrix",
    signalType: "value",
    canonicalTitle: "Valor percibido por precio, cobertura y rendimiento",
    description: "La gente compara lo que paga contra lo que recibe.",
    primaryTerms: ["precio", "caro", "barato", "costo", "pago", "pagar", "peso", "dinero", "promo", "promocion", "cobertura", "datos", "paquete", "rinde", "rendimiento", "valor"],
    secondaryTerms: ["descuento", "beneficio", "incluye", "deducible", "prima", "plan", "mensualidad"],
    minPrimaryTerms: 1,
    minTotalTerms: 1
  },
  {
    key: "trust-narrative-ownership",
    methodologySlug: "narrative-ownership",
    signalType: "narrative",
    canonicalTitle: "Narrativa de confianza y respaldo",
    description: "El corte muestra quien posee la narrativa de confianza, respaldo o cumplimiento.",
    primaryTerms: ["confianza", "confiable", "seguro", "cumple", "respaldo", "tranquilidad", "reputacion"],
    secondaryTerms: ["red", "cobertura", "experiencia", "marca", "recomienda", "recomendacion", "protege", "garantia", "atencion", "calidad"],
    minPrimaryTerms: 1,
    minTotalTerms: 1
  }
];

export function classifyMonthlyCutMentions(
  mentions: MonthlyCutClassificationInput[],
  packs: MonthlyCutPack[] = MONTHLY_CUT_SIGNAL_PACKS
): MonthlyCutClassifiedGroup[] {
  const groups = packs.map((pack) => ({
    pack,
    mentionIds: [] as string[],
    matchedTerms: new Set<string>(),
    sentimentValues: [] as number[],
    qualityValues: [] as number[]
  }));

  for (const mention of mentions) {
    const normalizedText = normalizeSearchText(mention.text);
    if (!normalizedText) continue;
    for (const group of groups) {
      const match = scorePack(normalizedText, group.pack);
      if (!match.qualified) continue;
      group.mentionIds.push(mention.id);
      match.terms.forEach((term) => group.matchedTerms.add(term));
      if (typeof mention.sentiment === "number" && Number.isFinite(mention.sentiment)) {
        group.sentimentValues.push(mention.sentiment);
      }
      if (typeof mention.quality === "number" && Number.isFinite(mention.quality)) {
        group.qualityValues.push(mention.quality);
      }
    }
  }

  return groups
    .filter((group) => group.mentionIds.length > 0)
    .map((group) => ({
      key: group.pack.key,
      methodologySlug: group.pack.methodologySlug,
      signalType: group.pack.signalType,
      canonicalTitle: group.pack.canonicalTitle,
      description: group.pack.description,
      mentionIds: group.mentionIds,
      matchedTerms: Array.from(group.matchedTerms).sort(),
      averageSentiment: average(group.sentimentValues),
      averageQuality: average(group.qualityValues)
    }))
    .sort((a, b) => b.mentionIds.length - a.mentionIds.length || a.key.localeCompare(b.key));
}

export async function runMonthlyCutBackfill(args: RunMonthlyCutBackfillArgs): Promise<MonthlyCutBackfillResult> {
  const ctx = await loadMonthlyCutContext(args.outputId);
  if (!ctx) {
    throw new Error("Signal output not found.");
  }

  const scopedCorpusIds = Array.from(new Set([ctx.study_corpus_id, ctx.base_corpus_id].filter(Boolean) as string[]));
  const targetCorpusIds = args.targetCorpusId
    ? [args.targetCorpusId]
    : scopedCorpusIds;

  if (targetCorpusIds.some((id) => !scopedCorpusIds.includes(id))) {
    throw new Error("Target corpus is outside this Signal output scope.");
  }

  const mentions = await loadMonthlyCutMentions({
    corpusIds: targetCorpusIds,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    importBatchId: args.importBatchId ?? null
  });
  const groups = classifyMonthlyCutMentions(mentions.map((mention) => ({
    id: mention.id,
    text: [mention.text_clean, mention.text_snippet].filter(Boolean).join("\n"),
    sentiment: numericValue(mention.sentiment_score),
    quality: mention.quality_score
  })));
  const totalMentions = mentions.length;
  const mentionMap = new Map(mentions.map((mention) => [mention.id, mention]));
  let signalsCreatedOrUpdated = 0;
  let observationsCreatedOrUpdated = 0;
  let evidenceLinksCreated = 0;
  const outputGroups: MonthlyCutBackfillResult["groups"] = [];

  for (const group of groups) {
    const canonicalSignalId = await upsertMonthlyCanonicalSignal({
      ctx,
      group,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo
    });
    if (!canonicalSignalId) continue;
    signalsCreatedOrUpdated += 1;

    const previousFrequency = await loadPreviousFrequency(canonicalSignalId, args.dateFrom);
    const frequency = group.mentionIds.length;
    const sharePct = totalMentions > 0 ? round((frequency / totalMentions) * 100, 2) : 0;
    const deltaVsPrevious = frequency - previousFrequency;
    const observationId = await upsertMonthlySignalObservation({
      canonicalSignalId,
      ctx,
      group,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      outputId: args.outputId,
      totalMentions,
      frequency,
      sharePct,
      deltaVsPrevious,
      importBatchId: args.importBatchId ?? null,
      targetCorpusIds
    });
    if (!observationId) continue;
    observationsCreatedOrUpdated += 1;

    const evidence = group.mentionIds
      .map((id) => mentionMap.get(id))
      .filter((mention): mention is MonthlyCutMentionRow => Boolean(mention))
      .sort((a, b) => mentionEvidenceRank(b) - mentionEvidenceRank(a))
      .slice(0, 12);
    evidenceLinksCreated += await refreshMonthlyObservationEvidence({
      observationId,
      group,
      evidence,
      importBatchId: args.importBatchId ?? null
    });
    await persistMonthlyMentionProvenance({
      group,
      mentions: evidence,
      importBatchId: args.importBatchId ?? null
    });

    outputGroups.push({
      ...group,
      observationId,
      frequency,
      sharePct,
      deltaVsPrevious
    });
  }

  return {
    outputId: args.outputId,
    targetCorpusIds,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    importBatchId: args.importBatchId ?? null,
    totalMentions,
    matchedMentions: new Set(groups.flatMap((group) => group.mentionIds)).size,
    signalsCreatedOrUpdated,
    observationsCreatedOrUpdated,
    evidenceLinksCreated,
    groups: outputGroups
  };
}

async function loadMonthlyCutContext(outputId: string) {
  const pool = await getDbPool();
  const result = await pool.query<MonthlyCutContext>(
    `
      SELECT
        po.id::text AS output_id,
        po.study_corpus_id::text,
        sc.base_corpus_id::text,
        po.brand_id::text,
        po.theme_id::text,
        COALESCE(b.organization_id, t.organization_id)::text AS organization_id
      FROM published_outputs po
      JOIN study_corpora sc ON sc.id = po.study_corpus_id
      LEFT JOIN brands b ON b.id = po.brand_id
      LEFT JOIN themes t ON t.id = po.theme_id
      WHERE po.id = $1
        AND po.status = 'published'
        AND po.archived_at IS NULL
      LIMIT 1
    `,
    [outputId]
  );
  return result.rows[0] ?? null;
}

async function loadMonthlyCutMentions(args: {
  corpusIds: string[];
  dateFrom: string;
  dateTo: string;
  importBatchId: string | null;
}) {
  const pool = await getDbPool();
  const params: unknown[] = [args.corpusIds, args.dateFrom, args.dateTo];
  const where = [
    `m.study_corpus_id = ANY($1::uuid[])`,
    `m.inclusion_status <> 'excluded'`,
    `m.published_at >= $2::date`,
    `m.published_at < ($3::date + INTERVAL '1 day')`
  ];
  if (args.importBatchId) {
    params.push(args.importBatchId);
    where.push(`m.source_file_id = $${params.length}::uuid`);
  }

  const result = await pool.query<MonthlyCutMentionRow>(
    `
      SELECT
        m.id::text,
        m.study_corpus_id::text,
        m.source_file_id::text,
        m.text_clean,
        m.text_snippet,
        m.platform,
        m.resolved_platform,
        m.published_at::text,
        m.sentiment_score::text,
        m.quality_score,
        m.batch_entity_label
      FROM mentions m
      WHERE ${where.join(" AND ")}
      ORDER BY m.published_at DESC, m.created_at DESC
      LIMIT 5000
    `,
    params
  );
  return result.rows;
}

async function upsertMonthlyCanonicalSignal(args: {
  ctx: MonthlyCutContext;
  group: MonthlyCutClassifiedGroup;
  dateFrom: string;
  dateTo: string;
}) {
  const pool = await getDbPool();
  const semanticKey = `monthly-${args.group.key}`;
  const dimensions = {
    source: "monthly_cut_backfill",
    generated_without_llm: true,
    matched_terms: args.group.matchedTerms,
    monthly_signal_pack: args.group.key
  };
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO canonical_signals (
        organization_id, brand_id, theme_id, study_corpus_id, methodology_slug,
        signal_type, canonical_title, semantic_key, description, dimensions,
        status, first_seen_at, last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'active', $11::date, $12::date)
      ON CONFLICT (
        (COALESCE(organization_id::text, '')),
        (COALESCE(brand_id::text, '')),
        (COALESCE(theme_id::text, '')),
        methodology_slug,
        signal_type,
        semantic_key
      )
      DO UPDATE SET
        canonical_title = EXCLUDED.canonical_title,
        description = EXCLUDED.description,
        dimensions = canonical_signals.dimensions || EXCLUDED.dimensions,
        status = 'active',
        first_seen_at = CASE
          WHEN canonical_signals.first_seen_at IS NULL THEN EXCLUDED.first_seen_at
          ELSE LEAST(canonical_signals.first_seen_at, EXCLUDED.first_seen_at)
        END,
        last_seen_at = CASE
          WHEN canonical_signals.last_seen_at IS NULL THEN EXCLUDED.last_seen_at
          ELSE GREATEST(canonical_signals.last_seen_at, EXCLUDED.last_seen_at)
        END,
        updated_at = NOW()
      RETURNING id::text
    `,
    [
      args.ctx.organization_id,
      args.ctx.brand_id,
      args.ctx.theme_id,
      args.ctx.study_corpus_id,
      args.group.methodologySlug,
      args.group.signalType,
      args.group.canonicalTitle,
      semanticKey,
      args.group.description,
      JSON.stringify(dimensions),
      args.dateFrom,
      args.dateTo
    ]
  );
  return result.rows[0]?.id ?? null;
}

async function upsertMonthlySignalObservation(args: {
  canonicalSignalId: string;
  ctx: MonthlyCutContext;
  group: MonthlyCutClassifiedGroup;
  dateFrom: string;
  dateTo: string;
  outputId: string;
  totalMentions: number;
  frequency: number;
  sharePct: number;
  deltaVsPrevious: number;
  importBatchId: string | null;
  targetCorpusIds: string[];
}) {
  const pool = await getDbPool();
  const averageQuality = args.group.averageQuality ?? 60;
  const intensity = clamp(round(args.frequency / Math.max(1, args.totalMentions), 2), 0.01, 1);
  const compositeScore = round((args.sharePct * 0.55) + (Math.min(100, averageQuality) * 0.25) + (Math.min(20, args.frequency) * 1), 3);
  const confidence = args.frequency >= 20 ? "media" : args.frequency >= 5 ? "direccional" : "bounded";
  const metrics = {
    source: "monthly_cut_backfill",
    generated_without_llm: true,
    total_mentions_in_window: args.totalMentions,
    matched_terms: args.group.matchedTerms,
    import_batch_id: args.importBatchId,
    target_corpus_ids: args.targetCorpusIds
  };
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO signal_observations (
        canonical_signal_id, study_corpus_id, published_output_id, methodology_slug,
        signal_type, window_start, window_end, frequency, share_pct,
        intensity, sentiment, composite_score, confidence, delta_vs_previous,
        status, metrics
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::date, $7::date, $8, $9,
        $10, $11, $12, $13, $14, 'observed', $15::jsonb
      )
      ON CONFLICT (canonical_signal_id, published_output_id, window_start, window_end)
      WHERE published_output_id IS NOT NULL
        AND snapshot_id IS NULL
        AND tb_analysis_id IS NULL
        AND engine_analysis_id IS NULL
      DO UPDATE SET
        frequency = EXCLUDED.frequency,
        share_pct = EXCLUDED.share_pct,
        intensity = EXCLUDED.intensity,
        sentiment = EXCLUDED.sentiment,
        composite_score = EXCLUDED.composite_score,
        confidence = EXCLUDED.confidence,
        delta_vs_previous = EXCLUDED.delta_vs_previous,
        metrics = EXCLUDED.metrics,
        status = 'observed'
      RETURNING id::text
    `,
    [
      args.canonicalSignalId,
      args.ctx.study_corpus_id,
      args.outputId,
      args.group.methodologySlug,
      args.group.signalType,
      args.dateFrom,
      args.dateTo,
      args.frequency,
      args.sharePct,
      intensity,
      args.group.averageSentiment,
      compositeScore,
      confidence,
      args.deltaVsPrevious,
      JSON.stringify(metrics)
    ]
  );
  return result.rows[0]?.id ?? null;
}

async function refreshMonthlyObservationEvidence(args: {
  observationId: string;
  group: MonthlyCutClassifiedGroup;
  evidence: MonthlyCutMentionRow[];
  importBatchId: string | null;
}) {
  const pool = await getDbPool();
  await pool.query(`DELETE FROM signal_observation_evidence WHERE signal_observation_id = $1`, [args.observationId]);
  let inserted = 0;
  for (const [index, mention] of args.evidence.entries()) {
    await pool.query(
      `
        INSERT INTO signal_observation_evidence (
          signal_observation_id, mention_id, quote, evidence_role,
          is_protagonist, position, metadata
        )
        VALUES ($1, $2, $3, 'monthly_cut', $4, $5, $6::jsonb)
      `,
      [
        args.observationId,
        mention.id,
        quoteForMention(mention),
        index < 3,
        index,
        JSON.stringify({
          source: "monthly_cut_backfill",
          import_batch_id: args.importBatchId,
          matched_terms: args.group.matchedTerms,
          platform: mention.resolved_platform ?? mention.platform
        })
      ]
    );
    inserted += 1;
  }
  return inserted;
}

async function persistMonthlyMentionProvenance(args: {
  group: MonthlyCutClassifiedGroup;
  mentions: MonthlyCutMentionRow[];
  importBatchId: string | null;
}) {
  const pool = await getDbPool();
  for (const mention of args.mentions) {
    await pool.query(
      `
        INSERT INTO mention_query_sources (
          mention_id, study_corpus_id, import_batch_id, lens_slug,
          signal_intent, scope, match_quality, match_reason, metadata
        )
        SELECT $1, $2, $3, $4, $5, 'monthly_cut', $6, $7, $8::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM mention_query_sources
          WHERE mention_id = $1
            AND COALESCE(lens_slug, '') = $4
            AND COALESCE(signal_intent, '') = $5
            AND metadata->>'source' = 'monthly_cut_backfill'
        )
      `,
      [
        mention.id,
        mention.study_corpus_id,
        args.importBatchId,
        args.group.methodologySlug,
        args.group.signalType,
        matchQuality(args.group, mention),
        `Matched monthly ${args.group.signalType} pack: ${args.group.key}`,
        JSON.stringify({
          source: "monthly_cut_backfill",
          monthly_signal_pack: args.group.key,
          matched_terms: args.group.matchedTerms
        })
      ]
    );
  }
}

async function loadPreviousFrequency(canonicalSignalId: string, dateFrom: string) {
  const pool = await getDbPool();
  const result = await pool.query<{ frequency: number }>(
    `
      SELECT frequency
      FROM signal_observations
      WHERE canonical_signal_id = $1
        AND (window_end IS NULL OR window_end < $2::date)
      ORDER BY window_end DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [canonicalSignalId, dateFrom]
  );
  return Number(result.rows[0]?.frequency ?? 0);
}

async function getDbPool() {
  return (await import("@/lib/db")).pool;
}

function scorePack(normalizedText: string, pack: MonthlyCutPack) {
  const primaryMatches = termsPresent(normalizedText, pack.primaryTerms);
  const secondaryMatches = termsPresent(normalizedText, pack.secondaryTerms);
  const totalTerms = primaryMatches.length + secondaryMatches.length;
  const qualified =
    primaryMatches.length >= (pack.minPrimaryTerms ?? 1) &&
    totalTerms >= (pack.minTotalTerms ?? 1);
  return {
    qualified,
    terms: unique([...primaryMatches, ...secondaryMatches])
  };
}

function termsPresent(normalizedText: string, terms: string[]) {
  return terms.filter((term) => {
    const normalizedTerm = normalizeSearchText(term);
    return normalizedTerm.length > 0 && normalizedText.includes(normalizedTerm);
  });
}

function quoteForMention(mention: MonthlyCutMentionRow) {
  return truncate(mention.text_snippet || mention.text_clean, 360);
}

function mentionEvidenceRank(mention: MonthlyCutMentionRow) {
  const quality = Number(mention.quality_score ?? 50);
  const sentimentWeight = Math.abs(numericValue(mention.sentiment_score) ?? 0) * 20;
  return quality + sentimentWeight + Math.min(20, quoteForMention(mention).length / 20);
}

function matchQuality(group: MonthlyCutClassifiedGroup, mention: MonthlyCutMentionRow) {
  const normalizedText = normalizeSearchText([mention.text_clean, mention.text_snippet].filter(Boolean).join("\n"));
  const matched = group.matchedTerms.filter((term) => normalizedText.includes(normalizeSearchText(term))).length;
  return clamp(round(matched / Math.max(1, group.matchedTerms.length), 3), 0.1, 1);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numericValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 3);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max).replace(/\s+\S*$/, "")}...`;
}
