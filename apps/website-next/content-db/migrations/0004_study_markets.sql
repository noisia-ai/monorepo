-- A study can read several markets side by side (Black Friday in the UK, Germany, Spain and
-- France). `market` stays as the main one, so nothing that reads it breaks; `markets` holds all of
-- them, the main one first. Additive only.

alter table content.studies add column if not exists markets text[];
update content.studies set markets = array[market] where markets is null;
alter table content.studies alter column markets set not null;
alter table content.studies alter column markets set default array['MX'];
alter table content.studies drop constraint if exists studies_markets_check;
alter table content.studies add constraint studies_markets_check
  check (cardinality(markets) between 1 and 8 and markets[1] = market);

-- The views gain the column at the end; `create or replace` keeps their grants.
create or replace view content.published_studies as
  select id, access_mode, industry, market, method, period_label, period_start, period_end,
         base, summary, full_language, cover_path, pdf_path, slide_count, version, published_at, markets
  from content.studies
  where status = 'publicado';

create or replace view content.review_studies as
  select id, access_mode, industry, market, method, period_label, period_start, period_end,
         base, summary, full_language, cover_path, pdf_path, slide_count, version, published_at, status, markets
  from content.studies
  where status in ('borrador', 'publicado');
