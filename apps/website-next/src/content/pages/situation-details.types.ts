// Shape of the content of each situation page (Solutions → Track, Anticipate, ...).
// The diagrams themselves are chosen in situations.ts; this file only holds words.

export type StepCopy = {
  /** Short title of the step, a plain sentence (max ~8 words). */
  title: string;
  /** One paragraph, 2–3 sentences, concrete, about what we do in this step and why it matters. */
  text: string;
  /** Optional real method used in this step: one of the keys in METHOD_KEYS. */
  method?: MethodKey;
};

export type CompareRow = {
  /** What is compared, e.g. "Qué se lee". */
  label: string;
  /** How the usual alternative does it. */
  them: string;
  /** How Noisia does it. */
  us: string;
};

export type DeliverableItem = { name: string; text: string };

export type SituationDetail = {
  /** Title of the "how we solve it" section (can be the default "Cómo lo resolvemos"). */
  howTitle: string;
  /** Exactly three steps; each gets its own animated diagram on the page. */
  steps: [StepCopy, StepCopy, StepCopy];
  compare: {
    /** Section title, e.g. "Frente a un monitoreo con herramienta de listening". */
    title: string;
    /** Name of the usual alternative, short, e.g. "Herramienta de listening". */
    them: string;
    rows: CompareRow[];
  };
  deliverable: {
    /** Section title, e.g. "Lo que recibes cada mes". */
    title: string;
    /** Name of the deliverable shown in the mockup, e.g. "Reporte de septiembre". */
    name: string;
    items: DeliverableItem[];
  };
};

export const METHOD_KEYS = ["tb", "vpm", "cc", "dv", "jfm", "ia"] as const;
export type MethodKey = (typeof METHOD_KEYS)[number];
