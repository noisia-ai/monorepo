import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowRight } from "iconoir-react";
import { Button } from "@/components/ui/Button";
import { SetAlternate } from "@/components/layout/alternate";
import { StoryPreview } from "@/components/home/StoryPreview";
import { getFeedStories } from "@/components/feed/feed-data";
import { SourceIcon, sourceLabel } from "@/components/brand/SourceMark";
import { LearnCta, LearnHero, SectionHead } from "@/components/learn/Learn";
import { INDUSTRY_ICONS, MOMENT_ICONS } from "@/components/learn/icons";
import { industriesPage, industryEntries } from "@/content/pages/industries";
import { moments } from "@/content/moments";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import styles from "@/components/learn/learn.module.css";

type Params = { locale: string; slug: string };

function find(locale: string, slug: string) {
  const lang = locale === "en" ? "en" : "es";
  return industryEntries.find((entry) => entry.slug[lang] === slug);
}

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => industryEntries.map((entry) => ({ locale, slug: entry.slug[locale] })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const entry = find(locale, slug);
  if (!entry) return {};
  const copy = locale === "en" ? entry.en : entry.es;
  return {
    title: copy.name,
    description: copy.metaDescription,
    alternates: {
      canonical: locale === "en" ? `/en/industries/${entry.slug.en}` : `/industrias/${entry.slug.es}`,
      languages: { es: `/industrias/${entry.slug.es}`, en: `/en/industries/${entry.slug.en}` }
    },
    openGraph: { title: copy.name, description: copy.metaDescription }
  };
}

export default async function IndustryPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = find(locale, slug);
  if (!entry) notFound();
  const lang = locale === "en" ? "en" : "es";
  const c = industriesPage[lang];
  const copy = entry[lang];
  const stories = (await getFeedStories(locale)).filter((story) => story.kind !== "demo" && entry.storyIndustries.includes(story.industry)).slice(0, 4);
  const alternate = lang === "en" ? `/industrias/${entry.slug.es}` : `/en/industries/${entry.slug.en}`;
  // The next four industries in the list, wrapping around, so every page links onward.
  const index = industryEntries.indexOf(entry);
  const related = [1, 2, 3, 4].map((k) => industryEntries[(index + k) % industryEntries.length]!);

  return (
    <div className={styles.page}>
      <SetAlternate href={alternate} />
      <LearnHero title={copy.name} subtitle={copy.title} lead={copy.lead} Icon={INDUSTRY_ICONS[entry.icon]} />

      <section className={styles.questionsSplit}>
        <SectionHead title={c.questions} lead={c.questionsLead} />
        <ul className={styles.questions}>
          {copy.questions.map((question, i) => {
            const moment = moments.find((m) => m.slug.es === question.moment);
            const Icon = MOMENT_ICONS[question.moment];
            const body = (
              <>
                <span className={styles.questionMoment}>
                  <Icon aria-hidden />
                  {moment ? moment[lang].name : null}
                </span>
                <p className={styles.questionText}>{question.text}</p>
                {moment ? (
                  <span className={styles.questionMore} aria-hidden>
                    {lang === "en" ? "How we solve it" : "Cómo lo resolvemos"}
                    <ArrowRight />
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={question.text} data-reveal style={{ "--reveal-delay": `${Math.min(i, 5) * 50}ms` } as CSSProperties}>
                {moment ? (
                  <Link href={{ pathname: "/soluciones/[slug]", params: { slug: moment.slug[lang] } }} className={styles.question}>
                    {body}
                  </Link>
                ) : (
                  <div className={styles.question}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {copy.where.length ? (
        <section className={styles.section} data-reveal>
          <SectionHead title={c.where} lead={c.whereLead} />
          <ul className={styles.sources}>
            {copy.where.map((place) => (
              <li key={place} className={styles.source}>
                <span className={styles.sourceIcon} aria-hidden>
                  <SourceIcon name={place} size={20} />
                </span>
                {sourceLabel(place, locale)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stories.length ? (
        <section className={styles.storiesBlock} style={{ "--head-span": stories.length >= 4 ? 4 : 4 - stories.length } as CSSProperties} data-reveal>
          <div className={styles.storiesHead}>
            <SectionHead title={c.stories} />
            <Button href={{ pathname: "/insights", query: { industria: entry.storyIndustries[0] ?? "" } }} variant="secondary" arrow>
              {c.seeFeed}
            </Button>
          </div>
          <div className={styles.stories}>
            {stories.map((story) => (
              <StoryPreview key={story.id} story={story} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section} data-reveal>
        <div className={styles.headRow}>
          <SectionHead title={c.related} />
          <Button href="/industrias" variant="secondary" arrow>
            {c.allIndustries}
          </Button>
        </div>
        <ul className={styles.tiles}>
          {related.map((other) => {
            const Icon = INDUSTRY_ICONS[other.icon];
            return (
              <li key={other.slug.es}>
                <Link href={{ pathname: "/industrias/[slug]", params: { slug: other.slug[lang] } }} className={styles.tile}>
                  <span className={styles.tileIcon} aria-hidden>
                    <Icon />
                  </span>
                  <span className={styles.tileName}>{other[lang].name}</span>
                  <span className={styles.tileMeta}>{c.questionsCount(other[lang].questions.length)}</span>
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
