import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage } from "@/components/blocks/Blocks";
import { howItWorks } from "@/content/pages/howItWorks";
import { processCopy } from "@/content/pages/process";
import { ProcessMotion } from "@/components/motion/ProcessMotion";
import { pick } from "@/content/pages/registry";
import { pageMetadata } from "@/lib/page-meta";

const paths = { es: "/como-funciona", en: "/how-it-works" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(pick(howItWorks, locale), locale, paths);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const copy = locale === "en" ? processCopy.en : processCopy.es;
  return <ContentPage page={pick(howItWorks, locale)} aside={<ProcessMotion copy={copy} label={copy.question} />} wide />;
}
