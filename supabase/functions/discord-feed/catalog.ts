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
  mech: 0xff4d5e,
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

  // THE TEMPLE. A claim is the rarest loud moment in the game — one item every
  // one to three hours, taken under fire in the only zone where other pilots are
  // the threat. Tier follows the prize: a Celestial or Paragon off the disk is a
  // galaxy headline; anything below rides as a notable card. Kills are NOT
  // announced individually — ten a night would mute the channel — the claim card
  // carries the fight's outcome instead.
  templeClaim:    { feature: 'temple', tier: 'notable',  color: 0xc98bff, icon: '⚔', label: 'TEMPLE CLAIM', gif: 'victory' },
  templeClaimTop: { feature: 'temple', tier: 'headline', color: 0xc98bff, icon: '⚔', label: 'THE TEMPLE HAS YIELDED A TREASURE', gif: 'maxed' },

  // KING OF THE HILL. The race has a hard 24-hour deadline, which makes its
  // announcements time-critical in a way nothing else here is: a crown posted
  // late is worthless, and an opening posted late costs entrants.
  kothOpen: { feature: 'koth',     tier: 'notable',  color: COLOR.koth,     icon: '👑', label: 'THE HILL IS OPEN' , selfPost: true },
  kothLead: { feature: 'koth',     tier: 'notable',  color: COLOR.koth,     icon: '👑', label: 'LEAD CHANGE', gif: 'owned' , selfPost: true },
  kothWarn: { feature: 'koth',     tier: 'notable',  color: COLOR.koth,     icon: '⏳', label: 'FINAL HOUR' , selfPost: true },
  kothCrown:{ feature: 'koth',     tier: 'headline', color: COLOR.koth,     icon: '👑', label: 'THE HILL HAS A KING', gif: 'victory' , selfPost: true },
  kothDyn:  { feature: 'koth',     tier: 'headline', color: COLOR.koth,     icon: '👑', label: 'A DYNASTY IS FORMING', gif: 'maxed' },

  // THE MECH FOUNDRY. Its worlds open for one hour in six on staggered windows,
  // which is twenty openings a day — far too many to announce, so an OPENING is
  // deliberately not an event here. What gets announced is what a pilot DID:
  // taking a world, and crossing a core milestone.
  //
  // `mechWorld` is notable and `mechDeep` is the headline, because the top two
  // worlds are star-gated (★15 / ★20) and a Malgrave clear is genuinely rare.
  // Both are selfPost: the client detects them at the moment the tier boss dies,
  // and a card posted two minutes late reads as someone else's news.
  mechWorld:{ feature: 'mech',     tier: 'notable',  color: COLOR.mech,     icon: '⚙', label: 'WORLD TAKEN', gif: 'owned', selfPost: true },
  mechDeep: { feature: 'mech',     tier: 'headline', color: COLOR.mech,     icon: '⚙', label: 'A CORRUPTED WORLD HAS FALLEN', gif: 'victory', selfPost: true },
  mechCore: { feature: 'mech',     tier: 'ambient',  color: COLOR.mech,     icon: '◉', label: 'MECH CORES', selfPost: true },
  // The Sovereign is the end of the line and needs every other Mech hull first,
  // so it is the rarest acquisition in the game. Ordinary Mech hulls announce
  // through the normal `hull` card; only this one earns its own headline.
  mechSov:  { feature: 'mech',     tier: 'headline', color: COLOR.mech,     icon: '⚙', label: 'A MECH SOVEREIGN HAS BEEN ASSEMBLED', gif: 'maxed', selfPost: true },
  // Commanders. Only Ancient and above reach the channel — the client gates it, and
  // log_mech() de-duplicates per officer per tier. A Common pull is not news.
  mechCmdr: { feature: 'mech',     tier: 'notable',  color: COLOR.mech,     icon: '✦', label: 'A COMMANDER HAS BEEN RECOVERED', gif: 'owned', selfPost: true },
};

export const TIER_OF = (kind: string): Tier => (CATALOG[kind]?.tier ?? 'notable');
export const DEF = (kind: string): EventDef =>
  CATALOG[kind] ?? { feature: 'other', tier: 'notable', color: 0x6e7a8a, icon: '•', label: kind.toUpperCase() };

// Within a tier, this is the order things are shown. Kinds absent from the list
// sort last, which is the right default for anything newly added.
export const PRIORITY = [
  'kothCrown', 'kothDyn', 'templeClaimTop', 'throne', 'void', 'armada', 'nanomax', 'expoElite', 'hcEra',
  'ascend', 'dread', 'repel', 'steal', 'citadel', 'nano', 'hull', 'cargo',
  'mechSov', 'mechDeep', 'mechCmdr', 'mechWorld',
  'kothLead', 'kothWarn', 'kothOpen', 'templeClaim', 'expo', 'hcwave', 'bigbet',
  'mechCore',
  'top10', 'zone', 'claim', 'alliance', 'level', 'lost', 'pilot',
];

// Banner shown above a headline message. One per tick, chosen from the loudest
// event present, so two crowns in one tick share a banner instead of stacking
// two full-width headers.
export function bannerFor(kind: string, sub?: string): string {
  const d = DEF(kind);
  return `# ${d.icon} ${d.label}` + (sub ? `\n-# ${sub}` : '');
}
