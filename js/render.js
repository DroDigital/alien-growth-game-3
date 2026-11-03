// Draws a World: celestial bodies, entities with animated parts, and the additive FX layer.
// Also draws the 2D overlay (health bars, tactical icons, labels, order lines).
import { m4, v3, col, clamp, TAU } from './math.js';
import { partMatrix } from './designs.js';

const SEL = [0.45, 1.0, 0.6];
const TEAM_COL = { player: [0.45, 1.0, 0.6], civ: [1.0, 0.85, 0.35], raider: [1.0, 0.3, 0.25], neutral: [0.75, 0.8, 0.9] };

export function bodyPos(b, t) {
  if (b.orbit) {
    const a = t * b.orbit.speed + b.orbit.phase;
    return [b.orbit.c[0] + Math.cos(a) * b.orbit.r, b.orbit.c[1], b.orbit.c[2] + Math.sin(a) * b.orbit.r];
  }
  return b.pos;
}

function drawVisual(R, visual, model, t, opt, lod) {
  const parts = lod ? visual.parts.slice(0, 1) : visual.parts;
  for (const p of parts) R.draw(p.mesh, p.anim ? m4.mul(model, partMatrix(p, t)) : m4.mul(model, p.base), opt);
}

export function renderWorld(game, world, cam, R, viewH) {
  const t = world.t;
  const eye = cam.apply(R);
  // The primary star drives lighting; binaries use the brighter one.
  const stars = world.bodies.filter((b) => b.type === 'star');
  if (stars.length) world.env.starPos = bodyPos(stars[0], t);
  R.begin(world.env);
  const pxK = viewH / (2 * Math.tan(cam.fov / 2));

  for (const b of world.bodies) {
    const p = bodyPos(b, t);
    if (b.type === 'star') {
      R.draw(b.mesh, m4.compose(p, 0, 0, 0, b.size), { tint: b.col, unlit: true, em: 0.4 });
    } else if (b.type === 'planet') {
      R.draw(b.mesh, m4.compose(p, t * b.spin, b.tilt || 0.1, 0.2, b.size), {});
    } else if (b.type === 'mesh') {
      R.draw(b.mesh, m4.compose(p, t * (b.spin || 0), b.tilt || 0, 0, b.size), { em: b.emBoost || 0 });
    } else if (b.type === 'visual') {
      const d = v3.dist(eye, p);
      const lod = (b.visual.radius * b.size) / d * pxK < 6;
      drawVisual(R, b.visual, m4.compose(p, b.yaw || 0, 0, 0, b.size), t, { tint: b.tint }, lod);
    }
  }

  const selected = game.selection;
  for (const e of world.entities) {
    if (e.dead) continue;
    drawEntity(game, world, R, e, eye, t, pxK, selected.has(e.id) || game.hover === e);
  }

  // Star glows last so they blend over the sky.
  for (const b of stars) {
    const sp = bodyPos(b, t);
    // Pull the glow toward the camera so the star's own sphere never occludes it.
    const p = v3.add(sp, v3.scale(v3.norm(v3.sub(eye, sp)), b.size * 1.5));
    R.sprite(p, b.size * 1.6, [1, 1, 1], 0.5);
    R.sprite(p, b.size * 3.2, b.col, 0.85);
    R.sprite(p, b.size * 9, b.col, 0.22);
    R.sprite(p, b.size * 22, b.col, 0.07);
    if (b.pulsar) {
      const a = t * 0.35;
      const dir = [Math.sin(a), 0.05, Math.cos(a)];
      for (const s of [1, -1]) {
        R.beam(sp, v3.add(sp, v3.scale(dir, 4200 * s)), 40, [0.6, 0.8, 1], 0.35);
        R.beam(sp, v3.add(sp, v3.scale(dir, 4200 * s)), 10, [0.9, 0.95, 1], 0.6);
      }
    }
  }
  for (const b of world.bodies) {
    if (b.type === 'planet' && b.atmo) {
      const p = bodyPos(b, t);
      R.sprite(p, b.size / 0.86 * 1.03, b.atmo, 0.55, 2);
    }
  }

  // Projectiles
  for (const pr of world.projectiles) {
    R.sprite(pr.pos, pr.w.size * 1.6, pr.w.color, 1);
    R.beam(pr.pos, v3.sub(pr.pos, v3.scale(pr.vel, 0.05)), pr.w.size * 0.6, pr.w.color, 0.8);
  }
  // Beams
  for (const b of world.beams) {
    const a = Array.isArray(b.a) ? b.a : world.get(b.a)?.pos;
    const c = Array.isArray(b.b) ? b.b : world.get(b.b)?.pos;
    if (!a || !c) continue;
    const k = b.life / b.max;
    R.beam(a, c, b.width * (0.6 + k), b.col, k);
    R.beam(a, c, b.width * 0.3, [1, 1, 1], k * 0.8);
    R.sprite(c, b.width * 4 * k + 1, b.col, k);
  }
  // Ion storms: layered violet haze with occasional lightning.
  for (const st of world.storms || []) {
    for (const pf of st.puffs) R.sprite(pf.p, pf.s, [0.55, 0.35, 0.95], 0.09);
    if (Math.random() < 0.08) {
      const a = st.puffs[Math.floor(Math.random() * st.puffs.length)].p, b = st.puffs[Math.floor(Math.random() * st.puffs.length)].p;
      R.beam(a, b, 2.5, [0.8, 0.7, 1], 0.9);
    }
  }
  // Boarding grapples
  for (const e of world.entities) {
    if (!e.boarding) continue;
    const tg = world.get(e.boarding);
    if (tg) R.beam(e.pos, tg.pos, 0.7, e.style === 'bloom' ? [0.5, 1, 0.6] : [1, 0.8, 0.4], 0.5 + 0.3 * Math.sin(t * 12));
  }
  // Ability auras
  for (const e of world.entities) {
    if (e.dead) continue;
    if (e.hotT > 0) R.sprite(e.pos, e.radius * 1.2, [0.4, 1, 0.6], 0.25, 2);
    if (e.overT > 0) R.sprite(e.pos, e.radius * 1.1, [0.4, 0.85, 1], 0.25, 2);
    if (e.braceT > 0) R.sprite(e.pos, e.radius * 1.2, [0.6, 0.75, 1], 0.18, 2);
    if (e.jamT > 0 && Math.random() < 0.3) R.sprite(world.hardpoint(e), e.radius * 0.3, [0.4, 0.9, 1], 0.8);
  }
  // Scanning beams
  for (const e of world.entities) {
    if (e.scanning) {
      const tg = world.get(e.scanning) || world.entities.find((x) => x.id === e.scanning);
      if (tg) {
        const f = 0.4 + 0.3 * Math.sin(t * 20 + e.id);
        R.beam(e.pos, tg.pos, 0.8, [0.5, 0.9, 1], f);
        R.sprite(tg.pos, tg.radius * (1 + 0.1 * Math.sin(t * 4)), [0.5, 0.9, 1], 0.25, 2);
      }
    }
  }
  for (const p of world.particles) R.sprite(p.pos, p.size, p.col, clamp(p.life / p.max, 0, 1), p.mode || 0);

  // Ground markers for move orders of the selection
  for (const id of selected) {
    const e = world.get(id);
    if (e && e.order && e.order.type === 'move') R.flat(e.order.pos, 8 + 2 * Math.sin(t * 5), SEL, 0.7, 2);
  }
  R.flushFx();
}

function drawEntity(game, world, R, e, eye, t, pxK, sel) {
  const d = v3.dist(eye, e.pos);
  const px = (e.radius / d) * pxK;
  e._px = px;
  if (px < 0.8 && !sel) return;
  let sz = e.scale || 1;
  let sx = sz, sy = sz, szz = sz;
  const opt = { flash: e.fx.hit * 0.35, tint: e.tint };
  if (e.warpIn > 0) {
    szz = sz * (1 + e.warpIn * 10);
    sx = sy = sz * (1 - e.warpIn * 0.5);
    opt.flash = e.warpIn;
    opt.flashCol = [0.7, 0.85, 1];
  }
  if (e.jumping) {
    const k = clamp(e.jumpT / 1.2, 0, 1);
    szz = sz * (1 + k * 14);
    opt.flash = k;
    opt.flashCol = [0.7, 0.85, 1];
  }
  if (e.style === 'bloom') opt.em = 0.35 * Math.sin(t * 1.6 + e.phase);
  let pos = e.pos;
  if (e.building) {
    const b = e.building;
    const k = b.t;
    if (b.mode === 'grows') {
      // A pod swells at the nursery, then the ship emerges.
      const pod = Math.min(1, k / 0.75);
      if (k < 0.85) R.sprite(pos, e.radius * pod * 1.4, [0.4, 1, 0.8], 0.35 + 0.2 * Math.sin(t * 6));
      sx = sy = szz = sz * Math.max(0.05, (k - 0.3) / 0.7);
      opt.em = 1.5 * (1 - k);
    } else if (b.mode === 'launches') {
      // Slides out of the drydock.
      pos = v3.lerp(b.from, b.to, k * k);
      opt.flash = (1 - k) * 0.2;
    }
  }
  const model = m4.compose(pos, e.yaw, e.pitch, e.roll, sx, sy, szz);
  const lod = px < 7;
  if (e.building && e.building.mode === 'assembles') {
    // Components fly in from the assembly frame and lock together.
    const k = e.building.t;
    e.visual.parts.forEach((p, i) => {
      const off = (1 - k) * (1 - k) * (40 + i * 15);
      const a = i * 2.4;
      const m = m4.mul(m4.compose([pos[0] + Math.cos(a) * off, pos[1] + Math.sin(a * 1.7) * off * 0.5, pos[2] + Math.sin(a) * off], e.yaw + (1 - k) * i, e.pitch, e.roll, sz), partMatrix(p, t));
      R.draw(p.mesh, m, { flash: (1 - k) * 0.3 });
      if (k < 0.95 && Math.random() < 0.3) R.sprite(m4.point(m, [0, 0, 0]), 3, [1, 0.7, 0.3], 1);
    });
  } else {
    drawVisual(R, e.visual, model, t + e.phase, opt, lod);
  }
  // Engine glow scales with thrust.
  if (e.visual.engines && px > 2) {
    const thrust = e.baseSpeed ? 0.35 + (e.speedNow / e.baseSpeed) * 0.9 : 0.5;
    const flick = e.engineDamaged ? (Math.random() < 0.4 ? 0.2 : 1) : 1;
    for (const p of e.visual.engines) {
      const w = m4.point(model, p);
      R.sprite(w, e.radius * 0.1 * thrust * flick + 0.6, e.visual.engineCol || [0.5, 0.8, 1], 0.9);
    }
  }
  if (e.fx.shield > 0 && e.maxShield > 0) {
    const sc = e.style === 'bloom' ? [0.5, 1, 0.75] : e.team === 'player' ? [0.5, 0.8, 1] : e.visual.glowCol || [1, 0.8, 0.5];
    R.sprite(pos, e.radius * 1.05, sc, e.fx.shield * 0.45, 2);
    if (e.fx.shieldAt) R.sprite(e.fx.shieldAt, e.radius * 0.35, sc, e.fx.shield * 0.6);
  }
  if (sel && e.kind !== 'wreck') {
    const c = game.selection.has(e.id) ? (e.team === 'player' ? SEL : [1, 0.5, 0.4]) : [1, 1, 1];
    R.flat([pos[0], pos[1] - e.radius * 0.3, pos[2]], e.radius * 1.15, c, game.selection.has(e.id) ? 0.9 : 0.5, 2);
  }
  if (e.kind === 'node' && e.progress != null) {
    R.sprite(pos, e.radius * (1.6 + e.progress), e.visual.glowCol, 0.3 + 0.2 * Math.sin(t * 3), 2);
  }
}

// ---------------- 2D overlay ----------------
export function drawOverlay(ctx, game, world, cam, R, W, H) {
  ctx.clearRect(0, 0, W, H);
  if (!world) return;
  const sys = cam.dist > 1100;
  ctx.font = '11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  for (const st of world.storms || []) {
    const p = R.project(st.pos, W, H);
    if (p) {
      ctx.fillStyle = 'rgba(190,160,255,0.75)';
      ctx.fillText('ION STORM — shields will not recharge · range −30%', p[0], p[1]);
    }
  }
  // Body labels at system scale
  if (sys) {
    for (const b of world.bodies) {
      if (!b.label) continue;
      const p = R.project(bodyPos(b, world.t), W, H);
      if (!p) continue;
      ctx.fillStyle = 'rgba(200,220,255,0.6)';
      ctx.fillText(b.label, p[0], p[1] - 10);
    }
  }
  for (const e of world.entities) {
    if (e.dead || e.isFighter) continue;
    const p = R.project(e.pos, W, H);
    if (!p || p[0] < -50 || p[0] > W + 50 || p[1] < -50 || p[1] > H + 50) continue;
    const px = e._px || 0;
    const selected = game.selection.has(e.id);
    const hover = game.hover === e;
    const hostile = e.team !== 'player' && world.hostile(e, { team: 'player' });
    const tc = e.team === 'civ' ? (hostile ? [1, 0.35, 0.3] : TEAM_COL.civ) : TEAM_COL[e.team] || TEAM_COL.neutral;
    // Tactical icons when ships become too small to read.
    if (px < 6 || sys) {
      ctx.strokeStyle = col.css(tc, selected ? 1 : 0.85);
      ctx.fillStyle = col.css(tc, selected ? 0.5 : 0.18);
      ctx.lineWidth = selected ? 2 : 1.2;
      const s = e.kind === 'station' ? 8 : e.role === 'flagship' || e.role === 'keystone' ? 7 : e.kind === 'ship' ? 5 : 7;
      ctx.beginPath();
      if (e.kind === 'station') ctx.rect(p[0] - s, p[1] - s, s * 2, s * 2);
      else if (e.kind === 'landmark' || e.kind === 'wreck') {
        ctx.moveTo(p[0], p[1] - s);
        ctx.lineTo(p[0] + s, p[1]);
        ctx.lineTo(p[0], p[1] + s);
        ctx.lineTo(p[0] - s, p[1]);
        ctx.closePath();
      } else if (e.kind === 'node') ctx.arc(p[0], p[1], s, 0, TAU);
      else {
        const a = -cam.yaw + e.yaw;
        ctx.moveTo(p[0] + Math.sin(a) * s * 1.4, p[1] + Math.cos(a) * s * 1.4);
        ctx.lineTo(p[0] + Math.sin(a + 2.4) * s, p[1] + Math.cos(a + 2.4) * s);
        ctx.lineTo(p[0] + Math.sin(a - 2.4) * s, p[1] + Math.cos(a - 2.4) * s);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
    const showName = hover || selected || ((e.kind === 'station' || e.kind === 'landmark' || e.kind === 'wreck' || e.keystone) && (sys || px > 4));
    if (showName) {
      let name = e.name;
      if (e.keystone && world.civ && !world.civ.state.intel.vulnerability) name = 'Unidentified vessel';
      ctx.fillStyle = col.css(tc, 0.95);
      ctx.fillText(name, p[0], p[1] - Math.max(14, px * 0.9) - 10);
      if (e.keystone && world.civ && world.civ.state.intel.vulnerability) {
        ctx.fillStyle = 'rgba(255,200,90,0.95)';
        ctx.fillText('◆ VULNERABILITY', p[0], p[1] - Math.max(14, px * 0.9) - 22);
      }
    }
    // Health bars
    const recent = world.t - e.lastHit < 4;
    if ((e.kind === 'ship' || e.kind === 'station' || e.kind === 'node') && (selected || hover || recent || (!sys && px > 5 && e.team === 'player')) && e.maxHull > 1) {
      const bw = clamp(px * 1.4, 26, 90);
      const y = p[1] - Math.max(12, px * 0.9) - 6;
      const hr = clamp(e.hull / e.maxHull, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p[0] - bw / 2 - 1, y - 1, bw + 2, 7);
      ctx.fillStyle = hr > 0.5 ? '#6f6' : hr > 0.3 ? '#fc4' : '#f54';
      ctx.fillRect(p[0] - bw / 2, y + 2, bw * hr, 3);
      if (e.maxShield > 0) {
        ctx.fillStyle = '#6cf';
        ctx.fillRect(p[0] - bw / 2, y, bw * clamp(e.shield / e.maxShield, 0, 1), 2);
      }
      if (e.engineDamaged) {
        ctx.fillStyle = '#f84';
        ctx.fillText('ENGINES CRIPPLED', p[0], y + 16);
      }
      if (e.broken) {
        ctx.fillStyle = '#fc6';
        ctx.fillText('DEFENCES BROKEN', p[0], y + 16);
      }
      // Subsystem pips: engines, weapons, shields, command.
      if (e.subs && (selected || hover || recent)) {
        const keys = Object.keys(e.subs);
        keys.forEach((k, i) => {
          const sb = e.subs[k];
          const x = p[0] - bw / 2 + i * 13;
          const f = clamp(sb.hp / sb.max, 0, 1);
          ctx.fillStyle = f <= 0 ? '#f43' : f < 0.5 ? '#fb4' : 'rgba(170,200,255,0.8)';
          ctx.fillRect(x, y - 7, 10, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.font = '8px sans-serif';
          ctx.fillText(k[0].toUpperCase(), x + 5, y - 9);
        });
        ctx.font = '11px "Trebuchet MS", sans-serif';
      }
      if (e.rank) {
        ctx.fillStyle = '#fd7';
        ctx.fillText('★'.repeat(e.rank), p[0] + bw / 2 + 14, y + 6);
      }
      if (e.boardP > 0 && e.team !== 'player') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(p[0] - bw / 2, y + 22, bw, 4);
        ctx.fillStyle = '#8f8';
        ctx.fillRect(p[0] - bw / 2, y + 22, bw * clamp(e.boardP, 0, 1), 4);
        ctx.fillText('BOARDING', p[0], y + 36);
      }
    }
    // Scan targets
    if (e.scan && !e.scan.done) {
      const k = e.scan.progress / e.scan.need;
      const r = clamp(px * 1.3, 14, 70);
      ctx.strokeStyle = 'rgba(120,220,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, TAU);
      ctx.stroke();
      if (k > 0) {
        ctx.strokeStyle = 'rgba(120,220,255,0.95)';
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, -Math.PI / 2, -Math.PI / 2 + TAU * k);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(120,220,255,${0.6 + 0.4 * Math.sin(world.t * 4)})`;
      ctx.fillText('? ' + e.scan.label, p[0], p[1] + r + 14);
    }
    if (e.kind === 'node' && e.progress != null) {
      const bw = 120;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(p[0] - bw / 2, p[1] + 30, bw, 8);
      ctx.fillStyle = '#b8f';
      ctx.fillRect(p[0] - bw / 2, p[1] + 30, bw * e.progress, 8);
      ctx.fillStyle = '#dcf';
      ctx.fillText(`Integration ${Math.floor(e.progress * 100)}%`, p[0], p[1] + 52);
    }
  }
  // Order lines for the selection
  ctx.lineWidth = 1;
  for (const id of game.selection) {
    const e = world.get(id);
    if (!e || !e.order) continue;
    const a = R.project(e.pos, W, H);
    let b = null, c = 'rgba(120,255,160,0.5)';
    if (e.order.type === 'move') b = R.project(e.order.pos, W, H);
    else if (e.order.type === 'attack' && !e.order.auto) {
      const t = world.get(e.order.id);
      if (t) b = R.project(t.pos, W, H);
      c = 'rgba(255,110,90,0.6)';
    } else if (e.order.type === 'scan') {
      const t = world.get(e.order.id) || world.entities.find((x) => x.id === e.order.id);
      if (t) b = R.project(t.pos, W, H);
      c = 'rgba(120,220,255,0.6)';
    }
    if (a && b) {
      ctx.strokeStyle = c;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Drag box
  const dr = game.input && game.input.drag;
  if (dr && dr.box) {
    ctx.strokeStyle = 'rgba(120,255,160,0.9)';
    ctx.fillStyle = 'rgba(120,255,160,0.08)';
    const x = Math.min(dr.x0, dr.x1), y = Math.min(dr.y0, dr.y1), w = Math.abs(dr.x1 - dr.x0), h = Math.abs(dr.y1 - dr.y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
}
