// Strange Dominion — game orchestration: campaign state, selection and orders, jumps,
// tutorial, economy, inheritance, save/load and audio routing.
import { v3, clamp } from './math.js';
import { Renderer } from './gl.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { World } from './sim.js';
import { renderWorld, drawOverlay } from './render.js';
import { FACTIONS, ADAPT_SLOTS, SHIP_COST, BUILD_TIME, TRAITS } from './data.js';
import { generateGalaxy } from './generator.js';
import { makeShip, applyStats, refreshVisual } from './entities.js';
import { buildHomeWorld, buildCivWorld, buildEmptyWorld, snapshotCiv, makeWreck, applyHomeUpgrades, homeEnv, HOME_LAYOUT } from './systems.js';
import { initCivState, hail, conquestScript, keystoneDeath } from './encounter.js';
import { sysState, sysLabel, strategicTick, spawnThreat, checkThreatCleared, checkCoalition, checkVictory, useAbility } from './events.js';
import { Audio } from './audio.js';
import { saveGame, loadData, hasSave } from './save.js';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.hud = document.getElementById('hud2d');
    this.ctx = this.hud.getContext('2d');
    this.settings = loadSettings();
    const low = this.settings.quality === 'low' || (this.settings.quality === 'auto' && (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('low')));
    this.R = new Renderer(this.canvas, low ? 'low' : 'high');
    this.R.dither = this.settings.dither;
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.cam = new Camera();
    this.selection = new Set();
    this.hover = null;
    this.paused = false;
    this.speed = 1;
    this.state = 'title';
    this.objectives = new Map();
    this.progress = null;
    this.debug = false;
    this.fps = 60;
    this.formation = 'keep';
    this.input = new Input(this, this.hud);
    this.ui = new UI(this);
    this.last = performance.now();
    this.startTitle('bloom');
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- Title / preview ----------------
  startTitle(faction) {
    this.state = 'title';
    this.previewFaction = faction;
    const env = homeEnv(faction);
    const world = new World(this, { env, bodies: [], kind: 'preview' });
    world.bodies = buildHomeWorld({ R: this.R, faction, traits: {}, civs: {}, sys: {}, sysState: () => ({}) }).bodies;
    ['flagship', 'escort', 'escort', 'scout'].forEach((role, i) => {
      const e = makeShip(this.R, { style: faction, role, team: 'neutral', pos: [600 + (i ? (i - 2) * 60 : 0), 0, 600 + (i ? 60 : 0)] });
      e.order = { type: 'patrol', c: [600, 0, 600], r: 90 + i * 50, a: i * 1.6 };
      world.add(e);
    });
    this.world = world;
    this.cam.set([600, 0, 600], 260, 0.8, 0.3, true);
    this.cam.follow(null);
  }

  // ---------------- New campaign ----------------
  newGame(faction, opts = {}) {
    this.audio.start(faction);
    this.faction = faction;
    this.fac = FACTIONS[faction];
    this.materials = 300;
    this.energy = 120;
    this.energyCap = 250;
    this.knowledge = 0;
    this.reserves = 100;
    this.traits = {};
    this.integrationCap = 1;
    this.integrationUsed = 0;
    this.research = {};
    this.bonusSlots = 0;
    this.abilityCd = {};
    this.driveReady = false;
    this.relayActive = false;
    this.coalition = false;
    this.won = false;
    this.firstRefit = false;
    this.expeditionPlan = { ids: null, objective: 'survey' };
    this.expedition = null;
    this.galaxy = generateGalaxy(opts.seed ?? 4242 + Math.floor(Math.random() * 100000), faction);
    this.civs = {};
    this.sys = {};
    this.known = new Set(['home']);
    for (const s of this.galaxy.systems) {
      if (s.civ) {
        initCivState(s.civ);
        this.civs[s.civ.id] = s.civ;
      }
    }
    this.galaxy.systems[0].name = this.fac.home.name;
    this.stime = 0;
    this.eventT = 240;
    this.outcomes = [];
    this.buildQueue = [];
    this.homeWorld = buildHomeWorld(this);
    this.wreck = makeWreck(this, this.homeWorld);
    this.shipCounter = 1;
    if (!opts.empty) {
      const fp = HOME_LAYOUT.fleet;
      for (const [role, off] of [['flagship', [0, 0, 0]], ['escort', [-70, 0, -30]], ['escort', [70, 0, -30]], ['scout', [0, 0, 80]]]) {
        const e = makeShip(this.R, { style: faction, role, team: 'player', pos: v3.add(fp, off), yaw: -2.4, slots: ADAPT_SLOTS[role] });
        e.name = role === 'flagship' ? this.fac.names.flagship : `${e.cls} ${NUMERALS[this.shipCounter++ - 1]}`;
        this.homeWorld.add(e);
      }
    }
    this.world = this.homeWorld;
    this.currentSystem = 'home';
    sysState(this, 'home').visited = true;
    this.state = 'play';
    this.selection.clear();
    this.objectives.clear();
    this.tutorial = 0;
    this.saveT = 60;
    const fp = HOME_LAYOUT.fleet;
    this.cam.set(fp, 340, Math.atan2(fp[0], fp[2]), 0.32, true);
    this.ui.enterGame();
    if (!opts.empty) {
      this.objective('tut', 'Select your fleet: drag a box around your ships, or press Ctrl+A.');
      this.banner(this.fac.home.name, `${this.fac.name}. ${this.fac.tagline}`);
      this.log('Welcome, commander. Space pauses time. Orders can be given while paused.');
    }
  }

  continueGame() {
    const d = loadData();
    if (!d) return;
    this.newGame(d.faction, { seed: d.seed, empty: true });
    Object.assign(this, {
      materials: d.res.materials, energy: d.res.energy, knowledge: d.res.knowledge, reserves: d.res.reserves,
      traits: d.traits, integrationCap: d.integrationCap, integrationUsed: d.integrationUsed, research: d.research,
      bonusSlots: d.bonusSlots, driveReady: d.driveReady, relayActive: d.relayActive, tutorial: d.tutorial,
      shipCounter: d.shipCounter, stime: d.stime, eventT: d.eventT, coalition: d.coalition, won: d.won,
      firstRefit: d.firstRefit, outcomes: d.outcomes, sys: d.sys, known: new Set(d.known),
    });
    this.expeditionPlan.objective = d.objective;
    for (const [id, st] of Object.entries(d.civStates)) if (this.civs[id]) this.civs[id].state = st;
    if (this.driveReady) {
      this.wreck.scan.done = true;
      this.wreck.name = 'Investigated wreck';
    }
    applyHomeUpgrades(this, this.homeWorld);
    const field = [];
    d.ships.forEach((r, i) => {
      const e = makeShip(this.R, { ...r, team: 'player', pos: v3.add(HOME_LAYOUT.fleet, [(i % 4) * 60 - 90, 0, Math.floor(i / 4) * 60]) });
      e.hull = Math.min(e.maxHull, r.hull);
      e.shield = Math.min(e.maxShield, r.shield);
      if (r.where === 'field') field.push(e);
      else this.homeWorld.add(e);
    });
    this.objectives.clear();
    for (const [k, v] of d.objectives) this.objectives.set(k, v);
    this.ui.renderObjectives();
    if (d.currentSystem !== 'home' && field.length) this.enterSystem(d.currentSystem, field, { warp: false });
    else this.returnToFleet();
    this.banner('Campaign resumed', `${sysLabel(this, this.currentSystem)}.`);
  }

  save(manual) {
    const ok = saveGame(this);
    if (manual) this.log(ok ? 'Campaign saved.' : 'Saving failed (browser storage unavailable).', ok ? 'good' : 'bad');
  }

  flagship() {
    return this.world.entities.find((e) => e.team === 'player' && e.role === 'flagship' && !e.dead && !e.ally && e.style === this.faction);
  }
  playerShips(world = this.world) {
    return world.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && !e.dead && e.selectable && !e.building);
  }
  allPlayerShips() {
    return [...new Set([...this.playerShips(this.homeWorld), ...this.playerShips(this.world)])];
  }
  sysState(id) {
    return sysState(this, id);
  }

  // ---------------- Messages ----------------
  log(msg, kind = 'info') {
    this.ui.log(msg, kind);
    if (kind === 'good' || kind === 'bad') this.audio.ui(kind);
  }
  banner(title, text) {
    this.ui.banner(title, text);
    this.audio.ui('good');
  }
  alert(title, text) {
    this.ui.banner(title, text);
    this.ui.log(title + ' — ' + text, 'bad');
    this.audio.ui('alert');
  }
  objective(key, text) {
    if (text) this.objectives.set(key, text);
    else this.objectives.delete(key);
    this.ui.renderObjectives();
  }
  setProgress(label, k) {
    this.progress = label ? { label, k: clamp(k, 0, 1) } : null;
  }

  // ---------------- Frame loop ----------------
  frame(now) {
    const rdt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(1e-3, rdt)) * 0.05;
    this.input.update(rdt);
    const simPaused = this.paused || (this.ui.galaxyOpen && this.settings.galaxyPause) || this.ui.modalOpen;
    if (this.world) {
      if (this.state === 'title') this.world.update(rdt);
      else if (!simPaused) for (let i = 0; i < this.speed; i++) this.world.update(rdt);
    }
    if (this.state === 'play') {
      const sdt = simPaused ? 0 : rdt * this.speed;
      if (sdt) {
        strategicTick(this, sdt);
        for (const k in this.abilityCd) this.abilityCd[k] = Math.max(0, this.abilityCd[k] - sdt);
        this.saveT -= sdt;
        if (this.saveT <= 0) {
          this.saveT = 60;
          this.save();
        }
      }
      this.updateJump(rdt);
      this.checkLost(sdt);
      this.updateBuilds(sdt);
      this.updateTutorial();
      this.audio.setMood(this.world.t - this.world.lastCombat < 6 ? 'battle' : this.world.civ && !['conquered', 'assimilated', 'protectorate', 'allied'].includes(this.world.civ.state.status) ? 'contact' : 'explore');
    }
    if (this.state === 'title') this.cam.orbit(rdt * 0.06, 0);
    this.cam.update(rdt);
    this.R.resize();
    const W = this.hud.clientWidth, H = this.hud.clientHeight;
    if (this.hud.width !== W || this.hud.height !== H) {
      this.hud.width = W;
      this.hud.height = H;
    }
    if (this.world) {
      renderWorld(this, this.world, this.cam, this.R, this.canvas.height);
      drawOverlay(this.ctx, this, this.state === 'play' ? this.world : null, this.cam, this.R, W, H);
    }
    this.ui.update(rdt);
    requestAnimationFrame((t) => this.frame(t));
  }

  // Advance the whole game by dt seconds (used by automated tests).
  tick(dt) {
    this.world.update(dt);
    strategicTick(this, dt);
    for (const k in this.abilityCd) this.abilityCd[k] = Math.max(0, this.abilityCd[k] - dt);
    this.updateJump(dt);
    this.checkLost(dt);
    this.updateBuilds(dt);
  }

  // Losing the expedition need not end the campaign while home can rebuild.
  checkLost(dt) {
    if (this.currentSystem === 'home' || this.jump || this.playerShips().length) {
      this.lostT = 0;
      return;
    }
    this.lostT = (this.lostT || 0) + dt;
    if (this.lostT > 3) {
      this.lostT = 0;
      this.jump = { t: 3, ships: [], to: 'home' };
      this.banner('Expedition lost', 'No ships survived. Your sensors kept what they learned — rebuild at home and return better prepared.');
    }
  }

  // ---------------- Tutorial ----------------
  updateTutorial() {
    if (this.tutorial === 0 && [...this.selection].some((id) => this.world.get(id)?.team === 'player')) {
      this.tutorial = 1;
      this.objective('tut', 'Right-click in space to move. Right-drag to orbit the camera, scroll to zoom across scales. Try a formation in the selection panel.');
    }
  }
  tutorialMoved() {
    if (this.tutorial === 1) {
      this.tutorial = 2;
      this.objective('tut', 'Investigate the derelict wreck: select a ship (your scout scans fastest) and right-click the wreck.');
      this.log('Sensors detect an unidentified wreck drifting at the edge of the system.');
    }
  }

  // ---------------- Selection & commands ----------------
  pick(x, y, filter) {
    const W = this.hud.clientWidth, H = this.hud.clientHeight;
    let best = null, bd = 1e9;
    for (const e of this.world.entities) {
      if (e.dead || e.isFighter || e.visitor || e.kind === 'deco') continue;
      if (filter && !filter(e)) continue;
      const p = this.R.project(e.pos, W, H);
      if (!p) continue;
      const r = Math.max(14, (e._px || 0) * 0.9);
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < r && d / r < bd) {
        bd = d / r;
        best = e;
      }
    }
    return best;
  }
  updateHover(x, y) {
    if (this.state !== 'play' || !this.world) return;
    this.hover = this.pick(x, y);
    const h = this.hover;
    let cur = 'default';
    if (h) {
      cur = 'pointer';
      if (this.hasCommandable() && this.world.hostile({ team: 'player' }, h)) cur = this.canBoard(h) ? 'alias' : 'crosshair';
    }
    this.hud.style.cursor = cur;
  }
  hasCommandable() {
    return this.commandable().length > 0;
  }
  commandable() {
    return [...this.selection].map((id) => this.world.get(id)).filter((e) => e && e.team === 'player' && e.kind === 'ship' && !e.immobile && !e.building);
  }
  clickSelect(x, y, shift, dbl) {
    if (this.state !== 'play') return;
    const e = this.pick(x, y);
    if (e && e.team === 'player' && e.selectable) {
      if (dbl) {
        const same = this.playerShips().filter((o) => o.role === e.role);
        if (!shift) this.selection.clear();
        same.forEach((o) => this.selection.add(o.id));
        this.cam.follow(e);
      } else {
        if (!shift) this.selection.clear();
        if (shift && this.selection.has(e.id)) this.selection.delete(e.id);
        else this.selection.add(e.id);
      }
    } else if (e) {
      if (!shift || ![...this.selection].length) {
        this.selection.clear();
        this.selection.add(e.id);
      }
    } else if (!shift) this.selection.clear();
    this.audio.ui('click');
    this.ui.renderSelection();
  }
  boxSelect(x0, y0, x1, y1, shift) {
    if (this.state !== 'play') return;
    const W = this.hud.clientWidth, H = this.hud.clientHeight;
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (!shift) this.selection.clear();
    for (const e of this.playerShips()) {
      const p = this.R.project(e.pos, W, H);
      if (p && p[0] >= ax && p[0] <= bx && p[1] >= ay && p[1] <= by) this.selection.add(e.id);
    }
    this.ui.renderSelection();
  }
  selectAll() {
    this.selection.clear();
    this.playerShips().forEach((e) => this.selection.add(e.id));
    this.ui.renderSelection();
  }
  groundPoint(x, y, h) {
    const W = this.hud.clientWidth, H = this.hud.clientHeight;
    const r = this.R.ray(x, y, W, H);
    if (Math.abs(r.d[1]) < 1e-4) return null;
    const t = (h - r.o[1]) / r.d[1];
    if (t < 0) return null;
    return v3.add(r.o, v3.scale(r.d, t));
  }
  canBoard(t) {
    if (!this.world.boardable(t)) return false;
    return this.commandable().some((s) => s.role === 'boarder' || (s.style === 'bloom' && s.role !== 'flagship'));
  }
  command(x, y) {
    if (this.state !== 'play') return;
    const ships = this.commandable();
    if (!ships.length) return;
    const e = this.pick(x, y);
    this.audio.ui('order');
    if (e && ships.some((s) => this.world.hostile(s, e)) && !e.invulnerable) {
      const board = this.world.boardable(e);
      let boarding = 0;
      ships.forEach((s) => {
        if (board && (s.role === 'boarder' || (s.style === 'bloom' && s.role !== 'flagship'))) {
          s.order = { type: 'board', id: e.id };
          boarding++;
        } else {
          s.order = { type: 'attack', id: e.id };
          if (s.subFocus && s.focus !== e.id) s.subFocus = null;
        }
        s.focus = e.id;
      });
      this.ui.flashCommand(x, y, 'attack');
      if (boarding) {
        e.boardHold = true;
        this.log(`${boarding} ship${boarding > 1 ? 's' : ''} moving to board the ${e.name}. The fleet holds fire on it.`);
      }
      if (e.broken) this.log(`Ordered to destroy the ${e.name}. This forfeits its shipyards.`, 'warn');
      return;
    }
    if (e && e.scan && !e.scan.done) {
      const scanner = ships.reduce((a, b) => (b.scanRate > a.scanRate ? b : a), ships[0]);
      ships.forEach((s) => {
        if (s === scanner) s.order = { type: 'scan', id: e.id };
        else s.order = { type: 'move', pos: v3.add(e.pos, [(Math.random() - 0.5) * 160, 0, e.radius + 80 + Math.random() * 80]) };
      });
      this.ui.flashCommand(x, y, 'scan');
      this.log(`${scanner.name} moving to ${e.scan.label.toLowerCase()}.`);
      return;
    }
    if (e && e.team === 'player' && e.kind === 'ship' && !ships.includes(e)) {
      // Escort a friendly vessel.
      ships.forEach((s, i) => {
        const a = (i / ships.length) * Math.PI * 2;
        s.order = { type: 'follow', id: e.id, off: [Math.cos(a) * (e.radius + 50), 0, Math.sin(a) * (e.radius + 50)] };
      });
      this.ui.flashCommand(x, y, 'move');
      this.log(`Escorting ${e.name}.`);
      return;
    }
    const avgY = ships.reduce((a, s) => a + s.targetY, 0) / ships.length;
    const gp = this.groundPoint(x, y, avgY);
    if (!gp) return;
    this.moveFormation(ships, gp);
    this.ui.flashCommand(x, y, 'move');
    this.tutorialMoved();
  }
  // Formation presets: keep relative positions, protected core, broad line, encirclement.
  moveFormation(ships, gp, type = this.formation) {
    const c = ships.reduce((a, s) => v3.add(a, s.pos), [0, 0, 0]).map((v) => v / ships.length);
    const dir = v3.norm([gp[0] - c[0], 0, gp[2] - c[2]]);
    const side = [dir[2], 0, -dir[0]];
    const spread = Math.max(...ships.map((s) => v3.distXZ(s.pos, c)));
    const order = [...ships].sort((a, b) => (b.role === 'flagship') - (a.role === 'flagship'));
    const support = (s) => ['repair', 'scout', 'boarder'].includes(s.role);
    order.forEach((s, i) => {
      let off;
      if (type === 'line') {
        const k = i - (order.length - 1) / 2;
        off = v3.scale(side, k * 55);
      } else if (type === 'encircle') {
        const a = (i / order.length) * Math.PI * 2;
        off = [Math.cos(a) * 190, 0, Math.sin(a) * 190];
      } else if (type === 'core') {
        if (s.role === 'flagship') off = [0, 0, 0];
        else if (support(s)) {
          const a = i * 2.1;
          off = [Math.cos(a) * 35, 0, Math.sin(a) * 35];
        } else {
          const n = order.filter((o) => !support(o) && o.role !== 'flagship').length;
          const j = order.filter((o) => !support(o) && o.role !== 'flagship').indexOf(s);
          const a = (j / Math.max(1, n)) * Math.PI * 2;
          off = [Math.cos(a) * 90, 0, Math.sin(a) * 90];
        }
      } else {
        off = v3.sub(s.pos, c);
        off[1] = 0;
        if (spread > 260 || ships.length === 1) {
          if (s.role === 'flagship' || ships.length === 1) off = [0, 0, 0];
          else {
            const a = (i / ships.length) * Math.PI * 2;
            const r = 60 + ships.length * 8;
            off = [Math.cos(a) * r, 0, Math.sin(a) * r];
          }
        }
      }
      s.order = { type: 'move', pos: [gp[0] + off[0], s.targetY, gp[2] + off[2]] };
      s.anchor = null;
    });
  }
  setFormation(f) {
    this.formation = f;
    const ships = this.commandable();
    if (ships.length > 1) {
      const c = ships.reduce((a, s) => v3.add(a, s.pos), [0, 0, 0]).map((v) => v / ships.length);
      this.moveFormation(ships, c, f);
    }
    this.ui.renderSelection(true);
  }
  holdSelection() {
    for (const e of this.commandable()) e.order = { type: 'hold', pos: [...e.pos] };
    this.log('Holding position. Ships will fire at anything in range but will not chase.');
  }
  withdrawSelection() {
    const ships = this.commandable();
    if (!ships.length) return;
    this.moveFormation(ships, this.world.arrival || [0, 0, 0], 'core');
    ships.forEach((s) => (s.order.withdraw = true));
    this.log('Withdrawing to the jump point.', 'warn');
  }
  focusSubsystem(key) {
    const ships = this.commandable();
    let n = 0;
    for (const s of ships) {
      if (!s.focus) continue;
      s.subFocus = key;
      n++;
    }
    if (n) this.log(`Focusing fire on ${key}.`);
  }
  tap(x, y) {
    if (this.state !== 'play') return;
    const e = this.pick(x, y);
    if (this.hasCommandable() && (!e || (e.team !== 'player' && (this.world.hostile({ team: 'player' }, e) || (e.scan && !e.scan.done))))) this.command(x, y);
    else this.clickSelect(x, y, false, false);
  }
  stopSelection() {
    for (const e of this.commandable()) {
      e.order = null;
      e.anchor = [...e.pos];
    }
  }
  elevate(dy) {
    const ships = this.commandable();
    for (const s of ships) {
      s.targetY = clamp(s.targetY + dy, -300, 300);
      if (s.order && s.order.pos) s.order.pos[1] = s.targetY;
    }
    if (ships.length) this.log(`Elevation ${dy > 0 ? '+' : ''}${dy} → ${Math.round(ships[0].targetY)}`);
  }
  ability(idx) {
    if (this.state !== 'play') return;
    const err = useAbility(this, idx);
    if (err) this.log(err, 'warn');
  }
  escape() {
    if (this.ui.closeTop()) return;
    this.selection.clear();
    this.ui.renderSelection();
  }
  togglePause() {
    if (this.state !== 'play') return;
    this.paused = !this.paused;
    this.ui.renderTime();
  }
  setSpeed(s) {
    this.speed = s;
    this.paused = false;
    this.ui.renderTime();
  }
  returnToFleet() {
    const f = this.flagship() || this.playerShips()[0];
    if (!f) return;
    this.cam.follow(f);
    this.cam.set(f.pos, 380, null, 0.5);
  }
  focusHome() {
    if (this.world.station) {
      this.cam.follow(null);
      this.cam.set(this.world.station.pos, 700, null, 0.6);
    }
  }
  trackSelection() {
    const e = [...this.selection].map((id) => this.world.get(id)).find(Boolean);
    if (e) {
      this.cam.follow(this.cam.track === e ? null : e);
      if (this.cam.track) this.cam.set(e.pos, Math.max(e.radius * 4, 60));
    }
  }
  cycleScale() {
    this.cam.set(null, [400, 2800, 70][this.cam.scaleIndex()]);
  }
  toggleDebug() {
    this.debug = !this.debug;
  }
  toggleGalaxy() {
    if (this.state !== 'play') return;
    this.ui.toggleGalaxy();
  }
  toggleMute() {
    const m = this.audio.toggleMute();
    this.log(m ? 'Sound muted.' : 'Sound on.');
  }

  // ---------------- Scanning & intel ----------------
  scanTick(t, ship, dt) {
    if (!t.scan || t.scan.done) return;
    if (t.scan.key === 'relay' && this.world.entities.some((e) => e.garrison && !e.dead)) {
      if (!this._relayWarn) this.log('The scavenger garrison is jamming the relay. Destroy it first.', 'warn');
      this._relayWarn = true;
      return;
    }
    const m = (this.expedition && this.expedition.objective === 'survey' ? 1.6 : 1) * (ship.inStorm ? 0.5 : 1);
    t.scan.progress += dt * ship.scanRate * m;
    if (t.scan.key === 'anomaly') this.anomalyPulse(t, dt);
    if (t.scan.progress >= t.scan.need) {
      t.scan.done = true;
      ship.scanning = null;
      ship.order = null;
      this.onScanComplete(t, ship);
    }
  }
  anomalyPulse(t, dt) {
    // Extracting the anomaly's data is dangerous: periodic surges strip shields and hull.
    this._pulse = (this._pulse || 0) - dt;
    if (this._pulse > 0) return;
    this._pulse = 7;
    const w = this.world;
    w.particles.push({ pos: [...t.pos], vel: [0, 0, 0], life: 1.2, max: 1.2, size: 30, grow: 500, col: [0.8, 0.6, 1], mode: 2 });
    for (const e of w.entities) {
      if (e.team === 'player' && e.kind === 'ship' && v3.dist(e.pos, t.pos) < 480) {
        e.shield = 0;
        w.applyDamage(e, 50, null, false, e.pos);
      }
    }
    this.log('The anomaly surges — shields stripped across the site.', 'warn');
  }
  onScanComplete(t, ship) {
    const key = t.scan.key;
    const civ = this.world.civ;
    const st = this.world.sysId ? sysState(this, this.world.sysId) : null;
    if (key === 'wreck') {
      t.name = 'Investigated wreck';
      this.driveReady = true;
      this.materials += 150;
      this.knowledge += 20;
      this.tutorial = 3;
      for (const s of this.galaxy.systems.find((x) => x.id === 'home').links) this.known.add(s);
      this.banner('Wreck investigated', 'An alien scout, torn apart mid-jump. Its navigation core holds three nearby routes — and the calibration your jump drive needed. +150 materials, +20 knowledge.');
      this.objective('tut', null);
      this.objective('prep', 'Prepare an expedition: press E to choose ships and an objective, then G to open the galaxy map and jump. Jumps cost energy.');
      this.log('Optional: press B to build ships, Y to research with knowledge from scans.');
      return;
    }
    if (key === 'salvage') {
      st.done['w' + t.scan.idx] = true;
      t.name = 'Stripped hulk';
      this.materials += 45;
      this.knowledge += 12;
      this.log('Hulk salvaged: +45 materials, +12 knowledge.', 'good');
      return;
    }
    if (key === 'hulk') {
      st.done.hulk = true;
      const e = makeShip(this.R, { style: 'synthetic', role: 'warden', team: 'player', pos: v3.add(t.pos, [0, 20, 60]), pal: { hull: [0.55, 0.58, 0.62], dark: [0.2, 0.22, 0.26], glow: [0.4, 0.9, 1], accent: [0.6, 0.55, 0.45] }, vseed: 707, loadout: ['archivebolt', 'archivebolt'], cls: 'Ancient Frigate', slots: 1 + this.bonusSlots, hullMul: 1.4 });
      e.name = 'Restored Frigate';
      e.captured = true;
      this.world.add(e);
      t.dead = true;
      this.banner('Dormant frigate restored', 'An ancient warship wakes and answers your command. Its reactivation was not unnoticed — scavengers are inbound.');
      st.threat = { n: 3, deadline: this.stime + 200, spawned: false };
      spawnThreat(this, this.world, this.world.sysId);
      return;
    }
    if (key === 'leviathan') {
      st.done['l' + t.scan.idx] = true;
      this.knowledge += 35;
      this.log('Leviathan studied: +35 knowledge.', 'good');
      if ([0, 1, 2].every((i) => st.done['l' + i])) {
        this.knowledge += 40;
        this.banner('Migration mapped', 'You have charted the leviathans’ route. Their biology suggests new ways to grow, mend and adapt. +40 knowledge.');
        if (this.faction === 'bloom') this.reserves = 100;
      }
      return;
    }
    if (key === 'anomaly') {
      st.done.anomaly = true;
      this.knowledge += 150;
      this.banner('Research extracted', 'The Bent Spire’s data is yours: +150 knowledge. Open research (Y) to spend it.');
      return;
    }
    if (key === 'relay') {
      this.relayActive = true;
      for (const s of this.galaxy.systems) this.known.add(s.id);
      this.banner('Relay network online', 'Every surveyed system is now one jump away from anywhere you stand, and jumps cost half the energy.');
      checkVictory(this);
      return;
    }
    if (!civ) return;
    const s = civ.state;
    if (key === 'station') {
      s.intel.priorities = true;
      s.intel.strength = true;
      this.knowledge += 30;
      hail(this, civ);
      this.banner('Capital scanned', `${civ.name}: ${civ.texts.society.name.toLowerCase()} society. Their priorities and true fleet strength are now known. +30 knowledge.`);
    } else if (key === 'landmark') {
      s.intel.landmark = true;
      s.intel.signature = true;
      this.knowledge += 25;
      this.banner(civ.landmark.name, `${civ.texts.history.desc} Their signature capability: ${TRAITS[civ.signature].name}. An integration access point is now known.`);
    } else if (key === 'keystone') {
      s.intel.vulnerability = true;
      this.knowledge += 25;
      this.banner(`Vulnerability: ${civ.vulnerability.name}`, civ.vulnerability.desc);
    }
    this.log('Intel added to the dossier (C).', 'good');
    if (s.intel.priorities && s.intel.landmark && s.intel.vulnerability) this.objective('explore', null);
  }

  // ---------------- Kills, captures & outcomes ----------------
  onKill(e, src, world) {
    if (world !== this.world) return;
    if (e.team === 'player' && e.kind === 'ship' && !e.isFighter) {
      this.log(`${e.name} destroyed.${e.rank ? ` A rank ${e.rank} veteran crew is lost with it.` : ''}`, 'bad');
      this.selection.delete(e.id);
    } else if (src && src.team === 'player' && e.kind === 'ship' && !e.isFighter) {
      this.materials += e.team === 'raider' ? 15 : 25;
    }
    checkThreatCleared(this, world, e);
    if (e.garrison && !world.entities.some((x) => x.garrison && !x.dead && x !== e)) {
      sysState(this, world.sysId).done.garrison = true;
      this.log('Garrison destroyed. The relay can now be activated.', 'good');
    }
  }
  onCapture(t, by, world) {
    this.log(`${t.cls} boarded and captured! It joins your fleet.`, 'good');
    t.slots = Math.max(t.slots || 0, (ADAPT_SLOTS[t.role] || 1) + this.bonusSlots);
    if (t.keystone && world.civ) {
      keystoneDeath(this, world.civ, t, true);
      t.keystone = null;
    }
    if (world.script && world.script.onKill) world.script.onKill(t, by);
    checkThreatCleared(this, world, t);
  }
  onEvent(type, data) {
    const cam = this.cam.eye();
    if (type === 'fire') this.audio.fire(data.w, data.e.style, v3.dist(cam, data.e.pos));
    else if (type === 'explosion') this.audio.explosion(data.r, v3.dist(cam, data.p));
    else if (type === 'shieldBreak') this.audio.shieldBreak(v3.dist(cam, data.pos));
    else if (type === 'ability') this.audio.ui('ability');
    else if (type === 'subsystem') {
      const { t, key } = data;
      if (t.team === 'player') this.log(`${t.name}: ${key} disabled!`, 'bad');
      else if (t.role === 'keystone' || t.kind === 'station' || t.role === 'flagship' || t.role === 'raiderBig') this.log(`${t.name}: ${key} disabled.${key === 'engines' ? ' It is adrift — board it to capture.' : ''}`, 'good');
    }
  }
  onOutcome(civ, outcome) {
    this.outcomes.push({ civ: civ.id, outcome });
    for (const k of ['approach', 'capture', 'integrate', 'mission']) this.objective(k, null);
    this.objective('return', 'Return home (G → home system) and refit your ships with what you inherited in the Adaptation Bay (R). Assign the system a role from the galaxy map.');
    checkCoalition(this);
    checkVictory(this);
    this.save();
  }

  // ---------------- Jumps ----------------
  jumpCost(to, n) {
    if (to === 'home') return 0;
    let c = 18 + n * 3;
    if (this.relayActive) c *= 0.5;
    if (this.research.jumpkit) c *= 0.6;
    return Math.round(c);
  }
  reachable(to) {
    if (to === 'home') return true;
    const cur = this.galaxy.systems.find((s) => s.id === this.currentSystem);
    if (cur && cur.links.includes(to)) return true;
    return this.relayActive && this.known.has(to);
  }
  startJump(sysId) {
    if (!this.driveReady) return 'Your jump drive is uncalibrated. Investigate the wreck in your home system first.';
    if (this.jump) return 'Already jumping.';
    if (sysId === this.currentSystem) return 'You are already here.';
    if (!this.reachable(sysId)) return 'No surveyed route from here. Jump along a lane, or activate the ancient relay.';
    let ships;
    if (this.currentSystem === 'home') {
      const plan = this.expeditionPlan;
      ships = this.playerShips().filter((e) => !plan.ids || plan.ids.has(e.id));
      if (!ships.length) return 'No ships assigned to the expedition. Press E to choose ships.';
    } else ships = this.world.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && !e.dead && (e.selectable || e.alliedFrom || e.hybrid));
    if (!ships.length) return 'No ships available.';
    if (this.world.civ && this.world.civ.state.integrating) return 'Leaving now would abandon the integration site. Finish or lose it first.';
    const cost = this.jumpCost(sysId, ships.length);
    if (this.energy < cost) return `Not enough energy (${cost} needed). Energy recovers over time; the jump home is always free.`;
    this.energy -= cost;
    this.jump = { t: 0, ships, to: sysId };
    ships.forEach((e) => {
      e.order = null;
      e.jumping = true;
      e.jumpT = -Math.random() * 0.8;
    });
    this.audio.ui('jump');
    this.log(`Jump drives spooling... (${ships.length} ships${cost ? `, ${cost} energy` : ''})`);
    return null;
  }
  updateJump(dt) {
    if (!this.jump) return;
    this.jump.t += dt;
    if (this.jump.t < 3) return;
    const { ships, to } = this.jump;
    this.jump = null;
    const from = this.world;
    for (const e of ships) {
      e.jumping = false;
      from.entities = from.entities.filter((x) => x !== e);
      from.byId.delete(e.id);
    }
    from.entities = from.entities.filter((x) => !(x.isFighter && x.team === 'player'));
    if (from.civ) {
      const s = from.civ.state;
      s.threatActive = false;
      if (s.missionActive) {
        s.missionActive = null;
        this.log('You left before the mission was complete.', 'warn');
        this.objective('mission', null);
      }
      if (from.script && from.script.name !== 'conquest') from.script = null;
      snapshotCiv(from);
    }
    // Raiders that were not defeated return to the strategic layer.
    for (const e of from.entities) if (e.threatId && !e.dead) {
      const st = sysState(this, e.threatId);
      if (st.threat) st.threat.spawned = false;
      e.dead = true;
    }
    this.enterSystem(to, ships, { warp: true });
  }
  enterSystem(to, ships, { warp }) {
    this.selection.clear();
    let world;
    const sd = this.galaxy.systems.find((s) => s.id === to);
    if (to === 'home') {
      world = this.homeWorld;
      applyHomeUpgrades(this, world);
      this.expedition = null;
      for (const k of ['return', 'explore', 'approach', 'capture', 'integrate', 'mission']) this.objective(k, null);
      if (Object.keys(this.traits).length && !this.firstRefit) this.objective('refit', 'Open the Adaptation Bay (R) and install your inheritances on ship slots.');
    } else if (sd.kind === 'empty') {
      world = buildEmptyWorld(this, sd);
      this.expedition = { objective: this.expeditionPlan.objective, sys: to };
      this.objective('prep', null);
      if (!sysState(this, to).visited) this.banner(sd.empty.texts.name, sd.empty.texts.desc);
    } else {
      const civ = this.civs[to];
      world = buildCivWorld(this, civ);
      if (civ.state.hostile && !['conquered', 'assimilated', 'devastated'].includes(civ.state.status)) world.script = conquestScript(this, civ);
      this.expedition = { objective: this.expeditionPlan.objective, civ: civ.id };
      const first = !civ.state.visited;
      civ.state.visited = true;
      this.objective('prep', null);
      if (first) {
        this.banner(civ.texts.stellar.name, `${civ.texts.stellar.desc} ${civ.texts.habitat.name}. Unknown inhabitants.`);
        this.objective('explore', 'Understand who lives here: scan their capital, their landmark and any unusual vessel. Open the dossier with C.');
        this.objective('approach', 'Then commit: conquer, assimilate or befriend — or leave and return better prepared.');
      }
    }
    const st = sysState(this, to);
    st.visited = true;
    this.known.add(to);
    if (sd) for (const l of sd.links) this.known.add(l);
    this.world = world;
    this.currentSystem = to;
    const arr = world.arrival;
    ships.forEach((e, i) => {
      const a = (i / ships.length) * Math.PI * 2;
      const r = i === 0 ? 0 : 70 + ships.length * 6;
      e.pos = [arr[0] + Math.cos(a) * r, 0, arr[2] + Math.sin(a) * r];
      e.targetY = 0;
      const dir = v3.norm(v3.sub([0, 0, 0], arr));
      e.yaw = Math.atan2(dir[0], dir[2]);
      if (warp) {
        e.warpIn = 1;
        e.warpDir = [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
        e.pos = v3.sub(e.pos, v3.scale(e.warpDir, 380));
      }
      e.speedNow = 0;
      e.fighters = [];
      e.anchor = null;
      e.order = null;
      e.jumping = false;
      world.add(e);
    });
    if (st.threat) spawnThreat(this, world, to);
    const f = ships.find((e) => e.role === 'flagship') || ships[0];
    this.cam.follow(null);
    this.cam.set(arr, 520, Math.atan2(arr[0], arr[2]) + 0.4, 0.45, !warp);
    setTimeout(() => this.cam.follow(f), 1200);
    this.ui.onWorldChanged();
    this.save();
  }

  // ---------------- Production ----------------
  build(role) {
    if (this.currentSystem !== 'home') return 'Ships can only be produced at home.';
    if (role === 'boarder' && !this.research.boarding) return 'Research boarding doctrine first.';
    const cost = SHIP_COST[role];
    if (this.materials < cost) return `Not enough materials (${cost} required).`;
    this.materials -= cost;
    if (this.faction === 'bloom') this.reserves = Math.max(0, this.reserves - 15);
    const st = this.homeWorld.station;
    const dock = v3.add(st.pos, st.visual.dock || [0, 0, 100]);
    const e = makeShip(this.R, { style: this.faction, role, team: 'player', pos: dock, slots: ADAPT_SLOTS[role] + this.bonusSlots });
    e.name = role === 'flagship' ? this.fac.names.flagship : `${e.cls} ${NUMERALS[this.shipCounter++ % NUMERALS.length]}`;
    const mode = this.fac.production;
    e.building = { t: 0, mode, dur: BUILD_TIME[role] };
    e.yaw = Math.PI / 2;
    if (mode === 'launches') {
      e.building.from = v3.add(st.pos, [st.visual.dock[0] - 30, 0, 0]);
      e.building.to = v3.add(st.pos, [st.visual.dock[0] + 90, 0, 0]);
    }
    e.selectable = false;
    this.homeWorld.add(e);
    this.buildQueue.push(e);
    this.log(`${this.fac.productionVerb} a new ${e.cls}...`);
    return null;
  }
  updateBuilds(dt) {
    for (const e of this.buildQueue) {
      e.building.t = Math.min(1, e.building.t + dt / e.building.dur);
      if (e.building.mode === 'launches') e.pos = v3.lerp(e.building.from, e.building.to, e.building.t ** 2);
      if (e.building.t >= 1) {
        e.building = null;
        e.selectable = true;
        e.order = { type: 'move', pos: v3.add(e.pos, [60, 0, 120]) };
        this.log(`${e.name} has joined the fleet.`, 'good');
        if (this.world === this.homeWorld) this.homeWorld.puff(e.pos, e.radius * 2, this.fac.color);
      }
    }
    this.buildQueue = this.buildQueue.filter((e) => e.building && !e.dead);
  }

  // ---------------- Refit ----------------
  refit(e) {
    applyStats(e);
    refreshVisual(this.R, e);
  }
  installTrait(e, id) {
    if (!e.traits.find((t) => t.id === id)) {
      if (e.traits.length >= e.slots) return 'No free adaptation slot on this ship.';
      e.traits.push({ id, tier: this.traits[id].tier });
    }
    this.refit(e);
    this.objective('refit', null);
    if (!this.firstRefit) {
      this.firstRefit = true;
      this.banner('Expedition complete', `Your fleet now carries ${TRAITS[id].name}. ${TRAITS[id].expr[this.faction]} New structures have also appeared around your home station. More of the cluster waits beyond your borders.`);
    }
    return null;
  }
  removeTrait(e, id) {
    e.traits = e.traits.filter((t) => t.id !== id);
    this.refit(e);
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    this.R.dither = this.settings.dither;
    this.audio.setVolume(this.settings.volume);
    try {
      localStorage.setItem('strange-dominion-settings', JSON.stringify(this.settings));
    } catch {}
  }
}

function loadSettings() {
  const def = { quality: 'auto', dither: false, galaxyPause: true, volume: 0.7 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('strange-dominion-settings') || '{}') };
  } catch {
    return def;
  }
}

export { hasSave };

window.addEventListener('load', () => {
  try {
    window.game = new Game();
  } catch (err) {
    document.getElementById('fatal').textContent = 'Could not start: ' + err.message;
    document.getElementById('fatal').style.display = 'block';
    console.error(err);
  }
});
