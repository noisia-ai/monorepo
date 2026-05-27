"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";

export type FAQItem = {
  question: string;
  answer: string;
};

type FAQAccordionProps = {
  items: FAQItem[];
};

const springTransition = {
  type: "spring" as const,
  stiffness: 260,
  damping: 30,
  mass: 0.9
};

export function FAQAccordion({ items }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = useCallback((index: number) => {
    setOpenIndex((current) => (current === index ? null : index));
  }, []);

  return (
    <div className="faq-v2-list" role="list">
      {items.map((item, index) => (
        <FAQItemRow
          key={item.question}
          item={item}
          isOpen={openIndex === index}
          onToggle={() => toggle(index)}
        />
      ))}
    </div>
  );
}

function FAQItemRow({
  item,
  isOpen,
  onToggle
}: {
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // Measure content height on mount AND whenever it changes (responsive resize, font load, etc.)
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measure = () => setHeight(el.scrollHeight);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      className={`faq-v2-item ${isOpen ? "is-open" : ""}`}
      role="listitem"
      initial={false}
      animate={{
        backgroundColor: isOpen ? "rgba(252, 252, 252, 0.95)" : "rgba(255, 255, 255, 0.4)"
      }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        aria-expanded={isOpen}
        className="faq-v2-question"
        onClick={onToggle}
        type="button"
      >
        <span className="faq-v2-question__text">{item.question}</span>
        <motion.span
          className="faq-v2-icon"
          aria-hidden="true"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={springTransition}
        >
          <ChevronDown size={18} strokeWidth={2.5} />
        </motion.span>
      </button>

      <motion.div
        className="faq-v2-answer-wrap"
        initial={false}
        animate={{
          height: isOpen ? height : 0,
          opacity: isOpen ? 1 : 0
        }}
        transition={springTransition}
        style={{ overflow: "hidden" }}
        aria-hidden={!isOpen}
      >
        <div ref={contentRef} className="faq-v2-answer-inner">
          <p className="faq-v2-answer__text">{item.answer}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
