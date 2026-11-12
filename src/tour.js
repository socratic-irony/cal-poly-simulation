import * as THREE from 'three';
import { LANDMARKS } from './ui.js';

// A looping camera flight over the campus. Poses are derived from landmark buildings so it stays valid if the data changes.
export class Tour {
  constructor(app) {
    this.app = app; this.active = false; this.t = 0; this.poses = [];
  }
  build() {
    const { hf, buildings } = this.app;
    const find = (re) => buildings.info.find((i) => re.test(i.name));
    const pose = (b, o) => {
      const a = (o.az * Math.PI) / 180;
      const tx = b.cx + (o.dx || 0), tz = b.cz + (o.dz || 0);
      const px = tx + Math.sin(a) * o.dist, pz = tz - Math.cos(a) * o.dist;
      const gy = hf.at(tx, tz);
      return { p: new THREE.Vector3(px, Math.max(hf.at(px, pz) + 2, gy + o.h), pz), t: new THREE.Vector3(tx, gy + (o.up ?? 8), tz), dur: o.dur ?? 7 };
    };
    const dex = find(/Walter F\. Dexter/), lib = find(/Kennedy/), bak = find(/Warren J\. Baker/), rec = find(/Recreation Center/), uu = find(/University Union/), pac = find(/Cohan/);
    const cor = find(/Corralitos/), dairy = find(/Dairy Science Freestall A/), eng = find(/Engineering IV/);
    const list = [];
    if (dex) list.push(pose(dex, { dist: 520, az: 215, h: 330, up: 10, dur: 8 }));
    if (dex) list.push(pose(dex, { dist: 150, az: 215, h: 45, up: 8, dur: 8 }));
    if (dex) list.push(pose(dex, { dist: 55, az: 140, h: 6, up: 7, dx: 25, dz: 30, dur: 8 }));
    if (lib) list.push(pose(lib, { dist: 90, az: 150, h: 10, up: 12, dur: 8 }));
    if (bak) list.push(pose(bak, { dist: 85, az: 200, h: 12, up: 15, dur: 8 }));
    if (eng) list.push(pose(eng, { dist: 110, az: 220, h: 30, up: 8, dur: 7 }));
    if (uu) list.push(pose(uu, { dist: 90, az: 190, h: 14, up: 6, dur: 8 }));
    if (rec) list.push(pose(rec, { dist: 170, az: 240, h: 40, up: 8, dur: 8 }));
    if (pac) list.push(pose(pac, { dist: 140, az: 230, h: 28, up: 10, dur: 8 }));
    if (cor) list.push(pose(cor, { dist: 260, az: 190, h: 90, up: 8, dur: 9 }));
    if (dairy) list.push(pose(dairy, { dist: 260, az: 230, h: 70, up: 4, dur: 9 }));
    if (dex) list.push(pose(dex, { dist: 900, az: 160, h: 520, up: 10, dx: -100, dz: 100, dur: 9 }));
    list.push({ p: new THREE.Vector3(1000, hf.at(1000, -700) + 18, -700), t: new THREE.Vector3(-3210, 120, -100), dur: 10 });   // hill vista toward Bishop Peak and the Morros
    this.poses = list;
    this.pc = new THREE.CatmullRomCurve3(list.map((q) => q.p), true, 'centripetal');
    this.tc = new THREE.CatmullRomCurve3(list.map((q) => q.t), true, 'centripetal');
    this.total = list.reduce((s, q) => s + q.dur, 0);
    // time→u mapping with per-segment durations (ease in/out at each waypoint)
    this.cum = []; let acc = 0; for (const q of list) { this.cum.push(acc); acc += q.dur; }
  }
  start() {
    if (!this.poses.length) this.build();
    if (this.app.walk.active) this.app.setMode('orbit');
    this.active = true; this.t = 0; this.app.controls.enabled = false;
  }
  stop() { this.active = false; this.app.controls.enabled = true; this.app.controls.update(); }
  update(dt) {
    if (!this.active) return;
    this.t = (this.t + dt) % this.total;
    let i = this.cum.length - 1; while (i > 0 && this.cum[i] > this.t) i--;
    const seg = this.poses[i].dur, f = (this.t - this.cum[i]) / seg;
    const e = f * f * (3 - 2 * f) * 0.6 + f * 0.4;             // gentle ease
    const u = ((i + e) / this.poses.length) % 1;
    const p = this.pc.getPoint(u), tg = this.tc.getPoint(u);
    p.y = Math.max(p.y, this.app.hf.at(p.x, p.z) + 2.5);
    this.app.camera.position.copy(p); this.app.camera.lookAt(tg);
    this.app.controls.target.copy(tg);
  }
}
