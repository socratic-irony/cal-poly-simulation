import * as THREE from 'three';
import { pointInRing } from './util.js';

// Sports surfaces with real-size line markings, laid over the OSM pitch polygons (draped on the terrain).
// Each polygon's minimum-area bounding box is found; a canvas texture drawn in real metres is mapped onto it.

export function obb(ring) {
  let best = null;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = ring[j * 2] - ring[i * 2], dz = ring[j * 2 + 1] - ring[i * 2 + 1], l = Math.hypot(dx, dz);
    if (l < 0.5) continue;
    const ux = dx / l, uz = dz / l;
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (let k = 0; k < n; k++) {
      const u = ring[k * 2] * ux + ring[k * 2 + 1] * uz, v = -ring[k * 2] * uz + ring[k * 2 + 1] * ux;
      a = Math.min(a, u); b = Math.max(b, u); c = Math.min(c, v); d = Math.max(d, v);
    }
    const area = (b - a) * (d - c);
    if (!best || area < best.area) best = { area, ux, uz, a, b, c, d };
  }
  if (!best) return null;
  // make "u" the long axis
  let { ux, uz, a, b, c, d } = best;
  if (b - a < d - c) { // swap axes
    [ux, uz] = [-uz, ux]; // new u = old v direction
    const na = -1e9, nb = 1e9; void na; void nb;
    let A = 1e9, B = -1e9, C = 1e9, D = -1e9;
    for (let k = 0; k < ring.length; k += 2) {
      const u = ring[k] * ux + ring[k + 1] * uz, v = -ring[k] * uz + ring[k + 1] * ux;
      A = Math.min(A, u); B = Math.max(B, u); C = Math.min(C, v); D = Math.max(D, v);
    }
    a = A; b = B; c = C; d = D;
  }
  return { ux, uz, a, b, c, d, L: b - a, W: d - c };
}

const PX = 6; // px per metre in the drawn textures

function canvasFor(L, W, scale) {
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(L * scale)); c.height = Math.max(8, Math.round(W * scale));
  return c;
}

function drawField(ctx, L, W, s, kind) {
  // kind: 'football' | 'soccer'
  const stripe = kind === 'football' ? 4.572 : 5.5;
  const base = ['#3f7a35', '#44823a'];
  const nStr = Math.ceil(L / stripe);
  for (let i = 0; i < nStr; i++) { ctx.fillStyle = base[i % 2]; ctx.fillRect(i * stripe * s, 0, stripe * s + 1, W * s); }
  ctx.strokeStyle = '#f2f2ec'; ctx.fillStyle = '#f2f2ec'; ctx.lineWidth = Math.max(1.5, 0.12 * s);
  const cx = L * s / 2, cy = W * s / 2;
  if (kind === 'football') {
    const fl = 100 * 0.9144, fw = 53.33 * 0.9144, ez = 10 * 0.9144;
    const x0 = (L - fl - 2 * ez) / 2, y0 = (W - fw) / 2;
    // end zones
    ctx.fillStyle = '#1f5a3a'; ctx.fillRect(x0 * s, y0 * s, ez * s, fw * s); ctx.fillRect((x0 + ez + fl) * s, y0 * s, ez * s, fw * s);
    ctx.strokeRect(x0 * s, y0 * s, (fl + 2 * ez) * s, fw * s);
    for (let y = 0; y <= 100; y += 5) { const x = (x0 + ez + y * 0.9144) * s; ctx.beginPath(); ctx.moveTo(x, y0 * s); ctx.lineTo(x, (y0 + fw) * s); ctx.stroke(); }
    // gold mid-field mark
    ctx.fillStyle = '#c7a02a'; ctx.beginPath(); ctx.arc(cx, cy, 5 * s, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#f2f2ec'; ctx.stroke();
  } else {
    const fl = Math.min(L - 4, 100), fw = Math.min(W - 4, 64);
    const x0 = (L - fl) / 2, y0 = (W - fw) / 2;
    ctx.strokeRect(x0 * s, y0 * s, fl * s, fw * s);
    ctx.beginPath(); ctx.moveTo(cx, y0 * s); ctx.lineTo(cx, (y0 + fw) * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 9.15 * s, 0, Math.PI * 2); ctx.stroke();
    for (const side of [0, 1]) {
      const bx = side ? (x0 + fl - 16.5) * s : x0 * s, gx = side ? (x0 + fl - 5.5) * s : x0 * s;
      ctx.strokeRect(bx, cy - 20.15 * s, 16.5 * s, 40.3 * s); ctx.strokeRect(gx, cy - 9.16 * s, 5.5 * s, 18.32 * s);
    }
  }
}

function drawTennis(ctx, L, W, s) {
  ctx.fillStyle = '#35607a'; ctx.fillRect(0, 0, L * s, W * s);
  const cl = 23.77, cw = 10.97, x0 = (L - cl) / 2, y0 = (W - cw) / 2;
  ctx.fillStyle = '#4b7f5f'; ctx.fillRect(x0 * s, y0 * s, cl * s, cw * s);
  ctx.strokeStyle = '#eef0ea'; ctx.lineWidth = Math.max(1.2, 0.07 * s);
  ctx.strokeRect(x0 * s, y0 * s, cl * s, cw * s);
  const dy = 1.37 * s; ctx.beginPath(); ctx.moveTo(x0 * s, y0 * s + dy); ctx.lineTo((x0 + cl) * s, y0 * s + dy); ctx.moveTo(x0 * s, (y0 + cw) * s - dy); ctx.lineTo((x0 + cl) * s, (y0 + cw) * s - dy); ctx.stroke();
  const sx = 6.4 * s; ctx.beginPath(); ctx.moveTo(x0 * s + sx, y0 * s + dy); ctx.lineTo(x0 * s + sx, (y0 + cw) * s - dy); ctx.moveTo((x0 + cl) * s - sx, y0 * s + dy); ctx.lineTo((x0 + cl) * s - sx, (y0 + cw) * s - dy); ctx.moveTo(x0 * s + sx, L * 0 + (y0 + cw / 2) * s); ctx.lineTo((x0 + cl) * s - sx, (y0 + cw / 2) * s); ctx.stroke();
  ctx.lineWidth = Math.max(2, 0.12 * s); ctx.strokeStyle = '#d8d8d2'; ctx.beginPath(); ctx.moveTo((x0 + cl / 2) * s, y0 * s - 0.4 * s); ctx.lineTo((x0 + cl / 2) * s, (y0 + cw) * s + 0.4 * s); ctx.stroke();
}

function drawBasketball(ctx, L, W, s) {
  ctx.fillStyle = '#6c7c88'; ctx.fillRect(0, 0, L * s, W * s);
  const cl = Math.min(L - 1, 28), cw = Math.min(W - 1, 15), x0 = (L - cl) / 2, y0 = (W - cw) / 2;
  ctx.fillStyle = '#4e6a52'; ctx.fillRect(x0 * s, y0 * s, cl * s, cw * s);
  ctx.strokeStyle = '#eceeea'; ctx.lineWidth = Math.max(1.2, 0.05 * s);
  ctx.strokeRect(x0 * s, y0 * s, cl * s, cw * s);
  ctx.beginPath(); ctx.moveTo(L * s / 2, y0 * s); ctx.lineTo(L * s / 2, (y0 + cw) * s); ctx.stroke();
  ctx.beginPath(); ctx.arc(L * s / 2, W * s / 2, 1.8 * s, 0, Math.PI * 2); ctx.stroke();
  for (const side of [0, 1]) {
    const kx = side ? (x0 + cl - 5.8) * s : x0 * s;
    ctx.strokeRect(kx, W * s / 2 - 2.45 * s, 5.8 * s, 4.9 * s);
    ctx.beginPath(); ctx.arc(side ? (x0 + cl - 1.575) * s : (x0 + 1.575) * s, W * s / 2, 6.75 * s, side ? Math.PI / 2 : -Math.PI / 2, side ? Math.PI * 1.5 : Math.PI / 2); ctx.stroke();
  }
}

function drawSand(ctx, L, W, s) {
  const g = ctx.createLinearGradient(0, 0, L * s, W * s); g.addColorStop(0, '#d9c595'); g.addColorStop(1, '#cdb883');
  ctx.fillStyle = g; ctx.fillRect(0, 0, L * s, W * s);
  for (let i = 0; i < L * W * 0.6; i++) { ctx.fillStyle = `rgba(${150 + Math.random() * 60},${130 + Math.random() * 50},${90 + Math.random() * 40},0.15)`; ctx.fillRect(Math.random() * L * s, Math.random() * W * s, 2, 2); }
  const cl = Math.min(L - 2, 16), cw = Math.min(W - 2, 8), x0 = (L - cl) / 2, y0 = (W - cw) / 2;
  ctx.strokeStyle = '#3b64a8'; ctx.lineWidth = Math.max(1.5, 0.05 * s); ctx.strokeRect(x0 * s, y0 * s, cl * s, cw * s);
  ctx.beginPath(); ctx.moveTo(L * s / 2, y0 * s); ctx.lineTo(L * s / 2, (y0 + cw) * s); ctx.stroke();
}

function drawTrack(ctx, L, W, s) {
  const stadium = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); };
  const lane = 9.76, r0 = W / 2;
  ctx.fillStyle = '#a2402f'; stadium(0, 0, L * s, W * s, r0 * s); ctx.fill();
  if (W > 2 * lane + 8) {
    ctx.fillStyle = '#3f7a35'; stadium(lane * s, lane * s, (L - 2 * lane) * s, (W - 2 * lane) * s, (r0 - lane) * s); ctx.fill();
    ctx.strokeStyle = '#f0f0ea'; ctx.lineWidth = Math.max(1, 0.05 * s);
    for (let k = 0; k <= 8; k++) { const o = (lane * k) / 8; stadium(o * s, o * s, (L - 2 * o) * s, (W - 2 * o) * s, (r0 - o) * s); ctx.stroke(); }
  }
}

function drawBaseball(ctx, L, W, s, homeAtStart, soft) {
  // grass outfield with the infield dirt/diamond at the narrow end
  ctx.fillStyle = '#4d8040'; ctx.fillRect(0, 0, L * s, W * s);
  const base = soft ? 18.29 : 27.43, hx = homeAtStart ? 6 : L - 6, dir = homeAtStart ? 1 : -1, hy = W / 2;
  const P = (x, y) => [x * s, y * s];
  const home = [hx, hy], first = [hx + dir * base * 0.7071, hy - base * 0.7071], second = [hx + dir * base * 1.4142, hy], third = [hx + dir * base * 0.7071, hy + base * 0.7071];
  ctx.fillStyle = '#b28a5c';
  ctx.beginPath(); ctx.arc(...P(hx + dir * base * 0.7071, hy), (base * 0.7071 + 5) * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a8f4a';
  ctx.beginPath(); ctx.moveTo(...P(...home)); ctx.lineTo(...P(...first)); ctx.lineTo(...P(...second)); ctx.lineTo(...P(...third)); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f0f0ea'; ctx.lineWidth = Math.max(1, 0.1 * s);
  ctx.beginPath(); ctx.moveTo(...P(...home)); ctx.lineTo(...P(hx + dir * 90, hy - 90)); ctx.moveTo(...P(...home)); ctx.lineTo(...P(hx + dir * 90, hy + 90)); ctx.stroke();
  ctx.fillStyle = '#f4f4ee'; for (const b of [first, second, third]) ctx.fillRect(b[0] * s - 0.25 * s, b[1] * s - 0.25 * s, 0.5 * s, 0.5 * s);
  ctx.fillStyle = '#b28a5c'; ctx.beginPath(); ctx.arc(...P(hx + dir * 18.4, hy), 1.2 * s, 0, Math.PI * 2); ctx.fill();
}

export function buildFields(data, hf) {
  const group = new THREE.Group(); group.name = 'fields';
  let count = 0;
  for (const a of data.areas) {
    if (a.k !== 'pitch' && a.k !== 'track') continue;
    const ring = a.rings[0]; if (!ring || ring.length < 8) continue;
    const sport = a.k === 'track' ? 'track' : (a.sport || '');
    let kind = null;
    if (/american_football/.test(sport)) kind = 'football';
    else if (/^soccer/.test(sport)) kind = 'soccer';
    else if (sport === 'tennis') kind = 'tennis';
    else if (sport === 'basketball') kind = 'basketball';
    else if (sport === 'beachvolleyball') kind = 'sand';
    else if (sport === 'track') kind = 'track';
    else if (sport === 'baseball') kind = 'baseball';
    if (!kind) continue;
    const B = obb(ring); if (!B || B.L < 6 || B.W < 4) continue;
    const s = Math.min(PX, 1024 / B.L);
    const cv = canvasFor(B.L, B.W, s); const ctx = cv.getContext('2d'); const sc = cv.width / B.L;
    if (kind === 'football' || kind === 'soccer') drawField(ctx, B.L, B.W, sc, kind);
    else if (kind === 'tennis') drawTennis(ctx, B.L, B.W, sc);
    else if (kind === 'basketball') drawBasketball(ctx, B.L, B.W, sc);
    else if (kind === 'sand') drawSand(ctx, B.L, B.W, sc);
    else if (kind === 'track') drawTrack(ctx, B.L, B.W, sc);
    else if (kind === 'baseball') {
      // home plate goes at the narrower end of the polygon
      const widthAt = (f) => { const u = B.a + f * B.L; let lo = 1e9, hi = -1e9; for (let t = 0; t < 40; t++) { const v = B.c + (t / 39) * B.W; const x = u * B.ux - v * B.uz, z = u * B.uz + v * B.ux; if (pointInRing(x, z, ring)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } return hi - lo; };
      drawBaseball(ctx, B.L, B.W, sc, widthAt(0.12) < widthAt(0.88), a.surf === 'unpaved' || B.L < 80);
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    // draped grid clipped to the polygon
    const cell = 3, nu = Math.max(1, Math.ceil(B.L / cell)), nv = Math.max(1, Math.ceil(B.W / cell));
    const pos = [], uv = [], idx = [];
    const vid = new Map();
    const vert = (i, j) => {
      const key = i + ',' + j; if (vid.has(key)) return vid.get(key);
      const u = B.a + (i / nu) * B.L, v = B.c + (j / nv) * B.W;
      const x = u * B.ux - v * B.uz, z = u * B.uz + v * B.ux;
      pos.push(x, hf.surface(x, z) + 0.04, z); uv.push(i / nu, 1 - j / nv);
      const k = pos.length / 3 - 1; vid.set(key, k); return k;
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const uc = B.a + ((i + 0.5) / nu) * B.L, vc = B.c + ((j + 0.5) / nv) * B.W;
      const xc = uc * B.ux - vc * B.uz, zc = uc * B.uz + vc * B.ux;
      if (!pointInRing(xc, zc, ring)) continue;
      const a0 = vert(i, j), a1 = vert(i + 1, j), a2 = vert(i + 1, j + 1), a3 = vert(i, j + 1);
      idx.push(a0, a2, a1, a0, a3, a2);
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
    // orientation fix: ensure +Y facing
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: kind === 'sand' ? 1 : 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
    m.receiveShadow = true; m.name = 'field-' + kind;
    group.add(m); count++;
    if (kind === 'football' || kind === 'soccer') {
      // stadium light poles at the four corners of the pitch (taller on the football field)
      a.lightPoles = [];
      for (const [fu, fv] of [[0.04, -0.12], [0.96, -0.12], [0.04, 1.12], [0.96, 1.12]]) {
        const u = B.a + fu * B.L, v = B.c + fv * B.W;
        a.lightPoles.push([u * B.ux - v * B.uz, u * B.uz + v * B.ux, kind === 'football' ? 28 : 22, Math.atan2(B.uz, B.ux)]);
      }
    }
  }
  return { group, count };
}

export function buildLightTowers(data, hf) {
  const group = new THREE.Group(); group.name = 'light-towers';
  const poleG = new THREE.CylinderGeometry(0.28, 0.45, 1, 8).translate(0, 0.5, 0);
  const bankG = new THREE.BoxGeometry(3.6, 2.6, 0.5);
  const pm = new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.7, roughness: 0.5 });
  const bm = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.4, roughness: 0.6, emissive: 0xfff2d0, emissiveIntensity: 0 });
  const poles = [];
  for (const a of data.areas) if (a.lightPoles) poles.push(...a.lightPoles);
  const P = new THREE.InstancedMesh(poleG, pm, poles.length), Bk = new THREE.InstancedMesh(bankG, bm, poles.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  poles.forEach((t, i) => {
    const y = hf.surface(t[0], t[1]);
    q.identity(); s.set(1, t[2], 1); p.set(t[0], y, t[1]); m.compose(p, q, s); P.setMatrixAt(i, m);
    q.setFromAxisAngle(up, -t[3] + Math.PI / 2); s.set(1, 1, 1); p.set(t[0], y + t[2], t[1]); m.compose(p, q, s); Bk.setMatrixAt(i, m);
  });
  P.castShadow = Bk.castShadow = true; P.frustumCulled = Bk.frustumCulled = false;
  group.add(P, Bk);
  return { group, bankMat: bm, count: poles.length };
}

// ------------------------------------------------------------------ bleachers / grandstands
export function buildBleachers(data, hf) {
  const group = new THREE.Group(); group.name = 'bleachers';
  const pos = [], nor = [], col = [], idx = [];
  const centres = [];
  for (const a of data.areas) if ((a.k === 'pitch' && /football|soccer|baseball/.test(a.sport || '')) || a.k === 'track') {
    const r = a.rings[0]; let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } centres.push([x / (r.length / 2), z / (r.length / 2)]);
  }
  const quad = (p0, p1, p2, p3, c) => {
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
    const k = pos.length / 3;
    for (const p of [p0, p1, p2, p3]) { pos.push(...p); nor.push(...n); col.push(...c); }
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const CONC = [0.62, 0.60, 0.56], SEAT = [0.50, 0.50, 0.49], TRIM = [0.82, 0.8, 0.74], ROOF = [0.60, 0.58, 0.54];
  let n = 0;
  for (const a of data.areas) {
    if (a.k !== 'bleachers') continue;
    const ring = a.rings[0]; const B = obb(ring); if (!B || B.L < 4 || B.W < 3) continue;
    let cx = 0, cz = 0; for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; } cx /= ring.length / 2; cz /= ring.length / 2;
    // direction away from the nearest pitch
    let best = null, bd = 220; for (const c of centres) { const d = Math.hypot(c[0] - cx, c[1] - cz); if (d < bd) { bd = d; best = c; } }
    const eu = [B.ux, B.uz], ev = [-B.uz, B.ux];
    let away = best ? [cx - best[0], cz - best[1]] : [0, -1];
    const al = Math.hypot(...away) || 1; away = [away[0] / al, away[1] / al];
    const du = away[0] * eu[0] + away[1] * eu[1], dv = away[0] * ev[0] + away[1] * ev[1];
    let R, S, D, Wd, O;
    const uc = (B.a + B.b) / 2, vc = (B.c + B.d) / 2;
    const toW = (u, v) => [u * eu[0] + v * ev[0], u * eu[1] + v * ev[1]];
    // rake across the SHORT side of the stand (obb's v axis); the 'away from the pitch' vector only picks which way it rises
    if (false) { R = [eu[0] * Math.sign(du), eu[1] * Math.sign(du)]; S = ev; D = B.L; Wd = B.W; const o = toW(du > 0 ? B.a : B.b, B.c); O = o; }
    else { const sg = dv >= 0 ? 1 : -1; R = [ev[0] * sg, ev[1] * sg]; S = eu; D = B.W; Wd = B.L; const o = toW(B.a, sg > 0 ? B.c : B.d); O = o; }
    const steps = Math.max(3, Math.min(42, Math.round(D / 0.82))), run = D / steps, rise = Math.min(0.42, 9 / steps);
    const base = hf.surface(cx, cz) - 0.3;
    const P = (r, s, y) => { const x = O[0] + r * R[0] + s * S[0], z = O[1] + r * R[1] + s * S[1]; return [x, y, z]; };
    for (let k = 0; k < steps; k++) {
      const r0 = k * run, r1 = (k + 1) * run, y1 = base + (k + 1) * rise;
      // seat treads: aluminium benches, with the dark-green centre sections of Spanos Stadium on the big stands
      const shade = k % 2 ? 1 : 0.9;
      if (Wd > 40) {
        const segs = [[0, 0.3, SEAT], [0.3, 0.7, [0.11, 0.30, 0.22]], [0.7, 1.0, SEAT]];
        for (const [a0, a1, col] of segs) quad(P(r0, Wd * a0, y1), P(r1, Wd * a0, y1), P(r1, Wd * a1, y1), P(r0, Wd * a1, y1), col.map((v) => v * shade));
      } else quad(P(r0, 0, y1), P(r1, 0, y1), P(r1, Wd, y1), P(r0, Wd, y1), SEAT.map((v) => v * shade));
      quad(P(r0, Wd, base - 1.5), P(r0, 0, base - 1.5), P(r0, 0, y1), P(r0, Wd, y1), CONC);                                              // riser
      quad(P(r0, 0, base - 1.5), P(r1, 0, base - 1.5), P(r1, 0, y1), P(r0, 0, y1), CONC);                                               // side S=0
      quad(P(r1, Wd, base - 1.5), P(r0, Wd, base - 1.5), P(r0, Wd, y1), P(r1, Wd, y1), CONC);                                          // side S=Wd
    }
    const top = base + steps * rise;
    quad(P(D, 0, base - 1.5), P(D, Wd, base - 1.5), P(D, Wd, top), P(D, 0, top), CONC);                                                  // back
    if (Wd > 40) {
      // two-storey press box / suites on top: tan stucco, glazed band, clay-tile hip roof (as at Alex G. Spanos Stadium)
      const w0 = Wd * 0.2, w1 = Wd * 0.8, d0 = D - 6.5, d1 = D + 0.3, yb = top - 0.2, yg = top + 1.2, yt = top + 6.4;
      const TAN = [0.80, 0.70, 0.50], GLASS = [0.07, 0.09, 0.10], TILE = [0.66, 0.31, 0.17];
      const box = (ya, yb2, col) => {
        quad(P(d0, w0, ya), P(d0, w1, ya), P(d0, w1, yb2), P(d0, w0, yb2), col);            // field-facing side
        quad(P(d1, w1, ya), P(d1, w0, ya), P(d1, w0, yb2), P(d1, w1, yb2), col);
        quad(P(d1, w0, ya), P(d0, w0, ya), P(d0, w0, yb2), P(d1, w0, yb2), col);
        quad(P(d0, w1, ya), P(d1, w1, ya), P(d1, w1, yb2), P(d0, w1, yb2), col);
      };
      box(yb, yg, TAN); box(yg, yg + 2.0, GLASS); box(yg + 2.0, yg + 2.6, TAN); box(yg + 2.6, yt - 0.9, GLASS); box(yt - 0.9, yt, TAN);
      // hip roof
      const cxm = (d0 + d1) / 2, rise = 2.2, ov = 0.8, a0 = d0 - ov, a1 = d1 + ov, b0 = w0 - ov, b1 = w1 + ov, half = (a1 - a0) / 2;
      quad(P(a0, b0, yt), P(a0, b1, yt), P(cxm, b1 - half, yt + rise), P(cxm, b0 + half, yt + rise), TILE);
      quad(P(a1, b1, yt), P(a1, b0, yt), P(cxm, b0 + half, yt + rise), P(cxm, b1 - half, yt + rise), TILE);
      quad(P(a1, b0, yt), P(a0, b0, yt), P(cxm, b0 + half, yt + rise), P(cxm, b0 + half, yt + rise), TILE);
      quad(P(a0, b1, yt), P(a1, b1, yt), P(cxm, b1 - half, yt + rise), P(cxm, b1 - half, yt + rise), TILE);
    } else if (Wd > 22) {
      const w0 = Wd * 0.3, w1 = Wd * 0.7, pb = D - 0.1, h = top + 3.2;
      quad(P(pb - 3, w0, top), P(pb - 3, w1, top), P(pb - 3, w1, h), P(pb - 3, w0, h), [0.55, 0.62, 0.7]);
      quad(P(pb - 3, w0, h), P(pb - 3, w1, h), P(pb, w1, h), P(pb, w0, h), TRIM);
      quad(P(pb - 3, w1, top), P(pb, w1, top), P(pb, w1, h), P(pb - 3, w1, h), TRIM); quad(P(pb, w0, top), P(pb - 3, w0, top), P(pb - 3, w0, h), P(pb, w0, h), TRIM);
    }
    n++;
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, envMapIntensity: 0.35, side: THREE.DoubleSide }));
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  }
  return { group, count: n };
}
