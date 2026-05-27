export type FoundationEntry = {
  theory: string;
  author: string;
  description: string;
  link: string;
};

export type Methodology = {
  slug: string;
  number: string;
  name: string;
  question: string;
  lead: string;
  foundations: FoundationEntry[];
  problem: string;
  protocol: string[];
  outputs: string[];
  uses: string;
  limitations: string;
  reading: string[];
};

export type UseCase = {
  slug: string;
  title: string;
  shortTitle: string;
  industries: string;
  methodologies: string[];
  approach: string;
  deliverables: string[];
  vignette: string;
};

export type ProductConsoleScene = {
  slug: string;
  tab: string;
  label: string;
  title: string;
  methodologies: string[];
  question: string;
  insight: string;
  summary: string;
  metrics: Array<{
    label: string;
    value: string;
    tone?: "positive" | "tension";
  }>;
  sourceQuote: string;
  sourceMeta: Array<{
    label: string;
    value: string;
  }>;
  chatPrompt: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export type HomeUseCase = {
  slug: string;
  title: string;
  shortTitle: string;
  methodologies: string[];
  reading: string;
  deliverables: string[];
};

export const site = {
  name: "Noisia",
  eyebrow: "SOCIAL INTELLIGENCE ARCHITECTS",
  description:
    "Noisia convierte conversación pública en decisiones claras para equipos de marca, producto y estrategia.",
  nav: [
    { label: "Insights", href: "/insights" },
    { label: "Metodologías", href: "/metodologias" },
    { label: "Arquitectura", href: "/arquitectura-de-datos" },
    { label: "Casos", href: "/casos-de-uso" },
    { label: "Servicios", href: "/servicios" }
  ]
};

export const productSurfaces = [
  {
    name: "Brief de lectura",
    description: "La pregunta estratégica se define antes de empezar a analizar.",
    proof: "Mercado, hipótesis, fuentes y salida esperada quedan visibles desde el inicio."
  },
  {
    name: "Alcance claro",
    description: "Cada corrida explica su costo antes de ejecutarse.",
    proof: "Sin consumo opaco: ves qué compra cada crédito y qué profundidad habilita."
  },
  {
    name: "Reporte narrativo",
    description: "El reporte funciona como argumento, no como tablero de métricas sueltas.",
    proof: "Tesis, tensión, recomendación, cortes de lectura y evidencia a la vista."
  },
  {
    name: "Fuentes abiertas",
    description: "Cada insight conserva la fuente que lo sostiene.",
    proof: "Texto original, fecha, plataforma, mercado, tags y razón de relevancia."
  },
  {
    name: "Chat con la lectura",
    description: "Una conversación con el reporte para cambiar de ángulo sin perder evidencia.",
    proof: "Preguntas, respuestas, citas y acciones sobre el reporte."
  },
  {
    name: "Exportables",
    description: "Las salidas se preparan para decisión, cliente o equipo.",
    proof: "Link privado, PPT, snapshot, resumen ejecutivo y narrativa editable."
  }
];

export const productConsoleScenes: ProductConsoleScene[] = [
  {
    slug: "lanzamiento-de-campana",
    tab: "Campaña",
    label: "01 · Caso de uso",
    title: "Lanzamiento de campaña · México",
    methodologies: ["Cultural Codes", "Triggers & Barriers"],
    question: "¿Qué historia tiene permiso real en la categoría mexicana?",
    insight: "No gana el territorio más aspiracional. Gana el que México ya reconoce.",
    summary:
      "Probamos territorios creativos contra conversación real para elegir un ángulo que no suene prestado. La lectura separa deseo, permiso cultural y barreras antes de invertir en pauta.",
    metrics: [
      { label: "permiso cultural", value: "67.4%", tone: "positive" },
      { label: "riesgo de genericidad", value: "28.9%", tone: "tension" }
    ],
    sourceQuote: "Está bueno, pero si lo dicen como todas las marcas, no se siente de aquí.",
    sourceMeta: [
      { label: "Fuente", value: "TikTok + comentarios largos" },
      { label: "Mercado", value: "México" },
      { label: "Tag", value: "territorio · permiso · lenguaje local" }
    ],
    chatPrompt: "Convierte esto en un brief para campaña.",
    ctaHref: "/casos-de-uso/lanzamiento-de-campana",
    ctaLabel: "Ver caso"
  },
  {
    slug: "optimizacion-de-medios",
    tab: "Medios",
    label: "02 · Caso de uso",
    title: "Optimización de medios · México",
    methodologies: ["Journey Friction Mapping", "Decision Velocity"],
    question: "¿Dónde se rompe el mensaje antes de que convierta?",
    insight: "No siempre falla el canal. A veces falla la promesa en el momento equivocado.",
    summary:
      "Cruzamos funnel, reviews, comentarios y dudas previas a la compra para ubicar qué información falta, qué promesa confunde y qué pieza conviene corregir primero.",
    metrics: [
      { label: "fricción de journey", value: "46.8%", tone: "tension" },
      { label: "mensaje reparable", value: "54.1%", tone: "positive" }
    ],
    sourceQuote: "Me interesaba, pero antes de pagar quería ver qué pasaba si no me funcionaba.",
    sourceMeta: [
      { label: "Fuente", value: "Shopify + Google Reviews" },
      { label: "Mercado", value: "México" },
      { label: "Tag", value: "checkout · prueba · reversibilidad" }
    ],
    chatPrompt: "Dame el cambio de mensaje para performance.",
    ctaHref: "/casos-de-uso/optimizacion-de-medios",
    ctaLabel: "Ver caso"
  },
  {
    slug: "desarrollo-de-producto",
    tab: "Producto",
    label: "03 · Caso de uso",
    title: "Desarrollo de producto · México",
    methodologies: ["Triggers & Barriers", "Value Perception Matrix"],
    question: "¿Qué necesidad real sigue mal resuelta?",
    insight: "La oportunidad no siempre es otra feature. A veces es bajar el riesgo de probar.",
    summary:
      "Leemos reseñas, tickets, preguntas de marketplace y comunidades para detectar jobs que la gente ya intenta resolver mal con alternativas existentes.",
    metrics: [
      { label: "unmet job visible", value: "49.6%", tone: "positive" },
      { label: "barrera de prueba", value: "34.2%", tone: "tension" }
    ],
    sourceQuote: "Quiero probar, pero ya me cansé de comprar cosas que prometen y luego no responden.",
    sourceMeta: [
      { label: "Fuente", value: "Amazon + Zendesk + App Store" },
      { label: "Mercado", value: "México" },
      { label: "Tag", value: "job · riesgo · confianza" }
    ],
    chatPrompt: "Dame tres rutas de producto con menor riesgo percibido.",
    ctaHref: "/casos-de-uso/desarrollo-de-producto",
    ctaLabel: "Ver caso"
  },
  {
    slug: "defensa-competitiva",
    tab: "Competencia",
    label: "04 · Caso de uso",
    title: "Defensa competitiva · México",
    methodologies: ["Triggers & Barriers", "Journey Friction Mapping"],
    question: "¿Qué promesa del competidor se volvió más creíble?",
    insight: "La migración rara vez se explica solo por precio.",
    summary:
      "Identificamos cuándo se rompe la lealtad, qué narrativa de cambio usa la gente y qué fricción puede reparar la marca antes de regalar margen.",
    metrics: [
      { label: "narrativa de migración", value: "61.3%", tone: "tension" },
      { label: "defensa accionable", value: "43.7%", tone: "positive" }
    ],
    sourceQuote: "No me fui por barato. Me fui porque allá sí explican qué pasa cuando algo sale mal.",
    sourceMeta: [
      { label: "Fuente", value: "Reddit + Salesforce + reseñas" },
      { label: "Mercado", value: "México" },
      { label: "Tag", value: "migración · soporte · transparencia" }
    ],
    chatPrompt: "Convierte esto en defensa competitiva.",
    ctaHref: "/casos-de-uso/defensa-competitiva",
    ctaLabel: "Ver caso"
  },
  {
    slug: "anticipacion-de-tendencias",
    tab: "Mercado",
    label: "05 · Caso de uso",
    title: "Anticipación de tendencias · México",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    question: "¿Qué señal viene creciendo antes de volverse obvia?",
    insight: "Una tendencia útil aparece primero como vocabulario raro, no como hashtag masivo.",
    summary:
      "Detectamos señales débiles en comunidades, comentarios largos y voces puente para saber qué monitorear antes de que el mercado lo nombre.",
    metrics: [
      { label: "vocabulario emergente", value: "37.8%", tone: "positive" },
      { label: "pico sin profundidad", value: "22.6%", tone: "tension" }
    ],
    sourceQuote: "Todavía no sé cómo llamarlo, pero cada vez más gente lo está pidiendo así.",
    sourceMeta: [
      { label: "Fuente", value: "TikTok + foros + YouTube" },
      { label: "Mercado", value: "México" },
      { label: "Tag", value: "señal débil · lenguaje · validadores" }
    ],
    chatPrompt: "¿Qué voces conviene monitorear en México?",
    ctaHref: "/casos-de-uso/anticipacion-de-tendencias",
    ctaLabel: "Ver caso"
  }
];

export const homeUseCases: HomeUseCase[] = [
  {
    slug: "lanzamiento-de-campana",
    shortTitle: "Lanzamiento de campaña",
    title: "Voy a lanzar campaña. ¿Qué historia tiene permiso real?",
    methodologies: ["Cultural Codes", "Triggers & Barriers"],
    reading:
      "Probamos territorios contra conversación real para saber cuál conecta sin sentirse forzado. Casi nunca gana el más aspiracional: gana el que convierte una frustración cotidiana en una idea fácil de defender.",
    deliverables: ["Mapa de tensión cultural", "Brief de ángulo de campaña", "Narrativa con fuentes"]
  },
  {
    slug: "optimizacion-de-medios",
    shortTitle: "Optimización de medios",
    title: "Mi plan de medios no convierte. ¿Dónde se rompe el mensaje?",
    methodologies: ["Journey Friction Mapping", "Decision Velocity"],
    reading:
      "Cruzamos lo que dice el funnel con lo que la gente expresa antes de comprar. A veces no falla el canal ni la frecuencia: falla una promesa que acelera a expertos y confunde a compradores nuevos.",
    deliverables: ["Mapa de fricción", "Bloqueos de velocidad", "Plan de reparación de mensaje"]
  },
  {
    slug: "desarrollo-de-producto",
    shortTitle: "Desarrollo de producto",
    title: "Necesito producto nuevo. ¿Qué necesidad sigue mal resuelta?",
    methodologies: ["Triggers & Barriers", "Value Perception Matrix"],
    reading:
      "Leemos reviews y foros para separar deseos bonitos de oportunidades reales. Muchas veces la innovación no es otra feature: es reducir un riesgo que nadie está comunicando como valor.",
    deliverables: ["Landscape de jobs", "Reporte de whitespace", "Direcciones de concepto"]
  },
  {
    slug: "entrada-a-nuevo-mercado",
    shortTitle: "Entrada a México",
    title: "Vamos a entrar o crecer en México. ¿Qué nos daría permiso local?",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    reading:
      "Una categoría no aterriza igual en México que en otros mercados. Identificamos qué significa localmente, quién la legitima y qué narrativas la rechazan para entrar con un ángulo creíble.",
    deliverables: ["Dossier de código local", "Mapa de influencia de categoría", "Brief de entrada de mercado"]
  },
  {
    slug: "defensa-competitiva",
    shortTitle: "Defensa competitiva",
    title: "Estoy perdiendo share. ¿Qué está ganando el competidor?",
    methodologies: ["Triggers & Barriers", "Journey Friction Mapping"],
    reading:
      "Analizamos las razones que la gente usa para irse: cuándo se rompe la lealtad, qué lo dispara y qué promesa del competidor se siente más justa, simple o confiable.",
    deliverables: ["Mapa de narrativas de migración", "Barreras de retención", "Brief de defensa competitiva"]
  },
  {
    slug: "anticipacion-de-tendencias",
    shortTitle: "Anticipación de tendencias",
    title: "Mi categoría se está moviendo. ¿Qué señal viene creciendo?",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    reading:
      "Las tendencias útiles suelen empezar como lenguaje nuevo, hábitos pequeños o voces que conectan nichos. Las detectamos antes de que se vuelvan obvias, cuando todavía puedes decidir y no solo reaccionar.",
    deliverables: ["Radar de señales débiles", "Vocabulario emergente", "Dossier de nodos tempranos"]
  },
  {
    slug: "decodificacion-de-crisis",
    shortTitle: "Crisis",
    title: "Estamos en crisis. ¿Qué está alimentando la conversación?",
    methodologies: ["Influence Architecture", "Cultural Codes"],
    reading:
      "No miramos solo volumen. Identificamos quién sostiene la narrativa, qué frase la vuelve repetible y qué tipo de respuesta puede bajarle fuerza sin amplificarla.",
    deliverables: ["Mapa narrativo de crisis", "Lista de nodos de riesgo", "Estrategia de respuesta"]
  }
];

export const methodologies: Methodology[] = [
  {
    slug: "triggers-y-barriers",
    number: "01",
    name: "Triggers & Barriers",
    question: "¿Qué empuja la compra y qué la detiene?",
    lead:
      "Separamos los motivos que acercan a la compra de las dudas que la frenan, para saber qué puede mover tu marca y qué conviene dejar de empujar.",
    foundations: [
      {
        theory: "Dual-Process Theory",
        author: "Kahneman (2011)",
        description: "Decisiones entre el sistema rápido e intuitivo y el lento y deliberativo.",
        link: "https://en.wikipedia.org/wiki/Thinking,_Fast_and_Slow"
      },
      {
        theory: "Jobs-to-be-Done",
        author: "Christensen (2016)",
        description: "Trabajos funcionales, emocionales y sociales que el consumidor intenta resolver.",
        link: "https://en.wikipedia.org/wiki/Jobs_to_be_done_theory"
      },
      {
        theory: "Self-Determination Theory",
        author: "Deci & Ryan (1985)",
        description: "Motivaciones internas y externas como motores diferenciados del comportamiento.",
        link: "https://en.wikipedia.org/wiki/Self-determination_theory"
      },
      {
        theory: "Friction Theory",
        author: "Nordgren & Schonthal (2021)",
        description: "Inercia, esfuerzo, emoción y reactancia como fuerzas que bloquean el cambio.",
        link: "https://en.wikipedia.org/wiki/Behavioral_inhibition"
      }
    ],
    problem:
      "Las marcas suelen conocer lo que la gente dice en una investigación formal. Aquí buscamos lo que aparece cuando habla sin guion: qué la acerca, qué la frena y qué no se atreve a decir tan claro.",
    protocol: [
      "Definimos qué intenta resolver la gente en la categoría.",
      "Leemos reviews, foros, comentarios largos y comunidades donde la duda aparece completa.",
      "Separamos frases que empujan la decisión de frases que la frenan.",
      "Priorizamos por tamaño, intensidad y capacidad de mover comportamiento.",
      "Traducimos cada fuerza a una acción posible en comunicación, producto o experiencia."
    ],
    outputs: [
      "Mapa de motivadores",
      "Plan de activación",
      "Plan para quitar fricción",
      "Comparativo con hasta tres competidores"
    ],
    uses:
      "Lanzamientos, optimización de conversión, defensa competitiva y mensajes que necesitan activar comportamiento.",
    limitations:
      "No estima tamaño de mercado ni reemplaza pruebas cuantitativas. Sirve para entender qué mueve la decisión y qué la bloquea.",
    reading: [
      "Kahneman, D. Thinking, Fast and Slow.",
      "Christensen, C. Competing Against Luck.",
      "Nordgren, L. & Schonthal, D. The Human Element.",
      "Deci, E. & Ryan, R. Self-Determination Theory."
    ]
  },
  {
    slug: "value-perception-matrix",
    number: "02",
    name: "Value Perception Matrix",
    question: "¿Por qué te eligen cuando no eres la opción más barata?",
    lead:
      "Mide valor como lo vive el consumidor: dinero, tiempo, esfuerzo y riesgo. Así vemos dónde tu marca justifica margen y dónde está pagando una prima sin retorno.",
    foundations: [
      {
        theory: "Perceived Value",
        author: "Zeithaml (1988)",
        description: "Evaluación subjetiva de utilidad: lo que se recibe comparado contra lo que se entrega.",
        link: "https://en.wikipedia.org/wiki/Value_(marketing)"
      },
      {
        theory: "Prospect Theory",
        author: "Kahneman & Tversky (1979)",
        description: "Las pérdidas pesan desproporcionadamente más que las ganancias equivalentes.",
        link: "https://en.wikipedia.org/wiki/Prospect_theory"
      },
      {
        theory: "Brand Benefits Framework",
        author: "Park, Jaworski & MacInnis (1986)",
        description: "Beneficios funcionales, emocionales y simbólicos como dimensiones del valor de marca.",
        link: "https://en.wikipedia.org/wiki/Brand_equity"
      },
      {
        theory: "Customer-Based Brand Equity",
        author: "Keller (1993)",
        description: "La marca como red asociativa en la memoria del consumidor, construida por experiencias.",
        link: "https://en.wikipedia.org/wiki/Brand_equity"
      }
    ],
    problem:
      "Tu marca puede explicar valor de una forma, pero la gente lo compara contra alternativas reales: precio, tiempo, riesgo, confianza y esfuerzo.",
    protocol: [
      "Reconstruimos contra qué alternativas compara la gente.",
      "Detectamos qué entiende como valor: ahorro, rapidez, confianza, estatus o menor riesgo.",
      "Clasificamos menciones por dimensión y tono.",
      "Comparamos marca, competidores y sustitutos bajo los mismos criterios.",
      "Detectamos argumentos de valor, huecos defensivos y oportunidades de diferenciación."
    ],
    outputs: [
      "Mapa de valor percibido",
      "Oportunidades de diferenciación",
      "Brief de defensa de margen",
      "Hipótesis de recategorización"
    ],
    uses:
      "Reposicionamiento, propuesta de valor, defensa de margen y evaluación post-lanzamiento.",
    limitations:
      "La matriz compara percepción; no mide elasticidad de precio ni reemplaza un estudio cuantitativo de pricing.",
    reading: [
      "Zeithaml, V. Consumer Perceptions of Price, Quality, and Value.",
      "Kahneman, D. & Tversky, A. Prospect Theory.",
      "Keller, K. L. Customer-Based Brand Equity.",
      "Park, C. W., Jaworski, B. & MacInnis, D. Strategic Brand Concept-Image Management."
    ]
  },
  {
    slug: "cultural-codes-decoding",
    number: "03",
    name: "Cultural Codes Decoding",
    question: "¿Qué significa tu categoría en la vida real de la gente?",
    lead:
      "Toda categoría tiene reglas no escritas: qué se admira, qué incomoda y qué da permiso. Las hacemos visibles para elegir un lenguaje que sí pertenezca.",
    foundations: [
      {
        theory: "Semiótica Estructural",
        author: "Saussure (1916)",
        description: "Los signos adquieren significado por oposición a otros dentro de un sistema simbólico.",
        link: "https://en.wikipedia.org/wiki/Semiotic_theory_of_Ferdinand_de_Saussure"
      },
      {
        theory: "Mitologías",
        author: "Barthes (1957)",
        description: "Los objetos de consumo operan como mitos culturales con significados de segundo orden.",
        link: "https://en.wikipedia.org/wiki/Mythologies_(book)"
      },
      {
        theory: "Descripción Densa",
        author: "Geertz (1973)",
        description: "La interpretación cultural requiere leer el contexto local desde adentro, no desde afuera.",
        link: "https://en.wikipedia.org/wiki/Thick_description"
      },
      {
        theory: "Bienes como Comunicación",
        author: "Douglas & Isherwood (1979)",
        description: "Los bienes de consumo funcionan como sistemas de comunicación social y simbólica.",
        link: "https://en.wikipedia.org/wiki/The_World_of_Goods"
      }
    ],
    problem:
      "Una idea puede funcionar en un mercado y sonar ajena en otro. Este método ayuda a entender qué lenguaje pertenece, qué incomoda y qué da permiso.",
    protocol: [
      "Leemos fuentes culturalmente densas: foros, comunidades, comentarios largos y lenguaje local.",
      "Identificamos palabras, metaforas y comparaciones recurrentes.",
      "Mapeamos qué se admira, qué se ridiculiza, qué se rechaza y qué se considera auténtico.",
      "Reconstruimos las reglas no escritas de la categoría.",
      "Ubicamos marcas y competidores dentro de esas reglas para encontrar espacios creíbles."
    ],
    outputs: ["Dossier de código cultural", "Mapa simbólico", "Brief de entrada cultural"],
    uses:
      "Entrada a nuevo mercado, reposicionamiento, lanzamiento de marca y adaptación de campañas globales.",
    limitations:
      "No produce certezas estadísticas. Produce una lectura cultural para decidir con más contexto.",
    reading: [
      "Barthes, R. Mythologies.",
      "Geertz, C. The Interpretation of Cultures.",
      "Douglas, M. & Isherwood, B. The World of Goods.",
      "Mick, D. G. Consumer Research and Semiotics."
    ]
  },
  {
    slug: "decision-velocity",
    number: "04",
    name: "Decision Velocity",
    question: "¿Qué acelera o frena la decisión?",
    lead:
      "Hay compras que se resuelven rápido y otras que piden prueba, control o comparación. Detectamos qué debe aparecer antes para que la decisión avance.",
    foundations: [
      {
        theory: "Dual-Process Theory",
        author: "Kahneman (2011)",
        description: "Sistema 1 rápido e intuitivo vs Sistema 2 lento y esforzado: dos modos de decidir.",
        link: "https://en.wikipedia.org/wiki/Dual_process_theory"
      },
      {
        theory: "Choice Architecture",
        author: "Thaler & Sunstein (2008)",
        description: "Cómo se presentan las opciones determina qué se elige, independientemente del contenido.",
        link: "https://en.wikipedia.org/wiki/Choice_architecture"
      },
      {
        theory: "Decision Fatigue",
        author: "Baumeister (1998)",
        description: "La capacidad de decidir se agota con el uso, degradando la calidad de decisiones tardías.",
        link: "https://en.wikipedia.org/wiki/Decision_fatigue"
      },
      {
        theory: "Information Foraging",
        author: "Pirolli & Card (1999)",
        description: "Los usuarios buscan información como maximización del valor obtenido por costo cognitivo.",
        link: "https://en.wikipedia.org/wiki/Information_foraging"
      }
    ],
    problem:
      "A veces el mensaje no falla por creatividad, sino porque llega en el momento equivocado. La gente necesita prueba, control o comparación antes de avanzar.",
    protocol: [
      "Reconstruimos cómo decide la gente antes de comprar, registrarse o recomendar.",
      "Identificamos qué información busca, a quién consulta y cuándo se detiene.",
      "Separamos decisiones rápidas de decisiones que piden más explicación.",
      "Detectamos qué acelera y qué bloquea el avance.",
      "Recomendamos qué mostrar antes, qué simplificar y qué dejar para después."
    ],
    outputs: [
      "Diagnóstico de velocidad",
      "Bloqueos de decisión",
      "Aceleradores de decisión",
      "Brief de arquitectura de elección"
    ],
    uses:
      "Optimización de conversión, ecommerce, pricing pages, formularios, configuradores y lanzamientos donde la decisión se traba.",
    limitations:
      "No reemplaza un A/B test. Ayuda a elegir qué hipótesis vale la pena probar.",
    reading: [
      "Kahneman, D. Thinking, Fast and Slow.",
      "Thaler, R. & Sunstein, C. Nudge.",
      "Iyengar, S. The Art of Choosing.",
      "Pirolli, P. & Card, S. Information Foraging."
    ]
  },
  {
    slug: "journey-friction-mapping",
    number: "05",
    name: "Journey Friction Mapping",
    question: "¿Dónde se pierde la intención antes de convertirse en acción?",
    lead:
      "El recorrido dibujado en un workshop es una hipótesis. El real aparece en las dudas, quejas y comparaciones de la gente. Ahí ubicamos los puntos que hacen caer la acción.",
    foundations: [
      {
        theory: "Customer Journey Theory",
        author: "Lemon & Verhoef (2016)",
        description: "Los touchpoints dinámicos, no el embudo, son la unidad de análisis de la experiencia real.",
        link: "https://en.wikipedia.org/wiki/Customer_experience"
      },
      {
        theory: "Friction Theory",
        author: "Nordgren & Schonthal (2021)",
        description: "Inercia, esfuerzo, emoción y reactancia como los cuatro tipos de fricción en el comportamiento.",
        link: "https://en.wikipedia.org/wiki/Behavioral_economics"
      },
      {
        theory: "Cognitive Load Theory",
        author: "Sweller (1988)",
        description: "La carga cognitiva excesiva provoca abandono antes de completar la acción deseada.",
        link: "https://en.wikipedia.org/wiki/Cognitive_load"
      },
      {
        theory: "Peak-End Rule",
        author: "Kahneman (1993)",
        description: "La memoria de una experiencia la dominan su pico emocional y su último momento.",
        link: "https://en.wikipedia.org/wiki/Peak%E2%80%93end_rule"
      }
    ],
    problem:
      "La analítica web puede mostrar dónde se cae la gente, pero no siempre explica por qué. Aquí buscamos las dudas y fricciones que aparecen antes de abandonar.",
    protocol: [
      "Reconstruimos el recorrido como lo vive la gente.",
      "Clasificamos dudas, esfuerzo, enojo o confusión por etapa.",
      "Detectamos puntos donde la intención se rompe.",
      "Cruzamos esas fricciones con momentos que la marca puede corregir.",
      "Priorizamos qué remover primero por impacto y dificultad."
    ],
    outputs: ["Mapa de fricción", "Puntos de quiebre", "Roadmap de mejora"],
    uses:
      "Optimización de conversión, rediseño de experiencia, defensa de share y expansión a nuevos canales.",
    limitations:
      "Captura fricciones que la gente expresa. Las fricciones invisibles requieren observación directa o pruebas de usabilidad.",
    reading: [
      "Lemon, K. & Verhoef, P. Understanding Customer Experience Throughout the Customer Journey.",
      "Nordgren, L. & Schonthal, D. The Human Element.",
      "Sweller, J. Cognitive Load During Problem Solving.",
      "Kahneman, D. Peak-End Rule research."
    ]
  },
  {
    slug: "influence-architecture",
    number: "06",
    name: "Influence Architecture",
    question: "¿Qué voces hacen creíble una idea en tu categoría?",
    lead:
      "La influencia que importa no siempre tiene más seguidores. Mapeamos las voces que conectan comunidades, validan ideas y cambian cómo se interpreta la categoría.",
    foundations: [
      {
        theory: "Strength of Weak Ties",
        author: "Granovetter (1973)",
        description: "Los lazos débiles son los canales privilegiados para transmitir información nueva entre comunidades.",
        link: "https://en.wikipedia.org/wiki/Interpersonal_ties"
      },
      {
        theory: "Diffusion of Innovations",
        author: "Rogers (1962)",
        description: "Roles diferenciados en la adopción: innovators, early adopters, majorities, laggards.",
        link: "https://en.wikipedia.org/wiki/Diffusion_of_innovations"
      },
      {
        theory: "Two-Step Flow",
        author: "Katz & Lazarsfeld (1955)",
        description: "Los opinion leaders median entre los medios masivos y la adopción real de ideas.",
        link: "https://en.wikipedia.org/wiki/Two-step_flow_of_communication"
      },
      {
        theory: "Scale-Free Networks",
        author: "Barabási (1999)",
        description: "Las redes tienen hubs que concentran desproporcionadamente el flujo de información.",
        link: "https://en.wikipedia.org/wiki/Scale-free_network"
      }
    ],
    problem:
      "La voz más grande no siempre es la más creíble. Muchas decisiones se mueven por especialistas, comunidades puente y personas que validan antes de que el tema sea masivo.",
    protocol: [
      "Mapeamos comunidades alrededor de la categoría.",
      "Identificamos voces que conectan grupos, validan ideas o bloquean narrativas.",
      "Separamos especialistas, conectores, detractores, validadores y comunidades puente.",
      "Vemos cómo viajan las ideas entre grupos.",
      "Priorizamos qué voces conviene escuchar, activar o monitorear."
    ],
    outputs: [
      "Mapa de influencia",
      "Dossier de voces clave",
      "Estrategia de activación",
      "Sistema de alerta temprana"
    ],
    uses:
      "Estrategias de influencia, lanzamientos especializados, defensa reputacional, tendencias emergentes y comunidades de marca.",
    limitations:
      "Identifica la estructura de influencia. La activación requiere contenido relevante y respeto por cada comunidad.",
    reading: [
      "Granovetter, M. The Strength of Weak Ties.",
      "Rogers, E. Diffusion of Innovations.",
      "Katz, E. & Lazarsfeld, P. Personal Influence.",
      "Barabasi, A.-L. Linked."
    ]
  }
];

export const useCases: UseCase[] = [
  {
    slug: "lanzamiento-de-campana",
    title: "Voy a lanzar campaña. ¿Qué historia tiene permiso real?",
    shortTitle: "Lanzamiento de campaña",
    industries: "Consumo, retail, fintech, food, movilidad",
    methodologies: ["Cultural Codes", "Triggers & Barriers"],
    approach:
      "Probamos territorios contra conversación real para elegir un ángulo que la categoría sí pueda creer.",
    deliverables: ["Mapa de tensión", "Brief de campaña", "Narrativa con fuentes"],
    vignette:
      "La conversación mostró que el territorio más útil no era el más aspiracional, sino el que convertía una frustración cotidiana en lenguaje de campaña."
  },
  {
    slug: "optimizacion-de-medios",
    title: "Mi plan de medios no convierte. ¿Dónde se rompe el mensaje?",
    shortTitle: "Optimización de medios",
    industries: "Agencias, ecommerce, subscription, apps",
    methodologies: ["Journey Friction Mapping", "Decision Velocity"],
    approach:
      "Comparamos lo que dice el funnel con lo que la gente expresa antes de comprar para ubicar dónde se pierde tracción.",
    deliverables: ["Mapa de fricción", "Bloqueos de decisión", "Plan de reparación de mensaje"],
    vignette:
      "El problema no estaba en el canal ni en la frecuencia. Estaba en una promesa que aceleraba decisión en usuarios expertos y la bloqueaba en nuevos compradores."
  },
  {
    slug: "desarrollo-de-producto",
    title: "Necesito producto nuevo. ¿Qué necesidad sigue mal resuelta?",
    shortTitle: "Desarrollo de producto",
    industries: "CPG, health, beauty, SaaS, fintech",
    methodologies: ["Triggers & Barriers", "Value Perception Matrix"],
    approach:
      "Leemos reviews, foros y discusiones reales para separar deseos bonitos de oportunidades que sí pueden entrar a roadmap.",
    deliverables: ["Mapa de necesidades", "Oportunidades de diferenciación", "Rutas de concepto"],
    vignette:
      "La oportunidad no era una nueva feature, sino una reducción de riesgo percibido que nadie había comunicado como valor."
  },
  {
    slug: "entrada-a-nuevo-mercado",
    title: "Vamos a entrar a un mercado nuevo. ¿Qué nos daría permiso local?",
    shortTitle: "Nuevo mercado",
    industries: "Marcas regionales, expansion LATAM, scaleups",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    approach:
      "Identificamos qué significa la categoría localmente, quién la legitima y qué narrativas conviene evitar.",
    deliverables: ["Dossier de código local", "Mapa de influencia", "Brief de entrada"],
    vignette:
      "La categoría parecía aspiracional desde afuera. Localmente operaba como señal de exceso. La entrada cambió de prestigio a control."
  },
  {
    slug: "reposicionamiento",
    title: "Necesito reposicionar la marca. ¿Qué espacio podemos ocupar con credibilidad?",
    shortTitle: "Reposicionamiento",
    industries: "Brand strategy, consumer brands, legacy brands",
    methodologies: ["Cultural Codes", "Value Perception Matrix"],
    approach:
      "Mapeamos cómo se lee hoy la marca y qué espacio puede reclamar sin sonar forzada.",
    deliverables: ["Mapa de posición", "Gaps de valor", "Rutas de reposicionamiento"],
    vignette:
      "La marca no necesitaba sonar más joven. Necesitaba dejar de ocupar un código de eficiencia fría en una categoría que había migrado a cuidado y confianza."
  },
  {
    slug: "defensa-competitiva",
    title: "Estoy perdiendo share. ¿Qué está ganando el competidor?",
    shortTitle: "Defensa competitiva",
    industries: "Retail, telecom, apps, servicios financieros",
    methodologies: ["Triggers & Barriers", "Journey Friction Mapping"],
    approach:
      "Analizamos las razones que la gente usa para irse y qué promesa del competidor se siente más justa, simple o confiable.",
    deliverables: ["Mapa de migración", "Barreras de retención", "Brief de defensa competitiva"],
    vignette:
      "Los usuarios no se iban por precio. Se iban porque el competidor había convertido soporte y transparencia en prueba de respeto."
  },
  {
    slug: "validacion-de-hipotesis",
    title: "Tenemos una hipótesis estratégica. ¿La conversación la sostiene?",
    shortTitle: "Validación de hipótesis",
    industries: "Estrategia, planning, venture, innovacion",
    methodologies: ["Protocolo a medida"],
    approach:
      "Buscamos señales a favor y en contra para saber si la tesis merece avanzar, ajustarse o frenarse.",
    deliverables: ["Brief de evidencia", "Señales en contra", "Recomendación de decisión"],
    vignette:
      "La hipótesis se sostenía en usuarios heavy, pero fallaba en compradores nuevos. El reporte cambió el target de la primera fase."
  },
  {
    slug: "anticipacion-de-tendencias",
    title: "Mi categoría se está moviendo. ¿Qué señal viene creciendo?",
    shortTitle: "Anticipación de tendencias",
    industries: "Beauty, food, gaming, cultura, tecnologia",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    approach:
      "Detectamos lenguaje, hábitos y voces que empiezan a crecer antes de volverse obvios.",
    deliverables: ["Radar de señales", "Vocabulario emergente", "Voces tempranas"],
    vignette:
      "La tendencia no aparecía como hashtag. Aparecía como nuevo vocabulario en comunidades chicas que luego fue adoptado por creadores medianos."
  },
  {
    slug: "decodificacion-de-crisis",
    title: "Estamos en crisis. ¿Qué está alimentando la conversación?",
    shortTitle: "Crisis",
    industries: "Reputacion, consumo, instituciones, plataformas",
    methodologies: ["Influence Architecture", "Cultural Codes"],
    approach:
      "Identificamos quién sostiene la narrativa, qué frase la vuelve repetible y qué respuesta puede bajarle fuerza.",
    deliverables: ["Mapa narrativo de crisis", "Voces de riesgo", "Estrategia de respuesta"],
    vignette:
      "La crisis no estaba creciendo por volumen. Crecía porque un grupo pequeño había logrado instalar un frame moral fácil de repetir."
  },
  {
    slug: "influencia-de-categoria",
    title: "Necesito mapear influencia. ¿Qué voces hacen creíble una idea?",
    shortTitle: "Influencia de categoría",
    industries: "Tech, gaming, belleza, finanzas personales",
    methodologies: ["Influence Architecture"],
    approach:
      "Mapeamos voces que conectan comunidades, validan ideas y cambian cómo se interpreta la categoría.",
    deliverables: ["Mapa de influencia", "Dossier de voces clave", "Estrategia de activación"],
    vignette:
      "El nodo más útil no era el que tenía más audiencia. Era una cuenta técnica que traducían cinco comunidades distintas antes de decidir."
  }
];

export const dataLayers = [
  {
    name: "Ingesta",
    detail:
      "150+ tipos de fuente, APIs disponibles y lectura de podcasts, video y texto largo. La cobertura se arma por pregunta, no por costumbre."
  },
  {
    name: "Normalización",
    detail:
      "Limpiamos duplicados, contexto, fechas y formatos para comparar señales que vienen de lugares distintos."
  },
  {
    name: "Enriquecimiento",
    detail:
      "Añadimos temas, entidades, tono, sarcasmo y tensiones para que la lectura no se quede en positivo o negativo."
  },
  {
    name: "Analítica",
    detail:
      "Aplicamos los métodos adecuados y conservamos la fuente que sostiene cada hallazgo."
  }
];

export const sourceTypes = [
  "Redes sociales abiertas",
  "Foros nicho",
  "Reviews de ecommerce y apps",
  "News y editoriales",
  "Blogs y newsletters",
  "Podcasts transcritos",
  "Video transcrito",
  "Q&A de marketplaces",
  "Comunidades accesibles",
  "Marketplaces especializados"
];

export const serviceTiers = [
  {
    name: "Foundation",
    description: "Una lectura clara antes de comprometer presupuesto.",
    scope: ["Una pregunta de negocio respondida", "Evidencia suficiente para decidir", "Recomendación clara de siguiente paso"],
    ideal: "Para validar una hipótesis, sostener un brief o decidir si vale la pena avanzar."
  },
  {
    name: "Intelligence",
    description: "Inteligencia construida sobre una decisión activa.",
    scope: ["Lectura a la medida", "Recomendaciones priorizadas", "Plan para campaña, producto o mercado"],
    ideal: "Para lanzamientos, reposicionamientos, defensa competitiva o entrada a mercado."
  },
  {
    name: "Strategy",
    description: "Inteligencia social como capacidad continua, no como proyecto.",
    scope: ["Sistema vivo de señales", "Lecturas recurrentes para decisiones clave", "Acompañamiento estratégico del equipo"],
    ideal: "Para categorías que se mueven rápido, portafolios complejos o decisiones recurrentes."
  }
];

export const fieldNotes = [
  {
    slug: "sentiment-score-murio",
    title: "El sentiment score murio hace una decada y nadie lo enterro",
    dek: "Por que positivo, negativo y neutro no alcanzan para decidir nada importante.",
    date: "2026-04-26",
    readingTime: 6,
    body: [
      "El sentiment score fue util cuando la pregunta era si la conversacion estaba a favor o en contra. Hoy esa pregunta casi nunca alcanza.",
      "Una crisis puede crecer con poco volumen si el frame moral es facil de repetir. Una marca puede tener menciones positivas y aun asi perder valor simbolico.",
      "La tarea no es contar emociones, sino entender que funcion cumple cada emocion dentro de la narrativa de categoria."
    ]
  },
  {
    slug: "categoria-antropologia",
    title: "Por que tu categoria no se entiende sin antropologia",
    dek: "Las categorias no son shelves mentales: son sistemas culturales con reglas, tabu y rituales.",
    date: "2026-04-26",
    readingTime: 7,
    body: [
      "Una categoria no solo ordena productos. Ordena permisos: que se puede decir, que se admira, que se ridiculiza y que se considera autentico.",
      "La antropologia importa porque captura densidad. No pregunta solo que compra la gente; pregunta que significa comprarlo en ese contexto.",
      "Cuando una marca ignora el codigo local, suele confundir awareness con legitimidad."
    ]
  },
  {
    slug: "influencia-real-metrica",
    title: "La diferencia entre influencia real e influencia metrica",
    dek: "Followers y engagement rate no son lo mismo que capacidad de mover significado entre comunidades.",
    date: "2026-04-26",
    readingTime: 5,
    body: [
      "La influencia que decide categorias rara vez vive en la cuenta mas grande. Vive en nodos que traducen, validan o bloquean narrativas.",
      "Un connector pequeno puede mover mas decision que un creador masivo si cruza comunidades que no se hablan entre si.",
      "Influence Architecture empieza por red, no por directorio de contratacion."
    ]
  }
];

export const diagnosticSteps = [
  "Tu organizacion",
  "Tu pregunta de negocio",
  "Lo que ya tienes",
  "Alcance y tiempo",
  "Categoria y mercado",
  "Como prefieres avanzar",
  "Confirmacion"
];
