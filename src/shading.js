import * as THREE from 'three';
import { NIGHT } from './night.js';

// =============================================================================================
// Procedural building shading: roofs (clay tile / shingle / standing-seam / membrane) and
// facades (stucco/concrete without visible tiling, procedural brick + metal siding, weathering,
// recessed windows with parallax, trim, belt courses, cornices, doors, night-lit windows).
// Roof UVs are in METRES: x = across the slope (along the eave), y = up the slope.
// Wall coordinates: vA.x = metres along the wall edge, world Y = height.
// =============================================================================================

export const GLSL_COMMON = /* glsl */ `
uint pcgh(uint v){ uint st = v * 747796405u + 2891336453u; uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u; return (w >> 22u) ^ w; }
float hash11(float p){ return float(pcgh(uint(int(floor(p))))) * (1.0 / 4294967295.0); }
float hash12(vec2 p){ ivec2 i = ivec2(floor(p)); return float(pcgh(uint(i.x) + pcgh(uint(i.y) + 0x85ebca6bu))) * (1.0 / 4294967295.0); }
float vnoise2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash12(i),hash12(i+vec2(1.0,0.0)),f.x), mix(hash12(i+vec2(0.0,1.0)),hash12(i+vec2(1.0,1.0)),f.x), f.y); }
float fbm2(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise2(p); p=p*2.03+17.1; a*=0.5; } return s; }
vec4 hash4v(vec2 p){ ivec2 i = ivec2(floor(p)); uint h = pcgh(uint(i.x) + pcgh(uint(i.y) + 0x9e3779b9u)); uint h2 = pcgh(h ^ 0x68e31da4u), h3 = pcgh(h2 ^ 0xb5297a4du), h4 = pcgh(h3 ^ 0x1b56c4e9u); return vec4(float(h), float(h2), float(h3), float(h4)) * (1.0 / 4294967295.0); }
`;

// Texture lookup with per-tile random flips/offsets blended across tile borders so repetition is not visible.
export const GLSL_NOTILE = /* glsl */ `
vec4 texNoTile(sampler2D samp, vec2 uv){
  vec2 iuv = floor(uv), fuv = fract(uv);
  vec4 ofa = hash4v(iuv), ofb = hash4v(iuv + vec2(1.0,0.0)), ofc = hash4v(iuv + vec2(0.0,1.0)), ofd = hash4v(iuv + vec2(1.0,1.0));
  vec2 ddx = dFdx(uv), ddy = dFdy(uv);
  ofa.zw = sign(ofa.zw - 0.5); ofb.zw = sign(ofb.zw - 0.5); ofc.zw = sign(ofc.zw - 0.5); ofd.zw = sign(ofd.zw - 0.5);
  vec2 b = smoothstep(0.25, 0.75, fuv);
  return mix(mix(textureGrad(samp, uv*ofa.zw + ofa.xy, ddx*ofa.zw, ddy*ofa.zw), textureGrad(samp, uv*ofb.zw + ofb.xy, ddx*ofb.zw, ddy*ofb.zw), b.x),
             mix(textureGrad(samp, uv*ofc.zw + ofc.xy, ddx*ofc.zw, ddy*ofc.zw), textureGrad(samp, uv*ofd.zw + ofd.xy, ddx*ofd.zw, ddy*ofd.zw), b.x), b.y);
}
vec3 nrmNoTile(sampler2D samp, vec2 uv){
  vec2 iuv = floor(uv), fuv = fract(uv);
  vec4 ofa = hash4v(iuv), ofb = hash4v(iuv + vec2(1.0,0.0)), ofc = hash4v(iuv + vec2(0.0,1.0)), ofd = hash4v(iuv + vec2(1.0,1.0));
  vec2 ddx = dFdx(uv), ddy = dFdy(uv);
  ofa.zw = sign(ofa.zw - 0.5); ofb.zw = sign(ofb.zw - 0.5); ofc.zw = sign(ofc.zw - 0.5); ofd.zw = sign(ofd.zw - 0.5);
  vec3 na = textureGrad(samp, uv*ofa.zw + ofa.xy, ddx*ofa.zw, ddy*ofa.zw).xyz*2.0-1.0; na.xy *= ofa.zw;
  vec3 nb = textureGrad(samp, uv*ofb.zw + ofb.xy, ddx*ofb.zw, ddy*ofb.zw).xyz*2.0-1.0; nb.xy *= ofb.zw;
  vec3 nc = textureGrad(samp, uv*ofc.zw + ofc.xy, ddx*ofc.zw, ddy*ofc.zw).xyz*2.0-1.0; nc.xy *= ofc.zw;
  vec3 nd = textureGrad(samp, uv*ofd.zw + ofd.xy, ddx*ofd.zw, ddy*ofd.zw).xyz*2.0-1.0; nd.xy *= ofd.zw;
  vec2 b = smoothstep(0.25, 0.75, fuv);
  return normalize(mix(mix(na, nb, b.x), mix(nc, nd, b.x), b.y));
}
`;

let FLAT_NORMAL = null;
export function flatNormalTexture() {
  if (!FLAT_NORMAL) { FLAT_NORMAL = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); FLAT_NORMAL.needsUpdate = true; }
  return FLAT_NORMAL;
}

// ------------------------------------------------------------------------------------------- roofs
const ROOF_FRAG = /* glsl */ `
uniform vec3 uRA; uniform vec3 uRB; uniform float uSeed;
uniform sampler2D uAerial; uniform float uAerialGain; uniform float uAerialK;
vec3 gAerCol = vec3(0.0); float gAerW = 0.0;
varying vec2 vRW;
// real roof colours from the USGS orthophoto (sampled at the fragment's world x,z), procedural pattern kept as relative detail
void roofAerial(vec3 procCol){
  vec2 auv = (vRW + 2000.0) / 4000.0;
  if (auv.x <= 0.0 || auv.x >= 1.0 || auv.y <= 0.0 || auv.y >= 1.0) return;
  #ifdef ROOF_FLAT
    vec3 ac = textureLod(uAerial, auv, 0.6).rgb;
  #else
    vec3 ac = textureLod(uAerial, auv, 2.2).rgb;           // pitched: broad colour only (photo is 1 m/px and leans on sloped roofs)
  #endif
  // pre-compensate the grade's desaturation + blue skylight, which otherwise turn brown gravel roofs mauve
  float acl = dot(ac, vec3(0.2126, 0.7152, 0.0722));
  #ifdef ROOF_TILE
    // the aerial's haze roughly halves the saturation of clay tile (aerial ~0.3, ground photos ~0.6): match the ground photos
    ac = max(mix(vec3(acl), ac, 2.1), vec3(0.0)) * vec3(1.06, 0.76, 0.66);   // ...and pull the hue from orange toward terracotta red
  #else
    ac = max(mix(vec3(acl), ac, 1.15), vec3(0.0)) * vec3(1.0, 1.0, 0.96);   // + slight warm white balance against the doubled skylight
  #endif
  vec3 rel = procCol / max(0.5 * (uRA + uRB), vec3(0.02));
  #ifdef ROOF_FLAT
    rel = mix(vec3(dot(rel, vec3(0.333))), rel, 0.3);
  #else
    rel = mix(vec3(dot(rel, vec3(0.333))), rel, 0.15);       // tiles / shingles: keep their light-dark relief, take hue from the photo
  #endif
  #ifdef ROOF_FLAT
    gAerCol = ac * uAerialGain * mix(0.87, 1.0, smoothstep(0.12, 0.40, acl)) * rel;   // the tone curve lifts mid-dark roofs: less gain there
  #else
    gAerCol = ac * uAerialGain * rel;
  #endif
  // reject canopy (green), pools (blue) and cast shadows (dark) -> fall back to the building's median colour
  float al = dot(ac, vec3(0.2126, 0.7152, 0.0722));
  float gi = ac.g - 0.5 * (ac.r + ac.b), bi = ac.b - 0.5 * (ac.r + ac.g);
  gAerW = (1.0 - smoothstep(0.004, 0.02, gi)) * (1.0 - smoothstep(0.01, 0.04, bi)) * smoothstep(0.045, 0.085, al);
}
vec3 gRoofN = vec3(0.0, 0.0, 1.0); float gRoofRough = 0.8; float gRoofMetal = 0.0;
void roofPattern(vec2 ruv, out vec3 col){
  gRoofN = vec3(0.0, 0.0, 1.0);
  #if defined(ROOF_TILE)
    const float CW = 0.150, CS = 0.265;
    float colId = floor(ruv.x / CW);
    float fx = fract(ruv.x / CW);
    float cover = mod(colId, 2.0);
    float stagger = hash11(floor(colId * 0.5) + 7.0 + uSeed) * 0.09;
    float vv = ruv.y + stagger;
    float course = floor(vv / CS);
    float t = fract(vv / CS);
    vec2 id = vec2(colId, course) + uSeed;
    float r1 = hash12(id), r2 = hash12(id + 13.7), r3 = hash12(id + 5.3);
    vec3 tc = mix(uRA, uRB, r1 * r1);
    tc *= 0.84 + 0.30 * r2;
    tc = mix(tc, tc * vec3(0.74, 0.72, 0.72), step(0.92, r3));                 // a few dark / replaced tiles
    tc = mix(tc, tc * vec3(1.25, 1.2, 1.15), step(0.955, hash12(id + 31.0)));   // and a few bleached ones
    float s = sin(fx * 3.14159265);
    float cross = cover > 0.5 ? (0.58 + 0.50 * s) : (0.46 + 0.22 * s);
    float under = 1.0 - 0.42 * smoothstep(0.78, 1.0, t);
    float lipHi = 1.0 + 0.28 * (1.0 - smoothstep(0.0, 0.07, t));
    tc *= cross * under * lipHi;
    float dn = fbm2(ruv * 1.1 + vec2(uSeed * 3.0));
    tc *= 0.80 + 0.34 * dn;
    float moss = smoothstep(0.64, 0.80, fbm2(ruv * 0.5 + 11.0 + uSeed));
    tc = mix(tc, tc * vec3(0.66, 0.80, 0.52), moss * 0.6);
    float soot = smoothstep(0.55, 0.9, vnoise2(vec2(ruv.x * 0.9 + uSeed, 3.0)));
    tc *= 1.0 - 0.18 * soot;
    float dHdu = (cover > 0.5 ? 1.0 : -0.75) * cos(fx * 3.14159265) * 3.14159265 / CW * 0.045;
    float dHdv = 0.020 / CS - 0.55 * (1.0 - smoothstep(0.0, 0.06, t)) * 0.12;
    gRoofN = normalize(vec3(-dHdu, -dHdv * 6.0, 1.0));
    gRoofRough = 0.62 + 0.25 * r2;
    col = tc;
  #elif defined(ROOF_SHINGLE)
    const float SH = 0.146, TW = 0.333;
    float course = floor(ruv.y / SH); float t = fract(ruv.y / SH);
    float off = mod(course, 2.0) * 0.5 * TW + hash11(course + uSeed) * 0.07;
    float tabId = floor((ruv.x + off) / TW); float fxx = fract((ruv.x + off) / TW);
    vec2 id = vec2(tabId, course) + uSeed;
    float r1 = hash12(id), r2 = hash12(id + 9.1);
    vec3 sc = mix(uRA, uRB, r1);
    sc *= 0.86 + 0.26 * r2;
    float gran = 0.6 * vnoise2(ruv * 90.0) + 0.4 * vnoise2(ruv * 230.0);
    sc *= 0.90 + 0.20 * gran;
    sc *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.13, t)) ;                         // shadow under the tab above
    sc *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.025, fxx)) ;
    float dn = fbm2(ruv * 0.9 + uSeed); sc *= 0.82 + 0.3 * dn;
    float moss = smoothstep(0.68, 0.82, fbm2(ruv * 0.45 + 5.0 + uSeed)); sc = mix(sc, sc * vec3(0.7, 0.82, 0.55), moss * 0.5);
    gRoofN = normalize(vec3((fxx - 0.5) * 0.06, (t - 0.5) * 0.18 - 0.15 * (1.0 - smoothstep(0.0, 0.13, t)), 1.0));
    gRoofRough = 0.92; col = sc;
  #elif defined(ROOF_SEAM)
    const float PW = 0.46;
    float pid = floor(ruv.x / PW); float f = fract(ruv.x / PW);
    float r1 = hash11(pid + uSeed * 7.0);
    vec3 mc = uRA * (0.90 + 0.18 * r1);
    float seamD = min(f, 1.0 - f) * PW;
    float seam = 1.0 - smoothstep(0.012, 0.03, seamD);
    mc *= 1.0 + 0.22 * seam - 0.18 * smoothstep(0.03, 0.06, seamD) * (1.0 - smoothstep(0.06, 0.09, seamD));
    float streak = vnoise2(vec2(ruv.x * 7.0 + uSeed, ruv.y * 0.08));
    mc *= 0.88 + 0.18 * streak;
    float stain = smoothstep(0.55, 0.85, fbm2(ruv * 0.35 + uSeed)); mc = mix(mc, mc * vec3(0.78, 0.7, 0.62), stain * 0.5);
    float dh = (f < 0.5 ? 1.0 : -1.0) * (1.0 - smoothstep(0.0, 0.04, seamD)) * 0.7;
    gRoofN = normalize(vec3(dh, 0.0, 1.0)); gRoofRough = 0.42 + 0.2 * streak; gRoofMetal = 0.55; col = mc;
  #else // ROOF_FLAT : membrane with gravel / roll seams / stains
    vec3 fc = uRA;
    float g = 0.5 * vnoise2(ruv * 38.0) + 0.3 * vnoise2(ruv * 95.0) + 0.2 * vnoise2(ruv * 210.0); fc *= 0.86 + 0.28 * g;
    float seamX = 1.0 - smoothstep(0.0, 0.012, abs(fract(ruv.x / 1.1) - 0.5) - 0.495 + 0.0);
    float lineX = abs(fract(ruv.x / 1.1) - 0.5); seamX = smoothstep(0.495, 0.5, lineX);
    fc *= 1.0 - 0.18 * seamX;
    float patchN = fbm2(ruv * 0.18 + uSeed * 4.0); fc = mix(fc, uRB, smoothstep(0.55, 0.8, patchN) * 0.8);
    float stain = smoothstep(0.5, 0.9, fbm2(ruv * 0.9 + 3.0 + uSeed)); fc *= 1.0 - 0.28 * stain;
    gRoofN = normalize(vec3((vnoise2(ruv * 70.0) - 0.5) * 0.30, (vnoise2(ruv * 70.0 + 9.0) - 0.5) * 0.30, 1.0));
    gRoofRough = 0.88; col = fc;
  #endif
}
`;

export const AERIAL = { tex: null };
export function makeRoofMaterial(kind, colorA, colorB, { seed = 0, side = THREE.DoubleSide } = {}) {
  // envMapIntensity < 1: the aerial colour already contains the photo's skylight; full blue sky IBL on top turned brown roofs mauve
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side, normalMap: flatNormalTexture(), vertexColors: true, envMapIntensity: 0.7 });
  m.userData.kind = kind;
  { const ca = new THREE.Color(colorA), cb = new THREE.Color(colorB); const K = { tile: 0.74, shingle: 0.80, seam: 0.95, flat: 0.86 }[kind] || 0.8;
    m.userData.nominal = [(ca.r + cb.r) / 2 * K, (ca.g + cb.g) / 2 * K, (ca.b + cb.b) / 2 * K]; }
  m.onBeforeCompile = (shader) => {
    shader.defines = shader.defines || {};
    shader.defines['ROOF_' + kind.toUpperCase()] = '';
    shader.uniforms.uRA = { value: new THREE.Color(colorA) };
    shader.uniforms.uRB = { value: new THREE.Color(colorB) };
    shader.uniforms.uSeed = { value: seed };
    shader.uniforms.uAerial = { value: AERIAL.tex || flatNormalTexture() }; shader.uniforms.uAerialGain = { value: kind === 'flat' ? 1.42 : kind === 'tile' ? 3.0 : 1.85 };   // calibrated per kind against the registered aerial (summer sun)
    if (AERIAL.tex) shader.defines.ROOF_AERIAL = '';
    shader.uniforms.uAerialK = { value: kind === 'flat' ? 1.0 : kind === 'tile' ? 0.95 : 0.6 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRW = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + ROOF_FRAG)
      .replace('#include <map_fragment>', `
        vec3 roofCol; roofPattern(vNormalMapUv, roofCol);
        #if defined(ROOF_AERIAL) && defined(USE_COLOR)
          roofAerial(roofCol);
          roofCol = mix(roofCol, gAerCol / max(vColor, vec3(0.05)), gAerW * uAerialK);
        #endif
        diffuseColor.rgb = roofCol;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRoofRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gRoofMetal;')
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = gRoofN; mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`);
  };
  m.customProgramCacheKey = () => 'roof-' + kind + (AERIAL.tex ? '-aer' : '') + '-v15';
  return m;
}

// ------------------------------------------------------------------------------------------- walls
const FACADE_VERT_DECL = `
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying float vWY; varying vec3 vWP; varying vec3 vWN;
`;

const FACADE_FRAG_DECL = /* glsl */ `
uniform vec3 uSkyZen, uSkyHor; uniform float uSkyWarm;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying float vWY; varying vec3 vWP; varying vec3 vWN;
uniform float uNight;
uniform vec3 uBrick0; uniform vec3 uBrick1; uniform vec3 uBrick2; uniform vec3 uMetal;
float rectM(vec2 p, vec2 lo, vec2 hi, float aa){
  vec2 a = smoothstep(lo - aa, lo + aa, p);
  vec2 b = 1.0 - smoothstep(hi - aa, hi + aa, p);
  return a.x*a.y*b.x*b.y;
}
vec3 gWallN = vec3(0.0, 0.0, 1.0); float gWallRough = 0.9; float gWallMetal = 0.0;
float gWin = 0.0; float gFrame = 0.0; float gLit = 0.0;
vec3 gRoom = vec3(0.0);
// interior mapping: trace the view ray into a box-shaped room behind the glass (x along wall, y up, z into the building)
vec3 roomColor(float cu, float cv, float sp, float fh, float rnd, float rnd2){
  vec3 Nn = normalize(vWN), Tt = vec3(-Nn.z, 0.0, Nn.x);
  vec3 rd = normalize(vWP - cameraPosition);
  vec3 r = vec3(dot(rd, Tt), rd.y, -dot(rd, Nn));
  r.z = max(r.z, 0.05);
  float D = 4.5 + 2.0 * rnd;
  float W = sp, H = fh;
  float tx = r.x > 0.0 ? (W - cu) / r.x : -cu / min(r.x, -1e-4);
  float ty = r.y > 0.0 ? (H - 0.15 - cv) / r.y : (0.05 - cv) / min(r.y, -1e-4);
  float tz = D / r.z;
  float t = min(min(tx, ty), tz);
  vec3 h = vec3(cu, cv, 0.0) + r * t;
  vec3 tint = mix(vec3(0.95, 0.90, 0.80), vec3(0.80, 0.86, 0.92), rnd2);
  vec3 c;
  if (t == tz) {            // back wall: a bookshelf / desk band and a door-ish dark patch
    c = tint * 0.62;
    c *= 1.0 - 0.35 * step(abs(h.y - 0.9), 0.38) * step(0.5, fract(rnd * 7.0));
    c *= 1.0 - 0.45 * step(abs(h.x - W * (0.3 + 0.4 * rnd2)), 0.45) * step(h.y, 2.1) * step(0.6, rnd);
  } else if (t == ty) {
    if (r.y > 0.0) { c = tint * 0.85; c += vec3(0.25) * step(abs(fract(h.z / 1.8) - 0.5), 0.08) * step(abs(h.x - W * 0.5), W * 0.3); }   // ceiling + light strips
    else { c = mix(vec3(0.28, 0.25, 0.22), vec3(0.22, 0.24, 0.27), rnd) ; }                                                         // floor
  } else { c = tint * 0.5; }                                                                                                         // side wall
  c *= 1.0 - 0.45 * smoothstep(0.0, D, h.z);
  return c;
}
uniform float uLumAvg;
// stucco colours, sRGB: 0 whitewash, 1 warm white, 2 cream, 3 butter, 4 tan, 5 sand-pink, 6 rose-taupe (Poly Canyon Village), 7 grey-green board-formed concrete (Sierra Madre / Yosemite towers)
vec3 stuccoPal(float t){
  float k = t * 7.0;
  vec3 c = k < 0.5 ? vec3(0.93, 0.91, 0.85) : k < 1.5 ? vec3(0.91, 0.87, 0.76) : k < 2.5 ? vec3(0.90, 0.85, 0.70) : k < 3.5 ? vec3(0.89, 0.82, 0.62) : k < 4.5 ? vec3(0.79, 0.70, 0.55) : k < 5.5 ? vec3(0.84, 0.73, 0.64) : k < 6.5 ? vec3(0.72, 0.62, 0.58) : vec3(0.60, 0.65, 0.60);
  return pow(c, vec3(2.2));
}

// ---- procedural running-bond brick (returns colour; sets gWallN / gWallRough)
vec3 brickWall(vec2 p, float aa){
  const vec2 BR = vec2(0.225, 0.075);
  float row = floor(p.y / BR.y);
  float shift = mod(row, 2.0) * 0.5 * BR.x + hash11(floor(row / 14.0) * 3.1) * 0.0;
  vec2 q = vec2(p.x + shift, p.y);
  vec2 cell = vec2(floor(q.x / BR.x), row);
  vec2 f = vec2(fract(q.x / BR.x), fract(q.y / BR.y));
  vec2 e = vec2(0.005 / BR.x, 0.005 / BR.y);                  // half of a 10 mm joint
  vec2 aw = min(vec2(aa / BR.x, aa / BR.y) * 0.5, vec2(0.08, 0.2)) + 0.004;
  float mx = smoothstep(e.x, e.x + aw.x, f.x) * smoothstep(e.x, e.x + aw.x, 1.0 - f.x);
  float my = smoothstep(e.y, e.y + aw.y, f.y) * smoothstep(e.y, e.y + aw.y, 1.0 - f.y);
  float brick = mx * my;
  float r1 = hash12(cell + 3.7), r2 = hash12(cell + 19.1), r3 = hash12(cell + 41.3);
  vec3 c = r1 < 0.5 ? mix(uBrick0, uBrick1, r1 * 2.0) : mix(uBrick1, uBrick2, (r1 - 0.5) * 2.0);
  c *= 0.86 + 0.26 * r2;
  c = mix(c, c * vec3(0.62, 0.58, 0.58), step(0.93, r3));                       // clinker / burnt brick
  c *= 0.9 + 0.2 * smoothstep(0.0, 0.5, vnoise2(p * 9.0 + cell));                // surface mottling
  float bevel = smoothstep(0.0, 0.16, min(min(f.x, 1.0 - f.x) * BR.x / 0.0225, min(f.y, 1.0 - f.y) * BR.y / 0.0225));
  c *= 0.82 + 0.18 * bevel;
  vec3 mortar = vec3(0.30, 0.285, 0.25) * (0.85 + 0.25 * vnoise2(p * 30.0));
  vec3 outc = mix(mortar, c, brick);
  // far away the joints are sub-pixel: converge on the area-weighted average (≈ 88 % brick, 12 % mortar) instead of aliasing / washing out
  float far = smoothstep(0.006, 0.022, aa);
  vec3 cAvg = mix(mix(uBrick0, uBrick1, 0.5), uBrick2, 0.25) * (0.86 + 0.26 * r2) * 0.95;
  outc = mix(outc, mix(mortar, cAvg, 0.87), far);
  // height-field normal (brick proud of mortar)
  float dx = (f.x < 0.5 ? 1.0 : -1.0) * (1.0 - smoothstep(e.x, e.x + 0.06, min(f.x, 1.0 - f.x))) ;
  float dy = (f.y < 0.5 ? 1.0 : -1.0) * (1.0 - smoothstep(e.y, e.y + 0.18, min(f.y, 1.0 - f.y)));
  gWallN = normalize(vec3(dx * 0.7 * (1.0 - far), dy * 0.7 * (1.0 - far), 1.0));
  gWallRough = mix(0.95, 0.78, brick);
  return outc;
}

// ---- procedural corrugated metal siding
vec3 metalWall(vec2 p, float aa, float seed){
  const float RP = 0.0762;
  float panel = floor(p.x / 0.914);
  float r1 = hash11(panel * 3.3 + seed * 17.0);
  float ph = fract(p.x / RP);
  float s = sin(ph * 6.28318);
  float c = cos(ph * 6.28318);
  vec3 col = uMetal * (0.88 + 0.24 * r1);
  col *= 0.90 + 0.12 * s;                                                   // rib shading
  float seam = 1.0 - smoothstep(0.0, 0.02, abs(fract(p.x / 0.914) - 0.0) * 0.914 * 0.0 + min(fract(p.x / 0.914), 1.0 - fract(p.x / 0.914)) * 0.914);
  col *= 1.0 - 0.25 * seam;
  float streak = vnoise2(vec2(p.x * 4.0 + seed * 9.0, p.y * 0.12));
  col *= 0.86 + 0.22 * streak;
  float rust = smoothstep(0.62, 0.9, vnoise2(vec2(p.x * 1.4 + seed, p.y * 0.35))) * smoothstep(1.6, 0.0, p.y - 0.0) ;
  col = mix(col, col * vec3(0.8, 0.55, 0.38), rust * 0.35);
  float scratch = smoothstep(0.92, 1.0, hash12(floor(vec2(p.x * 40.0, p.y * 3.0))));
  col *= 1.0 - 0.08 * scratch;
  gWallN = normalize(vec3(-c * 0.55, 0.0, 1.0));
  gWallRough = 0.42 + 0.22 * streak;
  gWallMetal = 0.7;
  return col;
}
`;

const FACADE_FRAG_MAIN = /* glsl */ `
{
  float kind = vB.z;
  float yRel = vWY - vA.y;
  float sp = vA.z, fh = vA.w, ww = vB.x, wh = vB.y, seed = vB.w, topRel = vC.x;
  float bandsOn = vD.x, trimOn = mod(vD.y, 2.0), lites = floor(vD.y / 2.0 + 0.01), recess = vD.z;
  vec2 fw = fwidth(vec2(vA.x, vWY));
  float aa = max(0.010, 0.6 * max(fw.x, fw.y));
  vec3 wallCol;
  #if defined(WALL_BRICK)
    wallCol = brickWall(vec2(vA.x, vWY), aa) * (0.95 + 0.1 * fract(seed * 3.7));
  #elif defined(WALL_METAL)
    wallCol = metalWall(vec2(vA.x, vWY), aa, seed);
  #elif defined(WALL_STUCCO)
    vec3 tx = texNoTile(map, vMapUv).rgb;
    float lm = dot(tx, vec3(0.2126, 0.7152, 0.0722));
    wallCol = stuccoPal(vD.w) * clamp(lm / uLumAvg, 0.45, 1.7);
    gWallN = nrmNoTile(normalMap, vNormalMapUv);
    gWallN.xy *= 0.9;
    gWallRough = 0.80 + 0.18 * vnoise2(vec2(vA.x * 2.3, vWY * 2.3));
  #else
    wallCol = texNoTile(map, vMapUv).rgb * diffuseColor.rgb;
    gWallN = nrmNoTile(normalMap, vNormalMapUv);
    gWallN.xy *= 0.9;
    gWallRough = 0.78 + 0.2 * vnoise2(vec2(vA.x * 2.3, vWY * 2.3));
  #endif

  // ---- weathering shared by every material
  float macro = fbm2(vWP.xz * 0.12 + vWP.y * 0.07 + seed * 5.0);
  wallCol *= 0.80 + 0.36 * macro;
  float meso = vnoise2(vec2(vA.x * 0.9, vWY * 0.7) + seed * 11.0);
  wallCol *= 0.93 + 0.14 * meso;
  float streakN = vnoise2(vec2(vA.x * 2.6 + seed * 13.0, 3.0));
  float hasTop = step(1.0, topRel);
  float streak = smoothstep(0.66, 0.92, streakN) * smoothstep(topRel - 3.2, topRel - 0.3, yRel) * hasTop;
  wallCol *= 1.0 - 0.10 * streak;
  wallCol *= 1.0 - 0.34 * exp(-max(yRel, 0.0) * 1.15);                              // ground-contact grime
  wallCol = mix(wallCol, wallCol * vec3(0.82, 0.93, 0.78), smoothstep(0.9, 0.0, yRel) * 0.45 * smoothstep(0.35, 0.65, meso)); // algae at the base
  // foundation + kick plate
  float below = 1.0 - smoothstep(-0.03, 0.03, yRel);
  vec3 conc = mix(wallCol, vec3(0.47, 0.46, 0.44), 0.65) * 0.92;
  wallCol = mix(wallCol, conc, below);
  // cornice / eave shadow and parapet coping
  float nearTop = smoothstep(topRel - 1.0, topRel, yRel) * hasTop;
  wallCol *= 1.0 - 0.14 * nearTop;
  float coping = smoothstep(topRel + 0.02, topRel + 0.06, yRel);
  wallCol = mix(wallCol, vec3(0.62, 0.61, 0.58) * (0.9 + 0.2 * meso), coping * step(0.5, fh) * step(1.0, topRel));
  // stone / precast panel cladding: running joints every 1.5 m x 0.75 m
  if (bandsOn > 1.5) {
    float row = floor(vWY / 0.75);
    float px = vA.x + mod(row, 2.0) * 0.75;
    float jx = min(fract(px / 1.5), 1.0 - fract(px / 1.5)) * 1.5, jy = min(fract(vWY / 0.75), 1.0 - fract(vWY / 0.75)) * 0.75;
    float joint = 1.0 - smoothstep(0.006, 0.006 + aa, min(jx, jy));
    float ptone = 0.94 + 0.10 * hash12(vec2(floor(px / 1.5), row));
    wallCol *= ptone * (1.0 - 0.32 * joint);
  }
  // string courses between floors (stucco / concrete buildings)
  if (bandsOn > 0.5 && bandsOn < 1.5 && yRel > 0.3 && yRel < topRel - 0.3) {
    float fy = mod(yRel, fh);
    float band = smoothstep(fh - 0.20, fh - 0.17, fy) * (1.0 - smoothstep(fh - 0.04, fh - 0.01, fy));
    float shade = (1.0 - smoothstep(0.0, 0.16, fy)) * 0.18;
    wallCol = wallCol * (1.0 + 0.10 * band) * (1.0 - shade);
  }

  if (kind > 0.5 && yRel > 0.05 && yRel < topRel - 0.15) {
    float fi = floor(yRel / fh);
    float cv = yRel - fi * fh;
    float ci = floor(vA.x / sp);
    float cu = vA.x - ci * sp;
    float rnd = hash12(vec2(fi * 13.0 + ci, seed * 91.0));
    float rnd2 = hash12(vec2(fi * 7.0 + ci * 3.0, seed * 53.0 + 1.0));
    vec3 frameCol = seed > 0.97 ? vec3(0.13, 0.27, 0.19) : seed > 0.6 ? vec3(0.13, 0.12, 0.11) : (seed > 0.3 ? vec3(0.78, 0.77, 0.73) : vec3(0.34, 0.35, 0.36));
    vec3 glassCol = mix(vec3(0.050, 0.072, 0.095), vec3(0.120, 0.150, 0.175), rnd);
    float inside = 0.0, frame = 0.0, sillM = 0.0, edgeD = 1.0, topD = 1.0, reveal = 0.0, trimM = 0.0;
    if (kind < 1.5 || kind > 6.5) {         // punched windows with a recessed glass plane (parallax); kind 7 = round-arched head
      float sill = (fh - wh) * 0.42;
      float u0 = (sp - ww) * 0.5;
      vec2 lo = vec2(u0, sill), hi = vec2(u0 + ww, sill + wh);
      vec2 pc = vec2(cu, cv);
      vec3 Vv = normalize(cameraPosition - vWP);
      vec3 Nn = normalize(vWN);
      vec3 Tt = vec3(-Nn.z, 0.0, Nn.x);
      float vz = max(dot(Vv, Nn), 0.15);
      vec2 par = vec2(dot(Vv, Tt), Vv.y) / vz;
      vec2 pg = pc - par * recess;
      float cut, glassIn, outerG; float fr = 0.065;
      if (kind > 6.5) {
        float ar = ww * 0.5; vec2 ac = vec2(u0 + ar, sill + wh - ar);
        vec2 hiR = vec2(hi.x, hi.y - ar);
        cut = max(rectM(pc, lo, hiR, aa), (1.0 - smoothstep(ar - aa, ar + aa, length(pc - ac))) * step(ac.y, pc.y));
        glassIn = max(rectM(pg, lo, hiR, aa), (1.0 - smoothstep(ar - aa, ar + aa, length(pg - ac))) * step(ac.y, pg.y));
        outerG = max(rectM(pg, lo - fr, hiR, aa), (1.0 - smoothstep(ar + fr - aa, ar + fr + aa, length(pg - ac))) * step(ac.y, pg.y));
      } else {
        cut = rectM(pc, lo, hi, aa);
        glassIn = rectM(pg, lo, hi, aa);
        outerG = rectM(pg, lo - fr, hi + fr, aa);
      }
      float frameG = clamp(outerG - glassIn, 0.0, 1.0);
      if (lites > 0.5) {
        // divided-lite sash: muntins every ~0.55 m, transom bar at 68 % height, meeting rail at 34 %
        float nC = max(2.0, floor(ww / 0.55 + 0.5));
        float fu = (pg.x - u0) / ww * nC; float mu = min(fract(fu), 1.0 - fract(fu)) * ww / nC;
        float fv = (pg.y - sill) / wh;
        float tr = min(abs(fv - 0.68), abs(fv - 0.34)) * wh;
        float mun = max(1.0 - smoothstep(0.018, 0.018 + aa * 1.5, mu), 1.0 - smoothstep(0.025, 0.025 + aa * 1.5, tr));
        frameG = max(frameG, mun * glassIn); glassIn *= 1.0 - mun;
      } else if (ww > 1.9) { float mu = abs(pg.x - sp * 0.5); frameG = max(frameG, (1.0 - smoothstep(0.03, 0.03 + aa * 2.0, mu)) * glassIn); glassIn *= 1.0 - frameG; }
      inside = cut * glassIn;
      frame = cut * frameG;
      reveal = cut * clamp(1.0 - outerG, 0.0, 1.0);
      sillM = rectM(pc, lo - vec2(0.12, 0.14), vec2(hi.x + 0.12, lo.y - 0.03), aa);
      trimM = clamp(rectM(pc, lo - vec2(0.12), hi + vec2(0.12), aa) - cut, 0.0, 1.0);
      edgeD = min(min(pg.x - u0, u0 + ww - pg.x), min(pg.y - sill, sill + wh - pg.y));
      topD = sill + wh - pg.y;
    } else if (kind < 2.5) {                // ribbon windows
      float lo = fh * 0.30, hi = fh * 0.88;
      float mw = 0.06;
      float band = rectM(vec2(0.5, cv), vec2(0.0, lo), vec2(1.0, hi), aa);
      float mull = 1.0 - smoothstep(mw, mw + aa * 2.0, min(cu, sp - cu));
      inside = band * (1.0 - mull);
      frame = band * mull;
      float cap = rectM(vec2(0.5, cv), vec2(0.0, lo - 0.08), vec2(1.0, hi + 0.08), aa);
      frame = max(frame, clamp(cap - band, 0.0, 1.0));
      edgeD = min(cv - lo, hi - cv); topD = hi - cv;
    } else if (kind < 3.5) {                // open parking decks
      float lo = fh * 0.20, hi = fh * 0.90;
      float col = 1.0 - smoothstep(0.24, 0.24 + aa * 2.0, min(cu, sp - cu));
      float band = rectM(vec2(0.5, cv), vec2(0.0, lo), vec2(1.0, hi), aa);
      inside = band * (1.0 - col);
      glassCol = mix(vec3(0.012, 0.012, 0.013), vec3(0.06, 0.058, 0.055), smoothstep(lo, hi, cv) * (0.3 + 0.7 * rnd));
      topD = hi - cv;
    } else if (kind < 5.5) {                // institutional concrete: projecting spandrels + louvered ribbon, glazed ground floor
      if (fi < 0.5) {
        float hi = min(fh - 0.55, 3.7);
        float band = rectM(vec2(0.5, cv), vec2(0.0, 0.35), vec2(1.0, hi), aa);
        float col = 1.0 - smoothstep(0.16, 0.16 + aa * 2.0, min(cu, sp - cu));
        float tr = rectM(vec2(0.5, cv), vec2(0.0, 2.55), vec2(1.0, 2.62), aa);
        inside = band * (1.0 - col);
        frame = max(band * col * 0.0, tr * band);
        topD = hi - cv; edgeD = 1.0;
        glassCol = mix(vec3(0.03, 0.05, 0.07), vec3(0.20, 0.18, 0.15), smoothstep(0.35, hi, cv) * rnd);
      } else {
        float lo = fh * 0.42, hi = fh * 0.93;
        float band = rectM(vec2(0.5, cv), vec2(0.0, lo), vec2(1.0, hi), aa);
        float col = 1.0 - smoothstep(0.10, 0.10 + aa * 2.0, min(cu, sp - cu));
        float lv = abs(fract(vA.x / 0.42) - 0.5);
        float louver = 1.0 - smoothstep(0.035, 0.05, lv);
        inside = band * (1.0 - col);
        frame = clamp(band * col + inside * louver * 0.55, 0.0, 1.0);
        // deep shadow under the projecting slab above, and on the spandrel top edge
        wallCol *= 1.0 - 0.28 * smoothstep(lo - 0.02, lo - 0.9, cv) * (1.0 - band);
        topD = hi - cv; edgeD = min(cv - lo, hi - cv);
        glassCol = mix(vec3(0.045, 0.06, 0.07), vec3(0.14, 0.16, 0.17), rnd);
      }
    } else if (kind < 6.5) {                // curtain wall (Recreation Center): near-continuous glass, thin mullions and transoms
      float lo = fh * 0.14, hi = fh * 0.97;
      float band = rectM(vec2(0.5, cv), vec2(0.0, lo), vec2(1.0, hi), aa);
      float mull = 1.0 - smoothstep(0.035, 0.035 + aa * 2.0, abs(fract(vA.x / 1.5) - 0.5) * 1.5 - 0.0 + 0.0 - 0.0);
      mull = 1.0 - smoothstep(0.03, 0.03 + aa * 2.0, min(fract(vA.x / 1.5), 1.0 - fract(vA.x / 1.5)) * 1.5);
      float tran = 1.0 - smoothstep(0.03, 0.03 + aa * 2.0, abs(cv - fh * 0.55));
      inside = band * (1.0 - clamp(mull + tran, 0.0, 1.0));
      frame = band * clamp(mull + tran, 0.0, 1.0);
      glassCol = mix(vec3(0.05, 0.10, 0.15), vec3(0.20, 0.30, 0.38), smoothstep(lo, hi, cv) * 0.7 + 0.3 * rnd);
      topD = hi - cv; edgeD = 1.0;
    } else {                                // storefront
      if (fi < 0.5) {
        float hi = min(fh - 0.7, 3.4);
        float mw = 0.05;
        float band = rectM(vec2(0.5, cv), vec2(0.0, 0.3), vec2(1.0, hi), aa);
        float mull = 1.0 - smoothstep(mw, mw + aa * 2.0, min(cu, sp - cu));
        inside = band * (1.0 - mull);
        frame = band * mull;
        topD = hi - cv;
        glassCol = mix(vec3(0.03, 0.05, 0.07), vec3(0.18, 0.17, 0.15), smoothstep(0.3, hi, cv) * rnd);
      }
    }
    // rain streaks running down from each sill
    if (kind < 1.5) { float sillY = (fh - wh) * 0.42; float uu = (cu - (sp - ww) * 0.5) / max(ww, 0.1); float inX = smoothstep(-0.05, 0.1, uu) * (1.0 - smoothstep(0.9, 1.05, uu)); float below = smoothstep(sillY + 0.02, sillY - 0.05, cv); float fall = exp(-(sillY - cv) / 1.1) * below * inX; float sv = 0.55 + 0.45 * vnoise2(vec2(cu * 9.0 + fi * 3.0, seed * 17.0)); wallCol *= 1.0 - 0.17 * fall * sv * (1.0 - smoothstep(0.0, 0.0001, inside)); }
    // keep windows clear of the entrance on the ground floor
    float dcut = (fi < 0.5 && vC.w > 0.0 && abs(vA.x - vC.z) < vC.w + 0.8) ? 0.0 : 1.0;
    inside *= dcut; frame *= dcut; sillM *= dcut; reveal *= dcut; trimM *= dcut;
    // blinds / interior variety
    float blinds = step(0.74, rnd) * 0.9;
    float bl = blinds * smoothstep(0.0, 1.0, 1.0 - topD * 0.5);
    vec3 interior = mix(glassCol, vec3(0.38, 0.36, 0.31) * (0.6 + 0.5 * rnd2), bl);
    float recessShadow = 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.22, topD)) - 0.25 * (1.0 - smoothstep(0.0, 0.12, edgeD));
    interior *= recessShadow;
    if (kind < 2.5 || kind > 4.5) {
      vec3 room = roomColor(cu, cv, sp, fh, rnd, rnd2);
      room = mix(room, vec3(0.55, 0.52, 0.46) * (0.7 + 0.5 * rnd2), bl);               // blinds pulled down
      gRoom = room * recessShadow;
      interior = mix(vec3(0.012, 0.016, 0.02), interior, bl);                         // glass itself: dark, reflective
    }
    vec3 revealCol = wallCol * (0.48 + 0.14 * rnd2);
    wallCol = mix(wallCol, wallCol * (1.10 + 0.04 * rnd) + 0.015, trimM * trimOn);
    wallCol = mix(wallCol, wallCol * 1.12 + 0.03, sillM);
    wallCol = mix(wallCol, revealCol, reveal);
    wallCol = mix(wallCol, frameCol, frame);
    wallCol = mix(wallCol, interior, inside);
    gWin = inside; gFrame = frame;
    gLit = inside * step(0.52, rnd2) * (1.0 - 0.5 * blinds);
  }
  // accent trim: 1 = red horizontal fascia bands (Recreation Center), 2 = Cal Poly green vertical ribs (athletics buildings)
  if (vC.y > 0.5 && yRel > 0.0) {
    if (vC.y < 1.5) {
      float band = step(fh - 0.15, yRel) * step(yRel, fh + 0.85) + step(topRel - 0.9, yRel);
      wallCol = mix(wallCol, vec3(0.42, 0.06, 0.05), clamp(band, 0.0, 1.0) * (1.0 - gWin));
    } else {
      float rib = (1.0 - smoothstep(0.30, 0.36, abs(fract(vA.x / 5.5) - 0.5) * 5.5 - 2.4 + 0.0)) ;
      float ribX = step(abs(fract(vA.x / 5.5) - 0.5) * 5.5, 0.28);
      wallCol = mix(wallCol, vec3(0.02, 0.17, 0.10) * (0.9 + 0.2 * meso), ribX * (1.0 - gWin));
      float cap = step(topRel - 0.7, yRel) * (1.0 - gWin);
      wallCol = mix(wallCol, vec3(0.02, 0.17, 0.10), cap * 0.9);
    }
  }
  // entrance doors (glazed double door with a transom)
  if (vC.w > 0.0 && yRel > 0.02 && yRel < 2.7) {
    float du = abs(vA.x - vC.z);
    float dm = (1.0 - smoothstep(vC.w - aa, vC.w + aa, du)) * (1.0 - smoothstep(2.45 - aa, 2.45 + aa, yRel));
    float dout = (1.0 - smoothstep(vC.w + 0.09 - aa, vC.w + 0.09 + aa, du)) * (1.0 - smoothstep(2.55 - aa, 2.55 + aa, yRel));
    float mid = 1.0 - smoothstep(0.03, 0.03 + aa * 2.0, du);
    float rail = smoothstep(1.0 - aa, 1.0 + aa, yRel) * (1.0 - smoothstep(1.12 - aa, 1.12 + aa, yRel));
    float fr = clamp(dout - dm + mid * dm + rail * dm, 0.0, 1.0);
    vec3 dglass = vec3(0.045, 0.06, 0.075) * (0.7 + 0.6 * smoothstep(0.0, 2.4, yRel));
    wallCol = mix(wallCol, dglass, dm);
    wallCol = mix(wallCol, vec3(0.30, 0.31, 0.32), fr);
    gWin = max(gWin, dm * (1.0 - fr)); gFrame = max(gFrame, fr); gLit = max(gLit, dm * (1.0 - fr) * 0.8);
  }
  diffuseColor.rgb = wallCol;
}
`;

const FLAT_DUMMY = flatNormalTexture;

// sunset warmth of the sky (set by sky.js) so glass reflections turn warm at golden hour
export const SKYREF = { uWarm: { value: 0 } };
export function patchWallMaterial(mat, { mode = 'tex', glassReflect = 0.2, brick = null, metal = null, lumAvg = 0.374 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.defines = shader.defines || {};
    if (mode === 'brick') shader.defines.WALL_BRICK = '';
    if (mode === 'metal') shader.defines.WALL_METAL = '';
    if (mode === 'stucco') shader.defines.WALL_STUCCO = '';
    shader.uniforms.uLumAvg = { value: lumAvg };
    shader.uniforms.uNight = NIGHT;
    shader.uniforms.uBrick0 = { value: new THREE.Color(brick ? brick[0] : 0x7a3a28) };
    shader.uniforms.uBrick1 = { value: new THREE.Color(brick ? brick[1] : 0x6a3022) };
    shader.uniforms.uBrick2 = { value: new THREE.Color(brick ? brick[2] : 0x8a4a34) };
    shader.uniforms.uMetal = { value: new THREE.Color(metal || 0xb8bcc0) };
    // clear-sky gradient for window reflections (same radiance as the visible sky in sky.js; the IBL copy is desaturated)
    shader.uniforms.uSkyZen = { value: new THREE.Color(0.13, 0.36, 1.15) };
    shader.uniforms.uSkyHor = { value: new THREE.Color(1.10, 1.32, 1.58) };
    shader.uniforms.uSkyWarm = SKYREF.uWarm;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FACADE_VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = aA; vB = aB; vC = aC; vD = aD; vWY = position.y; vWP = position; vWN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + GLSL_NOTILE + FACADE_FRAG_DECL)
      .replace('#include <map_fragment>', FACADE_FRAG_MAIN)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gWallRough;
roughnessFactor = mix(roughnessFactor, 0.06, gWin);
roughnessFactor = mix(roughnessFactor, 0.40, gFrame);`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = gWallMetal;
metalnessFactor = mix(metalnessFactor, ${glassReflect.toFixed(2)}, gWin);
metalnessFactor = mix(metalnessFactor, 0.55, gFrame);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.74, 0.40) * gLit * uNight * 2.4;
totalEmissiveRadiance += gRoom * gWin * mix(0.16, 0.05, uNight);
{ // sky reflected in the glass: Schlick Fresnel (double glazing, F0 ~ 0.08) x clear-sky gradient above, darker surroundings below
  vec3 Vv = normalize(vViewPosition);
  vec3 Rw = inverseTransformDirection(reflect(-Vv, normal), viewMatrix);
  float cosT = clamp(dot(normal, Vv), 0.0, 1.0);
  float Fr = 0.08 + 0.92 * pow(1.0 - cosT, 5.0);
  vec3 skyR = mix(uSkyHor, uSkyZen, pow(clamp(Rw.y, 0.0, 1.0), 0.42));
  skyR = mix(skyR, vec3(2.0, 1.25, 0.6), uSkyWarm * pow(1.0 - clamp(Rw.y, 0.0, 1.0), 3.0) * 0.7);   // sunset band near the horizon
  vec3 refl = mix(vec3(0.10, 0.10, 0.09), skyR, smoothstep(-0.04, 0.10, Rw.y));
  totalEmissiveRadiance += gWin * Fr * refl * (1.0 - uNight) * 0.85;
}`)
      .replace('#include <normal_fragment_maps>', `
vec3 mapN = gWallN; mapN.xy *= normalScale;
normal = normalize(tbn * mapN);
normal = normalize(mix(normal, nonPerturbedNormal, clamp(gWin + gFrame, 0.0, 1.0)));`);
  };
  mat.customProgramCacheKey = () => 'facade-v4-' + mode;
  void FLAT_DUMMY;
}


// ------------------------------------------------------------------------------------------- pavements
// Ribbon geometry: uv.x = metres from the centre line (signed), uv.y = metres along the path; aHW = half width.
const PAVE_FRAG = /* glsl */ `
varying float vHW;
vec3 gPN = vec3(0.0, 0.0, 1.0); float gPR = 0.9;
vec3 pavePattern(vec2 p, float hw){
  float edge = hw - abs(p.x);                     // < 0 on the sloped side faces
  #if defined(PAVE_STEPS)
    float f = fract(p.y / 0.30);
    float tread = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.90, 0.99, f));
    float slab = floor(p.y / 0.30);
    vec3 c = vec3(0.60, 0.585, 0.56) * (0.86 + 0.2 * hash11(slab * 1.3));
    c *= mix(0.55, 1.0, tread);
    c *= 1.0 + 0.2 * (1.0 - smoothstep(0.0, 0.04, f));                 // nosing highlight
    c *= 0.84 + 0.3 * fbm2(p * 1.1);
    gPN = normalize(vec3(0.0, -(f > 0.92 ? 0.8 : 0.0) + (f < 0.06 ? 0.5 : 0.0), 1.0));
    gPR = 0.92;
    return c;
  #elif defined(PAVE_PAVER)
    const vec2 PS = vec2(0.20, 0.10);
    float row = floor(p.x / PS.y);
    vec2 q = vec2(p.y + mod(row, 2.0) * 0.5 * PS.x, p.x);
    vec2 cell = vec2(floor(q.x / PS.x), row);
    vec2 f = vec2(fract(q.x / PS.x), fract(q.y / PS.y));
    float mortar = 1.0 - smoothstep(0.0, 0.05, min(min(f.x, 1.0 - f.x) * PS.x, min(f.y, 1.0 - f.y) * PS.y) - 0.004);
    float r1 = hash12(cell), r2 = hash12(cell + 7.7);
    // salmon / terracotta concrete pavers (University Union plaza, Dexter walk photos), pale sand joints
    vec3 pc = mix(vec3(0.66, 0.38, 0.29), vec3(0.78, 0.50, 0.38), r1) * (0.88 + 0.24 * r2);
    pc = mix(pc, vec3(0.60, 0.46, 0.38), step(0.9, hash12(cell + 2.2)));
    vec3 c = mix(pc, vec3(0.62, 0.58, 0.52), mortar * 0.7);
    c *= 0.82 + 0.3 * fbm2(p * 0.9 + 3.0);
    gPN = normalize(vec3((f.x - 0.5) * 0.05 * (1.0 - mortar), (f.y - 0.5) * 0.05 * (1.0 - mortar), 1.0));
    gPR = 0.85;
    return c;
  #else
    float slab = floor(p.y / 1.52);
    float t = hash11(slab * 1.7 + floor(hw * 10.0));
    vec3 c = vec3(0.60, 0.545, 0.44) * (0.84 + 0.22 * t);
    float jf = fract(p.y / 1.52);
    float jd = min(jf, 1.0 - jf) * 1.52;
    float joint = 1.0 - smoothstep(0.004, 0.016, jd);
    float lj = hw > 1.15 ? 1.0 - smoothstep(0.004, 0.016, abs(p.x)) : 0.0;
    c *= 1.0 - 0.5 * max(joint, lj);
    c *= 0.94 + 0.10 * vnoise2(vec2(p.x * 36.0, p.y * 1.8));             // broom finish
    c *= 0.80 + 0.34 * fbm2(p * 0.7 + t * 13.0);                          // stains / weathering
    c *= 0.78 + 0.22 * smoothstep(0.0, 0.3, edge);                        // dirt towards the edge
    float crack = smoothstep(0.012, 0.0, abs(fbm2(p * 1.6 + t * 5.0) - 0.5) - 0.0) * step(0.62, t);
    c *= 1.0 - 0.16 * crack;
    c = mix(c, c * vec3(0.8, 0.92, 0.72), smoothstep(0.35, 0.0, edge) * 0.35 * vnoise2(p * 3.0));  // algae at the edge
    gPN = normalize(vec3(0.0, (jf < 0.5 ? 1.0 : -1.0) * max(joint, 0.0) * 0.6, 1.0));
    gPR = 0.9;
    return c;
  #endif
}
`;

export function makePavementMaterial(kind /* 'walk' | 'steps' | 'paver' */) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, normalMap: flatNormalTexture(), envMapIntensity: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (shader) => {
    shader.defines = shader.defines || {};
    if (kind === 'steps') shader.defines.PAVE_STEPS = ''; else if (kind === 'paver') shader.defines.PAVE_PAVER = '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHW; varying float vHW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHW = aHW;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + PAVE_FRAG)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = pavePattern(vNormalMapUv, vHW);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gPR;')
      .replace('#include <normal_fragment_maps>', 'vec3 mapN = gPN; normal = normalize(tbn * mapN);');
  };
  m.customProgramCacheKey = () => 'pave-' + kind;
  return m;
}

// worn dirt "desire path" trails: soft edges, mottled dirt colour (alpha blended on the grass)
export function makeDesirePathMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHW; varying float vHW; varying vec2 vPUv; varying vec3 vPW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHW = aHW; vPUv = uv; vPW = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHW; varying vec2 vPUv; varying vec3 vPW;\n' + GLSL_COMMON)
      .replace('#include <map_fragment>', `
        float across = abs(vPUv.x) / max(vHW, 0.01);
        float wob = vnoise2(vec2(vPUv.y * 0.7, 3.0)) * 0.25;
        float a = (1.0 - smoothstep(0.35 + wob, 1.0, across)) * (0.55 + 0.45 * vnoise2(vPUv * 4.0 + 9.0));
        vec3 dirt = mix(vec3(0.40, 0.33, 0.24), vec3(0.50, 0.42, 0.30), fbm2(vPW.xz * 0.9));
        dirt *= 0.8 + 0.3 * hash12(floor(vPW.xz * 14.0));
        diffuseColor = vec4(dirt, clamp(a * 1.25, 0.0, 0.92));`);
  };
  m.customProgramCacheKey = () => 'desire-v1';
  return m;
}
