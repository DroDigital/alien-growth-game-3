// Builds the local worlds: the evolving home system and generated civilization systems.
import { col, rng, v3, m4 } from './math.js';
import { MB, T, I, planetMesh, asteroidField } from './meshgen.js';
import { World } from './sim.js';
import { FACTIONS, TRAITS } from './data.js';
import { makeShip, makeHomeStation, makeCivStation, makeLandmark, civShipOpts } from './entities.js';
import { addTraitVisual, civStation, getVisual, PAL } from './designs.js';

const meshCache = new Map();
function cached(key, fn) {
  if (!meshCache.has(key)) meshCache.set(key, fn());
  return meshCache.get(key);
}

function starMesh(R) {
  return cached('star', () => {
    const b = new MB(3, 0.0);
    b.sphere(I(), 3, [1, 1, 1], 1, { colorFn: () => [[1, 1, 1], 1] });
    return b.build(R);
  });
}

function ringMesh(R, key, inner, outer, c, seed) {
  return cached(key, () => {
    const b = new MB(seed, 0.15);
    b.annulus(I(), inner, outer, 96, c, 0.05, (u) => [col.mul(c, 0.55 + 0.45 * Math.abs(Math.sin(u * 61)) * (Math.sin(u * 9) * 0.3 + 0.7)), 0.05]);
    return b.build(R);
  });
}

function orbitalCity(R, pal) {
  return cached('orbcity', () => {
    const b = new MB(9, 0.06);
    b.torus(I(), 1.45, 0.025, 120, 4, pal.hull, 0, (i, j) => [j === 1 && i % 3 === 0 ? pal.hangar : i % 10 === 0 ? pal.gold : pal.hull, j === 1 && i % 3 === 0 ? 0.9 : 0]);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      b.box(T([Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0], 0, 0, a, 0.03, 0.06 + (i % 4) * 0.02, 0.05), i % 5 ? pal.hull : pal.navy, 0);
      if (i % 2) b.box(T([Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0], 0, 0, a, 0.01, 0.02, 0.06), pal.hangar, 1);
    }
    return b.build(R);
  });
}

export function homeEnv(faction) {
  const h = FACTIONS[faction].home;
  return {
    bg: h.bg,
    neb1: h.neb1,
    neb2: h.neb2,
    starPos: [-2600, 320, -2000],
    starCol: h.star,
    ambUp: h.ambUp,
    ambDown: h.ambDown,
    fog: col.mul(h.neb1, 0.4),
    fogDen: 0.00005,
    skySeed: 0.17,
    nebAmt: 1,
  };
}

export const HOME_LAYOUT = {
  planet: [0, -60, 0],
  station: [360, 0, 180],
  fleet: [620, 0, 520],
  wreck: [-760, 30, 900],
  arrival: [900, 0, 900],
};

export function buildHomeWorld(game) {
  const R = game.R;
  const f = game.faction;
  const h = FACTIONS[f].home;
  const env = homeEnv(f);
  const bodies = [];
  bodies.push({ type: 'star', mesh: starMesh(R), pos: env.starPos, size: h.starSize * 2.4, col: h.star });
  bodies.push({ type: 'planet', mesh: cached('planet-' + f, () => planetMesh(R, h.planet, 101, {}, 4)), pos: HOME_LAYOUT.planet, size: h.planetSize, spin: 0.012, atmo: h.planet === 'industrial' ? [1, 0.6, 0.3] : [0.4, 0.7, 1] });
  if (f === 'bloom') {
    bodies.push({ type: 'mesh', mesh: cached('reef', () => asteroidField(R, 44, 220, 330, 14, 230, [0.55, 0.32, 0.5])), pos: HOME_LAYOUT.planet, size: 1, spin: 0.01, tilt: 0.25 });
    bodies.push({ type: 'mesh', mesh: cached('reef2', () => asteroidField(R, 45, 120, 300, 8, 250, [0.2, 0.55, 0.5])), pos: HOME_LAYOUT.planet, size: 1, spin: 0.013, tilt: 0.25 });
  } else if (f === 'array') {
    // Industrial moons
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      bodies.push({ type: 'planet', mesh: cached('moon' + i, () => planetMesh(R, 'industrial', 200 + i, {}, 2)), pos: [Math.cos(a) * (420 + i * 140), -40 + i * 30, Math.sin(a) * (420 + i * 140) - 300], size: 30 + i * 8, spin: 0.03 });
    }
  } else {
    bodies.push({ type: 'mesh', mesh: orbitalCity(R, PAL.ascendancy), pos: HOME_LAYOUT.planet, size: h.planetSize, spin: 0.02, tilt: 1.35, emBoost: 0.4 });
    bodies.push({ type: 'mesh', mesh: orbitalCity(R, PAL.ascendancy), pos: HOME_LAYOUT.planet, size: h.planetSize * 1.12, spin: -0.015, tilt: 1.1 });
  }
  bodies.push({ type: 'mesh', mesh: cached('homefield', () => asteroidField(R, 88, 160, 2200, 60, 1600)), pos: [0, 0, 0], size: 1, spin: 0.002 });

  const world = new World(game, { env, bodies, kind: 'home' });
  world.kind = 'home';
  world.name = h.name;
  world.arrival = HOME_LAYOUT.arrival;
  const st = makeHomeStation(R, f, HOME_LAYOUT.station);
  world.add(st);
  world.station = st;
  applyHomeUpgrades(game, world);
  return world;
}

export function makeWreck(game, world) {
  const w = makeLandmark(game.R, 'wreck', { glow: [1, 0.6, 0.2] }, 31, HOME_LAYOUT.wreck, 'Unidentified wreck');
  w.scan = { need: 14, progress: 0, label: 'Investigate wreck', key: 'wreck' };
  world.add(w);
  return w;
}

// Inheritances visibly change the home system's infrastructure.
export function applyHomeUpgrades(game, world) {
  const R = game.R;
  const f = game.faction;
  world.bodies = world.bodies.filter((b) => !b.upgrade);
  for (const e of world.entities) if (e.visitor) e.dead = true;
  const st = HOME_LAYOUT.station;
  let k = 0;
  for (const [id, t] of Object.entries(game.traits)) {
    const v = { parts: [], radius: 110, engines: [] };
    addTraitVisual(R, f, { id, tier: t.tier, color: TRAITS[id].color }, v);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + k * 0.6;
      const r = world.station.radius + 70 + k * 40;
      bodies_push(world, { type: 'visual', visual: v, pos: [st[0] + Math.cos(a) * r, st[1] + 40 - k * 30, st[2] + Math.sin(a) * r], size: 1, yaw: -a, upgrade: true, label: `${TRAITS[id].name} array` });
    }
    k++;
  }
  for (const c of Object.values(game.civs)) {
    const s = c.state;
    if (s.status === 'conquered') {
      // Captured shipyard rebuilt in the home system.
      const v = civStation(R, c.structure, c.pal, c.seed);
      bodies_push(world, { type: 'visual', visual: v, pos: [st[0] - 520, 20, st[2] + 420], size: 0.7, yaw: 0.5, upgrade: true, tint: col.mix([1, 1, 1], FACTIONS[f].color, 0.25), label: `Captured ${c.species} shipyard` });
    }
    if (s.status === 'assimilated') {
      const v = civStation(R, c.structure, col_pal_mix(c.pal, f), c.seed + 1);
      bodies_push(world, { type: 'visual', visual: v, pos: [st[0] + 380, -30, st[2] - 520], size: 0.6, yaw: 1.2, upgrade: true, label: `Hybrid ${c.species} reef` });
    }
    if (s.status === 'allied' || s.status === 'protectorate') {
      for (let i = 0; i < 2; i++) {
        const e = makeShip(R, { ...civShipOpts(c, 'warden', i), team: 'player', pos: [st[0] + 200 + i * 40, 30, st[2] + 200] });
        e.visitor = true;
        e.selectable = false;
        e.weapons = [];
        e.name = `${c.species} envoy`;
        e.order = { type: 'patrol', c: [...st], r: 260 + i * 60, a: i * 3 };
        e.ally = false;
        e.team = 'neutral';
        world.add(e);
      }
    }
  }
}

function bodies_push(world, b) {
  world.bodies.push(b);
}

function col_pal_mix(pal, f) {
  const fc = FACTIONS[f].color;
  return { hull: col.mix(pal.hull, fc, 0.3), dark: pal.dark, glow: col.mix(pal.glow, fc, 0.5), accent: pal.accent };
}

export const CIV_LAYOUT = {
  planet: [-500, -120, -380],
  station: [180, 0, -120],
  landmark: [1150, 10, 760],
  arrival: [-950, 0, 900],
  convoyStart: [1300, 0, 1100],
};

export function civEnv(civ) {
  const s = civ.sys;
  return {
    bg: s.bg,
    neb1: s.neb1,
    neb2: s.neb2,
    starPos: [-3000, 500, -2200],
    starCol: civ.stellar === 'remnant' ? [0.8, 0.88, 1.0] : s.star,
    ambUp: s.ambUp,
    ambDown: s.ambDown,
    fog: col.mul(s.neb1, 0.5),
    fogDen: civ.stellar === 'debris' ? 0.00012 : 0.00006,
    skySeed: (civ.seed % 1000) / 1000,
    nebAmt: civ.stellar === 'quiet' ? 0.6 : 1.1,
  };
}

export function buildCivWorld(game, civ) {
  const R = game.R;
  const env = civEnv(civ);
  const bodies = [];
  const sm = starMesh(R);
  if (civ.stellar === 'binary') {
    bodies.push({ type: 'star', mesh: sm, pos: env.starPos, size: 200, col: civ.sys.star, orbit: { c: env.starPos, r: 380, speed: 0.03, phase: 0 } });
    bodies.push({ type: 'star', mesh: sm, pos: env.starPos, size: 120, col: civ.sys.star2, orbit: { c: env.starPos, r: 380, speed: 0.03, phase: Math.PI } });
  } else if (civ.stellar === 'remnant') {
    bodies.push({ type: 'star', mesh: sm, pos: env.starPos, size: 60, col: [0.8, 0.9, 1], pulsar: true });
  } else {
    bodies.push({ type: 'star', mesh: sm, pos: env.starPos, size: civ.stellar === 'quiet' ? 180 : 150, col: civ.sys.star });
  }
  const hab = civ.texts.habitat.planet;
  const psize = hab === 'gas' ? 320 : 170;
  bodies.push({
    type: 'planet',
    mesh: cached('cplanet' + civ.seed, () => planetMesh(R, hab, civ.seed, { a: civ.sys.gasA, b: civ.sys.gasB, glow: civ.pal.glow }, 4)),
    pos: CIV_LAYOUT.planet,
    size: psize,
    spin: 0.01,
    atmo: hab === 'gas' ? civ.sys.gasA : civ.pal.glow,
  });
  if (hab === 'gas' || hab === 'crystal') bodies.push({ type: 'mesh', mesh: ringMesh(R, 'ring' + civ.seed, psize * 1.4, psize * 2.3, hab === 'gas' ? civ.sys.gasB : civ.pal.hull, civ.seed), pos: CIV_LAYOUT.planet, size: 1, spin: 0.004, tilt: 0.35 });
  if (hab === 'orbital') bodies.push({ type: 'mesh', mesh: cached('habs' + civ.seed, () => asteroidField(R, civ.seed, 90, psize * 2.2, 10, psize * 1.6, civ.pal.hull)), pos: CIV_LAYOUT.planet, size: 1, spin: 0.01, tilt: 0.2 });
  const debrisN = civ.stellar === 'debris' ? 520 : 140;
  bodies.push({ type: 'mesh', mesh: cached('cfield' + civ.seed, () => asteroidField(R, civ.seed + 5, debrisN, 2600, civ.stellar === 'debris' ? 220 : 60, 900)), pos: [0, 0, 0], size: 1, spin: 0.002 });

  const hazards = [];
  if (civ.stellar === 'remnant') hazards.push({ type: 'pulsar', pos: env.starPos });
  const world = new World(game, { env, bodies, civ, hazards, kind: 'civ' });
  world.kind = 'civ';
  world.name = `${civ.texts.stellar.name} — ${civ.species} space`;
  world.arrival = CIV_LAYOUT.arrival;

  const s = civ.state;
  const station = makeCivStation(R, civ, CIV_LAYOUT.station);
  station.selectable = true;
  station.scan = { need: 16, progress: s.intel.priorities ? 16 : 0, done: !!s.intel.priorities, label: 'Scan capital', key: 'station' };
  if (s.snap && s.snap.station) {
    station.hull = s.snap.station.hull;
    station.broken = s.snap.station.broken;
    if (station.broken) station.maxShield = station.shield = 0;
  }
  if (s.status === 'devastated') station.dead = true;
  if (['conquered', 'assimilated', 'protectorate'].includes(s.status)) {
    station.team = 'player';
    station.weapons = [];
    station.broken = false;
  }
  if (!station.dead) world.add(station);
  world.station = station;

  const lm = makeLandmark(R, civ.landmark.kind, civ.pal, civ.seed + 3, CIV_LAYOUT.landmark, civ.landmark.name);
  lm.selectable = true;
  lm.scan = { need: 14, progress: s.intel.landmark ? 14 : 0, done: !!s.intel.landmark, label: 'Investigate landmark', key: 'landmark' };
  world.add(lm);
  world.landmark = lm;

  // Civilization fleet (persisted between visits).
  const fleet = s.snap ? s.snap.ships : null;
  const spawn = (role, i, hull) => {
    const a = (i / 6) * Math.PI * 2;
    const e = makeShip(R, { ...civShipOpts(civ, role, i), team: ['conquered', 'assimilated', 'protectorate'].includes(s.status) ? 'player' : 'civ', pos: [CIV_LAYOUT.station[0] + Math.cos(a) * 220, 10, CIV_LAYOUT.station[2] + Math.sin(a) * 220] });
    e.home = [...CIV_LAYOUT.station];
    e.patrolR = 200 + i * 30;
    if (hull != null) e.hull = hull;
    if (role === 'keystone') {
      e.scan = { need: 10, progress: s.intel.vulnerability ? 10 : 0, done: !!s.intel.vulnerability, label: 'Scan vessel', key: 'keystone' };
      e.selectable = true;
    }
    if (e.team === 'player') {
      e.ally = true;
      e.selectable = false;
    }
    world.add(e);
    return e;
  };
  if (fleet) fleet.forEach((f, i) => spawn(f.role, i, f.hull));
  else {
    spawn('keystone', 0);
    for (let i = 1; i <= civ.fleetSize; i++) spawn('warden', i);
  }
  return world;
}

export function snapshotCiv(world) {
  const civ = world.civ;
  if (!civ) return;
  const ships = world.entities.filter((e) => !e.dead && e.kind === 'ship' && e.civId === civ.id && !e.isFighter && e.team !== 'player' && !e.convoy && !e.wave);
  civ.state.snap = {
    station: world.station && !world.station.dead ? { hull: world.station.hull, broken: world.station.broken } : null,
    ships: ships.map((e) => ({ role: e.role, hull: e.hull })),
  };
}
