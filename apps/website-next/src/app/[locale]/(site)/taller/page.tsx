import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { WorkshopForm } from "@/components/workshop/WorkshopForm";
import { workshop } from "@/content/pages/workshop";
import { pick } from "@/content/pages/registry";
import { pageMetadata } from "@/lib/page-meta";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(pick(workshop, locale), locale, { es: "/taller", en: "/workshop" });
}

export default async function WorkshopPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = pick(workshop, locale);
  return <ContentPage page={page} aside={<WorkshopForm copy={page.form} />} />;
}
