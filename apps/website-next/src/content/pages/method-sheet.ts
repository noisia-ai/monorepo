import type { ComponentType, SVGProps } from "react";
import { ChatBubbleTranslate, Coins, DashboardSpeed, DataTransferBoth, Network, PathArrow } from "iconoir-react";

/**
 * The six methods of the library, in short: icon, name, the question each one answers, a brief
 * description and the authors it stands on. Used by the method chip and its sheet anywhere on the
 * site, and by the library on the Methods page. The vision behind them lives on /metodos.
 */

export type MethodKey = "tb" | "vpm" | "cc" | "dv" | "jfm" | "ia";

type MethodLocale = { question: string; description: string; roots: string };

export type MethodSheetEntry = {
  name: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  es: MethodLocale;
  en: MethodLocale;
};

export const methodOrder: MethodKey[] = ["tb", "vpm", "cc", "dv", "jfm", "ia"];

export const methodSheet: Record<MethodKey, MethodSheetEntry> = {
  tb: {
    name: "Triggers & Barriers",
    icon: DataTransferBoth,
    es: {
      question: "¿Qué empuja y qué frena una decisión?",
      description:
        "Separa lo que acerca a la gente a tu marca de lo que la detiene, y ubica cada razón en una de cuatro capas: psicológica, personal, social y cultural. Te dice qué puedes mover con producto o comunicación y con qué te conviene alinearte. Es el método que más usamos.",
      roots: "Kahneman · Christensen · Deci y Ryan · Nordgren y Schonthal"
    },
    en: {
      question: "What pushes a decision and what holds it back?",
      description:
        "It separates what draws people to your brand from what stops them, and places each reason in one of four layers: psychological, personal, social and cultural. That tells you what you can move with product or communication and what you are better off aligning with. It is the method we use most.",
      roots: "Kahneman · Christensen · Deci and Ryan · Nordgren and Schonthal"
    }
  },
  vpm: {
    name: "Value Perception Matrix",
    icon: Coins,
    es: {
      question: "¿Por qué te eligen aunque no seas la opción más barata?",
      description:
        "Compara lo que la gente entrega en dinero, tiempo, esfuerzo y riesgo con lo que recibe en beneficio funcional, emocional y simbólico. Muestra dónde tu marca justifica su precio, dónde cobra una prima sin razón visible y qué espacio no ocupa nadie.",
      roots: "Zeithaml · Kahneman y Tversky · Park, Jaworski y MacInnis · Keller"
    },
    en: {
      question: "Why do people choose you when you are not the cheapest option?",
      description:
        "It compares what people give in money, time, effort and risk with what they get in functional, emotional and symbolic benefit. It shows where your brand justifies its price, where it charges a premium with no visible reason and which space nobody occupies.",
      roots: "Zeithaml · Kahneman and Tversky · Park, Jaworski and MacInnis · Keller"
    }
  },
  cc: {
    name: "Cultural Codes Decoding",
    icon: ChatBubbleTranslate,
    es: {
      question: "¿Qué significa tu categoría en la vida real de un mercado?",
      description:
        "Hace visibles las reglas no escritas de una categoría, lo que en ese mercado se admira, se ridiculiza o tiene permiso. Así tu marca sabe qué lenguaje usar y dónde colocarse sin desentonar.",
      roots: "Saussure · Barthes · Geertz · Douglas e Isherwood"
    },
    en: {
      question: "What does your category mean in people's real lives in a market?",
      description:
        "It makes the unwritten rules of a category visible, what that market admires, ridicules or allows. So your brand knows which language to use and where to stand without sounding out of place.",
      roots: "Saussure · Barthes · Geertz · Douglas and Isherwood"
    }
  },
  dv: {
    name: "Decision Velocity",
    icon: DashboardSpeed,
    es: {
      question: "¿Por qué la gente decide lento en tu categoría?",
      description:
        "Reconstruye cómo decide la gente antes, durante y después de elegir, y qué modo de pensar domina en cada fase, el rápido e intuitivo o el lento y deliberado. Muestra qué frena el avance, qué lo acelera y qué conviene mostrar antes.",
      roots: "Kahneman · Thaler y Sunstein · Baumeister · Pirolli y Card"
    },
    en: {
      question: "Why do people decide slowly in your category?",
      description:
        "It reconstructs how people decide before, during and after choosing, and which mode of thinking leads each phase, the fast and intuitive or the slow and deliberate. It shows what slows the decision down, what speeds it up and what is worth showing earlier.",
      roots: "Kahneman · Thaler and Sunstein · Baumeister · Pirolli and Card"
    }
  },
  jfm: {
    name: "Journey Friction Mapping",
    icon: PathArrow,
    es: {
      question: "¿Dónde se pierde la intención antes de volverse compra?",
      description:
        "Sigue el recorrido como lo vive la gente y clasifica cada fricción en uno de cuatro tipos, inercia, esfuerzo, emoción o reactancia. Cada tipo pide una solución distinta, y confundirlos es la razón de que muchas mejoras no mejoren nada.",
      roots: "Lemon y Verhoef · Nordgren y Schonthal · Sweller · Kahneman"
    },
    en: {
      question: "Where does intent get lost before it becomes a purchase?",
      description:
        "It follows the journey as people live it and classifies every friction into one of four types, inertia, effort, emotion or reactance. Each type calls for a different fix, and mixing them up is why many improvements improve nothing.",
      roots: "Lemon and Verhoef · Nordgren and Schonthal · Sweller · Kahneman"
    }
  },
  ia: {
    name: "Influence Architecture",
    icon: Network,
    es: {
      question: "¿Qué voces hacen creíble una idea en tu categoría?",
      description:
        "Mapea quién define lo que una categoría significa, muchas veces sin saberlo. Clasifica cada voz por la función que cumple en la red, más allá de sus seguidores, y muestra por dónde entra lo nuevo a una comunidad.",
      roots: "Granovetter · Rogers · Katz y Lazarsfeld · Barabási"
    },
    en: {
      question: "Which voices make an idea credible in your category?",
      description:
        "It maps who defines what a category means, often without knowing it. It classifies each voice by the function it plays in the network, beyond its follower count, and shows how new ideas get into a community.",
      roots: "Granovetter · Rogers · Katz and Lazarsfeld · Barabási"
    }
  }
};

/** Interface words of the sheet. */
export const methodSheetLabels = {
  es: { method: "Método", roots: "Se apoya en", link: "Conoce nuestro enfoque", close: "Cerrar", open: "Ver más sobre" },
  en: { method: "Method", roots: "Built on", link: "See our approach", close: "Close", open: "More about" }
} as const;
