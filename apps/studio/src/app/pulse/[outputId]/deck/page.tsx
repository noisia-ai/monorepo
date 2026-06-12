/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DeckRuntime } from "@/components/signal/deck/DeckRuntime";
import { requirePortalUser } from "@/lib/auth/guards";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { resolveSignalPulseVisibility, type SignalPulseResolvedVisibility } from "@/lib/signal-pulse/runtime-contracts";

import "../../../signal/[outputId]/deck/deck.css";
import "./pulse-deck.css";

export const dynamic = "force-dynamic";

type Lang = "en" | "es";
type JsonRecord = Record<string, unknown>;

const LOGO = "/assets/logos/logo_black.svg";

const LABELS = {
  en: {
    downloadPdf: "Download PDF",
    present: "Present",
    hint: "Toggle fullscreen",
    share: "Share",
    shareTitle: "Share this Pulse",
    shareIntro: "Copy the monthly deck link or invite someone by email. New invitees enter as Client Viewer for this study's organization.",
    shareLink: "Deck link",
    copy: "Copy",
    copied: "Copied",
    inviteEmail: "Invite by email",
    invitePlaceholder: "name@company.com",
    inviteSend: "Send invite",
    inviteSending: "Sending...",
    inviteSent: "Invite sent. They will get the Pulse by email.",
    inviteExists: "Invite already existed. We resent the Pulse email.",
    inviteSavedNoEmail: "Access was saved, but email is not configured yet. Copy the deck link and send it manually for now.",
    inviteError: "We couldn't send the invite.",
    logo: "Logo",
    logoTitle: "Replace the logo",
    logoIntro: "Upload one version for each background. PNG or SVG, under 1MB.",
    logoLight: "For light slides",
    logoLightHint: "A dark logo (shows on white)",
    logoDark: "For dark slides",
    logoDarkHint: "A light logo (shows on dark covers)",
    upload: "Upload",
    done: "Replaced",
    logoTooBig: "That file is over 1MB. Please upload a logo under 1MB.",
    logoBadType: "Please upload a PNG or SVG file."
  },
  es: {
    downloadPdf: "Descargar PDF",
    present: "Presentar",
    hint: "Pantalla completa",
    share: "Compartir",
    shareTitle: "Compartir este Pulse",
    shareIntro: "Copia el link del deck mensual o invita a alguien por correo. Los nuevos invitados entran como Cliente lector en la organización del estudio.",
    shareLink: "Link del deck",
    copy: "Copiar",
    copied: "Copiado",
    inviteEmail: "Invitar por correo",
    invitePlaceholder: "nombre@empresa.com",
    inviteSend: "Enviar invitación",
    inviteSending: "Enviando...",
    inviteSent: "Invitación enviada. Recibirá el Pulse por correo.",
    inviteExists: "La invitación ya existía. Reenviamos el correo del Pulse.",
    inviteSavedNoEmail: "El acceso quedó guardado, pero el correo todavía no está configurado. Copia el link y envíalo manualmente por ahora.",
    inviteError: "No pudimos enviar la invitación.",
    logo: "Logo",
    logoTitle: "Reemplazar el logo",
    logoIntro: "Sube una versión para cada fondo. PNG o SVG, menos de 1MB.",
    logoLight: "Para slides claras",
    logoLightHint: "Un logo oscuro (se ve sobre blanco)",
    logoDark: "Para slides oscuras",
    logoDarkHint: "Un logo claro (se ve sobre portadas oscuras)",
    upload: "Subir",
    done: "Reemplazado",
    logoTooBig: "El archivo supera 1MB. Sube un logo de menos de 1MB.",
    logoBadType: "Sube un archivo PNG o SVG."
  }
} satisfies Record<Lang, Record<string, string>>;

export default async function PulseDeckPage({
  params,
  searchParams
}: {
  params: Promise<{ outputId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { outputId } = await params;
  const { lang: langParam } = await searchParams;
  const lang: Lang = langParam === "en" ? "en" : "es";
  const session = await requirePortalUser(`/pulse/${outputId}/deck?lang=${lang}`);
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output || output.methodologySlug !== "signal-pulse" || output.kind !== "signal_pulse") notFound();

  const payload = asRecord(output.payload);
  const report = asRecord(payload.report);
  const executiveRead = asRecord(payload.executive_read);
  const periods = arrayOfRecords(payload.periods);
  const signals = arrayOfRecords(payload.signals);
  const moves = arrayOfRecords(payload.marketing_moves);
  const evidence = arrayOfRecords(payload.evidence);
  const sources = arrayOfRecords(payload.sources);
  const qualityGates = arrayOfRecords(payload.quality_gates);
  const cost = asRecord(payload.cost);
  const activePeriod = periods.at(-1);
  const brandLabel = (output.brandName ?? output.brandFallbackName ?? output.themeName ?? stringValue(report.title)) || "Signal Pulse";
  const dateLabel = stringValue(activePeriod?.label) || formatDate(output.publishedAt?.toISOString?.() ?? String(output.publishedAt ?? ""));
  const visibility = resolveSignalPulseVisibility({
    config: output.visibilityConfig,
    isInternalUser: session.appUser.userType === "noisia_internal"
  });
  const visibleEvidence = visibility.showEvidence ? evidence : [];
  const confidence = visibility.showQuality && qualityGates.some((gate) => gate.passed === false) ? "con límites visibles" : "listo para presentar";

  return (
    <div className="deck-shell pulse-deck-shell">
      <DeckRuntime labels={LABELS[lang]} outputId={outputId} lang={lang}>
        <CoverSlide brandLabel={brandLabel} dateLabel={dateLabel} confidence={confidence} periods={periods.length} />
        <ExecutiveSlide executiveRead={executiveRead} signals={signals} moves={moves} cost={cost} />
        <MapSlide signals={signals} />
        <SignalsSlide signals={signals.slice(0, 5)} evidence={visibleEvidence} />
        <MovesSlide moves={moves.slice(0, 6)} signals={signals} />
        <LimitsSlide periods={periods} sources={sources} gates={qualityGates} cost={cost} visibility={visibility} />
      </DeckRuntime>
    </div>
  );
}

function CoverSlide({ brandLabel, confidence, dateLabel, periods }: { brandLabel: string; confidence: string; dateLabel: string; periods: number }) {
  return (
    <section className="deck-slide deck-cover pulse-deck-cover" data-label="Cover">
      <div className="deck-atmos" />
      <div className="deck-frame">
        <div className="deck-cover-body">
          <span className="deck-eyebrow is-signal"><i className="deck-dot" /> Signal Pulse</span>
          <h1 className="deck-title is-lg">{brandLabel}</h1>
          <p className="deck-lede">Corte mensual de señales, evidencia y movimientos tácticos para Marketing.</p>
          <dl className="deck-cover-meta">
            <div><dt>Periodo</dt><dd>{dateLabel}</dd></div>
            <div><dt>Confianza</dt><dd>{confidence}</dd></div>
            <div><dt>Meses</dt><dd>{periods}</dd></div>
          </dl>
        </div>
        <div className="deck-foot">
          <span className="deck-brand-row"><img className="deck-logo-img" src={LOGO} alt="Noisia" /> · Inteligencia táctica</span>
          <span>Corte mensual</span>
        </div>
      </div>
    </section>
  );
}

function ExecutiveSlide({ cost, executiveRead, moves, signals }: { cost: JsonRecord; executiveRead: JsonRecord; moves: JsonRecord[]; signals: JsonRecord[] }) {
  return (
    <section className="deck-slide" data-label="Executive Read">
      <SlideFrame num="02" eyebrow="Lectura ejecutiva" title={stringValue(executiveRead.headline) || "Qué cambió este mes"}>
        <div className="deck-cols is-wide-left">
          <div className="deck-stack is-center">
            <p className="deck-body">{stringValue(executiveRead.body) || "El corte resume las señales con evidencia suficiente y la acción que Marketing puede mover primero."}</p>
            <article className="deck-card pulse-deck-action">
              <span className="deck-card-eyebrow">Move recomendado</span>
              <h4>{stringValue(executiveRead.action) || stringValue(moves[0]?.action_text) || "Revisar las señales con mayor impacto antes de mover inversión."}</h4>
            </article>
          </div>
          <div className="deck-metrics pulse-deck-metrics">
            <Metric label="Señales" value={signals.length} />
            <Metric label="Acciones" value={moves.length} />
            <Metric label="Costo" value={`USD ${fmtMoney(cost.estimated_cost_usd)}`} />
            <Metric label="Tope" value={Number(cost.budget_cap_usd ?? 0) > 0 ? `USD ${fmtMoney(cost.budget_cap_usd)}` : "sin tope"} />
          </div>
        </div>
      </SlideFrame>
    </section>
  );
}

function MapSlide({ signals }: { signals: JsonRecord[] }) {
  return (
    <section className="deck-slide" data-label="Signal Map">
      <SlideFrame num="03" eyebrow="El mapa del mes" title="Impacto por polaridad">
        <div className="pulse-deck-map-layout">
          <ImpactMap signals={signals.slice(0, 36)} />
          <div className="deck-stack is-center">
            {signals.slice(0, 3).map((signal, index) => (
              <article className="deck-card" key={stringValue(signal.id) || index}>
                <span className="deck-card-rank">{index + 1}</span>
                <h4>{stringValue(signal.title)}</h4>
                <p>Impacto {fmtNumber(signal.impact_v1)} · {fmtNumber(signal.volume)} menciones · {stringValue(signal.confidence) || "baja"}.</p>
              </article>
            ))}
          </div>
        </div>
      </SlideFrame>
    </section>
  );
}

function SignalsSlide({ evidence, signals }: { evidence: JsonRecord[]; signals: JsonRecord[] }) {
  return (
    <section className="deck-slide" data-label="Top Signals">
      <SlideFrame num="04" eyebrow="Top señales" title="Qué merece decisión">
        <div className="deck-cards cols-3 pulse-deck-signal-cards">
          {signals.map((signal, index) => {
            const quote = evidence.find((item) => stringValue(item.signal_id) === stringValue(signal.id));
            return (
              <article className="deck-card" key={stringValue(signal.id) || index}>
                <span className="deck-card-rank">{String(index + 1).padStart(2, "0")}</span>
                <h4>{stringValue(signal.title)}</h4>
                <p>{stringValue(signal.description) || stringValue(asRecord(signal.dimensions).marketing_read) || "Señal sostenida por conversación del corpus."}</p>
                {quote ? <p className="deck-quote">“{truncate(stringValue(quote.quote), 150)}”</p> : null}
                <div className="deck-card-meta">
                  <span className="deck-chip">{fmtNumber(signal.volume)} menciones</span>
                  <span className="deck-chip">impacto {fmtNumber(signal.impact_v1)}</span>
                  <span className="deck-chip">{stringValue(signal.confidence) || "baja"}</span>
                </div>
              </article>
            );
          })}
        </div>
      </SlideFrame>
    </section>
  );
}

function MovesSlide({ moves, signals }: { moves: JsonRecord[]; signals: JsonRecord[] }) {
  return (
    <section className="deck-slide" data-label="Acciones de marketing">
      <SlideFrame num="05" eyebrow="Acciones de marketing" title="Qué puede mover Marketing">
        <div className="deck-cards cols-3 pulse-deck-move-cards">
          {moves.map((move, index) => {
            const refs = arrayValue(move.signal_refs).map(String);
            const signal = signals.find((item) => refs.includes(stringValue(item.id)));
            return (
              <article className="deck-card" key={stringValue(move.id) || index}>
                <span className="deck-card-eyebrow">{labelMoveType(stringValue(move.move_type))}</span>
                <h4>{stringValue(move.action_text)}</h4>
                <p>{signal ? `Sale de: ${stringValue(signal.title)}.` : "Ligado a evidencia del corpus."}</p>
                <div className="deck-card-meta">
                  <span className="deck-chip">{stringValue(move.owner_suggestion) || "Marketing"}</span>
                  <span className="deck-chip">{stringValue(move.timing) || "este mes"}</span>
                  <span className="deck-chip">{stringValue(move.confidence) || "baja"}</span>
                </div>
              </article>
            );
          })}
        </div>
      </SlideFrame>
    </section>
  );
}

function LimitsSlide({
  cost,
  gates,
  periods,
  sources,
  visibility
}: {
  cost: JsonRecord;
  gates: JsonRecord[];
  periods: JsonRecord[];
  sources: JsonRecord[];
  visibility: SignalPulseResolvedVisibility;
}) {
  const failed = gates.filter((gate) => gate.passed === false);
  const visibleSources = visibility.showSources ? sources : [];
  const visibleGates = visibility.showQuality ? gates : [];
  const visibleFailed = visibility.showQuality ? failed : [];
  return (
    <section className="deck-slide" data-label="Coverage">
      <SlideFrame num="06" eyebrow="Cobertura y límites" title="Qué tan presentable es el corte">
        <div className="deck-cols">
          <div className="deck-stack">
            <div className="deck-cards cols-2">
              <MetricCard label="Periodos" value={periods.length} detail={`${periods.filter((period) => period.comparable !== false).length} comparables`} />
              {visibility.showSources ? <MetricCard label="Fuentes" value={visibleSources.length} detail="conversación + performance" /> : null}
              <MetricCard label="Costo" value={`USD ${fmtMoney(cost.estimated_cost_usd)}`} detail={Number(cost.budget_cap_usd ?? 0) > 0 ? `tope USD ${fmtMoney(cost.budget_cap_usd)}` : "sin tope declarado"} />
              {visibility.showQuality ? <MetricCard label="Checks" value={visibleFailed.length === 0 ? "OK" : visibleFailed.length} detail={visibleFailed.length === 0 ? "sin bloqueos" : "con límites visibles"} /> : null}
            </div>
          </div>
          <div className="deck-stack">
            {visibility.showSources ? (
              <article className="deck-card">
                <span className="deck-card-eyebrow">Fuentes estructuradas</span>
                {visibleSources.slice(0, 4).map((source) => (
                  <p key={stringValue(source.id)}>{stringValue(source.name)} · {stringValue(source.provider)} · {fmtNumber(source.records_valid)} filas válidas</p>
                ))}
                {visibleSources.length === 0 ? <p>Sin performance estructurada en este corte.</p> : null}
              </article>
            ) : null}
            {visibility.showQuality ? (
              <article className="deck-card">
                <span className="deck-card-eyebrow">Límites</span>
                {(visibleFailed.length > 0 ? visibleFailed : visibleGates.slice(0, 3)).map((gate) => (
                  <p key={stringValue(gate.id)}>{stringValue(gate.detail) || labelQualityGate(stringValue(gate.id))}</p>
                ))}
              </article>
            ) : (
              <article className="deck-card">
                <span className="deck-card-eyebrow">Lectura cliente</span>
                <p>Este deck conserva la lectura accionable y deja la auditoría técnica para el equipo Noisia.</p>
              </article>
            )}
          </div>
        </div>
      </SlideFrame>
    </section>
  );
}

function SlideFrame({ children, eyebrow, num, title }: { children: ReactNode; eyebrow: string; num: string; title: string }) {
  return (
    <div className="deck-frame">
      <header className="deck-head">
        <span className="deck-head-left"><img className="deck-logo deck-logo-img" src={LOGO} alt="Noisia" /> Signal Pulse</span>
        <span className="deck-head-right"><span className="deck-num">{num}</span></span>
      </header>
      <span className="deck-eyebrow is-signal"><i className="deck-dot" /> {eyebrow}</span>
      <h2 className="deck-title pulse-deck-title">{title}</h2>
      <div className="pulse-deck-body">{children}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="deck-metric is-compact is-signal">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function MetricCard({ detail, label, value }: { detail: string; label: string; value: number | string }) {
  return (
    <article className="deck-card">
      <span className="deck-card-eyebrow">{label}</span>
      <h4>{value}</h4>
      <p>{detail}</p>
    </article>
  );
}

function ImpactMap({ signals }: { signals: JsonRecord[] }) {
  const points = signals.map((signal, index) => {
    const impact = Number(signal.impact_v1 ?? signal.impact ?? 0);
    const sentiment = Number(signal.sentiment_score ?? signal.sentiment ?? 0);
    return {
      id: stringValue(signal.id) || String(index),
      title: stringValue(signal.title),
      x: 50 + clamp(sentiment, -1, 1) * 38,
      y: 88 - clamp(impact, 0, 100) * 0.74,
      size: 9 + Math.min(24, Math.sqrt(Number(signal.volume ?? 1)) * 2.2)
    };
  });
  return (
    <svg className="pulse-deck-impact-map" role="img" aria-label="Impacto por polaridad" viewBox="0 0 100 100">
      <path d="M8 88H94" />
      <path d="M50 8V94" />
      <text x="8" y="10">impacto</text>
      <text x="70" y="97">positivo</text>
      {points.map((point, index) => (
        <g key={point.id}>
          <circle cx={point.x} cy={point.y} r={point.size / 4} />
          {index < 8 ? <text x={clamp(point.x + 2.5, 8, 78)} y={clamp(point.y, 9, 92)}>{point.title.slice(0, 20)}</text> : null}
        </g>
      ))}
    </svg>
  );
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return arrayValue(value).map(asRecord);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function fmtNumber(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: number >= 10 ? 0 : 1 }).format(Number.isFinite(number) ? number : 0);
}

function fmtMoney(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: number > 0 && number < 1 ? 4 : 2, minimumFractionDigits: number > 0 && number < 1 ? 4 : 2 }).format(Number.isFinite(number) ? number : 0);
}

function formatDate(value: string) {
  if (!value) return "corte vivo";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" }).format(date);
}

function truncate(value: string, max: number) {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function labelMoveType(value: string) {
  const labels: Record<string, string> = {
    amplify: "Amplificar",
    test_claim: "Test de claim",
    create_content: "Contenido",
    monitor: "Monitorear"
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function labelQualityGate(value: string) {
  const labels: Record<string, string> = {
    source_presence: "Fuentes presentes",
    period_coverage: "Periodos listos",
    period_comparability: "Meses comparables",
    signal_min_evidence: "Evidencia ligada",
    chart_data_available: "Gráficas con datos",
    move_has_signal: "Acciones con señal",
    cost_within_budget: "Costo dentro del tope",
    no_invented_numbers: "Números calculados",
    humanizer_passed: "Copy listo para publicar"
  };
  return labels[value] ?? value.replace(/_/g, " ");
}
