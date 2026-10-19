import { MethodChip } from "@/components/methods/MethodChip";
import type { MethodKey } from "@/content/pages/situation-details.types";
import styles from "./situation.module.css";

/** The method used in one step of "how we solve it": a quiet chip that opens the method sheet. */
export function StepMethod({ method, lang, label }: { method: MethodKey; lang: "es" | "en"; label: string }) {
  return (
    <span className={styles.methodSlot}>
      <span className={styles.methodLabel}>{label}</span>
      <MethodChip method={method} locale={lang} />
    </span>
  );
}
