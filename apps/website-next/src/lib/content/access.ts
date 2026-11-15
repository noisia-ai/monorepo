import "server-only";
import { createHash } from "node:crypto";
import { contentDb } from "./db";
import type { Study } from "@/content/studies";

/**
 * Who may open the full study.
 *
 * - `abierto`: anyone.
 * - `registro` and `solo_link`: whoever holds a valid personal link. A personal link
 *   (`/e/<token>`) puts its token in a cookie scoped to that study; every request for the full
 *   study or its files checks the token against the database, which stores only its hash.
 *
 * The site never reads the links table: it asks `content.link_study` and `content.record_event`.
 */

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function accessCookieName(studyId: string): string {
  return `nsk_${studyId}`;
}

// A valid link stays valid for minutes at least, so the answer is kept briefly: one deck loads
// dozens of files and each one checks access.
const LINK_TTL_MS = 60_000;
const linkCache = new Map<string, { study: string | null; until: number }>();

/** The study a token opens, or null. */
export async function linkStudy(token: string): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const hash = hashToken(token);
  const hit = linkCache.get(hash);
  if (hit && hit.until > Date.now()) return hit.study;
  const { rows } = await contentDb().query<{ study: string | null }>("select content.link_study($1) as study", [hash]);
  const study = rows[0]?.study ?? null;
  if (linkCache.size > 5000) linkCache.clear();
  linkCache.set(hash, { study, until: Date.now() + LINK_TTL_MS });
  return study;
}

/** Whether this reader may open the full study. `token` is the value of the study's cookie. */
export async function canOpen(study: Study, token: string | undefined): Promise<{ allowed: boolean; viaLink: boolean }> {
  if (token) {
    try {
      if ((await linkStudy(token)) === study.id) return { allowed: true, viaLink: true };
    } catch (error) {
      console.error(`[content] Could not check a link for ${study.id}: ${(error as Error).message}`);
    }
  }
  return { allowed: study.accessMode === "abierto", viaLink: false };
}

/** Records that someone saw the page, opened the study or downloaded the PDF. Never throws. */
export async function recordEvent(studyId: string, token: string | undefined, kind: "page" | "open" | "pdf"): Promise<void> {
  try {
    await contentDb().query("select content.record_event($1, $2, $3)", [studyId, token && TOKEN_PATTERN.test(token) ? hashToken(token) : null, kind]);
  } catch (error) {
    console.error(`[content] Could not record ${kind} for ${studyId}: ${(error as Error).message}`);
  }
}
