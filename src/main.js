import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadJSON, loadFloat32, url, loadImage } from './util.js';
import { Heightfield, buildTerrainMeshes } from './heightfield.js';
import { rasterizeGround, buildGroundArrays, makeTerrainMaterial, buildAOTexture } from './ground.js';
import { Clouds } from './clouds.js';
import { createMaterials, buildBuildings } from './buildings.js';
import { AERIAL } from './shading.js';
import { SkyRig } from './sky.js';
import { buildOccupancy, buildTrees, FOLIAGE } from './trees.js';
import { WalkControls } from './controls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { makeGradePass } from './grade.js';
import { Tour } from './tour.js';
import { Grass } from './grass.js';
import { Labels } from './labels.js';
import { NIGHT, buildLampGlow, buildStars } from './night.js';
import { setupUI } from './ui.js';
import { buildRoadMarks } from './roadmarks.js';
import { buildProps, buildFences, buildCars, buildThePLetter } from './props.js';
import { buildWater } from './water.js';
import { buildPavements, buildDesirePaths } from './paths.js';
import { smoothRoads } from './smooth.js';
import { buildFields, buildLightTowers, buildBleachers } from './fields.js';

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud');
const loading = document.getElementById('loading');
const say = (t) => { loading.textContent = t; };

const QUALITY = params.get('q') || 'high';
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
const MAX_PR = Math.min(window.devicePixelRatio, parseFloat(params.get('pr') || (QUALITY === 'low' ? '1' : '2')));
let curPR = MAX_PR;
renderer.setPixelRatio(curPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.45;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 40000);
camera.position.set(-380, 650, 1250);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-60, 90, 450);
controls.maxPolarAngle = Math.PI * 0.495;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 9000;
controls.minDistance = 4;

const sky = new SkyRig(scene, renderer);
const clouds = new Clouds(scene);
sky.setTime(parseFloat(params.get('t') || '14'));

const app = { renderer, scene, camera, controls, sky, data: null, hf: null, composer: null };
window.__app = app;
app.clouds = clouds;

async function init() {
  say('Loading data…');
  const [data, coreArr, outerArr, manifest, roofs, detected, lidarB, lidarT, wideT] = await Promise.all([
    loadJSON('data/campus.json'), loadFloat32('data/terrain_core.bin'), loadFloat32('data/terrain_outer.bin'), loadJSON('textures/manifest.json'),
    loadJSON('data/roofs.json').catch(() => null), loadJSON('data/trees_detected.json').catch(() => null),
    loadJSON('data/lidar_bldg.json').catch(() => null), loadJSON('data/trees_lidar.json').catch(() => null),
    loadJSON('data/trees_wide.json').catch(() => null),
  ]);
  app.data = data;
  const sm = smoothRoads(data); console.log('smoothed roads', sm);
  const farArr = data.terrain.far ? await loadFloat32('data/terrain_far.bin').catch(() => null) : null;
  const hf = new Heightfield(data.terrain, coreArr, outerArr, farArr);
  app.hf = hf;

  say('Painting ground from OpenStreetMap…');
  const gcImg = await loadImage(url('data/ground_cls.png')).catch(() => null);
  const splat = rasterizeGround(data, gcImg); app.splat = splat;
  const arrays = await buildGroundArrays(1024);
  const uni = {};
  const macroTex = new THREE.TextureLoader().load(url('data/macro.jpg'));
  macroTex.colorSpace = THREE.SRGBColorSpace; macroTex.flipY = false; macroTex.wrapS = macroTex.wrapT = THREE.ClampToEdgeWrapping; macroTex.anisotropy = 8;
  { const mf = new THREE.TextureLoader().load(url('data/macro_far.jpg')); mf.colorSpace = THREE.SRGBColorSpace; mf.flipY = false; mf.wrapS = mf.wrapT = THREE.ClampToEdgeWrapping; macroTex.userData.far = mf; }
  { const mw = new THREE.TextureLoader().load(url('data/macro_wide.jpg')); mw.colorSpace = THREE.SRGBColorSpace; mw.flipY = false; mw.wrapS = mw.wrapT = THREE.ClampToEdgeWrapping; macroTex.userData.wide = mw; }
  { const w = new THREE.TextureLoader().load(url('data/macro_w.png')); w.flipY = false; w.colorSpace = THREE.NoColorSpace; w.wrapS = w.wrapT = THREE.ClampToEdgeWrapping; macroTex.userData.w = w; }
  const terrainMat = makeTerrainMaterial({ splat, arrays, uniformsOut: uni, macro: macroTex });
  app.terrainUniforms = uni.terrain;
  const terrain = buildTerrainMeshes(hf, terrainMat);
  scene.add(terrain);
  app.terrain = terrain;

  say('Raising buildings…');
  {
    const at = await new THREE.TextureLoader().loadAsync(url('data/aerial.jpg')).catch(() => null);
    if (at) { at.colorSpace = THREE.SRGBColorSpace; at.flipY = false; at.anisotropy = 8; at.wrapS = at.wrapT = THREE.ClampToEdgeWrapping; AERIAL.tex = at; }
  }
  const mats = createMaterials(manifest, renderer.capabilities.getMaxAnisotropy());
  const b = buildBuildings(data, hf, mats, roofs, lidarB);
  scene.add(b.group);
  app.buildings = b;
  app.mats = mats;

  app.walk = new WalkControls(camera, renderer.domElement, hf, b.colliders);

  say('Planting trees…');
  const occ = buildOccupancy(data, splat.canvasA);
  const trees = buildTrees(data, hf, occ, { density: QUALITY === 'low' ? 0.55 : 1, detected: lidarT || null, wide: QUALITY === 'low' ? null : wideT });
  scene.add(trees.group);
  app.trees = trees; trees.update(camera, true);
  app.terrainUniforms.uAO.value = buildAOTexture(data, trees.placed);
  if (QUALITY !== 'low') app.grass = new Grass(scene, hf, occ, splat.canvasB, app.terrainUniforms);
  console.log('trees', trees.total, Object.fromEntries(Object.entries(trees.placed).map(([k, v]) => [k, v.length])));

  say('Laying sidewalks, curbs and paths…');
  const pav = buildPavements(data, hf); scene.add(pav.group);
  const desire = buildDesirePaths(data, hf, b.doors, splat); scene.add(desire.group); app.desire = desire;
  console.log('pavements', pav.nWalk, 'walk ribbons', pav.nCurb, 'curbed streets', 'desire paths', desire.count);
  say('Painting roads and placing street furniture…');
  const marks = buildRoadMarks(data, hf);
  scene.add(marks.group);
  const walkRoads = data.roads.filter((r) => r.k === 'walk' && r.w >= 2.2 && r.hw !== 'steps' && r.hw !== 'cycleway');
  const props = buildProps(data, hf, occ, walkRoads);
  scene.add(props.group);
  app.props = props;
  scene.add(buildFences(data, hf, mats));
  scene.add(buildThePLetter(hf));
  const water = buildWater(data, hf); scene.add(water.group);
  const fields = buildFields(data, hf); scene.add(fields.group);
  const bleachers = buildBleachers(data, hf); scene.add(bleachers.group);
  const towers = buildLightTowers(data, hf); scene.add(towers.group); app.towers = towers;
  console.log('fields', fields.count, 'bleachers', bleachers.count, 'light poles', towers.count);
  const cars = buildCars(marks.stalls, hf); scene.add(cars.mesh);
  console.log('props', props.counts, 'lots', marks.lots, 'cars', cars.count);

  // start the camera over the academic core
  const gy = hf.at(-60, 450);
  controls.target.set(-60, gy + 5, 450);
  camera.position.set(-380, gy + 650, 1250);
  controls.update();

  // ---- post-processing: screen-space AO (replaces the render pass) -> tone mapping/sRGB -> SMAA
  if (params.get('ao') !== '0' && QUALITY !== 'low') {
    const w = window.innerWidth, h = window.innerHeight;
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    const ao = new N8AOPass(scene, camera, w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    ao.configuration.aoRadius = 5.0;
    ao.configuration.distanceFalloff = 1.2;
    ao.configuration.intensity = 3.2;
    ao.configuration.aoSamples = 12;
    ao.configuration.denoiseSamples = 6;
    ao.configuration.denoiseRadius = 10;
    ao.configuration.halfRes = true;
    ao.configuration.gammaCorrection = false;
    ao.configuration.color = new THREE.Color(0.02, 0.025, 0.04);
    composer.addPass(ao);
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.55, 1.5);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const grade = makeGradePass(); composer.addPass(grade);
    composer.addPass(new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()));
    app.composer = composer; app.aoPass = ao; app.grade = grade; app.bloom = bloom;
  }
  app.tour = new Tour(app);
  const glow = buildLampGlow(props.lampPts); scene.add(glow.mesh); app.glow = glow;
  const stars = buildStars(); scene.add(stars.pts); app.stars = stars;
  setupUI(app);
  app.labels = new Labels(app);
  loading.classList.add('done');
  hud.innerHTML = `<b>Cal Poly SLO</b> campus model<br>drag = orbit · right-drag = pan · wheel = zoom<br><span style="opacity:.7">${data.buildings.length} buildings · OSM + USGS data</span>`;
  app.ready = true;
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (app.composer) { app.composer.setPixelRatio(renderer.getPixelRatio()); app.composer.setSize(window.innerWidth, window.innerHeight); }
}
window.addEventListener('resize', resize);

let last = performance.now();
function frame() {
  const nowT = performance.now(); const dt = Math.min(0.1, (nowT - last) / 1000); last = nowT;
  if (app.walk && app.walk.active) app.walk.update(dt); else if (!(app.tour && app.tour.active)) controls.update();
  const tsec = performance.now() / 1000;
  for (const m of FOLIAGE) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = tsec;
  if (app.terrainUniforms) app.terrainUniforms.uTime.value = tsec;
  clouds.update(tsec, sky, camera);
  if (app.props) app.props.lampHeadMat.emissiveIntensity = NIGHT.value * 4;
  if (app.glow) app.glow.mat.opacity = NIGHT.value;
  if (app.towers) app.towers.bankMat.emissiveIntensity = NIGHT.value * 6;
  if (app.stars) { app.stars.mat.opacity = Math.max(0, NIGHT.value * 1.2 - 0.2); app.stars.pts.position.copy(camera.position); }
  if (app.tour) app.tour.update(dt);
  if (app.trees && app.ready) app.trees.update(camera);
  if (app.grass && app.ready) app.grass.update(camera.position, tsec);
  if (app.labels && !app.shooting) app.labels.update();
  if (app.ready) {
    const walking = app.walk && app.walk.active;
    const dist = walking ? 60 : camera.position.distanceTo(controls.target);
    camera.near = walking ? 0.15 : Math.max(0.3, dist * 0.004);
    camera.far = 40000;
    camera.updateProjectionMatrix();
    if (walking) {
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      const tgt = camera.position.clone().addScaledVector(d, 60); tgt.y = camera.position.y - 1.7;
      sky.followTarget(tgt, 220);
    } else sky.followTarget(controls.target, Math.min(1400, Math.max(120, dist * 0.7)));
  }
  if (app.grade) app.grade.uniforms.uTime.value = tsec % 100;
  if (app.composer) app.composer.render(); else renderer.render(scene, camera);
}
let winStart = performance.now(), winFrames = 0;
function loop() {
  frame(); requestAnimationFrame(loop);
  winFrames++;
  const now = performance.now();
  if (now - winStart > 2500) {
    const fps = (winFrames * 1000) / (now - winStart);
    winStart = now; winFrames = 0;
    if (params.get('auto') !== '0' && !document.hidden) {
      let pr = curPR;
      if (fps < 24 && curPR > 0.75) pr = Math.max(0.75, curPR - 0.25);
      else if (fps > 55 && curPR < MAX_PR) pr = Math.min(MAX_PR, curPR + 0.25);
      if (pr !== curPR) {
        curPR = pr; renderer.setPixelRatio(pr);
        if (app.composer) { app.composer.setPixelRatio(pr); app.composer.setSize(window.innerWidth, window.innerHeight); }
        else renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }
  }
}

// ---- debugging / screenshot helpers (used by the dev tooling)
app.view = (pos, target) => {
  camera.position.set(...pos); controls.target.set(...target); controls.update();
  if (app.trees) { camera.updateMatrixWorld(); app.trees.update(camera, true); }
  if (app.grass) { app.grass.last = [1e9, 1e9]; app.grass.update(camera.position, performance.now() / 1000); }
  frame();
};
// look at a ground point from a given compass azimuth (deg, direction the camera sits in), distance, and height above target
app.look = (x, z, { dist = 120, h = 25, az = 200, up = 8 } = {}) => {
  const gy = app.hf.at(x, z);
  const tx = x, ty = gy + up, tz = z;
  // try the requested azimuth first, then rotate until the camera is not inside / right on top of a building
  let best = null;
  for (let k = 0; k < 12 && !best; k++) {
    const a = ((az + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 30) * Math.PI) / 180;
    const px = x + Math.sin(a) * dist, pz = z - Math.cos(a) * dist;
    const free = app.walk && !app.walk.inside(px, pz, 1.5) && !app.walk.inside((px + x) / 2, (pz + z) / 2, 1.0) || !app.walk;
    if (free) best = [px, pz];
  }
  const [px, pz] = best || [x + Math.sin((az * Math.PI) / 180) * dist, z - Math.cos((az * Math.PI) / 180) * dist];
  const py = Math.max(app.hf.at(px, pz) + 2, gy + h);
  app.view([px, py, pz], [tx, ty, tz]);
};
app.shot = async (label = 'shot') => {
  if (curPR !== MAX_PR) { curPR = MAX_PR; renderer.setPixelRatio(MAX_PR); if (app.composer) { app.composer.setPixelRatio(MAX_PR); app.composer.setSize(window.innerWidth, window.innerHeight); } else renderer.setSize(window.innerWidth, window.innerHeight); }
  frame();
  const blob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/jpeg', 0.93));
  const res = await fetch('/__shot?name=' + encodeURIComponent(label), { method: 'POST', body: blob });
  return res.json();
};

init().then(loop).catch((e) => { console.error(e); say('Error: ' + e.message); });
