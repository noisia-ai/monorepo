import {invertSignalListeningSurveyReaderV1} from './signal-listening-survey-source-chain.test-support';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {wirePopulationSourceV1,wirePopulationShaV1,wirePopulationNameV1,wirePopulationColumnsV1,wirePopulationCatalogV1,invertWirePopulationMetadataV1,wirePopulationMetadataV1} from './signal-listening-wire-population.oracle';
import {projectionHelperPartsV1} from './signal-listening-projection-linear-joins.oracle';
import {assertSharedWireDefaultRuntimeV1,statementNativeFunctionCatalogV1} from './signal-listening-statement-shared-wire.oracle';
const populationSignature='public.signal_listening_wire_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)';
const outputTypes=['uuid','text','text','text','jsonb','text','boolean','text','jsonb','integer','integer'];
export function wireObserverContractV1(raw:string,moneyD:string,sourceE:string,runs:string){
 const proof=wirePopulationSourceV1(raw,moneyD,sourceE),beforeSurvey=invertSignalListeningSurveyReaderV1(runs),previous=invertWirePopulationMetadataV1(beforeSurvey);assert.equal(wirePopulationMetadataV1(previous),beforeSurvey);
 const metadataSql=projectionHelperPartsV1(runs).sql,metadataBefore=projectionHelperPartsV1(previous).sql,metadataBeforeSurvey=projectionHelperPartsV1(beforeSurvey).sql;
 assert.equal(wirePopulationShaV1(metadataBefore),'56cd8ee4ddbc1073082bd8fabac8cd4ed46151186f9039e76b2a4ca4801b0db6','complete frozen pre-E nine-bind query');
 assert.equal(wirePopulationShaV1(metadataBeforeSurvey),'fdc142c1d04a0c102bba69480a7eb6fa12c0137a3dd5c0687185a9dffc58eb64','complete historical E query stays frozen independently of the current candidate');
 const previousJoin='   ), prefix AS MATERIALIZED(',currentJoin='   )  , prefix AS MATERIALIZED(';
 assert.equal(metadataBeforeSurvey.split(previousJoin).length,2);assert.equal(metadataSql.split(currentJoin).length,2);
 assert.equal(metadataSql,metadataBeforeSurvey.replace(previousJoin,currentJoin),'actual legacy reader differs only at the reviewed survey conditional whitespace');
 assert.equal(metadataSql.replace(currentJoin,previousJoin),metadataBeforeSurvey,'closed whitespace inverse preserves the original complete E SQL witness');
 return{metadataSql,metadataBefore,metadataBeforeSurvey,populationSignature,populationBody:proof.raw.split('AS $function$')[1]!.split('$function$;')[0]!,moneyBody:proof.money.split('AS $$')[1]!.split('$$;')[0]!};
}
export async function loadWireObserverContractV1(){
 const [raw,d,e,runs]=await Promise.all(['./0333_signal_listening_bounded_mentions.sql','./0336_signal_listening_statement_native_projection.sql','./0337_signal_listening_wire_population.sql','../signal-listening-runs.ts'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
 assert.ok(raw&&d&&e&&runs);return wireObserverContractV1(raw,d,e,runs);
}
type Contract=ReturnType<typeof wireObserverContractV1>;
type Identity={workspace_id:string;configuration_id:string;map_id:string;entity_context_digest:string;run_id:string};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
export function assertWireObserverMetadataV1(sql:string,params:unknown[]|undefined,contract:Contract,expected:Identity){
 assert.equal(sql,contract.metadataSql,'metadata must be the complete fixed E bounded projection');assert.ok(params);assert.equal(params.length,9);
 for(const [index,value]of[expected.workspace_id,expected.configuration_id,expected.map_id,expected.entity_context_digest,expected.run_id].entries())assert.equal(params[index],value,'semantic bind position');
 for(const index of[0,1,2,4])assert.ok(uuid(params[index]));assert.match(String(params[3]),/^sha256:[a-f0-9]{64}$/u);
 assert.ok(Number.isSafeInteger(params[5])&&Number(params[5])>0);assert.ok(Number.isSafeInteger(params[6])&&Number(params[6])>=0);
 assert.ok(Array.isArray(params[7])&&params[7].length<=4096&&params[7].every(uuid),'bounded UUID roots at $8, never NULL/full population');assert.ok(typeof params[8]==='string'&&/^(0|[1-9][0-9]*)$/u.test(params[8]));
}
export function assertWireObserverSignatureV1(row:Record<string,unknown>){
 assert.equal(row.proname,wirePopulationNameV1);assert.equal(row.arguments,'uuid, uuid, uuid, text, uuid[], text');assert.equal(row.defaults,0);assert.equal(row.result,'record');
 assert.deepEqual(row.names,['w','cid','mid','ctx','roots','purpose',...wirePopulationColumnsV1]);assert.deepEqual(row.modes,[...Array(6).fill('i'),...Array(11).fill('t')]);assert.deepEqual(row.outputs,outputTypes);
}
/** Catalog reads only: never replace/instrument a public body or redefine a
 * producer. Returned complete catalogs attest unchanged OID/owner/ACL/attrs. */
export async function attestWireObserverRuntimeV1(c:Pick<PoolClient,'query'>,contract:Contract){
 const runtime=await assertSharedWireDefaultRuntimeV1(c);assert.equal(runtime.default_arm,'E');assert.equal(runtime.prosrc_sha256,wirePopulationShaV1(contract.moneyBody));
 const population=await wirePopulationCatalogV1(c),row=population.find(r=>r.proname===wirePopulationNameV1)!;assert.ok(row);assert.equal(row.prosrc,contract.populationBody);
 for(const [key,value]of Object.entries({lanname:'plpgsql',provolatile:'s',prosecdef:false,proisstrict:false,proparallel:'u',proleakproof:false,prokind:'f',proretset:true,pronargs:6,proconfig:['search_path=public, extensions, pg_temp']}))assert.deepEqual(row[key],value);
 const shape=(await c.query(`SELECT p.proname,pg_catalog.oidvectortypes(p.proargtypes) arguments,p.pronargdefaults defaults,p.proargnames names,p.proargmodes::text[] modes,p.prorettype::regtype::text result,
 ARRAY(SELECT pg_catalog.format_type(t,NULL) FROM pg_catalog.unnest(p.proallargtypes) WITH ORDINALITY a(t,n) WHERE n>p.pronargs ORDER BY n) outputs
 FROM pg_catalog.pg_proc p WHERE p.oid=$1::pg_catalog.regprocedure`,[contract.populationSignature])).rows;assert.equal(shape.length,1);assertWireObserverSignatureV1(shape[0]);
 // Existing catalog helper consumes query only; the attestation also works on
 // the fixture database outside its completed/rolled-back transaction.
 const money=await statementNativeFunctionCatalogV1(c as PoolClient);assert.equal(money.length,1);assert.equal(money[0]!.prosrc,contract.moneyBody);
 return{population,money,shape};
}
