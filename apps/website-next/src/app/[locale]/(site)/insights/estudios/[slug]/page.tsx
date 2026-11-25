import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDown, ArrowRight, MediaVideo, MultiplePages } from "iconoir-react";
import { SourceIcon, SourceMark, sourceLabel } from "@/components/brand/SourceMark";
import { MethodChip } from "@/components/methods/MethodChip";
import { JsonLd } from "@/components/seo/JsonLd";
import { studyCover, studyHero } from "@/components/studies/items";
import styles from "@/components/studies/study.module.css";
import { Button } from "@/components/ui/Button";
import ui from "@/components/ui/ui.module.css";
import { methodKeyByName, methodSheet } from "@/content/pages/method-sheet";
import { studiesPage } from "@/content/pages/studies";
import { getStory } from "@/content/stories";
import { deckFor, getStudies, getStudy, studyStoryIds } from "@/content/studies";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { articleNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

type Params = { locale: string; slug: string };

// Studies published after the deploy render on their first visit and stay cached until the next publish.
export const dynamicParams = true;

export async function generateStaticParams() {
  const studies = await getStudies({ strict: true });
  return routing.locales.flatMap((locale) => studies.map((study) => ({ locale, slug: study.id })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const study = await getStudy(slug, { strict: true });
  if (!study) return {};
  return pageMetadata(`/insights/estudios/${study.id}`, locale);
}

/**
 * The page of a study: what it is about, what it found, a voice, how it was done, and the way
 * into the full study. It reads like the rest of the site: one idea per band, generous space, the
 * study's own image in the hero (the deck's cover until it has one).
 */
export default async function StudyPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const study = await getStudy(slug, { strict: true });
  if (!study) notFound();
  const lang = locale === "en" ? "en" : "es";
  const intl = lang === "en" ? "en-US" : "es-MX";
  const c = studiesPage[lang];
  const s = study.summary[lang];
  const t = await getTranslations({ locale, namespace: "industries" });
  const industry = t.has(study.industry) ? t(study.industry) : study.industry;
  const cover = studyCover(study);
  const hero = studyHero(study);
  const method = methodKeyByName(study.method);
  const language = c.languages[(await deckFor(study, locale)) === "en" ? "en" : study.fullLanguage];
  const period = s.period_label ?? study.periodLabel;
  const mentions = study.base.mentions ? c.mentions(new Intl.NumberFormat(intl).format(study.base.mentions)) : null;
  const viewer = { pathname: "/insights/estudios/[slug]/completo", params: { slug: study.id } } as const;
  const findingsId = lang === "en" ? "findings" : "hallazgos";

  const pieces = (await Promise.all((await studyStoryIds(study.id)).map((id) => getStory(id)))).flatMap((story) => (story ? [story] : []));

  const id = `/insights/estudios/${study.id}`;
  const jsonLd = await pageGraph(id, locale, {
    nodes: [
      await articleNode(id, locale, {
        type: ["Article", "Report"],
        headline: s.title,
        description: s.dek,
        datePublished: study.publishedAt?.slice(0, 10),
        image: hero ?? cover ?? undefined,
        extra: { keywords: [study.method, industry, ...study.markets.map((m) => c.markets[m])].filter(Boolean).join(", ") }
      })
    ]
  });

  return (
    <article className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroText} data-reveal>
            <p className={styles.eyebrow}>
              <span className={study.draft ? styles.pillDraft : styles.pill}>{study.draft ? c.draft : c.eyebrow}</span>
              <span>
                {industry} · {c.marketSummary(study.markets)}
              </span>
            </p>
            <h1 className={styles.title}>{s.title}</h1>
            <p className={styles.dek}>{s.dek}</p>
            <div className={styles.ctas}>
              <Button href={viewer} arrow>
                {c.fullCta}
              </Button>
              <a href={`#${findingsId}`} className={`${ui.button} ${ui["button-secondary"]}`}>
                {c.findingsCta}
                <ArrowDown aria-hidden className={ui.buttonIcon} />
              </a>
            </div>
            <p className={styles.fullMeta}>
              <MultiplePages aria-hidden /> {c.fullMeta(study.slideCount, language, study.accessMode)}
            </p>
          </div>

          <div className={styles.visual} data-reveal>
            {hero ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.heroImage} src={hero} alt={s.image_alt ?? ""} fetchPriority="high" />
            ) : cover ? (
              <Link href={viewer} className={styles.deckCard} aria-label={c.fullCta}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover} alt="" fetchPriority="high" />
                <span className={styles.deckBadge}>
                  <MultiplePages aria-hidden /> {c.slides(study.slideCount)}
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <section className={styles.band} id={findingsId}>
        <div className={styles.findingsGrid}>
          <div className={styles.findingsHead} data-reveal>
            <h2 className={styles.h2}>{c.findingsTitle}</h2>
          </div>
          <ol className={styles.findings}>
            {s.findings.map((finding, i) => (
              <li key={i} className={styles.finding} data-reveal>
                <span className={styles.number} aria-hidden>
                  {i + 1}
                </span>
                <p>{finding}</p>
              </li>
            ))}
          </ol>
        </div>

        <ul className={styles.stats} data-reveal>
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
        <section className={styles.voiceBand} data-reveal>
          <h2 className={styles.h2Center}>{c.voiceTitle}</h2>
          <figure className={styles.post}>
            <figcaption className={styles.postSource}>
              <SourceIcon name={s.quote.platform} size={20} />
              <span>{sourceLabel(s.quote.platform, locale)}</span>
              <span className={styles.postDate}>· {s.quote.date}</span>
            </figcaption>
            <blockquote className={styles.bubble}>{s.quote.text}</blockquote>
            {s.quote.translation ? <p className={styles.translation}>{s.quote.translation}</p> : null}
          </figure>
        </section>
      ) : null}

      <section className={styles.band}>
        <div className={styles.methodGrid}>
          <div className={styles.methodText} data-reveal>
            <h2 className={styles.h2}>{c.methodTitle}</h2>
            {method ? <p className={styles.methodQuestion}>{methodSheet[method][lang].question}</p> : null}
            <p className={styles.body}>{s.method_note}</p>
          </div>
          <dl className={styles.facts} data-reveal>
            <div>
              <dt>{c.facts.method}</dt>
              <dd>{method ? <MethodChip method={method} locale={locale} /> : study.method}</dd>
            </div>
            <div>
              <dt>{c.facts.markets}</dt>
              <dd>{c.marketList(study.markets)}</dd>
            </div>
            {period ? (
              <div>
                <dt>{c.facts.period}</dt>
                <dd>{period}</dd>
              </div>
            ) : null}
            {mentions ? (
              <div>
                <dt>{c.facts.base}</dt>
                <dd>{mentions}</dd>
              </div>
            ) : null}
            {study.base.channels?.length ? (
              <div>
                <dt>{c.facts.channels}</dt>
                <dd className={styles.channels}>
                  {study.base.channels.map((channel) => (
                    <SourceMark key={channel} name={channel} locale={locale} className={styles.channel} />
                  ))}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{c.facts.language}</dt>
              <dd>{c.fullMeta(study.slideCount, language, "abierto")}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.band}>
        <div className={hero && cover ? styles.fullCard : styles.fullCardText} data-reveal>
          {hero && cover ? (
            <Link href={viewer} className={styles.fullCover} tabIndex={-1} aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover} alt="" loading="lazy" />
            </Link>
          ) : null}
          <div className={styles.fullText}>
            <h2 className={styles.h2}>{c.fullTitle}</h2>
            <p className={styles.body}>{c.fullText(study.slideCount, language)}</p>
            <Button href={viewer} arrow>
              {c.fullCta}
            </Button>
            {study.accessMode !== "abierto" ? <p className={styles.note}>{c.accessNote[study.accessMode]}</p> : null}
          </div>
        </div>
      </section>

      {pieces.length ? (
        <section className={styles.band} data-reveal>
          <div className={styles.sectionHead}>
            <h2 className={styles.h2}>{c.piecesTitle}</h2>
            <p className={styles.body}>{c.piecesLead}</p>
          </div>
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

      <div className={styles.more} data-reveal>
        <Button href="/insights/estudios" variant="secondary" arrow>
          {c.moreStudies}
        </Button>
      </div>
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </article>
  );
}
