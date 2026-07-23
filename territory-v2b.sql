-- =============================================================================
--  session-lock.sql — one active login per account
--  A fresh login claims the account by upserting its device id here; every
--  other signed-in device notices (realtime + polling) and kicks itself to
--  the login gate. Run once in the SQL editor. Client: js/session-lock.js
-- =============================================================================

create table if not exists public.active_sessions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  session_id text not null,           -- device id of the CURRENT owner
  device     text,                    -- human label ("iOS · …") for the kick screen
  updated_at timestamptz not null default now()
);

alter table public.active_sessions enable row level security;

drop policy if exists "own session" on public.active_sessions;
create policy "own session" on public.active_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- realtime → instant kicks (best-effort; the client also polls every 20s)
do $$ begin
  alter publication supabase_realtime add table public.active_sessions;
exception when duplicate_object then null;
end $$;
