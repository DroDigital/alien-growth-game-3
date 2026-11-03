// Procedural geometry: a triangle builder with "painted" per-face colour variation,
// plus primitives (box, cylinder, icosphere, torus, loft, shard, annulus) and planets.
import { m4, v3, rng, fbm3, col, TAU } from './math.js';

export const T = (p = [0, 0, 0], yaw = 0, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx) =>
  m4.compose(p, yaw, pitch, roll, sx, sy, sz);
export const I = () => m4.ident();

export class MB {
  constructor(seed = 1, paint = 0.07) {
    this.v = [];
    this.r = rng(seed);
    this.paint = paint;
    this.maxR = 0;
  }
  tri(a, b, c, color, em = 0) {
    const k = 1 + (this.r() - 0.5) * 2 * this.paint;
    const cr = color[0] * k, cg = color[1] * k, cb = color[2] * k;
    for (const p of [a, b, c]) {
      this.v.push(p[0], p[1], p[2], cr, cg, cb, em);
      const d = Math.hypot(p[0], p[1], p[2]);
      if (d > this.maxR) this.maxR = d;
    }
  }
  quad(a, b, c, d, color, em = 0) {
    this.tri(a, b, c, color, em);
    this.tri(a, c, d, color, em);
  }
  // Unit cube centred at origin, transformed.
  box(t, color, em = 0, colors) {
    const P = (x, y, z) => m4.point(t, [x, y, z]);
    const h = 0.5;
    const c = [P(-h, -h, -h), P(h, -h, -h), P(h, h, -h), P(-h, h, -h), P(-h, -h, h), P(h, -h, h), P(h, h, h), P(-h, h, h)];
    const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
    faces.forEach((f, i) => this.quad(c[f[0]], c[f[1]], c[f[2]], c[f[3]], colors ? colors[i] || color : color, em));
    return this;
  }
  // Cylinder / cone along local Z (-0.5..0.5); r0 at back, r1 at front.
  cyl(t, r0, r1, seg, color, em = 0, caps = true, capColor, capEm) {
    const pts0 = [], pts1 = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU + Math.PI / seg;
      pts0.push(m4.point(t, [Math.cos(a) * r0, Math.sin(a) * r0, -0.5]));
      pts1.push(m4.point(t, [Math.cos(a) * r1, Math.sin(a) * r1, 0.5]));
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      if (r1 === 0) this.tri(pts0[i], pts0[j], pts1[i], color, em);
      else if (r0 === 0) this.tri(pts0[i], pts1[j], pts1[i], color, em);
      else this.quad(pts0[i], pts0[j], pts1[j], pts1[i], color, em);
    }
    if (caps) {
      const c0 = m4.point(t, [0, 0, -0.5]), c1 = m4.point(t, [0, 0, 0.5]);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        if (r0 > 0) this.tri(c0, pts0[j], pts0[i], capColor || color, capEm ?? em);
        if (r1 > 0) this.tri(c1, pts1[i], pts1[j], capColor || color, capEm ?? em);
      }
    }
    return this;
  }
  // Icosphere (radius 1) transformed. opts: jitter, colorFn(dir)->[col, em], seed
  sphere(t, detail, color, em = 0, opts = {}) {
    const { verts, faces } = icosphere(detail);
    const seed = opts.seed || 7;
    const disp = verts.map((v) => {
      let r = 1;
      if (opts.jitter) r += (fbm3(v[0] * 2.5, v[1] * 2.5, v[2] * 2.5, seed, 3) - 0.5) * 2 * opts.jitter;
      if (opts.radiusFn) r = opts.radiusFn(v, r);
      return m4.point(t, [v[0] * r, v[1] * r, v[2] * r]);
    });
    for (const f of faces) {
      let c = color, e = em;
      if (opts.colorFn) {
        const cen = v3.norm(v3.add(v3.add(verts[f[0]], verts[f[1]]), verts[f[2]]));
        const res = opts.colorFn(cen);
        c = res[0];
        e = res[1] ?? em;
      }
      this.tri(disp[f[0]], disp[f[1]], disp[f[2]], c, e);
    }
    return this;
  }
  // Torus around local Z axis, lying in XY plane.
  torus(t, R, r, seg, sides, color, em = 0, colorFn) {
    const P = (i, j) => {
      const a = (i / seg) * TAU, b = (j / sides) * TAU + Math.PI / sides;
      const cx = Math.cos(a), cy = Math.sin(a);
      const rr = R + Math.cos(b) * r;
      return m4.point(t, [cx * rr, cy * rr, Math.sin(b) * r]);
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < sides; j++) {
        const c = colorFn ? colorFn(i, j) : [color, em];
        this.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), c[0], c[1]);
      }
    }
    return this;
  }
  // Loft elliptical sections along Z. sections: [{z, w, h, x, y}] ; colorFn(zi, angle) -> [col, em]
  loft(t, sections, sides, color, em = 0, opts = {}) {
    const rings = sections.map((s, si) => {
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * TAU + (opts.rot ?? Math.PI / sides);
        let w = s.w, h = s.h;
        if (opts.jitter) {
          const j = 1 + (this.r() - 0.5) * opts.jitter;
          w *= j;
          h *= j;
        }
        const yy = Math.sin(a) * h * (Math.sin(a) < 0 ? s.belly ?? 1 : 1);
        pts.push(m4.point(t, [(s.x || 0) + Math.cos(a) * w, (s.y || 0) + yy, s.z]));
      }
      return pts;
    });
    for (let si = 0; si < rings.length - 1; si++) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const a = ((i + 0.5) / sides) * TAU + (opts.rot ?? Math.PI / sides);
        const c = opts.colorFn ? opts.colorFn(si / (rings.length - 1), a) : [color, em];
        this.quad(rings[si][i], rings[si][j], rings[si + 1][j], rings[si + 1][i], c[0], c[1] ?? em);
      }
    }
    if (opts.caps !== false) {
      const first = sections[0], last = sections[sections.length - 1];
      const c0 = m4.point(t, [first.x || 0, first.y || 0, first.z]);
      const c1 = m4.point(t, [last.x || 0, last.y || 0, last.z]);
      const capC = opts.capColor || color;
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        this.tri(c0, rings[0][j], rings[0][i], opts.backCap || capC, opts.backEm ?? em);
        this.tri(c1, rings[rings.length - 1][i], rings[rings.length - 1][j], capC, opts.frontEm ?? em);
      }
    }
    return this;
  }
  // Elongated crystal: hexagonal bipyramid along Z (-1..1).
  shard(t, color, em = 0, sides = 5, waist = 0.28, waistZ = -0.25) {
    const top = m4.point(t, [0, 0, 1]), bot = m4.point(t, [0, 0, -1]);
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      ring.push(m4.point(t, [Math.cos(a) * waist, Math.sin(a) * waist, waistZ]));
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.tri(ring[i], ring[j], top, color, em);
      this.tri(ring[j], ring[i], bot, col.mul(color, 0.8), em);
    }
    return this;
  }
  // Flat annulus in local XZ plane.
  annulus(t, r0, r1, seg, color, em = 0, colorFn) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU, b = ((i + 1) / seg) * TAU;
      const P = (r, ang) => m4.point(t, [Math.cos(ang) * r, 0, Math.sin(ang) * r]);
      const c = colorFn ? colorFn(i / seg) : [color, em];
      this.quad(P(r0, a), P(r1, a), P(r1, b), P(r0, b), c[0], c[1] ?? em);
    }
    return this;
  }
  // A curved tube (tendril / bone) following points, radius tapering.
  tube(points, r0, r1, sides, color, em = 0, colorFn) {
    const rings = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const nxt = points[Math.min(i + 1, points.length - 1)], prv = points[Math.max(i - 1, 0)];
      const dir = v3.norm(v3.sub(nxt, prv));
      let up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const s = v3.norm(v3.cross(dir, up));
      up = v3.cross(s, dir);
      const r = r0 + (r1 - r0) * (i / (points.length - 1));
      const ring = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * TAU;
        ring.push(v3.add(p, v3.add(v3.scale(s, Math.cos(a) * r), v3.scale(up, Math.sin(a) * r))));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const c = colorFn ? colorFn(i / (rings.length - 1)) : [color, em];
      for (let k = 0; k < sides; k++) {
        const j = (k + 1) % sides;
        this.quad(rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k], c[0], c[1] ?? em);
      }
    }
    return this;
  }
  build(R) {
    return R.createMesh({ verts: new Float32Array(this.v), radius: this.maxR });
  }
}

const icoCache = {};
export function icosphere(detail) {
  if (icoCache[detail]) return icoCache[detail];
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v3.norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(k)) return cache.get(k);
      verts.push(v3.norm(v3.scale(v3.add(verts[a], verts[b]), 0.5)));
      cache.set(k, verts.length - 1);
      return verts.length - 1;
    };
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  icoCache[detail] = { verts, faces };
  return icoCache[detail];
}

// ---------- Planets ----------
// kind: ocean | industrial | terran | gas | crystal | ash | ice
export function planetMesh(R, kind, seed, pal = {}, detail = 4) {
  const b = new MB(seed, 0.04);
  const S = seed % 1000;
  const colorFn = (d) => {
    const n = fbm3(d[0] * 2.2 + S, d[1] * 2.2, d[2] * 2.2, seed, 5);
    const lat = Math.abs(d[1]);
    switch (kind) {
      case 'ocean': {
        if (lat > 0.88 - n * 0.1) return [[0.85, 0.92, 0.98], 0];
        if (n > 0.62) return [col.mix([0.2, 0.55, 0.45], [0.75, 0.7, 0.45], (n - 0.62) * 3), 0];
        if (n > 0.56) return [[0.25, 0.65, 0.75], 0];
        return [col.mix([0.05, 0.16, 0.42], [0.08, 0.32, 0.6], n * 1.4), 0];
      }
      case 'terran': {
        if (lat > 0.9 - n * 0.08) return [[0.9, 0.93, 0.98], 0];
        if (n > 0.55) {
          const city = fbm3(d[0] * 14, d[1] * 14, d[2] * 14, seed + 3, 2);
          if (city > 0.62) return [[1.0, 0.8, 0.45], 0.7];
          return [col.mix([0.22, 0.48, 0.22], [0.55, 0.5, 0.32], (n - 0.55) * 3), 0];
        }
        return [col.mix([0.06, 0.18, 0.5], [0.12, 0.38, 0.72], n * 1.3), 0];
      }
      case 'industrial': {
        const c = col.mix([0.32, 0.31, 0.33], [0.6, 0.58, 0.55], n);
        const lights = fbm3(d[0] * 18, d[1] * 18, d[2] * 18, seed + 9, 2);
        if (lights > 0.73) return [[1.0, 0.6, 0.2], 0.8];
        return [c, 0];
      }
      case 'gas': {
        const band = Math.sin(d[1] * 14 + n * 5) * 0.5 + 0.5;
        const a = pal.a || [0.85, 0.6, 0.4], c = pal.b || [0.5, 0.3, 0.35];
        return [col.mix(a, c, band * 0.8 + n * 0.2), 0];
      }
      case 'crystal': {
        const a = pal.a || [0.7, 0.8, 0.95], c = pal.b || [0.35, 0.4, 0.6];
        if (n > 0.64) return [pal.glow || [0.6, 0.9, 1], 0.6];
        return [col.mix(c, a, n), 0];
      }
      case 'ash': {
        if (n > 0.66) return [[1.0, 0.45, 0.15], 0.6];
        return [col.mix([0.18, 0.14, 0.13], [0.45, 0.38, 0.33], n), 0];
      }
      case 'ice':
      default:
        return [col.mix([0.55, 0.65, 0.78], [0.92, 0.95, 1.0], n), 0];
    }
  };
  const jitter = kind === 'gas' ? 0 : kind === 'ocean' || kind === 'terran' ? 0.012 : 0.04;
  b.sphere(I(), detail, [1, 1, 1], 0, { colorFn, jitter, seed });
  return b.build(R);
}

export function atmosphereRing(R, color, seed) {
  const b = new MB(seed, 0.0);
  b.annulus(I(), 1.25, 2.1, 72, color, 0.2, (u) => [col.mul(color, 0.6 + 0.4 * Math.sin(u * TAU * 7) ** 2), 0.15]);
  return b.build(R);
}

// Field of irregular rocks merged into one mesh.
export function asteroidField(R, seed, count, radius, thickness, inner = 0, tint = [0.42, 0.38, 0.36]) {
  const r = rng(seed);
  const b = new MB(seed, 0.12);
  for (let i = 0; i < count; i++) {
    const a = r() * TAU;
    const d = inner + r() * (radius - inner);
    const p = [Math.cos(a) * d, (r() - 0.5) * thickness, Math.sin(a) * d];
    const s = 1.5 + r() ** 3 * 14;
    b.sphere(T(p, r() * 6, r() * 6, r() * 6, s, s * (0.6 + r() * 0.5), s * (0.7 + r() * 0.6)), 0, col.mul(tint, 0.8 + r() * 0.4), 0, {
      jitter: 0.3,
      seed: i + seed,
    });
  }
  return b.build(R);
}
