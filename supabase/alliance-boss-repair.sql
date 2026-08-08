-- =============================================================================
--  REPAIR — HOLLOW ARMADA: "the alliance boss isn't counting damage"  (Aug 2026)
--  RUN ONCE against the live database. Safe to re-run.
--
--  WHAT WENT WRONG
--  Two files defined alliance_attack() and _al_boss_hp():
--
--    • alliance-boss-setladder.sql — the CURRENT design. Fixed hull per mark
--      (1e6 × 4^(mark-1)) and NO per-attack damage cap.
--    • social.sql — the omnibus. Still carried the OLD power-anchored bodies:
--      a 5e13 hull FLOOR and a per-attack clamp of `leaderboard power × 25`.
--
--  Whichever ran last won. Re-applying the omnibus reinstalled the old pair, so
--  the client (which spawns an arena boss whose hull literally IS boss_hp, and
--  transmits RAW combat damage) fought a 1e6-hull boss while the server held a
--  50-trillion-hull one and then clamped the incoming damage on top. Symptom:
--  "did 2 hits and health is still full."
--
--  social.sql has since been corrected in the project, so it can no longer
--  regress this. Running THIS file repairs a database that already drifted.
-- =============================================================================

-- ---- 1. the ladder ----------------------------------------------------------
drop function if exists public._al_boss_hp(uuid, int);
drop function if exists public._al_boss_hp(uuid, int, numeric);
create or replace function public._al_boss_hp(aid uuid, n int, anchor_min numeric default 0)
returns numeric language sql immutable set search_path = public as $$
  select 1e6::numeric * power(4.0::numeric, greatest(0, n - 1));
$$;

-- ---- 2. the attack, uncapped ------------------------------------------------
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

  -- NO CAP. Raw combat damage is the damage.
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
  -- REBASE any row still carrying a power-anchored boss_max, preserving the
  -- fraction already burned so nobody loses progress.
  if bmax is null or bmax <= 0 or bmax is distinct from public._al_boss_hp(aid, n) then
    hp := public._al_boss_hp(aid, n) * greatest(0.05, least(1,
            case when coalesce(bmax,0) > 0 then coalesce(hp,0) / bmax else 1 end));
    bmax := public._al_boss_hp(aid, n);
  end if;
  if hp is null or hp > bmax then hp := bmax; end if;

  -- ONE KILL PER ATTACK. Overkill is spent on the corpse.
  if dmg >= hp then
    kills := 1; n := n + 1;
    bmax := public._al_boss_hp(aid, n);
    hp := bmax;
  else
    hp := hp - dmg;
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

-- ---- 3. rebase every live alliance onto the ladder now ----------------------
-- Without this the page keeps showing the old 5e13-floor numbers until each
-- alliance's next attack self-heals it.
update public.alliances a
   set boss_max = public._al_boss_hp(a.id, greatest(1, coalesce(a.boss_n, 1))),
       boss_hp  = public._al_boss_hp(a.id, greatest(1, coalesce(a.boss_n, 1)))
                  * greatest(0.05, least(1, case when coalesce(a.boss_max, 0) > 0
                       then coalesce(a.boss_hp, 0) / a.boss_max else 1 end));

-- ---- 4. verify --------------------------------------------------------------
-- Expect Mk-1 = 1,000,000 and each mark ×4.
select n as mark, public._al_boss_hp(null::uuid, n) as hull
  from generate_series(1, 10) as n;
