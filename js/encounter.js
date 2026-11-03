// Encounters: intelligence, persistent negotiation, conquest, assimilation and help missions.
// Nothing here is a dice roll: outcomes follow from preparation, intel and what happens in battle.
import { v3, TAU } from './math.js';
import { TRAITS, TIERS, FACTIONS } from './data.js';
import { makeShip, makeNode, civShipOpts, raiderOpts } from './entities.js';
import { CIV_LAYOUT } from './systems.js';

export function initCivState(civ) {
  civ.state = {
    status: 'unknown', // unknown, contacted, friendly, hostile, allied, protectorate, conquered, assimilated, devastated
    trust: civ.baseTrust,
    hostile: false,
    intel: {},
    helped: false,
    threatened: false,
    threatActive: false,
    fought: false,
    gifts: 0,
    treaties: {},
    answers: {},
    pressure: 0,
    visited: false,
    integrating: false,
    integrationFailed: 0,
    missionActive: null,
    brokenKeystone: null,
  };
}

export const PROPOSALS = {
  passage: { name: 'Safe passage', threshold: 15, desc: 'Their fleet will not engage you in their space.' },
  trade: { name: 'Trade agreement', threshold: 35, desc: 'Materials now and a steady income while it lasts.' },
  research: { name: 'Research exchange', threshold: 50, desc: 'Licence their signature capability while the treaty holds.' },
  alliance: { name: 'Alliance', threshold: 65, requires: ['passage'], desc: 'The system becomes allied. A specialist vessel joins your fleet.' },
  protectorate: { name: 'Protectorate', threshold: 90, requires: ['alliance'], desc: 'Voluntary accession: the system joins your territory.' },
};

const isOwned = (s) => ['conquered', 'assimilated', 'protectorate', 'devastated'].includes(s.status);

// Deterministic evaluation of a proposal. Each factor is fixed by the civilization's persistent
// priorities and by what you have actually done — so an unchanged offer gets an unchanged answer.
export function evaluate(game, civ, pid) {
  const s = civ.state;
  const p = civ.priorities;
  const P = PROPOSALS[pid];
  const f = [];
  const add = (label, v, known) => v && f.push({ label, v: Math.round(v), known });
  add('Standing with you', s.trust, true);
  add(civ.affinity.text, civ.affinity.value, !!s.intel.contact);
  if (s.helped) add(`You defended them from the ${civ.neighbor}`, 8 * p.security, true);
  else if (p.security >= 2) add(`Doubt you can protect them from the ${civ.neighbor}`, -5 * p.security, !!s.intel.landmark);
  if (pid === 'trade') {
    add('Value commerce', 6 * p.commerce, !!s.intel.priorities);
    if (civ.scarcity) add('Desperate for materials', 15, !!s.intel.landmark);
  }
  if (s.gifts) add('Remember your gifts', Math.min(30, s.gifts * 4 * Math.max(1, p.commerce)), true);
  if (pid === 'research') {
    add('Prize shared knowledge', 5 * p.knowledge, !!s.intel.priorities);
    add('Guard their secrets', -4 * p.autonomy, !!s.intel.priorities);
  }
  if (pid === 'alliance') add('Fiercely independent', -6 * p.autonomy, !!s.intel.priorities);
  if (pid === 'protectorate') add('Fiercely independent', -10 * p.autonomy, !!s.intel.priorities);
  if (s.fought) add('Remember the blood you spilled', -40, true);
  if (s.threatened) add('Resent your threats', -6 * p.honor, !!s.intel.priorities);
  if (s.threatActive) {
    if (pid === 'passage' || pid === 'trade') add('Fear your guns at their capital', 25, true);
    else add('Will not ally under threat', -15, true);
  }
  if (s.treaties.passage && pid !== 'passage') add('Existing safe-passage treaty', 5, true);
  if (s.treaties.trade && pid !== 'trade') add('Existing trade ties', 5, true);
  const score = f.reduce((a, b) => a + b.v, 0);
  const missing = (P.requires || []).filter((r) => !s.treaties[r]);
  return { score, threshold: P.threshold, factors: f, missing };
}

export function propose(game, civ, pid) {
  const s = civ.state;
  if (s.treaties[pid]) return { text: 'This agreement is already in force.', ok: true, same: true };
  if (s.hostile) return { text: 'They will not negotiate while you are at war with them.', ok: false };
  const ev = evaluate(game, civ, pid);
  if (ev.missing.length) return { text: `They require ${ev.missing.map((m) => PROPOSALS[m].name).join(', ')} first.`, ok: false, ev };
  const key = pid + ':' + ev.factors.map((x) => x.v).join(',');
  const prev = s.answers[pid];
  const ok = ev.score >= ev.threshold;
  const same = prev && prev.key === key;
  s.answers[pid] = { key, ok };
  if (ok) applyTreaty(game, civ, pid);
  return { ok, ev, same };
}

function applyTreaty(game, civ, pid) {
  const s = civ.state;
  s.treaties[pid] = true;
  s.trust += 5;
  if (pid === 'passage') {
    if (s.status === 'contacted' || s.status === 'unknown') s.status = 'friendly';
    game.log(`Safe passage agreed with ${civ.name}.`, 'good');
  } else if (pid === 'trade') {
    game.materials += 120;
    game.log(`Trade agreement signed: +120 materials and steady income.`, 'good');
  } else if (pid === 'research') {
    grantTrait(game, civ.signature, 'licensed', civ);
  } else if (pid === 'alliance') {
    s.status = 'allied';
    game.banner(`${civ.name} — Allied`, 'The system is marked allied. Their specialist vessel joins your fleet.');
    const w = game.world;
    const spec = makeShip(game.R, { ...civShipOpts(civ, 'warden', 9), team: 'player', pos: v3.add(CIV_LAYOUT.station, [0, 30, 260]) });
    spec.name = `${civ.species} Specialist`;
    spec.alliedFrom = civ.id;
    spec.hullMul = 1.3;
    w.add(spec);
    game.onOutcome(civ, 'allied');
  } else if (pid === 'protectorate') {
    s.status = 'protectorate';
    game.banner(`${civ.name} — Protectorate`, 'By their own choice, they join your territory.');
    game.onOutcome(civ, 'protectorate');
  }
}

export function grantTrait(game, id, tier, civ) {
  const cur = game.traits[id];
  if (cur && TIERS[cur.tier].mul >= TIERS[tier].mul) return false;
  game.traits[id] = { tier, from: civ ? civ.name : '' };
  const T = TRAITS[id];
  game.banner(`Inherited: ${T.name}`, `${TIERS[tier].name}. ${T.expr[game.faction]}`);
  game.log(`New adaptation available: ${T.name} (${TIERS[tier].name}). Refit at home in the Adaptation Bay.`, 'good');
  return true;
}

export function revokeLicensed(game, civ) {
  for (const [id, t] of Object.entries(game.traits)) {
    if (t.tier === 'licensed' && t.from === civ.name) {
      delete game.traits[id];
      game.log(`Treaty licence for ${TRAITS[id].name} revoked.`, 'bad');
      for (const e of game.allPlayerShips()) {
        const before = e.traits.length;
        e.traits = e.traits.filter((x) => x.id !== id);
        if (e.traits.length !== before) game.refit(e);
      }
    }
  }
}

// ---------- Simple actions ----------
export function hail(game, civ) {
  const s = civ.state;
  if (!s.intel.contact) {
    s.intel.contact = true;
    if (s.status === 'unknown') s.status = 'contacted';
    if (game.expedition && game.expedition.objective === 'envoy') s.trust += 10;
    if (game.faction === 'ascendancy') s.trust += 5;
    game.log(`Contact established with ${civ.name}. They mention trouble with the ${civ.neighbor}.`);
    return true;
  }
  return false;
}

export function gift(game, civ) {
  if (game.materials < 100) return 'Not enough materials (100 required).';
  game.materials -= 100;
  civ.state.gifts++;
  game.log(`You send 100 materials to ${civ.name}.`);
  return null;
}

export function fleetNearCapital(game) {
  const w = game.world;
  if (!w.station || w.station.dead) return 0;
  return w.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && v3.dist(e.pos, w.station.pos) < 650).length;
}

export function threaten(game, civ) {
  const s = civ.state;
  if (fleetNearCapital(game) < 2) return 'Bring at least two ships within range of their capital first.';
  s.threatened = true;
  s.threatActive = true;
  s.trust -= 5;
  game.log(`You train your guns on the ${civ.species} capital. They will remember this.`, 'bad');
  return null;
}

export function declareWar(game, civ) {
  const s = civ.state;
  if (s.hostile) return;
  const hadTreaty = Object.keys(s.treaties).length > 0;
  s.hostile = true;
  s.fought = true;
  s.status = 'hostile';
  s.treaties = {};
  s.trust -= 30;
  if (hadTreaty) revokeLicensed(game, civ);
  game.log(`Hostilities opened with ${civ.name}.`, 'bad');
  game.world.script = conquestScript(game, civ);
}

// ---------- Strength estimate ----------
export function strength(list) {
  let s = 0;
  for (const e of list) {
    if (e.dead) continue;
    const dps = e.weapons.reduce((a, w) => a + w.dmg / w.cd, 0);
    s += Math.sqrt((e.hull + e.shield) * Math.max(1, dps));
  }
  return s;
}
const THREAT = ['Negligible', 'Low', 'Moderate', 'Severe', 'Overwhelming'];
export function threatEstimate(game, civ) {
  const w = game.world;
  const theirs = strength(w.entities.filter((e) => e.team === 'civ' && (e.kind === 'ship' || e.kind === 'station')));
  const ours = strength(w.entities.filter((e) => e.team === 'player' && e.kind === 'ship'));
  const ratio = theirs / Math.max(1, ours);
  const idx = ratio < 0.3 ? 0 : ratio < 0.7 ? 1 : ratio < 1.2 ? 2 : ratio < 2 ? 3 : 4;
  if (civ.state.intel.priorities) return { text: THREAT[idx], exact: true, ratio };
  const lo = Math.max(0, idx - 1), hi = Math.min(4, idx + 1);
  return { text: `${THREAT[lo]} – ${THREAT[hi]}`, exact: false, ratio };
}

// ---------- Conquest ----------
export function conquestScript(game, civ) {
  const w = game.world;
  const s = civ.state;
  let captureT = 0;
  let warned = false;
  return {
    name: 'conquest',
    update(dt) {
      const st = w.station;
      if (!st || st.dead) return;
      if (st.broken && s.hostile) {
        const near = w.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && v3.dist(e.pos, st.pos) < 380).length;
        const defenders = w.entities.filter((e) => e.team === 'civ' && e.kind === 'ship' && e.weapons.length && v3.dist(e.pos, st.pos) < 700).length;
        if (near && !defenders) {
          captureT += dt;
          game.setProgress('Forcing surrender', captureT / 12);
          if (captureT >= 12) {
            game.setProgress(null);
            resolve(game, civ, 'conquered');
          }
        } else {
          if (captureT > 0) game.setProgress(defenders ? 'Surrender contested — defenders remain' : 'Move ships close to the capital', captureT / 12);
          captureT = Math.max(0, captureT - dt * 0.5);
        }
        if (!warned) {
          warned = true;
          game.objective('capture', `Defences broken. Hold ships near the ${civ.species} capital with no defenders left to force surrender — or order an attack on it to destroy it for salvage.`);
        }
      }
    },
    onBroken() {
      game.log(`The ${civ.species} capital's defences are broken. Your ships hold fire.`, 'good');
    },
    onKill(e) {
      if (e === w.station) resolve(game, civ, 'devastated');
      else keystoneDeath(game, civ, e);
    },
  };
}

export function keystoneDeath(game, civ, e) {
  if (!e.keystone || e.team === 'player') return;
  const w = game.world;
  const s = civ.state;
  s.brokenKeystone = e.keystone;
  if (e.keystone === 'conductor') {
    game.banner('Resonance collapses', 'With the Conductor gone, every nearby shield fails at once.');
    for (const o of w.entities) {
      if (o.team === 'civ' && v3.dist(o.pos, e.pos) < 900) {
        o.shield = 0;
        o.fx.shieldBreak = 1;
        w.particles.push({ pos: [...o.pos], vel: [0, 0, 0], life: 0.8, max: 0.8, size: o.radius, grow: o.radius * 2, col: civ.pal.glow, mode: 2 });
      }
    }
  } else if (e.keystone === 'command') {
    game.banner('The colony fleet routs', 'The command organism is dead. Its guardians scatter.');
    for (const o of w.entities) {
      if (o.team === 'civ' && o.kind === 'ship' && o.role !== 'convoy') {
        const a = Math.atan2(o.pos[0], o.pos[2]);
        o.order = { type: 'flee', pos: [Math.sin(a) * 3000, 0, Math.cos(a) * 3000] };
        o.weapons = [];
      }
    }
  } else if (e.keystone === 'archive') {
    game.banner('Archive Core destroyed', 'Their firing solutions degrade. Enemy damage reduced.');
  }
}

// ---------- Assimilation ----------
export function accessPoint(civ, world) {
  if (world.station && !world.station.dead && world.station.broken) return { pos: v3.add(world.station.pos, [0, 0, 140]), label: 'their broken capital' };
  if (civ.state.intel.landmark) return { pos: v3.add(world.landmark.pos, [0, 0, -150]), label: civ.landmark.name };
  return null;
}

export function shipsAt(game, pos, r = 450) {
  return game.world.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && v3.dist(e.pos, pos) < r).length;
}

export function integrationRisks(game, civ) {
  const s = civ.state;
  const risks = [];
  const alive = game.world.entities.some((e) => e.keystone && e.team === 'civ' && !e.dead);
  if (s.intel.vulnerability) {
    if (alive) risks.push(civ.vulnerability.risk);
    else risks.push(`Their ${civ.vulnerability.name.toLowerCase()} is broken — no special resistance.`);
  } else risks.push('Unknown: scan their unidentified vessel to learn what will resist you.');
  risks.push('Resistance waves will launch from the capital and attack the site.');
  risks.push('If the site is destroyed, integration fails and they will trust you less.');
  return risks;
}

export function integrationSpeed(game, civ) {
  let m = 1;
  if (game.expedition && game.expedition.objective === 'integrate') m *= 1.3;
  const aff = { bloom: 'colonial', array: 'synthetic', ascendancy: 'crystalline' }[game.faction];
  if (aff === civ.structure) m *= 1.25;
  return m;
}

export function beginIntegration(game, civ) {
  const s = civ.state;
  const w = game.world;
  if (s.status === 'allied') return 'They are your allies. Propose a protectorate instead.';
  if (isOwned(s)) return 'This system is already yours.';
  if (s.integrating) return 'Integration already in progress.';
  if (game.integrationUsed >= game.integrationCap) return 'No integration capacity left.';
  const ap = accessPoint(civ, w);
  if (!ap) return 'No access point known. Investigate their landmark or break their capital defences first.';
  if (shipsAt(game, ap.pos) < 2) return 'Establish access first: move at least two ships to the access point.';
  const node = makeNode(game.R, game.faction, ap.pos);
  node.progress = 0;
  w.add(node);
  s.integrating = true;
  s.hostile = true;
  s.fought = true;
  s.status = 'hostile';
  if (Object.keys(s.treaties).length) {
    s.treaties = {};
    revokeLicensed(game, civ);
  }
  game.integrationUsed++;
  game.log(`${FACTIONS[game.faction].assimilateVerb} at ${ap.label}. Protect it.`, 'warn');
  game.objective('integrate', 'Protect the integration site until it reaches 100%.');
  game.cam.set(node.pos, 700, null, 0.7);
  const speed = integrationSpeed(game, civ);
  let waveT = 6, pulseT = 8;
  const conquest = conquestScript(game, civ);
  w.script = {
    name: 'integration',
    update(dt) {
      if (node.dead) return;
      const ks = w.entities.find((e) => e.keystone && e.team === 'civ' && !e.dead);
      let m = speed;
      if (ks && ks.keystone === 'archive' && !ks.jammed) m *= 0.7;
      node.progress = Math.min(1, node.progress + (dt / 70) * m);
      game.setProgress('Integration', node.progress);
      waveT -= dt;
      if (waveT <= 0) {
        waveT = 22;
        const n = 2 + (ks && ks.keystone === 'command' ? 2 : 0) + Math.floor(node.progress * 1.5);
        for (let i = 0; i < n; i++) {
          const e = makeShip(game.R, { ...civShipOpts(civ, 'warden', 20 + i), team: 'civ', pos: v3.add(CIV_LAYOUT.station, [(Math.random() - 0.5) * 200, 0, (Math.random() - 0.5) * 200]) });
          e.waveTarget = node.id;
          e.wave = true;
          e.home = [...CIV_LAYOUT.station];
          w.add(e);
        }
        game.log(`Resistance wave: ${n} ships launch toward the site.`, 'warn');
      }
      if (ks && ks.keystone === 'conductor') {
        pulseT -= dt;
        if (pulseT <= 0) {
          pulseT = 8;
          w.applyDamage(node, 90, ks, false, node.pos);
          w.beams.push({ a: [...ks.pos], b: [...node.pos], life: 0.6, max: 0.6, width: 6, col: civ.pal.glow });
        }
      }
      if (node.progress >= 1) {
        game.setProgress(null);
        resolve(game, civ, 'assimilated');
      }
    },
    onKill(e) {
      if (e === node) {
        s.integrating = false;
        s.integrationFailed++;
        s.trust -= 15;
        game.integrationUsed--;
        game.setProgress(null);
        game.banner('Integration failed', 'The site was destroyed. They will not forget the attempt.');
        w.script = conquest;
      } else conquest.onKill(e);
    },
    onBroken: conquest.onBroken,
  };
  return null;
}

// ---------- Help missions (their current problem) ----------
export function startMission(game, civ) {
  const s = civ.state;
  const w = game.world;
  if (s.hostile) return 'They will not accept help from an enemy.';
  if (s.helped) return 'You have already helped them.';
  if (s.missionActive) return 'Already under way.';
  if (!s.intel.contact) return 'Hail them first.';
  s.missionActive = civ.problem;
  const extra = Math.min(3, Math.floor(s.pressure));
  if (civ.problem === 'convoy') {
    const pts = [CIV_LAYOUT.convoyStart, [900, 0, 600], [500, 0, 150], v3.add(CIV_LAYOUT.station, [80, 0, 100])];
    const convoy = [];
    for (let i = 0; i < 3; i++) {
      const e = makeShip(game.R, { ...civShipOpts(civ, 'convoy', i), team: 'civ', pos: v3.add(CIV_LAYOUT.convoyStart, [i * 45, 0, i * 30]) });
      e.convoy = true;
      e.selectable = true;
      e.name = `${civ.species} ${e.cls}`;
      e.order = { type: 'path', pts: pts.map((p) => v3.add(p, [i * 30, 0, i * 20])), i: 0, done: (x) => arrived(x) };
      w.add(e);
      convoy.push(e);
    }
    let arrivedN = 0, lostN = 0, waveT = 4, waves = 0;
    const maxWaves = 3 + extra;
    const arrived = (x) => {
      arrivedN++;
      x.dead = true;
      game.log(`A convoy ship reaches the capital (${arrivedN}/3).`, 'good');
      check();
    };
    const check = () => {
      if (arrivedN >= 2) finishMission(game, civ, true);
      else if (lostN >= 2) finishMission(game, civ, false);
    };
    game.objective('mission', `Escort the ${civ.species} convoy from the ${civ.landmark.name} to their capital. At least 2 of 3 ships must arrive.`);
    game.cam.set(CIV_LAYOUT.convoyStart, 900, null, 0.8);
    w.script = {
      name: 'convoy',
      update(dt) {
        waveT -= dt;
        const alive = convoy.filter((c) => !c.dead);
        if (waveT <= 0 && waves < maxWaves && alive.length) {
          waveT = 20;
          waves++;
          const c = alive[0];
          const a = Math.random() * TAU;
          for (let i = 0; i < 3 + (waves > 2 ? 1 : 0); i++) {
            const big = i === 0 && waves >= 3;
            const r = makeShip(game.R, { ...raiderOpts(big), team: 'raider', pos: v3.add(c.pos, [Math.cos(a) * 700 + i * 30, 20, Math.sin(a) * 700]) });
            r.home = c.pos;
            r.name = `${civ.neighbor.split(' ')[0]} ${r.cls}`;
            w.add(r);
          }
          game.log(`${civ.neighbor} strike at the convoy!`, 'bad');
        }
      },
      onKill(e) {
        if (e.convoy) {
          lostN++;
          game.log(`Convoy ship lost (${lostN} lost).`, 'bad');
          check();
        }
        keystoneDeath(game, civ, e);
      },
    };
  } else {
    const n = 5 + extra;
    let left = n;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = makeShip(game.R, { ...raiderOpts(i === 0), team: 'raider', pos: v3.add(CIV_LAYOUT.station, [Math.cos(a) * 520, 20, Math.sin(a) * 520]) });
      r.home = v3.add(CIV_LAYOUT.station, [Math.cos(a) * 520, 0, Math.sin(a) * 520]);
      r.blockade = true;
      r.name = `${civ.neighbor.split(' ')[0]} ${r.cls}`;
      w.add(r);
    }
    game.objective('mission', `Break the ${civ.neighbor} blockade around the ${civ.species} capital (${n} ships).`);
    game.cam.set(CIV_LAYOUT.station, 1300, null, 0.8);
    w.script = {
      name: 'blockade',
      update() {},
      onKill(e) {
        if (e.blockade) {
          left--;
          if (left <= 0) finishMission(game, civ, true);
          else game.objective('mission', `Break the ${civ.neighbor} blockade: ${left} ships remain.`);
        }
        keystoneDeath(game, civ, e);
      },
    };
  }
  return null;
}

function finishMission(game, civ, ok) {
  const s = civ.state;
  s.missionActive = null;
  game.world.script = null;
  if (ok) {
    s.helped = true;
    s.trust += 20;
    if (s.status === 'contacted' || s.status === 'unknown') s.status = 'friendly';
    game.banner('They will remember this', `${civ.name} saw you defend them from the ${civ.neighbor}. Their position on every proposal improves.`);
    game.materials += 60;
    game.objective('mission', null);
    game.objective('approach', `Return to the dossier (C) — your help changes the negotiation.`);
  } else {
    s.trust -= 5;
    game.banner('Convoy lost', 'Most of the convoy was destroyed. You can still try other approaches.');
    game.objective('mission', null);
  }
  for (const e of game.world.entities) if (e.team === 'raider') e.order = { type: 'flee', pos: [3000, 0, 3000] };
}

// ---------- Outcomes ----------
export function resolve(game, civ, outcome) {
  const s = civ.state;
  const w = game.world;
  s.hostile = false;
  s.integrating = false;
  w.script = null;
  game.setProgress(null);
  if (outcome === 'conquered') {
    s.status = 'conquered';
    game.materials += 250;
    grantTrait(game, civ.signature, 'schematic', civ);
    game.banner(`${civ.name} surrenders`, 'Territory, salvage and an intact shipyard are yours. Their signature capability is recovered only as an incomplete schematic.');
    if (w.station) {
      w.station.team = 'player';
      w.station.weapons = [];
      w.station.broken = false;
    }
    for (const e of w.entities) if (e.team === 'civ') { e.team = 'neutral'; e.weapons = []; e.order = { type: 'patrol', c: CIV_LAYOUT.station, r: 260 }; }
    game.log(`The ${civ.neighbor} take notice of your conquest. Expect raids.`, 'warn');
  } else if (outcome === 'devastated') {
    s.status = 'devastated';
    game.materials += 600;
    grantTrait(game, civ.signature, 'schematic', civ);
    game.banner(`${civ.species} capital destroyed`, 'Rich salvage — 600 materials — but their shipyards are gone for good.');
    for (const e of w.entities) if (e.team === 'civ') e.order = { type: 'flee', pos: [3000, 0, -3000] };
  } else if (outcome === 'assimilated') {
    s.status = 'assimilated';
    grantTrait(game, civ.signature, 'integrated', civ);
    game.banner(`${civ.name} integrated`, 'Their traits, production and surviving fleet are now part of you.');
    if (w.station) {
      w.station.team = 'player';
      w.station.weapons = [];
      w.station.broken = false;
    }
    for (const e of w.entities) {
      if (e.team === 'civ' && e.kind === 'ship') {
        e.team = 'player';
        e.selectable = true;
        e.hybrid = true;
        e.tint = [0.85, 1.0, 0.9];
        e.order = null;
        e.waveTarget = null;
        e.name = `Integrated ${e.cls}`;
      }
    }
    for (const e of w.entities) if (e.kind === 'node') e.progress = 1;
  }
  game.onOutcome(civ, outcome);
}
