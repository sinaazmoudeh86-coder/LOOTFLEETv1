-- =============================================================================
--  coupon-report.sql — WHO REDEEMED WHAT                    (read-only, safe)
-- -----------------------------------------------------------------------------
--  There is no redemption TABLE. redeem.js records a redemption in the player's
--  own save — `state.redeemedCodes` is { sha256(code): timestamp_ms } — because
--  the check has to work offline and the save is the only thing that syncs.
--
--  That is fine for the game and awkward for an operator, since the answer is
--  spread across every save blob. This unpacks it. Nothing here writes to game
--  data: it creates two VIEWS and selects from them.
--
--  WHY HASHES. Codes ship as SHA-256 only — the plaintext never appears in the
--  client, so nobody can read the source and mint themselves a hundred billion
--  LootCoins. The mapping below is the same one in js/redeem.js; the VOIDMAW
--  block keeps its plaintext because those ten were issued individually and
--  knowing WHICH one a player used is the whole point.
--
--  Keep this in sync with the HASH table in js/redeem.js. A hash missing here
--  reports as 'unknown:<first 12 chars>' rather than vanishing — an unrecognised
--  redemption is exactly the thing an operator would want to see.
-- =============================================================================

create or replace view public.v_coupon_map as
select * from (values
  ('4c487efee2ea903a6a55f550e94b232a943708517c627ee1ae0da3078a9dbc68','unlimited','UNLIMITED MODE'),
  ('e5b4c8f25f7b5121822fd78ca61a32cb99cd7c38b20ed7b5cdd84157a2e6c181','allships','FULL FLEET'),
  ('0ac9de52441b339d974eb6a02e843bad7f73dedcf2e9563e85b1224a251bb79f','cur100b','100B LOOTCOINS'),
  ('8e08f5932bc7975eae569865dfb6391a947cc151937b2e913f90ced22fb501bc','lvl100','+100 LEVELS'),
  ('b73594a53866f757d1d2db0f96c26a7b7a27f7d92a3337a319d7e21c60cab6e2','lvl200','+200 LEVELS'),
  ('ad4e3bef125286ba6feca86a07a3e7b700829d5e24cf29791dbeaca062c1b190','lvl500','+500 LEVELS'),
  ('29a76145a8bfe2b0721812e86c8db05d745b4b75a325c775b7334bf3994a65f4','pro365','PRO 365 DAYS'),
  ('f542c4091a26248648e7b83928c99e86dc9cc9f7c888262830a6a165f471202e','pro30','PRO 30 DAYS'),
  ('f839bbc7dfcbf2b2f1a84aa8895d93d9e182a527770516284d5eabb7dfdd81bd','discord1k','DISCORD 1,000 CREDITS'),
  ('7f96669af9a455f4146ef636eb98acc7ce439bb6d35496438a62c60a83c6920d','tourbeta','TOUR OF DUTY BETA'),
  -- Voidmaw make-good, ten single-use codes, Aug 2026
  ('9ff2504a7fc15161327c39e288114d3ad050badd03c5f43ba4856aeab1bbe07d','voidmaw','VOIDMAW-LHXU-V9LE'),
  ('7bbf1ecf605cd6cc7d1bbeb6dc4b48fbe3ecfc76661684f0bee329749ba86555','voidmaw','VOIDMAW-KASK-9YKR'),
  ('da1c04fa06c0616f7d8a66f95b9df791d0fc2e5f3bc96e4c430ba4db2177a67a','voidmaw','VOIDMAW-CTPE-RGQ5'),
  ('f8acb1c9057d2f38fa843cb3eba80494ba00392178a544113e027709c18adfa9','voidmaw','VOIDMAW-N95V-TGHW'),
  ('38c15cc47b8411eb0d90c86312049c0d3ec279055be48dc1f0a61b5cf9d2e984','voidmaw','VOIDMAW-7WPN-96V2'),
  ('3c90b668569b3122870e306a6150641b61d42528ae7cf0064f916960622d0c5f','voidmaw','VOIDMAW-7RVB-UNLS'),
  ('707d1def31f6780741a6a3bdf5d7d62cb9a8464ddcd396d28eb6ed6d38a13719','voidmaw','VOIDMAW-GMYJ-B3GG'),
  ('8943651a20c271de77ab19456dfaec5bf8c2ae3ed210708c7bd3973081d37cb2','voidmaw','VOIDMAW-GBUL-HY6G'),
  ('bfc2480f4b2c6820edecde10310a5c54670a6deadfe8d96c429370ae3cded934','voidmaw','VOIDMAW-SHMV-LLVM'),
  ('94116824cb4b3cc82d3154d4da9995782132f21d5d04a623a73335d01ee51be4','voidmaw','VOIDMAW-24FT-S667'),
  -- legacy issues, plaintext lost, still honoured
  ('7154891c38981a593183a2bd5056954c602702768d17bc16db7f729c366c9c28','allships','FULL FLEET (legacy)'),
  ('c85be0226b8210972b976cd432ef2f7b930cc7744a61fc20c8a2e1b7049b3ea3','cur100b','100B LOOTCOINS (legacy)'),
  ('2fd29fc18b227d135d29f6c247219d1810ba0de399944a922e5e3dbd8503d9a6','lvl100','+100 LEVELS (legacy)'),
  ('8b969257b1fb6a41faf97cdd280775d99eaf7351afa8f0d6a1854f3147a9a754','lvl200','+200 LEVELS (legacy)'),
  ('5783c02670fb4fca70cffa0eb9715832ac4f12e440bff0aff315afbd6ececd17','lvl500','+500 LEVELS (legacy)'),
  ('cd61d69bb4cc5ad93969432e5e51849f6160313d4c2ec8db6d52b6b0b05b71f6','pro365','PRO 365 DAYS (legacy)'),
  ('a0c0f10fa9b5bda29a15e70282be99200d802ca2de9c2cb7ba64d771542ced97','pro30','PRO 30 DAYS (legacy)')
) as t(hash, reward, label);

-- Every redemption, one row each.
--
-- THE TIMESTAMP IS THE CLIENT'S CLOCK. redeem.js stamps Date.now() at redemption
-- and the save carries it, so a device with a wrong clock records a wrong date.
-- It is reported as-is rather than discarded — an approximate date is far more
-- useful than none, and pretending otherwise would hide the wrong ones.
create or replace view public.v_coupon_redemptions as
select
  coalesce(nullif(btrim(s.data->>'pilotName'), ''),
           nullif(btrim(s.data->>'name'), ''), 'Operator')      as pilot,
  s.user_id,
  u.email,
  coalesce(m.label, 'unknown:' || left(r.key, 12))               as code,
  coalesce(m.reward, 'unknown')                                  as reward,
  to_timestamp((r.value #>> '{}')::bigint / 1000.0)              as redeemed_at,
  coalesce((s.data->>'level')::int, 1)                           as level
from public.saves s
join auth.users u on u.id = s.user_id
cross join lateral jsonb_each(coalesce(s.data->'redeemedCodes', '{}'::jsonb)) as r(key, value)
left join public.v_coupon_map m on m.hash = r.key;

-- ---------------------------------------------------------------------------
-- USE IT — uncomment whichever you want
-- ---------------------------------------------------------------------------

-- 1 · Everything, newest first
select pilot, email, code, reward, redeemed_at, level
  from public.v_coupon_redemptions
 order by redeemed_at desc;

-- 2 · How many times each code has been used
-- select code, reward, count(*) as uses,
--        min(redeemed_at) as first_used, max(redeemed_at) as last_used
--   from public.v_coupon_redemptions group by 1,2 order by uses desc;

-- 3 · Which of the ten Voidmaw codes are spent, and by whom (unspent = null)
-- select m.label, r.pilot, r.email, r.redeemed_at
--   from public.v_coupon_map m
--   left join public.v_coupon_redemptions r on r.code = m.label
--  where m.reward = 'voidmaw' order by m.label;

-- 4 · Accounts holding the heavy entitlements
-- select pilot, email, code, redeemed_at, level
--   from public.v_coupon_redemptions
--  where reward in ('unlimited','cur100b','allships','lvl500','pro365')
--  order by reward, redeemed_at;

-- 5 · One pilot's full history
-- select code, reward, redeemed_at from public.v_coupon_redemptions
--  where pilot ilike '%frost%' order by redeemed_at;

-- 6 · Redemptions of a code we do not recognise — normally empty. A row here
--     means either a hash was retired from js/redeem.js without being added to
--     the map above, or something wrote a key nothing issued.
-- select * from public.v_coupon_redemptions where reward = 'unknown';
