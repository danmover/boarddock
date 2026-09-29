// "Pull-tab" DIN rail clip for TS35 rails (EN 60715), printed on its side so every spring flexes within its layers.
//
// Profile in the (u, v) plane, extruded W along the rail:  u = away from the panel, v = up along the rail face.
//   - fixed top hook over the upper flange (3.2 mm deep, so the clip can't be lifted off by pushing it upwards)
//   - rigid jaw with the lower lip, hung from a 0.8 mm leaf spring at the front: the jaw swings about a point level
//     with the lip, so the lip slides straight down off the flange
//   - pull tab under the rail: pull it down OR towards you and the lip lets go; keep pulling and the device tilts off
//   - pull-off load goes lip -> tongue -> back plate by direct contact, never through the leaf
//   - a front leg stops the jaw after ~2 mm of lip travel so the leaf can't be over-bent
//   - two snap hooks on the front face lock into the holder in any of 4 orientations (90 degree steps)
//   - a rail grip (railGrip below) in the rail's channel presses the top wall, so the clip is preloaded against the
//     top flange and doesn't slide along the rail on its own (it only located on the rail before: 0.2 mm of play
//     out of the wall, 0.65 mm up and down, nothing pressing)
import type { Loop, V2 } from '../model/types';
import type { CS, MF } from './kernel';
import { circle2, extCh, poly, rect2, roundCS, unionCS } from './kernel';
import { GRIP } from './dockdims';

/**
 * Rail grip: a sprung pad in the rail's channel that presses the inside face of one of its walls, so the part clamps
 * that wall and its flange between the pad and its own rigid hook on the flange's outer edge. It is preloaded, not
 * just located, so it can't slide along the rail by itself: a push along the rail has to overcome friction on both
 * faces. A fork hanging from the part's underside, all in the profile so it flexes within the print layers: a root
 * block, an arm along the channel just under the underside, a rounded knee, and a leg down the wall with the pad low
 * on it (the arm carries the pad's moment evenly along its length). A tooth over the knee meets the wall if the part
 * is knocked towards it, so the spring is never pushed more than GRIP.stop past its preload.
 * Frame: s = distance from the wall's inner face into the channel, h = height over the panel (the rail's web top at
 * 1, its flanges' top at 7.5). `gap`: how far the part moves off the wall, from where it is drawn, before its hook
 * meets the flange edge (the pad is drawn that much, and GRIP.pre, into the wall). `under`: the part's underside over
 * the rail. The root block stays 5.8 mm over the panel and 4.5 mm or more from the rail's middle: pan, cheese, button
 * and countersunk screw heads in the rail pass under it, and M5 socket caps stay inside it (M6 ones don't).
 */
export function railGrip(gap: number, under: number, map: (s: number, h: number) => V2): CS {
  const { t, s0, arm: [a0, a1], knee: rk, root, leg, pad, pre, stop } = GRIP;
  const M = (pts: number[][]) => poly(pts.map(([s, h]) => map(s, h)), 'NonZero');
  const R = (sa: number, ha: number, sb: number, hb: number) => M([[sa, ha], [sb, ha], [sb, hb], [sa, hb]]);
  const kc = [s0 + t / 2 + rk, (a0 + a1) / 2 - rk]; // the knee's centre
  const arc = (r: number, from: number, to: number) => Array.from({ length: 17 }, (_, i) => { const a = ((from + ((to - from) * i) / 16) * Math.PI) / 180; return [kc[0] + r * Math.cos(a), kc[1] + r * Math.sin(a)]; });
  const fork = unionCS([
    R(s0, leg, s0 + t, kc[1] + 0.01), // leg
    M([...arc(rk + t / 2, 180, 90), ...arc(rk - t / 2, 90, 180)]), // knee
    R(kc[0] - 0.01, a0, root, a1), // arm
    R(root, a0, root + 1.3, under + 0.8), // root block
  ]);
  // round the slit's end at the root (the arm's top and the part's underside meet the root block there)
  const closed = unionCS([fork, R(-2, under, root + 3, under + 1)]).offset(0.35, 'Round').offset(-0.35, 'Round');
  const fillets = closed.intersect(R(root - 0.5, a1 - 0.01, root + 0.01, under + 0.01));
  // the pad: a 0.7 mm flat that meets the wall, 45 degree flanks; the tooth, with a lead-in on its lower corner
  const e = gap + pre, ts = Math.max(0.05, stop - gap);
  const padCS = M([[s0 + 0.01, pad - 1.1], [-e, pad - 0.35], [-e, pad + 0.35], [s0 + 0.01, pad + 1.35]]);
  const tooth = M([[ts + 0.3, a1 + 0.4], [s0 + t + 0.3, a1 + 0.4], [s0 + t + 0.3, under + 0.3], [ts, under + 0.3], [ts, a1 + 0.7]]);
  return unionCS([fork, fillets, padCS, tooth]);
}

export interface ClipParams {
  W: number; // width along the rail
  tf: number; // rail flange thickness
  tabExt: number; // extra tab length below the standard tab (flat mode, to reach past the holder edge)
  leafT?: number; // leaf thickness at the bottom (jaw end)
  leafTop?: number; // leaf thickness at the top (body end); the leaf is tapered
  stopGap?: number; // jaw bar to front leg: sets the travel stop
  leafBottom?: number;
  tongueGap?: number;
  HA?: number; // holder hook offset from the mount centre (default: 4-fold pattern)
}

export const RAIL = { flangeFront: 7.5, edge: 17.5, wallOuter: 13.5, width: 35, height: 7.5 };

export function clipDims(p: ClipParams) {
  const tf = p.tf;
  const uB = RAIL.flangeFront - tf; // flange back face
  const uL = uB - 0.1; // lip retention face
  const uL0 = uL - 1.3;
  const uF = 16.5; // front face, touches the holder
  const HA = p.HA ?? hookOffset4(p.W); // hook offset from the mount centre
  const vc = 4.0; // mount centre above the rail centre line
  const plateT = 2.0; // holder plate the hooks grip
  const vTop = 20.2;
  const tabEnd = -32 - Math.max(0, p.tabExt);
  const leafT = p.leafT ?? 0.75;
  const leafTop = p.leafTop ?? leafT;
  const barEnd = 12.4 + Math.max(leafT, leafTop);
  const lb = p.leafBottom ?? -22.0;
  const legU = barEnd + (p.stopGap ?? 2.2);
  const eL = 1.25; // lower lip engagement behind the flange
  const lipTop = -(RAIL.edge - eL);
  // rail grip: presses the top wall's inner face (its outer face 13.5 up, as thick as the flange), and the clip sits
  // down on the top flange's edge from 0.2 mm off it (the top wall's inside, at 17.7)
  const gripWall = RAIL.wallOuter - tf, gripGap = 17.7 - RAIL.edge;
  return { tf, uB, uL, uL0, uF, HA, vc, plateT, vTop, tabEnd, leafT, leafTop, leafU: 12.4, leafV: [lb - 0.05, -11.95] as V2, legU, barEnd, barV: [lb - 2.2, lb] as V2, tongueU: 10.05 + (p.tongueGap ?? 0.3), eL, lipTop, gripWall, gripGap };
}

/** Holder-side interface: slot rectangles (in the clip's rail/up frame, centred on the mount centre). */
export const hookOffset4 = (W: number) => Math.max(8.6, W / 2 + 2.6);

export function clipSlots(W: number, HAo?: number) {
  const HA = HAo ?? hookOffset4(W);
  return { HA, inner: HA - 0.925, outer: HA + 0.925, len: W + 0.5, plateT: 2.0, lipTop: 2.0 + 0.1 + 1.8, depth: 16.5 };
}

export function clipProfile(p: ClipParams): { cs: CS; parts: Record<string, Loop> } {
  const d = clipDims(p);
  const { uL, uL0, uF, HA, vc, plateT, vTop, tabEnd, leafT } = d;
  const uBk = RAIL.flangeFront + 0.1;
  const parts: Record<string, Loop> = {
    frontBlock: [[10.0, -12.0], [uF, -12.0], [uF, vTop - 1.2], [uF - 1.2, vTop], [10.0, vTop]],
    backPlate: [[uBk, -17.55], [10.05, -17.55], [10.05, vTop], [uBk, vTop]],
    topWall: [[uL0 + 1.0, vTop], [uL0, vTop - 1.0], [uL0, 17.7], [uBk + 0.05, 17.7], [uBk + 0.05, vTop]],
    topLip: [[uL0, 17.75], [uL0, 14.9], [uL0 + 0.6, 14.3], [uL - 0.5, 14.3], [uL, 17.0], [uL, 17.75]],
    leaf: [[d.leafU, d.leafV[0]], [d.leafU + leafT, d.leafV[0]], [d.leafU + d.leafTop, d.leafV[1]], [d.leafU, d.leafV[1]]],
    leg: [[d.legU, -27.5], [uF, -27.5], [uF, -11.95], [d.legU, -11.95]],
    // jaw: head with the lip and the pull-off tongue, a web down to the bar that hangs on the leaf
    jaw: [[uL0, -20.3], [12.05, -20.3], [12.05, -16.2], [d.tongueU, -16.2], [d.tongueU, -17.95], [uL0, -17.95]],
    web: [[5.6, d.barV[0]], [8.2, d.barV[0]], [8.2, -20.25], [5.6, -20.25]],
    bar: [[5.6, d.barV[0]], [d.barEnd, d.barV[0]], [d.barEnd, d.barV[1]], [5.6, d.barV[1]]],
    lowLip: [[uL0, -17.96], [uL, -17.96], [uL, d.lipTop], [uL0, -17.7]],
    tab: [[5.6, tabEnd], [8.2, tabEnd], [8.2, d.barV[0] + 0.05], [5.6, d.barV[0] + 0.05]],
  };
  const grip = roundCS(rect2(uL0, tabEnd - 3.2, 14.0, tabEnd + 0.01), 1.2);
  // fillets where the leaf meets the body and the jaw (sharp roots would concentrate strain)
  const lu0 = d.leafU, lu1 = d.leafU + leafT, lt1 = d.leafU + d.leafTop;
  const fil = (cx: number, cy: number, sx: number, sy: number, r = 0.9) =>
    rect2(Math.min(cx, cx + sx * r), Math.min(cy, cy + sy * r), Math.max(cx, cx + sx * r), Math.max(cy, cy + sy * r)).subtract(circle2(cx + sx * r, cy + sy * r, r));
  const fillets = [fil(lu0, -12.0, -1, -1), fil(lt1, -12.0, 1, -1), fil(lu1, d.barV[1], 1, 1, 0.6), fil(lu0, d.barV[1], -1, 1, 0.6)];
  // lightening window in the front block between the holder hooks
  const win = roundCS(rect2(11.4, vc - HA + 2.4, uF - 1.3, vc + HA - 2.4), 1.0);
  // the rail grip hangs from the back plate into the channel under the top wall (s runs down the clip, h is u)
  const hold = railGrip(d.gripGap, uBk, (s, h) => [h, d.gripWall - s]);
  let cs = unionCS([...Object.values(parts).map((l) => poly(l, 'NonZero')), grip, hold, ...fillets]).subtract(win);
  // holder snap hooks with relief slots so they flex over ~9 mm
  const cuts: CS[] = [];
  const hooks: CS[] = [];
  const uR = 10.0, uC = uF + plateT + 0.1, uT = uC + 1.8;
  for (const s of [1, -1]) {
    const vh = vc + s * HA;
    const vo = vh + s * 0.775, vi = vo - s * 1.0;
    const pts: V2[] = [[uR, vi], [uT, vi], [uT, vo - s * 0.2], [uC + 1.0, vo + s * 0.7], [uC, vo + s * 0.7], [uC, vo], [uR, vo]];
    hooks.push(poly(pts, 'NonZero'));
    cuts.push(rect2(uR, Math.min(vi, vi - s * 0.8), uF + 0.01, Math.max(vi, vi - s * 0.8)));
    cuts.push(rect2(uR, Math.min(vo, vo + s * 0.35), uF + 0.01, Math.max(vo, vo + s * 0.35)));
  }
  cs = cs.subtract(unionCS(cuts)).add(unionCS(hooks));
  return { cs, parts };
}

/** The clip in print orientation: profile on the bed, extruded W upwards. */
export function buildClip(p: ClipParams): MF {
  const { cs } = clipProfile(p);
  return extCh(cs, 0, p.W, 0.4, 0.2);
}

/** Rail profile (for display), in the clip (u, v) frame. */
export function railProfile(): Loop[] {
  const t = 1.0, e = RAIL.edge, w = RAIL.wallOuter;
  return [
    [[0, -w], [t, -w], [t, w], [0, w]],
    [[0, w - t], [7.5, w - t], [7.5, w], [0, w]], // walls
    [[0, -w], [7.5, -w], [7.5, -w + t], [0, -w + t]],
    [[6.5, w], [7.5, w], [7.5, e], [6.5, e]], // flanges
    [[6.5, -e], [7.5, -e], [7.5, -w], [6.5, -w]],
  ];
}
