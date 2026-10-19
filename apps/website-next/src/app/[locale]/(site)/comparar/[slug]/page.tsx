import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { NavArrowRight } from "iconoir-react";
import { Logo } from "@/components/brand/Logo";
import { SetAlternate } from "@/components/layout/alternate";
import { Faq } from "@/components/ui/Faq";
import { CompareMotion } from "@/components/learn/CompareMotion";
import { LearnCta, LearnHero, SectionHead } from "@/components/learn/Learn";
import type { LearnDiagram } from "@/components/learn/LearnMotion";
import { COMPARE_ICONS } from "@/components/learn/icons";
import { compareEntries, compareMotion, compareUi, findCompare, surveyMotion, type CompareEntry } from "@/content/pages/compare";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import styles from "@/components/learn/learn.module.css";

type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => compareEntries.map((entry) => ({ locale, slug: entry.slug[locale] })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const entry = findCompare(locale, slug);
  if (!entry) return {};
  const page = entry.page[locale === "en" ? "en" : "es"];
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: {
      canonical: locale === "en" ? `/en/compare/${entry.slug.en}` : `/comparar/${entry.slug.es}`,
      languages: { es: `/comparar/${entry.slug.es}`, en: `/en/compare/${entry.slug.en}` }
    },
    openGraph: { title: page.metaTitle, description: page.metaDescription }
  };
}

function themDiagram(entry: CompareEntry, lang: "es" | "en"): LearnDiagram {
  if (entry.kind === "survey") return { kind: "survey", copy: surveyMotion[lang] };
  return { kind: "approach", mode: entry.kind, copy: compareMotion[lang] };
}

export default async function CompareDetailPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = findCompare(locale, slug);
  if (!entry) notFound();
  const lang = locale === "en" ? "en" : "es";
  const c = compareUi[lang];
  const page = entry.page[lang];
  const alternate = lang === "en" ? `/comparar/${entry.slug.es}` : `/en/compare/${entry.slug.en}`;
  const ThemIcon = COMPARE_ICONS[entry.kind];
  const UsIcon = COMPARE_ICONS.us;
  const BothIcon = COMPARE_ICONS.both;
  const others = compareEntries.filter((other) => other !== entry);

  return (
    <div className={styles.page}>
      <SetAlternate href={alternate} />
      <div className={styles.intro}>
        <LearnHero title={page.title} lead={page.lead} />
        <div data-reveal>
          <CompareMotion
            label={c.motionLabel}
            them={{ name: page.them, caption: page.takeaway.them, diagram: themDiagram(entry, lang) }}
            us={{ name: c.usName, caption: page.takeaway.us, diagram: { kind: "approach", mode: "noisia", copy: compareMotion[lang] } }}
          />
        </div>
      </div>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.criteriaTitle} lead={c.criteriaLead} />
        <div>
          <div className={styles.criteriaHead} aria-hidden>
            <span>{c.criterion}</span>
            <span>{c.names[entry.kind]}</span>
            <span>
              <Logo height={18} />
            </span>
          </div>
          <ul className={styles.criteria}>
            {page.criteria.map((row) => (
              <li key={row.name} className={styles.criterion}>
                <span className={styles.criterionName}>{row.name}</span>
                <div className={styles.criterionCells}>
                  <span className={styles.cell}>
                    <span className={styles.cellLabel}>{page.them}</span>
                    {row.them}
                  </span>
                  <span className={styles.cellUs}>
                    <span className={styles.cellLabel}>{c.usName}</span>
                    {row.us}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.whenTitle} />
        <div className={styles.whenGrid}>
          {[
            { item: page.when.them, Icon: ThemIcon, us: false },
            { item: page.when.us, Icon: UsIcon, us: true },
            { item: page.when.both, Icon: BothIcon, us: false }
          ].map(({ item, Icon, us }) => (
            <div key={item.name} className={us ? styles.whenUs : styles.when}>
              <span className={styles.whenIcon} aria-hidden>
                <Icon />
              </span>
              <h3 className={styles.h3}>{item.name}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.faqTitle} />
        <Faq items={page.faq} />
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.others} />
        <ul className={`${styles.linkList} ${styles.linkList3}`}>
          {others.map((other) => {
            const Icon = COMPARE_ICONS[other.kind];
            return (
              <li key={other.kind}>
                <Link href={{ pathname: "/comparar/[slug]", params: { slug: other.slug[lang] } }} className={styles.linkRow}>
                  <span className={styles.iconBadge} aria-hidden>
                    <Icon />
                  </span>
                  <span>
                    <span className={styles.linkLabel}>{c.names[other.kind]}</span>
                    <span className={styles.linkText}>{other.summary[lang]}</span>
                  </span>
                  <NavArrowRight className={styles.chevron} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <LearnCta title={c.ctaTitle} text={c.ctaText} label={c.ctaLabel} />
    </div>
  );
}
