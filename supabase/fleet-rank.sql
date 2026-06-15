-- =============================================================================
--  Loot Fleet — FLEET RANK (real cross-account PvP ladder + async raids)
--  Run this in your Supabase project: Dashboard → SQL Editor → New query → Run.
--  Safe to run more than once.
--
--  This adds a SHARED, world-readable table of every operator's Fleet Rank
--  profile (power + saved defense snapshot), plus server-authoritative functions
--  for the leaderboard position, finding raid targets, and resolving a raid.
--
--  TRUST MODEL — matches the existing `saves` table: the browser reports its own
--  power numbers (an idle game, not competitive-stakes), but identity is ALWAYS
--  the caller's real auth.uid() (cannot be spoofed) and raid OUTCOMES are decided
--  here on the server, not in the client. The client blends in simulated rivals
--  so the ladder is never empty at launch.
-- =============================================================================

create table if not exists public.fleet_ranks (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  name          text   not null default 'Operator',
  fleet_power   bigint not null default 0,
  attack_power  bigint not null default 0,
  defense_value bigint not null default 0,
  cit_lvl       int    not null default 1,
  rank_idx      int    not null default 0,
  defense       jsonb  not null default '{}'::jsonb,   -- saved layout snapshot
  wins          int    not null default 0,
  losses        int    not null default 0,
  shield_until  timestamptz not null default now(),    -- raid-protection window
  updated_at    timestamptz not null default now()
);

-- fast "targets near my power" + leaderboard ordering
create index if not exists fleet_ranks_power_idx on public.fleet_ranks (fleet_power desc);

alter table public.fleet_ranks enable row level security;

-- Everyone can READ the shared ladder (leaderboard + finding opponents) …
drop policy if exists "fleet_ranks_read" on public.fleet_ranks;
create policy "fleet_ranks_read" on public.fleet_ranks for select using (true);

-- … but there are NO insert/update/delete policies, so the table can't be
-- written directly from the browser. All writes go through the functions below,
-- which run with elevated rights and always stamp the caller's real auth id.

-- ---------------------------------------------------------------------------
-- Register / update MY profile. Owner is always auth.uid(); wins/losses and the
-- raid-protection window are preserved across updates (only the client-reported
-- power + layout + name are refreshed).
-- ---------------------------------------------------------------------------
drop function if exists public.fr_upsert_profile(text, bigint, bigint, bigint, int, int, jsonb);
create or replace function public.fr_upsert_profile(
  p_name text, p_fleet_power bigint, p_attack_power bigint, p_defense_value bigint,
  p_cit_lvl int, p_rank_idx int, p_defense jsonb
) returns public.fleet_ranks
language plpgsql security definer set search_path = public as $$
declare result public.fleet_ranks;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.fleet_ranks
    (user_id, name, fleet_power, attack_power, defense_value, cit_lvl, rank_idx, defense, updated_at)
  values
    (auth.uid(), coalesce(nullif(p_name,''),'Operator'),
     greatest(0,coalesce(p_fleet_power,0)), greatest(0,coalesce(p_attack_power,0)),
     greatest(0,coalesce(p_defense_value,0)), coalesce(p_cit_lvl,1), coalesce(p_rank_idx,0),
     coalesce(p_defense,'{}'::jsonb), now())
  on conflict (user_id) do update set
     name          = excluded.name,
     fleet_power   = excluded.fleet_power,
     attack_power  = excluded.attack_power,
     defense_value = excluded.defense_value,
     cit_lvl       = excluded.cit_lvl,
     rank_idx      = excluded.rank_idx,
     defense       = excluded.defense,
     updated_at    = now()
  returning * into result;
  return result;
end; $$;
grant execute on function public.fr_upsert_profile(text, bigint, bigint, bigint, int, int, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- My global position = 1 + (number of operators with strictly more Fleet Power).
-- ---------------------------------------------------------------------------
drop function if exists public.fr_position(bigint);
create or replace function public.fr_position(p_power bigint)
returns int language sql stable security definer set search_path = public as $$
  select (1 + count(*))::int from public.fleet_ranks where fleet_power > greatest(0, coalesce(p_power,0));
$$;
grant execute on function public.fr_position(bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Raid targets: real opponents nearest MY power, excluding me and anyone still
-- inside their post-raid protection window.
-- ---------------------------------------------------------------------------
drop function if exists public.fr_targets(int);
create or replace function public.fr_targets(p_limit int default 8)
returns setof public.fleet_ranks
language sql stable security definer set search_path = public as $$
  select t.* from public.fleet_ranks t,
       (select coalesce((select fleet_power from public.fleet_ranks where user_id = auth.uid()),0) as mp) m
  where t.user_id <> auth.uid()
    and t.shield_until <= now()
  order by abs(t.fleet_power - m.mp) asc
  limit greatest(1, least(25, coalesce(p_limit,8)));
$$;
grant execute on function public.fr_targets(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Resolve a raid — SERVER-AUTHORITATIVE outcome.
--   • attacker is always auth.uid()
--   • can't raid yourself; defender must exist and not be shield-protected
--   • WIN  := attacker.attack_power >= defender.defense_value
--   • spoils (gold + galaxy) are derived from the defender's defenses, returned
--     to the client to apply to the real wallet (client-authoritative economy,
--     same as cloud saves)
--   • on a win the defender gets a 2-hour protection window so they can't be
--     farmed; win/loss tallies are recorded for both sides
-- Returns: { win, gold, galaxy, defender_name, attacker_wins, attacker_losses }
-- ---------------------------------------------------------------------------
drop function if exists public.fr_raid(uuid);
create or replace function public.fr_raid(p_defender uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  atk public.fleet_ranks;
  def public.fleet_ranks;
  win boolean;
  gold bigint := 0;
  galaxy bigint := 0;
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

-- Stream live ladder changes to all clients (optional; powers a live board).
do $$
begin
  begin
    alter publication supabase_realtime add table public.fleet_ranks;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;
