import {loadHybridMembershipRouteV1,configureHybridMembershipRouteV1} from '@noisia/db';
import {pool} from '@/lib/db';
type Access={workspace_id:string;actor_user_id:string};
export function loadMembershipConfigurationForActorV1(args:Access){return loadHybridMembershipRouteV1({...args,database:pool});}
export function configureMembershipForActorV1(args:Access&{route:'standard'|'hybrid_h1';expected_route_digest:string|null;confirm_unresolved_jev?:boolean}){
 return configureHybridMembershipRouteV1({...args,database:pool,provider_available:['NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED','NOISIA_JEV_PROVIDER_ENABLED',
  'NOISIA_MFP_HYBRID_ENABLED','NOISIA_MFP_HYBRID_LEDGER_READY'].every(key=>process.env[key]==='true')});
}
