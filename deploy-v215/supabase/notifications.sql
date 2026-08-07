-- =============================================================================
-- notifications.sql — daily brief by email
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- Scope: EMAIL ONLY. The phone / push columns are deliberately absent — adding
-- them later is a migration, not a rewrite. See NOTIFICATIONS-ARCHITECTURE.md.
-- =============================================================================

-- ---- 1. preferences + consent record ---------------------------------------
create table if not exists notify_prefs (
  user_id      uuid primary key references auth.users on delete cascade,
  email        text,
  email_ok     boolean     not null default false,   -- the master switch
  digest       text        not null default 'daily',  -- daily | weekly | off
  send_hour    smallint    not null default 8,        -- 0-23, player's LOCAL time
  tz           text        not null default 'UTC',
  quiet        boolean     not null default true,     -- suppress 22:00-08:00 local
  unsub_token  text        not null default encode(gen_random_bytes(16), 'hex'),
  consent_at   timestamptz,
  consent_text text,                                  -- exact wording agreed to
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint notify_digest_valid check (digest in ('daily','weekly','off')),
  constraint notify_hour_valid   check (send_hour between 0 and 23)
);
create index if not exists notify_prefs_due_idx on notify_prefs (email_ok, digest, send_hour);
create unique index if not exists notify_prefs_unsub_idx on notify_prefs (unsub_token);

-- ---- 2. daily frozen stats — the diff between two rows IS the brief --------
create table if not exists notify_snapshots (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  stats   jsonb not null,
  primary key (user_id, day)
);
create index if not exists notify_snap_day_idx on notify_snapshots (day);

-- ---- 3. append-only event log (war reports, tile losses, raids) ------------
create table if not exists notify_events (
  id      bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind    text not null,          -- tile_lost | attacked | raid | rank | season
  payload jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now(),
  sent    boolean not null default false
);
create index if not exists notify_events_pending_idx on notify_events (user_id, sent, at);

-- ---- 4. delivery log — the primary key IS the anti-duplicate story ---------
create table if not exists notify_log (
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,       -- digest
  day         date not null,
  channel     text not null,       -- email
  status      text not null,       -- skipped | dryrun | queued | sent | bounced | failed
  reason      text,                -- why skipped, or provider error
  provider_id text,
  payload     jsonb,               -- what we would have sent (dry-run inspection)
  at          timestamptz not null default now(),
  primary key (user_id, kind, day, channel)
);
create index if not exists notify_log_day_idx on notify_log (day, status);

-- ---- 5. hard stop list — checked before every send -------------------------
create table if not exists notify_suppress (
  addr   text primary key,         -- lowercased email
  reason text not null,            -- bounce | complaint | unsub | manual
  at     timestamptz not null default now()
);

-- ---- RLS: a player sees ONLY their own prefs. Everything else is server-only.
alter table notify_prefs     enable row level security;
alter table notify_snapshots enable row level security;
alter table notify_events    enable row level security;
alter table notify_log       enable row level security;
alter table notify_suppress  enable row level security;

drop policy if exists notify_prefs_own on notify_prefs;
create policy notify_prefs_own on notify_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- no policies on the other four → service-role access only

-- ---- upsert prefs from the client (single safe entry point) ----------------
create or replace function notify_save_prefs(
  p_email_ok boolean, p_digest text, p_hour smallint, p_tz text, p_consent text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select email into v_email from auth.users where id = v_uid;

  insert into notify_prefs (user_id, email, email_ok, digest, send_hour, tz,
                            consent_at, consent_text)
  values (v_uid, lower(v_email), coalesce(p_email_ok, false),
          coalesce(p_digest, 'daily'), coalesce(p_hour, 8), coalesce(p_tz, 'UTC'),
          case when p_email_ok then now() else null end, p_consent)
  on conflict (user_id) do update set
    email        = lower(v_email),
    email_ok     = coalesce(p_email_ok, notify_prefs.email_ok),
    digest       = coalesce(p_digest, notify_prefs.digest),
    send_hour    = coalesce(p_hour, notify_prefs.send_hour),
    tz           = coalesce(p_tz, notify_prefs.tz),
    -- consent is recorded on the transition OFF → ON and never overwritten after
    consent_at   = case when p_email_ok and not notify_prefs.email_ok then now()
                        else notify_prefs.consent_at end,
    consent_text = case when p_email_ok and not notify_prefs.email_ok then p_consent
                        else notify_prefs.consent_text end,
    updated_at   = now();

  -- turning it back on clears an earlier unsubscribe
  if p_email_ok then delete from notify_suppress where addr = lower(v_email); end if;

  return jsonb_build_object('ok', true);
end $$;
revoke all on function notify_save_prefs(boolean, text, smallint, text, text) from public;
grant execute on function notify_save_prefs(boolean, text, smallint, text, text) to authenticated;

create or replace function notify_get_prefs()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(
    (select to_jsonb(p) - 'unsub_token' from notify_prefs p where p.user_id = auth.uid()),
    '{"email_ok":false,"digest":"daily","send_hour":8}'::jsonb)
$$;
revoke all on function notify_get_prefs() from public;
grant execute on function notify_get_prefs() to authenticated;

-- ---- who is due RIGHT NOW? ---------------------------------------------------
-- Called hourly by digest-build. Timezone maths stays in Postgres, which is the
-- only place that knows every zone's current offset. Also hands over the save
-- row and yesterday's snapshot so the function makes ONE round trip per user.
create or replace function notify_due(p_limit int default 500)
returns table (
  user_id uuid, email text, tz text, unsub_token text, digest text,
  save jsonb, save_at timestamptz, prev jsonb, prev_day date
) language sql security definer set search_path = public as $$
  with due as (
    select p.* from notify_prefs p
    where p.email_ok
      and p.digest <> 'off'
      and p.email is not null
      and extract(hour from (now() at time zone p.tz))::int = p.send_hour
      and (p.digest = 'daily'
           or extract(dow from (now() at time zone p.tz))::int = 1)   -- weekly → Monday
      and not exists (select 1 from notify_suppress s where s.addr = p.email)
      and not exists (
        select 1 from notify_log l
        where l.user_id = p.user_id and l.kind = 'digest' and l.channel = 'email'
          and l.day = (now() at time zone p.tz)::date
          and l.status in ('sent','queued','dryrun','skipped'))
  )
  select d.user_id, d.email, d.tz, d.unsub_token, d.digest,
         s.data, s.updated_at,
         sn.stats, sn.day
  from due d
  join saves s on s.user_id = d.user_id
  left join lateral (
    select stats, day from notify_snapshots
    where user_id = d.user_id order by day desc limit 1
  ) sn on true
  limit p_limit
$$;
revoke all on function notify_due(int) from public;

-- ---- one-click unsubscribe (called by the Edge Function, no auth) -----------
create or replace function notify_unsub(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  update notify_prefs set email_ok = false, digest = 'off', updated_at = now()
  where unsub_token = p_token returning email into v_email;
  if v_email is null then return jsonb_build_object('ok', false); end if;
  insert into notify_suppress (addr, reason) values (v_email, 'unsub')
  on conflict (addr) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function notify_unsub(text) from public;

-- ---- global galaxy stats for the day (computed once, shared by everyone) ----
create or replace function notify_galaxy_stats()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'top',        (select jsonb_agg(jsonb_build_object('name', name, 'power', power) order by power desc)
                   from (select name, power from leaderboard order by power desc limit 3) t),
    'players',    (select count(*) from leaderboard),
    'tiles_held', (select count(*) from territory),
    'day',        (now() at time zone 'UTC')::date)
$$;
revoke all on function notify_galaxy_stats() from public;

-- ---- 6. HOURLY CRON --------------------------------------------------------
-- Hourly, not daily: each run picks only the players whose LOCAL send_hour is
-- now. One schedule covers every timezone, spreads provider load over 24h, and
-- a failed run costs 1/24 of players instead of all of them.
--
-- Replace <PROJECT-REF> and <SERVICE-ROLE-KEY>, then uncomment.
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.unschedule('lf-digest') where exists (select 1 from cron.job where jobname='lf-digest');
-- select cron.schedule('lf-digest', '0 * * * *', $CRON$
--   select net.http_post(
--     url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/digest-build',
--     headers := jsonb_build_object('Content-Type','application/json',
--                                   'Authorization','Bearer <SERVICE-ROLE-KEY>'),
--     body    := '{}'::jsonb)
-- $CRON$);
