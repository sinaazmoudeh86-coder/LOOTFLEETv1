-- =============================================================================
--  sim-territory-fix.sql — let simulated pilots actually hold tiles  (run once)
--  ---------------------------------------------------------------------------
--  MEASURED from cron.job_run_details, Aug 2026. Every single run of
--  `lf-sim-behave` — every 15 minutes, since the day it was scheduled — has
--  failed with:
--
--    ERROR: null value in column "owner_id" of relation "territory"
--           violates not-null constraint
--    CONTEXT: PL/pgSQL function sim_take_tile(uuid,text) line 15
--
--  CAUSE: territory.sql created the table with
--      owner_id uuid NOT NULL references auth.users(id)
--  territory-v2.sql redefined it as nullable, but that file uses
--  `create table if not exists` — the table already existed, so the change was
--  silently skipped and the NOT NULL survived.
--
--  Simulated pilots are rows in sim_pilots, not accounts in auth.users. They
--  have no uuid to put in owner_id, so they have never taken a single tile.
--  Your galaxy map has had zero AI presence since launch, and the job has been
--  erroring roughly a hundred times a day in the dark.
--
--  Nothing else was broken by this — sim_tick (population growth) writes only to
--  sim_pilots and has succeeded every hour throughout.
-- =============================================================================

-- ---- 1. THE FIX -------------------------------------------------------------
-- The foreign key stays. NULL always satisfies a foreign key, so a real owner is
-- still required to be a real account; a sim tile simply has no owner row.
alter table public.territory alter column owner_id drop not null;

-- The leaderboard seed trigger already anticipated this — it opens with
--   if new.owner_id is null then return new; end if;
-- so a sim capture will not create a phantom leaderboard entry.

-- ---- 2. SHIELD SIM-HELD TILES ----------------------------------------------
-- claim_tile's guard reads:
--     if found and cur.owner_id is not null and cur.owner_id <> auth.uid() ...
-- With the NOT NULL gone, `cur.owner_id is not null` is false for every sim
-- tile, so the cooldown never applied to them and a player could take one back
-- the instant it was captured. `is distinct from` is null-safe: it returns TRUE
-- when the owner is a sim and FALSE when the owner is you, which is what the
-- rule always meant.
--
-- Dropping every overload first, by catalogue lookup — the same pattern
-- territory-citadel-lv.sql used. Two copies of claim_tile would break tile
-- claiming for everyone, exactly as two copies of lb_upsert broke the board.
do $$ declare r record; begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'claim_tile' and pronamespace = 'public'::regnamespace loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

create or replace function public.claim_tile(
  p_tile_id text,
  p_owner_name text default 'Operator',
  p_protect_minutes int default 15,
  p_citadel boolean default false,
  p_fleet_score numeric default 0,
  p_defense jsonb default null,
  p_citadel_lv int default null
) returns setof public.territory
language plpgsql security definer set search_path = public as $$
declare cur public.territory;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_tile_id is null or length(p_tile_id) < 1 or length(p_tile_id) > 64 then
    raise exception 'bad tile';
  end if;
  select * into cur from public.territory where tile_id = p_tile_id;
  if found and cur.owner_id is distinct from auth.uid()
     and cur.cooldown_until is not null and cur.cooldown_until > now() then
    raise exception 'shielded';
  end if;
  insert into public.territory (tile_id, owner_id, owner_name, citadel, citadel_lv, fleet_score, defense, cooldown_until, updated_at)
  values (p_tile_id, auth.uid(), coalesce(nullif(p_owner_name, ''), 'Operator'),
          coalesce(p_citadel, false),
          case when coalesce(p_citadel, false) then greatest(1, coalesce(p_citadel_lv, 1)) else 0 end,
          greatest(0, coalesce(p_fleet_score, 0)), p_defense,
          now() + make_interval(mins => least(2880, greatest(1, coalesce(p_protect_minutes, 15)))), now())
  on conflict (tile_id) do update set
    owner_id = excluded.owner_id,
    owner_name = excluded.owner_name,
    citadel = excluded.citadel,
    citadel_lv = case
      when not excluded.citadel then 0
      when p_citadel_lv is null then greatest(1, territory.citadel_lv)
      else greatest(1, p_citadel_lv) end,
    fleet_score = excluded.fleet_score,
    defense = coalesce(excluded.defense, territory.defense),
    cooldown_until = excluded.cooldown_until,
    updated_at = now();
  return query select * from public.territory where tile_id = p_tile_id;
end; $$;

grant execute on function public.claim_tile(text, text, int, boolean, numeric, jsonb, int) to authenticated;

-- ---- 3. RUN IT ONCE NOW instead of waiting for the next quarter hour --------
select public.sim_behave();

-- ---- VERIFY -----------------------------------------------------------------
-- Tiles now held by simulated pilots (was always 0, expect a handful and
-- climbing every 15 minutes):
--   select count(*) from public.territory where owner_id is null;
--
-- Who holds them:
--   select tile_id, owner_name, fleet_score, cooldown_until
--     from public.territory where owner_id is null
--    order by updated_at desc limit 20;
--
-- Exactly ONE claim_tile — two would break tile claiming for everyone:
--   select oid::regprocedure from pg_proc
--    where proname = 'claim_tile' and pronamespace = 'public'::regnamespace;
--
-- The job should stop failing. Check after the next quarter hour:
--   select j.jobname, d.status, d.return_message, d.start_time
--     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--    where j.jobname = 'lf-sim-behave'
--    order by d.start_time desc limit 5;
