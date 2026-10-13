/** Exports the sealed corpus comparison and blind packets; performs no semantic review. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {binary,wilson} from './metrics';
import {validateGold,validateSelection,type Gold,type Selection} from './contract';
import {indexStandardBaselineV2} from './standard-v2-baseline';
import {serializeStandardV2ReportV1} from './standard-v2-artifacts';
import {replayStandardV2Raw} from './standard-v2-raw-audit';
import {selectPrevalenceSampleV2,normalizeCitationsV2,blindDisagreementV2} from './standard-v2-blind';
const directory='.data/dev-corpus/voyage-real/standard-v2-r11';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const pair=(row:any)=>`${row.root_id}:${row.concept_key}`;
const semantic=new Set(['belongs','not_belongs','insufficient']);
const index=(calls:any[])=>{const map=new Map<string,any>();for(const call of calls)for(const result of call.results??[])map.set(pair(result),{...result,call_id:call.id});return map;};
void main(async()=>{
 const identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 try{
  const baseline=JSON.parse(await readFile(`${directory}/baseline.json`,'utf8'));
  const baselineCache=JSON.parse(await readFile(`${directory}/baseline-cache.json`,'utf8'));
  assert.equal(baselineCache.root_input_sha256,baseline.root_input_sha256);assert.equal(baselineCache.labeler_digest,baseline.run.labeler_digest);assert.equal(baselineCache.reused_pairs,420);
  const manifest=JSON.parse(await readFile(`${directory}/run-manifest.json`,'utf8'));
  const run=(await pool.query(`SELECT r.*,l.identity,l.labeler_digest,ce.context FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no WHERE r.id=$1 AND r.workspace_id=$2`,[manifest.run_id,identity.workspace_id])).rows[0];
  assert.equal(run.status,'completed');assert.equal(run.identity.params.standard_judge_version,2);assert.equal(run.membership_snapshot.preview,true);
  const calls=(await pool.query(`SELECT id,run_id,provider_batch_id,custom_id,request_digest,raw_sha256,raw_storage_key,raw_size_bytes,status,results_applied,inputs,results,usage,settled_micro_usd::text FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at,id`,[run.id])).rows;
  assert.ok(calls.length);assert.ok(calls.every((c:any)=>c.status==='settled'&&c.results_applied&&c.raw_sha256));
  const replayed=await replayStandardV2Raw(pool,identity.workspace_id,run.id);
  assert.equal(replayed.report.serving_writes,0);
  await writeFile(`${directory}/raw-audit.json`,JSON.stringify(replayed.report,null,2)+'\n',{mode:0o600});
  const evidenceCalls=calls.map((call:any)=>({...call,results:replayed.reparsed.get(call.id)??call.results}));
  const current=(await pool.query(`SELECT root_id,input_digest FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 ORDER BY root_id`,[identity.workspace_id])).rows;
  assert.equal(hash(JSON.stringify(current.map((r:any)=>[r.root_id,r.input_digest]))),baseline.root_input_sha256);
  assert.deepEqual(run.membership_snapshot.sample_root_ids,current.map((r:any)=>r.root_id));
  assert.deepEqual((await pool.query('SELECT jsonb_agg(w ORDER BY workspace_id,kind) selectors FROM signal_workspace_labelers w')).rows[0].selectors,baseline.before.selectors);
  const v1=indexStandardBaselineV2(baselineCache.predictions,baseline.roots),v2=index(evidenceCalls),roots=new Map<string,any>(baseline.roots.map((r:any)=>[r.root_id,r]));
  for(const call of calls)for(const input of call.inputs){assert.equal(input.input_digest,roots.get(input.root_id)?.input_digest);assert.equal(input.text,roots.get(input.root_id)?.text);}
  const concepts:any[]=run.membership_snapshot.concepts;const keys=concepts.map(c=>c.concept_key);
  const technical=[...v2.values()].filter(row=>!semantic.has(row.verdict));
  const normalized=(row:any)=>row?{verdict:row.verdict,citations:normalizeCitationsV2(roots.get(row.root_id).text,row.citations??[])}:{verdict:'not_evaluated',citations:[]};
  const union=[...new Set([...v1.keys(),...v2.keys()])].map(key=>({key,...(v2.get(key)??v1.get(key)),left:normalized(v1.get(key)),right:normalized(v2.get(key))}));
  const positives=[...v2.values()].filter(row=>row.verdict==='belongs');
  const seed=`mfp-standard-v2-r11-sealed-baseline-v2:${baseline.root_input_sha256}:${run.labeler_digest}`;
  const chosen=selectPrevalenceSampleV2(positives,seed,60);
  const disagreementPopulation=union.filter(row=>row.left.verdict!==row.right.verdict);
  const disagreements=disagreementPopulation.length>60?selectPrevalenceSampleV2(disagreementPopulation,seed+':disagreements',60):[...disagreementPopulation].sort((a,b)=>hash(`${seed}:${a.key}`).localeCompare(hash(`${seed}:${b.key}`)));
  const conceptFor=(key:string)=>{const {concept_key:_key,definition_digest:_digest,...definition}=concepts.find(c=>c.concept_key===key)!;return definition;};
  const mentionFor=(row:any)=>{const root=roots.get(row.root_id);return {text:root.text,title:root.title,platform:root.platform,content_type:root.content_type,entities:root.facets.entities.value,voice:root.facets.voice.value,act:root.facets.act.value};};
  const positiveItems=chosen.map((row,index)=>({sample_id:`P${String(index+1).padStart(2,'0')}`,concept:conceptFor(row.concept_key),mention:mentionFor(row),entity_context:run.context,citations:normalized(row).citations}));
  const trace:any[]=[];
  const disagreementItems=disagreements.map((row,index)=>{const item=blindDisagreementV2(row.key,seed,[row.left,row.right]);trace.push({sample_id:`D${String(index+1).padStart(2,'0')}`,root_id:row.root_id,concept_key:row.concept_key,version_order:item.version_order});return {sample_id:trace.at(-1).sample_id,concept:conceptFor(row.concept_key),mention:mentionFor(row),entity_context:run.context,options:item.options};});
  const rubric='Evalúa de forma independiente con las definiciones suministradas, sin abrir trazas, gold ni informes de resultados. Decide membership: belongs, not_belongs o insufficient usando el texto propio, sin inferir hechos ausentes. Decide aparte citation_support: supported, unsupported o insufficient: la cita debe sostener el hecho decisivo y cada condición necesaria. En desacuerdos evalúa ambas opciones con la misma definición; devuelve opción correcta o neither/both y razones breves. No uses el formato como pista del origen.';
  const packets={positives:JSON.stringify({contract_version:'mfp-blind-semantic-review-v3',rubric,items:positiveItems},null,2)+'\n',disagreements:JSON.stringify({contract_version:'mfp-blind-semantic-review-v3',rubric,items:disagreementItems},null,2)+'\n'};
  const strata=(population:any[],sample:any[])=>Object.fromEntries(keys.map(key=>[key,{population:population.filter(r=>r.concept_key===key).length,sampled:sample.filter(r=>r.concept_key===key).length}]));
  const blindTrace={seed,positive_strata:strata(positives,chosen),disagreement_strata:strata(disagreementPopulation,disagreements),positive_items:chosen.map((r,i)=>({sample_id:positiveItems[i]!.sample_id,root_id:r.root_id,concept_key:r.concept_key,call_id:r.call_id})),disagreement_items:trace,versions:[{name:'baseline_current_v1_v3',run_id:baseline.run.id,labeler_digest:baseline.run.labeler_digest},{name:'candidate_v2_v4',run_id:run.id,labeler_digest:run.labeler_digest}],normalization:'Same quote/start/end fields; sorted and adjacent/overlapping spans merged without adding, expanding or dropping text.'};
  const selection=JSON.parse(await readFile('.data/dev-corpus/voyage-real/gold-selection.json','utf8')) as Selection;validateSelection(selection);
  const gold=(await readFile('.data/dev-corpus/voyage-real/gold.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line)) as Gold[];validateGold(gold,selection);for(const row of gold)assert.equal(roots.get(row.root_id)?.input_digest,row.input_digest);
  const goldViews=(partition:'dev'|'test')=>{
   const rows=gold.filter(row=>row.partition===partition);
   const common=new Set([...v1.keys()].filter(key=>v2.has(key)));
   const score=(map:Map<string,any>,shared:boolean)=>selection.concepts.map(concept=>{
    let tp=0,fp=0,fn=0,denominator=0,insufficient=0,notEvaluated=0;
    for(const root of rows){const key=`${root.root_id}:${concept.concept_key}`;if(shared&&!common.has(key))continue;
     const truth=root.memberships[concept.concept_key];if(truth==='insufficient'){insufficient++;continue;}denominator++;
     const predicted=map.get(key)?.verdict??'not_evaluated';if(predicted==='not_evaluated')notEvaluated++;
     if(truth==='belongs'&&predicted==='belongs')tp++;else if(truth==='belongs')fn++;else if(predicted==='belongs')fp++;
    }return {concept_key:concept.concept_key,denominator,gold_insufficient:insufficient,not_evaluated:notEvaluated,...binary(tp,fp,fn),precision_wilson:wilson(tp,tp+fp),recall_wilson:wilson(tp,tp+fn)};
   });
   const pipelineV1=score(v1,false),pipelineV2=score(v2,false);
   return {partition,roots:rows.length,judge_v1_shared:score(v1,true),judge_v2_shared:score(v2,true),pipeline_v1:pipelineV1,pipeline_v2:pipelineV2,
    total_positive_pairs:pipelineV1.reduce((n,r)=>n+r.tp+r.fn,0),v1_recalled_pairs:pipelineV1.reduce((n,r)=>n+r.tp,0),v2_recalled_pairs:pipelineV2.reduce((n,r)=>n+r.tp,0),
    v2_recalled_pairs_delta:pipelineV2.reduce((n,r)=>n+r.tp,0)-pipelineV1.reduce((n,r)=>n+r.tp,0)};
  };
  const cost=(list:any[])=>({settled_micro_usd:list.reduce((n,c)=>n+Number(c.settled_micro_usd),0),usage:Object.fromEntries(['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].map(key=>[key,list.reduce((n,c)=>n+Number(c.usage?.[key]??0),0)])),calls:list.length,batches:new Set(list.map(c=>c.provider_batch_id).filter(Boolean)).size});
  const v1batchIds=(await pool.query('SELECT DISTINCT provider_batch_id FROM signal_labeling_calls WHERE run_id=$1 AND provider_batch_id IS NOT NULL',[baseline.run.id])).rows;
  const v2cost=cost(calls),v1cost={...cost(baseline.calls),batches:v1batchIds.length};
  assert.equal(goldViews('test').total_positive_pairs,31);assert.equal(goldViews('test').v1_recalled_pairs,28,'audited_baseline_recall');
  const normalization=JSON.parse(await readFile(`${directory}/normalization-reconciled.json`,'utf8'));
  assert.equal(normalization.passed,true);
  const report:any={contract_version:'mfp-standard-v2-comparison-v1',status:'complete_measurement_pending_auditor',roots:1086,root_input_sha256:baseline.root_input_sha256,concepts:keys,
   wall_ms:new Date(run.completed_at).getTime()-new Date(run.created_at).getTime(),model:run.identity.model,effort:run.identity.params.effort,labeler_digest:run.labeler_digest,definitions_sha256:manifest.definitions_sha256,
   normalization:{...normalization,original_error_states_ref:'normalization-plan.json',raw_unchanged:true,verdicts_and_citations_unchanged:true},
   raw_audit:{worker_process_attribution:replayed.report.worker_process_attribution,provider_calls:0,serving_writes:replayed.report.serving_writes,parser_differences:replayed.report.items.filter(item=>item.classification!=='matches_v2'),review_source:'SHA256-verified raw replayed with parser v2; stored results and difference digests remain in private audit.'},
   contrast:'Historical current standard v1/medium + v3 versus experimental standard v2/low + Cobros v4. Other six concepts unchanged. No third paid v1/v4 run; no isolated causal prompt claim.',
   baseline_provenance:{pairs:baselineCache.pairs,reused_pairs:baselineCache.reused_pairs,verified_raw_calls:baselineCache.verified_raw_calls,technical_pairs:baselineCache.predictions.filter((r:any)=>!semantic.has(r.verdict)).length},
   costs:{v1:{...v1cost,scope:'last incremental run only; reused-source call costs retained in baseline-cache.json',source_call_micro_usd:baselineCache.source_calls.reduce((n:number,c:any)=>n+Number(c.settled_micro_usd),0)},v2:v2cost,v2_usd_per_1000_roots:v2cost.settled_micro_usd/1e6*1000/1086},
   population:{relevance:Object.fromEntries([...new Set(baseline.roots.map((r:any)=>r.relevance))].map(v=>[String(v),baseline.roots.filter((r:any)=>r.relevance===v).length])),v1_judged_roots:new Set([...v1.values()].map(r=>r.root_id)).size,v2_judged_roots:new Set([...v2.values()].map(r=>r.root_id)).size,v1_pairs:v1.size,v2_pairs:v2.size,v1_positives:[...v1.values()].filter(r=>r.verdict==='belongs').length,v2_positives:positives.length,disagreements:disagreementPopulation.length,technical_results:technical.length},
   gold:[goldViews('dev'),goldViews('test')],blind:{positives:positiveItems.length,disagreements:disagreementItems.length,strata:blindTrace.positive_strata,reviewer:'AUDITOR, not implementer',reviewed:false},
   adoption:{blind_precision_min:0.9,blind_lower_bound_min:0.8,disagreements_v2_more_correct_required:true,gold_recall_max_lost_pairs:2,default_changed:false,decision:'pending_auditor'},
   balance:{...manifest,balance_current_verified:false},default_unchanged:true,created_at:new Date().toISOString()};
  await mkdir(`${directory}/blind`,{recursive:true,mode:0o700});
  for(const [name,payload]of Object.entries(packets))await writeFile(`${directory}/blind/${name}.json`,payload,{mode:0o600,flag:'wx'});
  const tracePayload=JSON.stringify(blindTrace,null,2)+'\n';await writeFile(`${directory}/blind/trace.json`,tracePayload,{mode:0o600,flag:'wx'});
  const sealed={positives_sha256:hash(packets.positives),disagreements_sha256:hash(packets.disagreements),trace_sha256:hash(tracePayload),counts:{positive:60,disagreement:disagreementItems.length},root_input_sha256:baseline.root_input_sha256,sampling_version:'sealed-baseline-v2'};
  await writeFile(`${directory}/blind/manifest.json`,JSON.stringify(sealed,null,2)+'\n',{mode:0o600,flag:'wx'});
  const globalCalls=(await pool.query('SELECT count(*)::int n FROM signal_labeling_calls')).rows[0].n;
  const globalCallDelta=globalCalls-baseline.before.calls-calls.length;
  await writeFile(`${directory}/report.json`,serializeStandardV2ReportV1(report,globalCallDelta),{mode:0o600});
  await writeFile(`${directory}/ledger.json`,JSON.stringify({run_id:run.id,calls:calls.map(({inputs:_inputs,results:_results,...call}:any)=>call)},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({stage:'standard_v2_reported',...sealed,cost:report.costs,population:report.population,gold:report.gold.map((row:any)=>({partition:row.partition,positive_pairs:row.total_positive_pairs,v1:row.v1_recalled_pairs,v2:row.v2_recalled_pairs,delta:row.v2_recalled_pairs_delta})),default_unchanged:true}));
 }catch(error){const err=error as {message?:string;code?:string;stack?:string};console.error(JSON.stringify({stage:'standard_v2_report_error',code:err.code??null,location:err.stack?.split('\n').find(line=>line.includes('standard-v2-report.ts'))?.trim(),message:err.message&&/^[a-zA-Z0-9_ .:]+$/.test(err.message)?err.message:'assertion_or_sanitized_error'}));throw error;}finally{await pool.end();}
});
