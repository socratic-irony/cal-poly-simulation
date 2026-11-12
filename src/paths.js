import * as THREE from 'three';
import { makePavementMaterial, makeDesirePathMaterial } from './shading.js';
import { rng, pointInRing } from './util.js';
import { SPLAT } from './ground.js';

// ---------------------------------------------------------------------------------------------
// Real pavement geometry: concrete sidewalks with control joints, paver plazas, stair treads,
// raised street curbs (with driveway/intersection openings) and worn "desire path" shortcuts.
// ---------------------------------------------------------------------------------------------

class Strip {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.hw = []; this.idx = []; }
  vert(x, y, z, nx, ny, nz, u, v, hw) { const i = this.pos.length / 3; this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.hw.push(hw); return i; }
  mesh(mat, name, shadow = true) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aHW', new THREE.Float32BufferAttribute(this.hw, 1));
    g.setIndex(this.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.receiveShadow = true; m.castShadow = false; m.frustumCulled = true;
    return m;
  }
}

// resample a flat polyline [x0,z0,x1,z1,...] to <= step spacing; returns [{x,z,s}] with cumulative length s
function resample(p, step) {
  const out = []; let s = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n, s: s + (L * k) / n });
    s += L;
  }
  const lx = p[p.length - 2], lz = p[p.length - 1];
  out.push({ x: lx, z: lz, s });
  return out;
}

// frames with mitered offsets
function frames(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
    let d0x = b.x - a.x, d0z = b.z - a.z, d1x = c.x - b.x, d1z = c.z - b.z;
    const l0 = Math.hypot(d0x, d0z), l1 = Math.hypot(d1x, d1z);
    if (l0 > 1e-6) { d0x /= l0; d0z /= l0; } else { d0x = d1x / (l1 || 1); d0z = d1z / (l1 || 1); }
    if (l1 > 1e-6) { d1x /= l1; d1z /= l1; } else { d1x = d0x; d1z = d0z; }
    let nx = -(d0z + d1z), nz = d0x + d1x; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const dot = nx * -d0z + nz * d0x;                           // cos of half the turn
    b.nx = nx; b.nz = nz; b.m = 1 / Math.max(0.45, dot);        // miter scale (limited)
  }
}

// sloped-edge ribbon: [ground edge | top edge .... top edge | ground edge]
function addRibbon(strip, pts, hw, hf, lift, edge = 0.07, vOff = 0) {
  frames(pts);
  const cols = [[-hw - edge, 0], [-hw, 1], [hw, 1], [hw + edge, 0]];
  let prev = null;
  for (const p of pts) {
    const row = [];
    for (const [off, top] of cols) {
      const o = off * p.m;
      const x = p.x + p.nx * o, z = p.z + p.nz * o;
      const y = hf.surface(x, z) + (top ? lift : 0.0);
      row.push(strip.vert(x, y, z, 0, 1, 0, off, p.s + vOff, hw));
    }
    if (prev) for (let c = 0; c < 3; c++) { const a = prev[c], b = prev[c + 1], d = row[c], e = row[c + 1]; strip.idx.push(a, b, d, b, e, d); }
    prev = row;
  }
}

export function buildPavements(data, hf) {
  const walk = new Strip(), steps = new Strip(), paver = new Strip(), curb = new Strip();
  let nWalk = 0, nCurb = 0;

  // ---- sidewalks, paths, stairs
  let lift = 0.05;
  for (const r of data.roads) {
    if (r.k === 'walk') {
      const pts = resample(r.p, 1.6); if (pts.length < 2) continue;
      lift = 0.045 + (nWalk % 5) * 0.004;                 // tiny offsets so overlapping paths don't z-fight
      addRibbon(r.sf === 'paver' ? paver : walk, pts, r.w / 2, hf, lift);
      nWalk++;
    } else if (r.k === 'steps') {
      const pts = resample(r.p, 1.0); if (pts.length < 2) continue;
      addRibbon(steps, pts, r.w / 2, hf, 0.07);
    }
  }

  // ---- curbs along streets (skip where another street/driveway crosses)
  const cell = 14, grid = new Map();
  const put = (x, z, hw, id) => { const k = Math.floor(x / cell) + ',' + Math.floor(z / cell); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(x, z, hw, id); };
  data.roads.forEach((r, id) => {
    if (r.k !== 'road' || r.br) return;
    for (const q of resample(r.p, 1.5)) put(q.x, q.z, r.w / 2, id);
  });
  const crossed = (x, z, id) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const a = grid.get(gx + ',' + gz); if (!a) continue;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] === id) continue;
        if (Math.hypot(a[i] - x, a[i + 1] - z) - 0.9 < a[i + 2] + 0.2) return true;
      }
    }
    return false;
  };
  const CW = 0.17, CH = 0.16;
  const cap = (row) => { curb.idx.push(row[0], row[1], row[2], row[0], row[2], row[3]); };
  const emitCurb = (pts, lateral, id) => {
    frames(pts);
    let prev = null;
    for (const p of pts) {
      const off = lateral * p.m;
      const x = p.x + p.nx * off, z = p.z + p.nz * off;
      if (crossed(x, z, id)) { if (prev) cap(prev); prev = null; continue; }
      const yg = hf.surface(x, z);
      const ox = p.nx * CW * 0.5 * p.m, oz = p.nz * CW * 0.5 * p.m;
      const sgn = lateral >= 0 ? 1 : -1;
      const rowV = [
        curb.vert(x - ox, yg - 0.04, z - oz, -p.nx * sgn, 0, -p.nz * sgn, 0, p.s, CW),
        curb.vert(x - ox, yg + CH, z - oz, -p.nx * sgn, 0, -p.nz * sgn, 0.02, p.s, CW),
        curb.vert(x + ox, yg + CH, z + oz, 0, 1, 0, CW - 0.02, p.s, CW),
        curb.vert(x + ox, yg - 0.04, z + oz, p.nx * sgn, 0, p.nz * sgn, CW, p.s, CW),
      ];
      if (prev) for (let c = 0; c < 3; c++) { const a0 = prev[c], b0 = prev[c + 1], d0 = rowV[c], e0 = rowV[c + 1]; curb.idx.push(a0, d0, b0, b0, d0, e0); }
      else cap(rowV);
      prev = rowV;
    }
    if (prev) cap(prev);
  };
  data.roads.forEach((r, id) => {
    if (r.k !== 'road' || r.br || r.w < 5.8) return;
    if (r.sv === 'parking_aisle' || r.sv === 'driveway' || r.sv === 'alley') return;
    if (r.hw === 'motorway' || r.hw === 'motorway_link') return;
    const pts = resample(r.p, 1.2); if (pts.length < 2) return;
    emitCurb(pts.map((q) => ({ ...q })), -(r.w / 2 + CW / 2), id);
    emitCurb(pts.map((q) => ({ ...q })), (r.w / 2 + CW / 2), id);
    nCurb++;
  });
  // parking-lot perimeter curbs (open where a street or aisle enters)
  for (const a of data.areas) {
    if (a.k !== 'parking') continue;
    const ring = a.rings[0]; if (!ring || ring.length < 8) continue;
    const pts = []; for (let i = 0; i <= ring.length; i += 2) pts.push(ring[i % ring.length], ring[(i + 1) % ring.length]);
    emitCurb(resample(pts, 1.2), 0, -1);
  }

  const group = new THREE.Group(); group.name = 'pavements';
  const add = (strip, mat, name) => { const m = strip.mesh(mat, name); if (m) group.add(m); };
  add(walk, makePavementMaterial('walk'), 'sidewalks');
  add(paver, makePavementMaterial('paver'), 'pavers');
  add(steps, makePavementMaterial('steps'), 'steps');
  const curbMat = makePavementMaterial('walk'); curbMat.side = THREE.DoubleSide;
  add(curb, curbMat, 'curbs');
  return { group, nWalk, nCurb };
}

// ---------------------------------------------------------------------------------------------
// Desire paths: worn shortcuts cutting path corners and linking doors to the nearest walkway.
export function buildDesirePaths(data, hf, doors, splat = null) {
  const R = rng(9001);
  // worn trails only make sense across lawn: sample the ground splat (2 m cells) and drop trails that cross paving
  let onLawn = () => true;
  if (splat && splat.canvasA && splat.canvasB) {
    const n = Math.round((2 * SPLAT.half) / 2);
    const rd = (cv) => { const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(cv, 0, 0, n, n); return x.getImageData(0, 0, n, n).data; };
    const A = rd(splat.canvasA), B = rd(splat.canvasB);
    onLawn = (x, z) => {
      const gx = Math.floor((x - SPLAT.cx + SPLAT.half) / 2), gz = Math.floor((z - SPLAT.cz + SPLAT.half) / 2);
      if (gx < 0 || gz < 0 || gx >= n || gz >= n) return false;
      const i = (gz * n + gx) * 4;
      return Math.max(A[i], A[i + 1], A[i + 2]) < 90 && B[i + 1] > 110;
    };
  }
  const lawnShare = (pts) => { let k = 0; for (let i = 0; i <= 10; i++) { const u = i / 10, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    if (onLawn(a * pts[0][0] + b * pts[1][0] + c * pts[2][0], a * pts[0][1] + b * pts[1][1] + c * pts[2][1])) k++; } return k / 11; };
  const strip = new Strip();
  const trails = [];
  const walks = data.roads.filter((r) => r.k === 'walk' && r.w >= 1.9 && r.hw !== 'cycleway');

  // 1) corner cutters
  for (const r of walks) {
    const p = r.p;
    for (let i = 2; i + 3 < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], cx = p[i + 2], cz = p[i + 3];
      const l0 = Math.hypot(bx - ax, bz - az), l1 = Math.hypot(cx - bx, cz - bz);
      if (l0 < 11 || l1 < 11) continue;
      const d0 = [(ax - bx) / l0, (az - bz) / l0], d1 = [(cx - bx) / l1, (cz - bz) / l1];
      const cos = d0[0] * d1[0] + d0[1] * d1[1];
      if (cos > 0.35 || cos < -0.45) continue;                                 // want a ~70°–115° corner
      if (R() > 0.62) continue;
      const k = Math.min(9, 0.45 * Math.min(l0, l1)) * (0.8 + 0.4 * R());
      const A = [bx + d0[0] * k, bz + d0[1] * k], B = [bx + d1[0] * k, bz + d1[1] * k];
      const C = [bx + (d0[0] + d1[0]) * k * 0.28, bz + (d0[1] + d1[1]) * k * 0.28];   // bowed toward the corner
      trails.push({ pts: [A, C, B], w: 0.55 + 0.35 * R() });
    }
  }

  // 2) door shortcuts to the nearest walkway across open lawn
  const cell = 20, grid = new Map();
  for (const r of walks) for (const q of resample(r.p, 2)) { const k = Math.floor(q.x / cell) + ',' + Math.floor(q.z / cell); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(q.x, q.z); }
  const nearest = (x, z) => {
    let best = null, bd = 1e9; const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let gx = cx - 2; gx <= cx + 2; gx++) for (let gz = cz - 2; gz <= cz + 2; gz++) { const a = grid.get(gx + ',' + gz); if (!a) continue; for (let i = 0; i < a.length; i += 2) { const d = Math.hypot(a[i] - x, a[i + 1] - z); if (d < bd) { bd = d; best = [a[i], a[i + 1]]; } } }
    return best ? { p: best, d: bd } : null;
  };
  const bRings = data.buildings.map((b) => b.p);
  const inBuilding = (x, z) => bRings.some((ring) => pointInRing(x, z, ring));
  for (const d of doors) {
    if (R() > 0.6) continue;
    const nr = nearest(d[0], d[1]); if (!nr || nr.d < 9 || nr.d > 34) continue;
    const mx = (d[0] + nr.p[0]) / 2, mz = (d[1] + nr.p[1]) / 2;
    if (inBuilding(mx, mz) || inBuilding(d[0] * 0.3 + nr.p[0] * 0.7, d[1] * 0.3 + nr.p[1] * 0.7)) continue;
    const wob = (R() - 0.5) * 3;
    trails.push({ pts: [d, [mx + wob, mz - wob * 0.5], nr.p], w: 0.7 + 0.3 * R() });
  }

  // build ribbons from quadratic curves through the 3 control points
  const kept = trails.filter((t2) => lawnShare(t2.pts) >= 0.6);
  for (const t of kept) {
    const [A, C, B] = t.pts;
    const pts = []; const N = 14; let s = 0, px = A[0], pz = A[1];
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      const x = a * A[0] + b * C[0] + c * B[0], z = a * A[1] + b * C[1] + c * B[1];
      s += Math.hypot(x - px, z - pz); px = x; pz = z; pts.push({ x, z, s });
    }
    addRibbon(strip, pts, t.w, hf, 0.025, 0.0);
  }
  const group = new THREE.Group(); group.name = 'desire-paths';
  const m = strip.mesh(makeDesirePathMaterial(), 'desire-paths'); if (m) { m.renderOrder = 1; group.add(m); }
  return { group, count: kept.length, dropped: trails.length - kept.length, onLawn, lawnShare, trails };
}
