// How a cable looks in the 3D view: a translucent sheath in its kind's colour, with a soft bright rim so it still reads as
// a tube, and a thin brighter core line down the middle (both from the surface's angle to the eye, in the one shader: no
// extra meshes, passes or textures). The sheath doesn't write depth, so cables that cross or run together in a bundle
// blend instead of fighting; printed parts, boards and plugs stay solid and show through it. A picked or hovered cable
// is 'hot' (more solid, brighter) and the others 'dim' a little; the three states are one program with other uniforms.
import * as THREE from 'three';

/** How much of the light a sheath lets through: round cables, flat ribbons, and the thin loose wires of a jumper set. */
export const SHEATH_OPACITY = { round: 0.5, ribbon: 0.72, wire: 0.85 } as const;
/** The sheath opacity for a cable ghost, from what it is (its name says "wire" for a loose wire; the grey one is the ribbon). */
export function sheathOpacity(name: string, ribbon: boolean): number {
  return / wire \d+$/.test(name) ? SHEATH_OPACITY.wire : ribbon ? SHEATH_OPACITY.ribbon : SHEATH_OPACITY.round;
}

export type SheathState = 'normal' | 'hot' | 'dim';

export function sheathMaterial(color: string, opacity: number, state: SheathState = 'normal'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0, transparent: true, opacity, depthWrite: false, side: THREE.FrontSide });
  const uBoost = { value: state === 'hot' ? 1 : 0 }, uDim = { value: state === 'dim' ? 1 : 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBoost = uBoost;
    sh.uniforms.uDim = uDim;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBoost; uniform float uDim;').replace('#include <opaque_fragment>', `
      // 1 in the middle of the tube, 0 at its edge: a rim that glows and thickens the sheath, and a thin core line
      float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
      float rim = pow(1.0 - ndv, 2.2), core = smoothstep(0.9, 1.0, ndv);
      vec3 lit = mix(diffuseColor.rgb, vec3(0.8), 0.4);
      outgoingLight += lit * (rim * 0.9 + core * 0.55) * (1.0 + uBoost) + diffuseColor.rgb * uBoost * 0.3;
      diffuseColor.a = clamp(diffuseColor.a + rim * 0.5 + core * 0.3, 0.0, 1.0);
      diffuseColor.a = mix(diffuseColor.a, 1.0, uBoost * 0.6) * (1.0 - 0.55 * uDim);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'cable-sheath';
  m.userData.sheath = { color, opacity };
  return m;
}
