// Save / load. Generated content is rebuilt from the galaxy seed; only mutable campaign state
// is stored, so a saved civilization is always the same civilization when you come back.
const KEY = 'strange-dominion-save-v2';

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function saveInfo() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    return d ? { faction: d.faction, when: d.when, where: d.whereName } : null;
  } catch {
    return null;
  }
}

function shipRec(e, where) {
  return {
    where,
    style: e.style, role: e.role, traits: e.traits, slots: e.slots, name: e.name, cls: e.cls,
    hull: e.hull, shield: e.shield, hybrid: e.hybrid, captured: e.captured, alliedFrom: e.alliedFrom,
    pal: e.pal, vseed: e.vseed, loadout: e.loadout, xp: e.xp, tint: e.tint, hullMul: e.hullMul, civId: e.civId,
  };
}

export function saveGame(game) {
  if (game.state !== 'play') return false;
  const home = game.playerShips(game.homeWorld).concat(game.buildQueue).map((e) => shipRec(e, 'home'));
  const field = game.currentSystem === 'home' ? [] : game.world.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && !e.dead && (e.selectable || e.alliedFrom)).map((e) => shipRec(e, 'field'));
  const civStates = {};
  for (const [id, c] of Object.entries(game.civs)) civStates[id] = c.state;
  const data = {
    v: 2,
    when: Date.now(),
    whereName: game.world.name,
    faction: game.faction,
    seed: game.galaxy.seed,
    res: { materials: game.materials, energy: game.energy, knowledge: game.knowledge, reserves: game.reserves },
    traits: game.traits,
    integrationCap: game.integrationCap,
    integrationUsed: game.integrationUsed,
    research: game.research,
    bonusSlots: game.bonusSlots,
    driveReady: game.driveReady,
    relayActive: game.relayActive,
    tutorial: game.tutorial,
    shipCounter: game.shipCounter,
    currentSystem: game.currentSystem,
    stime: game.stime,
    eventT: game.eventT,
    coalition: game.coalition,
    won: game.won,
    firstRefit: game.firstRefit,
    outcomes: game.outcomes,
    objectives: [...game.objectives.entries()],
    objective: game.expeditionPlan.objective,
    civStates,
    sys: game.sys,
    known: [...game.known],
    ships: [...home, ...field],
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadData() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
