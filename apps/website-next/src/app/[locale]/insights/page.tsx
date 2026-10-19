import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Feed } from "@/components/feed/Feed";
import { getFeedCollections, getFeedStories } from "@/components/feed/feed-data";
import { JsonLd } from "@/components/seo/JsonLd";
import { childItems, itemListNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/insights", locale);
}

export default async function InsightsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ industria?: string; industry?: string; coleccion?: string; collection?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const stories = await getFeedStories(locale);
  const collection = query.coleccion ?? query.collection;
  const industry = query.industria ?? query.industry;
  const jsonLd = pageGraph("/insights", locale, { type: "CollectionPage", nodes: [itemListNode("/insights", locale, childItems("/insights", locale))] });
  return (
    <>
      <Feed
        stories={stories}
        collections={getFeedCollections(stories, locale)}
        initialFilter={collection ? { type: "collection", id: collection } : industry ? { type: "industry", id: industry } : undefined}
      />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </>
  );
}
