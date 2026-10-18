// Home copy, ES and EN. Draft of 18 oct 2026 built from 06_mensaje.md; review before launch.
import type { HeroCopy } from "@/motion/HeroComposition";

type HomeCopy = {
  hero: { category: string; title: string; lead: string; primary: string; secondary: string; motion: HeroCopy };
  moments: { title: string; lead: string; report: string; study: string; plan: string };
  insights: { title: string; lead: string; all: string };
  how: { title: string; lead: string; steps: { name: string; text: string }[]; human: string; link: string };
  methods: { title: string; lead: string; points: { name: string; text: string }[]; link: string };
  compare: {
    title: string;
    lead: string;
    columns: { name: string; does: string; misses: string }[];
    noisia: { name: string; does: string };
    link: string;
  };
  reach: { title: string; stats: { value: string; label: string }[] };
  start: { title: string; lead: string; steps: { name: string; text: string }[]; cta: string };
};

export const home: Record<"es" | "en", HomeCopy> = {
  es: {
    hero: {
      category: "Inteligencia social",
      title: "Toda la conversación, leída para responder tu pregunta",
      lead: "Noisia es una empresa de tecnología que produce investigación de mercado. Nuestro sistema lee redes, búsquedas, reseñas y tus propios datos. Nuestros Intelligence Architects lo convierten en decisiones, con cada hallazgo ligado a lo que la gente dijo.",
      primary: "Agenda un taller gratis",
      secondary: "Ver insights",
      motion: {
        question: "¿Por qué la gente no regresa después de su primera compra?",
        clusters: ["Precio", "Entrega", "Trato", "Devoluciones", "Espera"],
        noise: "Ruido",
        approved: "Aprobado por un analista",
        answerLabel: "La respuesta",
        answer: "La devolución pesa más que el precio",
        quote: "Me la cambiaron, pero tardaron tres semanas"
      }
    },
    moments: {
      title: "¿Qué necesitas resolver?",
      lead: "Empieza por tu situación. Del otro lado está lo que recibes.",
      report: "Reporte",
      study: "Estudio",
      plan: "Plan anual"
    },
    insights: {
      title: "Lo que encontramos",
      lead: "Hallazgos cortos de nuestra investigación. Cada uno trae la evidencia detrás.",
      all: "Ver todos los insights"
    },
    how: {
      title: "Tecnología que lee todo. Personas que deciden qué importa.",
      lead: "El sistema hace en horas lo que un equipo tardaría semanas en leer. Un Intelligence Architect dirige cada paso.",
      steps: [
        { name: "Tu pregunta", text: "La convertimos en preguntas que la conversación sí puede responder." },
        { name: "Toda la voz", text: "Redes, búsquedas, reseñas y tus datos, en un solo análisis." },
        { name: "Temas que salen de lo que se dice", text: "El sistema agrupa la conversación completa y separa la voz de la gente del ruido." },
        { name: "Evidencia que se puede abrir", text: "Cada cifra sale de un cálculo y cada cita es literal." }
      ],
      human: "Un Intelligence Architect aprueba los temas, corrige al sistema y firma el resultado.",
      link: "Cómo funciona"
    },
    methods: {
      title: "Entender antes de contar",
      lead: "Nuestros métodos parten de la antropología, la sociología y la psicología. Buscan por qué la gente hace lo que hace, no cuántas veces lo dijo.",
      points: [
        { name: "Una biblioteca que crece", text: "Triggers & Barriers es el más usado, pero no el único. Cada teoría sólida sobre comportamiento puede volverse un método." },
        { name: "Lo que pesa no siempre es lo que más se repite", text: "Intensidad, contexto y relación con una decisión cuentan tanto como la frecuencia." },
        { name: "Límites dichos", text: "Cada hallazgo dice si es medido, direccional o cualitativo." }
      ],
      link: "Conoce los métodos"
    },
    compare: {
      title: "¿Por qué no una herramienta o una IA?",
      lead: "Las tres opciones sirven para algo. Ninguna te entrega la respuesta lista.",
      columns: [
        { name: "Herramienta de social listening", does: "Volumen, sentimiento y tableros.", misses: "Alguien de tu equipo tiene que leerlo y decidir." },
        { name: "Pasarle tus menciones a una IA", does: "Un resumen rápido de lo que alcanza a leer.", misses: "Muestrea, no cuenta bien y cada vez responde distinto." },
        { name: "Agencia o instituto", does: "Criterio humano.", misses: "Semanas de trabajo para leer una parte de la conversación." }
      ],
      noisia: { name: "Noisia", does: "La conversación completa, leída por tecnología y aprobada por personas, para responder tu pregunta en días." },
      link: "Ver comparaciones"
    },
    reach: {
      title: "Leemos como habla la gente",
      stats: [
        { value: "16", label: "idiomas de conversación, del español y el portugués al pidgin nigeriano y el isiZulu" },
        { value: "20+", label: "países en América, Europa y África" },
        { value: "Días", label: "del brief a la primera respuesta, no semanas" }
      ]
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
      category: "Social intelligence",
      title: "Every conversation, read to answer your question",
      lead: "Noisia is a technology company that produces market research. Our system reads social media, search, reviews and your own data. Our Intelligence Architects turn it into decisions, with every finding tied to what people actually said.",
      primary: "Book a free workshop",
      secondary: "See insights",
      motion: {
        question: "Why don't customers come back after their first purchase?",
        clusters: ["Price", "Delivery", "Service", "Returns", "Waiting"],
        noise: "Noise",
        approved: "Approved by an analyst",
        answerLabel: "The answer",
        answer: "Returns weigh more than price",
        quote: "They replaced it, but it took three weeks"
      }
    },
    moments: {
      title: "What do you need to solve?",
      lead: "Start from your situation. On the other side is what you receive.",
      report: "Report",
      study: "Study",
      plan: "Annual plan"
    },
    insights: {
      title: "What we found",
      lead: "Short findings from our research. Each one comes with the evidence behind it.",
      all: "See all insights"
    },
    how: {
      title: "Technology that reads everything. People who decide what matters.",
      lead: "The system does in hours what would take a team weeks to read. An Intelligence Architect leads every step.",
      steps: [
        { name: "Your question", text: "We turn it into questions the conversation can actually answer." },
        { name: "Every voice", text: "Social media, search, reviews and your data, in a single analysis." },
        { name: "Topics that come from what people say", text: "The system groups the whole conversation and separates people's voice from the noise." },
        { name: "Evidence you can open", text: "Every number comes from a calculation and every quote is verbatim." }
      ],
      human: "An Intelligence Architect approves the topics, corrects the system and signs off the analysis.",
      link: "How it works"
    },
    methods: {
      title: "Understand before you count",
      lead: "Our methods come from anthropology, sociology and psychology. They look for why people do what they do, not how many times they said it.",
      points: [
        { name: "A growing library", text: "Triggers & Barriers is the one we use most, but not the only one. Any solid theory of behavior can become a method." },
        { name: "What matters is not always what repeats most", text: "Intensity, context and the link to a decision count as much as frequency." },
        { name: "Limits stated", text: "Every finding says whether it is measured, directional or qualitative." }
      ],
      link: "Explore the methods"
    },
    compare: {
      title: "Why not a tool or an AI?",
      lead: "All three are good for something. None of them hands you the answer.",
      columns: [
        { name: "Social listening tool", does: "Volume, sentiment and dashboards.", misses: "Someone on your team still has to read it and decide." },
        { name: "Feeding your mentions to an AI", does: "A quick summary of what it manages to read.", misses: "It samples, miscounts and answers differently every time." },
        { name: "Agency or research firm", does: "Human judgment.", misses: "Weeks of work reading part of the conversation." }
      ],
      noisia: { name: "Noisia", does: "The whole conversation, read by technology and approved by people, to answer your question in days." },
      link: "See comparisons"
    },
    reach: {
      title: "We read the way people talk",
      stats: [
        { value: "16", label: "conversation languages, from Spanish and Portuguese to Nigerian Pidgin and isiZulu" },
        { value: "20+", label: "countries across the Americas, Europe and Africa" },
        { value: "Days", label: "from brief to first answer, not weeks" }
      ]
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
