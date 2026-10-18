import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { SetAlternate } from "@/components/layout/alternate";
import { methodEntries } from "@/content/pages/methods";
import { findEntry, pick } from "@/content/pages/registry";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-meta";

type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => methodEntries.map((entry) => ({ locale, slug: entry.slug[locale] })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const entry = findEntry(methodEntries, locale, slug);
  if (!entry) return {};
  return pageMetadata(pick(entry.page, locale), locale, { es: `/metodos/${entry.slug.es}`, en: `/methods/${entry.slug.en}` });
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = findEntry(methodEntries, locale, slug);
  if (!entry) notFound();
  const alternate = locale === "en" ? `/metodos/${entry.slug.es}` : `/en/methods/${entry.slug.en}`;
  return (
    <>
      <SetAlternate href={alternate} />
      <ContentPage page={pick(entry.page, locale)} />
    </>
  );
}
