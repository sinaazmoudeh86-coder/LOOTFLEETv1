-- =============================================================================
--  audit-alcyone-3.sql — HOME DEFENSE                             (READ-ONLY)
-- -----------------------------------------------------------------------------
--  Yes. The audit points at Home Defense, and reading the module makes the
--  mechanism concrete. Here is the arithmetic before the queries, because the
--  queries only make sense against it.
--
--  THE FAUCET (js/home-citadel.js, `rates()`):
--
--      mult    = wave^1.45 x zScale x (1 + mine x 0.10) x (wave >= 100 ? 2 : 1) x VIP.afk
--      zScale  = highestUnlocked^1.12
--      gold/hr = 1500 x mult          iron 55 x  fuel 45 x  plasma/prism above w15/w40
--
--  His row: wave 425, highestUnlocked/zone 450, Mining Array up to 10.
--
--      wave^1.45 = 425^1.45  ~ 6,475
--      zScale    = 450^1.12  ~   937
--      x2 (past wave 100) x2 (mine 10)
--      mult      ~ 24,300,000
--      gold/hr   ~ 36.4 BILLION          storage cap 8-24h ~ 874 BILLION a collect
--
--  AND EVERY WAVE PAYS 2.2 HOURS OF THAT, AT THE NEW RATE. `grantWaveRewards()`
--  sets `s.wave = next` FIRST and then reads `rates(s)`, so clearing one wave
--  hands over ~2.2 x 36.4B = ~80 BILLION gold, plus 1.5x on iron/fuel/plasma,
--  plus a Shipworks part crate every 10th wave and +2 DREAD CORES every 10th
--  wave past 50.
--
--  So his 16.88 TRILLION is about 210 waves of pocket change, and his 2.19
--  QUADRILLION lifetime gold is this curve integrated from wave 1 to 425. No
--  coupon, no edit and no int32 trick is needed to produce those numbers: Home
--  Defense on its own accounts for the entire economy on this account.
--
--  WHY IT DOES NOT SELF-LIMIT — three things compounding:
--
--    1 · AUTO-DEFENSE CHAINS WAVES with a 2.2s intermission (`run.between`), and
--        RAIDER STRENGTH SCALES OFF HIS OWN FLEET DPS ("always a fight, never a
--        chore"). Wave 425 is therefore calibrated to be beatable by exactly the
--        fleet that wave 424 paid for, while the REWARD grows as wave^1.45. The
--        loop's output buys the fleet that shortens the loop.
--    2 · TWO UNBOUNDED TERMS ARE MULTIPLIED — wave^1.45 and highestUnlocked^1.12.
--        Deepest zone is already the reward for everything else in the game, so
--        the citadel pays a second time for the same progress.
--    3 · `homecit.last` IS NOT IN THE MERGE UNION. mergeSaves() max-unions
--        `wave`, `cit`, `b` (buildings) and `tw` (towers) but leaves `last` — the
--        collect clock — to the base pick. With 659 `concurrent-session`
--        conflicts on this account, a copy holding a stale `last` can win the
--        pick and re-open a bucket worth up to 874B, and any tower or structure
--        bought in the losing copy is kept while only one wallet was charged.
--        Same shape as the pilot-tree node union, which the code allows on
--        purpose as "bounded, one-time, non-repeating".
--
--  WHAT THE QUERIES DECIDE. Whether this is a DESIGN problem (he is riding a
--  curve we shipped) or ABUSE (he is getting more per wave, or more waves per
--  hour, than the module can pay):
--
--      QUERY A  waves/hour and gold/wave, measured        <- the decisive one
--      QUERY B  the collect clock: does `last` go backwards?
--      QUERY C  what the formula says he SHOULD earn (baseline for A)
--      QUERY D  battle speed across copies — 10x makes the loop 10x faster
--      QUERY E  the hcwave board: is 425 an outlier or just first?
--
--  If A lands near 80B/wave, the code is paying exactly what it promises and the
--  fix is balance, not enforcement. If A is a multiple of that, something is
--  running the reward path more than once per wave and THAT is the loophole.
--
--  Read-only. And whatever we conclude: close it forward, do not claw back the
--  wallet, and put the change in the patch notes with what he keeps.
-- =============================================================================

-- pilot: Alcyone · b85758be-8f1f-4341-8334-65c1c2f8aa60


-- =============================================================================
--  QUERY A — WAVES PER HOUR AND GOLD PER WAVE
--  Every quarantined copy plus the live save, oldest first, with deltas against
--  the previous row.
--
--  CAVEAT, and it matters: consecutive rows can be DIFFERENT clients, so a
--  single row's delta is noisy and can even be negative. Read the ENVELOPE —
--  max(wave) climbing over time is the true clear rate, and the median
--  gold_per_wave over many rows is the true reward. One row proves nothing.
-- =============================================================================
with copies as (
  select sc.created_at as at, sc.data
  from public.save_conflicts sc
  where sc.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
  union all
  select s.updated_at, s.data
  from public.saves s
  where s.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
),
rows_ as (
  select at,
    (case when jsonb_typeof(data->'homecit'->'wave') = 'number' then (data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave,
    (case when jsonb_typeof(data->'gold')            = 'number' then (data->'gold')            #>>'{}' else '0' end)::numeric as gold,
    (case when jsonb_typeof(data->'totalKills')      = 'number' then (data->'totalKills')      #>>'{}' else '0' end)::numeric as kills,
    (case when jsonb_typeof(data->'dreadCores')      = 'number' then (data->'dreadCores')      #>>'{}' else '0' end)::numeric as cores,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(data->'shipParts') = 'object' then data->'shipParts' else '{}'::jsonb end)) as part_kinds
  from copies
)
select
  to_char(at, 'MM-DD HH24:MI:SS')                                   as at_utc,
  wave,
  wave - lag(wave) over w                                           as d_wave,
  round(gold / 1e9)                                                 as gold_bn,
  round((gold - lag(gold) over w) / 1e9)                            as d_gold_bn,
  round(extract(epoch from (at - lag(at) over w)))                  as gap_s,
  case when wave - lag(wave) over w > 0
       then round((gold - lag(gold) over w) / (wave - lag(wave) over w) / 1e9)
  end                                                               as gold_bn_per_wave,
  case when extract(epoch from (at - lag(at) over w)) > 0 and wave - lag(wave) over w > 0
       then round((wave - lag(wave) over w) * 3600 / extract(epoch from (at - lag(at) over w)))
  end                                                               as waves_per_hour,
  kills - lag(kills) over w                                         as d_kills,
  cores,
  part_kinds
from rows_
window w as (order by at)
order by at;


-- =============================================================================
--  QUERY B — THE COLLECT CLOCK
--  `homecit.last` is the only thing standing between him and re-collecting the
--  same storage bucket, and it is the one field of `homecit` the merge does not
--  protect. Ordered by real time: if `last_collect` ever DECREASES, a merge
--  handed back a window that had already been paid out.
--
--  `bucket_h` is how full storage was at that moment; anything at the cap with a
--  fresh `last` right after is a collect. `stale_by_h` is how far behind the
--  copy's clock was — that is the size of the re-opened bucket in hours.
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
h as (
  select at, src,
    case when jsonb_typeof(data->'homecit'->'last') = 'number'
         then to_timestamp((data->'homecit'->'last' #>>'{}')::numeric / 1000) end as last_collect,
    case when jsonb_typeof(data->'homecit'->'dmg') = 'number' and (data->'homecit'->'dmg' #>>'{}')::numeric > 0
         then to_timestamp((data->'homecit'->'dmg' #>>'{}')::numeric / 1000) end as damaged_until,
    (case when jsonb_typeof(data->'homecit'->'wave') = 'number' then (data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave,
    (case when jsonb_typeof(data->'homecit'->'cit') = 'number' then (data->'homecit'->'cit') #>>'{}' else '0' end)::numeric as cit_lv,
    coalesce(data->'homecit'->'b', '{}'::jsonb)                                as buildings,
    (select count(*) from jsonb_array_elements(case when jsonb_typeof(data->'homecit'->'tw') = 'array' then data->'homecit'->'tw' else '[]'::jsonb end) t
      where jsonb_typeof(t.value) = 'object')                                  as towers_built,
    round((case when jsonb_typeof(data->'gold') = 'number' then (data->'gold') #>>'{}' else '0' end)::numeric / 1e9) as gold_bn
  from copies
)
select
  to_char(at, 'MM-DD HH24:MI:SS')                                       as at_utc,
  src,
  to_char(last_collect, 'MM-DD HH24:MI:SS')                             as last_collect,
  case when last_collect < lag(last_collect) over w then '<<< WENT BACKWARDS' end as flag,
  round(extract(epoch from (at - last_collect)) / 3600.0, 2)            as bucket_h,
  round(extract(epoch from (lag(last_collect) over w - last_collect)) / 3600.0, 2) as stale_by_h,
  wave, cit_lv, towers_built, buildings::text                           as buildings,
  gold_bn,
  to_char(damaged_until, 'MM-DD HH24:MI')                               as damaged_until
from h
window w as (order by at)
order by at;


-- =============================================================================
--  QUERY C — WHAT THE FORMULA SAYS HE SHOULD EARN
--  Pure arithmetic off his live save, so QUERY A has something to be compared
--  against. This is the module's own formula, not an estimate: VIP is the only
--  term I cannot read here, so it is printed as x1 and noted.
-- =============================================================================
select
  wave, zone, mine_lv, silo_lv, cit_lv,
  round(power(wave, 1.45)::numeric, 1)                                    as wave_term,
  round(power(zone, 1.12)::numeric, 1)                                    as zone_term,
  case when wave >= 100 then 2 else 1 end                                 as era_x2,
  round(1 + mine_lv * 0.10, 2)                                            as mine_mult,
  round((1500 * power(wave, 1.45) * power(zone, 1.12)
         * (1 + mine_lv * 0.10) * (case when wave >= 100 then 2 else 1 end))::numeric / 1e9, 2)
                                                                          as gold_bn_per_hour,
  round((2.2 * 1500 * power(wave, 1.45) * power(zone, 1.12)
         * (1 + mine_lv * 0.10) * (case when wave >= 100 then 2 else 1 end))::numeric / 1e9, 2)
                                                                          as gold_bn_per_wave,
  8 + silo_lv * 2                                                         as storage_cap_h,
  round(((8 + silo_lv * 2) * 1500 * power(wave, 1.45) * power(zone, 1.12)
         * (1 + mine_lv * 0.10) * (case when wave >= 100 then 2 else 1 end))::numeric / 1e9, 2)
                                                                          as gold_bn_per_collect,
  'excludes VIP.mult(afk) and VIP.mult(gold) — multiply both figures by that'  as note
from (
  select
    (case when jsonb_typeof(data->'homecit'->'wave')  = 'number' then (data->'homecit'->'wave')  #>>'{}' else '0' end)::numeric as wave,
    (case when jsonb_typeof(data->'highestUnlocked')  = 'number' then (data->'highestUnlocked')  #>>'{}' else '1' end)::numeric as zone,
    (case when jsonb_typeof(data->'homecit'->'b'->'mine') = 'number' then (data->'homecit'->'b'->'mine') #>>'{}' else '0' end)::numeric as mine_lv,
    (case when jsonb_typeof(data->'homecit'->'b'->'silo') = 'number' then (data->'homecit'->'b'->'silo') #>>'{}' else '0' end)::numeric as silo_lv,
    (case when jsonb_typeof(data->'homecit'->'cit')   = 'number' then (data->'homecit'->'cit')   #>>'{}' else '0' end)::numeric as cit_lv
  from public.saves where user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
) v;


-- =============================================================================
--  QUERY D — BATTLE SPEED, AND THE MOTHERSHIP UNLOCK
--  `secretSpeed` is present in his save. 10x battle speed does not change what a
--  wave PAYS, but it changes how many waves fit in an hour — which is the whole
--  of the rate. Ordered by time so we can see what he was actually running.
-- =============================================================================
select
  to_char(at, 'MM-DD HH24:MI:SS') as at_utc,
  game_speed, secret_speed, pro_until, wave,
  round(gold / 1e9) as gold_bn
from (
  select sc.created_at as at,
         coalesce(sc.data->>'gameSpeed', '-')   as game_speed,
         coalesce(sc.data->>'secretSpeed', '-') as secret_speed,
         case when jsonb_typeof(sc.data->'proUntil') = 'number' and (sc.data->'proUntil' #>>'{}')::numeric > 0
              then to_char(to_timestamp((sc.data->'proUntil' #>>'{}')::numeric / 1000), 'YYYY-MM-DD') else 'none' end as pro_until,
         (case when jsonb_typeof(sc.data->'homecit'->'wave') = 'number' then (sc.data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave,
         (case when jsonb_typeof(sc.data->'gold') = 'number' then (sc.data->'gold') #>>'{}' else '0' end)::numeric as gold
  from public.save_conflicts sc
  where sc.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
  union all
  select s.updated_at,
         coalesce(s.data->>'gameSpeed', '-'),
         coalesce(s.data->>'secretSpeed', '-'),
         case when jsonb_typeof(s.data->'proUntil') = 'number' and (s.data->'proUntil' #>>'{}')::numeric > 0
              then to_char(to_timestamp((s.data->'proUntil' #>>'{}')::numeric / 1000), 'YYYY-MM-DD') else 'none' end,
         (case when jsonb_typeof(s.data->'homecit'->'wave') = 'number' then (s.data->'homecit'->'wave') #>>'{}' else '0' end)::numeric,
         (case when jsonb_typeof(s.data->'gold') = 'number' then (s.data->'gold') #>>'{}' else '0' end)::numeric
  from public.saves s
  where s.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
) q
order by at;


-- =============================================================================
--  QUERY F — HIS TOWERS, AND WHY WAVE 425 IS REACHABLE AT ALL
--
--  THE WAVE IS PRICED IN HIS OWN DPS, SO HIS DPS CANCELS. From `rollNext()`:
--
--      N        = min(40, 10 + ceil(wave x 1.6))        -- raider COUNT, capped at 40
--      unitHp   = ps.dps x (1 + turretPct) x (55 + wave x 4.5) / N
--      total HP = N x unitHp = ps.dps x (1 + turretPct) x (55 + wave x 4.5)
--
--  Divide total HP by his fleet DPS and the fleet term disappears: a wave costs
--  **55 + 4.5 x wave SECONDS** of fleet-only fire for every pilot in the game,
--  forever. Fleet power buys nothing here. Wave 425 = 1,967s = 33 minutes
--  nominal — and the raider COUNT stopped growing at wave 19, so from there on
--  it is 40 units of fatter HP, which is a single-target and pierce problem.
--
--  THE ONLY THINGS THAT SHORTEN A WAVE:
--    · tower levels      laser 0.12/lv · cryo 0.03/lv (x up to 10 targets)
--                        missile 0.55/lv per 2.8s · rail 1.60/lv per 4.5s, PIERCING
--                        THE WHOLE LINE (so its real value multiplies by however
--                        many of the 40 raiders are on the firing line)
--    · Defense Grid      turretPct = turret_lv x 0.08, x Bastion Command (PASCEND 'tower')
--    · battle speed      wall-clock only, but that is exactly what waves/hour is
--
--  And `twMaxLv = 10 + cit x 10` with NO CAP ON `cit` — so tower levels are
--  uncapped, each Citadel ascension adds 10 more to every pad, and the wave cost
--  grows LINEARLY (4.5s each) while the reward grows as wave^1.45. Gold per
--  second therefore RISES with depth forever: going deeper is strictly better,
--  which is the whole reason he is at 425 and still climbing.
--
--  This query prints the pads, the levels, and what that kit predicts. If
--  QUERY A's measured waves/hour is near `waves_per_hour_pred`, the towers
--  explain the wave and nothing else needs explaining. If A is much faster than
--  this, something outside the module is resolving waves.
-- =============================================================================
with s as (
  select data from public.saves where user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
),
hc as (
  select
    (case when jsonb_typeof(data->'homecit'->'wave') = 'number' then (data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave,
    (case when jsonb_typeof(data->'homecit'->'cit')  = 'number' then (data->'homecit'->'cit')  #>>'{}' else '0' end)::numeric as cit_lv,
    (case when jsonb_typeof(data->'homecit'->'b'->'mine')   = 'number' then (data->'homecit'->'b'->'mine')   #>>'{}' else '0' end)::numeric as mine_lv,
    (case when jsonb_typeof(data->'homecit'->'b'->'silo')   = 'number' then (data->'homecit'->'b'->'silo')   #>>'{}' else '0' end)::numeric as silo_lv,
    (case when jsonb_typeof(data->'homecit'->'b'->'turret') = 'number' then (data->'homecit'->'b'->'turret') #>>'{}' else '0' end)::numeric as turret_lv,
    (case when jsonb_typeof(data->'homecit'->'b'->'repair') = 'number' then (data->'homecit'->'b'->'repair') #>>'{}' else '0' end)::numeric as repair_lv,
    coalesce(nullif(data->>'gameSpeed', ''), '1')::numeric as speed,
    coalesce(data->'homecit'->'tw', '[]'::jsonb) as tw
  from s
),
pads as (
  select ord as pad,
         coalesce(t.value->>'k', '(empty)') as tower,
         case when t.value->>'lv' ~ '^[0-9]+$' then (t.value->>'lv')::numeric else 0 end as lv,
         left(coalesce(t.value->'sp', 'null'::jsonb)::text, 120) as paid
  from hc, lateral jsonb_array_elements(hc.tw) with ordinality t(value, ord)
),
mult as (
  select
    coalesce(sum(case tower when 'laser' then 0.12 when 'cryo' then 0.30
                            when 'missile' then 0.55 / 2.8 when 'rail' then 1.60 / 4.5
                            else 0 end * lv), 0)                                as tower_x,
    coalesce(sum(case when tower = 'rail' then 1.60 / 4.5 * lv else 0 end), 0)  as rail_x,
    count(*) filter (where tower <> '(empty)')                                  as pads_built,
    max(lv)                                                                     as top_lv
  from pads
)
select 'PAD ' || p.pad as row_, p.tower, p.lv::text as level,
       (10 + h.cit_lv * 10)::text as max_level_allowed, p.paid as recorded_spend
from pads p, hc h
union all
select 'STRUCTURES', 'mine/silo/turret/repair',
       h.mine_lv || ' / ' || h.silo_lv || ' / ' || h.turret_lv || ' / ' || h.repair_lv,
       'citadel lv ' || h.cit_lv, 'Defense Grid = +' || round(h.turret_lv * 8) || '% fleet DPS as turret fire'
from hc h
union all
select 'WAVE COST', 'nominal fleet-only seconds', round(55 + 4.5 * h.wave)::text,
       'wave ' || h.wave, 'his own DPS cancels out of this — same for every pilot'
from hc h
union all
select 'TOWER KIT', 'effective DPS multiple', round(m.tower_x, 1)::text,
       m.pads_built || '/8 pads · top lv ' || m.top_lv,
       'rail alone ' || round(m.rail_x, 1) || 'x, and it PIERCES — multiply by raiders on the line (up to 40)'
from mult m
union all
select 'PREDICTION', 'seconds per wave',
       round(((1 + h.turret_lv * 0.08) * (55 + 4.5 * h.wave))
             / greatest(0.01, 1 + h.turret_lv * 0.08 + m.tower_x) / h.speed, 1)::text,
       'at ' || h.speed || 'x battle speed',
       'plus the 2.2s auto-defense intermission per wave'
from hc h, mult m
union all
select 'PREDICTION', 'waves per hour',
       round(3600 / greatest(0.1, 2.2 + ((1 + h.turret_lv * 0.08) * (55 + 4.5 * h.wave))
             / greatest(0.01, 1 + h.turret_lv * 0.08 + m.tower_x) / h.speed))::text,
       'compare with QUERY A', 'ignores pierce, so the true rate is FASTER than this'
from hc h, mult m
union all
select 'PREDICTION', 'gold bn per hour',
       round(3600 / greatest(0.1, 2.2 + ((1 + h.turret_lv * 0.08) * (55 + 4.5 * h.wave))
             / greatest(0.01, 1 + h.turret_lv * 0.08 + m.tower_x) / h.speed)
             * (2.2 * 1500 * power(h.wave, 1.45) * power(450, 1.12) * (1 + h.mine_lv * 0.10) * 2)::numeric / 1e9)::text,
       'waves/hour x ~80bn per wave', 'wave rewards only — storage collections are on top'
from hc h, mult m
order by row_, tower;


-- =============================================================================
--  QUERY E — IS 425 AN OUTLIER, OR JUST FIRST?
--  The published board, plus every save's own wave for the accounts that have
--  never published. If the second place is at wave 60, one player found the
--  treadmill; if there are ten pilots past 200, we shipped it to everyone and
--  the fix is a curve, not a moderation call.
-- =============================================================================
select
  coalesce(nullif(btrim(s.data->>'pilotName'), ''), nullif(btrim(s.data->>'name'), ''), 'Operator') as pilot,
  (case when jsonb_typeof(s.data->'homecit'->'wave') = 'number' then (s.data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave_in_save,
  (to_jsonb(l) ->> 'hcwave')                                                                        as wave_published,
  (case when jsonb_typeof(s.data->'level')            = 'number' then (s.data->'level')            #>>'{}' else '0' end)::numeric as lv,
  (case when jsonb_typeof(s.data->'highestUnlocked')  = 'number' then (s.data->'highestUnlocked')  #>>'{}' else '0' end)::numeric as zone,
  round((case when jsonb_typeof(s.data->'gold') = 'number' then (s.data->'gold') #>>'{}' else '0' end)::numeric / 1e9)            as gold_bn,
  coalesce((select count(*) from public.save_conflicts c where c.user_id = s.user_id), 0)            as conflicts,
  s.updated_at
from public.saves s
left join public.leaderboard l on l.user_id = s.user_id
where (case when jsonb_typeof(s.data->'homecit'->'wave') = 'number' then (s.data->'homecit'->'wave') #>>'{}' else '0' end)::numeric > 20
order by wave_in_save desc
limit 40;
