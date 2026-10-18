import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Feed } from "@/components/feed/Feed";
import { getFeedCollections, getFeedStories } from "@/components/feed/feed-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "feed" });
  return {
    title: t("label"),
    description: t("metaDescription"),
    alternates: {
      canonical: locale === "en" ? "/en/insights" : "/insights",
      languages: { es: "/insights", en: "/en/insights", "x-default": "/insights" }
    }
  };
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
  return (
    <Feed
      stories={stories}
      collections={getFeedCollections(stories, locale)}
      initialFilter={collection ? { type: "collection", id: collection } : industry ? { type: "industry", id: industry } : undefined}
    />
  );
}
