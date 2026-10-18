import {z} from 'zod';
import {completeSignalClassicPolicyV1} from '@noisia/db';
import {pool} from '@/lib/db';
import {loadSignalWorkspaceContextForTopics} from '../../topics/_lib';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const bodySchema=z.object({}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const loaded=await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
 if('response' in loaded)return loaded.response;
 if(!bodySchema.safeParse(await request.json().catch(()=>null)).success)
  return Response.json({error:'classic_policy_completion_invalid'},{status:400,headers});
 if(loaded.workspace.subject.type!=='brand')return Response.json({error:'classic_policy_completion_forbidden'},{status:403,headers});
 try{
  const result=await completeSignalClassicPolicyV1({database:pool,workspace_id:loaded.workspace.id,
   brand_id:loaded.workspace.subject.id,actor_user_id:loaded.session.appUser.id});
  if(result.status==='not_eligible')return Response.json({error:'classic_policy_completion_forbidden'},{status:403,headers});
  return Response.json(result,{headers});
 }catch{return Response.json({error:'classic_policy_completion_unavailable'},{status:503,headers});}
}
