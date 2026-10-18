/** Examine shape errors only, preserving private raw and semantic values. */
import {readFile,writeFile} from 'node:fs/promises';
import {z} from '../../packages/query-engine/node_modules/zod';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {parseAnthropicResponseV1} from '../../packages/query-engine/src/index';
import {createWorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
import {readSignalLabelingReceiptV1} from '../../services/workers/src/workers/signal-labeling-receipt-storage';
const schema=z.object({root_ordinal:z.number().int().nonnegative(),memberships:z.array(z.object({concept_key:z.string(),verdict:z.enum(['belongs','not_belongs','insufficient']),span_ids:z.array(z.string()).min(1).max(128),rationale:z.string().trim().min(1).refine(v=>v.split(/\s+/u).length<=30)}).strict())}).strict();
void main(async()=>{
 const directory='.data/dev-corpus/voyage-real/standard-v2-r11',identity=await loadMfpEvalIdentity(),manifest=JSON.parse(await readFile(`${directory}/run-manifest.json`,'utf8')),pool=await openDatabase();
 try{
  const calls=(await pool.query(`SELECT id,run_id,inputs,results,raw_sha256,raw_storage_key,raw_size_bytes::int FROM signal_labeling_calls WHERE run_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'error_code'='membership_item_schema_invalid') ORDER BY created_at,id`,[manifest.run_id])).rows;
  const storage=createWorkspaceEngineStorageV1(),items:any[]=[];
  const gold=(await readFile('.data/dev-corpus/voyage-real/gold.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
  for(const call of calls){
   const raw=JSON.parse(await readSignalLabelingReceiptV1({storage,workspace_id:identity.workspace_id,run_id:call.run_id,storage_key:call.raw_storage_key,raw_sha256:call.raw_sha256,size_bytes:call.raw_size_bytes}));
   if(raw.result.type!=='succeeded')throw new Error('mfp_schema_raw_not_succeeded');
   const response=parseAnthropicResponseV1(raw.result.message);if(response.status!=='ok')throw new Error('mfp_schema_raw_not_text');
   const value=JSON.parse(response.text!);
   const roots=Array.isArray(value.roots)?value.roots:Object.entries(value.roots).map(([key,item])=>({...item as object,root_ordinal:Number(key.slice(1))}));
   for(const root of roots){const parsed=schema.safeParse(root);if(parsed.success)continue;
    const input=call.inputs[root.root_ordinal],errorPairs=call.results.filter((r:any)=>r.root_id===input.root_id&&r.verdict==='error');
    const goldRow=gold.find((r:any)=>r.root_id===input.root_id);
    items.push({call_id:call.id,root_id:input.root_id,raw_sha256:call.raw_sha256,issues:parsed.error.issues.map(issue=>({path:issue.path,code:issue.code,message:issue.message})),
     members:root.memberships.map((member:any)=>({concept_key:member.concept_key,verdict:member.verdict,span_ids_count:member.span_ids?.length,rationale_words:typeof member.rationale==='string'?member.rationale.trim().split(/\s+/u).length:null})),
     error_pairs:errorPairs.map((r:any)=>r.concept_key),gold:goldRow?{partition:goldRow.partition,memberships:goldRow.memberships}:null});
   }
  }
  const receipt={stage:'standard_v2_schema_diagnosis',root_count:new Set(items.map(item=>item.root_id)).size,pair_count:items.reduce((n,item)=>n+item.error_pairs.length,0),items,provider_calls:0,at:new Date().toISOString()};
  await writeFile(`${directory}/schema-errors.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({...receipt,items:items.map(({root_id:_root,gold,call_id,issues,members,error_pairs})=>({call_id,issues,members,error_pairs: error_pairs.length,gold}))}));
 }finally{await pool.end();}
});
