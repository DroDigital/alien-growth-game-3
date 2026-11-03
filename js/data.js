// Factions, ship classes, weapons and inheritable traits.

export const FACTIONS = {
  bloom: {
    id: 'bloom',
    name: 'The Bloom',
    kind: 'organic',
    tagline: 'Living warships. Regeneration, boarding organisms, adaptation.',
    production: 'grows',
    productionVerb: 'Gestating',
    assimilateVerb: 'Seed a symbiotic reef',
    names: { flagship: 'Mother Leviathan', escort: 'Thornback', scout: 'Drifter', repair: 'Mender', boarder: 'Latcher', fighter: 'Spore-drone' },
    home: {
      name: 'Nursery of Thessaly Deep',
      star: [1.0, 0.82, 0.62], starSize: 70,
      planet: 'ocean', planetSize: 150,
      bg: [0.012, 0.03, 0.045], neb1: [0.05, 0.28, 0.32], neb2: [0.35, 0.12, 0.35],
      ambUp: [0.1, 0.2, 0.22], ambDown: [0.08, 0.05, 0.1],
    },
    color: [0.35, 1.0, 0.82],
    blurb: 'The Bloom grows replacements. Damaged ships knit their flesh back together, shed broken shell, and spit boarding spores that devour crippled vessels.',
  },
  array: {
    id: 'array',
    name: 'The Array',
    kind: 'robotic',
    tagline: 'Modular machines. Manufacturing, network bonuses, electronic warfare.',
    production: 'assembles',
    productionVerb: 'Assembling',
    assimilateVerb: 'Establish a network uplink',
    names: { flagship: 'Lattice Prime', escort: 'Node Cluster', scout: 'Prism', repair: 'Fabricator', boarder: 'Intruder', fighter: 'Drone' },
    home: {
      name: 'Foundry of Pale Kethe',
      star: [0.92, 0.95, 1.0], starSize: 60,
      planet: 'industrial', planetSize: 110,
      bg: [0.02, 0.022, 0.03], neb1: [0.18, 0.2, 0.26], neb2: [0.4, 0.22, 0.08],
      ambUp: [0.16, 0.17, 0.2], ambDown: [0.06, 0.05, 0.05],
    },
    color: [0.35, 0.85, 1.0],
    blurb: 'The Array assembles replacements. Ships coordinate through a shared network: the closer they fly, the harder they hit, and their flagship scrambles enemy fire control.',
  },
  ascendancy: {
    id: 'ascendancy',
    name: 'The Ascendancy',
    kind: 'humanoid',
    tagline: 'Crewed carriers. Shields, fighters, combined arms, diplomacy.',
    production: 'launches',
    productionVerb: 'Launching',
    assimilateVerb: 'Install an integration compact',
    names: { flagship: 'Carrier Vigil', escort: 'Lancer Frigate', scout: 'Herald', repair: 'Tender', boarder: 'Assault Tender', fighter: 'Strike Fighter' },
    home: {
      name: 'Throne of Auren',
      star: [1.0, 0.95, 0.82], starSize: 65,
      planet: 'terran', planetSize: 140,
      bg: [0.015, 0.02, 0.05], neb1: [0.1, 0.16, 0.42], neb2: [0.5, 0.35, 0.15],
      ambUp: [0.12, 0.15, 0.25], ambDown: [0.08, 0.06, 0.05],
    },
    color: [0.88, 0.67, 0.26],
    blurb: 'The Ascendancy launches replacements from monumental drydocks. Its carriers fill the sky with fighters behind heavy shields, and its envoys are trusted first.',
  },
};

// Weapons. tags: 'flak' (good vs fighters), 'heavy' (poor vs fighters, good vs capitals/stations)
export const WEAPONS = {
  spore: { name: 'Boarding spores', kind: 'spore', range: 260, dmg: 34, cd: 2.4, speed: 75, color: [0.5, 1.0, 0.6], size: 3.2, dot: 10, tags: ['heavy'] },
  bioplasma: { name: 'Bioplasma', kind: 'bolt', range: 230, dmg: 20, cd: 0.8, speed: 170, color: [0.4, 1.0, 0.85], size: 2.2 },
  thorn: { name: 'Thorn darts', kind: 'bolt', range: 200, dmg: 11, cd: 0.45, speed: 210, color: [0.95, 0.55, 0.8], size: 1.5, tags: ['flak'] },
  sting: { name: 'Stinger', kind: 'bolt', range: 170, dmg: 6, cd: 0.7, speed: 220, color: [0.6, 1.0, 0.8], size: 1.2 },
  cohbeam: { name: 'Coherent beam', kind: 'beam', range: 300, dmg: 30, cd: 1.3, color: [0.45, 0.9, 1.0], width: 1.4, tags: ['heavy'] },
  dronebeam: { name: 'Drone lasers', kind: 'beam', range: 210, dmg: 9, cd: 0.55, color: [1.0, 0.65, 0.25], width: 0.6, tags: ['flak'] },
  prismbeam: { name: 'Prism laser', kind: 'beam', range: 180, dmg: 6, cd: 0.8, color: [0.5, 0.9, 1.0], width: 0.5 },
  battery: { name: 'Gun battery', kind: 'bolt', range: 240, dmg: 21, cd: 0.9, speed: 200, color: [1.0, 0.85, 0.5], size: 2, tags: ['heavy'] },
  lance: { name: 'Lance', kind: 'beam', range: 270, dmg: 42, cd: 2.6, color: [0.6, 0.75, 1.0], width: 1.2, tags: ['heavy'] },
  pd: { name: 'Point defence', kind: 'bolt', range: 160, dmg: 6, cd: 0.3, speed: 260, color: [1.0, 0.9, 0.6], size: 1, tags: ['flak'] },
  heraldgun: { name: 'Light cannon', kind: 'bolt', range: 170, dmg: 6, cd: 0.7, speed: 220, color: [1.0, 0.85, 0.6], size: 1.2 },
  fighterGun: { name: 'Fighter guns', kind: 'bolt', range: 90, dmg: 4, cd: 0.4, speed: 230, color: [1.0, 0.85, 0.5], size: 0.9 },
  // Alien weapons
  resonator: { name: 'Resonant beam', kind: 'beam', range: 250, dmg: 15, cd: 1.0, color: [0.7, 0.9, 1.0], width: 0.9 },
  archivebolt: { name: 'Pulse driver', kind: 'bolt', range: 240, dmg: 12, cd: 0.6, speed: 200, color: [0.9, 0.9, 0.5], size: 1.6 },
  sporecloud: { name: 'Spore cloud', kind: 'spore', range: 200, dmg: 20, cd: 2.2, speed: 70, color: [0.9, 0.6, 0.3], size: 2.8, dot: 3 },
  raidergun: { name: 'Autocannon', kind: 'bolt', range: 210, dmg: 11, cd: 0.7, speed: 210, color: [1.0, 0.35, 0.2], size: 1.4 },
  stationgun: { name: 'Defence battery', kind: 'beam', range: 330, dmg: 18, cd: 1.4, color: [1, 1, 1], width: 1.6, tags: ['heavy'] },
  gravlance: { name: 'Gravity lance', kind: 'beam', range: 290, dmg: 30, cd: 2.8, color: [0.75, 0.45, 1.0], width: 2.0, slow: 3, tags: ['heavy'] },
};

export const ROLE_STATS = {
  flagship: { hull: 1700, shield: 700, regen: 14, armor: 3, speed: 20, turn: 0.6, scan: 1 },
  escort: { hull: 540, shield: 250, regen: 8, armor: 2, speed: 31, turn: 1.4, scan: 1 },
  scout: { hull: 230, shield: 140, regen: 6, armor: 0, speed: 53, turn: 2.4, scan: 3 },
  repair: { hull: 460, shield: 220, regen: 7, armor: 1, speed: 25, turn: 1.0, scan: 1, repair: 22 },
  boarder: { hull: 380, shield: 160, regen: 6, armor: 1, speed: 46, turn: 1.8, scan: 1 },
  fighter: { hull: 30, shield: 0, regen: 0, armor: 0, speed: 81, turn: 4.0, scan: 0 },
  warden: { hull: 420, shield: 200, regen: 7, armor: 2, speed: 28, turn: 1.3, scan: 1 },
  keystone: { hull: 1300, shield: 500, regen: 10, armor: 3, speed: 14, turn: 0.6, scan: 1 },
  convoy: { hull: 420, shield: 120, regen: 4, armor: 1, speed: 18, turn: 0.8, scan: 0 },
  raider: { hull: 300, shield: 100, regen: 4, armor: 1, speed: 36, turn: 1.8, scan: 0 },
  raiderBig: { hull: 900, shield: 300, regen: 6, armor: 2, speed: 21, turn: 0.8, scan: 0 },
};

export const FACTION_LOADOUT = {
  bloom: { flagship: ['spore', 'bioplasma', 'bioplasma'], escort: ['thorn', 'thorn'], scout: ['sting'], repair: [], boarder: ['thorn'], fighter: ['fighterGun'] },
  array: { flagship: ['cohbeam', 'cohbeam'], escort: ['dronebeam', 'dronebeam'], scout: ['prismbeam'], repair: ['prismbeam'], boarder: ['dronebeam'], fighter: ['fighterGun'] },
  ascendancy: { flagship: ['battery', 'battery', 'pd'], escort: ['lance', 'pd'], scout: ['heraldgun'], repair: ['pd'], boarder: ['pd'], fighter: ['fighterGun'] },
};

export const FACTION_MODS = {
  bloom: { hull: 1.15, shield: 0.8, regenHull: 0.004, regenHullIdle: 0.025 },
  array: { hull: 1.0, shield: 1.0, regenHull: 0, regenHullIdle: 0.004, network: true },
  ascendancy: { hull: 1.0, shield: 1.3, regenHull: 0, regenHullIdle: 0.006, carrier: true },
};

export const SHIP_COST = { escort: 160, scout: 80, repair: 140, boarder: 150, flagship: 450 };
export const BUILD_TIME = { escort: 16, scout: 9, repair: 14, boarder: 14, flagship: 40 };
export const ADAPT_SLOTS = { flagship: 2, escort: 1, scout: 1, repair: 1, boarder: 1, warden: 1, keystone: 2 };

// Signature capabilities that can be inherited. Each faction expresses them differently.
export const TRAITS = {
  resonance: {
    id: 'resonance',
    name: 'Resonant Shields',
    tech: 'coherent light',
    color: [0.6, 0.9, 1.0],
    desc: 'Shield output +45%, recharge +60%.',
    expr: {
      bloom: 'Crystalline organs grow between the armour plates.',
      array: 'An unfolding geometric shield lattice rotates around the hull.',
      ascendancy: 'Rotating resonance emitters rise on dorsal pylons.',
    },
  },
  gravity: {
    id: 'gravity',
    name: 'Gravity Lance',
    tech: 'gravity manipulation',
    color: [0.75, 0.45, 1.0],
    desc: 'Adds a long-range lance that slows its target.',
    expr: {
      bloom: 'A dense, violet gravity sac swells beneath the body.',
      array: 'Twin gravitic rails extend along the keel.',
      ascendancy: 'A ring cannon is mounted at the prow.',
    },
  },
  regrowth: {
    id: 'regrowth',
    name: 'Living Hull Weave',
    tech: 'bioengineering',
    color: [0.5, 1.0, 0.55],
    desc: 'Hull regenerates continuously, even in combat.',
    expr: {
      bloom: 'A crown of healing fronds sprouts from the back.',
      array: 'A nanite cloud circles the hull, patching breaches.',
      ascendancy: 'Medical bays with regenerative tanks are fitted to the flanks.',
    },
  },
  swarm: {
    id: 'swarm',
    name: 'Assembler Swarm',
    tech: 'modular machinery',
    color: [1.0, 0.75, 0.3],
    desc: 'Releases combat drones that harass nearby enemies.',
    expr: {
      bloom: 'Brood pods ripen on the flanks and release drone-spawn.',
      array: 'Drone racks unfold from the hull.',
      ascendancy: 'An additional hangar wing is bolted to each side.',
    },
  },
};

export const TIERS = {
  schematic: { name: 'Recovered schematic', mul: 0.6, note: 'Incomplete — salvaged from wreckage.' },
  licensed: { name: 'Treaty licence', mul: 0.85, note: 'Shared under treaty. Lost if the treaty ends.' },
  integrated: { name: 'Deep integration', mul: 1.15, note: 'Fully absorbed — stronger than the original.' },
};

export const OBJECTIVES = {
  survey: { name: 'Survey', desc: 'Scanning speed +60%. Better intelligence, faster.' },
  strike: { name: 'Strike', desc: 'Weapon damage +12% for this expedition.' },
  envoy: { name: 'Envoy', desc: 'Start with +10 trust from any civilization you meet.' },
  integrate: { name: 'Integration', desc: 'Integration speed +30% for this expedition.' },
};

// Faction weaknesses, stated plainly so players can plan around them.
export const WEAKNESS = {
  bloom: 'Regeneration and growth draw on biological reserves. When reserves run dry, ships stop healing.',
  array: 'Network bonuses need a live command link to the flagship. Isolated or decapitated formations fight worse.',
  ascendancy: 'Crews gain veterancy from kills. Veterans hit harder — and losing them costs more than the hull.',
};

// Active abilities, centred on the flagship. Cooldowns in seconds of simulation time.
export const ABILITIES = {
  bloom: [
    { id: 'surge', name: 'Regenerative surge', key: 'J', cd: 30, cost: { reserves: 35 }, desc: 'Ships near the flagship knit 30% of their hull back over six seconds.' },
    { id: 'sporebloom', name: 'Spore bloom', key: 'K', cd: 24, cost: { reserves: 15 }, desc: 'Releases a boarding-spore cloud that infests every enemy near the flagship.' },
  ],
  array: [
    { id: 'overclock', name: 'Overclock network', key: 'J', cd: 30, cost: { energy: 15 }, desc: 'Fleet fire rate +45% for eight seconds. Needs the flagship command link.' },
    { id: 'intrusion', name: 'Electronic intrusion', key: 'K', cd: 22, cost: { energy: 10 }, desc: "Shuts down the focused enemy's weapons (longer against machines)." },
  ],
  ascendancy: [
    { id: 'brace', name: 'Brace shields', key: 'J', cd: 30, cost: { energy: 12 }, desc: 'Fleet shields surge by half and incoming damage drops 30% for six seconds.' },
    { id: 'scramble', name: 'Scramble wing', key: 'K', cd: 35, cost: { energy: 12 }, desc: 'The carrier launches an extra strike wing immediately.' },
  ],
};

export const RESEARCH = {
  boarding: { name: 'Boarding doctrine', cost: 60, desc: 'Unlocks boarding craft. They capture ships whose engines are disabled.' },
  capacity: { name: 'Integration lattice', cost: 120, desc: '+1 integration capacity.' },
  slots: { name: 'Adaptive frames', cost: 140, desc: '+1 adaptation slot on every ship.' },
  jumpkit: { name: 'Jump support array', cost: 90, desc: 'Jumps cost 40% less energy.' },
  deepscan: { name: 'Long-range scanners', cost: 70, desc: 'Reveals the signatures of every system in the cluster.' },
  subsys: { name: 'Fire-control analysis', cost: 80, desc: 'Subsystem focus fire deals 40% more subsystem damage.' },
};

export const SYSTEM_ROLES = {
  industry: { name: 'Industry', desc: '+1.2 materials/s' },
  research: { name: 'Research', desc: '+0.25 knowledge/s' },
  trade: { name: 'Trade', desc: '+0.5 energy/s' },
  defense: { name: 'Defence', desc: 'Raids here are repelled automatically' },
};

export const SUBSYSTEMS = {
  engines: { name: 'Engines', effect: 'Adrift — vulnerable to boarding' },
  weapons: { name: 'Weapons', effect: 'Guns silent' },
  shields: { name: 'Shields', effect: 'Shields collapsed' },
  command: { name: 'Command', effect: 'Coordination broken' },
};
