// =============================================================================
//  voice-688.ts — COPY FOR THE FEATURES ADDED IN BUILD 688
// -----------------------------------------------------------------------------
//  Fleet Exploration, Home Defense and King of the Hill each get their own
//  register, because they are three different kinds of achievement and copy that
//  treats them the same tells the reader nothing:
//
//    EXPLORATION is patient. Nothing about it is a fight — you commit five hulls
//    for most of a day and find out later. The voice is a survey log: dry,
//    factual, faintly awed by the distances. It should read like something
//    filed, not shouted.
//
//    HOME DEFENSE is stubborn. A wave is held, not won, and the reward is that
//    your base earns more while you are asleep. The voice is siege-report:
//    weight, permanence, the sense of a line that did not move.
//
//    KING OF THE HILL is loud, mean and on a clock. It is the only event in the
//    game with a hard deadline, so the copy exists to drag people back in before
//    it closes. Short sentences. Named opponents.
//
//  Every pick is DETERMINISTIC — seeded from the event's own ids — so a retried
//  cron tick re-posts the identical line instead of rerolling the joke.
// =============================================================================

export const LINES_688: Record<string, string[]> = {
  // ---- FLEET EXPLORATION ---------------------------------------------------
  expoMilestone: [
    '{a} has filed {n} expedition reports. The rim is a little less blank than it was.',
    '{n} expeditions logged by {a}. Somebody has to map it.',
    '{a} passes {n} completed surveys — most of them uneventful, which is the point.',
    'Survey command credits {a} with {n} expeditions. The charts are getting crowded.',
  ],
  expoFirst: [
    '{a} sent a wing past the edge of the charts for the first time.',
    'First expedition filed by {a}. It came back, which is not guaranteed.',
    '{a} has started surveying. The rim does not survey itself.',
  ],
  expoElite: [
    '{a} sent five hulls into a ★★★★★ contract and brought all five home clean.',
    'A full five-star wing, no damage, no complications — {a} made that look routine.',
    '{a} grounded five hulls for a day and walked away with everything the contract offered.',
    'Complete success on a ★★★★★ expedition. {a} did not lose a single plate.',
  ],

  // ---- HOME DEFENSE --------------------------------------------------------
  hcWave: [
    '{a} is holding Wave {n}. The line did not move.',
    'Wave {n} broke against {a}\u2019s citadel and stayed broken.',
    '{a} holds at Wave {n} — and the mines run richer for it, permanently.',
    'Raiders reached Wave {n} at {a}\u2019s base. They did not reach Wave {n} plus one.',
  ],
  hcEra: [
    '{a} has pushed the home citadel into the {era}. Production doubles from here.',
    'Wave {n}. {a}\u2019s base is now {era} — the raiders coming next are a different species.',
    '{a} crossed into the {era} at Wave {n}. Everything that arrives now is worse.',
  ],

  // ---- KING OF THE HILL ----------------------------------------------------
  kothOpen: [
    'The hill is open. Twenty-four hours, one crown, no second place.',
    'New day, new hill. Nobody is holding it yet.',
    'The arena is live. Enemies get harder every hundred kills and they do not stop.',
  ],
  kothLead: [
    '{a} has taken the hill from {b}. {b} is welcome to take it back.',
    '{b} held it for a while. {a} holds it now.',
    '{a} is on top with {n} kills. {b} is not.',
    'Lead change: {a} passes {b}. Nine hours left to care about it.',
  ],
  kothWarn: [
    'One hour left. {a} is holding at {n} kills.',
    'Final hour. If you are not in the arena you are conceding.',
    '{a} takes the crown in sixty minutes unless somebody stops them.',
  ],
  kothCrown: [
    '{a} takes the crown with {n} kills. {e} pilots tried.',
    'The hill belongs to {a}. {n} kills, {e} entrants, one crown.',
    '{a} out-killed the entire galaxy inside one day: {n}.',
  ],
  kothDyn: [
    '{a} has taken {w} crowns. This is starting to look deliberate.',
    'Crown number {w} for {a}. Somebody go and stop them.',
    '{w} days won by {a}. The hill has a landlord.',
  ],
};

export const HC_ERA = (w: number): string =>
  w >= 250 ? 'MYTHIC era' : w >= 100 ? 'LEGENDARY era' : w >= 50 ? 'EPIC era' : w >= 20 ? 'RARE era' : 'opening waves';

// Milestones each ladder announces. Deliberately sparse: an expedition landing
// or a wave cleared is an hourly event for an active player, and a feed that
// reports every one of them is a feed people mute.
export const EXPO_MARKS = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
export const HC_MARKS = [1, 5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
export const HC_ERA_MARKS = [20, 50, 100, 250];
