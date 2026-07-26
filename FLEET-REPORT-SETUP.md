# Fleet report — launch runbook

Email only. Your values are filled in throughout.

| | |
|---|---|
| Supabase project | `emldvvlaanyivpmxyylr` |
| Site | `https://lootfleet.com` |
| Sending domain | `mail.lootfleet.com` (subdomain — a bad campaign can't poison the root) |
| Functions base | `https://emldvvlaanyivpmxyylr.supabase.co/functions/v1` |

Seven stages. Stages 1–4 are free and send nothing. **Stage 5 is a hard gate —
don't pass it in a hurry.** Total hands-on time ~2 hours, spread over ~10 days
because DNS and the dry-run week both need waiting.

---

## STAGE 1 · Database — 5 min

1. Supabase ▸ **SQL Editor** ▸ New query
2. Paste all of `supabase/notifications.sql` ▸ **Run**
3. Confirm:

```sql
select table_name from information_schema.tables
where table_name like 'notify%' order by 1;
-- expect: notify_events, notify_log, notify_prefs, notify_snapshots, notify_suppress
```

The cron block at the bottom of that file is commented out. Leave it.

---

## STAGE 2 · Deploy the two functions — 15 min

**Option A — dashboard (no tooling).** Supabase ▸ **Edge Functions** ▸ *Deploy a
new function* ▸ name `digest-build` ▸ paste `supabase/functions/digest-build/index.ts`
▸ turn **Verify JWT off** ▸ Deploy. Repeat for `notify-unsub`.

**Option B — CLI.**
```bash
npm i -g supabase
supabase login
supabase link --project-ref emldvvlaanyivpmxyylr
supabase functions deploy digest-build --no-verify-jwt
supabase functions deploy notify-unsub  --no-verify-jwt
```

JWT verification must be **off** on both: cron calls one with a service-role key,
and Gmail calls the other with no credentials at all.

Then set the one safe secret (Supabase ▸ Edge Functions ▸ Secrets):

```
SITE_URL = https://lootfleet.com
```

**Do not set `RESEND_API_KEY` yet.** Its absence is what keeps this in dry-run.

---

## STAGE 3 · Turn it on for yourself — 2 min

1. Open the game, sign in with your email account
2. Tap your name (top bar) ▸ **✉ Fleet report** ▸ toggle **on**
3. Pick *Every day* and an hour
4. Verify the row landed:

```sql
select email, email_ok, digest, send_hour, tz, consent_at from notify_prefs;
```

`consent_at` must be populated. That timestamp is your consent record.

---

## STAGE 4 · First dry run — 10 min

Trigger a pass by hand. `force=1` bypasses the send-hour and the 4-hour idle
rule so you get output immediately.

```bash
curl -X POST \
  "https://emldvvlaanyivpmxyylr.supabase.co/functions/v1/digest-build?force=1" \
  -H "Authorization: Bearer <SERVICE-ROLE-KEY>"
```

Expect: `{"ok":true,"due":1,"dryrun":1,"sent":0,"live":false}`

Now read what it decided:

```sql
-- the outcome for everyone in this pass
select status, reason, count(*) from notify_log
where day = current_date group by 1,2 order by 3 desc;

-- the exact brief it would have mailed you
select jsonb_pretty(payload) from notify_log
where status = 'dryrun' order by at desc limit 1;
```

That payload is the whole brief: per-stat deltas, unsent events, galaxy stats,
`first` flag, unsubscribe URL. If it looks right, the pipe works.

Also confirm the unsubscribe page renders — paste the `unsub` URL from the
payload into a browser. It should say "Unsubscribed", and `notify_prefs.email_ok`
should flip to false. **Toggle yourself back on in-game afterwards.**

---

## STAGE 5 · Dry-run week — the gate

Schedule the cron **now**, still in dry-run. It costs nothing and gives you a
week of real decisions to read.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('lf-digest', '0 * * * *', $CRON$
  select net.http_post(
    url     := 'https://emldvvlaanyivpmxyylr.supabase.co/functions/v1/digest-build',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer <SERVICE-ROLE-KEY>'),
    body    := '{}'::jsonb)
$CRON$);
```

Every day or two, run:

```sql
select day, status, reason, count(*) from notify_log
where day > current_date - 7 group by 1,2,3 order by 1 desc, 4 desc;
```

**What you're tuning:** `worthSending()` in `digest-build/index.ts`. Current bar
is a level, a zone, a territory change, a badge rank, or 250 kills / 15 minutes
played.

- Mostly `nothing_happened` → the bar is too high, this feature will do nothing.
- Nearly everyone qualifying every day → too low; you'll be mailing people
  receipts and they'll mute you.

Aim for something like **half to two-thirds** of active players qualifying on a
given day. Adjust, redeploy, keep watching. Do not skip this — it's the
difference between a feature players like and one they filter.

---

## STAGE 6 · Sender domain — 20 min setup, then wait for DNS

1. **resend.com** ▸ sign up ▸ **Domains** ▸ Add domain → `mail.lootfleet.com`
2. Resend gives you three records. Add all of them at your DNS host:
   - **SPF** — TXT on `mail`
   - **DKIM** — TXT (long key)
   - **DMARC** — TXT on `_dmarc.mail`, start at `p=none` so you can watch reports
     without mail being rejected while you learn
3. Wait for all three to show **Verified** in Resend (minutes to a few hours)
4. **API Keys** ▸ create one ▸ copy it

Do not proceed on a partially-verified domain. Unauthenticated bulk mail goes
straight to spam, and a domain that starts badly stays bad.

---

## STAGE 7 · Go live — 30 min, then a slow week

**7a. Yourself only.** Set secrets:

```
RESEND_API_KEY = re_...
SEND_LIVE      = true
MAIL_FROM      = Loot Fleet <brief@mail.lootfleet.com>
```

Then, with only your own account opted in:

```bash
curl -X POST \
  "https://emldvvlaanyivpmxyylr.supabase.co/functions/v1/digest-build?force=1&user=<YOUR-UUID>" \
  -H "Authorization: Bearer <SERVICE-ROLE-KEY>"
```

Check the real email in Gmail **and** one other client. Verify: it lands in the
inbox not spam, the unsubscribe link works, the "Resume command" button opens
the game, and Gmail shows its native one-click unsubscribe control.

**7b. Announce and open it up.** The toggle is already live for everyone — nobody
gets mail until they turn it on, so there's no accidental blast. Mention it
in-game or in a patch note so people know it exists.

**7c. Warm up.** A brand-new domain sending thousands on day one looks exactly
like a compromised account. First week, keep it small; if you have a large
opted-in list, cap the batch (`p_limit` in `notify_due`) and raise it daily.

---

## Monitoring

```sql
-- daily health
select day, status, count(*) from notify_log
where day > current_date - 14 group by 1,2 order by 1 desc;

-- anything the provider rejected
select reason, count(*) from notify_log
where status in ('failed','bounced') and day > current_date - 7 group by 1;

-- opt-in trend
select count(*) filter (where email_ok) as on, count(*) as total from notify_prefs;
```

Watch in Resend: **bounce rate under 2%**, **complaint rate under 0.1%**. Cross
0.3% complaints and Gmail starts throttling you. Bounces and complaints should
be written into `notify_suppress` — wire the Resend webhook to do that once
you're past launch week.

---

## Rollback

| Situation | Action |
|---|---|
| Something looks wrong in a send | `SEND_LIVE=false` — stops instantly, logging continues |
| Stop everything | `select cron.unschedule('lf-digest');` |
| One player complains | `insert into notify_suppress (addr, reason) values ('them@x.com','manual');` |

---

## Still outstanding

- **Content.** `render()` and `subjectFor()` are placeholders — plain enough to
  verify the pipe, not what you'd want players receiving. That's the next
  conversation, and it's worth having before 7b.
- **Resend webhook → `notify_suppress`** for automatic bounce/complaint handling.
- **`/privacy.html`** needs a line on what's sent, how often, and how to stop it.
- **`notify_events`** is created but nothing writes to it yet — the "while you
  were away" section stays empty until war reports in `mail.js` also insert here.
