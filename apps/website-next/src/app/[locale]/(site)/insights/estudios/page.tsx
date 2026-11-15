import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LearnHero } from "@/components/learn/Learn";
import learn from "@/components/learn/learn.module.css";
import { studyCardItems } from "@/components/studies/items";
import { StudyIndex } from "@/components/studies/StudyIndex";
import { JsonLd } from "@/components/seo/JsonLd";
import { studiesPage } from "@/content/pages/studies";
import { childItems, itemListNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/insights/estudios", locale);
}

export default async function StudiesIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = studiesPage[locale === "en" ? "en" : "es"];
  const items = await studyCardItems(locale);
  const jsonLd = await pageGraph("/insights/estudios", locale, {
    type: "CollectionPage",
    nodes: [await itemListNode("/insights/estudios", locale, await childItems("/insights/estudios", locale))]
  });
  return (
    <div className={learn.page}>
      <LearnHero title={c.title} lead={c.lead} />
      <StudyIndex
        items={items}
        labels={{
          industryLabel: c.industryLabel,
          marketLabel: c.marketLabel,
          allIndustries: c.allIndustries,
          allMarkets: c.allMarkets,
          latest: c.latest,
          empty: c.empty,
          expiredLink: c.expiredLink,
          draft: c.draft
        }}
      />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </div>
  );
}
