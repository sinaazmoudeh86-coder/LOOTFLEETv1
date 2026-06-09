# Loot Fleet — Turn on TRUE Turf War (cross-account PvP)

This makes galaxy tiles a **real, shared battleground**: every signed-in account
fights over the same 60 tiles, captures stream live to everyone, owner names show
on tiles, and a server rule enforces the 15-minute protected window. Simulated
rivals only fill tiles no real player holds — so the map is contested *and* never
empty.

Your Supabase project is already connected (`js/config.public.js`) and the client
code (`js/territory.js`) is already wired into the game. You only need to run one
SQL file and redeploy.

---

## Step 1 — Run the turf-war SQL (the one required step)
1. Open your **Supabase dashboard** → your project (`emldvvlaanyivpmxyylr`).
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `supabase/territory.sql` from this project, copy **all** of it, paste, and
   click **Run**.

This creates:
- a shared, world-readable **`territory`** table (who owns each tile),
- a server-authoritative **`claim_tile()`** function (stamps the caller's real
  account id — owners can't be spoofed — and enforces the 15-min cooldown),
- **Realtime** streaming so captures appear on everyone's map instantly.

> Safe to re-run. If you ever want to wipe the map: `delete from public.territory;`

## Step 2 — Confirm Realtime is on
The SQL already adds the table to Realtime. To verify: **Database → Replication**
(or **Realtime**) → make sure **`territory`** is in the `supabase_realtime`
publication. If it isn't, run just the last `do $$ ... add table public.territory`
block from the SQL again.

## Step 3 — Deploy the updated game
Ship the current folder to your Vercel project (git push, `vercel --prod`, or
drag-and-drop). Make sure these updated files go out:
`game.html`, `js/territory.js`, `js/game.js`, `js/ui.js`, `js/config.js`,
`css/*`, and `sw.js` (cache is bumped to **v19** so clients pull fresh code).

After deploy, players should **hard-refresh once** (or reopen the installed app)
to clear the old service-worker cache.

## Step 4 — Players must LOG IN (not guest)
True turf war only switches on for accounts signed into Supabase
(**Create account / Log In** — email or social). **Guest** play has no shared
identity, so guests stay on the local simulation only. If you want everyone in the
war, nudge players to register (or gate the galaxy behind login).

## Step 5 — Verify with two accounts
1. **Account A** (browser 1): open the galaxy, capture a neutral tile.
2. **Account B** (browser 2 / phone): the same tile now shows **A's name**.
   Capture a neutral tile, or attack one of A's (starts a 15-min region cooldown).
3. Back on **A**: the change appears **live** and A gets a
   "⚔ B captured your tile" toast.

That's it — the zones are now a real cross-account turf war.

---

## How it behaves (so you can explain it)
- **Real owners win:** a real player's claim overrides any simulated rival on that
  tile. Simulated rivals only ever occupy tiles no real player holds.
- **Owner names** show on every tile; the **live feed** lists recent captures.
- **15-min protected window** per tile after a capture (enforced in `claim_tile`,
  not the browser).
- **Offline catch-up:** the map reloads the true shared state every time a player
  opens the game.

## Known limitation (read before competitive stakes)
Game logic still runs in the **browser**, so a determined user could call
`claim_tile` for a tile they didn't earn. That's fine for a fun, social turf war.
Before you attach real rewards/competition, add server-side validation (a Supabase
Edge Function that checks the player actually cleared the siege) — see
`LAUNCH.md` roadmap item **X1**.
