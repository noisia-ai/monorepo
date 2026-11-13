import {loadWorkspaceMonitoringInsightsV1,requestWorkspaceMonitoringInsightsV1,MonitoringInsightsError} from '@noisia/db';
import {pool} from '@/lib/db';
import {canManageCorpus} from '@/lib/auth/roles';
import {loadSignalWorkspaceContextForTopics,requireIdempotencyKey} from '../../topics/_lib';
import {monitoringInsightContextV1,monitoringInsightBodyV1,monitoringInsightHeadersV1,monitoringInsightErrorV1} from '@/lib/data-os/workspace-monitoring-insights';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const loaded=await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
 if('response' in loaded)return loaded.response;
 try{return Response.json(await loadWorkspaceMonitoringInsightsV1({database:pool,workspace_id:loaded.workspace.id,
  actor_user_id:loaded.session.appUser.id,...monitoringInsightContextV1(request)}),{headers:monitoringInsightHeadersV1});}
 catch(error){return monitoringInsightErrorV1(error);}
}
export async function POST(request:Request,context:Context){
 const loaded=await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
 if('response' in loaded)return loaded.response;
 try{
  if(!canManageCorpus(loaded.session.appUser.primaryRole))throw new MonitoringInsightsError('monitoring_insights_forbidden',403);
  const key=requireIdempotencyKey(request);
  if(!key)throw new MonitoringInsightsError('monitoring_insights_idempotency_key_required',422);
  if(Number(request.headers.get('content-length')??0)>4096)throw new MonitoringInsightsError('monitoring_insights_request_invalid',422);
  let body:unknown;try{const raw=await request.text();if(raw.length>4096)throw Error();body=JSON.parse(raw);}catch{throw new MonitoringInsightsError('monitoring_insights_request_invalid',422);}
  if(!monitoringInsightBodyV1(body))throw new MonitoringInsightsError('monitoring_insights_request_invalid',422);
  const access={database:pool,workspace_id:loaded.workspace.id,actor_user_id:loaded.session.appUser.id,...monitoringInsightContextV1(request)};
  await requestWorkspaceMonitoringInsightsV1({...access,...body,idempotency_key:key});
  // The owner itself is the durable dispatch source. A failed/lost queue write
  // cannot leave an admitted run unreachable by the native worker drainer.
  return Response.json(await loadWorkspaceMonitoringInsightsV1(access),{status:202,headers:monitoringInsightHeadersV1});
 }catch(error){return monitoringInsightErrorV1(error);}
}
