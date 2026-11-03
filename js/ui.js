// DOM user interface: HUD, panels, dossier/negotiation, expedition planner, shipyard,
// adaptation bay, galaxy map and touch radial menu.
import { FACTIONS, TRAITS, TIERS, OBJECTIVES, SHIP_COST, BUILD_TIME, ABILITIES, RESEARCH, SYSTEM_ROLES, WEAKNESS, SUBSYSTEMS } from './data.js';
import { PROPOSALS, evaluate, propose, outlook, acceptCounter, hail, gift, threaten, declareWar, beginIntegration, startMission, threatEstimate, accessPoint, integrationRisks, integrationSpeed, fleetNearCapital, shipsAt } from './encounter.js';
import { abilityState, doResearch, setRole, sysState, sysLabel, controlled } from './events.js';
import { hasSave, saveInfo, clearSave } from './save.js';
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
      <div class="tbtns"><button id="bContinue" class="primary" style="display:none"></button><button id="bTSettings">Settings</button></div>
      <div class="hint">Mouse: left select · right order · right-drag orbit · wheel zoom · Space tactical pause. Touch: tap, drag, pinch, long-press for commands.</div>`;
    this.root.appendChild(t);
    t.querySelectorAll('.card').forEach((c) => {
      c.addEventListener('mouseenter', () => this.g.startTitle(c.dataset.f));
      c.addEventListener('focus', () => this.g.startTitle(c.dataset.f));
      c.addEventListener('click', () => {
        if (hasSave() && !c.dataset.confirm) {
          c.dataset.confirm = 1;
          c.querySelector('.go').textContent = 'Start a new campaign? Click again — the old save is replaced';
          return;
        }
        clearSave();
        this.g.newGame(c.dataset.f);
      });
    });
    const info = saveInfo();
    const cb = $('#bContinue', t);
    if (info) {
      cb.style.display = '';
      cb.textContent = `Continue — ${FACTIONS[info.faction].name} · ${info.where || ''}`;
      cb.onclick = () => this.g.continueGame();
    }
    $('#bTSettings', t).onclick = () => this.openSettings();
    this.title = t;
  }

  buildHud() {
    const h = document.createElement('div');
    h.id = 'hud';
    h.innerHTML = `
      <div id="topbar">
        <div class="fac"></div>
        <div class="res"><span title="Materials — construction and repairs">◈ <b id="mat">0</b></span><span title="Energy — jumps and abilities">ϟ <b id="nrg">0</b></span><span title="Knowledge — research">✧ <b id="kno">0</b></span><span id="resv" title="Biological reserves — Bloom regeneration and growth">❦ <b id="rsv">0</b></span><span title="Integration capacity">⟁ <b id="cap">1</b></span></div>
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
          <button id="bRes" title="Research (Y)">Research <kbd>Y</kbd></button>
          <button id="bGal" title="Galaxy map (G)">Galaxy <kbd>G</kbd></button>
          <button id="bSave" title="Save campaign">Save</button>
          <button id="bSet" title="Settings">⚙</button>
          <button id="bHelp" title="Controls">?</button>
        </div>
      </div>
      <div id="paused">TACTICAL PAUSE — orders still accepted</div>
      <div id="progress"><span></span><i></i></div>
      <div id="objectives"></div>
      <div id="log"></div>
      <div id="selection"><div class="info"></div><div id="cmdbar"></div></div>
      <div id="abilities"></div>
      <div id="scale"><b></b><span>F fleet · T track · Tab scale · Z/V elevation</span></div>
      <div id="touchbar"><button data-t="pause">❚❚</button><button data-t="fleet">Fleet</button><button data-t="all">All</button><button data-t="gal">Map</button></div>
      <div id="banner"><h3></h3><p></p></div>
      <div id="modal"></div>
      <div id="galaxy"><canvas></canvas><div class="gpanel"></div><button class="gclose">Close map (G)</button></div>
      <div id="radial"></div>`;
    this.root.appendChild(h);
    this.hud = h;
    this.root.appendChild($('#modal'));
    $('#bPause').onclick = () => this.g.togglePause();
    h.querySelectorAll('.time [data-s]').forEach((b) => (b.onclick = () => this.g.setSpeed(+b.dataset.s)));
    $('#bExp').onclick = () => this.openExpedition();
    $('#bYard').onclick = () => this.openShipyard();
    $('#bAdapt').onclick = () => this.openAdaptation();
    $('#bDossier').onclick = () => this.openDossier();
    $('#bGal').onclick = () => this.toggleGalaxy();
    $('#bHelp').onclick = () => this.openHelp();
    $('#bRes').onclick = () => this.openResearch();
    $('#bSave').onclick = () => this.g.save(true);
    $('#bSet').onclick = () => this.openSettings();
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
    $('#resv').style.display = this.g.faction === 'bloom' ? '' : 'none';
    this.renderAbilities(true);
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
    $('#nrg').textContent = Math.floor(g.energy);
    $('#kno').textContent = Math.floor(g.knowledge);
    $('#rsv').textContent = Math.floor(g.reserves);
    $('#rsv').className = g.reserves < 20 ? 'bad' : '';
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
      this.renderAbilities();
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
  renderSelection(forceCmd) {
    const g = this.g;
    const root = $('#selection');
    if (!root || g.state !== 'play') return;
    const el = $('.info', root);
    const ents = [...g.selection].map((id) => g.world.get(id)).filter(Boolean);
    this.renderCmdBar(forceCmd);
    if (!ents.length) {
      el.innerHTML = `<div class="dim">No selection. Drag to box-select · Ctrl+A all ships · double-click a ship for its whole class.</div>`;
      return;
    }
    const bar = (e) => `<div class="bars"><i class="s" style="width:${e.maxShield ? clamp(e.shield / e.maxShield, 0, 1) * 100 : 0}%"></i><i class="h" style="width:${clamp(e.hull / e.maxHull, 0, 1) * 100}%"></i></div>`;
    const subs = (e) =>
      e.subs
        ? `<div class="subs">${Object.entries(e.subs)
            .map(([k, sb]) => `<span class="sub ${sb.hp <= 0 ? 'off' : sb.hp < sb.max * 0.5 ? 'low' : ''}" title="${SUBSYSTEMS[k].name}${sb.hp <= 0 ? ': ' + SUBSYSTEMS[k].effect : ''}">${SUBSYSTEMS[k].name} ${Math.max(0, Math.round((sb.hp / sb.max) * 100))}%</span>`)
            .join('')}</div>`
        : '';
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
          ${e.rank ? `<div class="tag good">Veteran crew ${'★'.repeat(e.rank)} (+${e.rank * 8}% dmg)</div>` : e.style === 'ascendancy' ? `<div class="tag">Crew XP ${Math.floor(e.xp || 0)}</div>` : ''}
          ${e.style === 'array' && e.role !== 'flagship' && !e.captured ? (e.linked ? `<div class="tag">Command link · network ×${e.network} (+${e.network * 8}% dmg)</div>` : `<div class="tag bad">Isolated — no command link</div>`) : ''}
          ${e.engineDamaged ? `<div class="tag bad">Engines crippled — vulnerable to boarding</div>` : ''}
          ${e.inStorm ? `<div class="tag bad">In ion storm — no shield recharge</div>` : ''}
          ${e.repairRate ? `<div class="tag">Repairs nearby allies</div>` : ''}
          ${e.role === 'boarder' ? `<div class="tag">Boards and captures disabled ships</div>` : ''}
          ${e.visual.hangars ? `<div class="tag">Carrier: launches fighters near enemies</div>` : ''}`;
      } else if (e.kind === 'wreck') extra = `<div class="dim">Right-click it with a ship selected to investigate.</div>`;
      else if (g.world.civ && e.team !== 'player') extra = `<div class="dim">Part of ${esc(g.world.civ.state.intel.contact ? g.world.civ.name : 'an unknown civilization')}. Open the dossier (C).</div>`;
      el.innerHTML = `<h4>${esc(e.name)}</h4><div class="cls">${esc(e.cls || '')}${e.hybrid ? ' · integrated' : ''}${e.captured ? ' · captured' : ''}${e.alliedFrom ? ' · allied specialist' : ''}</div>
        ${e.maxHull > 1 ? bar(e) + `<div class="nums">Hull ${Math.ceil(e.hull)}/${Math.ceil(e.maxHull)} · Shield ${Math.ceil(e.shield)}/${Math.ceil(e.maxShield)}</div>` : ''}${subs(e)}${extra}`;
    } else {
      el.innerHTML = `<h4>${ents.length} selected</h4><div class="grid">${ents
        .map((e) => `<div class="mini" title="${esc(e.name)}"><b>${esc((e.cls || e.name).split(' ')[0])}${e.rank ? ' ' + '★'.repeat(e.rank) : ''}</b>${bar(e)}</div>`)
        .join('')}</div>`;
    }
  }

  // Formation presets, stance orders and subsystem focus. Re-rendered only when inputs change
  // so its buttons stay stable under the cursor.
  renderCmdBar(force) {
    const g = this.g;
    const el = $('#cmdbar');
    const ships = g.commandable();
    const tgt = ships.length && ships[0].focus ? g.world.get(ships[0].focus) : null;
    const sig = ships.map((s) => s.id).join(',') + '|' + g.formation + '|' + (tgt && tgt.subs && g.world.hostile(ships[0], tgt) ? tgt.id + (ships[0].subFocus || '') : '');
    if (sig === this.cmdSig && !force) return;
    this.cmdSig = sig;
    if (!ships.length) {
      el.innerHTML = '';
      return;
    }
    const F = [['keep', 'Keep'], ['core', 'Core'], ['line', 'Line'], ['encircle', 'Encircle']];
    let html = `<div class="cmdrow"><span class="dim">Formation</span>${F.map(([k, n]) => `<button data-f="${k}" class="${g.formation === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="cmdrow"><button data-c="hold" title="P">Hold</button><button data-c="withdraw" title="U">Withdraw</button><button data-c="stop" title="X">Stop</button><button data-c="up" title="Z">▲</button><button data-c="down" title="V">▼</button></div>`;
    if (tgt && tgt.subs && g.world.hostile(ships[0], tgt)) {
      html += `<div class="cmdrow"><span class="dim">Target ${esc(tgt.name)}:</span>${Object.keys(tgt.subs).map((k) => `<button data-sub="${k}" class="${ships[0].subFocus === k ? 'on' : ''}">${SUBSYSTEMS[k].name}</button>`).join('')}</div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => g.setFormation(b.dataset.f)));
    el.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => { g.focusSubsystem(b.dataset.sub); this.renderCmdBar(true); }));
    el.querySelectorAll('[data-c]').forEach((b) => {
      b.onclick = () => {
        const c = b.dataset.c;
        if (c === 'hold') g.holdSelection();
        if (c === 'withdraw') g.withdrawSelection();
        if (c === 'stop') g.stopSelection();
        if (c === 'up') g.elevate(25);
        if (c === 'down') g.elevate(-25);
      };
    });
  }

  renderAbilities(force) {
    const g = this.g;
    const el = $('#abilities');
    if (!el || g.state !== 'play') return;
    const list = ABILITIES[g.faction];
    const states = list.map((_, i) => abilityState(g, i));
    const sig = states.map((s) => s.block || 'ok').join('|');
    if (sig === this.abSig && !force) return;
    this.abSig = sig;
    el.innerHTML = states
      .map((st, i) => `<button data-ab="${i}" class="${st.block ? 'cd' : 'ready'}" title="${esc(st.ab.desc)}"><b>${st.ab.name}</b><small>${st.block || 'Ready'} · ${st.ab.key}</small></button>`)
      .join('');
    el.querySelectorAll('[data-ab]').forEach((b) => (b.onclick = () => g.ability(+b.dataset.ab)));
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
      <tr><td>E · B · R · C · G · Y</td><td>Expedition · Shipyard · Adaptation bay · Dossier · Galaxy map · Research</td></tr>
      <tr><td>J · K</td><td>Faction abilities (centred on the flagship)</td></tr>
      <tr><td>P · U · M</td><td>Hold position · withdraw to the jump point · mute</td></tr>
      <tr><td>Right click a friendly ship</td><td>Escort it</td></tr>
      <tr><td>Touch</td><td>Tap select/order · drag orbit · pinch zoom/pan · long-press radial menu</td></tr>
      </table>
      <h3>Combat notes</h3>
      <p>Escorts' light weapons shred fighters; heavy guns hit capitals and stations hard but miss small craft. Ships below 35% hull limp with crippled engines — Bloom spores devour them. Repair ships mend nearby allies. Your home station repairs everything near it.</p>
      <p>Capital ships and stations have engines, weapons, shields and command. Attack one, then pick a subsystem in the selection panel to focus fire. Disabled engines leave a ship adrift: boarding craft (and Bloom escorts) can then capture it. Knocking out a capital's command speeds its surrender.</p>
      <p>Ion storms stop shields recharging and shorten weapon range. Plan routes around them — or lure enemies in.</p>
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
      <div class="builds">${[...(g.allPlayerShips().some((e) => e.role === 'flagship') || g.buildQueue.some((e) => e.role === 'flagship') ? [] : ['flagship']), 'escort', 'scout', 'repair', ...(g.research.boarding ? ['boarder'] : [])]
        .map((r) => `<div class="b"><h3>${f.names[r]}</h3><p class="dim">${{ boarder: 'Captures ships whose engines are disabled.', flagship: 'Your flagship was lost. Replace it.', escort: 'Line combatant. Light weapons tear through fighters.', scout: 'Fast. Scans three times faster, revealing intel.', repair: 'Mends the hull of nearby allies in battle.' }[r]}</p><p>◈ ${SHIP_COST[r]} · ${BUILD_TIME[r]}s</p>${r === 'boarder' ? '' : ''}<button data-r="${r}" ${g.materials < SHIP_COST[r] ? 'disabled' : ''}>${{ grows: 'Grow', assembles: 'Assemble', launches: 'Launch' }[f.production]}</button></div>`)
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
            ${hidden ? `<div class="unk">${hidden} other consideration${hidden > 1 ? 's' : ''} you have not uncovered.</div>` : ''}
            ${ans.counter ? `<div class="counter"><b>Their terms:</b> ${esc(ans.counter.text)} ${['materials', 'knowledge'].includes(ans.counter.kind) ? `<button data-counter="${pid}">Accept terms</button>` : ans.counter.kind === 'mission' ? `<button data-a="help">Take on the mission</button>` : ''}</div>` : ''}</div>`;
        }
        const ol = done || s.hostile ? null : outlook(this.g, civ, pid);
        return `<div class="prop ${done ? 'done' : ''}"><b>${P.name}</b> <span class="dim">${P.desc}</span> ${done ? '<span class="tag good">In force</span>' : `<button data-p="${pid}" ${s.hostile ? 'disabled' : ''}>Propose</button>`}
          ${ol ? `<div class="outlook ${ol.cls}">Outlook: <b>${ol.text}</b>${ol.hidden ? ` <span class="dim">(${ol.hidden} unknown factor${ol.hidden > 1 ? 's' : ''} — gather intel to narrow it)</span>` : ''}</div>` : ''}${res}</div>`;
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
    m.querySelectorAll('[data-counter]').forEach((b) => {
      b.onclick = () => {
        const pid = b.dataset.counter;
        const ans = this.lastAnswer[civ.id + pid];
        const err = acceptCounter(g, civ, pid, ans.counter);
        if (err) return this.log(err, 'warn');
        const res = propose(g, civ, pid);
        this.lastAnswer[civ.id + pid] = res;
        if (res.ok) this.log(`${PROPOSALS[pid].name} accepted by ${civ.name}.`, 'good');
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
    $('#galaxy').style.display = this.galaxyOpen ? 'block' : 'none';
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
    const s = Math.min(W * 0.62, H) / 820;
    return { c, W, H, s, cx: W * 0.38, cy: H * 0.52 };
  }
  sysScreen(L, p) {
    return [L.cx + p[0] * L.s, L.cy + p[1] * L.s];
  }
  // Map state for a system, shown with icons and patterns as well as colour.
  mapState(sd) {
    const g = this.g;
    const st = sysState(g, sd.id);
    const threat = st.threat ? Math.max(0, Math.round(st.threat.deadline - g.stime)) : null;
    if (sd.id === 'home') return { key: 'owned', icon: '■', label: 'Home', threat };
    if (!g.known.has(sd.id)) return { key: 'unknown', icon: '', label: '', threat: null };
    if (sd.kind === 'empty') {
      if (sd.empty.kind === 'relay' && g.relayActive) return { key: 'relay', icon: '⌬', label: 'Relay online', threat };
      return { key: st.visited ? 'surveyed' : 'unexplored', icon: st.visited ? '○' : '?', label: st.visited ? 'Surveyed' : 'Unexplored', threat };
    }
    const cs = sd.civ.state;
    const contested = st.contestedUntil > g.stime || threat != null;
    if (cs.integrating) return { key: 'integrating', icon: '⟳', label: 'Integrating', threat };
    if (cs.status === 'protectorate') return { key: 'protectorate', icon: '◇', label: 'Protectorate', threat };
    if (cs.status === 'conquered' || cs.status === 'assimilated') return { key: contested ? 'contested' : 'owned', icon: contested ? '⚠' : '■', label: contested ? 'Occupied — contested' : cs.status === 'conquered' ? 'Occupied' : 'Integrated', threat };
    if (cs.status === 'allied') return { key: 'allied', icon: '✦', label: 'Allied', threat };
    if (cs.status === 'hostile') return { key: 'hostile', icon: '✕', label: 'At war', threat };
    if (cs.status === 'devastated') return { key: 'devastated', icon: '✝', label: 'Devastated', threat };
    if (!cs.visited) return { key: 'unexplored', icon: '?', label: 'Unexplored', threat };
    return { key: 'contacted', icon: '●', label: STATUS_LABEL[cs.status], threat };
  }
  drawGalaxy() {
    const g = this.g;
    const L = this.galaxyLayout();
    const ctx = L.c.getContext('2d');
    const t = performance.now() / 1000;
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, L.W, L.H);
    const gs = L.s * 0.9;
    const core = [L.cx - 420 * gs, L.cy + 160 * gs];
    const cg = ctx.createRadialGradient(core[0], core[1], 0, core[0], core[1], 620 * gs);
    cg.addColorStop(0, 'rgba(255,220,170,0.22)');
    cg.addColorStop(0.3, 'rgba(160,130,220,0.08)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, L.W, L.H);
    for (const f of g.galaxy.far) {
      const x = L.cx + f.pos[0] * gs, y = L.cy + f.pos[1] * gs;
      ctx.fillStyle = col.css(col.hsl(0.55 + f.hue * 0.15, 0.4, 0.75), f.b * 0.6);
      const sz = 0.8 + f.b * 1.3;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.fillStyle = 'rgba(160,180,255,0.45)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Thousands of systems lie beyond this cluster. Expand your relay network to reach them.', 20, L.H - 20);
    const sys = g.galaxy.systems;
    const byId = Object.fromEntries(sys.map((x) => [x.id, x]));
    const fc = g.fac.color;
    // Lanes between surveyed systems; routes from your current position are brighter.
    const drawn = new Set();
    for (const a of sys) {
      for (const id of a.links) {
        const k = [a.id, id].sort().join('|');
        if (drawn.has(k)) continue;
        drawn.add(k);
        const b = byId[id];
        if (!g.known.has(a.id) && !g.known.has(b.id)) continue;
        const both = g.known.has(a.id) && g.known.has(b.id);
        const live = a.id === g.currentSystem || b.id === g.currentSystem;
        const [x0, y0] = this.sysScreen(L, a.pos), [x1, y1] = this.sysScreen(L, b.pos);
        ctx.strokeStyle = live ? 'rgba(140,220,255,0.75)' : both ? 'rgba(120,170,255,0.32)' : 'rgba(120,170,255,0.12)';
        ctx.lineWidth = live ? 1.6 : 1;
        ctx.setLineDash(live ? [] : [4, 6]);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    if (g.relayActive) {
      const r = sys.find((x) => x.id === 'sys-relay');
      const [rx, ry] = this.sysScreen(L, r.pos);
      ctx.strokeStyle = 'rgba(120,255,180,0.18)';
      for (const x of sys) {
        if (x === r || !g.known.has(x.id)) continue;
        const [sx, sy] = this.sysScreen(L, x.pos);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.quadraticCurveTo((rx + sx) / 2, (ry + sy) / 2 - 40, sx, sy);
        ctx.stroke();
      }
    }
    for (const sd of sys) {
      const [x, y] = this.sysScreen(L, sd.pos);
      const ms = this.mapState(sd);
      const known = g.known.has(sd.id);
      const sc = !known ? [0.5, 0.55, 0.65] : sd.civ ? sd.civ.sys.star : sd.empty ? sd.empty.sys.star : FACTIONS[g.faction].home.star;
      const R0 = 30 * L.s * 1.6;
      // Territory and relationship presentation
      if (ms.key === 'owned' || ms.key === 'contested' || ms.key === 'protectorate') {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, R0 * 2.2);
        gr.addColorStop(0, col.css(fc, ms.key === 'protectorate' ? 0.16 : 0.3));
        gr.addColorStop(1, col.css(fc, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, R0 * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 1.5;
      if (ms.key === 'contested') {
        ctx.strokeStyle = 'rgba(255,170,60,0.9)';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(x, y, R0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ms.key === 'integrating') {
        ctx.strokeStyle = 'rgba(190,140,255,0.9)';
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -t * 30;
        ctx.beginPath();
        ctx.arc(x, y, R0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineDashOffset = 0;
      } else if (ms.key === 'allied') {
        ctx.strokeStyle = col.css(fc, 0.9);
        ctx.beginPath();
        ctx.arc(x, y, R0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ms.key === 'protectorate') {
        ctx.strokeStyle = col.css(fc, 0.9);
        ctx.beginPath();
        ctx.arc(x, y, R0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(x, y, R0 * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ms.key === 'hostile') {
        ctx.strokeStyle = 'rgba(255,90,70,0.85)';
        ctx.beginPath();
        ctx.arc(x, y, R0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = col.css(sc, known ? 1 : 0.5);
      ctx.shadowColor = col.css(sc, 1);
      ctx.shadowBlur = known ? 14 : 4;
      ctx.beginPath();
      ctx.arc(x, y, known ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      const binary = (sd.civ && sd.civ.stellar === 'binary') || (sd.empty && sd.empty.stellar === 'binary');
      if (known && binary) {
        ctx.beginPath();
        ctx.arc(x + 8, y - 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (g.currentSystem === sd.id) {
        ctx.strokeStyle = 'rgba(120,255,160,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 13 + Math.sin(t * 3) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      if (this.gSel === sd.id || this.gHover === sd.id) {
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(x - 18, y - 18, 36, 36);
      }
      ctx.textAlign = 'center';
      if (!known) {
        if (g.research.deepscan) {
          ctx.fillStyle = 'rgba(170,185,215,0.7)';
          ctx.font = '11px "Trebuchet MS", sans-serif';
          ctx.fillText(sd.kind === 'civ' ? 'Inhabited signature' : 'Faint signature', x, y + 20);
        }
        continue;
      }
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.fillStyle = '#dfe8ff';
      const label = sd.id === 'home' ? g.fac.home.name : sd.civ ? (sd.civ.state.intel.contact ? sd.civ.name : sd.civ.state.visited ? `${sd.civ.texts.stellar.name} (inhabited)` : 'Unknown signal') : sysState(g, sd.id).visited ? sd.name : 'Uncharted signal';
      ctx.fillText(label, x, y + 27);
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.fillStyle = ms.key === 'hostile' ? '#f97' : ['owned', 'allied', 'protectorate', 'relay'].includes(ms.key) ? col.css(fc) : ms.key === 'contested' ? '#fb6' : ms.key === 'integrating' ? '#c9f' : '#9ab';
      if (ms.label) ctx.fillText(`${ms.icon} ${ms.label}`, x, y + 41);
      if (ms.threat != null) {
        ctx.fillStyle = `rgba(255,${120 + 60 * Math.sin(t * 5)},90,1)`;
        ctx.fillText(`⚠ RAID — ${ms.threat}s`, x, y - 16);
      }
      const civ = sd.civ;
      if (civ && civ.state.pressure > 0.5 && !civ.state.helped && !['owned', 'contested', 'allied', 'protectorate', 'devastated'].includes(ms.key)) {
        ctx.fillStyle = '#f86';
        ctx.fillText(`${civ.neighbor} pressure rising`, x, y + 54);
      }
    }
    // Legend
    ctx.textAlign = 'left';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    const leg = [['■', 'Controlled'], ['⚠', 'Contested'], ['⟳', 'Integrating'], ['✦', 'Allied'], ['◇', 'Protectorate'], ['✕', 'At war'], ['?', 'Unexplored']];
    leg.forEach(([i, n], k) => {
      ctx.fillStyle = 'rgba(200,215,240,0.75)';
      ctx.fillText(`${i}  ${n}`, 20, 110 + k * 16);
    });
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
    const sd = g.galaxy.systems.find((x) => x.id === this.gSel);
    const res = `<p class="dim">◈ ${Math.floor(g.materials)} · ϟ ${Math.floor(g.energy)} · ✧ ${Math.floor(g.knowledge)}${g.income ? ` — income ◈${g.income.mat.toFixed(1)}/s ϟ${g.income.en.toFixed(2)}/s` : ''}</p>`;
    if (!sd) {
      p.innerHTML = `<h3>The cluster</h3><p class="dim">Select a system. You can jump along lanes from where you are; home is always one jump away. Each jump costs energy.</p>${res}${g.driveReady ? '' : '<p class="bad">Jump drive uncalibrated — investigate the wreck at home.</p>'}`;
      return;
    }
    const st = sysState(g, sd.id);
    const ms = this.mapState(sd);
    let body = '';
    if (sd.id === 'home') body = `<h3>${esc(g.fac.home.name)}</h3><p>Your home system: production, research, repairs and refits.</p>`;
    else if (!g.known.has(sd.id)) body = `<h3>Unsurveyed</h3><p class="dim">No route data. Explore neighbouring systems to chart the lanes here.</p>`;
    else if (sd.kind === 'empty') {
      const e = sd.empty;
      body = `<h3>${st.visited ? esc(e.texts.name) : 'Uncharted signal'}</h3><p>${st.visited ? esc(e.texts.desc) : 'A faint signature. No inhabitants detected at this range.'}</p>${e.storms.length && st.visited ? '<p class="dim">Ion storms present.</p>' : ''}`;
    } else {
      const c = sd.civ;
      const I = c.state.intel;
      body = `<h3>${I.contact ? esc(c.name) : 'Unknown signal'}</h3>
        <p>${c.state.visited ? `${c.texts.stellar.name}. ${c.texts.habitat.name}.` : 'Inhabited. Defences unknown.'}</p>
        <p>Status: <b>${ms.icon} ${ms.label}</b></p>
        ${I.signature ? `<p>Signature: <b>${TRAITS[c.signature].name}</b></p>` : ''}
        ${c.state.pressure > 0.5 && !c.state.helped ? `<p class="bad">The ${esc(c.neighbor)} grow bolder while you are away.</p>` : ''}`;
      if (['conquered', 'assimilated', 'protectorate'].includes(c.state.status)) {
        body += `<h4>System role</h4><div class="btnrow">${Object.entries(SYSTEM_ROLES).map(([k, r]) => `<button data-role="${k}" class="${st.role === k ? 'on' : ''}" title="${r.desc}">${r.name}</button>`).join('')}</div><p class="dim">${st.role ? SYSTEM_ROLES[st.role].desc : 'Choose what its governor prioritises.'}</p>`;
      }
    }
    if (ms.threat != null) body += `<p class="bad">⚠ Under raid — ${ms.threat}s to respond.</p>`;
    const here = g.currentSystem === sd.id;
    const plan = g.expeditionPlan;
    const fromHome = g.currentSystem === 'home';
    const n = fromHome ? g.playerShips().filter((e) => !plan.ids || plan.ids.has(e.id)).length : g.playerShips().length;
    const reach = g.reachable(sd.id);
    const cost = g.jumpCost(sd.id, n);
    let foot;
    if (here) foot = `<p class="dim">You are here.</p>`;
    else if (!g.known.has(sd.id) && !reach) foot = '';
    else if (!reach) foot = `<p class="dim">No direct lane from your position.${g.relayActive ? '' : ' An active relay would link it.'}</p>`;
    else foot = `<p class="dim">${fromHome ? `Expedition: ${n} ships · objective ${OBJECTIVES[plan.objective].name} (E to change)` : `Fleet: ${n} ships`} · cost <b class="${g.energy < cost ? 'bad' : ''}">ϟ ${cost}</b></p><button class="primary" id="jumpBtn">Jump</button>`;
    p.innerHTML = body + res + foot;
    p.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => { setRole(g, sd.id, b.dataset.role); this.renderGalaxyPanel(); }));
    const jb = $('#jumpBtn', p);
    if (jb)
      jb.onclick = () => {
        const err = g.startJump(sd.id);
        if (err) this.log(err, 'warn');
        else this.toggleGalaxy();
      };
  }

  // ---------------- Research, settings, victory ----------------
  openResearch() {
    const g = this.g;
    if (g.state !== 'play') return;
    const m = this.openModal('research', `<h2>Research</h2>
      <p class="dim">Knowledge comes from scanning civilizations, wrecks, leviathans and anomalies, and from research-role systems. You have <b>✧ ${Math.floor(g.knowledge)}</b>.</p>
      <div class="builds">${Object.entries(RESEARCH)
        .map(([k, r]) => `<div class="b ${g.research[k] ? 'done' : ''}"><h3>${r.name}</h3><p class="dim">${r.desc}</p><p>✧ ${r.cost}</p>${g.research[k] ? '<span class="tag good">Complete</span>' : `<button data-rs="${k}" ${g.knowledge < r.cost ? 'disabled' : ''}>Research</button>`}</div>`)
        .join('')}</div>
      <h3>Your faction</h3><p>${esc(g.fac.blurb)}</p><p class="bad">Weakness: ${esc(WEAKNESS[g.faction])}</p>`);
    m.querySelectorAll('[data-rs]').forEach((b) => {
      b.onclick = () => {
        const err = doResearch(g, b.dataset.rs);
        if (err) this.log(err, 'warn');
        this.openResearch();
      };
    });
  }
  openSettings() {
    const g = this.g;
    const st = g.settings;
    const m = this.openModal('settings', `<h2>Settings</h2>
      <label class="row">Quality <select id="sQ"><option value="auto">Auto</option><option value="high">High</option><option value="low">Low (mobile)</option></select> <span class="dim">— applies after reload</span></label>
      <label class="row"><input type="checkbox" id="sD" ${st.dither ? 'checked' : ''}> Retro ordered dithering</label>
      <label class="row"><input type="checkbox" id="sP" ${st.galaxyPause ? 'checked' : ''}> Pause the local battle while the galaxy map is open</label>
      <label class="row">Volume <input type="range" id="sV" min="0" max="1" step="0.05" value="${st.volume}"> <span class="dim">(M mutes)</span></label>`);
    $('#sQ', m).value = st.quality;
    $('#sQ', m).onchange = (e) => g.applySettings({ quality: e.target.value });
    $('#sD', m).onchange = (e) => g.applySettings({ dither: e.target.checked });
    $('#sP', m).onchange = (e) => g.applySettings({ galaxyPause: e.target.checked });
    $('#sV', m).oninput = (e) => g.applySettings({ volume: +e.target.value });
  }
  openVictory() {
    const g = this.g;
    const ctl = controlled(g);
    const allied = Object.values(g.civs).filter((c) => c.state.status === 'allied');
    this.openModal('victory', `<h2>Regional dominion</h2>
      <p>The cluster recognises ${esc(g.fac.name)} as its dominant power.</p>
      <ul>${ctl.map((c) => `<li><b>${esc(c.name)}</b> — ${STATUS_LABEL[c.state.status]}</li>`).join('')}${allied.map((c) => `<li>${esc(c.name)} — allied (influence, not control)</li>`).join('')}</ul>
      <p>Inheritances: ${Object.keys(g.traits).map((id) => TRAITS[id].name).join(', ') || 'none'}. Relay network: ${g.relayActive ? 'online' : 'dormant'}.</p>
      <p class="dim">The campaign continues — keep exploring, integrating and expanding as you please.</p>
      <div class="foot"><button class="primary" id="vOk">Continue</button></div>`);
    $('#vOk').onclick = () => this.closeModal();
    this.g.audio.ui('good');
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
