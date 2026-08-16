# XP CHANGES — build 604

Plain-language copy you can paste into Discord or a patch note.
Nothing here is jargon; it is written to be read once and understood.

---

## The short version (post this)

**⚡ XP REBALANCE — how your XP rate is worked out has changed**

Your XP rate is now one simple sum:

> **100% to start · +400% if you have Pro · + all your bonuses added together**

That's it. Everything adds. Nothing multiplies anything else.

**The bug we fixed:** Pro used to *multiply* every bonus you owned. If you had
Pro and a +100% bonus, the game gave you +500%, not +100%. That's why people
were smashing through the 1000% ceiling and then getting nothing at all for the
next perk, the next VIP level, the next Kaevith hull. Every point past the
ceiling was being thrown in the bin.

Now Pro is a flat **+400%** — which is still exactly the **5× XP** it has always
been sold as (100 + 400 = 500%). What it no longer does is quietly quintuple
everything else you own.

**We also lowered XP bonuses across the whole game** — Neural Uplink, the Kaevith
hulls, Nanocores, Combat Computer and the Pilot Tree XP node all give less than
they did. The ceiling was too easy to reach, so we lowered the walls instead of
raising the roof.

**The ceiling:** 1000%. It is now exactly *base + Pro + every bonus maxed*, so
nothing you earn is ever wasted. If you are at the ceiling, you genuinely have
everything.

---

## The 6-year-old version

Think of your XP like **filling a bucket**.

- Everyone starts with **1 cup** of XP. That's normal speed.
- If you have **Pro**, you get **4 extra cups**. So you have 5 cups. That's the
  "5× XP" Pro has always promised.
- Every bonus you earn — perks, VIP, alien ships, nanocores — adds **more cups**.
- You can add up to **5 more cups** from bonuses.
- The bucket holds **10 cups**, and that's the most it will ever hold.

**What was broken:** Pro wasn't giving you 4 extra cups. Pro was making every
*other* cup 5 times bigger. So one small bonus turned into five big ones, your
bucket overflowed instantly, and everything you earned after that spilled on
the floor and did nothing.

Now every cup is just a cup. You add them up. The bucket fills the way you'd
expect.

---

## The exact formula (for anyone who asks)

```
XP rate % = 100                        (base — every pilot)
          + 400                        (only if you have Pro)
          + all other bonuses added    (capped at +500)

Total is capped at 1000%.
```

Because 100 + 400 + 500 = 1000, the cap is precisely "base, plus Pro, plus every
bonus in the game maxed out". You can never earn a bonus that does nothing.

| Who you are | Your XP rate |
|---|---|
| New pilot, no bonuses | 100% |
| No Pro, halfway built | ~350% |
| No Pro, everything maxed | 600% |
| Pro, no bonuses | 500% |
| Pro, halfway built | ~750% |
| Pro, everything maxed | 1000% (the ceiling) |

---

## What each source gives now

| Source | Was | Now |
|---|---|---|
| Neural Uplink (per rank) | +8% | **+5%** (+125% at rank 25) |
| Kaevith hulls (all five) | +250% | **+160%** (8/16/28/44/64) |
| Nanocore XP buff | +3–10% | **+2–6%** |
| Combat Computer (per step) | +0.5% | **+0.35%** |
| Pilot Tree XP node | +4–8% | **+3–5%** |
| VIP (level 15) | +60% | +60% (unchanged) |
| LootFleet Pro | ×5 on everything | **+400 flat** (still 5× at base) |

VIP was left alone — it is a loyalty ladder, not a stacking exploit.

---

## Questions you'll get

**"Did my XP go down?"**
If you had Pro and a lot of bonuses: yes, and it was supposed to. Your bonuses
were being multiplied by five. If you had no Pro and few bonuses, you will
barely notice.

**"Is Pro worse now?"**
Pro is still 5× XP at base — 500% instead of 100% — exactly as advertised. It
just no longer multiplies your other bonuses on top.

**"I'm at 1000%. Should I stop buying XP perks?"**
Yes, and now the game tells you: the XP pill shows when you are at the ceiling.
Before this change you could be 500% past it without any warning.

**"Why cut the bonuses too?"**
Because the ceiling was reachable in a few days. A ceiling you hit early is just
a wall. Lower bonuses mean the climb to 1000% is a real, long-term goal.
