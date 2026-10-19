import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Book, Brain, ChatBubbleTranslate, Community, Compass, Globe, Quote, StatsUpSquare } from "iconoir-react";
import { Button } from "@/components/ui/Button";
import { Faq } from "@/components/ui/Faq";
import { MethodChip } from "@/components/methods/MethodChip";
import { MethodLibrary } from "@/components/methods/MethodLibrary";
import { MethodMotion } from "@/components/methods/MethodMotion";
import { methodsPage, type RootKey } from "@/content/pages/methods";
import styles from "@/components/methods/methods.module.css";

const paths = { es: "/metodos", en: "/methods" };
const ROOT_ICONS: Record<RootKey, typeof Globe> = { anthropology: Globe, sociology: Community, psychology: Brain, semiotics: ChatBubbleTranslate };
const LEVEL_ICONS = [StatsUpSquare, Compass, Quote];
const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const c = methodsPage[locale === "en" ? "en" : "es"];
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: { canonical: locale === "en" ? `/en${paths.en}` : paths.es, languages: { es: paths.es, en: `/en${paths.en}` } },
    openGraph: { title: c.metaTitle, description: c.metaDescription }
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = methodsPage[lang];

  return (
    <article className={styles.page}>
      {/* one topic, three reasons: counting versus understanding */}
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.h1} data-reveal>
            {c.hero.title}
          </h1>
          <p className={styles.heroLead} data-reveal style={delay(100)}>
            {c.hero.lead}
          </p>
        </div>
        <div className={styles.heroMotion} data-reveal style={delay(200)}>
          <MethodMotion diagram={{ kind: "count", copy: c.hero.motion }} label={c.hero.label} className={styles.motion} />
        </div>
      </header>

      {/* moving the number does not move the reason */}
      <section className={styles.band}>
        <div className={`${styles.inner} ${styles.split}`}>
          <div className={styles.splitText} data-reveal>
            <h2 className={styles.h2}>{c.number.title}</h2>
            <p className={styles.lead}>{c.number.lead}</p>
          </div>
          <div className={styles.splitMotion} data-reveal style={delay(120)}>
            <MethodMotion diagram={{ kind: "number", copy: c.number.motion }} label={c.number.label} className={styles.motion} />
          </div>
        </div>
      </section>

      {/* the four layers and what a brand can do in each */}
      <section className={`${styles.band} ${styles.soft}`}>
        <div className={`${styles.inner} ${styles.split} ${styles.flip}`}>
          <div className={styles.splitText}>
            <div data-reveal>
              <h2 className={styles.h2}>{c.layers.title}</h2>
              <p className={styles.lead}>{c.layers.lead}</p>
            </div>
            <ol className={styles.layers}>
              {c.layers.items.map((item, i) => (
                <li key={item.name} className={styles.layer} data-reveal style={delay(80 + i * 70)}>
                  <svg className={styles.layerRing} viewBox="0 0 40 40" aria-hidden>
                    {[6, 10.5, 15, 19].map((r, ring) => (
                      <circle key={r} cx={20} cy={20} r={r} fill="none" stroke={ring === i ? "var(--teal)" : "var(--line-strong)"} strokeWidth={ring === i ? 2.5 : 1} />
                    ))}
                    <circle cx={20} cy={20} r={2.5} fill="var(--ink)" />
                  </svg>
                  <div>
                    <h3 className={styles.layerName}>{item.name}</h3>
                    <p className={styles.layerText}>{item.text}</p>
                    <p className={styles.layerMove}>
                      <ArrowRight aria-hidden />
                      {item.move}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <div className={styles.chipRow} data-reveal>
              <span>{c.layers.methodIntro}</span>
              <MethodChip method="tb" locale={locale} />
            </div>
          </div>
          <div className={styles.splitMotion} data-reveal style={delay(120)}>
            <MethodMotion diagram={{ kind: "layers", copy: c.layers.motion }} label={c.layers.motion.caption} className={`${styles.motion} ${styles.motionWhite}`} />
          </div>
        </div>
      </section>

      {/* weight over volume, and how much to trust each finding */}
      <section className={styles.band}>
        <div className={styles.inner}>
          <div className={styles.center} data-reveal>
            <h2 className={styles.h2}>{c.weight.title}</h2>
            <p className={styles.lead}>{c.weight.lead}</p>
          </div>
          <div className={styles.centerMotion} data-reveal style={delay(120)}>
            <MethodMotion diagram={{ kind: "weight", copy: c.weight.motion }} label={c.weight.label} className={styles.motion} />
          </div>
          <h3 className={styles.levelsTitle} data-reveal>
            {c.weight.levelsTitle}
          </h3>
          <ul className={styles.levels}>
            {c.weight.levels.map((level, i) => (
              <li key={level.name} className={styles.level} data-reveal style={delay(i * 90)}>
                <span className={styles.levelIcon} aria-hidden>
                  {(() => {
                    const Icon = LEVEL_ICONS[i] ?? Quote;
                    return <Icon />;
                  })()}
                </span>
                <h4 className={styles.levelName}>{level.name}</h4>
                <p className={styles.levelText}>{level.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* where the methods come from */}
      <section className={`${styles.band} ${styles.soft}`}>
        <div className={styles.inner}>
          <div className={styles.center} data-reveal>
            <h2 className={styles.h2}>{c.roots.title}</h2>
            <p className={styles.lead}>{c.roots.lead}</p>
          </div>
          <ul className={styles.roots}>
            {c.roots.items.map((root, i) => {
              const Icon = ROOT_ICONS[root.key];
              return (
                <li key={root.key} className={styles.root} data-reveal style={delay(i * 80)}>
                  <span className={styles.rootIcon} aria-hidden>
                    <Icon />
                  </span>
                  <h3 className={styles.rootName}>{root.name}</h3>
                  <p className={styles.rootText}>{root.text}</p>
                  <p className={styles.rootAuthors}>{root.authors}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* the library */}
      <section className={styles.band} id={lang === "en" ? "library" : "biblioteca"}>
        <div className={styles.inner}>
          <div className={styles.center} data-reveal>
            <h2 className={styles.h2}>{c.library.title}</h2>
            <p className={styles.lead}>{c.library.lead}</p>
          </div>
          <MethodLibrary locale={locale} />
          <div className={styles.grow} data-reveal>
            <span className={styles.growIcon} aria-hidden>
              <Book />
            </span>
            <div>
              <h3 className={styles.growTitle}>{c.library.growTitle}</h3>
              <p className={styles.growText}>{c.library.growText}</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.band}>
        <div className={`${styles.inner} ${styles.faq}`}>
          <h2 className={styles.h2} data-reveal>
            {c.faq.title}
          </h2>
          <div data-reveal style={delay(100)}>
            <Faq items={c.faq.items} />
          </div>
        </div>
      </section>

      <section className={styles.band}>
        <div className={styles.inner}>
          <div className={styles.cta} data-reveal>
            <h2 className={styles.h2}>{c.cta.title}</h2>
            <p className={styles.lead}>{c.cta.text}</p>
            <Button href="/taller" arrow>
              {c.cta.label}
            </Button>
          </div>
        </div>
      </section>
    </article>
  );
}
