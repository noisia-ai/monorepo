import { ImageResponse } from "next/og";
import { logoDataUri } from "@/lib/logo-data";
import { getStory } from "@/content/stories";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const story = getStory(slug);
  const content = story ? (locale === "en" ? story.en : story.es) : null;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #ffffff 55%, #d9f7f7 100%)",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, color: "#008a8a" }}>{story ? `${story.industry.replace(/-/g, " ")} · ${story.market}` : "insights"}</div>
        <div style={{ display: "flex", fontSize: 64, lineHeight: 1.1, color: "#0a0a0a", maxWidth: 1000 }}>{content?.title ?? "Noisia"}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src={logoDataUri()} width={180} height={63} alt="Noisia" />
          <span style={{ fontSize: 24, color: "#6d6d6d" }}>{locale === "en" ? "social intelligence" : "inteligencia social"}</span>
        </div>
      </div>
    ),
    size
  );
}
