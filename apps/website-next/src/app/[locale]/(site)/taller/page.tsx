import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { WorkshopForm } from "@/components/workshop/WorkshopForm";
import { workshop } from "@/content/pages/workshop";
import { pick } from "@/content/pages/registry";
import { JsonLd } from "@/components/seo/JsonLd";
import { ORG_ID } from "@/lib/seo/config";
import { pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata("/taller", locale);
}

export default async function WorkshopPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = pick(workshop, locale);
  const jsonLd = pageGraph("/taller", locale, { type: "ContactPage", page: { about: { "@id": ORG_ID } } });
  return (
    <>
      <ContentPage page={page} split aside={<WorkshopForm copy={page.form} />} />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </>
  );
}
