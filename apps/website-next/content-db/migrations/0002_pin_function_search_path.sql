-- Pin the search_path of the trigger function so a role with its own schema on the path
-- cannot shadow what it calls (Supabase security advisor 0011).
alter function content.touch_updated_at() set search_path = pg_catalog, pg_temp;
