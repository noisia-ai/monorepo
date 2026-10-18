import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { solutionEntries } from "@/content/pages/solutions";
import { findEntry, pick } from "@/content/pages/registry";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-meta";

type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => solutionEntries.map((entry) => ({ locale, slug: entry.slug[locale] })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const entry = findEntry(solutionEntries, locale, slug);
  if (!entry) return {};
  return pageMetadata(pick(entry.page, locale), locale, { es: `/soluciones/${entry.slug.es}`, en: `/solutions/${entry.slug.en}` });
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = findEntry(solutionEntries, locale, slug);
  if (!entry) notFound();
  return <ContentPage page={pick(entry.page, locale)} />;
}
