// The galaxy acts while you explore: income, raids with deadlines, alliance obligations,
// coalitions against aggression, research projects, faction abilities and victory.
import { v3, TAU } from './math.js';
import { makeShip, raiderOpts, makeFighter, subOff } from './entities.js';
import { ABILITIES, RESEARCH, SYSTEM_ROLES } from './data.js';

const OWNED = ['conquered', 'assimilated', 'protectorate'];

export function sysState(game, id) {
  if (!game.sys[id]) game.sys[id] = { visited: false, done: {}, threat: null, role: null, contestedUntil: 0 };
  return game.sys[id];
}

export function sysLabel(game, id) {
  if (id === 'home') return game.fac.home.name;
  const civ = game.civs[id];
  if (civ) return civ.state.intel.contact ? civ.name : civ.texts.stellar.name;
  const s = game.galaxy.systems.find((x) => x.id === id);
  return s ? s.name : id;
}

export function controlled(game) {
  return Object.values(game.civs).filter((c) => OWNED.includes(c.state.status));
}

// ---------------- Economy ----------------
export function strategicTick(game, dt) {
  game.stime += dt;
  const home = game.currentSystem === 'home';
  let mat = 0.6, en = 0.35, kn = 0;
  for (const c of Object.values(game.civs)) {
    const s = c.state;
    const st = sysState(game, c.id);
    const contested = st.contestedUntil > game.stime;
    if (s.treaties.trade) mat += 1.2;
    if (OWNED.includes(s.status) && !contested) {
      mat += 1.0;
      kn += 0.05;
      if (st.role === 'industry') mat += 1.2;
      if (st.role === 'research') kn += 0.25;
      if (st.role === 'trade') en += 0.5;
    }
    if (s.status === 'allied') {
      mat += 0.5;
      en += 0.15;
    }
    if (c.id !== game.currentSystem && s.visited && !s.helped && !OWNED.includes(s.status) && s.status !== 'allied' && s.status !== 'devastated') {
      s.pressure = Math.min(3, s.pressure + dt / 150);
    }
  }
  game.materials += mat * dt;
  game.energy = Math.min(game.energyCap, game.energy + en * dt);
  game.knowledge += kn * dt;
  if (game.faction === 'bloom') game.reserves = Math.min(100, game.reserves + (home ? 3 : 0.2) * dt);
  game.income = { mat, en, kn };

  for (const [id, st] of Object.entries(game.sys)) {
    if (st.threat && game.stime > st.threat.deadline && id !== game.currentSystem) expireThreat(game, id, st);
  }
  game.eventT -= dt;
  if (game.eventT <= 0) {
    game.eventT = 130 + Math.random() * 90;
    maybeRaid(game);
  }
}

// ---------------- Raids ----------------
function maybeRaid(game) {
  const cands = [];
  for (const c of controlled(game)) if (sysState(game, c.id).role !== 'defense') cands.push(c.id);
  for (const c of Object.values(game.civs)) if (c.state.status === 'allied') cands.push(c.id);
  const aggression = game.outcomes.filter((o) => ['conquered', 'devastated', 'assimilated'].includes(o.outcome)).length;
  if (aggression > 0) cands.push('home');
  const free = cands.filter((id) => !sysState(game, id).threat);
  if (!free.length) return;
  const id = free[Math.floor(Math.random() * free.length)];
  const st = sysState(game, id);
  const n = 3 + Math.min(3, Math.floor(game.stime / 400));
  st.threat = { n, deadline: game.stime + 160, spawned: false };
  const ally = game.civs[id] && game.civs[id].state.status === 'allied';
  game.alert(
    `Raid: ${sysLabel(game, id)}`,
    `${n} marauder ships strike ${sysLabel(game, id)}. ${ally ? 'Your allies expect you to honour the alliance.' : id === 'home' ? 'Your station will fight, but repairs will cost materials unless you return.' : 'Respond within ~2½ minutes or lose output there.'}`
  );
  if (id === game.currentSystem) spawnThreat(game, game.world, id);
}

export function spawnThreat(game, world, id) {
  const st = sysState(game, id);
  if (!st.threat || st.threat.spawned) return;
  st.threat.spawned = true;
  const target = world.station && !world.station.dead ? world.station.pos : [0, 0, 0];
  const a = Math.random() * TAU;
  for (let i = 0; i < st.threat.n; i++) {
    const r = makeShip(game.R, { ...raiderOpts(i === 0 && st.threat.n > 3), team: 'raider', pos: v3.add(target, [Math.cos(a) * 1100 + i * 40, 20, Math.sin(a) * 1100 + i * 30]) });
    r.threatId = id;
    r.home = [...target];
    r.name = `Marauder ${r.cls}`;
    r.warpIn = 1;
    r.warpDir = v3.norm(v3.sub(target, r.pos));
    r.yaw = Math.atan2(r.warpDir[0], r.warpDir[2]);
    world.add(r);
  }
  game.log('Marauders drop out of jump space!', 'bad');
}

export function checkThreatCleared(game, world, e) {
  if (!e.threatId) return;
  const left = world.entities.some((x) => !x.dead && x.threatId === e.threatId && x !== e);
  if (!left) resolveThreat(game, e.threatId);
}

function resolveThreat(game, id) {
  const st = sysState(game, id);
  if (!st.threat) return;
  st.threat = null;
  game.materials += 50;
  const civ = game.civs[id];
  if (civ && civ.state.status === 'allied') {
    civ.state.trust += 10;
    game.banner('Obligation honoured', `You defended ${civ.name}. Their trust in the alliance grows.`);
  } else game.log(`Raid on ${sysLabel(game, id)} repelled. +50 materials salvaged.`, 'good');
}

function expireThreat(game, id, st) {
  st.threat = null;
  const civ = game.civs[id];
  if (id === 'home') {
    const loss = Math.min(game.materials, 60);
    game.materials -= loss;
    game.log(`Your home station drove off the raid, but repairs cost ${Math.round(loss)} materials.`, 'warn');
  } else if (civ && civ.state.status === 'allied') {
    civ.state.trust -= 20;
    if (civ.state.trust < 25) {
      delete civ.state.treaties.alliance;
      civ.state.status = 'friendly';
      game.alert('Alliance lapsed', `${civ.name} were left to face the raid alone. They no longer count you as an ally.`);
    } else game.log(`${civ.name} faced the raid alone. Their trust falls.`, 'bad');
  } else if (civ) {
    st.contestedUntil = game.stime + 180;
    game.materials = Math.max(0, game.materials - 80);
    game.log(`${sysLabel(game, id)} was looted. Output halted while it recovers.`, 'bad');
  }
}

// ---------------- Coalitions ----------------
export function checkCoalition(game) {
  if (game.coalition) return;
  const aggression = game.outcomes.filter((o) => ['conquered', 'devastated', 'assimilated'].includes(o.outcome)).length;
  if (aggression < 2) return;
  game.coalition = true;
  const names = [];
  for (const c of Object.values(game.civs)) {
    const s = c.state;
    if (OWNED.includes(s.status) || s.status === 'devastated' || s.status === 'allied') continue;
    s.coalition = true;
    s.trust -= 10;
    c.fleetSize += 1;
    if (s.snap && s.snap.ships) s.snap.ships.push({ role: 'warden', hull: 420 });
    names.push(c.state.intel.contact ? c.name : 'an uncontacted power');
  }
  if (names.length) game.alert('Intelligence report: coalition forming', `Your conquests alarm the region. ${names.join(', ')} are arming and coordinating against you.`);
}

// ---------------- Research ----------------
export function doResearch(game, id) {
  const R = RESEARCH[id];
  if (game.research[id]) return 'Already researched.';
  if (game.knowledge < R.cost) return `Needs ${R.cost} knowledge.`;
  game.knowledge -= R.cost;
  game.research[id] = true;
  if (id === 'capacity') game.integrationCap++;
  if (id === 'slots') {
    game.bonusSlots++;
    for (const e of game.allPlayerShips()) e.slots = (e.slots || 0) + 1;
  }
  game.log(`Research complete: ${R.name}. ${R.desc}`, 'good');
  return null;
}

export function setRole(game, id, role) {
  sysState(game, id).role = role;
  game.log(`${sysLabel(game, id)} assigned to ${SYSTEM_ROLES[role].name.toLowerCase()}.`, 'good');
}

// ---------------- Abilities ----------------
export function abilityState(game, idx) {
  const ab = ABILITIES[game.faction][idx];
  const cd = game.abilityCd[ab.id] || 0;
  const f = game.flagship();
  let block = null;
  if (!f) block = 'Needs the flagship';
  else if (cd > 0) block = `${Math.ceil(cd)}s`;
  else if (ab.cost.reserves && game.reserves < ab.cost.reserves) block = 'Low reserves';
  else if (ab.cost.energy && game.energy < ab.cost.energy) block = 'Low energy';
  else if (ab.id === 'overclock' && subOff(f, 'command')) block = 'Command offline';
  return { ab, cd, block };
}

export function useAbility(game, idx) {
  const { ab, block } = abilityState(game, idx);
  if (block) return block;
  const w = game.world;
  const f = game.flagship();
  const near = (r) => w.entities.filter((e) => e.team === 'player' && (e.kind === 'ship' || e.kind === 'node') && !e.dead && v3.dist(e.pos, f.pos) < r);
  const foes = (r) => w.entities.filter((e) => !e.dead && w.hostile(f, e) && v3.dist(e.pos, f.pos) < r);
  const ring = (r, c) => w.particles.push({ pos: [...f.pos], vel: [0, 0, 0], life: 1.2, max: 1.2, size: 20, grow: r, col: c, mode: 2 });
  if (ab.id === 'surge') {
    near(650).forEach((e) => (e.hotT = 6));
    ring(600, [0.4, 1, 0.7]);
  } else if (ab.id === 'sporebloom') {
    const list = foes(300);
    if (!list.length) return 'No enemies near the flagship';
    list.forEach((e) => {
      if (e.dot.length >= 3) e.dot.shift();
      e.dot.push({ dps: 14, t: 6 });
    });
    for (let i = 0; i < 40; i++) {
      const d = v3.norm([Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5]);
      w.particles.push({ pos: [...f.pos], vel: v3.scale(d, 60 + Math.random() * 120), life: 2, max: 2, size: 6, grow: 10, col: [0.5, 1, 0.5], mode: 0, drag: 1 });
    }
  } else if (ab.id === 'overclock') {
    near(700).forEach((e) => (e.overT = 8));
    ring(650, [0.4, 0.85, 1]);
  } else if (ab.id === 'intrusion') {
    const t = (f.focus && w.get(f.focus) && w.hostile(f, w.get(f.focus)) && w.get(f.focus)) || foes(450).sort((a, b) => b.radius - a.radius)[0];
    if (!t || v3.dist(t.pos, f.pos) > 600) return 'No target in range';
    const machine = ['synthetic', 'raider'].includes(t.style) || t.kind === 'station';
    t.jamT = machine ? 10 : 6;
    if (t.keystone === 'archive') t.jammed = true;
    w.beams.push({ a: [...f.pos], b: [...t.pos], life: 0.8, max: 0.8, width: 3, col: [0.4, 0.9, 1] });
    game.log(`${t.name}'s weapons are offline for ${t.jamT}s.`, 'good');
  } else if (ab.id === 'brace') {
    near(700).forEach((e) => {
      e.braceT = 6;
      e.shield = Math.min(e.maxShield * 1.5, e.shield + e.maxShield * 0.5);
    });
    ring(650, [0.5, 0.75, 1]);
  } else if (ab.id === 'scramble') {
    for (let i = 0; i < 6; i++) {
      const fi = makeFighter(game.R, f, f.style, f.pal);
      fi.pos = v3.add(f.pos, [(Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30]);
      fi.yaw = f.yaw + (i % 2 ? 1 : -1);
      fi.speedNow = 40;
      fi.life = 30;
      w.add(fi);
    }
  }
  if (ab.cost.reserves) game.reserves -= ab.cost.reserves;
  if (ab.cost.energy) game.energy -= ab.cost.energy;
  game.abilityCd[ab.id] = ab.cd;
  game.onEvent('ability', ab);
  return null;
}

// ---------------- Victory ----------------
export function checkVictory(game) {
  if (game.won) return;
  const n = controlled(game).length;
  if (n >= 3 || (n >= 2 && game.relayActive)) {
    game.won = true;
    game.ui.openVictory();
  }
}
