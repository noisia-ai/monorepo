import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { STORIES_TAG } from "@/content/stories";

/**
 * Called by `pnpm content:publish` after a piece or a study changes state, so the feed, the
 * piece pages, the sitemap and llms.txt pick it up without a deploy. Pages are regenerated on
 * their next visit. Without CONTENT_REVALIDATE_SECRET the endpoint does not exist.
 */

const digest = (value: string) => createHash("sha256").update(value).digest();

function authorized(request: NextRequest, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  // Compare digests so the check takes the same time whatever the token's length.
  return token.length > 0 && timingSafeEqual(digest(token), digest(secret));
}

export async function POST(request: NextRequest) {
  const secret = process.env.CONTENT_REVALIDATE_SECRET;
  if (!secret) return new NextResponse("Not found", { status: 404 });
  if (!authorized(request, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  revalidateTag(STORIES_TAG);
  // Every page reads the registry (breadcrumbs, lists, metadata), so the whole tree is refreshed.
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, revalidated: [STORIES_TAG, "/"] }, { headers: { "Cache-Control": "no-store" } });
}
