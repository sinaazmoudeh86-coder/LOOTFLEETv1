-- =============================================================================
--  Loot Fleet — GLOBAL LEADERBOARD (real cross-account ranking)
--  Run in Supabase: Dashboard → SQL Editor → New query → Run. Safe to re-run.
--
--  A shared, world-readable table of every signed-in operator's public stats.
--  The client upserts its own row on each cloud save; the board reads the top N.
--  Same trust model as `saves`/`fleet_ranks`: the browser reports its own numbers,
--  identity is always the caller's auth.uid(). Only non-sensitive fields are
--  exposed (handle, power, level, zone, kills, fleet) — never the save blob.
-- =============================================================================

create table if not exists public.leaderboard (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text   not null default 'Operator',
  power      numeric not null default 0,
  level      int    not null default 1,
  zone       int    not null default 1,
  kills      numeric not null default 0,
  fleet      jsonb  not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists leaderboard_power_idx on public.leaderboard (power desc);

alter table public.leaderboard enable row level security;

-- Everyone can READ the board …
drop policy if exists "leaderboard_read" on public.leaderboard;
create policy "leaderboard_read" on public.leaderboard for select using (true);

-- … writes only via the function below (owner is always auth.uid()).
drop function if exists public.lb_upsert(text, bigint, int, int, bigint, jsonb);
drop function if exists public.lb_upsert(text, numeric, int, int, numeric, jsonb);
create or replace function public.lb_upsert(
  p_name text, p_power numeric, p_level int, p_zone int, p_kills numeric, p_fleet jsonb
) returns public.leaderboard
language plpgsql security definer set search_path = public as $$
declare result public.leaderboard;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, updated_at)
  values (auth.uid(), coalesce(nullif(p_name,''),'Operator'),
          greatest(0,coalesce(p_power,0)), greatest(1,coalesce(p_level,1)),
          greatest(1,coalesce(p_zone,1)), greatest(0,coalesce(p_kills,0)),
          coalesce(p_fleet,'[]'::jsonb), now())
  on conflict (user_id) do update set
     name=excluded.name, power=excluded.power, level=excluded.level,
     zone=excluded.zone, kills=excluded.kills, fleet=excluded.fleet, updated_at=now()
  returning * into result;
  return result;
end; $$;
grant execute on function public.lb_upsert(text, numeric, int, int, numeric, jsonb) to authenticated;
