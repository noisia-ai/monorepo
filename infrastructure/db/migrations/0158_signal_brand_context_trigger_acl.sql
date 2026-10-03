-- Trigger functions replaced by SQL0157 keep their historical ACLs. They are
-- not directly invocable, but the composed client
-- path keeps every server-only function private explicitly.
REVOKE ALL ON FUNCTION
  public.validate_signal_semantic_context_element_operation_v2(),
  public.validate_signal_semantic_context_event_v1(),
  public.validate_signal_semantic_context_generation_v1(),
  public.validate_signal_semantic_context_publication_v2()
FROM PUBLIC;

DO $$
DECLARE
  role_name text;
  function_identity text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH function_identity IN ARRAY ARRAY[
        'public.validate_signal_semantic_context_element_operation_v2()',
        'public.validate_signal_semantic_context_event_v1()',
        'public.validate_signal_semantic_context_generation_v1()',
        'public.validate_signal_semantic_context_publication_v2()'
      ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', function_identity, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
