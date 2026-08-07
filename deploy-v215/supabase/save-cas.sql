-- =============================================================================
--  save-cas.sql — SAFE CONCURRENT SAVES (compare-and-set) + session leases
--  Run ONCE in Supabase → SQL Editor. Safe to re-run.
--
--  WHY: `saves` was written with a blind upsert, so two signed-in devices
--  last-write-wins — the second push erased everything the first did since it
--  booted. This migration makes every write a compare-and-set against a row
--  revision, turns the session lock into a server-timestamped lease (no client
--  clock involved), and keeps a quarantine copy of any timeline that loses a
--  merge so nothing is ever destroyed.
--
--  Client: js/cloud.js (pullSave/pushSave/claimSession/readSession/saveConflict)
-- =============================================================================

-- ---- 1. row revision on saves ----------------------------------------------
alter table public.saves add column if not exists rev bigint not null default 0;

-- ---- 2. quarantine for losing timelines ------------------------------------
create table if not exists public.save_conflicts (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  reason     text,
  weight     double precision,
  created_at timestamptz not null default now()
);
create index if not exists save_conflicts_user_idx on public.save_conflicts (user_id, created_at desc);

alter table public.save_conflicts enable row level security;
drop policy if exists "conflicts_own" on public.save_conflicts;
create policy "conflicts_own" on public.save_conflicts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- 3. COMPARE-AND-SET push ------------------------------------------------
--  p_rev = the revision this client last read. If the stored row has moved on,
--  NOTHING is written: the caller gets {ok:false, conflict:true} plus the row
--  it missed, merges locally, and retries with the fresh revision.
--  p_rev < 0 forces a write (recovery / first write of a legacy row).
create or replace function public.save_push(p_rev bigint, p_data jsonb, p_lock jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cur bigint;
  v_new bigint;
  v_data jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;

  select rev, data into v_cur, v_data from public.saves where user_id = v_uid for update;

  if not found then
    insert into public.saves (user_id, data, rev, updated_at) values (v_uid, p_data, 1, now());
    return jsonb_build_object('ok', true, 'rev', 1);
  end if;

  if p_rev >= 0 and v_cur <> p_rev then
    -- somebody else advanced the row since this client last read it
    return jsonb_build_object('ok', false, 'conflict', true, 'rev', v_cur, 'data', v_data);
  end if;

  v_new := v_cur + 1;
  update public.saves set data = p_data, rev = v_new, updated_at = now() where user_id = v_uid;
  return jsonb_build_object('ok', true, 'rev', v_new);
end;
$$;
grant execute on function public.save_push(bigint, jsonb, jsonb) to authenticated;

-- ---- 4. read a save WITH its revision ---------------------------------------
create or replace function public.save_pull()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
  v_data jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select rev, data into v_rev, v_data from public.saves where user_id = v_uid;
  if not found then return jsonb_build_object('ok', true, 'rev', 0, 'data', null); end if;
  return jsonb_build_object('ok', true, 'rev', v_rev, 'data', v_data);
end;
$$;
grant execute on function public.save_pull() to authenticated;

-- ---- 5. SESSION LEASE — server time is the only clock -----------------------
--  The lease table normally comes from session-lock.sql; create it here too so
--  this migration stands alone on projects that never ran that one.
create table if not exists public.active_sessions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  session_id text not null,
  device     text,
  updated_at timestamptz not null default now()
);
alter table public.active_sessions enable row level security;
drop policy if exists "own session" on public.active_sessions;
create policy "own session" on public.active_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

--  claim_session: this context takes the account. Returns the row it replaced
--  and the server's now(), so clients compare server stamps, never their own.
create or replace function public.claim_session(p_session text, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prev text;
  v_at timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select session_id into v_prev from public.active_sessions where user_id = v_uid;
  insert into public.active_sessions (user_id, session_id, device, updated_at)
    values (v_uid, p_session, p_device, now())
    on conflict (user_id) do update set session_id = excluded.session_id, device = excluded.device, updated_at = now()
    returning updated_at into v_at;
  -- owner/mine included so a caller can hand this straight back as a touch
  return jsonb_build_object('ok', true, 'session', p_session, 'owner', p_session, 'mine', true,
                            'at', v_at, 'now', now(), 'prev', v_prev);
end;
$$;
grant execute on function public.claim_session(text, text) to authenticated;

--  touch_session: heartbeat. Only the CURRENT owner refreshes the lease; a
--  stale owner gets back the winner's id and stands down.
create or replace function public.touch_session(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner text;
  v_at timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select session_id, updated_at into v_owner, v_at from public.active_sessions where user_id = v_uid;
  if v_owner is null then
    -- no lease row (never claimed, or cleaned up) — take it, and answer in the
    -- SAME shape as a normal touch so the caller never reads mine=false here
    insert into public.active_sessions (user_id, session_id, updated_at)
      values (v_uid, p_session, now())
      on conflict (user_id) do update set session_id = excluded.session_id, updated_at = now()
      returning updated_at into v_at;
    return jsonb_build_object('ok', true, 'owner', p_session, 'mine', true, 'at', v_at, 'now', now());
  end if;
  if v_owner = p_session then
    update public.active_sessions set updated_at = now() where user_id = v_uid returning updated_at into v_at;
  end if;
  return jsonb_build_object('ok', true, 'owner', v_owner, 'mine', (v_owner = p_session), 'at', v_at, 'now', now());
end;
$$;
grant execute on function public.touch_session(text) to authenticated;

-- realtime on the lease table (persisted row changes — a reconnecting device
-- sees the current owner, unlike an ephemeral broadcast it slept through)
do $$ begin
  alter publication supabase_realtime add table public.active_sessions;
exception when others then null;
end $$;
