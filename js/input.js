// Mouse, keyboard and touch input.
// Mouse: left click/drag select, right click command, right drag orbit, middle drag pan, wheel zoom.
// Touch: tap select/command, drag orbit, two fingers pinch/pan, long-press radial menu.

export class Input {
  constructor(game, el) {
    this.game = game;
    this.el = el;
    this.keys = new Set();
    this.drag = null;
    this.rdrag = null;
    this.mdrag = null;
    this.touches = new Map();
    this.mouse = [0, 0];
    this.lastClick = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => this.down(e));
    window.addEventListener('mousemove', (e) => this.move(e));
    window.addEventListener('mouseup', (e) => this.up(e));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      game.cam.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('touchstart', (e) => this.tstart(e), { passive: false });
    el.addEventListener('touchmove', (e) => this.tmove(e), { passive: false });
    el.addEventListener('touchend', (e) => this.tend(e), { passive: false });
    el.addEventListener('touchcancel', (e) => this.tend(e), { passive: false });
  }

  local(e) {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    const [x, y] = this.local(e);
    if (e.button === 0) this.drag = { x0: x, y0: y, x1: x, y1: y, box: false, shift: e.shiftKey };
    else if (e.button === 2) this.rdrag = { x, y, moved: 0, shift: e.shiftKey };
    else if (e.button === 1) {
      e.preventDefault();
      this.mdrag = { x, y };
    }
  }
  move(e) {
    const [x, y] = this.local(e);
    const dx = x - this.mouse[0], dy = y - this.mouse[1];
    this.mouse = [x, y];
    if (this.drag) {
      this.drag.x1 = x;
      this.drag.y1 = y;
      if (Math.abs(x - this.drag.x0) + Math.abs(y - this.drag.y0) > 6) this.drag.box = true;
    }
    if (this.rdrag) {
      this.rdrag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.rdrag.moved > 5) this.game.cam.orbit(-dx * 0.006, dy * 0.005);
    }
    if (this.mdrag) this.game.cam.pan(-dx * 1.2, -dy * 1.2);
    if (!this.drag || !this.drag.box) this.game.updateHover(x, y);
  }
  up(e) {
    const [x, y] = this.local(e);
    if (e.button === 0 && this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.box) this.game.boxSelect(d.x0, d.y0, d.x1, d.y1, d.shift);
      else {
        const now = performance.now();
        const dbl = now - this.lastClick < 320;
        this.lastClick = now;
        this.game.clickSelect(x, y, e.shiftKey, dbl);
      }
    }
    if (e.button === 2 && this.rdrag) {
      if (this.rdrag.moved <= 5) this.game.command(x, y, e.shiftKey);
      this.rdrag = null;
    }
    if (e.button === 1) this.mdrag = null;
  }

  keydown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    const g = this.game;
    if (k === ' ') {
      e.preventDefault();
      g.togglePause();
    } else if (k === 'escape') g.escape();
    else if (k === 'f') g.returnToFleet();
    else if (k === 't') g.trackSelection();
    else if (k === 'g') g.toggleGalaxy();
    else if (k === 'e') g.ui.openExpedition();
    else if (k === 'b') g.ui.openShipyard();
    else if (k === 'r') g.ui.openAdaptation();
    else if (k === 'c') g.ui.openDossier();
    else if (k === 'x') g.stopSelection();
    else if (k === 'z') g.elevate(25);
    else if (k === 'v') g.elevate(-25);
    else if (k === 'h') g.focusHome();
    else if ((e.ctrlKey || e.metaKey) && k === 'a') {
      e.preventDefault();
      g.selectAll();
    } else if (k === 'tab') {
      e.preventDefault();
      g.cycleScale();
    } else if (k === '1' || k === '2' || k === '3') g.setSpeed(+k);
    else if (k === '`') g.toggleDebug();
  }

  update(dt) {
    const k = this.keys;
    const cam = this.game.cam;
    const s = 900 * dt;
    let dx = 0, dz = 0;
    if (k.has('w') || k.has('arrowup')) dz -= s;
    if (k.has('s') || k.has('arrowdown')) dz += s;
    if (k.has('a') || k.has('arrowleft')) dx -= s;
    if (k.has('d') || k.has('arrowright')) dx += s;
    if (dx || dz) cam.pan(dx, dz);
    if (k.has('q')) cam.orbit(1.5 * dt, 0);
    if (k.has('pageup') || k.has('=') || k.has('+')) cam.zoom(Math.exp(-1.5 * dt));
    if (k.has('pagedown') || k.has('-')) cam.zoom(Math.exp(1.5 * dt));
  }

  // ---- Touch ----
  tstart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const [x, y] = this.local(t);
      this.touches.set(t.identifier, { x, y, x0: x, y0: y, t0: performance.now() });
    }
    if (this.touches.size === 1) {
      const t = [...this.touches.values()][0];
      clearTimeout(this.lp);
      this.lp = setTimeout(() => {
        if (this.touches.size === 1 && Math.abs(t.x - t.x0) + Math.abs(t.y - t.y0) < 12) {
          t.long = true;
          this.game.ui.radial(t.x, t.y);
        }
      }, 520);
    } else clearTimeout(this.lp);
    this.pinch = null;
  }
  tmove(e) {
    e.preventDefault();
    const prev = [...this.touches.values()].map((t) => ({ x: t.x, y: t.y }));
    for (const t of e.changedTouches) {
      const s = this.touches.get(t.identifier);
      if (!s) continue;
      [s.x, s.y] = this.local(t);
    }
    const list = [...this.touches.values()];
    if (list.length === 1 && prev.length === 1) {
      const dx = list[0].x - prev[0].x, dy = list[0].y - prev[0].y;
      this.game.cam.orbit(-dx * 0.006, dy * 0.005);
    } else if (list.length >= 2) {
      const d = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
      const cx = (list[0].x + list[1].x) / 2, cy = (list[0].y + list[1].y) / 2;
      if (this.pinch) {
        this.game.cam.zoom(this.pinch.d / Math.max(1, d));
        this.game.cam.pan(-(cx - this.pinch.cx) * 1.5, -(cy - this.pinch.cy) * 1.5);
      }
      this.pinch = { d, cx, cy };
    }
  }
  tend(e) {
    e.preventDefault();
    clearTimeout(this.lp);
    for (const t of e.changedTouches) {
      const s = this.touches.get(t.identifier);
      this.touches.delete(t.identifier);
      if (!s || s.long) continue;
      const moved = Math.abs(s.x - s.x0) + Math.abs(s.y - s.y0);
      if (moved < 12 && performance.now() - s.t0 < 450 && this.touches.size === 0 && !this.pinch) this.game.tap(s.x, s.y);
    }
    if (this.touches.size < 2) this.pinch = null;
  }
}
