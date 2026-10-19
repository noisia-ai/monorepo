import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getStory } from "@/content/stories";
import { RenderFrame } from "./RenderFrame";

// Renders one frame of a story at native size (1080×1920) for QA and for frame-by-frame
// video export with a headless browser. Not linked from the site and not indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RenderPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ frame?: string; mode?: string; scale?: string }>;
}) {
  const { locale, slug } = await params;
  const { frame = "0", mode = "video", scale = "1" } = await searchParams;
  setRequestLocale(locale);
  const story = getStory(slug);
  if (!story) notFound();
  const t = await getTranslations({ locale, namespace: "industries" });
  return (
    <RenderFrame
      story={locale === "en" ? story.en : story.es}
      locale={locale}
      tag={`${t(story.industry)} · ${story.market}`}
      frame={Number(frame)}
      mode={mode === "feed" ? "feed" : "video"}
      scale={Number(scale)}
    />
  );
}
