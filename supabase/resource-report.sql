-- =============================================================================
--  resource-report.sql — EVERY PLAYER'S CURRENT WALLETS          (READ-ONLY)
-- -----------------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it. It is a single
--  SELECT: no DDL, no views, no writes, nothing that can touch a save.
--
--  WHERE THE NUMBERS LIVE. There is no resources table — every balance is a
--  field inside the player's save blob (`public.saves.data`), one row per
--  auth user. The wallet fields, exactly as account.js reads them:
--
--      gold                  $ Gold
--      credits               ◈ LootCoins
--      dreadCores            ◇ Dread Cores
--      resources.fuel        Fuel
--      resources.iron        Iron
--      resources.plasma      Plasma
--      prism.ingots          ◈ Prism Ingots   (absent until Prism is opened)
--      mechCores             Mech Foundry cores
--      cmdr.dust             Commander dust
--      pasc.pts              Pilot Ascension points (spendable)
--      pasc.stars            Pilot Ascension stars  (the record, not a wallet)
--
--  NUMERIC, NEVER BIGINT. Endgame balances pass 1e29 and the client serialises
--  numbers that large in exponential notation — bigint tops out near 9.22e18 and
--  parses neither. Every column below is `numeric`.
--
--  A MISSING FIELD IS 0, A NON-NUMBER IS 0. The guard is stated ONCE (the `v`
--  expression in the lateral) rather than copied per column: a save that holds a
--  string, a null or nothing at all reports 0 instead of throwing and killing the
--  whole report. Saves predate several of these systems, so this is normal.
--
--  REAL ACCOUNTS ONLY. Simulated pilots are not auth users and hold no save —
--  they live in `sim_pilots`, so nothing here can mistake one for a player.
--
--  RLS: `saves_select_own` restricts players to their own row. The SQL editor
--  runs as the table owner and bypasses it, which is why this returns everyone.
-- =============================================================================

select
  coalesce(nullif(btrim(s.data->>'pilotName'), ''),
           nullif(btrim(s.data->>'name'), ''), 'Operator')  as pilot,
  u.email,
  coalesce((s.data->>'level')::int, 1)                      as lv,
  w.stars                                                   as asc_stars,
  w.gold,
  w.lootcoins,
  w.dread_cores,
  w.fuel,
  w.iron,
  w.plasma,
  w.prism_ingots,
  w.mech_cores,
  w.cmdr_dust,
  w.asc_points,
  s.updated_at                                              as last_save,
  u.last_sign_in_at                                         as last_login,
  s.user_id
from public.saves s
join auth.users u on u.id = s.user_id
cross join lateral (
  select
    max(v) filter (where k = 'gold')    as gold,
    max(v) filter (where k = 'lc')      as lootcoins,
    max(v) filter (where k = 'cores')   as dread_cores,
    max(v) filter (where k = 'fuel')    as fuel,
    max(v) filter (where k = 'iron')    as iron,
    max(v) filter (where k = 'plasma')  as plasma,
    max(v) filter (where k = 'prism')   as prism_ingots,
    max(v) filter (where k = 'mech')    as mech_cores,
    max(v) filter (where k = 'dust')    as cmdr_dust,
    max(v) filter (where k = 'ascpts')  as asc_points,
    max(v) filter (where k = 'stars')   as stars
  from (values
    ('gold',   s.data->'gold'),
    ('lc',     s.data->'credits'),
    ('cores',  s.data->'dreadCores'),
    ('fuel',   s.data->'resources'->'fuel'),
    ('iron',   s.data->'resources'->'iron'),
    ('plasma', s.data->'resources'->'plasma'),
    ('prism',  s.data->'prism'->'ingots'),
    ('mech',   s.data->'mechCores'),
    ('dust',   s.data->'cmdr'->'dust'),
    ('ascpts', s.data->'pasc'->'pts'),
    ('stars',  s.data->'pasc'->'stars')
  ) as f(k, j)
  cross join lateral (
    -- the one guard: only a JSON number becomes a balance
    select case when jsonb_typeof(f.j) = 'number' then (f.j #>> '{}')::numeric else 0 end as v
  ) x
) w
order by w.gold desc nulls last;

-- ---------------------------------------------------------------------------
-- VARIANTS — swap the ORDER BY / WHERE above, or run one of these instead
-- ---------------------------------------------------------------------------

-- 1 · Richest in LootCoins (the paid currency) first
--     ... order by w.lootcoins desc nulls last;

-- 2 · Only accounts that have played in the last 7 days
--     ... where s.updated_at > now() - interval '7 days' order by w.gold desc;

-- 3 · One pilot
--     ... where s.data->>'pilotName' ilike '%frost%';

-- 4 · Economy totals across the whole player base (paste after the query above,
--     replacing the final ORDER BY):
--     select count(*) as players, sum(w.gold) as gold, sum(w.lootcoins) as lootcoins,
--            sum(w.dread_cores) as dread_cores, sum(w.fuel) as fuel,
--            sum(w.iron) as iron, sum(w.plasma) as plasma,
--            sum(w.prism_ingots) as prism
--     ... (same from/join/lateral, no order by)

-- 5 · Ship shards held (per-hull object, so it is a sum, not a field). Add to
--     the select list:
--     (select coalesce(sum(case when jsonb_typeof(p.value) = 'number'
--                               then (p.value #>> '{}')::numeric else 0 end), 0)
--        from jsonb_each(coalesce(s.data->'shipParts', '{}'::jsonb)) p) as ship_shards,

-- 6 · Nanocores are NOT a flat wallet — `nano.cores` is keyed by hull, each entry
--     carrying its own slots/stage. Count of cores held:
--     (select count(*) from jsonb_each(coalesce(s.data->'nano'->'cores', '{}'::jsonb))) as nanocores,
