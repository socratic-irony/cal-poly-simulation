import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final colour grade (display space): gentle desaturation (greens a bit more), mild S-curve,
// cool shadows / warm highlights, vignette and fine grain. Takes the edge off the "CG" look.
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 0.84 }, uContrast: { value: 1.07 }, uVig: { value: 0.24 }, uGrain: { value: 0.02 }, uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVig, uGrain, uTime; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float gr = clamp((c.g - max(c.r, c.b)) * 5.0, 0.0, 1.0);
      float bl = clamp((c.b - max(c.r, c.g)) * 6.0, 0.0, 1.0) * smoothstep(0.45, 0.65, l);   // keep (bright) skies blue, not shadows
      float sh = clamp((c.b - max(c.r, c.g)) * 4.0, 0.0, 1.0) * (1.0 - smoothstep(0.15, 0.45, l)); // tame blue in shadows
      c = mix(vec3(l), c, uSat - 0.12 * gr + 0.30 * bl - 0.35 * sh);
      c.r += gr * 0.012; c.b -= gr * 0.012;                               // push foliage toward olive
      c = (c - 0.5) * uContrast + 0.5;
      c = mix(c * vec3(0.985, 0.995, 1.01), c * vec3(1.05, 1.015, 0.95), smoothstep(0.2, 0.8, l));
      float d = distance(vUv, vec2(0.5)) * 1.35;
      c *= 1.0 - uVig * smoothstep(0.38, 1.0, d);
      c += (h(gl_FragCoord.xy + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export function makeGradePass() { return new ShaderPass(GradeShader); }
