import {loadSignalWorkspaceContextForListening} from '@/lib/data-os/signal-listening-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await context.params,loaded=await loadSignalWorkspaceContextForListening(workspaceId);
  if(loaded.response)return loaded.response;return loaded.api.lexicon(workspaceId,request);
}
