export type MembershipRoute='standard'|'hybrid_h1';
export type MembershipConfiguration={route:MembershipRoute;route_digest:string|null;can_configure:boolean;unknown_calls:number;released_calls?:number;released_pairs?:number;released_exposure_micro_usd?:string;reserved_exposure_micro_usd:string};
export function parseMembershipConfiguration(value:unknown):MembershipConfiguration|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 return (v.route==='standard'||v.route==='hybrid_h1')&&(v.route_digest===null||typeof v.route_digest==='string')
  &&typeof v.can_configure==='boolean'&&Number.isSafeInteger(v.unknown_calls)&&Number(v.unknown_calls)>=0
  &&(v.released_calls===undefined||Number.isSafeInteger(v.released_calls)&&Number(v.released_calls)>=0)
  &&(v.released_pairs===undefined||Number.isSafeInteger(v.released_pairs)&&Number(v.released_pairs)>=0)
  &&(v.released_exposure_micro_usd===undefined||typeof v.released_exposure_micro_usd==='string'&&/^\d+$/.test(v.released_exposure_micro_usd))
  &&typeof v.reserved_exposure_micro_usd==='string'&&/^\d+$/.test(v.reserved_exposure_micro_usd)?v as MembershipConfiguration:null;
}
export function membershipRouteNeedsConfirmation(current:MembershipConfiguration,next:MembershipRoute){
 return current.route==='hybrid_h1'&&next==='standard'&&current.unknown_calls>0;
}
