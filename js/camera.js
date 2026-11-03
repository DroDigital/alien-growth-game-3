// One camera spans close inspection, fleet view and system overview of the same live simulation.
import { clamp, damp, v3, angleWrap } from './math.js';

export const SCALES = [
  { name: 'Close inspection', max: 140 },
  { name: 'Fleet view', max: 1100 },
  { name: 'System overview', max: 1e9 },
];

export class Camera {
  constructor() {
    this.target = [0, 0, 0];
    this.dist = 300;
    this.yaw = 0.6;
    this.pitch = 0.55;
    this.goal = { target: [0, 0, 0], dist: 300, yaw: 0.6, pitch: 0.55 };
    this.track = null;
    this.trackOffset = [0, 0, 0];
    this.speed = 1;
    this.minDist = 18;
    this.maxDist = 6000;
    this.fov = 0.9;
  }
  scaleIndex() {
    return this.dist < SCALES[0].max ? 0 : this.dist < SCALES[1].max ? 1 : 2;
  }
  scaleName() {
    return SCALES[this.scaleIndex()].name;
  }
  set(target, dist, yaw, pitch, instant = false) {
    if (target) this.goal.target = [...target];
    if (dist != null) this.goal.dist = clamp(dist, this.minDist, this.maxDist);
    if (yaw != null) this.goal.yaw = this.yaw + angleWrap(yaw - this.yaw);
    if (pitch != null) this.goal.pitch = clamp(pitch, 0.08, 1.45);
    if (instant) {
      this.target = [...this.goal.target];
      this.dist = this.goal.dist;
      this.yaw = this.goal.yaw;
      this.pitch = this.goal.pitch;
    }
  }
  follow(entity) {
    this.track = entity;
  }
  zoom(factor) {
    this.goal.dist = clamp(this.goal.dist * factor, this.minDist, this.maxDist);
  }
  orbit(dyaw, dpitch) {
    this.goal.yaw += dyaw;
    this.goal.pitch = clamp(this.goal.pitch + dpitch, 0.08, 1.45);
  }
  pan(dx, dz) {
    // Pan relative to view heading; scales with distance so it feels constant on screen.
    const s = this.goal.dist * 0.0018 * this.speed;
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    this.goal.target[0] += (dx * c - dz * sn) * s;
    this.goal.target[2] += (-dx * sn - dz * c) * s;
    this.track = null;
  }
  update(dt) {
    if (this.track) {
      if (this.track.dead) this.track = null;
      else this.goal.target = [...this.track.pos];
    }
    const r = 6;
    for (let i = 0; i < 3; i++) this.target[i] = damp(this.target[i], this.goal.target[i], r, dt);
    // Zoom interpolates in log space so scale transitions feel smooth from 20 to 5000 units.
    this.dist = Math.exp(damp(Math.log(this.dist), Math.log(this.goal.dist), r, dt));
    this.yaw = damp(this.yaw, this.goal.yaw, 8, dt);
    this.pitch = damp(this.pitch, this.goal.pitch, 8, dt);
  }
  eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + Math.sin(this.yaw) * cp * this.dist,
      this.target[1] + Math.sin(this.pitch) * this.dist,
      this.target[2] + Math.cos(this.yaw) * cp * this.dist,
    ];
  }
  apply(R) {
    const eye = this.eye();
    const near = Math.max(0.5, this.dist * 0.02);
    R.setCamera(eye, this.target, this.fov, near, 60000);
    return eye;
  }
  distTo(p) {
    return v3.dist(this.eye(), p);
  }
}
