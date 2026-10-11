/** Private, reproducible review sample. Model decisions and gold labels stay in the separate trace. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { selectDisjointHybridPositivesV1 } from "./hybrid-h1-blind-selection";
import { loadMfpEvalIdentity } from "./fixture-identity";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
void main(async()=>{
  const previousPath=process.argv.find(arg=>arg.startsWith("--previous-trace="))?.split("=")[1];
  if(!previousPath)throw new Error("hybrid_previous_blind_trace_required");
  const previous=JSON.parse(await readFile(previousPath,"utf8"));
  if(!Array.isArray(previous.items)||previous.items.length!==30||previous.items.some((r:any)=>typeof r.root_id!=="string"))throw new Error("hybrid_previous_blind_trace_invalid");
  const excluded=new Set<string>(previous.items.map((r:any)=>r.root_id));
  const previousHash=hash(await readFile(previousPath,"utf8"));
  const identity=await loadMfpEvalIdentity(),pool=await openDatabase(),client=await pool.connect();
  try{
    await client.query("SET statement_timeout='20s'");
    const rows:Record<string,any>[]=(await client.query(`WITH current_pairs AS MATERIALIZED (
      SELECT workspace_id,root_id,concept_key,definition_digest,labeler_digest
      FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND source='model' AND verdict='belongs'
    ), authorized_roots AS MATERIALIZED (
      SELECT workspace_id,root_id FROM signal_membership_evidence_rights_v1
      WHERE workspace_id=$1 AND metrics AND evidence
    ) SELECT decision.*,call.raw_sha256,call.raw_storage_key,call.run_id,
      input.value input,context.context
      FROM signal_hybrid_membership_decisions decision
      JOIN signal_hybrid_membership_routes route ON route.workspace_id=decision.workspace_id AND route.route_digest=decision.route_digest
      JOIN current_pairs current ON current.workspace_id=decision.workspace_id
        AND current.root_id=decision.root_id AND current.concept_key=decision.concept_key
        AND current.definition_digest=decision.definition_digest AND current.labeler_digest=decision.route_digest
      JOIN authorized_roots rights ON rights.workspace_id=current.workspace_id AND rights.root_id=current.root_id
      JOIN signal_labeling_calls call ON call.id=decision.claude_call_id AND call.status='settled' AND call.results_applied
      JOIN signal_labeling_runs run ON run.id=call.run_id
      JOIN signal_entity_context_versions context ON context.workspace_id=run.workspace_id AND context.version_no=run.entity_context_version_no
      JOIN LATERAL jsonb_array_elements(call.inputs) input(value) ON input.value->>'root_id'=decision.root_id::text
      WHERE decision.workspace_id=$1 AND decision.verdict='belongs'`,[identity.workspace_id])).rows;
    const seed=`mfp-h1-blind-r8:${rows[0]?.route_digest}:${previousHash}`;
    const selected=selectDisjointHybridPositivesV1(rows as Array<Record<string,any>&{root_id:string;concept_key:string}>,excluded,seed);
    const items=selected.map((row,index)=>{
      const input=row.input,concept=input.evaluated_concepts.find((item:any)=>item.concept_key===row.concept_key);
      const citations=row.citation;
      if(!concept||concept.definition_digest!==row.definition_digest||!citations?.length||citations.some((c:any)=>input.text.slice(c.start,c.end)!==c.quote))throw new Error("hybrid_blind_source_changed");
      return {sample_id:`sample_${String(index+1).padStart(2,"0")}`,concept:{label:concept.label,scope:concept.scope,
        definition:concept.definition,inclusion:concept.inclusion,exclusion:concept.exclusion,
        positive_examples:concept.positive_examples,negative_examples:concept.negative_examples},
        mention:{text:input.text,title:input.title,platform:input.platform,content_type:input.content_type,
          entities:input.entities,voice:input.voice,act:input.act},entity_context:row.context,citations};
    });
    const rubric="Evalúa los 30 ítems de forma independiente, sin informes H1 ni gold. Para cada sample_id devuelve membership: belongs, not_belongs o insufficient y citation_support: supported, unsupported o insufficient, con razones separadas. Primero decide si el texto propio de la mención establece la pertenencia al concepto; luego si los fragmentos sostienen el hecho decisivo y cada condición necesaria. Una cita literal, hipotético o comentario general no acredita pertenencia. No infieras hechos ausentes. Puedes proponer hasta tres fragmentos literales alternativos de la misma raíz.";
    const payload=JSON.stringify({contract_version:"mfp-blind-semantic-review-v2",rubric,items},null,2)+"\n";
    const trace=JSON.stringify({seed,selection:"SHA256 order within concept, round-robin concepts, distinct roots excluding prior 30",population:rows.length,previous_trace_sha256:previousHash,excluded_roots:excluded.size,disjoint:true,
      items:selected.map((row,index)=>({sample_id:items[index]!.sample_id,root_id:row.root_id,concept_key:row.concept_key,
        definition_digest:row.definition_digest,route_digest:row.route_digest,jev_call_id:row.jev_call_id,
        claude_call_id:row.claude_call_id,citation_call_id:row.citation_call_id,run_id:row.run_id,raw_sha256:row.raw_sha256,raw_storage_key:row.raw_storage_key}))},null,2)+"\n";
    const directory=".data/dev-corpus/voyage-real/hybrid-h1-audit-r8/blind";
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(`${directory}/review.json`,payload,{flag:"wx",mode:0o600});
    await writeFile(`${directory}/trace.json`,trace,{flag:"wx",mode:0o600});
    const manifest={contract_version:"mfp-blind-sample-manifest-v1",samples:30,selection:hash(seed),
      review_sha256:hash(payload),trace_sha256:hash(trace)};
    await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(JSON.stringify({directory,...manifest}));
  }finally{client.release();await pool.end();}
});
