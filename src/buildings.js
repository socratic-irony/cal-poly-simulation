import * as THREE from 'three';
import { loadPBR, rng } from './util.js';
import { makeRoofMaterial, patchWallMaterial, flatNormalTexture } from './shading.js';
import { NIGHT } from './night.js';

// ---------------------------------------------------------------------------------------------
class Bucket {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.aA = []; this.aB = []; this.aC = []; this.aD = []; this.col = []; this.tint = [1, 1, 1]; this.idx = []; }
  vert(x, y, z, nx, ny, nz, u, v, a = [0, 0, 1, 1], b = [0, 0, 0, 0], c = [0, 0, 0, 0], d = [0, 0, 0, 0]) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    this.aA.push(...a); this.aB.push(...b); this.aC.push(...c); this.aD.push(...d); this.col.push(...this.tint);
    return i;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  toMesh(material, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(this.aA, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.aB, 4));
    g.setAttribute('aC', new THREE.Float32BufferAttribute(this.aC, 4));
    g.setAttribute('aD', new THREE.Float32BufferAttribute(this.aD, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true; m.receiveShadow = true; m.name = name;
    return m;
  }
}

const KIND = { none: 0, grid: 1, ribbon: 2, garage: 3, storefront: 4, ribbonHigh: 2, ribbonL: 5, curtain: 6, arch: 7 };

export function createMaterials(manifest, anisotropy = 8) {
  const mats = {};
  // photographic wall textures (sampled without visible tiling in the shader)
  const tex = (key, texName, { tint = 0xffffff, nScale = 1 } = {}) => {
    const pbr = loadPBR(texName, anisotropy);
    const m = new THREE.MeshStandardMaterial({ map: pbr.map, normalMap: pbr.normalMap, color: tint, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(nScale, nScale) });
    patchWallMaterial(m, { mode: 'tex' });
    m.userData.size = manifest[texName]?.size?.[0] ?? 2;
    mats[key] = m; return m;
  };
  for (const k of ['concrete_smooth', 'concrete_panels', 'concrete_slab', 'concrete_light']) tex(k, k, { nScale: 0.9 });
  {
    // all stucco / plaster walls share one material; the per-building colour comes from a six-entry palette in the shader
    const pbr = loadPBR('plaster_white', anisotropy);
    const m = new THREE.MeshStandardMaterial({ map: pbr.map, normalMap: pbr.normalMap, color: 0xffffff, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9) });
    patchWallMaterial(m, { mode: 'stucco', lumAvg: 0.374 });
    m.userData.size = manifest.plaster_white?.size?.[0] ?? 2; mats.stucco = m;
  }
  // fully procedural brick and metal siding (no repeating texture at all)
  const proc = (key, mode, opts) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, normalMap: flatNormalTexture() });
    patchWallMaterial(m, { mode, ...opts });
    m.userData.size = 1; mats[key] = m; return m;
  };
  proc('brick_red', 'brick', { brick: ['#9a4632', '#86402d', '#ac5a40'] });
  proc('brick_brown', 'brick', { brick: ['#7a4a36', '#683f2e', '#8c5843'] });
  proc('brick_buff', 'brick', { brick: ['#b88b5e', '#a87c52', '#c9a074'] });
  proc('brick_terracotta', 'brick', { brick: ['#b9714a', '#a8643f', '#c78258'] });   // Baker Center rainscreen
  proc('metal_silver', 'metal', { metal: '#aeb3b6' });
  proc('metal_silver_glass', 'metal', { metal: '#aeb3b6', glassReflect: 0.38 });
  proc('metal_dark', 'metal', { metal: '#4c4f52' });
  proc('metal_bronze', 'metal', { metal: '#6d6459' });
  proc('metal_red', 'metal', { metal: '#7d2e25' });
  // flat rainscreen / precast panels (Baker Center terracotta, PAC fly-tower bronze-grey)
  {
    const mk = (key, color) => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.03, normalMap: flatNormalTexture() });
      patchWallMaterial(m, { mode: 'panel', panel: color, glassReflect: key === 'terracotta_panel' ? 0.30 : 0.2 });
      m.userData.size = 1; mats[key] = m;
    };
    mk('terracotta_panel', '#b26a47');
    mk('bronze_panel', '#887d6f');
  }
  mats.rail = new THREE.MeshStandardMaterial({ color: 0x2e3238, metalness: 0.75, roughness: 0.42 });
  mats.trim = new THREE.MeshStandardMaterial({ color: 0xe6dccb, roughness: 0.75, metalness: 0 });
  // landmark detailing: PAC's red roof fascia, pale parapet coping / cast-stone banding
  mats.fascia_red = new THREE.MeshStandardMaterial({ color: 0x8b2b20, metalness: 0.35, roughness: 0.48 });
  mats.coping = new THREE.MeshStandardMaterial({ color: 0xd7d1c3, roughness: 0.8, metalness: 0 });
  {
    // clock face for the Business / Education tower (white dial, black Roman-style ticks and hands, bronze bezel)
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#6b5a3e'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2efe6'; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1d1d1d'; g.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.lineWidth = i % 3 === 0 ? 9 : 5; g.beginPath(); g.moveTo(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96); g.lineTo(128 + Math.sin(a) * (i % 3 === 0 ? 74 : 82), 128 - Math.cos(a) * (i % 3 === 0 ? 74 : 82)); g.stroke(); }
    g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(-0.9) * 52, 128 - Math.cos(-0.9) * 52); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(2.2) * 84, 128 - Math.cos(2.2) * 84); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    mats.clock = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0, alphaTest: 0.5, transparent: false });
  }
  mats.lamp = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.4, emissive: 0xffd9a0, emissiveIntensity: 0 });
  mats.lamp.onBeforeCompile = (sh) => { sh.uniforms.uNight = NIGHT; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.85, 0.62) * 6.0 * uNight;'); };
  // plain (non-facade) concrete for canopies, fences, curbs
  {
    const pbr = loadPBR('concrete_smooth', anisotropy);
    const m = new THREE.MeshStandardMaterial({ ...pbr, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) });
    m.userData.size = manifest.concrete_smooth?.size?.[0] ?? 1.5; mats.concrete_plain = m;
  }
  // roofs: procedural, always aligned with the slope
  mats.roof_clay = makeRoofMaterial('tile', '#8e3f26', '#b86a47', { seed: 1 });
  mats.roof_clay_dark = makeRoofMaterial('tile', '#6a3626', '#8c5239', { seed: 2 });
  mats.roof_grey = makeRoofMaterial('shingle', '#5a5b5e', '#7a7670', { seed: 3 });
  mats.roof_metal_silver = makeRoofMaterial('seam', '#b4babe', '#b4babe', { seed: 4 });
  mats.roof_metal_red = makeRoofMaterial('seam', '#7a2b22', '#7a2b22', { seed: 5 });
  mats.roof_metal_blue = makeRoofMaterial('seam', '#3f6f9e', '#3f6f9e', { seed: 9, side: THREE.FrontSide });
  mats.roof_flat = makeRoofMaterial('flat', '#aeb0ac', '#8c8f8c', { seed: 6, side: THREE.FrontSide });
  mats.roof_flat_b = makeRoofMaterial('flat', '#6c6d6b', '#52534f', { seed: 7, side: THREE.FrontSide });
  mats.roof_flat_c = makeRoofMaterial('flat', '#8a7a66', '#6e6253', { seed: 8, side: THREE.FrontSide });
  for (const k of Object.keys(mats)) if (k.startsWith('roof_')) mats[k].userData.size = 1;
  mats.metal_silver_roof = mats.roof_metal_silver;
  // glass house
  mats.glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6df, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  mats.glass.userData.size = 2;
  return mats;
}

// ---------------------------------------------------------------------------------------------
// Roof material / shape / colour chosen from the real USGS aerial photo (median colour inside each footprint).
const LUT = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

function roofClass(rf) {
  if (!rf) return null;
  const [R, G, B, , gi] = rf;
  const hsv = rgb2hsv(R, G, B);
  const lumS = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
  const veg = gi > 15 || (hsv.h > 70 && hsv.h < 170 && hsv.s > 0.18);
  if (veg) return null;
  if ((hsv.h <= 38 || hsv.h >= 346) && hsv.s >= 0.24 && hsv.v >= 0.22) return 'tile';
  return (hsv.s < 0.14 && lumS > 0.60) ? 'white' : lumS < 0.27 ? 'dark' : (hsv.h >= 24 && hsv.h <= 62 && hsv.s >= 0.15) ? 'tan' : 'grey';
}

function applyRoof(b, s, rf, mats, r01) {
  const [R, G, B, , gi] = rf;
  const hsv = rgb2hsv(R, G, B);
  const lumS = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
  const tall = s.h > 13;
  const veg = gi > 15 || (hsv.h > 70 && hsv.h < 170 && hsv.s > 0.18);       // sample is tree canopy / lawn, not a roof
  const reddish = !veg && (hsv.h <= 38 || hsv.h >= 346) && hsv.s >= 0.24 && hsv.v >= 0.22;
  let cls = null;
  if (!veg) cls = reddish ? 'tile' : (hsv.s < 0.14 && lumS > 0.60) ? 'white' : lumS < 0.27 ? 'dark' : (hsv.h >= 24 && hsv.h <= 62 && hsv.s >= 0.15) ? 'tan' : 'grey';
  s._cls = cls;
  if (!cls) return;
  const kind = s.kind;
  const bldg = ['academic', 'dorm', 'church', 'retail'].includes(kind);
  let matKey = s.roofMat === 'metal_silver' ? 'roof_metal_silver' : s.roofMat === 'metal_red' ? 'roof_metal_red' : s.roofMat;
  if (s._lidarShape) {
    // shape is measured (LiDAR); the photo only decides the covering + colour
    if (s.roof !== 'flat') {
      if (s.roofMat === 'metal_red') { matKey = 'roof_metal_red'; }
      else if (cls === 'tile') { matKey = lumS < 0.36 ? 'roof_clay_dark' : 'roof_clay'; s.roofMat = matKey; s.eave = s.eave > 0.5 ? s.eave : (kind === 'house' ? 0.55 : 0.8); }
      else if (kind === 'ag' || kind === 'shed' || kind === 'garage' || (cls === 'white' && kind !== 'house')) { matKey = 'roof_metal_silver'; s.roofMat = 'metal_silver'; }
      else { matKey = 'roof_grey'; s.roofMat = 'roof_grey'; }
    } else { matKey = cls === 'dark' ? 'roof_flat_b' : (cls === 'tan' || cls === 'tile') ? 'roof_flat_c' : 'roof_flat'; s.flatMat = matKey; }
  } else if (cls === 'tile' && (bldg || kind === 'house') && !tall) {
    if (b.holes) { s.roof = 'flat'; s.flatMat = 'roof_flat_c'; matKey = 'roof_flat_c'; s.parapet = Math.max(s.parapet || 0, 0.5); }
    else if (b.rects && b.a < 5200) { s.roof = s.roof === 'gable' ? 'gable' : 'hip'; s.pitch = Math.min(s.pitch || 0.4, 0.42); s.parapet = 0; s.eave = s.eave > 0.5 ? s.eave : (kind === 'house' ? 0.55 : 0.8); matKey = lumS < 0.36 ? 'roof_clay_dark' : 'roof_clay'; s.roofMat = matKey; }
    else if (b.a < 3500) { s.roof = 'hipPoly'; s.pitch = 0.36; s.parapet = 0; matKey = lumS < 0.36 ? 'roof_clay_dark' : 'roof_clay'; s.roofMat = matKey; }
  } else if (cls !== 'tile') {
    if (bldg && !tall && (s.roof === 'hip' || s.roof === 'gable' || s.roof === 'hipPoly')) { s.roof = 'flat'; s.parapet = Math.max(s.parapet || 0, 0.55); }
    if (kind === 'house' && !tall) { if (s.roof === 'flat' && b.rects) s.roof = 'hip'; s.roofMat = 'roof_grey'; matKey = 'roof_grey'; }
    if (s.roof === 'flat' || s.roof === undefined) {
      matKey = cls === 'dark' ? 'roof_flat_b' : cls === 'tan' ? 'roof_flat_c' : 'roof_flat';
      s.flatMat = matKey;
    }
    if (kind === 'ag' || kind === 'shed') { matKey = (cls === 'dark' || lumS < 0.33) ? 'roof_metal_silver' : 'roof_metal_silver'; s.roofMat = 'metal_silver'; }
  }
  if (s.roof === 'flat' && !s.flatMat) { matKey = cls === 'dark' ? 'roof_flat_b' : cls === 'tan' ? 'roof_flat_c' : 'roof_flat'; s.flatMat = matKey; }
  if (s.roof === 'flat') matKey = s.flatMat || matKey;
  // colour: ratio between the photographed roof and the material's nominal albedo
  const nom = (mats[matKey] && mats[matKey].userData.nominal) || [0.3, 0.3, 0.3];
  const tgt = [LUT[R | 0], LUT[G | 0], LUT[B | 0]];
  const jit = (0.94 + 0.12 * r01) * 1.32;
  let t = tgt.map((v, i) => Math.min(2.8, Math.max(0.3, (v / nom[i]) * jit)));
  const k = tall ? 0.45 : 0.9;                                       // tall buildings: roof samples are displaced -> trust less
  t = t.map((v) => 1 + (v - 1) * k);
  s._tint = t; s._roofKey = matKey;
}

// ---------------------------------------------------------------------------------------------
function makePathIndex(data) {
  const cell = 24, grid = new Map();
  const add = (x, z) => { const k = Math.floor(x / cell) + ',' + Math.floor(z / cell); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(x, z); };
  for (const r of data.roads) {
    if (r.k !== 'walk' && r.k !== 'road') continue;
    if (r.hw === 'motorway' || r.hw === 'trunk' || r.hw === 'motorway_link') continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); const n = Math.max(1, Math.ceil(L / 3));
      for (let s = 0; s <= n; s++) add(p[i] + ((p[i + 2] - p[i]) * s) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * s) / n);
    }
  }
  return (x, z, maxd = 30) => {
    let best = Infinity; const R = Math.ceil(maxd / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let gx = cx - R; gx <= cx + R; gx++) for (let gz = cz - R; gz <= cz + R; gz++) {
      const a = grid.get(gx + ',' + gz); if (!a) continue;
      for (let i = 0; i < a.length; i += 2) { const d = Math.hypot(a[i] - x, a[i + 1] - z); if (d < best) best = d; }
    }
    return best;
  };
}

export function buildBuildings(data, hf, mats, roofs, lidar) {
  const pathDist = makePathIndex(data);
  const buckets = new Map();
  const bucket = (key) => { if (!buckets.has(key)) buckets.set(key, new Bucket()); return buckets.get(key); };
  const colliders = [];
  const info = [];
  const doors = [];
  const signs = [];

  const bandFlag = (st) => st.stone ? 2 : st.panel ? 3 : st.belt ? 1 : 0;
  const roofKey = (s) => {
    if (s.roofMat === 'metal_silver') return 'roof_metal_silver';
    if (s.roofMat === 'metal_red') return 'roof_metal_red';
    return s.roofMat;
  };

  // grandstands are modelled by the bleacher generator; drop OSM building outlines that just trace the stands
  const stands = data.areas.filter((a) => a.k === 'bleachers').map((a) => a.rings[0]);
  const inStand = (x, z) => stands.some((r) => pointInsideRing(x, z, r));
  for (const b of data.buildings) {
    const s = b.s;
    const P = b.p;
    { let cx0 = 0, cz0 = 0; const n0 = P.length / 2; for (let i = 0; i < n0; i++) { cx0 += P[i * 2]; cz0 += P[i * 2 + 1]; } cx0 /= n0; cz0 /= n0;
      if (stands.length && inStand(cx0, cz0) && !/press|box|suite/i.test(b.n || '')) continue; }
    const n = P.length / 2;
    if (n < 3) continue;

    // ground sampling
    let gMin = Infinity, gSum = 0;
    for (let i = 0; i < n; i++) {
      const g = hf.at(P[i * 2], P[i * 2 + 1]);
      gMin = Math.min(gMin, g); gSum += g;
    }
    let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += P[i * 2]; cz += P[i * 2 + 1]; } cx /= n; cz /= n;
    const gC = hf.at(cx, cz);
    let pad = (gSum / n * 0.6 + gC * 0.4) + 0.12;
    // ---- measured height / roof shape from the 2018 USGS LiDAR survey
    const lb = lidar && lidar[b.id];
    const useL = lb && lb.h != null && lb.cov > 0.35 && !s.noLidar;
    if (lb && lb.g != null) pad = lb.g + 0.04;
    const aerCls = roofClass(roofs && roofs[b.id]);
    if (useL) {
      // parking structures: the sloped ramps measure as a pitched roof, but the top deck is flat
      if (s.kind === 'garage' && lb.flat === 0) { lb.flat = 1; lb.tiers = null; lb.h = Math.max(lb.h, lb.peave ?? lb.h, (lb.p90 ?? lb.h) - 1.2); }
      s.h = Math.max(2.4, lb.h);
      // a clay-tile roof is always pitched, even where part of the footprint measures flat
      if (lb.flat === 1 && aerCls === 'tile' && (lb.pfrac || 0) > 0.12 && lb.pmed && ['academic', 'dorm', 'church', 'retail', 'house'].includes(s.kind)) {
        lb.flat = 0; lb.pitch = lb.pmed; lb.tiers = null;
        s.h = Math.max(2.4, lb.peave ?? lb.h);
      }
      // big non-tile buildings that measure as 'sloped' (vaults, sawtooth, stepped masses): stacked flat tiers instead of one huge hip roof
      if (lb.flat === 0 && aerCls !== 'tile' && b.a > 2500 && lb.tiers2) { lb.flat = 1; lb.tiers = lb.tiers2; s.h = Math.max(2.4, lb.h2); }
      else if (lb.flat === 0 && lb.peave != null && lb.peave > 2) s.h = Math.max(2.4, Math.min(s.h, lb.peave + 0.6));
      s.floors = Math.max(1, Math.round(s.h / s.floorH));
      // floor height that divides the measured height evenly (keeps the top row of windows whole)
      if (s.kind !== 'ag' && s.kind !== 'shed' && s.kind !== 'garage') s.floorH = Math.min(5.2, Math.max(2.9, (s.h - 0.4) / s.floors));
      if (s.kind !== 'greenhouse' && s.kind !== 'canopy') {
        if (lb.flat === 0) { s.roof = (s.roof === 'gable' || (lb.endfrac != null && lb.endfrac < 0.07 && b.rects && b.rects.length <= 3)) ? 'gable' : (lb.endfrac != null && lb.endfrac > 0.12 && b.rects ? 'hip' : (b.rects ? (s.roof === 'gable' ? 'gable' : 'hip') : (b.holes ? 'flat' : 'hipPoly'))); s.pitch = Math.min(0.9, Math.max(0.18, lb.pitch)); s.parapet = 0; }
        else { s.roof = 'flat'; s.parapet = s.kind === 'house' || s.kind === 'shed' ? 0.15 : (s.parapet > 0 && s.parapet < 0.3 ? s.parapet : Math.max(s.parapet || 0, 0.45)); }
        s._lidarShape = true;
      }
    }
    // landmark massing overrides (post-2018 buildings / bespoke roof forms)
    if (s.forceH) { s.h = s.forceH; s.floors = Math.max(1, Math.round(s.h / s.floorH)); }
    if (s.noTiers && lb) { lb.tiers = null; lb.vaults = null; }
    const yBot = Math.min(gMin, pad) - 1.0;
    const vaults = (useL && lb.vaults) || [];
    // volumes that replace the flat-roof logic locally (vaults, tile wings): no tiers / rooftop units inside them
    const blockers = vaults.map((vt) => [vt.c[0], vt.c[1], vt.ang, vt.L / 2, vt.W / 2]);
    if (useL && lb.wings && b.rects) for (const w of lb.wings) { const r = b.rects[w[0]]; if (r) blockers.push([r[0], r[1], r[4], r[2], r[3]]); }
    const inVault = (x, z, m = 1) => blockers.some(([bx, bz, ang, hl, hw2]) => { const dx = x - bx, dz = z - bz, ca = Math.cos(ang), sa = Math.sin(ang);
      return Math.abs(dx * ca + dz * sa) < hl + m && Math.abs(-dx * sa + dz * ca) < hw2 + m; });
    const rnd0 = rng((b.id >>> 0) ^ 0x5bd1e995)();
    if (roofs && roofs[b.id]) applyRoof(b, s, roofs[b.id], mats, rnd0);
    if (s.flatForce) { s.flatMat = s.flatForce; s._tint = [1, 1, 1]; }
    const wallKey = /^(stucco|plaster)/.test(s.wall) ? 'stucco' : s.wall;
    const wallMat = mats[wallKey] || mats.stucco;
    const ts = wallMat.userData.size || 2;
    const isGlass = wallKey === 'glass';
    const rnd = rng(b.id >>> 0);
    let seed = rnd() * 0.96;
    if (s.frame === 'green') seed = 0.985;

    const hasPoly = s.roof === 'hipPoly';
    const hasPitched = ((s.roof === 'hip' || s.roof === 'gable') && b.rects) || hasPoly;
    const flat = !hasPitched;
    // clay-tile wings measured on an otherwise flat building (tools/lidar_wings.py): no parapet, it would poke through their eaves
    const wings = (useL && flat && lb.wings && b.rects) ? lb.wings.filter((w) => b.rects[w[0]]) : [];
    if (wings.length) s.parapet = Math.min(s.parapet || 0, 0.05);
    const wallTop = pad + s.h;
    const yTop = wallTop + (flat ? s.parapet : 0);
    const kind = KIND[s.win] ?? 1;
    const wb = bucket(isGlass ? 'glass' : wallKey);
    const rb = bucket(hasPitched ? roofKey(s) : (s.flatMat || (seed < 0.5 ? 'roof_flat' : seed < 0.8 ? 'roof_flat_b' : 'roof_flat_c')));
    rb.tint = s._tint || [1, 1, 1];   // flat roofs: orthophoto colour where valid, this median tint elsewhere
    const spBase = s.winSpacing || 3.6;

    // ---- entrance: the long edge closest to a walkway or street
    let doorEdge = -1, doorU = 0;
    if (['academic', 'dorm', 'retail', 'church'].includes(s.kind) && b.a > 180) {
      let bestD = 30;
      for (let i = 0; i < n; i++) {
        const px = P[i * 2], pz = P[i * 2 + 1], qx = P[((i + 1) % n) * 2], qz = P[((i + 1) % n) * 2 + 1];
        const len = Math.hypot(qx - px, qz - pz); if (len < 7) continue;
        const nx = (qz - pz) / len, nz = -(qx - px) / len;
        const mx = (px + qx) / 2 + nx * 4, mz = (pz + qz) / 2 + nz * 4;
        if (pointInsideRing(mx, mz, P)) continue;           // inner courtyards etc.
        const d = pathDist(mx, mz, 30) - len * 0.02;
        if (d < bestD) { bestD = d; doorEdge = i; }
      }
      if (doorEdge >= 0) { const i = doorEdge; const len = Math.hypot(P[((i + 1) % n) * 2] - P[i * 2], P[((i + 1) % n) * 2 + 1] - P[i * 2 + 1]); doorU = len * (0.38 + 0.24 * rnd()); }
    }

    // ---- smoothed vertex normals so gently curved facades shade as curves, not facets
    const enorm = [];
    for (let i = 0; i < n; i++) {
      const px = P[i * 2], pz = P[i * 2 + 1], qx = P[((i + 1) % n) * 2], qz = P[((i + 1) % n) * 2 + 1];
      const l = Math.hypot(qx - px, qz - pz) || 1;
      enorm.push([(qz - pz) / l, -(qx - px) / l]);
    }
    const smoothN = (e, nb) => { const a0 = enorm[e], b0 = enorm[nb]; if (a0[0] * b0[0] + a0[1] * b0[1] > 0.90) { const x = a0[0] + b0[0], z = a0[1] + b0[1], l = Math.hypot(x, z) || 1; return [x / l, z / l]; } return a0; };

    // ---- exterior walls
    for (let i = 0; i < n; i++) {
      const p = [P[i * 2], P[i * 2 + 1]];
      const q = [P[((i + 1) % n) * 2], P[((i + 1) % n) * 2 + 1]];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = dz / len, nz = -dx / len;
      const nS = smoothN(i, (i + n - 1) % n), nE = smoothN(i, (i + 1) % n);
      const cols = Math.max(1, Math.round(len / spBase));
      const sp = len / cols;
      const ek = len < s.winW + 0.9 ? 0 : kind;
      const hasDoor = i === doorEdge;
      const acc = s.accent === 'red' ? 1 : s.accent === 'green' ? 2 : 0;
      const A = [0, pad, sp, s.floorH], B = [s.winW, s.winH, ek, seed], C = [s.h, acc, hasDoor ? doorU : 0, hasDoor ? 1.15 : 0], D = [bandFlag(s), (s.trim ? 1 : 0) + (s.lites ? 2 : 0), s.recess ?? 0.18, (s.pal || 0) / 7];
      const ux = dx / len, uz = dz / len, ang = Math.atan2(dz, dx);
      if (hasDoor && b.n && ['academic', 'dorm', 'church', 'retail'].includes(s.kind)) {
        const big = b.a > 650 || s.floors >= 3;
        signs.push({ x: p[0] + ux * doorU, z: p[1] + uz * doorU, ux, uz, nx, nz, y: pad + (big ? 3.32 : 3.65), out: big ? 0.45 : 0.03, name: b.n });
      }
      if (hasDoor && s.arcade && len > 8) { doors.push([p[0] + ux * doorU + nx * 3.5, p[1] + uz * doorU + nz * 3.5]); }
      else if (hasDoor && s.atrium) {
        doors.push([p[0] + ux * doorU + nx * (s.atrium.d + 1.2), p[1] + uz * doorU + nz * (s.atrium.d + 1.2)]);
      }
      else if (hasDoor) {
        if (b.a > 650 || s.floors >= 3) {
          addPortal(bucket(wallKey), bucket('concrete_plain'), bucket('rail'), { p, ux, uz, nx, nz, doorU, pad, wallH: s.h, ang, pal: s.pal || 0, seed });
          doors.push([p[0] + ux * doorU + nx * 3.2, p[1] + uz * doorU + nz * 3.2]);
        } else {
          const cwid = 3.4, cdep = 1.7;
          const mx = p[0] + ux * doorU + nx * cdep / 2, mz = p[1] + uz * doorU + nz * cdep / 2;
          addBox(bucket('concrete_plain'), mx, pad + 3.05, mz, cwid, 0.26, cdep, ang, 1.6);
          doors.push([p[0] + ux * doorU + nx * (cdep + 0.8), p[1] + uz * doorU + nz * (cdep + 0.8)]);
        }
      }
      // vertical concrete fins (e.g. the Pilling Building) at every bay boundary
      if (s.fins && len > 6) {
        const fb = bucket('concrete_light');
        for (let k = 0; k < cols; k++) {
          const off = k * sp;
          addBox(fb, p[0] + ux * off + nx * 0.2, pad - 0.1, p[1] + uz * off + nz * 0.2, 0.30, s.h + 0.9, 0.44, ang, 1.6, [[0, pad, 1, 1], [0, 0, 0, seed], [0, 0, 0, 0], [0, 0, 0, 0]]);
        }
      }
      // ---- colonnade: ground storey pulled back behind square piers
      const arc = s.arcade && len > 8 && (hasDoor || pathDist(p[0] + ux * len / 2 + nx * 6, p[1] + uz * len / 2 + nz * 6, 25) < 18) ? s.arcade : null;
      let wallFrom = yBot;
      if (arc) {
        const yA = pad + arc.h, d0 = arc.d;
        wallFrom = yA;
        const ip = [p[0] - nx * d0, p[1] - nz * d0], iq = [q[0] - nx * d0, q[1] - nz * d0];
        const Bg = [s.winW, s.winH, 4, seed], Cg = [arc.h + 0.3, 0, hasDoor ? doorU : 0, hasDoor ? 1.15 : 0];
        const g0 = wb.vert(ip[0], yBot, ip[1], nx, 0, nz, 0, yBot / ts, [0, pad, sp, s.floorH], Bg, Cg, D);
        const g1 = wb.vert(iq[0], yBot, iq[1], nx, 0, nz, len / ts, yBot / ts, [len, pad, sp, s.floorH], Bg, Cg, D);
        const g2 = wb.vert(iq[0], yA, iq[1], nx, 0, nz, len / ts, yA / ts, [len, pad, sp, s.floorH], Bg, Cg, D);
        const g3 = wb.vert(ip[0], yA, ip[1], nx, 0, nz, 0, yA / ts, [0, pad, sp, s.floorH], Bg, Cg, D);
        wb.tri(g1, g0, g3); wb.tri(g1, g3, g2);
        // soffit
        const cb = bucket('concrete_plain');
        const s0 = cb.vert(p[0], yA, p[1], 0, -1, 0, 0, 0), s1 = cb.vert(q[0], yA, q[1], 0, -1, 0, len, 0), s2 = cb.vert(iq[0], yA, iq[1], 0, -1, 0, len, d0), s3 = cb.vert(ip[0], yA, ip[1], 0, -1, 0, 0, d0);
        const syy = (q[0] - p[0]) * (ip[1] - p[1]) - (q[1] - p[1]) * (ip[0] - p[0]);
        if (syy > 0) { cb.tri(s0, s1, s2); cb.tri(s0, s2, s3); } else { cb.tri(s0, s2, s1); cb.tri(s0, s3, s2); }
        // end returns closing the recess
        for (const [e0, e1, sg] of [[p, ip, -1], [q, iq, 1]]) {
          const rx = ux * sg, rz = uz * sg;
          const r0 = wb.vert(e0[0], yBot, e0[1], rx, 0, rz, 0, 0, [0, pad, 1, s.floorH], [0, 0, 0, seed], [arc.h, 0, 0, 0], D);
          const r1 = wb.vert(e1[0], yBot, e1[1], rx, 0, rz, d0 / ts, 0, [d0, pad, 1, s.floorH], [0, 0, 0, seed], [arc.h, 0, 0, 0], D);
          const r2 = wb.vert(e1[0], yA, e1[1], rx, 0, rz, d0 / ts, 1, [d0, pad, 1, s.floorH], [0, 0, 0, seed], [arc.h, 0, 0, 0], D);
          const r3 = wb.vert(e0[0], yA, e0[1], rx, 0, rz, 0, 1, [0, pad, 1, s.floorH], [0, 0, 0, seed], [arc.h, 0, 0, 0], D);
          // winding: (r1-r0) x (r3-r0) should point along (rx, rz)
          const ax = e1[0] - e0[0], az = e1[1] - e0[1];
          const nxw = az * 1 - 0, nzw = -(ax * 1);                         // (a x up) = (az, 0, -ax)
          if (nxw * rx + nzw * rz < 0) { wb.tri(r0, r1, r2); wb.tri(r0, r2, r3); } else { wb.tri(r0, r2, r1); wb.tri(r0, r3, r2); }
        }
        // piers
        const nP = Math.max(2, Math.round(len / arc.sp) + 1);
        const pa = [[0, pad, 1, 1], [0, 0, 0, seed], [arc.h, 0, 0, 0], [D[0], 0, 0.1, D[3]]];
        for (let k = 0; k < nP; k++) {
          const t = (k / (nP - 1)) * (len - arc.w) + arc.w / 2;
          addBox(wb, p[0] + ux * t - nx * arc.w / 2, yBot, p[1] + uz * t - nz * arc.w / 2, arc.w, yA - yBot, arc.w, ang, ts, pa);
        }
      }
      if (hasPitched && len > 6 && s.kind !== 'greenhouse') {
        const nDs = Math.max(2, Math.round(len / 16) + 1);
        const dsb = bucket('rail');
        for (let k = 0; k < nDs; k++) {
          const t = 0.35 + (k / (nDs - 1)) * (len - 0.7);
          if (hasDoor && Math.abs(t - doorU) < 2.2) continue;
          const dx0 = p[0] + ux * t + nx * 0.09, dz0 = p[1] + uz * t + nz * 0.09;
          const yG = Math.min(pad, hf.surface(dx0 + nx * 0.3, dz0 + nz * 0.3)) - 0.05;
          addBox(dsb, dx0, yG, dz0, 0.09, pad + s.h + 0.05 - yG, 0.09, ang, 1);
          addBox(dsb, p[0] + ux * t + nx * 0.2, yG, p[1] + uz * t + nz * 0.2, 0.1, 0.12, 0.32, ang, 1);   // splash shoe
        }
      }
      // wall lights beside the entrance
      if (hasDoor && !(s.arcade && len > 8)) {
        for (const sg of [-1, 1]) {
          const t = doorU + sg * 1.9;
          addBox(bucket('lamp'), p[0] + ux * t + nx * 0.08, pad + 2.55, p[1] + uz * t + nz * 0.08, 0.18, 0.32, 0.16, ang, 1);
        }
      }
      // brick ground storey (Poly Canyon Village): a separate quad in the brick material, the stucco starts above it
      if (s.brickBase && !arc && s.h > s.floorH * 1.5) {
        const yB = pad + s.floorH, bb = bucket('brick_red');
        const Db = [0, 0, D[2], D[3]];
        const b0 = bb.vert(p[0], wallFrom, p[1], nS[0], 0, nS[1], 0, 0, [0, pad, sp, s.floorH], B, C, Db);
        const b1 = bb.vert(q[0], wallFrom, q[1], nE[0], 0, nE[1], len, 0, [len, pad, sp, s.floorH], B, C, Db);
        const b2 = bb.vert(q[0], yB, q[1], nE[0], 0, nE[1], len, 1, [len, pad, sp, s.floorH], B, C, Db);
        const b3 = bb.vert(p[0], yB, p[1], nS[0], 0, nS[1], 0, 1, [0, pad, sp, s.floorH], B, C, Db);
        bb.tri(b1, b0, b3); bb.tri(b1, b3, b2);
        // cast-stone course on top of the brick
        addBox(bucket('concrete_plain'), (p[0] + q[0]) / 2 + nx * 0.06, yB - 0.1, (p[1] + q[1]) / 2 + nz * 0.06, len + 0.12, 0.28, 0.16, ang, 1.6);
        wallFrom = yB;
      }
      // walls running along a measured vault volume (the Rec Center gyms) take the vault's cladding, without windows
      const onV = s.vaultWall && vaults.some((vt) => { const mx = (p[0] + q[0]) / 2 - vt.c[0], mz = (p[1] + q[1]) / 2 - vt.c[1], ca = Math.cos(vt.ang), sa = Math.sin(vt.ang);
        const u = Math.abs(mx * ca + mz * sa), v = Math.abs(-mx * sa + mz * ca); return u <= vt.L / 2 + 3 && v <= vt.W / 2 + 3 && (u >= vt.L / 2 - 3 || v >= vt.W / 2 - 3); });
      const wE = onV ? bucket(s.vaultWall) : wb, tE = onV ? (mats[s.vaultWall]?.userData.size || 1) : ts;
      const BE = onV ? [s.winW, s.winH, 0, seed] : B, CE = onV ? [s.h, 0, 0, 0] : C;
      const v0 = wE.vert(p[0], wallFrom, p[1], nS[0], 0, nS[1], 0, wallFrom / tE, [0, pad, sp, s.floorH], BE, CE, D);
      const v1 = wE.vert(q[0], wallFrom, q[1], nE[0], 0, nE[1], len / tE, wallFrom / tE, [len, pad, sp, s.floorH], BE, CE, D);
      const v2 = wE.vert(q[0], yTop, q[1], nE[0], 0, nE[1], len / tE, yTop / tE, [len, pad, sp, s.floorH], BE, CE, D);
      const v3 = wE.vert(p[0], yTop, p[1], nS[0], 0, nS[1], 0, yTop / tE, [0, pad, sp, s.floorH], BE, CE, D);
      wE.tri(v1, v0, v3); wE.tri(v1, v3, v2);
    }

    // ---- projecting glazed entry atrium (Baker / Frost / PAC) on the chosen entrance bay
    if (s.atrium && doorEdge >= 0) {
      const i = doorEdge;
      const p = [P[i * 2], P[i * 2 + 1]], q = [P[((i + 1) % n) * 2], P[((i + 1) % n) * 2 + 1]];
      const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len, nx = dz / len, nz = -dx / len;
      addAtrium(bucket, wallKey, mats, s, p, ux, uz, nx, nz, doorU, pad, seed, ts, s.pal || 0, Math.atan2(dz, dx));
    }
    if (s.drum && doorEdge >= 0) {
      const i = doorEdge;
      const p = [P[i * 2], P[i * 2 + 1]], q = [P[((i + 1) % n) * 2], P[((i + 1) % n) * 2 + 1]];
      const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len, nx = dz / len, nz = -dx / len;
      addDrum(bucket, wallKey, mats, s, p, ux, uz, nx, nz, doorU, pad, seed, ts, s.pal || 0);
    }

    // ---- roofs
    if (flat) {
      const contour = []; for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(P[i * 2], P[i * 2 + 1]));
      const holes = (b.holes || []).map((h) => { const r = []; for (let i = 0; i < h.length; i += 2) r.push(new THREE.Vector2(h[i], h[i + 1])); return r; });
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { tris = []; }
      const all = contour.concat(...holes);
      const rts = 1;
      const base = rb.pos.length / 3;
      for (const v of all) rb.vert(v.x, wallTop + 0.02, v.y, 0, 1, 0, v.x / rts, v.y / rts);
      for (const t of tris) {
        const a = all[t[0]], bb = all[t[1]], c = all[t[2]];
        const cr = (bb.x - a.x) * (c.y - a.y) - (bb.y - a.y) * (c.x - a.x); // (b-a)x(c-a) in x,z plane; +y normal when this is negative
        if (cr < 0) rb.tri(base + t[0], base + t[1], base + t[2]); else rb.tri(base + t[0], base + t[2], base + t[1]);
      }
      // parapet inner faces
      if (s.parapet > 0.05) {
        const pw = bucket(isGlass ? 'glass' : wallKey);
        for (let i = 0; i < n; i++) {
          const p = [P[i * 2], P[i * 2 + 1]], q = [P[((i + 1) % n) * 2], P[((i + 1) % n) * 2 + 1]];
          const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
          if (len < 0.05) continue;
          const nx = -dz / len, nz = dx / len; // inward
          const y0 = wallTop, y1 = yTop;
          const v0 = pw.vert(p[0], y0, p[1], nx, 0, nz, 0, y0 / ts);
          const v1 = pw.vert(q[0], y0, q[1], nx, 0, nz, len / ts, y0 / ts);
          const v2 = pw.vert(q[0], y1, q[1], nx, 0, nz, len / ts, y1 / ts);
          const v3 = pw.vert(p[0], y1, p[1], nx, 0, nz, 0, y1 / ts);
          pw.tri(v0, v1, v2); pw.tri(v0, v2, v3);
        }
      }
      // crisp parapet coping + coloured fascia band (PAC red eaves, Baker / Frost pale coping)
      if (s.coping) addEdgeBand(bucket('coping'), P, yTop + 0.01, 0.13, 0.52, 0, 1);
      if (s.fascia) addEdgeBand(bucket(s.fascia), P, yTop - 0.55, 0.34, 0.17, 0.07, 1);
      // rooftop equipment measured by LiDAR (HVAC units, stair/elevator penthouses)
      if (useL && lb.units && lb.units.length) {
        for (const u of lb.units) {
          const [ux0, uz0, uw, ud, ua, uh, ub] = u;
          if (inVault(ux0, uz0)) continue;
          const big = uw * ud > 22;
          const key = big ? 'concrete_light' : 'metal_silver';
          addBox(bucket(key), ux0, pad + ub - 0.05, uz0, Math.max(0.6, uw - 0.15), Math.max(0.4, uh), Math.max(0.6, ud - 0.15), ua, big ? 1.8 : 1.1,
            big ? [[0, pad + ub, 1, 3.4], [0, 0, 0, seed], [uh + ub, 0, 0, 0], [0, 0, 0.1, 0]] : undefined);
        }
      } else if (s.kind !== 'house' && b.a > 350 && !useL) {
        const mb = bucket('metal_silver');
        const count = Math.min(6, Math.floor(b.a / 700) + 1);
        let tries = 0, placed = 0;
        const minX = Math.min(...P.filter((_, i) => i % 2 === 0)), maxX = Math.max(...P.filter((_, i) => i % 2 === 0));
        const minZ = Math.min(...P.filter((_, i) => i % 2 === 1)), maxZ = Math.max(...P.filter((_, i) => i % 2 === 1));
        while (placed < count && tries++ < 40) {
          const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
          if (!insideRing(x, z, P)) continue;
          // keep clear of the edges
          if (!insideRing(x + 3, z, P) || !insideRing(x - 3, z, P) || !insideRing(x, z + 3, P) || !insideRing(x, z - 3, P)) continue;
          const w = 1.6 + rnd() * 2.6, d = 1.4 + rnd() * 2.2, h = 0.9 + rnd() * 1.1;
          addBox(mb, x, wallTop + 0.02, z, w, h, d, rnd() * Math.PI, 1.1);
          placed++;
        }
      }
    } else {
      const o = s.roofMat && s.roofMat.startsWith('metal') ? 0.3 : (s.eave ?? 0.55);
      if (hasPoly) addPolyRoof(rb, P, wallTop, s, b.a, bucket('trim'));
      else for (const r of b.rects) addPitchedRoof(rb, wb, r, wallTop, s, o, ts, wallKey, bucket('trim'));
    }

    // ---- bespoke swept airfoil roof (PAC): a large wing over the glass base
    if (flat && s.airfoil) addAirfoilRoof(bucket('roof_metal_silver'), bucket('fascia_red'), bucket('metal_silver'), P, wallTop + (s.parapet || 0) + (s.airfoil.lift || 0), s.airfoil);

    // ---- big flat sun canopy floating above the roof on slim posts (Engineering IV group)
    if (s.canopy && flat) {
      const tierTop = (useL && lb.tiers) ? Math.max(s.h, ...lb.tiers.map((t) => t.h)) : s.h;
      const yC = pad + tierTop + 2.8, off = 1.6, m = n;
      const ring = [];
      for (let i = 0; i < m; i++) {
        const p0 = [P[((i + m - 1) % m) * 2], P[((i + m - 1) % m) * 2 + 1]], p1 = [P[i * 2], P[i * 2 + 1]], p2 = [P[((i + 1) % m) * 2], P[((i + 1) % m) * 2 + 1]];
        const d0 = [p1[0] - p0[0], p1[1] - p0[1]], d1 = [p2[0] - p1[0], p2[1] - p1[1]];
        const l0 = Math.hypot(...d0) || 1, l1 = Math.hypot(...d1) || 1;
        const n0 = [d0[1] / l0, -d0[0] / l0], n1 = [d1[1] / l1, -d1[0] / l1];
        const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
        ring.push(new THREE.Vector2(p1[0] + (n0[0] + n1[0]) / Math.max(k, 0.5) * off, p1[1] + (n0[1] + n1[1]) / Math.max(k, 0.5) * off));
      }
      let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(ring, []); } catch (e) { tris = []; }
      const cb = bucket('trim');
      for (const [yy, ny] of [[yC + 0.25, 1], [yC, -1]]) {
        const base = cb.pos.length / 3;
        for (const v of ring) cb.vert(v.x, yy, v.y, 0, ny, 0, v.x, v.y);
        for (const t of tris) {
          const a0 = ring[t[0]], b0 = ring[t[1]], c0 = ring[t[2]];
          const cr = (b0.x - a0.x) * (c0.y - a0.y) - (b0.y - a0.y) * (c0.x - a0.x);
          if ((cr < 0) === (ny > 0)) cb.tri(base + t[0], base + t[1], base + t[2]); else cb.tri(base + t[0], base + t[2], base + t[1]);
        }
      }
      for (let i = 0; i < m; i++) {               // fascia + posts at the corners
        const a0 = ring[i], b0 = ring[(i + 1) % m]; const L = Math.hypot(b0.x - a0.x, b0.y - a0.y); if (L < 0.5) continue;
        addBox(cb, (a0.x + b0.x) / 2, yC, (a0.y + b0.y) / 2, L, 0.25, 0.12, Math.atan2(b0.y - a0.y, b0.x - a0.x), 1);
        if (L > 8) addBox(bucket('rail'), P[i * 2], pad + s.h, P[i * 2 + 1], 0.22, yC - pad - s.h, 0.22, 0, 1);
      }
    }

    // ---- taller parts measured by LiDAR (stair towers, upper storeys, fly towers ...) stacked on the base volume
    let topH = s.h;
    if (useL && lb.tiers && flat && !s.noTiers) {
      const tiers = lb.tiers.slice().sort((a, b2) => a.h - b2.h);
      let prevH = s.h;
      for (const t of tiers) {
        if (t.h < prevH + 1.2) continue;
        for (const ring0 of t.rings) {
          let ring = ring0;
          { let rx = 0, rz = 0; const rn = ring.length / 2; for (let i = 0; i < ring.length; i += 2) { rx += ring[i]; rz += ring[i + 1]; } if (inVault(rx / rn, rz / rn, -1)) continue; }
          let ar = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; ar += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
          if (ar < 0) { const rr = []; for (let i = ring.length - 2; i >= 0; i -= 2) rr.push(ring[i], ring[i + 1]); ring = rr; }
          emitPrism(ring, pad + prevH - 0.06, pad + t.h, t.h, !!s.tierBlank);
        }
        prevH = t.h; topH = Math.max(topH, t.h);
      }
    }
    // ---- curved / sloped roof volumes measured by LiDAR (barrel-vaulted gyms, hangars, curved shed roofs):
    //      the measured cross-section swept along the volume's axis, with end and side walls following it
    if (flat && vaults.length) {
      for (const vt of vaults) {
        const ca = Math.cos(vt.ang), sa = Math.sin(vt.ang), e1 = [ca, sa], e2 = [-sa, ca];
        const hl = vt.L / 2, hw = vt.W / 2, pr = vt.prof, NS = pr.length, st = vt.W / NS;
        const to = (u, v) => [vt.c[0] + u * e1[0] + v * e2[0], vt.c[1] + u * e1[1] + v * e2[1]];
        const vs = [-hw], hs = [pr[0] - (pr[1] - pr[0]) * 0.5];
        for (let j = 0; j < NS; j++) { vs.push(-hw + (j + 0.5) * st); hs.push(pr[j]); }
        vs.push(hw); hs.push(pr[NS - 1] + (pr[NS - 1] - pr[NS - 2]) * 0.5);
        // densify with a Catmull-Rom pass so the vault reads as a smooth curve, not 13 facets
        const V = [], Y = [];
        for (let k = 0; k < vs.length - 1; k++) {
          const h0 = hs[Math.max(0, k - 1)], h1 = hs[k], h2 = hs[k + 1], h3 = hs[Math.min(hs.length - 1, k + 2)];
          const sub = k === 0 || k === vs.length - 2 ? 1 : 3;
          for (let q = 0; q < sub; q++) {
            const t = q / sub, t2 = t * t, t3 = t2 * t;
            V.push(vs[k] + (vs[k + 1] - vs[k]) * t);
            Y.push(pad + Math.max(s.h + 0.3, 0.5 * (2 * h1 + (-h0 + h2) * t + (2 * h0 - 5 * h1 + 4 * h2 - h3) * t2 + (-h0 + 3 * h1 - 3 * h2 + h3) * t3)));
          }
        }
        V.push(vs[vs.length - 1]); Y.push(pad + Math.max(s.h + 0.3, hs[hs.length - 1]));
        const M = V.length;
        const nrm = V.map((_, k) => { const k0 = Math.max(0, k - 1), k1 = Math.min(M - 1, k + 1); const dv = V[k1] - V[k0], dy = Y[k1] - Y[k0], l = Math.hypot(dv, dy) || 1; return [-dy / l, dv / l]; });
        const arc = [0]; for (let k = 1; k < M; k++) arc.push(arc[k - 1] + Math.hypot(V[k] - V[k - 1], Y[k] - Y[k - 1]));
        const vbk = bucket(s.vaultRoof || (aerCls === 'tile' ? 'roof_clay' : 'roof_metal_silver'));
        const keepT = vbk.tint; vbk.tint = [1, 1, 1];
        const o = 0.35;                                             // small overhang at the eaves and ends
        const base = vbk.pos.length / 3;
        for (let k = 0; k < M; k++) {
          const vv = V[k] + (k === 0 ? -o : k === M - 1 ? o : 0);
          for (const u of [-hl - o, hl + o]) {
            const p = to(u, vv);
            vbk.vert(p[0], Y[k], p[1], nrm[k][0] * e2[0], nrm[k][1], nrm[k][0] * e2[1], u + hl, arc[k]);
          }
        }
        for (let k = 0; k < M - 1; k++) { const a0 = base + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3; vbk.tri(a0, b0, b1); vbk.tri(a0, b1, a1); }
        vbk.tint = keepT;
        // walls: down to the ground in their own cladding (Rec Center gym box), else from the main roof up
        const toG = !!s.vaultGround;
        const vw = s.vaultWall ? bucket(s.vaultWall) : wb, vts = s.vaultWall ? (mats[s.vaultWall]?.userData.size || 1) : ts;
        const yW0 = toG ? yBot : pad + s.h - 0.06, off = toG ? 0.12 : 0;
        const Dv = [0, 0, 0.1, (s.pal || 0) / 7], Bv = [0, 0, 0, seed], Cv = [s.h, 0, 0, 0];
        for (const sg of [-1, 1]) {
          const nx = e1[0] * sg, nz = e1[1] * sg;
          for (let k = 0; k < M - 1; k++) {
            const pA = to(sg * (hl + off), V[k]), pB = to(sg * (hl + off), V[k + 1]);
            const uA = (V[k] + hw), uB = (V[k + 1] + hw);
            const i0 = vw.vert(pA[0], yW0, pA[1], nx, 0, nz, uA / vts, yW0 / vts, [uA, pad, 4, s.floorH], Bv, Cv, Dv);
            const i1 = vw.vert(pB[0], yW0, pB[1], nx, 0, nz, uB / vts, yW0 / vts, [uB, pad, 4, s.floorH], Bv, Cv, Dv);
            const i2 = vw.vert(pB[0], Y[k + 1], pB[1], nx, 0, nz, uB / vts, Y[k + 1] / vts, [uB, pad, 4, s.floorH], Bv, Cv, Dv);
            const i3 = vw.vert(pA[0], Y[k], pA[1], nx, 0, nz, uA / vts, Y[k] / vts, [uA, pad, 4, s.floorH], Bv, Cv, Dv);
            // (pB - pA) runs along +e2, so (i0, i1, i2) faces -e1: outward on the -u end
            if (sg < 0) { vw.tri(i0, i1, i2); vw.tri(i0, i2, i3); } else { vw.tri(i0, i2, i1); vw.tri(i0, i3, i2); }
          }
        }
        for (const sg of [-1, 1]) {
          const nx = e2[0] * sg, nz = e2[1] * sg, k = sg < 0 ? 0 : M - 1;
          const pA = to(-hl, V[k] + sg * off), pB = to(hl, V[k] + sg * off);
          const i0 = vw.vert(pA[0], yW0, pA[1], nx, 0, nz, 0, yW0 / vts, [0, pad, 4, s.floorH], Bv, Cv, Dv);
          const i1 = vw.vert(pB[0], yW0, pB[1], nx, 0, nz, vt.L / vts, yW0 / vts, [vt.L, pad, 4, s.floorH], Bv, Cv, Dv);
          const i2 = vw.vert(pB[0], Y[k], pB[1], nx, 0, nz, vt.L / vts, Y[k] / vts, [vt.L, pad, 4, s.floorH], Bv, Cv, Dv);
          const i3 = vw.vert(pA[0], Y[k], pA[1], nx, 0, nz, 0, Y[k] / vts, [0, pad, 4, s.floorH], Bv, Cv, Dv);
          if (sg > 0) { vw.tri(i0, i1, i2); vw.tri(i0, i2, i3); } else { vw.tri(i0, i2, i1); vw.tri(i0, i3, i2); }   // (pB - pA) along +e1: faces +e2
        }
        topH = Math.max(topH, Math.max(...pr));
      }
    }
    // ---- clay-tile wings: walls up to the measured eave, then a hipped / gabled tile roof over the wing's rectangle
    for (const [k, eave, ridge, pitch, gable, dark] of wings) {
      const r = b.rects[k]; const [rcx, rcz, rhw, rhd, rang] = r;
      const yE = pad + Math.max(eave, s.h);
      const ca = Math.cos(rang), sa = Math.sin(rang);
      const corner = (u, v) => [rcx + u * ca - v * sa, rcz + u * sa + v * ca];
      const ring = [...corner(-rhw, -rhd), ...corner(rhw, -rhd), ...corner(rhw, rhd), ...corner(-rhw, rhd)];
      if (yE > wallTop + 0.3) {
        const m = 4;
        for (let i = 0; i < m; i++) {
          const p = [ring[i * 2], ring[i * 2 + 1]], q = [ring[((i + 1) % m) * 2], ring[((i + 1) % m) * 2 + 1]];
          const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz); if (len < 0.5) continue;
          let nx = dz / len, nz = -dx / len;
          const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
          if ((mx - rcx) * nx + (mz - rcz) * nz < 0) { nx = -nx; nz = -nz; }   // outward
          const cols = Math.max(1, Math.round(len / spBase)), sp = len / cols, ek = len < s.winW + 0.9 ? 0 : kind;
          const Bw = [s.winW, s.winH, ek, seed], Cw = [Math.max(eave, s.h), 0, 0, 0], Dw = [bandFlag(s), (s.trim ? 1 : 0) + (s.lites ? 2 : 0), s.recess ?? 0.18, (s.pal || 0) / 7];
          const y0 = wallTop - 0.06;
          const v0 = wb.vert(p[0], y0, p[1], nx, 0, nz, 0, y0 / ts, [0, pad, sp, s.floorH], Bw, Cw, Dw);
          const v1 = wb.vert(q[0], y0, q[1], nx, 0, nz, len / ts, y0 / ts, [len, pad, sp, s.floorH], Bw, Cw, Dw);
          const v2 = wb.vert(q[0], yE, q[1], nx, 0, nz, len / ts, yE / ts, [len, pad, sp, s.floorH], Bw, Cw, Dw);
          const v3 = wb.vert(p[0], yE, p[1], nx, 0, nz, 0, yE / ts, [0, pad, sp, s.floorH], Bw, Cw, Dw);
          // winding by geometry: (v1 - v0) x (v3 - v0) must point along the outward normal
          if (dz * nx * 1 - dx * nz * 1 > 0) { wb.tri(v1, v0, v3); wb.tri(v1, v3, v2); } else { wb.tri(v0, v1, v2); wb.tri(v0, v2, v3); }
        }
      }
      const wk = dark ? 'roof_clay_dark' : 'roof_clay', tb = bucket(wk), keepT = tb.tint; tb.tint = [1, 1, 1];
      const sW = { ...s, roof: gable ? 'gable' : 'hip', pitch: Math.min(0.7, Math.max(0.25, pitch)), roofMat: wk, eave: 0.6 };
      addPitchedRoof(tb, wb, r, yE, sW, 0.6, ts, wallKey, bucket('trim'));
      tb.tint = keepT;
      topH = Math.max(topH, Math.max(eave, s.h) + Math.min(rhw, rhd) * sW.pitch);
    }
    // ---- towers measured by LiDAR (clock / stair towers) rising above the roof: walls up to the eave + pyramid or flat top
    if (useL && lb.towers) {
      for (const tw of lb.towers) {
        if (tw.eave < s.h + 1.5) continue;
        const ca = Math.cos(tw.ang), sa = Math.sin(tw.ang);
        const pyr = tw.top - tw.eave > 0.8;
        const hw2 = Math.max(1.8, tw.w / 2 - (pyr ? 0.5 : 0.1)), hd2 = Math.max(1.8, tw.d / 2 - (pyr ? 0.5 : 0.1));   // LiDAR outline includes the eaves
        const C = (u, v) => [tw.c[0] + u * ca - v * sa, tw.c[1] + u * sa + v * ca];
        const ring = [C(-hw2, -hd2), C(hw2, -hd2), C(hw2, hd2), C(-hw2, hd2)];
        const y0 = wallTop - 0.3, yE = pad + tw.eave;
        const Dt = [bandFlag(s), (s.trim ? 1 : 0) + (s.lites ? 2 : 0), s.recess ?? 0.18, (s.pal || 0) / 7];
        for (let i = 0; i < 4; i++) {
          const p = ring[i], q = ring[(i + 1) % 4];
          const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
          let nx = dz / len, nz = -dx / len;
          const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
          if ((mx - tw.c[0]) * nx + (mz - tw.c[1]) * nz < 0) { nx = -nx; nz = -nz; }
          const Bt = [Math.min(1.1, s.winW), Math.min(1.5, s.winH), len > 3.2 ? 1 : 0, seed], Ct = [tw.eave, 0, 0, 0];
          const v0 = wb.vert(p[0], y0, p[1], nx, 0, nz, 0, y0 / ts, [0, pad, len / Math.max(1, Math.round(len / 3.2)), 3.6], Bt, Ct, Dt);
          const v1 = wb.vert(q[0], y0, q[1], nx, 0, nz, len / ts, y0 / ts, [len, pad, len / Math.max(1, Math.round(len / 3.2)), 3.6], Bt, Ct, Dt);
          const v2 = wb.vert(q[0], yE, q[1], nx, 0, nz, len / ts, yE / ts, [len, pad, len / Math.max(1, Math.round(len / 3.2)), 3.6], Bt, Ct, Dt);
          const v3 = wb.vert(p[0], yE, p[1], nx, 0, nz, 0, yE / ts, [0, pad, len / Math.max(1, Math.round(len / 3.2)), 3.6], Bt, Ct, Dt);
          if (dz * nx - dx * nz > 0) { wb.tri(v1, v0, v3); wb.tri(v1, v3, v2); } else { wb.tri(v0, v1, v2); wb.tri(v0, v2, v3); }
          if (s.clock) {                                   // clock face high on each side
            const cb = bucket('clock'), R = Math.min(1.25, len * 0.3), cy = yE - R - 0.9, ux = dx / len, uz = dz / len, o = 0.06;
            const cxm = mx + nx * o, czm = mz + nz * o;
            const k0 = cb.vert(cxm - ux * R, cy - R, czm - uz * R, nx, 0, nz, 0, 0), k1 = cb.vert(cxm + ux * R, cy - R, czm + uz * R, nx, 0, nz, 1, 0);
            const k2 = cb.vert(cxm + ux * R, cy + R, czm + uz * R, nx, 0, nz, 1, 1), k3 = cb.vert(cxm - ux * R, cy + R, czm - uz * R, nx, 0, nz, 0, 1);
            if (dz * nx - dx * nz > 0) { cb.tri(k1, k0, k3); cb.tri(k1, k3, k2); } else { cb.tri(k0, k1, k2); cb.tri(k0, k2, k3); }
          }
        }
        const tile = tw.tile != null ? !!tw.tile : aerCls === 'tile';       // the tower's own roof colour in the aerial
        if (pyr) {
          const rk = tile ? 'roof_clay' : 'roof_grey', tb = bucket(rk), keepT = tb.tint; tb.tint = [1, 1, 1];
          const o = 0.55, ew = hw2 + o, ed = hd2 + o, yEa = yE - 0.15;
          const E = [C(-ew, -ed), C(ew, -ed), C(ew, ed), C(-ew, ed)], apex = [tw.c[0], pad + tw.top, tw.c[1]];
          for (let i = 0; i < 4; i++) {
            const a3 = [E[i][0], yEa, E[i][1]], b3 = [E[(i + 1) % 4][0], yEa, E[(i + 1) % 4][1]];
            const ex = b3[0] - a3[0], ez = b3[2] - a3[2], el = Math.hypot(ex, ez);
            let nx = (b3[1] - a3[1]) * (apex[2] - a3[2]) - (b3[2] - a3[2]) * (apex[1] - a3[1]);
            let ny = (b3[2] - a3[2]) * (apex[0] - a3[0]) - (b3[0] - a3[0]) * (apex[2] - a3[2]);
            let nz = (b3[0] - a3[0]) * (apex[1] - a3[1]) - (b3[1] - a3[1]) * (apex[0] - a3[0]);
            const flip = ny < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; } const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
            const slopeLen = Math.hypot((a3[0] + b3[0]) / 2 - apex[0], yEa - apex[1], (a3[2] + b3[2]) / 2 - apex[2]);
            const i0 = tb.vert(a3[0], a3[1], a3[2], nx, ny, nz, 0, 0), i1 = tb.vert(b3[0], b3[1], b3[2], nx, ny, nz, el, 0), i2 = tb.vert(apex[0], apex[1], apex[2], nx, ny, nz, el / 2, slopeLen);
            if (!flip) tb.tri(i0, i1, i2); else tb.tri(i0, i2, i1);
          }
          tb.tint = keepT;
        } else {
          const contour = ring.map((pt) => new THREE.Vector2(pt[0], pt[1]));
          const base = rb.pos.length / 3;
          for (const v of contour) rb.vert(v.x, yE + 0.02, v.y, 0, 1, 0, v.x, v.y);
          const cr = (contour[1].x - contour[0].x) * (contour[2].y - contour[0].y) - (contour[1].y - contour[0].y) * (contour[2].x - contour[0].x);
          if (cr < 0) { rb.tri(base, base + 1, base + 2); rb.tri(base, base + 2, base + 3); } else { rb.tri(base, base + 2, base + 1); rb.tri(base, base + 3, base + 2); }
        }
        topH = Math.max(topH, tw.top);
      }
    }
    function emitPrism(R2, y0, y1, topRel, blank = false) {
      const m = R2.length / 2, par = 0.45;
      const tw = (blank && s.tierWall) ? bucket(s.tierWall) : wb;
      const tts = (blank && s.tierWall) ? (mats[s.tierWall]?.userData.size || ts) : ts;
      for (let i = 0; i < m; i++) {
        const p = [R2[i * 2], R2[i * 2 + 1]], q = [R2[((i + 1) % m) * 2], R2[((i + 1) % m) * 2 + 1]];
        const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const nx = dz / len, nz = -dx / len;
        const cols = Math.max(1, Math.round(len / spBase)), sp = len / cols;
        const ek = blank ? 0 : (len < s.winW + 0.9 ? 0 : kind);
        const B = [s.winW, s.winH, ek, seed], C = [topRel, 0, 0, 0], D = [(blank && s.tierPanel) ? 3 : bandFlag(s), (s.trim ? 1 : 0) + (s.lites ? 2 : 0), s.recess ?? 0.18, (s.pal || 0) / 7];
        const v0 = tw.vert(p[0], y0, p[1], nx, 0, nz, 0, y0 / tts, [0, pad, sp, s.floorH], B, C, D);
        const v1 = tw.vert(q[0], y0, q[1], nx, 0, nz, len / tts, y0 / tts, [len, pad, sp, s.floorH], B, C, D);
        const v2 = tw.vert(q[0], y1 + par, q[1], nx, 0, nz, len / tts, (y1 + par) / tts, [len, pad, sp, s.floorH], B, C, D);
        const v3 = tw.vert(p[0], y1 + par, p[1], nx, 0, nz, 0, (y1 + par) / tts, [0, pad, sp, s.floorH], B, C, D);
        tw.tri(v1, v0, v3); tw.tri(v1, v3, v2);
        // parapet inner face
        const w0 = tw.vert(p[0], y1, p[1], -nx, 0, -nz, 0, y1 / tts), w1 = tw.vert(q[0], y1, q[1], -nx, 0, -nz, len / tts, y1 / tts);
        const w2 = tw.vert(q[0], y1 + par, q[1], -nx, 0, -nz, len / tts, (y1 + par) / tts), w3 = tw.vert(p[0], y1 + par, p[1], -nx, 0, -nz, 0, (y1 + par) / tts);
        tw.tri(w0, w1, w2); tw.tri(w0, w2, w3);
      }
      // coloured fascia just below the upper-storey parapet + pale coping on top
      if (s.fascia) addEdgeBand(bucket(s.fascia), R2, y1 + par - 0.55, 0.34, 0.17, 0.07, 1);
      if (s.coping) addEdgeBand(bucket('coping'), R2, y1 + par + 0.01, 0.13, 0.52, 0, 1);
      if (s.curvedCap) addCurvedCap(rb, R2, y1 + par, s.curvedCap, 1);
      else {
        const contour = []; for (let i = 0; i < m; i++) contour.push(new THREE.Vector2(R2[i * 2], R2[i * 2 + 1]));
        let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
        const base = rb.pos.length / 3;
        for (const v of contour) rb.vert(v.x, y1 + 0.02, v.y, 0, 1, 0, v.x, v.y);
        for (const t of tris) {
          const a = contour[t[0]], bb = contour[t[1]], c = contour[t[2]];
          const cr = (bb.x - a.x) * (c.y - a.y) - (bb.y - a.y) * (c.x - a.x);
          if (cr < 0) rb.tri(base + t[0], base + t[1], base + t[2]); else rb.tri(base + t[0], base + t[2], base + t[1]);
        }
      }
    }

    colliders.push({ id: b.id, p: P, top: pad + topH + 4, base: yBot, name: b.n, kind: s.kind, cx, cz });
    if (b.n) info.push({ id: b.id, name: b.n, cx, cz, h: topH, pad });
  }

  const group = new THREE.Group();
  group.name = 'buildings';
  const signMesh = buildSigns(signs);
  if (signMesh) group.add(signMesh);
  for (const [key, bk] of buckets) {
    if (!bk.pos.length) continue;
    const mat = mats[key] || mats.stucco;
    const mesh = bk.toMesh(mat, 'bldg-' + key);
    if (key === 'glass') mesh.castShadow = false;
    group.add(mesh);
  }
  return { group, colliders, info, doors };
}

function pointInsideRing(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
    const xi = P[i], zi = P[i + 1], xj = P[j], zj = P[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function insideRing(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
    const xi = P[i], zi = P[i + 1], xj = P[j], zj = P[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// axis-aligned (rotated about Y) box; attrs = [A,B,C,D] facade attribute sets (optional)
function addBox(bk, cx, y0, cz, w, h, d, ang, ts, attrs) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const hw = w / 2, hd = d / 2;
  const corner = (lx, lz) => [cx + lx * c - lz * s, cz + lx * s + lz * c];
  const P = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
  const at = (u) => (attrs ? [[u * ts, attrs[0][1], attrs[0][2], attrs[0][3]], attrs[1], attrs[2], attrs[3]] : [[u * ts, 0, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  for (let i = 0; i < 4; i++) {
    const p = P[i], q = P[(i + 1) % 4];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    const nx = dz / len, nz = -dx / len;
    const a0 = at(0), a1 = at(len / ts);
    const a = bk.vert(p[0], y0, p[1], nx, 0, nz, 0, 0, ...a0), b = bk.vert(q[0], y0, q[1], nx, 0, nz, len / ts, 0, ...a1);
    const c2 = bk.vert(q[0], y0 + h, q[1], nx, 0, nz, len / ts, h / ts, ...a1), d2 = bk.vert(p[0], y0 + h, p[1], nx, 0, nz, 0, h / ts, ...a0);
    bk.tri(b, a, d2); bk.tri(b, d2, c2);
  }
  const t0 = bk.vert(P[0][0], y0 + h, P[0][1], 0, 1, 0, 0, 0, ...at(0)), t1 = bk.vert(P[1][0], y0 + h, P[1][1], 0, 1, 0, 1, 0, ...at(1));
  const t2 = bk.vert(P[2][0], y0 + h, P[2][1], 0, 1, 0, 1, 1, ...at(1)), t3 = bk.vert(P[3][0], y0 + h, P[3][1], 0, 1, 0, 0, 1, ...at(0));
  // winding chosen so that normal is +y regardless of rotation
  const cr = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]);
  if (cr < 0) { bk.tri(t0, t1, t2); bk.tri(t0, t2, t3); } else { bk.tri(t0, t2, t1); bk.tri(t0, t3, t2); }
}

// run a box along each edge of a footprint (parapet coping / coloured roof fascia bands)
function addEdgeBand(bk, P, y, h, depth, off, ts) {
  const n = P.length / 2;
  for (let i = 0; i < n; i++) {
    const p = [P[i * 2], P[i * 2 + 1]], q = [P[((i + 1) % n) * 2], P[((i + 1) % n) * 2 + 1]];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 0.4) continue;
    const nx = dz / len, nz = -dx / len;
    addBox(bk, (p[0] + q[0]) / 2 + nx * off, y, (p[1] + q[1]) / 2 + nz * off, len + 0.06, h, depth, Math.atan2(dz, dx), ts);
  }
}

// glazed entry atrium: a projecting curtain-wall box on the entrance bay, with a metal roof + fascia
function addAtrium(makeBucket, wallKey, mats, s, p, ux, uz, nx, nz, doorU, pad, seed, ts, pal, ang) {
  const { w, d, h } = s.atrium;
  const cx = p[0] + ux * doorU + nx * (d / 2), cz = p[1] + uz * doorU + nz * (d / 2);
  const y0 = pad - 0.06, fh = s.floorH || 4.0;
  const at = [
    [0, pad, 1, fh],
    [s.winW || 1.6, s.winH || 2.0, 6, seed],       // kind 6 = curtain wall (glass + mullions)
    [h, 0, 0, 0],
    [0, 0, 0.10, pal / 7],
  ];
  addBox(makeBucket(wallKey), cx, y0, cz, w, h, d, ang, ts, at);
  const yR = pad + h;
  addBox(makeBucket('concrete_plain'), cx, y0 - 0.24, cz, w + 0.28, 0.28, d + 0.28, ang, 1.5);
  if (!s.atrium.curved) {
    addBox(makeBucket(s.fascia || 'fascia_red'), cx, yR - 0.30, cz, w + 0.62, 0.34, d + 0.62, ang, 1);
    addBox(makeBucket('roof_metal_silver'), cx, yR + 0.02, cz, w + 0.55, 0.22, d + 0.55, ang, 1);
  } else {
    // shallow curved standing-seam canopy (PAC): arch across the width, swept through the depth,
    // with the red fascia following both curved edges
    const vb = makeBucket('roof_metal_silver'), fb = makeBucket(s.fascia || 'fascia_red');
    const NS = 20, rise = Math.min(4.2, d * 0.75 + 1.1);
    const pt = (t, dep) => {
      const u = (t - 0.5) * w, v = dep * d / 2;
      return [cx + ux * u + nx * v, yR + rise * Math.sin(Math.PI * t), cz + uz * u + nz * v];
    };
    const nu = NS + 1, base = vb.pos.length / 3;
    for (let dep = 0; dep < 2; dep++) {
      for (let i = 0; i <= NS; i++) {
        const t = i / NS, [x, y, z] = pt(t, dep ? 1 : -1);
        const dy = rise * Math.PI * Math.cos(Math.PI * t), dx = w;
        let nX = -dy * ux, nY = dx, nZ = -dy * uz;
        const nl = Math.hypot(nX, nY, nZ) || 1;
        vb.vert(x, y, z, nX / nl, nY / nl, nZ / nl, t * w, dep * d);
      }
    }
    for (let i = 0; i < NS; i++) {
      const a = base + i, b = base + i + 1, c = base + nu + i + 1, e = base + nu + i;
      const A = [vb.pos[a * 3], vb.pos[a * 3 + 1], vb.pos[a * 3 + 2]];
      const B = [vb.pos[b * 3], vb.pos[b * 3 + 1], vb.pos[b * 3 + 2]];
      const C = [vb.pos[c * 3], vb.pos[c * 3 + 1], vb.pos[c * 3 + 2]];
      const cy = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
      if (cy < 0) { vb.tri(a, c, b); vb.tri(a, e, c); } else { vb.tri(a, b, c); vb.tri(a, c, e); }
      for (const dep of [1, -1]) {
        const [x0, y0a, z0] = pt(i / NS, dep), [x1, y1a, z1] = pt((i + 1) / NS, dep);
        const L = Math.hypot(x1 - x0, z1 - z0) || 1;
        addBox(fb, (x0 + x1) / 2, (y0a + y1a) / 2 - 0.16, (z0 + z1) / 2, L + 0.06, 0.30, 0.20, Math.atan2(z1 - z0, x1 - x0), 1);
      }
    }
  }
  // slim mullion posts at the outer corners
  for (const sx of [-1, 1]) {
    const px = cx + ux * (w / 2 - 0.06) * sx + nx * (d / 2 - 0.08);
    const pz = cz + uz * (w / 2 - 0.06) * sx + nz * (d / 2 - 0.08);
    addBox(makeBucket('rail'), px, y0, pz, 0.10, h, 0.10, ang, 1);
  }
}

// cylindrical glazed corner drum (PAC lobby): curtain-wall cylinder with a silver cap and red fascia ring
function addDrum(makeBucket, wallKey, mats, s, p, ux, uz, nx, nz, doorU, pad, seed, ts, pal) {
  const { r, h, off = 0 } = s.drum;
  const cx = s.drum.at ? s.drum.at[0] : p[0] + ux * (doorU + off) + nx * (r * 0.45);
  const cz = s.drum.at ? s.drum.at[1] : p[1] + uz * (doorU + off) + nz * (r * 0.45);
  const y0 = pad - 0.06, fh = s.floorH || 4.0, N = 28;
  const wb = makeBucket(wallKey), bb = makeBucket('roof_metal_silver'), fb = makeBucket(s.fascia || 'fascia_red');
  const D = [0, 0, 0.10, pal / 7];
  const B = [s.winW || 1.6, s.winH || 2.0, 6, seed], C = [h, 0, 0, 0];
  const circ = 2 * Math.PI * r;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p0 = [cx + c0 * r, cz + s0 * r], p1 = [cx + c1 * r, cz + s1 * r];
    const u0 = (i / N) * circ, u1 = ((i + 1) / N) * circ;
    const v0 = wb.vert(p0[0], y0, p0[1], c0, 0, s0, u0 / ts, y0 / ts, [u0, pad, 3.2, fh], B, C, D);
    const v1 = wb.vert(p1[0], y0, p1[1], c1, 0, s1, u1 / ts, y0 / ts, [u1, pad, 3.2, fh], B, C, D);
    const v2 = wb.vert(p1[0], pad + h, p1[1], c1, 0, s1, u1 / ts, (pad + h) / ts, [u1, pad, 3.2, fh], B, C, D);
    const v3 = wb.vert(p0[0], pad + h, p0[1], c0, 0, s0, u0 / ts, (pad + h) / ts, [u0, pad, 3.2, fh], B, C, D);
    wb.tri(v0, v1, v2); wb.tri(v0, v2, v3);
    // red fascia ring around the top rim
    const f0 = fb.vert(p0[0], pad + h - 0.32, p0[1], c0, 0, s0, 0, 0), f1 = fb.vert(p1[0], pad + h - 0.32, p1[1], c1, 0, s1, 0, 0);
    const f2 = fb.vert(p1[0], pad + h + 0.05, p1[1], c1, 0, s1, 0, 0), f3 = fb.vert(p0[0], pad + h + 0.05, p0[1], c0, 0, s0, 0, 0);
    fb.tri(f0, f1, f2); fb.tri(f0, f2, f3);
  }
  // silver cap disc
  const cbase = bb.pos.length / 3;
  bb.vert(cx, pad + h + 0.06, cz, 0, 1, 0, 0, 0);
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    bb.vert(cx + Math.cos(a) * (r + 0.15), pad + h + 0.06, cz + Math.sin(a) * (r + 0.15), 0, 1, 0, Math.cos(a), Math.sin(a));
  }
  for (let i = 0; i < N; i++) bb.tri(cbase, cbase + 1 + i, cbase + 2 + i);
  // plinth
  addBox(makeBucket('concrete_plain'), cx, y0 - 0.22, cz, r * 2.2, 0.26, r * 2.2, 0, 1.5);
}

// recessed-look entrance: stucco portal frame, landing + two steps, steel handrails
function addPortal(wb, cb, rl, o) {
  const { p, ux, uz, nx, nz, doorU, pad, wallH, ang, pal, seed } = o;
  const cx = p[0] + ux * doorU, cz = p[1] + uz * doorU;
  const half = 1.15, pw = 0.5, depth = 0.42, hF = Math.min(wallH - 0.3, 4.5);
  const at = (along, out) => [cx + ux * along + nx * out, cz + uz * along + nz * out];
  const attrs = [[0, pad, 1, 1], [0, 0, 0, seed], [0, 0, 0, 0], [0, 0, 0.12, pal / 7]];
  for (const sg of [-1, 1]) { const [x, z] = at(sg * (half + pw / 2), depth / 2); addBox(wb, x, pad - 0.05, z, pw, hF + 0.05, depth, ang, 2, attrs); }
  { const [x, z] = at(0, depth / 2); addBox(wb, x, pad + 2.75, z, 2 * half + 2 * pw, hF - 2.75, depth, ang, 2, attrs); }
  const wFull = 2 * half + 2 * pw + 0.5;
  { const [x, z] = at(0, depth + 0.55); addBox(cb, x, pad - 0.9, z, wFull, 0.9, 1.1, ang, 1.6); }
  for (let k = 1; k <= 2; k++) { const [x, z] = at(0, depth + 1.1 + (k - 0.5) * 0.34); addBox(cb, x, pad - 0.9, z, wFull, 0.9 - 0.17 * k, 0.34, ang, 1.6); }
  for (const sg of [-1, 1]) {
    const off = sg * (wFull / 2 - 0.08);
    for (const out of [depth + 0.12, depth + 1.1, depth + 1.78]) { const [x, z] = at(off, out); addBox(rl, x, pad - 0.2 - (out > depth + 1.2 ? 0.34 : 0), z, 0.05, 1.1, 0.05, ang, 1); }
    const [x, z] = at(off, depth + 0.95); addBox(rl, x, pad + 0.88, z, 0.05, 0.05, 1.9, ang, 1);
  }
}

// clay ridge / hip cap: a low two-sided prism lying along the segment a->b
function addCap(rb, a, b, wHalf, slope) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz); if (L < 0.5) return;
  let px = -dz, pz = dx; const pl = Math.hypot(px, pz); if (pl < 1e-4) return;
  px = (px / pl) * wHalf; pz = (pz / pl) * wHalf;
  const lift = 0.14, drop = wHalf * slope;
  const quad = (p0, p1, p2, p3, u1) => {
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = ny < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const i0 = rb.vert(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0), i1 = rb.vert(p1[0], p1[1], p1[2], nx, ny, nz, 0, L);
    const i2 = rb.vert(p2[0], p2[1], p2[2], nx, ny, nz, u1, L), i3 = rb.vert(p3[0], p3[1], p3[2], nx, ny, nz, u1, 0);
    if (!flip) { rb.tri(i0, i1, i2); rb.tri(i0, i2, i3); } else { rb.tri(i0, i2, i1); rb.tri(i0, i3, i2); }
  };
  const aL = [a[0] + px, a[1] - drop + 0.02, a[2] + pz], bL = [b[0] + px, b[1] - drop + 0.02, b[2] + pz];
  const aR = [a[0] - px, a[1] - drop + 0.02, a[2] - pz], bR = [b[0] - px, b[1] - drop + 0.02, b[2] - pz];
  const aT = [a[0], a[1] + lift, a[2]], bT = [b[0], b[1] + lift, b[2]];
  quad(aL, bL, bT, aT, wHalf); quad(aR, bR, bT, aT, wHalf);
}

// Large swept airfoil / wing roof (the PAC's signature): a leaf-shaped plan with a cambered
// cross-section, rising along the length and finished with a continuous red edge.
function addAirfoilRoof(rb, fb, ub, P, y0, opts) {
  const n = P.length / 2;
  let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 2], z = P[i * 2 + 1];
    cx += x; cz += z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  cx /= n; cz /= n;
  const ew = maxX - minX, ed = maxZ - minZ;
  const ang = opts.ang != null ? opts.ang : (ew >= ed ? 0 : Math.PI / 2);
  const L = opts.L || Math.max(24, (ew >= ed ? ew : ed) * 0.84);
  const W = opts.W || Math.max(14, Math.min(ew, ed) * 0.66);
  const rise = opts.rise || Math.min(16, W * 0.30);
  const sweep = opts.sweep != null ? opts.sweep : L * 0.10;
  const ca = Math.cos(ang), sa = Math.sin(ang), ux = [ca, sa], vx = [-sa, ca];
  const offV = opts.offset || 0;
  const NU = 32, NV = 20;
  const grid = [];
  for (let i = 0; i <= NU; i++) {
    const u = -1 + (2 * i) / NU;
    const halfW = (W / 2) * (0.12 + 0.88 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 8.0))));
    const sweepOff = sweep * u;
    const riseU = rise * (0.38 + 0.62 * ((u + 1) / 2));
    const row = [];
    for (let j = 0; j <= NV; j++) {
      const v = -1 + (2 * j) / NV, t = (v + 1) / 2;
      // cambered airfoil: sharp leading edge at v=-1, crest ~40 % back, thin trailing edge
      const prof = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.75) * (1.0 - 0.55 * t);
      const y = y0 + riseU * prof;
      const x = cx + ux[0] * (u * L / 2) + vx[0] * (v * halfW + sweepOff + offV);
      const z = cz + ux[1] * (u * L / 2) + vx[1] * (v * halfW + sweepOff + offV);
      row.push([x, y, z]);
    }
    grid.push(row);
  }
  // smooth vertex normals from surface derivatives
  const idx = [], nrm = [];
  for (let i = 0; i <= NU; i++) {
    idx.push([]); nrm.push([]);
    for (let j = 0; j <= NV; j++) {
      const p = grid[i][j];
      const a = grid[Math.max(0, i - 1)][j], b = grid[Math.min(NU, i + 1)][j];
      const c = grid[i][Math.max(0, j - 1)], d = grid[i][Math.min(NV, j + 1)];
      const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dv = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
      let nx = dv[1] * du[2] - dv[2] * du[1], ny = dv[2] * du[0] - dv[0] * du[2], nz = dv[0] * du[1] - dv[1] * du[0];
      const nl = Math.hypot(nx, ny, nz) || 1;
      idx[i].push(rb.vert(p[0], p[1], p[2], nx / nl, ny / nl, nz / nl, ((i / NU) * L), ((j / NV) * W)));
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = idx[i][j], b = idx[i + 1][j], c = idx[i + 1][j + 1], d = idx[i][j + 1];
    const A = grid[i][j], B = grid[i + 1][j], C = grid[i + 1][j + 1];
    const cy = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
    if (cy > 0) { rb.tri(a, b, c); rb.tri(a, c, d); } else { rb.tri(a, c, b); rb.tri(a, d, c); }
  }
  // underside / soffit, offset down so the wing reads as a solid airfoil
  const uIdx = [];
  for (let i = 0; i <= NU; i++) {
    uIdx.push([]);
    for (let j = 0; j <= NV; j++) {
      const p = grid[i][j];
      const a = grid[Math.max(0, i - 1)][j], b = grid[Math.min(NU, i + 1)][j];
      const c = grid[i][Math.max(0, j - 1)], d = grid[i][Math.min(NV, j + 1)];
      const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dv = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
      let nx = dv[1] * du[2] - dv[2] * du[1], ny = dv[2] * du[0] - dv[0] * du[2], nz = dv[0] * du[1] - dv[1] * du[0];
      const nl = Math.hypot(nx, ny, nz) || 1;
      uIdx[i].push(ub.vert(p[0], p[1] - 0.45, p[2], -nx / nl, -ny / nl, -nz / nl, ((i / NU) * L), ((j / NV) * W)));
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = uIdx[i][j], b = uIdx[i + 1][j], c = uIdx[i + 1][j + 1], d = uIdx[i][j + 1];
    ub.tri(a, c, b); ub.tri(a, d, c);
  }
  // continuous red fascia around the airfoil edge (the bright lip in the photos)
  const per = [];
  for (let i = 0; i <= NU; i++) per.push(grid[i][0]);
  for (let j = 1; j <= NV; j++) per.push(grid[NU][j]);
  for (let i = NU - 1; i >= 0; i--) per.push(grid[i][NV]);
  for (let j = NV - 1; j >= 1; j--) per.push(grid[0][j]);
  for (let k = 0; k < per.length - 1; k++) {
    const a = per[k], b = per[k + 1];
    const ex = b[0] - a[0], ez = b[2] - a[2], el = Math.hypot(ex, ez) || 1;
    let ox = ez / el, oz = -ex / el;
    if (ox * ((a[0] + b[0]) / 2 - cx) + oz * ((a[2] + b[2]) / 2 - cz) < 0) { ox = -ox; oz = -oz; }
    const b0 = fb.vert(a[0] + ox * 0.06, a[1] - 0.50, a[2] + oz * 0.06, ox, 0, oz, 0, 0);
    const b1 = fb.vert(b[0] + ox * 0.06, b[1] - 0.50, b[2] + oz * 0.06, ox, 0, oz, el, 0);
    const b2 = fb.vert(b[0] + ox * 0.06, b[1] + 0.02, b[2] + oz * 0.06, ox, 0, oz, el, 1);
    const b3 = fb.vert(a[0] + ox * 0.06, a[1] + 0.02, a[2] + oz * 0.06, ox, 0, oz, 0, 1);
    fb.tri(b0, b1, b2); fb.tri(b0, b2, b3);
  }
}

// Shallow curved (domed / hipped) roof cap over an arbitrary footprint: several inset rings rise
// along a smooth curve to a small flat top. Used for the PAC's sweeping silver roofs.
function addCurvedCap(rb, P, y0, rise, ts = 1) {
  const n = P.length / 2;
  if (n < 3 || rise < 0.1) return;
  let area = 0, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const x0 = P[i * 2], z0 = P[i * 2 + 1], x1 = P[((i + 1) % n) * 2], z1 = P[((i + 1) % n) * 2 + 1];
    area += x0 * z1 - x1 * z0; cx += x0; cz += z0;
  }
  cx /= n; cz /= n;
  const inset = Math.min(10, Math.max(1.6, Math.sqrt(Math.abs(area) * 0.5) * 0.16));
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const p0 = [P[((i + n - 1) % n) * 2], P[((i + n - 1) % n) * 2 + 1]];
    const p1 = [P[i * 2], P[i * 2 + 1]];
    const p2 = [P[((i + 1) % n) * 2], P[((i + 1) % n) * 2 + 1]];
    const d0 = [p1[0] - p0[0], p1[1] - p0[1]], d1 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l0 = Math.hypot(d0[0], d0[1]) || 1, l1 = Math.hypot(d1[0], d1[1]) || 1;
    const n0 = [-d0[1] / l0, d0[0] / l0], n1 = [-d1[1] / l1, d1[0] / l1];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    // point the miter toward the interior
    if (mx * (cx - p1[0]) + mz * (cz - p1[1]) < 0) { mx = -mx; mz = -mz; }
    dirs.push([mx, mz]);
  }
  const N = 5, rings = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, ring = [];
    const off = inset * t * insetCurve(t);
    const y = y0 + rise * Math.sin(Math.PI * 0.5 * t);
    for (let i = 0; i < n; i++) ring.push([P[i * 2] + dirs[i][0] * off, y, P[i * 2 + 1] + dirs[i][1] * off]);
    rings.push(ring);
  }
  for (let k = 0; k < N; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = A[i], b = A[j], c = B[j], d = B[i];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const flip = ny < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
      const i0 = rb.vert(a[0], a[1], a[2], nx, ny, nz, 0, 0);
      const i1 = rb.vert(b[0], b[1], b[2], nx, ny, nz, len / ts, 0);
      const i2 = rb.vert(c[0], c[1], c[2], nx, ny, nz, len / ts, rise / N / ts);
      const i3 = rb.vert(d[0], d[1], d[2], nx, ny, nz, 0, rise / N / ts);
      if (!flip) { rb.tri(i0, i1, i2); rb.tri(i0, i2, i3); } else { rb.tri(i0, i2, i1); rb.tri(i0, i3, i2); }
    }
  }
  // small flat top cap
  const top = rings[N], contour = top.map((p) => new THREE.Vector2(p[0], p[2]));
  let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
  const base = rb.pos.length / 3;
  for (const v of top) rb.vert(v[0], v[1] + 0.01, v[2], 0, 1, 0, v[0] / ts, v[2] / ts);
  for (const t of tris) {
    const A = contour[t[0]], B = contour[t[1]], C = contour[t[2]];
    const cr = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (cr < 0) rb.tri(base + t[0], base + t[1], base + t[2]); else rb.tri(base + t[0], base + t[2], base + t[1]);
  }
}
function insetCurve(t) { return 0.65 + 0.35 * t; }

// Truncated-hip roof for arbitrary (curved / L / U shaped) footprints: the eave ring is inset towards a flat ridge ring.
function addPolyRoof(rb, P, y0, s, area, tb) {
  const n = P.length / 2;
  let per = 0; for (let i = 0; i < n; i++) per += Math.hypot(P[((i + 1) % n) * 2] - P[i * 2], P[((i + 1) % n) * 2 + 1] - P[i * 2 + 1]);
  const thick = (2 * area) / per;                          // approx. wing thickness
  const inset = Math.min(6.5, Math.max(1.5, thick * 0.38));
  const rise = inset * (s.pitch || 0.4) * 1.0;
  const ts = 1;
  const out = [], inn = [], wl = [];
  for (let i = 0; i < n; i++) {
    const p0 = [P[((i + n - 1) % n) * 2], P[((i + n - 1) % n) * 2 + 1]], p1 = [P[i * 2], P[i * 2 + 1]], p2 = [P[((i + 1) % n) * 2], P[((i + 1) % n) * 2 + 1]];
    const d0 = [p1[0] - p0[0], p1[1] - p0[1]], d1 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l0 = Math.hypot(...d0) || 1, l1 = Math.hypot(...d1) || 1;
    const n0 = [d0[1] / l0, -d0[0] / l0], n1 = [d1[1] / l1, -d1[0] / l1];          // outward normals
    const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    let mx = (n0[0] + n1[0]) / Math.max(k, 0.35), mz = (n0[1] + n1[1]) / Math.max(k, 0.35);   // miter (clamped)
    const ov = (s.eave ?? 0.55) * (/clay/.test(s.roofMat || '') ? 1 : 0.6);
    wl.push(p1); out.push([p1[0] + mx * ov, p1[1] + mz * ov]); inn.push([p1[0] - mx * inset, p1[1] - mz * inset]);
  }
  // sloped band (starts at the overhang, lowered by the overhang x pitch)
  const ovy = (s.eave ?? 0.55) * (/clay/.test(s.roofMat || '') ? 1 : 0.6) * (s.pitch || 0.4);
  const eave = y0 - 0.1 - ovy, ridge = y0 - 0.1 + rise;
  if (tb) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, A = out[i], B = out[j], Ai = wl[i], Bi = wl[j];
      const L2 = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L2 < 0.05) continue;
      const nx = (B[1] - A[1]) / L2, nz = -(B[0] - A[0]) / L2;
      const f0 = tb.vert(A[0], eave - 0.22, A[1], nx, 0, nz, 0, 0), f1 = tb.vert(B[0], eave - 0.22, B[1], nx, 0, nz, L2, 0);
      const f2 = tb.vert(B[0], eave + 0.02, B[1], nx, 0, nz, L2, 0.24), f3 = tb.vert(A[0], eave + 0.02, A[1], nx, 0, nz, 0, 0.24);
      tb.tri(f1, f0, f3); tb.tri(f1, f3, f2);
      const s0 = tb.vert(A[0], eave - 0.22, A[1], 0, -1, 0, 0, 0), s1 = tb.vert(B[0], eave - 0.22, B[1], 0, -1, 0, L2, 0);
      const s2 = tb.vert(Bi[0], eave - 0.22, Bi[1], 0, -1, 0, L2, 1), s3 = tb.vert(Ai[0], eave - 0.22, Ai[1], 0, -1, 0, 0, 1);
      const ny = (B[0] - A[0]) * (Ai[1] - A[1]) - (B[1] - A[1]) * (Ai[0] - A[0]);
      if (ny > 0) { tb.tri(s0, s1, s2); tb.tri(s0, s2, s3); } else { tb.tri(s0, s2, s1); tb.tri(s0, s3, s2); }
    }
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = out[i], b = out[j], c = inn[j], d = inn[i];
    const e1 = [b[0] - a[0], ridge - eave, b[1] - a[1]], e2 = [d[0] - a[0], ridge - eave, d[1] - a[1]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = ny < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const sl = Math.hypot(inset, rise);
    const v = [rb.vert(a[0], eave, a[1], nx, ny, nz, 0, 0), rb.vert(b[0], eave, b[1], nx, ny, nz, len / ts, 0), rb.vert(c[0], ridge, c[1], nx, ny, nz, len / ts, sl / ts), rb.vert(d[0], ridge, d[1], nx, ny, nz, 0, sl / ts)];
    if (!flip) { rb.tri(v[0], v[1], v[2]); rb.tri(v[0], v[2], v[3]); } else { rb.tri(v[0], v[2], v[1]); rb.tri(v[0], v[3], v[2]); }
  }
  // flat ridge cap
  const contour = inn.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
  const base = rb.pos.length / 3;
  for (const v of contour) rb.vert(v.x, ridge, v.y, 0, 1, 0, v.x / ts, v.y / ts);
  for (const t of tris) {
    const A = contour[t[0]], B = contour[t[1]], C = contour[t[2]];
    const cr = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (cr < 0) rb.tri(base + t[0], base + t[1], base + t[2]); else rb.tri(base + t[0], base + t[2], base + t[1]);
  }
}

// hip / gable roof for one oriented rectangle r = [cx, cz, hw, hd, angle]
function addPitchedRoof(rb, wb, r, y0, s, o, wallTs, wallKey, tb) {
  const [cx, cz, hw0, hd0, ang] = r;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const e1 = [ca, sa], e2 = [-sa, ca];
  const to = (u, v) => [cx + u * e1[0] + v * e2[0], cz + u * e1[1] + v * e2[1]];
  const ts = 1;
  const longU = hw0 >= hd0;
  const W = hw0 + o, D = hd0 + o;
  const half = longU ? D : W;                // half width across the ridge
  const L = longU ? W - D : D - W;           // ridge half length (hip)
  const rise = half * s.pitch * 2 * 0.5;     // ridge height above eave
  const gable = s.roof === 'gable';
  const Lr = gable ? (longU ? W : D) : L;
  // ridge endpoints in (u,v)
  const R1 = longU ? [-Lr, 0] : [0, -Lr], R2 = longU ? [Lr, 0] : [0, Lr];
  const C = [[-W, -D], [W, -D], [W, D], [-W, D]];
  const ey = (pt, h) => { const p = to(pt[0], pt[1]); return [p[0], h, p[1]]; };
  const faces = [];
  if (longU) {
    faces.push([C[0], C[1], R2, R1]);                       // -v side (quad)
    faces.push([C[2], C[3], R1, R2]);                       // +v side (quad)
    if (!gable) { faces.push([C[1], C[2], R2]); faces.push([C[3], C[0], R1]); }
  } else {
    faces.push([C[1], C[2], R2, R1]);
    faces.push([C[3], C[0], R1, R2]);
    if (!gable) { faces.push([C[2], C[3], R2]); faces.push([C[0], C[1], R1]); }
  }
  const isRidge = (pt) => pt === R1 || pt === R2;
  // painted fascia board along the eaves + flat soffit back to the wall line
  if (tb && o > 0.15) {
    const yE0 = y0 - o * s.pitch;
    const Wi = W - o, Di = D - o;
    const sides = [[[-W, -D], [W, -D], [-Wi, -Di], [Wi, -Di], [0, -1]], [[W, D], [-W, D], [Wi, Di], [-Wi, Di], [0, 1]],
                   [[W, -D], [W, D], [Wi, -Di], [Wi, Di], [1, 0]], [[-W, D], [-W, -D], [-Wi, Di], [-Wi, -Di], [-1, 0]]];
    sides.forEach(([a, b, ai, bi, nrm], k) => {
      if (gable && ((longU && k >= 2) || (!longU && k < 2))) return;     // rake ends of gables: skip
      const A = to(a[0], a[1]), B = to(b[0], b[1]), Ai = to(ai[0], ai[1]), Bi = to(bi[0], bi[1]);
      const nx = nrm[0] * e1[0] + nrm[1] * e2[0], nz = nrm[0] * e1[1] + nrm[1] * e2[1];
      const L2 = Math.hypot(B[0] - A[0], B[1] - A[1]);
      // fascia (vertical, faces out)
      const f0 = tb.vert(A[0], yE0 - 0.24, A[1], nx, 0, nz, 0, 0), f1 = tb.vert(B[0], yE0 - 0.24, B[1], nx, 0, nz, L2, 0);
      const f2 = tb.vert(B[0], yE0 + 0.03, B[1], nx, 0, nz, L2, 0.27), f3 = tb.vert(A[0], yE0 + 0.03, A[1], nx, 0, nz, 0, 0.27);
      // winding: outward normal (nx,nz) -> pick by cross product of (B-A) x up
      const cx2 = (B[1] - A[1]) * 1, cz2 = -(B[0] - A[0]) * 1;            // (B-A) x (0,1,0) = (dz, 0, -dx)
      if (cx2 * nx + cz2 * nz > 0) { tb.tri(f0, f2, f1); tb.tri(f0, f3, f2); } else { tb.tri(f0, f1, f2); tb.tri(f0, f2, f3); }
      // soffit (horizontal underside, faces down)
      const s0 = tb.vert(A[0], yE0 - 0.24, A[1], 0, -1, 0, 0, 0), s1 = tb.vert(B[0], yE0 - 0.24, B[1], 0, -1, 0, L2, 0);
      const s2 = tb.vert(Bi[0], yE0 - 0.24, Bi[1], 0, -1, 0, L2, o), s3 = tb.vert(Ai[0], yE0 - 0.24, Ai[1], 0, -1, 0, 0, o);
      const ny = (B[0] - A[0]) * (Ai[1] - A[1]) - (B[1] - A[1]) * (Ai[0] - A[0]);   // y of (B-A)x(Ai-A) sign test
      if (ny > 0) { tb.tri(s0, s1, s2); tb.tri(s0, s2, s3); } else { tb.tri(s0, s2, s1); tb.tri(s0, s3, s2); }
    });
  }
  for (const f of faces) {
    const yE = y0 - o * s.pitch;
    const pts3 = f.map((pt) => ey(pt, yE + (isRidge(pt) ? rise : 0)));
    // face basis: eave direction = first edge, slope direction = projection of up-slope
    const a = pts3[0], b = pts3[1], c = pts3[f.length === 4 ? 2 : 2];
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const flip = ny < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const ex = b[0] - a[0], ez = b[2] - a[2], el = Math.hypot(ex, ez) || 1;
    const ux = ex / el, uz = ez / el;                       // along eave
    // slope dir: n x u projected
    let sx = ny * uz - nz * 0, sy = nz * ux - nx * uz, sz = nx * 0 - ny * ux;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    if (sy < 0) { sx = -sx; sy = -sy; sz = -sz; }            // v must run UP the slope
    const idx = pts3.map((p) => rb.vert(p[0], p[1], p[2], nx, ny, nz, ((p[0] - a[0]) * ux + (p[2] - a[2]) * uz) / ts, ((p[0] - a[0]) * sx + (p[1] - a[1]) * sy + (p[2] - a[2]) * sz) / ts));
    if (!flip) { for (let k = 1; k < idx.length - 1; k++) rb.tri(idx[0], idx[k], idx[k + 1]); }
    else { for (let k = 1; k < idx.length - 1; k++) rb.tri(idx[0], idx[k + 1], idx[k]); }
  }
  // clay ridge + hip caps
  if (/clay/.test(s.roofMat || '')) {
    const yEave = y0 - o * s.pitch, hi = yEave + rise;
    addCap(rb, ey(R1, hi), ey(R2, hi), 0.22, s.pitch);
    if (!gable) {
      const pairs = longU ? [[C[0], R1], [C[3], R1], [C[1], R2], [C[2], R2]] : [[C[0], R1], [C[1], R1], [C[3], R2], [C[2], R2]];
      for (const [cc, rr] of pairs) addCap(rb, ey(cc, yEave), ey(rr, hi), 0.2, s.pitch * 0.7);
    }
  }
  // gable end walls (triangles in wall material)
  if (gable) {
    const ends = longU
      ? [[[ W - o, -(D - o)], [W - o, D - o], [W - o, 0], 1, 0], [[-(W - o), D - o], [-(W - o), -(D - o)], [-(W - o), 0], -1, 0]]
      : [[[-(W - o), D - o], [W - o, D - o], [0, D - o], 0, 1], [[W - o, -(D - o)], [-(W - o), -(D - o)], [0, -(D - o)], 0, -1]];
    for (const [pa, pb, pc, lx, lv] of ends) {
      const A = to(pa[0], pa[1]), B = to(pb[0], pb[1]), Cc = to(pc[0], pc[1]);
      const nxw = lx * e1[0] + lv * e2[0], nzw = lx * e1[1] + lv * e2[1];
      const ia = wb.vert(A[0], y0 - 0.02, A[1], nxw, 0, nzw, 0, y0 / wallTs, [0, 0, 1, 1]);
      const ib = wb.vert(B[0], y0 - 0.02, B[1], nxw, 0, nzw, Math.hypot(B[0] - A[0], B[1] - A[1]) / wallTs, y0 / wallTs, [0, 0, 1, 1]);
      const ic = wb.vert(Cc[0], y0 + rise * ((half - o) / half), Cc[1], nxw, 0, nzw, Math.hypot(B[0] - A[0], B[1] - A[1]) / wallTs / 2, (y0 + rise) / wallTs, [0, 0, 1, 1]);
      // choose winding so the triangle faces outward: 3D cross of (B-A) x (C-A) dotted with the end normal
      const bx = B[0] - A[0], by = 0, bz = B[1] - A[1];
      const cx2 = Cc[0] - A[0], cy2 = rise, cz2 = Cc[1] - A[1];
      const cxn = by * cz2 - bz * cy2, czn = bx * cy2 - by * cx2;
      if (cxn * nxw + czn * nzw >= 0) wb.tri(ia, ib, ic); else wb.tri(ia, ic, ib);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Cast-letter building names over the main entrances (one texture atlas for all of them).
function signText(name) {
  const num = (name.match(/\((\d{1,3}[A-Z]?)\)/) || [])[1] || '';
  let t = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^\d+[A-Z]?-\s*/, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^Julian A\. McPhee /, '').replace(/^Christopher Cohan /, '').replace(/^Robert E\. /, '').replace(/^Warren J\. /, '').replace(/^William and Linda /, '');
  if (t.length > 34) t = t.slice(0, 34).replace(/\s+\S*$/, '');
  return (t + (num ? '  ' + num : '')).toUpperCase();
}

function buildSigns(signs) {
  if (!signs.length) return null;
  const CW = 512, CH = 64, COLS = 4, ROWS = 64;
  const cv = document.createElement('canvas'); cv.width = CW * COLS; cv.height = CH * ROWS;
  const ctx = cv.getContext('2d');
  const pos = [], uv = [], nor = [], idx = [];
  signs.slice(0, COLS * ROWS).forEach((sg, i) => {
    const text = signText(sg.name);
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
    ctx.font = '600 40px "Times New Roman", Georgia, serif';
    const tw = Math.min(CW - 12, ctx.measureText(text).width);
    ctx.save(); ctx.translate(cx + CW / 2, cy + CH / 2 + 14);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(text, 2, 2, CW - 12);
    ctx.fillStyle = '#4a3b2b'; ctx.fillText(text, 0, 0, CW - 12);
    ctx.restore();
    // quad: width from the measured text, 0.42 m tall letters
    const w = Math.max(1.2, (tw / 40) * 0.36), h = 0.55;
    const u0 = (cx + CW / 2 - tw / 2 - 4) / cv.width, u1 = (cx + CW / 2 + tw / 2 + 4) / cv.width;
    const v0 = 1 - (cy + CH) / cv.height, v1 = 1 - cy / cv.height;
    const ox = sg.x + sg.nx * (sg.out + 0.02), oz = sg.z + sg.nz * (sg.out + 0.02);
    const k = pos.length / 3;
    const P = (a, yy) => [ox + sg.ux * a, yy, oz + sg.uz * a];
    // text reads left-to-right when facing the wall from outside: run along -u
    pos.push(...P(w / 2, sg.y), ...P(-w / 2, sg.y), ...P(-w / 2, sg.y + h), ...P(w / 2, sg.y + h));
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let m = 0; m < 4; m++) nor.push(sg.nx, 0, sg.nz);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.name = 'signs';
  return m;
}
