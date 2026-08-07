-- =============================================================================
--  Loot Fleet — PLAYER CITADELS (turf-war add-on for territory.sql)
--  Run AFTER territory.sql, in Supabase → SQL Editor → New query → Run.
--  Safe to run more than once. Adds two columns + extends claim_tile() so a
--  claim can flag the tile as a player Citadel and stamp the owner's fleet
--  score (used as the CLONE-defender strength when someone attacks it).
-- =============================================================================

alter table public.territory
  add column if not exists citadel     boolean not null default false,
  add column if not exists fleet_score numeric not null default 0;

-- Extended claim: optional p_citadel / p_fleet_score. The 3-arg and 2-arg
-- versions from territory.sql keep working (the client falls back to them).
drop function if exists public.claim_tile(text, text, integer, boolean, numeric);
create or replace function public.claim_tile(
  p_tile_id        text,
  p_owner_name     text,
  p_protect_minutes integer default 15,
  p_citadel        boolean default false,
  p_fleet_score    numeric default 0
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

  insert into public.territory (tile_id, owner_id, owner_name, captured_at, cooldown_until, citadel, fleet_score)
  values (p_tile_id, auth.uid(), coalesce(nullif(p_owner_name, ''), 'Operator'),
          now(), now() + make_interval(mins => mins),
          coalesce(p_citadel, false), coalesce(p_fleet_score, 0))
  on conflict (tile_id) do update
    set owner_id       = excluded.owner_id,
        owner_name     = excluded.owner_name,
        captured_at    = excluded.captured_at,
        cooldown_until = excluded.cooldown_until,
        citadel        = excluded.citadel,
        fleet_score    = excluded.fleet_score
  returning * into result;

  return result;
end;
$$;

grant execute on function public.claim_tile(text, text, integer, boolean, numeric) to authenticated;
