-- =============================================================================
--  bignum-power-fix.sql — LOOTFLEET
--  Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
--  FIXES the flood of Postgres errors:
--      22P02  invalid input syntax for type bigint: "2.348466085836973e+29"
--
--  CAUSE. Late-game fleet power is genuinely astronomical — the reported value
--  above is ~2.3e29, which is about 25 billion times larger than the maximum a
--  64-bit bigint can hold (~9.22e18). Two things then go wrong at once:
--    1. the number cannot fit in bigint at all, and
--    2. JavaScript serialises numbers that large in exponential notation, which
--       Postgres will not parse into an integer type even when it does fit.
--  Every cloud save calls lb_upsert() and fr_upsert_profile(), so once a player
--  crossed the ceiling EVERY publish failed — hundreds of errors an hour, and
--  their row silently stopped updating on every ladder.
--
--  This is the same fault already fixed for two other tables in this project
--  (server-dreadnaught-bignum.sql, sim-board-bignum-fix.sql). This migration
--  finishes the job on the two that were missed: `leaderboard` and
--  `fleet_ranks`. numeric is arbitrary-precision, has no ceiling, and DOES
--  accept exponential notation, so it fixes both halves of the problem.
--
--  Nothing changes client-side: the client already reads these with Number().
-- =============================================================================

-- ---- 1. drop the functions that hard-code bigint in a RETURN TYPE ------------
-- A function declaring `returns table (... power bigint ...)` fails at runtime
-- once the underlying column is numeric, so these must go before the ALTER.
drop function if exists public.friend_list();
drop function if exists public.pilot_search(text);

-- ---- 2. widen the columns ---------------------------------------------------
alter table public.leaderboard
  alter column power type numeric using power::numeric,
  alter column kills type numeric using kills::numeric;

alter table public.fleet_ranks
  alter column fleet_power   type numeric using fleet_power::numeric,
  alter column attack_power  type numeric using attack_power::numeric,
  alter column defense_value type numeric using defense_value::numeric;

-- ---- 3. widen the FUNCTION PARAMETERS, without guessing signatures ---------
-- A numeric column is not enough on its own: PostgREST parses the argument into
-- the parameter type first, so a bigint parameter still rejects "2.3e+29".
--
-- These functions have accumulated overloads across migrations — lb_upsert is
-- currently the 13-argument form (name, power, level, zone, kills, fleet, asc,
-- tiles, citadels, tile_rev, ships, missions, badges) and the client falls back
-- through 13 → 7 → 6 shapes. Hand-writing a signature here would risk adding
-- ANOTHER copy alongside the live one, and two copies of lb_upsert is precisely
-- what broke the leaderboard for everyone once before.
--
-- So: read each existing overload's real definition out of the catalogue, swap
-- bigint for numeric in it, drop the original and install the rewritten one.
-- Whatever signature is actually live gets widened, and no new overload appears.
do $$
declare
  r record;
  src text;
  newsrc text;
begin
  for r in
    select p.oid,
           p.oid::regprocedure                as sig,
           pg_get_functiondef(p.oid)          as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('lb_upsert', 'fr_upsert_profile', 'fr_position')
  loop
    src := r.def;
    -- only touch definitions that actually mention bigint
    if position('bigint' in src) = 0 then
      raise notice 'SKIP % (no bigint)', r.sig;
      continue;
    end if;
    newsrc := replace(src, 'bigint', 'numeric');
    -- NO CASCADE. If something else in the schema depends on this function the
    -- migration must fail loudly and let you look at it, not quietly delete it.
    -- The whole do-block is one statement, so a failure here rolls back the drop.
    execute 'drop function if exists ' || r.sig::text;
    execute newsrc;
    raise notice 'WIDENED %', r.sig;
  end loop;
end $$;

-- Re-grant: dropping and recreating clears privileges. Every current overload,
-- again by catalogue lookup so nothing is missed.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('lb_upsert', 'fr_upsert_profile', 'fr_position')
  loop
    execute 'grant execute on function ' || r.sig::text || ' to authenticated';
    if r.proname = 'fr_position' then
      execute 'grant execute on function ' || r.sig::text || ' to anon';
    end if;
  end loop;
end $$;

-- ---- 4. confirm no duplicate overloads survived ----------------------------
-- More than one row per function name here means the ambiguity fault is back and
-- the client's RPC calls will start failing with a 300. Should return no rows.
do $$
declare r record;
begin
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('lb_upsert','fr_upsert_profile')
     group by p.proname having count(*) > 1
  loop
    raise warning 'DUPLICATE OVERLOADS: % has % copies — resolve before relying on the ladder', r.proname, r.n;
  end loop;
end $$;

-- ---- 5. recreate the dropped readers as numeric ----------------------------
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

create or replace function public.pilot_search(p_q text)
returns table (user_id uuid, name text, power numeric, level int)
language sql security definer set search_path = public as $$
  select user_id, name, power, level from public.leaderboard
  where user_id <> auth.uid() and name ilike '%' || coalesce(p_q,'') || '%'
  order by power desc limit 20;
$$;
grant execute on function public.pilot_search(text) to authenticated;

-- ---- 6. the raid resolver ---------------------------------------------------
-- Its spoils are derived from defense_value, so its LOCAL variables would have
-- overflowed bigint the moment the column could exceed it. Same fault, one step
-- further in.
create or replace function public.fr_raid(p_defender uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  atk public.fleet_ranks;
  def public.fleet_ranks;
  win boolean;
  gold numeric := 0;
  galaxy numeric := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_defender = auth.uid() then raise exception 'cannot raid yourself'; end if;

  select * into atk from public.fleet_ranks where user_id = auth.uid() for update;
  if not found then raise exception 'register your fleet first'; end if;

  select * into def from public.fleet_ranks where user_id = p_defender for update;
  if not found then raise exception 'target not found'; end if;
  if def.shield_until > now() then raise exception 'target protected'; end if;

  win := atk.attack_power >= def.defense_value;
  if win then
    gold   := round(def.defense_value * 0.0016);
    galaxy := greatest(0, round(def.defense_value * 0.00009));
    update public.fleet_ranks set wins = wins + 1, updated_at = now() where user_id = atk.user_id
      returning * into atk;
    update public.fleet_ranks set losses = losses + 1, shield_until = now() + interval '2 hours'
      where user_id = def.user_id;
  else
    update public.fleet_ranks set losses = losses + 1, updated_at = now() where user_id = atk.user_id
      returning * into atk;
  end if;

  return jsonb_build_object(
    'win', win, 'gold', gold, 'galaxy', galaxy,
    'defender_name', def.name,
    'attacker_wins', atk.wins, 'attacker_losses', atk.losses
  );
end; $$;
grant execute on function public.fr_raid(uuid) to authenticated;

-- ---- 7. NOT changed here: simulated pilots ---------------------------------
-- sim_pilots.power is bigint and its growth tick clamps to 9e17 to stay inside
-- that type. It therefore never throws — but it does mean the simulated ladder
-- is capped eleven orders of magnitude below a real endgame player, so sims will
-- sit far below the top humans on the board. That is a BALANCE gap, not an error,
-- and widening it means rewriting several ::bigint casts inside the sim growth
-- and rival-tuning functions — worth doing deliberately, not inside a hotfix.

-- ---- 8. verify --------------------------------------------------------------
-- Should list every widened column as `numeric`.
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and (   (table_name = 'leaderboard'  and column_name in ('power','kills'))
        or (table_name = 'fleet_ranks'  and column_name in ('fleet_power','attack_power','defense_value')))
 order by table_name, column_name;
