-- Stage 2: the full study (deck, slide images, PDF, cover), personal links and access events.
-- Forward-only. Files live in the database rather than in Supabase Storage so the site needs no
-- extra key: website_runtime reads the files of published studies through a view, like the rest.

alter table content.studies add column if not exists slide_count integer not null default 0;

-- Every file of one version of a study. Paths are namespaced:
--   deck/<path>       the builder folder as delivered (index.html, css, deck-stage.js, assets)
--   slides/<nn>.webp  one image per slide, for the phone view
--   pdf/<name>.pdf    the downloadable PDF
--   cover.webp        the public cover (index cards, study page, Open Graph)
create table if not exists content.study_files (
  study_id text not null references content.studies (id) on delete cascade,
  version integer not null,
  path text not null check (path ~ '^(deck/|slides/|pdf/|cover\.webp$)' and path !~ '\.\.' and path !~ '//'),
  content_type text not null,
  bytes bytea not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  primary key (study_id, version, path)
);

-- One personal link. The token itself is never stored, only its SHA-256.
create table if not exists content.access_links (
  id uuid primary key default gen_random_uuid(),
  study_id text not null references content.studies (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  source text not null default 'personal' check (source in ('personal', 'registro')),
  recipient_name text,
  recipient_email text,
  recipient_company text,
  sent_by text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists access_links_study_idx on content.access_links (study_id);

-- What happened: someone saw the page, opened the full study or downloaded the PDF.
create table if not exists content.access_events (
  id bigint generated always as identity primary key,
  study_id text not null references content.studies (id) on delete cascade,
  link_id uuid references content.access_links (id) on delete set null,
  kind text not null check (kind in ('page', 'open', 'pdf')),
  at timestamptz not null default now()
);
create index if not exists access_events_study_idx on content.access_events (study_id, at);

-- The published view gains the columns the study pages need.
drop view if exists content.published_studies;
create view content.published_studies as
  select id, access_mode, industry, market, method, period_label, period_start, period_end,
         base, summary, full_language, cover_path, pdf_path, slide_count, version, published_at
  from content.studies
  where status = 'publicado';

-- UAT reviews draft studies too.
create or replace view content.review_studies as
  select id, access_mode, industry, market, method, period_label, period_start, period_end,
         base, summary, full_language, cover_path, pdf_path, slide_count, version, published_at, status
  from content.studies
  where status in ('borrador', 'publicado');

-- Files of the current version of each visible study. The site checks access before serving any
-- of them except the cover; the views only decide which studies are visible at all.
create or replace view content.published_study_files as
  select f.study_id, f.path, f.content_type, f.bytes, f.sha256
  from content.study_files f
  join content.studies s on s.id = f.study_id and s.version = f.version
  where s.status = 'publicado';

create or replace view content.review_study_files as
  select f.study_id, f.path, f.content_type, f.bytes, f.sha256
  from content.study_files f
  join content.studies s on s.id = f.study_id and s.version = f.version
  where s.status in ('borrador', 'publicado');

-- Which study a personal link opens, or null if it is unknown, expired or revoked. The site never
-- reads access_links; it asks through these two functions. UAT (website_review) may open drafts.
create or replace function content.link_study(p_token_hash text) returns text
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select l.study_id
  from content.access_links l
  join content.studies s on s.id = l.study_id
  where l.token_hash = p_token_hash
    and l.revoked_at is null
    and l.expires_at > now()
    and (s.status = 'publicado' or (s.status = 'borrador' and session_user = 'website_review'))
$$;

-- Records an event. With a token, the link must belong to the study (an `open` also updates the
-- link's counters); without one, only studies in `abierto` mode record anonymous events.
-- Returns whether the access was valid.
create or replace function content.record_event(p_study text, p_token_hash text, p_kind text) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text;
  v_mode text;
  v_link uuid;
begin
  if p_kind not in ('page', 'open', 'pdf') then
    raise exception 'unknown event kind %', p_kind;
  end if;
  select status, access_mode into v_status, v_mode from content.studies where id = p_study;
  if v_status is null or not (v_status = 'publicado' or (v_status = 'borrador' and session_user = 'website_review')) then
    return false;
  end if;
  if p_token_hash is not null then
    select id into v_link
    from content.access_links
    where token_hash = p_token_hash and study_id = p_study and revoked_at is null and expires_at > now();
    if v_link is null then
      return false;
    end if;
    if p_kind = 'open' then
      update content.access_links
         set open_count = open_count + 1,
             first_opened_at = coalesce(first_opened_at, now()),
             last_opened_at = now()
       where id = v_link;
    end if;
  elsif v_mode <> 'abierto' then
    return false;
  end if;
  insert into content.access_events (study_id, link_id, kind) values (p_study, v_link, p_kind);
  return true;
end
$$;

revoke all on content.study_files, content.access_links, content.access_events from public;
revoke all on content.published_studies, content.review_studies, content.published_study_files, content.review_study_files from public;
revoke all on function content.link_study(text), content.record_event(text, text, text) from public;

grant select on content.published_studies, content.published_study_files to website_runtime;
grant select on content.published_studies, content.review_studies, content.published_study_files, content.review_study_files to website_review;
grant execute on function content.link_study(text), content.record_event(text, text, text) to website_runtime, website_review;

grant select on content.published_studies, content.review_studies to content_admin;
grant select, insert, update, delete on content.study_files, content.access_links to content_admin;
grant select on content.access_events to content_admin;
