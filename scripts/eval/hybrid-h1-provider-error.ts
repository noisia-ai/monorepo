const types=new Set(['error','invalid_request_error','authentication_error','permission_error','not_found_error','request_too_large','rate_limit_error','api_error','overloaded_error']);
const codes=new Set(['invalid_request','invalid_parameter','invalid_model','request_too_large','credit_balance_insufficient']);
const fields=new Set(['requests','params','model','max_tokens','messages','content','role','thinking','budget_tokens','output_config','format','schema','type','system','cache_control','ttl','effort','stream','speed']);
const safePath=(value:unknown):string|null=>{
 if(typeof value!=='string'||value.length>240)return null;
 const normalized=value.replace(/\[(\d+)\]/gu,'.$1'),parts=normalized.split('.');
 if(parts[0]!=='requests'||!/^\d+$/u.test(parts[1]??''))return null;
 return parts.every(p=>fields.has(p)||/^\d+$/u.test(p)&&Number(p)<100000)?normalized:null;
};

/** Error bodies are transient data. Persist only this allowlist, never free messages or request IDs. */
export function sanitizeHybridProviderErrorV1(raw:string){
 let value:Record<string,unknown>={};
 try{const parsed:unknown=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))value=parsed as Record<string,unknown>;}catch{/* No raw excerpt on invalid JSON. */}
 const error=value.error&&typeof value.error==='object'&&!Array.isArray(value.error)?value.error as Record<string,unknown>:{};
 const type=typeof value.type==='string'&&types.has(value.type)?value.type:null;
 const error_type=typeof error.type==='string'&&types.has(error.type)?error.type:null;
 let code=typeof error.code==='string'&&codes.has(error.code)?error.code:null;
 const message=typeof error.message==='string'?error.message:'';
 if(/^Your credit balance is too low to access the Anthropic API\./u.test(message))code='credit_balance_insufficient';
 const found=message.match(/\brequests(?:\.\d+|\[\d+\])(?:\.[a-z_]+|\.\d+|\[\d+\])*/u)?.[0];
 const param=safePath(error.param)??safePath(found);
 const index=param?Number(param.split('.')[1]):Number.isSafeInteger(error.index)&&Number(error.index)>=0&&Number(error.index)<100000?Number(error.index):null;
 return {type,error_type,code,param,index};
}
