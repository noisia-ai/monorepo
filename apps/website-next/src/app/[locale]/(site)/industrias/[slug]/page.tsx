import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { SetAlternate } from "@/components/layout/alternate";
import { StoryPreview } from "@/components/home/StoryPreview";
import { getFeedStories } from "@/components/feed/feed-data";
import { industryEntries } from "@/content/pages/industries";
import { routing } from "@/i18n/routing";
import styles from "@/components/industry/industry.module.css";

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
    }
  };
}

export default async function IndustryPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = find(locale, slug);
  if (!entry) notFound();
  const t = await getTranslations("industryPage");
  const copy = locale === "en" ? entry.en : entry.es;
  const stories = (await getFeedStories(locale)).filter((story) => entry.storyIndustries.includes(story.industry)).slice(0, 4);
  const alternate = locale === "en" ? `/industrias/${entry.slug.es}` : `/en/industries/${entry.slug.en}`;
  const feedHref = `${locale === "en" ? "/en" : ""}/insights?industria=${entry.storyIndustries[0] ?? ""}`;
  return (
    <div className={styles.page}>
      <SetAlternate href={alternate} />
      <header className={styles.header}>
        <span className={styles.name}>{copy.name}</span>
        <h1 className={styles.h1}>{copy.title}</h1>
        <p className={styles.lead}>{copy.lead}</p>
      </header>

      <section>
        <h2 className={styles.h2}>{t("questions")}</h2>
        <ul className={styles.questions}>
          {copy.questions.map((question) => (
            <li key={question.text} className={styles.question}>
              <span className={styles.moment}>{question.moment}</span>
              <p className={styles.questionText}>{question.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {copy.where.length ? (
        <section>
          <h2 className={styles.h2}>{t("where")}</h2>
          <ul className={styles.chips}>
            {copy.where.map((place) => (
              <li key={place}>{place}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {stories.length ? (
        <section>
          <h2 className={styles.h2}>{t("stories")}</h2>
          <div className={styles.stories}>
            {stories.map((story) => (
              <StoryPreview key={story.id} story={story} locale={locale} />
            ))}
          </div>
          <p style={{ marginTop: 24 }}>
            <a href={feedHref} style={{ color: "var(--teal)" }}>
              {t("seeFeed")} →
            </a>
          </p>
        </section>
      ) : null}

      <section className={styles.cta}>
        <h2 className={styles.h2}>{t("ctaTitle")}</h2>
        <p className={styles.lead}>{t("ctaText")}</p>
        <Button href="/taller" arrow>
          {t("ctaLabel")}
        </Button>
      </section>
    </div>
  );
}
