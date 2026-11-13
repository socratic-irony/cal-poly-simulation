import * as THREE from 'three';
import { NIGHT, smooth01 } from './night.js';
import { SKYREF } from './shading.js';

// San Luis Obispo is at ~35.3°N. Approximate solar position for a given day-of-year and *solar* hour.
export function sunPosition(dayOfYear, hour, latDeg = 35.3) {
  const lat = (latDeg * Math.PI) / 180;
  const decl = (-23.44 * Math.PI / 180) * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const ha = ((hour - 12) * 15 * Math.PI) / 180;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const alt = Math.asin(sinAlt);
  const cosAz = (Math.sin(decl) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat));
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz)));
  if (ha > 0) az = 2 * Math.PI - az;           // afternoon: west of south
  return { alt, az };                          // radians, az measured clockwise from north
}

const ENV_DESAT = Number(new URLSearchParams(location.search).get('envdesat') ?? 0.5);

export class SkyRig {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    // analytic gradient sky calibrated against clear-day reference photos of the campus (deep zenith blue, pale horizon)
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunPosition: { value: new THREE.Vector3(0, 1, 0) }, uNight: NIGHT, uWarm: { value: 0 }, uEnvDesat: { value: 0 }, uZen: { value: new THREE.Color(0.13, 0.36, 1.15) }, uHor: { value: new THREE.Color(1.10, 1.32, 1.58) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        uniform vec3 sunPosition; uniform float uNight, uWarm, uEnvDesat; uniform vec3 uZen, uHor; varying vec3 vDir;
        float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vDir); vec3 sd = normalize(sunPosition);
          float e = d.y;
          float t = pow(clamp(e, 0.0, 1.0), 0.42);
          vec3 c = mix(uHor, uZen, t);
          c = mix(c, uHor * vec3(0.55, 0.55, 0.5), smoothstep(0.0, -0.25, e));        // below the horizon
          float cs = max(dot(d, sd), 0.0);
          vec3 warmH = vec3(2.4, 1.35, 0.55);
          c = mix(c, warmH, uWarm * pow(1.0 - clamp(e, 0.0, 1.0), 4.0) * (0.35 + 0.65 * pow(cs, 3.0)));   // sunset band
          c += vec3(1.0, 0.92, 0.78) * (0.28 * pow(cs, 14.0) + 1.2 * pow(cs, 160.0)) * (1.0 - 0.6 * uWarm);  // glow
          c += vec3(30.0, 27.0, 22.0) * smoothstep(0.99985, 0.99995, cs);            // sun disc
          // night
          vec3 night = mix(vec3(0.02, 0.03, 0.06), vec3(0.005, 0.008, 0.02), t);
          c = mix(c, night, uNight);
          c += (rnd(gl_FragCoord.xy) - 0.5) * 0.004;
          // lighting copy only: real clear-sky irradiance is far less saturated than the deep zenith blue we see
          c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), uEnvDesat);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.scale.setScalar(30000);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    this.sun.castShadow = true;
    const sm = new URLSearchParams(location.search).get('q') === 'low' ? 2048 : 4096;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.35;
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 4000;
    scene.add(this.sun); scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x8fa8d8, 0);
    this.moon.position.set(-3000, 4000, 2000);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0xbcd4ee, 0x8a7a5e, 0.35);
    scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.dir = new THREE.Vector3(0, 1, 0);
    this.fog = new THREE.FogExp2(0xa9c4e2, 0.000105);   // per metre at the campus floor; height falloff in atmosphere.js
    scene.fog = this.fog;
    // lower hemisphere for the environment map only: soft, sun-lit ground bounce so shaded walls aren't black
    this.groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.17, 0.13), side: THREE.BackSide, toneMapped: false });
    this.ground = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.groundMat);
    this.envScene.add(this.ground);
    this.envTarget = null;
    this.hour = 14; this.day = 315;
  }

  setTime(hour, day = this.day) {
    this.hour = hour; this.day = day;
    const { alt, az } = sunPosition(day, hour);
    this.alt = alt; this.az = az;
    NIGHT.value = smooth01(0.03, -0.14, alt);
    this.dir.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    this.sky.material.uniforms.sunPosition.value.copy(this.dir);
    this.sky.material.uniforms.uWarm.value = Math.min(1, Math.max(0, 1 - Math.max(alt, 0) / 0.35));
    SKYREF.uWarm.value = this.sky.material.uniforms.uWarm.value;
    this.envK = 1 - 0.4 * this.sky.material.uniforms.uWarm.value;   // low sun: less blue skylight, so the warm direct light reads
    const elev = Math.max(alt, 0);
    // sun colour: warm near the horizon
    const warm = 1 - Math.min(1, elev / 0.55);
    this.sun.color.setRGB(1.0, 0.95 - 0.30 * warm, 0.86 - 0.52 * warm);
    const daylight = Math.min(1, Math.max(0, (alt + 0.06) / 0.2));
    this.sun.intensity = 4.0 * daylight * (0.55 + 0.45 * Math.min(1, elev / 0.5));
    this.hemi.intensity = 0.12 * daylight + 0.10 * NIGHT.value;
    const bounce = (this.sun.intensity * Math.max(0.05, Math.sin(Math.max(alt, 0))) / Math.PI) * 0.30;
    this.groundMat.color.setRGB(1.0, 0.94, 0.76).multiplyScalar(Math.max(bounce, 0.004));
    // horizon haze colour
    // haze colour = horizon sky radiance (so distant hills fade into the sky), warmer at low sun
    const c = new THREE.Color().setRGB(1.15 + 0.6 * warm, 1.35 - 0.05 * warm, 1.55 - 0.55 * warm).multiplyScalar(0.12 + 0.88 * daylight).multiplyScalar(0.85);
    this.fog.color.copy(c);
    NIGHT.value = smooth01(0.03, -0.14, alt);
    this.moon.intensity = 0.55 * NIGHT.value;
    this.renderer.toneMappingExposure = 0.42 * (1 + 2.8 * Math.pow(warm, 1.5)) * (1 - NIGHT.value) + 1.0 * NIGHT.value;
    this.updateEnvironment();
    this.renderer.shadowMap.needsUpdate = true;
  }

  updateEnvironment() {
    this.envScene.add(this.sky);
    if (this.envTarget) this.envTarget.dispose();
    this.sky.material.uniforms.uEnvDesat.value = ENV_DESAT;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.02);
    this.sky.material.uniforms.uEnvDesat.value = 0;
    this.scene.add(this.sky);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.85 * (this.envK ?? 1);   // sky fill: shaded walls read at ~1/5 of sunlit ones, as in photos
  }

  // keep the shadow frustum centred (and texel-snapped) on the area the camera is looking at
  followTarget(target, extent) {
    const d = this.dir;
    // the shadow map is only re-rendered when this frustum actually moves (by > ~1 texel) or resizes
    const lf = this._lastFollow || (this._lastFollow = [1e9, 0, 0, 0, 0, 0, 0]);
    const texel = (2 * extent) / this.sun.shadow.mapSize.x;
    if (Math.abs(extent - lf[3]) / Math.max(extent, 1) < 0.02 && Math.hypot(target.x - lf[0], target.y - lf[1], target.z - lf[2]) < texel
      && Math.abs(d.x - lf[4]) + Math.abs(d.y - lf[5]) + Math.abs(d.z - lf[6]) < 1e-6) return;
    lf[0] = target.x; lf[1] = target.y; lf[2] = target.z; lf[3] = extent; lf[4] = d.x; lf[5] = d.y; lf[6] = d.z;
    this.renderer.shadowMap.needsUpdate = true;
    const dist = Math.max(extent * 2.2, 400);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(d, dist);
    const cam = this.sun.shadow.camera;
    cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent;
    cam.near = dist - extent * 2.0 - 400; cam.far = dist + extent * 2.0 + 400;
    if (cam.near < 1) cam.near = 1;
    cam.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld(); this.sun.updateMatrixWorld();
  }
}
