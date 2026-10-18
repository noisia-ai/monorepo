import type { Entry } from "./registry";
import type { Block, Localized, PageContent } from "./types";

export const methodsIndex: Localized<PageContent> = {
  es: {
    metaTitle: "Métodos de investigación con base antropológica y sociológica",
    metaDescription:
      "La biblioteca de métodos de Noisia parte de la antropología, la sociología y la psicología para entender por qué la gente hace lo que hace. Triggers & Barriers es el más usado; cualquier teoría sólida del comportamiento puede volverse un método.",
    title: "Entender antes de contar",
    lead:
      "Nuestros métodos buscan por qué la gente hace lo que hace. La frecuencia importa, y también la intensidad, el contexto y la relación con la decisión que vas a tomar. Cada método parte de una teoría probada sobre el comportamiento humano y la convierte en una forma de leer la conversación.",
    blocks: [
      {
        type: "text",
        title: "Por qué partimos de las ciencias sociales",
        paragraphs: [
          "Contar menciones dice cuánto se habló de algo. Entender una decisión pide más: saber qué empuja a una persona, qué la detiene, qué significa la categoría en su mundo y a quién le cree. Esas preguntas las trabajan desde hace décadas la antropología, la sociología y la psicología, y ahí están las herramientas que usamos.",
          "Una mención que aparece doce veces con enojo puede pesar más que una que aparece doscientas veces de paso. El método es lo que decide qué importa, y por eso cada hallazgo dice si es medido, direccional o cualitativo."
        ]
      },
      {
        type: "cards",
        title: "Las bases",
        items: [
          { name: "Antropología", text: "Leer la cultura desde adentro: qué significa una categoría en un mercado, qué se admira, qué se ridiculiza y qué da permiso. De aquí viene la lectura de códigos y la descripción densa." },
          { name: "Sociología", text: "Cómo se mueven las ideas entre personas y comunidades, quién legitima, quién conecta y por dónde entra lo nuevo. De aquí viene el análisis de redes y de influencia." },
          { name: "Psicología", text: "Cómo decide una persona: los dos modos de pensar, la aversión a la pérdida, la fatiga de decidir, las fricciones que frenan un cambio. De aquí viene la lectura de motivos, frenos y velocidad." }
        ]
      },
      {
        type: "text",
        title: "Una biblioteca que crece",
        paragraphs: [
          "Triggers & Barriers es el método que más usamos porque responde la pregunta más frecuente: qué motiva y qué frena una decisión. Junto a él hay cinco más, cada uno para una pregunta distinta: valor percibido, códigos culturales, velocidad de decisión, fricción en el recorrido y arquitectura de influencia.",
          "La biblioteca sigue abierta. Cualquier teoría sólida sobre comportamiento humano, con autores, evidencia y categorías claras, puede convertirse en un método que el sistema opera sobre la conversación completa. Cuando tu pregunta no encaja en ninguno de los seis, construimos el que hace falta."
        ]
      },
      {
        type: "steps",
        title: "Cómo se construye un método nuevo",
        items: [
          { name: "Una teoría que se sostiene", text: "Partimos de un marco publicado, con autores y evidencia, que explique una parte del comportamiento humano." },
          { name: "Una pregunta de negocio que responda", text: "El método existe para una decisión concreta. Si no hay decisión que mejore, no entra a la biblioteca." },
          { name: "Categorías para clasificar lo que dice la gente", text: "Traducimos la teoría en categorías que una persona y el sistema pueden aplicar a cada mención de la misma manera, con reglas escritas para los casos difíciles." },
          { name: "Prueba sobre conversación real", text: "Un Intelligence Architect lo corre sobre una base real y medimos que dos personas clasifiquen igual antes de confiar en las cifras." },
          { name: "Límites escritos", text: "El método entra a la biblioteca con lo que responde, lo que no responde y cuándo conviene usar otro." }
        ]
      },
      {
        type: "callout",
        title: "Los límites se dicen",
        text: "Cada ficha de método incluye lo que no responde. Un método honesto dice cuándo hace falta una encuesta, una prueba de usabilidad o un experimento para terminar de contestar la pregunta."
      },
      {
        type: "cta",
        title: "Trae tu pregunta",
        text: "En el taller gratis elegimos juntos el método, o definimos el que hace falta.",
        label: "Agenda un taller gratis",
        href: "/taller"
      }
    ]
  },
  en: {
    metaTitle: "Research methods with anthropological and sociological foundations",
    metaDescription:
      "Noisia's method library starts from anthropology, sociology and psychology to understand why people do what they do. Triggers & Barriers is the most used; any solid theory of behavior can become a method.",
    title: "Understand before you count",
    lead:
      "Our methods look for why people do what they do. Frequency matters, and so do intensity, context and the link to the decision you are about to make. Each method starts from a tested theory of human behavior and turns it into a way of reading the conversation.",
    blocks: [
      {
        type: "text",
        title: "Why we start from the social sciences",
        paragraphs: [
          "Counting mentions tells you how much something was talked about. Understanding a decision asks for more: knowing what pushes a person, what holds them back, what the category means in their world and whom they believe. Anthropology, sociology and psychology have worked on those questions for decades, and that is where our tools come from.",
          "A mention that appears twelve times with anger can weigh more than one that appears two hundred times in passing. The method is what decides what matters, and that is why every finding says whether it is measured, directional or qualitative."
        ]
      },
      {
        type: "cards",
        title: "The foundations",
        items: [
          { name: "Anthropology", text: "Reading culture from the inside: what a category means in a market, what is admired, what is ridiculed and what grants permission. This is where the reading of codes and thick description come from." },
          { name: "Sociology", text: "How ideas move between people and communities, who legitimizes, who connects and where the new comes in. This is where network and influence analysis come from." },
          { name: "Psychology", text: "How a person decides: the two modes of thinking, loss aversion, decision fatigue, the frictions that hold back a change. This is where the reading of motives, obstacles and speed comes from." }
        ]
      },
      {
        type: "text",
        title: "A growing library",
        paragraphs: [
          "Triggers & Barriers is the method we use most because it answers the most frequent question: what motivates and what holds back a decision. Alongside it there are five more, each for a different question: perceived value, cultural codes, decision speed, friction along the journey and the architecture of influence.",
          "The library stays open. Any solid theory of human behavior, with authors, evidence and clear categories, can become a method the system runs over the whole conversation. When your question doesn't fit any of the six, we build the one that is missing."
        ]
      },
      {
        type: "steps",
        title: "How a new method is built",
        items: [
          { name: "A theory that holds up", text: "We start from a published framework, with authors and evidence, that explains a part of human behavior." },
          { name: "A business question it answers", text: "The method exists for a specific decision. If there is no decision it improves, it doesn't enter the library." },
          { name: "Categories to classify what people say", text: "We translate the theory into categories a person and the system can apply to every mention the same way, with written rules for the hard cases." },
          { name: "A test on real conversation", text: "An Intelligence Architect runs it on a real conversación and we measure that two people classify alike before trusting the numbers." },
          { name: "Written limits", text: "The method enters the library with what it answers, what it doesn't and when another one is the better choice." }
        ]
      },
      {
        type: "callout",
        title: "Limits are stated",
        text: "Every method page includes what it doesn't answer. An honest method says when a survey, a usability test or an experiment is needed to finish answering the question."
      },
      {
        type: "cta",
        title: "Bring your question",
        text: "In the free workshop we choose the method together, or define the one that is missing.",
        label: "Book a free workshop",
        href: "/en/workshop"
      }
    ]
  }
};

type MethodLocale = {
  name: string;
  metaDescription: string;
  question: string;
  lead: string;
  summary: string;
  looksAt: string[];
  foundations: { name: string; text: string }[];
  steps: { name: string; text: string }[];
  outputs: { name: string; text: string }[];
  useful: string[];
  limits: string[];
};

const labels = {
  es: { looksAt: "Qué mira", foundations: "En qué se basa", steps: "Cómo funciona", outputs: "Qué recibes", useful: "Cuándo sirve", limits: "Lo que no responde", ctaTitle: "Trae tu pregunta", ctaText: "En un taller gratis vemos si este método responde lo que necesitas decidir, o si conviene otro.", ctaLabel: "Agenda un taller gratis", ctaHref: "/taller" },
  en: { looksAt: "What it looks at", foundations: "What it is built on", steps: "How it works", outputs: "What you receive", useful: "When it is useful", limits: "What it does not answer", ctaTitle: "Bring your question", ctaText: "In a free workshop we look at whether this method answers what you need to decide, or whether another one fits better.", ctaLabel: "Book a free workshop", ctaHref: "/en/workshop" }
};

function methodPage(m: MethodLocale, lang: "es" | "en"): PageContent {
  const l = labels[lang];
  const blocks: Block[] = [
    { type: "text", title: l.looksAt, paragraphs: m.looksAt },
    { type: "cards", title: l.foundations, items: m.foundations },
    { type: "steps", title: l.steps, items: m.steps },
    { type: "cards", title: l.outputs, items: m.outputs },
    { type: "text", title: l.useful, paragraphs: m.useful },
    { type: "text", title: l.limits, paragraphs: m.limits },
    { type: "cta", title: l.ctaTitle, text: l.ctaText, label: l.ctaLabel, href: l.ctaHref }
  ];
  return { metaTitle: m.name, metaDescription: m.metaDescription, title: m.question, lead: m.lead, blocks };
}

function method(slug: { es: string; en: string }, es: MethodLocale, en: MethodLocale): Entry {
  return { slug, summary: { es: es.summary, en: en.summary }, page: { es: methodPage(es, "es"), en: methodPage(en, "en") } };
}

export const methodEntries: Entry[] = [
  method(
    { es: "triggers-y-barriers", en: "triggers-and-barriers" },
    {
      name: "Triggers & Barriers",
      metaDescription: "Qué motiva y qué frena una decisión en tu categoría, en cuatro capas: psicológica, personal, social y cultural. Así sabes qué puede mover tu marca y con qué solo puede alinearse.",
      question: "¿Por qué la gente compra, por qué no, y qué parte de eso puedes cambiar?",
      lead: "Triggers & Barriers separa lo que empuja una decisión de lo que la detiene y ubica cada fuerza en una de cuatro capas: psicológica, personal, social y cultural. Con eso sabes qué puedes mover con producto o comunicación, en qué puedes influir y con qué te conviene alinearte.",
      summary: "Qué motiva y qué frena una decisión, y qué parte de eso puede mover tu marca.",
      looksAt: [
        "Lee lo que la gente dice cuando habla sin guion: reseñas, foros, comentarios largos y comunidades donde la duda aparece completa. Busca las frases que empujan la decisión y las que la frenan, y clasifica cada una dos veces: como motivo o como freno, y en la capa donde vive.",
        "Las cuatro capas son la psicológica (lo que pasa dentro de la persona: deseo, alivio, ansiedad, inercia), la personal (presupuesto, tiempo, hábitos, identidad), la social (la mirada de los demás: recomendación, pertenencia, estigma) y la cultural (lo que la categoría significa en ese mercado: qué es legítimo, aspiracional o tabú).",
        "La capa importa porque cambia la estrategia. Una marca puede mover lo psicológico y lo personal con producto, formato, precio y comunicación. Puede influir en lo social con comunidad y validación visible. Casi nunca mueve un código cultural; con ese puede alinearse o salirse. Confundir una barrera cultural con una psicológica lleva a campañas que intentan mover algo que no se mueve."
      ],
      foundations: [
        { name: "Dual-Process Theory · Kahneman (2011)", text: "Dos modos de decidir, uno rápido e intuitivo y otro lento y deliberado. Distingue motivos de impulso de motivos de evaluación." },
        { name: "Jobs to be Done · Christensen (2016)", text: "La gente contrata productos para resolver trabajos funcionales, emocionales y sociales. Alimenta las capas psicológica y social." },
        { name: "Self-Determination Theory · Deci y Ryan (1985)", text: "Motivación interna y externa como motores distintos. Separa lo personal de lo social." },
        { name: "Friction Theory · Nordgren y Schonthal (2021)", text: "Inercia, esfuerzo, emoción y reactancia como las cuatro fuerzas que frenan un cambio. Estructura la lectura de los frenos." }
      ],
      steps: [
        { name: "Definimos la decisión", text: "Qué intenta resolver la gente en la categoría y qué hipótesis trae tu equipo. Las hipótesis se prueban o se descartan con la conversación." },
        { name: "Reunimos la conversación donde la duda aparece completa", text: "Reseñas, foros, comentarios largos y comunidades, con al menos tres tipos de fuente y, cuando aplica, tus competidores con el mismo criterio." },
        { name: "Clasificamos cada mención dos veces", text: "Como motivo o freno y en su capa. Las reglas para los casos difíciles están escritas y un Intelligence Architect revisa la clasificación." },
        { name: "Jerarquizamos", text: "Por tamaño, intensidad y relación con la decisión. Lo que más se repite no siempre es lo que más pesa." },
        { name: "Traducimos a acción", text: "Qué motivos puedes activar, qué frenos puedes quitar, con qué códigos conviene alinearte, y cómo se compara eso con hasta tres competidores." }
      ],
      outputs: [
        { name: "Mapa de triggers y barriers", text: "La matriz de cuatro capas por lo que empuja y lo que frena, jerarquizada y con sus citas." },
        { name: "Plan de activación", text: "Qué motivos puede activar la marca, en qué medio y con qué tono." },
        { name: "Plan para quitar fricción", text: "Qué frenos se pueden remover, cuáles son estructurales y qué pieza de producto o comunicación los disuelve." },
        { name: "Comparativo competitivo", text: "Cómo se diferencian tus motivos y frenos frente a hasta tres competidores, medidos con el mismo criterio." }
      ],
      useful: [
        "Lanzamientos con una hipótesis de adopción sin validar. Conversión que cae sin que el canal lo explique. Defensa cuando la gente se va por algo distinto al precio. Reposicionamiento en una categoría madura que necesita reabrir el motivo de uso. Comunicación que busca activar un comportamiento, más allá de recordar la marca."
      ],
      limits: [
        "No estima tamaño de mercado ni cuotas; es direccional y motivacional. No sustituye una prueba cuantitativa de concepto: sirve para diseñar la hipótesis que vale la pena probar. Captura el sistema de motivos en el momento de la lectura; si la conversación tiene más de nueve meses, puede describir algo que ya cambió. Y no diagnostica awareness: si nadie conoce la categoría, no hay decisión que leer."
      ]
    },
    {
      name: "Triggers & Barriers",
      metaDescription: "What motivates and what holds back a decision in your category, across four layers: psychological, personal, social and cultural. So you know what your brand can move and what it can only align with.",
      question: "Why do people buy, why don't they, and which part of that can you change?",
      lead: "Triggers & Barriers separates what pushes a decision from what stops it and places each force in one of four layers: psychological, personal, social and cultural. With that you know what you can move with product or communication, what you can influence and what you are better off aligning with.",
      summary: "What motivates and what holds back a decision, and which part of that your brand can move.",
      looksAt: [
        "It reads what people say when they speak without a script: reviews, forums, long comments and communities where the doubt appears in full. It looks for the phrases that push the decision and the ones that hold it back, and classifies each one twice: as a motive or an obstacle, and in the layer where it lives.",
        "The four layers are the psychological (what happens inside the person: desire, relief, anxiety, inertia), the personal (budget, time, habits, identity), the social (the gaze of others: recommendation, belonging, stigma) and the cultural (what the category means in that market: what is legitimate, aspirational or taboo).",
        "The layer matters because it changes the strategy. A brand can move the psychological and the personal with product, format, price and communication. It can influence the social with community and visible validation. It almost never moves a cultural code; with that one it can align or step aside. Mistaking a cultural barrier for a psychological one leads to campaigns that try to move something that doesn't move."
      ],
      foundations: [
        { name: "Dual-Process Theory · Kahneman (2011)", text: "Two modes of deciding, one fast and intuitive, one slow and deliberate. It separates impulse motives from evaluation motives." },
        { name: "Jobs to be Done · Christensen (2016)", text: "People hire products to get functional, emotional and social jobs done. It feeds the psychological and social layers." },
        { name: "Self-Determination Theory · Deci and Ryan (1985)", text: "Internal and external motivation as distinct drivers. It separates the personal from the social." },
        { name: "Friction Theory · Nordgren and Schonthal (2021)", text: "Inertia, effort, emotion and reactance as the four forces that hold back a change. It structures the reading of obstacles." }
      ],
      steps: [
        { name: "We define the decision", text: "What people are trying to solve in the category and which hypotheses your team brings. Hypotheses are tested or discarded against the conversation." },
        { name: "We gather the conversation where the doubt appears in full", text: "Reviews, forums, long comments and communities, with at least three kinds of source and, when it applies, your competitors under the same criteria." },
        { name: "We classify every mention twice", text: "As motive or obstacle and in its layer. The rules for hard cases are written down and an Intelligence Architect reviews the classification." },
        { name: "We rank", text: "By size, intensity and link to the decision. What repeats most is not always what weighs most." },
        { name: "We translate into action", text: "Which motives you can activate, which obstacles you can remove, which codes you should align with, and how that compares with up to three competitors." }
      ],
      outputs: [
        { name: "Triggers & Barriers map", text: "The four-layer matrix of what pushes and what holds back, ranked and with its quotes." },
        { name: "Activation plan", text: "Which motives the brand can activate, in which medium and with what tone." },
        { name: "Friction removal plan", text: "Which obstacles can be removed, which are structural and which piece of product or communication dissolves them." },
        { name: "Competitive brief", text: "How your motives and obstacles differ from up to three competitors, measured under the same criteria." }
      ],
      useful: [
        "Launches with an untested adoption hypothesis. Conversion that drops without the channel explaining it. Defense when people leave for something other than price. Repositioning in a mature category that needs to reopen the reason to use. Communication meant to activate a behavior, beyond reminding people of the brand."
      ],
      limits: [
        "It doesn't estimate market size or share; it is directional and motivational. It doesn't replace a quantitative concept test: it helps design the hypothesis worth testing. It captures the system of motives at the time of the reading; if the conversation is older than nine months, it may describe something that has already changed. And it doesn't diagnose awareness: if nobody knows the category, there is no decision to read."
      ]
    }
  ),
  method(
    { es: "value-perception-matrix", en: "value-perception-matrix" },
    {
      name: "Value Perception Matrix",
      metaDescription: "Por qué te eligen cuando no eres la opción más barata. Mide el valor como lo vive la gente, en doce celdas: dinero, tiempo, esfuerzo y riesgo contra beneficio funcional, emocional y simbólico.",
      question: "¿Por qué te eligen cuando no eres la opción más barata?",
      lead: "Value Perception Matrix mide el valor como lo vive la gente: lo que entrega (dinero, tiempo, esfuerzo y riesgo) contra lo que recibe (beneficio funcional, emocional y simbólico). Son doce celdas donde se ve qué capitaliza tu marca, qué está abandonando, dónde cobra una prima sin razón visible y qué espacio no ocupa nadie.",
      summary: "Dónde tu marca justifica su precio, dónde paga una prima sin retorno y qué espacio sigue libre.",
      looksAt: [
        "Reconstruye contra qué alternativas compara la gente de verdad, que no siempre son las que tu categoría asume. Detecta qué entiende cada persona por valor: ahorro, rapidez, confianza, estatus, menos riesgo. Y lee a tu marca, a tus competidores y a los sustitutos con las mismas fuentes y el mismo periodo.",
        "Cada mención de valor se clasifica en dos ejes a la vez. El costo percibido: monetario, de tiempo, de esfuerzo o de riesgo. Y el beneficio percibido: funcional, emocional o simbólico. El cruce da doce celdas, y cada celda se llena con la percepción de tu marca y la de cada competidor.",
        "La matriz revela cuatro cosas: dónde te ven mejor que a los demás, dónde podrías capitalizar y un competidor lo hace por ti, dónde nadie ocupa bien el espacio y dónde cobras más sin que la gente vea por qué."
      ],
      foundations: [
        { name: "Perceived Value · Zeithaml (1988)", text: "El valor es lo que se recibe comparado con lo que se entrega, tal como lo percibe la persona." },
        { name: "Prospect Theory · Kahneman y Tversky (1979)", text: "Las pérdidas pesan más que las ganancias equivalentes. Explica por qué el riesgo frena más de lo que el beneficio empuja." },
        { name: "Brand Benefits Framework · Park, Jaworski y MacInnis (1986)", text: "Beneficios funcionales, emocionales y simbólicos como las tres dimensiones del valor de una marca." },
        { name: "Customer-Based Brand Equity · Keller (1993)", text: "La marca como una red de asociaciones en la memoria, construida por experiencias. Es la base para mapear cada celda." }
      ],
      steps: [
        { name: "Definimos el marco competitivo", text: "Tu marca y al menos dos competidores directos, con criterios claros de quién entra y quién no. Si la lista está mal armada, la matriz miente." },
        { name: "Reconstruimos contra qué compara la gente", text: "Alternativas, sustitutos y el momento del recorrido en que aparece la comparación." },
        { name: "Clasificamos cada mención por costo y beneficio", text: "Las dos dimensiones a la vez, con el tono con que se dice." },
        { name: "Llenamos la matriz por marca", text: "Doce celdas con tu marca y cada competidor, medidos con el mismo criterio y el mismo periodo." },
        { name: "Leemos la matriz", text: "Qué capitalizas, qué abandonas, qué espacio está libre y dónde cobras una prima sin razón visible." }
      ],
      outputs: [
        { name: "Matriz de valor percibido", text: "La tabla de doce celdas con cada marca ubicada y las citas que lo sostienen." },
        { name: "Reporte de espacio libre", text: "Las celdas que nadie ocupa bien y una hipótesis para ocuparlas." },
        { name: "Brief de defensa", text: "Las celdas donde pierdes terreno frente a un competidor y qué hacer con cada una." },
        { name: "Hipótesis de recategorización", text: "Cuando los hallazgos sugieren que compites en una categoría distinta a la que asumes." }
      ],
      useful: [
        "Reposicionamiento o redefinición de la propuesta de valor. Defensa de margen frente a un entrante barato. Evaluación después de un lanzamiento, para saber si la propuesta llegó como se diseñó. Detección de huecos defensivos antes de que un competidor los ocupe."
      ],
      limits: [
        "No mide elasticidad de precio ni dice cuál es el precio óptimo; para eso existen el análisis conjoint y los experimentos. Da posiciones relativas entre las marcas comparadas; una calificación absoluta no sale de aquí. Es sensible al marco competitivo: si falta un competidor relevante, la lectura queda incompleta. Describe el presente, sin proyectar cómo se moverá la matriz si cambias la comunicación. Y no aplica cuando no hay competencia comparable o cuando la categoría es puramente funcional, sin marca que importe."
      ]
    },
    {
      name: "Value Perception Matrix",
      metaDescription: "Why people choose you when you are not the cheapest option. It measures value as people experience it, in twelve cells: money, time, effort and risk against functional, emotional and symbolic benefit.",
      question: "Why do people choose you when you are not the cheapest option?",
      lead: "Value Perception Matrix measures value as people experience it: what they give (money, time, effort and risk) against what they get (functional, emotional and symbolic benefit). Twelve cells show what your brand capitalizes on, what it is giving up, where it charges a premium with no visible reason and which space nobody occupies.",
      summary: "Where your brand justifies its price, where it pays a premium with no return and which space is still open.",
      looksAt: [
        "It reconstructs which alternatives people really compare against, which are not always the ones your category assumes. It detects what each person means by value: savings, speed, trust, status, less risk. And it reads your brand, your competitors and the substitutes with the same sources and the same period.",
        "Every mention of value is classified on two axes at once. Perceived cost: monetary, time, effort or risk. And perceived benefit: functional, emotional or symbolic. The crossing gives twelve cells, and each cell is filled with the perception of your brand and of each competitor.",
        "The matrix reveals four things: where people see you as better than the rest, where you could capitalize but a competitor does it for you, where nobody occupies the space well, and where you charge more without people seeing why."
      ],
      foundations: [
        { name: "Perceived Value · Zeithaml (1988)", text: "Value is what is received compared with what is given, as the person perceives it." },
        { name: "Prospect Theory · Kahneman and Tversky (1979)", text: "Losses weigh more than equivalent gains. It explains why risk holds back more than benefit pushes." },
        { name: "Brand Benefits Framework · Park, Jaworski and MacInnis (1986)", text: "Functional, emotional and symbolic benefits as the three dimensions of a brand's value." },
        { name: "Customer-Based Brand Equity · Keller (1993)", text: "The brand as a network of associations in memory, built by experiences. It is the basis for mapping each cell." }
      ],
      steps: [
        { name: "We define the competitive frame", text: "Your brand and at least two direct competitors, with clear criteria for who is in and who is out. If the list is wrong, the matrix lies." },
        { name: "We reconstruct what people compare against", text: "Alternatives, substitutes and the point in the journey where the comparison shows up." },
        { name: "We classify every mention by cost and benefit", text: "Both dimensions at once, along with the tone it is said in." },
        { name: "We fill the matrix per brand", text: "Twelve cells with your brand and each competitor, measured under the same criteria and the same period." },
        { name: "We read the matrix", text: "What you capitalize on, what you give up, which space is open and where you charge a premium with no visible reason." }
      ],
      outputs: [
        { name: "Value perception matrix", text: "The twelve-cell table with each brand placed and the quotes that support it." },
        { name: "Whitespace report", text: "The cells nobody occupies well and a hypothesis for occupying them." },
        { name: "Defense brief", text: "The cells where you are losing ground to a competitor and what to do about each one." },
        { name: "Recategorization hypothesis", text: "When the findings suggest you compete in a different category from the one you assume." }
      ],
      useful: [
        "Repositioning or redefining the value proposition. Defending margin against a low-cost entrant. Evaluating after a launch, to know whether the proposition landed as designed. Spotting defensive gaps before a competitor fills them."
      ],
      limits: [
        "It doesn't measure price elasticity or tell you the optimal price point; conjoint analysis and experiments do that. It gives relative positions among the brands compared; an absolute score doesn't come out of it. It is sensitive to the competitive frame: if a relevant competitor is missing, the reading is incomplete. It describes the present and doesn't project how the matrix will move if you change your communication. And it doesn't apply when there is no comparable competition or when the category is purely functional, with no brand that matters."
      ]
    }
  ),
  method(
    { es: "cultural-codes-decoding", en: "cultural-codes-decoding" },
    {
      name: "Cultural Codes Decoding",
      metaDescription: "Qué significa tu categoría en la vida real de la gente de un mercado: qué se admira, qué se ridiculiza, qué da permiso. Una lectura semiótica en tres niveles para elegir un lenguaje que sí pertenezca.",
      question: "¿Qué significa tu categoría en la vida real de la gente de un mercado?",
      lead: "Cultural Codes Decoding hace visibles las reglas no escritas de una categoría en un mercado: qué se admira, qué se ridiculiza, qué da permiso. Lee el lenguaje en tres niveles y detecta las oposiciones que estructuran el significado, para que tu marca elija su lugar con conciencia.",
      summary: "Las reglas no escritas de una categoría en un mercado, y qué lenguaje tiene permiso de existir ahí.",
      looksAt: [
        "Lee fuentes culturalmente densas: foros, comunidades, comentarios largos, ensayos personales y conversación donde la gente se explica con calma. Se hace por país, porque el mismo objeto significa cosas distintas de un mercado a otro.",
        "Cada elemento de la categoría se lee en tres niveles: lo que es literalmente, lo que connota de inmediato y el mito que cumple en el imaginario colectivo. Quedarse en la connotación produce decoración; llegar al mito mueve la estrategia de marca.",
        "Al mismo tiempo se detectan, desde el lenguaje de la conversación, las oposiciones que ordenan la categoría: auténtico y comercial, tradición e innovación, cuidado y vanidad, local y global. Cada oposición tiene un polo legitimado que cambia por mercado y por momento. Cuando los tres niveles legitiman el mismo polo, el código es estable. Cuando se contradicen, hay una tensión activa, y ahí está el espacio narrativo disponible."
      ],
      foundations: [
        { name: "Semiótica estructural · Saussure (1916)", text: "El significado nace de oposiciones dentro de un sistema. Da la lógica para detectar los contrastes que ordenan una categoría." },
        { name: "Mitologías · Barthes (1957)", text: "Los objetos de consumo cargan significados de segundo orden. De aquí vienen los tres niveles: denotación, connotación y mito." },
        { name: "Descripción densa · Geertz (1973)", text: "La cultura se lee desde adentro, en su propio contexto. Es el marco metodológico de toda la lectura." },
        { name: "Bienes como comunicación · Douglas e Isherwood (1979)", text: "Lo que se consume funciona como un sistema de comunicación social, y así se lee." }
      ],
      steps: [
        { name: "Definimos mercado y categoría", text: "Un país a la vez. Una lectura regional borra justo lo que este método busca." },
        { name: "Reunimos conversación densa", text: "Foros, comunidades, comentarios largos y textos personales donde la categoría se explica, con comparativos de mercados vecinos cuando ayuda a ver lo local." },
        { name: "Identificamos palabras, metáforas y comparaciones recurrentes", text: "Y las leemos en los tres niveles, de lo literal al mito." },
        { name: "Detectamos las oposiciones", text: "Qué contrastes ordenan la categoría, qué polo se legitima en cada nivel y dónde los niveles se contradicen." },
        { name: "Ubicamos marcas y competidores en el sistema", text: "Qué código ocupa cada una, cuál está libre y qué tensión puede trabajar tu marca con credibilidad." }
      ],
      outputs: [
        { name: "Dossier de códigos culturales", text: "El sistema simbólico de la categoría documentado: tres niveles, oposiciones y tensiones activas, con sus citas." },
        { name: "Mapa simbólico", text: "Tu marca y tus competidores ubicados dentro del sistema." },
        { name: "Brief de código", text: "Qué código ocupar, cuál abandonar y cuál tensar, como insumo para marca, campaña o entrada a mercado." }
      ],
      useful: [
        "Entrada a un mercado donde la categoría existe pero opera con códigos locales distintos. Reposicionamiento profundo, de significado más que de estética. Lanzamiento en una categoría madura donde lo obvio ya no diferencia. Adaptación de una campaña global a un contexto específico. Detección de tensiones simbólicas que abren espacio para una narrativa nueva."
      ],
      limits: [
        "Es interpretativo: produce comprensión estructural, con rigor y triangulación, sin porcentajes. No sirve sobre conversación puramente transaccional; la densidad cultural vive en comunidades y texto largo. No opera por demografía: lee sistemas simbólicos, que cruzan edades y segmentos. Captura el sistema en el momento de la lectura; los códigos cambian despacio y conviene revisar cada 18 a 24 meses en una categoría activa. Y no predice si una campaña funcionará: da el territorio simbólico viable, y la ejecución creativa sigue siendo de los creativos."
      ]
    },
    {
      name: "Cultural Codes Decoding",
      metaDescription: "What your category means in people's real lives in a market: what is admired, what is ridiculed, what grants permission. A semiotic reading on three levels to choose a language that belongs.",
      question: "What does your category mean in people's real lives in a given market?",
      lead: "Cultural Codes Decoding makes the unwritten rules of a category in a market visible: what is admired, what is ridiculed, what grants permission. It reads language on three levels and detects the oppositions that structure meaning, so your brand can choose its place with awareness.",
      summary: "The unwritten rules of a category in a market, and which language has permission to exist there.",
      looksAt: [
        "It reads culturally dense sources: forums, communities, long comments, personal essays and conversation where people explain themselves at length. It is done per country, because the same object means different things from one market to the next.",
        "Each element of the category is read on three levels: what it literally is, what it immediately connotes and the myth it plays in the collective imagination. Stopping at connotation produces decoration; reaching the myth moves brand strategy.",
        "At the same time, the oppositions that organize the category are detected from the language of the conversación: authentic and commercial, tradition and innovation, care and vanity, local and global. Each opposition has a legitimized pole that changes by market and by moment. When all three levels legitimize the same pole, the code is stable. When they contradict each other, there is an active tension, and that is where the available narrative space lies."
      ],
      foundations: [
        { name: "Structural semiotics · Saussure (1916)", text: "Meaning is born from oppositions within a system. It provides the logic for detecting the contrasts that organize a category." },
        { name: "Mythologies · Barthes (1957)", text: "Consumer objects carry second-order meanings. This is where the three levels come from: denotation, connotation and myth." },
        { name: "Thick description · Geertz (1973)", text: "Culture is read from the inside, in its own context. It is the methodological frame for the whole reading." },
        { name: "Goods as communication · Douglas and Isherwood (1979)", text: "What is consumed works as a system of social communication, and that is how it is read." }
      ],
      steps: [
        { name: "We define market and category", text: "One country at a time. A regional reading erases exactly what this method looks for." },
        { name: "We gather dense conversation", text: "Forums, communities, long comments and personal texts where the category is explained, with neighboring markets as a comparison when it helps to see what is local." },
        { name: "We identify recurring words, metaphors and comparisons", text: "And read them on the three levels, from the literal to the myth." },
        { name: "We detect the oppositions", text: "Which contrasts organize the category, which pole is legitimized on each level and where the levels contradict each other." },
        { name: "We place brands and competitors in the system", text: "Which code each one occupies, which is open and which tension your brand can work with credibility." }
      ],
      outputs: [
        { name: "Cultural codes dossier", text: "The category's symbolic system documented: three levels, oppositions and active tensions, with their quotes." },
        { name: "Symbolic map", text: "Your brand and your competitors placed within the system." },
        { name: "Code brief", text: "Which code to occupy, which to leave and which to stretch, as input for brand, campaign or market entry." }
      ],
      useful: [
        "Entering a market where the category exists but runs on different local codes. Deep repositioning, of meaning rather than aesthetics. Launching in a mature category where the obvious no longer differentiates. Adapting a global campaign to a specific context. Detecting symbolic tensions that open room for a new narrative."
      ],
      limits: [
        "It is interpretive: it produces structural understanding, with rigor and triangulation, and no percentages. It doesn't work on purely transactional conversation; cultural density lives in communities and long text. It doesn't operate by demographics: it reads symbolic systems, which cut across ages and segments. It captures the system at the time of the reading; codes change slowly and are worth revisiting every 18 to 24 months in an active category. And it doesn't predict whether a campaign will work: it gives the viable symbolic territory, and the creative execution remains with the creatives."
      ]
    }
  ),
  method(
    { es: "decision-velocity", en: "decision-velocity" },
    {
      name: "Decision Velocity",
      metaDescription: "Por qué la gente decide rápido en otras categorías y lento en la tuya. Tres fases de decisión, dos modos de pensar, y qué frena o acelera el avance hacia la compra.",
      question: "¿Por qué la gente decide rápido en otras categorías y lento en la tuya?",
      lead: "Decision Velocity reconstruye cómo decide la gente en tres fases, antes, durante y después de elegir, y qué modo de pensar domina en cada una: el rápido e intuitivo o el lento y deliberado. Con eso se ve qué frena el avance, qué lo acelera y qué conviene mostrar antes.",
      summary: "Qué frena y qué acelera una decisión de compra, fase por fase, y qué conviene mostrar antes.",
      looksAt: [
        "Lee conversación donde la persona narra su proceso de decisión completo, más allá del resultado: hilos largos donde alguien cuenta cuánto tardó en elegir, reseñas escritas semanas o meses después de la compra, preguntas que se hacen antes de decidir.",
        "Cada mención se codifica en dos ejes. La fase: antes de decidir, mientras decide o después de decidir. Y el modo de pensar que domina: el rápido, que elige por familiaridad, recomendación o costumbre, o el lento, que compara, lee y calcula. Una categoría puede pedir mucha investigación al principio y cerrar la elección por intuición, y esa transición es donde suele estar la oportunidad.",
        "Dentro de cada fase se clasifica lo que frena (sobrecarga de opciones, ambigüedad, riesgo sin resolver, presión que genera rechazo, falta de validación social) y lo que acelera (una opción por defecto sensata, una regla simple para elegir, una recomendación confiable, una reducción visible de riesgo, un punto de referencia, una urgencia real). Cuando tienes datos internos de funnel o abandono, se cruzan con la conversación."
      ],
      foundations: [
        { name: "Dual-Process Theory · Kahneman (2011)", text: "Dos modos de pensar, uno rápido e intuitivo y otro lento y deliberado. Es el eje cognitivo del método." },
        { name: "Choice Architecture · Thaler y Sunstein (2008)", text: "Cómo se presentan las opciones cambia qué se elige. Es la salida accionable del método." },
        { name: "Decision Fatigue · Baumeister (1998)", text: "La capacidad de decidir se agota con el uso. Explica abandonos que llegan tarde en el recorrido." },
        { name: "Information Foraging · Pirolli y Card (1999)", text: "La gente busca información equilibrando lo que obtiene contra lo que le cuesta buscar." }
      ],
      steps: [
        { name: "Delimitamos la decisión", text: "Qué se decide, cuánto suele tardar y cuánto debería tardar según tu categoría. Lo lento para un auto es rápido para un snack." },
        { name: "Reunimos conversación narrativa de las tres fases", text: "Antes, durante y después de elegir, con fuentes donde la gente cuenta el proceso completo." },
        { name: "Codificamos cada mención por fase y modo de pensar", text: "Para ver dónde la decisión se vuelve lenta o rápida, y por qué." },
        { name: "Clasificamos frenos y aceleradores", text: "Los que están presentes, los que faltan y los que cambian de una fase a otra." },
        { name: "Recomendamos la arquitectura de elección", text: "Qué mostrar antes, cuántas opciones, qué dejar por defecto, qué secuencia y en qué momento pedir la acción." }
      ],
      outputs: [
        { name: "Diagnóstico de velocidad", text: "Si la decisión es lenta o rápida, en qué fase se desbalancea y qué modo de pensar domina en cada una." },
        { name: "Mapa de frenos", text: "Lo que detiene el avance, jerarquizado por fase y con sus citas." },
        { name: "Mapa de aceleradores", text: "Lo que ya empuja la decisión y lo que falta." },
        { name: "Brief de arquitectura de elección", text: "Recomendaciones concretas para el funnel: opciones por defecto, puntos de referencia, secuencia, número de opciones y momento del llamado a la acción." }
      ],
      useful: [
        "Optimización de conversión cuando el problema no es awareness ni consideración. Rediseño de configuradores, páginas de precio y comparadores. Comercio electrónico con surtido grande donde la gente abandona por exceso de opciones. Categorías donde la decisión es inusualmente lenta o inusualmente rápida. Lanzamientos donde la velocidad esperada y la real no coinciden."
      ],
      limits: [
        "No sustituye una prueba A/B: entrega hipótesis fuertes y la validación cuantitativa es el paso siguiente. Necesita conversación narrativa; con reseñas cortas no alcanza para reconstruir el proceso. No diagnostica el abandono anterior a la consideración: si la gente nunca llega a decidir, no hay decisión que leer. Y la velocidad normal depende de la categoría, así que la lectura siempre es relativa a la tuya."
      ]
    },
    {
      name: "Decision Velocity",
      metaDescription: "Why people decide fast in other categories and slowly in yours. Three decision phases, two modes of thinking, and what slows or speeds up the path to purchase.",
      question: "Why do people decide fast in other categories and slowly in yours?",
      lead: "Decision Velocity reconstructs how people decide across three phases, before, during and after choosing, and which mode of thinking dominates each one: the fast and intuitive or the slow and deliberate. That shows what slows the decision down, what speeds it up and what is worth showing earlier.",
      summary: "What slows down and what speeds up a purchase decision, phase by phase, and what to show earlier.",
      looksAt: [
        "It reads conversation where the person narrates their whole decision process, beyond the outcome: long threads where someone tells how long they took to choose, reviews written weeks or months after the purchase, questions asked before deciding.",
        "Each mention is coded on two axes. The phase: before deciding, while deciding or after deciding. And the dominant mode of thinking: the fast one, which chooses by familiarity, recommendation or habit, or the slow one, which compares, reads and calculates. A category can demand a lot of research at the start and close the choice by intuition, and that transition is usually where the opportunity lies.",
        "Within each phase it classifies what slows things down (too many options, ambiguity, unresolved risk, pressure that triggers pushback, lack of social validation) and what speeds them up (a sensible default, a simple rule for choosing, a trusted recommendation, a visible reduction of risk, a reference point, a real urgency). When you have internal funnel or abandonment data, it is crossed with the conversation."
      ],
      foundations: [
        { name: "Dual-Process Theory · Kahneman (2011)", text: "Two modes of thinking, one fast and intuitive, one slow and deliberate. It is the cognitive axis of the method." },
        { name: "Choice Architecture · Thaler and Sunstein (2008)", text: "How options are presented changes what gets chosen. It is the actionable output of the method." },
        { name: "Decision Fatigue · Baumeister (1998)", text: "The capacity to decide wears out with use. It explains abandonment late in the journey." },
        { name: "Information Foraging · Pirolli and Card (1999)", text: "People search for information by balancing what they get against what it costs them to look." }
      ],
      steps: [
        { name: "We delimit the decision", text: "What is being decided, how long it usually takes and how long it should take for your category. Slow for a car is fast for a snack." },
        { name: "We gather narrative conversation from the three phases", text: "Before, during and after choosing, from sources where people tell the whole process." },
        { name: "We code every mention by phase and mode of thinking", text: "To see where the decision turns slow or fast, and why." },
        { name: "We classify blockers and accelerators", text: "The ones present, the ones missing and the ones that change from one phase to the next." },
        { name: "We recommend the choice architecture", text: "What to show earlier, how many options, what to set as default, in what sequence and when to ask for the action." }
      ],
      outputs: [
        { name: "Velocity diagnostic", text: "Whether the decision is slow or fast, in which phase it tips and which mode of thinking dominates each one." },
        { name: "Blockers map", text: "What holds the decision back, ranked by phase and with its quotes." },
        { name: "Accelerators map", text: "What already pushes the decision forward and what is missing." },
        { name: "Choice architecture brief", text: "Specific recommendations for the funnel: defaults, reference points, sequence, number of options and timing of the call to action." }
      ],
      useful: [
        "Conversion optimization when the problem is neither awareness nor consideration. Redesign of configurators, pricing pages and comparison tools. E-commerce with a large assortment where people abandon because of too many options. Categories where the decision is unusually slow or unusually fast. Launches where the expected speed and the real one don't match."
      ],
      limits: [
        "It doesn't replace an A/B test: it delivers strong hypotheses and quantitative validation is the next step. It needs narrative conversation; short reviews are not enough to reconstruct the process. It doesn't diagnose abandonment before consideration: if people never get to the point of deciding, there is no decision to read. And normal speed depends on the category, so the reading is always relative to yours."
      ]
    }
  ),
  method(
    { es: "journey-friction-mapping", en: "journey-friction-mapping" },
    {
      name: "Journey Friction Mapping",
      metaDescription: "Dónde se pierde la intención antes de volverse acción y qué tipo de fricción la rompe: inercia, esfuerzo, emoción o reactancia. Cada tipo pide una solución distinta.",
      question: "¿Dónde se pierde la intención antes de volverse acción, y qué la rompe?",
      lead: "Journey Friction Mapping reconstruye el recorrido como lo vive la gente y clasifica cada fricción en uno de cuatro tipos: inercia, esfuerzo, emoción o reactancia. Cada tipo pide una solución distinta, y confundirlos es la razón de que muchas mejoras no mejoren nada.",
      summary: "El recorrido real, momento por momento, los puntos donde se rompe y qué fricción conviene quitar primero.",
      looksAt: [
        "Lee conversación que narra una experiencia de uso o una intención que no se concretó: quejas, reseñas bajas, comentarios de cancelación, hilos de por qué alguien dejó de usar algo. El recorrido no se dibuja en un workshop; se reconstruye desde lo que cuenta la gente, y suelen aparecer entre cuatro y siete fases.",
        "Cada fricción se clasifica en uno de cuatro tipos. Inercia, cuando cambiar cuesta más que seguir igual. Esfuerzo, cuando la acción pide demasiados pasos o demasiada atención. Emoción, cuando el miedo, la vergüenza o la frustración bloquean. Reactancia, cuando la persona siente que la empujan y se resiste. Un descuento resuelve esfuerzo pero deja intacta la inercia; por eso la clasificación decide la intervención.",
        "No toda fricción rompe el recorrido. Un punto de quiebre es una fricción que aparece junto a un abandono explícito: por eso no lo compré, me cambié a otro, dejé de usarlo. Una queja muy repetida que no se asocia con abandono es ruido: la gente se queja y compra igual. Cada fricción se marca también por su movilidad: la puedes quitar tú, depende de un tercero o es estructural y solo se puede comunicar mejor."
      ],
      foundations: [
        { name: "Customer Journey Theory · Lemon y Verhoef (2016)", text: "Los puntos de contacto, en secuencia y en contexto, son la unidad de análisis de la experiencia real." },
        { name: "Friction Theory · Nordgren y Schonthal (2021)", text: "Cuatro fuerzas frenan el cambio: inercia, esfuerzo, emoción y reactancia. Es el corazón del método." },
        { name: "Cognitive Load Theory · Sweller (1988)", text: "Demasiada carga mental provoca abandono antes de terminar. Sustenta el tipo esfuerzo." },
        { name: "Peak-End Rule · Kahneman (1993)", text: "Una experiencia se recuerda por su momento más intenso y por su final. Orienta qué fases priorizar." }
      ],
      steps: [
        { name: "Definimos el recorrido", text: "Cuál: primera compra, recompra, suscripción, alta en un servicio. Cada uno tiene fricciones distintas." },
        { name: "Reunimos conversación donde aparece el abandono", text: "Quejas, reseñas bajas, cancelaciones y, cuando existe, el competidor que sí logra que la gente termine, para ver la diferencia." },
        { name: "Reconstruimos las fases desde lo que dice la gente", text: "Sin imponer un embudo previo. Las fases salen de la conversación." },
        { name: "Clasificamos cada fricción por tipo y fase", text: "Y marcamos los puntos de quiebre: las fricciones que aparecen junto a un abandono explícito." },
        { name: "Priorizamos", text: "Por impacto en el abandono y por movilidad: qué puedes quitar tú, qué depende de otro y qué solo se comunica." }
      ],
      outputs: [
        { name: "Mapa de fricción", text: "La matriz de tipo por fase, con densidad de fricciones y movilidad en cada celda." },
        { name: "Brief de puntos de quiebre", text: "Los tres a cinco puntos que más causan abandono, con su evidencia y lo que se puede hacer con cada uno." },
        { name: "Ruta de mejoras priorizada", text: "La secuencia de intervenciones en orden, con el esfuerzo que pide cada una y el efecto esperado." }
      ],
      useful: [
        "Cuando la analítica muestra dónde se cae la gente pero no por qué. Rediseño de experiencias de compra, registro, onboarding o app. Un producto bueno que no convierte. Defensa frente a un competidor que parece menos producto y más fluidez. Expansión a un canal nuevo donde el recorrido actual no se traslada."
      ],
      limits: [
        "Captura las fricciones que la gente sabe nombrar; las que no puede articular piden observación directa o pruebas de usabilidad. La gente reconstruye lo que falló y su relato no siempre coincide con lo que pasó. Da prioridades relativas; el porcentaje de mejora esperado se mide después con experimentos. No aplica a compras impulsivas sin recorrido. Y si el problema es que la gente no quiere el producto, no hay fricción que quitar; hay propuesta de valor que revisar."
      ]
    },
    {
      name: "Journey Friction Mapping",
      metaDescription: "Where intent gets lost before it becomes action and which kind of friction breaks it: inertia, effort, emotion or reactance. Each type calls for a different fix.",
      question: "Where does intent get lost before it becomes action, and what breaks it?",
      lead: "Journey Friction Mapping reconstructs the journey as people live it and classifies every friction into one of four types: inertia, effort, emotion or reactance. Each type calls for a different fix, and mixing them up is the reason many improvements improve nothing.",
      summary: "The real journey, moment by moment, the points where it breaks and which friction to remove first.",
      looksAt: [
        "It reads conversation that narrates a usage experience or an intention that never materialized: complaints, low reviews, cancellation comments, threads about why someone stopped using something. The journey isn't drawn in a workshop; it is reconstructed from what people tell, and usually four to seven phases emerge.",
        "Every friction is classified into one of four types. Inertia, when changing costs more than staying the same. Effort, when the action asks for too many steps or too much attention. Emotion, when fear, embarrassment or frustration block it. Reactance, when the person feels pushed and resists. A discount fixes effort and doesn't touch inertia; that is why the classification decides the intervention.",
        "Not every friction breaks the journey. A break point is a friction that appears next to an explicit abandonment: that is why I didn't buy it, I switched, I stopped using it. A frequently repeated complaint that isn't linked to abandonment is noise: people complain and buy anyway. Each friction is also tagged by its mobility: you can remove it, it depends on a third party, or it is structural and can only be communicated better."
      ],
      foundations: [
        { name: "Customer Journey Theory · Lemon and Verhoef (2016)", text: "Touchpoints, in sequence and in context, are the unit of analysis of real experience." },
        { name: "Friction Theory · Nordgren and Schonthal (2021)", text: "Four forces hold back change: inertia, effort, emotion and reactance. It is the heart of the method." },
        { name: "Cognitive Load Theory · Sweller (1988)", text: "Too much mental load causes abandonment before completion. It underpins the effort type." },
        { name: "Peak-End Rule · Kahneman (1993)", text: "An experience is remembered by its most intense moment and by its ending. It guides which phases to prioritize." }
      ],
      steps: [
        { name: "We define the journey", text: "Which one: first purchase, repurchase, subscription, signing up for a service. Each has different frictions." },
        { name: "We gather conversation where abandonment shows up", text: "Complaints, low reviews, cancellations and, when it exists, the competitor that does get people to finish, to see the difference." },
        { name: "We reconstruct the phases from what people say", text: "Without imposing a funnel in advance. The phases come out of the conversación." },
        { name: "We classify every friction by type and phase", text: "And mark the break points: the frictions that appear next to an explicit abandonment." },
        { name: "We prioritize", text: "By impact on abandonment and by mobility: what you can remove, what depends on someone else and what can only be communicated." }
      ],
      outputs: [
        { name: "Friction map", text: "The type-by-phase matrix, with friction density and mobility in every cell." },
        { name: "Break points brief", text: "The three to five points that cause the most abandonment, with their evidence and what can be done about each." },
        { name: "Prioritized improvement roadmap", text: "The sequence of interventions in order, with the effort each one asks for and the expected effect." }
      ],
      useful: [
        "When analytics shows where people drop off but not why. Redesign of purchase, sign-up, onboarding or app experiences. A good product that doesn't convert. Defense against a competitor that seems like less product and more flow. Expansion to a new channel where the current journey doesn't carry over."
      ],
      limits: [
        "It captures the frictions people can name; the ones they cannot articulate call for direct observation or usability testing. People reconstruct what went wrong and their account doesn't always match what happened. It gives relative priorities; the expected percentage of improvement is measured later with experiments. It doesn't apply to impulse purchases with no journey. And if the problem is that people don't want the product, there is no friction to remove; there is a value proposition to revisit."
      ]
    }
  ),
  method(
    { es: "influence-architecture", en: "influence-architecture" },
    {
      name: "Influence Architecture",
      metaDescription: "Qué voces hacen creíble una idea en tu categoría y cómo viaja la influencia entre comunidades. Seis funciones en la red, lazos fuertes y débiles, y las voces que el conteo de seguidores no ve.",
      question: "¿Qué voces hacen creíble una idea en tu categoría?",
      lead: "Influence Architecture mapea quién diseña, muchas veces sin saberlo, lo que una categoría significa. Clasifica cada voz por la función que cumple en la red, más allá de sus seguidores, y muestra por dónde entra lo nuevo a una comunidad.",
      summary: "Quién legitima, quién conecta y quién disiente en tu categoría, y por dónde viaja una idea nueva.",
      looksAt: [
        "Parte de las comunidades que rodean a la categoría: foros, grupos, comunidades de creadores, cuentas que la conversación cita. Lee su contenido y sus interacciones durante una ventana de varios meses, para que las relaciones tengan sustento.",
        "Cada voz se clasifica por la función que cumple, observada en lo que hace, más allá de sus métricas: quien adopta primero e inventa el vocabulario, quien legitima lo que otros inventaron, quien sirve de prueba cuando los demás lo citan, quien conecta comunidades que no se hablan, quien articula la crítica que otros adoptan y quien controla el acceso a una conversación. Una cuenta enorme que solo recircula contenido ajeno es un conector con mucha audiencia, y se lee como tal.",
        "Las relaciones también se leen. Los lazos fuertes, dentro de una comunidad, hacen eco de lo mismo. Los lazos débiles, entre comunidades, son por donde entra lo nuevo. Medidas de red muestran a los conectores y validadores que el conteo de seguidores no ve, que suelen ser las voces más subestimadas y más valiosas."
      ],
      foundations: [
        { name: "Strength of Weak Ties · Granovetter (1973)", text: "La información nueva viaja por los lazos débiles entre comunidades; los lazos fuertes dentro de una comunidad repiten lo que ya se sabe." },
        { name: "Diffusion of Innovations · Rogers (1962)", text: "Roles distintos en la adopción, de quien prueba primero a quien legitima. Da la tipología de funciones." },
        { name: "Two-Step Flow · Katz y Lazarsfeld (1955)", text: "Los líderes de opinión median entre los medios y la adopción real de una idea." },
        { name: "Scale-Free Networks · Barabási (1999)", text: "Las redes tienen nodos que concentran el flujo de forma desproporcionada. Explica por qué pocas voces mueven mucho." }
      ],
      steps: [
        { name: "Definimos la categoría y sus comunidades", text: "Las que la rodean y las adyacentes que podrían entrar. Si una comunidad relevante queda fuera, el mapa queda parcial." },
        { name: "Reunimos contenido e interacciones", text: "Publicaciones, respuestas, citas y comentarios durante una ventana suficiente para ver relaciones estables." },
        { name: "Clasificamos cada voz por su función observada", text: "Innovador, adoptante temprano, validador, conector, disidente o guardián, según lo que hace en la conversación." },
        { name: "Medimos cómo se conectan", text: "Qué comunidades une cada voz, qué tipo de lazo domina y quién aparece en el camino entre grupos." },
        { name: "Priorizamos", text: "Qué voces conviene escuchar, con cuáles construir relación y a cuáles vigilar como señal temprana." }
      ],
      outputs: [
        { name: "Mapa de influencia", text: "La red completa de la categoría, con la función y el peso de cada voz." },
        { name: "Dossier de voces", text: "Fichas de las voces que más pesan: función, comunidades que conecta, tono, riesgos y valor de relación." },
        { name: "Estrategia de activación", text: "Qué voces activar y cómo, con una lógica de relación en lugar de compra de espacio, qué voces monitorear y cuáles investigar." },
        { name: "Sistema de alerta temprana", text: "Qué voces vigilar para detectar un movimiento de la categoría antes de que aparezca en las métricas habituales." }
      ],
      useful: [
        "Estrategias de influencia donde el conteo de seguidores ya demostró ser mala señal. Lanzamientos en categorías especializadas. Defensa reputacional cuando una crisis se propaga entre comunidades. Detección de tendencias emergentes, viendo quién adopta vocabulario nuevo antes que el mercado. Diseño de una comunidad de marca con criterios de invitación que vayan más allá del alcance."
      ],
      limits: [
        "Identifica la estructura; construir la relación con cada voz es otro trabajo, de contenido y de tiempo. No entrega una lista de influencers para contratar. No mide el retorno de campañas pasadas; mira la estructura presente. Las redes cambian, así que conviene revisar el mapa cada 6 a 12 meses en una categoría activa. Es sensible a la definición inicial de comunidades. Y no aplica a categorías de consumo masivo sin estructura comunitaria, donde no hay red que mapear."
      ]
    },
    {
      name: "Influence Architecture",
      metaDescription: "Which voices make an idea credible in your category and how influence travels between communities. Six functions in the network, strong and weak ties, and the voices follower counts don't see.",
      question: "Which voices make an idea credible in your category?",
      lead: "Influence Architecture maps who designs, often without knowing it, what a category means. It classifies each voice by the function it plays in the network, beyond its follower count, and shows where the new enters a community.",
      summary: "Who legitimizes, who connects and who dissents in your category, and how a new idea travels.",
      looksAt: [
        "It starts from the communities around the category: forums, groups, creator communities, accounts the conversation cites. It reads their content and interactions over a window of several months, so that relationships have substance.",
        "Each voice is classified by the function it plays, observed in what it does rather than in its metrics: the one who adopts first and invents the vocabulary, the one who legitimizes what others invented, the one who serves as proof when others cite them, the one who connects communities that don't talk to each other, the one who articulates the criticism others adopt, and the one who controls access to a conversation. A huge account that only recirculates other people's content is a connector with a large audience, and is read as such.",
        "Relationships are read too. Strong ties, within a community, echo the same thing. Weak ties, between communities, are where the new comes in. Network measures reveal the connectors and validators that follower counts miss, who tend to be the most underestimated and most valuable voices."
      ],
      foundations: [
        { name: "Strength of Weak Ties · Granovetter (1973)", text: "New information travels through weak ties between communities; strong ties within one community repeat what is already known." },
        { name: "Diffusion of Innovations · Rogers (1962)", text: "Different roles in adoption, from the first to try to the one who legitimizes. It provides the typology of functions." },
        { name: "Two-Step Flow · Katz and Lazarsfeld (1955)", text: "Opinion leaders mediate between the media and the real adoption of an idea." },
        { name: "Scale-Free Networks · Barabási (1999)", text: "Networks have nodes that concentrate flow disproportionately. It explains why a few voices move a lot." }
      ],
      steps: [
        { name: "We define the category and its communities", text: "The ones around it and the adjacent ones that might come in. If a relevant community is left out, the map stays partial." },
        { name: "We gather content and interactions", text: "Posts, replies, quotes and comments over a window long enough to see stable relationships." },
        { name: "We classify each voice by its observed function", text: "Innovator, early adopter, validator, connector, dissenter or gatekeeper, according to what it does in the conversation." },
        { name: "We measure how they connect", text: "Which communities each voice links, which kind of tie dominates and who sits on the path between groups." },
        { name: "We prioritize", text: "Which voices to listen to, which ones to build a relationship with and which ones to watch as an early signal." }
      ],
      outputs: [
        { name: "Influence map", text: "The category's full network, with the function and weight of each voice." },
        { name: "Voices dossier", text: "Profiles of the voices that weigh most: function, communities they connect, tone, risks and relationship value." },
        { name: "Activation strategy", text: "Which voices to activate and how, with a logic of relationship rather than buying space, which to monitor and which to investigate." },
        { name: "Early warning system", text: "Which voices to watch to detect a category shift before it shows up in the usual metrics." }
      ],
      useful: [
        "Influence strategies where follower counts have already proven to be a poor signal. Launches in specialized categories. Reputation defense when a crisis spreads between communities. Spotting emerging trends by seeing who adopts new vocabulary before the market does. Designing a brand community with invitation criteria that go beyond reach."
      ],
      limits: [
        "It identifies the structure; building the relationship with each voice is a different kind of work, of content and time. It doesn't deliver a list of influencers to hire. It doesn't measure the return on past campaigns; it looks at the present structure. Networks change, so the map is worth revisiting every 6 to 12 months in an active category. It is sensitive to the initial definition of communities. And it doesn't apply to mass-market categories with no community structure, where there is no network to map."
      ]
    }
  )
];
