import assert from 'node:assert/strict';
import type {PoolClient,QueryResult} from 'pg';

// Frozen exact reader SELECTs from f0dca220, independent of the candidate.
export const listeningMetadataBeforeProjectionV1="/* labeling_listening_input_metadata_v1 */ WITH candidates AS MATERIALIZED(\n   SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,octet_length(p.body)::bigint text_bytes,octet_length(p.wire::text)::bigint wire_bytes,\n    (octet_length(p.question_key)+octet_length(p.question_digest)+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,\n    octet_length(COALESCE(p.platform,''))::bigint platform_bytes\n   FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL\n  ), sent AS MATERIALIZED(\n   SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5 AND root_id=ANY($8::uuid[])\n  ), reservation_matches AS MATERIALIZED(\n   SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest\n  ), pending AS MATERIALIZED(\n   SELECT root_id,question_key,text_bytes,wire_bytes,question_metadata_bytes,platform_bytes,\n    row_number() OVER(PARTITION BY root_id ORDER BY question_key) n\n   FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest))\n   SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes\n   FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6";
export const listeningHydrateBeforeProjectionV1="/* labeling_listening_inputs_v1 */ WITH candidates AS MATERIALIZED(\n  SELECT p.root_id,p.input_digest,p.body,p.published_at,p.platform,p.question_key,p.question_digest,p.scope_basis\n  FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$7::uuid[],'llm-processing') p WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL\n ), sent AS MATERIALIZED(\n  SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5\n   AND root_id=ANY($7::uuid[])\n ), reservation_matches AS MATERIALIZED(\n  SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest\n ), pending AS MATERIALIZED(\n  SELECT root_id,input_digest,body,published_at,platform,question_key,question_digest,scope_basis,\n   row_number() OVER(PARTITION BY root_id ORDER BY question_key) n\n  FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest))\n  SELECT root_id,input_digest,body,published_at,platform,array_agg(question_key ORDER BY question_key) question_keys,\n   jsonb_object_agg(question_key,question_digest) question_digests,\n   COALESCE(jsonb_object_agg(question_key,scope_basis) FILTER(WHERE scope_basis IS NOT NULL),'{}'::jsonb) scope_basis\n  FROM pending WHERE n<=256 GROUP BY root_id,input_digest,body,published_at,platform ORDER BY root_id LIMIT $6";

export type ListeningProjectionOracleContextV1={params?:unknown[]};
export async function compareListeningInputProjectionV1(c:PoolClient,sql:string,params:unknown[]|undefined,result:QueryResult,context:ListeningProjectionOracleContextV1){
 if(sql.startsWith('/* labeling_listening_input_metadata_v1 */')&&params?.length===9){
  context.params=params.slice(0,8);
  const old=await c.query(listeningMetadataBeforeProjectionV1,context.params);
  assert.deepEqual(result.rows.map(({root_id,working_bytes})=>({root_id,working_bytes})),old.rows,'native metadata weights/order equal frozen f0 exactly');
  const projected=result.rows.filter(r=>r.projection!==null),ids=projected.map(r=>r.root_id);
  if(ids.length){
   const oldRows=(await c.query(listeningHydrateBeforeProjectionV1,[...params.slice(0,5),ids.length,ids])).rows;
   assert.deepEqual(projected.map(r=>({root_id:r.root_id,...r.projection})),oldRows.map(({root_id,input_digest,question_keys,question_digests,scope_basis})=>({root_id,input_digest,question_keys,question_digests,scope_basis})),
    'captured pending projection has exact native digest/questions/shared-digest identities and human/sent exclusions');
  }
  let used=0n;for(const row of result.rows){used+=BigInt(row.working_bytes);assert.equal(row.projection!==null,used<=BigInt(String(params[8])),'no question payload beyond the global remaining byte prefix');}
  return true;
 }
 if(sql.startsWith('/* labeling_listening_input_body_v1 */')){
  assert.ok(context.params,'body hydration must follow metadata on this SAME client');assert.ok(params);const ids=params[2] as string[];
  const previous=`SELECT root_id,body,published_at,platform FROM (${listeningHydrateBeforeProjectionV1}) old`;
  const values=[...context.params.slice(0,5),ids.length,ids];
  const old=await c.query(previous,values);assert.deepEqual(result.rows,old.rows,'body/source metadata matches frozen bounded native population');
  const toJson=(q:string)=>`SELECT to_jsonb(r) value FROM (${q}) r`;
  assert.deepEqual((await c.query(toJson(sql),params)).rows,(await c.query(toJson(previous),values)).rows,'body SELECT preserves PostgreSQL timestamp microseconds and Unicode before JS Date conversion');
  return true;
 }
 return false;
}
