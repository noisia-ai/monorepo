import type {Pool} from 'pg';
import {provisionSignalBrandContextPolicyV1} from './signal-brand-context-policy-provisioning';

/** Explicit existing-brand completion seam; authority comes from the authenticated actor. */
export async function completeSignalClassicPolicyV1(args:{database:Pick<Pool,'connect'>;workspace_id:string;
  brand_id:string;actor_user_id:string;env?:Record<string,string|undefined>}){
  return provisionSignalBrandContextPolicyV1({...args,initiator_user_id:args.actor_user_id});
}
