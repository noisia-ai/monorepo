import {z} from 'zod';
import type {SignalListeningHumanExpectedV1} from '@noisia/db';
const uuid=z.string().uuid(),sha=z.string().regex(/^sha256:[a-f0-9]{64}$/u),key=z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const expected=z.object({base_snapshot_id:uuid,configuration_id:uuid,configuration_digest:sha,source_generation_id:uuid,source_generation_digest:sha,
 map_id:uuid,source_digest:sha,policy_version_id:uuid,policy_digest:sha,human_revision_digest:sha,edit_revision:z.number().int().nonnegative().safe(),previous_edit_id:uuid.nullable()}).strict();
const membership=z.object({operation:z.literal('membership'),expected,root_id:uuid,from_question_key:key,to_question_key:key.nullable().optional()}).strict();
const merge=z.object({operation:z.literal('merge'),expected,source_question_keys:z.array(key).min(2).max(256),target_question_key:key}).strict();
const mutation=z.discriminatedUnion('operation',[membership,merge]);
type Scope={workspace_id:string;actor_user_id:string};
export type SignalListeningHumanApiDependenciesV1={
 load(workspace_id:string):Promise<Scope|{response:Response}>;
 context(scope:Scope):Promise<unknown>;
 membership(scope:Scope,args:{expected:SignalListeningHumanExpectedV1;root_id:string;from_question_key:string;to_question_key?:string|null;idempotency_key:string}):Promise<unknown>;
 merge(scope:Scope,args:{expected:SignalListeningHumanExpectedV1;source_question_keys:string[];target_question_key:string;idempotency_key:string}):Promise<unknown>;
};
const headers={'Cache-Control':'private, no-store'};
const respond=(body:unknown,status=200)=>Response.json(body,{status,headers});
function errorResponse(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError)return respond({error:'listening_human_request_invalid'},422);
 if(error instanceof Error&&'code'in error&&typeof error.code==='string'){
  const status='status'in error&&typeof error.status==='number'?error.status:409;
  return respond({error:error.code},[403,404,409,422,503].includes(status)?status:409);
 }
 return respond({error:'listening_human_unavailable'},503);
}
/** Snapshot fields are compare-and-swap expectations, never authority. Native
 * stores recheck the current snapshot and edit capability in their transaction.
 * No provider or processing-admission operation belongs to this controller. */
export function createSignalListeningHumanApiV1(deps:SignalListeningHumanApiDependenciesV1){
 async function scoped(workspace_id:string,fn:(scope:Scope)=>Promise<Response>){
  const loaded=await deps.load(workspace_id);if('response'in loaded)return loaded.response;
  try{return await fn(loaded);}catch(error){return errorResponse(error);}
 }
 return{
  get:(workspace_id:string)=>scoped(workspace_id,async scope=>respond(await deps.context(scope))),
  post:(workspace_id:string,request:Request)=>scoped(workspace_id,async scope=>{
   const body=mutation.parse(await request.json()),idempotency_key=request.headers.get('Idempotency-Key')?.trim()??'';
   if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(idempotency_key))return respond({error:'listening_human_idempotency_required'},422);
   if(body.operation==='membership'){
    return respond(await deps.membership(scope,{expected:body.expected,root_id:body.root_id,from_question_key:body.from_question_key,
     ...(body.to_question_key!==undefined?{to_question_key:body.to_question_key}:{}),idempotency_key}));
   }
   const args={expected:body.expected,source_question_keys:body.source_question_keys,target_question_key:body.target_question_key};
   if(new Set(args.source_question_keys).size!==args.source_question_keys.length||!args.source_question_keys.includes(args.target_question_key))return respond({error:'listening_human_request_invalid'},422);
   return respond(await deps.merge(scope,{...args,idempotency_key}));
  }),
 };
}
