-- Preserve applied 0259 and all historical decisions. New H1 writes use the full
-- row equality for replay rather than a derived result stamp.
ALTER TABLE signal_hybrid_membership_decisions ALTER COLUMN result_digest DROP NOT NULL;
-- This amount is uncertain exposure, never observed provider spend.
ALTER TABLE signal_labeling_calls ADD COLUMN terminal_exposure_micro_usd bigint NOT NULL DEFAULT 0
  CHECK (terminal_exposure_micro_usd>=0);
CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0221_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 fresh AS(SELECT COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'
   OR c.status='failed' AND c.settled_micro_usd IS NOT NULL),0)::bigint confirmed,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status IN('reserved','submitting','submitted')),0)::bigint reserved,
 (COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status='unknown'),0)+COALESCE(sum(c.terminal_exposure_micro_usd),0))::bigint ambiguous
 FROM signal_labeling_calls c JOIN signal_workspaces w ON w.id=c.workspace_id
 WHERE w.organization_id=target_org AND c.budget_date=target_day AND NOT COALESCE(excluded_ledger='labeling' AND c.id=excluded_id,false))
 SELECT old.confirmed_micro_usd+fresh.confirmed,old.reserved_micro_usd+fresh.reserved,old.ambiguous_micro_usd+COALESCE(fresh.ambiguous,0),
 old.total_micro_usd+fresh.confirmed+fresh.reserved+COALESCE(fresh.ambiguous,0) FROM old,fresh
 $$;
