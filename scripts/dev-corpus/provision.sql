\set ON_ERROR_STOP on
-- Run ONCE through the existing private pgvector console as its admin role.
-- NOISIA_MFP_DATABASE_PASSWORD must be a private Railway variable, never an argument.
-- This file must not be executed on another PostgreSQL cluster.
SELECT CASE WHEN system_identifier::text='7683766906362679330'
  AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
  THEN true ELSE false END AS target_matches FROM pg_control_system() \gset
\if :target_matches
\else
  \quit 3
\endif
SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='noisia_mfp')
  AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='noisia_mfp') AS fresh \gset
\if :fresh
\else
  -- Existing resources need inventory, never overwrite passwords/ownership/schema.
  \quit 4
\endif
\getenv mfp_password NOISIA_MFP_DATABASE_PASSWORD
SELECT format('CREATE ROLE noisia_mfp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'mfp_password') \gexec
\unset mfp_password
CREATE DATABASE noisia_mfp OWNER noisia_mfp TEMPLATE template0;
REVOKE CONNECT ON DATABASE noisia_mfp FROM PUBLIC;
GRANT CONNECT ON DATABASE noisia_mfp TO noisia_mfp;
\connect noisia_mfp
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
GRANT EXECUTE ON FUNCTION pg_control_system() TO noisia_mfp;
-- Existing migrations reference these Supabase no-login roles. Preserve existing roles.
SELECT format('CREATE ROLE %I NOLOGIN', role) FROM (VALUES ('anon'),('authenticated'),('service_role')) r(role)
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r.role) \gexec
