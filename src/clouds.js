import * as THREE from 'three';

// A single drifting fair-weather cumulus layer. Cheap fbm shader on a big disc high above the campus.
export class Clouds {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.42, 0.5, 0.62) },
      uCover: { value: 0.56 },
      uLevel: { value: 0.9 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        varying vec3 vW;
        uniform float uTime, uCover, uLevel; uniform vec3 uSunDir, uSunColor, uAmbient;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.07+vec2(3.1,1.7); a*=0.5; } return s; }
        float dens(vec2 p){ float base = fbm(p); float det = fbm(p*3.3+7.0); return base*0.72 + det*0.28; }
        void main(){
          vec2 p = vW.xz * 0.00028 + vec2(uTime*0.0035, uTime*0.0012);
          float d = dens(p);
          float c = smoothstep(uCover, uCover + 0.2, d);
          if (c < 0.003) discard;
          // self-shadowing: density a step toward the sun
          vec2 sd = normalize(uSunDir.xz + 1e-4) * 0.025 / max(uSunDir.y, 0.25);
          float ds = dens(p + sd);
          float thick = clamp((d - uCover) * 3.0, 0.0, 1.0);
          float lit = clamp(1.0 - (ds - d) * 4.0 - thick * 0.35, 0.0, 1.0);
          vec3 col = uAmbient * (0.85 + 0.25 * thick) * 1.6 + uSunColor * lit * 1.25;
          float dist = length(vW.xz - cameraPosition.xz);
          float fade = 1.0 - smoothstep(7000.0, 22000.0, dist);
          // thin out right at the horizon where the disc is seen edge-on
          float view = abs(normalize(vW - cameraPosition).y);
          fade *= smoothstep(0.04, 0.22, view);       // low, distant parts of the flat layer read as hard 'beams' from the ground
          gl_FragColor = vec4(col * uLevel, c * fade * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(30000, 48).rotateX(-Math.PI / 2), mat);
    this.mesh.position.y = 2600; this.mesh.renderOrder = -1; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(t, sky, camera) {
    this.uniforms.uTime.value = t;
    this.uniforms.uSunDir.value.copy(sky.dir);
    this.uniforms.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.max(0.05, sky.sun.intensity / 3.4));
    const day = Math.min(1, Math.max(0, (sky.alt + 0.05) / 0.25));
    this.uniforms.uAmbient.value.setRGB(0.42, 0.5, 0.62).multiplyScalar(0.25 + 0.75 * day);
    this.mesh.position.x = camera.position.x; this.mesh.position.z = camera.position.z;
  }
}
