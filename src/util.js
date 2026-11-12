import * as THREE from 'three';

export const url = (p) => import.meta.env.BASE_URL + p.replace(/^\//, '');

export async function loadJSON(p) {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`failed to load ${p}: ${r.status}`);
  return r.json();
}

export async function loadFloat32(p) {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`failed to load ${p}: ${r.status}`);
  return new Float32Array(await r.arrayBuffer());
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed: ' + src));
    img.src = src;
  });
}

const texLoader = new THREE.TextureLoader();
export function loadTexture(p, { srgb = true, anisotropy = 8 } = {}) {
  const t = texLoader.load(url(p));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

// load diff / nor / rough set for a named texture folder
export function loadPBR(name, anisotropy = 8) {
  return {
    map: loadTexture(`textures/${name}/diff.jpg`, { srgb: true, anisotropy }),
    normalMap: loadTexture(`textures/${name}/nor.jpg`, { srgb: false, anisotropy }),
    roughnessMap: loadTexture(`textures/${name}/rough.jpg`, { srgb: false, anisotropy }),
  };
}

// deterministic PRNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function pointInRing(x, z, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
