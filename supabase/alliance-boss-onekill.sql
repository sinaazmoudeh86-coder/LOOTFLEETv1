-- =============================================================================
--  MIGRATION — HOLLOW ARMADA: ONE BOSS AT A TIME, KILLS ACTUALLY PAY
--  (Jul 2026) · RUN ONCE, safe to re-run. Supersedes alliance-boss-balance.sql.
--
--  BUGS THIS FIXES (player report: "got to Mk-10, got nothing"):
--   1. STAGES. The client invented Mk-2, Mk-3 … locally because its damage
--      normalization guaranteed 2.4× the pool per run. The server never agreed,
--      so coming back showed Mk-1 again. The Armada is ONE boss per attack:
--      the client no longer advances marks at all, and this function kills AT
--      MOST ONE level per attack (leftover damage is discarded, not chained).
--   2. NO PAYOUT. The pool anchored at sum(power) × 200 while a single attack
--      was clamped to power × 25 — mathematically 8+ maxed attacks per level, so
--      a normal alliance never saw a kill and never saw ⬡. Anchor and clamp now
--      BOTH use × 50 (= ALBOSS MAX_XMIT), so one full 2:30 run at your own
--      power flattens Mk-1, and each mark after is ×1.55 harder.
--   3. HP BAR NEVER MOVED. Every attack rewrote boss_max from the LIVE power
--      anchor while boss_hp was subtracted from the OLD max — so hp/boss_max
--      stayed pinned near full. boss_max is now only ever re-anchored on a KILL
--      or the weekly reset; a mid-ladder attack subtracts from the stored pool
--      and leaves the denominator alone.
--   4. Kills pay a FLAT ⬡ 300 to every member (was 250 + 50·mark, which never
--      matched the UI copy).
-- =============================================================================

drop function if exists public._al_boss_hp(uuid, int);
drop function if exists public._al_boss_hp(uuid, int, numeric);
create or replace function public._al_boss_hp(aid uuid, n int, anchor_min numeric default 0)
returns numeric language sql security definer set search_path = public as $$
  select greatest(5e13,
    greatest(
      coalesce((select sum(l.power)::numeric from public.alliance_members m
        join public.leaderboard l on l.user_id = m.user_id where m.alliance_id = aid), 0),
      greatest(coalesce(anchor_min, 0), 0)
    ) * 50)                                    -- MUST match ALBOSS MAX_XMIT
    * power(1.55::numeric, greatest(0, n - 1));
$$;

drop function if exists public.alliance_attack(numeric, boolean);
drop function if exists public.alliance_attack(numeric, boolean, numeric);
create or replace function public.alliance_attack(p_dmg numeric, p_vip boolean, p_pow numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; maxa int; att int; pw numeric; dmg numeric; tot numeric;
        hp numeric; bmax numeric; anch numeric; n int; wk int; bw int;
        kills int := 0; coins bigint := 300; nm text;
begin
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'no alliance'; end if;
  update public.alliance_members set day_key = current_date, donated = false, attacks = 0
    where user_id = me and (day_key is distinct from current_date);
  maxa := case when coalesce(p_vip,false) then 3 else 2 end;
  select attacks into att from public.alliance_members where user_id = me;
  if att >= maxa then raise exception 'no attacks left today'; end if;
  select coalesce(power,0)::numeric into pw from public.leaderboard where user_id = me;
  anch := greatest(coalesce(pw,0), coalesce(p_pow,0));   -- live power: anchors a fresh pool, never the clamp
  -- clamp uses the SAME multiplier the client normalizes to, so the ⚔ meter the
  -- player watched fill is what actually lands on the shared hull
  dmg := least(greatest(coalesce(p_dmg,0), 0), greatest(pw, 1) * 50);
  tot := dmg;
  update public.alliance_members set attacks = attacks + 1, contrib = contrib + 5 where user_id = me;
  wk := public._al_bweek();
  select boss_hp, boss_max, boss_n, boss_week into hp, bmax, n, bw from public.alliances where id = aid for update;
  if bw is distinct from wk then
    n := 1; bmax := public._al_boss_hp(aid, 1, anch); hp := bmax;
    perform public._al_feed(aid, 'sys', '⟳ WEEKLY RESET — the Hollow Armada returns at Mk-1');
  end if;
  if bmax is null or bmax <= 0 then bmax := public._al_boss_hp(aid, n, anch); hp := bmax; end if;
  if hp is null or hp > bmax then hp := bmax; end if;
  -- ONE KILL PER ATTACK. Overkill is spent on the corpse — the next mark starts full.
  if dmg >= hp then
    kills := 1; n := n + 1;
    bmax := public._al_boss_hp(aid, n, anch);   -- re-anchor ONLY on a kill
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
