"use client";

import { useEffect, useMemo, useState } from "react";

import { useSignalUiLanguage } from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";
import type { EvidenceDeepDive, PublicActionCard, PublicTbFinding } from "@/lib/signal/contracts";

type JsonRecord = Record<string, unknown>;

type FindingDetailWorkspaceProps = {
  actions: PublicActionCard[];
  competitivePresence: unknown[];
  evidenceDeepDives?: EvidenceDeepDive[];
  findings: PublicTbFinding[];
  mentionsSample: JsonRecord[];
};

export function FindingDetailWorkspace({
  actions,
  competitivePresence,
  evidenceDeepDives = [],
  findings,
  mentionsSample,
}: FindingDetailWorkspaceProps) {
  const { uiLanguage } = useSignalUiLanguage();
  const unique = useMemo(
    () => dedupeFindings(findings).sort((a, b) => b.composite_score - a.composite_score),
    [findings]
  );
  const [selectedId, setSelectedId] = useState(unique[0]?.finding_id ?? "");
  const [polarityFilter, setPolarityFilter] = useState("all");
  const [layerFilter, setLayerFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const filtered = unique.filter((finding) => {
    if (polarityFilter !== "all" && finding.polarity !== polarityFilter) return false;
    if (layerFilter !== "all" && finding.layer !== layerFilter) return false;
    if (confidenceFilter !== "all" && finding.confidence !== confidenceFilter) return false;
    return true;
  });

  useEffect(() => {
    const syncFromHash = () => {
      const raw = window.location.hash.replace(/^#finding-/, "");
      if (!raw || raw === window.location.hash) return;
      const match = unique.find((finding) => findingAnchor(finding.finding_id) === `finding-${raw}`);
      if (match) setSelectedId(match.finding_id);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [unique]);

  if (unique.length === 0) {
    return (
      <div className="signal-notice">
        <span className="signal-notice-icon">
          <Icon name="info" size={18} />
        </span>
        <div>
          <strong>No hay findings públicos en este payload.</strong>
          <p>Los outputs legacy se siguen adaptando, pero para ver el detalle completo hay que republicar el payload nuevo.</p>
        </div>
      </div>
    );
  }

  const selected = filtered.find((finding) => finding.finding_id === selectedId) ?? filtered[0] ?? unique[0]!;
  const linkedActions = actions.filter((action) => action.finding_ids.includes(selected.finding_id));
  const samples = mentionsSample.filter((mention) => stringValue(mention.finding_id) === selected.finding_id);
  const presence = competitivePresence
    .map(asRecord)
    .find((item) => stringValue(item.finding_id) === selected.finding_id) ?? {};
  const deepDive = evidenceDeepDives.find((item) => item.finding_id === selected.finding_id);

  return (
    <div className="finding-workspace">
      <aside className="finding-workspace-list" aria-label={uiLanguage === "en" ? "Published findings" : "Findings publicados"}>
        <div className="finding-workspace-filters" aria-label={uiLanguage === "en" ? "Finding filters" : "Filtros de findings"}>
          <div className="finding-filter-head">
            <Icon name="filter" size={14} />
            <strong>{uiLanguage === "en" ? "Filter & Sort" : "Filtrar"}</strong>
          </div>
          <label>
            <span>{uiLanguage === "en" ? "Type" : "Tipo"}</span>
            <select value={polarityFilter} onChange={(event) => setPolarityFilter(event.target.value)}>
              <option value="all">{uiLanguage === "en" ? "All types" : "Todos los tipos"}</option>
              <option value="trigger">Triggers</option>
              <option value="barrier">Barriers</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label>
            <span>{uiLanguage === "en" ? "Layer" : "Capa"}</span>
            <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)}>
              <option value="all">{uiLanguage === "en" ? "All layers" : "Todas las capas"}</option>
              <option value="personal">Personal</option>
              <option value="psicologico">{uiLanguage === "en" ? "Psychological" : "Psicologico"}</option>
              <option value="social">Social</option>
              <option value="cultural">Cultural</option>
            </select>
          </label>
          <label>
            <span>{uiLanguage === "en" ? "Confidence" : "Confianza"}</span>
            <select value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value)}>
              <option value="all">{uiLanguage === "en" ? "All confidence" : "Toda confianza"}</option>
              <option value="alta">{uiLanguage === "en" ? "High" : "Alta"}</option>
              <option value="media">{uiLanguage === "en" ? "Medium" : "Media"}</option>
              <option value="baja_direccional">{uiLanguage === "en" ? "Directional" : "Direccional"}</option>
            </select>
          </label>
        </div>
        {filtered.map((finding) => (
          <button
            aria-current={selected.finding_id === finding.finding_id ? "true" : undefined}
            className={selected.finding_id === finding.finding_id ? "is-active" : undefined}
            id={findingAnchor(finding.finding_id)}
            key={finding.finding_id}
            onClick={() => {
              setSelectedId(finding.finding_id);
              window.history.replaceState(null, "", `#${findingAnchor(finding.finding_id)}`);
            }}
            type="button"
          >
            <span className={`finding-workspace-dot finding-workspace-dot--${finding.polarity}`} />
            <div>
              <strong>{finding.finding_name}</strong>
              <small>
                {finding.finding_id} · {layerLabel(finding.layer, uiLanguage)} · {fmtCompact(finding.evidence_count)}{" "}
                {uiLanguage === "en" ? "evidence" : "evidencias"}
              </small>
            </div>
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="finding-workspace-empty">{uiLanguage === "en" ? "No findings match these filters." : "No hay findings con esos filtros."}</p>
        ) : null}
      </aside>

      <article className="finding-workspace-detail">
        <header>
          <span>{selected.finding_id}</span>
          <h3>{selected.finding_name}</h3>
          <p>{polarityLabel(selected.polarity)} · {layerLabel(selected.layer, uiLanguage)} · score {selected.composite_score.toFixed(1)}</p>
        </header>

        <div className="finding-drawer-metrics">
          <Metric label={uiLanguage === "en" ? "Evidence" : "Evidencia"} value={fmtCompact(selected.evidence_count)} />
          <Metric label={uiLanguage === "en" ? "Frequency" : "Frecuencia"} value={fmtCompact(selected.frequency_mentions)} />
          <Metric label={uiLanguage === "en" ? "Mobility" : "Movilidad"} value={selected.mobility ? mobilityLabel(selected.mobility, uiLanguage) : (uiLanguage === "en" ? "Unclassified" : "Sin clasificar")} />
          <Metric label={uiLanguage === "en" ? "Confidence" : "Confianza"} value={confidenceLabel(selected.confidence, uiLanguage)} />
        </div>

        {selected.public_quote ? (
          <blockquote className="finding-drawer-quote">“{truncate(selected.public_quote, 360)}”</blockquote>
        ) : null}

        {deepDive ? (
          <section className="finding-drawer-deep-dive">
            <strong>{deepDive.plain_language_title || "Lectura del finding"}</strong>
            <p>{deepDive.description}</p>
            <div className="finding-drawer-insight-grid">
              <InsightTile icon="platform" label={uiLanguage === "en" ? "Channel" : "Canal"} value={deepDive.channel_insight} />
              <InsightTile icon="message" label={uiLanguage === "en" ? "Format" : "Formato"} value={deepDive.format_insight} />
              <InsightTile icon="calendar" label={uiLanguage === "en" ? "Period" : "Periodo"} value={deepDive.period_insight} />
              <InsightTile icon="layers" label={uiLanguage === "en" ? "Competition" : "Competencia"} value={deepDive.competitor_insight || (uiLanguage === "en" ? "No competitive pattern was published for this finding." : "Sin patron competitivo publicado para este finding.")} />
            </div>
            {deepDive.future_watchout ? <small>{deepDive.future_watchout}</small> : null}
          </section>
        ) : null}

        <div className="finding-workspace-grid">
          <section>
            <strong>{uiLanguage === "en" ? "What it decides" : "Qué decide"}</strong>
            <p>
              {uiLanguage === "en"
                ? `This finding appears as a ${polarityLabel(selected.polarity).toLowerCase()} with ${selected.share_of_findings_pct.toFixed(1)}% of relative finding weight.`
                : `Este finding aparece como ${polarityLabel(selected.polarity)} con ${selected.share_of_findings_pct.toFixed(1)}% del peso relativo de findings.`}
              {selected.period_start && selected.period_end
                ? ` ${uiLanguage === "en" ? "Observed period" : "Periodo observado"}: ${formatDate(selected.period_start, uiLanguage)} ${uiLanguage === "en" ? "to" : "a"} ${formatDate(selected.period_end, uiLanguage)}.`
                : ""}
            </p>
          </section>
          <section>
            <strong>{uiLanguage === "en" ? "Competitive ownership" : "Ownership competitivo"}</strong>
            {Object.keys(presence).length > 0 ? (
              <p>
                {ownershipLabel(stringValue(presence.ownership), uiLanguage)} · {uiLanguage === "en" ? "dominant" : "dominante"}: {stringValue(presence.dominant_entity_name) || (uiLanguage === "en" ? "unattributed" : "sin atribución")}.
              </p>
            ) : (
              <p>{uiLanguage === "en" ? "No competitive ownership is sufficiently connected to this finding." : "No hay ownership competitivo suficiente conectado a este finding."}</p>
            )}
          </section>
        </div>

        <section className="finding-drawer-actions">
          <strong>{uiLanguage === "en" ? "Connected actions" : "Acciones conectadas"}</strong>
          {linkedActions.length > 0 ? linkedActions.map((action) => (
            <article key={action.action_id}>
              <span>{teamLabel(action.target_team)}</span>
              <p>{action.action_text}</p>
            </article>
          )) : (
            <p>{uiLanguage === "en" ? "No prioritized actions are connected to this finding." : "No hay acciones priorizadas conectadas a este finding."}</p>
          )}
        </section>

        <section className="finding-drawer-evidence">
          <strong>{uiLanguage === "en" ? "Connected evidence" : "Evidencia secundaria"}</strong>
          {samples.length > 0 ? samples.slice(0, 4).map((sample, sampleIndex) => (
            <blockquote key={stringValue(sample.mention_id) || sampleIndex}>
              <small>{stringValue(sample.platform) || (uiLanguage === "en" ? "Source" : "Fuente")} {stringValue(sample.published_at) ? `· ${formatDate(stringValue(sample.published_at), uiLanguage)}` : ""}</small>
              {truncate(stringValue(sample.text), 240)}
            </blockquote>
          )) : (
            <p>{uiLanguage === "en" ? "No sample verbatims were published for this finding." : "No hay verbatims de muestra publicados para este finding."}</p>
          )}
        </section>
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InsightTile({ icon, label, value }: { icon: "platform" | "message" | "calendar" | "layers"; label: string; value: string }) {
  return (
    <div>
      <span><Icon name={icon} size={13} /> {label}</span>
      <p>{value}</p>
    </div>
  );
}

function dedupeFindings(findings: PublicTbFinding[]) {
  const byId = new Map<string, PublicTbFinding>();
  for (const finding of findings) {
    const existing = byId.get(finding.finding_id);
    if (!existing || finding.composite_score > existing.composite_score) {
      byId.set(finding.finding_id, finding);
    }
  }
  return Array.from(byId.values());
}

function findingAnchor(findingId: string) {
  return `finding-${findingId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function fmtCompact(value: number): string {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string, uiLanguage: "en" | "es" = "en"): string {
  return new Date(value).toLocaleDateString(uiLanguage === "en" ? "en-US" : "es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function prettifyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function layerLabel(layer: string, uiLanguage: "en" | "es") {
  if (uiLanguage === "en") {
    if (layer === "psicologico") return "Psychological";
    if (layer === "personal") return "Personal";
    if (layer === "social") return "Social";
    if (layer === "cultural") return "Cultural";
  }
  return prettifyKey(layer);
}

function mobilityLabel(mobility: string, uiLanguage: "en" | "es") {
  if (uiLanguage === "en") {
    if (mobility === "movible_por_marca") return "Actionable by brand";
    if (mobility === "parcialmente_movible") return "Partially movable";
    if (mobility === "estructural") return "Structural";
  }
  return prettifyKey(mobility);
}

function polarityLabel(polarity: string) {
  if (polarity === "trigger") return "Trigger";
  if (polarity === "barrier") return "Barrier";
  if (polarity === "mixed") return "Mixed";
  return prettifyKey(polarity);
}

function confidenceLabel(confidence: string, uiLanguage: "en" | "es") {
  if (uiLanguage === "en") {
    if (confidence === "alta") return "High";
    if (confidence === "baja_direccional") return "Directional";
    if (confidence === "media") return "Medium";
  }
  return prettifyKey(confidence);
}

function ownershipLabel(ownership: string, uiLanguage: "en" | "es") {
  if (!ownership) return uiLanguage === "en" ? "No claim" : "Sin evidencia";
  if (uiLanguage === "en") {
    if (ownership === "brand_owned") return "Brand-owned";
    if (ownership === "competitor_owned") return "Competitor-owned";
    if (ownership === "category_wide") return "Category-wide";
  }
  return prettifyKey(ownership);
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function teamLabel(team: PublicActionCard["target_team"]) {
  const labels: Record<PublicActionCard["target_team"], string> = {
    brand_strategy: "Brand Strategy",
    creative_content: "Creative / Content",
    product_cx: "Product / CX",
    retail_media: "Retail / Media",
    measurement: "Measurement",
    cultural_guardrails: "Cultural Guardrails"
  };
  return labels[team];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
