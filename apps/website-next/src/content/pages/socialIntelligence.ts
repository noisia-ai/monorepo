import type { Localized, PageContent } from "./types";

export const socialIntelligence: Localized<PageContent> = {
  es: {
    metaTitle: "¿Qué es la inteligencia social? Definición, diferencias y usos",
    metaDescription:
      "La inteligencia social es la investigación que convierte la conversación pública en respuestas para una decisión de negocio. Qué la distingue del social listening y de las encuestas, qué puede decirte y qué no.",
    title: "¿Qué es la inteligencia social?",
    lead:
      "La inteligencia social es la práctica de investigar lo que la gente dice en público, en redes, búsquedas, reseñas y comunidades, para responder una pregunta de negocio con evidencia. Lee la conversación completa, la ordena en temas, la interpreta con un método y entrega una decisión, con cada hallazgo ligado a lo que alguien escribió.",
    blocks: [
      {
        type: "text",
        title: "¿En qué se diferencia del social listening?",
        paragraphs: [
          "El social listening es el monitoreo: una herramienta recoge menciones de una marca o de palabras elegidas de antemano y las muestra en un dashboard con volumen, sentimiento y alertas. Responde cuánto se habló y si subió o bajó.",
          "La inteligencia social empieza donde el dashboard termina. Parte de una pregunta de negocio, descubre los temas desde lo que la gente dice en lugar de una lista de palabras, limpia el ruido, interpreta con un método y entrega una respuesta con recomendaciones. El listening es una de sus fuentes; el análisis y la decisión son el producto."
        ]
      },
      {
        type: "text",
        title: "¿En qué se diferencia de la investigación de mercado tradicional?",
        paragraphs: [
          "Las encuestas y los focus groups preguntan. Obtienen opinión declarada de una muestra diseñada, con representatividad estadística y en el lenguaje del cuestionario. Son la mejor forma de medir cuántos piensan algo.",
          "La inteligencia social escucha sin preguntar. Trabaja con lenguaje espontáneo, en el momento y las palabras de la persona, y encuentra motivos y temas que nadie pensó incluir en un cuestionario. Antecede a la encuesta, porque dice qué preguntar, y la complementa, porque explica el porqué detrás de un número."
        ]
      },
      {
        type: "cards",
        title: "¿Qué puede decirte?",
        items: [
          { name: "Qué temas existen y cuáles pesan", text: "Descubre de qué habla la gente alrededor de una categoría y cuánto espacio ocupa cada tema, con cifras calculadas sobre la conversación completa." },
          { name: "Por qué, en sus palabras", text: "Muestra motivos, frenos, comparaciones y lenguaje literal. Es la mejor fuente para entender el porqué detrás de un dato." },
          { name: "Qué cambió y cuándo", text: "Compara periodos y detecta qué tema apareció, creció o se apagó, y qué lo movió." },
          { name: "Cómo se ve tu marca frente a otras", text: "Lee a tu marca y a tus competidores con el mismo criterio y el mismo periodo." }
        ]
      },
      {
        type: "cards",
        title: "¿Qué no puede decirte?",
        items: [
          { name: "Cuántas personas de la población piensan algo", text: "Representa a quienes hablan en público. Para una cifra poblacional hace falta una encuesta." },
          { name: "Lo que la gente no dice", text: "Si un motivo no se articula en palabras, no aparece. Para eso sirven la observación y las pruebas de usabilidad." },
          { name: "Predicciones de ventas", text: "Da hipótesis fuertes y direcciones. El tamaño de mercado y el efecto en ventas se validan con otros métodos." }
        ]
      },
      {
        type: "cards",
        title: "¿De dónde sale la conversación?",
        items: [
          { name: "Redes sociales abiertas", text: "Publicaciones y comentarios públicos, donde la reacción es inmediata y el lenguaje es espontáneo." },
          { name: "Foros y comunidades", text: "Hilos largos donde la gente explica, pregunta y discute. Ahí viven los motivos y los códigos de una categoría." },
          { name: "Reseñas y preguntas en marketplaces", text: "Decisiones de compra ya tomadas o a punto de tomarse, con sus dudas y sus quejas." },
          { name: "Comentarios en video", text: "Reacciones a contenido, a creadores y a publicidad, con mucha carga emocional." },
          { name: "Búsquedas", text: "Lo que la gente pregunta en privado a un buscador, que a veces difiere de lo que dice en público." },
          { name: "Tus propios datos", text: "NPS, encuestas, tickets de servicio. Con tu autorización, se leen con la misma estructura de temas que la conversación." }
        ]
      },
      {
        type: "cards",
        title: "¿Qué preguntas responde?",
        items: [
          { name: "¿Qué está pasando con mi marca y qué cambió este mes?", text: "Un reporte continuo que compara periodos y explica cada movimiento." },
          { name: "¿Sobre qué territorio construyo una campaña?", text: "Prueba los territorios contra la conversación real para saber cuál tiene permiso." },
          { name: "¿Cómo funciona un mercado que no conozco?", text: "Las reglas no escritas de la categoría, quién da credibilidad y qué evitar." },
          { name: "¿Por qué se va mi cliente con la competencia?", text: "Los motivos reales de cambio y qué promesa del otro se siente más creíble." },
          { name: "¿Dónde se rompe el camino a la compra?", text: "El recorrido como lo vive la gente y la fricción que conviene quitar primero." },
          { name: "¿Qué necesidad sigue sin resolverse?", text: "Lo que la gente intenta resolver mal con lo que existe." }
        ]
      },
      {
        type: "cards",
        title: "Glosario breve",
        items: [
          { name: "Inteligencia social", text: "Investigación que convierte la conversación pública en respuestas para una decisión, con método y evidencia abierta." },
          { name: "Social listening", text: "Monitoreo de menciones de una marca o de palabras elegidas, presentado en dashboards con volumen, sentimiento y alertas." },
          { name: "Voz del consumidor", text: "Lo que la gente dice sobre una categoría, una marca o una experiencia, ya sea en público o en respuesta a una encuesta." },
          { name: "Dataset", text: "El conjunto completo de publicaciones que se lee para un proyecto, después de limpiar el ruido." },
          { name: "Tema", text: "Un grupo de menciones que hablan de lo mismo, descubierto a partir del lenguaje de la gente y aprobado por una persona." },
          { name: "Triggers y barriers", text: "Lo que motiva y lo que frena una decisión. Es el método más usado de nuestra biblioteca." },
          { name: "Share of voice", text: "La parte de la conversación de una categoría que ocupa cada marca en un periodo." },
          { name: "Intelligence Architect", text: "La persona que define la pregunta, aprueba los temas, corrige al sistema, interpreta con un método y firma el resultado." }
        ]
      },
      {
        type: "faq",
        title: "Preguntas frecuentes",
        items: [
          {
            q: "¿La inteligencia social es lo mismo que el social listening?",
            a: "No. El social listening monitorea menciones y las muestra en un dashboard. La inteligencia social parte de una pregunta de negocio, lee la conversación completa, la interpreta con un método y entrega una respuesta con recomendaciones. El listening puede ser una de sus fuentes."
          },
          {
            q: "¿Reemplaza a las encuestas?",
            a: "No. Las encuestas miden cuántos piensan algo en una población definida. La conversación muestra qué dicen, cómo lo dicen y por qué, sin que nadie pregunte. Las dos juntas responden mejor que cualquiera por separado."
          },
          {
            q: "¿Qué tan confiable es?",
            a: "Depende de que cada cifra se calcule sobre la conversación completa y de que cada cita se pueda abrir. En Noisia cada hallazgo dice si es medido, direccional o cualitativo, y los límites se escriben en el reporte."
          },
          {
            q: "¿Qué papel juega la inteligencia artificial?",
            a: "Lee, agrupa y clasifica la conversación a una escala que ninguna persona alcanza. Una persona con formación aprueba los temas, corrige la clasificación e interpreta. Las cifras se calculan sobre la conversación completa, con consultas que se pueden repetir."
          },
          {
            q: "¿Para qué equipos sirve?",
            a: "Marca, insights, producto, estrategia, comunicación y las agencias que los acompañan. Cualquier equipo que tenga que decidir algo sobre lo que la gente ya está hablando."
          },
          {
            q: "¿Cómo se contrata?",
            a: "Como un reporte continuo, como un estudio que responde una pregunta concreta o como un plan anual de estudios. La entrada es un taller gratis donde definimos la pregunta."
          }
        ]
      },
      {
        type: "links",
        title: "Sigue leyendo",
        items: [
          { label: "Cómo funciona", text: "El recorrido de tu pregunta a una decisión.", href: "/como-funciona" },
          { label: "Métodos", text: "La biblioteca con base antropológica y sociológica.", href: "/metodos" },
          { label: "Herramienta de social listening o inteligencia social", text: "Cuándo conviene cada una.", href: "/comparar/herramientas-de-social-listening" },
          { label: "Encuestas o conversación", text: "Cómo se complementan.", href: "/comparar/encuestas" }
        ]
      },
      {
        type: "cta",
        title: "Trae tu pregunta",
        text: "En un taller gratis vemos si la conversación puede responderla y cómo.",
        label: "Agenda un taller gratis",
        href: "/taller"
      }
    ]
  },
  en: {
    metaTitle: "What is social intelligence? Definition, differences and uses",
    metaDescription:
      "Social intelligence is the research that turns public conversation into answers for a business decision. How it differs from social listening and surveys, what it can tell you and what it can't.",
    title: "What is social intelligence?",
    lead:
      "Social intelligence is the practice of researching what people say in public, across social media, search, reviews and communities, to answer a business question with evidence. It reads the whole conversation, organizes it into topics, interprets it with a method and delivers a decision, with every finding tied to something someone wrote.",
    blocks: [
      {
        type: "text",
        title: "How is it different from social listening?",
        paragraphs: [
          "Social listening is monitoring: a tool collects mentions of a brand or of keywords chosen in advance and shows them on a dashboard with volume, sentiment and alerts. It answers how much people talked and whether it went up or down.",
          "Social intelligence starts where the dashboard ends. It begins with a business question, discovers topics from what people say instead of a keyword list, cleans out the noise, interprets with a method and delivers an answer with recommendations. Listening is one of its sources; the analysis and the decision are the product."
        ]
      },
      {
        type: "text",
        title: "How is it different from traditional market research?",
        paragraphs: [
          "Surveys and focus groups ask. They collect stated opinion from a designed sample, with statistical representativeness and in the language of the questionnaire. They are the best way to measure how many people think something.",
          "Social intelligence listens without asking. It works with spontaneous language, in the person's own moment and words, and finds motives and topics nobody thought to include in a questionnaire. It comes before the survey, because it says what to ask, and it complements it, because it explains the why behind a number."
        ]
      },
      {
        type: "cards",
        title: "What can it tell you?",
        items: [
          { name: "Which topics exist and which ones weigh", text: "It discovers what people talk about around a category and how much space each topic takes, with numbers calculated over the whole conversation." },
          { name: "Why, in their words", text: "It shows motives, obstacles, comparisons and verbatim language. It is the best source for understanding the why behind a data point." },
          { name: "What changed and when", text: "It compares periods and detects which topic appeared, grew or faded, and what moved it." },
          { name: "How your brand looks next to others", text: "It reads your brand and your competitors with the same criteria and the same period." }
        ]
      },
      {
        type: "cards",
        title: "What can't it tell you?",
        items: [
          { name: "How many people in the population think something", text: "It represents those who speak in public. For a population figure you need a survey." },
          { name: "What people don't say", text: "If a motive is never put into words, it doesn't show up. That is what observation and usability testing are for." },
          { name: "Sales forecasts", text: "It gives strong hypotheses and directions. Market size and the effect on sales are validated with other methods." }
        ]
      },
      {
        type: "cards",
        title: "Where does the conversation come from?",
        items: [
          { name: "Open social media", text: "Public posts and comments, where the reaction is immediate and the language is spontaneous." },
          { name: "Forums and communities", text: "Long threads where people explain, ask and argue. That is where the motives and codes of a category live." },
          { name: "Reviews and marketplace questions", text: "Purchase decisions already made or about to be made, with their doubts and complaints." },
          { name: "Video comments", text: "Reactions to content, creators and advertising, with a lot of emotional charge." },
          { name: "Search", text: "What people ask a search engine in private, which sometimes differs from what they say in public." },
          { name: "Your own data", text: "NPS, surveys, service tickets. With your authorization, they are read with the same topic structure as the conversation." }
        ]
      },
      {
        type: "cards",
        title: "Which questions does it answer?",
        items: [
          { name: "What is happening with my brand and what changed this month?", text: "A continuous report that compares periods and explains every movement." },
          { name: "Which territory should I build a campaign on?", text: "It tests territories against real conversation to learn which one has permission." },
          { name: "How does a market I don't know actually work?", text: "The unwritten rules of the category, who lends credibility and what to avoid." },
          { name: "Why is my customer leaving for a competitor?", text: "The real reasons for switching and which rival promise feels more credible." },
          { name: "Where does the path to purchase break?", text: "The journey as people live it and the friction worth removing first." },
          { name: "Which need is still unmet?", text: "What people try to solve badly with what already exists." }
        ]
      },
      {
        type: "cards",
        title: "A short glossary",
        items: [
          { name: "Social intelligence", text: "Research that turns public conversation into answers for a decision, with a method and open evidence." },
          { name: "Social listening", text: "Monitoring of mentions of a brand or chosen keywords, presented on dashboards with volume, sentiment and alerts." },
          { name: "Voice of the customer", text: "What people say about a category, a brand or an experience, whether in public or in answer to a survey." },
          { name: "Dataset", text: "The complete set of posts read for a project, after the noise has been cleaned out." },
          { name: "Topic", text: "A group of mentions that talk about the same thing, discovered from people's language and approved by a person." },
          { name: "Triggers and barriers", text: "What motivates and what holds back a decision. It is the most used method in our library." },
          { name: "Share of voice", text: "The share of a category's conversation each brand takes in a given period." },
          { name: "Intelligence Architect", text: "The person who defines the question, approves the topics, corrects the system, interprets with a method and signs off the analysis." }
        ]
      },
      {
        type: "faq",
        title: "Frequently asked questions",
        items: [
          {
            q: "Is social intelligence the same as social listening?",
            a: "No. Social listening monitors mentions and shows them on a dashboard. Social intelligence starts from a business question, reads the whole conversation, interprets it with a method and delivers an answer with recommendations. Listening can be one of its sources."
          },
          {
            q: "Does it replace surveys?",
            a: "No. Surveys measure how many people think something within a defined population. Conversation shows what they say, how they say it and why, without anyone asking. The two together answer better than either one alone."
          },
          {
            q: "How reliable is it?",
            a: "It depends on every number being calculated over the whole conversation and every quote being openable. At Noisia every finding says whether it is measured, directional or qualitative, and the limits are written into the report."
          },
          {
            q: "What role does artificial intelligence play?",
            a: "It reads, groups and classifies the conversation at a scale no person can reach. A trained person approves the topics, corrects the classification and interprets. The numbers are calculated over the whole conversation, with queries that can be repeated."
          },
          {
            q: "Which teams is it for?",
            a: "Brand, insights, product, strategy, communications and the agencies that support them. Any team that has to decide something people are already talking about."
          },
          {
            q: "How is it hired?",
            a: "As a continuous report, as a study that answers one specific question, or as an annual plan of studies. The entry point is a free workshop where we define the question."
          }
        ]
      },
      {
        type: "links",
        title: "Keep reading",
        items: [
          { label: "How it works", text: "The path from your question to a decision.", href: "/en/how-it-works" },
          { label: "Methods", text: "The library with anthropological and sociological foundations.", href: "/en/methods" },
          { label: "Social listening tool or social intelligence", text: "When each one makes sense.", href: "/en/compare/social-listening-tools" },
          { label: "Surveys or conversation", text: "How they complement each other.", href: "/en/compare/surveys" }
        ]
      },
      {
        type: "cta",
        title: "Bring your question",
        text: "In a free workshop we look at whether the conversation can answer it, and how.",
        label: "Book a free workshop",
        href: "/en/workshop"
      }
    ]
  }
};
