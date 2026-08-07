# START HERE — deploy v214, in plain English

Three things to do, in this order. Budget 10 minutes.

---

## Part 1 — Update the database (5 minutes)

**Why:** right now some of your players physically cannot appear on the
leaderboard. The database has two conflicting copies of the same function and
the game doesn't know which to call, so it gives up. This fixes it.

1. Open **supabase.com** and sign in.
2. Click your **LOOTFLEET** project.
3. In the left sidebar, click **SQL Editor**.
4. Click the green **New query** button (top right).
5. On your computer, open the file `supabase/lb-onefunction.sql` from the folder
   you downloaded. Any text editor works — Notepad, TextEdit, VS Code.
6. Select all of it (`Ctrl+A` / `Cmd+A`), copy (`Ctrl+C` / `Cmd+C`).
7. Click into the big empty box in Supabase and paste (`Ctrl+V` / `Cmd+V`).
8. Click **Run** (bottom right, or `Ctrl+Enter`).
9. You want to see **Success. No rows returned.** at the bottom.

If you see a red error, stop and send me the exact message.

> **Do NOT run the file called `ranks-ladders.sql`.** It looks like it belongs
> with this one. It does not. Running it would break the leaderboard further.

### Check it worked

Still in the SQL Editor, clear the box, paste this, and Run:

```sql
select oid::regprocedure from pg_proc
 where proname = 'lb_upsert' and pronamespace = 'public'::regnamespace;
```

**You should get exactly ONE row back.** If you get two, the old copy came back
— tell me.

Then clear the box, paste this, and Run:

```sql
select count(*) from public.leaderboard;
```

Note the number. It was **21** before. It should now be higher — that's the
players who were invisible getting their rows back.

---

## Part 2 — Put the new game files live (3 minutes)

**Why:** the database fix alone isn't enough; the game files have the name fix,
the skill tree changes and the mobile fixes.

1. Unzip the `deploy-v214` folder you downloaded.
2. Open it. You'll see `game.html`, `index.html`, folders called `js`, `css`,
   `ships`, and so on.
3. Select **everything inside** that folder — not the folder itself, the
   contents.
4. Upload those to your GitHub repository, replacing what's there. Same way you
   did last time.
5. Commit. Vercel picks it up automatically and rebuilds — usually under a
   minute. You can watch it on vercel.com under **Deployments**.

---

## Part 3 — Force your browser to pick it up (30 seconds)

**Why:** browsers cache the game so it loads fast. Without this you'd keep
seeing the old version and think nothing changed.

1. Open the live game.
2. Press **`Ctrl + Shift + R`** (Windows) or **`Cmd + Shift + R`** (Mac).
3. On your phone: close the tab completely, then reopen it.

---

## How to tell it worked

- **Ranks tab** — more players listed than before.
- **Skills tab** — the Tactics branch shows **Standoff** and **Repair Loop**
  instead of Tempo and Focus, and every skill now explains what it does.
- **Command menu on your phone** — one card per row, no more titles breaking
  onto two or three lines.

---

## One optional thing

The fake AI players that keep the world populated may only be growing when
something pokes them by hand. To find out, run this in the SQL Editor:

```sql
select jobname, schedule, active from cron.job where jobname = 'lf-sim-tick';
```

- **You get a row back** — it's on a timer, nothing to do.
- **You get zero rows** — it isn't scheduled. Send me that and I'll walk you
  through turning it on. Not urgent.
