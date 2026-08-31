/* =============================================================================
   game.js — GrabAGun Idle Operator
   Movement-based combat engine: a walkable combat zone with a camera, fixed
   spawn nodes that repopulate 10s after a kill, ground-loot you run over to
   collect, auto-play autopilot, life-steal / multi-shot combat, a permadeath
   item-drop penalty, purchasable game-speed + offline AFK mode, and save/load.
   Exposes window.GAME for the UI layer.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG, E = window.ENTITIES, R = window.RENDER, I = window.ITEMS;
  const GX = window.GALAXYMAP;
  const SAVE_KEY = 'infinite-operator-save-v2';

  // tuning constants ----------------------------------------------------------
  const FEET = 7;                 // pixels per in-game foot
  const RESPAWN_SEC = 10;         // enemy respawn delay after a kill
  const RESPAWN_SPREAD = 5 * FEET;// respawn within 5 ft of the node
  const PICKUP_RADIUS = 26;       // how close to walk to collect loot
  const MAGNET_RADIUS = 620;      // LOOT MAGNET attraction range — drops fly to the player rather than the player to them
  const MAGNET_SPEED = 420;       // base px/s a magnetized drop travels (accelerates as it nears you)
  // DAMAGE REDUCTION CEILING — 20%, and it is the ONLY ceiling: entities.js
  // clamps to the same number, so no stack of nodes, cores or auras can read as
  // more than a fifth of incoming damage removed.
  const DR_CAP_PCT = 20;
  const FIRE_RANGE = 250;         // auto-fire engagement range
  const NODE_COUNT = 9;           // base spawn nodes per zone (scales up — see nodeCount)
  // Zone-scaled feel: deeper zones get a wider world, more spawns, and a more
  // zoomed-out camera (which also makes the player look smaller).
  function worldMul(zone) { return Math.min(3.4, 1.8 + zone * 0.05); }
  function zoomFor(zone) { return Math.max(0.5, 0.92 - zone * 0.012); }
  // ---- ONE MAP, EVERY DEVICE -------------------------------------------------
  // The arena used to be sized as "viewport x worldMul", so the world was as big as
  // the screen it was drawn on. Every gameplay distance in this file is in WORLD
  // PIXELS and fixed — fire range 250, loot magnet 620, spawn spreads, beacon rings
  // — so a phone got a world a third the width of a desktop one with the same
  // ranges laid over it: enemies spawned inside magnet range (loot arrived without
  // moving), the same 55 spawn nodes packed into a quarter of the area, and kills
  // per minute ran far higher than on desktop. It was not a look-and-feel
  // difference, it was a different game with a different farming rate.
  //
  // The world is now authored against ONE reference viewport and has the SAME AREA
  // on every device, laid out at the screen's own aspect ratio (so nothing is
  // letterboxed and portrait still reads as portrait). Zoom carries the difference
  // instead: a small screen eases out to show a workable slice, bounded so sprites
  // never shrink past legibility. Desktop is the reference, so desktop is unchanged.
  const REF_W = 1180, REF_H = 720;
  function fitWorld(zone) {
    const mul = worldMul(zone);
    const w = Math.max(1, rt.w || REF_W), h = Math.max(1, rt.h || REF_H);
    const area = REF_W * REF_H * mul * mul;
    const aspect = Math.min(2.6, Math.max(0.42, w / h));
    rt.worldW = Math.round(Math.sqrt(area * aspect));
    rt.worldH = Math.round(Math.sqrt(area / aspect));
    const lin = Math.sqrt((w * h) / (REF_W * REF_H));
    rt.zoom = zoomFor(zone) * Math.min(1, Math.max(0.62, Math.sqrt(lin)));
  }
  // Zone unlocking — you can reach at most 10 zones ahead of your pilot level, so
  // you can't skip into wildly over-level zones and farm insane loot. Still also
  // ZONE LOOKAHEAD — how far past your level the Grind Zone list unlocks.
  // Tightened 30% (powerleveling was too fast):
  // <100 → +35 · <200 → +28 · <300 → +14 · <400 → +7 · <500 → +4 · 500+ → +0
  function unlockCeil(level) {
    const ahead = level < 100 ? 35 : level < 200 ? 28 : level < 300 ? 14 : level < 400 ? 7 : level < 500 ? 4 : 0;
    return level + ahead;
  }
  // Inverse of unlockCeil: the LOWEST account level that unlocks zone d — which
  // is also the level the zone is BUILT for, and so the figure every difficulty
  // label in the game quotes. Lives in CONFIG.zoneCombatLevel so the gate and
  // the description are the same number by construction.
  function zoneReqLevel(d) { return C.zoneCombatLevel(d); }
  // Every 11th Grind Zone (11, 22, 33…) is a WAVE ZONE: 25 escalating waves of
  // extreme density ending in a boss (30% Super Boss). Classic free-play only.
  function isWaveZone(zone) { return zone > 0 && zone % 11 === 0; }
  // CITADEL SIEGE — ~10% of grind zones (every zone ending in 7; wave zones win
  // ties): push UP through waves of heavy garrison hulks, then raze the Void
  // Citadel at the top. Razed citadels rebuild for 15 minutes.
  function isCitadelZone(zone) { return zone > 0 && zone % 10 === 7 && !isWaveZone(zone); }
  function citadelCooldownLeft(zone) {
    const until = state.citadelCd && state.citadelCd[zone];
    return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  }
  // ---- ZONE BONUSES ----------------------------------------------------------
  // Every 30th zone (30,60,90…): SWARM ZONE — 20× mob density with relentless
  // near-instant respawns, so it plays as endless waves that never stop.
  // TRADE-OFF: swarm loot is junk — low drop rate, low quality. Swarms are for
  // kills/XP/gold volume, not gearing.
  // Every 25th (25,50,75…): 2× loot quality. Every 100th (100,200…): 5× loot
  // quality. Quality bonuses STACK multiplicatively.
  // SWARM ZONES REMOVED (Jul 2026): every zone now spawns at normal density
  // with normal loot. The helpers stay exported for compatibility but are
  // permanently off.
  function densityMult(zone) { return 1; }
  // SWARM ZONE — removed; always false
  function isSwarmZone(zone) { return false; }
  // swarm loot penalties: 25% of normal drop rate, and drops roll 2 rarity
  // tiers lower (min common)
  const SWARM_DROP_MULT = 0.25, SWARM_RARITY_PENALTY = 2;
  // Every 25th (25,50,75…): bonus loot quality — capped ×2 TOTAL (zones no
  // longer stack past ×2; zone 100 is still ×2).
  function qualityMult(zone) { return Math.min(2, (zone > 0 && zone % 25 === 0 ? 2 : 1) * (zone > 0 && zone % 100 === 0 ? 5 : 1)); }
  function zoneBonuses(zone) { const d = densityMult(zone), q = qualityMult(zone); return { density: d, quality: q, prismatic: d > 1 || q > 1 }; }
  // Loot-quality multiplier = roll the rarity that many times, keep the best.
  function rollRarityBoosted(zone, mult) { let best = I.rollRarity(zone); for (let i = 1; i < mult; i++) { const r = I.rollRarity(zone); if (r > best) best = r; } return best; }
  function nodeCount(zone) { const base = NODE_COUNT + Math.floor(zone * 0.7); return Math.min(densityMult(zone) > 1 ? 100 : 30, Math.round(base * densityMult(zone))); }

  // --------------------------------------------------------------------------
  // STATE (persisted)
  // --------------------------------------------------------------------------
  const state = {
    level: 1, xp: 0, gold: 0,
    currentDungeon: 1, highestUnlocked: 1,
    // ---- GALAXY MAP ----
    currentSystem: null,                  // tile id you're deployed to (null = hangar)
    ownedSystems: {},                     // tiles you own: { tileId: true }
    rivalTiles: {},                       // simulated rival owners: { tileId: name }
    tileCd: {},                           // per-tile contest cooldowns (15 min · 24 h citadels)
    resources: { fuel: 80, iron: 0, plasma: 0 },
    shipLevels: {},                       // per-ship hull upgrade level (1..20)
    lastResTick: Date.now(),              // for per-hour resource accrual
    ship: 'frigate',        // active hull
    ownedShips: { frigate: true },
    shipKills: { frigate: 0 }, // kills scored while piloting each hull (unlock gate)
    blueprints: {},         // hull blueprints recovered from zone bosses: { shipKey: true }
    drones: 0,              // drones currently loaded into the active carrier's bays
    droneBays: {},          // PER-HULL bay contents: { shipKey: droneCount } — see clampDrones()
    fittings: {},           // per-ship saved gear: { shipKey: { slotKey: item } }
    equipped: { bow: null, arrows: null, armor: null, boots: null, gloves: null, amulet: null, bow2: null, arrows2: null },
    inventory: [],
    totalKills: 0, highestDungeonReached: 1, playTime: 0, itemsFound: 0, itemsLost: 0,
    xenDry: 0,              // Kaevith Incursion — invaded clears since the last hull earned
    purchases: {},          // { speed2:true, speed4:true, speed10:true, afk:true }
    gameSpeed: 1,
    skillPoints: 0,         // unspent level points
    skills: {},             // { nodeId: ranks }
    shop: null,             // { window, items[], bought[] } rotating gold shop
    sellTier: 1,            // auto-sell: sell items at/below this rarity tier
    keepUpgrades: true,     // auto-sell: never sell a slot upgrade
    autoEquipAlways: true,  // continuously equip best gear as it's collected
    auto: true,             // autopilot on by default (idle game)
    deathExplained: false,
    startWeek: null,        // heat assignment (week index when account created)
    lastSave: Date.now(),
  };
  // PRISTINE DEFAULTS — snapshotted before any save is loaded. Pilot Ascension
  // rebuilds the account from this, which is far safer than enumerating every
  // field to zero: anything a module bolted on is wiped unless it is explicitly
  // on the KEEP list below.
  const DEFAULTS = JSON.parse(JSON.stringify(state));
  // Everything that survives an ascension: money the player SPENT REAL CASH on,
  // lifetime recognition, the social graph, and the ascension record itself.
  const ASC_KEEP = [
    'pilotName',                                               // a rename is identity, not progress
    'pasc',                                                    // stars, points, perks, history
    // FIGHTER ASCENSION — four permanent wing doctrines bought at ★10. It is the
    // WING's progression, not a hull's and not the run's: the craft that fly it
    // come out of whatever bays are fitted at the time, so a reset that reseats
    // the pilot in a bayless frigate must not touch it. Same class as `pasc`.
    'fasc',
    // PAID ENTITLEMENTS — anything real money or LootCoins bought is permanent.
    // `purchases` carries the one-time premium battle-speed unlock (speed4lc,
    // which is 2× since build 712 — the sku is a receipt, not a label) and
    // `proUntil` carries the LootFleet Pro subscription window, so the Pro badge
    // and every PRO_PERKS benefit survive an ascension untouched. `secretSpeed`
    // is the 10× tier from the Mothership easter egg — it was MISSING here, so
    // every ascension revoked it, sanitizeSave() then demoted gameSpeed off 10×,
    // and the pill vanished from the HUD leaving the top ordinary tier as the
    // ceiling. It is a one-time unlock like the other two: it survives.
    'purchases', 'credits', 'proUntil', 'vipPts', 'iap', 'payments', 'redeemedCodes', 'secretSpeed',
    // ONE-TIME OFFERS. discordJoin records the 1,000-LC join reward; keeping it
    // here means an ascension (which wipes the fleet to nothing) cannot re-arm
    // the offer and let the same account collect it twice.
    'discordJoin',
    // AUTO BEACON's ARMED FLAG. The RECEIPT is in `purchases` (already here), but
    // the toggle is separate state — and without it an ascension would silently
    // switch a 25,000-LootCoin feature off. It also reads true-unless-false, so
    // even a save that predates the key arms itself; this line is what preserves
    // a deliberate OFF.
    'autoBeacon',
    // GOLD AND GALAXY RESOURCES SURVIVE ASCENSION (Aug 2026). Both used to be
    // zeroed, and both zeroings had stopped making sense:
    //   • GALAXY RESOURCES are produced by TERRITORY, and territory explicitly
    //     survives ("the fleet resets, the map you conquered does not"). Wiping
    //     the output of infrastructure the pilot keeps is the same contradiction
    //     the Moon Colony block above was written to fix — and with a large
    //     empire the wipe was undone by a single offline cycle anyway, so it
    //     punished small holders and no one else.
    //   • GOLD buys HULL UPGRADE LEVELS, which are kept in full. Zeroing the
    //     wallet while keeping everything it bought taxed nothing but the
    //     player's timing — spend before you ascend, or lose it.
    // The ascension ledger in pilot-ascension.js states this; keep the two in
    // step. `lastResTick` rides across with them so the first post-ascension
    // load cannot re-pay income that was already settled.
    'gold', 'resources', 'lastResTick',
    // MOON COLONY SURVIVES ASCENSION (Aug 2026). The colony is infrastructure
    // BUILT on the moons, not the pilot's run — mines, storage and defences that
    // keep producing while the account is offline. Wiping it made ascending cost
    // days of construction that had nothing to do with the fleet being reset,
    // and it silently zeroed the passive income the Hangar now advertises.
    // The fleet resets. The buildings you put up do not.
    'moon',
    // FIRST-RUN TUTORIAL. Ascension resets level to 1, which is exactly the
    // signal onboard.js uses to recognise a new player — without this a veteran
    // would be walked through "spend gold on damage" after every ascension.
    'onboard',
    'cosmetics', 'shipAura',
    'achieve', 'achv', 'achClaimed', 'badgeRanks', 'lifeStats',   // lifetime badges (achievements.js keys off state.achieve)
    // CAREER COUNTERS — the metrics lifetime badge chains measure. These record
    // what the pilot has DONE, not power they hold, so they carry across every
    // ascension. Without them a chain regresses to zero: claimed rank is a floor
    // so there is no double payout, but every progress bar would lie.
    'totalKills', 'playTime', 'itemsFound', 'itemsLost', 'lifetimeLooted', 'lifetimeMissions', 'stats',
    'friends', 'alliance', 'allianceId', 'mail', 'social',
    // SEASON 1: VOIDMAW SURVIVES ASCENSION. `sdread` holds the whole event
    // record — Event Coins, best stage, daily/season history, the vmGranted
    // assembly flag and claim queue — and `shipParts` holds the ❖ Voidmaw Parts
    // counting toward the 150-part hull. A live event runs on its own season
    // clock, not the pilot's run, so ascending mid-season must not cost a player
    // their standing in it.
    'sdread', 'season', 'shipParts',
    // TOUR OF DUTY SURVIVES ASCENSION. The season pass runs on the SEASON clock,
    // not the pilot's run: its levels are bought with real money (Admiralty) and
    // earned from daily/weekly boards that keep their own reset timers. Wiping it
    // on ascension zeroed a paid track mid-season and reset the 125-level ladder
    // — an ascension must cost the pilot's run, never the season they paid for.
    // Its own claim map rides across too, so nothing can be claimed twice.
    'tour',
    // …AND THE KEY THAT LETS YOU SEE IT. `tourBeta` is the admin access switch
    // for the unlaunched season pass (js/redeem.js). It is an entitlement, not
    // run progress — an ascension must not revoke a tester's access mid-test.
    'tourBeta',
    // SPACE CARGO DEFENSE SURVIVES ASCENSION. The event is GATED on ★3, so it
    // only exists for ascended pilots — wiping it would reset the lifetime record
    // (deliveries, best condition, Eternums recovered) on exactly the action that
    // qualifies you for it, and hand back today's spent runs for free.
    'cargo',
    // A LOCKOUT CLOCK IS NOT RUN PROGRESS (build 712). `dreadLock` is the
    // one-hunt-per-tier-per-week record, `dreadProFree` the Pro extra attempt and
    // `dreadRespawn` the count of paid respawns. None of the three were listed, so
    // pilotAscend() wiped them and every hunt tier came back unlocked — max the
    // level, run the whole tier ladder, ascend, run it again. `cargo` directly
    // above was protected for exactly this reason; the hunt was simply missed.
    // The pilot's RUN resets. The calendar does not.
    'dreadLock', 'dreadProFree', 'dreadRespawn',
    // THE MECH FOUNDRY SURVIVES ASCENSION. `mechCores` is a spendable wallet and
    // `mech` is the lifetime record (runs, deepest tier, kills). Both ride across
    // for the same reason `cargo` and the hunt's clocks do: the Foundry is endgame
    // content gated at Level 120+, so wiping it on the one action that resets you
    // to Level 1 would delete a grind the pilot can no longer even reach, and hand
    // back the blueprint chase they had already finished. The hulls themselves are
    // safe already — `blueprints` and `ownedShips` are entitlements and are kept.
    'mechCores', 'mech',
    // FLEET EXPLORATION SURVIVES ASCENSION (build 727). `expo` holds the LIFETIME
    // record the Exploration ladder is scored on (`log.done` expeditions flown,
    // `log.best` strongest wing ever sent), every hull's survey rank, and any run
    // still in flight. It was missing here, so pilotAscend() deleted it and ex()
    // rebuilt it at done:0 — the board then reported expeditions flown SINCE THE
    // LAST ASCENSION under a caption that claims a career total. That is the
    // "I've flown a lot more than 12" report, and it broke two separate rules:
    // a lifetime counter is not run progress (`totalKills` and `lifetimeMissions`
    // are kept for exactly this reason), and an expedition is up to 24 REAL HOURS
    // of wall clock the pilot has already paid fuel for — a calendar commitment,
    // not a fleet the reset is entitled to take. Collecting a pre-ascension run
    // afterwards is safe: restoreEscorts() no-ops on the disbanded wing.
    'expo',
    // COMMANDERS SURVIVE ASCENSION. The collection is not the pilot's run — a card
    // pulled at 1-in-24,000 cannot be re-earned on demand, and the chase is gated
    // at ★5 so it only exists for pilots who ascend. The fleet resets; the album
    // does not.
    'cmdr',
    // NANOCORES — cores, unlocked slots and rolled buffs all survive, exactly
    // like the Prism Ingots they were bought with.
    'nano',
    'startWeek', 'name', 'sellTier', 'keepUpgrades', 'autoEquipAlways', 'auto', 'gameSpeed',
    // LOOT FILTERS ARE SETTINGS, NOT PROGRESS — sell-on-pickup and the pickup
    // floor used to silently reset to defaults on every ascension.
    'autoSellTier', 'pickupFilter',
    'deathExplained', 'joystick', 'fs',
    // ONBOARDING IS A CAREER FACT, NOT RUN PROGRESS. An ascended pilot has
    // already been taught the game; wiping these replayed the whole tutorial
    // (and the "name your commander" gate) from scratch on every ascension.
    'coach', 'nameSet',
    // MISSION BOARDS run on their own daily / weekly / monthly clocks, not on
    // the pilot's run. Wiping them mid-cycle threw away a half-finished weekly
    // (and its tier) for anyone who ascended on, say, a Thursday.
    'missions', 'missionsW', 'missionsM',
    // TERRITORY SURVIVES ASCENSION (Aug 2026). Galaxy tiles, Void spires and the
    // Citadels on them are held on the SERVER against the ACCOUNT — `territory`
    // rows keyed by owner_id, not by fleet. Wiping them locally didn't release
    // anything server-side, it just desynced the client until the next
    // republish, and it gave away holds the pilot never lost in a fight.
    // The fleet resets. The map you conquered does not.
    'ownedSystems', 'citadels', 'rivalCitadels', 'tileCd',
    // …AND THE TWO TILE CLOCKS THAT GO WITH THEM (build 736). `tileAband` is the
    // 24-hour bar on re-taking a system you walked away from; `tileFree` is the
    // neutral grace on the tile itself. Both were missed, and the doctrine is
    // flat: ANY LOCKOUT CLOCK GOES IN ASC_KEEP THE DAY IT SHIPS. Territory
    // survives an ascension (four lines above) but the abandon record did not, so
    // ascending after releasing a tile threw away the guard abandonLockLeft()
    // exists to provide — the next convergence pull re-adopted a system the pilot
    // deliberately gave up, and the loss path mailed a war report for it. Both are
    // already unioned in mergeSaves(); this is the other half.
    // Keeping a clock can only ever WITHHOLD a re-claim the pilot chose to give
    // up. It cannot cost anyone a holding.
    'tileAband', 'tileFree',
    // …AND THE MIGRATION FLAG THAT PROTECTS THEM. `galaxyVer` is what tells the
    // loader the save has already moved to the v3 hex grid. Without it here, a
    // post-ascension state arrives with galaxyVer undefined, the v3 migration
    // sees `!== 3`, and its first act is `state.ownedSystems = {}` — silently
    // undoing the four lines above and wiping every galaxy tile and Void spire
    // the pilot held. Keeping the four keys was necessary but NOT sufficient.
    'galaxyVer',
    // Razed natural citadels stay razed. These are tiles the pilot fought to
    // flatten; regrowing their NPC fortress on ascension would re-lock ground
    // they still own.
    'razedCitadels',
    // HOME CITADEL and PRISM are INFRASTRUCTURE, not run progress — the same
    // argument as the Moon Colony. The Home Citadel is described in-game as a
    // "permanent AFK empire": pads, towers and defences built up over days that
    // keep earning while the account is offline. Prism holds mined ingots and
    // the Prism Cores forged from them, which are permanent fleet upgrades.
    // Neither is bought with the pilot's level, so neither goes back to zero
    // when the pilot does.
    'homecit', 'prism', 'prismFleet',
    // THE PILOT TREE SURVIVES ASCENSION (Aug 2026). Its nodes are not bought
    // with pilot level — they are bought with ◇ Dread Cores from a WEEKLY raid,
    // one attempt per tier per week. A built tree is months of real calendar
    // time, and no amount of play shortens re-earning it, so wiping it made
    // every ascension a net LOSS of the only account-wide buff in the game and
    // taught players to never ascend. Unspent cores ride across with it.
    'pilot', 'dreadCores',
    // UNLIMITED MODE (coupon) is an account entitlement, not run progress — the
    // watchdog in redeem.js keys off this flag, so wiping it here would quietly
    // switch the mode off on the next ascension.
    'unlimited',
    // ---- SYSTEMS THAT HAVE A mergeSaves() UNION BLOCK BUT WERE MISSING HERE.
    // A union block in account.js is a written statement that losing this value
    // is unrecoverable — that is the whole reason a system earns one. Every key
    // below had that block and was still absent from this list, so pilotAscend()
    // deleted it and the merge only ever got it back by accident: on the next
    // login, from a cloud copy that had not been overwritten yet. A player on one
    // device, or one who saves twice before relogging, lost it for good.
    //
    // ADDING A KEY HERE ONLY EVER PRESERVES MORE. It cannot delete, reset or
    // revoke anything, which is what makes this the safe half of the fix.
    //
    //   invSlotsBought  BOUGHT WITH REAL CURRENCY. "Anything real money or
    //                   LootCoins bought is permanent" is the first rule of this
    //                   list, and inventory slots were the one paid thing not on
    //                   it. An ascension was silently repossessing them.
    //   blueprints      Recovered schematics, never consumed on use. Also where
    //                   syncCrownBlueprints() latches the two crown-gated
    //                   carriers, so losing it un-earns a KOTH reward as well.
    //   kothCrowns      Lifetime #1 finishes, and the gate on Titan Aquila (25)
    //                   and Celestial Corvus (100). A crown cannot be re-earned —
    //                   the race it was won in is over. koth_wins() re-floors it
    //                   on login, but only for a signed-in player whose RPC
    //                   answers; nothing recovers it locally.
    //   casino          Lifetime wins, jackpots and spins — a record, not a purse.
    //   mergeLog        The merge receipt black box. It was being wiped on the one
    //                   event most likely to need forensics later.
    //
    // `construction` is deliberately NOT added: a hull part-built in a shipyard
    // the reset dismantles is a real question about what the player is owed, and
    // that is an operator's call, not this list's.
    'invSlotsBought', 'blueprints', 'kothCrowns', 'casino', 'mergeLog',
    // FLIGHT WAIVER (FULL FLEET coupon) is an entitlement too — the hulls ride
    // across in the hangar, so the licence that lets you fly them must as well.
    'flightWaiver',
  ];
  // Event / premium hulls are entitlements, not progress — never taken.
  const ASC_KEEP_SHIPS = ['voidmaw', 'titansina', 'sina', 'chromaregent'];
  // THE HULL A NEW RUN STARTS IN, stated once.
  //
  // pilotAscend() restores DEFAULT `equipped`, which is frigate-shaped, so the
  // flagship it names has to be the frigate or the save's gear slots are out of
  // step with its hull. That is a real constraint, not a preference — but it was
  // written as a bare literal here while three screens in pilot-ascension.js
  // showed the player their CURRENT flagship and promised they kept flying it.
  // Exported so those screens read the answer instead of restating it.
  const ASC_START_HULL = 'frigate';

  // ---- PILOT ASCENSION -------------------------------------------------------
  // Reset the account to Level 1, carry THE WHOLE HANGAR, bank the points.
  // Called by pilot-ascension.js at the flash of its cinematic.
  function pilotAscend(legacyKey, pts) {
    const keepShip = (state.ownedShips && state.ownedShips[legacyKey]) ? legacyKey : (state.ship || 'frigate');
    // 0 — SETTLE THE BOARD FIRST. Ascending mid-event used to leave a live run
    // pointing at a wiped account: a wave could complete and hand a Level 1 pilot
    // a captured citadel, an alliance raid could keep transmitting damage, and
    // loot still lying on the ground could be vacuumed up after the reset.
    rt.siege = null; rt.waves = null; rt.sdrun = null; rt.hcrun = null; rt.alrun = null; rt.cgrun = null;
    rt.beaconSwarm = 0; rt.beaconT = 0; rt.razingClaim = false;
    rt.enemies = []; rt.boss = null; rt.bossAlive = false; rt.superBossAlive = false;
    try { sweepLoot(); } catch (e) {}
    rt.ground = [];
    // 1 — stash everything that survives
    const keep = {};
    ASC_KEEP.forEach((k) => { if (state[k] !== undefined) keep[k] = state[k]; });
    // EVERY HULL COMES WITH YOU (Jul 2026 — was one Legacy Ship), but ONLY the
    // hulls. Upgrade levels, fittings, cargo AND every hull's Ship Ascension
    // (module tiers and stars) are all surrendered: each ship arrives exactly as
    // it left the yard. Ship Ascension is run progression bought with gold and
    // galaxy resources, so it resets with them — the prestige you keep is the
    // PILOT's, in stars and perks.
    const hangar = Object.keys(state.ownedShips || {}).filter((k) => state.ownedShips[k] && C.SHIP_BY_KEY[k]);
    if (hangar.indexOf(keepShip) === -1) hangar.push(keepShip);
    const legacy = { key: keepShip };
    const entitled = ASC_KEEP_SHIPS.filter((k) => state.ownedShips && state.ownedShips[k]);
    // HULL INVESTMENT NOW SURVIVES (Aug 2026). Upgrade levels and each hull's
    // Ship Ascension (module tiers + stars) are the yard work you put into the
    // SHIPS, not the pilot's run — they ride across every ascension. Only gear,
    // cargo and the pilot's own progress reset.
    const keepLevels = {}, keepAsc = {};
    try {
      const sl0 = state.shipLevels || {}, as0 = state.ascension || {};
      hangar.forEach((k) => {
        if (sl0[k] != null) keepLevels[k] = sl0[k];
        if (as0[k] != null) keepAsc[k] = JSON.parse(JSON.stringify(as0[k]));
      });
    } catch (e) {}
    const before = { lvl: state.level | 0, ship: (C.SHIP_BY_KEY[keepShip] || {}).name || keepShip };

    // 1b — LIFETIME BADGE COUNTERS: badges are a career record, so their
    // accumulators must absorb this run's totals BEFORE the wipe. Otherwise a
    // chain measured against live gold / tiles / hull levels would read as
    // though the pilot had never done any of it.
    try {
      const r0 = state.resources || {}, L = (state.lifeStats = state.lifeStats || {});
      L.gold   = Math.max(L.gold || 0, state.gold || 0);
      L.fuel   = Math.max(L.fuel || 0, r0.fuel || 0);
      L.iron   = Math.max(L.iron || 0, r0.iron || 0);
      L.plasma = Math.max(L.plasma || 0, r0.plasma || 0);
      L.res    = Math.max(L.res || 0, (r0.fuel || 0) + (r0.iron || 0) + (r0.plasma || 0));
      // GALAXY GROUND ONLY — THESE TWO CHAINS SAY SO ON THE TIN (build 736).
      // Both were raw key counts of maps that also hold OFF-MAP holdings, so
      // "Galactic Conqueror · galaxy tiles captured" counted the neutral Home
      // Citadel every account is given, the seven Void spires and the three
      // casino House Citadels — and the spires were counted TWICE, because
      // "Warden of the Void · Void spires taken" sits directly beneath it and
      // exists to count them. `citadels` had the same fault: Void and House
      // Citadels write into state.citadels carrying a `void:true` marker
      // precisely so they can be told apart, and citadelCount() already honours
      // it. Same family as the warp cap and the Territory board, both fixed in
      // 735 — when you fix a count, look at the ones beside it.
      //
      // SAFE BECAUSE THESE ARE Math.max ACCUMULATORS: the inflated historical
      // figure stays banked as a floor, so no progress bar moves backwards and no
      // claimed badge rank is revoked. Every NEW maximum from here is honest.
      try { L.tiles = Math.max(L.tiles || 0, tileCount()); } catch (e) {}
      let hulls = 0; const sl0 = state.shipLevels || {}; for (const k in sl0) hulls += sl0[k] || 0;
      L.hullLv = Math.max(L.hullLv || 0, hulls);
      // moon / colony are wiped by the reset — freeze their career sums so the
      // Lunar Baron and Master Builder chains don't fall back to zero
      try { const lt = (state.moon && state.moon.lifetime) || {}; let mt = 0; for (const k in lt) mt += lt[k] || 0; L.moonRes = Math.max(L.moonRes || 0, mt); } catch (e) {}
      try { let ct = 0; const mr = state.moon; if (mr && mr.moons) mr.moons.forEach((mm) => { const b = mm.b || {}; for (const k in b) ct += (b[k] && b[k].lv) || 0; }); L.colony = Math.max(L.colony || 0, ct); } catch (e) {}
      try { L.cits = Math.max(L.cits || 0, citadelCount()); } catch (e) {}
      L.ascend = (L.ascend || 0) + 1;
    } catch (e) {}

    // 1c — SETTLE EARNINGS. Territory itself is NOT surrendered.
    //
    // This block used to RELEASE every tile on the server — `TERRITORY.release(id)`
    // for each holding, plus deleting the local mirror. That directly contradicted
    // keeping `ownedSystems` in ASC_KEEP: the client came back believing it held
    // the map while the server had already handed every tile to neutral, so the
    // pilot's galaxy was gone the moment anyone else looked at it, and their own
    // client sat desynced until the next republish fought it back.
    //
    // Two pieces of code with opposite intentions. Territory survives ascension,
    // so the release is gone. The cost is still real and still paid: the next
    // republish writes the new (far lower) fleet score onto every tile, making
    // everything you hold much easier for someone to take while you climb back.
    try { accrueResources(); } catch (e) {}

    // 2 — wipe the account back to a factory save
    Object.keys(state).forEach((k) => { delete state[k]; });
    Object.assign(state, JSON.parse(JSON.stringify(DEFAULTS)));

    // 3 — restore the permanents
    Object.keys(keep).forEach((k) => { state[k] = keep[k]; });

    // 4 — THE WHOLE HANGAR, FULLY UPGRADED. Every hull you owned is still yours,
    // including event and premium hulls, and it keeps everything the SHIPYARD
    // built into it: hull upgrade levels and its Ship Ascension (module tiers +
    // stars). What it does NOT keep is anything the pilot was carrying — fitted
    // gear, cargo and Starforge tempers are surrendered, and the wing disbands
    // (escort slots re-earn with pilot level). You fly out in the flagship you
    // picked; the rest wait in the hangar at full strength.
    state.ownedShips = {};
    hangar.forEach((k) => { state.ownedShips[k] = true; });
    // YOU FLY OUT IN THE FRIGATE. This used to be `legacy.key` — the hull chosen as
    // the legacy pick — which left the pilot at Level 1 in a Titan or a Kaevith,
    // and put `state.ship` out of step with `state.equipped`: step 2 restores
    // DEFAULTS, so `equipped` is frigate-shaped, and step 4 then named a hull with a
    // completely different hardpoint set.
    //
    // Nothing is taken away by this. Every hull is still in `ownedShips` above with
    // its upgrade levels and Ship Ascension intact, and the pilot can switch back
    // the moment they meet that hull's licence again — an ascension resets the RUN,
    // and starting a run means starting in the starter hull.
    state.ship = ASC_START_HULL;
    state.shipLevels = keepLevels;         // hull upgrades KEPT — every level you bought stands
    state.fittings = {};                   // no saved loadouts (there is no gear to load)
    state.fleet = null; state.drones = 0; state.droneBays = {};   // wing disbanded — re-form it as slots unlock
    state.ascension = keepAsc;             // SHIP ASCENSION KEPT — module tiers & stars ride across
    state.forge = {};                      // Starforge hardpoint tempers reset
    // PILOT TREE KEPT — `pilot` and `dreadCores` ride across in ASC_KEEP. Seed
    // the origin core defensively (a legacy save can arrive with pilot null,
    // which rendered zero tiles on the tree until the next full reload), then
    // drop the cached aggregate so the tree's buffs are re-folded into the
    // freshly reset stat block.
    if (!state.pilot || !state.pilot.nodes) state.pilot = { nodes: { '0,0': 1 } };
    state.pilot.nodes['0,0'] = 1;
    if (window.DREAD && window.DREAD.refresh) { try { window.DREAD.refresh(); } catch (e) {} }
    state.beaconUntil = 0;
    state.shipKills = {};
    hangar.forEach((k) => { state.shipKills[k] = 0; });
    // the ship arrives with its yard upgrades intact but every gear slot EMPTY
    state.equipped = { bow: null, arrows: null, armor: null, boots: null, gloves: null, amulet: null, bow2: null, arrows2: null };
    state.inventory = [];

    // 5 — bank the reward
    if (!state.pasc) state.pasc = { stars: 0, pts: 0, spent: 0, perks: {}, legacy: null, hist: [] };
    // event/premium hulls kept through the reset — recorded so the entitlement is
    // provable even if a later migration touches the hangar
    state.pasc.entitled = Array.from(new Set((state.pasc.entitled || []).concat(entitled)));
    state.pasc.stars = (state.pasc.stars | 0) + 1;
    state.pasc.pts = (state.pasc.pts | 0) + Math.max(0, pts | 0);
    state.pasc.legacy = legacy.key;
    // `at` IS SERVER TIME when it is available. The weekly star ceiling is verified
    // against the backend clock (see js/servertime.js), so the record of when each
    // star was taken has to be on the same clock — otherwise the history could not
    // be used to audit the ladder later, which is the point of keeping it.
    state.pasc.hist = (state.pasc.hist || []).concat([{ lvl: before.lvl, pts: Math.max(0, pts | 0), ship: before.ship,
      at: Math.floor((window.SERVERTIME ? window.SERVERTIME.now() : Date.now())),
      srv: !!(window.SERVERTIME && window.SERVERTIME.trusted()) }]).slice(-40);
    // TUTORIALS OFF FOR GOOD. `coach` rides across in ASC_KEEP, but a pilot who
    // ascended before finishing it would still be coached on the way back up —
    // and every gated moment re-fires as the new run re-crosses its level gate.
    // One ascension is proof enough: silence the lot.
    try {
      state.coach = state.coach || { seen: {} };
      state.coach.seen = state.coach.seen || {};
      state.coach.v3 = true;
      if (window.COACH && window.COACH.keys) window.COACH.keys().forEach((k) => { state.coach.seen[k] = true; });
      state.coach.allSeen = true;   // COACH honours this even for moments added later
    } catch (e) {}
    state.nameSet = true;
    // Mission BOARDS carry across (ASC_KEEP) but their delta BASELINE must not:
    // it snapshots gold / tiles / hull levels, and those just cratered. Dropping
    // it makes the next tick reseed from the post-ascension state, so the reset
    // itself scores no mission progress either way.
    state.msnBase = null;

    state.lastSave = Date.now();
    refreshStats();
    // land the pilot in the SAFE HANGAR, not zone 1 — a fresh Level 1 fleet
    // should never materialise mid-combat. Zone 0 is the parked-hull bay.
    state.currentDungeon = 0;
    state.currentSystem = null;
    state.highestUnlocked = 1;
    state.highestDungeonReached = 1;
    rt.siege = null; rt.waves = null; rt.sdrun = null; rt.hcrun = null; rt.cgrun = null;
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; state.prismRun = null;
    state.fleet = null; state.drones = 0; state.droneBays = {};   // no wing, no drones — re-form as slots unlock
    // AND THE WING STOPS FLYING THIS INSTANT. rt.escorts is runtime, so clearing
    // state.fleet above does not by itself remove the escorts already in the air —
    // that is exactly how a Level 1 pilot ended up flanked by their endgame hulls.
    // updateEscorts() reconciles anyway, but the draw loop must not get even one
    // frame in which the old fleet is still on screen.
    rt.escorts = []; rt.escortsFor = state.ship;
    // Territory is NOT cleared — it rides across in ASC_KEEP. rt.realTiles is the
    // live server mirror and stays as-is so the galaxy map doesn't blank out; the
    // next republish rewrites every held tile with the new (much lower) fleet
    // score, which is the real cost of ascending while holding ground.
    rt.hangarHits = [];                      // drop cached parked-hull hit regions
    rt.drones = [];
    try { resetZone(); } catch (e) {}
    if (rt.archer) { rt.archer.hp = rt.stats.maxHp; rt.archer.dead = false; rt.archer.killer = null; rt.archer.invuln = 6; }
    try { goSafeHangar(); } catch (e) {}
    save();
    if (window.UI) window.UI.refreshAll();
    return { stars: state.pasc.stars, pts: state.pasc.pts, ship: state.ship, legacy: legacy.key };
  }
  function ascStars() { return (state.pasc && state.pasc.stars) | 0; }
  // LIFETIME COUNTER BUMP — the single write path for the badge metrics no other
  // system already tracks. Monotonic by construction, so nothing here regresses
  // across an ascension.
  function bumpLife(k, n) {
    if (!(n > 0)) return;
    if (!state.lifeStats) state.lifeStats = {};
    state.lifeStats[k] = (state.lifeStats[k] || 0) + n;
  }
  // RELIC HUNTER (Primordial+) and BEYOND THE ARTIFACT (ascension-tier) badges
  function countRareFind(it) {
    if (!it) return;
    const r = it.rarity | 0;
    if (r >= (C.TOP_TIER == null ? 11 : C.TOP_TIER)) bumpLife('topLoot', 1);
    if (r >= 14) bumpLife('ascLoot', 1);   // Ascendant / Celestial / Paragon
  }
  function peakLife(k, v) {
    if (!(v > 0)) return;
    if (!state.lifeStats) state.lifeStats = {};
    if (v > (state.lifeStats[k] || 0)) state.lifeStats[k] = v;
  }

  // runtime (not persisted)
  const rt = {
    canvas: null, ctx: null, w: 0, h: 0,
    worldW: 0, worldH: 0, cam: { x: 0, y: 0 },
    archer: null,
    enemies: [], nodes: [], projectiles: [], ebolts: [], particles: [], floats: [], ground: [], drones: [],
    time: 0, last: 0, running: false,
    siege: null,            // active 10-wave siege state when capturing a system
    realTiles: {},          // shared cross-account tile ownership (Supabase turf war)
    stats: null, dps: 0, dmgWindow: [],
    joy: { x: 0, y: 0, active: false },
    portraitCanvas: null, portraitCtx: null, portW: 0, portH: 0,
  };

  // --------------------------------------------------------------------------
  // DERIVED STATS
  // --------------------------------------------------------------------------
  function computeStats() {
    const s = {
      attackDamage: C.playerBaseStat('attackDamage', state.level),
      health:       C.playerBaseStat('health', state.level),
      attackSpeed: 0, critChance: C.PLAYER_BASE.critChance, critDamage: C.PLAYER_BASE.critDamage,
      moveSpeed: C.PLAYER_BASE.moveSpeed, lifeSteal: 0, multiShot: 0,
    };
    // STARFORGE is HARDPOINT-based: the temper lives on the slot, so the bonus is
    // applied here rather than baked into the item. An item's own stats are always
    // its own numbers (comparisons, sell value, escort loadouts stay honest).
    const SF = window.STARFORGE;
    Object.keys(state.equipped).forEach((slot) => {
      const it = state.equipped[slot];
      if (!it) return;
      const fm = (SF && SF.slotMult) ? SF.slotMult(slot) : 1;
      for (const k in it.stats) {
        const boost = (fm !== 1 && SF.boosts && SF.boosts(k)) ? fm : 1;
        s[k] = (s[k] || 0) + it.stats[k] * boost;
      }
    });
    // Every hardpoint hammered to +15 grants 1% flash-freeze chance on hit (cryo
    // tech, earned instead of bought) — it needs a fitting docked to fire it.
    { let cryo = 0;
      Object.keys(state.equipped).forEach((slot) => {
        if (!state.equipped[slot] || !SF || !SF.slotTemper) return;
        if (SF.slotTemper(slot).lv >= (SF.MAX_LV || 15)) cryo++;
      });
      s.cryoChance = cryo; }
    // FLEET fittings: escorts' stowed gear feeds the fleet at the same share
    // as their hull mods — auto-improved escort loadouts are real power.
    if (state.fleet && state.fleet.length) {
      fleetShips().forEach((f) => {
        const fit = state.fittings && state.fittings[f.key]; if (!fit) return;
        for (const sk in fit) {
          const it = fit[sk]; if (!it) continue;
          for (const k in it.stats) s[k] = (s[k] || 0) + it.stats[k] * C.FLEET.statShare;
        }
      });
    }
    // skill-tree modifiers
    const m = skillMods();
    // PILOT TREE — permanent, account-wide bonuses that benefit EVERY ship.
    const pm = (window.DREAD && window.DREAD.combatMods) ? window.DREAD.combatMods() : {};
    // AEGIS BANNER ARRAY — a flat fleet-damage bonus. Folded in HERE, with every
    // other dmgPct source, so score(), theoryDps and the clone matchup all see it
    // without a second code path. refreshStats() is also where the aura set is
    // re-read, which is what keeps the field in step with the fitted hardpoint.
    try { if (window.AEGIS) { window.AEGIS.refresh(); const am2 = window.AEGIS.mods(); if (am2.fleetDmgPct) m.dmgPct += am2.fleetDmgPct; } } catch (e) {}
    // COMMANDER — the officer in the fleet slot. One stat, folded in with every
    // other source, so score(), theoryDps and the clone matchup all see it by the
    // same arithmetic as gear.
    try { if (window.COMMANDERS) { const cm = window.COMMANDERS.mods(); for (const k in cm) m[k] = (m[k] || 0) + cm[k]; } } catch (e) {}
    ['dmgPct','atkSpeedPct','critChance','critDamage','hpPct','moveSpeed','lifeSteal','multiShot'].forEach((k) => { if (pm[k]) m[k] += pm[k]; });
    // ship passive modifiers
    const ship = C.SHIP_BY_KEY[state.ship] || C.SHIPS[0];
    const sm = ship.mods || {};
    // ASCENSION — per-ship module bonuses (apply while flying that hull)
    const am = (window.ASCEND && window.ASCEND.combatMods) ? window.ASCEND.combatMods(state.ship) : {};
    // NANOCORES — the ONE core equipped on this hull. Same shape and the same
    // "only while you fly it" rule as the Ascension modules above; the XP buff is
    // the exception and rides the fleet-XP pipeline in xpSources() instead.
    const nc = (window.NANO && window.NANO.combatMods) ? window.NANO.combatMods(state.ship) : {};
    // FLEET: escorts contribute a share of their hull mods to the fleet score
    const fs = { dmgPct:0, hpPct:0, critChance:0, critDamage:0, atkSpeedPct:0, moveSpeed:0, lifeSteal:0, multiShot:0, rangePct:0 };
    const esc = fleetShips();
    esc.forEach((f) => { const fm = f.mods || {}; for (const k in fs) fs[k] += (fm[k] || 0) * C.FLEET.statShare; });
    // NANOCORES IN THE FLEET — a core equipped on an escort pays at the same
    // fleet share as that hull's own mods and its stowed fittings. The flagship's
    // own core (nc, above) pays in full; regen and damage reduction are folded in
    // at their own capped lines below.
    const nf = (window.NANO && window.NANO.fleetMods) ? window.NANO.fleetMods(esc) : {};
    for (const k in fs) if (nf[k]) fs[k] += nf[k] * C.FLEET.statShare;
    // WARDEN ARRAY: fleet-support aura from an equipped support weapon —
    // doubled while flying the Aegis (its whole reason to exist)
    const aura = I.supportAura ? I.supportAura(state.equipped.bow) : null;
    // Warden arrays mount only on the Aegis — inert anywhere else (legacy saves)
    const aMul = ship.cls === 'Aegis' ? 2 : 0;
    s.regen = Math.min(5, (aura ? aura.regen * aMul : 0) + (pm.regen || 0) + (m.regen || 0) + (nc.regen || 0) + (nf.regen || 0) * C.FLEET.statShare);
    s.dmgReduce = Math.min(DR_CAP_PCT, (aura ? Math.min(60, aura.reduce * aMul) : 0) + (pm.dmgReduce || 0) + (am.dmgReduce || 0) + (m.dmgReduce || 0) + (nc.dmgReduce || 0) + (nf.dmgReduce || 0) * C.FLEET.statShare);
    if (aura) s.multiShot += aura.multiShot * aMul;
    // SHIP HULL UPGRADES — per-ship levels bought with Galaxy Resources (+dmg/+hp/+fire rate)
    const _hl = ((state.shipLevels && state.shipLevels[state.ship]) || 1) - 1;
    const hlDmg = _hl * 10, hlHp = _hl * 12, hlAtk = _hl * 5;
    s.attackDamage *= (1 + (m.dmgPct + (sm.dmgPct||0) + fs.dmgPct + hlDmg + (nc.dmgPct||0)) / 100);
    s.health *= (1 + (m.hpPct + (sm.hpPct||0) + fs.hpPct + hlHp + (am.hpPct || 0) + (nc.hpPct||0)) / 100);
    s.critChance += m.critChance + (sm.critChance||0) + fs.critChance + (nc.critChance||0);
    s.critDamage += m.critDamage + (sm.critDamage||0) + fs.critDamage + (nc.critDamage||0);
    s.moveSpeed += m.moveSpeed + (sm.moveSpeed||0) + fs.moveSpeed + (nc.moveSpeed||0);
    s.lifeSteal += m.lifeSteal + (sm.lifeSteal||0) + fs.lifeSteal;
    s.multiShot += m.multiShot + (sm.multiShot||0) + fs.multiShot + (nc.multiShot||0);
    s.attacksPerSec = C.PLAYER_BASE.attackSpeed * (1 + (s.attackSpeed + m.atkSpeedPct + (sm.atkSpeedPct||0) + fs.atkSpeedPct + hlAtk + (am.atkSpeedPct || 0) + (nc.atkSpeedPct||0)) / 100);
    s.shipLevel = _hl + 1;
    s.critChance = Math.min(100, s.critChance);
    // MEATY FIRE (Jul 2026): past 2.2 shots/s and 100% multishot, extra rate
    // FOLDS INTO DAMAGE — identical DPS, a fraction of the projectiles. At
    // Lv100+ the screen stops being a hose of rounds; every shell lands huge.
    if (s.attacksPerSec > 2.2) { s.attackDamage *= s.attacksPerSec / 2.2; s.attacksPerSec = 2.2; }
    // THE MULTI-SHOT FOLD WAS LEAKING DAMAGE, TWICE OVER (Aug 2026).
    //   1. It only fired above 200, but the clamp below cuts multishot at 100 —
    //      so every build between 101% and 200% simply LOST the excess with no
    //      compensation at all.
    //   2. Above 200 it folded, set multishot to 200, and the clamp immediately
    //      halved that to 100 — the fold had been written against a survivor of
    //      200 and was never re-derived when the ceiling moved, so a large part
    //      of what it folded in was taken straight back out.
    // One rule now, DPS-preserving against the theoryDps model below: what is
    // kept is 1 + 100/100 × 0.6 = 1.6, so the excess folds in at the ratio of the
    // real term to that. Hits the carriers hardest because they carry the biggest
    // multishot mods in the game (Praetorian 456%, Aquila 950%, Corvus 1425%).
    if (s.multiShot > 100) { s.attackDamage *= (1 + s.multiShot / 100 * 0.6) / 1.6; s.multiShot = 100; }
    s.lifeSteal = Math.min(19, s.lifeSteal);   // global ceiling — was 95 before the 80% sustain cut
    s.multiShot = Math.min(100, s.multiShot);
    s.maxHp = s.health;
    // MOVE SPEED CAP — +1000% (×10 base). FrostSkull hit 3541%: at 5× game speed and
    // a stalled frame's catch-up dt that is a ~65,000px jump in one tick — the ship
    // teleports across zone edges, sweeps hundreds of pickups in one frame (each
    // spawning UI floats/particles), and thrashes the camera + node collision
    // sweeps. Everything past the cap did nothing useful anyway: the ship already
    // outruns every enemy and projectile in the game long before ×10.
    s.moveSpeed = Math.min(1000, s.moveSpeed);
    // `speedMult` is a flat multiplier on the finished figure rather than a
    // moveSpeed mod, so "75% slower than the reference hull" stays exactly that
    // whatever else is stacking speed — and can never drive the value negative.
    s.moveSpeedPx = 92 * (s.moveSpeed / 100) * ((C.SHIP_BY_KEY[state.ship] || {}).speedMult || 1);
    // weapon range — hull mod + fleet share + Warden aura all extend it
    s.fireRange = FIRE_RANGE * (1 + ((sm.rangePct || 0) + fs.rangePct + (aura ? aura.rangePct * aMul : 0) + (pm.rangePct || 0) + (am.rangePct || 0) + (m.rangePct || 0)) / 100);
    // THE SAME MULTIPLIER, EXPOSED. Weapon Range comes from the skill tree, the
    // pilot tree, hull mods, gear and the Warden aura, and every one of them was
    // reaching a cannon and nothing else. A Fighter Carrier's reach IS its
    // engagement envelope, so the wing has to grow on the identical figure or a
    // range build silently does nothing for the entire class.
    s.rangeMul = FIRE_RANGE > 0 ? s.fireRange / FIRE_RANGE : 1;
    s.fleetSize = esc.length;
    const critMult = 1 + (s.critChance / 100) * (s.critDamage / 100);
    // ---- THROUGHPUT: CANNONS + THE WING ------------------------------------
    // `cannonDps` is the classic model — one hull, one gun battery. It is also
    // the unit the fighter wing is denominated in, so both are derived from it.
    //
    // A GUN-LESS CARRIER SCORES NO CANNON. The Vanguard mounts none (weapons: 0)
    // and fires none (see fighterHull), yet it still scored a full cannon line
    // off its base attack damage — a phantom weapon — while the four craft that
    // are its entire armament counted for nothing. Both halves were wrong and
    // they partly cancelled, which is why it went unnoticed.
    const cannonDps = s.attackDamage * s.attacksPerSec * critMult * (1 + s.multiShot / 100 * 0.6);
    const gunless = !!(ship.fighterCapacity && !(ship.weapons | 0));
    let wingRatio = 0;
    try { if (window.FIGHTERS && window.FIGHTERS.dpsRatio) wingRatio = window.FIGHTERS.dpsRatio(true) || 0; } catch (e) {}
    s.cannonDps = gunless ? 0 : cannonDps;
    s.wingDps = cannonDps * wingRatio;          // exact: the wing is anchored to cannon DPS
    s.wingRatio = wingRatio;
    s.bays = (ship.fighterCapacity | 0);
    // FLOOR OF 1. A gun-less carrier with every bay empty legitimately produces
    // no damage at all, and theoryDps is a DIVISOR in the offline sim, the clone
    // matchup and the tile-defence maths — a literal zero there is a divide-by-zero
    // or an infinite time-to-kill, not a weak ship.
    s.theoryDps = Math.max(1, s.cannonDps + s.wingDps);
    // never emit a non-finite stat — one Infinity here poisons hp, dps, offline
    // sim lethality and the published score all at once
    for (const k in s) if (typeof s[k] === 'number' && !isFinite(s[k])) s[k] = (k === 'maxHp' || k === 'health') ? 100 : 1;
    return s;
  }

  // ---- SKILL TREE helpers --------------------------------------------------
  function skillMods() {
    const m = { dmgPct: 0, atkSpeedPct: 0, critChance: 0, critDamage: 0, hpPct: 0, moveSpeed: 0, lifeSteal: 0, multiShot: 0,
                rangePct: 0, regen: 0, dmgReduce: 0 };
    C.SKILLS.nodes.forEach((n) => { const r = state.skills[n.id] || 0; if (r) m[n.mod] += n.per * r; });
    return m;
  }
  function skillRank(id) { return state.skills[id] || 0; }
  function branchSpent(br) {
    let p = 0;
    C.SKILLS.nodes.forEach((n) => { if (n.br === br) p += (state.skills[n.id] || 0) * n.cost; });
    return p;
  }
  function skillReqMet(node) {
    if (node.reqBranch != null && branchSpent(node.br) < node.reqBranch) return false;
    if (node.reqNode && (state.skills[node.reqNode.id] || 0) < node.reqNode.rank) return false;
    return true;
  }
  function canInvest(node) {
    return state.skillPoints >= node.cost && (state.skills[node.id] || 0) < node.max && skillReqMet(node);
  }
  function investSkill(id) {
    const node = C.SKILLS.nodes.find((n) => n.id === id);
    if (!node || !canInvest(node)) return false;
    state.skills[id] = (state.skills[id] || 0) + 1;
    state.skillPoints -= node.cost;
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  function resetSkills() {
    let refund = 0;
    C.SKILLS.nodes.forEach((n) => { refund += (state.skills[n.id] || 0) * n.cost; });
    state.skillPoints += refund; state.skills = {};
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
    return refund;
  }
  // FLEET / SHIP SCORE — display scale. The raw power value (theoryDps +
  // 0.5·maxHp) keeps growing forever internally; the SCORE shown is identical
  // below 1M, then square-root compressed — so it lives far below 999T at any
  // realistic progression without ever being capped. Display-only.
  function score() {
    const s = rt.stats; if (!s) return 0;
    const raw = s.theoryDps + s.maxHp * 0.5;
    return Math.floor(raw <= 1e6 ? raw : 1e6 * Math.sqrt(raw / 1e6));
  }
  // ---- TRUE POWER (combat maths must never use the compressed score) --------
  // score() is sqrt-compressed above 1e6 purely so the HUD number stays
  // readable. Comparing two COMPRESSED scores square-roots the real power gap:
  // a defender with 100× your power reads as only 10×, and 4× reads as 2×.
  // Every balance decision below therefore de-compresses first.
  function powerRaw() { const s = rt.stats; if (!s) return 1; return Math.max(1, s.theoryDps + s.maxHp * 0.5); }
  function rawFromScore(sc) { const s = Math.max(0, sc || 0); return s <= 1e6 ? s : (s * s) / 1e6; }
  // Your EFFECTIVE throughput, not the theoretical number. Multishot, drones,
  // escorts, prism splash and singularity all land damage theoryDps never
  // counted, which is the other half of why defenders melted.
  function effectiveDps() {
    const th = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    const measured = rt.dps || 0;
    let fleetBoost = 1;
    try { fleetBoost += Math.min(1.2, (fleetShips() || []).length * 0.16); } catch (e) {}
    fleetBoost += Math.min(0.6, (state.drones || 0) * 0.04);
    return Math.max(th * fleetBoost, measured);
  }
  // Effective HP pool — what an attacker actually has to chew through.
  function myEhp() {
    const s = rt.stats || {};
    const dr = Math.min(DR_CAP_PCT / 100, Math.max(0, (s.dmgReduce || 0) / 100));
    return Math.max(1, (s.maxHp || 1) / (1 - dr));
  }
  // ---- THE MATCHUP CONTRACT -------------------------------------------------
  // One place decides how a clone fight resolves, so the promise is honest:
  //   your time-to-kill THEM  = TTK_ATT × ratio
  //   their time-to-kill YOU  = TTK_DEF ÷ ratio
  // ratio is TRUE power (theirs / yours). TTK_DEF is deliberately a shade lower
  // than TTK_ATT, so the crossover sits at ratio ≈ 0.95: a fleet holding a
  // citadel or a void spire wins from 95% of your power upward. Fortified
  // positions get the defender's edge — you must out-power them to take one.
  //   ratio 0.5 (you 2× stronger) → you 11s, them 40s  — you win clearly
  //   ratio 0.95                   → ≈21s each         — knife-edge, flying decides it
  //   ratio 1.0 (dead even)        → you 22s, them 20s  — defender edges it
  //   ratio 1.5                    → you 33s, them 13s  — you lose
  //   ratio 10+                    → hopeless, exactly as their ⚡ promises
  // No gimmick and no scripted outcome: both sides race honest DPS against
  // honest HP, and the stronger fleet wins because the numbers say so.
  const TTK_ATT = 22, TTK_DEF = 20;
  // RATIO CEILING — a fight that can't be won in a 5-minute sitting isn't a
  // fight, it's a wall. Synthetic garrisons (Void Wardens) pass a tight cap so
  // a pilot who cleared the level gate always has a real shot; real players'
  // clones keep a wide-but-finite ceiling so their ⚡ still means something.
  const RATIO_CAP = 6;
  function cloneMatchup(cloneScore, maxRatio) {
    const myRaw = powerRaw();
    const defRaw = Math.max(1, rawFromScore(cloneScore || score()));
    const cap = Math.max(0.5, Math.min(RATIO_CAP, maxRatio || RATIO_CAP));
    const ratio = Math.max(0.15, Math.min(cap, defRaw / myRaw));
    return {
      ratio,
      hp: Math.max(15000, Math.round(effectiveDps() * TTK_ATT * ratio)),
      dps: Math.max(1, myEhp() / (TTK_DEF / ratio)),
      outmatched: ratio > 0.92,
    };
  }
  // FLEET SUSTAIN, BOUNDED — a defending fleet repairs, but its repair rate can
  // never approach the attacker's DPS, or the fight stalls forever (the void
  // spire bug: 5%/s of a 110-second hull out-healed everything). Absolute HP/s,
  // hard-capped at a fraction of what the attacker actually puts out, and
  // suppressed for 2.5s after every hit so damage always shows.
  const REGEN_SHARE = 0.15, REGEN_SUPPRESS = 2.5;
  // PvP-shaped encounter? (clone garrisons, citadels, void wardens, sparring)
  const PVP_LIFESTEAL = 1;
  // SIEGE CLOCK — seconds an attacker gets on the FINAL defender of a defended
  // tile (a live player's Citadel, and every Void tile). Escort waves are
  // untimed; the clock only starts when the last target is on the field.
  const SIEGE_CLOCK = 60;
  function pvpFight() {
    const w = rt.waves;
    return !!(w && w.active && (w.clone || w.citadel || w.thenCitadel || w.playerCit));
  }
  function setCloneRegen(e, ratio) {
    const soft = e.maxHp * Math.min(0.05, Math.max(0, (ratio - 1) * 0.02));
    e.cloneRegen = Math.max(0, Math.min(soft, effectiveDps() * REGEN_SHARE));
    e.regenHold = 0;
  }

  // ZONE IS A LIVE STAT INPUT. The Evolving Paragon Cannon scales on
  // dungeonScale(highestDungeonReached), so pushing deeper changes its numbers —
  // but the seven places that advanced that field just assigned it and moved on.
  // Nothing recomputed. The cannon (and the Ship Score) stayed on the old zone
  // until some unrelated event happened to call refreshStats().
  //
  // Below the level cap that self-heals within a kill or two, because levelling
  // calls refreshStats(). AT the cap it never heals: level-ups stop, so a pilot
  // at Lv 150+ pushing from zone 150 to 400 would fly a cannon still costed at
  // zone 150 — the exact pilot who owns one — and their Ship Score would sit
  // wrong on the HUD and in every leaderboard publish.
  function reachZone(z) {
    const prev = state.highestDungeonReached || 0;
    const next = Math.max(prev, z | 0);
    state.highestDungeonReached = next;
    if (next > prev) { try { refreshStats(); } catch (e) {} }
    return next;
  }
  function refreshStats() {
    // The Evolving Paragon Cannon scales with the pilot, so its stats are rewritten here —
    // before computeStats() reads it. Doing it at this single choke point means
    // combat, auto-equip, itemPower, the bag and every tooltip see an ordinary
    // item with ordinary numbers, and none of them need to know it is special.
    try { if (window.AXIOM) window.AXIOM.sync(); } catch (e) {}
    const prevMax = rt.stats ? rt.stats.maxHp : 0;
    rt.stats = computeStats();
    rt._xpMT = null;                       // XP stack may have moved — drop the cache
    // APEX COMMANDER badge — peak fleet power ever reached, on the display scale
    try { peakLife('peakPower', score()); } catch (e) {}
    if (rt.archer) {
      rt.archer.dmgReduce = rt.stats.dmgReduce || 0;
      rt.archer.maxHp = rt.stats.maxHp;
      if (prevMax <= 0) rt.archer.hp = rt.stats.maxHp;
      else rt.archer.hp = Math.min(rt.stats.maxHp, rt.archer.hp * (rt.stats.maxHp / prevMax));
    }
  }

  // --------------------------------------------------------------------------
  // LEVELING
  // --------------------------------------------------------------------------
  // Roughly how many on-level kills should equal one level.
  // THIS USED TO BE A CONSTANT 18,000, AND THAT WAS THE WHOLE LEVELLING BUG.
  // killXpFor() pays a fixed FRACTION of xpToNext(level) per kill, so however
  // steep the XP wall got, a level always cost the same 18,000 kills — the
  // century steepening in xpToNext was arithmetically cancelled out before it
  // reached the player. Kill RATE, meanwhile, climbs without limit as power
  // grows, so levelling got FASTER the further you went. Reported as "levelling
  // gets easier as you progress", and it was exactly that.
  // The kill cost now grows with level, so the curve the config file describes
  // is the curve players actually feel. The first pass at this used ^1.4, which
  // overshot hard — 140k kills a level at L500 was a wall, not a slope. This is
  // the geometric middle between the old flat 18,000 and that pass (^1.4 → ^0.7
  // is exactly sqrt of the same multiplier at every level):
  //   L1 18.0k · L50 21.3k · L100 25.7k · L200 32.6k · L300 38.9k · L500 50.2k
  // Progression still slows as you climb — 2.8× across the range instead of
  // 7.8× — and the early game is untouched (the term is ~1.0 below level 20).
  function xpKillsPerLevel(level) {
    return 18000 * Math.pow(1 + Math.max(0, level | 0) / 150, 0.7);
  }
  // Per-kill XP. Early on this is just the flat zone XP (fast onboarding). Once
  // the level wall dwarfs flat XP, a kill is instead worth a FIXED FRACTION of
  // your current level wall — so a level always costs ~XP_KILLS_PER_LEVEL
  // on-level kills no matter how astronomical the wall has grown. Kills in zones
  // far below your level pay only a sliver, so there's no trivial-farm shortcut.
  function killXpFor(zone) {
    const flat = C.enemyXp(zone);
    const z = zone || state.currentDungeon || 1;
    const appropriate = Math.max(0.05, Math.min(1, z / Math.max(1, state.level)));
    const fraction = C.xpToNext(state.level) / xpKillsPerLevel(state.level) * appropriate;
    return Math.max(flat, Math.floor(fraction));
  }
  // ---- FLEET XP RATE ----------------------------------------------------------
  // ONE SUM. NOTHING MULTIPLIES ANYTHING ELSE.
  //
  //     rate% = 100  +  Pro(+400 if a member)  +  min(500, Σ every other bonus)
  //     rate% is then hard-capped at 1000.
  //
  // The three numbers line up on purpose: 100 + 400 + 500 IS 1000, so the ceiling
  // is exactly "base, plus Pro, plus every bonus maxed" and nothing a pilot earns
  // is ever silently thrown away.
  //
  // WHY THIS CHANGED (Aug 2026). The previous formula was
  //     total = base × (1 + Σ bonuses / 100)
  // with base = 500 on Pro. That reads as additive but it is not: the base
  // MULTIPLIES the summed bonuses, so on Pro every +1% a pilot earned was worth
  // +5 points of rate. A Pro member with a maxed Neural Uplink (+200%) sat at
  // 500 × 3 = 1500%, i.e. 500 points PAST the cap, and every node, VIP level and
  // Kaevith hull bought after that did literally nothing. That is the reported
  // "bonuses stack past the 1000% cap" — they did stack past it, and the overflow
  // was discarded. It also made the cap trivial to hit: Pro's own base spent half
  // of it before a single bonus, so Pro + one big perk was already at the ceiling.
  //
  // Pro's headline is untouched: 100 + 400 = 500% = the advertised 5× XP. What it
  // no longer does is quintuple everything else the pilot owns.
  //
  // Every source was also cut at its own definition (see PROGRESSION NOTE in
  // pilot-ascension.js, config-v2.js Kaevith hulls, nanocores.js, ascension.js
  // and dreadnaught.js) so the summed bonus lands near +400 for a maxed account
  // rather than +600 — the cap is a backstop, not a routine.
  const XP_BASE_PCT = 100;      // every pilot, always
  const XP_PRO_PCT = 400;       // LootFleet Pro, as FLAT POINTS (100+400 = the 5× sold)
  const XP_BONUS_CAP = 500;     // ceiling on the SUM of all other bonuses
  const XP_RATE_CAP = 1000;     // ceiling on the total = 100 + 400 + 500
  function xpSources() {
    const safe = (fn) => { try { const v = fn(); return isFinite(v) && v > 0 ? v : 1; } catch (e) { return 1; } };
    const out = [];
    // Each hook reports a multiplier (1 + pct/100); unwrap it to its flat %.
    const add = (n, m) => { const pct = Math.round((m - 1) * 1000) / 10; if (pct > 0.01) out.push({ n, pct }); };
    add('VIP', safe(() => (window.VIP ? window.VIP.mult('xp') : 1)));
    add('Pilot Tree', safe(() => (window.DREAD && window.DREAD.mult ? window.DREAD.mult('xpGain') : 1)));
    add('Neural Uplink', safe(() => (window.PASCEND ? window.PASCEND.mult('xp') : 1)));
    add('Nanocore', safe(() => (window.NANO ? window.NANO.mult('xp') : 1)));
    add('Combat Computer', safe(() => (window.ASCEND && window.ASCEND.xpMult ? window.ASCEND.xpMult() : 1)));
    add('Kaevith Resonance', safe(() => xenXpMult()));
    // TOUR OF DUTY — the level-50 cells, one per track, and only the ones actually
    // CLAIMED. Additive percentage points like every other source, so the three
    // tracks stack to +8.5% and the whole stack still answers to one cap.
    add('Tour of Duty', safe(() => (window.TOUR ? window.TOUR.mult() : 1)));
    return out;
  }
  // { basePct, buffPct, bonusPct, pct, rawPct, capped, bonusCapped, cap, bonusCap,
  //   headroom, mult, sources, pro }
  //   basePct  — your starting rate before bonuses: 100, or 500 on Pro
  //   buffPct  — every other bonus added up, UNCAPPED (what you have earned)
  //   bonusPct — what of that actually counts (buffPct clipped to XP_BONUS_CAP)
  //   pct      — the TOTAL rate actually paid
  //   rawPct   — what the stack would pay with no ceilings at all
  //   capped   — pct is lower than rawPct, i.e. something is being clipped
  function xpFleetInfo() {
    const src = xpSources();
    const pro = isPro();
    const basePct = XP_BASE_PCT + (pro ? XP_PRO_PCT : 0);
    const buffPct = Math.round(src.reduce((a, s) => a + s.pct, 0) * 10) / 10;
    const bonusPct = Math.min(XP_BONUS_CAP, buffPct);
    const rawPct = Math.round((basePct + buffPct) * 10) / 10;
    const pct = Math.min(XP_RATE_CAP, Math.round((basePct + bonusPct) * 10) / 10);
    // THE CEILING THAT APPLIES TO **THIS** PILOT, not the global constant.
    // XP_RATE_CAP is 1000, but only a Pro account can reach it: the total is
    // base + bonuses, and without Pro the base is 100, so the real ceiling is
    // 100 + 500 = 600. Reporting a flat "cap 1000%" to a free pilot promised 400
    // points of headroom that cannot exist, and then showed CAPPED at 600 — which
    // reads as a bug rather than a rule. Every caller should quote myCap.
    const myCap = Math.min(XP_RATE_CAP, basePct + XP_BONUS_CAP);
    return { sources: src, pro, basePct, buffPct, bonusPct, rawPct, pct,
             capped: rawPct > pct, bonusCapped: buffPct > XP_BONUS_CAP,
             cap: XP_RATE_CAP, bonusCap: XP_BONUS_CAP, myCap,
             // How much of the bonus stack is being thrown away right now. Zero
             // for almost everyone; the whole point of the question is that when
             // it is not zero, it is doing NOTHING and the pilot must be told.
             wastedPct: Math.max(0, Math.round((rawPct - pct) * 10) / 10),
             headroom: Math.max(0, XP_BONUS_CAP - buffPct), mult: pct / 100 };
  }
  // XP MULTIPLIER, CACHED — gainXp() runs on EVERY KILL.
  // The full stack it used to walk per kill — xpSources() building a fresh array
  // of six source objects behind six closures, NANO.mult('xp') re-walking the
  // fleet and allocating a mods object per hull, xenXpBonus() rebuilding its key
  // list with concat+filter and a seen map — came to roughly twenty allocations
  // PER KILL. At 5× with multishot that is the largest single source of garbage
  // in the game, and the GC pauses it causes are exactly what a "giga laggy"
  // report feels like.
  //
  // Every input moves only on discrete events, and all of them funnel through
  // refreshStats(), which nulls the timestamp above for an immediate recompute.
  // The 0.5s TTL is the safety net for any subsystem that changes an XP source
  // WITHOUT recomputing stats: the figure is never more than half a second stale,
  // and the per-kill cost is now one float read.
  function xpMultCached() {
    if (rt._xpMT == null || rt.time - rt._xpMT > 0.5 || rt.time < rt._xpMT) {
      rt._xpMT = rt.time;
      rt._xpM = xpFleetInfo().mult;
    }
    return rt._xpM;
  }
  function gainXp(amount) {
    if (!isFinite(amount) || amount <= 0) return;   // a NaN here corrupts xp forever
    amount *= xpMultCached();   // base × (1 + summed bonuses)
    state.xp += amount;
    // LEVEL CAP — Lv 150, +50 per Ascension Star. At the cap XP is not banked at
    // all (no phantom bar that fills into nothing): the run is over, and the only
    // way to a higher level is to ascend.
    const cap = C.levelCap();
    if (state.level >= cap) {
      state.xp = 0;
      if (!state.capNotified || state.capNotified !== cap) {
        state.capNotified = cap;
        save();
        if (window.UI && window.UI.showLevelCap) window.UI.showLevelCap(cap);
      }
      return;
    }
    let gained = 0;
    while (state.level + gained < cap && state.xp >= C.xpToNext(state.level + gained)) { state.xp -= C.xpToNext(state.level + gained); gained++; }
    if (gained) {
      state.level += gained;
      state.skillPoints += gained * C.SKILLS.pointsPerLevel;
      onLevelUp(gained);
      const gateShown = maybeAscendGate();
      if (state.level >= cap) {
        state.xp = 0; state.capNotified = cap; save();
        // ONE SHEET, NOT TWO. The gate now IS the cap, so both notices fire on the
        // same level-up. The ascension sheet is the fuller of the two (it states
        // the wall AND the payout), so the plain cap sheet stands down when it ran.
        if (!gateShown && window.UI && window.UI.showLevelCap) window.UI.showLevelCap(cap);
      }
    }
  }
  // THE ASCENSION GATE ANNOUNCEMENT — fires the moment a pilot reaches their level
  // cap, which is where ascending becomes possible. Once PER STAR: the gate moves
  // up with every ascension (150 · 200 · 250 · 300…), so each new run earns the
  // notice again, and the flag is stamped with the star count that saw it.
  // Never a nag beyond that — it states the choice once and gets out of the way.
  // Returns true when it announced, so the caller can suppress the duplicate
  // level-cap sheet that would otherwise open in the same instant.
  function maybeAscendGate() {
    let gate = 0, stars = 0;
    try {
      if (!window.PASCEND || !window.PASCEND.gateLv) return false;
      gate = window.PASCEND.gateLv() | 0;
      stars = window.PASCEND.stars() | 0;
    } catch (e) { return false; }
    if (!gate || (state.level | 0) < gate) return false;
    if (!state.pasc) return false;
    if (state.pasc.gateSeen === stars) return false;   // already announced for this star
    state.pasc.gateSeen = stars;
    save();
    if (window.UI && window.UI.showAscendGate) {
      setTimeout(() => { try { window.UI.showAscendGate(gate, C.levelCap()); } catch (e) {} }, 700);
      return true;
    }
    return false;
  }
  function onLevelUp(gained) {
    refreshStats();
    rt.archer.hp = rt.stats.maxHp;
    rt.archer.dead = false;
    const cap = C.zoneCap(state.highestDungeonReached);
    const unlock = Math.min(cap, unlockCeil(state.level));
    if (unlock > state.highestUnlocked) state.highestUnlocked = unlock;
    burst(rt.archer.x, rt.archer.y, '#e6b566', 26, { glow: true, speed: 220, life: 0.9 });
    if (window.UI) { window.UI.onLevelUp(state.level); window.UI.refreshAll(); }
    // THE CURVE ARGUMENT — only once the centuries actually bite (see xpToNext's
    // century steepening). Before 100 the pace is fine and the pitch would be a lie.
    if (state.level >= 100) { try { window.PROOFFER && PROOFFER.maybe('levelgrind'); } catch (e) {} }
    // One-time warning the moment a pilot crosses into the Lv 100 endgame, where a
    // destroyed ship can cost the entire hold.
    if (state.level >= 100 && !state.lv100Warned) {
      state.lv100Warned = true; save();
      if (window.UI && window.UI.showCatastropheWarning) window.UI.showCatastropheWarning();
    }
  }
  // Jump the pilot to a level (used by the secret easter eggs). Grants the
  // matching skill points and zone unlocks, then recomputes stats.
  function setLevel(n) {
    n = Math.max(1, Math.min(C.levelCap(), n | 0));   // never past the ascension-gated cap
    if (n <= state.level) return state.level;
    const gained = n - state.level;
    state.level = n; state.xp = 0;
    state.skillPoints = (state.skillPoints || 0) + gained * C.SKILLS.pointsPerLevel;
    onLevelUp(gained);
    return state.level;
  }

  // --------------------------------------------------------------------------
  // SPAWN NODES — fixed points that repopulate after a kill
  // --------------------------------------------------------------------------
  function allowedEnemies() { return C.ENEMIES.filter((e) => state.currentDungeon >= e.minDungeon); }
  function pickType() {
    const pool = allowedEnemies();
    return pool[Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 1.4) * pool.length))] || pool[pool.length - 1];
  }
  function buildNodes() {
    rt.nodes = [];
    if (state.currentDungeon < 1) return; // Safe Zone: zero threats, no spawns
    const cx = rt.worldW / 2, cy = rt.worldH / 2;
    const count = Math.min(isSwarmZone(state.currentDungeon) && !state.currentSystem ? 110 : 55, Math.round(nodeCount(state.currentDungeon) * (rt.tileDensity || 1)));
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        x = 60 + Math.random() * (rt.worldW - 120);
        y = 60 + Math.random() * (rt.worldH - 120);
        tries++;
      } while (Math.hypot(x - cx, y - cy) < 120 && tries < 20);
      rt.nodes.push({ x, y, enemy: null, respawnT: 0 });
    }
  }
  // ===========================================================================
  // ◉ BEACON — manual swarm summon (Zone Grind only)
  // ---------------------------------------------------------------------------
  // A distress beacon that floods the sector with a 20× swarm. Deliberately
  // constrained:
  //   • ZONE GRIND ONLY. No galaxy tile, void spire, citadel siege, dreadnaught,
  //     prism field or home defence — those encounters are authored, and letting
  //     a player inflate their spawn counts would break every one of them.
  //   • NEVER AUTOMATED. Autopilot cannot fire it; it is a human decision to
  //     invite that much danger, which is the whole appeal.
  //   • 5 MINUTE cooldown, and the swarm runs for a fixed window before the
  //     survivors withdraw.
  // The DEFENSE tree feeds it: every rank invested there both shortens the
  // cooldown and LENGTHENS the swarm window, so a tank build farms far more from
  // one beacon than a glass cannon does. Other systems (Pro, VIP, ascension
  // perks) can hook the same two numbers later — see beaconStats().
  // ===========================================================================
  const BEACON = { cd: 300, mult: 50, life: 45, cap: 220, ring: 1500 };
  // Total ranks invested in the Defense branch — the beacon's scaling input.
  function defenseRanks() {
    let n = 0;
    try { C.SKILLS.nodes.forEach((nd) => { if (nd.br === 'defense') n += state.skills[nd.id] || 0; }); } catch (e) {}
    return n;
  }
  // Defense investment pays two ways, both capped so it stays a bonus and not a
  // rewrite: up to −40% cooldown (300s → 180s) and up to +150% swarm duration
  // (45s → 112s), plus a modest widening of the initial swarm.
  // ASCENSION PERKS stack ON TOP of that and are far stronger — four perks
  // (Distress Relay / Sustained Signal / Wideband Broadcast / Wreckfield Tithe)
  // are the headline reward for spending ascension points. Fully ranked they turn
  // the beacon from an occasional panic button into an ascended pilot's whole
  // farming loop: back in ~35s, running minutes, four times the swarm, and every
  // kill in it worth 3.5×. The floors below are what keep that sane.
  // COOLDOWN IS WALL-CLOCK, NOT FRAME TIME. It used to live only in rt.beaconT,
  // which is runtime state — so refreshing the page handed the beacon straight
  // back off cooldown. state.beaconUntil is an absolute timestamp on the save, so
  // a reload (or a tow to the hangar, or a device swap) can't skip the recharge.
  function beaconLeft() {
    const until = Number(state.beaconUntil) || 0;
    if (!until) return 0;
    const left = (until - Date.now()) / 1000;
    // a clock jumped backwards, or the cooldown was shortened since it started
    const cap = beaconCd();
    if (left > cap) { state.beaconUntil = Date.now() + cap * 1000; return cap; }
    return Math.max(0, left);
  }
  let _bcCd = 0;
  function beaconCd() { return _bcCd || 300; }
  function beaconStats() {
    const r = defenseRanks();
    const pm = (window.PASCEND && window.PASCEND.beaconMods) ? window.PASCEND.beaconMods()
             : { cdCut: 0, life: 1, size: 1, loot: 1 };
    // EMBER CHOIR RESONANCE — Choir hulls in the fleet feed the same four numbers
    // the Defense tree and the ascension perks do. Composed here so there is one
    // place the beacon is tuned and the UI can always report the real figures.
    const em = emberBeaconBonus();
    const dCut = Math.min(0.4, r * 0.005);
    // reductions are multiplicative, so no source can ever reach zero
    const cd = Math.max(30, Math.round(BEACON.cd * (1 - dCut) * (1 - pm.cdCut) * (1 - em.cdCut) * (1 - proMods().beaconCdCut)));
    let life = Math.round(BEACON.life * (1 + Math.min(1.5, r * 0.019)) * pm.life * (1 + em.life));
    // A DOWNTIME FLOOR. Fully stacked, duration outran the cooldown (506s of swarm
    // on a 72s recharge), so the beacon was permanently on — it stops being a
    // decision and the zone is simply always a swarm. Duration is capped so at
    // least a third of every cycle stays quiet.
    life = Math.min(life, Math.round(cd * 0.66));
    // the advertised swarm size must be one the field can actually hold, or the
    // tooltip promises ×320 and delivers the cap
    const mult = Math.min(BEACON.cap, Math.round(BEACON.mult * (1 + Math.min(0.6, r * 0.008)) * pm.size * (1 + em.size)));
    _bcCd = cd;
    // `loot` is stamped onto every beacon-summoned enemy as its tithe, so the
    // Choir's share has to be folded in HERE \u2014 returning pm.loot alone silently
    // dropped the whole +loot half of the event.
    return { ranks: r, cd, life, mult, loot: pm.loot * (1 + em.loot), ember: em, cdLeft: beaconLeft() };
  }
  // Zone Grind means: a plain numbered zone with no special encounter running.
  // VISIBILITY and PERMISSION are separate on purpose. The button used to hide
  // itself whenever the beacon could not fire — including every time a routine
  // zone boss spawned — so it appeared to randomly vanish mid-session. It now
  // stays put for the whole grind and simply greys out when it can't fire.
  //
  // LEVEL GATE (Aug 2026). The beacon calls a 50× swarm onto your own position.
  // It is the one system the player triggers by hand, and at low level it is not
  // a tool — it is a way to die without understanding why. Held back to 30, the
  // same gate as the Pilot Tree, which is where its perks live anyway.
  const BEACON_LV = 30;
  function beaconVisible() {
    if ((state.level | 0) < BEACON_LV) return false;       // not yours yet
    if (state.currentSystem) return false;                 // galaxy / void tile
    if (state.currentDungeon < 1) return false;            // safe hangar
    if (state.dreadRun || rt.sdrun || rt.hcrun || rt.cgrun) return false;
    if (state.prismRun && state.prismRun.active) return false;
    if (rt.siege || rt.waves) return false;                // capture / clone fight
    return true;
  }
  function beaconAllowed() {
    if (!beaconVisible()) return false;
    if (rt.bossAlive) return false;                        // never during a boss
    return true;
  }
  function beaconState() {
    const s = beaconStats();
    return { visible: beaconVisible(), allowed: beaconAllowed(),
             locked: (state.level | 0) < BEACON_LV, needLv: BEACON_LV,
             blocked: beaconVisible() && !beaconAllowed(),
             ready: beaconAllowed() && s.cdLeft <= 0,
             cd: s.cd, left: s.cdLeft, mult: s.mult, life: s.life, loot: s.loot, ranks: s.ranks,
             active: (rt.beaconSwarm || 0) > 0, activeLeft: Math.max(0, rt.beaconSwarm || 0) };
  }
  function fireBeacon() {
    if (!beaconAllowed() || beaconLeft() > 0) return { ok: false };
    const s = beaconStats();
    state.beaconUntil = Date.now() + s.cd * 1000;   // persisted — survives a refresh
    rt.beaconT = s.cd;
    rt.beaconSwarm = s.life;
    rt.beaconLife = s.life;
    const a = rt.archer, zone = state.currentDungeon;
    // THEY ARRIVE FROM OUTSIDE. Two hundred hostiles materialising on top of you
    // is a jump-scare, not a fight — so they spawn far out at the rim and CHARGE
    // inward. `rush` overrides the normal hold-at-range behaviour so they close
    // hard, and a staggered arrival reads as a converging fleet, not a wall.
    const room = Math.max(0, BEACON.cap - rt.enemies.length);
    const n = Math.min(room, Math.max(1, s.mult));
    // WRECKFIELD TITHE is stamped on the entity, so the bonus follows the kill
    // even if the swarm window closed before it died
    const tithe = s.loot || 1;
    rt.beaconTithe = tithe;   // reused by the reinforcement trickle in beaconTick
    // XP BUDGET FOR THIS SWARM — half a level, no matter how deep the stack.
    rt.beaconXpBudget = 0.5 * C.xpToNext(state.level);
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const p = ringSpawn(a.x, a.y, BEACON.ring, BEACON.ring + 700, 24, ang);
      const x = p.x, y = p.y;
      const e = new E.Enemy(pickType(), zone, x, y);
      e.beacon = true;
      e.tithe = tithe;
      e.rush = 1;                          // charge the pilot instead of holding station
      e.spawnFx = 0.5;
      pushEnemy(e);
    }
    rt.shake = Math.min(5, (rt.shake || 0) + 3);
    burst(a.x, a.y, '#ff8a3d', 70, { speed: 420, life: 1.1, glow: true });
    rt.floats.push(new E.FloatText(a.x, a.y - 34, '◉ BEACON — ' + n + ' INBOUND', { color: '#ff8a3d', size: 28, vy: -30, life: 1.5 }));
    save();                                    // bank the cooldown immediately
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    return { ok: true, spawned: n, life: s.life };
  }
  // per-frame: burn the cooldown, and clear the swarm when its window closes
  function beaconTick(dt) {
    rt.beaconT = beaconLeft();      // mirror of the saved clock, for the HUD ring
    // AUTO BEACON — the purchased trigger, and nothing more than the trigger. It
    // asks exactly what the BUTTON asks, so every rule the manual press honours
    // is honoured here: never during a boss, never outside a zone grind, never
    // before the Lv 30 gate, and never on a live cooldown. fireBeacon() stamps
    // state.beaconUntil before it returns, so a frame that runs six sub-steps
    // cannot fire it twice.
    if (autoBeaconOn() && beaconAllowed() && beaconLeft() <= 0) fireBeacon();
    if (rt.beaconSwarm > 0) {
      rt.beaconSwarm -= dt;
      // while the beacon RUNS it keeps calling: a trickle of reinforcements, so a
      // longer window is genuinely worth more rather than just a longer countdown
      rt.beaconCall = (rt.beaconCall || 0) - dt;
      if (rt.beaconCall <= 0 && rt.enemies.length < BEACON.cap) {
        rt.beaconCall = 0.7;
        // tithe is resolved ONCE per batch — beaconStats() reaches into PASCEND and
        // the skill tree, which is not work to repeat per spawned ship
        const tithe = rt.beaconTithe || 1;
        for (let k = 0; k < 2 && rt.enemies.length < BEACON.cap; k++) {
          const a2 = rt.archer, p2 = ringSpawn(a2.x, a2.y, BEACON.ring, BEACON.ring + 600, 24);
          const e2 = new E.Enemy(pickType(), state.currentDungeon, p2.x, p2.y);
          e2.beacon = true; e2.rush = 1; e2.spawnFx = 0.5;
          e2.tithe = tithe;
          pushEnemy(e2);
        }
      }
      if (rt.beaconSwarm <= 0) {
        // survivors withdraw rather than vanishing mid-fight next to the player
        for (const e of rt.enemies) {
          if (e.beacon && !e.dead && !e.dying) {
            if (Math.hypot(e.x - rt.archer.x, e.y - rt.archer.y) > 700) { e.dead = true; e.hp = 0; }
            else { e.beacon = false; e.rush = 0; }   // too close to leave politely — let it fight
          }
        }
      }
    }
    // the beacon is void the moment the encounter stops being a zone grind. A
    // boss spawning mid-swarm does NOT cancel it — only leaving the grind does.
    if (!beaconVisible() && rt.beaconSwarm > 0) rt.beaconSwarm = 0.01;
  }

  // WHERE A HOSTILE ENTERS THE MAP.
  //
  // Every "spawn at a radius around the pilot" path used to CLAMP the result into
  // the world: Math.min(worldW - pad, …). Mid-map that does nothing. In a corner
  // most of the ring falls outside the world and every one of those angles
  // collapses onto the corner — on top of the pilot. So camping a corner had
  // hostiles delivered at point-blank instead of the intended 640–1160px out,
  // travel time went to zero, and kills/second rose for POSITION ALONE. On a kill
  // ladder that is the entire score.
  //
  // Sample angles until one lands in bounds instead, which keeps DISTANCE the
  // constant it was always meant to be regardless of where the pilot sits. If the
  // pilot is wedged so tightly that no angle on the ring fits, fall back to a
  // uniformly random point in the world that is at least rMin away — further,
  // never nearer. `prefAng` keeps an evenly-spaced ring evenly spaced in open
  // space (the beacon summon) while still being fair against an edge.
  function ringSpawn(cx, cy, rMin, rMax, pad, prefAng) {
    pad = pad || 24;
    const w = rt.worldW, h = rt.worldH, span = Math.max(0, rMax - rMin);
    const ok = (x, y) => x >= pad && x <= w - pad && y >= pad && y <= h - pad;
    for (let i = 0; i < 24; i++) {
      const ang = (i === 0 && prefAng != null) ? prefAng : Math.random() * Math.PI * 2;
      const rad = rMin + Math.random() * span;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      if (ok(x, y)) return { x, y };
    }
    for (let i = 0; i < 40; i++) {
      const x = pad + Math.random() * (w - pad * 2), y = pad + Math.random() * (h - pad * 2);
      if (Math.hypot(x - cx, y - cy) >= rMin) return { x, y };
    }
    return { x: pad + Math.random() * (w - pad * 2), y: pad + Math.random() * (h - pad * 2) };
  }
  // ---- SPAWN ACROSS THE WHOLE MAP, NOT AROUND THE PILOT ---------------------
  // ringSpawn keeps a constant DISTANCE from the pilot, which fixed hostiles
  // materialising on top of someone camping a corner. It did not fix the other
  // half of the same exploit: a ring centred on the pilot is clipped by the world
  // edges, so in a corner only about a QUARTER of it is in bounds and every
  // hostile arrives inside one narrow wedge, on one bearing, bunched together.
  // Bunched hostiles are worth far more than spread ones — multi-shot, splash,
  // the Prism aura and every AOE hit several at once, and the guns never have to
  // turn. Kills per hour then depends on WHERE THE PILOT PARKED, which on an XP
  // curve is the whole progression.
  //
  // A uniform point in the world has no such geometry: the distribution is the
  // same from the middle, an edge or a corner, so position stops being a
  // multiplier. `minDist` only keeps them from appearing in the pilot's lap; it
  // is a floor, never a ring.
  function worldSpawn(minDist, pad) {
    pad = pad || 30;
    const w = rt.worldW, h = rt.worldH;
    const a = rt.archer, cx = a ? a.x : w / 2, cy = a ? a.y : h / 2;
    const md = Math.max(0, minDist || 0);
    for (let i = 0; i < 30; i++) {
      const x = pad + Math.random() * (w - pad * 2), y = pad + Math.random() * (h - pad * 2);
      if (!md || Math.hypot(x - cx, y - cy) >= md) return { x, y };
    }
    // A world too small to hold the standoff (or a pilot dead centre of a tiny
    // one): take the farthest of the four corners rather than giving up and
    // dropping one on their head.
    let best = { x: pad, y: pad }, bd = -1;
    for (const c of [[pad, pad], [w - pad, pad], [pad, h - pad], [w - pad, h - pad]]) {
      const d = Math.hypot(c[0] - cx, c[1] - cy);
      if (d > bd) { bd = d; best = { x: c[0], y: c[1] }; }
    }
    return best;
  }
  function spawnAtNode(node) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * RESPAWN_SPREAD;
    const x = Math.max(20, Math.min(rt.worldW - 20, node.x + Math.cos(a) * r));
    const y = Math.max(20, Math.min(rt.worldH - 20, node.y + Math.sin(a) * r));
    const e = new E.Enemy(pickType(), state.currentDungeon, x, y);
    voidSkin(e);
    e.node = node; node.enemy = e;
    kothScale(e);
    pushEnemy(e);
  }
  // THE SINGLE CHOKE POINT EVERY HOSTILE PASSES THROUGH.
  //
  // At least six paths push straight into rt.enemies — beacon swarms, the siege
  // wave engine, boss spawns, other modules' spawners. Anything that has to be
  // true of every hostile in the game is stated here once rather than guarded
  // one caller at a time.
  function pushEnemy(e) {
    if (!e) return e;
    rt.enemies[rt.enemies.length] = e;
    return e;
  }
  function updateNodes(dt) {
    for (const node of rt.nodes) {
      if (node.enemy && (node.enemy.dead || node.enemy.dying)) { /* handled on death */ }
      if (!node.enemy) {
        if (node.respawnT > 0) { node.respawnT -= dt; if (node.respawnT <= 0) spawnAtNode(node); }
      }
    }
  }

  // --------------------------------------------------------------------------
  // COMBAT
  // --------------------------------------------------------------------------
  // Reused bridge object for fighters.js — see _fx below.
  // `fleetShips` is here because an escort carrier flies its own wing now
  // (fighters.js buildWings): the module has to see the fleet, not just the hull.
  const _fxo = { rt: null, state: null, C, E, hit: null, nearby: null, fleetShips: null };
  function nearestEnemy(maxDist) {
    let best = null, bd = (maxDist || Infinity) ** 2;
    for (const e of rt.enemies) {
      if (e.dying) continue;
      const d = (e.x - rt.archer.x) ** 2 + (e.y - rt.archer.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  // PERF — n-nearest without a full sort. This is called once per shot (and
  // multishot fires it repeatedly inside a single frame), and the old
  // filter().sort().slice() allocated two arrays and did an O(n log n) sort over
  // EVERY living enemy just to keep the closest 2–4. With a screen full of
  // hostiles that was the single largest per-frame cost in combat. This is one
  // pass with an insertion into a fixed n-slot buffer: no intermediate arrays,
  // O(n·k) with k ≤ 4, and identical output ordering.
  const _nearBuf = [], _nearD = [];
  function nearbyEnemies(n, exclude) {
    const ax = rt.archer.x, ay = rt.archer.y;
    _nearBuf.length = 0; _nearD.length = 0;
    const list = rt.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dying || e === exclude) continue;
      const dx = e.x - ax, dy = e.y - ay, d = dx * dx + dy * dy;
      if (_nearBuf.length < n) {
        let j = _nearBuf.length;
        while (j > 0 && _nearD[j - 1] > d) { _nearD[j] = _nearD[j - 1]; _nearBuf[j] = _nearBuf[j - 1]; j--; }
        _nearD[j] = d; _nearBuf[j] = e;
      } else if (d < _nearD[n - 1]) {
        let j = n - 1;
        while (j > 0 && _nearD[j - 1] > d) { _nearD[j] = _nearD[j - 1]; _nearBuf[j] = _nearBuf[j - 1]; j--; }
        _nearD[j] = d; _nearBuf[j] = e;
      }
    }
    return _nearBuf.slice(0, n);
  }
  // Living-enemy count without materialising an array — the wave/siege checks ran
  // rt.enemies.filter(...).length every frame purely to test for zero.
  // In-place compaction — same semantics as arr.filter(x => !x.dead), zero
  // allocation. Returns the array it was given.
  function sweepDead(a) {
    let w = 0;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (!v.dead) a[w++] = v; }
    a.length = w;
    return a;
  }
  function livingEnemies() {
    let n = 0;
    for (let i = 0; i < rt.enemies.length; i++) if (!rt.enemies[i].dying) n++;
    return n;
  }
  function rollDamage(s) {
    const crit = Math.random() * 100 < s.critChance;
    let dmg = s.attackDamage * (0.92 + Math.random() * 0.16);
    if (crit) dmg *= 1 + s.critDamage / 100;
    if (state.auto) dmg *= 0.8; // auto-mode (hands-off) deals 20% less damage
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }
  // Cycle the volley through EVERY equipped weapon hardpoint — each shot
  // carries the class (and visual) of the weapon that actually fired it.
  function nextWeapon() {
    const list = [];
    for (const k in state.equipped) {
      if (k !== 'bow' && !/^bow\d+$/.test(k)) continue;
      const it = state.equipped[k]; if (it) list.push(it);
    }
    if (!list.length) return null;
    rt.volleyIdx = ((rt.volleyIdx || 0) + 1) % list.length;
    return list[rt.volleyIdx];
  }
  // muzzle-flash palette per weapon class — the ship visibly fires DIFFERENT guns
  const MUZZLE_COL = {
    laser:   ['#bdeeff', '#5fd1ff'],
    gatling: ['#ffe6a0', '#ffaf40'],
    missile: ['#ffc9a0', '#ff7a3c'],
    rail:    ['#e9d6ff', '#b87bff'],
    plasma:  ['#c8ffdd', '#46d27a'],
    support: ['#dcffe9', '#7ce0a0'],
  };
  function fireAt(target, s, wpn, foldable) {
    const live = rt.projectiles.length;
    if (foldable && live > 90) {
      const fold = live > 180 ? 6 : 3;
      rt._foldN = (rt._foldN || 0) + 1;
      const r0 = rollDamage(s);
      if (rt._foldN % fold !== 0) {   // bank this bolt's damage into the next spawned one
        rt._bankDmg = (rt._bankDmg || 0) + r0.dmg;
        rt._bankCrit = rt._bankCrit || r0.crit;
        return null;
      }
      const p0 = new E.Projectile(rt.archer.x, rt.archer.y, target, 0, false);
      p0.damage = r0.dmg + (rt._bankDmg || 0); p0.crit = r0.crit || !!rt._bankCrit;
      rt._bankDmg = 0; rt._bankCrit = false;
      if (!wpn) wpn = nextWeapon() || (state.equipped && state.equipped.bow);
      p0.wtype = wpn && I.weaponClassOf ? I.weaponClassOf(wpn).key : 'gatling';
      p0.angle = Math.atan2(target.y - rt.archer.y, target.x - rt.archer.x);
      rt.projectiles.push(p0);
      return p0;
    }
    const p = new E.Projectile(rt.archer.x, rt.archer.y, target, 0, false);
    const r = rollDamage(s); p.damage = r.dmg; p.crit = r.crit;
    p.angle = Math.atan2(target.y - rt.archer.y, target.x - rt.archer.x);
    // weapon-class visuals: each projectile carries the class of ITS hardpoint
    if (!wpn) wpn = nextWeapon() || (state.equipped && state.equipped.bow);
    p.wtype = wpn && I.weaponClassOf ? I.weaponClassOf(wpn).key : 'gatling';
    rt.projectiles.push(p);
    return p;
  }
  // ENEMY STANDOFF FIRE — gunner vessels volley dodgeable bolts from range.
  // Bolts fly straight (no homing), are visible & avoidable, and respect the
  // no-one-shot cap in Archer.takeHit. Bosses fire a 3-bolt spread.
  function enemyFire(e) {
    if (rt.ebolts.length > 48) return;                  // perf + fairness cap
    const a = rt.archer; if (!a || a.dead) return;
    const shots = e.isCitadel ? 4 : e.isBoss ? 3 : 1;
    for (let i = 0; i < shots; i++) {
      const spread = e.isCitadel ? (i - 1.5) * 0.18 : e.isBoss ? (i - 1) * 0.22 : (Math.random() - 0.5) * 0.07;
      const ang = Math.atan2(a.y - e.y, a.x - e.x) + spread;
      const sp = e.isCitadel ? 150 : e.isBoss ? 165 : 200;
      if (!e.raidTarget) rt.ebolts.push({ x: e.x + Math.cos(ang) * e.size * 0.8, y: e.y + Math.sin(ang) * e.size * 0.8,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, ang,
        dmg: e.damage * (e.isCitadel ? 0.45 : e.isBoss ? 0.55 : 0.7), tint: e.tint, src: e, life: 2.6 });
    }
    burst(e.x + Math.cos(rt.time) * 2, e.y, e.tint, 4, { speed: 90, life: 0.22, glow: true });
  }
  function updateEbolts(dt) {
    const a = rt.archer;
    for (const b of rt.ebolts) {
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0) { b.dead = true; continue; }
      if (a && !a.dead && Math.hypot(a.x - b.x, a.y - b.y) <= a.size + 5) {
        b.dead = true;
        a.takeHit(b.dmg, b.src);
        // PRISM AURA — 1% chance to deflect the hit straight back, scaled to your firepower
        if (state.shipAura && state.shipAura[state.ship] && b.src && !b.src.dead && !b.src.dying && Math.random() < 0.01) {
          const refl = Math.max(b.dmg * 3, (rt.stats.attackDamage || 0) * 4);
          const kk = b.src.takeDamage(refl);
          rt.floats.push(new E.FloatText(b.src.x, b.src.y - b.src.size, '⟲ ' + formatNum(refl * (rt.dmgShow || 1)), { color: '#c9a0ff', size: 26, crit: true }));
          for (let i = 0; i < 10; i++) { const aa = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 120; rt.particles.push(new E.Particle(b.src.x, b.src.y, { vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, life: 0.4, size: 2 + Math.random() * 2, color: '#c9a0ff', glow: true, drag: 0.9 })); }
          if (kk) onKill(b.src);
        }
        burst(b.x, b.y, '#ff7a8a', 6, { speed: 140, life: 0.28, glow: true });
      }
    }
    sweepDead(rt.ebolts);
    if (rt.ebolts.length > 90) rt.ebolts.splice(0, rt.ebolts.length - 90);
  }

  function fire(primary) {
    const s = rt.stats;
    // SMOOTH AIM v2 (Jul 2026): shots only RECORD the desired bearing — the
    // hull glides toward it continuously in update(dt). Zero per-shot rotation
    // steps, no matter how high the fire rate.
    rt.archer.aim = Math.atan2(primary.y - rt.archer.y, primary.x - rt.archer.x);
    rt.archer.muzzle = 1;
    rt.archer.recoil = Math.min(0.7, (rt.archer.recoil || 0) * 0.55 + 0.25);   // gentle, saturating kick
    const shot = fireAt(primary, s);
    // muzzle: flash sparks tinted by the class that fired + smoke + casing
    const mc = MUZZLE_COL[shot.wtype] || MUZZLE_COL.gatling;
    const ang = rt.archer.facing;
    const mx = rt.archer.x + Math.cos(ang) * 26, my = rt.archer.y + Math.sin(ang) * 26;
    for (let i = 0; i < 6; i++) {
      const a = ang + (Math.random() - 0.5) * 0.5, sp = 150 + Math.random() * 160;
      rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.12 + Math.random()*0.12, size: 1.6 + Math.random()*2, color: i % 2 ? mc[0] : mc[1], glow: true, drag: 0.82 }));
    }
    // smoke (kinetic classes only — energy weapons leave a light shimmer instead)
    if (shot.wtype === 'gatling' || shot.wtype === 'missile') {
      rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(ang)*40, vy: Math.sin(ang)*40 - 10, life: 0.4, size: 5, color: 'rgba(180,180,185,0.5)', drag: 0.9 }));
      const ej = ang + Math.PI/2;
      rt.particles.push(new E.Particle(rt.archer.x + 6, rt.archer.y - 4, { vx: Math.cos(ej)*70, vy: -120, gravity: 420, life: 0.5, size: 1.6, color: '#d9b25a' }));
    } else {
      rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(ang)*30, vy: Math.sin(ang)*30, life: 0.25, size: 4, color: hexToRgba(mc[1], 0.35), drag: 0.88 }));
    }
    // MULTI-SHOT: chance to also fire at nearby enemies — each from its own hardpoint
    if (s.multiShot > 0 && Math.random() * 100 < s.multiShot) {
      const extra = nearbyEnemies(C.MULTISHOT_MAX_TARGETS, primary);
      extra.forEach((t) => fireAt(t, s, null, true));   // extras fold under load
    }
  }
  // PRISM AURA splash — 10% of a hit ripples to nearby foes as AOE.
  function prismSplash(src, dmg) {
    const splash = dmg * 0.10; if (splash < 1) return;
    let hits = 0;
    for (const o of rt.enemies) {
      if (o === src || o.dead || o.dying) continue;
      if (Math.hypot(o.x - src.x, o.y - src.y) <= 130) {
        const k = o.takeDamage(splash); rt.dmgWindow.push({ t: rt.time, dmg: splash });
        if (k) onKill(o);
        if (++hits >= 5) break;
      }
    }
    // one splash bloom, and only while there is room — this fires on EVERY landed
    // hit, so an unbudgeted push here is a particle per fighter strike
    if (rt.particles.length < 280) rt.particles.push(new E.Particle(src.x, src.y, { vx: 0, vy: 0, life: 0.2, size: 22, color: 'rgba(201,160,255,0.45)', glow: true, drag: 1 }));
  }
  // ---- ASCENSION: STORM CONDUIT --------------------------------------------
  // Chain-lightning proc rolled PER SECOND of combat (not per attack):
  // P(dt) = 1-(1-p)^dt so any frame rate integrates to the published %/sec.
  // A HUGE bolt drops from the sky onto the nearest ship for mult× your DPS,
  // then bounces through nearly EVERY ship on the map (85% damage per hop).
  // Bolts render as real canvas polylines (white core + cyan glow) in draw().
  function stormTick(dt) {
    if (!window.ASCEND || !window.ASCEND.storm) return;
    const a = rt.archer; if (!a || a.dead || rt.awaitingRespawn) return;
    const sc = window.ASCEND.storm(state.ship);
    if (!sc || sc.chance <= 0) return;
    if (Math.random() < 1 - Math.pow(1 - sc.chance / 100, dt)) rt.stormPending = true;
    // a banked proc NEVER fizzles — if the guns wiped the map this frame, the
    // strike waits and lands on the next ship that spawns
    if (rt.stormPending) {
      const first = nearestEnemy(Infinity);
      if (first) { rt.stormPending = false; fireStorm(sc, first); }
    }
  }
  function fireStorm(sc, first) {
    const a = rt.archer;
    if (!first) first = nearestEnemy(Infinity);   // the strike hunts across the whole map
    if (!first) return;
    rt.bolts = rt.bolts || [];
    let dmg = Math.max(1, (rt.stats.theoryDps || 1) * sc.mult);
    let fx = first.x, fy = first.y - Math.max(340, rt.h * 0.6), cur = first, jumps = 0;
    const hit = new Set();
    rt.shake = Math.min(6, (rt.shake || 0) + 5);
    rt.stormFlash = 0.35;   // lingering full-screen flash
    while (cur && jumps <= sc.chains) {
      hit.add(cur);
      pushBolt(fx, fy, cur.x, cur.y, jumps === 0 ? 1.6 : 1);
      burst(cur.x, cur.y, '#bfe9ff', 22, { speed: 300, life: 0.5, glow: true });
      const k = cur.takeDamage(dmg);
      rt.dmgWindow.push({ t: rt.time, dmg });
      // ⚡ numbers hang on screen much longer than gunfire floats
      rt.floats.push(new E.FloatText(cur.x, cur.y - cur.size, '⚡' + formatNum(dmg * (rt.dmgShow || 1)), { color: '#8fe0ff', size: 50, crit: true, life: 2.6, vy: -16 }));
      if (k) onKill(cur);
      fx = cur.x; fy = cur.y;
      let nxt = null, bd = Infinity;   // arcs bounce to the nearest un-struck ship ANYWHERE on the map
      for (const o of rt.enemies) {
        if (o.dying || o.dead || hit.has(o)) continue;
        const d = (o.x - fx) ** 2 + (o.y - fy) ** 2;
        if (d < bd) { bd = d; nxt = o; }
      }
      cur = nxt; jumps++; dmg = Math.max(1, dmg * 0.85);
    }
  }
  // jagged polyline with 1-2 branch forks — stored on rt.bolts, drawn in draw()
  function pushBolt(x1, y1, x2, y2, scale) {
    // HARD CAP (Aug 2026, the Zone-800 freeze). rt.bolts was the ONE combat array
    // with no ceiling — only a lifetime filter. Storm Conduit gear pushes a main
    // bolt + 2 forks per PROC, and at endgame proc rates (90%+ crit, multishot,
    // 5× game speed) thousands of multi-point polylines were alive at once, each
    // drawn in two render passes: the tab froze, swelled and was OOM-killed.
    // Past the cap the DAMAGE already landed (chainDamage runs first) — only the
    // decoration is skipped, and at 60+ live bolts the screen is already white.
    if (rt.bolts.length > (window.__lfPlayRecovery ? 12 : 66)) return;
    const dx = x2 - x1, dy = y2 - y1, dist = Math.hypot(dx, dy) || 1;
    const n = Math.max(5, Math.floor(dist / 34));
    const pts = [[x1, y1]];
    for (let i = 1; i < n; i++) {
      const t = i / n, jag = (Math.random() - 0.5) * Math.min(64, dist * 0.22);
      pts.push([x1 + dx * t - (dy / dist) * jag, y1 + dy * t + (dx / dist) * jag]);
    }
    pts.push([x2, y2]);
    rt.bolts.push({ pts, life: 1.15, t: 1.15, w: 5.5 * (scale || 1) });
    // forks: short offshoots from mid-points
    for (let f = 0; f < 2; f++) {
      const bi = 1 + Math.floor(Math.random() * (pts.length - 2));
      const [bx, by] = pts[bi], fa = Math.random() * Math.PI * 2, fl = 30 + Math.random() * 70;
      rt.bolts.push({ pts: [[bx, by], [bx + Math.cos(fa) * fl * 0.5 + (Math.random() - 0.5) * 24, by + Math.sin(fa) * fl * 0.5], [bx + Math.cos(fa) * fl, by + Math.sin(fa) * fl]], life: 0.8, t: 0.8, w: 2.2 });
    }
    // lingering ember trail along the bolt path
    for (let i = 0; i < pts.length; i += 2) {
      rt.particles.push(new E.Particle(pts[i][0], pts[i][1], { vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 1.1 + Math.random() * 0.5, size: 1.8 + Math.random() * 2, color: '#9fdcff', glow: true, drag: 0.96 }));
    }
    rt.particles.push(new E.Particle(x2, y2, { vx: 0, vy: 0, life: 0.6, size: 26, color: '#eaf9ff', glow: true, drag: 1 }));
  }
  // hoisted function declarations, bound once
  _fxo.hit = function (p) { return resolveHit(p); };
  _fxo.nearby = function (n, primary) { return nearbyEnemies(n, primary); };
  _fxo.fleetShips = function () { return fleetShips(); };
  // ---- AREA DAMAGE, THE WAY THIS ENGINE ALREADY DOES AREA DAMAGE ------------
  // The Prism aura is the one AOE the game already had, and it deliberately does
  // NOT route through resolveHit: it calls takeDamage + onKill and skips the
  // per-hit proc chain entirely. Fighter Ascension's Corona Mantle and Nova
  // Reclamation need that same discipline at a far higher tick rate:
  //
  //   · A CORONA PULSE IS NOT AN IMPACT. resolveHit emits 10-20 particles, a
  //     damage float, a crit shake, and rolls cryo, armor corruption, life steal
  //     and prism splash PER TARGET. A maxed wing pulsing on nine hostiles each
  //     is ~200 of those a second: it would recurse into prismSplash, hold the
  //     pilot at full hull off life steal alone, and bury the frame in particles.
  //     A PHANTOM STRIKE is the opposite case and still goes through resolveHit —
  //     it is weapon fire, fired at the craft's own cadence.
  //   · KILLS STILL PAY IN FULL. onKill() is what pays gold, XP, drops, missions
  //     and the lifetime counters, so an aura kill is worth exactly what a bolt
  //     kill is worth — and every carve-out (KOTH, cargo, Home Citadel) is
  //     decided there rather than re-implemented here.
  //   · THE DPS METER MUST SEE IT. rt.dmgWindow is what the HUD reads.
  //
  // Returns how many hostiles were bitten so the caller can pace its own FX.
  _fxo.area = function (x, y, r, dmg, max, skip) {
    dmg = Math.floor(Number(dmg) || 0);
    if (dmg < 1 || !(r > 0)) return 0;
    const r2 = r * r, cap = Math.max(1, max | 0), en = rt.enemies;
    let hits = 0;
    for (let i = 0; i < en.length; i++) {
      const o = en[i];
      if (!o || o === skip || o.dead || o.dying) continue;
      const dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy > r2) continue;
      const k = o.takeDamage(dmg);
      rt.dmgWindow.push({ t: rt.time, dmg });
      if (o.cloneRegen) o.regenHold = REGEN_SUPPRESS;
      if (k) onKill(o);
      if (++hits >= cap) break;
    }
    return hits;
  };
  function resolveHit(p) {
    const e = p.target;
    if (!e || e.dead) return;
    // PILOT: bonus damage vs bosses / elites (Dreadnaughts & Super Bosses count as both)
    let _dmg = p.damage;
    // The gate used to be `e.isBoss &&`, which quietly killed the tree's ELITE
    // half: dmgVs() adds eliteDamage for isSuper/isDread/isCitadel/isClone, but
    // it was only ever CALLED on bosses — so Apex Predator and every Elite Damage
    // node did nothing against dreadnaughts, citadels and clone fleets, the exact
    // targets they name. Gate on the same set the ascension perk below uses.
    const _elite = e.isBoss || e.isCitadel || e.isClone || e.isDread || e.isSuper;
    if (_elite && window.DREAD && window.DREAD.dmgVs) _dmg *= window.DREAD.dmgVs(e);
    // ASCENSION: Siege Protocols — bonus damage vs boss-class targets
    if (window.PASCEND && _elite) _dmg *= window.PASCEND.mult('boss');
    // AEGIS VENOM LATTICE — hostiles standing in the haze take MORE damage from
    // every source. Applied HERE, at the one point every damage path converges,
    // so bolts, fighters, drones, escorts, prism splash and the plague tick all
    // honour it without a second implementation. vulnOf() is a flag read with an
    // expiry — no distance is measured on this path.
    if (window.AEGIS) { const _v = window.AEGIS.vulnOf(e); if (_v) _dmg *= 1 + _v / 100; }
    // ARMOR CORRUPTION — a Mech Archon or Mech Titan in the fleet strips the
    // target's armor as your fleet fires into it. Read and stamped at this same
    // convergence point, so a fighter's hit, a drone's hit, an escort's hit and a
    // Prism splash all corrupt exactly as the flagship's bolt does — the Mech line
    // is a FLEET amplifier and there is no second implementation of it anywhere.
    // The read runs BEFORE the stamp: a hit is never amplified by its own stack.
    // Accrual is rate-limited on the wall clock inside the module, so fire rate
    // cannot buy a faster ramp.
    if (window.MECHCORR && window.MECHCORR.aboard()) {
      const _c = window.MECHCORR.vulnOf(e); if (_c) _dmg *= 1 + _c / 100;
      window.MECHCORR.onFleetHit(e);
    }
    const killed = e.takeDamage(_dmg);
    // FROSTYFROST — cryo tech is FLEET tech: if a FrostyFrost is anywhere in
    // your fleet (flagship OR escort), every player bolt chills the target and
    // sometimes flash-freezes it into an ice cube. Bosses are immune.
    if (frostAboard() && !p.drone && !e.isBoss && !e.dying) {
      e.chillT = Math.max(e.chillT || 0, 2.2);
      if (Math.random() < 0.12 && !(e.frozenT > 0) && (e.frostCd || 0) <= 0) {
        e.frozenT = 1.8;
        e.frostCd = 5;                      // refreeze immunity — no cube strobing under rapid fire
        rt.floats.push(new E.FloatText(e.x, e.y - e.size - 12, 'FROZEN', { color: '#aee6ff', size: 30 }));
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 120;
          rt.particles.push(new E.Particle(e.x, e.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.4 + Math.random()*0.3, size: 1.6 + Math.random()*2, color: i % 2 ? '#aee6ff' : '#e8f8ff', glow: true, drag: 0.86 }));
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 70;
          rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 20, life: 0.3, size: 1.4, color: '#aee6ff', glow: true, drag: 0.9 }));
        }
      }
    }
    // STARFORGE CRYO — 1% flash-freeze per +15 fitting (skipped when a FrostyFrost
    // is aboard — its fleet cryo field already rolled above)
    else if (!p.drone && !e.isBoss && !e.dying && (rt.stats.cryoChance || 0) > 0
             && Math.random() * 100 < rt.stats.cryoChance && !(e.frozenT > 0) && (e.frostCd || 0) <= 0) {
      e.chillT = Math.max(e.chillT || 0, 2.2);
      e.frozenT = 1.8; e.frostCd = 5;
      rt.floats.push(new E.FloatText(e.x, e.y - e.size - 12, '⚒ FROZEN', { color: '#aee6ff', size: 28 }));
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 120;
        rt.particles.push(new E.Particle(e.x, e.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.4 + Math.random()*0.3, size: 1.6 + Math.random()*2, color: i % 2 ? '#aee6ff' : '#e8f8ff', glow: true, drag: 0.86 }));
      }
    }
    // VOIDMAW SINGULARITY — stun + collapsing black hole beneath the target
    if (voidmawAboard() && !p.drone && !e.dying && (e.singCd || 0) <= 0 && Math.random() * 100 < SING.chance) {
      e.singCd = SING.cd;
      if (!e.isBoss) { e.stunT = Math.max(e.stunT || 0, SING.stun); e.frozenT = Math.max(e.frozenT || 0, 0); }
      openSingularity(e);
    }
    // PRISM AURA — 10% of your hit splashes as AOE to nearby foes
    if (state.shipAura && state.shipAura[state.ship]) prismSplash(e, p.damage);
    // AGGREGATED DAMAGE BUBBLES (Jul 2026): at endgame fire rates one bubble
    // per hit melted the frame rate. Damage now SUMS per enemy over a 0.25s
    // window and pops as ONE number — crit styling sticks if any hit in the
    // window crit; the final chunk always flushes on the killing blow.
    e._fbSum = (e._fbSum || 0) + _dmg;
    if (p.crit) e._fbCrit = true;
    if ((killed || rt.time - (e._fbT || 0) >= (rt.lod ? 0.45 : 0.25)) && rt.floats.length < (rt.lod ? 12 : 22)) {
      // rt.dmgShow lets an event render hits in ITS units. The alliance raid
      // transmits in POWER units, not raw combat damage — without this the
      // player watches 300T crits fly off and is then told the whole run
      // transmitted 1.7T, because those are two different currencies.
      rt.floats.push(new E.FloatText(e.x, e.y - e.size, formatNum(e._fbSum * (rt.dmgShow || 1)), { color: e._fbCrit ? '#e07c12' : '#f4f8ff', size: e._fbCrit ? 44 : 30, crit: !!e._fbCrit }));
      e._fbT = rt.time; e._fbSum = 0; e._fbCrit = false;
    }
    // IMPACT: class-specific hit effects — each weapon lands differently
    const back = p.angle;
    const wt = p.wtype || 'gatling';
    if (wt === 'missile') {
      // EXPLOSION — omnidirectional fireball + shockwave flash + punch
      const n = p.crit ? 18 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (p.crit ? 260 : 190) * (0.3 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.25 + Math.random()*0.3, size: 1.8 + Math.random()*3, color: i % 3 ? '#ff9a50' : '#ffd9a0', glow: i % 2 === 0, drag: 0.85 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: -16, life: 0.5, size: 7, color: 'rgba(150,150,155,0.45)', drag: 0.92 }));
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.16, size: p.crit ? 13 : 10, color: '#fff0d0', glow: true, drag: 1 }));
      if (p.crit) rt.shake = Math.min(2.2, (rt.shake || 0) + 1.1);   // non-crit fire no longer rattles the camera
    } else if (wt === 'rail') {
      // PIERCE — slug punches THROUGH: sparks continue forward + entry flash
      for (let i = 0; i < (p.crit ? 12 : 8); i++) {
        const a = back + (Math.random() - 0.5) * 0.35, sp = (p.crit ? 320 : 240) * (0.5 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.18 + Math.random()*0.16, size: 1.3 + Math.random()*1.8, color: i % 2 ? '#cfa6ff' : '#efe2ff', glow: true, drag: 0.93 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.12, size: p.crit ? 9 : 6, color: '#e9d6ff', glow: true, drag: 1 }));
    } else if (wt === 'plasma') {
      // SPLASH — molten droplets sputter and hang
      for (let i = 0; i < (p.crit ? 14 : 9); i++) {
        const a = back + (Math.random() - 0.5) * 2.2, sp = 90 * (0.3 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 20, life: 0.35 + Math.random()*0.3, size: 1.8 + Math.random()*2.6, color: i % 2 ? '#7df0a8' : '#c8ffdd', glow: true, gravity: 60, drag: 0.9 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.18, size: p.crit ? 11 : 8, color: '#d8ffe8', glow: true, drag: 1 }));
    } else if (wt === 'laser') {
      // FLASH-BURN — instant bright bloom + thin cyan embers
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.14, size: p.crit ? 11 : 8, color: '#eaf9ff', glow: true, drag: 1 }));
      for (let i = 0; i < (p.crit ? 10 : 6); i++) {
        const a = back + (Math.random() - 0.5) * 1.0, sp = 140 * (0.4 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.16 + Math.random()*0.14, size: 1.2 + Math.random()*1.6, color: i % 2 ? '#8fe0ff' : '#d9f4ff', glow: true, drag: 0.88 }));
      }
    } else {
      // kinetic spray (gatling/support) — directional sparks opposite the round
      const col = p.crit ? '#ffd24d' : (wt === 'support' ? '#a8f0c4' : '#ffcaa0'), n = p.crit ? 16 : 9;
      for (let i = 0; i < n; i++) {
        const a = back + (Math.random() - 0.5) * 1.3, sp = (p.crit ? 230 : 150) * (0.4 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.22 + Math.random()*0.22, size: 1.4 + Math.random()*2.4, color: col, glow: p.crit, drag: 0.86 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.14, size: p.crit ? 9 : 6, color: p.crit ? '#fff0b0' : '#ffe6c0', glow: true, drag: 1 }));
    }
    // ichor mist in the enemy tint (all classes)
    for (let i = 0; i < 4; i++) {
      const a = Math.random()*Math.PI*2, sp = 60 + Math.random()*90;
      rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.3, size: 1.5 + Math.random()*2, color: e.tint, gravity: 140, drag: 0.9 }));
    }
    // crit: a little screen punch
    if (p.crit) rt.shake = Math.min(2.5, (rt.shake || 0) + 1.2);
    rt.dmgWindow.push({ t: rt.time, dmg: p.damage });
    if (e.cloneRegen) e.regenHold = REGEN_SUPPRESS;   // being shot stops fleet repair
    // LIFE STEAL — hard-capped in fights against player-shaped fleets (clone
    // garrisons, citadels, void wardens). A 90% siphon made siege duels
    // unloseable on both sides: nobody died, the timer just ran out.
    const ls = Math.min(rt.stats.lifeSteal, pvpFight() ? PVP_LIFESTEAL : 19);
    if (ls > 0 && !rt.archer.dead) {
      // ...and no single hit may siphon more than 6% of your hull
      const heal = Math.min(p.damage * (ls / 100), rt.stats.maxHp * 0.06);
      if (heal >= 1 && rt.archer.hp < rt.stats.maxHp) {
        rt.archer.hp = Math.min(rt.stats.maxHp, rt.archer.hp + heal);
        if (Math.random() < 0.25) rt.floats.push(new E.FloatText(rt.archer.x, rt.archer.y - 20, '+' + formatNum(heal), { color: '#2f9e4f', size: 13, vy: -40, life: 0.7 }));
      }
    }
    if (killed) onKill(e);
  }
  function onKill(e) {
    // KING OF THE HILL PAYS NOTHING. That is the whole premise of the event, and
    // the reason entering it has a real opportunity cost: no XP, no gold, no
    // resources, no fittings, no drones — and no LIFETIME COUNTERS either.
    // totalKills and shipKills gate hull unlocks and lifetime badges, so banking
    // them here would quietly make the zone that pays nothing the fastest unlock
    // route in the game. The only thing a kill in here produces is one point on
    // the ladder, which is exactly what the pilot signed up for.
    const _kothRun = !!(rt.kothrun && rt.kothrun.active);
    if (_kothRun) {
      try { window.KOTH && window.KOTH.onKill(); } catch (_k) {}
    } else {
      state.totalKills++;
      state.shipKills[state.ship] = (state.shipKills[state.ship] || 0) + 1;
      maybeDropDrone(e);
    }
    burst(e.x, e.y, e.tint, e.isBoss ? 60 : 16, { speed: e.isBoss ? 320 : 180, life: 0.9, gravity: 120, glow: e.isBoss });
    // SPACE CARGO DEFENSE PAYS ON DELIVERY, NOT PER KILL. The instance deploys
    // far past the pilot's own ceiling, so its hostiles carry the XP and loot of
    // zones they have not earned — ten minutes of it out-levelled and out-geared
    // the entire grind. The escort's reward is the MANIFEST: gold, salvage, hard
    // currency, paid once at the Citadel. Kill gold still lands (the run is a
    // gold event), but experience and fittings do not.
    const _cargoRun = !!(rt.cgrun && rt.cgrun.active);
    // HOME DEFENSE PAYS NO XP AT ALL (Aug 2026 — it was being exploited).
    // Fort defense sets raider HP from the PILOT'S OWN DPS
    // (`run.unitHp = ps.dps * (55 + wave * 4.5) / run.N`), so every kill is
    // guaranteed to die on schedule no matter how strong you get — and auto-chain
    // rolls wave into wave with no cap. That is an XP faucet that scales with the
    // player instead of resisting them, which is the whole exploit: park in the
    // fort and out-level the entire zone grind without ever flying a zone.
    // The reward for defending the fort is the WAVE PAYOUT (gold, ore, fuel,
    // plasma, part crates, Dread Cores in grantWaveRewards) — not levels.
    const _homeRun = !!rt.hcrun;
    // VOID ZONES PAY NO XP AT ALL (Aug 2026 — same exploit, different door).
    // A Void tile's difficulty is its level requirement × 1.5 — the Lv 500
    // Singularity deploys you into ZONE 750 — and killXpFor() pays on the zone it
    // is handed. So a Lv 500 pilot standing on a tile they are barely gated for
    // farms XP priced for zone 750, which is the exact thing the cargo-escort
    // carve-out above exists to stop: hostiles carrying the XP of zones the pilot
    // has not earned. Void tiles are an INCOME and CONQUEST reward — hourly
    // resources on all four currencies, a free fixed citadel, the Warden badge —
    // and they stay that. They are not a levelling shortcut.
    // This covers the casino House Citadels too: they are `void: true` tiles with
    // the identical ×1.5 difficulty inflation, so they are the same exploit.
    const _voidRun = inVoidSystem();
    // THE DREADNAUGHT HUNT PAYS NO XP EITHER (build 711). Same door again: the
    // hunt deploys into a zone priced off its TIER, not off the pilot — T20 is
    // Level 505 content — and killXpFor() pays on the zone it is handed. Thirty
    // escalating waves of hostiles carrying zone-505 XP is the fastest levelling
    // in the game and it is available to anyone who can survive one deploy.
    // The hunt's reward is the hunt's reward: Dread Cores, the raid-boss drop
    // table, gold and loot, all untouched below. It is not a levelling route.
    const _dreadRun = !!(state.dreadRun && state.dreadRun.active);
    // THE MECH FOUNDRY pays cores, loot and gold — never levels. Same shape as
    // every other entry on this list: the run deploys into a zone priced off its
    // TIER (T5 is Zone 560 content) rather than off the pilot, and killXpFor()
    // pays on the zone it is handed — so without this the fastest levelling in
    // the game would sit behind one Deploy button.
    const _mechRun = !!(state.mechRun && state.mechRun.active);
    if (_mechRun && e && e.mechKey && window.MECHF) {
      try { window.MECHF.onMechKill(); } catch (x) {}
      // ROLL 1 — a Commander drop. Foundry ground only, which is the whole point:
      // the chase has exactly one hunting ground.
      try { if (window.COMMANDERS) window.COMMANDERS.onFoundryKill(e, !!e.isBoss); } catch (x) {}
    }
    if (!_cargoRun && !_homeRun && !_voidRun && !_kothRun && !_dreadRun && !_mechRun) {
      // BOSSES PAY NO XP BONUS. The 12× multiplier made boss dungeons the
      // fastest XP in the game by a wide margin — a repeatable boss is one kill
      // worth twelve, on a fight you can queue back to back, which is a farm
      // rather than an encounter. A boss now pays exactly what any kill in that
      // zone pays. Gold, loot and drops keep the full 12×: the reward for
      // killing a boss is still a boss's reward, it just is not levels.
      let xp = killXpFor(e.dungeon);
      const _tithe = e.tithe || 1;
      // THE TITHE WAS A LOOT BONUS THAT ALSO PAID FULL XP. Wreckfield Tithe stacks
      // to several × and EVERY beacon-summoned kill carries it, so a swarm paid its
      // entire kill count at multiplied XP — "press Beacon, gain 3 levels". Gold,
      // salvage and loot keep the whole tithe; XP now takes a quarter of it.
      if (_tithe > 1) xp *= 1 + (_tithe - 1) * 0.25;
      if (e.beacon) {
        // HARD CEILING PER SWARM. However the perks stack, one beacon window can
        // never pay more than half a level. It is a farming tool, not a level
        // button. Gold and loot from the same kills are untouched.
        const m = xpMultCached() || 1;
        const left = rt.beaconXpBudget || 0;
        const eff = xp * m;
        if (left <= 0) xp = 0;
        else if (eff > left) { xp = left / m; rt.beaconXpBudget = 0; }
        else rt.beaconXpBudget = left - eff;
      }
      if (xp > 0) gainXp(xp);
    }
    if (!_kothRun) {
    state.gold += C.enemyGold(e.dungeon) * (e.isBoss ? 12 : 1) * (e.tithe || 1) * (window.DREAD ? window.DREAD.mult('goldFind') : 1) * (window.PASCEND ? window.PASCEND.mult('gold') : 1) * proMods().gold;   // PILOT: Gold Find · ASCENSION: Prize Courts · BEACON: Wreckfield Tithe
    // RESOURCE SCAVENGE — kills now leak Galaxy Resources. Fuel is common;
    // iron & plasma are the rare finds (rarer, but a real grind faucet now).
    // Bosses always pay a wreck's worth of all three.
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    if (e.isBoss) {
      const z = e.dungeon || state.currentDungeon;
      state.resources.fuel += 40 + z * 4;
      state.resources.iron += 18 + z * 2;
      state.resources.plasma += 12 + Math.round(z * 1.5);
    } else if (Math.random() < 0.14) {
      const z = e.dungeon || state.currentDungeon;
      const r = Math.random();
      const kind = r < 0.45 ? 'fuel' : r < 0.78 ? 'iron' : 'plasma';
      const base = kind === 'fuel' ? 3 + z * 0.5 : kind === 'iron' ? 2 + z * 0.35 : 1.5 + z * 0.3;
      const amt = Math.max(1, Math.round(base * (0.7 + Math.random() * 0.6)));
      state.resources[kind] += amt;
      const rc = kind === 'fuel' ? '#5bc0ff' : kind === 'iron' ? '#d0a060' : '#c07bff';
      const rg = kind === 'fuel' ? '⬢' : kind === 'iron' ? '◆' : '✦';
      rt.floats.push(new E.FloatText(e.x, e.y - e.size - 14, rg + ' +' + formatNum(amt), { color: rc, size: 13, vy: -34, life: 0.8 }));
    }
    }
    if (e.isClone) bumpLife('clones', 1);            // FLEETBREAKER badge
    // ✦ FRACTURE ZONE — anything that dies in the Aeternum's rift drops one EXTRA
    // fitting, rolled two rarity tiers above the zone's normal quality. The tithe
    // (gold / xp / salvage) is stamped on the entity itself in lanceTick.
    if (e.fracT) {
      e.fracT = 0;
      if (!lootBlocked()) try {
        const zone = e.dungeon || state.currentDungeon;
        const base = rollRarityBoosted(zone, Math.min(2, qualityMult(zone) * 3));
        const item = I.generate(zone, Math.min(Math.min(10, C.rarityCap(zone) + 1), base + 2));
        state.itemsFound++; countRareFind(item);
        rt.ground.push(new E.GroundItem(e.x + (Math.random() - 0.5) * 30, e.y + (Math.random() - 0.5) * 30, item, false));
        lootBurst(e.x, e.y, item.rarity);
        if (window.UI) window.UI.onLoot(item, true);
      } catch (x) {}
    }
    if (e.isCitadel) { citadelDown(e); if (window.UI) window.UI.syncStatsTab(); return; }

    // PRISM MINING — kills inside a Prism Field refine into Prism Ingots.
    if (!_kothRun && state.prismRun && state.prismRun.active && window.PRISM && window.PRISM.onKill) {
      const _pn = window.PRISM.onKill(e.dungeon || state.currentDungeon, e.isBoss);
      if (_pn > 0) rt.floats.push(new E.FloatText(e.x, e.y - e.size - 26, '◈ +' + formatNum(_pn), { color: '#ff2a2f', size: 14, vy: -42, life: 0.95 }));
    }
    // PRISM FLEET — the gauntlet boss died: hand off to the event for artifact rolls.
    if (e.isPrismFleet && window.PRISMFLEET && window.PRISMFLEET.onBossKill) { try { window.PRISMFLEET.onBossKill(e); } catch (x) {} }

    if (e.isBoss) {
      const isSuper = !!e.isSuper;
      rt.boss = null; rt.bossAlive = false; rt.superBossAlive = false; rt.lastBoss = rt.time;
      rt.bossTimer = rt.bossInit = 600 + Math.random() * 300; // reset 10–15 min
      state.stats = state.stats || {}; state.stats.bossKills = (state.stats.bossKills || 0) + 1; // missions credit
      bossLoot(e, isSuper);
      // EMBER CHOIR — killing the hull that ends a Choir-claimed zone carries a
      // small chance to recover it. Rolled here, on the kill, so it fires whether
      // the zone ended on a roaming boss or the boss after a wave-zone finale.
      if (e.ember) {
        const r = emberTechRoll();
        if (r && window.UI && window.UI.emberTechResult) window.UI.emberTechResult(r);
      }
      // BLUEPRINT: this zone's boss may hold the schematics for a hull.
      grantBlueprintFor(state.currentDungeon);
      if (window.UI) { window.UI.bossEvent(isSuper ? 'superdown' : 'down'); window.UI.syncStatsTab(); }
      return;
    }

    // normal kill: free node + start respawn timer; kills hasten the boss.
    // SWARM ZONES respawn near-instantly — the waves must never stop.
    if (e.node) {
      const swarm = isSwarmZone(state.currentDungeon) && !state.currentSystem;
      e.node.enemy = null; e.node.respawnT = (swarm ? 1.2 : RESPAWN_SEC) / (rt.tileRespawnMult || 1);
    }
    if (!rt.bossAlive) rt.bossTimer = Math.max(0, rt.bossTimer - 4);
    commitTileShield();   // first blood in a contested tile arms its 24 h shield
    // SWARM ZONES drop junk: 25% of the normal drop rate, rolled 2 tiers lower.
    const _swarmKill = isSwarmZone(state.currentDungeon) && !state.currentSystem;
    if (!lootBlocked() && Math.random() < C.dropChance(state.currentDungeon) * (_swarmKill ? SWARM_DROP_MULT : 1) * (window.PASCEND ? window.PASCEND.mult('loot') : 1) * (e.tithe || 1) * proMods().loot) {
      const _q = _swarmKill ? 1 : lootQ();
      let item = _q > 1 ? I.generate(state.currentDungeon, rollRarityBoosted(state.currentDungeon, _q)) : I.generate(state.currentDungeon);
      if (_swarmKill && item.rarity > 0) item = I.generate(state.currentDungeon, Math.max(0, item.rarity - SWARM_RARITY_PENALTY));
      state.itemsFound++; countRareFind(item);
      lootBurst(e.x, e.y, item.rarity);
      rt.ground.push(new E.GroundItem(e.x, e.y, item, false));
      if (window.UI) window.UI.onLoot(item, true);
    }
    if (window.UI) window.UI.syncStatsTab();
  }

  // ---- BOSS ----------------------------------------------------------------
  // ---- CARGO HOLD (inventory cap) ------------------------------------------
  // 100 slots to start. Each +100 expansion costs exponentially more gold —
  // deep hoarding is a luxury you grind for. When the hold is full, new loot
  // pickups are auto-scrapped into Galaxy Resources (with a periodic warning).
  const INV_BASE_CAP = 100, INV_STEP = 100, INV_COST_BASE = 10e6, INV_COST_MULT = 25;
  function invCap() { return INV_BASE_CAP + (state.invSlotsBought || 0) * INV_STEP; }
  function invSlotCost() { return Math.floor(INV_COST_BASE * Math.pow(INV_COST_MULT, state.invSlotsBought || 0)); }
  function buyInvSlots() {
    const c = invSlotCost();
    if (state.gold < c) return { ok: false, reason: 'gold' };
    state.gold -= c;
    state.invSlotsBought = (state.invSlotsBought || 0) + 1;
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, cap: invCap() };
  }
  function addToInventory(item) {
    if (state.inventory.length >= invCap()) {
      addSalvage(item); // full hold → the item is scrapped for resources
      if (window.UI && window.UI.lootScrapped) window.UI.lootScrapped(item);
      if (window.UI && (!rt.cargoWarnT || rt.time - rt.cargoWarnT > 8)) {
        rt.cargoWarnT = rt.time;
        window.UI.unlockToast('⚠ Cargo full (' + invCap() + ') — loot auto-scrapped. Expand the hold in Loot.');
      }
      return false;
    }
    state.inventory.push(item);
    return true;
  }

  function spawnFleetBoss(stage) {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.26;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isPrismFleet = true; b.fleetStage = stage;
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    const ttk = 12 * Math.pow(1.5, stage - 1);   // seconds-to-kill grows exponentially with stage
    b.maxHp = b.hp = Math.max(5000, Math.round(dps * ttk));
    b.damage = (b.damage || 10) * (1 + stage * 0.3);
    b.speed *= 0.5; b.size = 96; b.ranged = true; b.range = 470; b.fireCd = 2.0; b.fireT = 1.0;
    b.tint = '#c9a0ff'; b.name = 'Prism Fleet · Stage ' + stage;
    if (pushEnemy(b)) { rt.boss = b; rt.bossAlive = true; rt.superBossAlive = false; }
    burst(cx, cy, '#c9a0ff', 70, { speed: 320, life: 1.1, glow: true });
    return b;
  }
  function spawnBoss(opts) {
    opts = opts || {};
    const pool = allowedEnemies();
    const type = pool[pool.length - 1]; // toughest type available
    const m = 40, side = (Math.random() * 4) | 0;
    let x, y;
    if (side === 0) { x = Math.random() * rt.worldW; y = m; }
    else if (side === 1) { x = rt.worldW - m; y = Math.random() * rt.worldH; }
    else if (side === 2) { x = Math.random() * rt.worldW; y = rt.worldH - m; }
    else { x = m; y = Math.random() * rt.worldH; }
    // SUPER BOSS: forced via opts.super, else a zone-scaled chance (harder zones
    // breed Super Bosses more often). A far bigger, red-pulsing premium elite.
    const isSuper = opts.super != null ? opts.super
      : (Math.random() < Math.min(0.45, 0.12 + state.currentDungeon * 0.004));
    const b = new E.Enemy(type, state.currentDungeon, x, y);
    b.isBoss = true; b.isSuper = isSuper;
    // base enemy HP is now grind-tuned (6x), so boss multipliers come DOWN to
    // keep boss fights long-but-fair rather than endless
    b.maxHp *= isSuper ? 16 : 8; b.hp = b.maxHp;
    b.damage *= isSuper ? 3.0 : 2.3;
    b.size *= isSuper ? 3.1 : 2.5;
    b.speed *= 0.72;
    b.name = isSuper ? ('SUPER ' + type.name + ' Prime') : (type.name + ' Alpha');
    // INVADED TILE — the zone boss is a Kaevith command hull, not the local fauna
    if (xenSkin(b, true)) b.name = isSuper ? 'KAEVITH OVERSEER' : 'KAEVITH WARDEN';
    // CHOIR-CLAIMED ZONE — the encounter that ends the zone is a Choir hull.
    // Checked after xenSkin because the two events never overlap: Kaevith lives on
    // galaxy tiles, the Choir in Zone Grind, and isEmberBossPending() requires no
    // currentSystem.
    else if (emberSkin(b, true)) {
      const nm = (C.SHIP_BY_KEY[EMB_KEYS[b.emberTier - 1]] || {}).name || 'CHOIR HULL';
      b.name = nm.toUpperCase();
      b.isSuper = isSuper;
    }
    if (pushEnemy(b)) { rt.boss = b; rt.bossAlive = true; rt.superBossAlive = isSuper; }
    burst(x, y, isSuper ? '#ff2a4a' : '#e23b4e', isSuper ? 90 : 50, { speed: isSuper ? 360 : 280, life: 1.1, glow: true });
    if (window.UI) window.UI.bossEvent(isSuper ? 'super' : 'spawn');
    return b;
  }
  // ---- DREADNAUGHT raid boss (Dreadnaught Hunt) ----------------------------
  const _dreadImgCache = {};
  function dreadImg(tier) {
    const n = ((Math.max(1, tier) - 1) % 6) + 1;
    if (!_dreadImgCache[n]) { const im = new Image(); im.src = 'ships/dread-' + n + '.png'; _dreadImgCache[n] = im; }
    return _dreadImgCache[n];
  }
  function dreadLevelFor(tier) { return 5 + tier * 25; }   // tier1→30, tier2→55, tier3→80 …
  function spawnDreadnaught(tier) {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.24;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isSuper = true; b.isDread = true; b.dreadTier = tier;
    // HP is anchored to the player's own DPS so a Dreadnaught is ALWAYS a real
    // raid (a long, multi-phase fight) no matter how over- or under-geared you are.
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    const ttk = 26 + tier * 6;
    b.maxHp = b.hp = Math.max(20000, Math.round(dps * ttk));
    b.damage = (b.damage || 10) * (2.2 + tier * 0.1);
    b.speed *= 0.42; b.size = 118 + Math.min(54, tier * 4);
    b.ranged = true; b.range = 560; b.fireCd = 1.3; b.fireT = 1.2;
    b.tint = '#ff2a3a';
    b.spriteImg = dreadImg(tier);
    b.name = 'DREADNAUGHT · Lv ' + dreadLevelFor(tier);
    if (pushEnemy(b)) { rt.boss = b; rt.bossAlive = true; rt.superBossAlive = true; }
    burst(cx, cy, '#ff2a3a', 110, { speed: 380, life: 1.3, glow: true });
    if (window.UI) window.UI.bossEvent('super');
    return b;
  }
  // The boss meter counts SIM seconds, and update() is handed dt already
  // multiplied by gameSpeed — so at 5× a readout of "300" burns down in 60 real
  // seconds. The countdown now reports the seconds a player actually waits at
  // the CURRENT speed. Two other gates were invisible: kills strip 4s each, and
  // spawnBoss() also demands 300 sim-seconds since the last boss — the meter
  // could sit at 0:00 with no boss in sight. Report whichever gate clears last.
  function getBossInfo() {
    if (rt.bossAlive && rt.boss) return { alive: true, hp: rt.boss.hp, max: rt.boss.maxHp, name: rt.boss.name };
    const sp = Math.max(1, state.gameSpeed | 0);
    const cdLeft = Math.max(0, 300 - (rt.time - rt.lastBoss));
    const simLeft = Math.max(rt.bossTimer, cdLeft);
    const prog = rt.bossInit > 0 ? Math.max(0, Math.min(1, 1 - simLeft / rt.bossInit)) : 0;
    return { alive: false, progress: prog, timeLeft: Math.max(0, Math.ceil(simLeft / sp)), speed: sp, held: cdLeft > rt.bossTimer };
  }

  // --------------------------------------------------------------------------
  // DEATH PENALTY — drop 1 item, lost forever
  // --------------------------------------------------------------------------
  // Everything a death is ALLOWED to take. Protected items (the Evolving Paragon
  // Cannon) are excluded here rather than at each removal site, so a future third
  // loss mechanic inherits the protection instead of re-introducing the hole.
  //
  // This mattered most in catastrophicLoss(), which sorts by power and rolls the
  // strongest item at 100%: the cannon is by construction the most powerful item
  // its owner has, so it was a GUARANTEED first loss on every Lv 100+ death.
  // AXIOM.sync() would silently re-mint it, so the bug read as "my cannon jumped
  // out of its slot and my Ship Score dropped" rather than as an item loss.
  function lossPool() {
    const pool = [];
    C.SLOT_KEYS.forEach((s) => { const it = state.equipped[s]; if (it && !unsellable(it)) pool.push({ from: 'eq', slot: s, item: it }); });
    state.inventory.forEach((it) => { if (!unsellable(it)) pool.push({ from: 'inv', item: it }); });
    return pool;
  }
  function dropOnDeath() {
    const pool = lossPool();
    if (!pool.length) return null;
    const pick = pool[(Math.random() * pool.length) | 0];
    if (pick.from === 'eq') { state.equipped[pick.slot] = null; refreshStats(); }
    else { const idx = state.inventory.indexOf(pick.item); if (idx >= 0) state.inventory.splice(idx, 1); }
    state.itemsLost++;
    // visible "lost" marker on the ground that can't be collected
    rt.ground.push(new E.GroundItem(rt.archer.x + (Math.random()-0.5)*20, rt.archer.y + 10, pick.item, true));
    burst(rt.archer.x, rt.archer.y, '#888', 14, { speed: 120, life: 0.8 });
    return pick.item;
  }

  // CATASTROPHIC LOSS (Lv 100+) — a destroyed ship can claim your WHOLE hold. Every
  // item is rolled in turn at HALF the previous chance: 100% · 50% · 25% · 12.5% …
  // Best gear is rolled first, so the guaranteed loss always stings.
  function catastrophicLoss() {
    const pool = lossPool();
    if (!pool.length) return [];
    pool.sort((a, b) => I.itemPower(b.item) - I.itemPower(a.item));
    const lost = []; let chance = 1;
    for (const p of pool) {
      if (Math.random() < chance) {
        if (p.from === 'eq') state.equipped[p.slot] = null;
        else { const idx = state.inventory.indexOf(p.item); if (idx >= 0) state.inventory.splice(idx, 1); }
        lost.push(p.item); state.itemsLost++;
        rt.ground.push(new E.GroundItem(rt.archer.x + (Math.random() - 0.5) * 32, rt.archer.y + 8 + Math.random() * 14, p.item, true));
      }
      chance *= 0.5;
    }
    if (lost.length) refreshStats();
    burst(rt.archer.x, rt.archer.y, '#888', 22, { speed: 150, life: 0.9 });
    return lost;
  }

  // --------------------------------------------------------------------------
  // PARTICLES
  // --------------------------------------------------------------------------
  function burst(x, y, color, n, opts = {}) {
    const pc = rt.particles.length;
    // PARTICLE BUDGET — halved during a cargo run, where 25-40 hostiles are dying
    // on a hand-flown escort and every explosion competes with the freighter for
    // frame time.
    if (pc > Math.max(30, Math.round(((rt.cgrun && rt.cgrun.active) ? 120 : 240) * _partScale()))) return;
    const speed = (opts.speed ?? 140) * 1.25;
    n = Math.ceil(n * 1.7);                               // more debris everywhere
    if (pc > 160) n = Math.max(1, Math.ceil(n * 0.3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.8);
      rt.particles.push(new E.Particle(x, y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: (opts.life ?? 0.6)*(0.7+Math.random()*0.7), size: (opts.size ?? (2+Math.random()*2.5)) * 1.5, color, gravity: opts.gravity ?? 0, glow: true }));
    }
  }
  // The EVOLVING PARAGON CANNON is unsellable, enforced HERE not by a flag nobody reads.
  // It re-mints itself when missing, so a sellable Axiom is an infinite gold
  // printer: sell at Paragon rarity → refreshAll → refreshStats → sync() sees no
  // copy → free replacement → repeat. Re-minting is a recovery path for a
  // genuinely lost item; it must never be reachable by choice.
  // Declared as a hoisted function, not a const: autoSellSweep() sits ~450 lines
  // above the old declaration site and would have been a temporal-dead-zone trap
  // for anything that ever called it during module init.
  function unsellable(it) { return !!(it && (it.axiom || it.noSell)); }

  // ---- pickup filter / auto-sell helpers ------------------------------------
  function autoSellTier() { return state.autoSellTier == null ? -1 : state.autoSellTier; }
  // Would this drop upgrade ANY of the flagship's slots for its base type?
  //
  // `strict` DROPS THE EMPTY-SLOT CLAUSES, and that is what makes auto-sell work
  // at all. An empty hardpoint answered "yes, an upgrade" for EVERY item of its
  // base type, not for one — so a single unfitted escort slot vetoed the sale of
  // an unlimited number of greys, forever. A player with escorts and Always-equip
  // off has dozens of permanently empty slots, which is the reported "auto-sell
  // does nothing": the predicate was never wrong about any single item, it was
  // just being asked a question with no quota attached.
  //
  // The pickup path still asks the loose question (an item that could fill an
  // empty slot is worth carrying home); autoSellSweep() asks the strict one and
  // hands out the empty slots itself, one item each. See it for the quota.
  function isPickupUpgrade(item, strict, skipHangar) {
    const targets = slotsForBase(item.slot);
    if (!targets.length) return false;
    // CAN THE HULL BEING FLOWN EVEN MOUNT IT?
    //
    // The flagship test below is a POWER comparison against whatever sits in the
    // matching slots, and it used to run for items the flagship structurally
    // refuses. The four AEGIS FIELD PROJECTORS and the Warden Array are `bow`
    // items, so on any hull that is not an Aegis they were power-compared against
    // the CANNONS — a category error. An aura projector rolls ordinary stat lines,
    // so it usually came out above the weakest cannon, returned "this is an
    // upgrade", and was therefore pinned in the hold forever: auto-sell would
    // never clear hull-locked gear the pilot cannot fit and may not even own the
    // hull for. That is the reported "Aegis-only items don't auto-sell properly".
    //
    // The fleet loop below already asked this question. The flagship never did.
    const flagOk = canMountWeapon(item, state.ship);
    if (flagOk) {
      let weakest = Infinity, empty = false;
      targets.forEach((t) => { const e = state.equipped[t]; if (!e) empty = true; else weakest = Math.min(weakest, I.itemPower(e)); });
      // itemPower > Infinity is false, so an all-empty target set correctly
      // answers "no" under strict rather than falling through to a keep.
      if ((empty && !strict) || I.itemPower(item) > weakest) return true;
    }
    // FLEET-AWARE (Jul 2026): a drop that upgrades ANY escort's fitting is kept
    // too — auto-sell must never scrap gear the rest of the fleet needs.
    for (const sh of fleetShips()) {
      if (!canMountWeapon(item, sh.key)) continue;
      const fit = (state.fittings || {})[sh.key] || {};
      const eT = C.shipSlots(sh.key).filter((sk) => C.slotBase(sk) === item.slot);
      for (const t of eT) { const e = fit[t]; if (e ? I.itemPower(item) > I.itemPower(e) : !strict) return true; }
    }
    // …AND HANGAR-AWARE, for the hull-locked case only.
    //
    // Gating the flagship test above is what lets a projector sell — but on its own
    // it would also scrap projectors belonging to an Aegis parked in the HANGAR,
    // which is a hull the account owns and can fly at any time. Losing the only
    // Venom Lattice a pilot has ever seen because they happened to be flying a
    // Titan is not a convenience, it is a loss.
    //
    // So for an item this flagship cannot mount, ask every OWNED hull that can, on
    // exactly the terms the fleet loop uses: better than what is in its slots, or
    // (loose mode only) filling an empty one. Anything no owned hull can use stays
    // eligible, which is what makes auto-sell work again.
    // `skipHangar` — ONLY autoSellSweep() passes it, because the sweep hands the
    // parked hulls' slots out itself, one item each. Without a quota this branch
    // was an UNBOUNDED keep: an owned Aegis with a Rare projector fitted kept
    // every better projector that ever dropped, for ever, because a parked hull is
    // never auto-equipped so the fitted item never improves. That is the reported
    // "Aegis items still don't auto sell" — the 730 pass bounded the EMPTY-slot
    // case and left this one open. The pickup path still asks the loose question.
    if (!flagOk && !skipHangar) {
      const owned = state.ownedShips || {};
      for (const k in owned) {
        if (!owned[k] || !C.SHIP_BY_KEY[k] || !canMountWeapon(item, k)) continue;
        const fit = (state.fittings || {})[k] || {};
        const eT = C.shipSlots(k).filter((sk) => C.slotBase(sk) === item.slot);
        // A parked hull that can mount something NOTHING ELSE CAN is the whole
        // point of this branch — the Aegis projectors and the Warden Array, which
        // `canMountWeapon()` locks to `cls === 'Aegis'`, and fighter bays, which it
        // locks to a hull with `fighterCapacity`. Only those reach here; anything
        // the flagship can physically mount was decided above. So the power
        // comparison stays: an owned Aegis with a weaker projector fitted is a real
        // home for a better one, and that gear cannot be farmed by flying anything
        // else. (Tried removing it in the 730 auto-sell pass and reverted — it does
        // not touch ordinary cannons, so it was never what pinned a full hold.)
        for (const t of eT) { const e = fit[t]; if (e ? I.itemPower(item) > I.itemPower(e) : !strict) return true; }
      }
    }
    return false;
  }

  // EVERY UNFITTED HARDPOINT ON THE ACCOUNT, once — flagship, every escort in
  // the wing, every hull parked in the hangar. Deduped by hull, because a hull
  // can legitimately appear in all three lists and its slots must only be
  // countable once (the flagship reads state.equipped; everything else reads its
  // own state.fittings entry).
  //
  // A HOLE KNOWS WHETHER ITS HULL IS IN SERVICE (Aug 2026). Every hole used to
  // count the same, and each one reserves one item from the sweep — so on a
  // mature account the quota was the sum of every unfitted slot on every hull
  // ever owned. Hulls ride through every ascension and a parked hull's slots are
  // never filled, so that is hundreds of permanently reserved holes: bounded in
  // theory, and indistinguishable from "auto-sell does nothing" for exactly the
  // players with a fleet big enough to notice. That is the second half of the
  // same bug the Aug 2026 note in autoSellSweep() describes fixing.
  //
  // `service` is the flagship and the escorts actually flying. Parked hulls still
  // get holes, and autoSellSweep() lets an item claim one ONLY when nothing in
  // service can mount it — which is precisely the hull-locked case (an Aegis
  // projector while you fly a Titan) that must never be sold, and nothing else.
  function emptyHardpoints() {
    const out = [], seen = {}, fitAll = state.fittings || {};
    const add = (hull, fit, service) => {
      if (!hull || seen[hull] || !C.SHIP_BY_KEY[hull]) return;
      seen[hull] = 1;
      // A PARKED HULL'S FITTED SLOTS ARE HOLES TOO — carrying what sits in them.
      // Only ONE better item can claim each, which is what gives the hull-locked
      // upgrade case (an Aegis in the hangar with a weak projector in it) the same
      // quota the empty-slot case already had. In service, a fitted slot is not a
      // hole at all: autoEquip keeps those current, and isPickupUpgrade() vetoes
      // anything that beats them before the auction is reached.
      C.shipSlots(hull).forEach((sk) => {
        if (fit[sk] && service) return;
        out.push({ hull, base: C.slotBase(sk), taken: 0, service: !!service, cur: (!service && fit[sk]) || null });
      });
    };
    add(state.ship, state.equipped || {}, true);
    fleetShips().forEach((sh) => add(sh.key, fitAll[sh.key] || {}, true));
    const owned = state.ownedShips || {};
    for (const k in owned) if (owned[k]) add(k, fitAll[k] || {}, false);
    return out;
  }
  // Can anything ACTUALLY FLYING mount this? The flagship or an escort in the
  // wing. Used only to decide whether a parked hull is allowed to reserve a copy.
  function inServiceCanMount(item) {
    try {
      if (canMountWeapon(item, state.ship)) return true;
      for (const sh of fleetShips()) if (canMountWeapon(item, sh.key)) return true;
    } catch (e) { return true; }   // on any doubt, behave as before: keep the item
    return false;
  }

  function lootBurst(x, y, rarity) {
    const col = C.RARITY[rarity].color;
    burst(x, y, col, 10 + rarity * 3, { speed: 120, life: 0.9, glow: rarity >= 2, gravity: -40 });
  }
  // Boss drop table. A normal boss pays ~5× quality across 5 drops; a SUPER BOSS
  // rolls the rarity ~25× (keep-best), drops 12 items with a couple guaranteed
  // Legendary+, and pays out a Galaxy-Resource bounty.
  // NO FITTINGS DROP IN THE VOID (Aug 2026 — with the XP, for the same reason).
  // A Void tile deploys at level requirement × 1.5, so its wrecks roll on the
  // INFLATED zone: `I.generate(750)` on the Lv 500 spire, with a rarity cap and
  // quality curve to match. That out-geared the grind exactly the way it
  // out-levelled it. Gold, Galaxy Resources and the tile's hourly income are the
  // Void's prize and are untouched — fittings are not.
  function bossLoot(e, isSuper) {
    const zone = state.currentDungeon;
    if (lootBlocked()) {
      // the resource bounty still pays; the 5–12 fittings do not
      if (isSuper) {
        if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
        const f2 = 200 + zone * 30, i2 = 80 + zone * 12, p2 = 50 + zone * 10;
        state.resources.fuel += f2; state.resources.iron += i2; state.resources.plasma += p2;
        if (window.UI) window.UI.unlockToast('Super Boss bounty · +' + formatNum(f2) + ' fuel · +' + formatNum(i2) + ' iron · +' + formatNum(p2) + ' plasma');
      }
      return;
    }
    const drops = isSuper ? 12 : 5;
    const qMul = Math.min(2, qualityMult(zone) * (rt.tileLoot || 1) * (isSuper ? 2 : 1));
    const rcap = Math.min(10, C.rarityCap(zone) + 1); // bosses beat the zone cap by ONE tier, never more
    for (let i = 0; i < drops; i++) {
      const base = rollRarityBoosted(zone, qMul);
      let boosted = Math.min(rcap, base + (isSuper ? 5 : 3) + ((Math.random() * 2) | 0));
      if (isSuper && i < 2) boosted = Math.max(boosted, Math.min(rcap, 4)); // guarantee Legendary+ where the zone allows
      const item = I.generate(zone, boosted);
      state.itemsFound++; countRareFind(item);
      const a = Math.PI * 2 * (i / drops), r = 26 + Math.random() * 26;
      rt.ground.push(new E.GroundItem(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, item, false));
      lootBurst(e.x, e.y, item.rarity);
      if (window.UI) window.UI.onLoot(item, true);
    }
    if (isSuper) {
      if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
      const fuel = 200 + zone * 30, iron = 80 + zone * 12, plasma = 50 + zone * 10;
      state.resources.fuel += fuel; state.resources.iron += iron; state.resources.plasma += plasma;
      if (window.UI) window.UI.unlockToast('Super Boss bounty · +' + formatNum(fuel) + ' fuel · +' + formatNum(iron) + ' iron · +' + formatNum(plasma) + ' plasma');
    }
  }

  // --------------------------------------------------------------------------
  // MOVEMENT / AI
  // --------------------------------------------------------------------------
  // ---- FLIGHT MODEL --------------------------------------------------------
  // The ship holds a velocity and steers it toward where it wants to be, rather
  // than being written directly onto the line to its target. That single change
  // is what turns the arena from a set of straight dashes into flight: the hull
  // banks into a turn, carries momentum out of one, and a retarget nudges the
  // curve instead of teleporting the heading.
  // TURN is frame-rate independent (exp), so it behaves identically at 1× and
  // inside a 10× sub-step. It is deliberately brisk — this is a ship the player
  // is steering, not a physics toy.
  // HEADING AND SPEED ARE STEERED SEPARATELY. Easing the velocity VECTOR toward
  // a new one looks wrong for exactly the reason it is easy to write: blending
  // (300,0) toward (0,300) passes through (150,150), which is 30% slower than
  // either. So every time the ship changed target it dipped almost to a stop,
  // pivoted, and accelerated again — the hard ridge at each pickup. Rotating the
  // heading at a bounded angular rate while the SPEED eases independently gives
  // a banked turn that holds its pace the whole way round.
  const TURN_RATE = 6.5;    // radians/sec of heading change at cruise
  const ACCEL_RATE = 9;     // how fast the throttle responds
  function steerArcher(wx, wy, dt) {
    const a = rt.archer;
    if (a.vx == null) { a.vx = 0; a.vy = 0; }
    const wantSp = Math.hypot(wx, wy);
    const curSp = Math.hypot(a.vx, a.vy);
    let sp = curSp + (wantSp - curSp) * (1 - Math.exp(-dt * ACCEL_RATE));
    if (wantSp < 1 && sp < 3) sp = 0;                 // settle, don't creep
    let ang;
    if (curSp < 1 || wantSp < 0.001) {
      ang = wantSp > 0.001 ? Math.atan2(wy, wx) : Math.atan2(a.vy, a.vx);
    } else {
      const cur = Math.atan2(a.vy, a.vx);
      let d = Math.atan2(wy, wx) - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      // EASED, not rate-limited. A fixed max turn rate drew constant-radius
      // arcs — mechanically stiff. Exponential easing corrects hard at first
      // and melts into the new line; a slow ship pivots quicker than one at
      // full burn.
      const k = 1 - Math.exp(-dt * (6.5 + (curSp < 220 ? 5 : 0)));
      ang = cur + d * k;
    }
    a.vx = Math.cos(ang) * sp;
    a.vy = Math.sin(ang) * sp;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
  }
  function moveToward(tx, ty, dt, speed, stopDist) {
    const a = rt.archer;
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    if (!stopDist) {
      // A waypoint the ship flies THROUGH — loot is collected on contact, so
      // braking onto it would only stutter the run.
      steerArcher(nx * speed, ny * speed, dt);
      return true;
    }
    // A station the ship is meant to HOLD. Ease onto it: full speed while the
    // gap is wide, tapering to nothing AT the ring, and a gentle push back out
    // if something crowded the ship inside it. Braking starts far enough out
    // that it settles rather than sailing through and looping back.
    const gap = d - stopDist;
    let want = gap * 3.2;
    if (want > speed) want = speed;
    else if (want < -speed * 0.45) want = -speed * 0.45;
    if (gap > -14 && gap < 14) want = 0;        // deadband — park, don't hunt
    steerArcher(nx * want, ny * want, dt);
    return gap > 0;
  }
  // AUTOPILOT LOOT SCAN — scratch buffer, squared distance, no allocation.
  // This ran `rt.ground.filter(... Math.hypot ...)` and so built a NEW array and
  // took a square root per drop, EVERY sub-step: at 5× with a full 60-drop floor
  // that is 300 hypots and six throwaway arrays a frame, all to answer "which
  // drops are outside magnet range". Same answer, zero garbage.
  const _lootBuf = [];
  // A target outside the world box can never be reached: the archer is clamped to
  // it every frame. Both autopilot target paths test this — see the stall note.
  function inArena(e) { return !!e && e.x >= 0 && e.y >= 0 && e.x <= rt.worldW && e.y <= rt.worldH; }
  function nearestInArena() {
    const a = rt.archer; let best = null, bd = Infinity;
    for (const e of rt.enemies) {
      if (!e || e.dead || e.dying || e.hp <= 0 || !inArena(e)) continue;
      const d2 = (e.x - a.x) ** 2 + (e.y - a.y) ** 2;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }
  function autopilot(dt) {
    const a = rt.archer, s = rt.stats, sp = s.moveSpeedPx;
    // 1) collect any ground loot first (the "pick everything up" promise)
    // distant drops only — anything inside magnet range flies to the ship on
    // its own, so the operator keeps fighting instead of fetching every pickup.
    const magR = MAGNET_RADIUS * (window.DREAD ? window.DREAD.mult('pickupRadius') : 1);
    const magR2 = magR * magR;
    const loot = _lootBuf; loot.length = 0;
    for (let i = 0; i < rt.ground.length; i++) {
      const q = rt.ground[i];
      if (q.lost || q.dead) continue;
      const dx = q.x - a.x, dy = q.y - a.y;
      if (dx * dx + dy * dy > magR2) loot.push(q);
    }
    // ONE TARGET, HELD UNTIL THE MAGNET TAKES IT. The old 25%-closer swap rule
    // re-litigated the choice every tick while the field kept changing under
    // it, and a hand-off could pick a drop directly BEHIND the ship — together
    // that is the zig-zag. The target is dropped only when it is gone or the
    // magnet has it; a new one is chosen at most 5×/sec, scored by distance ×
    // misalignment with the CURRENT HEADING, so the ship takes the field in one
    // flowing sweep and never doubles back for a drop the magnet will finish.
    let tgt = rt.lootTgt;
    if (!tgt || tgt.dead || tgt.lost ||
        (tgt.x - a.x) ** 2 + (tgt.y - a.y) ** 2 <= magR * magR) { tgt = null; rt.lootTgt = null; rt.lootT = 0; }
    if (loot.length) {
      rt.lootT = (rt.lootT || 0) - dt;
      if (!tgt && rt.lootT <= 0) {
        rt.lootT = 0.2;
        const hd = Math.atan2(a.vy || 0, (a.vx || 0) || 1);
        let bs = Infinity;
        for (const q of loot) {
          const dx = q.x - a.x, dy = q.y - a.y, d2 = dx * dx + dy * dy;
          let da = Math.atan2(dy, dx) - hd;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const sc = d2 * (1 + Math.abs(da) * 0.6);   // behind costs ~3× as far
          if (sc < bs) { bs = sc; tgt = q; }
        }
        rt.lootTgt = tgt;
      }
      if (tgt) { moveToward(tgt.x, tgt.y, dt, sp); return; }
      // between targets for a beat — keep flying the current line, don't stall
      if (Math.abs(a.vx || 0) + Math.abs(a.vy || 0) > 40) { steerArcher(a.vx, a.vy, dt); return; }
    }
    // 2) low health → kite away from the nearest threat
    const threat = nearestEnemy();
    if (threat && a.hp < s.maxHp * 0.3) {
      // Fleeing goes through the flight model like everything else — it used to
      // write position directly, which teleported the hull sideways the instant
      // health crossed the threshold.
      const dx = a.x - threat.x, dy = a.y - threat.y, d = Math.hypot(dx, dy) || 1;
      steerArcher((dx / d) * sp, (dy / d) * sp, dt);
      a.x = Math.max(20, Math.min(rt.worldW - 20, a.x));
      a.y = Math.max(20, Math.min(rt.worldH - 20, a.y));
      return;
    }
    // 3) approach nearest enemy to a comfortable firing distance, then hold
    if (threat) {
      // HOLD A TARGET. nearestEnemy() is re-evaluated every tick, so two
      // hostiles at similar range swapped constantly and the ship wove between
      // them. Stay with the current one until it dies or another is clearly
      // closer — the same commitment rule the loot run uses.
      let t2 = rt.aiTgt;
      if (!t2 || t2.dead || t2.dying || t2.hp <= 0) t2 = threat;
      // NEVER CHASE SOMETHING OUTSIDE THE ARENA. The archer is clamped to the
      // world every frame; a target beyond that clamp can never be reached, so
      // the ship flew into the wall and held there at full throttle — dead still
      // on screen, in autopilot, apparently frozen. Enemies are clamped now too
      // (entities.js), and this is the belt to that braces.
      if (t2 && !inArena(t2)) t2 = null;
      // AND IT NEVER PARKS. The fallback used to be a dead stop and a return, so
      // for as long as an unreachable hostile stayed the nearest one, autopilot
      // held the ship perfectly still every tick — "auto won't fly until I move it
      // by hand and switch auto back on" (moving by hand changes which enemy is
      // nearest, which is why that cleared it). Take the nearest REACHABLE hostile
      // instead; with none, fall through to the spawn-node drift below so the
      // operator keeps flying and re-acquires the moment something spawns.
      if (!t2) t2 = nearestInArena();
      if (t2) {
        if (t2 !== threat && inArena(threat)) {
          const cd = (t2.x - a.x) ** 2 + (t2.y - a.y) ** 2;
          const nd = (threat.x - a.x) ** 2 + (threat.y - a.y) ** 2;
          if (nd < cd * 0.56) t2 = threat;      // 0.56 ≈ 25% nearer in real distance
        }
        rt.aiTgt = t2;
        moveToward(t2.x, t2.y, dt, sp, FIRE_RANGE * 0.62);
        return;
      }
      rt.aiTgt = null;                          // nothing reachable — drift, don't park
    }
    // 4) nothing around → drift toward the nearest pending spawn node
    let node = null, bd = Infinity;
    for (const n of rt.nodes) { const d = (n.x-a.x)**2+(n.y-a.y)**2; if (d < bd) { bd = d; node = n; } }
    if (node) { moveToward(node.x, node.y, dt, sp, 40); return; }
    // AND HAVING NO NODES IS THE NORMAL CASE IN HALF THE GAME. Every wave-based
    // zone — wave zones, sieges, citadel sieges, the Dreadnaught Hunt and the Mech
    // Foundry — sets `rt.nodes = []` in resetZone(), because their spawns are driven
    // by updateWaveZone instead of by fixed nodes. buildNodes() runs only in the
    // plain grind branch. So the drift above, which exists precisely so the operator
    // KEEPS FLYING, had nothing to drift toward and this function fell off the end
    // WITHOUT CALLING A MOVEMENT FUNCTION AT ALL — the ship stopped dead in the gap
    // between waves and stayed frozen until the next one spawned.
    //
    // That is the intermittent autopilot lock-up, and it explains why it only ever
    // showed up "in areas where auto movement is used": wave content is exactly
    // where the node list is empty. Every earlier fix in this function targeted the
    // unreachable-TARGET case; this is the no-target case, and it had no floor.
    //
    // There is always a movement call now. Hold the line already being flown if
    // there is one, otherwise ease to the middle of the arena — the best place to
    // meet a wave that can arrive from any bearing.
    if (Math.abs(a.vx || 0) + Math.abs(a.vy || 0) > 30) { steerArcher(a.vx, a.vy, dt); return; }
    moveToward(rt.worldW / 2, rt.worldH / 2, dt, sp * 0.5, 90);
  }
  function manualMove(dt) {
    const sp = rt.stats.moveSpeedPx;
    // Releasing the stick asks for zero velocity rather than snapping to a
    // stop, so the ship coasts the last few pixels — the same steering path as
    // the autopilot, so both modes fly identically.
    if (rt.joy.active && (rt.joy.x || rt.joy.y)) steerArcher(rt.joy.x * sp, rt.joy.y * sp, dt);
    else steerArcher(0, 0, dt);
  }

  // --------------------------------------------------------------------------
  // GAME LOOP
  // --------------------------------------------------------------------------
  function step(now) {
    let dt = (now - rt.last) / 1000; rt.last = now;
    if (dt < 0) dt = 0;
    // ---- WALL-CLOCK DEBT -----------------------------------------------------
    // dt is clamped to 50ms so one slow frame can never teleport the whole
    // simulation, but the clamp used to THROW THE OVERRUN AWAY. Every frame that
    // ran long — a menu screen doing heavy DOM work, iOS dropping the page to
    // 30fps, a hot phone — silently deleted sim time, and at 5× the loss was
    // multiplied by five. That is the reported "XP and combat slow down when I'm
    // not on the battle screen": the sim was not paused, it was being shortchanged.
    // The overrun is now BANKED as debt and paid back over following frames, so
    // the simulation keeps real time. Bounded at 1.5s (a longer gap is a
    // background stall, and computeOffline() owns that time, not this loop).
    // SIMULATE THE TIME THAT ACTUALLY PASSED. Every previous attempt at this
    // clamped dt to 50ms, which silently DELETED the overrun: a 5x run on a phone
    // holding 12fps got 0.05 x 5 = 0.25s of sim per 0.083s frame = 3x, not 5x, and
    // a 2m30s Voidmaw run took 1m18s instead of 30s. The "debt bank" that replaced
    // the clamp was no better — it only repaid on a frame FASTER than the cap, and
    // under sustained load there is no such frame, so the debt pinned at its
    // ceiling and the rest was lost anyway.
    //
    // There is no bookkeeping now. The frame's real elapsed time is simulated in
    // full; sdt below absorbs it by taking more (or coarser) sub-steps. The only
    // bound is a genuine STALL boundary: past 0.25s the gap is a backgrounded tab
    // or a GC pause, and computeOffline() owns that time, not this loop.
    if (dt > 0.25) dt = 0.25;
    // ADAPTIVE TIME-SCALE — simulate gameSpeed× time in as FEW sub-steps as
    // stability allows (each ≤ 50ms of sim time) instead of gameSpeed FULL
    // update passes per frame. 4×/5×/10× used to run 4/5/10 whole sim passes
    // every frame — the CPU cost cratered the frame rate and made movement
    // choppy. Same wall-clock speed, ~half to a quarter of the work:
    //   1× → 1 step · 4×/5× → 3 steps · 10× → 5 steps (at 60fps) — sub-step
    //   dt stays ≤35ms so motion, trails and homing keep their smooth feel.
    // LOAD-AWARE SUB-STEPPING. The 35ms sub-step is a smoothness budget, and it
    // is only affordable while frames are cheap. Once a frame is genuinely
    // expensive — a 40-hostile cargo run at 5× — six sub-steps per frame turn a
    // slow frame into a slower one, and the sim starts losing ground against the
    // wall clock (the mission clock then reads short, which is exactly what was
    // reported). Under load the budget relaxes to 60ms and the ceiling drops to
    // three passes: slightly coarser motion, but the sim keeps real time.
    rt._fdt = rt._fdt ? rt._fdt * 0.9 + dt * 0.1 : dt;
    const slow = rt._fdt > 0.028;                    // sustained sub-30fps
    // ---- RENDER LOD GOVERNOR -----------------------------------------------
    // Three levels, driven by the same smoothed frame time the sub-stepper uses:
    //   0 full fat · 1 trimmed (no CSS grade, thin trails, fewer floats)
    //   2 survival (single-stroke trails, no bloom, crit floats only).
    // One step per 0.8s so it never flaps; recovery walks back the same way.
    // Spending the frame budget on the SIMULATION is the point — at x10 in a
    // wave-36 cargo run the sim is the game, the bloom is not.
    if (!rt._lodT || rt.time - rt._lodT > 0.8) {
      rt._lodT = rt.time;
      const ms = (rt._fdt || 0.016) * 1000, cur = rt.lod | 0;
      if (ms > 34) rt.lod = Math.min(2, cur + 1);
      else if (ms > 24) rt.lod = Math.min(2, Math.max(1, cur));
      else if (ms < 17 && cur > 0) rt.lod = cur - 1;
      // THE PLAYER'S GRAPHICS TIER IS A FLOOR, NOT A SECOND OPINION. The governor
      // above only ever reacts AFTER the frames have already gone bad, which is
      // no use to someone whose device is never going to be fast. Medium and Low
      // pin the starting point; the governor can still climb HIGHER under load,
      // it just can never come back below what the player asked for.
      try { if (window.PERF) rt.lod = Math.max(window.PERF.lodFloor() | 0, rt.lod | 0); } catch (e) {}
    }
    const total = dt * Math.max(1, state.gameSpeed | 0);
    // A CARGO RUN IS THE HEAVIEST FRAME IN THE GAME and it is flown by hand, so
    // input latency matters more than sub-step smoothness: three passes maximum,
    // whatever the frame time says. cargo-run.js governs the CONTENT of the run
    // from the same measurement (see GOV there); this governs the SIMULATION.
    const cg = !!(rt.cgrun && rt.cgrun.active);
    // STEP COUNT IS A SMOOTHNESS CHOICE, NEVER A TIME BUDGET. sdt = total/steps, so
    // the full frame is always simulated whatever the ceiling is — a low ceiling
    // just means coarser sub-steps, not a slower game. The ceiling rises to 16 so
    // a genuinely long frame stays granular rather than resolving in one huge leap
    // (which is what breaks homing and collision at 10x).
    const budget = (slow || cg) ? 0.06 : 0.035;
    const steps = Math.max(1, Math.min(16, Math.ceil(total / budget)));
    const sdt = total / steps;
    for (let i = 0; i < steps; i++) { rt.time += sdt; state.playTime += sdt; update(sdt); }
    // ...and the escort's own tick, once, with the whole frame's sim time.
    if (rt._cgDt > 0) {
      const cgd = rt._cgDt; rt._cgDt = 0;
      if (rt.cgrun && rt.cgrun.active && window.CARGO && window.CARGO.engineTick) { try { window.CARGO.engineTick(cgd, rt); } catch (e) {} }
    }
    // RENDER GATE — the simulation above always runs (so idle farming, boss
    // timers and offline progress are never starved), but we only PAINT when the
    // canvas is actually on-screen: skip drawing while the tab is hidden or while
    // an opaque full-screen overlay (any menu, or the Fleet Rank panel) covers
    // the battle view. This is the single biggest CPU/GPU/battery saver — a
    // backgrounded or menu'd idle session stops doing per-frame additive-bloom
    // canvas work entirely. (querySelector here is a cheap selector match — no
    // layout/reflow — so it is fine to run once per frame.)
    if (document.hidden) return;
    // OVERLAY GATE — cached for ~120ms. The selector match itself is cheap, but it
    // is a DOM read on the critical path of every single frame; a menu cannot open
    // and close inside 120ms, so sampling it at ~8Hz is invisible and takes the
    // read out of the frame budget entirely.
    if (!rt._ovT || rt.time - rt._ovT > 0.12) {
      rt._ovT = rt.time;
      rt._ovOn = !!document.querySelector('.screen.overlay.active');
    }
    if (rt._ovOn) {
      // Battle view is hidden behind a menu — skip the expensive canvas paint,
      // but keep the always-visible top HUD (level, XP, HP, gold) live so combat
      // progress still shows on EVERY tab while farming. Cheap throttled DOM
      // writes only, same ~8Hz cadence as the in-draw() call.
      if (window.UI && (!rt._hudT || rt.time - rt._hudT > 0.12)) { rt._hudT = rt.time; window.UI.syncHUD(); }
      return;
    }
    // ---- CANVAS FIT GUARD ----------------------------------------------------
    // draw() owns the fit self-heal (see the block at the top of draw()), which
    // covers every cause we have seen: a 0-size backing store, a CSS box that
    // drifted while the screen was hidden, and a device-pixel-ratio change.
    draw();
  }
  // LIVE STALL DETECTOR (Aug 2026). Every fix so far depended on a RELOG to show
  // evidence — but the OOM reaper kills the tab before markers help, and players
  // relog into fresh tabs. A >1.5s frame gap is the EARLY symptom of every one of
  // these crashes, and it fires while the page is still alive: recovery happens
  // IN SESSION, with the evidence on screen for a screenshot, instead of waiting
  // for a relog that never carries the data.
  let _stallN = 0, _stallT = 0, _visT = 0;
  document.addEventListener('visibilitychange', () => { _visT = performance.now(); });
  // Kept but no longer called — both call sites were silenced in Aug 2026 because
  // the banner fired on ordinary sessions (a backgrounded phone reads as a stall).
  // Left in place so re-enabling is a one-line change, not a rewrite.
  function crashBanner(msg) {
    try {
      let bar = document.getElementById('lf-recover');
      if (!bar) {
        bar = document.createElement('div'); bar.id = 'lf-recover';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#2a1508;color:#ffcf7a;border-bottom:1px solid #7a4a12;font:700 12px/1.45 system-ui;padding:8px 12px;text-align:center';
        bar.appendChild(document.createElement('span'));
        const x = document.createElement('button');
        x.textContent = '×'; x.style.cssText = 'margin-left:10px;background:none;border:none;color:#ffcf7a;font-size:15px;cursor:pointer';
        x.onclick = () => bar.remove(); bar.appendChild(x);
        document.body.appendChild(bar);
      }
      bar.firstChild.innerHTML = msg;
    } catch (e) {}
  }
  function liveSample() {
    const mem = (performance && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : '?';
    return JSON.stringify({ t: new Date().toISOString().slice(11, 19), zone: state.currentDungeon, sys: state.currentSystem || 0,
      en: rt.enemies.length, proj: rt.projectiles.length, parts: rt.particles.length, floats: rt.floats.length,
      ground: rt.ground.length, bolts: (rt.bolts || []).length, ebolts: (rt.ebolts || []).length,
      cg: (window.CARGORUN && window.CARGORUN.sample) ? window.CARGORUN.sample() : 0, heap: mem });
  }
  function engageRecovery(reason) {
    if (engageRecovery._t && performance.now() - engageRecovery._t < 10000) return;
    engageRecovery._t = performance.now();
    window.__lfPlayRecovery = true;   // the live caps (storm bolts 12/16) key off this
    try {
      rt.bolts = (rt.bolts || []).slice(-12); rt.ebolts = rt.ebolts.slice(-30);
      rt.projectiles = rt.projectiles.slice(-120); rt.particles = rt.particles.slice(-80);
      rt.floats = rt.floats.slice(-20); rt.ground = rt.ground.slice(-30);
    } catch (e) {}
    const sample = liveSample();
    try { localStorage.setItem('lf_play', sample); localStorage.setItem('lf_err', reason); } catch (e) {}
    // Banner suppressed with the boot one (Aug 2026) — the trimming still happens,
    // silently, and the breadcrumb + console warning keep the forensics.
    try { console.warn('[LOOTFLEET] recovery engaged: ' + reason + ' ' + sample); } catch (e) {}
  }
  // ---- INPUT YIELD ---------------------------------------------------------
  // A TAP MUST NOT QUEUE BEHIND A SIMULATION FRAME.
  //
  // The render gate already stops PAINTING the arena behind a menu, but the sim
  // itself always runs (and must — idle progress is the game). On a phone in a
  // busy zone one update() pass is comfortably longer than a frame, so a nav tap
  // landed behind the frame in flight, then the screen's own render competed with
  // the next one: the reported "big delay from tapping to the menu switching".
  //
  // So the UI can buy a short, hard-bounded runway. While it is open the loop
  // schedules itself and does nothing else — and CRUCIALLY it does not touch
  // rt.last, so the skipped milliseconds are simulated IN FULL by the next step
  // (dt's only bound is the 0.25s stall boundary, far above this ceiling). No sim
  // time is lost, no entity count is touched, nothing about difficulty changes —
  // the frame is deferred, not deleted. A render that overruns the window is no
  // worse off than today: it was already a long frame either way.
  const YIELD_MS = 140;                        // < the 250ms stall boundary, always
  let _yieldUntil = 0;
  function uiYield(ms) {
    const now = performance.now();
    // NEVER DEFER PAST THE STALL BOUNDARY. rt.last is the last frame the sim
    // actually ran, so this ceiling is measured from THERE, not from now — a
    // burst of taps (or a scroll that keeps firing pointerdown) must not be able
    // to chain windows until dt exceeds the 0.25s clamp, which is the one thing
    // that would genuinely lose sim time rather than defer it.
    const t = Math.min((rt.last || now) + YIELD_MS,
                       now + Math.max(0, Math.min(YIELD_MS, ms == null ? 110 : ms)));
    if (t > _yieldUntil) _yieldUntil = t;
  }
  function yielding(now) {
    if (!_yieldUntil) return false;
    if (now < _yieldUntil) return true;
    _yieldUntil = 0; return false;
  }
  // THE RAF CHAIN MUST NEVER DIE.
  //
  // This used to read `if (!rt.running) return;` BEFORE re-arming — so the moment
  // anything set rt.running false for a single frame (freeze() on a session kick,
  // a recovery pass, a pause), the chain terminated and NOTHING restarted it.
  // rt.running going back to true did not help: there was no longer a rAF
  // callback scheduled to observe it.
  //
  // What kept the game alive after that was the 30Hz watchdog at the bottom of
  // boot(), which only steps when `now - rt.last > 120`. That is a last-resort
  // safety net, not a game loop, and it produces EXACTLY the symptom reported:
  // a step every ~132ms — 7.5fps — on a machine whose display is doing 120Hz and
  // whose main thread is otherwise idle. The LOD governor then pinned itself at
  // 2 (survival) trying to fix a frame time that was never a rendering problem,
  // which stripped the visuals as well.
  //
  // Re-arming FIRST makes the chain unkillable: a paused loop is a scheduled
  // callback that does nothing, costs nothing, and resumes on the very next frame
  // the moment it is allowed to. rt.last is kept current while paused so resuming
  // never hands step() a multi-second dt.
  function loop(now) {
    requestAnimationFrame(loop);
    if (!rt.running || window.__sessionKicked) { rt.last = now; return; }
    // rAF suspends in background tabs — only count stalls while visible and settled
    if (rt.last && !document.hidden && now - _visT > 3000) {
      const gap = now - rt.last;
      if (gap > 1500) {
        if (now - _stallT > 60000) _stallN = 0;
        _stallT = now; _stallN++;
        if (gap > 4000 || _stallN >= 2) engageRecovery(Math.round(gap) + 'ms stall');
      }
    }
    if (yielding(now)) return;               // rt.last untouched — no sim time lost
    step(now);
  }
  // SESSION KICK — a screen that lost the account lock must stop SIMULATING,
  // not just stop saving: otherwise the player keeps banking progress behind
  // the takeover notice that can never be written anywhere.
  function freeze() { rt.running = false; }

  function update(dt) {
    const a = rt.archer;
    // SCREEN SHAKE decay — time-based and done HERE (in the sim step) not in
    // draw(). Hits add shake from inside update(), and at high game speed update
    // runs many times per frame; decaying per-step keeps add vs. decay balanced
    // so sustained fire no longer pins shake at the cap and vibrates the whole
    // scene (that was the "stutter while shooting"). ~0.85/frame equivalent.
    if (rt.shake) { rt.shake *= Math.exp(-9.75 * dt); if (rt.shake < 0.3) rt.shake = 0; }
    // SMOOTH AIM v2 — frame-rate-independent glide toward the firing bearing
    if (rt.archer && rt.archer.aim != null) {
      let dA = rt.archer.aim - (rt.archer.facing || 0);
      // loop-free normalisation: the old while-loops hang the tab forever if
      // either angle ever goes non-finite (Infinity - 2π is still Infinity)
      if (!isFinite(dA)) { dA = 0; rt.archer.facing = rt.archer.aim = 0; }
      dA = dA - Math.PI * 2 * Math.round(dA / (Math.PI * 2));
      rt.archer.facing = (rt.archer.facing || 0) + dA * (1 - Math.exp(-9 * dt));
    }
    // Timed builds are gone. This only drains a legacy in-progress build on the
    // first frame after the update, handing the player the hull they paid for.
    if (state.construction) { checkConstruction(); }
    // when downed, freeze everything until the player picks a respawn zone
    if (rt.awaitingRespawn) { a.update(dt); return; }
    a.update(dt);

    // movement
    if (!a.dead) {
      if (state.auto) autopilot(dt); else manualMove(dt);
      a.x = Math.max(16, Math.min(rt.worldW - 16, a.x));
      a.y = Math.max(16, Math.min(rt.worldH - 16, a.y));
    }

    // hp regen
    if (!a.dead && a.hp < rt.stats.maxHp) a.hp = Math.min(rt.stats.maxHp, a.hp + rt.stats.maxHp * C.ARENA.regenPerSec * dt);

    // camera follows player (account for zoom — lower zoom shows more world).
    // SMOOTH FOLLOW (Jul 2026 polish): exponential glide toward the target —
    // the old per-frame hard snap transmitted every micro-move of the hull
    // (bob, joystick corrections) straight into the whole scene = "jitter".
    // Teleports (warp / respawn) still snap instantly.
    const z = rt.zoom || 1, visW = rt.w / z, visH = rt.h / z;
    const _ctx2 = rt.worldW <= visW ? (rt.worldW - visW) / 2 : Math.max(0, Math.min(rt.worldW - visW, a.x - visW / 2));
    const _cty2 = rt.worldH <= visH ? (rt.worldH - visH) / 2 : Math.max(0, Math.min(rt.worldH - visH, a.y - visH / 2));
    if (rt.cam.x == null || Math.abs(_ctx2 - rt.cam.x) > visW * 0.6 || Math.abs(_cty2 - rt.cam.y) > visH * 0.6) {
      rt.cam.x = _ctx2; rt.cam.y = _cty2;
    } else {
      const ck = 1 - Math.exp(-9 * dt);
      rt.cam.x += (_ctx2 - rt.cam.x) * ck;
      rt.cam.y += (_cty2 - rt.cam.y) * ck;
    }

    // spawn nodes / siege waves
    if (state.prismFleetRun && state.prismFleetRun.active) {
      // PRISM FLEET — no zone spawns; only the gauntlet boss (managed via PRISMFLEET.tick).
    } else if (rt.siege && rt.siege.active) {
      updateSiege(dt);
    } else if (rt.waves && rt.waves.active) {
      updateWaveZone(dt);
    } else {
      updateNodes(dt);
      // boss meter: ticks down; kills hasten it (see onKill). Never more than once
      // per 5 min. When it hits 0 and the cooldown has elapsed, the boss spawns.
      if (state.currentDungeon >= 1 && !rt.bossAlive) {
        rt.bossTimer -= dt;
        if (rt.bossTimer <= 0 && (rt.time - rt.lastBoss) >= 300) spawnBoss();
        else if (rt.bossTimer < 0) rt.bossTimer = 0;
      }
    }
    // SUPER BOSS aura — pulsing red motes around the elite while it lives.
    if (rt.warpT > 0) rt.warpT -= dt;
    if (rt.novaT > 0) rt.novaT -= dt;
    // post-capture tow: count down, then return the player to the hangar
    if (rt.towT > 0) {
      rt.towT -= dt;
      if (rt.towT <= 0) {
        rt.towT = 0;
        if (state.currentDungeon >= 1) { respawnAt(0); if (window.UI) window.UI.siegeEvent('towhome', { voidzone: !!rt._towVoid, casino: !!rt._towCasino }); rt._towVoid = false; rt._towCasino = false; }
      }
    }
    if (rt.superBossAlive && rt.boss && !rt.boss.dying && Math.random() < 0.6) {
      const b = rt.boss, aa = Math.random() * Math.PI * 2, rr = b.size * (1.1 + Math.random() * 0.5);
      rt.particles.push(new E.Particle(b.x + Math.cos(aa) * rr, b.y + Math.sin(aa) * rr, { vx: Math.cos(aa) * 30, vy: Math.sin(aa) * 30 - 12, life: 0.5, size: 2 + Math.random() * 2.4, color: '#ff2a4a', glow: true, drag: 0.9 }));
    }

    // auto-fire nearest enemy in range
    a.attackTimer -= dt;
    if (!a.dead && a.attackTimer <= 0) {
      const tgt = nearestEnemy(rt.stats.fireRange || FIRE_RANGE);
      // FIGHTER CARRIERS DO NOT FIRE. Suppressing it here rather than zeroing the
      // hull's damage keeps attackDamage meaningful — it is what every fighter's
      // hit scales off, so the stat still drives the ship, just not a bolt.
      if (tgt && fighterHull()) a.attackTimer = 0.5;
      else if (tgt) { fire(tgt); a.attackTimer = 1 / Math.max(0.1, rt.stats.attacksPerSec); }
    }
    // ASCENSION: Storm Conduit — per-second chain-lightning proc
    stormTick(dt);
    // ◉ BEACON — cooldown + swarm lifetime
    beaconTick(dt);
    // VOIDMAW: black holes drag and grind everything caught inside
    singularityTick(dt);
    // ✦ AETERNUM: lance cycle, the shot, and every burning fracture lane
    lanceTick(dt);
    // ✦ ETERNUM: the five death beams — continuous locks, no cooldown
    beamTick(dt);
    // defending fleets run shield repair while they hold the field
    cloneTick(dt);

    // enemies
    for (const e of rt.enemies) {
      e.update(dt, a);
      if (e.fireReq) { e.fireReq = false; enemyFire(e); }
      // citadel battle damage — embers & smoke pour out as it degrades
      if (e.isCitadel && !e.dying) {
        const f = e.hp / e.maxHp;
        if (f < 0.75 && Math.random() < dt * (f < 0.25 ? 14 : f < 0.5 ? 8 : 4)) {
          const a2 = Math.random() * 7, r2 = e.size * (0.3 + Math.random() * 0.6);
          rt.particles.push(new E.Particle(e.x + Math.cos(a2) * r2, e.y + Math.sin(a2) * r2 * 0.7, { vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 50, life: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 2.5, color: Math.random() < 0.6 ? '#ff9a50' : 'rgba(120,120,125,0.5)', glow: Math.random() < 0.5, drag: 0.94 }));
        }
      }
    }
    separateEnemies();
    sweepDead(rt.enemies);
    updateEbolts(dt);
    // absolute projectile ceiling — no fire source may outrun impact/expiry
    if (rt.projectiles.length > 260) rt.projectiles.splice(0, rt.projectiles.length - 260);

    // carrier drones: orbit the ship and fire on nearby enemies
    updateDrones(dt);
    // fighter bays: autonomous craft that LEAVE the ship and swarm targets
    try { if (window.FIGHTERS) window.FIGHTERS.update(dt); } catch (e) {}
    // STANDING DAMAGE AURA — any hull with `dpsAura` burns everything near it,
    // scaling with the pilot's own DPS. Veridian 0.35 (resonance), Eternum 0.9
    // (the celestial field). `dpsAura:true` on old configs reads as 0.35.
    const _auraSh = C.SHIP_BY_KEY[state.ship];
    if (_auraSh && _auraSh.dpsAura && rt.archer && !rt.archer.dead) {
      const cel = state.ship === 'eternum';
      const R = cel ? 420 : 260, a = rt.archer;
      const share = _auraSh.dpsAura === true ? 0.35 : _auraSh.dpsAura;
      const aps = ((rt.stats && rt.stats.theoryDps) || 0) * share;
      if (aps > 0) {
        rt.vaFloatT = (rt.vaFloatT || 0) - dt;
        for (const en of rt.enemies) {
          if (en.dead || en.dying) continue;
          if (Math.hypot(en.x - a.x, en.y - a.y) > R + en.size) continue;
          const dmg = aps * dt;
          const k = en.takeDamage(dmg);
          rt.dmgWindow.push({ t: rt.time, dmg });
          if (rt.vaFloatT <= 0 && rt.floats.length < 24) {
            rt.floats.push(new E.FloatText(en.x, en.y - en.size, formatNum(aps * (rt.dmgShow || 1)) + '/s', { color: cel ? '#9fd0ff' : '#7dff9e', size: 22 }));
            rt.vaFloatT = 0.7;
          }
          if (k) onKill(en);
        }
      }
    }
    // FLEET escorts: formation flight, escort fire, Warden support pulses
    updateEscorts(dt);
    // PRISM MINING — defend-the-dig layer (ore field + miners) riding on top of
    // the real combat sim. Only active inside a Prism Field run.
    if (state.prismRun && state.prismRun.active && window.PRISM && window.PRISM.tick) { try { window.PRISM.tick(dt, rt); } catch (e) {} }
    if (state.prismFleetRun && state.prismFleetRun.active && window.PRISMFLEET && window.PRISMFLEET.tick) { try { window.PRISMFLEET.tick(dt, rt); } catch (e) {} }
    // AEGIS FIELD PROJECTORS — area debuffs on hostiles inside the fields. The
    // module throttles its own scan to 8Hz, so this call costs an early return
    // on most frames and never walks the enemy list per frame.
    if (window.AEGIS && window.AEGIS.active && window.AEGIS.active()) { try { window.AEGIS.tick(dt, rt); } catch (e) {} }
    // DREADNAUGHT HUNT — raid-boss phase logic (adds, novas, enrage) on the real sim.
    if (state.dreadRun && state.dreadRun.active && window.DREAD && window.DREAD.tick) { try { window.DREAD.tick(dt, rt); } catch (e) {} }
    // SERVER DREADNAUGHT — seasonal world-boss run (timer, stages, boss scaling).
    if (rt.sdrun && rt.sdrun.active && window.SDREAD && window.SDREAD.engineTick) { try { window.SDREAD.engineTick(dt, rt); } catch (e) {} }
    // KING OF THE HILL — the 24h kill race: tier scaling and field top-up.
    if (rt.kothrun && rt.kothrun.active && window.KOTH && window.KOTH.engineTick) { try { window.KOTH.engineTick(dt, rt); } catch (e) {} }
    // HOLLOW ARMADA — alliance live raid on the real engine (timer, zones, transmit).
    if (rt.alrun && rt.alrun.active && window.ALBOSS && window.ALBOSS.engineTick) { try { window.ALBOSS.engineTick(dt, rt); } catch (e) {} }
    // HOME CITADEL — wave defense on the real engine (fort objective, raider waves).
    if (rt.hcrun && rt.hcrun.active && window.HOMECIT && window.HOMECIT.engineTick) { try { window.HOMECIT.engineTick(dt, rt); } catch (e) {} }
    // SPACE CARGO DEFENSE — escort mission on the real engine (the cargo hull,
    // its route, raider aggro, void anomalies, arrival & loss).
    // COALESCED TO ONE CALL PER FRAME. Everything above ticks once per SUB-STEP,
    // and at 5× the loop takes up to six of them — so the escort's spawn, aggro,
    // latch, void and ring passes were running six times a frame on top of a
    // 40-hostile field. That is what cratered the frame rate in the top tier
    // (players: "giga laggy in the hardest one"), and a sim that cannot keep up
    // with the wall clock is also why the mission clock read short. Every one of
    // those passes integrates dt, so accumulating here and flushing once in
    // step() produces the SAME fight for a sixth of the cost.
    if (rt.cgrun && rt.cgrun.active) rt._cgDt = (rt._cgDt || 0) + dt;

    // death handling — drop a piece of gear, then auto-tow back to the hangar
    if (a.justDied) {
      a.justDied = false;
      // KING OF THE HILL — death is free AND the race carries on. The zone pays
      // nothing, so it must take nothing (no item loss, no hull reset), and
      // ending the run on death would make the ladder a measure of survival
      // rather than of throughput, which is not the event that was scoped. The
      // pilot is patched up on the spot with a long invulnerability window to
      // fly clear; the 24-hour clock is the only thing that stops them.
      if (rt.kothrun && rt.kothrun.active) {
        burst(a.x, a.y, '#ffc43c', 48, { speed: 250, life: 1.0, glow: true });
        a.dead = false; a.killer = null; a.hp = rt.stats.maxHp; a.invuln = 5;
        rt.awaitingRespawn = false;
        try { window.KOTH && window.KOTH.banner('☠ HULL DOWN', 'Patched and back in — the clock never stopped.'); } catch (e) {}
        return;
      }
      // EVENT DEATHS (Voidmaw / Hollow Armada) — these bosses are DESIGNED to
      // kill you eventually: an event death ends the run with NO penalty
      // (no item loss, no hull reset) and tows you to the safe hangar.
      if ((rt.sdrun && rt.sdrun.active) || (rt.alrun && rt.alrun.active)) {
        rt.sdrun = null; rt.alrun = null;
        burst(a.x, a.y, '#b04dff', 44, { speed: 240, life: 1.0 });
        respawnAt(0);
        if (window.SDREAD && window.SDREAD.onDeath) { try { window.SDREAD.onDeath(); } catch (e) {} }
        if (window.ALBOSS && window.ALBOSS.onDeath) { try { window.ALBOSS.onDeath(); } catch (e) {} }
        if (window.HOMECIT && window.HOMECIT.onDeath) { try { window.HOMECIT.onDeath(); } catch (e) {} }
        if (rt.cgrun && window.CARGO && window.CARGO.onDeath) { try { window.CARGO.onDeath(); } catch (e) {} }
        return;
      }
      const killer = a.killer;
      const killerName = killer ? (killer.isBoss ? killer.name : killer.type.name) : 'the swarm';
      const diedZone = state.currentDungeon;
      // ITEM LOSS ON DEATH — below Lv 100: the classic single-item drop (two in
      // deep space). At Lv 100+: CATASTROPHIC — your whole hold is at risk, each
      // item rolled at half the previous chance (100% · 50% · 25% …).
      let lost = null, lostList = null;
      if (state.level >= 100) {
        lostList = catastrophicLoss();
        lost = (lostList && lostList[0]) || null;
      } else {
        lost = dropOnDeath();
        if (rt.deepDeath) dropOnDeath(); // deep space: a second item is lost on death
      }
      // HULL RESET ON DEATH — the active hull's upgrade levels are wiped back to
      // Lv 1 and every resource spent leveling it is forfeit. The deeper you push
      // an upgraded hull, the more you risk losing.
      let hullReset = null;
      { const _hk = state.ship, _prev = (state.shipLevels && state.shipLevels[_hk]) || 1;
        if (_prev > 1) { if (!state.shipLevels) state.shipLevels = {}; state.shipLevels[_hk] = 1; refreshStats();
          hullReset = { ship: _hk, name: (C.SHIP_BY_KEY[_hk] || {}).name || 'Hull', from: _prev }; } }
      // a carrier loses one drone when the hull is downed
      if (state.drones > 0) { state.drones--; spawnDrones(); }
      rt.siege = null; rt.waves = null; // abort any in-progress siege / wave gauntlet
      burst(a.x, a.y, '#e23b4e', 30, { speed: 200, life: 0.9 });
      // no respawn menu — redeploy straight to the home hangar
      respawnAt(0);
      if (window.UI) window.UI.onDeathReturn(lost, killerName, diedZone, hullReset, lostList);
      // fort defense death: settle the wave as a breach BEFORE the hangar tow
      if (rt.hcrun && window.HOMECIT && window.HOMECIT.onDeath) { try { window.HOMECIT.onDeath(); } catch (e) {} }
      // CARGO DEFENSE death: the module settles the run (cargo lost AND the
      // flagship's hull upgrades stripped) before the tow.
      if (rt.cgrun && window.CARGO && window.CARGO.onDeath) { try { window.CARGO.onDeath(); } catch (e) {} }
      goSafeHangar();   // every shipwreck tows to the SAFE hangar — never respawn into a hot zone
    }

    // projectiles
    for (const p of rt.projectiles) { p.update(dt); if (p.hit) resolveHit(p); }
    sweepDead(rt.projectiles);

    // ground loot pickups + LOOT MAGNET: drops within range fly toward the
    // player (accelerating as they near) and are collected on contact.
    const _prMul = (window.DREAD ? window.DREAD.mult('pickupRadius') : 1);   // PILOT: Loot Pickup Radius
    const _pickR = PICKUP_RADIUS * _prMul, _magR = MAGNET_RADIUS * _prMul;
    for (const g of rt.ground) {
      g.update(dt);
      if (!g.lost && !g.picked && !g.dead && !a.dead) {
        const dx = a.x - g.x, dy = a.y - g.y, d = Math.hypot(dx, dy) || 1;
        if (d <= _pickR) collect(g);
        else if (d <= _magR) {
          const k = 1 - d / _magR;            // 0 at edge → 1 near player
          const pull = MAGNET_SPEED * _prMul * (0.5 + k * 2.5);   // PILOT: radius buff also speeds the vacuum — felt, not just wider
          g.x += (dx / d) * pull * dt;
          g.y += (dy / d) * pull * dt;
          g.magnet = true;
        }
      }
    }
    sweepDead(rt.ground);
    if (rt.ground.length > 60) rt.ground.splice(0, rt.ground.length - 60);

    // particles + floats (hard caps to bound per-frame draw cost)
    for (const p of rt.particles) p.update(dt); sweepDead(rt.particles);
    // storm bolts fade fast; flash decays
    if (rt.bolts && rt.bolts.length) { for (const b of rt.bolts) b.t -= dt; { let w = 0; for (let i = 0; i < rt.bolts.length; i++) if (rt.bolts[i].t > 0) rt.bolts[w++] = rt.bolts[i]; rt.bolts.length = w; } const _bc = window.__lfPlayRecovery ? 16 : 80; if (rt.bolts.length > _bc) rt.bolts.splice(0, rt.bolts.length - _bc); }
    if (rt.stormFlash > 0) rt.stormFlash -= dt;
    { const _pcap = Math.max(40, Math.round(((rt.cgrun && rt.cgrun.active) ? 160 : 320) * _partScale()));
      if (rt.particles.length > _pcap) rt.particles.splice(0, rt.particles.length - _pcap); }
    for (const f of rt.floats) f.update(dt); sweepDead(rt.floats);
    if (rt.floats.length > 60) rt.floats.splice(0, rt.floats.length - 60);

    // BATCHED EQUIP + SELL FLUSH (Jul 2026): running full-fleet autoEquip and
    // the sell sweep on EVERY pickup caused visible hitches when the magnet
    // vacuumed a siege's worth of drops — now one pass, ≥2.5/s max, covering
    // every pickup since the last flush.
    if (rt._aeDirty && rt.time - rt._aeDirty >= 0.4) {
      rt._aeDirty = 0;
      // THE FLUSH USED TO MUTATE THE HOLD IN SILENCE. onCollect writes the bag
      // badge at pickup time; this pass runs up to 0.4s LATER and can empty the
      // hold completely, and it told nobody. That is both hold-count reports:
      // "386 items" left on screen after sell-on-pickup cleared the bag, and
      // "2 items" that had already been auto-equipped as upgrades. The count was
      // stale, not wrong — which is why a reload "fixed" it.
      const before = state.inventory.length;
      if (state.autoEquipAlways) autoEquip(true);
      // autoEquip can GROW the hold as well as shrink it — displaced gear, hulls
      // that reject a weapon type and escort hand-backs all push into the bag.
      // So the trigger is that the length CHANGED, not that items left: gating on
      // `equipped > 0` left the badge stale in the opposite direction.
      const equipped = before - state.inventory.length;
      const sold = (autoSellSweep(null) || {}).n || 0;
      if (state.inventory.length !== before || sold > 0) {
        // an auto-equip is the one hold-emptying path with nothing to show for
        // itself — the gold float covers the sell. Say so in the arena.
        if (equipped > 0 && rt.archer) rt.floats.push(new E.FloatText(rt.archer.x, rt.archer.y - 40, '▲ ' + equipped + ' EQUIPPED', { color: '#7ce0a0', size: 12, vy: -38, life: 0.8 }));
        if (window.UI && window.UI.syncBag) window.UI.syncBag();
        save();
      }
    }
    // dps
    // dps — one pass, in place. The old form allocated a new array every frame
    // and then reduced over it.
    {
      const w = rt.dmgWindow;
      let k = 0, sum = 0;
      for (let i = 0; i < w.length; i++) {
        const d = w[i];
        if (rt.time - d.t < 2) { w[k++] = d; sum += d.dmg; }
      }
      w.length = k;
      rt.dps = sum / 2;
    }
  }

  // BATTLE-END SWEEP — every arena teardown (tile secured tow, event end,
  // redeploy, respawn) COLLECTS all remaining drops instead of deleting them;
  // the magnet never has to race the tow. Lost-marker items stay lost.
  function sweepLoot() {
    for (const gi of rt.ground) { if (!gi.lost && !gi.picked && !gi.dead && gi.item) collect(gi); }
  }
  // AUTO-SELL SWEEP (Jul 2026): the fleet-aware keep filter routes most drops
  // into the bag so escorts can take upgrades — but the gear autoEquip BENCHES
  // must still auto-sell, or the bag floods and auto-sell "stops working".
  // After every pickup's equip pass, benched items at/below the auto-sell tier
  // that no longer upgrade ANY fleet slot convert to gold + salvage.
  //
  // AN EMPTY SLOT KEEPS ONE ITEM, NOT EVERY ITEM (Aug 2026). This is the whole
  // of the reported "auto-sell doesn't sell": the keep test answered yes for
  // anything that COULD fill an unfitted hardpoint, and an unfitted hardpoint
  // stays unfitted, so it vetoed the tenth grey cannon exactly as loudly as the
  // first. A wing of escorts with Always-equip off has dozens of them and the
  // sweep sold literally nothing, at any tier, forever.
  //
  // So the empty slots are handed out here, best gear first, one item per slot.
  // Anything that beats a FITTED item is still kept unconditionally (strict); a
  // piece whose only merit was filling a hole keeps its place only until a
  // better one turns up for that hole. Nothing that the fleet can actually use
  // is sold, and the hold stops growing without bound.
  //
  // Only SELLABLE items compete for the holes. An above-tier piece is kept
  // whatever happens, so leaving it out of the auction can only reserve a hole
  // for a grey that a better item will eventually take — one item too many, in
  // the safe direction. Erring the other way sells gear the fleet wanted.
  function autoSellSweep(g) {
    const tier = autoSellTier(); if (tier < 0) return { n: 0, gold: 0 };
    const open = emptyHardpoints();
    // Best first — the item that claims a hole should be the strongest candidate
    // for it, not whichever happened to be picked up first.
    const order = state.inventory.slice().sort((a, b) => I.itemPower(b) - I.itemPower(a));
    const doomed = new Set();
    for (const it of order) {
      if (unsellable(it) || it.rarity > tier) continue;
      if (isPickupUpgrade(it, true, true)) continue;        // beats something FITTED AND FLYING — parked hulls are quota'd in the auction below
      // A PARKED HULL DOES NOT HOARD GEAR THE ACTIVE FLEET COULD USE. It may only
      // reserve a copy of something nothing in service can mount at all — the
      // hull-locked case. Ordinary gear therefore competes for the flagship's and
      // the wing's holes only, which is a couple of dozen, not a few hundred.
      const svc = inServiceCanMount(it);
      let claimed = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i];
        if (s.taken || s.base !== it.slot || !canMountWeapon(it, s.hull)) continue;
        if (!s.service && svc) continue;
        // a parked hull's FITTED slot is only a home for something better than
        // what is already in it — otherwise this piece has no home at all
        if (s.cur && I.itemPower(it) <= I.itemPower(s.cur)) continue;
        s.taken = 1; claimed = true; break;
      }
      if (!claimed) doomed.add(it);
    }
    if (!doomed.size) return { n: 0, gold: 0 };
    let gold = 0, n = 0;
    state.inventory = state.inventory.filter((it) => {
      if (!doomed.has(it)) return true;
      gold += C.sellValue(it); addSalvage(it); n++; return false;
    });
    if (n) {
      state.gold += gold;
      const fx = g || rt.archer;
      if (fx) rt.floats.push(new E.FloatText(fx.x, fx.y - 24, '+$' + formatNum(gold) + (n > 1 ? ' (' + n + ' sold)' : ''), { color: '#e6b566', size: 12, vy: -38, life: 0.7 }));
    }
    return { n, gold };
  }
  function collect(g) {
    g.picked = true; g.dead = true;
    const item = g.item;
    // EVERY PICKUP COUNTS FOR LIFE, and this is the only place a drop is really
    // collected. Three of the four paths below never reach the bag — scrapped by
    // the pickup filter, sold on pickup, or slotted straight into an empty
    // hardpoint — so measuring loot by what SITS IN THE HOLD counted none of
    // them: sell-on-pickup scored nothing towards "pick up N pieces of loot"
    // even though selling it required picking it up first.
    state.lifetimeLooted = (state.lifetimeLooted || 0) + 1;
    // PICKUP FILTER: drops below the player's chosen rarity floor never enter
    // the bag — they're instantly scrapped into Galaxy Resources on contact.
    // (An empty slot still equips anything: never scrap gear you NEED.)
    const minR = state.pickupFilter || 0;
    if (!state.equipped[item.slot]) { state.equipped[item.slot] = item; refreshStats(); }
    else if (item.rarity < minR) {
      addSalvage(item);
      rt.floats.push(new E.FloatText(g.x, g.y - 10, '⚒ scrapped', { color: '#8a97ab', size: 11, vy: -36, life: 0.6 }));
      return;
    }
    else if (autoSellTier() >= 0 && item.rarity <= autoSellTier() && !isPickupUpgrade(item)) {
      // AUTO-SELL (default off): low-tier pickups convert straight to gold +
      // salvage. Anything that would upgrade an equipped slot is always kept.
      const gold = C.sellValue(item);
      state.gold += gold; addSalvage(item);
      rt.floats.push(new E.FloatText(g.x, g.y - 10, '+$' + formatNum(gold), { color: '#e6b566', size: 12, vy: -38, life: 0.7 }));
      return;
    }
    else { addToInventory(item); rt._aeDirty = (rt.time || 0.001); }   // batched — see the equip/sell flush in update()
    burst(g.x, g.y, C.RARITY[item.rarity].color, 10, { speed: 130, life: 0.6, glow: item.rarity >= 2 });
    rt.floats.push(new E.FloatText(g.x, g.y - 12, '+1', { color: C.RARITY[item.rarity].color, size: 16, vy: -50, life: 0.8 }));
    if (window.UI) window.UI.onCollect(item);
  }

  function separateEnemies() {
    const list = rt.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (a.dying || a.spawnT < 0.5) continue;
      const ax = a.x, ay = a.y, asz = a.size;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]; if (b.dying || b.spawnT < 0.5) continue;
        const min = asz + b.size;
        const dx = b.x - ax, dy = b.y - ay;
        if (dx > min || dx < -min || dy > min || dy < -min) continue;   // box reject
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;                                   // circle reject
        const dist = Math.sqrt(d2) || 0.01;                              // only now
        const push = (min - dist) * 0.5, ux = dx / dist, uy = dy / dist;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      }
    }
  }

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------
  function draw() {
    // ---- IS THE ARENA ACTUALLY ON SCREEN? ----------------------------------
    // draw() is pure painting. Every array cap and every sweepDead() lives in
    // update(), above — so when a menu covers the arena there is nothing to lose
    // by not painting it, and a whole frame's budget to gain. Until now the full
    // arena was composited at device resolution behind an opaque sheet on every
    // frame, along with the minimap, the LOD colour grade and the 8Hz HUD writes.
    // That is the reported "menu items are delayed while the game is running":
    // the tap queued behind a render of pixels nobody could see.
    //
    // THE SIMULATION IS UNTOUCHED. It keeps real wall-clock time exactly as
    // before — the rule the whole step() comment block above exists to protect.
    // Only invisible pixels are skipped, so nothing about progression, XP, drops
    // or event timers changes.
    //
    // Throttled to ~7Hz: one querySelector is cheap but not free at 60fps, and a
    // screen change landing mid-window costs at most two frames of staleness.
    if (!rt._avT || rt.time - rt._avT > 0.14) {
      rt._avT = rt.time;
      // #screen-battle is not an overlay and never carries .active — the battle
      // screen IS "no overlay active" (see UI.showScreen). The Command sheet is a
      // separate full-inset layer, so it counts too.
      rt._hidden = !!document.querySelector('.screen.overlay.active, #mega.open');
    }
    if (rt._hidden) return;
    // SELF-HEAL canvas fit — runs for BOTH the home-bay and combat paths, before
    // any drawing. Re-fit on a 0 backing store, or when the canvas's CSS size has
    // drifted from the cached rt.w/h (e.g. it was measured small while hidden
    // behind an overlay and the container has since grown). The home-bay branch
    // returns early, so this MUST live above it. Drift check throttled to ~4Hz so
    // we don't force a layout reflow at 60fps.
    if ((rt.canvas.height === 0 || rt.canvas.width === 0) && rt.canvas.offsetHeight > 0) resize();
    else if (!rt._fitT || rt.time - rt._fitT > 0.25) {
      rt._fitT = rt.time;
      const _ow = rt.canvas.offsetWidth, _oh = rt.canvas.offsetHeight;
      // BACKING STORE, NOT JUST THE CSS BOX. iOS Safari can hand the element back
      // with its CSS size intact but the drawing buffer still at the size it had
      // while the screen was hidden (tab to Ships and back), and it changes the
      // device pixel ratio under us on a zoom or a chrome collapse. Either one
      // paints the whole arena into one small corner and leaves the rest of the
      // element blank — the reported broken battle screen — and neither shows up
      // as CSS-box drift, so both are checked here.
      const _dpr = dpr();
      if (_oh > 0 && (Math.abs(_ow - rt.w) > 2 || Math.abs(_oh - rt.h) > 2
                      || Math.abs(rt.canvas.width - Math.round(_ow * _dpr)) > 2
                      || Math.abs(rt.canvas.height - Math.round(_oh * _dpr)) > 2)) resize();
    }
    if (R.setLOD) R.setLOD(rt.lod | 0);
    // THE CSS GRADE IS THE SINGLE BIGGEST FIXED COST ON THIS SCREEN: a
    // saturate/contrast/brightness filter over the full canvas, recomposited by
    // the browser EVERY frame at device resolution, win or lose. At LOD 1+ the
    // inline style overrides it to none; the deep-space vignette overlay
    // (#arena-wrap::after) follows at LOD 2.
    if ((rt.lod | 0) !== rt._lodCss) {
      rt._lodCss = rt.lod | 0;
      try {
        rt.canvas.style.filter = rt._lodCss ? 'none' : '';
        const aw = document.getElementById('arena-wrap');
        if (aw) aw.classList.toggle('perf-lean', rt._lodCss >= 2);
      } catch (e) {}
    }
    const { ctx, w, h } = rt;
    // OPAQUE BACKDROP, NOT clearRect. A transparent canvas shows whatever is
    // behind it, and on iOS that is the white page — so any frame that failed to
    // cover the element (a mid-resize frame, a world smaller than the viewport)
    // flashed white instead of deep space.
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, w, h);
    // HOME HANGAR (Safe Zone): docked-ship bay scene instead of the space arena
    if (state.currentDungeon < 1) {
      drawHangarScene();
      drawPortrait();
      if (window.UI) window.UI.syncHUD();
      return;
    }
    ctx.save();
    const z = rt.zoom || 1;
    const shx = rt.shake ? (Math.random()-0.5)*rt.shake : 0, shy = rt.shake ? (Math.random()-0.5)*rt.shake : 0;
    // (shake decays in update(dt) — time-based — so it stays smooth at any game speed)
    ctx.scale(z, z);
    ctx.translate(-rt.cam.x + shx, -rt.cam.y + shy);
    R.drawArena(ctx, rt.worldW, rt.worldH, rt.time, state.currentDungeon);
    // VOID ZONE — black-hole arena dressing under everything else
    if (state.currentSystem) { try { drawVoidArena(ctx); } catch (e) {} }
    // (Voidmaw singularities are drawn LATER, above the player — see the hazard
    // pass after drawArcher. A well hidden under the flagship's own aura is not a
    // readable hazard.)
    // ✦ EVENT HORIZON LANCE — alignment line, the beam, and its fracture lanes
    try { drawLance(ctx); } catch (e) {}
    // ✦ ETERNUM DEATH BEAMS — continuous locks on the nearest hostiles
    try { drawBeams(ctx); } catch (e) {}
    // PRISM MINING — ore field + miners, drawn in world space just above the
    // arena floor (enemies & player render on top).
    if (state.prismRun && state.prismRun.active && window.PRISM && window.PRISM.render) { try { window.PRISM.render(ctx, rt.time, rt); } catch (e) {} }
    // spawn-node markers (pending respawns)
    for (const n of rt.nodes) {
      if (!n.enemy && n.respawnT > 0) {
        const k = 1 - n.respawnT / RESPAWN_SEC;
        ctx.strokeStyle = `rgba(226,59,78,${0.25 + k*0.4})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(n.x, n.y, 6 + (1-k)*10, 0, 7); ctx.stroke();
      }
    }
    // Two passes, two state changes — every additive halo under one 'lighter',
    // then every core. Previously each particle switched the mode twice.
    if (rt.particles.length) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const p of rt.particles) R.drawParticleGlow(ctx, p);
      ctx.restore();
      for (const p of rt.particles) R.drawParticle(ctx, p);
      ctx.globalAlpha = 1;
    }
    // STORM CONDUIT bolts — cyan glow pass + white-hot core pass
    if (rt.bolts && rt.bolts.length) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const b of rt.bolts) {
        const a = Math.pow(Math.max(0, b.t / b.life), 0.6);   // slow perceived fade — bolts linger
        ctx.shadowColor = '#7fd6ff'; ctx.shadowBlur = rt.lod ? 0 : 22 * a;   // shadowBlur is the priciest stroke a 2D context draws
        ctx.strokeStyle = 'rgba(110,200,255,' + (0.75 * a) + ')'; ctx.lineWidth = b.w * 2.1;
        ctx.beginPath(); ctx.moveTo(b.pts[0][0], b.pts[0][1]);
        for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i][0], b.pts[i][1]);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.95 * a) + ')'; ctx.lineWidth = b.w * 0.75;
        ctx.stroke();
      }
      ctx.restore();
    }
    drawGround(ctx);
    for (const e of rt.enemies) R.drawEnemy(ctx, e);
    for (const es of (rt.escorts || [])) R.drawEscort(ctx, es.key, es.x, es.y, rt.time, es.heal);
    R.drawArcher(ctx, rt.archer.x, rt.archer.y, 1.5, rt.archer, state.equipped, rt.time);
    for (const dr of rt.drones) R.drawDrone(ctx, dr.x, dr.y, rt.time, dr.face, dr.flash);
    try { if (window.FIGHTERS) window.FIGHTERS.draw(ctx); } catch (e) {}
    // ---- HAZARD PASS — ALWAYS ABOVE THE FLEET --------------------------------
    // Anything the player has to READ AND AVOID draws last. The Voidmaw's wells
    // used to paint under the archer, and on a capital hull (Voidmaw is drawn at
    // 2.8x) the ship's own aura covered them completely: the black holes and the
    // red telegraph marking where they are about to collapse both disappeared.
    if (rt.holes && rt.holes.length) { try { drawSingularities(ctx); } catch (e) {} }
    for (const p of rt.projectiles) R.drawArrow(ctx, p);
    for (const b of rt.ebolts) R.drawEnemyBolt(ctx, b);
    for (const f of rt.floats) R.drawFloat(ctx, f);
    ctx.restore();

    if (rt.archer.dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0,0,w,h);
      ctx.fillStyle = '#e23b4e'; ctx.font = '700 28px Cinzel, serif'; ctx.textAlign = 'center';
      ctx.fillText('DOWN', w/2, h/2 - 4);
      ctx.font = '600 14px Rajdhani'; ctx.fillStyle = '#ce9b78';
      ctx.fillText('Choose a zone to redeploy', w/2, h/2 + 22);
    }
    // STORM FLASH — whole-viewport lightning whiteout for a couple frames
    if (rt.stormFlash > 0) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(200,235,255,' + Math.min(0.5, rt.stormFlash * 2.4) + ')';
      ctx.fillRect(0, 0, rt.w * (window.devicePixelRatio || 1), rt.h * (window.devicePixelRatio || 1));
      ctx.restore();
    }
    // LOW HP: red danger vignette breathes at the edges when hull is critical.
    if (!rt.archer.dead && rt.stats && rt.stats.maxHp > 0) {
      const hpPct = rt.archer.hp / rt.stats.maxHp;
      if (hpPct < 0.3) {
        const sev = (0.3 - hpPct) / 0.3;                       // 0 → 1 as HP falls
        const pa = sev * (0.16 + 0.1 * Math.sin(rt.time * 6));
        // The gradient is GEOMETRY, which only changes on resize — it used to be
        // rebuilt (two colour stops and all) every frame purely to animate its
        // opacity. Cached per viewport; the breathing rides globalAlpha.
        ctx.globalAlpha = Math.max(0, pa);
        ctx.fillStyle = vignette('hp', 0.34, 0.6, '255,30,50');
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }
    // SUPERNOVA flash — the citadel's death blooms white across the zone
    if (rt.novaT > 0) {
      ctx.globalAlpha = Math.min(1, rt.novaT / 0.6) * 0.9;
      ctx.fillStyle = '#fff4da'; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    // HYPERSPACE WARP-IN — radial streaks collapse as the zone resolves
    if (rt.warpT > 0) {
      const k = Math.max(0, rt.warpT / 0.85);            // 1 → 0
      const cx2 = w / 2, cy2 = h / 2, R0 = Math.max(w, h);
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = '#cfe8ff';
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2 + (i % 5) * 0.07;
        const r1 = 26 + (1 - k) * R0 * 0.72;
        const r2 = r1 + 36 + 110 * k;
        ctx.globalAlpha = Math.min(1, k * 1.3) * (0.3 + (i % 3) * 0.22);
        ctx.lineWidth = 1 + (i % 3);
        ctx.beginPath(); ctx.moveTo(cx2 + Math.cos(a) * r1, cy2 + Math.sin(a) * r1);
        ctx.lineTo(cx2 + Math.cos(a) * r2, cy2 + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.globalAlpha = k * 0.45; ctx.fillStyle = '#eaf6ff';
      ctx.beginPath(); ctx.arc(cx2, cy2, 46 * k, 0, 7); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // SUPER BOSS: the whole zone pulses red at the edges while one is loose.
    if (rt.superBossAlive) {
      const pa = 0.12 + 0.10 * Math.sin(rt.time * 5);
      ctx.globalAlpha = pa;
      ctx.fillStyle = vignette('sb', 0.28, 0.62, '255,42,74');
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    drawMinimap(ctx);
    // THE PORTRAIT IS A SECOND CANVAS, redrawn every frame. During a cargo run it
    // is the cheapest thing to give up: 12Hz instead of 60 costs a hand-flown
    // escort nothing and gives the arena back a whole canvas's worth of work.
    if (!(rt.cgrun && rt.cgrun.active)) drawPortrait();
    else if (!rt._prT || rt.time - rt._prT > 0.08) { rt._prT = rt.time; drawPortrait(); }
    // AEGIS FIELD PROJECTORS — the fields themselves, painted UNDER the fleet and
    // every other effect so they read as space rather than as an overlay. One
    // cached sprite blit per field; see the frame-time note in aegis-auras.js.
    if (window.AEGIS && window.AEGIS.active && window.AEGIS.active()) { try { window.AEGIS.render(ctx, rt.time, rt); } catch (e) {} }
    // DREADNAUGHT raid-boss phase FX (telegraphs, novas) — drawn over the arena.
    if (window.DREAD && window.DREAD.render) { try { window.DREAD.render(ctx, rt.time, rt); } catch (e) {} }
    // SERVER DREADNAUGHT — void aura + weak-point FX over the arena.
    if (rt.sdrun && rt.sdrun.active && window.SDREAD && window.SDREAD.engineRender) { try { window.SDREAD.engineRender(ctx, rt.time, rt); } catch (e) {} }
    // KING OF THE HILL — crown-gold arena vignette.
    if (rt.kothrun && rt.kothrun.active && window.KOTH && window.KOTH.engineRender) { try { window.KOTH.engineRender(ctx, rt.time, rt); } catch (e) {} }
    // HOLLOW ARMADA — collapse zones + siege aura over the arena.
    if (rt.alrun && rt.alrun.active && window.ALBOSS && window.ALBOSS.engineRender) { try { window.ALBOSS.engineRender(ctx, rt.time, rt); } catch (e) {} }
    // HOME CITADEL — the fort, its shield and turret fire, drawn in-world.
    if (rt.hcrun && rt.hcrun.active && window.HOMECIT && window.HOMECIT.engineRender) { try { window.HOMECIT.engineRender(ctx, rt.time, rt); } catch (e) {} }
    // SPACE CARGO DEFENSE — the cargo hull, its lane, the citadel ahead and every
    // live void anomaly, drawn in world space.
    if (rt.cgrun && rt.cgrun.active && window.CARGO && window.CARGO.engineRender) { try { window.CARGO.engineRender(ctx, rt.time, rt); } catch (e) {} }
    // ARMOR CORRUPTION — the player's own debuff readout. Drawn here, in world
    // space with the camera still applied, so it tracks the ship. The swarm
    // dynamic is unreadable if the only place corruption shows is on hostiles:
    // a pilot who cannot see the stacks climbing just experiences the Mechs
    // getting stronger for no stated reason, which reads as a bug.
    if (window.MECHCORR) { try { window.MECHCORR.drawPlayer(ctx, rt); } catch (e) {} }
    // HUD DOM writes are throttled — canvas runs at 60fps, text at ~8Hz
    if (window.UI && (!rt._hudT || rt.time - rt._hudT > 0.12)) { rt._hudT = rt.time; window.UI.syncHUD(); }
  }

  function drawHangarScene() {
    const { ctx, w, h } = rt;
    const owned = C.SHIPS.filter((s) => state.ownedShips[s.key]);
    let ships = owned.map((s) => ({
      key: s.key, name: s.name, tier: R.shipVisTier(s.key),
      equipped: s.key === state.ship ? state.equipped : (state.fittings[s.key] || {}),
    }));
    if (!ships.length) {
      const s = C.SHIP_BY_KEY[state.ship] || C.SHIPS[0];
      ships = [{ key: s.key, name: s.name, tier: R.shipVisTier(s.key), equipped: state.equipped }];
    }
    // THE HANGAR SCENE IS THE SCREEN (build 731). An earlier 731 pass replaced it
      // with a DOM dashboard and that was the wrong trade: the pad is the game's
      // identity on the one screen a player sits on, and it is free to look at.
      // The dashboard is a SHEET over it now (js/bridge.js), not a replacement.
      rt.hangarHits = R.drawHangar(ctx, w, h, rt.time, ships, state.ship);
  }

  // ---- CACHED PAINT OBJECTS ------------------------------------------------
  // Canvas gradients are expensive to build and immutable once built, so any
  // gradient whose GEOMETRY is fixed belongs in a cache with its opacity driven
  // by globalAlpha. Keyed by viewport so a resize or rotate rebuilds cleanly.
  const _vig = {};
  function vignette(key, inK, outK, rgb) {
    const { ctx, w, h } = rt;
    const id = key + '|' + w + 'x' + h;
    let g = _vig[id];
    if (!g) {
      g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inK, w / 2, h / 2, Math.max(w, h) * outK);
      g.addColorStop(0, 'rgba(' + rgb + ',0)');
      g.addColorStop(1, 'rgba(' + rgb + ',1)');
      for (const k in _vig) if (k.indexOf(key + '|') === 0) delete _vig[k];   // one per key
      _vig[id] = g;
    }
    return g;
  }
  // Baked additive core-bloom, one 128px sprite per tier palette. It used to be a
  // radial gradient built PER DROP PER FRAME — an identical shape rebuilt a dozen
  // times a frame on a busy floor. Baked once at r=64 and drawn scaled; the fade
  // rides globalAlpha instead of being burned into the colour stops (which also
  // fixes a long-standing double-fade: the stops multiplied by fade while the
  // context alpha was already fade, so the bloom faded quadratically).
  const _bloom = {};
  function bloomSprite(key, mid, out) {
    let c = _bloom[key];
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 128;
    const b = c.getContext('2d');
    const gr = b.createRadialGradient(64, 64, 1, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)');
    gr.addColorStop(0.5, 'rgba(' + mid + ',0.3)');
    gr.addColorStop(1, 'rgba(' + out + ',0)');
    b.fillStyle = gr; b.fillRect(0, 0, 128, 128);
    _bloom[key] = c;
    return c;
  }
  function drawGround(ctx) {
    for (const g of rt.ground) {
      const it = g.item;
      const col = g.lost ? '#777' : (it ? C.RARITY[it.rarity].color : '#999');
      const yoff = Math.sin(g.bob) * 3;
      const sc = 0.5 + 0.5 * (g.spawnT);
      // glow puck
      const fade = g.lost ? Math.min(1, g.life / 1.5) : (g.life < 5 ? g.life / 5 : 1);
      ctx.globalAlpha = fade;
      ctx.fillStyle = `rgba(0,0,0,0.3)`; ctx.beginPath(); ctx.ellipse(g.x, g.y + 8, 11*sc, 4*sc, 0, 0, 7); ctx.fill();
      // GLOW scales with rarity — layered alpha discs (no shadowBlur: this path
      // runs for every ground drop, every frame). Mythic+ pulses with a halo.
      const tier = it ? it.rarity : 0;
      const col2 = g.lost ? 'rgba(140,140,140,0.5)' : col;
      if (!g.lost) {
        const pulse = tier >= 5 ? (0.7 + 0.3 * Math.sin(rt.time * 6 + g.bob * 2)) : 1;
        ctx.globalAlpha = fade * (0.22 + tier * 0.05) * pulse;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(g.x, g.y - 2 + yoff, (9 + tier * 1.6) * sc, 0, 7); ctx.fill();
        ctx.globalAlpha = fade;
        if (tier >= 5) {
          const haloR = (12 + tier * 2) * sc * (0.85 + 0.25 * Math.sin(rt.time * 6 + g.bob * 2));
          ctx.globalAlpha = fade * 0.5;
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(g.x, g.y - 2 + yoff, haloR, 0, 7); ctx.stroke();
          ctx.globalAlpha = fade;
        }
      }
      ctx.fillStyle = col2;
      ctx.beginPath(); ctx.arc(g.x, g.y - 2 + yoff, (6 + tier * 0.5) * sc, 0, 7); ctx.fill();
      // light beam — taller & brighter the rarer the drop (Rare and up)
      if (!g.lost && it && tier >= 2) {
        const bh = 30 + tier * 6, bw = (4 + tier * 0.7) * sc;
        ctx.fillStyle = hexToRgba(col, 0.10 + tier * 0.025);
        ctx.fillRect(g.x - bw / 2, g.y - (bh - 8) + yoff, bw, bh);
      }
      // PRIMORDIAL — radiating lightning + static discharge (significantly
      // bigger than any other tier). Bolts crackle outward, rings pulse, the
      // core blooms in the tier palette (Primordial gold / Relic violet / Artifact red).
      if (!g.lost && it && tier >= 11) {
        const cx = g.x, cy = g.y - 2 + yoff, T = rt.time;
        // per-tier palette: [coreMid, coreOuter, bolt0, bolt1, bolt2, ringA, ringB, ringC]
        const PP = tier >= 13
          ? { mid: '255,120,96',  out: '255,31,46',   bolts: ['255,255,255', '255,160,140', '255,45,55'],  rings: ['255,45,55', '255,120,96', '255,200,180'] }
          : tier >= 12
          ? { mid: '200,135,255', out: '138,77,255',  bolts: ['255,255,255', '227,185,255', '170,90,255'],  rings: ['192,97,255', '138,77,255', '227,185,255'] }
          : { mid: '255,230,168', out: '255,154,216', bolts: ['255,255,255', '255,233,176', '154,210,255'], rings: ['255,230,168', '255,154,216', '154,210,255'] };
        const flick = 0.55 + 0.45 * Math.sin(T * 34 + g.bob * 6);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const br = (16 + 8 * flick) * sc;
        ctx.globalAlpha = fade;
        ctx.drawImage(bloomSprite(tier >= 13 ? 'a' : tier >= 12 ? 'r' : 'p', PP.mid, PP.out),
          cx - br, cy - br, br * 2, br * 2);
        const RC = PP.rings;
        for (let r = 0; r < 2; r++) {
          const k = ((T * 0.85 + r * 0.5) % 1);
          ctx.globalAlpha = fade * (1 - k) * 0.55;
          ctx.strokeStyle = 'rgba(' + RC[(r + ((T * 2) | 0)) % 3] + ',1)';
          ctx.lineWidth = (2.2 * (1 - k) + 0.5) * sc;
          ctx.beginPath(); ctx.arc(cx, cy, (10 * sc) + k * 40 * sc, 0, 7); ctx.stroke();
        }
        const N = 7;
        for (let b = 0; b < N; b++) {
          if ((Math.sin(T * 24 + b * 2.3) + 1) < 0.7) continue;   // crackle gate
          const a = (b / N) * 7 + T * 0.7;
          const len = (24 + 14 * flick) * sc;
          ctx.strokeStyle = 'rgba(' + PP.bolts[b % 3] + ',1)';
          ctx.globalAlpha = fade * (0.5 + 0.5 * flick);
          ctx.lineWidth = 1.5 * sc; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(cx, cy);
          let px = cx, py = cy;
          for (let s = 1; s <= 3; s++) {
            const rr = len * s / 3;
            const jit = (s < 3 ? Math.sin(T * 38 + b * 5 + s * 2.1) * 5 * sc : 0);
            px = cx + Math.cos(a) * rr + Math.cos(a + 1.57) * jit;
            py = cy + Math.sin(a) * rr + Math.sin(a + 1.57) * jit;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.globalAlpha = fade * flick; ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(px, py, 1.5 * sc, 0, 7); ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      if (g.lost) {
        ctx.fillStyle = 'rgba(255,90,90,' + fade + ')'; ctx.font = '700 11px Rajdhani'; ctx.textAlign = 'center';
        ctx.fillText('LOST', g.x, g.y - 16 + yoff);
      }
      ctx.globalAlpha = 1;
    }
  }
  // Memoised colour parse. Called for every Rare+ drop every frame, and the
  // fallback branch ran a regex + map each time. The parse is cached per colour;
  // only the alpha string is rebuilt.
  const _rgbC = {};
  function hexToRgba(c, a) {
    let m = _rgbC[c];
    if (!m) {
      m = c[0] === '#' ? [parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16), parseInt(c.slice(5,7),16)] : c.match(/\d+/g).map(Number);
      _rgbC[c] = m;
    }
    return 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + a + ')';
  }

  function drawMinimap(ctx) {
    if (state.currentDungeon < 1) return; // no map in the safe staging zone
    const mw = 78, mh = 78 * (rt.worldH / rt.worldW), pad = 10;
    const mx = rt.w - mw - pad, my = pad;
    const rad = 8;
    ctx.save();
    // rounded dark panel
    ctx.beginPath();
    ctx.moveTo(mx + rad, my);
    ctx.arcTo(mx + mw, my, mx + mw, my + mh, rad);
    ctx.arcTo(mx + mw, my + mh, mx, my + mh, rad);
    ctx.arcTo(mx, my + mh, mx, my, rad);
    ctx.arcTo(mx, my, mx + mw, my, rad);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16,18,26,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.clip();
    const sx = mw / rt.worldW, sy = mh / rt.worldH;
    // enemies
    for (const e of rt.enemies) { if (e.dying) continue; ctx.fillStyle = e.isBoss ? '#ffd24d' : '#ff6a78'; ctx.fillRect(mx + e.x*sx - 1, my + e.y*sy - 1, e.isBoss ? 4 : 2.5, e.isBoss ? 4 : 2.5); }
    // loot
    for (const g of rt.ground) { if (g.lost || g.dead) continue; ctx.fillStyle = C.RARITY[g.item.rarity].color; ctx.fillRect(mx + g.x*sx - 1, my + g.y*sy - 1, 2.5, 2.5); }
    // player
    ctx.fillStyle = '#5b9cff'; ctx.shadowColor = '#5b9cff'; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(mx + rt.archer.x*sx, my + rt.archer.y*sy, 2.8, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    // viewport rect
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.strokeRect(mx + rt.cam.x*sx, my + rt.cam.y*sy, (rt.w/(rt.zoom||1))*sx, (rt.h/(rt.zoom||1))*sy);
    ctx.restore();
  }

  function drawPortrait() {
    if (!rt.portraitCtx) return;
    // hero canvas is retired (display:none) — skip the draw entirely
    if (rt.portraitCanvas && !rt.portraitCanvas.offsetWidth) return;
    // RESYNC — the hero panel resizes with layout; a stale canvas size makes
    // CSS stretch the bitmap and cut ships off at the frame edges
    const pr = rt.portraitCanvas;
    if (pr && pr.offsetWidth && (pr.offsetWidth !== rt.portW || pr.offsetHeight !== rt.portH)) {
      const d = dpr();
      rt.portW = pr.offsetWidth; rt.portH = pr.offsetHeight;
      pr.width = rt.portW * d; pr.height = rt.portH * d;
      rt.portraitCtx = pr.getContext('2d'); rt.portraitCtx.setTransform(d, 0, 0, d, 0, 0);
    }
    const ctx = rt.portraitCtx, cw = rt.portW, ch = rt.portH;
    ctx.clearRect(0, 0, cw, ch);
    const esc = fleetShips();
    // HERO FORMATION (Jul 2026): one clean ROW — flagship first, escorts after,
    // evenly spaced in the SAME ORDER as the fleet cards below. Never stacks.
    const n = 1 + esc.length;
    const cy = ch * 0.52;
    const margin = cw * (n > 3 ? 0.05 : 0.1);
    const slotW = (cw - margin * 2) / n;
    const xAt = (i) => margin + slotW * (i + 0.5);
    const sscale = (k) => (R.shipScaleOf ? R.shipScaleOf(k) : 1);
    const ptier = (R.hullTier ? R.hullTier(state.level) : 5);
    const targetF = Math.min(slotW * 0.92, ch * 0.62);
    const targetE = Math.min(slotW * 0.78, ch * 0.42);
    esc.forEach((sh, i) => {
      if (!R.drawEscort) return;
      ctx.save();
      ctx.translate(xAt(i + 1), cy + Math.sin(rt.time * 2 + i) * 3);
      const es = targetE / (38 * sscale(sh.key));
      ctx.scale(es, es);
      R.drawEscort(ctx, sh.key, 0, 0, rt.time, 0);
      ctx.restore();
    });
    const flagScale = targetF / (42 + ptier * 3);
    R.drawArcher(ctx, xAt(0), cy, flagScale / sscale(state.ship), { facing: -0.35, bob: rt.time * 2.4, hurtFlash: 0, muzzle: 0, recoil: 0 }, state.equipped, rt.time);
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------
  // Slots available on the current ship hull.
  function activeSlots() { return C.shipSlots(state.ship); }
  // Extra slots (beyond a single primary) a given base type has on this ship.
  function slotsForBase(base) { return activeSlots().filter((sk) => C.slotBase(sk) === base); }
  // True when the current ship exposes a 2nd+ slot for this base item type.
  function secondUnlocked(base) { return slotsForBase(base).length >= 2; }
  // Ship-based equipment layout for the Hero screen: one descriptor per real
  // slot the current hull exposes, with a human label ("Cannon", "2nd Cannon"…).
  function equipLayout() {
    const ORD = ['1st ', '2nd ', '3rd ', '4th '];
    const seen = {};
    return activeSlots().map((key) => {
      const base = C.slotBase(key);
      const n = (seen[base] = (seen[base] || 0) + 1);
      const def = C.SLOTS[base];
      const multi = slotsForBase(base).length > 1;
      const label = multi ? (ORD[n - 1] || n + 'th ') + def.name : def.name;
      return { key, base, label, icon: def.icon, item: state.equipped[key] };
    });
  }

  // WARDEN ARRAYS mount ONLY on the Aegis support hull — the fleet aura is its
  // entire reason to exist. Everything else refuses the fitting.
  // TAKES A SHIP KEY, not a class name. A Fighter Carrier files under cls
  // 'Carrier' like every other capital hull — the hangar buckets by cls, and cls
  // also picks escort weapon type and accent — so the launch bay cannot be a
  // class string. `fighterCapacity` is the real signal and the key is what
  // resolves it.
  function canMountWeapon(item, shipKey) {
    if (!item || !I.weaponClassOf) return true;
    const sh = C.SHIP_BY_KEY[shipKey] || {};
    // FIGHTER BAYS now enforce themselves STRUCTURALLY: a Heavy Fighter is a
    // `fighter`-slot item, and only a hull with `fighterCapacity` exposes
    // `fighter` slots — while the Vanguard declares `weapons: 0` and so has no
    // cannon hardpoint to refuse. This guard is the backstop for the paths that
    // pool items by slot before checking the ship (auto-equip, auto-sell).
    if (item.slot === 'fighter') return !!sh.fighterCapacity;
    if (item.slot !== 'bow') return true;
    // HULL-LOCKED CLASSES. The Warden Array and the four AEGIS FIELD PROJECTORS
    // are the support hull's entire identity, so nothing else may mount one.
    // Asked via the class table's own `aura` flag rather than a list of keys —
    // a fifth projector added later is locked automatically.
    const wc = I.weaponClassOf(item);
    if (wc.key === 'support' || wc.aura) return sh.cls === 'Aegis';
    return true;
  }
  function equip(item, targetSlot) {
    const idx = state.inventory.indexOf(item); if (idx === -1) return;
    if (!canMountWeapon(item, state.ship)) {
      if (window.UI) {
        window.UI.unlockToast(item.slot === 'fighter' ? '⚠ Heavy Fighters fit ONLY in a Fighter Bay — fly a Fighter Carrier'
          : '⚠ Warden arrays mount ONLY on the Aegis support hull');
      }
      return false;
    }
    const base = item.slot;
    const slots = slotsForBase(base);
    if (!slots.length) return;
    const firstEmpty = () => slots.find((sk) => !state.equipped[sk]) || slots[0];
    // accept an explicit slot key, the 'primary'/'secondary' aliases, or default
    let slot;
    if (targetSlot && slots.includes(targetSlot)) slot = targetSlot;
    else if (targetSlot === 'secondary') slot = slots[1] || firstEmpty();
    else slot = firstEmpty(); // 'primary' or unspecified
    const prev = state.equipped[slot];
    state.equipped[slot] = item; state.inventory.splice(idx, 1);
    if (prev) state.inventory.push(prev);
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
  }
  // UNEQUIP — pull an item off its hardpoint and back into the bag
  function unequip(slotKey) {
    const it = state.equipped[slotKey];
    if (!it) return false;
    state.equipped[slotKey] = null;
    state.inventory.push(it);
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  // Add an item's salvage roll into the player's galaxy resources, and (if an
  // accumulator is passed) tally what was gained so the UI can report it.
  // Galaxy Resource rewards from SELLING items — was ×5, cut to ×1.5
  // (Jul 2026 economy pass: selling flooded fuel/iron/plasma).
  const SELL_RES_MULT = 1.5;
  function addSalvage(item, acc) {
    const s = C.salvage(item); if (!s) return;
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    for (const k in s) {
      const amt = Math.max(1, Math.round(s[k] * SELL_RES_MULT));
      state.resources[k] = (state.resources[k] || 0) + amt;
      if (acc) acc[k] = (acc[k] || 0) + amt;
    }
  }
  // The EVOLVING PARAGON CANNON is unsellable, enforced HERE not by a flag nobody reads.
  // It re-mints itself when missing, so a sellable Axiom is an infinite gold
  // printer: sell at Paragon rarity → refreshAll → refreshStats → sync() sees no
  // copy → free replacement → repeat. Re-minting is a recovery path for a
  // genuinely lost item; it must never be reachable by choice.

  function sell(item) {
    if (unsellable(item)) return null;
    const idx = state.inventory.indexOf(item); if (idx === -1) return null;
    const gold = C.sellValue(item);
    state.gold += gold; state.inventory.splice(idx, 1);
    const salvage = {}; addSalvage(item, salvage);
    if (window.UI) window.UI.refreshAll(); save();
    return { gold, salvage };
  }
  function sellAllBelow(rarityTier) {
    let earned = 0, n = 0; const salvage = {};
    state.inventory = state.inventory.filter((it) => { if (!unsellable(it) && it.rarity < rarityTier) { earned += C.sellValue(it); addSalvage(it, salvage); n++; return false; } return true; });
    state.gold += earned; if (window.UI) window.UI.refreshAll(); save();
    return { earned, n, salvage };
  }

  // AUTO-EQUIP: maximize total power. For each base type, gather every candidate
  // (all equipped slots of that type + bag) and assign the strongest to the
  // ship's slots for that type; the rest return to the bag.
  function autoEquip(silent) {
    const slots = activeSlots();
    const snap = silent ? null : JSON.stringify(slots.map((s) => state.equipped[s] && state.equipped[s].id));
    C.SLOT_KEYS.forEach((base) => {
      const targets = slotsForBase(base);
      if (!targets.length) return;
      let pool = [];
      targets.forEach((t) => { if (state.equipped[t]) { pool.push(state.equipped[t]); state.equipped[t] = null; } });
      state.inventory = state.inventory.filter((it) => { if (it.slot === base) { pool.push(it); return false; } return true; });
      const flagKey = state.ship;
      pool = [...new Set(pool)];
      // Aegis-only weapons can't sit on other hulls — send them back to the bag
      const reject = pool.filter((it) => !canMountWeapon(it, flagKey));
      pool = pool.filter((it) => canMountWeapon(it, flagKey)).sort((a, b) => I.itemPower(b) - I.itemPower(a));
      reject.forEach((it) => state.inventory.push(it));
      targets.forEach((t, i) => { state.equipped[t] = pool[i] || null; });
      pool.slice(targets.length).forEach((it) => state.inventory.push(it));
    });
    // FLEET AUTO-IMPROVE: every escort's fitting upgrades from the bag too.
    // The flagship picks first; each escort then takes the next-best gear for
    // its own slot layout, so the whole fleet's loadout improves on its own.
    if (!state.fittings) state.fittings = {};
    fleetShips().forEach((sh) => {
      const fit = state.fittings[sh.key] || (state.fittings[sh.key] = {});
      const eSlots = C.shipSlots(sh.key);
      C.SLOT_KEYS.forEach((base) => {
        const targets = eSlots.filter((sk) => C.slotBase(sk) === base);
        if (!targets.length) return;
        let pool = [];
        targets.forEach((t) => { if (fit[t]) { pool.push(fit[t]); fit[t] = null; } });
        state.inventory = state.inventory.filter((it) => { if (it.slot === base) { pool.push(it); return false; } return true; });
        pool = [...new Set(pool)];
        const eReject = pool.filter((it) => !canMountWeapon(it, sh.key));
        pool = pool.filter((it) => canMountWeapon(it, sh.key)).sort((a, b) => I.itemPower(b) - I.itemPower(a));
        eReject.forEach((it) => state.inventory.push(it));
        targets.forEach((t, i) => { fit[t] = pool[i] || null; });
        pool.slice(targets.length).forEach((it) => state.inventory.push(it));
      });
    });
    refreshStats();
    if (silent) return 1;
    const after = JSON.stringify(slots.map((s) => state.equipped[s] && state.equipped[s].id));
    const changed = snap !== after;
    if (changed) { if (window.UI) window.UI.refreshAll(); save(); }
    return changed ? 1 : 0;
  }

  // ---- SHIPS: buy / switch (each hull keeps its own saved fitting) ---------
  // A hull unlocks once the PREVIOUS hull in the chain is owned AND you've
  // scored enough kills while piloting it. Then it can be bought with gold.
  function shipKillsFor(key) { return state.shipKills[key] || 0; }
  function hasBlueprint(key) { const s = C.SHIP_BY_KEY[key]; return !s || s.tier === 0 || !s.bpZone || !!(state.blueprints && state.blueprints[key]); }
  // Award a hull blueprint when its zone's boss is defeated (once).
  function grantBlueprintFor(zone) {
    const key = C.blueprintForZone(zone);
    if (!key) return;
    if (!state.blueprints) state.blueprints = {};
    if (state.blueprints[key]) return;
    state.blueprints[key] = true; save();
    if (window.UI) window.UI.blueprintEvent(C.SHIP_BY_KEY[key]);
  }
  function shipUnlocked(key) {
    const ship = C.SHIP_BY_KEY[key]; if (!ship) return false;
    // A HULL YOU ALREADY OWN IS UNLOCKED, FULL STOP. This function answers two
    // different questions for its two callers — shipBuyState asks "can progress
    // reach this?" and NANO.ownsHull asks "do I have this?" — and the rules
    // below only ever answered the first. Two ways an OWNED hull read as locked:
    // an award-only hull (Voidmaw, Eternum) returned false by design, and a
    // Dread-class hull is gated on reqLevel — 160/180/200 for Harbinger/Tyrant/
    // Omega, all ABOVE the 150 level cap, so after the season reset every Dread
    // you own vanished from Nanocores' MY HULLS. Ownership is checked first now;
    // shipBuyState already returns 'owned' before it ever consults this, so the
    // buy path is unaffected.
    if (state.ownedShips && state.ownedShips[key]) return true;
    if (awardOnly(ship)) return false;   // earned, never unlocked by progress
    if (ship.tier === 0) return true;
    if (ship.megaCost) return (state.level || 1) >= (ship.reqLevel || 1);   // DREAD-class: level-gated direct buy
    // Jul 2026: no prior-hull requirement — recover the blueprint and hit the
    // TOTAL kill count with ANY ship. Kills are kills.
    return hasBlueprint(key) && (state.totalKills || 0) >= (ship.reqKills || 0);
  }
  // DREAD-class multi-currency cost helpers.
  // `state.resources` CAN be absent — half a dozen call sites create it
  // defensively, which is the tell — and both of these used to reach straight
  // through it. That is the Dread crash: opening the ships screen renders every
  // hull, shipBuyState() calls megaAfford() on each Dread-class one, and
  // `state.resources.fuel` threw on a save with no resources block, taking the
  // whole screen down with it.
  function ensureResources() {
    if (!state.resources || typeof state.resources !== 'object') state.resources = { fuel: 0, iron: 0, plasma: 0 };
    const r = state.resources;
    for (let i = 0; i < 3; i++) {
      const k = ['fuel', 'iron', 'plasma'][i], v = r[k];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) r[k] = 0;
    }
    return r;
  }
  function megaShort(c) {
    const r = ensureResources();
    if ((state.gold || 0) < (c.gold || 0)) return 'gold';
    if ((r.fuel || 0) < (c.fuel || 0)) return 'fuel';
    if ((r.iron || 0) < (c.iron || 0)) return 'iron';
    if ((r.plasma || 0) < (c.plasma || 0)) return 'plasma';
    if (prismIngots() < (c.prism || 0)) return 'prism';
    if ((state.credits || 0) < (c.credits || 0)) return 'credits';
    if ((state.dreadCores || 0) < (c.dreadCores || 0)) return 'dreadCores';
    return null;
  }
  function megaAfford(c) { return !megaShort(c); }
  // ATOMIC — ALL OF IT OR NONE OF IT.
  // This used to debit gold on its FIRST line and then reach into
  // `state.resources` on its second. On a save with no resources block it took
  // the gold, threw, and never granted the hull: "clicked the Dread, client
  // crashed, all my gold is gone". A Dread-class price is most of a bank
  // balance, so the loss reads as a wipe. Everything is validated up front now
  // and a single bad field charges nothing at all.
  function payMega(c) {
    const r = ensureResources();
    const num = (v) => { const n = Number(v || 0); return isFinite(n) && n >= 0 ? n : NaN; };
    const plan = { gold: num(c.gold), fuel: num(c.fuel), iron: num(c.iron), plasma: num(c.plasma),
                   prism: num(c.prism), credits: num(c.credits), dreadCores: num(c.dreadCores) };
    for (const k in plan) {
      if (!isFinite(plan[k])) { try { console.warn('[LOOTFLEET] payMega refused — bad cost field: ' + k); } catch (e) {} return false; }
    }
    if (megaShort(c)) return false;
    state.gold = Math.max(0, (state.gold || 0) - plan.gold);
    r.fuel = Math.max(0, r.fuel - plan.fuel);
    r.iron = Math.max(0, r.iron - plan.iron);
    r.plasma = Math.max(0, r.plasma - plan.plasma);
    if (plan.prism && state.prism) state.prism.ingots = Math.max(0, (state.prism.ingots || 0) - plan.prism);
    state.credits = Math.max(0, (state.credits || 0) - plan.credits);
    state.dreadCores = Math.max(0, (state.dreadCores || 0) - plan.dreadCores);
    return true;
  }
  // CURRENCY INTEGRITY (Aug 2026, the gold-wipe reports).
  // JSON.stringify turns NaN and Infinity into null, so ONE bad multiply
  // anywhere in a reward chain does not merely corrupt the number in memory — it
  // is written to the save as null and the balance is gone on the next load.
  // gainXp() has guarded against exactly this since the day it was written
  // ("a NaN here corrupts xp forever"); the currencies never did. Nothing
  // corrupt is allowed to reach storage now: the last finite value for each
  // balance is remembered and restored in its place.
  const CURRENCY_KEYS = ['gold', 'credits', 'dreadCores', 'salvage'];
  const _curGood = {};
  function guardCurrencies() {
    let bad = 0;
    const check = (obj, key, tag) => {
      const v = obj[key];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { _curGood[tag] = v; return; }
      obj[key] = _curGood[tag] != null ? _curGood[tag] : 0;
      bad++;
    };
    for (let i = 0; i < CURRENCY_KEYS.length; i++) {
      const k = CURRENCY_KEYS[i];
      if (k in state || _curGood[k] != null) check(state, k, k);
    }
    const r = ensureResources();
    check(r, 'fuel', 'res.fuel'); check(r, 'iron', 'res.iron'); check(r, 'plasma', 'res.plasma');
    if (state.prism) check(state.prism, 'ingots', 'prism.ingots');
    if (bad) { try { console.warn('[LOOTFLEET] currency guard: restored ' + bad + ' corrupt balance(s) — refused to save them as zero'); } catch (e) {} }
    return bad;
  }
  // Descriptor the store uses to render each hull's state.
  // WHICH HULL, NOT JUST HOW MANY. The leaderboard row has always published a
  // hull COUNT (`ships`), which is enough for the Discord feed to notice that a
  // pilot gained one but not to name it or show its art. Both acquisition paths
  // stamp the key here so the feed can post the real sprite.
  function markHullEarned(key) {
    try {
      const sh = C.SHIP_BY_KEY[key];
      state.lastHull = { key, name: (sh && sh.name) || key, at: Date.now() };
    } catch (e) {}
    // AND ANNOUNCE IT. Discord showed art for Kaevith hulls only, because
    // log_xen_hull() was the single acquisition anyone ever reported to the
    // server; the leaderboard-count route needs art columns that three competing
    // lb_upsert overloads keep dropping. This reports every hull down the path
    // that works (supabase/hull-announce.sql). Idempotent per pilot per hull on
    // the server, so a repeat call posts nothing, and Kaevith keys are refused
    // here because they already have their own louder card.
    try { if (window.TERRITORY && window.TERRITORY.logHull) window.TERRITORY.logHull(key); } catch (e) {}
  }
  function shipBuyState(key) {
    const ship = C.SHIP_BY_KEY[key];
    const owned = !!state.ownedShips[key];
    const active = state.ship === key;
    if (ship.megaCost) {
      return { key, owned, active, unlocked: (state.level || 1) >= (ship.reqLevel || 1),
               affordable: megaAfford(ship.megaCost), megaCost: ship.megaCost, reqLevel: ship.reqLevel || 1,
               hasBlueprint: true, prevOwned: true, killsMet: true, killsHave: 0, killsNeed: 0, price: 0 };
    }
    const prev = C.shipPrevKey(key);
    const have = state.totalKills || 0;              // ANY ship — no prior-hull gate
    const need = ship.reqKills || 0;
    const bp = hasBlueprint(key);
    const prevOwned = true;
    const killsMet = have >= need;
    const unlocked = !awardOnly(ship) && bp && prevOwned && killsMet;
    const resAfford = ship.resPrice ? canAfford(ship.resPrice) : null;
    return { key, owned, active, unlocked,
             affordable: ship.resPrice ? resAfford : state.gold >= ship.price,
             resPrice: ship.resPrice || null, resAfford,
             hasBlueprint: bp, bpZone: ship.bpZone, prevKey: prev, prevOwned,
             killsHave: have, killsNeed: need, killsMet, price: ship.price };
  }
  // AWARD-ONLY HULLS are never for sale, in any currency. hasBlueprint() returns
  // true for any hull with no bpZone and killsMet is trivially true at reqKills 0,
  // so a price-0 award hull (Veridian, the Eternum, event/faction drops) would
  // otherwise read as "unlocked and affordable" and hand itself over for free.
  // `unreleased` joins this list: a hull with no price, no megaCost and no build
  // order otherwise reads as "unlocked and affordable" and hands itself over for
  // free — the exact failure this guard exists for.
  // `tour` joins for the same reason `unreleased` did: a hull with no price, no
  // megaCost and no build order reads as "unlocked and affordable" and hands itself
  // over for free. Both are award-only routes, like missionShip and event.
  // `build` JOINS THE LIST TOO. A hull with a build order is never a gold
  // purchase, and every one of them carries `price: 0` — so `state.gold < 0` is
  // false and buyShip() would have handed the Oblivion Spears, the Planetbreaker
  // and now the two carrier apexes over for nothing the moment shipUnlocked()
  // passed. Exactly the failure this guard exists for.
  function awardOnly(s) { return !!(s && (s.celestial || s.missionShip || s.event || s.alienTech || s.emberTech || s.flyReq || s.unreleased || s.tour || s.build)); }
  function buyShip(key) {
    const ship = C.SHIP_BY_KEY[key];
    if (!ship || state.ownedShips[key]) return { ok: false, reason: 'owned' };
    if (awardOnly(ship)) return { ok: false, reason: 'award' };
    if (!shipUnlocked(key)) return { ok: false, reason: 'locked' };
    // DREAD-class hulls: paid in a MIX of every currency.
    if (ship.megaCost) {
      const miss = megaShort(ship.megaCost);
      if (miss) return { ok: false, reason: miss };
      // payMega is all-or-nothing and reports it. Never assume the charge landed.
      if (!payMega(ship.megaCost)) return { ok: false, reason: 'gold' };
    } else if (ship.resPrice) {
      if (!canAfford(ship.resPrice)) return { ok: false, reason: 'resources' };
      state.resources.fuel -= ship.resPrice.fuel || 0;
      state.resources.iron -= ship.resPrice.iron || 0;
      state.resources.plasma -= ship.resPrice.plasma || 0;
    } else {
      if (state.gold < ship.price) return { ok: false, reason: 'gold' };
      state.gold -= ship.price;
    }
    state.ownedShips[key] = true;
    if (state.shipKills[key] == null) state.shipKills[key] = 0;
    markHullEarned(key);
    save();
    if (window.UI) window.UI.refreshAll();
    return { ok: true };
  }
  // Directly grant a hull (used by the secret Mothership unlock). Marks it owned,
  // recovers its blueprint, and seeds its kill counter so it shows as a fully
  // unlocked, switchable ship in the hangar.
  // A FIGHTER CARRIER ARRIVES FLYABLE. Every other hull can be flown the moment
  // you own it; a bare Fighter Carrier cannot, because with no bay fitted it has
  // literally no weapon — no cannon hardpoint to fall back on and no craft to
  // launch. So one is delivered with every bay filled with a COMMON fighter.
  //
  // Common on purpose: it is the floor, not a gift. The whole progression of the
  // class is replacing these with better marques and rarities, and seeding
  // anything higher would skip the first several hours of that. They roll at the
  // pilot's current depth so the stat lines are honest for where they are.
  //
  // Only ever fills EMPTY bays, so it can never overwrite a fitting.
  function seedFighterBays(key) {
    const sh = C.SHIP_BY_KEY[key]; if (!sh || !(sh.fighterCapacity | 0)) return 0;
    if (!state.fittings) state.fittings = {};
    const live = (key === state.ship);
    const fit = live ? state.equipped : (state.fittings[key] || (state.fittings[key] = {}));
    const zone = Math.max(1, (state.currentDungeon | 0) || 1);
    const slots = C.shipSlots(key);
    let n = 0;
    for (let i = 0; i < slots.length; i++) {
      const sk = slots[i];
      if (C.slotBase(sk) !== 'fighter' || fit[sk]) continue;
      try { fit[sk] = I.generate(zone, 0, 'fighter'); n++; } catch (e) {}
    }
    if (n && live) refreshStats();
    return n;
  }
  function grantShip(key) {
    const ship = C.SHIP_BY_KEY[key];
    if (!ship || state.ownedShips[key]) return false;
    state.ownedShips[key] = true;
    if (state.shipKills[key] == null) state.shipKills[key] = 0;
    markHullEarned(key);
    if (ship.bpZone != null) { if (!state.blueprints) state.blueprints = {}; state.blueprints[key] = true; }
    seedFighterBays(key);          // a carrier is delivered with its wing aboard
    save();
    if (window.UI) window.UI.refreshAll();
    return true;
  }
  // ---- FLIGHT LICENCE ------------------------------------------------------
  // Some hulls are OWNED long before they are FLYABLE. A hull with `flyReq` is
  // checked on every switch, not only on grant: the Eternum can sit in a hangar
  // for weeks while the pilot works toward the licence, and a Pilot Ascension
  // must never leave someone flying a hull they no longer qualify for.
  function canFlyShip(key) {
    const sh = C.SHIP_BY_KEY[key]; const rq = sh && sh.flyReq;
    if (!rq) return { ok: true };
    // FLIGHT WAIVER — the FULL FLEET coupon hands over every hull, and a hull you
    // own but may not fly is not a hull you were given. The waiver clears every
    // licence requirement (missions, stars, prerequisite hull) for the account.
    if (state.flightWaiver) return { ok: true, waived: true };
    const miss = { missions: state.lifetimeMissions | 0, cargo: (state.cargo && state.cargo.wins) | 0,
                   stars: ascStars(), ship: !!(state.ownedShips || {})[rq.ship] };
    const need = [];
    if (rq.missions && miss.missions < rq.missions) need.push({ k: 'missions', have: miss.missions, want: rq.missions });
    // CARGO DELIVERIES, not missions. The Eternum licence is earned in Space Cargo
    // Defense, so it counts shipments SECURED (cargo.wins) — it was reading the
    // general mission tally, which any board completion ticked up.
    if (rq.cargo && miss.cargo < rq.cargo) need.push({ k: 'cargo', have: miss.cargo, want: rq.cargo });
    if (rq.stars && miss.stars < rq.stars) need.push({ k: 'stars', have: miss.stars, want: rq.stars });
    if (rq.ship && !miss.ship) need.push({ k: 'ship', have: 0, want: 1, ship: rq.ship });
    return { ok: !need.length, need, req: rq, have: miss };
  }
  function switchShip(key) {
    if (!state.ownedShips[key] || key === state.ship) return false;
    if (!canFlyShip(key).ok) return false;
    // stash current fitting, then load (or init) the target ship's fitting
    state.fittings[state.ship] = state.equipped;
    const next = state.fittings[key] || {};
    const fit = {};
    C.shipSlots(key).forEach((sk) => { fit[sk] = next[sk] || null; });
    // any gear that no longer fits the new hull's slots goes back to the bag
    Object.keys(next).forEach((sk) => { if (next[sk] && !(sk in fit)) state.inventory.push(next[sk]); });
    state.equipped = fit;
    state.ship = key;
    // the new flagship can't also fly as an escort — free its fleet slot
    if (state.fleet) state.fleet = state.fleet.map((k) => (k === key ? null : k));
    if (state.shipKills[key] == null) state.shipKills[key] = 0;
    if (state.autoEquipAlways) autoEquip(true);
    loadDroneBay(key);   // the hull's own bay, stashed by clampDrones() when it was last flown
    refreshStats(); spawnDrones();
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  function shipDroneCount() { const s = C.SHIP_BY_KEY[state.ship]; return s ? (s.drones || 0) : 0; }
  // A GUN-LESS CARRIER — bays and NO cannon hardpoint. Its damage leaves the ship.
  //
  // This used to be "has bays", which was true when the Vanguard (weapons: 0) was
  // the only carrier in the game. The Dread Praetorian carries FOUR cannons
  // alongside six bays, and the Aquila and Corvus five — the whole point of the
  // Dread-class carrier is that it gives up nothing — so the old test silenced
  // every gun on the apex hull the moment it launched fighters. The cannons are
  // what `weapons` declares, so that is what the test reads.
  function fighterHull() { const s = C.SHIP_BY_KEY[state.ship]; return !!(s && s.fighterCapacity && !(s.weapons | 0)); }

  // ---- DRONES (carrier bays) -----------------------------------------------
  // EVERY HULL KEEPS ITS OWN BAY, exactly like `fittings` keeps its own gear.
  //
  // `state.drones` was a single account-wide counter clamped to the ACTIVE hull's
  // capacity, so flying a full 8-bay Titan and switching to anything smaller threw
  // the surplus away permanently — switch back and the bays were empty and had to
  // be re-earned at 16% a kill. `state.droneBays[shipKey]` is now the stored
  // truth; `state.drones` is the live view of the hull being flown, so every
  // existing reader (damage, power, HUD, the death penalty) is unchanged.
  //
  // clampDrones() WRITES THROUGH: it is called from spawnDrones(), which already
  // runs after every mutation (drone captured, drone lost on death, hull switch,
  // load), so the stored bay tracks the live count without a second call site.
  function clampDrones() {
    const cap = shipDroneCount();
    if (state.drones == null) state.drones = 0;
    if (!state.droneBays) state.droneBays = {};
    state.drones = Math.max(0, Math.min(cap, state.drones | 0));
    state.droneBays[state.ship] = state.drones;
  }
  // Load the target hull's own bay before a switch. A hull with NO record yet
  // (every account, the first time it switches after this build) inherits the old
  // global count and lets clampDrones() trim it to capacity — the pre-fix
  // behaviour — so nobody loses drones to the migration itself.
  function loadDroneBay(key) {
    if (!state.droneBays) state.droneBays = {};
    const rec = state.droneBays[key];
    if (rec != null) state.drones = Math.max(0, rec | 0);
  }
  const DRONE_MAX_VIS = 16;      // ceiling on visible craft, whatever the bay holds
  function spawnDrones() {
    clampDrones();
    const n = state.drones, prev = rt.drones || [];
    rt.drones = [];
    const ax = rt.archer ? rt.archer.x : 0, ay = rt.archer ? rt.archer.y : 0;
    // ONE CRAFT PER DRONE UP TO THE CEILING. The old rule was one sprite per 14
    // real drones, so a 4-bay carrier flew a single dart and read as broken —
    // "the UI says 4, I see 1". Small bays are now literal; only past 16 does a
    // craft stand for several, and dr.n below keeps total damage identical
    // either way. Worst-case sprite count is unchanged at DRONE_MAX_VIS.
    const vis = n <= 0 ? 0 : Math.min(DRONE_MAX_VIS, n);
    for (let i = 0; i < vis; i++) {
      const p = prev[i];
      // Deterministic per-index parameters, so the swarm is stable across a
      // rebuild but no two craft share a lane, a speed or a bob.
      const f1 = ((i * 0.6180339887) % 1), f2 = ((i * 0.7548776662) % 1), f3 = ((i * 0.3247179572) % 1);
      rt.drones.push({
        ang: p ? p.ang : f1 * Math.PI * 2,
        cd: p ? p.cd : Math.random() * 0.5,
        x: p ? p.x : ax, y: p ? p.y : ay,
        rad: 0.68 + f1 * 0.85,            // own orbit lane
        spd: 0.55 + f2 * 1.05,            // own angular pace
        dir: (i % 4 === 0) ? -1 : 1,      // a few run retrograde
        w1: f2 * Math.PI * 2,             // bob phases
        w2: f3 * Math.PI * 2,
        face: 0, flash: 0, n: 1,
      });
    }
    // spread the real bay across the sprites so total damage is unchanged
    for (let i = 0; i < vis; i++) rt.drones[i].n = Math.floor(n / vis) + (i < n % vis ? 1 : 0);
    rebuildEscorts(); // fleet escorts redeploy alongside the drone screen
  }

  // On a kill, a carrier with an empty bay has a chance to capture a drone.
  function maybeDropDrone(e) {
    const cap = shipDroneCount();
    if (cap <= 0 || state.drones >= cap) return;
    if (Math.random() >= C.DRONE.dropChance) return;
    state.drones++;
    spawnDrones();
    if (e) { burst(e.x, e.y, '#7fe0ff', 14, { speed: 150, life: 0.7, glow: true }); rt.floats.push(new E.FloatText(e.x, e.y - 14, '+ DRONE', { color: '#7fe0ff', size: 13, vy: -46, life: 0.9 })); }
    if (window.UI) window.UI.unlockToast('Drone deployed · bay ' + state.drones + '/' + cap);
  }
  function updateDrones(dt) {
    const list = rt.drones;
    if (!list || !list.length) return;
    const a = rt.archer, s = rt.stats, cap = list.length;
    // THE BAY ORBITS OUTSIDE THE HULL. A fixed ~122-unit orbit sits well inside a
    // capital hull's silhouette once the sprite scale is 3–5×, so a 96-bay Dread
    // Omega flew its whole screen underneath itself and read as having no drones.
    let hs = 1;
    try { if (window.RENDER && RENDER.shipScaleOf) hs = RENDER.shipScaleOf(state.ship) || 1; } catch (e) {}
    const base = C.DRONE.orbit * 2.35 + Math.min(96, cap * 4.5) + Math.max(0, hs - 1) * 34;
    const T = rt.time;
    for (let i = 0; i < list.length; i++) {
      const dr = list[i];
      // ---- HIVE ORBIT ------------------------------------------------------
      // Two out-of-phase bobs on the radius and a third on the angle: the path
      // never closes on itself, so the craft weaves around the flagship instead
      // of tracing a circle. Everything is seeded per craft, so no two agree.
      dr.ang += C.DRONE.spin * dr.spd * dr.dir * dt;
      const wob = Math.sin(T * 1.6 + dr.w1) * 0.55 + Math.sin(T * 0.83 + dr.w2) * 0.4;
      const rad = base * dr.rad + wob * 34;
      const ta = dr.ang + Math.sin(T * 0.7 + dr.w2) * 0.35;
      const tx = a.x + Math.cos(ta) * rad;
      const ty = a.y + Math.sin(ta) * rad * 0.84;      // slightly flattened
      // chase the station rather than snapping to it — this is what makes the
      // swarm trail and bunch as the flagship manoeuvres
      const k = 1 - Math.exp(-dt * (5 + dr.spd * 3));
      const px = dr.x, py = dr.y;
      dr.x += (tx - dr.x) * k;
      dr.y += (ty - dr.y) * k;
      if (dr.flash > 0) dr.flash -= dt * 6;
      else if (Math.abs(dr.x - px) + Math.abs(dr.y - py) > 0.4) dr.face = Math.atan2(dr.y - py, dr.x - px);
      dr.cd -= dt;
      if (a.dead || rt.awaitingRespawn) continue;
      if (dr.cd > 0) continue;                 // scan only when ready to fire
      let best = null, bd = C.DRONE.range * C.DRONE.range;
      for (const en of rt.enemies) { if (en.dying) continue; const d = (en.x - dr.x) ** 2 + (en.y - dr.y) ** 2; if (d < bd) { bd = d; best = en; } }
      if (best) {
        // under heavy load, drones fire HALF as often for DOUBLE damage — same
        // DPS, half the objects (the sky stays readable too)
        const crowd2 = rt.projectiles.length > 120;
        const p = new E.Projectile(dr.x, dr.y, best, 0, false);
        const crit = Math.random() * 100 < s.critChance;
        // ONE SPRITE, MANY GUNS. dr.n is the flight this craft stands for, so
        // the bay's damage is unchanged no matter how few are drawn.
        let dmg = s.attackDamage * C.DRONE.dmgFrac * (0.9 + Math.random() * 0.2) * Math.max(1, dr.n);
        // WING TACTICS (build 712) — the perk names DRONES explicitly and this
        // path never applied it. Escort hulls did, fighters now do, drones do.
        if (window.PASCEND) dmg *= window.PASCEND.mult('fleet');
        if (crit) dmg *= 1 + s.critDamage / 100;
        if (state.auto) dmg *= 0.8;
        p.damage = Math.max(1, Math.round(dmg * (crowd2 ? 2 : 1))); p.crit = crit; p.drone = true;
        p.angle = Math.atan2(best.y - dr.y, best.x - dr.x);
        // CAP (Aug 2026, the siege crash). Drone fire had NO ceiling — player shots
        // fold past 90, but a 30-drone carrier vs a regenerating Qa-HP warden at
        // 10× speed pumps shots in far faster than impacts remove them. Past the
        // cap the shot simply doesn't spawn — next tick fires again.
        if (rt.projectiles.length < 240) rt.projectiles.push(p);
        dr.cd = (crowd2 ? 2 : 1) / C.DRONE.fireRate;
        // turn to the shot and light the muzzle, so the swarm visibly fights
        dr.face = p.angle; dr.flash = 1;
        rt.particles.push(new E.Particle(dr.x, dr.y, { vx: Math.cos(p.angle) * 70, vy: Math.sin(p.angle) * 70, life: 0.2, size: 2.6, color: '#7fe0ff', glow: true, drag: 0.85 }));
      }
    }
  }

  // ==========================================================================
  // FLEET — escort ships fly with the flagship (Lv 100+, 1 slot / 100 levels)
  // ==========================================================================
  function fleetSlots() {
    let n = 0;
    C.FLEET.slotLevels.forEach((lv) => { if (state.level >= lv) n++; });
    return Math.min(C.FLEET.maxShips - 1, n);
  }
  function fleetShips() {
    if (!state.fleet) return [];
    const seen = {};
    return state.fleet
      .filter((k) => k && state.ownedShips[k] && k !== state.ship && !seen[k] && (seen[k] = 1))
      .slice(0, fleetSlots())
      .map((k) => C.SHIP_BY_KEY[k])
      .filter(Boolean);
  }
  // Assign (or clear with null) escort slot i. Enforces: slot unlocked, hull
  // owned, not the flagship, no duplicates (hulls are unique anyway).
  function setFleetSlot(i, key) {
    if (i < 0 || i >= fleetSlots()) return { ok: false, reason: 'locked' };
    if (!state.fleet) state.fleet = [];
    if (key == null) { state.fleet[i] = null; }
    else {
      if (!state.ownedShips[key]) return { ok: false, reason: 'unowned' };
      if (key === state.ship) return { ok: false, reason: 'flagship' };
      if (state.fleet.some((k, j) => k === key && j !== i)) return { ok: false, reason: 'duplicate' };
      state.fleet[i] = key;
    }
    refreshStats(); rebuildEscorts(); save();
    if (window.UI) window.UI.refreshAll();
    return { ok: true };
  }
  // wide V formation — clear of even the biggest flagship sprites (Jul 2026:
  // old ±36/±66 offsets left escorts hidden UNDER a Titan-class flagship)
  const ESCORT_OFF = [[-95, 58], [95, 58], [-160, 14], [160, 14]];
  // THE FORMATION SCALES WITH THE FLAGSHIP. Capital hulls draw at up to 5× the
  // frigate footprint (RENDER.shipScaleOf) — a Dread Omega is ~228 units across,
  // so fixed ±95 offsets parked the wing INSIDE its silhouette, and the flagship
  // draws after the escorts: they were simply covered by it.
  function escortSpread() {
    let s = 1;
    try { if (window.RENDER && RENDER.shipScaleOf) s = RENDER.shipScaleOf(state.ship) || 1; } catch (e) {}
    return 1 + Math.max(0, s - 1) * 0.3;      // frigate ×1 · Dread Omega ×1.9 · Eternum ×2.26
  }
  const ESCORT_WTYPE = { Frigate: 'laser', Cruiser: 'gatling', Battleship: 'missile', Carrier: 'rail', Aegis: 'support' };
  function rebuildEscorts() {
    const ax = rt.archer ? rt.archer.x : 0, ay = rt.archer ? rt.archer.y : 0;
    const sp = escortSpread();
    rt.escorts = fleetShips().map((sh, i) => ({
      key: sh.key, cls: sh.cls,
      x: ax + ESCORT_OFF[i][0] * sp, y: ay + ESCORT_OFF[i][1] * sp,
      ox: ESCORT_OFF[i][0] * sp, oy: ESCORT_OFF[i][1] * sp,
      cd: Math.random(), heal: 0,
    }));
    // WHAT THIS WING WAS BUILT FOR. The formation offsets above are scaled by the
    // FLAGSHIP's size, so a hull swap invalidates the geometry as surely as a slot
    // change invalidates the roster — both are checked by escortsStale().
    rt.escortsFor = state.ship;
  }

  // DOES THE FLYING WING STILL MATCH THE SAVE?
  //
  // rt.escorts is RUNTIME, rebuilt on demand — and for a long time "on demand"
  // meant two call sites (setFleetSlot and the drone sync), so every OTHER path
  // that changes the fleet left the old wing airborne:
  //
  //   • pilotAscend() disbands the wing in state and lands the pilot in a frigate,
  //     but rt.escorts kept the pre-ascension escort objects — so a Level 1 pilot
  //     flew out of the reset flanked by their endgame hulls, which still drew,
  //     still fired, and still pulsed Aegis repairs. That is the reported bug.
  //   • buyShip() frees the new flagship's escort slot in state, so the same hull
  //     was drawn twice — once as the flagship, once as its own escort.
  //   • adoptSave() replaces state wholesale on a cloud merge, fleet included.
  //
  // Rather than add a third, fourth and fifth call site to remember, the wing
  // RECONCILES against the save. Cost is a length check plus at most four string
  // compares per frame, for a system whose ceiling is four escorts.
  function escortsStale() {
    const have = rt.escorts;
    if (!have) return fleetShips().length > 0;
    if (rt.escortsFor !== state.ship) return true;
    const want = fleetShips();
    if (want.length !== have.length) return true;
    for (let i = 0; i < want.length; i++) if (want[i].key !== have[i].key) return true;
    return false;
  }
  function updateEscorts(dt) {
    const a = rt.archer, s = rt.stats;
    // WARDEN AURA hull recovery — fleet-wide regen ticks here
    if (s && s.regen > 0 && a && !a.dead && a.hp < s.maxHp) {
      a.hp = Math.min(s.maxHp, a.hp + s.maxHp * (s.regen / 100) * dt);
      if (Math.random() < dt * 0.5) rt.floats.push(new E.FloatText(a.x, a.y - 22, '✚', { color: '#7ce0a0', size: 13, vy: -34, life: 0.7 }));
    }
    // BEFORE the early return, so a wing that should now be EMPTY actually
    // empties. This is the frame a disbanded escort stops existing.
    if (escortsStale()) rebuildEscorts();
    const list = rt.escorts;
    if (!list || !list.length || !a) return;
    for (const es of list) {
      // formation flight — ease toward station-keeping point behind the flagship
      const tx = a.x + es.ox, ty = a.y + es.oy;
      const k = Math.min(1, dt * 3.2);
      es.x += (tx - es.x) * k; es.y += (ty - es.y) * k;
      if (es.heal > 0) es.heal -= dt;
      es.cd -= dt;
      if (a.dead || rt.awaitingRespawn || state.currentDungeon < 1) continue;
      if (es.cd > 0) continue;
      if (es.cls === 'Aegis') {
        // support escort: periodic repair pulse instead of weapons fire
        es.cd = 3.2; es.heal = 0.8;
        if (a.hp < s.maxHp) {
          const heal = s.maxHp * 0.02;
          a.hp = Math.min(s.maxHp, a.hp + heal);
          rt.floats.push(new E.FloatText(a.x, a.y - 22, '+' + formatNum(heal), { color: '#7ce0a0', size: 14, vy: -40, life: 0.8 }));
          burst(es.x, es.y, '#7ce0a0', 8, { speed: 90, life: 0.5, glow: true });
        }
        continue;
      }
      // combat escort: fire at the nearest enemy in fleet range
      let best = null, bd = (s.fireRange || 300) * (s.fireRange || 300);
      for (const en of rt.enemies) { if (en.dying) continue; const d = (en.x - es.x) ** 2 + (en.y - es.y) ** 2; if (d < bd) { bd = d; best = en; } }
      if (best) {
        const p = new E.Projectile(es.x, es.y, best, 0, false);
        const crit = Math.random() * 100 < s.critChance;
        let dmg = s.attackDamage * C.FLEET.escortDmgFrac * (0.9 + Math.random() * 0.2);
        if (window.PASCEND) dmg *= window.PASCEND.mult('fleet');   // ASCENSION: Wing Tactics
        if (crit) dmg *= 1 + s.critDamage / 100;
        if (state.auto) dmg *= 0.8;
        p.damage = Math.max(1, Math.round(dmg)); p.crit = crit;
        p.wtype = ESCORT_WTYPE[es.cls] || 'gatling';
        p.angle = Math.atan2(best.y - es.y, best.x - es.x);
        if (rt.projectiles.length < 240) rt.projectiles.push(p);   // same ceiling as drone fire
        es.cd = 1 / C.FLEET.escortFireRate;
      }
    }
  }

  // ---- COSMETICS (skins/auras) + CREDITS wallet -----------------------------
  function cosmeticList(kind) { return C.COSMETICS[kind === 'skin' ? 'skins' : 'auras'] || []; }
  function buyCosmetic(kind, key) {
    const c = cosmeticList(kind).find((x) => x.key === key);
    if (!c) return { ok: false, reason: 'invalid' };
    const cs = state.cosmetics;
    if (cs.owned[key]) return { ok: false, reason: 'owned' };
    if ((state.credits || 0) < c.credits) return { ok: false, reason: 'credits' };
    state.credits -= c.credits;
    cs.owned[key] = 1;
    save();
    return { ok: true };
  }
  function setCosmetic(kind, key) {
    const cs = state.cosmetics;
    if (!cs.owned[key]) return false;
    if (kind === 'skin') cs.skin = key; else cs.aura = key;
    save();
    return true;
  }
  // GRANT AMOUNTS ARE NOT int32. `n | 0` coerces to a SIGNED 32-BIT integer, so
  // any grant above 2,147,483,647 wraps: the 100-billion LootCoin coupon called
  // addCredits(1e11) and the player received 1,215,752,192 — a hundredth of what
  // the code promised, with no error anywhere. Math.floor keeps the "whole units
  // only" intent without the ceiling.
  function addCredits(n) { state.credits = (state.credits || 0) + Math.max(0, Math.floor(Number(n) || 0)); save(); if (window.UI) window.UI.refreshAll(); }

  // ---- GOLD SHOP (rotating, refreshes every 15 min) ------------------------
  function shopWindow() { return Math.floor(Date.now() / (C.SHOP.refreshMin * 60000)); }
  function getShop() {
    const win = shopWindow();
    if (!state.shop || state.shop.window !== win) {
      const zone = Math.max(1, state.highestDungeonReached, state.currentDungeon);
      const items = [];
      // best currently-equipped power per slot (primary or secondary)
      const curBest = (slot) => {
        let p = state.equipped[slot] ? I.itemPower(state.equipped[slot]) : 0;
        const sec = slot === 'bow' ? 'bow2' : slot === 'arrows' ? 'arrows2' : null;
        if (sec && state.equipped[sec]) p = Math.max(p, I.itemPower(state.equipped[sec]));
        return p;
      };
      // average power of currently-equipped gear (reference for empty slots)
      let _eqP = [];
      Object.keys(state.equipped).forEach((sk) => { const it = state.equipped[sk]; if (it) _eqP.push(I.itemPower(it)); });
      const avgPower = _eqP.length ? _eqP.reduce((a, b) => a + b, 0) / _eqP.length : 0;
      // Keep shop items as MODEST upgrades — never a runaway power spike. Cap a
      // chosen item to ~1.35× the player's current gear in that slot.
      const UPGRADE_CAP = 1.35;
      const temper = (it) => {
        const ref = (curBest(it.slot) || avgPower);
        if (ref > 0 && I.itemPower(it) > ref * UPGRADE_CAP) {
          const f = (ref * UPGRADE_CAP) / I.itemPower(it);
          for (const k in it.stats) it.stats[k] = Math.max(1, Math.round(it.stats[k] * f));
        }
        return it;
      };
      for (let i = 0; i < C.SHOP.count; i++) {
        let best = null, bestP = -1;
        // try several rolls and keep the strongest that beats current gear
        for (let t = 0; t < 10; t++) {
          const rar = Math.min(6, C.rollShopRarity()); // cap at Ancient — no Void/Eternal in the market
          const it = I.generate(zone, rar);
          const p = I.itemPower(it);
          if (p > curBest(it.slot) && p > bestP) { best = it; bestP = p; }
          else if (!best && p > bestP) { best = it; bestP = p; }
        }
        items.push(temper(best));
      }
      // FIX the price now, at spawn time — 70% of current gold — so buying one
      // item never changes the price of the others this rotation.
      const fixed = Math.max(50, Math.floor(state.gold * 0.7));
      state.shop = { window: win, items, bought: [], price: fixed };
      save();
    }
    return state.shop;
  }
  function shopTimeLeft() { const ms = C.SHOP.refreshMin * 60000; return Math.ceil(((shopWindow() + 1) * ms - Date.now()) / 1000); }
  // Each Black Market item costs ~70% of the player's current gold (a real
  // sink), with a small floor so it's never free.
  function shopItemPrice() { return Math.max(50, Math.floor(state.gold * 0.7)); }
  // Is a given shop item an upgrade over current gear in its slot?
  function shopIsUpgrade(it) {
    if (!it) return false;
    const cur = state.equipped[it.slot];
    const sec = it.slot === 'bow' ? 'bow2' : it.slot === 'arrows' ? 'arrows2' : null;
    let p = cur ? I.itemPower(cur) : 0;
    if (sec && state.equipped[sec]) p = Math.max(p, I.itemPower(state.equipped[sec]));
    return !cur || I.itemPower(it) > p;
  }
  // ---- LOOTCOIN MARKET (premium gear) --------------------------------------
  // COSMIC CACHE: 3 Cosmic items rolled for your current progression, 10,000
  // LootCoins each, refreshing every hour on the hour.
  // PRIMORDIAL VAULT: ONE Primordial item for your level, 115,000 LootCoins,
  // refreshing daily at midnight CST (America/Chicago — DST-aware).
  const LC_PRICES = { cosmic: 10000, prim: 115000, jackpot: 1000000 };
  // COSMIC JACKPOT CACHE — the 100× premium gamble (1,000,000 LootCoins). Value
  // sits BETWEEN Cosmic and Eternal on nearly every pull, with a tiny jackpot at
  // the very top of the loot table: 0.2% for one of the final two tiers (0.1%
  // Relic + 0.1% Artifact).
  function rollJackpotRarity() {
    const r = Math.random();
    if (r < 0.001) return 13;   // 0.1%  — Artifact (the ultimate)
    if (r < 0.002) return 12;   // +0.1% — Relic  → 0.2% for the final two tiers
    const r2 = Math.random();   // 99.8% — between Cosmic and Eternal
    if (r2 < 0.60) return 8;    // Cosmic
    if (r2 < 0.90) return 9;    // Void
    return 10;                  // Eternal
  }
  function lcZone() { return Math.max(1, state.highestDungeonReached || 0, state.currentDungeon || 0); }
  function lcHourWindow() { return Math.floor(Date.now() / 3600000); }
  function nextChicagoMidnight() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
      const get = (t) => +parts.find((p) => p.type === t).value;
      const left = 86400 - ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second'));
      return Date.now() + Math.max(60, left) * 1000;
    } catch (e) { return Date.now() + 86400000; } // no tz data → 24h fallback
  }
  function getLCMarket() {
    if (!state.lcMarket) state.lcMarket = {};
    const lm = state.lcMarket;
    if (!lm.cosmic || lm.cosmic.window !== lcHourWindow()) {
      const items = [];
      for (let i = 0; i < 3; i++) items.push(I.generate(lcZone(), 8));   // Cosmic
      lm.cosmic = { window: lcHourWindow(), items, bought: [] };
      save();
    }
    if (!lm.prim || !lm.prim.expiresAt || Date.now() >= lm.prim.expiresAt) {
      lm.prim = { item: I.generate(lcZone(), 11), expiresAt: nextChicagoMidnight(), bought: false }; // Primordial
      save();
    }
    // Cosmic Jackpot Cache — one pull per hourly rotation (rolled at purchase).
    if (!lm.jackpot || lm.jackpot.window !== lcHourWindow()) {
      lm.jackpot = { window: lcHourWindow(), bought: false };
      save();
    }
    return lm;
  }
  function lcCosmicTimeLeft() { return Math.max(0, Math.ceil(((lcHourWindow() + 1) * 3600000 - Date.now()) / 1000)); }
  function lcPrimTimeLeft() { return Math.max(0, Math.ceil((getLCMarket().prim.expiresAt - Date.now()) / 1000)); }
  function buyLCMarket(kind, idx) {
    const lm = getLCMarket();
    if (state.inventory.length >= invCap()) return { ok: false, reason: 'full' };
    let it = null, price = 0;
    if (kind === 'cosmic') {
      it = lm.cosmic.items[idx]; price = LC_PRICES.cosmic;
      if (!it || lm.cosmic.bought.includes(idx)) return { ok: false, reason: 'sold' };
    } else if (kind === 'jackpot') {
      price = LC_PRICES.jackpot;
      if (lm.jackpot.bought) return { ok: false, reason: 'sold' };
      if ((state.credits || 0) < price) return { ok: false, reason: 'credits' };
      state.credits -= price;
      lm.jackpot.bought = true;
      it = I.generate(lcZone(), rollJackpotRarity());   // rolled AT purchase — the gamble
      state.inventory.push(it);
      save(); if (window.UI) window.UI.refreshAll();
      return { ok: true, item: it, jackpot: true };
    } else {
      it = lm.prim.item; price = LC_PRICES.prim;
      if (!it || lm.prim.bought) return { ok: false, reason: 'sold' };
    }
    if ((state.credits || 0) < price) return { ok: false, reason: 'credits' };
    state.credits -= price;
    if (kind === 'cosmic') lm.cosmic.bought.push(idx); else lm.prim.bought = true;
    state.inventory.push(it);
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, item: it };
  }

  function buyShopItem(idx) {
    const sh = getShop(); const it = sh.items[idx];
    if (!it || sh.bought.includes(idx)) return false;
    const price = sh.price != null ? sh.price : shopItemPrice();
    if (state.gold < price) return false;
    state.gold -= price; sh.bought.push(idx);
    // equip straight away if it beats current gear, else stash in the bag
    if (!state.equipped[it.slot] || shopIsUpgrade(it)) {
      const prev = state.equipped[it.slot];
      state.equipped[it.slot] = it; if (prev) state.inventory.push(prev);
      if (state.autoEquipAlways) autoEquip(); else refreshStats();
    } else state.inventory.push(it);
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }

  // What an auto-sell with the current filter WOULD sell (for the confirm UI).
  function autoSellPreview(maxTier, keepUpgrades) {
    let n = 0, earned = 0;
    state.inventory.forEach((it) => {
      if (unsellable(it) || it.rarity > maxTier) return;
      if (keepUpgrades) { const cur = state.equipped[it.slot]; if (!cur || I.itemPower(it) > I.itemPower(cur)) return; }
      n++; earned += C.sellValue(it);
    });
    return { n, earned };
  }
  // AUTO-SELL everything matching the user's saved filter (rarity threshold +
  // optional "keep upgrades").
  function autoSell(maxTier, keepUpgrades) {
    state.sellTier = maxTier; state.keepUpgrades = keepUpgrades;
    let n = 0, earned = 0; const salvage = {};
    state.inventory = state.inventory.filter((it) => {
      if (unsellable(it) || it.rarity > maxTier) return true;
      if (keepUpgrades) { const cur = state.equipped[it.slot]; if (!cur || I.itemPower(it) > I.itemPower(cur)) return true; }
      n++; earned += C.sellValue(it); addSalvage(it, salvage); return false;
    });
    state.gold += earned; if (window.UI) window.UI.refreshAll(); save();
    return { n, earned, salvage };
  }
  // AUTOPILOT IS THE DEFAULT STATE. This is an idle game — hands-off is how it
  // is meant to be played, and a player who lands in a zone with autopilot off
  // watches their fleet sit still and take damage without understanding why.
  // Armed on ENTRY only (not from resetZone, which also fires mid-zone), so
  // turning it off to dodge something by hand stays off for that whole visit.
  function armAuto() {
    // A DEPLOY IS A FRESH START.
    //
    // `autoManual` records that the pilot turned autopilot off BY HAND, and it
    // lives in the SAVE — so one tap of the AUTO pill, or one arrow key on a
    // desktop, latched it forever. From then on the arena's own re-arm in
    // showScreen('battle') was permanently switched off, with nothing on screen
    // explaining why. That is "auto attack should always default on — for some
    // reason it's not on again": a single accidental tap, months ago, silently
    // changed the default for good.
    //
    // Manual flight is a choice about the fight you are IN, not an account
    // setting — but it is not a choice about one DEPLOYMENT either. Clearing the
    // latch here re-armed autopilot on every warp, so a pilot who switched auto
    // off and moved to another zone got it switched back on under them, every
    // time: "auto still turns back on after turning it off and switching zone".
    //
    // The latch is now scoped to the SESSION. It is cleared once at boot (see
    // load(), beside `state.auto = true`), which is what undoes the historic
    // for-ever latch this line was added to fix, and respected for the rest of
    // the session — a deploy no longer overrides the pilot's own hand.
    // IDEMPOTENT, NOT EARLY-RETURNING: the stick is reset either way, so a deploy
    // that began mid-drag cannot carry a live joystick vector into the new zone.
    if (!state.autoManual) state.auto = true;
    rt.joy.x = rt.joy.y = 0; rt.joy.active = false;
    try { save(); } catch (e) {}   // persist NOW — a reload must not resurrect stale manual
    try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
  }

  function selectDungeon(d) {
    if (d > state.highestUnlocked) return;
    if (isCitadelZone(d) && citadelCooldownLeft(d) > 0) {
      if (window.UI) window.UI.unlockToast('⛴ Citadel rebuilding — ready in ' + Math.ceil(citadelCooldownLeft(d) / 60) + ' min');
      return false;
    }
    state.currentDungeon = d;
    state.currentSystem = null;   // classic free-play deploy (not a galaxy tile)
    state.dreadRun = null;        // a normal deploy ends any Dreadnaught Hunt
    state.mechRun = null;         // …and any Mech Foundry run
    rt.sdrun = null;              // …and any Server Dreadnaught event run
    rt.siege = null;
    rt.waves = null; rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    rt._pendShield = null;        // leaving a contested tile un-arms its pending shield
    reachZone(d);
    // pushing into a new 100-block opens the next block (still level-gated)
    const cap = C.zoneCap(state.highestDungeonReached);
    const u = Math.min(cap, unlockCeil(state.level));
    if (u > state.highestUnlocked) state.highestUnlocked = u;
    resetZone();
    if (d >= 1) armAuto();          // combat zone — autopilot on by default
    if (d >= 1 && isSwarmZone(d) && window.UI && window.UI.unlockToast) window.UI.unlockToast('☣ SWARM ZONE — 20× density · endless waves · ⚠ junk loot');
    // Deploying to the safe Hangar bay (d=0, e.g. the Bail button) always ends
    // combat cleanly: revive the ship and top up health so you're never "downed"
    // while docked.
    if (d < 1) {
      rt.awaitingRespawn = false;
      rt.archer.dead = false; rt.archer.killer = null;
      rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 2;
    }
    if (window.UI) window.UI.refreshAll(); save();
  }
  // DREADNAUGHT HUNT deploy — real combat into the hunt zone, then resetZone
  // builds the 30-wave gauntlet (dread:true). Bypasses the normal unlock gate:
  // the hunt is gated by its own level requirement + weekly lockout instead.
  function startDreadHunt(tier) {
    const lvl = dreadLevelFor(tier);
    const zone = Math.max(1, Math.min(C.zoneCap ? C.zoneCap(9999) : 999, lvl));
    state.currentDungeon = zone;
    state.currentSystem = null;
    reachZone(zone);
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.mechRun = null;                     // one event at a time
    state.dreadRun = { active: true, tier: tier, started: Date.now() };
    resetZone();
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  // MECH FOUNDRY deploy — the hunt's shape, and for the hunt's reason: a Foundry
  // tier is gated by its own LEVEL requirement, not by how deep the pilot has
  // pushed the zone board.
  //
  // THIS IS WHY IT CANNOT GO THROUGH selectDungeon(). That function opens with
  // `if (d > state.highestUnlocked) return;` — correct for free play, fatal here:
  // the Spawn Nest is Zone 150 and opens at Level 120, and no Level 120 pilot has
  // unlocked Zone 150. So the call returned silently, the screen never changed,
  // and DEPLOY did nothing at all while `mechRun` sat armed.
  //
  // It also deliberately does NOT call reachZone(). That would push
  // `highestDungeonReached` to 560 for a pilot who has never fought their way
  // anywhere near it — a career record, a saveWeight term, and the input to the
  // next selectDungeon's unlock ceiling. The Foundry HANDS you a deep zone; it
  // does not mean you reached it. refreshStats() is called directly instead,
  // which is the only thing reachZone was needed for here (Ship Score reads the
  // live zone).
  function startMechRun(tier) {
    const x = (window.MECHF && window.MECHF.tierOf) ? window.MECHF.tierOf(tier) : null;
    if (!x) return false;
    const zone = Math.max(1, Math.min(C.zoneCap ? C.zoneCap(9999) : 999, x.zone));
    state.currentDungeon = zone;
    state.currentSystem = null;
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; rt.sdrun = null; rt.siege = null;   // one event at a time
    state.mechRun = { active: true, tier: x.t, zone: zone, waves: x.waves, started: Date.now() };
    try { refreshStats(); } catch (e) {}
    resetZone();
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  // SERVER DREADNAUGHT deploy — the seasonal world boss on the REAL battle
  // engine. A clean arena (no wave gauntlet, no zone nodes) with one
  // effectively-unkillable boss; window.SDREAD.engineTick owns the run timer,
  // stage scaling and rewards. Boss stats are (re)applied by the module.
  function startServerDread() {
    const zone = Math.max(1, Math.min(C.zoneCap ? C.zoneCap(9999) : 999, state.level));
    state.currentDungeon = zone;
    state.currentSystem = null;
    reachZone(zone);
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; rt.siege = null; rt.waves = null;
    state.mechRun = null;                     // one event at a time
    resetZone();
    // strip any siege/wave state resetZone re-armed — boss-only arena
    rt.siege = null; rt.waves = null;
    // boss-only arena — strip zone spawns; the event owns the encounter
    sweepLoot();
    rt.nodes = []; rt.enemies = []; rt.ground = [];
    rt.bossInit = rt.bossTimer = 1e9;
    rt.alrun = null; rt.hcrun = null; rt.cgrun = null;   // one event at a time — module watchdogs settle any live run
    rt.sdrun = { active: true, started: Date.now() };
    const b = spawnServerDreadBoss();
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 3;
    if (window.UI) window.UI.refreshAll(); save();
    return b;
  }
  // ---- SERVER DREADNAUGHT boss art — the Voidmaw (Season 1) ---------------
  let _vmBossImg = null;
  function voidmawImg() { if (!_vmBossImg) { _vmBossImg = new Image(); _vmBossImg.src = 'ships/ship-voidmaw.png'; } return _vmBossImg; }
  function spawnServerDreadBoss() {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.24;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isSuper = true; b.isServerDread = true;
    // effectively unlimited HP — anchored to ~an hour of the player's own DPS so
    // the bar barely moves in a 2:30 run; the module tops it back up besides.
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    b.maxHp = b.hp = Math.max(1e9, Math.round(dps * 3600));
    b.speed *= 0.4; b.size = 132;
    b.ranged = true; b.range = 600; b.fireCd = 1.5; b.fireT = 1.6;
    b.tint = '#b04dff';
    b.spriteImg = voidmawImg();
    b.name = 'VOIDMAW';
    if (pushEnemy(b)) { rt.boss = b; rt.bossAlive = true; rt.superBossAlive = true; }
    burst(cx, cy, '#b04dff', 110, { speed: 380, life: 1.3, glow: true });
    if (window.UI) window.UI.bossEvent('super');
    return b;
  }
  // ===========================================================================
  // KING OF THE HILL — the 24-hour PvE kill race, on the REAL battle engine.
  // ---------------------------------------------------------------------------
  // A private instance: normal zone nodes (so hostiles keep coming), no boss, no
  // siege, no waves. window.KOTH.engineTick owns tier scaling and tops the field
  // up; onKill() above strips every reward the zone would normally pay.
  //
  // THE SPAWN ZONE IS FIXED AND reachZone() IS NEVER CALLED. The arena deploys
  // at a fixed zone regardless of where the pilot has actually reached, so banking
  // it as highestDungeonReached would launder free zone-unlock ceiling out of an
  // event that pays nothing — the same rule the Hollow Armada raid follows.
  // ===========================================================================
  function startKoth(zone) {
    const z = Math.max(1, (zone | 0) || 100);
    state.currentDungeon = z;
    state.currentSystem = null;
    state.dreadRun = null; rt.siege = null; rt.waves = null;
    // dense field, fast respawns — a strong build must never stand around
    // waiting for targets, or the ladder measures spawn luck instead of DPS
    rt.tileDensity = 3; rt.tileLoot = 1; rt.tileRespawnMult = 6; rt.deepDeath = false;
    resetZone();
    rt.siege = null; rt.waves = null;      // strip anything resetZone re-armed
    rt.bossInit = rt.bossTimer = 1e9;      // no boss clock — this is a throughput race
    rt.alrun = null; rt.hcrun = null; rt.cgrun = null; rt.sdrun = null;
    rt.kothrun = { active: true, started: Date.now(), tier: null, t: 0 };
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  // Field top-up, called by the module when the arena thins out. Spawns OUTSIDE
  // weapon range so hostiles have to be flown at rather than appearing on top of
  // the pilot, and never attaches to a node — these are extras above the zone's
  // own respawns and must not compete for node slots.
  // KING OF THE HILL — apply the current kill-tier to a hostile AT SPAWN.
  // Every enemy-creation path that can fire inside the arena routes through here
  // before pushing. Scaling on the next engine tick instead was the build-680
  // bug: at endgame DPS the hostile is already dead by then, so the entire
  // difficulty table silently did nothing. No-op outside a KOTH run.
  function kothScale(e) {
    if (!e || !rt.kothrun || !rt.kothrun.active) return e;
    try { if (window.KOTH && window.KOTH.scaleEnemy) window.KOTH.scaleEnemy(e); } catch (_e) {}
    return e;
  }
  function spawnKothEnemy() {
    if (!rt.kothrun || !rt.archer) return null;
    if (rt.enemies.length > 90) return null;      // frame-time ceiling
    const a = rt.archer;
    // 640–1160px out, from any position on the map — see ringSpawn. A corner used
    // to collapse this ring onto the pilot and hand out free kills/second.
    const p = ringSpawn(a.x, a.y, 640, 1160, 24);
    const e = new E.Enemy(pickType(), state.currentDungeon, p.x, p.y);
    kothScale(e);
    pushEnemy(e);
    return e;
  }
  // SAFE HANGAR — tow the pilot somewhere nothing can shoot them: clear every
  // hostile, full heal + 6s invulnerability, and open the Hangar screen.
  // Used after every event exit (retreat / timer / death) and every shipwreck.
  function goSafeHangar() {
    try {
      rt._pendShield = null;   // retreating before first blood leaves the tile unshielded
      rt.siege = null; rt.waves = null;
      rt.enemies = []; rt.boss = null; rt.bossAlive = false; rt.superBossAlive = false;
      rt.awaitingRespawn = false;
      rt.archer.dead = false; rt.archer.killer = null;
      rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 6;
    } catch (e) {}
    const nav = document.querySelector('.nav-btn[data-screen="hero"]');
    if (nav) nav.click();
    else if (window.UI && window.UI.showScreen) { try { window.UI.showScreen('hero'); } catch (e) {} }
    if (window.UI) window.UI.refreshAll();
  }
  // HOLLOW ARMADA deploy — the alliance raid boss on the REAL battle engine,
  // exactly the Voidmaw treatment: clean arena, one huge boss, the module
  // (window.ALBOSS) owns timer/zones/damage-transmit.
  let _armImg = null;
  function armadaImg() { if (!_armImg) { _armImg = new Image(); _armImg.src = 'ships/ship-monolith4.png'; } return _armImg; }
  function startAllianceRaid(markN, poolHp) {
    const zone = Math.max(1, Math.min(C.zoneCap ? C.zoneCap(9999) : 999, state.level));
    state.currentDungeon = zone;
    state.currentSystem = null;
    reachZone(zone);
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; rt.siege = null; rt.waves = null;
    resetZone();
    rt.siege = null; rt.waves = null;
    sweepLoot();
    rt.nodes = []; rt.enemies = []; rt.ground = [];
    rt.bossInit = rt.bossTimer = 1e9;
    rt.sdrun = null; rt.hcrun = null; rt.cgrun = null;   // one event at a time — module watchdogs settle any live run
    rt.alrun = { active: true, started: Date.now() };
    const pool = allowedEnemies();
    const cx = rt.worldW / 2, cy = rt.worldH * 0.24;
    const b = new E.Enemy(pool[pool.length - 1], state.currentDungeon, cx, cy);
    b.isBoss = true; b.isSuper = true; b.isAlArmada = true;
    // THE ARENA HULL *IS* THE SHARED POOL (Aug 2026). It used to be "an hour of
    // your DPS" with the real pool tracked separately and the bar topped back
    // up — so what you shot at had no relationship to what you were killing.
    // Now the boss carries the mark's REAL remaining HP: your raw hits are the
    // damage, dropping it to 0 kills the mark, and the run ends there.
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    b.maxHp = b.hp = Math.max(1, Math.round(Number(poolHp) || Math.max(1e9, dps * 3600)));
    b.speed *= 0.4; b.size = 132;
    b.ranged = true; b.range = 600; b.fireCd = Math.max(0.8, 1.5 - 0.03 * (markN | 0)); b.fireT = 1.6;
    b.tint = '#2ee6c9';
    b.spriteImg = armadaImg();
    b.name = 'HOLLOW ARMADA · Mk-' + Math.max(1, markN | 0);
    if (pushEnemy(b)) { rt.boss = b; rt.bossAlive = true; rt.superBossAlive = true; }
    burst(cx, cy, '#2ee6c9', 110, { speed: 380, life: 1.3, glow: true });
    if (window.UI) window.UI.bossEvent('super');
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 3;
    if (window.UI) window.UI.refreshAll(); save();
    return b;
  }
  // HOME CITADEL deploy — wave defense on the REAL battle engine in the pilot's
  // deepest zone (the Home Zone). Clean arena; window.HOMECIT.engineTick owns
  // spawns, the fort objective, win/lose and rewards.
  function startHomeDefense() {
    const zone = Math.max(1, Math.min(state.highestUnlocked || 1, Math.max(1, state.level)));
    state.currentDungeon = zone;
    state.currentSystem = null;
    reachZone(zone);
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; rt.siege = null; rt.waves = null; rt.sdrun = null;
    resetZone();
    // resetZone re-arms siege/wave machinery on citadel-siege zones — the event
    // owns this arena, so strip it AGAIN after the rebuild (wave-7 citadel bug).
    rt.siege = null; rt.waves = null;
    sweepLoot();
    rt.nodes = []; rt.enemies = []; rt.ground = [];
    rt.bossInit = rt.bossTimer = 1e9;
    rt.hcrun = { active: true, zone, started: Date.now() };
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 3;
    rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH * 0.55;   // between fort and the approach lanes
    if (window.UI) window.UI.refreshAll(); save();
    return { zone, worldW: rt.worldW, worldH: rt.worldH };
  }
  // one zone-native raider for the Home Citadel defense (real art, real AI;
  // the module sets its wave-budget HP and aims it at the fort)
  function spawnHomeRaider(x, y) {
    if (!rt.hcrun) return null;
    const pool = allowedEnemies();
    // raiders only — never the zone's boss-grade top entry
    const type = pool[(Math.random() * Math.max(1, pool.length - 1)) | 0];
    const e = new E.Enemy(type, state.currentDungeon, x, y);
    e.isBoss = false; e.isCitadel = false;
    pushEnemy(e);
    return e;
  }
  function endHomeDefense() {
    rt.hcrun = null;
    respawnAt(Math.max(1, state.currentDungeon || 1));
  }
  // ===========================================================================
  // SPACE CARGO DEFENSE — deploy on the REAL battle engine
  // ---------------------------------------------------------------------------
  // Identical treatment to the Home Citadel defense: the pilot's deepest zone,
  // a clean arena, real stats, real hulls, real loot. window.CARGO owns the
  // cargo hull, the route, spawns, win/loss and the payout. This is the SAME
  // combat as the rest of the game — there is no separate simulation.
  // ===========================================================================
  function startCargoRun(opts) {
    const tier = Math.max(1, (opts && opts.tier) | 0 || 1);
    // THE INSTANCE IS OVER-LEVELLED ON PURPOSE. A cargo run is not the zone you
    // farm — it is deliberately deeper than anything you normally fly, and the
    // depth scales with the shipment: Cargo I sits ~13% past your ceiling, Omega
    // V lands roughly 65% deeper. Enemy HP, damage and loot all ride the zone
    // curve, so this raises the whole fight at once.
    // NOTE: reachZone() is deliberately NOT called — it would bank this depth as
    // highestDungeonReached and launder free unlock ceiling out of the event.
    // NO ZONE CEILING. This used to clamp at 999, which quietly capped the mobs a
    // deep pilot fights (and the pay and loot that ride the zone curve) while the
    // card still advertised the deeper figure. Zones are endless — the shipment
    // deploys wherever the pilot's own frontier puts it. Must stay identical to
    // cargo-defense.js deployZone(), which is what the card quotes.
    const base = Math.max(1, state.highestUnlocked || 1, state.level | 0);
    const zone = Math.max(1, Math.round(base * (1 + 0.10 * tier)) + tier * 6);
    state.currentDungeon = zone;
    state.currentSystem = null;
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; rt.siege = null; rt.waves = null; rt.sdrun = null; rt.alrun = null; rt.hcrun = null;
    resetZone();
    // resetZone re-arms siege/wave machinery on citadel zones — the event owns
    // this arena, so strip it again after the rebuild.
    rt.siege = null; rt.waves = null;
    sweepLoot();
    rt.nodes = []; rt.enemies = []; rt.ground = [];
    rt.bossInit = rt.bossTimer = 1e9;   // no zone boss — the module spawns the assault
    rt.cgrun = { active: true, zone, tier, started: Date.now() };
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 3;
    rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH * 0.72;
    if (window.UI) window.UI.refreshAll(); save();
    return { zone, worldW: rt.worldW, worldH: rt.worldH };
  }
  // one zone-native hostile for the escort — real art, real AI, real drops.
  // `toCargo` hands it the cargo proxy as its raid target so it besieges the
  // freighter instead of the pilot (same mechanism the fort defense uses).
  function spawnCargoRaider(x, y, opts) {
    if (!rt.cgrun) return null;
    const pool = allowedEnemies();
    const o = opts || {};
    const type = o.boss ? pool[pool.length - 1] : pool[(Math.random() * Math.max(1, pool.length - (o.elite ? 1 : 2)) + (o.elite ? 1 : 0)) | 0];
    const e = new E.Enemy(type, state.currentDungeon, x, y);
    e.isBoss = !!o.boss; e.isCitadel = false;
    if (o.hpMult) { e.maxHp = e.hp = Math.max(1, e.maxHp * o.hpMult); }
    if (o.raidTarget) { e.raidTarget = o.raidTarget; e.isRaider = true; }
    e.cgRole = o.role || 'fighter';
    pushEnemy(e);
    return e;
  }
  function endCargoRun() {
    rt.cgrun = null;
    respawnAt(Math.max(1, state.currentDungeon || 1));
  }
  // ---- HULL UPGRADE FORFEIT ------------------------------------------------
  // Dying on an escort run does NOT take the ship. It takes everything the
  // SHIPYARD built into it: the flagship's hull upgrade levels are stripped back
  // to stock (Lv 1). The hull itself, its Ship Ascension, and every fitted item
  // stay exactly where they are — you keep flying the same ship, rebuilt from
  // nothing.
  function stripHullUpgrades() {
    const key = state.ship, sh = C.SHIP_BY_KEY[key];
    if (!sh) return null;
    if (!state.shipLevels) state.shipLevels = {};
    const had = Math.max(1, state.shipLevels[key] | 0 || 1);
    if (had <= 1) return { ship: sh.name, key, levels: 0, wasLevel: 1 };
    state.shipLevels[key] = 1;
    refreshStats(); save();
    if (window.UI) window.UI.refreshAll();
    return { ship: sh.name, key, levels: had - 1, wasLevel: had };
  }
  function respawnAt(d) {
    if (d > state.highestUnlocked) d = state.highestUnlocked;
    state.currentDungeon = d;
    reachZone(d);
    rt.awaitingRespawn = false;
    rt.archer.dead = false; rt.archer.killer = null;
    rt.waves = null; rt.sdrun = null; rt.hcrun = null; rt.cgrun = null; rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null;
    resetZone();
    // generous safety on redeploy: 4s invulnerability + a spawn grace window so
    // the player is never instantly swarmed after choosing a zone.
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    if (d >= 1) armAuto();          // a redeploy is a zone entry — autopilot on
    { const swarm = isSwarmZone(state.currentDungeon) && !state.currentSystem;
      rt.nodes.forEach((n, i) => { n.respawnT = swarm ? 1.5 + i * 0.07 : 2.2 + i * 0.45; }); }
    if (window.UI) window.UI.refreshAll(); save();
  }
  function resetZone() {
    rt.dmgShow = 1;   // never let an event's display scale survive into normal play
    // EVERY DEPLOY ENDS A KING OF THE HILL RUN. Cleared here rather than at the
    // seven separate call sites that null the other event runs: resetZone() is
    // the one thing all of them go through, including goSafeHangar(). startKoth
    // arms rt.kothrun AFTER calling this, so it is unaffected.
    rt.kothrun = null;
    state.prismRun = null;   // any (re)deploy ends a Prism Field run
    state.prismFleetRun = null;   // ...and a Prism Fleet gauntlet run
    sweepLoot();
    rt.enemies = []; rt.projectiles = []; rt.ground = []; rt.ebolts = []; rt.towT = 0;
    // ✦ the lance recharges from scratch in a new zone, and no fracture follows you
    rt.fractures = []; rt.lanceT = 0; rt.lanceAim = null; rt.lanceFlash = 0;
    // CINEMATIC: hyperspace warp-in streaks on every combat deploy
    if (state.currentDungeon >= 1) rt.warpT = 0.85;
    // re-fit world size + zoom for this zone (wider & more zoomed-out deeper in)
    fitWorld(state.currentDungeon);
    rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH / 2;
    if (rt.siege && rt.siege.active) {
      // SIEGE: no fixed nodes / no boss meter — waves are spawned by updateSiege
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.siege.spawnT = 1.0; rt.siege.wave = 1; rt.siege.bossSpawned = false; rt.siege.pendingBoss = false;
      rt.waves = null;
    } else if (state.dreadRun && state.dreadRun.active) {
      // DREADNAUGHT HUNT — 30 escalating waves on the REAL battle engine, then the
      // Dreadnaught raid boss. Driven by updateWaveZone (dread:true).
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves = { active: true, total: 30, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, dread: true, tier: state.dreadRun.tier };
    } else if (state.mechRun && state.mechRun.active) {
      // THE MECH FOUNDRY — a wave gauntlet of Mech hostiles into that tier's boss.
      // Structurally identical to the hunt above; `mech` routes the spawner and the
      // boss branch in updateWaveZone.
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves = { active: true, total: state.mechRun.waves || 12, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, mech: true, tier: state.mechRun.tier };
    } else if (rt.waves && rt.waves.active) {
      // pre-configured gauntlet (owned Boss Tile) — keep its config, (re)start it
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves.wave = 1; rt.waves.bossSpawned = false; rt.waves.pendingBoss = false; rt.waves.super = false; rt.waves.spawnT = rt.waves.spawnT || 1.2;
    } else if (!state.currentSystem && isWaveZone(state.currentDungeon)) {
      // WAVE ZONE: 25 escalating waves of extreme density → boss → repeat.
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves = { active: true, total: 25, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.2, super: false };
    } else if (!state.currentSystem && isCitadelZone(state.currentDungeon)) {
      // CITADEL SIEGE: fight from the bottom of the zone UP through 8 garrison
      // waves, then destroy the citadel. One run per 15 min per zone.
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves = { active: true, total: 8, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, citadel: true };
      if (rt.archer) { rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH * 0.82; }
    } else {
      rt.waves = null;
      buildNodes();
      // stagger initial spawns (swarm zones flood in fast)
      { const swarm = isSwarmZone(state.currentDungeon) && !state.currentSystem;
        rt.nodes.forEach((n, i) => { n.respawnT = swarm ? 0.3 + i * 0.06 : 0.2 + i * 0.25; }); }
      // boss meter: 10–15 min to first boss; min 5 min between bosses
      rt.bossInit = rt.bossTimer = 600 + Math.random() * 300;
      // EMBER CHOIR — a Choir-claimed zone brings its boss forward hard. The event
      // IS the ending encounter, and a 10–15 minute wait on a zone you travelled to
      // specifically would read as the event being broken. ~2–3 minutes: long enough
      // to still be a boss meter, short enough that arriving feels like arriving.
      if (!state.currentSystem && isEmberZone(state.currentDungeon)) {
        rt.bossInit = rt.bossTimer = 120 + Math.random() * 60;
      }
      rt.bossAlive = false; rt.boss = null; rt.lastBoss = rt.time - 600;
    }
    burst(rt.archer.x, rt.archer.y, '#e6b566', 18, { speed: 200, life: 0.6 });
  }

  // ==========================================================================
  // GALAXY MAP — warp between systems, capture via 10-wave sieges, own systems
  // for per-hour resources. Difficulty scales with ring distance from home.
  // ==========================================================================
  // ==========================================================================
  // VOID ZONE — 10 apex turf-war tiles beyond the rim (Command ▸ Void Zone).
  // Same conquest pipeline as My Galaxy (sysAt/warp/claims/clone sieges):
  // STRICT level gates (25/50/100/200/300/400/500) · 1000× entry toll · 100× yield
  // (rate rides the global ×25 galaxy multiplier) · capturing GRANTS the fixed
  // citadel (no builds/upgrades) · 24h attack shield as everywhere.
  // ==========================================================================
  const VOID_TILES = (() => {
    const req = [25, 50, 100, 200, 300, 400, 500];
    const nm = ['Umbral Gate', 'Null Bastion', 'Hollow Throne', 'Wraith Spire', 'Abyss Crown', 'Night Forge', 'The Singularity'];
    const res = ['fuel', 'iron', 'plasma'];
    const out = {};
    req.forEach((rq, i) => {
      out['VZ' + (i + 1)] = { id: 'VZ' + (i + 1), void: true, vtier: rq, ring: 24, level: rq, diff: Math.round(rq * 1.5),   // 1.5× difficulty: void garrisons fight above the gate level
        name: nm[i], resource: res[i % 3], rate: 40000 * rq, home: false, boss: false, citadel: false, deep: false };   // ×25 global yield → Lv100 ≈ 100M/hr per resource
    });
    return out;
  })();
  // ==========================================================================
  // THE HOUSE CITADELS — three casino holds, fought over exactly like Void spires.
  //
  // These are REAL TILES, not a bespoke ownership flag. They are marked
  // `void: true` deliberately so they inherit the entire proven siege loop with no
  // duplicated logic: strict level gate, resource entry toll, a Warden clone fleet
  // that must actually be beaten, the scaled wave count, capture-on-win via
  // plainTake, the 24-hour attack shield, abandonment, and territory sync (so the
  // server sees the holder and the daily payout can pay them).
  //
  // `casino: true` is the only extra: it marks which share of the house's daily
  // losses the hold pays (1% / 2% / 3%) and keeps them out of the Void Zone board.
  //
  // They pay NO hourly resource income — rate 0. The reward is the house cut, and
  // giving them a second income stream on top would make them strictly better than
  // a Void spire at the same level.
  // ==========================================================================
  const CASINO_TILES = (() => {
    const spec = [
      { id: 'CC1', lv: 100, share: 1, name: 'The Blackjack Hold' },
      { id: 'CC2', lv: 300, share: 2, name: 'The Roulette Spire' },
      { id: 'CC3', lv: 500, share: 3, name: 'The Craps Bastion' },
    ];
    const out = {};
    spec.forEach((s) => {
      out[s.id] = { id: s.id, void: true, casino: true, casinoShare: s.share,
        vtier: s.lv, ring: 25, level: s.lv, diff: Math.round(s.lv * 1.5),
        name: s.name, resource: 'plasma', rate: 0,
        home: false, boss: false, citadel: false, deep: false };
    });
    return out;
  })();
  const CASINO_IDS = Object.keys(CASINO_TILES);
  const casinoShareOf = (k) => ((CASINO_TILES[k] || {}).casinoShare || 0);
  // Ownership of a hold, read from the ONE authority every other tile uses.
  function casinoHolds() {
    return CASINO_IDS.map((k) => {
      const t = CASINO_TILES[k];
      return { id: k, name: t.name, share: t.casinoShare, req_lv: t.vtier,
               mine: isOwned(k), rival: rivalOf(k) || null,
               shield_left: tileCooldownLeft(k) | 0 };
    });
  }
  const VOID_ENTRY = (t) => { const m = 1000 * (t.vtier / 200); return { fuel: Math.ceil(40 * m), iron: Math.ceil(25 * m), plasma: Math.ceil(15 * m) }; };
  // VOID ZONE battle dressing — attacking mobs wear REAL hull sprites, and the
  // tile's citadel looms at world center (pure set dressing, not an entity).
  const VOID_MOB_KEYS = ['interceptor', 'cruiser', 'heavycruiser', 'destroyer', 'battleship', 'dreadnought', 'carrier'];
  const _vzMobImgs = {};
  function voidSkin(e) {
    if (!state.currentSystem) return;
    const t = sysAt(state.currentSystem); if (!t || !t.void) return;
    const k = VOID_MOB_KEYS[(Math.random() * VOID_MOB_KEYS.length) | 0];
    if (!_vzMobImgs[k]) { _vzMobImgs[k] = new Image(); _vzMobImgs[k].src = 'ships/ship-' + k + '.png'; }
    e.spriteImg = _vzMobImgs[k]; e.tint = '#b04dff';
  }
  const VOID_ART = { 25: 'void-cit-1', 50: 'void-cit-1', 100: 'void-cit-2', 200: 'void-cit-2', 300: 'void-cit-3', 400: 'void-cit-3', 500: 'void-cit-4' };
  function drawVoidArena(ctx) {
    const t = state.currentSystem ? sysAt(state.currentSystem) : null; if (!t || !t.void) return;
    const art = VOID_ART[t.vtier] || 'void-cit-4';
    if (!_vzArenaImg || _vzArenaImg._art !== art) { _vzArenaImg = new Image(); _vzArenaImg.src = 'ships/' + art + '.png'; _vzArenaImg._art = art; }
    const cx = rt.worldW / 2, cy = rt.worldH * 0.36;
    // deep-space veil + drifting stars
    ctx.fillStyle = 'rgba(5,3,14,0.45)';
    ctx.fillRect(-60, -60, rt.worldW + 120, rt.worldH + 120);
    ctx.fillStyle = 'rgba(210,220,255,0.55)';
    for (let i = 0; i < 42; i++) {
      const sx = (i * 977 + rt.time * 6 * ((i % 3) + 1)) % rt.worldW, sy = (i * 613) % rt.worldH;
      ctx.globalAlpha = 0.15 + 0.45 * Math.abs(Math.sin(i * 3.1 + rt.time * 0.5));
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
    // event horizon + accretion glow
    const g1 = ctx.createRadialGradient(cx, cy, 36, cx, cy, 430);
    g1.addColorStop(0, 'rgba(0,0,0,0.88)');
    g1.addColorStop(0.34, 'rgba(80,30,140,0.30)');
    g1.addColorStop(0.7, 'rgba(176,77,255,0.12)');
    g1.addColorStop(1, 'rgba(176,77,255,0)');
    ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(cx, cy, 430, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a0 = rt.time * 0.35 + i * 2.1;
      ctx.strokeStyle = 'rgba(176,77,255,' + (0.16 + i * 0.05).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, 150 + i * 62, a0, a0 + 2.1); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // the tile's citadel looms at the heart of the fight — art only
    if (_vzArenaImg.complete && _vzArenaImg.naturalWidth) {
      const h = 300, w = h * (_vzArenaImg.naturalWidth / _vzArenaImg.naturalHeight);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(_vzArenaImg, cx - w / 2, cy - h / 2 + Math.sin(rt.time * 0.8) * 6, w, h);
      ctx.globalAlpha = 1;
    }
  }
  function sysAt(k) { return VOID_TILES[k] || CASINO_TILES[k] || GX.tileAt(k); }
  // AM I STANDING ON A VOID TILE? Void spires (and the casino House Citadels,
  // which are `void: true` tiles) deploy you at `level requirement × 1.5` — the
  // Lv 500 Singularity is ZONE 750. Every reward priced off the zone number is
  // therefore priced far above what the pilot earned. Gold, loot and resources
  // are the intended prize and keep it; XP does not (see onKill / computeOffline).
  // Particle / debris ceilings ride the graphics tier. Cosmetic only — nothing
  // here is simulated, so shedding them costs the player no combat and no time.
  function _partScale() { try { return window.PERF ? window.PERF.partScale() : 1; } catch (e) { return 1; } }
  function inVoidSystem() {
    try { if (!state.currentSystem) return false; const t = sysAt(state.currentSystem); return !!(t && t.void); } catch (err) { return false; }
  }

  // ---- WHERE FITTINGS DO NOT DROP ------------------------------------------
  // ONE STATEMENT OF THE RULE, asked by every path that generates a fitting.
  //
  // Three instances deploy the pilot into a zone priced ABOVE their own frontier,
  // so anything generated at `state.currentDungeon` inside them is gear the pilot
  // never earned the ground for:
  //   · CARGO RUN  — deployZone is depthBase × (1 + 0.10 × tier) + tier × 6, i.e.
  //                  Omega V lands ~50% deeper than the pilot's own frontier
  //   · VOID TILE  — level requirement × 1.5 (casino House Citadels included)
  //   · KOTH ARENA — a fixed Level 200 arena, and a kill race besides
  // Gold, salvage, Dread Cores and event currency are the prize in all three and
  // are untouched. Fittings are not. NOTE this is NOT the XP carve-out list: the
  // Dreadnaught Hunt and Home Citadel defence withhold levels and keep their
  // loot, which is deliberate. Two different rules, two different lists.
  //
  // It is ONE function because it used to be four hand-copied `!_cargoRun &&
  // !_voidRun` clauses, and they had already drifted apart: the normal kill drop
  // tested all three instances, the Fracture Zone drop tested two, and bossLoot()
  // and citadelDown() tested only inVoidSystem(). So a cargo run's five sector
  // bosses each paid out a full 5–12 fitting boss shower rolled on the INFLATED
  // zone — the reported "cargo runs drop loot" loophole, and the reason a pilot
  // could carry Lv 1000 gear. A new drop path asks this, or it leaks the same way.
  function lootBlocked() {
    if (inVoidSystem()) return true;
    if (rt.cgrun && rt.cgrun.active) return true;
    if (rt.kothrun && rt.kothrun.active) return true;
    return false;
  }
  // ---- THE MECH FACTION -----------------------------------------------------
  // Mech hostiles are drawn from C.MECHS, which is deliberately NOT C.ENEMIES:
  // allowedEnemies() filters that array by minDungeon and the zone board prints
  // from the same filter, so a Mech in there would join the normal rotation of
  // every deep zone and rewrite the zone list as a side effect. Nothing reads
  // C.MECHS except this spawner.
  //
  // NOTE the Foundry is in the XP carve-out but NOT in lootBlocked() above. That
  // is the same split the Dreadnaught Hunt sits on and it is deliberate: the hunt
  // and the Foundry withhold LEVELS and keep their loot. Two rules, two lists.
  const _mechImgs = {};
  function mechSkin(e) {
    const k = e.type && e.type.key; if (!k) return;
    e.mechKey = e.type.mech || k;               // the corruption class it applies
    let im = _mechImgs[k];
    if (!im) { im = new Image(); im.src = 'ships/mech-' + k + '.png'; _mechImgs[k] = im; }
    e.spriteImg = im;                            // hero-sprite path in drawEnemy
  }
  // A tier is mostly its OWN class with lighter Mechs filling in beneath it, so a
  // Titan Forge reads as a Titan encounter rather than an even spread of five.
  function pickMechType(tier) {
    const list = C.MECHS || [];
    const n = Math.max(1, Math.min(list.length, tier | 0));
    const i = Math.min(n - 1, Math.floor(Math.pow(Math.random(), 2) * n));
    return list[n - 1 - i];
  }
  // The tier boss — that class at fortress scale. HP is clamped against the
  // pilot's own DPS exactly the way spawnCitadel does it, so a deep fleet does
  // not face a ten-minute wall, and never below the zone curve so a thin fleet
  // cannot trivialise it.
  function spawnMechBoss(tier) {
    const list = C.MECHS || [];
    const type = list[Math.min(list.length, Math.max(1, tier | 0)) - 1] || list[0];
    if (!type) return null;
    const b = new E.Enemy(type, state.currentDungeon, rt.worldW / 2, rt.worldH * 0.22);
    b.isBoss = true;
    b.name = String(type.name || 'MECH').toUpperCase();
    mechSkin(b);
    b.maxHp *= 40 + tier * 12; b.hp = b.maxHp;
    {
      const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
      const curve = C.enemyHp(state.currentDungeon) * type.hpMod * (40 + tier * 12);
      b.maxHp = b.hp = Math.round(Math.max(curve, Math.min(b.maxHp, dps * 50)));
    }
    b.size *= 2.1; b.damage *= 1.45;
    b.ranged = true; b.range = 360; b.fireCd = 2.2; b.fireT = 1.2;
    pushEnemy(b);
    burst(b.x, b.y, '#ff4d5e', 54, { speed: 300, life: 1.0, glow: true });
    return b;
  }
  // NAME → TILE ID. War reports written before tile ids were recorded only carry
  // the system NAME, and the ◎ jump-to-map button needs an id. Names are
  // generated deterministically from each coordinate, so the whole galaxy can be
  // walked once and cached (≈1,900 tiles + the Void spires and House holds).
  // Built lazily — nothing pays for it unless an old report is opened.
  let _nameIdx = null;
  function tileIdByName(name) {
    if (!name) return null;
    if (!_nameIdx) {
      _nameIdx = {};
      const put = (id, nm) => { if (nm && !_nameIdx[String(nm).toLowerCase()]) _nameIdx[String(nm).toLowerCase()] = id; };
      try {
        Object.keys(VOID_TILES).forEach((k) => put(k, VOID_TILES[k].name));
        Object.keys(CASINO_TILES).forEach((k) => put(k, CASINO_TILES[k].name));
        for (let ring = 0; ring <= (GX.RINGS || 25); ring++) {
          GX.ringCoords(ring).forEach((c) => {
            const id = GX.tileId(c.q, c.r);
            const t = GX.tileAt(id);
            if (t && t.name) put(id, t.name);
          });
        }
      } catch (e) {}
    }
    return _nameIdx[String(name).toLowerCase()] || null;
  }
  // ==========================================================================
  // THE KAEVITH INCURSION — the alien-held ~20% of My Galaxy (GX.isInvaded).
  // Invaded tiles keep the normal conquest pipeline (ownership, citadels,
  // cooldowns, claims all unchanged). What changes is who defends them: every
  // hostile in the zone flies a Kaevith hull and hits slightly harder than the
  // ring's usual garrison — and clearing the zone can drop alien technology.
  // ==========================================================================
  const XEN_MOB_KEYS = ['xen1', 'xen2', 'xen3', 'xen4', 'xen5'];
  const _xenMobImgs = {};
  // Is the tile the pilot is fighting in alien-held? (Void spires are never invaded.)
  function inXenZone() {
    if (!state.currentSystem) return false;
    const t = sysAt(state.currentSystem);
    return !!(t && t.alien && !t.void && !t.home);
  }
  // Skin + stat pass for one hostile in an invaded zone. Bigger hulls appear as
  // the ring deepens, so a rim incursion looks like a rim incursion.
  function xenSkin(e, boss) {
    if (!inXenZone()) return false;
    const t = sysAt(state.currentSystem);
    const frac = Math.min(1, Math.max(0, (t.ring - 1) / Math.max(1, (GX.RINGS || 25) - 1)));
    const top = Math.min(5, 2 + Math.round(frac * 3));                 // ring 1 → xen1..2 · rim → xen1..5
    const k = boss ? XEN_MOB_KEYS[top - 1] : XEN_MOB_KEYS[(Math.random() * top) | 0];
    if (!_xenMobImgs[k]) { _xenMobImgs[k] = new Image(); _xenMobImgs[k].src = 'ships/ship-' + k + '.png'; }
    e.spriteImg = _xenMobImgs[k];
    e.tint = GX.XEN.color;
    e.xen = true;
    e.maxHp = Math.round(e.maxHp * GX.XEN.hpMod); e.hp = e.maxHp;
    e.damage *= GX.XEN.dmgMod;
    return true;
  }
  // RESONANCE FIELD — every Kaevith hull in the fleet (flagship OR escort) lifts
  // XP per kill for the WHOLE fleet. Bonuses add; there is no local ceiling.
  function xenXpBonus() {
    const keys = [state.ship].concat((state.fleet || []).filter(Boolean));
    const seen = {};
    let pct = 0;
    keys.forEach((k) => {
      if (!k || seen[k] || !(state.ownedShips && state.ownedShips[k])) return;
      seen[k] = 1;
      const sh = C.SHIP_BY_KEY[k];
      if (sh && sh.xpBonus) pct += sh.xpBonus;
    });
    // No local ceiling. This used to clip at +100%, which meant a pilot holding
    // all five hulls threw away most of what they earned (the roster sums to
    // +160%: 8 + 16 + 28 + 44 + 64). The only XP ceiling now is the combined
    // fleet cap in xpFleetInfo.
    return pct;
  }
  function xenXpMult() { return 1 + xenXpBonus() / 100; }
  // Chance to earn alien ship technology on clearing an invaded zone: 1% on
  // ring 1 → 10% at the rim. Deeper rings weight the roll toward bigger hulls.
  // ALWAYS returns a result for an invaded tile ({won:false} on a miss) so the
  // end-of-battle popup can tell the player either way. ("Salvage" is already
  // this game's word for scrapping items into resources — kept distinct.)
  //
  // NO PITY FLOOR, BUT NO DEAD DROUGHT EITHER. Nothing forces a win; instead every
  // invaded clear that misses lifts the next roll's odds (see xenChanceNow), so
  // the guarantee that once made Kaevith hulls feel common is gone while a long
  // dry run still converges on a hull.
  // A pilot clearing invaded tiles at the rim was capped at 25 misses, so the true
  // rate was never the advertised one — it was one hull every 25 clears, floor and
  // ceiling both. The roll is now exactly what the tooltip says it is.
  //
  // `dry` still rides along on the result object; nothing renders it.
  // ==========================================================================
  // THE EMBER CHOIR — the ZONE GRIND incursion (sister event to the Kaevith
  // Incursion in My Galaxy).
  //
  // THE HOOK: the Choir hunt by SIGNAL. They are obsidian husks lit from within
  // by a molten core, and they migrate toward noise — which is why their
  // technology, bolted into your fleet, supercharges the one thing you fire to
  // make noise on purpose: the ◉ BEACON. The faction that hunts signals hands you
  // better signals. That is the whole loop, and it is deliberately a different
  // axis from Kaevith (which pays XP): Kaevith makes levelling faster, the Choir
  // makes FARMING faster.
  //
  // WHERE: roughly ONE ZONE IN THIRTY is Choir-claimed. Deterministic per zone
  // number (hashed, not `% 30`, so it scatters instead of landing on a tidy
  // multiple and colliding with the wave-zone cadence every 330). Stable for
  // everyone, forever — the same zones are Choir zones on every account, so the
  // knowledge is shareable, exactly like the Kaevith map.
  //
  // WHAT CHANGES: only the ENCOUNTER THAT ENDS THE ZONE. In a plain zone that is
  // the roaming boss; in a wave zone it is the boss after the final wave. Nothing
  // else about the zone moves — density, loot quality, respawn and level gates are
  // untouched. Citadel sieges are excluded: their finale is razing the fortress,
  // and replacing that would break the objective.
  //
  // THE PRIZE: killing a Choir hull carries a small chance to recover it. Five
  // hulls, entry → Dreadnaught, each a bigger beacon bonus than the last.
  // ==========================================================================
  const EMB_KEYS = ['emb1', 'emb2', 'emb3', 'emb4', 'emb5'];
  const EMB_MIN_ZONE = 10;      // below this the swap is just an unexplained wall
  const EMB_RATE = 30;          // ~1 zone in 30
  const _embImgs = {};
  // Deterministic zone hash. Same input → same answer on every device, no state.
  function embHash(z) {
    let h = ((z | 0) + 0x9e37) * 0x85ebca6b;
    h ^= h >>> 13; h = (h * 0xc2b2ae35) | 0; h ^= h >>> 16;
    return (h < 0 ? -h : h);
  }
  // DROUGHT-BREAKER (Aug 2026). The raw hash left droughts of 50\u201380 zones with no
  // Choir (58\u2192141 was the reported one). The natural picks all stay, and after
  // EMB_RATE zones without one, the next eligible zone sings too \u2014 deterministic,
  // memoized, identical for every account. Max gap is now \u226430ish; realised rate
  // ~1-in-20 across 1200 zones.
  const _embZones = [];
  function _embBuild(upto) {
    let z = _embZones.length ? _embZones[_embZones.length - 1] + 1 : EMB_MIN_ZONE;
    upto = Math.min(upto, 100000);
    for (; z <= upto; z++) {
      if (isCitadelZone && isCitadelZone(z)) continue;
      const last = _embZones.length ? _embZones[_embZones.length - 1] : EMB_MIN_ZONE - 1;
      if (embHash(z) % EMB_RATE === 0 || z - last >= EMB_RATE) _embZones.push(z);
    }
  }
  function isEmberZone(z) {
    const d = z | 0;
    if (d < EMB_MIN_ZONE) return false;
    if (isCitadelZone && isCitadelZone(d)) return false;   // don't clobber a siege objective
    _embBuild(d);
    return _embZones.indexOf(d) !== -1;
  }
  // Which Choir hull garrisons a given zone: deeper zones field bigger ones.
  // Anchored to the zone (not random) so the tooltip can name it before you go.
  function emberTierFor(z) {
    const d = z | 0;
    const t = d >= 400 ? 5 : d >= 250 ? 4 : d >= 120 ? 3 : d >= 50 ? 2 : 1;
    return Math.max(1, Math.min(5, t));
  }
  // Chance to recover the hull on killing the zone's Choir boss.
  //
  // THE BETTER THE HULL, THE RARER THE ROLL. This used to be a function of raw
  // DEPTH — 0.9% climbing to a 5% cap — while emberTierFor() also climbs with
  // depth, so the deepest zones handed out the best hull at the best odds and the
  // Choirmaster was the EASIEST of the five to recover. Exactly backwards: the
  // ladder's reward went up and its cost went down at the same time.
  //
  // The roll is now a property of the TIER, and it falls as the tier rises. A
  // Mote at 5% is common enough to teach what the beacon bonuses do; Vhorn at
  // 0.5% is a genuine chase. Depth still decides WHICH hull you can find — it no
  // longer also decides how generously.
  const EMB_TIER_CHANCE = [0.050, 0.030, 0.018, 0.010, 0.005];
  function emberChance(z) {
    return EMB_TIER_CHANCE[emberTierFor(z) - 1] || 0.005;
  }
  function isEmberBossPending() {
    if (state.currentSystem) return false;                 // Zone Grind only
    // PRISM MINING IS NOT THE CHOIR'S GROUND. A prism run borrows the Zone Grind
    // arena and its enemy stream, so a Choir-claimed zone was reskinning the
    // field boss mid-dig — the event firing inside a mode it was never meant to
    // reach. The Choir belongs to zone grinding proper; while a prism run is
    // live the zone fields its ordinary garrison.
    try { if (state.prismRun && state.prismRun.active) return false; } catch (e) {}
    return isEmberZone(state.currentDungeon);
  }
  // Reskin + harden a boss into its Choir hull. Mirrors xenSkin's contract.
  function emberSkin(e, boss) {
    if (!boss || !isEmberBossPending()) return false;
    const tier = emberTierFor(state.currentDungeon);
    const k = EMB_KEYS[tier - 1];
    if (!_embImgs[k]) { _embImgs[k] = new Image(); _embImgs[k].src = 'ships/ship-' + k + '.png'; }
    e.spriteImg = _embImgs[k];
    e.ember = true; e.emberTier = tier;
    e.tint = '#ffb347';
    // A named encounter should FEEL like one: tougher than the zone's own boss,
    // but nowhere near a Dreadnaught — it has to stay killable on the way past.
    e.maxHp *= 1.55; e.hp = e.maxHp;
    e.damage *= 1.28;
    e.size *= 1.12;
    return true;
  }
  // ---- BEACON RESONANCE — the Choir's actual reward ------------------------
  // Every Choir hull in the FLEET (flagship or escort) contributes. Bonuses add
  // across hulls, then clamp: the beacon already has hard floors downstream (a
  // 30s cooldown floor and a duration ceiling tied to the cooldown), and these
  // caps stop the stack from pinning both at once and leaving the beacon
  // permanently up — which would stop it being a decision at all.
  const EMB_CAP = { cdCut: 0.45, life: 1.5, size: 1.0, loot: 1.5 };
  function emberBeaconBonus() {
    const keys = [state.ship].concat((state.fleet || []).filter(Boolean));
    const seen = {};
    let cdCut = 0, life = 0, size = 0, loot = 0;
    keys.forEach((k) => {
      if (!k || seen[k] || !(state.ownedShips && state.ownedShips[k])) return;
      seen[k] = 1;
      const b = (C.SHIP_BY_KEY[k] || {}).beacon;
      if (!b) return;
      cdCut += b.cdCut || 0; life += b.life || 0; size += b.size || 0; loot += b.loot || 0;
    });
    return {
      cdCut: Math.min(EMB_CAP.cdCut, cdCut / 100),
      life: Math.min(EMB_CAP.life, life / 100),
      size: Math.min(EMB_CAP.size, size / 100),
      loot: Math.min(EMB_CAP.loot, loot / 100),
      raw: { cdCut, life, size, loot },
      capped: (cdCut / 100 > EMB_CAP.cdCut) || (life / 100 > EMB_CAP.life) || (size / 100 > EMB_CAP.size) || (loot / 100 > EMB_CAP.loot),
      hulls: Object.keys(seen).filter((k) => (C.SHIP_BY_KEY[k] || {}).beacon).length,
    };
  }
  // The roll, on killing a Choir boss. Always returns a result so the popup can
  // report either way — same contract as xenTechRoll.
  function emberTechRoll() {
    const zone = state.currentDungeon | 0;
    const tier = emberTierFor(zone), key = EMB_KEYS[tier - 1];
    const chance = emberChance(zone);
    const pct = Math.max(0.1, +(chance * 100).toFixed(1));
    // ALREADY YOURS — SAY NOTHING. This zone can only ever pay out one hull, and
    // you have it. Reporting a roll you cannot win on every single boss kill is
    // noise, so the result is null and no popup is built.
    if (state.ownedShips && state.ownedShips[key]) return null;
    if (Math.random() >= chance) return { won: false, pct, key, tier };
    if (!grantShip(key)) return { won: false, pct, key, tier };
    state.embFound = (state.embFound || 0) + 1;
    save();
    const sh = C.SHIP_BY_KEY[key];
    return { won: true, pct, key, tier, ship: sh, nth: state.embFound };
  }
  // WHICH hull the roll pays out. The first two are the common Kaevith chassis
  // and their rarity is unchanged; the top three are the prizes.
  //
  // Aug 2026 rebalance: Glaive 5× rarer and Godshard 10× rarer, measured as SHARE
  // OF A WINNING ROLL at the rim. Note that simply dividing the weights does NOT
  // achieve that — it shrinks the denominator too, so the common hulls absorb the
  // freed probability and the realised factor comes out at only ~3× or ~6×. These
  // values are solved for the intended share ratio instead.
  //
  // SOVEREIGN PASS (Aug 2026): xen4 is another 5× rarer again — rim share 3.52%
  // → 0.704%, solved the same way (weight 0.901 → 0.17509 so the OTHER four keep
  // their probability). That makes the Sovereign the rarest hull in the line,
  // below even the Godshard, which is the intent: it is the prize.
  //
  // Rim shares now: 45.18 / 48.56 / 4.70 / 0.704 / 0.855%.
  // Low rings land rarer still (Sovereign ~0.228% at ring 1), which is the right
  // direction — the rim is where you hunt.
  //
  // The OVERALL chance of any hull dropping is untouched — this only changes
  // WHICH hull you get. xenSplit() feeds the same numbers to the event tooltips
  // so the briefing can never drift from the table.
  // ---- DRY-STREAK ESCALATOR -------------------------------------------------
  // A flat 0.2%-per-clear roll (the Aug 2026 rarity pass) meant a pilot working
  // the inner rings could clear invaded zone after invaded zone for weeks and see
  // nothing — "the Kaevith ship chance has become way too rare". Rather than
  // lifting the base rate back to where hulls stopped reading as prizes, the
  // DROUGHT pays: every invaded clear that misses makes the next one better by
  // +40% of the base rate, capped at 12× (and 75% absolute). A win resets it.
  // ring 1: 0.8% → up to 9.6% · rim: 5% → up to 60%. state.xenDry already existed
  // as a debug counter; it is the escalator's memory now, and it survives saves.
  // xenChanceNow() is what the tile sheet prints, so the number shown is the
  // number rolled — the UI reads it through GAME, never GX.alienChance directly.
  const XEN_DRY_STEP = 0.4, XEN_DRY_CAP = 12;
  function xenChanceNow(ring) {
    const mult = Math.min(XEN_DRY_CAP, 1 + (state.xenDry || 0) * XEN_DRY_STEP);
    return Math.min(0.75, GX.alienChance(ring) * mult);
  }
  const XEN_BASE_W = [50, 25, 1.576, 0.17509, 0.169];
  // Per-hull share of a winning roll at a given ring, for the event tooltips.
  // Mirrors the pool build in xenTechRoll exactly — including which hulls are
  // already owned and therefore out of the pool.
  function xenSplit(ring) {
    const R = Math.max(1, ring || 1);
    const frac = Math.min(1, Math.max(0, (R - 1) / Math.max(1, (GX.RINGS || 25) - 1)));
    const rows = XEN_MOB_KEYS.map((k, i) => ({
      key: k, i,
      owned: !!(state.ownedShips && state.ownedShips[k]),
      w: XEN_BASE_W[i] * (1 + frac * i * 1.15),
    }));
    const live = rows.filter((r) => !r.owned);
    const tot = live.reduce((a, b) => a + b.w, 0) || 1;
    rows.forEach((r) => { r.share = r.owned ? 0 : r.w / tot; });
    return rows;
  }
  function xenTechRoll(tile) {
    if (!tile || !tile.alien || tile.void || tile.home) return null;
    const chance = xenChanceNow(tile.ring);
    // honest to 2dp — the old Math.max(1, round(pct)) floor reported "1%" on a tile
    // that actually pays 0.2%
    const pct = chance * 100 >= 1 ? Math.round(chance * 1000) / 10 : Math.round(chance * 10000) / 100;
    // THE SET IS COMPLETE — SAY NOTHING. Same rule as the Choir: with every
    // Kaevith hull in the hangar there is nothing left to roll for, so a clear
    // no longer interrupts with a result card.
    const have = XEN_MOB_KEYS.filter((k) => state.ownedShips && state.ownedShips[k]).length;
    if (have >= XEN_MOB_KEYS.length) return null;
    const dry = state.xenDry || 0;
    if (Math.random() >= chance) {
      state.xenDry = dry + 1; save();
      return { won: false, pct, dry: state.xenDry };
    }
    const frac = Math.min(1, Math.max(0, (tile.ring - 1) / Math.max(1, (GX.RINGS || 25) - 1)));
    const pool = [];
    XEN_MOB_KEYS.forEach((k, i) => {
      if (state.ownedShips && state.ownedShips[k]) return;
      pool.push({ k, w: XEN_BASE_W[i] * (1 + frac * i * 1.15) });
    });
    let roll = Math.random() * pool.reduce((a, b) => a + b.w, 0);
    const hit = pool.find((p) => (roll -= p.w) <= 0) || pool[pool.length - 1];
    if (!grantShip(hit.k)) { state.xenDry = dry + 1; save(); return { won: false, pct, dry: state.xenDry }; }
    state.xenDry = 0;
    const sh = C.SHIP_BY_KEY[hit.k];
    pushFeed('◈ ALIEN SHIP TECHNOLOGY EARNED — the ' + sh.name + ' is in your hangar');
    // Announce to the shared world. Server-side the call is whitelisted and
    // idempotent per (pilot, hull), so it can't be replayed into spam.
    try { if (window.TERRITORY && window.TERRITORY.enabled()) window.TERRITORY.logXenHull(hit.k, tile.id, tile.ring, false); } catch (e) {}
    save();
    // `pity` was read here and never declared — a ReferenceError on the ONE path
    // that matters. The hull was granted and saved a line earlier, so the ship
    // arrived silently while the caller's claim handling died with the throw:
    // winning the event looked like nothing happening. There is no pity FLOOR
    // (the escalator replaces it), so the flag is simply false.
    return { won: true, key: hit.k, ship: sh, pct, dry: 0, pity: false };
  }

  let _vzArenaImg = null;
  // OWNERSHIP IS SERVER-AUTHORITATIVE. `state.ownedSystems` is a local mirror;
  // when the shared map carries a row for this tile owned by SOMEONE ELSE, that
  // row wins and the stale local flag is dropped on the spot. Without this a
  // client that missed a sync kept believing it held a tile another player had
  // taken — the map drew it as "defending", offered Abandon, AND offered Attack
  // on the same system. Never trust the local flag alone.
  function isOwned(k) {
    if (!state.ownedSystems[k]) return false;
    const real = rt.realTiles && rt.realTiles[k];
    if (real && real.ownerId) {
      const my = realMyUid();
      if (my && real.ownerId !== my) {
        delete state.ownedSystems[k];
        if (state.citadels && state.citadels[k]) delete state.citadels[k];
        return false;
      }
    }
    return true;
  }
  const turfOn = () => !!(window.TERRITORY && window.TERRITORY.enabled());
  // GLOBAL NPC layer — when the shared turf war is live, simulated rivals are a
  // PURE FUNCTION of (tile, UTC day): every player sees the exact same NPC
  // holdings, which shift a little each day. Real claims always override.
  // THE RIVAL LAYER: STRONGHOLDS ON A BUDGET, PLUS A SCATTER WITH INFLUENCE.
  //
  // This used to hash EVERY TILE INDEPENDENTLY for both the hold roll and the
  // owner's name, which had two consequences that only became visible once the
  // siege shield shipped: neighbouring tiles were uncorrelated, and two tiles
  // that did land side by side almost always belonged to DIFFERENT rivals. The
  // odds of any rival holding a tile plus all six of its neighbours were about
  // (0.26/12)^6 — one in ten billion. No rival ever had a bloc, so no rival ever
  // had a sealed core, and the whole "break the shell to reach the core" half of
  // the rule was unreachable content. It also made the galaxy read as static
  // noise rather than as a map somebody was holding.
  //
  // A BUDGET, NOT A PROBABILITY — the same lesson the natural citadels taught.
  // The first fix rolled a per-district chance of being a stronghold, and with
  // only ~54 districts on the map that sample was tiny: measured density moved
  // 38% from one day's dice to another's, which is a balance change by accident.
  // Strongholds are now an EXACT LIST: a fixed count per ring band, each a hex
  // blob held by one empire. Deterministic, so the count of sealed cores is a
  // design number (48) rather than an outcome, and the scatter that fills the
  // rest of the map is normalised against it so TOTAL DENSITY PER RING IS
  // UNCHANGED. A pilot has the same neutral ground to claim as before; what
  // changed is the shape of what the rivals hold.
  //
  // Scattered tiles still take their owner from a coarse DISTRICT rather than
  // per tile, so even the thin ground reads as spheres of influence and two
  // adjacent held tiles usually belong to the same empire.
  //
  // Still a pure function of (tile, UTC day): identical on every client, no save
  // field, nothing stored.
  //
  // A TILE YOU OWN PUNCHES A REAL HOLE IN A STRONGHOLD. isOwned() is tested
  // first, so taking a tile inside an empire's blob breaks their wall exactly as
  // the rule promises — the shield is derived from ownership, never stamped.
  function fnvHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  const npcRingP = (ring) => 0.10 + Math.min(0.16, (ring / (GX.RINGS || 25)) * 0.14);
  // ---- strongholds: the exact list ----------------------------------------
  // Four bands, three blobs each. Radius 2 (19 tiles) seals its centre AND its
  // whole first ring — 7 protected cores; radius 1 (7 tiles) seals just the
  // middle. 6 × 7 + 6 × 1 = 48 sealed cores, every day, by construction.
  const NPC_SH_BANDS = 4, NPC_SH_PER_BAND = 3;
  let _npcDay = -1, _npcSH = null, _npcScatter = 1, _npcDistCache = {};
  function npcLayer() {
    const day = Math.floor(Date.now() / 864e5);
    if (day === _npcDay && _npcSH) return _npcSH;
    _npcDay = day; _npcDistCache = {};
    const sh = {};
    const R = GX.RINGS || 25;
    // STRONGHOLDS START AT RING 6. A blob is a fixed SIZE but the inner bands
    // have few tiles, so three of them on rings 2–7 made that band 28% rival-held
    // off the strongholds alone — the beginner frontier is exactly where a pilot
    // needs open ground. Deep space is the contested half of the map by design,
    // and that is where the empires with sealed cores now live. The shallowest
    // band also gets radius-1 blobs only, so it reads as an outpost rather than
    // as a fortress wall.
    const lo = 6, span = Math.max(1, Math.ceil((R - lo + 1) / NPC_SH_BANDS));
    let shTiles = 0;
    for (let b = 0; b < NPC_SH_BANDS; b++) {
      for (let i = 0; i < NPC_SH_PER_BAND; i++) {
        const h = fnvHash('SH' + b + ':' + i + '\u00b7' + day);
        const rad = (b === 0) ? 1 : ((i % 2 === 0) ? 2 : 1);
        // keep the blob clear of the band edges so it cannot spill off the map
        const rMin = lo + b * span + rad, rMax = Math.min(R - rad, lo + (b + 1) * span - 1);
        if (rMax < rMin) continue;
        const ring = rMin + (h % (rMax - rMin + 1));
        const coords = GX.ringCoords(ring);
        const c = coords[(h >>> 9) % coords.length];
        const owner = RIVAL_NAMES[(h >>> 17) % RIVAL_NAMES.length];
        for (let rr = 0; rr <= rad; rr++) {
          for (const o of GX.ringCoords(rr)) {
            const q = c.q + o.q, r2 = c.r + o.r;
            if (GX.ringOf(q, r2) > R || GX.ringOf(q, r2) < 1) continue;
            const id = GX.tileId(q, r2);
            if (sh[id]) continue;           // overlap: first blob keeps the tile
            sh[id] = owner; shTiles++;
          }
        }
      }
    }
    // NORMALISE THE SCATTER so the whole map's rival density is what it always
    // was: the strongholds have already spent part of the budget.
    let want = 0, restP = 0;
    for (let ring = 1; ring <= R; ring++) {
      const p = npcRingP(ring), n = 6 * ring;
      want += p * n;
      const held = GX.ringCoords(ring).reduce((s, c) => s + (sh[GX.tileId(c.q, c.r)] ? 1 : 0), 0);
      restP += p * (n - held);
    }
    _npcScatter = restP > 0 ? Math.max(0, Math.min(1, (want - shTiles) / restP)) : 0;
    _npcSH = sh;
    return sh;
  }
  // ---- who holds this neighbourhood (scattered tiles) ---------------------
  // DIST 5 cells of ~25 tiles: big enough that a run of held tiles reads as one
  // empire's edge, small enough that the map still has many players on it.
  const NPC_DIST = 5;
  function npcDistrictOwner(q, r) {
    const dq = Math.floor((q + 90) / NPC_DIST), dr = Math.floor((r + 90) / NPC_DIST);
    const key = dq + ':' + dr;
    const hit = _npcDistCache[key];
    if (hit) return hit;
    const h = fnvHash('D' + dq + ':' + dr + '\u00b7' + _npcDay);
    return (_npcDistCache[key] = RIVAL_NAMES[(h >>> 8) % RIVAL_NAMES.length]);
  }
  function npcOwner(k) {
    if (isOwned(k)) return null;
    // NOTE: a live contest cooldown used to blank the owner here, which meant
    // attacking a held tile and bailing showed it as NEUTRAL — unclaimed for
    // 24 h (and dropped its garrison). Only an actual capture (isOwned) clears
    // the holder now.
    const sh = npcLayer();
    const inSh = sh[k];
    if (inSh) return inSh;
    const t = sysAt(k); if (!t) return null;
    const c = GX.parseId(k); if (!c) return null;
    const p = npcRingP(t.ring) * _npcScatter;
    if (fnvHash(k + '\u00b7' + _npcDay) % 10000 / 10000 >= p) return null;
    return npcDistrictOwner(c.q, c.r);
  }
  function rivalOf(k) {
    const real = rt.realTiles && rt.realTiles[k];
    if (real) {
      const myUid = turfOn() ? window.TERRITORY.myId() : null;
      return (myUid && real.ownerId === myUid) ? null : (real.ownerName || 'Operator');
    }
    if (turfOn()) return npcOwner(k);   // shared world — deterministic NPC layer, identical for everyone
    return (state.rivalTiles && state.rivalTiles[k]) || null;
  }
  // Seconds left on a tile's contest cooldown. ANY attacked/captured tile is
  // shielded for 24 h — merges the local clock with the multiplayer server's
  // cooldown_until so real-player attacks respect it too.
  function tileCooldownLeft(k) {
    let until = (state.tileCd && state.tileCd[k]) || 0;
    const real = rt.realTiles && rt.realTiles[k];
    if (real && real.cooldownUntil) { const t = new Date(real.cooldownUntil).getTime(); if (t > until) until = t; }
    return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  }
  // Combat multipliers for the tile we're standing in — deep space rings give
  // 20× density, 3× spawn rate, 10× loot, and the lose-2-items death rule.
  function applyTileMults(tile) {
    rt.tileDensity = (tile && tile.deep) ? GX.DEEP_MULT.density : 1;
    rt.tileLoot    = (tile && tile.deep) ? GX.DEEP_MULT.loot : 1;
    rt.tileRespawnMult = (tile && tile.deep) ? GX.DEEP_MULT.rate : 1;
    rt.deepDeath   = !!(tile && tile.deep);
  }
  // Effective loot-quality roll multiplier for the current tile — hard ×2 cap.
  function lootQ() { return Math.min(2, Math.max(1, Math.round(qualityMult(state.currentDungeon) * (rt.tileLoot || 1) * (window.DREAD ? window.DREAD.mult('lootQuality') : 1)))); }
  function canAfford(cost) {
    return state.resources.fuel >= (cost.fuel || 0) && state.resources.iron >= (cost.iron || 0) && state.resources.plasma >= (cost.plasma || 0);
  }
  // Simulated rival owners (no real multiplayer). Seeded once; higher regions are
  // more heavily contested. Never overwrites existing ownership/assignments.
  const RIVAL_NAMES = ['GhostHD','ReaperX','Viper77','HawkOG','WolfPack','RavenTX','SteelRecon','AceMag','FrostByte','DieselK','MakoSix','EchoNine','RazorBravo','BoltActual','TalonVet','IronProto','NyxPrime','OnyxFPS','SaintTac','KriegMk2'];
  // NPC HOLDINGS ARE CAPPED (Aug 2026). Seeding was unbounded: 20 names spread
  // over ~1,950 tiles left every rival sitting on 25-30 systems, so the map read
  // as a handful of untouchable empires instead of a contested frontier. No
  // simulated pilot may hold more than RIVAL_CAP tiles — at seed time, or through
  // the live turf war — and saves made before the cap are trimmed on load.
  const RIVAL_CAP = 10;
  const ringXenP = (ring) => Math.min(0.5, 0.08 + ring * 0.018);   // deeper rings more contested
  function rivalCounts() {
    const c = {}, held = state.rivalTiles || {};
    for (const id in held) { const n = held[id]; if (n) c[n] = (c[n] | 0) + 1; }
    return c;
  }
  // A rival still under the cap, or null when every one of them is full. `counts`
  // is the caller's live tally so a burst of events can't overshoot between reads.
  function freeRivalName(counts, exclude, rnd) {
    const pool = RIVAL_NAMES.filter((n) => n !== exclude && (counts[n] | 0) < RIVAL_CAP);
    if (!pool.length) return null;
    return pool[(((rnd || Math.random)()) * pool.length) | 0];
  }
  // Release everything a rival holds above the cap back to neutral. Runs once per
  // load, so an existing save converges on the cap instead of keeping its empires.
  function trimRivalHoldings() {
    const counts = {}, held = state.rivalTiles || {};
    let freed = 0;
    for (const id in held) {
      const n = held[id]; if (!n) continue;
      if ((counts[n] | 0) >= RIVAL_CAP) { delete held[id]; freed++; }
      else counts[n] = (counts[n] | 0) + 1;
    }
    return freed;
  }
  function seedRivals() {
    if (!state.rivalTiles) state.rivalTiles = {};
    trimRivalHoldings();
    const counts = rivalCounts();
    // BUDGET SCALING. The cap allows 20 × 10 = 200 holdings, far fewer than the raw
    // per-ring odds would place (~480), and seeding runs centre-outward — so an
    // unscaled pass would spend the whole budget on the inner rings and leave deep
    // space, the most contested ground by design, completely neutral. Every ring's
    // odds are scaled by the same factor instead, which spreads the budget across
    // all 25 rings and keeps the deeper-is-more-contested gradient intact.
    let expect = 0;
    for (let ring = 1; ring <= GX.RINGS; ring++) expect += 6 * ring * ringXenP(ring);
    const budget = Math.max(0, RIVAL_NAMES.length * RIVAL_CAP - Object.keys(state.rivalTiles).length);
    const scale = expect > 0 ? Math.min(1, budget / expect) : 0;
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let ring = 1; ring <= GX.RINGS; ring++) {
      const p = ringXenP(ring) * scale;
      GX.ringCoords(ring).forEach((c) => {
        const id = GX.tileId(c.q, c.r);
        if (state.ownedSystems[id] || state.rivalTiles[id] || simBlocked(id)) return;
        if (rnd() >= p) return;
        const name = freeRivalName(counts, null, rnd);
        if (!name) return;
        state.rivalTiles[id] = name; counts[name] = (counts[name] | 0) + 1;
      });
    }
  }
  // Full info card for one tile — everything the detail panel needs.
  // ALLIED TILE — owned by a real player in MY alliance (never attackable)
  function isAllyTile(k) {
    const real = rt.realTiles && rt.realTiles[k];
    if (!real || !real.ownerId) return false;
    const my = realMyUid();
    if (my && real.ownerId === my) return false;
    return !!(window.ALLIANCE && window.ALLIANCE.isAlly && window.ALLIANCE.isAlly(real.ownerId));
  }
  function tileInfo(k) {
    const t = sysAt(k); if (!t) return null;
    return Object.assign({}, t, {
      owned: isOwned(k), rival: rivalOf(k), active: state.currentSystem === k,
      ally: isAllyTile(k),
      cooldown: tileCooldownLeft(k),
      abandonLock: abandonLockLeft(k),
      myCitadel: hasMyCitadel(k) && isOwned(k), rivalCitadelScore: rivalCitadelScore(k), defense: rivalDefense(k),
      lootQ: (t.deep ? GX.DEEP_MULT.loot : 1),
      cit: citadelRankOf(k),
      resMult: (t.deep ? GX.DEEP_MULT.resource : 1),
      locked: t.level > state.level + 10 && !isOwned(k),
      // THE GATE WARP ACTUALLY USES, PUBLISHED BEFORE IT FIRES.
      //
      // `locked` above is the MAP'S COLOUR rule and deliberately excludes tiles
      // you hold — your own systems stay gold on the map whatever your level.
      // warp() applies the level band to OWNED tiles too (see the note there: an
      // ascended pilot keeps a Lv 370 system and comes back at Lv 1, and warping
      // in would be a free high-level farm). So the two answers differ on exactly
      // the tiles an ascension creates, and the sheet was printing the map's
      // answer while the button used warp's — an enabled action that refused.
      // Anything gating an ACTION reads this one.
      deployLocked: t.level > state.level + 10,
      deployNeedLv: Math.max(1, t.level - 10),
      // NO EXPOSED BORDER, NO SIEGE — see tileShield(). The sheet prints this
      // before the button is tapped; warp() refuses on the same answer.
      shield: tileShield(k),
      shieldDoors: shieldDoors(k),
      bloc: blocOf(k),
    });
  }
  // ---- LIVING GALAXY: simulated rival turf wars (NOT real PvP) -------------
  // Rivals periodically claim neutral tiles, seize tiles from each other, and
  // contest YOUR territory — so the map is fought over and shifts between (and
  // during) sessions. Catch-up runs on load for the time you were away.
  function rndRivalName() { return RIVAL_NAMES[(Math.random() * RIVAL_NAMES.length) | 0]; }
  function galaxyEvent() {
    // SHARED turf war live → the local random sim must NOT mutate the map:
    // every player sees the same deterministic NPC layer + real claims instead.
    if (turfOn()) return null;
    // weighted ring pick — deeper space is more contested
    const ring = 1 + Math.min(GX.RINGS - 1, Math.floor(Math.pow(Math.random(), 0.6) * GX.RINGS));
    const ids = GX.ringCoords(ring).map((c) => GX.tileId(c.q, c.r));
    // A SHIELDED TILE IS OFF THE BOARD FOR EVERYONE (Aug 2026). The 24h attack
    // shield is supposed to freeze a contested tile win or lose, and the branch
    // that takes YOUR tiles honoured it — but the expand and war branches did not,
    // so the sim happily claimed shielded neutral ground the player had just
    // fought over and was waiting out the clock to take.
    const shielded = (id) => tileCooldownLeft(id) > 0 || simBlocked(id) || tileShield(id).shielded;
    const neutral = ids.filter((id) => !state.ownedSystems[id] && !state.rivalTiles[id] && !(rt.realTiles && rt.realTiles[id]) && !shielded(id));
    const rivalHeld = ids.filter((id) => state.rivalTiles[id] && !(rt.realTiles && rt.realTiles[id]) && !shielded(id));
    const mine = ids.filter((id) => state.ownedSystems[id] && id !== state.currentSystem && !(rt.realTiles && rt.realTiles[id]) && !shielded(id));
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const counts = rivalCounts();
    const r = Math.random();
    if (r < 0.5 && neutral.length) {
      const name = freeRivalName(counts);
      if (name) { const id = pick(neutral); state.rivalTiles[id] = name; return { kind: 'expand', name, tile: id }; }
    }
    if (r < 0.85 && rivalHeld.length) {
      const id = pick(rivalHeld), from = state.rivalTiles[id];
      // a seizure moves a tile between rivals, so the total never changes — but the
      // pilot taking it still has to be under the cap
      const name = freeRivalName(counts, from);
      if (name) { state.rivalTiles[id] = name; return { kind: 'war', name, from, tile: id }; }
    }
    // contest one of YOUR tiles (deliberately rare; citadels are siege-locked)
    if (mine.length && Math.random() < 0.4) {
      const id = pick(mine);
      const t = sysAt(id);
      if (tileCooldownLeft(id) > 0) return null;   // belt and braces — `mine` already excludes shielded tiles
      if (t && t.citadel && Math.random() < 0.85) return null; // citadels rarely fall to the sim
      // player-built citadels: higher ranks are hardened vs the rival sim
      if (hasMyCitadel(id) && Math.random() < (0.7 + 0.06 * citadelLevel(id))) return null;
      const name = freeRivalName(counts);
      if (!name) return null;                      // every rival is at its cap — nobody is free to take it
      accrueResources();   // settle earnings up to the moment the tile falls
      delete state.ownedSystems[id]; state.rivalTiles[id] = name;
      // a rival takeover RAZES any citadel you built there — and the tile is
      // attack-shielded for 24 h (you can't instantly take it back)
      const hadCit = !!(state.citadels && state.citadels[id]);
      if (hadCit) delete state.citadels[id];
      if (!state.tileCd) state.tileCd = {};
      state.tileCd[id] = Date.now() + 24 * 3600 * 1000;
      try { if (window.MAIL) window.MAIL.tileLost((sysAt(id) || {}).name || id, { ownerName: name, fleetScore: rivalCitadelScore(id) || 0, defense: null }, { razed: hadCit, id: id }); } catch (e) {}
      return { kind: 'lost', name, tile: id, razed: hadCit };
    }
    return null;
  }
  function pushFeed(msg, mine) {
    if (!state.galaxyFeed) state.galaxyFeed = [];
    state.galaxyFeed.unshift({ t: Date.now(), msg: msg, mine: !!mine });
    state.galaxyFeed = state.galaxyFeed.slice(0, 24);
  }
  function galaxyTick() {
    const now = Date.now();
    if (!state.lastGalaxyTick) state.lastGalaxyTick = now;
    let events = Math.min(8, Math.floor((now - state.lastGalaxyTick) / 360000)); // ~1 / 6 min, small catch-up bursts
    if (events <= 0) { if (Math.random() < 0.2) events = 1; else return; }
    state.lastGalaxyTick = now;
    let lost = null;
    for (let i = 0; i < events; i++) {
      const ev = galaxyEvent(); if (!ev) continue;
      const tn = (GX.tileAt(ev.tile) || {}).name || ev.tile;
      if (ev.kind === 'expand') pushFeed(ev.name + ' claimed ' + tn);
      else if (ev.kind === 'war') pushFeed(ev.name + ' seized ' + tn + ' from ' + ev.from);
      else { pushFeed(ev.name + ' captured your ' + tn, true); lost = lost || { name: ev.name, tn: tn }; }
    }
    save();
    if (window.UI) { if (lost) window.UI.galaxyContestToast(lost.name, lost.tn); window.UI.galaxyChanged(); }
  }
  // ---- REAL turf war (Supabase) hybrid layer -------------------------------
  // When signed into a real account, tile ownership is shared across accounts.
  // Real ownership overrides the local simulation; simulated rivals only ever
  // occupy tiles no real player holds, so the map is contested AND never empty.
  function realMyUid() { return (window.TERRITORY && window.TERRITORY.enabled()) ? window.TERRITORY.myId() : null; }
  // A TILE YOU WALKED AWAY FROM IS NOT A TILE YOU LOST (build 710). Abandoning
  // releases the server claim, but that release is a network write: until it lands
  // — or if it never does — the shared map can still name this account as the
  // owner, so the next convergence pull re-adopted the tile. The moment another
  // player claimed it, the loss path fired and mailed a war report for a system the
  // pilot had deliberately given up. abandonLockLeft() is the 24-hour record of
  // that decision, so it answers both halves: never re-adopt, never file a report.
  function abandonedByMe(id) { try { return abandonLockLeft(id) > 0; } catch (e) { return false; } }
  // A LOSS IS ONLY NEWS IF IT CAN BE DATED (Aug 2026).
  //
  // `state.ownedSystems` is a MIRROR, and a stale entry in it survives for
  // reasons that have nothing to do with a battle: a capture from the months
  // `claim_tile` refused every write, a loss already processed on another device,
  // a merge that brought an older copy of the map back. The 60s convergence pull
  // could not tell any of those from a conquest that happened overnight, so it
  // filed "While you were away — X has fallen" for systems the pilot last held
  // weeks ago, in the low rings everybody passes through early. That is the whole
  // of "I'm getting mail that I've lost a system in ring 1/2".
  //
  // Every claim stamps `cooldown_until` (15 min normal, 24 h for a citadel), so
  // the row DATES the last time that tile changed hands — no new save field, no
  // migration. Inside the window the report is real news and is filed; outside it
  // the local mirror is simply wrong, and it is corrected in silence: the console
  // gets the fact, the player does not get a war report about a month-old system.
  // A tile the shared map confirmed as MINE earlier in this session is always
  // news whatever the clock says, which is the case the window exists to keep.
  const LOSS_NEWS_MS = 36 * 3600 * 1000;
  function lossIsNews(id, r) {
    if (rt._terrMine && rt._terrMine[id]) return true;
    const raw = r && r.cooldownUntil;
    const cu = typeof raw === 'number' ? raw : (raw ? Date.parse(raw) : 0);
    if (!cu) return false;                     // undatable row — correct the mirror quietly
    return (Date.now() - cu) <= LOSS_NEWS_MS;
  }
  function markRealMine(id) { if (!rt._terrMine) rt._terrMine = {}; rt._terrMine[id] = 1; }
  function syncRealTiles(map) {
    rt.realTiles = map || {};
    accrueResources();   // settle at PRE-sync ownership — you earn for what you actually held until now
    const myUid = realMyUid();
    Object.keys(rt.realTiles).forEach((id) => {
      const r = rt.realTiles[id];
      if (myUid && r.ownerId === myUid) {
        // stale row for a tile I released — re-send the release, don't take it back
        if (abandonedByMe(id)) {
          delete state.ownedSystems[id];
          delete rt.realTiles[id];
          try { if (window.TERRITORY && window.TERRITORY.release) window.TERRITORY.release(id); } catch (e) {}
          return;
        }
        state.ownedSystems[id] = true;
        markRealMine(id);
      } else if (state.ownedSystems[id]) {
        delete state.ownedSystems[id];
        // lost while away — file a war report with the conqueror's fleet intel,
        // but only for a loss that can be dated as recent (see lossIsNews)
        if (!abandonedByMe(id)) {
          if (lossIsNews(id, r)) {
            try { if (window.MAIL) window.MAIL.tileLost((sysAt(id) || {}).name || id, r, { offline: true, razed: !!(state.citadels && state.citadels[id]), id: id }); } catch (e) {}   // sysAt: void tiles mail with real names too
          } else {
            try { console.info('[galaxy] stale local claim dropped, no war report (undatable loss):', id, r && r.ownerName); } catch (e) {}
          }
        }
        if (state.citadels && state.citadels[id]) delete state.citadels[id];
      }
      if (state.rivalTiles) delete state.rivalTiles[id]; // a real owner overrides any simulated one
    });
    reconcilePhantoms(map);
  }
  // A TILE THE SERVER HAS NO ROW FOR IS NOT YOURS — BUT ONLY IF WE CAN PROVE IT (736).
  //
  // syncRealTiles() can only ever remove a tile it SEES: it walks the rows the pull
  // returned, so its removal branch fires only when the server says someone else
  // owns the tile. When a row is DELETED outright — released, or swept — the tile is
  // absent from the map entirely, the loop never visits it, and a stale
  // `ownedSystems[id] = true` survives forever. It keeps counting toward
  // tileCount(), which is how a pilot ends up 79-against-a-75-cap and frozen out of
  // new captures with nothing on screen to explain it.
  //
  // THIS IS THE MOST DESTRUCTIVE THING IN THIS FILE IF IT IS WRONG, so it refuses to
  // act unless every one of these holds:
  //   1. the pull SUCCEEDED. loadAll() returns null on failure now, precisely so
  //      this can tell "failed" from "empty" — an empty map would otherwise read as
  //      "you own nothing".
  //   2. the map is non-empty. A complete map of a genuinely empty table means no
  //      pilot in the game holds anything; treat it as untrustworthy either way.
  //   3. the tile is GALAXY GROUND with NO CITADEL. A phantom fortress is a far
  //      bigger claim to drop than a phantom field, and getting it wrong destroys a
  //      Rank 5 someone sieged for. Void spires and House Citadels are left alone
  //      as well — same rule as the cap and the boards.
  //   4. it was not claimed in the last 90s. The map is a SNAPSHOT: a tile taken
  //      while the pull was in flight is legitimately absent from it.
  //   5. the phantoms are a MINORITY of the empire. If a quarter or more of what
  //      you hold looks absent, the map is wrong rather than the save — log it and
  //      touch nothing. This is the guard that makes a bad pull survivable.
  //
  // It only ever drops a flag the server already disagrees with, so it cannot cost
  // a pilot anything the server still credits them for.
  const PHANTOM_GRACE_MS = 90000, PHANTOM_MAX_SHARE = 0.25;
  function reconcilePhantoms(map) {
    if (!map || typeof map !== 'object') return;                 // 1 — pull failed
    if (!Object.keys(map).length) return;                        // 2 — nothing to trust
    const own = state.ownedSystems || {}, now = Date.now(), claimed = rt._claimAt || {};
    const held = Object.keys(own).filter((id) => own[id]);
    const gone = held.filter((id) => {
      if (map[id]) return false;
      if (id === GX.HOME || !isGalaxyTile(id)) return false;      // 3 — galaxy ground only
      if (state.citadels && state.citadels[id]) return false;     // 3 — never a fortress
      if (now - (claimed[id] || 0) < PHANTOM_GRACE_MS) return false; // 4 — just taken
      return true;
    });
    if (!gone.length) return;
    if (gone.length > Math.max(4, held.length * PHANTOM_MAX_SHARE)) {  // 5 — refuse
      try { console.warn('[galaxy] phantom sweep declined — ' + gone.length + ' of ' + held.length
        + ' holdings absent from the map; treating the pull as unreliable'); } catch (e) {}
      return;
    }
    accrueResources();   // settle at pre-sweep ownership, same as every other flip
    gone.forEach((id) => { delete own[id]; });
    clusterBust();
    try { console.info('[galaxy] dropped ' + gone.length + ' phantom tile(s) the server has no row for:', gone.join(' ')); } catch (e) {}
    save();
  }
  function onRealtimeTile(ev) {
    if (!rt.realTiles) rt.realTiles = {};
    const myUid = realMyUid();
    if (ev.deleted) { delete rt.realTiles[ev.tileId]; }
    else {
      rt.realTiles[ev.tileId] = { ownerId: ev.ownerId, ownerName: ev.ownerName, cooldownUntil: ev.cooldownUntil, citadel: !!ev.citadel, citadelLv: ev.citadelLv | 0, fleetScore: ev.fleetScore || 0, defense: ev.defense || null };
      accrueResources();   // settle before ownership flips either way
      if (myUid && ev.ownerId === myUid) {
        if (abandonedByMe(ev.tileId)) {   // an echo of the claim I just released
          delete state.ownedSystems[ev.tileId];
          delete rt.realTiles[ev.tileId];
          try { if (window.TERRITORY && window.TERRITORY.release) window.TERRITORY.release(ev.tileId); } catch (e) {}
          if (window.UI) window.UI.galaxyChanged();
          return;
        }
        state.ownedSystems[ev.tileId] = true;
        markRealMine(ev.tileId);
      }
      else if (state.ownedSystems[ev.tileId]) {
        delete state.ownedSystems[ev.tileId];
        const tn = (sysAt(ev.tileId) || {}).name || ev.tileId;   // sysAt: void tiles included
        // a tile I abandoned changing hands is news, not a defeat: no feed line,
        // no war report, no toast (see abandonedByMe)
        if (!abandonedByMe(ev.tileId)) {
          pushFeed(ev.ownerName + ' captured your ' + tn, true);
          try { if (window.MAIL) window.MAIL.tileLost(tn, rt.realTiles[ev.tileId], { razed: !!(state.citadels && state.citadels[ev.tileId]), id: ev.tileId }); } catch (e) {}
          if (window.UI) window.UI.galaxyContestToast(ev.ownerName, tn);
        }
        if (state.citadels && state.citadels[ev.tileId]) delete state.citadels[ev.tileId];
      }
      if (state.rivalTiles) delete state.rivalTiles[ev.tileId];
    }
    if (window.UI) window.UI.galaxyChanged();
  }
  function initTerritory() {
    if (!(window.TERRITORY && window.TERRITORY.enabled())) return;
    rt._terrSync = Date.now();
    window.TERRITORY.loadAll().then((map) => { syncRealTiles(map); if (window.UI) window.UI.galaxyChanged(); });
    window.TERRITORY.subscribe(onRealtimeTile);
    // CONVERGENCE: realtime alone can miss (publication gaps, device sleep) —
    // re-pull the whole shared map every 60s so all players see the SAME galaxy
    if (!rt._terrIv) rt._terrIv = setInterval(() => {
      try { window.TERRITORY.loadAll().then((m) => { syncRealTiles(m); if (window.UI) window.UI.galaxyChanged(); }); } catch (e) {}
    }, 60000);
  }
  // RETIRED (736). republishOwnedTiles() re-claimed every locally-held tile that
  // was missing from the server map — a one-time repair for the half-migrated
  // claim_tile that rejected writes for months. That migration landed long ago,
  // and the path had become the thing MANUFACTURING the bug it was written to fix:
  // it re-asserted stale local flags onto the server with no cap check and no test
  // that the pilot still held the tile. FrostSkull's 79-against-a-75-cap was four
  // plain tiles it re-claimed in one 1.2s burst (800 + i*400 — the timestamps are
  // 371/415/397ms apart), long since lost to other pilots, which then counted
  // toward tileCount() and froze him out of new captures.
  //
  // A phantom is now RESOLVED rather than re-published — see the reconciliation
  // pass in syncRealTiles(). `state._turfRepub2` is left in the save: it is read at
  // ascension (see the truncation guard) and an unrecognised key is never ours to
  // delete.
  function republishOwnedTiles() { /* retired — see above */ }
  // Tap a tile: own → deploy/farm; neutral → capture siege; rival → contest
  // (starts a 15-min region cooldown). Returns {ok} / {ok:false, reason}.
  // Effective entry cost for a tile (your own territory warps at half price).
  function entryCostFor(k) {
    const t = sysAt(k); if (!t || t.home) return null;
    if (t.void) {   // VOID ZONE — 1000× toll (your own tile warps half price, as everywhere)
      const base = VOID_ENTRY(t), vdisc = isOwned(k) ? 0.5 : 1, veff = {};
      for (const ck in base) veff[ck] = Math.ceil(base[ck] * vdisc);
      return veff;
    }
    const c = GX.entryCost(t.ring, t); if (!c) return null;
    const disc = isOwned(k) ? 0.5 : 1;
    const eff = {};
    for (const ck in c) eff[ck] = Math.ceil(c[ck] * disc);
    return eff;
  }
  // NO LONGER ARMS ANYTHING. Kept as the single choke point the kill path calls,
  // so that if a future flow ever needs to stamp a shield mid-engagement it has
  // one obvious home — but attacking a tile no longer shields it. A shield is
  // stamped only where a tile actually CHANGES HANDS (captureTile, siege win).
  // See the rule at the arming site in warp(). `_pendShield` is never set now, so
  // this returns on its first line and costs nothing.
  function commitTileShield() {
    const p = rt._pendShield; if (!p || !p.k) return;
    // BELT AND BRACES — a pending stamp must never outlive the visit that created
    // it. Bail and Dock both route through selectDungeon(), not goSafeHangar(), so
    // a pending shield used to survive the retreat and land on the player's next
    // kill ANYWHERE, shielding a tile they had already abandoned. selectDungeon()
    // now clears it; this check means any future exit path is safe by default.
    if (state.currentSystem !== p.k) { rt._pendShield = null; return; }
    rt._pendShield = null;
    if (!state.tileCd) state.tileCd = {};
    state.tileCd[p.k] = Math.max(state.tileCd[p.k] || 0, p.until);
    save();
  }
  function warp(k) {
    const tile = sysAt(k); if (!tile) return { ok: false, reason: 'invalid' };
    if (isAllyTile(k)) return { ok: false, reason: 'ally' };   // same alliance — never attackable
    if (tile.home) return { ok: false, reason: 'home' };       // the Home Citadel is neutral
    const owned = isOwned(k);
    // VOID: strict gates, no +10 grace — and the gate holds for tiles YOU OWN.
    // Ascension keeps your territory but resets your level, so an owned Lv-300
    // spire + a fresh Lv-5 pilot was a free high-level XP farm: warp in, kill
    // one garrison hulk, jump levels. You keep the income; you fight it again
    // only once you have re-earned the level.
    if (tile.void && state.level < tile.vtier) return { ok: false, reason: 'locked', ownGate: owned };
    // EMPIRE AT CAPACITY — refuse the trip rather than let a pilot fight a siege
    // they can't be paid for. Entering a tile you already hold is always fine.
    // …AND IT DOES NOT GATE OFF-MAP HOLDS. A Void spire or House Citadel is not
    // galaxy ground, does not count toward the cap (tileCount) and therefore
    // cannot be refused by it either. Gating them here is what made a full
    // galaxy empire unable to warp into the Void at all.
    if (!owned && isGalaxyTile(k) && atTileCap()) { try { window.PROOFFER && PROOFFER.maybe('tilecap'); } catch (e) {} return { ok: false, reason: 'tilecap', cap: tileCap() }; }
    // …AND THE SAME GATE ON ORDINARY TILES. This used to be `!owned &&`, which
    // left the exact hole the Void comment above describes: ascension keeps your
    // territory but resets your level, so an owned Lv-300 system and a fresh Lv-5
    // pilot meant warping into a zone garrisoned by your OWN clone fleet — a
    // pilot fighting themselves for free high-level XP. You keep the tile and its
    // income; you fight on it again once you have re-earned the level.
    if (tile.level > state.level + 10) return { ok: false, reason: 'locked', ownGate: owned };
    // contest cooldown blocks EVERY non-owned warp-in (rival, neutral, citadel)
    if (!owned && tileCooldownLeft(k) > 0) return { ok: false, reason: 'cooldown' };
    // AND THE ABANDONING PILOT CANNOT WALK STRAIGHT BACK IN. Blocks only this
    // account, and only on a tile it released itself — see ABANDON_LOCK_MS.
    if (!owned) {
      const lock = abandonLockLeft(k);
      if (lock > 0) return { ok: false, reason: 'abandoned', secs: lock };
    }
    // NO EXPOSED BORDER, NO SIEGE. A system whose every border faces its own
    // owner's space cannot be reached until one of those border systems falls.
    // Refused BEFORE the entry cost below, so a blocked assault never charges a
    // pilot resources for a trip that does not happen.
    if (!owned) {
      const shd = tileShield(k);
      if (shd.shielded) return { ok: false, reason: 'interior', doors: shieldDoors(k), faction: shd.faction };
    }
    // ENTRY COST — every warp burns resources; deeper rings are punishing
    const cost = entryCostFor(k);
    if (cost) {
      if (!canAfford(cost)) return { ok: false, reason: 'resources', cost };
      state.resources.fuel -= cost.fuel || 0;
      state.resources.iron -= cost.iron || 0;
      state.resources.plasma -= cost.plasma || 0;
    }
    // A SHIELD IS EARNED BY TAKING THE TILE, NOT BY ATTACKING IT.
    //
    // This used to arm a pending 24 h shield on warp-in and commit it on the
    // first kill — "so nobody can attack a contested tile again win or lose".
    // Losing therefore protected the tile you had just failed to take: the
    // defender got a free day out of beating you, you could not retry, and
    // nobody else could attack either. A failed assault is not a defence, and it
    // is certainly not the ATTACKER's achievement to hand out.
    //
    // The shield now comes from the two places that actually capture a tile —
    // captureTile() and the siege win in claimTile — both of which stamp 24 h on
    // success. Fail, bail, or die, and the tile stays exactly as open as it was.
    // Applies to My Galaxy tiles and Void spires alike; they share this path.
    rt._pendShield = null;
    enterTile(k);
    save();
    return { ok: true };
  }
  function enterTile(k) {
    const tile = sysAt(k); if (!tile) return;
    if (tile.home) { respawnAt(0); return; }      // Home Citadel → safe harbor
    state.currentSystem = k;
    state.currentDungeon = tile.diff;
    armAuto();                      // galaxy tile / Void spire — same default
    reachZone(tile.diff);
    const cap = C.zoneCap(state.highestDungeonReached);
    const u = Math.min(cap, unlockCeil(state.level));
    if (u > state.highestUnlocked) state.highestUnlocked = u;
    applyTileMults(tile);
    const owned = isOwned(k);
    if (owned && (tile.boss || tile.citadel)) {
      // owned Boss/Citadel tile → endless gauntlet; every 10th wave the boss is
      // the EXACT clone of the fleet holding the tile — yours: your flagship
      // model, your escorts, your ship score. (Sparring against your garrison.)
      rt.siege = null;
      const mySnap = defenseSnapshot();
      let myNm = 'YOUR'; try { const s = window.AUTH && AUTH.session && AUTH.session(); if (s && s.name) myNm = s.name; } catch (e) {}
      rt.waves = { active: true, total: 10, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.2, super: false, bossTile: true,
                   clone: true, cloneScore: mySnap.score, cloneDef: { name: myNm, real: true, score: mySnap.score, snap: mySnap } };
    } else if (owned) {
      rt.siege = null; rt.waves = null;
    } else if (rivalCitadelScore(k) != null) {
      // ATTACK a rival player CITADEL — waves → their CLONE FLEET → the CITADEL.
      rt.siege = null;
      rt.waves = { active: true, total: 8, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.2, super: false, clone: true, cloneScore: rivalCitadelScore(k), cloneDef: rivalDefense(k), thenCitadel: true, playerCit: true, claimTile: k };
    } else if (tile.citadel) {
      // CITADEL SIEGE ZONE → the full citadel-siege encounter; raze it to CLAIM it
      rt.siege = null;
      rt.waves = { active: true, total: 8, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, citadel: true, claimTile: k };
    } else if (rivalOf(k)) {
      // RIVAL-HELD tile — their CLONE FLEET garrisons it: clear the escort
      // waves, then defeat the clone to take the zone.
      rt.siege = null;
      rt.waves = { active: true, total: 6, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.1, super: false, clone: true, cloneScore: (rivalDefense(k) || {}).score, cloneDef: rivalDefense(k), plainTake: true, claimTile: k };
    } else if (tile.void) {
      // NEUTRAL VOID SPIRE — the VOID WARDEN garrisons it: escort waves, then a
      // synthetic warden fleet as the FINAL WAVE, tuned to the tile's (5×)
      // difficulty. Player-held void tiles use the owner's REAL clone fleet
      // via the rival paths above — same as My Galaxy.
      rt.siege = null;
      const vpool = ['battleship', 'dreadnought', 'carrier', 'supercarrier', 'titan', 'mothership'];
      const wardenShip = vpool[Math.min(vpool.length - 1, Math.floor(tile.vtier / 100))];
      // WARDEN STRENGTH — a flat, honest edge over the pilot who unlocked the
      // gate. This used to scale with vtier (×2.8 at Lv400) which, once run
      // through true-power, made deep spires mathematically unwinnable.
      const wardenScore = Math.round(Math.max(1, score()) * 1.15);
      const wsnap = { ship: wardenShip, nm: 'Void Warden', lvl: tile.vtier, score: wardenScore, hp: 0, dps: 0, esc: 2, escKeys: ['destroyer', 'carrier'] };
      rt.waves = { active: true, total: 6, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.1, super: false,
                   clone: true, cloneScore: wardenScore, maxRatio: 1.35, cloneDef: { name: 'THE VOID WARDEN', real: false, score: wardenScore, snap: wsnap }, plainTake: true, claimTile: k };
    } else {
      // neutral → capture siege (Boss Tiles end on a boss wave)
      rt.siege = { active: true, total: 10, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.0, boss: tile.boss };
      rt.waves = null;
    }
    // VOID ZONE — marathon sieges: wave count = HALF the tile's level req
    // (Lv 500 → 250 waves, Lv 25 → 13). Every capture path; not your own sparring.
    if (tile.void && !owned) {
      const vw = Math.max(6, Math.ceil(tile.vtier / 2));
      if (rt.waves && rt.waves.active) rt.waves.total = vw;
      if (rt.siege && rt.siege.active) rt.siege.total = vw;
    }
    // Every PLAYER-vs-PLAYER phase of a defended tile is timed: a real pilot's
    // clone fleet, their Citadel, and every Void tile. Sparring against your own
    // garrison on an owned Boss Tile, NPC citadel zones and neutral captures are
    // not defences, so they stay untimed.
    {
      const w = rt.waves;
      if (w && w.active && !w.bossTile &&
          (w.playerCit || tile.void || (w.clone && w.cloneDef && w.cloneDef.real))) {
        w.timed = SIEGE_CLOCK; w.limitT = null;
      }
    }
    rt.awaitingRespawn = false;
    if (rt.archer) { rt.archer.dead = false; rt.archer.killer = null; rt.archer.hp = (rt.stats ? rt.stats.maxHp : 100); rt.archer.invuln = 3; }
    resetZone();
    spawnDrones();
    if (window.UI) { window.UI.refreshAll(); if (rt.siege) window.UI.siegeEvent('start', rt.siege); }
    save();
  }

  // ---- SIEGE wave engine ---------------------------------------------------
  function spawnWaveEnemy() {
    const cit = rt.waves && rt.waves.active && rt.waves.citadel;
    let x, y;
    if (cit) {
      // CITADEL SIEGE: the garrison descends from the top — you push UP
      x = 30 + Math.random() * (rt.worldW - 60);
      y = 30 + Math.random() * rt.worldH * 0.30;
    } else {
      // ACROSS THE WHOLE MAP. This used to be a ring centred on the pilot, which
      // is what made corner-camping a farming strategy: the ring clipped to a
      // wedge and delivered every wave bunched onto one bearing. Wave hostiles
      // rush the player anyway, so a uniform spawn still brings the fight to
      // them — it just arrives from every side, the way it does mid-map, and the
      // rate no longer depends on where they parked.
      const base = Math.min(rt.worldW, rt.worldH);
      const p = worldSpawn(base * 0.28, 30);
      x = p.x; y = p.y;
    }
    const _mechWave = !!(rt.waves && rt.waves.active && rt.waves.mech);
    const e = new E.Enemy(_mechWave ? pickMechType(rt.waves.tier) : pickType(), state.currentDungeon, x, y);
    if (_mechWave) mechSkin(e);
    else { voidSkin(e); xenSkin(e); }
    if (cit) {
      // garrison hulks: walls, not bombs — brutal HP, feeble guns
      e.maxHp *= 4.5; e.hp = e.maxHp;
      e.damage *= 0.32; e.speed *= 0.72; e.size *= 1.25;
    }
    kothScale(e);
    pushEnemy(e);
  }
  function spawnWave(n, densityMul) {
    densityMul = densityMul || 1;
    const t = state.currentSystem ? sysAt(state.currentSystem) : null;
    const ringN = t ? Math.max(1, t.ring) : Math.max(1, Math.ceil(state.currentDungeon / 10));
    let count = Math.min(16, 4 + Math.floor(ringN * 0.7) + Math.floor(n * 0.7));
    count = Math.min(34, Math.round(count * densityMul * (rt.tileDensity ? Math.min(2.2, 1 + (rt.tileDensity - 1) * 0.06) : 1)));
    for (let i = 0; i < count; i++) spawnWaveEnemy();
  }
  function spawnSiegeBoss() {
    spawnBoss();
  }
  // THE VOID CITADEL — a massive static fortress at the top of the zone.
  // It cannot move; it suppresses with slow 4-bolt spreads while you grind
  // its enormous hull down. Visual damage states live in render.drawCitadel.
  function spawnCitadel(waves) {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const c = new E.Enemy(type, state.currentDungeon, rt.worldW / 2, rt.worldH * 0.20);
    c.isCitadel = true; c.isBoss = true;      // boss-grade xp/gold on kill
    c.name = 'Void Citadel';
    c.maxHp *= 800; c.hp = c.maxHp;           // a fortress — a true siege grind
    // endgame clamp: with the DPS-floored base, ×800 would be a 7-minute wall.
    // Cap the siege at ~45s of the pilot's DPS — but never below the zone curve.
    {
      const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
      const curve800 = C.enemyHp(state.currentDungeon) * type.hpMod * 800;
      c.maxHp = c.hp = Math.round(Math.max(curve800, Math.min(c.maxHp, dps * 45)));
    }
    c.damage *= 0.5;
    c.size = 118; c.speed = 0;                // dominates the top of the zone
    c.ranged = true; c.range = 430; c.fireCd = 2.6; c.fireT = 1.4;
    // PLAYER-BUILT citadel (retake phase 2): named for its owner, scaled to
    // their published defense so stronger owners hold harder fortresses.
    if (waves && waves.playerCit) {
      const def = waves.cloneDef || {};
      c.name = ((def.name || 'ENEMY').toUpperCase()) + "'S CITADEL";
      // TRUE-POWER ratio (the compressed-score version under-scaled fortresses
      // the same way the clone flagship was under-scaled)
      const mu = cloneMatchup(waves.cloneScore, waves.maxRatio);
      c.maxHp = c.hp = Math.max(Math.round(c.maxHp), Math.round(effectiveDps() * TTK_ATT * 0.8 * mu.ratio));
      c.damage = Math.max(c.damage || 1, mu.dps * 0.7 * (c.fireCd || 1.6));
      setCloneRegen(c, mu.ratio);
      c.tint = '#ff6a5e';
    }
    pushEnemy(c);
    burst(c.x, c.y, '#ff9a50', 50, { speed: 300, life: 1.0, glow: true });
    return c;
  }
  function citadelDown(e) {
    // SUPERNOVA — triple blast rings + white flash + heavy shake
    burst(e.x, e.y, '#fff3d0', 90, { speed: 430, life: 1.2, glow: true });
    burst(e.x, e.y, '#ffd24d', 60, { speed: 260, life: 1.0, glow: true });
    burst(e.x, e.y, '#ff9a50', 40, { speed: 150, life: 0.9, glow: true });
    rt.shake = 9; rt.novaT = 0.6;
    // loot shower — better than the zone average, nothing absurd: +2 rarity
    // tiers over a 4×-quality roll, dropped in a ring around the PLAYER so the
    // magnet vacuums every piece before the tow home.
    const drops = lootBlocked() ? 0 : 8, zone = state.currentDungeon;
    for (let i = 0; i < drops; i++) {
      const base = rollRarityBoosted(zone, Math.min(2, qualityMult(zone) * 4));
      const item = I.generate(zone, Math.min(Math.min(10, C.rarityCap(zone) + 1), base + 2));
      state.itemsFound++; countRareFind(item);
      const a = Math.PI * 2 * (i / drops), r = 42 + Math.random() * 36;
      rt.ground.push(new E.GroundItem(rt.archer.x + Math.cos(a) * r, rt.archer.y + Math.sin(a) * r, item, false));
      lootBurst(e.x, e.y, item.rarity);
      if (window.UI) window.UI.onLoot(item, true);
    }
    // modest resource bounty + the 15-minute rebuild clock
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    state.resources.fuel += 150 + zone * 20; state.resources.iron += 60 + zone * 8; state.resources.plasma += 40 + zone * 6;
    // the rebuild clock: grind zones lock 15 min · claimed citadel tiles are
    // siege-locked for 24 h (your new fortress can only be sieged once a day)
    if (rt.waves && rt.waves.claimTile) {
      if (!state.tileCd) state.tileCd = {};
      state.tileCd[rt.waves.claimTile] = Date.now() + 24 * 3600 * 1000;
      if (rt.waves.playerCit) {
        captureCitadel(rt.waves.claimTile);      // rival's fortress taken INTACT → the tile flips to you
      } else {
        // NPC CITADEL — TAKEN INTACT (Jul 2026): no razing. The fortress, its
        // output and the tile all flip to you; these tiles can't be built on.
        rt.razingClaim = true;                   // conquest earned — keep the tile even if it was protected
        captureSystem();                         // the Void Citadel becomes YOURS, intact
      }
    } else {
      if (!state.citadelCd) state.citadelCd = {};
      state.citadelCd[zone] = Date.now() + 15 * 60 * 1000;
    }
    if (window.UI) window.UI.siegeEvent('citadeldown', {});
    buildBlueprintDropFromCitadel(zone);     // ultra-rare Oblivion-class blueprint
    save();
  }
  function updateSiege(dt) {
    const s = rt.siege; if (!s || !s.active) return;
    if (s.spawnT > 0) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        if (s.pendingBoss) { spawnSiegeBoss(); s.bossSpawned = true; s.pendingBoss = false; }
        else spawnWave(s.wave);
      }
      return;
    }
    const living = livingEnemies();
    if (living > 0) return;
    // current wave cleared
    if (s.bossSpawned) { captureSystem(); return; }
    if (s.wave < s.total) {
      s.wave++; s.spawnT = 1.2;
      if (window.UI) window.UI.siegeEvent('wave', s);
    } else if (s.boss) {
      s.pendingBoss = true; s.spawnT = 1.6;
      if (window.UI) window.UI.siegeEvent('boss', s);
    } else {
      captureSystem();
    }
  }
  // WAVE ZONE runner — mirrors the siege engine but loops endlessly for farming:
  // 25 extreme-density waves → a boss (30% Super) → restart. The boss pays out via
  // the normal onKill path (Super Boss = premium loot table + resource bounty).
  function updateWaveZone(dt) {
    const s = rt.waves; if (!s || !s.active) return;
    // SIEGE CLOCK — runs whenever the PvP target is on the field. Escort waves
    // are untimed (bossSpawned is false), and a two-phase citadel siege gets a
    // fresh 60s for the fortress after their fleet goes down.
    if (s.timed && s.bossSpawned) {
      s.limitT = (s.limitT == null) ? s.timed : s.limitT - dt;
      if (s.limitT <= 0) { failTimedSiege(s); return; }
    }
    if (s.spawnT > 0) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        if (s.pendingBoss) { if (s.clone) spawnCloneBoss(s.cloneScore, s.cloneDef, s.maxRatio); else if (s.citadel) spawnCitadel(s); else if (s.dread) spawnDreadnaught(s.tier); else if (s.mech) spawnMechBoss(s.tier); else spawnBoss({ super: s.super }); s.bossSpawned = true; s.pendingBoss = false; }
        else spawnWave(s.wave, s.dread ? (1.3 + Math.min(1.3, s.wave * 0.045)) : s.mech ? (1.25 + Math.min(1.2, s.wave * 0.04)) : 1.8); // dread + mech density ramp each wave
      }
      return;
    }
    if (livingEnemies() > 0) return;
    if (s.bossSpawned) {
      if (s.dread) {
        // DREADNAUGHT DOWN — hand off to the hunt module (cores + weekly lock), tow home.
        s.active = false; rt.waves = null;
        if (window.DREAD && window.DREAD.onHuntCleared) { try { window.DREAD.onHuntCleared(s.tier); } catch (x) {} }
        state.dreadRun = null;
        respawnAt(0);
        return;
      }
      if (s.mech) {
        // MECH TIER BOSS DOWN — settle before the tow home. The payout is written
        // synchronously inside onRunCleared, so an awarded core total never depends
        // on the player happening to reload.
        const _t = s.tier;
        s.active = false; rt.waves = null;
        state.mechRun = null;
        if (window.MECHF && window.MECHF.onRunCleared) { try { window.MECHF.onRunCleared(_t); } catch (x) {} }
        respawnAt(0);
        // Back to the Foundry, not the empty arena. Deferred one tick so the tow
        // home finishes first and the screen switch is not fighting resetZone().
        setTimeout(() => { try { if (window.UI && window.UI.showScreen) window.UI.showScreen('mech'); } catch (x) {} }, 60);
        return;
      }
      if (s.clone) {
        if (s.thenCitadel) {
          // CLONE FLEET DOWN — the citadel behind it powers up. Phase 2 begins.
          s.clone = false; s.thenCitadel = false; s.citadel = true;
          s.bossSpawned = false; s.pendingBoss = true; s.spawnT = 2.4; s.graceT = null; s.limitT = null;
          // TAKE, not raze, once the defender is a PLAYER's fortress — it changes
          // hands whole now, so the prompt must not promise rubble.
          if (window.UI) { const _v = s.playerCit ? 'TAKE THE CITADEL' : 'RAZE THE CITADEL';
            window.UI.siegeEvent('citadel', s); window.UI.unlockToast(s.timed ? '⚔ Their fleet is down — ' + _v + ' in ' + s.timed + 's' : '⚔ Their fleet is down — now ' + _v); }
          return;
        }
        // ENEMY CLONE FLEET DOWN — the zone flips to you.
        const ct = s.claimTile; s.active = false; rt.waves = null;
        if (s.plainTake) { rt.razingClaim = true; captureSystem(); }
        else captureCitadel(ct);
        return;
      }
      if (s.citadel) {
        // CITADEL RAZED — a short grace to vacuum the loot, then tow home.
        s.graceT = (s.graceT == null) ? 3.4 : s.graceT - dt;
        if (s.graceT <= 0) { s.active = false; respawnAt(0); if (window.UI) window.UI.siegeEvent('citadelhome', {}); }
        return;
      }
      // gauntlet complete — reset and run it again
      s.wave = 1; s.bossSpawned = false; s.pendingBoss = false; s.super = false; s.spawnT = 2.2;
      if (window.UI) window.UI.siegeEvent('wavezone', { kind: 'clear' });
      return;
    }
    if (s.wave < s.total) {
      s.wave++; s.spawnT = 0.9;
      if (window.UI && (s.wave % 5 === 0 || s.wave === s.total)) window.UI.siegeEvent('wave', s);
    } else {
      s.super = !s.citadel && Math.random() < 0.30; // final wave → boss (30% Super)
      s.pendingBoss = true; s.spawnT = 1.6;
      if (window.UI) window.UI.siegeEvent(s.citadel ? 'citadel' : 'boss', s);
    }
  }

  // TIME UP — the DEFENDER WINS. Their fleet survived the window, so it stays on
  // the field holding the tile; nothing is deleted. The attacker is the one who
  // leaves: spawns stop, the gauntlet ends, and they're towed out under
  // invulnerability so running out the clock can never become a shipwreck.
  function failTimedSiege(s) {
    const k = s.claimTile || state.currentSystem, tile = sysAt(k);
    s.active = false; rt.waves = null;
    rt.nodes = [];                                   // stop further escort spawns
    if (rt.archer) rt.archer.invuln = 6;             // the defender may still be firing
    // NO COOLDOWN ON A FAILED ASSAULT. This stamped 15 minutes on the tile, which
    // meant being pushed out locked the tile for you AND for every other pilot —
    // the defender was rewarded with a shield for a fight they were already
    // winning. Losing costs you the entry resources and the time; it must not
    // cost everyone else their shot at the tile.
    rt._towVoid = !!(tile && tile.void && !tile.casino);  // tow back to the right screen
    rt._towCasino = !!(tile && tile.casino);              // a House Citadel → the casino floor
    rt.towT = 3.0;
    burst(rt.archer.x, rt.archer.y, '#8fb7d9', 30, { speed: 200, life: 0.9 });
    pushFeed('The defence held on ' + ((tile || {}).name || 'the tile') + ' — you were pushed out');
    // tell the world the defender won — nothing else can see this happen
    try { if (window.TERRITORY && window.TERRITORY.logRepelled) window.TERRITORY.logRepelled(k); } catch (e) {}
    if (window.UI) window.UI.siegeEvent('timeout', { tile: k, sys: tile });
    save();
  }

  // ---- CITADEL INHERITANCE --------------------------------------------------
  // Answers one question for every capture flow: was there a fortress on this
  // tile, and at what rank. Nothing here razes, resets or downgrades — the only
  // outcomes are "you now hold it at rank N" or "there was nothing to hold".
  //
  //   NATURAL fortress (t.citadel)  → no state.citadels entry: its multiplier is
  //                                   baked into t.rate, and an entry would pay it
  //                                   twice (see ship-panels.js).
  //   VOID spire (t.void)           → fixed rank-1 entry, as before.
  //   A RIVAL PLAYER's citadel      → entry at the rank they actually built,
  //                                   resolved through citadelRankOf() and both
  //                                   local mirrors, never a flat Rank 1.
  // A captured fortress deliberately ignores the build cap: it was won, not built.
  function inheritCitadel(id, tile) {
    if (!id) return;
    tile = tile || sysAt(id) || {};
    if (!state.citadels) state.citadels = {};
    const mirror = (state.rivalCitadels && state.rivalCitadels[id]) || null;
    const real = (rt.realTiles && rt.realTiles[id]) || null;
    const rk = (() => { try { return citadelRankOf(id) || null; } catch (e) { return null; } })();
    const hadRival = !!(mirror || (real && (real.citadel || real.citadelLv)));
    if (state.rivalCitadels) delete state.rivalCitadels[id];
    if (tile.void) {
      if (!state.citadels[id]) state.citadels[id] = { score: Math.round(score() * citadelDefenseMult(3)), builtAt: Date.now(), lv: 1, void: true };
      return;
    }
    if (tile.citadel) return;                       // natural fortress: paid through t.rate
    if (!hadRival) return;                          // plain tile — nothing to inherit
    const lv = Math.max(1, Math.min(CITADEL_LV_MAX,
      (rk && rk.lv) || (mirror && mirror.lv) || (real && real.citadelLv) || 1));
    const cur = state.citadels[id];
    if (cur && (cur.lv || 1) >= lv) return;         // already yours at that rank or better
    state.citadels[id] = { score: Math.round(score() * citadelDefenseMult(lv)),
                           builtAt: (cur && cur.builtAt) || Date.now(), lv, captured: true };
    bumpLife('cits', 1);
    pushFeed('You seized the Rank ' + lv + ' citadel on ' + (tile.name || 'a system') + ' — intact, under your flag');
  }

  function captureSystem() {
    const k = state.currentSystem, tile = sysAt(k);
    if (!tile) { rt.siege = null; return; }
    // KAEVITH INCURSION — roll FIRST, before any early return below. Clearing the
    // zone is what earns the technology, so the roll must not depend on the tile
    // being annexable: it fires at the tile cap, on a re-clear of a tile you
    // already hold, and on a claim you go on to lose in the server race.
    const xenRoll = xenTechRoll(tile);
    if (xenRoll && window.UI && window.UI.xenTechResult) window.UI.xenTechResult(xenRoll, tile);
    // You just razed a citadel on this tile → the claim is earned; don't let a
    // stale server protection (the old owner's fortress) hand the tile back.
    const razing = !!rt.razingClaim; rt.razingClaim = false;
    const fromRival = rivalOf(k);
    // BACKSTOP — warp() gates this, but a VIP level can lapse (or another claim can
    // land) mid-siege. Never silently exceed the cap: the win stands, the tile just
    // isn't annexed until room is made.
    if (!isOwned(k) && isGalaxyTile(k) && atTileCap()) {
      pushFeed('Empire at capacity (' + tileCap() + ' systems) — ' + (tile.name || k) + ' was not claimed. Abandon a system to make room.', true);
      rt.razingClaim = false;
      respawnAt(0);
      if (window.UI) window.UI.refreshAll();
      return;
    }
    accrueResources();   // settle earnings BEFORE ownership changes — new rate applies from now
    state.ownedSystems[k] = true;
    // Runtime-only claim stamp — reconcilePhantoms() needs to know this tile was
    // taken AFTER the in-flight pull was snapshotted. Never persisted: it is a
    // fact about this session, not about the account.
    (rt._claimAt || (rt._claimAt = {}))[k] = Date.now();
    clusterBust();       // the block this tile just joined pays from this moment, not 250ms later
    // THE FORTRESS COMES WITH THE TILE. ONE CHOKE POINT, NO EXCEPTIONS.
    // Every path that flips a tile to you ends here — the ordinary siege, the
    // clone-fleet turf war, the Void citadel assault, a razing claim — so the
    // citadel is inherited HERE rather than in the individual callers. It used to
    // be inherited only in captureCitadel(), so a tile won through the generic
    // siege path (the common case in My Galaxy: the server row carries the rival's
    // citadel but the local waves object never set playerCit) handed the winner a
    // plain tile and quietly deleted a Rank 5 fortress. Winning a citadel now
    // always means OWNING that citadel, at the rank it was built to.
    inheritCitadel(k, tile);
    // your fresh capture is attack-shielded for 24 h
    if (!state.tileCd) state.tileCd = {};
    state.tileCd[k] = Math.max(state.tileCd[k] || 0, Date.now() + 24 * 3600 * 1000);
    if (state.rivalTiles) delete state.rivalTiles[k];
    pushFeed(fromRival ? ('You took ' + tile.name + ' from ' + fromRival) : ('You captured ' + tile.name));
    try { if (window.MAIL) window.MAIL.tileWon(tile.name, fromRival, razing, k); } catch (e) {}
    // REAL turf war: stake the claim on the shared server (server-authoritative,
    // atomic). If several operators raced for this tile, FIRST claim wins —
    // a rejected claim means we lost the race and must give the tile back.
    if (window.TERRITORY && window.TERRITORY.enabled()) {
      window.TERRITORY.claim(k, window.TERRITORY.myName(), 1440, (tile.void || tile.citadel) ? { citadel: true, citadelLv: citadelLevel(k) || 1, fleetScore: Math.round(score()), force: razing, defense: defenseSnapshot() } : razing ? { citadel: false, fleetScore: Math.round(score()), force: true, defense: defenseSnapshot() } : { fleetScore: Math.round(score()), defense: defenseSnapshot() }).then((res) => {
        if (!rt.realTiles) rt.realTiles = {};
        if (res.ok && res.row) {
          rt.realTiles[k] = { ownerId: res.row.owner_id, ownerName: res.row.owner_name, cooldownUntil: res.row.cooldown_until, citadel: !!res.row.citadel, citadelLv: (res.row.citadel_lv | 0) || citadelLevel(k) || 0, fleetScore: res.row.fleet_score || 0, defense: res.row.defense || null };
        } else if (!razing && res.reason && /protected|cooldown/i.test(res.reason)) {
          // RACE LOST — another operator sealed the claim first (never for a
          // citadel you just razed — that tile is yours by conquest)
          delete state.ownedSystems[k];
          if (state.citadels && state.citadels[k]) delete state.citadels[k];   // drop any just-granted citadel too — no ghost fortress on a lost race
          pushFeed('Beaten to ' + tile.name + ' — another operator sealed the claim first', true);
          try { if (window.MAIL) window.MAIL.raceLost(tile.name, (rt.realTiles[k] || {}).ownerName, k); } catch (e) {}
          if (window.UI) window.UI.unlockToast('⚔ Race lost — ' + tile.name + ' was claimed seconds before you');
          save();
        }
        if (window.UI) window.UI.galaxyChanged();
      });
    }
    rt.siege = null;
    // boss tiles pay out the rare void/eternal loot table on capture
    if (tile.boss) bossSystemLoot(tile);
    applyTileMults(tile);
    // TERRITORY SECURED — stop all spawns, give the magnet a moment to vacuum
    // the spoils, then tow the player home to the hangar.
    rt.waves = null;
    rt.nodes = [];
    rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9;
    rt._towVoid = !!(tile.void && !tile.casino);   // route the post-capture tow back to the right screen
    rt._towCasino = !!tile.casino;                 // a House Citadel → the casino floor
    if (tile.void) bumpLife('voidTiles', 1);          // WARDEN OF THE VOID badge
    rt.towT = 3.0;
    burst(rt.archer.x, rt.archer.y, '#5bc06b', 40, { speed: 240, life: 1.0, glow: true });
    if (window.UI) { window.UI.siegeEvent('captured', { sys: tile, fromRival: fromRival, full: false }); window.UI.refreshAll(); }
    save();
  }
  // Boss-system loot: 50% Void @~90% level, 10% Eternal @~50%, 1% Eternal @level
  function bossSystemLoot(sys) {
    const VOID = 9, ETERNAL = 10;
    const lvl = Math.max(1, sys.diff);
    const rcap = Math.min(10, C.rarityCap(lvl) + 1); // ring-gated — no Void drops from ring-1 boss tiles
    const drops = [];
    if (Math.random() < 0.50) drops.push(I.generate(Math.max(1, Math.round(lvl * 0.9)), Math.min(rcap, VOID)));
    if (Math.random() < 0.10) drops.push(I.generate(Math.max(1, Math.round(lvl * 0.5)), Math.min(rcap, ETERNAL)));
    if (Math.random() < 0.01) drops.push(I.generate(lvl, Math.min(rcap, ETERNAL)));
    drops.forEach((it, i) => {
      state.itemsFound++; countRareFind(it);
      const a = Math.PI * 2 * (i / Math.max(1, drops.length)), r = 24 + Math.random() * 20;
      rt.ground.push(new E.GroundItem(rt.archer.x + Math.cos(a) * r, rt.archer.y + Math.sin(a) * r, it, false));
      lootBurst(rt.archer.x, rt.archer.y, it.rarity);
      if (window.UI) window.UI.onLoot(it, true);
    });
  }

  // ---- RESOURCES (per-hour, offline-capped) --------------------------------
  // ===========================================================================
  // PLAYER CITADELS — build a fortress on an owned tile for 10× resources. Cost
  // scales hard with depth; cap of 5. Rival citadels are attackable — you fight a
  // CLONE scaled to the owner's fleet score and take the citadel on victory.
  // ===========================================================================
  const CITADEL_MULT = 10, CITADEL_LV_MAX = 5;
  // ---- THE TILE CAP ---------------------------------------------------------
  // ONE ceiling on empire size: how many systems you may HOLD at once — citadels
  // or not, galaxy or Void. This used to be a CITADEL cap, which limited what you
  // could BUILD while leaving the number of tiles you could take unbounded; the
  // intent was always a limit on territory. Citadels are now free to raise on any
  // tile you hold, because holding the tile is itself the scarce thing.
  const TILE_MAX = 50;
  function tileCap() { return TILE_MAX + (window.VIP ? window.VIP.level() * 5 : 0) + proMods().tiles; }
  // GALAXY GROUND ONLY — THE CAP IS A GALAXY MAP RULE.
  //
  // Void spires ('VZ…') and the casino House Citadels ('CC…') are stored in
  // `ownedSystems` alongside real hexes, so each one was burning a slot out of
  // the 50. Worse than the arithmetic: once the total reached the cap, warp()
  // refused EVERY trip — including the trip into a Void spire, which is not
  // galaxy ground and was never meant to be capped. That is the reported "can't
  // attack any void zones, just says Warp Failed for all of them even tho they
  // have no shield": the refusal was the tile cap wearing the wrong label.
  //
  // The test is the one citadelCount() already uses — an off-map id does not
  // parse as hex coordinates — so the cap, the fortress total and the build
  // sheet cannot disagree about what counts as a system. Home is neutral ground
  // and has never counted. Derived, so no save changes shape, and it only ever
  // FREES capacity: no pilot loses a holding and anyone who was wedged at the
  // cap gets their real headroom back on next load.
  function isGalaxyTile(k) {
    if (!k || k === GX.HOME || !GX.parseId(k)) return false;
    const t = sysAt(k);
    return !(t && t.home);
  }
  function tileCount() {
    let n = 0;
    for (const k in (state.ownedSystems || {})) {
      if (!state.ownedSystems[k]) continue;
      if (!isGalaxyTile(k)) continue;
      n++;
    }
    return n;
  }
  function tilesLeft() { return Math.max(0, tileCap() - tileCount()); }
  function atTileCap() { return tileCount() >= tileCap(); }
  // legacy alias — older screens still read citadelCap()
  function citadelCap() { return tileCap(); }
  // CITADEL RANK ON A TILE — one answer for every case the UI has to draw:
  // yours, a rival's, or an unclaimed natural fortress. Returns null when the
  // tile has no citadel at all.
  //   kind  'mine' | 'rival' | 'natural'
  //   lv    1..5 (0 = a fortress whose rank we cannot see — rival on an old row)
  //   mult  resource multiplier this rank is worth
  //   def   % defence bonus the rank grants its holder
  function citadelRankOf(id) {
    const t = sysAt(id); if (!t) return null;
    const CMAX = CITADEL_LV_MAX;
    if (isOwned(id) && hasMyCitadel(id)) {
      const lv = Math.max(1, citadelLevel(id));
      return { kind: 'mine', lv, max: CMAX, mult: CITADEL_MULT * lv, def: Math.round((citadelDefenseMult(lv) - 1) * 100), natural: !!t.citadel };
    }
    if (isOwned(id) && t.citadel) {
      // A natural fortress is seeded at full strength — it IS the top rank, which
      // is why it pays ×1000 with no builds. Report it as Rank 5, never unknown.
      return { kind: 'natural', owned: true, lv: CMAX, max: CMAX, mult: GX.CITADEL_RATE_MULT || 1000, def: 0, natural: true };
    }
    const real = rt.realTiles && rt.realTiles[id];
    const my = realMyUid();
    if (real && real.citadel && !(my && real.ownerId === my)) {
      // An unreported rank on a NATURAL fortress is still a full-strength one.
      const lv = Math.max(0, real.citadelLv | 0) || (t.citadel ? CMAX : 0);
      return { kind: 'rival', lv, max: CMAX, owner: real.ownerName || 'a rival',
        mult: lv ? CITADEL_MULT * lv : 0, def: lv ? Math.round((citadelDefenseMult(lv) - 1) * 100) : 0, natural: !!t.citadel };
    }
    if (!isOwned(id) && state.rivalCitadels && state.rivalCitadels[id] != null) {
      const rc = state.rivalCitadels[id];
      const lv = Math.max(0, (rc && rc.lv) | 0) || (t.citadel ? CMAX : 0);
      return { kind: 'rival', lv, max: CMAX, owner: rivalOf(id) || 'a rival',
        mult: lv ? CITADEL_MULT * lv : 0, def: lv ? Math.round((citadelDefenseMult(lv) - 1) * 100) : 0, natural: !!t.citadel };
    }
    if (t.citadel) return { kind: 'natural', owned: false, lv: CMAX, max: CMAX, mult: GX.CITADEL_RATE_MULT || 1000, def: 0, natural: true };
    return null;
  }

  // Every system you hold, richest first — backs the My Systems pill in My
  // Galaxy. Revenue is per-hour in the same units resourceRates() reports.
  function ownedSystemList() {
    const out = [];
    Object.keys(state.ownedSystems || {}).forEach((id) => {
      if (!isOwned(id)) return;                     // drops stale local flags
      const t = sysAt(id); if (!t) return;
      const lv = citadelLevel(id);
      const natural = !!t.citadel;
      let rate = 0, res = t.resource || 'fuel', pays = null;
      if (t.void) {
        const vr = t.rate * 25;
        rate = vr; res = 'all';
        pays = { fuel: vr, iron: vr, plasma: vr, gold: vr * 1000 };
      } else {
        rate = t.rate * (t.deep ? GX.DEEP_MULT.resource : 1) * (lv ? CITADEL_MULT * lv : 1) * 25;
        pays = { [res]: rate };
      }
      out.push({
        id, name: t.name || id, ring: t.ring | 0, level: t.level | 0,
        home: !!t.home, deep: !!t.deep, voidTile: !!t.void, xen: !!t.xen,
        citadelLv: lv, naturalCitadel: natural,
        resource: res, rate: Math.round(rate), pays,
        active: state.currentSystem === id,
        cooldown: tileCooldownLeft(id),
      });
    });
    out.sort((a, b) => (b.voidTile - a.voidTile) || (b.rate - a.rate));
    return out;
  }

  // NEUTRAL GRACE — a tile YOU released is off the board for the rival sim. The
  // sim already treats a shielded tile as untouchable, but abandoning clears the
  // shield, so a bot could take a tile you had just given up on the next 6-minute
  // galaxy tick, or on the next load through seedRivals(). This blocks the SIM
  // only: you (and real players) can claim the tile back immediately.
  // Self-pruning — an expired entry is dropped the first time it is read.
  const FREE_GRACE_MS = 24 * 3600 * 1000;
  // ABANDON LOCKOUT — how long the pilot who WALKED AWAY is barred from taking the
  // same tile back. Deliberately the same 24 hours as the contest shield, because
  // that shield is the thing it exists to protect.
  //
  // WHY THIS HAS TO EXIST. Abandoning clears state.tileCd[id] — the tile stops
  // being contested because nobody owns it. So a pilot under siege, or sitting on
  // a shield about to expire, could abandon and immediately re-claim to hand
  // themselves a fresh 24-hour shield, keep the citadel rank, and pay only the
  // entry cost. The grace period meant to protect a released tile from bots was
  // being used as a free reset by its own former owner.
  //
  // Only the abandoning account is blocked. Rivals and real players can move in
  // straight away, which is the entire point of walking away from a system.
  const ABANDON_LOCK_MS = 24 * 3600 * 1000;
  function abandonLockLeft(id) {
    const m = state.tileAband; if (!m) return 0;
    const t = m[id]; if (!t) return 0;
    if (t <= Date.now()) { delete m[id]; return 0; }
    return Math.max(0, Math.ceil((t - Date.now()) / 1000));
  }
  function simBlocked(id) {
    const m = state.tileFree; if (!m) return false;
    const t = m[id]; if (!t) return false;
    if (t <= Date.now()) { delete m[id]; return false; }
    return true;
  }
  // ABANDON — walk away from a tile you own: ownership, its citadel and its
  // production all release; the tile goes neutral (server claim released too).
  function abandonTile(id) {
    if (!isOwned(id)) return { ok: false, reason: 'owned' };
    const t = sysAt(id); if (!t || t.home) return { ok: false, reason: 'home' };
    accrueResources();   // settle earnings up to the abandon
    const hadCit = !!(state.citadels && state.citadels[id]);
    delete state.ownedSystems[id];
    if (state.citadels) delete state.citadels[id];
    if (state.tileCd) delete state.tileCd[id];
    clusterBust();       // releasing a tile can SPLIT a block — re-derive before anything reads a rate
    if (!state.tileFree) state.tileFree = {};
    state.tileFree[id] = Date.now() + FREE_GRACE_MS;
    // THE 24-HOUR LOCKOUT ON THE PILOT WHO LEFT. Recorded on every abandon, not
    // only on citadel tiles: the shield reset is worth exploiting on a bare tile
    // too, and a rule that applies sometimes is a rule players have to guess at.
    if (!state.tileAband) state.tileAband = {};
    state.tileAband[id] = Date.now() + ABANDON_LOCK_MS;
    if (state.currentSystem === id) state.currentSystem = null;
    try { if (window.TERRITORY && window.TERRITORY.enabled() && window.TERRITORY.release) window.TERRITORY.release(id); } catch (e) {}
    if (rt.realTiles && rt.realTiles[id]) delete rt.realTiles[id];
    save(); if (window.UI) window.UI.galaxyChanged();
    return { ok: true, hadCit, lockH: Math.round(ABANDON_LOCK_MS / 3600000) };
  }
  // GALAXY CITADELS ONLY. Void spires and the casino House Citadels are `void`
  // holdings stored in the same map (`VZ1`…, `CC1`…, ids that do not parse as hex
  // coordinates), and inheritCitadel() writes a citadel record for every one of
  // them — so the fortress count on the build sheet and the Ranks board counted
  // the Void as galaxy ground. It is a different feature with its own screen:
  // "Void zone shouldn't count towards your citadels". Derived, so nothing is
  // written and no save changes shape.
  function citadelCount() {
    const c = state.citadels || {};
    let n = 0;
    for (const id in c) {
      if (!c[id]) continue;
      if (c[id].void || !GX.parseId(id)) continue;   // off-map: Void spire / House Citadel
      n++;
    }
    return n;
  }
  function hasMyCitadel(id) { return !!(state.citadels && state.citadels[id]); }
  // Citadel RANK (1..5). Each rank multiplies output (10× per rank), raises the
  // published defending fleet score (+25%/rank), and hardens it vs the rival sim.
  function citadelLevel(id) { const c = state.citadels && state.citadels[id]; return c ? (c.lv || 1) : 0; }
  function citadelOutputMult(id) { const lv = citadelLevel(id); return lv ? CITADEL_MULT * lv : 1; }
  function citadelDefenseMult(lv) { return 1 + 0.25 * (Math.max(1, lv) - 1); }
  function citadelBuildCost(id) {
    const t = sysAt(id); if (!t) return null;
    // ~100 days of THIS tile's production (Jul 2026: ×10 economy pass) — proportional, never astronomical.
    const HRS = 100 * 24;
    // COST PARITY: anchor to the tile's UN-boosted yield — a natural ⛴ tile's
    // baked ×1000 must never make citadel build/upgrade prices 1000× a player's.
    const baseR = (t.rate || 20) / (t.citadel ? ((GX && GX.CITADEL_RATE_MULT) || 1000) : 1);
    const rate = Math.max(20, baseR * (t.deep ? GX.DEEP_MULT.resource : 1));
    const base = Math.round(rate * HRS);
    const main = t.resource || 'fuel';
    const cost = { fuel: 0, iron: 0, plasma: 0 };
    cost[main] = base;
    ['fuel', 'iron', 'plasma'].forEach((k) => { if (k !== main) cost[k] = Math.round(base * 0.35); });
    return cost;
  }
  function canBuildCitadel(id) {
    const t = sysAt(id);
    // no separate citadel ceiling — the tile cap is the only limit on the empire
    return !!(t && !t.home && !t.void && !t.citadel && isOwned(id) && !hasMyCitadel(id));
  }
  // RANK-UP cost: upgrading rank L → L+1 costs the tile's build cost × L,
  // so each rank is a real investment (1×, 2×, 3×, 4× the build price).
  function citadelUpgradeCost(id) {
    const tv = sysAt(id); if (tv && tv.void) return null;   // void citadels are FIXED — no upgrades
    const lv = citadelLevel(id);
    if (!lv || lv >= CITADEL_LV_MAX) return null;
    const bc = citadelBuildCost(id); if (!bc) return null;
    const cost = {};
    Object.keys(bc).forEach((k) => { cost[k] = bc[k] * lv; });
    return cost;
  }
  function upgradeCitadel(id) {
    if (!isOwned(id)) return { ok: false, reason: 'owned' };   // only YOUR tiles upgrade
    if (!hasMyCitadel(id)) return { ok: false, reason: 'none' };
    const c = state.citadels[id];
    const lv = c.lv || 1;
    if (lv >= CITADEL_LV_MAX) return { ok: false, reason: 'max' };
    const cost = citadelUpgradeCost(id);
    if (!canAfford(cost)) return { ok: false, reason: 'resources' };
    accrueResources();   // settle at the old rank's rate before the new rank kicks in
    state.resources.fuel -= cost.fuel || 0; state.resources.iron -= cost.iron || 0; state.resources.plasma -= cost.plasma || 0;
    c.lv = lv + 1;
    // harder to take over: republish a rank-boosted defending fleet score
    c.score = Math.round(score() * citadelDefenseMult(c.lv));
    if (window.TERRITORY && window.TERRITORY.enabled()) { try { window.TERRITORY.claim(id, window.TERRITORY.myName(), 1440, { citadel: true, citadelLv: c.lv, fleetScore: c.score, defense: defenseSnapshot() }); } catch (e) {} }
    pushFeed('Your Citadel on ' + ((sysAt(id) || {}).name || 'a system') + ' reached Rank ' + c.lv);
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, lv: c.lv };
  }
  function buildCitadel(id) {
    if (!isOwned(id)) return { ok: false, reason: 'owned' };
    if (hasMyCitadel(id)) return { ok: false, reason: 'exists' };
    const cost = citadelBuildCost(id);
    if (!canAfford(cost)) return { ok: false, reason: 'resources' };
    accrueResources();   // settle at the old rate — the 10× starts NOW, not retroactively
    state.resources.fuel -= cost.fuel; state.resources.iron -= cost.iron; state.resources.plasma -= cost.plasma;
    state.citadels[id] = { score: Math.round(score()), builtAt: Date.now(), lv: 1 };
    bumpLife('cits', 1);                              // FORTRESS DYNASTY badge
    if (window.TERRITORY && window.TERRITORY.enabled()) { try { window.TERRITORY.claim(id, window.TERRITORY.myName(), 1440, { citadel: true, citadelLv: 1, fleetScore: state.citadels[id].score, defense: defenseSnapshot() }); } catch (e) {} }
    pushFeed('You raised a Citadel on ' + ((sysAt(id) || {}).name || 'a system'));
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true };
  }
  // The defending fleet score of a RIVAL player-citadel on this tile (or null).
  function rivalCitadelScore(id) {
    const real = rt.realTiles && rt.realTiles[id];
    const myUid = (window.TERRITORY && window.TERRITORY.enabled()) ? window.TERRITORY.myId() : null;
    if (real && real.citadel && !(myUid && real.ownerId === myUid)) return real.fleetScore || 1500;
    if (!isOwned(id) && state.rivalCitadels && state.rivalCitadels[id] != null) return state.rivalCitadels[id];
    return null;
  }
  // MONOLITH line — alliance siege hulls hit boss-class targets harder. Called
  // from entities.takeDamage so EVERY damage source (bolts, storm, aura, splash)
  // benefits. Citadels, zone bosses and event bosses all qualify.
  window.MONO_MULT = function (e) {
    try {
      const sh = C.SHIP_BY_KEY[state.ship], b = sh && sh.siegeBonus;
      if (!b) return 1;
      return (e.isBoss || e.citadel || e.isCitadel || e.superBoss || e.megaBoss) ? 1 + b : 1;
    } catch (err) { return 1; }
  };
  // Snapshot of MY fleet, published with every claim — rivals render it in the
  // tile sheet and their client spawns the CLONE defender from it.
  function defenseSnapshot() {
    const sh = C.SHIP_BY_KEY[state.ship] || {};
    const s = rt.stats || computeStats();
    return { ship: state.ship, nm: sh.name || 'Fleet', lvl: state.level | 0,
             asc: ascStars(),
             score: Math.round(score()), hp: Math.round(s.maxHp || 0), dps: Math.round(s.theoryDps || 0),
             esc: (typeof fleetShips === 'function' ? fleetShips().length : 0),
             escKeys: (typeof fleetShips === 'function' ? fleetShips().map((f) => f.key) : []) };
  }
  // The DEFENDING FLEET of any rival-held tile: real players publish a snapshot
  // with their claim; simulated rivals get a deterministic pseudo-fleet seeded
  // by the tile id, so the same tile always shows the same defender.
  function rivalDefense(id) {
    const real = rt.realTiles && rt.realTiles[id];
    const myUid = (window.TERRITORY && window.TERRITORY.enabled()) ? window.TERRITORY.myId() : null;
    // NEVER publish a garrison for a tile YOU hold. The uid comparison alone was
    // not enough: when TERRITORY is offline myUid is null, so `!(myUid && ...)`
    // passed and your own tile came back with a defending fleet. On a captured
    // natural citadel that was visible — the sheet's `else if (t.defense)` branch
    // runs BEFORE the owned-citadel branch, so the fortress panel that states the
    // ×1000 output was replaced by an enemy-garrison card, and the tile looked
    // like it was paying nothing it had promised.
    if (isOwned(id)) return null;
    if (real && (real.ownerId || real.ownerName) && !(myUid && real.ownerId === myUid)) {
      let d = real.defense || null;
      const sc0 = (d && d.score) || real.fleetScore || 0;
      if (!d || !d.ship) {
        // claim carries no snapshot (pre-defense claim / migration pending) —
        // reconstruct from the owner's PUBLIC leaderboard row so the panel and
        // the clone battle always show the REAL hulls that took the tile.
        let row = null;
        try { row = window.LEADERBOARD && window.LEADERBOARD.byName && window.LEADERBOARD.byName(real.ownerName); } catch (e) {}
        const fleet = (row && row._fleet && row._fleet.length) ? row._fleet.filter((k) => C.SHIP_BY_KEY[k]) : null;
        const sc = sc0 || (row && row.power) || Math.max(800, Math.round(score() * 0.8));
        const TIERS = ['battleship', 'carrier', 'supercarrier', 'titan', 'mothership'];
        const ship = (fleet && fleet[0]) || TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.floor(Math.log10(Math.max(10, sc)) - 3)))];
        d = { ship, nm: (C.SHIP_BY_KEY[ship] || {}).name || ship, lvl: (row && row.level) || 0, score: sc, hp: 0, dps: 0,
              esc: fleet ? Math.min(4, Math.max(0, fleet.length - 1)) : 0, escKeys: fleet ? fleet.slice(1, 5) : [], approx: !fleet };
      }
      return { name: real.ownerName || 'Rival', real: true, citadel: !!real.citadel,
               score: (d && d.score) || sc0 || Math.max(800, Math.round(score() * 0.8)), snap: d };
    }
    const nm = rivalOf(id);
    if (!nm || isOwned(id)) return null;
    // SIMULATED PILOT GARRISON — when the server roster is live a real simulated
    // pilot holds this tile (deterministic per tile id) instead of an anonymous
    // procedural rival. Same shape, same combat maths, and the tile sheet can
    // show who they are plus their ascension rank.
    try {
      if (window.SIMPILOTS && window.SIMPILOTS.enabled()) {
        const sp = window.SIMPILOTS.defenderFor(id);
        if (sp) return sp;
      }
    } catch (e) {}
    let h = 0; for (let i = 0; i < id.length; i++) h = ((h * 31 + id.charCodeAt(i)) >>> 0);
    const rnd = (h % 1000) / 1000;
    const t = sysAt(id);
    const HULLS = ['cruiser', 'battleship', 'dreadnought', 'carrier', 'supercarrier', 'titan', 'mothership'];
    const band = Math.min(HULLS.length - 1, Math.floor(((t ? t.ring : 5) / (GX.RINGS || 25)) * HULLS.length + rnd * 1.6));
    const ship = HULLS[band];
    const cit = !isOwned(id) && state.rivalCitadels && state.rivalCitadels[id] != null;
    const sc = cit ? state.rivalCitadels[id] : Math.max(400, Math.round(score() * (0.55 + rnd * 0.9)));
    const nEsc = (h >> 7) % 5;
    const escKeys = []; for (let i = 0; i < nEsc; i++) escKeys.push(HULLS[Math.max(0, band - 1 - (i % 2))]);
    return { name: nm, real: false, citadel: !!cit, score: sc,
             snap: { ship, nm: (C.SHIP_BY_KEY[ship] || {}).name || ship, lvl: Math.max(3, (t ? t.level : 10) + ((h >> 4) % 21) - 10), score: sc, hp: 0, dps: 0, esc: nEsc, escKeys } };
  }
  // CLONE FLAGSHIP boss — the EXACT visual replica of the fleet holding the
  // tile: THEIR flagship sprite, THEIR name, THEIR published ship score — and
  // their ESCORT hulls spawn alongside as real combatants, each drawn with its
  // own ship art. Beat the whole replica to take the zone.
  function spawnCloneBoss(cloneScore, def, maxRatio) {
    const pool = allowedEnemies(); const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.24;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isSuper = true; b.isClone = true;
    b.rivalOwned = true;         // another account's fleet — see DREAD.dmgVs
    // TRUE-POWER MATCHUP (see cloneMatchup). Previously this compared COMPRESSED
    // scores and set HP to "16s of theoryDps", so a defender four times your real
    // power read as twice and died in eleven seconds — which is why attacking
    // down, or even up, was a guaranteed win.
    const mu = cloneMatchup(cloneScore, maxRatio);
    const ratio = mu.ratio;
    const snap = def && def.snap;
    // (guard: snap may be missing entirely — a bare `snap && snap.escKeys || []`
    // chain left .slice() to crash the boss wave when a tile had no snapshot)
    const escKeys = ((snap && Array.isArray(snap.escKeys) && snap.escKeys) || []).filter((k) => k && C.SHIP_BY_KEY[k]).slice(0, 4);
    // the flagship holds ~70% of the replica's total strength; escorts the rest
    const escShare = escKeys.length ? 0.3 : 0;
    b.maxHp = b.hp = Math.max(15000, Math.round(mu.hp * (1 - escShare)));
    b.speed *= 0.5; b.size = 124; b.ranged = true; b.range = 520; b.fireCd = 1.4; b.fireT = 1.1;
    // sustained damage is set from the contract, not from the zone enemy base
    b.damage = Math.max(1, mu.dps * (1 - escShare) * b.fireCd);
    // FLEET SUSTAIN — a defending fleet runs shield repair and life support just
    // like yours. Zero when you outgun them, real when they outgun you: this is
    // what stops a weaker attacker chipping down a fortress fleet forever.
    setCloneRegen(b, ratio);
    if (snap && snap.ship) {
      const im = new Image(); im.src = 'ships/ship-' + snap.ship + '.png';
      b.spriteImg = im;                                   // render THEIR flagship
    }
    b.tint = '#ffce8a';
    b.name = ((def && def.name) ? def.name.toUpperCase() + "'S FLEET" : 'ENEMY CLONE FLEET') + ' · ⚡' + formatNum(cloneScore || 0);
    if (pushEnemy(b)) { rt.boss = b; rt.bossAlive = true; rt.superBossAlive = true; }
    // ESCORT REPLICAS — their real fleet hulls, flanking the flagship
    escKeys.forEach((key, i) => {
      const ex = cx + (i % 2 === 0 ? -1 : 1) * (150 + Math.floor(i / 2) * 90);
      const ey = cy + 70 + (i % 2) * 50;
      const e2 = new E.Enemy(type, state.currentDungeon, ex, ey);
      e2.isBoss = false; e2.isCloneEscort = true;
      e2.maxHp = e2.hp = Math.max(4000, Math.round(mu.hp * (escShare / escKeys.length)));
      e2.speed *= 0.65; e2.size = 62; e2.ranged = true; e2.range = 430; e2.fireCd = 1.9; e2.fireT = 0.7 + i * 0.4;
      e2.damage = Math.max(1, mu.dps * (escShare / escKeys.length) * e2.fireCd);
      e2.cloneRegen = Math.max(0, b.cloneRegen * (e2.maxHp / Math.max(1, b.maxHp))); e2.regenHold = 0;
      const im2 = new Image(); im2.src = 'ships/ship-' + key + '.png';
      e2.spriteImg = im2;
      e2.tint = '#ffce8a';
      e2.name = ((C.SHIP_BY_KEY[key] || {}).name || key) + ' ESCORT';
      pushEnemy(e2);
    });
    burst(cx, cy, '#ffce8a', 90, { speed: 360, life: 1.2, glow: true });
    if (window.UI) window.UI.bossEvent('super');
    // TELL THE PLAYER THE ODDS — the fight is honest, so the forecast can be too
    try {
      if (window.UI && window.UI.siegeEvent) {
        const pct = Math.round(ratio * 100);
        window.UI.siegeEvent('clone', {
          name: (def && def.name) || 'Enemy fleet',
          odds: mu.outmatched ? 'outmatched' : ratio < 0.75 ? 'favoured' : 'even',
          text: mu.outmatched
            ? 'THEIR FLEET IS ' + (ratio >= 2 ? Math.round(ratio) + '×' : pct + '% OF') + ' YOUR POWER — YOU WILL LOSE THIS TRADE'
            : ratio < 0.75 ? 'YOU OUTGUN THEM — PRESS THE ATTACK'
            : 'EVENLY MATCHED — THIS ONE IS DECIDED BY FLYING',
        });
      }
    } catch (e) {}
    return b;
  }
  // CLONE SUSTAIN — ticked from the main update loop
  function cloneTick(dt) {
    for (const e of rt.enemies) {
      if (!e || e.dead || e.dying || !e.cloneRegen) continue;
      if (e.regenHold > 0) { e.regenHold -= dt; continue; }   // suppressed while under fire
      if (e.hp >= e.maxHp) continue;
      e.hp = Math.min(e.maxHp, e.hp + e.cloneRegen * dt);      // absolute HP/s, pre-capped
    }
  }
  // Won a citadel siege — you TAKE the fortress, INTACT AND AT ITS FULL RANK
  // (Aug 2026). No citadel is ever destroyed by a siege any more.
  //
  // It used to change hands one rank lower, which quietly made the whole
  // structure worth attacking and never worth building: a Rank 5 fortress is
  // four rank-ups of fuel, iron and plasma on top of the build, and the pilot who
  // paid for all of it handed the winner a Rank 4. Taking it whole means the
  // investment survives the change of flag, and a maxed citadel is now the prize
  // it looks like rather than a consolation.
  function captureCitadel(id) {
    const t = sysAt(id) || {};
    const natural = !!t.citadel;   // a seeded fortress tile: its ×mult is baked into t.rate
    // THE RANK COMES ACROSS WITH THE FORTRESS. citadelRankOf() is the one resolver
    // that already knows every source of a rival's rank (the live server row, the
    // local rival mirror, and "an unreported rank on a NATURAL fortress is a full
    // one"), so the winner inherits what the loser actually built instead of the
    // Rank 1 the old inline fallback handed out whenever the mirror held a bare
    // score number.
    const rk = (() => { try { return citadelRankOf(id) || null; } catch (e) { return null; } })();
    const lv = Math.max(1, Math.min(CITADEL_LV_MAX,
      (rk && rk.lv) ||
      (state.rivalCitadels && state.rivalCitadels[id] && state.rivalCitadels[id].lv) ||
      (rt.realTiles && rt.realTiles[id] && rt.realTiles[id].citadelLv) || 1));
    // NOTHING IS DEMOLISHED. razeCitadelTile() used to run here "to strip natural
    // siege status", but it also stamps razedCitadels and divides the tile's rate
    // by CITADEL_RATE_MULT — permanently, and again on every load. Winning a
    // rival's natural fortress therefore handed the victor a plain tile worth a
    // hundredth of the prize they fought for. A won citadel changes hands whole.
    rt.razingClaim = true;                            // conquest earned — the tile is yours, no take-back
    captureSystem();                                  // claims the tile + inherits the fortress + tows home
    // THE ENTRY IS WRITTEN BY inheritCitadel(), inside captureSystem(). It used to
    // be written here, which is why only this one flow ever inherited a rank.
    if (natural) {
      bumpLife('cits', 1);                            // FORTRESS DYNASTY badge
      pushFeed('You seized the Citadel on ' + (t.name || 'a system') + ' — intact, under your flag');
    }
    // publish: the fortress still stands, at full rank, under YOUR flag now
    if (window.TERRITORY && window.TERRITORY.enabled()) { try { window.TERRITORY.claim(id, window.TERRITORY.myName(), 1440, { citadel: true, citadelLv: natural ? CITADEL_LV_MAX : lv, fleetScore: Math.round(score() * citadelDefenseMult(lv)), force: true, defense: defenseSnapshot() }); } catch (e) {} }
    save();
  }
  // Permanently demote a NATURAL citadel siege tile to a plain, buildable tile
  // once you've razed it. Mutates the shared tile cache so the map, rates, entry
  // logic and "build your own citadel" gate all immediately see a normal tile.
  // (silent=true when re-applying saved razings on load.)
  function razeCitadelTile(id, silent) {
    if (!id) return;
    if (!state.razedCitadels) state.razedCitadels = {};
    state.razedCitadels[id] = true;
    const t = sysAt(id);
    if (t && t.citadel) {
      t.citadel = false;
      t.type = t.resource ? 'resource' : 'combat';
      const mult = (GX && GX.CITADEL_RATE_MULT) || 100;
      t.rate = Math.max(3, Math.round((t.rate || 0) / mult)); // drop the 100× citadel yield
      if (typeof t.name === 'string') t.name = t.name.replace(/^Citadel\s+/, '');
    }
  }
  // RE-APPLY EVERY RAZING THIS ACCOUNT HAS ALREADY DONE.
  //
  // The tile cache is generated, not stored, so a razing has to be replayed onto
  // it whenever that cache is (re)built. It used to be replayed in exactly one
  // place — init() — while GX.grandfather() in sanitizeSave() DELETES cache
  // entries so they regenerate as the fortresses they were. adoptSave() (a cloud
  // CAS conflict folding another device's save into the live session) calls
  // sanitizeSave() and NOT init(), so a merged save that owns a razed natural
  // citadel had that tile regenerated at its full CITADEL_RATE_MULT (×1000) and
  // nothing ever demoted it again. accrueResources() then banked the inflated
  // rate for the rest of the session — a razed fortress still paying fortress
  // income, which is the reported "old citadels are still giving resources".
  //
  // It lives next to the razing itself now and runs from BOTH paths.
  // razeCitadelTile() is guarded on `t.citadel`, so replaying it is a no-op once
  // the tile is already demoted — calling it more often can only ever bring a
  // rate back DOWN to what the player actually earned, never take a holding away.
  function reapplyRazings() {
    const r = state.razedCitadels;
    if (!r) return;
    for (const id in r) { if (r[id]) razeCitadelTile(id, true); }
  }

  // ---- CONTIGUITY BONUS — a solid block of space beats a sprawl -------------
  //
  // Four or more of your systems TOUCHING each other pay a multiplier, on every
  // tile in the block, and it climbs with the size of the block. Holding ground
  // together is the whole strategic idea of a hex map and nothing rewarded it
  // before: a checkerboard of sixty tiles paid exactly what a sixty-tile empire
  // paid, so there was no reason to ever fight for the tile next to you.
  //
  // IT WRITES NOTHING, AND THAT IS THE POINT. Every tier is derived from
  // `ownedSystems`, which the save already carries — no new key, no migration,
  // no `mergeSaves()` union block, nothing owed to `ASC_KEEP`. An old save lands
  // on its correct tier the first time this runs and a newer save is not touched.
  // It also only ever GRANTS: every multiplier is >= 1, so no holding on any
  // account can be worth less after this shipped than it was before.
  //
  // VOID TILES CANNOT JOIN A BLOCK, and that is not a special case — their ids
  // ('VZ1'…) do not parse as hex coordinates, so they are not on this graph at
  // all. The HOME CITADEL is excluded deliberately: it is neutral ground that
  // every account holds, so counting it would hand everybody a free member and
  // quietly turn "4 touching" into three.
  const CLUSTER_TIERS = [
    { need: 50, mult: 3.0, add: 200, name: 'DOMINION', color: '#ff8a3d' },
    { need: 30, mult: 2.5, add: 150, name: 'HEGEMONY', color: '#c26bff' },
    { need: 10, mult: 2.2, add: 120, name: 'COMPACT',  color: '#5fd1ff' },
    { need: 4,  mult: 2.0, add: 100, name: 'CLUSTER',  color: '#7ce0a0' },
  ];
  function clusterTierFor(size) {
    for (let i = 0; i < CLUSTER_TIERS.length; i++) if (size >= CLUSTER_TIERS[i].need) return CLUSTER_TIERS[i];
    return null;
  }
  // Connected components of owned tiles over the hex grid, memoised.
  //
  // WHY THE CACHE IS TIME-GATED RATHER THAN CHECKED EVERY CALL: tileRateOf() is
  // called once per owned tile by resourceRates(), so validating the cache inside
  // it would make a 1,000-tile empire hash its own key set a thousand times per
  // sum. The gate re-validates at most four times a second — a capture shows its
  // new multiplier within a quarter second, which is under the time it takes the
  // screen to repaint — and clusterBust() makes it immediate for the write paths
  // that care. The validity test is the owned COUNT plus an order-independent
  // checksum of the ids, so swapping one tile for another is caught too.
  // `_shdMemo` is the SIEGE-SHIELD memo (see tileShield below) and is declared up
  // here on purpose: clusterBust() clears it, and a `let` is in the temporal dead
  // zone until its declaration RUNS — declaring it lower down would leave that
  // reference dependent on call order rather than on scope.
  let _cluCache = null, _cluAt = 0, _shdMemo = null, _shdAt = 0, _blocMemo = null, _blocAt = 0;
  function clusterBust() { _cluCache = null; _cluAt = 0; _shdMemo = null; _blocMemo = null; }
  function clusterSizes() {
    const now = Date.now();
    if (_cluCache && now - _cluAt < 250) return _cluCache.map;
    const owned = state.ownedSystems || {};
    let n = 0, h = 0;
    for (const k in owned) {
      if (!owned[k]) continue;
      n++;
      let x = 0;
      for (let i = 0; i < k.length; i++) x = (x * 31 + k.charCodeAt(i)) | 0;
      h = (h + x) | 0;
    }
    _cluAt = now;
    if (_cluCache && _cluCache.n === n && _cluCache.h === h) return _cluCache.map;
    const map = {}, seen = {}, comps = [], cid = {};
    for (const start in owned) {
      if (!owned[start] || seen[start] || start === GX.HOME) continue;
      if (!GX.parseId(start)) continue;                 // void tiles are not on the grid
      const comp = [], stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        const c = GX.parseId(cur); if (!c) continue;
        const nb = GX.neighbors(c.q, c.r);
        for (let i = 0; i < nb.length; i++) {
          const nid = GX.tileId(nb[i].q, nb[i].r);
          if (owned[nid] && !seen[nid] && nid !== GX.HOME) { seen[nid] = 1; stack.push(nid); }
        }
      }
      comps.push(comp.length);
      const idx = comps.length - 1;
      for (let i = 0; i < comp.length; i++) { map[comp[i]] = comp.length; cid[comp[i]] = idx; }
    }
    _cluCache = { n, h, map, comps, cid };
    return map;
  }
  // What ONE tile's block is worth. `mult` is 1 for a tile in no qualifying block,
  // so every caller can multiply by it unconditionally. `cid` identifies WHICH
  // block — the map border needs "same block", and two separate blocks can be the
  // same size, so size is not an identity.
  function clusterOf(id) {
    const size = clusterSizes()[id] || 0;
    const tier = clusterTierFor(size);
    const cid = (_cluCache && _cluCache.cid && _cluCache.cid[id] != null) ? _cluCache.cid[id] : -1;
    return tier
      ? { size, cid, mult: tier.mult, add: tier.add, name: tier.name, color: tier.color, need: tier.need }
      : { size, cid, mult: 1, add: 0, name: '', color: '', need: 0 };
  }
  // The empire's blocks, biggest first — backs the hero pill in My Galaxy. Every
  // figure the pill prints comes from here; it restates none of them.
  function clusterSummary() {
    clusterSizes();
    const comps = ((_cluCache && _cluCache.comps) || []).slice().sort((a, b) => b - a);
    const biggest = comps.length ? comps[0] : 0;
    const tier = clusterTierFor(biggest);
    let boosted = 0, blocks = 0;
    for (let i = 0; i < comps.length; i++) {
      if (clusterTierFor(comps[i])) { boosted += comps[i]; blocks++; }
    }
    // the next rung up from the biggest block, and how far off it is
    let next = null;
    for (let i = CLUSTER_TIERS.length - 1; i >= 0; i--) {
      if (CLUSTER_TIERS[i].need > biggest) { next = CLUSTER_TIERS[i]; break; }
    }
    return { comps, biggest, tier, next, toNext: next ? next.need - biggest : 0,
             boosted, blocks, tiers: CLUSTER_TIERS };
  }

  // ===========================================================================
  // SIEGE SHIELD — NO EXPOSED BORDER, NO SIEGE
  // ===========================================================================
  // A system can only be attacked if it TOUCHES something that is not its
  // owner's. Ring a tile with your own and its core is unreachable: an attacker
  // has to take one of the border systems first and open a path in. That is the
  // whole rule, and it lives HERE ONLY — the map paint, the tile sheet, warp()
  // and the rival sim all read this function, so they cannot disagree about
  // which tiles are shielded. A rule that decides whether an attack is even
  // possible has to be stated before it fires, so the sheet prints it (and the
  // way in) rather than the button simply refusing.
  //
  // FACTION, NOT PLAYER. Allied space is one bloc — an ally's tile shields yours
  // exactly as your own does, which is most of why an alliance is worth holding
  // ground for. For a rival-held tile the faction is that rival: ALLIANCE.isAlly
  // answers only about MY alliance, so a rival's allies are not knowable on this
  // client and are deliberately not guessed at.
  //
  // THE GALAXY'S OUTER EDGE IS ALWAYS OPEN. A tile on the last ring has borders
  // facing off the map; counting those as sealed would mint permanently
  // untouchable territory out of pure geography. The rim is the frontier, it
  // stays contestable, and the sheet says so out loud.
  //
  // HOME IS NEUTRAL and belongs to no faction, so it neither shields a neighbour
  // nor is ever shielded itself.
  function factionOf(k) {
    if (!k || k === GX.HOME) return null;
    if (isOwned(k) || isAllyTile(k)) return 'me';
    const real = rt.realTiles && rt.realTiles[k];
    if (real && real.ownerId) return 'u:' + real.ownerId;
    const rv = rivalOf(k);
    return rv ? 'r:' + rv : null;
  }
  // Per-tile memo on the same idiom clusterSizes() uses: the NPC layer is a pure
  // function of (tile, UTC day) and real claims arrive by sync, so a short-lived
  // answer is honest and keeps six neighbour lookups per tile off the map's paint
  // path. clusterBust() drops it the instant ownership changes, so the window is
  // never what makes a capture show up late. 700ms is chosen against the galaxy
  // world bake's ~2Hz idle rebake: a shorter window than the gap between bakes
  // would rebuild the whole map's shields on every one of them.
  function tileShield(k) {
    const now = Date.now();
    if (!_shdMemo || now - _shdAt > 700) { _shdMemo = {}; _shdAt = now; }
    const hit = _shdMemo[k];
    if (hit) return hit;
    const c = GX.parseId(k), fac = factionOf(k);
    let open = 0, edge = 0, rim = false;
    const doors = [];
    if (c && fac) {
      const nb = GX.neighbors(c.q, c.r);
      for (let i = 0; i < nb.length; i++) {
        const n = nb[i];
        // OFF THE MAP. Counted as open (the rim is the frontier and stays
        // contestable) but counted SEPARATELY, because it is the one kind of open
        // border a pilot cannot close by taking ground. The sheet needs to be able
        // to say that instead of telling them to fill a border that does not exist:
        // "a corner tile that's technically surrounded still says 3 of 6 borders
        // face open space". One statement of the geometry, here.
        if (GX.ringOf(n.q, n.r) > GX.RINGS) { open++; edge++; rim = true; continue; }
        const nid = GX.tileId(n.q, n.r);
        if (factionOf(nid) !== fac) open++;
        else doors.push(nid);          // same faction — a candidate way in, tested below
      }
    } else { open = 6; }               // neutral ground is open on every side
    const out = { faction: fac, mine: fac === 'me', open, edge, sides: 6, rim,
                  shielded: !!(fac && open === 0), ring: doors };
    _shdMemo[k] = out;
    return out;
  }
  // THE WAY IN. For a shielded tile, the neighbours that are themselves exposed
  // are the systems an attacker has to break first — naming them turns "you
  // can't attack this" into an instruction. Computed from tileShield(), never a
  // second traversal of its own.
  function shieldDoors(k) {
    const s = tileShield(k);
    if (!s.shielded) return [];
    return s.ring.filter((nid) => {
      const ns = tileShield(nid);
      return ns.open > 0 && !isOwned(nid) && !isAllyTile(nid);
    });
  }
  // ---- TERRITORY, NOT JUST SHIELDS ----------------------------------------
  //
  // A shared map is nothing like the local sim: measured on a live client, 1,793
  // of 1,950 tiles carried a real claim across 85 owners, with 531 same-owner
  // adjacencies and ZERO sealed cores — 85 pilots each holding ~21 scattered
  // tiles. The map paint gated every boundary on "does this bloc contain a sealed
  // core", so on that map NOTHING was ever outlined and a player could not see
  // another pilot's holdings at all. Reported exactly that way.
  //
  // A territory is worth drawing because it is a territory. This flood-fills each
  // faction's touching tiles once per memo window and reports the bloc's SIZE and
  // how many sealed cores it holds, so the paint can outline any real bloc (3+)
  // and reserve the heavier treatment for one with a core to protect.
  //
  // MIN 3 IS DELIBERATE. Two touching tiles is a coincidence on a map that dense;
  // three is somebody holding ground. Nothing is stored — same as the shield.
  const BLOC_MIN = 3;
  function factionBlocs() {
    const now = Date.now();
    if (_blocMemo && now - _blocAt < 700) return _blocMemo;
    const seen = {}, out = {};
    const push = (id) => {
      const fac = factionOf(id);
      if (!fac || seen[id]) return;
      const c0 = GX.parseId(id); if (!c0) return;
      const comp = [], stack = [id];
      seen[id] = 1;
      let cores = 0;
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        if (tileShield(cur).shielded) cores++;
        const c = GX.parseId(cur); if (!c) continue;
        const nb = GX.neighbors(c.q, c.r);
        for (let i = 0; i < nb.length; i++) {
          if (GX.ringOf(nb[i].q, nb[i].r) > GX.RINGS) continue;
          const nid = GX.tileId(nb[i].q, nb[i].r);
          if (!seen[nid] && factionOf(nid) === fac) { seen[nid] = 1; stack.push(nid); }
        }
      }
      const rec = { size: comp.length, cores, fac };
      for (let i = 0; i < comp.length; i++) out[comp[i]] = rec;
    };
    // every tile anyone holds: my own, the shared map's real claims, the local sim
    for (const id in (state.ownedSystems || {})) push(id);
    for (const id in ((rt.realTiles) || {})) push(id);
    for (const id in (state.rivalTiles || {})) push(id);
    _blocMemo = out; _blocAt = now;
    return out;
  }
  // One tile's territory: { size, cores, fac } or null. `size >= BLOC_MIN` is the
  // test the map uses to decide whether a boundary is worth drawing.
  function blocOf(k) { return factionBlocs()[k] || null; }

  // WHAT ONE TILE PAYS AN HOUR — THE SINGLE STATEMENT OF IT.
  //
  // This used to exist only as the body of resourceRates()'s loop, so every
  // screen that wanted to show a tile's worth restated the arithmetic and each
  // one dropped a different term. The galaxy LIST printed a bare `t.rate` — no
  // ×25 galaxy yield, no deep-space ×25, no player-citadel rank — so a rank-5
  // fortress on a deep ring read 7.5M/h while it actually banked billions. The
  // tile sheet carried its own hand-copy annotated "MIRROR resourceRates()",
  // which is the same bug waiting to happen. There is one function now; anything
  // that prints a tile's income CALLS IT and never re-derives it.
  //
  // The natural-fortress ×1000 is deliberately absent here: galaxy.js bakes it
  // into t.rate at generation, and applying it again would pay it twice.
  // `parts` is returned so a screen can EXPLAIN the number without recomputing it.
  function tileRateOf(id) {
    const t = sysAt(id); if (!t || !t.rate) return null;
    const base0 = Number(t.rate) || 0;
    if (t.void) {   // VOID ZONE — every tile pays ALL FOUR currencies hourly
      const vr = base0 * 25;
      return { void: true, res: 'all', perHour: vr, gold: vr * 1000,
               pays: { fuel: vr, iron: vr, plasma: vr, gold: vr * 1000 },
               parts: { base: base0, deep: 1, cit: 1, galaxy: 25, cluster: 1 },
               cluster: { size: 0, mult: 1, add: 0, name: '' }, natural: !!t.citadel, citLv: 0 };
    }
    const deep = t.deep ? GX.DEEP_MULT.resource : 1;   // deep space ×25 on top
    const rec = state.citadels && state.citadels[id];
    const citLv = rec ? (rec.lv || 1) : 0;
    const cit = citLv ? CITADEL_MULT * citLv : 1;      // PLAYER CITADEL — 10× per rank
    // A TILE IS EITHER A NATURAL FORTRESS OR A BUILT ONE, NEVER BOTH (737).
    // The two bonuses are alternatives — ×1000 for what the tile IS, or ×10/rank for
    // what the pilot BUILT — and nothing is supposed to carry both: canBuildCitadel()
    // refuses a natural fortress and inheritCitadel() returns early on one. The
    // stack only exists because the scarcity pass and a player's build crossed in
    // time (a fortress retired, then built on; or an ordinary tile built on, then
    // promoted). Where they HAVE crossed, the citadel wins and the natural bonus is
    // taken back out: t.rate for a fortress is exactly its resource-grade rate ×
    // CITADEL_RATE_MULT, so dividing recovers the ordinary tile underneath exactly.
    // The pilot keeps the citadel they paid for, on a normal tile, which is what
    // they would have had if the two passes had not overlapped.
    const natural = !!t.citadel;
    const base = (natural && citLv) ? Math.round(base0 / GX.CITADEL_RATE_MULT) : base0;
    const clu = clusterOf(id);                         // CONTIGUITY — 1 unless the block qualifies
    const perHour = base * deep * cit * 25 * clu.mult; // GALAXY YIELD ×25 — territory is the resource engine
    const res = t.resource || 'fuel';
    return { void: false, res, perHour, gold: 0, pays: { [res]: perHour },
             parts: { base, deep, cit, galaxy: 25, cluster: clu.mult },
             cluster: clu, natural, citLv };
  }
  function resourceRates() {
    const r = { fuel: 0, iron: 0, plasma: 0 };
    // GUARDED AND TRUTHINESS-TESTED, like every sibling (build 736). This was the
    // only ownedSystems iteration in the file without `|| {}` — and it is the one
    // accrueResources() calls, so a save arriving before sanitizeSave() created
    // the key threw inside income accrual and lost that session's settlement.
    // The falsy skip matches tileCount()/citadelCount(): a tile that does not
    // COUNT must not PAY either, or the two disagree the way section B did.
    Object.keys(state.ownedSystems || {}).forEach((k) => {
      if (!state.ownedSystems[k]) return;
      const q = tileRateOf(k); if (!q) return;
      if (q.void) { r.fuel += q.perHour; r.iron += q.perHour; r.plasma += q.perHour; r.gold = (r.gold || 0) + q.gold; return; }
      r[q.res] += q.perHour;
    });
    return r;
  }
  // OFFLINE CAP — VIP levels 6, 9 and 13 each sell "Offline earnings cap +Nh".
  // Nothing read that until now: both caps were hardcoded to 12h, so the perk
  // was text on a purchase screen and no more. One source of truth for both.
  function offlineCapHours() {
    let bonus = 0;
    try { if (window.VIP && window.VIP.capBonus) bonus = window.VIP.capBonus() | 0; } catch (e) {}
    return 12 + Math.max(0, bonus);
  }
  function accrueResources() {
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    const now = Date.now();
    const hrs = Math.min(offlineCapHours(), Math.max(0, (now - (state.lastResTick || now)) / 3600000));
    state.lastResTick = now;
    if (hrs <= 0) return null;
    const rates = resourceRates();
    const gained = { fuel: rates.fuel * hrs, iron: rates.iron * hrs, plasma: rates.plasma * hrs, gold: (rates.gold || 0) * hrs };
    state.resources.fuel += gained.fuel; state.resources.iron += gained.iron; state.resources.plasma += gained.plasma;
    if (gained.gold) state.gold = (state.gold || 0) + gained.gold;   // VOID tiles pay gold too
    return gained;
  }
  // AUTO ↔ MANUAL must release the STICK, not just centre it. This cleared x/y
  // but left rt.joy.active true, so a player who tapped AUTO mid-drag (or came
  // back to manual after one) landed in manual mode with active=true and a zero
  // vector: manualMove's `active && (x||y)` guard never fired and the ship sat
  // still until they touched and released the joystick again.
  // ...AND IT MUST TELL THE UI. syncJoystickVisible() only shows the stick when
  // getAuto() is false, and it is only ever called from UI.syncAuto() — which
  // nothing outside ui.js could reach. So the three systems that force manual
  // flight for their own duration (Voidmaw, alliance raid, cargo escort) flipped
  // auto off and left the joystick HIDDEN: forced into manual with no control
  // surface, the ship would not move on auto or manual, and it cleared itself the
  // moment anything else happened to call syncAuto(). That is the intermittent
  // "locks in on the 3rd or 4th boss jump" freeze.
  function setAuto(v) {
    state.auto = !!v; rt.joy.x = rt.joy.y = 0; rt.joy.active = false; save();
    try { if (window.UI && window.UI.syncAuto) window.UI.syncAuto(); } catch (e) {}
  }
  function setJoystick(x, y, active) { rt.joy.x = x; rt.joy.y = y; rt.joy.active = active; }
  // THREE TIERS, EACH WITH ITS OWN ENTITLEMENT (build 712). 4× and 5× no longer
  // exist; anything not named here is refused rather than silently accepted.
  //   1×  the game
  //   2×  bought once with 500 LootCoins (sku 'speed4lc' — see SPEED_TIERS)
  //   3×  LootFleet Pro, for as long as it is active
  //   10× the Mothership easter egg, never shown until it fires
  function ownsPaidSpeed() { return !!(state.purchases && state.purchases.speed4lc); }
  function setGameSpeed(mult) {
    if (mult === 1) { state.gameSpeed = 1; save(); return true; }
    // 10× is the SECRET tier — ONLY the Mothership easter egg unlocks it
    if (mult === 10) { if (!state.secretSpeed) return false; state.gameSpeed = 10; save(); return true; }
    // 2× is the PREMIUM tier — ONLY the 500-LootCoin unlock opens it
    if (mult === 2) { if (!ownsPaidSpeed()) return false; state.gameSpeed = 2; save(); return true; }
    // 3× is PRO-exclusive — active LootFleet Pro subscription required
    if (mult === 3) { if (!isPro()) return false; state.gameSpeed = 3; save(); return true; }
    return false;
  }
  // Kept for callers that ask by sku. Every tier above 1× is now paid for in one
  // way or another, so nothing here is free.
  function hasSpeed(sku) { return sku === 'speed4lc' ? ownsPaidSpeed() : false; }
  function purchase(sku) { state.purchases[sku] = true; save(); if (window.UI) window.UI.refreshAll(); }
  // One-time premium unlock: permanent 4× battle speed for 500 LootCoins.
  // —— LOOTFLEET PRO —— $20/mo subscription. Every benefit lives in PRO_PERKS
  // (xp, speed, gold, loot, beacon, tiles, dread attempts) and every surface —
  // HUD chip, offer card, purchase sheet, receipt, stat pills — reads that table
  // rather than a retyped literal. proUntil is a timestamp; the Stripe webhook (or manual fulfilment)
  // extends it each billing cycle. grantPro is the fulfilment hook.
  function isPro() { return (state.proUntil || 0) > Date.now(); }
  // ---- LOOTFLEET PRO — what the subscription actually does ---------------------
  // One table, read by every hook and by the purchase sheet, so the sell copy and
  // the game can never disagree. Pro is deliberately felt across SEVERAL systems
  // rather than being one big XP number: speed, XP, gold, loot, beacon, empire
  // size and the Dreadnaught hunt.
  const PRO_PERKS = {
    xpMult: 5,        // base XP rate ×5 (every other bonus is still a % of that base)
    gold: 2,          // ×2 gold from every kill
    loot: 1.5,        // +50% drop chance
    beaconCdCut: 0.25,// −25% beacon recharge
    tiles: 10,        // +10 galaxy tile cap
    dreadAttempts: 1, // +1 Dreadnaught hunt per tier each week (see DREAD.proAttempt)
    speed: 3,         // exclusive 3× battle speed tier — the top of the ladder (712)
  };
  function proMods() {
    const on = isPro();
    return {
      on,
      gold: on ? PRO_PERKS.gold : 1,
      loot: on ? PRO_PERKS.loot : 1,
      beaconCdCut: on ? PRO_PERKS.beaconCdCut : 0,
      tiles: on ? PRO_PERKS.tiles : 0,
      perks: PRO_PERKS,
    };
  }
  function grantPro(days) {
    const base = Math.max(Date.now(), state.proUntil || 0);
    state.proUntil = base + (days || 30) * 86400000;
    save(); if (window.UI) window.UI.refreshAll();
    return state.proUntil;
  }
  // LOOTCOIN FAST-TRACK — hero-banner ship offers (Ships tab). Carrier first;
  // once owned, the banner upgrades to the Mothership.
  const LC_SHIP_OFFERS = { carrier: 25000, mothership: 100000, oblivionfinal: 300000, chromafang: 500, chromaregent: 75000, frostyfrost: 50000, titansina: 1000000 };
  function buyShipLC(key) {
    const ship = C.SHIP_BY_KEY[key];
    const price = LC_SHIP_OFFERS[key];
    if (!price || !ship) return { ok: false, reason: 'invalid' };
    if (state.ownedShips[key]) return { ok: false, reason: 'owned' };
    const reqLevel = ship.purchase && ship.purchase.reqLevel;
    if (reqLevel && (state.level || 1) < reqLevel) return { ok: false, reason: 'level' };
    if ((state.credits || 0) < price) return { ok: false, reason: 'credits' };
    state.credits -= price;
    grantShip(key);
    save();
    return { ok: true };
  }
  // Buys the PREMIUM battle-speed tier — 2× since build 712, 4× before it. The
  // sku is unchanged on purpose so an old receipt still redeems; see SPEED_TIERS.
  function buySpeed4() {
    if (state.purchases && state.purchases.speed4lc) return { ok: false, reason: 'owned' };
    if ((state.credits || 0) < 500) return { ok: false, reason: 'credits' };
    state.credits -= 500;
    if (!state.purchases) state.purchases = {};
    state.purchases.speed4lc = true;
    save();
    return { ok: true };
  }

  // ---- AUTO BEACON — a one-time 25,000-LootCoin operations unlock ------------
  // WHAT IT BUYS: the beacon pulls its own trigger the moment it is charged, for
  // as long as the account exists. Nothing else changes — not the recharge, not
  // the swarm size, not the tithe, and not the rule that it never fires during a
  // boss. It is convenience, not power: an idle game should not require a player
  // to be present to press one button every few minutes.
  //
  // `autobeacon` IS THE SKU AND IT IS A RECEIPT. It rides in `purchases`, which
  // is an ASC_KEEP entitlement and a unioned field in mergeSaves(), so the unlock
  // survives ascension, a device swap and any save merge. Never rename it.
  //
  // THE ARMED FLAG IS A SETTING, NOT THE RECEIPT. `state.autoBeacon` is the
  // toggle, and it reads TRUE UNLESS EXPLICITLY FALSE — so a save that has never
  // seen the key (a fresh purchase, a post-ascension state, an old cloud copy)
  // arms itself rather than silently switching a paid feature off. It is also in
  // ASC_KEEP so a deliberate OFF survives too.
  const AUTO_BEACON_LC = 25000;
  function hasAutoBeacon() { return !!(state.purchases && state.purchases.autobeacon); }
  function autoBeaconOn() { return hasAutoBeacon() && state.autoBeacon !== false; }
  function setAutoBeacon(v) {
    if (!hasAutoBeacon()) return false;
    state.autoBeacon = !!v;
    save();
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    return true;
  }
  // GUARDED AGAINST FIRING TWICE, and affordability is re-checked at the moment
  // of the write — the shop card can sit open while LootCoins are spent
  // elsewhere. `Math.floor(Number(x) || 0)` on the balance, never `| 0`: a wallet
  // past 2.1 billion wraps negative through a bitwise coercion and the check
  // would pass for someone rich rather than poor.
  let _abBusy = false;
  function buyAutoBeacon() {
    if (_abBusy) return { ok: false, reason: 'busy' };
    if (hasAutoBeacon()) return { ok: false, reason: 'owned' };
    if ((state.level | 0) < BEACON_LV) return { ok: false, reason: 'level', need: BEACON_LV };
    const bal = Math.floor(Number(state.credits) || 0);
    if (bal < AUTO_BEACON_LC) return { ok: false, reason: 'credits', short: AUTO_BEACON_LC - bal };
    _abBusy = true;
    try {
      state.credits = bal - AUTO_BEACON_LC;        // paid…
      if (!state.purchases) state.purchases = {};
      state.purchases.autobeacon = true;           // …then delivered, synchronously
      state.autoBeacon = true;                     // armed on purchase — that is what they bought
      save();
      try { if (window.ACCOUNT && window.ACCOUNT.flushNow) window.ACCOUNT.flushNow(); } catch (e) {}
      if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    } finally { _abBusy = false; }
    return { ok: true };
  }

  // recommend the deepest zone the player can comfortably clear
  function recommendedZone() {
    const s = rt.stats || computeStats();
    // Find the deepest zone that is comfortably safe, then step DOWN for margin.
    // Conservative: each enemy hit must be a small fraction of HP and kills fast,
    // because swarms stack damage. Recommend two zones below that ceiling.
    let ceiling = 1;
    for (let d = 1; d <= state.highestUnlocked; d++) {
      const hp = C.enemyHp(d), dmg = C.enemyDamage(d);
      const ttk = hp / Math.max(1, s.theoryDps);
      const survivable = dmg < s.maxHp * 0.05;   // a hit ≤5% HP (was 12%)
      if (ttk < 1.1 && survivable) ceiling = d;   // must shred enemies (was 2.2)
    }
    return Math.max(1, ceiling - 2);
  }
  // FrostyFrost anywhere in the fleet (flagship or escort) — memoized 500ms
  // MEMOISED ON THE SIM CLOCK, NOT THE WALL CLOCK. Both of these are called from
  // resolveHit — once per landed hit — and a fighter wing multiplies that count
  // several times over (bays × rate × multi-shot fan × sub-steps). performance.now()
  // is a real call, not a field read, so it was the one unavoidable cost on the
  // hottest path in the game. rt.time is already advanced by the step loop and is
  // exact for a cache TTL.
  function frostAboard() {
    const n = rt.time;
    if (rt._frostChk == null || n - (rt._frostT || 0) > 0.5) {
      rt._frostT = n;
      rt._frostChk = state.ship === 'frostyfrost' || (typeof fleetShips === 'function' && fleetShips().some((f) => f.key === 'frostyfrost'));
    }
    return rt._frostChk;
  }
  // VOIDMAW anywhere in the fleet (flagship or escort) — memoized 0.5 sim-seconds.
  // Powers the SINGULARITY proc: stun + a collapsing black hole (see resolveHit).
  function voidmawAboard() {
    const n = rt.time;
    if (rt._vmChk == null || n - (rt._vmT || 0) > 0.5) {
      rt._vmT = n;
      rt._vmChk = state.ship === 'voidmaw' || (typeof fleetShips === 'function' && fleetShips().some((f) => f.key === 'voidmaw'));
    }
    return rt._vmChk;
  }
  // ---- SINGULARITY (Voidmaw) -------------------------------------------------
  // 12% per bolt (matching FrostyFrost's cryo cadence): the target is STUNNED
  // 1.6s and a medium black hole (radius 165) tears open beneath it. Everything
  // caught inside is dragged toward the core and takes 22% of your attack
  // damage per second for 3s — sustained AoE that pays off in crowds, not a
  // single-target burst. Bosses are immune to the stun but still take the pull
  // damage. 6s cooldown per target, and at most 3 holes on the field at once.
  const SING = { chance: 12, stun: 1.6, life: 3.0, radius: 165, dpsPct: 0.22, cd: 6, max: 3 };
  function openSingularity(e) {
    rt.holes = rt.holes || [];
    if (rt.holes.length >= SING.max) rt.holes.shift();
    rt.holes.push({ x: e.x, y: e.y, t: SING.life, life: SING.life, r: SING.radius, tick: 0 });
    rt.floats.push(new E.FloatText(e.x, e.y - e.size - 12, '● SINGULARITY', { color: '#c07bff', size: 28 }));
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = 150 + Math.random() * 160;
      rt.particles.push(new E.Particle(e.x + Math.cos(a) * SING.radius * 0.9, e.y + Math.sin(a) * SING.radius * 0.9,
        { vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, life: 0.5 + Math.random() * 0.3, size: 1.6 + Math.random() * 2.4, color: i % 2 ? '#c07bff' : '#e9d6ff', glow: true, drag: 0.92 }));
    }
    rt.shake = Math.min(3.2, (rt.shake || 0) + 1.6);
  }
  // ===========================================================================
  // ✦ THE EVENT HORIZON LANCE — the Aeternum's reason to exist
  // ---------------------------------------------------------------------------
  // A 60-second cycle, automatic and unstoppable:
  //   0–45s   dormant, the reactor recovers
  //   45–60s  ALIGNMENT — 15 seconds of visible charge. The lane's ANGLE is locked
  //           at the start of the charge and drawn across the whole zone, so the
  //           shot is fully telegraphed: walk a target out of it, or walk your
  //           fleet into it.
  //   at 60s  FIRE. The beam does NOT stop at whatever it was aimed at — it runs
  //           from the hull to the far edge of the world and hits EVERY hostile in
  //           the lane, then leaves a FRACTURE ZONE burning along it.
  // Damage is written in DPS-seconds so it stays meaningful at any zone depth:
  // ~55× your effective DPS to a normal hull, 22× to a boss (still the single
  // largest hit in the game), and the fracture keeps bleeding 5×/s.
  // Everything that dies inside a live fracture pays a 4× tithe and drops one
  // extra fitting rolled at boosted rarity — the aftermath IS the reward.
  // ===========================================================================
  const LANCE = { cycle: 60, charge: 15, width: 130, hit: 55, bossHit: 22, fracDps: 5, fracLife: 14, tithe: 4 };
  function hasLance() { const sh = C.SHIP_BY_KEY[state.ship]; return !!(sh && sh.lance); }
  function lanceState() {
    if (!hasLance()) return null;
    const t = rt.lanceT || 0;
    const charging = t >= LANCE.cycle - LANCE.charge;
    return { t, charging, left: Math.max(0, LANCE.cycle - t),
             chargeFrac: charging ? (t - (LANCE.cycle - LANCE.charge)) / LANCE.charge : 0,
             fractures: (rt.fractures || []).length };
  }
  // the lane: a ray from the hull, extended past the far corner of the world
  function laneEnd(x, y, ang) {
    const reach = Math.hypot(rt.worldW, rt.worldH) * 1.2;
    return { x: x + Math.cos(ang) * reach, y: y + Math.sin(ang) * reach };
  }
  function inLane(o, L) {
    const dx = o.x - L.x, dy = o.y - L.y;
    const along = dx * Math.cos(L.ang) + dy * Math.sin(L.ang);
    if (along < -20) return false;                       // behind the muzzle
    const perp = Math.abs(-dx * Math.sin(L.ang) + dy * Math.cos(L.ang));
    return perp <= L.w * 0.5 + (o.size || 20) * 0.4;
  }
  function lanceTick(dt) {
    if (!hasLance()) { rt.lanceT = 0; rt.lanceAim = null; }
    else if (!rt.archer.dead && state.currentDungeon >= 1) {
      rt.lanceT = (rt.lanceT || 0) + dt;
      const chargeStart = LANCE.cycle - LANCE.charge;
      if (rt.lanceT >= chargeStart && !rt.lanceAim) {
        const tgt = nearestEnemy(), a0 = rt.archer;
        const ang = tgt ? Math.atan2(tgt.y - a0.y, tgt.x - a0.x) : (a0.aim || 0);
        rt.lanceAim = { ang, x: a0.x, y: a0.y, w: LANCE.width };
        if (window.UI && window.UI.unlockToast) window.UI.unlockToast('✦ EVENT HORIZON LANCE — ALIGNING');
      }
      // the muzzle follows the hull while charging; the ANGLE stays locked
      if (rt.lanceAim) { rt.lanceAim.x = rt.archer.x; rt.lanceAim.y = rt.archer.y; }
      if (rt.lanceT >= LANCE.cycle) { fireLance(); rt.lanceT = 0; rt.lanceAim = null; }
    }
    // FRACTURE ZONES burn on regardless of which hull is flying now
    const fr = rt.fractures;
    if (fr && fr.length) {
      for (let i = fr.length - 1; i >= 0; i--) {
        const f = fr[i];
        f.t -= dt;
        if (f.t <= 0) { fr.splice(i, 1); continue; }
        f.tick = (f.tick || 0) + dt;
        const pulse = f.tick >= 0.25; if (pulse) f.tick = 0;
        const dps = effectiveDps() * LANCE.fracDps;
        for (const o of rt.enemies) {
          if (o.dead || o.dying || !inLane(o, f)) continue;
          o.tithe = Math.max(o.tithe || 1, LANCE.tithe);   // rich ground: gold, xp, salvage
          o.fracT = 1;                                     // onKill adds the bonus fitting
          if (pulse && dps >= 1) {
            const dmg = dps * 0.25;
            const k = o.takeDamage(dmg);
            rt.dmgWindow.push({ t: rt.time, dmg });
            if (k) onKill(o);
          }
        }
        if (Math.random() < dt * 26) {
          const along = Math.random() * Math.hypot(rt.worldW, rt.worldH);
          const off = (Math.random() - 0.5) * f.w;
          const px = f.x + Math.cos(f.ang) * along - Math.sin(f.ang) * off;
          const py = f.y + Math.sin(f.ang) * along + Math.cos(f.ang) * off;
          rt.particles.push(new E.Particle(px, py, { vx: 0, vy: -40 - Math.random() * 60, life: 0.6, size: 1.4 + Math.random() * 2.2, color: Math.random() < 0.5 ? '#a6ff5b' : '#e9ffd0', glow: true, drag: 0.94 }));
        }
      }
    }
    if (rt.lanceFlash > 0) rt.lanceFlash = Math.max(0, rt.lanceFlash - dt);
  }
  function fireLance() {
    const a = rt.archer, aim = rt.lanceAim; if (!aim) return;
    const L = { x: a.x, y: a.y, ang: aim.ang, w: LANCE.width };
    const dps = effectiveDps();
    let hits = 0;
    for (const o of rt.enemies) {
      if (o.dead || o.dying || !inLane(o, L)) continue;
      const dmg = dps * (o.isBoss ? LANCE.bossHit : LANCE.hit) * (window.DREAD && window.DREAD.dmgVs ? window.DREAD.dmgVs(o) : 1);
      const k = o.takeDamage(dmg);
      rt.dmgWindow.push({ t: rt.time, dmg });
      hits++;
      burst(o.x, o.y, '#a6ff5b', 26, { speed: 320, life: 0.7, glow: true });
      if (k) onKill(o);
    }
    if (!rt.fractures) rt.fractures = [];
    rt.fractures.push({ x: a.x, y: a.y, ang: L.ang, w: LANCE.width * 0.8, t: LANCE.fracLife, life: LANCE.fracLife });
    if (rt.fractures.length > 4) rt.fractures.shift();
    rt.lanceFlash = 0.55;
    rt.shake = Math.min(10, (rt.shake || 0) + 8);
    rt.novaT = Math.max(rt.novaT || 0, 0.35);
    burst(a.x, a.y, '#e9ffd0', 90, { speed: 520, life: 0.9, glow: true });
    rt.floats.push(new E.FloatText(a.x, a.y - 40, '✦ EVENT HORIZON' + (hits ? ' — ' + hits + ' VAPORISED' : ''), { color: '#a6ff5b', size: 30, vy: -26, life: 1.8 }));
  }
  // canvas: charge glow, the beam, and the lingering rift — all in world space
  function drawLance(ctx) {
    const aim = rt.lanceAim, flash = rt.lanceFlash || 0, fr = rt.fractures || [];
    if (!aim && !flash && !fr.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    for (const f of fr) {
      const k = Math.max(0, Math.min(1, f.t / f.life));
      const e = laneEnd(f.x, f.y, f.ang);
      const g = ctx.createLinearGradient(f.x, f.y, e.x, e.y);
      g.addColorStop(0, 'rgba(166,255,91,' + (0.30 * k).toFixed(3) + ')');
      g.addColorStop(0.5, 'rgba(120,220,70,' + (0.20 * k).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(60,140,40,0)');
      ctx.strokeStyle = g; ctx.lineWidth = f.w * (0.7 + 0.3 * k);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(233,255,208,' + (0.5 * k).toFixed(3) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    }
    if (aim) {
      const cs = LANCE.cycle - LANCE.charge;
      const p = Math.max(0, Math.min(1, ((rt.lanceT || 0) - cs) / LANCE.charge));
      const e = laneEnd(aim.x, aim.y, aim.ang);
      const puls = 0.55 + 0.45 * Math.sin(rt.time * (6 + p * 22));
      ctx.strokeStyle = 'rgba(166,255,91,' + (0.10 + 0.28 * p).toFixed(3) + ')';
      ctx.lineWidth = 3 + p * (LANCE.width - 3);
      ctx.beginPath(); ctx.moveTo(aim.x, aim.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(233,255,208,' + (0.35 + 0.6 * p * puls).toFixed(3) + ')';
      ctx.lineWidth = 1.5 + p * 4;
      ctx.beginPath(); ctx.moveTo(aim.x, aim.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      const r = 10 + p * 42 * puls;
      const cg = ctx.createRadialGradient(aim.x, aim.y, 0, aim.x, aim.y, r);
      cg.addColorStop(0, 'rgba(255,255,255,' + (0.5 + 0.5 * p).toFixed(3) + ')');
      cg.addColorStop(0.4, 'rgba(166,255,91,' + (0.5 * p + 0.15).toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(60,140,40,0)');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(aim.x, aim.y, r, 0, 7); ctx.fill();
    }
    if (flash > 0 && fr.length) {
      const f = flash / 0.55, use = fr[fr.length - 1];
      const e = laneEnd(use.x, use.y, use.ang);
      ctx.strokeStyle = 'rgba(166,255,91,' + (0.55 * f).toFixed(3) + ')';
      ctx.lineWidth = LANCE.width * (1.1 + (1 - f) * 0.6);
      ctx.beginPath(); ctx.moveTo(use.x, use.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * f).toFixed(3) + ')';
      ctx.lineWidth = 10 + 26 * f;
      ctx.beginPath(); ctx.moveTo(use.x, use.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    }
    ctx.restore();
  }
  // ===========================================================================
  // ✦ DEATH BEAMS — the Eternum's armament
  // ---------------------------------------------------------------------------
  // No charge, no cooldown, no aiming. The hull holds a lock on the N nearest
  // hostiles (5 on the Eternum) and pours a continuous beam into each for as
  // long as they stay inside weapon range. Each beam does BEAM.dps × effective
  // DPS per second, so it scales with the pilot's build rather than replacing
  // it. Locks re-target every BEAM.relock seconds so the beams sweep the field
  // instead of sitting on one corpse.
  // ===========================================================================
  const BEAM = { dps: 1.35, bossDps: 0.55, relock: 0.35, tick: 0.2 };
  function beamCount() { const sh = C.SHIP_BY_KEY[state.ship]; return sh && sh.deathBeams ? (sh.deathBeams | 0) : 0; }
  function beamTick(dt) {
    const n = beamCount();
    if (!n || !rt.archer || rt.archer.dead || state.currentDungeon < 1) { rt.beams = null; return; }
    const a = rt.archer, range = (rt.stats && rt.stats.fireRange) || 900;
    rt.beamRelock = (rt.beamRelock || 0) - dt;
    if (!rt.beams || rt.beamRelock <= 0) {
      rt.beamRelock = BEAM.relock;
      rt.beams = rt.enemies
        .filter((o) => !o.dead && !o.dying && Math.hypot(o.x - a.x, o.y - a.y) <= range)
        .sort((p, q) => (Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)))
        .slice(0, n);
    }
    rt.beams = rt.beams.filter((o) => o && !o.dead && !o.dying);
    if (!rt.beams.length) return;
    rt.beamT = (rt.beamT || 0) + dt;
    const pulse = rt.beamT >= BEAM.tick; if (pulse) rt.beamT = 0;
    const dps = effectiveDps();
    for (const o of rt.beams) {
      const dmg = dps * (o.isBoss ? BEAM.bossDps : BEAM.dps) * dt * (window.MONO_MULT ? window.MONO_MULT(o) : 1);
      if (dmg < 1) continue;
      const k = o.takeDamage(dmg);
      rt.dmgWindow.push({ t: rt.time, dmg });
      if (pulse && rt.floats.length < 26) rt.floats.push(new E.FloatText(o.x, o.y - o.size, formatNum(dmg / dt * (rt.dmgShow || 1)) + '/s', { color: '#bfe6ff', size: 22 }));
      if (k) onKill(o);
    }
  }
  // canvas: five white-hot lances from the hull to each locked hostile
  function drawBeams(ctx) {
    const list = rt.beams; if (!list || !list.length || !rt.archer) return;
    const a = rt.archer, t = rt.time;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < list.length; i++) {
      const o = list[i]; if (!o || o.dead) continue;
      const puls = 0.72 + 0.28 * Math.sin(t * 26 + i * 1.7);
      ctx.strokeStyle = 'rgba(90,170,255,' + (0.30 * puls).toFixed(3) + ')';
      ctx.lineWidth = 22 * puls;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(o.x, o.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(180,225,255,' + (0.55 * puls).toFixed(3) + ')';
      ctx.lineWidth = 9 * puls;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(o.x, o.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * puls).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(o.x, o.y); ctx.stroke();
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 34);
      g.addColorStop(0, 'rgba(255,255,255,' + (0.55 * puls).toFixed(3) + ')');
      g.addColorStop(0.5, 'rgba(110,190,255,' + (0.3 * puls).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(40,90,180,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, 34, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  // per-frame: drag everything inward and bleed hull inside every hole
  function singularityTick(dt) {
    const holes = rt.holes; if (!holes || !holes.length) return;
    const dps = (rt.stats.attackDamage || 0) * SING.dpsPct;
    for (let i = holes.length - 1; i >= 0; i--) {
      const h = holes[i];
      h.t -= dt;
      if (h.t <= 0) { holes.splice(i, 1); continue; }
      h.tick += dt;
      const pulse = h.tick >= 0.25;
      if (pulse) h.tick = 0;
      for (const o of rt.enemies) {
        if (o.dead || o.dying) continue;
        const dx = h.x - o.x, dy = h.y - o.y, d = Math.hypot(dx, dy);
        if (d > h.r) continue;
        // gravitational drag — stronger the closer you are, bosses resist
        const pull = (1 - d / h.r) * (o.isBoss ? 26 : 78) * dt;
        if (d > 6) { o.x += (dx / d) * pull; o.y += (dy / d) * pull; }
        if (pulse && dps >= 1) {
          const dmg = dps * 0.25;
          const k = o.takeDamage(dmg);
          rt.dmgWindow.push({ t: rt.time, dmg });
          if (k) onKill(o);
        }
      }
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2, rr = h.r * (0.5 + Math.random() * 0.5);
        rt.particles.push(new E.Particle(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr,
          { vx: -Math.cos(a) * 120, vy: -Math.sin(a) * 120, life: 0.45, size: 1.4 + Math.random() * 1.8, color: Math.random() < 0.5 ? '#c07bff' : '#7a3fd0', glow: true, drag: 0.93 }));
      }
    }
  }
  // canvas render: event horizon, accretion ring, inward-spiralling wisps
  function drawSingularities(ctx) {
    for (const h of rt.holes) {
      const f = Math.max(0, Math.min(1, h.t / h.life));   // 1 → 0 as it collapses
      const r = h.r * (0.55 + 0.45 * f);
      const g = ctx.createRadialGradient(h.x, h.y, r * 0.05, h.x, h.y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.95)');
      g.addColorStop(0.32, 'rgba(24,6,48,0.78)');
      g.addColorStop(0.7, 'rgba(122,63,208,0.26)');
      g.addColorStop(1, 'rgba(192,123,255,0)');
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.55 * f;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        const a0 = rt.time * (2.2 + i * 0.8) + i * 2.1;
        ctx.strokeStyle = 'rgba(192,123,255,' + (0.5 - i * 0.13).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(h.x, h.y, r * (0.42 + i * 0.2), a0, a0 + 2.4); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(233,214,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(h.x, h.y, r * 0.22, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }
  function zoneAdvice() {
    const rec = recommendedZone(), cur = state.currentDungeon, s = rt.stats;
    if (cur < 1) return { kind: 'safe', rec, msg: 'Safe Zone — no threats here. Pick a combat zone to deploy.' };
    const hp = C.enemyHp(cur), dmg = C.enemyDamage(cur), ttk = hp / Math.max(1, s.theoryDps);
    if (cur < rec) return { kind: 'up', rec, msg: `You're over-geared here — push to Zone ${rec} for better loot.` };
    if (dmg > s.maxHp * 0.22 || ttk > 6) return { kind: 'down', rec, msg: `This zone is dangerous — farm Zone ${rec} until you're stronger.` };
    return { kind: 'ok', rec, msg: `Good fit. Recommended: Zone ${rec}.` };
  }

  // --------------------------------------------------------------------------
  // SAVE / LOAD + OFFLINE (AFK) PROGRESS
  // --------------------------------------------------------------------------
  // PERF — AUTOSAVE CHANGE DETECTION. save() JSON-serialises the whole state and
  // writes it synchronously; on a large account that is a multi-hundred-KB
  // stringify, and the 8-second autosave ran it unconditionally — including while
  // the player sat on a menu with nothing changed, which read as a periodic hitch.
  //
  // A dirty FLAG would be wrong here: combat mutates xp/gold/kills every frame
  // without calling save(), so anything the flag missed would be lost progress.
  // Instead the autosave compares a cheap signature of the volatile fields. While
  // the game is actually running playTime advances every second, so this saves
  // exactly as often as before — no risk. The write is skipped only when nothing
  // observable has moved.
  function saveSig() {
    // Math.round, not `| 0` — bitwise truncates to int32 and this is an idle game
    // whose numbers run well past 2^31 (3e9 | 0 === -1294967296), so distinct
    // values would alias to the same signature and skip a real save.
    return Math.round(state.xp || 0) + '|' + Math.round(state.gold || 0) + '|' +
      Math.round(state.totalKills || 0) + '|' + (state.level | 0) + '|' +
      (state.inventory ? state.inventory.length : 0) + '|' +
      Object.keys(state.ownedSystems || {}).length + '|' + Math.floor(state.playTime || 0) + '|' +
      Math.round((state.resources || {}).fuel || 0);
  }
  let _lastSig = '';
  function save() {
    guardCurrencies();   // never persist a corrupt balance — see guardCurrencies()
    state.lastSave = Date.now(); _lastSig = saveSig();
    try { if (window.ACCOUNT) window.ACCOUNT.push(state); else localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function autosave() { if (saveSig() !== _lastSig) save(); }
  // ADOPT — a cloud CAS conflict merged another device's timeline into ours
  // mid-session; fold the result into the LIVE state so the player keeps
  // playing the merged save instead of a copy that's already been superseded.
  function adoptSave(obj) {
    if (!obj || obj === state) return;
    try {
      Object.assign(state, JSON.parse(JSON.stringify(obj))); sanitizeSave();
      refreshStats();
      if (rt.archer && rt.stats) rt.archer.hp = Math.min(rt.archer.hp || rt.stats.maxHp, rt.stats.maxHp);
      if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    } catch (e) {}
  }
  // SAVE REPAIR (Aug 2026, the FrostSkull login crash). At his stat magnitude
  // (~2.3e29 fleet power) compounded maths runs within a few multiplies of the
  // float ceiling (1.8e308); past it a field becomes Infinity, a JSON round-trip
  // turns Infinity into null, and null/NaN then poisons every += it touches.
  // Every boot loop is bounded for FINITE input — non-finite is the one class of
  // value with no cap anywhere, so it is repaired here, at the door.
  function sanitizeSave() {
    let fixed = 0; const seen = new Set();
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 14 || seen.has(o)) return;
      seen.add(o);
      for (const k in o) {
        const v = o[k];
        if (typeof v === 'number') { if (!isFinite(v)) { o[k] = 0; fixed++; } }
        else if (v && typeof v === 'object') walk(v, depth + 1);
      }
    })(state, 0);
    state.level = Math.max(1, state.level | 0 || 1);
    ensureResources();
    // FIGHTER ASCENSION ranks are CLAMPED, NEVER REVOKED. A rank was paid for at
    // a five-figure-multiple price, so an out-of-range value is repaired to the
    // nearest legal one it is entitled to (0…MAXR) and nothing is ever dropped
    // for being unrecognised — including a rank from a build newer than this one,
    // which lands on this build's ceiling rather than at zero. The ★10 gate is
    // NOT re-checked here: stars only ever climb, and a doctrine already bought
    // must not be switched off by a load.
    if (state.fasc && state.fasc.ranks) {
      const maxr = (window.FASCEND && window.FASCEND.MAXR) || 10, rk = state.fasc.ranks;
      for (const k in rk) {
        const n = Math.floor(Number(rk[k]) || 0);
        rk[k] = n < 0 ? 0 : n > maxr ? maxr : n;
      }
      // WHICH DOCTRINE IS FLYING is a preference, not progress, and the only
      // illegal value is one naming a doctrine the account does not hold a rank
      // in. That is repaired by DELETING the key, never by writing a different
      // doctrine in: FASCEND.activeKey() resolves an absent value to the highest
      // rank held, so removal lands the pilot on their best doctrine rather than
      // on whichever one this function happened to pick. A value naming a
      // doctrine THIS build does not know is left alone for the same reason
      // ranks are — it belongs to a newer build, and clearing it would stand the
      // wing down on every downgrade.
      if (typeof state.fasc.active === 'string') {
        const a = state.fasc.active;
        const known = !!(window.FASCEND && window.FASCEND.BY_K && window.FASCEND.BY_K[a]);
        if (known && !(Math.floor(Number(rk[a]) || 0) > 0)) delete state.fasc.active;
      } else if (state.fasc.active !== undefined) {
        delete state.fasc.active;                 // a non-string is not a doctrine key
      }
    }
    // seed the currency guard from the loaded save, and convert any `null` that
    // a previous corrupt write left behind (the walk above only sees numbers —
    // typeof null is 'object', so a nulled balance slipped straight past it)
    guardCurrencies();
    // AUTO FIGHTING IS THE SESSION DEFAULT (Aug 2026). `auto` persists, so a
    // pilot who flew manual last session came back with the ship sitting idle —
    // every session now BOOTS in autopilot and the toggle is a per-session
    // choice, the right shape for an idle game.
    state.auto = true;
    // …AND THE MANUAL LATCH IS A SESSION FLAG, cleared on the same beat. This is
    // the one place it is dropped: armAuto() used to clear it on every deploy,
    // which took the choice away from a pilot who had just made it. Clearing it
    // here still means no historic latch can outlive a reload.
    state.autoManual = false;
    // GRANDFATHER THE FORTRESSES THIS ACCOUNT ALREADY HOLDS. The natural-citadel
    // budget (5 per 100 levels, galaxy.js) retires 48 of the 73 the old 3% roll
    // produced. A tile nobody holds simply becomes a boss tile, which is the point
    // of the pass — but a pilot who already SIEGED one of them would otherwise find
    // their richest holding demoted to an ordinary hex with no notice and no way
    // back, which is the one thing a balance change must never do. Read-only: this
    // asks the save what it owns and tells the map; it writes nothing.
    // GRANDFATHERING RETIRED (737) — GX.grandfather() is a no-op and the retired 48
    // generate as ordinary tiles. A citadel already standing on one keeps paying as
    // a citadel; see the alternatives note in tileRateOf(). Nothing to replay here.
    // …AND IMMEDIATELY AFTER IT, because grandfather() regenerates tiles as full
    // fortresses and this is the only thing that puts a razed one back down. Must
    // stay below the grandfather block: the order is the whole fix.
    try { reapplyRazings(); } catch (e) { try { console.warn('[LOOTFLEET] razing replay skipped', e); } catch (e2) {} }
    if (fixed) { try { console.warn('[LOOTFLEET] save repair: reset ' + fixed + ' non-finite field(s) — report this count if a crash follows'); } catch (e) {} }
    return fixed;
  }
  function load() { try { try { if (window.__lfPrevBoot === undefined) window.__lfPrevBoot = localStorage.getItem('lf_boot'); localStorage.setItem('lf_boot', 'load-save'); } catch (e2) {} const obj = window.ACCOUNT ? window.ACCOUNT.load() : JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!obj) return false; Object.assign(state, JSON.parse(JSON.stringify(obj))); sanitizeSave(); return true; } catch (e) { return false; } }

  // Rich offline sim (always on — free). Simulates kills, loot (auto
  // collected), gold, xp, AND deaths (lost items), just like live play.
  function computeOffline() {
    const elapsed = Math.min(offlineCapHours() * 3600, (Date.now() - state.lastSave) / 1000);
    if (elapsed < 60) return null;
    refreshStats();
    const d = state.currentDungeon;
    const hp = C.enemyHp(d), dmg = C.enemyDamage(d);
    const kps = Math.min(5, Math.max(0.05, rt.stats.theoryDps / hp));
    const kills = Math.floor(kps * elapsed * 0.55);
    const xp = inVoidSystem() ? 0 : kills * killXpFor(d), gold = kills * C.enemyGold(d);
    state.totalKills += kills; state.gold += gold;
    // loot: roll drops, auto-collect best-by-slot, sell the rest implicitly kept
    // VOID / CASINO tiles pay no fittings, awake or asleep — the inflated zone
    // number would roll offline loot far above the pilot's real progress.
    let found = 0, lostCount = 0; const newItems = [];
    const dropP = inVoidSystem() ? 0 : C.dropChance(d);
    for (let i = 0; i < kills; i++) {
      if (Math.random() < dropP * (isSwarmZone(d) ? SWARM_DROP_MULT : 1)) { found++; const _q = isSwarmZone(d) ? 1 : qualityMult(d); let _it = _q > 1 ? I.generate(d, rollRarityBoosted(d, _q)) : I.generate(d); if (isSwarmZone(d) && _it.rarity > 0) _it = I.generate(d, Math.max(0, _it.rarity - SWARM_RARITY_PENALTY)); if (newItems.length < 40) newItems.push(_it); }
    }
    // AUTO-EQUIP ONLY INTO A SLOT THIS HULL ACTUALLY HAS. `state.equipped[slot]`
    // was assigned blind, so an offline-found Fighter Bay landed in
    // equipped.fighter on a hull with no bay at all — its stat lines then counted
    // for free, bypassing canMountWeapon() entirely. Anything the hull cannot
    // mount goes to the hold instead.
    const _slots = C.shipSlots(state.ship);
    newItems.forEach((it) => { countRareFind(it);
      const _ok = _slots.indexOf(it.slot) >= 0 && canMountWeapon(it, state.ship);
      if (_ok && !state.equipped[it.slot]) state.equipped[it.slot] = it;
      else if (state.inventory.length < invCap()) state.inventory.push(it); else addSalvage(it); });
    state.itemsFound += found;
    // deaths: estimate from how dangerous the zone is
    const lethal = dmg / (rt.stats.maxHp || 1);
    const deaths = Math.floor(Math.max(0, lethal - 0.06) * elapsed / 60 * 0.8);
    for (let i = 0; i < deaths; i++) { if (dropOnDeath()) lostCount++; }
    refreshStats();
    gainXp(xp);
    return { elapsed, kills, xp, gold, found, lost: lostCount };
  }

  // RETURN BRIEF — combat and tile income are both already banked by the time
  // this runs; the brief only REPORTS them. `since` is read before either
  // accrual so the galaxy-events list covers the true absence, not zero.
  const RETURN_MIN_MS = 5 * 60 * 1000;   // shorter than this is a tab switch, not a return
  function reportReturn(since, combat, tiles) {
    if (!since || Date.now() - since < RETURN_MIN_MS) return;
    const rawH = Math.max(0, (Date.now() - (since || Date.now())) / 3600000);
    const capH = offlineCapHours();
    const payload = {
      elapsed: combat ? combat.elapsed : Math.min(capH * 3600, rawH * 3600),
      since: since || 0, combat, tiles,
      capH, cappedOut: rawH > capH + 0.05,
      capBonus: capH - 12,
    };
    // A LONG absence only. The return brief is already on screen, so the offer
    // waits for the next screen change rather than stacking two sheets.
    if (rawH >= 6) { try { setTimeout(() => { window.PROOFFER && PROOFFER.maybe('offline'); }, 1200); } catch (e) {} }
    try {
      if (window.RETURNBRIEF) { window.RETURNBRIEF.show(payload); return; }
    } catch (e) {}
    // Fallback to the original combat-only modal if the module didn't load.
    try { if (combat && window.UI) window.UI.showOffline(combat); } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------
  // THE CANVAS BACKING STORE IS THE BIGGEST SINGLE LEVER ON A PHONE. A 3× DPR
  // handset fills nine times the pixels of a 1× one for the identical scene, so
  // the graphics tier caps it before anything else is considered.
  function dpr() {
    let cap = 2;
    try { if (window.PERF) cap = window.PERF.dprCap(); } catch (e) {}
    return Math.min(cap, window.devicePixelRatio || 1);
  }
  function resize() {
    const c = rt.canvas; if (!c || !rt.ctx) return;
    const cw = c.offsetWidth, ch = c.offsetHeight, d = dpr();
    // A HIDDEN CANVAS HAS NO BOX. Re-fitting to 0×0 destroys the backing store and
    // leaves the last good fit unrecoverable; keep what we had until it is on
    // screen again (the fit guard in step() picks it up on the first live frame).
    if (!cw || !ch) return;
    c.width = Math.round(cw * d); c.height = Math.round(ch * d);
    rt.ctx.setTransform(d, 0, 0, d, 0, 0);
    rt.w = cw; rt.h = ch;
    fitWorld(state.currentDungeon);
    if (rt.archer && (rt.archer.x === 0 || rt.archer.x > rt.worldW)) { rt.archer.x = rt.worldW/2; rt.archer.y = rt.worldH/2; }
    // SNAP THE CAMERA. resize() rebuilds the world box and the zoom, which moves
    // the camera's TARGET without the ship having moved at all — and update()
    // only glides toward it (a snap needs a >60%-of-a-screen jump). The result
    // was the camera sliding away from a stationary ship after any layout
    // change: on mobile, showing the joystick when you leave AUTO, or the
    // browser's own chrome/keyboard resizing the viewport, is exactly that.
    if (rt.cam && rt.archer && rt.cam.x != null) {
      const z = rt.zoom || 1, visW = rt.w / z, visH = rt.h / z;
      rt.cam.x = rt.worldW <= visW ? (rt.worldW - visW) / 2 : Math.max(0, Math.min(rt.worldW - visW, rt.archer.x - visW / 2));
      rt.cam.y = rt.worldH <= visH ? (rt.worldH - visH) / 2 : Math.max(0, Math.min(rt.worldH - visH, rt.archer.y - visH / 2));
    }
  }
  function initPortrait() {
    rt.portraitCanvas = document.getElementById('portrait-canvas');
    if (!rt.portraitCanvas) return;
    const pr = rt.portraitCanvas, d = dpr();
    rt.portW = pr.offsetWidth || 240; rt.portH = pr.offsetHeight || 200;
    pr.width = rt.portW * d; pr.height = rt.portH * d;
    rt.portraitCtx = pr.getContext('2d'); rt.portraitCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function currentWeek() {
    // ISO-ish week index since a fixed Monday epoch (2024-01-01 was a Monday)
    const epoch = Date.UTC(2024, 0, 1);
    return Math.floor((Date.now() - epoch) / (7 * 24 * 3600 * 1000));
  }

  function init() {
    rt.canvas = document.getElementById('game-canvas');
    rt.ctx = rt.canvas.getContext('2d');
    // tap a parked hull in the hangar bay to switch to it
    rt.canvas.addEventListener('click', (e) => {
      if (state.currentDungeon >= 1 || !rt.hangarHits || !rt.hangarHits.length) return;
      const rect = rt.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * rt.w;
      const y = (e.clientY - rect.top) / rect.height * rt.h;
      let best = null, bd = Infinity;
      for (const hreg of rt.hangarHits) {
        if (hreg.active) continue;
        const d = Math.hypot(x - hreg.x, y - hreg.y);
        if (d <= hreg.r && d < bd) { bd = d; best = hreg; }
      }
      if (best && switchShip(best.key) && window.UI) {
        window.UI.unlockToast('Now flying the ' + (C.SHIP_BY_KEY[best.key] || {}).name);
      }
    });
    const loaded = load();
    rt.archer = new E.Archer(0, 0);
    resize();
    initPortrait();
    window.addEventListener('resize', () => { resize(); });
    // iOS Safari changes the drawable box without a window resize: its own chrome
    // collapsing, a rotation settling, or the page being restored from the back /
    // forward cache. All three end in the same broken-canvas state, so all three
    // re-fit explicitly rather than waiting for the ~8Hz guard in step().
    try {
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => resize());
        window.visualViewport.addEventListener('scroll', () => resize());
      }
    } catch (e) {}
    window.addEventListener('pageshow', () => resize());
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));

    // assign heat (start week) for new accounts
    if (state.startWeek == null) { state.startWeek = currentWeek(); save(); }

    // migrate older saves to the ship/blueprint/drone fields
    if (!state.shipKills) state.shipKills = {};
    if (state.shipKills[state.ship] == null) state.shipKills[state.ship] = 0;
    if (!state.blueprints) state.blueprints = {};
    if (state.drones == null) state.drones = 0;
    if (!state.droneBays) state.droneBays = {};
    // SEED THE CAREER LOOT COUNTER, ONCE. lifetimeLooted rode through ascension
    // in ASC_KEEP but was never actually incremented, so every account read 0 and
    // both readers fell back to the hold's length. Seeding it with exactly what
    // the old formula displayed means no progress bar moves backwards today.
    if (state.lifetimeLooted == null) state.lifetimeLooted = (state.inventory || []).length;
    // ---- ONE-TIME GLOBAL PILOT ASCENSION RESET (epoch 1) ---------------------
    // A bug let pilots rush ascensions. It is fixed, and the community agreed to
    // a clean slate rather than a selective claw-back. Stars, points and perks go
    // to zero for everyone, exactly once.
    //
    // `pasc.epoch` is what makes it STICK. Every rule in account.js exists to stop
    // ascension progress from regressing — stars outrank weight and timestamps in
    // mergeSaves, and stars/points/perks are max-unioned so they can never drop.
    // Correct for a normal timeline, fatal for a deliberate wipe: without an epoch
    // the 0-star save loses to the pre-reset cloud copy and the reset is undone at
    // the next login, on every device, forever. saveWeight() and mergeSaves() now
    // compare the epoch ABOVE stars, so a reset save reads as the later timeline.
    // Bump PASC_EPOCH to run another reset later.
    const PASC_EPOCH = 1;
    if (!state.pasc) state.pasc = { stars: 0, pts: 0, spent: 0, perks: {}, legacy: null, hist: [] };
    if ((state.pasc.epoch | 0) < PASC_EPOCH) {
      const p = state.pasc;
      // FULL PRE-RESET SNAPSHOT. Stars and points alone would not be enough to
      // put a specific pilot back: the level clamp and the skill wipe below are
      // the parts that cannot be reconstructed from anything else in the save.
      // Nothing reads this for gameplay — it exists so a future epoch 2 (or a
      // support grant) can restore an individual account if this goes wrong.
      const before = {
        stars: p.stars | 0, pts: p.pts | 0, spent: p.spent | 0,
        perks: JSON.parse(JSON.stringify(p.perks || {})),
        level: state.level | 0, xp: state.xp || 0,
        skillPoints: state.skillPoints | 0,
        skills: JSON.parse(JSON.stringify(state.skills || {})),
        tiles: Object.keys(state.ownedSystems || {}),
        citadels: JSON.parse(JSON.stringify(state.citadels || {})),
        at: Date.now(), build: (window.LF_BUILD | 0) || 0,
      };
      p.stars = 0; p.pts = 0; p.spent = 0; p.perks = {}; p.legacy = null;
      p.entitled = Array.isArray(p.entitled) ? p.entitled : [];   // event/premium hulls stay
      if (!Array.isArray(p.hist)) p.hist = [];
      p.epoch = PASC_EPOCH;
      p.resetAt = Date.now();
      p.preReset = before;   // support record only — no gameplay path reads it
      // LEVEL CAP RETURNS TO 150 (cap = 150 + 50 per star). Hard clamp, and
      // rebuild the skill budget with it: a pilot left holding 550 levels' worth
      // of skill points at level 150 would carry the whole advantage through the
      // reset. Spent ranks are refunded into a level-150 budget to respend.
      const cap = C.levelCap(0);
      if ((state.level | 0) > cap) {
        state.level = cap; state.xp = 0;
        state.skills = {};
        state.skillPoints = Math.max(0, (cap - 1) * ((C.SKILLS && C.SKILLS.pointsPerLevel) || 1));
      }
      // ---- GALAXY / TERRITORY / CASINO WIPE (same epoch, one clean slate) ----
      // TERRITORY IS SERVER-AUTHORITATIVE. `ownedSystems` is only a mirror of the
      // `territory` table, so clearing it here is HALF the job — the SQL in
      // supabase/reset-territory.sql is the other half, and the ORDER MATTERS
      // (see that file's header). What this side must guarantee is that no client
      // ever pushes its old holdings back up: republishOwnedTiles() exists to
      // re-send conquests the server missed, and against a freshly truncated
      // table it would repopulate the entire map from local mirrors. Latching
      // `_turfRepub2` retires that path permanently for this epoch.
      state.ownedSystems = {};      // tiles, Void spires and House Citadel holds
      state.citadels = {};          // player-built citadels and their levels
      state.rivalCitadels = {};
      state.rivalTiles = {};        // simulated owners — the map returns fully neutral
      state.tileCd = {};            // contest cooldowns and attack shields
      state.razedCitadels = {};
      state.currentSystem = null;   // never leave a pilot deployed to a tile that no longer exists
      state._turfRepub2 = 1;        // republish retired — must not refill the truncated table
      try { rt.realTiles = {}; } catch (e) {}
      // CASINO — chips, bet size and the win/loss books. Resources and gold
      // already banked are NOT touched anywhere in this migration, by decision.
      state.casino = null;          // casino.js cas() rebuilds it fresh on next open
      refreshStats();
      save();
      try { console.warn('[LOOTFLEET] pilot ascension reset → epoch ' + PASC_EPOCH + ' (was ' + before.stars + '★, level ' + before.level + ')'); } catch (e) {}
      try {
        if (window.UI && window.UI.unlockToast) setTimeout(() => {
          try { window.UI.unlockToast('★ SEASON RESET — ascension, the galaxy and the casino are wiped for every pilot. Your hulls, gear, currencies and Home Citadel are untouched.'); } catch (e) {}
        }, 1400);
      } catch (e) {}
    }
    // ---- GALAXY v3 migration: regions → one massive unified hex grid --------
    if (state.galaxyVer !== 3) {
      state.ownedSystems = {};            // the Home Citadel is neutral — no starter tile
      state.rivalTiles = {}; state.tileCd = {}; state.currentSystem = null;
      delete state.regionCd;
      state.galaxyVer = 3;
    }
    if (!state.rivalTiles) state.rivalTiles = {};
    if (!state.tileCd) state.tileCd = {};
    if (!state.galaxyFeed) state.galaxyFeed = [];
    // SPEED-TIER ENTITLEMENT CHECK. Rewritten Aug 2026 — the old two-liner had a
    // hole: the first clause skipped anything sitting at exactly 5, and the
    // second demoted a 5 without Pro, but NOTHING re-validated a 10 whose
    // secretSpeed had gone missing except that same first clause, which then
    // dropped it to 1 with no way back (the HUD hides the 10× pill when
    // secretSpeed is false, so the highest tier a Pro player can still see and
    // tap is 5× — that is the "it resorts to 5×" report). Now each tier is
    // validated against its OWN entitlement, 10× first, and an earned 10× is
    // never touched.
    // BUILD 712 — THE LADDER IS 1 / 2 / 3 (+10 secret). 4× and 5× are gone, and
    // a save can be sitting on either, so they are MIGRATED rather than reset to
    // 1×: a player who paid for the old 4× lands on the paid 2×, and a Pro member
    // on 5× lands on Pro's 3×. Dropping them to 1× would read as the release
    // having taken their speed away, which is exactly what it must not do.
    if (state.gameSpeed === 5) state.gameSpeed = isPro() ? 3 : 1;
    else if (state.gameSpeed === 4) state.gameSpeed = (state.purchases && state.purchases.speed4lc) ? 2 : 1;
    // …and each surviving tier is then validated against its OWN entitlement,
    // 10× first, so an earned 10× is never touched.
    if (state.gameSpeed === 10) {
      if (!state.secretSpeed) state.gameSpeed = 1;          // never unlocked, or a tampered save
    } else if (state.gameSpeed === 3) {
      if (!isPro()) state.gameSpeed = 1;                    // Pro lapsed → drop the 3× tier
    } else if (state.gameSpeed === 2) {
      if (!(state.purchases && state.purchases.speed4lc)) state.gameSpeed = 1;   // 2× needs its LootCoin unlock
    } else if (state.gameSpeed !== 1) {
      state.gameSpeed = 1;                                  // anything else out of range
    }
    // ---- COSMETICS + CREDITS (premium currency) ----
    if (!state.cosmetics) state.cosmetics = { owned: { stock: 1, none: 1 }, skin: 'stock', aura: 'none' };
    if (!state.cosmetics.owned) state.cosmetics.owned = { stock: 1, none: 1 };
    // One-time founder grant, halved with every other LootCoin payout in the Aug
    // 2026 pass (build 614). Only ever applies to a save that has never had a
    // credits field, so no existing account is touched.
    if (state.credits == null) state.credits = 250;
    // ---- PILOT PROGRESSION + DREADNAUGHT HUNT ----
    if (state.dreadCores == null) state.dreadCores = 0;          // rare currency: only from Dreadnaughts
    if (!state.pilot) state.pilot = { nodes: { '0,0': 1 } };     // hex skill tree: { 'q,r': 1 } unlocked nodes
    if (!state.pilot.nodes) state.pilot.nodes = {};
    state.pilot.nodes['0,0'] = 1;                                // origin core is always unlocked
    if (!state.dreadLock) state.dreadLock = {};                  // weekly lockout: { tier: ISO-week completed }
    state.dreadRun = null;                                       // a hunt never resumes across a reload
    if (state.kothCrowns == null) state.kothCrowns = 0;          // lifetime KOTH #1 finishes
    // THE MECH FOUNDRY. `mechCores` is a wallet — floored, never negative, and
    // never `| 0` (a career total passes the signed-32-bit ceiling and would wrap
    // negative). `mech` is the lifetime record. `mechRun` is LIVE-RUN ONLY: a run
    // interrupted by a reload is simply over, and clearing it here is safe because
    // nothing is banked until the tier boss dies — there is no pending payout to
    // strand, and leaving it armed would deploy the wave engine into whatever zone
    // the pilot loaded into.
    state.mechCores = Math.max(0, Math.floor(Number(state.mechCores) || 0));
    if (!state.mech || typeof state.mech !== 'object') state.mech = { best: 0, runs: 0, kills: 0, earned: 0 };
    if (state.mech.earned == null) state.mech.earned = 0;
    // BACKFILL, DON'T DEFAULT. `earned` (lifetime cores won) was added after the
    // Foundry shipped, so every save that had already run tiers carried real
    // progress with a zero next to it — and the two systems built on it, the Core
    // Harvest mission and the Corruption Engineer badge chain, both read that zero
    // for exactly the pilots who had played the event.
    //
    // The WALLET is a provable floor on lifetime earned: cores are only ever
    // created by clearing a tier, so a pilot holding 320 has earned at least 320.
    // Seeding from it recovers the understated part of a real career total instead
    // of starting it from nothing. Max, never assign — a pilot who has already
    // spent more than they hold must not have their total dragged down to it.
    if (!state.cmdr || typeof state.cmdr !== 'object') state.cmdr = { own: {}, slot: null, dust: 0, pulls: 0 };
    if (!state.cmdr.own || typeof state.cmdr.own !== 'object') state.cmdr.own = {};
    state.cmdr.dust = Math.max(0, Math.floor(Number(state.cmdr.dust) || 0));
    state.cmdr.pulls = Math.max(0, Math.floor(Number(state.cmdr.pulls) || 0));
    state.mech.earned = Math.max(
      Math.floor(Number(state.mech.earned) || 0),
      Math.floor(Number(state.mechCores) || 0)
    );
    state.mechRun = null;
    try { syncCrownBlueprints(); } catch (e) {}
    if (!state.fleet) state.fleet = [];
    if (!state.citadelCd) state.citadelCd = {};
    if (!state.citadels) state.citadels = {};          // YOUR player-built citadels { tileId:{score} } (cap 5)
    if (!state.rivalCitadels) state.rivalCitadels = {}; // rival player citadels we can attack (sim + shared)
    if (!state.razedCitadels) state.razedCitadels = {}; // natural citadel tiles you've razed → now plain tiles { tileId:true }
    // Re-apply razings to the (regenerated) tile cache so a razed citadel stays a
    // plain, buildable tile across reloads — no more permanent siege zone.
    // sanitizeSave() runs this too; see reapplyRazings().
    reapplyRazings();
    // ---- ZONE-CAP: keep exactly 10 zones unlocked beyond the pilot's level (and
    // within the current 100-block). This both GRANTS the level+10 runway to fresh
    // pilots and CORRECTS saves from the old, looser unlock curve. Since pilot
    // level only ever rises, this never revokes legitimately-earned zones.
    {
      const ceil = Math.max(1, Math.min(C.zoneCap(state.highestDungeonReached || 1), unlockCeil(state.level || 1)));
      state.highestUnlocked = ceil;
      // only clamp classic free-play deploys; galaxy-tile combat is uncapped by design
      if (!state.currentSystem && state.currentDungeon > state.highestUnlocked) {
        state.currentDungeon = state.highestUnlocked;
      }
    }
    seedRivals();
    // light offline seeding so player-citadel ATTACKS are playable solo (shared
    // turf war overrides this the moment real citadels stream in via territory).
    if (state.rivalCitadels && Object.keys(state.rivalCitadels).length === 0) {
      let _s = 24611; const _r = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
      Object.keys(state.rivalTiles || {}).forEach((id) => { if (_r() < 0.14) { const tt = sysAt(id); if (tt) state.rivalCitadels[id] = Math.round(2500 * Math.pow(1.7, (tt.ring || 1))); } });
    }
    galaxyTick(); // catch up rival turf wars from time spent away

    // ---- ONE-TIME RESCALE migration (steep 1.55 curve → gentle 1.18 curve) ----
    // Compress stored gear/gold so an existing save lines up with the new,
    // slower number curve. Only the zone-scaled FLAT stats (damage/health) ride
    // the curve, so only those are rescaled; percent stats are left alone.
    // RETIRED (Aug 2026) — it divided every flat stat AND all gold by
    // ratio^(zone-1). At zone 100+ that factor is ~1e-13, so billion-power gear
    // collapsed to "+1 Damage / +1 Health", gold floored to 0 and xp was zeroed.
    // And it re-ran on EVERY login: the crushed save couldn't always reach the
    // cloud, so the un-stamped copy came back and got crushed again. Never again
    // — saves are stamped and left exactly as they are.
    state.scaleVer = 3;

    // ---- REPAIR: rebuild gear the retired rescale crushed --------------------
    // Only fires on values that are physically impossible for the item's OWN
    // zone + rarity (generation floor is 0.82× the base roll, so anything under
    // 2% of it was destroyed, not rolled). Idempotent: healthy gear never moves.
    if (loaded) {
      let fixedItems = 0;
      const FLAT_KEYS = ['attackDamage', 'health'];
      const repairItem = (it) => {
        if (!it || !it.stats || (it.dungeon || 1) < 5) return;
        const rar = C.RARITY[it.rarity || 0]; if (!rar) return;
        const zs = C.dungeonScale(it.dungeon);
        FLAT_KEYS.forEach((k) => {
          const cur = it.stats[k]; if (cur == null) return;
          const def = C.STATS[k]; if (!def) return;
          const expect = def.base * zs * rar.mult;
          if (cur < expect * 0.02) { it.stats[k] = Math.max(1, Math.round(expect * 0.9)); fixedItems++; }
        });
      };
      Object.keys(state.equipped || {}).forEach((k) => repairItem(state.equipped[k]));
      (state.inventory || []).forEach(repairItem);
      Object.keys(state.fittings || {}).forEach((sk) => { const fit = state.fittings[sk]; if (fit) Object.keys(fit).forEach((k) => repairItem(fit[k])); });
      // GOLD RESCUE — REMOVED (Aug 2026). It read the lf-best/lf-backup local
      // snapshots and "restored" the larger balance whenever goldRepairVer was
      // unset. Pilot Ascension deliberately zeroes gold AND resets that stamp,
      // so the next load handed every ascended pilot their entire pre-ascension
      // hoard back (the "105 DDc after ascending" bug). The crush incident it
      // patched is long migrated; nothing may resurrect gold from snapshots.
      if (fixedItems) {
        refreshStats(); save();
        setTimeout(() => { try {
          window.UI && window.UI.unlockToast && window.UI.unlockToast(
            '✔ Loadout restored — ' + fixedItems + ' crushed stat' + (fixedItems > 1 ? 's' : '') + ' rebuilt');
        } catch (e) {} }, 1800);
      }
    }
    // ---- ONE-TIME RESCALE v4 (Aug 2026): taper migration -----------------------
    // dungeonScale now tapers past zone 100 (see config-v2.js), so gear generated
    // on the old pure-exponential curve carries stats up to ~1e17\u00d7 too large for
    // the new economy. This maps every old-curve value onto the new curve while
    // preserving what actually matters: the player's ROLL (variance vs the
    // formula) and their WEALTH measured in kills-at-their-depth.
    //
    // Built against the failure modes of the retired v3 rescale, in order:
    //   \u00b7 RE-DERIVED, never divided \u2014 each stat is recomputed from the item's own
    //     zone + rarity on the new curve, so nothing can collapse to "+1".
    //   \u00b7 SCALE-DETECTED, so a lost stamp cannot crush twice: values already at
    //     new-curve magnitude are skipped outright.
    //   \u00b7 Zone \u2264100 gear is untouched \u2014 the curves are identical there.
    //   \u00b7 Percent stats are untouched \u2014 they never rode the curve.
    if (loaded && state.scaleVer !== 4 && !window.__lfSafeBoot) try {
      let rescaled = 0;
      const FLAT4 = ['attackDamage', 'health'];
      const remap = (it) => {
        if (!it || !it.stats || (it.dungeon || 1) <= 100) return;
        const rar = C.RARITY[it.rarity || 0]; if (!rar) return;
        const sNew = C.dungeonScale(it.dungeon), sOld = C.dungeonScaleLegacy(it.dungeon);
        FLAT4.forEach((k) => {
          const cur = it.stats[k]; if (cur == null) return;
          const def = C.STATS[k]; if (!def) return;
          const expNew = def.base * sNew * rar.mult;
          if (cur <= expNew * 2) return;              // already new-scale \u2014 double-run guard
          const variance = Math.max(0.5, Math.min(1.5, cur / (def.base * sOld * rar.mult)));
          it.stats[k] = Math.max(1, Math.round(expNew * variance));
          rescaled++;
        });
      };
      Object.keys(state.equipped || {}).forEach((k) => remap(state.equipped[k]));
      (state.inventory || []).forEach(remap);
      Object.keys(state.fittings || {}).forEach((sk) => { const fit = state.fittings[sk]; if (fit) Object.keys(fit).forEach((k) => remap(fit[k])); });
      // WEALTH \u2014 gold/salvage scale by the income ratio at the save's own depth,
      // which preserves purchasing power in kills exactly: a hoard worth 2e9
      // kills of farming before is worth 2e9 kills after. Ceiling-guarded so a
      // re-run (or an already-sane save) is a no-op.
      const hz = Math.max(1, state.highestDungeonReached | 0);
      if (hz > 100) {
        const rGold = Math.pow(C.dungeonScale(hz) / C.dungeonScaleLegacy(hz), 0.7);
        const rDmg = C.dungeonScale(hz) / C.dungeonScaleLegacy(hz);
        if ((state.gold || 0) > 1e18) state.gold = Math.floor(state.gold * rGold);
        if ((state.salvage || 0) > 1e18) state.salvage = Math.floor(state.salvage * rGold);
        // damage-denominated records: citadel garrison scores + season boss totals
        const reScore = (o, k) => { if (o && (o[k] || 0) > 1e15) o[k] = Math.floor(o[k] * rDmg); };
        Object.keys(state.citadels || {}).forEach((id) => reScore(state.citadels[id], 'score'));
        Object.keys(state.rivalCitadels || {}).forEach((id) => reScore(state.rivalCitadels[id], 'score'));
        if (state.sdread) { reScore(state.sdread, 'total'); reScore(state.sdread, 'bestDay'); }
      }
      state.scaleVer = 4;
      if (rescaled) {
        refreshStats(); save();
        try { console.warn('[LOOTFLEET] scale v4: ' + rescaled + ' stat(s) mapped onto the tapered curve'); } catch (e) {}
        setTimeout(() => { try { window.UI && window.UI.unlockToast && window.UI.unlockToast('\u2696 Galaxy-wide rebalance \u2014 your gear kept its roll, the numbers got readable'); } catch (e) {} }, 1800);
      }
    } catch (e) { try { console.error('[LOOTFLEET] scale v4 migration failed — deferred to next boot', e); } catch (e2) {} }
    // ---- ONE-TIME crit nerf migration: compress item crit onto the new ladder ----
    if (state.critVer !== 4) {
      const capCrit = (it) => { if (it && it.stats && it.stats.critChance != null) it.stats.critChance = Math.min(it.stats.critChance, Math.round((0.005 + (it.rarity || 0) * 0.01) * 1180) / 1000, 1); };
      Object.keys(state.equipped || {}).forEach((k) => capCrit(state.equipped[k]));
      (state.inventory || []).forEach(capCrit);
      Object.keys(state.fittings || {}).forEach((sk) => { const fit = state.fittings[sk]; if (fit) Object.keys(fit).forEach((k) => capCrit(fit[k])); });
      state.critVer = 4;
      if (loaded) save();
    }
    // ---- ONE-TIME LIFESTEAL CUT: every source in the game dropped 80% -------
    // Sustain had become the dominant stat — in PvP it made both fleets literally
    // unkillable. Hull mods, skill/pilot trees and new drops are all rebalanced in
    // config; this scales the lifesteal ALREADY rolled onto live gear, so nobody
    // keeps a pre-nerf fitting wherever it happens to be stowed.
    // A FIGHTER CARRIER MUST NEVER BE UNARMED — but NOT on the boot thread.
    //
    // This began as a one-time migration (603) latched behind `fbaySeed`, which was the
    // wrong shape: a bay can empty long after that ran (a sale, an auto-sell pass, or a
    // hull swap that stashes gear into `state.fittings` without restoring all of it), and
    // a carrier with no bay has NO WEAPON AT ALL — no cannon hardpoint to fall back on and
    // no craft to launch. So it has to run on every load.
    //
    // 643 ran it INLINE HERE, inside migrateSave() on the synchronous boot path, and
    // wedged the page: item generation plus refreshStats() plus save(), for every owned
    // carrier, in the same first-frame window the watchdog already reports boots dying in
    // ("died during: first-frame"). Reloads stopped completing at all.
    //
    // Deferred behind the first frame instead. Nothing about topping up a bay needs to
    // happen before the game is on screen, and seedFighterBays() only ever fills EMPTY
    // bays — it is a no-op on a fully fitted carrier — so running it late cannot disturb a
    // fitting that is already there.
    setTimeout(() => {
      try {
        let seeded = 0;
        Object.keys(state.ownedShips || {}).forEach((k) => {
          if ((C.SHIP_BY_KEY[k] || {}).fighterCapacity) seeded += seedFighterBays(k);
        });
        if (seeded) { state.fbaySeed = 1; save(); }
      } catch (e) {}
    }, 3000);
    if (state.lsVer !== 1) {
      const cutLS = (i2) => { if (i2 && i2.stats && i2.stats.lifeSteal) i2.stats.lifeSteal = Math.round(i2.stats.lifeSteal * 0.2 * 10) / 10; };
      Object.keys(state.equipped || {}).forEach((k) => cutLS(state.equipped[k]));
      (state.inventory || []).forEach(cutLS);
      Object.keys(state.fittings || {}).forEach((sk) => { const fit = state.fittings[sk]; if (fit) Object.keys(fit).forEach((k) => cutLS(fit[k])); });
      state.lsVer = 1;
      if (loaded) save();
    }

    // ---- boot breadcrumbs (account-specific crash diagnosis) -----------------
    // Written to sessionStorage so a frozen/OOM-killed boot — which throws no
    // exception — still names its last phase on the NEXT load. The repair count
    // from sanitizeSave() rides along.
    const bootMark = (ph) => { try { localStorage.setItem('lf_boot', ph); } catch (e) {} };
    const SAFE_BOOT = false;   // master switch — see the note at the arming site below
    try {
      // read the CAPTURED pre-boot marker — load() has already stamped
      // 'load-save' over the storage slot by the time init runs, which is why
      // the recovery banner never fired (the crash marker was self-erased)
      const prev = (window.__lfPrevBoot !== undefined) ? window.__lfPrevBoot : localStorage.getItem('lf_boot');
      if (prev === 'alive') {
        // Last session reached play and died WITHOUT a clean exit — a mid-combat
        // freeze/OOM. This is the reload-loop case: boot is fine, so no safe boot
        // fires, the game auto-resumes the same combat and dies again seconds
        // later — which players report as “the site won’t load”. Enter PLAY
        // RECOVERY: hard-trim visual effects this session so the killer effect
        // cannot re-balloon before the player can react.
        window.__lfPlayRecovery = true;
      } else if (prev && prev !== 'clean-exit') {
        console.warn('[LOOTFLEET] previous boot never finished — it died during: ' + prev + '. Send this line with a bug report.');
        window.__lfBootDiedAt = prev;
        // SAFE BOOT — DISABLED (Aug 2026). The environment is stable, and the
        // banner was firing off stale `lf_boot` breadcrumbs left in storage by
        // long-dead sessions, so returning players met a crash warning about a
        // failure that never happened to them. The breadcrumbs and the console
        // line above still record the dying phase for diagnostics — only the
        // player-facing degrade-and-warn behaviour is off. Flip SAFE_BOOT back
        // to true to restore skipping the offline sim, return brief and v4 remap.
        if (SAFE_BOOT) window.__lfSafeBoot = true;
      }
    } catch (e) {}
    // a reload or navigation is NOT a crash — mark it clean so recovery only
    // ever arms on a genuine freeze/OOM kill
    window.addEventListener('pagehide', () => { try { localStorage.setItem('lf_boot', 'clean-exit'); } catch (e) {} });
    // capture real JS errors too — an exception-crash stores its message and
    // the next boot displays it even when every marker claims a clean exit
    try {
      window.addEventListener('error', (ev) => { try { localStorage.setItem('lf_err', ((ev.message || 'error') + ' @ ' + String(ev.filename || '').split('/').pop() + ':' + (ev.lineno || 0)).slice(0, 200)); } catch (x) {} });
      window.addEventListener('unhandledrejection', (ev) => { try { localStorage.setItem('lf_err', ('promise: ' + ((ev.reason && ev.reason.message) || ev.reason)).slice(0, 200)); } catch (x) {} });
    } catch (e) {}
    let _prevErr = '';
    try { _prevErr = localStorage.getItem('lf_err') || ''; if (_prevErr) localStorage.removeItem('lf_err'); } catch (e) {}
    // Stale crash breadcrumbs from a previous session must not greet a player
    // with a warning banner in a stable build. Clear the marker so the slot is
    // fresh for this session's own forensics.
    if (!SAFE_BOOT) { try { localStorage.removeItem('lf_boot'); } catch (e) {} }
    // CRASH BANNER REMOVED (Aug 2026, temporarily). SAFE BOOT / RECOVERY MODE fire
    // on far more sessions than they diagnose — a phone backgrounding the tab mid
    // combat looks the same as a real freeze — so players were greeted with a
    // "screenshot this and report it" error bar on ordinary logins. The forensics
    // themselves are untouched: lf_err / lf_boot / lf_play breadcrumbs still record,
    // SAFE_BOOT still trims heavy boot steps, and recovery mode still trims effects.
    // Only the banner is silenced. Re-enable by restoring the crashBanner() call.
    void _prevErr;
    bootMark('stats');
    refreshStats();
    rt.archer.hp = rt.stats.maxHp;
    rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH / 2;
    spawnDrones();
    bootMark('nodes');
    buildNodes();
    rt.nodes.forEach((n, i) => { n.respawnT = 0.2 + i * 0.2; });
    rt.bossInit = rt.bossTimer = 600 + Math.random() * 300; rt.bossAlive = false; rt.boss = null; rt.lastBoss = -600;

    const awaySince = state.lastSave || Date.now();
    bootMark('offline-sim');
    let offline = null;
    if (loaded && !window.__lfSafeBoot) { try { offline = computeOffline(); } catch (e) { offline = null; try { console.error('[LOOTFLEET] offline sim failed', e); } catch (e2) {} } }
    // Hourly income from held systems. This return value was thrown away at
    // both call sites — the player earned it and was never shown a digit.
    const awayTiles = accrueResources();

    // Always start docked at the home hangar on (re)login.
    state.currentSystem = null; state.currentDungeon = 0; rt.siege = null; rt.awaitingRespawn = false;
    if (rt.archer) { rt.archer.dead = false; rt.archer.killer = null; }
    resetZone();

    bootMark('ui');
    if (window.UI) { window.UI.init(GAME); window.UI.refreshAll(); }
    bootMark('return-brief');
    if (loaded && !window.__lfSafeBoot) { try { reportReturn(awaySince, offline, awayTiles); } catch (e) {} }
    bootMark('territory');
    initTerritory(); // load + subscribe to the shared cross-account turf war

    setInterval(autosave, 8000);
    setInterval(() => { accrueResources(); }, 60000); // tick resources every minute
    setInterval(galaxyTick, 120000); // tick simulated rival turf wars (gently)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
      else { const bk = state.lastSave || Date.now(); const tl = accrueResources(); const sum = computeOffline(); if (window.UI) window.UI.refreshAll(); reportReturn(bk, sum, tl); rt.last = performance.now(); if (window.TERRITORY && window.TERRITORY.enabled() && (!rt._terrSync || Date.now() - rt._terrSync > 60000)) { rt._terrSync = Date.now(); window.TERRITORY.loadAll().then((m) => { syncRealTiles(m); if (window.UI) window.UI.galaxyChanged(); }); } }
    });
    window.addEventListener('beforeunload', save);

    rt.running = true; rt.last = performance.now();
    bootMark('first-frame');
    // PLAY WATCHDOG — forensics for mid-combat freezes (the class of crash the
    // boot breadcrumbs can't see). Every 10s, snapshot the live array sizes into
    // sessionStorage; after a freeze-kill the NEXT load prints the last sample,
    // naming exactly what was ballooning when the tab died.
    try {
      const prevPlay = localStorage.getItem('lf_play');
      if (prevPlay && (window.__lfPlayRecovery || window.__lfBootDiedAt !== undefined)) console.warn('[LOOTFLEET] last sample before the crash: ' + prevPlay);
      else if (prevPlay) console.info('[LOOTFLEET] last session sample: ' + prevPlay);
    } catch (e) {}
    setInterval(() => {
      try {
        const mem = (performance && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : '?';
        localStorage.setItem('lf_play', JSON.stringify({ t: new Date().toISOString().slice(11, 19), zone: state.currentDungeon, sys: state.currentSystem || 0,
          en: rt.enemies.length, proj: rt.projectiles.length, parts: rt.particles.length, floats: rt.floats.length,
          ground: rt.ground.length, bolts: (rt.bolts || []).length, ebolts: (rt.ebolts || []).length,
          cg: (window.CARGORUN && window.CARGORUN.sample) ? window.CARGORUN.sample() : 0, heap: mem }));
        const mb = (performance && performance.memory) ? performance.memory.usedJSHeapSize / 1048576 : 0;
        if (mb > 1400 && !window.__lfPlayRecovery) engageRecovery('heap ' + Math.round(mb) + 'MB');
      } catch (e) {}
    }, 10000);
    // 'alive' only after the sim has actually survived a few seconds of frames —
    // a boot that dies in its first combat updates (the save-specific case) still
    // reports 'first-frame' rather than a false clean bill.
    setTimeout(() => { try { localStorage.setItem('lf_boot', 'alive'); } catch (e) {} }, 5000);
    requestAnimationFrame(loop);
    setInterval(() => { if (rt.running && !window.__sessionKicked) { const now = performance.now(); if (now - rt.last > 120) { if (yielding(now)) return; step(now); } } }, 1000/30);
  }

  // --------------------------------------------------------------------------
  // FORMAT HELPERS
  // --------------------------------------------------------------------------
  // DISPLAY GAUGE — every number the player SEES is compressed above 1T and
  // hard-capped at 999T. Pure presentation: damage dealt, HP pools, XP and
  // score sources keep their true values internally; only the readout shrinks.
  const GAUGE_T = 1e12;
  function gaugeNum(n) {
    if (n <= GAUGE_T) return n;
    return Math.min(999 * GAUGE_T, GAUGE_T * Math.pow(n / GAUGE_T, 0.55));
  }
  // TRUE values — the 999T display gauge is retired: damage numbers, HP, DPS
  // and every other readout now show the real amount, climbing the extended
  // unit ladder (K, M, B, T, Qa, Qi, …) instead of compressing.
  function formatNum(n) { return formatNumRaw(n); }
  function _formatNumGaugeRetired(n) {
    n = gaugeNum(n);
    if (n < 1000) return Math.floor(n).toString();
    const u = ['', 'K', 'M', 'B', 'T']; let i = 0, v = n;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + u[i];
  }
  // RAW formatter — no 999T gauge. Used for Ship/Fleet Score and gold, which
  // are allowed to grow without a display ceiling.
  function formatNumRaw(n) {
    if (n < 1000) return Math.floor(n).toString();
    // extended ladder (…Dc → UDc → … → Vg) so huge values never print raw digits
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'];
    let i = 0, v = n;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    if (v >= 10 || i === u.length - 1) {
      // MINIMAL: two+ digit values show no decimals ("74No", "999M")
      let r = Math.round(v);
      if (r >= 1000 && i < u.length - 1) { r = 1; i++; }   // 999.6M → 1B, never "1000M"
      return r + u[i];
    }
    return (Math.round(v * 100) / 100) + u[i];
  }
  function formatTime(sec) {
    sec = Math.floor(sec); const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    if (h > 0) return `${h}h ${m}m`; if (m > 0) return `${m}m ${s}s`; return `${s}s`;
  }

  // ---- SHIP HULL UPGRADES — exponential resource cost, +dmg/+hp/+rate per level
  function shipLevel(key) { return (state.shipLevels && state.shipLevels[key]) || 1; }
  // COST TIER IS DERIVED FROM THE HULL'S OWN POWER (Aug 2026), not its position in
  // C.SHIPS. Array order is DISPLAY order — event hulls are appended as they ship —
  // and pricing off the index had drifted into nonsense:
  //
  //   Kaevith Splinter  power 20  (weaker than a Cruiser)  cost ×45,500,000
  //   Cruiser           power 28                            cost ×3.24
  //   Ember Mote        power 28  (same as a Cruiser)       cost ×860,000,000
  //   Kaevith Sovereign power 396 (≈ Mothership's 432)      cost ×127,000 the Mothership
  //
  // A Kaevith Splinter cost fourteen MILLION times a Cruiser to upgrade while being
  // the weaker hull. Deriving the tier from power fixes every one of those and
  // prices any hull added later automatically — there is no list to maintain.
  //
  // The fit is calibrated against the mainline progression so tuned hulls barely
  // move: Battleship 1.02e5 → 1.00e5, Oblivion Final 2.23e9 → 2.15e9, Dread Omega
  // 7.59e10 → 7.18e10. Only the mispriced outliers change materially.
  const HULL_POWER_CACHE = {};
  function hullCostTier(key) {
    if (HULL_POWER_CACHE[key] != null) return HULL_POWER_CACHE[key];
    const s = C.SHIP_BY_KEY[key] || {}; const m = s.mods || {};
    // Same weighting the Ship Score uses in spirit: hull, damage (double, it is
    // the scarcer stat), multishot and crit damage.
    const power = (m.hpPct || 0) + (m.dmgPct || 0) * 2 + (m.multiShot || 0) * 3 + (m.critDamage || 0);
    const tier = Math.max(0, Math.min(34, 5 * Math.log(Math.max(1, power)) - 16));
    HULL_POWER_CACHE[key] = tier;
    return tier;
  }
  function shipUpgradeCost(key) {
    const L = shipLevel(key);
    const idx = hullCostTier(key);
    const tierMul = Math.pow(1.8, idx);
    const goldGrow = 1.95 + idx * 0.06;
    const plasmaGrow = 1.8 + idx * 0.05;
    const resMul = L >= 3 ? 10 : 1;   // 10× the resources to push a hull past Lv 3
    return { gold: Math.round(3000 * tierMul * Math.pow(goldGrow, L - 1)),
             plasma: Math.round(12 * tierMul * Math.pow(plasmaGrow, L - 1) * resMul),
             prism: 0 };   // hull upgrades cost gold + plasma only (Prism is reserved for Prism systems)
  }
  function prismIngots() { return (state.prism && state.prism.ingots) || 0; }
  function shipUpInfo(key) {
    const L = shipLevel(key);
    const cost = shipUpgradeCost(key);
    return { level: L, maxed: L >= 20, cost,
             owned: !!state.ownedShips[key],
             afford: state.gold >= cost.gold && (state.resources.plasma || 0) >= cost.plasma && prismIngots() >= cost.prism,
             bonus: { dmg: (L - 1) * 10, hp: (L - 1) * 12, rate: (L - 1) * 5 } };
  }
  function upgradeShip(key) {
    if (!state.ownedShips[key]) return { ok: false, reason: 'owned' };
    if (!state.shipLevels) state.shipLevels = {};
    if (shipLevel(key) >= 20) return { ok: false, reason: 'maxed' };
    const c = shipUpgradeCost(key);
    if (state.gold < c.gold) return { ok: false, reason: 'gold' };
    if ((state.resources.plasma || 0) < c.plasma) return { ok: false, reason: 'plasma' };
    if (prismIngots() < c.prism) return { ok: false, reason: 'prism' };
    state.gold -= c.gold; state.resources.plasma -= c.plasma;
    if (c.prism > 0 && state.prism) state.prism.ingots -= c.prism;
    state.shipLevels[key] = shipLevel(key) + 1;
    refreshStats(); save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, level: state.shipLevels[key] };
  }

  // ===========================================================================
  // OBLIVION-class CONSTRUCTION — a hull you can't buy: recover its blueprint
  // (1% / 0.5% drop from a deep Void Citadel), grind the kill gate in the
  // required hull, and pay a fortune in resources.
  //
  // BUILD TIMERS REMOVED (Aug 2026). Every hull is now delivered the instant the
  // yard is paid — no 2–4 week wait, and no "another hull is already building"
  // lock, so nothing serialises. The gates that make these hulls special are the
  // blueprint, the kill count, the ascension rank and the cost; a real-time wall
  // added no decision, just dead time. `state.construction` is kept only long
  // enough to hand back any hull a player had in the yard when this shipped
  // (see the migration in checkConstruction).
  // ===========================================================================
  function buildShipInfo(key) {
    const ship = C.SHIP_BY_KEY[key]; const b = ship && ship.build; if (!b) return null;
    const owned = !!(state.ownedShips && state.ownedShips[key]);
    // Some hulls aren't unlocked by a blueprint at all — the Aeternum's gate is
    // ASCENSION RANK, which no drop or purchase can substitute for.
    const hasBp = b.noBlueprint ? true : !!(state.blueprints && state.blueprints[key]);
    // KING OF THE HILL CROWNS — the gate on the two carrier apexes. Lifetime #1
    // finishes, counted from the server ledger (see kothCrowns), never from a
    // client tally of its own runs.
    const reqCrowns = b.reqCrowns || 0;
    const crownsHave = kothCrowns();
    const crownsMet = crownsHave >= reqCrowns;
    const reqAsc = b.reqAsc || 0;
    const ascHave = ascStars();
    const ascMet = ascHave >= reqAsc;
    const reqShip = b.reqShip, reqKills = b.reqShipKills || 0;
    const killsHave = state.totalKills || 0;         // ANY ship — no specific-hull grind
    const killsMet = killsHave >= reqKills;
    const cost = b.cost || {};
    // NEVER `| 0` A BALANCE OR A COST. These costs run to 100e12 — forty-six
    // thousand times past the int32 ceiling — so a bitwise coerce anywhere in
    // this comparison would wrap the number negative and either lock the button
    // forever or hand the hull over free. Whole units via Math.floor(Number(x)).
    const num = (x) => Math.floor(Number(x) || 0);
    const have = { gold: num(state.gold), fuel: num(state.resources && state.resources.fuel), iron: num(state.resources && state.resources.iron), plasma: num(state.resources && state.resources.plasma), prism: num(prismIngots()), credits: num(state.credits) };
    let affordable = true; for (const k in cost) { if (have[k] < num(cost[k])) affordable = false; }
    let status;
    if (owned) status = 'owned';
    else if (!ascMet) status = 'needasc';
    else if (!crownsMet) status = 'needcrowns';
    else if (!hasBp) status = 'noblueprint';
    else if (!killsMet) status = 'needkills';
    else status = affordable ? 'buildable' : 'needres';
    return { key, ship, build: b, owned, hasBp, reqShip, reqKills, killsHave, killsMet, reqAsc, ascHave, ascMet,
             reqCrowns, crownsHave, crownsMet, cost, have, affordable,
             building: false, otherBuilding: false, status, arrivesAt: 0, startedAt: 0, days: 0, instant: true };
  }
  // ===========================================================================
  // KING OF THE HILL CROWNS — the count, and the blueprints it unlocks
  // ===========================================================================
  // `state.kothCrowns` is a LIFETIME, MONOTONIC count of #1 finishes. It is only
  // ever raised, and only from the server: koth.js increments it as the award
  // ledger is drained (one row per crown, marked delivered server-side, so a row
  // arrives exactly once) and reconciles it against koth_wins() on login. A
  // client never counts its own crowns — the ladder decides who won.
  function kothCrowns() { return Math.floor(Number(state.kothCrowns) || 0); }
  function addKothCrowns(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (!v) return kothCrowns();
    state.kothCrowns = kothCrowns() + v;
    syncCrownBlueprints(); save();
    return kothCrowns();
  }
  // Server-authoritative floor. koth_wins() counts koth_hall rows for this
  // account, so it is the true total even if a crown mail was never opened or a
  // save merge picked the copy that had not seen it yet.
  function setKothCrowns(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (v <= kothCrowns()) { syncCrownBlueprints(); return kothCrowns(); }
    state.kothCrowns = v;
    syncCrownBlueprints(); save();
    return v;
  }
  // A CROWN THRESHOLD IS A BLUEPRINT. Latched into state.blueprints the moment
  // the count reaches it, so it reads exactly like every other recovered
  // schematic (the ✔ BP chip, the merge union, the build sheet) and cannot be
  // lost by dropping back below the threshold — there is no way to lose a crown,
  // but a latch is the right shape for an earned thing regardless.
  function syncCrownBlueprints() {
    const have = kothCrowns();
    let hit = 0;
    for (const s of C.SHIPS) {
      const need = s.build && s.build.reqCrowns; if (!need) continue;
      if (have < need) continue;
      if (!state.blueprints) state.blueprints = {};
      if (!state.blueprints[s.key]) { state.blueprints[s.key] = 1; hit = 1; }
    }
    if (hit && window.UI && window.UI.refreshAll) { try { window.UI.refreshAll(); } catch (e) {} }
    return hit;
  }
  function startBuildShip(key) {
    const inf = buildShipInfo(key); if (!inf) return { ok: false, reason: 'invalid' };
    if (inf.owned) return { ok: false, reason: 'owned' };
    if (!inf.ascMet) return { ok: false, reason: 'ascension' };
    if (!inf.crownsMet) return { ok: false, reason: 'crowns' };
    if (!inf.hasBp) return { ok: false, reason: 'blueprint' };
    if (!inf.killsMet) return { ok: false, reason: 'kills' };
    if (!inf.affordable) return { ok: false, reason: 'resources' };
    const cost = inf.cost;
    const _n = (x) => Math.floor(Number(x) || 0);
    if (!state.resources) state.resources = { fuel: 0, iron: 0, plasma: 0 };
    if (cost.gold) state.gold = Math.max(0, _n(state.gold) - _n(cost.gold));
    state.resources.fuel = _n(state.resources.fuel) - _n(cost.fuel);
    state.resources.iron = _n(state.resources.iron) - _n(cost.iron);
    state.resources.plasma = _n(state.resources.plasma) - _n(cost.plasma);
    if (cost.prism && state.prism) state.prism.ingots = Math.max(0, _n(state.prism.ingots) - _n(cost.prism));
    if (cost.credits) state.credits = Math.max(0, _n(state.credits) - _n(cost.credits));
    // delivered on the spot
    grantShip(key); save();
    if (window.UI) { if (window.UI.shipBuilt) window.UI.shipBuilt(C.SHIP_BY_KEY[key]); else if (window.UI.refreshAll) window.UI.refreshAll(); }
    return { ok: true, instant: true };
  }
  // MIGRATION ONLY. Timed builds are gone; any save still carrying one gets the
  // hull handed over immediately rather than being held to a timer that no
  // longer ticks anywhere.
  function checkConstruction() {
    const con = state.construction; if (!con) return false;
    const key = con.ship; state.construction = null;
    grantShip(key); save();
    if (window.UI) { if (window.UI.shipBuilt) window.UI.shipBuilt(C.SHIP_BY_KEY[key]); else if (window.UI.unlockToast) window.UI.unlockToast('★ ' + ((C.SHIP_BY_KEY[key] || {}).name || 'Hull') + ' delivered!'); }
    return true;
  }
  // Ultra-rare blueprint roll on a Void Citadel explosion (Zone Grind only).
  function buildBlueprintDropFromCitadel(zone) {
    if (state.currentSystem) return;                 // only the open Zone Grind
    const lvl = (C.dungeonEnemyLevel ? C.dungeonEnemyLevel(zone) : zone * zone) || 0;
    for (const s of C.SHIPS) {
      const bd = s.build && s.bpDrop; if (!bd) continue;
      if (state.blueprints && state.blueprints[s.key]) continue;
      if (state.ownedShips && state.ownedShips[s.key]) continue;
      if (lvl < (bd.minCitLevel || 0)) continue;
      if (Math.random() < (bd.chance || 0)) {
        if (!state.blueprints) state.blueprints = {};
        state.blueprints[s.key] = true; save();
        if (window.UI && window.UI.blueprintEvent) window.UI.blueprintEvent(s);
        else if (window.UI && window.UI.unlockToast) window.UI.unlockToast('★ ' + s.name + ' BLUEPRINT recovered!');
      }
    }
  }

  window.LOOTFLEET = Object.assign(window.LOOTFLEET || {}, { VERSION: '1.0.0-beta' });
  const GAME = {
    init, state, rt, save, computeStats, refreshStats,
    shipLevel, shipUpInfo, upgradeShip, spawnFleetBoss,
    equip, sell, sellAllBelow, autoEquip, autoSell, autoSellPreview, selectDungeon,
    setAuto, getAuto: () => state.auto, setJoystick,
    setGameSpeed, hasSpeed, purchase, buySpeed4, buyShipLC, isPro, proMods, grantPro, respawnAt,
    // AUTO BEACON — the 25,000-LootCoin operations unlock and its arm/disarm flag
    AUTO_BEACON_LC, buyAutoBeacon, hasAutoBeacon, autoBeaconOn, setAutoBeacon,
    resizeCanvas: () => { try { rt.portW = 0; rt.portH = 0; resize(); } catch (e) {} },
    buyShip, switchShip, grantShip, seedFighterBays, shipUnlocked, shipBuyState, hasBlueprint, defenseSnapshot,
    buildShipInfo, startBuildShip, checkConstruction, getConstruction: () => state.construction || null,
    kothCrowns, addKothCrowns, setKothCrowns, syncCrownBlueprints,
    lanceState,
    canFlyShip,
    beamCount,
    levelCap: () => C.levelCap(), atLevelCap: () => state.level >= C.levelCap(),
    startHomeDefense, spawnHomeRaider, endHomeDefense,
    startCargoRun, spawnCargoRaider, endCargoRun, stripHullUpgrades,
    startKoth, spawnKothEnemy,
    fleetSlots, fleetShips, setFleetSlot, getFleet: () => state.fleet || [],
    isCitadelZone, citadelCooldownLeft, isSwarmZone, zoneReqLevel,
    getCitadel: () => rt.enemies.find((en) => en.isCitadel && !en.dead) || null,
    shipDroneCount, fighterHull, getDrones: () => state.drones,
    // Live internals for fighters.js. Handing over resolveHit is the point: a
    // fighter's hit then resolves through the SAME path as a bolt, so crits, life
    // steal, boss/elite multipliers, cryo, the singularity, kills, XP and loot all
    // need no duplicate. `nearby` is what lets Multi-Shot reach the wing.
    //
    // ONE OBJECT, REUSED. This is read twice a frame; returning a fresh literal
    // was two allocations per frame forever, and per-frame garbage is the known
    // shape of "giga laggy" in this engine (see the kill-path note above).
    _fx: () => { _fxo.rt = rt; _fxo.state = state; return _fxo; }, getShipKills: (k) => (state.shipKills[k] || 0),
    skillRank, branchSpent, skillReqMet, canInvest, investSkill, resetSkills, skillMods,
    getShop, shopTimeLeft, buyShopItem, getBossInfo, shopItemPrice, shopIsUpgrade,
    getLCMarket, buyLCMarket, lcCosmicTimeLeft, lcPrimTimeLeft, LC_PRICES,
    secondUnlocked: (b) => secondUnlocked(b), equipLayout,
    recommendedZone, zoneAdvice, zoneBonuses, currentWeek,
    powerRaw, rawFromScore, cloneMatchup, effectiveDps,
    fireBeacon, beaconState, defenseRanks, beaconVisible,
    bumpLife, peakLife,
    pilotAscend, ascStars,
    // galaxy map
    warp, sysAt, isOwned, rivalOf, tileCooldownLeft, abandonLockLeft, tileInfo, entryCostFor, isAllyTile,
    // Kaevith Incursion
    inXenZone, xenXpBonus, xenXpMult, xenDry: () => state.xenDry || 0, xenPityAt: () => 0, xenSplit, xenChanceNow,
    // House Citadels (casino holds — real tiles, sieged like Void spires)
    casinoHolds, casinoIds: () => CASINO_IDS.slice(), casinoShareOf,
    casinoTotalShare: () => CASINO_IDS.reduce((a, k) => a + casinoShareOf(k), 0),
    // Ember Choir (Zone Grind incursion)
    isEmberZone, emberTierFor, emberChance, emberBeaconBonus, isEmberBossPending,
    emberKeys: () => EMB_KEYS.slice(), emberFound: () => state.embFound || 0, emberMinZone: () => EMB_MIN_ZONE,
    emberRate: () => EMB_RATE, emberCaps: () => EMB_CAP,
    xpFleetInfo,
    buildCitadel, canBuildCitadel, citadelBuildCost, citadelCount, citadelCap, tileCap, tileCount, tilesLeft, atTileCap, abandonTile, hasMyCitadel, rivalCitadelScore, rivalDefense,
    citadelLevel, citadelUpgradeCost, upgradeCitadel, unequip, citadelRankOf, tileIdByName,
    resourceRates, tileRateOf, isGalaxyTile, getResources: () => state.resources, getSiege: () => rt.siege, getWaves: () => rt.waves,
    ownedSystemList,
    // CONTIGUITY — derived from ownedSystems, stored nowhere. clusterBust() is for
    // any future write path that changes ownership and cannot wait 250ms.
    clusterOf, clusterSummary, clusterBust, CLUSTER_TIERS,
    // SIEGE SHIELD — derived from ownership, stored nowhere. One statement of
    // "no exposed border, no siege", read by the map, the sheet and warp().
    tileShield, shieldDoors, factionOf, blocOf, BLOC_MIN,
    getGalaxyFeed: () => state.galaxyFeed || [],
    formatNum, formatNumRaw, formatTime,
    getStats: () => rt.stats, getDps: () => rt.dps, score, freeze, adoptSave, uiYield, ASC_START_HULL,
    getHp: () => ({ cur: rt.archer ? rt.archer.hp : 0, max: rt.stats.maxHp, dead: rt.archer && rt.archer.dead, awaiting: rt.awaitingRespawn }),
    itemPower: I.itemPower, compare: I.compare, rarityChances: I.rarityChances, save,
    buyCosmetic, setCosmetic, addCredits,
    getCredits: () => state.credits || 0, getCosmetics: () => state.cosmetics,
    startDreadHunt, dreadLevelFor, startMechRun, startServerDread, startAllianceRaid, goSafeHangar,
    setLevel,
    getDreadCores: () => state.dreadCores || 0,
    // same int32 wrap as addCredits above — see the note there
    addDreadCores: (n) => { state.dreadCores = (state.dreadCores || 0) + Math.max(0, Math.floor(Number(n) || 0)); save(); if (window.UI) window.UI.refreshAll(); },
    invCap, invSlotCost, buyInvSlots,
    setPickupFilter: (t) => { state.pickupFilter = Math.max(0, t | 0); save(); },
    setAutoSellTier: (t) => {
      state.autoSellTier = (t == null || t < 0) ? -1 : (t | 0);
      // SWEEP ON THE SPOT. The hold was previously swept at the next pickup
      // flush, so turning sell-on-pickup on and then standing still left a full
      // hold and a stale count — "sometimes it takes a second for it to update".
      const r = autoSellSweep(null) || { n: 0, gold: 0 };
      save();
      if (window.UI && window.UI.syncBag) window.UI.syncBag();
      return r;
    },
    // dev/verify
    fastForward(seconds) { const dt = 1/60, n = Math.floor(seconds/dt); for (let i=0;i<n;i++){ rt.time+=dt; state.playTime+=dt; update(dt); } if (window.UI) window.UI.refreshAll(); },
  };
  window.GAME = GAME;
})();
