// Shared helpers: projection, geometry, ring assembly.
export const LAT0 = 35.3007;
export const LON0 = -120.6614;
const phi = (LAT0 * Math.PI) / 180;
export const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

// local coords: x = east (m), z = south (m), matching three.js (y up, +z toward the viewer / south)
export const project = (lat, lon) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
export const unproject = (x, z) => [LAT0 - z / M_LAT, LON0 + x / M_LON];

export const r1 = (v) => Math.round(v * 10) / 10;

export function geomToPts(geometry) {
  const pts = [];
  for (const g of geometry) {
    const [x, z] = project(g.lat, g.lon);
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - x) < 0.01 && Math.abs(last[1] - z) < 0.01) continue;
    pts.push([x, z]);
  }
  return pts;
}

export function closeRing(pts) {
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) return pts.slice(0, -1);
  }
  return pts;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function perimeter(pts) {
  let L = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    L += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return L;
}

export function centroid(pts) {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}

// Join way fragments (arrays of [x,z]) into closed rings.
export function joinRings(frags) {
  const rings = [];
  const pool = frags.map((f) => f.slice());
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
  while (pool.length) {
    let cur = pool.pop();
    let guard = 0;
    while (!eq(cur[0], cur[cur.length - 1]) && guard++ < 500) {
      const end = cur[cur.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        if (eq(pool[i][0], end)) { found = i; rev = false; break; }
        if (eq(pool[i][pool[i].length - 1], end)) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      let nxt = pool.splice(found, 1)[0];
      if (rev) nxt = nxt.slice().reverse();
      cur = cur.concat(nxt.slice(1));
    }
    if (cur.length >= 4 && eq(cur[0], cur[cur.length - 1])) rings.push(closeRing(cur));
  }
  return rings;
}

// Minimum-area oriented bounding box via rotating over edge directions.
export function minAreaBox(pts) {
  let best = null;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.1) continue;
    const ux = dx / len, uz = dz / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const r of pts) {
      const u = (r[0] - p[0]) * ux + (r[1] - p[1]) * uz;
      const v = -(r[0] - p[0]) * uz + (r[1] - p[1]) * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uz, minU, maxU, minV, maxV, px: p[0], pz: p[1] };
  }
  return best;
}

// deterministic hash -> [0,1)
export function hash01(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
