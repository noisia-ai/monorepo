import type { ReactNode } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ArticleToc } from "@/components/learn/ArticleToc";
import { LearnHero } from "@/components/learn/Learn";
import { LEARN_ICONS } from "@/components/learn/icons";
import { PRIVACY_EMAIL, privacy } from "@/content/pages/privacy";
import styles from "@/components/learn/learn.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const c = privacy[locale === "en" ? "en" : "es"];
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: { canonical: locale === "en" ? "/en/privacy" : "/privacidad", languages: { es: "/privacidad", en: "/en/privacy" } },
    openGraph: { title: c.metaTitle, description: c.metaDescription }
  };
}

/** The contact address becomes a mail link wherever it appears in the text. */
function withEmail(text: string): ReactNode[] {
  return text.split(PRIVACY_EMAIL).flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <a key={i} href={`mailto:${PRIVACY_EMAIL}`}>
            {PRIVACY_EMAIL}
          </a>,
          part
        ]
  );
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = privacy[locale === "en" ? "en" : "es"];

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <LearnHero title={c.title} lead={c.lead} Icon={LEARN_ICONS.shield} />
        <section aria-label={c.summaryTitle} className={styles.summary} data-reveal>
          {c.summary.map((item) => {
            const Icon = LEARN_ICONS[item.icon];
            return (
              <div key={item.name} className={styles.summaryItem}>
                <span className={styles.iconBadge} aria-hidden>
                  <Icon />
                </span>
                <h2 className={styles.h3}>{item.name}</h2>
                <p>{item.text}</p>
              </div>
            );
          })}
        </section>
      </div>

      <div className={styles.article}>
        <ArticleToc title={c.tocTitle} items={c.sections.map(({ id, title, icon }) => ({ id, title, icon }))} />
        <article className={styles.articleBody}>
          {c.sections.map((section) => {
            const Icon = LEARN_ICONS[section.icon];
            return (
              <section key={section.id} id={section.id} className={styles.articleSection}>
                <div className={styles.articleHead}>
                  <span className={styles.iconBadge} aria-hidden>
                    <Icon />
                  </span>
                  <h2 className={styles.h2Small}>{section.title}</h2>
                </div>
                {section.paragraphs.map((p) => (
                  <p key={p}>{withEmail(p)}</p>
                ))}
              </section>
            );
          })}
          <p className={styles.updated}>{c.updated}</p>
        </article>
      </div>
    </div>
  );
}
