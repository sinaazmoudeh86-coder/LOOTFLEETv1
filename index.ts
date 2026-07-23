-- =============================================================================
--  MIGRATION — HOLLOW ARMADA BALANCE (Jul 2026) · RUN ONCE, safe to re-run
--  FrostySkull cleared two boss levels in three hits: the boss HP anchored to
--  sum(alliance power) × 25, but each attack is clamped to myPower × 25 — so a
--  solo/small alliance one-shots every level. Worse, when a member's
--  leaderboard power was stale (pre-bignum overflow) the sum collapsed to the
--  5e13 floor while real transmitted damage was ~1000× that.
--
--  FIX:
--   • anchor ×25 → ×200  (one MAX attack ≈ 1/8 of Mk-1 — a real group grind)
--   • self-heal: alliance_attack takes the attacker's LIVE power (p_pow) and
--     raises (never lowers) the pool anchor, so a stale leaderboard sum can't
--     trivialise the boss. The damage clamp still uses server power only.
--  Run leaderboard-bignum.sql first so member powers store correctly.
-- =============================================================================

drop function if exists public._al_boss_hp(uuid, int);
create or replace function public._al_boss_hp(aid uuid, n int, anchor_min numeric default 0)
returns numeric language sql security definer set search_path = public as $$
  select greatest(5e13,
    greatest(
      coalesce((select sum(l.power)::numeric from public.alliance_members m
        join public.leaderboard l on l.user_id = m.user_id where m.alliance_id = aid), 0),
      greatest(coalesce(anchor_min, 0), 0)
    ) * 200)
    * power(1.55::numeric, greatest(0, n - 1));
$$;

drop function if exists public.alliance_attack(numeric, boolean);
create or replace function public.alliance_attack(p_dmg numeric, p_vip boolean, p_pow numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; maxa int; att int; pw numeric; dmg numeric; tot numeric;
        hp numeric; bmax numeric; cmax numeric; anch numeric; n int; wk int; bw int; kills int := 0; coins bigint := 0; nm text;
begin
  select alliance_id into aid from public.alliance_members where user_id = me;
  if aid is null then raise exception 'no alliance'; end if;
  update public.alliance_members set day_key = current_date, donated = false, attacks = 0
    where user_id = me and (day_key is distinct from current_date);
  maxa := case when coalesce(p_vip,false) then 3 else 2 end;
  select attacks into att from public.alliance_members where user_id = me;
  if att >= maxa then raise exception 'no attacks left today'; end if;
  select coalesce(power,0)::numeric into pw from public.leaderboard where user_id = me;
  dmg := least(greatest(coalesce(p_dmg,0), 0), greatest(pw, 1) * 25);   -- clamp: SERVER power only
  tot := dmg;
  anch := greatest(coalesce(pw,0), coalesce(p_pow,0));                  -- raises the pool anchor, never the clamp
  update public.alliance_members set attacks = attacks + 1, contrib = contrib + 5 where user_id = me;
  wk := public._al_bweek();
  select boss_hp, boss_max, boss_n, boss_week into hp, bmax, n, bw from public.alliances where id = aid for update;
  if bw is distinct from wk then
    n := 1; hp := public._al_boss_hp(aid, 1, anch); bmax := hp;
    perform public._al_feed(aid, 'sys', '⟳ WEEKLY RESET — the Hollow Armada returns at Mk-1');
  end if;
  cmax := public._al_boss_hp(aid, n, anch);                            -- self-heal a stale pool, preserve % done
  if bmax is null or bmax <= 0 then bmax := cmax; hp := cmax; end if;
  if cmax > bmax * 4 then
    hp := cmax * least(1, greatest(0, hp / bmax));
    bmax := cmax;
  end if;
  while dmg >= hp loop
    dmg := dmg - hp;
    coins := coins + 250 + 50 * n;
    kills := kills + 1; n := n + 1;
    hp := public._al_boss_hp(aid, n, anch);
    exit when kills >= 200;
  end loop;
  hp := hp - dmg;
  update public.alliances set boss_n = n, boss_hp = hp, boss_max = public._al_boss_hp(aid, n, anch),
    boss_week = wk, xp = xp + 200 * kills where id = aid;
  if kills > 0 then
    update public.social_wallets w set ac = ac + coins, updated_at = now()
      where w.user_id in (select user_id from public.alliance_members where alliance_id = aid);
    insert into public.social_wallets(user_id, ac)
      select m.user_id, coins from public.alliance_members m where m.alliance_id = aid
        and not exists (select 1 from public.social_wallets w2 where w2.user_id = m.user_id);
    select name into nm from public.leaderboard where user_id = me;
    perform public._al_feed(aid, 'sys', '☠ ' || kills || ' ARMADA LEVEL' || case when kills > 1 then 'S' else '' end
      || ' DOWN — final blows by ' || coalesce(nm,'a pilot') || ' · +' || coins || ' ⬡ to every member · now Mk-' || n);
  end if;
  return jsonb_build_object('dmg', tot, 'kills', kills, 'boss_n', n, 'killed', kills > 0);
end; $$;
grant execute on function public.alliance_attack(numeric, boolean, numeric) to authenticated;
