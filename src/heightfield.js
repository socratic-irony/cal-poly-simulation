import * as THREE from 'three';

// Bilinear height lookup over the two terrain grids (core = 8 m, outer = 40 m).
export class Heightfield {
  constructor(meta, coreArr, outerArr, farArr = null) {
    this.farArr = farArr;
    this.meta = meta;
    this.coreArr = coreArr;
    this.outerArr = outerArr;
  }

  _grid(g, arr, x, z) {
    const n = g.n;
    let fx = (x + g.half) / g.step, fz = (z + g.half) / g.step;
    fx = Math.min(Math.max(fx, 0), n - 1.001);
    fz = Math.min(Math.max(fz, 0), n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = arr[j * n + i], b = arr[j * n + i + 1], c = arr[(j + 1) * n + i], d = arr[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  at(x, z) {
    const c = this.meta.core;
    if (Math.abs(x) < c.half - c.step && Math.abs(z) < c.half - c.step) return this._grid(c, this.coreArr, x, z);
    const o = this.meta.outer;
    if (this.farArr && this.meta.far && (Math.abs(x) >= o.half - o.step || Math.abs(z) >= o.half - o.step)) return this._grid(this.meta.far, this.farArr, x, z);
    return this._grid(this.meta.outer, this.outerArr, x, z);
  }

  // height of the actual rendered core mesh (matches its triangulation exactly; falls back to bilinear outside)
  surface(x, z) {
    const g = this.meta.core, n = g.n;
    if (Math.abs(x) >= g.half - g.step || Math.abs(z) >= g.half - g.step) return this.at(x, z);
    const fx = (x + g.half) / g.step, fz = (z + g.half) / g.step;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = this.coreArr[j * n + i], b = this.coreArr[j * n + i + 1], c = this.coreArr[(j + 1) * n + i], d = this.coreArr[(j + 1) * n + i + 1];
    // triangles (a,c,b) and (b,c,d): diagonal b-c  (tx + tz = 1)
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  normalAt(x, z, e = 4) {
    const hx = this.at(x + e, z) - this.at(x - e, z);
    const hz = this.at(x, z + e) - this.at(x, z - e);
    return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
  }
}

function gridPositions(g, arr) {
  const n = g.n;
  const pos = new Float32Array(n * n * 3);
  const nor = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = -g.half + i * g.step;
      pos[k * 3 + 1] = arr[k];
      pos[k * 3 + 2] = -g.half + j * g.step;
      const hl = arr[j * n + Math.max(i - 1, 0)], hr = arr[j * n + Math.min(i + 1, n - 1)];
      const hu = arr[Math.max(j - 1, 0) * n + i], hd = arr[Math.min(j + 1, n - 1) * n + i];
      const nx = hl - hr, nz = hu - hd, ny = 2 * g.step;
      const l = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
    }
  }
  return { pos, nor };
}

export function buildTerrainMeshes(hf, material) {
  const { core, outer } = hf.meta;
  const group = new THREE.Group();

  // ---- core mesh (with a skirt so the seam to the outer ring never shows sky)
  {
    const n = core.n;
    const { pos, nor } = gridPositions(core, hf.coreArr);
    const idx = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // skirt
    const extraPos = [], extraNor = [];
    const base = n * n;
    let e = 0;
    const edge = [];
    for (let i = 0; i < n; i++) edge.push(i);                       // north edge (j=0)
    for (let j = 1; j < n; j++) edge.push(j * n + n - 1);           // east edge
    for (let i = n - 2; i >= 0; i--) edge.push((n - 1) * n + i);    // south edge
    for (let j = n - 2; j > 0; j--) edge.push(j * n);               // west edge
    for (const k of edge) {
      extraPos.push(pos[k * 3], pos[k * 3 + 1] - 8, pos[k * 3 + 2]);
      extraNor.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]);
    }
    for (let m = 0; m < edge.length; m++) {
      const m2 = (m + 1) % edge.length;
      const a = edge[m], b = edge[m2], c = base + m, d = base + m2;
      idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
    const P = new Float32Array(pos.length + extraPos.length); P.set(pos); P.set(extraPos, pos.length);
    const N = new Float32Array(nor.length + extraNor.length); N.set(nor); N.set(extraNor, nor.length);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setIndex(idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true; m.name = 'terrain-core';
    group.add(m);
    e++;
  }

  // ---- outer ring (cells inside the core are skipped)
  {
    const n = outer.n;
    const { pos, nor } = gridPositions(outer, hf.outerArr);
    const idx = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const cx = -outer.half + (i + 0.5) * outer.step, cz = -outer.half + (j + 0.5) * outer.step;
        if (Math.abs(cx) < core.half - 0.01 && Math.abs(cz) < core.half - 0.01) continue;
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true; m.name = 'terrain-outer';
    group.add(m);
  }
  // ---- far ring (cells fully inside the outer grid are skipped)
  if (hf.farArr && hf.meta.far) {
    const fg = hf.meta.far, n = fg.n;
    const { pos, nor } = gridPositions(fg, hf.farArr);
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const x0 = -fg.half + i * fg.step, z0 = -fg.half + j * fg.step, x1 = x0 + fg.step, z1 = z0 + fg.step;
      const inside = Math.max(Math.abs(x0), Math.abs(x1)) <= outer.half && Math.max(Math.abs(z0), Math.abs(z1)) <= outer.half;
      if (inside) continue;
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material); m.receiveShadow = false; m.name = 'terrain-far';
    group.add(m);
  }
  return group;
}
