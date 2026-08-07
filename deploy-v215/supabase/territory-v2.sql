-- =============================================================================
--  LOOT FLEET — TERRITORY v2 (run ONCE in Supabase SQL Editor · idempotent)
--  Fixes the broken turf war: the live table was HALF-MIGRATED — claim_tile
--  existed in multiple overloads (ambiguous) and referenced columns that were
--  never added, so EVERY player's claim silently failed and nobody saw anyone
--  else's conquests. This migration:
--    1. adds every missing column
--    2. drops ALL claim_tile overloads
--    3. recreates ONE canonical function (defaults cover legacy client calls)
--    4. read-for-everyone RLS + realtime publication
-- =============================================================================

create table if not exists public.territory (
  tile_id text primary key,
  owner_id uuid,
  owner_name text
);
alter table public.territory add column if not exists citadel boolean not null default false;
alter table public.territory add column if not exists fleet_score numeric default 0;
alter table public.territory add column if not exists defense jsonb;
alter table public.territory add column if not exists cooldown_until timestamptz;
alter table public.territory add column if not exists updated_at timestamptz default now();
create index if not exists territory_updated_idx on public.territory (updated_at desc);

-- drop EVERY claim_tile overload (the ambiguity broke all clients)
do $$ declare r record; begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'claim_tile' and pronamespace = 'public'::regnamespace loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- ONE canonical claim function — parameter defaults mean every legacy client
-- fallback (6-arg, 5-arg, 3-arg, 2-arg) binds to this same function.
create or replace function public.claim_tile(
  p_tile_id text,
  p_owner_name text default 'Operator',
  p_protect_minutes int default 15,
  p_citadel boolean default false,
  p_fleet_score numeric default 0,
  p_defense jsonb default null
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
    raise exception 'shielded';                       -- attack shield honored server-side
  end if;
  insert into public.territory (tile_id, owner_id, owner_name, citadel, fleet_score, defense, cooldown_until, updated_at)
  values (p_tile_id, auth.uid(), coalesce(nullif(p_owner_name, ''), 'Operator'),
          coalesce(p_citadel, false), greatest(0, coalesce(p_fleet_score, 0)), p_defense,
          now() + make_interval(mins => least(2880, greatest(1, coalesce(p_protect_minutes, 15)))), now())
  on conflict (tile_id) do update set
    owner_id = excluded.owner_id,
    owner_name = excluded.owner_name,
    citadel = excluded.citadel,
    fleet_score = excluded.fleet_score,
    defense = coalesce(excluded.defense, territory.defense),
    cooldown_until = excluded.cooldown_until,
    updated_at = now();
  return query select * from public.territory where tile_id = p_tile_id;
end; $$;
grant execute on function public.claim_tile(text, text, int, boolean, numeric, jsonb) to authenticated;

-- everyone can READ the shared world; writes only through the RPC
alter table public.territory enable row level security;
do $$ begin
  create policy territory_read_all on public.territory for select using (true);
exception when duplicate_object then null; end $$;
grant select on public.territory to anon, authenticated;

-- live updates for every open map
do $$ begin
  alter publication supabase_realtime add table public.territory;
exception when duplicate_object then null;
        when undefined_object then null; end $$;
