import "server-only";
import { unstable_cache } from "next/cache";
import { contentDatabaseConfigured, contentDb, showsDrafts } from "@/lib/content/db";
import { STORIES_TAG } from "@/content/stories";
import type { AccessMode, FullLanguage, Market, StudySummary } from "./schema";

/**
 * Marketing studies, read from the content database. Without CONTENT_DATABASE_URL there are none:
 * the studies index then shows only the editorial reports that live in the repo.
 */

/** Cache tag of the studies. The publish script revalidates it with the pieces' tag. */
export const STUDIES_TAG = "content:studies";

export type Study = {
  id: string;
  accessMode: AccessMode;
  industry: string;
  /** One or more; the first is the main one. */
  markets: Market[];
  method: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  base: { mentions?: number; channels?: string[]; cut_date?: string };
  summary: { es: StudySummary; en: StudySummary };
  fullLanguage: FullLanguage;
  coverPath: string | null;
  pdfPath: string | null;
  slideCount: number;
  version: number;
  publishedAt: string | null;
  /** Only in UAT: drafts are shown there so they can be reviewed. */
  draft: boolean;
};

type Row = {
  id: string;
  access_mode: AccessMode;
  industry: string;
  market: Market;
  markets?: Market[] | null;
  method: string | null;
  period_label: string | null;
  period_start: Date | string | null;
  period_end: Date | string | null;
  base: Study["base"];
  summary: Study["summary"];
  full_language: FullLanguage;
  cover_path: string | null;
  pdf_path: string | null;
  slide_count: number;
  version: number;
  published_at: Date | string | null;
  status?: string;
};

const day = (value: Date | string | null) => (value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const stamp = (value: Date | string | null) => (value === null ? null : value instanceof Date ? value.toISOString() : String(value));

function fromRow(row: Row): Study | null {
  // The load script validates the summary; a row without both languages is skipped, not shown broken.
  if (!row.summary?.es?.title || !row.summary?.en?.title) {
    console.error(`[content] Skipping study ${row.id}: summary is incomplete`);
    return null;
  }
  return {
    id: row.id,
    accessMode: row.access_mode,
    industry: row.industry,
    markets: row.markets?.length ? row.markets : [row.market],
    method: row.method,
    periodLabel: row.period_label,
    periodStart: day(row.period_start),
    periodEnd: day(row.period_end),
    base: row.base ?? {},
    summary: row.summary,
    fullLanguage: row.full_language,
    coverPath: row.cover_path,
    pdfPath: row.pdf_path,
    slideCount: row.slide_count,
    version: row.version,
    publishedAt: stamp(row.published_at),
    draft: row.status === "borrador"
  };
}

async function readStudies(): Promise<Study[]> {
  const view = showsDrafts() ? "content.review_studies" : "content.published_studies";
  const { rows } = await contentDb().query<Row>(`select * from ${view} order by published_at desc nulls first, id`);
  return rows.flatMap((row) => fromRow(row) ?? []);
}

const cachedStudies = unstable_cache(readStudies, ["content-studies"], { tags: [STUDIES_TAG] });

/** Every visible study, newest first (drafts first in UAT). */
export async function getStudies(): Promise<Study[]> {
  if (!contentDatabaseConfigured()) return [];
  try {
    return await cachedStudies();
  } catch (error) {
    // A database hiccup must not take the site down: the index falls back to the repo's reports.
    console.error(`[content] Could not read studies: ${(error as Error).message}`);
    return [];
  }
}

export async function getStudy(id: string): Promise<Study | undefined> {
  return (await getStudies()).find((study) => study.id === id);
}

async function readStudyStoryIds(): Promise<Record<string, string[]>> {
  const view = showsDrafts() ? "content.review_stories" : "content.published_stories";
  const { rows } = await contentDb().query<{ id: string; study_id: string }>(
    `select id, study_id from ${view} where study_id is not null order by position, id`
  );
  const byStudy: Record<string, string[]> = {};
  for (const row of rows) (byStudy[row.study_id] ??= []).push(row.id);
  return byStudy;
}

const cachedStudyStoryIds = unstable_cache(readStudyStoryIds, ["content-study-stories"], { tags: [STORIES_TAG, STUDIES_TAG] });

/** Ids of the Insights pieces that came out of a study, in feed order. */
export async function studyStoryIds(id: string): Promise<string[]> {
  if (!contentDatabaseConfigured()) return [];
  try {
    return (await cachedStudyStoryIds())[id] ?? [];
  } catch (error) {
    console.error(`[content] Could not read the pieces of ${id}: ${(error as Error).message}`);
    return [];
  }
}

// ---------- files ----------

export type StudyFile = { contentType: string; bytes: Buffer; sha256: string };

/**
 * Files are immutable per study version, so they are kept in memory once read. The key includes
 * the version: loading a new version of a study simply misses the cache.
 */
const FILE_CACHE_LIMIT = 96 * 1024 * 1024;
const fileCache = new Map<string, StudyFile>();
let fileCacheBytes = 0;

function remember(key: string, file: StudyFile) {
  if (file.bytes.length > FILE_CACHE_LIMIT / 4) return;
  fileCache.set(key, file);
  fileCacheBytes += file.bytes.length;
  // Evict the oldest entries (Map keeps insertion order) until the cache fits again.
  for (const [oldKey, old] of fileCache) {
    if (fileCacheBytes <= FILE_CACHE_LIMIT) break;
    fileCache.delete(oldKey);
    fileCacheBytes -= old.bytes.length;
  }
}

export async function getStudyFile(study: Study, path: string): Promise<StudyFile | undefined> {
  const key = `${study.id}:${study.version}:${path}`;
  const cached = fileCache.get(key);
  if (cached) return cached;
  const view = showsDrafts() ? "content.review_study_files" : "content.published_study_files";
  const { rows } = await contentDb().query<{ content_type: string; bytes: Buffer; sha256: string }>(
    `select content_type, bytes, sha256 from ${view} where study_id = $1 and path = $2`,
    [study.id, path]
  );
  const row = rows[0];
  if (!row) return undefined;
  const file = { contentType: row.content_type, bytes: row.bytes, sha256: row.sha256 };
  remember(key, file);
  return file;
}

/** Paths of the slide images of a study, in order. */
export function slidePaths(study: Study): string[] {
  return Array.from({ length: study.slideCount }, (_, i) => `slides/${String(i + 1).padStart(2, "0")}.webp`);
}
