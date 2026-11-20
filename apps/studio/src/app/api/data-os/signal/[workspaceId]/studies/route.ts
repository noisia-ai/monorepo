import {loadSignalWorkspaceContextForStudyV1} from '@/lib/data-os/signal-study-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForStudyV1(workspaceId);
 if(loaded.response)return loaded.response;return loaded.api.list(workspaceId,request);
}
export async function POST(request:Request,context:Context){
 const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForStudyV1(workspaceId);
 if(loaded.response)return loaded.response;return loaded.api.create(workspaceId,request);
}
