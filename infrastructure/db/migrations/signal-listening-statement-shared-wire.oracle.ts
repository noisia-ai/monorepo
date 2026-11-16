import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {anchorListeningStatementOracleParametersV1,listeningExpectedProjectionOracleSqlV1} from './signal-listening-statement-validator.oracle';
import type {PoolClient} from 'pg';
export const sharedWireMigrationV1='0330_signal_listening_statement_shared_wire.sql';
export const sharedWireShaV1=(s:string)=>createHash('sha256').update(s).digest('hex');
export function sharedWireValidationV1(source:string){const matches=[...source.matchAll(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\)/g)];assert.equal(matches.length,1);const sql=matches[0]![1]!;assert.equal((sql.match(/%s/g)??[]).length,1);return sql.replace('%s','SELECT n.* FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$8::jsonb) n');}
export async function sharedWireSourcesV1(){return Promise.all(['0329_signal_listening_expected_projection.sql',sharedWireMigrationV1].map(n=>readFile(new URL('./'+n,import.meta.url),'utf8')));}
export function sharedWireCanonicalPartsV1(oldSource:string,newSource:string){
 const old=sharedWireValidationV1(oldSource),next=sharedWireValidationV1(newSource);
 const preimage=/signal_labeling_digest_v1\((jsonb_build_object\('request_version','listening-jev-v1',[\s\S]*?'request',expected_request\))\)/.exec(old)?.[1];assert.ok(preimage);
 const start=next.indexOf('/* statement_shared_wire_hash_begin */'),end=next.indexOf('/* statement_shared_wire_hash_end */',start);assert.ok(start>=0&&end>start);
 const hash=next.slice(start+'/* statement_shared_wire_hash_begin */'.length,end).trim();
 const a=hash.indexOf('/* statement_shared_wire_canonical_begin */'),b=hash.indexOf('/* statement_shared_wire_canonical_end */');assert.ok(a>=0&&b>a);
 const canonical=hash.slice(a+'/* statement_shared_wire_canonical_begin */'.length,b).trim();
 const c=next.indexOf('statement_wire_values AS MATERIALIZED('),d=next.indexOf('/* statement_shared_wire_fragments_end */',c);assert.ok(c>=0&&d>c);
 const wires=next.slice(c,d).trim().replace(/,$/,'');return{old,next,preimage,hash,canonical,wires};
}
export function sharedWireCanonicalProjectionV1(oldSource:string,newSource:string,arm:'before'|'after'){
 const p=sharedWireCanonicalPartsV1(oldSource,newSource),sql=arm==='before'?p.old:p.next,end=sql.indexOf('\n   SELECT COALESCE(');assert.ok(end>=0);
 const canonical=arm==='before'?`public.signal_labeling_json_v1(${p.preimage})`:p.canonical;
 return anchorListeningStatementOracleParametersV1(sql.slice(0,end)+`\n SELECT id,encode(convert_to(canonical,'UTF8'),'hex') bytes,'sha256:'||encode(sha256(convert_to(canonical,'UTF8')),'hex') digest FROM (SELECT id,${canonical} canonical FROM expected) e ORDER BY id`);
}
export async function compareSharedWireValidationV1(c:PoolClient,oldSource:string,newSource:string,params:unknown[]){
 const all=[];for(const [arm,source]of [['before',oldSource],['after',newSource]] as const){const sql=sharedWireValidationV1(source);
  const flags=(await c.query(anchorListeningStatementOracleParametersV1(sql),params)).rows[0];
  const projected=await c.query(listeningExpectedProjectionOracleSqlV1(sql),params);
  const exact=(await c.query(listeningExpectedProjectionOracleSqlV1(sql,true),params)).rows;
  const canonical=(await c.query(sharedWireCanonicalProjectionV1(oldSource,newSource,arm),params)).rows;
  all.push({flags,fields:projected.fields.map(f=>[f.name,f.dataTypeID]),exact,canonical});
 }assert.deepEqual(all[1],all[0],'3flags/8typedfields/multiplicity/SQLtext/UTF8/fullSHA equal in same native snapshot');return all[0]!;
}
// Kernel tests feed representation probes as PostgreSQL JSON text, never JS
// numbers. It executes the actual0330 fragments and canonical expression.
export function sharedWireRepresentationKernelV1(oldSource:string,newSource:string){const p=sharedWireCanonicalPartsV1(oldSource,newSource);
 const prefix=`WITH selected AS MATERIALIZED(SELECT id,native_questions questions FROM jsonb_to_recordset($8::jsonb) e(id uuid,native_questions jsonb)),expected AS MATERIALIZED(SELECT id,i,digests,basis,expected_request FROM jsonb_to_recordset($8::jsonb) e(id uuid,i jsonb,digests jsonb,basis jsonb,expected_request jsonb)),${p.wires}`;
 return anchorListeningStatementOracleParametersV1(prefix+` SELECT id,encode(convert_to(public.signal_labeling_json_v1(${p.preimage}),'UTF8'),'hex') before_bytes,encode(convert_to(${p.canonical},'UTF8'),'hex') after_bytes,ARRAY(SELECT jsonb_object_keys(value) FROM statement_native_fragments) fragment_keys FROM expected ORDER BY id`);
}
