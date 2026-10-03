import { defineEngineMethodologySpec } from "./shared";

export const trustRiskBenchmark = defineEngineMethodologySpec({
  slug: "trust-risk-benchmark",
  unitKind: "trust_risk_signal",
  requiresCompetitors: true,
  minMentionsPerEntity: 120,
  dimensionSchema: {
    trust_driver: { type: "text" },
    risk_theme: { type: "text" },
    severity: { type: "enum", values: ["low", "medium", "high", "critical"] as const },
    escalating: { type: "enum", values: ["yes", "no", "unclear"] as const }
  },
  clientPromise: "Benchmark de confianza y riesgo reputacional por entidad, con vulnerabilidades y alertas de escalada.",
  codingInstruction: "Clasifica driver de confianza o tema de riesgo, severidad y escalamiento observable.",
  charts: ["gauge", "diverging_bar", "timeline", "evidence_list"],
  qualityGates: ["risk_quote_required", "severity_calibrated", "no_unverified_accusations", "confidence_calibrated"]
});
