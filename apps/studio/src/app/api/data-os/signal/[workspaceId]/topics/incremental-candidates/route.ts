import {loadSignalWorkspaceContextForTopics,topicError,topicResponse} from '../_lib';
import {loadSignalIncrementalDiscoveryCandidatesV1,signalWorkspaceFeatureEnabledV1} from '@noisia/db';
import {pool} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForTopics(workspaceId);
 if('response' in loaded)return loaded.response;
 try{
  // An optional discovery feature being off does not revoke access to Topics.
  if(!await signalWorkspaceFeatureEnabledV1({queryable:pool,workspace_id:workspaceId,feature:'mfp_discovery'}))return topicResponse({
   contract_version:'signal-incremental-discovery-candidates-v1',workspace_id:workspaceId,candidates:[]
  });
  return topicResponse(await loadSignalIncrementalDiscoveryCandidatesV1({database:pool,workspace_id:workspaceId,actor_user_id:loaded.session.appUser.id}));
 }
 catch(error){return topicError(error,'topic_incremental_candidates_unavailable');}
}
