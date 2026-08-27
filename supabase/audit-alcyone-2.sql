-- =============================================================================
--  audit-alcyone-2.sql — SECOND PASS                              (READ-ONLY)
-- -----------------------------------------------------------------------------
--  Round 1 ruled out every grant path: no coupon has ever been redeemed on the
--  account (0 marks), no unlimited flag, no int32 wrap, one sku (speed4lc), no
--  Pro, no KOTH clamps, and gear that only looks wrong because my level test was
--  wrong (`ilvl` is a power figure, and the items carry `dungeon: 374` against a
--  frontier of 450 — that is his own ground).
--
--  What the first pass DID surface, and what these queries are aimed at:
--
--    1,502 PILOT TREE NODES with 0 CORES HELD AND AN EMPTY `dreadLock`.
--    Nodes cost 1 core (3 for a legendary, ~7% of ring 3+), so the tree is
--    ~1,600-1,700 Dread Cores spent. The hunt pays about one core per tier per
--    WEEK and he has been signed up for 13 days.
--
--    659 QUARANTINED COPIES, EVERY ONE `concurrent-session`, AND 46,709 SAVE
--    REVISIONS — a push every 25 seconds for 13 days straight. At 12:59 today
--    four copies landed inside one minute with four different gold figures, and
--    at 13:01-13:02 four more with IDENTICAL kills (5,120,084) but cores moving
--    0 → 5 → 12. Identical kills means one timeline forked; cores moving without
--    kills means the forks were spending independently.
--
--  Two candidate faucets, and these queries separate them:
--
--  A · GOLD BUYS HUNT ATTEMPTS. `buyRespawn()` deletes `dreadLock[t]` for
--      `100e6 * 1000^n` gold, where n is that tier's own respawn count. The
--      FIRST respawn of every tier costs 100M — 0.0006% of his wallet — so the
--      one-attempt-per-week rule does not bind him at all, and the 1000x curve
--      only bites at the third rung. `dreadRespawn` was not in ASC_KEEP before
--      712, so each of his 6 ascensions reset n back to zero and re-opened the
--      cheap rung on every tier.
--
--  B · THE PILOT-TREE UNION PAYS TWICE. mergeSaves() max-unions
--      `pilot.nodes` while `dreadCores` is deliberately NOT unioned (a wallet
--      follows the base pick). Two clients spending the same 13 cores into
--      DIFFERENT nodes therefore merge to both node sets on one wallet. The code
--      comment allows this on purpose as "bounded, one-time, non-repeating" —
--      which is true at one conflict and false at 659.
--
--  If B is live, the proof is two copies in the same minute with the same kills
--  and DIFFERENT node signatures. QUERY A prints exactly that.
--
--  Still read-only. Nothing here writes, and nothing here should be "cleaned up"
--  afterwards: save_conflicts is the only record of what happened.
-- =============================================================================

-- pilot: Alcyone · b85758be-8f1f-4341-8334-65c1c2f8aa60


-- =============================================================================
--  QUERY A — THE PROOF SET
--  Every quarantined copy plus the live save, oldest first: cores held, tree
--  size, a signature of WHICH nodes, spent respawns, gold, kills.
--
--  READ IT LIKE THIS:
--    · same minute + same kills + DIFFERENT nodes_sig  → forked spending; the
--      union kept both sets. That is faucet B, and the row count is the scale.
--    · nodes_n climbing while cores never rises        → nodes arriving without
--                                                        a wallet to buy them.
--    · respawns_bought climbing                        → faucet A, gold → cores.
-- =============================================================================
with copies as (
  select sc.created_at, sc.reason, sc.weight, sc.data
  from public.save_conflicts sc
  where sc.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
  union all
  select s.updated_at, 'LIVE SAVE', null::double precision, s.data
  from public.saves s
  where s.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
)
select
  to_char(c.created_at, 'MM-DD HH24:MI:SS') as at_utc,
  c.reason,
  (case when jsonb_typeof(c.data->'dreadCores') = 'number' then (c.data->'dreadCores') #>>'{}' else '0' end)::numeric as cores,
  (select count(*) from jsonb_object_keys(case when jsonb_typeof(c.data->'pilot'->'nodes') = 'object' then c.data->'pilot'->'nodes' else '{}'::jsonb end)) as nodes_n,
  left(md5((select coalesce(string_agg(k, ',' order by k), '')
            from jsonb_object_keys(case when jsonb_typeof(c.data->'pilot'->'nodes') = 'object' then c.data->'pilot'->'nodes' else '{}'::jsonb end) k)), 8) as nodes_sig,
  (select coalesce(sum(case when q.value #>>'{}' ~ '^[0-9]+$' then (q.value #>>'{}')::numeric else 0 end), 0)
     from jsonb_each(case when jsonb_typeof(c.data->'dreadRespawn'->'n') = 'object' then c.data->'dreadRespawn'->'n' else '{}'::jsonb end) q) as respawns_bought,
  (select count(*) from jsonb_object_keys(case when jsonb_typeof(c.data->'dreadLock') = 'object' then c.data->'dreadLock' else '{}'::jsonb end)) as tier_locks,
  round((case when jsonb_typeof(c.data->'gold') = 'number' then (c.data->'gold') #>>'{}' else '0' end)::numeric / 1e9) as gold_bn,
  (case when jsonb_typeof(c.data->'totalKills') = 'number' then (c.data->'totalKills') #>>'{}' else '0' end)::numeric as kills,
  (case when jsonb_typeof(c.data->'level') = 'number' then (c.data->'level') #>>'{}' else '0' end)::numeric as lv,
  round(c.weight) as merge_weight
from copies c
order by c.created_at;


-- =============================================================================
--  QUERY B — HOW MANY CLIENTS, AND WHEN
--  One row per minute that produced a quarantine. `copies` is how many losing
--  timelines that single minute threw away; anything above 1 is more than two
--  clients writing at once.
-- =============================================================================
select
  date_trunc('minute', created_at) as minute_utc,
  count(*)                         as copies,
  count(distinct (case when jsonb_typeof(data->'totalKills') = 'number' then (data->'totalKills') #>>'{}' else '0' end)) as distinct_kill_counts,
  min(round((case when jsonb_typeof(data->'gold') = 'number' then (data->'gold') #>>'{}' else '0' end)::numeric / 1e9)) as gold_bn_lo,
  max(round((case when jsonb_typeof(data->'gold') = 'number' then (data->'gold') #>>'{}' else '0' end)::numeric / 1e9)) as gold_bn_hi
from public.save_conflicts
where user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
group by 1
having count(*) > 1
order by copies desc, minute_utc desc
limit 60;


-- =============================================================================
--  QUERY C — THE SUBTREES ROUND 1 DID NOT PRINT
--  `mergeLog` is the client's own record of merge decisions — if it logs what it
--  unioned, it is a first-hand account of faucet B. The rest price the passive
--  economy honestly: 51 tiles and 41 citadels at up to x1000 accrual is a real
--  faucet, and I want it quantified before calling anything an exploit.
-- =============================================================================
select k as subtree, left(v::text, 1400) as value
from public.saves s,
     lateral (values
       ('mergeLog',      s.data->'mergeLog'),
       ('dreadRespawn',  s.data->'dreadRespawn'),
       ('dreadLock',     s.data->'dreadLock'),
       ('pilot (minus nodes)', s.data->'pilot' - 'nodes'),
       ('citadels',      s.data->'citadels'),
       ('ownedSystems',  s.data->'ownedSystems'),
       ('lcMarket',      s.data->'lcMarket'),
       ('casino',        s.data->'casino'),
       ('koth',          s.data->'koth'),
       ('vipPts',        s.data->'vipPts'),
       ('secretSpeed',   s.data->'secretSpeed'),
       ('shop',          s.data->'shop'),
       ('forge',         s.data->'forge'),
       ('moon',          s.data->'moon'),
       ('tileFree',      s.data->'tileFree'),
       ('tileAband',     s.data->'tileAband'),
       ('achieve',       s.data->'achieve')
     ) as t(k, v)
where s.user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid;


-- =============================================================================
--  QUERY D — IS HE ALONE?
--  If a hole is open, he is not the only one in it, and that decides whether
--  this is a moderation question or a build-728 fix. Top accounts by tree size
--  and by quarantine count, side by side.
-- =============================================================================
with nodes as (
  select s.user_id,
         coalesce(nullif(btrim(s.data->>'pilotName'), ''), nullif(btrim(s.data->>'name'), ''), 'Operator') as pilot,
         (select count(*) from jsonb_object_keys(case when jsonb_typeof(s.data->'pilot'->'nodes') = 'object' then s.data->'pilot'->'nodes' else '{}'::jsonb end)) as nodes_n,
         (case when jsonb_typeof(s.data->'dreadCores') = 'number' then (s.data->'dreadCores') #>>'{}' else '0' end)::numeric as cores,
         (case when jsonb_typeof(s.data->'level') = 'number' then (s.data->'level') #>>'{}' else '0' end)::numeric as lv,
         (case when jsonb_typeof(s.data->'pasc'->'stars') = 'number' then (s.data->'pasc'->'stars') #>>'{}' else '0' end)::numeric as stars,
         round((case when jsonb_typeof(s.data->'gold') = 'number' then (s.data->'gold') #>>'{}' else '0' end)::numeric / 1e9) as gold_bn,
         s.updated_at
  from public.saves s
),
conf as (
  select user_id, count(*) as conflicts, max(created_at) as last_conflict
  from public.save_conflicts group by user_id
)
select n.pilot, n.nodes_n, n.cores, n.lv, n.stars, n.gold_bn,
       coalesce(c.conflicts, 0) as conflicts, c.last_conflict, n.user_id
from nodes n
left join conf c on c.user_id = n.user_id
where n.nodes_n > 100 or coalesce(c.conflicts, 0) > 50
order by n.nodes_n desc, conflicts desc
limit 40;


-- =============================================================================
--  QUERY E — WHAT HIS TERRITORY IS ACTUALLY WORTH
--  Server-side holdings, so the gold and resource rate can be priced from the
--  shared map rather than from his own save. 41 citadels at the x1000 rate
--  multiplier would explain trillions per day without a single exploit.
-- =============================================================================
select count(*)                                              as tiles,
       count(*) filter (where coalesce(citadel, false))       as citadels,
       max(coalesce(citadel_lv, 0))                           as best_citadel_rank,
       min(claimed_at)                                        as first_claim,
       max(coalesce(cooldown_until, claimed_at))              as latest_shield
from public.territory
where owner_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid;
