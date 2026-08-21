-- =============================================================================
--  koth-ratefix.sql — KING OF THE HILL · rate-cap correction + idempotent bumps
--  Build 681. Run AFTER koth.sql.
-- =============================================================================
--
--  TWO BUGS, BOTH FOUND IN THE BUILD-681 ADVERSARIAL PASS.
--
--  BUG 1 — THE ANTI-CHEAT DISQUALIFIED THE BEST PLAYER IN THE GAME.
--  koth.sql conflated two unrelated ideas: "you exceeded the rate limit" and
--  "you are cheating". They are not the same thing, and treating them as one
--  inverted the whole feature.
--
--    koth_max_kps was 6.0/s sustained, burst 40, flag limit 12.
--    The arena holds up to 90 hostiles and the difficulty table STARTS at ×1 so
--    the opening is accessible. An endgame pilot (~6 Qi DPS) therefore clears
--    the entire field several times a second for the first few hundred kills —
--    20-50 kills/s is the DESIGNED early experience, not an anomaly.
--    Every flush then requested more than 6/s allowed, so every flush clamped,
--    so every flush incremented `flags`. Twelve flushes — about thirty seconds —
--    and koth_close() skipped them for the crown, silently, forever.
--
--    Worse, the surplus stayed queued client-side and drained at 6/s, so their
--    visible score fell minutes behind their real one for the whole race.
--
--  THE CORRECTION. The rate cap goes back to being what a rate cap is for:
--  stopping a client hammering the database. It is now set ABOVE anything the
--  spawner can physically produce (60/s sustained, 300 burst), so a legitimate
--  player is never throttled and never loses tempo.
--
--  Cheat detection is a SEPARATE, much wider test: a submission is only
--  evidence when it exceeds the allowance by a large multiple — a number the
--  game could not have produced however well you played. Ordinary clamping is
--  recorded in koth_audit for forensics but no longer touches `flags`.
--
--  BUG 2 — A LOST RESPONSE COULD DOUBLE-COUNT.
--  koth_bump is at-least-once: the client subtracts only what the server says
--  it granted, which is correct, but if the COMMIT succeeds and the response is
--  lost in transit, the client retries the same delta and the server adds it a
--  second time. Fixed with a per-player monotonic sequence number: a bump whose
--  seq is not greater than the last one accepted is a replay, and returns the
--  stored result instead of applying it again.
--
--  NOTE ON REPLACING koth_bump: adding p_seq CHANGES THE ARGUMENT LIST, so
--  `create or replace` would silently add a SECOND overload rather than replace
--  the first — the exact failure that put three copies of lb_upsert in
--  production. Step 1 drops every existing overload by catalogue lookup and
--  step 4 verifies exactly one survives.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · DROP EVERY EXISTING koth_bump OVERLOAD, WHATEVER ITS SIGNATURE
-- ---------------------------------------------------------------------------
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'koth_bump'
  loop
    execute 'drop function ' || r.sig;
    n := n + 1;
  end loop;
  raise notice 'koth-ratefix: dropped % koth_bump overload(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · RETUNED LIMITS
-- ---------------------------------------------------------------------------
-- Sustained ceiling. Set deliberately ABOVE the arena's physical throughput
-- (90-hostile field cap + spawner top-up) so it never binds on real play. This
-- is a database protection limit, NOT a difficulty or fairness limit.
create or replace function public.koth_max_kps() returns numeric
  language sql immutable as $$ select 60.0::numeric $$;
-- A backgrounded tab can batch several seconds of kills into one call.
create or replace function public.koth_burst() returns int
  language sql immutable as $$ select 300 $$;
create or replace function public.koth_max_delta() returns int
  language sql immutable as $$ select 600 $$;
-- HOW FAR PAST THE ALLOWANCE COUNTS AS EVIDENCE. Ordinary clamping is normal
-- traffic; only a claim several times larger than physically possible is a
-- flag. 3× a limit that is already above the game's ceiling is unreachable by
-- playing well.
create or replace function public.koth_abuse_mult() returns numeric
  language sql immutable as $$ select 3.0::numeric $$;
-- Flags tolerated before the crown is refused. Raised because a flag now means
-- something far more serious than it used to.
create or replace function public.koth_flag_limit() returns int
  language sql immutable as $$ select 25 $$;

-- ---------------------------------------------------------------------------
-- 3 · IDEMPOTENCY STATE + THE NEW WRITER
-- ---------------------------------------------------------------------------
alter table public.koth_scores add column if not exists last_seq bigint not null default 0;
alter table public.koth_scores add column if not exists last_res jsonb;

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
-- 4 · VERIFY EXACTLY ONE koth_bump SURVIVES
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'koth_bump';
  if n <> 1 then
    raise exception 'koth-ratefix: expected exactly 1 koth_bump, found %', n;
  end if;
  raise notice 'koth-ratefix: koth_bump OK (1 definition)';
end $$;

-- ---------------------------------------------------------------------------
-- 5 · CLEAR FLAGS RAISED BY THE OLD RULE
-- ---------------------------------------------------------------------------
-- Everything currently flagged was flagged by a test that fired on ordinary
-- fast play. Leaving those in place would carry the bug's verdict forward into
-- the corrected system and keep honest players off the crown.
update public.koth_scores set flags = 0 where flags > 0;
