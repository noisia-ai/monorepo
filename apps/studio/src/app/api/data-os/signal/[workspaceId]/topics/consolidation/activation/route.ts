import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from '../../_lib';
import { loadWorkspaceTopicConsolidationActivationV1, mutateWorkspaceTopicConsolidationActivationV1,
 prepareWorkspaceTopicConsolidationActivationV1 } from '@/lib/data-os/signal-topic-consolidation-activation-control';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForTopics(workspaceId);
 if('response' in loaded)return loaded.response;
 try{return topicResponse(await loadWorkspaceTopicConsolidationActivationV1({workspaceId,actorUserId:loaded.session.appUser.id}));}
 catch(error){return topicError(error,'topic_consolidation_activation_unavailable');}
}
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForTopics(workspaceId);
 if('response' in loaded)return loaded.response;
 const idempotency_key=requireIdempotencyKey(request);
 if(!idempotency_key)return topicResponse({error:'idempotency_key_required'},400);
 try{
  const body:unknown=await request.json(),scope={workspaceId,actorUserId:loaded.session.appUser.id};
  if(body&&typeof body==='object'&&!Array.isArray(body)&&'action' in body&&body.action==='prepare'){
   if(Object.keys(body).sort().join(',')!=='action,revision_digest,revision_id'||!('revision_id' in body)||typeof body.revision_id!=='string'
    ||!('revision_digest' in body)||typeof body.revision_digest!=='string')return topicResponse({error:'topic_consolidation_activation_request_invalid'},422);
   return topicResponse(await prepareWorkspaceTopicConsolidationActivationV1({...scope,revisionId:body.revision_id,revisionDigest:body.revision_digest}));
  }
  return topicResponse(await mutateWorkspaceTopicConsolidationActivationV1({...scope,idempotencyKey:idempotency_key,command:body}));
 }catch(error){return topicError(error,'topic_consolidation_activation_rejected');}
}
