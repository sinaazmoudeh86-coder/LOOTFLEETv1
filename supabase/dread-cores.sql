-- =============================================================================
--  dread-cores.sql — WHERE DID 1,500+ DREAD CORES COME FROM?      (READ-ONLY)
-- -----------------------------------------------------------------------------
--  He holds 0 cores and owns 1,502 Pilot Tree nodes. Nodes cost cores, so the
--  question is not what he is holding — it is what he has ALREADY SPENT.
--
--  THE SINKS (what cores buy)
--    · Pilot Tree node   1 core, or 3 if legendary (~7% of nodes at ring 3+)
--    · Shipworks hulls   DREAD-class hulls are priced partly in cores
--    · galaxy-box / payMega plans
--
--  EVERY FAUCET IN BUILD 727, and what each can possibly have paid him:
--
--    1 · DREADNAUGHT HUNT — the designed source. `dropChance(t) = min(0.95,
--        0.40 + (t-1) x 0.02)` for ONE core, +1 more only with the `coreLuck`
--        legendary node at 50%. So 1-2 cores per successful hunt, and a hunt is
--        30 waves plus a multi-phase raid boss.
--        ATTEMPTS: one per tier per ISO week (`dreadLock[t] = weekIndex()`),
--        tiers = floor((level - 5) / 25) = 15 at his level 381. Plus one free
--        extra per tier per week with Pro (he has none). Plus `buyRespawn(t)` at
--        100M x 1000^n gold. Plus — before 712 — every ascension wiped
--        `dreadLock` and `dreadRespawn`, re-opening all 15 tiers. He has 6.
--    2 · HOME CITADEL — +2 cores on every 10th wave past wave 50. At wave 425
--        that is floor((425-50)/10)+1 = 38 crate waves = 76 cores. EXACT, capped.
--    3 · SOCIAL SHOP — 1 core for 200 FP, max 2 per week.
--    4 · ALLIANCE SHOP — 1 core for 250 coins, max 3 per week.
--    5 · CARGO DEFENSE manifests (his record: 2 runs, ever).
--    6 · FLEET EXPLORATION payouts (his `expo` is 0 — never flown one).
--    7 · VOIDMAW / server-dreadnaught: 1 core at stage 20+, a persistence bonus,
--        and mailed prizes. The one faucet this query cannot bound from the save
--        alone, so it prints `sdread` raw for reading.
--    8 · `addDreadCores()` — coupons, season pass, achievements, alliance
--        rewards. He has redeemed ZERO coupons (round 1), so this is achievements.
--
--  QUERY A adds the sinks up, subtracts every faucet at its CEILING, and prints
--  the gap. QUERY B is the more interesting one: it tests whether the NODES
--  arrived without cores at all.
--
--  MY PRIOR, for what it is worth: `mergeSaves()` max-unions `pilot.nodes` while
--  `dreadCores` is deliberately NOT unioned (a wallet follows the base pick).
--  Two clients spending the same cores into DIFFERENT nodes therefore merge to
--  BOTH node sets on ONE wallet. The code allows this on purpose, calling it
--  "bounded, one-time, non-repeating" — and this account has 659
--  `concurrent-session` conflicts. If that is the answer, cores were never
--  minted: the TREE was, and the gap in QUERY A is the size of it.
--
--  Read-only. Four statements — run them in order and paste each back.
-- =============================================================================

-- pilot: Alcyone · b85758be-8f1f-4341-8334-65c1c2f8aa60


-- =============================================================================
--  QUERY A — THE CORE LEDGER
--  Sinks, faucets at their ceilings, and the gap between them.
-- =============================================================================
with s as (
  select sv.data, u.created_at as acct_created
  from public.saves sv
  left join auth.users u on u.id = sv.user_id
  where sv.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
),
v as (
  select data, acct_created,
    (case when jsonb_typeof(data->'dreadCores')      = 'number' then (data->'dreadCores')      #>>'{}' else '0' end)::numeric as held,
    (case when jsonb_typeof(data->'level')           = 'number' then (data->'level')           #>>'{}' else '0' end)::numeric as lv,
    (case when jsonb_typeof(data->'homecit'->'wave') = 'number' then (data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave,
    (case when jsonb_typeof(data->'pasc'->'stars')   = 'number' then (data->'pasc'->'stars')   #>>'{}' else '0' end)::numeric as stars,
    greatest(1, ceil(extract(epoch from (now() - acct_created)) / 604800.0)) as weeks,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(data->'pilot'->'nodes') = 'object' then data->'pilot'->'nodes' else '{}'::jsonb end)) as nodes_n
  from s
),
-- ring per node, from the axial key: axialDist = (|q| + |q+r| + |r|) / 2
nodes as (
  select k,
         split_part(k, ',', 1)::int as q,
         split_part(k, ',', 2)::int as r,
         (abs(split_part(k, ',', 1)::int)
          + abs(split_part(k, ',', 1)::int + split_part(k, ',', 2)::int)
          + abs(split_part(k, ',', 2)::int)) / 2 as ring
  from v, jsonb_object_keys(case when jsonb_typeof(v.data->'pilot'->'nodes') = 'object' then v.data->'pilot'->'nodes' else '{}'::jsonb end) k
  where k ~ '^-?[0-9]+,-?[0-9]+$'
),
cost as (
  select
    count(*) filter (where ring > 0)                     as paid_nodes,
    count(*) filter (where ring between 1 and 2)         as n_shallow,
    count(*) filter (where ring >= 3)                    as n_deep,
    max(ring)                                            as deepest_ring
  from nodes
),
faucet as (
  select v.*,
    -- 2 · HOME CITADEL, exact
    case when v.wave >= 50 then 2 * (floor((v.wave - 50) / 10) + 1) else 0 end as f_citadel,
    -- 1 · HUNT, at its absolute ceiling: every tier, every week, PLUS a full
    --     re-open of all tiers per ascension (the pre-712 ASC_KEEP hole), and
    --     2 cores for every single attempt (a guaranteed drop AND coreLuck).
    greatest(0, floor((v.lv - 5) / 25)) as tiers,
    greatest(0, floor((v.lv - 5) / 25)) * (v.weeks + v.stars) * 2 as f_hunt_max,
    -- 3+4 · the two shops, at their weekly caps
    v.weeks * 2 as f_social_max,
    v.weeks * 3 as f_alliance_max
  from v
)
select 'SINK'   as side, 'held now'                        as item, f.held::text                        as cores, '' as note from faucet f
union all
select 'SINK', 'pilot tree — floor (every node at 1)', c.paid_nodes::text,
       c.n_shallow || ' nodes at ring 1-2 · ' || c.n_deep || ' at ring 3+ · deepest ring ' || c.deepest_ring from cost c
union all
select 'SINK', 'pilot tree — expected (7% legendary at 3)',
       round(c.n_shallow + c.n_deep * 1.14)::text,
       'ring 3+ averages 1.14 cores a node: 93% cost 1, 7% cost 3' from cost c
union all
select 'SINK', 'hulls bought with cores', 'see note',
       'priced in CONFIG, not the save — owned hulls: ' ||
       left((select string_agg(k, ' ' order by k) from jsonb_object_keys(case when jsonb_typeof(v.data->'ownedShips') = 'object' then v.data->'ownedShips' else '{}'::jsonb end) k), 500) from v
union all
select 'TOTAL SPENT', 'held + tree (expected), hulls excluded',
       round(f.held + c.n_shallow + c.n_deep * 1.14)::text,
       'this is the floor on cores this account has ever received' from faucet f, cost c
union all
select 'FAUCET', 'Home Citadel crates (EXACT)', f.f_citadel::text,
       'wave ' || f.wave || ' → ' || (case when f.wave >= 50 then floor((f.wave - 50) / 10) + 1 else 0 end) || ' crate waves x 2 cores' from faucet f
union all
select 'FAUCET', 'Dreadnaught Hunt (ABSOLUTE CEILING)', f.f_hunt_max::text,
       f.tiers || ' tiers x (' || f.weeks || ' weeks + ' || f.stars || ' ascension re-opens) x 2 cores per attempt — assumes he WON every one, 30 waves plus a raid boss each' from faucet f
union all
select 'FAUCET', 'Social shop ceiling', f.f_social_max::text, '2 per week x ' || f.weeks || ' weeks, at 200 FP each' from faucet f
union all
select 'FAUCET', 'Alliance shop ceiling', f.f_alliance_max::text, '3 per week x ' || f.weeks || ' weeks, at 250 coins each' from faucet f
union all
select 'FAUCET', 'Cargo Defense', 'runs: ' || coalesce(v.data->'cargo'->>'runs', '0'), 'manifests can pay cores; this is how many runs he has ever flown' from v
union all
select 'FAUCET', 'Fleet Exploration', 'done: ' || coalesce(v.data->'expo'->'log'->>'done', '0'), 'expedition payouts can pay cores' from v
union all
select 'FAUCET', 'Voidmaw / server dread (UNBOUNDED HERE)', 'read the raw',
       left(coalesce((v.data->'sdread')::text, 'none'), 700) from v
union all
select 'GAP', 'unaccounted cores',
       round(f.held + c.n_shallow + c.n_deep * 1.14
             - f.f_citadel - f.f_hunt_max - f.f_social_max - f.f_alliance_max)::text,
       'spent+held minus EVERY faucet at its ceiling. Positive means cores or nodes were created outside the faucets — and the hunt term above is already absurdly generous.' from faucet f, cost c
order by side desc, item;


-- =============================================================================
--  QUERY B — DID THE NODES ARRIVE WITHOUT CORES?
--  The decisive test. Every quarantined copy plus the live save, in time order:
--  node count, cores held, and how each moved.
--
--  A LEGITIMATE PURCHASE MOVES BOTH: +1 node costs -1 core. So:
--    · d_nodes > 0 with d_cores >= 0   → nodes appeared for free (a merge union)
--    · two copies in the same minute with the same cores and DIFFERENT
--      nodes_sig → two clients spent the same wallet into different nodes, and
--      mergeSaves() keeps both sets
-- =============================================================================
with copies as (
  select sc.created_at as at, 'conflict' as src, sc.data
  from public.save_conflicts sc
  where sc.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
  union all
  select s.updated_at, 'LIVE', s.data
  from public.saves s
  where s.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
),
r as (
  select at, src,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(data->'pilot'->'nodes') = 'object' then data->'pilot'->'nodes' else '{}'::jsonb end)) as nodes_n,
    left(md5((select coalesce(string_agg(k, ',' order by k), '')
              from jsonb_object_keys(case when jsonb_typeof(data->'pilot'->'nodes') = 'object' then data->'pilot'->'nodes' else '{}'::jsonb end) k)), 8) as nodes_sig,
    (case when jsonb_typeof(data->'dreadCores') = 'number' then (data->'dreadCores') #>>'{}' else '0' end)::numeric as cores,
    (case when jsonb_typeof(data->'homecit'->'wave') = 'number' then (data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(data->'dreadLock') = 'object' then data->'dreadLock' else '{}'::jsonb end)) as tier_locks
  from copies
)
select to_char(at, 'MM-DD HH24:MI:SS') as at_utc, src,
       nodes_n, nodes_n - lag(nodes_n) over w as d_nodes, nodes_sig,
       cores, cores - lag(cores) over w as d_cores,
       case when nodes_n - lag(nodes_n) over w > 0 and cores - lag(cores) over w >= 0
            then '<<< NODES WITH NO SPEND' end as flag,
       wave, tier_locks
from r
window w as (order by at)
order by at;


-- =============================================================================
--  QUERY C — IS THE TREE A SHAPE A PERSON COULD HAVE BOUGHT?
--  A node can only be unlocked when a NEIGHBOUR is already unlocked, so a
--  hand-bought tree is one connected mass growing out of (0,0). This lists every
--  node with no unlocked neighbour. Those cannot be bought through the game at
--  all, by any route — a merge of two real trees stays connected, so an orphan
--  means the save was written to directly.
--
--  Expected result on an honest account: ZERO ROWS.
-- =============================================================================
with n as (
  select split_part(k, ',', 1)::int as q, split_part(k, ',', 2)::int as r
  from public.saves s, jsonb_object_keys(case when jsonb_typeof(s.data->'pilot'->'nodes') = 'object' then s.data->'pilot'->'nodes' else '{}'::jsonb end) k
  where s.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
    and k ~ '^-?[0-9]+,-?[0-9]+$'
)
select a.q, a.r,
       (abs(a.q) + abs(a.q + a.r) + abs(a.r)) / 2 as ring,
       'no unlocked neighbour — unreachable by play' as verdict
from n a
where not exists (
  select 1 from n b
  where (b.q = a.q + 1 and b.r = a.r)
     or (b.q = a.q + 1 and b.r = a.r - 1)
     or (b.q = a.q     and b.r = a.r - 1)
     or (b.q = a.q - 1 and b.r = a.r)
     or (b.q = a.q - 1 and b.r = a.r + 1)
     or (b.q = a.q     and b.r = a.r + 1)
)
order by ring, q, r;


-- =============================================================================
--  QUERY D — WHO ELSE HAS A TREE THIS BIG?
--  1,502 nodes is either one account or a class of them, and that decides
--  whether this is a moderation question or a build-728 fix. Cores are a WEEKLY
--  raid currency, so any tree past a few hundred nodes deserves the same read.
-- =============================================================================
select
  coalesce(nullif(btrim(s.data->>'pilotName'), ''), nullif(btrim(s.data->>'name'), ''), 'Operator') as pilot,
  (select count(*) from jsonb_object_keys(case when jsonb_typeof(s.data->'pilot'->'nodes') = 'object' then s.data->'pilot'->'nodes' else '{}'::jsonb end)) as nodes_n,
  (case when jsonb_typeof(s.data->'dreadCores')      = 'number' then (s.data->'dreadCores')      #>>'{}' else '0' end)::numeric as cores_held,
  (case when jsonb_typeof(s.data->'level')           = 'number' then (s.data->'level')           #>>'{}' else '0' end)::numeric as lv,
  (case when jsonb_typeof(s.data->'pasc'->'stars')   = 'number' then (s.data->'pasc'->'stars')   #>>'{}' else '0' end)::numeric as stars,
  (case when jsonb_typeof(s.data->'homecit'->'wave') = 'number' then (s.data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as hc_wave,
  (select count(*) from jsonb_object_keys(case when jsonb_typeof(s.data->'dreadLock') = 'object' then s.data->'dreadLock' else '{}'::jsonb end)) as tier_locks,
  coalesce((select count(*) from public.save_conflicts c where c.user_id = s.user_id), 0) as conflicts,
  u.created_at as account_created,
  s.user_id
from public.saves s
left join auth.users u on u.id = s.user_id
where (select count(*) from jsonb_object_keys(case when jsonb_typeof(s.data->'pilot'->'nodes') = 'object' then s.data->'pilot'->'nodes' else '{}'::jsonb end)) > 60
order by nodes_n desc
limit 40;
