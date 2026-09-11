import {signalBrandOsCanonicalSnapshotHashV1} from './signal-brand-os-snapshot';
export function brandContextSnapshotFixtureV1(organizationId:string,countries:string[]=['MX']){
 const snapshot={name:'Synthetic',description:null,organization_id:organizationId,industry:null,industry_sub:null,countries,aliases:[],competitors:[],knowledge_count:0};
 return{snapshot,digest:signalBrandOsCanonicalSnapshotHashV1(snapshot)};
}
