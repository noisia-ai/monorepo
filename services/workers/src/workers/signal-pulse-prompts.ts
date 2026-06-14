import type { SignalPulseClusterPromptContext, SignalPulseMarketingContext } from "./signal-pulse-rag-context";

export type SignalPulseClusterNamingPromptPayload = {
  id: string;
  current_title: string;
  signal_type: string;
  term: string;
  rank: number;
  mention_count: number;
  sentiment_avg: number | null;
  platforms: string[];
  discovery_periods: string[];
  max_period_mention_count: number;
  samples: Array<{ text: string; platform: string; published_at: string | null }>;
  context: SignalPulseClusterPromptContext;
};

export function buildClaudeSignalNamingPrompt(
  batch: SignalPulseClusterNamingPromptPayload[],
  marketingContext: SignalPulseMarketingContext
) {
  return [
    "Eres editor senior de Noisia para Signal Pulse: una capa de inteligencia sobre 12 meses de actividad de marketing, performance y conversacion.",
    "Tu trabajo NO es nombrar keywords ni copiar metodologias estrategicas. Convierte clusters en senales tacticas para Marketing: que significo, que provoco, que se desaprovecho, que riesgo se repite y que deberia moverse el siguiente mes.",
    "Usa la misma disciplina cualitativa de Noisia: lee evidencia, knowledge base, brief, calendario/campanas si existe, performance estructurada y serie mensual. Pero el lenguaje frontstage es de Marketing, no de metodologias estrategicas pausadas.",
    "Reglas duras: no hagas coding por mencion; no inventes numeros; usa solo numeros del JSON; conserva ids; espanol MX; copy corto y client-safe; SQL calcula y tu interpretas.",
    "Mira por separado: (1) el corte mensual actual, (2) el patron de la ventana completa, (3) la serie semanal si existe para detectar picos, reactivaciones o caidas dentro del mes, (4) si hay relacion o no con campanas/performance/brief. Si no hay relacion comprobable, dilo como no_connection; no fuerces causalidad.",
    "Taxonomia permitida para title: Friccion, Oportunidad, Riesgo creativo, Territorio saturado, Claim a testear, Senal emergente, Gap de pauta, Contencion, Monitoreo.",
    "Buenos titulos: \"Riesgo creativo: La promesa de rapidez choca con quejas sobre tramites\", \"Oportunidad: Educacion practica sobre choques en cadena\", \"Territorio saturado: Seguro auto como claim generico ya no diferencia\", \"Gap de pauta: La campana habla de confianza, pero la conversacion pide claridad\", \"Senal emergente: La comparacion entre aseguradoras se mueve de precio a resolucion\".",
    "Malos titulos: \"Friccion: Seguro\", \"Choque\", \"Aseguradora\", \"Oportunidad: Excelente\", o cualquier prefijo de metodologias estrategicas que no sea Signal Pulse.",
    "Marca actionability=\"publish\" solo si hay una lectura humana clara, evidencia suficiente y una implicacion movible por Marketing en 1-4 semanas. Usa \"review\" si hay pista cualitativa pero falta sintesis o conexion. Usa \"exclude\" si es ruido, politica, insulto sin aprendizaje, entidad suelta o conversacion sin vinculo claro.",
    "Devuelve SOLO JSON válido con forma:",
    '{"signals":[{"id":"uuid","title":"Friccion/Oportunidad/Riesgo creativo/...: tesis accionable","signal_role":"friction|content_opportunity|creative_risk|saturation|claim_test|emerging_signal|paid_gap|containment|monitor","description":"Lectura cualitativa con numeros del JSON y periodo.","marketing_read":"Implicacion para Marketing conectada a brief/performance si existe.","performance_connection":"connected|no_connection|insufficient_data + explicacion corta.","evidence_basis":"Que evidencia del JSON usaste, sin inventar.","action_hint":"Siguiente accion concreta de Marketing.","confidence_rationale":"Por que publish/review/exclude.","actionability":"publish|review|exclude"}]}',
    "Contexto de marca, brief, fuentes y performance 12 meses:",
    JSON.stringify(marketingContext),
    "Clusters:",
    JSON.stringify(batch)
  ].join("\n\n");
}
