import * as THREE from 'three';

// Ponds, reservoirs and swimming pools as flat reflective polygons, streams as thin ribbons.
function rippleNormalMap() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(S, S);
  const h = new Float32Array(S * S);
  for (let k = 0; k < 6; k++) {
    const fx = 2 + Math.floor(Math.random() * 6), fz = 2 + Math.floor(Math.random() * 6), ph = Math.random() * 6.28, ph2 = Math.random() * 6.28, amp = 1 / (1 + k);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += Math.sin((x / S) * fx * 6.2832 + ph) * Math.sin((y / S) * fz * 6.2832 + ph2) * amp;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = h[y * S + (x + S - 1) % S], r = h[y * S + (x + 1) % S], u = h[((y + S - 1) % S) * S + x], d = h[((y + 1) % S) * S + x];
    const nx = (l - r) * 1.2, ny = (u - d) * 1.2, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4;
    img.data[i] = (nx / len * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1);
  return t;
}

export function buildWater(data, hf) {
  const group = new THREE.Group(); group.name = 'water';
  const normalMap = rippleNormalMap();
  const mk = (color, rough = 0.04) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, normalMap, normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: 1.4 });
  const pondMat = mk(0x2c4a50), poolMat = mk(0x2aa1c9, 0.03);
  const meshes = [];

  for (const a of data.areas) {
    if (a.k !== 'water' && a.k !== 'pool') continue;
    const ring = a.rings[0]; if (!ring || ring.length < 6) continue;
    const pts = []; let sum = 0, lo = 1e9, hi = -1e9;
    for (let i = 0; i < ring.length; i += 2) { const y = hf.surface(ring[i], ring[i + 1]); sum += y; lo = Math.min(lo, y); hi = Math.max(hi, y); pts.push(new THREE.Vector2(ring[i], ring[i + 1])); }
    if (hi - lo > (a.k === 'pool' ? 2.5 : 8)) continue;
    const level = a.k === 'pool' ? (sum / pts.length) - 0.25 : (lo + (hi - lo) * 0.3) - 0.1;
    let tris = [];
    try { tris = THREE.ShapeUtils.triangulateShape(pts, a.rings.slice(1).map((r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(new THREE.Vector2(r[i], r[i + 1])); return o; })); } catch (e) { continue; }
    const all = pts.concat(...a.rings.slice(1).map((r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(new THREE.Vector2(r[i], r[i + 1])); return o; }));
    const pos = [], nor = [], uv = [], idx = [];
    for (const v of all) { pos.push(v.x, level, v.y); nor.push(0, 1, 0); uv.push(v.x / 6, v.y / 6); }
    for (const t of tris) {
      const A = all[t[0]], B = all[t[1]], C = all[t[2]];
      const cr = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      if (cr < 0) idx.push(t[0], t[1], t[2]); else idx.push(t[0], t[2], t[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, a.k === 'pool' ? poolMat : pondMat); m.receiveShadow = true; m.name = 'water-' + a.k;
    group.add(m); meshes.push(m);
  }

  // streams: thin ribbons just above the ground
  const streamMat = new THREE.MeshStandardMaterial({ color: 0x3a5a52, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.85, normalMap, normalScale: new THREE.Vector2(0.2, 0.2), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const pos = [], idx = [], uv = [];
  for (const r of data.roads) {
    if (r.k !== 'stream') continue;
    const p = r.p, w = Math.min(r.w, 5) * 0.5;
    let run = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz * w, nz = dx * w;
      const n = Math.max(1, Math.ceil(L / 4));
      for (let s = 0; s < n; s++) {
        const t0 = s / n, t1 = (s + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const y0 = hf.surface(x0, z0) + 0.04, y1 = hf.surface(x1, z1) + 0.04;
        const k = pos.length / 3;
        pos.push(x0 + nx, y0, z0 + nz, x1 + nx, y1, z1 + nz, x1 - nx, y1, z1 - nz, x0 - nx, y0, z0 - nz);
        uv.push((run + L * t0) / 4, 0, (run + L * t1) / 4, 0, (run + L * t1) / 4, 1, (run + L * t0) / 4, 1);
        idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
      }
      run += L;
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, streamMat); m.name = 'streams'; m.receiveShadow = true; group.add(m);
  }
  return { group, count: meshes.length };
}
