import {z} from 'zod';
import {loadSignalWorkspaceContextForTopics} from '../../topics/_lib';
import {loadMembershipConfigurationForActorV1,configureMembershipForActorV1} from '@/lib/data-os/mfp-membership-configuration';
import {SignalLabelingError} from '@noisia/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const schema=z.object({route:z.enum(['standard','hybrid_h1']),expected_route_digest:z.string().nullable(),confirm_unresolved_jev:z.boolean().optional()}).strict();
type Context={params:Promise<{workspaceId:string}>};
function errorResponse(error:unknown){
 return Response.json({error:error instanceof SignalLabelingError?error.code:'membership_configuration_unavailable'},
  {status:error instanceof SignalLabelingError?error.status:503,headers});
}
export async function GET(_request:Request,context:Context){
 const loaded=await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
 if('response' in loaded)return loaded.response;
 try{return Response.json(await loadMembershipConfigurationForActorV1({workspace_id:loaded.workspace.id,actor_user_id:loaded.session.appUser.id}),{headers});}
 catch(error){return errorResponse(error);}
}
export async function PATCH(request:Request,context:Context){
 const loaded=await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
 if('response' in loaded)return loaded.response;
 const body=schema.safeParse(await request.json().catch(()=>null));
 if(!body.success)return Response.json({error:'membership_configuration_invalid'},{status:400,headers});
 try{return Response.json(await configureMembershipForActorV1({workspace_id:loaded.workspace.id,actor_user_id:loaded.session.appUser.id,...body.data}),{headers});}
 catch(error){return errorResponse(error);}
}
