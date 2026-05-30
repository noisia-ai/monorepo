import crypto from "node:crypto";

import { mentions } from "@noisia/db";
import { db } from "@/lib/db";

type CsvRow = Record<string, string>;

type NormalizedMention = {
  externalId: string;
  textRaw: string;
  textClean: string;
  textSnippet: string;
  title: string | null;
  textLength: number;
  language: string | null;
  publishedAt: Date;
  platform: string;
  url: string | null;
  country: string | null;
  engagement: Record<string, number>;
  sentimentSource: string | null;
  sentimentScore: string | null;
  inclusionStatus: "included" | "excluded";
  exclusionReason: string | null;
  qualityFlags: Record<string, boolean>;
  rawMetadata: Record<string, unknown>;
  textHash: string;
};

export type CsvImportStats = {
  record_count: number;
  included_count: number;
  excluded_count: number;
  duplicate_count: number;
};

const textKeys = ["text", "content", "body", "mention", "snippet", "description", "post content", "content of posts"];
const titleKeys = ["title", "headline", "subject"];
const dateKeys = ["date", "published at", "published_at", "created at", "created_at", "created", "time"];
const urlKeys = ["url", "link", "source url", "source_url", "link to the source"];
const platformKeys = ["platform", "channel", "network", "social network", "service", "domain group", "source", "source type", "medium", "specific type"];
const contentTypeKeys = ["content type", "type", "source type", "specific type", "media type", "post type", "kind"];
const authorKeys = ["author", "author name", "author_name", "user", "username", "handle"];
const sentimentKeys = ["sentiment", "sentiment label", "sentiment_label"];
const sentimentScoreKeys = ["sentiment score", "sentiment_score", "score"];
const languageKeys = ["language", "lang"];
const countryKeys = ["country", "location country", "country_code"];
const idKeys = ["id", "mention id", "mention_id", "external id", "external_id", "url"];
const engagementKeys = [
  "likes",
  "comments",
  "shares",
  "reposts",
  "views",
  "engagement",
  "interactions",
  "reach"
];

export function parseSentioneCsv(input: string) {
  const delimiter = detectDelimiter(input);
  const records = parseDelimited(input, delimiter);

  if (records.length === 0) {
    return [];
  }

  const [header = [], ...body] = records;
  const normalizedHeader = header.map((cell) => normalizeKey(cell));

  return body
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) =>
      normalizedHeader.reduce<CsvRow>((acc, key, index) => {
        acc[key || `column_${index + 1}`] = row[index]?.trim() ?? "";
        return acc;
      }, {})
    );
}

// Conservative chunk size. Postgres hard-caps a query at 65535 parameters.
// Each mention insert binds ~22 columns, so 200 rows ≈ 4400 params — way under
// the limit, leaves headroom, and keeps individual transactions snappy so a
// single failed chunk doesn't roll back hours of work on huge industry CSVs.
const BATCH_SIZE = 200;

export async function ingestSentioneCsv(params: {
  corpusId: string;
  importBatchId: string;
  sourceFileName: string;
  csvText: string;
}) {
  const rows = parseSentioneCsv(params.csvText);
  const seenHashes = new Set<string>();
  const stats: CsvImportStats = {
    record_count: rows.length,
    included_count: 0,
    excluded_count: 0,
    duplicate_count: 0
  };

  const normalized = rows.map((row) => normalizeMention(row, params.sourceFileName));

  // Deduplicate within this file before hitting the DB
  const unique = normalized.filter((m) => {
    if (seenHashes.has(m.textHash)) {
      stats.duplicate_count += 1;
      return false;
    }
    seenHashes.add(m.textHash);
    return true;
  });

  // Batch insert in chunks. We surround each chunk in its own try/catch so a
  // single problematic chunk (oversize row, weird character, etc.) doesn't
  // throw away the entire CSV — the rest of the file still lands and the user
  // gets accurate stats.
  let failedChunks = 0;
  const totalChunks = Math.ceil(unique.length / BATCH_SIZE);

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);

    const values = chunk.map((m) => ({
      studyCorpusId: params.corpusId,
      externalId: `${params.corpusId}:${m.externalId}`.slice(0, 500),
      sourceSystem: "sentione_csv",
      sourceFileId: params.importBatchId,
      textHash: m.textHash,
      textRaw: m.textRaw,
      textClean: m.textClean,
      textSnippet: m.textSnippet,
      title: m.title,
      textLength: m.textLength,
      language: m.language,
      publishedAt: m.publishedAt,
      platform: m.platform,
      url: m.url,
      country: m.country,
      engagement: m.engagement,
      sentimentSource: m.sentimentSource,
      sentimentScore: m.sentimentScore,
      qualityScore: m.inclusionStatus === "included" ? 7 : 2,
      inclusionStatus: m.inclusionStatus,
      exclusionReason: m.exclusionReason,
      qualityFlags: m.qualityFlags,
      rawMetadata: m.rawMetadata
    }));

    try {
      const inserted = await db
        .insert(mentions)
        .values(values)
        .onConflictDoNothing({ target: [mentions.studyCorpusId, mentions.textHash] })
        .returning({ id: mentions.id, inclusionStatus: mentions.inclusionStatus });

      // Count by actual DB outcome (conflicts count as duplicates)
      const conflictCount = chunk.length - inserted.length;
      stats.duplicate_count += conflictCount;

      for (const row of inserted) {
        if (row.inclusionStatus === "included") {
          stats.included_count += 1;
        } else {
          stats.excluded_count += 1;
        }
      }
    } catch (err) {
      failedChunks += 1;
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      console.error(`[csv-ingest] chunk ${Math.floor(i / BATCH_SIZE) + 1}/${totalChunks} failed: ${msg}`);
      // Continue with the rest of the file — partial success beats total loss
    }
  }

  if (failedChunks > 0) {
    console.warn(`[csv-ingest] ${failedChunks}/${totalChunks} chunks failed; ${stats.included_count + stats.excluded_count} mentions ingested anyway`);
  }

  return stats;
}

export function fileHash(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeMention(row: CsvRow, sourceFileName: string): NormalizedMention {
  const textRaw = pick(row, textKeys) || pick(row, titleKeys) || "";
  const textClean = cleanText(textRaw);
  const textHash = hashText(textClean);
  const title = pick(row, titleKeys) || null;
  const publishedAt = parseDate(pick(row, dateKeys)) ?? new Date(0);
  const url = pick(row, urlKeys) || null;
  const platform = normalizePlatform(row, url);
  const contentType = normalizeContentType(pick(row, contentTypeKeys));
  const sentimentSource = normalizeSentiment(pick(row, sentimentKeys));
  const sentimentScore = parseSentimentScore(pick(row, sentimentScoreKeys) || sentimentSource);
  const country = normalizeCountry(pick(row, countryKeys));
  const language = normalizeLanguage(pick(row, languageKeys));
  const tooShort = textClean.length < 30;

  return {
    externalId: buildExternalId(row, textHash),
    textRaw,
    textClean,
    textSnippet: textClean.slice(0, 220),
    title,
    textLength: textClean.length,
    language,
    publishedAt,
    platform,
    url,
    country,
    engagement: extractEngagement(row),
    sentimentSource,
    sentimentScore,
    inclusionStatus: tooShort ? "excluded" : "included",
    exclusionReason: tooShort ? "text_under_30_chars" : null,
    qualityFlags: {
      text_under_30_chars: tooShort,
      missing_date: publishedAt.getTime() === 0,
      missing_platform: platform === "unknown"
    },
    rawMetadata: {
      source_file_name: sourceFileName,
      author: pick(row, authorKeys) || null,
      content_type: contentType,
      row
    },
    textHash
  };
}

function parseDelimited(input: string, delimiter: string) {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }

  return records;
}

function detectDelimiter(input: string) {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ";" : ",";
}

function pick(row: CsvRow, keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeKey(key)];
    if (value) {
      return value;
    }
  }

  return "";
}

function normalizeKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function hashText(text: string) {
  return crypto.createHash("sha256").update(text.toLowerCase()).digest("hex");
}

function buildExternalId(row: CsvRow, textHash: string) {
  const sourceId = pick(row, idKeys);
  return sourceId ? sourceId.slice(0, 500) : `csv_${textHash.slice(0, 24)}`;
}

function parseDate(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePlatform(row: CsvRow, url: string | null) {
  const haystack = [
    url ?? "",
    ...platformKeys.map((key) => pick(row, [key])),
    ...Object.values(row)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const known = detectKnownPlatform(haystack);
  if (known) return known;

  const candidate = pick(row, platformKeys);
  const normalized = normalizeToken(candidate);
  if (!normalized || isContentTypeToken(normalized)) return "unknown";
  return normalized;
}

function detectKnownPlatform(value: string) {
  const rules: Array<[RegExp, string]> = [
    [/\btik\s*tok\b|tiktok\.com|douyin/i, "tiktok"],
    [/\btwitter\b|\bx\b|x\.com|twitter\.com/i, "x"],
    [/\binstagram\b|instagram\.com/i, "instagram"],
    [/\bfacebook\b|facebook\.com|fb\.com/i, "facebook"],
    [/\byoutube\b|youtu\.be|youtube\.com/i, "youtube"],
    [/\breddit\b|reddit\.com/i, "reddit"],
    [/\blinkedin\b|linkedin\.com/i, "linkedin"],
    [/\bthreads\b|threads\.net/i, "threads"],
    [/\btelegram\b|t\.me/i, "telegram"],
    [/\bwhatsapp\b|wa\.me/i, "whatsapp"],
    [/\btrustpilot\b|trustpilot\./i, "trustpilot"],
    [/\bgoogle\b|google\./i, "google"],
    [/\bnews\b|newspaper|article|press|media outlet/i, "news"],
    [/\bblog\b|blogspot|wordpress|medium\.com/i, "blog"],
    [/\bforum\b|community/i, "forum"]
  ];
  return rules.find(([regex]) => regex.test(value))?.[1] ?? null;
}

function normalizeContentType(value: string) {
  const token = normalizeToken(value);
  return token || null;
}

function normalizeToken(value: string) {
  return value
    ? value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "";
}

function isContentTypeToken(value: string) {
  return /^(comment|comments|comentario|comentarios|video|short|shorts|post|posts|tweet|tweets|article|articles|news|reel|reels|story|stories|image|photo|photos|forum_post)$/.test(value);
}

function normalizeSentiment(value: string) {
  return value ? value.toLowerCase() : null;
}

function parseSentimentScore(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  const numeric = Number(normalized.replace(",", "."));

  if (Number.isFinite(numeric)) {
    return String(Math.max(-1, Math.min(1, numeric)));
  }

  if (normalized.includes("positive") || normalized.includes("positivo")) {
    return "1";
  }

  if (normalized.includes("negative") || normalized.includes("negativo")) {
    return "-1";
  }

  if (normalized.includes("neutral")) {
    return "0";
  }

  return null;
}

function normalizeCountry(value: string) {
  return value ? value.trim().slice(0, 2).toUpperCase() : null;
}

function normalizeLanguage(value: string) {
  return value ? value.trim().slice(0, 2).toLowerCase() : null;
}

function extractEngagement(row: CsvRow) {
  return engagementKeys.reduce<Record<string, number>>((acc, key) => {
    const value = row[normalizeKey(key)];
    const parsed = Number(value?.replace(/,/g, ""));

    if (Number.isFinite(parsed)) {
      acc[normalizeKey(key).replace(/\s+/g, "_")] = parsed;
    }

    return acc;
  }, {});
}
