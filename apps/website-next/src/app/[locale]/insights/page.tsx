import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Feed } from "@/components/feed/Feed";
import { getFeedStories } from "@/components/feed/feed-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "feed" });
  return {
    title: t("label"),
    alternates: { canonical: locale === "en" ? "/en/insights" : "/insights", languages: { es: "/insights", en: "/en/insights" } }
  };
}

export default async function InsightsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const stories = await getFeedStories(locale);
  return <Feed stories={stories} />;
}
