import type { HeroCopy } from "@/motion/HeroComposition";
import type { KeywordsCopy } from "@/motion/KeywordsComposition";
import type { SourcesHubCopy } from "@/motion/SourcesHubComposition";
import type { UnderstandCopy } from "@/motion/UnderstandComposition";
import type { FaqIcon } from "@/components/ui/faq-icons";
import type { LearnIcon } from "@/components/learn/icons";
import type { MomentKey } from "./industries";
import type { CompareKind } from "./compare";
import type { Localized } from "./types";

/**
 * "What is social intelligence?": the definition page. Each idea is said once and shown with an
 * animation (a question becoming an answer, keyword search against the whole conversation, the
 * sources, one mention read for its reasons); detail goes to the glossary and the FAQ.
 * Examples inside the animations are illustrative.
 */

export type SocialIntelligenceCopy = {
  metaTitle: string;
  metaDescription: string;
  title: string;
  lead: string;
  definition: { title: string; steps: { name: string; text: string; icon: LearnIcon }[]; motion: HeroCopy; motionLabel: string };
  listening: { title: string; paragraphs: string[]; motion: KeywordsCopy; motionLabel: string; link: { label: string; compare: CompareKind } };
  research: { title: string; lead: string; survey: { name: string; text: string }; conversation: { name: string; text: string }; link: { label: string; compare: CompareKind } };
  sources: { title: string; lead: string; motion: SourcesHubCopy; motionLabel: string; items: { name: string; text: string; source: string }[] };
  can: { title: string; lead: string; motion: UnderstandCopy; items: { name: string; text: string }[] };
  cannot: { title: string; items: { name: string; text: string }[] };
  questions: { title: string; lead: string; more: string; items: { q: string; text: string; moment: MomentKey }[] };
  glossary: { title: string; items: { term: string; text: string }[] };
  faq: { title: string; items: { q: string; a: string; icon: FaqIcon }[] };
  more: { title: string; items: { label: string; text: string; href: string; icon: LearnIcon }[] };
  cta: { title: string; text: string; label: string };
};

export const socialIntelligence: Localized<SocialIntelligenceCopy> = {
  es: {
    metaTitle: "¿Qué es la inteligencia social?",
    metaDescription:
      "La inteligencia social investiga la conversación pública para responder una pregunta de negocio. Qué la distingue del social listening y qué puede decirte.",
    title: "¿Qué es la inteligencia social?",
    lead: "Es investigar lo que la gente dice en público, en redes, búsquedas, reseñas y comunidades, para responder una pregunta de negocio con evidencia.",
    definition: {
      title: "De una pregunta a una respuesta",
      steps: [
        { name: "Empieza con una pregunta", text: "Una decisión de negocio, traducida a preguntas que la conversación puede responder.", icon: "question" },
        { name: "Lee toda la conversación", text: "Lo que la gente publica en abierto, sin el ruido de prensa, marcas, reventa y spam.", icon: "data" },
        { name: "La ordena en temas", text: "Los temas salen de lo que dice la gente y una persona los aprueba.", icon: "book" },
        { name: "Entrega una respuesta", text: "Con un método, recomendaciones y cada hallazgo ligado a lo que alguien escribió.", icon: "check" }
      ],
      motion: {
        question: "¿Por qué abandonan el carrito antes de pagar?",
        clusters: ["Envío", "Precio", "Pago", "Confianza", "Devoluciones"],
        noise: "Ruido",
        approved: "Intelligence Architect",
        answerLabel: "La respuesta",
        answer: "No confían en pagar con tarjeta en una tienda que no conocen",
        quote: "Si no tiene pago contra entrega, mejor no me arriesgo"
      },
      motionLabel: "Una pregunta se responde con los temas de la conversación"
    },
    listening: {
      title: "¿En qué se diferencia del social listening?",
      paragraphs: [
        "El social listening monitorea. Una herramienta recoge las menciones que contienen las palabras que elegiste y las muestra en un dashboard con volumen, sentimiento y alertas. Te dice cuánto se habló y si subió o bajó.",
        "La inteligencia social parte de una pregunta. Lee también lo que la gente dice sin nombrar tu marca, encuentra los temas, limpia el ruido e interpreta con un método. El listening puede ser una de sus fuentes."
      ],
      motion: {
        query: "Altura",
        mentions: [
          { text: "Altura subió otra vez de precio", hit: true, platform: "X", topic: 0 },
          { text: "El de cápsulas ya no sabe igual", hit: false, platform: "TikTok", topic: 1 },
          { text: "En el súper de mi colonia nunca hay", hit: false, platform: "Facebook", topic: 2 },
          { text: "Altura en promoción, dos por uno", hit: true, platform: "Instagram", topic: 0 },
          { text: "La bolsa nueva no cierra bien", hit: false, platform: "Reviews", topic: 3 },
          { text: "Prefiero el de grano, el molido sabe a quemado", hit: false, platform: "Reddit", topic: 1 }
        ],
        found: "menciones leídas",
        missed: "No dice la palabra",
        them: "encuentra la búsqueda por palabra clave",
        us: "Toda la conversación, leída",
        topics: ["Precio", "Sabor", "Disponibilidad", "Empaque"]
      },
      motionLabel: "La búsqueda por palabra clave contra la conversación completa",
      link: { label: "Ver la comparación completa", compare: "listening" }
    },
    research: {
      title: "¿Y de la investigación de mercados?",
      lead: "Las dos se complementan. Cambia la forma de llegar a la gente.",
      survey: { name: "La encuesta pregunta", text: "Opinión declarada de una muestra diseñada, en el lenguaje del cuestionario. Es la mejor forma de medir cuántas personas piensan algo." },
      conversation: { name: "La conversación escucha", text: "Lenguaje espontáneo, en el momento y las palabras de cada persona. Encuentra motivos que nadie pensó incluir en un cuestionario y te dice qué preguntar después." },
      link: { label: "Encuesta o conversación, a detalle", compare: "survey" }
    },
    sources: {
      title: "¿De dónde sale la conversación?",
      lead: "Las fuentes se eligen según la pregunta y llegan a un solo análisis.",
      motion: {
        center: "Un solo análisis",
        sources: ["TikTok", "Instagram", "YouTube", "X", "Facebook", "Reseñas", "Foros", "Búsquedas", "NPS y encuestas", "CRM"],
        owned: "Tus propios datos"
      },
      motionLabel: "Redes, reseñas, foros, búsquedas y tus datos llegan a un solo análisis",
      items: [
        { name: "Redes sociales abiertas", text: "Reacción inmediata y lenguaje espontáneo.", source: "social" },
        { name: "Foros y comunidades", text: "Hilos largos donde viven los motivos y los códigos de una categoría.", source: "Foros" },
        { name: "Reseñas y marketplaces", text: "Decisiones de compra recién tomadas, con sus dudas y quejas.", source: "Reseñas" },
        { name: "Comentarios en video", text: "Reacciones a contenido, creadores y publicidad.", source: "YouTube" },
        { name: "Búsquedas", text: "Lo que la gente pregunta en privado a un buscador.", source: "Búsqueda" },
        { name: "Tus propios datos", text: "NPS, encuestas o tickets, leídos con los mismos temas, con tu autorización.", source: "NPS" }
      ]
    },
    can: {
      title: "¿Qué puede decirte?",
      lead: "Detrás de cada mención hay razones. La inteligencia social las encuentra y después cuenta.",
      motion: {
        quote: "Quiero dejar el refresco, pero en la oficina todos toman y no quiero ser la rara",
        layers: ["Psicológica", "Personal", "Social", "Cultural"],
        chips: [
          { text: "Cuidarse", layer: 0, kind: "trigger" },
          { text: "La rutina", layer: 1, kind: "barrier" },
          { text: "Ser la rara", layer: 2, kind: "barrier" },
          { text: "Lo sano está de moda", layer: 3, kind: "trigger" }
        ],
        trigger: "Lo que la mueve",
        barrier: "Lo que la frena",
        caption: "Una mención, cuatro razones."
      },
      items: [
        { name: "Qué temas existen y cuáles pesan", text: "Con cifras calculadas sobre la conversación completa." },
        { name: "Por qué, en sus palabras", text: "Motivos, frenos, comparaciones y lenguaje literal." },
        { name: "Qué cambió y cuándo", text: "Qué tema apareció, creció o se apagó entre periodos, y qué lo movió." },
        { name: "Cómo se ve tu marca frente a otras", text: "Tu marca y tus competidores, con el mismo criterio y el mismo periodo." }
      ]
    },
    cannot: {
      title: "¿Y qué no?",
      items: [
        { name: "Cuántas personas de la población piensan algo", text: "Representa a quienes hablan en público. Para una cifra poblacional hace falta una encuesta." },
        { name: "Lo que la gente no dice", text: "Si un motivo nunca se pone en palabras, no aparece. Para eso sirven la observación y las pruebas de usabilidad." },
        { name: "Predicciones de ventas", text: "Da hipótesis fuertes y direcciones. El tamaño de mercado y el efecto en ventas se validan con otros métodos." }
      ]
    },
    questions: {
      title: "¿Qué preguntas responde?",
      lead: "Cada una corresponde a un momento de tu marca.",
      more: "Cómo lo resolvemos",
      items: [
        { q: "¿Qué está pasando con mi marca y qué cambió?", text: "Un reporte continuo que compara periodos y explica cada movimiento.", moment: "monitorear" },
        { q: "¿Sobre qué territorio construyo una campaña?", text: "Los territorios, probados contra la conversación real.", moment: "lanzar" },
        { q: "¿Cómo funciona un mercado que no conozco?", text: "Las reglas no escritas de la categoría y quién da credibilidad.", moment: "entrar" },
        { q: "¿Por qué se va mi cliente con la competencia?", text: "Los motivos reales de cambio y qué promesa del otro se cree más.", moment: "defender" },
        { q: "¿Dónde se rompe el camino a la compra?", text: "El recorrido como lo vive la gente y la fricción que conviene quitar primero.", moment: "optimizar" },
        { q: "¿Qué necesidad sigue sin resolverse?", text: "Lo que la gente intenta resolver mal con lo que existe.", moment: "innovar" }
      ]
    },
    glossary: {
      title: "Glosario breve",
      items: [
        { term: "Inteligencia social", text: "Investigación que convierte la conversación pública en respuestas para una decisión, con método y evidencia abierta." },
        { term: "Social listening", text: "Monitoreo de menciones de una marca o de palabras elegidas, en dashboards con volumen, sentimiento y alertas." },
        { term: "Voz del consumidor", text: "Lo que la gente dice sobre una categoría, una marca o una experiencia, en público o en una encuesta." },
        { term: "Dataset", text: "El conjunto completo de publicaciones que se lee para un proyecto, después de limpiar el ruido." },
        { term: "Tema", text: "Un grupo de menciones que hablan de lo mismo, descubierto en el lenguaje de la gente y aprobado por una persona." },
        { term: "Triggers & Barriers", text: "Lo que motiva y lo que frena una decisión. Es el método más usado de nuestra biblioteca." },
        { term: "Share of voice", text: "La parte de la conversación de una categoría que ocupa cada marca en un periodo." },
        { term: "Intelligence Architect", text: "La persona que define la pregunta, aprueba los temas, corrige la clasificación, interpreta con un método y firma el resultado." }
      ]
    },
    faq: {
      title: "Preguntas frecuentes",
      items: [
        { q: "¿La inteligencia social es lo mismo que el social listening?", a: "No. El social listening monitorea menciones y las muestra en un dashboard. La inteligencia social parte de una pregunta de negocio, lee la conversación completa, la interpreta con un método y entrega una respuesta con recomendaciones.", icon: "search" },
        { q: "¿Reemplaza a las encuestas?", a: "No. Las encuestas miden cuántos piensan algo en una población definida. La conversación muestra qué dicen, cómo lo dicen y por qué, sin que nadie pregunte. Juntas responden mejor que cualquiera por separado.", icon: "check" },
        { q: "¿Qué tan confiable es?", a: "Depende de que cada cifra se calcule sobre la conversación completa y de que cada cita se pueda abrir. En Noisia cada hallazgo dice si es medido, direccional o cualitativo, y los límites se escriben en el reporte.", icon: "privacy" },
        { q: "¿Qué papel juega la inteligencia artificial?", a: "Lee, agrupa y clasifica la conversación a una escala que ninguna persona alcanza. Una persona con formación aprueba los temas, corrige la clasificación e interpreta. Las cifras se calculan con consultas que se pueden repetir.", icon: "system" },
        { q: "¿Para qué equipos sirve?", a: "Marca, insights, producto, estrategia, comunicación y las agencias que los acompañan. Cualquier equipo que tenga que decidir sobre algo de lo que la gente ya está hablando.", icon: "people" },
        { q: "¿Cómo se contrata?", a: "Como un reporte continuo, semanal, quincenal o mensual, como un estudio que responde una pregunta concreta o como un plan anual de estudios. La entrada es un taller gratis donde definimos la pregunta.", icon: "calendar" }
      ]
    },
    more: {
      title: "Sigue leyendo",
      items: [
        { label: "Cómo funciona", text: "El recorrido de tu pregunta a una decisión.", href: "/como-funciona", icon: "book" },
        { label: "Métodos", text: "La biblioteca con base antropológica y sociológica.", href: "/metodos", icon: "people" },
        { label: "Industrias", text: "Las preguntas que podemos responder en la tuya.", href: "/industrias", icon: "page" },
        { label: "Comparaciones", text: "Herramienta, IA, encuesta o agencia, frente a frente.", href: "/comparar", icon: "question" }
      ]
    },
    cta: { title: "Trae tu pregunta", text: "En un taller gratis vemos si la conversación puede responderla y cómo.", label: "Agenda un taller gratis" }
  },
  en: {
    metaTitle: "What is social intelligence?",
    metaDescription:
      "Social intelligence researches public conversation to answer a business question. How it differs from social listening, and what it can tell you.",
    title: "What is social intelligence?",
    lead: "It is researching what people say in public, across social media, search, reviews and communities, to answer a business question with evidence.",
    definition: {
      title: "From a question to an answer",
      steps: [
        { name: "It starts with a question", text: "A business decision, translated into questions the conversation can answer.", icon: "question" },
        { name: "It reads the whole conversation", text: "What people post in the open, without the noise of press, brands, resale and spam.", icon: "data" },
        { name: "It sorts it into topics", text: "Topics come from what people say, and a person approves them.", icon: "book" },
        { name: "It delivers an answer", text: "With a method, recommendations and every finding tied to something someone wrote.", icon: "check" }
      ],
      motion: {
        question: "Why do people abandon the cart before paying?",
        clusters: ["Shipping", "Price", "Payment", "Trust", "Returns"],
        noise: "Noise",
        approved: "Intelligence Architect",
        answerLabel: "The answer",
        answer: "They don't trust paying by card at a store they don't know",
        quote: "If there's no cash on delivery, I'd rather not risk it"
      },
      motionLabel: "A question is answered with the topics of the conversation"
    },
    listening: {
      title: "How is it different from social listening?",
      paragraphs: [
        "Social listening monitors. A tool collects the mentions that contain the words you chose and shows them on a dashboard with volume, sentiment and alerts. It tells you how much people talked and whether it went up or down.",
        "Social intelligence starts from a question. It also reads what people say without naming your brand, finds the topics, cleans out the noise and interprets with a method. Listening can be one of its sources."
      ],
      motion: {
        query: "Altura",
        mentions: [
          { text: "Altura raised its price again", hit: true, platform: "X", topic: 0 },
          { text: "The pods don't taste the same anymore", hit: false, platform: "TikTok", topic: 1 },
          { text: "My local store never has it", hit: false, platform: "Facebook", topic: 2 },
          { text: "Altura on sale, two for one", hit: true, platform: "Instagram", topic: 0 },
          { text: "The new bag doesn't close properly", hit: false, platform: "Reviews", topic: 3 },
          { text: "I prefer whole bean, the ground one tastes burnt", hit: false, platform: "Reddit", topic: 1 }
        ],
        found: "mentions read",
        missed: "Doesn't say the word",
        them: "found by the keyword search",
        us: "The whole conversation, read",
        topics: ["Price", "Taste", "Availability", "Packaging"]
      },
      motionLabel: "Keyword search against the whole conversation",
      link: { label: "See the full comparison", compare: "listening" }
    },
    research: {
      title: "And market research?",
      lead: "The two complement each other. What changes is how they reach people.",
      survey: { name: "A survey asks", text: "Stated opinion from a designed sample, in the language of the questionnaire. It is the best way to measure how many people think something." },
      conversation: { name: "Conversation listens", text: "Spontaneous language, in each person's own moment and words. It finds motives nobody thought to put in a questionnaire and tells you what to ask next." },
      link: { label: "Survey or conversation, in detail", compare: "survey" }
    },
    sources: {
      title: "Where does the conversation come from?",
      lead: "Sources are chosen for the question and come together in one analysis.",
      motion: {
        center: "One analysis",
        sources: ["TikTok", "Instagram", "YouTube", "X", "Facebook", "Reviews", "Forums", "Search", "NPS and surveys", "CRM"],
        owned: "Your own data"
      },
      motionLabel: "Social media, reviews, forums, search and your data come together in one analysis",
      items: [
        { name: "Open social media", text: "Immediate reactions and spontaneous language.", source: "social" },
        { name: "Forums and communities", text: "Long threads where a category's motives and codes live.", source: "Forums" },
        { name: "Reviews and marketplaces", text: "Purchase decisions just made, with their doubts and complaints.", source: "Reviews" },
        { name: "Video comments", text: "Reactions to content, creators and advertising.", source: "YouTube" },
        { name: "Search", text: "What people ask a search engine in private.", source: "Search" },
        { name: "Your own data", text: "NPS, surveys or tickets, read with the same topics, with your authorization.", source: "NPS" }
      ]
    },
    can: {
      title: "What can it tell you?",
      lead: "Behind every mention there are reasons. Social intelligence finds them, and then it counts.",
      motion: {
        quote: "I want to quit soda, but everyone at the office drinks it and I don't want to be the odd one",
        layers: ["Psychological", "Personal", "Social", "Cultural"],
        chips: [
          { text: "Self-care", layer: 0, kind: "trigger" },
          { text: "Routine", layer: 1, kind: "barrier" },
          { text: "Being the odd one", layer: 2, kind: "barrier" },
          { text: "Healthy is in", layer: 3, kind: "trigger" }
        ],
        trigger: "What drives her",
        barrier: "What holds her back",
        caption: "One mention, four reasons."
      },
      items: [
        { name: "Which topics exist and which matter most", text: "With numbers calculated over the whole conversation." },
        { name: "Why, in their words", text: "Motives, obstacles, comparisons and verbatim language." },
        { name: "What changed and when", text: "Which topic appeared, grew or faded between periods, and what moved it." },
        { name: "How your brand looks next to others", text: "Your brand and your competitors, with the same criteria and the same period." }
      ]
    },
    cannot: {
      title: "And what it can't",
      items: [
        { name: "How many people in the population think something", text: "It represents those who speak in public. For a population figure you need a survey." },
        { name: "What people don't say", text: "If a motive is never put into words, it doesn't show up. That is what observation and usability testing are for." },
        { name: "Sales forecasts", text: "It gives strong hypotheses and directions. Market size and the effect on sales are validated with other methods." }
      ]
    },
    questions: {
      title: "Which questions does it answer?",
      lead: "Each one matches a moment of your brand.",
      more: "How we solve it",
      items: [
        { q: "What is happening with my brand, and what changed?", text: "An ongoing report that compares periods and explains every movement.", moment: "monitorear" },
        { q: "Which territory should I build a campaign on?", text: "Territories, tested against real conversation.", moment: "lanzar" },
        { q: "How does a market I don't know work?", text: "The unwritten rules of the category and who lends credibility.", moment: "entrar" },
        { q: "Why is my customer leaving for a competitor?", text: "The real reasons for switching and which rival promise feels more credible.", moment: "defender" },
        { q: "Where does the path to purchase break?", text: "The journey as people live it and the friction worth removing first.", moment: "optimizar" },
        { q: "Which need is still unmet?", text: "What people try to solve badly with what already exists.", moment: "innovar" }
      ]
    },
    glossary: {
      title: "A short glossary",
      items: [
        { term: "Social intelligence", text: "Research that turns public conversation into answers for a decision, with a method and open evidence." },
        { term: "Social listening", text: "Monitoring of mentions of a brand or chosen keywords, on dashboards with volume, sentiment and alerts." },
        { term: "Voice of the customer", text: "What people say about a category, a brand or an experience, in public or in a survey." },
        { term: "Dataset", text: "The complete set of posts read for a project, after the noise has been cleaned out." },
        { term: "Topic", text: "A group of mentions about the same thing, discovered in people's language and approved by a person." },
        { term: "Triggers & Barriers", text: "What motivates and what holds back a decision. It is the most used method in our library." },
        { term: "Share of voice", text: "The share of a category's conversation each brand takes in a given period." },
        { term: "Intelligence Architect", text: "The person who defines the question, approves the topics, corrects the classification, interprets with a method and signs off the result." }
      ]
    },
    faq: {
      title: "Frequently asked questions",
      items: [
        { q: "Is social intelligence the same as social listening?", a: "No. Social listening monitors mentions and shows them on a dashboard. Social intelligence starts from a business question, reads the whole conversation, interprets it with a method and delivers an answer with recommendations.", icon: "search" },
        { q: "Does it replace surveys?", a: "No. Surveys measure how many people think something within a defined population. Conversation shows what they say, how they say it and why, without anyone asking. Together they answer better than either one alone.", icon: "check" },
        { q: "How reliable is it?", a: "It depends on every number being calculated over the whole conversation and every quote being openable. At Noisia every finding says whether it is measured, directional or qualitative, and the limits are written into the report.", icon: "privacy" },
        { q: "What role does artificial intelligence play?", a: "It reads, groups and classifies the conversation at a scale no person can reach. A trained person approves the topics, corrects the classification and interprets. Numbers are calculated with queries that can be repeated.", icon: "system" },
        { q: "Which teams is it for?", a: "Brand, insights, product, strategy, communications and the agencies that support them. Any team that has to decide on something people are already talking about.", icon: "people" },
        { q: "How do you buy it?", a: "As an ongoing report, weekly, biweekly or monthly, as a study that answers one specific question, or as an annual plan of studies. The entry point is a free workshop where we define the question.", icon: "calendar" }
      ]
    },
    more: {
      title: "Keep reading",
      items: [
        { label: "How it works", text: "The path from your question to a decision.", href: "/en/how-it-works", icon: "book" },
        { label: "Methods", text: "The library with anthropological and sociological foundations.", href: "/en/methods", icon: "people" },
        { label: "Industries", text: "The questions we can answer in yours.", href: "/en/industries", icon: "page" },
        { label: "Comparisons", text: "Tool, AI, survey or agency, side by side.", href: "/en/compare", icon: "question" }
      ]
    },
    cta: { title: "Bring your question", text: "In a free workshop we look at whether the conversation can answer it, and how.", label: "Book a free workshop" }
  }
};
