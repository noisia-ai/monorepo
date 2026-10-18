import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { methodsIndex, methodEntries } from "@/content/pages/methods";
import { pick } from "@/content/pages/registry";
import { pageMetadata } from "@/lib/page-meta";

const paths = { es: "/metodos", en: "/methods" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(pick(methodsIndex, locale), locale, paths);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = pick(methodsIndex, locale);
  const lang = locale === "en" ? "en" : "es";
  const prefix = locale === "en" ? "/en" + paths.en : paths.es;
  return (
    <ContentPage
      page={{
        ...page,
        blocks: [
          { type: "links", items: methodEntries.map((entry) => ({ label: entry.page[lang].metaTitle, text: entry.summary[lang], href: `${prefix}/${entry.slug[lang]}` })) },
          ...page.blocks
        ]
      }}
    />
  );
}
