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
  timing: string;
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
};

export type HomeUseCase = {
  slug: string;
  title: string;
  shortTitle: string;
  methodologies: string[];
  timing: string;
  reading: string;
  deliverables: string[];
};

export const site = {
  name: "Noisia",
  eyebrow: "SOCIAL INTELLIGENCE ARCHITECTS",
  description:
    "Noisia construye inteligencia social para marcas que necesitan resolver decisiones con evidencia trazable, no monitorear menciones.",
  nav: [
    { label: "Metodologías", href: "/metodologias" },
    { label: "Arquitectura", href: "/arquitectura-de-datos" },
    { label: "Casos", href: "/casos-de-uso" },
    { label: "Servicios", href: "/servicios" },
    { label: "Field Notes", href: "/field-notes" }
  ]
};

export const productSurfaces = [
  {
    name: "Report builder",
    description: "La pregunta estratégica se formula antes de consumir análisis.",
    proof: "Mercado, timeframe, hipótesis, fuentes y output esperado quedan visibles desde el intake."
  },
  {
    name: "Credit wallet",
    description: "Cada corrida explica su costo antes de ejecutarse.",
    proof: "Sin consumo opaco: ves qué compra cada crédito y qué profundidad habilita."
  },
  {
    name: "Narrative dashboard",
    description: "El reporte funciona como argumento, no como tablero de métricas sueltas.",
    proof: "Tesis, tensión, recomendación, cortes de lectura y evidencia trazable."
  },
  {
    name: "Source drawer",
    description: "Cada insight conserva la fuente que lo sostiene.",
    proof: "Texto original, fecha, plataforma, mercado, tags y razón de relevancia."
  },
  {
    name: "Chat with data",
    description: "Una conversación con el reporte para cambiar de ángulo sin perder evidencia.",
    proof: "Preguntas, respuestas, citas y acciones sobre el reporte."
  },
  {
    name: "Export layer",
    description: "Las salidas se preparan para decisión, cliente o equipo.",
    proof: "Link privado, PPT, snapshot, resumen ejecutivo y narrativa editable."
  }
];

export const productConsoleScenes: ProductConsoleScene[] = [
  {
    slug: "food-rescue",
    tab: "Campaña",
    label: "01 · El corpus",
    title: "Lectura de campaña · food rescue LATAM",
    methodologies: ["Cultural Codes", "Triggers & Barriers"],
    question: "¿Qué tensión cultural sostiene una campaña de adquisición sin activar cinismo?",
    insight: "La oportunidad no está en \"ahorrar\". Está en quitar la culpa de una compra inteligente.",
    summary:
      "El driver racional ya está instalado en la conversación. Lo que cambia conversión no es repetir el ahorro — es permitir que el usuario se sienta parte de una solución cotidiana, no de una compra de descarte.",
    metrics: [
      { label: "tensión dominante", value: "47.2%", tone: "positive" },
      { label: "fricción narrativa", value: "31.8%", tone: "tension" }
    ],
    sourceQuote: "Me gusta la idea, pero no quiero sentir que compro sobras. Si lo cuentan como rescate, cambia.",
    sourceMeta: [
      { label: "Plataforma", value: "Review pública" },
      { label: "Mercado", value: "Chile" },
      { label: "Tag", value: "framing · culpa · valor" }
    ],
    chatPrompt: "Dame el ángulo para México sin sonar alarmista."
  },
  {
    slug: "checkout-fintech",
    tab: "Fricción",
    label: "02 · La fricción",
    title: "Diagnóstico de conversión · wallet fintech",
    methodologies: ["Journey Friction Mapping", "Decision Velocity"],
    question: "¿Dónde se rompe la decisión cuando el usuario ya entendió el beneficio?",
    insight: "El abandono no ocurre por falta de interés. Ocurre cuando la prueba de seguridad llega tarde.",
    summary:
      "La intención de compra está alta, pero la velocidad cae en el paso donde el usuario necesita validar control, reversibilidad y soporte humano. La fricción no es de pricing — es de confianza mal secuenciada.",
    metrics: [
      { label: "bloqueo de velocidad", value: "38.6%", tone: "tension" },
      { label: "permiso a CTA", value: "52.4%", tone: "positive" }
    ],
    sourceQuote: "Sí lo usaría, pero antes quiero saber qué pasa si me equivoco o si algo no se refleja.",
    sourceMeta: [
      { label: "Plataforma", value: "Foro financiero" },
      { label: "Mercado", value: "México" },
      { label: "Tag", value: "riesgo · reversibilidad · soporte" }
    ],
    chatPrompt: "Resume el cambio de UX que aceleraría el registro."
  },
  {
    slug: "beauty-jobs",
    tab: "Producto",
    label: "03 · El job",
    title: "Mapa de oportunidad · skincare sensible",
    methodologies: ["Triggers & Barriers", "Value Perception Matrix"],
    question: "¿Qué jobs no resueltos justifican una nueva línea sin competir solo por claims?",
    insight: "La oportunidad no es prometer más potencia. Es reducir la ansiedad antes de probar.",
    summary:
      "Los reviews largos separan deseo de eficacia y miedo a irritación. El valor aparece cuando la marca convierte diagnóstico, prueba y rutina en una misma experiencia, en lugar de empujar producto suelto.",
    metrics: [
      { label: "unmet job visible", value: "44.9%", tone: "positive" },
      { label: "barrera de prueba", value: "29.7%", tone: "tension" }
    ],
    sourceQuote: "Quiero algo que funcione, pero ya me cansé de comprar productos que me dejan peor la piel.",
    sourceMeta: [
      { label: "Plataforma", value: "Reviews e-commerce" },
      { label: "Mercado", value: "Colombia" },
      { label: "Tag", value: "riesgo · rutina · sensibilidad" }
    ],
    chatPrompt: "Dame tres rutas de concepto con menor riesgo percibido."
  },
  {
    slug: "market-entry",
    tab: "Mercado",
    label: "04 · El código",
    title: "Entrada de mercado · proteína plant-based",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    question: "¿Qué código local puede legitimar la categoría sin sonar importada?",
    insight: "El permiso cultural no vive en bienestar aspiracional. Vive en rendimiento cotidiano.",
    summary:
      "La conversación local rechaza superioridad moral, pero acepta soluciones prácticas cuando vienen validadas por nodos técnicos y comunidades de entrenamiento. El terreno simbólico ganador es funcional, no ético.",
    metrics: [
      { label: "código legitimador", value: "41.3%", tone: "positive" },
      { label: "rechazo moral", value: "26.2%", tone: "tension" }
    ],
    sourceQuote: "No me interesa que me regañen por comer carne. Me interesa rendir y no sentirme pesado.",
    sourceMeta: [
      { label: "Plataforma", value: "Comunidad fitness" },
      { label: "Mercado", value: "Perú" },
      { label: "Tag", value: "rendimiento · identidad · validadores" }
    ],
    chatPrompt: "¿Qué nodos conviene escuchar antes de pauta?"
  },
  {
    slug: "value-defense",
    tab: "Defensa",
    label: "05 · La defensa",
    title: "Defensa de valor · marketplace premium",
    methodologies: ["Value Perception Matrix", "Decision Velocity", "Journey Friction Mapping"],
    question: "¿Qué dimensión de valor sostiene margen cuando el competidor gana por precio?",
    insight: "La defensa no es justificar precio. Es hacer visible el costo de equivocarse.",
    summary:
      "El competidor gana la comparación rápida. Pero cuando el riesgo de la compra sube, los compradores vuelven a valorar garantía, trazabilidad y resolución. La defensa no se construye justificando precio — se construye haciendo visible el costo de equivocarse.",
    metrics: [
      { label: "valor defendible", value: "49.6%", tone: "positive" },
      { label: "presión por precio", value: "34.1%", tone: "tension" }
    ],
    sourceQuote: "Lo barato sirve hasta que algo falla. Ahí prefiero pagar más si sé quién responde.",
    sourceMeta: [
      { label: "Plataforma", value: "Q&A marketplace" },
      { label: "Mercado", value: "Argentina" },
      { label: "Tag", value: "garantía · riesgo · soporte" }
    ],
    chatPrompt: "Convierte esto en argumento para paid search."
  }
];

export const homeUseCases: HomeUseCase[] = [
  {
    slug: "lanzamiento-de-campana",
    shortTitle: "Lanzamiento de campaña",
    title: "Tengo que lanzar una campaña. ¿Sobre qué territorio cultural se construye sin sonar genérica?",
    methodologies: ["Cultural Codes", "Triggers & Barriers"],
    timing: "4-6 semanas",
    reading:
      "La mayoría de las campañas llegan con tres territorios creativos sobre la mesa. Decodificamos las tensiones simbólicas activas en la categoría y mapeamos sobre cuáles tu marca tiene permiso real para hablar — no por aspiración, sino por evidencia conversacional. Casi nunca gana el más aspiracional. Gana el que convierte una frustración cotidiana en lenguaje accionable.",
    deliverables: ["Mapa de tensión cultural", "Brief de ángulo de campaña", "Narrativa con fuentes"]
  },
  {
    slug: "optimizacion-de-medios",
    shortTitle: "Optimización de medios",
    title: "Mi plan de medios no rinde. ¿Dónde se rompe el mensaje antes de llegar a conversión?",
    methodologies: ["Journey Friction Mapping", "Decision Velocity"],
    timing: "4-6 semanas",
    reading:
      "El funnel dice una cosa, la conversación dice otra. Reconstruimos el journey conversacional real e identificamos los puntos donde el mensaje pierde tracción — la fricción rara vez está donde el dashboard la pone. Muchas veces lo que falla no es el canal ni la frecuencia: es una promesa que acelera decisión en usuarios expertos y la bloquea en compradores nuevos.",
    deliverables: ["Mapa de fricción", "Bloqueos de velocidad", "Plan de reparación de mensaje"]
  },
  {
    slug: "desarrollo-de-producto",
    shortTitle: "Desarrollo de producto",
    title: "Necesito desarrollar producto nuevo. ¿Qué jobs reales aún no están resueltos?",
    methodologies: ["Triggers & Barriers", "Value Perception Matrix"],
    timing: "6-10 semanas",
    reading:
      "Los reviews y foros separan deseo declarado de oportunidad accionable. Extraemos los unmet jobs con esa diferencia — no lo que la gente dice que quiere, sino lo que ya está resolviendo mal. La oportunidad no suele ser una nueva feature. Suele ser una reducción de riesgo percibido que nadie está comunicando como valor.",
    deliverables: ["Landscape de jobs", "Reporte de whitespace", "Direcciones de concepto"]
  },
  {
    slug: "entrada-a-nuevo-mercado",
    shortTitle: "Nuevo mercado",
    title: "Vamos a entrar a un mercado nuevo. ¿Cómo se decodifica nuestra categoría en este país?",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    timing: "6-10 semanas",
    reading:
      "La categoría no se traduce — se reinscribe. Reconstruimos el sistema simbólico local: qué significa la categoría, quién la legitima, qué narrativas la rechazan. Lo que afuera se lee como aspiración, adentro puede operar como señal de exceso. La entrada cambia cuando entiendes en qué código local opera tu producto, no cuál querrías que ocupara.",
    deliverables: ["Dossier de código local", "Mapa de influencia de categoría", "Brief de entrada de mercado"]
  },
  {
    slug: "defensa-competitiva",
    shortTitle: "Defensa competitiva",
    title: "Estoy perdiendo share. ¿Por qué los consumidores migran al competidor?",
    methodologies: ["Triggers & Barriers", "Journey Friction Mapping"],
    timing: "4-8 semanas",
    reading:
      "La migración rara vez es por precio. Analizamos las narrativas de salida: cuándo se quiebra la lealtad, qué la dispara, qué capitaliza el competidor. Muchas veces lo que pierdes no es feature ni costo — es el código emocional. El competidor convirtió soporte y transparencia en prueba de respeto, y tú seguías hablando de eficiencia.",
    deliverables: ["Mapa de narrativas de migración", "Barreras de retención", "Brief de defensa competitiva"]
  },
  {
    slug: "anticipacion-de-tendencias",
    shortTitle: "Anticipación de tendencias",
    title: "Mi categoría se está moviendo. ¿Qué se está formando que aún no es visible?",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    timing: "6-10 semanas",
    reading:
      "Las tendencias que importan no aparecen como hashtag. Aparecen como vocabulario nuevo en comunidades pequeñas, prácticas que se repiten antes de tener nombre, actores que empiezan a traducir entre nichos. Detectamos esas señales débiles antes de que entren en métricas de plataforma — cuando todavía se puede decidir, no solo reaccionar.",
    deliverables: ["Radar de señales débiles", "Vocabulario emergente", "Dossier de nodos tempranos"]
  },
  {
    slug: "decodificacion-de-crisis",
    shortTitle: "Crisis",
    title: "Estamos en crisis. ¿Qué está pasando realmente en la conversación?",
    methodologies: ["Influence Architecture", "Cultural Codes"],
    timing: "2-4 semanas",
    reading:
      "La crisis no crece por volumen — crece por estructura narrativa. Decodificamos quién la sostiene, qué la alimenta y qué necesita para desactivarse. Casi siempre hay un grupo pequeño que ya instaló un frame moral fácil de repetir. La respuesta correcta depende del tipo de crisis, no del tamaño: lo que apaga una crisis de confianza no es lo mismo que apaga una de identidad.",
    deliverables: ["Mapa narrativo de crisis", "Lista de nodos de riesgo", "Estrategia de respuesta"]
  }
];

export const methodologies: Methodology[] = [
  {
    slug: "triggers-y-barriers",
    number: "01",
    name: "Triggers & Barriers",
    question: "¿Qué motiva y qué frena la decisión de tu consumidor?",
    lead:
      "Toda categoría tiene fuerzas que empujan al consumidor hacia la compra y fuerzas que lo frenan. Esta metodología las separa, las cuantifica y muestra cuáles puede mover tu marca y cuáles no.",
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
      "Las marcas suelen conocer los motivos de compra como aparecen en focus groups. Esta metodologia desmonta esa formulacion reportada para revelar lo que el consumidor expresa cuando no esta siendo entrevistado.",
    protocol: [
      "Definimos el jobs landscape funcional, emocional y social de la categoria.",
      "Extraemos conversaciones espontaneas en reviews, foros, comentarios largos, X, YouTube y comunidades de nicho.",
      "Codificamos cada expresion como trigger o barrier y la subclasificamos por tipo.",
      "Jerarquizamos por frecuencia, intensidad linguistica y capacidad predictiva dentro de la misma conversacion.",
      "Traducimos cada fuerza a una accion posible en comunicacion, producto o experiencia."
    ],
    outputs: [
      "Triggers & Barriers Map",
      "Activation Playbook",
      "Friction Removal Plan",
      "Comparative Brief con hasta tres competidores"
    ],
    uses:
      "Lanzamiento de producto, optimizacion de funnel, comunicacion que busca activar comportamiento, defensa competitiva y repositioning motivacional.",
    limitations:
      "No predice tamanos de mercado ni cuotas. Tampoco sustituye un test cuantitativo de concepto. Su valor es direccional y motivacional.",
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
    question: "¿Qué dimensión de valor capitaliza tu marca y cuál está abandonando?",
    lead:
      "Valor no es precio. Es lo que tu consumidor recibe en dinero, tiempo, esfuerzo y riesgo, comparado contra cada alternativa relevante. Esta metodología muestra dónde tu marca capitaliza y dónde está pagando una prima sin retorno.",
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
      "Las marcas asumen que su valor esta en lo que comunican. El consumidor construye valor contra alternativas reales, no en abstracto.",
    protocol: [
      "Reconstruimos el frame competitivo real desde la conversacion.",
      "Extraemos las dimensiones de valor que el consumidor usa para evaluar.",
      "Codificamos menciones por dimension y polaridad.",
      "Construimos una matriz marca por dimension con percepcion agregada.",
      "Detectamos gaps defensivos, permisos desaprovechados y whitespaces de categoria."
    ],
    outputs: [
      "Value Perception Matrix",
      "Whitespace Report",
      "Defense Brief",
      "Recategorization Hypothesis"
    ],
    uses:
      "Reposicionamiento, propuesta de valor, pricing strategy, defensa de margen y evaluacion post-lanzamiento.",
    limitations:
      "La matriz es comparativa, no absoluta. No mide elasticidad de precio ni sustituye un conjoint.",
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
    question: "¿Qué significa tu categoría en el sistema simbólico de tu consumidor?",
    lead:
      "Toda categoría tiene reglas no escritas — qué se dice, qué no, qué legitima, qué cancela. Esta metodología las hace visibles para que tu marca decida si las cumple, las rompe o las reescribe.",
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
      "Las marcas globales aplican formulas globales en mercados locales; las marcas locales asumen proximidad como conocimiento. Ambas pierden cuando no traducen el sistema simbolico.",
    protocol: [
      "Orquestamos fuentes culturalmente densas: foros, comunidades, comentarios largos y lenguaje vernaculo.",
      "Identificamos palabras, metaforas y comparaciones recurrentes.",
      "Mapeamos oposiciones binarias operativas en la categoria.",
      "Reconstruimos el sistema de codigo: que legitima, que rechaza, que transgrede.",
      "Ubicamos marcas y competidores dentro del codigo y detectamos posiciones vacantes."
    ],
    outputs: ["Cultural Code Dossier", "Symbolic Map", "Code Strategy Brief"],
    uses:
      "Entrada a nuevo mercado, repositioning profundo, lanzamiento de marca, transferibilidad de campanas globales y oportunidades culturales.",
    limitations:
      "Es interpretativa por naturaleza. No produce certezas estadisticas, produce comprensiones estructurales rigurosas.",
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
    question: "¿Por qué tu consumidor decide rápido en una categoría y lento en la tuya?",
    lead:
      "Hay categorías donde el consumidor decide en treinta segundos y otras donde tarda seis meses. La velocidad la define la categoría, no el comprador. Esta metodología detecta qué la acelera y qué la traba.",
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
      "Muchas marcas optimizan mensaje y canal sin diagnosticar la velocidad cognitiva que su categoria exige. Ese desajuste cuesta conversion o consideracion.",
    protocol: [
      "Reconstruimos narrativas de decision reales desde conversaciones espontaneas.",
      "Codificamos tiempos, actores consultados, informacion buscada y momento de click.",
      "Diagnosticamos si domina Sistema 1 o Sistema 2 por segmento.",
      "Detectamos velocity blockers y velocity accelerators.",
      "Recomendamos arquitectura de eleccion para opciones, mensajes, secuencias y CTAs."
    ],
    outputs: [
      "Decision Velocity Diagnostic",
      "Velocity Blockers Map",
      "Velocity Accelerators Map",
      "Choice Architecture Brief"
    ],
    uses:
      "Optimizacion de funnel, UX de decision, e-commerce, configuradores, pricing pages y lanzamientos en categorias de velocidad inusual.",
    limitations:
      "No sustituye un A/B test. Identifica hipotesis fuertes que luego se validan con experimentacion.",
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
    question: "¿Dónde se rompe el camino entre la intención y la acción?",
    lead:
      "El journey que se construye en workshop es una hipótesis. El journey real es donde se pierden ventas. Esta metodología identifica los puntos de pérdida y los tipifica para que la solución sea quirúrgica, no cosmética.",
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
      "La analitica web muestra donde la gente abandona, no por que. Esta metodologia reconstruye el por que desde conversacion espontanea y masiva.",
    protocol: [
      "Reconstruimos etapas del journey tal como el consumidor las vive.",
      "Codificamos fricciones por etapa y tipo.",
      "Detectamos break points donde la friccion es mas densa o decisiva.",
      "Cruzamos fricciones con touchpoints bajo control de la marca.",
      "Priorizamos por frecuencia, capacidad de abortar decision y costo de eliminacion."
    ],
    outputs: ["Friction Map", "Break Points Brief", "Friction Removal Roadmap"],
    uses:
      "Optimizacion de conversion, rediseno de experiencias, evaluacion post-lanzamiento, defensa de share y expansion a nuevos canales.",
    limitations:
      "Captura fricciones articuladas. Las fricciones invisibles requieren metodos complementarios como usability testing observacional.",
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
    question: "¿Quiénes diseñan, sin saberlo, el imaginario de tu categoría?",
    lead:
      "La influencia no se mide en seguidores. Se mide en nodos: ciertas voces mueven significado entre comunidades y desbloquean adopción de manera desproporcionada. Esta metodología los identifica, los caracteriza y los prioriza.",
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
      "Las marcas hacen influencer marketing por followers y engagement rate. La influencia que mueve categorias suele vivir en nodos especializados, validadores invisibles y conectores entre comunidades.",
    protocol: [
      "Mapeamos comunidades de conversacion alrededor de la categoria.",
      "Calculamos centralidad de grado, betweenness y eigenvector.",
      "Tipificamos nodos: innovator, early adopter, validator, connector, dissenter, gatekeeper.",
      "Reconstruimos propagacion de narrativas reales.",
      "Priorizamos nodos a activar, monitorear o investigar."
    ],
    outputs: [
      "Influence Architecture Map",
      "Key Nodes Dossier",
      "Activation Strategy",
      "Early Warning System"
    ],
    uses:
      "Estrategias de influencia, lanzamientos en categorias especializadas, defensa reputacional, tendencias emergentes y comunidades de marca.",
    limitations:
      "Identifica la estructura. La activacion requiere relationship building, contenido relevante y respeto por cada comunidad.",
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
    title: "Tengo que lanzar una campaña. ¿Sobre qué territorio cultural se construye sin sonar genérica?",
    shortTitle: "Lanzamiento de campaña",
    industries: "Consumo, retail, fintech, food, movilidad",
    methodologies: ["Cultural Codes", "Triggers & Barriers"],
    timing: "4-6 semanas",
    approach:
      "Decodificamos las tensiones simbólicas activas en la categoría y mapeamos sobre cuáles tu marca tiene permiso real para hablar — no por aspiración, sino por evidencia conversacional.",
    deliverables: ["Tension map", "Campaign angle brief", "Narrativa con fuentes"],
    vignette:
      "Una marca llego con tres territorios creativos. La conversacion mostro que solo uno tenia permiso cultural: no el mas aspiracional, sino el que convertia una frustracion cotidiana en lenguaje accionable."
  },
  {
    slug: "optimizacion-de-medios",
    title: "Mi plan de medios no rinde. ¿En qué punto del journey se rompe el mensaje?",
    shortTitle: "Optimización de medios",
    industries: "Agencias, ecommerce, subscription, apps",
    methodologies: ["Journey Friction Mapping", "Decision Velocity"],
    timing: "4-6 semanas",
    approach:
      "Reconstruimos el journey conversacional real e identificamos los puntos donde el mensaje pierde tracción antes de llegar a conversión. La fricción rara vez está donde dice el funnel.",
    deliverables: ["Friction map", "Velocity blockers", "Message repair plan"],
    vignette:
      "El problema no estaba en el canal ni en la frecuencia. Estaba en una promesa que aceleraba decisión en usuarios expertos y la bloqueaba en nuevos compradores."
  },
  {
    slug: "desarrollo-de-producto",
    title: "Necesito desarrollar productos nuevos. ¿Qué jobs reales aún no están resueltos?",
    shortTitle: "Desarrollo de producto",
    industries: "CPG, health, beauty, SaaS, fintech",
    methodologies: ["Triggers & Barriers", "Value Perception Matrix"],
    timing: "6-10 semanas",
    approach:
      "Extraemos unmet jobs desde reviews, foros y discusiones reales para separar deseo declarado de oportunidad accionable. La diferencia define el roadmap.",
    deliverables: ["Jobs landscape", "Whitespace report", "Concept directions"],
    vignette:
      "La oportunidad no era una nueva feature, sino una reducción de riesgo percibido que nadie había comunicado como valor."
  },
  {
    slug: "entrada-a-nuevo-mercado",
    title: "Vamos a entrar a un mercado nuevo. ¿Cómo se decodifica nuestra categoría en este país?",
    shortTitle: "Nuevo mercado",
    industries: "Marcas regionales, expansion LATAM, scaleups",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    timing: "6-10 semanas",
    approach:
      "Reconstruimos el sistema simbólico local: qué significa la categoría, quién la legitima y qué narrativas la rechazan. La categoría no se traduce — se reinscribe.",
    deliverables: ["Local code dossier", "Category influence map", "Market entry brief"],
    vignette:
      "La categoría parecía aspiracional desde afuera. Localmente operaba como señal de exceso. La entrada cambió de prestigio a control."
  },
  {
    slug: "reposicionamiento",
    title: "Necesito reposicionar la marca. ¿Qué código simbólico ocupamos hoy y cuál podríamos ocupar?",
    shortTitle: "Reposicionamiento",
    industries: "Brand strategy, consumer brands, legacy brands",
    methodologies: ["Cultural Codes", "Value Perception Matrix"],
    timing: "6-10 semanas",
    approach:
      "Mapeamos la posición simbólica actual de la marca y de los competidores dentro del sistema cultural de la categoría. El movimiento se define por contraste, no por aspiración aislada.",
    deliverables: ["Symbolic position map", "Value gap analysis", "Repositioning routes"],
    vignette:
      "La marca no necesitaba sonar más joven. Necesitaba dejar de ocupar un código de eficiencia fría en una categoría que había migrado a cuidado y confianza."
  },
  {
    slug: "defensa-competitiva",
    title: "Estoy perdiendo share. ¿Por qué los consumidores migran al competidor?",
    shortTitle: "Defensa competitiva",
    industries: "Retail, telecom, apps, servicios financieros",
    methodologies: ["Triggers & Barriers", "Journey Friction Mapping"],
    timing: "4-8 semanas",
    approach:
      "Analizamos las narrativas de migración: cuándo se quiebra la lealtad, qué la dispara y qué capitaliza el competidor. La defensa no se construye reaccionando — se construye anticipando.",
    deliverables: ["Migration narrative map", "Retention barriers", "Competitive defense brief"],
    vignette:
      "Los usuarios no se iban por precio. Se iban porque el competidor había convertido soporte y transparencia en prueba de respeto."
  },
  {
    slug: "validacion-de-hipotesis",
    title: "Tenemos una tesis estratégica. ¿La conversación pública la sostiene?",
    shortTitle: "Validación de hipótesis",
    industries: "Estrategia, planning, venture, innovacion",
    methodologies: ["Protocolo a medida"],
    timing: "4-6 semanas",
    approach:
      "Diseñamos un protocolo que busca señales confirmatorias y disconfirmatorias en data conversacional real. Si la tesis no se sostiene, lo decimos antes de que se convierta en decisión.",
    deliverables: ["Evidence brief", "Counter-signal log", "Decision recommendation"],
    vignette:
      "La hipótesis se sostenía en usuarios heavy, pero fallaba en compradores nuevos. El reporte cambió el target de la primera fase."
  },
  {
    slug: "anticipacion-de-tendencias",
    title: "Mi categoría se está moviendo. ¿Qué tendencias están emergiendo que aún no son visibles?",
    shortTitle: "Anticipación de tendencias",
    industries: "Beauty, food, gaming, cultura, tecnologia",
    methodologies: ["Cultural Codes", "Influence Architecture"],
    timing: "6-10 semanas",
    approach:
      "Detectamos señales débiles: vocabularios, prácticas y actores nuevos que predicen movimientos de categoría antes de que aparezcan en métricas de plataforma.",
    deliverables: ["Weak signal radar", "Emerging vocabulary", "Early node dossier"],
    vignette:
      "La tendencia no aparecía como hashtag. Aparecía como nuevo vocabulario en comunidades chicas que luego fue adoptado por creadores medianos."
  },
  {
    slug: "decodificacion-de-crisis",
    title: "Estamos en una crisis. ¿Qué está pasando realmente en la conversación?",
    shortTitle: "Crisis",
    industries: "Reputacion, consumo, instituciones, plataformas",
    methodologies: ["Influence Architecture", "Cultural Codes"],
    timing: "2-4 semanas",
    approach:
      "Decodificamos la estructura narrativa de la crisis: quién la sostiene, qué la alimenta y qué necesita para desactivarse. La respuesta correcta depende del tipo de crisis, no del tamaño.",
    deliverables: ["Crisis narrative map", "Node risk list", "Response strategy"],
    vignette:
      "La crisis no estaba creciendo por volumen. Crecía porque un grupo pequeño había logrado instalar un frame moral fácil de repetir."
  },
  {
    slug: "influencia-de-categoria",
    title: "Necesito mapear influencia. ¿Quiénes mueven la conversación de mi categoría?",
    shortTitle: "Influencia de categoría",
    industries: "Tech, gaming, belleza, finanzas personales",
    methodologies: ["Influence Architecture"],
    timing: "6-10 semanas",
    approach:
      "Mapeamos nodos centrales, conectores entre comunidades, voces emergentes y detractores estructurales. La estrategia de influencia empieza por entender la red, no por contratar followers.",
    deliverables: ["Influence map", "Key nodes dossier", "Activation strategy"],
    vignette:
      "El nodo más útil no era el que tenía más audiencia. Era una cuenta técnica que traducían cinco comunidades distintas antes de decidir."
  }
];

export const dataLayers = [
  {
    name: "Ingesta",
    detail:
      "150+ fuentes orquestadas, 10,000+ scrapers especializados, APIs nativas e ingesta de podcasts, video y texto largo. La cobertura se arma por pregunta, no por default."
  },
  {
    name: "Normalización",
    detail:
      "Esquema único, deduplicación, atribución, metadatos comparables y traducción cuando aplica. Sin esto, comparar plataformas es comparar cosas distintas."
  },
  {
    name: "Enriquecimiento",
    detail:
      "Clasificación temática, entidades, sentimiento multidimensional, sarcasmo contextual y tensión narrativa. El sentiment plano no resuelve preguntas reales."
  },
  {
    name: "Analítica",
    detail:
      "Operacionalización de las seis metodologías sobre el corpus normalizado, con evidencia trazable a la fuente original."
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
    description: "El piso analítico antes de comprometer presupuesto.",
    scope: ["Una pregunta de negocio respondida", "1-2 metodologías aplicadas", "4-6 semanas hasta decisión"],
    ideal: "Cuando tienes una hipótesis y necesitas evidencia antes de avanzar — validar una categoría nueva, sostener un brief estratégico, decidir si entrar o no."
  },
  {
    name: "Intelligence",
    description: "Inteligencia construida sobre una decisión activa.",
    scope: ["Protocolo a la medida de tu pregunta", "3-4 metodologías combinadas", "6-10 semanas hasta playbook accionable"],
    ideal: "Cuando la decisión está cerca y el riesgo es real — lanzamiento, reposicionamiento, defensa competitiva o entrada a mercado."
  },
  {
    name: "Strategy",
    description: "Inteligencia social como capacidad continua, no como proyecto.",
    scope: ["Protocolo evolutivo, datos vivos", "Las 6 metodologías + retainer estratégico", "Trimestral o anual"],
    ideal: "Cuando la categoría se mueve rápido o la decisión es recurrente — portafolios complejos, mercados fragmentados, presencia multi-mercado."
  }
];

export const manifesto = [
  "La industria del social listening crecio ofreciendo a las marcas algo que parecia valioso: acceso. Acceso a millones de menciones, metricas en tiempo real y dashboards configurables.",
  "Hoy la pregunta es vieja y el dato es abundante. Tener acceso a datos no es lo mismo que tener inteligencia sobre ellos.",
  "Una metrica no es un insight. Un dashboard no es una estrategia. Un sentiment score no es una decision.",
  "Construir inteligencia social no es construir una mejor herramienta. Es construir arquitectura de datos plural, metodologias propietarias por pregunta y traduccion a decision.",
  "Noisia es una agencia de inteligencia social: un equipo de arquitectos que disena sistemas analiticos a la medida del problema estrategico del cliente.",
  "Cobramos por inteligencia, no por acceso. Entregamos decisiones, no dashboards. Operamos con metodologia, no con plantillas."
];

export const principles = [
  "La pregunta antes que el metodo.",
  "Honestidad metodologica antes que promesa comercial.",
  "Profundidad antes que velocidad.",
  "Decisiones antes que dashboards.",
  "Plural en datos, unico en interpretacion."
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
