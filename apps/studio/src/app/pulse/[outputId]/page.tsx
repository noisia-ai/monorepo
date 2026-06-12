import { notFound } from "next/navigation";

import { SessionBadge } from "@/components/layout/SessionBadge";
import {
  SignalGlobalDateFilter,
  SignalReportShell,
  type SignalShellGroup
} from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";
import { requirePortalUser } from "@/lib/auth/guards";
import { getSignalOutputForUser } from "@/lib/data/signal";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

export default async function PulseOutputPage({
  params
}: {
  params: Promise<{ outputId: string }>;
}) {
  const { outputId } = await params;
  const session = await requirePortalUser(`/pulse/${outputId}`);
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
  const chartRefs = asRecord(payload.chart_refs);
  const qualityGates = arrayOfRecords(payload.quality_gates);
  const limitations = arrayValue(payload.limitations).map(String);
  const cost = asRecord(payload.cost);
  const brandLabel = output.brandName ?? output.brandFallbackName ?? output.themeName ?? stringValue(report.title) ?? "Signal Pulse";
  const activePeriod = periods.at(-1);
  const defaultDateFrom = stringValue(periods[0]?.period_start);
  const defaultDateTo = stringValue(activePeriod?.period_end);
  const groups = buildPulseGroups();

  return (
    <SignalReportShell
      defaultDateFrom={defaultDateFrom}
      defaultDateTo={defaultDateTo}
      defaultSection="overview"
      defaultUiLanguage="es"
      groups={groups}
      maxDate={defaultDateTo}
      minDate={defaultDateFrom}
    >
      <div className="signal-topbar pulse-topbar">
        <div className="signal-topbar-left">
          <span className="pulse-method-mark"><span>SP</span></span>
          <div className="signal-report-title">
            <strong>{brandLabel}</strong>
            <small>Signal Pulse · {activePeriod ? stringValue(activePeriod.label) : "corte vivo"}</small>
          </div>
        </div>
        <div className="signal-topbar-right">
          <span className="signal-period-pill">
            <Icon name="calendar" size={14} />
            {periods.length > 0 ? `${periods.length} periodos comparables` : "Sin periodos"}
          </span>
          <SignalGlobalDateFilter />
          <SessionBadge user={session.appUser} compact />
        </div>
      </div>

      <section className="signal-view-panel pulse-view-panel" data-signal-section="overview" id="overview">
        <PulseHeader
          action={stringValue(executiveRead.action)}
          body={stringValue(executiveRead.body)}
          headline={stringValue(executiveRead.headline)}
          periods={periods.length}
          signals={signals.length}
          moves={moves.length}
          cost={cost}
        />
        <PulseChartGrid chartRefs={chartRefs} signals={signals} periods={periods} />
        <PulseTopSignals signals={signals.slice(0, 6)} />
        <PulseMovesPreview moves={moves.slice(0, 4)} />
      </section>

      <section className="signal-section pulse-section" data-signal-section="signals" hidden id="signals">
        <PulseSectionHead
          eyebrow="Señales"
          title="Qué merece atención este mes"
          sub="Cada señal muestra volumen, impacto, confianza y evidencia. Cuando falta soporte, queda declarado como límite."
        />
        <div className="pulse-signal-library">
          {signals.length > 0 ? signals.map((signal) => (
            <SignalCard key={stringValue(signal.id)} signal={signal} />
          )) : (
            <PulseEmptyState title="Aún no hay señales" body="Falta conversación suficiente para sostener una lectura publicable." />
          )}
        </div>
      </section>

      <section className="signal-section pulse-section" data-signal-section="moves" hidden id="moves">
        <PulseSectionHead
          eyebrow="Marketing Moves"
          title="Acciones que Marketing sí puede mover"
          sub="Moves cortos, medibles y ligados a señales. No se convierten fricciones de CX en acciones de marketing sin traducción."
        />
        <div className="pulse-move-board">
          {moves.length > 0 ? moves.map((move) => (
            <MoveCard key={stringValue(move.id)} move={move} signals={signals} />
          )) : (
            <PulseEmptyState title="Sin moves todavía" body="Cuando existan señales con evidencia, el reporte propondrá acciones para claim, pauta, contenido o monitoreo." />
          )}
        </div>
      </section>

      <section className="signal-section pulse-section" data-signal-section="evidence" hidden id="evidence">
        <PulseSectionHead
          eyebrow="Evidencia"
          title="Verbatims que sostienen la lectura"
          sub="Cada cita conserva plataforma, fecha y rol dentro de la lectura."
        />
        <div className="pulse-evidence-list">
          {evidence.length > 0 ? evidence.slice(0, 80).map((item) => (
            <EvidenceRow item={item} signal={signals.find((signal) => stringValue(signal.id) === stringValue(item.signal_id))} key={stringValue(item.evidence_id)} />
          )) : (
            <PulseEmptyState title="Falta evidencia ligada" body="Las señales necesitan citas accesibles antes de presentarse como lectura fuerte." />
          )}
        </div>
      </section>

      <section className="signal-section pulse-section" data-signal-section="sources" hidden id="sources">
        <PulseSectionHead
          eyebrow="Fuentes"
          title="Cobertura y huecos visibles"
          sub="El corte muestra cuándo falta performance estructurada o algún mes no es comparable."
        />
        <SourceCoverage periods={periods} sources={sources} />
      </section>

      <section className="signal-section pulse-section" data-signal-section="quality" hidden id="quality">
        <PulseSectionHead
          eyebrow="Calidad"
          title="Controles antes de publicar"
          sub="El reporte separa datos listos, límites visibles y checks pendientes antes de llegar a cliente."
        />
        <QualityGateTable gates={qualityGates} limitations={limitations} cost={cost} />
      </section>
    </SignalReportShell>
  );
}

function PulseHeader({
  headline,
  body,
  action,
  periods,
  signals,
  moves,
  cost
}: {
  headline: string;
  body: string;
  action: string;
  periods: number;
  signals: number;
  moves: number;
  cost: JsonRecord;
}) {
  const estimatedCost = Number(cost.estimated_cost_usd ?? 0);
  const budgetCap = Number(cost.budget_cap_usd ?? 0);
  return (
    <header className="pulse-hero">
      <div>
        <p className="pulse-eyebrow">Overview</p>
        <h1>{headline || "Signal Pulse listo para lectura."}</h1>
        <p>{body || "El corte resume qué cambió, qué evidencia lo sostiene y qué puede mover Marketing."}</p>
      </div>
      <aside className="pulse-hero-action">
        <span>Move sugerido</span>
        <strong>{action || "Revisar señales con mayor impacto antes de mover presupuesto."}</strong>
        <div className="pulse-run-cost">
          <span>Costo de corrida</span>
          <strong>USD {fmtMoney(estimatedCost)}</strong>
          <small>{budgetCap > 0 ? `Tope USD ${fmtMoney(budgetCap)}` : "Sin tope declarado"}</small>
        </div>
      </aside>
      <div className="pulse-kpi-strip">
        <PulseKpi label="Periodos" value={periods} />
        <PulseKpi label="Señales" value={signals} />
        <PulseKpi label="Moves" value={moves} />
      </div>
    </header>
  );
}

function PulseChartGrid({
  chartRefs,
  signals,
  periods
}: {
  chartRefs: JsonRecord;
  signals: JsonRecord[];
  periods: JsonRecord[];
}) {
  const impactRows = arrayOfRecords(asRecord(chartRefs.impact_polarity_map).rows);
  const momentumRows = arrayOfRecords(asRecord(chartRefs.signal_momentum_stream).rows);
  const coverageRows = arrayOfRecords(asRecord(chartRefs.source_coverage_strip).rows);
  const galaxyRows = arrayOfRecords(asRecord(chartRefs.semantic_signal_galaxy).rows);
  return (
    <div className="pulse-chart-grid">
      <div className="pulse-chart pulse-chart--priority">
        <ChartTitle title="Impacto por polaridad" sub="Prioriza señales con alto impacto y sentimiento claro." />
        <ImpactPolaritySvg rows={impactRows.length ? impactRows : signals} />
      </div>
      <div className="pulse-chart">
        <ChartTitle title="Momentum mensual" sub="Volumen e impacto por periodo." />
        <MomentumBars rows={momentumRows} periods={periods} />
      </div>
      <div className="pulse-chart">
        <ChartTitle title="Cobertura de fuentes" sub="Meses comparables y huecos visibles." />
        <CoverageStrip rows={coverageRows.length ? coverageRows : periods} />
      </div>
      <div className="pulse-chart pulse-chart--galaxy">
        <ChartTitle title="Mapa semántico de señales" sub="Agrupa señales cercanas por lenguaje y evidencia." />
        <GalaxySvg rows={galaxyRows.length ? galaxyRows : signals} />
      </div>
    </div>
  );
}

function PulseTopSignals({ signals }: { signals: JsonRecord[] }) {
  return (
    <section className="pulse-band">
      <PulseSectionHead eyebrow="Señales clave" title="Lecturas que merecen decisión" sub="Ordenadas por impacto y volumen reciente." compact />
      <div className="pulse-top-list">
        {signals.map((signal, index) => (
          <div className="pulse-top-row" key={stringValue(signal.id)}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stringValue(signal.title)}</strong>
            <small>{fmtNumber(signal.volume)} menciones · impacto {fmtNumber(signal.impact_v1)} · {stringValue(signal.confidence) || "baja"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function PulseMovesPreview({ moves }: { moves: JsonRecord[] }) {
  return (
    <section className="pulse-band">
      <PulseSectionHead eyebrow="Siguientes moves" title="Qué haría Marketing después" sub="Acciones cortas, con medición y límite cuando la confianza es baja." compact />
      <div className="pulse-move-preview">
        {moves.map((move) => (
          <article key={stringValue(move.id)}>
            <span>{labelMoveType(stringValue(move.move_type))}</span>
            <p>{stringValue(move.action_text)}</p>
            <small>{stringValue(move.owner_suggestion)} · {stringValue(move.timing)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function SignalCard({ signal }: { signal: JsonRecord }) {
  const dimensions = asRecord(signal.dimensions);
  return (
    <article className="pulse-signal-card">
      <div>
        <span className="pulse-state">{labelLifecycle(stringValue(signal.lifecycle_state))}</span>
        <strong>{stringValue(signal.title)}</strong>
      </div>
      <p>{stringValue(signal.description) || stringValue(dimensions.marketing_read) || "Señal construida desde conversación con evidencia ligada."}</p>
      <dl>
        <div><dt>Impacto</dt><dd>{fmtNumber(signal.impact_v1)}</dd></div>
        <div><dt>Volumen</dt><dd>{fmtNumber(signal.volume)}</dd></div>
        <div><dt>Confianza</dt><dd>{stringValue(signal.confidence) || "baja"}</dd></div>
      </dl>
      <footer>
        <span>{stringValue(signal.dominant_emotion) || "observacion"}</span>
        <span>{fmtNumber(signal.evidence_count)} evidencias</span>
      </footer>
    </article>
  );
}

function MoveCard({ move, signals }: { move: JsonRecord; signals: JsonRecord[] }) {
  const refs = arrayValue(move.signal_refs).map(String);
  const signal = signals.find((item) => refs.includes(stringValue(item.id)));
  return (
    <article className="pulse-move-card">
      <div>
        <span>{labelMoveType(stringValue(move.move_type))}</span>
        <strong>{stringValue(move.action_text)}</strong>
      </div>
      <p>{signal ? `Sale de: ${stringValue(signal.title)}.` : "Move ligado a evidencia del corpus."}</p>
      <dl>
        <div><dt>Owner</dt><dd>{stringValue(move.owner_suggestion) || "Marketing"}</dd></div>
        <div><dt>Timing</dt><dd>{stringValue(move.timing) || "este mes"}</dd></div>
        <div><dt>Medición</dt><dd>{stringValue(move.measurement_suggestion) || "Definir KPI antes de ejecutar."}</dd></div>
      </dl>
      {stringValue(move.no_go_notes) ? <small>{stringValue(move.no_go_notes)}</small> : null}
    </article>
  );
}

function EvidenceRow({ item, signal }: { item: JsonRecord; signal?: JsonRecord }) {
  return (
    <article className="pulse-evidence-row">
      <span>{stringValue(item.platform) || "fuente"}</span>
      <p>{stringValue(item.quote) || "Evidencia sin texto disponible."}</p>
      <small>{signal ? stringValue(signal.title) : "Signal Pulse"} · {formatDate(stringValue(item.published_at))} · {stringValue(item.evidence_role) || "support"}</small>
    </article>
  );
}

function SourceCoverage({ periods, sources }: { periods: JsonRecord[]; sources: JsonRecord[] }) {
  return (
    <div className="pulse-source-stack">
      <section className="pulse-source-panel">
        <PulseSectionHead eyebrow="Conectores" title="Fuentes estructuradas" sub="Performance entra como registros, no como texto de contexto." compact />
        <div className="pulse-source-cards">
          {sources.length > 0 ? sources.map((source) => (
            <article key={stringValue(source.id)}>
              <span>{stringValue(source.source_type) || "source"}</span>
              <strong>{stringValue(source.name)}</strong>
              <p>{stringValue(source.provider)} · {stringValue(source.connection_method)} · {stringValue(source.sync_status) || stringValue(source.status)}</p>
              <small>
                {formatDate(stringValue(source.coverage_start))} - {formatDate(stringValue(source.coverage_end))}
                {" · "}
                {fmtNumber(source.records_valid)} filas válidas
              </small>
            </article>
          )) : (
            <PulseEmptyState title="Sin fuentes estructuradas" body="Este corte no tiene performance registrada." />
          )}
        </div>
      </section>
      <section className="pulse-source-panel">
        <PulseSectionHead eyebrow="Periodos" title="Comparabilidad mensual" sub="Conversación y performance por mes disponible." compact />
        <div className="pulse-source-table">
          {periods.map((period) => {
            const coverage = asRecord(period.coverage);
            return (
              <div className="pulse-source-row" key={stringValue(period.id)}>
                <strong>{stringValue(period.label)}</strong>
                <span>{fmtNumber(coverage.conversation)} conversación</span>
                <span>{fmtNumber(coverage.performance)} performance</span>
                <small>{period.comparable === false ? "No comparable" : stringValue(period.confidence) || "comparable"}</small>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function QualityGateTable({ gates, limitations, cost }: { gates: JsonRecord[]; limitations: string[]; cost: JsonRecord }) {
  const estimatedCost = Number(cost.estimated_cost_usd ?? 0);
  const budgetCap = Number(cost.budget_cap_usd ?? 0);
  return (
    <div className="pulse-quality-grid">
      <div className="pulse-gate-list">
        {gates.map((gate) => (
          <div className="pulse-gate-row" data-passed={gate.passed === true} key={stringValue(gate.id)}>
            <Icon name={gate.passed === true ? "check" : "alert"} size={15} />
            <strong>{labelQualityGate(stringValue(gate.id))}</strong>
            <span>{stringValue(gate.detail)}</span>
          </div>
        ))}
      </div>
      <aside className="pulse-limitations">
        <span>Límites visibles</span>
        <p>Costo estimado: USD {fmtMoney(estimatedCost)}{budgetCap > 0 ? ` de USD ${fmtMoney(budgetCap)}` : ""}.</p>
        {limitations.length > 0 ? limitations.map((item) => <p key={item}>{item}</p>) : <p>Sin blockers visibles en este corte.</p>}
      </aside>
    </div>
  );
}

function ImpactPolaritySvg({ rows }: { rows: JsonRecord[] }) {
  const points = rows.slice(0, 32).map((row, index) => {
    const impact = Number(row.impact ?? row.impact_v1 ?? 0);
    const sentiment = Number(row.sentiment ?? row.sentiment_score ?? 0);
    return {
      id: stringValue(row.signal_id) || stringValue(row.id) || String(index),
      title: stringValue(row.title),
      x: 44 + clamp(sentiment, -1, 1) * 35,
      y: 86 - clamp(impact, 0, 100) * 0.72,
      size: 5 + Math.min(14, Math.sqrt(Number(row.volume ?? 1)))
    };
  });
  return (
    <svg className="pulse-scatter" role="img" aria-label="Impacto por polaridad" viewBox="0 0 100 100">
      <path d="M8 86H94" />
      <path d="M44 8V92" />
      <text x="7" y="10">impacto</text>
      <text x="72" y="96">positivo</text>
      {points.map((point) => (
        <g key={point.id}>
          <circle cx={point.x} cy={point.y} r={point.size} />
          <title>{point.title}</title>
        </g>
      ))}
    </svg>
  );
}

function MomentumBars({ rows, periods }: { rows: JsonRecord[]; periods: JsonRecord[] }) {
  const labels = Array.from(new Set((rows.length ? rows : periods).map((row) => stringValue(row.label)).filter(Boolean))).slice(-8);
  const totals = labels.map((label) => rows.filter((row) => stringValue(row.label) === label).reduce((sum, row) => sum + Number(row.volume ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="pulse-bars">
      {labels.map((label, index) => (
        <div key={label}>
          <span style={{ height: `${Math.max(6, ((totals[index] ?? 0) / max) * 100)}%` }} />
          <small>{label.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}

function CoverageStrip({ rows }: { rows: JsonRecord[] }) {
  return (
    <div className="pulse-coverage-strip">
      {rows.map((row) => {
        const coverage = asRecord(row.coverage);
        const conversation = Number(coverage.conversation ?? 0);
        return (
          <div key={stringValue(row.period_id) || stringValue(row.id)} data-comparable={row.comparable !== false}>
            <strong>{stringValue(row.label)}</strong>
            <span>{conversation > 0 ? `${fmtNumber(conversation)} menciones` : "sin conversación"}</span>
          </div>
        );
      })}
    </div>
  );
}

function GalaxySvg({ rows }: { rows: JsonRecord[] }) {
  const nodes = rows.slice(0, 50).map((row, index) => ({
    id: stringValue(row.id) || String(index),
    title: stringValue(row.title),
    x: 50 + Number(row.x ?? Math.cos(index * 1.7) * 35),
    y: 50 + Number(row.y ?? Math.sin(index * 1.7) * 32),
    size: Number(row.size ?? 10)
  }));
  return (
    <svg className="pulse-galaxy" role="img" aria-label="Mapa semántico de señales" viewBox="0 0 100 100">
      {nodes.map((node, index) => (
        <g key={node.id}>
          <circle cx={clamp(node.x, 6, 94)} cy={clamp(node.y, 6, 94)} r={clamp(node.size / 3, 2.5, 10)} />
          {index < 7 ? <text x={clamp(node.x + 3, 8, 78)} y={clamp(node.y, 8, 95)}>{node.title.slice(0, 18)}</text> : null}
        </g>
      ))}
    </svg>
  );
}

function ChartTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="pulse-chart-title">
      <strong>{title}</strong>
      <span>{sub}</span>
    </header>
  );
}

function PulseSectionHead({ eyebrow, title, sub, compact = false }: { eyebrow: string; title: string; sub: string; compact?: boolean }) {
  return (
    <header className={compact ? "pulse-section-head pulse-section-head--compact" : "pulse-section-head"}>
      <p>{eyebrow}</p>
      <h2>{title}</h2>
      <span>{sub}</span>
    </header>
  );
}

function PulseKpi({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{fmtNumber(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function PulseEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="pulse-empty">
      <Icon name="info" size={18} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function buildPulseGroups(): SignalShellGroup[] {
  return [
    {
      label: "Signal Pulse",
      sections: [
        { key: "overview", label: "Overview", icon: "wave" },
        { key: "signals", label: "Signals", icon: "sparkle" },
        { key: "moves", label: "Marketing Moves", icon: "layers" }
      ]
    },
    {
      label: "Evidence",
      sections: [
        { key: "evidence", label: "Evidence", icon: "message" },
        { key: "sources", label: "Sources", icon: "platform" },
        { key: "quality", label: "Quality", icon: "info" }
      ]
    }
  ];
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

function labelLifecycle(value: string) {
  const labels: Record<string, string> = {
    new: "Nueva",
    emerging: "Emergente",
    accelerating: "Creciendo",
    mature: "Persistente",
    declining: "Cayendo",
    dormant: "Dormida",
    volatile: "Volátil"
  };
  return labels[value] ?? "Observada";
}

function labelQualityGate(value: string) {
  const labels: Record<string, string> = {
    source_presence: "Fuentes presentes",
    period_coverage: "Periodos listos",
    period_comparability: "Meses comparables",
    signal_min_evidence: "Evidencia ligada",
    chart_data_available: "Charts con datos",
    move_has_signal: "Moves con señal",
    cost_within_budget: "Costo en budget",
    no_invented_numbers: "Números calculados",
    humanizer_passed: "Copy publicable"
  };
  return labels[value] ?? value.replace(/_/g, " ");
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
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4, minimumFractionDigits: number > 0 && number < 1 ? 4 : 2 }).format(Number.isFinite(number) ? number : 0);
}

function formatDate(value: string) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("es-MX", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
