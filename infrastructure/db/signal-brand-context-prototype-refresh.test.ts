import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = () => readFileSync(new URL("./migrations/0165_signal_brand_context_prototype_context_refresh.sql", import.meta.url), "utf8");
const body = (name: string) => sql().split(`FUNCTION ${name}(`)[1]?.split("$$;")[0] ?? "";

test("completed context refresh proves current server authority, the immutable predecessor and no unsettled work", () => {
  const proof = body("signal_brand_context_prototype_refresh_safe_v1");
  for (const marker of ["signal_brand_context_composed_generation_valid_v1(generation.id)",
    "signal_brand_context_processing_source_current_v1(generation.id)", "newer.generation_version>generation.generation_version",
    "signal_brand_context_prototype_plan_valid_v1(receipt.workspace_id,prototype_plan)",
    "prototype_plan->'embedding_profile'=receipt.plan->'embedding_profile'",
    "run.status='completed'", "run.execution_token IS NULL", "run.processing_admission_id=receipt.admission_id",
    "admission.target_id=run.id", "admission.brand_context_prototype_receipt_id=receipt.id",
    "run.topic_input_snapshot=receipt.plan", "run.reserved_micro_usd=0", "run.unknown_reserved_micro_usd=0",
    "run.observed_exception_micro_usd=0", "call.status NOT IN('settled','definitely_not_sent')",
    "receipt.plan_digest IS DISTINCT FROM prototype_plan->>'plan_digest'",
    "NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor"]) assert.ok(proof.includes(marker), marker);
  assert.doesNotMatch(proof,/receipt\.plan->>'context_digest'=prototype_plan->>'context_digest'/u);
  assert.doesNotMatch(proof,/prototype_plan->>'taxonomy_profile_id'=receipt\.taxonomy_profile_id::text/u);
});

test("context drift changes only the private refresh proof and creates no execution or monetary authority", () => {
  assert.doesNotMatch(sql(), /UPDATE|INSERT|DELETE/u);
  assert.doesNotMatch(sql(), /CREATE (?:TABLE|TRIGGER)|FUNCTION (?:authorize_signal_brand_context_prototypes|signal_processing_admission_guard)/u);
});

test("new helper denies PUBLIC and browser roles; existing receipt/admission machinery is unchanged", () => {
  assert.match(sql(), /REVOKE ALL ON FUNCTION signal_brand_context_prototype_refresh_safe_v1\(uuid,jsonb\) FROM PUBLIC/u);
  assert.match(sql(), /ARRAY\['anon','authenticated'\]/u);
  assert.doesNotMatch(sql(), /CREATE (?:TABLE|TRIGGER)|FUNCTION (?:authorize_signal_brand_context_prototypes|signal_processing_admission_guard)/u);
});
