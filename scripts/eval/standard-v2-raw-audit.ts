/** Read-only receipt replay isolates parser provenance without making provider requests. */
import {readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {parseMembershipGroupV2,normalizeMembershipRationaleV2,parseMembershipGroupV1,parseAnthropicResponseV1,signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {createWorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
import {readSignalLabelingReceiptV1} from '../../services/workers/src/workers/signal-labeling-receipt-storage';
export async function replayStandardV2Raw(pool:any,workspace_id:string,run_id:string){
 const storage=createWorkspaceEngineStorageV1();
 const calls=(await pool.query(`SELECT id,run_id,status,results_applied,inputs,results,raw_sha256,raw_storage_key,raw_size_bytes::int,created_at::text,updated_at::text FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at,id`,[run_id])).rows;
 const items:any[]=[],reparsed=new Map<string,unknown>();
 for(let offset=0;offset<calls.length;offset+=4)await Promise.all(calls.slice(offset,offset+4).filter((call:any)=>call.raw_storage_key).map(async(call:any)=>{
  const raw=JSON.parse(await readSignalLabelingReceiptV1({storage,workspace_id,run_id:call.run_id,storage_key:call.raw_storage_key,raw_sha256:call.raw_sha256,size_bytes:call.raw_size_bytes}));
  if(raw.result.type!=='succeeded'){items.push({call_id:call.id,raw_sha256:call.raw_sha256,classification:'provider_not_succeeded'});return;}
  const response=parseAnthropicResponseV1(raw.result.message);if(response.status!=='ok'){items.push({call_id:call.id,raw_sha256:call.raw_sha256,classification:response.status});return;}
  const normalization=normalizeMembershipRationaleV2(response.text!);
  const current=parseMembershipGroupV2(response.text!,call.inputs),legacy=parseMembershipGroupV1(response.text!,call.inputs);
  const stored=digest(call.results??[]),v2=digest(current.results),v1=digest(legacy.results);
  reparsed.set(call.id,current.results);
  items.push({call_id:call.id,created_at:call.created_at,updated_at:call.updated_at,raw_sha256:call.raw_sha256,stored_results_digest:stored,v2_results_digest:v2,legacy_results_digest:v1,
   rationale_normalizations:normalization.normalizations,classification:stored===v2?'matches_v2':stored===v1?'matches_legacy':'other_difference',v2_retry_ordinals:current.retry_ordinals??[],v2_split:current.split});
 }));
 const serving=(await pool.query('SELECT count(*)::int n FROM signal_concept_memberships WHERE run_id=$1',[run_id])).rows[0].n;
 return {report:{run_id,read_only:true,provider_calls:0,raw_calls:items.length,serving_writes:serving,items:items.sort((a,b)=>a.call_id.localeCompare(b.call_id)),worker_process_attribution:'Unavailable in original ledger; timestamps and parser-result digests are retained, without claiming a process actor.',at:new Date().toISOString()},reparsed};
}
if(process.argv[1]?.endsWith('/scripts/eval/standard-v2-raw-audit.ts'))void main(async()=>{
 const directory='.data/dev-corpus/voyage-real/standard-v2-r11',manifest=JSON.parse(await readFile(`${directory}/run-manifest.json`,'utf8')),identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 try{const {report}=await replayStandardV2Raw(pool,identity.workspace_id,manifest.run_id).catch(error=>{console.error(JSON.stringify({stage:'raw_audit_error',code:typeof error?.message==='string'&&/^[a-z_]+$/.test(error.message)?error.message:'sanitized'}));throw error;});await writeFile(`${directory}/raw-audit.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({stage:'standard_v2_raw_audit',raw_calls:report.raw_calls,serving_writes:report.serving_writes,provider_calls:0,classifications:Object.fromEntries([...new Set(report.items.map(i=>i.classification))].map(key=>[key,report.items.filter(i=>i.classification===key).length]))}));}finally{await pool.end();}
});
