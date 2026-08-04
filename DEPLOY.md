# Loot Fleet — deploy v214 · build 420

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v213. Service worker cache is `lootfleet-v420`.

---

## Step 1 — run the SQL. Do this FIRST.

Supabase → **SQL Editor** → **New query** → paste **`supabase/lb-onefunction.sql`** → **Run**.

This is not optional and it is not a nice-to-have. Measured against your live
database today, `lb_upsert` exists more than once:

| Call shape | Result today |
|---|---|
| 6 args (stale cached clients) | `Could not choose the best candidate function` |
| 7 args (current client) | accepted |
| 13 args (the six Ranks ladders) | `Could not find the function` |

So any player whose browser is still serving an older cached build **can never
publish a leaderboard row again**, and the Territory / Hangar / Missions /
Badges ladders have been sorting on columns nothing writes.

**Do not run `ranks-ladders.sql`.** Its signature defaults `p_asc`, so adding it
alongside the current function would make the 7-arg path ambiguous too — the one
path that still works. `lb-onefunction.sql` drops every overload by catalogue
lookup and creates exactly one function whose every parameter after `p_name`
defaults, so all three call shapes bind to it.

It also re-seeds anyone who is active but unlisted. Safe to re-run.

**Verify** — this must return exactly one row:

```sql
select oid::regprocedure from pg_proc
 where proname = 'lb_upsert' and pronamespace = 'public'::regnamespace;
```

And this must return zero rows:

```sql
select a.user_id from (
  select owner_id as user_id from public.territory where owner_id is not null
  union select user_id from public.sdread_scores where user_id is not null
) a left join public.leaderboard l using (user_id) where l.user_id is null;
```

## Step 2 — push the site

Folder contents to the repo root, commit, let Vercel build.

## Step 3 — hard-reload once

`Cmd/Ctrl + Shift + R`. The service worker cache name changed, so the old bundle
is evicted on first load.

---

## What changed

### Ranks — the real reason players were missing

Covered above. Falcor was never a session-lock problem; the publish RPC itself
was unresolvable for a whole class of clients.

### Google sign-in was renaming characters

Google rewrites `user_metadata.name` from the Google profile on **every** OAuth
sign-in, so the custom name `setName()` wrote there was overwritten each login.
That is why a renamed commander reverted to their email prefix after a logout,
and why `jonathangregg103`, `aytris.tekis` and `nathannorth2005` are on your
board right now.

A rename now writes three places: `state.pilotName` in the save, an app-owned
`lf_name` key in user metadata that no provider touches, and the session. On
login the **save wins** — the Google profile name is only ever a first-login
default. The board republishes immediately on rename rather than on the next
90-second heartbeat.

Existing corrupted names fix themselves the next time each player renames.

### Skill tree — Tempo, Focus and Resolve are real stats now

All three were renames of a node that already existed elsewhere in the tree:

| Node | Was | Now |
|---|---|---|
| Tempo → **Standoff** | `atkSpeedPct` — a copy of Offense's Fire Rate | `rangePct` — weapon range |
| Focus → **Repair Loop** | `critChance` — a copy of Offense's Crit Chance | `regen` — hull repair per second |
| **Resolve** | `critChance`, in the *defensive* branch | `dmgReduce` — damage reduction |

All three target engine mods that already existed but were never wired to the
skill tree. Ceilings for a fully-maxed branch: Tactics **+95% range** and
**+2.4%/s repair**; Defense **+24% damage reduction**. `regen` and `dmgReduce`
are rank-capped the same way life steal and multi-shot already were, so a full
branch cannot hand out immortality.

**Invested points are not lost.** Node IDs did not change, so existing ranks
carry over onto the new stat. No refund or migration needed.

### Skill tab layout

Nodes used to print only `+7% Damage per rank` — a cost with no consequence.
Each node now carries a plain-language line about what the stat does, a live
**now → next** figure, and the per-rank value. The branch header states what the
branch is for and totals what your points have actually bought.

### Mobile

Command menu went to one column below 430px. Two 164px columns left about 95px
for the name after the icon, so every multi-word title broke to two lines and
the LIVE/TURF badges wrapped to a third.

Pilot tree's level-ceiling ladder went from four ~76px columns to two.

---

## Still open

Nothing blocking. One thing worth checking in the SQL editor:

```sql
select jobname, schedule, active from cron.job where jobname = 'lf-sim-tick';
```

No rows means simulated-pilot growth has only ever run when something triggered
it by hand, and it stops the day nobody does. `supabase/sim-growth.sql` schedules
it if you need it.
