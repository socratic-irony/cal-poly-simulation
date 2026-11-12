import * as THREE from 'three';
import { SPLAT } from './ground.js';

// Instanced grass tufts in a window around the camera (world-anchored, so they don't swim as you move).
// Placed only on lawn / natural ground (not on paving, buildings, farm soil or dirt).
function bladeTexture() {
  const W = 256, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let s = 7; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 110; i++) {
    const x = 10 + r() * (W - 20), h = H * (0.35 + r() * 0.65), lean = (r() - 0.5) * 60, w = 2 + r() * 3;
    const grad = g.createLinearGradient(0, H, 0, H - h);
    const k = 0.75 + r() * 0.35;
    grad.addColorStop(0, `rgba(${Math.round(125 * k)},${Math.round(135 * k)},${Math.round(85 * k)},1)`);
    grad.addColorStop(1, `rgba(${Math.round(195 * k)},${Math.round(200 * k)},${Math.round(145 * k)},1)`);
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(x - w / 2, H); g.quadraticCurveTo(x + lean * 0.3, H - h * 0.6, x + lean, H - h); g.quadraticCurveTo(x + lean * 0.3 + 1, H - h * 0.6, x + w / 2, H); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function tuftGeometry() {
  const pos = [], uv = [], nor = [], idx = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, ca = Math.cos(a) * 0.32, sa = Math.sin(a) * 0.32;
    const b = pos.length / 3;
    pos.push(-ca, 0, -sa, ca, 0, sa, ca, 1, sa, -ca, 1, -sa);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let m = 0; m < 4; m++) nor.push(0, 1, 0);           // up-facing normals: lit like the ground
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, hf, occ, canvasB, terrainUniforms) {
    this.hf = hf; this.occ = occ; this.R = 34; this.cell = 0.6; this.per = 3;
    // "no grass" grid from the farm-soil (R) and dirt (B) channels of the ground splat, 2 m cells
    const size = Math.round((2 * SPLAT.half) / 2);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvasB, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    this.nog = new Uint8Array(size * size); this.nsz = size;
    for (let i = 0; i < size * size; i++) this.nog[i] = d[i * 4] > 110 || d[i * 4 + 2] > 110 ? 1 : 0;
    const lawn = new Uint8Array(size * size); for (let i = 0; i < size * size; i++) lawn[i] = d[i * 4 + 1] > 110 ? 1 : 0; this.lawn = lawn;

    const max = Math.ceil(Math.PI * this.R * this.R / (this.cell * this.cell) * this.per);
    this.U = { uTime: { value: 0 }, uDry: terrainUniforms ? terrainUniforms.uDry : { value: 0.7 } };
    const mat = new THREE.MeshStandardMaterial({ map: bladeTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aLawn;\nvarying float vLawn;\nvarying float vH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLawn = aLawn; vH = position.y;
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          float sw = sin(uTime * 1.9 + ip.x * 0.31 + ip.z * 0.27) * 0.07 + sin(uTime * 3.1 + ip.x * 1.3) * 0.02;
          transformed.x += sw * position.y; transformed.z += sw * 0.6 * position.y;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uDry;\nvarying float vLawn;\nvarying float vH;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 lawnC = vec3(0.50, 0.66, 0.30), wild = mix(vec3(0.62, 0.80, 0.36), vec3(1.25, 1.0, 0.58), clamp(uDry, 0.0, 1.0));
          diffuseColor.rgb *= mix(wild, lawnC, vLawn) * (0.78 + 0.22 * vH);`);
    };
    mat.customProgramCacheKey = () => 'grass-v1';
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, max);
    this.aLawn = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.mesh.geometry.setAttribute('aLawn', this.aLawn);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.castShadow = false; this.mesh.name = 'grass';
    scene.add(this.mesh);
    this.last = [1e9, 1e9];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.sc = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
  }
  grid(x, z, arr) {
    const gx = Math.floor((x - SPLAT.cx + SPLAT.half) / 2), gz = Math.floor((z - SPLAT.cz + SPLAT.half) / 2);
    if (gx < 0 || gz < 0 || gx >= this.nsz || gz >= this.nsz) return 0;
    return arr[gz * this.nsz + gx];
  }
  update(cam, t) {
    this.U.uTime.value = t;
    const groundY = this.hf.at(cam.x, cam.z);
    const near = cam.y - groundY < 60;
    this.mesh.visible = near;
    if (!near) return;
    if (Math.hypot(cam.x - this.last[0], cam.z - this.last[1]) < 4) return;
    this.last = [cam.x, cam.z];
    const { R, cell, per } = this; let k = 0;
    const i0 = Math.floor((cam.x - R) / cell), i1 = Math.floor((cam.x + R) / cell);
    const j0 = Math.floor((cam.z - R) / cell), j1 = Math.floor((cam.z + R) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (let n = 0; n < per; n++) {
        let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(n + 1, 83492791)) >>> 0;
        const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
        const x = (i + rnd()) * cell, z = (j + rnd()) * cell;
        const d = Math.hypot(x - cam.x, z - cam.z); if (d > R) continue;
        if (this.occ.blocked(x, z) || this.grid(x, z, this.nog)) continue;
        const lawn = this.grid(x, z, this.lawn);
        if (lawn) continue;                                   // mowed lawns: no tufts (SSAO turned the sparse ones into black specks)
        const fade = 1 - Math.max(0, (d - R * 0.7) / (R * 0.3));
        const hgt = (lawn ? 0.09 + rnd() * 0.06 : 0.25 + rnd() * 0.3) * (0.4 + 0.6 * fade);
        this.q.setFromAxisAngle(this.up, rnd() * 6.28);
        this.v.set(x, this.hf.surface(x, z) - 0.02, z);
        this.sc.set(lawn ? 0.55 : 0.9, hgt, lawn ? 0.55 : 0.9);
        this.m.compose(this.v, this.q, this.sc);
        this.mesh.setMatrixAt(k, this.m); this.aLawn.array[k] = lawn;
        if (++k >= this.mesh.instanceMatrix.count) break;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true; this.aLawn.needsUpdate = true;
  }
}
