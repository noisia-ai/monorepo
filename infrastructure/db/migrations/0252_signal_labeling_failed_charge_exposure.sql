-- Paid terminal errors remain visible to the daily exposure policy. Existing
-- 0221 function and applied migrations are immutable; this is forward-only.
CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0221_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 fresh AS(SELECT COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'
   OR c.status='failed' AND c.settled_micro_usd IS NOT NULL),0)::bigint confirmed,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status IN('reserved','submitting','submitted')),0)::bigint reserved,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status='unknown'),0)::bigint ambiguous
 FROM signal_labeling_calls c JOIN signal_workspaces w ON w.id=c.workspace_id
 WHERE w.organization_id=target_org AND c.budget_date=target_day AND NOT COALESCE(excluded_ledger='labeling' AND c.id=excluded_id,false))
 SELECT old.confirmed_micro_usd+fresh.confirmed,old.reserved_micro_usd+fresh.reserved,old.ambiguous_micro_usd+fresh.ambiguous,
 old.total_micro_usd+fresh.confirmed+fresh.reserved+fresh.ambiguous FROM old,fresh
 $$;
