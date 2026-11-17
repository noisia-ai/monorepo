-- Self-service unlock for `registro` studies: the reader leaves name, email and company in the
-- viewer and the study opens at once. Each sign-up becomes a personal link (source 'registro')
-- whose token the site keeps in two cookies: one for that study and one that remembers the reader,
-- so the next `registro` study opens without asking again.
--
-- The site still never reads the links table: it calls these functions, which check the study is
-- published (or a draft, for the review role) and that its mode is `registro`.

alter table content.access_links add column if not exists marketing_opt_in boolean not null default false;
alter table content.access_links add column if not exists lang text check (lang in ('es', 'en'));
create index if not exists access_links_study_email_idx on content.access_links (study_id, lower(recipient_email));

-- A new sign-up. Returns false when the study is not open to sign-ups or the same email signed up
-- for it too many times in the last hour (a script, not a person).
create or replace function content.register_for_study(
  p_study text, p_token_hash text, p_name text, p_email text, p_company text, p_marketing boolean, p_lang text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text;
  v_mode text;
  v_recent integer;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or length(btrim(coalesce(p_email, ''))) not between 3 and 200
     or btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(btrim(coalesce(p_company, ''))) not between 1 and 160 then
    return false;
  end if;
  select status, access_mode into v_status, v_mode from content.studies where id = p_study;
  if v_mode is distinct from 'registro'
     or not (v_status = 'publicado' or (v_status = 'borrador' and session_user = 'website_review')) then
    return false;
  end if;
  select count(*) into v_recent
  from content.access_links
  where study_id = p_study and lower(recipient_email) = lower(btrim(p_email)) and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    return false;
  end if;
  insert into content.access_links (study_id, token_hash, source, recipient_name, recipient_email, recipient_company,
                                    sent_by, expires_at, marketing_opt_in, lang)
  values (p_study, p_token_hash, 'registro', btrim(p_name), lower(btrim(p_email)), btrim(p_company),
          'registro', now() + interval '365 days', coalesce(p_marketing, false),
          case when p_lang in ('es', 'en') then p_lang end);
  return true;
end
$$;

-- Whether a remembered reader (the token of any of their sign-ups) is still valid.
create or replace function content.reader_valid(p_reader_hash text) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from content.access_links
    where token_hash = p_reader_hash and source = 'registro' and revoked_at is null and expires_at > now()
  )
$$;

-- A remembered reader opens another `registro` study: the study gets its own link for that reader
-- (created once, with p_new_hash) and the open is counted on it, as with any personal link.
create or replace function content.reader_open(p_study text, p_reader_hash text, p_new_hash text) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text;
  v_mode text;
  v_reader content.access_links%rowtype;
  v_link uuid;
begin
  select status, access_mode into v_status, v_mode from content.studies where id = p_study;
  if v_mode is distinct from 'registro'
     or not (v_status = 'publicado' or (v_status = 'borrador' and session_user = 'website_review')) then
    return false;
  end if;
  select * into v_reader from content.access_links
  where token_hash = p_reader_hash and source = 'registro' and revoked_at is null and expires_at > now();
  if v_reader.id is null then
    return false;
  end if;
  select id into v_link from content.access_links
  where study_id = p_study and source = 'registro' and lower(recipient_email) = lower(v_reader.recipient_email)
    and revoked_at is null and expires_at > now()
  order by created_at desc limit 1;
  if v_link is null then
    if p_new_hash !~ '^[0-9a-f]{64}$' then
      return false;
    end if;
    insert into content.access_links (study_id, token_hash, source, recipient_name, recipient_email, recipient_company,
                                      sent_by, expires_at, marketing_opt_in, lang)
    values (p_study, p_new_hash, 'registro', v_reader.recipient_name, v_reader.recipient_email, v_reader.recipient_company,
            'registro', now() + interval '365 days', v_reader.marketing_opt_in, v_reader.lang)
    returning id into v_link;
  end if;
  update content.access_links
     set open_count = open_count + 1, first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now()
   where id = v_link;
  insert into content.access_events (study_id, link_id, kind) values (p_study, v_link, 'open');
  return true;
end
$$;

revoke all on function content.register_for_study(text, text, text, text, text, boolean, text),
                       content.reader_valid(text),
                       content.reader_open(text, text, text) from public;
grant execute on function content.register_for_study(text, text, text, text, text, boolean, text),
                          content.reader_valid(text),
                          content.reader_open(text, text, text) to website_runtime, website_review;
