import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { about } from "@/content/pages/about";
import { pick } from "@/content/pages/registry";
import { JsonLd } from "@/components/seo/JsonLd";
import { ORG_ID } from "@/lib/seo/config";
import { pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/nosotros", locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const jsonLd = pageGraph("/nosotros", locale, { type: "AboutPage", page: { about: { "@id": ORG_ID }, mainEntity: { "@id": ORG_ID } } });
  return (
    <>
      <ContentPage page={pick(about, locale)} />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </>
  );
}
