import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getStories, getStory } from "@/content/stories";
import { Feed } from "@/components/feed/Feed";
import { getFeedCollections, getFeedStories } from "@/components/feed/feed-data";
import { routing } from "@/i18n/routing";
import { JsonLd } from "@/components/seo/JsonLd";
import { insightsReports } from "@/content/reports/reports";
import { articleNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getStories().map((story) => ({ locale, slug: story.id })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!getStory(slug)) return {};
  return pageMetadata(`/insights/${slug}`, locale);
}

export default async function InsightPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const story = getStory(slug);
  if (!story) notFound();
  const content = locale === "en" ? story.en : story.es;
  const stories = await getFeedStories(locale);
  const report = story.report ? insightsReports.find((r) => story.report?.endsWith(`/${r.slug}`)) : undefined;
  const industries = await getTranslations({ locale, namespace: "industries" });
  const id = `/insights/${slug}`;
  const jsonLd = pageGraph(id, locale, {
    nodes: [
      articleNode(id, locale, {
        headline: content.title,
        description: content.dek,
        datePublished: report?.meta.analysis_date,
        about: { "@type": "Thing", name: industries(story.industry) },
        isPartOf: report ? (locale === "en" ? `/en/insights/reports/${report.slug}` : `/insights/reportes/${report.slug}`) : undefined,
        extra: { articleSection: "Insights" }
      })
    ]
  });
  return (
    <>
      <Feed stories={stories} collections={getFeedCollections(stories, locale)} initialId={slug} initialTitle={content.title} />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </>
  );
}
