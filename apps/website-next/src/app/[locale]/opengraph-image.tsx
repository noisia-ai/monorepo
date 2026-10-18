import { ImageResponse } from "next/og";
import { logoDataUri } from "@/lib/logo-data";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const en = locale === "en";
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
          background: "linear-gradient(135deg, #ffffff 50%, #d9f7f7 85%, #fde3dd 100%)"
        }}
      >
        <span style={{ fontSize: 30, color: "#008a8a" }}>{en ? "Social intelligence" : "Inteligencia social"}</span>
        <span style={{ fontSize: 72, lineHeight: 1.08, color: "#0a0a0a", maxWidth: 980 }}>
          {en ? "Every conversation, read to answer your question" : "Toda la conversación, leída para responder tu pregunta"}
        </span>
        <img src={logoDataUri()} width={200} height={70} alt="Noisia" />
      </div>
    ),
    size
  );
}
