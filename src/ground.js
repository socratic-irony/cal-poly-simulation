import * as THREE from 'three';
import { loadImage, url, rng } from './util.js';
import { GLSL_COMMON } from './shading.js';

// ------------------------------------------------------------------ splat rasterisation
// Two RGB canvases encode ground classes from OSM:
//   A: R asphalt   G concrete walkway   B pavers / brick
//   B: R farm soil G managed lawn       B dirt / gravel
// Anything unpainted falls back to natural hillside grass in the shader.
export const SPLAT = { size: 4096, cx: -380, cz: 70, half: 1300 };

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  return { c, ctx };
}

export function rasterizeGround(data, gcImg = null) {
  const { size, cx, cz, half } = SPLAT;
  const sc = size / (2 * half);
  const X = (x) => (x - cx + half) * sc;
  const Z = (z) => (z - cz + half) * sc;
  const A = makeCanvas(size), B = makeCanvas(size);

  const poly = (ctx, rings, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(r[i]), Z(r[i + 1]));
      ctx.closePath();
    }
    ctx.fill('evenodd');
  };
  const stroke = (ctx, p, w, color, cap = 'round') => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(w * sc, 1); ctx.lineCap = cap; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(p[i]), Z(p[i + 1]));
    ctx.stroke();
  };

  const ASPH = '#ff0000', CONC = '#00ff00', PAVE = '#0000ff';

  // unmapped paved plazas (-> concrete) and irrigated lawns (-> lawn) classified from the aerial photo + LiDAR
  if (gcImg) {
    const W = gcImg.width, H = gcImg.height;
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tc = t.getContext('2d', { willReadFrequently: true }); tc.drawImage(gcImg, 0, 0);
    const src = tc.getImageData(0, 0, W, H).data;
    const mk = (ch, f = (v) => v) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx2 = c.getContext('2d'); const im = cx2.createImageData(W, H);
      for (let i = 0; i < W * H; i++) { im.data[i * 4 + 1] = 255; im.data[i * 4 + 3] = f(src[i * 4 + ch]); }
      cx2.putImageData(im, 0, 0); return c;
    };
    // lawn channel: 255 = irrigated lawn, 128 = planting bed / groundcover (erased from the landscaped fill below)
    var bedMask = mk(1, (v) => (v > 64 && v < 192 ? 255 : 0)), bedRect = null;
    const dx = X(-2000), dy = Z(-2000), dw = 4000 * sc;
    A.ctx.imageSmoothingEnabled = true; B.ctx.imageSmoothingEnabled = true;
    A.ctx.drawImage(mk(0), dx, dy, dw, dw);
    B.ctx.drawImage(mk(1, (v) => (v >= 192 ? 255 : 0)), dx, dy, dw, dw);
    bedRect = [dx, dy, dw];
    // paver fields next to OSM paver walks (blue channel): pavers layer over the concrete
    const pv = mk(2); { const c2 = pv.getContext('2d'); const im = c2.getImageData(0, 0, W, H); for (let i = 0; i < W * H; i++) { im.data[i * 4 + 1] = 0; im.data[i * 4 + 2] = 255; } c2.putImageData(im, 0, 0); }
    A.ctx.drawImage(pv, dx, dy, dw, dw);
  }
  const SOIL = '#ff0000', LAWN = '#00ff00', DIRT = '#0000ff';

  // --- background land use (B canvas)
  const order = { urban: 0, lawn: 1, meadow: 1, farm: 2, orchard: 2, vineyard: 2, dirt: 3, pitch: 4, playground: 4, track: 3 };
  const areas = data.areas.slice().sort((a, b) => (order[a.k] ?? 9) - (order[b.k] ?? 9));
  for (const a of areas) {
    switch (a.k) {
      case 'urban': case 'lawn': case 'pitch': case 'playground': poly(B.ctx, a.rings, LAWN); break;
      case 'farm': case 'orchard': case 'vineyard': poly(B.ctx, a.rings, SOIL); break;
      case 'dirt': case 'track': poly(B.ctx, a.rings, DIRT); break;
      case 'parking': case 'garage_roof': poly(A.ctx, a.rings, ASPH); break;
      case 'plaza': poly(A.ctx, a.rings, PAVE); break;
      case 'pool': poly(A.ctx, a.rings, PAVE); break;
      default: break;
    }
  }

  // planting beds: take the landscaped-lawn fill back out so the natural ground (photo colour, taller tufts) shows there
  if (typeof bedRect !== 'undefined' && bedRect) {
    B.ctx.save(); B.ctx.globalCompositeOperation = 'destination-out'; B.ctx.drawImage(bedMask, bedRect[0], bedRect[1], bedRect[2], bedRect[2]); B.ctx.restore();
  }

  // --- hardscape apron around many buildings
  for (const b of data.buildings) {
    if (b.s.kind === 'house' || b.s.kind === 'ag' || b.s.kind === 'shed' || b.s.kind === 'canopy') continue;
    stroke(A.ctx, [...b.p, b.p[0], b.p[1]], b.s.kind === 'garage' ? 6 : 3.2, CONC, 'butt');
  }

  // --- paths and roads (small first, big on top)
  const sorted = data.roads.slice().sort((a, b) => a.w - b.w);
  for (const r of sorted) {
    if (r.k === 'walk' && r.sf === 'paver') stroke(A.ctx, r.p, r.w, PAVE);
    else if (r.k === 'walk' || r.k === 'steps' || r.k === 'crossing') stroke(A.ctx, r.p, r.w, CONC);
    else if (r.k === 'dirt') stroke(B.ctx, r.p, r.w, DIRT);
    else if (r.k === 'stream') stroke(B.ctx, r.p, r.w * 1.6, DIRT);
  }
  for (const r of sorted) if (r.k === 'road' && !r.br) stroke(A.ctx, r.p, r.w + 1.4, CONC);
  for (const r of sorted) if (r.k === 'road') stroke(A.ctx, r.p, r.w, ASPH);

  const tex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  return { a: tex(A.c), b: tex(B.c), canvasA: A.c, canvasB: B.c };
}

// ------------------------------------------------------------------ texture arrays
const LAYERS = [
  ['grass_lawn', 2.0], ['grass_wild', 2.4], ['asphalt', 3.0], ['sidewalk', 2.0],
  ['pavers', 1.92], ['gravel', 3.0], ['farm_soil', 2.0], ['dry_ground', 4.0],
];

async function loadLayerImageData(name, file, size) {
  const img = await loadImage(url(`textures/${name}/${file}`));
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

const LIN = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });

export async function buildGroundArrays(size = 1024) {
  const n = LAYERS.length;
  const meanCol = new Array(n).fill(null).map(() => new THREE.Vector3(0.1, 0.1, 0.1));
  const diff = new Uint8Array(size * size * 4 * n);
  const nor = new Uint8Array(size * size * 4 * n);
  await Promise.all(LAYERS.map(async ([name], i) => {
    const [d, nm, r] = await Promise.all([
      loadLayerImageData(name, 'diff.jpg', size), loadLayerImageData(name, 'nor.jpg', size), loadLayerImageData(name, 'rough.jpg', size),
    ]);
    const off = i * size * size * 4;
    { let sr = 0, sg = 0, sb = 0, cnt = 0; for (let p = 0; p < size * size; p += 5) { sr += LIN[d[p * 4]]; sg += LIN[d[p * 4 + 1]]; sb += LIN[d[p * 4 + 2]]; cnt++; } meanCol[i].set(sr / cnt, sg / cnt, sb / cnt); }
    // re-centre the normal map (a few Poly Haven maps carry a constant tilt that would flip sign with the anti-tiling mirrors)
    let mr = 0, mg = 0; for (let p = 0; p < size * size; p++) { mr += nm[p * 4]; mg += nm[p * 4 + 1]; }
    const dr = 128 - mr / (size * size), dg = 128 - mg / (size * size);
    for (let p = 0; p < size * size; p++) { nm[p * 4] = Math.max(0, Math.min(255, nm[p * 4] + dr)); nm[p * 4 + 1] = Math.max(0, Math.min(255, nm[p * 4 + 1] + dg)); }
    for (let p = 0; p < size * size; p++) {
      diff[off + p * 4] = d[p * 4]; diff[off + p * 4 + 1] = d[p * 4 + 1]; diff[off + p * 4 + 2] = d[p * 4 + 2];
      diff[off + p * 4 + 3] = r[p * 4];            // roughness packed in alpha
      nor[off + p * 4] = nm[p * 4]; nor[off + p * 4 + 1] = nm[p * 4 + 1]; nor[off + p * 4 + 2] = nm[p * 4 + 2]; nor[off + p * 4 + 3] = 255;
    }
  }));
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, size, size, n);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { diff: mk(diff, true), nor: mk(nor, false), scales: LAYERS.map((l) => l[1]), meanCol };
}

function whiteTex() {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true; return t;
}

// soft contact shadows on the ground around buildings and under trees
export function buildAOTexture(data, placed) {
  const size = 2048, { cx, cz, half } = SPLAT, sc = size / (2 * half);
  const X = (x) => (x - cx + half) * sc, Z = (z) => (z - cz + half) * sc;
  const T = document.createElement('canvas'); T.width = T.height = size;
  const t = T.getContext('2d');
  t.fillStyle = 'rgba(0,0,0,0.62)';
  for (const b of data.buildings) {
    t.beginPath();
    for (let i = 0; i < b.p.length; i += 2) (i === 0 ? t.moveTo : t.lineTo).call(t, X(b.p[i]), Z(b.p[i + 1]));
    t.closePath(); t.fill();
  }
  t.fillStyle = 'rgba(0,0,0,0.20)';
  for (const list of Object.values(placed)) for (const p of list) {
    const r = 3.6 * p[3] * sc;
    t.beginPath(); t.arc(X(p[0]), Z(p[2]), r, 0, Math.PI * 2); t.fill();
  }
  const C = document.createElement('canvas'); C.width = C.height = size;
  const c = C.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, size, size);
  c.filter = 'blur(2.4px)';
  c.drawImage(T, 0, 0);
  const tex = new THREE.CanvasTexture(C);
  tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ------------------------------------------------------------------ terrain material
export function makeTerrainMaterial({ splat, arrays, uniformsOut, macro }) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const U = {
    uSplatA: { value: splat.a }, uSplatB: { value: splat.b },
    uSplatC: { value: new THREE.Vector3(SPLAT.cx, SPLAT.cz, SPLAT.half) },
    uAO: { value: whiteTex() },
    uDiff: { value: arrays.diff }, uNor: { value: arrays.nor },
    uScale: { value: arrays.scales },
    uDry: { value: 0.70 },
    uTime: { value: 0 },
    uMacro: { value: macro || whiteTex() }, uMacroW: { value: (macro && macro.userData.w) || whiteTex() }, uMacroGain: { value: 1.7 }, uMacroWide: { value: (macro && macro.userData.wide) || whiteTex() }, uMacroFar: { value: (macro && macro.userData.far) || whiteTex() }, uMacroK: { value: macro ? 1.0 : 0.0 }, uMeanCol: { value: arrays.meanCol },
  };
  if (uniformsOut) uniformsOut.terrain = U;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvWNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${GLSL_COMMON}
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uSplatA;
uniform sampler2D uSplatB;
uniform sampler2D uAO;
uniform vec3 uSplatC;
uniform highp sampler2DArray uDiff;
uniform highp sampler2DArray uNor;
uniform float uScale[8];
uniform float uDry;
uniform sampler2D uMacro; uniform float uMacroK; uniform vec3 uMeanCol[8];
vec3 gMacro = vec3(0.1); float gMacroW = 0.0;
uniform sampler2D uMacroW;
uniform sampler2D uMacroWide;
uniform sampler2D uMacroFar;
uniform float uMacroGain;
const vec3 LUMW = vec3(0.2126, 0.7152, 0.0722);
// procedural colour (texel*tint) blended towards the photographed colour, keeping the texel's luminance detail
vec3 macroShade(int L, vec3 texel, vec3 tint, float k){
  vec3 proc = texel * tint;
  float dl = dot(texel, LUMW) / max(dot(uMeanCol[L], LUMW), 1e-3);
  vec3 mg = gMacro * uMacroGain; float ml = dot(mg, LUMW); mg *= min(1.0, 0.30 / max(ml, 1e-3));
  vec3 m = mg * pow(max(dl, 0.0), 0.9);
  return mix(proc, m, clamp(gMacroW * uMacroK * k, 0.0, 1.0));
}
vec4 bicubicTex(sampler2D tex, vec2 uv, float size0, float lod){
  float size = size0 / exp2(lod);
  vec2 pc = uv * size - 0.5;
  vec2 f = fract(pc); vec2 ip = floor(pc);
  vec2 f2 = f*f, f3 = f2*f;
  vec2 w0 = (1.0 - 3.0*f + 3.0*f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0*f2 + 3.0*f3) / 6.0;
  vec2 w2 = (1.0 + 3.0*f + 3.0*f2 - 3.0*f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (ip - 0.5 + w1 / g0) / size;
  vec2 h1 = (ip + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureLod(tex, vec2(h0.x, h0.y), lod) + g1.x * textureLod(tex, vec2(h1.x, h0.y), lod))
       + g1.y * (g0.x * textureLod(tex, vec2(h0.x, h1.y), lod) + g1.x * textureLod(tex, vec2(h1.x, h1.y), lod));
}
vec3 desat(vec3 c, float k){ float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(vec3(l), c, k); }
// array-texture lookup with per-tile random flips and offsets (no visible repetition)
vec4 diffNT(int L, vec2 uvw, vec2 dxw, vec2 dyw){
  float s = 1.0 / uScale[L];
  vec2 uv = uvw * s, ddx = dxw * s, ddy = dyw * s;
  vec2 iuv = floor(uv), fuv = fract(uv);
  vec4 ofa = hash4v(iuv), ofb = hash4v(iuv + vec2(1.0,0.0)), ofc = hash4v(iuv + vec2(0.0,1.0)), ofd = hash4v(iuv + vec2(1.0,1.0));
  ofa.zw = sign(ofa.zw - 0.5); ofb.zw = sign(ofb.zw - 0.5); ofc.zw = sign(ofc.zw - 0.5); ofd.zw = sign(ofd.zw - 0.5);
  vec2 b = smoothstep(0.25, 0.75, fuv); float l = float(L);
  return mix(mix(textureGrad(uDiff, vec3(uv*ofa.zw + ofa.xy, l), ddx*ofa.zw, ddy*ofa.zw), textureGrad(uDiff, vec3(uv*ofb.zw + ofb.xy, l), ddx*ofb.zw, ddy*ofb.zw), b.x),
             mix(textureGrad(uDiff, vec3(uv*ofc.zw + ofc.xy, l), ddx*ofc.zw, ddy*ofc.zw), textureGrad(uDiff, vec3(uv*ofd.zw + ofd.xy, l), ddx*ofd.zw, ddy*ofd.zw), b.x), b.y);
}
vec3 norNT(int L, vec2 uvw, vec2 dxw, vec2 dyw){
  float s = 1.0 / uScale[L];
  vec2 uv = uvw * s, ddx = dxw * s, ddy = dyw * s;
  vec2 iuv = floor(uv), fuv = fract(uv);
  vec4 ofa = hash4v(iuv), ofb = hash4v(iuv + vec2(1.0,0.0)), ofc = hash4v(iuv + vec2(0.0,1.0)), ofd = hash4v(iuv + vec2(1.0,1.0));
  ofa.zw = sign(ofa.zw - 0.5); ofb.zw = sign(ofb.zw - 0.5); ofc.zw = sign(ofc.zw - 0.5); ofd.zw = sign(ofd.zw - 0.5);
  vec2 b = smoothstep(0.25, 0.75, fuv); float l = float(L);
  vec3 na = textureGrad(uNor, vec3(uv*ofa.zw + ofa.xy, l), ddx*ofa.zw, ddy*ofa.zw).xyz*2.0-1.0; na.xy *= ofa.zw;
  vec3 nb = textureGrad(uNor, vec3(uv*ofb.zw + ofb.xy, l), ddx*ofb.zw, ddy*ofb.zw).xyz*2.0-1.0; nb.xy *= ofb.zw;
  vec3 nc = textureGrad(uNor, vec3(uv*ofc.zw + ofc.xy, l), ddx*ofc.zw, ddy*ofc.zw).xyz*2.0-1.0; nc.xy *= ofc.zw;
  vec3 nd = textureGrad(uNor, vec3(uv*ofd.zw + ofd.xy, l), ddx*ofd.zw, ddy*ofd.zw).xyz*2.0-1.0; nd.xy *= ofd.zw;
  return mix(mix(na, nb, b.x), mix(nc, nd, b.x), b.y);
}
`)
      .replace('#include <map_fragment>', `
vec2 gp = vec2(vWPos.x, -vWPos.z);
vec2 gdx = dFdx(gp), gdy = dFdy(gp);
vec3 Nw = normalize(vWNrm);
vec2 suv = (vec2(vWPos.x, vWPos.z) - uSplatC.xy) / (2.0*uSplatC.z) + 0.5;
float inSplat = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
vec2 suvc = clamp(suv, 0.0, 1.0);
vec2 dxs = dFdx(suv * 4096.0), dys = dFdy(suv * 4096.0);
float slod = clamp(0.5 * log2(max(max(dot(dxs, dxs), dot(dys, dys)), 1.0)), 0.0, 9.0);
vec3 sA = bicubicTex(uSplatA, suvc, 4096.0, slod).rgb * inSplat;
vec3 sB = bicubicTex(uSplatB, suvc, 4096.0, slod).rgb * inSplat;
vec3 sAb = bicubicTex(uSplatA, suvc, 4096.0, slod + 3.0).rgb * inSplat;   // blurred: proximity to pavement
float aoV = mix(1.0, textureLod(uAO, suvc, 0.0).r, inSplat);
sA = smoothstep(0.30, 0.70, clamp(sA, 0.0, 1.0));
sB = smoothstep(0.30, 0.70, clamp(sB, 0.0, 1.0));
float wA = clamp(sA.r + sA.g + sA.b, 0.0, 1.0);
sA = wA > 0.001 ? sA / max(sA.r + sA.g + sA.b, 1.0) * wA : sA;
sB *= (1.0 - wA);
float wB = clamp(sB.r + sB.g + sB.b, 0.0, 1.0);
float wN = clamp(1.0 - wA - wB, 0.0, 1.0);

float macro = 0.80 + 0.40 * fbm2(gp * 0.012 + 7.0);
float meso = 0.90 + 0.20 * fbm2(gp * 0.09);
float slope = 1.0 - Nw.y;
float pave = clamp((sAb.r + sAb.g + sAb.b) * 1.4, 0.0, 1.0);          // near pavement => worn / dry edge

vec3 col = vec3(0.0); float rgh = 0.0; vec3 nrm = vec3(0.0);
float accum = 0.0;
{
  vec2 muv = (vec2(vWPos.x, vWPos.z) + 2000.0) / 4000.0;
  vec3 mc = texture2D(uMacro, clamp(muv, 0.002, 0.998)).rgb;
  float medge = min(min(muv.x, 1.0 - muv.x), min(muv.y, 1.0 - muv.y)) * 4000.0;
  float wCore = smoothstep(0.0, 220.0, medge);
  gMacroW = wCore * smoothstep(0.05, 0.6, texture2D(uMacroW, clamp(muv, 0.002, 0.998)).r);
  // outer ring: ±4.8 km aerial (blurred), faded in where the core photo ends
  vec2 wuv = (vec2(vWPos.x, vWPos.z) + 4800.0) / 9600.0;
  vec3 mcw = texture2D(uMacroWide, clamp(wuv, 0.001, 0.999)).rgb;
  float wEdge = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y)) * 9600.0;
  float wOuter = (1.0 - wCore) * smoothstep(0.0, 300.0, wEdge);
  vec2 fuv = (vec2(vWPos.x, vWPos.z) + 20480.0) / 40960.0;
  vec3 mcf = texture2D(uMacroFar, clamp(fuv, 0.001, 0.999)).rgb;
  float wW = smoothstep(0.0, 300.0, wEdge);                 // 1 inside the ±4.8 km photo, fades out at its edge
  mcw = mix(mcf, mcw, wW);
  mc = mix(mc, mcw, 1.0 - wCore);
  gMacroW = max(gMacroW, (1.0 - wCore) * 0.9);
  float mL = dot(mc, vec3(0.2126, 0.7152, 0.0722));
  vec3 lush = vec3(0.60, 1.0, 0.40) * mL * 0.80;                       // season slider: lush green <-> photographed <-> parched gold
  mc = mix(lush, mc, smoothstep(0.05, 0.62, uDry));
  mc *= mix(vec3(1.0), vec3(1.16, 1.04, 0.78), smoothstep(0.7, 1.0, uDry));
  gMacro = mc;
}
#define ADDL(L, W, TINT) ADDM(L, W, TINT, 0.0)
#define ADDM(L, W, TINT, MK) { if ((W) > 0.003) { vec4 d_ = diffNT(L, gp, gdx, gdy); vec3 n_ = norNT(L, gp, gdx, gdy); col += macroShade(L, d_.rgb, (TINT), (MK)) * (W); rgh += d_.a * (W); nrm += n_ * (W); accum += (W); } }
// asphalt: soft noise patches (repairs / sealcoat), oil stains, wear - no rectangular regions
float aN = fbm2(gp * 0.045 + 31.0);
float aP = smoothstep(0.58, 0.64, aN) - smoothstep(0.74, 0.80, aN);          // repaired patches
float aS = smoothstep(0.62, 0.8, fbm2(gp * 0.18 + 5.0));                     // darker stains
vec3 asphTint = vec3(1.0, 0.985, 0.96) * (0.92 + 0.22 * macro) * (1.0 - 0.20 * aP) * (1.0 - 0.14 * aS) * (0.92 + 0.16 * fbm2(gp * 0.5));
ADDL(2, sA.r, asphTint * vec3(2.55, 2.45, 2.32))      // aged light-grey asphalt: matched to the registered aerial (summer sun)
ADDL(3, sA.g, vec3(2.75, 2.85, 3.1) * (0.82 + 0.3 * fbm2(gp * 0.25)))   // terrain concrete (aprons, aerial-classified plazas): calibrated vs the aerial
ADDL(4, sA.b, vec3(2.7, 1.72, 1.36))      // salmon-terracotta concrete pavers (University Union plaza photos)
ADDM(6, sB.r, vec3(1.45, 1.28, 1.05) * (0.8 + 0.5 * fbm2(gp * 0.05)), 1.0)
// managed lawn: patchy green / straw, worn near paths, desaturated
{
  float lawnN = fbm2(gp * 0.05 + 3.0);
  vec3 g0 = vec3(0.90, 0.92, 0.66), g1 = vec3(1.10, 1.02, 0.70), g2 = vec3(0.74, 0.80, 0.58);
  vec3 lt = mix(g0, g1, smoothstep(0.42, 0.72, lawnN));
  lt = mix(lt, g2, smoothstep(0.62, 0.9, fbm2(gp * 0.13 + 11.0)) * 0.7);
  lt = mix(lt, vec3(1.1, 0.98, 0.7), pave * 0.35 * smoothstep(0.4, 0.8, vnoise2(gp * 0.7)));
  lt = desat(lt * macro * meso, 0.66);
  lt *= vec3(1.18, 1.0, 1.7);
  // mowing stripes: 1.9 m bands along the campus grid (77 deg, the dominant building orientation); like real turf the bands
  // swap light/dark with the viewing direction (blades bent toward vs away from the viewer) and vanish seen side-on
  {
    vec2 wp = vWPos.xz;
    vec2 sd = vec2(0.2250, 0.9744);
    float ph = dot(wp, sd) * 1.6535;
    float fw = fwidth(ph);
    float band = smoothstep(-0.3, 0.3, sin(ph)) * 2.0 - 1.0;
    vec2 vd = normalize(cameraPosition.xz - wp + 1e-4);
    float dist = length(cameraPosition - vWPos);
    float k = 0.11 * dot(vd, vec2(-sd.y, sd.x)) * (1.0 - smoothstep(0.5, 1.2, fw)) * (1.0 - smoothstep(110.0, 240.0, dist));   // mower travels along the band
    lt *= 1.0 + k * band;
  }
  ADDM(0, sB.g, lt, 0.5)
}
ADDM(5, sB.b, vec3(1.0, 0.96, 0.9) * (0.8 + 0.4 * fbm2(gp * 0.2)), 1.0)
// natural hillside: aspect-dependent green<->gold grass, oak-shadow mottling, rock on steep slopes
{
  float aspect = clamp(-Nw.z * 2.2, -1.0, 1.0);                       // +1 = north-facing (greener / moister)
  float dry = clamp(uDry + (fbm2(gp * 0.0038) - 0.5) * 0.9 - 0.30 * aspect + slope * 0.7, 0.0, 1.0);
  float rock = smoothstep(0.24, 0.42, slope + 0.05 * (fbm2(gp * 0.06) - 0.5));
  vec3 green = vec3(0.66, 0.78, 0.50), gold = vec3(1.28, 1.04, 0.68);
  vec3 tint = mix(green, gold, dry);
  tint *= 0.78 + 0.5 * fbm2(gp * 0.021 + 5.0);
  tint *= 0.86 + 0.28 * fbm2(gp * 0.28);
  tint = desat(tint, 0.78);
  if (wN > 0.003) {
    vec4 g_ = diffNT(1, gp, gdx, gdy);
    vec3 gn_ = norNT(1, gp, gdx, gdy);
    vec4 r_ = diffNT(7, gp, gdx, gdy);
    vec3 rn_ = norNT(7, gp, gdx, gdy);
    vec3 c_ = mix(macroShade(1, g_.rgb, tint, 0.92), macroShade(7, r_.rgb, vec3(0.80, 0.72, 0.62) * (0.9 + 0.2 * meso), 0.8), rock);
    col += c_ * wN; rgh += mix(g_.a, r_.a, rock) * wN; nrm += mix(gn_, rn_, rock) * wN; accum += wN;
  }
}
col /= max(accum, 1e-4); rgh /= max(accum, 1e-4); nrm /= max(accum, 1e-4);
col *= aoV;
diffuseColor *= vec4(col, 1.0);
float gRough = rgh;
vec3 gNor = normalize(vec3(nrm.xy, max(nrm.z, 0.2)));
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(gRough * 0.95 + 0.12, 0.72, 1.0);')
      .replace('#include <normal_fragment_maps>', `
{
  vec3 T_ = normalize(vec3(1.0,0.0,0.0) - Nw * Nw.x);
  vec3 B_ = cross(Nw, T_);
  vec3 nw_ = normalize(T_ * gNor.x + B_ * gNor.y + Nw * gNor.z);
  normal = normalize((viewMatrix * vec4(nw_, 0.0)).xyz);
}
`);
  };
  mat.customProgramCacheKey = () => 'terrain-v4';
  return mat;
}
