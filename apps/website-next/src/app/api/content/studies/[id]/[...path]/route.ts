import { cookies } from "next/headers";
import { deckPaths, getStudy, getStudyFile } from "@/content/studies";
import { accessCookieName, canOpen, isPreviewSlide, READER_COOKIE, recordEvent } from "@/lib/content/access";

/**
 * Serves the files of a study: the deck the builder made, its slide images, the PDF, the cover and
 * the study's image, and the same for its English deck when it has one (deck-en/, slides-en/, pdf-en).
 *
 * The cover, the image (vertical and wide, and its email JPEG) and the preview slides of a `registro` study are public. Everything else checks access first and goes out with
 * `Cache-Control: private`, so Cloudflare never keeps a gated study and serves it to someone
 * who did not unlock it. The browser gets these paths, never a direct link to the storage.
 */

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

function deny(status: number) {
  return new Response(status === 404 ? "Not found" : "Forbidden", { status, headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8" } });
}

/** The deck opens read-only: no thumbnail rail (it lets you reorder and delete slides). */
function viewerHtml(html: string): string {
  return html.replace(/<deck-stage\b(?![^>]*\bno-rail\b)/, "<deck-stage no-rail");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path: segments } = await params;
  const path = segments.join("/");
  if (path.includes("..")) return deny(404);
  const study = await getStudy(id).catch(() => undefined);
  if (!study) return deny(404);

  if (path === "cover.webp" || path === "email.jpg" || (path === "hero.webp" && study.heroPath === path) || (path === "hero-wide.webp" && study.heroWidePath === path)) {
    const cover = await getStudyFile(study, path);
    if (!cover) return deny(404);
    return new Response(new Uint8Array(cover.bytes), {
      headers: { "Content-Type": cover.contentType, "Cache-Control": "public, max-age=86400", ETag: `"${cover.sha256}"` }
    });
  }

  const jar = await cookies();
  const token = jar.get(accessCookieName(study.id))?.value;
  const access = await canOpen(study, token, jar.get(READER_COOKIE)?.value);
  if (!access.allowed && !isPreviewSlide(study, path)) return deny(403);

  // `pdf` is the main deck's PDF and `pdf-en` the English one (content/studies deckPaths).
  const isEnglishPdf = path === "pdf-en" || path.startsWith("pdf-en/");
  const isPdf = isEnglishPdf || path === "pdf" || path.startsWith("pdf/");
  const filePath = isPdf ? (deckPaths(study, isEnglishPdf ? "en" : "main").pdf ?? "") : path;
  if (!/^(deck|slides|pdf)(-en)?\//.test(filePath)) return deny(404);
  const file = await getStudyFile(study, filePath);
  if (!file) return deny(404);

  // Open studies may stay in the reader's own browser cache; gated ones are never stored.
  const cache = !access.allowed ? "public, max-age=3600" : study.accessMode === "abierto" && !access.viaLink ? "private, max-age=3600" : "private, no-store";
  const headers: Record<string, string> = { "Content-Type": file.contentType, "Cache-Control": cache, "X-Robots-Tag": "noindex, nofollow" };

  if (isPdf) {
    await recordEvent(study.id, access.viaLink ? token : undefined, "pdf");
    const name = filePath.split("/").pop() ?? `${study.id}.pdf`;
    headers["Content-Disposition"] = `attachment; filename="${name.replace(/[^\w.-]+/g, "-")}"`;
  }

  if (filePath === "deck/index.html") {
    return new Response(viewerHtml(file.bytes.toString("utf8")), { headers });
  }
  return new Response(new Uint8Array(file.bytes), { headers });
}
