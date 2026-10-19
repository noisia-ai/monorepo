import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TopicCandidateRefinementSuggestion } from "../../components/brands/TopicCandidateRefinementSuggestion";
import { copySignalTopicEvaluationV2RefinementWording,
  type SignalTopicEvaluationV2Candidate,type SignalTopicEvaluationV2RefinementProposal }
  from "./signal-topic-evaluation-v2-management";

const digest=`sha256:${"6".repeat(64)}`;
const candidate:SignalTopicEvaluationV2Candidate={candidate_key:"candidate.campaign",title:"Original wording",
  description:"Original description",inclusion:["Campaign"],exclusion:["Support"],source_cluster_keys:["cluster.campaign"],
  evidence_count:3,rank:1,review_state:"pending",revision:1,state_token:digest,undo_target_revision:null,
  updated_at:"2026-09-06T00:00:00.000Z"};
const proposal:SignalTopicEvaluationV2RefinementProposal={display_name:"Echo football campaign",
  description:"A campaign-focused suggestion",rationale:"Three directly cited examples",evidence_refs:[digest],
  related_candidates:[],recommendation:"none",proposal_digest:digest,created_at:"2026-09-06T01:00:00.000Z",
  source_revision:1,is_stale:false};
const fields={title:"Unsaved custom name",description:"Unsaved custom description",inclusion:"My inclusion",
  exclusion:"My exclusion"};
const t=(key:string,values?:Record<string,string|number>)=>`${key}${values?JSON.stringify(values):""}`;
const noop=()=>undefined;
function render(overrides:Partial<Parameters<typeof TopicCandidateRefinementSuggestion>[0]>={}){
  return renderToStaticMarkup(createElement(TopicCandidateRefinementSuggestion,{
    refinement:{status:"available",proposal},dismissed:false,copied:false,busy:false,editable:true,
    t,onUse:noop,onDismiss:noop,onShow:noop,...overrides}));
}

test("copying suggestion changes only unsaved wording and preserves scopes, original and proposal",()=>{
  const before=JSON.stringify({candidate,proposal,fields});
  assert.deepEqual(copySignalTopicEvaluationV2RefinementWording({candidate,proposal,fields}),{
    ...fields,title:proposal.display_name,description:proposal.description});
  assert.equal(JSON.stringify({candidate,proposal,fields}),before);
  for(const args of [{candidate:{...candidate,review_state:"rejected" as const},proposal},
    {candidate,proposal:{...proposal,is_stale:true}},
    {candidate:{...candidate,revision:2},proposal}]){
    assert.equal(copySignalTopicEvaluationV2RefinementWording({...args,fields}),null);
  }
});

test("suggestion display escapes prose, has clear copy feedback, and no autonomous merge or request",()=>{
  const markup=render({refinement:{status:"available",proposal:{...proposal,
    display_name:"<script>not code</script>",recommendation:"consider_split"}},copied:true});
  assert.match(markup,/&lt;script&gt;/u);assert.doesNotMatch(markup,/<script>/u);
  assert.match(markup,/refinement\.basis/u);assert.match(markup,/refinement\.consider_split/u);
  assert.match(markup,/role="status"[^>]*>refinement\.copied/u);
  assert.doesNotMatch(markup,/<form|fetch|POST/u);
});

test("unavailable, absent, dismissed and stale suggestions have distinct truthful states",()=>{
  assert.match(render({refinement:{status:"unavailable",proposal:null}}),/refinement\.unavailable/u);
  assert.match(render({refinement:{status:"none",proposal:null}}),/refinement\.none/u);
  const dismissed=render({dismissed:true});
  assert.match(dismissed,/refinement\.dismissed/u);assert.match(dismissed,/refinement\.show/u);
  assert.doesNotMatch(dismissed,/refinement\.use|Echo football/u);
  const stale=render({refinement:{status:"available",proposal:{...proposal,is_stale:true}}});
  assert.match(stale,/refinement\.stale/u);
  assert.match(stale,/<button[^>]*disabled=""[^>]*>refinement\.use/u);
  assert.match(render({editable:false}),/<button[^>]*disabled=""[^>]*>refinement\.use/u);
});

test("existing manager remains the only editorial transport and both locales document reversible copy",async()=>{
  const [manager,panel,es,en]=await Promise.all([
    readFile(new URL("../../components/brands/FullEvidenceTopicCandidateManager.tsx",import.meta.url),"utf8"),
    readFile(new URL("../../components/brands/TopicCandidateRefinementSuggestion.tsx",import.meta.url),"utf8"),
    readFile(new URL("../../../messages/es-MX.json",import.meta.url),"utf8"),
    readFile(new URL("../../../messages/en-US.json",import.meta.url),"utf8")]);
  const copy=manager.slice(manager.indexOf("function useProposal"),manager.indexOf("async function command"));
  assert.match(copy,/copySignalTopicEvaluationV2RefinementWording/u);
  assert.doesNotMatch(copy,/requestJson|fetch|command\(/u);
  assert.doesNotMatch(panel,/fetch\(|requestJson|dangerouslySetInnerHTML/u);
  assert.match(manager,/setProposalDismissed\(false\);setProposalCopied\(false\)/u);
  const esCopy=JSON.parse(es).AdminWorkspace.brandOs.fullEvidenceTopicCandidates.refinement;
  const enCopy=JSON.parse(en).AdminWorkspace.brandOs.fullEvidenceTopicCandidates.refinement;
  assert.deepEqual(Object.keys(esCopy).sort(),Object.keys(enCopy).sort());
  assert.match(esCopy.hint,/nada cambia hasta Guardar/u);
  assert.match(enCopy.dismissed,/saved suggestion are unchanged/u);
});
