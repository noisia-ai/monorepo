import {loadSignalWorkspaceContextForStudyV1} from '@/lib/data-os/signal-study-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{workspaceId:string;studyId:string}>};
export async function GET(request:Request,context:Context){
 const {workspaceId,studyId}=await context.params,loaded=await loadSignalWorkspaceContextForStudyV1(workspaceId);
 if(loaded.response)return loaded.response;return loaded.api.detail(workspaceId,studyId,request);
}
export async function POST(request:Request,context:Context){
 const {workspaceId,studyId}=await context.params,loaded=await loadSignalWorkspaceContextForStudyV1(workspaceId);
 if(loaded.response)return loaded.response;return loaded.api.mutate(workspaceId,studyId,request);
}
