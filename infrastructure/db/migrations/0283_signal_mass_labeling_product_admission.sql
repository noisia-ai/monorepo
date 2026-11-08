-- Product runs use ordinary organization admissions. The historical pilot
-- extension and its immutable identity retain their original checks.
CREATE OR REPLACE FUNCTION guard_signal_mass_labeling_admission_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.provider IS DISTINCT FROM 'typesafe' OR NEW.model IS DISTINCT FROM 'jev-1.13.0'
   OR NEW.execution_cap_micro_usd IS NULL OR NEW.execution_cap_micro_usd<=0 OR NEW.automatic
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling')
   OR NOT COALESCE((
     NEW.configuration->>'contract_version'='mass-labeling-jev-v1'
       AND NEW.configuration->>'workspace_id'=NEW.workspace_id::text
     OR NEW.configuration=jsonb_build_object('contract_version','mass-labeling-jev-v2','provider','typesafe','model','jev-1.13.0')
   ),false) THEN
  RAISE EXCEPTION 'mass_labeling_admission_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_signal_mass_labeling_admission_owner_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_runs mass
   JOIN signal_labeling_runs run ON run.id=mass.run_id AND run.workspace_id=mass.workspace_id
   JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
   WHERE mass.workspace_id=NEW.workspace_id AND mass.run_id=NEW.target_id
     AND run.processing_admission_id=NEW.id AND run.actor_user_id=NEW.actor_user_id
     AND run.kind='mass_labeling' AND labeler.kind='mass_labeling' AND labeler.provider='typesafe'
     AND labeler.model='jev-1.13.0' AND (
       NEW.configuration->>'contract_version'='mass-labeling-jev-v1' AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v1'
       OR NEW.configuration->>'contract_version'='mass-labeling-jev-v2'
         AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2'
         AND labeler.identity#>>'{params,question_language}'='en'
         AND labeler.identity#>>'{params,top_candidates}'='4'
         AND labeler.identity#>>'{params,candidate_language}' IN('en','original')
         AND length(btrim(labeler.identity#>>'{params,category}')) BETWEEN 1 AND 160
         AND jsonb_typeof(labeler.identity#>'{params,interests}')='array'
         AND run.membership_snapshot->'configuration'=jsonb_build_object(
           'category',labeler.identity#>'{params,category}',
           'candidate_language',labeler.identity#>'{params,candidate_language}',
           'interests',labeler.identity#>'{params,interests}')
     )) THEN
  RAISE EXCEPTION 'mass_labeling_admission_owner_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
