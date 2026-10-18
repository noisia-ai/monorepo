import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { compareIndex, compareEntries } from "@/content/pages/compare";
import { pick } from "@/content/pages/registry";
import { pageMetadata } from "@/lib/page-meta";

const paths = { es: "/comparar", en: "/compare" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(pick(compareIndex, locale), locale, paths);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = pick(compareIndex, locale);
  const lang = locale === "en" ? "en" : "es";
  const prefix = locale === "en" ? "/en" + paths.en : paths.es;
  return (
    <ContentPage
      page={{
        ...page,
        blocks: [
          { type: "links", items: compareEntries.map((entry) => ({ label: entry.page[lang].metaTitle, text: entry.summary[lang], href: `${prefix}/${entry.slug[lang]}` })) },
          ...page.blocks
        ]
      }}
    />
  );
}
