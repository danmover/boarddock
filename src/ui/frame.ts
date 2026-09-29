// Where to put the 3D view's camera so a box is in the picture.
import * as THREE from 'three';

/** How far from the box's middle, looking along -d, the camera must be for all 8 corners of it to be in the picture (with a margin that grows with k). */
export function cornerDist(cam: THREE.PerspectiveCamera, box: THREE.Box3, d: THREE.Vector3, k: number): number {
  const fwd = d.clone().negate(), up = Math.abs(d.z) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize(), vup = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const ctr = box.getCenter(new THREE.Vector3()), v = new THREE.Vector3();
  let hw = 0, hh = 0, hd = 0;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(ctr);
    hw = Math.max(hw, Math.abs(v.dot(right))); hh = Math.max(hh, Math.abs(v.dot(vup))); hd = Math.max(hd, v.dot(d));
  }
  const t = Math.tan(((cam.fov / 2) * Math.PI) / 180), m = 1 + (k - 1) * 0.5;
  return Math.max((hh * m) / t, (hw * m) / (t * (cam.aspect || 1))) + hd;
}
