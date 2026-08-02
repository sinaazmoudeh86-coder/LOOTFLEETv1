-- =============================================================================
--  lb-repair-seeded.sql — fill in the fields lb-seed-missing.sql left blank
--  ---------------------------------------------------------------------------
--  lb-seed-missing.sql took `power` from territory.fleet_score but wrote
--  placeholder 1 / 1 / 0 for level / zone / kills, because territory doesn't
--  carry them. Result: Falcor renders as "Zone 1 · Lv 1 · 0 kills" beside
--  154B power — self-evidently wrong, and it makes the whole row look fake.
--
--  The real values are in saves.data, the same blob account.js reads when it
--  publishes: level, highestDungeonReached, totalKills, ship, pasc.stars.
--
--  Only rows that are STILL placeholders get touched (level=1, zone=1,
--  kills=0). A row any client has genuinely published is never modified.
--
--  Safe to re-run.
-- =============================================================================

-- ---- 1. REPAIR EXISTING ROWS FROM THE SAVE BLOB -----------------------------
update public.leaderboard l
   set level     = greatest(coalesce((s.data->>'level')::int, 1), 1),
       zone      = greatest(coalesce((s.data->>'highestDungeonReached')::int, 1), 1),
       kills     = greatest(coalesce((s.data->>'totalKills')::bigint, 0), 0),
       asc_stars = greatest(coalesce((s.data->'pasc'->>'stars')::int, 0), 0),
       fleet     = case when s.data->>'ship' is not null
                        then jsonb_build_array(s.data->>'ship') else l.fleet end,
       name      = left(coalesce(nullif(s.data->>'name',''), l.name), 24),
       updated_at = now()
  from public.saves s
 where s.user_id = l.user_id
   and l.level = 1 and l.zone = 1 and l.kills = 0;   -- placeholder rows only

-- ---- 2. SEED FROM THE SAVE BLOB IN FUTURE -----------------------------------
-- Same trigger as before, but it now reads the save when one exists, so a
-- seeded row is complete from the first insert instead of needing this repair.
create or replace function public.lb_seed_from_territory()
returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if new.owner_id is null then return new; end if;
  select s.data into d from public.saves s where s.user_id = new.owner_id;
  insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, asc_stars, updated_at)
  values (new.owner_id,
          left(coalesce(nullif(d->>'name',''), new.owner_name, 'Operator'), 24),
          lf_clamp_power(new.fleet_score),
          greatest(coalesce((d->>'level')::int, 1), 1),
          greatest(coalesce((d->>'highestDungeonReached')::int, 1), 1),
          greatest(coalesce((d->>'totalKills')::bigint, 0), 0),
          case when d->>'ship' is not null then jsonb_build_array(d->>'ship') else '[]'::jsonb end,
          greatest(coalesce((d->'pasc'->>'stars')::int, 0), 0),
          now())
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function public.lb_seed_from_sdread()
returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if new.user_id is null then return new; end if;
  select s.data into d from public.saves s where s.user_id = new.user_id;
  insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, asc_stars, updated_at)
  values (new.user_id,
          left(coalesce(nullif(d->>'name',''), new.name, 'Operator'), 24),
          0,
          greatest(coalesce((d->>'level')::int, 1), 1),
          greatest(coalesce((d->>'highestDungeonReached')::int, 1), 1),
          greatest(coalesce((d->>'totalKills')::bigint, 0), 0),
          case when d->>'ship' is not null then jsonb_build_array(d->>'ship') else '[]'::jsonb end,
          greatest(coalesce((d->'pasc'->>'stars')::int, 0), 0),
          now())
  on conflict (user_id) do nothing;
  return new;
end $$;

-- ---- 3. WHO IS STILL INCOMPLETE? --------------------------------------------
-- Any row left here has real power but no save to read from, so the game
-- genuinely does not know their level/zone/kills. Handled client-side in
-- build 411: the Ranks row prints power alone rather than asserting "Zone 1".
select l.name,
       l.power,
       l.level,
       l.zone,
       l.kills,
       (s.user_id is not null) as has_save
  from public.leaderboard l
  left join public.saves s on s.user_id = l.user_id
 where l.level = 1 and l.zone = 1 and l.kills = 0 and l.power > 1000
 order by l.power desc;
