-- The classification authority was installed before Supabase moved pgcrypto
-- into its trusted extensions schema. Its SECURITY DEFINER writers deliberately
-- pin search_path, so include that schema for their existing digest() calls.
-- Only function configuration changes; stored classifications are untouched.

ALTER FUNCTION public.register_signal_labeling_function_v1(
  uuid,text,text,integer,uuid,uuid,jsonb,jsonb,text,text,timestamptz,timestamptz,uuid,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.register_signal_classification_approval_policy_v1(
  uuid,uuid,text,integer,text,uuid,uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.register_signal_tagging_model_v1(
  uuid,uuid,text,text,text,uuid,text,text,text,jsonb,text,text,text,text,text,uuid,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.transition_signal_tagging_model_v1(
  uuid,uuid,text,uuid,timestamptz,text,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.register_signal_classification_gold_set_v1(
  uuid,uuid,text,integer,text,timestamptz,timestamptz,uuid,jsonb,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.record_signal_classification_evaluation_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,integer,integer,integer,integer,integer,
  numeric,numeric,numeric,numeric,text,text,text,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.record_signal_classification_evaluation_slice_v1(
  uuid,uuid,text,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.project_signal_classification_generation_v1(uuid,uuid,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.begin_signal_classification_generation_v1(
  uuid,uuid,text,integer,uuid,text,text,text,integer,text,uuid,text,text,uuid)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.append_signal_classification_result_v1(
  uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,numeric,text,text,text,text,text,uuid,text,text,uuid)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.append_signal_classification_result_batch_v1(
  uuid,uuid,uuid,jsonb,text,uuid,text,text)
  SET search_path=public,extensions,pg_temp;

ALTER FUNCTION public.finalize_signal_classification_generation_v1(uuid,uuid,uuid,text,text)
  SET search_path=public,extensions,pg_temp;
