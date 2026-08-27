-- =============================================================================
--  audit-alcyone.sql — WHERE DID ALCYONE'S RESOURCES COME FROM?   (READ-ONLY)
-- -----------------------------------------------------------------------------
--  Nothing in this file writes. No DDL, no updates, no deletes — four SELECTs.
--  Safe to run on the live database while he is playing.
--
--  HOW TO RUN. The Supabase SQL editor only shows the result of the LAST
--  statement, so run these ONE AT A TIME and paste each result back:
--
--      QUERY 1  which account(s) are called Alcyone      ← run first
--      QUERY 2  THE REPORT (one tall table, ~60 rows)    ← the main one
--      QUERY 3  money ledgers (purchases / IAP / wallet)
--      QUERY 4  optional extras — only if we need them
--
--  If QUERY 3 or 4 errors with "relation does not exist", that migration was
--  never run on this project; skip that block and move on. QUERY 1 and 2 only
--  touch tables we know are live (saves, leaderboard, koth_*, save_conflicts).
--
--  WHAT WE ARE ACTUALLY TESTING. Every balance in this game lives in the save
--  blob the client writes, so the server cannot tell us where a number came
--  from directly. What it CAN tell us is whether the number is consistent with
--  the things that are recorded independently — receipts, kill counts, hunt
--  lockouts, the clamp log, and the save's own history. Each section below
--  pairs a balance with the record that should bound it.
--
--  READ THE VERDICT SECTION FIRST, AND IN ORDER. Two entirely legitimate things
--  produce "infinite resources" and both are one row away:
--
--    1. THE UNLIMITED COUPON. `state.unlimited = 1` makes redeem.js re-top gold,
--       LootCoins, Dread Cores, fuel, iron, plasma (and Prism) to 1e15 every 4
--       seconds whenever any of them drops below 1e14. It is REPEATABLE and it
--       is a comp code we issue. If that flag is set, his wallets are explained
--       and there is no exploit to find — the question becomes how he got the
--       code, which is a Discord/support question, not a database one.
--    2. THE 100B COUPON (`cur100b`). +1e11 gold, fuel, iron, plasma and
--       +1e11 LootCoins, one per account. Also ours.
--
--  Only if neither is present is a loophole the likely story. The candidates,
--  in order of how much they pay:
--
--    · Dread Cores past what the hunt can have paid — ascending re-opened the
--      weekly tier lockout before 712 (`dreadLock` was not in ASC_KEEP).
--    · Fittings/gold from the cargo run and Void tiles — `lootBlocked()` was
--      four hand-copied clauses before 712, so boss showers paid out on a zone
--      priced two rarity tiers above the pilot's frontier.
--    · A one-time coupon re-redeemed through a save merge — `redeemedCodes` was
--      not unioned in mergeSaves() for a while, so a stale copy winning a merge
--      dropped the redemption mark and the code could be used again.
--    · A hash in `redeemedCodes` that is NOT in the shipped table = an edited
--      save. That one is decisive; the report calls it out by name.
--
--  AND WHATEVER WE FIND: close the hole, do not claw back what is already on the
--  account, and put the closure in the patch notes. Silent removal of something
--  a player is holding reads exactly like a bug.
-- =============================================================================


-- =============================================================================
--  QUERY 1 — WHO IS ALCYONE
--  Names are player-set and not unique, so this searches the save, the
--  leaderboard and the KOTH board and returns every candidate with the headline
--  wallets, so it is obvious which row is him. Note the user_id.
-- =============================================================================
with ids as (
  select user_id from public.saves
    where data->>'pilotName' ilike '%alcyone%' or data->>'name' ilike '%alcyone%'
  union select user_id from public.leaderboard  where name ilike '%alcyone%'
  union select user_id from public.koth_scores  where name ilike '%alcyone%'
)
select
  i.user_id,
  coalesce(nullif(btrim(s.data->>'pilotName'), ''), nullif(btrim(s.data->>'name'), '')) as save_name,
  l.name                                                                                as board_name,
  u.email,
  (case when jsonb_typeof(s.data->'level')      = 'number' then (s.data->'level')      #>>'{}' else '0' end)::numeric as lv,
  (case when jsonb_typeof(s.data->'gold')       = 'number' then (s.data->'gold')       #>>'{}' else '0' end)::numeric as gold,
  (case when jsonb_typeof(s.data->'credits')    = 'number' then (s.data->'credits')    #>>'{}' else '0' end)::numeric as lootcoins,
  (case when jsonb_typeof(s.data->'dreadCores') = 'number' then (s.data->'dreadCores') #>>'{}' else '0' end)::numeric as dread_cores,
  (s.data->'unlimited') is not null                                                     as unlimited_flag,
  s.updated_at                                                                          as last_save,
  u.created_at                                                                          as account_created,
  u.last_sign_in_at
from ids i
left join public.saves       s on s.user_id = i.user_id
left join auth.users         u on u.id      = i.user_id
left join public.leaderboard l on l.user_id = i.user_id
order by gold desc nulls last;


-- =============================================================================
--  QUERY 2 — THE REPORT
--  One tall table: section / metric / value / what it means. Runs with no edits.
--  If QUERY 1 found more than one Alcyone, every section repeats per account —
--  the `who` column says which. To pin it to one account, uncomment the `where
--  s.user_id = ...` line at the end of the `acct` CTE and paste the id.
-- =============================================================================
with ids as (
  select user_id from public.saves
    where data->>'pilotName' ilike '%alcyone%' or data->>'name' ilike '%alcyone%'
  union select user_id from public.leaderboard  where name ilike '%alcyone%'
  union select user_id from public.koth_scores  where name ilike '%alcyone%'
),
acct as (
  select s.user_id, s.data as d, s.updated_at as saved_at,
         (to_jsonb(s) - 'data')->>'rev' as rev,          -- null if save-cas.sql never ran
         u.email, u.created_at as acct_created, u.last_sign_in_at,
         coalesce(nullif(btrim(s.data->>'pilotName'), ''), nullif(btrim(s.data->>'name'), ''), 'Operator') as pilot
  from ids i
  join public.saves s on s.user_id = i.user_id
  left join auth.users u on u.id = i.user_id
  -- where s.user_id = 'PASTE-UUID-FROM-QUERY-1'::uuid    -- uncomment to pin to one account
),
-- every numeric read, type-guarded once. A missing field or a non-number is 0
-- rather than an error: saves predate several of these systems.
x as (
  select acct.*,
    pilot || ' · ' || left(user_id::text, 8) as who,
    (case when jsonb_typeof(d->'gold')                 = 'number' then (d->'gold')                 #>>'{}' else '0' end)::numeric as gold,
    (case when jsonb_typeof(d->'credits')              = 'number' then (d->'credits')              #>>'{}' else '0' end)::numeric as lc,
    (case when jsonb_typeof(d->'dreadCores')           = 'number' then (d->'dreadCores')           #>>'{}' else '0' end)::numeric as cores,
    (case when jsonb_typeof(d->'mechCores')            = 'number' then (d->'mechCores')            #>>'{}' else '0' end)::numeric as mech_cores,
    (case when jsonb_typeof(d->'resources'->'fuel')    = 'number' then (d->'resources'->'fuel')    #>>'{}' else '0' end)::numeric as fuel,
    (case when jsonb_typeof(d->'resources'->'iron')    = 'number' then (d->'resources'->'iron')    #>>'{}' else '0' end)::numeric as iron,
    (case when jsonb_typeof(d->'resources'->'plasma')  = 'number' then (d->'resources'->'plasma')  #>>'{}' else '0' end)::numeric as plasma,
    (case when jsonb_typeof(d->'prism'->'ingots')      = 'number' then (d->'prism'->'ingots')      #>>'{}' else '0' end)::numeric as prism,
    (case when jsonb_typeof(d->'cmdr'->'dust')         = 'number' then (d->'cmdr'->'dust')         #>>'{}' else '0' end)::numeric as dust,
    (case when jsonb_typeof(d->'level')                = 'number' then (d->'level')                #>>'{}' else '0' end)::numeric as lv,
    (case when jsonb_typeof(d->'totalKills')           = 'number' then (d->'totalKills')           #>>'{}' else '0' end)::numeric as kills,
    (case when jsonb_typeof(d->'playTime')             = 'number' then (d->'playTime')             #>>'{}' else '0' end)::numeric as play_s,
    (case when jsonb_typeof(d->'highestDungeonReached')= 'number' then (d->'highestDungeonReached')#>>'{}' else '0' end)::numeric as zone,
    (case when jsonb_typeof(d->'lifetimeLooted')       = 'number' then (d->'lifetimeLooted')       #>>'{}' else '0' end)::numeric as looted,
    (case when jsonb_typeof(d->'lifetimeMissions')     = 'number' then (d->'lifetimeMissions')     #>>'{}' else '0' end)::numeric as missions,
    (case when jsonb_typeof(d->'pasc'->'stars')        = 'number' then (d->'pasc'->'stars')        #>>'{}' else '0' end)::numeric as stars,
    (case when jsonb_typeof(d->'pasc'->'pts')          = 'number' then (d->'pasc'->'pts')          #>>'{}' else '0' end)::numeric as asc_pts,
    (case when jsonb_typeof(d->'pasc'->'spent')        = 'number' then (d->'pasc'->'spent')        #>>'{}' else '0' end)::numeric as asc_spent,
    (case when jsonb_typeof(d->'kothCrowns')           = 'number' then (d->'kothCrowns')           #>>'{}' else '0' end)::numeric as crowns,
    (case when jsonb_typeof(d->'proUntil')             = 'number' then (d->'proUntil')             #>>'{}' else '0' end)::numeric as pro_until_ms,
    (case when jsonb_typeof(d->'gameSpeed')            = 'number' then (d->'gameSpeed')            #>>'{}' else '0' end)::numeric as speed,
    (case when jsonb_typeof(d->'inventory') = 'array' then jsonb_array_length(d->'inventory') else 0 end) as inv_n,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(d->'ownedShips')    = 'object' then d->'ownedShips'    else '{}'::jsonb end)) as ships_n,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(d->'blueprints')    = 'object' then d->'blueprints'    else '{}'::jsonb end)) as bp_n,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(d->'pilot'->'nodes')= 'object' then d->'pilot'->'nodes'else '{}'::jsonb end)) as pnodes_n,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(d->'dreadLock')     = 'object' then d->'dreadLock'     else '{}'::jsonb end)) as dlock_n,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(d->'citadels')      = 'object' then d->'citadels'      else '{}'::jsonb end)) as cits_n,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(d->'redeemedCodes') = 'object' then d->'redeemedCodes' else '{}'::jsonb end)) as codes_n,
    (select count(*) from jsonb_object_keys(case when jsonb_typeof(d->'purchases')     = 'object' then d->'purchases'     else '{}'::jsonb end)) as skus_n
  from acct
),
-- the shipped coupon table (js/redeem.js, build 727). A hash in the save that is
-- NOT in this list did not come from a code we issued.
codes(h, reward) as (values
  ('4c487efee2ea903a6a55f550e94b232a943708517c627ee1ae0da3078a9dbc68','unlimited  ← EVERY WALLET TOPPED TO 1e15, FOREVER'),
  ('e5b4c8f25f7b5121822fd78ca61a32cb99cd7c38b20ed7b5cdd84157a2e6c181','allships (FULL FLEET + flight waiver)'),
  ('0ac9de52441b339d974eb6a02e843bad7f73dedcf2e9563e85b1224a251bb79f','cur100b  ← +1e11 gold/fuel/iron/plasma +1e11 LC'),
  ('8e08f5932bc7975eae569865dfb6391a947cc151937b2e913f90ced22fb501bc','lvl100'),
  ('b73594a53866f757d1d2db0f96c26a7b7a27f7d92a3337a319d7e21c60cab6e2','lvl200'),
  ('ad4e3bef125286ba6feca86a07a3e7b700829d5e24cf29791dbeaca062c1b190','lvl500'),
  ('29a76145a8bfe2b0721812e86c8db05d745b4b75a325c775b7334bf3994a65f4','pro365'),
  ('f542c4091a26248648e7b83928c99e86dc9cc9f7c888262830a6a165f471202e','pro30'),
  ('f839bbc7dfcbf2b2f1a84aa8895d93d9e182a527770516284d5eabb7dfdd81bd','discord1k (1,000 LC, one per account)'),
  ('7f96669af9a455f4146ef636eb98acc7ce439bb6d35496438a62c60a83c6920d','tourbeta'),
  ('9ff2504a7fc15161327c39e288114d3ad050badd03c5f43ba4856aeab1bbe07d','voidmaw VOIDMAW-LHXU-V9LE'),
  ('7bbf1ecf605cd6cc7d1bbeb6dc4b48fbe3ecfc76661684f0bee329749ba86555','voidmaw VOIDMAW-KASK-9YKR'),
  ('da1c04fa06c0616f7d8a66f95b9df791d0fc2e5f3bc96e4c430ba4db2177a67a','voidmaw VOIDMAW-CTPE-RGQ5'),
  ('f8acb1c9057d2f38fa843cb3eba80494ba00392178a544113e027709c18adfa9','voidmaw VOIDMAW-N95V-TGHW'),
  ('38c15cc47b8411eb0d90c86312049c0d3ec279055be48dc1f0a61b5cf9d2e984','voidmaw VOIDMAW-7WPN-96V2'),
  ('3c90b668569b3122870e306a6150641b61d42528ae7cf0064f916960622d0c5f','voidmaw VOIDMAW-7RVB-UNLS'),
  ('707d1def31f6780741a6a3bdf5d7d62cb9a8464ddcd396d28eb6ed6d38a13719','voidmaw VOIDMAW-GMYJ-B3GG'),
  ('8943651a20c271de77ab19456dfaec5bf8c2ae3ed210708c7bd3973081d37cb2','voidmaw VOIDMAW-GBUL-HY6G'),
  ('bfc2480f4b2c6820edecde10310a5c54670a6deadfe8d96c429370ae3cded934','voidmaw VOIDMAW-SHMV-LLVM'),
  ('94116824cb4b3cc82d3154d4da9995782132f21d5d04a623a73335d01ee51be4','voidmaw VOIDMAW-24FT-S667'),
  ('7154891c38981a593183a2bd5056954c602702768d17bc16db7f729c366c9c28','allships (legacy hash)'),
  ('c85be0226b8210972b976cd432ef2f7b930cc7744a61fc20c8a2e1b7049b3ea3','cur100b  ← +1e11 EVERYTHING (legacy hash)'),
  ('2fd29fc18b227d135d29f6c247219d1810ba0de399944a922e5e3dbd8503d9a6','lvl100 (legacy hash)'),
  ('8b969257b1fb6a41faf97cdd280775d99eaf7351afa8f0d6a1854f3147a9a754','lvl200 (legacy hash)'),
  ('5783c02670fb4fca70cffa0eb9715832ac4f12e440bff0aff315afbd6ececd17','lvl500 (legacy hash)'),
  ('cd61d69bb4cc5ad93969432e5e51849f6160313d4c2ec8db6d52b6b0b05b71f6','pro365 (legacy hash)'),
  ('a0c0f10fa9b5bda29a15e70282be99200d802ca2de9c2cb7ba64d771542ced97','pro30 (legacy hash)')
),
red as (   -- his redemptions, decoded
  select x.user_id, x.who, e.key as h, c.reward,
         case when jsonb_typeof(e.value) = 'number'
              then to_char(to_timestamp((e.value #>>'{}')::numeric / 1000), 'YYYY-MM-DD HH24:MI') || ' UTC'
              else e.value::text end as at_txt
  from x
  cross join lateral jsonb_each(case when jsonb_typeof(x.d->'redeemedCodes') = 'object' then x.d->'redeemedCodes' else '{}'::jsonb end) e
  left join codes c on c.h = e.key
),
-- highest item level anywhere in the bag or on the hull. The cargo/Void loot leak
-- is the only way to hold gear priced far above the pilot's own frontier.
gear as (
  select x.user_id,
         max(g.lvl) as max_item_lv,
         count(*) filter (where g.lvl > x.lv * 1.5) as items_above_pilot
  from x
  cross join lateral (
    select greatest(
      case when q.value->>'lv'    ~ '^[0-9]+(\.[0-9]+)?$' then (q.value->>'lv')::numeric    else 0 end,
      case when q.value->>'level' ~ '^[0-9]+(\.[0-9]+)?$' then (q.value->>'level')::numeric else 0 end,
      case when q.value->>'ilvl'  ~ '^[0-9]+(\.[0-9]+)?$' then (q.value->>'ilvl')::numeric  else 0 end,
      case when q.value->>'tier'  ~ '^[0-9]+(\.[0-9]+)?$' then (q.value->>'tier')::numeric  else 0 end) as lvl
    from jsonb_array_elements(case when jsonb_typeof(x.d->'inventory') = 'array' then x.d->'inventory' else '[]'::jsonb end) q
    union all
    select greatest(
      case when q2.value->>'lv'    ~ '^[0-9]+(\.[0-9]+)?$' then (q2.value->>'lv')::numeric    else 0 end,
      case when q2.value->>'level' ~ '^[0-9]+(\.[0-9]+)?$' then (q2.value->>'level')::numeric else 0 end,
      case when q2.value->>'ilvl'  ~ '^[0-9]+(\.[0-9]+)?$' then (q2.value->>'ilvl')::numeric  else 0 end,
      case when q2.value->>'tier'  ~ '^[0-9]+(\.[0-9]+)?$' then (q2.value->>'tier')::numeric  else 0 end) as lvl
    from jsonb_each(case when jsonb_typeof(x.d->'equipped') = 'object' then x.d->'equipped' else '{}'::jsonb end) q2
    where jsonb_typeof(q2.value) = 'object'
  ) g
  group by x.user_id
),
rep as (

-- ---- 0 · VERDICT ------------------------------------------------------------
select 0 as ord, '—' as who, 'VERDICT' as section, 'accounts matched' as metric,
       (select count(*)::text from x) as value,
       'if this is not 1, every section repeats per account — read the who column' as means
union all
select 0, who, 'VERDICT', '1 · UNLIMITED coupon flag',
       case when (d->'unlimited') is not null and coalesce(d->>'unlimited','0') not in ('0','false','') then 'SET — this explains every wallet' else 'not set' end,
       'redeem.js re-tops gold/LC/cores/fuel/iron/plasma to 1e15 whenever one drops under 1e14. If SET, stop hunting for an exploit and ask how he got the code.' from x
union all
select 0, who, 'VERDICT', '2 · wallets pinned at the top-up floor',
       case when greatest(gold, lc, cores, fuel, iron, plasma) >= 1e14 then 'YES — ' || greatest(gold, lc, cores, fuel, iron, plasma)::text else 'no' end,
       'anything at or above 1e14 is the unlimited watchdog''s signature, whether or not the flag survived the last merge' from x
union all
select 0, who, 'VERDICT', '3 · int32 wrap fingerprint (LootCoins)',
       case when lc between 1200000000 and 1230000000 then 'LIKELY — ' || lc::text || ' (the 100B coupon paid 1,215,752,192 before build 690)' else 'no' end,
       'if this matches, the LootCoins came from cur100b before the addCredits fix, not from an exploit' from x
union all
select 0, who, 'VERDICT', '4 · Dread Cores vs hunt lockouts',
       cores::text || ' held · ' || dlock_n::text || ' tier locks · ' || stars::text || ' ascension stars · ' || pnodes_n::text || ' tree nodes',
       'the hunt pays 1-2 cores per tier per WEEK. Cores far past (weeks played x tiers) with high stars = the pre-712 ascension re-farm (dreadLock was not in ASC_KEEP)' from x
union all
select 0, who, 'VERDICT', '5 · gold per lifetime kill',
       case when kills > 0 then round(gold / kills)::text else 'n/a — 0 kills' end,
       'enemyGold at his zone is the honest ceiling (order of magnitude, not exact). Millions per kill means the gold did not come from killing things' from x
union all
select 0, who, 'VERDICT', '6 · kills per hour played',
       case when play_s > 3600 then round(kills / (play_s / 3600))::text else 'n/a — under 1h logged' end,
       'sustained five figures/hour is the corner-camp spawn wedge or an idle multiplier, not hand play' from x
union all
select 0, who, 'VERDICT', '7 · unknown coupon hashes',
       coalesce((select count(*)::text from red where red.user_id = x.user_id and red.reward is null), '0'),
       'DECISIVE IF > 0: a redemption mark that is not in the shipped table means the save was edited by hand' from x

-- ---- 1 · IDENTITY -----------------------------------------------------------
union all select 1, who, 'IDENTITY', 'user_id',            user_id::text,                        'the account' from x
union all select 1, who, 'IDENTITY', 'email',              coalesce(email, '—'),                 '' from x
union all select 1, who, 'IDENTITY', 'account created',    coalesce(acct_created::text, '—'),    'compare with the wallet size — a week-old account holding 1e15 is not a grind' from x
union all select 1, who, 'IDENTITY', 'last sign-in',       coalesce(last_sign_in_at::text, '—'), '' from x
union all select 1, who, 'IDENTITY', 'last cloud save',    saved_at::text,                       '' from x
union all select 1, who, 'IDENTITY', 'save revision',      coalesce(rev, 'n/a'),                 'number of accepted cloud pushes ever' from x
union all select 1, who, 'IDENTITY', 'level / zone',       lv::text || ' / ' || zone::text,       '' from x
union all select 1, who, 'IDENTITY', 'hours played',       round(play_s / 3600)::text,           'playTime is wall clock the sim actually ran' from x

-- ---- 2 · WALLETS NOW --------------------------------------------------------
union all select 2, who, 'WALLETS', 'gold',            gold::text,       '' from x
union all select 2, who, 'WALLETS', 'LootCoins',       lc::text,         'the paid currency — cross-check against QUERY 3 receipts' from x
union all select 2, who, 'WALLETS', 'Dread Cores',     cores::text,      'hunt-only currency, 1-2 per tier per week' from x
union all select 2, who, 'WALLETS', 'Mech cores',      mech_cores::text, '' from x
union all select 2, who, 'WALLETS', 'fuel',            fuel::text,       '' from x
union all select 2, who, 'WALLETS', 'iron',            iron::text,       '' from x
union all select 2, who, 'WALLETS', 'plasma',          plasma::text,     '' from x
union all select 2, who, 'WALLETS', 'Prism ingots',    prism::text,      '' from x
union all select 2, who, 'WALLETS', 'Commander dust',  dust::text,       '' from x
union all select 2, who, 'WALLETS', 'ascension pts / spent / stars', asc_pts::text || ' / ' || asc_spent::text || ' / ' || stars::text, 'stars are the dominant save-merge weight' from x

-- ---- 3 · ENTITLEMENTS -------------------------------------------------------
union all select 3, who, 'ENTITLEMENTS', 'purchases (skus)', left(coalesce((d->'purchases')::text, '—'), 400), 'a sku is a receipt. speed4lc is the 2x battle-speed unlock (the name is historical)' from x
union all select 3, who, 'ENTITLEMENTS', 'Pro until',
       case when pro_until_ms > 0 then to_char(to_timestamp(pro_until_ms / 1000), 'YYYY-MM-DD') else 'none' end,
       'compare with QUERY 3 — Pro with no purchase row and no pro365 coupon is unexplained' from x
union all select 3, who, 'ENTITLEMENTS', 'battle speed',   speed::text, '1 / 2 (500 LC) / 3 (Pro) / 10 (Mothership egg). Anything else is an edited save' from x
union all select 3, who, 'ENTITLEMENTS', 'unlimited',      coalesce(d->>'unlimited', '—'),    'the coupon flag' from x
union all select 3, who, 'ENTITLEMENTS', 'flightWaiver',   coalesce(d->>'flightWaiver', '—'), 'set by the FULL FLEET coupon — clears every hull licence' from x
union all select 3, who, 'ENTITLEMENTS', 'tourBeta',       coalesce(d->>'tourBeta', '—'),     '' from x
union all select 3, who, 'ENTITLEMENTS', 'hulls / blueprints / citadels', ships_n::text || ' / ' || bp_n::text || ' / ' || cits_n::text,
       'every hull owned with few blueprints = the FULL FLEET coupon or grantShip abuse' from x

-- ---- 4 · COUPONS DECODED ----------------------------------------------------
union all
select 4, red.who, 'COUPONS', coalesce(red.reward, 'UNKNOWN HASH ' || left(red.h, 12) || '…'),
       red.at_txt,
       case when red.reward is null then 'NOT A CODE WE SHIPPED — edited save, or a build newer than 727' else 'redeemed at this time' end
from red
union all
select 4, who, 'COUPONS', '(total redemption marks)', codes_n::text,
       case when codes_n = 0 then 'no coupon has ever been redeemed on this account — the wallets came from somewhere else' else '' end
from x

-- ---- 5 · EARNING CAPACITY ---------------------------------------------------
union all select 5, who, 'CAPACITY', 'lifetime kills',      kills::text,    'KOTH kills are excluded by design, so this is real-zone killing only' from x
union all select 5, who, 'CAPACITY', 'lifetime loot picked',looted::text,   '' from x
union all select 5, who, 'CAPACITY', 'lifetime missions',   missions::text, '' from x
union all select 5, who, 'CAPACITY', 'KOTH crowns',         crowns::text,   'server-sourced; gates Titan Aquila (25) and Celestial Corvus (100)' from x
union all select 5, who, 'CAPACITY', 'pilot tree nodes',    pnodes_n::text, 'each node cost cores — nodes x cost is a floor on cores ever earned' from x
union all select 5, who, 'CAPACITY', 'bag size',            inv_n::text,    '' from x
union all select 5, who, 'CAPACITY', 'highest item level',  coalesce((select max_item_lv::text from gear where gear.user_id = x.user_id), '—'),
       'gear priced far above his own frontier is the pre-712 cargo/Void loot leak' from x
union all select 5, who, 'CAPACITY', 'items above 1.5x his level', coalesce((select items_above_pilot::text from gear where gear.user_id = x.user_id), '—'),
       'a handful is normal drift; dozens is the leak' from x

-- ---- 6 · KOTH CLAMP LOG -----------------------------------------------------
union all
select 6, x.who, 'KOTH CLAMPS', 'clamped submissions', coalesce(k.n::text, '0'),
       'koth_audit is the only record of who was pushing past koth_max_kps. Empty is clean.' from x
  left join lateral (select count(*) n, sum(requested) req, sum(granted) grt, max(requested - granted) worst, min(at) f, max(at) l
                     from public.koth_audit ka where ka.user_id = x.user_id) k on true
union all
select 6, x.who, 'KOTH CLAMPS', 'requested vs granted',
       coalesce(k.req::text, '0') || ' → ' || coalesce(k.grt::text, '0') || ' (worst single gap ' || coalesce(k.worst::text, '0') || ')',
       'a large refused total means the client was reporting kills the server would not accept' from x
  left join lateral (select count(*) n, sum(requested) req, sum(granted) grt, max(requested - granted) worst, min(at) f, max(at) l
                     from public.koth_audit ka where ka.user_id = x.user_id) k on true
union all
select 6, x.who, 'KOTH CLAMPS', 'clamp window', coalesce(k.f::text || ' → ' || k.l::text, '—'), '' from x
  left join lateral (select min(at) f, max(at) l from public.koth_audit ka where ka.user_id = x.user_id) k on true
union all
select 6, x.who, 'KOTH CLAMPS', 'crowns awarded (ledger)',
       coalesce((select count(*)::text from public.koth_awards aw where aw.user_id = x.user_id), '0'),
       'compare with the save''s kothCrowns — the save may only ever be a floor on this' from x

-- ---- 7 · SAVE TIMELINE (the one place a jump is dated) ----------------------
union all
select 7, x.who, 'SAVE TIMELINE', 'quarantined conflict copies',
       coalesce((select count(*)::text from public.save_conflicts sc where sc.user_id = x.user_id), '0'),
       'each row is a losing timeline. Many rows = two clients writing, which is also how a one-time coupon got re-redeemed before the merge fix.' from x
union all
select 7, c.who, 'SAVE TIMELINE', to_char(c.created_at, 'MM-DD HH24:MI') || ' · ' || coalesce(c.reason, 'conflict'),
       'gold=' || c.g::text || ' lc=' || c.l::text || ' cores=' || c.co::text || ' lv=' || c.lvl::text || ' kills=' || c.kl::text,
       'walk these oldest→newest: the row where the wallet jumps dates the event' 
from (
  select x.who, sc.created_at, sc.reason,
    (case when jsonb_typeof(sc.data->'gold')       = 'number' then (sc.data->'gold')       #>>'{}' else '0' end)::numeric as g,
    (case when jsonb_typeof(sc.data->'credits')    = 'number' then (sc.data->'credits')    #>>'{}' else '0' end)::numeric as l,
    (case when jsonb_typeof(sc.data->'dreadCores') = 'number' then (sc.data->'dreadCores') #>>'{}' else '0' end)::numeric as co,
    (case when jsonb_typeof(sc.data->'level')      = 'number' then (sc.data->'level')      #>>'{}' else '0' end)::numeric as lvl,
    (case when jsonb_typeof(sc.data->'totalKills') = 'number' then (sc.data->'totalKills') #>>'{}' else '0' end)::numeric as kl
  from x join public.save_conflicts sc on sc.user_id = x.user_id
  order by sc.created_at desc limit 12
) c

-- ---- 8 · BOARD vs SAVE ------------------------------------------------------
union all
select 8, x.who, 'BOARD vs SAVE', 'published row',
       left(coalesce((to_jsonb(l) - 'fleet' - 'user_id')::text, 'no leaderboard row'), 600),
       'the client publishes these from the same save. A published level/kills that disagrees with section 1 means the save changed after the last publish (or the publish is stale — nothing published between builds 688 and 712).' from x
  left join public.leaderboard l on l.user_id = x.user_id
union all
select 8, x.who, 'BOARD vs SAVE', 'sessions / devices',
       left(coalesce((to_jsonb(sess) - 'user_id')::text, 'no session row'), 300),
       'one lease row; a device id that keeps changing is many clients on one account' from x
  left join public.active_sessions sess on sess.user_id = x.user_id

-- ---- 9 · RAW SUBTREES (paste these too — they are small) --------------------
union all select 9, who, 'RAW', 'pasc',          left(coalesce((d->'pasc')::text, '—'), 900),      'ascension: stars, points, perks' from x
union all select 9, who, 'RAW', 'dreadLock',     left(coalesce((d->'dreadLock')::text, '—'), 600), 'weekly hunt lockouts by tier — thin keys with fat cores is the re-farm' from x
union all select 9, who, 'RAW', 'cargo',         left(coalesce((d->'cargo')::text, '—'), 600),     'Cargo Defense record (wins, runs)' from x
union all select 9, who, 'RAW', 'mech',          left(coalesce((d->'mech')::text, '—'), 400),      'Foundry lifetime record' from x
union all select 9, who, 'RAW', 'resources',     left(coalesce((d->'resources')::text, '—'), 400), '' from x
union all select 9, who, 'RAW', 'stats',         left(coalesce((d->'stats')::text, '—'), 1200),    'career counters, truncated at 1200 chars' from x
union all select 9, who, 'RAW', 'lifeStats',     left(coalesce((d->'lifeStats')::text, '—'), 1200),'badge metrics, truncated' from x
union all select 9, who, 'RAW', 'top-level save keys',
       left((select string_agg(k, ' ' order by k) from jsonb_object_keys(d) k), 2000),
       'an unfamiliar key is either a system I have not read or a hand-edited save' from x
union all select 9, who, 'RAW', 'first 2 bag items',
       left(coalesce((select string_agg(q.value::text, '  ||  ') from (select value from jsonb_array_elements(case when jsonb_typeof(d->'inventory') = 'array' then d->'inventory' else '[]'::jsonb end) limit 2) q), '—'), 700),
       'shows the real item shape so the level test above can be tightened if needed' from x
)
select section, metric, value, means, who from rep order by ord, section, metric;


-- =============================================================================
--  QUERY 3 — MONEY LEDGERS  (run separately; skip any block that errors)
--  Did he PAY for the LootCoins he is holding? These three tables are the only
--  server-side record of currency entering an account.
-- =============================================================================
with ids as (
  select user_id from public.saves
    where data->>'pilotName' ilike '%alcyone%' or data->>'name' ilike '%alcyone%'
  union select user_id from public.leaderboard where name ilike '%alcyone%'
)
select 'stripe purchase' as source, p.created_at, p.kind || ' ' || coalesce(p.sku, '') as what,
       p.credits::text as credits, (p.amount_cents / 100.0)::text || ' ' || p.currency as paid
from ids i join public.purchases p on p.user_id = i.user_id
union all
select 'native IAP', t.created_at, t.platform || ' ' || t.product_id,
       t.credits::text, coalesce(t.pro_days::text || ' pro days', '')
from ids i join public.iap_transactions t on t.user_id = i.user_id
union all
select 'server wallet', null::timestamptz, 'wallets.credits (unclaimed)',
       (to_jsonb(w) ->> 'credits'), ''
from ids i join public.wallets w on w.user_id = i.user_id
order by created_at nulls last;


-- =============================================================================
--  QUERY 4 — OPTIONAL EXTRAS
--  Run individually, only if QUERY 2 leaves the question open. Each is one
--  statement; a "relation does not exist" just means that migration never ran.
-- =============================================================================

-- 4a · daily frozen stats — the DIFF between two days is a per-day activity log,
--      and the best available answer to "when did the gold appear?"
-- select day, left(stats::text, 400) as stats from notify_snapshots
--   where user_id = 'PASTE-UUID'::uuid order by day desc limit 30;

-- 4b · legitimate big payouts: rank rewards, casino winnings, KOTH prizes
-- select 'rank_award' as src, day::text, lc::text from public.rank_awards where user_id = 'PASTE-UUID'::uuid
-- union all select 'casino_payout', created_at::text, (to_jsonb(c) - 'user_id')::text from public.casino_payouts c where c.user_id = 'PASTE-UUID'::uuid
-- union all select 'koth_award', day::text, lc::text from public.koth_awards where user_id = 'PASTE-UUID'::uuid;

-- 4c · is he even a real account? (a simulated pilot holds no save and no auth row)
-- select id, name, (to_jsonb(p) - 'id' - 'name')::text from sim_pilots p where p.name ilike '%alcyone%';

-- 4d · Voidmaw / territory / war footprint
-- select (to_jsonb(s) - 'user_id')::text from public.sdread_scores s where s.user_id = 'PASTE-UUID'::uuid;
-- select count(*) as tiles, count(*) filter (where citadel) as citadels from public.territory where owner_id = 'PASTE-UUID'::uuid;
-- select kind, at, left(payload::text, 300) from public.war_events where payload::text ilike '%alcyone%' order by at desc limit 40;

-- 4e · everyone else sitting on the same fingerprint — if it IS a loophole, he is
--      not the only one who found it. Run this before deciding it is one player.
-- select coalesce(data->>'pilotName', data->>'name') as pilot, user_id,
--        (case when jsonb_typeof(data->'gold') = 'number' then (data->'gold') #>>'{}' else '0' end)::numeric as gold,
--        (case when jsonb_typeof(data->'credits') = 'number' then (data->'credits') #>>'{}' else '0' end)::numeric as lc,
--        (data->'unlimited') is not null as unlimited, updated_at
-- from public.saves
-- where (case when jsonb_typeof(data->'credits') = 'number' then (data->'credits') #>>'{}' else '0' end)::numeric > 1e10
--    or (case when jsonb_typeof(data->'gold')    = 'number' then (data->'gold')    #>>'{}' else '0' end)::numeric > 1e13
-- order by lc desc limit 50;
