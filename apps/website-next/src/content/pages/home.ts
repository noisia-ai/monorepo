// Home copy, ES and EN. Rewritten 18 oct 2026 after the UAT review: the hero rotates through
// situations, the comparison and the process live in one tabbed animation. Examples in the
// animations are illustrative.
import type { RotatingHeroCopy } from "@/components/home/RotatingHero";
import type { ApproachCopy } from "@/motion/ApproachComposition";
import type { UnderstandCopy } from "@/motion/UnderstandComposition";

export type ApproachTab = { key: "noisia" | "listening" | "ai" | "agency"; tab: string; title: string; text: string; answers: string };

type HomeCopy = {
  hero: RotatingHeroCopy;
  moments: { title: string; lead: string; report: string; study: string; plan: string; more: string; photos: string; play: string; pause: string };
  insights: { title: string; lead: string; all: string };
  how: { title: string; lead: string; tabs: ApproachTab[]; motion: ApproachCopy; link: string; compareLink: string };
  methods: { title: string; lead: string; motion: UnderstandCopy; points: { name: string; text: string }[]; link: string };
  reach: {
    title: string;
    stats: { value: number; suffix: string; label: string }[];
    time: { steps: string[]; label: string };
  };
  start: { title: string; lead: string; steps: { name: string; text: string }[]; cta: string };
};

export const home: Record<"es" | "en", HomeCopy> = {
  es: {
    hero: {
      heading: "Noisia, inteligencia social: respuestas de negocio a partir de lo que la gente dice",
      slides: [
        { key: "track", tab: "Monitorear", title: "¿Qué cambió este mes con tu marca?", sub: "Cada mes te contamos qué subió, qué bajó y por qué, con lo que la gente dijo como prueba." },
        { key: "launch", tab: "Lanzar", title: "¿La gente de verdad quiere esto?", sub: "Antes de lanzar, sabes qué acerca a la gente a tu idea y qué la frena." },
        { key: "enter", tab: "Entrar a un mercado", title: "¿Cómo compra la gente en Colombia?", sub: "Las reglas no escritas de un mercado nuevo, antes de invertir en él." },
        { key: "defend", tab: "Defender", title: "¿Por qué no regresan después de la primera compra?", sub: "Encontramos el momento en que tu cliente se frustra y qué conviene arreglar primero." }
      ],
      primary: "Agenda un taller gratis",
      secondary: "Ver insights",
      motion: {
        track: {
          header: "Tu marca en la conversación",
          previous: "Ago",
          current: "Sep",
          topics: ["Sabor", "Precio", "Servicio", "Empaque"],
          changeLabel: "Lo que cambió",
          change: "El precio entró a la conversación después del aumento de agosto",
          quote: "Subió 20 pesos y ya lo pienso dos veces"
        },
        launch: {
          conceptLabel: "La idea",
          concept: "Agua mineral sabor jamaica",
          pull: "Lo que acerca",
          push: "Lo que frena",
          pulls: ["Antojo", "Sin azúcar", "Algo nuevo"],
          pushes: ["Precio", "Sabor artificial", "¿Dónde la encuentro?"],
          verdict: "Sí hay ganas. El precio decide."
        },
        enter: {
          bubbles: [
            "¿Alguien sabe dónde lo venden en Medellín?",
            "Lo pedí por WhatsApp y llegó al otro día",
            "Mi tía me lo recomendó y ya no cambio",
            "Contraentrega o nada",
            "En la tienda de la esquina sale más barato"
          ],
          rulesLabel: "Reglas no escritas",
          rules: ["Se compra por recomendación", "WhatsApp es la tienda", "Se paga al recibir"]
        },
        defend: {
          question: "¿Por qué la gente no regresa después de su primera compra?",
          clusters: ["Precio", "Entrega", "Trato", "Devoluciones", "Espera"],
          noise: "Ruido",
          approved: "Aprobado por un experto",
          answerLabel: "La respuesta",
          answer: "La devolución pesa más que el precio",
          quote: "Me la cambiaron, pero tardaron tres semanas"
        }
      }
    },
    moments: {
      title: "¿Qué necesitas resolver?",
      lead: "Cada momento de una marca trae su propia pregunta. Empieza por la tuya.",
      report: "Reporte mensual",
      study: "Estudio",
      plan: "Plan anual",
      more: "Ver cómo lo resolvemos",
      photos: "Fotografías de Unsplash",
      play: "Reproducir",
      pause: "Pausar"
    },
    insights: {
      title: "Desliza para entender a tu mercado",
      lead: "Hallazgos cortos y animados, como los de tu feed, cada uno con su evidencia a un toque.",
      all: "Abrir el feed de insights"
    },
    how: {
      title: "Tecnología que lee todo. Personas que deciden qué importa.",
      lead: "La misma conversación, leída de cuatro maneras. Mira qué te llevas con cada una.",
      tabs: [
        {
          key: "noisia",
          tab: "Noisia",
          title: "La respuesta, con su evidencia",
          text: "Toda la conversación se agrupa en temas. Un Intelligence Architect aprueba lo que importa, separa el ruido y firma la respuesta.",
          answers: "Qué pasa, por qué pasa y qué hacer"
        },
        {
          key: "listening",
          tab: "Social listening",
          title: "Un tablero",
          text: "Volumen, sentimiento y menciones por día. Sirve para vigilar, pero alguien de tu equipo tiene que leerlo y sacar la conclusión.",
          answers: "Cuánto se habla"
        },
        {
          key: "ai",
          tab: "IA genérica",
          title: "Un resumen que suena bien",
          text: "Lee la parte de la conversación que le cabe y escribe un texto. Si vuelves a preguntar, responde distinto, y no hay forma de comprobarlo.",
          answers: "Una opinión rápida"
        },
        {
          key: "agency",
          tab: "Agencia o consultora",
          title: "Criterio sobre una muestra",
          text: "Personas con experiencia leen a mano una parte de la conversación. La lectura es buena, pero toma semanas y deja fuera casi todo.",
          answers: "Una buena lectura de una parte"
        }
      ],
      motion: {
        clusters: ["Precio", "Entrega", "Trato", "Devoluciones", "Espera"],
        noise: "Ruido",
        approved: "Intelligence Architect",
        answerLabel: "La respuesta",
        answer: "La devolución pesa más que el precio",
        mentions: "menciones",
        sentiment: ["Positivo", "Neutral", "Negativo"],
        why: "¿Y por qué?",
        aiRead: "Lo que alcanza a leer",
        aiAgain: "Otra vez, otra respuesta",
        week: "Semana",
        sample: "Leído a mano"
      },
      link: "Cómo funciona",
      compareLink: "Comparaciones a detalle"
    },
    methods: {
      title: "Detrás de cada mención hay alguien",
      lead: "Antes de contar, buscamos qué siente, qué la mueve y qué la frena. Nuestros métodos vienen de la antropología, la sociología y la psicología.",
      motion: {
        quote: "Se me antoja muchísimo, pero mi mamá dice que es carísimo para lo que es",
        layers: ["Psicológica", "Personal", "Social", "Cultural"],
        chips: [
          { text: "Antojo", layer: 0, kind: "trigger" },
          { text: "Precio", layer: 1, kind: "barrier" },
          { text: "Lo que dice mamá", layer: 2, kind: "barrier" },
          { text: "Darse un gusto", layer: 3, kind: "trigger" }
        ],
        trigger: "Lo que la mueve",
        barrier: "Lo que la frena",
        caption: "Una mención, cuatro razones. El conteo viene después."
      },
      points: [
        { name: "Una biblioteca que crece", text: "Triggers & Barriers es uno de varios métodos. Cada teoría sólida sobre comportamiento puede volverse uno nuevo." },
        { name: "Lo que pesa no siempre es lo que más se repite", text: "La intensidad, el contexto y la relación con una decisión cuentan tanto como la frecuencia." },
        { name: "Límites dichos", text: "Cada hallazgo dice si es medido, direccional o cualitativo." }
      ],
      link: "Conoce los métodos"
    },
    reach: {
      title: "Leemos como habla la gente",
      stats: [
        { value: 16, suffix: "", label: "idiomas de conversación, del español y el portugués al pidgin nigeriano y el isiZulu" },
        { value: 20, suffix: "+", label: "países en América, Europa y África" }
      ],
      time: { steps: ["6 semanas", "4 semanas", "2 semanas", "1 semana", "Días"], label: "del brief a la primera respuesta" }
    },
    start: {
      title: "Empieza con una conversación",
      lead: "Trae tu pregunta. Si no tienes brief, lo armamos juntos.",
      steps: [
        { name: "Taller", text: "30 a 60 minutos, sin costo, para entender tu contexto y tu decisión." },
        { name: "Alcance", text: "Fuentes, método, entregables y tiempos, listos para arrancar." },
        { name: "Primera entrega", text: "Presentamos en vivo y respondemos tus preguntas." }
      ],
      cta: "Agenda un taller gratis"
    }
  },
  en: {
    hero: {
      heading: "Noisia, social intelligence: business answers from what people say",
      slides: [
        { key: "track", tab: "Track", title: "What changed with your brand this month?", sub: "Every month we tell you what rose, what fell and why, with what people said as proof." },
        { key: "launch", tab: "Launch", title: "Do people actually want this?", sub: "Before you launch, you know what draws people to your idea and what holds them back." },
        { key: "enter", tab: "Enter a market", title: "How do people shop in Colombia?", sub: "The unwritten rules of a new market, before you invest in it." },
        { key: "defend", tab: "Defend", title: "Why don't they come back after the first purchase?", sub: "We find the moment your customer gets frustrated and what is worth fixing first." }
      ],
      primary: "Book a free workshop",
      secondary: "See insights",
      motion: {
        track: {
          header: "Your brand in the conversation",
          previous: "Aug",
          current: "Sep",
          topics: ["Taste", "Price", "Service", "Packaging"],
          changeLabel: "What changed",
          change: "Price entered the conversation after the August increase",
          quote: "It went up 20 pesos and now I think twice"
        },
        launch: {
          conceptLabel: "The idea",
          concept: "Hibiscus sparkling water",
          pull: "What draws them",
          push: "What holds them back",
          pulls: ["Craving", "No sugar", "Something new"],
          pushes: ["Price", "Artificial taste", "Where do I find it?"],
          verdict: "People want it. Price decides."
        },
        enter: {
          bubbles: [
            "Anyone know where they sell it in Medellín?",
            "Ordered it on WhatsApp, it came the next day",
            "My aunt recommended it and I never switched",
            "Cash on delivery or nothing",
            "It's cheaper at the corner store"
          ],
          rulesLabel: "Unwritten rules",
          rules: ["People buy on recommendation", "WhatsApp is the store", "You pay on delivery"]
        },
        defend: {
          question: "Why don't customers come back after their first purchase?",
          clusters: ["Price", "Delivery", "Service", "Returns", "Waiting"],
          noise: "Noise",
          approved: "Approved by an expert",
          answerLabel: "The answer",
          answer: "Returns weigh more than price",
          quote: "They replaced it, but it took three weeks"
        }
      }
    },
    moments: {
      title: "What do you need to solve?",
      lead: "Every moment of a brand brings its own question. Start with yours.",
      report: "Monthly report",
      study: "Study",
      plan: "Annual plan",
      more: "See how we solve it",
      photos: "Photos from Unsplash",
      play: "Play",
      pause: "Pause"
    },
    insights: {
      title: "Swipe to understand your market",
      lead: "Short animated findings, like the ones in your feed, each one a tap away from its evidence.",
      all: "Open the insights feed"
    },
    how: {
      title: "Technology that reads everything. People who decide what matters.",
      lead: "The same conversation, read four ways. See what you walk away with each time.",
      tabs: [
        {
          key: "noisia",
          tab: "Noisia",
          title: "The answer, with its evidence",
          text: "The whole conversation is grouped into topics. An Intelligence Architect approves what matters, removes the noise and signs the answer.",
          answers: "What is happening, why, and what to do"
        },
        {
          key: "listening",
          tab: "Social listening",
          title: "A dashboard",
          text: "Volume, sentiment and mentions per day. Useful to keep watch, but someone on your team still has to read it and draw the conclusion.",
          answers: "How much people talk"
        },
        {
          key: "ai",
          tab: "Generic AI",
          title: "A summary that sounds right",
          text: "It reads the part of the conversation that fits and writes a text. Ask again and it answers differently, with no way to check.",
          answers: "A quick opinion"
        },
        {
          key: "agency",
          tab: "Agency or consultancy",
          title: "Judgment on a sample",
          text: "Experienced people read part of the conversation by hand. The reading is good, but it takes weeks and leaves almost everything out.",
          answers: "A good reading of a part"
        }
      ],
      motion: {
        clusters: ["Price", "Delivery", "Service", "Returns", "Waiting"],
        noise: "Noise",
        approved: "Intelligence Architect",
        answerLabel: "The answer",
        answer: "Returns weigh more than price",
        mentions: "mentions",
        sentiment: ["Positive", "Neutral", "Negative"],
        why: "But why?",
        aiRead: "What fits in its window",
        aiAgain: "Ask again, new answer",
        week: "Week",
        sample: "Read by hand"
      },
      link: "How it works",
      compareLink: "Detailed comparisons"
    },
    methods: {
      title: "Behind every mention there is someone",
      lead: "Before counting, we look for what they feel, what drives them and what holds them back. Our methods come from anthropology, sociology and psychology.",
      motion: {
        quote: "I really want it, but my mom says it's way too expensive for what it is",
        layers: ["Psychological", "Personal", "Social", "Cultural"],
        chips: [
          { text: "Craving", layer: 0, kind: "trigger" },
          { text: "Price", layer: 1, kind: "barrier" },
          { text: "What mom says", layer: 2, kind: "barrier" },
          { text: "A little treat", layer: 3, kind: "trigger" }
        ],
        trigger: "What drives her",
        barrier: "What holds her back",
        caption: "One mention, four reasons. Counting comes after."
      },
      points: [
        { name: "A growing library", text: "Triggers & Barriers is one of several methods. Any solid theory of behavior can become a new one." },
        { name: "What matters is not always what repeats most", text: "Intensity, context and the link to a decision count as much as frequency." },
        { name: "Limits stated", text: "Every finding says whether it is measured, directional or qualitative." }
      ],
      link: "Explore the methods"
    },
    reach: {
      title: "We read the way people talk",
      stats: [
        { value: 16, suffix: "", label: "conversation languages, from Spanish and Portuguese to Nigerian Pidgin and isiZulu" },
        { value: 20, suffix: "+", label: "countries across the Americas, Europe and Africa" }
      ],
      time: { steps: ["6 weeks", "4 weeks", "2 weeks", "1 week", "Days"], label: "from brief to first answer" }
    },
    start: {
      title: "Start with a conversation",
      lead: "Bring your question. If you don't have a brief, we build it together.",
      steps: [
        { name: "Workshop", text: "30 to 60 minutes, free, to understand your context and your decision." },
        { name: "Scope", text: "Sources, method, deliverables and timing, ready to start." },
        { name: "First delivery", text: "We present it live and answer your questions." }
      ],
      cta: "Book a free workshop"
    }
  }
};
