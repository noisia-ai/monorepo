import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement, type ReactNode } from "react";

import { AnnotationsList, CreateElementForm, ElementReviewDetail, LocaleAuthorityPanel,
  signalSemanticContextElementStateKeyV1 } from
  "@/components/brands/SemanticContextReviewWorkbench";

import {
  createSignalSemanticContextMutationLockV1,
  handleSignalSemanticContextCreationKeyV1,
  handleSignalSemanticContextDecisionKeyV1,
  parseSignalSemanticContextApprovalFormUiV2,
  parseSignalSemanticContextAnnotationResolutionFormUiV1,
  parseSignalSemanticContextLocaleAuthorityFormUiV1,
  parseSignalSemanticContextOrdinaryEditFormV1,
  parseSignalSemanticContextCreateFormV1,
  signalSemanticContextCreationGuidanceUrlV1,
  signalSemanticContextAnnotationResolutionsV1,
  signalSemanticContextBoundedPendingSelectionV1,
  signalSemanticContextReviewRangeV1,
  signalSemanticContextSelectionWithinVisiblePageV1,
  submitSignalSemanticContextBulkApprovalUiV1,
  submitSignalSemanticContextBulkApprovalFormUiV2,
  submitSignalSemanticContextDeliberateApprovalUiV2,
  submitSignalSemanticContextAnnotationResolutionFormUiV1,
  submitSignalSemanticContextGuidedRejectUiV1,
  submitSignalSemanticContextLocaleAuthorityFormUiV1,
  submitSignalSemanticContextOrdinaryCommandUiV1,
  submitSignalSemanticContextCreateUiV1,
  submitSignalSemanticContextMergeUiV1
} from "./signal-semantic-context-review-ui";

test("simple creation sends one semantic-only command and keeps locale identity explicit",async()=>{
  const inheritedForm=new FormData();
  for(const[key,value]of Object.entries({element_kind:"benefit",display_text:"Hands-free help",
    canonical_key:"hands-free-help",scope:"workspace",relation_kind:"",relation_target_key:"",
    applicability:"workspace_inherited"}))inheritedForm.set(key,value);
  const inherited=parseSignalSemanticContextCreateFormV1(inheritedForm,["en-US","es-MX"]);
  assert.deepEqual(inherited,{element_kind:"benefit",display_text:"Hands-free help",canonical_key:"hands-free-help",
    scope:"workspace",relation_kind:null,relation_target_key:null,
    applicability:{state:"workspace_inherited",locale:null}});
  const calls:Array<{path:string;body:Record<string,unknown>}>=[];
  await submitSignalSemanticContextCreateUiV1({request:async(path,init)=>{calls.push({path,
    body:JSON.parse(String(init.body)) as Record<string,unknown>});return{};},base:"/semantic-context",
    generationKey:"generation-v6",values:inherited!,idempotencyKey:"create-benefit"});
  assert.equal(calls.length,1);assert.equal(calls[0]!.path,"/semantic-context/elements");
  assert.doesNotMatch(JSON.stringify(calls[0]!.body),/reason|rationale|confirmation|actor|evidence|disposition/u);
  assert.deepEqual(calls[0]!.body,{contract_version:"create-semantic-context-element-v1",
    generation_key:"generation-v6",values:inherited});

  const localized=new FormData();for(const[key,value]of inheritedForm.entries())localized.set(key,value);
  localized.set("element_kind","locale_variant");
  localized.set("applicability","locale:es-MX");
  const localeValue=parseSignalSemanticContextCreateFormV1(localized,["en-US","es-MX"]);
  assert.equal(localeValue?.applicability.locale,"es-MX");
  assert.match(signalSemanticContextCreationGuidanceUrlV1({base:"/semantic-context",generationKey:"generation-v6",
    values:localeValue!}),/locale=es-MX/u);
  localized.set("applicability","workspace_inherited");
  assert.equal(parseSignalSemanticContextCreateFormV1(localized,["en-US","es-MX"]),null);
});

test("simple creation drawer is short, non-ceremonial, and duplicate guidance is operator-readable",()=>{
  let cancels=0;let submits=0;const t=((key:string)=>key) as never;
  const markup=renderToStaticMarkup(createElement(CreateElementForm,{busy:null,generationLocales:["en-US","es-MX"],
    generationMarkets:["MX","US"],guidance:{exact_collision:{element_key:"benefit.existing",
      display_text:"Existing benefit",element_kind:"benefit",scope:"workspace",locale:null,
      applicability_state:"workspace_inherited"},suggestions:[{element_key:"benefit.suggestion",
      display_text:"Suggested benefit",element_kind:"benefit",scope:"workspace",locale:"es-MX",
      applicability_state:"explicit_locale"}],writes_performed:false,provider_calls:0},guidanceLoading:false,
    onCancel:()=>{cancels++;},onOpenExisting:()=>undefined,onPreview:()=>undefined,
    onSubmit:()=>{submits++;},t}));
  assert.match(markup,/Existing benefit/u);assert.match(markup,/Suggested benefit/u);
  assert.match(markup,/reviewWorkbench\.creation\.openExisting/u);
  assert.doesNotMatch(markup,/name="(?:reason|rationale|confirmation|actor|evidence|disposition)"/u);
  assert.equal(handleSignalSemanticContextCreationKeyV1({key:"Escape",busy:false,cancel:()=>{cancels++;}}),true);
  assert.equal(cancels,1);assert.equal(submits,0,"Escape and cancellation never submit a creation request");
  assert.equal(handleSignalSemanticContextCreationKeyV1({key:"Escape",busy:true,cancel:()=>{cancels++;}}),false);
});

test("ordinary editing sends one bounded save without decision ceremony", async () => {
  const form = new FormData();
  form.set("display_text", "  Alexa routines  ");
  form.set("canonical_key", "feature.alexa-routines");
  form.set("scope", "workspace");
  form.set("relation_kind", "associated_with");
  form.set("relation_target_key", "identity.amazon-alexa");
  form.set("applicability", "workspace_inherited");
  const parsed = parseSignalSemanticContextOrdinaryEditFormV1(form, ["en-US", "es-MX"]);
  assert.deepEqual(parsed, {
    display_text: "Alexa routines",
    canonical_key: "feature.alexa-routines",
    scope: "workspace",
    relation_kind: "associated_with",
    relation_target_key: "identity.amazon-alexa",
    applicability: { state: "workspace_inherited", locale: null }
  });
  const calls: Array<{path:string;body:Record<string,unknown>}> = [];
  await submitSignalSemanticContextOrdinaryCommandUiV1({
    request: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return {};
    },
    base: "/semantic-context",
    generationKey: "generation-v6",
    elementKey: "feature.alexa-routines",
    elementVersion: 4,
    stateToken: "state-token-v4",
    action: "save",
    values: parsed!,
    idempotencyKey: "ordinary-save-key"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/semantic-context/elements/feature.alexa-routines/commands");
  assert.deepEqual(calls[0]!.body, {
    contract_version: "edit-semantic-context-element-v1",
    action: "save",
    generation_key: "generation-v6",
    expected_version: 4,
    state_token: "state-token-v4",
    values: parsed
  });
  assert.doesNotMatch(JSON.stringify(calls[0]!.body),
    /reason|rationale|confirmation|actor|reviewer|disposition|evidence|digest/u);
});

test("ordinary editing rejects invalid applicability before network and closes lifecycle commands", async () => {
  const form = new FormData();
  form.set("display_text", "Alexa");form.set("canonical_key", "identity.amazon-alexa");
  form.set("applicability", "locale:fr-FR");
  assert.equal(parseSignalSemanticContextOrdinaryEditFormV1(form, ["en-US", "es-MX"]), null);
  let calls=0;
  const base={request:async()=>{calls++;return{};},base:"/semantic-context",generationKey:"generation-v6",
    elementKey:"identity.amazon-alexa",elementVersion:3,stateToken:"state-token-v3",
    idempotencyKey:"ordinary-command-key"};
  await submitSignalSemanticContextOrdinaryCommandUiV1({...base,action:"archive"});
  await submitSignalSemanticContextOrdinaryCommandUiV1({...base,action:"restore"});
  await submitSignalSemanticContextOrdinaryCommandUiV1({...base,action:"undo",targetVersion:1});
  assert.equal(calls,3);
  await assert.rejects(submitSignalSemanticContextOrdinaryCommandUiV1({...base,
    action:"delete" as never}),/semantic_context_ordinary_action_invalid/u);
  assert.equal(calls,3);
});

function findElement(root: ReactNode, predicate: (element: ReactElement)=>boolean,
  visited=new WeakSet<object>()): ReactElement | null {
  if(Array.isArray(root)){
    for(const child of root){const found=findElement(child,predicate,visited);if(found)return found;}
    return null;
  }
  if (!root || typeof root !== "object" || !("props" in root) || visited.has(root)) return null;
  visited.add(root);
  const element=root as ReactElement<{children?:ReactNode}>;
  if (predicate(element)) return element;
  const children=Array.isArray(element.props.children)?element.props.children:[element.props.children];
  for (const child of children) { const found=findElement(child,predicate,visited); if(found)return found; }
  return null;
}

const renderedDecisionDetail={element:{element_key:"identity-a",element_kind:"identity_term",
  canonical_key:"identity-a",display_text:"Identity A",scope:"primary_brand",locale:"es-MX",
  relation_kind:null,relation_target_key:null,disposition:"pending",provenance:{proposed_at:new Date(0).toISOString()},
  applicability:{generation_locales:["en-US","es-MX"]},
  locale_authority:{state:"sealed_existing_locale",locale:"es-MX",lifecycle:"not_decided",basis:null}},
  lineage:{element_version:1,origin:"provider_proposal"},decision_basis:{state:"not_applicable"},
  review_annotations:[],merge_lineage:[],evidence:[]} as never;

test("mutation lock rejects rapid double activation until the active command settles", () => {
  const lock = createSignalSemanticContextMutationLockV1();
  assert.equal(lock.begin(), true);
  assert.equal(lock.isActive(), true);
  assert.equal(lock.begin(), false);
  lock.end();
  assert.equal(lock.isActive(), false);
  assert.equal(lock.begin(), true);
});

test("empty and populated ranges never render a negative endpoint", () => {
  assert.deepEqual(signalSemanticContextReviewRangeV1({ total: 0, visible: 0, pageIndex: 0, pageSize: 20 }),
    { start: 0, end: 0 });
  assert.deepEqual(signalSemanticContextReviewRangeV1({ total: 45, visible: 5, pageIndex: 2, pageSize: 20 }),
    { start: 41, end: 45 });
});

test("bounded bulk selection accepts only explicit pending leaves", () => {
  const elements = [
    { element_key: "a", element_kind: "alias", disposition: "pending" },
    { element_key: "b", element_kind: "alias", disposition: "approved" },
    { element_key: "c", element_kind: "product", disposition: "pending" }
  ];
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: ["a"], elements }), false,
    "bulk approval starts at two explicit leaves");
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: [], elements }), false);
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: ["a", "b"], elements }), false);
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: ["a", "c"], elements }), false,
    "bulk approval is same-kind only");
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: ["hidden"], elements }), false);
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({
    selectedKeys: Array.from({ length: 16 }, (_, index) => `item-${index}`), elements: []
  }), false);
});

test("selection remains valid only while every key is on the visible page", () => {
  assert.equal(signalSemanticContextSelectionWithinVisiblePageV1({
    selectedKeys: ["a", "b"], visibleElementKeys: ["a", "b", "c"]
  }), true);
  assert.equal(signalSemanticContextSelectionWithinVisiblePageV1({
    selectedKeys: ["a", "hidden"], visibleElementKeys: ["a", "b", "c"]
  }), false);
});

test("single approval sends an explicit, normalized decision basis only after form submit", async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const operationKey = "approval-key";
  await submitSignalSemanticContextDeliberateApprovalUiV2({
    request: async (path, init) => { calls.push({ path, init }); return {}; },
    base: "/semantic-context",
    generationKey: "generation-v1",
    elementKey: "identity-a",
    reason: "semantic_boundary",
    rationale: "  Delimita Cafe\u0301 como identidad gobernada.  ",
    idempotencyKey: operationKey
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    action: "approve",
    generation_key: "generation-v1",
    element_key: "identity-a",
    reason: "semantic_boundary",
    rationale: "Delimita Café como identidad gobernada.",
    confirmation: "approve_selected_semantic_context_element"
  });
});

test("rendered deliberate approval parses the actual form and only a valid submit writes once", () => {
  let mode:"view"|"approve"|"correct"|"reject"|"annotate"|"resolve_annotation"|"locale_authority"="view";
  let requests=0;
  const t=((key:string)=>key) as never;
  const renderDetail=()=>ElementReviewDetail({activeFormRef:{current:null},busy:null,
    annotationResolutionDraft:null,detail:renderedDecisionDetail,locale:"es-MX",mode,onAnnotate:()=>undefined,
    onApprove:(form)=>{if(parseSignalSemanticContextApprovalFormUiV2(form))requests+=1;},
    onBeginResolution:()=>undefined,onCancelResolution:()=>undefined,onCorrect:()=>undefined,
    onLocaleAuthority:()=>undefined,onMode:(next)=>{mode=next;},
    onReject:()=>undefined,onResolve:()=>undefined,reviewWritable:true,t});

  const view=renderDetail();
  const approveButton=findElement(view,(element)=>element.type==="button"
    && String(element.props.className??"").includes("admin-button--primary"));
  assert.ok(approveButton,"the rendered pending detail contains the deliberate approval opener");
  (approveButton.props as {onClick:()=>void}).onClick();
  assert.equal(mode,"approve");assert.equal(requests,0,"the first click only opens the form");

  const approvalForm=renderDetail();
  assert.match(renderToStaticMarkup(approvalForm),/<form[^>]*admin-drawer-form/u);
  const renderedForm=(approvalForm.type as (props:unknown)=>ReactElement)(approvalForm.props);
  const cancelButton=findElement(renderedForm,(element)=>element.type==="button"
    && (element.props as {type?:string}).type==="button");
  assert.ok(cancelButton);(cancelButton.props as {onClick:()=>void}).onClick();
  assert.equal(mode,"view");assert.equal(requests,0,"cancel is non-mutating");

  mode="approve";
  assert.equal(handleSignalSemanticContextDecisionKeyV1({key:"Escape",busy:false,mode,
    cancel:()=>{mode="view";}}),true);
  assert.equal(mode,"view");assert.equal(requests,0,"Escape is non-mutating");

  mode="approve";
  const validForm=renderDetail();
  assert.match(renderToStaticMarkup(validForm),/name="confirmation"[^>]*value="approve_selected/u);
  for(const entries of [
    {},
    {reason:"not_closed",rationale:"Reviewed explicit boundary.",
      confirmation:"approve_selected_semantic_context_element"},
    {reason:"semantic_boundary",rationale:"\t\u00a0",confirmation:"approve_selected_semantic_context_element"},
    {reason:"semantic_boundary",rationale:"Reviewed explicit boundary.",confirmation:"not-confirmed"}
  ]){
    const invalid=new FormData();for(const[key,value]of Object.entries(entries))invalid.set(key,value);
    (validForm.props as {onSubmit:(form:FormData)=>void}).onSubmit(invalid);
  }
  assert.equal(requests,0,"missing or invalid reason, rationale, or confirmation makes zero requests");
  const valid=new FormData();valid.set("reason","semantic_boundary");
  valid.set("rationale","  Reviewed explicit boundary.  ");
  valid.set("confirmation","approve_selected_semantic_context_element");
  (validForm.props as {onSubmit:(form:FormData)=>void}).onSubmit(valid);
  assert.equal(requests,1,"the explicit valid submit crosses exactly one request boundary");
});

test("rendered locale authority opens deliberately and only a complete explicit basis writes once", () => {
  const t=((key:string)=>key) as never;let requests=0;
  let mode:"view"|"approve"|"correct"|"reject"|"annotate"|"resolve_annotation"|"locale_authority"="view";
  const baseElement=(renderedDecisionDetail as unknown as {element:Record<string,unknown>}).element;
  const detail={...(renderedDecisionDetail as unknown as Record<string,unknown>),element:{
    ...baseElement,disposition:"approved",locale:null,
    locale_authority:{state:"unresolved",locale:null,lifecycle:"not_decided",basis:null}
  }} as never;
  const renderDetail=()=>ElementReviewDetail({activeFormRef:{current:null},annotationResolutionDraft:null,
    busy:null,detail,locale:"es-MX",mode,onAnnotate:()=>undefined,onApprove:()=>undefined,
    onBeginResolution:()=>undefined,onCancelResolution:()=>undefined,onCorrect:()=>undefined,
    onLocaleAuthority:(form)=>{if(parseSignalSemanticContextLocaleAuthorityFormUiV1(
      form,["en-US","es-MX"]))requests+=1;},
    onMode:(next)=>{mode=next;},onReject:()=>undefined,onResolve:()=>undefined,reviewWritable:true,t});
  const view=renderDetail();
  const opener=findElement(view,(element)=>element.type==="button"
    &&Array.isArray(element.props.children)
    &&element.props.children.includes("reviewWorkbench.localeAuthority.action"));
  assert.ok(opener,"an approved unresolved leaf exposes the governed locale-authority action");
  (opener.props as {onClick:()=>void}).onClick();
  assert.equal(mode,"locale_authority");assert.equal(requests,0,"the first click only opens the form");
  const form=renderDetail();assert.match(renderToStaticMarkup(form),/admin-drawer-form/u);
  const invalid=new FormData();invalid.set("disposition","global");invalid.set("reason","semantic_boundary");
  invalid.set("rationale","Explicit global basis.");
  (form.props as {onSubmit:(form:FormData)=>void}).onSubmit(invalid);
  assert.equal(requests,0,"missing confirmation writes nothing");
  const valid=new FormData();valid.set("disposition","locale_specific");valid.set("locale","es-MX");
  valid.set("reason","locale_resolution");valid.set("rationale","The operator explicitly selects es-MX.");
  valid.set("confirmation","apply_semantic_context_locale_authority_decision");
  (form.props as {onSubmit:(form:FormData)=>void}).onSubmit(valid);
  assert.equal(requests,1,"one complete locale decision crosses exactly one request boundary");
});

test("workspace-inherited applicability renders its sealed markets and exposes no locale decision form",()=>{
  const t=((key:string,values?:Record<string,unknown>)=>values?.markets?`${key}:${values.markets}`:key) as never;
  const baseElement=(renderedDecisionDetail as unknown as {element:Record<string,unknown>}).element;
  const detail={...(renderedDecisionDetail as unknown as Record<string,unknown>),element:{...baseElement,
    disposition:"approved",locale:null,applicability:{contract_version:
      "signal-semantic-context-effective-applicability-v1",effective_state:"workspace_inherited",
      locale_state:"workspace_inherited",locale:null,market_state:"sealed",
      generation_locales:["en-US","es-MX"],generation_markets:["MX","US"],
      source:"sealed_generation_locale_context"},locale_authority:{state:"workspace_inherited",locale:null,
      lifecycle:"not_decided",basis:null}}} as never;
  const view=ElementReviewDetail({activeFormRef:{current:null},annotationResolutionDraft:null,busy:null,
    detail,locale:"es-MX",mode:"view",onAnnotate:()=>undefined,onApprove:()=>undefined,
    onBeginResolution:()=>undefined,onCancelResolution:()=>undefined,onCorrect:()=>undefined,
    onLocaleAuthority:()=>{throw new Error("inherited applicability must not open the old form");},
    onMode:()=>undefined,onReject:()=>undefined,onResolve:()=>undefined,reviewWritable:true,t});
  assert.ok(findElement(view,(element)=>element.type==="dd"
    &&element.props.children==="values.inheritedWorkspace:MX + US"));
  assert.ok(findElement(view,(element)=>element.type==="span"
    &&element.props.children==="reviewWorkbench.localeAuthority.dispositions.workspace_inherited"));
  assert.equal(findElement(view,(element)=>element.type==="button"
    &&String(element.props.children??"").includes("localeAuthority.action")),null);
});

test("explicit-global applicability and archived lifecycle render their operator-facing states",()=>{
  const t=((key:string)=>key) as never;
  const baseElement=(renderedDecisionDetail as unknown as {element:Record<string,unknown>}).element;
  const detail={...(renderedDecisionDetail as unknown as Record<string,unknown>),element:{...baseElement,
    lifecycle_state:"archived",disposition:"approved",locale:null,applicability:{contract_version:
      "signal-semantic-context-effective-applicability-v1",effective_state:"explicit_global",
      locale_state:"global_resolved",locale:null,market_state:"sealed",
      generation_locales:["en-US","es-MX"],generation_markets:["MX","US"],
      source:"semantic_context_locale_authority"},locale_authority:{state:"global",locale:null,
      lifecycle:"reviewed",basis:{reason:"locale_resolution",rationale:"Explicitly global.",
        reviewer:"authenticated_operator"}}}} as never;
  const view=ElementReviewDetail({activeFormRef:{current:null},annotationResolutionDraft:null,busy:null,
    detail,locale:"es-MX",mode:"view",onAnnotate:()=>undefined,onApprove:()=>undefined,
    onBeginResolution:()=>undefined,onCancelResolution:()=>undefined,onCorrect:()=>undefined,
    onLocaleAuthority:()=>undefined,onMode:()=>undefined,onReject:()=>undefined,onResolve:()=>undefined,
    reviewWritable:true,t});
  assert.ok(findElement(view,(element)=>element.type==="dd"
    &&element.props.children==="reviewWorkbench.localeAuthority.dispositions.global"));
  assert.equal(signalSemanticContextElementStateKeyV1((detail as unknown as {element:never}).element),
    "states.archived");
});

test("rendered annotation resolution first click only opens a deliberate form", () => {
  const t=((key:string)=>key) as never;let requests=0;
  let mode:"view"|"approve"|"correct"|"reject"|"annotate"|"resolve_annotation"|"locale_authority"="view";
  let draft:unknown=null;
  const annotation={annotation_key:"latency-review",annotation_version:1,annotation_type:"uncertain",
    state:"open",resolution:null,reason:"insufficient_context",rationale:"Earlier annotation rationale.",
    resolution_basis:{state:"not_applicable",reason:null,rationale:null,reviewer:null},related_elements:[],
    created_at:new Date(0).toISOString()} as const;
  const detail={...(renderedDecisionDetail as unknown as Record<string,unknown>),
    review_annotations:[annotation]} as never;
  const renderDetail=()=>ElementReviewDetail({activeFormRef:{current:null},annotationResolutionDraft:draft as never,
    busy:null,detail,locale:"es-MX",mode,onAnnotate:()=>undefined,onApprove:()=>undefined,
    onBeginResolution:(selected,resolution,intent)=>{draft={annotation:selected,resolution,intent};mode="resolve_annotation";},
    onCancelResolution:()=>{draft=null;mode="view";},onCorrect:()=>undefined,onLocaleAuthority:()=>undefined,
    onMode:(next)=>{mode=next;},
    onReject:()=>undefined,onResolve:(form)=>{if(parseSignalSemanticContextAnnotationResolutionFormUiV1(form,"resolve"))requests+=1;},
    reviewWritable:true,t});
  const view=AnnotationsList({busy:null,items:[annotation] as never,
    onBeginResolution:(selected,resolution,intent)=>{draft={annotation:selected,resolution,intent};mode="resolve_annotation";},t});
  const resolutionButton=findElement(view,(element)=>element.type==="button"
    &&String(element.props.children??"").includes("context_sufficient"));
  assert.ok(resolutionButton);(resolutionButton.props as {onClick:()=>void}).onClick();
  assert.equal(mode,"resolve_annotation");assert.equal(requests,0,"the first resolution click cannot write");
  const form=renderDetail();assert.match(renderToStaticMarkup(form),/admin-drawer-form/u);
  assert.match(renderToStaticMarkup(form),/resolve_semantic_context_annotation_with_deliberate_basis/u);
  const cancel=(form.props as {onCancel:()=>void}).onCancel;cancel();
  assert.equal(mode,"view");assert.equal(requests,0,"cancel remains non-mutating");
});

test("bulk approval seals one explicit shared basis and no hidden filter authority", async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const operationKey = "bulk-key";
  await submitSignalSemanticContextBulkApprovalUiV1({
    request: async (path, init) => { calls.push({ path, init }); return {}; },
    base: "/semantic-context",
    generationKey: "generation-v1",
    elementKeys: ["b", "a"],
    reason: "semantic_boundary",
    rationale: "The same reviewed boundary applies to every selected alias.",
    idempotencyKey: operationKey
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/semantic-context/decisions");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      action: "bulk_approve",
      generation_key: "generation-v1",
      element_keys: ["a", "b"],
      reason: "semantic_boundary",
      rationale: "The same reviewed boundary applies to every selected alias.",
      confirmation: "apply_shared_decision_basis_to_all_selected_elements"
  });
  assert.doesNotMatch(String(calls[0]!.init.body), /filter|all_population|workspace_id/u);
});

test("bulk approval rejects one key, duplicate keys, and scopes above fifteen before network", async () => {
  let calls = 0;
  const request = async () => { calls += 1; return {}; };
  const operationKey = "bulk-key";
  const base = { request, base: "/semantic-context", generationKey: "generation-v1",
    reason: "semantic_boundary" as const, rationale: "Shared reviewed basis.", idempotencyKey: operationKey };
  await assert.rejects(submitSignalSemanticContextBulkApprovalUiV1({ ...base, elementKeys: ["a"] }),
    /semantic_context_bulk_scope_invalid/u);
  await assert.rejects(submitSignalSemanticContextBulkApprovalUiV1({ ...base, elementKeys: ["a", "a"] }),
    /semantic_context_duplicate_key/u);
  await assert.rejects(submitSignalSemanticContextBulkApprovalUiV1({ ...base,
    elementKeys: Array.from({ length: 16 }, (_, index) => `item-${index}`) }),
  /semantic_context_bulk_scope_invalid/u);
  assert.equal(calls, 0);
});

test("locale authority form is deliberate and submits one homogeneous bounded command", async () => {
  const invalid = new FormData();
  invalid.set("disposition", "global");
  invalid.set("reason", "locale_resolution");
  invalid.set("rationale", "Reviewed global authority.");
  assert.equal(parseSignalSemanticContextLocaleAuthorityFormUiV1(invalid, ["en-US", "es-MX"]), null,
    "missing confirmation cannot cross the request boundary");

  const form = new FormData();
  form.set("disposition", "locale_specific");
  form.set("locale", "es-MX");
  form.set("reason", "locale_resolution");
  form.set("rationale", "  The same reviewed locale basis applies to this visible selection.  ");
  form.set("confirmation", "apply_semantic_context_locale_authority_decision");
  const parsed = parseSignalSemanticContextLocaleAuthorityFormUiV1(form, ["en-US", "es-MX"]);
  assert.deepEqual(parsed, { disposition: "locale_specific", locale: "es-MX", reason: "locale_resolution",
    rationale: "The same reviewed locale basis applies to this visible selection.",
    confirmation: "apply_semantic_context_locale_authority_decision" });

  const calls: Array<{path:string;init:RequestInit}> = [];
  assert.equal(await submitSignalSemanticContextLocaleAuthorityFormUiV1({ form,
    request: async(path,init)=>{calls.push({path,init});return{};},base:"/semantic-context",
    generationKey:"generation-v6",elementKeys:["need-b","need-a"],
    permittedLocales:["en-US","es-MX"],idempotencyKey:"locale-decision-key" }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/semantic-context/locale-authority");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    generation_key: "generation-v6", element_keys: ["need-a","need-b"],
    disposition: "locale_specific", locale: "es-MX", reason: "locale_resolution",
    rationale: "The same reviewed locale basis applies to this visible selection.",
    confirmation: "apply_semantic_context_locale_authority_decision"
  });
  assert.doesNotMatch(String(calls[0]!.init.body), /workspace_id|authority_digest|actor|provider/u);
});

test("locale authority UI rejects mixed shapes, invalid locales, duplicates, and more than fifteen keys", async () => {
  const request = async () => { throw new Error("network must not be reached"); };
  for (const [disposition, locale] of [["global","es-MX"],["locale_specific","fr-FR"]] as const) {
    const form = new FormData();form.set("disposition",disposition);form.set("locale",locale);
    form.set("reason","locale_resolution");form.set("rationale","Reviewed authority.");
    form.set("confirmation","apply_semantic_context_locale_authority_decision");
    assert.equal(await submitSignalSemanticContextLocaleAuthorityFormUiV1({form,request,
      base:"/semantic-context",generationKey:"generation-v6",elementKeys:["a"],
      permittedLocales:["en-US","es-MX"],idempotencyKey:"locale-decision-key"}),false);
  }
  const valid = new FormData();valid.set("disposition","global");valid.set("reason","locale_resolution");
  valid.set("rationale","Reviewed authority.");
  valid.set("confirmation","apply_semantic_context_locale_authority_decision");
  await assert.rejects(submitSignalSemanticContextLocaleAuthorityFormUiV1({form:valid,request,
    base:"/semantic-context",generationKey:"generation-v6",elementKeys:["a","a"],
    permittedLocales:["en-US","es-MX"],idempotencyKey:"locale-decision-key"}),/duplicate/u);
  await assert.rejects(submitSignalSemanticContextLocaleAuthorityFormUiV1({form:valid,request,
    base:"/semantic-context",generationKey:"generation-v6",
    elementKeys:Array.from({length:16},(_,index)=>`key-${index}`),permittedLocales:["en-US","es-MX"],
    idempotencyKey:"locale-decision-key"}),/scope/u);
});

test("locale authority batch Escape closes without submitting", () => {
  let cancelled=0;let submitted=0;const t=((key:string)=>key) as never;
  const panel=LocaleAuthorityPanel({busy:null,elements:[(renderedDecisionDetail as unknown as
    {element:Record<string,unknown>}).element] as never,
    permittedLocales:["en-US","es-MX"],onCancel:()=>{cancelled+=1;},
    onSubmit:()=>{submitted+=1;},t});
  let prevented=0;
  (panel.props as {onKeyDown:(event:{key:string;preventDefault:()=>void})=>void}).onKeyDown({
    key:"Escape",preventDefault:()=>{prevented+=1;}
  });
  assert.equal(cancelled,1);assert.equal(prevented,1);assert.equal(submitted,0);
});

test("bulk approval form requires its real shared basis and checked confirmation before network", async () => {
  let calls=0;const common={request:async()=>{calls+=1;return{};},base:"/semantic-context",
    generationKey:"generation-v1",elementKeys:["a","b"],idempotencyKey:"bulk-form"};
  const missing=new FormData();missing.set("reason","semantic_boundary");
  missing.set("rationale","One reviewed basis applies to both aliases.");
  assert.equal(await submitSignalSemanticContextBulkApprovalFormUiV2({...common,form:missing}),false);
  const invalid=new FormData();invalid.set("reason","invalid");invalid.set("rationale","Reviewed.");
  invalid.set("confirmation","apply_shared_decision_basis_to_all_selected_elements");
  assert.equal(await submitSignalSemanticContextBulkApprovalFormUiV2({...common,form:invalid}),false);
  assert.equal(calls,0,"unchecked or invalid bulk forms make zero requests");
  const valid=new FormData();valid.set("reason","semantic_boundary");
  valid.set("rationale","  One reviewed basis applies to both aliases.  ");
  valid.set("confirmation","apply_shared_decision_basis_to_all_selected_elements");
  assert.equal(await submitSignalSemanticContextBulkApprovalFormUiV2({...common,form:valid}),true);
  assert.equal(calls,1,"one valid checked bulk form makes exactly one request");
});

test("guided rejection crosses one atomic server-owned command boundary", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await submitSignalSemanticContextGuidedRejectUiV1({
    request: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return {};
    },
    base: "/semantic-context",
    generationKey: "generation-v1",
    elementKey: "element-a",
    reason: "insufficient_context",
    rationale: "The governed evidence does not distinguish this concept.",
    idempotencyKey: "reject-key"
  });
  assert.deepEqual(calls.map((call) => call.path), ["/semantic-context/decisions"]);
  assert.equal(calls[0]!.body.rationale, "The governed evidence does not distinguish this concept.");
  assert.equal(calls[0]!.body.reason, "insufficient_context");
  assert.equal(calls[0]!.body.action, "reject");
});

test("guided rejection cannot expose an intermediate browser annotation state", async () => {
  const paths: string[] = [];
  await assert.rejects(submitSignalSemanticContextGuidedRejectUiV1({
    request: async (path) => {
      paths.push(path);
      throw new Error("cut");
    },
    base: "/semantic-context",
    generationKey: "generation-v1",
    elementKey: "element-a",
    reason: "insufficient_context",
    rationale: "Needs more governed context.",
    idempotencyKey: "reject-key"
  }), /cut/u);
  assert.deepEqual(paths, ["/semantic-context/decisions"]);
});

test("merge creates only missing near-duplicate annotations before exact N-to-1 command", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await submitSignalSemanticContextMergeUiV1({
    request: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return {};
    },
    base: "/semantic-context",
    generationKey: "generation-v1",
    targetElementKey: "target",
    sourceElementKeys: ["source-b", "source-a"],
    missingAnnotationKeys: { "source-a": "merge-candidate:a" },
    reason: "duplicate_same_concept",
    rationale: "Both source leaves represent the same governed need.",
    targetCorrection: {
      canonical_key: "canonical-target",
      display_text: "Canonical target",
      scope: "primary_brand",
      relation_kind: null,
      relation_target_key: null
    },
    idempotencyKey: "merge-key"
  });
  assert.deepEqual(calls.map((call) => call.path), [
    "/semantic-context/annotations", "/semantic-context/merge"
  ]);
  assert.deepEqual(calls[1]!.body.source_element_keys, ["source-a", "source-b"]);
  assert.equal(calls[1]!.body.target_element_key, "target");
});

test("annotation resolution choices remain closed by annotation kind", () => {
  assert.deepEqual(signalSemanticContextAnnotationResolutionsV1("near_duplicate"), ["kept_distinct"]);
  assert.deepEqual(signalSemanticContextAnnotationResolutionsV1("locale_unresolved"),
    ["governed_locale", "global"]);
  assert.deepEqual(signalSemanticContextAnnotationResolutionsV1("competitive_unit_unresolved"),
    ["canonical_unit", "not_applicable"]);
});

test("annotation resolution requires a deliberate rationale and checked confirmation before network", async () => {
  let calls=0;
  const common={request:async()=>{calls+=1;return{};},base:"/semantic-context",
    generationKey:"generation-v1",elementKey:"friction-latency",annotationKey:"latency-review",
    resolution:"not_supported" as const,idempotencyKey:"annotation-resolution"};
  for(const entries of [
    {},
    {reason:"not_closed",rationale:"Reviewed.",confirmation:"resolve_semantic_context_annotation_with_deliberate_basis"},
    {reason:"insufficient_context",rationale:"\t\u00a0",confirmation:"resolve_semantic_context_annotation_with_deliberate_basis"},
    {reason:"insufficient_context",rationale:"Reviewed.",confirmation:"wrong"}
  ]){
    const form=new FormData();for(const[key,value]of Object.entries(entries))form.set(key,value);
    assert.equal(parseSignalSemanticContextAnnotationResolutionFormUiV1(form,"resolve"),null);
    assert.equal(await submitSignalSemanticContextAnnotationResolutionFormUiV1({...common,intent:"resolve",form}),false);
  }
  assert.equal(calls,0,"invalid or unconfirmed resolution forms make zero requests");
  const valid=new FormData();valid.set("reason","insufficient_context");
  valid.set("rationale","  Current evidence does not support this resolution.  ");
  valid.set("confirmation","resolve_semantic_context_annotation_with_deliberate_basis");
  assert.equal(await submitSignalSemanticContextAnnotationResolutionFormUiV1({...common,intent:"resolve",form:valid}),true);
  assert.equal(calls,1,"one valid deliberate submit crosses one request boundary");
});

test("annotation basis repair uses a distinct explicit confirmation and never inherits predecessor rationale", async () => {
  const calls:Array<Record<string,unknown>>=[];const form=new FormData();
  form.set("reason","insufficient_context");form.set("rationale","New explicit operator rationale.");
  form.set("confirmation","repair_semantic_context_annotation_resolution_basis");
  assert.equal(await submitSignalSemanticContextAnnotationResolutionFormUiV1({form,intent:"repair",
    request:async(_path,init)=>{calls.push(JSON.parse(String(init.body)) as Record<string,unknown>);return{};},
    base:"/semantic-context",generationKey:"generation-v1",elementKey:"friction-latency",
    annotationKey:"latency-review",resolution:"not_supported",idempotencyKey:"annotation-repair"}),true);
  assert.deepEqual(calls,[{action:"repair",generation_key:"generation-v1",element_key:"friction-latency",
    annotation_key:"latency-review",resolution:"not_supported",reason:"insufficient_context",
    rationale:"New explicit operator rationale.",confirmation:"repair_semantic_context_annotation_resolution_basis"}]);
});
