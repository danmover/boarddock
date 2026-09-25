// Dock dimensions shared by the geometry (dock.ts) and the kernel-free planner (dockplan.ts). Units: mm.
import type { V2 } from '../model/types';

export const LEN_X = 21.0; // shoe length along the rail
export const SHOE_TOP = 23.0;
export const SOCKET_BOTTOM = -20.5;
export const SOCKET_Z = SHOE_TOP - SOCKET_BOTTOM; // world Z of the socket top (43.5)
export const SOCKET_HALF = { x: 9.0, y: 10.4 };

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
