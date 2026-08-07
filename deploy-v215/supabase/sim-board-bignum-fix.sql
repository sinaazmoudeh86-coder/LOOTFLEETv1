-- =============================================================================
-- sim-board-bignum-fix.sql — LOOTFLEET
--
-- FIXES: sim_board() failing with `22003 bigint out of range`, which returns zero
-- simulated pilots to the client.
--
-- CAUSE: fleet power outgrows a 64-bit integer in the late game. sim_board()
-- declared its `power` column as bigint and derived it from the top human's
-- power, so as soon as that value exceeded ~9.22e18 the cast blew up and the RPC
-- returned an error instead of rows.
--
-- FIX: all power arithmetic happens in `numeric` (unbounded), the return type is
-- numeric, and every value is clamped to a bigint-safe ceiling before it leaves
-- the function. The client already reads power with Number(), so a numeric-typed
-- column needs no client change.
--
-- Safe to re-run.
-- =============================================================================

-- ---- 1. widen the roster's own power column --------------------------------
-- Same reason: a sim shadowing a late-game human needs the same headroom.
alter table sim_pilots  alter column power type numeric using power::numeric;
alter table sim_pilots  alter column kills type numeric using kills::numeric;

-- ---- 2. clamp anything already out of range --------------------------------
update sim_pilots set power = 9e18 where power > 9e18;
update sim_pilots set kills = 9e18 where kills > 9e18;

-- ---- 3. sim_board \u2014 numeric throughout, clamped on the way out -------------
drop function if exists sim_board(int);
create or replace function sim_board(p_limit int default 100)
returns table (
  name text, level int, zone int, power numeric, kills numeric,
  fleet jsonb, asc_stars smallint, personality text, is_simulated boolean, marked boolean
) language plpgsql security definer set search_path = public as $$
declare cfg sim_config; top_real numeric; ceiling numeric;
begin
  select * into cfg from sim_config where id = 1;
  if not cfg.enabled then return; end if;

  -- NUMERIC, not bigint: late-game fleet power has no practical ceiling
  select coalesce(max(l.power::numeric), 0) into top_real from leaderboard l;

  -- sims may never out-power the strongest human unless explicitly allowed
  ceiling := case when cfg.allow_rank1 or top_real <= 0 then 9e18
                  else least(9e18, greatest(1, top_real - 1)) end;

  return query
    select s.name,
           least(500, greatest(1, s.level))::int,
           greatest(1, s.zone)::int,
           least(s.power::numeric, ceiling) as pw,
           least(s.kills::numeric, 9e18),
           s.fleet, s.asc_stars, s.personality, true, cfg.mark_publicly
    from sim_pilots s
    where s.active
    order by pw desc
    limit greatest(0, least(p_limit, cfg.max_top100 * 4));
end $$;
grant execute on function sim_board(int) to anon, authenticated;

-- ---- 4. sim_rivals \u2014 same overflow, same fix ------------------------------
-- It anchors the rival pack to the top human's power, so it hit the identical
-- wall. Recreated with numeric maths and a safe clamp.
create or replace function sim_rivals()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg sim_config;
  top_power numeric; top_asc int; top_level int; top_zone int;
  want int; have int; r record; i int := 0; lag int; target numeric;
  frac numeric[] := array[0.94, 0.88, 0.82, 0.77, 0.72];
  climb numeric; promoted int := 0; tuned int := 0;
begin
  select * into cfg from sim_config where id = 1;
  if not cfg.enabled then return jsonb_build_object('ok', false); end if;

  select coalesce(max(power::numeric), 0), coalesce(max(asc_stars), 0),
         coalesce(max(level), 1), coalesce(max(zone), 1)
    into top_power, top_asc, top_level, top_zone
    from leaderboard where updated_at > now() - interval '7 days';

  if coalesce(top_power, 0) < 50000 then
    update sim_pilots set rival = false where rival;
    return jsonb_build_object('ok', true, 'rivals', 0, 'reason', 'no human anchor');
  end if;

  climb := 0.03 + 0.97 * power(least(1.0, greatest(0.0,
            (current_date - coalesce(cfg.epoch_day, current_date))::numeric
            / greatest(1, cfg.ramp_days))), 0.8);

  want := greatest(3, least(5, cfg.rival_count));
  select count(*) into have from sim_pilots where rival and active;

  if have < want then
    for r in select id from sim_pilots
              where active and not rival
                and power between (top_power * 0.55) and (top_power * 1.6)
              order by abs(power - top_power) asc
              limit (want - have) loop
      update sim_pilots set rival = true where id = r.id;
      promoted := promoted + 1;
    end loop;
    if promoted < (want - have) then
      for r in select id from sim_pilots where active and not rival
                order by abs(power - top_power) asc limit (want - have - promoted) loop
        update sim_pilots set rival = true where id = r.id;
        promoted := promoted + 1;
      end loop;
    end if;
  elsif have > want then
    update sim_pilots set rival = false
     where id in (select id from sim_pilots where rival and active
                  order by abs(power - top_power) desc limit (have - want));
  end if;

  for r in select id, power from sim_pilots where rival and active order by power desc loop
    i := i + 1;
    lag := greatest(0, top_asc - ((i - 1) / 2));
    target := least(top_power * frac[least(i, array_length(frac, 1))] * climb,
                    greatest(1, top_power - 1), 9e18);
    update sim_pilots set
      power     = greatest(1, least(9e18, r.power + (target - r.power) * 0.25)),
      asc_stars = least(top_asc, lag)::smallint,
      asc_mult  = 1.0 + least(top_asc, lag) * 0.18,
      level     = least(500, greatest(1, (top_level * (0.82 + random() * 0.14))::int)),
      zone      = greatest(1, least(1000, (top_zone * (0.85 + random() * 0.12))::int)),
      band      = 'endgame',
      login_prob = greatest(login_prob, 0.85),
      growth     = greatest(growth, 1.4),
      last_tick  = now()
    where id = r.id;
    tuned := tuned + 1;
  end loop;

  insert into sim_log (kind, payload) values ('rivals', jsonb_build_object(
    'want', want, 'promoted', promoted, 'tuned', tuned, 'climb', round(climb, 3),
    'top_human_power', top_power, 'top_human_asc', top_asc));
  return jsonb_build_object('ok', true, 'rivals', tuned, 'promoted', promoted,
                            'anchor_power', top_power, 'anchor_asc', top_asc);
end $$;
revoke all on function sim_rivals() from public;

-- ---- 5. sim_tick \u2014 keep power growth inside the numeric clamp -------------
-- The tick multiplies power every pass, so it needs the same ceiling.
create or replace function sim_clamp_power() returns void
language sql security definer set search_path = public as $$
  update sim_pilots set power = least(power, 9e18), kills = least(kills, 9e18)
   where power > 9e18 or kills > 9e18;
$$;
revoke all on function sim_clamp_power() from public;

-- ---- verify ----------------------------------------------------------------
-- select count(*) as rows_returned from sim_board(50);
