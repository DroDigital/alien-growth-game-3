// Strange Dominion — game orchestration: state, selection, orders, jumps, tutorial, economy.
import { v3, clamp, col } from './math.js';
import { Renderer } from './gl.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { World } from './sim.js';
import { renderWorld, drawOverlay } from './render.js';
import { FACTIONS, ADAPT_SLOTS, SHIP_COST, BUILD_TIME, TRAITS } from './data.js';
import { generateGalaxy } from './generator.js';
import { makeShip, applyStats, refreshVisual } from './entities.js';
import { buildHomeWorld, buildCivWorld, snapshotCiv, makeWreck, applyHomeUpgrades, homeEnv, HOME_LAYOUT } from './systems.js';
import { initCivState, hail, conquestScript } from './encounter.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.hud = document.getElementById('hud2d');
    this.ctx = this.hud.getContext('2d');
    const low = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('low');
    this.R = new Renderer(this.canvas, low ? 'low' : 'high');
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
    world.bodies = buildHomeWorld({ R: this.R, faction, traits: {}, civs: {} }).bodies;
    const roles = ['flagship', 'escort', 'escort', 'scout'];
    roles.forEach((role, i) => {
      const e = makeShip(this.R, { style: faction, role, team: 'neutral', pos: [600 + (i ? (i - 2) * 60 : 0), 0, 600 + (i ? 60 : 0)] });
      e.order = { type: 'patrol', c: [600, 0, 600], r: 90 + i * 50, a: i * 1.6 };
      world.add(e);
    });
    this.world = world;
    this.cam.set([600, 0, 600], 260, 0.8, 0.3, true);
    this.cam.follow(null);
  }

  // ---------------- New campaign ----------------
  newGame(faction) {
    this.faction = faction;
    this.fac = FACTIONS[faction];
    this.materials = 300;
    this.traits = {};
    this.integrationCap = 1;
    this.integrationUsed = 0;
    this.driveReady = false;
    this.expeditionPlan = { ids: null, objective: 'survey' };
    this.expedition = null;
    this.galaxy = generateGalaxy(4242 + Math.floor(Math.random() * 100000), faction);
    this.civs = {};
    for (const s of this.galaxy.systems) {
      if (s.civ) {
        initCivState(s.civ);
        this.civs[s.civ.id] = s.civ;
      }
    }
    this.galaxy.systems[0].name = this.fac.home.name;
    this.homeWorld = buildHomeWorld(this);
    this.wreck = makeWreck(this, this.homeWorld);
    const fp = HOME_LAYOUT.fleet;
    const roles = [['flagship', [0, 0, 0]], ['escort', [-70, 0, -30]], ['escort', [70, 0, -30]], ['scout', [0, 0, 80]]];
    const names = { flagship: this.fac.names.flagship, escort: null, scout: null };
    let n = 1;
    for (const [role, off] of roles) {
      const e = makeShip(this.R, { style: faction, role, team: 'player', pos: v3.add(fp, off), yaw: -2.4, slots: ADAPT_SLOTS[role] });
      e.name = role === 'flagship' ? names.flagship : `${e.cls} ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][n++ - 1]}`;
      this.homeWorld.add(e);
    }
    this.shipCounter = n;
    this.world = this.homeWorld;
    this.currentSystem = 'home';
    this.state = 'play';
    this.selection.clear();
    this.objectives.clear();
    this.tutorial = 0;
    this.outcomes = [];
    this.buildQueue = [];
    this.stratT = 0;
    this.cam.set(fp, 340, Math.atan2(fp[0], fp[2]), 0.32, true);
    this.ui.enterGame();
    this.objective('tut', 'Select your fleet: drag a box around your ships, or press Ctrl+A.');
    this.banner(this.fac.home.name, `${this.fac.name}. ${this.fac.tagline}`);
    this.log('Welcome, commander. Space pauses time. Orders can be given while paused.');
  }

  flagship() {
    return this.world.entities.find((e) => e.team === 'player' && e.role === 'flagship' && !e.dead);
  }
  playerShips(world = this.world) {
    return world.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && !e.dead && e.selectable && !e.building);
  }
  allPlayerShips() {
    const s = new Set([...this.playerShips(this.homeWorld), ...this.playerShips(this.world)]);
    return [...s];
  }

  // ---------------- Messages ----------------
  log(msg, kind = 'info') {
    this.ui.log(msg, kind);
  }
  banner(title, text) {
    this.ui.banner(title, text);
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
    const simPaused = this.paused || this.ui.galaxyOpen || this.ui.modalOpen;
    if (this.world) {
      if (this.state === 'title') this.world.update(rdt);
      else if (!simPaused) {
        const steps = this.speed;
        for (let i = 0; i < steps; i++) this.world.update(rdt);
      }
    }
    if (this.state === 'play') {
      if (!this.paused) this.strategic(rdt * this.speed);
      this.updateJump(rdt);
      this.checkLost(simPaused ? 0 : rdt);
      this.updateBuilds(simPaused ? 0 : rdt * this.speed);
      this.updateTutorial();
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

  // If an expedition is wiped out, the survivors' data returns home and the campaign continues.
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

  // Lighter strategic simulation for every system you are not currently in.
  strategic(dt) {
    this.stratT += dt;
    this.materials += dt * 0.6; // home industry
    for (const c of Object.values(this.civs)) {
      const s = c.state;
      if (c.id !== this.currentSystem && s.visited && !s.helped && !['conquered', 'assimilated', 'devastated', 'protectorate', 'allied'].includes(s.status)) {
        s.pressure = Math.min(3, s.pressure + dt / 150);
      }
      if (s.treaties.trade) this.materials += dt * 1.2;
      if (['conquered', 'assimilated', 'protectorate'].includes(s.status)) this.materials += dt * 1.0;
      if (s.status === 'allied') this.materials += dt * 0.5;
    }
  }

  // ---------------- Tutorial / objectives ----------------
  updateTutorial() {
    if (this.tutorial === 0 && [...this.selection].some((id) => this.world.get(id)?.team === 'player')) {
      this.tutorial = 1;
      this.objective('tut', 'Right-click in space to move. Right-drag to orbit the camera, scroll to zoom across scales.');
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
    this.hud.style.cursor = this.hover ? (this.world.hostile({ team: 'player' }, this.hover) && this.hasCommandable() ? 'crosshair' : 'pointer') : 'default';
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
  command(x, y, shift) {
    if (this.state !== 'play') return;
    const ships = this.commandable();
    if (!ships.length) return;
    const e = this.pick(x, y);
    if (e && ships.some((s) => this.world.hostile(s, e)) && !e.invulnerable) {
      ships.forEach((s) => (s.order = { type: 'attack', id: e.id }));
      this.ui.flashCommand(x, y, 'attack');
      if (e.broken) this.log(`Ordered to destroy the ${e.name}. This forfeits its shipyards.`, 'warn');
      return;
    }
    if (e && e.scan && !e.scan.done) {
      // Send the best scanner; the rest escort.
      const scanner = ships.reduce((a, b) => (b.scanRate > a.scanRate ? b : a), ships[0]);
      ships.forEach((s) => {
        if (s === scanner) s.order = { type: 'scan', id: e.id };
        else s.order = { type: 'move', pos: v3.add(e.pos, [(Math.random() - 0.5) * 160, 0, e.radius + 80 + Math.random() * 80]) };
      });
      this.ui.flashCommand(x, y, 'scan');
      this.log(`${scanner.name} moving to ${e.scan.label.toLowerCase()}.`);
      return;
    }
    const avgY = ships.reduce((a, s) => a + s.targetY, 0) / ships.length;
    const gp = this.groundPoint(x, y, this.orderHeight ?? avgY);
    if (!gp) return;
    this.moveFormation(ships, gp);
    this.ui.flashCommand(x, y, 'move');
    this.tutorialMoved();
  }
  moveFormation(ships, gp) {
    const c = ships.reduce((a, s) => v3.add(a, s.pos), [0, 0, 0]).map((v) => v / ships.length);
    const spread = Math.max(...ships.map((s) => v3.distXZ(s.pos, c)));
    ships.forEach((s, i) => {
      let off = v3.sub(s.pos, c);
      off[1] = 0;
      if (spread > 260 || ships.length === 1) {
        // Re-form: flagship centre, others in a ring.
        if (s.role === 'flagship' || ships.length === 1) off = [0, 0, 0];
        else {
          const a = (i / ships.length) * Math.PI * 2;
          const r = 60 + ships.length * 8;
          off = [Math.cos(a) * r, 0, Math.sin(a) * r];
        }
      }
      s.order = { type: 'move', pos: [gp[0] + off[0], s.targetY + (gp[1] - (this.orderHeight ?? s.targetY)), gp[2] + off[2]] };
      s.anchor = null;
    });
  }
  tap(x, y) {
    if (this.state !== 'play') return;
    const e = this.pick(x, y);
    if (this.hasCommandable() && (!e || (e.team !== 'player' && (this.world.hostile({ team: 'player' }, e) || (e.scan && !e.scan.done))))) this.command(x, y, false);
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
    const i = this.cam.scaleIndex();
    const d = [400, 2800, 70][i];
    this.cam.set(null, d);
  }
  toggleDebug() {
    this.debug = !this.debug;
  }
  toggleGalaxy() {
    if (this.state !== 'play') return;
    this.ui.toggleGalaxy();
  }

  // ---------------- Scanning & intel ----------------
  scanTick(t, ship, dt) {
    if (!t.scan || t.scan.done) return;
    const m = this.expedition && this.expedition.objective === 'survey' ? 1.6 : 1;
    t.scan.progress += dt * ship.scanRate * m;
    if (t.scan.progress >= t.scan.need) {
      t.scan.done = true;
      ship.scanning = null;
      ship.order = null;
      this.onScanComplete(t);
    }
  }
  onScanComplete(t) {
    const key = t.scan.key;
    const civ = this.world.civ;
    if (key === 'wreck') {
      t.name = 'Investigated wreck';
      this.driveReady = true;
      this.materials += 150;
      this.tutorial = 3;
      this.banner('Wreck investigated', 'An alien scout, torn apart mid-jump. Its navigation core holds coordinates for three inhabited systems — and the calibration your jump drive needed. +150 materials salvaged.');
      this.objective('tut', null);
      this.objective('prep', 'Prepare an expedition: press E to choose ships and an objective, then G to open the galaxy map and jump.');
      this.log('Optional: press B at home to grow, assemble or launch more ships.');
      return;
    }
    if (!civ) return;
    const s = civ.state;
    if (key === 'station') {
      s.intel.priorities = true;
      s.intel.strength = true;
      hail(this, civ);
      this.banner('Capital scanned', `${civ.name}: ${civ.texts.society.name.toLowerCase()} society. Their priorities and true fleet strength are now known.`);
    } else if (key === 'landmark') {
      s.intel.landmark = true;
      s.intel.signature = true;
      this.banner(civ.landmark.name, `${civ.texts.history.desc} Their signature capability: ${TRAITS[civ.signature].name}. An integration access point is now known.`);
    } else if (key === 'keystone') {
      s.intel.vulnerability = true;
      this.banner(`Vulnerability: ${civ.vulnerability.name}`, civ.vulnerability.desc);
    }
    this.log('Intel added to the dossier (C).', 'good');
    if (s.intel.priorities && s.intel.landmark && s.intel.vulnerability) this.objective('explore', null);
  }

  // ---------------- Kills & outcomes ----------------
  onKill(e, src, world) {
    if (world !== this.world) return;
    if (e.team === 'player' && e.kind === 'ship' && !e.isFighter) {
      this.log(`${e.name} destroyed.`, 'bad');
      this.selection.delete(e.id);
    } else if (src && src.team === 'player' && e.kind === 'ship' && !e.isFighter) {
      this.materials += e.team === 'raider' ? 15 : 25;
    }
    if (e.team === 'civ' && world.civ && src && src.team === 'player' && !world.civ.state.hostile && e.kind === 'ship') {
      // Should not happen (no friendly fire), but stay safe.
    }
  }
  onEvent() {}
  onOutcome(civ, outcome) {
    this.outcomes.push({ civ: civ.id, outcome });
    this.objective('approach', null);
    this.objective('capture', null);
    this.objective('integrate', null);
    this.objective('mission', null);
    this.objective('return', 'Return home (G → home system) and refit your ships with what you inherited in the Adaptation Bay (R).');
    const resolved = Object.values(this.civs).filter((c) => ['conquered', 'assimilated', 'protectorate', 'allied', 'devastated'].includes(c.state.status)).length;
    if (resolved === Object.keys(this.civs).length) {
      this.banner('Regional dominion', 'Every reachable civilization is now part of your sphere. The galaxy beyond awaits — continue expanding as you please.');
    }
  }

  // ---------------- Jumps ----------------
  canJump() {
    if (!this.driveReady) return 'Your jump drive is uncalibrated. Investigate the wreck in your home system first.';
    if (this.jump) return 'Already jumping.';
    return null;
  }
  startJump(sysId) {
    const err = this.canJump();
    if (err) return err;
    if (sysId === this.currentSystem) return 'You are already here.';
    let ships;
    if (this.currentSystem === 'home') {
      const plan = this.expeditionPlan;
      ships = this.playerShips().filter((e) => !plan.ids || plan.ids.has(e.id));
      if (!ships.length) return 'No ships assigned to the expedition. Press E to choose ships.';
    } else ships = this.world.entities.filter((e) => e.team === 'player' && e.kind === 'ship' && !e.isFighter && !e.dead && (e.selectable || e.alliedFrom || e.hybrid));
    if (!ships.length) return 'No ships available.';
    if (this.world.civ && this.world.civ.state.integrating) {
      return 'Leaving now would abandon the integration site. Finish or lose it first.';
    }
    this.jump = { t: 0, ships, to: sysId };
    ships.forEach((e) => {
      e.order = null;
      e.jumping = true;
      e.jumpT = -Math.random() * 0.8;
    });
    this.log(`Jump drives spooling... (${ships.length} ships)`);
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
    // Fighters do not travel; they are rebuilt in the hangars.
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
    this.selection.clear();
    let world;
    if (to === 'home') {
      world = this.homeWorld;
      applyHomeUpgrades(this, world);
      this.expedition = null;
      for (const k of ['return', 'explore', 'approach', 'capture', 'integrate', 'mission']) this.objective(k, null);
      if (Object.keys(this.traits).length) this.objective('refit', 'Open the Adaptation Bay (R) and install your inheritances on ship slots.');
    } else {
      const civ = this.civs[to];
      world = buildCivWorld(this, civ);
      if (civ.state.hostile && !['conquered', 'assimilated', 'devastated'].includes(civ.state.status)) {
        world.script = conquestScript(this, civ);
      }
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
      e.warpIn = 1;
      e.warpDir = [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
      e.pos = v3.sub(e.pos, v3.scale(e.warpDir, 380));
      e.speedNow = 0;
      e.fighters = [];
      e.anchor = null;
      e.order = null;
      world.add(e);
    });
    const f = ships.find((e) => e.role === 'flagship') || ships[0];
    this.cam.follow(null);
    this.cam.set(arr, 520, Math.atan2(arr[0], arr[2]) + 0.4, 0.45, false);
    setTimeout(() => this.cam.follow(f), 1200);
    this.ui.onWorldChanged();
  }

  // ---------------- Production ----------------
  build(role) {
    if (this.currentSystem !== 'home') return 'Ships can only be produced at home.';
    const cost = SHIP_COST[role];
    if (this.materials < cost) return `Not enough materials (${cost} required).`;
    this.materials -= cost;
    const st = this.homeWorld.station;
    const dock = v3.add(st.pos, st.visual.dock || [0, 0, 100]);
    const e = makeShip(this.R, { style: this.faction, role, team: 'player', pos: dock, slots: ADAPT_SLOTS[role] });
    e.name = role === 'flagship' ? this.fac.names.flagship : `${e.cls} ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][this.shipCounter++ % 12]}`;
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
      this.banner('Expedition complete', `Your fleet now carries ${TRAITS[id].name}. ${TRAITS[id].expr[this.faction]} New structures have also appeared around your home station. Two more civilizations wait beyond your borders.`);
    }
    return null;
  }
  removeTrait(e, id) {
    e.traits = e.traits.filter((t) => t.id !== id);
    this.refit(e);
  }
}

window.addEventListener('load', () => {
  try {
    window.game = new Game();
  } catch (err) {
    document.getElementById('fatal').textContent = 'Could not start: ' + err.message;
    document.getElementById('fatal').style.display = 'block';
    console.error(err);
  }
});
