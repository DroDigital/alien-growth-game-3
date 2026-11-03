// Hand-written WebGL2 renderer: faceted lit meshes, a procedural sky (nebula + stars),
// and one additive batch for every glow, beam, shield ring and explosion.
import { m4, v3 } from './math.js';

const MESH_VS = `#version 300 es
in vec3 aPos; in vec3 aCol; in float aEm;
uniform mat4 uVP; uniform mat4 uM; uniform vec3 uTint;
out vec3 vWorld; out vec3 vCol; out float vEm;
void main(){
  vec4 w = uM * vec4(aPos,1.0);
  vWorld = w.xyz; vCol = aCol * uTint; vEm = aEm;
  gl_Position = uVP * w;
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vCol; in float vEm;
uniform vec3 uCam, uStarPos, uStarCol, uAmbUp, uAmbDown, uFogCol, uFlashCol;
uniform float uEmBoost, uFlash, uUnlit, uAlpha, uFogDen;
out vec4 frag;
void main(){
  // Flat (faceted) normal from screen derivatives -> the sculpted low-poly look.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(uCam - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  vec3 L = normalize(uStarPos - vWorld);
  float ndl = dot(n, L);
  float wrap = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  wrap = wrap * wrap * (3.0 - 2.0 * wrap);
  vec3 hemi = mix(uAmbDown, uAmbUp, n.y * 0.5 + 0.5);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 28.0) * step(0.0, ndl);
  vec3 c = vCol * (hemi + uStarCol * wrap * 1.15);
  c += uStarCol * spec * 0.22 + (uAmbUp * 0.5 + uStarCol * 0.3 * wrap) * rim * 0.6;
  c += vCol * vEm * (1.8 + uEmBoost);
  if (uUnlit > 0.5) c = vCol * (1.4 + uEmBoost);
  c = mix(c, uFlashCol, uFlash);
  float d = length(uCam - vWorld);
  float fog = 1.0 - exp(-uFogDen * d);
  c = mix(c, uFogCol, fog * 0.55);
  c = vec3(1.0) - exp(-c * 1.25); // soft filmic roll-off
  frag = vec4(c, uAlpha);
}`;

const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 vNdc;
void main(){ vNdc = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.9999, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP; uniform vec3 uCam;
uniform vec3 uBg, uNeb1, uNeb2, uStarDir, uStarCol;
uniform float uSeed, uNebAmt;
uniform int uOct;
out vec4 frag;
float h3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13) + uSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float s=0., a=.5; for(int i=0;i<6;i++){ if(i>=uOct) break; s += a*vn(p); p = p*2.07 + 3.1; a*=.5; } return s; }
float stars(vec3 d, float scale, float thresh){
  vec3 g = d * scale; vec3 id = floor(g); vec3 f = fract(g) - 0.5;
  float h = h3(id + 7.0);
  float s = smoothstep(0.42, 0.0, length(f)) * step(thresh, h);
  return s * (0.5 + 0.5 * h3(id + 3.0));
}
void main(){
  vec4 p = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - uCam);
  float n1 = fbm(d * 2.2);
  float n2 = fbm(d * 4.5 + n1 * 1.4);
  float band = exp(-pow(d.y * 2.2 + (n1 - 0.5) * 1.6, 2.0));
  vec3 c = uBg;
  c = mix(c, uNeb1, smoothstep(0.35, 0.85, n2) * (0.35 + band * 0.65) * uNebAmt);
  c = mix(c, uNeb2, smoothstep(0.55, 0.95, n1 * n2 * 1.6) * 0.75 * uNebAmt);
  c += uNeb1 * band * 0.06;
  float s = stars(d, 180.0, 0.93) + stars(d, 420.0, 0.95) * 0.6;
  c += vec3(s) * mix(vec3(0.8,0.85,1.0), vec3(1.0,0.85,0.7), h3(floor(d*180.0)));
  float sd = max(dot(d, uStarDir), 0.0);
  c += uStarCol * (pow(sd, 60.0) * 0.6 + pow(sd, 6.0) * 0.12);
  frag = vec4(c, 1.0);
}`;

const FX_VS = `#version 300 es
in vec3 aPos; in vec3 aUv; in vec4 aCol;
uniform mat4 uVP;
out vec3 vUv; out vec4 vCol;
void main(){ vUv = aUv; vCol = aCol; gl_Position = uVP * vec4(aPos, 1.0); }`;

const FX_FS = `#version 300 es
precision highp float;
in vec3 vUv; in vec4 vCol;
out vec4 frag;
void main(){
  float a;
  if (vUv.z < 0.5) { float r = length(vUv.xy); a = max(0.0, 1.0 - r*r); a *= a; }        // soft glow
  else if (vUv.z < 1.5) { float r = abs(vUv.y); a = max(0.0, 1.0 - r*r); a *= a;          // beam
          a *= smoothstep(1.0, 0.85, abs(vUv.x)); }
  else if (vUv.z < 2.5) { float r = length(vUv.xy); a = exp(-pow((r - 0.86) * 9.0, 2.0)); } // ring
  else { float r = length(vUv.xy); a = step(r, 1.0) * (0.25 + 0.75 * smoothstep(0.6, 1.0, r)); } // disc w/ rim
  frag = vec4(vCol.rgb * a * vCol.a, 0.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

const FX_MAX = 24000; // quads

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.quality = quality;
    this.mesh = compile(gl, MESH_VS, MESH_FS);
    this.sky = compile(gl, SKY_VS, SKY_FS);
    this.fx = compile(gl, FX_VS, FX_FS);
    this.skyVao = gl.createVertexArray();

    // FX batch: pos3, uv3, col4 = 10 floats/vertex, 4 verts/quad, 6 indices/quad
    this.fxData = new Float32Array(FX_MAX * 4 * 10);
    this.fxCount = 0;
    this.fxVao = gl.createVertexArray();
    gl.bindVertexArray(this.fxVao);
    this.fxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.fxData.byteLength, gl.DYNAMIC_DRAW);
    const idx = new Uint32Array(FX_MAX * 6);
    for (let i = 0; i < FX_MAX; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const fp = this.fx.p;
    const bindAttr = (name, size, off) => {
      const loc = gl.getAttribLocation(fp, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off);
    };
    bindAttr('aPos', 3, 0);
    bindAttr('aUv', 3, 12);
    bindAttr('aCol', 4, 24);
    gl.bindVertexArray(null);

    this.view = m4.ident();
    this.proj = m4.ident();
    this.vp = m4.ident();
    this.camPos = [0, 0, 0];
    this.camRight = [1, 0, 0];
    this.camUp = [0, 1, 0];
    this.env = null;
    this.stats = { draws: 0, tris: 0 };
  }

  resize() {
    const dprCap = this.quality === 'low' ? 1 : 2;
    const scale = this.quality === 'low' ? 0.75 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * scale;
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  createMesh(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.verts, gl.STATIC_DRAW);
    const mp = this.mesh.p;
    const bindAttr = (name, size, off) => {
      const loc = gl.getAttribLocation(mp, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, off);
    };
    bindAttr('aPos', 3, 0);
    bindAttr('aCol', 3, 12);
    bindAttr('aEm', 1, 24);
    gl.bindVertexArray(null);
    return { vao, buf, count: data.verts.length / 7, radius: data.radius };
  }

  setCamera(eye, target, fov, near, far) {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.view = m4.lookAt(eye, target, [0, 1, 0]);
    this.proj = m4.perspective(fov, aspect, near, far);
    this.vp = m4.mul(this.proj, this.view);
    this.invVP = m4.invert(this.vp);
    this.camPos = eye;
    const v = this.view;
    this.camRight = [v[0], v[4], v[8]];
    this.camUp = [v[1], v[5], v[9]];
    this.camFwd = [-v[2], -v[6], -v[10]];
    this.aspect = aspect;
  }

  // World -> CSS pixel coordinates of the canvas. Returns null when behind camera.
  project(p, w, h) {
    const m = this.vp;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const ww = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (ww <= 0.01) return null;
    return [((x / ww) * 0.5 + 0.5) * w, (1 - ((y / ww) * 0.5 + 0.5)) * h, ww];
  }

  // Ray from CSS pixel coordinates.
  ray(sx, sy, w, h) {
    const nx = (sx / w) * 2 - 1, ny = 1 - (sy / h) * 2;
    const a = m4.point(this.invVP, [nx, ny, -1]);
    const b = m4.point(this.invVP, [nx, ny, 1]);
    return { o: a, d: v3.norm(v3.sub(b, a)) };
  }

  begin(env) {
    const gl = this.gl;
    this.env = env;
    this.stats.draws = 0;
    this.stats.tris = 0;
    gl.clearColor(env.bg[0], env.bg[1], env.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.sky.p);
    const u = this.sky.u;
    gl.uniformMatrix4fv(u.uInvVP, false, this.invVP);
    gl.uniform3fv(u.uCam, this.camPos);
    gl.uniform3fv(u.uBg, env.bg);
    gl.uniform3fv(u.uNeb1, env.neb1);
    gl.uniform3fv(u.uNeb2, env.neb2);
    const sd = v3.norm(v3.sub(env.starPos, this.camPos));
    gl.uniform3fv(u.uStarDir, sd);
    gl.uniform3fv(u.uStarCol, env.starCol);
    gl.uniform1f(u.uSeed, env.skySeed || 0);
    gl.uniform1f(u.uNebAmt, env.nebAmt ?? 1);
    gl.uniform1i(u.uOct, this.quality === 'low' ? 3 : 5);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(this.mesh.p);
    const mu = this.mesh.u;
    gl.uniformMatrix4fv(mu.uVP, false, this.vp);
    gl.uniform3fv(mu.uCam, this.camPos);
    gl.uniform3fv(mu.uStarPos, env.starPos);
    gl.uniform3fv(mu.uStarCol, env.starCol);
    gl.uniform3fv(mu.uAmbUp, env.ambUp);
    gl.uniform3fv(mu.uAmbDown, env.ambDown);
    gl.uniform3fv(mu.uFogCol, env.fog);
    gl.uniform1f(mu.uFogDen, env.fogDen ?? 0.00012);
    gl.uniform3fv(mu.uFlashCol, [1, 0.92, 0.8]);
    this._mu = mu;
    this.fxCount = 0;
  }

  draw(mesh, model, opt = {}) {
    const gl = this.gl;
    const mu = this._mu;
    gl.uniformMatrix4fv(mu.uM, false, model);
    gl.uniform3fv(mu.uTint, opt.tint || [1, 1, 1]);
    gl.uniform1f(mu.uEmBoost, opt.em || 0);
    gl.uniform1f(mu.uFlash, opt.flash || 0);
    gl.uniform1f(mu.uUnlit, opt.unlit ? 1 : 0);
    gl.uniform1f(mu.uAlpha, opt.alpha ?? 1);
    if (opt.flashCol) gl.uniform3fv(mu.uFlashCol, opt.flashCol);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (opt.flashCol) gl.uniform3fv(mu.uFlashCol, [1, 0.92, 0.8]);
    this.stats.draws++;
    this.stats.tris += mesh.count / 3;
  }

  // ---- FX batch helpers ----
  _quad(p0, p1, p2, p3, mode, c, a) {
    if (this.fxCount >= FX_MAX) return;
    const d = this.fxData;
    let o = this.fxCount * 40;
    const put = (p, u, v) => {
      d[o++] = p[0]; d[o++] = p[1]; d[o++] = p[2];
      d[o++] = u; d[o++] = v; d[o++] = mode;
      d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; d[o++] = a;
    };
    put(p0, -1, -1); put(p1, 1, -1); put(p2, 1, 1); put(p3, -1, 1);
    this.fxCount++;
  }
  // Camera-facing glow. mode 0 glow, 2 ring, 3 disc
  sprite(p, size, c, a = 1, mode = 0) {
    const r = this.camRight, u = this.camUp;
    const rx = r[0] * size, ry = r[1] * size, rz = r[2] * size;
    const ux = u[0] * size, uy = u[1] * size, uz = u[2] * size;
    this._quad(
      [p[0] - rx - ux, p[1] - ry - uy, p[2] - rz - uz],
      [p[0] + rx - ux, p[1] + ry - uy, p[2] + rz - uz],
      [p[0] + rx + ux, p[1] + ry + uy, p[2] + rz + uz],
      [p[0] - rx + ux, p[1] - ry + uy, p[2] - rz + uz],
      mode, c, a
    );
  }
  // Ground-plane aligned (XZ) quad, for selection rings and orbit markers.
  flat(p, size, c, a = 1, mode = 2) {
    this._quad(
      [p[0] - size, p[1], p[2] - size],
      [p[0] + size, p[1], p[2] - size],
      [p[0] + size, p[1], p[2] + size],
      [p[0] - size, p[1], p[2] + size],
      mode, c, a
    );
  }
  beam(a, b, width, c, alpha = 1) {
    const dir = v3.sub(b, a);
    const mid = v3.lerp(a, b, 0.5);
    let side = v3.cross(dir, v3.sub(this.camPos, mid));
    const l = v3.len(side);
    if (l < 1e-6) return;
    side = v3.scale(side, width / l);
    this._quad(v3.sub(a, side), v3.sub(b, side), v3.add(b, side), v3.add(a, side), 1, c, alpha);
  }

  flushFx() {
    if (!this.fxCount) return;
    const gl = this.gl;
    gl.useProgram(this.fx.p);
    gl.uniformMatrix4fv(this.fx.u.uVP, false, this.vp);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.bindVertexArray(this.fxVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.fxData, 0, this.fxCount * 40);
    gl.drawElements(gl.TRIANGLES, this.fxCount * 6, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.stats.draws++;
    this.fxCount = 0;
    gl.useProgram(this.mesh.p);
  }
}
