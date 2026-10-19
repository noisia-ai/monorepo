// What each situation page shows beyond its words: the animated diagram in the hero and one
// diagram per step of "how we solve it". Examples inside the diagrams are illustrative.
import type { ApproachCopy } from "@/motion/ApproachComposition";
import type { HeroCopy } from "@/motion/HeroComposition";
import type { KeywordsCopy } from "@/motion/KeywordsComposition";
import type { EnterCopy, LaunchCopy } from "@/motion/HeroSlides";
import type { PlanCopy, ReportCopy, StudyCopy } from "@/motion/OfferCompositions";
import type { JourneyCopy, TrendCopy } from "@/motion/SignalCompositions";
import type { UnderstandCopy } from "@/motion/UnderstandComposition";
import { home } from "./home";
import { offer } from "./offer";

export type Diagram =
  | { kind: "report"; copy: ReportCopy }
  | { kind: "trend"; copy: TrendCopy }
  | { kind: "journey"; copy: JourneyCopy }
  | { kind: "why"; copy: HeroCopy }
  | { kind: "launch"; copy: LaunchCopy }
  | { kind: "enter"; copy: EnterCopy }
  | { kind: "understand"; copy: UnderstandCopy }
  | { kind: "plan"; copy: PlanCopy }
  | { kind: "study"; copy: StudyCopy }
  | { kind: "keywords"; copy: KeywordsCopy }
  | { kind: "approach"; copy: ApproachCopy }
  | { kind: "track"; copy: import("@/motion/HeroSlides").TrackCopy }
  | { kind: "trendCurve"; copy: TrendCopy };

type Lang = "es" | "en";

export const situationLabels: Record<Lang, { always: string; project: string; method: string; step: string; noisia: string; others: string; more: string; play: string; pause: string }> = {
  es: { always: "Siempre activo", project: "Estudio puntual", method: "Método", step: "Paso", noisia: "Noisia", others: "Otras situaciones", more: "Ver cómo lo resolvemos", play: "Reproducir", pause: "Pausar" },
  en: { always: "Always on", project: "One-off study", method: "Method", step: "Step", noisia: "Noisia", others: "Other situations", more: "See how we solve it", play: "Play", pause: "Pause" }
};


const journey: Record<Lang, JourneyCopy> = {
  es: {
    steps: ["Buscar", "Comprar", "Pagar", "Recibir", "Usar"],
    current: "Septiembre",
    previous: "Agosto",
    quote: "Pagué el envío exprés y llegó cuatro días después",
    platform: "X",
    fixLabel: "Arreglar primero",
    fix: "La promesa de entrega: este mes es la fricción que más creció"
  },
  en: {
    steps: ["Search", "Buy", "Pay", "Receive", "Use"],
    current: "September",
    previous: "August",
    quote: "I paid for express shipping and it came four days later",
    platform: "X",
    fixLabel: "Fix first",
    fix: "The delivery promise: this month it is the friction that grew most"
  }
};

const defendWhy: Record<Lang, HeroCopy> = {
  es: {
    question: "¿Por qué la gente se cambia a la competencia?",
    clusters: ["Precio", "Promesa", "Servicio", "Cobertura", "Confianza"],
    noise: "Ruido",
    approved: "Aprobado por un experto",
    answerLabel: "La respuesta",
    answer: "Su promesa de entrega se siente más creíble",
    quote: "Con ellos llega cuando dicen, con ustedes nunca sé"
  },
  en: {
    question: "Why do people switch to the competition?",
    clusters: ["Price", "Promise", "Service", "Coverage", "Trust"],
    noise: "Noise",
    approved: "Approved by an expert",
    answerLabel: "The answer",
    answer: "Their delivery promise feels more credible",
    quote: "With them it arrives when they say, with you I never know"
  }
};

const innovate: Record<Lang, UnderstandCopy> = {
  es: {
    quote: "Le pongo limón y sal porque sola me sabe muy dulce, y ya no la compro para los niños",
    layers: ["Psicológica", "Personal", "Social", "Cultural"],
    chips: [
      { text: "Antojo", layer: 0, kind: "trigger" },
      { text: "Muy dulce", layer: 1, kind: "barrier" },
      { text: "Lo que doy a mis hijos", layer: 2, kind: "barrier" },
      { text: "Limón y sal", layer: 3, kind: "trigger" }
    ],
    trigger: "Lo que la mueve",
    barrier: "Lo que la frena",
    caption: "Un arreglo casero también es una necesidad sin resolver."
  },
  en: {
    quote: "I add lime and salt because on its own it's too sweet, and I stopped buying it for the kids",
    layers: ["Psychological", "Personal", "Social", "Cultural"],
    chips: [
      { text: "Craving", layer: 0, kind: "trigger" },
      { text: "Too sweet", layer: 1, kind: "barrier" },
      { text: "What I give my kids", layer: 2, kind: "barrier" },
      { text: "Lime and salt", layer: 3, kind: "trigger" }
    ],
    trigger: "What drives her",
    barrier: "What holds her back",
    caption: "A home fix is also an unmet need."
  }
};

export function situationDiagram(slug: string, lang: Lang): Diagram | null {
  switch (slug) {
    case "monitorear":
      return { kind: "report", copy: offer[lang].report.motion };
    case "anticipar":
      return { kind: "trend", copy: home[lang].hero.motion.trend };
    case "optimizar":
      return { kind: "journey", copy: journey[lang] };
    case "defender":
      return { kind: "why", copy: defendWhy[lang] };
    case "lanzar":
      return { kind: "launch", copy: home[lang].hero.motion.launch };
    case "entrar":
      return { kind: "enter", copy: home[lang].hero.motion.enter };
    case "innovar":
      return { kind: "understand", copy: innovate[lang] };
    case "planear":
      return { kind: "plan", copy: offer[lang].plan.motion };
    default:
      return null;
  }
}


/* ---------- diagrams for the three steps of each page ---------- */

const keywords: Record<Lang, KeywordsCopy> = {
  es: {
    query: "Aurora",
    mentions: [
      { text: "Aurora subió de precio otra vez", hit: true, platform: "X", topic: 0 },
      { text: "La de tapa azul ya no sabe igual", hit: false, platform: "TikTok", topic: 1 },
      { text: "En la tienda ya ni la encuentro", hit: false, platform: "Facebook", topic: 2 },
      { text: "Aurora patrocina el partido de hoy", hit: true, platform: "Instagram", topic: 3 },
      { text: "La botella nueva se rompe al abrirla", hit: false, platform: "Reviews", topic: 3 },
      { text: "Prefiero la de vidrio, la de plástico sabe raro", hit: false, platform: "Reddit", topic: 1 }
    ],
    found: "menciones leídas",
    missed: "No dice la palabra",
    them: "encuentra la búsqueda por palabra clave",
    us: "Toda la conversación, leída",
    topics: ["Precio", "Sabor", "Distribución", "Empaque"]
  },
  en: {
    query: "Aurora",
    mentions: [
      { text: "Aurora raised its price again", hit: true, platform: "X", topic: 0 },
      { text: "The blue-cap one doesn't taste the same", hit: false, platform: "TikTok", topic: 1 },
      { text: "I can't even find it at the store anymore", hit: false, platform: "Facebook", topic: 2 },
      { text: "Aurora sponsors today's game", hit: true, platform: "Instagram", topic: 3 },
      { text: "The new bottle breaks when you open it", hit: false, platform: "Reviews", topic: 3 },
      { text: "I prefer glass, the plastic one tastes weird", hit: false, platform: "Reddit", topic: 1 }
    ],
    found: "mentions read",
    missed: "Doesn't say the word",
    them: "found by the keyword search",
    us: "The whole conversation, read",
    topics: ["Price", "Taste", "Distribution", "Packaging"]
  }
};

const withApproach = (lang: Lang, over: Partial<ApproachCopy>): ApproachCopy => ({ ...home[lang].how.motion, ...over });

const approach: Record<string, Record<Lang, Partial<ApproachCopy>>> = {
  anticipar: {
    es: { clusters: ["Descansar sin culpa", "Compartir menos", "Hecho a mano", "Precio por porción", "Comprar usado"], answer: "Descansar sin culpa está pasando de emergente a acelerando", quote: "Este año aprendí a descansar sin sentir que estoy fallando", reasons: ["Agotamiento", "Culpa", "Presión del trabajo"], action: "Hablar del descanso como derecho, no como premio" },
    en: { clusters: ["Resting without guilt", "Sharing less", "Handmade", "Price per serving", "Buying used"], answer: "Resting without guilt is moving from emerging to accelerating", quote: "This year I learned to rest without feeling like I'm failing", reasons: ["Exhaustion", "Guilt", "Work pressure"], action: "Talk about rest as a right, not a reward" }
  },
  defender: {
    es: { clusters: ["Precio", "Promesa", "Servicio", "Cobertura", "Confianza"], answer: "Su promesa de entrega se siente más creíble que la tuya", quote: "Me cambié porque con ellos sí llega cuando dicen", reasons: ["Incertidumbre", "Tiempo perdido", "Lo que dicen mis amigos"], action: "Prometer menos y cumplir con fecha exacta" },
    en: { clusters: ["Price", "Promise", "Service", "Coverage", "Trust"], answer: "Their delivery promise feels more credible than yours", quote: "I switched because with them it actually arrives when they say", reasons: ["Uncertainty", "Wasted time", "What my friends say"], action: "Promise less and deliver on an exact date" }
  },
  lanzar: {
    es: { clusters: ["Antojo", "Sin azúcar", "Precio", "Sabor", "Dónde encontrarla"], answer: "Hay ganas, pero el precio decide la primera compra", quote: "Si cuesta igual que la normal, la pruebo sin pensarlo", reasons: ["Miedo a que no sepa bien", "Precio extra", "Difícil de encontrar"], action: "Lanzar al mismo precio que la versión normal" },
    en: { clusters: ["Craving", "No sugar", "Price", "Taste", "Where to find it"], answer: "People want it, but price decides the first purchase", quote: "If it costs the same as the regular one, I'll try it right away", reasons: ["Fear it won't taste good", "Extra price", "Hard to find"], action: "Launch at the same price as the regular version" }
  },
  entrar: {
    es: { clusters: ["Familia", "Creadores locales", "Tienda de barrio", "Marcas locales", "Precio"], answer: "La recomendación de la familia pesa más que la publicidad", quote: "Mi tía me lo recomendó y ya no cambio", reasons: ["Desconfianza de lo nuevo", "Marca extranjera", "No lo venden cerca"], action: "Empezar con muestras en tiendas de barrio" },
    en: { clusters: ["Family", "Local creators", "Corner store", "Local brands", "Price"], answer: "A family recommendation weighs more than advertising", quote: "My aunt recommended it and I never switched", reasons: ["Distrust of the new", "Foreign brand", "Not sold nearby"], action: "Start with samples at corner stores" }
  },
  innovar: {
    es: { clusters: ["Bajarle lo dulce", "Porciones chicas", "Para llevar", "Sin conservadores", "Recetas caseras"], answer: "La gente ya rebaja el dulzor por su cuenta", quote: "Le pongo limón y sal porque sola me sabe muy dulce", reasons: ["Muy dulce", "Lo que doy a mis hijos", "No hay versión ligera"], action: "Probar una versión menos dulce con sabor cítrico" },
    en: { clusters: ["Less sweet", "Smaller portions", "To go", "No preservatives", "Home recipes"], answer: "People already cut the sweetness on their own", quote: "I add lime and salt because on its own it's too sweet", reasons: ["Too sweet", "What I give my kids", "No light version"], action: "Test a less sweet version with a citrus taste" }
  }
};

const understandFor: Record<string, Record<Lang, UnderstandCopy>> = {
  anticipar: {
    es: { ...home.es.methods.motion, quote: "Este año aprendí a descansar sin sentir que estoy fallando", chips: [{ text: "Agotamiento", layer: 0, kind: "trigger" }, { text: "Culpa", layer: 1, kind: "barrier" }, { text: "Lo que dirán en el trabajo", layer: 2, kind: "barrier" }, { text: "Descansar es un derecho", layer: 3, kind: "trigger" }], caption: "Detrás de una señal hay razones que todavía no tienen nombre." },
    en: { ...home.en.methods.motion, quote: "This year I learned to rest without feeling like I'm failing", chips: [{ text: "Exhaustion", layer: 0, kind: "trigger" }, { text: "Guilt", layer: 1, kind: "barrier" }, { text: "What work will say", layer: 2, kind: "barrier" }, { text: "Rest is a right", layer: 3, kind: "trigger" }], caption: "Behind a signal there are reasons that don't have a name yet." }
  },
  optimizar: {
    es: { ...home.es.methods.motion, quote: "Pagué el envío exprés y llegó cuatro días después, y nadie me avisó", chips: [{ text: "Ansiedad por la espera", layer: 0, kind: "barrier" }, { text: "Dinero perdido", layer: 1, kind: "barrier" }, { text: "Pena de reclamar", layer: 2, kind: "barrier" }, { text: "Confianza en la marca", layer: 3, kind: "trigger" }], caption: "La fricción duele por lo que la persona siente, no solo por el retraso." },
    en: { ...home.en.methods.motion, quote: "I paid for express shipping, it came four days later and nobody told me", chips: [{ text: "Anxious waiting", layer: 0, kind: "barrier" }, { text: "Money lost", layer: 1, kind: "barrier" }, { text: "Embarrassed to complain", layer: 2, kind: "barrier" }, { text: "Trust in the brand", layer: 3, kind: "trigger" }], caption: "Friction hurts because of how people feel, not only because of the delay." }
  },
  defender: {
    es: { ...home.es.methods.motion, quote: "Me cambié porque con ellos sí llega cuando dicen, y mis amigos ya estaban ahí", chips: [{ text: "Certeza", layer: 0, kind: "trigger" }, { text: "Tiempo perdido", layer: 1, kind: "barrier" }, { text: "Mis amigos ya se cambiaron", layer: 2, kind: "trigger" }, { text: "Cumplir lo prometido", layer: 3, kind: "trigger" }], caption: "La gente no se va por una razón, se va por varias a la vez." },
    en: { ...home.en.methods.motion, quote: "I switched because with them it arrives when they say, and my friends were already there", chips: [{ text: "Certainty", layer: 0, kind: "trigger" }, { text: "Wasted time", layer: 1, kind: "barrier" }, { text: "My friends switched", layer: 2, kind: "trigger" }, { text: "Keeping promises", layer: 3, kind: "trigger" }], caption: "People don't leave for one reason, they leave for several at once." }
  }
};

const innovarTrend: Record<Lang, TrendCopy> = {
  es: { ...home.es.hero.motion.trend, signals: ["Bajarle lo dulce", "Porciones chicas", "Para llevar", "Sin conservadores", "Recetas caseras"], payoff: "Las necesidades que crecen rápido son las que conviene resolver primero." },
  en: { ...home.en.hero.motion.trend, signals: ["Less sweet", "Smaller portions", "To go", "No preservatives", "Home recipes"], payoff: "The needs that grow fastest are the ones worth solving first." }
};

/** Three diagrams per page, one for each step of "how we solve it". */
export function situationStepDiagrams(slug: string, lang: Lang): [Diagram, Diagram, Diagram] | null {
  const h = home[lang];
  const o = offer[lang];
  const ap = (key: string): Diagram => ({ kind: "approach", copy: withApproach(lang, approach[key]?.[lang] ?? {}) });
  switch (slug) {
    case "monitorear":
      return [{ kind: "keywords", copy: keywords[lang] }, { kind: "approach", copy: h.how.motion }, { kind: "track", copy: h.hero.motion.track }];
    case "anticipar":
      return [ap("anticipar"), { kind: "trendCurve", copy: h.hero.motion.trend }, { kind: "understand", copy: understandFor.anticipar![lang] }];
    case "optimizar":
      return [{ kind: "track", copy: h.hero.motion.track }, { kind: "understand", copy: understandFor.optimizar![lang] }, { kind: "approach", copy: h.how.motion }];
    case "defender":
      return [ap("defender"), { kind: "report", copy: o.report.motion }, { kind: "understand", copy: understandFor.defender![lang] }];
    case "lanzar":
      return [{ kind: "understand", copy: h.methods.motion }, ap("lanzar"), { kind: "study", copy: o.study.motion }];
    case "entrar":
      return [ap("entrar"), { kind: "launch", copy: h.hero.motion.launch }, { kind: "study", copy: o.study.motion }];
    case "innovar":
      return [ap("innovar"), { kind: "trend", copy: innovarTrend[lang] }, { kind: "study", copy: o.study.motion }];
    case "planear":
      return [{ kind: "report", copy: o.report.motion }, { kind: "track", copy: h.hero.motion.track }, { kind: "study", copy: o.study.motion }];
    default:
      return null;
  }
}
