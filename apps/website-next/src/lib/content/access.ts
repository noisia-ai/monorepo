import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
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
 * - `registro` opens with a sign-up: name, email and company, then a 4-digit code sent to that
 *   email. The right code turns the sign-up into a personal link.
 * - `registro` also opens for a reader who signed up for any `registro` study: the token of that
 *   sign-up lives in the reader cookie (`nsr`), so the next study opens without the form.
 *
 * The site never reads the links table: it calls the `content.*` functions.
 */

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function accessCookieName(studyId: string): string {
  return `nsk_${studyId}`;
}

/** A `registro` study shows its first slides to anyone; the sign-up opens the rest. */
export const PREVIEW_SLIDES = 5;

/** Whether a file is one of the open preview slides of a `registro` study. */
export function isPreviewSlide(study: Study, path: string): boolean {
  if (study.accessMode !== "registro") return false;
  const match = /^slides(?:-en)?\/(\d{2,3})\.webp$/.exec(path);
  return Boolean(match) && Number(match![1]) >= 1 && Number(match![1]) <= Math.min(PREVIEW_SLIDES, study.slideCount);
}

/** The cookie that remembers a reader who signed up, across `registro` studies. */
export const READER_COOKIE = "nsr";

/** How long a sign-up keeps its cookies (the link itself lasts a year). */
export const ACCESS_COOKIE_DAYS = 90;

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

const readerCache = new Map<string, { valid: boolean; until: number }>();

/** Whether a remembered reader is still valid. */
export async function readerValid(token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const hash = hashToken(token);
  const hit = readerCache.get(hash);
  if (hit && hit.until > Date.now()) return hit.valid;
  const { rows } = await contentDb().query<{ valid: boolean }>("select content.reader_valid($1) as valid", [hash]);
  const valid = Boolean(rows[0]?.valid);
  if (readerCache.size > 5000) readerCache.clear();
  readerCache.set(hash, { valid, until: Date.now() + LINK_TTL_MS });
  return valid;
}

export type Access = { allowed: boolean; viaLink: boolean; viaReader: boolean };

/**
 * Whether this reader may open the full study. `token` is the value of the study's cookie and
 * `reader` the value of the reader cookie.
 */
export async function canOpen(study: Study, token: string | undefined, reader?: string): Promise<Access> {
  if (token) {
    try {
      if ((await linkStudy(token)) === study.id) return { allowed: true, viaLink: true, viaReader: false };
    } catch (error) {
      console.error(`[content] Could not check a link for ${study.id}: ${(error as Error).message}`);
    }
  }
  if (study.accessMode === "abierto") return { allowed: true, viaLink: false, viaReader: false };
  if (study.accessMode === "registro" && reader) {
    try {
      if (await readerValid(reader)) return { allowed: true, viaLink: false, viaReader: true };
    } catch (error) {
      console.error(`[content] Could not check a reader for ${study.id}: ${(error as Error).message}`);
    }
  }
  return { allowed: false, viaLink: false, viaReader: false };
}

/** The short cookie of a sign-up waiting for its code. */
export function pendingCookieName(studyId: string): string {
  return `nsp_${studyId}`;
}

/** How long a code works. */
export const CODE_MINUTES = 30;

/** A 4-digit code. */
export function newCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

// The code is stored hashed with the pending secret, so the code alone opens nothing.
function codeHash(pending: string, code: string): string {
  return hashToken(`${pending}:${code}`);
}

export type Person = { name: string; email: string; company: string; marketing: boolean; lang: "es" | "en" };

/**
 * A new sign-up for a `registro` study, waiting for the code sent to the email. `pending` is the
 * secret kept in the browser's pending cookie. Returns false if the study does not take sign-ups.
 */
export async function startSignup(studyId: string, pending: string, code: string, person: Person): Promise<boolean> {
  const { rows } = await contentDb().query<{ ok: boolean }>(
    "select content.start_signup($1, $2, $3, $4, $5, $6, $7, $8) as ok",
    [studyId, hashToken(pending), codeHash(pending, code), person.name, person.email, person.company, person.marketing, person.lang]
  );
  return Boolean(rows[0]?.ok);
}

export type SignupResult = { status: "ok"; person: Person } | { status: "wrong" | "locked" | "expired" };

/** Checks the code. On the right one, `token` becomes the reader's personal link for the study. */
export async function verifySignup(studyId: string, pending: string, code: string, token: string): Promise<SignupResult> {
  const { rows } = await contentDb().query<{ status: string; name: string; email: string; company: string; marketing: boolean; lang: string | null }>(
    "select * from content.verify_signup($1, $2, $3, $4)",
    [studyId, hashToken(pending), codeHash(pending, code), hashToken(token)]
  );
  const row = rows[0];
  if (row?.status === "ok") {
    linkCache.delete(hashToken(token));
    return { status: "ok", person: { name: row.name, email: row.email, company: row.company, marketing: row.marketing, lang: row.lang === "en" ? "en" : "es" } };
  }
  return { status: row?.status === "wrong" || row?.status === "locked" ? row.status : "expired" };
}

/** A remembered reader opens a study: counts the open on that reader's link for it. Never throws. */
export async function recordReaderOpen(studyId: string, reader: string): Promise<void> {
  try {
    await contentDb().query("select content.reader_open($1, $2, $3)", [studyId, hashToken(reader), hashToken(randomBytes(18).toString("base64url"))]);
  } catch (error) {
    console.error(`[content] Could not record a reader open for ${studyId}: ${(error as Error).message}`);
  }
}

/** Records that someone saw the page, opened the study or downloaded the PDF. Never throws. */
export async function recordEvent(studyId: string, token: string | undefined, kind: "page" | "open" | "pdf"): Promise<void> {
  try {
    await contentDb().query("select content.record_event($1, $2, $3)", [studyId, token && TOKEN_PATTERN.test(token) ? hashToken(token) : null, kind]);
  } catch (error) {
    console.error(`[content] Could not record ${kind} for ${studyId}: ${(error as Error).message}`);
  }
}
