import type { Localized, PageContent } from "./types";

export type WorkshopForm = {
  name: string;
  email: string;
  company: string;
  role: string;
  question: string;
  questionHint: string;
  market: string;
  when: string;
  whenOptions: string[];
  submit: string;
  sending: string;
  success: string;
  error: string;
  privacy: string;
};

export const workshop: Localized<PageContent & { form: WorkshopForm }> = {
  es: {
    metaTitle: "Agenda un taller gratis con Noisia",
    metaDescription:
      "Trae tu pregunta a un taller gratis de 30 a 60 minutos. Entendemos tu decisión, vemos qué puede responder la conversación y te proponemos un alcance por escrito, sin compromiso.",
    title: "Trae tu pregunta",
    lead:
      "Un taller gratis de 30 a 60 minutos, por videollamada, con un Intelligence Architect. Entendemos tu contexto y la decisión que viene, vemos qué puede responder la conversación y, si tiene sentido, te proponemos un alcance por escrito. Si no tienes brief, lo armamos ahí.",
    blocks: [
      {
        type: "steps",
        title: "Qué pasa después de enviar el formulario",
        items: [
          { name: "Taller", text: "Te escribimos en menos de un día hábil para proponer horario. En la sesión hablamos de tu situación, de lo que vas a decidir y de qué fuentes y método podrían responderlo." },
          { name: "Alcance", text: "En los días siguientes recibes por escrito la pregunta, las fuentes, el método, los entregables, las fechas y el costo. También sin costo y sin compromiso." },
          { name: "Primera entrega", text: "Si decides arrancar, la primera versión llega en días y la presentamos en vivo, con la evidencia abierta para que la revises." }
        ]
      },
      {
        type: "cards",
        title: "Qué conviene traer",
        lead: "Nada de esto es obligatorio. Con lo que tengas alcanza para empezar.",
        items: [
          { name: "La decisión que viene", text: "Un lanzamiento, una campaña, un mercado nuevo, una caída que no se explica. Lo que esté sobre la mesa." },
          { name: "Lo que ya saben", text: "Hipótesis del equipo, un estudio anterior, el dashboard de tu herramienta. Sirve para no repetir y para probar lo que creen." },
          { name: "Tus datos, si los hay", text: "NPS, encuestas o tickets de servicio que podrían leerse junto con la conversación." },
          { name: "Fechas", text: "Para cuándo necesitas la respuesta y quién la va a usar." }
        ]
      },
      {
        type: "faq",
        title: "Preguntas frecuentes",
        items: [
          { q: "¿De verdad es gratis?", a: "Sí. El taller y el alcance por escrito no tienen costo ni compromiso. Cobramos cuando decides arrancar un reporte, un estudio o un plan anual." },
          { q: "¿Quién participa por parte de Noisia?", a: "Un Intelligence Architect, la persona que definiría la pregunta y firmaría el resultado si trabajamos juntos. Por tu lado conviene que esté quien va a tomar la decisión o quien conoce mejor el problema." },
          { q: "¿Qué pasa si no tengo brief?", a: "Es el caso más común. Con tu situación y la decisión que viene armamos la pregunta en la sesión. El alcance que recibes después funciona como brief." },
          { q: "¿Pueden firmar un acuerdo de confidencialidad?", a: "Sí. Si necesitas un NDA antes de contarnos el contexto, envíanos el tuyo o te mandamos uno nuestro antes del taller." },
          { q: "¿Y si la conversación no puede responder mi pregunta?", a: "Te lo decimos en el taller y, si conocemos a alguien que sí pueda, te lo recomendamos. Preferimos eso a vender un estudio que no sirva." }
        ]
      }
    ],
    form: {
      name: "Nombre",
      email: "Correo de trabajo",
      company: "Empresa",
      role: "Puesto",
      question: "¿Qué necesitas entender o decidir?",
      questionHint: "Con una o dos líneas basta. Si no tienes brief, lo armamos en el taller.",
      market: "Mercado o países",
      when: "¿Para cuándo lo necesitas?",
      whenOptions: ["Esta semana", "Este mes", "Este trimestre", "Sin prisa"],
      submit: "Agendar el taller",
      sending: "Enviando…",
      success: "Listo. Te escribimos en menos de un día hábil para proponer horario.",
      error: "No se pudo enviar. Escríbenos a hola@noisia.ai.",
      privacy: "Usamos tus datos solo para contactarte sobre el taller."
    }
  },
  en: {
    metaTitle: "Book a free workshop with Noisia",
    metaDescription:
      "Bring your question to a free 30 to 60 minute workshop. We understand your decision, look at what the conversation can answer and propose a written scope, with no commitment.",
    title: "Bring your question",
    lead:
      "A free 30 to 60 minute workshop, by video call, with an Intelligence Architect. We understand your context and the decision ahead, look at what the conversation can answer and, if it makes sense, propose a written scope. If you don't have a brief, we build it there.",
    blocks: [
      {
        type: "steps",
        title: "What happens after you send the form",
        items: [
          { name: "Workshop", text: "We write within one business day to propose a time. In the session we talk about your situation, what you are going to decide and which sources and method could answer it." },
          { name: "Scope", text: "In the following days you receive in writing the question, the sources, the method, the deliverables, the dates and the cost. Also free and with no commitment." },
          { name: "First delivery", text: "If you decide to start, the first version arrives within days and we present it live, with the evidence open for you to review." }
        ]
      },
      {
        type: "cards",
        title: "What to bring",
        lead: "None of this is required. Whatever you have is enough to start.",
        items: [
          { name: "The decision ahead", text: "A launch, a campaign, a new market, a drop nobody can explain. Whatever is on the table." },
          { name: "What you already know", text: "Your team's hypotheses, a previous study, your tool's dashboard. It helps avoid repeating work and lets us test what you believe." },
          { name: "Your data, if any", text: "NPS, surveys or service tickets that could be read alongside the conversation." },
          { name: "Dates", text: "When you need the answer and who is going to use it." }
        ]
      },
      {
        type: "faq",
        title: "Frequently asked questions",
        items: [
          { q: "Is it really free?", a: "Yes. The workshop and the written scope have no cost and no commitment. We charge when you decide to start a report, a study or an annual plan." },
          { q: "Who attends from Noisia?", a: "An Intelligence Architect, the person who would define the question and sign off the analysis if we work together. On your side it helps to have whoever will make the decision or knows the problem best." },
          { q: "What if I don't have a brief?", a: "That is the most common case. From your situation and the decision ahead we build the question in the session. The scope you receive afterwards works as the brief." },
          { q: "Can you sign an NDA?", a: "Yes. If you need an NDA before sharing context, send us yours or we send you ours before the workshop." },
          { q: "What if the conversation can't answer my question?", a: "We tell you in the workshop and, if we know someone who can, we recommend them. We prefer that to selling a study that won't help." }
        ]
      }
    ],
    form: {
      name: "Name",
      email: "Work email",
      company: "Company",
      role: "Role",
      question: "What do you need to understand or decide?",
      questionHint: "One or two lines is enough. If you don't have a brief, we build it in the workshop.",
      market: "Market or countries",
      when: "When do you need it?",
      whenOptions: ["This week", "This month", "This quarter", "No rush"],
      submit: "Book the workshop",
      sending: "Sending…",
      success: "Done. We'll write within one business day to propose a time.",
      error: "It didn't go through. Write to us at hola@noisia.ai.",
      privacy: "We use your data only to contact you about the workshop."
    }
  }
};
