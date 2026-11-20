import {z} from 'zod';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';

const save=z.union([
  z.object({expected_revision:z.literal(0),category:z.string().trim().min(1).max(160),lexicon_terms:z.array(z.string().trim().min(1).max(160)).min(1).max(500)}).strict(),
  z.object({expected_revision:z.number().int().nonnegative(),configuration:z.unknown()}).strict(),
]);
const start=z.object({configuration_id:z.string().uuid(),cap_micro_usd:z.number().int().positive().safe(),auto_discovery:z.boolean().optional()}).strict();
const lexicon=z.object({configuration_id:z.string().uuid(),limit:z.coerce.number().int().min(1).max(200).optional()}).strict();
const metrics=z.object({question_key:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),from:z.string().datetime().optional(),
  to:z.string().datetime().optional(),timezone:z.string().max(100).optional(),granularity:z.enum(['day','week','month']).optional(),include_outside:z.enum(['true','false']).transform(value=>value==='true').optional(),topic_key:z.string().max(64).optional()}).strict();
type Scope={workspace_id:string;actor_user_id:string};
export type ListeningApiDependenciesV1={
  load(workspace_id:string):Promise<Scope|{response:Response}>;
  status(scope:Scope):Promise<unknown>;
  save(scope:Scope,args:{expected_revision:number;configuration:SignalListeningConfigurationV1;provenance:'human'}):Promise<unknown>;
  start(scope:Scope,args:{configuration_id:string;cap_micro_usd:number;idempotency_key:string;auto_discovery?:boolean}):Promise<unknown>;
  metrics(scope:Scope,args:z.infer<typeof metrics>):Promise<unknown>;
  lexicon(scope:Scope,args:z.infer<typeof lexicon>):Promise<unknown>;
};
export const signalListeningHeadersV1={'Cache-Control':'private, no-store'};
function response(body:unknown,status=200){return Response.json(body,{status,headers:signalListeningHeadersV1});}
function errorResponse(error:unknown){
  if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof Error&&error.message==='listening_configuration_invalid'))
    return response({error:'listening_request_invalid'},422);
  if(error instanceof Error&&'code'in error&&typeof error.code==='string'){
    const status='status'in error&&typeof error.status==='number'?error.status:409;
    return response({error:error.code},[403,404,409,422,503].includes(status)?status:409);
  }
  return response({error:'listening_unavailable'},503);
}
/** Session scope is loaded before parsing user input. No actor, admission, map,
 * provenance or provider configuration from the browser reaches a paid owner. */
export function createSignalListeningApiV1(deps:ListeningApiDependenciesV1){
  async function scoped(workspace_id:string,fn:(scope:Scope)=>Promise<Response>){
    const loaded=await deps.load(workspace_id);if('response'in loaded)return loaded.response;
    try{return await fn(loaded);}catch(error){return errorResponse(error);}
  }
  return {
    get:(workspace_id:string)=>scoped(workspace_id,async scope=>response(await deps.status(scope))),
    put:(workspace_id:string,request:Request)=>scoped(workspace_id,async scope=>{
      const body=save.parse(await request.json());
      const configuration='category'in body?signalListeningBaseTemplateV1(body)
        :validateSignalListeningConfigurationV1(body.configuration);
      return response(await deps.save(scope,{expected_revision:body.expected_revision,configuration,provenance:'human'}));
    }),
    post:(workspace_id:string,request:Request)=>scoped(workspace_id,async scope=>{
      const body=start.parse(await request.json()),key=request.headers.get('Idempotency-Key')?.trim()??'';
      if(key.length<8||key.length>200)return response({error:'listening_idempotency_required'},422);
      return response(await deps.start(scope,{...body,idempotency_key:key}),202);
    }),
    metrics:(workspace_id:string,request:Request)=>scoped(workspace_id,async scope=>{
      const search=new URL(request.url).searchParams;
      if([...new Set(search.keys())].some(key=>search.getAll(key).length!==1))return response({error:'listening_request_invalid'},422);
      return response(await deps.metrics(scope,metrics.parse(Object.fromEntries(search))));
    }),
    lexicon:(workspace_id:string,request:Request)=>scoped(workspace_id,async scope=>{
      const search=new URL(request.url).searchParams;
      if([...new Set(search.keys())].some(key=>search.getAll(key).length!==1))return response({error:'listening_request_invalid'},422);
      return response(await deps.lexicon(scope,lexicon.parse(Object.fromEntries(search))));
    }),
  };
}
