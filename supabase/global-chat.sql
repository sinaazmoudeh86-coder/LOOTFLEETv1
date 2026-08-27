-- =============================================================================
--  LOOTFLEET — GLOBAL CHAT  (build 728)
--  Run in Supabase: Dashboard → SQL Editor → New query → Run. Safe to re-run.
--
--  TRUST MODEL, same as saves/leaderboard/social: identity is ALWAYS auth.uid(),
--  and the CLIENT IS NOT A TRUST BOUNDARY. Every limit that matters — who may
--  post, how often, how long, what is stripped — is enforced in chat_post()
--  below. The client's copy of those rules exists only so it can STATE them to
--  the player before they type; it can never be the thing that enforces them.
--
--  WHY A CONFIG TABLE: a live chat needs knobs an operator can turn during an
--  incident (raise the cooldown, raise the level gate, switch on slow mode)
--  WITHOUT pushing a client build and evicting every player mid-session. Those
--  knobs are rows in chat_config, not constants in JS.
--
--  THE PROFANITY LIST IS OPERATOR-MAINTAINED ON PURPOSE. chat_blocked is seeded
--  with the abuse actually observed in f2p game chat — scam links, "free
--  lootcoins" bait, off-platform recruiting — because those are the patterns
--  that cost players money. A curated slur list is an ops artifact that belongs
--  in the database where it can be extended in one UPDATE; the report queue
--  (chat_reports → chat_mod_queue) is the real backstop, not the regex.
-- =============================================================================

-- ---- config ------------------------------------------------------------------
create table if not exists public.chat_config (
  k text primary key,
  v  jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.chat_config enable row level security;
drop policy if exists "cc_read" on public.chat_config;
create policy "cc_read" on public.chat_config for select using (auth.uid() is not null);

insert into public.chat_config(k, v) values
  ('min_level',  '5'::jsonb),      -- read is always free; POSTING unlocks here
  ('max_len',    '180'::jsonb),
  ('cooldown_s', '4'::jsonb),      -- between one pilot's own messages
  ('burst_n',    '5'::jsonb),      -- ...and no more than burst_n per burst_s
  ('burst_s',    '30'::jsonb),
  ('hourly_n',   '60'::jsonb),
  ('slow_mode_s','0'::jsonb),      -- operator incident brake, applies to EVERYONE
  ('keep_days',  '7'::jsonb)
on conflict (k) do nothing;        -- NEVER clobber a knob the operator has turned

create or replace function public._chat_cfg(p_k text, p_default numeric)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select (v #>> '{}')::numeric from public.chat_config where k = p_k), p_default);
$$;

-- ---- messages ----------------------------------------------------------------
-- name / lvl / tag are DENORMALISED AT POST TIME on purpose: a message is a
-- record of what was said and by whom AT THAT MOMENT. Joining live to
-- leaderboard would rewrite the history of the room every time somebody
-- renamed, changed alliance or levelled.
create table if not exists public.chat_messages (
  id         bigserial primary key,
  chan       text not null default 'global',
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null default '',
  lvl        int  not null default 0,
  tag        text not null default '',
  kind       text not null default 'chat',   -- chat | sys
  txt        text not null,
  hidden     boolean not null default false, -- moderation HIDES; it never deletes
  created_at timestamptz not null default now()
);
alter table public.chat_messages add column if not exists hidden boolean not null default false;
create index if not exists cm_chan_idx on public.chat_messages (chan, id desc);
create index if not exists cm_user_idx on public.chat_messages (user_id, id desc);

alter table public.chat_messages enable row level security;
-- Realtime (postgres_changes) RESPECTS RLS, so this policy is what makes live
-- delivery work at all. Mutes and hidden rows are filtered by the reader.
drop policy if exists "cm_read" on public.chat_messages;
create policy "cm_read" on public.chat_messages for select using (auth.uid() is not null);
-- no insert/update/delete policy: every write goes through the RPCs below

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- ---- mutes (per account, so they ROAM — never a device preference) ------------
create table if not exists public.chat_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  muted   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted)
);
alter table public.chat_mutes enable row level security;
drop policy if exists "cmu_read_own" on public.chat_mutes;
create policy "cmu_read_own" on public.chat_mutes for select using (auth.uid() = user_id);

-- ---- bans --------------------------------------------------------------------
create table if not exists public.chat_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until   timestamptz,                       -- null = indefinite
  reason  text not null default '',
  created_at timestamptz not null default now()
);
alter table public.chat_bans enable row level security;
drop policy if exists "cb_read_own" on public.chat_bans;
create policy "cb_read_own" on public.chat_bans for select using (auth.uid() = user_id);

-- ---- reports -----------------------------------------------------------------
-- snap_* FREEZES the evidence at report time. A message that is later hidden,
-- or a pilot who later renames, must not erase what was reported.
create table if not exists public.chat_reports (
  id         bigserial primary key,
  msg_id     bigint,
  reporter   uuid references auth.users(id) on delete set null,
  target     uuid,
  snap_name  text not null default '',
  snap_txt   text not null default '',
  note       text not null default '',
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists cr_open_idx on public.chat_reports (resolved, id desc);
alter table public.chat_reports enable row level security;
drop policy if exists "cr_read_own" on public.chat_reports;
create policy "cr_read_own" on public.chat_reports for select using (auth.uid() = reporter);

-- ---- blocked patterns (operator-extensible, no deploy needed) -----------------
create table if not exists public.chat_blocked (
  id bigserial primary key,
  pat text not null,                        -- case-insensitive regex
  note text not null default ''
);
alter table public.chat_blocked enable row level security;   -- no read policy: server-only

insert into public.chat_blocked(pat, note)
select * from (values
  ('free\s*(loot\s*coins?|lc|gems?|credits?)',        'scam bait'),
  ('(generator|gen)\s*(loot|coins?|gems?)',           'scam bait'),
  ('(hack|mod\s*menu|apk|cheat)\s*(tool|link|site)',  'scam bait'),
  ('discord\.(gg|com)\/',                             'off-platform recruiting'),
  ('t\.me\/',                                         'off-platform recruiting'),
  ('(sell|buy|trade)\s+(acc|account)',                'account trading')
) v(pat, note)
where not exists (select 1 from public.chat_blocked);

-- =============================================================================
--  SANITISE — one function, so every write path cleans identically
-- =============================================================================
create or replace function public._chat_clean(p_txt text, p_max int)
returns text language plpgsql immutable set search_path = public as $$
declare t text; caps int; letters int;
begin
  t := coalesce(p_txt, '');
  -- invisible characters used to disguise text and to reverse it (bidi overrides)
  t := regexp_replace(t, '[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]', '', 'g');
  t := regexp_replace(t, '[\x00-\x1f\x7f]', ' ', 'g');       -- control chars, incl. newlines
  -- LINKS ARE STRIPPED, NOT REJECTED. A scam link is the single most expensive
  -- thing a chat can carry; silently dropping it beats teaching spammers which
  -- phrasing gets through, and beats punishing a player who pasted a real one.
  t := regexp_replace(t, '(https?://|www\.)\S+', '[link removed]', 'gi');
  t := regexp_replace(t,
       '[a-z0-9][a-z0-9-]*\.(com|net|org|io|gg|xyz|ru|top|link|click|shop|site|online|info|co|me|tk|ml|cf|ga|vip|fun|live|store)(/\S*)?',
       '[link removed]', 'gi');
  t := regexp_replace(t, '(.)\1{4,}', '\1\1\1\1', 'g');      -- aaaaaaaa → aaaa
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  t := left(t, greatest(1, coalesce(p_max, 180)));
  -- shouting: de-cap rather than refuse, and only when it is unambiguous
  letters := length(regexp_replace(t, '[^a-zA-Z]', '', 'g'));
  caps    := length(regexp_replace(t, '[^A-Z]', '', 'g'));
  if letters >= 20 and caps::numeric / letters > 0.8 then t := lower(t); end if;
  return t;
end; $$;

-- =============================================================================
--  GATE — "may I post, and if not, WHY". The client renders this as TEXT before
--  the player types. A rule that decides whether something counts has to be
--  stated before it fires, never discovered by being refused.
-- =============================================================================
create or replace function public.chat_gate()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); minlv int; lv int; b record; lastp timestamptz;
        cd int; slow int; wait numeric := 0; n int;
begin
  if me is null then return jsonb_build_object('ok', false, 'why', 'signin'); end if;
  minlv := public._chat_cfg('min_level', 5)::int;
  cd    := public._chat_cfg('cooldown_s', 4)::int;
  slow  := public._chat_cfg('slow_mode_s', 0)::int;

  select * into b from public.chat_bans where user_id = me;
  if b.user_id is not null and (b.until is null or b.until > now()) then
    return jsonb_build_object('ok', false, 'why', 'banned', 'until', b.until, 'reason', b.reason);
  end if;

  select level into lv from public.leaderboard where user_id = me;
  if lv is null then
    return jsonb_build_object('ok', false, 'why', 'norecord', 'min_level', minlv);
  end if;
  if lv < minlv then
    return jsonb_build_object('ok', false, 'why', 'level', 'min_level', minlv, 'level', lv);
  end if;

  select max(created_at) into lastp from public.chat_messages where user_id = me and kind = 'chat';
  if lastp is not null then
    wait := greatest(0, greatest(cd, slow) - extract(epoch from (now() - lastp)));
  end if;
  select count(*) into n from public.chat_messages
    where user_id = me and kind = 'chat' and created_at > now() - interval '1 hour';

  return jsonb_build_object('ok', wait <= 0, 'why', case when wait > 0 then 'cooldown' else '' end,
    'level', lv, 'min_level', minlv, 'wait', ceil(wait), 'slow', slow,
    'cool', greatest(cd, slow),        -- base wait the client counts down after a send
    'max_len', public._chat_cfg('max_len', 180)::int,
    'hour_used', n, 'hour_max', public._chat_cfg('hourly_n', 60)::int);
end; $$;
grant execute on function public.chat_gate() to authenticated;

-- =============================================================================
--  POST
-- =============================================================================
create or replace function public.chat_post(p_txt text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text; nm text; lv int; tg text; b record;
        maxlen int; cd int; slow int; bn int; bs int; hn int; n int;
        lastp timestamptz; nid bigint; row_out jsonb; pat text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into b from public.chat_bans where user_id = me;
  if b.user_id is not null and (b.until is null or b.until > now()) then
    raise exception 'you cannot post in global chat right now';
  end if;

  maxlen := public._chat_cfg('max_len', 180)::int;
  cd     := public._chat_cfg('cooldown_s', 4)::int;
  slow   := public._chat_cfg('slow_mode_s', 0)::int;
  bn     := public._chat_cfg('burst_n', 5)::int;
  bs     := public._chat_cfg('burst_s', 30)::int;
  hn     := public._chat_cfg('hourly_n', 60)::int;

  -- identity and the level gate both come from the PUBLISHED record, never from
  -- the caller. A throwaway account has no leaderboard row and cannot post.
  select name, level into nm, lv from public.leaderboard where user_id = me;
  if lv is null then raise exception 'your pilot record has not reached the server yet — finish a battle and try again'; end if;
  if lv < public._chat_cfg('min_level', 5)::int then
    raise exception 'global chat unlocks at Level %', public._chat_cfg('min_level', 5)::int;
  end if;

  t := public._chat_clean(p_txt, maxlen);
  if length(t) < 1 then raise exception 'nothing to send'; end if;
  if t = '[link removed]' then raise exception 'links are not allowed in global chat'; end if;

  -- The column is QUALIFIED because `pat` is also the loop variable declared
  -- above. Unqualified, PL/pgSQL's default variable_conflict = error makes this
  -- ambiguous (42702) — and it plans inner SQL lazily, so the function INSTALLS
  -- cleanly and throws on every post instead. Same trap as the `art` temporal
  -- dead zone in lbPublish: it looks fine until it runs.
  for pat in select cb.pat from public.chat_blocked cb loop
    if t ~* pat then raise exception 'that message was not sent'; end if;
  end loop;

  -- rate limits: own cooldown (or the operator's slow mode, whichever is longer)
  select max(created_at) into lastp from public.chat_messages where user_id = me and kind = 'chat';
  if lastp is not null and lastp > now() - make_interval(secs => greatest(cd, slow)) then
    raise exception 'slow down — % more second(s)',
      ceil(greatest(cd, slow) - extract(epoch from (now() - lastp)))::int;
  end if;
  select count(*) into n from public.chat_messages
    where user_id = me and kind = 'chat' and created_at > now() - make_interval(secs => bs);
  if n >= bn then raise exception 'too many messages at once — take a breath'; end if;
  select count(*) into n from public.chat_messages
    where user_id = me and kind = 'chat' and created_at > now() - interval '1 hour';
  if n >= hn then raise exception 'hourly chat limit reached'; end if;
  -- same thing twice
  if exists (select 1 from public.chat_messages
             where user_id = me and kind = 'chat' and txt = t
               and created_at > now() - interval '90 seconds') then
    raise exception 'you just said that';
  end if;

  select a.tag into tg from public.alliance_members m
    join public.alliances a on a.id = m.alliance_id where m.user_id = me;

  insert into public.chat_messages(chan, user_id, name, lvl, tag, kind, txt)
    values ('global', me, coalesce(nm, 'Operator'), lv, coalesce(tg, ''), 'chat', t)
    returning id into nid;

  -- housekeeping, amortised. Reports keep their own frozen snapshot, so pruning
  -- the room never destroys evidence.
  if (nid % 50) = 0 then
    delete from public.chat_messages
      where created_at < now() - make_interval(days => public._chat_cfg('keep_days', 7)::int);
  end if;

  select to_jsonb(x) into row_out from
    (select id, user_id, name, lvl, tag, kind, txt, created_at
       from public.chat_messages where id = nid) x;
  return row_out;
end; $$;
grant execute on function public.chat_post(text) to authenticated;

-- =============================================================================
--  PULL — newest-first, ALWAYS. The caller reverses for display and advances its
--  cursor to max(id) of what it actually received.
--
--  Reading oldest-first with a LIMIT is how the Discord war feed froze its
--  cursor at the page size for four days: the window fills with history and the
--  cursor never reaches the live edge. Newest-first cannot do that — a client
--  that falls more than p_limit behind skips the gap and rejoins the present,
--  which is the correct behaviour for a room (nobody needs a chat backfill).
-- =============================================================================
create or replace function public.chat_pull(p_after bigint default 0, p_limit int default 80)
returns table (id bigint, user_id uuid, name text, lvl int, tag text, kind text,
               txt text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select m.id, m.user_id, m.name, m.lvl, m.tag, m.kind, m.txt, m.created_at
  from public.chat_messages m
  where m.chan = 'global'
    and not m.hidden
    and m.id > coalesce(p_after, 0)
    and (m.user_id is null or not exists (
      select 1 from public.chat_mutes u where u.user_id = auth.uid() and u.muted = m.user_id))
  order by m.id desc
  limit least(greatest(coalesce(p_limit, 80), 1), 200);
$$;
grant execute on function public.chat_pull(bigint, int) to authenticated;

-- who I have muted (client filters realtime pushes with this)
create or replace function public.chat_mute_list()
returns setof uuid language sql security definer set search_path = public as $$
  select muted from public.chat_mutes where user_id = auth.uid();
$$;
grant execute on function public.chat_mute_list() to authenticated;

create or replace function public.chat_mute(p_target uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_target is null or p_target = auth.uid() then raise exception 'bad target'; end if;
  if coalesce(p_on, true) then
    insert into public.chat_mutes(user_id, muted) values (auth.uid(), p_target)
      on conflict do nothing;
  else
    delete from public.chat_mutes where user_id = auth.uid() and muted = p_target;
  end if;
end; $$;
grant execute on function public.chat_mute(uuid, boolean) to authenticated;

create or replace function public.chat_report(p_msg bigint, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m record;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into m from public.chat_messages where id = p_msg;
  if m.id is null then raise exception 'message not found'; end if;
  if m.user_id = me then raise exception 'that is your own message'; end if;
  if exists (select 1 from public.chat_reports where msg_id = p_msg and reporter = me) then
    return;                                     -- idempotent: report twice, filed once
  end if;
  insert into public.chat_reports(msg_id, reporter, target, snap_name, snap_txt, note)
    values (p_msg, me, m.user_id, m.name, m.txt, left(coalesce(p_note, ''), 120));
end; $$;
grant execute on function public.chat_report(bigint, text) to authenticated;

-- one call for the pilot card a player taps open from a message
create or replace function public.chat_who(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select to_jsonb(x) into r from (
    select l.user_id, l.name, l.level, l.zone, l.power, l.fleet, l.updated_at as last_seen,
           (select a.tag from public.alliance_members m join public.alliances a on a.id = m.alliance_id
             where m.user_id = l.user_id) as tag,
           exists (select 1 from public.chat_mutes u where u.user_id = auth.uid() and u.muted = l.user_id) as muted
    from public.leaderboard l where l.user_id = p_uid) x;
  return r;
end; $$;
grant execute on function public.chat_who(uuid) to authenticated;

-- =============================================================================
--  ACCOUNT DELETION (App Review 5.1.1(v)) — erase the caller's chat footprint.
--
--  This is an RPC rather than a DELETE policy on purpose. A delete policy scoped
--  to auth.uid() = user_id would ALSO let any pilot erase their own messages out
--  of the live room, which is precisely the moderation record we keep hidden-not-
--  deleted for. Deleting your ACCOUNT is a different act from deleting your words.
-- =============================================================================
create or replace function public.chat_forget()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  delete from public.chat_messages where user_id = me;
  delete from public.chat_mutes   where user_id = me or muted = me;
  delete from public.chat_bans    where user_id = me;
  -- reports the pilot filed, and reports about a pilot who no longer exists:
  -- neither is actionable once the account is gone
  delete from public.chat_reports where reporter = me or target = me;
end; $$;
grant execute on function public.chat_forget() to authenticated;

-- =============================================================================
--  MODERATION (admin password, same gate as every admin_* RPC)
-- =============================================================================
create or replace function public.chat_announce(p_pw text, p_txt text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  insert into public.chat_messages(chan, user_id, name, lvl, tag, kind, txt)
    values ('global', null, 'FLEET COMMAND', 0, '', 'sys',
            public._chat_clean(p_txt, 240));
end; $$;
grant execute on function public.chat_announce(text, text) to authenticated;

create or replace function public.chat_mod_hide(p_pw text, p_msg bigint, p_hidden boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  update public.chat_messages set hidden = coalesce(p_hidden, true) where id = p_msg;
end; $$;
grant execute on function public.chat_mod_hide(text, bigint, boolean) to authenticated;

-- p_hours null = indefinite. Hiding the pilot's recent lines is OPTIONAL and
-- separate: a ban stops the next message, it does not rewrite the room.
create or replace function public.chat_mod_ban(p_pw text, p_uid uuid, p_hours int default 24,
                                               p_reason text default '', p_wipe boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  insert into public.chat_bans(user_id, until, reason)
    values (p_uid, case when p_hours is null then null else now() + make_interval(hours => p_hours) end,
            left(coalesce(p_reason, ''), 160))
    on conflict (user_id) do update set
      until = excluded.until, reason = excluded.reason, created_at = now();
  if coalesce(p_wipe, false) then
    update public.chat_messages set hidden = true
      where user_id = p_uid and created_at > now() - interval '24 hours';
  end if;
end; $$;
grant execute on function public.chat_mod_ban(text, uuid, int, text, boolean) to authenticated;

create or replace function public.chat_mod_unban(p_pw text, p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  delete from public.chat_bans where user_id = p_uid;
end; $$;
grant execute on function public.chat_mod_unban(text, uuid) to authenticated;

drop function if exists public.chat_mod_queue(text, int);
create or replace function public.chat_mod_queue(p_pw text, p_limit int default 100)
returns table (report_id bigint, msg_id bigint, target uuid, target_name text,
               snap_txt text, note text, reports int, hidden boolean,
               banned_until timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  return query
    select r.id, r.msg_id, r.target, r.snap_name, r.snap_txt, r.note,
           (select count(*)::int from public.chat_reports r2 where r2.msg_id = r.msg_id),
           coalesce((select m.hidden from public.chat_messages m where m.id = r.msg_id), false),
           (select b.until from public.chat_bans b where b.user_id = r.target),
           r.created_at
    from public.chat_reports r
    where not r.resolved
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end; $$;
grant execute on function public.chat_mod_queue(text, int) to authenticated;

create or replace function public.chat_mod_resolve(p_pw text, p_report bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  update public.chat_reports set resolved = true where id = p_report;
end; $$;
grant execute on function public.chat_mod_resolve(text, bigint) to authenticated;

-- =============================================================================
--  OPERATOR CHEATSHEET
--    SMOKE TEST FIRST — run these as a signed-in user (SQL Editor "Run as" or
--    from the client console) before calling this file done. chat_post is the
--    one path with a FOR loop over chat_blocked, and PL/pgSQL only plans that
--    query on first execution, so installing cleanly proves nothing:
--      select chat_gate();                       -- expect ok/why, no error
--      select chat_post('smoke test');           -- expect the inserted row
--      select * from chat_pull(0, 10);           -- expect it back, newest first
--      delete from chat_messages where txt = 'smoke test';
--
--    announce:  select chat_announce('PW', 'Make-good LootCoins are landing now.');
--    queue:     select * from chat_mod_queue('PW');
--    hide one:  select chat_mod_hide('PW', 12345);
--    24h ban:   select chat_mod_ban('PW', '<uuid>', 24, 'scam links', true);
--    lift:      select chat_mod_unban('PW', '<uuid>');
--    slow mode: update chat_config set v = '15'::jsonb where k = 'slow_mode_s';
--    gate:      update chat_config set v = '10'::jsonb where k = 'min_level';
--    add a word:insert into chat_blocked(pat, note) values ('<regex>', 'why');
--  Config changes take effect on the NEXT message. No client push, no eviction.
-- =============================================================================
