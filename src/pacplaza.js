import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pacCurve } from './buildings.js';

// The plaza in front (SE) of the Christopher Cohan Performing Arts Center: warm scored-concrete paving with a
// brick-pink border, a sweep of black bollards, benches facing the hall and a pair of concrete spheres.
// Everything is laid out relative to the hall's smoothed front curve (see pacCurve in buildings.js).
export function buildPacPlaza(hf) {
  const group = new THREE.Group(); group.name = 'pac-plaza';
  const { pts, nrm, arc, N } = pacCurve();
  const L = arc[N - 1];
  const out = (i, d) => [pts[i][0] - nrm[i][0] * d, pts[i][1] - nrm[i][1] * d];   // d metres outward (toward the plaza)
  const idxAt = (u) => Math.min(N - 1, Math.max(0, Math.round(u * (N - 1))));
  const reach = (u) => 11 + 7 * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));  // how far the paving fans out

  // ---- paving: a draped strip with scored joints
  {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#cbb9a3'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) { const v = 170 + Math.random() * 60; g.fillStyle = `rgba(${v + 18},${v},${v - 18},0.16)`; g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    g.strokeStyle = 'rgba(95,80,66,0.55)'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 509, 509);
    g.strokeStyle = 'rgba(95,80,66,0.25)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const NU = N - 1, NV = 12, pos = [], uv = [], idx = [], col = [];
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, R = reach(u);
      for (let j = 0; j <= NV; j++) {
        const d = -0.6 + (R + 0.6) * (j / NV), [x, z] = out(i, d);
        pos.push(x, hf.surface(x, z) + 0.07, z); uv.push(arc[i] / 3, d / 3);
        const border = j === NV ? 1 : 0; col.push(1, 1, 1); void border;
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.name = 'pac-paving'; group.add(m);
    // brick-pink border band following the far edge
    const bp = [], bi = [];
    for (let i = 0; i <= NU; i++) {
      const R = reach(i / NU);
      for (const d of [R, R + 1.1]) { const [x, z] = out(i, d); bp.push(x, hf.surface(x, z) + 0.09, z); }
    }
    for (let i = 0; i < NU; i++) { const a = i * 2, b = a + 2; bi.push(a, a + 1, b, b, a + 1, b + 1); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bg.setIndex(bi); bg.computeVertexNormals();
    const bm = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0xb98f7f, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    bm.receiveShadow = true; group.add(bm);
  }

  // ---- instanced furniture
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, list, name) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, k) => { dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(0, o.rot || 0, 0); dummy.scale.setScalar(o.s || 1); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix); });
    im.castShadow = true; im.receiveShadow = true; im.name = name; group.add(im);
  };
  const at = (u, d, extra = {}) => { const i = idxAt(u), [x, z] = out(i, d); return { x, z, y: hf.surface(x, z), ...extra }; };

  // bollards: a gentle sweep following the glass line, ~9 m out
  const boll = [];
  for (let s = 3; s < L - 2; s += 4.2) { const u = s / L; const p = at(u, 9.5 + 1.5 * Math.sin(u * 6.28)); boll.push(p); }
  const bg2 = new THREE.CylinderGeometry(0.12, 0.13, 1.0, 10); bg2.translate(0, 0.5, 0);
  const cap = new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10); cap.translate(0, 1.02, 0);
  inst(mergeGeometries([bg2, cap].map((g) => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.45, metalness: 0.55 }), boll, 'pac-bollards');

  // benches facing the hall (slatted wood on concrete ends)
  const benches = [];
  for (const u of [0.10, 0.16, 0.22, 0.28]) { const i = idxAt(u); const p = at(u, 15 + 1.5 * ((u * 100) % 2)); p.rot = Math.atan2(nrm[i][0], nrm[i][1]); benches.push(p); }  // seats face the hall
  const bb = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); };
  const wood = [bb(2.0, 0.06, 0.26, 0, 0.46, -0.15), bb(2.0, 0.06, 0.26, 0, 0.46, 0.15), bb(2.0, 0.06, 0.18, 0, 0.82, -0.28)];
  const conc = [bb(0.14, 0.46, 0.7, -0.9, 0.23, 0), bb(0.14, 0.46, 0.7, 0.9, 0.23, 0)];
  const wg = mergeGeometries(wood), cg = mergeGeometries(conc);
  inst(wg, new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.7 }), benches, 'pac-bench-seats');
  inst(cg, new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.9 }), benches, 'pac-bench-ends');

  // globes: one at the southwest end by the bench cluster, two toward the south side
  const spheres = [at(0.03, 17), at(0.46, 21), at(0.6, 20)].map((p, k) => ({ ...p, y: p.y + 1.65, rot: k * 1.9 }));
  // open silver wire-mesh globe: many thin steel rings on random great circles (a woven "maze" look)
  {
    const R = 1.65, parts = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const e = new THREE.Euler(), q = new THREE.Quaternion(), m = new THREE.Matrix4();
    for (let k = 0; k < 46; k++) {
      const t = new THREE.TorusGeometry(R * (0.97 + rnd() * 0.05), 0.018, 4, 40, k % 3 === 0 ? Math.PI * (0.8 + rnd() * 0.9) : Math.PI * 2);
      e.set(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI); q.setFromEuler(e); m.makeRotationFromQuaternion(q); t.applyMatrix4(m);
      parts.push(t.toNonIndexed());
    }
    for (const lat of [-0.5, 0, 0.5]) { const r = R * Math.sqrt(1 - lat * lat), t = new THREE.TorusGeometry(r, 0.022, 4, 48); t.rotateX(Math.PI / 2); t.translate(0, lat * R, 0); parts.push(t.toNonIndexed()); }
    inst(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xc9ced1, roughness: 0.28, metalness: 0.95 }), spheres, 'pac-globes');
    // dappled shadow disc on the paving (the lattice casts a lacy shadow)
    const dc = document.createElement('canvas'); dc.width = dc.height = 128; const dg = dc.getContext('2d');
    const gr = dg.createRadialGradient(64, 64, 8, 64, 64, 62); gr.addColorStop(0, 'rgba(40,34,30,0.30)'); gr.addColorStop(1, 'rgba(40,34,30,0)');
    dg.fillStyle = gr; dg.fillRect(0, 0, 128, 128);
    const sm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(dc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const sp of spheres) { const d = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5), sm); d.rotation.x = -Math.PI / 2; d.position.set(sp.x + 0.8, sp.y - 1.65 + 0.11, sp.z + 0.8); group.add(d); }
  }

  return group;
}
