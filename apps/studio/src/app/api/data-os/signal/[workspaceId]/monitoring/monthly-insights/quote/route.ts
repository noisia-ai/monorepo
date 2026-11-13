import {quoteWorkspaceMonitoringInsightsV1,MonitoringInsightsError} from '@noisia/db';
import {pool} from '@/lib/db';
import {canManageCorpus} from '@/lib/auth/roles';
import {loadSignalWorkspaceContextForTopics} from '../../../topics/_lib';
import {monitoringInsightContextV1,monitoringInsightHeadersV1,monitoringInsightErrorV1} from '@/lib/data-os/workspace-monitoring-insights';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const loaded=await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
 if('response' in loaded)return loaded.response;
 try{
  if(!canManageCorpus(loaded.session.appUser.primaryRole))throw new MonitoringInsightsError('monitoring_insights_forbidden',403);
  return Response.json(await quoteWorkspaceMonitoringInsightsV1({database:pool,workspace_id:loaded.workspace.id,
   actor_user_id:loaded.session.appUser.id,budget_cap_micro_usd:2000000,...monitoringInsightContextV1(request)}),{headers:monitoringInsightHeadersV1});
 }catch(error){return monitoringInsightErrorV1(error);}
}
