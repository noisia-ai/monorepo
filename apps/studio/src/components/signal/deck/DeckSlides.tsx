/* Builds the press-deck slides from the Signal view model.
   Server component: returns a fragment of <section.deck-slide> elements that
   become the direct children (slides) of <deck-stage>. Each section is one
   PDF page. Content is sized to fill the 1080px canvas without cutting. */

import type { ReactNode } from "react";
import {
  AlertTriangle,
  BarChart2,
  Hash,
  Info,
  Layers,
  Move,
  PieChart,
  Search,
  Zap,
} from "react-feather";

import { DeckBars, DeckDonut, DeckLegend, type DeckSlice } from "@/components/signal/deck/DeckCharts";
import type { TbDashboardViewModel } from "@/lib/signal/adapters/tb";

type Lang = "en" | "es";

type DeckMeta = {
  brandLabel: string;
  methodologyName: string;
  windowLabel: string | null;
  corpusTotal: number;
  dateLabel: string;
  liveIntelligence: {
    status: string;
    signals: number;
    observations: number;
    evidence: number;
  } | null;
};

const COLORS = {
  trigger: "#008a8a",
  barrier: "#ee0b00",
  mixed: "#2b2b2f",
  quiet: "#8a9099",
  positive: "#008f66",
  layer: ["#008a8a", "#00b4b4", "#4b1d95", "#c4a8e8"],
};

const T = {
  en: {
    clientReport: "Client report",
    forWho: "Prepared for",
    methodology: "Methodology",
    window: "Window",
    date: "Date",
    execReading: "Executive reading",
    whatWeFound: "What the corpus is telling you",
    decisionToInform: "Decision to inform",
    confirmed: "Confirmed by the corpus",
    signalStrength: "Signal landscape",
    engineLens: "Methodology lens",
    engineLensSub: "Beta lens output with traceable evidence and readiness gates.",
    readiness: "Readiness",
    topMethodSignals: "Top methodology signals",
    conclusions: "Conclusions",
    missing: "Missing",
    findings: "Findings",
    triggers: "Triggers",
    barriers: "Barriers",
    movable: "Brand-movable",
    publishedMentions: "published mentions",
    dashboardTitle: "The signal at a glance",
    decisionField: "Decision Field",
    decisionFieldSub: "Where each decision force lives — and how much the brand can move it.",
    matrixNote:
      "How to read this: columns are the layer where the decision is made (from personal habits to cultural codes); rows are how much your brand can move each force. Teal = a motivation that pulls people toward you (trigger); red = a friction that holds them back (barrier).",
    actOn: "Act on it",
    actOnNote: "Direct brand action shifts this",
    shapeIt: "Shape it",
    shapeItNote: "Influence with partners, formats, timing",
    respectIt: "Respect it",
    respectItNote: "Structural — design around it",
    noSignal: "No signal",
    priorities: "Decision priorities",
    prioritiesSub: "The findings carrying the most weight in this cut.",
    evidence: "evidence",
    score: "score",
    opportunities: "Opportunities",
    opportunitiesSub: "Findings compressed into decision bets.",
    whatToDo: "What to do",
    polarity: "Polarity composition",
    byLayer: "Tension by decision layer",
    byPlatform: "Where the conversation lives",
    ofFindings: "of findings",
    highestTension: "Highest tension",
    topChannel: "Lead channel",
    actionStudio: "Action Studio",
    actionStudioSub: "What each team does with this — beyond the diagnosis.",
    emerging: "Emerging patterns",
    emergingSub: "Open signals from the corpus, beyond the method.",
    boundaries: "Quality & boundaries",
    boundariesSub: "What this published cut can and cannot claim.",
    liveMemory: "Live memory",
    liveMemoryNote: "linked to persistent signals",
    closingTitle: "From conversation to decision.",
    section: "Section",
    validated: "Validated by Noisia AI",
    layers: { personal: "Personal", psicologico: "Psychological", social: "Social", cultural: "Cultural" } as Record<string, string>,
  },
  es: {
    clientReport: "Reporte de cliente",
    forWho: "Preparado para",
    methodology: "Metodología",
    window: "Ventana",
    date: "Fecha",
    execReading: "Lectura ejecutiva",
    whatWeFound: "Lo que el corpus te está diciendo",
    decisionToInform: "Decisión a informar",
    confirmed: "Confirmado por el corpus",
    signalStrength: "Panorama de señal",
    engineLens: "Lente metodológico",
    engineLensSub: "Output beta del lente con evidencia trazable y gates de readiness.",
    readiness: "Readiness",
    topMethodSignals: "Señales principales del método",
    conclusions: "Conclusiones",
    missing: "Falta",
    findings: "Hallazgos",
    triggers: "Triggers",
    barriers: "Barreras",
    movable: "Movibles por marca",
    publishedMentions: "menciones publicadas",
    dashboardTitle: "La señal de un vistazo",
    decisionField: "Decision Field",
    decisionFieldSub: "Dónde vive cada fuerza de decisión — y cuánto puede moverla la marca.",
    matrixNote:
      "Cómo leerlo: las columnas son la capa donde se toma la decisión (de hábitos personales a códigos culturales); las filas son cuánto puede moverla tu marca. Teal = una motivación que acerca a la gente (trigger); rojo = una fricción que la frena (barrera).",
    actOn: "Actúa",
    actOnNote: "La acción directa de marca lo mueve",
    shapeIt: "Modela",
    shapeItNote: "Influye con aliados, formatos, timing",
    respectIt: "Respeta",
    respectItNote: "Estructural — diseña alrededor",
    noSignal: "Sin señal",
    priorities: "Prioridades de decisión",
    prioritiesSub: "Los hallazgos que más pesan en este corte.",
    evidence: "evidencia",
    score: "score",
    opportunities: "Oportunidades",
    opportunitiesSub: "Hallazgos compactados en apuestas de decisión.",
    whatToDo: "Qué hacer",
    polarity: "Composición de polaridad",
    byLayer: "Tensión por capa de decisión",
    byPlatform: "Dónde vive la conversación",
    ofFindings: "de hallazgos",
    highestTension: "Mayor tensión",
    topChannel: "Canal principal",
    actionStudio: "Action Studio",
    actionStudioSub: "Qué hace cada equipo con esto — más allá del diagnóstico.",
    emerging: "Patrones emergentes",
    emergingSub: "Señales abiertas del corpus, fuera del método.",
    boundaries: "Calidad y límites",
    boundariesSub: "Qué puede y qué no puede afirmar este corte publicado.",
    liveMemory: "Memoria viva",
    liveMemoryNote: "ligada a señales persistentes",
    closingTitle: "De la conversación a la decisión.",
    section: "Sección",
    validated: "Validado por Noisia AI",
    layers: { personal: "Personal", psicologico: "Psicológico", social: "Social", cultural: "Cultural" } as Record<string, string>,
  },
} satisfies Record<Lang, Record<string, unknown>>;

const TEAM_LABELS: Record<string, { en: string; es: string }> = {
  brand_strategy: { en: "Brand Strategy", es: "Estrategia de Marca" },
  creative_content: { en: "Creative / Content", es: "Creativo / Contenido" },
  product_cx: { en: "Product / CX", es: "Producto / CX" },
  retail_media: { en: "Retail / Media", es: "Retail / Media" },
  measurement: { en: "Measurement", es: "Medición" },
  cultural_guardrails: { en: "Guardrails", es: "Guardrails" },
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}
function prettify(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function truncate(value: string, max: number) {
  if (!value) return "";
  const clean = decodeEntities(value).trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
function topRow<T extends { value: number }>(rows: T[]): T | null {
  return rows.reduce<T | null>((best, r) => (!best || r.value > best.value ? r : best), null);
}

const LOGO = "/assets/logos/logo_black.svg";

export function DeckSlides({
  vm,
  meta,
  lang,
}: {
  vm: TbDashboardViewModel;
  meta: DeckMeta;
  lang: Lang;
}) {
  const t = T[lang];
  const slides: Array<{ key: string; node: (num: number, total: number) => ReactNode }> = [];

  /* 1 · Cover — vertically centered */
  slides.push({
    key: "cover",
    node: () => (
      <section className="deck-slide deck-cover" data-label="Cover">
        <div className="deck-atmos" />
        <div className="deck-frame">
          <div className="deck-cover-body">
            <span className="deck-eyebrow is-signal">
              <i className="deck-dot" />
              {t.clientReport}
            </span>
            <h1 className="deck-title is-lg">{truncate(vm.report.headline || meta.brandLabel, 120)}</h1>
            {vm.report.business_question ? (
              <p className="deck-lede">{truncate(vm.report.business_question, 220)}</p>
            ) : null}
            <dl className="deck-cover-meta">
              <div>
                <dt>{t.forWho}</dt>
                <dd>{meta.brandLabel}</dd>
              </div>
              <div>
                <dt>{t.methodology}</dt>
                <dd>{meta.methodologyName}</dd>
              </div>
              {meta.windowLabel ? (
                <div>
                  <dt>{t.window}</dt>
                  <dd>{meta.windowLabel}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t.date}</dt>
                <dd>{meta.dateLabel}</dd>
              </div>
            </dl>
          </div>
          <div className="deck-foot">
            <span className="deck-brand-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="deck-logo-img" src={LOGO} alt="Noisia" style={{ height: 28 }} /> · Social Intelligence
              Architects
            </span>
            <span>noisia.ai</span>
          </div>
        </div>
      </section>
    ),
  });

  /* 2 · Executive reading */
  const answer = vm.knowledgeImpact?.business_question_answer || vm.report.summary;
  slides.push({
    key: "exec",
    node: (num, total) =>
      shell({
        num,
        total,
        meta,
        eyebrow: t.execReading,
        icon: <Search size={17} />,
        children: (
          <div className="deck-cols is-wide-left">
            <div className="deck-stack is-center">
              <h2 className="deck-title">{t.whatWeFound}</h2>
              <p className="deck-body">{truncate(answer, 560)}</p>
            </div>
            <div className="deck-stack is-center">
              {vm.knowledgeImpact?.decision_to_inform ? (
                <div className="deck-card">
                  <span className="deck-card-eyebrow"><Move size={16} /> {t.decisionToInform}</span>
                  <p>{truncate(vm.knowledgeImpact.decision_to_inform, 320)}</p>
                </div>
              ) : null}
              {vm.knowledgeImpact?.confirmed_by_corpus?.[0] ? (
                <div className="deck-card">
                  <span className="deck-card-eyebrow" style={{ color: COLORS.positive }}>
                    <Zap size={16} /> {t.confirmed}
                  </span>
                  <p>{truncate(vm.knowledgeImpact.confirmed_by_corpus[0], 320)}</p>
                </div>
              ) : null}
            </div>
          </div>
        ),
      }),
  });

  /* Engine beta lens — only appears for engine outputs */
  const engineView = vm.engineBlock?.methodology_view ?? null;
  if (engineView) {
    slides.push({
      key: "engine-view",
      node: (num, total) =>
        shell({
          num,
          total,
          meta,
          eyebrow: t.engineLens,
          icon: <Layers size={17} />,
          title: engineView.title,
          compactTitle: true,
          children: (
            <div className="deck-cols is-wide-left">
              <div className="deck-stack is-center">
                <p className="deck-body">{truncate(engineView.primary_question || vm.engineBlock?.summary || "", 460)}</p>
                <div className="deck-cards cols-2" style={{ marginTop: 8 }}>
                  {engineView.cards.slice(0, 4).map((card) => (
                    <article className="deck-card" key={card.label}>
                      <span className="deck-card-eyebrow">{card.label}</span>
                      <h4 style={{ fontSize: 36 }}>{truncate(card.value, 42)}</h4>
                      <p>{truncate(card.detail, 170)}</p>
                      <div className="deck-card-meta">
                        <span className="deck-chip">{prettify(card.confidence)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
              <div className="deck-stack is-center">
                <div className="deck-card">
                  <span className="deck-card-eyebrow"><Info size={16} /> {t.readiness}</span>
                  <h4>{prettify(engineView.readiness.status)}</h4>
                  <p>{truncate(engineView.readiness.reason, 260)}</p>
                  {engineView.readiness.missing.length > 0 ? (
                    <div className="deck-card-meta">
                      <span className="deck-chip">{t.missing}: {truncate(engineView.readiness.missing.join(", "), 90)}</span>
                    </div>
                  ) : null}
                </div>
                {vm.engineBlock?.limitations?.[0] ? (
                  <div className="deck-card">
                    <span className="deck-card-eyebrow"><AlertTriangle size={16} /> {t.boundaries}</span>
                    <p>{truncate(vm.engineBlock.limitations[0], 260)}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ),
        }),
    });

    if (engineView.rows.length > 0 || engineView.conclusions.length > 0) {
      slides.push({
        key: "engine-signals",
        node: (num, total) =>
          shell({
            num,
            total,
            meta,
            eyebrow: t.engineLens,
            icon: <BarChart2 size={17} />,
            title: t.topMethodSignals,
            compactTitle: true,
            children: (
              <div className="deck-cols is-even">
                <div>
                  <span className="deck-card-eyebrow">{t.topMethodSignals}</span>
                  <div className="deck-cards cols-1" style={{ marginTop: 12 }}>
                    {engineView.rows.slice(0, 5).map((row, index) => (
                      <article className="deck-card" key={`${row.finding_id}-${index}`}>
                        <span className="deck-card-rank">{String(index + 1).padStart(2, "0")}</span>
                        <h4 style={{ fontSize: 24 }}>{truncate(row.label, 88)}</h4>
                        <p>{truncate(row.axis ?? row.entity ?? "Sin eje secundario", 160)}</p>
                        <div className="deck-card-meta">
                          <span className="deck-chip">{fmt(row.evidence_count)} {t.evidence}</span>
                          <span className="deck-chip">{t.score} {row.score === null ? "n/a" : row.score.toFixed(2)}</span>
                          <span className="deck-chip">{prettify(row.confidence)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="deck-card-eyebrow">{t.conclusions}</span>
                  <div className="deck-cards cols-1" style={{ marginTop: 12 }}>
                    {engineView.conclusions.slice(0, 5).map((item, index) => (
                      <article className="deck-card" key={`${item.kind}-${index}`}>
                        <span className="deck-card-eyebrow">{prettify(item.kind)}</span>
                        <h4 style={{ fontSize: 24 }}>{truncate(item.title, 88)}</h4>
                        <p>{truncate(item.detail, 220)}</p>
                        {item.finding_ids.length > 0 ? (
                          <div className="deck-card-meta">
                            <span className="deck-chip">{truncate(item.finding_ids.join(", "), 90)}</span>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            ),
          }),
      });
    }
  }

  /* 3 · Dashboard — metrics + the three charts in one view */
  const m = vm.metrics;
  const polarity = chartRows(vm.aggregates.polarity_distribution, "polarity").map((r) => ({
    label: prettify(r.key),
    value: r.count,
    color: r.key === "barrier" ? COLORS.barrier : r.key === "trigger" ? COLORS.trigger : r.key === "mixed" ? COLORS.mixed : COLORS.quiet,
  }));
  const layers = chartRows(vm.aggregates.layer_distribution, "layer").map((r, i) => ({
    label: t.layers[r.key] ?? prettify(r.key),
    value: r.count,
    color: COLORS.layer[i % COLORS.layer.length] ?? COLORS.trigger,
  }));
  const platforms = chartRows(vm.aggregates.platform_distribution, "platform").slice(0, 6).map((r) => ({
    label: prettify(r.key),
    value: r.count,
  }));
  const polarityTotal = polarity.reduce((s, p) => s + p.value, 0);
  const polarityTop = topRow(polarity);
  const layerTop = topRow(layers);
  const platformTop = topRow(platforms);
  const polarityNote = polarityTop
    ? `${polarityTop.label} · ${Math.round((polarityTop.value / Math.max(1, polarityTotal)) * 100)}% ${t.ofFindings}`
    : null;
  const layerNote = layerTop ? `${t.highestTension}: ${layerTop.label}` : null;
  const platformNote = platformTop ? `${t.topChannel}: ${platformTop.label}` : null;
  slides.push({
    key: "dashboard",
    node: (num, total) =>
      shell({
        num,
        total,
        meta,
        eyebrow: t.signalStrength,
        icon: <BarChart2 size={17} />,
        title: meta.corpusTotal > 0 ? `${fmt(meta.corpusTotal)} ${t.publishedMentions}` : t.dashboardTitle,
        compactTitle: true,
        children: (
          <div className="deck-dashboard">
            <div className="deck-metrics is-compact-row">
              <Metric icon={<Search size={20} />} value={fmt(m.findings_total)} label={t.findings} />
              <Metric icon={<Zap size={20} />} value={fmt(m.triggers_total)} label={t.triggers} tone="signal" />
              <Metric icon={<AlertTriangle size={20} />} value={fmt(m.barriers_total)} label={t.barriers} tone="tension" />
              <Metric icon={<Move size={20} />} value={fmt(m.movable_total)} label={t.movable} tone="positive" />
            </div>
            <div className="deck-charts-row">
              {polarity.length > 0 ? (
                <div className="deck-chart-card">
                  <span className="deck-card-eyebrow"><PieChart size={16} /> {t.polarity}</span>
                  <div className="deck-chart-body deck-chart-body--row">
                    <DeckDonut slices={polarity as DeckSlice[]} size={190} thickness={34} centerTop={fmt(polarityTotal)} centerBottom={t.findings} />
                    <DeckLegend slices={polarity as DeckSlice[]} total={polarityTotal} />
                  </div>
                  {polarityNote ? <p className="deck-chart-note">{polarityNote}</p> : null}
                </div>
              ) : null}
              {layers.length > 0 ? (
                <div className="deck-chart-card">
                  <span className="deck-card-eyebrow"><Layers size={16} /> {t.byLayer}</span>
                  <div className="deck-chart-body"><DeckBars rows={layers} /></div>
                  {layerNote ? <p className="deck-chart-note">{layerNote}</p> : null}
                </div>
              ) : null}
              {platforms.length > 0 ? (
                <div className="deck-chart-card">
                  <span className="deck-card-eyebrow"><Hash size={16} /> {t.byPlatform}</span>
                  <div className="deck-chart-body"><DeckBars rows={platforms} color="var(--deck-ink-soft)" /></div>
                  {platformNote ? <p className="deck-chart-note">{platformNote}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        ),
      }),
  });

  /* 4–6 · Decision Field */
  if (vm.findings.length > 0) {
    slides.push({ key: "df-divider", node: (num, total) => divider({ num, total, meta, t, index: "01", title: t.decisionField, sub: t.decisionFieldSub }) });
    slides.push({
      key: "df-matrix",
      node: (num, total) =>
        shell({
          num,
          total,
          meta,
          eyebrow: t.decisionField,
          icon: <Layers size={17} />,
          title: t.decisionField,
          compactTitle: true,
          children: (
            <>
              <DecisionMatrix vm={vm} t={t} />
              <p className="deck-matrix-note">
                <Info size={18} />
                {t.matrixNote}
              </p>
            </>
          ),
        }),
    });

    /* Priorities — 2 feature cards on top, 4 compact cards below */
    const top = vm.findings.slice().sort((a, b) => b.composite_score - a.composite_score).slice(0, 6);
    const feature = top.slice(0, 2);
    const rest = top.slice(2, 6);
    slides.push({
      key: "priorities",
      node: (num, total) =>
        shell({
          num,
          total,
          meta,
          eyebrow: t.priorities,
          icon: <Move size={17} />,
          title: t.prioritiesSub,
          compactTitle: true,
          children: (
            <div className="deck-priorities">
              <div className="deck-cards cols-2">
                {feature.map((f, i) => (
                  <article className="deck-card is-feature" key={f.finding_id}>
                    <span className="deck-card-rank">{String(i + 1).padStart(2, "0")}</span>
                    <h4>{truncate(f.finding_name, 110)}</h4>
                    {f.public_quote ? <p className="deck-quote">“{truncate(f.public_quote, 180)}”</p> : null}
                    <div className="deck-card-meta">
                      <span className={`deck-chip ${chipTone(f.polarity)}`}>{prettify(f.polarity)}</span>
                      <span className="deck-chip">{t.layers[f.layer] ?? prettify(f.layer)}</span>
                      <span className="deck-chip">{fmt(f.evidence_count)} {t.evidence}</span>
                      <span className="deck-chip">{t.score} {f.composite_score.toFixed(1)}</span>
                    </div>
                  </article>
                ))}
              </div>
              {rest.length > 0 ? (
                <div className="deck-cards cols-4">
                  {rest.map((f, i) => (
                    <article className="deck-card" key={f.finding_id}>
                      <span className="deck-card-eyebrow">{String(i + 3).padStart(2, "0")}</span>
                      <h4 style={{ fontSize: 21 }}>{truncate(f.finding_name, 70)}</h4>
                      {f.public_quote ? (
                        <p style={{ fontSize: 17, color: "var(--deck-fg-2)", fontStyle: "italic" }}>
                          “{truncate(f.public_quote, 96)}”
                        </p>
                      ) : null}
                      <div className="deck-card-meta">
                        <span className={`deck-chip ${chipTone(f.polarity)}`}>{prettify(f.polarity)}</span>
                        <span className="deck-chip">{t.layers[f.layer] ?? prettify(f.layer)}</span>
                        <span className="deck-chip">{fmt(f.evidence_count)} {t.evidence}</span>
                        <span className="deck-chip">{t.score} {f.composite_score.toFixed(1)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        }),
    });
  }

  /* Opportunities */
  if (vm.strategicOpportunities.length > 0) {
    const ops = vm.strategicOpportunities.slice(0, 3);
    slides.push({ key: "op-divider", node: (num, total) => divider({ num, total, meta, t, index: "02", title: t.opportunities, sub: t.opportunitiesSub }) });
    slides.push({
      key: "op-cards",
      node: (num, total) =>
        shell({
          num,
          total,
          meta,
          eyebrow: t.opportunities,
          icon: <Zap size={17} />,
          title: t.opportunitiesSub,
          compactTitle: true,
          children: (
            <div className="deck-cards cols-3" style={{ marginTop: 8 }}>
              {ops.map((op, i) => (
                <article className="deck-card" key={op.opportunity_id}>
                  <span className="deck-card-rank">{i + 1}</span>
                  <h4>{truncate(op.title, 92)}</h4>
                  <p>{truncate(op.decision || op.evidence_summary, 240)}</p>
                  {op.what_to_do ? (
                    <p style={{ color: "var(--deck-fg-2)", fontSize: 19 }}>
                      <strong style={{ color: "var(--deck-signal-dark)" }}>{t.whatToDo}: </strong>
                      {truncate(op.what_to_do, 200)}
                    </p>
                  ) : null}
                  <div className="deck-card-meta">
                    <span className="deck-chip">{prettify(op.level)}</span>
                    <span className="deck-chip">{prettify(op.confidence)}</span>
                  </div>
                </article>
              ))}
            </div>
          ),
        }),
    });
  }

  /* Action Studio */
  if (vm.actionCards.length > 0) {
    const byTeam = Object.keys(TEAM_LABELS)
      .map((key) => ({
        key,
        label: TEAM_LABELS[key]?.[lang] ?? key,
        actions: vm.actionCards.filter((a) => a.target_team === key).slice(0, 1),
      }))
      .filter((g) => g.actions.length > 0)
      .slice(0, 6);
    if (byTeam.length > 0) {
      slides.push({ key: "as-divider", node: (num, total) => divider({ num, total, meta, t, index: "03", title: t.actionStudio, sub: t.actionStudioSub }) });
      slides.push({
        key: "as-cards",
        node: (num, total) =>
          shell({
            num,
            total,
            meta,
            eyebrow: t.actionStudio,
            icon: <Move size={17} />,
            title: t.actionStudioSub,
            compactTitle: true,
            children: (
              <div className={`deck-cards cols-${byTeam.length >= 3 ? 3 : 2}`} style={{ marginTop: 8 }}>
                {byTeam.map((g) => {
                  const a = g.actions[0];
                  if (!a) return null;
                  return (
                    <article className="deck-card" key={g.key}>
                      <span className="deck-card-eyebrow">{g.label}</span>
                      <h4 style={{ fontSize: 24 }}>{truncate(a.title, 110)}</h4>
                      <p>{truncate(a.action_text, 260)}</p>
                      <div className="deck-card-meta">
                        {a.suggested_channel ? <span className="deck-chip">{a.suggested_channel}</span> : null}
                        {a.estimated_impact ? <span className="deck-chip">{prettify(a.estimated_impact)}</span> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ),
          }),
      });
    }
  }

  /* Emerging patterns */
  if (vm.emergingPatterns.length > 0) {
    const pats = vm.emergingPatterns.slice(0, 3);
    slides.push({
      key: "emerging",
      node: (num, total) =>
        shell({
          num,
          total,
          meta,
          eyebrow: t.emerging,
          icon: <Activity />,
          title: t.emergingSub,
          compactTitle: true,
          children: (
            <div className="deck-cards cols-3" style={{ marginTop: 8 }}>
              {pats.map((p) => (
                <article className="deck-card" key={p.pattern_id}>
                  <span className="deck-card-eyebrow">{prettify(p.pattern_type)}</span>
                  <h4 style={{ fontSize: 24 }}>{truncate(p.title, 92)}</h4>
                  <p>{truncate(p.why_it_matters, 240)}</p>
                  <div className="deck-card-meta">
                    <span className="deck-chip">{fmt(p.evidence_count)} {t.evidence}</span>
                    <span className="deck-chip">{prettify(p.confidence)}</span>
                  </div>
                </article>
              ))}
            </div>
          ),
        }),
    });
  }

  /* Boundaries */
  const liveBoundary = meta.liveIntelligence?.status === "ok"
    ? `${t.liveMemory}: ${fmt(meta.liveIntelligence.signals)} señales, ${fmt(meta.liveIntelligence.observations)} observaciones y ${fmt(meta.liveIntelligence.evidence)} evidencias ${t.liveMemoryNote}.`
    : null;
  const boundaries = [
    liveBoundary,
    ...vm.clientBoundaries,
    ...(vm.knowledgeImpact?.strategic_constraints ?? []),
  ].filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 5);
  if (boundaries.length > 0) {
    slides.push({
      key: "boundaries",
      node: (num, total) =>
        shell({
          num,
          total,
          meta,
          eyebrow: t.boundaries,
          icon: <Info size={17} />,
          title: t.boundariesSub,
          compactTitle: true,
          children: (
            <ul className="deck-notes" style={{ marginTop: 12, maxWidth: 1300 }}>
              {boundaries.map((b, i) => (
                <li key={i}>
                  <Info size={22} />
                  <span>{truncate(b, 280)}</span>
                </li>
              ))}
            </ul>
          ),
        }),
    });
  }

  /* Closing — only the line, vertically centered, with the logo */
  slides.push({
    key: "closing",
    node: () => (
      <section className="deck-slide deck-closing" data-label="Closing">
        <div className="deck-atmos is-dark" />
        <div className="deck-frame deck-closing-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="deck-logo-img deck-logo--invert deck-closing-logo" src={LOGO} alt="Noisia" />
          <h2 className="deck-title is-lg">{t.closingTitle}</h2>
        </div>
      </section>
    ),
  });

  const total = slides.length;
  return <>{slides.map((s, i) => <Fragmentish key={s.key}>{s.node(i + 1, total)}</Fragmentish>)}</>;
}

function Fragmentish({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function chipTone(polarity: string) {
  return polarity === "barrier" ? "is-barrier" : polarity === "trigger" ? "is-trigger" : "";
}

function Metric({
  icon,
  value,
  label,
  tone,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  tone?: "signal" | "tension" | "positive";
}) {
  return (
    <div className={`deck-metric is-compact${tone ? ` is-${tone}` : ""}`}>
      <span className="deck-metric-ico">{icon}</span>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/* react-feather has no default "Activity" import alias here; declare it lazily */
function Activity(props: { size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

/* ---- Shared slide chrome ---------------------------------------- */
function shell({
  num,
  total,
  meta,
  eyebrow,
  icon,
  title,
  compactTitle,
  children,
}: {
  num: number;
  total: number;
  meta: DeckMeta;
  eyebrow: string;
  icon?: ReactNode;
  title?: string;
  compactTitle?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="deck-slide" data-label={eyebrow}>
      <div className="deck-atmos" />
      <div className="deck-frame">
        <header className="deck-head">
          <span className="deck-head-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="deck-logo deck-logo-img" src={LOGO} alt="Noisia" />
            <span className="deck-sep" />
            {meta.brandLabel}
          </span>
          <span className="deck-head-right">
            {meta.methodologyName}
            <span className="deck-sep" />
            <span className="deck-num">
              {String(num).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
          </span>
        </header>
        <span className="deck-eyebrow is-signal" style={{ marginBottom: 16 }}>
          {icon ?? <i className="deck-dot" />}
          {eyebrow}
        </span>
        {title ? (
          <h2 className="deck-title" style={{ marginBottom: 22, fontSize: compactTitle ? 46 : 64 }}>
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </section>
  );
}

function divider({
  num,
  total,
  meta,
  t,
  index,
  title,
  sub,
}: {
  num: number;
  total: number;
  meta: DeckMeta;
  t: (typeof T)["en"];
  index: string;
  title: string;
  sub: string;
}) {
  return (
    <section className="deck-slide deck-divider" data-label={title}>
      <div className="deck-atmos is-dark" />
      <span className="deck-num-xl">{index}</span>
      <div className="deck-frame" style={{ justifyContent: "center", gap: 24 }}>
        <header className="deck-head">
          <span className="deck-head-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="deck-logo deck-logo-img deck-logo--invert" src={LOGO} alt="Noisia" />
            <span className="deck-sep" style={{ background: "rgba(255,255,255,0.2)" }} />
            {meta.brandLabel}
          </span>
          <span className="deck-head-right">
            {t.section} {index} · {String(num).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </header>
        <span className="deck-eyebrow is-signal" style={{ marginTop: "auto" }}>
          <i className="deck-dot" />
          {t.section} {index}
        </span>
        <h2 className="deck-title is-lg">{title}</h2>
        <p className="deck-lede">{sub}</p>
        <span style={{ marginTop: "auto" }} />
      </div>
    </section>
  );
}

function DecisionMatrix({ vm, t }: { vm: TbDashboardViewModel; t: (typeof T)["en"] }) {
  const layers = ["personal", "psicologico", "social", "cultural"];
  const rows: Array<{ key: string; label: string; note: string }> = [
    { key: "movible_por_marca", label: t.actOn, note: t.actOnNote },
    { key: "parcialmente_movible", label: t.shapeIt, note: t.shapeItNote },
    { key: "estructural", label: t.respectIt, note: t.respectItNote },
  ];
  return (
    <div className="deck-matrix">
      <div className="deck-matrix-row is-head">
        <span />
        {layers.map((l) => (
          <strong key={l}>{t.layers[l] ?? prettify(l)}</strong>
        ))}
      </div>
      {rows.map((row) => (
        <div className="deck-matrix-row" key={row.key}>
          <div className="deck-matrix-label">
            <strong>{row.label}</strong>
            <span>{row.note}</span>
          </div>
          {layers.map((layer) => {
            const cell = vm.findings
              .filter((f) => f.layer === layer && f.mobility === row.key)
              .sort((a, b) => b.composite_score - a.composite_score)
              .slice(0, 2);
            return (
              <div className="deck-cell" key={`${row.key}-${layer}`}>
                {cell.length > 0 ? (
                  cell.map((f) => (
                    <div className={`deck-cell-chip ${chipTone(f.polarity)}`} key={f.finding_id}>
                      <strong>{truncate(f.finding_name, 52)}</strong>
                      <small>{f.evidence_count} {t.evidence}</small>
                    </div>
                  ))
                ) : (
                  <span className="deck-cell-empty">{t.noSignal}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---- aggregate readers ------------------------------------------ */
function chartRows(input: unknown, keyField: string): Array<{ key: string; count: number }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const key = String(row[keyField] ?? row.movilidad ?? "unknown");
      const count = Number(row.count ?? 0);
      return { key, count };
    })
    .filter((r) => r.count > 0 && r.key !== "unknown");
}
