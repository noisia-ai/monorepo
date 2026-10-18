/**
 * The offer, told by the job it does in the life of a brand or product.
 * Each moment maps to what the client receives: a continuous Report, a Study, or an annual plan.
 * Draft copy (18 oct 2026), to be reviewed against 06_mensaje.md.
 */
export type Moment = {
  slug: { es: string; en: string };
  deliverable: "report" | "study" | "plan";
  es: { name: string; question: string; summary: string };
  en: { name: string; question: string; summary: string };
};

export const moments: Moment[] = [
  {
    slug: { es: "monitorear", en: "track" },
    deliverable: "report",
    es: {
      name: "Monitorear",
      question: "¿Qué está pasando con mi marca y mi categoría, y qué cambió?",
      summary: "Un reporte cada mes con lo que se movió, por qué y qué vigilar, comparado contra el periodo anterior."
    },
    en: {
      name: "Track",
      question: "What is happening with my brand and category, and what changed?",
      summary: "A monthly report on what moved, why, and what to watch, compared with the previous period."
    }
  },
  {
    slug: { es: "lanzar", en: "launch" },
    deliverable: "study",
    es: {
      name: "Lanzar",
      question: "¿Sobre qué territorio construyo sin sonar genérico?",
      summary: "Probamos los territorios contra la conversación real para saber cuál tiene permiso de existir."
    },
    en: {
      name: "Launch",
      question: "Which territory can I build on without sounding generic?",
      summary: "We test territories against real conversation to learn which one people already grant permission to."
    }
  },
  {
    slug: { es: "entrar", en: "enter" },
    deliverable: "study",
    es: {
      name: "Entrar",
      question: "¿Cómo funciona este mercado o esta categoría que no conozco?",
      summary: "Las reglas no escritas, quién da credibilidad y qué conviene evitar antes de llegar."
    },
    en: {
      name: "Enter",
      question: "How does this market or category I don't know actually work?",
      summary: "The unwritten rules, who lends credibility and what to avoid before you arrive."
    }
  },
  {
    slug: { es: "defender", en: "defend" },
    deliverable: "study",
    es: {
      name: "Defender",
      question: "¿Qué está ganando mi competencia y dónde soy vulnerable?",
      summary: "Por qué la gente se va, qué promesa del otro se siente más creíble y qué puedes reparar."
    },
    en: {
      name: "Defend",
      question: "What is my competitor winning and where am I exposed?",
      summary: "Why people leave, which rival promise feels more credible and what you can fix."
    }
  },
  {
    slug: { es: "optimizar", en: "optimize" },
    deliverable: "study",
    es: {
      name: "Optimizar",
      question: "¿Dónde se rompe el camino entre la intención y la compra?",
      summary: "El recorrido real, momento por momento, y la fricción que conviene quitar primero."
    },
    en: {
      name: "Optimize",
      question: "Where does the path from intent to purchase break?",
      summary: "The real journey, moment by moment, and the friction worth removing first."
    }
  },
  {
    slug: { es: "innovar", en: "innovate" },
    deliverable: "study",
    es: {
      name: "Innovar",
      question: "¿Qué necesidad sigue sin resolverse?",
      summary: "Lo que la gente ya intenta resolver mal con lo que existe, y dónde hay espacio para algo nuevo."
    },
    en: {
      name: "Innovate",
      question: "Which need is still unmet?",
      summary: "What people already try to solve badly with what exists, and where there is room for something new."
    }
  },
  {
    slug: { es: "planear", en: "plan" },
    deliverable: "plan",
    es: {
      name: "Planear",
      question: "¿Cómo tengo una respuesta antes de cada decisión del año?",
      summary: "Un plan de estudios colocado en los momentos que importan: lanzamientos, campañas y temporadas."
    },
    en: {
      name: "Plan",
      question: "How do I get an answer before every decision this year?",
      summary: "A plan of studies placed at the moments that matter: launches, campaigns and seasons."
    }
  }
];
