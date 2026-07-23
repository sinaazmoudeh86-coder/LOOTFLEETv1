-- =============================================================================
--  Loot Fleet — TERRITORY DEFENSE FLEETS (add-on; run AFTER territory.sql and
--  territory-citadels.sql). Supabase → SQL Editor → New query → Run.
--  Safe to run more than once.
--
--  Adds a `defense` jsonb column to territory: a snapshot of the owner's fleet
--  published at claim time — { ship, nm, lvl, score, hp, dps, esc }. Rival
--  clients render it in the tile sheet ("DEFENDING FLEET") and spawn the CLONE
--  defender from it when the tile is attacked. Same self-reported trust model
--  as fleet_score.
-- =============================================================================

alter table public.territory
  add column if not exists defense jsonb;

-- Extended claim: optional p_defense. The 5/3/2-arg versions keep working
-- (the client falls back down the chain on older databases).
drop function if exists public.claim_tile(text, text, integer, boolean, numeric, jsonb);
create or replace function public.claim_tile(
  p_tile_id        text,
  p_owner_name     text,
  p_protect_minutes integer default 15,
  p_citadel        boolean default false,
  p_fleet_score    numeric default 0,
  p_defense        jsonb   default null
)
returns public.territory
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.territory;
  result   public.territory;
  mins     integer := greatest(15, least(1440, coalesce(p_protect_minutes, 15)));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into existing from public.territory where tile_id = p_tile_id for update;

  if found and existing.owner_id <> auth.uid() and existing.cooldown_until > now() then
    raise exception 'tile protected (cooldown)';
  end if;

  insert into public.territory (tile_id, owner_id, owner_name, captured_at, cooldown_until, citadel, fleet_score, defense)
  values (p_tile_id, auth.uid(), coalesce(nullif(p_owner_name, ''), 'Operator'),
          now(), now() + make_interval(mins => mins),
          coalesce(p_citadel, false), coalesce(p_fleet_score, 0), p_defense)
  on conflict (tile_id) do update
    set owner_id       = excluded.owner_id,
        owner_name     = excluded.owner_name,
        captured_at    = excluded.captured_at,
        cooldown_until = excluded.cooldown_until,
        citadel        = excluded.citadel,
        fleet_score    = excluded.fleet_score,
        defense        = excluded.defense
  returning * into result;

  return result;
end;
$$;

grant execute on function public.claim_tile(text, text, integer, boolean, numeric, jsonb) to authenticated;
