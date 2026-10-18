import { createHash } from "node:crypto";
import { parseAnthropicResponseV1, parseFacetGroupV1, type FacetInput, type FacetResult } from "@noisia/query-engine";
import type { LabelingCallV1, LabelingRunV1 } from "./signal-labeling-runs";
type AnthropicBatchItem = { custom_id: string; result: { type: string; message?: unknown } };

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
    const response=parseAnthropicResponseV1(raw.result.message as Parameters<typeof parseAnthropicResponseV1>[0]);
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

import type { LabelingDatabaseV1 } from "./signal-mention-facets";
import { inspectFacetContextChangeV1, writeFacetResultsV1 } from "./signal-mention-facets";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { signalWorkspaceFeatureEnabledV1 } from "./signal-workspace-features";

/** Reparse settled immutable receipts. No provider or settlement capability exists here. */
export async function replayStoredFacetResultsV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; run_id: string;
  loadRaw: (receipt: {workspace_id:string;run_id:string;call_id:string;storage_key:string;raw_sha256:string;size_bytes:number}) => Promise<string>;
}) {
  const c = await args.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[args.workspace_id]);
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({...args,queryable:c,lock_authority:true});
    if(!caps.can_request_processing || !await signalWorkspaceFeatureEnabledV1({queryable:c,workspace_id:args.workspace_id,feature:"mention_facets"}))
      throw new Error("facet_replay_forbidden");
    const run=(await c.query<LabelingRunV1>(`SELECT r.*,v.identity,v.labeler_digest,ce.context
      FROM signal_labeling_runs r JOIN signal_labeler_versions v ON v.id=r.labeler_version_id
      JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no
      WHERE r.id=$1 AND r.workspace_id=$2 AND r.kind='facets' AND r.status IN('completed','failed')
        AND (r.lease_until IS NULL OR r.lease_until<now())
        AND NOT EXISTS(SELECT 1 FROM signal_labeling_runs active WHERE active.workspace_id=r.workspace_id
          AND active.kind='facets' AND active.status IN('queued','running')) FOR UPDATE OF r`,[args.run_id,args.workspace_id])).rows[0];
    if(!run)throw new Error("facet_replay_run_invalid");
    const context=await inspectFacetContextChangeV1(c,args.workspace_id);
    if(context.digest!==run.entity_context_digest)throw new Error("facet_replay_context_changed");
    const chosen=(await c.query<{labeler_digest:string}>(`SELECT v.labeler_digest FROM signal_labeler_versions v
      LEFT JOIN signal_workspace_labelers chosen ON chosen.workspace_id=$1 AND chosen.kind='facets' AND chosen.labeler_version_id=v.id
      WHERE v.kind='facets' AND v.status<>'retired' AND (chosen.workspace_id IS NOT NULL OR v.status='approved')
      ORDER BY (chosen.workspace_id IS NOT NULL) DESC,v.approved_at DESC NULLS LAST,v.created_at DESC LIMIT 1`,[args.workspace_id])).rows[0];
    if(chosen?.labeler_digest!==run.labeler_digest)throw new Error("facet_replay_labeler_changed");
    const calls=(await c.query<StoredFacetReplayCall & {raw_storage_key:string;raw_size_bytes:string}>(`SELECT *
      FROM signal_labeling_calls WHERE run_id=$1 AND workspace_id=$2 AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(results,'[]')) result
        WHERE result->>'status'='error' AND result->>'error_code'='invalid_facets') ORDER BY id FOR UPDATE`,[run.id,args.workspace_id])).rows;
    const population=(await c.query<{root_id:string;input_digest:string;status:string;labeler_digest:string|null;requires_context_review:boolean}>(
      `SELECT root_id,input_digest,status,labeler_digest,requires_context_review FROM signal_workspace_mention_facets_read_v1($1::uuid)`,[args.workspace_id])).rows;
    for(const call of calls){
      const size=Number(call.raw_size_bytes);
      if(!call.raw_storage_key || !call.raw_sha256 || !Number.isSafeInteger(size) || size<0)throw new Error("facet_replay_receipt_invalid");
      if(call.settled_micro_usd===null)throw new Error("facet_replay_receipt_invalid");
      call.settled_micro_usd=Number(call.settled_micro_usd);
      call.raw_body=await args.loadRaw({workspace_id:args.workspace_id,run_id:run.id,call_id:call.id,
        storage_key:call.raw_storage_key,raw_sha256:call.raw_sha256,size_bytes:size});
      if(Buffer.byteLength(call.raw_body)!==size)throw new Error("facet_replay_receipt_invalid");
      for(const result of call.results.filter(result=>result.status==='error'&&result.error_code==='invalid_facets')){
        const current=population.find(row=>row.root_id===result.root_id);
        if(!current || current.requires_context_review || current.input_digest!==result.input_digest
          || (current.labeler_digest!==null && current.labeler_digest!==run.labeler_digest) || current.status!=='error')throw new Error("facet_replay_source_changed");
      }
    }
    const plan=planStoredFacetReplayV1({run,calls,pending_root_ids:population.filter(row=>row.status==='error'||row.status==='pending').map(row=>row.root_id),
      valid_root_ids:population.filter(row=>row.status!=='error'&&row.status!=='pending').map(row=>row.root_id)});
    if(plan.pages.length){
      await writeFacetResultsV1(c,{workspace_id:args.workspace_id,labeler_digest:run.labeler_digest,call_id:"",
        results:plan.pages.flatMap(page=>page.results.filter(result=>page.replayed_root_ids.includes(result.root_id)).map(result=>({...result,call_id:page.call_id})))});
      const changed=await c.query(`UPDATE signal_labeling_calls call SET results=page.results,updated_at=now()
        FROM jsonb_to_recordset($2::jsonb) page(call_id uuid,raw_sha256 text,results jsonb)
        WHERE call.run_id=$1 AND call.id=page.call_id AND call.raw_sha256=page.raw_sha256
          AND call.status='settled' AND call.results_applied RETURNING call.id`,[run.id,JSON.stringify(plan.pages)]);
      if(changed.rowCount!==plan.pages.length)throw new Error("facet_replay_receipt_conflict");
    }
    await c.query("COMMIT");
    return {replayed_root_ids:plan.replayed_root_ids,recovery_root_ids:plan.recovery_root_ids,provider_sends:0,additional_settlement_micro_usd:0};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
