-- Each study can carry its own image for its page and its card (hero.webp, generated from the
-- study's image brief). It is public, like the cover. Without one the page shows the cover.
-- Additive only.

alter table content.studies add column if not exists hero_path text;

-- Its file sits next to the cover.
alter table content.study_files drop constraint if exists study_files_path_check;
alter table content.study_files add constraint study_files_path_check
  check (path ~ '^(deck/|slides/|pdf/|cover\.webp$|hero\.webp$)' and path !~ '\.\.' and path !~ '//');

-- The views gain the column at the end; `create or replace` keeps their grants.
create or replace view content.published_studies as
  select id, access_mode, industry, market, method, period_label, period_start, period_end,
         base, summary, full_language, cover_path, pdf_path, slide_count, version, published_at, markets, hero_path
  from content.studies
  where status = 'publicado';

create or replace view content.review_studies as
  select id, access_mode, industry, market, method, period_label, period_start, period_end,
         base, summary, full_language, cover_path, pdf_path, slide_count, version, published_at, status, markets, hero_path
  from content.studies
  where status in ('borrador', 'publicado');
