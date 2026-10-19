import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ArrowUnion, ChatBubbleQuestion, UserBadgeCheck } from "iconoir-react";
import { Button } from "@/components/ui/Button";
import { Faq } from "@/components/ui/Faq";
import { ProcessMotion } from "@/components/motion/ProcessMotion";
import { HowFeature } from "@/components/how/HowFeature";
import { HowMotion } from "@/components/how/HowMotion";
import { MethodChip } from "@/components/methods/MethodChip";
import { methodOrder } from "@/content/pages/method-sheet";
import { howItWorks } from "@/content/pages/howItWorks";
import styles from "@/components/how/how.module.css";
import { JsonLd } from "@/components/seo/JsonLd";
import { ORG_ID } from "@/lib/seo/config";
import { pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

const POINT_ICONS = [ChatBubbleQuestion, ArrowUnion, UserBadgeCheck];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/como-funciona", locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = howItWorks[locale === "en" ? "en" : "es"];

  const jsonLd = pageGraph("/como-funciona", locale, { page: { about: { "@id": ORG_ID } } });

  return (
    <article className={styles.page}>
      {/* One sentence of what we do, then the whole path in one animation. */}
      <header className={styles.hero}>
        <div className={styles.heroText} data-reveal>
          <h1 className={styles.heroTitle}>
            {/* each sentence on its own line where there is room */}
            {c.hero.title.split(/(?<=\.) /).map((sentence) => (
              <span key={sentence} className={styles.heroLine}>
                {sentence}{" "}
              </span>
            ))}
          </h1>
          <p className={styles.heroLead}>{c.hero.lead}</p>
        </div>
        <div className={styles.heroMotion} data-reveal style={{ "--reveal-delay": "160ms" } as CSSProperties}>
          <ProcessMotion copy={c.hero.process} label={c.hero.title} />
        </div>
      </header>

      <HowFeature title={c.sources.title} lead={c.sources.lead} media={<HowMotion name="hub" copy={c.sources.motion} label={c.sources.title} />} />

      <HowFeature
        title={c.architect.title}
        lead={c.architect.lead}
        flip
        media={<HowMotion name="architect" copy={c.architect.motion} label={c.architect.title} />}
      >
        <ul className={styles.points}>
          {c.architect.points.map((point, i) => {
            const Icon = POINT_ICONS[i]!;
            return (
              <li key={point.name} className={styles.point}>
                <span className={styles.pointIcon} aria-hidden>
                  <Icon />
                </span>
                <span>
                  <strong className={styles.pointName}>{point.name}</strong>
                  <span className={styles.pointText}>{point.text}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </HowFeature>

      {/* A lighter band between the big pieces: the six methods as chips; each opens its sheet. */}
      <section className={`${styles.block} ${styles.band}`}>
        <div className={styles.container}>
          <div className={styles.bandInner}>
            <div className={styles.bandHead} data-reveal>
              <h2 className={styles.featureTitle}>{c.methods.title}</h2>
              <p className={styles.featureLead}>{c.methods.lead}</p>
            </div>
            <ul className={styles.chips} data-reveal style={{ "--reveal-delay": "120ms" } as CSSProperties}>
              {methodOrder.map((key) => (
                <li key={key}>
                  <MethodChip method={key} locale={locale} />
                </li>
              ))}
            </ul>
            <Button href="/metodos" variant="secondary" arrow>
              {c.methods.link}
            </Button>
          </div>
        </div>
      </section>

      <HowFeature title={c.evidence.title} lead={c.evidence.lead} media={<HowMotion name="evidence" copy={c.evidence.motion} label={c.evidence.title} />}>
        <ul className={styles.levels}>
          {c.evidence.levels.map((level, i) => (
            <li key={level.name} className={styles.level}>
              <span className={styles.levelDot} data-level={i} aria-hidden />
              <span>
                <strong className={styles.pointName}>{level.name}</strong>
                <span className={styles.pointText}>{level.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </HowFeature>

      <HowFeature title={c.views.title} lead={c.views.lead} flip media={<HowMotion name="one" copy={c.views.motion} label={c.views.title} />} />

      <section className={styles.block}>
        <div className={`${styles.container} ${styles.faqGrid}`}>
          <div className={styles.faqHead} data-reveal>
            <h2 className={styles.featureTitle}>{c.faq.title}</h2>
            <p className={styles.featureLead}>{c.faq.lead}</p>
          </div>
          <div data-reveal style={{ "--reveal-delay": "120ms" } as CSSProperties}>
            <Faq items={c.faq.items} />
          </div>
        </div>
      </section>

      <section className={styles.ctaWrap}>
        <div className={styles.container}>
          <div className={styles.cta} data-reveal>
            <h2 className={styles.ctaTitle}>{c.cta.title}</h2>
            <p className={styles.ctaText}>{c.cta.text}</p>
            <Button href="/taller" arrow>
              {c.cta.label}
            </Button>
          </div>
        </div>
      </section>
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </article>
  );
}
