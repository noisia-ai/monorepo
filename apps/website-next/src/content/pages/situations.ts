// What each situation page shows beyond its text: the animated diagram of how we solve it and
// what each team receives. Diagram examples are illustrative.
import type { HeroCopy } from "@/motion/HeroComposition";
import type { EnterCopy, LaunchCopy } from "@/motion/HeroSlides";
import type { PlanCopy, ReportCopy } from "@/motion/OfferCompositions";
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
  | { kind: "plan"; copy: PlanCopy };

export type TeamKey = "brand" | "creative" | "product" | "cx" | "leadership";
export type TeamOutput = { team: TeamKey; question: string; output: string; items: string[] };

type Lang = "es" | "en";

export const teamNames: Record<Lang, Record<TeamKey, string>> = {
  es: { brand: "Marca y marketing", creative: "Creativo y agencia", product: "Producto e innovación", cx: "Experiencia y servicio", leadership: "Dirección" },
  en: { brand: "Brand and marketing", creative: "Creative and agency", product: "Product and innovation", cx: "Experience and service", leadership: "Leadership" }
};

export const situationLabels: Record<Lang, { how: string; methods: string; teams: string; teamsLead: string; asks: string; gets: string; always: string; project: string; more: string; others: string; play: string; pause: string }> = {
  es: {
    how: "Cómo lo resolvemos",
    methods: "Con qué método",
    teams: "Lo que recibe cada equipo",
    teamsLead: "La misma investigación responde preguntas distintas según quién la lea.",
    asks: "Su pregunta",
    gets: "Lo que recibe",
    always: "Siempre activo",
    project: "Estudio puntual",
    more: "Ver cómo lo resolvemos",
    others: "Otras situaciones",
    play: "Reproducir",
    pause: "Pausar"
  },
  en: {
    how: "How we solve it",
    methods: "With which method",
    teams: "What each team receives",
    teamsLead: "The same research answers different questions depending on who reads it.",
    asks: "Their question",
    gets: "What they receive",
    always: "Always on",
    project: "One-off study",
    more: "See how we solve it",
    others: "Other situations",
    play: "Play",
    pause: "Pause"
  }
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


const T = (team: TeamKey, question: string, output: string, items: string[]): TeamOutput => ({ team, question, output, items });

export const situationTeams: Record<string, Record<Lang, TeamOutput[]>> = {
  monitorear: {
    es: [
      T("brand", "¿Qué cambió este mes y qué le digo a dirección?", "Reporte mensual presentado en vivo", ["Lo que se movió, con su razón", "Qué vigilar el próximo mes", "Citas listas para la presentación"]),
      T("leadership", "¿Cómo vamos contra la competencia?", "Una página de posición", ["Parte de la conversación contra cada competidor", "Dónde ganamos y dónde perdemos", "Los riesgos del mes"]),
      T("cx", "¿Qué reclamos están creciendo?", "Temas de queja con su tendencia", ["Cada queja con su volumen y su cambio", "Citas para el equipo de servicio", "Lo nuevo de este mes"])
    ],
    en: [
      T("brand", "What changed this month and what do I tell leadership?", "Monthly report presented live", ["What moved, with its reason", "What to watch next month", "Quotes ready for the presentation"]),
      T("leadership", "How are we doing against the competition?", "A one-page position", ["Share of the conversation against each competitor", "Where we win and where we lose", "The risks of the month"]),
      T("cx", "Which complaints are growing?", "Complaint topics with their trend", ["Each complaint with its volume and change", "Quotes for the service team", "What is new this month"])
    ]
  },
  anticipar: {
    es: [
      T("brand", "¿Qué territorio tomamos antes que la competencia?", "Radar de señales", ["Cada señal con su etapa y su velocidad", "Las que ya tienen permiso para tu marca", "Las que conviene solo vigilar"]),
      T("creative", "¿De qué hablamos en la próxima campaña?", "El lenguaje que está naciendo", ["Frases reales de cada señal", "Códigos y referentes nuevos", "Lo que ya suena gastado"]),
      T("product", "¿Qué necesidad está creciendo?", "Señales con potencial de producto", ["Necesidades que nadie resuelve bien", "En qué comunidades aparecen", "Cuánto crecieron en el último trimestre"])
    ],
    en: [
      T("brand", "Which territory do we take before the competition?", "Signal radar", ["Each signal with its stage and speed", "The ones your brand already has permission for", "The ones worth only watching"]),
      T("creative", "What do we talk about in the next campaign?", "The language being born", ["Real phrases for each signal", "New codes and references", "What already sounds worn out"]),
      T("product", "Which need is growing?", "Signals with product potential", ["Needs nobody solves well", "Which communities they appear in", "How much they grew last quarter"])
    ]
  },
  optimizar: {
    es: [
      T("cx", "¿Dónde se frustra el cliente este mes?", "Mapa del recorrido", ["Cada momento con su nivel de frustración", "Qué cambió contra el mes anterior", "Citas de cada fricción"]),
      T("product", "¿Qué arreglamos primero?", "Fricciones priorizadas", ["Ordenadas por intensidad y frecuencia", "Lo que cuesta poco arreglar", "Lo que pide un cambio de fondo"]),
      T("leadership", "¿La experiencia mejora o empeora?", "Seguimiento mensual", ["La tendencia del recorrido completo", "Junto con tu NPS o tus encuestas, si los hay", "Dónde coinciden y dónde no"])
    ],
    en: [
      T("cx", "Where does the customer get frustrated this month?", "Journey map", ["Each moment with its level of frustration", "What changed against last month", "Quotes for each friction"]),
      T("product", "What do we fix first?", "Prioritized frictions", ["Ranked by intensity and frequency", "What is cheap to fix", "What needs a deeper change"]),
      T("leadership", "Is the experience getting better or worse?", "Monthly follow-up", ["The trend of the whole journey", "Alongside your NPS or surveys, if you have them", "Where they agree and where they don't"])
    ]
  },
  defender: {
    es: [
      T("brand", "¿Por qué se van con la competencia?", "Razones de cambio", ["Lo que empuja a la gente a irse", "Lo que la atrae del otro lado", "Qué tan seguido pasa"]),
      T("creative", "¿Cómo respondemos sin copiar?", "Territorio para responder", ["Promesas del competidor que sí se creen", "Lo que tu marca puede decir con credibilidad", "Frases de la gente para el brief"]),
      T("leadership", "¿Dónde somos vulnerables?", "Mapa de vulnerabilidades", ["Cada riesgo con su evidencia", "Lo que se puede reparar rápido", "Lo que pide una decisión de fondo"])
    ],
    en: [
      T("brand", "Why are they leaving for the competition?", "Reasons for switching", ["What pushes people to leave", "What pulls them to the other side", "How often it happens"]),
      T("creative", "How do we respond without copying?", "Territory to respond", ["Rival promises people do believe", "What your brand can say credibly", "People's phrases for the brief"]),
      T("leadership", "Where are we exposed?", "Map of vulnerabilities", ["Each risk with its evidence", "What can be fixed fast", "What needs a deeper decision"])
    ]
  },
  lanzar: {
    es: [
      T("brand", "¿La gente de verdad quiere esto?", "Lo que acerca y lo que frena", ["Motivos para comprar, por capa", "Barreras que hay que resolver", "Qué territorio tiene permiso"]),
      T("creative", "¿Cómo le hablamos?", "Insumos para el brief", ["Frases reales de la gente", "Códigos que conviene usar y evitar", "El tono que ya tiene permiso"]),
      T("product", "¿Qué ajustamos antes de lanzar?", "Barreras de producto", ["Precio, formato y disponibilidad", "Lo que la gente espera encontrar", "Riesgos de la primera compra"])
    ],
    en: [
      T("brand", "Do people actually want this?", "What draws them and what holds them back", ["Reasons to buy, by layer", "Barriers to solve", "Which territory has permission"]),
      T("creative", "How do we talk to them?", "Inputs for the brief", ["People's real phrases", "Codes to use and to avoid", "The tone that already has permission"]),
      T("product", "What do we adjust before launch?", "Product barriers", ["Price, format and availability", "What people expect to find", "Risks of the first purchase"])
    ]
  },
  entrar: {
    es: [
      T("leadership", "¿Vale la pena entrar y cómo?", "Las reglas no escritas", ["Cómo compra la gente ahí", "Qué conviene evitar al llegar", "Riesgos que no se ven desde fuera"]),
      T("brand", "¿Quién da credibilidad en ese mercado?", "Mapa de influencia", ["Voces que la gente escucha", "Marcas que ya ocupan el lugar", "Dónde hay espacio"]),
      T("creative", "¿Cómo hablamos ahí sin sonar extranjeros?", "Códigos culturales", ["Expresiones y referentes locales", "Lo que suena falso", "Ejemplos de lo que sí funciona"])
    ],
    en: [
      T("leadership", "Is it worth entering, and how?", "The unwritten rules", ["How people buy there", "What to avoid on arrival", "Risks you can't see from outside"]),
      T("brand", "Who lends credibility in that market?", "Influence map", ["Voices people listen to", "Brands already holding the place", "Where there is room"]),
      T("creative", "How do we talk there without sounding foreign?", "Cultural codes", ["Local expressions and references", "What sounds fake", "Examples of what works"])
    ]
  },
  innovar: {
    es: [
      T("product", "¿Qué necesidad sigue sin resolverse?", "Necesidades con evidencia", ["Arreglos caseros que la gente ya inventó", "Qué tan seguido aparecen", "Qué ofrece hoy la categoría"]),
      T("brand", "¿Dónde puede crecer la marca?", "Espacios de oportunidad", ["Necesidades cercanas a tu marca", "Las que nadie ocupa", "Lo que pediría entrar ahí"]),
      T("leadership", "¿En qué conviene invertir?", "Oportunidades priorizadas", ["Por tamaño y crecimiento", "Por distancia a lo que ya sabes hacer", "Los riesgos de cada una"])
    ],
    en: [
      T("product", "Which need is still unmet?", "Needs with evidence", ["Home fixes people already invented", "How often they appear", "What the category offers today"]),
      T("brand", "Where can the brand grow?", "Opportunity spaces", ["Needs close to your brand", "The ones nobody holds", "What it would take to enter"]),
      T("leadership", "Where should we invest?", "Prioritized opportunities", ["By size and growth", "By distance from what you already do", "The risks of each"])
    ]
  },
  planear: {
    es: [
      T("leadership", "¿Qué decisiones vienen este año?", "Calendario de estudios", ["Cada estudio en su momento", "La pregunta que responderá", "Quién la va a usar"]),
      T("brand", "¿Qué pasa con mi marca entre decisiones?", "Reporte mensual todo el año", ["Lo que se movió cada mes", "Lo que alimenta al siguiente estudio", "Alertas cuando algo cambia"]),
      T("creative", "¿Qué brief viene y con qué insumos?", "Insumos antes de cada campaña", ["Lenguaje y códigos de la temporada", "Lo que funcionó el año pasado", "Lo que ya suena gastado"])
    ],
    en: [
      T("leadership", "Which decisions are coming this year?", "Study calendar", ["Each study at its moment", "The question it will answer", "Who will use it"]),
      T("brand", "What happens with my brand between decisions?", "Monthly report all year", ["What moved each month", "What feeds the next study", "Alerts when something changes"]),
      T("creative", "Which brief is coming and with what inputs?", "Inputs before each campaign", ["Language and codes of the season", "What worked last year", "What already sounds worn out"])
    ]
  }
};
