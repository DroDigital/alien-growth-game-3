// Ship, station and landmark designs. Each visual is a set of animated parts so organic ships
// breathe and sway, robotic ships rotate and slide, and crewed ships carry visible hangars.
import { m4, rng, col, TAU, hashStr } from './math.js';
import { MB, T, I } from './meshgen.js';

export const PAL = {
  bloom: { hull: [0.16, 0.38, 0.42], shell: [0.4, 0.27, 0.46], flesh: [0.72, 0.42, 0.52], vein: [0.35, 1.0, 0.82], sac: [1.0, 0.42, 0.72], engine: [0.4, 1.0, 0.8] },
  array: { hull: [0.8, 0.82, 0.85], dark: [0.22, 0.24, 0.28], mid: [0.5, 0.53, 0.58], accent: [1.0, 0.55, 0.12], light: [0.35, 0.85, 1.0], engine: [0.45, 0.85, 1.0] },
  ascendancy: { hull: [0.86, 0.84, 0.78], navy: [0.12, 0.17, 0.38], gold: [0.88, 0.67, 0.26], engine: [0.45, 0.65, 1.0], hangar: [1.0, 0.8, 0.48] },
  raider: { hull: [0.24, 0.2, 0.2], dark: [0.1, 0.09, 0.1], glow: [1.0, 0.18, 0.1], accent: [0.55, 0.5, 0.45] },
};

const cache = new Map();

// spec: { style, role, pal, seed, traits: [{id, tier}] }
export function getVisual(R, spec) {
  const traitKey = (spec.traits || []).map((t) => t.id + t.tier).join(',');
  const key = `${spec.style}|${spec.role}|${spec.seed || 0}|${traitKey}|${spec.pal ? JSON.stringify(spec.pal) : ''}`;
  if (cache.has(key)) return cache.get(key);
  const fn = BUILDERS[spec.style];
  const pal = spec.pal || PAL[spec.style];
  const boarder = spec.role === 'boarder';
  const v = fn(R, boarder ? 'scout' : spec.role, pal, (spec.seed || 1) + (boarder ? 17 : 0));
  if (boarder) addBoardingClaws(R, spec.style, pal, v);
  for (const t of spec.traits || []) addTraitVisual(R, spec.style, t, v);
  cache.set(key, v);
  return v;
}

const P = (mesh, base = I(), anim = null) => ({ mesh, base, anim });

export function partMatrix(part, t) {
  const a = part.anim;
  if (!a) return part.base;
  const ph = a.phase || 0;
  switch (a.type) {
    case 'spin':
      return m4.mul(part.base, m4.rot(a.axis, t * a.speed + ph));
    case 'pulse': {
      const s = 1 + Math.sin(t * a.freq * TAU + ph) * a.amp;
      const s2 = 1 + Math.sin(t * a.freq * TAU + ph + 0.8) * a.amp * 0.6;
      return m4.mul(part.base, T([0, 0, 0], 0, 0, 0, s, s2, 1 + (s - 1) * 0.4));
    }
    case 'sway':
      return m4.mul(part.base, m4.compose([0, 0, 0], Math.sin(t * a.freq + ph) * a.amp, Math.sin(t * a.freq * 0.7 + ph * 1.3) * a.amp * 0.7, 0));
    case 'orbit': {
      const ang = t * a.speed + ph;
      return m4.mul(part.base, m4.compose([Math.cos(ang) * a.r, Math.sin(ang * 2 + ph) * (a.bob || 0), Math.sin(ang) * a.r], -ang, 0, 0));
    }
    case 'slide': {
      const o = Math.sin(t * a.freq + ph) * a.amp;
      const off = a.axis === 'x' ? [o, 0, 0] : a.axis === 'y' ? [0, o, 0] : [0, 0, o];
      return m4.mul(part.base, T(off));
    }
    default:
      return part.base;
  }
}

// ======================== THE BLOOM (organic) ========================
function bloomBodyColor(pal) {
  return (z, a) => {
    const s = Math.sin(a);
    if (s < -0.3) return [col.mix(pal.flesh, pal.hull, 0.25), 0];
    return [col.mix(pal.hull, pal.shell, z * 0.4), 0];
  };
}
function tendril(b, len, r, segs, pal, seed, droop = 0.25) {
  const rr = rng(seed);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    pts.push([Math.sin(u * 5 + rr() * 3) * len * 0.06, -u * u * len * droop, -u * len]);
  }
  b.tube(pts, r, r * 0.15, 5, pal.flesh, 0, (u) => (Math.floor(u * 10) % 5 === 0 ? [pal.vein, 0.8] : [col.mix(pal.flesh, pal.shell, u), 0]));
}

function bloom(R, role, pal, seed) {
  const parts = [];
  const r = rng(seed + 11);
  const sizes = { flagship: 22, escort: 10, scout: 6, repair: 9, fighter: 1.6, station: 1 };
  const L = sizes[role] || 10;
  const engines = [];
  if (role === 'fighter') {
    const b = new MB(seed);
    b.sphere(T([0, 0, 0], 0, 0, 0, 0.9, 0.7, 1.3), 1, pal.flesh, 0, { jitter: 0.15 });
    b.sphere(T([0, 0.2, 0.4], 0, 0, 0, 0.35), 0, pal.vein, 1);
    tendril(b, 3, 0.25, 4, pal, seed);
    parts.push(P(b.build(R), I(), { type: 'pulse', amp: 0.08, freq: 1.4 }));
    return { parts, radius: 2.5, engines: [], engineCol: pal.engine, glowCol: pal.vein };
  }
  if (role === 'scout') {
    // Drifter: a jellyfish bell trailing luminous tendrils.
    const bell = new MB(seed);
    bell.sphere(T([0, 0, 0], 0, Math.PI / 2, 0, L * 0.7, L * 0.7, L * 0.55), 2, pal.shell, 0, {
      radiusFn: (v, rr) => (v[2] < -0.2 ? rr * 0.25 + 0.6 : rr),
      colorFn: (d) => (d[2] < -0.1 ? [pal.vein, 0.9] : Math.abs(Math.atan2(d[1], d[0])) % 0.8 < 0.12 ? [pal.vein, 0.8] : [col.mix(pal.shell, pal.hull, d[2] * 0.5 + 0.5), 0]),
    });
    parts.push(P(bell.build(R), T([0, 0, 0], 0, -Math.PI / 2, 0), { type: 'pulse', amp: 0.07, freq: 0.9 }));
    for (let i = 0; i < 5; i++) {
      const tb = new MB(seed + i);
      tendril(tb, L * 2.2, 0.35, 7, pal, seed + i, 0.1);
      const a = (i / 5) * TAU;
      parts.push(P(tb.build(R), T([Math.cos(a) * L * 0.35, Math.sin(a) * L * 0.25, -L * 0.3]), { type: 'sway', amp: 0.35, freq: 1.3, phase: i }));
    }
    engines.push([0, 0, -L * 0.4]);
    return { parts, radius: L * 1.3, engines, engineCol: pal.engine, glowCol: pal.vein };
  }
  // Body
  const body = new MB(seed);
  const prof = role === 'repair' ? [0.25, 0.75, 1, 1, 0.8, 0.3] : [0.18, 0.55, 0.9, 1, 0.85, 0.6, 0.3];
  const W = role === 'repair' ? L * 0.55 : L * 0.36;
  const sections = prof.map((p, i) => ({ z: -L + (i / (prof.length - 1)) * 2 * L, w: W * p * (0.9 + r() * 0.2), h: W * 0.8 * p * (0.9 + r() * 0.2), belly: 1.2 }));
  body.loft(I(), sections, 9, pal.hull, 0, { colorFn: bloomBodyColor(pal), jitter: 0.12 });
  // Luminous veins running along the flanks.
  for (const sx of [-1, 1]) {
    for (const yy of [0.1, -0.35]) {
      const pts = sections.slice(1, -1).map((sec) => [sx * sec.w * 1.0, sec.h * yy, sec.z]);
      body.tube(pts, W * 0.06, W * 0.03, 4, pal.vein, 1);
    }
  }
  // Glowing belly sacs
  const sacN = role === 'flagship' ? 5 : role === 'repair' ? 4 : 2;
  for (let i = 0; i < sacN; i++) {
    const z = -L * 0.5 + (i / Math.max(1, sacN - 1)) * L;
    const s = W * (role === 'repair' ? 0.42 : 0.3);
    body.sphere(T([(i % 2 ? 1 : -1) * W * 0.35, -W * 0.65, z], 0, 0, 0, s, s * 0.8, s * 1.2), 1, pal.sac, 0.9, { jitter: 0.1 });
  }
  // Spines on escorts
  if (role === 'escort' || role === 'flagship') {
    const n = role === 'flagship' ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const z = -L * 0.7 + (i / (n - 1)) * L * 1.4;
      for (const sx of [-1, 1]) {
        body.cyl(T([sx * W * 0.7, W * 0.35, z], sx * 0.9, -0.8, 0, 1, 1, L * 0.18), W * 0.12, 0, 4, pal.shell, 0);
      }
    }
  }
  // Frond crown at the head
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    body.cyl(T([Math.cos(a) * W * 0.3, Math.sin(a) * W * 0.3, L * 0.95], Math.cos(a) * 0.5, -Math.sin(a) * 0.5, 0, 1, 1, L * 0.3), W * 0.12, 0, 4, pal.flesh, 0);
  }
  parts.push(P(body.build(R), I(), { type: 'pulse', amp: 0.025, freq: 0.35 }));
  // Layered shell plates (separate so they breathe out of phase)
  const shell = new MB(seed + 3);
  const plates = role === 'flagship' ? 6 : role === 'repair' ? 3 : 4;
  for (let i = 0; i < plates; i++) {
    const z = -L * 0.65 + (i / (plates - 1)) * L * 1.3;
    const s = W * (1.0 - Math.abs(i / (plates - 1) - 0.5) * 0.6);
    shell.sphere(T([0, W * 0.55, z], 0, -0.2, 0, s * 0.95, s * 0.42, L * 0.32), 1, col.mix(pal.shell, pal.hull, i % 2 ? 0.25 : 0), 0, {
      radiusFn: (v, rr) => (v[1] < 0 ? rr * 0.3 : rr),
      colorFn: (d) => (d[1] > 0.96 ? [pal.vein, 0.5] : [col.mix(pal.shell, [0.1, 0.1, 0.15], d[2] < -0.5 ? 0.4 : 0), 0]),
    });
  }
  parts.push(P(shell.build(R), I(), { type: 'pulse', amp: 0.02, freq: 0.35, phase: 1.2 }));
  // Trailing tendrils
  const tn = role === 'flagship' ? 5 : role === 'repair' ? 4 : 3;
  for (let i = 0; i < tn; i++) {
    const tb = new MB(seed + 20 + i);
    tendril(tb, L * (role === 'flagship' ? 1.1 : 1.3), W * 0.12, 8, pal, seed + i);
    const a = (i / tn) * TAU + 0.3;
    parts.push(P(tb.build(R), T([Math.cos(a) * W * 0.4, Math.sin(a) * W * 0.3, -L * 0.9]), { type: 'sway', amp: 0.28, freq: 0.9, phase: i * 1.7 }));
    engines.push([Math.cos(a) * W * 0.4, Math.sin(a) * W * 0.3, -L * 0.95]);
  }
  if (role === 'repair') {
    const ring = new MB(seed + 40);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ring.sphere(T([Math.cos(a) * W * 1.25, Math.sin(a) * W * 1.25, 0], 0, 0, 0, W * 0.18), 1, pal.vein, 0.9);
    }
    parts.push(P(ring.build(R), I(), { type: 'spin', axis: 'z', speed: 0.4 }));
  }
  return { parts, radius: L * 1.25, engines, engineCol: pal.engine, glowCol: pal.vein };
}

// ======================== THE ARRAY (robotic) ========================
function array(R, role, pal, seed) {
  const parts = [];
  const engines = [];
  const sizes = { flagship: 20, escort: 5, scout: 6, repair: 8, fighter: 1.4 };
  const L = sizes[role] || 8;
  if (role === 'fighter') {
    const b = new MB(seed);
    b.shard(T([0, 0, 0], 0, 0, 0, 0.8, 0.8, 1.6), pal.hull, 0, 4, 0.6, 0);
    b.box(T([0, 0, -0.9], 0, 0, 0, 0.4, 0.4, 0.2), pal.light, 1);
    parts.push(P(b.build(R)));
    return { parts, radius: 2, engines: [[0, 0, -1]], engineCol: pal.engine, glowCol: pal.light };
  }
  if (role === 'escort') {
    // Node cluster: armoured core with orbiting drones.
    const core = new MB(seed);
    core.box(T([0, 0, 0], Math.PI / 4, Math.PI / 4, 0, L * 1.2), pal.hull, 0, [pal.hull, pal.mid, pal.hull, pal.mid, pal.dark, pal.dark]);
    core.box(T([0, 0, L * 0.85], 0, 0, 0, L * 0.5, L * 0.5, L * 0.2), pal.light, 1);
    core.cyl(T([0, 0, L * 1.2], 0, 0, 0, 1, 1, L * 0.8), L * 0.12, L * 0.08, 6, pal.dark, 0);
    parts.push(P(core.build(R)));
    const ring = new MB(seed + 1);
    ring.torus(I(), L * 1.25, L * 0.08, 20, 4, pal.mid, 0, (i) => [i % 5 === 0 ? pal.accent : pal.mid, i % 5 === 0 ? 1 : 0]);
    parts.push(P(ring.build(R), T([0, 0, 0], 0, Math.PI / 2, 0), { type: 'spin', axis: 'z', speed: 1.1 }));
    const drone = new MB(seed + 2);
    drone.shard(T([0, 0, 0], 0, 0, 0, L * 0.35, L * 0.35, L * 0.6), pal.hull, 0, 4, 0.7, 0);
    drone.box(T([0, 0, -L * 0.3], 0, 0, 0, L * 0.2), pal.accent, 1);
    const dm = drone.build(R);
    for (let i = 0; i < 4; i++) parts.push(P(dm, I(), { type: 'orbit', r: L * 2, speed: 1.1, phase: (i / 4) * TAU, bob: L * 0.3 }));
    engines.push([0, 0, -L * 0.8]);
    return { parts, radius: L * 2.4, engines, engineCol: pal.engine, glowCol: pal.light, drones: true };
  }
  const core = new MB(seed);
  const W = role === 'flagship' ? L * 0.16 : L * 0.3;
  if (role === 'scout') {
    core.cyl(T([0, 0, 0], 0, 0, Math.PI / 6, 1, 1, L * 2), L * 0.4, 0, 3, pal.hull, 0, true, pal.dark);
    core.box(T([0, 0, -L * 0.95], 0, 0, 0, L * 0.3, L * 0.3, L * 0.1), pal.light, 1);
    core.box(T([0, L * 0.25, 0], 0, 0, 0, L * 0.06, L * 0.4, L * 0.9), pal.accent, 1);
    parts.push(P(core.build(R)));
    const ring = new MB(seed + 1);
    ring.torus(I(), L * 0.6, L * 0.05, 16, 3, pal.mid, 0);
    parts.push(P(ring.build(R), T([0, 0, -L * 0.2]), { type: 'spin', axis: 'z', speed: 2 }));
    engines.push([0, 0, -L]);
    return { parts, radius: L * 1.1, engines, engineCol: pal.engine, glowCol: pal.light };
  }
  // Flagship / repair: spine with modules.
  core.box(T([0, 0, 0], 0, 0, 0, W * 2, W * 1.6, L * 1.7), pal.hull, 0, [pal.hull, pal.mid, pal.hull, pal.hull, pal.hull, pal.dark]);
  core.box(T([0, -W * 0.9, 0], 0, 0, 0, W * 1.4, W * 0.5, L * 1.5), pal.dark);
  core.cyl(T([0, 0, L * 1.0], 0, 0, Math.PI / 4, 1, 1, L * 0.35), W * 1.4, 0, 4, pal.hull, 0);
  const mods = role === 'flagship' ? 6 : 3;
  for (let i = 0; i < mods; i++) {
    const z = -L * 0.7 + (i / (mods - 1)) * L * 1.3;
    for (const sx of [-1, 1]) {
      const big = (i + (sx > 0 ? 1 : 0)) % 2 === 0;
      core.box(T([sx * W * (big ? 1.6 : 1.4), 0, z], 0, 0, 0, W * (big ? 1.3 : 0.9), W * (big ? 1.3 : 1.0), L * 0.18), big ? pal.mid : pal.hull);
      core.box(T([sx * W * (big ? 2.27 : 1.86), 0, z], 0, 0, 0, W * 0.06, W * 0.25, L * 0.15), pal.accent, 1);
    }
    core.box(T([0, W * 0.85, z], 0, 0, 0, W * 0.3, W * 0.1, W * 0.3), pal.light, 1);
  }
  core.box(T([0, 0, -L * 0.9], 0, 0, 0, W * 2.6, W * 2, L * 0.12), pal.dark);
  for (const [x, y] of [[-W * 0.7, W * 0.5], [W * 0.7, W * 0.5], [-W * 0.7, -W * 0.5], [W * 0.7, -W * 0.5]]) {
    core.box(T([x, y, -L * 0.97], 0, 0, 0, W * 0.8, W * 0.6, L * 0.04), pal.engine, 1);
    engines.push([x, y, -L * 1.0]);
  }
  parts.push(P(core.build(R)));
  // Rotating rings
  const ringDefs = role === 'flagship' ? [[-L * 0.35, L * 0.55, 0.5], [L * 0.4, L * 0.45, -0.8]] : [[0, L * 0.7, 0.9]];
  ringDefs.forEach(([z, rad, sp], k) => {
    const ring = new MB(seed + 5 + k);
    ring.torus(I(), rad, W * 0.25, 28, 4, pal.mid, 0, (i) => [i % 7 === 0 ? pal.accent : i % 2 ? pal.hull : pal.mid, i % 7 === 0 ? 1 : 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ring.box(T([Math.cos(a) * rad, Math.sin(a) * rad, 0], 0, 0, a, W * 0.6, W * 0.9, W * 0.7), pal.hull);
    }
    parts.push(P(ring.build(R), T([0, 0, z]), { type: 'spin', axis: 'z', speed: sp }));
  });
  // Sliding armour plates
  for (const sx of [-1, 1]) {
    const pl = new MB(seed + 9 + sx);
    pl.box(T([0, 0, 0], 0, 0, 0, W * 0.25, W * 2.2, L * 0.6), pal.mid, 0);
    pl.box(T([sx * W * 0.14, 0, 0], 0, 0, 0, W * 0.04, W * 1.4, L * 0.05), pal.light, 1);
    parts.push(P(pl.build(R), T([sx * W * 2.6, 0, L * 0.1]), { type: 'slide', axis: 'x', amp: W * 0.25, freq: 0.6, phase: sx }));
  }
  if (role === 'repair') {
    for (const sx of [-1, 1]) {
      const arm = new MB(seed + 30 + sx);
      arm.box(T([sx * L * 0.3, 0, L * 0.4], 0, 0, 0, W * 0.3, W * 0.3, L * 0.8), pal.mid);
      arm.box(T([sx * L * 0.3, 0, L * 0.85], 0, 0, 0, W * 0.6, W * 0.6, W * 0.4), pal.accent, 1);
      parts.push(P(arm.build(R), T([sx * W, 0, 0]), { type: 'sway', amp: 0.25, freq: 1.2, phase: sx }));
    }
  }
  return { parts, radius: L * 1.25, engines, engineCol: pal.engine, glowCol: pal.light };
}

// ======================== THE ASCENDANCY (crewed) ========================
function ascHullColor(pal) {
  return (z, a) => {
    const s = Math.sin(a);
    if (s < -0.15) return [pal.navy, 0];
    if (Math.abs(s) < 0.2 && Math.floor(z * 14) % 4 === 1) return [pal.hangar, 0.6];
    return [pal.hull, 0];
  };
}
function ascendancy(R, role, pal, seed) {
  const parts = [];
  const engines = [];
  const sizes = { flagship: 24, escort: 10, scout: 6, repair: 10, fighter: 1.5 };
  const L = sizes[role] || 10;
  const b = new MB(seed);
  if (role === 'fighter') {
    b.loft(I(), [{ z: -1.2, w: 0.5, h: 0.25 }, { z: 0.2, w: 0.45, h: 0.3 }, { z: 1.4, w: 0.05, h: 0.05 }], 4, pal.hull, 0, { rot: Math.PI / 4 });
    b.box(T([0, 0, -0.6], 0, 0, 0, 2.2, 0.08, 0.5), pal.navy);
    b.box(T([0, 0.15, 0.2], 0, 0, 0, 0.12, 0.12, 0.8), pal.gold);
    parts.push(P(b.build(R)));
    return { parts, radius: 2, engines: [[0, 0, -1.3]], engineCol: pal.engine, glowCol: pal.engine };
  }
  const W = role === 'flagship' ? L * 0.3 : role === 'repair' ? L * 0.42 : L * 0.26;
  const H = W * (role === 'flagship' ? 0.42 : 0.38);
  const secs = role === 'scout'
    ? [{ z: -L, w: W * 0.5, h: H * 0.6 }, { z: -L * 0.2, w: W, h: H }, { z: L * 0.5, w: W * 0.5, h: H * 0.7 }, { z: L, w: W * 0.05, h: H * 0.1 }]
    : [{ z: -L, w: W * 0.7, h: H * 0.9 }, { z: -L * 0.5, w: W, h: H }, { z: L * 0.2, w: W * 0.95, h: H * 0.95 }, { z: L * 0.7, w: W * 0.55, h: H * 0.6 }, { z: L, w: W * 0.12, h: H * 0.15 }];
  b.loft(I(), secs, 8, pal.hull, 0, { colorFn: ascHullColor(pal), rot: Math.PI / 8 });
  // Dorsal spine and gold trim bands
  b.box(T([0, H * 0.95, -L * 0.1], 0, 0, 0, W * 0.35, H * 0.35, L * 1.3), pal.navy);
  for (let i = 0; i < 3; i++) b.box(T([0, H * 1.0, -L * 0.6 + i * L * 0.45], 0, 0, 0, W * 0.5, H * 0.25, L * 0.04), pal.gold, 0.15);
  // Ceremonial chevrons
  for (let i = 0; i < 2; i++) {
    for (const sx of [-1, 1]) b.box(T([sx * W * 0.25, H * 0.75, L * 0.35 + i * L * 0.12], sx * 0.6, 0, 0, W * 0.06, H * 0.05, W * 0.6), pal.gold, 0.2);
  }
  // Bridge tower
  if (role !== 'scout') {
    b.box(T([0, H * 1.5, -L * 0.62], 0, 0, 0, W * 0.4, H * 1.2, L * 0.18), pal.hull);
    b.box(T([0, H * 2.1, -L * 0.6], 0, 0, 0, W * 0.6, H * 0.25, L * 0.12), pal.navy);
    b.box(T([0, H * 2.1, -L * 0.53], 0, 0, 0, W * 0.5, H * 0.08, L * 0.01), pal.hangar, 1);
  }
  // Engines
  const en = role === 'flagship' ? 3 : 2;
  for (let i = 0; i < en; i++) {
    const x = (i - (en - 1) / 2) * W * 0.7;
    b.cyl(T([x, 0, -L * 1.05]), W * 0.25, W * 0.3, 8, pal.navy, 0, true, pal.engine, 1);
    engines.push([x, 0, -L * 1.12]);
  }
  if (role === 'flagship') {
    // Carrier hangar decks on both flanks with lit interiors.
    for (const sx of [-1, 1]) {
      b.box(T([sx * W * 1.05, -H * 0.1, -L * 0.1], 0, 0, 0, W * 0.5, H * 1.1, L * 0.9), pal.hull, 0, [pal.hull, pal.hull, pal.navy, pal.navy, pal.hull, pal.navy]);
      b.box(T([sx * W * 1.31, -H * 0.1, -L * 0.1], 0, 0, 0, W * 0.02, H * 0.6, L * 0.7), pal.hangar, 1);
      for (let k = 0; k < 4; k++) b.box(T([sx * W * 1.33, -H * 0.1, -L * 0.45 + k * L * 0.23], 0, 0, 0, W * 0.03, H * 0.7, L * 0.02), pal.navy);
    }
  }
  if (role === 'escort') {
    b.cyl(T([0, 0, L * 1.25], 0, 0, 0, 1, 1, L * 0.6), W * 0.12, W * 0.06, 6, pal.gold, 0.2);
    for (const sx of [-1, 1]) b.box(T([sx * W * 1.0, 0, -L * 0.4], sx * 0.25, 0, 0, W * 0.9, H * 0.12, L * 0.5), pal.navy);
  }
  if (role === 'scout') {
    b.cyl(T([0, H * 0.6, L * 0.6], 0, -0.1, 0, 1, 1, L * 1.2), W * 0.03, W * 0.03, 4, pal.gold, 0.3);
    for (const sx of [-1, 1]) b.box(T([sx * W * 0.9, 0, -L * 0.5], sx * 0.4, 0, 0, W * 1.0, H * 0.1, L * 0.35), pal.hull);
  }
  if (role === 'repair') {
    b.box(T([0, -H * 1.2, 0], 0, 0, 0, W * 1.2, H * 0.8, L * 0.8), pal.navy);
    for (let k = 0; k < 4; k++) b.box(T([0, -H * 1.62, -L * 0.3 + k * L * 0.2], 0, 0, 0, W * 0.6, H * 0.04, L * 0.08), [0.4, 1.0, 0.6], 1);
  }
  parts.push(P(b.build(R)));
  if (role === 'repair') {
    for (const sx of [-1, 1]) {
      const crane = new MB(seed + 7 + sx);
      crane.box(T([0, 0, L * 0.5], 0, 0, 0, W * 0.15, W * 0.15, L), pal.gold, 0.1);
      crane.box(T([0, 0, L], 0, 0, 0, W * 0.3, W * 0.3, W * 0.3), pal.hangar, 0.8);
      parts.push(P(crane.build(R), T([sx * W * 0.9, H * 0.6, -L * 0.3]), { type: 'sway', amp: 0.2, freq: 0.8, phase: sx }));
    }
  }
  return { parts, radius: L * 1.25, engines, engineCol: pal.engine, glowCol: pal.hangar, hangars: role === 'flagship' };
}

// ======================== ALIEN CIVILIZATION STYLES ========================
function crystal(R, role, pal, seed) {
  const parts = [];
  const r = rng(seed);
  const sizes = { warden: 9, keystone: 16, convoy: 9, fighter: 1.5, raider: 8 };
  const L = sizes[role] || 9;
  const b = new MB(seed, 0.1);
  if (role === 'fighter') {
    b.shard(T([0, 0, 0], 0, 0, 0, 0.6, 0.6, 1.6), pal.hull, 0.2);
    parts.push(P(b.build(R)));
    return { parts, radius: 2, engines: [], engineCol: pal.glow, glowCol: pal.glow };
  }
  if (role === 'keystone') {
    // The conductor: a central spire inside a halo of resonating shards.
    b.shard(T([0, 0, 0], 0, -Math.PI / 2, 0, L * 0.35, L * 0.35, L * 1.1), pal.hull, 0.15, 6, 0.4, 0);
    b.sphere(T([0, 0, 0], 0, 0, 0, L * 0.3), 1, pal.glow, 1);
    parts.push(P(b.build(R), I(), { type: 'pulse', amp: 0.04, freq: 1.1 }));
    const halo = new MB(seed + 1, 0.1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      halo.shard(T([Math.cos(a) * L * 0.9, 0, Math.sin(a) * L * 0.9], -a, -Math.PI / 2 + 0.3, 0, L * 0.12, L * 0.12, L * 0.35), i % 2 ? pal.hull : pal.glow, i % 2 ? 0.1 : 0.9);
    }
    parts.push(P(halo.build(R), I(), { type: 'spin', axis: 'y', speed: 0.6 }));
    return { parts, radius: L * 1.3, engines: [], engineCol: pal.glow, glowCol: pal.glow };
  }
  const n = role === 'convoy' ? 3 : 5;
  b.shard(T([0, 0, 0], 0, 0, 0, L * 0.35, L * 0.35, L), pal.hull, 0.1, 6, 0.45, -0.1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r() * 0.3;
    b.shard(T([Math.cos(a) * L * 0.3, Math.sin(a) * L * 0.3, -L * 0.2], Math.cos(a) * 0.35, -Math.sin(a) * 0.35, 0, L * 0.18, L * 0.18, L * (0.5 + r() * 0.3)), col.mix(pal.hull, pal.dark, r() * 0.5), 0.05);
  }
  b.sphere(T([0, 0, L * 0.1], 0, 0, 0, L * 0.18), 1, pal.glow, 1);
  if (role === 'convoy') for (let i = 0; i < 4; i++) b.box(T([0, -L * 0.4, -L * 0.6 + i * L * 0.35], 0, 0, 0.785, L * 0.3, L * 0.3, L * 0.25), pal.dark, 0);
  parts.push(P(b.build(R)));
  const orb = new MB(seed + 3, 0.1);
  orb.shard(T([0, 0, 0], 0, -Math.PI / 2, 0, L * 0.08, L * 0.08, L * 0.2), pal.glow, 0.9);
  const om = orb.build(R);
  for (let i = 0; i < 3; i++) parts.push(P(om, I(), { type: 'orbit', r: L * 0.7, speed: 1.6, phase: (i / 3) * TAU, bob: L * 0.1 }));
  return { parts, radius: L * 1.1, engines: [[0, 0, -L]], engineCol: pal.glow, glowCol: pal.glow };
}

function synthetic(R, role, pal, seed) {
  const parts = [];
  const sizes = { warden: 9, keystone: 14, convoy: 10, fighter: 1.5 };
  const L = sizes[role] || 9;
  const b = new MB(seed, 0.05);
  if (role === 'fighter') {
    b.cyl(T([0, 0, 0], 0, 0, 0, 1, 1, 2.4), 0.6, 0.3, 6, pal.hull, 0);
    b.box(T([0, 0, 1.2], 0, 0, 0, 0.3), pal.glow, 1);
    parts.push(P(b.build(R)));
    return { parts, radius: 2, engines: [[0, 0, -1.2]], engineCol: pal.glow, glowCol: pal.glow };
  }
  if (role === 'keystone') {
    // Archive core: luminous memory sphere in counter-rotating gimbals.
    b.sphere(T([0, 0, 0], 0, 0, 0, L * 0.45), 2, pal.glow, 0.9, { colorFn: (d) => (Math.abs(d[1]) < 0.15 ? [pal.dark, 0] : [pal.glow, 0.9]) });
    for (const sx of [-1, 1]) b.cyl(T([0, sx * L * 0.6, 0], 0, Math.PI / 2, 0, 1, 1, L * 0.4), L * 0.15, L * 0.3, 6, pal.hull, 0);
    parts.push(P(b.build(R)));
    for (let k = 0; k < 2; k++) {
      const g = new MB(seed + k, 0.05);
      g.torus(I(), L * (0.75 + k * 0.2), L * 0.05, 6, 3, pal.hull, 0, (i) => [i % 2 ? pal.hull : pal.dark, 0]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.box(T([Math.cos(a) * L * (0.75 + k * 0.2), Math.sin(a) * L * (0.75 + k * 0.2), 0], 0, 0, a, L * 0.12), pal.glow, 0.8);
      }
      parts.push(P(g.build(R), T([0, 0, 0], k * 1.2, 0.5, 0), { type: 'spin', axis: k ? 'x' : 'y', speed: k ? -0.5 : 0.7 }));
    }
    return { parts, radius: L * 1.2, engines: [], engineCol: pal.glow, glowCol: pal.glow };
  }
  if (role === 'convoy') {
    for (let i = 0; i < 4; i++) b.cyl(T([0, 0, -L * 0.8 + i * L * 0.5], 0, 0, 0, 1, 1, L * 0.42), L * 0.28, L * 0.28, 6, i % 2 ? pal.hull : pal.dark, 0);
    b.box(T([0, 0, 0], 0, 0, 0, L * 0.08, L * 0.08, L * 2), pal.glow, 0.8);
  } else {
    b.cyl(T([0, 0, 0], 0, 0, 0, 1, 1, L * 1.8), L * 0.35, L * 0.25, 6, pal.hull, 0, true, pal.dark);
    b.sphere(T([0, 0, L * 0.95], 0, 0, 0, L * 0.22), 1, pal.glow, 1);
    for (const sx of [-1, 1]) {
      b.box(T([sx * L * 0.55, 0, -L * 0.2], 0, 0, sx * 0.2, L * 0.6, L * 0.06, L * 1.0), pal.dark);
      b.box(T([sx * L * 0.85, 0, -L * 0.2], 0, 0, 0, L * 0.04, L * 0.1, L * 0.8), pal.glow, 0.9);
    }
  }
  parts.push(P(b.build(R)));
  const ring = new MB(seed + 4, 0.05);
  ring.torus(I(), L * 0.5, L * 0.04, 6, 3, pal.dark, 0);
  parts.push(P(ring.build(R), T([0, 0, -L * 0.5]), { type: 'spin', axis: 'z', speed: 1.4 }));
  return { parts, radius: L * 1.1, engines: [[0, 0, -L * 0.9]], engineCol: pal.glow, glowCol: pal.glow };
}

function colonial(R, role, pal, seed) {
  const parts = [];
  const r = rng(seed);
  const sizes = { warden: 9, keystone: 20, convoy: 10, fighter: 1.5 };
  const L = sizes[role] || 9;
  const b = new MB(seed, 0.1);
  if (role === 'fighter') {
    b.sphere(T([0, 0, 0], 0, 0, 0, 0.9), 1, pal.hull, 0.1);
    parts.push(P(b.build(R), I(), { type: 'pulse', amp: 0.1, freq: 1.5 }));
    return { parts, radius: 2, engines: [], engineCol: pal.glow, glowCol: pal.glow };
  }
  const blobs = role === 'keystone' ? 7 : role === 'convoy' ? 4 : 3;
  for (let i = 0; i < blobs; i++) {
    const s = L * (role === 'keystone' && i === 0 ? 0.75 : 0.35 + r() * 0.2);
    const p = i === 0 ? [0, 0, 0] : [(r() - 0.5) * L * 0.9, (r() - 0.3) * L * 0.4, (r() - 0.5) * L * 1.2];
    b.sphere(T(p, 0, 0, 0, s, s * 0.85, s * 1.15), 2, pal.hull, 0, {
      jitter: 0.08,
      seed: seed + i,
      colorFn: (d) => (d[1] < -0.6 ? [pal.glow, 0.8] : Math.abs(d[0]) < 0.08 ? [pal.dark, 0] : [col.mix(pal.hull, pal.accent, d[1] * 0.3 + 0.3), 0]),
    });
  }
  if (role === 'keystone') {
    // The command organism: eye clusters along the front.
    for (let i = 0; i < 5; i++) b.sphere(T([(i - 2) * L * 0.15, L * 0.1, L * 0.82], 0, 0, 0, L * 0.07), 1, pal.glow, 1);
  }
  if (role === 'convoy') for (let i = 0; i < 3; i++) b.box(T([0, -L * 0.5, -L * 0.4 + i * L * 0.4], 0, 0, 0, L * 0.3), pal.dark, 0);
  parts.push(P(b.build(R), I(), { type: 'pulse', amp: role === 'keystone' ? 0.04 : 0.03, freq: 0.5 }));
  const tn = role === 'keystone' ? 9 : 4;
  for (let i = 0; i < tn; i++) {
    const tb = new MB(seed + 50 + i, 0.08);
    const pts = [];
    const len = L * (role === 'keystone' ? 1.6 : 1.1);
    for (let k = 0; k <= 7; k++) pts.push([Math.sin(k * 0.8 + i) * len * 0.06, -k / 7 * len, Math.cos(k * 0.6) * len * 0.05]);
    tb.tube(pts, L * 0.06, L * 0.01, 4, pal.accent, 0, (u) => (Math.floor(u * 7) % 3 === 1 ? [pal.glow, 0.8] : [pal.accent, 0]));
    const a = (i / tn) * TAU;
    parts.push(P(tb.build(R), T([Math.cos(a) * L * 0.25, -L * 0.3, Math.sin(a) * L * 0.3]), { type: 'sway', amp: 0.3, freq: 0.7, phase: i * 1.3 }));
  }
  return { parts, radius: L * 1.2, engines: [], engineCol: pal.glow, glowCol: pal.glow };
}

function raider(R, role, pal, seed) {
  const parts = [];
  const r = rng(seed);
  const L = role === 'raiderBig' ? 14 : 7;
  const b = new MB(seed, 0.12);
  b.cyl(T([0, 0, 0], 0, 0, 0, 1, 0.6, L * 2), L * 0.35, L * 0.1, 5, pal.hull, 0, true, pal.dark);
  for (let i = 0; i < 4; i++) {
    const sx = i % 2 ? 1 : -1;
    b.box(T([sx * L * (0.4 + r() * 0.3), (r() - 0.5) * L * 0.3, -L * 0.4 + r() * L * 0.8], r() * 0.6, 0, sx * (0.3 + r() * 0.5), L * (0.5 + r() * 0.6), L * 0.08, L * (0.3 + r() * 0.5)), i % 3 ? pal.dark : pal.accent);
  }
  b.box(T([0, L * 0.25, L * 0.2], 0, 0, 0, L * 0.12, L * 0.06, L * 0.8), pal.glow, 1);
  b.box(T([0, 0, -L * 1.02], 0, 0, 0, L * 0.4, L * 0.3, L * 0.05), pal.glow, 1);
  parts.push(P(b.build(R)));
  return { parts, radius: L * 1.2, engines: [[0, 0, -L * 1.05]], engineCol: pal.glow, glowCol: pal.glow };
}

const BUILDERS = { bloom, array, ascendancy, crystalline: crystal, synthetic, colonial, raider };

// ======================== INHERITED TRAITS ========================
// The same discovery expressed through each faction's design language.
export function addTraitVisual(R, style, trait, v) {
  const s = v.radius / 25; // scale relative to flagship size
  const deep = trait.tier === 'integrated';
  const id = trait.id;
  const seed = hashStr(style + id);
  const pal = PAL[style];
  const tc = trait.color || [0.6, 0.9, 1];
  if (!pal) return;
  const b = new MB(seed, 0.08);
  let anim = null;
  let base = I();
  if (style === 'bloom') {
    if (id === 'resonance') {
      // Crystalline organs grown between armour plates.
      const n = deep ? 10 : 6;
      for (let i = 0; i < n; i++) {
        const z = (-0.6 + (i / (n - 1)) * 1.2) * 20 * s;
        for (const sx of [-1, 1]) b.shard(T([sx * 6 * s, 5 * s, z], sx * 0.4, -1.1, 0, 1.2 * s, 1.2 * s, 3.2 * s), tc, 0.6);
      }
      anim = { type: 'pulse', amp: 0.04, freq: 1.2 };
    } else if (id === 'gravity') {
      b.sphere(T([0, -7 * s, 4 * s], 0, 0, 0, 4.5 * s), 2, [0.25, 0.1, 0.4], 0.2, { colorFn: (d) => (d[2] > 0.6 ? [tc, 1] : [[0.25, 0.1, 0.35], 0.1]) });
      anim = { type: 'pulse', amp: 0.08, freq: 0.6 };
    } else if (id === 'regrowth') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        b.cyl(T([Math.cos(a) * 5 * s, 6 * s + Math.sin(a) * 2 * s, -8 * s], Math.cos(a) * 0.8, -0.9, 0, 1, 1, 8 * s), 0.8 * s, 0, 4, tc, 0.4);
      }
      anim = { type: 'sway', amp: 0.15, freq: 1, phase: 0 };
    } else {
      for (let i = 0; i < 4; i++) b.sphere(T([(i % 2 ? 1 : -1) * 7 * s, -2 * s, (-6 + i * 4) * s], 0, 0, 0, 2.4 * s, 2 * s, 3 * s), 1, pal.sac, 0.7, { jitter: 0.15 });
      anim = { type: 'pulse', amp: 0.1, freq: 0.8 };
    }
  } else if (style === 'array') {
    if (id === 'resonance') {
      // Unfolding geometric shield lattice.
      const n = deep ? 8 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        b.box(T([Math.cos(a) * 12 * s, Math.sin(a) * 12 * s, 6 * s], 0, 0, a, 0.3 * s, 7 * s, 0.3 * s), pal.mid);
        b.box(T([Math.cos(a) * 12.4 * s, Math.sin(a) * 12.4 * s, 6 * s], 0, 0, a, 0.15 * s, 5.5 * s, 2.5 * s), tc, 0.8);
      }
      anim = { type: 'spin', axis: 'z', speed: 0.25 };
    } else if (id === 'gravity') {
      for (const sx of [-1, 1]) b.box(T([sx * 3 * s, -4 * s, 10 * s], 0, 0, 0, 1 * s, 1 * s, 26 * s), pal.dark, 0, [tc, tc, pal.dark, pal.dark, pal.dark, pal.dark]);
      b.box(T([0, -4 * s, 23 * s], 0, 0, 0, 7 * s, 1.2 * s, 1.2 * s), tc, 1);
    } else if (id === 'regrowth') {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        b.box(T([Math.cos(a) * 8 * s, Math.sin(a * 3) * 3 * s, Math.sin(a) * 14 * s], a, a, 0, 0.9 * s), tc, 0.8);
      }
      anim = { type: 'spin', axis: 'y', speed: 0.8 };
    } else {
      for (const sx of [-1, 1]) {
        b.box(T([sx * 9 * s, 4 * s, -4 * s], 0, 0, 0, 3 * s, 2.5 * s, 12 * s), pal.mid);
        for (let k = 0; k < 4; k++) b.box(T([sx * 10.6 * s, 4 * s, (-9 + k * 3.3) * s], 0, 0, 0, 0.2 * s, 1.5 * s, 1.5 * s), tc, 0.9);
      }
    }
  } else if (style === 'ascendancy') {
    if (id === 'resonance') {
      // Rotating resonance emitters on pylons.
      const n = deep ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const e = new MB(seed + k, 0.05);
        e.torus(I(), 3 * s, 0.5 * s, 16, 4, pal.gold, 0, (i) => [i % 4 === 0 ? tc : pal.gold, i % 4 === 0 ? 1 : 0.1]);
        e.sphere(T([0, 0, 0], 0, 0, 0, 1.2 * s), 1, tc, 1);
        const zz = (-8 + k * 9) * s;
        v.parts.push(P(e.build(R), T([0, 10 * s, zz], 0, Math.PI / 2, 0), { type: 'spin', axis: 'z', speed: 1.5 + k * 0.3 }));
        b.box(T([0, 7.5 * s, zz], 0, 0, 0, 0.8 * s, 5 * s, 0.8 * s), pal.navy);
      }
    } else if (id === 'gravity') {
      b.torus(T([0, 0, 25 * s]), 4 * s, 0.9 * s, 18, 4, pal.navy, 0, (i) => [i % 3 === 0 ? tc : pal.navy, i % 3 === 0 ? 1 : 0]);
      for (const sx of [-1, 1]) b.box(T([sx * 3 * s, 0, 20 * s], 0, 0, 0, 0.8 * s, 0.8 * s, 10 * s), pal.gold, 0.1);
    } else if (id === 'regrowth') {
      for (const sx of [-1, 1]) {
        b.cyl(T([sx * 10 * s, 3 * s, -6 * s]), 2.2 * s, 2.2 * s, 8, pal.hull, 0, true, tc, 0.8);
        b.box(T([sx * 10 * s, 5.4 * s, -6 * s], 0, 0, 0, 2 * s, 0.4 * s, 2 * s), tc, 1);
      }
    } else {
      for (const sx of [-1, 1]) {
        b.box(T([sx * 13 * s, -3 * s, -2 * s], 0, 0, 0, 3.5 * s, 3 * s, 18 * s), pal.hull, 0, [pal.hull, pal.hull, pal.navy, pal.navy, pal.hull, pal.navy]);
        b.box(T([sx * 14.8 * s, -3 * s, -2 * s], 0, 0, 0, 0.1 * s, 1.8 * s, 14 * s), pal.hangar, 1);
      }
    }
  }
  if (b.v.length) v.parts.push(P(b.build(R), base, anim));
  v.traitGlow = tc;
}

// ======================== STATIONS & LANDMARKS ========================
export function homeStation(R, faction, seed) {
  const pal = PAL[faction];
  const parts = [];
  if (faction === 'bloom') {
    // Gigantic living nursery.
    const b = new MB(seed, 0.1);
    b.sphere(T([0, 0, 0], 0, 0, 0, 55, 48, 55), 3, pal.hull, 0, {
      jitter: 0.12,
      seed,
      colorFn: (d) => (Math.abs(d[1]) < 0.1 ? [pal.vein, 0.9] : d[1] < -0.5 ? [pal.flesh, 0] : [col.mix(pal.shell, pal.hull, d[1] * 0.5 + 0.5), 0]),
    });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      b.sphere(T([Math.cos(a) * 52, -18, Math.sin(a) * 52], 0, 0, 0, 12, 10, 12), 2, pal.sac, 0.8, { jitter: 0.1 });
    }
    parts.push(P(b.build(R), I(), { type: 'pulse', amp: 0.015, freq: 0.2 }));
    const petals = new MB(seed + 1, 0.1);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      petals.sphere(T([Math.cos(a) * 40, 50, Math.sin(a) * 40], -a, 0, 0.9, 10, 3, 38), 1, pal.shell, 0, { colorFn: (d) => (d[1] > 0.6 ? [pal.vein, 0.6] : [pal.shell, 0]) });
    }
    parts.push(P(petals.build(R), I(), { type: 'spin', axis: 'y', speed: 0.05 }));
    const pods = new MB(seed + 2, 0.1);
    for (let i = 0; i < 12; i++) {
      const pts = [];
      const a = (i / 12) * TAU;
      for (let k = 0; k <= 8; k++) pts.push([Math.cos(a) * (40 + k * 2), -40 - k * 10, Math.sin(a) * (40 + k * 2)]);
      pods.tube(pts, 4, 0.6, 5, pal.flesh, 0, (u) => (Math.floor(u * 8) % 3 === 0 ? [pal.vein, 0.9] : [pal.flesh, 0]));
    }
    parts.push(P(pods.build(R), I(), { type: 'sway', amp: 0.04, freq: 0.4 }));
    return { parts, radius: 90, dock: [0, -10, 85], engines: [], glowCol: pal.vein };
  }
  if (faction === 'array') {
    const b = new MB(seed, 0.05);
    b.box(T([0, 0, 0], 0, 0, 0, 40, 30, 40), pal.hull, 0, [pal.hull, pal.mid, pal.hull, pal.mid, pal.hull, pal.dark]);
    b.cyl(T([0, 30, 0], 0, Math.PI / 2, 0, 1, 1, 30), 8, 8, 8, pal.mid, 0);
    b.cyl(T([0, -35, 0], 0, Math.PI / 2, 0, 1, 1, 40), 12, 4, 8, pal.dark, 0);
    for (let i = 0; i < 16; i++) b.box(T([(i % 4) * 10 - 15, 0, 20.2], 0, 0, 0, 3, 3, 0.3), i % 3 ? pal.light : pal.accent, 1);
    // Immense assembly frames
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      const cx = Math.cos(a) * 95, cz = Math.sin(a) * 95;
      const fr = T([cx, 0, cz], -a + Math.PI / 2);
      const add = (p, s) => b.box(m4.mul(fr, T(p, 0, 0, 0, s[0], s[1], s[2])), pal.mid);
      for (const y of [-25, 25]) for (const x of [-15, 15]) add([x, y, 0], [3, 3, 80]);
      for (let z = -40; z <= 40; z += 20) {
        add([0, 25, z], [30, 2, 2]);
        add([0, -25, z], [30, 2, 2]);
        add([15, 0, z], [2, 50, 2]);
        add([-15, 0, z], [2, 50, 2]);
      }
      b.box(m4.mul(fr, T([0, 26.5, 0], 0, 0, 0, 2, 0.5, 70)), pal.accent, 1);
      b.box(m4.mul(T([0, 0, 0], -a + Math.PI / 2), T([0, 0, 50], 0, 0, 0, 5, 5, 60)), pal.dark);
    }
    parts.push(P(b.build(R)));
    const ring = new MB(seed + 3, 0.05);
    ring.torus(I(), 60, 2.5, 48, 4, pal.mid, 0, (i) => [i % 6 === 0 ? pal.light : pal.mid, i % 6 === 0 ? 1 : 0]);
    parts.push(P(ring.build(R), T([0, 0, 0], 0, Math.PI / 2, 0), { type: 'spin', axis: 'z', speed: 0.08 }));
    return { parts, radius: 140, dock: [95, 0, 0], engines: [], glowCol: pal.light };
  }
  // Ascendancy: station core + monumental drydock.
  const b = new MB(seed, 0.05);
  b.cyl(T([0, 0, 0], 0, Math.PI / 2, 0, 1, 1, 70), 18, 12, 10, pal.hull, 0);
  b.cyl(T([0, 40, 0], 0, Math.PI / 2, 0, 1, 1, 12), 6, 3, 10, pal.navy, 0);
  b.torus(T([0, 0, 0], 0, Math.PI / 2, 0), 45, 4, 40, 5, pal.hull, 0, (i, j) => [j === 2 && i % 2 ? pal.hangar : i % 5 === 0 ? pal.gold : pal.hull, j === 2 && i % 2 ? 0.8 : 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    b.box(T([Math.cos(a) * 25, 0, Math.sin(a) * 25], -a, 0, 0, 3, 3, 40), pal.navy);
  }
  // Drydock frame
  const dx = 110;
  for (const y of [-14, 14]) for (const z of [-14, 14]) b.box(T([dx, y, z], 0, 0, 0, 110, 3, 3), pal.hull);
  for (let x = dx - 50; x <= dx + 50; x += 20) {
    b.box(T([x, 0, -14], 0, 0, 0, 3, 28, 3), pal.navy);
    b.box(T([x, 0, 14], 0, 0, 0, 3, 28, 3), pal.navy);
    b.box(T([x, 14, 0], 0, 0, 0, 3, 3, 28), pal.gold, 0.1);
    b.box(T([x, -14, 0], 0, 0, 0, 2, 2, 28), pal.hangar, 0.7);
  }
  parts.push(P(b.build(R)));
  return { parts, radius: 160, dock: [dx, 0, 0], engines: [], glowCol: pal.hangar };
}

export function civStation(R, style, pal, seed) {
  const parts = [];
  const b = new MB(seed, 0.08);
  if (style === 'crystalline') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      const up = i % 2 ? 1 : -1;
      b.shard(T([Math.cos(a) * 12, up * 20, Math.sin(a) * 12], -a, up > 0 ? -Math.PI / 2 + 0.25 : Math.PI / 2 - 0.25, 0, 7, 7, 30 + (i % 3) * 12), i % 3 ? pal.hull : pal.dark, 0.1);
    }
    b.shard(T([0, 0, 0], 0, -Math.PI / 2, 0, 16, 16, 75), pal.hull, 0.15, 6, 0.35, 0);
    b.sphere(T([0, 0, 0], 0, 0, 0, 14), 2, pal.glow, 1);
    parts.push(P(b.build(R)));
    const ring = new MB(seed + 1, 0.08);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      ring.shard(T([Math.cos(a) * 55, 0, Math.sin(a) * 55], -a, 0.3, 0, 3, 3, 9), i % 3 ? pal.hull : pal.glow, i % 3 ? 0.1 : 0.9);
    }
    parts.push(P(ring.build(R), I(), { type: 'spin', axis: 'y', speed: 0.15 }));
  } else if (style === 'synthetic') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const r0 = i === 0 ? 0 : 22;
      const h = i === 0 ? 90 : 40 + (i % 3) * 15;
      b.cyl(T([Math.cos(a) * r0, 0, Math.sin(a) * r0], 0, Math.PI / 2, 0, 1, 1, h), 10, 10, 6, i % 2 ? pal.hull : pal.dark, 0);
      b.box(T([Math.cos(a) * r0, h / 2 + 1, Math.sin(a) * r0], 0, 0, 0, 6, 2, 6), pal.glow, 1);
    }
    parts.push(P(b.build(R)));
    const ring = new MB(seed + 1, 0.05);
    ring.torus(I(), 60, 3, 6, 3, pal.hull, 0, (i) => [i % 2 ? pal.glow : pal.hull, i % 2 ? 0.8 : 0]);
    parts.push(P(ring.build(R), T([0, 0, 0], 0, Math.PI / 2, 0), { type: 'spin', axis: 'z', speed: 0.1 }));
  } else {
    const r = rng(seed);
    for (let i = 0; i < 14; i++) {
      const s = i === 0 ? 34 : 8 + r() * 14;
      const p = i === 0 ? [0, 0, 0] : [(r() - 0.5) * 100, (r() - 0.5) * 40, (r() - 0.5) * 100];
      b.sphere(T(p, 0, 0, 0, s, s * 0.8, s), 2, pal.hull, 0, {
        jitter: 0.08,
        seed: seed + i,
        colorFn: (d) => (d[1] < -0.55 ? [pal.glow, 0.8] : Math.abs(d[2]) < 0.06 ? [pal.dark, 0] : [col.mix(pal.hull, pal.accent, d[1] * 0.3 + 0.3), 0]),
      });
    }
    parts.push(P(b.build(R), I(), { type: 'pulse', amp: 0.01, freq: 0.15 }));
  }
  return { parts, radius: 70, engines: [], glowCol: pal.glow };
}

export function landmarkVisual(R, kind, pal, seed) {
  const b = new MB(seed, 0.1);
  const r = rng(seed);
  const parts = [];
  if (kind === 'spire') {
    for (let i = 0; i < 9; i++) {
      const a = r() * TAU;
      b.shard(T([Math.cos(a) * r() * 30, 0, Math.sin(a) * r() * 30], a, -Math.PI / 2 + (r() - 0.5) * 0.6, (r() - 0.5) * 0.5, 8, 8, 40 + r() * 70), i % 3 ? pal.hull : pal.glow, i % 3 ? 0.15 : 0.8);
    }
  } else if (kind === 'gate') {
    b.torus(I(), 70, 7, 40, 6, pal.dark || [0.3, 0.3, 0.35], 0, (i, j) => [j === 3 ? pal.glow : i % 5 === 0 ? pal.accent || [0.6, 0.5, 0.3] : [0.32, 0.3, 0.34], j === 3 ? 0.8 : 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      b.box(T([Math.cos(a) * 78, Math.sin(a) * 78, 0], 0, 0, a, 22, 10, 18), [0.3, 0.29, 0.31]);
    }
    parts.push(P(b.build(R), T([0, 20, 0], 0.6, 0, 0)));
    const inner = new MB(seed + 1, 0.0);
    inner.torus(I(), 60, 1.2, 40, 3, pal.glow, 1);
    parts.push(P(inner.build(R), T([0, 20, 0], 0.6, 0, 0), { type: 'pulse', amp: 0.03, freq: 0.3 }));
    return { parts, radius: 90, engines: [], glowCol: pal.glow };
  } else if (kind === 'graveyard') {
    // Ribcage of a titanic creature.
    for (let i = 0; i < 9; i++) {
      const z = -60 + i * 15;
      for (const sx of [-1, 1]) {
        const pts = [];
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI * 0.8;
          pts.push([sx * Math.sin(a) * (30 - Math.abs(z) * 0.2), Math.cos(a) * 30 - 10, z]);
        }
        b.tube(pts, 3, 1, 5, [0.75, 0.7, 0.62]);
      }
    }
    b.tube([[0, 20, -80], [0, 22, -40], [0, 21, 0], [0, 20, 40], [0, 15, 75]], 5, 3, 6, [0.7, 0.65, 0.55]);
    b.sphere(T([0, 10, 0], 0, 0, 0, 6), 1, pal.glow, 0.9);
  } else if (kind === 'foundry') {
    for (let i = 0; i < 12; i++) {
      b.box(T([(r() - 0.5) * 120, (r() - 0.5) * 40, (r() - 0.5) * 120], r() * 3, r() * 0.6, r() * 0.6, 10 + r() * 30, 5 + r() * 25, 10 + r() * 30), col.mix([0.35, 0.33, 0.3], [0.5, 0.42, 0.35], r()), 0);
    }
    for (let i = 0; i < 8; i++) b.box(T([(r() - 0.5) * 120, (r() - 0.5) * 40, (r() - 0.5) * 120], r() * 3, r(), 0, 2, 2, 60 + r() * 50), [0.4, 0.38, 0.36]);
    for (let i = 0; i < 6; i++) b.box(T([(r() - 0.5) * 100, (r() - 0.5) * 30, (r() - 0.5) * 100], 0, 0, 0, 3), pal.glow, 1);
  } else if (kind === 'wreck') {
    // Broken hull of an unknown vessel.
    b.loft(T([0, 0, 18], 0, 0.15, 0.3), [{ z: -14, w: 6, h: 4 }, { z: 0, w: 8, h: 5 }, { z: 16, w: 3, h: 2 }], 7, [0.32, 0.3, 0.28], 0, { colorFn: (z, a) => [Math.sin(a * 3) > 0.7 ? [0.5, 0.4, 0.3] : [0.3, 0.28, 0.27], 0] });
    b.loft(T([3, -4, -16], 0.5, -0.2, -0.6), [{ z: -12, w: 7, h: 5 }, { z: 6, w: 8, h: 5 }], 7, [0.28, 0.26, 0.26], 0);
    for (let i = 0; i < 10; i++) b.box(T([(r() - 0.5) * 30, (r() - 0.5) * 15, (r() - 0.5) * 50], r() * 3, r() * 3, r() * 3, 1 + r() * 4, 0.5, 1 + r() * 5), [0.35, 0.33, 0.3]);
    b.box(T([1, 0, 3], 0, 0, 0, 2.5), [1, 0.55, 0.2], 1);
    parts.push(P(b.build(R), I(), { type: 'spin', axis: 'y', speed: 0.03 }));
    return { parts, radius: 40, engines: [], glowCol: [1, 0.6, 0.2] };
  } else if (kind === 'node') {
    // Integration site (placeholder; actual look comes from faction).
    b.sphere(I(), 1, pal.glow, 1);
  }
  parts.push(P(b.build(R)));
  return { parts, radius: 80, engines: [], glowCol: pal.glow };
}

// Integration node: what the player builds to assimilate. Faction-styled.
export function integrationNode(R, faction, seed) {
  const pal = PAL[faction];
  const b = new MB(seed, 0.08);
  const parts = [];
  if (faction === 'bloom') {
    b.sphere(T([0, 0, 0], 0, 0, 0, 14, 10, 14), 2, pal.flesh, 0, { jitter: 0.15, colorFn: (d) => (d[1] > 0.5 ? [pal.vein, 0.9] : [pal.flesh, 0]) });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      b.tube([[Math.cos(a) * 10, 0, Math.sin(a) * 10], [Math.cos(a) * 22, -6, Math.sin(a) * 22], [Math.cos(a) * 30, -14, Math.sin(a) * 30]], 2.2, 0.4, 5, pal.hull, 0, (u) => (u > 0.5 ? [pal.vein, 0.8] : [pal.hull, 0]));
    }
    parts.push(P(b.build(R), I(), { type: 'pulse', amp: 0.05, freq: 0.6 }));
  } else if (faction === 'array') {
    b.box(T([0, 0, 0], 0.785, 0.6, 0, 14), pal.hull, 0, [pal.hull, pal.mid, pal.hull, pal.mid, pal.dark, pal.dark]);
    b.cyl(T([0, 16, 0], 0, Math.PI / 2, 0, 1, 1, 22), 1, 0.4, 4, pal.mid, 0);
    b.box(T([0, 28, 0], 0, 0, 0, 3), pal.light, 1);
    parts.push(P(b.build(R)));
    const ring = new MB(seed + 1);
    ring.torus(I(), 22, 1, 24, 4, pal.mid, 0, (i) => [i % 4 === 0 ? pal.accent : pal.mid, i % 4 === 0 ? 1 : 0]);
    parts.push(P(ring.build(R), T([0, 0, 0], 0, Math.PI / 2, 0), { type: 'spin', axis: 'z', speed: 1 }));
  } else {
    b.cyl(T([0, 0, 0], 0, Math.PI / 2, 0, 1, 1, 26), 9, 5, 8, pal.hull, 0);
    b.cyl(T([0, 15, 0], 0, Math.PI / 2, 0, 1, 1, 4), 12, 12, 8, pal.navy, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      b.box(T([Math.cos(a) * 12, 17.5, Math.sin(a) * 12], -a, 0, 0, 1.5, 1, 1.5), pal.hangar, 1);
      b.box(T([Math.cos(a) * 16, 0, Math.sin(a) * 16], -a, 0, 0, 2, 20, 2), pal.gold, 0.1);
    }
    parts.push(P(b.build(R)));
  }
  return { parts, radius: 32, engines: [], glowCol: pal.engine };
}

// Boarding craft: a fast chassis with forward grapples in the faction's own material.
function addBoardingClaws(R, style, pal, v) {
  const L = v.radius;
  const c = style === 'bloom' ? pal.flesh : style === 'array' ? pal.accent : pal.gold || pal.accent || [0.8, 0.7, 0.4];
  const g = style === 'bloom' ? pal.vein : style === 'array' ? pal.light : pal.hangar || pal.glow || [1, 0.8, 0.5];
  const b = new MB(91, 0.08);
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const u = k / 5;
      pts.push([sx * (L * 0.35 - u * L * 0.25), -u * L * 0.1, L * 0.2 + u * L * 0.9]);
    }
    b.tube(pts, L * 0.07, L * 0.02, 4, c, 0, (u) => (u > 0.8 ? [g, 1] : [c, 0]));
  }
  b.box(T([0, -L * 0.2, 0], 0, 0, 0, L * 0.5, L * 0.18, L * 0.7), c, 0);
  v.parts.push(P(b.build(R), I(), style === 'bloom' ? { type: 'pulse', amp: 0.06, freq: 1.2 } : style === 'array' ? { type: 'slide', axis: 'z', amp: L * 0.06, freq: 2 } : null));
  v.radius *= 1.1;
}
