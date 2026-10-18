/** Creates sealed fresh packets for the auditor; contains no semantic reviewer or provider call. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {indexStandardBaselineV2} from './standard-v2-baseline';
import {normalizeCitationsV2,blindDisagreementV2} from './standard-v2-blind';
import {reviewedPairExclusionV3,selectFreshPrevalenceSampleV3} from './standard-v3-blind';
import {replayStandardV2Raw} from './standard-v2-raw-audit';
import {binary,wilson} from './metrics';
import {validateGold,validateSelection,type Gold,type Selection} from './contract';
const directory='.data/dev-corpus/voyage-real/standard-v3-r12',prior='.data/dev-corpus/voyage-real/standard-v2-r11';
const semantic=new Set(['belongs','not_belongs','insufficient']);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex'),key=(r:any)=>`${r.root_id}:${r.concept_key}`;
void main(async()=>{
 const identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 try{
  const baseline=JSON.parse(await readFile(`${prior}/baseline.json`,'utf8')),cache=JSON.parse(await readFile(`${prior}/baseline-cache.json`,'utf8'));
  assert.equal(cache.root_input_sha256,baseline.root_input_sha256);assert.equal(cache.labeler_digest,baseline.run.labeler_digest);
  const live=(await pool.query('SELECT root_id,input_digest FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 ORDER BY root_id',[identity.workspace_id])).rows;
  assert.equal(live.length,1086);assert.equal(hash(JSON.stringify(live.map((r:any)=>[r.root_id,r.input_digest]))),baseline.root_input_sha256);
  const previousBytes=await readFile(`${prior}/blind/trace.json`,'utf8'),previousManifest=JSON.parse(await readFile(`${prior}/blind/manifest.json`,'utf8'));
  assert.equal(hash(previousBytes),previousManifest.trace_sha256);const excluded=reviewedPairExclusionV3(JSON.parse(previousBytes));
  const roots=new Map<string,any>(baseline.roots.map((r:any)=>[r.root_id,r])),current=indexStandardBaselineV2(cache.predictions,baseline.roots);
  const selection=JSON.parse(await readFile('.data/dev-corpus/voyage-real/gold-selection.json','utf8')) as Selection;validateSelection(selection);
  const gold=(await readFile('.data/dev-corpus/voyage-real/gold.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line)) as Gold[];validateGold(gold,selection);
  const positives:any[]=[],disagreements:any[]=[],trace:any[]=[];const arms:any[]=[];
  for(const effort of ['low','medium'] as const){
   let manifest:any;try{manifest=JSON.parse(await readFile(`${directory}/run-${effort}.json`,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
   assert.equal(manifest.root_input_sha256,baseline.root_input_sha256);
   const run=(await pool.query(`SELECT r.*,l.identity,l.labeler_digest,ce.context FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no WHERE r.id=$1 AND r.workspace_id=$2`,[manifest.run_id,identity.workspace_id])).rows[0];
   assert.equal(run.status,'completed');assert.equal(run.identity.params.standard_judge_version,3);assert.equal(run.membership_snapshot.preview,true);assert.equal(run.identity.params.effort,effort);
   const calls=(await pool.query('SELECT id,inputs,results,usage,settled_micro_usd::text,provider_batch_id FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at,id',[run.id])).rows;
   const replay=await replayStandardV2Raw(pool,identity.workspace_id,run.id);assert.equal(replay.report.serving_writes,0);
   assert.ok(replay.report.items.every(item=>item.classification==='matches_v2'),'raw replay must equal the shared v2/v3 literal-citation protocol');
   const predictions=new Map<string,any>();for(const call of calls)for(const result of (replay.reparsed.get(call.id)??call.results) as any[])predictions.set(key(result),{...result,call_id:call.id});
   for(const call of calls)for(const input of call.inputs){assert.equal(input.input_digest,roots.get(input.root_id)?.input_digest);assert.equal(input.text,roots.get(input.root_id)?.text);}
   const concepts=run.membership_snapshot.concepts,definition=(k:string)=>{const {concept_key:_k,definition_digest:_d,...rest}=concepts.find((c:any)=>c.concept_key===k);return rest;};
   const mention=(r:any)=>{const m=roots.get(r.root_id);return {text:m.text,title:m.title,platform:m.platform,content_type:m.content_type,entities:m.facets.entities.value,voice:m.facets.voice.value,act:m.facets.act.value};};
   const normalize=(r:any)=>r?{verdict:r.verdict,citations:normalizeCitationsV2(roots.get(r.root_id).text,r.citations??[])}:{verdict:'not_evaluated',citations:[]};
   const population=[...predictions.values()].filter(r=>r.verdict==='belongs'),seed=`standard-v3-r12:${baseline.root_input_sha256}:${run.labeler_digest}`;
   const sample=selectFreshPrevalenceSampleV3(population,excluded,seed,60);
   const changed=[...predictions.values()].filter(r=>semantic.has(r.verdict)&&semantic.has(current.get(key(r))?.verdict)&&r.verdict!==current.get(key(r))?.verdict&&!excluded.has(key(r)));
   const technical=[...predictions.values()].filter(r=>!semantic.has(r.verdict));
   const changedSample=changed.length>60?selectFreshPrevalenceSampleV3(changed,excluded,seed+':disagreements',60):changed.sort((a,b)=>hash(seed+key(a)).localeCompare(hash(seed+key(b))));
   for(const row of sample){const id=hash(seed+':positive:'+key(row));positives.push({_sort:id,concept:definition(row.concept_key),mention:mention(row),entity_context:run.context,citations:normalize(row).citations});trace.push({private_id:id,kind:'positive',effort,root_id:row.root_id,concept_key:row.concept_key,call_id:row.call_id});}
   for(const row of changedSample){const id=hash(seed+':disagreement:'+key(row)),options=blindDisagreementV2(key(row),seed,[normalize(current.get(key(row))),normalize(row)]);disagreements.push({_sort:id,concept:definition(row.concept_key),mention:mention(row),entity_context:run.context,options:options.options});trace.push({private_id:id,kind:'disagreement',effort,root_id:row.root_id,concept_key:row.concept_key,version_order:options.version_order});}
   const scores=['dev','test'].map(partition=>({partition,concepts:concepts.map((concept:any)=>{
    let tp=0,fp=0,fn=0,baselineTp=0,missing=0;
    for(const g of gold.filter((g:any)=>g.partition===partition)){
     assert.equal(g.input_digest,roots.get(g.root_id)?.input_digest);const truth=g.memberships[concept.concept_key];if(!truth||truth==='insufficient')continue;
     const p=predictions.get(`${g.root_id}:${concept.concept_key}`),b=current.get(`${g.root_id}:${concept.concept_key}`);if(!p)missing++;
     if(truth==='belongs'){if(p?.verdict==='belongs')tp++;else fn++;if(b?.verdict==='belongs')baselineTp++;}else if(p?.verdict==='belongs')fp++;
    }
    return {concept_key:concept.concept_key,...binary(tp,fp,fn),precision_wilson:wilson(tp,tp+fp),recall_wilson:wilson(tp,tp+fn),baseline_tp:baselineTp,recalled_pair_delta:tp-baselineTp,not_evaluated:missing};
   })}));
   const total=calls.reduce((n:number,c:any)=>n+Number(c.settled_micro_usd),0);
   arms.push({effort,model:run.identity.model,labeler_digest:run.labeler_digest,roots:1086,pairs:predictions.size,technical_results:technical.length,positives:population.length,fresh_positive_population:population.filter(r=>!excluded.has(key(r))).length,blind_positive_count:sample.length,disagreements:changed.length,blind_disagreement_count:changedSample.length,gold:scores,
    wall_ms:new Date(run.completed_at).getTime()-new Date(run.created_at).getTime(),cost:{settled_micro_usd:total,usd_per_1000_roots:total/1e6*1000/1086,calls:calls.length,batches:new Set(calls.map((c:any)=>c.provider_batch_id)).size,usage:Object.fromEntries(['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].map(k=>[k,calls.reduce((n:number,c:any)=>n+Number(c.usage?.[k]??0),0)]))},definitions_sha256:manifest.definitions_sha256});
   await writeFile(`${directory}/raw-audit-${effort}.json`,JSON.stringify(replay.report,null,2)+'\n',{mode:0o600});
  }
  assert.ok(arms.length);assert.ok(arms.some(a=>a.effort==='medium'),'medium arm has priority if balance funds only one');
  const rubric='Evalúa con la definición completa, el contexto suministrado y las decisiones del fundador de AUDIT §17.7. Decide pertenencia y apoyo de citas por separado. En desacuerdos juzga ambas opciones. No abras trazas, gold ni resultados antes de sellar los veredictos. Los paquetes mezclan esfuerzos sin revelarlos.';
  await mkdir(`${directory}/blind`,{recursive:true,mode:0o700});const files:Record<string,string>={};
  for(const [kind,rows]of [['positives',positives],['disagreements',disagreements]] as const){
   const items=rows.sort((a,b)=>a._sort.localeCompare(b._sort)).map(({_sort,...row},i)=>{const sample_id=`${kind==='positives'?'P':'D'}${String(i+1).padStart(3,'0')}`;trace.find(t=>t.private_id===_sort)!.sample_id=sample_id;return {sample_id,...row};});
   files[kind]=JSON.stringify({contract_version:'mfp-blind-semantic-review-v4',rubric,items},null,2)+'\n';
  }
  files.trace=JSON.stringify({excluded_previous_trace_sha256:hash(previousBytes),excluded_previous_items:120,excluded_unique_pairs:excluded.size,items:trace,arms:arms.map(a=>({effort:a.effort,labeler_digest:a.labeler_digest})),normalization:'Shared quote/start/end fields, literal same-root complete sentences, overlaps merged.'},null,2)+'\n';
  for(const [name,payload]of Object.entries(files))await writeFile(`${directory}/blind/${name}.json`,payload,{flag:'wx',mode:0o600});
  const sealed={counts:{positives:positives.length,disagreements:disagreements.length},sha256:Object.fromEntries(Object.entries(files).map(([name,payload])=>[name,hash(payload)])),excluded_previous_items:120,root_input_sha256:baseline.root_input_sha256};
  await writeFile(`${directory}/blind/manifest.json`,JSON.stringify(sealed,null,2)+'\n',{flag:'wx',mode:0o600});
  const report={contract_version:'mfp-standard-v3-comparison-v1',status:'measurement_complete_pending_auditor',arms,blind:sealed,reviewer:'auditor',reviewed:false,default_changed:false,contrast:'Current historical v1/medium with earlier definitions versus v3 with founder-confirmed Cobros v5. No isolated causal prompt claim.',adoption:{precision_min:.9,precision_lower_bound_min:.8,gold_max_lost_pairs:2,true_positive_loss_extrapolated_max:.05,disagreements_more_correct_required:true,decision:'pending_auditor'},at:new Date().toISOString()};
  await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({stage:'standard_v3_reported',...report}));
 }finally{await pool.end();}
});
