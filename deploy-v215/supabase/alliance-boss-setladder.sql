-- =============================================================================
--  MIGRATION — HOLLOW ARMADA: FIXED HULL PER MARK, NO PER-RUN DAMAGE CAP
--  (Aug 2026) · RUN ONCE, safe to re-run. Supersedes alliance-boss-onekill.sql.
--
--  WHAT CHANGES AND WHY
--  The Armada used to anchor its hull to sum(member power) × 50 and clamp each
--  attack to your own power × 50. Two problems fell out of that:
--
--   1. The cap made the raid unreadable. Player report: "normal hits at 30T,
--      crits at 300-500T, transmitted damage 1.7T." Both numbers were right —
--      arena hits are RAW combat damage, the pool ran on compressed power
--      units, and the clamp sat on top. Three currencies, one word.
--   2. Because the hull scaled with the alliance's own power, getting stronger
--      made the boss stronger. The ladder never actually got harder, and it
--      never got easier either. There was no progression to feel.
--
--  NEW MODEL — the Armada is a fixed ladder:
--
--      hull(mark) = 1e6 × 4 ^ (mark - 1)
--
--   • NO per-attack cap. Your raw combat damage is the damage.
--   • Mk-1 is 1,000,000 hull. Anyone past roughly Zone 25 one-shots it.
--   • Every mark is ×4. That step is deliberately steep: real burst output
--     spans ~20 orders of magnitude across the playerbase, so a gentler ladder
--     is one-shot spam at every mark for a deep pilot. Measured against live
--     fleets: a Zone-100 pilot one-shots to ~Mk-9, a Zone-200 pilot to ~Mk-21.
--     Past that it takes the alliance, which is the point.
--   • ONE KILL PER ATTACK is unchanged. Overkill is spent on the corpse, the
--     kill ends the run early, and the attack is still consumed.
--   • Weekly reset still returns the ladder to Mk-1.
--
--  ⚠ SHIP WITH THE MATCHING CLIENT (js/alliance-boss.js + js/game-v93.js).
--    The client now makes the arena boss hull literally equal boss_hp and sends
--    raw damage. An old client sends power-unit damage and would barely scratch
--    the new ladder; a new client against the old SQL would be clamped to
--    nothing. Deploy both or neither.
-- =============================================================================

-- ---- the ladder -------------------------------------------------------------
-- Signature keeps the (uuid, int, numeric) shape so existing call sites are not
-- broken, but aid and anchor_min are now ignored: hull depends ONLY on the mark.
drop function if exists public._al_boss_hp(uuid, int);
drop function if exists public._al_boss_hp(uuid, int, numeric);
create or replace function public._al_boss_hp(aid uuid, n int, anchor_min numeric default 0)
returns numeric language sql immutable set search_path = public as $$
  select 1e6::numeric * power(4.0::numeric, greatest(0, n - 1));
$$;

drop function if exists public.alliance_attack(numeric, boolean);
drop function if exists public.alliance_attack(numeric, boolean, numeric);
create or replace function public.alliance_attack(p_dmg numeric, p_vip boolean, p_pow numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; maxa int; att int; dmg numeric; tot numeric;
        hp numeric; bmax numeric; n int; wk int; bw int;
        kills int := 0; coins bigint := 300; nm text;
begin
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'no alliance'; end if;
  update public.alliance_members set day_key = current_date, donated = false, attacks = 0
    where user_id = me and (day_key is distinct from current_date);
  maxa := case when coalesce(p_vip,false) then 3 else 2 end;
  select attacks into att from public.alliance_members where user_id = me;
  if att >= maxa then raise exception 'no attacks left today'; end if;

  -- NO CAP. Raw combat damage is the damage; the fixed ladder is what limits
  -- how far one pilot can carry the alliance.
  dmg := greatest(coalesce(p_dmg, 0), 0);
  tot := dmg;

  update public.alliance_members set attacks = attacks + 1, contrib = contrib + 5 where user_id = me;
  wk := public._al_bweek();
  select boss_hp, boss_max, boss_n, boss_week into hp, bmax, n, bw from public.alliances where id = aid for update;
  if bw is distinct from wk then
    n := 1; bmax := public._al_boss_hp(aid, 1); hp := bmax;
    perform public._al_feed(aid, 'sys', '⟳ WEEKLY RESET — the Hollow Armada returns at Mk-1');
  end if;
  n := greatest(1, coalesce(n, 1));
  -- REBASE onto the new ladder. Rows still carrying a power-anchored boss_max
  -- are converted at their current damage fraction, so nobody loses progress.
  if bmax is null or bmax <= 0 or bmax is distinct from public._al_boss_hp(aid, n) then
    hp := public._al_boss_hp(aid, n) * greatest(0.05, least(1,
            case when coalesce(bmax,0) > 0 then coalesce(hp,0) / bmax else 1 end));
    bmax := public._al_boss_hp(aid, n);
  end if;
  if hp is null or hp > bmax then hp := bmax; end if;

  -- ONE KILL PER ATTACK. Overkill is spent on the corpse — the next mark starts full.
  if dmg >= hp then
    kills := 1; n := n + 1;
    bmax := public._al_boss_hp(aid, n);
    hp := bmax;
  else
    hp := hp - dmg;                             -- bmax untouched, so the bar visibly drops
  end if;

  update public.alliances set boss_n = n, boss_hp = hp, boss_max = bmax,
    boss_week = wk, xp = xp + 200 * kills where id = aid;
  if kills > 0 then
    update public.social_wallets w set ac = ac + coins, updated_at = now()
      where w.user_id in (select user_id from public.alliance_members where alliance_id = aid);
    insert into public.social_wallets(user_id, ac)
      select m.user_id, coins from public.alliance_members m where m.alliance_id = aid
        and not exists (select 1 from public.social_wallets w2 where w2.user_id = m.user_id);
    select name into nm from public.leaderboard where user_id = me;
    perform public._al_feed(aid, 'sys', '☠ ARMADA Mk-' || (n - 1) || ' DESTROYED — final blow by '
      || coalesce(nm,'a pilot') || ' · +300 ⬡ to every member · now Mk-' || n);
  end if;
  return jsonb_build_object('dmg', tot, 'kills', kills, 'boss_n', n, 'boss_hp', hp, 'boss_max', bmax,
                            'coins', case when kills > 0 then coins else 0 end, 'killed', kills > 0);
end; $$;
grant execute on function public.alliance_attack(numeric, boolean, numeric) to authenticated;

-- ---- rebase every live alliance onto the ladder right now -------------------
-- (the function above also self-heals on the next attack; this makes the
--  alliance page show correct numbers immediately, before anyone attacks)
update public.alliances a
set boss_hp  = public._al_boss_hp(a.id, greatest(1, coalesce(a.boss_n, 1)))
               * greatest(0.05, least(1, case when coalesce(a.boss_max,0) > 0
                   then coalesce(a.boss_hp,0) / a.boss_max else 1 end)),
    boss_max = public._al_boss_hp(a.id, greatest(1, coalesce(a.boss_n, 1)))
where coalesce(a.boss_max, 0) is distinct from public._al_boss_hp(a.id, greatest(1, coalesce(a.boss_n, 1)));

-- ---- verify -----------------------------------------------------------------
-- The ladder, for reference:
--   select n, public._al_boss_hp(null, n) as hull from generate_series(1,60) n;
-- Live alliances after the rebase (boss_max must equal the ladder at boss_n):
--   select id, boss_n, boss_hp, boss_max, public._al_boss_hp(id, boss_n) as expect
--     from public.alliances order by boss_n desc limit 20;
