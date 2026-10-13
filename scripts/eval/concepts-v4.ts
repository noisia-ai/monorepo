import { confirmedConceptsV3, type ConceptV3 } from './concepts-v3';
export const COBROS_KEY_V4='cobros_depositos_devoluciones';
export function confirmedConceptsV4(proposal:{version:number;status:string;concepts:ConceptV3[]}) {
  if(proposal.version!==4||proposal.status!=='confirmed_founder_audit_16_4_1')throw new Error('mfp_v4_version_invalid');
  return confirmedConceptsV3(proposal);
}
