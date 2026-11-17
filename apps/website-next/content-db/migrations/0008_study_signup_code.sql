-- The sign-up for a `registro` study now checks the email: the form sends a 4-digit code to it and
-- the study opens when the reader types the code. Until then nothing reaches access_links, so the
-- list of leads only holds verified emails; the attempts that never got verified stay here.
--
-- The browser that asked for the code keeps a pending secret in a short cookie. The code is stored
-- hashed together with that secret, so a code on its own is worthless and the cookie on its own
-- opens nothing. Five wrong codes lock that sign-up; the reader asks for a new code.

create table if not exists content.study_signups (
  id uuid primary key default gen_random_uuid(),
  study_id text not null references content.studies (id) on delete cascade,
  pending_hash text not null unique check (pending_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts smallint not null default 0,
  name text not null,
  email text not null,
  company text not null,
  marketing_opt_in boolean not null default false,
  lang text check (lang in ('es', 'en')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  link_id uuid references content.access_links (id) on delete set null
);
create index if not exists study_signups_email_idx on content.study_signups (study_id, lower(email), created_at);

-- A new sign-up waiting for its code. Returns false when the study does not take sign-ups or the
-- same email asked for codes too many times in the last hour.
create or replace function content.start_signup(
  p_study text, p_pending_hash text, p_code_hash text, p_name text, p_email text, p_company text, p_marketing boolean, p_lang text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text;
  v_mode text;
  v_recent integer;
begin
  if p_pending_hash !~ '^[0-9a-f]{64}$'
     or p_code_hash !~ '^[0-9a-f]{64}$'
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
  from content.study_signups
  where study_id = p_study and lower(email) = lower(btrim(p_email)) and created_at > now() - interval '1 hour';
  if v_recent >= 6 then
    return false;
  end if;
  insert into content.study_signups (study_id, pending_hash, code_hash, name, email, company, marketing_opt_in, lang, expires_at)
  values (p_study, p_pending_hash, p_code_hash, btrim(p_name), lower(btrim(p_email)), btrim(p_company),
          coalesce(p_marketing, false), case when p_lang in ('es', 'en') then p_lang end, now() + interval '30 minutes');
  return true;
end
$$;

-- Checks a code. On the right code the sign-up becomes a personal link (source 'registro') with
-- p_token_hash, the token the site puts in the reader's cookies, and the person comes back so the
-- site can email them the link. status: ok | wrong | locked | expired.
create or replace function content.verify_signup(p_study text, p_pending_hash text, p_code_hash text, p_token_hash text)
returns table (status text, name text, email text, company text, marketing boolean, lang text)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_signup content.study_signups%rowtype;
  v_link uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'expired'::text, null::text, null::text, null::text, null::boolean, null::text;
    return;
  end if;
  select * into v_signup from content.study_signups s
  where s.pending_hash = p_pending_hash and s.study_id = p_study
  for update;
  if v_signup.id is null or v_signup.verified_at is not null or v_signup.expires_at < now() then
    return query select 'expired'::text, null::text, null::text, null::text, null::boolean, null::text;
    return;
  end if;
  if v_signup.attempts >= 5 then
    return query select 'locked'::text, null::text, null::text, null::text, null::boolean, null::text;
    return;
  end if;
  if v_signup.code_hash <> p_code_hash then
    update content.study_signups s set attempts = s.attempts + 1 where s.id = v_signup.id;
    return query select (case when v_signup.attempts + 1 >= 5 then 'locked' else 'wrong' end)::text,
                        null::text, null::text, null::text, null::boolean, null::text;
    return;
  end if;
  insert into content.access_links (study_id, token_hash, source, recipient_name, recipient_email, recipient_company,
                                    sent_by, expires_at, marketing_opt_in, lang)
  values (p_study, p_token_hash, 'registro', v_signup.name, v_signup.email, v_signup.company,
          'registro', now() + interval '365 days', v_signup.marketing_opt_in, v_signup.lang)
  returning id into v_link;
  update content.study_signups s set verified_at = now(), link_id = v_link where s.id = v_signup.id;
  return query select 'ok'::text, v_signup.name, v_signup.email, v_signup.company, v_signup.marketing_opt_in, v_signup.lang;
end
$$;

revoke all on content.study_signups from public;
revoke all on function content.start_signup(text, text, text, text, text, text, boolean, text),
                       content.verify_signup(text, text, text, text) from public;
grant execute on function content.start_signup(text, text, text, text, text, text, boolean, text),
                          content.verify_signup(text, text, text, text) to website_runtime, website_review;

