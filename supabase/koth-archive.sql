-- =============================================================================
--  Loot Fleet — KING OF THE HILL: THE DAY MUST SURVIVE THE RESET
--  Run in Supabase: Dashboard → SQL Editor → New query → Run. Safe to re-run.
--
--  WHY DAY 1 CROWNED THE WRONG PILOT
--
--  koth_scores holds ONE ROW PER PLAYER, with the event day as a column on it.
--  koth_bump() resets that row in place the moment it sees a bump belonging to a
--  newer day:  kills = 0, tier = 1, flags = 0, reached_at = now().
--
--  koth_close() runs at 00:01 and reads the finished day out of that same table.
--  So for the first minute of every new race, the ONLY copy of the day being
--  judged is a row that any bump will zero — and the pilots who bump in that
--  minute are exactly the pilots who were still in the arena at midnight.
--  js/koth.js rolls over the instant the clock passes it:
--
--      if (ks().day !== dayIdx()) { flush(true); ... }
--
--  That flush lands a bump stamped with the new day, koth_bump zeroes the row,
--  and one minute later koth_close cannot see the leader at all. It crowns the
--  best pilot who had STOPPED PLAYING before midnight.
--
--  Being present at the reset was a disqualification. The player with the
--  biggest lead is the one most likely to still be flying when the day turns, so
--  the bug selected against the leader specifically.
--
--  (The other way a leader loses the crown is the old rate cap, fixed in
--  koth-ratefix.sql: 12 clamped flushes ≈ 30 seconds of endgame DPS and
--  koth_close skipped them. If day 1 ran before that migration, both bugs were
--  live at once. Section 6 below tells you which one hit.)
--
--  THE FIX — the reset stops destroying evidence.
--    1. koth_final: one immutable row per player per completed day.
--    2. koth_bump ARCHIVES the outgoing row before it zeroes it.
--    3. koth_close FREEZES whatever is still on the closing day into the same
--       archive, then judges the archive alone. A snapshot, not a live table.
--  A pilot can now fight through midnight, or log in during the close window,
--  without erasing the race they just ran.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · THE ARCHIVE
-- ---------------------------------------------------------------------------
create table if not exists public.koth_final (
  day         int    not null,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  name        text   not null default 'Operator',
  kills       bigint not null default 0,
  tier        int    not null default 1,
  ship        text,
  power       numeric not null default 0,
  flags       int    not null default 0,
  peak_kps    numeric not null default 0,
  reached_at  timestamptz not null default now(),
  archived_at timestamptz not null default now(),
  primary key (day, user_id)
);
create index if not exists koth_final_board on public.koth_final (day, kills desc, reached_at asc);

alter table public.koth_final enable row level security;
drop policy if exists koth_final_read on public.koth_final;
create policy koth_final_read on public.koth_final for select using (true);

-- ---------------------------------------------------------------------------
-- 2 · DROP EVERY koth_bump OVERLOAD FIRST
-- ---------------------------------------------------------------------------
-- `create or replace` cannot replace an overload whose argument types differ —
-- it silently adds a second copy, and PostgREST then picks the wrong candidate
-- or refuses to pick at all. Same trap as lb_upsert. Drop by catalogue lookup.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'koth_bump'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · THE WRITER — archives the outgoing day, then resets
-- ---------------------------------------------------------------------------
create or replace function public.koth_bump(
  p_delta int,
  p_name  text    default null,
  p_tier  int     default 1,
  p_ship  text    default null,
  p_power numeric default 0,
  p_seq   bigint  default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := now();
  v_day   int := public.koth_day(v_now);
  v_row   public.koth_scores%rowtype;
  v_gap   numeric;
  v_allow numeric;
  v_want  int;
  v_grant int;
  v_rank  int;
  v_res   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;

  v_want := greatest(0, least(coalesce(p_delta, 0), public.koth_max_delta()));

  select * into v_row from public.koth_scores where user_id = v_uid for update;

  if not found then
    insert into public.koth_scores (user_id, day, name, kills, tier, ship, power,
                                    reached_at, last_bump, updated_at)
    values (v_uid, v_day, coalesce(p_name, 'Operator'), 0, greatest(1, coalesce(p_tier, 1)),
            p_ship, coalesce(p_power, 0), v_now, v_now, v_now)
    returning * into v_row;
  elsif v_row.day <> v_day then
    -- ARCHIVE BEFORE ZEROING. This row is the only server-side record of the day
    -- it is leaving, and koth_close() has probably not run yet — it fires at
    -- 00:01 while the client rolls over at 00:00 and flushes immediately. Losing
    -- it here is how the leader stopped being eligible for the crown they had
    -- already won. `do nothing` because a day already frozen by koth_close is
    -- settled and must not be rewritten by a late bump.
    if v_row.kills > 0 then
      insert into public.koth_final (day, user_id, name, kills, tier, ship, power,
                                     flags, peak_kps, reached_at)
      values (v_row.day, v_row.user_id, v_row.name, v_row.kills, v_row.tier, v_row.ship,
              v_row.power, v_row.flags, v_row.peak_kps, v_row.reached_at)
      on conflict (day, user_id) do nothing;
    end if;
    -- NEW EVENT. Reset in place: kills, tier, flags, the tiebreak clock AND the
    -- replay sequence all belong to one 24-hour window; none of them carry over.
    update public.koth_scores set
      day = v_day, kills = 0, tier = 1, flags = 0, peak_kps = 0,
      last_seq = 0, last_res = null,
      reached_at = v_now, last_bump = v_now, updated_at = v_now
    where user_id = v_uid returning * into v_row;
  end if;

  -- REPLAY GUARD. A seq at or below the last one accepted is a retry of a call
  -- that already committed — hand back the stored answer, apply nothing.
  if p_seq > 0 and p_seq <= v_row.last_seq and v_row.last_res is not null then
    return v_row.last_res || jsonb_build_object('replay', true);
  end if;

  -- RATE CAP. Wall time since this player's previous bump, plus burst.
  v_gap   := greatest(0, extract(epoch from (v_now - v_row.last_bump)));
  v_allow := v_gap * public.koth_max_kps() + public.koth_burst();
  v_grant := greatest(0, least(v_want, floor(v_allow)::int));

  -- Every clamp is still recorded — it is the forensic trail. But only a claim
  -- several times past an already-generous ceiling counts against the player.
  if v_grant < v_want then
    insert into public.koth_audit (user_id, day, requested, granted, gap_s)
    values (v_uid, v_day, v_want, v_grant, v_gap);
    if v_want > v_allow * public.koth_abuse_mult() then
      update public.koth_scores set flags = flags + 1 where user_id = v_uid;
    end if;
  end if;

  update public.koth_scores set
    kills      = kills + v_grant,
    name       = coalesce(p_name, name),
    tier       = greatest(tier, coalesce(p_tier, 1)),
    ship       = coalesce(p_ship, ship),
    power      = greatest(power, coalesce(p_power, 0)),
    peak_kps   = greatest(peak_kps, case when v_gap > 0.5 then v_grant / v_gap else 0 end),
    -- TIEBREAK STAMP. Earliest to reach the final total wins, so this only moves
    -- when the total actually moves.
    reached_at = case when v_grant > 0 then v_now else reached_at end,
    last_bump  = v_now,
    last_seq   = greatest(last_seq, coalesce(p_seq, 0)),
    updated_at = v_now
  where user_id = v_uid returning * into v_row;

  select 1 + count(*) into v_rank
    from public.koth_scores s
   where s.day = v_day
     and (s.kills > v_row.kills
          or (s.kills = v_row.kills and s.reached_at < v_row.reached_at));

  v_res := jsonb_build_object(
    'ok', true, 'day', v_day, 'kills', v_row.kills, 'rank', v_rank,
    'granted', v_grant, 'requested', v_want, 'clamped', (v_grant < v_want),
    'flags', v_row.flags, 'ends', public.koth_ends(v_day)
  );
  update public.koth_scores set last_res = v_res where user_id = v_uid;
  return v_res;
end $$;

grant execute on function public.koth_bump(int, text, int, text, numeric, bigint)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · CLOSE — freeze the day, then judge the frozen copy
-- ---------------------------------------------------------------------------
drop function if exists public.koth_close(int);
create or replace function public.koth_close(p_day int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_day  int := coalesce(p_day, public.koth_day() - 1);
  v_win  public.koth_final;
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

  -- FREEZE. Every row still sitting on the closing day joins the pilots whose
  -- own rollover already archived them. After this, the day is a snapshot and
  -- nothing a client does can change what it says.
  insert into public.koth_final (day, user_id, name, kills, tier, ship, power,
                                 flags, peak_kps, reached_at)
  select s.day, s.user_id, s.name, s.kills, s.tier, s.ship, s.power,
         s.flags, s.peak_kps, s.reached_at
    from public.koth_scores s
   where s.day = v_day and s.kills > 0
  on conflict (day, user_id) do nothing;

  select count(*) into v_tot from public.koth_final where day = v_day and kills > 0;

  -- THE CROWN SKIPS FLAGGED RUNS. A player who repeatedly submitted several
  -- times more than the rate cap allows is not eligible; the next clean player
  -- wins instead. Their score stays on the board — this removes the prize, not
  -- the record.
  select * into v_win
    from public.koth_final f
   where f.day = v_day and f.kills > 0 and f.flags < public.koth_flag_limit()
   order by f.kills desc, f.reached_at asc
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
-- 5 · BACKFILL — capture any day still sitting in koth_scores
-- ---------------------------------------------------------------------------
-- Rows belonging to a day already past are the last survivors of the old
-- behaviour: pilots who have not played since. Archive them so those days can
-- still be closed correctly.
insert into public.koth_final (day, user_id, name, kills, tier, ship, power,
                               flags, peak_kps, reached_at)
select s.day, s.user_id, s.name, s.kills, s.tier, s.ship, s.power,
       s.flags, s.peak_kps, s.reached_at
  from public.koth_scores s
 where s.day < public.koth_day() and s.kills > 0
on conflict (day, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6 · WHICH BUG TOOK DAY 1 — run these, they only read
-- ---------------------------------------------------------------------------
-- Nothing below can repair day 1: the leader's kill total was overwritten with
-- 0 by their own rollover bump and the server kept no other copy. These say
-- what happened so the make-good is issued against facts.
--
-- (a) Who was crowned, and how many entrants the close could still see. An
--     entrant count far below the day's real turnout is the erasure.
--        select * from public.koth_hall order by day;
--
-- (b) Where the pilots who fought that day are now. A row whose `day` is LATER
--     than the day in question is a row that was reset — that pilot's total for
--     that day no longer exists anywhere.
--        select name, day, kills, flags, reached_at, last_bump
--          from public.koth_scores order by kills desc limit 40;
--
-- (c) The old rate cap, if day 1 predates koth-ratefix.sql. Twelve or more
--     clamps for one pilot on one day is the flag rule refusing them the crown.
--        select user_id, day, count(*) clamps,
--               max(requested) worst_req, max(granted) worst_grant
--          from public.koth_audit group by 1,2 having count(*) >= 12
--          order by clamps desc;

-- ---------------------------------------------------------------------------
-- 7 · HONOURING A CROWN THAT WAS TAKEN BY THE BUG
-- ---------------------------------------------------------------------------
-- Re-decides one day and re-issues its prize. Use it when (6) shows the wrong
-- pilot was crowned and you know the real total from the client (a screenshot,
-- the pilot's own HUD, the Discord feed) — the server copy is gone.
--
-- It does NOT take the prize back off the pilot who was paid: the award ledger
-- is drained into mail on claim, and clawing back a delivered grant is worse
-- than paying twice. The hall row is corrected and the real winner is paid.
drop function if exists public.koth_crown_override(int, uuid, bigint, text);
create or replace function public.koth_crown_override(
  p_day int, p_user uuid, p_kills bigint, p_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lc int := public.koth_prize_lc(); v_nm text; v_sh text; v_ti int;
begin
  if p_day is null or p_user is null then
    return jsonb_build_object('ok', false, 'reason', 'need day and user');
  end if;
  select coalesce(p_name, name, 'Operator'), ship, greatest(1, tier)
    into v_nm, v_sh, v_ti
    from public.koth_scores where user_id = p_user;
  v_nm := coalesce(p_name, v_nm, 'Operator');
  v_ti := coalesce(v_ti, 1);

  insert into public.koth_final (day, user_id, name, kills, tier, ship, reached_at)
  values (p_day, p_user, v_nm, greatest(0, coalesce(p_kills, 0)), v_ti, v_sh, now())
  on conflict (day, user_id) do update
    set kills = greatest(public.koth_final.kills, excluded.kills), name = excluded.name;

  delete from public.koth_hall where day = p_day;
  insert into public.koth_hall (day, user_id, name, kills, tier, ship, entrants)
  values (p_day, p_user, v_nm, greatest(0, coalesce(p_kills, 0)), v_ti, v_sh,
          (select count(*) from public.koth_final where day = p_day and kills > 0));

  insert into public.koth_awards (day, user_id, kills, lc)
  values (p_day, p_user, greatest(0, coalesce(p_kills, 0)), v_lc)
  on conflict (day, user_id) do nothing;

  return jsonb_build_object('ok', true, 'day', p_day, 'winner', v_nm, 'lc', v_lc);
end $$;
revoke all on function public.koth_crown_override(int, uuid, bigint, text) from public;

-- ---------------------------------------------------------------------------
-- 8 · VERIFY — exactly one koth_bump, and it must be the numeric/bigint one
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'koth_bump';
  if n <> 1 then
    raise exception 'koth_bump has % copies — drop them all and re-run this file', n;
  end if;
end $$;

select p.oid::regprocedure as koth_bump_signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'koth_bump';
