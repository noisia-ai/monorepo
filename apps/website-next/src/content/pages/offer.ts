// Solutions page. Rebuilt 18 oct 2026 after the founder's review: each product (ongoing report,
// study, annual plan) is a name, a promise, two sentences and one animation of its own; what the
// report follows moved to the FAQ; formats became a gallery with a mockup per format. Topics,
// quotes and numbers inside animations are illustrative.
// `labels` is also read by the situation pages (/soluciones/[slug]); keep its keys.
import type { Block } from "./types";
import type { FaqIcon } from "@/components/ui/faq-icons";
import type { OfferPlanCopy, OfferReportCopy, OfferStudyCopy } from "@/motion/OfferProducts";
import type { PlanCopy, ReportCopy, StudyCopy } from "@/motion/OfferCompositions";
import type { DashboardFormatCopy, DocumentFormatCopy, LiveFormatCopy } from "@/motion/OfferFormats";

export type FormatKey = "stories" | "live" | "document" | "dashboard";
export type FormatMock = { live: LiveFormatCopy; document: DocumentFormatCopy; dashboard: DashboardFormatCopy };

/** `animation` feeds this page; `motion` is the square composition the situation pages reuse. */
type Product<A, M> = { name: string; promise: string; text: string; animation: A; motion: M };

export type OfferCopy = {
  title: string;
  lead: string;
  jump: { report: string; study: string; plan: string };
  report: Product<OfferReportCopy, ReportCopy>;
  study: Product<OfferStudyCopy, StudyCopy>;
  plan: Product<OfferPlanCopy, PlanCopy>;
  formats: {
    title: string;
    lead: string;
    items: { key: FormatKey; name: string; text: string }[];
    mock: FormatMock;
    reply: string;
  };
  situations: { title: string; lead: string };
  start: Extract<Block, { type: "steps" }>;
  faq: { title: string; items: { q: string; a: string; icon: FaqIcon }[] };
  cta: Extract<Block, { type: "cta" }>;
  labels: { more: string; play: string; pause: string; report: string; study: string; plan: string };
};

export const offer: Record<"es" | "en", OfferCopy> = {
  es: {
    title: "Respuestas para cada momento de tu marca",
    lead: "Trabajamos de dos maneras. Un reporte continuo que te dice qué cambió y por qué, y un estudio que responde una decisión concreta. El plan anual junta las dos.",
    jump: { report: "Reporte continuo", study: "Estudio", plan: "Plan anual" },
    report: {
      name: "Reporte continuo",
      promise: "Qué cambió y por qué, al ritmo de tu equipo.",
      text: "Seguimos lo que la gente dice de tu marca, tus competidores y tu categoría. Cada semana, quincena o mes te contamos qué se movió, por qué y qué conviene hacer.",
      animation: {
        cadences: ["Semanal", "Quincenal", "Mensual"],
        cadence: 1,
        dates: ["1 sep", "15 sep", "1 oct", "15 oct"],
        sinceLabel: "Desde el último reporte",
        whyLabel: "Por qué",
        doLabel: "Qué conviene hacer",
        dirLabels: { up: "Sube", down: "Baja", new: "Tema nuevo" },
        editions: [
          { dir: "up", topic: "Empaque reciclable", quote: "Por fin una que no me da culpa tirar", source: "TikTok", action: "Ponerlo al frente en el anaquel y en redes" },
          { dir: "down", topic: "Entrega a domicilio", quote: "Tres días esperando y nadie me contesta", source: "X", action: "Revisar los tiempos de entrega antes de la próxima campaña" },
          { dir: "new", topic: "Precio por mililitro", quote: "Hice cuentas y la grande sale más cara", source: "Reddit", action: "Revisar el precio del tamaño grande" }
        ]
      },
      motion: {
        months: ["Jul", "Ago", "Sep"],
        brands: ["Tu marca", "Competidor A", "Competidor B"],
        shareLabel: "Parte de la conversación",
        changeTitle: "Lo que cambió en septiembre",
        changes: [
          { dir: "up", text: "Tu marca ganó terreno con el nuevo empaque" },
          { dir: "down", text: "Competidor A perdió confianza por el servicio" },
          { dir: "new", text: "Aparece un tema nuevo, el precio por mililitro" }
        ]
      }
    },
    study: {
      name: "Estudio",
      promise: "Una decisión, respondida a fondo.",
      text: "Convertimos tu decisión en una pregunta, elegimos el método y leemos todo lo que la toca. Recibes la respuesta con recomendaciones, presentada en vivo.",
      animation: {
        decisionLabel: "Tu decisión",
        decision: "¿Lanzamos la versión sin azúcar?",
        questionLabel: "La pregunta",
        question: "¿Qué acerca y qué frena a quien ya compra la normal?",
        method: "Triggers & Barriers",
        noise: "Sin prensa, anuncios ni spam",
        draws: { label: "Lo que acerca", groups: ["Mismo sabor", "Menos culpa"] },
        holds: { label: "Lo que frena", groups: ["El precio", "Sabe a dieta"] },
        quote: { text: "Se me antoja, pero está carísima", source: "Instagram" },
        answerLabel: "La respuesta",
        answer: "Hay ganas, y el precio es la barrera principal.",
        recommendation: "Lanzar al mismo precio que la normal"
      },
      motion: {
        steps: [
          { label: "Tu decisión", text: "¿Lanzamos la versión sin azúcar?" },
          { label: "La pregunta que se puede responder", text: "¿Qué acerca y qué frena a quien ya compra la versión normal?" },
          { label: "El método", text: "" },
          { label: "La respuesta", text: "Hay ganas, y el precio es la barrera principal" }
        ],
        method: "Triggers & Barriers",
        recommendations: ["Lanzar al mismo precio que la normal", "Hablar de sabor antes que de salud", "Empezar en tiendas de conveniencia"]
      }
    },
    plan: {
      name: "Plan anual",
      promise: "La respuesta lista antes de cada decisión.",
      text: "El reporte corre todo el año y cada estudio llega antes del momento que importa. Así cada estudio parte de lo que el reporte ya vio.",
      animation: {
        months: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
        reportLabel: "Reporte continuo",
        studyLabel: "Estudio",
        decisionLabel: "Decisión",
        ready: "Listo antes",
        moments: [
          { month: 2, label: "Lanzamiento" },
          { month: 4, label: "Hot Sale" },
          { month: 7, label: "Regreso a clases" },
          { month: 10, label: "Buen Fin" }
        ]
      },
      motion: {
        months: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
        reportLabel: "Reporte continuo todo el año",
        studies: [
          { month: 2, label: "Lanzamiento" },
          { month: 4, label: "Hot Sale" },
          { month: 7, label: "Regreso a clases" },
          { month: 10, label: "Buen Fin" }
        ],
        caption: "El reporte corre todo el año y cada estudio llega antes de decidir."
      }
    },
    formats: {
      title: "El mismo hallazgo, en el formato que tu equipo usa",
      lead: "Elige cómo te llega, o combina varios.",
      reply: "Enviar a tu equipo",
      items: [
        { key: "stories", name: "Historias animadas", text: "Hallazgos cortos como los de nuestro feed, para mandar al equipo o presentar en un minuto." },
        { key: "live", name: "Presentación en vivo", text: "Te lo presentamos, respondemos preguntas y dejamos la evidencia abierta para revisarla después." },
        { key: "document", name: "Documento con la evidencia", text: "Cada hallazgo con su cifra, sus citas literales y el método detrás, listo para circular." },
        { key: "dashboard", name: "Dashboard en línea", text: "Los temas en un mapa, con filtros por tema, fuente y periodo, y cada cifra ligada a lo que la gente dijo." }
      ],
      mock: {
        live: {
          badge: "En vivo",
          meeting: "Reporte de septiembre",
          slide: "Lo que cambió en septiembre",
          bars: ["Precio", "Servicio", "Empaque"],
          people: ["Noisia", "Marketing", "Insights"],
          questionsLabel: "Preguntas",
          question: "¿Pasa igual en todas las regiones?",
          answer: "Pesa más en el norte. Te dejamos las citas en el documento."
        },
        document: {
          kicker: "Estudio · Triggers & Barriers",
          title: "Lo que acerca y lo que frena a la versión sin azúcar",
          drawsLabel: "Lo que acerca",
          holdsLabel: "Lo que frena",
          draws: ["Mismo sabor", "Menos culpa"],
          holds: ["El precio", "Sabe a dieta"],
          quote: "Se me antoja, pero está carísima",
          source: "Instagram",
          date: "12 sep 2026",
          footnote: "Citas literales, cada una con su fuente",
          evidenceLabel: "La mención original",
          evidence: "Se me antoja muchísimo, pero está carísima para lo que trae. Si la bajan, la compro diario.",
          open: "Ver en contexto",
          recsLabel: "Qué conviene hacer",
          recs: ["Lanzar al mismo precio que la normal", "Hablar de sabor antes que de salud"]
        },
        dashboard: {
          filters: [
            ["Tema", "Todos"],
            ["Fuente", "Todas"],
            ["Periodo", "Sep 2026"]
          ],
          title: "Mapa de temas",
          xLabel: "Volumen",
          yLabel: "Crecimiento",
          quadrants: ["Emergente", "Acelerando", "Masivo", "De nicho"],
          bubbles: [
            { name: "Precio", x: 0.76, y: 0.7, size: 1, tone: "teal" },
            { name: "Empaque reciclable", x: 0.3, y: 0.74, size: 0.45, tone: "teal" },
            { name: "Servicio", x: 0.62, y: 0.2, size: 0.75, tone: "coral" },
            { name: "Sabor", x: 0.86, y: 0.38, size: 0.85, tone: "grey" },
            { name: "Entrega", x: 0.42, y: 0.44, size: 0.55, tone: "grey" },
            { name: "Recetas", x: 0.12, y: 0.48, size: 0.35, tone: "teal" }
          ],
          listTitle: "Temas que suben",
          items: [
            ["Empaque reciclable", "Emergente"],
            ["Precio por mililitro", "Acelerando"],
            ["Recetas con el producto", "Emergente"],
            ["Precio", "Masivo"]
          ],
          tooltip: { topic: "Empaque reciclable", stage: "Emergente", quote: "Ojalá todas trajeran este empaque", source: "TikTok" }
        }
      }
    },
    situations: { title: "Empieza por tu situación", lead: "Cada momento trae su propia pregunta. Abre el tuyo para ver qué miramos y qué recibes." },
    start: {
      type: "steps",
      title: "Cómo se empieza",
      items: [
        { name: "Taller", text: "30 a 60 minutos, sin costo. Entendemos tu contexto y la decisión que viene, y vemos qué puede responder la conversación." },
        { name: "Alcance", text: "Te proponemos fuentes, método, entregables, fechas y costo por escrito. También sin costo. Tú decides si arrancamos." },
        { name: "Primera entrega", text: "Presentamos en vivo, respondemos tus preguntas y dejamos la evidencia abierta para que la revises." }
      ]
    },
    faq: {
      title: "Preguntas frecuentes",
      items: [
        { icon: "brand", q: "¿Qué siguen de mi marca?", a: "Cómo hablan de ella, qué elogian y qué reclaman, comparado contra el periodo anterior." },
        { icon: "competitors", q: "¿Y de mis competidores?", a: "Cuánto ocupan de la conversación y en qué te ganan." },
        { icon: "category", q: "¿Siguen mi categoría aunque nadie nombre una marca?", a: "Sí. Seguimos los temas que suben o bajan en tu categoría aunque nadie nombre una marca." },
        { icon: "campaigns", q: "¿Ven cómo se reciben las campañas y los lanzamientos?", a: "Sí. Vemos cómo se recibe lo que lanzas tú y lo que lanza el resto." },
        { icon: "topics", q: "¿Puedo pedir que sigan temas específicos?", a: "Sí. Precio, servicio, sustentabilidad o lo que defina tu negocio." },
        { icon: "signals", q: "¿Detectan temas antes de que se vuelvan masivos?", a: "Sí. Seguimos los temas chicos que crecen rápido, antes de que se vuelvan masivos." },
        { icon: "calendar", q: "¿Cada cuánto llega el reporte?", a: "Cada semana, cada quincena o cada mes, según lo que necesite tu equipo. Siempre comparado contra el periodo anterior." },
        { icon: "question", q: "¿Cuál me conviene, un reporte o un estudio?", a: "Si quieres saber qué pasa con tu marca y qué cambió, un reporte continuo. Si tienes una decisión concreta por delante, un estudio. Muchos equipos empiezan con un estudio y luego mantienen un reporte." },
        { icon: "document", q: "¿Cuánto cuesta?", a: "Depende de la pregunta, las fuentes, los mercados, el periodo y la profundidad. Por eso no publicamos una lista de precios. Después del taller recibes un alcance por escrito con el costo, sin compromiso." },
        { icon: "edit", q: "¿Puedo empezar sin brief?", a: "Sí. El taller existe para eso. Con tu situación y la decisión que viene, armamos juntos la pregunta." },
        { icon: "people", q: "¿Trabajan con agencias?", a: "Sí. Muchas veces el estudio alimenta el planning de una agencia o se presenta junto con ella a su cliente." }
      ]
    },
    cta: {
      type: "cta",
      title: "Trae tu pregunta",
      text: "Un taller gratis de 30 a 60 minutos para entender tu decisión y proponerte un alcance.",
      label: "Agenda un taller gratis",
      href: "/taller"
    },
    labels: { more: "Ver cómo lo resolvemos", play: "Reproducir", pause: "Pausar", report: "Reporte continuo", study: "Estudio", plan: "Plan anual" }
  },
  en: {
    title: "Answers for every moment of your brand",
    lead: "We work in two ways. An ongoing report that tells you what changed and why, and a study that answers one specific decision. The annual plan brings both together.",
    jump: { report: "Ongoing report", study: "Study", plan: "Annual plan" },
    report: {
      name: "Ongoing report",
      promise: "What changed and why, at your team's pace.",
      text: "We follow what people say about your brand, your competitors and your category. Every week, every two weeks or every month we tell you what moved, why, and what to do about it.",
      animation: {
        cadences: ["Weekly", "Every two weeks", "Monthly"],
        cadence: 1,
        dates: ["Sep 1", "Sep 15", "Oct 1", "Oct 15"],
        sinceLabel: "Since the last report",
        whyLabel: "Why",
        doLabel: "What to do",
        dirLabels: { up: "Up", down: "Down", new: "New topic" },
        editions: [
          { dir: "up", topic: "Recyclable packaging", quote: "Finally one I don't feel guilty throwing away", source: "TikTok", action: "Put it up front, on shelf and on social" },
          { dir: "down", topic: "Home delivery", quote: "Three days waiting and nobody answers", source: "X", action: "Check delivery times before the next campaign" },
          { dir: "new", topic: "Price per milliliter", quote: "I did the math and the big one costs more", source: "Reddit", action: "Review the price of the large size" }
        ]
      },
      motion: {
        months: ["Jul", "Aug", "Sep"],
        brands: ["Your brand", "Competitor A", "Competitor B"],
        shareLabel: "Share of the conversation",
        changeTitle: "What changed in September",
        changes: [
          { dir: "up", text: "Your brand gained ground with the new packaging" },
          { dir: "down", text: "Competitor A lost trust over service" },
          { dir: "new", text: "A new topic appears, price per milliliter" }
        ]
      }
    },
    study: {
      name: "Study",
      promise: "One decision, answered in depth.",
      text: "We turn your decision into a question, choose the method and read everything that touches it. You get the answer with recommendations, presented live.",
      animation: {
        decisionLabel: "Your decision",
        decision: "Do we launch the sugar-free version?",
        questionLabel: "The question",
        question: "What draws and what holds back people who buy the regular one?",
        method: "Triggers & Barriers",
        noise: "No press, ads or spam",
        draws: { label: "Draws them", groups: ["Same taste", "Less guilt"] },
        holds: { label: "Holds them back", groups: ["The price", "Tastes like diet"] },
        quote: { text: "I want it, but it costs way too much", source: "Instagram" },
        answerLabel: "The answer",
        answer: "People want it, and price is the main barrier.",
        recommendation: "Launch at the same price as the regular one"
      },
      motion: {
        steps: [
          { label: "Your decision", text: "Do we launch the sugar-free version?" },
          { label: "The question that can be answered", text: "What draws and what holds back people who buy the regular one?" },
          { label: "The method", text: "" },
          { label: "The answer", text: "People want it, and price is the main barrier" }
        ],
        method: "Triggers & Barriers",
        recommendations: ["Launch at the same price as the regular one", "Talk about taste before health", "Start in convenience stores"]
      }
    },
    plan: {
      name: "Annual plan",
      promise: "The answer ready before each decision.",
      text: "The report runs all year and each study lands before the moment that matters. So every study starts from what the report already saw.",
      animation: {
        months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        reportLabel: "Ongoing report",
        studyLabel: "Study",
        decisionLabel: "Decision",
        ready: "Ready ahead",
        moments: [
          { month: 2, label: "Launch" },
          { month: 4, label: "Hot Sale" },
          { month: 7, label: "Back to school" },
          { month: 10, label: "Buen Fin" }
        ]
      },
      motion: {
        months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        reportLabel: "Ongoing report all year",
        studies: [
          { month: 2, label: "Launch" },
          { month: 4, label: "Hot Sale" },
          { month: 7, label: "Back to school" },
          { month: 10, label: "Buen Fin" }
        ],
        caption: "The report runs all year, and each study lands before the decision."
      }
    },
    formats: {
      title: "The same finding, in the format your team uses",
      lead: "Pick how it reaches you, or mix a few.",
      reply: "Send to your team",
      items: [
        { key: "stories", name: "Animated stories", text: "Short findings like the ones in our feed, to send to the team or present in a minute." },
        { key: "live", name: "Live presentation", text: "We present it, answer questions and leave the evidence open to review later." },
        { key: "document", name: "Document with the evidence", text: "Every finding with its number, its verbatim quotes and the method behind it, ready to share." },
        { key: "dashboard", name: "Online dashboard", text: "Topics on a map, with filters by topic, source and period, and every number tied to what people said." }
      ],
      mock: {
        live: {
          badge: "Live",
          meeting: "September report",
          slide: "What changed in September",
          bars: ["Price", "Service", "Packaging"],
          people: ["Noisia", "Marketing", "Insights"],
          questionsLabel: "Questions",
          question: "Is it the same in every region?",
          answer: "It weighs more in the north. The quotes are in the document."
        },
        document: {
          kicker: "Study · Triggers & Barriers",
          title: "What draws people to the sugar-free version and what holds them back",
          drawsLabel: "Draws them",
          holdsLabel: "Holds them back",
          draws: ["Same taste", "Less guilt"],
          holds: ["The price", "Tastes like diet"],
          quote: "I want it, but it costs way too much",
          source: "Instagram",
          date: "Sep 12, 2026",
          footnote: "Verbatim quotes, each with its source",
          evidenceLabel: "The original mention",
          evidence: "I really want it, but it costs way too much for what it is. If they drop the price I'd buy it every day.",
          open: "See in context",
          recsLabel: "What to do",
          recs: ["Launch at the same price as the regular one", "Talk about taste before health"]
        },
        dashboard: {
          filters: [
            ["Topic", "All"],
            ["Source", "All"],
            ["Period", "Sep 2026"]
          ],
          title: "Topic map",
          xLabel: "Volume",
          yLabel: "Growth",
          quadrants: ["Emerging", "Accelerating", "Mainstream", "Niche"],
          bubbles: [
            { name: "Price", x: 0.76, y: 0.7, size: 1, tone: "teal" },
            { name: "Recyclable pack", x: 0.3, y: 0.74, size: 0.45, tone: "teal" },
            { name: "Service", x: 0.62, y: 0.2, size: 0.75, tone: "coral" },
            { name: "Taste", x: 0.86, y: 0.38, size: 0.85, tone: "grey" },
            { name: "Delivery", x: 0.42, y: 0.44, size: 0.55, tone: "grey" },
            { name: "Recipes", x: 0.12, y: 0.48, size: 0.35, tone: "teal" }
          ],
          listTitle: "Topics on the rise",
          items: [
            ["Recyclable packaging", "Emerging"],
            ["Price per milliliter", "Accelerating"],
            ["Recipes with the product", "Emerging"],
            ["Price", "Mainstream"]
          ],
          tooltip: { topic: "Recyclable pack", stage: "Emerging", quote: "Wish they all came in this packaging", source: "TikTok" }
        }
      }
    },
    situations: { title: "Start from your situation", lead: "Every moment brings its own question. Open yours to see what we look at and what you get." },
    start: {
      type: "steps",
      title: "How to start",
      items: [
        { name: "Workshop", text: "30 to 60 minutes, free. We understand your context and the decision ahead, and look at what the conversation can answer." },
        { name: "Scope", text: "We propose sources, method, deliverables, dates and cost in writing. Also free. You decide whether we start." },
        { name: "First delivery", text: "We present live, answer your questions and leave the evidence open for you to review." }
      ]
    },
    faq: {
      title: "Frequently asked questions",
      items: [
        { icon: "brand", q: "What do you follow about my brand?", a: "How people talk about it, what they praise and what they complain about, compared with the previous period." },
        { icon: "competitors", q: "And about my competitors?", a: "How much of the conversation they hold and where they beat you." },
        { icon: "category", q: "Do you follow my category even when nobody names a brand?", a: "Yes. We follow the topics that rise or fall in your category even when nobody names a brand." },
        { icon: "campaigns", q: "Do you see how campaigns and launches land?", a: "Yes. We see how people receive what you launch and what everyone else launches." },
        { icon: "topics", q: "Can I ask you to follow specific topics?", a: "Yes. Price, service, sustainability or whatever defines your business." },
        { icon: "signals", q: "Do you spot topics before they go mainstream?", a: "Yes. We follow small topics that grow fast, before they go mainstream." },
        { icon: "calendar", q: "How often does the report arrive?", a: "Every week, every two weeks or every month, depending on what your team needs. Always compared with the previous period." },
        { icon: "question", q: "Which one do I need, a report or a study?", a: "If you want to know what is happening with your brand and what changed, an ongoing report. If you have a specific decision ahead, a study. Many teams start with a study and then keep a report running." },
        { icon: "document", q: "How much does it cost?", a: "It depends on the question, the sources, the markets, the period and the depth. That is why we don't publish a price list. After the workshop you receive a written scope with the cost, with no commitment." },
        { icon: "edit", q: "Can I start without a brief?", a: "Yes. That is what the workshop is for. From your situation and the decision ahead, we build the question together." },
        { icon: "people", q: "Do you work with agencies?", a: "Yes. The study often feeds an agency's planning or is presented alongside the agency to its client." }
      ]
    },
    cta: {
      type: "cta",
      title: "Bring your question",
      text: "A free 30 to 60 minute workshop to understand your decision and propose a scope.",
      label: "Book a free workshop",
      href: "/en/workshop"
    },
    labels: { more: "See how we solve it", play: "Play", pause: "Pause", report: "Ongoing report", study: "Study", plan: "Annual plan" }
  }
};
