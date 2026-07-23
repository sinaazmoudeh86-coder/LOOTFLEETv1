-- =============================================================================
--  Loot Fleet — ADMIN DASHBOARD backend  (run AFTER schema.sql + payments.sql)
--  Dashboard → SQL Editor → New query → paste this whole file → Run.
--
--  This powers the admin panel on the home page (lootfleet.com/#admin).
--  It adds:
--    purchases    a REAL revenue log (one row per paid Stripe checkout/renewal)
--    page_views   a REAL traffic log (one row per page hit, from js/analytics.js)
--    admin_*()    password-gated, security-definer RPCs that bypass row-level
--                 security to return ALL-user data to the dashboard.
--
--  SECURITY MODEL
--  The home page only ever ships the public ANON key, and every data table is
--  locked by row-level security to "own row only". These admin RPCs run as the
--  function owner (security definer) so they can read everything — but each one
--  first checks the admin password. Change the password in admin_ok() below and
--  it is enforced at the DATABASE level, so the data is safe even though the
--  panel runs in the browser.  >>> CHANGE THE PASSWORD before going live. <<<
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. REAL revenue log.  The stripe-webhook Edge Function writes one row here
--    for every completed checkout / paid renewal (see functions/stripe-webhook).
-- ----------------------------------------------------------------------------
create table if not exists public.purchases (
  id              bigint generated always as identity primary key,
  user_id         uuid references auth.users(id) on delete set null,
  email           text,
  kind            text not null default 'pack',   -- 'pack' | 'pro' | 'pro_renewal'
  sku             text,
  amount_cents    integer not null default 0,
  currency        text not null default 'usd',
  credits         integer,
  stripe_event_id text unique,
  created_at      timestamptz not null default now()
);
alter table public.purchases enable row level security;
-- No policies: only the service role (webhook) writes, only admin RPCs read.
create index if not exists purchases_created_idx on public.purchases(created_at desc);
create index if not exists purchases_user_idx    on public.purchases(user_id);

-- ----------------------------------------------------------------------------
-- 2. REAL traffic log.  js/analytics.js inserts one row per page view using the
--    anon key. Anon may INSERT only — there is no select policy, so visitors
--    can never read traffic; only the admin RPC (security definer) can.
-- ----------------------------------------------------------------------------
create table if not exists public.page_views (
  id          bigint generated always as identity primary key,
  path        text,
  referrer    text,
  visitor_id  text,
  user_id     uuid,
  created_at  timestamptz not null default now()
);
alter table public.page_views enable row level security;

drop policy if exists "page_views_insert_anon" on public.page_views;
create policy "page_views_insert_anon" on public.page_views
  for insert to anon, authenticated with check (true);
-- (intentionally NO select policy)

create index if not exists page_views_created_idx on public.page_views(created_at desc);
create index if not exists page_views_visitor_idx on public.page_views(visitor_id);

-- ----------------------------------------------------------------------------
-- 3. Admin password gate.   >>>>>  CHANGE THIS PASSWORD  <<<<<
-- ----------------------------------------------------------------------------
create or replace function public.admin_ok(p_pw text)
returns boolean language sql immutable as $$
  select p_pw = '20042004';
$$;

-- ----------------------------------------------------------------------------
-- 4. OVERVIEW — every headline metric in one call.
-- ----------------------------------------------------------------------------
create or replace function public.admin_overview(p_pw text)
returns json language plpgsql security definer set search_path = public, auth as $$
declare r json;
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  select json_build_object(
    'total_users',         (select count(*) from auth.users),
    'users_today',         (select count(*) from auth.users where created_at >= now() - interval '24 hours'),
    'users_7d',            (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'users_30d',           (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'active_7d',           (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'active_24h',          (select count(*) from auth.users where last_sign_in_at >= now() - interval '24 hours'),
    'total_saves',         (select count(*) from public.saves),
    'pro_active',          (select count(*) from public.wallets where pro_until > now()),
    'revenue_total_cents', (select coalesce(sum(amount_cents),0) from public.purchases),
    'revenue_30d_cents',   (select coalesce(sum(amount_cents),0) from public.purchases where created_at >= now() - interval '30 days'),
    'revenue_today_cents', (select coalesce(sum(amount_cents),0) from public.purchases where created_at >= now() - interval '24 hours'),
    'orders_total',        (select count(*) from public.purchases),
    'paying_users',        (select count(distinct user_id) from public.purchases where user_id is not null),
    'views_total',         (select count(*) from public.page_views),
    'views_today',         (select count(*) from public.page_views where created_at >= now() - interval '24 hours'),
    'views_7d',            (select count(*) from public.page_views where created_at >= now() - interval '7 days'),
    'visitors_today',      (select count(distinct visitor_id) from public.page_views where created_at >= now() - interval '24 hours'),
    'visitors_7d',         (select count(distinct visitor_id) from public.page_views where created_at >= now() - interval '7 days'),
    'visitors_total',      (select count(distinct visitor_id) from public.page_views)
  ) into r;
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- 5. USERS — joined with their save, wallet, and lifetime spend.
-- ----------------------------------------------------------------------------
create or replace function public.admin_users(p_pw text, p_limit int default 200, p_offset int default 0)
returns table (
  user_id uuid, email text, joined timestamptz, last_seen timestamptz,
  provider text, name text, level int, zone int, kills bigint,
  credits int, pro_until timestamptz, spent_cents bigint, orders bigint
) language plpgsql security definer set search_path = public, auth as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  return query
  select
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    coalesce(u.raw_app_meta_data->>'provider', 'email'),
    coalesce(nullif(s.data->>'name',''), split_part(coalesce(u.email,'operator'),'@',1)),
    nullif(s.data->>'level','')::int,
    nullif(s.data->>'highestDungeonReached','')::int,
    nullif(s.data->>'totalKills','')::bigint,
    w.credits,
    w.pro_until,
    coalesce(p.spent, 0),
    coalesce(p.orders, 0)
  from auth.users u
  left join public.saves   s on s.user_id = u.id
  left join public.wallets w on w.user_id = u.id
  left join (
    select user_id, sum(amount_cents) as spent, count(*) as orders
    from public.purchases where user_id is not null group by user_id
  ) p on p.user_id = u.id
  order by u.created_at desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end $$;

-- ----------------------------------------------------------------------------
-- 6. PURCHASES — recent orders.
-- ----------------------------------------------------------------------------
create or replace function public.admin_purchases(p_pw text, p_limit int default 100)
returns table (
  id bigint, email text, kind text, sku text,
  amount_cents int, credits int, created_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  return query
  select pu.id, pu.email, pu.kind, pu.sku, pu.amount_cents, pu.credits, pu.created_at
  from public.purchases pu
  order by pu.created_at desc
  limit greatest(p_limit, 1);
end $$;

-- ----------------------------------------------------------------------------
-- 7. TRAFFIC — daily series + top pages + top referrers.
-- ----------------------------------------------------------------------------
create or replace function public.admin_traffic(p_pw text, p_days int default 30)
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  select json_build_object(
    'daily', (
      select coalesce(json_agg(row_to_json(d) order by d.day), '[]'::json) from (
        select date_trunc('day', created_at)::date as day,
               count(*) as views,
               count(distinct visitor_id) as visitors
        from public.page_views
        where created_at >= now() - make_interval(days => greatest(p_days,1))
        group by 1
      ) d
    ),
    'top_paths', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select coalesce(path,'/') as path, count(*) as views
        from public.page_views
        where created_at >= now() - make_interval(days => greatest(p_days,1))
        group by 1 order by 2 desc limit 12
      ) t
    ),
    'top_referrers', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select case
                 when referrer is null or referrer = '' then '(direct)'
                 else regexp_replace(regexp_replace(referrer, '^https?://(www\.)?', ''), '/.*$', '')
               end as source,
               count(*) as views
        from public.page_views
        where created_at >= now() - make_interval(days => greatest(p_days,1))
        group by 1 order by 2 desc limit 12
      ) t
    )
  ) into r;
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- 8. Permissions. The home page calls these with the ANON key; the password
--    check inside each function is the real gate.
-- ----------------------------------------------------------------------------
revoke execute on function public.admin_overview(text)            from public;
revoke execute on function public.admin_users(text, int, int)     from public;
revoke execute on function public.admin_purchases(text, int)      from public;
revoke execute on function public.admin_traffic(text, int)        from public;

grant execute on function public.admin_overview(text)            to anon, authenticated;
grant execute on function public.admin_users(text, int, int)     to anon, authenticated;
grant execute on function public.admin_purchases(text, int)      to anon, authenticated;
grant execute on function public.admin_traffic(text, int)        to anon, authenticated;
