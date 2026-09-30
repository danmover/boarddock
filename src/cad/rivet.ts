// The rivet for two holders back to back: a pin through both bases with a head on one side and a groove (the neck) beyond
// the other, and a clip that goes on the neck from the side. The old rivet had a split, barbed tip whose legs were 2 to 4 mm
// long and had to spring 0.2 mm: 15% strain. The pin is rigid now; the clip is a U with two tapered arms 11 mm long that
// bend within the layers (it prints flat), each ending in a lip whose flat face is the catch.
//
// Clip frame (x across, y along its length from the body's foot up to the arms' tips, thickness along z):
//   body y 0..BODY; arms from BODY to BODY + ARM; the neck sits at the foot of the cavity between them.
import { taper } from '../fea/beamfea';
import { cyl, box, ext, poly, rect2, unionCS, unionMF, type CS, type MF } from './kernel';

export const RIVET = {
  head: 3.2, // head radius, and its thickness
  headT: 1.3,
  shank: 1.6, // shank radius (holes are Ø3.5)
  neck: 1.1, // neck radius
  neckW: 1.4, // neck groove width along the pin
  clipT: 1.2, // the clip's thickness
  tail: 2.3, // how far the pin reaches beyond the far base
  cavity: 2.4, // width between the arms (the neck is 2.2)
  throat: 1.6, // between the lips at rest
  body: 3.0,
  arm: 11, // arm length, from the body to the lips
  tRoot: 1.4, // arm thickness at the body and at the lips
  tTip: 0.8,
  fillet: 0.8,
  kt: 1.3,
};

/** How far each lip moves for the neck to click through. */
export const rivetMove = () => (2 * RIVET.neck - RIVET.throat) / 2 + 0.05;

/** The arms' strain as the neck clicks through: the beam, with the concentration at the roots (2D FEA reads about this). */
export const rivetStrain = () => taper(RIVET.tRoot, RIVET.tTip, RIVET.arm, rivetMove()).peak * RIVET.kt;

/** The clip's plan. */
export function rivetClip(): CS {
  const R = RIVET, c = R.cavity / 2, g = R.throat / 2, y0 = R.body, y1 = R.body + R.arm;
  const side = (s: 1 | -1) => poly([[s * c, y0], [s * (c + R.tRoot), y0], [s * (c + R.tTip), y1], [s * c, y1]], 'NonZero');
  const lip = (s: 1 | -1) => poly([[s * c, y1 - 1.0], [s * g, y1 - 1.0], [s * g, y1 - 0.5], [s * c, y1]], 'NonZero');
  const body = rect2(-(c + R.tRoot), 0, c + R.tRoot, y0 + 0.01);
  const u = unionCS([body, side(1), side(-1), lip(1), lip(-1)]);
  // fillets at the arms' roots only (a closing everywhere would fill the throat)
  const closed = u.offset(R.fillet, 'Round').offset(-R.fillet, 'Round');
  return unionCS([u, closed.intersect(rect2(-(c + R.tRoot + 1), y0 - 1, c + R.tRoot + 1, y0 + 2))]);
}

/** The pin, in its print pose (axis along x, lying on its flat underside), for two bases `grip` thick between them. */
export function rivetPin(grip: number): MF {
  const R = RIVET, along = (r0: number, r1: number, x0: number, x1: number) => cyl(0, 0, x0, x1, r0, r1, 32).rotate([0, 90, 0]);
  const n0 = grip + 0.1, n1 = n0 + R.neckW, end = n1 + R.tail - R.neckW - 0.1;
  let m = unionMF([along(R.head, R.head, -R.headT, 0), along(R.shank, R.shank, -0.01, n0), along(R.neck, R.neck, n0 - 0.01, n1 + 0.01), along(R.shank, R.shank, n1, end - 0.5), along(R.shank, R.shank - 0.6, end - 0.51, end)]);
  m = m.subtract(box(-5, -5, -5, end + 5, 5, -R.headT)); // flat underside so it prints lying down
  return m.translate([0, 0, R.headT]);
}

/** The clip extruded, as it prints (flat on the bed). */
export function rivetClipMesh(): MF { return ext(rivetClip(), 0, RIVET.clipT); }

