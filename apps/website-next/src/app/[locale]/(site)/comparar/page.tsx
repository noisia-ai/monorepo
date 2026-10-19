import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Logo } from "@/components/brand/Logo";
import { Faq } from "@/components/ui/Faq";
import { LearnCta, LearnHero, SectionHead } from "@/components/learn/Learn";
import { COMPARE_ICONS } from "@/components/learn/icons";
import { compareEntries, compareUi } from "@/content/pages/compare";
import { Link } from "@/i18n/navigation";
import styles from "@/components/learn/learn.module.css";
import { JsonLd } from "@/components/seo/JsonLd";
import { childItems, itemListNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/comparar", locale);
}

export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = compareUi[lang];
  const Us = COMPARE_ICONS.us;
  const jsonLd = pageGraph("/comparar", locale, { type: "CollectionPage", nodes: [itemListNode("/comparar", locale, childItems("/comparar", locale))] });

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <LearnHero title={c.title} lead={c.lead} />
        <ul className={styles.tiles}>
          {compareEntries.map((entry, i) => {
            const Icon = COMPARE_ICONS[entry.kind];
            return (
              <li key={entry.kind} data-reveal style={{ "--reveal-delay": `${i * 50}ms` } as CSSProperties}>
                <Link href={{ pathname: "/comparar/[slug]", params: { slug: entry.slug[lang] } }} className={styles.tile}>
                  <span className={styles.tileIcon} aria-hidden>
                    <Icon />
                  </span>
                  <span className={styles.tileName}>{c.names[entry.kind]}</span>
                  <span className={styles.tileText}>{entry.summary[lang]}</span>
                  <span className={styles.tileMeta}>{c.open} →</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.glanceTitle} lead={c.glanceLead} />
        <ul className={styles.glance}>
          <li className={styles.glanceUs}>
            <span className={styles.iconBadge} aria-hidden>
              <Us />
            </span>
            <span className={styles.glanceName}>
              <Logo height={20} />
            </span>
            <span className={styles.glanceAnswer}>{c.glance.us}</span>
          </li>
          {compareEntries.map((entry) => {
            const Icon = COMPARE_ICONS[entry.kind];
            return (
              <li key={entry.kind} className={styles.glanceRow}>
                <span className={styles.iconBadgeMuted} aria-hidden>
                  <Icon />
                </span>
                <span className={styles.glanceName}>{c.names[entry.kind]}</span>
                <span className={styles.glanceAnswer}>{c.glance[entry.kind]}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.faqTitle} />
        <Faq items={c.indexFaq} />
      </section>

      <LearnCta title={c.ctaTitle} text={c.ctaText} label={c.ctaLabel} />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </div>
  );
}
