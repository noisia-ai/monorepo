/**
 * Grupo Salinas dashboard — data normalizer.
 *
 * Reads synthetic Apify-style payloads (Clockworks TikTok scraper,
 * Streamers YouTube scraper, Apify Instagram Reel scraper) and
 * normalizes them into a single Video model the dashboard consumes.
 *
 * The `_noisia_metrics` fields (completionRate, retentionCurve, viewsByDay)
 * are enriched on top of the raw Apify response — in production they would
 * come from each platform's analytics API (TikTok Studio, YouTube Analytics,
 * Meta Insights), not the public scraper.
 */

import tiktokRaw from "@/content/dashboards/grupo-salinas/tiktok.json";
import youtubeRaw from "@/content/dashboards/grupo-salinas/youtube.json";
import instagramRaw from "@/content/dashboards/grupo-salinas/instagram.json";

export type Platform = "TikTok" | "YouTube" | "Instagram";
export type Brand =
  | "Elektra"
  | "Banco Azteca"
  | "TV Azteca"
  | "Italika"
  | "Total Play";

export const BRANDS: Brand[] = [
  "Elektra",
  "Banco Azteca",
  "TV Azteca",
  "Italika",
  "Total Play",
];
export const PLATFORMS: Platform[] = ["TikTok", "YouTube", "Instagram"];

export type NoisiaMetrics = {
  completionRate: number; // 0-1
  averageWatchSeconds: number;
  retentionCurve: number[]; // 10 points, normalized 0-1
  viewsByDay: number[]; // daily cumulative views since publish
};

export type Video = {
  id: string;
  platform: Platform;
  brand: Brand;
  account: string; // handle or channel name
  verified: boolean;
  caption: string;
  thumbnailUrl: string | null;
  url: string;
  publishedAt: string; // ISO
  durationSeconds: number;
  views: number;
  likes: number;
  comments: number;
  shares: number; // 0 for IG/YT (not exposed via scrapers)
  saves: number; // 0 for YT
  hashtags: string[];
  metrics: NoisiaMetrics;
};

// ─── Normalizers per source ──────────────────────────────────────────────────

type TikTokRaw = (typeof tiktokRaw)[number];
type YouTubeRaw = (typeof youtubeRaw)[number];
type InstagramRaw = (typeof instagramRaw)[number];

function normalizeTikTok(v: TikTokRaw): Video {
  return {
    id: v.id,
    platform: "TikTok",
    brand: v._noisia_brand as Brand,
    account: `@${v.authorMeta.name}`,
    verified: v.authorMeta.verified,
    caption: v.text,
    thumbnailUrl: v.videoMeta.coverUrl,
    url: v.webVideoUrl,
    publishedAt: v.createTimeISO,
    durationSeconds: v.videoMeta.duration,
    views: v.playCount,
    likes: v.diggCount,
    comments: v.commentCount,
    shares: v.shareCount,
    saves: v.collectCount,
    hashtags: v.hashtags.map((h) => h.name),
    metrics: {
      completionRate: v._noisia_metrics.completionRate,
      averageWatchSeconds: v._noisia_metrics.averageWatchTime,
      retentionCurve: v._noisia_metrics.retentionCurve,
      viewsByDay: v._noisia_metrics.viewsByDay,
    },
  };
}

function normalizeYouTube(v: YouTubeRaw): Video {
  return {
    id: v.id,
    platform: "YouTube",
    brand: v._noisia_brand as Brand,
    account: v.channelName,
    verified: true,
    caption: v.title,
    thumbnailUrl: v.thumbnailUrl,
    url: v.url,
    publishedAt: v.publishedAt,
    durationSeconds: v.durationSeconds,
    views: v.viewCount,
    likes: v.likes,
    comments: v.commentsCount,
    shares: 0,
    saves: 0,
    hashtags: v.tags,
    metrics: {
      completionRate: v._noisia_metrics.completionRate,
      averageWatchSeconds: v._noisia_metrics.averageWatchDurationSeconds,
      retentionCurve: v._noisia_metrics.retentionCurve,
      viewsByDay: v._noisia_metrics.viewsByDay,
    },
  };
}

function normalizeInstagram(v: InstagramRaw): Video {
  return {
    id: v.id,
    platform: "Instagram",
    brand: v._noisia_brand as Brand,
    account: `@${v.ownerUsername}`,
    verified: v.isVerified,
    caption: v.caption,
    thumbnailUrl: v.displayUrl,
    url: v.url,
    publishedAt: v.timestamp,
    durationSeconds: v.videoDuration,
    views: v.videoViewCount,
    likes: v.likesCount,
    comments: v.commentsCount,
    shares: 0,
    saves: 0,
    hashtags: v.hashtags,
    metrics: {
      completionRate: v._noisia_metrics.completionRate,
      averageWatchSeconds: v._noisia_metrics.averageWatchTime,
      retentionCurve: v._noisia_metrics.retentionCurve,
      viewsByDay: v._noisia_metrics.viewsByDay,
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function loadAllVideos(): Video[] {
  return [
    ...tiktokRaw.map(normalizeTikTok),
    ...youtubeRaw.map(normalizeYouTube),
    ...instagramRaw.map(normalizeInstagram),
  ].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

// ─── Filtering ───────────────────────────────────────────────────────────────

export type DateRange = "24h" | "7d" | "30d" | "90d" | "12m" | "all";

export type Filters = {
  range: DateRange;
  platforms: Platform[]; // empty = all
  brands: Brand[]; // empty = all
};

export const DEFAULT_FILTERS: Filters = {
  range: "12m",
  platforms: [],
  brands: [],
};

function rangeToMs(range: DateRange): number | null {
  switch (range) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    case "90d":
      return 90 * 24 * 60 * 60 * 1000;
    case "12m":
      return 365 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

export function applyFilters(videos: Video[], f: Filters, now = Date.now()): Video[] {
  const cutoff = rangeToMs(f.range);
  return videos.filter((v) => {
    if (cutoff !== null && now - new Date(v.publishedAt).getTime() > cutoff)
      return false;
    if (f.platforms.length > 0 && !f.platforms.includes(v.platform)) return false;
    if (f.brands.length > 0 && !f.brands.includes(v.brand)) return false;
    return true;
  });
}

// ─── Aggregations ────────────────────────────────────────────────────────────

export type Summary = {
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  averageEngagementRate: number; // weighted
  averageCompletionRate: number; // weighted by views
};

export function summarize(videos: Video[]): Summary {
  if (videos.length === 0) {
    return {
      videoCount: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaves: 0,
      averageEngagementRate: 0,
      averageCompletionRate: 0,
    };
  }

  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  const totalLikes = videos.reduce((s, v) => s + v.likes, 0);
  const totalComments = videos.reduce((s, v) => s + v.comments, 0);
  const totalShares = videos.reduce((s, v) => s + v.shares, 0);
  const totalSaves = videos.reduce((s, v) => s + v.saves, 0);
  const engagementSum = videos.reduce((s, v) => s + engagementRate(v) * v.views, 0);
  const completionSum = videos.reduce((s, v) => s + v.metrics.completionRate * v.views, 0);

  return {
    videoCount: videos.length,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalSaves,
    averageEngagementRate: totalViews > 0 ? engagementSum / totalViews : 0,
    averageCompletionRate: totalViews > 0 ? completionSum / totalViews : 0,
  };
}

export function engagementRate(v: Video): number {
  if (v.views === 0) return 0;
  return (v.likes + v.comments + v.shares + v.saves) / v.views;
}

export function rankByEngagement(videos: Video[]): Video[] {
  return [...videos].sort((a, b) => engagementRate(b) - engagementRate(a));
}

export function rankByViews(videos: Video[]): Video[] {
  return [...videos].sort((a, b) => b.views - a.views);
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString("es-MX");
}

export function formatPercent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function relativeDays(iso: string, now = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}
