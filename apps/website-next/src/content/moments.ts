/**
 * The offer, told by the job it does in the life of a brand or product.
 * Each moment maps to what the client receives: a continuous Report, a Study, or an annual plan.
 * Draft copy (18 oct 2026), to be reviewed against 06_mensaje.md.
 */
export type Moment = {
  slug: { es: string; en: string };
  deliverable: "report" | "study" | "plan";
  /** always = runs every month as part of the day to day; project = answers one decision. */
  rhythm: "always" | "project";
  es: { name: string; question: string; summary: string };
  en: { name: string; question: string; summary: string };
  /** Unsplash photo (free license): the raw id, what it shows, and who took it. */
  photo: { src: string; alt: { es: string; en: string }; credit: string };
};

const photo = (id: string, credit: string, es: string, en: string) => ({ src: `https://images.unsplash.com/${id}`, credit, alt: { es, en } });

export const moments: Moment[] = [
  {
    slug: { es: "monitorear", en: "track" },
    rhythm: "always",
    photo: photo("photo-1747717086502-f9b2bc6bf2a2", "Julio Lopez", "Una mujer revisa su teléfono al aire libre", "A woman checks her phone outdoors"),
    deliverable: "report",
    es: {
      name: "Monitorear tu marca",
      question: "¿Qué está pasando con mi marca y mi categoría, y qué cambió?",
      summary: "Un reporte con lo que se movió, por qué y qué vigilar, cada semana, quincena o mes, comparado contra el periodo anterior."
    },
    en: {
      name: "Track your brand",
      question: "What is happening with my brand and category, and what changed?",
      summary: "A report on what moved, why and what to watch, every week, two weeks or month, compared with the previous period."
    }
  },
  {
    slug: { es: "anticipar", en: "anticipate" },
    rhythm: "always",
    photo: photo("photo-1733856395780-bc9bcf59c866", "Daniel Pichardo", "Una multitud con paraguas en una calle de Guanajuato", "A crowd with umbrellas on a street in Guanajuato"),
    deliverable: "report",
    es: {
      name: "Anticipar tendencias",
      question: "¿Qué va a importar antes de que todos hablen de eso?",
      summary: "Un radar de señales: los temas que crecen, qué tan rápido y en qué comunidades, antes de que se vuelvan masivos."
    },
    en: {
      name: "Anticipate trends",
      question: "What will matter before everyone talks about it?",
      summary: "A radar of signals: the topics that grow, how fast and in which communities, before they go mainstream."
    }
  },
  {
    slug: { es: "optimizar", en: "optimize" },
    rhythm: "always",
    photo: photo("photo-1720827965169-13ba59a6ebc8", "Eriel Ezequiel Reyes Saviñon", "Dos manos se pasan una bolsa de papel en la calle", "Two hands pass a paper bag on the street"),
    deliverable: "report",
    es: {
      name: "Mejorar la experiencia",
      question: "¿Dónde se frustra hoy tu cliente, y qué conviene arreglar primero?",
      summary: "El recorrido real de tu cliente, momento por momento: dónde se frustra, qué cambió contra el periodo anterior y qué arreglar primero."
    },
    en: {
      name: "Improve the experience",
      question: "Where does your customer get frustrated today, and what should you fix first?",
      summary: "Your customer's real journey, moment by moment: where they get frustrated, what changed since the previous period and what to fix first."
    }
  },
  {
    slug: { es: "defender", en: "defend" },
    rhythm: "project",
    photo: photo("photo-1643116712744-6ee1ee41b740", "Willo Team", "Una caja sin abrir junto a una puerta", "An unopened box by a doorway"),
    deliverable: "study",
    es: {
      name: "Defender tu lugar",
      question: "¿Qué está ganando mi competencia y dónde soy vulnerable?",
      summary: "Por qué la gente se va, qué promesa del otro se siente más creíble y qué puedes reparar."
    },
    en: {
      name: "Defend your position",
      question: "What is my competitor winning and where am I exposed?",
      summary: "Why people leave, which rival promise feels more credible and what you can fix."
    }
  },
  {
    slug: { es: "lanzar", en: "launch" },
    rhythm: "project",
    photo: photo("photo-1607687441627-27b17d7e44e4", "Conor Brown", "Unas manos abren una caja de cartón nueva", "Hands opening a new cardboard box"),
    deliverable: "study",
    es: {
      name: "Lanzar algo nuevo",
      question: "¿Sobre qué territorio construyo sin sonar genérico?",
      summary: "Probamos los territorios contra la conversación real para saber cuál tiene permiso de existir."
    },
    en: {
      name: "Launch something new",
      question: "Which territory can I build on without sounding generic?",
      summary: "We test territories against real conversation to learn which one people already grant permission to."
    }
  },
  {
    slug: { es: "entrar", en: "enter" },
    rhythm: "project",
    photo: photo("photo-1584208632661-f8db31bb6489", "Roberto Carlos Román Don", "Un mercado mexicano lleno de puestos y color", "A busy, colorful Mexican market"),
    deliverable: "study",
    es: {
      name: "Entrar a un mercado",
      question: "¿Cómo funciona este mercado o esta categoría que no conozco?",
      summary: "Las reglas no escritas, quién da credibilidad y qué conviene evitar antes de llegar."
    },
    en: {
      name: "Enter a market",
      question: "How does this market or category I don't know actually work?",
      summary: "The unwritten rules, who lends credibility and what to avoid before you arrive."
    }
  },
  {
    slug: { es: "innovar", en: "innovate" },
    rhythm: "project",
    photo: photo("photo-1763951719000-661d3d50d763", "Zoshua Colah", "Manos volteando tortillas en un comal", "Hands turning tortillas on a griddle"),
    deliverable: "study",
    es: {
      name: "Encontrar qué innovar",
      question: "¿Qué necesidad sigue sin resolverse?",
      summary: "Lo que la gente ya intenta resolver mal con lo que existe, y dónde hay espacio para algo nuevo."
    },
    en: {
      name: "Find what to innovate",
      question: "Which need is still unmet?",
      summary: "What people already try to solve badly with what exists, and where there is room for something new."
    }
  },
  {
    slug: { es: "planear", en: "plan" },
    rhythm: "always",
    photo: photo("photo-1586936893354-362ad6ae47ba", "UX Indonesia", "Un equipo acomoda notas adhesivas sobre una mesa", "A team arranging sticky notes on a table"),
    deliverable: "plan",
    es: {
      name: "Planear el año",
      question: "¿Cómo tengo una respuesta antes de cada decisión del año?",
      summary: "Un plan de estudios colocado en los momentos que importan: lanzamientos, campañas y temporadas."
    },
    en: {
      name: "Plan the year",
      question: "How do I get an answer before every decision this year?",
      summary: "A plan of studies placed at the moments that matter: launches, campaigns and seasons."
    }
  }
];
