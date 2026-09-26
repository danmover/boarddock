// Rail dock: the screwless "DIN hub" (din_hub_v2) ported to manifold.
//  - rail shoe: clips on the rail; press the lever pad beside the socket down to release it, built-in stop
//  - socket: snaps into the shoe in any of four 90 degree turns, two print-in-place tongue latches
//  - holder side: tongue, pedestal, spine with a release-rod tunnel, grip bar
//  - release rod: its head is the button on the holder's far (top) edge; pressing it wedges the latch open
// Frames (mm), as in din_hub_v2:
//  hub world: X along the rail, Y across it, Z away from the panel (panel at Z = 0)
//  socket-local: same axes, Z = 0 at the socket top; tongues plug in along -Z; holder A faces +Y
import type { V2 } from '../model/types';
import { box, circle2, ext, extCh, K, poly, rect2, roundCS, unionCS, unionMF, type CS, type MF } from './kernel';
import { gripSpan, HD, headSpan, LEN_X, NOSE_TIP, TONGUE } from './dockdims';
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
export { LEN_X, SHOE_TOP, SOCKET_BOTTOM, SOCKET_Z, SOCKET_HALF } from './dockdims';

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
  cavHalf: TONGUE.hx + 0.2, cavFullY: TONGUE.y1 - 1.8, cavFrontY: TONGUE.y1 + 0.2, dividerHalf: 0.35, dividerTop: -1.0, windowZ: [-8.4, -4.8], windowX: [-5.2, 5.2], mouthCh: 0.6, // window: 0.45 / 0.4 mm round the nose, so it prints free of the wall
};
// shoe hook notch on all four boss faces; 10 degree retaining face so a pull draws the hooks in
const BOSS_NOTCH = [[8.2, -23.11], [9.3, -23.3], [9.3, -21.2], [8.2, -22.3]];
const LATCH = { hx: 9.0, t: 0.85, rIn: 0.6, rOut: 1.0, zRoot: -20.5 };
const POST = [[9.1, -19.0], [9.4, -18.7], [9.4, -9.0], [10.4, -9.0], [10.4, -19.0]];
const NOSE = [[6.65, -7.95], [NOSE_TIP, -7.95], [NOSE_TIP, -6.55], [NOSE_TIP + 1.3, -5.25], [6.65, -5.25]];
const NOSE_HX = 4.8;

/** (y, z) outline of the +Y latch: plain full-width spring beam with rounded roots, stiff arm, 45 deg push ramp on top. */
export function latchProfile(): CS {
  const zr = LATCH.zRoot, tr = LATCH.t;
  const arm = P([[6.6, zr + 0.5], [6.6 + tr, zr + 0.5], [6.6 + tr, -9.75], [8.2, -9.0], [8.2, -0.8], [6.6, -2.4]]);
  let g = unionCS([arm, rect2(6.6, zr, 6.6 + tr, zr + 0.6), rect2(5.4, zr - 0.6, 9.2, zr)]);
  g = g.offset(LATCH.rOut, 'Round').offset(-LATCH.rOut, 'Round');
  g = g.add(g.offset(LATCH.rIn, 'Round').offset(-LATCH.rIn, 'Round'));
  g = g.intersect(rect2(5.9, zr, 8.2 + tr, 0));
  const parts = g.decompose();
  return parts.reduce((a, c) => (c.area() > a.area() ? c : a));
}

export const noseProfile = () => P(NOSE);

function cavity(off = 0): CS {
  const hf = S.cavHalf + off, ff = S.cavFrontY + off, fy2 = S.cavFullY + off * 0.414;
  const k = hf - (ff - fy2);
  return P([[-hf, -fy2], [-k, -ff], [k, -ff], [hf, -fy2], [hf, fy2], [k, ff], [-k, ff], [-hf, fy2]]);
}

function latchSide(): MF {
  const lat = unionMF([extYZ(latchProfile(), LATCH.hx), extYZ(P(POST), LATCH.hx)]);
  // nose; its -X end gets a 45 degree face because the socket prints standing on -X
  const nose = extYZ(P(NOSE), NOSE_HX).subtract(ext(P([[-20, 7], [-4.8, 7], [2.2, 0], [-20, 0]]), -10, -4));
  return unionMF([lat, nose]);
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
    const [w0, w1] = S.windowZ, [x0, x1] = S.windowX;
    const yy = (a: number, b: number) => (sg > 0 ? [a, b] : [-b, -a]);
    const [wy0, wy1] = yy(5.4 - 0.9, 5.4 + 0.9);
    cuts.push(box(x0, wy0, w0, x1, wy1, w1)); // nose window
    const zr = LATCH.zRoot;
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
// wraps 290 degrees so it can't come off, and the jaw spring lifts it back.
export const SHOE_LEVER = { pivot: [13.4, 39.2] as V2, pad: [24.6, 28.8] as V2, top: 41.0, hook: 22.3, stopGap: 2.0 };
const TOWER = [[11.2, 22.9], [13.3, 22.9], [13.3, 34.6], [12.7, 35.2], [11.8, 35.2], [11.2, 34.6]];
const NECK = [[12.75, 33.8], [13.75, 33.8], [13.75, 38.2], [12.75, 38.2]];

/** The rail release lever (y, z), a separate island printed in place round the tower's pin. */
export function leverProfile(): CS {
  const [py, pz] = SHOE_LEVER.pivot;
  const ring = circle2(py, pz, 3.55, 64).subtract(circle2(py, pz, 2.05, 48));
  const sec: V2[] = [[py, pz]];
  for (let a = -111; a <= -39; a += 4) sec.push([py + 7 * Math.cos((a * Math.PI) / 180), pz + 7 * Math.sin((a * Math.PI) / 180)]);
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
  // lever tower and pin, filleted into the body top
  const [py, pz] = SHOE_LEVER.pivot;
  const tower = unionCS([P(TOWER), P(NECK), circle2(py, pz, 1.7, 40)]);
  const towerF = tower.add(unionCS([tower, rect2(10.2, 21.9, 14.3, 23.0)]).offset(0.8, 'Round').offset(-0.8, 'Round').intersect(rect2(10.2, 22.0, 14.3, 25.0)));
  c = c.add(towerF);
  // soften the outer corners of the body (0.6 mm) so the part looks moulded, not boxy
  const outer = rect2(-21, 21.2, 18.5, 23.5).add(rect2(-21, 3.5, -19.5, 23.5));
  const rounded = c.offset(-0.6, 'Round').offset(0.6, 'Round');
  c = c.subtract(outer).add(rounded.intersect(outer));
  return c.subtract(unionCS(shoeCuts())).add(unionCS([P(HOOK_TIP), P(mir(HOOK_TIP))]));
}

function shoeCuts(): CS[] {
  const inner = slot(8.55, 9.15, 10.0, 18.05), outer = slot(10.0, 10.6, 10.0, 23.1);
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
  return unionMF([body, stop, stop.mirror([1, 0, 0])]);
}

export const shoeLever = () => extYZ(leverProfile(), LEN_X / 2);

/** Print pose for shoe and socket: standing on the -X end face. Returns [pose, inverse]. */
export const END_POSE = { pose: [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1], inv: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] };

// ---------------- holder side (socket-local coordinates, holder A) ----------------
export { HD, SPINE_TOP, DOCK_MIN_ZB } from './dockdims';

/** Tongue that plugs into the socket (after matching_tongue.stl, grown to 14 x 4.5 mm), with a lead-in at the tip. */
export function tongue(into = 0.2, fit = 0): MF {
  // `fit` shrinks the sides and front face (the back face stays on the socket's divider)
  const f = Math.max(0, Math.min(0.4, fit)), { hx, y0, y1 } = TONGUE;
  let t = ext(P([[-hx + f, y0], [hx - f, y0], [hx - f, y1 - 2 - f * 0.4], [hx - 2 - f * 0.6, y1 - f], [-hx + 2 + f * 0.6, y1 - f], [-hx + f, y1 - 2 - f * 0.4]]), -14, into);
  t = t.subtract(box(-10, NOSE_TIP - 0.15, -8.25, 10, y1 + 1.5, -4.8)); // latch groove
  return t.subtract(extYZ(P([[y1 - 0.6, -14.1], [y1 + 0.1, -14.1], [y1 + 0.1, -13.3]]), 10));
}

/**
 * Holder-side dock features for a holder whose far (top) wall's outer face is `far` mm from the dock face.
 * `pedestal` = how deep the pedestal reaches into the holder (to meet the tray wall). `side` = 0 when the spine runs
 * under the board (grip bar centred on it), +1 / -1 when it runs beside the board on the +x / -x side (grip bar
 * reaches away from the board, so it stays clear of plugs on the top edge).
 */
export function holderDock(far: number, pedestal: number, side = 0, fit = 0) {
  const { spineHx, spineY1, grip } = HD;
  const zg0 = far + grip.gap, zg1 = zg0 + grip.t;
  const [g0, g1] = gripSpan(side);
  const add = unionMF([
    tongue(Math.min(1.0, pedestal), fit),
    extXZ(rect2(-HD.base.hx, 0, HD.base.hx, Math.max(HD.base.t, pedestal)), HD.backY, HD.base.y1), // pedestal on the socket top
    box(-spineHx, HD.backY, 0, spineHx, spineY1, zg1), // spine, dock face to grip bar
    // grip bar: rounded, with a shallow finger scoop in the face the fingers pull on (matches the button's dish)
    extXZ(roundCS(rect2(g0, zg0, g1, zg1), 1.2).subtract(circle2((g0 + g1) / 2, zg0 - ((g1 - g0) ** 2 / 4 + 0.64) / 1.6 + 0.8, ((g1 - g0) ** 2 / 4 + 0.64) / 1.6, 256)), HD.backY, spineY1),
  ]);
  const cut = unionMF([
    box(-HD.tunnelHx, HD.tunnelY[0], -0.2, HD.tunnelHx, HD.tunnelY[1], zg1 + 0.2), // release-rod tunnel
    box(-HD.voidHx, HD.backY - 0.1, Math.max(HD.base.t, pedestal) + 1.5, HD.voidHx, HD.voidY1, zg0 - 1.5), // back channel (saves filament)
  ]);
  return { add, cut, zg0, zg1 };
}

/** Release rod with its button head, socket-local (rest position). */
export function rod(zg1: number, side = 0): { m: MF; len: number } {
  const zh = zg1 + HD.stroke, zf = HD.rodRest, [y0, y1] = HD.rodY, h = HD.head;
  const [x0, x1] = headSpan(side);
  const shaft = extYZ(P([[y0, zf], [y0 + 0.6, zf], [y1, zf + 1.6], [y1, zh + 0.01], [y0, zh + 0.01]]), HD.rodHx);
  // a keycap: softly rounded, a shallow dish in the face the thumb presses, a chamfered rim on the face you see, and
  // three chevrons engraved in it pointing the way it moves. All of it takes plastic away rather than adding it.
  const xc = (x0 + x1) / 2, hw = (x1 - x0) / 2, dish = 0.7, R = (hw * hw + dish * dish) / (2 * dish);
  const face = roundCS(rect2(x0, zh, x1, zh + h.t), 1.1).subtract(circle2(xc, zh + h.t + R - dish, R, 256));
  const chev = unionCS([-4.2, 0, 4.2].map((dx) => P([[xc + dx - 1.5, zh + 1.2], [xc + dx, zh + 0.5], [xc + dx + 1.5, zh + 1.2], [xc + dx + 1.5, zh + 2.0], [xc + dx, zh + 1.3], [xc + dx - 1.5, zh + 2.0]])));
  const toXZ = (m: MF, yTop: number) => m.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, yTop, 0, 1] as any);
  const head = toXZ(extCh(face, 0, h.y1 - y0, 0.2, 0.6), h.y1).subtract(extXZ(chev, h.y1 - 0.45, h.y1 + 1));
  return { m: unionMF([shaft, head]), len: zh + h.t - zf };
}

