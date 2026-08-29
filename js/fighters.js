/* =============================================================================
   fighters.js — LOOTFLEET · FIGHTER CLASS: autonomous Heavy Fighters
   ---------------------------------------------------------------------------
   FIGHTER BAY IS A REAL EQUIPMENT SLOT. `fighter` is registered in CONFIG.SLOTS
   next to Cannon, Munitions and Hull, so a Heavy Fighter is an ordinary fitting:
   it drops on the NORMAL loot table (generate() picks a slot at random from
   SLOT_KEYS), rolls every rarity, carries stat lines, sells, salvages,
   auto-equips and saves through the same pipeline as any other item.

   ONE BAY, ONE CRAFT. A hull's `fighterCapacity` IS its number of bays — the
   Vanguard declares 4, so it exposes four Fighter Bay slots and flies four
   fighters. Each craft's damage, cadence, reach and speed come from the item in
   ITS bay, so a better fighter in one bay upgrades exactly that craft, and an
   empty bay flies nothing. Rarity therefore drives the wing's DPS twice over:
   through the craft's own strike, and through the item's stat lines feeding the
   hull's total the way every fitting does.

   THE CRAFT ARE NOT PROJECTILES. Each owns a state, a target, a position and a
   velocity, and steers itself:

     DOCKED → LAUNCHING → INTERCEPTING → ORBITING → (target dies) RETARGETING
            → INTERCEPTING → … → (nothing in range) RETURNING → DOCKED

   EVERY FLEET BENEFIT REACHES THE WING. A fighter's hit goes through the game's
   own resolveHit() with NO `drone` flag, so crit, life steal, boss/elite
   multipliers, FrostyFrost cryo, Starforge cryo and the Voidmaw singularity all
   proc from fighter damage exactly as they do from a bolt. Multi-Shot is rolled
   per attack the same way fire() rolls it. Attack speed folds into damage rather
   than rate — the same trade the hull's own "meaty fire" rule makes past 2.2
   shots/sec, and the reason the wing can carry endgame stats without turning the
   screen into a hose of damage numbers.

   PERFORMANCE. This runs every frame for four craft, so the loop allocates
   NOTHING: the target list is reused, validity is an integer stamp on the enemy
   rather than an indexOf scan, the equipped-bay lookup is cached (it calls
   shipSlots(), which builds three slices and a concat), particle trails are on a
   fixed game-time timer with a hard budget, and the muzzle glow is an additive
   dot rather than a canvas shadowBlur. Under load the wing fires half as often
   for double damage — same DPS, half the floats — which is the identical rule
   the drone bay uses.

   CAPACITY IS A SHIP STAT (`fighterCapacity`), never a constant here, so a
   future 8- or 12-bay carrier is a config line and no code. Everything else is
   in CONFIG.FIGHTER or scales off the bay's rarity via ITEMS.fighterSpec().
   ========================================================================== */
(function () {
  // ---- CRAFT AIRFRAMES ------------------------------------------------------
  // TEN MODELS, ASSIGNED BY MARQUE. Every craft in the game used to be the same
  // bitmap, so a wing of Mauls and a wing of Talons were indistinguishable in
  // the arena even though they fly, cycle and hit nothing alike.
  //
  // MARQUE IS THE AXIS, because it is already the thing that makes one bay
  // different from another — it reshapes damage, cadence, speed, reach and orbit
  // (see FIGHTER_CLASSES in items.js). Tying the silhouette to it means the shape
  // in front of you is a true statement about what the wing does, and each
  // model's native palette is picked to sit near its marque's own accent colour.
  //
  // Two frames for most marques, chosen by a STABLE HASH OF THE ITEM, so two Maul
  // bays in one hangar can still look different from each other while any one bay
  // looks the same on every reload and every device.
  //
  // NOTHING MECHANICAL READS THIS TABLE. Damage, rate, range, speed, the rarity
  // tint and every combat path are exactly as they were — this is the sprite and
  // the sprite only.
  const MODELS = {
    f_talon:  ['ships/fighter-m01.png', 'ships/fighter-m07.png'],
    f_maul:   ['ships/fighter-m02.png', 'ships/fighter-m08.png'],
    f_lance:  ['ships/fighter-m04.png', 'ships/fighter-m05.png'],
    f_reaper: ['ships/fighter-m06.png'],
    f_swarm:  ['ships/fighter-m03.png', 'ships/fighter-m10.png'],
    // Bays that dropped before the marques existed.
    fighter:  ['ships/fighter-m09.png'],
  };
  // The original single sprite, kept as the fallback for anything that fails to
  // resolve a marque — a craft must never draw as nothing.
  const FALLBACK = 'ships/fighter-heavy.png';
  // ONE APPARENT SIZE ACROSS TEN AIRFRAMES. CONFIG.FIGHTER.drawSize is a WIDTH,
  // and the ten frames run 1.40–1.73 tall against the legacy sprite's 1.376 — so
  // anchoring on width alone would have drawn a Swarm Vector 26% longer than the
  // craft it replaces and made every marque a different size, which is a balance
  // signal the art has no business sending.
  //
  // Craft are drawn to a constant LENGTH instead — the legacy sprite's, so nothing
  // changes size from what players fly today — with WINGSPAN following each frame's
  // own proportions. Same class of craft, ten different airframes.
  const LEGACY_ASPECT = 128 / 93;
  // ---- SPRITE LOADING: A FAILED FETCH IS NOT AN ANSWER ----------------------
  // Ten airframes at ~200KB each were all warmed at module load — eleven large
  // parallel requests during boot, competing with the arena. And an Image that
  // FAILS is `complete` with `naturalWidth === 0` forever, which at the call site
  // is indistinguishable from "not decoded yet": one dropped fetch on a phone left
  // that marque drawing the fallback TRIANGLE for the rest of the session. That is
  // the reported "fighter models seem to have broken — they are now arrows".
  //
  // Two corrections, both cosmetic:
  //   1. A failed load is RETRIED (three attempts, backing off) rather than cached
  //      as a permanent no.
  //   2. Only the 15KB legacy sprite is warmed. A marque's frames load the first
  //      time a bay of that marque actually flies, so boot fetches one small image
  //      instead of 2.2MB of art the hangar may never launch.
  const _img = {};
  function imgFor(src) {
    let r = _img[src];
    if (!r) {
      r = _img[src] = { im: new Image(), tries: 1, at: 0, bad: false };
      r.im.onerror = () => { r.bad = true; r.at = Date.now(); };
      r.im.src = src;
      return r.im;
    }
    if (r.bad && r.tries < 3 && Date.now() - r.at > 1500) {
      r.tries++; r.bad = false;
      const im = new Image();
      im.onerror = () => { r.bad = true; r.at = Date.now(); };
      // a fresh URL so a cached failure is not re-served
      im.src = src + (src.indexOf('?') < 0 ? '?r=' : '&r=') + r.tries;
      r.im = im;
    }
    return r.im;
  }
  function drawable(im) { return !!(im && im.complete && im.naturalWidth); }
  imgFor(FALLBACK);
  function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h >>> 0; }
  // Which airframe this bay's craft fly. Stable for the life of the item.
  function modelOf(item) {
    if (!item) return FALLBACK;
    let key = 'fighter';
    try {
      const wc = window.ITEMS && window.ITEMS.weaponClassOf && window.ITEMS.weaponClassOf(item);
      if (wc && wc.key && MODELS[wc.key]) key = wc.key;
    } catch (e) {}
    const pool = MODELS[key] || MODELS.fighter;
    if (pool.length < 2) return pool[0];
    return pool[hash32(String(item.name || '') + '#' + (item.id | 0)) % pool.length];
  }
  const DOCKED = 0, LAUNCH = 1, INTERCEPT = 2, ORBIT = 3, RETURN = 4;

  function host() { try { return window.GAME && window.GAME._fx ? window.GAME._fx() : null; } catch (e) { return null; } }

  // ---- cached rig ----------------------------------------------------------
  // Re-resolved on a timer, not per frame: shipSlots() allocates and
  // weaponClassOf() hashes, and a fitting change 0.4s late is imperceptible.
  let _cacheT = 0, _shipKey = '', _cap = 0, _armed = 0, _range = 0;
  const _rig = [];   // one entry per BAY across every wing: { item, sp } or null when empty
  // ---- ONE WING PER CARRIER IN THE FLEET -----------------------------------
  // A wing used to belong to the flagship alone — capacity, bays and rig all read
  // `state.ship` — so a Corvus sitting in the FLEET fed its stat lines into the
  // hull total and then flew nothing. Eleven bays of visible hardware, no craft on
  // screen. Every carrier in the fleet now launches, from its own hull position,
  // out of its OWN stowed fittings.
  //
  // THEIR STRIKES ARE PAID AT THE FLEET SHARE. An escort's hull mods and stowed
  // gear already reach `rt.stats` at `C.FLEET.statShare`, so a full-price escort
  // wing would be the same hardware counted twice over. The share is what keeps an
  // escort carrier worth fielding without letting a bench of them out-damage the
  // hull actually being flown.
  const _wings = [];   // { key, flag, share, cap, armed, range, at } — `at` = first bay index in _rig
  let _sig = '';
  let _stamp = 0;
  const _targets = [];
  const _pk = { target: null, damage: 0, crit: false, x: 0, y: 0, angle: 0 };

  function capacityOf(h, key) { const s = h.C.SHIP_BY_KEY[key || h.state.ship]; return (s && s.fighterCapacity) | 0; }

  // Where a wing launches from. The flagship is the archer; an escort is its own
  // marker in `rt.escorts`, which updateEscorts() positions each frame. Falls back
  // to the archer for the one frame before escorts are first placed.
  function hostPos(h, w) {
    const a = h.rt.archer;
    if (w.flag) return a;
    const es = h.rt.escorts;
    if (es) for (let i = 0; i < es.length; i++) if (es[i].key === w.key) return es[i];
    return a;
  }

  // DERIVED, NOT CONFIGURED. `CONFIG.FIGHTER.dpsVsCannon` states the intent — a
  // reference wing does N× a cannon hull's base DPS — and the per-strike share falls out
  // of it:
  //
  //     wing DPS / cannon DPS = bays × dmgFrac × attackRate / baseAttackSpeed
  //  →  dmgFrac = ratio × baseAttackSpeed / (bays × attackRate)
  //
  // Writing dmgFrac by hand is how it reached 0.95 and 7.6× cannon output: the number
  // reads modest and the product does not. Deriving it means a change to attackRate or
  // to the player's base fire rate cannot rebalance the class behind our back.
  function baseDmgFrac(F) {
    const bs = (window.CONFIG && window.CONFIG.PLAYER_BASE && window.CONFIG.PLAYER_BASE.attackSpeed) || 1;
    const bays = F.refBays || 4, rate = F.attackRate || 1;
    return (F.dpsVsCannon || 1) * bs / (bays * rate);
  }
  function specOf(h, item) {
    const F = h.C.FIGHTER;
    const s = (window.ITEMS && window.ITEMS.fighterSpec) ? window.ITEMS.fighterSpec(item)
      : { dmgMul: 1, rateMul: 1, rangeMul: 1, speedMul: 1 };
    // `w` is the bay's RAW damage weight (rarity × marque). refresh() normalises it
    // across the wing and writes the final `dmg`; specOf only records the weight.
    return { w: s.dmgMul, dmg: baseDmgFrac(F) * s.dmgMul, rate: F.attackRate * s.rateMul,
             range: F.range * s.rangeMul, speed: F.speed * s.speedMul,
             orbit: F.orbitRadius * (s.orbitMul || 1),
             // THE CRAFT'S AIRFRAME comes from the bay's marque — see MODELS.
             model: modelOf(item),
             // THE CRAFT WEARS ITS BAY'S RARITY. A wing is the carrier's whole
             // armament and the bays are upgraded one at a time, so "which of my
             // four is the good one" is a question the arena should answer without
             // opening a menu. Resolved through CONFIG.RARITY so the colour is the
             // same one the loot screen, the chip and the drop burst all use.
             rarity: (item && item.rarity != null) ? (item.rarity | 0) : 0,
             col: rarityCol(h, item) };
  }
  // The bay's rarity colour, or the neutral hull grey for an unfitted bay.
  function rarityCol(h, item) {
    if (!item || item.rarity == null) return '#c9d2e0';
    try { const r = h.C.RARITY[item.rarity | 0]; if (r && r.color) return r.color; } catch (e) {}
    return '#c9d2e0';
  }

  // ONE BAY, ONE CRAFT. Bay n flies fighter n, and that craft's damage, cadence,
  // reach and speed come from the item sitting in THAT bay — so upgrading one bay
  // upgrades one fighter, and a half-fitted carrier flies a half-strength wing.
  // An empty bay simply has no craft.
  //
  // Re-resolved on a timer, not per frame: shipSlots() builds three slices and a
  // concat, and a fitting change landing 0.4s late is imperceptible.
  function refresh(h, dt) {
    _cacheT -= dt;
    const sig = h.state.ship + '|' + ((h.state.fleet || []).join(','));
    if (_cacheT > 0 && sig === _shipKey) return;
    _cacheT = 0.4; _shipKey = sig;
    _wings.length = 0; _rig.length = 0; _armed = 0; _range = 0; _cap = 0;
    const share = (h.C.FLEET && h.C.FLEET.statShare) || 0;
    // the flagship first, then every escort hull that actually has bays
    const hulls = [{ key: h.state.ship, flag: true, gear: h.state.equipped || {}, share: 1 }];
    try {
      if (h.fleetShips) h.fleetShips().forEach((f) => {
        if (!capacityOf(h, f.key)) return;
        hulls.push({ key: f.key, flag: false, share,
                     gear: (h.state.fittings && h.state.fittings[f.key]) || {} });
      });
    } catch (e) {}
    for (let hi = 0; hi < hulls.length; hi++) {
      const hu = hulls[hi], cap = capacityOf(h, hu.key);
      if (!cap) continue;
      // INDEX INTO `_wings`, NOT INTO `hulls`. Any hull without bays is skipped, so
      // the two lists diverge the moment a cannon flagship leads the fleet — and a
      // craft carrying the hulls index then resolves to the WRONG wing: wrong
      // launch point, wrong damage share.
      const wi = _wings.length;
      const w = { key: hu.key, flag: hu.flag, share: hu.share, cap, armed: 0, range: 0, at: _rig.length };
      const slots = h.C.shipSlots(hu.key);
      let n = 0;
      for (let i = 0; i < slots.length && n < cap; i++) {
        if (h.C.slotBase(slots[i]) !== 'fighter') continue;
        const item = hu.gear[slots[i]];
        if (item) {
          const sp = specOf(h, item);
          _rig[w.at + n] = { item, sp, wi }; w.armed++;
          if (sp.range > w.range) w.range = sp.range;   // the envelope is that carrier's own
        } else _rig[w.at + n] = { empty: 1, sp: null, wi };
        n++;
      }
      while (n < cap) _rig[w.at + n++] = { empty: 1, sp: null, wi };
    // ---- NORMALISE THE WING TO THE ANCHOR, ON THE DPS PRODUCT ------------
    // A craft's contribution is dmg × rate, so the normalisation has to be done on the
    // PRODUCT. Scaling damage alone (642) divided each craft's dmgMul by the wing's mean
    // dmgMul — which in a uniform wing is the same number, so the marque's damage
    // identity CANCELLED OUT and its untouched rateMul became the only thing setting wing
    // DPS. That inverted the whole marque design: the Maul, whose entire pitch is that
    // every pass lands like a capital shell, measured 0.77× cannon — the weakest wing in
    // the game and worse than having no fighters — while the Swarm, documented as "each hit
    // is slight", measured 1.65×. Spread was 0.77–1.65× around an anchor meant to be tight.
    //
    // Normalising the product fixes both halves at once:
    //
    //     target  = cap × base × attackRate          (the anchor, per CONFIG.FIGHTER)
    //     actual  = base × attackRate × Σ(w_i × rateMul_i)
    //     k       = cap / Σ(w_i × rateMul_i)
    //     dmg_i   = base × w_i × k
    //
    // so Σ(dmg_i × rate_i) is exactly the anchor for ANY mix of marques and rarities,
    // while w_i still ranks the bays against each other. A marque is now genuinely a
    // shape — the Maul hits hard and slowly, the Swarm often and lightly, and both wings
    // total the same. Done PER WING, so one carrier's loadout never rescales another's.
    {
      const F0 = h.C.FIGHTER, base = baseDmgFrac(F0), rate0 = F0.attackRate || 1;
      let sum = 0, cnt = 0;
      for (let i = 0; i < cap; i++) {
        const e = _rig[w.at + i]; if (!e || !e.sp) continue;
        // rate is already F.attackRate × rateMul, so this is the rate ratio
        sum += (e.sp.w || 1) * ((e.sp.rate || rate0) / rate0);
        cnt++;
      }
      const k = sum > 0 ? cnt / sum : 1;
      for (let i = 0; i < cap; i++) {
        const e = _rig[w.at + i]; if (!e || !e.sp) continue;
        e.sp.dmg = base * (e.sp.w || 1) * k;
      }
    }
    _wings.push(w);
    _armed += w.armed; _cap += cap;
    if (w.range > _range) _range = w.range;
    }
    const list = h.rt.fighters;
    if (list) for (let i = 0; i < list.length; i++) {
      const e = _rig[i];
      list[i].sp = e ? e.sp : null;
      if (e) list[i].wi = e.wi | 0;
    }
  }

  // Weapon Range from skills, the pilot tree, hull mods, gear and the Warden aura
  // arrives as one multiplier on the hull's reach — but only a DAMPED, CAPPED
  // share of it carries into the envelope. Passing it through raw made the
  // envelope tens of times larger than the map at endgame, which erases the
  // constraint the whole class is balanced against. See CONFIG.FIGHTER.
  function envMul(F, st) {
    const m = (st && st.rangeMul) || 1;
    const v = 1 + (m > 1 ? m - 1 : 0) * F.rangeShare;
    return v > F.rangeMulCap ? F.rangeMulCap : v;
  }

  function make(i, x, y) {
    return { i, sp: null, st: DOCKED, x, y, vx: 0, vy: 0, face: -Math.PI / 2, tgt: null,
             cd: 0, wait: 0, flash: 0, tr: 0, phase: Math.random() * 6.283, dir: i % 2 ? 1 : -1,
             // FIGHTER ASCENSION per-craft runtime: corona pulse clock + ring
             // flash, and the lagged position the Phantom Lattice echo is drawn
             // at. All cosmetic-adjacent bookkeeping; nothing here is saved.
             au: Math.random() * 0.5, aup: 0, ring: Math.random() * 6.283, ex: x, ey: y, eface: -Math.PI / 2 };
  }

  // SPREAD FIRST, STACK ONLY WHEN FORCED. `_fc` is a per-frame assignment count
  // written straight onto the enemy, so distributing four craft over a screen of
  // hostiles costs one pass and no Map.
  function assign(f) {
    let best = null, bestScore = Infinity;
    for (let i = 0; i < _targets.length; i++) {
      const e = _targets[i];
      const dx = e.x - f.x, dy = e.y - f.y;
      const score = e._fc * 1e9 + (dx * dx + dy * dy);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) best._fc++;
    return best;
  }

  function steer(f, tx, ty, speed, dt, turn) {
    const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
    const k = 1 - Math.exp(-dt * turn);
    f.vx += ((dx / d) * speed - f.vx) * k;
    f.vy += ((dy / d) * speed - f.vy) * k;
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (Math.abs(f.vx) + Math.abs(f.vy) > 4) f.face = Math.atan2(f.vy, f.vx);
    return d;
  }

  function strike(h, f, e, dmg, crit, ang) {
    _pk.target = e; _pk.damage = dmg; _pk.crit = crit;
    _pk.x = f.x; _pk.y = f.y; _pk.angle = ang;
    // NO `drone` FLAG — that flag is what suppresses cryo, Starforge freeze and
    // the Voidmaw singularity for drone fire. A fighter is the hull's whole
    // weapon, so every fleet benefit has to fire from it.
    h.hit(_pk);
  }

  // ---- FIGHTER ASCENSION · EFFECTS -----------------------------------------
  // Doctrine effects are drawn to the same rules the rest of the wing already
  // holds to: no ctx.shadowBlur (it re-rasterises the sprite), no per-frame
  // allocation, a hard particle budget, and nothing that outlives LOD 2. The
  // player can switch the whole lot off per device (FASCEND.fxOn) — it is PAINT
  // ONLY and moves no damage number anywhere, which is the same rule perf-tier.js
  // states for every quality knob in the game.
  let _soSeen = -1;
  // A nova fires on every fighter KILL, and a wing in a beacon swarm kills many
  // times a frame. Effects therefore draw from a per-tick budget rather than per
  // kill — the damage is never budgeted, only the paint.
  let _novaFxLeft = 0;
  function novaFx(h, x, y, r, k) {
    if (_novaFxLeft <= 0) return;
    _novaFxLeft--;
    const rt = h.rt;
    if (rt.particles.length < 252) {
      rt.particles.push(new h.E.Particle(x, y, { vx: 0, vy: 0, life: 0.24, size: r * 0.46 * k, color: 'rgba(255,236,170,0.45)', glow: true, drag: 1 }));
    }
    const n = rt.lod ? 4 : 9;
    for (let i = 0; i < n && rt.particles.length < 268; i++) {
      const a = (6.283 * i) / n + Math.random() * 0.5, sp = (150 + Math.random() * 200) * k;
      rt.particles.push(new h.E.Particle(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.26 + Math.random() * 0.2, size: 1.5 + Math.random() * 2.2, color: i % 3 ? '#ffe27a' : '#fff6dd', glow: true, drag: 0.86 }));
    }
    // NO SCREEN SHAKE. A nova is a per-kill event; shaking on each one would make
    // an ordinary swarm unreadable and is exactly the kind of "more is better"
    // effect that gets a feature reported as motion sickness.
  }
  // One launch flare per CARRIER when a sortie window opens — an event, not a
  // per-craft effect.
  function sortieFlare(h, w) {
    const rt = h.rt;
    if (w.hx == null) return;
    if (rt.particles.length < 250) {
      rt.particles.push(new h.E.Particle(w.hx, w.hy, { vx: 0, vy: 0, life: 0.32, size: 34, color: 'rgba(201,140,255,0.42)', glow: true, drag: 1 }));
    }
    const n = rt.lod ? 6 : 14;
    for (let i = 0; i < n && rt.particles.length < 266; i++) {
      const a = (6.283 * i) / n, sp = 210 + Math.random() * 160;
      rt.particles.push(new h.E.Particle(w.hx, w.hy, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.2, size: 1.8 + Math.random() * 2, color: i % 2 ? '#c98cff' : '#e9d4ff', glow: true, drag: 0.88 }));
    }
    if (rt.floats.length < 10) {
      rt.floats.push(new h.E.FloatText(w.hx, w.hy - 30, '➤ SORTIE', { color: '#c98cff', size: 22, vy: -26, life: 1 }));
    }
  }

  function update(dt) {
    const h = host(); if (!h) return;
    const rt = h.rt, a = rt.archer, state = h.state;
    if (!a) return;
    refresh(h, dt);
    if (!_cap || !_armed) { if (rt.fighters && rt.fighters.length) rt.fighters.length = 0; return; }

    if (!rt.fighters || rt.fighters.length !== _cap || _sig !== _shipKey) {
      const prev = rt.fighters || [];
      _sig = _shipKey;
      rt.fighters = [];
      for (let i = 0; i < _cap; i++) rt.fighters.push(prev[i] || make(i, a.x, a.y));
      for (let i = 0; i < _cap; i++) {
        const e = _rig[i];
        rt.fighters[i].sp = e ? e.sp : null;
        rt.fighters[i].wi = e ? e.wi : 0;
      }
    }
    const list = rt.fighters, F = h.C.FIGHTER, st = rt.stats;
    // Resolve each wing's launch point ONCE per tick rather than per craft, and
    // remember how far the furthest carrier sits from the flagship so the target
    // sweep below covers what an escort's own wing can legitimately reach.
    let spread = 0;
    for (let i = 0; i < _wings.length; i++) {
      const w = _wings[i], p = hostPos(h, w);
      w.hx = p.x; w.hy = p.y;
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d > spread) spread = d;
    }
    const env = _range * envMul(F, st);
    const grounded = a.dead || rt.awaitingRespawn;

    // ---- valid targets, in one pass, with no allocation --------------------
    _stamp++;
    _targets.length = 0;
    if (!grounded) {
      // Swept from the flagship with the fleet's own spread added on, so a craft
      // launched off an escort out on the flank is not blind to what is in front
      // of it. Every wing shares one pass; the per-craft reach test below is what
      // actually governs engagement.
      const r2 = (env + spread) * (env + spread), en = rt.enemies;
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (!e || e.dead || e.dying) continue;
        const dx = e.x - a.x, dy = e.y - a.y;
        if (dx * dx + dy * dy <= r2) { e._fs = _stamp; e._fc = 0; _targets.push(e); }
      }
    }
    const any = _targets.length > 0;
    for (let i = 0; i < list.length; i++) { const f = list[i]; if (f.tgt && f.tgt._fs === _stamp) f.tgt._fc++; }

    // UNDER LOAD, HALF THE ATTACKS AT DOUBLE DAMAGE — identical DPS, half the
    // floating numbers and impact particles. Same rule the drone bay runs.
    const crowd = rt.floats.length > 24 || rt.particles.length > 300;
    // ATTACK SPEED FOLDS INTO DAMAGE, not into rate: the wing carries the pilot's
    // fire-rate bonuses without adding a single extra object to the frame.
    const spdMul = Math.max(1, st.attacksPerSec / (h.C.PLAYER_BASE.attackSpeed || 1));
    // ---- COSMETIC EMISSION BUDGET (Aug 2026 — the carrier frame-rate fix) ----
    // The wing's particle output was scaling with THREE things at once and the
    // frame paid for all of them: bay count (4 → 11 across the ladder), the
    // sub-step count (step() runs update() up to 6× a frame at high speed), and
    // game speed itself — because the trail cadence was measured in GAME time.
    // A 6-bay carrier at 5× emitted ~500 trail motes a second against a 320
    // particle ceiling, so the array was being pushed and spliced continuously
    // and every frame drew hundreds of two-pass glow arcs. That is the lag.
    //
    // Two corrections, both purely cosmetic — no damage, rate or targeting
    // behaviour changes:
    //   1. The trail runs on WALL-CLOCK time. Multiplying the interval by game
    //      speed keeps motes-per-real-second identical at 1× and 10×, which is
    //      also what the trail is supposed to look like: a steady streak, not a
    //      denser one because the sim is running hot.
    //   2. ONE budget for the WHOLE wing per sub-step, checked against the LIVE
    //      particle count. The old check sampled the count once before the loop,
    //      so eleven craft could each pass a test taken when the array was still
    //      under the limit and blow through it together.
    const gs = Math.max(1, state.gameSpeed | 0);
    const trailEvery = F.trailEvery * gs;
    let motes = 2;

    // ---- FIGHTER ASCENSION -------------------------------------------------
    // Read ONCE per tick, not per craft: the doctrine table resolves to a cached
    // object and these are the only numbers the loop below needs. The same pass
    // hoists the two fleet-wide damage multipliers that used to be resolved on
    // every single strike (behaviour-identical inside one tick).
    const FA = window.FASCEND;
    if (FA) FA.tick(dt, any);
    // AREA DAMAGE IS THE HOST'S JOB (see _fxo.area in game-v93.js). Guarded, not
    // assumed: a stale cached engine paired with a fresh copy of this file would
    // otherwise throw on every frame a halo pulsed. No host area path, no halo
    // and no nova — the strike-weight doctrines still work.
    const areaFn = h.area ? h.area : null;
    const dCor = (FA && areaFn) ? FA.corona() : null;
    const dPh = FA ? FA.phantom() : null;
    const dNv = (FA && areaFn) ? FA.nova() : null;
    const dSo = FA ? FA.sortie() : null;
    const soDmg = dSo ? dSo.dmg : 1, soRate = dSo ? dSo.rate : 1;
    const faFx = FA ? FA.fxOn() : false;
    _novaFxLeft = faFx ? 3 : 0;   // paint budget for this tick; damage is never budgeted
    const fleetM = window.PASCEND ? window.PASCEND.mult('fleet') : 1;
    const cmdM = (window.COMMANDERS && window.COMMANDERS.fighterMult) ? window.COMMANDERS.fighterMult() : 1;
    // APEX SORTIE opening its window is an EVENT — one flare on each carrier, on
    // the frame it opens, rather than a per-craft effect that would fire eleven
    // times. `fired` is a counter in the module, so this cannot double-fire on a
    // multi-sub-step frame.
    if (dSo && faFx && dSo.fired !== _soSeen) {
      _soSeen = dSo.fired;
      if (dSo.live) for (let wi = 0; wi < _wings.length; wi++) sortieFlare(h, _wings[wi]);
    }

    for (let i = 0; i < list.length; i++) {
      const f = list[i], sp = f.sp;
      const w = _wings[f.wi | 0] || _wings[0];
      // the craft's own carrier is where it sits, launches from, and returns to
      const hx = w ? w.hx : a.x, hy = w ? w.hy : a.y;
      const shr = w ? w.share : 1;
      // an empty bay flies nothing — it sits stowed and is never drawn
      if (!sp) { f.st = DOCKED; f.tgt = null; f.x = hx; f.y = hy; continue; }
      if (f.tgt && f.tgt._fs !== _stamp) { f.tgt = null; if (f.st === ORBIT) f.st = INTERCEPT; }
      f.cd -= dt; f.wait -= dt; f.tr -= dt;
      if (f.flash > 0) f.flash -= dt * 7;

      if (f.st === DOCKED) {
        f.x = hx; f.y = hy; f.vx = f.vy = 0;
        // Bay index WITHIN this craft's own wing. `f.i` is a global index across
        // every carrier, so using it raw would fan an escort's craft out at an
        // angle derived from the flagship's bay count and stagger them by it too.
        const bi = f.i - (w ? w.at : 0);
        if (any && f.wait <= 0) {
          f.st = LAUNCH; f.wait = F.launchTime;
          const ang = -Math.PI / 2 + (bi - (w ? w.cap - 1 : 0) / 2) * 0.5;
          f.vx = Math.cos(ang) * sp.speed * 0.8; f.vy = Math.sin(ang) * sp.speed * 0.8;
          f.face = ang;
        } else if (!any) { f.wait = bi * F.launchStagger; }
        continue;
      }
      if (f.st === LAUNCH) {
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.wait <= 0) f.st = INTERCEPT;
        continue;
      }
      if (!any) f.st = RETURN;
      if (f.st === RETURN) {
        const d = steer(f, hx, hy, sp.speed, dt, 6);
        if (d < F.dockDist) { f.st = DOCKED; f.tgt = null; f.wait = 0; }
        else if (any) f.st = INTERCEPT;
        continue;
      }
      if (!f.tgt) f.tgt = assign(f);
      if (!f.tgt) { f.st = RETURN; continue; }

      const t = f.tgt;
      const reach = sp.orbit + (t.size || 18) * 0.6;
      const ddx = t.x - f.x, ddy = t.y - f.y;
      const dist = Math.hypot(ddx, ddy);

      if (f.st === INTERCEPT) {
        steer(f, t.x, t.y, sp.speed, dt, 7);
        if (dist <= reach * 1.25) { f.st = ORBIT; f.phase = Math.atan2(f.y - t.y, f.x - t.x); }
      } else {
        f.phase += (sp.speed / (reach > 18 ? reach : 18)) * dt * 0.55 * f.dir;
        steer(f, t.x + Math.cos(f.phase) * reach, t.y + Math.sin(f.phase) * reach, sp.speed, dt, 11);
        if (dist > reach * 2.6) f.st = INTERCEPT;
      }

      if (!grounded && f.cd <= 0 && dist <= reach * 1.7) {
        // APEX SORTIE buys CADENCE as well as weight — the window shortens the
        // craft's own reload rather than adding a second fire path.
        f.cd = (crowd ? 2 : 1) / (sp.rate * soRate);
        const crit = Math.random() * 100 < st.critChance;
        // × the wing's share: 1 for the hull being flown, C.FLEET.statShare for an
        // escort carrier, whose gear is already priced into rt.stats at that rate.
        let dmg = st.attackDamage * sp.dmg * spdMul * shr * (0.9 + Math.random() * 0.2) * (crowd ? 2 : 1);
        // WING TACTICS and a FIGHTER COMMANDER, hoisted above the loop — the same
        // seam every fleet-wide fighter bonus lands at.
        dmg *= fleetM * cmdM * soDmg;
        if (crit) dmg *= 1 + st.critDamage / 100;
        if (state.auto) dmg *= 0.8;
        dmg = dmg < 1 ? 1 : Math.round(dmg);
        const ang = Math.atan2(ddy, ddx);
        strike(h, f, t, dmg, crit, ang);
        // ---- PHANTOM LATTICE ------------------------------------------------
        // The echo's lance IS weapon fire: same resolveHit path, same crit, life
        // steal, cryo and corruption as the craft's own shot — fired at the
        // craft's own cadence, so it adds WEIGHT and no new hit rate. It never
        // shoots a wreck, so a target the first strike killed ends the volley
        // (and leaves the kill to Nova below).
        if (dPh) {
          const ed = Math.max(1, Math.round(dmg * dPh.frac));
          for (let q = 0; q < dPh.echoes; q++) {
            if (t.dead || t.dying) break;
            strike(h, f, t, ed, crit, ang);
          }
        }
        // MULTI-SHOT reaches the wing too — rolled per attack against nearby
        // hostiles, exactly as fire() rolls it for a cannon. Held back while the
        // frame is already crowded so it can never be the thing that drops it.
        if (!crowd && st.multiShot > 0 && h.nearby && Math.random() * 100 < st.multiShot) {
          const extra = h.nearby(h.C.MULTISHOT_MAX_TARGETS, t);
          for (let x = 0; x < extra.length; x++) {
            const e2 = extra[x]; if (!e2 || e2.dead || e2.dying) continue;
            strike(h, f, e2, dmg, crit, Math.atan2(e2.y - f.y, e2.x - f.x));
          }
        }
        f.flash = 1;
        // ---- NOVA RECLAMATION -----------------------------------------------
        // Fired only when THIS craft's strike was the killing blow, so it is a
        // reward for the wing finishing something rather than a second aura. The
        // blast is AREA damage (h.area) for the reasons stated there: no per-hit
        // procs at this rate, but onKill() still pays the full purse.
        if (dNv && (t.dead || t.dying)) {
          const blast = Math.max(1, dmg * dNv.frac);
          h.area(t.x, t.y, dNv.r, blast, dNv.n, t);
          if (faFx) novaFx(h, t.x, t.y, dNv.r, 1);
          // COOK-OFF: the wreck goes up a second time — wider, weaker. A single
          // extra ring, never a recursion, so the worst case is bounded.
          if (dNv.chain > 0 && Math.random() < dNv.chain) {
            h.area(t.x, t.y, dNv.r * 1.35, blast * 0.6, dNv.n, t);
            if (faFx) novaFx(h, t.x, t.y, dNv.r * 1.35, 0.6);
          }
        }
        if (motes > 0 && rt.particles.length < 260) {
          motes--;
          rt.particles.push(new h.E.Particle(f.x, f.y, { vx: Math.cos(ang) * 120, vy: Math.sin(ang) * 120,
            life: 0.16, size: 2.4, color: '#ffcf8a', glow: true, drag: 0.84 }));
        }
      }
      // ---- CORONA MANTLE ----------------------------------------------------
      // A HALO, NOT A GUN: it burns whatever the craft is flying through whether
      // or not that hostile is its target, on a fixed 2Hz clock rather than the
      // craft's cadence. Damage is a share of this craft's own strike (so a
      // better bay burns hotter and the wing's anchor still governs it), applied
      // through h.area — no crit, no procs, capped target count. See the
      // area-damage note in game-v93.js for why an aura must not be an impact.
      if (dCor && !grounded && f.st !== DOCKED) {
        f.au -= dt;
        if (f.au <= 0) {
          f.au = 1 / dCor.hz;
          const base = st.attackDamage * sp.dmg * spdMul * shr * fleetM * cmdM * soDmg * (state.auto ? 0.8 : 1);
          const bit = h.area(f.x, f.y, dCor.r, base * dCor.frac, dCor.n, null);
          f.aup = bit ? 1 : 0.3;
          if (faFx && bit && motes > 0 && rt.particles.length < 240) {
            motes--;
            const a2 = Math.random() * 6.283;
            rt.particles.push(new h.E.Particle(f.x + Math.cos(a2) * dCor.r * 0.7, f.y + Math.sin(a2) * dCor.r * 0.7,
              { vx: 0, vy: -14, life: 0.3, size: 2.6, color: '#ffb347', glow: true, drag: 0.9 }));
          }
        }
        if (f.aup > 0) f.aup -= dt * 2.4;
        f.ring += dt * 1.7;
      }
      // The Phantom echo is drawn at a LAGGED position — tracked here so the
      // draw pass stays a blit and never re-derives motion.
      if (dPh) {
        const k2 = 1 - Math.exp(-dt * 7);
        f.ex += (f.x - f.ex) * k2; f.ey += (f.y - f.ey) * k2;
        f.eface = f.face;
      }
      // ENGINE TRAIL — fixed WALL-CLOCK cadence against the shared wing budget.
      // The timer is reset whether or not a mote is actually emitted, so a
      // skipped one is dropped rather than banked into a later burst.
      if (f.tr <= 0) {
        f.tr = trailEvery;
        if (motes > 0 && rt.particles.length < 200) {
          motes--;
          rt.particles.push(new h.E.Particle(f.x - Math.cos(f.face) * 7, f.y - Math.sin(f.face) * 7,
            { vx: -Math.cos(f.face) * 26, vy: -Math.sin(f.face) * 26, life: 0.28, size: 2, color: '#ff9f5a', glow: true, drag: 0.9 }));
        }
      }
    }
  }

  // One offscreen bitmap per AIRFRAME × rarity colour, built on first use and kept
  // for the session. The sprite is the only thing on that surface, so
  // `source-atop` finally means what it says: paint the colour ONLY where the hull
  // is, leaving its shading readable underneath rather than flattening it to a
  // silhouette.
  //
  // KEYED ON THE MODEL TOO, now that there are ten of them. Keying on colour
  // alone would have handed a Talon the tinted Maul bitmap for any colour a Maul
  // happened to reach first.
  // ONE BITMAP PER AIRFRAME × RARITY COLOUR — AND NOT AT SOURCE RESOLUTION.
  // The marque frames are ~300×484 for a craft drawn 52px wide. Tinting at natural
  // size cost ~580KB of canvas per entry, and ten airframes against seventeen
  // rarity colours is ~100MB of surfaces on a phone — then every blit downscaled
  // 6:1. Rasterised at twice the drawn height instead: ~14× less memory, cheaper
  // draw, no visible difference at 52px.
  const RASTER_H = 256;
  const _tintCache = {};
  function tintedSprite(src, col) {
    const k = src + '|' + col;
    if (_tintCache[k] !== undefined) return _tintCache[k];
    const im = imgFor(src);
    if (!drawable(im)) return null;   // not cached — retry next frame
    try {
      const s = Math.min(1, RASTER_H / im.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(im.naturalWidth * s));
      cv.height = Math.max(1, Math.round(im.naturalHeight * s));
      const c = cv.getContext('2d');
      c.drawImage(im, 0, 0, cv.width, cv.height);
      c.globalCompositeOperation = 'source-atop';
      c.globalAlpha = 0.62;
      c.fillStyle = col;
      c.fillRect(0, 0, cv.width, cv.height);
      return (_tintCache[k] = cv);
    } catch (e) { return (_tintCache[k] = null); }
  }

  function draw(ctx) {
    const h = host(); if (!h) return;
    const list = h.rt.fighters; if (!list || !list.length) return;
    const w = h.C.FIGHTER.drawSize;
    // RARITY TINT — PRE-RENDERED, NOT COMPOSITED IN PLACE.
    //
    // The first attempt drew the sprite and then filled a rect over it with
    // `source-atop`. That is wrong on a shared canvas: source-atop keeps the new
    // paint wherever the DESTINATION is opaque, and the destination here is the
    // whole arena — background included — so it painted a solid coloured SQUARE
    // over each craft instead of colouring the hull.
    //
    // The composite has to happen somewhere the sprite is the ONLY thing on the
    // surface. Each colour therefore gets its own offscreen canvas, tinted once
    // and cached; the arena just blits the right bitmap. Correct, and cheaper
    // than the per-craft composite it replaces.
    // RARITY COLOUR IS IDENTITY, NOT DECORATION — so it is NOT tied to LOD.
    // It was gated behind `lod < 2`, which meant the survival tier flew a wing of
    // identical grey craft: exactly when a player most needs to read which bay is
    // their good one, the answer was taken away. Measured cost of the tinted blit
    // is 1.03µs against 0.90µs for the raw sprite — 1.15× one draw call, for a
    // handful of craft. That is not a frame-time decision, it is free.
    //
    // LOD sheds bloom, trails and motes. It never sheds information.
    const tint = true;
    // ---- FIGHTER ASCENSION: read the doctrines ONCE for the whole pass -------
    // Haloes and echoes are shed at LOD 2 (the survival tier) exactly as bloom
    // and trails are; the sortie's afterburner is two triangles and stays.
    const FA = window.FASCEND;
    const faFx = FA ? FA.fxOn() : false;
    const lod = h.rt.lod | 0;
    const cor = (faFx && lod < 2) ? FA.corona() : null;
    const ph = (faFx && lod < 2) ? FA.phantom() : null;
    const so = faFx ? FA && FA.sortie() : null;
    const soLive = !!(so && so.live);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.st === DOCKED) continue;
      const col = (f.sp && f.sp.col) || '#c9d2e0';
      // AIRFRAME PER CRAFT, and therefore ASPECT PER CRAFT. The ten models are not
      // one shape — they run 1.40 to 1.73 tall — so a single cached ratio would
      // squash or stretch every frame but the one it was measured from. LENGTH is
      // pinned to LEGACY_ASPECT; wingspan follows each frame.
      const src0 = (f.sp && f.sp.model) || FALLBACK;
      // A marque frame that has not arrived yet — or failed — draws the LEGACY
      // CRAFT, not the wireframe triangle. The arrow is a last resort for a
      // session with no art at all, never a loading state.
      let src = src0, im = imgFor(src0);
      if (!drawable(im) && src0 !== FALLBACK) { src = FALLBACK; im = imgFor(FALLBACK); }
      const ready = drawable(im);
      const hh = w * LEGACY_ASPECT;
      const ww = ready ? hh * (im.naturalWidth / im.naturalHeight) : w;
      const art = (ready && tint && col !== '#c9d2e0') ? tintedSprite(src, col) : null;
      // ---- CORONA MANTLE: the halo, drawn in WORLD space ----------------------
      // Two counter-rotating arcs and one faint disc — no gradient (that is an
      // allocation per craft per frame) and no blur. The disc reads as heat, the
      // arcs as containment, and the whole thing brightens on the pulse that
      // actually bit something.
      if (cor) {
        const rr = cor.r, pu = Math.max(0, Math.min(1, f.aup || 0));
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.07 + 0.09 * pu;
        ctx.fillStyle = '#ff8a3d';
        ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.45 + 0.45 * pu;
        ctx.lineWidth = 1.7; ctx.strokeStyle = '#ffb347';
        ctx.beginPath(); ctx.arc(0, 0, rr * 0.95, f.ring, f.ring + 2.2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, rr * 0.95, f.ring + 3.14, f.ring + 4.3); ctx.stroke();
        ctx.globalAlpha = 0.3 + 0.4 * pu;
        ctx.lineWidth = 1.1; ctx.strokeStyle = '#ffe27a';
        ctx.beginPath(); ctx.arc(0, 0, rr * 0.74, -f.ring * 1.5, -f.ring * 1.5 + 1.6); ctx.stroke();
        ctx.restore();
      }
      // ---- PHANTOM LATTICE: the echo ------------------------------------------
      // The same bitmap at the craft's LAGGED position, drawn under it at a third
      // alpha. A second echo (rank 6+) sits halfway between the two, so the
      // doctrine's rank is legible from the arena without opening a menu.
      if (ph && ready) {
        const gx = f.ex, gy = f.ey;
        for (let q = 0; q < ph.echoes; q++) {
          const t2 = ph.echoes === 1 ? 0 : q / ph.echoes;   // 0 = furthest behind
          const px = gx + (f.x - gx) * t2, py = gy + (f.y - gy) * t2;
          // save/restore per echo — NEVER setTransform: the arena has already
          // applied its camera transform before draw() is called, and resetting
          // to identity would paint the wing in screen space.
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.3 - q * 0.09;
          ctx.translate(px, py);
          ctx.rotate(f.eface + Math.PI / 2);
          ctx.drawImage(art || im, -ww / 2, -hh / 2, ww, hh);
          ctx.restore();
        }
      }
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.face + Math.PI / 2);            // art is drawn nose-up (-y)
      // ---- APEX SORTIE: afterburner ------------------------------------------
      // Two triangles behind the craft while the window is open. Cheapest
      // possible statement of "the whole wing is at full burn", and the one
      // doctrine effect kept at every LOD because it is a STATE the player is
      // reacting to, not decoration.
      if (soLive) {
        const fl = hh * (0.55 + 0.25 * Math.random());
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#c98cff';
        ctx.beginPath(); ctx.moveTo(-ww * 0.16, hh * 0.34); ctx.lineTo(ww * 0.16, hh * 0.34); ctx.lineTo(0, hh * 0.34 + fl); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#f0e0ff';
        ctx.beginPath(); ctx.moveTo(-ww * 0.07, hh * 0.34); ctx.lineTo(ww * 0.07, hh * 0.34); ctx.lineTo(0, hh * 0.34 + fl * 0.55); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      if (ready) {
        ctx.drawImage(art || im, -ww / 2, -hh / 2, ww, hh);
      }
      else {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(0, -hh * 0.4); ctx.lineTo(ww * 0.3, hh * 0.3); ctx.lineTo(0, hh * 0.15); ctx.lineTo(-ww * 0.3, hh * 0.3); ctx.closePath(); ctx.fill();
      }
      // muzzle glow as an ADDITIVE DOT. ctx.shadowBlur here cost more than every
      // other thing the wing does put together — it re-rasterises the sprite.
      if (f.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = f.flash * 0.75;
        // The muzzle flash carries the rarity colour too, so a wing reads at a
        // glance even mid-volley when the hulls are behind their own fire.
        ctx.fillStyle = col === '#c9d2e0' ? '#ffd9a0' : col;
        ctx.beginPath(); ctx.arc(0, -hh * 0.42, w * 0.16, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  }

  function status() {
    const h = host(); if (!h) return null;
    refresh(h, 0);
    if (!_cap) return null;
    let out = 0;
    const list = h.rt.fighters || [];
    for (let i = 0; i < list.length; i++) if (list[i].st !== DOCKED) out++;
    // `bays`/`armed` are the whole fleet's; `flagBays` is just the hull being flown,
    // so a readout can say "4 of yours + 11 from the fleet" rather than one figure
    // that looks wrong against the hangar card.
    const w0 = _wings[0];
    return { cap: _cap, bays: _cap, armed: _armed, out,
             flagBays: w0 && w0.flag ? w0.cap : 0, flagArmed: w0 && w0.flag ? w0.armed : 0,
             wings: _wings.length, escortWings: _wings.filter((w) => !w.flag).length,
             range: _range * envMul(h.C.FIGHTER, h.rt.stats) };
  }

  // ---- THE WING'S SHARE OF SHIP SCORE ---------------------------------------
  // Ship Score, the published fleet score, the clone matchup and the offline sim
  // all read `rt.stats.theoryDps`, which models a CANNON: damage × fire rate ×
  // crit. A carrier's damage does not leave a cannon, so none of it was counted.
  // The Vanguard was scored on a gun it does not mount (weapons: 0 — it reported
  // phantom DPS and none of its real output), and every gunned carrier was scored
  // as though its bays were empty.
  //
  // The ratio is exact, not an estimate. refresh() normalises the wing so that
  //
  //     Σ(dmg_i × rate_i) = armedBays × baseDmgFrac × attackRate
  //
  // for ANY mix of marques and rarities, and baseDmgFrac is itself derived from
  // dpsVsCannon — so this reduces to (armedBays / refBays) × dpsVsCannon and the
  // published anchor holds by construction. Returned as a MULTIPLE of cannon DPS
  // so the caller needs no fighter internals: wingDps = cannonDps × dpsRatio().
  //
  // `force` drops the 0.4s rig cache, because a bay swap must move the score on
  // the same frame the player makes it, not up to two fifths of a second later.
  //
  // EVERY WING COUNTS, EACH AT ITS OWN SHARE. An escort carrier's craft land real
  // damage now, so leaving them out of the ratio would repeat the exact fault this
  // function was written to fix — a hull scored as though its bays were empty —
  // one level down in the fleet.
  function dpsRatio(force) {
    const h = host(); if (!h) return 0;
    if (force) _cacheT = 0;
    refresh(h, 0);
    if (!_cap || !_armed) return 0;
    const bs = (h.C.PLAYER_BASE && h.C.PLAYER_BASE.attackSpeed) || 1;
    // FIGHTER ASCENSION belongs in the score for the same reason the wing does:
    // a doctrine that adds real damage and is missing from theoryDps under-scores
    // every carrier that flies it. strikeMult() is exact for the Phantom Lattice
    // and averaged over the duty cycle for Apex Sortie; the Corona is added at
    // its SINGLE-TARGET worth only. See the note in fighter-ascension.js.
    const FA = window.FASCEND;
    const sm = FA ? FA.strikeMult() : 1;
    let sum = 0;
    for (let wi = 0; wi < _wings.length; wi++) {
      const w = _wings[wi];
      let s = 0;
      for (let i = 0; i < w.cap; i++) {
        const e = _rig[w.at + i]; if (!e || !e.sp) continue;
        const strike = e.sp.dmg * e.sp.rate;
        s += strike * sm + (FA ? FA.coronaDpsPerCraft(strike, e.sp.rate) : 0);
      }
      sum += s * w.share;
    }
    const r = sum / bs;
    return isFinite(r) && r > 0 ? r : 0;
  }

  window.FIGHTERS = { update, draw, status, dpsRatio, capacity: () => _cap,
                      wings: () => _wings.map((w) => ({ key: w.key, flag: w.flag, bays: w.cap, armed: w.armed, share: w.share })) };
})();
