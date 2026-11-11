import {createHash} from "node:crypto";
import {buildMassLabelingConsolidationRequestV1,buildMassLabelingConsolidationRecoveryDecisionV2} from "./signal-mass-labeling-consolidation-v1";
import {SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2 as configuration} from "./signal-workspace-interpretation-v1";
export const syntheticNativeReceiptShaV2=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export function massLabelingReceiptRecoveryFixtureV2(){
 const groups=Array.from({length:4},(_,i)=>({group_id:`guided:synthetic_${i}`,cluster_digest:syntheticNativeReceiptShaV2(`group${i}`),
  name:`Synthetic topic ${i}`,definition:`Synthetic description ${i} describes an activity.`,status:i<2?"mixed" as const:"coherent" as const,source_artifact_id:id(i+10)}));
 const category_context={category:"Synthetic category",terms:["Synthetic category","Synthetic term"]};
 const batch=buildMassLabelingConsolidationRequestV1({workspace_id:id(1),source_engine_execution_id:id(2),source_groups:groups,configuration,category_context});
 const output={topics:groups.map((g,i)=>{const en={name:g.name,definition:g.definition};return{topic_key:`synthetic_${i}`,name:g.name,
  definition:i===2?`as ${g.definition}`:g.definition,group_ids:[g.group_id],localization:{original_language:"en",original:en,en,es:{name:`Tema sintético ${i}`,definition:`Descripción sintética ${i}.`}}};}),
  excluded_groups:groups.slice(0,2).map(g=>({group_id:g.group_id,reason:"Mixed group with limited representation and redundant coverage."})),category_lexicon:category_context};
 const envelope={model:configuration.model,type:"message",role:"assistant",stop_reason:"end_turn",usage:{input_tokens:100,output_tokens:80},content:[{type:"text",text:JSON.stringify(output)}]};
 const raw=JSON.stringify(envelope);const call_id=id(3);
 return{batch,output,envelope,raw,call_id,decision:buildMassLabelingConsolidationRecoveryDecisionV2({batch,raw_response:raw,call_id})};
}
