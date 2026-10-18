import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { privacy } from "@/content/pages/privacy";
import { pick } from "@/content/pages/registry";
import { pageMetadata } from "@/lib/page-meta";

const paths = { es: "/privacidad", en: "/privacy" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(pick(privacy, locale), locale, paths);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentPage page={pick(privacy, locale)} />;
}
