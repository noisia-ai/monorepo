import type { Entry } from "./registry";
import type { Block, Localized, PageContent } from "./types";
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
          { name: "La pregunta", text: "Qué vas a decidir y cuántas preguntas investigables hacen falta para responderlo." },
          { name: "Las fuentes", text: "Redes, reseñas, foros, búsquedas y tus propios datos. Cada una se suma si aporta a la pregunta." },
          { name: "Los mercados", text: "Cuántos países o regiones, y en qué idiomas habla la gente ahí." },
          { name: "El periodo", text: "Cuánta historia hace falta leer y si el análisis se repite cada mes." },
          { name: "La profundidad", text: "Una respuesta directa, un estudio completo con recomendaciones o un plan para el año." }
        ]
      },
      {
        type: "faq",
        title: "Preguntas frecuentes",
        items: [
          { q: "¿Cuál me conviene, un reporte o un estudio?", a: "Si quieres saber qué pasa con tu marca cada mes y qué cambió, un reporte. Si tienes una decisión concreta por delante, un estudio. Muchos equipos empiezan con un estudio y luego mantienen un reporte." },
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
          { name: "The question", text: "What you are going to decide and how many researchable questions it takes to answer it." },
          { name: "The sources", text: "Social media, reviews, forums, search and your own data. Each one is added if it contributes to the question." },
          { name: "The markets", text: "How many countries or regions, and which languages people speak there." },
          { name: "The period", text: "How much history needs to be read and whether the analysis repeats every month." },
          { name: "The depth", text: "A direct answer, a full study with recommendations or a plan for the year." }
        ]
      },
      {
        type: "faq",
        title: "Frequently asked questions",
        items: [
          { q: "Which one do I need, a report or a study?", a: "If you want to know what is happening with your brand every month and what changed, a report. If you have a specific decision ahead, a study. Many teams start with a study and then keep a report running." },
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

type MomentCopy = {
  situation: string[];
  lookAt: { name: string; text: string }[];
  receive: { name: string; text: string }[];
  example: string;
  methods: { label: string; text: string; href: string }[];
  faq: { q: string; a: string }[];
};

const labels = {
  es: { situation: "La situación", lookAt: "Qué miramos", receive: "Qué recibes", example: "Un ejemplo ilustrativo", methods: "Métodos que suelen entrar", faq: "Preguntas frecuentes", ctaTitle: "Trae tu pregunta", ctaText: "En un taller gratis de 30 a 60 minutos vemos tu caso y te proponemos un alcance.", ctaLabel: "Agenda un taller gratis", ctaHref: "/taller" },
  en: { situation: "The situation", lookAt: "What we look at", receive: "What you receive", example: "An illustrative example", methods: "Methods that usually come in", faq: "Frequently asked questions", ctaTitle: "Bring your question", ctaText: "In a free 30 to 60 minute workshop we look at your case and propose a scope.", ctaLabel: "Book a free workshop", ctaHref: "/en/workshop" }
};

function momentBlocks(c: MomentCopy, lang: "es" | "en"): Block[] {
  const l = labels[lang];
  return [
    { type: "text", title: l.situation, paragraphs: c.situation },
    { type: "cards", title: l.lookAt, items: c.lookAt },
    { type: "cards", title: l.receive, items: c.receive },
    { type: "callout", title: l.example, text: c.example },
    { type: "links", title: l.methods, items: c.methods },
    { type: "faq", title: l.faq, items: c.faq },
    { type: "cta", title: l.ctaTitle, text: l.ctaText, label: l.ctaLabel, href: l.ctaHref }
  ];
}

const m = {
  es: {
    tb: { label: "Triggers & Barriers", href: "/metodos/triggers-y-barriers" },
    vpm: { label: "Value Perception Matrix", href: "/metodos/value-perception-matrix" },
    cc: { label: "Cultural Codes Decoding", href: "/metodos/cultural-codes-decoding" },
    dv: { label: "Decision Velocity", href: "/metodos/decision-velocity" },
    jfm: { label: "Journey Friction Mapping", href: "/metodos/journey-friction-mapping" },
    ia: { label: "Influence Architecture", href: "/metodos/influence-architecture" }
  },
  en: {
    tb: { label: "Triggers & Barriers", href: "/en/methods/triggers-and-barriers" },
    vpm: { label: "Value Perception Matrix", href: "/en/methods/value-perception-matrix" },
    cc: { label: "Cultural Codes Decoding", href: "/en/methods/cultural-codes-decoding" },
    dv: { label: "Decision Velocity", href: "/en/methods/decision-velocity" },
    jfm: { label: "Journey Friction Mapping", href: "/en/methods/journey-friction-mapping" },
    ia: { label: "Influence Architecture", href: "/en/methods/influence-architecture" }
  }
};

const copy: Record<string, Localized<MomentCopy>> = {
  monitorear: {
    es: {
      situation: [
        "Tu equipo tiene un tablero, o varios, y aun así la pregunta de cada mes sigue abierta: qué pasó, por qué, y si eso importa. Alguien tiene que leer las menciones, decidir qué es ruido y explicar el cambio frente a dirección. Casi nunca hay tiempo para hacerlo bien.",
        "Un reporte mensual de Noisia hace ese análisis por ti. Compara el mes contra el anterior sobre los mismos temas, explica cada movimiento con sus citas y señala qué conviene vigilar antes de la siguiente reunión."
      ],
      lookAt: [
        { name: "Tu marca y tu categoría", text: "Lo que se dice de ti y de quienes compiten contigo, con el mismo criterio y el mismo periodo." },
        { name: "Los temas, mes contra mes", text: "Qué tema creció, cuál se apagó, cuál apareció por primera vez y qué lo movió." },
        { name: "La voz sin el ruido", text: "Prensa, contenido de marca, reventa y spam fuera. Lo que queda es lo que la gente dijo." },
        { name: "Tus propios datos, si los tienes", text: "NPS, encuestas o tickets de servicio leídos con la misma estructura de temas, para ver dónde coinciden con la conversación y dónde no." }
      ],
      receive: [
        { name: "Reporte mensual presentado en vivo", text: "Qué se movió, por qué y qué vigilar, en un documento corto que dirección puede leer sin contexto previo." },
        { name: "Temas aprobados por una persona", text: "Los temas salen de la conversación y un Intelligence Architect los revisa cada mes. Las correcciones se conservan." },
        { name: "Evidencia abierta", text: "Cada cifra con su cálculo y cada cita literal con fuente y fecha, para abrir cualquier hallazgo." },
        { name: "Alertas con criterio", text: "Cuando algo cambia entre entregas y vale la pena saberlo antes del siguiente reporte." }
      ],
      example:
        "Ejemplo ilustrativo, sin datos de un cliente real. Una cadena de servicios veía cada mes el mismo tema más grande: la espera en sucursal. El estudio del mismo conversación mostró que las menciones con más enojo hablaban de lo que pasaba después de pagar, un tema más chico y más barato de arreglar. El reporte dejó de seguir solo el volumen y empezó a medir las dos cosas.",
      methods: [
        { ...m.es.tb, text: "Para explicar por qué un tema crece o se apaga." },
        { ...m.es.jfm, text: "Cuando los temas señalan un punto del recorrido que falla." }
      ],
      faq: [
        { q: "¿Qué diferencia hay con el tablero de mi herramienta de listening?", a: "El tablero muestra volumen y sentimiento sobre palabras que alguien eligió. El reporte parte de temas descubiertos desde lo que la gente dice, limpia el ruido, explica el cambio y lo firma una persona. Puedes conservar tu herramienta; el reporte puede leer sus exportaciones." },
        { q: "¿Cada cuánto llega?", a: "Cada mes, en una fecha fija. Si tu categoría se mueve más rápido, se puede acordar otra frecuencia en el alcance." },
        { q: "¿Puedo pedir que un mes profundicen en algo?", a: "Sí. Cuando un tema pide más profundidad, se convierte en un estudio corto dentro del mismo acuerdo o como alcance aparte." },
        { q: "¿Qué pasa si quiero cambiar los temas?", a: "Los temas son editables. Un Intelligence Architect los ajusta contigo y el sistema conserva ese cambio para los meses siguientes." }
      ]
    },
    en: {
      situation: [
        "Your team has a dashboard, or several, and the question of the month is still open: what happened, why, and whether it matters. Someone has to read the mentions, decide what is noise and explain the change to leadership. There is almost never time to do it well.",
        "A monthly report from Noisia does that analysis for you. It compares the month against the previous one on the same topics, explains every movement with its quotes and points out what to watch before the next meeting."
      ],
      lookAt: [
        { name: "Your brand and your category", text: "What is said about you and about those competing with you, under the same criteria and the same period." },
        { name: "Topics, month against month", text: "Which topic grew, which faded, which appeared for the first time and what moved it." },
        { name: "The voice without the noise", text: "Press, brand content, resale and spam out. What remains is what people said." },
        { name: "Your own data, if you have it", text: "NPS, surveys or service tickets read with the same topic structure, to see where they agree with the conversation and where they don't." }
      ],
      receive: [
        { name: "Monthly report presented live", text: "What moved, why and what to watch, in a short document leadership can read without prior context." },
        { name: "Topics approved by a person", text: "Topics come out of the conversation and an Intelligence Architect reviews them every month. Corrections are kept." },
        { name: "Open evidence", text: "Every number with its calculation and every verbatim quote with source and date, so any finding can be opened." },
        { name: "Alerts with judgment", text: "When something changes between deliveries and is worth knowing before the next report." }
      ],
      example:
        "Illustrative example, with no data from a real client. A service chain saw the same biggest topic every month: waiting in the branch. The study of the same conversación showed that the angriest mentions were about what happened after paying, a smaller topic and cheaper to fix. The report stopped tracking volume alone and started measuring both.",
      methods: [
        { ...m.en.tb, text: "To explain why a topic grows or fades." },
        { ...m.en.jfm, text: "When topics point to a step of the journey that fails." }
      ],
      faq: [
        { q: "How is this different from my listening tool's dashboard?", a: "The dashboard shows volume and sentiment on keywords someone chose. The report starts from topics discovered in what people say, cleans out the noise, explains the change and is signed off by a person. You can keep your tool; the report can read its exports." },
        { q: "How often does it arrive?", a: "Every month, on a fixed date. If your category moves faster, another frequency can be agreed in the scope." },
        { q: "Can I ask you to go deeper on something one month?", a: "Yes. When a topic calls for more depth, it becomes a short study within the same agreement or as a separate scope." },
        { q: "What if I want to change the topics?", a: "Topics are editable. An Intelligence Architect adjusts them with you and the system keeps that change for the following months." }
      ]
    }
  },
  lanzar: {
    es: {
      situation: [
        "Tienes dos o tres territorios sobre la mesa y todos suenan bien en la sala. El riesgo es elegir el que suena bien para tu equipo y que la gente lo lea como una promesa más de la categoría.",
        "Antes de invertir en producción y pauta, probamos cada territorio contra la conversación real: qué dice la gente de eso hoy, con qué palabras, qué le da permiso y qué lo vuelve genérico."
      ],
      lookAt: [
        { name: "Los territorios como hipótesis", text: "Cada uno se traduce en lo que tendría que estar pasando en la conversación para que tenga permiso." },
        { name: "Lo que la gente ya dice", text: "Motivos, frenos y lenguaje literal alrededor de la categoría y de tu marca." },
        { name: "Los códigos del mercado", text: "Qué se admira, qué se ridiculiza y qué significa la categoría ahí donde vas a lanzar." },
        { name: "Lo que ya ocupan otros", text: "Qué territorio tiene dueño en la conversación y cuál sigue libre." }
      ],
      receive: [
        { name: "Territorios probados", text: "Cada uno con su evidencia a favor y en contra, y una recomendación clara de cuál construir." },
        { name: "El lenguaje con permiso", text: "Palabras, comparaciones y tonos que la gente ya usa y que la campaña puede tomar prestados." },
        { name: "Lo que conviene evitar", text: "Promesas que la categoría ya gastó y frases que suenan a otra marca." },
        { name: "Brief con fuentes", text: "Un documento que tu agencia o tu equipo creativo puede usar directo, con cada hallazgo ligado a lo que la gente dijo." }
      ],
      example:
        "Ejemplo ilustrativo, sin datos de un cliente real. Una marca de botanas quería construir sobre la noche de película en casa. La conversación mostró que la gente hablaba mucho más de la previa: quién lleva qué, la discusión por elegir la película, el grupo que se arma antes. El territorio del momento ya tenía dueño; el de la previa estaba libre y tenía lenguaje propio.",
      methods: [
        { ...m.es.tb, text: "Para saber qué motivo puede activar la campaña y qué freno la puede hundir." },
        { ...m.es.cc, text: "Para elegir un lenguaje que pertenezca al mercado." }
      ],
      faq: [
        { q: "¿Cuánto antes del lanzamiento hay que empezar?", a: "La primera versión del estudio llega en días a partir del brief. Lo ideal es antes de cerrar el concepto creativo, para que la evidencia entre al brief desde el principio." },
        { q: "¿Pueden probar un concepto ya producido?", a: "Sí. Se lee la reacción espontánea y se compara con lo que la categoría ya decía antes. Para medir intención de compra hace falta una prueba cuantitativa, y el estudio dice qué preguntar en ella." },
        { q: "¿Sirve para un lanzamiento en varios países?", a: "Sí, y cada país se lee por separado, porque los códigos de la categoría cambian de un mercado a otro. Leemos conversación en 16 idiomas." }
      ]
    },
    en: {
      situation: [
        "You have two or three territories on the table and they all sound good in the room. The risk is choosing the one that sounds good to your team and having people read it as one more promise from the category.",
        "Before investing in production and media, we test each territory against real conversation: what people say about it today, in what words, what grants it permission and what makes it generic."
      ],
      lookAt: [
        { name: "Territories as hypotheses", text: "Each one is translated into what would have to be happening in the conversation for it to have permission." },
        { name: "What people already say", text: "Motives, obstacles and verbatim language around the category and your brand." },
        { name: "The market's codes", text: "What is admired, what is ridiculed and what the category means where you are going to launch." },
        { name: "What others already own", text: "Which territory already has an owner in the conversation and which one is still open." }
      ],
      receive: [
        { name: "Tested territories", text: "Each with its evidence for and against, and a clear recommendation of which one to build on." },
        { name: "Language with permission", text: "Words, comparisons and tones people already use that the campaign can borrow." },
        { name: "What to avoid", text: "Promises the category has already worn out and phrases that sound like another brand." },
        { name: "Brief with sources", text: "A document your agency or creative team can use directly, with every finding tied to what people said." }
      ],
      example:
        "Illustrative example, with no data from a real client. A snack brand wanted to build on movie night at home. The conversation showed that people talked far more about the lead-up: who brings what, the argument over which movie to pick, the group that forms beforehand. The territory of the moment already had an owner; the lead-up was open and had a language of its own.",
      methods: [
        { ...m.en.tb, text: "To know which motive the campaign can activate and which obstacle can sink it." },
        { ...m.en.cc, text: "To choose a language that belongs to the market." }
      ],
      faq: [
        { q: "How far ahead of the launch should we start?", a: "The first version of the study arrives within days of the brief. Ideally before the creative concept is locked, so the evidence goes into the brief from the start." },
        { q: "Can you test a concept that is already produced?", a: "Yes. We read the spontaneous reaction and compare it with what the category was already saying. Measuring purchase intent calls for a quantitative test, and the study says what to ask in it." },
        { q: "Does it work for a launch in several countries?", a: "Yes, and each country is read separately, because the category's codes change from one market to the next. We read conversation in 16 languages." }
      ]
    }
  },
  entrar: {
    es: {
      situation: [
        "Vas a entrar a un mercado o a una categoría que conoces de lejos. Los datos de tamaño existen; lo que falta es saber cómo se habla ahí, qué se respeta, quién da credibilidad y qué error te marcaría como alguien de fuera.",
        "Leemos la conversación local antes de que llegues: las reglas no escritas, las voces que legitiman y las promesas que ya nadie cree."
      ],
      lookAt: [
        { name: "Qué significa la categoría ahí", text: "Lo que se admira, lo que se ridiculiza y lo que da permiso en ese mercado, leído en su idioma y en sus comunidades." },
        { name: "Quién da credibilidad", text: "Las voces que legitiman, las que conectan comunidades y las que articulan la crítica." },
        { name: "Cómo se entra y cómo se falla", text: "Cómo fue recibida cada marca que llegó antes y qué se le reprochó." },
        { name: "Tu marca vista desde allá", text: "Si ya te conocen, qué se dice; si no, qué lugar hay en el sistema de la categoría." }
      ],
      receive: [
        { name: "Dossier de entrada", text: "Las reglas no escritas de la categoría en ese mercado, con las citas que las sostienen." },
        { name: "Mapa de voces", text: "Quién legitima, quién conecta y a quién vigilar, con una lógica de relación." },
        { name: "Lo que conviene evitar", text: "Promesas gastadas, tonos que marcan a un extranjero y temas sensibles." },
        { name: "Brief de entrada", text: "Qué código ocupar, qué lenguaje usar y con qué voces empezar, listo para marca y comunicación." }
      ],
      example:
        "Ejemplo ilustrativo, sin datos de un cliente real. Una categoría de consumo parecía aspiracional desde fuera. En las comunidades locales operaba como señal de exceso, y las marcas respetadas eran las que hablaban de control y de medida. La entrada cambió de prestigio a confianza antes de la primera pieza de comunicación.",
      methods: [
        { ...m.es.cc, text: "Para leer el significado local de la categoría." },
        { ...m.es.ia, text: "Para saber quién da credibilidad y por dónde entra lo nuevo." }
      ],
      faq: [
        { q: "¿Pueden leer un mercado donde no tienen oficina?", a: "Sí. Leemos conversación en 16 idiomas en más de 20 países de América, Europa y África. Lo que hace falta es que la categoría tenga conversación pública en ese mercado." },
        { q: "¿Cuánto tarda?", a: "La primera versión llega en días a partir del brief. Un mercado con mucha conversación o varios países a la vez piden más tiempo, y el alcance lo dice." },
        { q: "¿Reemplaza el estudio de tamaño de mercado?", a: "No. El estudio dice cómo funciona el mercado y cómo entrar; el tamaño y la participación esperada se calculan con otras fuentes." }
      ]
    },
    en: {
      situation: [
        "You are about to enter a market or a category you know from a distance. The sizing data exists; what is missing is knowing how people talk there, what is respected, who lends credibility and which mistake would mark you as an outsider.",
        "We read the local conversation before you arrive: the unwritten rules, the voices that legitimize and the promises nobody believes anymore."
      ],
      lookAt: [
        { name: "What the category means there", text: "What is admired, what is ridiculed and what grants permission in that market, read in its language and its communities." },
        { name: "Who lends credibility", text: "The voices that legitimize, the ones that connect communities and the ones that articulate the criticism." },
        { name: "How brands get in and how they fail", text: "How each brand that arrived before was received and what it was blamed for." },
        { name: "Your brand seen from there", text: "If they already know you, what is said; if not, which place is open in the category's system." }
      ],
      receive: [
        { name: "Entry dossier", text: "The unwritten rules of the category in that market, with the quotes that support them." },
        { name: "Map of voices", text: "Who legitimizes, who connects and whom to watch, with a logic of relationship." },
        { name: "What to avoid", text: "Worn-out promises, tones that mark a foreigner and sensitive topics." },
        { name: "Entry brief", text: "Which code to occupy, which language to use and which voices to start with, ready for brand and communications." }
      ],
      example:
        "Illustrative example, with no data from a real client. A consumer category looked aspirational from the outside. In local communities it worked as a sign of excess, and the respected brands were the ones that talked about control and moderation. The entry shifted from prestige to trust before the first piece of communication.",
      methods: [
        { ...m.en.cc, text: "To read the local meaning of the category." },
        { ...m.en.ia, text: "To know who lends credibility and where the new comes in." }
      ],
      faq: [
        { q: "Can you read a market where you have no office?", a: "Yes. We read conversation in 16 languages across more than 20 countries in the Americas, Europe and Africa. What is needed is for the category to have public conversation in that market." },
        { q: "How long does it take?", a: "The first version arrives within days of the brief. A market with a lot of conversation, or several countries at once, takes longer, and the scope says so." },
        { q: "Does it replace a market sizing study?", a: "No. The study says how the market works and how to enter; size and expected share are calculated with other sources." }
      ]
    }
  },
  defender: {
    es: {
      situation: [
        "Estás perdiendo clientes o participación y la explicación interna es el precio. Casi nunca es solo eso. La gente se va por algo que el otro hace mejor y que tu equipo no ve desde adentro.",
        "Leemos las razones que la gente usa para irse, qué promesa del competidor se siente más creíble y qué puedes reparar primero."
      ],
      lookAt: [
        { name: "Por qué se van", text: "Las razones dichas por quien cambió de marca, en sus palabras y con su enojo." },
        { name: "Qué gana el otro", text: "Qué promesa del competidor se siente más justa, más simple o más confiable, medida con el mismo criterio que la tuya." },
        { name: "Dónde eres vulnerable", text: "Los frenos que hoy no pesan pero que un competidor podría activar." },
        { name: "Qué conservas", text: "Los motivos por los que la gente se queda, que conviene proteger antes de reaccionar." }
      ],
      receive: [
        { name: "Mapa de migración", text: "Por qué se va la gente, hacia dónde y con qué argumento, jerarquizado por peso." },
        { name: "Comparativo competitivo", text: "Tus motivos y frenos frente a los del competidor, con las mismas fuentes y el mismo periodo." },
        { name: "Lo que puedes reparar", text: "Qué frenos se pueden quitar, cuáles son estructurales y qué pieza de producto, servicio o comunicación los disuelve." },
        { name: "Brief de defensa", text: "Las acciones en orden, con responsable, indicador y riesgo." }
      ],
      example:
        "Ejemplo ilustrativo, sin datos de un cliente real. Un servicio por suscripción perdía usuarios frente a un competidor más caro. La conversación mostró que el precio pesaba poco en la decisión de irse. La gente se iba porque el otro respondía las quejas en público y explicaba sus cobros. Soporte y transparencia se habían vuelto prueba de respeto, y eso era más barato de arreglar que una promoción.",
      methods: [
        { ...m.es.tb, text: "Para separar los motivos de cambio de las quejas que no mueven a nadie." },
        { ...m.es.jfm, text: "Para ubicar el punto del recorrido donde se decide irse." },
        { ...m.es.vpm, text: "Cuando la pelea es de valor percibido frente a precio." }
      ],
      faq: [
        { q: "¿Pueden leer a mi competidor con el mismo detalle?", a: "Sí, con las mismas fuentes y el mismo periodo. Es lo que hace comparable el análisis. Leemos conversación pública; no accedemos a datos internos de nadie." },
        { q: "¿Cuánto tarda?", a: "La primera versión llega en días a partir del brief, lo que permite reaccionar dentro del mismo trimestre." },
        { q: "¿Y si la gente sí se va por precio?", a: "El estudio lo dirá, con cifras y citas. En ese caso el análisis se concentra en qué parte del valor no se está viendo y qué justificaría la diferencia." },
        { q: "¿Se puede seguir después del estudio?", a: "Sí. Muchos equipos convierten el estudio en un reporte mensual para ver si las acciones cambian la conversación." }
      ]
    },
    en: {
      situation: [
        "You are losing customers or share and the internal explanation is price. It is almost never just that. People leave for something the other brand does better and your team can't see from the inside.",
        "We read the reasons people give for leaving, which competitor promise feels more credible and what you can repair first."
      ],
      lookAt: [
        { name: "Why they leave", text: "The reasons stated by those who switched brands, in their words and with their anger." },
        { name: "What the other brand wins", text: "Which competitor promise feels fairer, simpler or more trustworthy, measured with the same criteria as yours." },
        { name: "Where you are exposed", text: "The obstacles that don't weigh today but a competitor could activate." },
        { name: "What you keep", text: "The reasons people stay, which are worth protecting before reacting." }
      ],
      receive: [
        { name: "Migration map", text: "Why people leave, where to and with what argument, ranked by weight." },
        { name: "Competitive brief", text: "Your motives and obstacles against the competitor's, with the same sources and the same period." },
        { name: "What you can repair", text: "Which obstacles can be removed, which are structural and which piece of product, service or communication dissolves them." },
        { name: "Defense brief", text: "The actions in order, with owner, indicator and risk." }
      ],
      example:
        "Illustrative example, with no data from a real client. A subscription service was losing users to a more expensive competitor. The conversation showed that price carried little weight in the decision to leave. People were leaving because the other brand answered complaints in public and explained its charges. Support and transparency had become proof of respect, and that was cheaper to fix than a promotion.",
      methods: [
        { ...m.en.tb, text: "To separate the reasons for switching from the complaints that don't move anyone." },
        { ...m.en.jfm, text: "To locate the point in the journey where people decide to leave." },
        { ...m.en.vpm, text: "When the fight is about perceived value against price." }
      ],
      faq: [
        { q: "Can you read my competitor in the same detail?", a: "Yes, with the same sources and the same period. That is what makes the analysis comparable. We read public conversation; we don't access anyone's internal data." },
        { q: "How long does it take?", a: "The first version arrives within days of the brief, which allows you to react within the same quarter." },
        { q: "What if people really do leave over price?", a: "The study will say so, with numbers and quotes. In that case the analysis focuses on which part of the value isn't being seen and what would justify the difference." },
        { q: "Can we keep going after the study?", a: "Yes. Many teams turn the study into a monthly report to see whether the actions change the conversation." }
      ]
    }
  },
  optimizar: {
    es: {
      situation: [
        "La analítica te dice dónde se cae la gente. Lo que no te dice es por qué, y sin el porqué cada mejora es una apuesta. Un descuento no arregla una duda, y un rediseño no arregla una desconfianza.",
        "Reconstruimos el recorrido como lo vive la gente, desde lo que cuenta en reseñas, foros y quejas, y ubicamos la fricción que conviene quitar primero."
      ],
      lookAt: [
        { name: "El recorrido real", text: "Las fases como las describe la gente, que no siempre coinciden con el funnel dibujado en tu equipo." },
        { name: "El tipo de fricción", text: "Inercia, esfuerzo, emoción o reactancia. Cada una pide una solución distinta." },
        { name: "Los puntos de quiebre", text: "Las fricciones que aparecen junto a un abandono explícito, separadas de las quejas que no frenan la compra." },
        { name: "Tus datos de funnel", text: "Cuando los compartes, se cruzan con la conversación para ver si lo que la gente dice coincide con lo que hace." }
      ],
      receive: [
        { name: "Mapa de fricción", text: "Tipo de fricción por fase del recorrido, con su densidad y lo que se puede mover en cada celda." },
        { name: "Puntos de quiebre", text: "Los tres a cinco momentos que más abandono causan, con evidencia y con lo que se puede hacer." },
        { name: "Ruta de mejoras", text: "Qué quitar primero, qué depende de un tercero y qué solo se puede comunicar mejor." },
        { name: "Hipótesis para probar", text: "Lo que conviene llevar a una prueba A/B, formulado para medir el efecto." }
      ],
      example:
        "Ejemplo ilustrativo, sin datos de un cliente real. Una tienda en línea asumía que el abandono en el pago era por el costo de envío. La conversación mostró que la gente llegaba al pago sin saber si podía devolver el producto y cómo. La fricción era de riesgo y de emoción; la solución estaba en la página del producto, varios pasos antes del pago.",
      methods: [
        { ...m.es.jfm, text: "Para ubicar y clasificar la fricción en cada fase." },
        { ...m.es.dv, text: "Cuando la pregunta es por qué la decisión se vuelve lenta." }
      ],
      faq: [
        { q: "¿Necesito compartir mis datos de analítica?", a: "No es obligatorio. El estudio se hace sobre conversación pública. Si compartes datos de funnel, el análisis gana precisión al cruzar lo dicho con lo hecho." },
        { q: "¿Cuánto tarda?", a: "La primera versión llega en días a partir del brief. Si el recorrido cruza varios canales o países, el alcance ajusta el tiempo." },
        { q: "¿Me dicen cuánto va a mejorar la conversión?", a: "No. El estudio da prioridades y las hipótesis más fuertes. El efecto en porcentaje se mide después, con un experimento, y el estudio dice cuál correr primero." }
      ]
    },
    en: {
      situation: [
        "Analytics tells you where people drop off. What it doesn't tell you is why, and without the why every improvement is a bet. A discount doesn't fix a doubt, and a redesign doesn't fix distrust.",
        "We reconstruct the journey as people live it, from what they tell in reviews, forums and complaints, and locate the friction worth removing first."
      ],
      lookAt: [
        { name: "The real journey", text: "The phases as people describe them, which don't always match the funnel drawn by your team." },
        { name: "The type of friction", text: "Inertia, effort, emotion or reactance. Each one calls for a different fix." },
        { name: "The break points", text: "The frictions that appear next to an explicit abandonment, separated from the complaints that don't stop the purchase." },
        { name: "Your funnel data", text: "When you share it, it is crossed with the conversation to see whether what people say matches what they do." }
      ],
      receive: [
        { name: "Friction map", text: "Type of friction by phase of the journey, with its density and what can be moved in each cell." },
        { name: "Break points", text: "The three to five moments that cause the most abandonment, with evidence and what can be done." },
        { name: "Improvement roadmap", text: "What to remove first, what depends on a third party and what can only be communicated better." },
        { name: "Hypotheses to test", text: "What is worth taking to an A/B test, phrased to measure the effect." }
      ],
      example:
        "Illustrative example, with no data from a real client. An online store assumed that checkout abandonment was about shipping cost. The conversation showed that people reached checkout without knowing whether they could return the product and how. The friction was about risk and emotion; the fix was on the product page, several steps before checkout.",
      methods: [
        { ...m.en.jfm, text: "To locate and classify the friction in each phase." },
        { ...m.en.dv, text: "When the question is why the decision turns slow." }
      ],
      faq: [
        { q: "Do I need to share my analytics data?", a: "It isn't required. The study is done on public conversation. If you share funnel data, the analysis gains precision by crossing what is said with what is done." },
        { q: "How long does it take?", a: "The first version arrives within days of the brief. If the journey spans several channels or countries, the scope adjusts the timing." },
        { q: "Will you tell me how much conversion will improve?", a: "No. The study gives priorities and the strongest hypotheses. The effect in percentage terms is measured afterwards, with an experiment, and the study says which one to run first." }
      ]
    }
  },
  innovar: {
    es: {
      situation: [
        "Necesitas producto nuevo, o una extensión, y el riesgo es construir una función que nadie pidió o resolver un deseo bonito que no mueve una compra.",
        "Leemos lo que la gente ya intenta resolver mal con lo que existe: los arreglos caseros, las quejas repetidas, las comparaciones entre categorías. Ahí suele estar la necesidad que sigue abierta."
      ],
      lookAt: [
        { name: "Lo que la gente arregla por su cuenta", text: "Soluciones improvisadas, productos usados para otra cosa y rutinas que compensan lo que falta." },
        { name: "Las quejas que se repiten sin respuesta", text: "Lo que molesta en toda la categoría y ninguna marca ha resuelto." },
        { name: "El valor que nadie ocupa", text: "Qué dimensión de valor, dinero, tiempo, esfuerzo o riesgo, está libre en la categoría." },
        { name: "Lo que frena probar algo nuevo", text: "Las barreras que una innovación tendría que disolver para que la gente la adopte." }
      ],
      receive: [
        { name: "Mapa de necesidades", text: "Lo que sigue sin resolverse, jerarquizado por tamaño, intensidad y relación con una compra." },
        { name: "Espacios de oportunidad", text: "Dónde hay lugar para algo nuevo y qué tendría que prometer." },
        { name: "Rutas de concepto", text: "Direcciones de producto con la evidencia que las sostiene y los frenos que tendrían que resolver." },
        { name: "Preguntas para validar", text: "Lo que una prueba cuantitativa de concepto debería medir después." }
      ],
      example:
        "Ejemplo ilustrativo, sin datos de un cliente real. Una marca de cuidado personal buscaba una función nueva. La conversación mostró que la oportunidad era otra: la gente tenía miedo de empeorar su piel probando algo distinto, y ninguna marca comunicaba la reducción de ese riesgo como valor. El concepto cambió de ingrediente a garantía.",
      methods: [
        { ...m.es.tb, text: "Para separar deseos bonitos de necesidades que mueven una compra." },
        { ...m.es.vpm, text: "Para encontrar la dimensión de valor que nadie ocupa." }
      ],
      faq: [
        { q: "¿Esto reemplaza la investigación cualitativa con usuarios?", a: "No. La complementa. La conversación muestra lo que la gente dice espontáneamente y a escala; las entrevistas van más a fondo en lo que la conversación señala." },
        { q: "¿Pueden leer categorías adyacentes?", a: "Sí. Muchas necesidades se ven mejor en la categoría vecina, donde la gente ya resolvió algo parecido." },
        { q: "¿Qué tan segura es la oportunidad que encuentran?", a: "Cada hallazgo dice si es medido, direccional o cualitativo. El estudio entrega hipótesis fuertes y las preguntas para validarlas; la validación cuantitativa es el paso siguiente." }
      ]
    },
    en: {
      situation: [
        "You need a new product, or an extension, and the risk is building a feature nobody asked for or solving a nice wish that doesn't move a purchase.",
        "We read what people already try to solve badly with what exists: the homemade fixes, the repeated complaints, the comparisons across categories. That is usually where the still-open need lives."
      ],
      lookAt: [
        { name: "What people fix on their own", text: "Improvised solutions, products used for something else and routines that make up for what is missing." },
        { name: "Complaints that repeat without an answer", text: "What bothers people across the whole category and no brand has solved." },
        { name: "The value nobody occupies", text: "Which dimension of value, money, time, effort or risk, is open in the category." },
        { name: "What holds back trying something new", text: "The barriers an innovation would have to dissolve for people to adopt it." }
      ],
      receive: [
        { name: "Needs map", text: "What remains unsolved, ranked by size, intensity and link to a purchase." },
        { name: "Opportunity spaces", text: "Where there is room for something new and what it would have to promise." },
        { name: "Concept routes", text: "Product directions with the evidence that supports them and the obstacles they would have to solve." },
        { name: "Questions to validate", text: "What a quantitative concept test should measure afterwards." }
      ],
      example:
        "Illustrative example, with no data from a real client. A personal care brand was looking for a new feature. The conversation showed the opportunity was elsewhere: people were afraid of making their skin worse by trying something different, and no brand was communicating the reduction of that risk as value. The concept shifted from ingredient to guarantee.",
      methods: [
        { ...m.en.tb, text: "To separate nice wishes from needs that move a purchase." },
        { ...m.en.vpm, text: "To find the dimension of value nobody occupies." }
      ],
      faq: [
        { q: "Does this replace qualitative research with users?", a: "No. It complements it. Conversation shows what people say spontaneously and at scale; interviews go deeper into what the conversation points to." },
        { q: "Can you read adjacent categories?", a: "Yes. Many needs are easier to see in the neighboring category, where people have already solved something similar." },
        { q: "How certain is the opportunity you find?", a: "Every finding says whether it is measured, directional or qualitative. The study delivers strong hypotheses and the questions to validate them; quantitative validation is the next step." }
      ]
    }
  },
  planear: {
    es: {
      situation: [
        "Tu año tiene fechas que ya conoces: lanzamientos, campañas, temporadas, la revisión de presupuesto. Cada una trae una decisión, y la investigación suele llegar tarde o no llegar.",
        "Un plan anual coloca los estudios antes de cada decisión y mantiene un análisis continuo entre ellos, de modo que la respuesta ya exista cuando la reunión llegue."
      ],
      lookAt: [
        { name: "Tu calendario de decisiones", text: "Qué vas a decidir, cuándo y qué pregunta hay que tener respondida antes." },
        { name: "Lo que se repite y lo que cambia", text: "Qué conviene seguir cada mes y qué pide un estudio aparte." },
        { name: "Una base común", text: "Los mismos temas, fuentes y criterios durante el año, para que los estudios se puedan comparar entre sí." },
        { name: "Lo que aparece sin avisar", text: "Espacio en el plan para una pregunta urgente que no estaba en el calendario." }
      ],
      receive: [
        { name: "Plan de estudios del año", text: "Cada estudio con su pregunta, su método, sus fuentes y su fecha de entrega, colocado antes de la decisión que alimenta." },
        { name: "Reporte continuo entre estudios", text: "El análisis mensual que mantiene los temas vivos y detecta lo que cambia." },
        { name: "Un espacio de marca permanente", text: "Temas, correcciones y evidencia que se acumulan durante el año, sin empezar de cero en cada estudio." },
        { name: "Un Intelligence Architect asignado", text: "La misma persona durante el año, que conoce tu categoría y responde por cada análisis." }
      ],
      example:
        "Ejemplo ilustrativo, sin datos de un cliente real. Una marca con dos lanzamientos y una temporada fuerte al año recibía la investigación después de cerrar los briefs. Con el plan, el estudio de territorio llegó antes del brief de campaña, el reporte mensual mostró cuándo empezó a moverse la conversación de temporada y el estudio de defensa se programó para el mes en que el competidor solía lanzar.",
      methods: [
        { ...m.es.tb, text: "Suele ser la base del análisis continuo." },
        { ...m.es.cc, text: "Antes de los lanzamientos y las campañas grandes." },
        { ...m.es.jfm, text: "Cuando una fecha del año depende de que el recorrido funcione." }
      ],
      faq: [
        { q: "¿Qué pasa si cambian mis fechas?", a: "El plan se mueve con ellas. Lo que se acuerda es un número de estudios y un análisis continuo, y el calendario se ajusta cada trimestre." },
        { q: "¿Es más barato que contratar estudio por estudio?", a: "La base de temas y fuentes se construye una vez y se reutiliza, así que cada estudio pide menos trabajo de arranque. El alcance lo muestra por escrito." },
        { q: "¿Puedo empezar con un estudio y pasar al plan después?", a: "Sí. Es la forma más común de llegar al plan anual." },
        { q: "¿Qué recibo entre estudios?", a: "El reporte mensual: qué se movió, por qué y qué vigilar, con los mismos temas que alimentan los estudios." }
      ]
    },
    en: {
      situation: [
        "Your year has dates you already know: launches, campaigns, seasons, the budget review. Each one brings a decision, and research usually arrives late or not at all.",
        "An annual plan places the studies before each decision and keeps a continuous analysis between them, so the answer already exists when the meeting comes."
      ],
      lookAt: [
        { name: "Your calendar of decisions", text: "What you are going to decide, when, and which question needs to be answered beforehand." },
        { name: "What repeats and what changes", text: "What is worth tracking every month and what calls for a separate study." },
        { name: "A common base", text: "The same topics, sources and criteria throughout the year, so the studies can be compared with each other." },
        { name: "What shows up unannounced", text: "Room in the plan for an urgent question that wasn't on the calendar." }
      ],
      receive: [
        { name: "The year's plan of studies", text: "Each study with its question, method, sources and delivery date, placed before the decision it feeds." },
        { name: "Continuous report between studies", text: "The monthly analysis that keeps the topics alive and detects what changes." },
        { name: "A permanent brand space", text: "Topics, corrections and evidence that accumulate throughout the year, without starting from scratch with each study." },
        { name: "An assigned Intelligence Architect", text: "The same person throughout the year, who knows your category and answers for every analysis." }
      ],
      example:
        "Illustrative example, with no data from a real client. A brand with two launches and one strong season a year used to receive research after the briefs were closed. With the plan, the territory study arrived before the campaign brief, the monthly report showed when the seasonal conversation started to move, and the defense study was scheduled for the month when the competitor usually launched.",
      methods: [
        { ...m.en.tb, text: "Usually the base of the continuous analysis." },
        { ...m.en.cc, text: "Before launches and big campaigns." },
        { ...m.en.jfm, text: "When a date in the year depends on the journey working." }
      ],
      faq: [
        { q: "What if my dates change?", a: "The plan moves with them. What is agreed is a number of studies and a continuous analysis, and the calendar is adjusted every quarter." },
        { q: "Is it cheaper than hiring study by study?", a: "The base of topics and sources is built once and reused, so each study needs less start-up work. The scope shows it in writing." },
        { q: "Can I start with one study and move to the plan later?", a: "Yes. It is the most common way to get to the annual plan." },
        { q: "What do I receive between studies?", a: "The monthly report: what moved, why and what to watch, with the same topics that feed the studies." }
      ]
    }
  }
};

export const solutionEntries: Entry[] = moments.map((mo) => {
  const c = copy[mo.slug.es];
  return {
    slug: mo.slug,
    summary: { es: mo.es.summary, en: mo.en.summary },
    page: {
      es: { metaTitle: mo.es.name, metaDescription: mo.es.summary, title: mo.es.question, lead: mo.es.summary, blocks: c ? momentBlocks(c.es, "es") : [] },
      en: { metaTitle: mo.en.name, metaDescription: mo.en.summary, title: mo.en.question, lead: mo.en.summary, blocks: c ? momentBlocks(c.en, "en") : [] }
    }
  };
});
