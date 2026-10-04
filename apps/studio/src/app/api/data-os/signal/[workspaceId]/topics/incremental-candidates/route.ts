import {loadSignalWorkspaceContextForTopics,topicError,topicResponse} from '../_lib';
import {loadSignalIncrementalDiscoveryCandidatesV1} from '@noisia/db';
import {pool} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForTopics(workspaceId);
 if('response' in loaded)return loaded.response;
 if(process.env.NOISIA_MENTION_FACETS_ENABLED!=='true')return topicResponse({error:'not_found'},404);
 try{return topicResponse(await loadSignalIncrementalDiscoveryCandidatesV1({database:pool,workspace_id:workspaceId,actor_user_id:loaded.session.appUser.id}));}
 catch(error){return topicError(error,'topic_incremental_candidates_unavailable');}
}
