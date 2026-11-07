import assert from "node:assert/strict";
import test from "node:test";
import { buildMassLabelingConsolidationRequestV1, parseMassLabelingConsolidationResponseV1,
  validateMassLabelingConsolidationOutputV1, type MassLabelingSourceGroupV1 } from "./signal-mass-labeling-consolidation-v1";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12,"0")}`;
const groups: MassLabelingSourceGroupV1[] = Array.from({length:200},(_,index)=>({
  group_id:`guided:group-${index}`,cluster_digest:`sha256:${"a".repeat(64)}`,name:`Conversa ${index}`,
  definition:`Descrição editorial sintética ${index}`,status:"coherent",source_artifact_id:id(index),
}));
const input = {workspace_id:id(900),source_engine_execution_id:id(901),source_groups:groups};

test("global consolidation accepts two hundred summaries, excludes mention inputs and seals ordering",()=>{
  const batch=buildMassLabelingConsolidationRequestV1(input);
  assert.equal(batch.source_groups.length,200);
  assert.equal(batch.request_digest,buildMassLabelingConsolidationRequestV1({...input,source_groups:[...groups].reverse()}).request_digest);
  const encoded=JSON.parse(batch.request_body);
  assert.equal(encoded.max_tokens,32768);
  assert.equal(JSON.stringify(encoded).includes("representatives"),false);
  assert.throws(()=>buildMassLabelingConsolidationRequestV1({...input,source_groups:[{...groups[0]!,mention:"private text"}]} as never),/contract_invalid/u);
  assert.throws(()=>buildMassLabelingConsolidationRequestV1({...input,source_groups:[...groups,groups[0]!]}),/contract_invalid/u);
});

test("global map accounts for every group once across topics and explicit exclusions",()=>{
  const output={topics:[{topic_key:"consumo",name:"Consumo",definition:"Motivos de consumo.",group_ids:groups.slice(0,150).map(group=>group.group_id)}],
    excluded_groups:groups.slice(150).map(group=>({group_id:group.group_id,reason:"Evidência insuficiente"}))};
  assert.equal(validateMassLabelingConsolidationOutputV1(groups,output).excluded_groups.length,50);
  assert.throws(()=>validateMassLabelingConsolidationOutputV1(groups,{...output,excluded_groups:[]}),/contract_invalid/u);
  assert.throws(()=>validateMassLabelingConsolidationOutputV1(groups,{...output,excluded_groups:[...output.excluded_groups,{group_id:groups[0]!.group_id,reason:"duplicado"}]}),/contract_invalid/u);
  assert.throws(()=>validateMassLabelingConsolidationOutputV1(groups,{...output,topics:[{...output.topics[0]!,group_ids:["guided:unknown"]}]}),/contract_invalid/u);
});

test("stored provider bytes must match the sealed model and complete structured output",()=>{
  const batch=buildMassLabelingConsolidationRequestV1({...input,source_groups:groups.slice(0,1)});
  const output={topics:[{topic_key:"consumo",name:"Consumo",definition:"Motivos de consumo.",group_ids:[groups[0]!.group_id]}],excluded_groups:[]};
  const raw={model:batch.configuration.model,type:"message",role:"assistant",stop_reason:"end_turn",usage:{input_tokens:100,output_tokens:80},content:[{type:"text",text:JSON.stringify(output)}]};
  assert.deepEqual(parseMassLabelingConsolidationResponseV1(batch,JSON.stringify(raw)).output,output);
  assert.throws(()=>parseMassLabelingConsolidationResponseV1(batch,JSON.stringify({...raw,stop_reason:"max_tokens"})),/contract_invalid/u);
  assert.throws(()=>parseMassLabelingConsolidationResponseV1(batch,JSON.stringify({...raw,model:"other"})),/contract_invalid/u);
});
