import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './util.js';
import { SPLAT } from './ground.js';

function box(w, h, d, x, y, z, color, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.toNonIndexed();
}
function cyl(r0, r1, h, x, y, z, color, seg = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count; const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.toNonIndexed();
}
const merge = (list) => { const g = mergeGeometries(list.map((x) => { const y = x.clone(); y.deleteAttribute('uv'); return y; }), false); return g; };

function instanced(geom, mat, items, { yOff = 0, cast = true, name = '' } = {}) {
  const m = new THREE.InstancedMesh(geom, mat, items.length);
  const q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), mat4 = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot || 0); p.set(it.x, it.y + yOff, it.z); s.setScalar(it.s || 1);
    mat4.compose(p, q, s); m.setMatrixAt(i, mat4);
  });
  m.castShadow = cast; m.receiveShadow = true; m.frustumCulled = false; m.name = name;
  return m;
}

export function buildProps(data, hf, occ, walkRoads) {
  const R = rng(777);
  const group = new THREE.Group(); group.name = 'props';
  const place = (x, z, extra = {}) => ({ x, z, y: hf.surface(x, z), ...extra });

  // ---------- lamps
  const lampPts = data.points.lamp.map((p) => place(p[0], p[1], { rot: R() * 6.28 }));
  const cx0 = -380, cz0 = 70;
  for (const r of walkRoads) {
    const p = r.p; let carry = R() * 20;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); if (L < 1) continue;
      const dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L;
      let s = carry;
      while (s < L) {
        const side = R() < 0.5 ? -1 : 1, off = r.w / 2 + 1.0;
        const x = p[i] + dx * s - dz * off * side, z = p[i + 1] + dz * s + dx * off * side;
        if (Math.abs(x - cx0) < 1100 && Math.abs(z - cz0) < 1100 && !occ.blocked(x, z)) lampPts.push(place(x, z, { rot: Math.atan2(-dz * side, dx * side) }));
        s += 34 + R() * 12;
      }
      carry = s - L;
    }
  }
  const poleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6 });
  const lampGeo = merge([cyl(0.07, 0.1, 4.6, 0, 2.3, 0, 0x2b2e30), box(0.9, 0.07, 0.07, 0.4, 4.55, 0, 0x2b2e30), box(0.5, 0.1, 0.26, 0.85, 4.5, 0, 0x2b2e30)]);
  group.add(instanced(lampGeo, poleMat, lampPts, { name: 'lamps' }));
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffe2a0, emissiveIntensity: 0, roughness: 0.4 });
  const headGeo = box(0.44, 0.04, 0.2, 0.85, 4.44, 0, 0xffffff).toNonIndexed(); headGeo.deleteAttribute('color');
  group.add(instanced(headGeo, headMat, lampPts, { name: 'lamp-heads', cast: false }));

  // ---------- benches
  const benchPts = data.points.bench.map((p) => place(p[0], p[1], { rot: -((p[2] || 0) * Math.PI) / 180 + Math.PI / 2 }));
  const wood = 0x6d4b2f, steel = 0x2c2f33;
  const benchGeo = merge([
    box(1.7, 0.05, 0.22, 0, 0.46, 0.0, wood), box(1.7, 0.05, 0.22, 0, 0.46, 0.25, wood),
    box(1.7, 0.05, 0.2, 0, 0.78, -0.2, wood, -0.15), box(1.7, 0.05, 0.2, 0, 0.95, -0.22, wood, -0.15),
    box(0.05, 0.45, 0.55, -0.8, 0.22, 0.05, steel), box(0.05, 0.45, 0.55, 0.8, 0.22, 0.05, steel), box(0.05, 0.75, 0.05, -0.8, 0.82, -0.2, steel), box(0.05, 0.75, 0.05, 0.8, 0.82, -0.2, steel),
  ]);
  group.add(instanced(benchGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), benchPts, { name: 'benches' }));

  // ---------- bike racks (rows of inverted-U)
  const bikePts = data.points.bike.map((p) => place(p[0], p[1], { rot: R() * 3.14 }));
  const rack = []; for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.5; rack.push(box(0.04, 0.8, 0.04, x - 0.2, 0.4, 0, steel), box(0.04, 0.8, 0.04, x + 0.2, 0.4, 0, steel), box(0.44, 0.04, 0.04, x, 0.8, 0, steel)); }
  group.add(instanced(merge(rack), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 }), bikePts, { name: 'bikeracks' }));

  // ---------- bins + flagpoles
  const binPts = data.points.bin.map((p) => place(p[0], p[1]));
  group.add(instanced(merge([cyl(0.27, 0.25, 0.9, 0, 0.45, 0, 0x30363a, 10)]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }), binPts, { name: 'bins' }));
  const flagPts = data.points.flagpole.map((p) => place(p[0], p[1]));
  if (flagPts.length) group.add(instanced(merge([cyl(0.05, 0.08, 12, 0, 6, 0, 0xd9d9d9, 8)]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.8 }), flagPts, { name: 'flagpoles' }));

  return { group, lampHeadMat: headMat, lampPts, counts: { lamps: lampPts.length, benches: benchPts.length, bikes: bikePts.length } };
}

// ------------------------------------------------------------------ fences and walls
export function buildFences(data, hf, mats) {
  const group = new THREE.Group(); group.name = 'fences';
  const fence = { pos: [], uv: [], idx: [] }, wall = { pos: [], nor: [], uv: [], idx: [] }, post = [];
  const ts = 1.5;
  for (const l of data.lines) {
    if (l.k !== 'fence' && l.k !== 'wall' && l.k !== 'retaining') continue;
    const p = l.p; let dist = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const n = Math.max(1, Math.ceil(L / 3));
      for (let s = 0; s < n; s++) {
        const t0 = s / n, t1 = (s + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const y0 = hf.surface(x0, z0), y1 = hf.surface(x1, z1), h = l.h;
        const u0 = (dist + L * t0) / ts, u1 = (dist + L * t1) / ts;
        if (l.k === 'fence') {
          const i0 = fence.pos.length / 3;
          fence.pos.push(x0, y0, z0, x1, y1, z1, x1, y1 + h, z1, x0, y0 + h, z0);
          fence.uv.push(u0, 0, u1, 0, u1, h / ts, u0, h / ts);
          fence.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
          post.push([x0, y0, z0, h]);
        } else {
          const th = 0.28, dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz * th / 2, nz = dx * th / 2;
          const yb0 = y0 - 0.4, yb1 = y1 - 0.4, yt0 = y0 + h, yt1 = y1 + h;
          const q = (a, b, c, d, nrm, uvs) => {
            const k = wall.pos.length / 3;
            wall.pos.push(...a, ...b, ...c, ...d); for (let m = 0; m < 4; m++) wall.nor.push(...nrm);
            wall.uv.push(...uvs); wall.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
          };
          q([x0 - nx, yb0, z0 - nz], [x1 - nx, yb1, z1 - nz], [x1 - nx, yt1, z1 - nz], [x0 - nx, yt0, z0 - nz], [-nx / (th / 2) * 0 + dz, 0, -dx], [u0, 0, u1, 0, u1, (h + 0.4) / ts, u0, (h + 0.4) / ts]);
          q([x1 + nx, yb1, z1 + nz], [x0 + nx, yb0, z0 + nz], [x0 + nx, yt0, z0 + nz], [x1 + nx, yt1, z1 + nz], [-dz, 0, dx], [u1, 0, u0, 0, u0, (h + 0.4) / ts, u1, (h + 0.4) / ts]);
          q([x0 - nx, yt0, z0 - nz], [x1 - nx, yt1, z1 - nz], [x1 + nx, yt1, z1 + nz], [x0 + nx, yt0, z0 + nz], [0, 1, 0], [u0, 0, u1, 0, u1, 0.2, u0, 0.2]);
        }
      }
      dist += L;
    }
  }
  if (fence.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fence.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(fence.uv, 2));
    const nor = new Float32Array(fence.pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 0.3;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(fence.idx);
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d'); ctx.strokeStyle = '#8c9094'; ctx.lineWidth = 2.2;
    for (let k = -64; k < 128; k += 16) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 64, 64); ctx.stroke(); ctx.beginPath(); ctx.moveTo(k + 64, 0); ctx.lineTo(k, 64); ctx.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7, alphaToCoverage: true }));
    m.name = 'chainlink'; m.receiveShadow = true; group.add(m);
    // posts
    const pg = merge([cyl(0.04, 0.04, 1, 0, 0.5, 0, 0x5b5f63, 6)]);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.5 }), post.length);
    const mt = new THREE.Matrix4(); post.forEach((q, i) => { mt.compose(new THREE.Vector3(q[0], q[1], q[2]), new THREE.Quaternion(), new THREE.Vector3(1, q[3] + 0.1, 1)); pm.setMatrixAt(i, mt); });
    pm.frustumCulled = false; pm.castShadow = false; group.add(pm);
  }
  if (wall.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wall.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(wall.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(wall.uv, 2)); g.setIndex(wall.idx);
    const m = new THREE.Mesh(g, mats.concrete_plain); m.castShadow = true; m.receiveShadow = true; m.name = 'walls'; group.add(m);
  }
  return group;
}


// ------------------------------------------------------------------ parked cars
export function buildCars(stalls, hf) {
  const R = rng(4242);
  const body = (w, h, d, x, y, z, c) => box(w, h, d, x, y, z, c);
  const W = 0xffffff, G = 0x10161c, T = 0x111111;
  const parts = [
    body(4.5, 0.62, 1.82, 0, 0.58, 0, W),          // lower body
    body(2.55, 0.52, 1.7, -0.15, 1.15, 0, W),      // cabin
    body(2.58, 0.34, 1.74, -0.15, 1.17, 0, G),     // glass band
    body(0.9, 0.18, 1.78, 1.55, 0.92, 0, W),       // hood
  ];
  for (const sx of [-1.4, 1.4]) for (const sz of [-0.82, 0.82]) { const g = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 7); g.rotateX(Math.PI / 2); g.translate(sx, 0.34, sz); const n = g.attributes.position.count; const col = new Float32Array(n * 3).fill(0.05); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(g.toNonIndexed()); }
  const geo = merge(parts);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.25, envMapIntensity: 0.8 });
  const palette = [0xf2f2f0, 0xf2f2f0, 0xf2f2f0, 0xe9e9e6, 0x15171a, 0x15171a, 0x1c1f23, 0xb8bcc2, 0xb8bcc2, 0x8d9299, 0x5e636b, 0x1d3f7a, 0x8d1c1c, 0x2f5d3a, 0xd9c9a3, 0x6e4a2c];
  const cars = stalls.filter(() => R() < 0.58);
  const m = new THREE.InstancedMesh(geo, mat, cars.length);
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), mt = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  cars.forEach((c, i) => {
    q.setFromAxisAngle(up, -c[2] + (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.06);
    const sc = 0.92 + R() * 0.2; s.set(sc * (R() < 0.18 ? 1.12 : 1), sc * (R() < 0.15 ? 1.25 : 1), sc);
    p.set(c[0], hf.surface(c[0], c[1]) + 0.02, c[1]); mt.compose(p, q, s); m.setMatrixAt(i, mt);
    col.setHex(palette[Math.floor(R() * palette.length)]); m.setColorAt(i, col);
  });
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.name = 'cars';
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return { mesh: m, count: cars.length };
}

// ------------------------------------------------------------------ "The P": the whitewashed concrete letter on the hillside east of campus
// OSM node 767039323 (tourism=attraction) at 35.3028033, -120.6516398 -> local (887, -233). ~16 m tall, laid on the slope facing campus.
export function buildThePLetter(hf, x = 887.3, z = -233.4) {
  const h = 16, R = 4.6, s = 3.2, cx = 5.0, t = 3.0, y0 = h - 2 * R, yc = h - R;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(s, 0); shape.lineTo(s, y0); shape.lineTo(cx, y0);
  shape.absarc(cx, yc, R, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(0, h); shape.lineTo(0, 0);
  const hole = new THREE.Path();
  hole.moveTo(s, y0 + t); hole.lineTo(cx, y0 + t); hole.absarc(cx, yc, R - t, -Math.PI / 2, Math.PI / 2, false); hole.lineTo(s, h - t); hole.lineTo(s, y0 + t);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 24);
  // uphill direction from the terrain gradient; the letter's "up" points uphill, its "right" is uphill rotated +90°
  const n = hf.normalAt(x, z, 10);
  let ux = -n.x, uz = -n.z; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const rx = -uz, rz = ux;
  const pa = g.attributes.position;
  const W = cx + R;
  for (let i = 0; i < pa.count; i++) {
    const a = pa.getX(i) - W / 2, b = pa.getY(i) - h / 2;
    // letter "up" in the horizontal plane is uphill; foreshortened by the slope automatically through the terrain height
    const px = x + rx * a + ux * b * 1.25, pz = z + rz * a + uz * b * 1.25;
    pa.setXYZ(i, px, hf.surface(px, pz) + 0.3, pz);
  }
  g.computeVertexNormals();
  // make sure the faces point up
  const nrm = g.attributes.normal; let up = 0; for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
  if (up < 0) { const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; } g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.receiveShadow = true; m.name = 'the-P';
  return m;
}
