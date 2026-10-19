import type { ProcessCopy } from "@/motion/ProcessComposition";
import { howItWorks } from "./howItWorks";

// Copy of the "from question to answer" animation. It lives with the How it works page
// (hero.process); this export keeps older imports working. The example is illustration.
export const processCopy: Record<"es" | "en", ProcessCopy> = {
  es: howItWorks.es.hero.process,
  en: howItWorks.en.hero.process
};
