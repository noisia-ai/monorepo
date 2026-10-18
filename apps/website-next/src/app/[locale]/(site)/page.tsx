import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Check } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { HeroMotion } from "@/components/home/HeroMotion";
import { ProcessSteps } from "@/components/home/ProcessSteps";
import { StoryPreview } from "@/components/home/StoryPreview";
import { getFeedStories } from "@/components/feed/feed-data";
import { home } from "@/content/pages/home";
import { moments } from "@/content/moments";
import styles from "@/components/home/home.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { alternates: { canonical: locale === "en" ? "/en" : "/", languages: { es: "/", en: "/en" } } };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = home[lang];
  const stories = (await getFeedStories(locale)).filter((story) => story.kind !== "demo").slice(0, 4);
  const deliverable = { report: c.moments.report, study: c.moments.study, plan: c.moments.plan };

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroHead}>
            <p className={styles.category}>{c.hero.category}</p>
            <h1 className={styles.heroTitle}>{c.hero.title}</h1>
          </div>
          <HeroMotion copy={c.hero.motion} label={c.hero.motion.question} className={styles.heroMotion} />
          <div className={styles.heroBody}>
            <p className={styles.heroLead}>{c.hero.lead}</p>
            <div className={styles.heroActions}>
              <Button href="/taller" arrow>
                {c.hero.primary}
              </Button>
              <Button href="/insights" variant="secondary">
                {c.hero.secondary}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Section title={c.moments.title} lead={c.moments.lead}>
        <div className={styles.moments}>
          {moments.map((moment, i) => (
            <Reveal key={moment.slug.es} delay={i * 0.04}>
              <Link href={{ pathname: "/soluciones/[slug]", params: { slug: moment.slug[lang] } }} className={styles.moment}>
                <span className={styles.momentName}>{moment[lang].name}</span>
                <span className={styles.momentQuestion}>{moment[lang].question}</span>
                <span className={styles.momentFoot}>
                  {deliverable[moment.deliverable]} <ArrowRight aria-hidden />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>

      {stories.length ? (
        <Section title={c.insights.title} lead={c.insights.lead} tone="soft">
          <div className={styles.stories}>
            {stories.map((story) => (
              <StoryPreview key={story.id} story={story} locale={locale} />
            ))}
          </div>
          <div className={styles.more}>
            <Button href="/insights" variant="secondary" arrow>
              {c.insights.all}
            </Button>
          </div>
        </Section>
      ) : null}

      <Section title={c.how.title} lead={c.how.lead}>
        <ProcessSteps steps={c.how.steps} />
        <p className={styles.human}>
          <Check aria-hidden /> {c.how.human}
        </p>
        <Button href="/como-funciona" variant="text" arrow>
          {c.how.link}
        </Button>
      </Section>

      <Section title={c.methods.title} lead={c.methods.lead} tone="soft">
        <div className={styles.points}>
          {c.methods.points.map((point) => (
            <Reveal key={point.name}>
              <div className={styles.point}>
                <h3 className={styles.pointName}>{point.name}</h3>
                <p>{point.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Button href="/metodos" variant="text" arrow>
          {c.methods.link}
        </Button>
      </Section>

      <Section title={c.compare.title} lead={c.compare.lead}>
        <div className={styles.compare}>
          {c.compare.columns.map((col) => (
            <div key={col.name} className={styles.compareCol}>
              <h3 className={styles.compareName}>{col.name}</h3>
              <p>{col.does}</p>
              <p className={styles.compareMiss}>{col.misses}</p>
            </div>
          ))}
          <div className={`${styles.compareCol} ${styles.compareNoisia}`}>
            <h3 className={styles.compareName}>{c.compare.noisia.name}</h3>
            <p>{c.compare.noisia.does}</p>
          </div>
        </div>
        <Button href="/comparar" variant="text" arrow>
          {c.compare.link}
        </Button>
      </Section>

      <Section title={c.reach.title} tone="dark">
        <div className={styles.stats}>
          {c.reach.stats.map((stat) => (
            <Reveal key={stat.label}>
              <div className={styles.stat}>
                <span className={styles.statValue}>{stat.value}</span>
                <span className={styles.statLabel}>{stat.label}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

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
    </>
  );
}
