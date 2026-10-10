import type {MfpRun} from "./mfp-ui";

export type MfpIntent={method:string;body:Record<string,unknown>};
/** UI provenance is fixed; assisted scripts must use the explicit API contract. */
export function mfpHumanMembershipCorrection(rootIds:string[],conceptKey:string,verdict:'belongs'|'not_belongs') {
  return {overrides:rootIds.map(root_id=>({root_id,concept_key:conceptKey,verdict,decided_via:'human_ui' as const}))};
}
/** Snapshot the submitted definition, including nested arrays, before the editor changes. */
export function mfpIntent(body:Record<string,unknown>,method:string,key:string):MfpIntent {
  return {method,body:JSON.parse(JSON.stringify(method==="POST"&&!body.confirm_run_id?{...body,idempotency_key:key}:body))};
}
export async function executeMfpIntent(endpoint:string,intent:MfpIntent,transport:typeof fetch=fetch) {
  const response=await transport(endpoint,{method:intent.method,headers:{"Content-Type":"application/json"},body:JSON.stringify(intent.body)});
  return {response,result:await response.json().catch(()=>null),submitted:intent.body};
}
export type MfpQuerySelection={query:string;ids:string[]};
export function mfpSelectionTransition(state:MfpQuerySelection,query:string,ids?:string[]):MfpQuerySelection {
  return {query,ids:ids??(state.query===query?state.ids:[])};
}
/** The server may supersede an unstarted request only after checking the live context. */
export function mfpContextRecovery(run:MfpRun|null|undefined):{full_recalculation:true}|null {
  return run?.status==="queued"&&run.waiting_full_confirmation?{full_recalculation:true}:null;
}
