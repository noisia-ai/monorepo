import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";

import { ElementReviewDetail } from "@/components/brands/SemanticContextReviewWorkbench";

import {
  createSignalSemanticContextMutationLockV1,
  handleSignalSemanticContextDecisionKeyV1,
  parseSignalSemanticContextApprovalFormUiV2,
  signalSemanticContextAnnotationResolutionsV1,
  signalSemanticContextBoundedPendingSelectionV1,
  signalSemanticContextReviewRangeV1,
  signalSemanticContextSelectionWithinVisiblePageV1,
  submitSignalSemanticContextBulkApprovalUiV1,
  submitSignalSemanticContextBulkApprovalFormUiV2,
  submitSignalSemanticContextDeliberateApprovalUiV2,
  submitSignalSemanticContextGuidedRejectUiV1,
  submitSignalSemanticContextMergeUiV1
} from "./signal-semantic-context-review-ui";

function findElement(root: ReactNode, predicate: (element: ReactElement)=>boolean): ReactElement | null {
  if (!root || typeof root !== "object" || !("props" in root)) return null;
  const element=root as ReactElement<{children?:ReactNode}>;
  if (predicate(element)) return element;
  const children=Array.isArray(element.props.children)?element.props.children:[element.props.children];
  for (const child of children) { const found=findElement(child,predicate); if(found)return found; }
  return null;
}

const renderedDecisionDetail={element:{element_key:"identity-a",element_kind:"identity_term",
  canonical_key:"identity-a",display_text:"Identity A",scope:"primary_brand",locale:"es-MX",
  relation_kind:null,relation_target_key:null,disposition:"pending",provenance:{proposed_at:new Date(0).toISOString()}},
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
  let mode:"view"|"approve"|"correct"|"reject"|"annotate"="view";
  let requests=0;
  const t=((key:string)=>key) as never;
  const renderDetail=()=>ElementReviewDetail({activeFormRef:{current:null},busy:null,
    detail:renderedDecisionDetail,locale:"es-MX",mode,onAnnotate:()=>undefined,
    onApprove:(form)=>{if(parseSignalSemanticContextApprovalFormUiV2(form))requests+=1;},
    onCorrect:()=>undefined,onMode:(next)=>{mode=next;},
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
      locale: "es-MX",
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
