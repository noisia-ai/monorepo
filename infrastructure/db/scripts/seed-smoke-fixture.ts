import crypto from "node:crypto";
import { Client } from "pg";

const STAGING_PROJECT_ID = "dhpooxvyaaczbtoybcha";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes(STAGING_PROJECT_ID)) {
  throw new Error("Refusing smoke seed: DATABASE_URL is not the configured staging project.");
}

const client = new Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

const runKey = `smoke-${Date.now().toString(36)}`;

type QueryResultRow = Record<string, unknown>;
type SmokeMentionTuple = [intent: "trigger" | "barrier", platform: string, date: string, text: string];

async function q<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  return client.query<T>(sql, params);
}

async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  const result = await q<T>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`Expected one row for SQL: ${sql.slice(0, 120)}`);
  return row;
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function moduleManifest() {
  return {
    overview: true,
    live_composer: true,
    engine_methodology: false,
    tb_decision_field: true,
    opportunities: false,
    competitive_intelligence: false,
    tb_comparative_dashboard: false,
    competitive_tb_matrix: false,
    action_studio: false,
    evidence: true,
    quality_boundaries: false,
    emerging_patterns: false,
    corpus_view: true,
    corpus_chat: false,
    demo_mode: { enabled: false, blurred_sections: [] }
  };
}

const smokeFindings = [
  {
    id: "T-CON-01",
    name: "Sentirse siempre conectado y productivo",
    polarity: "trigger",
    layer: "personal",
    mobility: "movible_por_marca",
    frequency: 7,
    intensity: 0.78,
    predictive: 0.72,
    score: 8.1,
    share: 38,
    evidence: 5,
    quote: "quiero sentir que nunca me quedo sin internet en el metro"
  },
  {
    id: "B-COST-01",
    name: "Miedo a pagar más por datos que no rinden",
    polarity: "barrier",
    layer: "psicologico",
    mobility: "parcialmente_movible",
    frequency: 6,
    intensity: 0.74,
    predictive: 0.68,
    score: 7.5,
    share: 33,
    evidence: 4,
    quote: "terminas pagando más por datos que no rinden"
  },
  {
    id: "B-SUPPORT-01",
    name: "Soporte y portabilidad como fricción de cambio",
    polarity: "barrier",
    layer: "social",
    mobility: "movible_por_marca",
    frequency: 5,
    intensity: 0.71,
    predictive: 0.64,
    score: 7.0,
    share: 29,
    evidence: 4,
    quote: "soporte no resuelve la portabilidad y pierdes días sin línea"
  }
];

const SMOKE_MONTHS = buildSmokeMonths();
const SMOKE_WINDOW_START = SMOKE_MONTHS[0]?.start ?? "2025-01-01";
const SMOKE_WINDOW_END = SMOKE_MONTHS[SMOKE_MONTHS.length - 1]?.end ?? "2026-06-30";
const mentionTexts = buildMentionTexts();
const BRAND_MENTION_COUNT = mentionTexts.brand.length;
const INDUSTRY_MENTION_COUNT = mentionTexts.industry.length;
const TOTAL_MENTION_COUNT = BRAND_MENTION_COUNT + INDUSTRY_MENTION_COUNT;

function buildSmokeMonths() {
  return Array.from({ length: 18 }, (_, index) => {
    const date = new Date(Date.UTC(2025, index, 1));
    const start = date.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const label = date.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
    const period = start.slice(0, 7);
    return { end, index, label, period, start };
  });
}

function mentionDate(month: { index: number; start: string }, offset: number) {
  const date = new Date(`${month.start}T12:00:00Z`);
  date.setUTCDate(Math.min(26, 4 + offset + (month.index % 6)));
  return date.toISOString().slice(0, 10);
}

function platformAt(index: number, offset = 0) {
  const platforms = ["TikTok", "X", "Reddit", "Reviews", "Facebook", "YouTube"];
  return platforms[(index + offset) % platforms.length] ?? "X";
}

function buildMentionTexts(): { brand: SmokeMentionTuple[]; industry: SmokeMentionTuple[] } {
  const brand: SmokeMentionTuple[] = [];
  const industry: SmokeMentionTuple[] = [];
  for (const month of SMOKE_MONTHS) {
    const label = month.label;
    const hotspotTheme = month.index % 3 === 0 ? "hotspot familiar" : month.index % 3 === 1 ? "eSIM rápida" : "datos para trabajar";
    const costTheme = month.index % 2 === 0 ? "datos que no rinden" : "precio que sube después de la promo";
    brand.push([
      "trigger",
      platformAt(month.index),
      mentionDate(month, 3),
      `En ${label}, Operador QA me atrae por ${hotspotTheme}; quiero sentir que nunca me quedo sin internet en juntas, metro o carretera.`
    ]);
    brand.push([
      "barrier",
      platformAt(month.index, 2),
      mentionDate(month, 10),
      `En ${label}, me frena cambiarme a Operador QA por soporte y portabilidad: miedo a perder número o pagar más por ${costTheme}.`
    ]);
    industry.push([
      "trigger",
      platformAt(month.index, 1),
      mentionDate(month, 6),
      `En telefonía móvil México durante ${label}, la categoría se mueve por cobertura estable, más datos reales por peso y activación sin tienda.`
    ]);
    industry.push([
      "barrier",
      platformAt(month.index, 3),
      mentionDate(month, 14),
      `En ${label}, la barrera de industria sigue siendo portabilidad, letra chica de uso justo y desconfianza en cobertura fuera de ciudades grandes.`
    ]);
  }
  return { brand, industry };
}

function countByMonth(rows: readonly SmokeMentionTuple[]) {
  const counts = new Map<string, number>();
  for (const [, , date] of rows) {
    const month = date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([period, mentions]) => ({ period, mentions }));
}

function countByField(rows: readonly SmokeMentionTuple[], field: "platform" | "content_type" | "intent") {
  const counts = new Map<string, number>();
  for (const [intent, platform] of rows) {
    const key = field === "platform" ? platform : field === "content_type" ? platform === "Reviews" ? "review" : "post" : intent;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => field === "content_type" ? { content_type: key, count } : field === "platform" ? { platform: key, count } : { polarity: key, count })
    .sort((a, b) => b.count - a.count);
}

function monthlyObservationSeries(type: "trigger" | "barrier" | "value" | "friction" | "narrative") {
  return SMOKE_MONTHS.flatMap((month) => {
    if (type === "value" && month.index < 6) return [];
    if (type === "friction" && month.index % 2 !== 0) return [];
    if (type === "narrative" && month.index >= 15) return [];
    const base =
      type === "trigger" ? 3 + (month.index % 4) :
      type === "barrier" ? 2 + ((month.index + 1) % 4) :
      type === "value" ? 2 + ((month.index + 2) % 5) :
      type === "friction" ? 1 + ((month.index + 1) % 3) :
      2 + (month.index % 3);
    const previous =
      type === "trigger" ? 3 + ((month.index + 17) % 4) :
      type === "barrier" ? 2 + (month.index % 4) :
      type === "value" ? 2 + ((month.index + 1) % 5) :
      type === "friction" ? 1 + (month.index % 3) :
      2 + ((month.index + 17) % 3);
    const sentiment = type === "trigger" || type === "value" ? 0.18 + (month.index % 4) * 0.04 : type === "narrative" ? -0.04 : -0.18 - (month.index % 3) * 0.04;
    return [[
      month.start,
      base,
      0.55 + Math.min(0.35, base / 20),
      sentiment,
      5.4 + base * 0.42,
      month.index === 0 ? null : base - previous
    ] as const];
  });
}

function outputPayload() {
  const findings = smokeFindings.map((finding) => ({
    finding_id: finding.id,
    finding_name: finding.name,
    polarity: finding.polarity,
    layer: finding.layer,
    mobility: finding.mobility,
    confidence: "media",
    frequency_mentions: finding.frequency,
    intensity_score: finding.intensity,
    predictive_capacity: finding.predictive,
    composite_score: finding.score,
    share_of_findings_pct: finding.share,
    evidence_count: finding.evidence,
    period_start: SMOKE_WINDOW_START,
    period_end: SMOKE_WINDOW_END,
    public_quote: finding.quote
  }));

  return {
    version: 4,
    report: {
      brand_name: "Operador QA",
      methodology_name: "Triggers & Barriers",
      methodology_slug: "triggers-barriers",
      business_question: "¿Qué activa o frena cambiarse a una telefonía chica usando un baseline de industria?",
      headline: "La promesa de conexión gana, pero precio real y soporte frenan el cambio",
      summary:
        "Smoke de Live Intelligence: corpus de marca conectado a baseline de industria, señales persistentes y corpus consultable desde DB."
    },
    manifest: moduleManifest(),
    metrics: { findings_total: 3, barriers_total: 2, triggers_total: 1, movable_total: 2 },
    findings,
    tb_decision_field_nodes: findings.map((finding, index) => ({
      ...finding,
      x: 35 + index * 22,
      y: finding.polarity === "trigger" ? 30 : 68,
      radius: 18,
      actionability_score: 70 - index * 8
    })),
    overview: { top_barriers: findings.filter((item) => item.polarity === "barrier") },
    actions: { best_move: null, alternatives: [], structural_notes: [] },
    barriers: findings.filter((item) => item.polarity === "barrier").map((finding) => ({
      finding_id: finding.finding_id,
      quote: finding.public_quote
    })),
    triggers: findings.filter((item) => item.polarity === "trigger").map((finding) => ({
      finding_id: finding.finding_id,
      quote: finding.public_quote
    })),
    aggregates: {
      corpus: { total_mentions: TOTAL_MENTION_COUNT, window: { start: SMOKE_WINDOW_START, end: SMOKE_WINDOW_END, months: SMOKE_MONTHS.length } },
      polarity_distribution: countByField([...mentionTexts.brand, ...mentionTexts.industry], "intent"),
      layer_distribution: [{ layer: "personal", count: 7 }, { layer: "psicologico", count: 6 }, { layer: "social", count: 5 }],
      mobility_distribution: [{ movilidad: "movible_por_marca", count: 2 }, { movilidad: "parcialmente_movible", count: 1 }],
      platform_distribution: countByField([...mentionTexts.brand, ...mentionTexts.industry], "platform"),
      content_type_distribution: countByField([...mentionTexts.brand, ...mentionTexts.industry], "content_type"),
      volume_timeline: countByMonth([...mentionTexts.brand, ...mentionTexts.industry]),
      finding_time_series: SMOKE_MONTHS.flatMap((month) => [
        { finding_id: "T-CON-01", period: month.period, mentions: 1 + (month.index % 4) },
        { finding_id: "B-COST-01", period: month.period, mentions: 1 + ((month.index + 1) % 3) },
        { finding_id: "B-SUPPORT-01", period: month.period, mentions: 1 + ((month.index + 2) % 3) }
      ]),
      polarity_time_series: SMOKE_MONTHS.map((month) => ({
        period: month.period,
        trigger: 2 + (month.index % 4),
        barrier: 2 + ((month.index + 1) % 4)
      })),
      findings_scatter: smokeFindings.map((finding) => ({
        finding_id: finding.id,
        nombre: finding.name,
        polarity: finding.polarity,
        layer: finding.layer,
        movilidad: finding.mobility,
        frecuencia: finding.frequency,
        intensidad: finding.intensity,
        score: finding.score
      })),
      top_findings_by_voice: smokeFindings.map((finding) => ({ finding_id: finding.id, citation_count: finding.evidence })),
      mentions_sample: []
    },
    client_boundaries: ["Smoke QA; no usar como insight real de cliente."]
  };
}

async function main() {
  await client.connect();
  await q("begin");

  try {
    const org = await one<{ id: string }>(`
      INSERT INTO organizations (slug, legal_name, display_name, hq_country, industry_primary, is_holding, status)
      VALUES ('noisia-staging-smoke', 'Noisia Staging Smoke', 'Noisia Staging Smoke', 'MX', 'qa', false, 'active')
      ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active', updated_at = now()
      RETURNING id
    `);

    const admin = await one<{ id: string }>(`
      INSERT INTO users (email, full_name, user_type, primary_role, organization_id, status)
      VALUES ('smoke-admin@noisia.ai', 'Smoke Admin', 'noisia_internal', 'noisia_admin', null, 'active')
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, status = 'active', last_login_at = now()
      RETURNING id
    `);

    await q(`
      UPDATE published_outputs
      SET archived_at = now(), updated_at = now()
      WHERE title = 'QA Telefonía · Live Intelligence Smoke'
        AND archived_at IS NULL
    `);

    const methodology = await one<{ id: string; version: string }>(`
      SELECT id, version FROM methodologies WHERE slug = 'triggers-barriers' ORDER BY version DESC LIMIT 1
    `);

    const theme = await one<{ id: string }>(
      `
        INSERT INTO themes (organization_id, slug, name, description, industry_focus, geo_focus, status, is_public)
        VALUES ($1, 'telefonia-mx-smoke', 'Telefonía Móvil México · Smoke', 'Baseline QA de industria para smoke multimarca.', ARRAY['telecom','mobile']::text[], ARRAY['MX']::char(2)[], 'active', false)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = 'active'
        RETURNING id
      `,
      [org.id]
    );

    const brand = await one<{ id: string }>(
      `
        INSERT INTO brands (organization_id, slug, name, display_name, industry, industry_sub, countries, description, brand_seed_handles, status)
        VALUES ($1, 'operador-qa-smoke', 'Operador QA', 'Operador QA', 'telecom', 'mobile', ARRAY['MX']::char(2)[], 'Marca chica ficticia para smoke de baseline industria + marca.', ARRAY['Operador QA','@OperadorQA']::text[], 'active')
        ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active', updated_at = now()
        RETURNING id
      `,
      [org.id]
    );

    const baseCorpus = await one<{ id: string }>(
      `
        INSERT INTO study_corpora (name, theme_id, methodology_id, methodology_version_at_creation, business_question, decision_to_inform, audience_segment, geo_focus, target_window_months, status, current_pipeline_version, corpus_first_approved_at)
        VALUES ($1, $2, $3, $4, '¿Cómo se mueve la conversación de telefonía móvil en México?', 'Crear baseline de industria reutilizable para marcas chicas.', 'Usuarios de telefonía móvil en México', ARRAY['MX']::char(2)[], $5, 'corpus_approved', 'smoke-v1', now())
        RETURNING id
      `,
      [`Telefonía MX baseline · ${runKey}`, theme.id, methodology.id, methodology.version, SMOKE_MONTHS.length]
    );

    const brandCorpus = await one<{ id: string }>(
      `
        INSERT INTO study_corpora (name, brand_id, base_corpus_id, methodology_id, methodology_version_at_creation, business_question, decision_to_inform, audience_segment, geo_focus, target_window_months, status, current_pipeline_version, corpus_first_approved_at)
        VALUES ($1, $2, $3, $4, $5, '¿Qué activa o frena cambiarse a Operador QA frente al baseline de telefonía?', 'Validar reuse de corpus base, histórico y corpus explorer.', 'Usuarios con intención de cambiar de telefonía en MX', ARRAY['MX']::char(2)[], $6, 'corpus_approved', 'smoke-v1', now())
        RETURNING id
      `,
      [`Operador QA · T&B + baseline · ${runKey}`, brand.id, baseCorpus.id, methodology.id, methodology.version, SMOKE_MONTHS.length]
    );

    const baseIteration = await one<{ id: string }>(
      `
        INSERT INTO query_iterations (study_corpus_id, iteration_number, query_text, industry_query_text, mentions_returned, quality_score, density_score, noise_score, ai_evaluation_notes, insights_manager_decision, insights_manager_user_id, decision_at, pipeline_version)
        VALUES ($1, 1, 'telefonía móvil México datos cobertura portabilidad', 'telefonía México Telcel AT&T Movistar BAIT datos cobertura soporte', ${INDUSTRY_MENTION_COUNT}, 78, 72, 18, 'Smoke fixture: baseline industry coverage suficiente.', 'approved', $2, now(), 'smoke-v1')
        RETURNING id
      `,
      [baseCorpus.id, admin.id]
    );

    const brandIteration = await one<{ id: string }>(
      `
        INSERT INTO query_iterations (study_corpus_id, iteration_number, query_text, industry_query_text, competitor_query_text, mentions_returned, quality_score, density_score, noise_score, ai_evaluation_notes, insights_manager_decision, insights_manager_user_id, decision_at, pipeline_version)
        VALUES ($1, 1, 'Operador QA datos cobertura portabilidad precio soporte', 'telefonía México datos cobertura portabilidad', 'Telcel AT&T Movistar BAIT datos precio soporte', ${BRAND_MENTION_COUNT}, 76, 70, 20, 'Smoke fixture: marca + baseline listos.', 'approved', $2, now(), 'smoke-v1')
        RETURNING id
      `,
      [brandCorpus.id, admin.id]
    );

    const baseEntity = await one<{ id: string }>(
      `
        INSERT INTO corpus_entities (study_corpus_id, entity_kind, name, aliases, handles, query_seeds, notes, is_category_baseline, priority, status, created_by_user_id)
        VALUES ($1, 'category', 'Telefonía móvil México', ARRAY['telecom MX','telefonía México']::text[], ARRAY[]::text[], ARRAY['datos móviles','cobertura','portabilidad','soporte']::text[], 'Category baseline smoke.', true, 1, 'active', $2)
        RETURNING id
      `,
      [baseCorpus.id, admin.id]
    );

    const brandEntity = await one<{ id: string }>(
      `
        INSERT INTO corpus_entities (study_corpus_id, entity_kind, name, aliases, handles, query_seeds, notes, is_category_baseline, priority, status, created_by_user_id)
        VALUES ($1, 'primary_brand', 'Operador QA', ARRAY['Operador QA']::text[], ARRAY['@OperadorQA']::text[], ARRAY['Operador QA datos','Operador QA portabilidad','Operador QA soporte']::text[], 'Primary brand smoke.', false, 1, 'active', $2)
        RETURNING id
      `,
      [brandCorpus.id, admin.id]
    );

    async function makePack(corpusId: string, iterationId: string, lens: string, intent: string, scope: string, objective: string, queryText: string) {
      return one<{ id: string }>(
        `
          INSERT INTO query_packs (study_corpus_id, query_iteration_id, lens_slug, signal_intent, scope, objective, query_text, query_components, seeds, evaluation, status, mentions_returned, quality_score, density_score, noise_score, cost_budget, created_by_user_id, evaluated_at, approved_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'approved',6,76,70,18,$11::jsonb,$12,now(),now())
          RETURNING id
        `,
        [
          corpusId,
          iterationId,
          lens,
          intent,
          scope,
          objective,
          queryText,
          JSON.stringify({ smoke: true, run_key: runKey }),
          JSON.stringify({ seeds: queryText.split(" ").slice(0, 6) }),
          JSON.stringify({ verdict: "ready", confidence: "directional" }),
          JSON.stringify({ max_mentions: 50, allow_paid_fetch: false }),
          admin.id
        ]
      );
    }

    const packs = {
      brandTrigger: await makePack(brandCorpus.id, brandIteration.id, "triggers-barriers", "triggers", "brand", "Detectar motivadores de cambio a Operador QA.", "Operador QA cambio datos ilimitados cobertura eSIM"),
      brandBarrier: await makePack(brandCorpus.id, brandIteration.id, "triggers-barriers", "barriers", "brand", "Detectar barreras de cambio a Operador QA.", "Operador QA soporte portabilidad precio datos no rinden"),
      baseTrigger: await makePack(baseCorpus.id, baseIteration.id, "triggers-barriers", "triggers", "category", "Detectar motivadores de categoría telefonía.", "telefonía móvil México datos cobertura eSIM valor"),
      baseBarrier: await makePack(baseCorpus.id, baseIteration.id, "triggers-barriers", "barriers", "category", "Detectar barreras de categoría telefonía.", "telefonía México portabilidad soporte cargos cobertura"),
      vpm: await makePack(baseCorpus.id, baseIteration.id, "value-perception-matrix", "functional_value", "baseline", "Probar señal VPM sobre corpus base.", "telefonía datos reales por peso valor percibido"),
      jfm: await makePack(brandCorpus.id, brandIteration.id, "journey-friction-mapping", "portability_friction", "brand", "Probar fricción journey en marca.", "Operador QA portabilidad activación soporte app")
    };

    async function makeBatch(corpusId: string, iterationId: string, entityId: string, label: string, kind: string, recordCount: number) {
      return one<{ id: string }>(
        `
          INSERT INTO import_batches (study_corpus_id, query_iteration_id, mention_type, corpus_entity_id, entity_kind, entity_label, source_system, source_file_name, imported_by_user_id, record_count, included_count, excluded_count, duplicate_count, status)
          VALUES ($1,$2,$3,$4,$5,$6,'smoke_csv',$7,$8,$9,$9,0,0,'processed')
          RETURNING id
        `,
        [corpusId, iterationId, kind === "category" ? "industry" : "brand", entityId, kind, label, `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${runKey}.csv`, admin.id, recordCount]
      );
    }

    const baseBatch = await makeBatch(baseCorpus.id, baseIteration.id, baseEntity.id, "Telefonía móvil México", "category", INDUSTRY_MENTION_COUNT);
    const brandBatch = await makeBatch(brandCorpus.id, brandIteration.id, brandEntity.id, "Operador QA", "primary_brand", BRAND_MENTION_COUNT);
    const insertedMentions: Array<{ date: string; id: string; scope: "brand" | "industry"; intent: string; text: string }> = [];

    for (const scope of ["industry", "brand"] as const) {
      const corpusId = scope === "brand" ? brandCorpus.id : baseCorpus.id;
      const batchId = scope === "brand" ? brandBatch.id : baseBatch.id;
      const entityId = scope === "brand" ? brandEntity.id : baseEntity.id;
      const entityLabel = scope === "brand" ? "Operador QA" : "Telefonía móvil México";
      const rows = mentionTexts[scope];

      for (const [index, [intent, platform, date, text]] of rows.entries()) {
        const externalId = `${runKey}-${scope}-${index + 1}`;
        const mention = await one<{ id: string }>(
          `
            INSERT INTO mentions (study_corpus_id, external_id, source_system, source_file_id, text_hash, text_raw, text_clean, text_snippet, title, text_length, language, published_at, platform, resolved_platform, content_type, batch_entity_label, url, country, engagement, sentiment_source, sentiment_score, quality_score, inclusion_status, quality_flags, raw_metadata)
            VALUES ($1,$2,'smoke_csv',$3,$4,$5,$5,$6,$7,$8,'es',$9::timestamptz,$10,$10,$11,$12,$13,'MX',$14::jsonb,'fixture',$15,82,'included',$16::jsonb,$17::jsonb)
            RETURNING id
          `,
          [
            corpusId,
            externalId,
            batchId,
            hash(`${corpusId}:${text}`),
            text,
            text.slice(0, 180),
            `Smoke mention ${index + 1}`,
            text.length,
            `${date}T12:00:00-06:00`,
            platform,
            platform === "Reviews" ? "review" : "post",
            entityLabel,
            `https://example.com/${externalId}`,
            JSON.stringify({ likes: 10 + index, shares: index }),
            intent === "trigger" ? 0.35 : -0.28,
            JSON.stringify({ smoke: true }),
            JSON.stringify({ scope, intent, run_key: runKey })
          ]
        );
        insertedMentions.push({ date, id: mention.id, scope, intent, text });

        const pack = scope === "brand"
          ? intent === "trigger" ? packs.brandTrigger : packs.brandBarrier
          : intent === "trigger" ? packs.baseTrigger : packs.baseBarrier;

        await q(
          `
            INSERT INTO mention_query_sources (mention_id, study_corpus_id, query_pack_id, query_iteration_id, import_batch_id, lens_slug, signal_intent, scope, corpus_entity_id, entity_id, match_quality, match_reason, metadata)
            VALUES ($1,$2,$3,$4,$5,'triggers-barriers',$6,$7,$8,$9,0.92,'smoke direct fixture',$10::jsonb)
            ON CONFLICT DO NOTHING
          `,
          [
            mention.id,
            corpusId,
            pack.id,
            scope === "brand" ? brandIteration.id : baseIteration.id,
            batchId,
            intent === "trigger" ? "triggers" : "barriers",
            scope === "brand" ? "brand" : "category",
            entityId,
            entityLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            JSON.stringify({ smoke: true, source_pack: pack.id })
          ]
        );

        if ((scope === "industry" && index % 3 === 0) || (scope === "brand" && index % 4 === 0)) {
          const overlapPack = scope === "industry" ? packs.vpm : packs.jfm;
          await q(
            `
              INSERT INTO mention_query_sources (mention_id, study_corpus_id, query_pack_id, query_iteration_id, import_batch_id, lens_slug, signal_intent, scope, corpus_entity_id, entity_id, match_quality, match_reason, metadata)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0.82,'smoke multilens overlap',$11::jsonb)
              ON CONFLICT DO NOTHING
            `,
            [
              mention.id,
              corpusId,
              overlapPack.id,
              scope === "brand" ? brandIteration.id : baseIteration.id,
              batchId,
              scope === "industry" ? "value-perception-matrix" : "journey-friction-mapping",
              scope === "industry" ? "functional_value" : "portability_friction",
              scope === "brand" ? "brand" : "baseline",
              entityId,
              entityLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              JSON.stringify({ smoke: true, overlap: true })
            ]
          );
        }
      }
    }

    const baseSnapshot = await one<{ id: string }>(
      `
        INSERT INTO corpus_snapshots (study_corpus_id, label, kind, mention_count, scores_at_snapshot, created_by_user_id)
        VALUES ($1,'Smoke approval baseline','approval',$2,$3::jsonb,$4)
        RETURNING id
      `,
      [baseCorpus.id, INDUSTRY_MENTION_COUNT, JSON.stringify({ triggers: 35, barriers: 40, noise: 18 }), admin.id]
    );
    const brandSnapshot = await one<{ id: string }>(
      `
        INSERT INTO corpus_snapshots (study_corpus_id, label, kind, mention_count, scores_at_snapshot, created_by_user_id)
        VALUES ($1,'Smoke approval brand','approval',$2,$3::jsonb,$4)
        RETURNING id
      `,
      [brandCorpus.id, BRAND_MENTION_COUNT, JSON.stringify({ triggers: 38, barriers: 42, noise: 20 }), admin.id]
    );

    for (const mention of insertedMentions) {
      await q("INSERT INTO corpus_snapshot_mentions (snapshot_id, mention_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
        mention.scope === "brand" ? brandSnapshot.id : baseSnapshot.id,
        mention.id
      ]);
    }

    await q(
      `
        INSERT INTO corpus_snapshot_aggregates (snapshot_id, study_corpus_id, total_mentions, window_start, window_end, platform_distribution, content_type_distribution, volume_timeline)
        VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::jsonb,$8::jsonb),
               ($9,$10,$11,$4::timestamptz,$5::timestamptz,$12::jsonb,$13::jsonb,$14::jsonb)
        ON CONFLICT (snapshot_id) DO UPDATE SET refreshed_at = now()
      `,
      [
        baseSnapshot.id,
        baseCorpus.id,
        INDUSTRY_MENTION_COUNT,
        SMOKE_WINDOW_START,
        SMOKE_WINDOW_END,
        JSON.stringify(countByField(mentionTexts.industry, "platform")),
        JSON.stringify(countByField(mentionTexts.industry, "content_type")),
        JSON.stringify(countByMonth(mentionTexts.industry)),
        brandSnapshot.id,
        brandCorpus.id,
        BRAND_MENTION_COUNT,
        JSON.stringify(countByField(mentionTexts.brand, "platform")),
        JSON.stringify(countByField(mentionTexts.brand, "content_type")),
        JSON.stringify(countByMonth(mentionTexts.brand))
      ]
    );

    const tbAnalysis = await one<{ id: string }>(
      `
        INSERT INTO tb_analyses (study_corpus_id, snapshot_id, pipeline_version, methodology_version, status, current_step, business_question, decision_to_inform, meta_json, corpus_snapshot_json, activation_playbook, friction_removal_plan, comparative_brief, limitations, confidence_per_finding, executed_by_user_id, approved_by_im_user_id, approved_by_kam_user_id, executed_at, im_approved_at, kam_approved_at)
        VALUES ($1,$2,'smoke-v1',$3,'approved_by_kam','done','¿Qué activa o frena cambiarse a Operador QA frente al baseline de telefonía?','Validar smoke live intelligence',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$11,$11,now(),now(),now())
        RETURNING id
      `,
      [
        brandCorpus.id,
        brandSnapshot.id,
        methodology.version,
        JSON.stringify({ smoke: true, run_key: runKey }),
        JSON.stringify({ mention_count: BRAND_MENTION_COUNT, base_corpus_id: baseCorpus.id, window_start: SMOKE_WINDOW_START, window_end: SMOKE_WINDOW_END }),
        JSON.stringify({ smoke: true }),
        JSON.stringify({ smoke: true }),
        JSON.stringify({ smoke: true, baseline_corpus_id: baseCorpus.id }),
        JSON.stringify(["Smoke fixture; no insight real."]),
        JSON.stringify({ "T-CON-01": "media", "B-COST-01": "media", "B-SUPPORT-01": "media" }),
        admin.id
      ]
    );

    const findingIds: Record<string, string> = {};
    for (const [position, finding] of smokeFindings.entries()) {
      const row = await one<{ id: string }>(
        `
          INSERT INTO tb_findings (tb_analysis_id, finding_id, polarity, layer, nombre_comercial, frecuencia, intensidad_promedio, capacidad_predictiva, score_compuesto, movilidad, movilidad_razon, confidence, period_start, period_end, cita_protagonista, raw_data, position_in_layer)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'media',$12,$13,$14::jsonb,$15::jsonb,$16)
          RETURNING id
        `,
        [
          tbAnalysis.id,
          finding.id,
          finding.polarity,
          finding.layer,
          finding.name,
          finding.frequency,
          finding.intensity,
          finding.predictive,
          finding.score,
          finding.mobility,
          "Smoke mobility rationale.",
          SMOKE_WINDOW_START,
          SMOKE_WINDOW_END,
          JSON.stringify({ quote: finding.quote }),
          JSON.stringify({ smoke: true }),
          position + 1
        ]
      );
      findingIds[finding.id] = row.id;
    }

    const chooseFinding = (mention: { intent: string; text: string }) => {
      if (mention.intent === "trigger") return "T-CON-01";
      if (mention.text.includes("soporte") || mention.text.includes("portabilidad") || mention.text.includes("app")) return "B-SUPPORT-01";
      return "B-COST-01";
    };

    for (const mention of insertedMentions.filter((item) => item.scope === "brand")) {
      const key = chooseFinding(mention);
      await q(
        `
          INSERT INTO tb_mention_codings (tb_analysis_id, mention_id, finding_id, polarity, layer, intensity_score, emergent_tags, ambiguous)
          VALUES ($1,$2,$3,$4,$5,0.76,$6::text[],false)
          ON CONFLICT DO NOTHING
        `,
        [
          tbAnalysis.id,
          mention.id,
          findingIds[key],
          key.startsWith("T-") ? "trigger" : "barrier",
          key === "T-CON-01" ? "personal" : key === "B-COST-01" ? "psicologico" : "social",
          [key.toLowerCase(), "smoke"]
        ]
      );
      await q(
        `
          INSERT INTO tb_finding_citations (finding_id, mention_id, is_protagonist, position)
          VALUES ($1,$2,true,1)
          ON CONFLICT DO NOTHING
        `,
        [findingIds[key], mention.id]
      );
    }

    const output = await one<{ id: string }>(
      `
        INSERT INTO published_outputs (tb_analysis_id, study_corpus_id, brand_id, methodology_slug, output_type, status, title, headline, summary, manifest, payload, version, created_by_user_id, published_by_user_id, published_at)
        VALUES ($1,$2,$3,'triggers-barriers','narrative_dashboard','published','QA Telefonía · Live Intelligence Smoke','La conexión gana, el costo real y soporte frenan','Output smoke para corpus vivo + baseline + histórico.',$4::jsonb,$5::jsonb,1,$6,$6,now())
        RETURNING id
      `,
      [tbAnalysis.id, brandCorpus.id, brand.id, JSON.stringify(moduleManifest()), JSON.stringify(outputPayload()), admin.id]
    );

    const signalDefs = [
      { type: "trigger", slug: "triggers-barriers", key: "always-connected-productivity", title: "Sentirse siempre conectado y productivo", corpus: brandCorpus.id, brand: brand.id, theme: null, finding: findingIds["T-CON-01"], status: "active", dimensions: { lens: "T&B", layer: "personal", mobility: "movible_por_marca" }, observations: monthlyObservationSeries("trigger") },
      { type: "barrier", slug: "triggers-barriers", key: "data-cost-does-not-yield", title: "Miedo a pagar más por datos que no rinden", corpus: brandCorpus.id, brand: brand.id, theme: null, finding: findingIds["B-COST-01"], status: "active", dimensions: { lens: "T&B", layer: "psicologico", mobility: "parcialmente_movible" }, observations: monthlyObservationSeries("barrier") },
      { type: "barrier", slug: "triggers-barriers", key: "support-portability-friction", title: "Soporte y portabilidad como fricción de cambio", corpus: brandCorpus.id, brand: brand.id, theme: null, finding: findingIds["B-SUPPORT-01"], status: "active", dimensions: { lens: "T&B", layer: "social", mobility: "movible_por_marca" }, observations: monthlyObservationSeries("barrier") },
      { type: "value", slug: "value-perception-matrix", key: "real-data-per-peso", title: "Más datos reales por peso como valor percibido", corpus: baseCorpus.id, brand: null, theme: theme.id, finding: null, status: "active", dimensions: { lens: "VPM", axis: "functional_value" }, observations: monthlyObservationSeries("value") },
      { type: "friction", slug: "journey-friction-mapping", key: "portability-activation-friction", title: "Portabilidad y activación como fricción del journey", corpus: brandCorpus.id, brand: brand.id, theme: null, finding: null, status: "active", dimensions: { lens: "JFM", phase: "switching" }, observations: monthlyObservationSeries("friction") },
      { type: "narrative", slug: "narrative-ownership", key: "incumbents-own-network-trust", title: "Los incumbentes todavía poseen la narrativa de confianza de red", corpus: baseCorpus.id, brand: null, theme: theme.id, finding: null, status: "active", dimensions: { lens: "Narrative Ownership", owner: "incumbents" }, observations: monthlyObservationSeries("narrative") }
    ];

    for (const signalDef of signalDefs) {
      const signal = await one<{ id: string }>(
        `
          INSERT INTO canonical_signals (organization_id, brand_id, theme_id, study_corpus_id, methodology_slug, signal_type, canonical_title, semantic_key, description, dimensions, status, first_seen_at, last_seen_at, created_from_tb_finding_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::timestamptz,$13::timestamptz,$14)
          RETURNING id
        `,
        [
          org.id,
          signalDef.brand,
          signalDef.theme,
          signalDef.corpus,
          signalDef.slug,
          signalDef.type,
          signalDef.title,
          `${signalDef.key}-${runKey}`,
          `Smoke signal: ${signalDef.title}`,
          JSON.stringify(signalDef.dimensions),
          signalDef.status,
          SMOKE_WINDOW_START,
          SMOKE_WINDOW_END,
          signalDef.finding
        ]
      );

      for (const [windowStart, frequency, intensity, sentiment, score, delta] of signalDef.observations) {
        const observation = await one<{ id: string }>(
          `
            INSERT INTO signal_observations (canonical_signal_id, study_corpus_id, published_output_id, methodology_slug, signal_type, window_start, window_end, frequency, share_pct, intensity, sentiment, composite_score, confidence, rank, delta_vs_previous, status, metrics)
            VALUES ($1,$2,$3,$4,$5,$6::date,($6::date + interval '1 month - 1 day')::date,$7::int,($7::numeric / $13::numeric * 100),$8::numeric,$9::numeric,$10::numeric,'media',1,$11::numeric,'observed',$12::jsonb)
            RETURNING id
          `,
          [
            signal.id,
            signalDef.corpus,
            output.id,
            signalDef.slug,
            signalDef.type,
            windowStart,
            frequency,
            intensity,
            sentiment,
            score,
            delta,
            JSON.stringify({ smoke: true, run_key: runKey }),
            TOTAL_MENTION_COUNT
          ]
        );

        const candidates = insertedMentions
          .filter((mention) => {
            if (mention.date.slice(0, 7) !== windowStart.slice(0, 7)) return false;
            if (signalDef.type === "trigger") return mention.intent === "trigger" && mention.scope === "brand";
            if (signalDef.type === "barrier") return mention.intent === "barrier" && mention.scope === "brand";
            if (signalDef.slug === "value-perception-matrix") return mention.scope === "industry" && mention.text.includes("datos");
            if (signalDef.slug === "journey-friction-mapping") return mention.scope === "brand" && (mention.text.includes("portabilidad") || mention.text.includes("app"));
            return mention.scope === "industry";
          })
          .slice(0, 3);

        for (const [position, mention] of candidates.entries()) {
          await q(
            `
              INSERT INTO signal_observation_evidence (signal_observation_id, mention_id, quote, evidence_role, is_protagonist, position, metadata)
              VALUES ($1,$2,$3,'supporting',$4,$5,$6::jsonb)
            `,
            [observation.id, mention.id, mention.text.slice(0, 240), position === 0, position + 1, JSON.stringify({ smoke: true })]
          );
        }
      }
    }

    await q("UPDATE study_corpora SET first_published_at = now(), updated_at = now() WHERE id in ($1,$2)", [
      brandCorpus.id,
      baseCorpus.id
    ]);

    await q("commit");

    const summary = await one<{
      output_id: string;
      brand_corpus_id: string;
      base_corpus_id: string;
      mentions: number;
      query_packs: number;
      canonical_signals: number;
      observations: number;
      evidence: number;
    }>(
      `
        SELECT
          $1::uuid::text AS output_id,
          $2::uuid::text AS brand_corpus_id,
          $3::uuid::text AS base_corpus_id,
          (SELECT count(*)::int FROM mentions WHERE study_corpus_id in ($2,$3)) AS mentions,
          (SELECT count(*)::int FROM query_packs WHERE study_corpus_id in ($2,$3)) AS query_packs,
          (SELECT count(*)::int FROM canonical_signals WHERE organization_id = $4) AS canonical_signals,
          (SELECT count(*)::int FROM signal_observations so JOIN canonical_signals cs ON cs.id = so.canonical_signal_id WHERE cs.organization_id = $4) AS observations,
          (SELECT count(*)::int FROM signal_observation_evidence soe JOIN signal_observations so ON so.id = soe.signal_observation_id JOIN canonical_signals cs ON cs.id = so.canonical_signal_id WHERE cs.organization_id = $4) AS evidence
      `,
      [output.id, brandCorpus.id, baseCorpus.id, org.id]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          run_key: runKey,
          ...summary,
          local_signal_url: `http://localhost:3001/signal/${summary.output_id}`
        },
        null,
        2
      )
    );
  } catch (error) {
    await q("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
