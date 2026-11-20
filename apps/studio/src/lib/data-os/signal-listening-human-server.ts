import {getSignalListeningHumanEditContextV1,correctSignalListeningTopicMembershipV1,mergeSignalListeningTopicsV1} from '@noisia/db';
import {loadSignalWorkspaceContextForTopics} from '@/app/api/data-os/signal/[workspaceId]/topics/_lib';
import {pool} from '@/lib/db';
import {createSignalListeningHumanApiV1} from './signal-listening-human-api';

export async function loadSignalWorkspaceContextForListeningHumanV1(workspace_id:string){
 const loaded=await loadSignalWorkspaceContextForTopics(workspace_id);
 if(loaded.response)return{response:loaded.response};
 if(process.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true')return{response:Response.json({error:'listening_not_enabled'},
  {status:404,headers:{'Cache-Control':'private, no-store'}})};
 const scope={workspace_id:loaded.workspace.id,actor_user_id:loaded.session.appUser.id};
 return{api:createSignalListeningHumanApiV1({
  load:async requested=>requested===scope.workspace_id?scope:{response:Response.json({error:'listening_forbidden'},{status:403})},
  context:scope=>getSignalListeningHumanEditContextV1({database:pool,...scope}),
  membership:(scope,args)=>correctSignalListeningTopicMembershipV1({database:pool,...scope,...args}),
  merge:(scope,args)=>mergeSignalListeningTopicsV1({database:pool,...scope,...args}),
 })};
}
