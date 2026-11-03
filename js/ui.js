// DOM user interface: HUD, panels, dossier/negotiation, expedition planner, shipyard,
// adaptation bay, galaxy map and touch radial menu.
import { FACTIONS, TRAITS, TIERS, OBJECTIVES, SHIP_COST, BUILD_TIME } from './data.js';
import { PROPOSALS, evaluate, propose, hail, gift, threaten, declareWar, beginIntegration, startMission, threatEstimate, accessPoint, integrationRisks, integrationSpeed, fleetNearCapital, shipsAt } from './encounter.js';
import { col, clamp } from './math.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS_LABEL = {
  unknown: 'Uncontacted', contacted: 'Contacted', friendly: 'Friendly', hostile: 'Hostile', allied: 'Allied',
  protectorate: 'Protectorate (yours)', conquered: 'Conquered (yours)', assimilated: 'Assimilated (yours)', devastated: 'Devastated',
};
const PRI_LABEL = { security: 'Security', commerce: 'Commerce', knowledge: 'Knowledge', autonomy: 'Autonomy', honor: 'Honour' };

export class UI {
  constructor(game) {
    this.g = game;
    this.root = document.getElementById('ui');
    this.modalOpen = false;
    this.galaxyOpen = false;
    this.selT = 0;
    this.lastAnswer = {};
    this.buildTitle();
    this.buildHud();
  }

  // ---------------- Title ----------------
  buildTitle() {
    const t = document.createElement('div');
    t.id = 'title';
    t.innerHTML = `
      <div class="logo"><h1>STRANGE DOMINION</h1><p>Every civilization you meet can change what your empire becomes.</p></div>
      <div class="cards">${Object.values(FACTIONS)
        .map((f) => `<button class="card" data-f="${f.id}" style="--fc:${col.css(f.color)}"><h2>${f.name}</h2><em>${f.kind}</em><p>${f.tagline}</p><small>${f.blurb}</small><span class="go">Begin as ${f.name.replace('The ', '')}</span></button>`)
        .join('')}</div>
      <div class="hint">Mouse: left select · right order · right-drag orbit · wheel zoom · Space tactical pause. Touch: tap, drag, pinch, long-press for commands.</div>`;
    this.root.appendChild(t);
    t.querySelectorAll('.card').forEach((c) => {
      c.addEventListener('mouseenter', () => this.g.startTitle(c.dataset.f));
      c.addEventListener('focus', () => this.g.startTitle(c.dataset.f));
      c.addEventListener('click', () => this.g.newGame(c.dataset.f));
    });
    this.title = t;
  }

  buildHud() {
    const h = document.createElement('div');
    h.id = 'hud';
    h.innerHTML = `
      <div id="topbar">
        <div class="fac"></div>
        <div class="res"><span title="Materials">◈ <b id="mat">0</b></span><span title="Integration capacity">⟁ <b id="cap">1</b></span></div>
        <div class="sys" id="sysname"></div>
        <div class="time">
          <button id="bPause" title="Tactical pause (Space)">❚❚</button>
          <button data-s="1">1×</button><button data-s="2">2×</button><button data-s="3">3×</button>
        </div>
        <div class="acts">
          <button id="bExp" title="Expedition planner (E)">Expedition <kbd>E</kbd></button>
          <button id="bYard" title="Shipyard (B)">Shipyard <kbd>B</kbd></button>
          <button id="bAdapt" title="Adaptation bay (R)">Adaptation <kbd>R</kbd></button>
          <button id="bDossier" title="Civilization dossier (C)">Dossier <kbd>C</kbd></button>
          <button id="bGal" title="Galaxy map (G)">Galaxy <kbd>G</kbd></button>
          <button id="bHelp" title="Controls">?</button>
        </div>
      </div>
      <div id="paused">TACTICAL PAUSE — orders still accepted</div>
      <div id="progress"><span></span><i></i></div>
      <div id="objectives"></div>
      <div id="log"></div>
      <div id="selection"></div>
      <div id="scale"><b></b><span>F fleet · T track · Tab scale · Z/V elevation</span></div>
      <div id="touchbar"><button data-t="pause">❚❚</button><button data-t="fleet">Fleet</button><button data-t="all">All</button><button data-t="gal">Map</button></div>
      <div id="banner"><h3></h3><p></p></div>
      <div id="modal"></div>
      <div id="galaxy"><canvas></canvas><div class="gpanel"></div><button class="gclose">Close map (G)</button></div>
      <div id="radial"></div>`;
    this.root.appendChild(h);
    this.hud = h;
    $('#bPause').onclick = () => this.g.togglePause();
    h.querySelectorAll('.time [data-s]').forEach((b) => (b.onclick = () => this.g.setSpeed(+b.dataset.s)));
    $('#bExp').onclick = () => this.openExpedition();
    $('#bYard').onclick = () => this.openShipyard();
    $('#bAdapt').onclick = () => this.openAdaptation();
    $('#bDossier').onclick = () => this.openDossier();
    $('#bGal').onclick = () => this.toggleGalaxy();
    $('#bHelp').onclick = () => this.openHelp();
    $('#galaxy .gclose').onclick = () => this.toggleGalaxy();
    h.querySelectorAll('#touchbar button').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.t;
        if (t === 'pause') this.g.togglePause();
        if (t === 'fleet') this.g.returnToFleet();
        if (t === 'all') this.g.selectAll();
        if (t === 'gal') this.toggleGalaxy();
      };
    });
    const gc = $('#galaxy canvas');
    gc.addEventListener('click', (e) => this.galaxyClick(e));
    gc.addEventListener('mousemove', (e) => this.galaxyHover(e));
  }

  enterGame() {
    this.title.style.display = 'none';
    this.hud.style.display = 'block';
    const f = this.g.fac;
    $('.fac', this.hud).innerHTML = `<i style="background:${col.css(f.color)}"></i>${f.name}`;
    this.onWorldChanged();
    this.renderTime();
  }

  onWorldChanged() {
    const home = this.g.currentSystem === 'home';
    $('#bExp').style.display = home ? '' : 'none';
    $('#bYard').style.display = home ? '' : 'none';
    $('#bAdapt').style.display = home ? '' : 'none';
    $('#bDossier').style.display = home ? 'none' : '';
    this.closeModal();
    if (this.galaxyOpen) this.toggleGalaxy();
    this.renderSelection();
  }

  update(dt) {
    const g = this.g;
    if (g.state !== 'play') return;
    $('#mat').textContent = Math.floor(g.materials);
    $('#cap').textContent = `${g.integrationCap - g.integrationUsed}/${g.integrationCap}`;
    $('#sysname').textContent = g.world.name + (g.debug ? `  ·  ${g.fps.toFixed(0)} fps · ${g.R.stats.draws} draws · ${Math.round(g.R.stats.tris / 1000)}k tris` : '');
    $('#scale b').textContent = g.cam.scaleName();
    const pr = $('#progress');
    if (g.progress) {
      pr.style.display = 'block';
      $('span', pr).textContent = `${g.progress.label} — ${Math.floor(g.progress.k * 100)}%`;
      $('i', pr).style.width = `${g.progress.k * 100}%`;
    } else pr.style.display = 'none';
    if (g.jump) {
      pr.style.display = 'block';
      $('span', pr).textContent = `Jump drives spooling — ${Math.max(0, 3 - g.jump.t).toFixed(1)}s`;
      $('i', pr).style.width = `${(g.jump.t / 3) * 100}%`;
    }
    this.selT -= dt;
    if (this.selT <= 0) {
      this.selT = 0.25;
      this.renderSelection();
      if (this.modalOpen && this.modalKind === 'dossier') this.refreshDossierLive();
      if (this.modalOpen && this.modalKind === 'yard') this.openShipyard(true);
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) $('#banner').classList.remove('show');
    }
    if (this.galaxyOpen) this.drawGalaxy();
  }

  renderTime() {
    const g = this.g;
    $('#paused').style.display = g.paused ? 'block' : 'none';
    document.getElementById('gl').classList.toggle('paused', g.paused);
    this.hud.querySelectorAll('.time [data-s]').forEach((b) => b.classList.toggle('on', !g.paused && +b.dataset.s === g.speed));
    $('#bPause').classList.toggle('on', g.paused);
  }

  log(msg, kind) {
    const el = $('#log');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'l ' + kind;
    d.textContent = msg;
    el.prepend(d);
    while (el.children.length > 6) el.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 11000);
    setTimeout(() => d.remove(), 12500);
  }

  banner(title, text) {
    const b = $('#banner');
    $('h3', b).textContent = title;
    $('p', b).textContent = text;
    b.classList.add('show');
    this.bannerT = 7;
  }

  renderObjectives() {
    const el = $('#objectives');
    const items = [...this.g.objectives.values()];
    el.innerHTML = items.length ? `<h4>Objectives</h4>${items.map((t) => `<p>${esc(t)}</p>`).join('')}` : '';
  }

  flashCommand(x, y, type) {
    const d = document.createElement('div');
    d.className = 'cmdflash ' + type;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    this.hud.appendChild(d);
    setTimeout(() => d.remove(), 500);
  }

  // ---------------- Selection panel ----------------
  renderSelection() {
    const g = this.g;
    const el = $('#selection');
    if (!el || g.state !== 'play') return;
    const ents = [...g.selection].map((id) => g.world.get(id)).filter(Boolean);
    if (!ents.length) {
      el.innerHTML = `<div class="dim">No selection. Drag to box-select · Ctrl+A all ships · double-click a ship for its whole class.</div>`;
      return;
    }
    const bar = (e) => `<div class="bars"><i class="s" style="width:${e.maxShield ? clamp(e.shield / e.maxShield, 0, 1) * 100 : 0}%"></i><i class="h" style="width:${clamp(e.hull / e.maxHull, 0, 1) * 100}%"></i></div>`;
    if (ents.length === 1) {
      const e = ents[0];
      let extra = '';
      if (e.kind === 'ship' && e.team === 'player') {
        const slots = [];
        for (let i = 0; i < (e.slots || 0); i++) {
          const t = e.traits[i];
          slots.push(t ? `<span class="slot full" style="--tc:${col.css(TRAITS[t.id].color)}">${TRAITS[t.id].name}</span>` : `<span class="slot">empty slot</span>`);
        }
        extra = `<div class="wl">${e.weapons.map((w) => w.name).join(' · ') || 'unarmed'}</div>
          ${e.slots ? `<div class="slots">${slots.join('')}</div>` : ''}
          ${e.network ? `<div class="tag">Network link ×${e.network} (+${e.network * 8}% dmg)</div>` : ''}
          ${e.engineDamaged ? `<div class="tag bad">Engines crippled — vulnerable to boarding</div>` : ''}
          ${e.repairRate ? `<div class="tag">Repairs nearby allies</div>` : ''}
          ${e.visual.hangars ? `<div class="tag">Carrier: launches fighters near enemies</div>` : ''}`;
      } else if (e.kind === 'wreck') extra = `<div class="dim">Right-click it with a ship selected to investigate.</div>`;
      else if (g.world.civ && e.team !== 'player') extra = `<div class="dim">Part of ${esc(g.world.civ.state.intel.contact ? g.world.civ.name : 'an unknown civilization')}. Open the dossier (C).</div>`;
      el.innerHTML = `<h4>${esc(e.name)}</h4><div class="cls">${esc(e.cls || '')}${e.hybrid ? ' · integrated' : ''}${e.alliedFrom ? ' · allied specialist' : ''}</div>
        ${e.maxHull > 1 ? bar(e) + `<div class="nums">Hull ${Math.ceil(e.hull)}/${Math.ceil(e.maxHull)} · Shield ${Math.ceil(e.shield)}/${Math.ceil(e.maxShield)}</div>` : ''}${extra}`;
    } else {
      el.innerHTML = `<h4>${ents.length} selected</h4><div class="grid">${ents
        .map((e) => `<div class="mini" title="${esc(e.name)}"><b>${esc((e.cls || e.name).split(' ')[0])}</b>${bar(e)}</div>`)
        .join('')}</div><div class="dim">Right-click: move/attack/scan · X stop · Z/V raise/lower</div>`;
    }
  }

  // ---------------- Modals ----------------
  openModal(kind, html) {
    const m = $('#modal');
    m.innerHTML = `<div class="panel ${kind}"><button class="x">✕</button>${html}</div>`;
    m.style.display = 'flex';
    $('.x', m).onclick = () => this.closeModal();
    m.onclick = (e) => {
      if (e.target === m) this.closeModal();
    };
    this.modalOpen = true;
    this.modalKind = kind;
    this.g.ui = this;
    return m;
  }
  closeModal() {
    const m = $('#modal');
    if (!m) return;
    m.style.display = 'none';
    m.innerHTML = '';
    this.modalOpen = false;
    this.modalKind = null;
  }
  closeTop() {
    if ($('#radial').style.display === 'block') {
      $('#radial').style.display = 'none';
      return true;
    }
    if (this.modalOpen) {
      this.closeModal();
      return true;
    }
    if (this.galaxyOpen) {
      this.toggleGalaxy();
      return true;
    }
    return false;
  }

  openHelp() {
    this.openModal('help', `<h2>Commands</h2>
      <table>
      <tr><td>Left click / drag</td><td>Select · box select (Shift adds) · double-click selects a whole class</td></tr>
      <tr><td>Right click</td><td>Move (formation kept) · attack an enemy · investigate/scan a target</td></tr>
      <tr><td>Right drag · middle drag · wheel</td><td>Orbit · pan · zoom from close inspection to system overview</td></tr>
      <tr><td>WASD / arrows · Q</td><td>Pan · rotate</td></tr>
      <tr><td>Space · 1/2/3</td><td>Tactical pause · time speed</td></tr>
      <tr><td>F · T · Tab · H</td><td>Return to fleet · track selection · cycle camera scale · focus station</td></tr>
      <tr><td>Z / V</td><td>Raise / lower selected ships (deliberate vertical manoeuvres)</td></tr>
      <tr><td>X · Ctrl+A · Esc</td><td>Stop · select all · close / deselect</td></tr>
      <tr><td>E · B · R · C · G</td><td>Expedition · Shipyard · Adaptation bay · Dossier · Galaxy map</td></tr>
      <tr><td>Touch</td><td>Tap select/order · drag orbit · pinch zoom/pan · long-press radial menu</td></tr>
      </table>
      <h3>Combat notes</h3>
      <p>Escorts' light weapons shred fighters; heavy guns hit capitals and stations hard but miss small craft. Ships below 35% hull limp with crippled engines — Bloom spores devour them. Repair ships mend nearby allies. Your home station repairs everything near it.</p>
      <p>Damaging a capital below 25% breaks its defences and your ships hold fire. Hold ships nearby to force surrender (intact shipyards) or explicitly order an attack to destroy it (more salvage, no shipyards).</p>`);
  }

  openExpedition() {
    const g = this.g;
    if (g.state !== 'play') return;
    if (g.currentSystem !== 'home') return this.log('The expedition planner is only available at home.', 'warn');
    const ships = g.playerShips();
    const plan = g.expeditionPlan;
    if (!plan.ids) plan.ids = new Set(ships.map((e) => e.id));
    const m = this.openModal('exp', `<h2>Prepare expedition</h2>
      <p class="dim">Choose which ships leave home and what the expedition is for. Ships left behind stay to guard the station.</p>
      <div class="cols"><div><h3>Ships</h3>${ships
        .map((e) => `<label class="row"><input type="checkbox" data-id="${e.id}" ${plan.ids.has(e.id) ? 'checked' : ''}> <b>${esc(e.name)}</b> <span class="dim">${e.name !== e.cls ? esc(e.cls) : ''}${e.traits.length ? ' · ' + e.traits.map((t) => TRAITS[t.id].name).join(', ') : ''}</span></label>`)
        .join('')}</div>
      <div><h3>Objective</h3>${Object.entries(OBJECTIVES)
        .map(([k, o]) => `<label class="row obj"><input type="radio" name="obj" value="${k}" ${plan.objective === k ? 'checked' : ''}> <b>${o.name}</b><br><span class="dim">${o.desc}</span></label>`)
        .join('')}</div></div>
      <div class="foot"><button class="primary" id="goMap">Choose destination on galaxy map →</button></div>`);
    m.querySelectorAll('input[type=checkbox]').forEach((c) => (c.onchange = () => (c.checked ? plan.ids.add(+c.dataset.id) : plan.ids.delete(+c.dataset.id))));
    m.querySelectorAll('input[type=radio]').forEach((r) => (r.onchange = () => (plan.objective = r.value)));
    $('#goMap', m).onclick = () => {
      this.closeModal();
      this.toggleGalaxy();
    };
  }

  openShipyard(refresh) {
    const g = this.g;
    if (g.state !== 'play') return;
    if (g.currentSystem !== 'home') return this.log('Production requires your home station.', 'warn');
    if (refresh && !this.modalOpen) return;
    const f = g.fac;
    const html = `<h2>${f.name} production</h2>
      <p class="dim">${f.name} ${f.production} its ships. Materials: <b>${Math.floor(g.materials)}</b></p>
      <div class="builds">${[...(g.allPlayerShips().some((e) => e.role === 'flagship') || g.buildQueue.some((e) => e.role === 'flagship') ? [] : ['flagship']), 'escort', 'scout', 'repair']
        .map((r) => `<div class="b"><h3>${f.names[r]}</h3><p class="dim">${{ flagship: 'Your flagship was lost. Replace it.', escort: 'Line combatant. Light weapons tear through fighters.', scout: 'Fast. Scans three times faster, revealing intel.', repair: 'Mends the hull of nearby allies in battle.' }[r]}</p><p>◈ ${SHIP_COST[r]} · ${BUILD_TIME[r]}s</p><button data-r="${r}" ${g.materials < SHIP_COST[r] ? 'disabled' : ''}>${{ grows: 'Grow', assembles: 'Assemble', launches: 'Launch' }[f.production]}</button></div>`)
        .join('')}</div>
      ${g.buildQueue.length ? `<h3>In production</h3>${g.buildQueue.map((e) => `<div class="row">${esc(e.name)} — ${Math.floor(e.building.t * 100)}%</div>`).join('')}` : ''}`;
    if (refresh && this.modalKind === 'yard') {
      const p = $('#modal .panel');
      p.innerHTML = `<button class="x">✕</button>` + html;
      $('.x', p).onclick = () => this.closeModal();
    } else this.openModal('yard', html);
    $('#modal').querySelectorAll('[data-r]').forEach((b) => {
      b.onclick = () => {
        const err = g.build(b.dataset.r);
        if (err) this.log(err, 'warn');
        else {
          this.closeModal();
          g.focusHome();
        }
      };
    });
  }

  openAdaptation() {
    const g = this.g;
    if (g.state !== 'play') return;
    if (g.currentSystem !== 'home') return this.log('Refits require your home station.', 'warn');
    const traits = Object.entries(g.traits);
    const ships = g.playerShips().filter((e) => e.slots);
    const m = this.openModal('adapt', `<h2>Adaptation bay</h2>
      <p class="dim">Each ship has limited adaptation slots. Inherited capabilities are expressed in ${g.fac.name}'s own design language.</p>
      ${traits.length ? `<div class="inh">${traits
        .map(([id, t]) => `<div class="trait" style="--tc:${col.css(TRAITS[id].color)}"><h3>${TRAITS[id].name}</h3><div class="tier">${TIERS[t.tier].name}${t.from ? ' · from ' + esc(t.from) : ''}</div><p>${TRAITS[id].desc} <span class="dim">(strength ×${TIERS[t.tier].mul})</span></p><p class="expr">${TRAITS[id].expr[g.faction]}</p></div>`)
        .join('')}</div>` : `<p class="empty">No inheritances yet. Conquer, assimilate or befriend a civilization to inherit its signature capability.</p>`}
      <h3>Fleet</h3>
      ${ships
        .map((e) => {
          const slots = [];
          for (let i = 0; i < e.slots; i++) {
            const t = e.traits[i];
            if (t) slots.push(`<span class="slot full" style="--tc:${col.css(TRAITS[t.id].color)}">${TRAITS[t.id].name} <button data-rm="${e.id}:${t.id}">remove</button></span>`);
            else slots.push(`<span class="slot">empty ${traits.filter(([id]) => !e.traits.find((x) => x.id === id)).map(([id]) => `<button data-add="${e.id}:${id}">+ ${TRAITS[id].name}</button>`).join('')}</span>`);
          }
          return `<div class="row ship"><b>${esc(e.name)}</b> <span class="dim">${esc(e.cls)}</span><div class="slots">${slots.join('')}</div></div>`;
        })
        .join('')}`);
    m.querySelectorAll('[data-add]').forEach((b) => {
      b.onclick = () => {
        const [id, tid] = b.dataset.add.split(':');
        const e = g.world.get(+id);
        const err = g.installTrait(e, tid);
        if (err) this.log(err, 'warn');
        this.openAdaptation();
        if (!err) {
          this.closeModal();
          g.cam.follow(e);
          g.cam.set(e.pos, e.radius * 4.5, null, 0.35);
          this.log(`${e.name} refitted: ${TRAITS[tid].expr[g.faction]}`, 'good');
        }
      };
    });
    m.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = () => {
        const [id, tid] = b.dataset.rm.split(':');
        g.removeTrait(g.world.get(+id), tid);
        this.openAdaptation();
      };
    });
  }

  // ---------------- Dossier / encounter ----------------
  openDossier() {
    const g = this.g;
    if (g.state !== 'play') return;
    const civ = g.world.civ;
    if (!civ) return this.log('No civilization in this system.', 'warn');
    this.openModal('dossier', this.dossierHtml(civ));
    this.bindDossier(civ);
  }
  refreshDossierLive() {
    const civ = this.g.world.civ;
    if (!civ) return;
    const live = $('#modal .live');
    if (live) live.innerHTML = this.liveHtml(civ);
  }
  liveHtml(civ) {
    const g = this.g;
    const est = threatEstimate(g, civ);
    const near = fleetNearCapital(g);
    return `Threat estimate: <b class="${est.ratio > 1.2 ? 'bad' : ''}">${est.text}</b>${est.exact ? '' : ' <span class="dim">(scan their capital to refine)</span>'} · Your ships near their capital: <b>${near}</b>`;
  }
  dossierHtml(civ) {
    const g = this.g;
    const s = civ.state;
    const I = s.intel;
    const unk = (t) => `<span class="unk">${t}</span>`;
    const pri = I.priorities
      ? Object.entries(civ.priorities).map(([k, v]) => `<span class="pri">${PRI_LABEL[k]} ${'●'.repeat(v)}${'○'.repeat(3 - v)}</span>`).join('')
      : unk('Scan their capital to learn what they value.');
    const T = TRAITS[civ.signature];
    const owned = ['conquered', 'assimilated', 'protectorate', 'devastated'].includes(s.status);
    const head = `<h2>${I.contact ? esc(civ.name) : 'Unknown civilization'}</h2>
      <div class="status st-${s.status}">${STATUS_LABEL[s.status]}${I.contact ? ` · Standing ${Math.round(s.trust)}` : ''}</div>
      <div class="live">${this.liveHtml(civ)}</div>`;
    const intel = `<div class="intel">
      <div><h4>Environment</h4><p>${civ.texts.stellar.name}: ${civ.texts.stellar.desc} ${civ.texts.habitat.name}.</p></div>
      <div><h4>Species</h4><p>${I.contact ? `The ${esc(civ.species)}: ${civ.texts.structure.body}.` : unk('Hail them or scan their capital.')}</p></div>
      <div><h4>Society</h4><p>${I.priorities ? civ.texts.society.name + '.' : ''} ${pri}</p></div>
      <div><h4>History & current problem</h4><p>${I.contact ? `They ask for help: the ${esc(civ.neighbor)} ${civ.problem === 'convoy' ? 'prey on their supply convoys' : 'blockade their capital'}.` : unk('Unknown')} ${I.landmark ? `<br>${civ.texts.history.name}: ${civ.texts.history.desc}` : I.contact ? unk(`Investigate the ${civ.landmark.name} to learn more.`) : ''}</p></div>
      <div><h4>Signature capability</h4><p>${I.signature ? `<b style="color:${col.css(T.color)}">${T.name}</b> (${T.tech}). ${T.desc}<br><span class="dim">For you: ${T.expr[g.faction]}</span>` : unk(`Investigate the ${civ.landmark.name}.`)}</p></div>
      <div><h4>Vulnerability</h4><p>${I.vulnerability ? `<b>${civ.vulnerability.name}.</b> ${civ.vulnerability.desc}` : unk('Their fleet includes an unidentified vessel. Scan it.')}</p></div>
    </div>`;
    if (owned || s.status === 'allied') {
      return head + intel + `<div class="resolved">${{
        conquered: 'Conquered. Their territory and surviving shipyard are yours.',
        devastated: 'Their capital lies in ruins. Only salvage remains.',
        assimilated: 'Assimilated. Their traits and fleet are part of you.',
        protectorate: 'A voluntary protectorate under your flag.',
        allied: 'Allied. Their space is safe, their specialists fly with you. A protectorate could follow.',
      }[s.status]}</div>${s.status === 'allied' ? this.proposalsHtml(civ, ['protectorate']) : ''}`;
    }
    const ap = accessPoint(civ, g.world);
    const capLeft = g.integrationCap - g.integrationUsed;
    const prob = civ.problem === 'convoy' ? `Escort their convoy past the ${esc(civ.neighbor)}` : `Break the ${esc(civ.neighbor)} blockade`;
    const approach = `<div class="approach">
      <div class="ap befriend"><h3>Befriend</h3><p class="dim">Gain safe passage, trade, shared research and allied ships. Costs obligations and concessions.</p>
        ${I.contact ? '' : `<button data-a="hail">Hail them</button>`}
        ${I.contact && !s.helped ? `<button data-a="help" ${s.missionActive || s.hostile ? 'disabled' : ''}>${s.missionActive ? 'Mission under way…' : prob}</button>` : ''}
        ${s.helped ? `<div class="tag good">You protected them.</div>` : ''}
        <div class="btnrow"><button data-a="gift" ${!I.contact || s.hostile ? 'disabled' : ''}>Gift 100 ◈</button><button data-a="threat" ${!I.contact || s.hostile ? 'disabled' : ''}>Threaten capital</button></div>
        ${I.contact ? this.proposalsHtml(civ) : ''}
      </div>
      <div class="ap assimilate"><h3>Assimilate</h3><p class="dim">${g.fac.assimilateVerb}. Deep access to their traits, production and fleet. Costs time and capacity; the site is vulnerable.</p>
        <p>Access point: ${ap ? `<b>${esc(ap.label)}</b>` : unk(`none known — investigate the ${civ.landmark.name} or break their capital's defences`)}</p>
        ${ap ? `<p>Ships at access point: <b class="${shipsAt(g, ap.pos) < 2 ? 'bad' : 'good'}">${shipsAt(g, ap.pos)}</b> / 2 needed <button data-a="goto">Send fleet there</button></p>` : ''}
        <p>Capacity: <b>${capLeft}</b> · Speed ×${integrationSpeed(g, civ).toFixed(2)}</p>
        <ul class="risks">${integrationRisks(g, civ).map((r) => `<li>${r}</li>`).join('')}</ul>
        <button data-a="integrate" ${!ap || capLeft <= 0 || s.integrating ? 'disabled' : ''}>${s.integrating ? 'Integration under way…' : 'Begin integration'}</button>
      </div>
      <div class="ap conquer"><h3>Conquer</h3><p class="dim">Defeat their fleet, break their capital, force surrender. Gains territory, salvage and surviving infrastructure. Costs losses, repairs and resistance.</p>
        <p>Reward if captured intact: shipyard + <i>schematic</i> of ${I.signature ? T.name : 'their signature'}. Destroying the capital: more salvage, no shipyard.</p>
        ${s.hostile ? `<div class="tag bad">At war. Break the capital below 25% hull, then hold nearby.</div>` : `<button data-a="war" class="danger">Declare hostilities</button>`}
      </div>
    </div>
    <p class="dim leave">Or leave: open the galaxy map (G) and return better prepared. They will remember what you did here.</p>`;
    return head + intel + approach;
  }
  proposalsHtml(civ, only) {
    const s = civ.state;
    const ids = only || Object.keys(PROPOSALS);
    return `<div class="props"><h4>Proposals</h4>${ids
      .map((pid) => {
        const P = PROPOSALS[pid];
        const done = s.treaties[pid];
        const ans = this.lastAnswer[civ.id + pid];
        let res = '';
        if (ans && !done) {
          const known = ans.ev ? ans.ev.factors.filter((f) => f.known) : [];
          const hidden = ans.ev ? ans.ev.factors.filter((f) => !f.known).length : 0;
          res = `<div class="answer ${ans.ok ? 'ok' : 'no'}">${ans.text ? esc(ans.text) : ans.ok ? 'Accepted.' : ans.same ? 'Rejected — they have already answered this offer. Nothing has changed.' : 'Rejected.'}
            ${known.length ? `<ul>${known.map((f) => `<li class="${f.v >= 0 ? 'pos' : 'neg'}">${f.v >= 0 ? '+' : ''}${f.v} ${esc(f.label)}</li>`).join('')}</ul>` : ''}
            ${hidden ? `<div class="unk">${hidden} other consideration${hidden > 1 ? 's' : ''} you have not uncovered.</div>` : ''}</div>`;
        }
        return `<div class="prop ${done ? 'done' : ''}"><b>${P.name}</b> <span class="dim">${P.desc}</span> ${done ? '<span class="tag good">In force</span>' : `<button data-p="${pid}" ${s.hostile ? 'disabled' : ''}>Propose</button>`}${res}</div>`;
      })
      .join('')}</div>`;
  }
  bindDossier(civ) {
    const g = this.g;
    const m = $('#modal');
    const again = () => {
      if (this.modalKind === 'dossier') {
        const p = $('#modal .panel');
        const sc = p.scrollTop;
        p.innerHTML = `<button class="x">✕</button>` + this.dossierHtml(civ);
        $('.x', p).onclick = () => this.closeModal();
        p.scrollTop = sc;
        this.bindDossier(civ);
      }
    };
    m.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        let err = null;
        if (a === 'hail') hail(g, civ);
        if (a === 'gift') err = gift(g, civ);
        if (a === 'threat') err = threaten(g, civ);
        if (a === 'war') {
          if (!b.dataset.confirm) {
            b.dataset.confirm = 1;
            b.textContent = 'Confirm: open hostilities';
            return;
          }
          declareWar(g, civ);
          this.closeModal();
          return;
        }
        if (a === 'help') {
          err = startMission(g, civ);
          if (!err) return this.closeModal();
        }
        if (a === 'goto') {
          const ap = accessPoint(civ, g.world);
          const ships = g.playerShips();
          if (ap && ships.length) {
            g.moveFormation(ships, ap.pos);
            g.cam.follow(g.flagship() || ships[0]);
            this.closeModal();
            this.log('Fleet moving to the access point.');
          }
          return;
        }
        if (a === 'integrate') {
          err = beginIntegration(g, civ);
          if (!err) return this.closeModal();
        }
        if (err) this.log(err, 'warn');
        again();
      };
    });
    m.querySelectorAll('[data-p]').forEach((b) => {
      b.onclick = () => {
        const res = propose(g, civ, b.dataset.p);
        this.lastAnswer[civ.id + b.dataset.p] = res;
        if (res.ok && !res.same) this.log(`${PROPOSALS[b.dataset.p].name} accepted by ${civ.name}.`, 'good');
        again();
      };
    });
  }

  // ---------------- Galaxy map ----------------
  toggleGalaxy() {
    const g = this.g;
    if (g.state !== 'play') return;
    this.galaxyOpen = !this.galaxyOpen;
    const el = $('#galaxy');
    el.style.display = this.galaxyOpen ? 'block' : 'none';
    if (this.galaxyOpen) {
      this.closeModal();
      this.gSel = this.gSel || null;
      this.renderGalaxyPanel();
    }
  }
  galaxyLayout() {
    const c = $('#galaxy canvas');
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const s = Math.min(W, H) / 560;
    return { c, W, H, s, cx: W * 0.42, cy: H * 0.5 };
  }
  sysScreen(L, p) {
    return [L.cx + p[0] * L.s, L.cy + p[1] * L.s];
  }
  drawGalaxy() {
    const g = this.g;
    const L = this.galaxyLayout();
    const ctx = L.c.getContext('2d');
    const t = performance.now() / 1000;
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, L.W, L.H);
    const gs = L.s * 0.55;
    const core = [L.cx - 380 * gs, L.cy + 120 * gs];
    const cg = ctx.createRadialGradient(core[0], core[1], 0, core[0], core[1], 520 * gs);
    cg.addColorStop(0, 'rgba(255,220,170,0.22)');
    cg.addColorStop(0.3, 'rgba(160,130,220,0.08)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, L.W, L.H);
    for (const f of g.galaxy.far) {
      const x = L.cx + f.pos[0] * gs, y = L.cy + f.pos[1] * gs;
      ctx.fillStyle = col.css(col.hsl(0.55 + f.hue * 0.15, 0.4, 0.75), f.b * 0.7);
      const sz = 0.8 + f.b * 1.4;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.fillStyle = 'rgba(160,180,255,0.4)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Thousands of systems lie beyond jump range. Expand your relay network to reach them.', 20, L.H - 20);
    const sys = g.galaxy.systems;
    const home = sys[0];
    // Lanes
    ctx.lineWidth = 1;
    for (const s of sys.slice(1)) {
      const a = this.sysScreen(L, home.pos), b = this.sysScreen(L, s.pos);
      ctx.strokeStyle = 'rgba(120,170,255,0.35)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    for (let i = 1; i < sys.length - 1; i++) {
      const a = this.sysScreen(L, sys[i].pos), b = this.sysScreen(L, sys[i + 1].pos);
      ctx.strokeStyle = 'rgba(120,170,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const fc = g.fac.color;
    for (const s of sys) {
      const [x, y] = this.sysScreen(L, s.pos);
      const civ = s.civ;
      const st = civ ? civ.state.status : 'home';
      const owned = st === 'home' || ['conquered', 'assimilated', 'protectorate'].includes(st);
      if (owned) {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, 70 * L.s);
        gr.addColorStop(0, col.css(fc, 0.28));
        gr.addColorStop(1, col.css(fc, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, 70 * L.s, 0, Math.PI * 2);
        ctx.fill();
      }
      if (st === 'allied') {
        ctx.strokeStyle = col.css(fc, 0.8);
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(x, y, 30 * L.s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (st === 'hostile') {
        ctx.strokeStyle = 'rgba(255,90,70,0.8)';
        ctx.beginPath();
        ctx.arc(x, y, 26 * L.s, 0, Math.PI * 2);
        ctx.stroke();
      }
      const sc = civ ? civ.sys.star : FACTIONS[g.faction].home.star;
      ctx.fillStyle = col.css(sc, 1);
      ctx.shadowColor = col.css(sc, 1);
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(x, y, (civ && civ.stellar === 'binary' ? 5 : 6) * Math.max(1, L.s), 0, Math.PI * 2);
      ctx.fill();
      if (civ && civ.stellar === 'binary') {
        ctx.beginPath();
        ctx.arc(x + 8, y - 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (g.currentSystem === s.id) {
        ctx.strokeStyle = 'rgba(120,255,160,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 14 + Math.sin(t * 3) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (this.gSel === s.id || this.gHover === s.id) {
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(x - 18, y - 18, 36, 36);
      }
      ctx.fillStyle = '#dfe8ff';
      ctx.textAlign = 'center';
      ctx.font = '13px "Trebuchet MS", sans-serif';
      const label = s.id === 'home' ? g.fac.home.name : civ.state.intel.contact ? civ.name : civ.state.visited ? `${civ.texts.stellar.name} (inhabited)` : 'Unknown signal';
      ctx.fillText(label, x, y + 28);
      ctx.font = '11px "Trebuchet MS", sans-serif';
      if (civ) {
        ctx.fillStyle = st === 'hostile' ? '#f97' : owned || st === 'allied' ? col.css(fc) : '#9ab';
        ctx.fillText(STATUS_LABEL[st], x, y + 42);
        if (civ.state.pressure > 0.5 && !civ.state.helped && !owned && st !== 'allied') {
          ctx.fillStyle = '#f86';
          ctx.fillText(`${civ.neighbor} pressure rising`, x, y + 55);
        }
      }
    }
  }
  galaxyHit(e) {
    const L = this.galaxyLayout();
    const r = L.c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    for (const s of this.g.galaxy.systems) {
      const [sx, sy] = this.sysScreen(L, s.pos);
      if (Math.hypot(sx - x, sy - y) < 26) return s.id;
    }
    return null;
  }
  galaxyHover(e) {
    this.gHover = this.galaxyHit(e);
  }
  galaxyClick(e) {
    const id = this.galaxyHit(e);
    if (id) {
      this.gSel = id;
      this.renderGalaxyPanel();
    }
  }
  renderGalaxyPanel() {
    const g = this.g;
    const p = $('#galaxy .gpanel');
    const s = g.galaxy.systems.find((x) => x.id === this.gSel);
    if (!s) {
      p.innerHTML = `<h3>Galaxy</h3><p class="dim">Select a system. Jump lanes connect your home to three detected signals.</p>${g.driveReady ? '' : '<p class="bad">Jump drive uncalibrated — investigate the wreck at home.</p>'}`;
      return;
    }
    const here = g.currentSystem === s.id;
    let body = '';
    if (s.id === 'home') {
      body = `<h3>${esc(g.fac.home.name)}</h3><p>Your home system. Repairs, production and refits.</p>`;
    } else {
      const c = s.civ;
      const I = c.state.intel;
      body = `<h3>${I.contact ? esc(c.name) : 'Unknown signal'}</h3>
        <p>${c.state.visited ? `${c.texts.stellar.name}. ${c.texts.habitat.name}.` : 'Coordinates recovered from the wreck. Inhabited.'}</p>
        <p>Status: <b>${STATUS_LABEL[c.state.status]}</b></p>
        ${I.signature ? `<p>Signature: <b>${TRAITS[c.signature].name}</b></p>` : ''}
        ${c.state.pressure > 0.5 && !c.state.helped ? `<p class="bad">The ${esc(c.neighbor)} grow bolder while you are away.</p>` : ''}`;
    }
    const plan = g.expeditionPlan;
    const fromHome = g.currentSystem === 'home';
    const n = fromHome ? g.playerShips().filter((e) => !plan.ids || plan.ids.has(e.id)).length : g.playerShips().length;
    p.innerHTML = body + (here ? `<p class="dim">You are here.</p>` : `<p class="dim">${fromHome ? `Expedition: ${n} ships · objective ${OBJECTIVES[plan.objective].name} (E to change)` : `Fleet: ${n} ships`}</p><button class="primary" id="jumpBtn">Jump</button>`);
    const jb = $('#jumpBtn', p);
    if (jb)
      jb.onclick = () => {
        const err = g.startJump(s.id);
        if (err) this.log(err, 'warn');
        else this.toggleGalaxy();
      };
  }

  // ---------------- Touch radial menu ----------------
  radial(x, y) {
    const g = this.g;
    const el = $('#radial');
    const target = g.pick(x, y);
    const items = [];
    if (g.hasCommandable()) {
      if (target && g.world.hostile({ team: 'player' }, target)) items.push(['Attack', () => g.command(x, y)]);
      else if (target && target.scan && !target.scan.done) items.push(['Scan', () => g.command(x, y)]);
      else items.push(['Move here', () => g.command(x, y)]);
      items.push(['Raise', () => g.elevate(25)], ['Lower', () => g.elevate(-25)], ['Stop', () => g.stopSelection()], ['Track', () => g.trackSelection()]);
    } else if (target) items.push(['Select', () => g.clickSelect(x, y)]);
    items.push([g.paused ? 'Resume' : 'Pause', () => g.togglePause()], ['Fleet', () => g.returnToFleet()]);
    el.innerHTML = items.map((it, i) => {
      const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
      return `<button style="left:${Math.cos(a) * 78}px;top:${Math.sin(a) * 78}px">${it[0]}</button>`;
    }).join('');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.display = 'block';
    el.querySelectorAll('button').forEach((b, i) => {
      b.ontouchend = b.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        el.style.display = 'none';
        items[i][1]();
      };
    });
    setTimeout(() => {
      const off = (ev) => {
        if (!el.contains(ev.target)) {
          el.style.display = 'none';
          document.removeEventListener('touchstart', off);
        }
      };
      document.addEventListener('touchstart', off);
    }, 50);
  }
}
