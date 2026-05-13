export type VoiceCard = {
  platform: string;
  market: string;
  age: string;
  quote: string;
  position: {
    x: string;
    y: string;
    rotate: string;
  };
};

export type PipelineStep = {
  label: string;
  detail: string;
  metric: string;
  fill: string;
};

export type ForceMetric = {
  label: string;
  value: string;
  tone?: "signal" | "tension";
};

export type Recommendation = {
  title: string;
  body: string;
  move: string;
};

export const heroVoiceCards: VoiceCard[] = [
  {
    platform: "Instagram",
    market: "MX",
    age: "hace 2 h",
    quote: "Está bonito, pero no entendí por qué cuesta eso.",
    position: { x: "clamp(-620px, -35vw, -430px)", y: "clamp(-245px, -25vh, -160px)", rotate: "-8deg" }
  },
  {
    platform: "Google Reviews",
    market: "CO",
    age: "hace 1 d",
    quote: "El soporte tardó tres días y ahí se me cayó la confianza.",
    position: { x: "clamp(380px, 32vw, 590px)", y: "clamp(-235px, -22vh, -150px)", rotate: "7deg" }
  },
  {
    platform: "TikTok",
    market: "MX",
    age: "hace 8 h",
    quote: "Todo el mundo repite el mismo claim. Ya nadie se lo cree.",
    position: { x: "clamp(-700px, -41vw, -500px)", y: "clamp(18px, 6vh, 84px)", rotate: "-5deg" }
  },
  {
    platform: "Reddit",
    market: "AR",
    age: "hace 3 d",
    quote: "No necesito más features. Necesito saber qué pasa si falla.",
    position: { x: "clamp(470px, 39vw, 700px)", y: "clamp(20px, 7vh, 92px)", rotate: "6deg" }
  },
  {
    platform: "App Store",
    market: "MX",
    age: "hace 6 h",
    quote: "La app hace lo que promete, pero el onboarding me perdió.",
    position: { x: "clamp(-560px, -30vw, -350px)", y: "clamp(205px, 27vh, 285px)", rotate: "-4deg" }
  },
  {
    platform: "Foro",
    market: "PE",
    age: "hace 2 d",
    quote: "Si me explicaran mejor la diferencia entre planes, sí pagaba más.",
    position: { x: "clamp(420px, 30vw, 620px)", y: "clamp(210px, 28vh, 300px)", rotate: "4deg" }
  },
  {
    platform: "YouTube",
    market: "CL",
    age: "hace 5 h",
    quote: "El demo se ve bien, pero nadie explica qué cambia en mi día a día.",
    position: { x: "clamp(-315px, -18vw, -210px)", y: "clamp(-305px, -34vh, -230px)", rotate: "5deg" }
  },
  {
    platform: "Trustpilot",
    market: "ES",
    age: "hace 4 d",
    quote: "La promesa es fuerte, la experiencia no la sostiene igual.",
    position: { x: "clamp(210px, 18vw, 320px)", y: "clamp(-300px, -33vh, -220px)", rotate: "-5deg" }
  },
  {
    platform: "X",
    market: "BR",
    age: "hace 3 h",
    quote: "Todos dicen innovación, pero el problema real sigue siendo soporte.",
    position: { x: "clamp(-760px, -45vw, -610px)", y: "clamp(-80px, -8vh, -46px)", rotate: "4deg" }
  },
  {
    platform: "Facebook",
    market: "PE",
    age: "hace 9 h",
    quote: "Antes respondían rápido. Ahora parece que nadie se hace cargo.",
    position: { x: "clamp(610px, 45vw, 770px)", y: "clamp(-90px, -9vh, -42px)", rotate: "-6deg" }
  },
  {
    platform: "Instagram",
    market: "AR",
    age: "hace 1 d",
    quote: "Me gusta, pero necesito entender por qué vale más que la opción simple.",
    position: { x: "clamp(-380px, -22vw, -250px)", y: "clamp(145px, 18vh, 210px)", rotate: "6deg" }
  },
  {
    platform: "Google Reviews",
    market: "MX",
    age: "hace 7 h",
    quote: "La compra fue fácil. La explicación después fue donde me perdí.",
    position: { x: "clamp(240px, 22vw, 380px)", y: "clamp(155px, 19vh, 220px)", rotate: "-4deg" }
  },
  {
    platform: "TikTok",
    market: "CO",
    age: "hace 11 h",
    quote: "La gente no odia el precio. Odia sentir que le vendieron humo.",
    position: { x: "clamp(-680px, -39vw, -510px)", y: "clamp(170px, 23vh, 260px)", rotate: "-7deg" }
  },
  {
    platform: "Reddit",
    market: "MX",
    age: "hace 2 d",
    quote: "El problema no es la feature. Es que nadie confía en que funcione.",
    position: { x: "clamp(560px, 38vw, 690px)", y: "clamp(175px, 24vh, 270px)", rotate: "5deg" }
  },
  {
    platform: "App Store",
    market: "CL",
    age: "hace 1 h",
    quote: "Promete ahorro, pero me hizo perder tiempo configurando todo.",
    position: { x: "clamp(-110px, -8vw, -70px)", y: "clamp(300px, 36vh, 365px)", rotate: "-3deg" }
  },
  {
    platform: "Foro",
    market: "CO",
    age: "hace 6 d",
    quote: "Si hay garantía humana, pago. Si todo es bot, no me arriesgo.",
    position: { x: "clamp(96px, 10vw, 180px)", y: "clamp(302px, 36vh, 370px)", rotate: "3deg" }
  }
];

export const heroPipelineSteps: PipelineStep[] = [
  {
    label: "Recolectando",
    detail: "Reviews · foros · redes · marketplaces",
    metric: "2,847 señales",
    fill: "100%"
  },
  {
    label: "Normalizando",
    detail: "1 esquema · 12 idiomas · deduplicación",
    metric: "1,932 únicas",
    fill: "94%"
  },
  {
    label: "Enriqueciendo",
    detail: "Sarcasmo · tono · entidades · jobs",
    metric: "8 capas",
    fill: "88%"
  },
  {
    label: "Codificando",
    detail: "Triggers · barriers · velocidad · valor",
    metric: "1,247 expresiones",
    fill: "78%"
  },
  {
    label: "Cuantificando",
    detail: "Frecuencia · intensidad · poder explicativo",
    metric: "12 fuerzas",
    fill: "68%"
  },
  {
    label: "Traduciendo",
    detail: "Insight → recomendación defendible",
    metric: "3 movimientos",
    fill: "58%"
  }
];

// Caso ilustrativo: banca digital LATAM. Triggers (signal) y barriers (tension) mezclados
// para mostrar la matriz que la metodología produce.
export const heroMethodologyMetrics: ForceMetric[] = [
  { label: "depósito inmediato sin papeleo", value: "47.3%", tone: "signal" },
  { label: "miedo a fraude en lo digital", value: "36.4%", tone: "tension" },
  { label: "control 24/7 desde el celular", value: "31.8%", tone: "signal" },
  { label: "comisiones que no entiendo", value: "27.6%", tone: "tension" }
];

export const heroStateRead = [
  { state: "México", share: "62", label: "prioriza estabilidad antes que features" },
  { state: "Colombia", share: "47", label: "lealtad si hay sucursal accesible" },
  { state: "Argentina", share: "41", label: "comparación constante con dólar" },
  { state: "Chile", share: "35", label: "rotación por cashback diferencial" }
];

export const heroRecommendations: Recommendation[] = [
  {
    title: "Visibilizar costos antes de signup",
    body: "El barrier dominante no es producto digital. Es no entender qué se paga. Mostrar el desglose completo antes de pedir datos cierra el miedo más reportado.",
    move: "Reescribir flujo de signup"
  },
  {
    title: "Segmentar el mensaje por mercado",
    body: "En México defender estabilidad y backing institucional. En Chile competir por incentivo concreto. La misma campaña en ambos mercados convierte 0.4x.",
    move: "Diseñar copy por país"
  },
  {
    title: "Construir presencia híbrida en Colombia",
    body: "El barrier territorial pide sucursal física. Una alianza local con presencia visible reduce desconfianza donde el digital puro no escala todavía.",
    move: "Plan de cobertura híbrida"
  }
];

export const heroSignature = [
  { value: "150+", label: "fuentes normalizadas" },
  { value: "6", label: "metodologías propietarias" },
  { value: "1", label: "decisión defendible por lectura" }
];
