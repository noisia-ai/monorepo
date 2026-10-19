import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { logoDataUri } from "@/lib/logo-data";
import { seoPageByPath } from "@/lib/seo/pages";

/**
 * Open Graph image of any page, in its language: /og/es/soluciones/lanzar.png,
 * /og/en/solutions/launch.png, /og/es/index.png for the home. Only registered pages render, so
 * nobody can print arbitrary text under the Noisia logo. The .png ending keeps the locale
 * middleware away (it skips paths with a file extension). Satori cannot parse the Google Sans
 * TTFs in public/fonts (glyph table error), so the image uses its built-in sans.
 */

const SIZE = { width: 1200, height: 630 };

function imageDataUri(src: string): string | null {
  if (!src.startsWith("/") || src.includes("..")) return null;
  try {
    return `data:image/png;base64,${readFileSync(join(process.cwd(), "public", src)).toString("base64")}`;
  } catch {
    return null;
  }
}

function headlineSize(text: string, narrow: boolean): number {
  const n = text.length * (narrow ? 1.6 : 1);
  if (n <= 40) return 80;
  if (n <= 70) return 68;
  if (n <= 110) return 56;
  return 46;
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; path: string[] }> }) {
  const { locale, path } = await params;
  const joined = `/${path.join("/")}`;
  if ((locale !== "es" && locale !== "en") || !joined.endsWith(".png")) return new Response("Not found", { status: 404 });
  const rest = joined.slice(0, -".png".length);
  const publicPath = locale === "en" ? (rest === "/index" ? "/en" : `/en${rest}`) : rest === "/index" ? "/" : rest;
  const found = seoPageByPath(publicPath);
  if (!found || found.lang !== locale) return new Response("Not found", { status: 404 });

  const { page } = found;
  const copy = page[locale];
  const picture = page.image ? imageDataUri(page.image) : null;
  const headline = copy.headline.length > 150 ? `${copy.headline.slice(0, 147).trimEnd()}…` : copy.headline;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "linear-gradient(135deg, #ffffff 52%, #e6f7f7 82%, #fde9e4 100%)" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "68px 72px" }}>
          <div style={{ display: "flex", fontSize: 28, color: "#007a7a" }}>{copy.kicker}</div>
          <div style={{ display: "flex", fontSize: headlineSize(headline, Boolean(picture)), lineHeight: 1.1, color: "#0a0a0a", letterSpacing: -1 }}>{headline}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered by ImageResponse, not the browser */}
            <img src={logoDataUri()} width={186} height={65} alt="Noisia" />
            {picture ? null : <span style={{ fontSize: 26, color: "#6d6d6d" }}>noisia.ai</span>}
          </div>
        </div>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- rendered by ImageResponse, not the browser
          <img src={picture} width={630} height={630} alt="" style={{ objectFit: "cover" }} />
        ) : null}
      </div>
    ),
    {
      ...SIZE,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" }
    }
  );
}
