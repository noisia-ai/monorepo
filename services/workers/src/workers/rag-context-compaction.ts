import { parseQueryStrategyBriefJson } from "@noisia/query-engine";

export function compactKnowledgeContent(title: string, content: unknown, rawText: string | null) {
  const source = content && typeof content === "object" ? content as Record<string, unknown> : {};
  if (source.source === "query_strategy_brief") {
    const brief = parseQueryStrategyBriefJson(JSON.stringify(source));
    return {
      title,
      source: "query_strategy_brief",
      ...brief,
      recommended_use: compactStringArray(source.recommended_use, 8, 80)
    };
  }

  return {
    title,
    source_kind: compactString(source.source_kind ?? source.source_type ?? source.type, 80),
    summary: compactString(source.summary ?? source.description ?? rawText, 2400),
    key_findings: compactStringArray(
      source.key_findings ?? source.findings ?? source.priority_topics ?? source.topics,
      16,
      320
    ),
    fields: compactStringArray(source.fields ?? source.columns ?? source.metric_fields, 24, 100),
    recommended_use: compactStringArray(source.recommended_use, 8, 80),
    raw_text_excerpt: rawText ? rawText.slice(0, 1200) : undefined
  };
}

function compactString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function compactStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => typeof item === "string" ? [compactString(item, maxLength)] : [])
    .filter(Boolean)
    .slice(0, maxItems);
}
