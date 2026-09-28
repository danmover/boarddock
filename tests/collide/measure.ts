// Things inside other things, measured exactly: every printed part, board, plug, rail, stand and cable a rack build
// gives out, turned into a solid in the rack's frame (manifold-3d), and each pair that meets intersected. What is left
// is sorted by what met what, with the few contacts a real rack has on purpose taken out (a plug in its own jack, a
// board on its own holder's pins, a cable in its own plugs, a DIN clip's hooks in its own holder, a rail end touching
// its end block's crush ribs and stop). No bounding boxes are used for what is counted: they only pick which pairs to
// intersect.
import { K, freeAll, type MF } from '../../src/cad/kernel';
import { compRect } from '../../src/geom/poly';
import { mul as mulM } from '../../src/cad/assembly';
import { stackLayers } from '../../src/model/holes';
import type { Feature, GenResult, MeshData, PickTag, Project } from '../../src/model/types';

/** What a solid is, for sorting what it meets. */
export type Cls = 'holder' | 'cap' | 'tag' | 'stand' | 'rail' | 'board' | 'plug' | 'cable';

export interface Solid {
  name: string;
  cls: Cls;
  kind?: PickTag['kind'];
  obj: string; // what it belongs to: a holder and its rod are one module, a plug is module/ref, a cable its link
  module?: string;
  ref?: string;
  mf: MF | null; // null: the mesh isn't a closed solid (counted in `unmeasured`)
  lo: number[];
  hi: number[];
}

/** One place where two things are inside each other. `depth`: the overlap's thinnest extent (how far in). */
export interface Overlap { cat: string; a: string; b: string; vol: number; depth: number; at: number[] }

export interface Totals { vol: number; depth: number; n: number }
export interface Measured { cats: Record<string, Totals>; worst: Overlap[]; unmeasured: string[]; solids: number; pairs: number }

/** The categories, in the order they are reported. */
export const CATS = ['holder-holder', 'holder-board', 'holder-plug', 'cap/cradle-plug', 'cable-holder', 'cable-board', 'cable-plug', 'cable-cable', 'cable-stand/rail', 'tag', 'board-board', 'plug-board', 'rail/stand'] as const;

const PRINTED: Partial<Record<PickTag['kind'], Cls>> = { holder: 'holder', rod: 'holder', clip: 'holder', shoe: 'holder', socket: 'holder', link: 'holder', rivet: 'holder', stand: 'holder', cap: 'cap', cabletag: 'tag', railstand: 'stand' };

function place(m: MeshData, T?: number[]): Float32Array {
  const pos = new Float32Array(m.pos);
  if (T) for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    pos[i] = T[0] * x + T[4] * y + T[8] * z + T[12];
    pos[i + 1] = T[1] * x + T[5] * y + T[9] * z + T[13];
    pos[i + 2] = T[2] * x + T[6] * y + T[10] * z + T[14];
  }
  return pos;
}

// made with `new`, which the kernel's clean-up doesn't track: freed at the end of each measure
const made: { delete(): void }[] = [];
function solidOf(pos: Float32Array, idx: Uint32Array): MF | null {
  try {
    const W = K() as any;
    const mesh = new W.Mesh({ numProp: 3, vertProperties: pos, triVerts: new Uint32Array(idx) });
    mesh.merge();
    const m = new W.Manifold(mesh) as MF;
    made.push(m);
    return m.isEmpty() ? null : m;
  } catch { return null; }
}

function bounds(pos: Float32Array) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[i + a]); hi[a] = Math.max(hi[a], pos[i + a]); }
  return { lo, hi };
}

/** Every solid of a build, in the rack's frame. */
export function solids(r: GenResult): Solid[] {
  const out: Solid[] = [];
  const add = (name: string, cls: Cls, obj: string, pos: Float32Array, idx: Uint32Array, module?: string, ref?: string, kind?: PickTag['kind']) => {
    if (!idx.length) return;
    out.push({ name, cls, kind, obj, module, ref, mf: solidOf(pos, idx), ...bounds(pos) });
  };
  for (const pt of [...r.parts, ...(r.display ?? [])]) {
    const Ts = [pt.toAssembly, ...(pt.instances ?? [])];
    Ts.forEach((T, i) => {
      const tag = i ? pt.tags?.[i - 1] ?? pt.tag : pt.tag;
      const cls = tag ? PRINTED[tag.kind] : undefined;
      if (!cls) return;
      const m = pt.displayMesh ?? pt.mesh;
      // each printed part is a thing of its own (a holder and its rod are two), tied to its board by `module`
      const obj = `${pt.id}#${i}`;
      add(`${pt.name}${Ts.length > 1 ? ` #${i + 1}` : ''}`, cls, obj, place(m, T), m.idx, tag?.module, undefined, tag?.kind);
    });
  }
  for (const g of r.ghosts) {
    const t = g.tag;
    if (!t || /^clash/.test(g.name)) continue;
    const pos = place(g.mesh);
    if (t.kind === 'board' || t.kind === 'parts') {
      if (g.mat === 'silk' || g.mat === 'trace' || g.mat === 'copper') continue; // printed on its faces
      add(g.name, 'board', `board ${t.module}`, pos, g.mesh.idx, t.module);
    } else if (t.kind === 'plug') {
      const ref = t.refs?.[0] ?? '';
      // an off-rack lead is a cable; its plug end is the plug's
      if (g.mat === 'cable') add(g.name, 'cable', `lead ${t.module}/${ref}`, pos, g.mesh.idx, t.module, ref);
      else add(`${g.name} ${ref}`, 'plug', `${t.module}/${ref.replace(/:2$/, '')}`, pos, g.mesh.idx, t.module, ref);
    } else if (t.kind === 'rail') add(g.name, 'rail', `rail ${t.rail ?? ''}`, pos, g.mesh.idx);
    else if (t.kind === 'cable') add(g.name, 'cable', `cable ${t.refs?.[0] ?? g.name}`, pos, g.mesh.idx, undefined, t.refs?.[0]);
    else if (t.kind === 'stand') add(g.name, 'holder', t.module ?? g.name, pos, g.mesh.idx, t.module);
  }
  return out;
}

export function category(a: Cls, b: Cls): string {
  if (a === 'tag' || b === 'tag') return 'tag';
  switch ([a, b].sort().join('-')) {
    case 'holder-holder': case 'cap-holder': case 'cap-cap': return 'holder-holder';
    case 'board-holder': case 'board-cap': return 'holder-board';
    case 'holder-plug': return 'holder-plug';
    case 'cap-plug': return 'cap/cradle-plug';
    case 'cable-holder': case 'cable-cap': return 'cable-holder';
    case 'board-cable': return 'cable-board';
    case 'cable-plug': return 'cable-plug';
    case 'cable-cable': return 'cable-cable';
    case 'cable-stand': case 'cable-rail': return 'cable-stand/rail';
    case 'board-board': return 'board-board';
    case 'plug-plug': case 'board-plug': return 'plug-board';
    default: return 'rail/stand';
  }
}

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A feature's box (holder frame) as a solid in the rack's frame. */
function featureSolid(f: Feature, T: number[], grow = 0): MF {
  const [x0, y0, z0, x1, y1, z1] = f.box;
  return K().Manifold.cube([x1 - x0 + 2 * grow, y1 - y0 + 2 * grow, z1 - z0 + 2 * grow]).translate([x0 - grow, y0 - grow, z0 - grow]).transform(T as any);
}

/**
 * Where the contacts a rack has on purpose are, per module (rack frame): each plug's own jack (the jack's footprint,
 * 1 mm round it, through the whole height), and the holder's pins (a board sits on them, through its holes).
 */
function allowed(p: Project, r: GenResult) {
  const jack = new Map<string, MF>(); // module/ref -> the jack's footprint
  const pins = new Map<string, MF>(); // module -> its holder's pins
  // a board bolted on top has no holder (so no frame) of its own: it sits on its layer's holder, moved over
  const frame = new Map<string, number[]>(Object.entries(r.report.frames ?? {}));
  for (const m of p.modules) {
    const F = frame.get(m.id);
    if (!F || m.on) continue;
    for (const L of stackLayers(p, m)) {
      const FL = frame.get(L.mod.id);
      if (FL) for (const bo of L.bolted) frame.set(bo.mod.id, mulM(FL, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, bo.dx, bo.dy, 0, 1]));
    }
  }
  for (const m of p.modules) {
    const T = frame.get(m.id) ?? (p.modules.length === 1 ? I4 : null);
    if (!T) continue;
    for (const c of m.board.comps) if (c.conn) {
      // a box's port is only a marker inside its face (the box is drawn solid): the plug goes in along its axis
      const box = m.board.kind === 'box' && c.conn.entry === 'edge';
      const a = (c.conn.angle * Math.PI) / 180, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
      const half = Math.max(c.w, c.l, c.conn.plug.w) / 2 + 1;
      const at = (s2: number, t: number): [number, number] => [c.x + d[0] * s2 + n[0] * t, c.y + d[1] * s2 + n[1] * t];
      const loop = box ? [at(-30, -half), at(30, -half), at(30, half), at(-30, half)] : compRect(c, 1);
      const cs = new (K().CrossSection)([loop], 'Positive');
      made.push(cs);
      jack.set(`${m.id}/${c.ref}`, cs.extrude(400).translate([0, 0, -200]).transform(T as any));
    }
    const fs = (r.report.features ?? []).filter((f) => f.module === m.id && f.kind === 'pin').map((f) => featureSolid(f, T, 0.3));
    if (fs.length) pins.set(m.id, K().Manifold.union(fs));
  }
  const cradles = new Map<string, MF>(); // module -> its cradles and caps' boxes: a plug overlapping there counts as cap/cradle-plug
  for (const m of p.modules) {
    const T = r.report.frames?.[m.id] ?? (p.modules.length === 1 ? I4 : null);
    if (!T) continue;
    const fs = (r.report.features ?? []).filter((f) => f.module === m.id && (f.kind === 'cradle' || f.kind === 'cap')).map((f) => featureSolid(f, T, 0.5));
    if (fs.length) cradles.set(m.id, K().Manifold.union(fs));
  }
  return { jack, pins, cradles };
}

/**
 * How thick a piece is: the widest ball that fits in it, found slice by slice (each slice shrunk inwards until it is
 * gone) and no more than the piece's height. A cable right through another is a cable's width deep; a sliver where two
 * faces just meet, however it bends round a corner, is as deep as it is thin.
 */
export function thicknessOf(q: MF): number {
  const b = q.boundingBox(), h = b.max[2] - b.min[2];
  let best = 0;
  for (let i = 1; i <= 5; i++) {
    const cs = q.slice(b.min[2] + (h * i) / 6);
    if (cs.isEmpty()) continue;
    let lo = 0, hi = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 + 0.01;
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; const o = cs.offset(-mid, 'Round'); if (o.isEmpty() || o.area() < 1e-6) hi = mid; else lo = mid; }
    best = Math.max(best, 2 * lo);
  }
  return Math.min(h, best);
}

/** A solid's pieces: volume, depth (its thickness) and middle of each. */
function pieces(m: MF): { vol: number; depth: number; at: number[] }[] {
  const out: { vol: number; depth: number; at: number[] }[] = [];
  for (const q of m.decompose()) {
    const v = q.volume();
    if (v < 1e-3) continue;
    const b = q.boundingBox();
    out.push({ vol: v, depth: thicknessOf(q), at: [0, 1, 2].map((k) => Math.round(((b.max[k] + b.min[k]) / 2) * 10) / 10) });
  }
  return out;
}

/** Everything inside something else in a rack build, by category. */
export function measure(p: Project, r: GenResult): Measured {
  const S = solids(r);
  const { jack, pins, cradles } = allowed(p, r);
  const base = (ref: string) => ref.replace(/:2$/, '');
  const links = new Map((p.links ?? []).map((l) => [l.id, [`${l.a.module}/${base(l.a.ref)}`, `${l.b.module}/${base(l.b.ref)}`]]));
  /** The plugs at a cable's ends: a routed cable's link, or the one plug an off-rack lead leaves. */
  const ownPlugs = (c: Solid) => (c.module ? [`${c.module}/${base(c.ref ?? '')}`] : links.get(c.ref ?? '') ?? []);
  const cats: Record<string, Totals> = Object.fromEntries(CATS.map((c) => [c, { vol: 0, depth: 0, n: 0 }]));
  const all: Overlap[] = [];
  let pairs = 0;
  const note = (cat: string, a: Solid, b: Solid, m: MF) => {
    for (const q of pieces(m)) {
      // a rail end pushed into its end block: the crush ribs and the stop behind it touch it (under 0.1 mm), by design
      if (cat === 'rail/stand' && [a.cls, b.cls].includes('rail') && [a.cls, b.cls].includes('stand') && q.depth < 0.1) continue;
      const t = cats[cat];
      t.vol += q.vol; t.depth = Math.max(t.depth, q.depth); t.n++;
      all.push({ cat, a: a.name, b: b.name, vol: q.vol, depth: q.depth, at: q.at });
    }
  };
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const a = S[i], b = S[j];
    if (a.obj === b.obj && a.cls === b.cls) continue; // one thing (a plug's shell and body, one board's parts)
    if (![0, 1, 2].every((k) => a.lo[k] < b.hi[k] && b.lo[k] < a.hi[k])) continue;
    if (!a.mf || !b.mf) continue;
    // a cable runs into its own plugs' boots: that is where it is meant to be
    const [c, o] = a.cls === 'cable' ? [a, b] : [b, a];
    if (c.cls === 'cable' && o.cls === 'plug' && ownPlugs(c).includes(o.obj)) continue;
    // a DIN clip's hooks snap into its own holder's slots
    if (a.module && a.module === b.module && [a.kind, b.kind].includes('clip') && [a.kind, b.kind].includes('holder')) continue;
    pairs++;
    let m = a.mf.intersect(b.mf);
    if (m.volume() < 1e-3) continue;
    const cat = category(a.cls, b.cls);
    // a plug in its own jack
    if (cat === 'plug-board') {
      const [pl, bd] = a.cls === 'plug' ? [a, b] : [b, a];
      const J = pl.module && bd.module === pl.module ? jack.get(`${pl.module}/${(pl.ref ?? '').replace(/:2$/, '')}`) : undefined;
      if (J) m = m.subtract(J);
    }
    // a board on its own holder's pins
    if (cat === 'holder-board') {
      const [h, bd] = a.cls === 'board' ? [b, a] : [a, b];
      const P = h.module && bd.module === h.module ? pins.get(h.module) : undefined;
      if (P) m = m.subtract(P);
    }
    // a plug in a cradle, under a cap
    if (cat === 'holder-plug') {
      const [h] = a.cls === 'holder' ? [a, b] : [b, a];
      const Cr = h.module ? cradles.get(h.module) : undefined;
      if (Cr) { note('cap/cradle-plug', a, b, m.intersect(Cr)); m = m.subtract(Cr); }
    }
    if (m.volume() >= 1e-3) note(cat, a, b, m);
  }
  all.sort((x, y) => y.vol - x.vol);
  const res = { cats, worst: all, unmeasured: S.filter((s) => !s.mf).map((s) => s.name), solids: S.length, pairs };
  freeAll();
  while (made.length) { try { made.pop()!.delete(); } catch { /* freed */ } }
  return res;
}

/** The total over every category. */
export const total = (m: Measured) => Object.values(m.cats).reduce((s, t) => s + t.vol, 0);
