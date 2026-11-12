// Converts raw OSM + elevation downloads into compact files the browser loads.
//   node tools/build-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  LAT0, LON0, M_LAT, M_LON, project, unproject, r1, geomToPts, closeRing, signedArea, perimeter,
  centroid, joinRings, minAreaBox, hash01,
} from './osm-lib.mjs';
import { styleFor } from './building-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- terrain
const tiles = new Map();
function tile(z, x, y) {
  const key = `${z}_${x}_${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const f = path.join(RAW, 'dem', `z${z}_${x}_${y}.png`);
  let arr = null;
  if (fs.existsSync(f)) {
    const png = PNG.sync.read(fs.readFileSync(f));
    arr = new Float32Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) {
      arr[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
    }
  }
  tiles.set(key, arr);
  return arr;
}
function pix(z, X, Y) {
  const t = tile(z, Math.floor(X / 256), Math.floor(Y / 256));
  if (!t) return NaN;
  return t[(Y - Math.floor(Y / 256) * 256) * 256 + (X - Math.floor(X / 256) * 256)];
}
function sampleDEM(z, lat, lon) {
  const n = 256 * 2 ** z;
  const fx = ((lon + 180) / 360) * n - 0.5;
  const fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const a = pix(z, x0, y0), b = pix(z, x0 + 1, y0), c = pix(z, x0, y0 + 1), d = pix(z, x0 + 1, y0 + 1);
  if ([a, b, c, d].some(Number.isNaN)) return NaN;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
function elevAt(x, z) {
  const [lat, lon] = unproject(x, z);
  let e = sampleDEM(15, lat, lon);
  if (Number.isNaN(e)) e = sampleDEM(14, lat, lon);
  if (Number.isNaN(e)) e = sampleDEM(12, lat, lon);
  return e;
}

const E0 = elevAt(0, 0);
console.log('origin elevation (m):', E0.toFixed(1));

function buildGrid(half, step, name, seamDrop = 0) {
  const n = Math.round((2 * half) / step) + 1;
  const arr = new Float32Array(n * n);
  let nan = 0, mn = Infinity, mx = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * step, z = -half + j * step;
      let e = elevAt(x, z);
      if (Number.isNaN(e)) { nan++; e = arr[Math.max(0, j * n + i - 1)] || 0; }
      else e -= E0;
      arr[j * n + i] = e - seamDrop;
      mn = Math.min(mn, e); mx = Math.max(mx, e);
    }
  }
  fs.writeFileSync(path.join(OUT, name), Buffer.from(arr.buffer));
  console.log(name, `n=${n}`, `step=${step}`, `range=${mn.toFixed(1)}..${mx.toFixed(1)}`, 'nan', nan);
  return { n, half, step, min: mn, max: mx };
}
let core;
const LIDAR_CORE = path.join(RAW, 'lidar', 'dtm_core4.bin');
if (fs.existsSync(LIDAR_CORE)) {
  // 4 m terrain from the USGS 3DEP LiDAR bare-earth model; blends into the DEM over the last 150 m of the core
  const buf = fs.readFileSync(LIDAR_CORE);
  const abs = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = 1001, half = 2000, step = 4;
  const e0L = abs[500 * n + 500];
  const arr = new Float32Array(n * n);
  let mn = Infinity, mx = -Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * step, z = -half + j * step;
    let e = abs[j * n + i] - e0L;
    const edge = Math.min(half - Math.abs(x), half - Math.abs(z));
    if (edge < 150 && !fs.existsSync(path.join(RAW, 'lidar', 'dtm_outer12.bin'))) { const d = elevAt(x, z) - E0; const t = Math.max(0, edge) / 150; e = d + (e - d) * t * t * (3 - 2 * t); }
    arr[j * n + i] = e; mn = Math.min(mn, e); mx = Math.max(mx, e);
  }
  fs.writeFileSync(path.join(OUT, 'terrain_core.bin'), Buffer.from(arr.buffer));
  core = { n, half, step, min: mn, max: mx, src: 'lidar', e0: e0L };
  console.log('terrain_core.bin from LiDAR', `n=${n} step=${step}`, `origin ${e0L.toFixed(2)} vs DEM ${E0.toFixed(2)}`);
} else core = buildGrid(2000, 8, 'terrain_core.bin');
let outer;
const LIDAR_OUTER = path.join(RAW, 'lidar', 'dtm_outer12.bin');
if (fs.existsSync(LIDAR_OUTER) && core.src === 'lidar') {
  const buf = fs.readFileSync(LIDAR_OUTER);
  const abs = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = 801, half = 4800, step = 12;
  const arr = new Float32Array(n * n); let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n * n; i++) { const e = abs[i] - core.e0; arr[i] = e; mn = Math.min(mn, e); mx = Math.max(mx, e); }
  fs.writeFileSync(path.join(OUT, 'terrain_outer.bin'), Buffer.from(arr.buffer));
  outer = { n, half, step, min: mn, max: mx, src: 'lidar' };
  console.log('terrain_outer.bin from LiDAR', `n=${n} step=${step}`);
} else outer = buildGrid(4800, 25, 'terrain_outer.bin', 0);

// ---------------------------------------------------------------- buildings
// far ring: 128 m grid out to ±20.5 km (Morros skyline), lowered where it overlaps the outer ring
const far = buildGrid(20480, 128, 'terrain_far.bin');
{
  const buf = fs.readFileSync(path.join(OUT, 'terrain_far.bin'));
  const arr = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const n = far.n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -20480 + i * 128, z = -20480 + j * 128;
    arr[j * n + i] = Math.max(arr[j * n + i], -E0 - 1.0);            // ocean: clamp bathymetry to just below sea level
    if (Math.abs(x) < 4950 && Math.abs(z) < 4950) arr[j * n + i] -= 6;
  }
  fs.writeFileSync(path.join(OUT, 'terrain_far.bin'), Buffer.from(arr.buffer));
}
const bj = JSON.parse(fs.readFileSync(path.join(RAW, 'buildings.json'))).elements;

function parseNum(v) {
  if (v == null) return null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/ft|'/.test(String(v))) n *= 0.3048;
  return n;
}

// rectilinear decomposition into oriented rectangles (for hip / gable roofs)
function decomposeRects(pts) {
  const box = minAreaBox(pts);
  if (!box) return [];
  const { ux, uz, px, pz } = box;
  const toUV = (p) => [(p[0] - px) * ux + (p[1] - pz) * uz, -(p[0] - px) * uz + (p[1] - pz) * ux];
  const fromUV = (u, v) => [px + u * ux - v * uz, pz + u * uz + v * ux];
  const uv = pts.map(toUV);
  const us = [...new Set(uv.map((p) => Math.round(p[0] * 4) / 4))].sort((a, b) => a - b);
  const vs = [...new Set(uv.map((p) => Math.round(p[1] * 4) / 4))].sort((a, b) => a - b);
  const mergeClose = (a) => { const o = [a[0]]; for (let i = 1; i < a.length; i++) if (a[i] - o[o.length - 1] > 0.9) o.push(a[i]); else if (i === a.length - 1) o[o.length - 1] = a[i]; return o; };
  const U = mergeClose(us), V = mergeClose(vs);
  const inside = (u, v) => {
    let c = false;
    for (let i = 0, j = uv.length - 1; i < uv.length; j = i++) {
      const a = uv[i], b = uv[j];
      if ((a[1] > v) !== (b[1] > v) && u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const nu = U.length - 1, nv = V.length - 1;
  if (nu < 1 || nv < 1 || nu * nv > 400) return [];
  const cell = [];
  for (let j = 0; j < nv; j++) { cell.push([]); for (let i = 0; i < nu; i++) cell[j].push(inside((U[i] + U[i + 1]) / 2, (V[j] + V[j + 1]) / 2)); }
  const decompose = (rowsFirst) => {
    const used = cell.map((r) => r.map(() => false));
    const rects = [];
    const A = rowsFirst ? nv : nu, B = rowsFirst ? nu : nv;
    const get = (a, b) => (rowsFirst ? cell[a][b] && !used[a][b] : cell[b][a] && !used[b][a]);
    const mark = (a, b) => { if (rowsFirst) used[a][b] = true; else used[b][a] = true; };
    for (let a = 0; a < A; a++) for (let b = 0; b < B; b++) {
      if (!get(a, b)) continue;
      let b2 = b; while (b2 + 1 < B && get(a, b2 + 1)) b2++;
      let a2 = a;
      outer: while (a2 + 1 < A) { for (let k = b; k <= b2; k++) if (!get(a2 + 1, k)) break outer; a2++; }
      for (let x = a; x <= a2; x++) for (let k = b; k <= b2; k++) mark(x, k);
      if (rowsFirst) rects.push([U[b], U[b2 + 1], V[a], V[a2 + 1]]);
      else rects.push([U[a], U[a2 + 1], V[b], V[b2 + 1]]);
    }
    return rects;
  };
  const r1s = decompose(true), r2s = decompose(false);
  const rects = r1s.length <= r2s.length ? r1s : r2s;
  return rects.filter((r) => (r[1] - r[0]) > 1.5 && (r[3] - r[2]) > 1.5).map((r) => {
    const [cx, cz] = fromUV((r[0] + r[1]) / 2, (r[2] + r[3]) / 2);
    return [r1(cx), r1(cz), r1((r[1] - r[0]) / 2), r1((r[3] - r[2]) / 2), Math.round(Math.atan2(uz, ux) * 1000) / 1000];
  });
}

const buildings = [];
const pushBuilding = (id, tags, rings) => {
  if (!rings.length) return;
  let outerPts = rings[0];
  if (signedArea(outerPts) < 0) outerPts = outerPts.slice().reverse();
  const area = Math.abs(signedArea(outerPts));
  if (area < 6) return;
  const box = minAreaBox(outerPts);
  const rectness = box ? area / box.area : 0;
  const [cx, cz] = centroid(outerPts);
  const rural = cx < -400 || cz < -150 || cz > 1150;
  const style = styleFor({
    id, name: tags.name || '', tag: tags.building, levels: parseNum(tags['building:levels']), height: parseNum(tags.height),
    area, rectness, nverts: outerPts.length, rural,
  });
  const rec = {
    id, n: tags.name || undefined, a: Math.round(area), t: tags.building,
    p: outerPts.flatMap((p) => [r1(p[0]), r1(p[1])]),
    ...(rings.length > 1 ? { holes: rings.slice(1).map((r) => r.flatMap((p) => [r1(p[0]), r1(p[1])])) } : {}),
    s: style,
  };
  if ((style.roof === 'hip' || style.roof === 'gable') && rec.holes) rec.s.roof = 'flat';
  if (!rec.holes && area < 7000 && outerPts.length <= 90) {
    const rects = decomposeRects(outerPts);
    if (rects.length && rects.length <= 8) rec.rects = rects;
    else if ((style.roof === 'hip' || style.roof === 'gable')) rec.s.roof = 'hipPoly';
  } else if (style.roof === 'hip' || style.roof === 'gable') rec.s.roof = 'flat';
  buildings.push(rec);
};

for (const e of bj) {
  const tags = e.tags || {};
  if (tags.building === 'no') continue;
  if (e.type === 'way' && e.geometry) {
    const ring = closeRing(geomToPts(e.geometry));
    if (ring.length >= 3) pushBuilding(e.id, tags, [ring]);
  } else if (e.type === 'relation' && e.members) {
    const outers = e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => geomToPts(m.geometry));
    const inners = e.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => geomToPts(m.geometry));
    const oRings = joinRings(outers), iRings = joinRings(inners);
    for (const o of oRings) pushBuilding(e.id * 10 + oRings.indexOf(o), tags, [o, ...iRings]);
  }
}
console.log('buildings', buildings.length);

// ---------------------------------------------------------------- roads, areas, lines
const wj = JSON.parse(fs.readFileSync(path.join(RAW, 'ways.json'))).elements;
// campus boundary (amenity=university) -> landscaped grounds
if (fs.existsSync(path.join(RAW, 'university.json'))) {
  for (const e of JSON.parse(fs.readFileSync(path.join(RAW, 'university.json'))).elements) {
    if (e.type === 'way' && e.geometry && e.tags && e.tags.amenity === 'university' && !e.tags.building) wj.push(e);
  }
}
const nj = JSON.parse(fs.readFileSync(path.join(RAW, 'nodes.json'))).elements;

const ROADW = {
  motorway: 14, motorway_link: 8, trunk: 13, trunk_link: 7, primary: 11, primary_link: 6, secondary: 10, tertiary: 9, tertiary_link: 6,
  unclassified: 7, residential: 7.5, living_street: 6, service: 5.2, track: 3.4, footway: 2.6, path: 1.8, cycleway: 2.6,
  pedestrian: 4.5, steps: 2.4, bridleway: 2,
};
const roads = [];
const areas = [];
const lines = [];

const polyAreaKind = (t) => {
  if (t.amenity === 'parking') return { k: t.parking === 'multi-storey' ? 'garage_roof' : 'parking' };
  if (t.natural === 'water' || t.waterway === 'riverbank') return { k: 'water' };
  if (t.leisure === 'swimming_pool') return { k: 'pool' };
  if (t.leisure === 'pitch') return { k: 'pitch', sport: t.sport, surf: t.surface };
  if (t.leisure === 'track') return { k: 'track' };
  if (t.leisure === 'bleachers' || t.leisure === 'bleacher') return { k: 'bleachers' };
  if (['park', 'garden', 'common', 'playground', 'recreation_ground', 'dog_park', 'nature_reserve', 'golf_course'].includes(t.leisure)) return { k: t.leisure === 'playground' ? 'playground' : 'lawn' };
  if (['outdoor_seating', 'schoolyard', 'marina'].includes(t.leisure)) return { k: 'plaza' };
  if (t.natural === 'wood' || t.landuse === 'forest') return { k: 'wood' };
  if (t.natural === 'scrub') return { k: 'scrub' };
  if (t.natural === 'grassland' || t.landuse === 'meadow') return { k: 'meadow' };
  if (t.natural === 'bare_rock' || t.natural === 'scree') return { k: 'rock' };
  if (t.natural === 'wetland') return { k: 'wetland' };
  if (t.natural === 'sand' || t.natural === 'beach') return { k: 'sand' };
  if (['grass', 'village_green', 'recreation_ground', 'greenfield'].includes(t.landuse)) return { k: 'lawn' };
  if (t.landuse === 'farmland' || t.landuse === 'farm') return { k: 'farm' };
  if (t.landuse === 'orchard') return { k: 'orchard' };
  if (t.landuse === 'vineyard') return { k: 'vineyard' };
  if (t.landuse === 'farmyard' || t.landuse === 'construction' || t.landuse === 'brownfield' || t.landuse === 'quarry') return { k: 'dirt' };
  if (['residential', 'commercial', 'retail', 'industrial', 'education', 'institutional', 'religious', 'cemetery'].includes(t.landuse)) return { k: 'urban', lu: t.landuse };
  if (['university', 'college', 'school'].includes(t.amenity)) return { k: 'urban', lu: 'education' };
  return null;
};

const pts2flat = (pts) => pts.flatMap((p) => [r1(p[0]), r1(p[1])]);

for (const e of wj) {
  const t = e.tags || {};
  if (e.type === 'relation') {
    const kind = polyAreaKind(t);
    if (!kind || !e.members) continue;
    const outers = e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => geomToPts(m.geometry));
    const inners = e.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => geomToPts(m.geometry));
    const rings = [...joinRings(outers), ...joinRings(inners)];
    if (rings.length) areas.push({ ...kind, nm: t.name, rings: rings.map(pts2flat) });
    continue;
  }
  if (!e.geometry) continue;
  const pts = geomToPts(e.geometry);
  if (pts.length < 2) continue;

  if (t.highway && ROADW[t.highway] !== undefined) {
    if (t.tunnel && t.tunnel !== 'no') continue;
    let w = parseNum(t.width) || ROADW[t.highway];
    if (!t.width && t.lanes && ['residential', 'tertiary', 'secondary', 'primary', 'trunk', 'unclassified'].includes(t.highway)) w = Math.max(w, parseNum(t.lanes) * 3.4);
    let k = 'road';
    if (['footway', 'path', 'cycleway', 'pedestrian', 'bridleway'].includes(t.highway)) k = 'walk';
    if (t.highway === 'steps') k = 'steps';
    if (t.highway === 'track') k = 'dirt';
    if (t.highway === 'footway' && t.footway === 'crossing') k = 'crossing';
    if (t.highway === 'footway' && t.footway === 'sidewalk') w = Math.min(w, 2.0);
    if (t.highway === 'service' && t.service === 'parking_aisle') w = 5.5;
    if (t.highway === 'service' && t.service === 'driveway') w = 3.6;
    const unpaved = ['unpaved', 'dirt', 'ground', 'gravel', 'grass', 'compacted', 'fine_gravel', 'earth', 'mud', 'sand'].includes(t.surface);
    if (k === 'walk' && unpaved) { k = 'dirt'; }
    if (k === 'road' && unpaved) k = 'dirt';
    const sf = ['paving_stones', 'sett', 'brick', 'pavers', 'cobblestone'].includes(t.surface) ? 'paver' : undefined;
    roads.push({ k, sf, sv: t.service, hw: t.highway, w: r1(w), nm: t.name, br: t.bridge && t.bridge !== 'no' ? 1 : undefined, p: pts2flat(pts), ln: t.lanes ? parseNum(t.lanes) : undefined, ow: t.oneway === 'yes' ? 1 : undefined, lit: t.lit === 'yes' ? 1 : undefined });
    continue;
  }
  if (t.waterway === 'stream' || t.waterway === 'river' || t.waterway === 'drain' || t.waterway === 'canal') {
    if (t.tunnel && t.tunnel !== 'no') continue;
    roads.push({ k: 'stream', w: t.waterway === 'river' ? 8 : 2.2, nm: t.name, p: pts2flat(pts) });
    continue;
  }
  if (t.barrier === 'fence' || t.barrier === 'wall' || t.barrier === 'retaining_wall') {
    lines.push({ k: t.barrier === 'fence' ? 'fence' : t.barrier === 'wall' ? 'wall' : 'retaining', h: parseNum(t.height) || (t.barrier === 'fence' ? 1.5 : t.barrier === 'wall' ? 1.4 : 1.6), p: pts2flat(pts) });
    continue;
  }
  if (t.railway === 'rail') { lines.push({ k: 'rail', p: pts2flat(pts) }); continue; }
  if (t.natural === 'tree_row') { lines.push({ k: 'tree_row', p: pts2flat(pts) }); continue; }

  const kind = polyAreaKind(t);
  if (kind) {
    const ring = closeRing(pts);
    if (ring.length >= 3) areas.push({ ...kind, nm: t.name, rings: [pts2flat(ring)] });
  }
}
console.log('roads', roads.length, 'areas', areas.length, 'lines', lines.length);

// ---------------------------------------------------------------- point features
const trees = [], bench = [], bike = [], lamp = [], bin = [], flagpole = [], misc = [];
for (const e of nj) {
  const t = e.tags || {};
  const [x, z] = project(e.lat, e.lon);
  const q = [r1(x), r1(z)];
  if (t.natural === 'tree') trees.push([...q, t.leaf_type === 'needleleaved' ? 1 : t.genus === 'Eucalyptus' ? 2 : t.genus === 'Phoenix' || t.genus === 'Washingtonia' ? 3 : 0]);
  else if (t.amenity === 'bench') bench.push([...q, parseNum(t.direction) || 0]);
  else if (t.amenity === 'bicycle_parking') bike.push(q);
  else if (t.highway === 'street_lamp') lamp.push(q);
  else if (t.amenity === 'waste_basket') bin.push(q);
  else if (t.man_made === 'flagpole') flagpole.push(q);
  else if (t.tourism === 'artwork' || t.historic || t.man_made === 'tower' || t.man_made === 'mast') misc.push([...q, t.name || t.tourism || t.historic || t.man_made]);
}
console.log('trees', trees.length, 'bench', bench.length, 'bike', bike.length, 'lamp', lamp.length);

// ---------------------------------------------------------------- write
const data = {
  origin: { lat: LAT0, lon: LON0, elev: E0 },
  terrain: { core, outer, far },
  buildings, roads, areas, lines,
  points: { trees, bench, bike, lamp, bin, flagpole, misc },
  attribution: 'Map data © OpenStreetMap contributors (ODbL). Elevation: Mapzen/AWS Terrain Tiles (USGS 3DEP et al.).',
};
fs.writeFileSync(path.join(OUT, 'campus.json'), JSON.stringify(data));
console.log('wrote campus.json', (fs.statSync(path.join(OUT, 'campus.json')).size / 1e6).toFixed(2), 'MB');
