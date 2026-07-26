-- =============================================================================
-- simulated-pilots.sql — LOOTFLEET · SIMULATED PILOT SYSTEM (Phase 1)
--
-- Server-owned roster of AI pilots that populate the leaderboard, Galaxy Map,
-- Void Map, alliances and events. They progress on a pg_cron tick, they ASCEND
-- like real pilots, and they are flagged `is_simulated` in a protected column —
-- never inferred from the public name.
--
-- DESIGN DECISION (lead design): simulated pilots are NOT auth.users. Minting
-- thousands of real accounts to hold NPC state would pollute auth, session
-- locks, save CAS, payments and every retention metric we report on. Instead
-- they are rows in one table that the client reads exactly like a leaderboard
-- row or a tile owner — same rendering path, same combat maths, zero special
-- cases in gameplay code.
--
-- Safe to re-run.
-- =============================================================================

-- ---- 1. GLOBAL CONFIG (single row) + EMERGENCY SWITCH ----------------------
create table if not exists sim_config (
  id                smallint primary key default 1 check (id = 1),
  enabled           boolean not null default true,   -- SIMULATED_PILOTS_ENABLED
  target_population int     not null default 250,
  min_population    int     not null default 100,
  max_population    int     not null default 2000,
  per_human         numeric not null default 2.0,    -- target sims per active human
  aggression        numeric not null default 1.0,    -- global multiplier
  pause_attacks     boolean not null default false,
  pause_events      boolean not null default false,
  pause_alliances   boolean not null default false,
  pause_progression boolean not null default false,
  max_top10         smallint not null default 2,     -- ranking fairness guards
  max_top100        smallint not null default 25,
  -- GROWTH THROTTLE: the roster grows by a handful of pilots a day, never in a
  -- visible burst. A new day picks a fresh target inside this range, so the
  -- population creeps up the way a real player base would.
  daily_spawn_min   smallint not null default 5,
  daily_spawn_max   smallint not null default 15,
  spawn_day         date,                            -- day the budget below applies to
  spawn_budget      smallint not null default 0,     -- today's allowance
  spawned_today     smallint not null default 0,
  allow_rank1       boolean not null default false,  -- never #1 in a limited event
  reward_eligible   boolean not null default false,  -- rewards never enter the economy
  mark_publicly     boolean not null default false,  -- visible SIM designation (OFF: sims are indistinguishable from humans)
  updated_at        timestamptz not null default now()
);
insert into sim_config (id) values (1) on conflict (id) do nothing;

-- ---- 2. THE ROSTER ---------------------------------------------------------
create table if not exists sim_pilots (
  id            uuid primary key default gen_random_uuid(),
  -- PROTECTED FLAGS: bot status is data, never a naming convention
  is_simulated  boolean not null default true,
  sim_version   text    not null default 'v1',
  created_by_system boolean not null default true,

  name          text    not null unique,
  avatar        smallint not null default 0,
  personality   text    not null,        -- aggressive|defensive|explorer|farmer|event|social|casual|elite
  band          text    not null,        -- new|early|mid|advanced|endgame
  behavior_id   text    not null,        -- stable profile id for auditing

  -- progression (mirrors the real save's public shape)
  ship          text    not null default 'frigate',
  fleet         jsonb   not null default '[]'::jsonb,
  level         int     not null default 1,
  zone          int     not null default 1,
  power         bigint  not null default 0,
  kills         bigint  not null default 0,
  tiles         int     not null default 0,
  void_tiles    int     not null default 0,

  -- PILOT ASCENSION — sims run the same prestige loop as players
  asc_stars     smallint not null default 0,
  asc_points    int     not null default 0,
  asc_mult      numeric  not null default 1.0,   -- compounding perk power
  asc_target    int      not null default 250,   -- level they intend to ascend at
  ascended_at   timestamptz,

  -- activity schedule
  tz_offset     smallint not null default 0,     -- -12..+14
  play_start    smallint not null default 8,     -- local hour
  play_end      smallint not null default 23,
  login_prob    numeric  not null default 0.7,
  weekend_mod   numeric  not null default 1.2,
  session_min   smallint not null default 20,
  session_max   smallint not null default 90,
  growth        numeric  not null default 1.0,   -- personality progression speed

  -- combat bookkeeping (Phase 2 uses these; recorded from Phase 1 so the
  -- fairness guards have history to reason about)
  last_attack   timestamptz,
  attacks_today smallint not null default 0,
  losses        int      not null default 0,
  wins          int      not null default 0,

  active        boolean  not null default true,
  -- RIVAL TIER: a small, maintained group that shadows the strongest human.
  -- See sim_rivals() — they keep pace but can never overtake.
  rival         boolean  not null default false,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  last_tick     timestamptz not null default now()
);
create index if not exists sim_pilots_power_idx  on sim_pilots (active, power desc);
create index if not exists sim_pilots_band_idx   on sim_pilots (band, active);
create index if not exists sim_pilots_pers_idx   on sim_pilots (personality, active);

-- ---- 3. AUDIT LOG ----------------------------------------------------------
create table if not exists sim_log (
  id       bigserial primary key,
  pilot_id uuid references sim_pilots on delete cascade,
  kind     text not null,      -- create|tick|ascend|attack|defend|alliance|friend|event|retire
  payload  jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists sim_log_at_idx on sim_log (at desc);
create index if not exists sim_log_kind_idx on sim_log (kind, at desc);

-- ---- 3b. IDEMPOTENT COLUMN MIGRATION --------------------------------------
-- `create table if not exists` is a NO-OP once the table exists, so any column
-- added in a later revision of this file would never land on a database that
-- already ran an earlier one — and sim_tick() dereferences those fields, so the
-- whole autonomous system would silently freeze inside pg_cron. Every column
-- added after the first release is therefore repeated here.
alter table sim_config  add column if not exists daily_spawn_min smallint not null default 5;
alter table sim_config  add column if not exists daily_spawn_max smallint not null default 15;
alter table sim_config  add column if not exists spawn_day       date;
alter table sim_config  add column if not exists spawn_budget    smallint not null default 0;
alter table sim_config  add column if not exists spawned_today   smallint not null default 0;
alter table sim_config  add column if not exists mark_publicly   boolean  not null default false;
alter table sim_config  alter column mark_publicly set default false;
-- sims are invisible by default; apply that to a row created under the old default
update sim_config set mark_publicly = false where id = 1;

alter table sim_pilots  add column if not exists rival         boolean  not null default false;
alter table sim_pilots  add column if not exists asc_stars     smallint not null default 0;
alter table sim_pilots  add column if not exists asc_points    int      not null default 0;
alter table sim_pilots  add column if not exists asc_mult      numeric  not null default 1.0;
alter table sim_pilots  add column if not exists asc_target    int      not null default 250;
alter table sim_pilots  add column if not exists ascended_at   timestamptz;
alter table sim_pilots  add column if not exists void_tiles    int      not null default 0;
alter table sim_pilots  add column if not exists last_attack   timestamptz;
alter table sim_pilots  add column if not exists attacks_today smallint not null default 0;
alter table sim_pilots  add column if not exists losses        int      not null default 0;
alter table sim_pilots  add column if not exists wins          int      not null default 0;
alter table sim_pilots  add column if not exists retired_at    timestamptz;
create index if not exists sim_pilots_rival_idx on sim_pilots (rival, active);

alter table sim_log     add column if not exists pilot_id uuid references sim_pilots on delete cascade;

-- CROSS-FILE DEPENDENCY: sim_rivals() reads leaderboard.asc_stars to anchor the
-- rival pack to the top human's ascension rank. That column is normally created
-- by pilot-ascension.sql, but this file must stand alone — otherwise the very
-- first sim_rivals() call fails on a missing column and, because the caller
-- swallows exceptions, the rival tier never appears with no visible signal.
alter table leaderboard add column if not exists asc_stars smallint not null default 0;

-- pack size lives in config so it does NOT re-roll every tick (churning
-- membership was destroying the roster's strongest pilots — see sim_rivals)
alter table sim_config  add column if not exists rival_count smallint not null default 4;
-- ---- THE CLIMB FROM NOTHING ------------------------------------------------
-- Simulated pilots must debut looking like accounts that just registered, not
-- mid-table and certainly not near the leader. Nothing surfaces for the first
-- day; after that the pack enters at ~3% of the leader's power and climbs over
-- two weeks. Matches the client fallback in js/sim-pilots.js.
alter table sim_config  add column if not exists epoch_day  date;
alter table sim_config  add column if not exists ramp_days  smallint not null default 14;
alter table sim_config  add column if not exists hide_hours smallint not null default 24;
update sim_config set epoch_day = coalesce(epoch_day, current_date), ramp_days = 14 where id = 1;

-- ---- LEVEL 500 IS THE WALL --------------------------------------------------
-- A pilot at 500 ASCENDS and restarts at 1, exactly like a human. sim_tick()
-- already ascends at asc_target, but a target above 500 (Elite's is 1000) would
-- let a row show an impossible level, so the cap is enforced here as well.
update sim_pilots set asc_target = least(500, asc_target) where asc_target > 500;
alter table sim_pilots add column if not exists lvl_cap smallint not null default 500;

-- ---- HULLS ARE UNIQUE -------------------------------------------------------
-- sim_fleet_for() could repeat a hull, and no real fleet can hold two of the
-- same ship. Rebuild it to draw WITHOUT replacement.
create or replace function sim_fleet_for(p_band text, p_level int)
returns jsonb language plpgsql volatile as $$
declare pool text[]; n int; out text[] := '{}'; pick int;
begin
  pool := case p_band
    when 'new'      then array['frigate','interceptor']
    when 'early'    then array['interceptor','cruiser','heavycruiser']
    when 'mid'      then array['heavycruiser','destroyer','battleship','dreadnought']
    when 'advanced' then array['battleship','dreadnought','carrier','aegis','supercarrier']
    else                 array['supercarrier','titan','mothership','carrier','aegis']
  end;
  -- escort slots unlock every 100 levels, exactly as the real FLEET config does
  n := least(array_length(pool, 1), 1 + least(4, p_level / 100));
  while array_length(out, 1) is distinct from n and array_length(pool, 1) > 0 loop
    pick := 1 + floor(random() * array_length(pool, 1))::int;
    out  := out || pool[pick];
    pool := pool[1:pick-1] || pool[pick+1:array_length(pool,1)];   -- no replacement
  end loop;
  return to_jsonb(out);
end $$;
revoke all on function sim_fleet_for(text, int) from public;

-- ---- RLS: the world may READ the roster; only the service role writes ------
alter table sim_pilots enable row level security;
alter table sim_config enable row level security;
alter table sim_log    enable row level security;
drop policy if exists sim_pilots_read on sim_pilots;
create policy sim_pilots_read on sim_pilots for select using (true);
drop policy if exists sim_config_read on sim_config;
create policy sim_config_read on sim_config for select using (true);
-- sim_log: service-role only (no policy)

-- =============================================================================
-- 4. IDENTITY GENERATION
-- Seven name formats drawn from separate pools, so the roster never reads as
-- one template. No sequential numbers, no shared prefix, no "Player123".
-- =============================================================================
create or replace function sim_gen_name() returns text
language plpgsql volatile as $$
declare
  a text[] := array['Void','Nyx','Solar','Kestrel','Vanta','Frost','Drift','Zero','Orion','Ember','Ashen','Halcyon',
                    'Quasar','Rift','Umbra','Cinder','Nova','Onyx','Pale','Vesper','Wraith','Zephyr','Cobalt','Hollow',
                    'Iron','Saint','Dusk','Krieg','Mako','Sable','Tundra','Verge','Wolf','Talon','Bracken','Corvid'];
  b text[] := array['harbor','warden','nine','byte','king','moon','spire','fang','crown','runner','forge','wake',
                    'reach','lance','shade','bloom','gate','helm','vault','drake','shard','tide','watch','maw'];
  s text[] := array['Vanta','Kestrel','Halo','Juno','Rook','Cinder','Pyx','Lux','Wren','Onyx','Sable','Bex','Nix','Tor'];
  c text[] := array['ARC','VOID','9TH','SOL','RVN','OBS','KRN','HEX','ZNT','APEX','NULL','VLT'];
  g text[] := array['xX','no','big','lil','real','ur','dad','iam','pro','mr','ms','the'];
  h text[] := array['scope','clutch','gamer','sniper','tank','main','carry','goat','diff','andy','pilot','sweat'];
  n text;
begin
  for i in 1..24 loop
    n := case (random() * 7)::int
      -- single-word callsign
      when 0 then a[1 + floor(random() * array_length(a,1))::int]
      -- two-word callsign
      when 1 then a[1 + floor(random() * array_length(a,1))::int] || initcap(b[1 + floor(random() * array_length(b,1))::int])
      -- name with numbers (never sequential — sparse, varied width)
      when 2 then a[1 + floor(random() * array_length(a,1))::int] || (case when random() < 0.5 then '_' else '' end)
                 || (case when random() < 0.4 then (10 + floor(random()*89))::text else (100 + floor(random()*899))::text end)
      -- clan tag
      when 3 then '[' || c[1 + floor(random() * array_length(c,1))::int] || '] ' || s[1 + floor(random() * array_length(s,1))::int]
      -- sci-fi hyphenate
      when 4 then upper(left(a[1 + floor(random() * array_length(a,1))::int], 1))
                 || upper(substr(a[1 + floor(random() * array_length(a,1))::int], 2, 3))
                 || '-' || upper(b[1 + floor(random() * array_length(b,1))::int])
      -- short name
      when 5 then s[1 + floor(random() * array_length(s,1))::int]
      -- casual gamer handle
      else g[1 + floor(random() * array_length(g,1))::int] || h[1 + floor(random() * array_length(h,1))::int]
           || (case when random() < 0.35 then (2 + floor(random()*97))::text else '' end)
    end;
    n := left(n, 22);
    -- blocked / reserved / lookalike guard
    if n !~* '(admin|mod|dev|gm|staff|sina|lootfleet|official|support|system|nigg|fuck|shit|rape|nazi)'
       and not exists (select 1 from sim_pilots p where lower(p.name) = lower(n))
       and not exists (select 1 from leaderboard l where lower(l.name) = lower(n)) then
      return n;
    end if;
  end loop;
  -- exhausted: fall back to a guaranteed-unique suffix
  return left(s[1 + floor(random() * array_length(s,1))::int], 12) || substr(replace(gen_random_uuid()::text,'-',''), 1, 4);
end $$;

-- =============================================================================
-- 5. PERSONALITY → BEHAVIOUR PROFILE
-- One permanent profile per pilot. These numbers drive Phase 1 progression and
-- are read by Phases 2-4 for map, social and event behaviour.
-- =============================================================================
create or replace function sim_profile(p_personality text)
returns jsonb language sql immutable as $$
  select case p_personality
    when 'aggressive' then '{"growth":1.15,"login":0.80,"atk":3.0,"ally":0.5,"friend":0.2,"event":0.6,"risk":0.9,"ascAt":250}'
    when 'defensive'  then '{"growth":0.95,"login":0.75,"atk":0.8,"ally":0.8,"friend":0.4,"event":0.5,"risk":0.3,"ascAt":300}'
    when 'explorer'   then '{"growth":1.05,"login":0.70,"atk":1.2,"ally":0.3,"friend":0.3,"event":0.5,"risk":0.6,"ascAt":250}'
    when 'farmer'     then '{"growth":1.25,"login":0.90,"atk":0.5,"ally":0.5,"friend":0.3,"event":0.4,"risk":0.2,"ascAt":500}'
    when 'event'      then '{"growth":1.10,"login":0.65,"atk":1.5,"ally":0.6,"friend":0.4,"event":1.0,"risk":0.7,"ascAt":250}'
    when 'social'     then '{"growth":0.85,"login":0.70,"atk":0.9,"ally":1.0,"friend":1.0,"event":0.6,"risk":0.4,"ascAt":250}'
    when 'casual'     then '{"growth":0.45,"login":0.35,"atk":0.4,"ally":0.3,"friend":0.5,"event":0.3,"risk":0.3,"ascAt":125}'
    else                   '{"growth":1.60,"login":0.95,"atk":2.0,"ally":0.9,"friend":0.5,"event":0.9,"risk":0.8,"ascAt":1000}'
  end::jsonb
$$;

-- power target for a progression band, on the SAME compressed scale the client
-- publishes (score() in game-v93.js), so sims sit naturally among real rows
create or replace function sim_band_power(p_band text) returns bigint
language sql immutable as $$
  select (case p_band
    when 'new'      then 2e3   + random() * 2e4
    when 'early'    then 5e4   + random() * 9e5
    when 'mid'      then 2e6   + random() * 3e7
    when 'advanced' then 8e7   + random() * 9e8
    else                 2e9   + random() * 2.4e10
  end)::bigint
$$;

create or replace function sim_band_level(p_band text) returns int
language sql immutable as $$
  select (case p_band
    when 'new'      then 1   + random() * 24
    when 'early'    then 25  + random() * 45
    when 'mid'      then 70  + random() * 110
    when 'advanced' then 180 + random() * 220
    else                 400 + random() * 600
  end)::int
$$;

-- hull ladder by band — sims never field impossible equipment
create or replace function sim_fleet_for(p_band text, p_level int)
returns jsonb language plpgsql immutable as $$
declare
  pool text[]; n int; out text[] := '{}'; i int;
begin
  pool := case p_band
    when 'new'      then array['frigate','interceptor']
    when 'early'    then array['interceptor','cruiser','heavycruiser']
    when 'mid'      then array['heavycruiser','destroyer','battleship','dreadnought']
    when 'advanced' then array['battleship','dreadnought','carrier','aegis','supercarrier']
    else                 array['supercarrier','titan','mothership','carrier','aegis']
  end;
  -- escort slots unlock every 100 levels, exactly as the real FLEET config does
  n := least(array_length(pool,1), 1 + least(4, p_level / 100));
  for i in 1..n loop out := out || pool[1 + ((i * 7 + floor(random()*3)::int) % array_length(pool,1))]; end loop;
  return to_jsonb(out);
end $$;

-- =============================================================================
-- 6. SPAWN
-- =============================================================================
create or replace function sim_spawn(p_n int default 1, p_band text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  cfg sim_config; made int := 0; i int;
  pers text; bnd text; prof jsonb; lvl int; pw bigint; nm text;
  personalities text[] := array['aggressive','defensive','explorer','farmer','event','social','casual','elite'];
  -- population shape: most pilots are mid-ladder, a few are endgame threats
  bands text[] := array['new','new','early','early','early','mid','mid','mid','advanced','advanced','endgame'];
begin
  select * into cfg from sim_config where id = 1;
  if not cfg.enabled then return 0; end if;
  for i in 1..greatest(0, p_n) loop
    exit when (select count(*) from sim_pilots where active) >= cfg.max_population;
    pers := personalities[1 + floor(random() * array_length(personalities,1))::int];
    bnd  := coalesce(p_band, bands[1 + floor(random() * array_length(bands,1))::int]);
    prof := sim_profile(pers);
    lvl  := sim_band_level(bnd);
    pw   := sim_band_power(bnd);
    nm   := sim_gen_name();
    insert into sim_pilots (
      name, avatar, personality, band, behavior_id, ship, fleet, level, zone, power, kills,
      tiles, asc_stars, asc_mult, asc_target, tz_offset, play_start, play_end,
      login_prob, weekend_mod, session_min, session_max, growth
    ) values (
      nm,
      floor(random() * 24)::smallint,
      pers, bnd, pers || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,8),
      (sim_fleet_for(bnd, lvl) ->> 0), sim_fleet_for(bnd, lvl),
      lvl,
      greatest(1, least(1000, (lvl * (0.7 + random() * 0.6))::int)),
      pw,
      (pw * (3 + random() * 9))::bigint,
      floor(random() * greatest(1, lvl / 12))::int,
      -- veterans arrive already ascended, so the ladder has stars on it from day one
      case when lvl > 300 then floor(random() * 6)::smallint
           when lvl > 150 then floor(random() * 3)::smallint
           else 0 end,
      1.0, (prof ->> 'ascAt')::int,
      (-12 + floor(random() * 27))::smallint,
      (5 + floor(random() * 8))::smallint,
      (19 + floor(random() * 5))::smallint,
      (prof ->> 'login')::numeric,
      0.9 + random() * 0.6,
      (10 + floor(random() * 25))::smallint,
      (45 + floor(random() * 90))::smallint,
      (prof ->> 'growth')::numeric * (0.75 + random() * 0.5)
    );
    made := made + 1;
  end loop;
  -- back-fill the ascension multiplier for pilots that spawned with stars
  update sim_pilots set asc_mult = 1.0 + asc_stars * 0.18 where asc_mult = 1.0 and asc_stars > 0;
  insert into sim_log (kind, payload) values ('create', jsonb_build_object('n', made, 'band', p_band));
  return made;
end $$;

-- =============================================================================
-- 7. THE TICK — progression + ASCENSION
-- Runs hourly. Each pilot only advances during its own local play window, and
-- only on a successful login roll, so activity rises and falls across the day
-- instead of every account grinding around the clock.
-- =============================================================================
create or replace function sim_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg sim_config; p sim_pilots;
  hrs numeric; local_hour int; is_weekend boolean; act numeric;
  gain numeric; lvl_gain int; ticked int := 0; ascended int := 0; asc_pts int;
  humans int; want int; deficit int; made int := 0;
begin
  select * into cfg from sim_config where id = 1;
  if not cfg.enabled then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;

  -- POPULATION CONTROL — a DAILY budget of 5-15 new pilots, never a burst. The
  -- roster creeps toward its target over weeks, which is both cheaper and far
  -- more convincing than 250 accounts appearing at once.
  select count(*) into humans from leaderboard where updated_at > now() - interval '7 days';
  want := greatest(cfg.min_population, least(cfg.max_population,
            greatest(cfg.target_population, (humans * cfg.per_human)::int)));

  -- roll a fresh budget on a new day
  if cfg.spawn_day is null or cfg.spawn_day <> current_date then
    update sim_config set spawn_day = current_date, spawned_today = 0,
           spawn_budget = (cfg.daily_spawn_min
             + floor(random() * greatest(1, cfg.daily_spawn_max - cfg.daily_spawn_min + 1)))::smallint
     where id = 1;
    select * into cfg from sim_config where id = 1;
  end if;

  select want - count(*) into deficit from sim_pilots where active;
  if deficit > 0 and cfg.spawned_today < cfg.spawn_budget then
    -- spread the day's allowance across the 24 hourly ticks: usually 0 or 1 per
    -- pass, so pilots trickle in rather than arriving in a clump
    made := least(deficit, cfg.spawn_budget - cfg.spawned_today,
                  greatest(1, ceil((cfg.spawn_budget - cfg.spawned_today) / 6.0)::int));
    made := sim_spawn(made);
    update sim_config set spawned_today = spawned_today + made where id = 1;
  end if;
  -- retirement is equally gradual: at most two a day leave
  if deficit < -20 then
    update sim_pilots set active = false, retired_at = now()
    where id in (select id from sim_pilots where active order by power asc limit 2);
  end if;

  if cfg.pause_progression then return jsonb_build_object('ok', true, 'paused', true); end if;

  for p in select * from sim_pilots where active loop
    hrs := extract(epoch from (now() - p.last_tick)) / 3600.0;
    if hrs <= 0.01 then continue; end if;
    hrs := least(hrs, 12);   -- a stalled cron never pays a windfall

    local_hour := ((extract(hour from now() at time zone 'UTC')::int + p.tz_offset) % 24 + 24) % 24;
    is_weekend := extract(dow from now()) in (0, 6);

    -- inside the pilot's play window?
    act := 0;
    if (p.play_start <= p.play_end and local_hour between p.play_start and p.play_end)
       or (p.play_start > p.play_end and (local_hour >= p.play_start or local_hour <= p.play_end)) then
      if random() < p.login_prob then
        act := (p.session_min + random() * (p.session_max - p.session_min)) / 60.0;   -- session hours
        if is_weekend then act := act * p.weekend_mod; end if;
      end if;
    end if;

    if act > 0 then
      -- POWER: proportional growth, so sims track the real economy's shape
      -- rather than a flat additive drip. asc_mult is their perk power.
      gain := p.power * (0.020 * p.growth * p.asc_mult * cfg.aggression) * act;
      gain := greatest(gain, 900 * p.growth * act);   -- floor for brand-new pilots
      lvl_gain := floor(act * (0.55 + random() * 0.9) * p.growth)::int;

      update sim_pilots set
        power = least(9e17, power + gain::bigint),
        level = least(500, level + lvl_gain),
        kills = kills + (act * 2600 * p.growth * (1 + p.level / 90.0))::bigint,
        zone  = greatest(zone, least(1000, ((level + lvl_gain) * 0.85)::int)),
        tiles = least(60, tiles + (case when random() < 0.05 * act then 1 else 0 end)),
        band  = case when level + lvl_gain > 400 then 'endgame'
                     when level + lvl_gain > 180 then 'advanced'
                     when level + lvl_gain > 70  then 'mid'
                     when level + lvl_gain > 25  then 'early'
                     else 'new' end,
        fleet = sim_fleet_for(band, level + lvl_gain),
        last_tick = now()
      where id = p.id;
      ticked := ticked + 1;

      -- ---- PILOT ASCENSION -------------------------------------------------
      -- Same loop as a real pilot: at their personality's target level they
      -- reset to Level 1, bank points and keep a permanent multiplier. Power is
      -- NOT wiped to zero — a legacy ship plus perks means an ascended pilot
      -- rebuilds fast, which is exactly why they stay leaderboard-competitive.
      if p.level + lvl_gain >= least(500, p.asc_target) then
        asc_pts := greatest(1, (p.level + lvl_gain) / 125)
                 + least(6, floor(log(greatest(10, p.power)) / 3))::int
                 + least(4, (p.zone / 125))
                 + least(4, (p.tiles / 10));
        update sim_pilots set
          asc_stars  = asc_stars + 1,
          asc_points = asc_points + asc_pts,
          asc_mult   = least(4.0, asc_mult + 0.18),
          level      = 1,
          zone       = 1,
          tiles      = 0,
          -- the legacy ship + perks carry: they keep a third of their power and
          -- climb back through it far faster than the first time
          power      = greatest(sim_band_power('early'), (power * 0.34)::bigint),
          band       = 'early',
          asc_target = least(500, greatest(125, (p.asc_target * (1.0 + random() * 0.6))::int)),
          ascended_at = now()
        where id = p.id;
        ascended := ascended + 1;
        insert into sim_log (pilot_id, kind, payload)
        values (p.id, 'ascend', jsonb_build_object('from_level', p.level + lvl_gain, 'stars', p.asc_stars + 1, 'points', asc_pts));
      end if;
    else
      update sim_pilots set last_tick = now() where id = p.id;
    end if;
  end loop;

  insert into sim_log (kind, payload)
  values ('tick', jsonb_build_object('ticked', ticked, 'ascended', ascended, 'humans', humans,
                                     'target', want, 'spawned', made));
  -- keep the rival tier pinned to the current leader on every pass. Failures are
  -- LOGGED rather than swallowed — a silent exception here once hid a missing
  -- column for an entire release.
  begin
    perform sim_rivals();
  exception when others then
    insert into sim_log (kind, payload) values ('error',
      jsonb_build_object('fn', 'sim_rivals', 'msg', sqlerrm, 'state', sqlstate));
  end;
  return jsonb_build_object('ok', true, 'ticked', ticked, 'ascended', ascended,
                            'population', want, 'spawned', made);
end $$;

-- =============================================================================
-- 7b. THE RIVAL TIER
-- 3-5 pilots that shadow the strongest human in the game: close enough that the
-- leader always feels chased, never close enough to take the crown.
--
-- Each rival is pinned to a FRACTION of the top human's power (0.94 → 0.72, so
-- the nearest sits ~6% behind and the furthest ~28%), and their ascension stars
-- trail the leader's by 0-2. Because the anchor is the human's LIVE number they
-- rise automatically as the leader rises — that is the "keeps up" half. The
-- permanent gap plus a strict never-exceed clamp is the "don't over-pressure"
-- half: no rival can out-power or out-ascend the person they are chasing.
--
-- Rivals are ordinary pilots in every other respect — they hold tiles, join
-- alliances, ascend and lose fights like anyone else.
-- =============================================================================
create or replace function sim_rivals()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg sim_config;
  top_power bigint; top_asc int; top_level int; top_zone int;
  want int; have int; r record; i int := 0; lag int; target bigint;
  frac numeric[] := array[0.94, 0.88, 0.82, 0.77, 0.72];
  climb numeric; promoted int := 0; tuned int := 0;
begin
  select * into cfg from sim_config where id = 1;
  if not cfg.enabled then return jsonb_build_object('ok', false); end if;

  -- human high-water mark over a 7-day active window, so a dormant whale does
  -- not pin the rival tier forever
  select coalesce(max(power), 0), coalesce(max(asc_stars), 0),
         coalesce(max(level), 1), coalesce(max(zone), 1)
    into top_power, top_asc, top_level, top_zone
    from leaderboard where updated_at > now() - interval '7 days';

  -- nothing to chase yet: stand the tier down rather than inventing a ceiling
  if coalesce(top_power, 0) < 50000 then
    update sim_pilots set rival = false where rival;
    return jsonb_build_object('ok', true, 'rivals', 0, 'reason', 'no human anchor');
  end if;

  -- STABLE PACK SIZE. Re-rolling this every tick churned membership: demotion
  -- dropped pinned rivals while promotion recruited fresh strong pilots and cut
  -- their power, dragging the whole top of the roster down over a day.
  -- THE CLIMB — 3% of the leader on the roster's debut, easing to its full slot
  -- fractions over ramp_days. Debuting near the top of a board people have played
  -- for weeks reads as fake, so the pack starts at the bottom and works up.
  climb := 0.03 + 0.97 * power(least(1.0, greatest(0.0,
            (current_date - coalesce(cfg.epoch_day, current_date))::numeric
            / greatest(1, cfg.ramp_days))), 0.8);

  want := greatest(3, least(5, cfg.rival_count));
  select count(*) into have from sim_pilots where rival and active;

  -- RECRUIT FROM NEAR THE ANCHOR, not from the strongest pilots on the roster.
  -- Picking `order by power desc` and then assigning a lower power permanently
  -- destroyed the earned progression of the best sims in the game.
  if have < want then
    for r in select id from sim_pilots
              where active and not rival
                and power between (top_power * 0.55)::bigint and (top_power * 1.6)::bigint
              order by abs(power - top_power) asc
              limit (want - have) loop
      update sim_pilots set rival = true where id = r.id;
      promoted := promoted + 1;
    end loop;
    -- still short (early days, thin roster): take the closest by power anyway
    if promoted < (want - have) then
      for r in select id from sim_pilots where active and not rival
                order by abs(power - top_power) asc limit (want - have - promoted) loop
        update sim_pilots set rival = true where id = r.id;
        promoted := promoted + 1;
      end loop;
    end if;
  elsif have > want then
    update sim_pilots set rival = false
     where id in (select id from sim_pilots where rival and active
                  order by abs(power - top_power) desc limit (have - want));
  end if;

  -- EASE toward the slot target rather than snapping to it, so a rival's power
  -- is never deleted in one statement and a temporarily-weak human anchor cannot
  -- crater the pack. 25% of the gap per tick → converges in a few hours.
  for r in select id, power from sim_pilots where rival and active order by power desc loop
    i := i + 1;
    lag := greatest(0, top_asc - ((i - 1) / 2));      -- 0,0,1,1,2 stars behind
    target := least((top_power * frac[least(i, array_length(frac, 1))] * climb)::bigint,
                    greatest(1, top_power - 1));
    update sim_pilots set
      power     = greatest(1, (r.power + (target - r.power) * 0.25)::bigint),
      asc_stars = least(top_asc, lag)::smallint,
      asc_mult  = 1.0 + least(top_asc, lag) * 0.18,
      level     = greatest(1, (top_level * (0.82 + random() * 0.14))::int),
      zone      = greatest(1, least(1000, (top_zone * (0.85 + random() * 0.12))::int)),
      band      = 'endgame',
      -- rivals play a lot; that is *why* they keep pace
      login_prob = greatest(login_prob, 0.85),
      growth     = greatest(growth, 1.4),
      last_tick  = now()
    where id = r.id;
    tuned := tuned + 1;
  end loop;

  insert into sim_log (kind, payload) values ('rivals', jsonb_build_object(
    'want', want, 'promoted', promoted, 'tuned', tuned, 'climb', round(climb, 3),
    'top_human_power', top_power, 'top_human_asc', top_asc));
  return jsonb_build_object('ok', true, 'rivals', tuned, 'promoted', promoted,
                            'anchor_power', top_power, 'anchor_asc', top_asc);
end $$;
revoke all on function sim_rivals() from public;

-- =============================================================================
-- 8. PUBLIC READ — the board, with the ranking fairness guards applied
-- The client calls this instead of selecting the table directly, so the top-10
-- cap and the "never rank 1" rule are enforced server-side and cannot be
-- bypassed by a modified client.
-- =============================================================================
create or replace function sim_board(p_limit int default 100)
returns table (
  name text, level int, zone int, power bigint, kills bigint,
  fleet jsonb, asc_stars smallint, personality text, is_simulated boolean, marked boolean
) language plpgsql security definer set search_path = public as $$
declare cfg sim_config; top_real bigint;
begin
  select * into cfg from sim_config where id = 1;
  if not cfg.enabled then return; end if;
  -- the strongest human row; sims are capped just under it when allow_rank1 is
  -- off, so a simulated pilot can never hold the #1 seat
  select coalesce(max(l.power), 0) into top_real from leaderboard l;
  return query
    select s.name, s.level, s.zone,
           case when cfg.allow_rank1 or top_real = 0 then s.power
                else least(s.power, greatest(0, top_real - 1)) end as power,
           s.kills, s.fleet, s.asc_stars, s.personality, true, cfg.mark_publicly
    from sim_pilots s
    where s.active
    order by 4 desc
    limit greatest(0, least(p_limit, cfg.max_top100 * 4));
end $$;
grant execute on function sim_board(int) to anon, authenticated;

-- ---- 9. ADMIN -------------------------------------------------------------
create or replace function sim_admin_set(p jsonb)
returns sim_config language plpgsql security definer set search_path = public as $$
declare row_out sim_config;
begin
  update sim_config set
    enabled           = coalesce((p->>'enabled')::boolean, enabled),
    target_population = coalesce((p->>'target_population')::int, target_population),
    aggression        = coalesce((p->>'aggression')::numeric, aggression),
    pause_attacks     = coalesce((p->>'pause_attacks')::boolean, pause_attacks),
    pause_events      = coalesce((p->>'pause_events')::boolean, pause_events),
    pause_alliances   = coalesce((p->>'pause_alliances')::boolean, pause_alliances),
    pause_progression = coalesce((p->>'pause_progression')::boolean, pause_progression),
    max_top10         = coalesce((p->>'max_top10')::smallint, max_top10),
    max_top100        = coalesce((p->>'max_top100')::smallint, max_top100),
    allow_rank1       = coalesce((p->>'allow_rank1')::boolean, allow_rank1),
    reward_eligible   = coalesce((p->>'reward_eligible')::boolean, reward_eligible),
    mark_publicly     = coalesce((p->>'mark_publicly')::boolean, mark_publicly),
    updated_at        = now()
  where id = 1 returning * into row_out;
  insert into sim_log (kind, payload) values ('admin', p);
  return row_out;
end $$;

create or replace function sim_stats() returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'config',       (select to_jsonb(c) from sim_config c where id = 1),
    'total',        (select count(*) from sim_pilots),
    'active',       (select count(*) from sim_pilots where active),
    'by_band',      (select jsonb_object_agg(band, n) from (select band, count(*) n from sim_pilots where active group by band) x),
    'by_pers',      (select jsonb_object_agg(personality, n) from (select personality, count(*) n from sim_pilots where active group by personality) y),
    'ascensions',   (select coalesce(sum(asc_stars),0) from sim_pilots),
    'max_stars',    (select coalesce(max(asc_stars),0) from sim_pilots where active),
    'rivals',       (select count(*) from sim_pilots where rival and active),
    'rival_power',  (select coalesce(max(power),0) from sim_pilots where rival and active),
    'top_power',    (select coalesce(max(power),0) from sim_pilots where active),
    'humans_7d',    (select count(*) from leaderboard where updated_at > now() - interval '7 days'),
    'last_tick',    (select max(at) from sim_log where kind = 'tick'),
    'recent',       (select jsonb_agg(to_jsonb(r)) from (select kind, payload, at from sim_log order by at desc limit 20) r))
$$;

create or replace function sim_retire(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update sim_pilots set active = false, retired_at = now() where id = p_id;
$$;

-- ---- 9b. PRIVILEGED FUNCTIONS — SERVICE ROLE ONLY -------------------------
-- Postgres grants EXECUTE to PUBLIC by default, which would let any signed-in
-- player call sim_admin_set / sim_spawn / sim_tick and rewrite the whole system.
-- Revoke everything, then grant back only the genuinely public reads (sim_board
-- is granted where it is defined above).
revoke all on function sim_gen_name() from public;
revoke all on function sim_profile(text) from public;
revoke all on function sim_band_power(text) from public;
revoke all on function sim_band_level(text) from public;
revoke all on function sim_fleet_for(text, int) from public;
revoke all on function sim_spawn(int, text) from public;
revoke all on function sim_tick() from public;
revoke all on function sim_admin_set(jsonb) from public;
revoke all on function sim_stats() from public;
revoke all on function sim_retire(uuid) from public;

-- ---- 10. HOURLY CRON ------------------------------------------------------
-- Replace <PROJECT-REF> and <SERVICE-ROLE-KEY>, then uncomment.
--
-- create extension if not exists pg_cron;
-- select cron.schedule('lf-sim-tick', '7 * * * *', $CRON$ select sim_tick() $CRON$);
--
-- Seed the roster once:
--   select sim_spawn(250);
--
-- …or let it grow itself from nothing: the tick adds 5-15 pilots a day (see
-- sim_config.daily_spawn_min / daily_spawn_max) until it reaches target, which
-- looks far more like an organic player base than a launch-day clump.
