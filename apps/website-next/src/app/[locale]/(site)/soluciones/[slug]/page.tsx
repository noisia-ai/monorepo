import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Calendar, Check, Journal, StatsUpSquare, Xmark } from "iconoir-react";
import { BlockView } from "@/components/blocks/Blocks";
import { SetAlternate } from "@/components/layout/alternate";
import { Button } from "@/components/ui/Button";
import { SituationGallery } from "@/components/home/SituationGallery";
import { SituationMotion } from "@/components/situation/SituationMotion";
import { StepMethod } from "@/components/situation/StepMethod";
import { LOGO_RATIO } from "@/components/brand/Logo";
import { momentLabels, situationCopy, solutionEntries } from "@/content/pages/solutions";
import { situationDetails } from "@/content/pages/situation-details";
import { situationDiagram, situationLabels, situationStepDiagrams } from "@/content/pages/situations";
import { offer } from "@/content/pages/offer";
import { moments } from "@/content/moments";
import { findEntry, pick } from "@/content/pages/registry";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-meta";
import styles from "@/components/situation/situation.module.css";

type Params = { locale: string; slug: string };

const META_ICONS = { report: Calendar, study: Journal, plan: StatsUpSquare } as const;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => solutionEntries.map((entry) => ({ locale, slug: entry.slug[locale] })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const entry = findEntry(solutionEntries, locale, slug);
  if (!entry) return {};
  return pageMetadata(pick(entry.page, locale), locale, { es: `/soluciones/${entry.slug.es}`, en: `/solutions/${entry.slug.en}` });
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const moment = moments.find((mo) => mo.slug[lang] === slug);
  if (!moment) notFound();
  const key = moment.slug.es;
  const c = situationCopy[key]?.[lang];
  const d = situationDetails[key]?.[lang];
  if (!c || !d) notFound();
  const l = situationLabels[lang];
  const ml = momentLabels[lang];
  const hero = situationDiagram(key, lang);
  const stepDiagrams = situationStepDiagrams(key, lang);
  const deliverable = { report: offer[lang].labels.report, study: offer[lang].labels.study, plan: offer[lang].labels.plan };
  const base = lang === "en" ? "/en/solutions" : "/soluciones";
  const alternate = locale === "en" ? `/soluciones/${moment.slug.es}` : `/en/solutions/${moment.slug.en}`;
  const others = moments.filter((mo) => mo.slug.es !== key);
  const MetaIcon = META_ICONS[moment.deliverable];
  const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

  return (
    <article className={styles.page}>
      <SetAlternate href={alternate} />

      {/* hero: title, the diagram, then the summary, one quiet line of what you get, and the CTA */}
      <header className={styles.hero}>
        <h1 className={styles.h1} data-reveal>
          {moment[lang].question}
        </h1>
        {hero ? (
          <div className={styles.heroMotion} data-reveal style={delay(120)}>
            <SituationMotion diagram={hero} label={moment[lang].name} className={styles.motion} />
          </div>
        ) : null}
        <div className={styles.heroText} data-reveal style={delay(180)}>
          <p className={styles.lead}>{d.summary ?? moment[lang].summary}</p>
          <p className={styles.meta}>
            <MetaIcon aria-hidden />
            {l.meta[moment.deliverable]}
          </p>
          <Button href="/taller" arrow>
            {ml.ctaLabel}
          </Button>
        </div>
      </header>

      {/* how we solve it: three steps, each with its own diagram */}
      <section className={styles.steps}>
        <h2 className={styles.h2} data-reveal>
          {d.howTitle}
        </h2>
        {d.steps.map((step, i) => (
          <div key={step.title} className={styles.step} data-flip={i % 2 === 1}>
            <div className={styles.stepText} data-reveal>
              <span className={styles.stepNumber}>{i + 1}</span>
              <h3 className={styles.h3}>{step.title}</h3>
              <p className={styles.text}>{step.text}</p>
              {step.method ? <StepMethod method={step.method} lang={lang} label={l.method} /> : null}
            </div>
            {stepDiagrams ? (
              <div data-reveal style={delay(140)}>
                <SituationMotion diagram={stepDiagrams[i]!} label={step.title} className={styles.motion} />
              </div>
            ) : null}
          </div>
        ))}
      </section>

      {/* the difference, row by row */}
      <section className={styles.compare}>
        <h2 className={styles.h2} data-reveal>
          {d.compare.title}
        </h2>
        <div className={styles.table} role="table" aria-label={d.compare.title}>
          <div className={styles.tableHead} role="row" data-reveal>
            <span role="columnheader" />
            <span role="columnheader" className={styles.themHead}>
              {d.compare.them}
            </span>
            <span role="columnheader" className={styles.usHead}>
              {l.noisia}
            </span>
          </div>
          {d.compare.rows.map((row, i) => (
            <div key={row.label} className={styles.tableRow} role="row" data-reveal style={delay(i * 70)}>
              <span role="rowheader" className={styles.rowLabel}>
                {row.label}
              </span>
              <span role="cell" className={styles.them}>
                <Xmark aria-hidden />
                <span>
                  <em className={styles.cellName}>{d.compare.them}</em>
                  {row.them}
                </span>
              </span>
              <span role="cell" className={styles.us}>
                <Check aria-hidden />
                <span>
                  <em className={styles.cellName}>{l.noisia}</em>
                  {row.us}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* what you receive: a document mockup and its contents */}
      <section className={styles.deliverable}>
        <h2 className={styles.h2} data-reveal>
          {d.deliverable.title}
        </h2>
        <div className={styles.deliverableBody}>
          <div className={styles.doc} data-reveal aria-hidden>
            <div className={styles.docTop}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
              <img src="/brand/noisia.svg" alt="" width={92} height={Math.round(92 / LOGO_RATIO)} />
              <span>{moment[lang].name}</span>
            </div>
            <p className={styles.docTitle}>{d.deliverable.name}</p>
            {d.deliverable.items.map((item, i) => (
              <div key={item.name} className={styles.docRow}>
                <span className={styles.docIndex}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.docName}>{item.name}</span>
                <span className={styles.docBar} style={{ width: `${[78, 62, 48, 70][i] ?? 60}%` }} />
              </div>
            ))}
          </div>
          <ul className={styles.items}>
            {d.deliverable.items.map((item, i) => (
              <li key={item.name} data-reveal style={delay(i * 80)}>
                <span className={styles.itemIndex}>{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{item.name}</strong>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section data-reveal>
        <BlockView block={{ type: "faq", title: ml.faq, items: c.faq }} />
      </section>

      <section className={styles.others} data-reveal>
        <h2 className={styles.h2}>{l.others}</h2>
        <SituationGallery
          items={others.map((mo) => ({
            href: `${base}/${mo.slug[lang]}`,
            name: mo[lang].name,
            question: mo[lang].question,
            summary: mo[lang].summary,
            deliverable: deliverable[mo.deliverable],
            photo: { src: mo.photo.src, alt: mo.photo.alt[lang], credit: mo.photo.credit }
          }))}
          labels={{ more: l.more, play: l.play, pause: l.pause }}
        />
      </section>

      <section data-reveal>
        <BlockView block={{ type: "cta", title: ml.ctaTitle, text: ml.ctaText, label: ml.ctaLabel, href: ml.ctaHref }} />
      </section>
    </article>
  );
}
