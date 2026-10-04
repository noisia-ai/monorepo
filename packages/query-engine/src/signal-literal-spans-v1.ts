/** Shared literal evidence mechanics. Offsets use UTF-16 code units, matching JS strings. */
export const LITERAL_SPAN_MAX_UTF16_V1 = 320;
export type LiteralSpanV1 = {
  span_id: string;
  root_ordinal: number;
  chunk_index: number;
  quote_start: number;
  quote_end: number;
  quote: string;
  chunk_sha256: string;
};
/** Lossless UTF-16 partition. Whitespace and punctuation remain in exactly one span. */
export function partitionLiteralSpansV1(
  text: string,
): { start: number; end: number; text: string }[] {
  const parts: { start: number; end: number; text: string }[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + LITERAL_SPAN_MAX_UTF16_V1, text.length);
    // Never cut a surrogate pair: citation offsets remain valid JS/PG UTF-16 offsets.
    if (
      end < text.length &&
      end > start + 1 &&
      /[\uD800-\uDBFF]/u.test(text[end - 1]!) &&
      /[\uDC00-\uDFFF]/u.test(text[end]!)
    )
      end--;
    const minEnd = Math.min(start + 64, end);
    for (let cursor = minEnd; cursor < end; cursor++) {
      if (/[.!?;\n]/u.test(text[cursor - 1]!)) {
        end = cursor;
        break;
      }
    }
    if (end <= start)
      (() => {
        throw new Error("interest_decision_v2_span_partition_invalid");
      })();
    parts.push({ start, end, text: text.slice(start, end) });
    start = end;
  }
  return parts;
}

export function reconstructLiteralCitationV1(
  spans: Map<string, LiteralSpanV1>,
  spanId: string,
  rootOrdinal: number,
  seen: Set<string>,
) {
  const span = spans.get(spanId);
  if (
    !span ||
    span.root_ordinal !== rootOrdinal ||
    seen.has(spanId) ||
    !span.quote.trim()
  )
    throw new Error("interest_decision_v2_span_id_invalid");
  seen.add(spanId);
  return {
    chunk_index: span.chunk_index,
    chunk_sha256: span.chunk_sha256,
    quote_start: span.quote_start,
    quote_end: span.quote_end,
    quote: span.quote,
  };
}
