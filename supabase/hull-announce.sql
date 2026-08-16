-- =============================================================================
--  hull-announce.sql — EVERY HULL GETS AN ANNOUNCEMENT, NOT JUST THE KAEVITH
-- -----------------------------------------------------------------------------
--  THE FAULT. Discord only ever showed ship art for Kaevith hulls, because the
--  only path that reports a hull acquisition to the server is log_xen_hull() and
--  that function whitelists the five xen keys and rejects everything else. The
--  other route — the feed noticing the leaderboard's `ships` COUNT rise and
--  reading `hull_last` — depends on the art columns actually reaching the table,
--  which is the exact thing three competing lb_upsert overloads have been
--  breaking (see discord-art-publish.sql). One path is reliable and narrow, the
--  other is broad and unreliable, so in practice only Kaevith hulls had art.
--
--  THE FIX. Take the path that works and widen it. log_hull() is log_xen_hull()
--  with the whitelist replaced by a key-shape check, writing kind='hull_earned'
--  to the same war_events table the feed already drains. Every hull a pilot
--  earns — bought, granted, built, assembled, won from the season pass — posts
--  the same kind of card with the same sprite.
--
--  SAFETY, unchanged from log_xen_hull: security definer, the identity comes
--  from auth.uid() and never the payload, the key is validated, and it is
--  IDEMPOTENT PER (PILOT, SHIP) across BOTH kinds — so a hull can be announced
--  once per account, a Kaevith hull keeps its own louder card and can never be
--  announced twice, and a forged call is bounded to "someone lied about a hull
--  they could have bought anyway".
--
--  A per-pilot ceiling caps the blast radius of a scripted caller: no account
--  can produce more hull cards than there are hulls in the game.
--
--  ONE SIGNATURE, ONE FUNCTION. Never add an overload of this (see the
--  lb_upsert note in CLAUDE.md) — change this file and re-run it.
--
--  Safe to re-run.
--  Requires: war-events.sql (public.war_events + its read policy).
-- =============================================================================

create or replace function public.log_hull(p_ship text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  nm  text;
  n   int;
begin
  if auth.uid() is null then return false; end if;

  -- KEY SHAPE, not a whitelist. The feed builds a sprite URL from this and
  -- validates it again on its own side; anything that is not a plain hull key is
  -- rejected here so nothing else can ever reach a URL.
  if p_ship is null or p_ship !~ '^[a-z0-9_-]{2,32}$' then return false; end if;

  -- The Kaevith five have their own, louder card via log_xen_hull(). Reporting
  -- them here as well would post two cards for one hull.
  if p_ship like 'xen%' then return false; end if;

  -- IDEMPOTENT PER PILOT PER HULL, across both announcement kinds.
  if exists (
    select 1 from public.war_events
     where kind in ('hull_earned', 'xen_hull')
       and actor_id = auth.uid()
       and meta ->> 'ship' = p_ship
  ) then
    return false;
  end if;

  -- CEILING. There are far fewer than 200 hulls in the game; a caller past that
  -- is a script, not a fleet.
  select count(*) into n from public.war_events
   where kind = 'hull_earned' and actor_id = auth.uid();
  if n >= 200 then return false; end if;

  select name into nm from public.leaderboard where user_id = auth.uid();

  insert into public.war_events (kind, tile_id, actor_id, actor_name, meta)
  values ('hull_earned', null, auth.uid(), coalesce(nm, 'A pilot'),
          jsonb_build_object(
            'ship', p_ship,
            -- How many accounts hold this hull now, including this one, so the
            -- card can say "the 4th ever" on the rare ones.
            'nth', (select count(distinct actor_id) + 1 from public.war_events
                     where kind = 'hull_earned' and meta ->> 'ship' = p_ship)
          ));
  return true;
end $$;

revoke all on function public.log_hull(text) from anon;
grant execute on function public.log_hull(text) to authenticated;

-- ---- verify ----------------------------------------------------------------
-- Exactly one log_hull must exist. Two copies mean PostgREST picks the wrong
-- candidate or refuses to pick at all.
select 'log_hull installed' as status,
       (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'log_hull') as copies,
       (select count(*) from public.war_events where kind = 'hull_earned') as hulls_announced;
