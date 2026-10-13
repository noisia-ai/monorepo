import { createHash } from "node:crypto";
import { parseAnthropicResponseV1, parseFacetGroupV1, type FacetInput, type FacetResult } from "@noisia/query-engine";
import type { LabelingCallV1, LabelingRunV1 } from "@noisia/db";
import type { AnthropicBatchItem } from "../providers/anthropic-message-batches";

export type StoredFacetReplayCall = LabelingCallV1<FacetInput> & {
  raw_sha256: string; settled_micro_usd: number; results: FacetResult[];
};
/** Offline plan only: no DB writes, leases, settlement or provider capability. */
export function planStoredFacetReplayV1(args: {
  run: LabelingRunV1; calls: StoredFacetReplayCall[];
  pending_root_ids: string[]; valid_root_ids: string[];
}) {
  const pending = new Set(args.pending_root_ids), valid = new Set(args.valid_root_ids);
  if(pending.size !== args.pending_root_ids.length || valid.size !== args.valid_root_ids.length
    || [...pending].some(root=>valid.has(root))) throw new Error("facet_replay_population_invalid");
  const replayed = new Set<string>();
  const pages: Array<{call_id:string;raw_sha256:string;results:FacetResult[];replayed_root_ids:string[]}> = [];
  for(const call of args.calls) {
    const candidates = call.results.filter(result=>pending.has(result.root_id)
      && result.status === "error" && result.error_code === "invalid_facets");
    if(!candidates.length)continue;
    if(call.status !== "settled" || !call.results_applied || !Number.isSafeInteger(call.settled_micro_usd)
      || call.settled_micro_usd < 0 || !call.raw_body
      || `sha256:${createHash("sha256").update(call.raw_body).digest("hex")}` !== call.raw_sha256)
      throw new Error("facet_replay_receipt_invalid");
    const raw=JSON.parse(call.raw_body) as AnthropicBatchItem;
    if(raw.custom_id !== call.custom_id || raw.result.type !== "succeeded")throw new Error("facet_replay_receipt_invalid");
    const response=parseAnthropicResponseV1(raw.result.message);
    if(response.status !== "ok")throw new Error("facet_replay_response_invalid");
    const parsed=parseFacetGroupV1(response.text!,call.inputs,args.run.context,args.run.identity);
    if(parsed.split)throw new Error("facet_replay_response_invalid");
    const replacements = new Map<string,FacetResult>();
    for(const previous of candidates) {
      const next=parsed.results.find(result=>result.root_id === previous.root_id);
      if(!next || next.status === "error" || !next.normalizations?.some(n=>n.dimension === "asunto"
        && n.reason === "exceeds_word_limit") || next.input_digest !== previous.input_digest
        || next.entity_context_digest !== previous.entity_context_digest || replayed.has(next.root_id))
        throw new Error("facet_replay_target_invalid");
      replacements.set(next.root_id,next);replayed.add(next.root_id);
    }
    pages.push({call_id:call.id,raw_sha256:call.raw_sha256,
      results:call.results.map(previous=>replacements.get(previous.root_id)??previous),
      replayed_root_ids:[...replacements.keys()]});
  }
  return {pages,replayed_root_ids:[...replayed].sort(),
    recovery_root_ids:[...pending].filter(root=>!replayed.has(root)).sort(),provider_sends:0 as const};
}
