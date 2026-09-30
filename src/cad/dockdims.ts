// Dock dimensions shared by the geometry (dock.ts) and the kernel-free planner (dockplan.ts). Units: mm.
import type { V2 } from '../model/types';

export const LEN_X = 21.0; // shoe length along the rail
export const SHOE_TOP = 23.0;
export const SOCKET_BOTTOM = -20.5;
export const SOCKET_Z = SHOE_TOP - SOCKET_BOTTOM; // world Z of the socket top (43.5)
export const SOCKET_HALF = { x: 9.0, y: 10.4 };
// The holder's tongue, socket-local: 14 mm wide, back face on the socket's divider (y 0.5), front face at y 5.0, so
// 14 x 4.5 mm at the socket mouth. (It was 12 x 4 mm; the wider, deeper section takes a push on the far edge of a
// big holder with about a third less stress, inside the same socket outline.)
export const TONGUE = { hx: 7.0, y0: 0.5, y1: 5.0 };
/** Where the socket latch's nose ends: 1.05 mm into the tongue's groove (the same engagement as before). */
export const NOSE_TIP = TONGUE.y1 - 1.05;

// holder side, socket-local coordinates (holder A back face at y = 0.5)
export const HD = {
  spineHx: 3.0, spineY1: 10.0, tunnelHx: 1.8, tunnelY: [6.2, 8.8] as V2, rodHx: 1.6, rodY: [6.4, 8.6] as V2, voidHx: 1.8, voidY1: 5.0,
  base: { hx: 10.0, y1: 10.0, t: 3.0 }, grip: { hx: 12.0, t: 4.0, gap: 10.0 }, head: { hx: 8.0, y1: 14.0, t: 3.0 },
  rodRest: -1.58, stroke: 3.1, backY: 0.5,
  // the rod clicks in: a barb on a finger (x 0.7..1.6, hanging from the button head) springs out under a ledge at the
  // top of its tunnel, into a pocket long enough for the whole stroke. `ledge`: how deep the ledge is; `barb`: how far
  // the barb stands out from the rod (it passes a 1.8 mm half-width ledge by bending the finger 0.3 mm, once);
  // `pocket`: the pocket's half-width on the barb's side
  catch: { ledge: 2.0, barb: 0.5, pocket: 2.35 },
};
/**
 * A column of small boards (J-Links, adapters), each holder standing on its long edge on the one below: the landing on
 * a lower holder's far wall that the next one stands on (`gap` over the wall, `t` thick, `hx` half its width), and the
 * two pegs under the next one's pedestal that press into it (x either side of the rod's tunnel, y across the spine;
 * the same Ø4 pegs and crush-rib sockets as a stack's towers).
 */
export const LANDING = { gap: 0, t: 8, hx: 12 };
export const PEG = { x: [-7, 7], y: 5.25, r: 2.0, len: 3.4, tip: 0.6 };

/** Holder frame height (above the bed) of the spine top: the board must sit above it. */
export const SPINE_TOP = HD.spineY1 - HD.backY;
export const DOCK_MIN_ZB = SPINE_TOP + 0.5;

/** Grip bar and button head spans (socket-local x) for a spine under the board (0) or beside it (+1 / -1). */
export function gripSpan(side: number): [number, number] {
  const { spineHx, grip } = HD;
  return side > 0 ? [-spineHx, 2 * grip.hx - spineHx] : side < 0 ? [spineHx - 2 * grip.hx, spineHx] : [-grip.hx, grip.hx];
}
export function headSpan(side: number): [number, number] {
  const { spineHx, head } = HD;
  return side > 0 ? [-spineHx, 2 * head.hx - spineHx] : side < 0 ? [spineHx - 2 * head.hx, spineHx] : [-head.hx, head.hx];
}

/**
 * A holder that lies flat in a dock (top face up, out of the wall): a tab, the ear, sticks out from the edge it docks
 * by, flush with the holder's underside, so the holder prints base-down like any other. The tongue that goes in the
 * socket is a small key of its own (the standing holder's pedestal and tongue, and a dovetail on top): it prints on
 * its side like the test kit's key, its tongue lying flat as a standing holder's does, slides into a dovetail groove
 * under the ear from its tip, and the release rod, on its way down through the ear and the key to the latch, locks
 * it there. `len`: how far the ear reaches out from the holder's wall (the button head ends 1 mm short of the wall);
 * `hx`: half its width; `t`: its thickness; `ped`: the pedestal it stands on over the socket top (the holder's
 * underside is that far above it); `dove`: the dovetail, half-widths at its root and at its top, height, clearance.
 */
export const EAR = { len: 15, hx: 12, t: 4.5, ped: 3, dove: { root: 3.4, top: 4.4, h: 2.4, gap: 0.2 } };

/**
 * The rail grip (dinclip.ts railGrip) on the shoe and the pull-tab clip: a fork in the rail's channel whose pad
 * presses one wall. `t`: leg and arm thickness (two 0.45 mm lines); `s0`: the leg's face off the wall as drawn; `arm`:
 * the arm's underside and top over the panel; `knee`: the knee's radius; `root`: where the arm meets its root block,
 * across from the wall; `leg`: the leg's foot over the panel; `pad`: the height of the pad's 0.7 mm flat; `pre`: how
 * far the wall pushes the pad in once the part sits on its hook; `stop`: how much further a knock can push it before
 * the tooth meets the wall.
 */
export const GRIP = { t: 0.9, s0: 0.3, arm: [5.8, 6.7] as V2, knee: 1.5, root: 6.7, leg: 1.4, pad: 2.6, pre: 0.35, stop: 0.45 };
/** The shoe's rail grip: the -y wall's inner face, and how far the shoe moves off it before its fixed hook meets the
 * flange edge (the hook's inside at -17.9, the flange edge at -17.5). */
export const SHOE_GRIP = { wall: -12.5, gap: 0.4 };

/**
 * Anti-rattle leaves (dock.ts `holdLeaves`): a holder in its socket had 0.32 mm of lift before the latch nose caught,
 * +-0.16 across (between the divider and the front wall) and +-0.22 sideways, and nothing pressed it. Now the tongue and
 * its pedestal press the socket with leaves that flex within the print layers (the holder prints on its back, so the
 * tongue's x-z section is a layer):
 *  - `lift`: under each side of the pedestal a leaf (root at x `x0`, `t0` thick tapering to `t`, a `slot` above it to
 *    flex into, over y up to `y1`) with a bump `bump` proud of the pedestal's underside on the socket top's side
 *    margin (x `bx`). Seated, the bump is pressed flush; the latch's play lets the holder rise 0.3 mm, and the leaf
 *    holds it up on the nose's catch with `bump` less that play still pressed.
 *  - `side`: at each front corner of the tongue a leaf (a `slot` behind it, hanging from z `root` to the tongue's
 *    tip, `t0` thick at the root and `t` from `taper` mm down) with a bump on the corner's 45 degree face (`bump`
 *    proud, `bz` along z). The socket's matching face pushes the tongue back onto its divider and to the middle;
 *    the slot closes at `slot`, which stops a knock.
 */
export const HOLD = {
  lift: { x0: 1.6, t0: 1.6, t: 0.9, slot: 0.5, y1: 4.0, bump: 0.4, bx: [7.65, 8.1, 8.7, 9.15] },
  side: { t: 0.9, t0: 1.1, taper: 3.5, slot: 0.5, root: -6.0, bump: 0.53, bz: [-13.9, -13.3, -11.5, -10.9], face: [0.08, 0.28, 0.9, 1.18] },
};
