import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, pointInRing, clamp, loadPBR } from './util.js';
import { SPLAT } from './ground.js';
const TREE_R0 = Number(new URLSearchParams(location.search).get('treer') ?? 95);
const TREE_R1 = Number(new URLSearchParams(location.search).get('treer1') ?? 330);

// ------------------------------------------------------------------ occupancy (where trees must not go)
export function buildOccupancy(data, canvasA) {
  const cell = 2;
  const size = Math.round((2 * SPLAT.half) / cell);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvasA, 0, 0, size, size);
  const X = (x) => (x - SPLAT.cx + SPLAT.half) / cell;
  const Z = (z) => (z - SPLAT.cz + SPLAT.half) / cell;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.2 / cell; ctx.lineJoin = 'round';
  for (const b of data.buildings) {
    ctx.beginPath();
    for (let i = 0; i < b.p.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(b.p[i]), Z(b.p[i + 1]));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // water
  ctx.fillStyle = '#fff';
  for (const a of data.areas) {
    if (a.k !== 'water' && a.k !== 'pool' && a.k !== 'parking' && a.k !== 'plaza') continue;
    ctx.beginPath();
    for (const r of a.rings) { for (let i = 0; i < r.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(r[i]), Z(r[i + 1])); ctx.closePath(); }
    ctx.fill('evenodd');
  }
  const img = ctx.getImageData(0, 0, size, size).data;
  const grid = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) grid[i] = img[i * 4] + img[i * 4 + 1] + img[i * 4 + 2] > 110 ? 1 : 0;
  return {
    blocked(x, z) {
      const gx = Math.floor(X(x)), gz = Math.floor(Z(z));
      if (gx < 0 || gz < 0 || gx >= size || gz >= size) return false;
      return grid[gz * size + gx] === 1;
    },
    mark(x, z) { // claim a cell so other trees keep their distance
      const gx = Math.floor(X(x)), gz = Math.floor(Z(z));
      if (gx < 0 || gz < 0 || gx >= size || gz >= size) return;
      grid[gz * size + gx] = 1;
    },
  };
}

// ------------------------------------------------------------------ leaf clump textures
function leafTexture(palette, { n = 150, leaf = [10, 22], width = [5, 10], seed = 1, round = 0.46 } = {}) {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const r = rng(seed);
  const SZ = 1.6, COUNT = Math.round(n * 2.2);
  ctx.clearRect(0, 0, S, S);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < COUNT; i++) {
      const a = r() * Math.PI * 2, d = Math.min(S * 0.48, S * round * 0.52 * Math.sqrt(-2 * Math.log(Math.max(1e-4, r()))));   // gaussian falloff -> ragged, organic cluster edge
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.92;
      const l = (leaf[0] + r() * (leaf[1] - leaf[0])) * SZ, w = (width[0] + r() * (width[1] - width[0])) * SZ;
      // darker leaves first (inner), lighter highlights last (outer, upper)
      const k = pass === 0 ? r() * 0.4 : pass === 1 ? 0.3 + r() * 0.4 : 0.6 + r() * 0.4;
      const hl = (1 - y / S) * 0.35 * (pass / 2);
      // leaves toward the sparse rim of each clump are the sunlit, translucent ones: lighter, so crown silhouettes
      // end in bright foliage instead of a dark scribbled outline
      const rim = Math.pow(d / (S * 0.48), 1.5) * 0.3;
      const col = palette[Math.min(palette.length - 1, Math.floor(clamp(k * (1 - 0.5 * rim) + hl + rim, 0, 0.999) * palette.length))];
      ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI * 2);
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, l / 2, w / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  return bleedTexture(ctx.getImageData(0, 0, S, S), S);
}

// Transparent canvas pixels are black; mipmapping averaged that black into the leaf edges, which the alpha test then
// showed as dark scribbled crown outlines. Fill every transparent texel with the nearby leaf colour (alpha stays 0)
// and upload as a DataTexture so the colour survives (a 2D canvas can't hold colour at alpha 0).
function bleedTexture(img, S) {
  const d = img.data, n = S * S;
  const acc = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  let mr = 0, mg = 0, mb = 0, ma = 0;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    acc[0][i] = d[i * 4] * a; acc[1][i] = d[i * 4 + 1] * a; acc[2][i] = d[i * 4 + 2] * a; acc[3][i] = a;
    mr += acc[0][i]; mg += acc[1][i]; mb += acc[2][i]; ma += a;
  }
  const R = 10, tmp = new Float32Array(n);
  for (const A of acc) {                                    // separable box blur (wrapping, the texture repeats)
    for (let y = 0; y < S; y++) { let sum = 0; for (let k = -R; k <= R; k++) sum += A[y * S + ((k + S) % S)];
      for (let x = 0; x < S; x++) { tmp[y * S + x] = sum; sum += A[y * S + ((x + R + 1) % S)] - A[y * S + ((x - R + S) % S)]; } }
    for (let x = 0; x < S; x++) { let sum = 0; for (let k = -R; k <= R; k++) sum += tmp[((k + S) % S) * S + x];
      for (let y = 0; y < S; y++) { A[y * S + x] = sum; sum += tmp[((y + R + 1) % S) * S + x] - tmp[((y - R + S) % S) * S + x]; } }
  }
  const out = new Uint8Array(n * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = ((S - 1 - y) * S + x) * 4;      // flip rows: same orientation as the old CanvasTexture (flipY)
    const a = d[i * 4 + 3];
    if (a > 0) { out[o] = d[i * 4]; out[o + 1] = d[i * 4 + 1]; out[o + 2] = d[i * 4 + 2]; }
    else if (acc[3][i] > 1e-3) { out[o] = acc[0][i] / acc[3][i]; out[o + 1] = acc[1][i] / acc[3][i]; out[o + 2] = acc[2][i] / acc[3][i]; }
    else { out[o] = mr / ma; out[o + 1] = mg / ma; out[o + 2] = mb / ma; }
    out[o + 3] = a;
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// opaque, blotchy leaf-mass texture for the solid core inside each crown
function coreTexture(palette, seed = 1) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'); const r = rng(seed);
  ctx.fillStyle = palette[1]; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = palette[Math.floor(r() * palette.length)];
    const x = r() * S, y = r() * S, w = 5 + r() * 10, h = 3 + r() * 6, a = r() * 3.14;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { ctx.save(); ctx.translate(x + ox, y + oy); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, 6.2832); ctx.fill(); ctx.restore(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function frondTexture(seed = 3) {
  const W = 256, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); const r = rng(seed);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#3d5a22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  for (let i = 0; i < 70; i++) {
    const x = 8 + (i / 70) * (W - 16);
    const len = (H * 0.48) * (1 - Math.pow(i / 70, 2.2) * 0.8) * (0.8 + r() * 0.25);
    for (const s of [-1, 1]) {
      ctx.strokeStyle = r() < 0.5 ? '#4c7228' : '#5f8a30'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, H / 2); ctx.lineTo(x + 10, H / 2 + s * len); ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ species geometry (unit = metres for a nominal tree)
function crownGeometry({ clumps, centerY, rx, ry, rz, size, seed, shell = 0.6, cone = false, height = 1 }) {
  const r = rng(seed);
  const pos = [], nor = [], uv = [], idx = [], colArr = [];
  for (let i = 0; i < clumps; i++) {
    let px, py, pz;
    for (;;) {
      px = r() * 2 - 1; py = r() * 2 - 1; pz = r() * 2 - 1;
      const d = px * px + py * py + pz * pz;
      if (d <= 1 && d > 0.1) { const k = Math.pow(d, 0.5 - shell * 0.5) / Math.sqrt(d); px *= k * 0.0 + 1; break; }
    }
    // push outwards: renormalise radius toward shell
    const len = Math.hypot(px, py, pz) || 1;
    const rad = Math.pow(r(), 1 - shell) * 0.9 + 0.1;
    px = (px / len) * rad; py = (py / len) * rad; pz = (pz / len) * rad;
    let cx, cy, cz, sz;
    if (cone) {
      const t = r();                               // 0 bottom .. 1 top
      const rr = (1 - t) * rx * (0.55 + 0.45 * r());
      const a = r() * Math.PI * 2;
      cx = Math.cos(a) * rr; cz = Math.sin(a) * rr; cy = centerY - ry + t * 2 * ry;
      sz = size * (1 - t * 0.55);
    } else {
      cx = px * rx * 0.86; cy = centerY + py * ry * 0.9; cz = pz * rz * 0.86; sz = size * (0.8 + r() * 0.5);
    }
    // orientation: tangent to the crown surface (normal points outward), with a little jitter
    let nx = cx / Math.max(rx, 0.1) + (r() - 0.5) * 0.7, ny = Math.max(-0.25, Math.min(0.62, (cy - centerY) / Math.max(ry, 0.1) * 0.55 + 0.05 + (r() - 0.5) * 0.5)), nz = cz / Math.max(rz, 0.1) + (r() - 0.5) * 0.7;
    if (cone) { const hl = Math.hypot(cx, cz) || 1; nx = cx / hl + (r() - 0.5) * 0.4; nz = cz / hl + (r() - 0.5) * 0.4; ny = 0.28 + (r() - 0.5) * 0.35; }
    let nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // tangent basis
    let ux = ny, uy = -nx, uz = 0; let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-3) { ux = 0; uy = nz; uz = -ny; ul = Math.hypot(ux, uy, uz); }
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const rot = r() * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
    const ax = ux * cr + vx * sr, ay = uy * cr + vy * sr, az = uz * cr + vz * sr;
    const bx = -ux * sr + vx * cr, by = -uy * sr + vy * cr, bz = -uz * sr + vz * cr;
    const base = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = cx + (ax * su + bx * sv) * sz * 0.5, y = cy + (ay * su + by * sv) * sz * 0.5, z = cz + (az * su + bz * sv) * sz * 0.5;
      pos.push(x, y, z);
      { const rr = Math.hypot(x / Math.max(rx, 0.1), z / Math.max(rz, 0.1)); const hh = (y - centerY) / Math.max(ry, 0.1);
        const sh = Math.min(1, Math.max(0.58, 0.64 + 0.26 * rr + 0.24 * hh)); colArr.push(sh, sh, sh); }
      // spherical normals around the crown centre → soft, volumetric shading
      let sx = x / Math.max(rx, 0.1), sy = (y - centerY) / Math.max(ry, 0.1), sz2 = z / Math.max(rz, 0.1);
      sy += 0.25; // bias up so tops catch more light
      const l2 = Math.hypot(sx, sy, sz2) || 1; nor.push(sx / l2, sy / l2, sz2 / l2);
      uv.push((su + 1) / 2, (sv + 1) / 2);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  g.setIndex(idx);
  return g;
}

// solid, lumpy leaf mass inside the crown so the canopy never looks see-through
function coreGeometry({ centerY, rx, ry, rz, scale, detail, seed }) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const r = rng(seed); const pa = g.attributes.position; const uv = g.attributes.uv;
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < pa.count; i++) {
    let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const n = 0.86 + 0.28 * (0.5 + 0.5 * Math.sin(x * 3.1 + ph[0]) * Math.cos(y * 2.7 + ph[1]) * Math.sin(z * 3.3 + ph[2]));
    x *= n; y *= n; z *= n;
    pa.setXYZ(i, x * rx * scale, centerY + y * ry * scale, z * rz * scale);
    uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 5);
  }
  g.computeVertexNormals();
  return g;
}

// ---- clustered crowns: a crown is the union of several sub-clumps (cauliflower silhouette), with branches into each
function crownClusters({ centerY, rx, ry, rz, seed, cone }) {
  const r = rng(seed * 7 + 3);
  if (cone) return [{ x: 0, y: centerY, z: 0, r: Math.max(rx, rz), ry }];
  // tall crowns (eucalyptus): open, irregular -- many smaller clumps scattered up the height with gaps between them
  if (ry > Math.max(rx, rz) * 1.6) {
    const K = 8 + Math.floor(r() * 3);
    const cl = [{ x: 0, y: centerY + ry * 0.35, z: 0, r: Math.min(rx, rz) * 0.42, ry: ry * 0.22 }];
    for (let k = 0; k < K; k++) {
      const a = r() * Math.PI * 2, d = 0.3 + r() * 0.5;
      const yy = centerY + (-0.78 + 1.65 * (k + r() * 0.7) / K) * ry * 0.85;
      const taper = 1.0 - 0.35 * Math.max(0, (yy - centerY) / ry);              // narrower toward the top
      // flattened, wide sprays (gum foliage hangs in layered clumps) rather than round balls
      cl.push({ x: Math.cos(a) * rx * d * taper, y: yy, z: Math.sin(a) * rz * d * taper, r: Math.min(rx, rz) * (0.46 + r() * 0.26), ry: ry * (0.12 + r() * 0.08) });
    }
    return cl;
  }
  const K = 6 + Math.floor(r() * 3);
  const cl = [{ x: 0, y: centerY + ry * 0.12, z: 0, r: Math.min(rx, rz) * 0.62, ry: ry * 0.62 }];
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2 + r() * 0.6, up = -0.15 + r() * 0.75;
    const d = 0.48 + r() * 0.22;
    cl.push({ x: Math.cos(a) * rx * d, y: centerY + up * ry * 0.8, z: Math.sin(a) * rz * d, r: Math.min(rx, rz) * (0.40 + r() * 0.16), ry: ry * (0.45 + r() * 0.15) });
  }
  return cl;
}

function clusteredCrownGeometry({ clumps, centerY, rx, ry, rz, size, seed, cone }) {
  if (cone) return crownGeometry({ clumps, centerY, rx, ry, rz, size, seed, cone: true });
  const cl = crownClusters({ centerY, rx, ry, rz, seed, cone });
  const r = rng(seed);
  const tall = ry > Math.max(rx, rz) * 1.6;     // eucalyptus: cards fill each clump's volume and hang more vertically -> wispy, not balls
  const pos = [], nor = [], uv = [], idx = [], colArr = [];
  const tot = cl.reduce((s2, c) => s2 + c.r * c.r, 0);
  for (const c of cl) {
    const n = Math.max(3, Math.round(clumps * (c.r * c.r) / tot));
    for (let i = 0; i < n; i++) {
      // point on the sub-clump surface (slightly inside), biased away from the crown centre
      let dx, dy, dz; do { dx = r() * 2 - 1; dy = r() * 2 - 1; dz = r() * 2 - 1; } while (dx * dx + dy * dy + dz * dz > 1 || dx * dx + dy * dy + dz * dz < 0.05);
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const rad = tall ? 0.35 + 0.75 * r() : 0.72 + 0.28 * r();
      const cx = c.x + dx * c.r * rad, cy = c.y + dy * c.ry * rad, cz = c.z + dz * c.r * rad;
      // skip points buried inside other clumps (keeps cards on the outer skin)
      let buried = false;
      for (const o of cl) { if (o === c) continue; const q = ((cx - o.x) / o.r) ** 2 + ((cy - o.y) / o.ry) ** 2 + ((cz - o.z) / o.r) ** 2; if (q < 0.55) { buried = true; break; } }
      if (buried && r() < 0.8) continue;
      let nx = dx + (r() - 0.5) * 0.6, ny = tall ? Math.max(-0.2, Math.min(0.35, dy * 0.4 + (r() - 0.5) * 0.4)) : Math.max(-0.3, Math.min(0.7, dy * 0.7 + 0.1 + (r() - 0.5) * 0.4)), nz = dz + (r() - 0.5) * 0.6;
      let nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      let ux = ny, uy = -nx, uz = 0; let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-3) { ux = 0; uy = nz; uz = -ny; ul = Math.hypot(ux, uy, uz); }
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      const rot = r() * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
      const ax = ux * cr + vx * sr, ay = uy * cr + vy * sr, az = uz * cr + vz * sr;
      const bx = -ux * sr + vx * cr, by = -uy * sr + vy * cr, bz = -uz * sr + vz * cr;
      const sz = size * (0.75 + r() * 0.5) * (0.6 + 0.6 * c.r / Math.max(rx, rz));
      const base = pos.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = cx + (ax * su + bx * sv) * sz * 0.5, y = cy + (ay * su + by * sv) * sz * 0.5, z = cz + (az * su + bz * sv) * sz * 0.5;
        pos.push(x, y, z);
        // shading: sub-clump normal blended with crown normal; inner/lower cards darker
        const gx = x / Math.max(rx, 0.1), gy = (y - centerY) / Math.max(ry, 0.1) + 0.25, gz = z / Math.max(rz, 0.1);
        const lx = (x - c.x) / c.r, ly = (y - c.y) / c.ry + 0.2, lz = (z - c.z) / c.r;
        let mx = gx * 0.45 + lx * 0.55, my = gy * 0.45 + ly * 0.55, mz = gz * 0.45 + lz * 0.55; const ml = Math.hypot(mx, my, mz) || 1;
        nor.push(mx / ml, my / ml, mz / ml);
        const outer = Math.min(1, Math.hypot(gx, gz)); const sh = Math.min(1, Math.max(0.55, 0.6 + 0.25 * outer + 0.22 * (gy - 0.25) + 0.1 * ly));
        colArr.push(sh, sh, sh);
        uv.push((su + 1) / 2, (sv + 1) / 2);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  g.setIndex(idx);
  return g;
}

function clusteredCoreGeometry({ centerY, rx, ry, rz, scale, detail, seed, cone }) {
  if (cone) return coreGeometry({ centerY, rx, ry, rz, scale, detail, seed });
  const cl = crownClusters({ centerY, rx, ry, rz, seed: seed - 7, cone });
  const parts = cl.map((c, k) => { const g = coreGeometry({ centerY: c.y, rx: c.r, ry: c.ry, rz: c.r, scale: scale * 0.96, detail: Math.max(1, detail - (k ? 1 : 0)), seed: seed + k }); g.translate(c.x, 0, c.z); g.deleteAttribute('uv'); return g.toNonIndexed(); });
  const merged = mergeGeometries(parts.map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }), false);
  // planar uvs for the leaf-mass texture
  const pa = merged.attributes.position, uv = merged.attributes.uv;
  for (let i = 0; i < pa.count; i++) uv.setXY(i, (pa.getX(i) + pa.getZ(i)) * 0.6, pa.getY(i) * 0.6);
  return merged;
}

// trunk + limbs reaching into each sub-clump
function limbsGeometry({ centerY, rx, ry, rz, seed, trunkH, r0, r1, cone }) {
  const parts = [trunkGeometry(trunkH, r0, r1, 0.3, seed, 0)];
  if (!cone) {
    const cl = crownClusters({ centerY, rx, ry, rz, seed: seed - 7 + 0, cone });
    for (const c of cl.slice(1)) {
      const sx = 0, sy = trunkH * (0.7 + 0.2 * Math.random()), sz = 0;
      const ex = c.x * 0.75, ey = c.y - c.ry * 0.2, ez = c.z * 0.75;
      const L = Math.hypot(ex - sx, ey - sy, ez - sz);
      const g = new THREE.CylinderGeometry(r1 * 0.45, r1 * 0.85, L, 5, 1, true);
      g.translate(0, L / 2, 0);
      const dir = new THREE.Vector3(ex - sx, ey - sy, ez - sz).normalize();
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      g.translate(sx, sy, sz);
      parts.push(g.toNonIndexed());
    }
  }
  const norm = parts.map((g) => { const h = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(k)) h.deleteAttribute(k); if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2)); return h; });
  return mergeGeometries(norm, false);
}

function trunkGeometry(h, r0, r1, lean = 0, seed = 5, branches = 3) {
  const rn = rng(seed);
  const segs = 7, rad = 8;
  const pos = [], nor = [], uv = [], idx = [];
  const ring = (y, rr, ox, oz) => {
    const base = pos.length / 3;
    for (let i = 0; i <= rad; i++) {
      const a = (i / rad) * Math.PI * 2;
      pos.push(ox + Math.cos(a) * rr, y, oz + Math.sin(a) * rr);
      nor.push(Math.cos(a), 0.2, Math.sin(a)); uv.push(i / rad, y / 3);
    }
    return base;
  };
  let prev = null;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, y = t * h;
    const bend = Math.sin(t * Math.PI) * lean;
    const base = ring(y, r0 + (r1 - r0) * t, bend, bend * 0.3);
    if (prev !== null) for (let i = 0; i < rad; i++) { const a = prev + i, b = base + i; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    prev = base;
  }
  // a few stub branches
  for (let b = 0; b < branches; b++) {
    const a = rn() * Math.PI * 2, y0 = h * (0.45 + rn() * 0.4), len = h * (0.25 + rn() * 0.2);
    const base = pos.length / 3;
    const x0 = Math.sin(y0 / h * Math.PI) * lean, z0 = x0 * 0.3;
    const tipX = x0 + Math.cos(a) * len, tipY = y0 + len * 0.75, tipZ = z0 + Math.sin(a) * len;
    const rr = r1 * 0.9;
    for (let i = 0; i <= 4; i++) {
      const aa = (i / 4) * Math.PI * 2;
      pos.push(x0 + Math.cos(aa) * rr, y0, z0 + Math.sin(aa) * rr); nor.push(Math.cos(aa), 0.2, Math.sin(aa)); uv.push(i / 4, 0.1);
      pos.push(tipX + Math.cos(aa) * rr * 0.4, tipY, tipZ + Math.sin(aa) * rr * 0.4); nor.push(Math.cos(aa), 0.2, Math.sin(aa)); uv.push(i / 4, 0.4);
    }
    for (let i = 0; i < 4; i++) { const a0 = base + i * 2, a1 = a0 + 2; idx.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function palmGeometry() {
  const pos = [], nor = [], uv = [], idx = [];
  const r = rng(11);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.2;
    const len = 4.2 + r() * 1.2, droop = 0.9 + r() * 0.8;
    const base = pos.length / 3;
    const segs = 4;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const out = len * t, y = 0.55 * len * Math.sin(t * Math.PI * 0.55) - droop * t * t * len * 0.35;
      const w = 0.7 * (1 - t * 0.5);
      const cx = Math.cos(a) * out, cz = Math.sin(a) * out;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      pos.push(cx - px, y, cz - pz, cx + px, y, cz + pz);
      nor.push(0, 1, 0, 0, 1, 0);
      uv.push(t, 0, t, 1);
    }
    for (let s = 0; s < segs; s++) { const a0 = base + s * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export const FOLIAGE = [];
const _sph = new THREE.Sphere(new THREE.Vector3(), 22);
function patchFoliage(mat) {
  FOLIAGE.push(mat);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 ip = vec3(0.0);
#endif
  float sw = sin(uTime * 1.3 + ip.x * 0.37 + ip.z * 0.23 + position.y * 0.5) * 0.06 * smoothstep(1.0, 12.0, position.y);
  transformed.x += sw; transformed.z += sw * 0.7;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
      // leaf cards seen edge-on collapse into dark strokes that outline every clump: fade them out
      .replace('#include <map_fragment>', `#include <map_fragment>
  { vec3 gN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    float facing = abs(dot(gN, normalize(vViewPosition)));
    diffuseColor.a *= smoothstep(0.16, 0.42, facing); }`)
      // leaves transmit light: foliage in the crown's own shadow keeps a share of the sun's colour
      // instead of dropping to near-black (which read as dark outlines around every clump)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  #if NUM_DIR_LIGHTS > 0
    reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * vec3(0.105, 0.125, 0.07);
  #endif`);
  };
  mat.customProgramCacheKey = () => 'foliage-v3';
}

// ------------------------------------------------------------------ placement
export function buildTrees(data, hf, occ, { density = 1, detected = null, wide = null } = {}) {
  const r = rng(20260811);
  const placed = { oak: [], euc: [], conifer: [], decid: [], palm: [], shrub: [] };
  const campusKind = (x, z) => 'oak';
  const pickSpecies = (rn, ctx) => {
    if (ctx === 'wood') return rn < 0.7 ? 'oak' : rn < 0.82 ? 'euc' : rn < 0.9 ? 'decid' : 'conifer';
    if (ctx === 'hill') return 'oak';
    return rn < 0.38 ? 'oak' : rn < 0.52 ? 'euc' : rn < 0.82 ? 'decid' : rn < 0.95 ? 'conifer' : 'palm';
  };
  const addTree = (x, z, sp, scaleMul = 1) => {
    if (occ.blocked(x, z)) return false;
    const y = hf.at(x, z);
    placed[sp].push([x, y, z, scaleMul * (0.8 + r() * 0.5), r() * Math.PI * 2]);
    occ.mark(x, z);
    return true;
  };

  // 0) tree crowns detected in the USGS aerial photo (real positions + sizes), +/-2000 m
  const COV = 1990;
  const detHash = new Map();
  if (wide && wide.length) detected = (detected || []).concat(wide.filter((t, i) => t[2] > 5 && Math.abs(t[0]) < 4300 && Math.abs(t[1]) < 4300 && (i % 5) < 3));
  if (detected && detected.length) {
    const names = ['oak', 'euc', 'conifer', 'decid'];
    const nomR = { oak: 6.4, euc: 3.7, conifer: 3.0, decid: 4.5 }, nomH = { oak: 10.9, euc: 26, conifer: 14.8, decid: 10 };
    const keep = density < 0.8 ? 0.55 : 1;
    for (const t of detected) {
      const [x, z, th, tr, spi] = t;
      if (r() > keep) continue;
      if (occ.blocked(x, z)) continue;
      const hk = Math.floor(x / 8) + ',' + Math.floor(z / 8); let ha = detHash.get(hk); if (!ha) detHash.set(hk, (ha = [])); ha.push(x, z);
      const y = hf.at(x, z);
      if (th < 3.4 || tr < 1.5) { placed.shrub.push([x, y, z, clamp(tr / 1.2, 0.7, 1.6), r() * 6.28, clamp(th / 1.55, 0.6, 2.2)]); continue; }
      const sp = names[spi] || 'oak';
      const sxz = clamp(tr / nomR[sp], 0.25, 2.2);
      let sy = clamp(th / nomH[sp], 0.25, 2.4);
      sy = clamp(sy, sxz * 0.5, sxz * 2.4);
      placed[sp].push([x, y, z, sxz, r() * 6.28, sy]);
      occ.mark(x, z);
    }
  }
  const nearDet = (x, z, d = 4) => {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) { const a = detHash.get(gx + ',' + gz); if (!a) continue; for (let i = 0; i < a.length; i += 2) if (Math.hypot(a[i] - x, a[i + 1] - z) < d) return true; }
    return false;
  };
  const haveDet = detHash.size > 0;
  const inCov = (x, z) => haveDet && Math.abs(x) < COV && Math.abs(z) < COV;

  // 1) mapped trees
  for (const t of data.points.trees) {
    if (haveDet && nearDet(t[0], t[1], 5)) continue;
    const sp = t[2] === 1 ? 'conifer' : t[2] === 2 ? 'euc' : t[2] === 3 ? 'palm' : pickSpecies(r(), 'campus');
    const y = hf.at(t[0], t[1]);
    placed[sp].push([t[0], y, t[1], 0.9 + r() * 0.4, r() * Math.PI * 2]);
    occ.mark(t[0], t[1]);
  }

  // 1b) the PAC plaza plantings: a row of palms along the plaza's east edge and a column of Italian cypress
  //     south of the lawn oval, as in the aerial photos
  for (let k = 0; k < 6; k++) { const x = 431 + k * 5.2, z = 146 + k * 9.4; const y = hf.at(x, z); placed.palm.push([x, y, z, 1.0 + (k % 2) * 0.08, k * 1.7]); occ.mark(x, z); }
  for (let k = 0; k < 7; k++) {
    const a = Math.PI * (0.18 + 0.64 * k / 6), x = 430 + Math.cos(a) * 24, z = 207 + Math.sin(a) * 24; const y = hf.at(x, z);
    placed.conifer.push([x, y, z, 0.36, k * 2.1, 0.62]); occ.mark(x, z);
  }

  // 2) street + path trees
  const budget = { walk: 0, road: 0 };
  for (const rd of data.roads) {
    if (rd.k !== 'walk' && !(rd.k === 'road' && rd.hw !== 'motorway' && rd.hw !== 'trunk')) continue;
    const p = rd.p;
    let carry = r() * 10;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], z0 = p[i + 1], x1 = p[i + 2], z1 = p[i + 3];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.5) continue;
      const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
      let s = carry;
      const spacing = rd.k === 'walk' ? 13 : 16;
      while (s < L) {
        const side = r() < 0.5 ? -1 : 1;
        const off = rd.w / 2 + 2.6 + r() * 3.2;
        const x = x0 + dx * s + -dz * off * side, z = z0 + dz * s + dx * off * side;
        if (inCov(x, z) && r() < 0.9) { s += spacing * (0.7 + r() * 0.7); continue; }
        if (r() < (rd.k === 'walk' ? 0.42 : 0.55) * density) addTree(x, z, pickSpecies(r(), 'campus'), 0.9 + r() * 0.3);
        s += spacing * (0.7 + r() * 0.7);
      }
      carry = s - L;
    }
  }

  // 3) areas
  const polyArea = (ring) => { let a = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; a += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; } return Math.abs(a / 2); };
  for (const a of data.areas) {
    { const q0 = a.rings[0]; if (haveDet && q0 && inCov(q0[0], q0[1])) continue; }
    let per = 0, ctx = 'campus', scale = 1;
    switch (a.k) {
      case 'lawn': per = 650; break;
      case 'urban': per = a.lu === 'residential' ? 420 : 520; break;
      case 'wood': per = 55; ctx = 'wood'; break;
      case 'scrub': per = 160; ctx = 'wood'; scale = 0.55; break;
      case 'orchard': per = 55; scale = 0.45; break;
      case 'meadow': per = 3500; ctx = 'hill'; break;
      case 'pitch': case 'parking': per = a.k === 'parking' ? 380 : 0; break;
      default: per = 0;
    }
    if (!per) continue;
    const ring = a.rings[0];
    if (!ring || ring.length < 6) continue;
    const area = polyArea(ring);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < ring.length; i += 2) { minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]); minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]); }
    let want = Math.min(900, Math.floor((area / per) * density));
    if (a.k === 'orchard') {
      // orchard rows on a 7 m grid
      const sp = 7;
      for (let x = minX; x < maxX; x += sp) for (let z = minZ; z < maxZ; z += sp) if (pointInRing(x, z, ring) && !occ.blocked(x, z)) addTree(x + (r() - 0.5), z + (r() - 0.5), 'decid', 0.5 + r() * 0.15);
      continue;
    }
    let tries = 0;
    while (want > 0 && tries++ < want * 12) {
      const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ);
      if (!pointInRing(x, z, ring)) continue;
      if (a.rings.length > 1 && a.rings.slice(1).some((h) => pointInRing(x, z, h))) continue;
      if (addTree(x, z, pickSpecies(r(), ctx), scale * (0.85 + r() * 0.4))) want--;
    }
  }

  // 3b) foundation plantings: shrubs just outside the walkway apron of most buildings
  for (const b of data.buildings) {
    if (!['academic', 'dorm', 'church', 'retail', 'house'].includes(b.s.kind)) continue;
    const P = b.p, n = P.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = P[i * 2], z0 = P[i * 2 + 1], x1 = P[((i + 1) % n) * 2], z1 = P[((i + 1) % n) * 2 + 1];
      const L = Math.hypot(x1 - x0, z1 - z0); if (L < 5) continue;
      const nx = (z1 - z0) / L, nz = -(x1 - x0) / L;
      const off = b.s.kind === 'house' ? 1.4 : 2.5;
      for (let t = 1.5 + r() * 2.5; t < L - 1.5; t += 3 + r() * 3.5) {
        if (r() > 0.55 * density) continue;
        const x = x0 + ((x1 - x0) * t) / L + nx * off, z = z0 + ((z1 - z0) * t) / L + nz * off;
        if (occ.blocked(x, z)) continue;
        placed.shrub.push([x, hf.at(x, z), z, 0.7 + r() * 0.8, r() * 6.28]);
      }
    }
  }

  // 4) hillside live-oak savanna outside the campus core
  const sparse = (x, z, k) => {
    const n = Math.sin(x * 0.0071 + 1.3) * Math.cos(z * 0.0093 - 0.4) + Math.sin((x + z) * 0.019) * 0.5 + Math.sin(x * 0.043) * Math.cos(z * 0.037) * 0.35;
    return n > k;
  };
  for (let x = -3200; x < 3200 && !(wide && wide.length); x += 26) {
    for (let z = -3200; z < 3000; z += 26) {
      const jx = x + (r() - 0.5) * 22, jz = z + (r() - 0.5) * 22;
      if (inCov(jx, jz)) continue;
      if (!sparse(jx, jz, 0.55)) continue;
      const n = hf.normalAt(jx, jz, 8);
      if (n.y < 0.80) { if (n.y < 0.6 || r() > 0.35) continue; }
      if (r() > 0.55) continue;
      if (occ.blocked(jx, jz)) continue;
      // keep clear of the mapped campus buildings roughly
      addTree(jx, jz, r() < 0.88 ? 'oak' : 'conifer', 0.7 + r() * 0.5);
    }
  }

  // ---------- LOD instancing: near = dense cards + lumpy core, mid = fewer cards, far = a few big cards
  const group = new THREE.Group(); group.name = 'trees';
  const repeatTex = (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const oakTex = repeatTex(leafTexture(['#222c15', '#2d3a1b', '#3a4a22', '#4a5a2a', '#5b6c33', '#6f7f3d'], { seed: 3, n: 420, leaf: [5, 11], width: [3, 5.5] }));
  const eucTex = repeatTex(leafTexture(['#4b5840', '#596a4e', '#6a7b5e', '#7d8d70', '#8f9e83'], { seed: 5, n: 320, leaf: [9, 20], width: [2.6, 4.6] }));
  const conTex = repeatTex(leafTexture(['#22372a', '#2a4333', '#33503c', '#3f5f47', '#4d6f54'], { seed: 7, n: 380, leaf: [5, 10], width: [3, 5.5] }));
  const decTex = repeatTex(leafTexture(['#384a24', '#455a2a', '#556c31', '#677f3a', '#7b9145', '#90a352'], { seed: 9, n: 400, leaf: [5, 12], width: [3, 6.5] }));
  const shrubTex = repeatTex(leafTexture(['#2c3a1d', '#384a24', '#475b2c', '#5b7036', '#788a48'], { seed: 13, n: 320, leaf: [4, 9], width: [2.6, 5] }));
  oakTex.userData.core = coreTexture(['#243818', '#2d4620', '#385328', '#445f31'], 2);
  eucTex.userData.core = coreTexture(['#566449', '#62725a', '#718168', '#80906f'], 4);
  conTex.userData.core = coreTexture(['#1c2e22', '#233a2a', '#2c4733', '#36553d'], 6);
  decTex.userData.core = coreTexture(['#33492a', '#3d5731', '#486638', '#587745'], 8);
  shrubTex.userData.core = coreTexture(['#2c4023', '#36502b', '#426034', '#51713f'], 12);
  const palmTex = frondTexture();
  const barkOf = (name, tint = 0xffffff) => { const p = loadPBR(name, 4); const m = new THREE.MeshStandardMaterial({ map: p.map, normalMap: p.normalMap, color: tint, roughness: 1, side: THREE.DoubleSide }); return m; };

  const leafMatOf = (tex) => { const m = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.32, alphaToCoverage: true }); patchFoliage(m); return m; };
  const coreMatOf = (tex, k) => new THREE.MeshStandardMaterial({ map: tex.userData.core, color: new THREE.Color(k, k, k), roughness: 1, metalness: 0 });

  class SpeciesLOD {
    constructor(name, list, def) {
      this.name = name; this.n = list.length; this.def = def;
      const n = this.n;
      this.mats = new Float32Array(n * 16); this.cols = new Float32Array(n * 3); this.pos = new Float32Array(n * 3);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t[4]); const s = t[3];
        const sv = t[5] ?? s;
        sc.set(s * (0.92 + ((i * 37) % 11) / 60), sv * (0.94 + ((i * 53) % 13) / 100), s * (0.92 + ((i * 29) % 7) / 40));
        ps.set(t[0], t[1] - 0.15, t[2]); m.compose(ps, q, sc); m.toArray(this.mats, i * 16);
        this.pos[i * 3] = t[0]; this.pos[i * 3 + 1] = t[1]; this.pos[i * 3 + 2] = t[2];
        const v = 0.74 + (((i * 7919) % 100) / 100) * 0.34;
        col.setRGB(v * (0.93 + ((i * 31) % 12) / 100), v * (0.97 + ((i * 11) % 8) / 100), v * (0.86 + ((i * 17) % 16) / 100));
        this.cols[i * 3] = col.r; this.cols[i * 3 + 1] = col.g; this.cols[i * 3 + 2] = col.b;
      });
      this.tiers = def.tiers.map((tier, ti) => {
        const mk = (geo, mat, name2) => { const im = new THREE.InstancedMesh(geo, mat, n); im.count = 0; im.castShadow = ti < 2 && !(ti === 1 && name2 === 'trunk'); im.receiveShadow = true; im.frustumCulled = false; im.name = `${name}-${name2}-${ti}`; im.setColorAt(0, new THREE.Color(1, 1, 1)); group.add(im); return im; };
        return { crown: mk(tier.crown, def.leafMat, 'crown'), core: mk(tier.core, def.coreMat, 'core'), trunk: tier.trunk ? mk(tier.trunk, def.trunkMat, 'trunk') : null };
      });
    }
    update(cx, cz, R, fr) {
      const counts = [0, 0, 0];
      for (let i = 0; i < this.n; i++) {
        const dx = this.pos[i * 3] - cx, dz = this.pos[i * 3 + 2] - cz, d2 = dx * dx + dz * dz;
        if (fr && d2 > 900) { _sph.center.set(this.pos[i * 3], this.pos[i * 3 + 1] + 8, this.pos[i * 3 + 2]); if (!fr.intersectsSphere(_sph)) continue; }
        const t = d2 < R[0] * R[0] ? 0 : d2 < R[1] * R[1] ? 1 : d2 < R[2] * R[2] ? 2 : -1;
        if (t < 0) continue;
        const k = counts[t]++; const T = this.tiers[t];
        const src = this.mats.subarray(i * 16, i * 16 + 16);
        T.crown.instanceMatrix.array.set(src, k * 16); T.core.instanceMatrix.array.set(src, k * 16);
        if (T.trunk) T.trunk.instanceMatrix.array.set(src, k * 16);
        const ca = T.crown.instanceColor.array, cb = T.core.instanceColor.array;
        ca[k * 3] = cb[k * 3] = this.cols[i * 3]; ca[k * 3 + 1] = cb[k * 3 + 1] = this.cols[i * 3 + 1]; ca[k * 3 + 2] = cb[k * 3 + 2] = this.cols[i * 3 + 2];
      }
      this.tiers.forEach((T, t) => {
        for (const im of [T.crown, T.core, T.trunk]) { if (!im) continue; im.count = counts[t]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      });
    }
  }

  const geoSet = (p, nums, sizes) => nums.map((n, ti) => ({
    crown: ti === 2 ? crownGeometry({ clumps: n, centerY: p.cy, rx: p.rx, ry: p.ry, rz: p.rz, size: sizes[ti], seed: p.seed + ti, shell: p.shell ?? 0.55, cone: p.cone })
                    : clusteredCrownGeometry({ clumps: n, centerY: p.cy, rx: p.rx, ry: p.ry, rz: p.rz, size: sizes[ti], seed: p.seed, cone: p.cone }),
    core: ti === 2 ? coreGeometry({ centerY: p.cy, rx: p.rx, ry: p.ry, rz: p.rz, scale: p.core, detail: 1, seed: p.seed + 7 })
                   : clusteredCoreGeometry({ centerY: p.cy, rx: p.rx, ry: p.ry, rz: p.rz, scale: p.core, detail: ti === 0 ? 2 : 1, seed: p.seed + 7, cone: p.cone }),
    trunk: ti === 0 && p.trunk ? (p.limbs ? limbsGeometry({ centerY: p.cy, rx: p.rx, ry: p.ry, rz: p.rz, seed: p.seed + 7, trunkH: p.limbs[0], r0: p.limbs[1], r1: p.limbs[2], cone: p.cone }) : p.trunk) : (ti < 2 && p.trunk ? p.trunk : null),
  }));

  const defs = {
    oak: { p: { cy: 7.2, rx: 6.4, ry: 3.7, rz: 6.4, core: 0.72, seed: 21, trunk: trunkGeometry(7.2, 0.45, 0.22, 0.6, 4, 4), limbs: [4.2, 0.5, 0.3] }, nums: [330, 95, 12], sizes: [2.7, 4.2, 9.5], tex: oakTex, bark: barkOf('bark_oak', 0xb0a090), core: 0.95 },
    euc: { p: { cy: 17, rx: 4.2, ry: 9, rz: 4.2, core: 0.42, seed: 22, shell: 0.5, trunk: trunkGeometry(15, 0.5, 0.2, 0.4, 5, 3), limbs: [11, 0.5, 0.25] }, nums: [260, 80, 10], sizes: [2.5, 3.9, 8.5], tex: eucTex, bark: barkOf('bark_euc', 0xe0d8cc), core: 1.0 },
    conifer: { p: { cy: 8, rx: 3.0, ry: 6.8, rz: 3.0, core: 0.62, seed: 23, cone: true, trunk: trunkGeometry(3, 0.3, 0.2, 0, 6, 0) }, nums: [230, 70, 10], sizes: [2.3, 3.3, 7.5], tex: conTex, bark: barkOf('bark_pine', 0x8a7a6a), core: 0.95 },
    decid: { p: { cy: 6.6, rx: 4.5, ry: 3.4, rz: 4.5, core: 0.70, seed: 24, trunk: trunkGeometry(6, 0.35, 0.18, 0.4, 7, 3), limbs: [4.0, 0.36, 0.22] }, nums: [280, 85, 10], sizes: [2.5, 3.9, 8.6], tex: decTex, bark: barkOf('bark_light', 0xa09080), core: 0.95 },
    shrub: { p: { cy: 0.75, rx: 1.2, ry: 0.78, rz: 1.2, core: 0.74, seed: 31, trunk: null }, nums: [20, 8, 4], sizes: [1.3, 1.9, 2.8], tex: shrubTex, bark: null, core: 0.95 },
  };
  // variant B: different proportions + seed so a stand of trees doesn't look cloned
  const variantB = { oak: { rx: 5.2, ry: 4.9, rz: 6.6, cy: 6.4, seed: 61 }, euc: { rx: 3.2, ry: 10.5, rz: 3.9, cy: 18, seed: 62 }, conifer: { rx: 2.5, ry: 7.6, rz: 2.7, cy: 8.6, seed: 63 }, decid: { rx: 3.7, ry: 4.4, rz: 3.9, cy: 7.2, seed: 64 }, shrub: { rx: 1.0, ry: 0.9, rz: 1.35, cy: 0.8, seed: 65 } };
  const systems = [];
  for (const [name, d] of Object.entries(defs)) {
    const list = placed[name]; if (!list || !list.length) continue;
    const listA = list.filter((_, i) => i % 2 === 0), listB = list.filter((_, i) => i % 2 === 1);
    const mkSys = (lst, p, tag) => {
      if (!lst.length) return;
      const tiers = geoSet(p, d.nums, d.sizes);
      systems.push(new SpeciesLOD(name + tag, lst, { tiers, leafMat: leafMatOf(d.tex), coreMat: coreMatOf(d.tex, d.core), trunkMat: d.bark }));
    };
    mkSys(listA, d.p, 'A'); mkSys(listB, { ...d.p, ...variantB[name], trunk: d.p.trunk }, 'B');
  }
  // palms: crown is frond planes, trunk tall (few of them -> no LOD)
  {
    const list = placed.palm;
    if (list.length) {
      const fm = new THREE.MeshStandardMaterial({ map: palmTex, side: THREE.DoubleSide, alphaTest: 0.4, roughness: 0.8, alphaToCoverage: true });
      const crown = new THREE.InstancedMesh(palmGeometry(), fm, list.length);
      const trunk = new THREE.InstancedMesh(trunkGeometry(14, 0.42, 0.28, 0.5, 8, 0), barkOf('bark_palm', 0xc0b0a0), list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      const mc = new THREE.Matrix4();
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t[4]); const s = t[3];
        sc.set(s, s, s); ps.set(t[0], t[1] - 0.1, t[2]); m.compose(ps, q, sc); trunk.setMatrixAt(i, m);
        ps.set(t[0], t[1] + 14 * s, t[2]); mc.compose(ps, q, sc); crown.setMatrixAt(i, mc);
      });
      crown.castShadow = trunk.castShadow = true; crown.frustumCulled = trunk.frustumCulled = false;
      group.add(crown, trunk);
    }
  }
  const lastCam = [1e9, 1e9, 0, 0, 0];
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), dir = new THREE.Vector3();
  // accepts a camera (with frustum culling) or a bare position (no culling)
  const update = (camOrPos, force = false) => {
    const cam = camOrPos.isCamera ? camOrPos : null;
    const pos = cam ? cam.position : camOrPos;
    if (cam) cam.getWorldDirection(dir); else dir.set(0, 0, 0);
    const moved = Math.hypot(pos.x - lastCam[0], pos.z - lastCam[1]) >= 6;
    const turned = dir.x * lastCam[2] + dir.y * lastCam[3] + dir.z * lastCam[4] < 0.996;
    if (!force && !moved && !turned) return;
    lastCam[0] = pos.x; lastCam[1] = pos.z; lastCam[2] = dir.x; lastCam[3] = dir.y; lastCam[4] = dir.z;
    let fr = null;
    if (cam) {
      // slightly widened frustum so turning a little doesn't pop trees in at the edges
      cam.updateMatrixWorld();
      const p0 = cam.projectionMatrix.clone();
      const sx = 0.85; p0.elements[0] *= sx; p0.elements[5] *= sx;
      pm.multiplyMatrices(p0, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pm); fr = frustum;
    }
    const R = [TREE_R0, TREE_R1, 2600];                     // near tier: dense fine leaf cards (most of the tree cost)
    for (const sys of systems) sys.update(pos.x, pos.z, R, fr);
  };
  const total = Object.values(placed).reduce((s, l) => s + l.length, 0);
  return { group, total, placed, update };
}
