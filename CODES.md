# LOOTFLEET — coupon codes

**Do not ship this file.** It lives in the project root only. The release
procedure copies `js/`, `css/`, `guides/`, `supabase/` and the html files — a
root `.md` never reaches the deploy folder. Keep it that way.

Codes are entered in ⚙ **Settings ▸ Coupon code**. `js/redeem.js` stores only
the SHA-256 of each code, so plaintext can never be scraped from the client.
Input is uppercased and stripped to `[A-Z0-9]` before hashing, so dashes,
spaces and case do not matter — `lf unlimited everything` works.

## The codes

| Code | Reward | Repeatable |
|---|---|---|
| `LF-UNLIMITED-EVERYTHING` | **Unlimited mode.** Every top-bar currency permanently topped up. | yes |
| `LF-FULL-FLEET-ARMADA` | Every hull in the game unlocked. Re-entering syncs any hull added since. | yes |
| `LF-CURRENCY-100B-DROP` | +100B gold, fuel, ore, plasma and LootCoins. | no |
| `LF-LEVEL-100-PROMOTE` | Account promoted to Level 100. | no |
| `LF-LEVEL-200-PROMOTE` | Account promoted to Level 200. | no |
| `LF-LEVEL-500-PROMOTE` | Account promoted to Level 500 — unlocks every gated system. | no |
| `LF-PRO-365-COMP` | LootFleet Pro, 365 days. Stacks onto an active sub. | yes |
| `LF-PRO-30-COMP` | LootFleet Pro, 30 days. Stacks onto an active sub. | yes |
| `LF-DISCORD-UNVEIL` | **+1,000 ◈ LootCoins.** Handout for the redesigned Discord server. One redemption per account. | no |
| `LF-TOUR-BETA-ACCESS` | **Tour of Duty beta access.** Reveals the season pass, which ships hidden from every player. Admin/QA only. | yes |

Non-repeatable codes are one redemption per account (the hash is logged in the
save and syncs with the cloud).

## What UNLIMITED does

Sets `state.unlimited = 1` and fills **gold, LootCoins, Fuel, Ore, Plasma,
Dread Cores** and **Prism ingots** (once Prism is unlocked) to `1e15`. A 4-second
watchdog in `redeem.js` re-fills anything that drops below `1e14`, so nothing can
be spent down — this is a sustained state, not a one-off grant.

`1e15`, not `Infinity`, on purpose: `Infinity` does not survive `JSON.stringify`
(it saves as `null`), breaks `formatNum`, and the engine's own non-finite guard
in `computeStats()` would rewrite it to `1`. `1e15` is an order of magnitude
below `MAX_SAFE_INTEGER`, so it adds, subtracts and formats normally.

The flag is in `ASC_KEEP`, so the mode survives Pilot Ascension.

## Legacy codes

Seven hashes in `redeem.js` are marked LEGACY. Their plaintext was never written
down anywhere and **cannot be recovered from the hashes** — that is the point of
hashing them. They are left in the table so any code already handed to a player
keeps working. The documented set above replaces them for anything issued from
build 517 onward.

## Adding a code

1. Pick a plaintext, normalise it: uppercase, strip everything but `A-Z0-9`
   (must be at least 10 characters after stripping).
2. Hash it: `echo -n "LFYOURCODEHERE" | shasum -a 256`
3. Add `'<hash>': '<rewardId>'` to `HASH` and the reward to `REWARDS`.
4. Record the plaintext in the table above.
5. Bump `js/redeem.js?v=` in `game.html`, plus the four build stamps.

## Hidden features

Tour of Duty (the season pass) is BUILT AND SHIPPED but dark: the Command card
**LAUNCHED at build 659 — the gate is gone.** Tour of Duty is on for everyone
from Level 1. `LF-TOUR-BETA-ACCESS` still redeems but is a harmless no-op.

Season progress (xp, levels, claims, paid tracks) survives Pilot Ascension
(ASC_KEEP) and cross-device merges (unioned in account.js).

The flag is in `ASC_KEEP` (survives ascension) and is unioned one-way in
`mergeSaves` (a device that has access never loses it to one that has not).
