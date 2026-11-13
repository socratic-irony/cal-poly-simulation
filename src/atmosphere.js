import * as THREE from 'three';

// Aerial perspective for every fogged material: replaces three's exponential fog with
//  * height-dependent density (the valley air is hazier than the ridge tops; the integral of
//    exp(-h / H) along the view ray is evaluated analytically, so high viewpoints see clearer air
//    nearby and the far hills still fade into the horizon colour);
//  * forward scattering toward the sun (warm glow in the haze when looking sunward, strongest at
//    golden hour), using the first directional light (the sun) that lit materials already receive.
// fogColor / fogDensity still come from the FogExp2 that SkyRig drives, so time-of-day tinting works.
export const ATMOS = {
  scaleHeight: 850,      // metres: e-folding height of the haze layer above the campus floor
};

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRel;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRel = transpose(mat3(viewMatrix)) * mvPosition.xyz;   // camera -> vertex, world orientation
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRel;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fDist = length(vFogRel);
    vec3 fDir = vFogRel / max(fDist, 1e-3);
    const float fK = 1.0 / ${ATMOS.scaleHeight.toFixed(1)};
    float fDy = vFogRel.y;
    float hInt = exp(-fK * max(cameraPosition.y, -60.0)) * (abs(fDy) > 0.5 ? (1.0 - exp(-fK * fDy)) / (fK * fDy) : 1.0);
    float fogFactor = 1.0 - exp(-fogDensity * fDist * hInt);
    vec3 fCol = fogColor * mix(vec3(1.0), vec3(0.88, 0.96, 1.10), smoothstep(1500.0, 9000.0, fDist));   // far ridges go blue-grey
    #if (defined(STANDARD) || defined(LAMBERT) || defined(PHONG)) && NUM_DIR_LIGHTS > 0
      vec3 fSun = directionalLights[0].direction;                 // view space, toward the sun
      vec3 fV = normalize(mat3(viewMatrix) * fDir);
      float cs = max(dot(fV, fSun), 0.0);
      vec3 sc = directionalLights[0].color;
      float sl = max(max(sc.r, sc.g), max(sc.b, 1e-4));
      float fogLum = dot(fogColor, vec3(0.2126, 0.7152, 0.0722));
      fCol += (sc / sl) * fogLum * (0.28 * pow(cs, 6.0) + 0.55 * pow(cs, 40.0)) * min(sl / 3.0, 1.0);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fCol, fogFactor);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
