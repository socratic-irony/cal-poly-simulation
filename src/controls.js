import * as THREE from 'three';

// First-person walking: WASD / arrows, Shift = run, Space (fly up) / C (fly down) in fly mode.
// Collides with building footprints and follows the terrain.
export class WalkControls {
  constructor(camera, dom, hf, colliders) {
    this.camera = camera; this.dom = dom; this.hf = hf;
    this.active = false;
    this.yaw = 0; this.pitch = 0;
    this.pos = new THREE.Vector3();
    this.keys = new Set();
    this.eye = 1.72;
    this.fly = false;
    this.vy = 0;
    this.speed = 3.2;
    this.dragging = false;

    // spatial hash for building footprints
    this.cell = 60;
    this.grid = new Map();
    for (const c of colliders) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < c.p.length; i += 2) { minX = Math.min(minX, c.p[i]); maxX = Math.max(maxX, c.p[i]); minZ = Math.min(minZ, c.p[i + 1]); maxZ = Math.max(maxZ, c.p[i + 1]); }
      c.bb = [minX, minZ, maxX, maxZ];
      for (let gx = Math.floor(minX / this.cell); gx <= Math.floor(maxX / this.cell); gx++)
        for (let gz = Math.floor(minZ / this.cell); gz <= Math.floor(maxZ / this.cell); gz++) {
          const k = gx + ',' + gz; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(c);
        }
    }

    addEventListener('keydown', (e) => { if (!this.active) return; this.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('mousedown', (e) => { if (!this.active) return; this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (!this.active) return;
      const locked = document.pointerLockElement === dom;
      if (!locked && !this.dragging) return;
      const dx = locked ? e.movementX : e.clientX - this.lx, dy = locked ? e.movementY : e.clientY - this.ly;
      this.lx = e.clientX; this.ly = e.clientY;
      this.yaw -= dx * 0.0022; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * 0.0022));
    });
    dom.addEventListener('dblclick', () => { if (this.active && dom.requestPointerLock) dom.requestPointerLock(); });
  }

  enter(fromCamera, target) {
    this.active = true;
    const dir = new THREE.Vector3().subVectors(target, fromCamera.position); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = -0.05;
    this.pos.set(target.x, 0, target.z);
    this.pos.y = this.hf.at(target.x, target.z) + this.eye;
    this.apply();
  }

  exit() { this.active = false; if (document.exitPointerLock) document.exitPointerLock(); this.keys.clear(); }

  inside(x, z, margin = 0.45) {
    const k = Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell);
    const list = this.grid.get(k); if (!list) return null;
    for (const c of list) {
      const b = c.bb;
      if (x < b[0] - margin || x > b[2] + margin || z < b[1] - margin || z > b[3] + margin) continue;
      if (pointInPoly(x, z, c.p) || distToPoly(x, z, c.p) < margin) return c;
    }
    return null;
  }

  update(dt) {
    if (!this.active) return;
    const k = this.keys;
    let speed = this.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.8 : 1) * (k.has('AltLeft') ? 0.4 : 1);
    if (this.fly) speed *= 8;
    if (k.has('ArrowLeft')) this.yaw += 1.4 * dt;
    if (k.has('ArrowRight')) this.yaw -= 1.4 * dt;
    if (k.has('ArrowUp')) this.pitch = Math.min(1.45, this.pitch + 0.9 * dt);
    if (k.has('ArrowDown')) this.pitch = Math.max(-1.45, this.pitch - 0.9 * dt);
    let f = 0, s = 0;
    if (k.has('KeyW')) f += 1; if (k.has('KeyS')) f -= 1; if (k.has('KeyD')) s += 1; if (k.has('KeyA')) s -= 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * f + cos * s), mz = (-cos * f - sin * s);
    const l = Math.hypot(mx, mz);
    if (l > 0) {
      mx = (mx / l) * speed * dt; mz = (mz / l) * speed * dt;
      const nx = this.pos.x + mx, nz = this.pos.z + mz;
      if (this.fly || !this.inside(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (!this.inside(nx, this.pos.z)) this.pos.x = nx;
      else if (!this.inside(this.pos.x, nz)) this.pos.z = nz;
    }
    const ground = this.hf.at(this.pos.x, this.pos.z);
    if (this.fly) {
      if (k.has('Space')) this.pos.y += speed * dt * 0.8; if (k.has('KeyC')) this.pos.y -= speed * dt * 0.8;
      this.pos.y = Math.max(this.pos.y, ground + 1);
    } else {
      const target = ground + this.eye;
      this.pos.y += (target - this.pos.y) * Math.min(1, dt * 12);
    }
    this.apply();
  }

  apply() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}

function pointInPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function distToPoly(x, z, p) {
  let best = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], bx = p[i], bz = p[i + 1];
    const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}
