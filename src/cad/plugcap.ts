// A plug cap: a plate over the plugs, a pad pressing each one, and a leg at each end with a hook that clicks in under a
// ledge on the cradle's outer wall. The profile prints flat (on the bed, extruded along the plugs' axis), so the legs
// bend within the layers.
//
// The legs are tapered beams (`root` thick where they leave the plate, `tip` at the hook). The hook's tip stands `wall`
// off the cradle wall and reaches `e` mm under the ledge (an overhang of `ledge` = wall + e), so the catch is the
// hook's flat top and, at rest, nothing presses. Snapping on moves each leg out `e` + 0.05 mm, past the ledge's tip.
// The ledge is the widest of `ledges` that keeps the strain (the beam's, times `kt` for the fillet at the root and
// the hook: the 2D solver reads 1.4 times the beam's) under `target`: a longer leg takes a deeper catch.
import { taper } from '../fea/beamfea';
import { poly, rect2, unionCS, type CS } from './kernel';

export const CAP = { root: 1.5, tip: 0.9, wall: 0.1, gap: 0.15, ledges: [0.45, 0.4, 0.35, 0.3, 0.25], kt: 1.4, target: 0.0095, fillet: 1.2, top: 1.6 };

/** The catch and the strain for legs of length L (plate underside to the hook's top). */
export function capLeg(L: number) {
  let out = { ledge: 0, e: 0, move: 0, strain: 0 };
  for (const ledge of CAP.ledges) {
    const e = ledge - CAP.wall, move = e + 0.05;
    out = { ledge, e, move, strain: taper(CAP.root, CAP.tip, L, move).peak * CAP.kt };
    if (out.strain <= CAP.target) break;
  }
  return out;
}

/**
 * The cap's profile, (t across, z up): the cradle group's walls are at tL and tR, the plate's underside at zPlate, the
 * hooks' tops at zHook; `pads` are [x0, x1, z0] rectangles up to the plate (a pad pressing a plug lower than the
 * plate).
 */
export function capProfile(tL: number, tR: number, zHook: number, zPlate: number, leg: { ledge: number }, pads: [number, number, number][] = []): CS {
  const { root, tip, top } = CAP;
  const gp = leg.ledge + CAP.gap, hook = gp - CAP.wall;
  const xl = tL - gp, xr = tR + gp;
  let prof = poly([
    [xl - tip, zHook - 1.4], [xl + hook, zHook - 0.6], [xl + hook, zHook], [xl, zHook], [xl, zPlate], [xr, zPlate], [xr, zHook], [xr - hook, zHook], [xr - hook, zHook - 0.6], [xr + tip, zHook - 1.4],
    [xr + root, zPlate + top - 0.6], [xr + root - 0.6, zPlate + top], [xl - root + 0.6, zPlate + top], [xl - root, zPlate + top - 0.6],
  ], 'NonZero');
  // (fillets where each leg meets the plate: the strain would pile up in a square corner)
  const closed = prof.offset(CAP.fillet, 'Round').offset(-CAP.fillet, 'Round');
  prof = unionCS([prof, closed.intersect(rect2(xl - 0.1, zPlate - 2.5, xl + 2.5, zPlate)), closed.intersect(rect2(xr - 2.5, zPlate - 2.5, xr + 0.1, zPlate))]);
  for (const [x0, x1, z0] of pads) prof = prof.add(rect2(x0, z0, x1, zPlate + 0.01));
  return prof;
}
