/** Private, reproducible review sample. Model decisions and gold labels stay in the separate trace. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "./fixture-identity";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
void main(async()=>{
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
    if(rows.length<30)throw new Error("hybrid_blind_sample_insufficient");
    const seed=`mfp-h1-blind-r5:${rows[0].route_digest}`;
    const grouped=new Map<string,typeof rows>();
    for(const row of rows){const group=grouped.get(row.concept_key)??[];group.push(row);grouped.set(row.concept_key,group);}
    for(const group of grouped.values())group.sort((a,b)=>hash(`${seed}:${a.root_id}:${a.concept_key}`).localeCompare(hash(`${seed}:${b.root_id}:${b.concept_key}`)));
    const selected:typeof rows=[];
    while(selected.length<30)for(const key of [...grouped.keys()].sort()){
      const row=grouped.get(key)!.shift();if(row)selected.push(row);if(selected.length===30)break;
    }
    const items=selected.map((row,index)=>{
      const input=row.input,concept=input.evaluated_concepts.find((item:any)=>item.concept_key===row.concept_key);
      const citation=row.citation?.[0];
      if(!concept||concept.definition_digest!==row.definition_digest||!citation||
        input.text.slice(citation.start,citation.end)!==citation.quote)throw new Error("hybrid_blind_source_changed");
      return {sample_id:`sample_${String(index+1).padStart(2,"0")}`,concept:{label:concept.label,scope:concept.scope,
        definition:concept.definition,inclusion:concept.inclusion,exclusion:concept.exclusion,
        positive_examples:concept.positive_examples,negative_examples:concept.negative_examples},
        mention:{text:input.text,title:input.title,platform:input.platform,content_type:input.content_type,
          entities:input.entities,voice:input.voice,act:input.act},entity_context:row.context,citation};
    });
    const rubric="Para cada sample_id, juzga si el fragmento citado sostiene el fenómeno definido en el concepto, usando sólo el texto y contexto adjuntos. Responde supported, unsupported o insufficient con una razón breve y, cuando corresponda, una cita literal alternativa. Una cita existente no acredita por sí sola pertenencia. No infieras hechos ausentes. Evalúa los 30 antes de leer cualquier informe H1.";
    const payload=JSON.stringify({contract_version:"mfp-blind-semantic-review-v1",rubric,items},null,2)+"\n";
    const trace=JSON.stringify({seed,selection:"SHA256 order within concept, round-robin concepts",population:rows.length,
      items:selected.map((row,index)=>({sample_id:items[index]!.sample_id,root_id:row.root_id,concept_key:row.concept_key,
        definition_digest:row.definition_digest,route_digest:row.route_digest,jev_call_id:row.jev_call_id,
        claude_call_id:row.claude_call_id,run_id:row.run_id,raw_sha256:row.raw_sha256,raw_storage_key:row.raw_storage_key}))},null,2)+"\n";
    const directory=".data/dev-corpus/voyage-real/hybrid-h1-r5/blind";
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(`${directory}/review.json`,payload,{flag:"wx",mode:0o600});
    await writeFile(`${directory}/trace.json`,trace,{flag:"wx",mode:0o600});
    const manifest={contract_version:"mfp-blind-sample-manifest-v1",samples:30,selection:hash(seed),
      review_sha256:hash(payload),trace_sha256:hash(trace)};
    await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(JSON.stringify({directory,...manifest}));
  }finally{client.release();await pool.end();}
});
