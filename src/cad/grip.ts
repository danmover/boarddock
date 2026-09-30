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
//
// Where a stretch of edge is short (between plugs) the leaf can fold back on itself, a hairpin (`Leaf.u`): its root arm
// runs out along the edge and a second arm comes back from the fold, carrying the lip, so the springy length is twice
// the stretch's. Both arms taper the same way, thick at the fold where the bending moment is greatest.
//
// The sizes follow the board: how long a leaf, how deep its catch, how hard it pushes and how many there are come from
// the board's size and weight (`sizeFor`, `clipsNeeded`), and each clip is checked for the force to press the board past
// it, the strain at full deflection, the pull that releases it, the lift it holds against, and its fatigue margin.
import type { MaterialProps } from '../model/library';
import type { HolderSettings } from '../model/types';

export const SLIT = 0.6; // slit around a leaf: wide enough that it doesn't fuse on the first layers (0.4 mm nozzle)
export const FACE = 0.1; // a clip's leaf stands this much further out than the guards, so the board never leans on it
export const RAMP = 35; // entry ramp, degrees from the direction the board goes in
export const MU = 0.3; // friction, PCB on printed plastic (rough)
export const LAYER = 0.2;
export const CLIP_ABOVE = 3.2; // the highest point of a spring clip (its pull ear) over the board's top face

/**
 * A leaf spring standing on the bed: length L (root to tip), thickness t0 at the root tapering to tMin, height h.
 * With `u` it is a hairpin: L is its length along the edge, root to the fold's far side; both arms are t0 thick at the
 * fold and taper to tMin towards the load, with `slot` between them at the fold (wider along the arms, where they thin).
 */
export interface Leaf { L: number; t0: number; tMin: number; h: number; lipLen: number; u?: { slot: number } }

export const U_FREE = 0.6; // a hairpin's free arm ends this far from the anchor, its slit
export const U_ARMS = 2.5; // what a hairpin's two arms and the slot between them take across, mm: its outer face stands 2.9 mm out from the board's edge, 0.8 beyond the wall's (a clip's zone is kept clear to 3.1); more met a neighbouring dock's lever in a rack
export const U_TMIN = 0.6; // its arms' least thickness (near the free end, where the bending is least)
/** A hairpin leaf with arms t0 thick at the fold (0.9 at the most); the slot at the fold takes the rest of U_ARMS, and opens along the arms as they thin. */
export const uLeaf = (L: number, t0: number, h: number, lipLen: number): Leaf => ({ L, t0, tMin: Math.min(U_TMIN, t0), h, lipLen, u: { slot: U_ARMS - 2 * t0 } });
/** How much the fold's tight round raises the strain over the beam sum (FEA, tests/springfea.test.ts): more with a narrow slot. */
const foldKt = (f: Leaf) => 1 + (0.24 * f.t0) / (f.u?.slot ?? 1);

/** Where the board pushes on the leaf: the middle of its lip, which ends 0.3 mm short of the tip (a hairpin: 0.3 mm past its free end). */
export const loadAt = (f: Leaf) => (f.u ? U_FREE + 0.3 + f.lipLen / 2 : f.L - 0.3 - f.lipLen / 2);

/** A hairpin's fold: outer radius, and where the arms end and the fold begins. */
export const foldOf = (f: Leaf) => { const Ro = f.t0 + (f.u?.slot ?? 0) / 2; return { Ro, sf: f.L - Ro, rc: (f.t0 + (f.u?.slot ?? 0)) / 2 }; };

/** Thickness of a hairpin's arm at s along the edge: the bending moment there (its distance from the load) sets it. */
export function armT(f: Leaf, s: number): number {
  const sc = loadAt(f), { sf } = foldOf(f);
  return Math.max(f.tMin, f.t0 * Math.sqrt(Math.min(1, Math.abs(s - sc) / Math.max(1e-6, sf - sc))));
}

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
  if (f.u) return uMech(f, E, delta);
  const sc = loadAt(f), n = 300, ds = sc / n;
  let c = 0; // compliance at the load point, mm/N
  for (let i = 0; i < n; i++) { const s = (i + 0.5) * ds, t = leafT(f, s); c += ((sc - s) ** 2 / (E * (f.h * t ** 3) / 12)) * ds; }
  const k = 1 / c, F = k * delta;
  let eps = 0;
  for (let i = 0; i <= n; i++) { const s = Math.min(sc - 1e-6, i * ds), t = leafT(f, s); eps = Math.max(eps, (6 * F * (sc - s)) / (E * f.h * t * t)); }
  return { F, k, eps };
}

/**
 * The same sums for a hairpin, along the path the bending takes: the root arm out to the fold, round the fold, and back
 * along the free arm to the load. A force F across the leaf at the load bends every section by F times its distance
 * along the edge from the load (the free arm's end beyond the load carries none).
 */
function uMech(f: Leaf, E: number, delta: number) {
  const sl = loadAt(f), { sf, rc } = foldOf(f), h = f.h;
  const path: { m: number; t: number; ds: number }[] = [];
  const nA = 240, nF = 60;
  for (let i = 0; i < nA; i++) { const s = ((i + 0.5) * sf) / nA; path.push({ m: Math.abs(s - sl), t: armT(f, s), ds: sf / nA }); }
  for (let i = 0; i < nF; i++) { const a = ((i + 0.5) / nF) * Math.PI; path.push({ m: Math.abs(sf + rc * Math.sin(a) - sl), t: f.t0, ds: (Math.PI * rc) / nF }); }
  const nB = 240, lb = sf - sl;
  for (let i = 0; i < nB; i++) { const s = sf - ((i + 0.5) * lb) / nB; path.push({ m: s - sl, t: armT(f, s), ds: lb / nB }); }
  let c = 0;
  for (const p of path) c += ((p.m * p.m) / ((E * h * p.t ** 3) / 12)) * p.ds;
  const k = 1 / c, F = k * delta;
  let eps = 0;
  for (const p of path) eps = Math.max(eps, (6 * F * p.m) / (E * h * p.t * p.t));
  return { F, k, eps: eps * foldKt(f) };
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

// ---------------------------------------------------------------------------------------------------------------------
// Clip sizes that follow the board

/** What a board weighs, g: its PCB (FR-4, 1.85 g/cm3) and its parts, each a footprint (mm2) and a height (mm) of mostly-empty shell. */
export function boardMass(area: number, thick: number, parts: { area: number; h: number }[] = []): number {
  return area * thick * 1.85e-3 + parts.reduce((a, p) => a + p.area * p.h * 1.3e-3, 0);
}

/** The lift the clips of a board must hold between them, N: a shake of 9 g, and at least 4 N. */
export const holdNeed = (mass: number) => Math.max(4, 0.088 * mass);

export interface BoardLoad { mass: number; long: number; short: number; thick: number }

/** Leaf length wanted, mm (even): longer for a bigger board, 10 for a small one, 16 for the biggest. */
export const spanFor = (l: BoardLoad) => 2 * Math.round(Math.min(16, Math.max(10, 0.16 * l.long)) / 2);

/** How far the lip reaches over the board's edge, mm: deeper for a heavier board, 0.5 to 1.0. */
export const tipFor = (l: BoardLoad) => Math.round(Math.min(1, Math.max(0.5, 0.5 + l.mass / 300)) * 20) / 20;

export const TOTAL_PUSH = 30; // the most all the clips together should take to press the board in, N

/** Force to press the board past one of `n` clips, N: more for a heavier board, and never more than TOTAL_PUSH between them. */
export function pushTarget(l: BoardLoad, firm: boolean, n: number): number {
  const base = Math.min(4.2, 2.6 + 0.02 * l.mass) * (firm ? 1 : PUSH.gentle / PUSH.firm);
  return Math.max(1.2, Math.min(base, TOTAL_PUSH / Math.max(1, n)));
}

/** The hold, over what a shake asks, the clips of a board must have together (a lift is not shared evenly). */
export const HOLD_SHARE = 1.5;

/** How many clips share a hold, when each holds `hold` N. */
export const clipsForHold = (l: BoardLoad, hold: number) => Math.ceil((HOLD_SHARE * holdNeed(l.mass)) / Math.max(0.1, hold));

export interface ClipAsk {
  kind: 'straight' | 'u';
  L: number; h: number; mat: MaterialProps; gap: number;
  play: number; // how far the board can shift towards the clip
  tip: number; // the catch depth wanted, mm (a shallower one if the leaf would be strained)
  want: number; // the push wanted to press the board past it, N
  hold?: number; // the hold wanted, N: a stiffer leaf or a deeper catch until it has it, within the strain limit
  share?: number; // the share of the material's strain limit allowed at full deflection (0.5: the fatigue margin is then 1 at least)
}

export interface ClipSpec extends ClipDesign {
  kind: 'straight' | 'u';
  k: number; // N per mm at the lip
  release: number; // pull on the ear that frees the lip from the board (0.2 mm past its catch), N
  hold: number; // the lift it holds against: friction on its ledge dragging the leaf off the board's edge, N
  fatigue: number; // half the material's strain limit over the strain at full deflection: 1 or more is a margin for many presses
}

/** Peak strain over the beam sum, from the FEA (tests/springfea.test.ts): the root's fillet in a straight leaf, the fold in a hairpin (foldKt). */
const straightKt = 1.12;

/**
 * Size a clip of one kind for a stretch of edge L long: the stiffest leaf that keeps the strain at full deflection
 * (tip + play) inside `share` of the material's limit, but no stiffer than the push wanted, and stiffer or deeper if
 * it must hold more. A shallower catch if even the thinnest leaf would be strained.
 */
export function sizeClip(o: ClipAsk): ClipSpec {
  const share = o.share ?? 0.5, lim = share * o.mat.strainAllow, E = o.mat.E, u = o.kind === 'u';
  const lipLen = u ? Math.min(4, Math.max(3, 0.3 * o.L)) : Math.min(5, Math.max(3, 0.38 * o.L));
  const steps = (a: number, b: number) => { const r: number[] = []; for (let t = a; t <= b + 1e-9; t += 0.05) r.push(Math.round(t * 100) / 100); return r; };
  const ts = u ? steps(0.7, (U_ARMS - 0.6) / 2) : steps(0.6, 1.6);
  const leaf = (t0: number): Leaf => (u ? uLeaf(o.L, t0, o.h, lipLen) : { L: o.L, t0, tMin: Math.min(0.7, t0), h: o.h, lipLen });
  const kt = (f: Leaf) => (f.u ? 1 : straightKt);
  const strain = (t0: number, tip: number) => { const f = leaf(t0); return kt(f) * leafMech(f, E, tip + o.play).eps; };
  const holdAt = (t0: number, tip: number) => (leafMech(leaf(t0), E, tip).k * tip) / MU;
  let tip = o.tip, t0 = ts[0];
  while (strain(ts[0], tip) > lim && tip > 0.45 + 1e-9) tip = Math.max(0.45, Math.round((tip - 0.05) * 100) / 100);
  for (const t of ts) {
    // (a leaf no thicker than its thinnest end is the same thickness all along, and strains more than one a little
    // thicker at the root that tapers: so the strain is not steadily up with the thickness, and one that is over is skipped)
    if (strain(t, tip) > lim) continue;
    t0 = t;
    if (pushForce(leafMech(leaf(t), E, tip).F) >= o.want) break;
  }
  if (o.hold !== undefined) {
    for (const t of ts.filter((x) => x >= t0)) { if (strain(t, tip) > lim) continue; t0 = t; if (holdAt(t, tip) >= o.hold) break; }
    while (holdAt(t0, tip) < o.hold && tip < 1 - 1e-9 && strain(t0, tip + 0.05) <= lim) tip = Math.round((tip + 0.05) * 100) / 100;
  }
  const f = leaf(t0), nom = leafMech(f, E, tip), rel = leafMech(f, E, tip + 0.2), eps = strain(t0, tip), face = -(o.gap + FACE);
  return { kind: o.kind, leaf: f, tip, face, delta: tip + o.play, eps, epsRest: 0, F: nom.F, push: pushForce(nom.F), ledge: tip - face, k: nom.k, release: rel.F, hold: (nom.k * tip) / MU, fatigue: (0.5 * o.mat.strainAllow) / eps };
}

/**
 * The better of a straight and a hairpin clip for a stretch of edge L long: the straight one when it gets the push wanted
 * inside the strain limit (it holds best for its length), else whichever is spared more, the hairpin's fold taking the
 * bending over twice the length.
 */
export function bestClip(o: Omit<ClipAsk, 'kind'>): ClipSpec {
  const lim = (o.share ?? 0.5) * o.mat.strainAllow;
  const a = sizeClip({ ...o, kind: 'straight' });
  if (a.eps <= lim + 1e-9 && a.push >= 0.9 * o.want && a.tip >= o.tip - 1e-9) return a;
  const b = sizeClip({ ...o, kind: 'u' });
  // (the hairpin, when the straight leaf had to give up catch depth or would be strained; else the stiffer of the two)
  if (a.eps > lim + 1e-9 || a.tip < b.tip - 1e-9) return b;
  return b.eps < a.eps && b.push >= a.push ? b : a;
}

/**
 * What holds the board in. Older projects saved only `tabs` (wall fingers auto / always / off): auto stays auto,
 * always means clips, off means pins.
 */
export function holdOf(H: Pick<HolderSettings, 'hold' | 'tabs'>): NonNullable<HolderSettings['hold']> {
  return H.hold ?? (H.tabs === 'on' ? 'clips' : H.tabs === 'off' ? 'pins' : 'auto');
}
