import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Calendar, Journal, StatsUpSquare } from "iconoir-react";
import { BlockView } from "@/components/blocks/Blocks";
import { SituationGallery } from "@/components/home/SituationGallery";
import { Faq } from "@/components/ui/Faq";
import { FormatShowcase } from "@/components/offer/FormatShowcase";
import { ProductMotion } from "@/components/offer/ProductMotion";
import { getFeedStories } from "@/components/feed/feed-data";
import { offer } from "@/content/pages/offer";
import { solutionsIndex } from "@/content/pages/solutions";
import { moments } from "@/content/moments";
import { pick } from "@/content/pages/registry";
import { pageMetadata } from "@/lib/page-meta";
import styles from "@/components/offer/offer.module.css";

const paths = { es: "/soluciones", en: "/solutions" };
const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(pick(solutionsIndex, locale), locale, paths);
}

export default async function Page_({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = offer[lang];
  const base = lang === "en" ? "/en/solutions" : "/soluciones";
  const story = (await getFeedStories(locale)).find((s) => s.kind === "editorial");
  const deliverable = { report: c.labels.report, study: c.labels.study, plan: c.labels.plan };

  return (
    <article className={styles.page}>
      <header className={styles.hero} data-reveal>
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

      {/* One product per section: name, promise, two sentences and its own animation. */}
      <section id="reporte" className={styles.product}>
        <div className={styles.productHead} data-reveal>
          <h2 className={styles.productName}>{c.report.name}</h2>
          <p className={styles.promise}>{c.report.promise}</p>
          <p className={styles.productText}>{c.report.text}</p>
        </div>
        <div data-reveal style={delay(140)}>
          <ProductMotion kind="report" copy={c.report.animation} label={`${c.report.name}. ${c.report.promise}`} />
        </div>
      </section>

      <section id="estudio" className={styles.product}>
        <div className={styles.productHead} data-reveal>
          <h2 className={styles.productName}>{c.study.name}</h2>
          <p className={styles.promise}>{c.study.promise}</p>
          <p className={styles.productText}>{c.study.text}</p>
        </div>
        <div data-reveal style={delay(140)}>
          <ProductMotion kind="study" copy={c.study.animation} label={`${c.study.name}. ${c.study.promise}`} />
        </div>
      </section>

      <section id="plan" className={styles.product}>
        <div className={styles.productHead} data-reveal>
          <h2 className={styles.productName}>{c.plan.name}</h2>
          <p className={styles.promise}>{c.plan.promise}</p>
          <p className={styles.productText}>{c.plan.text}</p>
        </div>
        <div data-reveal style={delay(140)}>
          <ProductMotion kind="plan" copy={c.plan.animation} label={`${c.plan.name}. ${c.plan.promise}`} />
        </div>
      </section>

      <section className={styles.formats}>
        <div className={styles.sectionHead} data-reveal>
          <h2 className={styles.h2}>{c.formats.title}</h2>
          <p className={styles.sectionLead}>{c.formats.lead}</p>
        </div>
        <div data-reveal style={delay(140)}>
          <FormatShowcase items={c.formats.items} mock={c.formats.mock} story={story} label={c.formats.title} reply={c.formats.reply} />
        </div>
      </section>

      <section className={styles.situations}>
        <div className={styles.sectionHead} data-reveal>
          <h2 className={styles.h2}>{c.situations.title}</h2>
          <p className={styles.sectionLead}>{c.situations.lead}</p>
        </div>
        <div data-reveal style={delay(140)}>
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

      <section className={styles.start} data-reveal>
        <BlockView block={c.start} />
      </section>

      <section className={styles.faq}>
        <h2 className={styles.h2} data-reveal>
          {c.faq.title}
        </h2>
        <div data-reveal style={delay(120)}>
          <Faq items={c.faq.items} />
        </div>
      </section>

      <section data-reveal>
        <BlockView block={c.cta} />
      </section>
    </article>
  );
}
