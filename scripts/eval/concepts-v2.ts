import { createHash } from 'node:crypto';
import { createSignalTopicInputSchemaV1 } from '../../packages/query-engine/src/signal-topic-catalog-v1';

export type ProposedConcept = { concept_key:string; label:string; definition:string;
  inclusions:string[]; exclusions:string[]; examples_positive:string[]; examples_negative:string[]; labeling_rules:string[] };
export type CurrentConcept = {term_key:string;scope:'primary_brand'|'competitor'|'category'|'all_conversations';
  definition_revision:number;definition_digest:string;label:string;definition:string;inclusion:string[];exclusion:string[];
  positive_examples:string[];negative_examples:string[]};

export function plannedConceptUpdates(proposed:ProposedConcept[],current:CurrentConcept[],selectedKeys:string[]) {
  if (proposed.length!==3 || new Set(proposed.map(c=>c.concept_key)).size!==3 ||
    proposed.some(c=>!selectedKeys.includes(c.concept_key)) || selectedKeys.length!==3)
    throw new Error('mfp_eval_concept_selection_mismatch');
  return proposed.map(item=>{
    const existing=current.find(c=>c.term_key===item.concept_key);
    if(!existing)throw new Error('mfp_eval_catalog_concept_missing');
    if(!Array.isArray(item.labeling_rules)||item.labeling_rules.length===0)throw new Error('mfp_eval_concept_rules_missing');
    const input=createSignalTopicInputSchemaV1.parse({label:item.label,
      definition:`${item.definition}\n\nReglas de etiquetado:\n${item.labeling_rules.map((rule,index)=>`${index+1}. ${rule}`).join('\n')}`,
      scope:existing.scope,
      inclusion:item.inclusions,exclusion:item.exclusions,positive_examples:item.examples_positive,negative_examples:item.examples_negative});
    const unchanged=['label','definition','scope','inclusion','exclusion','positive_examples','negative_examples']
      .every(key=>JSON.stringify(existing[key as keyof CurrentConcept])===JSON.stringify(input[key as keyof typeof input]));
    return {concept_key:item.concept_key,input,unchanged,expected_definition_revision:existing.definition_revision,
      expected_definition_digest:existing.definition_digest};
  });
}

export const sha256=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
