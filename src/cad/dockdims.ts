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
/**
 * The socket latch (dock.ts `latchProfile`, `noseProfile`), (y, z) socket-local, rooted on the boss's top plane `zr`:
 * a long tapered beam (`t0` thick at the root, `t1` under the arm, up to `zt`), a stiffer arm above it (`arm` thick, with
 * the 45 degree ramp the release rod pushes at its top), and the nose on the arm's tongue side. The nose reaches
 * `engage` mm into the groove across the tongue's front face; its underside (the holding face) is undercut `hook`
 * degrees, so a pull on the holder draws the nose in instead of levering it out (the nose sits off the beam's axis, so
 * a flat face would tip the beam and slide the nose out); its top is a lead-in ramp `lead` degrees off the plug-in
 * direction, `tipH` under it a short vertical tip face. `play`: the clearance between the nose and the groove floor
 * (how far the holder lifts before it hangs on the nose).
 */
export const LATCH = {
  hx: 9.0, zr: -20.5, yIn: 6.6, t0: 0.9, tm: 0.6, zm: -13.5, t1: 0.9, zt: -6.0, arm: 0.9, ramp: { w: 1.2, top: -1.2 }, rIn: 0.6, rOut: 1.0,
  engage: 1.4, zn: -5.6, tipH: 1.1, lead: 40, hook: 15, play: 0.65, noseHx: 4.8, noseFillet: 0.5,
};
export type LatchDims = typeof LATCH;
/** Where the socket latch's nose ends: `engage` mm into the tongue's groove. */
export const NOSE_TIP = TONGUE.y1 - LATCH.engage;

/**
 * The nose's corners (y, z) for latch dims `p`: `tip`: the holding face's lowest point at the nose's tip; `root`: where
 * that face meets the arm; `tip2`: the top of the tip face; `top`: where the lead-in ramp ends; `topRoot`: where the
 * top meets the arm. Also the load lines the FEA uses.
 */
export function latchGeom(p: LatchDims = LATCH) {
  const yT = TONGUE.y1 - p.engage, tb = Math.tan((p.hook * Math.PI) / 180), yA = p.yIn + 0.05;
  const run = p.engage + 0.25, rise = run / Math.tan((p.lead * Math.PI) / 180);
  const tip: V2 = [yT, p.zn], root: V2 = [yA, p.zn + (yA - yT) * tb], tip2: V2 = [yT, p.zn + p.tipH], top: V2 = [yT + run, p.zn + p.tipH + rise], topRoot: V2 = [yA, p.zn + p.tipH + rise];
  const rampLo: V2 = [p.yIn, p.ramp.top - p.ramp.w], rampHi: V2 = [p.yIn + p.ramp.w, p.ramp.top];
  return { yT, tip, root, tip2, top, topRoot, rampLo, rampHi, run, rise, tanHook: tb };
}

// holder side, socket-local coordinates (holder A back face at y = 0.5)
export const HD = {
  spineHx: 4.0, spineY1: 10.0, tunnelHx: 2.25, tunnelY: [5.8, 9.0] as V2, rodHx: 1.8, rodY: [6.4, 8.6] as V2, voidHx: 1.8, voidY1: 4.4,
  base: { hx: 10.0, y1: 10.0, t: 3.0 }, grip: { hx: 12.0, t: 4.0, gap: 10.0 }, head: { hx: 8.0, y1: 14.0, t: 3.0 },
  rodRest: -1.58, stroke: 3.1, backY: 0.5,
  // The release rod runs in a tunnel `tunnelHx` x `tunnelY` half-size, the rod `rodHx` x `rodY` in it: 0.9 mm more across
  // and 0.9 more in y, since the tunnel prints across its layers (a hole prints small, a bridged roof sags) and the
  // rod prints a touch large (it was 0.4 more each way, and jammed). The tunnel's mouths have lead-in chamfers, `mouth`:
  // how far the funnel at the top opens on the x sides and down (-y) and up (+y), and `exit` at the bottom, where the
  // rod's tip comes out (a column's rod finds the next holder's tunnel by it).
  mouth: { x: 1.2, yNeg: 1.0, yPos: 0.5, depth: 1.2, exit: 0.7 },
  // The rod clicks in: two fingers stand from the shaft (`root` mm under each barb's foot), each `finger` wide with a
  // `slot` beside it, free at the top, where the barb stands `barb` out from the rod with a `ramp` mm lead-in at its
  // foot, `flat` mm of outer face over it (so it is joined to its finger along 1.4 mm) and a flat catch on top. Pushed down the tunnel, the `gate` (the top 2 mm of the tunnel, only `ledge`
  // half-width) bends them 0.25 mm each aside, once, and they click out into a pocket (`pocket` half-width) long
  // enough for the whole stroke. Pulled up, the barbs meet the gate. Two fingers, so that at least one catches
  // however the rod sits in its tunnel, which has 0.45 mm each side. The fingers are under the tunnel's mouth, not in the
  // stretch between the button and the mouth where a push off-centre bends the rod: the neck under the button is solid.
  catch: { gate: 2.0, ledge: 2.15, barb: 0.6, ramp: 1.0, flat: 0.4, pocket: 2.7, slot: 0.5, finger: 0.8, root: 4.0 },
  // The neck's fillets under the button (`fillet` on the x sides, in the print's layers; `gusset` on the +y side, above
  // the shaft), which the tunnel's mouth funnel takes when the button is pressed home.
  neckFillet: { x: 1.0, y: 0.6 },
};
/**
 * A column of small boards (J-Links, adapters), each holder standing on its long edge on the one below: the landing on
 * a lower holder's far wall that the next one stands on (`gap` over the wall, `t` thick, `hx` half its width), and the
 * two pegs under the next one's pedestal that press into it (x either side of the rod's tunnel, y across the spine;
 * Ø4 pegs in crush-rib holes, made to print lying on their side: see column.ts).
 */
export const LANDING = { gap: 0, t: 6.8, hx: 12 };
// (printed lying flat, a peg lies on its side: `flare` is a 45 degree cone at its root that holds its underside, and
// the hole in the landing has the same countersink; `depth`: how deep the hole is, a flat bottom 0.6 mm past the
// peg's tip; the landing is 6.8 mm thick, was 8: 1.2 mm less column height and material; see column.ts)
export const PEG = { x: [-6.5, 6.5], y: 5.25, r: 2.0, len: 3.4, tip: 0.6, flare: 1.8, depth: 4.6 };

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
export const EAR = { len: 15, hx: 12, t: 4.5, ped: 3, dove: { root: 3.9, top: 4.9, h: 2.4, gap: 0.2 } };

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
 * The tongue's crush ribs (dock.ts `crushRibs`): a holder in its socket has 0.2 mm a side and 0.15 to 0.2 mm front and
 * back, and a printed spring cannot take that up without carrying a permanent load (the anti-rattle leaves this
 * replaces sat at 0.7 to 1.5% strain at rest, against 0.2% for anything that presses for good). So the tongue's two
 * front corner faces carry ribs that are meant to deform once, on the first push in: `base` wide where they grow out
 * of the face (1.8 mm, gently sloped, so they print as part of the tongue and no sharp corner sits at their root), a `crown` wide crest `proud` above it, starting
 * `a0` along the face from its far end, in runs `z` (from, to) down the tongue with `ramp` mm 45 degree ends.
 */
export const CRUSH = { proud: 0.4, base: 1.8, crown: 0.3, a0: 0.5, z: [[-13.2, -11.6]] as [number, number][], ramp: 0.25 };

/**
 * Fillets on the shoe's snap-hook beams, which carry a pull on the holder: `inner`, `outer`: the radius where a beam
 * meets the floor at the bottom of its slit, in the slit under the socket channel and in the one beside the wall (0.3
 * was the slit's own round; 0.6 is a quarter round across the whole 0.6 mm slit, as big as it allows; wider fillets
 * leave a step in the wall beside it, which took more strain than they saved); `tab`: where each hook's tab meets
 * its beam, under the face the socket bears on (0.3 fits under the boss's notch, which is 0.1 mm clear of it).
 */
export const HOOK_SLIT = { inner: 0.6, outer: 0.6, tab: 0.3 };
