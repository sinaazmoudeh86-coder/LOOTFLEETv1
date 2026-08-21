// =============================================================================
//  catalog.ts — THE EVENT REGISTRY
// -----------------------------------------------------------------------------
//  ONE place that answers "what can the feed announce, and how loud is it".
//
//  WHY THIS EXISTS. index.ts grew to ~1,950 lines with roughly thirty event
//  kinds declared inline, each carrying its own colour literal, its own icon,
//  its own header string and its own idea of how important it was. Three
//  consequences, all of them visible in the channel:
//
//    1. NOTHING HAD A PRIORITY. A pilot signing up and a galaxy-first crown were
//       both "one embed", competing for the same ten slots in a two-minute tick.
//       On a busy tick the crown could be the thing that got cut.
//    2. THE CHANNEL READ AS NOISE. Ten cards of equal visual weight, several of
//       them "X hit level 220", buried the two that mattered.
//    3. ADDING A FEATURE MEANT READING 1,950 LINES to find the conventions —
//       which is how colours drifted and why some events had GIFs and some did
//       not for no reason anyone could state.
//
//  THE MODEL: THREE TIERS, AND THE TIER DECIDES THE PRESENTATION.
//
//    headline — the galaxy should stop and look. Crowns, #1 changes, first-evers,
//               apex spires, a finished Legendary core. Posted in their OWN
//               message under a full-width banner, always with art or a GIF, and
//               NEVER dropped for volume.
//    notable  — worth a card of its own: ascensions, deep-zone breaks, milestone
//               counts, citadels, sieges. Gets an embed when there is room.
//    ambient  — true but small: a pilot joined, a level ticked over, a tile went
//               neutral. NEVER its own embed. Rolled into one digest line so the
//               information is still there and the channel stays readable.
//
//  Everything below is data. Adding an event means adding one row here and one
//  push in the collector — not inventing a colour and a tone from scratch.
// =============================================================================

export type Tier = 'headline' | 'notable' | 'ambient';

export interface EventDef {
  /** Which game system this belongs to — drives the sitrep grouping. */
  feature: string;
  tier: Tier;
  /** Embed accent. */
  color: number;
  /** Leading glyph used in digests and banners. */
  icon: string;
  /** Human label used in the banner line for headline events. */
  label: string;
  /** GIF mood from voice.ts, when this event warrants one. */
  gif?: string;
  /**
   * SELF-POSTING. A few events emit their own `post()` call at the moment they
   * are detected instead of being pushed onto the events array. They predate the
   * tier system and already do what `headline` does — own message, full-width
   * banner, never batched — so they are marked rather than rewritten: churning a
   * live feed's loudest paths to satisfy a refactor is how a working thing
   * breaks. The flag exists so this registry stays a true statement of what the
   * feed can say, and so the next person does not go looking for a producer that
   * is structured differently rather than missing.
   */
  selfPost?: boolean;
}

export const COLOR = {
  open: 0x00d18f, repel: 0x4db4ff, void: 0x9b4dff, crown: 0xffd24d,
  steal: 0xff5a4d, citadel: 0xffcf4d, claim: 0x8fb7d9, lost: 0x5a6472,
  throne: 0xb57bff, ascend: 0xf5c542, armada: 0xff8a3d, dread: 0xff4d6d,
  zone: 0x5bc8ff, level: 0x4da3ff, top10: 0x3dd68c, alliance: 0x3dd68c,
  pilot: 0x6e7a8a, xen: 0xc26bff, sitrep: 0x6f7dff, bigbet: 0xffd66a,
  whale: 0xff3b6b,
  // features added in 688
  expo: 0x7fe0ff, hcwave: 0x6fe0a0, koth: 0xffd24d,
};

// -----------------------------------------------------------------------------
// THE REGISTRY
// -----------------------------------------------------------------------------
export const CATALOG: Record<string, EventDef> = {
  // ---- THE THRONE ----------------------------------------------------------
  throne:   { feature: 'power',    tier: 'headline', color: COLOR.throne,   icon: '♛', label: 'THE THRONE HAS CHANGED HANDS', gif: 'victory' },
  ascend:   { feature: 'power',    tier: 'notable',  color: COLOR.ascend,   icon: '✦', label: 'ASCENSION' },
  top10:    { feature: 'power',    tier: 'notable',  color: COLOR.top10,    icon: '▲', label: 'TOP TEN' },
  zone:     { feature: 'power',    tier: 'notable',  color: COLOR.zone,     icon: '⌖', label: 'DEEP ZONE' },
  level:    { feature: 'power',    tier: 'ambient',  color: COLOR.level,    icon: '↑', label: 'LEVEL' },
  pilot:    { feature: 'power',    tier: 'ambient',  color: COLOR.pilot,    icon: '＋', label: 'NEW PILOT' },

  // ---- THE VOID + TERRITORY ------------------------------------------------
  void:     { feature: 'void',     tier: 'headline', color: COLOR.void,     icon: '🌌', label: 'THE VOID STIRS', gif: 'victory' },
  steal:    { feature: 'galaxy',   tier: 'notable',  color: COLOR.steal,    icon: '⚔', label: 'SYSTEM TAKEN', gif: 'owned' },
  citadel:  { feature: 'galaxy',   tier: 'notable',  color: COLOR.citadel,  icon: '⛓', label: 'CITADEL' },
  repel:    { feature: 'galaxy',   tier: 'notable',  color: COLOR.repel,    icon: '🛡', label: 'SIEGE REPELLED', gif: 'fine' },
  claim:    { feature: 'galaxy',   tier: 'ambient',  color: COLOR.claim,    icon: '⚑', label: 'CLAIMED' },
  lost:     { feature: 'galaxy',   tier: 'ambient',  color: COLOR.lost,     icon: '·', label: 'WENT NEUTRAL' },
  // A DELIBERATE ABANDON IS ALREADY COVERED. The tile row disappears from
  // `territory`, the two-miss detector fires `lost`, and the channel reads
  // "X went neutral" — the same news from a source that exists. A separate
  // `release` kind would need the client to report its own abandons, which is
  // both forgeable and redundant, so there is deliberately no entry here.

  // ---- FLEETS + COLLECTIONS ------------------------------------------------
  hull:     { feature: 'hangar',   tier: 'notable',  color: COLOR.xen,      icon: '➤', label: 'NEW HULL' },
  nano:     { feature: 'nanocore', tier: 'notable',  color: 0xf0972a,       icon: '◈', label: 'NANOCORE', gif: 'nano' },
  nanomax:  { feature: 'nanocore', tier: 'headline', color: 0xf0972a,       icon: '◈', label: 'A LEGENDARY CORE IS FINISHED', gif: 'maxed', selfPost: true },
  cargo:    { feature: 'cargo',    tier: 'notable',  color: 0xffb84d,       icon: '⛟', label: 'HAULAGE' },
  dread:    { feature: 'dread',    tier: 'notable',  color: COLOR.dread,    icon: '☠', label: 'DREAD RECORD' },

  // ---- ALLIANCES -----------------------------------------------------------
  armada:   { feature: 'alliance', tier: 'headline', color: COLOR.armada,   icon: '⚑', label: 'AN ARMADA HAS FALLEN', gif: 'victory' },
  alliance: { feature: 'alliance', tier: 'ambient',  color: COLOR.alliance, icon: '⬡', label: 'ALLIANCE FORMED' },

  // ---- CASINO --------------------------------------------------------------
  bigbet:   { feature: 'casino',   tier: 'notable',  color: COLOR.bigbet,   icon: '🎲', label: 'BIG BET' },

  // ==========================================================================
  // ADDED IN BUILD 688 — the three new ladders and Fleet Exploration
  // ==========================================================================

  // FLEET EXPLORATION. An ordinary expedition landing is not news — a pilot can
  // run several a day and the channel would drown. Only two things are:
  // crossing a round number of completed runs, and bringing a ★★★★★ wing home
  // clean, which needs five hulls grounded for most of a day.
  expo:     { feature: 'expo',     tier: 'notable',  color: COLOR.expo,     icon: '◎', label: 'EXPEDITION', gif: 'nano' },
  expoElite:{ feature: 'expo',     tier: 'headline', color: COLOR.expo,     icon: '◎', label: 'A FIVE-STAR WING IS IN THE FIELD', gif: 'victory' },

  // HOME DEFENSE. Wave milestones only, and the era boundaries are the
  // milestones the game itself already treats as meaningful (RARE 20, EPIC 50,
  // LEGENDARY 100 and its ×2 production, MYTHIC 250).
  hcwave:   { feature: 'hcwave',   tier: 'notable',  color: COLOR.hcwave,   icon: '⛨', label: 'HOME DEFENSE' },
  hcEra:    { feature: 'hcwave',   tier: 'headline', color: COLOR.hcwave,   icon: '⛨', label: 'A CITADEL HAS ENTERED A NEW ERA', gif: 'victory' },

  // KING OF THE HILL. The race has a hard 24-hour deadline, which makes its
  // announcements time-critical in a way nothing else here is: a crown posted
  // late is worthless, and an opening posted late costs entrants.
  kothOpen: { feature: 'koth',     tier: 'notable',  color: COLOR.koth,     icon: '👑', label: 'THE HILL IS OPEN' , selfPost: true },
  kothLead: { feature: 'koth',     tier: 'notable',  color: COLOR.koth,     icon: '👑', label: 'LEAD CHANGE', gif: 'owned' , selfPost: true },
  kothWarn: { feature: 'koth',     tier: 'notable',  color: COLOR.koth,     icon: '⏳', label: 'FINAL HOUR' , selfPost: true },
  kothCrown:{ feature: 'koth',     tier: 'headline', color: COLOR.koth,     icon: '👑', label: 'THE HILL HAS A KING', gif: 'victory' , selfPost: true },
  kothDyn:  { feature: 'koth',     tier: 'headline', color: COLOR.koth,     icon: '👑', label: 'A DYNASTY IS FORMING', gif: 'maxed' },
};

export const TIER_OF = (kind: string): Tier => (CATALOG[kind]?.tier ?? 'notable');
export const DEF = (kind: string): EventDef =>
  CATALOG[kind] ?? { feature: 'other', tier: 'notable', color: 0x6e7a8a, icon: '•', label: kind.toUpperCase() };

// Within a tier, this is the order things are shown. Kinds absent from the list
// sort last, which is the right default for anything newly added.
export const PRIORITY = [
  'kothCrown', 'kothDyn', 'throne', 'void', 'armada', 'nanomax', 'expoElite', 'hcEra',
  'ascend', 'dread', 'repel', 'steal', 'citadel', 'nano', 'hull', 'cargo',
  'kothLead', 'kothWarn', 'kothOpen', 'expo', 'hcwave', 'bigbet',
  'top10', 'zone', 'claim', 'alliance', 'level', 'lost', 'pilot',
];

// Banner shown above a headline message. One per tick, chosen from the loudest
// event present, so two crowns in one tick share a banner instead of stacking
// two full-width headers.
export function bannerFor(kind: string, sub?: string): string {
  const d = DEF(kind);
  return `# ${d.icon} ${d.label}` + (sub ? `\n-# ${sub}` : '');
}
