import type { Entry } from "./registry";
import type { Localized, PageContent } from "./types";

export const compareIndex: Localized<PageContent> = {
  es: {
    metaTitle: "Comparaciones honestas sobre investigación con conversación",
    metaDescription:
      "Herramienta de social listening, IA generativa, encuestas o agencia. Qué hace bien cada opción, cuándo conviene y cuándo la inteligencia social de Noisia responde mejor.",
    title: "¿Por qué no una herramienta, una IA, una encuesta o una agencia?",
    lead:
      "Las cuatro sirven para algo y conviene saber para qué. Aquí comparamos cada una con la investigación de Noisia, con el mismo criterio y diciendo cuándo la otra opción es la mejor.",
    blocks: [
      {
        type: "text",
        title: "Cómo están hechas estas comparaciones",
        paragraphs: [
          "Cada página responde la pregunta tal como la gente la busca, con la respuesta directa en las primeras líneas, una tabla con los mismos criterios y una sección honesta de cuándo conviene cada opción. No nombramos marcas ni proveedores.",
          "Si tu caso no aparece aquí, el taller gratis sirve para eso: en 30 a 60 minutos vemos si la conversación responde tu pregunta o si te conviene otra herramienta."
        ]
      },
      {
        type: "cta",
        title: "Trae tu pregunta",
        text: "Si no sabes cuál opción te conviene, lo vemos juntos en un taller gratis.",
        label: "Agenda un taller gratis",
        href: "/taller"
      }
    ]
  },
  en: {
    metaTitle: "Honest comparisons about research with conversation",
    metaDescription:
      "Social listening tool, generative AI, surveys or agency. What each option does well, when it makes sense and when Noisia's social intelligence answers better.",
    title: "Why not a tool, an AI, a survey or an agency?",
    lead:
      "All four are good for something and it helps to know what. Here we compare each one with Noisia's research, using the same criteria and saying when the other option is the better choice.",
    blocks: [
      {
        type: "text",
        title: "How these comparisons are made",
        paragraphs: [
          "Each page answers the question the way people search for it, with the direct answer in the first lines, a table with the same criteria and an honest section on when each option makes sense. We don't name brands or vendors.",
          "If your case isn't here, that is what the free workshop is for: in 30 to 60 minutes we look at whether the conversation answers your question or whether another tool is the better fit."
        ]
      },
      {
        type: "cta",
        title: "Bring your question",
        text: "If you don't know which option fits, we look at it together in a free workshop.",
        label: "Book a free workshop",
        href: "/en/workshop"
      }
    ]
  }
};

const cta = {
  es: { type: "cta" as const, title: "Trae tu pregunta", text: "En un taller gratis de 30 a 60 minutos vemos qué opción te conviene, aunque no sea la nuestra.", label: "Agenda un taller gratis", href: "/taller" },
  en: { type: "cta" as const, title: "Bring your question", text: "In a free 30 to 60 minute workshop we look at which option fits you, even if it isn't ours.", label: "Book a free workshop", href: "/en/workshop" }
};

export const compareEntries: Entry[] = [
  {
    slug: { es: "herramientas-de-social-listening", en: "social-listening-tools" },
    summary: {
      es: "La herramienta monitorea volumen y alertas; la investigación responde una pregunta. Cuándo conviene cada una.",
      en: "The tool monitors volume and alerts; research answers a question. When each one makes sense."
    },
    page: {
      es: {
        metaTitle: "Herramienta de social listening o investigación de inteligencia social",
        metaDescription:
          "Una herramienta de social listening monitorea menciones, volumen y sentimiento en un tablero. La investigación de inteligencia social parte de una pregunta y entrega una respuesta con evidencia. Cuándo conviene cada una.",
        title: "¿Herramienta de social listening o investigación de inteligencia social?",
        lead:
          "Una herramienta de social listening te muestra cuánto se habla de tu marca, con qué sentimiento y cuándo hay un pico; alguien de tu equipo tiene que leerla y decidir. La investigación de inteligencia social parte de una pregunta de negocio, lee la conversación completa, la interpreta con un método y te entrega una respuesta con evidencia. La primera sirve para vigilar; la segunda, para decidir.",
        blocks: [
          {
            type: "table",
            title: "Las dos opciones, con el mismo criterio",
            headers: ["Criterio", "Herramienta de social listening", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["Punto de partida", "Palabras y marcas que alguien configura", "Una pregunta de negocio traducida a preguntas investigables"],
              ["Qué entrega", "Tablero con volumen, sentimiento, alertas y exportaciones", "Un reporte o un estudio con hallazgos, evidencia y recomendaciones"],
              ["Temas", "Categorías definidas de antemano o resúmenes automáticos", "Descubiertos desde lo que dice la gente y aprobados por una persona"],
              ["Ruido", "Llega al tablero como viene; se filtra a mano", "Prensa, contenido de marca, reventa y spam fuera, con criterio documentado"],
              ["Quién interpreta", "Tu equipo, con el tiempo que tenga", "Un Intelligence Architect con un método y responsabilidad sobre el análisis"],
              ["Tus datos propios", "Fuera del tablero, salvo integraciones", "NPS, encuestas y búsquedas leídos con la misma estructura de temas"],
              ["Evidencia", "Menciones sueltas al alcance de un clic", "Cada cifra con su cálculo y cada cita verificada contra su fuente"],
              ["Velocidad para vigilar", "Inmediata, con alertas", "Mensual, o según el alcance"],
              ["Velocidad para decidir", "Depende de cuándo alguien lea y analice", "Días del brief a la primera respuesta"],
              ["Costo", "Licencia anual más el tiempo de tu equipo", "Por reporte, estudio o plan anual, definido en el alcance"]
            ]
          },
          {
            type: "cards",
            title: "Cuándo conviene cada una",
            items: [
              { name: "Conviene la herramienta", text: "Cuando necesitas vigilar menciones todos los días, recibir alertas de un pico o una crisis en curso, atender comentarios desde un solo lugar o medir el alcance de una campaña mientras corre. Es trabajo de monitoreo y una buena herramienta lo hace bien." },
              { name: "Conviene Noisia", text: "Cuando tienes una decisión por tomar y necesitas saber por qué pasa algo, qué pesa y qué puedes mover. Cuando nadie en tu equipo tiene tiempo de leer el tablero. Cuando quieres cruzar la conversación con tu NPS o tus encuestas. Cuando la cifra tiene que resistir una pregunta de dirección." },
              { name: "Convienen las dos", text: "Muchos equipos conservan su herramienta para vigilar y reciben de Noisia el reporte mensual o los estudios. Podemos leer las exportaciones de tu herramienta y sumarlas al análisis." }
            ]
          },
          {
            type: "faq",
            title: "Preguntas frecuentes",
            items: [
              { q: "¿Noisia es una herramienta de social listening?", a: "No. Noisia es una empresa de tecnología que produce investigación. Usamos tecnología propia para leer la conversación completa, y lo que recibes es un reporte o un estudio, con una persona que responde por el análisis." },
              { q: "¿Tengo que dejar mi herramienta?", a: "No. Puedes conservarla para monitoreo y atención. Nosotros podemos leer sus exportaciones y sumarlas a otras fuentes." },
              { q: "¿Las herramientas no tienen ya resúmenes con IA?", a: "Varias los tienen, y sirven para un vistazo rápido. Suelen trabajar sobre una muestra de menciones, sin limpieza previa del ruido y sin una persona que apruebe los temas. Para vigilar alcanza; para una decisión importante conviene un análisis completo y verificable." },
              { q: "¿Qué pasa con una crisis?", a: "La herramienta te avisa y te permite responder al momento. Noisia te dice qué la alimenta, qué voces la mueven entre comunidades y qué narrativa conviene, con un análisis en días. Son trabajos distintos y se complementan." }
            ]
          },
          cta.es
        ]
      },
      en: {
        metaTitle: "Social listening tool or social intelligence research",
        metaDescription:
          "A social listening tool monitors mentions, volume and sentiment on a dashboard. Social intelligence research starts from a question and delivers an answer with evidence. When each one makes sense.",
        title: "Social listening tool or social intelligence research?",
        lead:
          "A social listening tool shows you how much people talk about your brand, with what sentiment and when there is a spike; someone on your team has to read it and decide. Social intelligence research starts from a business question, reads the whole conversation, interprets it with a method and hands you an answer with evidence. The first is for watching; the second, for deciding.",
        blocks: [
          {
            type: "table",
            title: "The two options, under the same criteria",
            headers: ["Criterion", "Social listening tool", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["Starting point", "Keywords and brands someone configures", "A business question translated into researchable questions"],
              ["What it delivers", "Dashboard with volume, sentiment, alerts and exports", "A report or a study with findings, evidence and recommendations"],
              ["Topics", "Categories defined in advance or automatic summaries", "Discovered from what people say and approved by a person"],
              ["Noise", "Reaches the dashboard as is; filtered by hand", "Press, brand content, resale and spam out, with documented criteria"],
              ["Who interprets", "Your team, with whatever time it has", "An Intelligence Architect with a method and responsibility for the analysis"],
              ["Your own data", "Outside the dashboard, unless integrated", "NPS, surveys and search read with the same topic structure"],
              ["Evidence", "Loose mentions one click away", "Every number with its calculation and every quote checked against its source"],
              ["Speed for watching", "Immediate, with alerts", "Monthly, or as the scope sets"],
              ["Speed for deciding", "Depends on when someone reads and analyzes", "Days from brief to first answer"],
              ["Cost", "Annual license plus your team's time", "Per report, study or annual plan, defined in the scope"]
            ]
          },
          {
            type: "cards",
            title: "When each one makes sense",
            items: [
              { name: "The tool makes sense", text: "When you need to watch mentions every day, get alerts for a spike or an ongoing crisis, handle comments from one place or measure a campaign's reach while it runs. That is monitoring work, and a good tool does it well." },
              { name: "Noisia makes sense", text: "When you have a decision to make and need to know why something is happening, what weighs and what you can move. When nobody on your team has time to read the dashboard. When you want to cross the conversation with your NPS or your surveys. When the number has to survive a question from leadership." },
              { name: "Both make sense", text: "Many teams keep their tool for watching and receive the monthly report or the studies from Noisia. We can read your tool's exports and add them to the analysis." }
            ]
          },
          {
            type: "faq",
            title: "Frequently asked questions",
            items: [
              { q: "Is Noisia a social listening tool?", a: "No. Noisia is a technology company that produces research. We use our own technology to read the whole conversation, and what you receive is a report or a study, with a person who answers for the analysis." },
              { q: "Do I have to drop my tool?", a: "No. You can keep it for monitoring and community management. We can read its exports and add them to other sources." },
              { q: "Don't tools already have AI summaries?", a: "Several do, and they are useful for a quick look. They usually work on a sample of mentions, without cleaning the noise first and without a person approving the topics. For watching it is enough; for an important decision a complete, verifiable analysis is the better choice." },
              { q: "What about a crisis?", a: "The tool alerts you and lets you respond in the moment. Noisia tells you what feeds it, which voices move it between communities and which narrative makes sense, with an analysis in days. They are different jobs and they complement each other." }
            ]
          },
          cta.en
        ]
      }
    }
  },
  {
    slug: { es: "ia-generativa", en: "generative-ai" },
    summary: {
      es: "Pasarle tus menciones a una IA es rápido y barato para muestras chicas. Dónde se queda corto y cuándo alcanza.",
      en: "Feeding your mentions to an AI is fast and cheap for small samples. Where it falls short and when it is enough."
    },
    page: {
      es: {
        metaTitle: "¿Por qué no basta con pasarle tus menciones a una IA?",
        metaDescription:
          "Una IA generativa resume rápido lo que alcanza a leer, pero muestrea, cuenta mal, puede inventar citas y responde distinto cada vez. Cuándo alcanza y cuándo hace falta investigación completa y verificable.",
        title: "¿Por qué no basta con pasarle tus menciones a una IA?",
        lead:
          "Porque una IA generativa resume lo que alcanza a leer. Con unos cientos de comentarios y una pregunta puntual, un buen analista con una IA hace un trabajo decente. Con decenas de miles de menciones, la IA muestrea o resume por partes, no cuenta de forma confiable, puede parafrasear una cita y entrega un resultado distinto en cada corrida. La investigación de Noisia usa modelos de lenguaje como una pieza del sistema, con la conversación completa, cifras que salen de cálculos, citas verificadas y una persona que aprueba.",
        blocks: [
          {
            type: "table",
            title: "Las dos opciones, con el mismo criterio",
            headers: ["Criterio", "Pasarle tus menciones a una IA", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["Cuánto lee", "Lo que cabe en su ventana; más allá, muestrea o resume por partes", "La conversación completa, descubriendo los temas sobre toda la conversación"],
              ["Cómo cuenta", "Estima; los modelos de lenguaje no cuentan de forma confiable", "Cada cifra sale de una consulta sobre la base completa"],
              ["Las citas", "Puede parafrasear o inventar", "Literales, recortadas por código y verificadas contra la fuente"],
              ["El ruido", "Toma el archivo como viene", "Prensa, contenido de marca, reventa y spam fuera, con criterio documentado"],
              ["Repetir el resultado", "Otra corrida, otro resumen", "Misma base, mismos temas, versiones guardadas"],
              ["El mes siguiente", "Empieza de cero", "Solo procesa lo nuevo y conserva lo aprobado"],
              ["Correcciones", "Se olvidan en la siguiente sesión", "La corrección de la persona se conserva y se aplica después"],
              ["Tus datos propios", "Si alguien lo arma a mano", "NPS, encuestas y búsquedas en el mismo análisis, como parte del método"],
              ["Qué preguntar", "Responde lo que le pidas", "Traduce tu brief en preguntas investigables y prueba tus hipótesis"],
              ["Cuánto confiar", "Todo suena igual de seguro", "Cada hallazgo dice si es medido, direccional o cualitativo"]
            ]
          },
          {
            type: "cards",
            title: "Cuándo conviene cada una",
            items: [
              { name: "Conviene la IA", text: "Cuando tienes unos cientos o pocos miles de comentarios, una pregunta puntual y alguien con criterio que revise el resultado. Para un primer vistazo, para redactar o para ordenar ideas, es rápida y barata. Nosotros también la usamos para interpretar y escribir." },
              { name: "Conviene Noisia", text: "Cuando la conversación es grande, la decisión es importante y la cifra tiene que resistir preguntas. Cuando necesitas comparar un mes contra otro con los mismos temas. Cuando una cita equivocada en una presentación te cuesta credibilidad. Cuando quieres cruzar la conversación con tus propios datos." },
              { name: "Convienen las dos", text: "Un modelo de lenguaje es una de las piezas de nuestro sistema. La diferencia está en lo que lo rodea: conversación completa, limpieza, cálculo fuera del modelo, verificación de citas, memoria de correcciones y una persona que aprueba." }
            ]
          },
          {
            type: "faq",
            title: "Preguntas frecuentes",
            items: [
              { q: "¿Noisia usa inteligencia artificial?", a: "Sí. Modelos de lenguaje y técnicas de agrupamiento leen, agrupan y clasifican la conversación. Las cifras salen de cálculos sobre la base completa, las citas se verifican contra su fuente y un Intelligence Architect aprueba los temas e interpreta." },
              { q: "¿No puedo hacer lo mismo con un prompt bien hecho?", a: "Con una base chica, en buena medida sí. Con una grande, el modelo muestrea o resume por partes, y ningún prompt lo convierte en una calculadora confiable ni le da memoria entre sesiones." },
              { q: "¿Por qué importa que el resultado se pueda repetir?", a: "Porque un reporte mensual compara contra el anterior. Si los temas cambian de nombre y de tamaño en cada corrida, no hay comparación posible ni forma de saber qué se movió de verdad." },
              { q: "¿Qué pasa con las citas?", a: "Un modelo puede resumir o parafrasear una cita y presentarla como literal. En Noisia cada cita se recorta del texto original y se verifica antes de entrar al reporte, con su fuente y su fecha." }
            ]
          },
          cta.es
        ]
      },
      en: {
        metaTitle: "Why isn't feeding your mentions to an AI enough?",
        metaDescription:
          "Generative AI quickly summarizes what it manages to read, but it samples, miscounts, can make up quotes and answers differently every time. When it is enough and when complete, verifiable research is needed.",
        title: "Why isn't feeding your mentions to an AI enough?",
        lead:
          "Because generative AI summarizes what it manages to read. With a few hundred comments and a focused question, a good analyst with an AI does a decent job. With tens of thousands of mentions, the AI samples or summarizes in pieces, doesn't count reliably, can paraphrase a quote and delivers a different result on every run. Noisia's research uses language models as one piece of the system, with the whole conversación, numbers that come from calculations, verified quotes and a person who approves.",
        blocks: [
          {
            type: "table",
            title: "The two options, under the same criteria",
            headers: ["Criterion", "Feeding your mentions to an AI", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["How much it reads", "What fits in its window; beyond that, it samples or summarizes in pieces", "The whole conversation, discovering topics across the entire conversación"],
              ["How it counts", "It estimates; language models don't count reliably", "Every number comes from a query over the conversación"],
              ["Quotes", "Can paraphrase or make them up", "Verbatim, cut by code and checked against the source"],
              ["Noise", "Takes the file as it comes", "Press, brand content, resale and spam out, with documented criteria"],
              ["Repeating the result", "Another run, another summary", "Same conversación, same topics, saved versions"],
              ["Next month", "Starts from scratch", "Processes only what's new and keeps what was approved"],
              ["Corrections", "Forgotten in the next session", "The person's correction is kept and applied later"],
              ["Your own data", "If someone wires it up by hand", "NPS, surveys and search in the same analysis, as part of the method"],
              ["What to ask", "Answers whatever you ask", "Translates your brief into researchable questions and tests your hypotheses"],
              ["How much to trust", "Everything sounds equally certain", "Every finding says whether it is measured, directional or qualitative"]
            ]
          },
          {
            type: "cards",
            title: "When each one makes sense",
            items: [
              { name: "The AI makes sense", text: "When you have a few hundred or a few thousand comments, a focused question and someone with judgment to review the result. For a first look, for drafting or for organizing ideas, it is fast and cheap. We use it for interpreting and writing too." },
              { name: "Noisia makes sense", text: "When the conversación is large, the decision matters and the number has to survive questions. When you need to compare one month against another with the same topics. When a wrong quote in a presentation costs you credibility. When you want to cross the conversation with your own data." },
              { name: "Both make sense", text: "A language model is one of the pieces of our system. The difference is in what surrounds it: whole conversación, cleaning, calculation outside the model, quote verification, memory of corrections and a person who approves." }
            ]
          },
          {
            type: "faq",
            title: "Frequently asked questions",
            items: [
              { q: "Does Noisia use artificial intelligence?", a: "Yes. Language models and clustering techniques read, group and classify the conversation. Numbers come from calculations over the conversación, quotes are checked against their source and an Intelligence Architect approves the topics and interprets." },
              { q: "Can't I do the same with a well-written prompt?", a: "With a small conversación, largely yes. With a large one, the model samples or summarizes in pieces, and no prompt turns it into a reliable calculator or gives it memory between sessions." },
              { q: "Why does it matter that the result can be repeated?", a: "Because a monthly report compares against the previous one. If topics change name and size on every run, there is no possible comparison and no way to know what really moved." },
              { q: "What about the quotes?", a: "A model can summarize or paraphrase a quote and present it as verbatim. At Noisia every quote is cut from the original text and checked before it enters the report, with its source and date." }
            ]
          },
          cta.en
        ]
      }
    }
  },
  {
    slug: { es: "encuestas", en: "surveys" },
    summary: {
      es: "La encuesta mide cuántos; la conversación muestra por qué y con qué palabras. Se complementan, y aquí decimos cómo.",
      en: "A survey measures how many; conversation shows why and in what words. They complement each other, and here is how."
    },
    page: {
      es: {
        metaTitle: "¿Encuesta o conversación? Cómo se complementan",
        metaDescription:
          "La encuesta mide representatividad y opinión declarada. La conversación muestra lenguaje espontáneo y motivos. Cuándo conviene cada una y cómo se leen juntas.",
        title: "¿Encuesta o conversación?",
        lead:
          "Las dos. Una encuesta mide cuántas personas de una población piensan algo, con una muestra diseñada y en las palabras del cuestionario. La conversación muestra qué dice la gente sin que nadie pregunte, con sus propias palabras, sus motivos y sus comparaciones. La encuesta responde cuántos; la conversación responde por qué y cómo lo dicen. Juntas responden mejor que cualquiera por separado.",
        blocks: [
          {
            type: "table",
            title: "Las dos opciones, con el mismo criterio",
            headers: ["Criterio", "Encuesta", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["Qué mide", "Opinión declarada ante una pregunta", "Lo que la gente dice espontáneamente, con sus palabras"],
              ["Representatividad", "Diseñada; permite cifras poblacionales", "Representa a quienes hablan en público; cada hallazgo dice su nivel de evidencia"],
              ["Quién define los temas", "Quien escribe el cuestionario", "La gente; los temas se descubren desde la conversación"],
              ["El porqué", "Limitado a las opciones y preguntas abiertas", "Motivos, frenos y comparaciones en lenguaje literal"],
              ["Lo que nadie pensó preguntar", "No aparece", "Aparece si la gente lo dice"],
              ["Tiempo", "Semanas entre diseño, campo y análisis", "Días del brief a la primera respuesta"],
              ["Periodo", "Una foto en la fecha del campo", "Historia y comparación mes contra mes"],
              ["Deseabilidad social", "Las personas responden lo que creen que deben", "La gente habla sin saberse observada por un cuestionario"],
              ["Cruce entre las dos", "Con su propia taxonomía", "Tu NPS o tu encuesta leídos con la misma estructura de temas que la conversación"]
            ]
          },
          {
            type: "cards",
            title: "Cuándo conviene cada una",
            items: [
              { name: "Conviene la encuesta", text: "Cuando necesitas una cifra poblacional: cuántos conocen tu marca, cuántos la prefieren, cómo cambia por segmento. Cuando quieres validar un concepto con intención de compra. Cuando la categoría no tiene conversación pública suficiente." },
              { name: "Conviene la conversación", text: "Cuando necesitas saber por qué, con qué palabras y qué comparan. Cuando no sabes qué preguntar todavía. Cuando quieres ver cómo cambia un tema a lo largo de meses. Cuando la opinión declarada no coincide con el comportamiento." },
              { name: "Convienen las dos", text: "La conversación antes de la encuesta dice qué preguntar y en qué palabras. La encuesta después pone cifra a lo que la conversación encontró. Y leídas juntas, con la misma estructura de temas, muestran dónde lo que la gente declara coincide con lo que dice en público y dónde no." }
            ]
          },
          {
            type: "faq",
            title: "Preguntas frecuentes",
            items: [
              { q: "¿La conversación es representativa?", a: "Representa a quienes hablan en público, que no son toda la población. Por eso cada hallazgo de Noisia dice si es medido, direccional o cualitativo, y por eso conviene poner cifra poblacional con una encuesta cuando la decisión lo pide." },
              { q: "¿Pueden leer mi encuesta o mi NPS junto con la conversación?", a: "Sí. Llevamos tus datos a la misma estructura de temas que la conversación y comparamos. Es uno de los análisis que más cambian una decisión, porque muestra lo que la gente declara frente a lo que dice sin que le pregunten." },
              { q: "¿Y los focus groups?", a: "Son útiles para ir más a fondo y observar reacciones. Trabajan con pocas personas y con un moderador presente. La conversación pública muestra lo mismo a escala y sin moderador; los dos se complementan." },
              { q: "¿Pueden diseñar la encuesta?", a: "Cada estudio cierra con las preguntas que una encuesta debería validar, en las palabras que usa la gente. El campo lo hace tu proveedor de encuestas o uno que te recomendemos." }
            ]
          },
          cta.es
        ]
      },
      en: {
        metaTitle: "Survey or conversation? How they complement each other",
        metaDescription:
          "A survey measures representativeness and stated opinion. Conversation shows spontaneous language and motives. When each one makes sense and how they are read together.",
        title: "Survey or conversation?",
        lead:
          "Both. A survey measures how many people in a population think something, with a designed sample and in the words of the questionnaire. Conversation shows what people say without anyone asking, in their own words, with their motives and their comparisons. The survey answers how many; the conversation answers why and how they say it. Together they answer better than either alone.",
        blocks: [
          {
            type: "table",
            title: "The two options, under the same criteria",
            headers: ["Criterion", "Survey", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["What it measures", "Stated opinion in response to a question", "What people say spontaneously, in their words"],
              ["Representativeness", "Designed; allows population figures", "Represents those who speak in public; every finding states its level of evidence"],
              ["Who defines the topics", "Whoever writes the questionnaire", "People; topics are discovered from the conversation"],
              ["The why", "Limited to the options and open questions", "Motives, obstacles and comparisons in verbatim language"],
              ["What nobody thought to ask", "Doesn't appear", "Appears if people say it"],
              ["Time", "Weeks between design, fieldwork and analysis", "Days from brief to first answer"],
              ["Period", "A snapshot on the fieldwork date", "History and month-against-month comparison"],
              ["Social desirability", "People answer what they think they should", "People talk without feeling observed by a questionnaire"],
              ["Crossing the two", "With its own taxonomy", "Your NPS or survey read with the same topic structure as the conversation"]
            ]
          },
          {
            type: "cards",
            title: "When each one makes sense",
            items: [
              { name: "The survey makes sense", text: "When you need a population figure: how many know your brand, how many prefer it, how it changes by segment. When you want to validate a concept with purchase intent. When the category doesn't have enough public conversation." },
              { name: "Conversation makes sense", text: "When you need to know why, in what words and what people compare. When you don't know what to ask yet. When you want to see how a topic changes over months. When stated opinion doesn't match behavior." },
              { name: "Both make sense", text: "Conversation before the survey says what to ask and in which words. The survey afterwards puts a figure on what the conversation found. And read together, with the same topic structure, they show where what people declare matches what they say in public and where it doesn't." }
            ]
          },
          {
            type: "faq",
            title: "Frequently asked questions",
            items: [
              { q: "Is conversation representative?", a: "It represents those who speak in public, who are not the whole population. That is why every Noisia finding says whether it is measured, directional or qualitative, and why it makes sense to put a population figure on it with a survey when the decision calls for it." },
              { q: "Can you read my survey or my NPS together with the conversation?", a: "Yes. We bring your data into the same topic structure as the conversation and compare. It is one of the analyses that most change a decision, because it shows what people declare against what they say when nobody asks." },
              { q: "What about focus groups?", a: "They are useful for going deeper and observing reactions. They work with a few people and a moderator present. Public conversation shows the same at scale and without a moderator; the two complement each other." },
              { q: "Can you design the survey?", a: "Every study closes with the questions a survey should validate, in the words people use. The fieldwork is done by your survey provider or one we recommend." }
            ]
          },
          cta.en
        ]
      }
    }
  },
  {
    slug: { es: "agencias", en: "agencies" },
    summary: {
      es: "Una agencia o un instituto aportan criterio humano, en semanas y sobre una parte de la conversación. Cuándo conviene cada opción.",
      en: "An agency or a research firm brings human judgment, over weeks and on part of the conversation. When each option makes sense."
    },
    page: {
      es: {
        metaTitle: "¿Agencia, instituto de investigación o Noisia?",
        metaDescription:
          "Una agencia o un instituto aportan criterio humano, pero tardan semanas y leen una muestra. Noisia junta criterio humano con tecnología que lee la conversación completa, en días. Cuándo conviene cada opción.",
        title: "¿Agencia, instituto de investigación o Noisia?",
        lead:
          "Una agencia o un instituto de investigación aportan algo que ninguna herramienta da: criterio humano, conocimiento del cliente y una recomendación con responsable. A cambio, un estudio tradicional tarda semanas y lee a mano una parte de la conversación. Noisia conserva el criterio humano, con un Intelligence Architect que firma cada análisis, y le suma tecnología que lee la conversación completa y entrega en días.",
        blocks: [
          {
            type: "table",
            title: "Las dos opciones, con el mismo criterio",
            headers: ["Criterio", "Agencia o instituto", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["Criterio humano", "Sí, con analistas o planners experimentados", "Sí, con un Intelligence Architect que define, aprueba y firma"],
              ["Cuánto lee", "Una muestra, leída a mano o con una herramienta", "La conversación completa, con temas descubiertos sobre toda la conversación"],
              ["Tiempo", "Semanas, con frecuencia más de un mes", "Días del brief a la primera versión"],
              ["Método", "Depende del equipo y del proyecto", "Una biblioteca de métodos con base en ciencias sociales y límites escritos"],
              ["Evidencia", "Citas seleccionadas a mano", "Cada cifra con su cálculo y cada cita verificada contra la fuente"],
              ["Repetir el mes siguiente", "Un proyecto nuevo, con arranque desde cero", "La base de temas se conserva y solo se procesa lo nuevo"],
              ["Tus datos propios", "Según el proyecto", "NPS, encuestas y búsquedas en el mismo análisis"],
              ["Idiomas y mercados", "Los del equipo", "16 idiomas, más de 20 países"],
              ["Ejecución creativa y de medios", "Parte de su oferta", "Fuera de nuestro trabajo; entregamos el brief con evidencia"]
            ]
          },
          {
            type: "cards",
            title: "Cuándo conviene cada una",
            items: [
              { name: "Conviene la agencia o el instituto", text: "Cuando necesitas ejecución junto con la investigación: estrategia, creatividad, medios o relaciones públicas. Cuando la pregunta pide entrevistas, etnografía en campo o una encuesta con representatividad poblacional. Cuando hay una relación de años que conoce a tu marca por dentro." },
              { name: "Conviene Noisia", text: "Cuando la decisión no puede esperar semanas. Cuando necesitas leer la conversación completa en lugar de una muestra. Cuando quieres que cada cifra se pueda abrir hasta la mención. Cuando el análisis tiene que repetirse cada mes con los mismos temas. Cuando el mercado habla en un idioma que tu equipo no lee." },
              { name: "Convienen las dos", text: "Muchas agencias trabajan con Noisia: nosotros producimos la investigación y la agencia la lleva a estrategia y ejecución. El estudio se presenta junto con ella o se entrega como insumo de su planning." }
            ]
          },
          {
            type: "faq",
            title: "Preguntas frecuentes",
            items: [
              { q: "¿Noisia es una agencia?", a: "No. Noisia es una empresa de tecnología que produce investigación. No hacemos creatividad, medios ni relaciones públicas; entregamos la respuesta y el brief con evidencia para quien sí los hace." },
              { q: "¿Trabajan para agencias?", a: "Sí. Es una de las formas más comunes de trabajar con nosotros. La agencia conserva la relación con su cliente y nosotros producimos la investigación." },
              { q: "¿Qué pierdo al no tener un equipo leyendo a mano?", a: "Nada en criterio: un Intelligence Architect aprueba los temas, corrige al sistema e interpreta. Lo que cambia es que el análisis cubre la conversación completa y llega en días, con cada cifra calculada y cada cita verificada." },
              { q: "¿Pueden hacer entrevistas o etnografía?", a: "Nuestro trabajo es la conversación pública y los datos del cliente. Cuando la pregunta pide campo, lo decimos y recomendamos con quién hacerlo; el estudio sirve de guía para ese trabajo." }
            ]
          },
          cta.es
        ]
      },
      en: {
        metaTitle: "Agency, research firm or Noisia?",
        metaDescription:
          "An agency or a research firm brings human judgment, but takes weeks and reads a sample. Noisia combines human judgment with technology that reads the whole conversation, in days. When each option makes sense.",
        title: "Agency, research firm or Noisia?",
        lead:
          "An agency or a research firm brings something no tool does: human judgment, knowledge of the client and a recommendation with an owner. In exchange, a traditional study takes weeks and reads part of the conversation by hand. Noisia keeps the human judgment, with an Intelligence Architect who signs off every analysis, and adds technology that reads the whole conversation and delivers in days.",
        blocks: [
          {
            type: "table",
            title: "The two options, under the same criteria",
            headers: ["Criterion", "Agency or research firm", "Noisia"],
            highlightColumn: 2,
            rows: [
              ["Human judgment", "Yes, with experienced analysts or planners", "Yes, with an Intelligence Architect who defines, approves and signs off"],
              ["How much it reads", "A sample, read by hand or with a tool", "The whole conversation, with topics discovered across the entire conversación"],
              ["Time", "Weeks, often more than a month", "Days from brief to first version"],
              ["Method", "Depends on the team and the project", "A library of methods grounded in social sciences, with written limits"],
              ["Evidence", "Hand-picked quotes", "Every number with its calculation and every quote checked against the source"],
              ["Repeating next month", "A new project, starting from scratch", "The topic base is kept and only what's new is processed"],
              ["Your own data", "Depends on the project", "NPS, surveys and search in the same analysis"],
              ["Languages and markets", "The team's", "16 languages, more than 20 countries"],
              ["Creative and media execution", "Part of their offer", "Outside our work; we deliver the brief with evidence"]
            ]
          },
          {
            type: "cards",
            title: "When each one makes sense",
            items: [
              { name: "The agency or research firm makes sense", text: "When you need execution on top of research: strategy, creative, media or public relations. When the question calls for interviews, field ethnography or a survey with population representativeness. When there is a years-long relationship that knows your brand from the inside." },
              { name: "Noisia makes sense", text: "When the decision can't wait weeks. When you need to read the whole conversation rather than a sample. When you want every number to open down to the mention. When the analysis has to repeat every month with the same topics. When the market speaks a language your team doesn't read." },
              { name: "Both make sense", text: "Many agencies work with Noisia: we produce the research and the agency takes it to strategy and execution. The study is presented alongside the agency or delivered as input for its planning." }
            ]
          },
          {
            type: "faq",
            title: "Frequently asked questions",
            items: [
              { q: "Is Noisia an agency?", a: "No. Noisia is a technology company that produces research. We don't do creative, media or public relations; we deliver the answer and the brief with evidence for those who do." },
              { q: "Do you work for agencies?", a: "Yes. It is one of the most common ways of working with us. The agency keeps the relationship with its client and we produce the research." },
              { q: "What do I lose by not having a team reading by hand?", a: "Nothing in judgment: an Intelligence Architect approves the topics, corrects the system and interprets. What changes is that the analysis covers the whole conversation and arrives in days, with every number calculated and every quote checked." },
              { q: "Can you do interviews or ethnography?", a: "Our work is public conversation and client data. When the question calls for fieldwork, we say so and recommend whom to do it with; the study serves as a guide for that work." }
            ]
          },
          cta.en
        ]
      }
    }
  }
];
