import type { ProcessCopy } from "@/motion/ProcessComposition";

// Copy of the "from question to answer" animation. The example is illustrative.
export const processCopy: Record<"es" | "en", ProcessCopy> = {
  es: {
    asks: "El cliente pregunta",
    question: "¿Por qué la gente joven se está saltando el sérum?",
    clusters: ["Rutina cansada", "Precio por mililitro", "Textura", "Confianza en ingredientes", "Consejo de creadores", "Piel sensible"],
    stages: ["Toda la conversación", "Sin duplicados ni ruido", "La voz que importa"],
    steps: ["Pregunta de negocio", "Conversación cruda", "Limpieza", "Temas a escala", "Respuesta con evidencia"],
    human: "Intelligence Architect",
    answer: "La respuesta, priorizada",
    linked: "Ligada a la mención original"
  },
  en: {
    asks: "The client asks",
    question: "Why are young people skipping the serum step?",
    clusters: ["Routine fatigue", "Price per ml", "Texture", "Ingredient trust", "Creator advice", "Sensitive skin"],
    stages: ["The whole conversation", "Duplicates and noise removed", "The voice that matters"],
    steps: ["Business question", "Raw conversation", "Cleaning", "Topics at scale", "Answer with evidence"],
    human: "Intelligence Architect",
    answer: "The answer, ranked",
    linked: "Linked to the original mention"
  }
};
