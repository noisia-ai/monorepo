import type { FaqIcon } from "@/components/ui/faq-icons";
import type { ProcessCopy } from "@/motion/ProcessComposition";
import type { SourcesHubCopy } from "@/motion/SourcesHubComposition";
import type { OneConversationCopy } from "@/motion/OneConversationComposition";
import type { HowArchitectCopy } from "@/motion/HowArchitectComposition";
import type { HowEvidenceCopy } from "@/motion/HowEvidenceComposition";
import type { Localized } from "./types";

/**
 * "Cómo funciona" reads like a product page: a few big ideas, each with one animation,
 * and the detail lives in the FAQ at the bottom. Examples inside the animations are
 * illustration, never a case.
 */

export type HowPoint = { name: string; text: string };

export type HowItWorksCopy = {
  metaTitle: string;
  metaDescription: string;
  hero: { title: string; lead: string; process: ProcessCopy };
  sources: { title: string; lead: string; motion: SourcesHubCopy };
  architect: { title: string; lead: string; points: [HowPoint, HowPoint, HowPoint]; motion: HowArchitectCopy };
  methods: { title: string; lead: string; link: string };
  evidence: { title: string; lead: string; levels: [HowPoint, HowPoint, HowPoint]; motion: HowEvidenceCopy };
  views: { title: string; lead: string; motion: OneConversationCopy };
  faq: { title: string; lead: string; items: { q: string; a: string; icon: FaqIcon }[] };
  cta: { title: string; text: string; label: string };
};

export const howItWorks: Localized<HowItWorksCopy> = {
  es: {
    metaTitle: "Cómo funciona la inteligencia social de Noisia",
    metaDescription:
      "Leemos lo que la gente dice en redes, reseñas, foros y búsquedas, lo ordenamos en temas y un Intelligence Architect lo interpreta con métodos de las ciencias sociales. Recibes una respuesta con la evidencia a la vista.",
    hero: {
      title: "Escuchamos a la gente. Respondemos tu pregunta.",
      lead:
        "Leemos lo que se dice en público sobre tu marca y tu categoría, lo ordenamos en temas y una persona experta lo interpreta contigo. Recibes una respuesta con la evidencia a la vista.",
      process: {
        asks: "Tu pregunta",
        question: "¿Por qué la gente joven se está saltando el sérum?",
        clusters: ["Rutina cansada", "Precio por mililitro", "Textura", "Confianza en ingredientes", "Consejo de creadores", "Piel sensible"],
        stages: ["Toda la conversación", "Sin duplicados ni ruido", "La voz que importa"],
        steps: ["Tu pregunta", "La conversación", "Limpieza", "Temas", "Respuesta"],
        human: "Intelligence Architect",
        answer: "La respuesta, en orden",
        linked: "Cada punto abre sus menciones"
      }
    },
    sources: {
      title: "Toda la conversación, en un solo lugar.",
      lead:
        "Redes sociales, reseñas, foros y búsquedas. Si tienes tu NPS o tus encuestas, también entran. Lo leemos junto porque cada fuente cuenta una parte distinta de la historia.",
      motion: {
        center: "Una sola lectura",
        sources: ["TikTok", "Instagram", "YouTube", "X", "Facebook", "Reseñas", "Foros", "Búsquedas", "NPS y encuestas", "CRM"],
        owned: "Tus propios datos"
      }
    },
    architect: {
      title: "Una persona experta firma cada respuesta.",
      lead:
        "Nuestro software lee y ordena. Tu Intelligence Architect decide qué significa. Es una persona con formación en investigación y ciencias sociales que trabaja contigo de principio a fin.",
      points: [
        { name: "Define la pregunta", text: "Convierte tu brief en preguntas que la conversación sí puede responder." },
        { name: "Revisa cada tema", text: "Une, renombra o descarta lo que propone el software antes de que cuente." },
        { name: "Firma la lectura", text: "Interpreta, recomienda y responde por ello frente a ti." }
      ],
      motion: {
        title: "Temas propuestos",
        topics: ["Rutina cansada", "Precio por mililitro", "Cuesta mucho", "Sorteos y regalos", "Textura pesada"],
        merged: "Unido",
        noise: "Ruido",
        approved: "Aprobado",
        role: "Intelligence Architect",
        signed: "Revisado y firmado"
      }
    },
    methods: {
      title: "Métodos que vienen de las ciencias sociales.",
      lead:
        "Para entender por qué la gente decide lo que decide usamos herramientas de la antropología, la psicología y la sociología. Contar dice cuánto se habla de algo. El método dice qué pesa.",
      link: "Conoce los métodos"
    },
    evidence: {
      title: "Cada hallazgo se puede abrir.",
      lead:
        "Detrás de cada cifra hay menciones reales, con su fuente y su fecha. Si algo te sorprende, lo abres y lees lo que escribió la gente.",
      levels: [
        { name: "Medido", text: "Hay base suficiente para dar una cifra." },
        { name: "Direccional", text: "La tendencia es clara, el tamaño todavía no." },
        { name: "Cualitativo", text: "Explica el porqué con palabras de la gente." }
      ],
      motion: {
        finding: "El precio por mililitro frena la compra",
        level: "Medido",
        open: "Ver menciones",
        quotes: [
          { source: "tiktok", date: "12 mar", text: "Me encanta, pero 30 ml me duran tres semanas y no lo vuelvo a comprar." },
          { source: "reddit", date: "9 mar", text: "Hice la cuenta por mililitro y el sérum sale más caro que el perfume." },
          { source: "youtube", date: "4 mar", text: "Lo cambié por un tónico porque rinde el doble por lo mismo." }
        ]
      }
    },
    views: {
      title: "La misma conversación, vista como trabaja cada equipo.",
      lead:
        "Marca, competencia o tu propio marco de la categoría. La conversación se lee una vez y se puede ver de otra forma sin volver a empezar.",
      motion: {
        views: [
          { tab: "Toda la conversación", caption: "Cada mención, una sola vez, con su fuente." },
          { tab: "Vista de marca", caption: "De qué habla la gente cuando habla de tu marca." },
          { tab: "Vista competitiva", caption: "Las mismas menciones, por marca y comparadas." },
          { tab: "Tu propio marco", caption: "Tu forma de ver la categoría, sobre la misma conversación." }
        ],
        topics: ["Producto", "Servicio", "Precio", "Campañas", "Reputación"],
        brands: ["Tu marca", "Competidor A", "Competidor B"],
        framework: "Tu marco",
        nodes: ["Ocasiones", "Necesidades", "Barreras"]
      }
    },
    faq: {
      title: "Preguntas frecuentes",
      lead: "Lo que más nos preguntan sobre cómo trabajamos.",
      items: [
        {
          icon: "search",
          q: "¿Qué fuentes leen?",
          a: "Conversación pública en redes sociales, foros y comunidades, comentarios en video, reseñas, preguntas en marketplaces y volumen de búsquedas. Elegimos las fuentes según tu pregunta: una duda de compra vive en reseñas y foros, un código cultural en comunidades y conversaciones largas, un cambio de reputación en redes abiertas."
        },
        {
          icon: "filter",
          q: "¿Cómo separan la voz de la gente del ruido?",
          a: "Antes de analizar, dejamos fuera lo que no es la voz de la gente: prensa, publicidad, contenido de la propia marca, reventa, spam y comentarios que no hablan del tema. Los criterios están escritos, lo que sale queda registrado y tu Intelligence Architect revisa el resultado."
        },
        {
          icon: "topics",
          q: "¿De dónde salen los temas?",
          a: "De la propia conversación. Nuestro software agrupa lo que la gente dice según cómo lo dice, sin partir de una lista de palabras elegida de antemano. Después tu Intelligence Architect revisa cada tema, lo une, lo renombra o lo descarta antes de que cuente."
        },
        {
          icon: "people",
          q: "¿Qué hace exactamente un Intelligence Architect?",
          a: "Es la persona responsable de tu proyecto. Define contigo la pregunta y el alcance, revisa los temas, corrige lo que esté mal clasificado, interpreta con un método y escribe las recomendaciones. Presenta los resultados y responde por ellos."
        },
        {
          icon: "method",
          q: "¿Qué métodos usan?",
          a: "Tenemos una biblioteca de seis: Triggers & Barriers, Value Perception Matrix, Cultural Codes Decoding, Decision Velocity, Journey Friction Mapping e Influence Architecture. Cada uno parte de una teoría probada sobre el comportamiento humano. Si tu pregunta no encaja en ninguno, construimos el que hace falta."
        },
        {
          icon: "eye",
          q: "¿La conversación es representativa?",
          a: "Representa a quienes hablan en público, que no son toda la población. Por eso cada hallazgo dice si es medido, direccional o cualitativo. La conversación se complementa bien con una encuesta: una mide cuántos y la otra muestra con qué palabras y por qué."
        },
        {
          icon: "time",
          q: "¿Cuánto tarda y cada cuánto recibo resultados?",
          a: "Una pregunta acotada se responde en días, y un estudio va del brief a la primera versión en pocos días. Los reportes continuos llegan cada semana, cada dos semanas o cada mes, según lo que necesites. El alcance fija las fechas antes de empezar."
        },
        {
          icon: "signals",
          q: "¿Qué pasa cuando llega conversación nueva?",
          a: "Se suma a lo que ya está revisado. Los temas aprobados y las correcciones de tu Intelligence Architect se conservan, así que cada entrega se compara con la anterior sin empezar de cero, y lo que no encaja aparece como algo nuevo que vale la pena mirar."
        },
        {
          icon: "data",
          q: "¿Pueden usar mi NPS o mis encuestas?",
          a: "Sí. Llevamos tus datos a los mismos temas que la conversación para ver dónde coinciden y dónde no. Es uno de los cruces que más cambian una decisión."
        },
        {
          icon: "system",
          q: "¿Necesito mi propia herramienta de listening?",
          a: "No. Nosotros ponemos la tecnología y el acceso a las fuentes. Si ya tienes una herramienta, podemos leer sus exportaciones y sumarlas al análisis."
        },
        {
          icon: "live",
          q: "¿Qué recibo al final?",
          a: "Un reporte o un estudio presentado en vivo, con hallazgos, evidencia que se abre hasta la mención, recomendaciones con responsable y las preguntas que convendría validar después. Si es continuo, también tienes un dashboard."
        },
        {
          icon: "languages",
          q: "¿En qué idiomas y países trabajan?",
          a: "Leemos conversación en 16 idiomas, del español y el portugués al pidgin nigeriano y el isiZulu, en más de 20 países de América, Europa y África. Las entregas son en español o inglés."
        },
        {
          icon: "privacy",
          q: "¿Cómo cuidan los datos?",
          a: "Trabajamos solo con conversación pública y dentro de los términos de cada fuente. Analizamos lo que se dice, sin identificar personas ni armar perfiles individuales. Los datos que nos compartes se usan solo para tu proyecto, y cualquier dato sensible pasa por una revisión legal antes de empezar."
        }
      ]
    },
    cta: {
      title: "Trae tu pregunta.",
      text: "En un taller gratis de 30 a 60 minutos vemos qué puede responder la conversación y por dónde empezar.",
      label: "Agenda un taller gratis"
    }
  },
  en: {
    metaTitle: "How Noisia's social intelligence works",
    metaDescription:
      "We read what people say on social media, reviews, forums and search, sort it into topics, and an Intelligence Architect interprets it with methods from the social sciences. You get an answer with the evidence in plain view.",
    hero: {
      title: "We listen to people. We answer your question.",
      lead:
        "We read what is said in public about your brand and your category, sort it into topics, and an expert interprets it with you. You get an answer with the evidence in plain view.",
      process: {
        asks: "Your question",
        question: "Why are young people skipping the serum step?",
        clusters: ["Routine fatigue", "Price per ml", "Texture", "Ingredient trust", "Creator advice", "Sensitive skin"],
        stages: ["The whole conversation", "Duplicates and noise removed", "The voice that matters"],
        steps: ["Your question", "The conversation", "Cleaning", "Topics", "Answer"],
        human: "Intelligence Architect",
        answer: "The answer, ranked",
        linked: "Every point opens its mentions"
      }
    },
    sources: {
      title: "The whole conversation, in one place.",
      lead:
        "Social media, reviews, forums and search. If you have your NPS or surveys, they come in too. We read it together because each source tells a different part of the story.",
      motion: {
        center: "One reading",
        sources: ["TikTok", "Instagram", "YouTube", "X", "Facebook", "Reviews", "Forums", "Search", "NPS and surveys", "CRM"],
        owned: "Your own data"
      }
    },
    architect: {
      title: "An expert signs off every answer.",
      lead:
        "Our software reads and sorts. Your Intelligence Architect decides what it means. They are a person trained in research and the social sciences who works with you from start to finish.",
      points: [
        { name: "Defines the question", text: "Turns your brief into questions the conversation can actually answer." },
        { name: "Reviews every topic", text: "Merges, renames or drops what the software proposes before it counts." },
        { name: "Signs off the reading", text: "Interprets, recommends and answers for it in front of you." }
      ],
      motion: {
        title: "Proposed topics",
        topics: ["Routine fatigue", "Price per ml", "Too expensive", "Giveaways", "Heavy texture"],
        merged: "Merged",
        noise: "Noise",
        approved: "Approved",
        role: "Intelligence Architect",
        signed: "Reviewed and signed"
      }
    },
    methods: {
      title: "Methods that come from the social sciences.",
      lead:
        "To understand why people decide what they decide, we use tools from anthropology, psychology and sociology. Counting tells you how much something is talked about. The method tells you what weighs.",
      link: "Explore the methods"
    },
    evidence: {
      title: "Every finding opens up.",
      lead:
        "Behind every number there are real mentions, with their source and date. If something surprises you, open it and read what people wrote.",
      levels: [
        { name: "Measured", text: "There is enough base to give a number." },
        { name: "Directional", text: "The trend is clear, the size not yet." },
        { name: "Qualitative", text: "It explains the why in people's own words." }
      ],
      motion: {
        finding: "Price per ml holds back the purchase",
        level: "Measured",
        open: "See mentions",
        quotes: [
          { source: "tiktok", date: "Mar 12", text: "Love it, but 30 ml lasts me three weeks and I'm not buying it again." },
          { source: "reddit", date: "Mar 9", text: "Did the math per ml and the serum costs more than my perfume." },
          { source: "youtube", date: "Mar 4", text: "Switched to a toner because it lasts twice as long for the same price." }
        ]
      }
    },
    views: {
      title: "The same conversation, seen the way each team works.",
      lead:
        "Brand, competitors or your own view of the category. The conversation is read once and can be seen another way without starting over.",
      motion: {
        views: [
          { tab: "The whole conversation", caption: "Every mention, once, with its source." },
          { tab: "Brand view", caption: "What people talk about when they talk about your brand." },
          { tab: "Competitive view", caption: "The same mentions, by brand and compared." },
          { tab: "Your own framework", caption: "Your way of seeing the category, on the same conversation." }
        ],
        topics: ["Product", "Service", "Price", "Campaigns", "Reputation"],
        brands: ["Your brand", "Competitor A", "Competitor B"],
        framework: "Your framework",
        nodes: ["Occasions", "Needs", "Barriers"]
      }
    },
    faq: {
      title: "Frequently asked questions",
      lead: "What people ask us most about how we work.",
      items: [
        {
          icon: "search",
          q: "Which sources do you read?",
          a: "Public conversation on social media, forums and communities, video comments, reviews, marketplace questions and search volume. We choose sources for your question: a purchase doubt lives in reviews and forums, a cultural code in communities and long conversations, a reputation shift in open social media."
        },
        {
          icon: "filter",
          q: "How do you separate people's voice from noise?",
          a: "Before any analysis, we leave out what isn't people's voice: press, advertising, the brand's own content, resale, spam and comments that don't talk about the topic. The criteria are written down, what is left out is recorded, and your Intelligence Architect reviews the result."
        },
        {
          icon: "topics",
          q: "Where do the topics come from?",
          a: "From the conversation itself. Our software groups what people say by how they say it, without starting from a keyword list chosen in advance. Then your Intelligence Architect reviews each topic and merges, renames or drops it before it counts."
        },
        {
          icon: "people",
          q: "What exactly does an Intelligence Architect do?",
          a: "They are the person responsible for your project. They define the question and scope with you, review the topics, fix anything misclassified, interpret with a method and write the recommendations. They present the results and answer for them."
        },
        {
          icon: "method",
          q: "Which methods do you use?",
          a: "We have a library of six: Triggers & Barriers, Value Perception Matrix, Cultural Codes Decoding, Decision Velocity, Journey Friction Mapping and Influence Architecture. Each one starts from a tested theory of human behavior. If your question doesn't fit any of them, we build the one it needs."
        },
        {
          icon: "eye",
          q: "Is the conversation representative?",
          a: "It represents the people who speak in public, who are not the whole population. That is why every finding says whether it is measured, directional or qualitative. Conversation pairs well with a survey: one measures how many, the other shows in what words and why."
        },
        {
          icon: "time",
          q: "How long does it take, and how often do I get results?",
          a: "A focused question is answered in days, and a study goes from brief to first version in a few days. Continuous reports arrive every week, every two weeks or every month, depending on what you need. The scope sets the dates before we start."
        },
        {
          icon: "signals",
          q: "What happens when new conversation comes in?",
          a: "It joins what has already been reviewed. Approved topics and your Intelligence Architect's corrections are kept, so each delivery compares against the last one without starting over, and whatever doesn't fit shows up as something new worth a look."
        },
        {
          icon: "data",
          q: "Can you use my NPS or my surveys?",
          a: "Yes. We bring your data into the same topics as the conversation to see where they agree and where they don't. It is one of the comparisons that most often changes a decision."
        },
        {
          icon: "system",
          q: "Do I need my own listening tool?",
          a: "No. We bring the technology and access to the sources. If you already have a tool, we can read its exports and add them to the analysis."
        },
        {
          icon: "live",
          q: "What do I get at the end?",
          a: "A report or a study presented live, with findings, evidence that opens down to the mention, recommendations with an owner and the questions worth validating next. If it is continuous, you also get a dashboard."
        },
        {
          icon: "languages",
          q: "Which languages and countries do you work in?",
          a: "We read conversation in 16 languages, from Spanish and Portuguese to Nigerian Pidgin and isiZulu, across more than 20 countries in the Americas, Europe and Africa. Deliverables come in English or Spanish."
        },
        {
          icon: "privacy",
          q: "How do you handle data?",
          a: "We work only with public conversation and within each source's terms. We analyze what is said, without identifying people or building individual profiles. The data you share with us is used only for your project, and any sensitive data goes through a legal review before we start."
        }
      ]
    },
    cta: {
      title: "Bring your question.",
      text: "In a free 30 to 60 minute workshop we look at what the conversation can answer and where to start.",
      label: "Book a free workshop"
    }
  }
};
