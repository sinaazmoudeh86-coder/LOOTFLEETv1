-- =============================================================================
--  Loot Fleet — SOCIAL: Friends & Alliances
--  Run in Supabase: Dashboard → SQL Editor → New query → Run. Safe to re-run.
--  Trust model matches saves/leaderboard: identity is ALWAYS auth.uid();
--  currencies that cross accounts (Friendship Points, Alliance Coins, boss HP,
--  alliance XP) live server-side and move only through the RPCs below.
-- =============================================================================

-- ---- wallets: social currencies (server-authoritative) ----------------------
create table if not exists public.social_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fp bigint not null default 0,        -- ♥ Friendship Points
  ac bigint not null default 0,        -- ⬡ Alliance Coins
  updated_at timestamptz not null default now()
);
alter table public.social_wallets enable row level security;
drop policy if exists "sw_read_own" on public.social_wallets;
create policy "sw_read_own" on public.social_wallets for select using (auth.uid() = user_id);

create or replace function public._sw_credit(uid uuid, d_fp bigint, d_ac bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.social_wallets(user_id, fp, ac) values (uid, greatest(0,d_fp), greatest(0,d_ac))
  on conflict (user_id) do update set fp = social_wallets.fp + greatest(0,d_fp), ac = social_wallets.ac + greatest(0,d_ac), updated_at = now();
end; $$;

create or replace function public.social_wallet()
returns public.social_wallets language plpgsql security definer set search_path = public as $$
declare w public.social_wallets;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.social_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from public.social_wallets where user_id = auth.uid();
  return w;
end; $$;
grant execute on function public.social_wallet() to authenticated;

-- spend: returns new balance or raises. kind: 'fp' | 'ac'
create or replace function public.social_spend(p_kind text, p_amount bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare bal bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  insert into public.social_wallets(user_id) values (auth.uid()) on conflict do nothing;
  if p_kind = 'fp' then
    update public.social_wallets set fp = fp - p_amount, updated_at = now()
      where user_id = auth.uid() and fp >= p_amount returning fp into bal;
  elsif p_kind = 'ac' then
    update public.social_wallets set ac = ac - p_amount, updated_at = now()
      where user_id = auth.uid() and ac >= p_amount returning ac into bal;
  else raise exception 'bad kind'; end if;
  if bal is null then raise exception 'insufficient'; end if;
  return bal;
end; $$;
grant execute on function public.social_spend(text, bigint) to authenticated;

-- ---- friendships -------------------------------------------------------------
-- one row per pair, canonical order (a < b). status: 'pending' | 'accepted'.
create table if not exists public.friendships (
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  requester uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table public.friendships enable row level security;
drop policy if exists "fr_read_own" on public.friendships;
create policy "fr_read_own" on public.friendships for select using (auth.uid() = a or auth.uid() = b);

create or replace function public.friend_request(p_target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lo uuid; hi uuid; n int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_target is null or p_target = me then raise exception 'bad target'; end if;
  if not exists (select 1 from public.leaderboard where user_id = p_target) then raise exception 'no such pilot'; end if;
  select count(*) into n from public.friendships where (a = me or b = me) and status = 'accepted';
  if n >= 20 then raise exception 'friend list full'; end if;
  lo := least(me, p_target); hi := greatest(me, p_target);
  insert into public.friendships(a, b, requester) values (lo, hi, me)
  on conflict (a, b) do nothing;
  return coalesce((select status from public.friendships where a = lo and b = hi), 'pending');
end; $$;
grant execute on function public.friend_request(uuid) to authenticated;

create or replace function public.friend_respond(p_other uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lo uuid; hi uuid; n int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  lo := least(me, p_other); hi := greatest(me, p_other);
  if p_accept then
    select count(*) into n from public.friendships where (a = me or b = me) and status = 'accepted';
    if n >= 20 then raise exception 'friend list full'; end if;
    update public.friendships set status = 'accepted' where a = lo and b = hi and requester <> me and status = 'pending';
  else
    delete from public.friendships where a = lo and b = hi;
  end if;
end; $$;
grant execute on function public.friend_respond(uuid, boolean) to authenticated;

create or replace function public.friend_remove(p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.friendships where a = least(auth.uid(), p_other) and b = greatest(auth.uid(), p_other);
end; $$;
grant execute on function public.friend_remove(uuid) to authenticated;

-- friends + pending, joined with public leaderboard stats — one call per open
--
-- NUMERIC power, and dropped first. leaderboard.power is numeric (fleet power passes
-- 1e29 in the late game, far beyond bigint), and a function's return type cannot be
-- changed by CREATE OR REPLACE — running this file over an existing install fails with
-- 42P13 unless the old row type is dropped. Declaring bigint here would also silently
-- re-narrow the column's exposed type and revive the 22P02 error flood.
drop function if exists public.friend_list();
create or replace function public.friend_list()
returns table (user_id uuid, name text, power numeric, level int, zone int, fleet jsonb,
               last_seen timestamptz, status text, requested_by_me boolean)
language sql security definer set search_path = public as $$
  select l.user_id, l.name, l.power, l.level, l.zone, l.fleet, l.updated_at,
         f.status, (f.requester = auth.uid())
  from public.friendships f
  join public.leaderboard l on l.user_id = case when f.a = auth.uid() then f.b else f.a end
  where f.a = auth.uid() or f.b = auth.uid()
  order by f.status desc, l.power desc;
$$;
grant execute on function public.friend_list() to authenticated;

drop function if exists public.pilot_search(text);
create or replace function public.pilot_search(p_q text)
returns table (user_id uuid, name text, power numeric, level int)
language sql security definer set search_path = public as $$
  select user_id, name, power, level from public.leaderboard
  where user_id <> auth.uid() and name ilike '%' || coalesce(p_q,'') || '%'
  order by power desc limit 20;
$$;
grant execute on function public.pilot_search(text) to authenticated;

-- ---- daily hearts ------------------------------------------------------------
create table if not exists public.hearts (
  day date not null,
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  primary key (day, sender, recipient)
);
alter table public.hearts enable row level security;
drop policy if exists "hearts_read_own" on public.hearts;
create policy "hearts_read_own" on public.hearts for select using (auth.uid() = sender or auth.uid() = recipient);

-- send a heart to EVERY accepted friend not yet hearted today: +10 FP each side
create or replace function public.hearts_send_all()
returns int language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); fid uuid; sent int := 0;
begin
  if me is null then raise exception 'not authenticated'; end if;
  for fid in
    select case when a = me then b else a end from public.friendships
    where (a = me or b = me) and status = 'accepted'
  loop
    begin
      insert into public.hearts(day, sender, recipient) values (current_date, me, fid);
      perform public._sw_credit(me, 10, 0);
      perform public._sw_credit(fid, 10, 0);
      sent := sent + 1;
    exception when unique_violation then null;
    end;
  end loop;
  return sent;
end; $$;
grant execute on function public.hearts_send_all() to authenticated;

-- ---- alliances ----------------------------------------------------------------
create table if not exists public.alliances (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tag text not null,
  blurb text not null default '',
  join_mode text not null default 'open',        -- 'open' | 'request'
  leader uuid not null references auth.users(id) on delete cascade,
  xp bigint not null default 0,
  boss_n int not null default 1,
  boss_hp numeric not null default 0,
  boss_max numeric not null default 0,
  week_key text not null default '',
  week_score bigint not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.alliance_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alliance_id uuid not null references public.alliances(id) on delete cascade,
  role text not null default 'member',          -- leader | coleader | elder | member ('officer' = legacy elder)
  contrib bigint not null default 0,            -- this week's contribution
  week_key text not null default '',
  day_key date,
  donated boolean not null default false,
  attacks int not null default 0,
  joined_at timestamptz not null default now()
);
create index if not exists am_alliance_idx on public.alliance_members (alliance_id);
create table if not exists public.alliance_feed (
  id bigserial primary key,
  alliance_id uuid not null references public.alliances(id) on delete cascade,
  user_id uuid,
  name text not null default '',
  kind text not null default 'chat',            -- chat | sys
  txt text not null,
  created_at timestamptz not null default now()
);
create index if not exists af_alliance_idx on public.alliance_feed (alliance_id, id desc);

alter table public.alliances add column if not exists join_mode text not null default 'open';
create table if not exists public.alliance_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,   -- one outstanding request per pilot
  alliance_id uuid not null references public.alliances(id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ar_alliance_idx on public.alliance_requests (alliance_id);
alter table public.alliance_requests enable row level security;
drop policy if exists "ar_read" on public.alliance_requests;
create policy "ar_read" on public.alliance_requests for select
  using (auth.uid() = user_id or exists (select 1 from public.alliance_members m where m.user_id = auth.uid() and m.alliance_id = alliance_requests.alliance_id));

alter table public.alliances enable row level security;
alter table public.alliance_members enable row level security;
alter table public.alliance_feed enable row level security;
drop policy if exists "al_read" on public.alliances;
create policy "al_read" on public.alliances for select using (true);
drop policy if exists "am_read" on public.alliance_members;
create policy "am_read" on public.alliance_members for select using (true);
drop policy if exists "af_read_members" on public.alliance_feed;
create policy "af_read_members" on public.alliance_feed for select
  using (exists (select 1 from public.alliance_members m where m.user_id = auth.uid() and m.alliance_id = alliance_feed.alliance_id));

create or replace function public._al_week() returns text language sql stable as
$$ select to_char(now(), 'IYYY-IW') $$;

create or replace function public._al_feed(aid uuid, k text, t text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.alliance_feed(alliance_id, user_id, name, kind, txt)
  values (aid, null, '', k, left(t, 160));
  delete from public.alliance_feed where alliance_id = aid and id < (
    select min(id) from (select id from public.alliance_feed where alliance_id = aid order by id desc limit 80) keep);
end; $$;

-- fresh boss HP: anchored to the ALLIANCE's real strength, EXPONENTIAL in the
-- mark — every level is ×1.55 the last. The ×200 anchor means one MAX attack
-- (25× a member's power) is ~1/8 of Mk-1: a level is a genuine group grind,
-- never the one-shot it used to be when the anchor matched the damage cap.
-- anchor_min lets a caller floor the anchor to the LIVE attacker power so a
-- stale/low leaderboard sum can't collapse the boss to the hard floor.
drop function if exists public._al_boss_hp(uuid, int);
create or replace function public._al_boss_hp(aid uuid, n int, anchor_min numeric default 0)
returns numeric language sql security definer set search_path = public as $$
  select greatest(5e13,
    greatest(
      coalesce((select sum(l.power)::numeric from public.alliance_members m
        join public.leaderboard l on l.user_id = m.user_id where m.alliance_id = aid), 0),
      greatest(coalesce(anchor_min, 0), 0)
    ) * 200)
    * power(1.55::numeric, greatest(0, n - 1));
$$;

-- ARMADA WEEK — integer week index breaking SUNDAY 00:00 America/Chicago
-- (epoch day 0 = Thursday; +4 shifts the boundary to Sunday; Chicago tz
-- handles CST/CDT automatically)
create or replace function public._al_bweek()
returns int language sql stable as $$
  select floor((extract(epoch from (now() at time zone 'America/Chicago')) / 86400 + 4) / 7)::int;
$$;
grant execute on function public._al_bweek() to authenticated;
alter table public.alliances add column if not exists boss_week int;

-- 24h REJOIN COOLDOWN — set when a member LEAVES voluntarily; blocks joining,
-- requesting, or founding another alliance until it expires. Kicks don't count.
create table if not exists public.alliance_cooldowns (
  user_id uuid primary key references auth.users(id) on delete cascade,
  left_at timestamptz not null default now()
);
alter table public.alliance_cooldowns enable row level security;
create or replace function public._al_cooldown_check(u uuid)
returns void language plpgsql security definer set search_path = public as $$
declare la timestamptz; hrs int;
begin
  select left_at into la from public.alliance_cooldowns where user_id = u;
  if la is null then return; end if;
  if la + interval '24 hours' <= now() then
    delete from public.alliance_cooldowns where user_id = u;   -- expired — clean up
    return;
  end if;
  hrs := ceil(extract(epoch from (la + interval '24 hours' - now())) / 3600)::int;
  raise exception 'rejoin cooldown — ~%h until you can join another alliance', hrs;
end; $$;

drop function if exists public.alliance_create(text, text, text);
create or replace function public.alliance_create(p_name text, p_tag text, p_blurb text, p_open boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; nm text; tg text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.alliance_members where user_id = me) then raise exception 'already in an alliance'; end if;
  perform public._al_cooldown_check(me);
  nm := trim(coalesce(p_name,'')); tg := upper(trim(coalesce(p_tag,'')));
  if length(nm) < 3 or length(nm) > 24 then raise exception 'name must be 3-24 chars'; end if;
  if length(tg) < 2 or length(tg) > 4 then raise exception 'tag must be 2-4 chars'; end if;
  if exists (select 1 from public.alliances where lower(name) = lower(nm)) then raise exception 'that name is taken'; end if;
  insert into public.alliances(name, tag, blurb, leader, join_mode)
    values (nm, tg, left(coalesce(p_blurb,''),120), me, case when coalesce(p_open, true) then 'open' else 'request' end)
    returning id into aid;
  insert into public.alliance_members(user_id, alliance_id, role) values (me, aid, 'leader');
  delete from public.alliance_requests where user_id = me;
  update public.alliances set boss_hp = public._al_boss_hp(aid, 1), boss_max = public._al_boss_hp(aid, 1) where id = aid;
  perform public._al_feed(aid, 'sys', '⬡ Alliance founded');
  return aid;
end; $$;
grant execute on function public.alliance_create(text, text, text, boolean) to authenticated;

-- ALLIANCE RENAME · ◈ 1000 LootCoins (charged client-side after this returns).
-- LEADER ONLY. The tag is intentionally NOT renameable: it is what members
-- recognise each other by on the galaxy map and in war.
-- Uniqueness is enforced case-insensitively and excludes the caller's own row so
-- re-casing your own name ("void kings" -> "VOID KINGS") is allowed.
create or replace function public.alliance_rename(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; nm text; old text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'not in an alliance'; end if;
  if not exists (select 1 from public.alliance_members where user_id = me and alliance_id = aid and role = 'leader')
    then raise exception 'only the leader can rename the alliance'; end if;
  nm := trim(coalesce(p_name,''));
  if length(nm) < 3 or length(nm) > 24 then raise exception 'name must be 3-24 chars'; end if;
  select name into old from public.alliances where id = aid;
  if old = nm then raise exception 'that is already the name'; end if;
  if exists (select 1 from public.alliances where lower(name) = lower(nm) and id <> aid)
    then raise exception 'that name is taken'; end if;
  update public.alliances set name = nm where id = aid;
  perform public._al_feed(aid, 'sys', '✎ Renamed from ' || old || ' to ' || nm);
end; $$;
grant execute on function public.alliance_rename(text) to authenticated;

create or replace function public.alliance_join(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; cap int; ax bigint; lv int := 1; need bigint := 0; tot bigint := 0; nm text; jm text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.alliance_members where user_id = me) then raise exception 'already in an alliance'; end if;
  perform public._al_cooldown_check(me);
  select xp, join_mode into ax, jm from public.alliances where id = p_id;
  if ax is null then raise exception 'no such alliance'; end if;
  if jm = 'request' then raise exception 'approval required — send a join request'; end if;
  while lv < 50 loop
    need := (400 * power(lv::numeric, 1.7))::bigint;
    exit when tot + need > ax;
    tot := tot + need; lv := lv + 1;
  end loop;
  cap := least(50, 28 + 2 * (lv - 1));
  select count(*) into n from public.alliance_members where alliance_id = p_id;
  if n >= cap then raise exception 'alliance is full'; end if;
  insert into public.alliance_members(user_id, alliance_id, role) values (me, p_id, 'member');
  delete from public.alliance_requests where user_id = me;
  select name into nm from public.leaderboard where user_id = me;
  perform public._al_feed(p_id, 'sys', '→ ' || coalesce(nm,'A pilot') || ' joined the alliance');
end; $$;
grant execute on function public.alliance_join(uuid) to authenticated;

-- ---- join requests (approval-mode alliances) ---------------------------------
create or replace function public.alliance_request_join(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); jm text; nm text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.alliance_members where user_id = me) then raise exception 'already in an alliance'; end if;
  perform public._al_cooldown_check(me);
  select join_mode into jm from public.alliances where id = p_id;
  if jm is null then raise exception 'no such alliance'; end if;
  if jm = 'open' then raise exception 'this alliance is open — just join'; end if;
  insert into public.alliance_requests(user_id, alliance_id, note) values (me, p_id, left(coalesce(p_note,''), 80))
    on conflict (user_id) do update set alliance_id = excluded.alliance_id, note = excluded.note, created_at = now();
  select name into nm from public.leaderboard where user_id = me;
  perform public._al_feed(p_id, 'sys', '✋ ' || coalesce(nm,'A pilot') || ' requested to join');
end; $$;
grant execute on function public.alliance_request_join(uuid, text) to authenticated;

create or replace function public.alliance_request_cancel()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.alliance_requests where user_id = auth.uid();
end; $$;
grant execute on function public.alliance_request_cancel() to authenticated;

-- where does MY pending request sit? (null when none)
create or replace function public.alliance_my_request()
returns uuid language sql security definer set search_path = public as $$
  select alliance_id from public.alliance_requests where user_id = auth.uid();
$$;
grant execute on function public.alliance_my_request() to authenticated;

-- RANK LADDER -----------------------------------------------------------
-- leader(3) > coleader(2) > elder(1) > member(0). 'officer' = legacy elder.
create or replace function public._al_rank(r text) returns int
immutable language sql as $$
  select case r when 'leader' then 3 when 'coleader' then 2
                when 'elder' then 1 when 'officer' then 1 else 0 end $$;
grant execute on function public._al_rank(text) to authenticated;
-- MIGRATION: legacy 'officer' rows become 'elder'
update public.alliance_members set role = 'elder' where role = 'officer';

-- elder+ verdict on a request. accept → membership (cap-checked).
create or replace function public.alliance_request_respond(p_uid uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; myrole text; raid uuid; n int; cap int; ax bigint; lv int := 1; need bigint := 0; tot bigint := 0; nm text;
begin
  select alliance_id, role into aid, myrole from public.alliance_members where user_id = me;
  if aid is null or public._al_rank(myrole) < 1 then raise exception 'no permission'; end if;
  select alliance_id into raid from public.alliance_requests where user_id = p_uid;
  if raid is null or raid <> aid then raise exception 'request not found'; end if;
  if not p_accept then
    delete from public.alliance_requests where user_id = p_uid;
    return;
  end if;
  if exists (select 1 from public.alliance_members where user_id = p_uid) then
    delete from public.alliance_requests where user_id = p_uid;
    raise exception 'pilot already joined another alliance';
  end if;
  select xp into ax from public.alliances where id = aid;
  while lv < 50 loop
    need := (400 * power(lv::numeric, 1.7))::bigint;
    exit when tot + need > ax;
    tot := tot + need; lv := lv + 1;
  end loop;
  cap := least(50, 28 + 2 * (lv - 1));
  select count(*) into n from public.alliance_members where alliance_id = aid;
  if n >= cap then raise exception 'alliance is full'; end if;
  insert into public.alliance_members(user_id, alliance_id, role) values (p_uid, aid, 'member');
  delete from public.alliance_requests where user_id = p_uid;
  select name into nm from public.leaderboard where user_id = p_uid;
  perform public._al_feed(aid, 'sys', '✓ Request approved — ' || coalesce(nm,'a pilot') || ' is aboard');
end; $$;
grant execute on function public.alliance_request_respond(uuid, boolean) to authenticated;

create or replace function public.alliance_leave()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; r text; nm text; heir uuid;
begin
  select alliance_id, role into aid, r from public.alliance_members where user_id = me;
  if aid is null then return; end if;
  delete from public.alliance_members where user_id = me;
  -- voluntary exit → 24h rejoin cooldown
  insert into public.alliance_cooldowns(user_id, left_at) values (me, now())
    on conflict (user_id) do update set left_at = now();
  select name into nm from public.leaderboard where user_id = me;
  if not exists (select 1 from public.alliance_members where alliance_id = aid) then
    delete from public.alliances where id = aid;                       -- last one out: disband
    return;
  end if;
  if r = 'leader' then                                                 -- pass the crown
    select user_id into heir from public.alliance_members where alliance_id = aid
      order by public._al_rank(role) desc, joined_at asc limit 1;
    update public.alliance_members set role = 'leader' where user_id = heir;
    update public.alliances set leader = heir where id = aid;
  end if;
  perform public._al_feed(aid, 'sys', '← ' || coalesce(nm,'A pilot') || ' left the alliance');
end; $$;
grant execute on function public.alliance_leave() to authenticated;

create or replace function public.alliance_kick(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; myrole text; theirrole text; nm text;
begin
  select alliance_id, role into aid, myrole from public.alliance_members where user_id = me;
  select role into theirrole from public.alliance_members where user_id = p_uid and alliance_id = aid;
  if aid is null or theirrole is null then raise exception 'not found'; end if;
  -- rank ladder: you can only kick strictly below you (elder→member,
  -- co-leader→elder/member, leader→anyone)
  if public._al_rank(myrole) < 1 or public._al_rank(myrole) <= public._al_rank(theirrole) then raise exception 'no permission'; end if;
  if p_uid = me then raise exception 'use leave'; end if;
  delete from public.alliance_members where user_id = p_uid;
  select name into nm from public.leaderboard where user_id = p_uid;
  perform public._al_feed(aid, 'sys', '✕ ' || coalesce(nm,'A pilot') || ' was removed');
end; $$;
grant execute on function public.alliance_kick(uuid) to authenticated;

-- change a member's rank. Leader: set anyone (below leader) to
-- coleader/elder/member. Co-Leader: only member↔elder.
create or replace function public.alliance_role(p_uid uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; myrole text; theirrole text; nm text;
begin
  if p_role not in ('coleader','elder','member') then raise exception 'bad role'; end if;
  select alliance_id, role into aid, myrole from public.alliance_members where user_id = me;
  select role into theirrole from public.alliance_members where user_id = p_uid and alliance_id = aid;
  if aid is null or theirrole is null then raise exception 'not found'; end if;
  if theirrole = 'leader' or p_uid = me then raise exception 'no permission'; end if;
  if not (myrole = 'leader'
          or (public._al_rank(myrole) = 2 and p_role in ('elder','member')
              and public._al_rank(theirrole) <= 1)) then
    raise exception 'no permission';
  end if;
  if theirrole = p_role then return; end if;
  update public.alliance_members set role = p_role where user_id = p_uid and alliance_id = aid;
  select name into nm from public.leaderboard where user_id = p_uid;
  perform public._al_feed(aid, 'sys',
    case when public._al_rank(p_role) > public._al_rank(theirrole) then '▴ ' else '▾ ' end
    || coalesce(nm,'A pilot') || ' is now '
    || case p_role when 'coleader' then 'Co-Leader' when 'elder' then 'Elder' else 'a Member' end);
end; $$;
grant execute on function public.alliance_role(uuid, text) to authenticated;

-- daily donation. tier 1: gold (client-debited) · 2: big gold · 3: LootCoins.
-- server grants: AXP 20/60/150 · AC 60/200/500 · contribution += AXP
create or replace function public.alliance_donate(p_tier int)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; axp int; acr int; nm text;
begin
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'no alliance'; end if;
  update public.alliance_members set day_key = current_date, donated = false, attacks = 0
    where user_id = me and (day_key is distinct from current_date);
  if (select donated from public.alliance_members where user_id = me) then raise exception 'already donated today'; end if;
  axp := case p_tier when 3 then 150 when 2 then 60 else 20 end;
  acr := case p_tier when 3 then 500 when 2 then 200 else 60 end;
  update public.alliance_members set donated = true,
    contrib = contrib + axp,
    week_key = public._al_week()
    where user_id = me;
  update public.alliances set xp = xp + axp where id = aid;
  perform public._sw_credit(me, 0, acr);
  if p_tier = 3 then
    select name into nm from public.leaderboard where user_id = me;
    perform public._al_feed(aid, 'sys', '◈ ' || coalesce(nm,'A pilot') || ' made a major donation');
  end if;
end; $$;
grant execute on function public.alliance_donate(int) to authenticated;

-- boss attack: 2/day (+1 VIP). Damage comes from the LIVE 2:30 Hollow Armada
-- raid, clamped to 25× leaderboard power. Damage CARRIES ACROSS LEVELS: every
-- time a level's HP hits 0 the Armada resets FULL at the next mark (×1.55 HP)
-- and EVERY member is paid — more ⬡ per level (250 + 50·mark). The whole
-- ladder resets to Mk-1 every Sunday 12AM America/Chicago.
drop function if exists public.alliance_attack(numeric, boolean);
create or replace function public.alliance_attack(p_dmg numeric, p_vip boolean, p_pow numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; maxa int; att int; pw numeric; dmg numeric; tot numeric;
        hp numeric; bmax numeric; cmax numeric; anch numeric; n int; wk int; bw int; kills int := 0; coins bigint := 0; nm text;
begin
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'no alliance'; end if;
  update public.alliance_members set day_key = current_date, donated = false, attacks = 0
    where user_id = me and (day_key is distinct from current_date);
  maxa := case when coalesce(p_vip,false) then 3 else 2 end;
  select attacks into att from public.alliance_members where user_id = me;
  if att >= maxa then raise exception 'no attacks left today'; end if;
  select coalesce(power,0)::numeric into pw from public.leaderboard where user_id = me;
  -- damage clamp stays on the SERVER leaderboard power (never client-supplied) — fair.
  dmg := least(greatest(coalesce(p_dmg,0), 0), greatest(pw, 1) * 25);
  tot := dmg;
  -- the boss anchor MAY use the client's live power to RAISE (never lower) the
  -- pool, self-healing a stale leaderboard sum. Safe: it can only make the
  -- boss harder — it never touches the damage clamp above.
  anch := greatest(coalesce(pw,0), coalesce(p_pow,0));
  update public.alliance_members set attacks = attacks + 1, contrib = contrib + 5 where user_id = me;
  wk := public._al_bweek();
  select boss_hp, boss_max, boss_n, boss_week into hp, bmax, n, bw from public.alliances where id = aid for update;
  if bw is distinct from wk then                          -- WEEKLY RESET (Sun 00:00 Chicago)
    n := 1; hp := public._al_boss_hp(aid, 1, anch); bmax := hp;
    perform public._al_feed(aid, 'sys', '⟳ WEEKLY RESET — the Hollow Armada returns at Mk-1');
  end if;
  -- SELF-HEAL: if the current level's pool was built from a stale/low power
  -- reading, rescale it up to the live anchor, preserving the % already burned.
  cmax := public._al_boss_hp(aid, n, anch);
  if bmax is null or bmax <= 0 then bmax := cmax; hp := cmax; end if;
  if cmax > bmax * 4 then
    hp := cmax * least(1, greatest(0, hp / bmax));
    bmax := cmax;
  end if;
  while dmg >= hp loop                                    -- burn whole levels, overflow carries
    dmg := dmg - hp;
    coins := coins + 250 + 50 * n;                        -- more ⬡ per level
    kills := kills + 1; n := n + 1;
    hp := public._al_boss_hp(aid, n, anch);
    exit when kills >= 200;                               -- sanity valve
  end loop;
  hp := hp - dmg;
  update public.alliances set boss_n = n, boss_hp = hp, boss_max = public._al_boss_hp(aid, n, anch),
    boss_week = wk, xp = xp + 200 * kills where id = aid;
  if kills > 0 then
    update public.social_wallets w set ac = ac + coins, updated_at = now()
      where w.user_id in (select user_id from public.alliance_members where alliance_id = aid);
    insert into public.social_wallets(user_id, ac)
      select m.user_id, coins from public.alliance_members m where m.alliance_id = aid
        and not exists (select 1 from public.social_wallets w2 where w2.user_id = m.user_id);
    select name into nm from public.leaderboard where user_id = me;
    perform public._al_feed(aid, 'sys', '☠ ' || kills || ' ARMADA LEVEL' || case when kills > 1 then 'S' else '' end
      || ' DOWN — final blows by ' || coalesce(nm,'a pilot') || ' · +' || coins || ' ⬡ to every member · now Mk-' || n);
  end if;
  return jsonb_build_object('dmg', tot, 'kills', kills, 'boss_n', n, 'killed', kills > 0);
end; $$;
grant execute on function public.alliance_attack(numeric, boolean, numeric) to authenticated;

-- weekly ops: client reports completed mission points (10/25/60, ≤3 missions/wk)
create or replace function public.alliance_week_add(p_pts int)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; wk text := public._al_week(); pts int;
begin
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'no alliance'; end if;
  pts := least(greatest(coalesce(p_pts,0), 0), 60);
  update public.alliances set week_score = case when week_key = wk then week_score + pts else pts end,
    week_key = wk where id = aid;
  update public.alliance_members set contrib = case when week_key = wk then contrib + pts else pts end,
    week_key = wk where user_id = me;
end; $$;
grant execute on function public.alliance_week_add(int) to authenticated;

create or replace function public.alliance_chat(p_txt text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; nm text; last_at timestamptz;
begin
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'no alliance'; end if;
  select max(created_at) into last_at from public.alliance_feed where alliance_id = aid and user_id = me;
  if last_at is not null and last_at > now() - interval '10 seconds' then raise exception 'slow down'; end if;
  select name into nm from public.leaderboard where user_id = me;
  insert into public.alliance_feed(alliance_id, user_id, name, kind, txt)
  values (aid, me, coalesce(nm,'Operator'), 'chat', left(trim(p_txt), 120));
end; $$;
grant execute on function public.alliance_chat(text) to authenticated;

-- everything the Alliance screen needs in ONE call
create or replace function public.alliance_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; a jsonb; mem jsonb; feed jsonb; w jsonb; reqs jsonb; myrole text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into public.social_wallets(user_id) values (me) on conflict do nothing;
  select to_jsonb(x) into w from (select fp, ac from public.social_wallets where user_id = me) x;
  select alliance_id, role into aid, myrole from public.alliance_members where user_id = me;
  if aid is null then return jsonb_build_object('alliance', null, 'wallet', w); end if;
  -- lazy WEEKLY RESET so the UI shows Mk-1 after Sunday even before any attack
  update public.alliances set boss_n = 1, boss_hp = public._al_boss_hp(id, 1),
    boss_max = public._al_boss_hp(id, 1), boss_week = public._al_bweek()
    where id = aid and boss_week is distinct from public._al_bweek();
  select to_jsonb(x) into a from (select id, name, tag, blurb, join_mode, leader, xp, boss_n, boss_hp, boss_max, week_key, week_score from public.alliances where id = aid) x;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into mem from (
    select m.user_id, m.role, m.contrib, m.week_key, m.day_key, m.donated, m.attacks,
           l.name, l.power, l.level, l.fleet, l.updated_at as last_seen
    from public.alliance_members m left join public.leaderboard l on l.user_id = m.user_id
    where m.alliance_id = aid order by public._al_rank(m.role) desc, l.power desc nulls last) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) into feed from (
    select id, user_id, name, kind, txt, created_at from public.alliance_feed
    where alliance_id = aid order by id desc limit 40) x;
  reqs := '[]'::jsonb;
  if public._al_rank(myrole) >= 1 then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into reqs from (
      select r.user_id, r.note, r.created_at, l.name, l.power, l.level
      from public.alliance_requests r left join public.leaderboard l on l.user_id = r.user_id
      where r.alliance_id = aid order by r.created_at asc limit 30) x;
  end if;
  return jsonb_build_object('alliance', a, 'members', mem, 'feed', feed, 'wallet', w, 'me', me, 'requests', reqs);
end; $$;
grant execute on function public.alliance_state() to authenticated;

drop function if exists public.alliance_browse(text);
create or replace function public.alliance_browse(p_q text)
returns table (id uuid, name text, tag text, blurb text, join_mode text, xp bigint, boss_n int, week_score bigint, members bigint)
language sql security definer set search_path = public as $$
  select a.id, a.name, a.tag, a.blurb, a.join_mode, a.xp, a.boss_n,
         case when a.week_key = public._al_week() then a.week_score else 0 end,
         (select count(*) from public.alliance_members m where m.alliance_id = a.id)
  from public.alliances a
  where coalesce(p_q,'') = '' or a.name ilike '%' || p_q || '%' or a.tag ilike '%' || p_q || '%'
  order by a.xp desc limit 30;
$$;
grant execute on function public.alliance_browse(text) to authenticated;

drop function if exists public.alliance_weekly_board();
create or replace function public.alliance_weekly_board()
returns table (id uuid, name text, tag text, week_score bigint, xp bigint)
language sql security definer set search_path = public as $$
  select id, name, tag, week_score, xp from public.alliances
  where week_key = public._al_week() and week_score > 0
  order by week_score desc limit 50;
$$;
grant execute on function public.alliance_weekly_board() to authenticated;
