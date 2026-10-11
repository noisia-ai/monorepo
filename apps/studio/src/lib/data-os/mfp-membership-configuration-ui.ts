export type MembershipRoute='standard'|'hybrid_h1';
export type MembershipConfiguration={route:MembershipRoute;route_digest:string|null;can_configure:boolean;unknown_calls:number;reserved_exposure_micro_usd:string};
export function parseMembershipConfiguration(value:unknown):MembershipConfiguration|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 return (v.route==='standard'||v.route==='hybrid_h1')&&(v.route_digest===null||typeof v.route_digest==='string')
  &&typeof v.can_configure==='boolean'&&Number.isSafeInteger(v.unknown_calls)&&Number(v.unknown_calls)>=0
  &&typeof v.reserved_exposure_micro_usd==='string'&&/^\d+$/.test(v.reserved_exposure_micro_usd)?v as MembershipConfiguration:null;
}
export function membershipRouteNeedsConfirmation(current:MembershipConfiguration,next:MembershipRoute){
 return current.route==='hybrid_h1'&&next==='standard'&&current.unknown_calls>0;
}
