import * as THREE from 'three';

// Floating name labels for the notable buildings + a compass. Pure DOM overlay, projected every frame.
const KEEP = /kennedy|dexter|baker|frost|cohan|recreation|union|orfalea|engineering|fisher|erhart|agricultur|mott|pilling|jespersen|science|library|architecture|business|music|davidson|spanos|theatre|health|alumni|store|market|chase|crandall|kinesiology|administration|student services|brown|bonderson|construction|food|dairy|equine|vet|plant|conservatory|poly canyon|corralitos|huasna|gypsum|aliso|estrella|buena vista|foxen|inyo|dover|trinity|muir|tenaya|sequoia|fremont|santa lucia|shasta|diablo|lassen|whitney|palomar|vista grande|dining|parking structure/i;

const tidy = (n) => n.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^\d+[A-Z]?-\s*/, '').replace(/\s+/g, ' ').trim();

export class Labels {
  constructor(app) {
    this.app = app; this.enabled = true;
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:4';
    document.body.appendChild(this.root);
    const css = document.createElement('style');
    css.textContent = `.lbl{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font:600 11px/1.1 -apple-system,system-ui,sans-serif;color:#fff;
      text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000;padding:2px 5px;background:rgba(10,14,20,.38);border-radius:4px;transition:opacity .25s}
      #compass{position:fixed;right:14px;top:14px;width:54px;height:54px;border-radius:50%;background:rgba(10,14,20,.55);backdrop-filter:blur(4px);z-index:5;pointer-events:none}
      #compass i{position:absolute;left:50%;top:50%;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:22px solid #ff6b57;transform-origin:50% 100%;margin:-22px 0 0 -5px}
      #compass b{position:absolute;left:50%;top:3px;transform:translateX(-50%);font:700 10px system-ui;color:#fff}`;
    document.head.appendChild(css);
    this.compass = document.createElement('div'); this.compass.id = 'compass'; this.compass.innerHTML = '<i></i><b>N</b>';
    document.body.appendChild(this.compass);
    const list = app.buildings.info.map((b) => ({ ...b, label: tidy(b.name) }))
      .filter((b) => b.label.length > 3 && b.label.length < 44 && KEEP.test(b.name) && !/storage|shed|barn|stall|pens|bunker/i.test(b.label));
    // unique by label (keep the one nearest the group centroid)
    const seen = new Map(); for (const b of list) { if (!seen.has(b.label) || b.h > seen.get(b.label).h) seen.set(b.label, b); }
    this.items = [...seen.values()].map((b) => {
      const el = document.createElement('div'); el.className = 'lbl'; el.textContent = b.label; el.style.display = 'none'; this.root.appendChild(el);
      return { ...b, el, pos: new THREE.Vector3(b.cx, b.pad + b.h + 3, b.cz) };
    });
    addEventListener('keydown', (e) => { if (e.code === 'KeyL' && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) this.enabled = !this.enabled; });
    this.v = new THREE.Vector3();
  }
  update() {
    const { camera } = this.app;
    // compass
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    const yaw = Math.atan2(d.x, -d.z);                   // 0 = looking north (-z)
    this.compass.firstChild.style.transform = `rotate(${(-yaw * 180) / Math.PI}deg)`;
    const W = innerWidth, H = innerHeight;
    if (!this.enabled) { for (const it of this.items) it.el.style.display = 'none'; return; }
    const cam = camera.position, maxD = Math.min(1500, 260 + Math.max(0, cam.y - this.app.hf.at(cam.x, cam.z)) * 3.2);
    const cand = [];
    for (const it of this.items) {
      const dist = cam.distanceTo(it.pos);
      if (dist > maxD || dist < 8) { it.el.style.display = 'none'; continue; }
      this.v.copy(it.pos).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) { it.el.style.display = 'none'; continue; }
      cand.push({ it, dist, x: (this.v.x * 0.5 + 0.5) * W, y: (-this.v.y * 0.5 + 0.5) * H });
    }
    cand.sort((a, b) => a.dist - b.dist);
    const used = new Set(); let shown = 0;
    for (const c of cand) {
      const key = Math.floor(c.x / 120) + ',' + Math.floor(c.y / 26);
      if (used.has(key) || shown >= 28) { c.it.el.style.display = 'none'; continue; }
      used.add(key); shown++;
      const el = c.it.el; el.style.display = 'block'; el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
      el.style.opacity = String(Math.max(0.25, 1 - c.dist / maxD * 0.75));
    }
  }
}
