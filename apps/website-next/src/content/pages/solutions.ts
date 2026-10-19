import type { Entry } from "./registry";
import type { FaqIcon } from "@/components/ui/faq-icons";
import type { Localized, PageContent } from "./types";
import { moments } from "../moments";

export const solutionsIndex: Localized<PageContent> = {
  es: {
    metaTitle: "Reportes, estudios y plan anual de inteligencia social",
    metaDescription:
      "Empieza por tu situación: monitorear, lanzar, entrar, defender, optimizar, innovar o planear. Del otro lado hay un reporte continuo, un estudio que responde una pregunta o un plan anual. Entrada con un taller gratis, sin lista de precios.",
    title: "Empieza por lo que necesitas resolver",
    lead:
      "Cada momento en la vida de una marca trae una pregunta distinta. Elige el tuyo y verás qué miramos, qué recibes y cómo se empieza. Del otro lado siempre hay una de tres cosas: un reporte continuo, un estudio o un plan anual.",
    blocks: [
      {
        type: "steps",
        title: "Cómo se empieza",
        items: [
          { name: "Taller", text: "30 a 60 minutos, sin costo. Entendemos tu contexto y la decisión que viene, y vemos qué puede responder la conversación." },
          { name: "Alcance", text: "Te proponemos fuentes, método, entregables, fechas y costo por escrito. También sin costo. Tú decides si arrancamos." },
          { name: "Primera entrega", text: "Presentamos en vivo, respondemos tus preguntas y dejamos la evidencia abierta para que la revises." }
        ]
      },
      {
        type: "cards",
        title: "Qué define el alcance",
        lead: "No publicamos una lista de precios porque dos preguntas que suenan igual pueden pedir trabajos muy distintos. El costo sale de cinco cosas.",
        items: [
          { name: "La pregunta", icon: "question", text: "Qué vas a decidir y cuántas preguntas investigables hacen falta para responderlo." },
          { name: "Las fuentes", icon: "sources", text: "Redes, reseñas, foros, búsquedas y tus propios datos. Cada una se suma si aporta a la pregunta." },
          { name: "Los mercados", icon: "markets", text: "Cuántos países o regiones, y en qué idiomas habla la gente ahí." },
          { name: "El periodo", icon: "period", text: "Cuánta historia hace falta leer y, si el análisis se repite, cada cuánto: cada semana, cada quincena o cada mes." },
          { name: "La profundidad", icon: "depth", text: "Una respuesta directa, un estudio completo con recomendaciones o un plan para el año." }
        ]
      },
      {
        type: "faq",
        title: "Preguntas frecuentes",
        items: [
          { q: "¿Cuál me conviene, un reporte o un estudio?", a: "Si quieres saber de forma continua qué pasa con tu marca y qué cambió, un reporte, con la frecuencia que elijas. Si tienes una decisión concreta por delante, un estudio. Muchos equipos empiezan con un estudio y luego mantienen un reporte." },
          { q: "¿Cuánto cuesta?", a: "Depende de la pregunta, las fuentes, los mercados, el periodo y la profundidad. Después del taller recibes un alcance por escrito con el costo, sin compromiso." },
          { q: "¿Puedo empezar sin brief?", a: "Sí. El taller existe para eso. Con tu situación y la decisión que viene, armamos juntos la pregunta." },
          { q: "¿Trabajan con agencias?", a: "Sí. Muchas veces el estudio alimenta el planning de una agencia o se presenta junto con ella a su cliente." }
        ]
      },
      {
        type: "cta",
        title: "Trae tu pregunta",
        text: "Un taller gratis de 30 a 60 minutos para entender tu decisión y proponerte un alcance.",
        label: "Agenda un taller gratis",
        href: "/taller"
      }
    ]
  },
  en: {
    metaTitle: "Reports, studies and an annual plan of social intelligence",
    metaDescription:
      "Start from your situation: track, launch, enter, defend, optimize, innovate or plan. On the other side there is a continuous report, a study that answers one question or an annual plan. Entry through a free workshop, no price list.",
    title: "Start from what you need to solve",
    lead:
      "Every moment in the life of a brand brings a different question. Pick yours and you will see what we look at, what you receive and how to start. On the other side there is always one of three things: a continuous report, a study or an annual plan.",
    blocks: [
      {
        type: "steps",
        title: "How to start",
        items: [
          { name: "Workshop", text: "30 to 60 minutes, free. We understand your context and the decision ahead, and look at what the conversation can answer." },
          { name: "Scope", text: "We propose sources, method, deliverables, dates and cost in writing. Also free. You decide whether we start." },
          { name: "First delivery", text: "We present live, answer your questions and leave the evidence open for you to review." }
        ]
      },
      {
        type: "cards",
        title: "What defines the scope",
        lead: "We don't publish a price list because two questions that sound alike can call for very different work. The cost comes from five things.",
        items: [
          { name: "The question", icon: "question", text: "What you are going to decide and how many researchable questions it takes to answer it." },
          { name: "The sources", icon: "sources", text: "Social media, reviews, forums, search and your own data. Each one is added if it contributes to the question." },
          { name: "The markets", icon: "markets", text: "How many countries or regions, and which languages people speak there." },
          { name: "The period", icon: "period", text: "How much history needs to be read and, if the analysis repeats, how often: every week, every two weeks or every month." },
          { name: "The depth", icon: "depth", text: "A direct answer, a full study with recommendations or a plan for the year." }
        ]
      },
      {
        type: "faq",
        title: "Frequently asked questions",
        items: [
          { q: "Which one do I need, a report or a study?", a: "If you want to keep knowing what is happening with your brand and what changed, a report, at the frequency you choose. If you have a specific decision ahead, a study. Many teams start with a study and then keep a report running." },
          { q: "How much does it cost?", a: "It depends on the question, the sources, the markets, the period and the depth. After the workshop you receive a written scope with the cost, with no commitment." },
          { q: "Can I start without a brief?", a: "Yes. That is what the workshop is for. From your situation and the decision ahead, we build the question together." },
          { q: "Do you work with agencies?", a: "Yes. The study often feeds an agency's planning or is presented alongside the agency to its client." }
        ]
      },
      {
        type: "cta",
        title: "Bring your question",
        text: "A free 30 to 60 minute workshop to understand your decision and propose a scope.",
        label: "Book a free workshop",
        href: "/en/workshop"
      }
    ]
  }
};

/** What each situation page keeps in this file: its FAQs. Everything else lives in situation-details.ts. */
export type MomentCopy = {
  faq: { q: string; a: string; icon?: FaqIcon }[];
};

const labels = {
  es: { faq: "Preguntas frecuentes", ctaTitle: "Trae tu pregunta", ctaText: "En un taller gratis de 30 a 60 minutos vemos tu caso y te proponemos un alcance.", ctaLabel: "Agenda un taller gratis", ctaHref: "/taller" },
  en: { faq: "Frequently asked questions", ctaTitle: "Bring your question", ctaText: "In a free 30 to 60 minute workshop we look at your case and propose a scope.", ctaLabel: "Book a free workshop", ctaHref: "/en/workshop" }
};

const copy: Record<string, Localized<MomentCopy>> = {
  anticipar: {
    es: {
      faq: [
        { icon: "signals", q: "¿En qué se distingue de una lista de tendencias?", a: "Una lista dice qué está de moda. El radar dice en qué etapa está cada señal, qué tan rápido se mueve y si tiene que ver con tu marca, con la evidencia de dónde lo vimos." },
        { icon: "calendar", q: "¿Cada cuánto se actualiza?", a: "Con la frecuencia que elijas para el reporte, cada semana, cada quincena o cada mes. Si una señal cambia de etapa entre un reporte y otro, te avisamos." },
        { icon: "mind", q: "¿Sirve para innovación de producto?", a: "Sí. Muchas señales emergentes son necesidades que todavía nadie resuelve bien. Cuando una pide más profundidad, se convierte en un estudio." }
      ]
    },
    en: {
      faq: [
        { icon: "signals", q: "How is it different from a trend list?", a: "A list says what is fashionable. The radar says which stage each signal is in, how fast it moves and whether it relates to your brand, with the evidence of where we saw it." },
        { icon: "calendar", q: "How often is it updated?", a: "As often as you choose for the report, every week, every two weeks or every month. If a signal changes stage between reports, we let you know." },
        { icon: "mind", q: "Is it useful for product innovation?", a: "Yes. Many emerging signals are needs nobody solves well yet. When one calls for more depth, it becomes a study." }
      ]
    }
  },
  monitorear: {
    es: {
      faq: [
        { icon: "search", q: "¿Qué diferencia hay con el dashboard de mi herramienta de listening?", a: "El dashboard muestra volumen y sentimiento sobre palabras que alguien eligió. El reporte parte de temas descubiertos desde lo que la gente dice, limpia el ruido, explica el cambio y lo firma una persona. Puedes conservar tu herramienta, y el reporte puede leer sus exportaciones." },
        { icon: "calendar", q: "¿Cada cuánto llega?", a: "Con la frecuencia que necesites, cada semana, cada quincena o cada mes, siempre en una fecha fija. La definimos contigo en el alcance y se puede cambiar después." },
        { icon: "eye", q: "¿Puedo pedir que profundicen en algo?", a: "Sí. Cuando un tema pide más profundidad, se convierte en un estudio corto dentro del mismo acuerdo o como alcance aparte." },
        { icon: "edit", q: "¿Qué pasa si quiero cambiar los temas?", a: "Los temas son editables. Un Intelligence Architect los ajusta contigo y nuestro software conserva ese cambio para los siguientes reportes." }
      ]
    },
    en: {
      faq: [
        { icon: "search", q: "How is this different from my listening tool's dashboard?", a: "The dashboard shows volume and sentiment on keywords someone chose. The report starts from topics discovered in what people say, cleans out the noise, explains the change and is signed off by a person. You can keep your tool, and the report can read its exports." },
        { icon: "calendar", q: "How often does it arrive?", a: "As often as you need, every week, every two weeks or every month, always on a fixed date. We set it with you in the scope and it can change later." },
        { icon: "eye", q: "Can I ask you to go deeper on something?", a: "Yes. When a topic calls for more depth, it becomes a short study within the same agreement or as a separate scope." },
        { icon: "edit", q: "What if I want to change the topics?", a: "Topics are editable. An Intelligence Architect adjusts them with you and our software keeps that change for the following reports." }
      ]
    }
  },
  lanzar: {
    es: {
      faq: [
        { icon: "time", q: "¿Cuánto antes del lanzamiento hay que empezar?", a: "La primera versión del estudio llega en días a partir del brief. Lo ideal es antes de cerrar el concepto creativo, para que la evidencia entre al brief desde el principio." },
        { icon: "check", q: "¿Pueden probar un concepto ya producido?", a: "Sí. Se lee la reacción espontánea y se compara con lo que la categoría ya decía antes. Para medir intención de compra hace falta una prueba cuantitativa, y el estudio dice qué preguntar en ella." },
        { icon: "languages", q: "¿Sirve para un lanzamiento en varios países?", a: "Sí, y cada país se lee por separado, porque los códigos de la categoría cambian de un mercado a otro. Leemos conversación en 16 idiomas." }
      ]
    },
    en: {
      faq: [
        { icon: "time", q: "How far ahead of the launch should we start?", a: "The first version of the study arrives within days of the brief. Ideally before the creative concept is locked, so the evidence goes into the brief from the start." },
        { icon: "check", q: "Can you test a concept that is already produced?", a: "Yes. We read the spontaneous reaction and compare it with what the category was already saying. Measuring purchase intent calls for a quantitative test, and the study says what to ask in it." },
        { icon: "languages", q: "Does it work for a launch in several countries?", a: "Yes, and each country is read separately, because the category's codes change from one market to the next. We read conversation in 16 languages." }
      ]
    }
  },
  entrar: {
    es: {
      faq: [
        { icon: "markets", q: "¿Pueden leer un mercado donde no tienen oficina?", a: "Sí. Leemos conversación en 16 idiomas en más de 20 países de América, Europa y África. Lo que hace falta es que la categoría tenga conversación pública en ese mercado." },
        { icon: "time", q: "¿Cuánto tarda?", a: "La primera versión llega en días a partir del brief. Un mercado con mucha conversación o varios países a la vez piden más tiempo, y el alcance lo dice." },
        { icon: "category", q: "¿Reemplaza el estudio de tamaño de mercado?", a: "No. El estudio dice cómo funciona el mercado y cómo entrar. El tamaño y la participación esperada se calculan con otras fuentes." }
      ]
    },
    en: {
      faq: [
        { icon: "markets", q: "Can you read a market where you have no office?", a: "Yes. We read conversation in 16 languages across more than 20 countries in the Americas, Europe and Africa. What is needed is for the category to have public conversation in that market." },
        { icon: "time", q: "How long does it take?", a: "The first version arrives within days of the brief. A market with a lot of conversation, or several countries at once, takes longer, and the scope says so." },
        { icon: "category", q: "Does it replace a market sizing study?", a: "No. The study says how the market works and how to enter. Size and expected share are calculated with other sources." }
      ]
    }
  },
  defender: {
    es: {
      faq: [
        { icon: "competitors", q: "¿Pueden leer a mi competidor con el mismo detalle?", a: "Sí, con las mismas fuentes y el mismo periodo. Es lo que hace comparable el análisis. Leemos conversación pública y no accedemos a datos internos de nadie." },
        { icon: "time", q: "¿Cuánto tarda?", a: "La primera versión llega en días a partir del brief, lo que permite reaccionar dentro del mismo trimestre." },
        { icon: "question", q: "¿Y si la gente sí se va por precio?", a: "El estudio lo dirá, con cifras y citas. En ese caso el análisis se concentra en qué parte del valor no se está viendo y qué justificaría la diferencia." },
        { icon: "calendar", q: "¿Se puede seguir después del estudio?", a: "Sí. Muchos equipos convierten el estudio en un reporte continuo, con la frecuencia que elijan, para ver si las acciones cambian la conversación." }
      ]
    },
    en: {
      faq: [
        { icon: "competitors", q: "Can you read my competitor in the same detail?", a: "Yes, with the same sources and the same period. That is what makes the analysis comparable. We read public conversation and we don't access anyone's internal data." },
        { icon: "time", q: "How long does it take?", a: "The first version arrives within days of the brief, which allows you to react within the same quarter." },
        { icon: "question", q: "What if people really do leave over price?", a: "The study will say so, with numbers and quotes. In that case the analysis focuses on which part of the value isn't being seen and what would justify the difference." },
        { icon: "calendar", q: "Can we keep going after the study?", a: "Yes. Many teams turn the study into an ongoing report, at the frequency they choose, to see whether the actions change the conversation." }
      ]
    }
  },
  optimizar: {
    es: {
      faq: [
        { icon: "data", q: "¿Necesito compartir mis datos?", a: "No es obligatorio. El reporte se hace sobre conversación pública. Si compartes tu NPS, tus encuestas o datos de funnel, se leen con los mismos temas y la lectura gana precisión al cruzar lo dicho con lo hecho." },
        { icon: "calendar", q: "¿Cada cuánto llega?", a: "Con la frecuencia que elijas, cada semana, cada quincena o cada mes. Cada entrega compara el recorrido contra la anterior, así ves si lo que arreglaste ya bajó la frustración." },
        { icon: "question", q: "¿Me dicen cuánto va a mejorar la conversión?", a: "No. El reporte da prioridades y las hipótesis más fuertes. El efecto en porcentaje se mide con un experimento, y el reporte dice cuál correr primero." }
      ]
    },
    en: {
      faq: [
        { icon: "data", q: "Do I need to share my data?", a: "It isn't required. The report is built on public conversation. If you share your NPS, surveys or funnel data, they are read with the same topics and the reading gains precision by crossing what is said with what is done." },
        { icon: "calendar", q: "How often does it arrive?", a: "As often as you choose, every week, every two weeks or every month. Each delivery compares the journey with the previous one, so you see whether what you fixed already lowered the frustration." },
        { icon: "question", q: "Will you tell me how much conversion will improve?", a: "No. The report gives priorities and the strongest hypotheses. The effect in percentage terms is measured with an experiment, and the report says which one to run first." }
      ]
    }
  },
  innovar: {
    es: {
      faq: [
        { icon: "people", q: "¿Esto reemplaza la investigación cualitativa con usuarios?", a: "No. La complementa. La conversación muestra lo que la gente dice espontáneamente y a escala, y las entrevistas van más a fondo en lo que la conversación señala." },
        { icon: "category", q: "¿Pueden leer categorías adyacentes?", a: "Sí. Muchas necesidades se ven mejor en la categoría vecina, donde la gente ya resolvió algo parecido." },
        { icon: "check", q: "¿Qué tan segura es la oportunidad que encuentran?", a: "Cada hallazgo dice si es medido, direccional o cualitativo. El estudio entrega hipótesis fuertes y las preguntas para validarlas. La validación cuantitativa es el paso siguiente." }
      ]
    },
    en: {
      faq: [
        { icon: "people", q: "Does this replace qualitative research with users?", a: "No. It complements it. Conversation shows what people say spontaneously and at scale, and interviews go deeper into what the conversation points to." },
        { icon: "category", q: "Can you read adjacent categories?", a: "Yes. Many needs are easier to see in the neighboring category, where people have already solved something similar." },
        { icon: "check", q: "How certain is the opportunity you find?", a: "Every finding says whether it is measured, directional or qualitative. The study delivers strong hypotheses and the questions to validate them. Quantitative validation is the next step." }
      ]
    }
  },
  planear: {
    es: {
      faq: [
        { icon: "calendar", q: "¿Qué pasa si cambian mis fechas?", a: "El plan se mueve con ellas. Lo que se acuerda es un número de estudios y un reporte continuo, y el calendario se ajusta cada trimestre." },
        { icon: "document", q: "¿Es más barato que contratar estudio por estudio?", a: "La base de temas y fuentes se construye una vez y se reutiliza, así que cada estudio pide menos trabajo de arranque. El alcance lo muestra por escrito." },
        { icon: "check", q: "¿Puedo empezar con un estudio y pasar al plan después?", a: "Sí. Es la forma más común de llegar al plan anual." },
        { icon: "live", q: "¿Qué recibo entre estudios?", a: "El reporte continuo, cada semana, quincena o mes según lo acordemos. Dice qué se movió, por qué y qué vigilar, con los mismos temas que alimentan los estudios." }
      ]
    },
    en: {
      faq: [
        { icon: "calendar", q: "What if my dates change?", a: "The plan moves with them. What is agreed is a number of studies and an ongoing report, and the calendar is adjusted every quarter." },
        { icon: "document", q: "Is it cheaper than hiring study by study?", a: "The base of topics and sources is built once and reused, so each study needs less start-up work. The scope shows it in writing." },
        { icon: "check", q: "Can I start with one study and move to the plan later?", a: "Yes. It is the most common way to get to the annual plan." },
        { icon: "live", q: "What do I receive between studies?", a: "The ongoing report, weekly, every two weeks or monthly as we agree. It says what moved, why and what to watch, with the same topics that feed the studies." }
      ]
    }
  }
};

/** FAQs per situation, for the designed situation page. */
export const situationCopy = copy;
export { labels as momentLabels };

/** One entry per situation: slugs for static params and the sitemap, and the words for metadata. */
export const solutionEntries: Entry[] = moments.map((mo) => ({
  slug: mo.slug,
  summary: { es: mo.es.summary, en: mo.en.summary },
  page: {
    es: { metaTitle: mo.es.name, metaDescription: mo.es.summary, title: mo.es.question, lead: mo.es.summary, blocks: [] },
    en: { metaTitle: mo.en.name, metaDescription: mo.en.summary, title: mo.en.question, lead: mo.en.summary, blocks: [] }
  }
}));
