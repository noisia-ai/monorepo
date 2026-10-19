import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { industriesPage, industryEntries } from "@/content/pages/industries";
import { IndustryFinder } from "@/components/learn/IndustryFinder";
import { LearnHero } from "@/components/learn/Learn";
import styles from "@/components/learn/learn.module.css";
import { JsonLd } from "@/components/seo/JsonLd";
import { childItems, itemListNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/industrias", locale);
}

export default async function IndustriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "en" ? "en" : "es";
  const c = industriesPage[lang];
  const jsonLd = pageGraph("/industrias", locale, { type: "CollectionPage", nodes: [itemListNode("/industrias", locale, childItems("/industrias", locale))] });
  const items = industryEntries.map((entry) => {
    const copy = entry[lang];
    return {
      slug: entry.slug[lang],
      name: copy.name,
      text: copy.questions[0]?.text ?? "",
      meta: c.questionsCount(copy.questions.length),
      icon: entry.icon,
      search: [copy.name, copy.lead, ...copy.questions.map((q) => q.text)].join(" ")
    };
  });

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <LearnHero title={c.title} lead={c.lead} />
        <IndustryFinder items={items} label={c.searchLabel} placeholder={c.searchPlaceholder} empty={c.empty} other={{ name: c.ctaTitle, text: c.ctaText, meta: c.ctaLabel }} />
      </div>
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </div>
  );
}
