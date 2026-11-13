import * as THREE from 'three';

export const LANDMARKS = [
  { label: 'Dexter Lawn', re: /Walter F\. Dexter/, dist: 130, az: 215, h: 38, walk: [0, 55] },
  { label: 'Kennedy Library', re: /Kennedy/, dist: 110, az: 140, h: 24, walk: [30, 50] },
  { label: 'Baker Center', re: /Warren J\. Baker/, dist: 150, az: 200, h: 40, walk: [40, 0] },
  { label: 'Rec Center', re: /Recreation Center/, dist: 170, az: 240, h: 45, walk: [-40, 40] },
  { label: 'University Union', re: /University Union/, dist: 120, az: 200, h: 30, walk: [0, 40] },
  { label: 'Performing Arts', re: /Cohan/, dist: 150, az: 235, h: 38, walk: [-40, 30] },
  { label: 'Business (Orfalea)', re: /Orfalea College Of Business Building/, dist: 120, az: 170, h: 30, walk: [10, 35] },
  { label: 'Engineering IV', re: /Engineering IV/, dist: 120, az: 200, h: 30, walk: [0, 40] },
  { label: 'Poly Canyon Village', re: /Corralitos/, dist: 190, az: 200, h: 55, walk: [-30, 40] },
  { label: 'Dairy & Farm', re: /Dairy Science Freestall A/, dist: 200, az: 230, h: 50, walk: [-30, 40] },
];

export function setupUI(app) {
  const { camera, controls, renderer, scene, sky, hf } = app;
  const bar = document.createElement('div');
  bar.id = 'bar';
  bar.innerHTML = `
    <div class="row">
      <button id="btn-mode" title="G">Walk mode (G)</button>
      <button id="btn-tour" title="T">▶ Tour (T)</button>
      <button id="btn-orbit" title="O">⟳ Orbit landmark (O)</button>
      <label>Time <input id="rng-time" type="range" min="0" max="24" step="0.1" value="${sky.hour}"><span id="lbl-time"></span></label>
      <label>Season <input id="rng-season" type="range" min="0" max="1" step="0.01" value="0.70"><span>green ↔ gold</span></label>
      <button id="btn-shot" title="P">📷 Save screenshot (P)</button>
    </div>
    <div class="row" id="lm"></div>`;
  document.body.appendChild(bar);

  const style = document.createElement('style');
  style.textContent = `
  #bar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);max-width:96vw;display:flex;flex-direction:column;gap:6px;align-items:center;z-index:5}
  #bar .row{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:6px 8px;background:rgba(10,14,20,.66);backdrop-filter:blur(6px);border-radius:10px;font-size:12px;color:#dde}
  #bar button{font:inherit;background:#1f2a38;color:#e8eef8;border:1px solid #38485e;border-radius:6px;padding:4px 9px;cursor:pointer}
  #bar button:hover{background:#2c3d52}
  #bar label{display:flex;align-items:center;gap:6px}
  #bar input[type=range]{width:120px}
  #tip{position:fixed;pointer-events:none;background:rgba(10,14,20,.82);color:#fff;font-size:12px;padding:5px 8px;border-radius:6px;z-index:6;display:none;max-width:260px}
  `;
  document.head.appendChild(style);
  const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);

  const fmtT = (h) => { const H = Math.floor(h), M = Math.round((h - H) * 60); return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`; };
  const lbl = bar.querySelector('#lbl-time'); lbl.textContent = fmtT(sky.hour);
  bar.querySelector('#rng-time').addEventListener('input', (e) => { const h = parseFloat(e.target.value); sky.setTime(h); lbl.textContent = fmtT(h); });
  bar.querySelector('#rng-season').addEventListener('input', (e) => { app.terrainUniforms.uDry.value = parseFloat(e.target.value); });

  // ---- mode switching
  const walk = app.walk;
  const modeBtn = bar.querySelector('#btn-mode');
  const setMode = (m) => {
    if (m === 'walk' && !walk.active) {
      walk.enter(camera, controls.target);
      controls.enabled = false; modeBtn.textContent = 'Orbit mode (G)';
    } else if (m === 'orbit' && walk.active) {
      // put the orbit target a bit in front of the walker
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      const tx = camera.position.x + d.x * 40, tz = camera.position.z + d.z * 40;
      walk.exit(); controls.enabled = true;
      controls.target.set(tx, hf.at(tx, tz) + 2, tz);
      camera.position.y += 40; controls.update();
      modeBtn.textContent = 'Walk mode (G)';
    }
  };
  app.setMode = setMode;
  modeBtn.addEventListener('click', () => setMode(walk.active ? 'orbit' : 'walk'));
  addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.code === 'KeyG') setMode(walk.active ? 'orbit' : 'walk');
    if (e.code === 'KeyF' && walk.active) walk.fly = !walk.fly;
    if (e.code === 'KeyP') app.shot('manual').then(() => {});
    if (e.code === 'KeyT') toggleTour();
    if (e.code === 'KeyH') bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
  });
  bar.querySelector('#btn-shot').addEventListener('click', () => app.shot('manual'));

  const tourBtn = bar.querySelector('#btn-tour');
  const toggleTour = () => {
    if (!app.tour.active) { app.tour.start(); tourBtn.textContent = '■ Stop tour (T)'; }
    else { app.tour.stop(); tourBtn.textContent = '▶ Tour (T)'; }
  };
  tourBtn.addEventListener('click', toggleTour);
  renderer.domElement.addEventListener('pointerdown', () => { if (app.tour.active) toggleTour(); });

  // ---- slow auto-orbit around the current target (the last landmark chosen)
  const orbitBtn = bar.querySelector('#btn-orbit');
  const setOrbit = (on) => {
    if (on && walk.active) setMode('orbit');
    controls.autoRotate = on; controls.autoRotateSpeed = 1.1;
    orbitBtn.textContent = on ? '■ Stop orbit (O)' : '⟳ Orbit landmark (O)';
  };
  orbitBtn.addEventListener('click', () => setOrbit(!controls.autoRotate));
  addEventListener('keydown', (e) => { if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return; if (e.code === 'KeyO') setOrbit(!controls.autoRotate); });
  app.setOrbit = setOrbit;

  // ---- WASD / QE / arrows also move the camera in orbit (flyover) mode: pan on the ground plane, Q/E (or Space/C) up/down
  const held = new Set();
  addEventListener('keydown', (e) => { if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return; if (e.ctrlKey || e.metaKey || e.altKey) return; held.add(e.code); });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());
  const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), mv = new THREE.Vector3();
  app.flyKeys = (dt) => {
    if (walk.active || !held.size) return;
    const k = held; let f = 0, s = 0, u = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1; if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1; if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    if (k.has('KeyE') || k.has('Space')) u += 1; if (k.has('KeyQ') || k.has('KeyC')) u -= 1;
    if (!f && !s && !u) return;
    camera.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    rgt.set(-fwd.z, 0, fwd.x);
    const dist = camera.position.distanceTo(controls.target);
    const speed = Math.max(8, dist * 0.7) * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1);
    mv.set(0, 0, 0).addScaledVector(fwd, f * speed * dt).addScaledVector(rgt, s * speed * dt); mv.y = u * speed * 0.6 * dt;
    camera.position.add(mv); controls.target.add(mv);
  };

  // ---- landmarks
  const lm = bar.querySelector('#lm');
  for (const L of LANDMARKS) {
    const b = app.buildings.info.find((i) => L.re.test(i.name));
    if (!b) continue;
    const btn = document.createElement('button'); btn.textContent = L.label;
    btn.addEventListener('click', () => {
      if (walk.active) {
        // stand a little way off, looking at the building
        const a = (L.az * Math.PI) / 180;
        const px = b.cx + Math.sin(a) * 55, pz = b.cz - Math.cos(a) * 55;
        walk.pos.set(px, hf.at(px, pz) + walk.eye, pz);
        walk.yaw = Math.atan2(-(b.cx - px), -(b.cz - pz)); walk.pitch = 0.05; walk.apply();
      } else app.look(b.cx, b.cz, { dist: L.dist, h: L.h, az: L.az, up: Math.min(b.h * 0.5, 10) });
    });
    lm.appendChild(btn);
    L.pos = b;
  }
  // Performing Arts plaza: a ground-level look at the stepped front from the SE courtyard
  {
    const btn = document.createElement('button'); btn.textContent = 'PAC Plaza (courtyard)';
    btn.addEventListener('click', () => {
      const g = hf.at(405, 198);   // plaza grade (the lawn ring to the SE is higher)
      if (walk.active) { walk.pos.set(418, hf.at(418, 214) + walk.eye, 214); walk.yaw = Math.atan2(-(385 - 418), -(168 - 214)); walk.pitch = 0.12; walk.apply(); }
      else app.view([425, g + 2.4, 222], [386, g + 11, 168]);
    });
    lm.appendChild(btn);
  }
  const vista = document.createElement('button'); vista.textContent = 'Hill vista (Morros)';
  vista.addEventListener('click', () => { if (walk.active) setMode('orbit'); app.view([1000, hf.at(1000, -700) + 15, -700], [-3210, 120, -100]); });
  lm.prepend(vista);
  const home = document.createElement('button'); home.textContent = 'Campus overview';
  home.addEventListener('click', () => { if (walk.active) setMode('orbit'); app.view([-380, hf.at(-60, 450) + 520, 1000], [-60, hf.at(-60, 450), 400]); });
  lm.prepend(home);

  // ---- click a building to see its name
  const ray = new THREE.Raycaster();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(app.buildings.group, true);
    if (!hits.length) { tip.style.display = 'none'; return; }
    const p = hits[0].point;
    let best = null, bd = 6;
    for (const c of app.buildings.colliders) {
      if (p.y > c.top + 3) continue;
      const d = polyDist(p.x, p.z, c.p);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      tip.textContent = best.name ? `${best.name}` : `(unnamed ${best.kind})`;
      tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY + 12 + 'px'; tip.style.display = 'block';
      clearTimeout(tip._t); tip._t = setTimeout(() => (tip.style.display = 'none'), 4000);
    }
  });
}

function polyDist(x, z, p) {
  let inside = false, best = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], bx = p[i], bz = p[i + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return inside ? 0 : best;
}
