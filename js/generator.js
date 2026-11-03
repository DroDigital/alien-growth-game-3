// Layered procedural generation: each layer constrains the next, so a civilization's
// star, home, body, technology, society and history all hang together.
import { rng, col, TAU, hashStr } from './math.js';

const STELLAR = {
  binary: { name: 'Binary star', desc: 'Two suns circle each other, splitting shadows across the system.', hazard: null },
  quiet: { name: 'Quiet star', desc: 'A stable, unremarkable star. Good for patient civilizations.', hazard: null },
  remnant: { name: 'Stellar remnant', desc: 'A pulsar sweeps the system with beams of hard radiation.', hazard: 'pulsar' },
  debris: { name: 'Dense debris', desc: 'Shattered worlds crowd the orbits. Routes are narrow.', hazard: 'debris' },
};

const HABITATS = {
  ocean: { name: 'Ocean world', planet: 'ocean' },
  orbital: { name: 'Orbital colony', planet: 'ash' },
  gas: { name: 'Gas-giant atmosphere', planet: 'gas' },
  artificial: { name: 'Artificial world', planet: 'industrial' },
  crystal: { name: 'Mineral world', planet: 'crystal' },
};

const STRUCTURES = {
  crystalline: {
    name: 'Crystalline',
    body: 'branching mineral beings that think in resonant harmonics',
    syll: ['Il', 'yr', 'Vae', 'sel', 'Ith', 'ae', 'Ryn', 'lu', 'Thae', 'os', 'Qir', 'ien'],
    keystone: 'conductor',
  },
  synthetic: {
    name: 'Synthetic',
    body: 'synthetic minds housed in archival frames, long outliving their makers',
    syll: ['Vask', 'ko', 'Tre', 'dax', 'Om', 'eru', 'Kel', 'zu', 'Ar', 'chon', 'Pex', 'ul'],
    keystone: 'archive',
  },
  colonial: {
    name: 'Colonial',
    body: 'colonial organisms: billions of drifting cells that share one will',
    syll: ['Se', 're', 'Mo', 'ul', 'Gha', 'dri', 'fen', 'Ub', 'oth', 'Ny', 'lae', 'Sha'],
    keystone: 'command',
  },
};

const TECH = {
  resonance: 'coherent light',
  gravity: 'gravity manipulation',
  regrowth: 'bioengineering',
  swarm: 'modular machinery',
};

const SOCIETY = {
  isolation: { name: 'Isolationist', title: ['Enclave', 'Silence', 'Veil'], pri: { security: 2, commerce: 0, knowledge: 1, autonomy: 3, honor: 2 }, trust: -10 },
  expansion: { name: 'Expansionist', title: ['Dominion', 'Ascent', 'Reach'], pri: { security: 1, commerce: 1, knowledge: 1, autonomy: 2, honor: 3 }, trust: 0 },
  commerce: { name: 'Mercantile', title: ['Exchange', 'Concord', 'Market'], pri: { security: 2, commerce: 3, knowledge: 1, autonomy: 1, honor: 0 }, trust: 15 },
  preservation: { name: 'Preservationist', title: ['Archive', 'Remnant', 'Keeping'], pri: { security: 2, commerce: 1, knowledge: 3, autonomy: 1, honor: 1 }, trust: 5 },
  distributed: { name: 'Distributed', title: ['Choir', 'Drift', 'Chorus'], pri: { security: 3, commerce: 1, knowledge: 2, autonomy: 2, honor: 0 }, trust: 10 },
};

const HISTORY = {
  migration: {
    name: 'Migration',
    desc: 'They arrived here generations ago, fleeing something. Their routes are still contested.',
    problem: 'convoy',
    landmark: { crystalline: 'spire', synthetic: 'gate', colonial: 'graveyard' },
  },
  civilwar: {
    name: 'Civil war',
    desc: 'A schism split the civilization. Rebel squadrons still blockade the capital.',
    problem: 'blockade',
    landmark: { crystalline: 'spire', synthetic: 'foundry', colonial: 'graveyard' },
  },
  rivalry: {
    name: 'Ancient rivalry',
    desc: 'A neighbouring power has raided them for centuries and has grown bolder.',
    problem: 'blockade',
    landmark: { crystalline: 'gate', synthetic: 'gate', colonial: 'gate' },
  },
  crisis: {
    name: 'Resource crisis',
    desc: 'Their industry is starving for materials. Supply convoys are a lifeline — and a target.',
    problem: 'convoy',
    landmark: { crystalline: 'foundry', synthetic: 'foundry', colonial: 'foundry' },
  },
};

const LANDMARK_NAMES = {
  spire: ['The Singing Spire', 'Cathedral of Facets', 'The Tuning Fork'],
  gate: ['The Elder Gate', 'Ring of Thresholds', 'The Silent Arch'],
  graveyard: ['Leviathan Graveyard', 'The Long Ribs', 'Ossuary Reach'],
  foundry: ['Derelict Foundry', 'The Cold Forges', 'Shattered Works'],
};

const VULN = {
  conductor: {
    name: 'Coordinated resonance',
    desc: 'Their ships share shield energy through a Conductor vessel. Destroying it collapses every nearby shield.',
    risk: 'While the Conductor lives, resonance pulses will damage an integration site.',
  },
  archive: {
    name: 'Centralised archive',
    desc: 'An Archive Core computes firing solutions for the whole fleet (+35% damage). Destroy it and they fight half-blind.',
    risk: 'While the Archive Core lives, it slows integration by contesting the network.',
  },
  command: {
    name: 'Command organism',
    desc: 'A single living creature directs the colony. If it dies, the whole fleet routs.',
    risk: 'While the command organism lives, resistance waves will be larger.',
  },
};

// Opinion of each player faction, by species structure.
const AFFINITY = {
  crystalline: { bloom: [-15, 'Find organic life chaotic and loud'], array: [5, 'Admire the precision of machine minds'], ascendancy: [0, 'Regard crewed ships with curiosity'] },
  synthetic: { bloom: [-5, 'Fear uncontrolled biological growth'], array: [-15, 'Suspect the Array wants to absorb their minds'], ascendancy: [10, 'Respect a civilization that keeps records'] },
  colonial: { bloom: [15, 'Recognise kindred living ships'], array: [-10, 'Distrust cold machinery'], ascendancy: [0, 'Are wary of armed crews'] },
};

function makeName(r, syll, n = 2) {
  let s = '';
  for (let i = 0; i < n; i++) s += r.pick(syll);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function paletteFor(structure, r) {
  const h = r();
  if (structure === 'crystalline') {
    const glow = col.hsl(0.5 + h * 0.3, 0.7, 0.7);
    return { hull: col.hsl(0.55 + h * 0.2, 0.25, 0.75), dark: col.hsl(0.6 + h * 0.2, 0.3, 0.35), glow, accent: col.hsl(0.6 + h * 0.2, 0.5, 0.6) };
  }
  if (structure === 'synthetic') {
    return { hull: col.hsl(0.08 + h * 0.1, 0.15, 0.55), dark: col.hsl(0.1, 0.1, 0.22), glow: col.hsl(0.12 + h * 0.08, 0.85, 0.6), accent: [0.6, 0.55, 0.45] };
  }
  return { hull: col.hsl(0.0 + h * 0.12, 0.4, 0.55), dark: col.hsl(0.95, 0.3, 0.25), glow: col.hsl(0.08 + h * 0.1, 0.9, 0.62), accent: col.hsl(0.9 + h * 0.1, 0.35, 0.45) };
}

export function generateCiv(seed, faction) {
  const r = rng(seed);
  // 1. Stellar environment
  const stellar = r.pick(Object.keys(STELLAR));
  // 2. Habitat (constrained by the star)
  const habitat = r.weighted(
    {
      binary: [['ocean', 2], ['crystal', 3], ['gas', 2], ['orbital', 1]],
      quiet: [['ocean', 3], ['gas', 2], ['artificial', 2], ['orbital', 1]],
      remnant: [['crystal', 4], ['artificial', 2], ['orbital', 2]],
      debris: [['orbital', 3], ['artificial', 3], ['gas', 1]],
    }[stellar]
  );
  // 3. Species structure (constrained by habitat)
  const structure = r.weighted(
    {
      ocean: [['colonial', 3], ['crystalline', 1], ['synthetic', 1]],
      orbital: [['synthetic', 3], ['crystalline', 1], ['colonial', 1]],
      gas: [['colonial', 5], ['crystalline', 1]],
      artificial: [['synthetic', 5], ['crystalline', 1]],
      crystal: [['crystalline', 5], ['synthetic', 1]],
    }[habitat]
  );
  // 4. Technology (constrained by structure)
  const signature = r.weighted(
    {
      crystalline: [['resonance', 5], ['gravity', 2]],
      synthetic: [['swarm', 4], ['resonance', 1], ['gravity', 2]],
      colonial: [['regrowth', 5], ['gravity', 1], ['swarm', 1]],
    }[structure]
  );
  // 5. Society
  const society = r.weighted(
    {
      crystalline: [['distributed', 4], ['isolation', 2], ['preservation', 2], ['expansion', 1]],
      synthetic: [['preservation', 4], ['commerce', 2], ['isolation', 1], ['expansion', 2]],
      colonial: [['distributed', 3], ['commerce', 2], ['expansion', 2], ['isolation', 1]],
    }[structure]
  );
  // 6. History
  const history = r.weighted([['migration', 1], ['civilwar', 1], ['rivalry', 1], ['crisis', 1]]);
  const st = STRUCTURES[structure];
  const species = makeName(r, st.syll, 2);
  const title = r.pick(SOCIETY[society].title);
  const name = `The ${makeName(r, st.syll, 2)} ${title}`;
  const landmarkKind = HISTORY[history].landmark[structure];
  const landmark = { kind: landmarkKind, name: r.pick(LANDMARK_NAMES[landmarkKind]) };
  const pal = paletteFor(structure, r);
  const neighbor = `${makeName(r, ['Kesh', 'ar', 'Vor', 'ath', 'Grim', 'ul', 'Zan', 'ek', 'Hrak', 'os'], 2)} Marauders`;
  const pri = { ...SOCIETY[society].pri };
  if (history === 'crisis') pri.commerce = Math.min(3, pri.commerce + 1);
  if (history === 'rivalry' || history === 'civilwar') pri.security = 3;
  const aff = AFFINITY[structure][faction];

  // Palette of the whole system (deliberate composition).
  const h = r();
  const sys = {
    star: stellar === 'remnant' ? [0.75, 0.85, 1.0] : col.hsl(0.05 + h * 0.12, 0.6, 0.8),
    star2: col.hsl(0.55 + h * 0.2, 0.6, 0.75),
    bg: col.mul(col.hsl(h + 0.5, 0.6, 0.5), 0.05),
    neb1: col.mul(col.hsl(h + 0.55, 0.5, 0.5), 0.55),
    neb2: col.mul(col.hsl(h + 0.85, 0.6, 0.5), 0.6),
    ambUp: col.mul(col.hsl(h + 0.55, 0.4, 0.5), 0.35),
    ambDown: col.mul(col.hsl(h + 0.9, 0.3, 0.4), 0.18),
    gasA: col.hsl(0.05 + r() * 0.15, 0.55, 0.62),
    gasB: col.hsl(0.85 + r() * 0.2, 0.35, 0.4),
  };

  const vulnKey = st.keystone;
  return {
    seed,
    id: 'civ' + seed,
    name,
    species,
    structure,
    stellar,
    habitat,
    signature,
    society,
    history,
    landmark,
    pal,
    sys,
    neighbor,
    priorities: pri,
    affinity: { value: aff[0], text: aff[1] },
    keystone: vulnKey,
    vulnerability: VULN[vulnKey],
    scarcity: history === 'crisis',
    texts: {
      stellar: STELLAR[stellar],
      habitat: HABITATS[habitat],
      structure: st,
      society: SOCIETY[society],
      history: HISTORY[history],
      tech: TECH[signature],
    },
    problem: HISTORY[history].problem,
    baseTrust: SOCIETY[society].trust,
    fleetSize: 2 + r.int(0, 2),
  };
}

// The galaxy: a home system, three reachable civilizations, and a great many distant stars.
export function generateGalaxy(seed, faction) {
  const r = rng(seed);
  const systems = [];
  systems.push({ id: 'home', name: null, pos: [0, 0], kind: 'home', reachable: true });
  const civSeeds = [];
  // Ensure three distinct structures for variety in a first expedition.
  const wanted = ['crystalline', 'colonial', 'synthetic'];
  let s = seed * 7 + 1;
  for (const w of wanted) {
    let civ;
    for (let k = 0; k < 200; k++) {
      s = (s * 1103515245 + 12345) >>> 0;
      civ = generateCiv(s, faction);
      if (civ.structure === w) break;
    }
    civSeeds.push(civ);
  }
  civSeeds.forEach((civ, i) => {
    const a = -0.5 + i * 1.1 + r() * 0.3;
    const d = 150 + r() * 60;
    systems.push({ id: civ.id, civ, name: civ.texts.stellar.name, pos: [Math.cos(a) * d, Math.sin(a) * d], kind: 'civ', reachable: true });
  });
  const far = [];
  for (let i = 0; i < 1600; i++) {
    // spiral arms
    const arm = i % 3;
    const t = r() ** 0.7;
    const ang = arm * (TAU / 3) + t * 5.5 + (r() - 0.5) * 0.6;
    const d = 80 + t * 1100;
    far.push({ pos: [Math.cos(ang) * d - 380, Math.sin(ang) * d + 120], b: 0.15 + r() ** 2 * 0.85, hue: r() });
  }
  return { systems, far, seed };
}

export function civHash(civ) {
  return hashStr(civ.name);
}
