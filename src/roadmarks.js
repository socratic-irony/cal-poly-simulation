import * as THREE from 'three';
import { pointInRing } from './util.js';

// Paint on the asphalt: centre lines, edge lines, zebra crosswalks and parking stalls.
// Built as thin quads that follow the exact rendered terrain surface.
class Quads {
  constructor() { this.pos = []; this.idx = []; }
  // quad given in any winding: orient it so the face normal points up (+Y)
  quad(a, b, c, d) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);   // y component of (b-a)x(c-a)
    if (cy >= 0) this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3); else this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  mesh(mat, name) {
    if (!this.pos.length) return new THREE.Group();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const nor = new Float32Array(this.pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(this.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = name; m.renderOrder = 2;
    return m;
  }
}

export function buildRoadMarks(data, hf) {
  const white = new Quads(), yellow = new Quads(), blue = new Quads();
  const LIFT = 0.035;
  const P = (x, z) => [x, hf.surface(x, z) + LIFT, z];

  // thin quad from segment a->b with width w
  const seg = (q, ax, az, bx, bz, w) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 1e-3) return;
    const nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
    q.quad(P(ax + nx, az + nz), P(bx + nx, bz + nz), P(bx - nx, bz - nz), P(ax - nx, az - nz));
  };

  // offset polyline strip (resampled so it hugs the terrain). dash = [on, off] metres or null
  const strip = (q, pts, offset, width, dash = null) => {
    let run = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
      const step = 2.0;
      for (let s = 0; s < L; s += step) {
        const s2 = Math.min(L, s + step);
        let on = true;
        if (dash) { const m = (run + s) % (dash[0] + dash[1]); on = m < dash[0]; }
        if (on) seg(q, ax + dx * s + nx * offset, az + dz * s + nz * offset, ax + dx * s2 + nx * offset, az + dz * s2 + nz * offset, width);
      }
      run += L;
    }
  };

  for (const r of data.roads) {
    if (r.k === 'road' && !r.br) {
      const major = ['trunk', 'primary', 'secondary', 'tertiary'].includes(r.hw);
      if (major && r.w >= 7) {
        strip(yellow, r.p, 0.11, 0.12); strip(yellow, r.p, -0.11, 0.12);
        strip(white, r.p, r.w / 2 - 0.4, 0.15); strip(white, r.p, -(r.w / 2 - 0.4), 0.15);
      } else if ((r.hw === 'unclassified' || r.hw === 'service' || r.hw === 'residential') && r.nm && r.w >= 6.4 && r.sv !== 'parking_aisle') {
        strip(yellow, r.p, 0, 0.12, [3.6, 8.4]);
        if (r.w >= 7.2) { strip(white, r.p, r.w / 2 - 0.45, 0.12); strip(white, r.p, -(r.w / 2 - 0.45), 0.12); }
      }
    } else if (r.k === 'crossing') {
      const p = r.p; const ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 3 || L > 40) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
      const half = Math.max(1.3, Math.min(r.w, 4) / 2);
      for (let s = 0.7; s < L - 0.5; s += 0.95) {
        const cx = ax + dx * s, cz = az + dz * s;
        // bars run parallel to traffic, i.e. perpendicular to the crossing line
        for (const seg2 of [[-half, 0], [0, half]]) {
          const o0 = seg2[0], o1 = seg2[1];
          white.quad(P(cx + nx * o0 - dx * 0.24, cz + nz * o0 - dz * 0.24), P(cx + nx * o1 - dx * 0.27, cz + nz * o1 - dz * 0.27),
            P(cx + nx * o1 + dx * 0.24, cz + nz * o1 + dz * 0.24), P(cx + nx * o0 + dx * 0.24, cz + nz * o0 + dz * 0.24));
        }
      }
    }
  }

  // parking stalls
  let lots = 0;
  const stalls = [];
  for (const a of data.areas) {
    if (a.k !== 'parking') continue;
    const ring = a.rings[0]; if (!ring || ring.length < 8) continue;
    // oriented bounding box via longest edge direction
    let best = 0, ang = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length; const l = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
      if (l > best) { best = l; ang = Math.atan2(ring[j + 1] - ring[i + 1], ring[j] - ring[i]); }
    }
    const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
    let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
    for (let i = 0; i < ring.length; i += 2) {
      const u = ring[i] * ux + ring[i + 1] * uz, v = ring[i] * vx + ring[i + 1] * vz;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    if ((maxU - minU) * (maxV - minV) < 220) continue;
    const toXZ = (u, v) => [u * ux + v * vx, u * uz + v * vz];
    const inside = (u, v) => { const [x, z] = toXZ(u, v); return pointInRing(x, z, ring); };
    const firstStall = stalls.length;
    // rows of stalls along V; each stall line runs along U. module: stall 5.2 | aisle 7 | stall 5.2
    const stall = 5.2, aisle = 7.0, sw = 2.7;
    for (let v0 = minV + 0.4; v0 < maxV - stall; v0 += stall * 2 + aisle) {
      for (const band of [[v0, v0 + stall], [v0 + stall + aisle, v0 + stall * 2 + aisle]]) {
        for (let u = minU + 1; u < maxU - 1; u += sw) {
          // line across the band (along V) if both ends inside
          const a0 = band[0], a1 = band[1];
          if (!inside(u, a0 + 0.3) || !inside(u, a1 - 0.3)) continue;
          const [x0, z0] = toXZ(u, a0), [x1, z1] = toXZ(u, a1);
          seg(white, x0, z0, x1, z1, 0.13);
          { const [cx, cz] = toXZ(u + sw / 2, (a0 + a1) / 2); if (inside(u + sw / 2, a0 + 0.3) && inside(u + sw / 2, a1 - 0.3)) stalls.push([cx, cz, Math.atan2(vz, vx)]); }
        }
        // back line of the stalls
        const edge = band[0] === v0 ? v0 : band[1];
        let on = false, startU = 0;
        for (let u = minU + 1; u < maxU - 1; u += 1) {
          const ok = inside(u, edge + (band[0] === v0 ? 0.3 : -0.3));
          if (ok && !on) { on = true; startU = u; }
          if ((!ok || u + 1 >= maxU - 1) && on) { on = false; const [x0, z0] = toXZ(startU, edge), [x1, z1] = toXZ(u, edge); seg(white, x0, z0, x1, z1, 0.13); }
        }
      }
    }
    // one blue accessible stall per decent-sized lot (first stall generated)
    if (stalls.length - firstStall >= 14) {
      const st = stalls[firstStall];
      const ax = Math.cos(st[2]), az = Math.sin(st[2]), px = -az, pz = ax;
      const hw = 1.2, hl = 2.5;
      blue.quad(P(st[0] - px * hw - ax * hl, st[1] - pz * hw - az * hl), P(st[0] + px * hw - ax * hl, st[1] + pz * hw - az * hl), P(st[0] + px * hw + ax * hl, st[1] + pz * hw + az * hl), P(st[0] - px * hw + ax * hl, st[1] - pz * hw + az * hl));
      // simple pictogram: white head + body
      white.quad(P(st[0] - 0.22 + ax * 0.9, st[1] - 0.22 + az * 0.9), P(st[0] + 0.22 + ax * 0.9, st[1] - 0.22 + az * 0.9), P(st[0] + 0.22 + ax * 0.9, st[1] + 0.22 + az * 0.9), P(st[0] - 0.22 + ax * 0.9, st[1] + 0.22 + az * 0.9));
      white.quad(P(st[0] - 0.3 - ax * 0.4, st[1] - 0.3 - az * 0.4), P(st[0] + 0.3 - ax * 0.4, st[1] - 0.3 - az * 0.4), P(st[0] + 0.3 + ax * 0.5, st[1] + 0.3 + az * 0.5), P(st[0] - 0.3 + ax * 0.5, st[1] + 0.3 + az * 0.5));
    }
    lots++;
  }

  const group = new THREE.Group(); group.name = 'roadmarks';
  const mk = (color, rough) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPW = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;\nfloat ph(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }\nfloat pn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(ph(i),ph(i+vec2(1,0)),f.x), mix(ph(i+vec2(0,1)),ph(i+vec2(1,1)),f.x), f.y); }')
        .replace('#include <map_fragment>', '#include <map_fragment>\nfloat wear = 0.62 + 0.38 * smoothstep(0.25, 0.7, pn(vPW.xz * 1.7) * 0.6 + pn(vPW.xz * 9.0) * 0.4);\ndiffuseColor.rgb *= wear;');
    };
    m.customProgramCacheKey = () => 'paint';
    return m;
  };
  group.add(white.mesh(mk(0xf1efe6, 0.75), 'paint-white'));
  group.add(yellow.mesh(mk(0xe2b52a, 0.75), 'paint-yellow'));
  group.add(blue.mesh(mk(0x2a5fc0, 0.75), 'paint-blue'));
  return { group, lots, stalls };
}
