-- =============================================================================
--  territory-citadel-lv.sql — publish CITADEL RANK to the shared world
--  ---------------------------------------------------------------------------
--  territory.citadel is a BOOLEAN: the server knows a fortress exists but not
--  its rank. Rank 1-5 lived only in the owner's local save (state.citadels[id].lv),
--  so "citadel upgraded" was invisible to anything server-side — including the
--  Discord dispatch.
--
--  Adds citadel_lv and threads it through claim_tile. The new parameter is
--  LAST and defaults to null, so every legacy client call (6-arg, 5-arg, 3-arg,
--  2-arg) still binds to this same function, and null means "leave rank alone"
--  rather than silently resetting a rank-5 fortress to 0.
--
--  Safe to re-run. Run BEFORE deploying the build that sends citadelLv.
-- =============================================================================

alter table public.territory add column if not exists citadel_lv int not null default 0;

-- Backfill: an existing fortress is at least rank 1.
update public.territory set citadel_lv = 1 where citadel = true and citadel_lv = 0;

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
  if found and cur.owner_id is not null and cur.owner_id <> auth.uid()
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
    -- a legacy client sends no rank: keep what is there rather than zeroing it,
    -- but a tile with no fortress is always rank 0.
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
