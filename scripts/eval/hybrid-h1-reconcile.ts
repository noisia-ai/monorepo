/** Private dev-test receipt repair; verifies raw storage and never sends to a provider. */
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "./fixture-identity";
import { verifyMfpEvalRights } from "./rights-check";
import { reconcileHybridDuplicateRawReceiptV1 } from "../../services/workers/src/workers/signal-hybrid-membership";

void main(async()=>{
  if(!process.argv.includes("--real") || process.env.NOISIA_MFP_HYBRID_ENABLED!=="true" ||
    process.env.NOISIA_MFP_HYBRID_LEDGER_READY!=="true") throw new Error("mfp_hybrid_disabled");
  const jevPrice=Number(process.env.NOISIA_JEV_INPUT_USD_PER_MTOK);
  if(!Number.isFinite(jevPrice)||jevPrice<=0) throw new Error("mfp_hybrid_jev_price_required");
  const identity=await loadMfpEvalIdentity();
  const pool=await openDatabase();
  try {
    const unknowns=(await pool.query<{run_id:string}>(`SELECT run.id run_id FROM signal_labeling_runs run
      JOIN signal_labeling_calls call ON call.run_id=run.id
      WHERE run.workspace_id=$1 AND run.kind='membership' AND run.status='failed'
        AND run.error_code='labeling_outcome_unknown' AND call.status='unknown'
        AND call.raw_storage_key IS NULL AND NOT call.results_applied
      ORDER BY run.created_at`,[identity.workspace_id])).rows;
    if(unknowns.length!==2) throw new Error("mfp_hybrid_unknown_count_changed");
    await verifyMfpEvalRights(undefined,pool,unknowns.map((row:{run_id:string})=>row.run_id));
    const receipt=await reconcileHybridDuplicateRawReceiptV1({database:pool,
      workspace_id:identity.workspace_id,idempotency_key:"mfp-hybrid-h1-r4-jev-resume-two-unknown",jevPrice});
    console.log(JSON.stringify({stage:"hybrid_duplicate_receipt_reconciled",
      duplicate_paid_usd:receipt.settled_micro_usd/1e6,provider_calls:0,decision_writes:0}));
  } finally {await pool.end();}
});
