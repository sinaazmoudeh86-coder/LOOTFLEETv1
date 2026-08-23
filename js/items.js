/* =============================================================================
   items.js — LOOTFLEET
   Procedural loot: rarity rolls, fleet-themed gear naming (weapon classes +
   per-slot tech tiers), normal + rare SPECIAL stats, comparison & power.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG;

  let _idSeq = 1;

  // ---------------------------------------------------------------------------
  // ONE weight table, used by BOTH the live roll and the odds the Bag displays.
  //
  // These were two separate copies of the same formula and they had drifted: the
  // roll used dampener 1.30 and luck 0.004, the display used 1.18 and 0.0045. The
  // odds shown to players were therefore 3–7× more generous than the odds they
  // were actually being given, worst at the top of the table where it mattered
  // most. Anything that changes the roll must change here and nowhere else.
  // ---------------------------------------------------------------------------
  const LUCK_PER_ZONE = 0.004;   // gentle depth pressure
  const TIER_DAMPEN = 1.30;      // each step up is markedly rarer than the last
  function rarityWeights(dungeon) {
    const luck = 1 + dungeon * LUCK_PER_ZONE;
    // ceiling = the stricter of the zone gate and the ascension gate
    const zCap = C.rarityCap ? C.rarityCap(dungeon) : 11;
    const cap = Math.min(zCap, C.ascRarityCap ? C.ascRarityCap() : 13);
    // ASCENSION: flat bonus to Primordial-and-above weight (+25%/star, max 5×)
    const top = C.ascTopBoost ? C.ascTopBoost() : 1;
    const TT = C.TOP_TIER == null ? 11 : C.TOP_TIER;
    // FORTUNE LATTICE perk: lifts every above-common weight
    const perk = (window.PASCEND && window.PASCEND.mult) ? window.PASCEND.mult('rare') : 1;
    return C.RARITY.map((r) =>
      // A DORMANT TIER NEVER ENTERS THE ROLL. Reserved entries are defined so the
      // ladder has somewhere to grow and so a save written against one later
      // still lines up — they are not obtainable until they are switched on.
      r.dormant ? 0
        : r.tier > cap ? 0
        : r.tier === 0 ? r.weight
        : r.weight * Math.pow(luck, r.tier) / Math.pow(TIER_DAMPEN, r.tier) * perk * (r.tier >= TT ? top : 1)
    );
  }
  function rollRarity(dungeon) {
    const weights = rarityWeights(dungeon);
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // FLEET GEAR NAMING (LOOTFLEET catalog flavor).
  // Each slot has tiered name pools; higher rarity pulls from higher-end gear.
  // Rarity tier (0–10) → bucket 0 budget / 1 mid / 2 high / 3 elite.
  // ---------------------------------------------------------------------------
  // FLEET-THEMED GEAR NAMING. Each slot maps to its in-fiction role — Munitions
  // (arrows), Hull plating (armor), Thrusters (boots), Targeting computer
  // (gloves), Shield Core (amulet). Four tiers: salvaged → standard → advanced →
  // apex, pulled by rarity bucket so higher drops read as clearly better tech.
  const NAMES = {
    bow: [ // legacy fallback (primaries now use WEAPON CLASS names — see below)
      ['Scrap Autocannon', 'Surplus Blaster', 'Jury-Rigged Gun', 'Patchwork Cannon'],
      ['Standard Autocannon Mk II', 'Service Blaster', 'Vector Cannon', 'Repeater Array'],
      ['Overcharge Cannon X', 'Vanguard Blaster Prime', 'Storm Autocannon', 'Lance Battery'],
      ['Annihilator Cannon', 'Sovereign Blaster Omega', 'Cataclysm Array', 'Apex Ordnance'],
    ],
    arrows: [ // MUNITIONS — energy cells & ammunition feeds (fire rate / crit)
      ['Scrap Cell Feed', 'Surplus Slug Belt', 'Loose Photon Clip', 'Rusty Autoloader', 'Salvaged Charge Pack'],
      ['Ion Cell Magazine', 'Tracer Charge Belt', 'Rapid Feed Mk II', 'Kinetic Slug Rack', 'Pulse Cartridge Drum'],
      ['Overcharge Cell Array', 'Hypercycle Autoloader', 'Plasma Round Cascade', 'Volt-Fed Munitions X', 'Accelerant Charge Core'],
      ['Singularity Round Feed', 'Antimatter Cartridge Core', 'Zero-Point Autoloader', 'Nova Charge Cascade', 'Eternal Munition Engine'],
    ],
    armor: [ // HULL — plating & bulkheads (health)
      ['Dented Hull Plate', 'Scrap Armor Panel', 'Patchwork Bulkhead', 'Riveted Deck Plate', 'Surplus Ablator'],
      ['Titanium Hull Plate', 'Reinforced Bulkhead', 'Composite Armor Mk II', 'Layered Deckplate', 'Ceramic Ablative Shell'],
      ['Adamant Hull Lattice', 'Reactive Armor Prime', 'Nanoweave Bulkhead', 'Duranium Plate X', 'Kinetic Absorber Shell'],
      ['Neutronium Hull Core', 'Living-Metal Carapace', 'Voidforged Bulkhead', 'Starplate Prime', 'Eternal Aegis Hull'],
    ],
    boots: [ // THRUSTERS — maneuver drives (move speed)
      ['Sputtering Ion Jets', 'Scrap Maneuver Thrust', 'Worn Vector Nozzles', 'Surplus Drift Jets', 'Patched Burn Pods'],
      ['Ion Thruster Array', 'Vector Maneuver Jets', 'Fusion Burn Pods', 'Afterburn Drive Mk II', 'Gimbal Thrust Rig'],
      ['Plasma Vector Drive', 'Overthrust Engine X', 'Slipstream Thrusters', 'Pulse Burn Array', 'Graviton Maneuver Core'],
      ['Warp Vector Drive', 'Tachyon Burn Engine', 'Singularity Thrusters', 'Lightstep Drive Prime', 'Eternal Slipstream Core'],
    ],
    gloves: [ // TARGETING — fire-control computers (fire rate / crit damage)
      ['Cracked Targeting Chip', 'Surplus Aim Module', 'Jury-Rigged Sight Unit', 'Static Lock Sensor', 'Salvaged Fire Chip'],
      ['Targeting Computer Mk II', 'Predictive Aim Core', 'Auto-Lock Processor', 'Ballistic Sync Unit', 'Vector Sight Array'],
      ['Neural Targeting Core', 'Precognition Aim X', 'Quantum Lock Processor', 'Marksman AI Module', 'Deadeye Sensor Suite'],
      ['Oracle Fire Control', 'Omniscient Aim Core', 'Hyperlock Prime AI', 'Bullseye Singularity', 'Eternal Targeting Nexus'],
    ],
    amulet: [ // SHIELD CORE — deflector generators (crit)
      ['Flickering Deflector', 'Scrap Shield Coil', 'Surplus Field Node', 'Cracked Barrier Core', 'Static Ward Emitter'],
      ['Deflector Core Mk II', 'Kinetic Barrier Node', 'Phase Shield Coil', 'Aegis Field Emitter', 'Refractor Ward Core'],
      ['Resonant Shield Core', 'Hardlight Barrier X', 'Prismatic Deflector', 'Overcharge Ward Prime', 'Graviton Shield Node'],
      ['Singularity Shield Core', 'Absolute Deflector Prime', 'Voidward Barrier Engine', 'Nova Aegis Core', 'Eternal Bulwark Nexus'],
    ],
  };
  // ---------------------------------------------------------------------------
  // WEAPON CLASSES — every primary weapon belongs to one of five classes. Each
  // class has its own arsenal of names, a guaranteed signature benefit, and a
  // distinct projectile visual (see render.js). Tooltips explain the benefit.
  // ---------------------------------------------------------------------------
  const WEAPON_CLASSES = [
    { key: 'laser',   name: 'Pulse Laser',      glyph: '⌶', color: '#5fd1ff',
      bonus: '+Attack Speed',
      blurb: 'Coherent-beam energy weapon. Light has no recoil — beams cycle faster than any slug-thrower.' },
    { key: 'gatling', name: 'Gatling Cannon',   glyph: '✢', color: '#ffd24d',
      bonus: '+1 Multi-Shot',
      blurb: 'Rotary kinetic cannon. The wall of tracers naturally sprays into extra targets.' },
    { key: 'missile', name: 'Missile Rack',     glyph: '➳', color: '#ff8a5c',
      bonus: '+20% Damage',
      blurb: 'Self-propelled heavy ordnance. Each warhead hits far harder than an energy bolt.' },
    { key: 'rail',    name: 'Railgun',          glyph: '⫷', color: '#b87bff',
      bonus: '+Crit Damage',
      blurb: 'Electromagnetic mass driver. Hypervelocity slugs turn critical hits devastating.' },
    { key: 'plasma',  name: 'Plasma Projector', glyph: '✺', color: '#46d27a',
      bonus: '+Life Steal',
      blurb: 'Magnetically-bottled starfire. Ionized impacts siphon energy back to your hull.' },
    { key: 'support', name: 'Warden Array',     glyph: '✚', color: '#7ce0a0',
      bonus: 'Fleet Heal & Buffs',
      blurb: 'Support emitter array. Projects a fleet-wide aura: extra Multi-Shot, hull recovery, damage reduction and weapon range. Mounts ONLY on the Aegis support hull.' },
    // ---- AEGIS FIELD PROJECTORS ------------------------------------------
    // Large-radius battlefield auras. Like the Warden Array these mount ONLY on
    // the Aegis (canMountWeapon refuses them anywhere else) — the support hull's
    // whole identity is that it changes the space around the fleet rather than
    // out-shooting anything. Behaviour and magnitudes live in js/aegis-auras.js;
    // this table is only what the loot system needs to roll and name one.
    { key: 'venom', name: 'Venom Lattice', glyph: '☣', color: '#b45cff', aura: 1,
      bonus: 'Hostiles Take +Damage',
      blurb: 'Projects a hanging violet haze. Everything hostile inside it takes more damage from every source — yours, your wing\'s, anyone\'s. Mounts ONLY on the Aegis.' },
    { key: 'cryo', name: 'Cryo Field', glyph: '❄', color: '#5fd1ff', aura: 1,
      bonus: 'Hostiles Slowed',
      blurb: 'A lattice of supercooled particles. Hostile drives seize inside the field and everything crawls. Mounts ONLY on the Aegis.' },
    { key: 'banner', name: 'Banner Array', glyph: '➤', color: '#ffb03a', aura: 1,
      bonus: '+Fleet Damage',
      blurb: 'A command resonance your wing fights inside. Every hull you own hits harder, and the bonus counts toward your Fleet Score. Mounts ONLY on the Aegis.' },
    { key: 'plague', name: 'Plague Emitter', glyph: '☠', color: '#7ce06a', aura: 1,
      bonus: 'Hostiles Slowed & Rotting',
      blurb: 'A creeping bio-corrosive bloom. Hostiles inside slow down and take damage every second they stay. Mounts ONLY on the Aegis.' },
    // FIGHTER BAY — a launch rack, not a gun. It is registered here beside the
    // cannons on purpose: a squadron is an ordinary Cannon-slot item and rides the
    // whole existing pipeline (drops, rarity, rerolls, salvage, auto-equip, saves).
    // What it does when equipped lives in fighters.js.
    { key: 'fighter', name: 'Fighter Bay',      glyph: '\u227a', color: '#ffb457',
      bonus: 'Launches Heavy Fighters',
      blurb: 'A launch rack rather than a gun. Racks autonomous Heavy Fighters that leave the hull, choose their own targets and swarm them until nothing is left inside the carrier\u2019s engagement envelope. Mounts ONLY on Fighter Carrier hulls \u2014 and those hulls mount nothing else.' },
  ];
  const WCLASS_BY_KEY = {}; WEAPON_CLASSES.forEach((w) => WCLASS_BY_KEY[w.key] = w);

  // ---------------------------------------------------------------------------
  // FIGHTER MARQUES — the Fighter Bay's answer to cannon classes.
  //
  // A cannon class gives one signature STAT and a projectile look. A marque does
  // that AND reshapes the craft, because a fighter is a thing that flies rather
  // than a bolt that travels: it scales speed, attack cadence, per-strike damage,
  // orbit radius and the carrier's engagement envelope. That is the axis of
  // choice the class was missing — two Legendary bays now play nothing alike.
  //
  // Kept in a SEPARATE array from WEAPON_CLASSES deliberately: weaponClassOf()
  // hash-resolves legacy cannons by indexing that array, so a marque sitting in
  // it would eventually be handed to a bow.
  //
  // rateMul x dmgMul is held near 1.0 across the set, so a marque is a SHAPE and
  // not a power level — the Maul trades uptime for weight, the Swarm the reverse.
  // ---------------------------------------------------------------------------
  const FIGHTER_CLASSES = [
    { key: 'f_talon', name: 'Talon Interceptor', glyph: '≺', color: '#7fd1ff',
      bonus: '+Crit Chance', stat: 'critChance', per: [3, 1.2],
      craft: { dmgMul: 0.80, rateMul: 1.25, speedMul: 1.35, rangeMul: 1.00, orbitMul: 0.72 },
      blurb: 'A stripped hot-rod of a fighter. Faster than anything else that fits a bay, knifing in on a tight orbit and cycling its guns quicker — lighter per strike, but on target far more of the time and finding the weak seam far more often.' },
    { key: 'f_maul', name: 'Maul Gunship', glyph: '◆', color: '#ff8a5c',
      bonus: '+Crit Damage', stat: 'critDamage', per: [9, 4],
      craft: { dmgMul: 1.75, rateMul: 0.70, speedMul: 0.85, rangeMul: 1.00, orbitMul: 1.18 },
      blurb: 'An armoured weapons platform with wings. Slow to line up and slow to cycle, but every pass lands like a capital shell — the marque you fit when one thing in front of you has to die.' },
    { key: 'f_lance', name: 'Lance Strike Wing', glyph: '⟩', color: '#ffd24d',
      bonus: '+Engagement Range', stat: null, per: [0, 0],
      craft: { dmgMul: 0.90, rateMul: 1.00, speedMul: 1.10, rangeMul: 1.55, orbitMul: 1.55 },
      blurb: 'Long-legged patrol fighters that push the carrier’s engagement envelope half again as far and hold a wide orbit. The marque that lets a hull with no business near the fight still reach it.' },
    { key: 'f_reaper', name: 'Reaper Wing', glyph: '✡', color: '#7ce0a0',
      bonus: '+Life Steal', stat: 'lifeSteal', per: [0.5, 0.22],
      craft: { dmgMul: 1.00, rateMul: 1.00, speedMul: 1.00, rangeMul: 1.00, orbitMul: 1.00 },
      blurb: 'Siphon-rigged fighters that route a share of everything they tear off back to the carrier. No edge in speed or weight — it simply keeps alive a hull that cannot run away.' },
    { key: 'f_swarm', name: 'Swarm Vector', glyph: '⋔', color: '#c98cff',
      bonus: '+Multi-Shot', stat: 'multiShot', per: [1.2, 0.6],
      craft: { dmgMul: 0.62, rateMul: 1.50, speedMul: 1.20, rangeMul: 1.00, orbitMul: 0.88 },
      blurb: 'Cheap, fast and firing constantly. Each hit is slight, but the sheer number of them makes every per-hit effect you own — Multi-Shot, cryo, life steal, the singularity — proc far more often.' },
    // LEGACY — bays that dropped before the marques existed. Never picked for a
    // new drop; kept so an old fitting still resolves to a name and a blurb.
    { key: 'fighter', name: 'Fighter Bay', glyph: '≺', color: '#ffb457',
      bonus: 'Launches Heavy Fighters', stat: null, per: [0, 0], legacy: true,
      craft: { dmgMul: 1, rateMul: 1, speedMul: 1, rangeMul: 1, orbitMul: 1 },
      blurb: 'A launch rack rather than a gun — it holds one autonomous Heavy Fighter that leaves the hull, chooses its own target and swarms it inside the carrier’s engagement envelope.' },
  ];
  const FCLASS_BY_KEY = {}; FIGHTER_CLASSES.forEach((f) => FCLASS_BY_KEY[f.key] = f);
  const FCLASS_POOL = FIGHTER_CLASSES.filter((f) => !f.legacy);
  function pickFighterClass() { return FCLASS_POOL[(Math.random() * FCLASS_POOL.length) | 0]; }
  // class arsenals: name pools per quality bucket (budget → mid → high → elite)
  const WCLASS_NAMES = {
    laser: [
      ['VX-1 Pulse Emitter', 'Photon Sidearm', 'Glimmer Lance', 'Arc-Beam Mk I'],
      ['Helios Beamcaster', 'Prism Lance Mk II', 'Aurora Pulse Array', 'Star Cutter'],
      ['Solaris Beam X', 'Gamma Lance Prime', 'Spectral Cutter', 'Radiant Phase Lance'],
      ['Nova Coherence Engine', 'Dawnbreaker Beam', 'Archlight Prime', 'Quasar Lance Omega'],
    ],
    gatling: [
      ['Scrap Rotary Gun', 'Twin-Barrel Pepperbox', 'Junker Gatling', 'RT-4 Spinner'],
      ['Vulcan Rotary Mk II', 'Hailstorm Gatling', 'Cyclone Repeater', 'Storm-6 Rotary'],
      ['Tempest Minigun X', 'Maelstrom Rotary', 'Hurricane Suppressor', 'Vortex Chaingun'],
      ['Galehammer Shredder', 'Omega Cyclone Array', 'Supercell Rotary', 'Tempest Engine Zero'],
    ],
    missile: [
      ['Surplus Rocket Pod', 'Mule Missile Rack', 'SR-2 Launcher', 'Bottle Battery'],
      ['Javelin Missile Rack', 'Hammerfall Pod', 'Comet Battery Mk II', 'Striker Salvo'],
      ['Starfall Ordnance Rack', 'Meteor Storm Battery', 'Devastator Pod', 'Longbow Cruise Rack'],
      ['Extinction Salvo Array', 'Nova Rain Skyburier', 'Apocalypse Ordnance', 'Cataclysm Omega'],
    ],
    rail: [
      ['Scrap Coil Slugger', 'Gauss Pipe', 'Magnet Rifle', 'RG-1 Slinger'],
      ['Gauss Driver Mk II', 'Ion Rail Carbine', 'Hypervel Slugcaster', 'Linear Driver-7'],
      ['Hypervelocity Rail X', 'Quake Driver Prime', 'Penetrator Gauss', 'Stormrail Lance'],
      ['Starpiercer Driver', 'Relativistic Omega', 'Singular Rail Prime', 'Event Horizon Driver'],
    ],
    plasma: [
      ['Leaky Plasma Torch', 'Ember Projector', 'Slagcaster', 'PL-3 Spitter'],
      ['Plasma Projector Mk II', 'Sunspot Caster', 'Fusion Lobber', 'Starfire Projector'],
      ['Solar Flare X', 'Corona Caster Prime', 'Fusion Storm Array', 'Helion Projector'],
      ['Starcore Annihilator', 'Heart-of-Star', 'Helion Prime Array', 'Supergiant Omega'],
    ],
    support: [
      ['Field Mender Rig', 'Patchbeam Emitter', 'WD-1 Warden Coil', 'Tinker Aura Pod'],
      ['Warden Array Mk II', 'Guardian Halo Rig', 'Aegis Lattice', 'Bulwark Emitter'],
      ['Sanctuary Array X', 'Warden Prime Lattice', 'Bastion Halo', 'Custodian Field Rig'],
      ['Archangel Lattice', 'Eternal Warden Array', 'Sovereign Halo Prime', 'Pantheon Field Omega'],
    ],
    fighter: [
      ['Mk I Sortie Rack', 'Kestrel Bay', 'Light Launch Rail', 'Hangar Rack A'],
      ['Talon Sortie Bay', 'Shrike Rack', 'Vector Launch Bay', 'Skirmish Hangar'],
      ['Heavy Fighter Squadron', 'Falcon Wing Bay', 'Reaper Sortie Bay', 'Strike Wing Rack'],
      ['Apex Fighter Wing', 'Warhawk Squadron', 'Sovereign Launch Bay', 'Blacktalon Wing'],
    ],
    f_talon: [
      ['TL-1 Kestrel', 'Skitter Interceptor', 'Needle Mk I', 'Dart Rack'],
      ['Shrike Interceptor', 'Quickblade Wing', 'Razorwing TL-4', 'Splinter Flight'],
      ['Talon Ascendant', 'Hornet Prime', 'Wraithwing', 'Stiletto Wing'],
      ['Blacktalon Apex', 'Ghostblade Flight', 'Seraph Interceptor', 'Zephyr Prime'],
    ],
    f_maul: [
      ['MG-1 Hammerhead', 'Slug Gunship', 'Anvil Mk I', 'Bruiser Rack'],
      ['Maul Gunship', 'Sledge Wing', 'Ironjaw MG-4', 'Breaker Flight'],
      ['Warhammer Gunship', 'Siegemaul', 'Bastion Wing', 'Ruinbringer'],
      ['Maul Sovereign', 'Godhammer Flight', 'Cataclysm Gunship', 'Worldbreaker Wing'],
    ],
    f_lance: [
      ['LN-1 Outrider', 'Pilgrim Wing', 'Reach Mk I', 'Ranger Rack'],
      ['Lance Strike Wing', 'Longspear Flight', 'Horizon LN-4', 'Vanguard Patrol'],
      ['Lance Ascendant', 'Farstrike Wing', 'Meridian Flight', 'Skyreach Wing'],
      ['Lance Sovereign', 'Endless Horizon', 'Starlance Prime', 'Infinity Patrol'],
    ],
    f_reaper: [
      ['RP-1 Leech', 'Siphon Wing', 'Tick Mk I', 'Drain Rack'],
      ['Reaper Wing', 'Bloodletter Flight', 'Vampire RP-4', 'Harvest Wing'],
      ['Reaper Ascendant', 'Soulfeeder Flight', 'Carrion Wing', 'Exsanguine'],
      ['Reaper Sovereign', 'Deathless Wing', 'Eternal Harvest', 'Grave Sovereign'],
    ],
    f_swarm: [
      ['SW-1 Midge', 'Gnat Vector', 'Cloud Mk I', 'Chaff Rack'],
      ['Swarm Vector', 'Locust Flight', 'Hive SW-4', 'Tempest Vector'],
      ['Swarm Ascendant', 'Plague Vector', 'Maelstrom Flight', 'Nova Swarm'],
      ['Swarm Sovereign', 'Infinite Hive', 'Ruin Vector', 'Endless Tempest'],
    ],
  };
  // A BAY'S RARITY IS ITS WHOLE TUNING AXIS. Better squadrons hit harder, cycle
  // faster and reach further — but never launch MORE craft. Capacity belongs to
  // the hull (`fighterCapacity`), so a bay cannot out-scale the ship carrying it.
  // RARITY REACHES DAMAGE EXACTLY ONCE, through the stat lines — the same route a
  // cannon's rarity takes. This used to multiply damage a SECOND time here:
  //
  //     dmgMul:  (1 + r * 0.22) * k.dmgMul
  //     rateMul: (1 + r * 0.05) * k.rateMul
  //
  // A bay's stat lines already feed `attackDamage`, which is the figure fighter damage
  // is computed FROM, so those terms were a fighter-only bonus with no cannon
  // equivalent — and they compounded. It was deliberate when the class shipped ("rarity
  // drives the wing's DPS twice over"), but it is incompatible with the DPS anchor added
  // in 640, and rarity won: the wing measured 1.10× cannon at Common, 3.3× at r6 and
  //  8.95× at r16 — worse than the 7.6× the anchor was introduced to fix. The very first
  // bay upgrade broke the balance.
  //
  // So DPS terms carry the marque SHAPE only. RANGE and SPEED keep their rarity scaling:
  // neither is damage, and a better bay reaching further and flying faster is the kind of
  // upgrade that cannot compound into the DPS anchor.
  function fighterSpec(item) {
    const r = (item && item.rarity) || 0;
    const k = ((item && FCLASS_BY_KEY[item.wclass]) || FCLASS_BY_KEY.fighter).craft;
    return {
      // Rarity is back on dmgMul, but it is now a RELATIVE WEIGHT, not a bonus:
      // fighters.js normalises these across the fitted wing so the total stays pinned
      // to CONFIG.FIGHTER.dpsVsCannon while a better bay still out-damages a worse one
      // beside it. Removing the term outright (641) held the anchor but made a Legendary
      // bay fly identically to a Common one, which left bay rarity with no purpose.
      dmgMul:   (1 + r * 0.22) * k.dmgMul,
      rateMul:  k.rateMul,
      rangeMul: (1 + r * 0.06) * k.rangeMul,
      speedMul: (1 + r * 0.04) * k.speedMul,
      orbitMul: k.orbitMul,
    };
  }
  // Resolve an item's weapon class. New drops carry `wclass`; legacy weapons
  // (incl. old firearm-named saves) map deterministically from their id so the
  // same item always shows — and fires — the same class.
  // THE CANNON HASH NAMES A GUN — nothing else. Registering `fighter` in
  // WEAPON_CLASSES put it in the hash's modulus, so 1 legacy cannon in 7 resolved
  // to a launch rack: "most of my ships now have fighter bays in cannon slots".
  // Which slot an item is IN decides what it is; the hash only picks a gun class.
  // `support` is out for the same reason from the other direction: a Warden Array
  // mounts ONLY on an Aegis (canMountWeapon refuses it anywhere else), so hashing
  // a legacy cannon onto it would make gear the player is already flying
  // unmountable and project a fleet aura nobody rolled. New drops still roll it
  // — they carry an explicit `wclass`, which is read above.
  const HASH_CLASSES = WEAPON_CLASSES.filter((w) => w.key !== 'fighter' && w.key !== 'support' && !w.aura);
  function weaponClassOf(item) {
    const wc = item && item.wclass;
    const bay = !!(item && item.slot === 'fighter');
    if (bay) {
      // a bay from before the marques resolves to the generic entry
      return (wc && FCLASS_BY_KEY[wc]) || FCLASS_BY_KEY.fighter;
    }
    // A cannon saved with a fighter class (bays were briefly cannon-slot items)
    // falls through to the hash rather than reading as a launch rack.
    if (wc && wc !== 'fighter' && WCLASS_BY_KEY[wc]) return WCLASS_BY_KEY[wc];
    const h = item ? ((item.id || 0) * 7 + (item.name ? item.name.length : 0)) : 0;
    // floor + abs the hash so a non-integer/negative id can never index out of the
    // array (which would yield undefined and crash any tooltip reading wc.color).
    const idx = Math.abs(Math.floor(h)) % HASH_CLASSES.length;
    return HASH_CLASSES[idx] || HASH_CLASSES[0];
  }

  // Fleet-support aura projected by an equipped Warden Array, scaled by rarity.
  // Read at stat-compute time (game.js); DOUBLED while flying an Aegis hull.
  function supportAura(item) {
    if (!item || item.slot !== 'bow') return null;
    if (weaponClassOf(item).key !== 'support') return null;
    const r = item.rarity || 0;
    return {
      multiShot: 1,                                        // extra fleet volley
      regen: Math.round((0.4 + 0.12 * r) * 10) / 10,       // % max hull / sec
      reduce: Math.min(30, 3 + r),                         // % damage reduction
      rangePct: Math.round(5 + r * 1.5),                   // % weapon range
    };
  }

  // Weighted class roll — near-even odds, with Plasma Projectors slightly rarer.
  // `fighter` is deliberately absent: it is not a cannon class a bow can roll,
  // it is the class every FIGHTER-slot item has. Bays reach the loot table
  // through SLOT_KEYS instead, like any other fitting.
  // AEGIS classes roll at half weight: they are hull-locked, so a pilot not flying
// an Aegis cannot use one, and flooding the table with them would thin every
// cannon roll for everybody. HASH_CLASSES below already excludes them the same
// way it excludes 'support' — a legacy item must never hash onto a hull-locked
// class and become unmountable.
const WCLASS_WEIGHTS = { laser: 1, gatling: 1, missile: 1, rail: 1, plasma: 0.75, support: 1,
  venom: 0.5, cryo: 0.5, banner: 0.5, plague: 0.5 };
  function pickWeaponClass() {
    const total = WEAPON_CLASSES.reduce((a, w) => a + (WCLASS_WEIGHTS[w.key] || 1), 0);
    let roll = Math.random() * total;
    for (const w of WEAPON_CLASSES) { roll -= (WCLASS_WEIGHTS[w.key] || 1); if (roll <= 0) return w; }
    return WEAPON_CLASSES[0];
  }

  function bucketFor(tier) { return tier <= 1 ? 0 : tier <= 3 ? 1 : tier <= 5 ? 2 : 3; }
  function pickName(slotKey, tier) {
    const buckets = NAMES[slotKey];
    const b = buckets[Math.min(buckets.length - 1, bucketFor(tier))];
    return b[(Math.random() * b.length) | 0];
  }
  function pickWeaponName(wkey, tier) {
    const buckets = WCLASS_NAMES[wkey];
    const b = buckets[Math.min(buckets.length - 1, bucketFor(tier))];
    return b[(Math.random() * b.length) | 0];
  }

  // ---------------------------------------------------------------------------
  // GENERATE a single item dropped in `dungeon`.
  // ---------------------------------------------------------------------------
  // `forceSlot` asks for a specific slot instead of a random one. Only used by
  // callers handing out a KNOWN fitting — a Fighter Carrier is delivered with its
  // bays already filled, and it cannot roll for them.
  function generate(dungeon, forceRarity, forceSlot) {
    // A FORCED RARITY IS CLAMPED TO THE LIVE CEILING. rollRarity() already
    // refuses a dormant tier, but every OTHER caller passes forceRarity — boss
    // showers, crates, the market, admin grants — and the common idiom for "top
    // of the table" is `RARITY.length - 1`, which now points at a reserved entry.
    // Clamping here means no path can mint one, and the next reserved tier
    // appended to the array is protected without touching a single call site.
    //
    // This is a DATA guard, not a cosmetic one: an item minted at a dormant tier
    // persists in the save with that index, and its meaning would change the day
    // the tier is switched on with a real weight and ascReq.
    const liveMax = C.liveRarityMax ? C.liveRarityMax() : (C.RARITY.length - 1);
    const rarityIdx = forceRarity != null
      ? Math.max(0, Math.min(liveMax, Math.floor(Number(forceRarity) || 0)))
      : rollRarity(dungeon);
    const rar = C.RARITY[rarityIdx];
    const slotKey = (forceSlot && C.SLOTS[forceSlot]) ? forceSlot : C.SLOT_KEYS[(Math.random() * C.SLOT_KEYS.length) | 0];
    const slot = C.SLOTS[slotKey];

    const scale = C.dungeonScale(dungeon);   // geometric power of this zone
    const ilvl = C.dungeonEnemyLevel(dungeon);

    // ---- normal stats (from the 6 core stats) ----
    // CLAMPED TO THE POOL (Aug 2026 — THE crash wave). Celestial/Paragon declare
    // 7–8 stats but there are only SIX core stats, and this loop picked DISTINCT
    // keys — so the first top-tier drop spun this while-loop forever and froze
    // the tab on the spot (combat, or the OFFLINE SIM AT BOOT, which is why some
    // players couldn't even load in). The tier's power lives in rar.mult; the
    // stat count now honestly caps at the pool.
    const nStats = Math.min(C.STAT_KEYS.length, rar.minStats + ((Math.random() * (rar.maxStats - rar.minStats + 1)) | 0));
    const chosen = [];
    chosen.push(slot.primary[(Math.random() * slot.primary.length) | 0]);
    const rest = C.STAT_KEYS.filter((k) => k !== chosen[0]);
    while (chosen.length < nStats && rest.length) chosen.push(rest.splice((Math.random() * rest.length) | 0, 1)[0]);
    const stats = {};
    chosen.forEach((statKey) => {
      const def = C.STATS[statKey];
      const variance = 0.82 + Math.random() * 0.36;
      let val;
      if (statKey === 'critChance') {
        // CRIT is precious: rarity-driven ladder \u2014 Common ≈ 0.005%, +~0.01%/tier,
        // Primordial ≈ 0.09–0.13%. The 1% cap is now purely theoretical.
        val = Math.min(1, Math.round((0.005 + rarityIdx * 0.01) * variance * 1000) / 1000);
      } else if (def.fmt === 'flat') {
        val = Math.max(1, Math.round(def.base * scale * rar.mult * variance));
      } else {
        const depthBonus = 1 + Math.log10(dungeon + 0.5) * 0.4;
        val = Math.max(0.1, Math.round(def.base * rar.mult * variance * depthBonus * 10) / 10);
      }
      stats[statKey] = val;
    });

    // ---- rare SPECIAL stats (life steal, multi-shot) — flat, non-scaling ----
    C.SPECIALS.forEach((sp) => {
      // higher-rarity items get a small bump to the appearance odds
      const chance = sp.chance * (1 + rarityIdx * 0.06);
      if (Math.random() < chance) stats[sp.key] = sp.roll();
    });

    // ---- WEAPON CLASS: primaries get a class, class name + signature bonus ----
    let wclass = null, name;
    // A FIGHTER BAY IS ALWAYS THE FIGHTER CLASS — there is nothing to roll. Its
    // damage line is what the craft in that bay hits for, so rarity drives the
    // wing's DPS directly as well as through the hull's own stat total.
    if (slotKey === 'fighter') {
      const fc = pickFighterClass();
      wclass = fc.key;
      name = pickWeaponName(fc.key, rarityIdx);
      // the bay's damage line is what the craft in it hits for
      stats.attackDamage = Math.round((((stats.attackDamage || 0)) + 3 + rarityIdx * 1.6) * 10) / 10;
      // ...plus the marque's signature stat, the same shape a cannon class uses
      if (fc.stat) stats[fc.stat] = Math.round((((stats[fc.stat] || 0)) + fc.per[0] + rarityIdx * fc.per[1]) * 10) / 10;
    } else if (slotKey === 'bow') {
      const wc = pickWeaponClass();
      wclass = wc.key;
      name = pickWeaponName(wc.key, rarityIdx);
      if (wc.key === 'laser')        stats.attackSpeed = Math.round((((stats.attackSpeed || 0)) + 2 + rarityIdx * 0.8) * 10) / 10;
      else if (wc.key === 'gatling') stats.multiShot = (stats.multiShot || 0) + 1;
      else if (wc.key === 'missile') { if (stats.attackDamage) stats.attackDamage = Math.round(stats.attackDamage * 1.2); }
      else if (wc.key === 'rail')    stats.critDamage = Math.round(((stats.critDamage || 0) + 15 + rarityIdx * 3) * 10) / 10;
      else if (wc.key === 'plasma')  stats.lifeSteal = Math.round((((stats.lifeSteal || 0)) + 0.2 + (rarityIdx >= 4 ? 0.2 : 0)) * 10) / 10;
      // 'support' (Warden Array) carries no extra item stat — its power is the
      // fleet aura, computed at runtime from rarity (see supportAura).
    } else {
      name = pickName(slotKey, rarityIdx);
    }

    return {
      id: _idSeq++,
      name,
      wclass,
      slot: slotKey,
      rarity: rarityIdx,
      dungeon,
      ilvl,
      stats,
      icon: slot.icon,
    };
  }

  // Power score for sorting, upgrade hints, and auto-equip. Built so that the
  // zone-scaled flat stats (damage / health) dominate ranking, with offense and
  // specials valued in sensible, comparable units (not so heavy that a single
  // special line makes a weak item outrank a strong one).
  // CLASS-FAIR RANKING — weapon classes are SIDE-grades by design (a missile
  // really hits harder, a laser really cycles faster). But auto-equip and
  // sorting rank by this power score, so if a class's signature bonus inflates
  // it, that class crowds out every hardpoint. Strip the known class-bonus
  // contribution from the score (new-format weapons only — legacy items never
  // received bonuses), and credit Warden arrays for their uncounted aura.
  function classAdjustPower(item, p) {
    if ((item.slot !== 'bow' && item.slot !== 'fighter') || !item.wclass) return p;
    const r = item.rarity || 0;
    switch (item.wclass) {
      case 'fighter': return p - 0.9 * (3 + 1.6 * r);                  // damage line + the wing itself
      case 'f_talon':  return p - 0.9 * (3 + 1.6 * r) - 0.8 * (3 + 1.2 * r);
      case 'f_maul':   return p - 0.9 * (3 + 1.6 * r) - 0.35 * (9 + 4 * r);
      case 'f_lance':  return p - 0.9 * (3 + 1.6 * r);
      case 'f_reaper': return p - 0.9 * (3 + 1.6 * r) - 2.4 * (0.5 + 0.22 * r);
      case 'f_swarm':  return p - 0.9 * (3 + 1.6 * r) - 0.8 * (1.2 + 0.6 * r);
      case 'laser':   return p - 0.9 * (2 + 0.8 * r);                 // attackSpeed bonus
      case 'gatling': return p - 0.8;                                  // +1 multiShot
      case 'rail':    return p - 0.28 * (15 + 3 * r);                  // critDamage bonus
      case 'plasma':  return p - 1.4 * (0.2 + (r >= 4 ? 0.2 : 0));     // lifeSteal bonus
      case 'missile': {                                                // ×1.2 attackDamage
        const ad = item.stats.attackDamage || 0;
        const base = (C.STATS.attackDamage && C.STATS.attackDamage.base) || 14;
        return p - (ad * (0.2 / 1.2) / base) * 2.2;
      }
      case 'support': return p + 2 + r;                                // fleet aura credit
    }
    return p;
  }

  function itemPower(item) {
    let p = 0;
    for (const k in item.stats) {
      const def = C.STATS[k];
      const v = item.stats[k];
      if (!def) continue;
      switch (k) {
        case 'attackDamage': p += (v / def.base) * 2.2; break; // primary DPS driver
        case 'health':       p += (v / def.base) * 1.1; break; // EHP
        case 'attackSpeed':  p += v * 0.9;  break;
        case 'critChance':   p += v * 10;   break; // 1% crit is now the pinnacle roll
        case 'critDamage':   p += v * 0.28; break;
        case 'moveSpeed':    p += v * 0.3;  break;
        case 'lifeSteal':    p += v * 1.4;  break;  // strong but not dominant
        case 'multiShot':    p += v * 0.8;  break;
        default:             p += v * 0.5;
      }
    }
    p = classAdjustPower(item, p);
    p *= 1 + item.rarity * 0.05; // mild rarity nudge for ties
    return p;
  }

  // Per-stat delta of candidate vs equipped (for the compare view).
  function compare(candidate, equipped) {
    const delta = {};
    const keys = new Set([
      ...Object.keys(candidate.stats),
      ...(equipped ? Object.keys(equipped.stats) : []),
    ]);
    keys.forEach((k) => {
      const a = candidate.stats[k] || 0;
      const b = equipped ? equipped.stats[k] || 0 : 0;
      delta[k] = Math.round((a - b) * 10) / 10;
    });
    return delta;
  }

  // Per-tier drop probabilities for a zone. Reads the SAME weights the roll uses,
  // so what a player is shown is what they are actually rolling.
  function rarityChances(dungeon) {
    const weights = rarityWeights(dungeon);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((w) => w / total);
  }
  // Why a tier can't drop here yet — so the Bag can say "zone 115" or "12 stars"
  // instead of just showing nothing. Returns null when the tier is available.
  function rarityBlockedBy(tier) {
    const r = C.RARITY[tier]; if (!r) return null;
    const need = r.ascReq || 0;
    const stars = (() => { try { return (window.PASCEND && window.PASCEND.stars()) | 0; } catch (e) { return 0; } })();
    if (need && stars < need) return { kind: 'stars', need, have: stars };
    // lowest zone whose cap reaches this tier
    if (C.rarityCap) { for (let z = 1; z <= 400; z++) if (C.rarityCap(z) >= tier) return { kind: 'zone', need: z }; }
    return null;
  }

  window.ITEMS = { generate, rollRarity, rarityChances, rarityWeights, rarityBlockedBy, itemPower, compare, weaponClassOf, supportAura, fighterSpec, WEAPON_CLASSES, FIGHTER_CLASSES };
})();
