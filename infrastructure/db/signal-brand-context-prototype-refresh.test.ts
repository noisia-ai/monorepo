import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = () => readFileSync(new URL("./migrations/0161_signal_brand_context_prototype_refresh.sql", import.meta.url), "utf8");
const body = (name: string) => sql().split(`FUNCTION ${name}(`)[1]?.split("$$;")[0] ?? "";

test("completed refresh proves the exact immutable bundle and rejects unsettled work", () => {
  const proof = body("signal_brand_context_prototype_refresh_safe_v1");
  for (const marker of ["run.status='completed'", "run.execution_token IS NULL", "run.processing_admission_id=receipt.admission_id",
    "admission.target_id=run.id", "admission.brand_context_prototype_receipt_id=receipt.id",
    "run.topic_input_snapshot=receipt.plan", "run.reserved_micro_usd=0", "run.unknown_reserved_micro_usd=0",
    "run.observed_exception_micro_usd=0", "call.status NOT IN('settled','definitely_not_sent')",
    "receipt.plan_digest IS DISTINCT FROM prototype_plan->>'plan_digest'", "receipt.plan->>'context_digest'=prototype_plan->>'context_digest'",
    "NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor"]) assert.ok(proof.includes(marker), marker);
});

test("refresh is always explicit, preserves DNC and inherits all original quote fences", () => {
  const quote = body("quote_signal_brand_context_prototypes_v1");
  for (const marker of ["signal_brand_context_prototype_refresh_safe_v1(previous.id,prototype_plan)",
    "signal_brand_context_prototype_retry_safe_v1(previous.run_id)", "previous.quote_snapshot->>'refreshes_completed_plan'='true'", "previous.id IS NULL AND instant<parent.authorization_not_after",
    "'requires_confirmation',refresh_completed OR NOT inherited_authorization AND missing_count>0",
    "NOT refresh_completed AND (inherited_authorization OR missing_count=0)", "'refreshes_completed_plan',refresh_completed",
    "signal_brand_context_processing_source_current_v1(generation.id)", "brand_context_prototype_prior_call_unresolved",
    "execution_cap:=CASE WHEN missing_count=0 THEN 0", "signal_processing_org_exposure_v1",
    "policy.status IS DISTINCT FROM 'active'", "cache.chunk_sha256=text.key"]) assert.ok(quote.includes(marker), marker);
  assert.doesNotMatch(sql(), /UPDATE signal_(?:semantic_context|brand_context_prototype_receipts)|INSERT INTO signal_semantic_context/u);
});

test("new helper denies PUBLIC and browser roles; existing receipt/admission machinery is unchanged", () => {
  assert.match(sql(), /REVOKE ALL ON FUNCTION signal_brand_context_prototype_refresh_safe_v1\(uuid,jsonb\) FROM PUBLIC/u);
  assert.match(sql(), /ARRAY\['anon','authenticated'\]/u);
  assert.doesNotMatch(sql(), /CREATE (?:TABLE|TRIGGER)|FUNCTION (?:authorize_signal_brand_context_prototypes|signal_processing_admission_guard)/u);
});
