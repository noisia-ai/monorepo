-- Noisia website content: studies and Insights pieces.
-- Lives in its own Supabase project (never the Studio database). Forward-only.
-- The `content` schema is not exposed through the Supabase REST API; the site and the
-- load scripts connect with their own Postgres roles.

create schema if not exists content;
revoke all on schema content from public;

-- website_runtime: what the public site uses. Reads only what is published.
-- website_review: what UAT uses. Reads published and drafts, so a study can be reviewed.
-- content_admin: what the load and publish scripts use. Writes content.
-- Both are created without login; the owner gives each a password out of band.
do $$
begin
  if not exists (select from pg_roles where rolname = 'website_runtime') then
    create role website_runtime nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'website_review') then
    create role website_review nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'content_admin') then
    create role content_admin nologin;
  end if;
end
$$;

grant usage on schema content to website_runtime, website_review, content_admin;

create or replace function content.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- A marketing study (industry or brand-agnostic). Client studies never go here.
create table if not exists content.studies (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  status text not null default 'borrador' check (status in ('borrador', 'publicado', 'retirado')),
  access_mode text not null default 'abierto' check (access_mode in ('abierto', 'registro', 'solo_link')),
  industry text not null,
  market text not null default 'MX',
  method text,
  period_label text,
  period_start date,
  period_end date,
  -- { mentions, channels: [...], cut_date }
  base jsonb not null default '{}'::jsonb,
  -- { es: { title, dek, findings, stats, quote, method_note }, en: { ... } }
  summary jsonb not null default '{}'::jsonb,
  full_language text not null default 'es' check (full_language in ('es', 'en')),
  cover_path text,
  deck_path text,
  pdf_path text,
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One Insights piece. `payload` is the story validated by src/content/stories/schema.ts.
create table if not exists content.stories (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  study_id text references content.studies (id) on delete restrict,
  status text not null default 'borrador' check (status in ('borrador', 'publicado', 'retirado')),
  format text not null default 'animada' check (format in ('animada', 'video')),
  position integer not null default 0,
  payload jsonb not null,
  -- How each figure was derived. Never served by the site.
  notes text,
  video_path text,
  poster_path text,
  transcript text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (format = 'animada' or video_path is not null),
  check (payload ->> 'id' = id)
);

create index if not exists stories_status_position_idx on content.stories (status, position);
create index if not exists stories_study_idx on content.stories (study_id);

drop trigger if exists studies_touch on content.studies;
create trigger studies_touch before update on content.studies
  for each row execute function content.touch_updated_at();
drop trigger if exists stories_touch on content.stories;
create trigger stories_touch before update on content.stories
  for each row execute function content.touch_updated_at();

-- What the site may read. Views run with the owner's rights, so website_runtime needs no
-- grant on the tables themselves and never sees drafts or notes.
create or replace view content.published_stories as
  select id, study_id, format, position, payload, video_path, poster_path, transcript, published_at
  from content.stories
  where status = 'publicado';

create or replace view content.published_studies as
  select id, access_mode, industry, market, method, period_label, period_start, period_end,
         base, summary, full_language, cover_path, version, published_at
  from content.studies
  where status = 'publicado';

-- UAT shows drafts too, so a study can be reviewed before it goes live.
create or replace view content.review_stories as
  select id, study_id, format, position, payload, video_path, poster_path, transcript, published_at, status
  from content.stories
  where status in ('borrador', 'publicado');

revoke all on all tables in schema content from public;
grant select on content.published_stories, content.published_studies to website_runtime;
grant select on content.published_stories, content.published_studies, content.review_stories to website_review;
grant select, insert, update, delete on content.studies, content.stories to content_admin;
grant select on content.published_stories, content.published_studies, content.review_stories to content_admin;

create table if not exists content.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
grant select on content.schema_migrations to content_admin;
