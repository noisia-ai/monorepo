const BASE_URL = process.env.SENTIONE_BASE_URL ?? "https://sentione.com/api/public/v2";
const API_KEY = process.env.SENTIONE_API_KEY ?? "";

export type SentiOneMention = {
  id: string;
  source: { type: string; mentionUrl?: string };
  content: {
    title: string | null;
    text: string | null;
    language: { code: string } | null;
    sentiment: "Positive" | "Negative" | "Neutral" | "Unspecified";
  };
  author: { id: string | null; name: string | null };
  location: { country: { code: string } | null } | null;
  publishedAt: string;
  engagementMetrics: {
    influenceScore: number | null;
    sourceMetrics: {
      common: {
        likeCount: number | null;
        shareCount: number | null;
        commentCount: number | null;
        viewCount: number | null;
      } | null;
    } | null;
  } | null;
};

type SearchFilters = {
  query?: string;
  publishedAtFrom?: string;
  publishedAtTo?: string;
  languages?: string[];
};

type SearchResponse = {
  data: SentiOneMention[];
  cursor: string | null;
};

export async function fetchRecentSample(
  projectId: number,
  filters: SearchFilters,
  limit: number
): Promise<SentiOneMention[]> {
  const results: SentiOneMention[] = [];
  let cursor: string | null = null;

  const body: Record<string, unknown> = {
    sortType: "PublishedAtDescending",
    filters: buildFilters(filters)
  };

  while (results.length < limit) {
    const url = cursor
      ? `${BASE_URL}/projects/${projectId}/mentions/recent/search?cursor=${encodeURIComponent(cursor)}`
      : `${BASE_URL}/projects/${projectId}/mentions/recent/search`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`SentiOne API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const page = (await response.json()) as SearchResponse;
    results.push(...page.data);

    if (!page.cursor || page.data.length === 0) {
      break;
    }

    cursor = page.cursor;
  }

  return results.slice(0, limit);
}

export async function fetchHistoricalSample(
  projectId: number,
  filters: SearchFilters,
  limit: number
): Promise<SentiOneMention[]> {
  const results: SentiOneMention[] = [];
  let cursor: string | null = null;

  const body: Record<string, unknown> = {
    sortType: "PublishedAtDescending",
    filters: buildFilters(filters)
  };

  while (results.length < limit) {
    const url = cursor
      ? `${BASE_URL}/projects/${projectId}/mentions/search?cursor=${encodeURIComponent(cursor)}`
      : `${BASE_URL}/projects/${projectId}/mentions/search`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`SentiOne API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const page = (await response.json()) as SearchResponse;
    results.push(...page.data);

    if (!page.cursor || page.data.length === 0) {
      break;
    }

    cursor = page.cursor;
  }

  return results.slice(0, limit);
}

function buildFilters(filters: SearchFilters) {
  const result: Record<string, unknown> = {};

  if (filters.publishedAtFrom || filters.publishedAtTo) {
    result["publishedAt"] = {
      ...(filters.publishedAtFrom ? { from: filters.publishedAtFrom } : {}),
      ...(filters.publishedAtTo ? { to: filters.publishedAtTo } : {})
    };
  }

  const contentFilter: Record<string, unknown> = {};

  if (filters.query) {
    // SentiOne content.query max is 250 chars
    contentFilter["query"] = filters.query.slice(0, 250);
  }

  if (filters.languages && filters.languages.length > 0) {
    contentFilter["language"] = filters.languages.map((code) => ({ code }));
  }

  if (Object.keys(contentFilter).length > 0) {
    result["content"] = contentFilter;
  }

  return result;
}
