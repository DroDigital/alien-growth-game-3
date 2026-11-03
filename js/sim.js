// Local real-time simulation shared by close, fleet and system camera scales.
import { v3, clamp, damp, angleWrap, TAU } from './math.js';
import { makeFighter, subOff, rankOf } from './entities.js';

export class World {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.env = def.env;
    this.bodies = def.bodies || [];
    this.civ = def.civ || null;
    this.entities = [];
    this.projectiles = [];
    this.particles = [];
    this.beams = [];
    this.timers = [];
    this.byId = new Map();
    this.t = 0;
    this.script = null;
    this.hazards = def.hazards || [];
    this.storms = def.storms || [];
    this.lastCombat = -99;
  }

  add(e) {
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }
  get(id) {
    const e = this.byId.get(id);
    return e && !e.dead ? e : null;
  }
  remove(e) {
    e.dead = true;
    e.removed = true;
  }

  hostile(a, b) {
    if (a.team === b.team) return false;
    if (a.team === 'neutral' || b.team === 'neutral') return false;
    if (a.team === 'raider' || b.team === 'raider') return true;
    if (this.civ && ((a.team === 'civ' && b.team === 'player') || (a.team === 'player' && b.team === 'civ'))) {
      return !!this.civ.state.hostile;
    }
    return false;
  }

  combatants() {
    return this.entities.filter((e) => !e.dead && (e.kind === 'ship' || e.kind === 'station' || e.kind === 'node'));
  }

  nearestHostile(e, range, filter) {
    let best = null, bd = range;
    for (const o of this._cmb) {
      if (o === e || o.dead || !this.hostile(e, o)) continue;
      if (filter && !filter(o)) continue;
      const d = v3.dist(e.pos, o.pos) - o.radius * 0.5;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  update(dt) {
    this.t += dt;
    this._cmb = this.combatants();
    for (const e of this._cmb) {
      e.inStorm = this.storms.some((s) => v3.dist(e.pos, s.pos) < s.r);
      if (e.hotT > 0) e.hotT -= dt;
      if (e.overT > 0) e.overT -= dt;
      if (e.braceT > 0) e.braceT -= dt;
      if (e.jamT > 0) e.jamT -= dt;
    }
    // Aura effects (keystones, electronic warfare, networks) computed once per frame.
    this.computeAuras();
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e.kind === 'ship') this.updateShip(e, dt);
      if (e.kind === 'ship' || e.kind === 'station' || e.kind === 'node') this.updateCombat(e, dt);
      this.updateFx(e, dt);
    }
    this.updateProjectiles(dt);
    this.updateParticles(dt);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const t of this.timers) {
      t.t -= dt;
      if (t.t <= 0) t.fn();
    }
    this.timers = this.timers.filter((t) => t.t > 0);
    if (this.script && this.script.update) this.script.update(dt);
    this.updateHazards(dt);
    if (this.entities.some((e) => e.dead)) {
      for (const e of this.entities) if (e.dead) this.byId.delete(e.id);
      this.entities = this.entities.filter((e) => !e.dead);
    }
  }

  after(t, fn) {
    this.timers.push({ t, fn });
  }

  computeAuras() {
    for (const e of this._cmb) {
      e.auraShield = 1;
      e.auraDmgTaken = 1;
      e.auraDmg = 1;
      e.auraRate = 1;
    }
    for (const k of this._cmb) {
      if (k.keystone && !k.dead && !subOff(k, 'command')) {
        // An Array flagship's electronic warfare suppresses a synthetic archive's network.
        const jammed = k.keystone === 'archive' && this._cmb.some((p) => p.team === 'player' && p.style === 'array' && p.role === 'flagship' && v3.dist(p.pos, k.pos) < 300);
        k.jammed = jammed;
        for (const o of this._cmb) {
          if (o.team !== k.team || v3.dist(o.pos, k.pos) > 380) continue;
          if (k.keystone === 'conductor') {
            o.auraShield = 2.5;
            o.auraDmgTaken = 0.72;
          } else if (k.keystone === 'archive' && !jammed) o.auraDmg = 1.35;
        }
      }
      if (k.team === 'player' && k.style === 'array' && k.role === 'flagship') {
        for (const o of this._cmb) if (this.hostile(k, o) && v3.dist(o.pos, k.pos) < 280) o.auraRate = 0.8;
      }
    }
    // Array network: damage bonus per nearby Array ship — but only with a live command link.
    const link = this._cmb.find((p) => p.team === 'player' && p.style === 'array' && p.role === 'flagship' && !p.ally && !subOff(p, 'command'));
    for (const e of this._cmb) {
      if (e.team === 'player') {
        if (e.overT > 0) e.auraRate *= 1.45;
        if (e.braceT > 0) e.auraDmgTaken *= 0.7;
      }
      if (e.style !== 'array' || e.team !== 'player' || e.kind !== 'ship' || e.isFighter) continue;
      e.linked = !!link && v3.dist(link.pos, e.pos) < 650;
      if (!e.linked) {
        e.network = 0;
        e.auraRate *= 0.9;
        continue;
      }
      let n = 0;
      for (const o of this._cmb) if (o !== e && o.style === 'array' && o.team === 'player' && o.kind === 'ship' && !o.isFighter && v3.dist(o.pos, e.pos) < 260) n++;
      e.auraDmg *= 1 + Math.min(4, n) * 0.08;
      e.network = n;
    }
    if (this.civ && this.civ.state.brokenKeystone === 'archive') {
      for (const o of this._cmb) if (o.team === 'civ') o.auraDmg *= 0.75;
    }
  }

  // ---------------- Movement & orders ----------------
  updateShip(e, dt) {
    if (e.warpIn > 0) {
      e.warpIn = Math.max(0, e.warpIn - dt * 0.8);
      const f = v3.norm(e.warpDir || [0, 0, 1]);
      e.pos = v3.add(e.pos, v3.scale(f, e.warpIn * e.warpIn * 900 * dt));
      return;
    }
    if (e.jumping) {
      e.jumpT += dt;
      return;
    }
    e.slowT -= dt;
    const adrift = subOff(e, 'engines');
    e.engineDamaged = !e.isFighter && (adrift || e.hull < e.maxHull * 0.35);
    const maxSpeed = e.baseSpeed * (adrift ? 0.08 : e.engineDamaged ? 0.5 : 1) * (e.slowT > 0 ? 0.55 : 1) * (e.speedMul || 1);
    if (e.isFighter) return this.updateFighter(e, dt, maxSpeed);
    if (e.team !== 'player' || e.ally) this.ai(e, dt);
    else this.playerIdle(e);

    let goal = null;
    let arriveR = 4;
    const o = e.order;
    if (o) {
      if (o.type === 'move') {
        goal = o.pos;
        if (v3.distXZ(e.pos, o.pos) < 6 + e.radius * 0.2) {
          e.order = null;
          e.anchor = [...e.pos];
        }
      } else if (o.type === 'attack') {
        const t = this.get(o.id);
        if (!t || !this.canTarget(e, t)) {
          e.order = null;
          e.anchor = [...e.pos];
        } else {
          const range = this.maxRange(e) * 0.72 + t.radius * 0.4;
          const d = v3.distXZ(e.pos, t.pos);
          if (o.leash && e.anchor && v3.distXZ(e.pos, e.anchor) > o.leash) {
            goal = e.anchor;
            if (v3.distXZ(e.pos, e.anchor) < 20) e.order = null;
          } else if (d > range) goal = t.pos;
          else {
            // Circle the target at engagement range, keeping firing lanes open.
            const ang = Math.atan2(e.pos[0] - t.pos[0], e.pos[2] - t.pos[2]) + 0.35 * (e.id % 2 ? 1 : -1);
            goal = [t.pos[0] + Math.sin(ang) * range * 0.95, t.pos[1] + (e.id % 3 - 1) * 10, t.pos[2] + Math.cos(ang) * range * 0.95];
          }
          e.focus = t.id;
        }
      } else if (o.type === 'scan') {
        const t = this.get(o.id) || this.entities.find((x) => x.id === o.id && !x.dead);
        if (!t || !t.scan || t.scan.done) {
          e.order = null;
          e.scanning = null;
        } else {
          const range = 120 + t.radius;
          const d = v3.dist(e.pos, t.pos);
          if (d > range) {
            goal = t.pos;
            e.scanning = null;
          } else {
            e.scanning = t.id;
            this.game.scanTick(t, e, dt);
          }
        }
      } else if (o.type === 'follow') {
        const l = this.get(o.id);
        if (!l) e.order = null;
        else {
          const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
          goal = [l.pos[0] + o.off[0] * c + o.off[2] * s, l.pos[1] + o.off[1], l.pos[2] - o.off[0] * s + o.off[2] * c];
        }
      } else if (o.type === 'patrol') {
        o.a = (o.a || 0) + dt * (maxSpeed / Math.max(50, o.r)) * 0.6;
        goal = [o.c[0] + Math.cos(o.a) * o.r, o.c[1] + Math.sin(o.a * 0.7) * 15, o.c[2] + Math.sin(o.a) * o.r];
      } else if (o.type === 'path') {
        goal = o.pts[o.i];
        if (v3.distXZ(e.pos, goal) < 30) {
          o.i++;
          if (o.i >= o.pts.length) {
            e.order = null;
            if (o.done) o.done(e);
          }
        }
      } else if (o.type === 'hold') {
        goal = o.pos;
      } else if (o.type === 'board') {
        const t = this.get(o.id);
        if (!t || t.team === e.team || !this.boardable(t)) {
          e.order = null;
          e.boarding = null;
          if (t) t.boardHold = false;
        } else {
          t.boardHold = true;
          const d = v3.dist(e.pos, t.pos);
          if (d > t.radius + 45) {
            goal = t.pos;
            e.boarding = null;
          } else {
            goal = v3.add(t.pos, [Math.sin(e.id) * t.radius * 0.6, 4, Math.cos(e.id) * t.radius * 0.6]);
            e.boarding = t.id;
            t.boardP = (t.boardP || 0) + dt * (e.role === 'boarder' ? 1 : 0.45) / (t.role === 'keystone' ? 14 : 8);
            if (Math.random() < dt * 8) this.puff(v3.lerp(e.pos, t.pos, Math.random()), 2, e.style === 'bloom' ? [0.5, 1, 0.6] : [1, 0.8, 0.4]);
            if (t.boardP >= 1) {
              e.order = null;
              e.boarding = null;
              this.capture(t, e);
            }
          }
        }
      } else if (o.type === 'flee') {
        goal = o.pos;
        if (v3.distXZ(e.pos, o.pos) < 60) {
          this.warpOut(e);
          return;
        }
      }
    }
    this.steer(e, goal, maxSpeed, dt, arriveR);
  }

  playerIdle(e) {
    if (e.immobile) return;
    if (!e.order) {
      if (!e.anchor) e.anchor = [...e.pos];
      // Defensive stance: engage threats that come close, without chasing far.
      const h = this.nearestHostile(e, this.maxRange(e) + 120, (o) => !o.broken && !o.boardHold);
      if (h) e.order = { type: 'attack', id: h.id, leash: 420, auto: true };
    }
  }

  ai(e, dt) {
    if (e.order && !e.order.auto) return;
    e.aiT = (e.aiT || 0) - dt;
    if (e.aiT > 0) return;
    e.aiT = 0.5 + Math.random() * 0.4;
    const homeP = e.home || e.pos;
    if (e.team === 'raider') {
      const range = e.garrison ? 900 : 2600;
      const pref = this.nearestHostile(e, range, (o) => o.convoy);
      const t = pref || this.nearestHostile(e, range);
      if (t) e.order = { type: 'attack', id: t.id, auto: true };
      else if (!e.order) e.order = { type: 'patrol', c: homeP, r: 120, auto: true };
      return;
    }
    if (e.ally) {
      // Allied vessels guard the player's flagship.
      const h = this.nearestHostile(e, 500);
      if (h) e.order = { type: 'attack', id: h.id, auto: true };
      else {
        const lead = this.entities.find((x) => x.team === 'player' && x.role === 'flagship' && !x.dead && !x.ally);
        if (lead) e.order = { type: 'follow', id: lead.id, off: [60, 10, -40], auto: true };
      }
      return;
    }
    if (e.team === 'civ') {
      if (e.role === 'convoy') return;
      const st = this.civ && this.civ.state;
      if (e.waveTarget) {
        const t = this.get(e.waveTarget);
        if (t) {
          e.order = { type: 'attack', id: t.id, auto: true };
          return;
        }
      }
      const h = this.nearestHostile(e, st && st.hostile ? 1400 : 700, (o) => v3.dist(o.pos, homeP) < 1500);
      if (h) e.order = { type: 'attack', id: h.id, auto: true };
      else if (!e.order || e.order.type !== 'patrol') e.order = { type: 'patrol', c: homeP, r: e.patrolR || 180, a: Math.random() * TAU, auto: true };
    }
  }

  updateFighter(e, dt, maxSpeed) {
    const host = this.get(e.host);
    e.life -= dt;
    let target = null;
    if (host) {
      const f = host.focus && this.get(host.focus);
      if (f && this.hostile(e, f) && v3.dist(f.pos, host.pos) < 700) target = f;
      if (!target) target = this.nearestHostile(host, 600);
    } else target = this.nearestHostile(e, 500);
    let goal;
    if (target) {
      e.idleT = 0;
      e.focus = target.id;
      const a = this.t * 1.6 + e.id;
      const r = target.radius + 25;
      goal = [target.pos[0] + Math.cos(a) * r, target.pos[1] + Math.sin(a * 1.3) * 12, target.pos[2] + Math.sin(a) * r];
    } else if (host) {
      e.idleT = (e.idleT || 0) + dt;
      goal = host.pos;
      if (e.idleT > 4 && v3.dist(e.pos, host.pos) < host.radius + 10) {
        // Recovered into the hangar.
        e.dead = true;
        return;
      }
    } else {
      e.life -= dt * 3;
    }
    if (e.life <= 0) {
      this.kill(e, null, true);
      return;
    }
    this.steer(e, goal, maxSpeed, dt, 2);
  }

  steer(e, goal, maxSpeed, dt) {
    let desiredYaw = e.yaw, desiredSpeed = 0;
    if (goal) {
      const dx = goal[0] - e.pos[0], dz = goal[2] - e.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > 1.5) {
        desiredYaw = Math.atan2(dx, dz);
        desiredSpeed = Math.min(maxSpeed, d * 0.5 + 2);
      }
      e.targetY = goal[1];
    }
    // Automatic separation keeps formations readable.
    let sx = 0, sz = 0, sy = 0;
    if (!e.isFighter) {
      for (const o of this._cmb) {
        if (o === e || o.isFighter) continue;
        const dx = e.pos[0] - o.pos[0], dz = e.pos[2] - o.pos[2], dy = e.pos[1] - o.pos[1];
        const min = (e.radius + o.radius) * 0.75;
        const d2 = dx * dx + dz * dz + dy * dy;
        if (d2 < min * min && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / min) * (o.immobile ? 60 : 30);
          sx += (dx / d) * push;
          sz += (dz / d) * push;
          sy += (dy / d) * push * 0.3;
        }
      }
    }
    const dyaw = angleWrap(desiredYaw - e.yaw);
    const maxTurn = e.turn * dt;
    const turn = clamp(dyaw, -maxTurn, maxTurn);
    e.yaw = angleWrap(e.yaw + turn);
    e.roll = damp(e.roll, -clamp(turn / Math.max(dt, 1e-4) / e.turn, -1, 1) * (e.isFighter ? 0.8 : 0.3), 3, dt);
    const facing = Math.cos(dyaw);
    const spd = desiredSpeed * clamp(facing, 0.2, 1);
    e.speedNow = damp(e.speedNow, spd, e.isFighter ? 4 : 1.2, dt);
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    e.pos[0] += (fx * e.speedNow + sx) * dt;
    e.pos[2] += (fz * e.speedNow + sz) * dt;
    const vy = clamp((e.targetY - e.pos[1]) * 0.6, -maxSpeed * 0.5, maxSpeed * 0.5) + sy;
    e.pos[1] += vy * dt;
    e.pitch = damp(e.pitch, -clamp(vy / Math.max(1, maxSpeed), -0.5, 0.5) * 0.6, 3, dt);
  }

  canTarget(e, t) {
    return this.hostile(e, t) && !t.invulnerable;
  }

  maxRange(e) {
    let r = 0;
    for (const w of e.weapons) r = Math.max(r, w.range);
    return r || 150;
  }

  // ---------------- Combat ----------------
  updateCombat(e, dt) {
    if (e.warpIn > 0 || e.jumping) return;
    // Regeneration
    const sinceHit = this.t - e.lastHit;
    const shieldsDown = subOff(e, 'shields');
    if (shieldsDown) e.shield = 0;
    else if (sinceHit > 3 && e.shield < e.maxShield && !e.inStorm) e.shield = Math.min(e.maxShield, e.shield + e.shieldRegen * e.auraShield * dt);
    if (e.hull < e.maxHull) {
      let rate = sinceHit > 6 ? Math.max(e.regenHull || 0, e.regenHullIdle || 0) : e.regenHull || 0;
      if (e.hotT > 0) rate += 0.05;
      // The Bloom's weakness: living regeneration consumes biological reserves.
      if (e.style === 'bloom' && e.team === 'player' && rate > 0) {
        if (this.game.reserves <= 0 && !(e.hotT > 0)) rate = 0;
        else this.game.reserves = Math.max(0, this.game.reserves - rate * e.maxHull * dt * 0.004);
      }
      e.hull = Math.min(e.maxHull, e.hull + rate * e.maxHull * dt);
    }
    if (e.subs && sinceHit > 8) {
      for (const k in e.subs) {
        const sb = e.subs[k];
        if (sb.hp < sb.max) sb.hp = Math.min(sb.max, sb.hp + sb.max * (e.style === 'bloom' ? 0.03 : 0.015) * dt);
      }
    }
    if (e.dot.length) {
      for (const d of e.dot) {
        d.t -= dt;
        this.applyDamage(e, d.dps * dt, null, true);
      }
      e.dot = e.dot.filter((d) => d.t > 0);
      if (e.dead) return;
    }
    if (e.repairAura) {
      for (const o of this._cmb) {
        if (o.team === e.team && o !== e && v3.dist(o.pos, e.pos) < e.repairAura + e.radius) {
          o.hull = Math.min(o.maxHull, o.hull + o.maxHull * 0.03 * dt);
          o.shield = Math.min(o.maxShield, o.shield + o.maxShield * 0.05 * dt);
        }
      }
    }
    if (e.repairRate) {
      e.repT = (e.repT || 0) - dt;
      let best = null, bh = 0.98;
      for (const o of this._cmb) {
        if (o.team !== e.team || o === e || o.kind !== 'ship') continue;
        if (v3.dist(o.pos, e.pos) > 170) continue;
        const h = o.hull / o.maxHull;
        if (h < bh) {
          bh = h;
          best = o;
        }
      }
      if (best) {
        best.hull = Math.min(best.maxHull, best.hull + e.repairRate * dt);
        if (e.repT <= 0) {
          e.repT = 0.35;
          this.beams.push({ a: e.id, b: best.id, life: 0.3, max: 0.3, width: 0.8, col: [0.4, 1.0, 0.6] });
        }
      }
    }
    // Carriers and swarm drones
    const maxCraft = (e.visual && e.visual.hangars ? 6 : 0) + (e.droneCount || 0);
    if (maxCraft && e.team !== 'neutral') {
      e.fighters = (e.fighters || []).filter((id) => this.get(id));
      e.launchT = (e.launchT || 0) - dt;
      if (e.launchT <= 0 && e.fighters.length < maxCraft && this.nearestHostile(e, 650)) {
        e.launchT = 1.6;
        const f = makeFighter(this.game.R, e, e.style, e.pal);
        const side = e.fighters.length % 2 ? 1 : -1;
        const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
        const lx = side * e.radius * 0.35;
        f.pos = [e.pos[0] + lx * c, e.pos[1], e.pos[2] - lx * s];
        f.yaw = e.yaw + side * 1.2;
        f.speedNow = 40;
        this.add(f);
        e.fighters.push(f.id);
        this.puff(f.pos, 3, e.visual.glowCol || [1, 0.8, 0.5]);
      }
    }
    if (!e.weapons.length || e.broken || subOff(e, 'weapons') || e.jamT > 0) return;
    if (e.team === 'civ' && !(this.civ && this.civ.state.hostile) && !this.nearestHostile(e, 400)) return;
    for (const w of e.weapons) {
      w.t -= dt * e.auraRate;
      if (w.t > 0) continue;
      const t = this.pickTarget(e, w);
      if (!t) {
        w.t = 0.25;
        continue;
      }
      w.t = w.cd * (0.9 + Math.random() * 0.2);
      this.fire(e, w, t);
    }
  }

  pickTarget(e, w) {
    const range = w.range * (e.inStorm ? 0.7 : 1);
    const inRange = (t) => t && !t.dead && this.hostile(e, t) && !t.invulnerable && v3.dist(e.pos, t.pos) - t.radius * 0.6 < range;
    const ordered = e.order && e.order.type === 'attack' ? this.get(e.order.id) : null;
    if (ordered && inRange(ordered) && !(ordered.boardHold && e.order.auto)) return ordered;
    const focus = e.focus ? this.get(e.focus) : null;
    if (focus && inRange(focus) && !focus.broken && !focus.boardHold) return focus;
    const tags = w.tags || [];
    let best = null, bs = -1e9;
    for (const o of this._cmb) {
      if (!inRange(o)) continue;
      if ((o.broken || o.boardHold) && !(ordered && ordered.id === o.id && !e.order.auto)) continue;
      const d = v3.dist(e.pos, o.pos);
      let s = -d;
      if (tags.includes('flak') && o.isFighter) s += 300;
      if (tags.includes('heavy') && o.isFighter) s -= 300;
      if (o.convoy) s += 120;
      if (o.kind === 'node') s += 200;
      if (s > bs) {
        bs = s;
        best = o;
      }
    }
    return best;
  }

  hardpoint(e) {
    const r = e.radius * 0.4;
    return [e.pos[0] + (Math.random() - 0.5) * r, e.pos[1] + (Math.random() - 0.3) * r * 0.5, e.pos[2] + (Math.random() - 0.5) * r];
  }

  fire(e, w, t) {
    const from = this.hardpoint(e);
    if (e.team === 'player' || t.team === 'player') this.lastCombat = this.t;
    if (this.game.onEvent) this.game.onEvent('fire', { e, w });
    if (w.kind === 'beam') {
      const to = this.hardpoint(t);
      this.beams.push({ a: from, b: to, aId: e.id, bId: t.id, life: 0.22, max: 0.22, width: w.width || 1, col: w.color });
      this.hit(t, w, e, to);
    } else {
      const lead = v3.add(t.pos, v3.scale(t.vel || [0, 0, 0], 0));
      const fx = Math.sin(t.yaw) * t.speedNow, fz = Math.cos(t.yaw) * t.speedNow;
      const d = v3.dist(from, lead);
      const tt = d / w.speed;
      const aim = [lead[0] + fx * tt, lead[1], lead[2] + fz * tt];
      const dir = v3.norm(v3.sub(aim, from));
      this.projectiles.push({ pos: from, vel: v3.scale(dir, w.speed), w, src: e.id, team: e.team, target: t.id, life: (w.range / w.speed) * 1.4, srcEnt: e });
    }
  }

  hit(t, w, src, at) {
    let dmg = w.dmg * (src ? src.auraDmg * (src.dmgMul || 1) : 1);
    const tags = w.tags || [];
    if (tags.includes('flak') && t.isFighter) dmg *= 2.2;
    if (tags.includes('heavy') && t.isFighter) dmg *= 0.35;
    if (tags.includes('heavy') && (t.kind === 'station' || t.role === 'flagship' || t.role === 'keystone')) dmg *= 1.25;
    if (src && src.team === 'player' && this.game.expedition) dmg *= this.game.expedition.objective === 'strike' ? 1.12 : 1;
    if (w.kind === 'spore') {
      if (t.engineDamaged) dmg *= 1.6;
      // Boarding organisms: up to three infestations at once; new ones refresh the oldest.
      if (w.dot) {
        if (t.dot.length >= 3) t.dot.shift();
        t.dot.push({ dps: w.dot * (t.engineDamaged ? 2 : 1), t: 5 });
      }
    }
    if (w.slow) t.slowT = w.slow;
    dmg *= t.auraDmgTaken || 1;
    this.applyDamage(t, dmg, src, false, at);
  }

  applyDamage(t, dmg, src, silent, at) {
    if (t.invulnerable || t.dead || t.warpIn > 0) return;
    if (!silent) t.lastHit = this.t;
    if (t.shield > 0) {
      const ab = Math.min(t.shield, dmg);
      t.shield -= ab;
      dmg -= ab;
      if (!silent) {
        t.fx.shield = 1;
        t.fx.shieldAt = at || null;
      }
      if (t.shield <= 0.5 && t.maxShield >= 400) {
        t.fx.shieldBreak = 1;
        this.onShieldBreak(t);
      }
    }
    if (dmg > 0) {
      if (!silent) dmg = Math.max(dmg - t.armor, dmg * 0.3);
      if (t.subs && !silent) {
        // Focused fire strips a chosen subsystem; stray hits occasionally damage one at random.
        const focused = src && src.subFocus && src.focus === t.id && t.subs[src.subFocus] ? src.subFocus : null;
        const key = focused || (Math.random() < 0.18 ? Object.keys(t.subs)[Math.floor(Math.random() * Object.keys(t.subs).length)] : null);
        if (key && t.subs[key].hp > 0) {
          t.subs[key].hp -= dmg * (focused ? 0.75 * (this.game.research && this.game.research.subsys ? 1.4 : 1) : 0.35);
          if (t.subs[key].hp <= 0) this.onSubDisabled(t, key, src);
          if (focused) dmg *= 0.6;
        }
      }
      t.hull -= dmg;
      if (!silent) t.fx.hit = 1;
      if (t.kind === 'station' && t.team === 'civ' && !t.broken && t.hull < t.maxHull * 0.25) {
        t.broken = true;
        t.shield = 0;
        t.maxShieldSaved = t.maxShield;
        t.maxShield = 0;
        if (this.script && this.script.onBroken) this.script.onBroken(t);
      }
      if (t.hull <= 0) this.kill(t, src);
    }
  }

  boardable(t) {
    return t.kind === 'ship' && !t.isFighter && !t.dead && (subOff(t, 'engines') || t.hull < t.maxHull * 0.3);
  }

  capture(t, by) {
    t.team = by.team;
    t.selectable = true;
    t.captured = true;
    t.ally = false;
    t.order = null;
    t.waveTarget = null;
    t.boardP = 0;
    t.boardHold = false;
    t.dot = [];
    t.tint = [0.8, 1.0, 0.85];
    t.name = `Captured ${t.cls}`;
    t.slots = t.slots || 1;
    if (t.subs && t.subs.engines) t.subs.engines.hp = t.subs.engines.max * 0.3;
    this.particles.push({ pos: [...t.pos], vel: [0, 0, 0], life: 1, max: 1, size: t.radius, grow: t.radius * 2, col: [0.5, 1, 0.6], mode: 2 });
    if (this.script && this.script.onCapture) this.script.onCapture(t, by);
    if (this.game.onCapture) this.game.onCapture(t, by, this);
  }

  onSubDisabled(t, key, src) {
    this.particles.push({ pos: this.hardpoint(t), vel: [0, 0, 0], life: 0.6, max: 0.6, size: t.radius * 0.5, grow: t.radius, col: [1, 0.6, 0.3], mode: 0 });
    if (key === 'shields') t.shield = 0;
    if (this.game.onEvent) this.game.onEvent('subsystem', { t, key, src });
  }

  onShieldBreak(t) {
    // A few deliberate shield failures carry the scale; ordinary hits stay readable.
    const c = t.style === 'bloom' ? [0.6, 1, 0.8] : t.visual?.glowCol || [0.6, 0.8, 1];
    this.particles.push({ pos: [...t.pos], vel: [0, 0, 0], life: 0.9, max: 0.9, size: t.radius * 1.3, grow: t.radius * 1.4, col: c, mode: 2 });
    if (t.style === 'bloom') {
      // Organic ships shed damaged shell.
      for (let i = 0; i < 10; i++) {
        const d = v3.norm([Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5]);
        this.particles.push({ pos: [...t.pos], vel: v3.scale(d, 12 + Math.random() * 18), life: 3, max: 3, size: 2 + Math.random() * 2, col: [0.45, 0.3, 0.5], mode: 3, drag: 0.4 });
      }
    }
    if (this.game.onEvent) this.game.onEvent('shieldBreak', t);
  }

  kill(e, src, quiet) {
    if (e.dead) return;
    e.dead = true;
    e.hull = 0;
    if (src && src.team === 'player' && !src.dead && src.kind === 'ship' && e.kind !== 'wreck') {
      const gain = e.isFighter ? 0.3 : e.radius > 18 || e.kind === 'station' ? 4 : 1.5;
      const before = src.rank || 0;
      src.xp = (src.xp || 0) + gain;
      src.rank = rankOf(src.xp);
      if (src.style === 'ascendancy' && src.rank > before) {
        src.dmgMul = 1 + 0.08 * src.rank;
        if (this.game.log) this.game.log(`${src.name} crew promoted to rank ${src.rank} ${'★'.repeat(src.rank)}`, 'good');
      }
      if (this.game.faction === 'bloom' && !e.isFighter) this.game.reserves = Math.min(100, (this.game.reserves || 0) + 4);
    }
    const big = e.radius > 18 || e.kind === 'station';
    const c = e.visual?.glowCol || [1, 0.7, 0.4];
    if (!quiet) this.explode(e.pos, e.radius, c, big);
    if (big && !quiet) {
      // Capital deaths unfold in stages.
      for (let i = 1; i <= 4; i++) {
        this.after(i * 0.35, () => this.explode(v3.add(e.pos, [(Math.random() - 0.5) * e.radius, (Math.random() - 0.5) * e.radius * 0.4, (Math.random() - 0.5) * e.radius]), e.radius * 0.6, c, false));
      }
    }
    if (this.script && this.script.onKill) this.script.onKill(e, src);
    if (this.game.onKill) this.game.onKill(e, src, this);
  }

  warpOut(e) {
    this.particles.push({ pos: [...e.pos], vel: [0, 0, 0], life: 0.6, max: 0.6, size: e.radius * 2, grow: -e.radius, col: [0.8, 0.9, 1], mode: 0 });
    e.dead = true;
    e.warpedOut = true;
    if (this.script && this.script.onWarpOut) this.script.onWarpOut(e);
  }

  explode(p, r, c, big) {
    const s = Math.max(4, r);
    this.particles.push({ pos: [...p], vel: [0, 0, 0], life: 0.5, max: 0.5, size: s * 1.6, grow: s * 3, col: [1, 0.95, 0.85], mode: 0 });
    this.particles.push({ pos: [...p], vel: [0, 0, 0], life: 1.2, max: 1.2, size: s * 1.2, grow: s * 2, col: [1, 0.5, 0.15], mode: 0 });
    if (big) this.particles.push({ pos: [...p], vel: [0, 0, 0], life: 1.4, max: 1.4, size: s, grow: s * 6, col: c, mode: 2 });
    const n = big ? 40 : 14;
    for (let i = 0; i < n; i++) {
      const d = v3.norm([Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5]);
      const sp = s * (1 + Math.random() * 3);
      this.particles.push({ pos: [...p], vel: v3.scale(d, sp), life: 0.6 + Math.random() * 1.4, max: 2, size: 1 + Math.random() * s * 0.15, col: Math.random() < 0.5 ? [1, 0.7, 0.3] : c, mode: 0, drag: 0.8 });
    }
    for (let i = 0; i < (big ? 12 : 4); i++) {
      const d = v3.norm([Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5]);
      this.particles.push({ pos: [...p], vel: v3.scale(d, s * (0.3 + Math.random())), life: 4, max: 4, size: 1 + Math.random() * 2, col: [0.4, 0.35, 0.32], mode: 3, drag: 0.2 });
    }
    if (this.game.onEvent) this.game.onEvent('explosion', { p, r, big });
  }

  puff(p, s, c) {
    this.particles.push({ pos: [...p], vel: [0, 0, 0], life: 0.4, max: 0.4, size: s, grow: s * 3, col: c, mode: 0 });
  }

  updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      pr.life -= dt;
      const t = this.get(pr.target);
      if (t && (pr.w.kind === 'spore' || pr.w.kind === 'missile')) {
        // Spores drift toward their prey.
        const want = v3.scale(v3.norm(v3.sub(t.pos, pr.pos)), pr.w.speed);
        pr.vel = v3.lerp(pr.vel, want, Math.min(1, dt * 2));
      }
      pr.pos = v3.add(pr.pos, v3.scale(pr.vel, dt));
      if (t && v3.dist(pr.pos, t.pos) < t.radius * 0.75 + 2) {
        this.hit(t, pr.w, pr.srcEnt && !pr.srcEnt.dead ? pr.srcEnt : { auraDmg: 1, team: pr.team }, pr.pos);
        this.puff(pr.pos, pr.w.size * 2, pr.w.color);
        pr.life = 0;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vel[0] *= k;
        p.vel[1] *= k;
        p.vel[2] *= k;
      }
      if (p.grow) p.size += p.grow * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.size > 0);
    if (this.particles.length > 3000) this.particles.splice(0, this.particles.length - 3000);
  }

  updateFx(e, dt) {
    const f = e.fx;
    f.hit = Math.max(0, f.hit - dt * 6);
    f.shield = Math.max(0, f.shield - dt * 3);
    f.shieldBreak = Math.max(0, f.shieldBreak - dt);
    // Crippled ships vent smoke and limp.
    if (e.kind === 'ship' && e.engineDamaged && Math.random() < dt * 6) {
      this.particles.push({ pos: this.hardpoint(e), vel: [(Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4], life: 2, max: 2, size: e.radius * 0.15, grow: e.radius * 0.2, col: [0.25, 0.2, 0.18], mode: 0 });
      if (Math.random() < 0.3) this.particles.push({ pos: this.hardpoint(e), vel: [0, 0, 0], life: 0.2, max: 0.2, size: e.radius * 0.12, col: [1, 0.6, 0.2], mode: 0 });
    }
  }

  updateHazards(dt) {
    for (const h of this.hazards) {
      if (h.type === 'pulsar') {
        h.a = (h.a || 0) + dt * 0.35;
        // The sweep drains shields of anything it crosses.
        for (const e of this._cmb) {
          if (e.kind !== 'ship') continue;
          const d = v3.sub(e.pos, h.pos);
          const ang = Math.atan2(d[0], d[2]);
          const diff = Math.abs(angleWrap(ang - h.a));
          const diff2 = Math.abs(angleWrap(ang - h.a - Math.PI));
          if (Math.min(diff, diff2) < 0.05 && v3.len(d) < 3500) {
            e.shield = Math.max(0, e.shield - e.maxShield * 0.6 * dt);
            e.fx.shield = Math.max(e.fx.shield, 0.4);
          }
        }
      }
    }
  }
}
