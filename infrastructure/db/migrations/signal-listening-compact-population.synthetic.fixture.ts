import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {SignalListeningAccessV1} from '../signal-listening-configuration';
import {withCompactReadOnlyV1,compareCompactPopulationV1,compareCompactAggregateV1,compareCompactDeniedRoleV1,assertCompactACLNegativeV1,assertCompactExecuteCompositionV1,assertCompactFullReplacementV1,compactRawNameV1} from './signal-listening-compact-population.oracle';
/** Reuses the entry's3 roots or its original product-recovery1002 profile, never providers. */
export async function assertCompactNativeCasesV1(access:SignalListeningAccessV1,args:{configuration_id:string;map_id:string},options:{extended?:boolean;empty?:boolean;expected_scope?:string;execute_authority?:boolean;profile_full?:true}={}){
 const map=(await access.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1 AND workspace_id=$2',[args.map_id,access.workspace_id])).rows[0];assert.ok(map);
 const roots=(await access.database.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[access.workspace_id,args.map_id])).rows.map(r=>r.root_id as string);assert.equal(roots.length,options.profile_full===true?1002:3,'reuse only the existing3-root or product-recovery1002 Native fixture');
 const base:unknown[]=[access.workspace_id,args.configuration_id,args.map_id,map.entity_context_digest,null,'llm-processing'];
 await withCompactReadOnlyV1(access.database,async c=>{
  const first=await compareCompactPopulationV1(c,base);assert.equal(first.raw12.rows===0,options.empty===true);
  if(options.expected_scope){const present=(await c.query(`SELECT count(*)::int n FROM public.${compactRawNameV1}($1,$2,$3,$4,$5,$6) WHERE scope_state=$7`,[...base,options.expected_scope])).rows[0].n;assert.ok(present>0,'the required scope case is observed, not silently skipped');}
  // Oracle only: compute the historical full-body input identity freshly from
  // the immutable item table. No digest cache or root helper in product code.
  const mismatch=(await c.query(`WITH p AS MATERIALIZED(SELECT DISTINCT root_id,input_digest,body_chars FROM public.${compactRawNameV1}($1,$2,$3,$4,$5,$6))
   SELECT count(*)::int n FROM p JOIN signal_mass_labeling_items i ON i.workspace_id=$1 AND i.map_id=$3 AND i.root_id=p.root_id
   WHERE p.input_digest IS DISTINCT FROM signal_listening_input_digest_v1(i) OR p.body_chars IS DISTINCT FROM length(i.text)`,base)).rows[0].n;assert.equal(mismatch,0);
  if(options.extended){
   const cases:unknown[][]=[[...base.slice(0,4),roots,base[5]],[...base.slice(0,4),[],base[5]],[...base.slice(0,4),[null],base[5]],[...base.slice(0,4),[roots[0],roots[0],null,roots[1]],base[5]],[...base.slice(0,4),Array(4097).fill(roots[0]),base[5]],[...base.slice(0,5),'client-derived-metrics'],[...base.slice(0,5),'internal-qa']];
   for(const[index,value]of [[0,randomUUID()],[1,randomUUID()],[2,randomUUID()],[3,'sha256:'+'f'.repeat(64)]]as const){const changed=[...base];changed[index]=value;cases.push(changed);}
   assert.equal(cases.length,11);for(const[index,params]of cases.entries()){const result=await compareCompactPopulationV1(c,params);if([1,2,4,6,7,8,9].includes(index)){assert.equal(result.raw12.rows,0,'empty/oversize/denied purpose/foreign scope stays empty');assert.equal(result.effective10.rows,0);}}
   await compareCompactDeniedRoleV1(c,base);await assertCompactACLNegativeV1(c);
  }
 });
 // Deliberately separate owned RR/RO transactions: quote and request stats have
 // different predicates and are never reused as each other's authority.
 await withCompactReadOnlyV1(access.database,c=>compareCompactAggregateV1(c,base,'quote',options.profile_full===true));
 await withCompactReadOnlyV1(access.database,c=>compareCompactAggregateV1(c,base,'request_stats',options.profile_full===true));
 if(options.execute_authority){await assertCompactFullReplacementV1(access.database);await assertCompactExecuteCompositionV1(access.database,base);}
}
