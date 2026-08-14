// =============================================================================
//  discord-feed — LootFleet live event feed → one Discord channel
// -----------------------------------------------------------------------------
//  Runs on a pg_cron schedule (every 2 min). Diffs the server-authoritative
//  tables against a snapshot in `feed_seen`, and posts anything new as Discord
//  embeds via an Incoming Webhook.
//
//  WHY SERVER-SIDE: the game client is authoritative for saves and territory,
//  so any client-reported "achievement" can be forged from devtools. Everything
//  announced here is a real change to a real row. It also keeps the webhook URL
//  out of public JS — a leaked webhook lets anyone post as the bot forever.
//
//  SOURCES
//    leaderboard     → ascensions, rank #1 changes, zone/level milestones,
//                      new pilots, top-10 entries, LEGENDARY NANOCORES
//                      (legendary only: recovered, slot depth, god rolls;
//                       a FINISHED 5/5 core gets its own message)
//    sdread_scores   → Season Dread stage records
//    alliances       → Armada mark clears, new alliances
//    war_events      → repelled sieges, daily digest, KAEVITH HULLS EARNED
//
//  TWO DIGESTS ride this same 2-minute tick rather than needing their own cron:
//    · DAILY STANDINGS  — queued into war_events by daily_ranks_award() at 00:05
//    · SITUATION REPORT — every 3 hours, gated by a timestamp in feed_seen:
//                          top-5 ladders, Void spire shield countdowns, Voidmaw
//                          season standing, Incursion status, and what moved.
//
//  Simulated rivals live in `sim_pilots` and are NEVER read here, so the feed
//  only ever announces humans.
//
//  SECRETS (supabase secrets set ...)
//    DISCORD_WEBHOOK_URL   the Incoming Webhook for the feed channel
//    FEED_KEY              shared secret; cron must send it as x-feed-key
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const WEBHOOK = Deno.env.get('DISCORD_WEBHOOK_URL') ?? '';
// Version marker — echoed in every response and the bootstrap message, so a
// deploy is verifiable from the cron log:
//   select content from net._http_response order by created desc limit 3;
// must show {"ok":true,"ver":570,...}. If ver is missing, the old build runs.
const FEED_VER = 570;
const FEED_KEY = Deno.env.get('FEED_KEY') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Discord allows 10 embeds per message. Anything past this in one tick is
// rolled into a single summary line rather than spamming the channel.
const MAX_EMBEDS = 10;

const COLOR = {
  open:     0x00d18f,
  repel:    0x4db4ff,
  void:     0x9b4dff,
  crown:    0xffd24d,
  steal:    0xff5a4d,
  citadel:  0xffcf4d,
  claim:    0x8fb7d9,
  lost:     0x5a6472,
  throne:   0xb57bff,
  ascend:   0xf5c542,
  armada:   0xff8a3d,
  dread:    0xff4d6d,
  zone:     0x5bc8ff,
  level:    0x4da3ff,
  top10:    0x3dd68c,
  alliance: 0x3dd68c,
  pilot:    0x6e7a8a,
  xen:      0xc26bff,
  sitrep:   0x6f7dff,
  bigbet:   0xffd66a,
  whale:    0xff3b6b,
};

// ---- THE KAEVITH INCURSION -------------------------------------------------
// Five recovered hulls, earned only by clearing an alien-held zone in My Galaxy.
// The ladder here mirrors SHIPS in js/config-v2.js; log_xen_hull() validates the
// key server-side, so this table is display only.
const XEN_HULLS: Record<string, { name: string; cls: string; xp: number; tier: number }> = {
  xen1: { name: 'Kaevith Splinter',  cls: 'Frigate',    xp: 10,  tier: 1 },
  xen2: { name: 'Kaevith Shard',     cls: 'Cruiser',    xp: 25,  tier: 2 },
  xen3: { name: 'Kaevith Glaive',    cls: 'Battleship', xp: 45,  tier: 3 },
  xen4: { name: 'Kaevith Sovereign', cls: 'Carrier',    xp: 70,  tier: 4 },
  xen5: { name: 'Kaevith Godshard',  cls: 'Dreadnaught', xp: 100, tier: 5 },
};
// A fifth of the galaxy is alien-held; mirrors XEN.share in js/galaxy.js.
const XEN_SHARE = 0.20;

// ---- 🎙️ TRASH-TALK ENGINE ---------------------------------------------------
// Flavor lines + meme GIFs for the loud events. Picks are DETERMINISTIC (hashed
// from the event's own ids) so a retried tick re-posts the identical joke
// instead of flip-flopping. GIFs are plain public Giphy media URLs — swap or
// extend the lists freely; if a URL ever dies Discord just renders the embed
// without the image and the post still lands.
const GIF = (id: string) => `https://media.giphy.com/media/${id}/giphy.gif`;
const GIFS: Record<string, string[]> = {
  owned:   ['15BuyagtKucHm', '3o7qDSOvfaCO9b3MlO', '4vQZcC96dTfG', 'd0NnEG1WnnXqg', 'DfbpTbQ9TvSX6', '93lNrr6jBuVK6a910g', 'KL7I5MXrcvezC', 'DWdNrMPdddZ19EfWFD', 'Yuve5SrNAtDp3lpNzr'].map(GIF),
  victory: ['jbUspndg5yz8UfVs8R', 'K3RxMSrERT8iI', 'uTuLngvL9p0Xe', 'Gf3fU0qPtI6uk', 'rhaIsgMSRHaUg', 'l4pTmPgIgWEzf86zu'].map(GIF),
  fine:    ['NTur7XlVDUdqM', 'QMHoU66sBXqqLqYvGO', 'l2QEgWxqxI2WJCXpC', 'tZyxxR4lUIRnTgIzl9', 'UKF08uKqWch0Y'].map(GIF),
  // NANOCORES — drawn from the same known-good pool so nothing 404s, but split
  // into three moods: pulling one, finishing one, and the ingot bill for both.
  nano:    ['3o7qDSOvfaCO9b3MlO', 'Gf3fU0qPtI6uk', 'uTuLngvL9p0Xe', '93lNrr6jBuVK6a910g', 'DfbpTbQ9TvSX6', 'Yuve5SrNAtDp3lpNzr'].map(GIF),
  maxed:   ['jbUspndg5yz8UfVs8R', 'K3RxMSrERT8iI', 'rhaIsgMSRHaUg', 'l4pTmPgIgWEzf86zu', 'KL7I5MXrcvezC'].map(GIF),
  ingots:  ['NTur7XlVDUdqM', 'l2QEgWxqxI2WJCXpC', 'QMHoU66sBXqqLqYvGO', 'tZyxxR4lUIRnTgIzl9'].map(GIF),
};
function seedHash(s: string): number { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pickBy = <T>(seed: string, arr: T[]): T => arr[seedHash(seed) % arr.length];
// 1 = a GIF on every loud event; raise to 2/3 if the channel wants fewer.
const GIF_EVERY = 1;
const gifFor = (kind: keyof typeof GIFS, seed: string) =>
  GIFS[kind] && GIFS[kind].length && seedHash('gif:' + seed) % GIF_EVERY === 0 ? pickBy(seed, GIFS[kind]) : null;

// {a} attacker · {d} defender · {s} system · {n} count
const QUIPS: Record<string, string[]> = {
  steal: [
    "💀 {a} just OWNED {d} and yoinked {s}! 🏴‍☠️",
    "🚨 BREAKING: {a} sent {d} home in an escape pod — {s} under new management 📉",
    "🔥 {a} turned {d}'s defense into confetti. {s} secured 🎉",
    "😬 {d} had ONE job. {a} took {s} anyway.",
    "🧾 {a} just repossessed {s}. {d}'s deposit? Not coming back.",
    "⚡ {a} speedran {d}'s garrison and walked off with {s} like it was free samples 🛒",
    "🪦 RIP {d}'s hold on {s} — {a} didn't even slow down.",
    "📦 {a} to {d}: 'I'll take THAT.' {s} boxed up and shipped 🚚",
  ],
  stealCit: [
    "🏰💥 {a} just OWNED {d} and took the {s} citadel! GG go next 🫡",
    "🏰 {a} kicked the gates in — {d}'s citadel at {s} flies a new flag now 🏳️",
    "😱 {d}'s 'impenetrable' citadel at {s}? {a} walked in like they owned the place. They do now.",
    "🔨 {a} vs {d}'s citadel at {s}: the citadel lost. Badly.",
  ],
  repel: [
    "🧱 {d} said NOT TODAY — {a} bounced off {s} like a bird off a window 🐦💥",
    "🛡️ {a} knocked on {s}. {d} answered. {a} left. 🚪",
    "😤 {d} held {s} — {a} is in the replay booth wondering what happened 📼",
    "🥊 {a} swung at {d}'s {s}… and hit nothing but shield. Swing and a miss ⚾",
    "🍿 {a} spent 60 whole seconds at {s} and left with zero souvenirs — {d} holds.",
  ],
  throne: [
    "👑 {a} just DETHRONED {d}. Awkward. 😬",
    "👑 New king detected: {a}. {d} has been moved to 'former royalty' 📉",
    "🪑 {a} pulled the chair out from under {d} — rank #1 has a new owner 👑",
  ],
  void: [
    "🌌 {a} RIPPED {s} out of {d}'s hands — apex real estate, new landlord 🏦",
    "🌌 {a} evicted {d} from {s}. No notice. No refund. 📜",
  ],
  voidClaim: [
    "🌌 {a} planted a flag on {s} — free apex spire? Not anymore 🚩",
  ],
  top10: [
    "📈 {a} elbowed into the top 10 — somebody down there is sweating 💦",
    "🚀 {a} just crashed the top-10 party. Security was not consulted.",
  ],
  grab: [
    "🚩 {a} is playing Monopoly with real star systems — {n} claimed in one sweep 🎲",
    "🗺️ {a} woke up and chose expansion: {n} systems annexed before breakfast ☕",
  ],
  bigbetWin: [
    "🎰 {a} bet the shipyard and WON. The house is crying 😭",
    "🤑 {a} just made the casino personally uncomfortable.",
  ],
  bigbetLose: [
    "🎰 {a} donated generously to the house. Very charitable 🫡",
    "📉 {a} tested their luck. Luck said no. 💸",
  ],
  // {a} pilot · {n} lifetime deliveries
  cargoFirst: [
    "🚚 {a} just delivered their FIRST shipment. The freighter made it. Nobody is more surprised than the freighter. 📦",
    "📦 {a} escorted a cargo ship through pirate space and it arrived with the paint still on. Beginner's luck? We'll see.",
    "🚚 {a} completed their first escort — the insurance adjusters have been sent home disappointed 🫡",
  ],
  cargo: [
    "🚛 {a} has now delivered {n} shipments. At this point the raiders just wave them through 👋",
    "📦 {n} deliveries for {a}. The Citadel dock crew knows their coffee order ☕",
    "🚚 {a} hit {n} lifetime hauls — space truckers hate this one simple pilot 🛻",
    "📈 {n} shipments and counting: {a} is basically a logistics company with guns.",
    "🧾 {a}: {n} deliveries, zero apologies. The freight union is drafting a thank-you card ✉️",
  ],
  // ---- NANOCORES · LEGENDARY ONLY ---------------------------------------
  // Nothing here fires for a Common core. {a} pilot · {n} count · {s} ship
  nanoFirst: [
    "◈ {a} pulled a LEGENDARY Nanocore out of a crate — 1.5% odds, and you will be hearing about it for a while 📢",
    "◈ A Legendary Nanocore for {a}. The other 98.5% of that crate rotation is in shambles 💀",
    "◈ {a} opened a crate and a Legendary fell out. They are already telling their alliance. Twice. 🔔",
    "◈ 1.5%. {a} hit it. Everyone else in this channel has opened forty crates and owns a lovely grey rock 🪨",
    "◈ {a} just found a Legendary core. Not bought. Not traded. FOUND. The crate machine is having a bad day 🎰",
  ],
  nanoLegend: [
    "◈ {a} is holding {n} Legendary Nanocores now. That is not a collection, that is a flex cabinet 🏆",
    "◈ {n} Legendary cores for {a}. Their Prism Ingot balance has requested privacy 🧾",
    "◈ {a} hit {n} Legendaries. At some point this stops being luck and starts being a spreadsheet 📊",
  ],
  nanoSlots: [
    "⬢ {a} unlocked slot {n} on a Legendary core — {n} slots, {m} successful upgrades, zero of which were guaranteed 🎲",
    "⬢ Slot {n} open on a Legendary for {a}. The 20% roll has been beaten again. It is not happy about it 😤",
    "⬢ {a} pushed a Legendary core to {n} slots. Somewhere a pile of ingots is being quietly mourned 🪦",
  ],
  nanoMax: [
    "🏆 {a} FINISHED a Legendary Nanocore — all 5 slots, 25 successful upgrades. This is the top of the system. There is nothing above it. 👑",
    "🏆 Five of five on a Legendary for {a}. Twenty-five upgrades landed, and the last five were 20% shots. Absolute machine 🤖",
    "🏆 {a} maxed a Legendary core. Five slots, five buffs, one very expensive hobby 💎",
    "🏆 {a} beat the 20% roll five times in a row to close out a Legendary. The Prism Refinery has been asked to sit down 🪑",
    "🏆 A completed Legendary core for {a}. There is no slot 6. There is no rarity above it. They just have to go outside now 🚪",
  ],
  // The ingot bill — the joke that lands on every upgrade post.
  nanoCost: [
    "🧾 Somewhere a Prism Refinery is filing for bankruptcy protection.",
    "🧾 Every failed attempt cost the same as a successful one. Think about that for a second.",
    "🧾 The ingots are gone. The ingots are never coming back.",
  ],
  nanoGod: [
    "✧ {a} rolled a buff in the TOP 5% of its range on a Legendary core. Locked immediately, obviously 🔒",
    "✧ God roll for {a} — top 5% of the range on a Legendary. The reroll button has been retired with honours 🎖️",
    "✧ {a} hit a near-max roll on a Legendary core. Everyone else is rolling again. And again. 🎰",
  ],
  nanoGodN: [
    "✧ {n} god rolls on Legendary cores for {a}. The RNG has filed a complaint 📮",
    "✧ {a} now has {n} top-5% Legendary rolls. This is what happens when you refuse to stop rerolling 🎰",
  ],
  cargoClean: [
    "✨ {a} delivered at 100% integrity — not a scratch. The freighter wants to fly with them FOREVER 💅",
    "🧼 A PERFECT delivery from {a}. Raiders touched nothing. Feelings were hurt instead 💔",
    "✨ {a} just ran the gauntlet and handed the Citadel a shipment in showroom condition 🏆",
  ],
  // {a} pilot — a new ship in the hangar, any tier
  hull: [
    "⬡ {a} just took delivery of a new hull. The old one is already in the scrapyard pretending not to care.",
    "⬡ New hull for {a}. Fresh paint, zero scorch marks. Give it an hour.",
    "⬡ {a} expanded the hangar. Somewhere a shipwright is finally getting paid.",
    "⬡ {a} signed for a new hull. The fleet grows. The docking fees grow faster.",
    "⬡ A new ship for {a} — still smells of coolant and optimism.",
  ],
  // {a} pilot — a heavy manifest (tier 3+) delivered
  cargoBig: [
    "🚚 {a} walked a heavy manifest through the corridor and parked it at the Citadel. By hand. No autopilot.",
    "🚚 Big shipment, bigger target. {a} got it home anyway.",
    "🚚 {a} escorted a fat manifest past everything that wanted it. The freighter owes them a drink.",
    "🚚 Heavy cargo docked. {a} flew the whole lane manually and the hull has the marks to prove it.",
  ],
};
function quip(kind: string, seed: string, vars: Record<string, string | number>): string {
  let t = pickBy(seed, QUIPS[kind] || ['']);
  for (const k in vars) t = t.split('{' + k + '}').join(String(vars[k]));
  return t;
}

// SITUATION REPORT cadence. The function itself runs every 2 minutes to diff
// events; the report is a digest posted on its own 3-hour clock, gated by a
// timestamp in feed_seen rather than a second cron job.
const SITREP_MS = 3 * 60 * 60 * 1000;

// Priority decides what survives the MAX_EMBEDS cap — loud, rare things first.
// 'nano' was missing from this list, which sorted it to -1 — ahead of Kaevith
// hulls by accident rather than by intent. It sits where it belongs now:
// rarer than an ascension, quieter than a Void spire.
const PRIORITY = ['xen', 'void', 'nano', 'throne', 'ascend', 'casino', 'bigbet', 'repel', 'armada', 'citadel', 'steal', 'dread', 'hull', 'cargo', 'top10',
                  'zone', 'level', 'open', 'claim', 'alliance', 'lost', 'pilot'];

// One player rewriting many tiles at once is the republishOwnedTiles() repair
// loop, not a conquest. Owner-unchanged rewrites produce no event at all, but
// this collapses any remaining burst into a single line.
const BURST = 4;

const ZONE_MARKS  = [10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500];
const CARGO_MARKS = [10, 25, 50, 100, 250, 500, 1000];   // first delivery gets its own event
const LEVEL_MARKS = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
// NANOCORES — legendary only. The first Legendary and the first god roll each
// get their own one-time event; after that it is milestone crossings.
const NANO_MARKS = [2, 5, 10, 25, 50, 100];
const NANO_GOD_MARKS = [5, 10, 25, 50];
const NANO_SLOT_FROM = 3;         // slots 1-2 are routine; 3, 4 and 5 are news
const NANO_SLOT_MAX = 5;
const NANO_UPS_PER_SLOT = 5;
// Balance figures quoted on the cards, mirrored from CFG in js/nanocores.js.
// Nothing here is computed by the feed — if a number changes there, change it
// here and the copy stays honest.
const NANO_LEGEND_ODDS = 1.5;     // % per crate
const NANO_LAST_STAGE = 20;       // % success on the 5th upgrade of a slot
const NANO_GOD_PCT = 2;           // ~2% of rolls land in the top 5% of a range
// Slot 5, stage 5: costBase(1000) × stage(5) × slotMult(2)^4.
const NANO_TOP_COST = 1000 * NANO_UPS_PER_SLOT * Math.pow(2, NANO_SLOT_MAX - 1);

// Matches the in-game ladder in game-v93.js so Discord and the HUD agree.
const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
               'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'];

function fmt(n: number): string {
  n = Number(n) || 0;
  if (!isFinite(n)) return '∞';
  if (n < 1000) return String(Math.floor(n));
  let i = 0, v = n;
  while (v >= 1000 && i < UNITS.length - 1) { v /= 1000; i++; }
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v).toString()) + UNITS[i];
}

// Highest milestone crossed between two values, or null.
function crossed(prev: number, now: number, marks: number[]): number | null {
  let hit: number | null = null;
  for (const m of marks) if (prev < m && now >= m) hit = m;
  return hit;
}

// ---- PILOT RANK ------------------------------------------------------------
// The game renders ascension rank as FIVE STARS PER TIER, where the tier ladder
// IS the loot-rarity ladder (pilot-ascension.js · THE 5-STAR RANK MODEL). This
// feed instead printed one star per ascension, capped at ten with a "+N" tail —
// so a 16-times-ascended pilot posted as "★★★★★★★★★★+6", a string that appears
// nowhere in the game and reads as a rendering fault.
// 16 ascensions is EPIC ★1. Mirrors C.RARITY; keep in step if that list changes.
const RANK_TIERS: Array<[string, number]> = [
  ['Common', 0x9aa0a6], ['Uncommon', 0x5bc06b], ['Rare', 0x4a90e2], ['Epic', 0xb15cff],
  ['Legendary', 0xf0972a], ['Mythic', 0xff3b4e], ['Ancient', 0x21d4c4], ['Divine', 0xffe27a],
  ['Cosmic', 0xff6ad5], ['Void', 0x9a5bff], ['Eternal', 0xeae6ff], ['Relic', 0xc061ff],
  ['Artifact', 0xff2330], ['Ascendant', 0x5cffbe], ['Celestial', 0x5b7cff], ['Paragon', 0xffffff],
];
const tierIdx  = (n: number) => Math.max(0, Math.min(RANK_TIERS.length - 1, Math.floor(((n | 0) - 1) / 5)));
const starIn   = (n: number) => (n | 0) <= 0 ? 0 : ((((n | 0) - 1) % 5) + 1);
const tierName = (n: number) => RANK_TIERS[tierIdx(n)][0];
const rankName = (n: number) => `${tierName(n)} ★${starIn(n)}`;
const rankHue  = (n: number) => RANK_TIERS[tierIdx(n)][1];
const ord = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};
// Level cap is 150 + 50 per star — the concrete thing an ascension BUYS, and the
// only number on this card that goes up.
const capAt = (n: number) => 150 + 50 * (n | 0);

// ---- tile names -------------------------------------------------------------
// territory only stores tile_id ("q,r"). Names are generated deterministically
// from the coordinate in galaxy.js, so the same seeded RNG, consumed in the
// same order, reproduces the exact name the player sees in game.
const PRE = ['Vel','Kor','Zar','Tyr','Aql','Nyx','Pyr','Sol','Dra','Cir','Vex','Hal','Oss','Rho','Vyn','Tau','Mor','Cyg','Lyr','Ark'];
const MID = ['a','e','i','o','an','or','en','is','ux','ar'];
const SUF = ['Prime','Reach','Expanse','Gate','Verge','Drift','Hollow','Spire','Nexus','Crown','Deep','Rift','Vault','Forge','Cradle','Sprawl'];
const GREEK = ['α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ'];
const RINGS = 25, DEEP_RING = 18;

function rngFor(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genName(rnd: () => number): string {
  const a = PRE[(rnd() * PRE.length) | 0], b = MID[(rnd() * MID.length) | 0];
  return rnd() < 0.5
    ? `${a}${b} ${SUF[(rnd() * SUF.length) | 0]}`
    : `${a}${b} ${GREEK[(rnd() * GREEK.length) | 0]}-${1 + ((rnd() * 9) | 0)}`;
}

// THE VOID ZONE — seven fixed apex tiles beyond the rim. Names and level gates
// mirror VOID_TILES in game-v93.js. VZ7 is the crown.
const VOID: Record<string, { name: string; tier: number }> = {
  VZ1: { name: 'Umbral Gate',     tier: 25 },
  VZ2: { name: 'Null Bastion',    tier: 50 },
  VZ3: { name: 'Hollow Throne',   tier: 100 },
  VZ4: { name: 'Wraith Spire',    tier: 200 },
  VZ5: { name: 'Abyss Crown',     tier: 300 },
  VZ6: { name: 'Night Forge',     tier: 400 },
  VZ7: { name: 'The Singularity', tier: 500 },
};

const nameCache = new Map<string, string>();
function tileName(id: string): string {
  const hit = nameCache.get(id);
  if (hit) return hit;
  if (VOID[id]) return VOID[id].name;
  const m = /^(-?\d+),(-?\d+)$/.exec(id);
  if (!m) return id;
  const q = +m[1], r = +m[2];
  const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
  let out: string;
  if (ring === 0) out = 'Home Citadel';
  else if (ring > RINGS) out = id;
  else {
    const rnd = rngFor((q * 73856093) ^ (r * 19349663) ^ 0x5bd1);
    const roll = rnd();
    const cit = ring >= 2 && roll < 0.03;
    const boss = !cit && roll < 0.11;
    if (!cit && !boss) rnd();                     // tile type
    rnd();                                        // rarity
    let pool = 1;                                 // resource pool length
    if (ring >= 2) pool += 1;
    if (ring >= 5) pool += 2;
    if (ring >= DEEP_RING) pool += 2;
    rnd();                                        // resource pick
    out = cit ? 'Citadel ' + genName(rnd) : genName(rnd);
    void pool;
  }
  nameCache.set(id, out);
  return out;
}

// =============================================================================
//  REAL GAME ART
//  ---------------------------------------------------------------------------
//  Every sprite the game draws is already a public PNG on the site, so the feed
//  can show the actual hull a pilot earned instead of a stock GIF. The Kaevith
//  card has done this since it shipped; these helpers make it the default
//  everywhere.
//
//  ART FIRST, GIF AS FALLBACK. Discord fetches the URL itself, so a missing
//  file cannot be detected here — it simply renders the embed without an image.
//  The rule is therefore about KNOWLEDGE, not liveness: when we know the exact
//  subject (this hull, this freighter, this spire) we point at its art; when the
//  subject is a mood rather than an object (a throne changing hands, a siege
//  repelled) there is nothing to photograph and the GIF stays.
// =============================================================================
const SITE = 'https://lootfleet.com';
const KEY_OK = /^[a-z0-9_-]{1,32}$/i;
function shipArt(key: unknown): string | null {
  const k = String(key || '').trim();
  return KEY_OK.test(k) ? `${SITE}/ships/ship-${k}.png` : null;
}
function cargoArt(tier: unknown): string | null {
  const t = Number(tier) || 0;
  return t >= 1 && t <= 5 ? `${SITE}/ships/cargo-${t}.png` : null;
}
// Void spire art is banded the same way the game bands it (VOID_ART in
// game-v93.js): tiers 25/50 → 1, 100/200 → 2, 300/400 → 3, 500 → 4.
function voidArt(tier: unknown): string {
  const t = Number(tier) || 0;
  const n = t >= 500 ? 4 : t >= 300 ? 3 : t >= 100 ? 2 : 1;
  return `${SITE}/ships/void-cit-${n}.png`;
}
// thumbnail (small, top-right) for "here is the object", image (large) for the
// hero shot. Spread the result — an unknown subject contributes nothing.
const thumb = (url: string | null) => (url ? { thumbnail: { url } } : {});
const hero  = (url: string | null) => (url ? { image: { url } } : {});

// HULL KEY → the name the game shows. Mirrors SHIPS in config-v2.js. A key that
// is not in the table still reads sensibly (the key is prettified) so a hull
// added to the game later posts correctly before this list is updated.
const HULL_NAME: Record<string, string> = {
  frigate: 'Frigate', interceptor: 'Interceptor', cruiser: 'Cruiser', chromafang: 'Chroma Fang',
  heavycruiser: 'Heavy Cruiser', destroyer: 'Destroyer', battleship: 'Battleship', veridian: 'Veridian',
  dreadnought: 'Dreadnought', carrier: 'Carrier', aegis: 'Aegis', supercarrier: 'Super Carrier',
  titan: 'Titan Carrier', mothership: 'Mothership', voidmaw: 'Voidmaw', chromaregent: 'Chroma Regent',
  frostyfrost: 'FrostyFrost',
  monolith1: 'Monolith Shard', monolith2: 'Monolith Bastion', monolith3: 'Monolith Siegebreaker', monolith4: 'Monolith Apex',
  oblivionspear: 'Oblivion Spear', oblivionspearalpha: 'Oblivion Spear Alpha', oblivionfinal: 'Oblivion Final',
  dread1: 'Dread Reaver', dread2: 'Dread Sovereign', dread3: 'Dread Leviathan',
  dread4: 'Dread Harbinger', dread5: 'Dread Tyrant', dread6: 'Dread Omega',
  xen1: 'Kaevith Splinter', xen2: 'Kaevith Shard', xen3: 'Kaevith Glaive', xen4: 'Kaevith Sovereign', xen5: 'Kaevith Godshard',
  emb1: 'Ember Mote', emb2: 'Cinder Acolyte', emb3: 'Ashen Cantor', emb4: 'Molten Herald', emb5: 'Choirmaster Vhorn',
  aeternum: 'The Aeternum', titansina: 'Titan Sina', eternum: 'Eternum',
};
function hullName(key: string): string {
  const k = String(key || '').trim();
  if (HULL_NAME[k]) return HULL_NAME[k];
  if (!k) return 'a new hull';
  return k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
// The five shipment classes of Space Cargo Defense, each with its own freighter.
const CARGO_NAME: Record<number, string> = {
  1: 'Cargo I', 2: 'Cargo II', 3: 'Cargo III', 4: 'Cargo IV', 5: 'Omega V',
};

// =============================================================================
//  WHERE ON THE MAP
//  ---------------------------------------------------------------------------
//  Tile ids are literally 'q,r' axial hex coordinates, and this file already
//  mirrors the client's deterministic tile generator (see tileName). So a
//  capture can report its exact position with no extra column and no round
//  trip: ring, coordinates, the ring's level band, and which region of the map
//  it sits in.
// =============================================================================
const RING_LEVELS = [0, 10, 25, 30, 45, 50, 100, 125, 130];
function ringLevel(ring: number): number {
  if (ring <= 0) return 0;
  if (ring < RING_LEVELS.length) return RING_LEVELS[ring];
  return Math.min(500, 130 + (ring - 8) * 20);
}
// Six sextants, named off the axial direction — enough for two pilots to agree
// on roughly where a fight happened without opening the map.
const SEXTANT = ['Northern Reach', 'Northeast Arm', 'Southeast Arm', 'Southern Reach', 'Southwest Arm', 'Northwest Arm'];
function tileLoc(id: string): { ring: number; q: number; r: number; text: string } | null {
  if (VOID[id]) return null;                       // spires are named places, not coordinates
  const m = /^(-?\d+),(-?\d+)$/.exec(id);
  if (!m) return null;
  const q = +m[1], r = +m[2];
  const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
  if (ring === 0 || ring > RINGS) return null;
  const ang = Math.atan2(Math.sqrt(3) * (r + q / 2), 1.5 * q);   // axial → screen angle
  const sx = SEXTANT[((Math.round((ang / (Math.PI / 3)) + 6) % 6) + 6) % 6];
  const region = ring >= DEEP_RING ? 'DEEP SPACE' : ring >= 12 ? 'the outer rings' : ring >= 5 ? 'the mid rings' : 'the core rings';
  const text =
    `\`ring ${ring}\` \u00b7 \`${q}, ${r}\` \u00b7 ${sx}` +
    `\n-# ${region} \u00b7 level band ${ringLevel(ring)}${ring >= DEEP_RING ? ' \u00b7 \u26a0 deep space' : ''}`;
  return { ring, q, r, text };
}

type Ev = { kind: string; embed: Record<string, unknown>; line: string; sys?: string };

// Fight-card typography: names read as combatants, not as sentence subjects.
const up = (s: string) => (s || '').toUpperCase().slice(0, 18);
const card = (a: string, b: string, verdict: string) =>
  `${up(a)}  ⚔  ${up(b)}\u2003— ${verdict}`;

Deno.serve(async (req) => {
  if (FEED_KEY && req.headers.get('x-feed-key') !== FEED_KEY) {
    return new Response('forbidden', { status: 403 });
  }
  if (!WEBHOOK) return new Response('DISCORD_WEBHOOK_URL not set', { status: 500 });

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  // LEADERBOARD COLUMNS — cargo_* arrives with cargo-ladder.sql, nano_* with
  // nanocore-ladder.sql. THIS SELECT IS WHY NONE OF IT EVER POSTED: the two
  // migrations ran, the client published, the diff code was written and
  // shipped — and the query never asked for the columns. Every read came back
  // undefined, `Number(undefined) || 0` scored zero on both sides of the diff,
  // and no cargo or Nanocore milestone could cross. Degrade a column set at a
  // time so a server that has not run the migrations still gets everything else
  // instead of a 500.
  const LB_ART   = 'user_id,name,power,level,zone,kills,asc_stars,cargo,cargo_best,nano_legend,nano_slots,nano_god,ships,hull_last,nano_last,cargo_tier';
  const LB_FULL  = 'user_id,name,power,level,zone,kills,asc_stars,cargo,cargo_best,nano_legend,nano_slots,nano_god';
  const LB_CARGO = 'user_id,name,power,level,zone,kills,asc_stars,cargo,cargo_best';
  const LB_BASE  = 'user_id,name,power,level,zone,kills,asc_stars';

  const [lb, sd, al, seenRows] = await Promise.all([
    (async () => {
      let r = await selectAll(db, 'leaderboard', LB_ART, ['user_id']);
      if (r.error) r = await selectAll(db, 'leaderboard', LB_FULL, ['user_id']);
      if (r.error) r = await selectAll(db, 'leaderboard', LB_CARGO, ['user_id']);
      if (r.error) r = await selectAll(db, 'leaderboard', LB_BASE, ['user_id']);
      return r;
    })(),
    db.from('sdread_scores').select('user_id,name,season,stage,total'),
    db.from('alliances').select('id,name,tag,boss_n,boss_hp,boss_max,xp'),
    selectAll(db, 'feed_seen', 'kind,ref,data', ['kind', 'ref']),
  ]);

  // war_events arrives with war-events.sql; the feed runs fine without it.
  let war = await db.from('war_events').select('id,kind,tile_id,actor_name,target_name,meta,created_at')
                    .order('id', { ascending: true }).limit(200);
  if (war.error) war = { data: [], error: null } as typeof war;

  // citadel_lv arrives with territory-citadel-lv.sql; fall back until it is run.
  let terr = await selectAll(db, 'territory', 'tile_id,owner_id,owner_name,citadel,citadel_lv,cooldown_until', ['tile_id']);
  let hasLv = !terr.error;
  if (terr.error) {
    terr = await selectAll(db, 'territory', 'tile_id,owner_id,owner_name,citadel,cooldown_until', ['tile_id']);
    hasLv = false;
  }

  for (const r of [lb, sd, al, seenRows, terr]) {
    if (r.error) return new Response('db error: ' + r.error.message, { status: 500 });
  }

  const seen = new Map<string, Record<string, any>>();
  for (const r of seenRows.data!) seen.set(`${r.kind}:${r.ref}`, r.data ?? {});

  // First run: snapshot everything silently. Without this the channel gets
  // 28 users' worth of history dumped into it at once.
  const bootstrap = !seen.has('_meta:bootstrap');

  const events: Ev[] = [];
  // Kaevith hull reports, drained from war_events below. Declared out here
  // because the situation report reads them too.
  const hullEvents: any[] = [];
  // FINISHED LEGENDARY CORES. A 5/5 core is the end of the deepest progression
  // in the game — 25 successful upgrades on one item, the last five at 20% —
  // so like a Kaevith hull it gets its own message and is never batched.
  const maxCores: { name: string; god: number; legend: number }[] = [];
  const snap: { kind: string; ref: string; data: Record<string, any>; updated_at: string }[] = [];

  // ---- leaderboard -----------------------------------------------------------
  const pilots = (lb.data ?? []).slice().sort((a, b) => (b.power ?? 0) - (a.power ?? 0));
  const top10 = new Set(pilots.slice(0, 10).map((p) => p.user_id));
  const leader = pilots[0];

  // NANOCORE SCARCITY — how many accounts hold a Legendary at all, and how many
  // have finished one. Both rows are already updated by the time this tick runs,
  // so the pilot who just did it is counted: their card reads "the Nth ever"
  // the same way a Kaevith hull does, with no extra query.
  const nanoOf = (p: any, k: string) => Number(p[k]) || 0;
  const legendHolders = pilots.filter((p) => nanoOf(p, 'nano_legend') > 0).length;
  const maxHolders = pilots.filter((p) => nanoOf(p, 'nano_slots') >= NANO_SLOT_MAX).length;

  for (let i = 0; i < pilots.length; i++) {
    const p = pilots[i];
    const key = `pilot:${p.user_id}`;
    const was = seen.get(key);
    const cur = {
      power: Number(p.power) || 0,
      level: Number(p.level) || 0,
      zone: Number(p.zone) || 0,
      asc: Number(p.asc_stars) || 0,
      cargo: Number((p as any).cargo) || 0,
      cargoBest: Number((p as any).cargo_best) || 0,
      nanoLegend: Number((p as any).nano_legend) || 0,
      nanoSlots: Number((p as any).nano_slots) || 0,
      nanoGod: Number((p as any).nano_god) || 0,
      hulls: Number((p as any).ships) || 0,
      top10: top10.has(p.user_id) ? 1 : 0,
    };
    snap.push({ kind: 'pilot', ref: p.user_id, data: cur, updated_at: now });
    if (bootstrap) continue;

    if (!was) {
      events.push({
        kind: 'pilot',
        line: `**${p.name}** joined`,
        embed: {
          color: COLOR.pilot,
          author: { name: '▸  NEW PILOT' },
          title: `${p.name} joined the fleet`,
          description: `-# rank #${i + 1} of ${pilots.length} · <t:${Math.floor(Date.now() / 1000)}:R>`,
        },
      });
      continue;
    }

    if (cur.asc > was.asc) {
      // Crossing into a new tier (★1 of any tier above Common) is the rare, loud
      // one — five ascensions apart — so it gets its own header and callout.
      const brokeTier = starIn(cur.asc) === 1 && tierIdx(cur.asc) > tierIdx(was.asc);
      const tn = tierName(cur.asc).toUpperCase();
      const head = brokeTier
        ? `## ⬆  ${tierName(was.asc).toUpperCase()}  →  ${tn}\n**A new rank tier.**\n\n`
        : `## ${tn}  ★${starIn(cur.asc)}\n`;
      events.push({
        kind: 'ascend',
        line: `**${p.name}** ascended — now **${rankName(cur.asc)}**`,
        embed: {
          color: rankHue(cur.asc),
          author: { name: brokeTier ? '✦  NEW RANK TIER' : '✦  ASCENSION' },
          title: `${p.name}  →  ${rankName(cur.asc)}`,
          description: head +
            `Their ${ord(cur.asc)} ascension. The whole fleet and every system carried over — ` +
            `level, gold and gear back to zero.\n\n` +
            `**level cap** \`${capAt(cur.asc)}\`  ·  **power** \`${fmt(cur.power)}\`  ·  **zone** \`${cur.zone}\``,
        },
      });
    }

    if (!was.top10 && cur.top10) {
      events.push({
        kind: 'top10',
        line: `**${p.name}** entered the top 10`,
        embed: {
          color: COLOR.top10,
          author: { name: '▲  TOP TEN' },
          title: `${p.name} broke into rank #${i + 1}`,
          description: quip('top10', 'top10:' + p.user_id, { a: '**' + p.name + '**' }) + `\n-# ${fmt(cur.power)} power`,
        },
      });
    }

    const z = crossed(was.zone, cur.zone, ZONE_MARKS);
    if (z) {
      events.push({
        kind: 'zone',
        line: `**${p.name}** cleared Zone ${z}`,
        embed: {
          color: COLOR.zone,
          author: { name: '◈  DEEP ZONE' },
          title: `${p.name} pushed past Zone ${z}`,
          description: `-# now at zone ${cur.zone} · ${fmt(cur.power)} power`,
        },
      });
    }

    const lv = crossed(was.level, cur.level, LEVEL_MARKS);
    if (lv) {
      events.push({
        kind: 'level',
        line: `**${p.name}** hit level ${lv}`,
        embed: {
          color: COLOR.level,
          author: { name: '⬡  MILESTONE' },
          title: `${p.name} reached Level ${lv}`,
          description: `-# ${fmt(cur.power)} power · zone ${cur.zone}`,
        },
      });
    }

    // FIRST TICK AFTER THIS UPGRADE. Snapshots written before the feed selected
    // the cargo and nano columns carry no such keys at all, so a diff against
    // them reads as "went from nothing to 40 Legendaries just now" — every
    // pilot who already owns one would get a FIRST LEGENDARY card, every
    // finished core its own full-width message, all in the same batch. When the
    // key is absent the value is adopted silently and announcing starts from
    // the NEXT change. A genuinely new pilot never reaches here (the !was branch
    // above continues), and their first snapshot writes all the keys.
    const hadCargo = was.cargo !== undefined;
    const hadNano = was.nanoLegend !== undefined;
    const hadHulls = was.hulls !== undefined;

    // A NEW HULL IN THE HANGAR. Every hull, cheap ones included — a pilot's
    // second ship matters to them as much as a Dread does to someone deep, and
    // the whole point of the card is the art. `ships` is a COUNT, so the rise is
    // what fires it and `hull_last` is what names it; if an old client publishes
    // the count without the key the card still posts, just without the sprite.
    if (hadHulls && cur.hulls > (was.hulls || 0)) {
      const hkey = String((p as any).hull_last || '');
      const hArt = shipArt(hkey);
      const hName = hullName(hkey);
      events.push({
        kind: 'hull',
        line: `**${p.name}** earned ${hName}`,
        embed: {
          color: 0x7db8e8,
          author: { name: '⬡  NEW HULL' },
          title: `${p.name} took delivery of the ${hName}`,
          description:
            quip('hull', 'hl:' + p.user_id + ':' + cur.hulls, { a: '**' + p.name + '**' }) +
            `\n-# hull ${cur.hulls} in the hangar · level ${cur.level} · zone ${cur.zone}`,
          ...thumb(hArt),
        },
      });
    }

    // SPACE CARGO DEFENSE — the fun ones. First delivery is its own moment;
    // after that, milestone crossings; a first-ever PERFECT run (cargo_best
    // hits 100) once per pilot, ever.
    if (hadCargo && cur.cargo > (was.cargo || 0)) {
      const first = !(was.cargo || 0);
      const mark = first ? null : crossed(was.cargo || 0, cur.cargo, CARGO_MARKS);
      // TIER 3 AND UP POSTS EVERY TIME. The heavy manifests are the runs worth
      // watching, and each tier has its own freighter sprite — so the card leads
      // with the ship that actually made it home. Tiers 1–2 keep the old rule
      // (first delivery and milestone counts only) so the road runs stay quiet.
      const ctier = Number((p as any).cargo_tier) || 0;
      const bigHaul = ctier >= 3;
      if (first || mark !== null || bigHaul) {
        const cArt = cargoArt(ctier);
        const cName = CARGO_NAME[ctier] || (ctier ? 'Cargo ' + ctier : 'a shipment');
        events.push({
          kind: 'cargo',
          line: first ? `**${p.name}** made their first delivery`
            : mark !== null ? `**${p.name}** hit ${mark} deliveries`
            : `**${p.name}** delivered ${cName}`,
          embed: {
            color: 0xffb84d,
            author: { name: first ? '🚚  FIRST DELIVERY' : mark !== null ? '🚚  HAULAGE MILESTONE' : '🚚  HEAVY MANIFEST' },
            title: first ? `${p.name} got the cargo through`
              : mark !== null ? `${p.name} — ${mark} lifetime deliveries`
              : `${p.name} brought ${cName} home`,
            description: (first
              ? quip('cargoFirst', 'cg0:' + p.user_id, { a: '**' + p.name + '**' })
              : mark !== null
                ? quip('cargo', 'cg:' + p.user_id + ':' + mark, { a: '**' + p.name + '**', n: mark as number })
                : `**${p.name}** ran **${cName}** through the corridor and docked it at the Citadel.`) +
              (bigHaul ? `\n-# **${cName}** · flown by hand, no autopilot` : '') +
              `\n-# Space Cargo Defense · ${cur.cargo} delivered lifetime`,
            ...hero(cArt),
          },
        });
      }
    }
    // NANOCORES — LEGENDARY ONLY, on purpose. A Common core drops for everyone
    // on their first crate; announcing those would bury the channel in noise and
    // devalue the thing worth announcing. Three events, all top-of-scale:
    // a Legendary recovered, slot depth on one (3, 4, then the full 5), and a
    // roll landing in the top 5% of its range.
    if (hadNano && cur.nanoLegend > (was.nanoLegend || 0)) {
      const first = !(was.nanoLegend || 0);
      const mark = first ? null : crossed(was.nanoLegend || 0, cur.nanoLegend, NANO_MARKS);
      if (first || mark !== null) {
        // THE CORE'S OWN HULL as a thumbnail. A Nanocore belongs to a specific
        // ship, so the card can show which one — the detail that makes it read as
        // a real pull rather than a counter ticking. The celebration GIF stays as
        // the hero image on a first pull: art for the object, GIF for the mood.
        const ng = first ? gifFor('nano', 'nc0:' + p.user_id) : null;
        const nArt = shipArt((p as any).nano_last);
        const nHull = (p as any).nano_last ? hullName(String((p as any).nano_last)) : '';
        events.push({
          kind: 'nano',
          line: first ? `**${p.name}** pulled their first LEGENDARY Nanocore` : `**${p.name}** holds ${mark} Legendary Nanocores`,
          embed: {
            color: 0xf0972a,
            author: { name: first ? '◈  LEGENDARY NANOCORE' : '◈  LEGENDARY COLLECTION' },
            title: first ? `${p.name} recovered a Legendary Nanocore` : `${p.name} — ${mark} Legendary Nanocores`,
            description: (first
              ? quip('nanoFirst', 'nc0:' + p.user_id, { a: '**' + p.name + '**' })
              : quip('nanoLegend', 'nc:' + p.user_id + ':' + mark, { a: '**' + p.name + '**', n: mark as number })) +
              `\n-# Legendary core · **+25% damage · +25% hull · +50% thrust** guaranteed, plus up to **5** extra buff slots` +
              (nHull ? `\n-# recovered for the **${nHull}**` : '') +
              (first && legendHolders > 0
                ? (legendHolders === 1
                  ? `\n-# 🏆 The **FIRST** pilot on this server to recover one. Nobody else has a Legendary core.`
                  : `\n-# The **${ord(legendHolders)}** pilot to recover one · **${NANO_LEGEND_ODDS}%** a crate`)
                : `\n-# ${cur.nanoLegend} Legendary recovered lifetime · ${NANO_LEGEND_ODDS}% a crate`),
            ...thumb(nArt),
            ...(ng ? { image: { url: ng } } : {}),
          },
        });
      }
    }
    // SLOT DEPTH. Slots 3 and 4 post here; a FINISHED 5/5 core is too big for
    // the batch and is queued for its own message below.
    if (hadNano && cur.nanoSlots > (was.nanoSlots || 0) && cur.nanoSlots >= NANO_SLOT_FROM) {
      const slots = Math.min(NANO_SLOT_MAX, cur.nanoSlots);
      if (slots >= NANO_SLOT_MAX) {
        maxCores.push({ name: p.name, god: cur.nanoGod, legend: cur.nanoLegend });
      } else {
        events.push({
          kind: 'nano',
          line: `**${p.name}** opened slot ${slots} on a Legendary`,
          embed: {
            color: 0xd08a2a,
            author: { name: '⬢  SLOT UNLOCKED' },
            title: `${p.name} — ${slots} of 5 slots on a Legendary core`,
            description: quip('nanoSlots', 'ncs:' + p.user_id + ':' + slots, { a: '**' + p.name + '**', n: slots, m: slots * NANO_UPS_PER_SLOT }) +
              `\n-# Every slot is **${NANO_UPS_PER_SLOT} successful upgrades**, the last at **${NANO_LAST_STAGE}%** base — ${slots * NANO_UPS_PER_SLOT} landed on this core` +
              `\n-# Slot ${slots} upgrades cost up to **◈ ${fmt(1000 * NANO_UPS_PER_SLOT * Math.pow(2, slots - 1))}** each attempt, win or lose`,
          },
        });
      }
    }
    if (hadNano && cur.nanoGod > (was.nanoGod || 0)) {
      const firstGod = !(was.nanoGod || 0);
      const gmark = firstGod ? null : crossed(was.nanoGod || 0, cur.nanoGod, NANO_GOD_MARKS);
      if (firstGod || gmark !== null) {
        const gg = firstGod ? gifFor('ingots', 'ncg:' + p.user_id) : null;
        events.push({
          kind: 'nano',
          line: firstGod ? `**${p.name}** landed a god roll on a Legendary core` : `**${p.name}** has ${gmark} Legendary god rolls`,
          embed: {
            color: 0xffd450,
            author: { name: '✧  GOD ROLL' },
            title: firstGod
              ? `${p.name} rolled top-5% on a Legendary core`
              : `${p.name} — ${gmark} top-5% Legendary rolls`,
            description: (firstGod
              ? quip('nanoGod', 'ncg:' + p.user_id, { a: '**' + p.name + '**' })
              : quip('nanoGodN', 'ncg:' + p.user_id + ':' + gmark, { a: '**' + p.name + '**', n: gmark as number })) +
              `\n-# Buff values are weighted toward the floor — only about **${NANO_GOD_PCT}%** of rolls land in the top 5% of their range` +
              `\n-# ${cur.nanoGod} god rolls lifetime`,
            ...(gg ? { image: { url: gg } } : {}),
          },
        });
      }
    }
    if (hadCargo && cur.cargoBest >= 100 && (was.cargoBest || 0) < 100 && (was.cargo || 0) > 0) {
      events.push({
        kind: 'cargo',
        line: `**${p.name}** ran a PERFECT delivery`,
        embed: {
          color: 0xffe1a6,
          author: { name: '✨  PERFECT DELIVERY' },
          title: `${p.name} delivered at 100% integrity`,
          description: quip('cargoClean', 'cgp:' + p.user_id, { a: '**' + p.name + '**' }),
        },
      });
    }
  }

  // ---- A LEGENDARY CORE, FINISHED -------------------------------------------
  // The deepest single-item progression in the game: 25 successful upgrades on
  // ONE core, the last five at 20% base, on a core that only drops 1.5% of the
  // time to begin with. It gets the Kaevith treatment — its own message, full
  // header, never batched, never collapsed.
  // Three standalone messages is already a lot for one 2-minute tick; anything
  // beyond that rides the normal batch as a line rather than its own card.
  for (const m of maxCores.slice(0, 3)) {
    const seed = 'ncm:' + m.name + ':' + m.legend;
    const mg = pickBy(seed, GIFS.maxed);
    const solo = maxHolders <= 1;
    await post({
      content: solo
        ? `# 🏆 THE FIRST LEGENDARY NANOCORE HAS BEEN FINISHED\n-# ${m.name} took one all the way to 5/5. Nobody else on this server has.`
        : `# 🏆 A LEGENDARY NANOCORE HAS BEEN FINISHED\n-# ${m.name} took one core all the way. Five slots. Twenty-five upgrades. Nothing above it.`,
      embeds: [{
        color: 0xffe1a6,
        author: { name: '🏆  LEGENDARY CORE COMPLETE · 5 / 5' },
        title: `🏆  ${up(m.name)}  ⚔  THE ${NANO_LAST_STAGE}% ROLL\u2003— CORE MAXED`,
        image: { url: mg },
        description:
          quip('nanoMax', seed, { a: '**' + m.name + '**' }) + '\n\n' +
          `> \`▰▰▰▰▰\`  **5 of 5 extra buff slots**\n` +
          `> ⚡ **+25% damage · +25% hull · +50% thrust** from the core itself\n` +
          `> 🎲 **${NANO_SLOT_MAX * NANO_UPS_PER_SLOT} successful upgrades** on one core — the last five at **${NANO_LAST_STAGE}%** base\n` +
          `> ◈ Final-slot attempts cost **${fmt(NANO_TOP_COST)} Prism Ingots** each, win or lose\n\n` +
          quip('nanoCost', seed, {}) + '\n' +
          (solo
            ? '-# 🥇 The **FIRST** finished Legendary core on this server.'
            : `-# The **${ord(maxHolders)}** pilot to finish one · ${m.god ? `${m.god} god roll${m.god === 1 ? '' : 's'} banked along the way` : 'still hunting a god roll'}`),
      }],
      allowed_mentions: { parse: [] },
    });
  }

  // Rank #1 is tracked globally, not per pilot — one row holds the current holder.
  if (leader) {
    const was = seen.get('_meta:throne');
    snap.push({
      kind: '_meta',
      ref: 'throne',
      data: { name: leader.name, power: Number(leader.power) || 0 },
      updated_at: now,
    });
    if (!bootstrap && was?.name && was.name !== leader.name) {
      const tseed = 'throne:' + leader.name + ':' + was.name;
      const tg = gifFor('victory', tseed);
      events.push({
        kind: 'throne',
        line: `**${leader.name}** took rank #1`,
        embed: {
          color: COLOR.throne,
          author: { name: '♛  THE THRONE' },
          title: `${leader.name} is now rank #1`,
          description: quip('throne', tseed, { a: '**' + leader.name + '**', d: '**' + was.name + '**' }) +
            `\n\n**power** \`${fmt(Number(leader.power))}\`  ·  **zone** \`${leader.zone}\``,
          ...(tg ? { image: { url: tg } } : {}),
        },
      });
    }
  }

  // ---- season dread ----------------------------------------------------------
  for (const s of sd.data ?? []) {
    const key = `dread:${s.user_id}`;
    const was = seen.get(key);
    const cur = { stage: Number(s.stage) || 0, season: Number(s.season) || 0 };
    snap.push({ kind: 'dread', ref: s.user_id, data: cur, updated_at: now });
    if (bootstrap || !was) continue;
    if (cur.stage > was.stage) {
      events.push({
        kind: 'dread',
        line: `**${s.name}** cleared Dread stage ${cur.stage}`,
        embed: {
          color: COLOR.dread,
          author: { name: '☠  SEASON DREAD' },
          title: `${s.name} cleared Stage ${cur.stage}`,
          description: `-# season ${cur.season} · personal best, up from stage ${was.stage}`,
        },
      });
    }
  }

  // ---- alliances -------------------------------------------------------------
  for (const a of al.data ?? []) {
    const key = `alliance:${a.id}`;
    const was = seen.get(key);
    const cur = { boss_n: Number(a.boss_n) || 0, xp: Number(a.xp) || 0 };
    snap.push({ kind: 'alliance', ref: a.id, data: cur, updated_at: now });
    if (bootstrap) continue;

    if (!was) {
      events.push({
        kind: 'alliance',
        line: `**${a.name}** formed`,
        embed: {
          color: COLOR.alliance,
          author: { name: '⬢  ALLIANCE FORMED' },
          title: `${a.name}  [${a.tag}]`,
          description: '-# recruiting now',
        },
      });
      continue;
    }

    if (cur.boss_n > was.boss_n) {
      const nextHull = 1_000_000 * Math.pow(4, cur.boss_n - 1);
      events.push({
        kind: 'armada',
        line: `**[${a.tag}]** destroyed Armada Mk-${was.boss_n}`,
        embed: {
          color: COLOR.armada,
          author: { name: '⚔  ALLIANCE ARMADA' },
          title: `[${a.tag}] destroyed Mk-${was.boss_n}`,
          description: `**Mk-${cur.boss_n}** has spawned — \`${fmt(nextHull)}\` hull.\n-# ${a.name} · ${fmt(cur.xp)} alliance XP`,
        },
      });
    }
  }

  // ---- territory -------------------------------------------------------------
  // Only OWNERSHIP CHANGES are announced. republishOwnedTiles() rewrites up to
  // 40 tiles the player already holds, which leaves owner and rank untouched and
  // therefore produces nothing here — the repair loop stays silent by design.
  const tiles = terr.data ?? [];
  const live = new Set<string>();
  const tileEvents: (Ev & { actor: string })[] = [];
  const voidEvents: Ev[] = [];

  // A Void spire changing hands is the loudest thing that happens in this game:
  // seven tiles exist, they pay all four currencies hourly, and the citadel comes
  // with the tile. These never collapse into a burst line and never share a
  // message with routine traffic.
  function voidEvent(id: string, kind: 'taken' | 'claimed' | 'lost', held: string, from?: string) {
    const v = VOID[id];
    const crown = id === 'VZ7';
    const NAME = v.name.toUpperCase();
    if (kind === 'lost') {
      voidEvents.push({
        kind: 'void',
        line: `${v.name} went neutral`,
        embed: {
          color: COLOR.void,
          author: { name: '🌌  VOID SPIRE RELEASED' },
          title: `⚫  ${NAME} STANDS EMPTY`,
          description: `**${from || 'Its holder'}** let the spire go.\n\n> Lv ${v.tier} · unclaimed, undefended, and paying nobody.\n-# First fleet to break the siege takes it — citadel included.`,
        },
      });
      return;
    }
    const took = kind === 'taken';
    const vseed = 'void:' + id + ':' + held + ':' + (from || '');
    const vg = gifFor('victory', vseed);
    voidEvents.push({
      kind: 'void',
      line: `**${held}** ${took ? 'seized' : 'claimed'} ${v.name}`,
      embed: {
        color: crown ? COLOR.crown : COLOR.void,
        author: { name: crown ? '👑  THE CROWN HAS CHANGED HANDS' : '🌌  VOID SPIRE SEIZED' },
        title: `${crown ? '👑' : '⚔️'}  ${NAME} ${took ? 'HAS FALLEN' : 'IS TAKEN'}`,
        description:
          (took
            ? quip('void', vseed, { a: '**' + held + '**', d: '**' + (from || 'its holder') + '**', s: v.name })
            : quip('voidClaim', vseed, { a: '**' + held + '**', s: v.name })) +
          `\n\n> 🌀 **Lv ${v.tier}**  ⚡ ${crown ? 'The apex hold beyond the rim' : 'Apex territory'}\n` +
          `> 💰 Pays **all four currencies**, every hour\n` +
          `> 🏰 Citadel included — no builds, no upgrades\n\n` +
          (crown
            ? '-# 🔥 Seven spires exist. This is the one that matters. — 24h shield now up.'
            : '-# 🛡️ 24h attack shield is up. Then it is open again.'),
        ...(vg ? { image: { url: vg } } : {}),
        // THE SPIRE'S OWN ART. Each Void tier draws a different citadel in game
        // (VOID_ART), so the card shows the actual fortress that changed hands
        // alongside the celebration GIF.
        thumbnail: { url: voidArt(v.tier) },
      },
    });
  }

  for (const t of tiles) {
    if (live.has(t.tile_id)) continue;   // duplicate row — one snapshot, one event
    live.add(t.tile_id);
    const was = seen.get(`tile:${t.tile_id}`);
    const lv = hasLv ? (Number(t.citadel_lv) || 0) : (t.citadel ? 1 : 0);
    // SHIELD STATE — a claim puts a 24h (or 15min, after a repelled siege) shield
    // on the tile. Its expiry changes nothing in the row except the clock passing
    // now(), so it is a diff only in the sense that the SAME value means something
    // different a minute later. Snapshotting it as a boolean makes it a real edge.
    const shielded = t.cooldown_until && new Date(t.cooldown_until).getTime() > Date.now() ? 1 : 0;
    const cur = { owner: t.owner_id ?? '', name: t.owner_name ?? '', lv, gone: 0, sh: shielded };
    snap.push({ kind: 'tile', ref: t.tile_id, data: cur, updated_at: now });
    if (bootstrap) continue;

    const sys = tileName(t.tile_id);
    const held = t.owner_name || 'Someone';
    // WHERE IT IS. Tile ids are axial hex coordinates, so a capture can state its
    // exact position on the map — ring, coordinates and sextant — with no extra
    // column and no lookup. Two pilots reading the channel can tell whether a
    // fight happened next door or out past the deep-space line.
    const loc = tileLoc(t.tile_id);
    const locLine = loc ? `\n\n🗺️ ${loc.text}` : '';

    // A tile_id only exists once someone has claimed it, so a row appearing for
    // the first time IS a capture of virgin space — the most common event in the
    // game. Only the bootstrap pass may skip it.
    if (!was) {
      if (!t.owner_id) continue;
      if (VOID[t.tile_id]) { voidEvent(t.tile_id, 'claimed', held); continue; }
      tileEvents.push({
        kind: 'claim', actor: held, sys,
        line: `**${held}** claimed ${sys}`,
        embed: {
          color: COLOR.claim,
          author: { name: '\u2691  SYSTEM CLAIMED' },
          title: `${held} claimed ${sys}`,
          description: (lv > 0
            ? `-# first flag planted \u00b7 Rank ${lv} Citadel raised`
            : '-# unclaimed space, now producing') + locLine,
        },
      });
      continue;
    }

    if (was.owner && cur.owner && was.owner !== cur.owner) {
      if (VOID[t.tile_id]) { voidEvent(t.tile_id, 'taken', held, was.name); continue; }
      const razed = was.lv > 0 && cur.lv === 0;
      const foe = was.name || 'THE HOLDER';
      const sseed = 'steal:' + t.tile_id + ':' + cur.owner + ':' + (was.owner || '');
      const jab = quip(razed || was.lv > 0 || cur.lv > 0 ? 'stealCit' : 'steal', sseed, { a: '**' + held + '**', d: '**' + foe + '**', s: sys });
      const sg = gifFor('owned', sseed);
      tileEvents.push({
        kind: 'steal', actor: held, sys,
        line: `**${held}** took ${sys} from **${foe}**`,
        embed: {
          color: COLOR.steal,
          author: { name: `\u2694\uFE0F  BATTLE FOR ${sys.toUpperCase()}` },
          title: `\u{1F3C6} ${card(held, foe, up(held) + ' TAKES IT')}`,
          description:
            jab + '\n\n' +
            (razed
              ? '> \u{1F4A5} **Citadel razed** — nothing left standing.\n'
              : cur.lv > 0
                ? `> \u{1F3F0} **Rank ${cur.lv} Citadel** taken intact — under a new flag.\n`
                : `> \u{1F6F0}\uFE0F No fortress here — open ground, and it changed hands.\n`) +
            '-# \u{1F6E1}\uFE0F 24h shield now up.' + locLine,
          ...(sg ? { image: { url: sg } } : {}),
        },
      });
    } else if (!was.owner && cur.owner) {
      tileEvents.push({
        kind: 'claim', actor: held, sys,
        line: `**${held}** claimed ${sys}`,
        embed: {
          color: COLOR.claim,
          author: { name: '⚑  SYSTEM CLAIMED' },
          title: `${held} claimed ${sys}`,
          description: '-# unowned space, now producing' + locLine,
        },
      });
    } else if (was.owner && !cur.owner) {
      if (VOID[t.tile_id]) { voidEvent(t.tile_id, 'lost', held, was.name); continue; }
      tileEvents.push({
        kind: 'lost', actor: was.name || 'someone', sys,
        line: `${sys} went neutral`,
        embed: {
          color: COLOR.lost,
          author: { name: '\u25CB  HOLD RELEASED' },
          title: `\u25CB ${sys.toUpperCase()} IS OPEN`,
          description: `**${was.name || 'Its holder'}** let it go.\n-# \u{1F3F3}\uFE0F Unowned, undefended, free to take.` + locLine,
        },
      });
    }

    // Rank changes on a tile that did NOT change hands.
    if (was.owner === cur.owner && cur.lv > was.lv) {
      tileEvents.push({
        kind: 'citadel', actor: held, sys,
        line: was.lv === 0 ? `**${held}** raised a Citadel on ${sys}` : `**${held}** upgraded ${sys} to Rank ${cur.lv}`,
        embed: {
          color: COLOR.citadel,
          author: { name: was.lv === 0 ? '▲  CITADEL RAISED' : '▲  CITADEL UPGRADED' },
          title: was.lv === 0
            ? `\u{1F3F0} ${up(held)} FORTIFIES ${sys.toUpperCase()}`
            : `\u{1F3F0} ${sys.toUpperCase()} → RANK ${cur.lv}`,
          description: was.lv === 0
            ? '-# 1000× output · 24h siege shield'
            : `-# Rank ${was.lv} → ${cur.lv} · ${cur.lv * 10}× output · +${25 * (cur.lv - 1)}% defence`,
        },
      });
    }

    // SHIELD EXPIRY IS NOT ANNOUNCED. A "now available to attack" card is a
    // targeting notice: it tells the whole channel the exact moment a specific
    // pilot's tile lost its protection, which turns the feed into a raid siren
    // pointed at whoever is asleep. The shield state is still snapshotted (`sh`)
    // so the edge is there if it is ever wanted again — nothing posts it.
  }

  // A row that vanished is only called abandoned after two consecutive misses —
  // a delete-then-reinsert during a republish would otherwise read as a loss.
  for (const [key, was] of seen) {
    if (!key.startsWith('tile:')) continue;
    const id = key.slice(5);
    if (live.has(id)) continue;
    const misses = (Number(was.gone) || 0) + 1;
    snap.push({ kind: 'tile', ref: id, data: { ...was, gone: misses }, updated_at: now });
    if (bootstrap || misses !== 2 || !was.owner) continue;
    const sys = tileName(id);
    tileEvents.push({
      kind: 'lost', actor: was.name || 'someone', sys,
      line: `${sys} was released`,
      embed: {
        color: COLOR.lost,
        author: { name: '○  SYSTEM ABANDONED' },
        title: `\u25CB ${sys.toUpperCase()} IS OPEN`,
        description: `**${was.name || 'Its holder'}** released it.\n-# \u{1F3F3}\uFE0F Unowned, undefended, free to take.`,
      },
    });
  }

  // Collapse per-actor bursts so one player's sweep is a line, not a wall.
  const byActor = new Map<string, (Ev & { actor: string })[]>();
  for (const e of tileEvents) {
    const g = byActor.get(e.actor) ?? [];
    g.push(e); byActor.set(e.actor, g);
  }
  for (const [actor, group] of byActor) {
    if (group.length <= BURST) { events.push(...group); continue; }
    // A capture off another pilot is a BATTLE and always gets its own card,
    // citadel or not. Only quiet bulk activity — first claims on empty space and
    // releases — ever collapses into a summary line.
    const loud = group.filter((e) => e.kind === 'steal' || e.kind === 'citadel');
    events.push(...loud);
    const rest = group.filter((e) => e.kind !== 'steal' && e.kind !== 'citadel');
    if (!rest.length) continue;
    events.push({
      kind: 'steal',
      line: `**${actor}** moved on ${rest.length} systems`,
      embed: {
        color: COLOR.steal,
        author: { name: '\u2691  LAND GRAB' },
        title: `${up(actor)} SWEPT ${rest.length} SYSTEMS`,
        description: quip('grab', 'grab:' + actor + ':' + rest.length, { a: '**' + actor + '**', n: rest.length }) +
          '\n-# ' + rest.slice(0, 5).map((e) => e.sys || '').filter(Boolean).join(' · ') +
          (rest.length > 5 ? ` · +${rest.length - 5} more` : ''),
      },
    });
  }

  // ---- war log ---------------------------------------------------------------
  // A successful defence leaves no diff to find: the tile does not change hands,
  // so the attacker's client reports it through log_repelled() and we drain the
  // tail here. The cursor is an id high-water mark, so nothing repeats.
  {
    const seenId = Number((seen.get('_meta:war') || {}).id) || 0;
    let maxId = seenId;
    const digests: Record<string, unknown>[] = [];
    for (const w of war.data ?? []) {
      const id = Number(w.id) || 0;
      if (id > maxId) maxId = id;
      if (bootstrap || id <= seenId) continue;

      // DAILY DIGEST — queued by daily_ranks_award() at 00:05 UTC. One message,
      // all seven ladders, top 5 each.
      if (w.kind === 'digest') {
        digests.push(w.meta || {});
        continue;
      }
      // KAEVITH HULL EARNED — the rarest event in the game. Its own message,
      // never batched, never collapsed into a burst line.
      if (w.kind === 'xen_hull') {
        hullEvents.push(w);
        continue;
      }
      // BIG BET — posted the moment the round settles. Rate limited in SQL
      // (casino_big_bet), so anything arriving here has already earned its place.
      if (w.kind === 'bigbet') {
        const m: any = w.meta || {};
        const who = String(w.actor_name || 'A pilot');
        const tier = String(m.tier || 'big');
        const cur = String(m.cur || 'gold');
        const G: Record<string, { g: string; n: string }> = {
          gold:    { g: '$', n: 'gold' },
          credits: { g: '◈', n: 'LootCoins' },
          fuel:    { g: '⬢', n: 'fuel' },
          iron:    { g: '◆', n: 'iron' },
          plasma:  { g: '✦', n: 'plasma' },
        };
        const cu = G[cur] || G.gold;
        const stake = Number(m.stake) || 0;
        const net = Number(m.net) || 0;
        const won = net > 0;
        const push = net === 0;
        const head = tier === 'colossal'
          ? `# 🐋 WHALE AT THE TABLE`
          : tier === 'huge' ? `## 🎰 HIGH ROLLER` : `### 🎰 HIGH STAKES`;
        const outcome = push
          ? `pushed — stake returned`
          : won ? `**won ${cu.g} ${fmt(net)}**` : `**lost ${cu.g} ${fmt(Math.abs(net))}**`;
        const jab = push ? '' : quip(won ? 'bigbetWin' : 'bigbetLose', 'bet:' + id, { a: '**' + who + '**' });
        events.push({
          kind: 'bigbet', sys: '',
          line: `**${who}** staked ${cu.g} ${fmt(stake)} on ${m.game || 'the tables'} and ${push ? 'pushed' : won ? 'won' : 'lost'}`,
          embed: {
            color: tier === 'colossal' ? COLOR.whale : COLOR.bigbet,
            author: { name: tier === 'colossal' ? '🐋  WHALE AT THE TABLE' : tier === 'huge' ? '🎰  HIGH ROLLER' : '🎰  HIGH STAKES' },
            title: `${who} — ${m.game || 'the tables'}`,
            description: (jab ? jab + '\n' : '') + `Staked **${cu.g} ${fmt(stake)}** ${cu.n} and ${outcome}.` +
              (won ? '' : push ? '' : `\n-# The house keeps it — **1%** goes to the three citadel holders at midnight UTC.`),
            fields: [
              { name: 'STAKE', value: `${cu.g} ${fmt(stake)}`, inline: true },
              { name: push ? 'RESULT' : won ? 'WON' : 'LOST', value: push ? 'push' : `${cu.g} ${fmt(Math.abs(net))}`, inline: true },
              { name: 'TABLE', value: String(m.game || '—'), inline: true },
            ],
          },
        });
        continue;
      }
      if (w.kind !== 'repelled') continue;
      const sys = tileName(w.tile_id || '');
      const lv = Number((w.meta || {}).citadel_lv) || 0;
      const isVoid = !!VOID[w.tile_id || ''];
      const def = String(w.target_name || 'THE HOLDER');
      const atk = String(w.actor_name || 'AN ATTACKER');
      const rseed = 'repel:' + id;
      const rg = gifFor('fine', rseed);
      events.push({
        kind: 'repel', sys,
        line: `**${def}** repelled **${atk}**`,
        embed: {
          color: COLOR.repel,
          author: { name: `\u{1F6E1}\uFE0F  ${isVoid ? 'SIEGE OF' : 'BATTLE FOR'} ${sys.toUpperCase()}` },
          title: `\u{1F6E1}\uFE0F ${card(def, atk, up(def) + ' HOLDS')}`,
          description:
            quip('repel', rseed, { a: '**' + atk + '**', d: '**' + def + '**', s: sys }) + '\n\n' +
            (lv > 0
              ? `> \u{1F3F0} The **Rank ${lv} Citadel** never fell.\n`
              : '> \u2694\uFE0F The garrison outlasted them.\n') +
            (isVoid ? '> \u{1F300} An apex spire stays where it is.\n' : '') +
            '-# \u{1F6E1}\uFE0F Shielded against them for 15 minutes.',
          ...(rg ? { image: { url: rg } } : {}),
        },
      });
    }
    if (maxId !== seenId) snap.push({ kind: '_meta', ref: 'war', data: { id: maxId }, updated_at: now });

    // ---- KAEVITH HULL EARNED -------------------------------------------------
    // The loudest single-pilot event in the game. Only ~1 zone in 5 is invaded
    // and a clear pays 1–10%, so most accounts will never see one — the card
    // leads with the scarcity, then what the hull actually does for a fleet.
    for (const w of hullEvents) {
      const m = w.meta || {};
      const h = XEN_HULLS[String(m.ship || '')] ;
      if (!h) continue;
      const who = String(w.actor_name || 'A pilot');
      const nth = Number(m.nth) || 1;
      const ring = Number(m.ring) || 0;
      const apex = h.tier === 5;
      const bar = '▰'.repeat(h.tier) + '▱'.repeat(5 - h.tier);
      await post({
        content: apex
          ? `# ◈ THE GODSHARD HAS BEEN RECOVERED\n-# ${who} holds the Incursion's flagship. There is nothing above it.`
          : `# ◈ ALIEN SHIP TECHNOLOGY RECOVERED\n-# ${who} tore a Kaevith hull out of the void.`,
        embeds: [{
          color: apex ? COLOR.crown : COLOR.xen,
          thumbnail: { url: 'https://lootfleet.com/ships/ship-' + String(m.ship || '') + '.png' },
          ...(apex ? { image: { url: pickBy('hull:' + w.id, GIFS.victory) } } : {}),
          author: { name: apex ? '👑  KAEVITH V · GODSHARD' : `◈  KAEVITH ${['', 'I', 'II', 'III', 'IV', 'V'][h.tier]} · RECOVERED` },
          title: `${apex ? '👑' : '◈'}  ${up(who)}  ⚔  THE KAEVITH\u2003— ${h.name.toUpperCase()} EARNED`,
          description:
            `**${who}** cleared an alien-held zone${ring ? ` on **ring ${ring}**` : ''} and walked out with the **${h.name}**.\n\n` +
            `> \`${bar}\`  **${h.cls}-class**\n` +
            `> ⚡ **+${h.xp}% XP per kill for their ENTIRE fleet** — flagship or escort\n` +
            `> 🚫 Never sold, never blueprinted. Earned only in My Galaxy.\n\n` +
            // The pity flag is recorded but NEVER announced — a public
            // "guaranteed drop" line would expose the hidden floor.
            (nth === 1
              ? '-# 🏆 The **FIRST** of this hull ever recovered. Nobody else has one.'
              : `-# The **${ord(nth)}** ever recovered · ~${Math.round(XEN_SHARE * 100)}% of zones are alien-held`),
        }],
        allowed_mentions: { parse: [] },
      });
    }

    // The digest is its own message — a day-in-review header plus one field per
    // ladder, so it reads as a scoreboard rather than another event in the feed.
    for (const d of digests) {
      const boards = (d as any).boards || [];
      const medal = ['\u{1F947}', '\u{1F948}', '\u{1F949}', '4.', '5.'];
      const fields = boards
        .filter((b: any) => (b.top || []).length)
        .map((b: any) => ({
          name: String(b.label || b.id).toUpperCase(),
          value: (b.top || []).slice(0, 5).map((r: any, i: number) =>
            `${medal[i]} **${r.name}** \u2014 ${b.id === 'voidmaw' ? 'stage ' + Math.round(Number(r.value)) : fmt(Number(r.value))}`
          ).join('\n') || '\u2014',
          inline: true,
        }));
      if (!fields.length) continue;
      await post({
        content: `# \u{1F4CA}\u2003DAILY STANDINGS \u2014 ${(d as any).day || ''}\n-# Top five on all six ladders. Top 100 have been paid \u2014 check your mail in game.`,
        embeds: [{
          color: COLOR.crown,
          fields: fields.slice(0, 9),
          timestamp: now,
          footer: { text: 'Resets 00:05 UTC \u00b7 LootFleet' },
        }],
        allowed_mentions: { parse: [] },
      });
    }
  }

  // ---- SITUATION REPORT ------------------------------------------------------
  // Every 3 hours: where the ladders stand, what moved in My Galaxy since the
  // last report, when each Void spire's shield drops, and how Season 1 of the
  // Voidmaw is going. This function ticks every 2 minutes to diff events, so the
  // report rides its own clock kept in feed_seen — no second cron job, and the
  // timer survives redeploys.
  //
  // The "what moved" section is fed by a rolling buffer: every event this feed
  // announces appends its one-line summary, and the report drains it. That way
  // the digest reflects exactly what was posted, with no second pass over the
  // tables and no risk of the two disagreeing.
  {
    const meta = seen.get('_meta:sitrep') || {};
    const last = Number(meta.at) || 0;
    const buf: string[] = Array.isArray(meta.buf) ? meta.buf : [];
    const fresh = [...events, ...voidEvents].map((e) => e.line).filter(Boolean);
    for (const w of hullEvents) {
      const h = XEN_HULLS[String((w.meta || {}).ship || '')];
      if (h) fresh.push(`◈ **${w.actor_name}** earned the **${h.name}**`);
    }
    // Finished cores post their own message, so they never reach `events` —
    // add them here or the 3-hour digest would omit the loudest thing in it.
    for (const m of maxCores) fresh.push(`🏆 **${m.name}** finished a Legendary Nanocore (5/5)`);
    const merged = [...buf, ...fresh].slice(-40);
    const due = !bootstrap && last > 0 && Date.now() - last >= SITREP_MS;

    if (bootstrap || !last) {
      // Start the clock without posting — the bootstrap message already fired.
      snap.push({ kind: '_meta', ref: 'sitrep', data: { at: Date.now(), buf: [] }, updated_at: now });
    } else if (!due) {
      snap.push({ kind: '_meta', ref: 'sitrep', data: { at: last, buf: merged }, updated_at: now });
    } else {
      const medal = ['🥇', '🥈', '🥉', '4.', '5.'];
      const fields: Record<string, unknown>[] = [];

      // ---- ladders: top five by fleet power ----
      if (pilots.length) {
        fields.push({
          name: '♛  FLEET POWER',
          value: pilots.slice(0, 5).map((p, i) =>
            `${medal[i]} **${p.name}** — \`${fmt(Number(p.power) || 0)}\``).join('\n'),
          inline: true,
        });
        // Territory is the other ladder that moves hour to hour.
        const held = new Map<string, number>();
        for (const t of tiles) {
          if (!t.owner_name) continue;
          held.set(t.owner_name, (held.get(t.owner_name) || 0) + 1);
        }
        const topTiles = [...held.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (topTiles.length) {
          fields.push({
            name: '⚑  TERRITORY',
            value: topTiles.map(([n, c], i) => `${medal[i]} **${n}** — \`${c}\` systems`).join('\n'),
            inline: true,
          });
        }
      }

      // ---- Season Dread / Voidmaw ----
      const maw = (sd.data ?? []).slice()
        .sort((a, b) => (Number(b.stage) || 0) - (Number(a.stage) || 0));
      const season = maw.length ? (Number(maw[0].season) || 1) : 1;
      if (maw.length) {
        const deepest = Number(maw[0].stage) || 0;
        fields.push({
          name: `☠  VOIDMAW · SEASON ${season}`,
          value: maw.slice(0, 5).map((s, i) =>
            `${medal[i]} **${s.name}** — stage \`${Number(s.stage) || 0}\``).join('\n') +
            `\n-# deepest run this season: stage ${deepest} · ${maw.length} pilots entered`,
          inline: false,
        });
      }

      // ---- Void spires: who holds them ----
      // No shield countdowns and no "open now" flags — a public timer on when a
      // named pilot's spire becomes attackable is a raid schedule, not a report.
      const spireLines: string[] = [];
      for (const id of Object.keys(VOID)) {
        const v = VOID[id];
        const row = tiles.find((t) => t.tile_id === id);
        if (!row || !row.owner_id) {
          spireLines.push(`🟢 **${v.name}** \`Lv ${v.tier}\` — **UNCLAIMED**`);
          continue;
        }
        spireLines.push(`🌀 **${v.name}** \`Lv ${v.tier}\` — held by **${row.owner_name}**`);
      }
      if (spireLines.length) {
        const open = spireLines.filter((l) => l.startsWith('🟢')).length;
        fields.push({
          name: `🌌  THE VOID ZONE — ${7 - open} of 7 held`,
          value: spireLines.join('\n'),
          inline: false,
        });
      }

      // ---- Kaevith Incursion standing ----
      const hullsOut = (war.data ?? []).filter((w) => w.kind === 'xen_hull');
      const byHull = new Map<string, number>();
      for (const w of hullsOut) {
        const k = String((w.meta || {}).ship || '');
        if (XEN_HULLS[k]) byHull.set(k, (byHull.get(k) || 0) + 1);
      }
      fields.push({
        name: '◈  THE KAEVITH INCURSION',
        value: `~**${Math.round(XEN_SHARE * 100)}%** of My Galaxy is alien-held. Clearing a void zone pays **1–10%** for a hull — deeper rings, better odds.\n` +
          Object.keys(XEN_HULLS).map((k) => {
            const h = XEN_HULLS[k], n = byHull.get(k) || 0;
            return `${n ? '✅' : '⬜'} **${h.name}** \`+${h.xp}% fleet XP\` — ${n ? `${n} recovered` : 'never recovered'}`;
          }).join('\n'),
        inline: false,
      });

      // ---- NANOCORES · the top of the scale -----------------------------
      // Legendary only, matching the events. Three figures, all read from rows
      // already in memory: who holds one, who finished one, who is luckiest.
      {
        const held = pilots.filter((p) => nanoOf(p, 'nano_legend') > 0);
        const done = pilots.filter((p) => nanoOf(p, 'nano_slots') >= NANO_SLOT_MAX);
        const deepest = pilots.reduce((m, p) => Math.max(m, nanoOf(p, 'nano_slots')), 0);
        const topLeg = pilots.slice()
          .sort((a, b) => nanoOf(b, 'nano_legend') - nanoOf(a, 'nano_legend'))
          .filter((p) => nanoOf(p, 'nano_legend') > 0).slice(0, 3);
        const topGod = pilots.slice()
          .sort((a, b) => nanoOf(b, 'nano_god') - nanoOf(a, 'nano_god'))
          .filter((p) => nanoOf(p, 'nano_god') > 0)[0];
        fields.push({
          name: `◈  NANOCORES — ${held.length} pilot${held.length === 1 ? '' : 's'} hold a Legendary`,
          value: `Legendary cores drop at **${NANO_LEGEND_ODDS}%** a crate. Building one out takes **${NANO_SLOT_MAX * NANO_UPS_PER_SLOT} successful upgrades**, the last five at **${NANO_LAST_STAGE}%**.\n` +
            (topLeg.length
              ? topLeg.map((p, i) => `${medal[i]} **${p.name}** — \`${nanoOf(p, 'nano_legend')}\` Legendary` +
                  (nanoOf(p, 'nano_slots') >= NANO_SLOT_MAX ? ' · **5/5 core finished**' : nanoOf(p, 'nano_slots') ? ` · ${nanoOf(p, 'nano_slots')}/5 slots` : '')).join('\n')
              : '-# Nobody has pulled one yet. The first is going to be loud.') +
            (topGod ? `\n✧ Best rolls: **${topGod.name}** — \`${nanoOf(topGod, 'nano_god')}\` top-5% buffs` : '') +
            `\n${done.length ? `🏆 **${done.length}** finished core${done.length === 1 ? '' : 's'} in existence` : `⬜ No finished core yet — deepest build is **${deepest}/5** slots`}`,
          inline: false,
        });
      }

      // ---- THE HOUSE CITADELS ----
      // Who holds the three casino holds, what the house took today, and what 1%
      // of it is worth. Read live rather than from war_events so the owners are
      // current even on a report where nothing changed hands.
      const [cits, pool, terr] = await Promise.all([
        db.from('casino_citadels').select('id,name,owner_name,shield_until').order('id'),
        db.from('casino_day_losses').select('*')
          .eq('day', new Date().toISOString().slice(0, 10)).maybeSingle(),
        db.from('territory').select('tile_id,owner_name,cooldown_until').in('tile_id', ['CC1','CC2','CC3']),
      ]);
      {
        const p: any = pool.data || {};
        const cut = (v: any) => fmt(Math.floor((Number(v) || 0) * 0.01));
        const took = [
          Number(p.gold) ? `$ ${fmt(Number(p.gold))}` : '',
          Number(p.credits) ? `◈ ${fmt(Number(p.credits))}` : '',
          Number(p.fuel) ? `⬢ ${fmt(Number(p.fuel))}` : '',
          Number(p.iron) ? `◆ ${fmt(Number(p.iron))}` : '',
          Number(p.plasma) ? `✦ ${fmt(Number(p.plasma))}` : '',
        ].filter(Boolean).join(' · ') || 'nothing yet today';
        const holders = new Map<string, any>();
        for (const t of (terr.data ?? [])) holders.set(String(t.tile_id), t);
        const rows = (cits.data ?? []).map((c: any) => {
          const t = holders.get(String(c.tile_id)) || {};
          c.owner_name = t.owner_name || null;
          if (!c.owner_name) return `⬜ **${c.name}** ` + `(${c.share_pct}% · Lv ${c.req_lv})` + ' — *unclaimed*';
          return `🎰 **${c.name}** ` + `(${c.share_pct}%)` + ` — **${c.owner_name}**`;
        });
        const held = (cits.data ?? []).filter((c: any) => c.owner_name).length;
        fields.push({
          name: `🎰  THE HOUSE CITADELS — ${held} of 3 held`,
          value: `The house took **${took}** today from **${fmt(Number(p.hands) || 0)}** hands across **${fmt(Number(p.players) || 0)}** pilots.\n` +
            `Holds are sieged like Void spires. Each pays its owner **its own share** at midnight UTC` +
            (Number(p.gold) || Number(p.credits)
              ? ` — currently **$ ${cut(p.gold)}** + **◈ ${cut(p.credits)}** each.\n`
              : '.\n') +
            (rows.length ? rows.join('\n') : '-# No citadels configured.'),
          inline: false,
        });
      }

      // ---- what moved since the last report ----
      if (merged.length) {
        const tail = merged.slice(-12);
        fields.push({
          name: `⚔  MY GALAXY — LAST 3 HOURS (${merged.length} event${merged.length === 1 ? '' : 's'})`,
          value: tail.map((l) => `• ${l}`).join('\n').slice(0, 1020),
          inline: false,
        });
      } else {
        fields.push({
          name: '⚔  MY GALAXY — LAST 3 HOURS',
          value: '-# Quiet. No systems changed hands, no sieges broken.',
          inline: false,
        });
      }

      await post({
        content: `# 📡\u2003FLEET SITUATION REPORT\n-# <t:${Math.floor(Date.now() / 1000)}:f> · next report in 3 hours`,
        embeds: [{
          color: COLOR.sitrep,
          fields: fields.slice(0, 9),
          timestamp: now,
          footer: { text: 'Every 3 hours · LootFleet' },
        }],
        allowed_mentions: { parse: [] },
      });
      snap.push({ kind: '_meta', ref: 'sitrep', data: { at: Date.now(), buf: [] }, updated_at: now });
    }
  }

  // ---- publish ---------------------------------------------------------------
  if (bootstrap) {
    snap.push({ kind: '_meta', ref: 'bootstrap', data: { at: Date.now() }, updated_at: now });
    await saveSeen(db, snap);
    await post({
      content: '## ⚡  FLEET DISPATCH IS LIVE\n-# v' + FEED_VER + ' · Ascensions, rank changes, deep-zone breaks, Season Dread records and Armada kills will appear here as they happen.',
    });
    return json({ ok: true, ver: FEED_VER, bootstrap: true, tracked: snap.length });
  }

  if (!events.length && !voidEvents.length) {
    await saveSeen(db, snap);
    return json({ ok: true, ver: FEED_VER, events: 0 });
  }

  // Void spires get their own message with a full-width header, so they can
  // never be buried under routine tile traffic in the same batch.
  if (voidEvents.length) {
    const crown = voidEvents.some((e) =>
      String(((e.embed as any).author || {}).name || '').includes('CROWN'));
    await post({
      content: crown
        ? '# 👑 THE CROWN HAS MOVED\n-# The Void Zone has a new master.'
        : '# 🌌 THE VOID STIRS\n-# One of seven apex spires has changed hands.',
      embeds: voidEvents.slice(0, MAX_EMBEDS).map((e) => ({
        ...e.embed, timestamp: now, footer: { text: 'THE VOID ZONE · LootFleet' },
      })),
      allowed_mentions: { parse: [] },
    });
  }

  if (!events.length) {
    await saveSeen(db, snap);
    return json({ ok: true, ver: FEED_VER, events: voidEvents.length, void: voidEvents.length });
  }

  events.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const shown = events.slice(0, MAX_EMBEDS);
  const rest = events.slice(MAX_EMBEDS);

  const stamped = shown.map((e) => ({ ...e.embed, timestamp: now, footer: { text: 'LootFleet' } }));
  let content: string | undefined;
  if (rest.length) {
    content = `-# …and ${rest.length} more: ` + rest.slice(0, 6).map((e) => e.line).join(' · ');
  }

  await post({ content, embeds: stamped, allowed_mentions: { parse: [] } });
  await saveSeen(db, snap);

  return json({ ok: true, ver: FEED_VER, events: events.length + voidEvents.length, posted: shown.length, void: voidEvents.length });
});

// PostgREST caps every select at 1000 rows, SILENTLY. That cap is how this feed
// melted down: once feed_seen grew past 1000 rows, the cursor read came back
// truncated, the tiles that fell off the page looked brand new every tick, and
// the channel got the same "SYSTEM CLAIMED" cards every 2 minutes forever.
// EVERY full-table read goes through this pager — ordered by PK so pages are
// stable — and returns the complete table no matter how big it grows.
async function selectAll(db: any, table: string, cols: string, orderCols: string[]) {
  const PAGE = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(cols);
    for (const c of orderCols) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
}

// The cursor write is the feed's memory — if it fails SILENTLY, every event
// re-posts forever. Dedupe by (kind,ref) first (a duplicate pair aborts the
// whole upsert statement in Postgres), chunk it (the snapshot is one row per
// pilot + tile and grows without bound), and THROW on error so a failed write
// shows up red in net._http_response instead of spamming the channel.
async function saveSeen(db: any, snap: any[]) {
  const byKey = new Map<string, any>();
  for (const r of snap) byKey.set(`${r.kind}:${r.ref}`, r);
  const rows = [...byKey.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('feed_seen').upsert(rows.slice(i, i + 500), { onConflict: 'kind,ref' });
    if (error) throw new Error('feed_seen upsert: ' + error.message);
  }
}

async function post(body: Record<string, unknown>) {
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 429 = webhook rate limit; the next cron tick re-sends because the cursor
  // is only advanced after a successful post path.
  if (!res.ok) throw new Error(`discord ${res.status}: ${await res.text()}`);
}

function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
}

