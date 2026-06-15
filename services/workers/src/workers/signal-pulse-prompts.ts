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
  samples: Array<{ id: string; text: string; platform: string; published_at: string | null }>;
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
    "Evidencia trazable: los samples incluyen id de mention. En evidence_basis cita los sample ids y periodos que sostienen la lectura; no cites evidencia que no este en el JSON.",
    "No trabajes desde la keyword provisional. Esa palabra sólo identifica el cluster. La tesis debe salir del cruce entre investigation_brief, period_series, weekly_series, conversation_matches semanticos, knowledge_matches, samples con id, performance_context, source_inventory, structured_source_window, marketing_activity_window y repeated_marketing_language.",
    "period_series y weekly_series ya vienen calculadas por SQL para la señal: cuando hay embeddings usan vecindarios semánticos por mes/semana, no conteo por keyword. Usa esos números como fuente de verdad para nuevo, repetido, saturado, reactivado o caída; no recalcules ni reemplaces con intuición.",
    "Empieza cada lectura por investigation_brief: current_cut, window_pattern, strongest_periods, weekly_pulses, marketing_intersections, pattern_flags, evidence_map y synthesis_questions. Ese brief organiza el caso; úsalo para decidir si la señal es de corte actual, patrón de ventana o mixta.",
    "pattern_flags es el caso estructurado calculado antes del LLM: puede traer new_in_cut, repeated_window, saturation_candidate, reactivated, accelerating, declining, inactive_in_cut, weekly_spike, marketing_overlap, temporal_marketing_context o conversation_only. Usa esos flags para escribir window_read y marketing_hypothesis; no los contradigas sin explicar por qué.",
    "Mira por separado: (1) el corte mensual actual, (2) el patron de la ventana completa, (3) la serie semanal si existe para detectar picos, reactivaciones o caidas dentro del mes, (4) campanas/creativos/acciones de marketing activos en los periodos donde vive el cluster, (5) fuentes estructuradas del cliente por mes: pauta, organico, search, reviews, ecomm, ventas u otros adapters, (6) el mapa de actividad mensual de marketing y lenguaje repetido en la ventana, (7) conversation_matches recuperadas por RAG semantico, (8) si hay relacion o no con campanas/performance/brief/fuentes. Si sólo hay same_period_marketing_activity o same_active_period sin overlap de evidencia/lenguaje/KB, dilo como no_connection; no fuerces causalidad.",
    "Si el aprendizaje importante viene de varios meses, repeticiones, saturacion, ausencia de recepcion, reactivacion o anomalia historica, marca analysis_scope=\"window_pattern\" o \"mixed\" y explícalo. El corte mensual es la vista publicable, no el unico analisis.",
    "Para detectar riesgo creativo, saturacion o gap de pauta, cruza knowledge base/brief/campanas/performance/fuentes estructuradas con la serie mensual, matching_creatives.match_basis/matched_terms, matching_structured_sources.match_basis/matched_terms, structured_source_events y repeated_marketing_language: que prometio la marca, que pauta/organico/search/reviews/ecomm/ventas empujo o midio, que se repitio, que paso alrededor y que evidencia sostiene o descarta la conexion.",
    "structured_sources y structured_source_events ya vienen calculados por SQL/worker desde tablas estructuradas. Usalos para ubicar subidas, caidas o huecos de datos por mes/fuente/metrica, pero no inventes causalidad: si una fuente sólo coincide en periodo, escribe no_connection o temporal context.",
    "matching_structured_sources es distinto: son fuentes estructuradas de toda la ventana cuyo texto, entidad, query, review topic, campaign label o metrica sí matcheó evidencia/KB/brief/lenguaje repetido. Revisa period_relation: same_active_period puede sostener una conexión del corte; window_only sólo sostiene patrón histórico, saturación, reactivación o contexto de ventana, y no debe sonar a causalidad del mes actual.",
    "Sus match_basis evidence_overlap, knowledge_or_brief_overlap o repeated_marketing_language_overlap pueden sostener una hipotesis connected igual que matching_creatives, pero si el match es window_only la hipótesis debe decir que es conexión de ventana/patrón, no efecto directo de una campaña del corte. same_active_period por sí solo no alcanza.",
    "Si matching_creatives existe, revisa relevance_score, match_basis y matched_terms. No lo trates como causa: evidence_overlap, knowledge_or_brief_overlap o repeated_marketing_language_overlap autorizan una hipótesis; same_active_period por sí solo sólo autoriza contexto temporal.",
    "performance_connection debe empezar exactamente con connected:, no_connection: o insufficient_data:. Usa connected: sólo si matching_creatives o matching_structured_sources tienen evidence_overlap, knowledge_or_brief_overlap o repeated_marketing_language_overlap; si sólo comparte periodo/campaña/fuente sin overlap directo, usa no_connection:.",
    "marketing_hypothesis debe ser coherente con performance_connection: si dices no_connection, la hipótesis debe explicar que no hay evidencia/overlap y que no se debe atribuir; si dices insufficient_data, debe nombrar la falta de datos; si dices connected, debe nombrar el overlap concreto de campaña/claim/pieza/fuente/evidencia.",
    "Cada publish necesita cuatro lecturas separadas: period_read (que pasó en el corte/semana actual), window_read (qué revela la ventana de 12 meses: nuevo, repetido, saturado, reactivado, caída o anomalía), marketing_hypothesis (qué acción/claim/campaña/fuente estructurada se conecta o por qué NO se puede conectar) y next_month_decision (qué mover, medir, pausar, testear o monitorear el próximo mes).",
    "No repitas la misma frase en esos campos: period_read mira el corte, window_read mira el patrón, marketing_hypothesis cruza KB/performance/campañas/fuentes, next_month_decision baja la decisión operativa. Si alguno queda genérico, usa actionability=\"review\".",
    "Taxonomia permitida para title: Friccion, Oportunidad, Riesgo creativo, Territorio saturado, Claim a testear, Senal emergente, Gap de pauta, Contencion, Monitoreo.",
    "Buenos titulos: \"Riesgo creativo: La promesa de rapidez choca con quejas sobre tramites\", \"Oportunidad: Educacion practica sobre choques en cadena\", \"Territorio saturado: Seguro auto como claim generico ya no diferencia\", \"Gap de pauta: La campana habla de confianza, pero la conversacion pide claridad\", \"Senal emergente: La comparacion entre aseguradoras se mueve de precio a resolucion\".",
    "Malos titulos: \"Friccion: Seguro\", \"Choque\", \"Aseguradora\", \"Oportunidad: Excelente\", o cualquier prefijo de metodologias estrategicas que no sea Signal Pulse.",
    "Si no puedes escribir una tesis comparable a los buenos titulos, no la maquilles: usa actionability=\"review\" o \"exclude\" y explica en confidence_rationale que falta evidencia, contexto o síntesis. Una fila publish con titulo keyword, accion generica o causalidad no probada sera bloqueada.",
    "Para actionability=\"publish\", title debe tener taxonomia + tesis accionable, signal_role debe corresponder a esa taxonomia, evidence_basis debe citar mention_id reales, action_hint debe decir una accion de marketing medible, performance_connection debe estar calificada y los cuatro campos period/window/marketing/decision deben estar completos.",
    "Marca actionability=\"publish\" solo si hay una lectura humana clara, evidencia suficiente y una implicacion movible por Marketing en 1-4 semanas. Usa \"review\" si hay pista cualitativa pero falta sintesis o conexion. Usa \"exclude\" si es ruido, politica, insulto sin aprendizaje, entidad suelta o conversacion sin vinculo claro.",
    "Devuelve SOLO JSON válido con forma:",
    '{"signals":[{"id":"uuid","title":"Friccion/Oportunidad/Riesgo creativo/...: tesis accionable","signal_role":"friction|content_opportunity|creative_risk|saturation|claim_test|emerging_signal|paid_gap|containment|monitor","analysis_scope":"current_cut|window_pattern|mixed","period_read":"Qué pasó en el corte mensual/semanal actual con números del JSON.","window_read":"Qué revela la ventana completa: nuevo, repetido, saturado, reactivado, caída o anomalía.","marketing_hypothesis":"Cómo se cruza o no con campaña, claim, pauta, orgánico, brief, search, ecomm, reviews, ventas o performance estructurada.","next_month_decision":"Decisión operativa para el próximo mes y cómo medirla.","description":"Lectura cualitativa con numeros del JSON y periodo.","marketing_read":"Implicacion para Marketing conectada a brief/performance si existe.","performance_connection":"connected:|no_connection:|insufficient_data: explicacion corta.","evidence_basis":"Sample ids/periodos y datos del JSON usados; sin inventar.","action_hint":"Siguiente accion concreta de Marketing.","confidence_rationale":"Por que publish/review/exclude.","actionability":"publish|review|exclude"}]}',
    "Contexto de marca, brief, fuentes y performance 12 meses:",
    JSON.stringify(marketingContext),
    "Clusters:",
    JSON.stringify(batch)
  ].join("\n\n");
}
