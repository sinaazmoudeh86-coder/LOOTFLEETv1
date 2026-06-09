-- =============================================================================
--  Loot Fleet — TERRITORY (real cross-account turf war)
--  Run this in your Supabase project: Dashboard → SQL Editor → New query → Run.
--  Safe to run more than once.
--
--  This adds a SHARED, world-readable table of who owns each galaxy tile, plus a
--  server-authoritative claim_tile() function. Real signed-in accounts fight over
--  the same 60 tiles; the client fills any unclaimed tiles with simulated rivals
--  so the map is never empty.
-- =============================================================================

create table if not exists public.territory (
  tile_id        text primary key,                                   -- e.g. 'r2-t5'
  owner_id       uuid not null references auth.users(id) on delete cascade,
  owner_name     text not null,
  captured_at    timestamptz not null default now(),
  cooldown_until timestamptz not null default now()                  -- protected window
);

alter table public.territory enable row level security;

-- Everyone (even logged-out visitors) can READ the shared world …
drop policy if exists "territory_read" on public.territory;
create policy "territory_read" on public.territory for select using (true);

-- … but there are NO insert/update/delete policies, so the table cannot be
-- written directly from the browser. All writes go through claim_tile() below,
-- which runs with elevated rights and always stamps the caller's real auth id.

-- Capture / contest a tile. Server-authoritative:
--   • requires a signed-in user
--   • owner is ALWAYS the caller's auth.uid() (cannot be spoofed)
--   • rejects a claim while the tile is in another owner's 15-min protected window
--   • on success, (re)stamps owner + a fresh 15-min protected window
create or replace function public.claim_tile(p_tile_id text, p_owner_name text)
returns public.territory
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.territory;
  result   public.territory;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into existing from public.territory where tile_id = p_tile_id for update;

  if found and existing.owner_id <> auth.uid() and existing.cooldown_until > now() then
    raise exception 'tile protected (cooldown)';
  end if;

  insert into public.territory (tile_id, owner_id, owner_name, captured_at, cooldown_until)
  values (p_tile_id, auth.uid(), coalesce(nullif(p_owner_name, ''), 'Operator'),
          now(), now() + interval '15 minutes')
  on conflict (tile_id) do update
    set owner_id       = excluded.owner_id,
        owner_name     = excluded.owner_name,
        captured_at    = excluded.captured_at,
        cooldown_until = excluded.cooldown_until
  returning * into result;

  return result;
end;
$$;

grant execute on function public.claim_tile(text, text) to authenticated;

-- Stream live changes to all clients (the map updates the moment anyone captures).
do $$
begin
  begin
    alter publication supabase_realtime add table public.territory;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;
