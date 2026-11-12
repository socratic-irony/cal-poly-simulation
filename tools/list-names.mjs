import fs from 'node:fs';
import { geomToPts, closeRing, signedArea, centroid } from './osm-lib.mjs';
const d = JSON.parse(fs.readFileSync('data/raw/buildings.json'));
const rows = [];
for (const e of d.elements) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  const pts = closeRing(geomToPts(e.geometry));
  if (pts.length < 3) continue;
  const a = Math.abs(signedArea(pts));
  const c = centroid(pts);
  if (t.name || a > 1500) rows.push([t.name || '(unnamed)', t.building, Math.round(a), t['building:levels'] || '', Math.round(c[0]), Math.round(c[1])]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const r of rows.slice(0, 400)) console.log(r.join(' | '));
