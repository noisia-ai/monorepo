import {
  loadSignalWorkspaceMentionsV1,
  type SignalWorkspaceMentionsArgsV1,
  type SignalWorkspaceMentionsPageV1
} from "@noisia/db";
import { SIGNAL_BACKEND_CONTRACT_VERSION } from "@noisia/query-engine";
import type { SignalMentionRecordV1 } from "./signal-workspace-serving";
import type { SignalMentionsViewData, SignalNativeMentionsMetadata } from "@/components/signal-v2/SignalV2Mentions";
import { nativeTopicsViewV1 } from "./signal-workspace-topics-native";

type ActorScope = { workspace_id: string; actor_user_id: string };
type ReadArgs = Omit<SignalWorkspaceMentionsArgsV1, "database">;
type Query = Omit<ReadArgs, keyof ActorScope>;
export type NativeSignalMentionsViewData = SignalMentionsViewData & {
  native: SignalNativeMentionsMetadata;
  record?: SignalMentionRecordV1;
};
type Dependencies = { read?: (args: ReadArgs) => Promise<SignalWorkspaceMentionsPageV1 | null> };

function invalid(code = "workspace_mentions_filter_invalid"): never {
  throw Object.assign(new Error("Check the mention filters and try again."), { code, status: 422 });
}

/** Only controls implemented by the generation reader may reach this endpoint. */
export function nativeMentionsQueryV1(params: URLSearchParams): Query {
  const allowed = new Set(["view", "date_from", "date_to", "start", "end", "timezone", "granularity",
    "compare", "q", "platform", "sort", "direction", "cursor", "scope_digest", "limit", "mention", "offset"]);
  if ([...params.keys()].some(key => !allowed.has(key)) || params.toString().length > 12_000)
    return invalid("workspace_mentions_filter_unsupported");
  for (const key of params.keys()) {
    if (key !== "platform" && new Set(params.getAll(key)).size > 1) return invalid();
  }
  if (!nativeTopicsViewV1(params) || params.has("timezone") && params.get("timezone") !== "UTC"
    || params.has("granularity") && params.get("granularity") !== "day"
    || params.has("compare") && params.get("compare") !== "none"
    || params.has("sort") && params.get("sort") !== "published"
    || params.has("offset") && params.get("offset") !== "0") return invalid("workspace_mentions_filter_unsupported");
  const date = (canonical: string, alias: string) => {
    if (params.has(canonical) && params.has(alias) && params.get(canonical) !== params.get(alias)) return invalid();
    const value = params.get(canonical) ?? params.get(alias);
    if (value === null) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number(value.slice(0, 4)) < 1 || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString().slice(0, 10) !== value) return invalid();
    return value;
  };
  const date_from = date("date_from", "start"), date_to = date("date_to", "end");
  if (date_from && date_to && date_from > date_to) return invalid();
  const search_query = params.get("q")?.trim() || undefined;
  if (search_query && (search_query.length > 300 || search_query.includes("\0"))) return invalid();
  const platforms = [...new Set(params.getAll("platform").map(value => value.trim()))].sort();
  if (platforms.length > 20 || platforms.some(value => !value || value.length > 100 || value.includes("\0"))) return invalid();
  const sort_direction = params.get("direction") ?? "desc";
  if (sort_direction !== "asc" && sort_direction !== "desc") return invalid();
  const rawLimit = params.get("limit") ?? "50";
  if (!/^\d+$/u.test(rawLimit)) return invalid();
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return invalid();
  const cursor = params.get("cursor") ?? undefined;
  if (cursor !== undefined && (!cursor || cursor.length > 2048)) return invalid();
  const expected_scope_digest = params.get("scope_digest") ?? undefined;
  if (expected_scope_digest !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(expected_scope_digest)) return invalid();
  const focus_mention_id = params.get("mention")?.toLowerCase() ?? undefined;
  if (focus_mention_id !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(focus_mention_id)) return invalid();
  if (cursor && focus_mention_id) return invalid();
  return { ...(date_from ? { date_from } : {}), ...(date_to ? { date_to } : {}),
    ...(search_query ? { search_query } : {}), platforms, sort_direction, limit,
    ...(cursor ? { cursor } : {}), ...(expected_scope_digest ? { expected_scope_digest } : {}),
    ...(focus_mention_id ? { focus_mention_id } : {}) };
}

function scalar(value: string | null) {
  const result = value?.trim();
  return result && !/^[\s"'“”‘’«»]+$/u.test(result) ? result : null;
}

function originalMentionUrl(value: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

export function nativeMentionsViewDataV1(page: SignalWorkspaceMentionsPageV1, limit: number,
  focusedMentionId?: string, validatedPageCursor?: string | null): NativeSignalMentionsViewData {
  const records: SignalMentionRecordV1[] = page.items.map(item => ({
    subject_id: item.mention_id,
    // Empty means undated in the shared table; never synthesize a publication date.
    occurred_at: item.occurred_at ?? "", text_snippet: item.text_snippet,
    title: scalar(item.title), url: originalMentionUrl(item.url), platform: item.platform,
    language: scalar(item.language), country: scalar(item.country), content_type: item.content_type ?? "unknown",
    conversation_role: item.content_type === "comment" ? "comment" : "root_post",
    sentiment: null, sentiment_score: null, engagement: item.engagement,
    interaction_count: ["likes", "comments", "shares", "reposts", "saves"].reduce((sum, key) => {
      const value = Number(item.engagement[key]);
      return sum + (Number.isFinite(value) && value >= 0 ? value : 0);
    }, 0),
    thread_key: item.thread_key,
    // No legacy attribution or enrichment is joined into this generation.
    tags: [], entities: [], features: [], attribution: [], tb_classification: null
  }));
  const focused = focusedMentionId ? records.find(item => item.subject_id === focusedMentionId) : undefined;
  if (focusedMentionId && !focused) throw Object.assign(new Error("Mention is unavailable in this view."), {
    code: "workspace_mentions_not_found", status: 404
  });
  return { contract_version: SIGNAL_BACKEND_CONTRACT_VERSION, metric_key: "mention.volume",
    filters_hash: page.scope_digest, total_count: page.total_count, records,
    page: { limit, offset: page.page_offset, next_cursor: page.next_cursor,
      next_offset: page.next_cursor ? page.page_offset + records.length : null },
    filter: { contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
      // These bounds only support the existing visual primitives. Requests use native.filters;
      // an all-time view must continue to include undated roots.
      date_range: { start: page.filters.date_from ?? page.available_dates.date_from ?? "",
        end: page.filters.date_to ?? page.available_dates.date_to ?? "" },
      timezone: "UTC", granularity: "day", dimensions: page.filters.platforms.length ? { platform: page.filters.platforms } : {},
      ...(page.filters.search_query ? { search_query: page.filters.search_query } : {}) },
    comparison: { mode: "none", date_range: null },
    native: { workspace_id: page.workspace_id, generation_id: page.generation_id, scope_digest: page.scope_digest,
      is_current: page.is_current, is_processing: page.is_processing, available_dates: page.available_dates,
      available_platforms: page.available_platforms,
      page_cursor: validatedPageCursor ?? null,
      filters: page.filters, sort_direction: page.sort.direction, metric_denominator: page.metric_denominator,
      evidence_visible_total: page.evidence_visible_total, withheld_evidence_count: page.withheld_evidence_count,
      integrity_withheld_count: page.integrity_withheld_count },
    ...(focused ? { record: focused } : {}) };
}

export async function loadNativeSignalMentionsV1(scope: ActorScope, params = new URLSearchParams(),
  dependencies: Dependencies = {}): Promise<NativeSignalMentionsViewData | null> {
  if (!nativeTopicsViewV1(params)) return null;
  const read = dependencies.read ?? (async (args: ReadArgs) => {
    const { pool } = await import("@/lib/db");
    return loadSignalWorkspaceMentionsV1({ database: pool, ...args });
  });
  let query: Query | null = null, error: unknown;
  try { query = nativeMentionsQueryV1(params); } catch (caught) { error = caught; }
  // Probe only for the native/legacy distinction. Invalid native filters never reach a broader response.
  const page = await read({ ...scope, ...(query ?? { limit: 1 }) });
  if (!page) return null;
  if (error) throw error;
  if (page.workspace_id !== scope.workspace_id || !page.is_current) throw Object.assign(new Error("Mention view changed."), {
    code: "workspace_mentions_scope_changed", status: 409
  });
  return nativeMentionsViewDataV1(page, query?.limit ?? 50, query?.focus_mention_id ?? undefined, query?.cursor);
}

export function nativeMentionsErrorResponseV1(error: unknown) {
  const known = error instanceof Error && "code" in error && typeof error.code === "string"
    && /^(workspace_mentions_|workspace_topics_)/u.test(error.code);
  const status = known && "status" in error && typeof error.status === "number"
    && [400, 401, 403, 404, 409, 422, 503].includes(error.status) ? error.status : 503;
  return Response.json({ error: known ? error.code : "workspace_mentions_unavailable",
    message: "Mentions could not be loaded. Refresh and try again." }, {
    status, headers: { "Cache-Control": "private, no-store" }
  });
}
