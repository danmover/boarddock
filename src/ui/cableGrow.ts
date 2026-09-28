// A cable drawn out along its way, from the plug it starts at to the one it ends in: the tube is shown up to a point
// and a rounded tip closes it there, so it reads as a cable being laid, not a pipe being cut. Used by the assembly
// animation and when a new cable appears in the view.
import * as THREE from 'three';

/**
 * The tube's ring size, if this is one of ours (rings of `sides` points along the way, then its two end caps), and
 * whether it has been unrolled into plain triangles (smooth shading does that; the order stays the same).
 */
function tubeSides(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return 0;
  if (g.index) {
    const nIdx = g.index.count, sides = (pos.count - 2 - nIdx / 6) / 2;
    return Number.isInteger(sides) && sides >= 6 && sides <= 32 && nIdx % (6 * sides) === 0 ? sides : 0;
  }
  // plain triangles: each ring segment is 6 x sides corners, and the corner that starts segment 1 is the one that
  // ends the first pair of segment 0
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let s = 6; s <= 32; s++) if (pos.count % (6 * s) === 0 && pos.count > 12 * s && a.fromBufferAttribute(pos, 5).distanceTo(b.fromBufferAttribute(pos, 6 * s)) < 1e-4) return s;
  return 0;
}

const ease = (k: number) => k * k * (3 - 2 * k);
const TIP = new THREE.SphereGeometry(1, 16, 10); // shared by every tip, never disposed

/** Show the cable `mesh` drawn `g` of the way (0 none, 1 all), eased, with its tip rounded off. */
export function growTo(mesh: THREE.Mesh, g: number) {
  const geo = mesh.geometry as THREE.BufferGeometry, all = geo.index?.count ?? geo.getAttribute('position')?.count ?? 0;
  const k = g >= 1 ? 1 : g <= 0 ? 0 : ease(g);
  const sides = tubeSides(geo);
  if (k >= 1 || !sides) geo.setDrawRange(0, k >= 1 ? Infinity : Math.floor((all * k) / 60) * 60);
  let tip = mesh.userData.tip as THREE.Mesh | undefined;
  if (!sides || k <= 0 || k >= 1) { if (tip) tip.visible = false; if (sides) geo.setDrawRange(0, k >= 1 ? Infinity : 0); return; }
  // whole ring segments only, then the tip on the last ring shown
  const rings = (all - 6 * sides) / (6 * sides) + 1, seg = Math.max(1, Math.round(k * (rings - 1)));
  geo.setDrawRange(0, seg * 6 * sides);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute, c = new THREE.Vector3(), q = new THREE.Vector3();
  // the ring the shown part ends on (its corners: straight from the rings, or the far corners of the segment before)
  const corner = (j: number) => (geo.index ? seg * sides + j : (seg - 1) * 6 * sides + 6 * j + 5);
  for (let j = 0; j < sides; j++) c.add(q.fromBufferAttribute(pos, corner(j)));
  c.divideScalar(sides);
  const r = q.fromBufferAttribute(pos, corner(0)).distanceTo(c);
  if (!tip) {
    tip = new THREE.Mesh(TIP, mesh.material);
    tip.raycast = () => {};
    tip.userData.cached = true;
    mesh.add(tip);
    mesh.userData.tip = tip;
  }
  tip.material = mesh.material;
  tip.position.copy(c);
  tip.scale.setScalar(r);
  tip.visible = true;
}
