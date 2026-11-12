import * as THREE from 'three';
// shared "how dark is it" uniform (0 = day, 1 = full night); every shader that cares reads this one object
export const NIGHT = { value: 0 };
export const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// glowing pools of light under street lamps (additive decals), visible only at night
export function buildLampGlow(points) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,214,150,0.55)'); grd.addColorStop(0.35, 'rgba(255,190,110,0.22)'); grd.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, fog: false });
  const geo = new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, points.length);
  const m = new THREE.Matrix4();
  points.forEach((p, i) => { m.makeTranslation(p.x, p.y + 0.12, p.z); mesh.setMatrixAt(i, m); });
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'lamp-glow';
  return { mesh, mat };
}

export function buildStars() {
  const n = 1800, pos = new Float32Array(n * 3);
  let s = 12345; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
    const y = Math.abs(u) * 0.97 + 0.03;                 // upper hemisphere only
    pos[i * 3] = Math.cos(th) * rr * 15000; pos[i * 3 + 1] = y * 15000; pos[i * 3 + 2] = Math.sin(th) * rr * 15000;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = -2;
  return { pts, mat };
}
