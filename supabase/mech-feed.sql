-- =============================================================================
--  mech-feed.sql — THE MECH FOUNDRY'S DISCORD ANNOUNCEMENTS
--  ---------------------------------------------------------------------------
--  One RPC, log_mech(), writing to the same public.war_events table the feed
--  already drains every two minutes. No new table, no new drain, no change to
--  the Edge Function's collectors — the four kinds it can write are registered
--  in discord-feed/catalog.ts and all carry selfPost: true, meaning the CLIENT
--  detects them at the moment they happen and posts the row itself.
--
--  WHY THE CLIENT AND NOT A COLLECTOR. A world clear is not visible in any table
--  a collector could poll: the Foundry keeps no server-side run record, and
--  adding one purely so a bot could notice it would be a save-shape change in
--  service of a Discord card. The client already knows, exactly when it happens.
--
--  WHAT IT CANNOT DO. It cannot announce a window OPENING. Those are a pure
--  function of the clock — five worlds on staggered one-hour windows, twenty
--  openings a day — and a channel that says "Korrus is open" twenty times a day
--  is a channel people mute. The schedule is shown in the game, on the orbit.
--
--  Safe to re-run. Requires: war-events.sql (public.war_events + read policy).
-- =============================================================================

create or replace function public.log_mech(p_kind text, p_meta jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text;
  n  int;
  w  text;
begin
  if auth.uid() is null then return false; end if;

  -- WHITELIST THE KINDS. An RPC the client can call with an arbitrary string is
  -- an arbitrary-content channel post; the registry in catalog.ts is the only
  -- set of things the Foundry is allowed to say.
  if p_kind not in ('mechWorld', 'mechDeep', 'mechCore', 'mechSov', 'mechCmdr') then
    return false;
  end if;

  w := coalesce(p_meta ->> 'world', '');

  -- ONE CARD PER PILOT PER WORLD PER HOUR. A world can be assaulted repeatedly
  -- inside its own window, and each clear is a real event — but the channel does
  -- not need every one of them. The window itself is an hour, so this is
  -- effectively one card per pilot per window, which is the honest cadence.
  if p_kind in ('mechWorld', 'mechDeep') then
    if exists (
      select 1 from public.war_events
       where kind = p_kind
         and actor_id = auth.uid()
         and coalesce(meta ->> 'world', '') = w
         and created_at > now() - interval '1 hour'
    ) then
      return false;
    end if;
  end if;

  -- A COMMANDER PULL IS ONE CARD PER PILOT PER OFFICER PER TIER. Announced only
  -- for Ancient and above (the client gates that), and de-duplicated here so a
  -- replayed settlement or a reinstall cannot post the same chase card twice.
  if p_kind = 'mechCmdr' then
    if exists (
      select 1 from public.war_events
       where kind = 'mechCmdr'
         and actor_id = auth.uid()
         and coalesce(meta ->> 'cmdr', '') = coalesce(p_meta ->> 'cmdr', '')
         and coalesce(meta ->> 'tier', '') = coalesce(p_meta ->> 'tier', '')
    ) then
      return false;
    end if;
  end if;

  -- A MILESTONE FIRES ONCE, EVER. The client only calls on the crossing, but a
  -- reinstall, a merge or a replayed settlement must not re-announce it.
  if p_kind = 'mechCore' then
    if exists (
      select 1 from public.war_events
       where kind = 'mechCore'
         and actor_id = auth.uid()
         and coalesce(meta ->> 'mark', '') = coalesce(p_meta ->> 'mark', '')
    ) then
      return false;
    end if;
  end if;

  -- THE SOVEREIGN IS ONCE PER ACCOUNT. It needs every other Mech hull first, so
  -- a second one is not possible in the game — this guards a replay, not a rebuy.
  if p_kind = 'mechSov' then
    if exists (
      select 1 from public.war_events
       where kind = 'mechSov' and actor_id = auth.uid()
    ) then
      return false;
    end if;
  end if;

  -- CEILING. There are five worlds on four windows a day; a caller past this is
  -- a script, not a pilot.
  select count(*) into n from public.war_events
   where actor_id = auth.uid()
     and kind in ('mechWorld', 'mechDeep', 'mechCore', 'mechSov', 'mechCmdr')
     and created_at > now() - interval '1 day';
  if n >= 40 then return false; end if;

  select name into nm from public.leaderboard where user_id = auth.uid();

  insert into public.war_events (kind, tile_id, actor_id, actor_name, meta)
  values (p_kind, null, auth.uid(), coalesce(nm, 'A pilot'),
          coalesce(p_meta, '{}'::jsonb));

  return true;
end;
$$;

revoke all on function public.log_mech(text, jsonb) from public, anon;
grant execute on function public.log_mech(text, jsonb) to authenticated;

-- ---- verify -----------------------------------------------------------------
--  Exactly one copy of the function, and the kinds it has written so far.
select 'log_mech copies' as check,
       (select count(*) from pg_proc p
          join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'log_mech') as copies;

select kind, count(*) as posted
  from public.war_events
 where kind in ('mechWorld', 'mechDeep', 'mechCore', 'mechSov', 'mechCmdr')
 group by kind
 order by kind;
