-- =============================================================================
--  xen-hull.sql — THE KAEVITH INCURSION · earned-hull announcements
-- -----------------------------------------------------------------------------
--  Earning a Kaevith hull is the rarest thing a pilot can do in My Galaxy (1–10%
--  per invaded-zone clear, five hulls in the game), so it gets a loud Discord
--  announcement. The grant happens client-side — it has to, the roll is part of
--  the battle resolution — which means the client must REPORT it, and a reported
--  achievement is forgeable from devtools.
--
--  This RPC is the same shape as log_repelled(): security definer, the caller's
--  identity comes from auth.uid() and never from the payload, the ship key is
--  validated against a fixed list, and it is idempotent per (pilot, hull) —
--  each of the five can only ever be announced ONCE per account, so a replayed
--  or scripted call posts nothing. That bounds the damage of a forged call to
--  "someone lied about a hull they could have earned anyway", and makes the
--  channel safe from repeat spam.
--
--  Safe to re-run.
--  Requires: war-events.sql (public.war_events + its read policy).
-- =============================================================================

-- The five recovered hulls, entry → Dreadnaught. Must match SHIPS in
-- js/config-v2.js; anything else is rejected outright.
create or replace function public.log_xen_hull(
  p_ship    text,
  p_tile_id text default null,
  p_ring    int  default null,
  p_pity    boolean default false
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  nm    text;
  label text;
  xp    int;
begin
  if auth.uid() is null then return false; end if;

  -- Whitelist + display metadata. Keeping the pretty name and XP figure here
  -- means the feed never has to trust client-supplied copy.
  select * into label, xp from (
    select case p_ship
      when 'xen1' then 'Kaevith Splinter'
      when 'xen2' then 'Kaevith Shard'
      when 'xen3' then 'Kaevith Glaive'
      when 'xen4' then 'Kaevith Sovereign'
      when 'xen5' then 'Kaevith Godshard'
    end,
    case p_ship
      when 'xen1' then 10 when 'xen2' then 25 when 'xen3' then 45
      when 'xen4' then 70 when 'xen5' then 100
    end
  ) q;
  if label is null then return false; end if;

  -- IDEMPOTENT PER PILOT PER HULL — you can only earn each hull once, so a
  -- second report for the same pair is a replay and is dropped silently.
  if exists (
    select 1 from public.war_events
     where kind = 'xen_hull' and actor_id = auth.uid()
       and meta ->> 'ship' = p_ship
  ) then
    return false;
  end if;

  select name into nm from public.leaderboard where user_id = auth.uid();

  insert into public.war_events (kind, tile_id, actor_id, actor_name, meta)
  values ('xen_hull', p_tile_id, auth.uid(), coalesce(nm, 'A pilot'),
          jsonb_build_object(
            'ship',  p_ship,
            'label', label,
            'xp',    xp,
            'ring',  greatest(0, coalesce(p_ring, 0)),
            'pity',  coalesce(p_pity, false),
            -- How many accounts hold this hull now, including this one. Turns
            -- the announcement into a scarcity statement ("the 3rd ever").
            'nth',  (select count(distinct actor_id) + 1 from public.war_events
                      where kind = 'xen_hull' and meta ->> 'ship' = p_ship)
          ));
  return true;
end $$;

revoke all on function public.log_xen_hull(text, text, int, boolean) from anon;
grant execute on function public.log_xen_hull(text, text, int, boolean) to authenticated;

-- ---- verify ----------------------------------------------------------------
select 'log_xen_hull installed' as status,
       count(*) filter (where kind = 'xen_hull') as hulls_announced
  from public.war_events;
