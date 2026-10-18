"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import styles from "./home.module.css";

/** Steps joined by a line that draws as the reader scrolls; each step lights up when reached. */
export function ProcessSteps({ steps }: { steps: { name: string; text: string }[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <ol ref={ref} className={styles.process}>
      <span className={styles.processTrack} aria-hidden>
        <motion.span className={styles.processFill} style={{ scaleY: reduced ? 1 : scale }} />
      </span>
      {steps.map((step, i) => (
        <Step key={step.name} index={i} total={steps.length} progress={scrollYProgress} reduced={Boolean(reduced)} step={step} />
      ))}
    </ol>
  );
}

function Step({
  index,
  total,
  progress,
  reduced,
  step
}: {
  index: number;
  total: number;
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
  reduced: boolean;
  step: { name: string; text: string };
}) {
  const at = total > 1 ? index / (total - 1) : 0;
  const on = useTransform(progress, [Math.max(0, at - 0.12), at], [0.35, 1]);
  const dot = useTransform(progress, [Math.max(0, at - 0.05), at], [1, 1.25]);
  return (
    <motion.li className={styles.processStep} style={{ opacity: reduced ? 1 : on }}>
      <motion.span className={styles.processDot} style={{ scale: reduced ? 1 : dot }} aria-hidden>
        {index + 1}
      </motion.span>
      <div>
        <h3 className={styles.stepName}>{step.name}</h3>
        <p className={styles.stepText}>{step.text}</p>
      </div>
    </motion.li>
  );
}
