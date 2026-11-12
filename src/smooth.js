// Smooth the (coarse) OpenStreetMap centre lines so curbs, lane paint, sidewalks and the painted ground all follow real curves.
//   1. sharp corners get a circular-ish fillet (quadratic Bezier) so there are no angular kinks
//   2. everything is passed through a centripetal Catmull-Rom spline, sampled every ~step metres
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp2 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

function catmullSegment(P0, P1, P2, P3, ns, out) {
  const d01 = Math.sqrt(dist(P0, P1)) || 1e-4, d12 = Math.sqrt(dist(P1, P2)) || 1e-4, d23 = Math.sqrt(dist(P2, P3)) || 1e-4;
  const t0 = 0, t1 = t0 + d01, t2 = t1 + d12, t3 = t2 + d23;
  for (let s = 1; s <= ns; s++) {
    const t = t1 + ((t2 - t1) * s) / ns;
    const A1 = lerp2(P0, P1, (t - t0) / (t1 - t0)), A2 = lerp2(P1, P2, (t - t1) / (t2 - t1)), A3 = lerp2(P2, P3, (t - t2) / (t3 - t2));
    const B1 = lerp2(A1, A2, (t - t0) / (t2 - t0)), B2 = lerp2(A2, A3, (t - t1) / (t3 - t1));
    out.push(lerp2(B1, B2, (t - t1) / (t2 - t1)));
  }
}

export function smoothFlat(p, { fillet = 4, angle = 48, step = 1.0 } = {}) {
  // dedupe
  let pts = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const q = [p[i], p[i + 1]];
    if (!pts.length || dist(pts[pts.length - 1], q) > 0.05) pts.push(q);
  }
  if (pts.length < 3) return p;
  const closed = dist(pts[0], pts[pts.length - 1]) < 0.3;
  if (closed) pts.pop();
  const n0 = pts.length;
  if (n0 < 3) return p;

  // 1) corner fillets
  const cosT = Math.cos((angle * Math.PI) / 180);
  const filleted = [];
  const nextI = (i) => (i + 1) % n0, prevI = (i) => (i + n0 - 1) % n0;
  for (let i = 0; i < n0; i++) {
    const v = pts[i];
    if (!closed && (i === 0 || i === n0 - 1)) { filleted.push(v); continue; }
    const a = pts[prevI(i)], b = pts[nextI(i)];
    const l0 = dist(a, v), l1 = dist(v, b);
    if (l0 < 1e-3 || l1 < 1e-3) { filleted.push(v); continue; }
    const d0 = [(v[0] - a[0]) / l0, (v[1] - a[1]) / l0], d1 = [(b[0] - v[0]) / l1, (b[1] - v[1]) / l1];
    const dot = d0[0] * d1[0] + d0[1] * d1[1];
    if (dot > cosT) { filleted.push(v); continue; }                    // gentle: leave to the spline
    const th = Math.acos(Math.max(-1, Math.min(1, dot)));
    const c = Math.min(fillet * Math.tan(th / 2), 0.45 * l0, 0.45 * l1);
    if (c < 0.4) { filleted.push(v); continue; }
    const pin = [v[0] - d0[0] * c, v[1] - d0[1] * c], pout = [v[0] + d1[0] * c, v[1] + d1[1] * c];
    const k = Math.max(3, Math.ceil((c * 2.2) / step));
    filleted.push(pin);
    for (let s = 1; s < k; s++) {
      const t = s / k, u = 1 - t;
      filleted.push([u * u * pin[0] + 2 * u * t * v[0] + t * t * pout[0], u * u * pin[1] + 2 * u * t * v[1] + t * t * pout[1]]);
    }
    filleted.push(pout);
  }

  // 2) spline through everything
  const n = filleted.length;
  const out = [filleted[0]];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const P1 = filleted[i], P2 = filleted[(i + 1) % n];
    const P0 = closed || i > 0 ? filleted[(i + n - 1) % n] : [2 * P1[0] - P2[0], 2 * P1[1] - P2[1]];
    const P3 = closed || i + 2 < n ? filleted[(i + 2) % n] : [2 * P2[0] - P1[0], 2 * P2[1] - P1[1]];
    const ns = Math.max(1, Math.ceil(dist(P1, P2) / step));
    catmullSegment(P0, P1, P2, P3, ns, out);
  }
  const flat = new Array(out.length * 2);
  for (let i = 0; i < out.length; i++) { flat[i * 2] = Math.round(out[i][0] * 100) / 100; flat[i * 2 + 1] = Math.round(out[i][1] * 100) / 100; }
  return flat;
}

export function smoothRoads(data) {
  let before = 0, after = 0;
  for (const r of data.roads) {
    before += r.p.length / 2;
    if (r.k === 'steps' || r.k === 'crossing') { after += r.p.length / 2; continue; }
    const road = r.k === 'road';
    r.p = smoothFlat(r.p, { fillet: road ? Math.max(4.5, r.w * 0.65) : r.k === 'stream' ? 3 : 1.8, angle: road ? 46 : 40, step: road ? 1.0 : 1.2 });
    after += r.p.length / 2;
  }
  return { before, after };
}
