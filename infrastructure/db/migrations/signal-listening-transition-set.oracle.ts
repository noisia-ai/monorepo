import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';

// Extract the actual UPDATE selector, not a separately maintained equivalent.
export function listeningUpdateBatchSqlV1(source:string){
 const match=source.match(/ELSE\n  batch_sql:=(?:'((?:''|[^'])*)'|\$transition_batch\$([\s\S]*?)\$transition_batch\$);/u);
 assert.ok(match,'one recognized native UPDATE batch assignment');
 return match[1]===undefined?match[2]!:match[1].replace(/''/g,"'");
}
export async function listeningTransitionSetReferencesV1(){
 return Promise.all(['0323_signal_listening_statement_selected_full_join.sql','0327_signal_listening_transition_set.sql'].map(async name=>
  listeningUpdateBatchSqlV1(await readFile(new URL('./'+name,import.meta.url),'utf8'))));
}
export async function assertListeningTransitionSetOracleV1(c:PoolClient,selectors:string[],target:string,newRows:unknown[],oldRows:unknown[]){
 const params=[target,JSON.stringify(newRows),JSON.stringify(oldRows)];
 const prefix=`WITH listening_new_calls AS MATERIALIZED(SELECT * FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$2::jsonb)),
  listening_old_calls AS MATERIALIZED(SELECT * FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$3::jsonb)) `;
 const output=[];
 for(const selector of selectors){
  const rows=prefix+`SELECT n.* FROM (${selector}) n ORDER BY to_jsonb(n)`;
  const value=await c.query(rows,params),json=await c.query(prefix+`SELECT to_jsonb(n) value FROM (${selector}) n ORDER BY to_jsonb(n)`,params);
  // Named composite expansion must retain every current table column/type,
  // including nullable receipt fields. SQL JSON retains timestamp microseconds.
  output.push({fields:value.fields.map(f=>({name:f.name,type:f.dataTypeID,modifier:f.dataTypeModifier,size:f.dataTypeSize,format:f.format})),rows:json.rows.map(r=>r.value)});
 }
 assert.ok(output.length>=2);for(const next of output.slice(1))assert.deepEqual(next,output[0],'typed FULL set-match exactly preserves old INNER selector columns, OIDs and all JSON values');
 const columns=(await c.query(`SELECT attname name,atttypid::int type,atttypmod modifier,attlen size
  FROM pg_attribute WHERE attrelid='signal_labeling_calls'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows;
 assert.deepEqual(output[0]!.fields.map(({format:_,...f})=>f),columns,'selector projection is the complete named table row, never extra matching metadata');
 return output[0]!.rows as Array<Record<string,unknown>>;
}
