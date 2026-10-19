import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { JsonLd } from "@/components/seo/JsonLd";
import { ORG_ID } from "@/lib/seo/config";
import { pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { ApproachTabs } from "@/components/home/ApproachTabs";
import { ReachScroll } from "@/components/home/ReachScroll";
import { RotatingHero } from "@/components/home/RotatingHero";
import { SituationGallery } from "@/components/home/SituationGallery";
import { StoryPreview } from "@/components/home/StoryPreview";
import { SquareMotion } from "@/components/motion/SquareMotion";
import { getFeedStories } from "@/components/feed/feed-data";
import { UnderstandComposition } from "@/motion/UnderstandComposition";
import { UNDERSTAND } from "@/motion/sizes";
import { home } from "@/content/pages/home";
import { moments } from "@/content/moments";
import styles from "@/components/home/home.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/", locale);
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = home[lang];
  const stories = (await getFeedStories(locale)).filter((story) => story.kind !== "demo").slice(0, 4);
  const deliverable = { report: c.moments.report, study: c.moments.study, plan: c.moments.plan };
  const solutionsBase = lang === "en" ? "/en/solutions" : "/soluciones";

  const jsonLd = pageGraph("/", locale, { page: { about: { "@id": ORG_ID }, mainEntity: { "@id": ORG_ID } } });

  return (
    <>
      <RotatingHero copy={c.hero} labels={{ play: c.moments.play, pause: c.moments.pause }} />

      <Section title={c.moments.title} lead={c.moments.lead}>
        <SituationGallery
          items={moments.map((moment) => ({
            href: `${solutionsBase}/${moment.slug[lang]}`,
            name: moment[lang].name,
            question: moment[lang].question,
            summary: moment[lang].summary,
            deliverable: deliverable[moment.deliverable],
            photo: { src: moment.photo.src, alt: moment.photo.alt[lang], credit: moment.photo.credit }
          }))}
          labels={{ more: c.moments.more, play: c.moments.play, pause: c.moments.pause }}
        />
      </Section>

      {stories.length ? (
        <Section tone="soft">
          <div className={styles.insightsHead}>
            <div>
              <h2 className={styles.insightsTitle}>{c.insights.title}</h2>
              <p className={styles.insightsLead}>{c.insights.lead}</p>
            </div>
            <Button href="/insights" variant="secondary" arrow>
              {c.insights.all}
            </Button>
          </div>
          <div className={styles.stories}>
            {stories.map((story) => (
              <StoryPreview key={story.id} story={story} locale={locale} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={c.how.title} lead={c.how.lead}>
        <ApproachTabs tabs={c.how.tabs} motion={c.how.motion} answersLabel={lang === "en" ? "What it answers" : "Lo que responde"} label={c.how.title} />
        <div className={styles.links}>
          <Button href="/como-funciona" variant="secondary" arrow>
            {c.how.link}
          </Button>
          <Button href="/comparar" variant="secondary" arrow>
            {c.how.compareLink}
          </Button>
        </div>
      </Section>

      <Section title={c.methods.title} lead={c.methods.lead} tone="soft">
        <div className={styles.understand}>
          <SquareMotion frames={UNDERSTAND.frames} poster={300} label={c.methods.motion.caption} className={styles.understandMotion}>
            <UnderstandComposition copy={c.methods.motion} />
          </SquareMotion>
          <div className={styles.points}>
            {c.methods.points.map((point) => (
              <Reveal key={point.name}>
                <div className={styles.point}>
                  <h3 className={styles.pointName}>{point.name}</h3>
                  <p>{point.text}</p>
                </div>
              </Reveal>
            ))}
            <Button href="/metodos" variant="secondary" arrow>
              {c.methods.link}
            </Button>
          </div>
        </div>
      </Section>

      <ReachScroll copy={c.reach} beats={lang === "en" ? ["Languages", "Countries", "Time"] : ["Idiomas", "Países", "Tiempo"]} toggleLabels={{ play: c.moments.play, pause: c.moments.pause }} />

      <Section title={c.start.title} lead={c.start.lead}>
        <ol className={styles.startSteps}>
          {c.start.steps.map((step, i) => (
            <li key={step.name} className={styles.startStep}>
              <span className={styles.stepNumber}>{i + 1}</span>
              <div>
                <h3 className={styles.stepName}>{step.name}</h3>
                <p className={styles.stepText}>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Button href="/taller" arrow>
          {c.start.cta}
        </Button>
      </Section>
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </>
  );
}
