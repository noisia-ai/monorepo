import type { Localized, PageContent } from "./types";

export const about: Localized<PageContent> = {
  es: {
    metaTitle: "Nosotros",
    metaDescription:
      "Noisia es una empresa de tecnología que produce investigación. Un sistema que lee toda la conversación y un equipo de Intelligence Architects que la convierte en decisiones, en 16 idiomas y más de 20 países.",
    title: "Una empresa de tecnología que produce investigación",
    lead:
      "Construimos el sistema que lee la conversación completa y formamos a las personas que la interpretan. Lo que entregamos es investigación: respuestas con evidencia para una decisión concreta.",
    blocks: [
      {
        type: "text",
        title: "Qué es Noisia",
        paragraphs: [
          "Noisia produce investigación de mercado y monitoreo de marca a partir de la voz pública: lo que la gente publica en redes, busca, reseña y responde en encuestas. La tecnología es la razón de que esa investigación sea más completa, más rápida y verificable. El software se queda con nosotros; lo que contratas es lo que produce.",
          "Trabajamos con equipos de marca, insights, producto y estrategia, y con las agencias que los acompañan. Llegamos cuando hay una decisión por tomar y la conversación tiene algo que decir sobre ella."
        ]
      },
      {
        type: "cards",
        title: "En qué creemos",
        items: [
          { name: "La pregunta antes que el método", text: "Primero entendemos qué vas a decidir. Después elegimos fuentes, método y profundidad. Nunca al revés." },
          { name: "Honestidad antes que promesa comercial", text: "Cada hallazgo dice si es medido, direccional o cualitativo. Cuando la conversación no puede responder algo, lo decimos antes de cobrar por intentarlo." },
          { name: "Decisiones antes que reportes", text: "Un reporte que no cambia una decisión fue un gasto. Cada recomendación trae responsable, indicador y riesgo." },
          { name: "Muchas fuentes, una lectura clara", text: "Redes, búsquedas, reseñas y tus propios datos se leen juntos. La respuesta llega en una página, con la evidencia detrás." },
          { name: "Entender antes de contar", text: "Una mención que aparece doce veces con enojo puede pesar más que una que aparece doscientas. Intensidad, contexto y relación con la decisión cuentan tanto como la frecuencia." }
        ]
      },
      {
        type: "text",
        title: "Cómo trabajamos",
        paragraphs: [
          "Dos piezas producen cada entrega. La primera es el sistema: lee la conversación completa, separa la voz del ruido, descubre los temas desde lo que se dice, verifica cada cita contra su texto original y actualiza la lectura con lo nuevo sin perder lo revisado.",
          "La segunda es el Intelligence Architect, una persona con formación en investigación, antropología o sociología que opera el sistema para tu proyecto. Define la pregunta y el alcance, aprueba los temas que el sistema propone, corrige la clasificación cuando hace falta, interpreta con un método de la biblioteca y firma la lectura. Cuando presentamos, esa persona está frente a ti respondiendo por cada hallazgo.",
          "El nombre viene de nuestro tagline. Social Intelligence Architects dejó de ser una frase y pasó a ser el rol que trabaja para cada cliente."
        ]
      },
      {
        type: "cards",
        title: "Dónde trabajamos",
        items: [
          { name: "16 idiomas", text: "Leemos conversación en 16 idiomas, del español y el portugués al pidgin nigeriano, el isiZulu, el sesotho y el kinyarwanda. Leemos como habla la gente, con sus modismos y su ortografía." },
          { name: "Más de 20 países", text: "En América, Europa y África. Cada mercado se lee por separado, porque los códigos de una categoría cambian de un país a otro." },
          { name: "Días, en lugar de semanas", text: "Una pregunta acotada se responde en días. Un estudio va del brief a la primera versión en pocos días, con presentación en vivo." }
        ]
      },
      {
        type: "text",
        title: "Manifiesto",
        paragraphs: [
          "La gente ya está diciendo lo que las marcas necesitan saber. Lo dice en reseñas que nadie lee completas, en hilos de foros, en comentarios debajo de un video y en la pregunta que escribe en un buscador a las once de la noche. La materia prima existe. Lo que falta es leerla entera y con criterio.",
          "Contar menciones es fácil. Entender por qué alguien no regresa después de su primera compra es otra cosa. Por eso partimos de la antropología, la sociología y la psicología: queremos saber qué mueve a una persona, qué la frena y qué parte de eso puede tocar una marca.",
          "Creemos que la tecnología debe leerlo todo y que una persona debe decidir qué importa. Un modelo puede agrupar toda la conversación de una categoría; alguien con formación tiene que mirar los grupos, nombrarlos, descartar los que son ruido y responder por la lectura.",
          "Creemos en la evidencia abierta. Cada cifra sale de un cálculo que se puede repetir y cada cita es literal, con fuente y fecha. Si un hallazgo no se puede abrir hasta la mención que lo sostiene, no entra al reporte.",
          "Y creemos en decir los límites. Hay preguntas que la conversación responde bien, otras que solo insinúa y otras que no puede responder. Decirlo antes de empezar es parte del trabajo.",
          "Noisia existe para que una decisión importante se tome con lo que la gente ya dijo, leído completo, en días."
        ]
      },
      {
        type: "cta",
        title: "Trae tu pregunta",
        text: "Un taller gratis de 30 a 60 minutos para entender tu decisión y ver qué puede responder la conversación.",
        label: "Agenda un taller gratis",
        href: "/taller"
      }
    ]
  },
  en: {
    metaTitle: "About",
    metaDescription:
      "Noisia is a technology company that produces research. A system that reads the whole conversation and a team of Intelligence Architects who turn it into decisions, in 16 languages and more than 20 countries.",
    title: "A technology company that produces research",
    lead:
      "We build the system that reads the whole conversation and train the people who interpret it. What we deliver is research: answers with evidence for a specific decision.",
    blocks: [
      {
        type: "text",
        title: "What Noisia is",
        paragraphs: [
          "Noisia produces market research and brand monitoring from the public voice: what people post on social media, search for, review and answer in surveys. Technology is the reason that research is more complete, faster and verifiable. The software stays with us; what you hire is what it produces.",
          "We work with brand, insights, product and strategy teams, and with the agencies that support them. We come in when there is a decision to make and the conversation has something to say about it."
        ]
      },
      {
        type: "cards",
        title: "What we believe",
        items: [
          { name: "The question before the method", text: "First we understand what you are going to decide. Then we choose sources, method and depth. Never the other way around." },
          { name: "Honesty before the commercial promise", text: "Every finding says whether it is measured, directional or qualitative. When the conversation cannot answer something, we say so before charging to try." },
          { name: "Decisions before reports", text: "A report that doesn't change a decision was an expense. Every recommendation comes with an owner, an indicator and a risk." },
          { name: "Many sources, one clear reading", text: "Social media, search, reviews and your own data are read together. The answer arrives on one page, with the evidence behind it." },
          { name: "Understand before you count", text: "A mention that appears twelve times with anger can weigh more than one that appears two hundred times. Intensity, context and the link to the decision count as much as frequency." }
        ]
      },
      {
        type: "text",
        title: "How we work",
        paragraphs: [
          "Two parts produce every delivery. The first is the system: it reads the whole conversation, separates voice from noise, discovers topics from what is said, checks every quote against its original text and updates the reading with new conversation without losing what was already reviewed.",
          "The second is the Intelligence Architect, a person trained in research, anthropology or sociology who operates the system for your project. They define the question and the scope, approve the topics the system proposes, correct the classification when needed, interpret with a method from the library and sign off the reading. When we present, that person is in front of you answering for every finding.",
          "The name comes from our tagline. Social Intelligence Architects stopped being a phrase and became the role that works for each client."
        ]
      },
      {
        type: "cards",
        title: "Where we work",
        items: [
          { name: "16 languages", text: "We read conversation in 16 languages, from Spanish and Portuguese to Nigerian Pidgin, isiZulu, Sesotho and Kinyarwanda. We read the way people talk, with their slang and their spelling." },
          { name: "More than 20 countries", text: "Across the Americas, Europe and Africa. Each market is read on its own, because the codes of a category change from one country to the next." },
          { name: "Days rather than weeks", text: "A focused question is answered in days. A study goes from brief to first version in a few days, with a live presentation." }
        ]
      },
      {
        type: "text",
        title: "Manifesto",
        paragraphs: [
          "People are already saying what brands need to know. They say it in reviews nobody reads to the end, in forum threads, in comments under a video and in the question they type into a search bar at eleven at night. The raw material exists. What is missing is reading it whole and with judgment.",
          "Counting mentions is easy. Understanding why someone doesn't come back after their first purchase is something else. That is why we start from anthropology, sociology and psychology: we want to know what moves a person, what holds them back and which part of that a brand can touch.",
          "We believe technology should read everything and a person should decide what matters. A model can group the whole conversation of a category; someone with training has to look at the groups, name them, discard the ones that are noise and answer for the reading.",
          "We believe in open evidence. Every number comes from a calculation that can be repeated and every quote is verbatim, with source and date. If a finding cannot be opened down to the mention that supports it, it doesn't go in the report.",
          "And we believe in stating the limits. There are questions the conversation answers well, others it only hints at and others it cannot answer. Saying so before starting is part of the job.",
          "Noisia exists so that an important decision is made with what people already said, read in full, in days."
        ]
      },
      {
        type: "cta",
        title: "Bring your question",
        text: "A free 30 to 60 minute workshop to understand your decision and see what the conversation can answer.",
        label: "Book a free workshop",
        href: "/en/workshop"
      }
    ]
  }
};
