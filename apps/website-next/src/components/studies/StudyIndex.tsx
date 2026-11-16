"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Lock, Page } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import type { StudyCardItem } from "./items";
import styles from "./studies.module.css";

type Labels = {
  industryLabel: string;
  marketLabel: string;
  allIndustries: string;
  allMarkets: string;
  latest: string;
  empty: string;
  expiredLink: string;
  draft: string;
};

/** Reads and writes the filters in the URL (?industria=&mercado=) so a filtered index can be shared. */
function useQueryFilter(name: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  const update = (next: string | null) => {
    setValue(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(name, next);
    else url.searchParams.delete(name);
    window.history.replaceState(null, "", url);
  };
  return [value, update];
}

function Chips({ label, all, options, active, onChange }: { label: string; all: string; options: { key: string; label: string }[]; active: string | null; onChange: (key: string | null) => void }) {
  if (options.length < 2) return null;
  return (
    <div className={styles.filterRow} role="group" aria-label={label}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.chips}>
        <button type="button" className={styles.chip} aria-pressed={active === null} onClick={() => onChange(null)}>
          {all}
        </button>
        {options.map((option) => (
          <button key={option.key} type="button" className={styles.chip} aria-pressed={active === option.key} onClick={() => onChange(active === option.key ? null : option.key)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StudyCard({ item, featured = false, labels }: { item: StudyCardItem; featured?: boolean; labels: Pick<Labels, "latest" | "draft"> }) {
  const gated = item.gated;
  return (
    <Link href={item.href} className={featured ? styles.featured : styles.card}>
      <span className={styles.cover} aria-hidden>
        {item.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.cover} alt="" loading={featured ? "eager" : "lazy"} />
        ) : (
          <span className={styles.coverFallback}>
            <Page />
          </span>
        )}
      </span>
      <span className={styles.cardBody}>
        <span className={styles.kicker}>
          {featured ? <span className={styles.latest}>{labels.latest}</span> : null}
          {item.draft ? <span className={styles.draft}>{labels.draft}</span> : null}
          <span>
            {item.industryLabel} · {item.marketLabel}
          </span>
        </span>
        <span className={styles.cardTitle}>{item.title}</span>
        <span className={styles.cardDek}>{item.dek}</span>
        <span className={styles.cardFoot}>
          <span className={styles.cardMeta}>{item.meta}</span>
          <span className={gated ? styles.badgeGated : styles.badge}>
            {gated ? <Lock aria-hidden /> : null}
            {item.badge}
          </span>
        </span>
        {featured ? <ArrowRight className={styles.featuredArrow} aria-hidden /> : null}
      </span>
    </Link>
  );
}

export function StudyIndex({ items, labels }: { items: StudyCardItem[]; labels: Labels }) {
  const [industry, setIndustry] = useQueryFilter("industria");
  const [market, setMarket] = useQueryFilter("mercado");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get("enlace") === "vencido");
  }, []);

  const industries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) seen.set(item.industry, item.industryLabel);
    return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);
  const markets = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) seen.set(item.market, item.marketLabel);
    // Mexico goes first: it is where the studies start.
    return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => (a.key === "MX" ? -1 : b.key === "MX" ? 1 : a.label.localeCompare(b.label)));
  }, [items]);

  const shown = items.filter((item) => (!industry || item.industry === industry) && (!market || item.market === market));
  const filtered = Boolean(industry || market);
  const [first, ...rest] = shown;

  return (
    <div className={styles.index}>
      {expired ? (
        <p className={styles.notice} role="status">
          {labels.expiredLink}
        </p>
      ) : null}
      <div className={styles.filters}>
        <Chips label={labels.industryLabel} all={labels.allIndustries} options={industries} active={industry} onChange={setIndustry} />
        <Chips label={labels.marketLabel} all={labels.allMarkets} options={markets} active={market} onChange={setMarket} />
      </div>
      {shown.length === 0 ? <p className={styles.empty}>{labels.empty}</p> : null}
      {first && !filtered ? <StudyCard item={first} featured labels={labels} /> : null}
      <ul className={styles.grid} aria-live="polite">
        {(filtered ? shown : rest).map((item) => (
          <li key={item.key}>
            <StudyCard item={item} labels={labels} />
          </li>
        ))}
      </ul>
    </div>
  );
}
