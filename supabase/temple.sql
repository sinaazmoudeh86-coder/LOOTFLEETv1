-- =============================================================================
--  temple.sql — THE TEMPLE · true PvP zone
--  Build 695. Run once. Safe to re-run.
-- =============================================================================
--
--  ONE ARENA, ONE ALTAR, REAL LOSS.
--
--  Pilots fly into a shared arena and hunt each other. Every three hours the
--  altar at the centre spawns one item between Relic and Paragon; it drops
--  physically and the first pilot to touch it keeps it. Killing a pilot inflicts
--  the game's ordinary death penalty on them — hull levels wiped, item drop
--  rolled — because that is what makes holding the centre cost something.
--
--  WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY IS NOT
--  ---------------------------------------------------------------------------
--  LOOTFLEET's combat runs entirely on the client. This file does NOT simulate
--  combat and cannot: validating damage would mean re-implementing the engine
--  server-side. The design brief chose KILLER-AUTHORITATIVE reporting, which is
--  responsive and simple and, taken literally, lets anyone with devtools claim a
--  kill on anyone.
--
--  So the report stays killer-authoritative — the killer's client fires it, with
--  no handshake and no lag — and this file makes the claim PLAUSIBILITY-CHECKED
--  against data the server already holds:
--
--    1. BOTH PILOTS MUST BE IN THE ARENA, with a heartbeat inside PRESENCE_TTL.
--       You cannot kill someone who is not there.
--    2. THEY MUST HAVE BEEN NEXT TO EACH OTHER. Every heartbeat carries a
--       position; a kill claimed across half the map is refused outright.
--    3. A VICTIM CANNOT DIE TWICE. One death per pilot per RESPAWN_GRACE, so a
--       loop cannot strip someone's whole hold in a second.
--    4. EVERY CLAIM IS LOGGED — accepted or refused, with the distance and the
--       reason. temple_kills is the evidence trail; a cheat shows up as a
--       pattern in it rather than as a rumour.
--
--  None of that makes forgery impossible. A patient attacker who flies to a real
--  victim and reports a real-looking kill is indistinguishable from one who won
--  the fight. It makes forgery BOUNDED — you must be present, adjacent, and
--  within the rate limit — and it makes it VISIBLE after the fact.
--
--  THE PENALTY IS APPLIED BY THE VICTIM'S OWN CLIENT, and there is no
--  alternative: the hull levels and the item pool live in the victim's save,
--  which nothing else can write. The server's job is to decide that the death
--  HAPPENED; the victim's client then runs the ordinary death path.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · TUNING
-- ---------------------------------------------------------------------------
create or replace function public.temple_presence_ttl() returns int
  language sql immutable as $$ select 12 $$;          -- seconds a heartbeat stays live
create or replace function public.temple_kill_range() returns numeric
  language sql immutable as $$ select 900.0::numeric $$; -- world units; engine range is ~250-600
create or replace function public.temple_respawn_grace() returns int
  language sql immutable as $$ select 8 $$;           -- seconds of immunity after dying
create or replace function public.temple_kill_cooldown() returns numeric
  language sql immutable as $$ select 1.5::numeric $$; -- min seconds between one attacker's kills
-- SPAWN WINDOW. NOT a fixed cadence: a random interval between one and three
-- hours, rolled fresh every time. A three-hour clock turns the Temple into a
-- calendar — nobody flies in until 2:55, the zone is empty all afternoon, and
-- the fight lasts five minutes. Making the moment UNKNOWABLE is what forces
-- pilots to actually hold the centre, because leaving is always a gamble.
--
-- Nothing ever exposes next_at to a client; temple_tick() returns only whether
-- an item is out. See the note there.
create or replace function public.temple_spawn_secs() returns int
  language sql volatile as $$ select 3600 + floor(random() * 7201)::int $$;  -- 1h..3h

-- ---------------------------------------------------------------------------
-- 2 · TABLES
-- ---------------------------------------------------------------------------
-- WHO IS IN THE ARENA RIGHT NOW. One row per pilot, overwritten on every
-- heartbeat. Kept as a TABLE rather than realtime-only presence because the kill
-- validator has to ask "where was the victim two seconds ago" and a broadcast
-- channel remembers nothing.
create table if not exists public.temple_presence (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default 'Operator',
  ship       text,
  power      numeric not null default 0,
  x          numeric not null default 0,
  y          numeric not null default 0,
  hp         numeric not null default 1,      -- 0..1 fraction, for the nameplate
  fx         numeric not null default 0.5,    -- position as a FRACTION of the world
  fy         numeric not null default 0.5,
  vigil_s    numeric not null default 0,       -- seconds held inside the altar ring
  dead_until timestamptz,                     -- respawn grace after being killed
  entered_at timestamptz not null default now(),
  seen       timestamptz not null default now()
);
create index if not exists temple_presence_seen on public.temple_presence(seen desc);

-- EVERY KILL CLAIM, accepted or not. Small, bounded by traffic, and the only
-- record of who was pushing. Read it before believing a leaderboard.
create table if not exists public.temple_kills (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  killer_id  uuid references auth.users(id) on delete set null,
  killer     text,
  victim_id  uuid references auth.users(id) on delete set null,
  victim     text,
  ok         boolean not null,
  reason     text,                            -- null when accepted
  dist       numeric,
  killer_pow numeric,
  victim_pow numeric
);
create index if not exists temple_kills_at on public.temple_kills(at desc);

-- THE ALTAR. Exactly one row, id = 1. `item` is null between spawns and holds
-- the generated item while it lies on the floor waiting to be taken.
create table if not exists public.temple_altar (
  id         int primary key default 1,
  next_at    timestamptz not null default now(),
  item       jsonb,                           -- non-null = lying on the altar
  spawned_at timestamptz,
  taken_by   uuid references auth.users(id) on delete set null,
  taken_name text,
  taken_at   timestamptz,
  seq        bigint not null default 0,       -- increments per spawn; the client's dedupe key
  constraint temple_altar_single check (id = 1)
);
insert into public.temple_altar (id, next_at) values (1, now() + interval '5 minutes')
  on conflict (id) do nothing;

-- WHO HAS TAKEN WHAT. The Temple ladder reads this.
create table if not exists public.temple_claims (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  name       text,
  rarity     int not null,
  ilvl       int not null,
  item       jsonb
);
create index if not exists temple_claims_at on public.temple_claims(at desc);

alter table public.temple_presence add column if not exists fx numeric not null default 0.5;
alter table public.temple_presence add column if not exists fy numeric not null default 0.5;
alter table public.temple_presence add column if not exists vigil_s numeric not null default 0;

alter table public.temple_presence enable row level security;
alter table public.temple_kills    enable row level security;
alter table public.temple_altar    enable row level security;
alter table public.temple_claims   enable row level security;

do $$ begin
  create policy temple_presence_read on public.temple_presence for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy temple_kills_read on public.temple_kills for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy temple_altar_read on public.temple_altar for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy temple_claims_read on public.temple_claims for select using (true);
exception when duplicate_object then null; end $$;

-- Writes go through security-definer RPCs ONLY. No direct insert/update policy
-- exists, so a client cannot fabricate presence, a kill or a claim by table write.

do $$ begin
  alter publication supabase_realtime add table public.temple_altar;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3 · THE ALTAR ITEM
-- ---------------------------------------------------------------------------
-- RARITY 11..16 = Relic, Artifact, Mythic, Ascendant, Celestial, Paragon.
-- WEIGHTED TO THE LOW END on purpose. A flat roll would put Paragon — normally a
-- 2e-8 drop, the rarest thing in the game — on the altar every eighteen hours,
-- which would devalue it faster than any amount of PvP could justify. This curve
-- puts Relic on most altars and Paragon at roughly one spawn in 200, or about
-- once a month at a three-hour cadence.
-- THE VIGIL SHIFTS THE ROLL.
--
-- WHY THIS EXISTS AT ALL. Dying here costs a hull reset and an item, the spawn is
-- one to three hours away, and nobody is told when. Put those three facts
-- together and the correct play is to HIDE in a corner for three hours and only
-- approach when the altar lights — loss-aversion makes avoidance strictly better
-- than fighting, so the zone sits empty and the "hold the centre" the brief asks
-- for never happens.
--
-- So holding the centre has to be worth something BEFORE the spawn. Every second
-- a pilot is alone in the ring banks vigil, and vigil bends the rarity roll
-- upward. Thirty minutes of uncontested vigil roughly triples the odds of the top
-- three tiers. Now standing in the middle is the strong play, contesting it is
-- the counter, and there is a reason to fight at 40 minutes rather than at 2:59.
--
-- It accrues ONLY WHILE ALONE (see temple_beat), so a standoff banks nothing for
-- either pilot. The altar rewards owning the centre, not visiting it.
create or replace function public.temple_roll_rarity(p_vigil numeric default 0)
returns int language plpgsql volatile as $$
declare
  r numeric := random();
  -- 0 at no vigil, 1.0 at an hour. Square-rooted so the first ten minutes are
  -- worth the most and a marathon sitter does not simply own every top tier.
  b numeric := sqrt(least(1, greatest(0, coalesce(p_vigil, 0) / 3600.0)));
begin
  -- the bonus walks probability from the bottom of the table to the top
  r := least(0.9999, r + b * 0.34);
  if r < 0.46 then return 11;    -- Relic
  elsif r < 0.72 then return 12; -- Artifact
  elsif r < 0.885 then return 13;-- Mythic
  elsif r < 0.965 then return 14;-- Ascendant
  elsif r < 0.995 then return 15;-- Celestial
  else return 16;                -- Paragon
  end if;
end $$;

-- LAZY SPAWN. Called by every client poll; the FIRST caller past next_at mints
-- the item and everyone else sees the same row. No cron needed, and an idle
-- server does not accumulate a backlog of altars nobody was there to contest.
create or replace function public.temple_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.temple_altar%rowtype; v_vig numeric := 0;
begin
  select * into a from public.temple_altar where id = 1 for update;
  if not found then return jsonb_build_object('ok', false); end if;

  if a.item is null and now() >= a.next_at then
    select coalesce(max(vigil_s), 0) into v_vig from public.temple_presence
     where seen > now() - make_interval(secs => public.temple_presence_ttl());
    update public.temple_altar set
      item = jsonb_build_object(
        'rarity', public.temple_roll_rarity(v_vig),
        'vigil', round(v_vig)::int,
        'ilvl', 300 + floor(random() * 201)::int,   -- 300..500 inclusive
        'seed', floor(random() * 2147483647)::int
      ),
      spawned_at = now(),
      taken_by = null, taken_name = null, taken_at = null,
      seq = a.seq + 1
    where id = 1 returning * into a;
    -- the vigil is spent: the next altar is a fresh contest
    update public.temple_presence set vigil_s = 0;
  end if;

  -- THE COUNTDOWN IS PUBLIC. The INTERVAL is still rolled at random between one
  -- and three hours, so no formula predicts the altar after next — but once the
  -- roll is made the deadline is published to everyone equally.
  --
  -- The earlier build hid it on the reasoning that a pilot holding the timer
  -- would own every altar. True, and beside the point: hiding it from EVERYONE
  -- meant nobody could plan to be there, so the altar mostly spawned into an
  -- empty room and the PvP zone had no PvP in it. A shared deadline is what makes
  -- people show up at the same time, which is the entire feature.
  return jsonb_build_object(
    'ok', true, 'seq', a.seq, 'item', a.item,
    'next_at', a.next_at, 'spawned_at', a.spawned_at,
    'waiting_s', case when a.item is null
                      then greatest(0, extract(epoch from (now() - coalesce(a.taken_at, a.spawned_at, now())))::int)
                      else 0 end,
    'taken_name', a.taken_name, 'taken_at', a.taken_at,
    'now', now()
  );
end $$;
grant execute on function public.temple_tick() to authenticated, anon;

-- TAKE THE ITEM. Atomic: the `item is not null` predicate in the UPDATE is the
-- whole race resolution — two pilots touching the same frame produce one winner
-- and one no-op, decided by row lock rather than by whoever's packet arrived
-- first. The loser is told plainly that someone beat them to it.
create or replace function public.temple_claim(p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pres public.temple_presence%rowtype;
  v_item jsonb;
  v_seq  bigint;
  v_next timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;

  -- must actually be in the arena and alive
  select * into v_pres from public.temple_presence where user_id = v_uid;
  if not found or v_pres.seen < now() - make_interval(secs => public.temple_presence_ttl()) then
    return jsonb_build_object('ok', false, 'reason', 'absent');
  end if;
  if v_pres.dead_until is not null and v_pres.dead_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'dead');
  end if;

  -- THE ITEM IS CAPTURED BEFORE IT IS CLEARED. `returning` hands back the row as
  -- it is AFTER the update, by which point item is already null — so the item has
  -- to come out of the OLD tuple. One statement, one row lock: two pilots touching
  -- the altar in the same frame produce exactly one winner, decided by the lock
  -- rather than by whose packet arrived first.
  with taken as (
    update public.temple_altar t set
      item = null,
      taken_by = v_uid,
      taken_name = coalesce(p_name, 'Operator'),
      taken_at = now(),
      next_at = now() + make_interval(secs => public.temple_spawn_secs())
    from public.temple_altar old
    where t.id = 1 and old.id = 1 and t.item is not null
    returning old.item as got, t.seq as seq, t.next_at as next_at
  )
  select got, seq, next_at into v_item, v_seq, v_next from taken;

  if v_item is null then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;

  insert into public.temple_claims (user_id, name, rarity, ilvl, item)
  values (v_uid, coalesce(p_name, 'Operator'),
          (v_item->>'rarity')::int, (v_item->>'ilvl')::int, v_item);

  return jsonb_build_object('ok', true, 'item', v_item, 'seq', v_seq, 'next_at', v_next);
end $$;
grant execute on function public.temple_claim(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · HEARTBEAT
-- ---------------------------------------------------------------------------
-- THE RING, IN WORLD FRACTIONS. The client's world size varies, so raw
-- coordinates tell the server nothing about who is standing on the altar. The
-- heartbeat carries position as a fraction of the world instead, which makes the
-- centre exactly (0.5, 0.5) on every device and lets the SERVER decide who is in
-- the ring rather than taking the client's word for it.
create or replace function public.temple_ring_frac() returns numeric
  language sql immutable as $$ select 0.055::numeric $$;

create or replace function public.temple_beat(
  p_name text, p_ship text, p_power numeric,
  p_x numeric, p_y numeric, p_hp numeric,
  p_fx numeric default 0.5, p_fy numeric default 0.5
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_n int;
  v_prev timestamptz; v_gap numeric := 0; v_in boolean;
  v_top numeric; v_mine numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;

  select seen into v_prev from public.temple_presence where user_id = v_uid;
  -- Gap since the last beat, clamped: a tab that slept for an hour must not bank
  -- an hour of vigil, and a client beating faster than it should cannot farm it.
  v_gap := least(4, greatest(0, coalesce(extract(epoch from (now() - v_prev)), 0)));
  v_in := sqrt(power(coalesce(p_fx, 0.5) - 0.5, 2) + power(coalesce(p_fy, 0.5) - 0.5, 2)) <= public.temple_ring_frac()
          and coalesce(p_hp, 1) > 0;

  insert into public.temple_presence (user_id, name, ship, power, x, y, fx, fy, hp, seen)
  values (v_uid, left(coalesce(p_name, 'Operator'), 24), left(coalesce(p_ship, ''), 32),
          greatest(0, coalesce(p_power, 0)), coalesce(p_x, 0), coalesce(p_y, 0),
          coalesce(p_fx, 0.5), coalesce(p_fy, 0.5),
          greatest(0, least(1, coalesce(p_hp, 1))), now())
  on conflict (user_id) do update set
    name = excluded.name, ship = excluded.ship, power = excluded.power,
    x = excluded.x, y = excluded.y, fx = excluded.fx, fy = excluded.fy,
    hp = excluded.hp, seen = now(),
    -- VIGIL ONLY ACCRUES ALONE. Two pilots in the ring at once hold nothing:
    -- the point is to OWN the centre, and a shared altar is a standoff neither
    -- of them has won. This is what turns the wait into a fight.
    vigil_s = case when excluded.hp <= 0 then 0 else public.temple_presence.vigil_s end;

  -- opportunistic sweep: a pilot who closed the tab is gone within the TTL
  delete from public.temple_presence
   where seen < now() - make_interval(secs => public.temple_presence_ttl() * 5);

  -- Accrue only if this pilot is the ONLY live one in the ring.
  if v_in and v_gap > 0 then
    if not exists (
      select 1 from public.temple_presence o
       where o.user_id <> v_uid
         and o.seen > now() - make_interval(secs => public.temple_presence_ttl())
         and o.hp > 0
         and sqrt(power(o.fx - 0.5, 2) + power(o.fy - 0.5, 2)) <= public.temple_ring_frac()
    ) then
      update public.temple_presence set vigil_s = least(10800, vigil_s + v_gap) where user_id = v_uid;
    end if;
  end if;

  select count(*) into v_n from public.temple_presence
   where seen > now() - make_interval(secs => public.temple_presence_ttl());
  select coalesce(max(vigil_s), 0) into v_top from public.temple_presence
   where seen > now() - make_interval(secs => public.temple_presence_ttl());
  select vigil_s into v_mine from public.temple_presence where user_id = v_uid;
  return jsonb_build_object('ok', true, 'pilots', v_n, 'vigil', coalesce(v_mine, 0),
                            'top_vigil', v_top, 'in_ring', v_in);
end $$;
grant execute on function public.temple_beat(text, text, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

create or replace function public.temple_leave() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.temple_presence where user_id = auth.uid();
end $$;
grant execute on function public.temple_leave() to authenticated;

-- Everyone currently in the arena. The client renders these as remote pilots.
create or replace function public.temple_pilots()
returns table (user_id uuid, name text, ship text, power numeric,
               x numeric, y numeric, hp numeric, dead boolean, vigil numeric)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.name, p.ship, p.power, p.x, p.y, p.hp,
         (p.dead_until is not null and p.dead_until > now()), p.vigil_s
    from public.temple_presence p
   where p.seen > now() - make_interval(secs => public.temple_presence_ttl())
   limit 60
$$;
grant execute on function public.temple_pilots() to authenticated;

-- ---------------------------------------------------------------------------
-- 5 · THE KILL
-- ---------------------------------------------------------------------------
create or replace function public.temple_kill(p_victim uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  k public.temple_presence%rowtype;
  v public.temple_presence%rowtype;
  v_dist numeric;
  v_last timestamptz;
  v_reason text := null;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_victim is null or p_victim = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  select * into k from public.temple_presence where user_id = v_uid;
  select * into v from public.temple_presence where user_id = p_victim;

  -- 1 · both present and live
  if k.user_id is null or k.seen < now() - make_interval(secs => public.temple_presence_ttl()) then
    v_reason := 'killer-absent';
  elsif v.user_id is null or v.seen < now() - make_interval(secs => public.temple_presence_ttl()) then
    v_reason := 'victim-absent';
  -- 2 · victim is not already dead
  elsif v.dead_until is not null and v.dead_until > now() then
    v_reason := 'already-dead';
  end if;

  if v_reason is null then
    -- 3 · they were next to each other
    v_dist := sqrt(power(k.x - v.x, 2) + power(k.y - v.y, 2));
    if v_dist > public.temple_kill_range() then v_reason := 'out-of-range'; end if;
  end if;

  if v_reason is null then
    -- 4 · attacker rate limit
    select max(at) into v_last from public.temple_kills
     where killer_id = v_uid and ok = true;
    if v_last is not null and v_last > now() - make_interval(secs => public.temple_kill_cooldown()::int) then
      v_reason := 'too-fast';
    end if;
  end if;

  -- EVERY CLAIM IS LOGGED, accepted or refused. This table is the only way to
  -- tell a good player from a forger after the fact.
  insert into public.temple_kills (killer_id, killer, victim_id, victim, ok, reason, dist, killer_pow, victim_pow)
  values (v_uid, k.name, p_victim, v.name, v_reason is null, v_reason, v_dist, k.power, v.power);

  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason, 'dist', v_dist);
  end if;

  -- the victim loses the ring and everything banked on it
  update public.temple_presence
     set dead_until = now() + make_interval(secs => public.temple_respawn_grace()),
         hp = 0, vigil_s = 0
   where user_id = p_victim;

  -- A KILL IN THE RING IS WORTH TWO MINUTES OF VIGIL. Only in the ring: killing
  -- someone out at the rim is a chase, not a claim on the altar.
  if sqrt(power(k.fx - 0.5, 2) + power(k.fy - 0.5, 2)) <= public.temple_ring_frac() then
    update public.temple_presence set vigil_s = least(10800, vigil_s + 120) where user_id = v_uid;
  end if;

  return jsonb_build_object('ok', true, 'victim', v.name, 'dist', v_dist);
end $$;
grant execute on function public.temple_kill(uuid) to authenticated;

-- Deaths I have been dealt but not yet applied. The victim's client polls this
-- and runs its own death penalty — the hull levels and the item pool live in the
-- victim's save and nothing else can write them.
create or replace function public.temple_my_deaths(p_since timestamptz default null)
returns table (at timestamptz, killer text)
language sql stable security definer set search_path = public as $$
  select k.at, k.killer
    from public.temple_kills k
   where k.victim_id = auth.uid() and k.ok = true
     and k.at > coalesce(p_since, now() - interval '2 minutes')
   order by k.at asc
   limit 20
$$;
grant execute on function public.temple_my_deaths(timestamptz) to authenticated;

-- Recent kills for the feed and the in-zone ticker.
create or replace function public.temple_recent(p_n int default 12)
returns table (at timestamptz, killer text, victim text)
language sql stable security definer set search_path = public as $$
  select k.at, k.killer, k.victim from public.temple_kills k
   where k.ok = true order by k.at desc limit greatest(1, least(coalesce(p_n, 12), 50))
$$;
grant execute on function public.temple_recent(int) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 6 · THE LADDER
-- ---------------------------------------------------------------------------
-- Ranked on ALTARS TAKEN first and kills second, deliberately in that order. A
-- pure kill ladder would reward farming whoever is weakest at the rim and
-- ignoring the altar entirely; the altar is the point of the zone, and the
-- kills are how you defend it.
--
-- Deaths are shown but never ranked on. Punishing a player twice for dying — the
-- hull reset and a public number — would make the whole zone a place to avoid.
drop function if exists public.temple_top(int);
create or replace function public.temple_top(p_n int default 25)
returns table (rank int, user_id uuid, name text, altars int, kills int,
               deaths int, best_rarity int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with claims as (
    select c.user_id, max(c.name) as name, count(*)::int as altars,
           max(c.rarity)::int as best_rarity, max(c.at) as last_at
      from public.temple_claims c where c.user_id is not null group by c.user_id
  ), kills as (
    select k.killer_id as user_id, max(k.killer) as name, count(*)::int as n, max(k.at) as last_at
      from public.temple_kills k where k.ok and k.killer_id is not null group by k.killer_id
  ), deaths as (
    select k.victim_id as user_id, count(*)::int as n
      from public.temple_kills k where k.ok and k.victim_id is not null group by k.victim_id
  ), agg as (
    select coalesce(c.user_id, kl.user_id) as user_id,
           coalesce(c.name, kl.name) as name,
           coalesce(c.altars, 0) as altars,
           coalesce(kl.n, 0) as kills,
           coalesce(d.n, 0) as deaths,
           coalesce(c.best_rarity, 0) as best_rarity,
           greatest(coalesce(c.last_at, 'epoch'::timestamptz), coalesce(kl.last_at, 'epoch'::timestamptz)) as last_at
      from claims c
      full outer join kills kl on kl.user_id = c.user_id
      left join deaths d on d.user_id = coalesce(c.user_id, kl.user_id)
  )
  select (row_number() over (order by altars desc, kills desc, best_rarity desc, last_at asc))::int,
         user_id, name, altars, kills, deaths, best_rarity, last_at
    from agg
   order by altars desc, kills desc, best_rarity desc, last_at asc
   limit greatest(1, least(coalesce(p_n, 25), 100))
$$;
grant execute on function public.temple_top(int) to authenticated, anon;

-- Every altar ever taken, newest first — the Temple's own history, and what the
-- Discord feed reads to announce a claim.
drop function if exists public.temple_claim_log(int);
create or replace function public.temple_claim_log(p_n int default 10)
returns table (at timestamptz, name text, rarity int, ilvl int)
language sql stable security definer set search_path = public as $$
  select c.at, c.name, c.rarity, c.ilvl from public.temple_claims c
   order by c.at desc limit greatest(1, least(coalesce(p_n, 10), 50))
$$;
grant execute on function public.temple_claim_log(int) to authenticated, anon;

-- How busy the Temple is right now, for the Command card. One cheap read so a
-- pilot can tell whether it is worth the flight before committing to a zone that
-- can take their gear.
drop function if exists public.temple_status();
create or replace function public.temple_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pilots', (select count(*) from public.temple_presence
                where seen > now() - make_interval(secs => public.temple_presence_ttl())),
    'item_up', (select item is not null from public.temple_altar where id = 1),
    'contested', (select count(*) > 1 from public.temple_presence
                   where seen > now() - make_interval(secs => public.temple_presence_ttl())
                     and hp > 0
                     and sqrt(power(fx - 0.5, 2) + power(fy - 0.5, 2)) <= public.temple_ring_frac()),
    'next_at', (select next_at from public.temple_altar where id = 1),
    'now', now()
  )
$$;
grant execute on function public.temple_status() to authenticated, anon;
