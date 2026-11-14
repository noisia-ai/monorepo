import {listeningApi} from '@/lib/data-os/signal-listening-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  return listeningApi.metrics((await context.params).workspaceId,request);
}
