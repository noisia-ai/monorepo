import {listeningApi} from '@/lib/data-os/signal-listening-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(_request:Request,context:Context){return listeningApi.get((await context.params).workspaceId);}
export async function PUT(request:Request,context:Context){return listeningApi.put((await context.params).workspaceId,request);}
export async function POST(request:Request,context:Context){return listeningApi.post((await context.params).workspaceId,request);}
