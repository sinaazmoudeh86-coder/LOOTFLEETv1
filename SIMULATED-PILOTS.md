# Simulated pilots — setup

Autonomous. Two SQL files, two cron lines, one seed command. No admin panel, no
client involvement, nothing to maintain.

## Install

Supabase ▸ SQL Editor, in order:

1. `supabase/simulated-pilots.sql` — roster, identity generation, personalities,
   progression bands, ascension, ranking guards
2. `supabase/simulated-pilots-behavior.sql` — territory, void, alliances,
   friends, events

Then schedule the two passes and seed the roster:

```sql
create extension if not exists pg_cron;
select cron.schedule('lf-sim-tick',   '7 * * * *',    $$ select sim_tick()   $$);
select cron.schedule('lf-sim-behave', '*/15 * * * *', $$ select sim_behave() $$);
select sim_spawn(20);   -- optional starter; the tick grows it from here
```

That's the whole deployment. From here it runs itself: population tracks the
live human count, pilots progress inside their own timezone play windows,
ascend when they hit their personality's target, contest tiles, form alliances,
send the occasional friend request and push event damage.

## Re-running the SQL

Both files are genuinely idempotent — every column added in a later revision is
re-declared with `add column if not exists`, because `create table if not exists`
is a no-op once the table exists. Without that, a new field would be missing on an
already-migrated database and `sim_tick()` would throw on it inside pg_cron, where
the exception is swallowed: the roster would freeze forever with nothing visibly
broken. Re-run both files after any update.

## Stop everything

```sql
update sim_config set enabled = false;
```

Instant and total — no ticks, no board rows, no garrisons. Set it back to `true`
to resume; nothing is lost.

## Players must never know

The whole point is a galaxy that feels populated, so **nothing in the UI marks a
simulated pilot**: no chip, no "(sim)" suffix, no profile disclosure. They sit on
the board, hold tiles and garrison spires exactly like humans, with the same
rank badges and the same combat maths.

`is_simulated` remains a protected INTERNAL column. It drives the fairness
guards, keeps sim activity out of human retention/revenue reporting, and makes
every action auditable — it is simply never rendered. `sim_config.mark_publicly`
defaults to `false`; if store policy or regulation ever requires a visible
designation, flip it and return the chip markup in `chip()` in
`js/sim-pilots.js`. Nothing else changes.

## What the client does

`js/sim-pilots.js` is read-only. It pulls the guarded board every two minutes
and hands rows to `leaderboard.js` in the identical shape a real account
publishes, so ranking, rendering and combat maths treat sims exactly like
humans. It also supplies deterministic tile defenders — the same tile always
draws the same pilot — and stamps a `SIM` chip on any profile a player inspects.

It cannot write to the roster. A client that could advance bots would be a cheat
vector, so progression lives entirely in the two server functions.

## Design decisions worth knowing

**Sims are not auth users.** Minting thousands of real accounts to hold NPC
state would pollute auth, session locks, save CAS, payments and every retention
number we report. They are rows in `sim_pilots`; bot status is the protected
`is_simulated` column, never inferred from a name.

**They ascend.** Each personality has an ascension target — Casual at Lv 125,
Aggressive/Explorer/Event at 250, Defensive at 300, Farmer at 500, Elite at
1000. On ascending they reset to Level 1, bank points, gain a permanent
multiplier (`asc_mult`, +0.18 per star, capped ×4) and keep a third of their
power — the legacy-ship head start. That compounding is what keeps veterans
leaderboard-competitive instead of drifting to the bottom, and their stars
render with the same rarity-coloured badge a player earns.

**Human territory is untouchable.** `sim_take_tile()` refuses any tile with an
`owner_id`, and sims never write one. Nobody logs in to find a bot took their
system overnight.

**The map seeds itself.** `public.territory` only gains rows when someone
claims a tile, so on a fresh database it is empty. `sim_pick_tile()` mints a
valid hex id in the client's own axial format (`q,r`, ring 1–25) and
`sim_take_tile()` inserts it — pilots range deeper as they level, so the
population spreads outward on its own.

**Growth is 5–15 pilots a day.** `sim_config.daily_spawn_min/max` sets the
budget; a new day rolls a fresh number in that range and the hourly tick spreads
it out, so pilots trickle in rather than a launch-day clump appearing. Retirement
is equally slow — at most two a day. Seeding 250 at once is possible but reads as
obviously artificial; letting it climb is more convincing and costs nothing.

**Humans are never pushed off the ranks page.** The ranks screen renders a fixed
number of rows, so a growing roster would quietly displace real players — the
exact opposite of the goal. Sims only fill the slots humans are not using, on top
of the top-10 (max 2) and top-100 (max 25) seat caps.

**3–5 rivals shadow the leader.** `sim_rivals()` pins a small pack to a fraction
of the strongest active human's power (0.94 → 0.72, so the nearest sits ~6% behind)
with ascension stars trailing by 0–2, hard-clamped so none can ever out-power or
out-ascend the person they're chasing. Because the anchor is the human's live
number they rise as the leader rises — the top player always feels pursued, never
overtaken. The pack re-pins every hourly tick and stands down entirely if there is
no human above 50k power to chase.

**They lose.** A failed attack costs territory and 6% of power. Bots that never
lose read as invincible and make the map feel pointless.

**Ranking guards are server-side.** `sim_board()` caps sim power just under the
top human row unless `allow_rank1`, and `max_top10` / `max_top100` limit how
many can occupy the visible board. A modified client cannot bypass either.

**Rewards never enter the economy.** `reward_eligible` is off, so a sim placing
well in an event does not consume a limited player prize.

**Harassment guard.** One sim may hit a given target at most once per 24 hours,
inside a fleet-score band, obeying every cooldown.

## Tuning, if you ever want to

Everything lives in one row:

```sql
update sim_config set target_population = 400, aggression = 1.3;
```

`sim_stats()` returns population by band and personality, total ascensions,
strongest sim, live human count and the recent action log if you want to look.

## Not built

Human-alliance membership is gated by `sim_alliance_optin` — a table with an
`allow` flag per alliance, defaulting to off, plus `allow_officer` which stays
off unless an owner explicitly grants it. The rows exist and the guard is
enforced; the in-game toggle for alliance owners is a UI task for whenever
alliance management gets its next pass.
