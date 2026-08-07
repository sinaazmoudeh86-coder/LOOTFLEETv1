-- =============================================================================
--  war-events.sql — a log for things that happen but leave no trace
--  ---------------------------------------------------------------------------
--  The Discord feed works by diffing `territory`, `leaderboard` and `alliances`.
--  That catches everything where state CHANGES hands. It cannot see a SUCCESSFUL
--  DEFENCE: the attacker's 60s clock runs out, the defender keeps the tile, and
--  the row is byte-for-byte identical to a minute ago.
--
--  So the attacker's client reports it. The RPC is deliberately narrow:
--    · the ATTACKER is auth.uid() — never taken from the client
--    · the DEFENDER is read from territory server-side — never taken either
--    · one row per attacker/tile per minute, so a loop can't spam the channel
--  A forged call can only ever credit somebody ELSE with a successful defence,
--  which is not a thing anyone gains from faking.
--
--  Safe to re-run.
-- =============================================================================

create table if not exists public.war_events (
  id          bigserial primary key,
  kind        text not null,
  tile_id     text,
  actor_id    uuid,
  actor_name  text,
  target_id   uuid,
  target_name text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists war_events_id_idx on public.war_events (id);
create index if not exists war_events_created_idx on public.war_events (created_at desc);

alter table public.war_events enable row level security;
revoke all on public.war_events from anon, authenticated;
grant select on public.war_events to authenticated;   -- read-only; writes via RPC
do $$ begin
  create policy war_events_read on public.war_events for select using (true);
exception when duplicate_object then null; end $$;

-- ---- REPELLED ---------------------------------------------------------------
create or replace function public.log_repelled(p_tile_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t   public.territory;
  att text;
begin
  if auth.uid() is null then return; end if;
  select * into t from public.territory where tile_id = p_tile_id;
  if not found or t.owner_id is null then return; end if;
  if t.owner_id = auth.uid() then return; end if;          -- can't repel yourself

  -- one per attacker per tile per minute
  if exists (
    select 1 from public.war_events
     where kind = 'repelled' and tile_id = p_tile_id and actor_id = auth.uid()
       and created_at > now() - interval '1 minute'
  ) then return; end if;

  select name into att from public.leaderboard where user_id = auth.uid();

  insert into public.war_events (kind, tile_id, actor_id, actor_name, target_id, target_name, meta)
  values ('repelled', p_tile_id, auth.uid(), coalesce(att, 'An attacker'),
          t.owner_id, coalesce(t.owner_name, 'the holder'),
          jsonb_build_object('citadel', t.citadel, 'citadel_lv', coalesce(t.citadel_lv, 0)));
end $$;

grant execute on function public.log_repelled(text) to authenticated;

-- Keep the log small — the feed only ever reads the tail.
delete from public.war_events where created_at < now() - interval '30 days';
