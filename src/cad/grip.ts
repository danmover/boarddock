// How a holder grips its board: the sizes and the spring sums behind the spring clips and the anti-rattle springs
// (kernel-free, so it is quick to test). The geometry is built in generate.ts.
//
// A spring clip is a leaf standing straight up from the bed, as tall as the wall, freed from the base and the wall by
// slits and joined to the wall only at its root, along its whole height. It bends sideways, within the print layers
// (the strong way for a printed part), and nothing about it overhangs except the short flat ledge of its lip.
//  - the leaf tapers from root to tip (thickness ~ sqrt of the distance from the load), so the strain is spread
//    evenly along it instead of piling up at the root: for the same push aside, about 40% less peak strain than a
//    straight leaf
//  - the lip has an entry ramp (35 degrees from vertical, easy to push past), a flat ledge that holds the board down,
//    and clears the board's top by a layer or so once it is in: a seated board puts no load on the clip, so it
//    never takes a set or creeps
// A separate, softer anti-rattle spring (a thin leaf with a 45 degree face on the board's top edge) presses the board
// sideways against the opposite guards and down onto its seats, with a small, steady strain.
import type { MaterialProps } from '../model/library';
import type { HolderSettings } from '../model/types';

export const SLIT = 0.6; // slit around a leaf: wide enough that it doesn't fuse on the first layers (0.4 mm nozzle)
export const FACE = 0.1; // a clip's leaf stands this much further out than the guards, so the board never leans on it
export const RAMP = 35; // entry ramp, degrees from the direction the board goes in
export const MU = 0.3; // friction, PCB on printed plastic (rough)
export const LAYER = 0.2;

/** A leaf spring standing on the bed: length L (root to tip), thickness t0 at the root tapering to tMin, height h. */
export interface Leaf { L: number; t0: number; tMin: number; h: number; lipLen: number }

/** Where the board pushes on the leaf: the middle of its lip, which ends 0.3 mm short of the tip. */
export const loadAt = (f: Leaf) => f.L - 0.3 - f.lipLen / 2;

/** Leaf thickness at s from the root: constant-stress taper to the load point, never under tMin. */
export function leafT(f: Leaf, s: number): number {
  const sc = loadAt(f);
  return Math.max(f.tMin, f.t0 * Math.sqrt(Math.max(0, 1 - s / sc)));
}

/**
 * Beam sums for a leaf pushed aside by `delta` at its load point (elastic, small deflection, root fixed): the force
 * it takes (N), its stiffness (N/mm) and the peak bending strain.
 */
export function leafMech(f: Leaf, E: number, delta: number) {
  const sc = loadAt(f), n = 300, ds = sc / n;
  let c = 0; // compliance at the load point, mm/N
  for (let i = 0; i < n; i++) { const s = (i + 0.5) * ds, t = leafT(f, s); c += ((sc - s) ** 2 / (E * (f.h * t ** 3) / 12)) * ds; }
  const k = 1 / c, F = k * delta;
  let eps = 0;
  for (let i = 0; i <= n; i++) { const s = Math.min(sc - 1e-6, i * ds), t = leafT(f, s); eps = Math.max(eps, (6 * F * (sc - s)) / (E * f.h * t * t)); }
  return { F, k, eps };
}

/** Force to press the board past a ramp that pushes a spring aside with force F (wedge with friction). */
export function pushForce(F: number, rampDeg = RAMP, mu = MU) {
  const t = Math.tan((rampDeg * Math.PI) / 180);
  return (F * (t + mu)) / (1 - mu * t);
}

/** The first layer boundary at or above z (layers start at the bed), so a flat face prints where it is drawn. */
export const onLayer = (z: number) => Math.ceil(z / LAYER - 1e-6) * LAYER;

export interface ClipDesign {
  leaf: Leaf;
  tip: number; // how far the lip reaches over the board's nominal edge
  face: number; // leaf face, from the board's nominal edge (negative: outside it)
  delta: number; // worst push aside while the board goes in (the board hard against this side's guards)
  eps: number; // peak strain at that
  epsRest: 0; // the seated board does not touch the clip
  F: number; // sideways force at the nominal push aside (tip), N
  push: number; // force to press the board past this clip, N (nominal)
  ledge: number; // the lip's flat ledge, from the leaf face out (the one overhang, printed flat)
}

/** How hard each clip pushes back while the board goes in, pressing straight down (N): firm, or gentle. */
export const PUSH = { firm: 3.5, gentle: 1.6 };

/**
 * Size a spring clip for a stretch of edge `L` long and `h` tall: the leaf thickness that gives the wanted feel
 * (PUSH; a taller leaf is stiffer, so it gets a thinner one), never past `share` of the material's strain limit in
 * the worst case (the board hard against the clip's side as it goes in). If even the thinnest leaf is over that,
 * the lip gets shorter.
 */
export function designClip(o: { L: number; h: number; mat: MaterialProps; gap: number; play?: number; firm?: boolean; share?: number }): ClipDesign {
  const share = o.share ?? 0.55;
  const play = o.play ?? o.gap; // how far the board can shift towards this clip (its guards, or its pins in their holes)
  const lipLen = Math.min(5, Math.max(3, 0.38 * o.L));
  const face = -(o.gap + FACE);
  const want = o.firm === false ? PUSH.gentle : PUSH.firm;
  const leaf = (t0: number): Leaf => ({ L: o.L, t0, tMin: Math.min(0.7, t0), h: o.h, lipLen });
  const worst = (t0: number, tip: number) => leafMech(leaf(t0), o.mat.E, tip + play).eps;
  const push = (t0: number, tip: number) => pushForce(leafMech(leaf(t0), o.mat.E, tip).F);
  let tip = 0.6, t0 = 0.6;
  // thickest leaf within the strain share, but no thicker than gives the wanted push
  for (let t = 0.6; t <= 1.6 + 1e-9; t += 0.05) {
    if (worst(t, tip) > share * o.mat.strainAllow) break;
    t0 = t;
    if (push(t, tip) >= want) break;
  }
  while (worst(t0, tip) > share * o.mat.strainAllow && tip > 0.45 + 1e-9) tip = Math.max(0.45, tip - 0.05);
  const f = leaf(t0);
  const nom = leafMech(f, o.mat.E, tip);
  return { leaf: f, tip, face, delta: tip + play, eps: worst(t0, tip), epsRest: 0, F: nom.F, push: pushForce(nom.F), ledge: tip - face };
}

export interface BowDesign {
  leaf: Leaf;
  stop: number; // where the board's edge on this side rests once the spring has pushed it across (from its nominal edge)
  preload: number; // nominal push aside at rest
  tol: number; // board size tolerance allowed for (the preload can be this much more)
  tip: number; // apex of its lip, from the nominal edge
  face: number;
  epsRest: number; // strain at rest (nominal), and with the board tol bigger
  epsRestMax: number;
  eps: number; // peak strain while the board goes in
  F: number; // sideways force at rest, N (and as much again pressing it down, on the 45 degree face)
  push: number; // force to press the board past it, N
}

/**
 * Size an anti-rattle spring: a thin leaf whose 45 degree face rests on the board's top edge, pushed aside by
 * `preload` once the board is in. `stop`: how far the board can move away from this side before something stops it
 * (the guards opposite, or its pins in their holes).
 */
export function designBow(o: { L: number; h: number; mat: MaterialProps; gap: number; stop: number }): BowDesign {
  const lipLen = Math.min(4, Math.max(3, 0.3 * o.L));
  const leaf: Leaf = { L: o.L, t0: 0.8, tMin: 0.6, h: o.h, lipLen };
  const preload = 0.3, tol = 0.15;
  const tip = o.stop + preload + 0.3;
  const rest = leafMech(leaf, o.mat.E, preload), restMax = leafMech(leaf, o.mat.E, preload + tol);
  const ins = leafMech(leaf, o.mat.E, preload + 0.3 + tol);
  return { leaf, stop: o.stop, preload, tol, tip, face: -(o.gap + FACE), epsRest: rest.eps, epsRestMax: restMax.eps, eps: ins.eps, F: rest.F, push: pushForce(leafMech(leaf, o.mat.E, preload + 0.3).F) };
}

/**
 * What holds the board in. Older projects saved only `tabs` (wall fingers auto / always / off): auto stays auto,
 * always means clips, off means pins.
 */
export function holdOf(H: Pick<HolderSettings, 'hold' | 'tabs'>): NonNullable<HolderSettings['hold']> {
  return H.hold ?? (H.tabs === 'on' ? 'clips' : H.tabs === 'off' ? 'pins' : 'auto');
}
