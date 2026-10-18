import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getStories, getStory } from "@/content/stories";
import { Feed } from "@/components/feed/Feed";
import { getFeedStories } from "@/components/feed/feed-data";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site";

type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getStories().map((story) => ({ locale, slug: story.id })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const story = getStory(slug);
  if (!story) return {};
  const content = locale === "en" ? story.en : story.es;
  return {
    title: content.title,
    description: content.dek,
    alternates: {
      canonical: `${locale === "en" ? "/en" : ""}/insights/${slug}`,
      languages: { es: `/insights/${slug}`, en: `/en/insights/${slug}`, "x-default": `/insights/${slug}` }
    },
    // Illustrative examples are for the feed experience, not for search results.
    robots: story.kind === "editorial" ? undefined : { index: false, follow: true },
    openGraph: { title: content.title, description: content.dek, type: "article" }
  };
}

export default async function InsightPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const story = getStory(slug);
  if (!story) notFound();
  const content = locale === "en" ? story.en : story.es;
  const stories = await getFeedStories(locale);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: content.title,
    description: content.dek,
    inLanguage: locale === "en" ? "en" : "es-MX",
    url: `${SITE_URL}${locale === "en" ? "/en" : ""}/insights/${slug}`,
    publisher: { "@type": "Organization", name: "Noisia", url: SITE_URL },
    about: story.industry
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Feed stories={stories} initialId={slug} initialTitle={content.title} />
    </>
  );
}
