import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';

export function ownerTargetFunctionV1(source:string,name:string){
 const start=source.search(new RegExp('CREATE(?: OR REPLACE)? FUNCTION '+name+'\\(\\)'));
 assert.ok(start>=0);const end=source.indexOf('END $$;',start);assert.ok(end>start);return source.slice(start,end+7);
}
export function listeningUpdateTargetsV1(source:string){
 const fn=ownerTargetFunctionV1(source,'signal_listening_statement_money_v1');
 const branch=fn.match(/\n ELSE\n([\s\S]*?)\n END IF;/u)?.[1];assert.ok(branch);
 const marker=branch.includes('WITH target_matches AS MATERIALIZED(')?'WITH target_matches AS MATERIALIZED(':'SELECT array_agg(DISTINCT n.run_id';
 const start=branch.indexOf(marker);assert.ok(start>=0);const raw=branch.slice(start).trim().replace(/;$/u,'');
 assert.equal((raw.match(/INTO targets/g)??[]).length,1);
 return{raw,sql:raw.replace('INTO targets',' '.repeat('INTO targets'.length))};
}
export function scopedUpdateTargetsV1(source:string){
 const fn=ownerTargetFunctionV1(source,'guard_mass_labeling_scoped_money_total_v1');
 const raw=fn.match(/\n ELSE\n  FOR target IN ([\s\S]*?) LOOP/u)?.[1];assert.ok(raw);return{raw,sql:raw};
}
export async function ownerTargetSetReferencesV1(){
 const [listening,scoped,next]=await Promise.all([
  readFile(new URL('./0327_signal_listening_transition_set.sql',import.meta.url),'utf8'),
  readFile(new URL('./0278_signal_mass_labeling_scoped_authority.sql',import.meta.url),'utf8'),
  readFile(new URL('./0328_signal_listening_owner_target_sets.sql',import.meta.url),'utf8')]);
 return{listening:[listeningUpdateTargetsV1(listening).sql,listeningUpdateTargetsV1(next).sql],scoped:[scopedUpdateTargetsV1(scoped).sql,scopedUpdateTargetsV1(next).sql]};
}
export async function assertOwnerTargetSetOracleV1(c:PoolClient,selectors:string[],newRows:unknown[],oldRows:unknown[]){
 // Only transition rows are counterfactual. The original public Listening owner
 // and scoped-admission joins remain in the SQL and use real native records.
 const prefix=`WITH listening_new_calls AS MATERIALIZED(SELECT * FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$1::jsonb)),
 listening_old_calls AS MATERIALIZED(SELECT * FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$2::jsonb)),
 scoped_new_calls AS MATERIALIZED(SELECT * FROM listening_new_calls),scoped_old_calls AS MATERIALIZED(SELECT * FROM listening_old_calls) `;
 const output=[];
 for(const selector of selectors){
  const result=await c.query(prefix+`SELECT to_jsonb(t) value FROM (${selector}) t ORDER BY to_jsonb(t)`,[JSON.stringify(newRows),JSON.stringify(oldRows)]);
  const metadata=await c.query(prefix+`SELECT t.* FROM (${selector}) t ORDER BY to_jsonb(t)`,[JSON.stringify(newRows),JSON.stringify(oldRows)]);
  output.push({rows:result.rows.map(r=>r.value),fields:metadata.fields.map(f=>({name:f.name,type:f.dataTypeID,modifier:f.dataTypeModifier,size:f.dataTypeSize,format:f.format}))});
 }
 assert.ok(output.length>=2);for(const next of output.slice(1))assert.deepEqual(next,output[0],'owner target set matches old SQL metadata, NULL/ordered UUID arrays or DISTINCT row sets');
 return output[0]!.rows as Array<Record<string,unknown>>;
}
