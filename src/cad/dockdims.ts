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
};
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
 * by. Under the ear's tip are the same pedestal and tongue as a standing holder's, in the same socket; on top of it is
 * the release button, on a short rod straight down to the latch, clear of the board. `len`: how far the ear reaches out
 * from the holder's wall (the button head ends 1 mm short of the wall); `hx`: half its width; `t`: its thickness;
 * `ped`: the pedestal it stands on over the socket top.
 */
export const EAR = { len: 15, hx: 12, t: 4.5, ped: 3 };
