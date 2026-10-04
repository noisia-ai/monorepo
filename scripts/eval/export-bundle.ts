/** Export only aggregate-ready predictions from explicit private run IDs on MFP runner. */
import { readFile,writeFile } from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import { main,openDatabase } from '../dev-corpus/guard.mjs';
import { validateBundle,validateSelection,type Bundle,type Selection,type Variant } from './contract';
import { facetPredictions,membershipPredictions,ledgerCosts,type LedgerCall } from './ledger-export';
import { loadJevReceiptBodies } from './ledger-export';
import { loadMfpEvalIdentity } from './fixture-identity';
import { createWorkspaceEngineStorageV1 } from '../../services/workers/src/workers/signal-workspace-engine-storage';
import { readSignalLabelingReceiptV1 } from '../../services/workers/src/workers/signal-labeling-receipt-storage';

type Manifest={variants:Array<{variant:Variant['variant'];run_ids:string[];thresholds?:Variant['thresholds']}>,
  jev_judge?:{predictions_file:string;summary_file:string;thresholds:Variant['thresholds']}};
type RunRow={id:string;kind:string;status:string;created_at:string;completed_at:string|null;
  provider:string;model:string;labeler_digest:string;identity:{params:Record<string,any>}};
const path='.data/dev-corpus/voyage-real/';
void main(async()=>{
  const selection=JSON.parse(await readFile(`${path}gold-selection.json`,'utf8')) as Selection;
  validateSelection(selection);
  const manifest=JSON.parse(await readFile(`${path}eval-run-manifest.json`,'utf8')) as Manifest;
  if(!manifest.variants?.length||new Set(manifest.variants.map(v=>v.variant)).size!==manifest.variants.length)
    throw new Error('mfp_eval_manifest_invalid');
  const identity=await loadMfpEvalIdentity();
  const pool=await openDatabase();
  try {
    const variants:Variant[]=[];
    for(const item of manifest.variants){
      if(!item.run_ids?.length||new Set(item.run_ids).size!==item.run_ids.length||item.variant==='B_judge_jev')throw new Error('mfp_eval_manifest_invalid');
      const runs=(await pool.query(`SELECT r.id,r.kind,r.status,r.created_at,r.completed_at,l.provider,l.model,l.labeler_digest,l.identity
        FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
        WHERE r.workspace_id=$1 AND r.id=ANY($2::uuid[])`,[identity.workspace_id,item.run_ids])).rows as RunRow[];
      if(runs.length!==item.run_ids.length||runs.some(r=>r.status!=='completed')||new Set(runs.map(r=>r.labeler_digest)).size!==1)
        throw new Error('mfp_eval_runs_incomplete_or_mixed');
      const facet=item.variant.includes('_facets_');
      const expectedProvider=item.variant.startsWith('A_')?'anthropic':'typesafe';
      if(runs.some(r=>r.kind!==(facet?'facets':'membership')||r.provider!==expectedProvider||r.model!==(expectedProvider==='anthropic'?'claude-sonnet-5-5':'jev-1.13.0')))
        throw new Error('mfp_eval_variant_identity_mismatch');
      if(item.variant==='A_facets_adaptive_low'&&runs.some(r=>r.identity.params?.thinking?.type!=='adaptive'||r.identity.params?.effort!=='low'))
        throw new Error('mfp_eval_variant_identity_mismatch');
      if(item.variant==='A_facets_between_tools'&&runs.some(r=>r.identity.params?.thinking?.type!=='between_tools'))
        throw new Error('mfp_eval_variant_identity_mismatch');
      if(item.variant==='A_judge_low'&&runs.some(r=>r.identity.params?.effort!=='low')||item.variant==='A_judge_medium'&&runs.some(r=>r.identity.params?.effort!=='medium'))
        throw new Error('mfp_eval_variant_identity_mismatch');
      if(item.variant==='B_facets_jev'){
        if(!item.thresholds||Object.entries(item.thresholds.values).some(([key,value])=>runs.some(r=>r.identity.params?.[key]!==value)))
          throw new Error('mfp_eval_threshold_identity_mismatch');
      }
      const calls=(await pool.query(`SELECT run_id,status,settled_micro_usd::text,reserved_micro_usd::text,created_at,updated_at,
        request,inputs,results,raw_storage_key,raw_sha256,raw_size_bytes::int FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=ANY($2::uuid[]) ORDER BY created_at,id`,
        [identity.workspace_id,item.run_ids])).rows as Array<Omit<LedgerCall,'raw_body'>>;
      const hydratedCalls:LedgerCall[]=calls.map(row=>({...row,raw_body:null}));
      if(item.variant==='B_facets_jev'){
        const storage=createWorkspaceEngineStorageV1();
        await loadJevReceiptBodies(hydratedCalls,call=>readSignalLabelingReceiptV1({storage,workspace_id:identity.workspace_id,
          run_id:call.run_id!,storage_key:call.raw_storage_key!,raw_sha256:call.raw_sha256!,size_bytes:call.raw_size_bytes!}));
      }
      const predictions=facet?facetPredictions(hydratedCalls,item.variant==='B_facets_jev'):
        membershipPredictions(hydratedCalls,new Set(selection.concepts.map(concept=>concept.concept_key)));
      const costs=ledgerCosts(hydratedCalls,new Set(hydratedCalls.flatMap(c=>Array.isArray(c.inputs)?c.inputs.map((r:any)=>r.root_id):[])).size);
      const started=Math.min(...runs.map(r=>Date.parse(r.created_at))),ended=Math.max(...runs.map(r=>Date.parse(r.completed_at??'')));
      costs.wall_ms=Number.isFinite(started)&&Number.isFinite(ended)?ended-started:null;
      variants.push({variant:item.variant,labeler_digest:runs[0].labeler_digest,prediction_rows:predictions,costs,
        ...(item.thresholds?{thresholds:item.thresholds}:{})});
    }
    if(manifest.jev_judge){
      const saved=JSON.parse(await readFile(manifest.jev_judge.predictions_file,'utf8')) as {labeler_digest:string;prediction_rows:Variant['prediction_rows']};
      const summary=JSON.parse(await readFile(manifest.jev_judge.summary_file,'utf8')) as {unknown_calls:number;settled_usd:number|null;selected_roots:number;wall_ms:number};
      if(summary.selected_roots!==150||saved.prediction_rows.length!==150||summary.unknown_calls!==0)throw new Error('mfp_eval_jev_judge_incomplete');
      variants.push({variant:'B_judge_jev',labeler_digest:saved.labeler_digest,prediction_rows:saved.prediction_rows,
        costs:{settled_usd:summary.settled_usd,unknown_calls:summary.unknown_calls,reserved_usd:0,mentions_attempted:150,wall_ms:summary.wall_ms},
        thresholds:manifest.jev_judge.thresholds});
    }
    const bundle:Bundle={contract_version:'mfp-eval-v1',human_gold:{origin:'ai_assisted_founder_reviewed',reviewer_confirmed:true,
      assistant_model:'Claude Opus 5.5 (agente independiente)',reviewed_rows:15,corrected_rows:2},variants};
    validateBundle(bundle,selection,'dev',true);
    await writeFile(`${path}eval-variants.json`,JSON.stringify(bundle),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({stage:'mfp_eval_bundle_exported',variants:variants.map(v=>({variant:v.variant,predictions:v.prediction_rows.length,
      settled_usd:v.costs.settled_usd,unknown_calls:v.costs.unknown_calls,wall_ms:v.costs.wall_ms})),gold_roots:150,text_exported:false}));
  } finally {await pool.end();}
});
