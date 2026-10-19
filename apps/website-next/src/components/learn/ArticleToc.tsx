"use client";

import { useEffect, useState } from "react";
import { LEARN_ICONS, type LearnIcon } from "./icons";
import styles from "./learn.module.css";

/** Table of contents of an article; on desktop it stays in view and marks the section being read. */
export function ArticleToc({ title, items }: { title: string; items: { id: string; title: string; icon: LearnIcon }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const onScroll = () => {
      // The last heading that has passed the upper third of the screen is the current section.
      let current = items[0]?.id ?? "";
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.33) current = item.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);

  return (
    <nav className={styles.toc} aria-label={title}>
      <p className={styles.tocTitle}>{title}</p>
      <ol className={styles.tocList}>
        {items.map((item) => {
          const Icon = LEARN_ICONS[item.icon];
          return (
            <li key={item.id}>
              <a href={`#${item.id}`} className={styles.tocLink} data-active={item.id === active} aria-current={item.id === active ? "location" : undefined}>
                <Icon aria-hidden />
                {item.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
