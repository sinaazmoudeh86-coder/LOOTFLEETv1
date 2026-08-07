# Notifications — core architecture

Automated daily brief + event alerts, delivered by email, SMS and web push.
This document is the **plumbing only**. Content, copy and cadence come after.

---

## 0. The shape of it

```
  game client                Supabase                     providers
  ───────────                ────────                     ─────────
  opt-in UI     ──────▶  notify_prefs  ◀──┐
  (verified)                              │
                                          │
  save push     ──────▶  saves ──┐        │
                                 │        │
  war reports   ──────▶  notify_events    │
  tile losses            (append-only)    │
                                 │        │
                                 ▼        │
                    pg_cron (hourly) ─────┘
                            │
                            ▼
                    Edge Fn: digest-build
                    ├─ who is due this hour?
                    ├─ snapshot diff (fleet)
                    ├─ drain events (galaxy)
                    └─ suppression checks
                            │
                            ▼
                    Edge Fn: digest-send  ──▶  Resend   (email)
                            │              ──▶  Twilio   (SMS)
                            │              ──▶  Web Push (VAPID)
                            ▼
                    notify_log  (idempotent, one row per send)
```

Two Edge Functions, four tables, one cron. Nothing in the game loop changes.

---

## 1. Channel strategy — the important decision

These three are **not** interchangeable. Assigning the wrong content to the
wrong channel is what makes players mute you.

| Channel | Cost / msg | Right for | Wrong for |
|---|---|---|---|
| **Email** | ~$0.0004 | The daily brief. Rich, skimmable, archivable, zero annoyance cost. | Anything time-critical. |
| **Web push** | **free** | "Your citadel is under attack", "crate ready", "streak ends in 2h". Instant, no domain reputation, works from the existing service worker. | Long content. Silently dead on iOS unless installed to home screen. |
| **SMS** | ~$0.008 + carrier fees | Almost nothing. Reserve for season-end and account security. | The daily brief. 10k players daily = **$2,400/mo** and a fast route to carrier spam filtering. |

**Recommendation: the daily brief is email. Web push is the urgent channel.
SMS stays off until there is a specific case that justifies it.**

Web push is the underused one here — free, instant, and `sw.js` already exists,
so it's the smallest lift of the three.

---

## 2. Where brief content comes from

Two sources, because they answer different questions.

### a) Snapshot diff → "your fleet"
Once a day, freeze the ~12 numbers worth reporting. The brief is today's
snapshot minus yesterday's. No new write path in the game, no event spam.

`level · power · gold · kills · zone · tiles · badge ranks · missions · fleet size · best temper · season stage · playtime`

### b) Event log → "what happened while you were away"
Things a diff can't see, because they resolve to the same number: a tile lost
then retaken, an alliance raid, being attacked. These are already produced by
war reports in `mail.js` — the digest reads the same source rather than
inventing a second one.

### c) Global aggregates → "the galaxy"
One row per day computed once for everybody: top movers, tiles flipped,
Void Zone holders, season leader. Cheap, and it's the part that makes the brief
feel like a world rather than a receipt.

---

## 3. Data model

```sql
-- WHO to contact, HOW, and the consent record that keeps it legal
create table notify_prefs (
  user_id        uuid primary key references auth.users on delete cascade,
  email          text,
  email_ok       boolean not null default false,   -- verified + opted in
  phone          text,                             -- E.164 only
  phone_ok       boolean not null default false,   -- double opt-in confirmed
  push_sub       jsonb,                            -- web push subscription
  push_ok        boolean not null default false,
  digest         text not null default 'daily',    -- daily | weekly | off
  send_hour      smallint not null default 8,      -- 0-23, player's local
  tz             text not null default 'UTC',
  quiet          boolean not null default true,    -- never 22:00-08:00 local
  alerts         jsonb not null default              -- per-event switches
                 '{"attack":true,"raid":true,"season":true,"crate":false}',
  unsub_token    text not null default encode(gen_random_bytes(16),'hex'),
  consent_at     timestamptz,
  consent_ip     inet,
  consent_text   text,          -- the exact wording they agreed to
  created_at     timestamptz not null default now()
);

-- daily frozen numbers; the diff between two rows IS the brief
create table notify_snapshots (
  user_id  uuid references auth.users on delete cascade,
  day      date not null,
  stats    jsonb not null,
  primary key (user_id, day)
);

-- append-only; drained by the digest, never mutated
create table notify_events (
  id       bigserial primary key,
  user_id  uuid references auth.users on delete cascade,
  kind     text not null,        -- tile_lost | attacked | raid | rank | season
  payload  jsonb not null,
  urgent   boolean not null default false,   -- true → push now, don't wait
  at       timestamptz not null default now(),
  sent     boolean not null default false
);

-- one row per delivery. The unique key is the whole anti-duplicate story.
create table notify_log (
  user_id  uuid references auth.users on delete cascade,
  kind     text not null,        -- digest | alert:<type>
  day      date not null,
  channel  text not null,        -- email | sms | push
  status   text not null,        -- queued | sent | bounced | failed
  provider_id text,
  at       timestamptz not null default now(),
  primary key (user_id, kind, day, channel)
);

-- hard stop list: bounces, complaints, unsubscribes. Checked before every send.
create table notify_suppress (
  addr     text primary key,     -- email or phone
  reason   text not null,        -- bounce | complaint | unsub | manual
  at       timestamptz not null default now()
);
```

RLS: a player reads and writes **only their own** `notify_prefs` row. Every
other table is service-role only — the client never touches them.

---

## 4. Scheduling

```sql
select cron.schedule('digest', '0 * * * *',
  $$ select net.http_post(
       url := 'https://emldvvlaanyivpmxyylr.supabase.co/functions/v1/digest-build',
       headers := '{"Authorization":"Bearer <service-role>"}'::jsonb
     ) $$);
```

**Hourly, not daily.** Each run selects only the users whose local `send_hour`
matches the current UTC hour. One cron covers every timezone, spreads provider
load across 24 hours instead of one spike, and a failed hour affects 1/24 of
players rather than all of them.

Urgent events run on a separate 5-minute cron that only fires web push.

---

## 5. Send-gating — the rules that decide *not* to send

More important than the send logic. In order:

1. `notify_suppress` hit → never send, ever.
2. Played in the last 4 hours → skip. They don't need a recap of right now.
3. No meaningful change AND no events → skip. An empty brief teaches people to
   ignore the next one.
4. Inactive 60+ days → drop to weekly, then stop. Dead addresses wreck sender
   reputation; that's what gets you into spam for everyone else.
5. Quiet hours in their timezone → hold until morning.
6. `notify_log` already has this (user, kind, day, channel) → already sent.

Rule 3 is the one that decides whether this feature is loved or muted.

---

## 6. Compliance floor

Not optional, and cheaper to build in now than retrofit.

**Email (CAN-SPAM + the 2024 Gmail/Yahoo bulk rules)**
- SPF, DKIM and DMARC on the sending domain — use a subdomain like
  `mail.lootfleet.com` so a bad campaign can't poison the main domain.
- `List-Unsubscribe` + `List-Unsubscribe-Post` headers (one-click, RFC 8058).
- Working unsubscribe link honoured within 10 days; physical address in footer.
- Keep spam complaints under 0.3%.

**SMS (TCPA — this is the expensive one to get wrong)**
- Express written consent, logged with timestamp, IP and exact wording.
- **Double opt-in**: they enter a number, we text a code, they confirm. The
  current one-tap flow does not clear this bar.
- STOP / HELP handling, and the sender identifies itself in every message.
- 10DLC brand + campaign registration with the carriers before any A2P traffic.
- Statutory damages are $500–$1,500 **per message**. This is why SMS is off by
  default in my recommendation.

**Web push** — browser permission is the consent. Nothing further.

**Both** — the existing `/privacy.html` needs a section on what's sent, how
often, and how to stop it.

---

## 7. Build order

| # | Step | Notes |
|---|---|---|
| 1 | Tables + RLS | the four above |
| 2 | Notification settings UI | replaces today's dead SMS box |
| 3 | Nightly snapshot writer | one row per active player |
| 4 | `digest-build` | selection + diff + gating; **logs, sends nothing** |
| 5 | Dry-run week | read the log daily, tune rule 3 |
| 6 | Domain auth + Resend | SPF/DKIM/DMARC, warm up slowly |
| 7 | `digest-send` email | start with your own address, then 1% |
| 8 | Web push | VAPID keys into existing `sw.js` |
| 9 | Urgent alert path | attacks and raids |
| 10 | SMS | only if a real case survives §1 |

Steps 4–5 before any provider work: you get to see exactly who *would* have
been mailed, and what the brief *would* have said, at zero cost and zero risk.

---

## Decisions I need from you

1. **Sending domain** — `mail.lootfleet.com`, or the root domain?
2. **Email provider** — Resend is my pick (clean API, generous free tier, good
   Supabase story). Postmark if you want the best deliverability. Either is fine.
3. **Web push in scope?** Free, instant, biggest gain per hour of work — I'd do
   it before SMS. Say if you'd rather keep it to email for now.
4. **SMS** — park it, or is there a specific alert you know you want texted?
5. **Default state** — opt-in (nobody gets anything until they ask) or opt-out
   (accounts default to the daily brief)? Opt-in is safer and legally cleaner;
   opt-out reaches far more people. My recommendation: **email opt-out at
   signup with a prominent toggle, push and SMS strictly opt-in.**
