import {createSignalTopicInputSchemaV1,type SignalTopicScopeV1} from '../../packages/query-engine/src/signal-topic-catalog-v1';
export const V3_KEYS=['cobros_depositos_devoluciones','atencion_reclamaciones',
  'integracion_de_renta_de_autos_en_plataformas_de_viaje','programa_emerald_aisle_y_beneficios_de_estatus_elite'] as const;
export type ConceptV3={concept_key:string;label:string;definition:string;scope?:SignalTopicScopeV1;
  inclusions:string[];exclusions:string[];examples_positive:string[];examples_negative:string[]};
export function confirmedConceptsV3(proposal:{concepts:ConceptV3[]}){
  if(!Array.isArray(proposal.concepts)||proposal.concepts.length!==4||
    V3_KEYS.some(key=>proposal.concepts.filter(item=>item.concept_key===key).length!==1))
    throw new Error('mfp_v3_selection_mismatch');
  const concepts=V3_KEYS.map(key=>proposal.concepts.find(item=>item.concept_key===key)!);
  concepts.forEach(item=>conceptInputV3(item,'all_conversations'));
  return concepts;
}
export function conceptInputV3(item:ConceptV3,existingScope:SignalTopicScopeV1){
  return createSignalTopicInputSchemaV1.parse({label:item.label,definition:item.definition,scope:item.scope??existingScope,
    inclusion:item.inclusions,exclusion:item.exclusions,positive_examples:item.examples_positive,negative_examples:item.examples_negative});
}
export function unchangedConceptV3(current:Record<string,unknown>,input:Record<string,unknown>){
  return Object.keys(input).every(key=>JSON.stringify(current[key])===JSON.stringify(input[key]));
}
type CatalogItem={term_key:string;origin:string;source:unknown;[key:string]:unknown};
export function catalogDefinitionV3(item:CatalogItem){
  const {taxonomy_term_id:_term,status:_status,counts:_counts,...definition}=item;
  return definition;
}
export function assertCatalogPreservedV3(before:CatalogItem[],after:CatalogItem[],keys:string[],manualEquivalents:boolean){
  if(after.length!==before.length+keys.filter(key=>!before.some(item=>item.term_key===key)).length)
    throw new Error('mfp_v3_catalog_count_changed');
  for(const old of before){
    const current=after.find(item=>item.term_key===old.term_key);
    if(!current||!keys.includes(old.term_key)&&JSON.stringify(catalogDefinitionV3(current))!==JSON.stringify(catalogDefinitionV3(old)))
      throw new Error('mfp_v3_unrelated_catalog_changed');
    if(keys.includes(old.term_key)&&(['origin','source','discovery_guidance'].some(key=>JSON.stringify(current[key])!==JSON.stringify(old[key]))))
      throw new Error('mfp_v3_provenance_changed');
  }
  for(const key of keys){
    const current=after.find(item=>item.term_key===key);
    if(!current)throw new Error('mfp_v3_concept_missing');
    if(manualEquivalents&&!before.some(item=>item.term_key===key)&&(current.origin!=='manual'||current.source!==null))
      throw new Error('mfp_v3_equivalent_provenance_invalid');
  }
}
