import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
export const wirePopulationMigrationV1='0337_signal_listening_wire_population.sql';
export const wirePopulationNameV1='signal_listening_wire_population_roots_v1';
export const wirePopulationShaV1=(value:string)=>createHash('sha256').update(value).digest('hex');
export const wirePopulationColumnsV1=['root_id','input_digest','question_key','question_digest','wire','scope_basis','candidate','scope_state','answer','body_octets','platform_octets']as const;
export const wirePopulationSourceShaV1='5af216411e8924fa757b3ecae5ae574cb8737ca754f7c06a27eec455396980eb';
export const wirePopulationMoneyProsrcShaV1='c9aba3719759b7cf09d96371be79838f487707b66a3c20d13070e7559a31a2e0';
const rawRewritesV1=[
 [
  "-- The existing base_* barriers now select ALL configured raw answer digests,\n-- once per statement, for the same eligible roots, workspace and entity context.\n-- The materialized match/post-filter retains only exact current input identities.\n-- Voice/promotion still consume only their own digests; the final lookup reuses\n-- the full exact cache set. Cache PK has all five keys, with no configuration ID.\n-- Every surviving answer matches prepared x qs, so FULL adds no unmatched right\n-- row and equals LEFT. Question digests need not be unique: ANY does not expand\n-- the slice, while the final join preserves one result per question key, including\n-- different keys sharing a digest. Empty questions/missing answers retain NULLs.\n-- Raw fourteen fields, human/manual overlays, scope, rights and dispatch are exact.\n",
  "-- Native wire population: full fresh input SHA and authority remain0333 exact.\n-- Return only Money/prefix semantic fields and exact UTF8 byte counts.\n",
  1
 ],
 [
  "CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(",
  "CREATE FUNCTION signal_listening_wire_population_roots_v1(",
  1
 ],
 [
  "RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,\n question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,\n answer jsonb,cache_call_id uuid,scope_basis text)\n",
  "RETURNS TABLE(root_id uuid,input_digest text,question_key text,question_digest text,wire jsonb,scope_basis text,\n candidate boolean,scope_state text,answer jsonb,body_octets integer,platform_octets integer)\n",
  1
 ],
 [
  "LANGUAGE plpgsql STABLE SET search_path=",
  "LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=",
  1
 ],
 [
  "BEGIN\n IF roots IS NULL THEN",
  "BEGIN\n IF pg_catalog.has_function_privilege(current_user,'public.signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure,'EXECUTE') IS DISTINCT FROM true THEN\n  RAISE EXCEPTION 'permission denied for function signal_listening_population_roots_v1' USING ERRCODE='42501';\n END IF;\n IF roots IS NULL THEN",
  1
 ],
 [
  "items AS MATERIALIZED(SELECT i.*,/* flat_input_begin */",
  "items AS MATERIALIZED(SELECT i.root_id,i.chunk_sha256,i.candidates,octet_length(i.text) body_octets,octet_length(COALESCE(m.platform,'')) platform_octets,/* flat_input_begin */",
  2
 ],
 [
  "SELECT i.root_id,i.listening_input_digest,i.text,i.published_at,i.platform,q.question_key,q.question_digest,q.definition,q.wire,",
  "SELECT i.root_id,i.listening_input_digest,q.question_key,q.question_digest,q.wire,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END,",
  2
 ],
 [
  "END,a.answer),CASE WHEN manual.id IS NULL THEN a.call_id END,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END",
  "END,a.answer),i.body_octets,i.platform_octets",
  2
 ]
]as const;
function rewriteV1(source:string,inverse=false){
 for(const [before,after,count]of inverse?[...rawRewritesV1].reverse():rawRewritesV1){const from=inverse?after:before,to=inverse?before:after;assert.equal(source.split(from).length-1,count,'closed raw rewrite count');source=source.split(from).join(to);}return source;
}
export function wirePopulationRawV1(original:string){
 assert.equal(wirePopulationShaV1(original),'45666196078c2c0d130298863569b1a1a49c281bbcafe6a440c6cc1bbd42eb6f');
 const next=rewriteV1(original);assert.equal(rewriteV1(next,true),original);return next;
}
export function wirePopulationPartsV1(source:string){
 const marker='\n-- wire_acl_begin\n',tailMarker='-- wire_acl_end\n\n-- wire_money_begin\n';
 assert.equal(wirePopulationShaV1(source),wirePopulationSourceShaV1);assert.equal(source.split(marker).length,2);assert.equal(source.split(tailMarker).length,2);
 const [raw,tail]=source.split(marker);assert.ok(raw&&tail);const [acl,money]=tail.split(tailMarker);assert.ok(acl&&money);return{raw,acl,money};
}
export function wirePopulationSourceV1(original:string,moneyD:string,source:string){
 assert.equal(wirePopulationShaV1(source),wirePopulationSourceShaV1,'exact0337 composite source required');
 assert.equal(wirePopulationShaV1(moneyD),'64cb14b3ce2bb47d984f5984bd20980f9d2233a51d90c053a6cc7201c05f0a07');
 const {raw,acl,money}=wirePopulationPartsV1(source);
 assert.equal(raw,wirePopulationRawV1(original));assert.equal(rewriteV1(raw,true),original);
 const oldCall='FROM signal_listening_population_roots_v1',newCall='FROM '+wirePopulationNameV1;assert.equal(money.split(newCall).length,2);
 const inverse=money.replace(newCall,oldCall);assert.equal(inverse,moneyD,'every0336 byte except the native producer reference is retained');
 assert.equal(wirePopulationShaV1(money.split('AS $$')[1]!.split('$$;')[0]!),wirePopulationMoneyProsrcShaV1);
 return{raw,acl,money,original_raw:rewriteV1(raw,true),original_money:inverse,columns:wirePopulationColumnsV1};
}
// Only these three substitutions inside the bounded helper precede all older
// compiler/compact/CE inverses. Other bytes remain exposed to frozen hashes.
const metadataRewritesV1=[
 ["FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing')","FROM signal_listening_wire_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing')"],
 ['octet_length(p.body)::bigint','p.body_octets::bigint'],
 ["octet_length(COALESCE(p.platform,''))::bigint",'p.platform_octets::bigint'],
]as const;
function metadataTransformV1(source:string,inverse:boolean){
 const start=source.indexOf('async function inputProjectionMetadata('),end=source.indexOf('async function inputs(',start);assert.ok(start>=0&&end>start);let helper=source.slice(start,end);
 for(const [old,next]of metadataRewritesV1){const from=inverse?next:old,to=inverse?old:next;assert.equal(helper.split(from).length,2,'exactly one registered bounded metadata delta');assert.equal(helper.split(to).length,1);helper=helper.replace(from,to);}
 return source.slice(0,start)+helper+source.slice(end);
}
export const wirePopulationMetadataV1=(source:string)=>metadataTransformV1(source,false);
export const invertWirePopulationMetadataV1=(source:string)=>metadataTransformV1(source,true);

// record_send retains native type OIDs, NULLs and numeric scale. Both bags are
// evaluated in the caller's one snapshot; no JSON comparator or decoder rewrite.
export async function compareWirePopulationV1(c:Pick<PoolClient,'query'>,params:unknown[]){
 assert.equal(params.length,6);
 const args='($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)';
 const old='SELECT '+wirePopulationColumnsV1.slice(0,9).map(k=>'p.'+k).join(',')+",octet_length(p.body) body_octets,octet_length(COALESCE(p.platform,'')) platform_octets FROM signal_listening_population_roots_v1"+args+' p';
 const next='SELECT p.* FROM '+wirePopulationNameV1+args+' p';
 const fields=await c.query('SELECT * FROM ('+old+') old LIMIT 0',params),current=await c.query('SELECT * FROM ('+next+') new LIMIT 0',params);
 assert.deepEqual(current.fields.map(f=>[f.name,f.dataTypeID]),fields.fields.map(f=>[f.name,f.dataTypeID]),'eleven native names/types equal raw14 projection');
 const result=await c.query(`WITH old AS MATERIALIZED(${old}),new AS MATERIALIZED(${next}),bag_difference AS MATERIALIZED((TABLE old EXCEPT ALL TABLE new) UNION ALL (TABLE new EXCEPT ALL TABLE old))
 SELECT side,bytes,(SELECT count(*)::text FROM bag_difference) difference FROM(
 SELECT 'old' side,encode(pg_catalog.record_send(o),'hex') bytes FROM old o
 UNION ALL SELECT 'new' side,encode(pg_catalog.record_send(n),'hex') bytes FROM new n) exact ORDER BY side,bytes`,params);
 const hashes={old:createHash('sha256'),new:createHash('sha256')},counts={old:0,new:0};
 for(const row of result.rows){assert.equal(row.difference,'0','typed EXCEPT ALL preserves multiplicity');assert.ok(row.side==='old'||row.side==='new');const side=row.side as 'old'|'new';if(counts[side]++)hashes[side].update('\n');hashes[side].update(row.bytes);}
 assert.equal(counts.new,counts.old);assert.equal(hashes.new.digest('hex'),hashes.old.digest('hex'),'ordered full native record bytes/SHA equal, including numeric scale and Unicode');
 return counts.old;
}

export async function wirePopulationCatalogV1(c:Pick<PoolClient,'query'>){
 const rows=(await c.query<Record<string,unknown>>(`SELECT p.proname,p.oid::text,p.proowner::text,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a) acl,
 p.prosrc,p.proargtypes::text,p.pronargs,p.pronargdefaults,p.proargdefaults::text,p.proisstrict,p.prosecdef,p.provolatile,p.proparallel,p.proleakproof,p.prokind,p.procost,p.prorows,p.prosupport::text,l.lanname,p.proconfig,
 p.proallargtypes::text,p.proargmodes::text,p.proargnames::text,p.proretset,p.prorettype::text
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid IN('public.signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure,'public.signal_listening_wire_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure) ORDER BY p.proname`)).rows;
 assert.equal(rows.length,2);const old=rows.find(r=>r.proname==='signal_listening_population_roots_v1')!,next=rows.find(r=>r.proname===wirePopulationNameV1)!;assert.ok(old&&next);assert.notEqual(next.oid,old.oid);
 const common=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>!['proname','oid','prosrc','proallargtypes','proargmodes','proargnames','prorettype'].includes(key)));
 assert.deepEqual(common(next),common(old),'new invoker owner/EXECUTE grantor+option and function attrs equal the historical raw homologue');
 assert.equal(wirePopulationShaV1(String(old.prosrc)),'5531986513d8672fe5a8d3e2d97c433973d9584193412f2900204e613f7376e7');
 return rows;
}

/** One opt-in synthetic CI root; the absent/false path returns the original
 * array/reference and bytes. No provider, global env, clock or live data. */
export function wireOctetProbeTextsV1(texts:string[],enabled=false){
 if(!enabled)return texts;assert.equal(texts.length,3,'octet probe uses only the existing three-root fixture');
 const next=[...texts];next[0]=texts[0]+' synthetic bicycle '+ 'é é 😀 漢字 '.repeat(96);
 assert.ok(Buffer.byteLength(next[0]!)<12000);assert.ok(Buffer.byteLength(next[0]!)>[...next[0]!].length);return next;
}
