"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";

type OutOfScopeItem = {
  headline: string;
  body: string;
};

type OutOfScopeProps = {
  items: OutOfScopeItem[];
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 120,
      damping: 24,
    },
  },
};

export function OutOfScope({ items }: OutOfScopeProps) {
  return (
    <motion.div
      className="out-of-scope-grid"
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
    >
      {items.map((item, idx) => (
        <motion.article
          key={item.headline}
          className="out-of-scope-card"
          variants={itemVariants}
          whileHover={{ y: -4, transition: { type: "spring", stiffness: 300, damping: 20 } }}
        >
          <div className="out-of-scope-card__top">
            <span className="out-of-scope-card__index" aria-hidden="true">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <span className="out-of-scope-card__icon" aria-hidden="true">
              <X size={14} strokeWidth={2.5} />
            </span>
          </div>
          <div className="out-of-scope-card__body">
            <h3>{item.headline}</h3>
            <p>{item.body}</p>
          </div>
        </motion.article>
      ))}
    </motion.div>
  );
}

export type { OutOfScopeItem };

export default OutOfScope;
