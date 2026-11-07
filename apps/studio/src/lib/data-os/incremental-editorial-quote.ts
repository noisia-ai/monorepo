import { createHmac, timingSafeEqual } from "node:crypto";
import { SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as config, signalWorkspaceEmbeddingDigestV1 as digest } from "@noisia/query-engine";
import { SignalWorkspaceEngineError } from "@noisia/db";

export type IncrementalEditorialQuoteSource = {
  workspace_id: string; actor_user_id: string; action: "begin_incremental_editorial" | "renew_incremental_editorial";
  run_id: string; evidence_plan_artifact_id: string; numeric_checkpoint_digest: string;
  target_unit_digest: string; history_cut_digest: string; target_units: number;
  evidence_bytes: number; context_bytes: number; maximum_micro_usd: number | null;
  prior_admission_operation_id: string | null;
};
export type IncrementalEditorialQuote = {
  reference: string; expires_at: string; estimated_micro_usd: number; target_units: number;
  maximum_micro_usd: number | null; model: "claude-sonnet-4-6"; pricing_version: string;
};
const fail = (): never => { throw new SignalWorkspaceEngineError("workspace_incremental_editorial_quote_required", 409); };
const signingKey = () => {
  const key = process.env.KINDE_CLIENT_SECRET;
  if (!key) throw new SignalWorkspaceEngineError("workspace_incremental_editorial_quote_unavailable", 503);
  return key;
};
/** Forecast from the prepared evidence size, repeated context and expected output.
 * One request per unit is conservative; batching/cache may reduce actual usage.
 * This is not the reservation bound and never becomes a strict spending cap. */
export function incrementalEditorialEstimate(source: IncrementalEditorialQuoteSource) {
  if (![source.target_units, source.evidence_bytes, source.context_bytes].every(n => Number.isSafeInteger(n) && n >= 0)
    || source.target_units < 1) return fail();
  const input = Math.ceil((source.evidence_bytes + source.target_units * (source.context_bytes + 4096)) / 3.5);
  const output = source.target_units * 2048;
  return Math.ceil((input * config.input_micro_usd_per_million_tokens + output * config.output_micro_usd_per_million_tokens) / 1_000_000);
}
function seal(source: IncrementalEditorialQuoteSource) { return digest({ source, configuration: config }); }
export function signIncrementalEditorialQuote(source: IncrementalEditorialQuoteSource, now = Date.now(), key = signingKey()): IncrementalEditorialQuote {
  const expiry = Math.floor(now / 1000) + 240, sourceDigest = seal(source);
  const reference = `iq1.${expiry}.${sourceDigest.slice(7)}.${createHmac("sha256", key).update(`${expiry}:${sourceDigest}`).digest("hex")}`;
  return { reference, expires_at: new Date(expiry * 1000).toISOString(), estimated_micro_usd: incrementalEditorialEstimate(source),
    target_units: source.target_units, maximum_micro_usd: source.maximum_micro_usd, model: "claude-sonnet-4-6", pricing_version: config.pricing_version };
}
export function verifyIncrementalEditorialQuote(source: IncrementalEditorialQuoteSource, reference: string | undefined,
  confirmation: boolean | undefined, now = Date.now(), key = signingKey()) {
  const match = /^iq1\.([0-9]{10})\.([a-f0-9]{64})\.([a-f0-9]{64})$/u.exec(reference ?? "");
  if (confirmation !== true || !match || Number(match[1]) * 1000 <= now || Number(match[1]) * 1000 > now + 240_000) return fail();
  const sourceDigest = seal(source);
  const signature = createHmac("sha256", key).update(`${match[1]}:${sourceDigest}`).digest();
  if (`sha256:${match[2]}` !== sourceDigest || !timingSafeEqual(Buffer.from(match[3]!, "hex"), signature)) return fail();
}
