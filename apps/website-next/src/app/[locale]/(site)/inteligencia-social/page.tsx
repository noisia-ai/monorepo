import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Xmark } from "iconoir-react";
import { SourceIcon } from "@/components/brand/SourceMark";
import { Button } from "@/components/ui/Button";
import { Faq } from "@/components/ui/Faq";
import { LearnCta, LearnHero, LinkList, SectionHead } from "@/components/learn/Learn";
import { LearnMotion } from "@/components/learn/LearnMotion";
import { LEARN_ICONS, MOMENT_ICONS } from "@/components/learn/icons";
import { socialIntelligence } from "@/content/pages/socialIntelligence";
import { compareEntries, type CompareKind } from "@/content/pages/compare";
import { moments } from "@/content/moments";
import { Link } from "@/i18n/navigation";
import styles from "@/components/learn/learn.module.css";
import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl } from "@/lib/seo/config";
import { pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/inteligencia-social", locale);
}

export default async function SocialIntelligencePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = socialIntelligence[lang];
  const Check = LEARN_ICONS.check;
  const url = absoluteUrl(lang === "en" ? "/en/social-intelligence" : "/inteligencia-social");
  const jsonLd = pageGraph("/inteligencia-social", locale, {
    page: { mainEntity: { "@id": `${url}#term` } },
    nodes: [
      {
        "@type": "DefinedTerm",
        "@id": `${url}#term`,
        name: lang === "en" ? "Social intelligence" : "Inteligencia social",
        description: c.lead,
        url,
        inDefinedTermSet: { "@id": `${url}#glossary` }
      },
      {
        "@type": "DefinedTermSet",
        "@id": `${url}#glossary`,
        name: c.glossary.title,
        url,
        hasDefinedTerm: [{ "@id": `${url}#term` }, ...c.glossary.items.map((item) => ({ "@type": "DefinedTerm", name: item.term, description: item.text }))]
      }
    ]
  });
  const compareHref = (kind: CompareKind) => {
    const entry = compareEntries.find((item) => item.kind === kind)!;
    return { pathname: "/comparar/[slug]" as const, params: { slug: entry.slug[lang] } };
  };

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <LearnHero title={c.title} lead={c.lead} />
        {/* The definition in four steps, next to the animation that plays them. */}
        <div className={styles.split} data-reveal>
          <div className={styles.splitText}>
            <h2 className={styles.h2}>{c.definition.title}</h2>
            <ol className={styles.iconList}>
              {c.definition.steps.map((step) => {
                const Icon = LEARN_ICONS[step.icon];
                return (
                  <li key={step.name} className={styles.iconItem}>
                    <span className={styles.iconBadge} aria-hidden>
                      <Icon />
                    </span>
                    <div>
                      <h3 className={styles.h3}>{step.name}</h3>
                      <p>{step.text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          <LearnMotion diagram={{ kind: "hero", copy: c.definition.motion }} label={c.definition.motionLabel} className={styles.splitMotion} />
        </div>
      </div>

      <section className={`${styles.split} ${styles.splitReverse}`} data-reveal>
        <div className={styles.splitText}>
          <h2 className={styles.h2}>{c.listening.title}</h2>
          {c.listening.paragraphs.map((p) => (
            <p key={p} className={styles.bodyText}>
              {p}
            </p>
          ))}
          <Button href={compareHref(c.listening.link.compare)} variant="secondary" arrow>
            {c.listening.link.label}
          </Button>
        </div>
        <LearnMotion diagram={{ kind: "keywords", copy: c.listening.motion }} label={c.listening.motionLabel} className={styles.splitMotion} />
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.research.title} lead={c.research.lead} />
        <div className={styles.panels}>
          <div className={styles.panel}>
            <h3 className={styles.h3}>{c.research.survey.name}</h3>
            <p>{c.research.survey.text}</p>
          </div>
          <div className={styles.panelUs}>
            <h3 className={styles.h3}>{c.research.conversation.name}</h3>
            <p>{c.research.conversation.text}</p>
          </div>
        </div>
        <Button href={compareHref(c.research.link.compare)} variant="secondary" arrow>
          {c.research.link.label}
        </Button>
      </section>

      <section className={styles.split} data-reveal>
        <div className={styles.splitText}>
          <SectionHead title={c.sources.title} lead={c.sources.lead} />
          <ul className={styles.iconList}>
            {c.sources.items.map((item) => (
              <li key={item.name} className={styles.iconItem}>
                <span className={styles.sourceBadge} aria-hidden>
                  <SourceIcon name={item.source} size={20} />
                </span>
                <div>
                  <h3 className={styles.h3}>{item.name}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <LearnMotion diagram={{ kind: "sources", copy: c.sources.motion }} label={c.sources.motionLabel} className={styles.splitMotion} />
      </section>

      <section className={`${styles.split} ${styles.splitReverse}`} data-reveal>
        <div className={styles.splitText}>
          <SectionHead title={c.can.title} lead={c.can.lead} />
          <ul className={styles.iconList}>
            {c.can.items.map((item) => (
              <li key={item.name} className={styles.iconItem}>
                <span className={styles.iconBadge} aria-hidden>
                  <Check />
                </span>
                <div>
                  <h3 className={styles.h3}>{item.name}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <LearnMotion diagram={{ kind: "understand", copy: c.can.motion }} label={c.can.motion.caption} className={styles.splitMotion} />
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.cannot.title} />
        <ul className={styles.limits}>
          {c.cannot.items.map((item) => (
            <li key={item.name} className={styles.limit}>
              <span className={styles.iconBadgeMuted} aria-hidden>
                <Xmark />
              </span>
              <h3 className={styles.h3}>{item.name}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.questions.title} lead={c.questions.lead} />
        <ul className={`${styles.questions} ${styles.questions3}`}>
          {c.questions.items.map((item, i) => {
            const moment = moments.find((m) => m.slug.es === item.moment);
            const Icon = MOMENT_ICONS[item.moment];
            if (!moment) return null;
            return (
              <li key={item.q} data-reveal style={{ "--reveal-delay": `${(i % 3) * 60}ms` } as CSSProperties}>
                <Link href={{ pathname: "/soluciones/[slug]", params: { slug: moment.slug[lang] } }} className={styles.question}>
                  <span className={styles.questionMoment}>
                    <Icon aria-hidden />
                    {moment[lang].name}
                  </span>
                  <p className={styles.questionText}>{item.q}</p>
                  <p className={styles.muted}>{item.text}</p>
                  <span className={styles.questionMore} aria-hidden>
                    {c.questions.more}
                    <ArrowRight />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.glossary.title} />
        <dl className={styles.glossary}>
          {c.glossary.items.map((item) => (
            <div key={item.term} className={styles.term}>
              <dt>{item.term}</dt>
              <dd>{item.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.faq.title} />
        <Faq items={c.faq.items} />
      </section>

      <section className={styles.section} data-reveal>
        <SectionHead title={c.more.title} />
        <LinkList items={c.more.items} />
      </section>

      <LearnCta title={c.cta.title} text={c.cta.text} label={c.cta.label} />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </div>
  );
}
