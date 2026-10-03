"use client";

import { useState } from "react";

import { useSignalUiLanguage } from "@/components/signal/SignalReportShell";
import type { PublicTbFinding, StrategicOpportunity } from "@/lib/signal/contracts";

type SignalOpportunitiesExplorerProps = {
  findings?: PublicTbFinding[];
  opportunities: StrategicOpportunity[];
};

export function SignalOpportunitiesExplorer({
  findings = [],
  opportunities,
}: SignalOpportunitiesExplorerProps) {
  const { uiLanguage } = useSignalUiLanguage();
  const visible = opportunities;
  const [selectedId, setSelectedId] = useState(visible[0]?.opportunity_id ?? "");
  const selected = visible.find((item) => item.opportunity_id === selectedId) ?? visible[0];
  const relatedFindings = selected
    ? selected.related_finding_ids
        .map((findingId) => findings.find((finding) => finding.finding_id === findingId))
        .filter((finding): finding is PublicTbFinding => Boolean(finding))
    : [];

  if (!selected) {
    return (
      <p className="opportunity-empty">
        {uiLanguage === "en" ? "No strategic opportunities were published in this cut." : "Este corte no trae oportunidades estrategicas publicadas."}
      </p>
    );
  }

  return (
    <div className="opportunity-dashboard opportunity-dashboard--interactive">
      <aside className="opportunity-column">
        <header>
          <strong>{uiLanguage === "en" ? "Decision bets" : "Apuestas de decision"}</strong>
          <span>{uiLanguage === "en" ? `${visible.length} prioritized opportunities` : `${visible.length} oportunidades priorizadas`}</span>
        </header>
        <div className="opportunity-list-scroll">
          {visible.map((opportunity) => (
            <button
              aria-current={selected.opportunity_id === opportunity.opportunity_id ? "true" : undefined}
              className={selected.opportunity_id === opportunity.opportunity_id ? "is-active" : undefined}
              key={opportunity.opportunity_id}
              onClick={() => setSelectedId(opportunity.opportunity_id)}
              type="button"
            >
              <span className={`opportunity-dot opportunity-dot--${opportunityTone(opportunity)}`} />
              <div>
                <h3>{opportunity.title}</h3>
                <p>{opportunityLabel(opportunity.level, uiLanguage)} · {truncate(opportunity.decision, 124)}</p>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <article className="opportunity-detail">
        <span>{opportunityLabel(selected.level, uiLanguage)}</span>
        <h3>{selected.title}</h3>
        <p>{selected.decision}</p>
        <dl>
          <div><dt>{uiLanguage === "en" ? "Confidence" : "Confianza"}</dt><dd>{confidenceLabel(selected.confidence, uiLanguage)}</dd></div>
          <div><dt>{uiLanguage === "en" ? "Evidence mix" : "Mezcla de evidencia"}</dt><dd>{friendlySources(selected.source_mix).join(", ") || "Corpus"}</dd></div>
          <div>
            <dt>Findings</dt>
            <dd>
              {relatedFindings.length > 0
                ? relatedFindings.map((finding) => `${finding.finding_name} (${finding.evidence_count})`).join(", ")
                : selected.related_finding_ids.join(", ") || (uiLanguage === "en" ? "No direct finding" : "Sin hallazgo directo")}
            </dd>
          </div>
          <div><dt>{uiLanguage === "en" ? "Success signal" : "Senal de exito"}</dt><dd>{truncate(selected.success_signal, 88)}</dd></div>
        </dl>
        <div className="opportunity-verbatims">
          {selected.why_now ? <blockquote>{selected.why_now}</blockquote> : null}
          {selected.evidence_summary ? <blockquote>{selected.evidence_summary}</blockquote> : null}
        </div>
        <section className="opportunity-next-step">
          <strong>{uiLanguage === "en" ? "What to do next" : "Que hacer ahora"}</strong>
          <p>{selected.what_to_do}</p>
        </section>
      </article>
    </div>
  );
}

function opportunityTone(opportunity: StrategicOpportunity) {
  if (opportunity.level === "competitive") return "barrier";
  if (opportunity.level === "brand" || opportunity.level === "content") return "trigger";
  return "mixed";
}

function opportunityLabel(level: StrategicOpportunity["level"], uiLanguage: "en" | "es") {
  const labels: Record<StrategicOpportunity["level"], { en: string; es: string }> = {
    brand: { en: "Brand move", es: "Movimiento de marca" },
    content: { en: "Content bet", es: "Apuesta de contenido" },
    product_cx: { en: "Product / CX fix", es: "Ajuste Producto / CX" },
    competitive: { en: "Competitive gap", es: "Gap competitivo" },
    measurement: { en: "Measurement bet", es: "Apuesta de medicion" },
    category: { en: "Category whitespace", es: "Whitespace de categoria" }
  };
  return labels[level][uiLanguage];
}

function confidenceLabel(confidence: string, uiLanguage: "en" | "es") {
  if (uiLanguage === "en") {
    if (confidence === "alta") return "High";
    if (confidence === "media") return "Medium";
    if (confidence === "baja_direccional") return "Directional";
  }
  return confidence.replace(/_/g, " ");
}

function friendlySources(sources: string[]) {
  const labels: Record<string, string> = {
    corpus: "Corpus",
    findings: "Findings",
    knowledge_base: "Knowledge Base",
    competitive_brief: "Competitive brief",
    uploaded_files: "Client files",
    brief: "Brief"
  };
  return sources.map((source) => labels[source] ?? source.replace(/_/g, " "));
}

function truncate(text: string, max: number) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}...`;
}
