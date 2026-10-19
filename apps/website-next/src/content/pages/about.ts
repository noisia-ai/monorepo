import type { Localized, PageContent } from "./types";

export const about: Localized<PageContent> = {
  es: {
    metaTitle: "Sobre Noisia, empresa de inteligencia social",
    metaDescription:
      "Noisia es una empresa de tecnología que hace investigación de mercados. Nuestro software lee la conversación y un Intelligence Architect la interpreta.",
    title: "Una empresa de tecnología que produce investigación",
    lead:
      "Hacemos el software que lee la conversación completa y formamos a las personas que la interpretan. Entregamos investigación con evidencia para una decisión concreta.",
    blocks: [
      {
        type: "text",
        title: "Qué es Noisia",
        paragraphs: [
          "Noisia hace investigación de mercado y monitoreo de marca con lo que la gente publica en redes, busca, reseña y responde en encuestas. Nuestro software nos deja leer más, más rápido y con cada cifra comprobable. El software se queda con nosotros. Lo que contratas es la investigación.",
          "Trabajamos con equipos de marca, insights, producto y estrategia, y con sus agencias. Entramos cuando hay una decisión por tomar y la conversación tiene algo que decir sobre ella."
        ]
      },
      {
        type: "cards",
        title: "En qué creemos",
        items: [
          { name: "La pregunta antes que el método", text: "Primero entendemos qué vas a decidir. Después elegimos fuentes, método y profundidad." },
          { name: "Decir lo que no sabemos", text: "Cada hallazgo dice si es medido, direccional o cualitativo. Si la conversación no puede responder algo, te lo decimos antes de cobrarte por intentarlo." },
          { name: "Que sirva para decidir", text: "Si un reporte no cambia ninguna decisión, fue un gasto. Por eso cada recomendación trae responsable, indicador y riesgo." },
          { name: "Todo junto, en una página", text: "Redes, búsquedas, reseñas y tus propios datos se leen juntos, y la respuesta cabe en una página con la evidencia detrás." },
          { name: "Entender antes de contar", text: "Doce menciones con enojo pueden pesar más que doscientas de paso. La intensidad, el contexto y la relación con la decisión cuentan tanto como la frecuencia." }
        ]
      },
      {
        type: "text",
        title: "Cómo trabajamos",
        paragraphs: [
          "Cada entrega sale de dos partes. Una es nuestro software, que lee la conversación completa, separa la voz de la gente del ruido, encuentra los temas en lo que se dice, verifica cada cita contra su texto original y suma lo nuevo sin perder lo ya revisado.",
          "La otra es el Intelligence Architect, una persona con formación en investigación, antropología o sociología que opera ese software para tu proyecto. Define la pregunta y el alcance, aprueba los temas que propone el software, corrige la clasificación cuando hace falta, interpreta con un método de la biblioteca y firma el resultado. Cuando presentamos, es quien está frente a ti y responde por cada hallazgo.",
          "El nombre del rol sale de la firma que Noisia ha usado siempre, Social Intelligence Architects."
        ]
      },
      {
        type: "cards",
        title: "Dónde trabajamos",
        items: [
          { name: "16 idiomas", text: "Leemos conversación en 16 idiomas, del español y el portugués al pidgin nigeriano, el isiZulu, el sesotho y el kinyarwanda. Leemos como escribe la gente, con sus modismos y su ortografía." },
          { name: "Más de 20 países", text: "En América, Europa y África. Cada mercado se lee por separado, porque los códigos de una categoría cambian de un país a otro." },
          { name: "Días desde el brief", text: "Una pregunta acotada se responde en días, y un estudio llega a su primera versión pocos días después del brief, con presentación en vivo." }
        ]
      },
      {
        type: "text",
        title: "Manifiesto",
        paragraphs: [
          "La gente ya está diciendo lo que las marcas necesitan saber. Lo dice en reseñas que nadie lee completas, en hilos de foros, en comentarios debajo de un video y en lo que escribe en el buscador a las once de la noche. Falta leerlo entero y con criterio.",
          "Contar menciones es fácil. Entender por qué alguien no regresa después de su primera compra cuesta más, y para eso usamos la antropología, la sociología y la psicología. Queremos saber qué mueve a una persona, qué la frena y qué parte de eso está en manos de una marca.",
          "La tecnología lee todo y una persona decide qué importa. Un modelo puede agrupar la conversación entera de una categoría, pero alguien con formación tiene que revisar esos grupos, ponerles nombre, tirar el ruido y responder por el análisis.",
          "La evidencia va abierta. Cada cifra sale de un cálculo que se puede repetir y cada cita es literal, con fuente y fecha. Si un hallazgo no se puede abrir hasta la mención que lo sostiene, se queda fuera del reporte.",
          "Y los límites se dicen. Hay preguntas que la conversación responde bien, otras que apenas sugiere y otras que no puede responder. Lo decimos antes de empezar.",
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
    metaTitle: "About Noisia, a social intelligence company",
    metaDescription:
      "Noisia is a technology company that does market research. Our software reads the conversation, and an Intelligence Architect interprets it with you.",
    title: "A technology company that produces research",
    lead:
      "We build the software that reads the whole conversation and train the people who interpret it. We deliver research, with evidence, for a specific decision.",
    blocks: [
      {
        type: "text",
        title: "What Noisia is",
        paragraphs: [
          "Noisia does market research and brand monitoring with what people post on social media, search for, review and answer in surveys. Our software lets us read more, faster, with every number checkable. The software stays with us. What you hire is the research.",
          "We work with brand, insights, product and strategy teams, and with the agencies that support them. We step in when there is a decision to make and the conversation has something to say about it."
        ]
      },
      {
        type: "cards",
        title: "What we believe",
        items: [
          { name: "The question before the method", text: "First we understand what you are going to decide. Then we choose sources, method and depth." },
          { name: "Saying what we don't know", text: "Every finding says whether it is measured, directional or qualitative. If the conversation can't answer something, we tell you before charging you to try." },
          { name: "Built for decisions", text: "If a report doesn't change any decision, it was an expense. That is why every recommendation comes with an owner, an indicator and a risk." },
          { name: "All of it, on one page", text: "Social media, search, reviews and your own data are read together, and the answer fits on one page with the evidence behind it." },
          { name: "Understand before you count", text: "Twelve angry mentions can weigh more than two hundred passing ones. Intensity, context and the link to the decision count as much as frequency." }
        ]
      },
      {
        type: "text",
        title: "How we work",
        paragraphs: [
          "Every delivery comes from two parts. One is our software, which reads the whole conversation, separates people's voice from noise, finds the topics in what is said, checks every quote against its original text and adds new conversation without losing what was already reviewed.",
          "The other is the Intelligence Architect, a person trained in research, anthropology or sociology who runs that software for your project. They define the question and the scope, approve the topics the software proposes, correct the classification when needed, interpret with a method from the library and sign off on the analysis. When we present, they are the one in front of you, answering for every finding.",
          "The role takes its name from the line Noisia has always signed with, Social Intelligence Architects."
        ]
      },
      {
        type: "cards",
        title: "Where we work",
        items: [
          { name: "16 languages", text: "We read conversation in 16 languages, from Spanish and Portuguese to Nigerian Pidgin, isiZulu, Sesotho and Kinyarwanda. We read the way people write, slang and spelling included." },
          { name: "More than 20 countries", text: "Across the Americas, Europe and Africa. Each market is read on its own, because the codes of a category change from one country to the next." },
          { name: "Days from the brief", text: "A focused question is answered in days, and a study reaches its first version a few days after the brief, with a live presentation." }
        ]
      },
      {
        type: "text",
        title: "Manifesto",
        paragraphs: [
          "People are already saying what brands need to know. They say it in reviews nobody reads to the end, in forum threads, in comments under a video and in what they type into a search bar at eleven at night. Someone just has to read all of it, with judgment.",
          "Counting mentions is easy. Understanding why someone doesn't come back after their first purchase takes more, and that is where anthropology, sociology and psychology come in. We want to know what moves a person, what holds them back and which part of that a brand can actually change.",
          "Technology reads everything and a person decides what matters. A model can group a whole category's conversation, but someone with training has to review those groups, name them, throw out the noise and answer for the analysis.",
          "The evidence stays open. Every number comes from a calculation that can be repeated and every quote is verbatim, with source and date. If a finding can't be opened down to the mention behind it, it stays out of the report.",
          "And the limits get said out loud. Some questions the conversation answers well, some it only hints at and some it can't answer. We say which before we start.",
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
