import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Calendar, Journal } from "iconoir-react";
import { BlockView } from "@/components/blocks/Blocks";
import { SetAlternate } from "@/components/layout/alternate";
import { Button } from "@/components/ui/Button";
import { SituationGallery } from "@/components/home/SituationGallery";
import { SituationMotion } from "@/components/situation/SituationMotion";
import { TeamOutputs } from "@/components/situation/TeamOutputs";
import { momentLabels, situationCopy, solutionEntries } from "@/content/pages/solutions";
import { situationDiagram, situationLabels, situationTeams, teamNames } from "@/content/pages/situations";
import { offer } from "@/content/pages/offer";
import { moments } from "@/content/moments";
import { findEntry, pick } from "@/content/pages/registry";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-meta";
import styles from "@/components/situation/situation.module.css";

type Params = { locale: string; slug: string };

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
  const entry = findEntry(solutionEntries, locale, slug);
  const moment = moments.find((mo) => mo.slug[lang] === slug);
  if (!entry || !moment) notFound();
  const key = moment.slug.es;
  const c = situationCopy[key]?.[lang];
  if (!c) notFound();
  const l = situationLabels[lang];
  const ml = momentLabels[lang];
  const diagram = situationDiagram(key, lang);
  const teams = situationTeams[key]?.[lang] ?? [];
  const deliverable = { report: offer[lang].labels.report, study: offer[lang].labels.study, plan: offer[lang].labels.plan };
  const base = lang === "en" ? "/en/solutions" : "/soluciones";
  const alternate = locale === "en" ? `/soluciones/${moment.slug.es}` : `/en/solutions/${moment.slug.en}`;
  const others = moments.filter((mo) => mo.slug.es !== key);

  return (
    <article className={styles.page}>
      <SetAlternate href={alternate} />

      {/* the same photo as the card that brought the reader here */}
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.meta}>
            <span className={styles.tag} data-rhythm={moment.rhythm}>
              {moment.rhythm === "always" ? <Calendar aria-hidden /> : <Journal aria-hidden />}
              {moment.rhythm === "always" ? l.always : l.project}
            </span>
            <span className={styles.tagSoft}>{deliverable[moment.deliverable]}</span>
          </p>
          <h1 className={styles.h1}>{moment[lang].question}</h1>
          <p className={styles.lead}>{moment[lang].summary}</p>
          <Button href="/taller" arrow>
            {ml.ctaLabel}
          </Button>
        </div>
        <figure className={styles.photo}>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote Unsplash image with its own CDN sizing */}
          <img src={`${moment.photo.src}?w=1400&h=1600&fit=crop&auto=format&q=70`} alt={moment.photo.alt[lang]} />
          <figcaption>{moment[lang].name}</figcaption>
        </figure>
      </header>

      {/* how we solve it: the situation, the diagram, the methods */}
      <section className={styles.how}>
        <div className={styles.howText}>
          <h2 className={styles.h2}>{l.how}</h2>
          {c.situation.map((p, i) => (
            <p key={i} className={styles.text}>
              {p}
            </p>
          ))}
          <h3 className={styles.h3}>{l.methods}</h3>
          <ul className={styles.methods}>
            {c.methods.map((method) => (
              <li key={method.label}>
                <a href={method.href}>
                  <span>
                    <strong>{method.label}</strong>
                    {method.text}
                  </span>
                  <ArrowRight aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
        {diagram ? <SituationMotion diagram={diagram} label={l.how} className={styles.motion} /> : null}
      </section>

      <section>
        <BlockView block={{ type: "cards", title: ml.lookAt, items: c.lookAt }} />
      </section>

      {teams.length ? (
        <section className={styles.teamsSection}>
          <h2 className={styles.h2}>{l.teams}</h2>
          <p className={styles.text}>{l.teamsLead}</p>
          <TeamOutputs teams={teams} names={teamNames[lang]} labels={{ asks: l.asks, gets: l.gets, title: l.teams }} />
        </section>
      ) : null}

      <section>
        <BlockView block={{ type: "cards", title: ml.receive, items: c.receive }} />
      </section>

      <section>
        <BlockView block={{ type: "callout", title: c.exampleTitle ?? ml.example, text: c.example }} />
      </section>

      <section>
        <BlockView block={{ type: "faq", title: ml.faq, items: c.faq }} />
      </section>

      <section className={styles.others}>
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

      <section>
        <BlockView block={{ type: "cta", title: ml.ctaTitle, text: ml.ctaText, label: ml.ctaLabel, href: ml.ctaHref }} />
      </section>
    </article>
  );
}
