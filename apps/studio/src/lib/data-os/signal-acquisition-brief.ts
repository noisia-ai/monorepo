import { createHash } from "node:crypto";

import { queryComposerDigestV1 } from "@noisia/query-engine";

import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";

type KnowledgeRow = {
  id:string;source_kind:string;file_hash:string|null;raw_text:string|null;
  extracted_payload:unknown;
};

async function loadKnowledgeRows(args:{
  queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;
}){
  return args.queryable.query<KnowledgeRow>(`
    SELECT source.id::text,source.source_kind,source.file_hash,source.raw_text,source.extracted_payload
    FROM brand_knowledge_sources source
    WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
      AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
    ORDER BY source.created_at,source.id
  `,[args.workspace.organizationId,
    args.workspace.subject.type==="brand"?args.workspace.subject.id:null]);
}

/** Resolves the complete current Knowledge selection without exposing source IDs to the browser. */
export async function loadSignalAcquisitionKnowledgeSelectionV1(args:{
  queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;
  include:boolean;
}){
  const rows=await loadKnowledgeRows(args);
  const references=args.include?rows.rows.map((row)=>sha256(row.id)):[];
  const resolved=await resolveKnowledgeRows(rows.rows,references);
  return{...resolved,references,available_count:rows.rowCount??rows.rows.length};
}

/** Resolves only workspace-owned, non-Study Knowledge references selected by the brief. */
export async function loadSignalAcquisitionKnowledgeContextV1(args:{
  queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;
  references:string[];
}){
  const result=await loadKnowledgeRows(args);
  return resolveKnowledgeRows(result.rows,args.references);
}

async function resolveKnowledgeRows(rows:KnowledgeRow[],references:string[]){
  const byReference=new Map(rows.map((row)=>[sha256(row.id),row]));
  const selected=references.map((reference)=>({reference,row:byReference.get(reference)}));
  const missing=selected.some((entry)=>!entry.row);
  const resolved=selected.filter((entry):entry is {reference:string;row:KnowledgeRow}=>Boolean(entry.row));
  const canonical=resolved.map(({reference,row})=>({reference_hash:reference,
    source_kind:row.source_kind,content_digest:/^sha256:[0-9a-f]{64}$/u.test(row.file_hash??"")
      ?row.file_hash:queryComposerDigestV1({raw_text:row.raw_text,extracted_payload:row.extracted_payload})}))
    .sort((left,right)=>left.reference_hash.localeCompare(right.reference_hash));
  return{sources:resolved.map(({row})=>({type:row.source_kind,content:{
    extracted_payload:row.extracted_payload,raw_text:row.raw_text
  }})),digest:queryComposerDigestV1(canonical),missing};
}

function sha256(value:string){
  return `sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;
}
