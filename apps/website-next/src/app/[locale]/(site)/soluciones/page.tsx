import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Calendar, Community, Journal, MediaVideo, Megaphone, Page, Presentation, ProfileCircle, StatsUpSquare } from "iconoir-react";
import { BlockView } from "@/components/blocks/Blocks";
import { SituationGallery } from "@/components/home/SituationGallery";
import { SquareMotion } from "@/components/motion/SquareMotion";
import { PhoneStory } from "@/components/offer/PhoneStory";
import { getFeedStories } from "@/components/feed/feed-data";
import { OFFER, PlanComposition, ReportComposition, StudyComposition } from "@/motion/OfferCompositions";
import { offer } from "@/content/pages/offer";
import { solutionsIndex } from "@/content/pages/solutions";
import { moments } from "@/content/moments";
import { pick } from "@/content/pages/registry";
import { pageMetadata } from "@/lib/page-meta";
import styles from "@/components/offer/offer.module.css";

const paths = { es: "/soluciones", en: "/solutions" };

const WATCH_ICONS = { brand: ProfileCircle, competitors: Community, category: StatsUpSquare, campaigns: Megaphone, topics: Journal } as const;
const FORMAT_ICONS = { live: Presentation, document: Page, stories: MediaVideo } as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(pick(solutionsIndex, locale), locale, paths);
}

export default async function Page_({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = offer[lang];
  const rest = pick(solutionsIndex, locale).blocks;
  const base = lang === "en" ? "/en/solutions" : "/soluciones";
  const story = (await getFeedStories(locale)).find((s) => s.kind === "editorial");
  const deliverable = { report: c.labels.report, study: c.labels.study, plan: c.labels.plan };
  const studyMoments = moments.filter((moment) => moment.deliverable === "study");

  return (
    <article className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.h1}>{c.title}</h1>
        <p className={styles.lead}>{c.lead}</p>
        <nav className={styles.jump}>
          <a href="#reporte">
            <Calendar aria-hidden /> {c.jump.report}
          </a>
          <a href="#estudio">
            <Journal aria-hidden /> {c.jump.study}
          </a>
          <a href="#plan">
            <StatsUpSquare aria-hidden /> {c.jump.plan}
          </a>
        </nav>
      </header>

      {/* report */}
      <section id="reporte" className={styles.row}>
        <div className={styles.copy}>
          <h2 className={styles.h2}>{c.report.name}</h2>
          <p className={styles.tagline}>{c.report.title}</p>
          <p className={styles.text}>{c.report.text}</p>
          <h3 className={styles.h3}>{c.report.watchTitle}</h3>
          <ul className={styles.watch}>
            {c.report.watch.map((item) => {
              const Icon = WATCH_ICONS[item.icon];
              return (
                <li key={item.name}>
                  <span className={styles.icon} aria-hidden>
                    <Icon />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    {item.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <SquareMotion frames={OFFER.frames} poster={260} label={c.report.title} className={styles.motion}>
          <ReportComposition copy={c.report.motion} />
        </SquareMotion>
      </section>

      {/* study */}
      <section id="estudio" className={`${styles.row} ${styles.flip}`}>
        <div className={styles.copy}>
          <h2 className={styles.h2}>{c.study.name}</h2>
          <p className={styles.tagline}>{c.study.title}</p>
          <p className={styles.text}>{c.study.text}</p>
          <h3 className={styles.h3}>{c.study.situationsTitle}</h3>
          <ul className={styles.situations}>
            {studyMoments.map((moment) => (
              <li key={moment.slug.es}>
                <a href={`${base}/${moment.slug[lang]}`}>
                  <span>
                    <strong>{moment[lang].name}</strong>
                    {moment[lang].question}
                  </span>
                  <ArrowRight aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <SquareMotion frames={OFFER.frames} poster={260} label={c.study.title} className={styles.motion}>
          <StudyComposition copy={c.study.motion} />
        </SquareMotion>
      </section>

      {/* plan */}
      <section id="plan" className={styles.row}>
        <div className={styles.copy}>
          <h2 className={styles.h2}>{c.plan.name}</h2>
          <p className={styles.tagline}>{c.plan.title}</p>
          <p className={styles.text}>{c.plan.text}</p>
        </div>
        <SquareMotion frames={OFFER.frames} poster={270} label={c.plan.title} className={styles.motion}>
          <PlanComposition copy={c.plan.motion} />
        </SquareMotion>
      </section>

      {/* formats */}
      <section className={styles.formats}>
        <div className={styles.formatsHead}>
          <h2 className={styles.h2}>{c.formats.title}</h2>
          <p className={styles.text}>{c.formats.lead}</p>
        </div>
        <div className={styles.formatsBody}>
          <ul className={styles.formatList}>
            {c.formats.items.map((item) => {
              const Icon = FORMAT_ICONS[item.key];
              return (
                <li key={item.key}>
                  <span className={styles.icon} aria-hidden>
                    <Icon />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    {item.text}
                  </span>
                </li>
              );
            })}
          </ul>
          {story ? <PhoneStory story={story} /> : null}
        </div>
      </section>

      {/* situations */}
      <section className={styles.block}>
        <h2 className={styles.h2}>{c.situations.title}</h2>
        <p className={styles.text}>{c.situations.lead}</p>
        <div className={styles.gallery}>
          <SituationGallery
            items={moments.map((moment) => ({
              href: `${base}/${moment.slug[lang]}`,
              name: moment[lang].name,
              question: moment[lang].question,
              summary: moment[lang].summary,
              deliverable: deliverable[moment.deliverable],
              photo: { src: moment.photo.src, alt: moment.photo.alt[lang], credit: moment.photo.credit }
            }))}
            labels={c.labels}
          />
        </div>
      </section>

      <div className={styles.rest}>
        {rest.map((block, i) => (
          <section key={i}>
            <BlockView block={block} />
          </section>
        ))}
      </div>
    </article>
  );
}
