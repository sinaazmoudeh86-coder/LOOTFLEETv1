/* =============================================================================
   entities.js — Infinite Archer
   Lightweight classes for things that live in the arena. They own their
   position + motion update; all DRAWING is done centrally in render.js.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG;

  // --- Particle: generic spark/dust/glow mote ------------------------------
  class Particle {
    constructor(x, y, opts = {}) {
      this.x = x; this.y = y;
      this.vx = opts.vx ?? (Math.random() - 0.5) * 120;
      this.vy = opts.vy ?? (Math.random() - 0.5) * 120;
      this.gravity = opts.gravity ?? 0;
      this.life = opts.life ?? 0.6;
      this.maxLife = this.life;
      this.size = opts.size ?? 3;
      this.color = opts.color ?? '#ffd27a';
      this.drag = opts.drag ?? 0.9;
      this.glow = opts.glow ?? false;
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += this.gravity * dt;
      this.vx *= Math.pow(this.drag, dt * 60);
      this.vy *= Math.pow(this.drag, dt * 60);
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
  }

  // --- Floating combat text (damage / xp / crit) ---------------------------
  class FloatText {
    constructor(x, y, text, opts = {}) {
      this.x = x; this.y = y;
      this.text = text;
      this.color = opts.color ?? '#ffe3b0';
      this.size = opts.size ?? 17;
      this.crit = opts.crit ?? false;
      this.vy = opts.vy ?? -52;
      this.vx = (Math.random() - 0.5) * 26;
      this.life = opts.life ?? 0.9;
      this.maxLife = this.life;
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += 60 * dt; // slight ease-up
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
  }

  // --- Arrow projectile -----------------------------------------------------
  class Projectile {
    constructor(x, y, target, damage, crit) {
      this.x = x; this.y = y;
      this.target = target;     // enemy reference (may die mid-flight)
      this.damage = damage;
      this.crit = crit;
      this.speed = C.ARENA.arrowSpeed;
      this.angle = 0;
      this.trail = [];
      this.dead = false;
      this.hit = false;
    }
    update(dt) {
      // re-aim toward target's current position (light homing for feel)
      let tx, ty;
      if (this.target && !this.target.dead) {
        tx = this.target.x; ty = this.target.y;
      } else {
        // target died — keep flying along last angle, expire soon
        tx = this.x + Math.cos(this.angle) * 100;
        ty = this.y + Math.sin(this.angle) * 100;
        this.life = (this.life ?? 0.3) - dt;
        if (this.life <= 0) this.dead = true;
      }
      const dx = tx - this.x, dy = ty - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      this.angle = Math.atan2(dy, dx);
      const step = this.speed * dt;

      // record trail point
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 5) this.trail.shift();

      if (this.target && !this.target.dead && dist <= step + this.target.size) {
        this.x = tx; this.y = ty;
        this.hit = true;
        this.dead = true;
        return;
      }
      this.x += Math.cos(this.angle) * step;
      this.y += Math.sin(this.angle) * step;
    }
  }

  // --- Enemy ----------------------------------------------------------------
  class Enemy {
    constructor(typeDef, dungeon, x, y) {
      this.type = typeDef;
      this.dungeon = dungeon;
      this.level = C.dungeonEnemyLevel(dungeon); // cosmetic display level
      this.x = x; this.y = y;
      this.maxHp = C.enemyHp(dungeon) * typeDef.hpMod;
      this.hp = this.maxHp;
      this.damage = C.enemyDamage(dungeon) * typeDef.dmgMod;
      this.speed = typeDef.spd;
      this.size = typeDef.size;
      this.tint = typeDef.tint;
      this.contactTimer = 0;
      this.hitFlash = 0;
      this.wobble = Math.random() * Math.PI * 2;
      this.walk = Math.random() * Math.PI * 2;  // limb animation phase
      this.dir = 1;            // facing: +1 right, -1 left
      this.moving = false;
      this.attackLunge = 0;    // 0..1 melee lunge animation
      this.seed = Math.random() * 1000; // per-enemy variation
      // RANGED GUNNERS — a seeded ~35% of vessels carry standoff guns: they
      // close to firing distance, hold there, and volley bolts at the player
      // (every boss is a gunner too — set via isBoss after construction).
      this.ranged = (this.seed % 10) < 3.5;
      this.range = 230;                              // ≈ the player's own 250
      this.holdAt = this.range * (0.55 + (this.seed % 1) * 0.25);
      this.fireT = 1.2 + (this.seed % 1.4);          // first shot is staggered
      this.fireCd = 2.0 + (this.seed % 1.2);
      this.fireReq = false;                          // game loop consumes this
      this.dying = false;
      this.deathT = 0;        // 0..1 death animation progress
      this.dead = false;      // fully removed
      this.spawnT = 0;        // 0..1 spawn-in animation
    }
    update(dt, archer) {
      this.spawnT = Math.min(1, this.spawnT + dt * 3.5);
      if (this.hitFlash > 0) this.hitFlash -= dt * 5;
      if (this.attackLunge > 0) this.attackLunge -= dt * 4;

      if (this.dying) {
        this.deathT += dt * 3.5;
        if (this.deathT >= 1) this.dead = true;
        return;
      }
      // move toward archer
      const dx = archer.x - this.x, dy = archer.y - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      this.wobble += dt * 8;
      this.dir = dx >= 0 ? 1 : -1;
      const reach = this.size + archer.size;
      const gunner = this.ranged || this.isBoss;
      const holdAt = gunner ? Math.max(reach + 6, this.isBoss ? this.range * 0.8 : this.holdAt) : reach;
      if (dist > holdAt) {
        const sp = this.speed * Math.min(1, this.spawnT * 1.5);
        this.x += (dx / dist) * sp * dt;
        this.y += (dy / dist) * sp * dt;
        this.walk += dt * sp * 0.16;   // walk cycle speed tied to movement
        this.moving = true;
        this.contactTimer = Math.max(0, this.contactTimer - dt);
      } else if (dist > reach) {
        // gunner on station — slow strafing orbit while the guns cycle
        const ta = Math.atan2(dy, dx) + Math.PI / 2;
        const drift = this.speed * 0.3 * ((this.seed % 2) < 1 ? 1 : -1);
        this.x += Math.cos(ta) * drift * dt;
        this.y += Math.sin(ta) * drift * dt;
        this.walk += dt * Math.abs(drift) * 0.16;
        this.moving = false;
        this.contactTimer = Math.max(0, this.contactTimer - dt);
      } else {
        this.moving = false;
        // in contact — deal damage on cooldown
        this.contactTimer -= dt;
        if (this.contactTimer <= 0) {
          this.contactTimer = C.ARENA.contactCooldown;
          this.attackLunge = 1; // trigger melee lunge animation
          archer.takeHit(this.damage, this);
        }
      }
      // standoff fire — request a bolt; the game loop spawns + draws it
      if (gunner && !archer.dead && this.spawnT >= 1 && dist <= this.range * 1.05) {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = this.isBoss ? 2.6 : this.fireCd;
          this.fireReq = true;
          this.attackLunge = 1;
        }
      }
    }
    takeDamage(amount) {
      this.hp -= amount;
      this.hitFlash = 1;
      if (this.hp <= 0 && !this.dying) {
        this.dying = true;
        return true; // signals death this frame
      }
      return false;
    }
  }

  // --- Archer (player) ------------------------------------------------------
  class Archer {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.size = 18;
      this.facing = 0;
      this.attackTimer = 0;
      this.muzzle = 0;       // 0..1 muzzle-flash / recoil animation
      this.recoil = 0;       // visual kick offset
      this.hp = 1; this.maxHp = 1;
      this.hurtFlash = 0;
      this.invuln = 0;       // brief i-frames (e.g. after reviving)
      this.dead = false;
      this.justDied = false; // consumed once per death by the game loop
      this.reviveT = 0;
      this.bob = 0;
    }
    takeHit(dmg, src) {
      if (this.dead || this.invuln > 0) return;
      // Warden aura damage reduction (set by game.js when stats refresh)
      if (this.dmgReduce > 0) dmg *= 1 - Math.min(0.6, this.dmgReduce / 100);
      // NO ONE-SHOTS: a single hit can never take more than 22% of max hull.
      // Sustained swarm pressure still kills — burst alone can't delete you.
      if (this.maxHp > 1) dmg = Math.min(dmg, this.maxHp * 0.22);
      this.hp = Math.max(0, this.hp - dmg);
      this.hurtFlash = 1;
      if (this.hp <= 0) { this.dead = true; this.justDied = true; this.killer = src || null; }
    }
    update(dt) {
      this.bob += dt * 3;
      if (this.hurtFlash > 0) this.hurtFlash -= dt * 4;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.muzzle > 0) this.muzzle -= dt * 9;
      if (this.recoil > 0) this.recoil -= dt * 12;
      // NOTE: no auto-revive — the player must manually choose a zone to respawn.
    }
  }

  // --- Ground loot drop (must be walked over to collect) -------------------
  class GroundItem {
    constructor(x, y, item, lost) {
      this.x = x; this.y = y;
      this.item = item;       // the loot (null allowed for "lost" markers)
      this.lost = !!lost;     // a death-dropped item: cannot be picked up
      this.bob = Math.random() * Math.PI * 2;
      this.t = 0;
      this.life = lost ? 4 : 60;  // lost markers fade fast; loot lingers
      this.picked = false;
      this.dead = false;
      this.spawnT = 0;
    }
    update(dt) {
      this.t += dt;
      this.bob += dt * 3;
      this.spawnT = Math.min(1, this.spawnT + dt * 4);
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
  }

  window.ENTITIES = { Particle, FloatText, Projectile, Enemy, Archer, GroundItem };
})();
