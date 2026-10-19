"use client";

import { useMemo, useState } from "react";
import { ChatBubbleQuestion, Search } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import type { IndustryIcon } from "@/content/pages/industries";
import { INDUSTRY_ICONS } from "./icons";
import styles from "./learn.module.css";

export type FinderItem = { slug: string; name: string; text: string; meta: string; icon: IndustryIcon; search: string };

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** A grid of industry tiles with a search field that filters by name and by the questions inside. */
export function IndustryFinder({
  items,
  label,
  placeholder,
  empty,
  other
}: {
  items: FinderItem[];
  label: string;
  placeholder: string;
  empty: string;
  /** A last tile for whoever doesn't see their industry: it opens the workshop. */
  other: { name: string; text: string; meta: string };
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return q ? items.filter((item) => fold(item.search).includes(q)) : items;
  }, [items, query]);

  return (
    <>
      <div className={styles.search} role="search">
        <Search className={styles.searchIcon} aria-hidden />
        <input
          type="search"
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          autoComplete="off"
        />
      </div>
      {shown.length ? null : <p className={styles.empty}>{empty}</p>}
      <ul className={styles.tiles} aria-live="polite">
        {shown.map((item, i) => {
          const Icon = INDUSTRY_ICONS[item.icon];
          return (
            <li key={item.slug} data-reveal style={{ "--reveal-delay": `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}>
              <Link href={{ pathname: "/industrias/[slug]", params: { slug: item.slug } }} className={styles.tile}>
                <span className={styles.tileIcon} aria-hidden>
                  <Icon />
                </span>
                <span className={styles.tileName}>{item.name}</span>
                <span className={styles.tileText}>{item.text}</span>
                <span className={styles.tileMeta}>{item.meta}</span>
              </Link>
            </li>
          );
        })}
        <li className={styles.otherItem} data-reveal>
          <Link href="/taller" className={styles.tileOther}>
            <span className={styles.tileIcon} aria-hidden>
              <ChatBubbleQuestion />
            </span>
            <span className={styles.tileName}>{other.name}</span>
            <span className={styles.tileText}>{other.text}</span>
            <span className={styles.tileMeta}>{other.meta} →</span>
          </Link>
        </li>
      </ul>
    </>
  );
}
