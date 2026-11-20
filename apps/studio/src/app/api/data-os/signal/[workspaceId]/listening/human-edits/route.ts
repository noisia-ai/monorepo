import {loadSignalWorkspaceContextForListeningHumanV1} from '@/lib/data-os/signal-listening-human-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(_request:Request,context:Context){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForListeningHumanV1(workspaceId);
 if(loaded.response)return loaded.response;return loaded.api.get(workspaceId);
}
export async function POST(request:Request,context:Context){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForListeningHumanV1(workspaceId);
 if(loaded.response)return loaded.response;return loaded.api.post(workspaceId,request);
}
