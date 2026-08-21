-- =============================================================================
--  koth.sql — LOOTFLEET · KING OF THE HILL (24h PvE kill race)
--  ---------------------------------------------------------------------------
--  One private PvE instance per player, one shared ladder. Highest kill count
--  in the 24-hour window takes 10,000 LootCoins.
--
--  WHAT THE SERVER OWNS, AND WHAT IT HONESTLY CANNOT
--  ---------------------------------------------------------------------------
--  The spec asks for kills to be "validated server-side — enemy death occurred
--  server-side". LOOTFLEET has no game server: combat runs entirely in
--  js/game-v93.js on the player's device and Supabase only stores rows. There is
--  no authoritative simulation to validate a kill against, and pretending
--  otherwise would be worse than saying so.
--
--  So this file implements the strongest thing that IS achievable here, and the
--  design leans on it deliberately:
--
--    1. THE CLIENT NEVER SENDS A TOTAL. koth_bump() takes a DELTA and the server
--       owns the running sum. A tampered client cannot assign itself a score; it
--       can only try to add, and every add is measured.
--    2. THE SERVER OWNS THE CLOCK. The event day, the window, the tiebreak
--       timestamp and the cutoff all come from now(). p_day is never accepted
--       from the caller.
--    3. EVERY ADD IS RATE-CAPPED against wall time since that player's previous
--       bump, at KOTH_MAX_KPS with a small burst allowance for a laggy tab that
--       batches two intervals into one call.
--    4. A CLAMPED ADD IS EVIDENCE. It is written to koth_audit and increments
--       `flags`. koth_close() refuses the crown to anyone over the flag
--       threshold and awards the next clean player instead.
--    5. THE PRIZE IS A LEDGER ROW, NOT A CLIENT GRANT. Same pattern as
--       rank_awards: the winner is decided server-side and the client drains it
--       through claim_koth_awards(), which marks delivered in the same
--       statement so a second tab cannot pay twice.
--
--  What remains possible: a determined attacker with devtools can submit
--  plausible deltas at a legal rate and inflate a score over 24 hours. Closing
--  that needs a server-side combat sim, which is a different project. The
--  mitigations that matter in practice are the rate cap, the audit trail, and a
--  prize small enough that the effort is not worth it.
--
--  SAFE TO RE-RUN. Verify block at the bottom.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0 · tuning
-- ---------------------------------------------------------------------------
-- Sustained ceiling. Tier 1 is Level 100 mobs at 1x HP and a strong build can
-- genuinely clear several a second there, so this is set well above legitimate
-- play; it exists to make an automated firehose impossible, not to police good
-- players. The difficulty curve does the real pacing.
create or replace function public.koth_max_kps() returns numeric
  language sql immutable as $$ select 6.0::numeric $$;
-- Allowance for a tab that was throttled and batches two intervals into one call.
create or replace function public.koth_burst() returns int
  language sql immutable as $$ select 40 $$;
-- Hard ceiling on any single call, whatever the elapsed time says.
create or replace function public.koth_max_delta() returns int
  language sql immutable as $$ select 60 $$;
-- Clamped bumps tolerated before a player is ineligible for the crown.
create or replace function public.koth_flag_limit() returns int
  language sql immutable as $$ select 12 $$;
-- The prize.
create or replace function public.koth_prize_lc() returns int
  language sql immutable as $$ select 10000 $$;

-- THE EVENT CLOCK. UTC-day aligned, so it lines up with daily_ranks_award()
-- at 00:05 UTC and with every other daily reset in the game.
create or replace function public.koth_day(p_at timestamptz default null)
returns int language sql stable as $$
  select floor(extract(epoch from coalesce(p_at, now())) / 86400)::int
$$;
create or replace function public.koth_ends(p_day int default null)
returns timestamptz language sql stable as $$
  select to_timestamp((coalesce(p_day, public.koth_day()) + 1) * 86400)
$$;

-- ---------------------------------------------------------------------------
-- 1 · tables
-- ---------------------------------------------------------------------------
-- ONE ROW PER PLAYER, not per player per day. A bump carrying a newer event day
-- resets the row in place, so the table stays the size of the player base and
-- history lives in koth_hall.
create table if not exists public.koth_scores (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  day        int         not null,
  name       text        not null default 'Operator',
  kills      bigint      not null default 0,
  tier       int         not null default 1,
  ship       text,
  -- numeric, not bigint: endgame fleet power passes 1e29 and arrives from JS in
  -- exponential notation, which no integer type parses. Same rule as lb_upsert.
  power      numeric     not null default 0,
  -- WHEN THE CURRENT `kills` VALUE WAS FIRST REACHED. This is the tiebreak the
  -- spec asks for: identical finals go to whoever got there first.
  reached_at timestamptz not null default now(),
  last_bump  timestamptz not null default now(),
  flags      int         not null default 0,
  peak_kps   numeric     not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists koth_scores_board on public.koth_scores (day, kills desc, reached_at asc);

-- HALL OF KINGS — one row per completed event.
create table if not exists public.koth_hall (
  day       int primary key,
  user_id   uuid references auth.users(id) on delete set null,
  name      text,
  kills     bigint not null default 0,
  tier      int    not null default 1,
  ship      text,
  entrants  int    not null default 0,
  closed_at timestamptz not null default now()
);

-- THE PRIZE LEDGER. Mirrors rank_awards: written server-side at close, drained
-- by the client into mail. `delivered` is what stops a double payout.
create table if not exists public.koth_awards (
  id        bigserial primary key,
  day       int  not null,
  user_id   uuid not null references auth.users(id) on delete cascade,
  kills     bigint not null default 0,
  lc        int  not null default 0,
  delivered boolean not null default false,
  created   timestamptz not null default now(),
  unique (day, user_id)
);
create index if not exists koth_awards_pending on public.koth_awards (user_id) where not delivered;

-- EVERY CLAMPED SUBMISSION. Small, bounded, and the only record of who was
-- pushing. Read it before honouring a suspicious crown.
create table if not exists public.koth_audit (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  day       int  not null,
  requested int  not null,
  granted   int  not null,
  gap_s     numeric not null,
  at        timestamptz not null default now()
);
create index if not exists koth_audit_who on public.koth_audit (day, user_id);

alter table public.koth_scores enable row level security;
alter table public.koth_hall   enable row level security;
alter table public.koth_awards enable row level security;
alter table public.koth_audit  enable row level security;

-- The ladder is public reading; every WRITE goes through a security-definer
-- function, so there is no direct insert/update path from a client key.
drop policy if exists koth_scores_read on public.koth_scores;
create policy koth_scores_read on public.koth_scores for select using (true);
drop policy if exists koth_hall_read on public.koth_hall;
create policy koth_hall_read on public.koth_hall for select using (true);
drop policy if exists koth_awards_own on public.koth_awards;
create policy koth_awards_own on public.koth_awards for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2 · THE WRITER — a rate-capped delta, never a total
-- ---------------------------------------------------------------------------
drop function if exists public.koth_bump(int, text, int, text, numeric);
create or replace function public.koth_bump(
  p_delta int,
  p_name  text    default null,
  p_tier  int     default null,
  p_ship  text    default null,
  p_power numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_day   int  := public.koth_day();
  v_now   timestamptz := now();
  v_row   public.koth_scores;
  v_gap   numeric;
  v_allow int;
  v_want  int;
  v_grant int;
  v_rank  int;
  v_fresh boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;

  -- never trust the sign or the magnitude
  v_want := greatest(0, least(coalesce(p_delta, 0), public.koth_max_delta()));

  select * into v_row from public.koth_scores where user_id = v_uid for update;

  if not found then
    insert into public.koth_scores (user_id, day, name, kills, tier, ship, power,
                                    reached_at, last_bump, updated_at)
    values (v_uid, v_day, coalesce(nullif(trim(p_name), ''), 'Operator'), 0,
            greatest(1, coalesce(p_tier, 1)), nullif(trim(p_ship), ''),
            greatest(0, coalesce(p_power, 0)), v_now, v_now, v_now)
    returning * into v_row;
    v_fresh := true;
  elsif v_row.day <> v_day then
    -- NEW EVENT. Reset in place: kills, tier, flags and the tiebreak clock all
    -- belong to one 24-hour window and none of them carry over.
    update public.koth_scores set
      day = v_day, kills = 0, tier = 1, flags = 0, peak_kps = 0,
      reached_at = v_now, last_bump = v_now, updated_at = v_now
    where user_id = v_uid returning * into v_row;
    v_fresh := true;
  end if;

  -- RATE CAP. A fresh row gets the burst allowance only; an established one is
  -- measured against wall time since its previous bump.
  v_gap := greatest(0, extract(epoch from (v_now - v_row.last_bump)));
  if v_fresh then
    v_allow := public.koth_burst();
  else
    v_allow := floor(v_gap * public.koth_max_kps())::int + public.koth_burst();
  end if;
  v_grant := least(v_want, greatest(0, v_allow));

  if v_grant < v_want then
    insert into public.koth_audit (user_id, day, requested, granted, gap_s)
    values (v_uid, v_day, v_want, v_grant, v_gap);
    update public.koth_scores set flags = flags + 1 where user_id = v_uid;
  end if;

  update public.koth_scores set
    kills      = kills + v_grant,
    -- the tiebreak stamp only moves when the score actually moves
    reached_at = case when v_grant > 0 then v_now else reached_at end,
    peak_kps   = greatest(peak_kps, case when v_gap > 0.5 then v_grant / v_gap else 0 end),
    tier       = greatest(1, coalesce(p_tier, tier)),
    name       = coalesce(nullif(trim(p_name), ''), name),
    ship       = coalesce(nullif(trim(p_ship), ''), ship),
    power      = greatest(power, coalesce(p_power, 0)),
    last_bump  = v_now,
    updated_at = v_now
  where user_id = v_uid
  returning * into v_row;

  select count(*) + 1 into v_rank
    from public.koth_scores s
   where s.day = v_day
     and (s.kills > v_row.kills
          or (s.kills = v_row.kills and s.reached_at < v_row.reached_at));

  return jsonb_build_object(
    'ok', true, 'day', v_day, 'kills', v_row.kills, 'rank', v_rank,
    'granted', v_grant, 'requested', v_want, 'clamped', (v_grant < v_want),
    'flags', v_row.flags, 'ends', public.koth_ends(v_day)
  );
end $$;
grant execute on function public.koth_bump(int, text, int, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · READERS
-- ---------------------------------------------------------------------------
drop function if exists public.koth_top(int);
create or replace function public.koth_top(p_n int default 25)
returns table (rank int, user_id uuid, name text, kills bigint, tier int, ship text)
language sql stable security definer set search_path = public as $$
  select (row_number() over (order by s.kills desc, s.reached_at asc))::int,
         s.user_id, s.name, s.kills, s.tier, s.ship
    from public.koth_scores s
   where s.day = public.koth_day() and s.kills > 0
   order by s.kills desc, s.reached_at asc
   limit greatest(1, least(coalesce(p_n, 25), 100))
$$;
grant execute on function public.koth_top(int) to authenticated, anon;

-- The caller's own standing, plus what the rank above is worth in kills — the
-- "22 kills to #6" line the HUD overlay shows.
drop function if exists public.koth_me();
create or replace function public.koth_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_day  int  := public.koth_day();
  v_row  public.koth_scores;
  v_rank int;
  v_next bigint;
  v_tot  int;
begin
  select count(*) into v_tot from public.koth_scores where day = v_day and kills > 0;
  if v_uid is null then
    return jsonb_build_object('ok', true, 'day', v_day, 'kills', 0, 'rank', null,
                              'entrants', v_tot, 'ends', public.koth_ends(v_day));
  end if;
  select * into v_row from public.koth_scores where user_id = v_uid and day = v_day;
  if not found then
    return jsonb_build_object('ok', true, 'day', v_day, 'kills', 0, 'rank', null,
                              'entrants', v_tot, 'ends', public.koth_ends(v_day));
  end if;
  select count(*) + 1 into v_rank
    from public.koth_scores s
   where s.day = v_day
     and (s.kills > v_row.kills
          or (s.kills = v_row.kills and s.reached_at < v_row.reached_at));
  select min(s.kills) into v_next
    from public.koth_scores s
   where s.day = v_day and s.kills > v_row.kills;
  return jsonb_build_object(
    'ok', true, 'day', v_day, 'kills', v_row.kills, 'rank', v_rank, 'tier', v_row.tier,
    'entrants', v_tot, 'next', v_next, 'flags', v_row.flags,
    'ends', public.koth_ends(v_day)
  );
end $$;
grant execute on function public.koth_me() to authenticated;

drop function if exists public.koth_hall_top(int);
create or replace function public.koth_hall_top(p_n int default 14)
returns table (day int, name text, kills bigint, ship text, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.day, h.name, h.kills, h.ship, h.closed_at
    from public.koth_hall h
   order by h.day desc
   limit greatest(1, least(coalesce(p_n, 14), 60))
$$;
grant execute on function public.koth_hall_top(int) to authenticated, anon;

-- Lifetime crowns, for the player profile.
drop function if exists public.koth_wins(uuid);
create or replace function public.koth_wins(p_user uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.koth_hall
   where user_id = coalesce(p_user, auth.uid())
$$;
grant execute on function public.koth_wins(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · CLOSE — lock the day, crown the king, write the ledger
-- ---------------------------------------------------------------------------
-- Idempotent per day: koth_hall.day is the primary key, so a retried cron tick
-- cannot crown twice or pay twice.
drop function if exists public.koth_close(int);
create or replace function public.koth_close(p_day int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_day  int := coalesce(p_day, public.koth_day() - 1);
  v_win  public.koth_scores;
  v_tot  int;
  v_lc   int := public.koth_prize_lc();
begin
  -- never close a window that is still running
  if v_day >= public.koth_day() then
    return jsonb_build_object('ok', false, 'reason', 'live', 'day', v_day);
  end if;
  if exists (select 1 from public.koth_hall where day = v_day) then
    return jsonb_build_object('ok', true, 'reason', 'already', 'day', v_day);
  end if;

  select count(*) into v_tot from public.koth_scores where day = v_day and kills > 0;

  -- THE CROWN SKIPS FLAGGED RUNS. A player who repeatedly submitted more than
  -- the rate cap allows is not eligible; the next clean player wins instead.
  -- Their score stays on the board — this removes the prize, not the record.
  select * into v_win
    from public.koth_scores s
   where s.day = v_day and s.kills > 0 and s.flags < public.koth_flag_limit()
   order by s.kills desc, s.reached_at asc
   limit 1;

  if not found then
    insert into public.koth_hall (day, user_id, name, kills, tier, ship, entrants)
    values (v_day, null, null, 0, 1, null, v_tot);
    return jsonb_build_object('ok', true, 'day', v_day, 'winner', null, 'entrants', v_tot);
  end if;

  insert into public.koth_hall (day, user_id, name, kills, tier, ship, entrants)
  values (v_day, v_win.user_id, v_win.name, v_win.kills, v_win.tier, v_win.ship, v_tot);

  insert into public.koth_awards (day, user_id, kills, lc)
  values (v_day, v_win.user_id, v_win.kills, v_lc)
  on conflict (day, user_id) do nothing;

  -- Announce through the feed the same way every other event does.
  begin
    insert into public.war_events (kind, payload)
    values ('koth_winner', jsonb_build_object(
      'day', v_day, 'name', v_win.name, 'kills', v_win.kills,
      'ship', v_win.ship, 'tier', v_win.tier, 'entrants', v_tot, 'lc', v_lc));
  exception when undefined_table or undefined_column then null;
  end;

  return jsonb_build_object('ok', true, 'day', v_day, 'winner', v_win.name,
                            'kills', v_win.kills, 'entrants', v_tot, 'lc', v_lc);
end $$;
revoke all on function public.koth_close(int) from public;

-- ---------------------------------------------------------------------------
-- 5 · THE CLIENT'S CLAIM — returns what is owed and marks it delivered at once
-- ---------------------------------------------------------------------------
drop function if exists public.claim_koth_awards();
create or replace function public.claim_koth_awards()
returns table (day int, kills bigint, lc int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.koth_awards a
     set delivered = true
   where a.user_id = auth.uid() and not a.delivered
  returning a.day, a.kills, a.lc;
end $$;
grant execute on function public.claim_koth_awards() to authenticated;

-- ---------------------------------------------------------------------------
-- 6 · SCHEDULE — close the finished day a minute after the boundary
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('koth-close');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('koth-close', '1 0 * * *', $cron$ select public.koth_close(); $cron$);
exception when others then
  raise notice 'pg_cron not available — call koth_close() from your own scheduler';
end $$;

-- ---------------------------------------------------------------------------
-- 7 · VERIFY
-- ---------------------------------------------------------------------------
-- Exactly one koth_bump, and p_power must be numeric (see CLAUDE.md — a bigint
-- re-declaration silently adds a second overload and PostgREST then refuses to
-- pick). This must return ONE row.
select p.oid::regprocedure as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'koth_bump';

select 'scores' t, count(*) from public.koth_scores
union all select 'hall', count(*) from public.koth_hall
union all select 'awards', count(*) from public.koth_awards
union all select 'audit', count(*) from public.koth_audit;
