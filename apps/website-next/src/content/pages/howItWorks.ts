import type { Localized, PageContent } from "./types";

export const howItWorks: Localized<PageContent> = {
  es: {
    metaTitle: "Cómo funciona la inteligencia social de Noisia",
    metaDescription:
      "Así convertimos tu pregunta en una respuesta con evidencia. El sistema lee redes, búsquedas, reseñas y tus propios datos; un Intelligence Architect aprueba los temas, corrige al sistema y firma el resultado.",
    title: "Tecnología que lee todo. Personas que deciden qué importa.",
    lead:
      "El sistema hace en horas lo que un equipo tardaría semanas en leer. Un Intelligence Architect dirige cada paso y firma el resultado. Este es el recorrido de tu pregunta a una decisión.",
    blocks: [
      {
        type: "steps",
        title: "De tu pregunta a una decisión, en siete pasos",
        items: [
          {
            name: "Tu pregunta",
            text: "Empezamos por lo que necesitas decidir. Un Intelligence Architect la convierte en preguntas que la conversación sí puede responder y en hipótesis que vamos a probar o a descartar."
          },
          {
            name: "Toda la voz",
            text: "Reunimos conversación social, búsquedas, reseñas y los datos que ya tienes, como tu NPS o tus encuestas, en un solo análisis. Cada fuente aporta un tipo de señal distinto y se leen juntas."
          },
          {
            name: "Limpieza de la voz",
            text: "El sistema separa lo que dice la gente de lo que no: prensa, contenido de marca, reventa, spam y comentarios que cuelgan de una publicación sin hablar del tema. Lo que se queda fuera se documenta."
          },
          {
            name: "Temas que salen de lo que se dice",
            text: "Los temas se descubren sobre la conversación completa, a partir de cómo habla la gente y sin una lista de palabras elegida de antemano. Un Intelligence Architect revisa cada tema, lo renombra, lo une o lo descarta antes de que cuente."
          },
          {
            name: "Evidencia que se puede abrir",
            text: "Cada cifra sale de un cálculo sobre la base completa y cada cita es literal, con su fuente y su fecha. Cualquier hallazgo se puede abrir hasta la mención que lo sostiene."
          },
          {
            name: "Análisis y decisión",
            text: "Con un método de la biblioteca, el Intelligence Architect interpreta lo que pesa, lo que es ruido y lo que tu marca puede mover. Cada hallazgo dice si es medido, direccional o cualitativo, y cada recomendación trae su evidencia."
          },
          {
            name: "Se actualiza con lo nuevo",
            text: "Cuando llega conversación nueva, el sistema la clasifica con los temas ya aprobados y conserva las correcciones que hizo la persona. El siguiente reporte se compara contra el anterior sin empezar de cero."
          }
        ]
      },
      {
        type: "cards",
        title: "Lo que hace la tecnología y lo que hace la persona",
        lead: "El software produce con una persona experta dentro del proceso. Así se reparte el trabajo.",
        items: [
          { name: "La tecnología lee la conversación completa", text: "La conversación completa, en 16 idiomas, sin muestrear ni resumir por partes." },
          { name: "La tecnología separa voz de ruido", text: "Aplica criterios documentados mención por mención y guarda el registro de lo que excluyó." },
          { name: "La tecnología propone temas y calcula", text: "Agrupa la conversación, verifica cada cita contra su texto original y produce las cifras con consultas, sin que un modelo las estime." },
          { name: "La tecnología recuerda", text: "Conserva las decisiones humanas y las aplica a la conversación que llega después." },
          { name: "El Intelligence Architect define la pregunta", text: "Traduce tu brief en preguntas investigables y decide fuentes, mercados y periodo." },
          { name: "El Intelligence Architect aprueba los temas", text: "Revisa lo que el sistema propone, lo corrige y decide qué entra al reporte." },
          { name: "El Intelligence Architect corrige la clasificación", text: "Cuando una mención quedó mal asignada, la mueve. El sistema conserva esa corrección y la aplica a lo que llegue después." },
          { name: "El Intelligence Architect interpreta y firma", text: "Lee con un método, escribe las recomendaciones y responde por ellas frente a ti." }
        ]
      },
      {
        type: "motion",
        name: "sources-hub",
        title: "Toda la voz, en un solo análisis",
        lead: "Redes, reseñas, foros y búsquedas llegan al mismo análisis. Tus propios datos, como NPS o CRM, se leen con la misma estructura de temas.",
        copy: {
          center: "Un solo análisis",
          sources: ["TikTok", "Instagram", "YouTube", "X", "Facebook", "Reseñas", "Foros", "Búsquedas", "NPS y encuestas", "CRM"],
          owned: "Tus propios datos"
        }
      },
      {
        type: "text",
        title: "De dónde sale la conversación",
        paragraphs: [
          "Leemos lo que la gente publica en abierto: redes sociales, foros y comunidades, comentarios en video, reseñas de productos y servicios, preguntas y respuestas en marketplaces, y el volumen de búsquedas de una categoría. Cuando tienes datos propios, como encuestas, NPS o tickets de servicio, los incorporamos al mismo análisis con tu autorización.",
          "Las fuentes se eligen contra la pregunta. Una duda de compra vive en reseñas y foros; un código cultural vive en comunidades y conversación larga; un cambio de reputación vive en redes abiertas. No todas las fuentes sirven para todas las preguntas, y el alcance lo dice."
        ]
      },
      {
        type: "motion",
        name: "one-conversation",
        title: "La misma conversación, vista como piensa cada equipo",
        lead: "Cada mención se guarda una vez. Después se puede cortar por los temas de tu marca, contra tus competidores o con tu propio marco, sin volver a empezar. El ejemplo es ilustrativo.",
        copy: {
          views: [
            { tab: "Se guarda una vez", caption: "Cada mención se guarda una sola vez, con su fuente." },
            { tab: "Vista de marca", caption: "De qué habla la gente cuando habla de tu marca." },
            { tab: "Vista competitiva", caption: "Las mismas menciones, separadas por marca y comparadas." },
            { tab: "Tu propio marco", caption: "Tu forma de ver la categoría, aplicada a la misma conversación." }
          ],
          topics: ["Producto", "Servicio", "Precio", "Campañas", "Reputación"],
          brands: ["Tu marca", "Competidor A", "Competidor B"],
          framework: "Tu marco",
          nodes: ["Ocasiones", "Necesidades", "Barreras"]
        }
      },
      {
        type: "cards",
        title: "Cómo cuidamos los datos",
        items: [
          { name: "Solo conversación pública", text: "Trabajamos con lo que las personas publican en abierto. Si una plataforma cierra el acceso, buscamos el mismo tipo de señal en otro lugar." },
          { name: "Dentro de los términos de cada fuente", text: "Operamos sobre fuentes accesibles bajo sus términos de servicio. No forzamos accesos ni entramos a espacios privados." },
          { name: "Sin datos personales en el análisis", text: "El análisis se hace sobre el contenido de la conversación. Los reportes no identifican personas ni construyen perfiles individuales." },
          { name: "Datos sensibles con revisión previa", text: "Si un proyecto requiere otro tipo de dato, se revisa legalmente antes de avanzar. Los datos que nos compartes se usan solo para tu proyecto." }
        ]
      },
      {
        type: "faq",
        title: "Preguntas frecuentes",
        items: [
          {
            q: "¿Qué fuentes leen?",
            a: "Conversación social abierta, foros y comunidades, reseñas, preguntas y respuestas en marketplaces, comentarios en video y volumen de búsquedas. También tus propios datos cuando los compartes, como NPS, encuestas o tickets de servicio. Las fuentes de cada proyecto se definen en el alcance."
          },
          {
            q: "¿Cómo evitan bots, spam y contenido de marca?",
            a: "Con una limpieza por mención que separa la voz de la gente de prensa, publicidad, reventa, spam y comentarios fuera de tema. Los criterios están escritos, lo excluido queda registrado y un Intelligence Architect revisa el resultado antes de analizar."
          },
          {
            q: "¿La conversación es representativa?",
            a: "Representa a quienes hablan en público, que no son toda la población. Por eso cada hallazgo dice si es medido, direccional o cualitativo, y por eso la conversación se complementa bien con una encuesta: una mide cuántos y la otra muestra con qué palabras y por qué."
          },
          {
            q: "¿Cuánto tarda?",
            a: "Una pregunta de negocio acotada se responde en días. Un estudio completo va del brief a la primera versión en pocos días, y un reporte continuo llega cada mes. El alcance fija la fecha antes de empezar."
          },
          {
            q: "¿Necesito tener mi propia herramienta de listening?",
            a: "No. Nosotros ponemos la tecnología y el acceso a las fuentes. Si ya tienes una herramienta, podemos leer sus exportaciones y sumarlas al análisis."
          },
          {
            q: "¿Qué recibo al final?",
            a: "Un reporte o un estudio presentado en vivo, con hallazgos, evidencia abierta hasta la cita, recomendaciones con responsable y las preguntas que convendría validar después. Los entregables concretos dependen del momento que estés resolviendo."
          },
          {
            q: "¿Pueden usar mi NPS o mis encuestas?",
            a: "Sí. Llevamos tus datos a la misma estructura de temas que la conversación para ver dónde coinciden y dónde no. Es uno de los análisis que más cambian una decisión."
          },
          {
            q: "¿En qué idiomas trabajan?",
            a: "Leemos conversación en 16 idiomas, del español y el portugués al pidgin nigeriano y el isiZulu, en más de 20 países de América, Europa y África. Los reportes se entregan en español o inglés."
          }
        ]
      },
      {
        type: "cta",
        title: "Trae tu pregunta",
        text: "En un taller gratis de 30 a 60 minutos vemos qué puede responder la conversación y cómo empezar.",
        label: "Agenda un taller gratis",
        href: "/taller"
      }
    ]
  },
  en: {
    metaTitle: "How Noisia's social intelligence works",
    metaDescription:
      "How we turn your question into an answer with evidence. The system reads social media, search, reviews and your own data; an Intelligence Architect approves the topics, corrects the system and signs off the analysis.",
    title: "Technology that reads everything. People who decide what matters.",
    lead:
      "The system does in hours what would take a team weeks to read. An Intelligence Architect leads every step and signs off the result. This is the path from your question to a decision.",
    blocks: [
      {
        type: "steps",
        title: "From your question to a decision, in seven steps",
        items: [
          {
            name: "Your question",
            text: "We start with what you need to decide. An Intelligence Architect turns it into questions the conversation can actually answer and into hypotheses we will test or discard."
          },
          {
            name: "Every voice",
            text: "We bring together social conversation, search, reviews and the data you already have, such as your NPS or surveys, in a single analysis. Each source carries a different kind of signal, and they are read together."
          },
          {
            name: "Cleaning the voice",
            text: "The system separates what people say from what they don't: press, brand content, resale, spam and comments hanging off a post without talking about the topic. What is left out is documented."
          },
          {
            name: "Topics that come from what people say",
            text: "Topics are discovered across the whole conversation, from the way people talk, without a keyword list chosen in advance. An Intelligence Architect reviews each topic, renames it, merges it or drops it before it counts."
          },
          {
            name: "Evidence you can open",
            text: "Every number comes from a calculation over the conversación and every quote is verbatim, with its source and date. Any finding can be opened down to the mention that supports it."
          },
          {
            name: "Analysis and decision",
            text: "Using a method from the library, the Intelligence Architect interprets what carries weight, what is noise and what your brand can move. Every finding says whether it is measured, directional or qualitative, and every recommendation comes with its evidence."
          },
          {
            name: "It updates with what's new",
            text: "When new conversation arrives, the system classifies it with the approved topics and keeps the corrections the person made. The next report compares against the previous one without starting over."
          }
        ]
      },
      {
        type: "cards",
        title: "What the technology does and what the person does",
        lead: "The software produces with an expert person inside the process. This is how the work is split.",
        items: [
          { name: "The technology reads the whole conversación", text: "The whole conversation, in 16 languages, without sampling or summarizing in pieces." },
          { name: "The technology separates voice from noise", text: "It applies documented criteria mention by mention and keeps a record of what it excluded." },
          { name: "The technology proposes topics and computes", text: "It groups the conversation, checks every quote against its original text and produces the numbers through queries, never through a model's estimate." },
          { name: "The technology remembers", text: "It keeps human decisions and applies them to the conversation that arrives later." },
          { name: "The Intelligence Architect defines the question", text: "Translates your brief into researchable questions and decides sources, markets and period." },
          { name: "The Intelligence Architect approves the topics", text: "Reviews what the system proposes, corrects it and decides what goes into the report." },
          { name: "The Intelligence Architect corrects the classification", text: "When a mention was assigned to the wrong place, they move it. The system keeps that correction and applies it to what comes next." },
          { name: "The Intelligence Architect interprets and signs off", text: "Reads with a method, writes the recommendations and answers for them in front of you." }
        ]
      },
      {
        type: "motion",
        name: "sources-hub",
        title: "Every voice, in a single analysis",
        lead: "Social media, reviews, forums and search flow into the same analysis. Your own data, like NPS or CRM, is read with the same topic structure.",
        copy: {
          center: "One single analysis",
          sources: ["TikTok", "Instagram", "YouTube", "X", "Facebook", "Reviews", "Forums", "Search", "NPS and surveys", "CRM"],
          owned: "Your own data"
        }
      },
      {
        type: "text",
        title: "Where the conversation comes from",
        paragraphs: [
          "We read what people publish in the open: social media, forums and communities, video comments, product and service reviews, questions and answers on marketplaces, and search volume for a category. When you have your own data, such as surveys, NPS or service tickets, we bring it into the same analysis with your authorization.",
          "Sources are chosen against the question. A purchase doubt lives in reviews and forums; a cultural code lives in communities and long-form conversation; a shift in reputation lives in open social media. Not every source works for every question, and the scope says so."
        ]
      },
      {
        type: "motion",
        name: "one-conversation",
        title: "The same conversation, seen the way each team thinks",
        lead: "Every mention is stored once. Then it can be cut by your brand's topics, against your competitors or with your own framework, without starting over. The example is illustrative.",
        copy: {
          views: [
            { tab: "Stored once", caption: "Every mention is stored once, with its source." },
            { tab: "Brand view", caption: "What people talk about when they talk about your brand." },
            { tab: "Competitive view", caption: "The same mentions, split by brand and compared." },
            { tab: "Your own framework", caption: "Your way of seeing the category, applied to the same conversation." }
          ],
          topics: ["Product", "Service", "Price", "Campaigns", "Reputation"],
          brands: ["Your brand", "Competitor A", "Competitor B"],
          framework: "Your framework",
          nodes: ["Occasions", "Needs", "Barriers"]
        }
      },
      {
        type: "cards",
        title: "How we handle data",
        items: [
          { name: "Public conversation only", text: "We work with what people publish in the open. If a platform closes access, we look for the same kind of signal elsewhere." },
          { name: "Within each source's terms", text: "We operate on sources accessible under their terms of service. We don't force access or enter private spaces." },
          { name: "No personal data in the analysis", text: "The analysis is done on the content of the conversation. Reports don't identify people or build individual profiles." },
          { name: "Sensitive data reviewed first", text: "If a project requires another kind of data, it is reviewed legally before moving forward. The data you share with us is used only for your project." }
        ]
      },
      {
        type: "faq",
        title: "Frequently asked questions",
        items: [
          {
            q: "Which sources do you read?",
            a: "Open social conversation, forums and communities, reviews, questions and answers on marketplaces, video comments and search volume. Also your own data when you share it, such as NPS, surveys or service tickets. The sources for each project are defined in the scope."
          },
          {
            q: "How do you avoid bots, spam and brand content?",
            a: "With a per-mention cleaning step that separates people's voice from press, advertising, resale, spam and off-topic comments. The criteria are written down, what is excluded is recorded, and an Intelligence Architect reviews the result before analysis."
          },
          {
            q: "Is the conversation representative?",
            a: "It represents the people who speak in public, who are not the whole population. That is why every finding says whether it is measured, directional or qualitative, and why conversation pairs well with a survey: one measures how many, the other shows in what words and why."
          },
          {
            q: "How long does it take?",
            a: "A focused business question is answered in days. A full study goes from brief to first version in a few days, and a continuous report arrives every month. The scope sets the date before we start."
          },
          {
            q: "Do I need my own listening tool?",
            a: "No. We bring the technology and access to the sources. If you already have a tool, we can read its exports and add them to the analysis."
          },
          {
            q: "What do I receive at the end?",
            a: "A report or a study presented live, with findings, evidence open down to the quote, recommendations with an owner, and the questions worth validating afterwards. The specific deliverables depend on the moment you are solving."
          },
          {
            q: "Can you use my NPS or my surveys?",
            a: "Yes. We bring your data into the same topic structure as the conversation to see where they agree and where they don't. It is one of the analyses that most change a decision."
          },
          {
            q: "Which languages do you work in?",
            a: "We read conversation in 16 languages, from Spanish and Portuguese to Nigerian Pidgin and isiZulu, across more than 20 countries in the Americas, Europe and Africa. Reports are delivered in English or Spanish."
          }
        ]
      },
      {
        type: "cta",
        title: "Bring your question",
        text: "In a free 30 to 60 minute workshop we look at what the conversation can answer and how to start.",
        label: "Book a free workshop",
        href: "/en/workshop"
      }
    ]
  }
};
