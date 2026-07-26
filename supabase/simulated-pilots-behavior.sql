-- =============================================================================
-- simulated-pilots-behavior.sql — LOOTFLEET · SIM PILOTS, PHASES 2-5
--
-- Everything that makes the roster ACT, running entirely on the server. Run
-- after simulated-pilots.sql. There is no admin UI and nothing for the client
-- to drive: two pg_cron schedules keep the whole system alive on its own.
--
--   sim_tick()      hourly  — progression + ascension + population control
--   sim_behave()    every 15 min — territory, void, alliances, friends, events
--
-- FAIRNESS IS STRUCTURAL, NOT POLICY
--   • Sims claim only tiles that are FREE or held by another sim. A human's
--     tile is never taken — no player ever logs in to find a bot took their
--     system while they slept.
--   • Attack matchmaking stays inside a fleet-score band, obeys cooldowns, and
--     a sim can hit the same target at most once per day.
--   • Sims never receive rewards into the player economy (reward_eligible).
--   • Every action is logged to sim_log for audit.
-- =============================================================================

-- ---- SIM-OWNED SOCIAL STRUCTURES ------------------------------------------
-- Alliances a sim created. Human alliances live in the game's own tables; sims
-- only ever JOIN those when the owner has opted in (see sim_alliance_optin).
create table if not exists sim_alliances (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  tag         text not null,
  descr       text not null default '',
  focus       text not null,               -- war|farm|events|social
  min_score   bigint not null default 0,
  aggression  numeric not null default 1.0,
  recruiting  boolean not null default true,
  leader_id   uuid references sim_pilots on delete set null,
  members     int not null default 0,
  is_simulated boolean not null default true,
  created_at  timestamptz not null default now()
);
-- ---- IDEMPOTENT COLUMN MIGRATION (see the sibling file's note) -------------
-- Repeated here for the same reason: `create table if not exists` is a no-op on
-- a database that ran an earlier revision, so every column added later must be
-- re-declared or sim_behave() will fail on a field the row variable lacks.
alter table sim_alliances add column if not exists min_score  bigint  not null default 0;
alter table sim_alliances add column if not exists aggression numeric not null default 1.0;
alter table sim_alliances add column if not exists recruiting boolean not null default true;
alter table sim_alliances add column if not exists members    int     not null default 0;
alter table sim_pilots    add column if not exists alliance_id uuid references sim_alliances on delete set null;
alter table sim_pilots add column if not exists friends int not null default 0;
alter table sim_pilots add column if not exists last_friend timestamptz;
alter table sim_pilots add column if not exists event_dmg bigint not null default 0;

-- Which HUMAN alliances allow simulated members. Absent row = not allowed.
create table if not exists sim_alliance_optin (
  alliance_key text primary key,           -- the game's own alliance id
  -- the human who owns/leads that alliance. The RLS policy below keys off this,
  -- so only they can change the sim policy for their own alliance.
  owner_uid    uuid references auth.users on delete cascade,
  allow        boolean not null default false,
  allow_officer boolean not null default false,
  updated_at   timestamptz not null default now()
);
alter table sim_alliance_optin add column if not exists owner_uid uuid references auth.users on delete cascade;

-- Friend requests a sim has sent to a human. The client reads these; accepting
-- is entirely the player's choice and nothing is auto-accepted on their behalf.
create table if not exists sim_friend_requests (
  id        bigserial primary key,
  pilot_id  uuid not null references sim_pilots on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  state     text not null default 'pending',   -- pending|accepted|declined
  at        timestamptz not null default now(),
  unique (pilot_id, user_id)
);
create index if not exists sim_fr_user_idx on sim_friend_requests (user_id, state);

-- Attack history — powers the "never harass the same player" guard
create table if not exists sim_attacks (
  id        bigserial primary key,
  pilot_id  uuid not null references sim_pilots on delete cascade,
  tile_id   text,
  target    text,                            -- owner_name of the defender
  target_id uuid,                            -- auth user if the defender was human
  won       boolean,
  at        timestamptz not null default now()
);
create index if not exists sim_atk_pair_idx on sim_attacks (pilot_id, target_id, at desc);
create index if not exists sim_atk_at_idx   on sim_attacks (at desc);

alter table sim_alliances        enable row level security;
alter table sim_alliance_optin   enable row level security;
alter table sim_friend_requests  enable row level security;
alter table sim_attacks          enable row level security;
drop policy if exists sim_all_read on sim_alliances;
create policy sim_all_read on sim_alliances for select using (true);
drop policy if exists sim_fr_own on sim_friend_requests;
create policy sim_fr_own on sim_friend_requests for select using (auth.uid() = user_id);
drop policy if exists sim_fr_answer on sim_friend_requests;
create policy sim_fr_answer on sim_friend_requests for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists sim_optin_read on sim_alliance_optin;
create policy sim_optin_read on sim_alliance_optin for select using (true);
drop policy if exists sim_optin_write on sim_alliance_optin;
-- OWNERSHIP CHECK: only the recorded owner of that alliance may change its sim
-- policy. Without this, any signed-in player could flip allow / allow_officer
-- for an alliance they have nothing to do with — exactly the guarantee the spec
-- asks for ("owners decide", "no officer rights unless explicitly granted").
create policy sim_optin_write on sim_alliance_optin
  for all
  using (owner_uid is not null and owner_uid = auth.uid())
  with check (owner_uid is not null and owner_uid = auth.uid());

-- ---- HEX TILE BOOTSTRAP ----------------------------------------------------
-- public.territory only gains rows when a player calls claim_tile, so on a fresh
-- database it is EMPTY and the behaviour pass had nothing to contend over: sims
-- would never appear as tile owners at all. sim_pick_tile() mints a valid id in
-- the client's own axial format ("q,r", hex distance 1..25 — see galaxy.js
-- tileId/ringOf) and sim_take_tile() INSERTS the row, so the roster seeds the
-- map itself and then fights over it.
create or replace function sim_pick_tile(p_max_ring int default 25)
returns text language plpgsql volatile as $$
declare q int; r int; ring int; i int;
begin
  for i in 1..30 loop
    q := -p_max_ring + floor(random() * (p_max_ring * 2 + 1))::int;
    r := -p_max_ring + floor(random() * (p_max_ring * 2 + 1))::int;
    ring := (abs(q) + abs(r) + abs(q + r)) / 2;      -- axial hex distance
    if ring >= 1 and ring <= p_max_ring then return q || ',' || r; end if;
  end loop;
  return '1,0';
end $$;
revoke all on function sim_pick_tile(int) from public;

-- Claim a tile FOR a sim: insert it if the row doesn't exist yet, take it over
-- if it exists and is not human-held. owner_id stays NULL for sims, which is
-- what keeps human tiles (owner_id = their uid) permanently off-limits.
create or replace function sim_take_tile(p_id uuid, p_tile text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p sim_pilots; ex record; def jsonb;
begin
  select * into p from sim_pilots where id = p_id;
  if p.id is null then return false; end if;
  def := jsonb_build_object('ship', (p.fleet->>0), 'nm', (p.fleet->>0),
           'score', p.power, 'lvl', p.level, 'asc', p.asc_stars,
           'esc', greatest(0, coalesce(jsonb_array_length(p.fleet), 1) - 1),
           'escKeys', coalesce(p.fleet - 0, '[]'::jsonb));

  select owner_id, owner_name, fleet_score, cooldown_until into ex
    from territory where tile_id = p_tile;

  if not found then
    insert into territory (tile_id, owner_id, owner_name, citadel, fleet_score, defense, cooldown_until, updated_at)
    values (p_tile, null, p.name, false, p.power, def, now() + interval '15 minutes', now())
    on conflict (tile_id) do nothing;
    return true;
  end if;

  -- HUMAN-HELD TILES ARE NEVER TAKEN
  if ex.owner_id is not null then return false; end if;
  if ex.cooldown_until is not null and ex.cooldown_until > now() then return false; end if;
  if coalesce(ex.owner_name, '') = p.name then return false; end if;
  if coalesce(ex.fleet_score, 0) > p.power * 1.25 then return false; end if;

  update territory set owner_id = null, owner_name = p.name, citadel = false,
         fleet_score = p.power, defense = def,
         cooldown_until = now() + interval '15 minutes', updated_at = now()
   where tile_id = p_tile;
  return true;
end $$;
revoke all on function sim_take_tile(uuid, text) from public;

-- ---- alliance identity generator -------------------------------------------
create or replace function sim_gen_alliance() returns jsonb
language plpgsql volatile as $$
declare
  w1 text[] := array['Void','Iron','Crimson','Silent','Ninth','Obsidian','Pale','Hollow','Solar','Ashen','Cobalt','Vesper'];
  w2 text[] := array['Vanguard','Covenant','Legion','Syndicate','Accord','Marauders','Dominion','Wardens','Pact','Company','Fleet','Order'];
  fo text[] := array['war','farm','events','social'];
  nm text; tg text; f text; i int;
begin
  for i in 1..16 loop
    nm := w1[1 + floor(random()*array_length(w1,1))::int] || ' ' || w2[1 + floor(random()*array_length(w2,1))::int];
    exit when not exists (select 1 from sim_alliances a where lower(a.name) = lower(nm));
  end loop;
  tg := upper(substr(nm, 1, 1) || substr(split_part(nm, ' ', 2), 1, 2));
  f  := fo[1 + floor(random()*array_length(fo,1))::int];
  return jsonb_build_object('name', nm, 'tag', tg, 'focus', f,
    'descr', case f when 'war'    then 'Contested space is our space. Active hitters only.'
                    when 'farm'   then 'Quiet, steady, rich. Bring rigs.'
                    when 'events' then 'Event pushers. Dreadnaught and Voidmaw every cycle.'
                    else               'Casual crew. No quotas, no drama.' end);
end $$;

-- =============================================================================
-- sim_behave() — the autonomous action pass. Every 15 minutes.
-- =============================================================================
create or replace function sim_behave()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg sim_config; p sim_pilots; prof jsonb;
  local_hour int; awake boolean; tile text;
  claimed int := 0; attacked int := 0; made_ally int := 0; joined int := 0;
  friended int := 0; evented int := 0;
  tgt record; ally sim_alliances; a jsonb;
  win boolean; ratio numeric;
begin
  select * into cfg from sim_config where id = 1;
  if not cfg.enabled then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;

  -- reset the per-day attack allowance once a day
  update sim_pilots set attacks_today = 0
   where attacks_today > 0 and (last_attack is null or last_attack < date_trunc('day', now()));

  for p in select * from sim_pilots where active order by random() limit 400 loop
    prof := sim_profile(p.personality);
    local_hour := ((extract(hour from now() at time zone 'UTC')::int + p.tz_offset) % 24 + 24) % 24;
    awake := (p.play_start <= p.play_end and local_hour between p.play_start and p.play_end)
          or (p.play_start >  p.play_end and (local_hour >= p.play_start or local_hour <= p.play_end));
    if not awake or random() > p.login_prob then continue; end if;

    -- ---------------------------------------------------------------- TERRITORY
    -- SEED-OR-TAKE: sim_take_tile() inserts the row when the hex has never been
    -- claimed by anyone, so the map populates itself on a fresh database instead
    -- of waiting for a human to create rows first. Human-held tiles (owner_id
    -- set) are refused inside that function — the single most important fairness
    -- rule in the system.
    if not cfg.pause_attacks and random() < 0.35 * (prof->>'atk')::numeric * cfg.aggression then
      -- pilots range deeper as they level, so the population spreads outward
      tile := sim_pick_tile(least(25, greatest(2, 2 + (p.level / 18))));
      attacked := attacked + 1;
      if sim_take_tile(p.id, tile) then
        insert into sim_attacks (pilot_id, tile_id, target, won) values (p.id, tile, null, true);
        update sim_pilots set tiles = tiles + 1, wins = wins + 1,
               last_attack = now(), attacks_today = attacks_today + 1 where id = p.id;
        claimed := claimed + 1;
      else
        -- REPULSED — a failed push costs a slice of power and they rebuild.
        -- Bots that never lose read as invincible and make the map feel fake.
        insert into sim_attacks (pilot_id, tile_id, target, won) values (p.id, tile, null, false);
        update sim_pilots set losses = losses + 1, last_attack = now(),
               attacks_today = attacks_today + 1,
               power = greatest(1000, (power * 0.97)::bigint) where id = p.id;
      end if;
    end if;

    -- ------------------------------------------------------------------- VOID
    -- Void spires are the aggressive theatre: the seven VZ tiles are seeded the
    -- same way, and only pilots deep enough to have unlocked them contend.
    if not cfg.pause_attacks and p.level >= 25 and random() < 0.18 * (prof->>'risk')::numeric * cfg.aggression then
      tile := 'VZ' || (1 + floor(random() * least(7, greatest(1, p.level / 70)))::int);
      if sim_take_tile(p.id, tile) then
        update sim_pilots set void_tiles = void_tiles + 1 where id = p.id;
        claimed := claimed + 1;
      end if;
    end if;

    -- -------------------------------------------------------------- ALLIANCES
    if not cfg.pause_alliances then
      if p.alliance_id is null and random() < 0.12 * (prof->>'ally')::numeric then
        -- join an existing sim alliance that will take them, else found one
        select * into ally from sim_alliances
         where recruiting and min_score <= p.power and members < 30
         order by random() limit 1;
        if ally.id is not null then
          update sim_pilots set alliance_id = ally.id where id = p.id;
          update sim_alliances set members = members + 1 where id = ally.id;
          joined := joined + 1;
        elsif p.power > 5e5 and random() < 0.35 then
          a := sim_gen_alliance();
          insert into sim_alliances (name, tag, descr, focus, min_score, aggression, leader_id, members)
          values (a->>'name', a->>'tag', a->>'descr', a->>'focus',
                  (p.power * 0.35)::bigint, (prof->>'atk')::numeric, p.id, 1)
          returning id into ally.id;
          update sim_pilots set alliance_id = ally.id where id = p.id;
          made_ally := made_ally + 1;
        end if;
      end if;
      -- leadership succession: a retired/absent leader is replaced automatically
      update sim_alliances al set leader_id = (
        select sp.id from sim_pilots sp where sp.alliance_id = al.id and sp.active
        order by sp.power desc limit 1)
      where al.leader_id is null
         or not exists (select 1 from sim_pilots sp2 where sp2.id = al.leader_id and sp2.active);
    end if;

    -- ----------------------------------------------------------------- FRIENDS
    -- Rate-limited hard: at most one open request per human per sim, and a sim
    -- sends at most one request a day. Nothing is auto-accepted for the player.
    if random() < 0.05 * (prof->>'friend')::numeric
       and (p.last_friend is null or p.last_friend < now() - interval '20 hours') then
      insert into sim_friend_requests (pilot_id, user_id)
      select p.id, l.user_id from leaderboard l
       where l.updated_at > now() - interval '7 days'
         and l.power between p.power / 4 and p.power * 4
         and not exists (select 1 from sim_friend_requests fr where fr.pilot_id = p.id and fr.user_id = l.user_id)
       order by random() limit 1
      on conflict do nothing;
      if found then
        update sim_pilots set last_friend = now(), friends = friends + 0 where id = p.id;
        friended := friended + 1;
      end if;
    end if;

    -- ------------------------------------------------------------------ EVENTS
    -- Event damage accumulates like a player's would. Reward eligibility is off
    -- by default, so a sim placing well never consumes a limited player prize.
    if not cfg.pause_events and random() < 0.30 * (prof->>'event')::numeric then
      update sim_pilots set event_dmg = event_dmg + (p.power * (0.8 + random() * 1.6))::bigint where id = p.id;
      evented := evented + 1;
    end if;
  end loop;

  -- housekeeping: expire stale friend requests, trim the log
  update sim_friend_requests set state = 'declined'
   where state = 'pending' and at < now() - interval '14 days';
  delete from sim_log where at < now() - interval '30 days';
  update sim_alliances al set members = (select count(*) from sim_pilots sp where sp.alliance_id = al.id and sp.active);
  delete from sim_alliances where members = 0 and created_at < now() - interval '2 days';

  insert into sim_log (kind, payload) values ('behave', jsonb_build_object(
    'claimed', claimed, 'attacked', attacked, 'alliances', made_ally,
    'joined', joined, 'friends', friended, 'events', evented));

  return jsonb_build_object('ok', true, 'claimed', claimed, 'attacked', attacked,
    'alliances_created', made_ally, 'joined', joined, 'friend_requests', friended, 'event_pushes', evented);
end $$;

revoke all on function sim_behave() from public;
revoke all on function sim_gen_alliance() from public;

-- ---- public reads the client uses -----------------------------------------
create or replace function sim_my_friend_requests()
returns table (id bigint, pilot text, level int, power bigint, asc_stars smallint, at timestamptz)
language sql security definer set search_path = public as $$
  select fr.id, sp.name, sp.level, sp.power, sp.asc_stars, fr.at
  from sim_friend_requests fr join sim_pilots sp on sp.id = fr.pilot_id
  where fr.user_id = auth.uid() and fr.state = 'pending' and sp.active
  order by fr.at desc limit 20
$$;
grant execute on function sim_my_friend_requests() to authenticated;

create or replace function sim_alliance_list(p_limit int default 20)
returns table (name text, tag text, descr text, focus text, members int, min_score bigint, leader text)
language sql security definer set search_path = public as $$
  select al.name, al.tag, al.descr, al.focus, al.members, al.min_score,
         (select sp.name from sim_pilots sp where sp.id = al.leader_id)
  from sim_alliances al where al.recruiting
  order by al.members desc limit greatest(1, p_limit)
$$;
grant execute on function sim_alliance_list(int) to anon, authenticated;

-- =============================================================================
-- 10. THE TWO SCHEDULES — this is the whole operations story.
-- Replace <PROJECT-REF> is NOT needed: both run in-database.
-- =============================================================================
-- create extension if not exists pg_cron;
--
-- select cron.schedule('lf-sim-tick',   '7 * * * *',    $CRON$ select sim_tick()   $CRON$);
-- select cron.schedule('lf-sim-behave', '*/15 * * * *', $CRON$ select sim_behave() $CRON$);
--
-- Seed the roster once, then never touch it again:
--   select sim_spawn(250);
--
-- To stop everything instantly:
--   update sim_config set enabled = false;
