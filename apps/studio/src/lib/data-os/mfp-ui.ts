import type { MentionFacetsV1, HybridJevDecisionV1, HybridClaudeDecisionV1 } from "@noisia/query-engine";

export type MfpRun = { id:string; status:string; estimated_micro_usd:string|number; settled_micro_usd:string|number;
  reserved_micro_usd:string|number; budget_micro_usd:string|number|null; cap_micro_usd:string|number|null;
  waiting_full_confirmation?:boolean; error_code:string|null };
export type MfpFacetStatus = { contract_version:"mention-facets-status-v1"; enabled:boolean; provider_available:boolean;
  counts:Array<{status:string;relevance:string;count:number}>; latest:MfpRun|null; pending:number;
  estimated_micro_usd:string|number; estimated_full_micro_usd?:string|number; stale_count:number; entity_context_digest:string };
export type MfpFacetPage = {contract_version:"mention-facets-browser-v1";workspace_id:string;
  can_edit:boolean;can_request_processing:boolean;labeler_status:string|null;
  entities:Array<{entity_id:string;name:string;kind:"primary_brand"|"competitor"|"category"}>;
  distributions:Array<{dimension:string;value:string;count:number}>;
  items:Array<{root_id:string;text:string;title:string|null;url:string|null;platform:string|null;status:string;
    relevance:string;facets:MentionFacetsV1|null;human_dimensions:string[];requires_context_review:boolean;pending_context_review:boolean}>;next_cursor:string|null};
export type MfpEvidence = {root_id:string;concept_key:string;definition_digest:string;verdict:string;
  citations:Array<{quote:string;quote_start:number;quote_end:number;chunk_index:number;chunk_sha256:string}>;
  hybrid_review?:{jev:HybridJevDecisionV1;claude:HybridClaudeDecisionV1|null}|null;
  decided_via?:"human_ui"|"agent_assisted"|null;eligible_for_human_evaluation?:boolean;
  rationale:string|null;source:"human"|"model"|"pending";text:string|null;title:string|null;url:string|null;platform:string|null;evidence_withheld?:boolean;requires_override_review?:boolean};
export type MfpMembershipStatus = {contract_version:"concept-membership-status-v1";enabled:boolean;provider_available:boolean;
  can_request_processing:boolean;can_edit_topics:boolean;entity_context_digest:string;route?:"standard"|"hybrid_h1";
  counts:Array<{verdict:string;count:number}>;population:{relevant:number;unrelated:number;unknown:number;spam:number;without_concept:number};
  concepts:Array<{concept_key:string;label:string;definition_digest:string;selected:boolean;selection_revision:number}>;
  estimated_micro_usd:string|number|null;preview_estimated_micro_usd:string|number|null;latest:MfpRun|null;items:MfpEvidence[];next_cursor:string|null};
export type MfpPreview = {contract_version:"concept-membership-preview-v1";run:MfpRun;items:MfpEvidence[];sample_size:number};

export function mfpMoney(value:string|number|null|undefined,locale:string) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(locale,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(value)/1e6);
}
export function mfpSafeUrl(value:string|null|undefined) {
  if (!value) return null;
  try { const url = new URL(value); return ["https:","http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
/** Highlight only literal source text; offsets from chunk-local citations are never trusted as root offsets. */
export function mfpQuoteParts(text:string,quotes:string[]) {
  const ranges:Array<[number,number]> = [];
  for (const quote of quotes.filter(Boolean)) {
    const start=text.indexOf(quote); if(start>=0) ranges.push([start,start+quote.length]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged:Array<[number,number]> = [];
  for(const range of ranges) { const last=merged.at(-1); if(last && range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]); }
  const parts:Array<{text:string;highlight:boolean}>=[]; let start=0;
  for(const [from,to] of merged) { if(from>start)parts.push({text:text.slice(start,from),highlight:false});parts.push({text:text.slice(from,to),highlight:true});start=to; }
  if(start<text.length)parts.push({text:text.slice(start),highlight:false});return parts;
}
export function mfpErrorKey(code:string) {
  if (code === "hybrid_route_upgrade_required") return "routeUpgrade";
  if (/unresolvable/.test(code)) return "unresolvable";
  if (/provider_usage_invalid/.test(code)) return "usageInvalid";
  if (/forbidden|unauthorized/.test(code)) return "forbidden";
  if (/preparation/.test(code)) return "preparation";
  if (/policy|cap_exceeded/.test(code)) return "policy";
  if (/provider/.test(code)) return "provider";
  if (/stale|conflict|context/.test(code)) return "stale";
  if (/active/.test(code)) return "active";
  if (/invalid|contradiction/.test(code)) return "invalid";
  return "request";
}
