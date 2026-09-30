// The joint between two holders of a column of small boards (J-Links, adapters): a holder's two pegs and the two
// holes in the landing of the one below. The column's holders are printed lying flat, so a peg (which stands out of
// the pedestal's face) lies on its side, and so does a hole in the landing: both are made to print that way without
// support (socket-local frame: x across, y up the holder's thickness, z along the column).
//  - the peg has a 45 degree flare at its root, so its underside is held from the wall out (only what is left of its
//    length reaches out on its own), and a lead-in tip;
//  - the hole has a matching 45 degree countersink at its mouth (the flare seats in it, which also carries the
//    sideways push), a gabled roof (a round hole on its side needs a bridge over its crown), a flat bottom, and a flat
//    on its floor and two crush ribs at its sides that centre the peg (none at the crown; a rib at the very bottom
//    would leave two slivers of hole too narrow to print open).
import { box, circle2, ext, K, poly, rect2, unionCS, unionMF, type MF } from './kernel';
import { HD, PEG } from './dockdims';

/** A column holder's peg, standing down from its pedestal (z = 0 its underside). */
export function peg(x: number): MF {
  const { y, r, len, tip, flare } = PEG;
  const cyl = K().Manifold.cylinder;
  const root = cyl(flare + 0.01, r, r + flare + 0.01, 48).translate([x, y, -flare]).intersect(box(-HD.base.hx, 0, -flare - 1, HD.base.hx, 2 * y, 1)); // (never past the pedestal's edge)
  return unionMF([ext(circle2(x, y, r, 48), -len, 0.01), root, cyl(tip, r - tip, r, 48).translate([x, y, -len - tip])]);
}

/** The press-fit hole for a peg in a landing whose top is at `top`: countersunk, gabled, flat-bottomed, with a flat and two crush ribs. */
export function pegHole(x: number, top: number): MF {
  const { y, flare, depth } = PEG, R = 2.12, cs = flare + 0.1;
  // a circle with a 45 degree roof over it: what a hole on its side can be without a bridge
  const k = R * Math.SQRT1_2, roof = poly([[x - k, y + k], [x, y + R * Math.SQRT2], [x + k, y + k], [x, y]], 'NonZero');
  // (its floor is a flat 1.85 mm under the centre, where the peg, 2.0 mm out, presses; the roof's point is cut off
  // 0.8 mm wide: a point narrower than 0.3 mm prints shut)
  const profile = unionCS([circle2(x, y, R, 48), roof]).intersect(rect2(x - 6, y - 1.85, x + 6, y + R * Math.SQRT2 - 0.4));
  let hole = unionMF([ext(profile, top - depth, top + 1), K().Manifold.cylinder(cs, R, R + cs, 48).translate([x, y, top - cs]), ext(circle2(x, y, R + cs, 48), top, top + 1)]);
  // crush ribs from the bottom of the hole to the countersink: 60 degrees either side of the crown
  for (const a of [60, 300]) hole = hole.subtract(box(-0.35, 1.85, top - depth + 0.1, 0.35, 2.3, top - cs).rotate([0, 0, a]).translate([x, y, 0]));
  return hole;
}
