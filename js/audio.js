// Procedural audio: every sound is synthesised with WebAudio, no sample files.
// Faction identity carries into sound: organic pulses, machine synchronisation, crewed engines.
import { clamp } from './math.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = 0.7;
    this.muted = false;
    this.mood = 'explore';
    this.last = {};
    this.voices = 0;
  }

  // Browsers only allow audio after a user gesture.
  start(faction) {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.vol;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain();
      this.sfx.gain.value = 0.55;
      this.sfx.connect(this.master);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      const len = c.sampleRate;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (faction && faction !== this.faction) {
      this.faction = faction;
      this.startMusic();
    }
  }

  setVolume(v) {
    this.vol = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.vol;
    return this.muted;
  }

  // Throttle so a big battle never turns into noise; distant sounds are quieter.
  gate(key, minGap) {
    const t = this.ctx.currentTime;
    if (this.last[key] && t - this.last[key] < minGap) return false;
    this.last[key] = t;
    return true;
  }

  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, gain = 0.2, attack = 0.005, filter = null, q = 1, out = this.sfx }) {
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = filter;
      fl.Q.value = q;
      o.connect(fl);
      node = fl;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst({ dur = 0.4, gain = 0.3, f0 = 1200, f1 = 120, type = 'lowpass' }) {
    const c = this.ctx;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  fire(w, style, dist) {
    if (!this.ctx || this.muted) return;
    const k = clamp(1 - dist / 2400, 0, 1);
    if (k <= 0.02 || !this.gate('fire' + w.id, 0.07)) return;
    const g = 0.12 * k;
    if (w.kind === 'beam') {
      const base = w.id === 'gravlance' ? 90 : w.id === 'stationgun' ? 300 : 900 + (w.width || 1) * 200;
      this.tone({ type: 'sawtooth', f0: base, f1: base * 0.4, dur: 0.18, gain: g * 0.8, filter: 2400 });
    } else if (w.kind === 'spore') {
      this.tone({ type: 'sine', f0: 220, f1: 70, dur: 0.3, gain: g * 1.2, attack: 0.03 });
    } else {
      const f = style === 'array' ? 1400 : style === 'bloom' ? 600 : 800;
      this.tone({ type: 'square', f0: f, f1: f * 0.5, dur: 0.07, gain: g * 0.5, filter: 3000 });
    }
  }
  explosion(r, dist) {
    if (!this.ctx || this.muted) return;
    const k = clamp(1 - dist / 3500, 0, 1);
    if (k <= 0.02 || !this.gate('boom', 0.06)) return;
    const big = r > 18;
    this.burst({ dur: big ? 1.6 : 0.5, gain: (big ? 0.5 : 0.25) * k, f0: big ? 900 : 1600, f1: 60 });
    if (big) this.tone({ type: 'sine', f0: 90, f1: 30, dur: 1.4, gain: 0.35 * k, attack: 0.01 });
  }
  shieldBreak(dist) {
    if (!this.ctx || this.muted) return;
    const k = clamp(1 - dist / 3000, 0, 1);
    if (!this.gate('shield', 0.2)) return;
    this.tone({ type: 'triangle', f0: 1800, f1: 300, dur: 0.6, gain: 0.18 * k });
    this.tone({ type: 'sine', f0: 2600, f1: 900, dur: 0.4, gain: 0.08 * k });
  }
  ui(kind) {
    if (!this.ctx || this.muted) return;
    if (!this.gate('ui' + kind, 0.04)) return;
    if (kind === 'click') this.tone({ type: 'sine', f0: 1200, f1: 900, dur: 0.05, gain: 0.06 });
    else if (kind === 'order') this.tone({ type: 'triangle', f0: 700, f1: 1000, dur: 0.08, gain: 0.07 });
    else if (kind === 'good') {
      this.tone({ type: 'sine', f0: 660, f1: 660, dur: 0.25, gain: 0.08 });
      setTimeout(() => this.tone({ type: 'sine', f0: 990, f1: 990, dur: 0.35, gain: 0.08 }), 110);
    } else if (kind === 'bad') this.tone({ type: 'sawtooth', f0: 220, f1: 140, dur: 0.4, gain: 0.08, filter: 900 });
    else if (kind === 'alert') {
      for (let i = 0; i < 2; i++) setTimeout(() => this.tone({ type: 'square', f0: 880, f1: 880, dur: 0.12, gain: 0.06, filter: 2000 }), i * 180);
    } else if (kind === 'jump') {
      this.tone({ type: 'sawtooth', f0: 60, f1: 1200, dur: 2.6, gain: 0.12, attack: 1.8, filter: 1800 });
      this.burst({ dur: 3, gain: 0.08, f0: 200, f1: 4000, type: 'bandpass' });
    } else if (kind === 'ability') this.tone({ type: 'triangle', f0: 300, f1: 1200, dur: 0.5, gain: 0.12 });
  }

  // ---------------- Music ----------------
  // A slow generative score: a drone and chord pad whose harmony shifts with the mood
  // (exploration, uncertain contact, battle) and whose pulse reflects the faction.
  startMusic() {
    const c = this.ctx;
    if (this.musicNodes) this.musicNodes.forEach((n) => { try { n.stop(); } catch {} });
    this.musicNodes = [];
    this.pad = [];
    this.padGain = c.createGain();
    this.padGain.gain.value = 0.5;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.padFilter = lp;
    this.padGain.connect(lp).connect(this.musicBus);
    for (let i = 0; i < 4; i++) {
      const o = c.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = 110;
      o.detune.value = (i - 1.5) * 7;
      const g = c.createGain();
      g.gain.value = i === 0 ? 0.35 : 0.16;
      o.connect(g).connect(this.padGain);
      o.start();
      this.pad.push(o);
      this.musicNodes.push(o);
    }
    // Faction pulse: heartbeat (Bloom), synchronised ticks (Array), engine thrum (Ascendancy).
    clearInterval(this.pulseTimer);
    let step = 0;
    this.pulseTimer = setInterval(() => {
      if (!this.ctx || this.muted || document.hidden) return;
      step++;
      const battle = this.mood === 'battle';
      const out = this.musicBus;
      if (this.faction === 'bloom') {
        if (step % (battle ? 2 : 4) === 0) this.tone({ type: 'sine', f0: 70, f1: 45, dur: 0.25, gain: 0.22, attack: 0.02, out });
        if (step % (battle ? 2 : 4) === 1) this.tone({ type: 'sine', f0: 60, f1: 40, dur: 0.3, gain: 0.14, attack: 0.02, out });
      } else if (this.faction === 'array') {
        if (battle || step % 2 === 0) this.tone({ type: 'square', f0: this.root * (step % 4 === 0 ? 4 : 3), f1: this.root * 3, dur: 0.05, gain: 0.03, filter: 2500, out });
      } else {
        if (step % 8 === 0) this.tone({ type: 'sawtooth', f0: this.root / 2, f1: this.root / 2, dur: 1.8, gain: battle ? 0.1 : 0.05, attack: 0.6, filter: 400, out });
        if (battle && step % 2 === 0) this.tone({ type: 'sine', f0: 80, f1: 50, dur: 0.15, gain: 0.12, out });
      }
    }, 250);
    this.setMood(this.mood, true);
  }

  setMood(mood, force) {
    if (!this.ctx || !this.pad) return;
    if (mood === this.mood && !force) return;
    this.mood = mood;
    const roots = { bloom: 98, array: 110, ascendancy: 87.3 };
    this.root = roots[this.faction] || 110;
    const chords = {
      explore: [1, 1.5, 2, 2.52], // open fifth with a major colour
      contact: [1, 1.335, 2, 2.67], // suspended, unresolved
      battle: [1, 1.19, 1.5, 2.38], // minor and tense
    };
    const ch = chords[mood] || chords.explore;
    const t = this.ctx.currentTime;
    this.pad.forEach((o, i) => o.frequency.setTargetAtTime(this.root * ch[i], t, 2.5));
    this.padFilter.frequency.setTargetAtTime(mood === 'battle' ? 1600 : mood === 'contact' ? 1100 : 750, t, 2);
    this.padGain.gain.setTargetAtTime(mood === 'battle' ? 0.6 : 0.45, t, 2);
  }
}
