// Entity factory: ships, stations, landmarks. Stats come from role + faction + inherited traits.
import { ROLE_STATS, FACTION_LOADOUT, FACTION_MODS, WEAPONS, FACTIONS, TRAITS, TIERS } from './data.js';
import { getVisual, homeStation, civStation, landmarkVisual, integrationNode, PAL } from './designs.js';

let nextId = 1;
export const newId = () => nextId++;

const PLAYER_STYLES = ['bloom', 'array', 'ascendancy'];

function baseEntity(kind, team, pos) {
  return {
    id: newId(),
    kind,
    team,
    pos: [...pos],
    vel: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    roll: 0,
    targetY: pos[1],
    speedNow: 0,
    phase: Math.random() * 10,
    fx: { hit: 0, shield: 0, shieldBreak: 0, flash: 0 },
    weapons: [],
    order: null,
    dot: [],
    slowT: 0,
    lastHit: -99,
    dead: false,
    scale: 1,
    selectable: false,
  };
}

function weaponsFrom(list) {
  return list.map((w) => ({ ...WEAPONS[w], id: w, t: Math.random() * WEAPONS[w].cd }));
}

// Recompute stats from role, faction, traits. Keeps hull/shield ratios.
export function applyStats(e) {
  const rs = ROLE_STATS[e.role];
  const fm = FACTION_MODS[e.style] || { hull: 1, shield: 1, regenHull: 0, regenHullIdle: 0.003 };
  const hr = e.maxHull ? e.hull / e.maxHull : 1;
  const sr = e.maxShield ? e.shield / e.maxShield : 1;
  e.maxHull = rs.hull * fm.hull * (e.hullMul || 1);
  e.maxShield = rs.shield * fm.shield * (e.shieldMul || 1);
  e.shieldRegen = rs.regen * (fm.shield || 1);
  e.armor = rs.armor;
  e.baseSpeed = rs.speed;
  e.turn = rs.turn;
  e.scanRate = rs.scan;
  e.repairRate = rs.repair || 0;
  e.regenHull = fm.regenHull || 0;
  e.regenHullIdle = fm.regenHullIdle || 0.003;
  e.droneCount = 0;
  const loadout = (FACTION_LOADOUT[e.style] || {})[e.role] || e.loadout || [];
  e.weapons = weaponsFrom(loadout);
  for (const t of e.traits || []) {
    const m = TIERS[t.tier].mul;
    if (t.id === 'resonance') {
      e.maxShield *= 1 + 0.45 * m;
      e.shieldRegen *= 1 + 0.6 * m;
    } else if (t.id === 'gravity') {
      const w = { ...WEAPONS.gravlance, id: 'gravlance', t: 0 };
      w.dmg *= m * (e.role === 'flagship' ? 1.4 : 1);
      e.weapons.push(w);
    } else if (t.id === 'regrowth') {
      e.regenHull += 0.012 * m;
    } else if (t.id === 'swarm') {
      e.droneCount = Math.round((e.role === 'flagship' ? 4 : 2) * m);
    }
  }
  e.hull = e.maxHull * hr;
  e.shield = e.maxShield * sr;
}

export function refreshVisual(R, e) {
  e.visual = getVisual(R, { style: e.style, role: e.role, seed: e.vseed, pal: e.pal, traits: (e.traits || []).map((t) => ({ ...t, color: TRAITS[t.id].color })) });
  e.radius = e.visual.radius;
}

export function makeShip(R, opt) {
  const e = baseEntity('ship', opt.team, opt.pos || [0, 0, 0]);
  e.style = opt.style;
  e.role = opt.role;
  e.vseed = opt.vseed || 1;
  e.pal = opt.pal || null;
  e.traits = opt.traits || [];
  e.slots = opt.slots || 0;
  e.loadout = opt.loadout;
  e.hullMul = opt.hullMul || 1;
  e.shieldMul = opt.shieldMul || 1;
  e.civId = opt.civId || null;
  e.keystone = opt.keystone || null;
  e.ally = opt.ally || false;
  e.hybrid = opt.hybrid || false;
  e.yaw = opt.yaw || 0;
  e.selectable = opt.team === 'player';
  const fac = FACTIONS[e.style];
  e.cls = opt.cls || (fac ? fac.names[e.role] : e.role);
  e.name = opt.name || e.cls;
  applyStats(e);
  refreshVisual(R, e);
  e.fighters = [];
  e.launchT = 0;
  return e;
}

export function makeFighter(R, host, style, pal) {
  const e = makeShip(R, {
    style: PLAYER_STYLES.includes(style) || ['crystalline', 'synthetic', 'colonial'].includes(style) ? style : 'ascendancy',
    role: 'fighter',
    team: host.team,
    pos: host.pos,
    pal: pal || host.pal,
    loadout: ['fighterGun'],
    cls: 'Fighter',
  });
  if (!PLAYER_STYLES.includes(e.style)) e.weapons = weaponsFrom(['fighterGun']);
  e.host = host.id;
  e.selectable = false;
  e.isFighter = true;
  e.life = 40;
  return e;
}

export function makeHomeStation(R, faction, pos) {
  const e = baseEntity('station', 'player', pos);
  e.style = faction;
  e.role = 'station';
  e.visual = homeStation(R, faction, 77);
  e.radius = e.visual.radius;
  e.maxHull = e.hull = 9000;
  e.maxShield = e.shield = 4000;
  e.shieldRegen = 30;
  e.armor = 5;
  e.name = FACTIONS[faction].home.name.split(' of ')[0];
  e.cls = 'Home station';
  e.baseSpeed = 0;
  e.weapons = weaponsFrom(['stationgun', 'stationgun']);
  e.weapons.forEach((w) => (w.color = FACTIONS[faction].color));
  e.selectable = true;
  e.immobile = true;
  e.repairAura = 260;
  return e;
}

export function makeCivStation(R, civ, pos) {
  const e = baseEntity('station', 'civ', pos);
  e.style = civ.structure;
  e.role = 'station';
  e.civId = civ.id;
  e.visual = civStation(R, civ.structure, civ.pal, civ.seed);
  e.radius = e.visual.radius;
  e.maxHull = e.hull = 5500;
  e.maxShield = e.shield = 2000;
  e.shieldRegen = 25;
  e.armor = 5;
  e.name = `${civ.species} Capital`;
  e.cls = 'Capital installation';
  e.baseSpeed = 0;
  e.weapons = weaponsFrom(['stationgun', 'stationgun', 'stationgun']);
  e.weapons.forEach((w) => (w.color = civ.pal.glow));
  e.immobile = true;
  return e;
}

export function makeLandmark(R, kind, pal, seed, pos, name) {
  const e = baseEntity(kind === 'wreck' ? 'wreck' : 'landmark', 'neutral', pos);
  e.visual = landmarkVisual(R, kind, pal, seed);
  e.radius = e.visual.radius;
  e.name = name;
  e.cls = kind === 'wreck' ? 'Derelict' : 'Landmark';
  e.immobile = true;
  e.invulnerable = true;
  e.maxHull = e.hull = 1;
  e.maxShield = e.shield = 0;
  return e;
}

export function makeNode(R, faction, pos) {
  const e = baseEntity('node', 'player', pos);
  e.style = faction;
  e.role = 'node';
  e.visual = integrationNode(R, faction, 5);
  e.radius = e.visual.radius;
  e.maxHull = e.hull = 2600;
  e.maxShield = e.shield = 900;
  e.shieldRegen = 22;
  e.armor = 3;
  e.name = 'Integration site';
  e.cls = FACTIONS[faction].assimilateVerb;
  e.immobile = true;
  e.selectable = true;
  return e;
}

export function civShipOpts(civ, role, i = 0) {
  const weapon = { crystalline: 'resonator', synthetic: 'archivebolt', colonial: 'sporecloud' }[civ.structure];
  const names = {
    crystalline: { warden: 'Facet Warden', keystone: 'Conductor', convoy: 'Lode Barge' },
    synthetic: { warden: 'Archivist Frame', keystone: 'Archive Core', convoy: 'Data Freighter' },
    colonial: { warden: 'Drift Guardian', keystone: 'Command Organism', convoy: 'Spore Carrier' },
  }[civ.structure];
  return {
    style: civ.structure,
    role,
    pal: civ.pal,
    vseed: civ.seed + i,
    loadout: role === 'convoy' ? [] : role === 'keystone' ? [weapon, weapon] : [weapon],
    cls: names[role],
    civId: civ.id,
    keystone: role === 'keystone' ? civ.keystone : null,
  };
}

export function raiderOpts(big) {
  return {
    style: 'raider',
    role: big ? 'raiderBig' : 'raider',
    pal: PAL.raider,
    vseed: big ? 3 : 2,
    loadout: big ? ['raidergun', 'raidergun', 'raidergun'] : ['raidergun'],
    cls: big ? 'Marauder Brute' : 'Marauder',
  };
}
