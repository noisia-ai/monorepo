import type { FaqItem } from "@/components/ui/Faq";
import type { FaqIcon } from "@/components/ui/faq-icons";
import type { MethodCountCopy } from "@/motion/MethodCountComposition";
import type { MethodNumberCopy } from "@/motion/MethodNumberComposition";
import type { MethodWeightCopy } from "@/motion/MethodWeightComposition";
import type { UnderstandCopy } from "@/motion/UnderstandComposition";

/**
 * The Methods page: Noisia's anthropological approach told in one idea per section, with the
 * library of six methods as part of the story. The short card of each method lives in
 * method-sheet.ts so any page can open it.
 */

export type RootKey = "anthropology" | "sociology" | "psychology" | "semiotics";

export type MethodsPageCopy = {
  metaTitle: string;
  metaDescription: string;
  hero: { title: string; lead: string; motion: MethodCountCopy; label: string };
  number: { title: string; lead: string; motion: MethodNumberCopy; label: string };
  layers: {
    title: string;
    lead: string;
    motion: UnderstandCopy;
    items: { name: string; text: string; move: string }[];
    methodIntro: string;
  };
  weight: { title: string; lead: string; motion: MethodWeightCopy; label: string; levelsTitle: string; levels: { name: string; text: string }[] };
  roots: { title: string; lead: string; items: { key: RootKey; name: string; text: string; authors: string }[] };
  library: { title: string; lead: string; growTitle: string; growText: string };
  faq: { title: string; items: (FaqItem & { icon: FaqIcon })[] };
  cta: { title: string; text: string; label: string };
};

export const methodsPage: Record<"es" | "en", MethodsPageCopy> = {
  es: {
    metaTitle: "Métodos de investigación social de Noisia",
    metaDescription:
      "Seis métodos con base en antropología, sociología y psicología para entender por qué la gente decide lo que decide, como Triggers & Barriers.",
    hero: {
      title: "Entender antes de contar",
      lead: "Una cifra te dice cuánta gente habla de algo. Para decidir necesitas saber por qué. Nuestros métodos empiezan por las personas y sus razones, y cuentan después.",
      label: "Un mismo tema, tres razones distintas",
      motion: {
        header: "Lo que más se menciona",
        unit: "menciones",
        bars: [
          { label: "Precio", value: 200 },
          { label: "Sabor", value: 84 },
          { label: "Empaque", value: 41 }
        ],
        inside: "Dentro de «Precio»",
        asks: "Lo que pide",
        rows: [
          { quote: "Está caro para lo poco que dura", platform: "TikTok", ask: "Mostrar cuánto rinde" },
          { quote: "Esta quincena de plano no me alcanza", platform: "X", ask: "Una presentación más chica" },
          { quote: "En mi casa dicen que es un lujo", platform: "Facebook", ask: "Un motivo para darse el gusto" }
        ],
        caption: "Un mismo número, tres razones. Un descuento solo atiende una."
      }
    },
    number: {
      title: "Mover el número no mueve la razón",
      lead: "Un descuento o más pauta pueden subir una cifra unas semanas. Si lo que frena a la gente sigue ahí, la cifra regresa. Cuando entiendes la razón y la atiendes, el cambio se queda.",
      label: "Una cifra que sube con un descuento y regresa, y que se sostiene cuando se atiende la razón",
      motion: {
        metric: "Ventas en línea",
        weeks: "12 semanas",
        push: "Descuento",
        before: "Donde estaba",
        quote: "Me encanta, pero nunca sé qué tono pedir sin probarlo",
        platform: "Instagram",
        stuck: "La razón sigue ahí",
        fixed: "Guía de tonos antes de pagar",
        fix: "Atiendes la razón",
        caption: "El descuento movió el número unas semanas. Atender la razón lo sostuvo."
      }
    },
    layers: {
      title: "Las razones viven en capas",
      lead: "Cada razón vive en una de cuatro capas, y la capa decide qué puede hacer tu marca. Hay razones que mueves, otras en las que influyes y otras con las que te conviene alinearte.",
      motion: {
        quote: "Quiero cocinar más, pero llego muerta y aquí la comida de verdad lleva horas",
        layers: ["Psicológica", "Personal", "Social", "Cultural"],
        chips: [
          { text: "Comer mejor", layer: 0, kind: "trigger" },
          { text: "Cansancio", layer: 1, kind: "barrier" },
          { text: "Cocinar para los míos", layer: 2, kind: "trigger" },
          { text: "Lo casero vale más", layer: 3, kind: "barrier" }
        ],
        trigger: "Lo que la mueve",
        barrier: "Lo que la frena",
        caption: "Cuatro razones en una sola frase, cada una en su capa."
      },
      items: [
        { name: "Psicológica", text: "Lo que pasa dentro de la persona, como el deseo, el alivio, la ansiedad o la inercia.", move: "La mueves con producto y comunicación." },
        { name: "Personal", text: "Su presupuesto, su tiempo, sus hábitos y quién es.", move: "La mueves con precio, formato y conveniencia." },
        { name: "Social", text: "La mirada de los demás, desde la recomendación hasta el estigma.", move: "Influyes con comunidad y validación visible." },
        { name: "Cultural", text: "Lo que la categoría significa en ese mercado.", move: "Casi nunca se mueve. Te alineas o te sales." }
      ],
      methodIntro: "Esta lectura viene de"
    },
    weight: {
      title: "Doce pueden pesar más que doscientas",
      lead: "Doce menciones con enojo de gente a punto de irse pueden importar más que doscientas que pasan de largo. El método decide qué pesa por intensidad, contexto y relación con la decisión que vas a tomar.",
      label: "Tres grupos de menciones ordenados primero por volumen y después por peso",
      motion: {
        byCount: "Cuántas",
        byWeight: "Cuánto pesan",
        unit: "menciones",
        rows: [
          { label: "Lo comentan de pasada", count: 200, weight: 22 },
          { label: "Preguntan por la entrega", count: 64, weight: 40 },
          { label: "Se quieren ir, con enojo", count: 12, weight: 92, hot: true }
        ],
        quote: "Tercera vez que me cobran de más. Si pasa otra vez, me cambio",
        platform: "X",
        caption: "El volumen dice cuántas son, y el método, cuánto pesan."
      },
      levelsTitle: "Y cada hallazgo dice cuánto confiar en él",
      levels: [
        { name: "Medido", text: "Sale de un cálculo sobre la conversación y se puede repetir con el mismo resultado." },
        { name: "Direccional", text: "Marca hacia dónde va algo. Sirve para decidir, y si la decisión es grande conviene confirmarlo con una encuesta." },
        { name: "Cualitativo", text: "Explica cómo piensa la gente con sus propias palabras. Dice por qué, sin decir cuántos." }
      ]
    },
    roots: {
      title: "Lo que ya sabemos de las personas",
      lead: "Las ciencias sociales llevan décadas estudiando por qué hacemos lo que hacemos. Cada método parte de una teoría publicada, con autores y evidencia.",
      items: [
        { key: "anthropology", name: "Antropología", text: "Lee la cultura desde adentro, con lo que en un mercado se admira, se ridiculiza o tiene permiso.", authors: "Geertz · Douglas e Isherwood" },
        { key: "sociology", name: "Sociología", text: "Sigue cómo viajan las ideas entre personas y comunidades, quién legitima y por dónde entra lo nuevo.", authors: "Granovetter · Rogers · Katz y Lazarsfeld" },
        { key: "psychology", name: "Psicología", text: "Explica cómo decide una persona, qué la empuja, qué la frena y por qué a veces no cambia aunque quiera.", authors: "Kahneman · Deci y Ryan · Thaler y Sunstein" },
        { key: "semiotics", name: "Semiótica", text: "Descifra qué significan las palabras, las imágenes y los objetos de una categoría.", authors: "Saussure · Barthes" }
      ]
    },
    library: {
      title: "Seis métodos, una biblioteca que crece",
      lead: "Cada método responde una pregunta distinta. Toca uno para ver qué mira y en qué se apoya.",
      growTitle: "¿Tu pregunta no encaja en ninguno?",
      growText: "Construimos el que hace falta. Cualquier teoría sólida sobre el comportamiento humano, con autores, evidencia y categorías claras, puede volverse un método nuevo."
    },
    faq: {
      title: "Preguntas frecuentes",
      items: [
        {
          icon: "people",
          q: "¿Qué quiere decir que un método tenga base antropológica?",
          a: "Que parte de cómo vive la gente una categoría antes de medirla. Leemos lo que dice en su contexto y con sus palabras, y usamos teorías de las ciencias sociales para ordenar sus razones. El conteo llega después y sirve para dimensionar esas razones."
        },
        {
          icon: "question",
          q: "¿Cómo sé qué método me conviene?",
          a: "No necesitas saberlo de antemano. En el taller gratis partimos de la decisión que vas a tomar y elegimos juntos el método, o combinamos dos. Muchas preguntas se resuelven con Triggers & Barriers."
        },
        {
          icon: "edit",
          q: "¿Cómo se construye un método nuevo?",
          a: "Partimos de una teoría publicada que explique una parte del comportamiento y de una decisión concreta que ayude a tomar. La traducimos en categorías con reglas escritas para los casos difíciles, la probamos sobre conversación real y medimos que dos personas clasifiquen igual antes de confiar en las cifras. Entra a la biblioteca con lo que responde y lo que no."
        },
        {
          icon: "mind",
          q: "¿Quién aplica los métodos?",
          a: "Un Intelligence Architect, una persona experta en investigación, antropología y sociología. Define la pregunta, aprueba los temas, revisa la clasificación y firma la lectura. Nuestro software lee la conversación y hace los cálculos, y el criterio lo pone esa persona."
        },
        {
          icon: "check",
          q: "¿Qué no responde un método?",
          a: "Cada método tiene sus límites escritos. Ninguno estima el tamaño de un mercado ni reemplaza una prueba cuantitativa de concepto. Cuando tu pregunta lo pide, te lo decimos y te sugerimos la encuesta, la prueba de usabilidad o el experimento que la termina de contestar."
        },
        {
          icon: "data",
          q: "¿Esto reemplaza a una encuesta?",
          a: "La complementa. Entender primero las razones te ayuda a diseñar una encuesta que pregunte lo correcto, y muchos estudios cierran con las preguntas que conviene validar con una muestra."
        }
      ]
    },
    cta: {
      title: "Trae tu pregunta",
      text: "En el taller gratis elegimos juntos el método, o definimos el que hace falta.",
      label: "Agenda un taller gratis"
    }
  },
  en: {
    metaTitle: "Noisia's social research methods",
    metaDescription:
      "Six research methods drawn from anthropology, sociology and psychology to understand why people decide what they decide, Triggers & Barriers among them.",
    hero: {
      title: "Understand before you count",
      lead: "A number tells you how many people talk about something. To decide, you need to know why. Our methods start with people and their reasons, and only then count.",
      label: "One topic, three different reasons",
      motion: {
        header: "What comes up most",
        unit: "mentions",
        bars: [
          { label: "Price", value: 200 },
          { label: "Taste", value: 84 },
          { label: "Packaging", value: 41 }
        ],
        inside: "Inside “Price”",
        asks: "What it asks for",
        rows: [
          { quote: "Pricey for how little it lasts", platform: "TikTok", ask: "Show how far it goes" },
          { quote: "Honestly, it's not in this month's budget", platform: "X", ask: "A smaller pack size" },
          { quote: "My family says it's a luxury", platform: "Facebook", ask: "A reason to treat yourself" }
        ],
        caption: "One number, three reasons. A discount only answers one."
      }
    },
    number: {
      title: "Moving the number doesn't move the reason",
      lead: "A discount or more media can lift a number for a few weeks. If what holds people back is still there, the number comes back down. When you understand the reason and address it, the change stays.",
      label: "A number that rises with a discount and falls back, and holds once the reason is addressed",
      motion: {
        metric: "Online sales",
        weeks: "12 weeks",
        push: "Discount",
        before: "Where it was",
        quote: "I love it, but I never know which shade to order without trying it",
        platform: "Instagram",
        stuck: "The reason is still there",
        fixed: "Shade guide before checkout",
        fix: "You address the reason",
        caption: "The discount moved the number for a few weeks. Addressing the reason made it hold."
      }
    },
    layers: {
      title: "Reasons live in layers",
      lead: "Every reason lives in one of four layers, and the layer decides what your brand can do. Some reasons you move, some you influence and some you are better off aligning with.",
      motion: {
        quote: "I want to cook more, but I get home wiped out and real food here takes hours",
        layers: ["Psychological", "Personal", "Social", "Cultural"],
        chips: [
          { text: "Eating better", layer: 0, kind: "trigger" },
          { text: "Exhaustion", layer: 1, kind: "barrier" },
          { text: "Feeding my people", layer: 2, kind: "trigger" },
          { text: "Homemade is better", layer: 3, kind: "barrier" }
        ],
        trigger: "What drives her",
        barrier: "What holds her back",
        caption: "Four reasons in one sentence, each in its layer."
      },
      items: [
        { name: "Psychological", text: "What happens inside the person, like desire, relief, anxiety or inertia.", move: "You move it with product and communication." },
        { name: "Personal", text: "Their budget, their time, their habits and who they are.", move: "You move it with price, format and convenience." },
        { name: "Social", text: "What other people think, from recommendations to stigma.", move: "You influence it with community and visible validation." },
        { name: "Cultural", text: "What the category means in that market.", move: "It almost never moves. You align or step aside." }
      ],
      methodIntro: "This reading comes from"
    },
    weight: {
      title: "Twelve can weigh more than two hundred",
      lead: "Twelve angry mentions from people about to leave can matter more than two hundred that mention it in passing. The method decides what weighs by intensity, context and the link to the decision you are about to make.",
      label: "Three groups of mentions ranked first by volume and then by weight",
      motion: {
        byCount: "How many",
        byWeight: "How much they weigh",
        unit: "mentions",
        rows: [
          { label: "Mention it in passing", count: 200, weight: 22 },
          { label: "Ask about delivery", count: 64, weight: 40 },
          { label: "Want to leave, angry", count: 12, weight: 92, hot: true }
        ],
        quote: "Third time they overcharge me. One more and I'm switching",
        platform: "X",
        caption: "Volume tells you how many, and the method how much they weigh."
      },
      levelsTitle: "And every finding says how much to trust it",
      levels: [
        { name: "Measured", text: "It comes from a calculation over the conversation and repeats with the same result." },
        { name: "Directional", text: "It shows where something is heading. It is enough to decide, and for a big decision it is worth confirming with a survey." },
        { name: "Qualitative", text: "It explains how people think, in their own words. It tells you why, without saying how many." }
      ]
    },
    roots: {
      title: "What we already know about people",
      lead: "The social sciences have studied for decades why we do what we do. Every method starts from a published theory, with authors and evidence.",
      items: [
        { key: "anthropology", name: "Anthropology", text: "Reads culture from the inside, with what a market admires, ridicules or allows.", authors: "Geertz · Douglas and Isherwood" },
        { key: "sociology", name: "Sociology", text: "Follows how ideas travel between people and communities, who lends legitimacy and how new things get in.", authors: "Granovetter · Rogers · Katz and Lazarsfeld" },
        { key: "psychology", name: "Psychology", text: "Explains how a person decides, what pushes them, what holds them back and why sometimes they don't change even when they want to.", authors: "Kahneman · Deci and Ryan · Thaler and Sunstein" },
        { key: "semiotics", name: "Semiotics", text: "Decodes what the words, images and objects of a category mean.", authors: "Saussure · Barthes" }
      ]
    },
    library: {
      title: "Six methods, a library that grows",
      lead: "Each method answers a different question. Tap one to see what it looks at and what it is built on.",
      growTitle: "Your question doesn't fit any of them?",
      growText: "We build the one that is missing. Any solid theory of human behavior, with authors, evidence and clear categories, can become a new method."
    },
    faq: {
      title: "Frequently asked questions",
      items: [
        {
          icon: "people",
          q: "What does it mean for a method to have an anthropological basis?",
          a: "It starts from how people live a category before measuring it. We read what they say in context and in their own words, and use theories from the social sciences to organize their reasons. Counting comes after, to size those reasons."
        },
        {
          icon: "question",
          q: "How do I know which method fits?",
          a: "You don't need to know in advance. In the free workshop we start from the decision you are about to make and choose the method together, or combine two. Many questions are answered with Triggers & Barriers."
        },
        {
          icon: "edit",
          q: "How is a new method built?",
          a: "We start from a published theory that explains a part of human behavior and from a specific decision it helps make. We translate it into categories with written rules for the hard cases, test it on real conversation and measure that two people classify alike before trusting the numbers. It enters the library with what it answers and what it doesn't."
        },
        {
          icon: "mind",
          q: "Who applies the methods?",
          a: "An Intelligence Architect, an expert in research, anthropology and sociology. They define the question, approve the topics, review the classification and sign off on the read. Our software reads the conversation and runs the calculations, and the judgment comes from that person."
        },
        {
          icon: "check",
          q: "What doesn't a method answer?",
          a: "Every method has its limits written down. None of them estimates market size or replaces a quantitative concept test. When your question needs it, we tell you and suggest the survey, usability test or experiment that finishes answering it."
        },
        {
          icon: "data",
          q: "Does this replace a survey?",
          a: "It complements one. Understanding the reasons first helps you design a survey that asks the right things, and many studies close with the questions worth validating with a sample."
        }
      ]
    },
    cta: {
      title: "Bring your question",
      text: "In the free workshop we choose the method together, or define the one that is missing.",
      label: "Book a free workshop"
    }
  }
};
