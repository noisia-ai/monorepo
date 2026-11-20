import {loadSignalWorkspaceContextForListening} from '@/lib/data-os/signal-listening-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(_request:Request,context:Context){
  const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForListening(workspaceId);
  if(loaded.response)return loaded.response;return loaded.api.get(workspaceId);
}
export async function PUT(request:Request,context:Context){
  const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForListening(workspaceId);
  if(loaded.response)return loaded.response;return loaded.api.put(workspaceId,request);
}
export async function POST(request:Request,context:Context){
  const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForListening(workspaceId);
  if(loaded.response)return loaded.response;return loaded.api.post(workspaceId,request);
}
