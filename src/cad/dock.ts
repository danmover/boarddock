// Rail dock: the screwless "DIN hub" (din_hub_v2) ported to manifold.
//  - rail shoe: clips on the rail, and a grip in the rail's channel holds it where it is; press the lever pad beside
//    the socket down to release it, built-in stop
//  - socket: snaps into the shoe in any of four 90 degree turns, two print-in-place tongue latches
//  - holder side: tongue, pedestal, spine with a release-rod tunnel, grip bar
//  - release rod: its head is the button on the holder's far (top) edge; pressing it wedges the latch open
// Frames (mm), as in din_hub_v2:
//  hub world: X along the rail, Y across it, Z away from the panel (panel at Z = 0)
//  socket-local: same axes, Z = 0 at the socket top; tongues plug in along -Z; holder A faces +Y
import type { V2 } from '../model/types';
import { box, circle2, ext, extCh, K, poly, rect2, roundCS, unionCS, unionMF, type CS, type MF } from './kernel';
import { CRUSH, EAR, gripSpan, HD, headSpan, HOOK_SLIT, LANDING, LATCH, latchGeom, LEN_X, PEG, SHOE_GRIP, TONGUE, type LatchDims } from './dockdims';
import { railGrip } from './dinclip';
import { peg, pegHole } from './column';
export { gripSpan, headSpan };

const P = (pts: number[][]): CS => poly(pts as V2[], 'NonZero');

/** (y, z) profile extruded symmetrically along X. */
export function extYZ(c: CS, hx: number): MF {
  return c.extrude(2 * hx).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -hx, 0, 0, 1] as any);
}

/** (x, z) profile extruded over y0..y1. */
export function extXZ(c: CS, y0: number, y1: number): MF {
  return c.extrude(y1 - y0).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, y1, 0, 1] as any);
}

const hull = (list: MF[]) => K().Manifold.hull(list);

// ---------------- reference ----------------
export { LEN_X, SHOE_TOP, SOCKET_BOTTOM, SOCKET_Z, SOCKET_HALF, SHOE_GRIP } from './dockdims';

/** TS35 x 7.5 hat rail along X, centred on x = 0. */
export function rail(len: number): MF {
  return unionMF([box(-len / 2, -13.5, 0, len / 2, 13.5, 1), ...[-1, 1].flatMap((s) => [
    box(-len / 2, s * 13 - 0.5, 0, len / 2, s * 13 + 0.5, 7.5),
    box(-len / 2, s * 15.5 - 2, 6.5, len / 2, s * 15.5 + 2, 7.5),
  ])]);
}

// ---------------- socket ----------------
const S = {
  hx: 9.0, coreY: 6.2, halfY: 10.4, bottom: -20.5, floor: -14.5, anchorTop: -19.0, bossHalf: 9.0, bossBottom: -25.3, bossCh: 1.0,
  cavHalf: TONGUE.hx + 0.2, cavFullY: TONGUE.y1 - 1.8, cavFrontY: TONGUE.y1 + 0.2, dividerHalf: 0.35, dividerTop: -1.0, windowX: [-5.2, 5.2], mouthCh: 0.6, // window: 0.45 / 0.4 mm round the nose, so it prints free of the wall
};
// shoe hook notch on all four boss faces; 10 degree retaining face so a pull draws the hooks in
const BOSS_NOTCH = [[8.2, -23.11], [9.3, -23.3], [9.3, -21.2], [8.2, -22.3]];

/**
 * (y, z) outline of the +Y latch (the beam and its arm, without the nose): a long beam tapering from `t0` thick at its root
 * to `t1` under the arm, with rounded roots, a stiffer arm above it, and at the arm's top the 45 degree ramp the release
 * rod pushes. It is one layer in the socket's print pose (standing on its -X end), so it flexes within the layers.
 */
export function latchProfile(p: LatchDims = LATCH): CS {
  const zr = p.zr, yi = p.yIn, { w, top } = p.ramp;
  const arm = P([[yi, zr + 0.5], [yi + p.t0, zr + 0.5], [yi + p.tm, p.zm], [yi + p.t1, p.zt], [yi + p.arm, p.zt + (p.arm - p.t1)], [yi + p.arm, top - (w - p.arm)], [yi + w, top], [yi, top - w]].filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-9));
  let g = unionCS([arm, rect2(yi, zr, yi + p.t0, zr + 0.6), rect2(5.4, zr - 0.6, 9.2, zr)]);
  g = g.offset(p.rOut, 'Round').offset(-p.rOut, 'Round');
  g = g.add(g.offset(p.rIn, 'Round').offset(-p.rIn, 'Round'));
  g = g.intersect(rect2(5.9, zr, 9.05, 0));
  const parts = g.decompose();
  return parts.reduce((a, c) => (c.area() > a.area() ? c : a));
}

/** The nose (y, z): its holding face (undercut), tip face and lead-in ramp, with a fillet where it meets the arm; see `latchGeom` in dockdims.ts. */
export const noseProfile = (p: LatchDims = LATCH) => {
  const g = latchGeom(p), nose = P([g.tip, g.root, g.topRoot, g.top, g.tip2]), arm = latchProfile(p), r = p.noseFillet;
  if (r <= 0) return nose;
  // (the closing rounds every inside corner where the nose meets the arm; only what it adds beside the arm's face is kept)
  const both = arm.add(nose).offset(r, 'Round').offset(-r, 'Round');
  return nose.add(both.subtract(arm).intersect(rect2(p.yIn - 0.2, g.root[1] - r - 0.5, p.yIn + 0.2 + 2 * r, g.topRoot[1] + r + 0.5)));
};

function cavity(off = 0): CS {
  const hf = S.cavHalf + off, ff = S.cavFrontY + off, fy2 = S.cavFullY + off * 0.414;
  const k = hf - (ff - fy2);
  return P([[-hf, -fy2], [-k, -ff], [k, -ff], [hf, -fy2], [hf, fy2], [k, ff], [-k, ff], [-hf, fy2]]);
}

/** The nose as a solid (x -noseHx..noseHx): its -X end gets a 45 degree face because the socket prints standing on -X, so each layer reaches only a step further out from the arm than the one under it. */
export function noseSolid(p: LatchDims = LATCH): MF {
  const g = latchGeom(p), c = g.root[0] - p.noseHx, y0 = g.yT - 0.5, y1 = g.root[0] + 0.5;
  return extYZ(noseProfile(p), p.noseHx).subtract(ext(P([[-30, y1], [c - y1, y1], [c - y0, y0], [-30, y0]]), p.zn - 2, p.zn + 8));
}

function latchSide(p: LatchDims = LATCH): MF {
  return unionMF([extYZ(latchProfile(p), p.hx), noseSolid(p)]);
}

function boss(): MF {
  const h = S.bossHalf, zb = S.bottom, z1 = S.bossBottom, c = S.bossCh;
  let b = unionMF([box(-h, -h, z1 + c, h, h, zb), hull([box(-h, -h, z1 + c - 0.01, h, h, z1 + c), box(-(h - c), -(h - c), z1, h - c, h - c, z1 + 0.01)])]);
  const notch = extYZ(P(BOSS_NOTCH), h + 1);
  for (const a of [0, 90, 180, 270]) b = b.subtract(notch.rotate([0, 0, a]));
  return b;
}

/** Socket in socket-local coordinates (Z = 0 at the top face). */
export function socket(): MF {
  const hx = S.hx;
  let body = unionMF([box(-hx, -S.coreY, S.bottom, hx, S.coreY, 0), box(-hx, -S.halfY, S.bottom, hx, S.halfY, S.anchorTop), boss()]);
  const cuts: MF[] = [ext(cavity(), S.floor, 1.0), hull([ext(cavity(S.mouthCh), 0.0, 0.02), ext(cavity(0), -S.mouthCh, -S.mouthCh + 0.01)])];
  for (const sg of [1, -1]) {
    const lg = latchGeom(), [w0, w1] = [lg.tip[1] - 0.45, lg.topRoot[1] + 0.4], [x0, x1] = S.windowX; // (0.4 mm round the nose, so it prints free of the wall)
    const yy = (a: number, b: number) => (sg > 0 ? [a, b] : [-b, -a]);
    const [wy0, wy1] = yy(5.4 - 0.9, 5.4 + 0.9);
    cuts.push(box(x0, wy0, w0, x1, wy1, w1)); // nose window
    const zr = LATCH.zr;
    const [sy0, sy1] = yy(7.3 - 1.7, 7.3 + 1.7);
    cuts.push(box(-hx - 0.5, sy0, zr + 0.3, hx + 0.5, sy1, S.anchorTop + 0.01)); // latch slot in the anchor plate
    const [ry0, ry1] = yy(6.1 - 0.5, 6.1 + 0.5);
    cuts.push(box(-hx - 0.5, ry0, zr, hx + 0.5, ry1, -17.0)); // root relief
  }
  body = body.subtract(unionMF(cuts));
  // centre divider: each tongue's back face locates on it, so a single board can't drift
  body = unionMF([body, box(-S.cavHalf, -S.dividerHalf, S.floor - 0.01, S.cavHalf, S.dividerHalf, S.dividerTop)]);
  const lat = latchSide();
  return unionMF([body, lat, lat.mirror([0, 1, 0])]);
}

// ---------------- shoe (v3 "C-jaw") ----------------
// The jaw wraps round the rail flange's edge and hangs from a 0.9 mm hinge leaf that stands directly ABOVE the lip.
// A pull straight up off the rail therefore runs straight down the leaf (tension) instead of prying the jaw open, so
// the hold does not depend on friction. Pulling the jaw's post toward the socket (the press-down lever's hook does it)
// swings the jaw out about the leaf and the lip slides sideways off the flange; the post meets the body shelf just
// past the needed travel (built-in stop).
const SHOE_BODY = [[-20.3, 3.9], [-15.9, 3.9], [-15.4, 4.4], [-15.4, 5.7], [-15.9, 6.2], [-17.5, 6.2], [-17.783, 6.317], [-17.9, 6.6],
  [-17.9, 7.5], [15.1, 7.5], [15.1, 19.6], [15.8, 20.3], [17.9, 20.3], [17.9, 22.5], [17.4, 23.0], [-19.6, 23.0], [-20.3, 22.3]];
// hinge leaf 16.3..17.2 (0.9 mm = two 0.45 mm lines), z 10.4..19.8, flared roots
const HINGE = [[15.8, 9.9], [17.7, 9.9], [17.2, 10.4], [17.2, 19.8], [17.7, 20.3], [15.8, 20.3], [16.3, 19.8], [16.3, 10.4]];
// jaw: lip under the flange (engages 1.7 mm, 48 deg lead-in), pocket round the flange edge, post up to z 34.2
const SHOE_JAW = [[17.7, 3.9], [20.6, 3.9], [21.9, 5.2], [21.9, 33.4], [21.5, 34.2], [20.3, 34.2], [19.9, 33.8],
  [19.9, 9.9], [15.9, 9.9], [15.9, 8.0], [18.0, 8.0], [18.0, 6.2], [16.0, 6.2], [15.8, 6.0]];
// v5 "press-down lever": a lever on a pin at the top of a slim tower beside the socket. Press its ridged pad down
// (toward the rail) and the hook on its underside pulls the jaw's post toward the socket: the jaw swings open about
// its leaf, and the stop still limits it. The lever is printed in place round its pin (0.35 mm gap); its C-shaped hub
// wraps 280 degrees so it can't come off sideways, a bead round the middle of the pin in a groove in the hub keeps it
// from sliding off the pin's ends, and the jaw spring lifts it back.
// (Measured in the DIN clip review: the hub's open edge was 0.09 mm from the neck, which prints as one piece, and
// nothing held the lever on along the pin. The neck was 1.0 mm with a notch at its root, where about 13 N on the pad,
// once the jaw is at its stop, reached the strain limit; now it tapers from 1.8 mm, filleted into a wider tower: 28 N.)
// The hub's open edge on the neck's side is the lift stop: it meets the neck's left face after about 6 degrees (the pad
// 1.5 mm up), where it used to have 13.5 degrees (3 mm) before it did. Its gap to the neck can't be less than the
// print gap, so the edge slants: 0.35 mm off the neck at the pin, and closer out at the ring's rim.
// `open`: the hub's opening, degrees, its edge on the neck's side at the pin's clearance (r 2.05) and the other edge;
// `stop`: where that first edge is at the ring's rim (r 3.55); `bead`: how far the bead stands off the pin.
export const SHOE_LEVER = { pivot: [13.4, 39.2] as V2, pad: [24.6, 28.8] as V2, top: 41.0, hook: 22.3, stopGap: 2.0, open: [-116, -39] as V2, stop: -110.5, bead: 0.6 };
const TOWER = [[11.2, 22.9], [13.9, 22.9], [13.9, 34.5], [11.8, 34.5], [11.2, 33.9]];
const NECK = [[12.1, 34.2], [13.9, 34.2], [13.9, 38.2], [12.9, 38.2], [12.9, 37.3]];

/** The rail release lever (y, z), a separate island printed in place round the tower's pin. */
export function leverProfile(): CS {
  const [py, pz] = SHOE_LEVER.pivot, [a0, a1] = SHOE_LEVER.open, at = (r: number, deg: number): V2 => [py + r * Math.cos((deg * Math.PI) / 180), pz + r * Math.sin((deg * Math.PI) / 180)];
  const ring = circle2(py, pz, 3.55, 64).subtract(circle2(py, pz, 2.05, 48));
  // the opening: its neck-side edge is the line from the pin's clearance to the ring's rim, run on past both
  const A = at(2.05, a0), B = at(3.55, SHOE_LEVER.stop), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const e0: V2 = [A[0] - ((B[0] - A[0]) / L) * 1.5, A[1] - ((B[1] - A[1]) / L) * 1.5], e1: V2 = [B[0] + ((B[0] - A[0]) / L) * 3, B[1] + ((B[1] - A[1]) / L) * 3];
  const ae = (Math.atan2(e1[1] - pz, e1[0] - py) * 180) / Math.PI;
  const sec: V2[] = [e0, e1];
  for (let i = 1; i <= 20; i++) sec.push(at(7, ae + ((a1 - ae) * i) / 20));
  sec.push(at(1.5, a1));
  const hub = ring.subtract(poly(sec, 'NonZero'));
  const arm = roundCS(rect2(15.6, 37.8, 28.8, 40.4), 0.9);
  const hook = roundCS(rect2(22.3, 30.6, 24.3, 38.8), 0.7);
  const ridges = unionCS([25.3, 26.7, 28.1].map((y) => roundCS(rect2(y - 0.45, 40.0, y + 0.45, SHOE_LEVER.top), 0.3)));
  // keep the pin clearance clean wherever the arm meets the hub
  return unionCS([hub, arm, hook, ridges]).subtract(circle2(py, pz, 2.05, 48));
}

const HOOK_TIP = [[9.15, 20.33], [8.35, 20.47], [8.35, 20.8], [8.65, 21.1], [9.15, 21.1]];
const mir = (pts: number[][]) => pts.map(([y, z]) => [-y, z]).reverse();

function slot(y0: number, y1: number, z0: number, z1: number): CS {
  const r = (y1 - y0) / 2;
  return rect2(y0, z0 + r, y1, z1).add(circle2((y0 + y1) / 2, z0 + r, r, 24));
}

/** (y, z) profile of the shoe: body, hinge leaf, jaw and lever. Also used by the 2D FEA. */
export function shoeProfile(): CS {
  const jaw = P(SHOE_JAW);
  // 0.4 mm fillets in the jaw's inside corners (pocket), 0.5 mm at both hinge roots
  const jawR = jaw.add(jaw.offset(0.4, 'Round').offset(-0.4, 'Round').intersect(rect2(15.5, 5.5, 19.9, 10.5)));
  let c = unionCS([P(SHOE_BODY), jawR, P(HINGE)]);
  const closed = c.offset(0.5, 'Round').offset(-0.5, 'Round');
  c = c.add(closed.intersect(unionCS([rect2(15.9, 9.8, 17.8, 11.0), rect2(15.9, 19.2, 17.8, 20.4)])));
  // lever tower and pin, filleted into the body top, and the neck filleted into the tower (it takes the lever's
  // push once the jaw is at its stop)
  const [py, pz] = SHOE_LEVER.pivot;
  const tower = unionCS([P(TOWER), P(NECK), circle2(py, pz, 1.7, 40)]);
  const towerF = tower.add(unionCS([tower, rect2(10.2, 21.9, 14.3, 23.0)]).offset(0.8, 'Round').offset(-0.8, 'Round').intersect(rect2(10.2, 22.0, 14.3, 25.0)))
    .add(tower.offset(0.8, 'Round').offset(-0.8, 'Round').intersect(rect2(11.3, 34.4, 12.9, 35.9)));
  c = c.add(towerF);
  // soften the outer corners of the body (0.6 mm) so the part looks moulded, not boxy
  const outer = rect2(-21, 21.2, 18.5, 23.5).add(rect2(-21, 3.5, -19.5, 23.5));
  const rounded = c.offset(-0.6, 'Round').offset(0.6, 'Round');
  c = c.subtract(outer).add(rounded.intersect(outer));
  // the rail grip on the fixed hook's side: it presses the rail's -y wall from inside the channel, so the shoe sits
  // against the fixed hook (0.4 mm from it as drawn) with a preload, instead of only locating on the rail
  const grip = railGrip(SHOE_GRIP.gap, 7.5, (s, h) => [SHOE_GRIP.wall + s, h]);
  // (a fillet where each hook's tab meets its beam, under the face the socket bears on)
  const R = HOOK_SLIT.tab, fil = R > 0 ? [rect2(9.15 - R, 20.33 - R, 9.15, 20.36).subtract(circle2(9.15 - R, 20.33 - R, R, 48))] : [];
  return c.subtract(unionCS(shoeCuts())).add(unionCS([P(HOOK_TIP), P(mir(HOOK_TIP)), ...fil, ...fil.map((f) => f.mirror([1, 0])), grip]));
}

/**
 * A hook slit (y, z) between y0 and y1, up from z0 to z1, with its bottom filleted where the hook beam joins the floor.
 * The beam is on the y1 side (or on the y0 side with `beamLow`); its side of the bottom is a fillet of radius R, which
 * is a quarter round across the slit, and past it toward the other wall when R is more than the slit's width (a
 * step under that wall, out of the way). R up to half the width is the plain round bottom. Everything else in the
 * bottom is rounded 0.25.
 */
function hookSlit(y0: number, y1: number, z0: number, z1: number, R: number, beamLow = false): CS {
  if (R <= (y1 - y0) / 2 + 1e-9) return slot(y0, y1, z0, z1);
  const yf = Math.min(y0, y1 - R);
  // (run on past z1 while it is rounded, so its top corners don't leave a sliver where it opens into the channel)
  const c = rect2(y0, z0 + R, y1, z1 + 1).add(rect2(yf, z0, y1 - R, z0 + R)).add(rect2(y1 - R, z0, y1, z0 + R).intersect(circle2(y1 - R, z0 + R, R, 64)));
  const r = roundCS(c, 0.25).intersect(rect2(yf - 1, z0 - 1, y1 + 1, z1 + 0.05)), yc = (y0 + y1) / 2;
  return beamLow ? r.translate([-yc, 0]).mirror([1, 0]).translate([yc, 0]) : r;
}

function shoeCuts(): CS[] {
  const inner = hookSlit(8.55, 9.15, 10.0, 18.05, HOOK_SLIT.inner), outer = hookSlit(10.0, 10.6, 10.0, 23.1, HOOK_SLIT.outer, true);
  const flip = (c: CS) => c.mirror([1, 0]);
  return [
    P([[-9.15, 18], [9.15, 18], [9.15, 23.1], [-9.15, 23.1]]), // socket channel
    inner, flip(inner), outer, flip(outer), // slits that free the snap-hook beams
    P([[8.5, 22.6], [10.65, 22.6], [10.65, 23.1], [8.5, 23.1]]), P(mir([[8.5, 22.6], [10.65, 22.6], [10.65, 23.1], [8.5, 23.1]])),
    P([[-7.3, 9.5], [7.3, 9.5], [7.3, 15.5], [6.3, 16.5], [-6.3, 16.5], [-7.3, 15.5]]), // lightening windows
    P([[11.6, 9.5], [14.1, 9.5], [14.1, 18.6], [13.4, 19.3], [12.3, 19.3], [11.6, 18.6]]),
    P([[-16.0, 9.5], [-11.6, 9.5], [-11.6, 19.0], [-12.6, 20.0], [-15.0, 20.0], [-16.0, 19.0]]),
  ];
}

/** The shoe's profile for the 2D FEA: without its rail grip (the jaw, hinge and lever cases), and the grip with the
 * strip of floor it hangs from (its own case). */
export function shoeFeaProfiles(): { jaw: CS; grip: CS } {
  const c = shoeProfile(), zone = rect2(-14, 0, -4.2, 7.5);
  return { jaw: c.subtract(zone), grip: c.intersect(rect2(-14, 0, 0, 9.5)) };
}

/** Rail shoe in hub world coordinates (centred on x = 0). */
export function shoe(): MF {
  return unionMF([shoeBody(), shoeLever()]);
}

/** The shoe without its lever (the lever prints in place with it; they are shown in two colours). */
export function shoeBody(): MF {
  const hx = LEN_X / 2;
  // the hinge leaf is split into two 7 mm segments to lower the release force
  const body = extYZ(shoeProfile(), hx).subtract(box(-3.5, 16.0, 10.7, 3.5, 17.5, 19.5));
  const stop = extXZ(P([[8.1, 18.0], [hx, 18.0], [hx, 20.2], [10.3, 20.2]]), -8.1, 8.1); // x stops seat the boss chamfer
  return unionMF([body, stop, stop.mirror([1, 0, 0]), pinBead(0)]);
}

/**
 * The bead round the middle of the lever's pin (grow = 0), or the groove it runs in inside the lever's hub (grow =
 * the 0.35 mm print gap): 45 degree flanks, so both print without support standing on the shoe's end face, and the
 * lever can only slide about 0.5 mm along the pin before a flank meets the other.
 */
export function pinBead(grow: number): MF {
  const [py, pz] = SHOE_LEVER.pivot, b = SHOE_LEVER.bead, w = 0.3, r0 = 1.5, rb = 1.7 + b;
  let prof = P([[0, -(w + b + 0.2)], [r0, -(w + b + 0.2)], [rb, -w], [rb, w], [r0, w + b + 0.2], [0, w + b + 0.2]]);
  if (grow > 0) prof = prof.offset(grow, 'Round').intersect(rect2(0, -5, 5, 5));
  // revolved about its y axis (which becomes z), then turned so that axis runs along the pin (x)
  return K().Manifold.revolve(prof, 64).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, py, pz, 1] as any);
}

export const shoeLever = () => extYZ(leverProfile(), LEN_X / 2).subtract(pinBead(0.35));

/** Print pose for shoe and socket: standing on the -X end face. Returns [pose, inverse]. */
export const END_POSE = { pose: [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1], inv: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] };

// ---------------- holder side (socket-local coordinates, holder A) ----------------
export { HD, SPINE_TOP, DOCK_MIN_ZB, LANDING, PEG } from './dockdims';

/**
 * The latch groove across the tongue's front face (y, z): its floor is the nose's holding face, `play` under it and
 * undercut the same `hook` degrees (so it is highest at the front, and the nose sits in a pocket), a back wall 0.15 mm
 * past the nose's tip, and a ceiling 0.45 mm over the nose's top.
 */
export function latchGroove(p: LatchDims = LATCH): CS {
  const g = latchGeom(p), yb = g.yT - 0.15, yf = TONGUE.y1 + 1.5, fl = (y: number) => p.zn - p.play + (y - g.yT) * g.tanHook, zc = g.topRoot[1] + 0.45;
  return P([[yb, fl(yb)], [yf, fl(yf)], [yf, zc], [yb, zc]]);
}

/** Tongue that plugs into the socket (after matching_tongue.stl, grown to 14 x 4.5 mm), with a lead-in at the tip. */
export function tongue(into = 0.2, fit = 0): MF {
  // `fit` shrinks the sides and front face (the back face stays on the socket's divider)
  const f = Math.max(0, Math.min(0.4, fit)), { hx, y0, y1 } = TONGUE;
  let t = ext(P([[-hx + f, y0], [hx - f, y0], [hx - f, y1 - 2 - f * 0.4], [hx - 2 - f * 0.6, y1 - f], [-hx + 2 + f * 0.6, y1 - f], [-hx + f, y1 - 2 - f * 0.4]]), -14, into);
  t = t.subtract(extYZ(latchGroove(), 10)); // latch groove
  t = t.subtract(extYZ(P([[y1 - 0.6, -14.1], [y1 + 0.1, -14.1], [y1 + 0.1, -13.3]]), 10));
  return unionMF([t, crushRibs(f)]);
}

/**
 * The tongue's crush ribs (socket-local, holder A): on each of its two 45 degree front corner faces, `CRUSH.z.length`
 * ribs, low and broad (`base` wide where they grow out of the face, so they print as part of the tongue, a `crown`
 * wide crest `proud` above the face). The socket's chamfered corners are 0.28 mm off the tongue's along the face's
 * normal (0.39 with the tongue pushed back on its divider), so the ribs are pressed 0.06 to 0.17 mm: the first push in
 * crushes their crests to the socket's real size, and after that the tongue is snug on its divider and centred. Their ends run out to the face in 45 degree ramps, so they go in without catching.
 */
export function crushRibs(f = 0): MF {
  const { proud, base, crown, a0, z, ramp } = CRUSH, { hx, y1 } = TONGUE;
  const P1: V2 = [hx - f, y1 - 2 - f * 0.4], P2: V2 = [hx - 2 - f * 0.6, y1 - f], L = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]);
  const tv = [(P2[0] - P1[0]) / L, (P2[1] - P1[1]) / L], nv = [tv[1], -tv[0]];
  const at = (a: number, h: number): V2 => [P1[0] + tv[0] * a + nv[0] * h, P1[1] + tv[1] * a + nv[1] * h];
  const crest = P([at(a0, -0.1), at(a0 + (base - crown) / 2, proud), at(a0 + (base + crown) / 2, proud), at(a0 + base, -0.1)]), foot = P([at(a0, -0.1), at(a0 + 0.1, 0.05), at(a0 + base - 0.1, 0.05), at(a0 + base, -0.1)]);
  const one = (z0: number, z1: number) => hull([ext(crest, z0 + ramp, z1 - ramp), ext(foot, z0, z0 + 0.02), ext(foot, z1 - 0.02, z1)]);
  const b = unionMF(z.map(([z0, z1]) => one(z0, z1)));
  return unionMF([b, b.mirror([1, 0, 0])]);
}

/**
 * Holder-side dock features for a holder whose far (top) wall's outer face is `far` mm from the dock face.
 * `pedestal` = how deep the pedestal reaches into the holder (to meet the tray wall). `side` = 0 when the spine runs
 * under the board (grip bar centred on it), +1 / -1 when it runs beside the board on the +x / -x side (grip bar
 * reaches away from the board, so it stays clear of plugs on the top edge).
 */
export function holderDock(far: number, pedestal: number, side = 0, fit = 0, col?: { foot: boolean; landing: boolean }) {
  const { spineHx, spineY1, grip } = HD;
  // in a column of holders, one below the top carries the next on a landing on its far wall instead of a grip bar
  const zg0 = col?.landing ? far + LANDING.gap : far + grip.gap, zg1 = zg0 + (col?.landing ? LANDING.t : grip.t);
  const [g0, g1] = gripSpan(side);
  const add = unionMF([
    // the bottom of a column (or a holder on its own) plugs into the socket; one higher up stands on pegs
    col?.foot ? unionMF(PEG.x.map((x) => peg(x))) : tongue(Math.min(1.0, pedestal), fit),
    extXZ(rect2(-HD.base.hx, 0, HD.base.hx, Math.max(HD.base.t, pedestal)), HD.backY, HD.base.y1), // pedestal on the socket top (or on the landing below)
    box(-spineHx, HD.backY, 0, spineHx, spineY1, zg1), // spine, dock face to grip bar
    col?.landing
      ? extXZ(roundCS(rect2(-LANDING.hx, zg0 - 0.01, LANDING.hx, zg1), 1.2).intersect(rect2(-LANDING.hx - 1, zg0 - 0.01, LANDING.hx + 1, zg1 + 1)), HD.backY, spineY1)
      // grip bar: rounded, with a shallow finger scoop in the face the fingers pull on (matches the button's dish)
      : extXZ(roundCS(rect2(g0, zg0, g1, zg1), 1.2).subtract(circle2((g0 + g1) / 2, zg0 - ((g1 - g0) ** 2 / 4 + 0.64) / 1.6 + 0.8, ((g1 - g0) ** 2 / 4 + 0.64) / 1.6, 256)), HD.backY, spineY1),
  ]);
  // the rod's tunnel: with its catch at the top of the column; straight through a holder the rod only passes
  const tunnel = col?.landing ? rodBore(zg1) : rodTunnel(zg1);
  const cut = unionMF([
    tunnel,
    box(-HD.voidHx, HD.backY - 0.1, Math.max(HD.base.t, pedestal) + 1.5, HD.voidHx, HD.voidY1, zg0 - 1.5), // back channel (saves filament)
    ...(col?.landing ? PEG.x.map((x) => pegHole(x, zg1)) : []),
  ]);
  return { add, cut, tunnel, zg0, zg1 };
}

/**
 * A holder lying flat (socket-local, holder A). The ear, fused to the holder: from over the socket back `reach` mm into
 * the holder's wall, its underside on the key's pedestal, a dovetail groove under it open at its tip, the release-rod
 * tunnel through it, and two gussets up the wall. The key, a part of its own: the standing holder's pedestal and
 * tongue, a dovetail on the pedestal that slides into the ear's groove, the rod tunnel through it. `top`: the ear's top.
 */
export function flatHolderDock(reach: number, fit = 0) {
  const top = EAR.ped + EAR.t, y1 = Math.max(EAR.len + 0.8, reach), { root, top: dt, h: dh, gap } = EAR.dove;
  // the ear: rounded outer corners, its top edges chamfered, gussets from it up the wall either side of the button
  const plate = extCh(roundCS(rect2(-EAR.hx, HD.backY, EAR.hx, y1 + 3), 2.5).intersect(rect2(-EAR.hx - 1, HD.backY, EAR.hx + 1, y1)), EAR.ped, top, 0.6, 0);
  const ear = unionMF([plate, ...[-1, 1].map((sg) => extYZ(P([[y1 - 6, top - 0.01], [y1 + 0.01, top - 0.01], [y1 + 0.01, top + 5]]), 1.0).translate([sg * (EAR.hx - 1.4), 0, 0]))]);
  // the dovetail (x, z), along y from the ear's tip to the end of the pedestal: narrow at the root, wider at the top
  const dove = (g: number) => P([[-root - g, EAR.ped - 0.02], [root + g, EAR.ped - 0.02], [dt + g, EAR.ped + dh + g], [-dt - g, EAR.ped + dh + g]]);
  const tunnel = rodTunnel(top);
  const cut = unionMF([extXZ(dove(gap), HD.backY - 1, HD.base.y1 + gap), tunnel]); // (open at the tip, where the key slides in)
  const key = unionMF([
    tongue(Math.min(1.0, EAR.ped), fit),
    extXZ(rect2(-HD.base.hx, 0, HD.base.hx, EAR.ped), HD.backY, HD.base.y1), // pedestal on the socket top
    extXZ(dove(0), HD.backY, HD.base.y1),
  ]).subtract(tunnel);
  return { add: ear, cut, tunnel, key, top };
}

/**
 * Where the rod's barbs sit for a tunnel whose top is at `top` (socket-local z): the catch face (flat, 0.2 mm under the
 * gate at rest) and the barb's foot (under its lead-in ramp).
 */
function rodCatch(top: number) {
  const { gate, ramp, flat } = HD.catch, zcat = top - gate - 0.2;
  return { zcat, zb: zcat - ramp - flat };
}

/** A frustum (hull of two thin boxes, the second bigger) for a chamfer: (x half-widths, y, z) of the small end, then the big end. */
function frustum(hx0: number, y0: number, y1: number, z0: number, hx1: number, y2: number, y3: number, z1: number): MF {
  return hull([box(-hx0, y0, z0, hx0, y1, z0 + 0.01), box(-hx1, y2, z1 - 0.01, hx1, y3, z1)]);
}

/**
 * The lead-in chamfers of a tunnel from `z0` (the socket end) to `top`: a funnel at the top (the button's neck fillets
 * and the rod's tip come in there) and a chamfer at the bottom, where the rod leaves. The funnel opens at 45 degrees on
 * the x sides and the -y side (the floor); on the +y side (the roof, over a thin wall) it is a 45 degree chamfer only
 * `yPos` deep, since a flatter roof would not print.
 */
function tunnelEnds(top: number, z0: number, hxTop: number): MF {
  const { mouth } = HD, [y0, y1] = HD.tunnelY, zs = top - mouth.depth;
  const ex = (z: number) => (mouth.x * (z - zs)) / mouth.depth, en = (z: number) => (mouth.yNeg * (z - zs)) / mouth.depth;
  const at = (z: number, yp: number) => box(-(hxTop + ex(z)), y0 - en(z), z - 0.01, hxTop + ex(z), y1 + yp, z);
  const zc = top - mouth.yPos, zt = top + 0.2;
  return unionMF([
    hull([box(-hxTop, y0, zs, hxTop, y1, zs + 0.01), at(zt, 0)]),
    hull([at(zc, 0), at(zt, mouth.yPos + 0.2)]),
    frustum(HD.tunnelHx, y0, y1, z0 + mouth.exit + 0.2, HD.tunnelHx + mouth.exit, y0 - mouth.exit, y1 + mouth.exit * 0.4, z0),
  ]);
}

/**
 * The release rod's tunnel, open from the socket top to `top`: the bore, its lead-in chamfers, the gate in its top 2 mm
 * (narrower, so the rod's barbs bend past it), and the pocket under the gate the barbs click into: as long as the
 * barb and the button's whole stroke, 0.3 mm to spare.
 */
export function rodTunnel(top: number): MF {
  const { zb } = rodCatch(top), { gate, ledge, pocket } = HD.catch, [y0, y1] = HD.tunnelY, hx = HD.tunnelHx;
  return unionMF([
    box(-hx, y0, -0.2, hx, y1, top - gate), box(-pocket, y0, zb - HD.stroke - 0.3, pocket, y1, top - gate),
    box(-ledge, y0, top - gate - 0.01, ledge, y1, top + 0.2), tunnelEnds(top, -0.2, ledge),
  ]);
}

/** A straight tunnel (a column's holders under the top one: the rod only passes) from the socket top to `top`, with the same lead-in chamfers. */
export function rodBore(top: number): MF {
  const [y0, y1] = HD.tunnelY, hx = HD.tunnelHx;
  return unionMF([box(-hx, y0, -0.2, hx, y1, top + 0.2), tunnelEnds(top, -0.2, hx)]);
}

/** Release rod with its button head, socket-local (rest position). `zg1`: the top of its tunnel. `drop`: how far the
 * socket is below this holder's dock face (the top holder of a column: the rod runs down through every holder under it). */
export function rod(zg1: number, side = 0, drop = 0): { m: MF; len: number } {
  const zh = zg1 + HD.stroke, zf = HD.rodRest - drop, [y0, y1] = HD.rodY, h = HD.head;
  const [x0, x1] = headSpan(side);
  // the shaft, and two fingers standing from it, free at the top and cut free by a slot beside each (an L: up beside the
  // finger and across over its top, with rounded corners), and a barb on each: pushed down the tunnel, the gate bends
  // them aside and the barbs click out under it, so the rod (and a flat holder's dock key, which it locks) can't
  // slide back out; the barbs then ride the stroke in their pocket. The slots are all under the tunnel's mouth, so
  // the neck between the button and the mouth, where an off-centre push bends the rod, is the whole rod's width.
  const { zcat, zb } = rodCatch(zg1), { barb, ramp, slot, finger, root } = HD.catch, xs = HD.rodHx, xi = xs - finger, fr = HD.neckFillet;
  const cut = (sg: number) => (c: CS) => (sg > 0 ? c : c.mirror([1, 0]));
  const slots = unionCS([1, -1].map((sg) => cut(sg)(roundCS(unionCS([rect2(xi - slot, zb - root, xi, zcat + slot), rect2(xi - slot, zcat, xs + 0.1, zcat + slot)]), 0.2))));
  // (the tip: a slope in y, and 45 degree corners in x, so it finds the tunnel and the next holder's)
  const tipCut = unionCS([1, -1].map((sg) => cut(sg)(P([[xs + 0.1, zf - 0.1], [xs - 0.9, zf - 0.1], [xs + 0.1, zf + 1.0]]))));
  let shaft = extYZ(P([[y0, zf], [y0 + 0.6, zf], [y1, zf + 1.6], [y1, zh + 0.01], [y0, zh + 0.01]]), xs)
    .subtract(extXZ(slots, y0 - 0.1, y1 + 0.1)).subtract(extXZ(tipCut, y0 - 0.1, y1 + 0.1));
  const barbs = unionCS([1, -1].map((sg) => cut(sg)(P([[xs - 0.05, zb], [xs + barb, zb + ramp], [xs + barb, zcat], [xs - 0.05, zcat]]))));
  shaft = shaft.add(extXZ(barbs, y0, y1));
  // fillets where the shaft meets the head: in x (in the print's layers, so the layers' lines curve into the head) and above the shaft in y
  const fx = unionCS([1, -1].map((sg) => cut(sg)(rect2(xs - 0.01, zh - fr.x, xs + fr.x, zh + 0.01).subtract(circle2(xs + fr.x, zh - fr.x, fr.x, 48)))));
  const fy = rect2(y1 - 0.01, zh - fr.y, y1 + fr.y, zh + 0.01).subtract(circle2(y1 + fr.y, zh - fr.y, fr.y, 48));
  shaft = unionMF([shaft, extXZ(fx, y0, y1), extYZ(fy, xs)]);
  // a keycap: softly rounded, a shallow dish in the face the thumb presses, a chamfered rim on the face you see, and
  // three chevrons engraved in it pointing the way it moves. All of it takes plastic away rather than adding it.
  const xc = (x0 + x1) / 2, hw = (x1 - x0) / 2, dish = 0.7, R = (hw * hw + dish * dish) / (2 * dish);
  const face = roundCS(rect2(x0, zh, x1, zh + h.t), 1.1).subtract(circle2(xc, zh + h.t + R - dish, R, 256));
  const chev = unionCS([-4.2, 0, 4.2].map((dx) => P([[xc + dx - 1.5, zh + 1.2], [xc + dx, zh + 0.5], [xc + dx + 1.5, zh + 1.2], [xc + dx + 1.5, zh + 2.0], [xc + dx, zh + 1.3], [xc + dx - 1.5, zh + 2.0]])));
  const toXZ = (m: MF, yTop: number) => m.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, yTop, 0, 1] as any);
  const head = toXZ(extCh(face, 0, h.y1 - y0, 0.2, 0.6), h.y1).subtract(extXZ(chev, h.y1 - 0.45, h.y1 + 1));
  return { m: unionMF([shaft, head]), len: zh + h.t - zf };
}
