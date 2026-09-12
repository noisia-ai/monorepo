-- Bind the canonical Semantic Context digest to the pgcrypto function in the
-- controlled extensions schema. Security-definer validators intentionally use
-- a sealed search_path and must not depend on a session-specific extension path.

DO $$
BEGIN
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto digest(bytea,text) is not installed in the extensions schema.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.signal_semantic_context_digest_v1(canonical_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path=pg_catalog
AS $$
  SELECT 'sha256:'||pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(canonical_text,'UTF8'),'sha256'),
    'hex'
  );
$$;

COMMENT ON FUNCTION public.signal_semantic_context_digest_v1(text) IS
  'Canonical SHA-256 digest with pgcrypto bound explicitly to the controlled extensions schema.';
