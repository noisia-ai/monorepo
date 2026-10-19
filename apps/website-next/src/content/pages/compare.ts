import type { ApproachCopy } from "@/motion/ApproachComposition";
import type { LearnSurveyCopy } from "@/motion/LearnSurveyComposition";
import type { FaqIcon } from "@/components/ui/faq-icons";
import type { Localized } from "./types";

/**
 * Comparisons: Noisia next to a social listening tool, a generic AI, a survey and an agency.
 * Each page answers the question as people search it, shows both readings animated side by side,
 * compares point by point and says honestly when the other option is the better one.
 * No brands or vendors are named.
 */

export type CompareKind = "listening" | "ai" | "survey" | "agency";

export type CompareCopy = {
  metaTitle: string;
  metaDescription: string;
  /** The question as people search it (H1). */
  title: string;
  /** The direct answer, in two or three sentences. */
  lead: string;
  /** Short name of the other option, for tabs and column heads. */
  them: string;
  /** What you walk away with, under each animation. */
  takeaway: { them: string; us: string };
  criteria: { name: string; them: string; us: string }[];
  when: { them: { name: string; text: string }; us: { name: string; text: string }; both: { name: string; text: string } };
  faq: { q: string; a: string; icon: FaqIcon }[];
};

export type CompareEntry = {
  slug: { es: string; en: string };
  kind: CompareKind;
  summary: Localized<string>;
  page: Localized<CompareCopy>;
};

/** Interface copy shared by the index and the detail pages. */
export const compareUi = {
  es: {
    metaTitle: "Noisia vs. listening, IA, encuestas y agencias",
    metaDescription:
      "Comparamos Noisia con una herramienta de social listening, una IA generativa, una encuesta y una agencia. Qué hace bien cada una y cuándo te conviene.",
    title: "¿Una herramienta, una IA, una encuesta o una agencia?",
    lead: "Las cuatro sirven para algo. Aquí comparamos cada una con Noisia, con el mismo criterio, y decimos cuándo te conviene la otra opción.",
    glanceTitle: "Lo que responde cada una",
    glanceLead: "La misma pregunta de negocio, cinco maneras de responderla.",
    glance: { us: "Por qué pasa algo y qué puedes hacer, con evidencia", listening: "Cuánto se habla y con qué tono", ai: "Una opinión rápida sobre lo que alcanza a leer", survey: "Cuántas personas piensan algo", agency: "Una buena lectura de una parte de la conversación" },
    names: { listening: "Herramienta de social listening", ai: "IA generativa", survey: "Encuesta", agency: "Agencia o instituto" },
    open: "Ver la comparación",
    usName: "Noisia",
    motionLabel: "Elige qué lectura ver",
    criteriaTitle: "Punto por punto",
    criteriaLead: "Los mismos criterios para las dos opciones.",
    criterion: "Criterio",
    whenTitle: "Cuándo conviene cada una",
    faqTitle: "Preguntas frecuentes",
    others: "Otras comparaciones",
    indexFaq: [
      { q: "¿Cómo están hechas estas comparaciones?", a: "Cada página empieza con la respuesta corta, usa los mismos criterios para las dos opciones y cierra con los casos en que conviene cada una.", icon: "check" },
      { q: "¿Nombran marcas o proveedores?", a: "No. Comparamos tipos de opción. Cada herramienta, modelo o agencia es distinta, y lo que importa es si responde tu pregunta.", icon: "eye" },
      { q: "¿Y si mi caso no aparece aquí?", a: "Para eso sirve el taller gratis. En 30 a 60 minutos vemos si la conversación responde tu pregunta o si te conviene otra herramienta.", icon: "question" }
    ] as { q: string; a: string; icon: FaqIcon }[],
    ctaTitle: "Trae tu pregunta",
    ctaText: "En un taller gratis de 30 a 60 minutos vemos qué opción te conviene, aunque no sea la nuestra.",
    ctaLabel: "Agenda un taller gratis"
  },
  en: {
    metaTitle: "Noisia vs. listening, AI, surveys and agencies",
    metaDescription:
      "We compare Noisia with a social listening tool, generative AI, a survey and an agency. What each one does well and when it is the right call for you.",
    title: "A tool, an AI, a survey or an agency?",
    lead: "All four are good for something. Here we compare each one with Noisia, under the same criteria, and say when the other option suits you better.",
    glanceTitle: "What each one answers",
    glanceLead: "The same business question, five ways to answer it.",
    glance: { us: "Why something is happening and what you can do, with evidence", listening: "How much people talk and in what tone", ai: "A quick opinion on what it manages to read", survey: "How many people think something", agency: "A good reading of part of the conversation" },
    names: { listening: "Social listening tool", ai: "Generative AI", survey: "Survey", agency: "Agency or research firm" },
    open: "See the comparison",
    usName: "Noisia",
    motionLabel: "Choose which reading to see",
    criteriaTitle: "Point by point",
    criteriaLead: "The same criteria for both options.",
    criterion: "Criterion",
    whenTitle: "When each one makes sense",
    faqTitle: "Frequently asked questions",
    others: "Other comparisons",
    indexFaq: [
      { q: "How are these comparisons made?", a: "Each page opens with the short answer, uses the same criteria for both options and closes with the cases where each one makes sense.", icon: "check" },
      { q: "Do you name brands or vendors?", a: "No. We compare types of option. Every tool, model or agency is different, and what matters is whether it answers your question.", icon: "eye" },
      { q: "What if my case isn't here?", a: "That is what the free workshop is for. In 30 to 60 minutes we look at whether the conversation answers your question or whether another tool fits better.", icon: "question" }
    ] as { q: string; a: string; icon: FaqIcon }[],
    ctaTitle: "Bring your question",
    ctaText: "In a free 30 to 60 minute workshop we look at which option fits you, even if it isn't ours.",
    ctaLabel: "Book a free workshop"
  }
};

/** One example conversation for every comparison animation (illustrative, not a case). */
export const compareMotion: Localized<ApproachCopy> = {
  es: {
    clusters: ["Cobertura", "Precio", "Atención", "Antigüedad", "Promociones"],
    noise: "Ruido",
    approved: "Intelligence Architect",
    answerLabel: "La respuesta",
    answer: "Los clientes de años sienten que las promociones son solo para los nuevos",
    quote: "Llevo ocho años con ellos y al que llega le dan el doble de datos",
    reasons: ["Sentirse poco valorado", "Compararse con el nuevo", "Irse ya es fácil"],
    action: "Darle al cliente de años lo mismo que al que llega",
    mentions: "menciones",
    sentiment: ["Positivo", "Neutral", "Negativo"],
    why: "¿Y por qué?",
    aiRead: "Lo que alcanza a leer",
    aiAgain: "Otra vez, otra respuesta",
    week: "Semana",
    sample: "Leído a mano"
  },
  en: {
    clusters: ["Coverage", "Price", "Service", "Tenure", "Promotions"],
    noise: "Noise",
    approved: "Intelligence Architect",
    answerLabel: "The answer",
    answer: "Long-time customers feel the deals are only for new ones",
    quote: "Eight years with them and new customers get twice the data",
    reasons: ["Feeling undervalued", "Comparing with newcomers", "Leaving is easy now"],
    action: "Give long-time customers what new ones get",
    mentions: "mentions",
    sentiment: ["Positive", "Neutral", "Negative"],
    why: "And why?",
    aiRead: "What it manages to read",
    aiAgain: "Ask again, new answer",
    week: "Week",
    sample: "Read by hand"
  }
};

export const surveyMotion: Localized<LearnSurveyCopy> = {
  es: {
    label: "Encuesta",
    question: "¿Por qué elegiste tu compañía de celular?",
    options: ["Precio", "Cobertura", "Promociones", "Otro"],
    values: [41, 28, 19, 12],
    respondents: "Respuestas de la muestra",
    why: "¿Y por qué?",
    unasked: "¿Qué hay en «Otro»?"
  },
  en: {
    label: "Survey",
    question: "Why did you choose your mobile carrier?",
    options: ["Price", "Coverage", "Promotions", "Other"],
    values: [41, 28, 19, 12],
    respondents: "Answers from the sample",
    why: "And why?",
    unasked: "What's inside “Other”?"
  }
};

const faqUsEs = { q: "¿Qué es Noisia, entonces?", a: "Una empresa de tecnología que produce investigación. Nuestro software lee la conversación completa y un Intelligence Architect define la pregunta, aprueba los temas e interpreta. Lo que recibes es un reporte o un estudio, con alguien que responde por el análisis.", icon: "system" as FaqIcon };
const faqUsEn = { q: "So what is Noisia?", a: "A technology company that produces research. Our software reads the whole conversation, and an Intelligence Architect defines the question, approves the topics and interprets. What you receive is a report or a study, with someone who answers for the analysis.", icon: "system" as FaqIcon };

export const compareEntries: CompareEntry[] = [
  {
    slug: { es: "herramientas-de-social-listening", en: "social-listening-tools" },
    kind: "listening",
    summary: {
      es: "Una herramienta vigila volumen y alertas, pero alguien tiene que leerla. Cuándo te basta y cuándo te conviene Noisia.",
      en: "A tool watches volume and alerts, but someone still has to read it. When it is enough and when Noisia fits better."
    },
    page: {
      es: {
        metaTitle: "Social listening vs. inteligencia social",
        metaDescription:
          "Una herramienta de social listening mide menciones y sentimiento en un dashboard. Noisia parte de tu pregunta y te entrega la respuesta con evidencia.",
        title: "¿Herramienta de social listening o inteligencia social?",
        lead: "La herramienta te muestra cuánto se habla de tu marca, con qué tono y cuándo hay un pico, y alguien de tu equipo tiene que leerla y decidir. Noisia parte de tu pregunta, lee la conversación completa y te entrega la respuesta con las menciones que la sostienen.",
        them: "Social listening",
        takeaway: { them: "Un dashboard con volumen y sentimiento", us: "La respuesta, con su evidencia" },
        criteria: [
          { name: "Punto de partida", them: "Palabras y marcas que alguien configura", us: "Una pregunta de negocio, traducida a preguntas investigables" },
          { name: "Qué entrega", them: "Dashboard con volumen, sentimiento, alertas y exportaciones", us: "Un reporte o un estudio con hallazgos, evidencia y recomendaciones" },
          { name: "Temas", them: "Categorías definidas de antemano o resúmenes automáticos", us: "Descubiertos desde lo que dice la gente y aprobados por una persona" },
          { name: "Ruido", them: "Llega al dashboard como viene y se filtra a mano", us: "Prensa, contenido de marca, reventa y spam fuera, con criterio documentado" },
          { name: "Quién interpreta", them: "Tu equipo, con el tiempo que tenga", us: "Un Intelligence Architect, con un método" },
          { name: "Tus datos propios", them: "Fuera del dashboard, salvo integraciones", us: "NPS, encuestas y búsquedas leídos con los mismos temas" },
          { name: "Evidencia", them: "Menciones sueltas al alcance de un clic", us: "Cada cifra con su cálculo y cada cita verificada contra su fuente" },
          { name: "Para vigilar", them: "Inmediata, con alertas", us: "Reportes semanales, quincenales o mensuales, según lo que necesites" },
          { name: "Para decidir", them: "Depende de cuándo alguien lea y analice", us: "Días desde el brief hasta la primera respuesta" },
          { name: "Costo", them: "Licencia anual más el tiempo de tu equipo", us: "Por reporte, estudio o plan anual, definido en el alcance" }
        ],
        when: {
          them: { name: "Conviene la herramienta", text: "Para vigilar menciones todos los días, recibir alertas de un pico o de una crisis en curso, atender comentarios desde un solo lugar o medir el alcance de una campaña mientras corre. Es trabajo de monitoreo y una buena herramienta lo hace bien." },
          us: { name: "Conviene Noisia", text: "Cuando tienes una decisión por tomar y necesitas saber por qué pasa algo, qué pesa y qué puedes mover. Cuando nadie en tu equipo tiene tiempo de leer el dashboard, o la cifra tiene que resistir una pregunta de dirección." },
          both: { name: "Convienen las dos", text: "Muchos equipos conservan su herramienta para vigilar y reciben de Noisia el reporte continuo o los estudios. Podemos leer las exportaciones de tu herramienta y sumarlas al análisis." }
        },
        faq: [
          faqUsEs,
          { q: "¿Tengo que dejar mi herramienta?", a: "No. Puedes conservarla para monitoreo y atención. Nosotros podemos leer sus exportaciones y sumarlas a otras fuentes.", icon: "data" },
          { q: "¿Las herramientas no tienen ya resúmenes con IA?", a: "Varias los tienen y sirven para un vistazo rápido. Suelen trabajar sobre una muestra de menciones, sin limpiar el ruido antes y sin una persona que apruebe los temas. Alcanzan para vigilar, pero una decisión importante pide un análisis completo que puedas revisar.", icon: "signals" },
          { q: "¿Qué pasa con una crisis?", a: "La herramienta te avisa y te deja responder al momento. Noisia te dice qué la alimenta, qué voces la mueven entre comunidades y qué narrativa conviene, con un análisis en días. Son trabajos distintos y se complementan.", icon: "campaigns" }
        ]
      },
      en: {
        metaTitle: "Social listening tool vs. social intelligence",
        metaDescription:
          "A social listening tool tracks mentions and sentiment on a dashboard. Noisia starts from your question and hands you the answer, backed by evidence.",
        title: "Social listening tool or social intelligence?",
        lead: "The tool shows you how much people talk about your brand, in what tone and when there is a spike, and someone on your team has to read it and decide. Noisia starts from your question, reads the whole conversation and hands you the answer with the mentions that back it up.",
        them: "Social listening",
        takeaway: { them: "A dashboard with volume and sentiment", us: "The answer, with its evidence" },
        criteria: [
          { name: "Starting point", them: "Keywords and brands someone configures", us: "A business question, translated into researchable questions" },
          { name: "What it delivers", them: "Dashboard with volume, sentiment, alerts and exports", us: "A report or a study with findings, evidence and recommendations" },
          { name: "Topics", them: "Categories set in advance or automatic summaries", us: "Discovered from what people say and approved by a person" },
          { name: "Noise", them: "Reaches the dashboard as is and is filtered by hand", us: "Press, brand content, resale and spam out, with documented criteria" },
          { name: "Who interprets", them: "Your team, with whatever time it has", us: "An Intelligence Architect, with a method" },
          { name: "Your own data", them: "Outside the dashboard, unless integrated", us: "NPS, surveys and search read with the same topics" },
          { name: "Evidence", them: "Loose mentions one click away", us: "Every number with its calculation and every quote checked against its source" },
          { name: "For watching", them: "Immediate, with alerts", us: "Weekly, biweekly or monthly reports, as you need" },
          { name: "For deciding", them: "Depends on when someone reads and analyzes", us: "Days from brief to first answer" },
          { name: "Cost", them: "Annual license plus your team's time", us: "Per report, study or annual plan, defined in the scope" }
        ],
        when: {
          them: { name: "The tool makes sense", text: "To watch mentions every day, get alerts for a spike or an ongoing crisis, handle comments from one place or measure a campaign's reach while it runs. That is monitoring work, and a good tool does it well." },
          us: { name: "Noisia makes sense", text: "When you have a decision to make and need to know why something is happening, what weighs and what you can move. When nobody on your team has time to read the dashboard, or the number has to survive a question from leadership." },
          both: { name: "Both make sense", text: "Many teams keep their tool for watching and receive the ongoing report or the studies from Noisia. We can read your tool's exports and add them to the analysis." }
        },
        faq: [
          faqUsEn,
          { q: "Do I have to drop my tool?", a: "No. You can keep it for monitoring and community management. We can read its exports and add them to other sources.", icon: "data" },
          { q: "Don't tools already have AI summaries?", a: "Several do, and they are useful for a quick look. They usually work on a sample of mentions, without cleaning the noise first and without a person approving the topics. They are fine for watching, but a big decision calls for a complete analysis you can check.", icon: "signals" },
          { q: "What about a crisis?", a: "The tool alerts you and lets you respond in the moment. Noisia tells you what feeds it, which voices move it between communities and which narrative makes sense, with an analysis in days. They are different jobs and they complement each other.", icon: "campaigns" }
        ]
      }
    }
  },
  {
    slug: { es: "ia-generativa", en: "generative-ai" },
    kind: "ai",
    summary: {
      es: "Pasarle tus menciones a una IA es rápido y barato con pocas menciones. Dónde se queda corto y cuándo alcanza.",
      en: "Feeding your mentions to an AI is fast and cheap with a few mentions. Where it falls short and when it is enough."
    },
    page: {
      es: {
        metaTitle: "¿Basta con analizar tus menciones con IA?",
        metaDescription:
          "Una IA generativa resume rápido, pero con muchas menciones muestrea, cuenta mal y puede inventar citas. Cuándo te alcanza y cuándo necesitas algo más.",
        title: "¿Por qué no basta con pasarle tus menciones a una IA?",
        lead: "Una IA generativa resume lo que alcanza a leer. Con unos cientos de comentarios y una pregunta puntual, un buen analista con una IA hace un trabajo decente. Con decenas de miles de menciones, la IA muestrea, cuenta mal, puede parafrasear una cita y responde distinto en cada corrida. Noisia usa modelos de lenguaje como una pieza más, con la conversación completa, cifras calculadas, citas verificadas y una persona que aprueba.",
        them: "IA generativa",
        takeaway: { them: "Un resumen que cambia cada vez", us: "La respuesta, con su evidencia" },
        criteria: [
          { name: "Cuánto lee", them: "Lo que cabe en su ventana. Más allá, muestrea o resume por partes", us: "La conversación completa, con los temas descubiertos sobre todo el conjunto" },
          { name: "Cómo cuenta", them: "Estima. Los modelos de lenguaje no cuentan de forma confiable", us: "Cada cifra sale de una consulta sobre la conversación completa" },
          { name: "Las citas", them: "Puede parafrasearlas o inventarlas", us: "Literales, recortadas del texto original y verificadas contra la fuente" },
          { name: "El ruido", them: "Toma el archivo como viene", us: "Prensa, contenido de marca, reventa y spam fuera, con criterio documentado" },
          { name: "Repetir el resultado", them: "Otra corrida, otro resumen", us: "La misma conversación da los mismos temas, con versiones guardadas" },
          { name: "El periodo siguiente", them: "Empieza de cero", us: "Compara contra los temas ya aprobados" },
          { name: "Correcciones", them: "Se olvidan en la siguiente sesión", us: "La corrección de la persona se conserva" },
          { name: "Tus datos propios", them: "Si alguien los arma a mano", us: "NPS, encuestas y búsquedas en el mismo análisis" },
          { name: "Qué preguntar", them: "Responde lo que le pidas", us: "Traduce tu brief en preguntas investigables y prueba tus hipótesis" },
          { name: "Cuánto confiar", them: "Todo suena igual de seguro", us: "Cada hallazgo dice si es medido, direccional o cualitativo" }
        ],
        when: {
          them: { name: "Conviene la IA", text: "Cuando tienes unos cientos o pocos miles de comentarios, una pregunta puntual y alguien con criterio que revise el resultado. Para un primer vistazo, para redactar o para ordenar ideas es rápida y barata. Nosotros también la usamos para interpretar y escribir." },
          us: { name: "Conviene Noisia", text: "Cuando la conversación es grande, la decisión importa y la cifra tiene que resistir preguntas. Cuando necesitas comparar un periodo contra otro con los mismos temas, o una cita equivocada en una presentación te cuesta credibilidad." },
          both: { name: "Convienen las dos", text: "Un modelo de lenguaje es una de las piezas de nuestro software. Alrededor de él leemos la conversación completa, la limpiamos, calculamos las cifras fuera del modelo, verificamos las citas y una persona aprueba." }
        },
        faq: [
          { q: "¿Noisia usa inteligencia artificial?", a: "Sí. Modelos de lenguaje y técnicas de agrupamiento leen, agrupan y clasifican la conversación. Las cifras salen de cálculos sobre la conversación completa, las citas se verifican contra su fuente y un Intelligence Architect aprueba los temas e interpreta.", icon: "system" },
          { q: "¿No puedo hacer lo mismo con un buen prompt?", a: "Con pocas menciones, en buena medida sí. Con muchas, el modelo muestrea o resume por partes, y ningún prompt lo convierte en una calculadora confiable ni le da memoria entre sesiones.", icon: "edit" },
          { q: "¿Por qué importa que el resultado se pueda repetir?", a: "Porque un reporte continuo compara contra el anterior. Si los temas cambian de nombre y de tamaño en cada corrida, no hay forma de saber qué se movió de verdad.", icon: "time" },
          { q: "¿Qué pasa con las citas?", a: "Un modelo puede resumir o parafrasear una cita y presentarla como literal. En Noisia cada cita se recorta del texto original y se verifica antes de entrar al reporte, con su fuente y su fecha.", icon: "document" }
        ]
      },
      en: {
        metaTitle: "Why analyzing your mentions with AI isn't enough",
        metaDescription:
          "Generative AI summarizes fast, but with many mentions it samples, miscounts and can make up quotes. When it is enough and when you need something more.",
        title: "Why isn't feeding your mentions to an AI enough?",
        lead: "Generative AI summarizes what it manages to read. With a few hundred comments and a focused question, a good analyst with an AI does a decent job. With tens of thousands of mentions, the AI samples, miscounts, can paraphrase a quote and answers differently on every run. Noisia uses language models as one more piece, with the whole conversation, calculated numbers, verified quotes and a person who approves.",
        them: "Generative AI",
        takeaway: { them: "A summary that changes every time", us: "The answer, with its evidence" },
        criteria: [
          { name: "How much it reads", them: "What fits in its window. Beyond that, it samples or summarizes in pieces", us: "The whole conversation, with topics discovered across all of it" },
          { name: "How it counts", them: "It estimates. Language models don't count reliably", us: "Every number comes from a query over the whole conversation" },
          { name: "Quotes", them: "Can paraphrase or make them up", us: "Verbatim, cut from the original text and checked against the source" },
          { name: "Noise", them: "Takes the file as it comes", us: "Press, brand content, resale and spam out, with documented criteria" },
          { name: "Repeating the result", them: "Another run, another summary", us: "The same conversation gives the same topics, with saved versions" },
          { name: "The next period", them: "Starts from scratch", us: "Compares against the topics already approved" },
          { name: "Corrections", them: "Forgotten in the next session", us: "The person's correction is kept" },
          { name: "Your own data", them: "If someone wires it up by hand", us: "NPS, surveys and search in the same analysis" },
          { name: "What to ask", them: "Answers whatever you ask", us: "Translates your brief into researchable questions and tests your hypotheses" },
          { name: "How much to trust", them: "Everything sounds equally certain", us: "Every finding says whether it is measured, directional or qualitative" }
        ],
        when: {
          them: { name: "The AI makes sense", text: "When you have a few hundred or a few thousand comments, a focused question and someone with judgment to review the result. For a first look, for drafting or for organizing ideas it is fast and cheap. We use it for interpreting and writing too." },
          us: { name: "Noisia makes sense", text: "When the conversation is large, the decision matters and the number has to survive questions. When you need to compare one period against another with the same topics, or a wrong quote in a presentation costs you credibility." },
          both: { name: "Both make sense", text: "A language model is one of the pieces of our software. Around it, we read the whole conversation, clean it, calculate numbers outside the model, check every quote and have a person approve." }
        },
        faq: [
          { q: "Does Noisia use artificial intelligence?", a: "Yes. Language models and clustering techniques read, group and classify the conversation. Numbers come from calculations over the whole conversation, quotes are checked against their source and an Intelligence Architect approves the topics and interprets.", icon: "system" },
          { q: "Can't I do the same with a good prompt?", a: "With a few mentions, largely yes. With many, the model samples or summarizes in pieces, and no prompt turns it into a reliable calculator or gives it memory between sessions.", icon: "edit" },
          { q: "Why does it matter that the result can be repeated?", a: "Because an ongoing report compares against the previous one. If topics change name and size on every run, there is no way to know what really moved.", icon: "time" },
          { q: "What about the quotes?", a: "A model can summarize or paraphrase a quote and present it as verbatim. At Noisia every quote is cut from the original text and checked before it enters the report, with its source and date.", icon: "document" }
        ]
      }
    }
  },
  {
    slug: { es: "encuestas", en: "surveys" },
    kind: "survey",
    summary: {
      es: "La encuesta mide cuántos. La conversación muestra por qué y con qué palabras. Cómo se complementan.",
      en: "A survey measures how many. Conversation shows why and in what words. How they complement each other."
    },
    page: {
      es: {
        metaTitle: "Encuestas vs. conversación en redes sociales",
        metaDescription:
          "Una encuesta mide cuántos piensan algo. La conversación en redes muestra por qué, en palabras de la gente. Cuándo conviene cada una y cómo leerlas juntas.",
        title: "¿Encuesta o conversación?",
        lead: "Las dos. Una encuesta mide cuántas personas de una población piensan algo, con una muestra diseñada y en las palabras del cuestionario. La conversación muestra qué dice la gente sin que nadie pregunte, con sus palabras, sus motivos y sus comparaciones. Lo más útil suele ser leerlas juntas.",
        them: "Encuesta",
        takeaway: { them: "Cuántos eligen cada opción", us: "Por qué, en sus palabras" },
        criteria: [
          { name: "Qué mide", them: "Opinión declarada ante una pregunta", us: "Lo que la gente dice por su cuenta, con sus palabras" },
          { name: "Representatividad", them: "Diseñada, permite cifras poblacionales", us: "Representa a quienes hablan en público. Cada hallazgo dice su nivel de evidencia" },
          { name: "Quién define los temas", them: "Quien escribe el cuestionario", us: "La gente. Los temas salen de la conversación" },
          { name: "El porqué", them: "Limitado a las opciones y a las preguntas abiertas", us: "Motivos, frenos y comparaciones en lenguaje literal" },
          { name: "Lo que nadie pensó preguntar", them: "Queda fuera", us: "Aparece si la gente lo dice" },
          { name: "Tiempo", them: "Semanas entre diseño, campo y análisis", us: "Días desde el brief hasta la primera respuesta" },
          { name: "Periodo", them: "Una foto en la fecha del campo", us: "Historia y comparación entre periodos" },
          { name: "Deseabilidad social", them: "Las personas responden lo que creen que deben", us: "La gente habla sin un cuestionario enfrente" },
          { name: "Leerlas juntas", them: "Con su propia taxonomía", us: "Tu NPS o tu encuesta leídos con los mismos temas que la conversación" }
        ],
        when: {
          them: { name: "Conviene la encuesta", text: "Cuando necesitas una cifra poblacional, como cuántos conocen tu marca, cuántos la prefieren o cómo cambia por segmento. Cuando quieres validar un concepto con intención de compra, o la categoría casi no tiene conversación pública." },
          us: { name: "Conviene la conversación", text: "Cuando necesitas saber por qué, con qué palabras y contra qué se compara. Cuando todavía no sabes qué preguntar, quieres ver cómo cambia un tema con los meses o lo que la gente declara no coincide con lo que hace." },
          both: { name: "Convienen las dos", text: "La conversación antes de la encuesta dice qué preguntar y con qué palabras. La encuesta después pone cifra a lo que encontró la conversación. Leídas juntas, con los mismos temas, muestran dónde coincide lo que la gente declara con lo que dice en público." }
        },
        faq: [
          { q: "¿La conversación es representativa?", a: "Representa a quienes hablan en público, que no son toda la población. Por eso cada hallazgo de Noisia dice si es medido, direccional o cualitativo, y conviene poner cifra poblacional con una encuesta cuando la decisión lo pide.", icon: "people" },
          { q: "¿Pueden leer mi encuesta o mi NPS junto con la conversación?", a: "Sí. Llevamos tus datos a los mismos temas que la conversación y comparamos. Suele ser de los análisis más útiles, porque muestra lo que la gente declara frente a lo que dice sin que le pregunten.", icon: "data" },
          { q: "¿Y los focus groups?", a: "Son útiles para ir a fondo y observar reacciones, con pocas personas y un moderador presente. La conversación pública muestra lo que la gente dice a escala y sin moderador. Muchas veces conviene usar las dos.", icon: "live" },
          { q: "¿Pueden diseñar la encuesta?", a: "Cada estudio cierra con las preguntas que una encuesta debería validar, en las palabras que usa la gente. El campo lo hace tu proveedor de encuestas o uno que te recomendemos.", icon: "edit" }
        ]
      },
      en: {
        metaTitle: "Surveys vs. social media conversation",
        metaDescription:
          "A survey measures how many people think something. Social conversation shows why, in people's own words. When each one fits and how to read them together.",
        title: "Survey or conversation?",
        lead: "Both. A survey measures how many people in a population think something, with a designed sample and in the words of the questionnaire. Conversation shows what people say without anyone asking, in their own words, with their motives and comparisons. Reading them together is usually the most useful.",
        them: "Survey",
        takeaway: { them: "How many pick each option", us: "Why, in their own words" },
        criteria: [
          { name: "What it measures", them: "Stated opinion in response to a question", us: "What people say on their own, in their words" },
          { name: "Representativeness", them: "Designed, allows population figures", us: "Represents those who speak in public. Every finding states its level of evidence" },
          { name: "Who defines the topics", them: "Whoever writes the questionnaire", us: "People. Topics are discovered in the conversation" },
          { name: "The why", them: "Limited to the options and open questions", us: "Motives, obstacles and comparisons in verbatim language" },
          { name: "What nobody thought to ask", them: "Stays out", us: "Shows up if people say it" },
          { name: "Time", them: "Weeks between design, fieldwork and analysis", us: "Days from brief to first answer" },
          { name: "Period", them: "A snapshot on the fieldwork date", us: "History and comparison across periods" },
          { name: "Social desirability", them: "People answer what they think they should", us: "People talk without a questionnaire in front of them" },
          { name: "Reading them together", them: "With its own taxonomy", us: "Your NPS or survey read with the same topics as the conversation" }
        ],
        when: {
          them: { name: "The survey makes sense", text: "When you need a population figure, like how many know your brand, how many prefer it or how it changes by segment. When you want to validate a concept with purchase intent, or the category has little public conversation." },
          us: { name: "Conversation makes sense", text: "When you need to know why, in what words and against what people compare. When you don't know what to ask yet, want to see how a topic changes over months, or what people declare doesn't match what they do." },
          both: { name: "Both make sense", text: "Conversation before the survey says what to ask and in which words. The survey afterwards puts a figure on what the conversation found. Read together, with the same topics, they show where what people declare matches what they say in public." }
        },
        faq: [
          { q: "Is conversation representative?", a: "It represents those who speak in public, who are not the whole population. That is why every Noisia finding says whether it is measured, directional or qualitative, and why it makes sense to add a population figure with a survey when the decision calls for it.", icon: "people" },
          { q: "Can you read my survey or my NPS together with the conversation?", a: "Yes. We bring your data into the same topics as the conversation and compare. It is often one of the most useful analyses, because it shows what people declare against what they say when nobody asks.", icon: "data" },
          { q: "What about focus groups?", a: "They are useful for going deep and observing reactions, with a few people and a moderator present. Public conversation shows what people say at scale and without a moderator. Often it pays to use both.", icon: "live" },
          { q: "Can you design the survey?", a: "Every study closes with the questions a survey should validate, in the words people use. The fieldwork is done by your survey provider or one we recommend.", icon: "edit" }
        ]
      }
    }
  },
  {
    slug: { es: "agencias", en: "agencies" },
    kind: "agency",
    summary: {
      es: "Una agencia o un instituto aportan criterio humano, en semanas y sobre una parte de la conversación. Cuándo conviene cada opción.",
      en: "An agency or a research firm brings human judgment, over weeks and on part of the conversation. When each option makes sense."
    },
    page: {
      es: {
        metaTitle: "¿Agencia de investigación de mercados o Noisia?",
        metaDescription:
          "Una agencia o un instituto aporta criterio humano, pero tarda semanas y lee una muestra. Noisia suma ese criterio a software que lee todo, en días.",
        title: "¿Agencia, instituto de investigación o Noisia?",
        lead: "Una agencia o un instituto aportan criterio humano, conocimiento del cliente y una recomendación con responsable. A cambio, un estudio tradicional tarda semanas y lee a mano una parte de la conversación. Noisia conserva el criterio humano, con un Intelligence Architect que firma cada análisis, y le suma tecnología que lee la conversación completa y entrega en días.",
        them: "Agencia",
        takeaway: { them: "Una buena lectura de una parte, en semanas", us: "La respuesta, con su evidencia, en días" },
        criteria: [
          { name: "Criterio humano", them: "Sí, con analistas o planners con experiencia", us: "Sí, con un Intelligence Architect que define, aprueba y firma" },
          { name: "Cuánto lee", them: "Una muestra, leída a mano o con una herramienta", us: "La conversación completa, con temas descubiertos sobre todo el conjunto" },
          { name: "Tiempo", them: "Semanas, con frecuencia más de un mes", us: "Días desde el brief hasta la primera respuesta" },
          { name: "Método", them: "Depende del equipo y del proyecto", us: "Seis métodos con base en ciencias sociales y límites escritos" },
          { name: "Evidencia", them: "Citas seleccionadas a mano", us: "Cada cifra con su cálculo y cada cita verificada contra la fuente" },
          { name: "El periodo siguiente", them: "Un proyecto nuevo, desde cero", us: "Compara contra los temas ya aprobados" },
          { name: "Tus datos propios", them: "Según el proyecto", us: "NPS, encuestas y búsquedas en el mismo análisis" },
          { name: "Idiomas y mercados", them: "Los del equipo", us: "16 idiomas, más de 20 países" },
          { name: "Creatividad y medios", them: "Parte de su oferta", us: "Fuera de nuestro trabajo. Entregamos el brief con evidencia" }
        ],
        when: {
          them: { name: "Conviene la agencia o el instituto", text: "Cuando además de investigar necesitas estrategia, creatividad, medios o relaciones públicas. Cuando la pregunta pide entrevistas, etnografía en campo o una encuesta representativa, o hay una relación de años que conoce tu marca por dentro." },
          us: { name: "Conviene Noisia", text: "Cuando la decisión no puede esperar semanas. Cuando necesitas leer la conversación completa en lugar de una muestra, abrir cada cifra hasta la mención o repetir el análisis cada periodo con los mismos temas. Cuando el mercado habla un idioma que tu equipo no lee." },
          both: { name: "Convienen las dos", text: "Muchas agencias trabajan con Noisia. Nosotros producimos la investigación y la agencia la lleva a estrategia y ejecución. El estudio se presenta junto con ella o se entrega como insumo de su planning." }
        },
        faq: [
          faqUsEs,
          { q: "¿Trabajan para agencias?", a: "Sí. La agencia conserva la relación con su cliente y nosotros producimos la investigación.", icon: "people" },
          { q: "¿Qué pierdo al no tener un equipo leyendo a mano?", a: "En criterio, nada. Un Intelligence Architect aprueba los temas, corrige la clasificación e interpreta. Lo que cambia es que el análisis cubre la conversación completa y llega en días, con cada cifra calculada y cada cita verificada.", icon: "eye" },
          { q: "¿Pueden hacer entrevistas o etnografía?", a: "Nuestro trabajo es la conversación pública y los datos del cliente. Cuando la pregunta pide campo, lo decimos y recomendamos con quién hacerlo. El estudio sirve de guía para ese trabajo.", icon: "markets" }
        ]
      },
      en: {
        metaTitle: "Market research agency or Noisia?",
        metaDescription:
          "An agency or research firm brings human judgment, but takes weeks and reads a sample. Noisia pairs that judgment with software that reads it all, in days.",
        title: "Agency, research firm or Noisia?",
        lead: "An agency or a research firm brings human judgment, knowledge of the client and a recommendation with an owner. In exchange, a traditional study takes weeks and reads part of the conversation by hand. Noisia keeps the human judgment, with an Intelligence Architect who signs off every analysis, and adds technology that reads the whole conversation and delivers in days.",
        them: "Agency",
        takeaway: { them: "A good reading of a part, in weeks", us: "The answer, with its evidence, in days" },
        criteria: [
          { name: "Human judgment", them: "Yes, with experienced analysts or planners", us: "Yes, with an Intelligence Architect who defines, approves and signs off" },
          { name: "How much it reads", them: "A sample, read by hand or with a tool", us: "The whole conversation, with topics discovered across all of it" },
          { name: "Time", them: "Weeks, often more than a month", us: "Days from brief to first answer" },
          { name: "Method", them: "Depends on the team and the project", us: "Six methods grounded in social science, with written limits" },
          { name: "Evidence", them: "Hand-picked quotes", us: "Every number with its calculation and every quote checked against the source" },
          { name: "The next period", them: "A new project, from scratch", us: "Compares against the topics already approved" },
          { name: "Your own data", them: "Depends on the project", us: "NPS, surveys and search in the same analysis" },
          { name: "Languages and markets", them: "The team's", us: "16 languages, more than 20 countries" },
          { name: "Creative and media", them: "Part of their offer", us: "Outside our work. We deliver the brief with evidence" }
        ],
        when: {
          them: { name: "The agency or research firm makes sense", text: "When besides research you need strategy, creative, media or public relations. When the question calls for interviews, field ethnography or a representative survey, or there is a years-long relationship that knows your brand from the inside." },
          us: { name: "Noisia makes sense", text: "When the decision can't wait weeks. When you need to read the whole conversation rather than a sample, open every number down to the mention or repeat the analysis every period with the same topics. When the market speaks a language your team doesn't read." },
          both: { name: "Both make sense", text: "Many agencies work with Noisia. We produce the research and the agency takes it to strategy and execution. The study is presented alongside the agency or delivered as input for its planning." }
        },
        faq: [
          faqUsEn,
          { q: "Do you work for agencies?", a: "Yes. The agency keeps the relationship with its client and we produce the research.", icon: "people" },
          { q: "What do I lose by not having a team reading by hand?", a: "In judgment, nothing. An Intelligence Architect approves the topics, corrects the classification and interprets. What changes is that the analysis covers the whole conversation and arrives in days, with every number calculated and every quote checked.", icon: "eye" },
          { q: "Can you do interviews or ethnography?", a: "Our work is public conversation and client data. When the question calls for fieldwork, we say so and recommend whom to do it with. The study serves as a guide for that work.", icon: "markets" }
        ]
      }
    }
  }
];

export function findCompare(locale: string, slug: string): CompareEntry | undefined {
  const lang = locale === "en" ? "en" : "es";
  return compareEntries.find((entry) => entry.slug[lang] === slug);
}
