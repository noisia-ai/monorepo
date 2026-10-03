export type SignalPulseCopyInput = {
  canonicalTitle: string;
  term: string;
  signalType: string;
  mentionCount: number;
  sentimentAvg: number | null;
  platforms: string[];
  rank: number;
};

export type SignalPulseCopy = {
  title: string;
  description: string;
  marketingRead: string;
  actionHint: string;
  interpretationSource: "deterministic_marketing_read_v2";
};

export type SignalPulseMoveInput = {
  title: string;
  moveType: string;
  lifecycle: string | null;
  confidence: string | null;
  impact: number;
  volume: number;
  marketingRead: string;
  actionHint: string;
  signalRole?: string | null;
  performanceConnection?: string | null;
  evidenceBasis?: string | null;
  confidenceRationale?: string | null;
};

export type SignalPulseMoveCopy = {
  actionText: string;
  ownerSuggestion: string;
  timing: string;
  measurementSuggestion: string;
  noGoNotes: string | null;
};

export function buildSignalPulseDeterministicRead(input: SignalPulseCopyInput): SignalPulseCopy {
  const territory = cleanTerritory(input.term || input.canonicalTitle);

  return {
    title: `Cluster pendiente de síntesis: ${titleCase(territory)}`,
    description: `${evidencePhrase(input.mentionCount)} ${platformPhrase(input.platforms)} agrupó conversación alrededor de "${territory}", pero todavía no hay una lectura editorial publicable.`,
    marketingRead: "Pendiente de síntesis por Claude: este cluster no debe entrar al Pulse ni generar acciones hasta convertirse en una tensión, oportunidad o aprendizaje claro.",
    actionHint: "Revisar muestras y sintetizar el porqué de la conversación antes de proponer contenido, pauta o claims.",
    interpretationSource: "deterministic_marketing_read_v2"
  };
}

export function buildSignalPulseMarketingMove(input: SignalPulseMoveInput): SignalPulseMoveCopy {
  const territory = cleanTerritory(input.title);
  const role = normalizeSignalRole(input.signalRole);
  const connection = normalizePerformanceConnection(input.performanceConnection);
  const actionHint = stripTerminalPunctuation(input.actionHint || defaultAction(input.moveType, territory, role));
  const urgency = urgencyFor(input);

  return {
    actionText: actionTextFor(input.moveType, actionHint, territory, role, connection),
    ownerSuggestion: ownerForMove(input.moveType, role),
    timing: urgency.timing,
    measurementSuggestion: measurementFor(input, territory, role, connection),
    noGoNotes: noGoFor(input, urgency.reason, role, connection)
  };
}

function actionTextFor(moveType: string, actionHint: string, territory: string, role: string, connection: string) {
  const connectionGuard = connection === "no_connection"
    ? " Tratarlo como aprendizaje de conversación independiente, no como efecto probado de campaña."
    : "";

  if (role === "paid_gap") {
    return `${actionHint}. Auditar piezas, inversión y promesa activa en los meses donde aparece la señal; separar performance de conversación antes de mover presupuesto.${connectionGuard}`;
  }
  if (role === "creative_risk") {
    return `${actionHint}. Revisar claim, copy y respuesta de comunidad antes de escalar; buscar si el patrón se repite en la ventana completa.${connectionGuard}`;
  }
  if (role === "saturation") {
    return `${actionHint}. Probar un ángulo alterno fuera del claim saturado y comparar contra el territorio base.${connectionGuard}`;
  }
  if (role === "claim_test") {
    return `${actionHint}. Convertirlo en dos hooks rivales y correr una prueba chica antes de volverlo claim de campaña.${connectionGuard}`;
  }
  if (role === "emerging_signal") {
    return `${actionHint}. Validar si el pico es semanal, mensual o una reactivación de ventana antes de asignarle presupuesto.${connectionGuard}`;
  }
  if (role === "containment") {
    return `${actionHint}. Preparar respuesta, FAQ o pieza aclaratoria antes de empujar contenido adicional.${connectionGuard}`;
  }
  if (role === "friction") {
    return `${actionHint}. Convertir la fricción en una pieza de claridad y revisar si reduce duda, queja o abandono del tema.${connectionGuard}`;
  }
  if (role === "content_opportunity") {
    return `${actionHint}. Bajarla a una pieza de aprendizaje y medir si genera lenguaje reutilizable antes de escalarla.${connectionGuard}`;
  }
  if (moveType === "test_claim") {
    return `${actionHint}. Convertirlo en dos hooks rivales y correr una prueba chica antes de volverlo claim de campaña.${connectionGuard}`;
  }
  if (moveType === "amplify") {
    return `${actionHint}. Darle distribución controlada y compararlo contra el mensaje base, no contra intuición interna.${connectionGuard}`;
  }
  if (moveType === "monitor") {
    return `Mantener "${territory}" en monitoreo activo y preparar respuesta solo si sube volumen o negatividad.${connectionGuard}`;
  }
  return `Usar "${territory}" como experimento de contenido: ${actionHint.toLowerCase()} y cerrar una pregunta de aprendizaje antes de escalarlo.${connectionGuard}`;
}

function measurementFor(input: SignalPulseMoveInput, territory: string, role: string, connection: string) {
  const impactLabel = input.impact >= 65 ? "impacto alto" : input.impact >= 35 ? "impacto medio" : "impacto bajo";
  if (connection === "no_connection") {
    return `Medir volumen, sentimiento y evidencia por periodo para "${territory}"; mantener KPIs de campaña separados hasta validar conexión.`;
  }
  if (connection === "insufficient_data") {
    return `Completar performance/campaña del periodo y volver a comparar volumen, sentimiento y evidencia antes de escalar "${territory}".`;
  }
  if (role === "paid_gap") {
    return `Comparar CTR, costo por interacción, volumen y sentimiento por mes; decidir sólo si el cruce con campaña se sostiene frente al control.`;
  }
  if (role === "creative_risk") {
    return `Medir cambio en dudas/quejas, comentarios útiles y performance de la pieza ajustada contra la pieza original.`;
  }
  if (role === "saturation") {
    return `Medir fatiga del claim: repetición mensual, caída de interacción y calidad de comentarios frente a un ángulo alterno.`;
  }
  if (role === "claim_test") {
    return `Comparar hook rate, comentarios de claridad y costo por interacción entre variantes del claim "${territory}".`;
  }
  if (role === "emerging_signal") {
    return `Validar si el pico se repite la siguiente semana/mes y si arrastra engagement o sólo volumen aislado.`;
  }
  if (role === "containment") {
    return `Medir reducción de duda/negatividad y aparición de evidencia nueva antes de activar pauta o contenido adicional.`;
  }
  if (input.moveType === "test_claim") {
    return `Comparar hook rate, comentarios útiles y costo por interacción del territorio "${territory}" contra el control.`;
  }
  if (input.moveType === "amplify") {
    return `Medir CTR, guardados, menciones orgánicas y cambio de sentimiento; separar aprendizaje de performance por ${impactLabel}.`;
  }
  if (input.moveType === "monitor") {
    return `Revisar volumen, sentimiento y evidencia protagonista en el siguiente corte antes de activar piezas.`;
  }
  return `Medir retención, shares y comentarios con lenguaje reutilizable; cerrar decisión con ${input.volume} menciones como base.`;
}

function noGoFor(input: SignalPulseMoveInput, urgencyReason: string, role: string, connection: string) {
  if (connection === "no_connection") return `No venderlo como efecto de campaña: ${urgencyReason}`;
  if (connection === "insufficient_data") return `No escalar sin completar evidencia estructurada: ${urgencyReason}`;
  if (role === "creative_risk") return `No amplificar el claim original sin ajuste creativo: ${urgencyReason}`;
  if (role === "saturation") return `No repetir el mismo claim como si fuera diferencial: ${urgencyReason}`;
  if (input.confidence === "alta" && input.impact >= 50) return null;
  if (input.moveType === "monitor") return `No mover presupuesto todavía: ${urgencyReason}`;
  if (input.confidence === "media") return `Mantenerlo como experimento: ${urgencyReason}`;
  return `No convertirlo en promesa fuerte hasta sumar evidencia: ${urgencyReason}`;
}

function urgencyFor(input: SignalPulseMoveInput) {
  if (input.lifecycle === "emerging" || input.lifecycle === "reappeared") {
    return { timing: "esta semana", reason: input.lifecycle === "reappeared" ? "la señal reapareció y necesita validación rápida" : "la señal está emergiendo y necesita validación rápida" };
  }
  if (input.lifecycle === "rising" || input.impact >= 65) {
    return { timing: "este mes", reason: "la señal ya trae momentum suficiente para una prueba visible" };
  }
  if (input.lifecycle === "declining") {
    return { timing: "siguiente corte", reason: "la señal viene perdiendo fuerza" };
  }
  return { timing: "siguiente sprint", reason: "la señal todavía necesita aprendizaje incremental" };
}

function ownerForMove(moveType: string, role: string) {
  if (role === "paid_gap") return "Paid media + Creative";
  if (role === "creative_risk") return "Brand + Creative";
  if (role === "saturation") return "Brand + Social";
  if (role === "claim_test") return "Brand + Creative";
  if (role === "content_opportunity") return "Social + Content";
  if (role === "emerging_signal") return "Insights + Social";
  if (role === "containment") return "Community + Brand";
  if (role === "friction") return "Customer care + Brand";
  if (moveType === "amplify") return "Paid media + Brand";
  if (moveType === "test_claim") return "Brand + Creative";
  if (moveType === "monitor") return "Insights";
  return "Social + Content";
}

function defaultAction(moveType: string, territory: string, role = "monitor") {
  if (role === "paid_gap") return `Revisar el gap entre pauta activa y conversación sobre "${territory}"`;
  if (role === "creative_risk") return `Ajustar el claim o pieza que está detonando riesgo alrededor de "${territory}"`;
  if (role === "saturation") return `Buscar un ángulo alterno para salir de la saturación de "${territory}"`;
  if (role === "claim_test") return `Testear "${territory}" como claim específico`;
  if (role === "emerging_signal") return `Validar si "${territory}" está emergiendo o sólo fue un pico aislado`;
  if (role === "containment") return `Contener dudas o fricción alrededor de "${territory}"`;
  if (role === "friction") return `Convertir la fricción de "${territory}" en contenido de claridad`;
  if (moveType === "test_claim") return `Testear "${territory}" como claim específico`;
  if (moveType === "amplify") return `Amplificar "${territory}" con presupuesto controlado`;
  if (moveType === "monitor") return `Monitorear "${territory}" sin escalarlo todavía`;
  return `Convertir "${territory}" en contenido de prueba`;
}

function evidencePhrase(count: number) {
  if (count >= 80) return `${count} menciones sostienen una señal de alta presencia.`;
  if (count >= 30) return `${count} menciones sostienen una señal con tracción suficiente.`;
  if (count >= 8) return `${count} menciones alcanzan para una lectura direccional.`;
  return `${count} menciones apenas alcanzan para monitoreo.`;
}

function sentimentPhrase(value: number | null) {
  if (value === null) return "sin polaridad clara";
  if (value > 0.35) return "muy favorable";
  if (value > 0.12) return "favorable";
  if (value < -0.28) return "crítico";
  if (value < -0.08) return "cauto";
  return "mixto";
}

function platformPhrase(platforms: string[]) {
  const clean = platforms.map((platform) => platform.trim()).filter(Boolean).slice(0, 2);
  if (clean.length === 0) return "El corpus";
  if (clean.length === 1) return `En ${clean[0]}, el corpus`;
  return `En ${clean[0]} y ${clean[1]}, el corpus`;
}

function cleanTerritory(value: string) {
  return value
    .replace(/^(fricción|friccion|oportunidad|riesgo creativo|territorio saturado|claim a testear|señal emergente|senal emergente|gap de pauta|contención|contencion|monitoreo|territorio):\s*/i, "")
    .replace(/^territorio\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() || "señal de conversación";
}

function normalizeSignalRole(value: string | null | undefined) {
  const role = typeof value === "string" ? value : "";
  return [
    "friction",
    "content_opportunity",
    "creative_risk",
    "saturation",
    "claim_test",
    "emerging_signal",
    "paid_gap",
    "containment",
    "monitor"
  ].includes(role) ? role : "monitor";
}

function normalizePerformanceConnection(value: string | null | undefined) {
  const connection = String(value ?? "").toLowerCase();
  if (connection.startsWith("connected")) return "connected";
  if (connection.startsWith("no_connection")) return "no_connection";
  if (connection.startsWith("insufficient_data")) return "insufficient_data";
  return "unknown";
}

function stripTerminalPunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
