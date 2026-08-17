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
  const IMG = new Image(); IMG.src = 'ships/fighter-heavy.png';
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
             orbit: F.orbitRadius * (s.orbitMul || 1) };
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
             cd: 0, wait: 0, flash: 0, tr: 0, phase: Math.random() * 6.283, dir: i % 2 ? 1 : -1 };
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
        f.cd = (crowd ? 2 : 1) / sp.rate;
        const crit = Math.random() * 100 < st.critChance;
        // × the wing's share: 1 for the hull being flown, C.FLEET.statShare for an
        // escort carrier, whose gear is already priced into rt.stats at that rate.
        let dmg = st.attackDamage * sp.dmg * spdMul * shr * (0.9 + Math.random() * 0.2) * (crowd ? 2 : 1);
        if (crit) dmg *= 1 + st.critDamage / 100;
        if (state.auto) dmg *= 0.8;
        dmg = dmg < 1 ? 1 : Math.round(dmg);
        const ang = Math.atan2(ddy, ddx);
        strike(h, f, t, dmg, crit, ang);
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
        if (motes > 0 && rt.particles.length < 260) {
          motes--;
          rt.particles.push(new h.E.Particle(f.x, f.y, { vx: Math.cos(ang) * 120, vy: Math.sin(ang) * 120,
            life: 0.16, size: 2.4, color: '#ffcf8a', glow: true, drag: 0.84 }));
        }
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

  function draw(ctx) {
    const h = host(); if (!h) return;
    const list = h.rt.fighters; if (!list || !list.length) return;
    const ready = IMG.complete && IMG.naturalWidth;
    const w = h.C.FIGHTER.drawSize;
    const hh = ready ? w * (IMG.naturalHeight / IMG.naturalWidth) : w;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.st === DOCKED) continue;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.face + Math.PI / 2);            // art is drawn nose-up (-y)
      if (ready) ctx.drawImage(IMG, -w / 2, -hh / 2, w, hh);
      else {
        ctx.fillStyle = '#c9d2e0';
        ctx.beginPath(); ctx.moveTo(0, -hh * 0.4); ctx.lineTo(w * 0.3, hh * 0.3); ctx.lineTo(0, hh * 0.15); ctx.lineTo(-w * 0.3, hh * 0.3); ctx.closePath(); ctx.fill();
      }
      // muzzle glow as an ADDITIVE DOT. ctx.shadowBlur here cost more than every
      // other thing the wing does put together — it re-rasterises the sprite.
      if (f.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = f.flash * 0.75;
        ctx.fillStyle = '#ffd9a0';
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
    let sum = 0;
    for (let wi = 0; wi < _wings.length; wi++) {
      const w = _wings[wi];
      let s = 0;
      for (let i = 0; i < w.cap; i++) { const e = _rig[w.at + i]; if (e && e.sp) s += e.sp.dmg * e.sp.rate; }
      sum += s * w.share;
    }
    const r = sum / bs;
    return isFinite(r) && r > 0 ? r : 0;
  }

  window.FIGHTERS = { update, draw, status, dpsRatio, capacity: () => _cap,
                      wings: () => _wings.map((w) => ({ key: w.key, flag: w.flag, bays: w.cap, armed: w.armed, share: w.share })) };
})();
