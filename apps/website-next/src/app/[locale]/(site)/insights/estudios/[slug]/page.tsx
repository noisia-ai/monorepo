import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Calendar, ChatLines, Globe, MediaVideo, Reports } from "iconoir-react";
import { SourceMark, hasSourceMark } from "@/components/brand/SourceMark";
import { SectionHead } from "@/components/learn/Learn";
import { JsonLd } from "@/components/seo/JsonLd";
import { studyCover } from "@/components/studies/items";
import styles from "@/components/studies/studies.module.css";
import { Button } from "@/components/ui/Button";
import { studiesPage } from "@/content/pages/studies";
import { getStory } from "@/content/stories";
import { getStudies, getStudy, studyStoryIds } from "@/content/studies";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { articleNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

type Params = { locale: string; slug: string };

// Studies published after the deploy render on their first visit and stay cached until the next publish.
export const dynamicParams = true;

export async function generateStaticParams() {
  const studies = await getStudies();
  return routing.locales.flatMap((locale) => studies.map((study) => ({ locale, slug: study.id })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const study = await getStudy(slug);
  if (!study) return {};
  return pageMetadata(`/insights/estudios/${study.id}`, locale);
}

export default async function StudyPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const study = await getStudy(slug);
  if (!study) notFound();
  const lang = locale === "en" ? "en" : "es";
  const c = studiesPage[lang];
  const s = study.summary[lang];
  const t = await getTranslations({ locale, namespace: "industries" });
  const industry = t.has(study.industry) ? t(study.industry) : study.industry;
  const cover = studyCover(study);
  const mentions = study.base.mentions ? new Intl.NumberFormat(lang === "en" ? "en-US" : "es-MX").format(study.base.mentions) : null;
  const channels = study.base.channels?.length ? new Intl.ListFormat(lang === "en" ? "en-US" : "es-MX", { type: "conjunction" }).format(study.base.channels) : null;

  const pieces = (await Promise.all((await studyStoryIds(study.id)).map((id) => getStory(id)))).flatMap((story) => (story ? [story] : []));

  const id = `/insights/estudios/${study.id}`;
  const jsonLd = await pageGraph(id, locale, {
    nodes: [
      await articleNode(id, locale, {
        type: ["Article", "Report"],
        headline: s.title,
        description: s.dek,
        datePublished: study.publishedAt?.slice(0, 10),
        image: cover ?? undefined,
        extra: { keywords: [study.method, industry, c.markets[study.market]].filter(Boolean).join(", ") }
      })
    ]
  });

  return (
    <article className={styles.study}>
      <header className={styles.studyHero} data-reveal>
        <div className={styles.studyHeroText}>
          <span className={styles.kicker}>
            {study.draft ? <span className={styles.draft}>{c.draft}</span> : null}
            <span>
              {industry} · {c.markets[study.market]}
            </span>
          </span>
          <h1 className={styles.studyTitle}>{s.title}</h1>
          <p className={styles.studyDek}>{s.dek}</p>
          <ul className={styles.facts}>
            {study.method ? (
              <li>
                <Reports aria-hidden /> {study.method}
              </li>
            ) : null}
            {s.period_label ?? study.periodLabel ? (
              <li>
                <Calendar aria-hidden /> {s.period_label ?? study.periodLabel}
              </li>
            ) : null}
            {mentions && channels ? (
              <li>
                <ChatLines aria-hidden /> {c.baseLine(mentions, channels)}
              </li>
            ) : null}
            <li>
              <Globe aria-hidden /> {c.fullLanguage(c.languages[study.fullLanguage])}
            </li>
          </ul>
          <div className={styles.actions}>
            <Button href={{ pathname: "/insights/estudios/[slug]/completo", params: { slug: study.id } }} arrow>
              {c.fullCta}
            </Button>
            <p className={styles.actionNote}>{c.accessNote[study.accessMode]}</p>
          </div>
        </div>
        {cover ? (
          <div className={styles.studyCover}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" />
          </div>
        ) : null}
      </header>

      <section className={styles.block} data-reveal>
        <SectionHead title={c.findingsTitle} />
        <ol className={styles.findings}>
          {s.findings.map((finding, i) => (
            <li key={i} className={styles.finding}>
              <span className={styles.findingNumber} aria-hidden>
                {i + 1}
              </span>
              <span>{finding}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.block} data-reveal>
        <ul className={styles.stats}>
          {s.stats.map((stat, i) => (
            <li key={i} className={styles.stat}>
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
              <span className={styles.statBase}>{stat.base}</span>
            </li>
          ))}
        </ul>
      </section>

      {s.quote ? (
        <figure className={styles.quote} data-reveal>
          <blockquote className={styles.quoteText}>“{s.quote.text}”</blockquote>
          {s.quote.translation ? <p className={styles.quoteTranslation}>{s.quote.translation}</p> : null}
          <figcaption className={styles.quoteSource}>
            {hasSourceMark(s.quote.platform) ? <SourceMark name={s.quote.platform} locale={locale} /> : s.quote.platform} · {s.quote.date}
          </figcaption>
        </figure>
      ) : null}

      <section className={styles.block} data-reveal>
        <SectionHead title={c.methodTitle} />
        <p className={styles.method}>{s.method_note}</p>
      </section>

      {pieces.length ? (
        <section className={styles.block} data-reveal>
          <SectionHead title={c.piecesTitle} lead={c.piecesLead} />
          <ul className={styles.pieces}>
            {pieces.map((piece) => (
              <li key={piece.id}>
                <Link href={{ pathname: "/insights/[slug]", params: { slug: piece.id } }} className={styles.piece}>
                  <span className={styles.pieceIcon} aria-hidden>
                    <MediaVideo />
                  </span>
                  <span className={styles.pieceTitle}>{piece[lang].title}</span>
                  <ArrowRight className={styles.pieceArrow} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.actions} data-reveal>
        <Button href="/insights/estudios" variant="secondary" arrow>
          {c.moreStudies}
        </Button>
      </div>
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </article>
  );
}
