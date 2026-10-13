-- Freeze the approved membership SELECT once, at migration time.
-- No pg_get_viewdef/hash/dynamic execution on the serving path.
DO $$
DECLARE body text; body_hash text; needle constant text := 'signal_mention_facets_current_v1 f';
BEGIN
 PERFORM set_config('search_path','public,extensions',true);
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
     WHERE oid='signal_workspace_concept_memberships_read_v1(uuid)'::regprocedure)
    IS DISTINCT FROM 'd24bd82e95e40fcff91a43b1483e554c7d2e99c46e8fa41dcf356b5a778c6f4d' THEN
  RAISE EXCEPTION 'mfp_native_reader_preimage_changed' USING ERRCODE='55000';
 END IF;
 body := pg_get_viewdef('signal_concept_memberships_current_v1'::regclass,false);
 body_hash := encode(sha256(convert_to(body,'UTF8')),'hex');
 IF body_hash NOT IN ('6fa663efa382723bedbd05aacb46ad8af83a354e9c3d878c050dd3af82abd2aa',
                     '54175bb4c02e62f73f278fb23abf41d6bf724aa2dfbce70e10389239ffb80f58') THEN
  RAISE EXCEPTION 'mfp_native_membership_preimage_changed' USING ERRCODE='55000';
 END IF;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'mfp_native_facet_reference_count_changed' USING ERRCODE='55000';
 END IF;
 body := replace(body,needle,'signal_workspace_mention_facets_read_v1($1) f');
 EXECUTE format('CREATE OR REPLACE FUNCTION signal_workspace_concept_memberships_read_v1(target uuid)
 RETURNS SETOF signal_concept_memberships_current_v1 LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS %L',body);
END $$;
-- CREATE OR REPLACE retains the private ACL installed by 0266.
REVOKE ALL ON FUNCTION signal_workspace_concept_memberships_read_v1(uuid) FROM PUBLIC;
