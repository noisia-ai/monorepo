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

export function buildSignalPulseDeterministicRead(input: SignalPulseCopyInput): SignalPulseCopy {
  const territory = cleanTerritory(input.term || input.canonicalTitle);
  const title = titleForSignal(territory, input);
  const platformLabel = platformPhrase(input.platforms);
  const evidenceLabel = evidencePhrase(input.mentionCount);
  const sentimentLabel = sentimentPhrase(input.sentimentAvg);
  const posture = postureFor(input);

  return {
    title,
    description: `${evidenceLabel} ${platformLabel} esta empujando "${territory}" con tono ${sentimentLabel}. No es una conclusion de escritorio: sale de un cluster de menciones y debe leerse como territorio accionable del mes.`,
    marketingRead: `${posture.read} El equipo puede convertirlo en una prueba concreta sin sobrerreaccionar: un hook, una pieza corta o una variante de pauta que mida respuesta real.`,
    actionHint: posture.action,
    interpretationSource: "deterministic_marketing_read_v2"
  };
}

function titleForSignal(territory: string, input: SignalPulseCopyInput) {
  const core = titleCase(territory).replace(/^Territorio\s+/i, "");
  if (input.signalType === "risk") return `Friccion: ${core}`;
  if (input.signalType === "opportunity") return `Oportunidad: ${core}`;
  if (input.rank <= 3) return `Prioridad: ${core}`;
  return core;
}

function postureFor(input: SignalPulseCopyInput) {
  const territory = cleanTerritory(input.term || input.canonicalTitle);
  if (input.signalType === "risk" || (input.sentimentAvg ?? 0) < -0.12) {
    return {
      read: `La senal marca una friccion que conviene contener antes de amplificar el territorio.`,
      action: `Preparar una respuesta de contenido que reduzca duda sobre "${territory}" y medir si baja la conversacion negativa.`
    };
  }
  if (input.signalType === "opportunity" || (input.sentimentAvg ?? 0) > 0.18) {
    return {
      read: `La senal trae energia positiva suficiente para probarla como angulo creativo.`,
      action: `Testear "${territory}" como claim o hook principal en una celda pequena de contenido/pauta.`
    };
  }
  return {
    read: `La senal todavia no pide una apuesta grande; pide aprender rapido si el territorio mueve respuesta.`,
    action: `Convertir "${territory}" en una prueba de bajo costo y comparar contra el mensaje base del mes.`
  };
}

function evidencePhrase(count: number) {
  if (count >= 80) return `${count} menciones sostienen una senal de alta presencia.`;
  if (count >= 30) return `${count} menciones sostienen una senal con traccion suficiente.`;
  if (count >= 8) return `${count} menciones alcanzan para una lectura direccional.`;
  return `${count} menciones apenas alcanzan para monitoreo.`;
}

function sentimentPhrase(value: number | null) {
  if (value === null) return "sin polaridad clara";
  if (value > 0.35) return "muy favorable";
  if (value > 0.12) return "favorable";
  if (value < -0.28) return "critico";
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
    .replace(/^territorio\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() || "senal de conversacion";
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
