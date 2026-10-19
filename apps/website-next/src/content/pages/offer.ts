// Solutions page, rewritten 18 oct 2026 after the UAT review: it explains what we deliver
// (report, study, annual plan), what we monitor, and keeps the format (live, document, motion
// stories) apart from the product. Animation numbers are illustrative.
import type { PlanCopy, ReportCopy, StudyCopy } from "@/motion/OfferCompositions";

type Icon = "brand" | "competitors" | "category" | "campaigns" | "topics" | "signals";
export type FormatKey = "live" | "document" | "dashboard" | "stories";
export type FormatMock = {
  live: { badge: string; slide: string; bars: [string, string, string] };
  document: { title: string; trigger: string; barrier: string; quotes: [string, string] };
  dashboard: {
    title: string;
    xLabel: string;
    yLabel: string;
    bubbles: { name: string; x: number; y: number; size: number; tone: "teal" | "coral" | "grey" }[];
    listTitle: string;
    items: [string, string][];
  };
};

export type OfferCopy = {
  title: string;
  lead: string;
  jump: { report: string; study: string; plan: string };
  report: {
    name: string;
    title: string;
    text: string;
    watchTitle: string;
    watch: { icon: Icon; name: string; text: string }[];
    alwaysTitle: string;
    motion: ReportCopy;
  };
  study: {
    name: string;
    title: string;
    text: string;
    situationsTitle: string;
    motion: StudyCopy;
  };
  plan: { name: string; title: string; text: string; motion: PlanCopy };
  formats: {
    title: string;
    lead: string;
    items: { key: FormatKey; name: string; text: string }[];
    mock: FormatMock;
  };
  situations: { title: string; lead: string };
  labels: { more: string; play: string; pause: string; report: string; study: string; plan: string };
};

export const offer: Record<"es" | "en", OfferCopy> = {
  es: {
    title: "Respuestas para cada momento de tu marca",
    lead: "Trabajamos de dos maneras. Un reporte que cada mes te dice qué cambió y por qué, y un estudio que responde una decisión concreta. El plan anual junta las dos.",
    jump: { report: "Reporte continuo", study: "Estudio", plan: "Plan anual" },
    report: {
      name: "Reporte continuo",
      title: "Qué cambió este mes y por qué",
      text: "Seguimos lo que la gente dice de tu marca, de tus competidores y de tu categoría. Cada mes recibes lo que se movió, la razón detrás y qué conviene vigilar, comparado contra el mes anterior.",
      watchTitle: "Qué seguimos",
      watch: [
        { icon: "brand", name: "Tu marca", text: "Cómo hablan de ella, qué elogian y qué reclaman." },
        { icon: "competitors", name: "Tus competidores", text: "Cuánto ocupan de la conversación y en qué te ganan." },
        { icon: "category", name: "Tu categoría", text: "Los temas que suben o bajan aunque nadie nombre una marca." },
        { icon: "campaigns", name: "Campañas y lanzamientos", text: "Cómo se recibe lo que lanzas tú y lo que lanza el resto." },
        { icon: "topics", name: "Los temas que te importan", text: "Precio, servicio, sustentabilidad o lo que defina tu negocio." },
        { icon: "signals", name: "Señales que empiezan", text: "Temas chicos que crecen rápido, antes de que se vuelvan masivos." }
      ],
      alwaysTitle: "Para el día a día",
      motion: {
        months: ["Jul", "Ago", "Sep"],
        brands: ["Tu marca", "Competidor A", "Competidor B"],
        shareLabel: "Parte de la conversación",
        changeTitle: "Lo que cambió en septiembre",
        changes: [
          { dir: "up", text: "Tu marca ganó terreno con el nuevo empaque" },
          { dir: "down", text: "Competidor A perdió confianza por el servicio" },
          { dir: "new", text: "Aparece un tema nuevo: precio por mililitro" }
        ]
      }
    },
    study: {
      name: "Estudio",
      title: "Una pregunta, respondida",
      text: "Empieza por una decisión que tienes enfrente. La convertimos en una pregunta que la conversación sí puede responder, elegimos el método y leemos todo lo que la toca. Recibes la respuesta con recomendaciones, presentada en vivo.",
      situationsTitle: "Para decisiones como estas",
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
      title: "La respuesta lista antes de cada decisión",
      text: "El reporte corre todo el año y los estudios se colocan en los momentos que importan: lanzamientos, campañas y temporadas. Cada decisión llega con su respuesta, y cada estudio parte de lo que el reporte ya vio.",
      motion: {
        months: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
        reportLabel: "Reporte continuo todo el año",
        studies: [
          { month: 2, label: "Lanzamiento" },
          { month: 4, label: "Hot Sale" },
          { month: 7, label: "Regreso a clases" },
          { month: 10, label: "Buen Fin" }
        ],
        caption: "Un año de conversación leída, con estudios donde se decide."
      }
    },
    formats: {
      title: "El mismo hallazgo, en el formato que tu equipo usa",
      lead: "Reporte y estudio son lo que respondemos. El formato es cómo te llega, y puede ser más de uno.",
      items: [
        { key: "stories", name: "Historias animadas", text: "Hallazgos cortos como los de nuestro feed, para mandar al equipo o presentar en un minuto." },
        { key: "live", name: "Presentación en vivo", text: "Te lo presentamos, respondemos preguntas y dejamos la evidencia abierta para revisarla después." },
        { key: "document", name: "Documento con la evidencia", text: "Cada hallazgo con su cifra, sus citas literales y el método detrás, listo para circular." },
        { key: "dashboard", name: "Dashboard en línea", text: "Los hallazgos del reporte en un dashboard con filtros por tema, fuente y periodo, y cada cifra ligada a lo que la gente dijo." }
      ],
      mock: {
        live: { badge: "En vivo", slide: "Lo que cambió en septiembre", bars: ["Precio", "Servicio", "Empaque"] },
        document: { title: "Lo que acerca y lo que frena", trigger: "Lo que acerca", barrier: "Lo que frena", quotes: ["Si la veo en la tienda, la pruebo", "Se me antoja, pero está carísima"] },
        dashboard: {
          title: "Mapa de temas · septiembre",
          xLabel: "Volumen",
          yLabel: "Crecimiento",
          bubbles: [
            { name: "Precio", x: 0.74, y: 0.72, size: 1, tone: "teal" },
            { name: "Empaque reciclable", x: 0.22, y: 0.86, size: 0.45, tone: "teal" },
            { name: "Servicio", x: 0.6, y: 0.18, size: 0.75, tone: "coral" },
            { name: "Sabor", x: 0.88, y: 0.36, size: 0.85, tone: "grey" },
            { name: "Entrega", x: 0.42, y: 0.42, size: 0.55, tone: "grey" },
            { name: "Recetas", x: 0.12, y: 0.6, size: 0.35, tone: "teal" }
          ],
          listTitle: "Temas que suben",
          items: [
            ["Empaque reciclable", "Emergente"],
            ["Precio por mililitro", "Acelerando"],
            ["Recetas con el producto", "Emergente"],
            ["Precio", "Mainstream"]
          ]
        }
      }
    },
    situations: { title: "Empieza por tu situación", lead: "Cada momento trae su propia pregunta. Abre el tuyo para ver qué miramos y qué recibes." },
    labels: { more: "Ver cómo lo resolvemos", play: "Reproducir", pause: "Pausar", report: "Reporte continuo", study: "Estudio", plan: "Plan anual" }
  },
  en: {
    title: "Answers for every moment of your brand",
    lead: "We work in two ways. A report that tells you every month what changed and why, and a study that answers one specific decision. The annual plan brings both together.",
    jump: { report: "Ongoing report", study: "Study", plan: "Annual plan" },
    report: {
      name: "Ongoing report",
      title: "What changed this month, and why",
      text: "We follow what people say about your brand, your competitors and your category. Every month you get what moved, the reason behind it and what to watch, compared with the previous month.",
      watchTitle: "What we follow",
      watch: [
        { icon: "brand", name: "Your brand", text: "How people talk about it, what they praise and what they complain about." },
        { icon: "competitors", name: "Your competitors", text: "How much of the conversation they hold and where they beat you." },
        { icon: "category", name: "Your category", text: "The topics that rise or fall even when nobody names a brand." },
        { icon: "campaigns", name: "Campaigns and launches", text: "How people receive what you launch and what everyone else launches." },
        { icon: "topics", name: "The topics you care about", text: "Price, service, sustainability or whatever defines your business." },
        { icon: "signals", name: "Signals that are starting", text: "Small topics growing fast, before they go mainstream." }
      ],
      alwaysTitle: "For the day to day",
      motion: {
        months: ["Jul", "Aug", "Sep"],
        brands: ["Your brand", "Competitor A", "Competitor B"],
        shareLabel: "Share of the conversation",
        changeTitle: "What changed in September",
        changes: [
          { dir: "up", text: "Your brand gained ground with the new packaging" },
          { dir: "down", text: "Competitor A lost trust over service" },
          { dir: "new", text: "A new topic appears: price per milliliter" }
        ]
      }
    },
    study: {
      name: "Study",
      title: "One question, answered",
      text: "It starts with a decision in front of you. We turn it into a question the conversation can answer, choose the method and read everything that touches it. You get the answer with recommendations, presented live.",
      situationsTitle: "For decisions like these",
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
      title: "The answer ready before each decision",
      text: "The report runs all year and studies sit at the moments that matter: launches, campaigns and seasons. Every decision arrives with its answer, and every study starts from what the report already saw.",
      motion: {
        months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        reportLabel: "Ongoing report all year",
        studies: [
          { month: 2, label: "Launch" },
          { month: 4, label: "Hot Sale" },
          { month: 7, label: "Back to school" },
          { month: 10, label: "Buen Fin" }
        ],
        caption: "A year of conversation read, with studies where decisions are made."
      }
    },
    formats: {
      title: "The same finding, in the format your team uses",
      lead: "Report and study are what we answer. The format is how it reaches you, and it can be more than one.",
      items: [
        { key: "stories", name: "Animated stories", text: "Short findings like the ones in our feed, to send to the team or present in a minute." },
        { key: "live", name: "Live presentation", text: "We present it, answer questions and leave the evidence open to review later." },
        { key: "document", name: "Document with the evidence", text: "Every finding with its number, its verbatim quotes and the method behind it, ready to share." },
        { key: "dashboard", name: "Online dashboard", text: "The report's findings in a dashboard you can filter by topic, source and period, with every number tied to what people said." }
      ],
      mock: {
        live: { badge: "Live", slide: "What changed in September", bars: ["Price", "Service", "Packaging"] },
        document: { title: "What draws people and what holds them back", trigger: "Draws them", barrier: "Holds them back", quotes: ["I'd try it if I saw it at the store", "I want it, but it costs way too much"] },
        dashboard: {
          title: "Topic map · September",
          xLabel: "Volume",
          yLabel: "Growth",
          bubbles: [
            { name: "Price", x: 0.74, y: 0.72, size: 1, tone: "teal" },
            { name: "Recyclable pack", x: 0.22, y: 0.86, size: 0.45, tone: "teal" },
            { name: "Service", x: 0.6, y: 0.18, size: 0.75, tone: "coral" },
            { name: "Taste", x: 0.88, y: 0.36, size: 0.85, tone: "grey" },
            { name: "Delivery", x: 0.42, y: 0.42, size: 0.55, tone: "grey" },
            { name: "Recipes", x: 0.12, y: 0.6, size: 0.35, tone: "teal" }
          ],
          listTitle: "Topics on the rise",
          items: [
            ["Recyclable packaging", "Emerging"],
            ["Price per milliliter", "Accelerating"],
            ["Recipes with the product", "Emerging"],
            ["Price", "Mainstream"]
          ]
        }
      }
    },
    situations: { title: "Start from your situation", lead: "Every moment brings its own question. Open yours to see what we look at and what you get." },
    labels: { more: "See how we solve it", play: "Play", pause: "Pause", report: "Ongoing report", study: "Study", plan: "Annual plan" }
  }
};
