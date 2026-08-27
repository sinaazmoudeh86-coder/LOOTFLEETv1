-- =============================================================================
--  home-towers.sql — ALCYONE'S HOME CITADEL: EVERY PAD, EVERY LEVEL  (READ-ONLY)
-- -----------------------------------------------------------------------------
--  Paste and run. One statement, no edits needed. Returns one row per tower pad
--  plus one summary row per structure.
--
--  WHAT THE COLUMNS MEAN (js/home-citadel.js):
--    level             the pad's current level
--    max_allowed       twMaxLv = 10 + citadel_level x 10 — and `cit` has NO CAP,
--                      so every Citadel ascension raises every pad's ceiling by 10
--    dps_share         that tower's damage as a MULTIPLE of his own fleet DPS:
--                        laser   0.12/lv sustained
--                        cryo    0.03/lv per tick, up to 10 targets at once (+42% slow)
--                        missile 0.55/lv per salvo / 2.8s
--                        rail    1.60/lv per shot / 4.5s, PIERCING the whole line
--                      Rail's printed share is per target — against a lined-up
--                      raid it lands on up to 40 of them at once, so its real
--                      contribution is that figure times the line.
--    recorded_spend    `tw.sp`, what was actually paid for the pad
--
--  Wave cost for reference: a wave is 55 + 4.5 x wave SECONDS of fleet-only fire
--  (his DPS cancels out of the HP formula), so wave 425 is ~1,967s nominal. Total
--  dps_share is the divisor on that. If it sums past ~200 he is clearing 425 in
--  single-digit seconds.
-- =============================================================================

with s as (
  select data
  from public.saves
  where user_id = 'b85758be-8f1f-4341-8334-65c1c2f8aa60'::uuid
  -- or, by name:
  -- where data->>'pilotName' ilike '%alcyone%' or data->>'name' ilike '%alcyone%'
),
hc as (
  select
    (case when jsonb_typeof(data->'homecit'->'wave') = 'number' then (data->'homecit'->'wave') #>>'{}' else '0' end)::numeric as wave,
    (case when jsonb_typeof(data->'homecit'->'cit')  = 'number' then (data->'homecit'->'cit')  #>>'{}' else '0' end)::numeric as cit_lv,
    coalesce(data->'homecit'->'b',  '{}'::jsonb) as b,
    coalesce(data->'homecit'->'tw', '[]'::jsonb) as tw,
    coalesce(nullif(data->>'gameSpeed', ''), '1') as speed
  from s
),
pads as (
  select t.ord as pad,
         coalesce(t.value->>'k', '— empty pad —') as tower,
         case when t.value->>'lv' ~ '^[0-9]+$' then (t.value->>'lv')::numeric else 0 end as lv,
         left(coalesce(t.value->'sp', 'null'::jsonb)::text, 140) as paid
  from hc, lateral jsonb_array_elements(hc.tw) with ordinality t(value, ord)
)
select
  'pad ' || p.pad                                              as slot,
  p.tower,
  p.lv::text                                                   as level,
  (10 + h.cit_lv * 10)::text                                   as max_allowed,
  round(case p.tower when 'laser'   then 0.12 * p.lv
                     when 'cryo'    then 0.03 * p.lv
                     when 'missile' then 0.55 / 2.8 * p.lv
                     when 'rail'    then 1.60 / 4.5 * p.lv
                     else 0 end, 2)::text                       as dps_share,
  p.paid                                                        as recorded_spend
from pads p, hc h
union all
select 'TOTAL', 'all pads',
       (select count(*)::text from pads where tower <> '— empty pad —') || ' / 8 built',
       'top level ' || (select coalesce(max(lv), 0)::text from pads),
       (select round(coalesce(sum(case tower when 'laser'   then 0.12 * lv
                                             when 'cryo'    then 0.03 * lv
                                             when 'missile' then 0.55 / 2.8 * lv
                                             when 'rail'    then 1.60 / 4.5 * lv
                                             else 0 end), 0), 1)::text from pads)
       || 'x fleet DPS (rail counted per target — multiply by the line)',
       'wave ' || h.wave || ' costs ' || round(55 + 4.5 * h.wave) || 's of fleet-only fire'
from hc h
union all
select 'STRUCTURES', 'mine / silo / turret / repair',
       coalesce(h.b->>'mine', '0') || ' / ' || coalesce(h.b->>'silo', '0') || ' / ' ||
       coalesce(h.b->>'turret', '0') || ' / ' || coalesce(h.b->>'repair', '0'),
       'citadel lv ' || h.cit_lv,
       'Defense Grid adds ' || round(coalesce(nullif(h.b->>'turret', ''), '0')::numeric * 8) || '% of fleet DPS as turret fire',
       'battle speed ' || h.speed || 'x'
from hc h
order by slot;
