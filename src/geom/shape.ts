// Editing a board's shape: its outline (a closed counter-clockwise loop) and its cut-outs (loops inside it, clockwise).
// Corners are moved, added, removed, rounded (a fillet) or cut (a chamfer); an edge can be set to a length or bent
// into an arc; rectangles, circles, slots or any drawn loop are added to the board or cut out of it with a small
// polygon boolean; nothing that crosses itself is let through; and a point being dragged or drawn snaps to the grid,
// to the other corners, to 15-degree steps and to edges. Pure, no WASM: the same numbers in give the same shape out.
import type { Board, Loop, V2 } from '../model/types';
import { area, arc3, arcPts, ccw, dedupe, inside, nearestEdge, rad, segDist, TAU } from './poly';

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const unit = (a: V2): V2 => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l] : [0, 0]; };
const at = <T>(l: T[], i: number): T => l[((i % l.length) + l.length) % l.length];
/** Round away float noise (0.1 + 0.2), so typed and snapped values stay the numbers they look like. */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;
const tidyP = (p: V2): V2 => [tidy(p[0]), tidy(p[1])];

/** A loop turned clockwise (cut-outs are kept that way, as outlineFromLoops makes them). */
export const cw = (l: Loop): Loop => (area(l) > 0 ? [...l].reverse() : l);

/** How much the loop turns at corner i (radians, positive to the left). */
export function turnAt(l: Loop, i: number): number {
  const u = sub(l[i], at(l, i - 1)), v = sub(at(l, i + 1), l[i]);
  return Math.atan2(cross(u, v), dot(u, v));
}

/** A real corner, not one of the many small steps a sampled arc or circle is made of. */
export const isCorner = (l: Loop, i: number, minDeg = 20) => Math.abs(turnAt(l, i)) >= rad(minDeg);

/** The indices of a loop's real corners. */
export const cornersOf = (l: Loop, minDeg = 20) => l.map((_, i) => i).filter((i) => isCorner(l, i, minDeg));

/** The length of edge i (from corner i to the next). */
export const edgeLength = (l: Loop, i: number) => len(sub(at(l, i + 1), l[i]));

// ---------------------------------------------------------------- validity

/** Whether two segments touch or cross (within tol mm). */
function segsTouch(a: V2, b: V2, c: V2, d: V2, tol: number): boolean {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - tol || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - tol) return false;
  if (Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - tol || Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - tol) return false;
  const r = sub(b, a), s = sub(d, c), den = cross(r, s), lr = len(r), ls = len(s);
  if (lr > 0 && ls > 0 && Math.abs(den) > 1e-12 * lr * ls) {
    const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
    if (t >= -tol / lr && t <= 1 + tol / lr && u >= -tol / ls && u <= 1 + tol / ls) return true;
  }
  return segDist(a, c, d).d < tol || segDist(b, c, d).d < tol || segDist(c, a, b).d < tol || segDist(d, a, b).d < tol;
}

/**
 * The first two edges of a loop that cross or touch (or one folding straight back along the one before it), or null
 * if it is a simple loop. A sweep along x keeps it quick for the thousand-point outlines some files have.
 */
export function selfCross(l: Loop, tol = 1e-6): [number, number] | null {
  const n = l.length;
  if (n < 3) return null;
  const segs = l.map((a, i) => { const b = l[(i + 1) % n]; return { i, a, b, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) }; }).sort((p, q) => p.x0 - q.x0);
  for (let s = 0; s < n; s++) {
    const e = segs[s];
    for (let k = s + 1; k < n && segs[k].x0 <= e.x1 + tol; k++) {
      const f = segs[k];
      const eThenF = (e.i + 1) % n === f.i, fThenE = (f.i + 1) % n === e.i;
      if (eThenF || fThenE) {
        // neighbours share a corner: they only cross if the second doubles back along the first
        const [p, q] = eThenF ? [e, f] : [f, e];
        const u = sub(p.b, p.a), v = sub(q.b, q.a);
        if (Math.abs(cross(unit(u), unit(v))) < 1e-9 && dot(u, v) < 0) return [e.i, f.i];
        continue;
      }
      if (segsTouch(e.a, e.b, f.a, f.b, tol)) return [e.i, f.i];
    }
  }
  return null;
}

/** What is wrong with a loop as a board edge, in words, or null. */
export function loopProblem(l: Loop): string | null {
  if (l.length < 3) return 'it needs at least three corners';
  for (let i = 0; i < l.length; i++) if (len(sub(at(l, i + 1), l[i])) < 1e-6) return 'two corners are on top of each other';
  if (selfCross(l)) return 'its edges cross';
  if (Math.abs(area(l)) < 0.01) return 'it has no area';
  return null;
}

/** Whether any edge of one loop touches any edge of the other. */
export function loopsTouch(A: Loop, B: Loop, tol = 1e-6): boolean {
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = at(A, i + 1);
    for (let j = 0; j < B.length; j++) if (segsTouch(a, b, B[j], at(B, j + 1), tol)) return true;
  }
  return false;
}

/** Why an outline and its cut-outs are not a board you can make (one piece, nothing crossing), or null if they are. */
export function shapeProblem(outline: Loop, cutouts: Loop[]): string | null {
  const p = loopProblem(outline);
  if (p) return `That would spoil the outline: ${p}.`;
  for (let k = 0; k < cutouts.length; k++) {
    const c = cutouts[k], q = loopProblem(c);
    if (q) return `That would spoil a cut-out: ${q}.`;
    if (!c.every((pt) => inside(pt, outline)) || loopsTouch(c, outline)) return 'A cut-out would reach the edge of the board. Cut it as a notch instead (Shapes, then Cut out).';
    for (let j = 0; j < k; j++) if (loopsTouch(c, cutouts[j]) || inside(c[0], cutouts[j]) || inside(cutouts[j][0], c)) return 'Two cut-outs would overlap.';
  }
  return null;
}

// ---------------------------------------------------------------- corners and edges

export const moveCorner = (l: Loop, i: number, p: V2): Loop => l.map((q, k) => (k === i ? tidyP(p) : q));

/** A new corner on edge i (between corner i and the next); it becomes corner i + 1. */
export const addCorner = (l: Loop, i: number, p: V2): Loop => [...l.slice(0, i + 1), tidyP(p), ...l.slice(i + 1)];

/** The loop without corner i, or null if that would leave fewer than three. */
export const removeCorner = (l: Loop, i: number): Loop | null => (l.length <= 3 ? null : l.filter((_, k) => k !== i));

/**
 * Make edge i `L` mm long by moving its end along it. When the next edge is square to it (a rectangle's side), that
 * edge slides out with it, so the rectangle stays a rectangle.
 */
export function setEdgeLength(l: Loop, i: number, L: number): Loop {
  const n = l.length, j = (i + 1) % n, k = (i + 2) % n;
  const a = l[i], b = l[j], d = unit(sub(b, a));
  if (!(L > 0) || len(sub(b, a)) < 1e-9) return l;
  const mv = mul(d, L - len(sub(b, a)));
  const next = unit(sub(l[k], b));
  const slide = n > 3 && k !== i && Math.abs(dot(next, d)) < Math.sin(rad(5));
  return l.map((q, m) => (m === j || (slide && m === k) ? tidyP(add(q, mv)) : q));
}

/** The side of edge i away from its loop's own inside (bending a cut-out's edge that way makes the hole bigger). */
function outward(l: Loop, i: number): V2 {
  const d = unit(sub(at(l, i + 1), l[i])), s = area(l) >= 0 ? 1 : -1;
  return [s * d[1], -s * d[0]];
}

/** Bend edge i into an arc whose middle stands `h` mm out from the straight edge, away from its loop's inside
 * (negative: in). */
export function bendEdge(l: Loop, i: number, h: number): Loop {
  const a = l[i], b = at(l, i + 1);
  if (Math.abs(h) < 1e-6 || len(sub(b, a)) < 1e-6) return l;
  const m = add(mul(add(a, b), 0.5), mul(outward(l, i), h));
  const pts = arc3(a, m, b).slice(1, -1).map(tidyP);
  return [...l.slice(0, i + 1), ...pts, ...l.slice(i + 1)];
}

/** The points of an arc from a through m to b, without a (for drawing: the arc carries on from the last point). */
export const arcThrough = (a: V2, m: V2, b: V2): V2[] => arc3(a, m, b).slice(1).map(tidyP);

/**
 * Round (a fillet of radius `size`) or cut (a chamfer, `size` mm along each edge) the corners `idx` of a loop. A
 * corner whose edges are too short for that size gets the most they allow (clamped: true); edges shared by two
 * corners being changed are shared half and half.
 */
export function cornerCut(l: Loop, idx: number[], kind: 'round' | 'cut', size: number): { loop: Loop; clamped: boolean } {
  const n = l.length, set = new Set(idx);
  let clamped = false;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const v = l[i];
    if (!set.has(i) || !(size > 0)) { out.push(v); continue; }
    const a = at(l, i - 1), c = at(l, i + 1), la = len(sub(a, v)), lc = len(sub(c, v));
    const u1 = unit(sub(a, v)), u2 = unit(sub(c, v));
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))); // the angle between the two edges at this corner
    if (phi > Math.PI - rad(2) || phi < 1e-3 || la < 1e-9 || lc < 1e-9) { out.push(v); continue; }
    const tMax = Math.min(la * (set.has((i - 1 + n) % n) ? 0.5 : 1), lc * (set.has((i + 1) % n) ? 0.5 : 1));
    let t = kind === 'round' ? size / Math.tan(phi / 2) : size;
    if (t > tMax + 1e-9) { t = tMax; clamped = true; }
    const T1 = add(v, mul(u1, t)), T2 = add(v, mul(u2, t));
    if (kind === 'cut') { out.push(tidyP(T1), tidyP(T2)); continue; }
    const r = t * Math.tan(phi / 2), cen = add(v, mul(unit(add(u1, u2)), r / Math.sin(phi / 2)));
    const a0 = Math.atan2(T1[1] - cen[1], T1[0] - cen[0]), a1 = Math.atan2(T2[1] - cen[1], T2[0] - cen[0]);
    let sw = a1 - a0;
    while (sw > Math.PI) sw -= TAU;
    while (sw < -Math.PI) sw += TAU;
    const pts = arcPts(cen[0], cen[1], r, a0, sw, 0.3);
    pts[0] = T1; pts[pts.length - 1] = T2;
    out.push(...pts.map(tidyP));
  }
  return { loop: dedupe(out, 1e-6), clamped };
}

// ---------------------------------------------------------------- shapes

/** A slot (two half circles joined by straight sides) from the centre of one end to the other, `w` wide. */
export function slotLoop(a: V2, b: V2, w: number): Loop {
  const d = sub(b, a), L = len(d), r = w / 2;
  if (L < 1e-6) return circlePts(a, r);
  const ang = Math.atan2(d[1], d[0]);
  const n = Math.max(8, Math.min(48, Math.ceil((Math.PI * r) / 0.4)));
  return [...arcPts(b[0], b[1], r, ang - Math.PI / 2, Math.PI, Math.PI * r / n), ...arcPts(a[0], a[1], r, ang + Math.PI / 2, Math.PI, Math.PI * r / n)].map(tidyP);
}

/** A circle fine enough to look round at any zoom a board is drawn at (a segment every half millimetre, 24 to 180). */
export function circlePts(c: V2, r: number): Loop {
  const n = Math.max(24, Math.min(180, Math.ceil((TAU * r) / 0.5)));
  const out: Loop = [];
  for (let i = 0; i < n; i++) out.push(tidyP([c[0] + r * Math.cos((TAU * i) / n), c[1] + r * Math.sin((TAU * i) / n)]));
  return out;
}

/** A regular polygon with `n` sides round a centre, `R` to each corner, with a flat side at the bottom. */
export function polygonLoop(n: number, R: number, c: V2 = [0, 0]): Loop {
  const out: Loop = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 - Math.PI / n + (k * TAU) / n;
    out.push(tidyP([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]));
  }
  return out;
}

/** Where a round hole goes in each convex corner of an outline: `inset` mm in from both edges, if it fits there. */
export function cornerHoles(l: Loop, inset: number, d: number): V2[] {
  const out: V2[] = [];
  for (const i of cornersOf(l, 30)) {
    if (turnAt(l, i) <= 0) continue; // an inside corner: no room
    const v = l[i], u1 = unit(sub(at(l, i - 1), v)), u2 = unit(sub(at(l, i + 1), v));
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    const q = add(v, mul(unit(add(u1, u2)), inset / Math.sin(phi / 2)));
    if (inside(q, l) && nearestEdge(q, l).d >= Math.min(inset, d / 2 + 0.5) - 1e-6 && out.every((o) => len(sub(o, q)) > d + 1)) out.push(tidyP(q));
  }
  return out;
}

// ---------------------------------------------------------------- the boolean

const TOL = 2e-6; // mm: closer than this, a corner is on an edge

/** Where two segments meet: the points, and how far along each they are (0..1). Overlapping segments give their ends. */
function hits(p1: V2, p2: V2, q1: V2, q2: V2): { t: number; u: number; p: V2 }[] {
  const r = sub(p2, p1), s = sub(q2, q1), lr = len(r), ls = len(s);
  if (lr < TOL || ls < TOL) return [];
  const qp = sub(q1, p1), den = cross(r, s);
  if (Math.abs(den) <= 1e-10 * lr * ls) {
    if (Math.abs(cross(qp, r)) / lr > TOL) return []; // parallel, apart
    const out: { t: number; u: number; p: V2 }[] = [];
    const tOf = (q: V2) => dot(sub(q, p1), r) / (lr * lr), uOf = (q: V2) => dot(sub(q, q1), s) / (ls * ls);
    for (const [q, u] of [[q1, 0], [q2, 1]] as [V2, number][]) { const t = tOf(q); if (t > -TOL / lr && t < 1 + TOL / lr) out.push({ t, u, p: q }); }
    for (const [q, t] of [[p1, 0], [p2, 1]] as [V2, number][]) { const u = uOf(q); if (u > -TOL / ls && u < 1 + TOL / ls) out.push({ t, u, p: q }); }
    return out;
  }
  const t = cross(qp, s) / den, u = cross(qp, r) / den, et = TOL / lr, eu = TOL / ls;
  if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return [];
  // a meeting at a corner is that corner exactly, so the pieces on both sides join up
  let p: V2 = add(p1, mul(r, t));
  if (Math.abs(u) <= eu) p = q1; else if (Math.abs(u - 1) <= eu) p = q2;
  if (Math.abs(t) <= et) p = p1; else if (Math.abs(t - 1) <= et) p = p2;
  return [{ t, u, p }];
}

/** Points closer than 10 microns are the same point: each gets one number. */
function pointPool() {
  const pts: V2[] = [], grid = new Map<string, number[]>(), cs = 1e-4;
  const id = (p: V2): number => {
    const gx = Math.floor(p[0] / cs), gy = Math.floor(p[1] / cs);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const c = grid.get(`${gx + dx},${gy + dy}`);
      if (c) for (const k of c) if (Math.abs(pts[k][0] - p[0]) < 1e-5 && Math.abs(pts[k][1] - p[1]) < 1e-5) return k;
    }
    const k = pts.length, key = `${gx},${gy}`;
    pts.push(p);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
    return k;
  };
  return { pts, id };
}

/** Inside a region made of several loops (an outline and its holes): inside an odd number of them. */
const inRegion = (q: V2, ls: Loop[]) => ls.reduce((c, l) => (inside(q, l) ? !c : c), false);

/** Drop the corners that lie on a straight line between their neighbours. */
function straighten(l: Loop): Loop {
  let pts = l;
  for (let pass = 0; pass < 4 && pts.length > 3; pass++) {
    const keep = pts.filter((b, i) => {
      const u = sub(b, at(pts, i - 1)), v = sub(at(pts, i + 1), b);
      return !(len(u) < 1e-9 || (Math.abs(cross(unit(u), unit(v))) < 1e-9 && dot(u, v) > 0));
    });
    if (keep.length === pts.length || keep.length < 3) break;
    pts = keep;
  }
  return pts;
}

/**
 * A polygon boolean for regions made of simple loops (counter-clockwise outer loops, clockwise holes): union,
 * difference (A minus B) or intersection. Every edge is split where the two regions' edges meet (overlapping edges
 * included, which is where most board edits meet: a notch drawn along an edge); each piece is kept or dropped by
 * whether it lies inside the other region or runs along its edge, and the kept pieces are chained back into loops,
 * always taking the sharpest left turn so loops that only touch at a corner come out separate. Outer loops come out
 * counter-clockwise and holes clockwise.
 */
export function boolean(A: Loop[], B: Loop[], op: 'union' | 'diff' | 'inter'): Loop[] {
  type Edge = { a: V2; b: V2; cuts: { t: number; p: V2 }[]; x0: number; x1: number; y0: number; y1: number };
  const edgesOf = (ls: Loop[]): Edge[] => ls.flatMap((l) => l.map((a, i) => { const b = at(l, i + 1); return { a, b, cuts: [], x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) }; }));
  const ea = edgesOf(A.map((l) => l.map(tidyP))), eb = edgesOf(B.map((l) => l.map(tidyP)));
  for (const e of ea) for (const f of eb) {
    if (e.x1 < f.x0 - TOL || f.x1 < e.x0 - TOL || e.y1 < f.y0 - TOL || f.y1 < e.y0 - TOL) continue;
    for (const h of hits(e.a, e.b, f.a, f.b)) { e.cuts.push({ t: h.t, p: h.p }); f.cuts.push({ t: h.u, p: h.p }); }
  }
  const pool = pointPool(), P = pool.pts;
  const pieces = (es: Edge[]) => {
    const out: [number, number][] = [];
    for (const e of es) {
      const ids = [pool.id(e.a), ...e.cuts.sort((x, y) => x.t - y.t).map((c) => pool.id(c.p)), pool.id(e.b)];
      for (let k = 0; k + 1 < ids.length; k++) if (ids[k] !== ids[k + 1]) out.push([ids[k], ids[k + 1]]);
    }
    return out;
  };
  const pa = pieces(ea), pb = pieces(eb);
  const setA = new Set(pa.map(([a, b]) => `${a}>${b}`)), setB = new Set(pb.map(([a, b]) => `${a}>${b}`));
  const mid = (a: number, b: number): V2 => [(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2];
  const keep: [number, number][] = [];
  for (const [a, b] of pa) {
    const k = setB.has(`${a}>${b}`) ? 'same' : setB.has(`${b}>${a}`) ? 'opp' : inRegion(mid(a, b), B) ? 'in' : 'out';
    if (op === 'union' ? k === 'out' || k === 'same' : op === 'inter' ? k === 'in' || k === 'same' : k === 'out' || k === 'opp') keep.push([a, b]);
  }
  for (const [a, b] of pb) {
    if (setA.has(`${a}>${b}`) || setA.has(`${b}>${a}`)) continue; // along A's edge: decided above
    const inA = inRegion(mid(a, b), A);
    if (op === 'union' ? !inA : inA) keep.push(op === 'diff' ? [b, a] : [a, b]);
  }
  // chain the pieces into loops
  const from = new Map<number, number[]>();
  keep.forEach(([a], k) => (from.get(a) ?? from.set(a, []).get(a)!).push(k));
  const used = new Uint8Array(keep.length), loops: Loop[] = [];
  for (let s = 0; s < keep.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const ids = [keep[s][0]];
    let cur = s, closed = false;
    for (let guard = 0; guard <= keep.length; guard++) {
      const [a, b] = keep[cur], din = unit(sub(P[b], P[a]));
      let best = -1, bestAng = -Infinity;
      for (const k of from.get(b) ?? []) {
        if (used[k] && k !== s) continue;
        const dout = unit(sub(P[keep[k][1]], P[b]));
        let ang = Math.atan2(cross(din, dout), dot(din, dout));
        if (ang > Math.PI - 1e-9) ang = -Math.PI; // straight back the way it came: the last choice
        if (ang > bestAng) { bestAng = ang; best = k; }
      }
      if (best < 0) break;
      if (best === s) { closed = true; break; }
      used[best] = 1;
      ids.push(b);
      cur = best;
    }
    if (closed) for (const part of splitPinches(ids)) loops.push(straighten(part.map((i) => P[i])));
  }
  // slivers thinner than a few microns (where two nearly equal curves met) are nothing on a real board
  const perim = (l: Loop) => l.reduce((s, q, i) => s + len(sub(at(l, i + 1), q)), 0);
  return loops.filter((l) => l.length >= 3 && Math.abs(area(l)) > Math.max(1e-6, 2e-3 * perim(l)));
}

/** A walk round a face that passes through one corner twice (a hole touching the edge at a single point, or two holes
 * touching) is split there into simple loops. */
function splitPinches(ids: number[]): number[][] {
  const seen = new Map<number, number>();
  for (let j = 0; j < ids.length; j++) {
    const i = seen.get(ids[j]);
    if (i != null) return [...splitPinches(ids.slice(i, j)), ...splitPinches([...ids.slice(0, i), ...ids.slice(j)])];
    seen.set(ids[j], j);
  }
  return [ids];
}

const regionArea = (ls: Loop[]) => ls.reduce((s, l) => s + area(l), 0);

/**
 * Add a shape to the board (op 'add': it grows out from its edge) or cut it out of it ('cut': a notch at the edge, or
 * a cut-out inside). The board stays one piece with no crossing edges, or the answer says why not.
 */
export function combine(outline: Loop, cutouts: Loop[], shape: Loop, op: 'add' | 'cut'): { outline: Loop; cutouts: Loop[] } | { error: string } {
  const s = ccw(dedupe(shape, 1e-6));
  const pr = loopProblem(s);
  if (pr) return { error: `That shape will not do: ${pr}.` };
  const A = [ccw(outline), ...cutouts.map(cw)];
  const res = boolean(A, [s], op === 'add' ? 'union' : 'diff');
  const outers = res.filter((l) => area(l) > 0), holes = res.filter((l) => area(l) < 0);
  const aA = regionArea(A), aS = area(s), aR = regionArea(res);
  if (!outers.length) return { error: 'That would cut away the whole board.' };
  if (outers.length > 1) return { error: op === 'add' ? 'That shape does not touch the board: let it overlap the edge so the two join.' : 'That would cut the board in two: a board has to stay in one piece.' };
  // a check on the arithmetic: the area has to come out between what the two could make
  const e = 1e-3 * Math.max(1, aA, aS);
  const sane = op === 'add' ? aR >= Math.max(aA, aS) - e && aR <= aA + aS + e : aR <= aA + e && aR >= aA - aS - e;
  if (!sane) return { error: 'That shape could not be worked out exactly. Move it a little and try again.' };
  if (Math.abs(aR - aA) < 1e-4) return { error: op === 'add' ? 'That shape is inside the board already: nothing changes.' : 'That shape is not on the board: nothing to cut.' };
  const q = shapeProblem(outers[0], holes);
  if (q) return { error: q };
  return { outline: outers[0].map(tidyP), cutouts: holes.map((h) => h.map(tidyP)) };
}

// ---------------------------------------------------------------- snapping

export interface SnapIn {
  xs: number[]; ys: number[]; // lines to line up with: corners' x and y, the board's edges and middle, parts and holes
  pts: V2[]; // corners to land on
  anchors: V2[]; // the neighbouring corners: the angle from them snaps to 15-degree steps
  edges: [V2, V2][]; // edges to land on
  grid: number; // mm, 0 for none
  tol: number; // how near counts, mm
  force15?: V2; // Shift while drawing: the angle from this point in 15-degree steps, whatever else is near
}
export interface Ray { from: V2; deg: number }
export interface SnapOut { p: V2; gx: number | null; gy: number | null; rays: Ray[]; on: 'corner' | 'edge' | null }

/** The line in `ls` nearest to v, if one is within tol. */
export const nearestLine = (v: number, ls: number[], tol: number) => {
  let best: number | null = null;
  for (const t of ls) if (Math.abs(t - v) <= tol && (best == null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return best;
};

/** Where a point being dragged or drawn lands: on a corner, lined up with others, at a 15-degree step from its
 * neighbours (where two such rays meet, both), on an edge, or on the grid, in that order. */
export function snapPoint(p: V2, o: SnapIn): SnapOut {
  const g = (v: number) => (o.grid > 0 ? tidy(Math.round(v / o.grid) * o.grid) : tidy(v));
  const step = rad(15), degOf = (k: number) => ((((k * 15) % 360) + 360) % 360);
  if (o.force15) {
    const a = o.force15, d = sub(p, a), k = Math.round(Math.atan2(d[1], d[0]) / step), dir: V2 = [Math.cos(k * step), Math.sin(k * step)];
    let L = Math.max(0, dot(d, dir));
    // the length lands on a line to line up with, else a whole grid step
    const cands: number[] = [];
    if (Math.abs(dir[0]) > 0.05) for (const x of o.xs) cands.push((x - a[0]) / dir[0]);
    if (Math.abs(dir[1]) > 0.05) for (const y of o.ys) cands.push((y - a[1]) / dir[1]);
    const hit = nearestLine(L, cands.filter((c) => c > 0), o.tol);
    L = hit ?? g(L);
    const q = tidyP(add(a, mul(dir, L)));
    return { p: q, gx: hit != null && Math.abs(dir[0]) > 0.05 && o.xs.some((x) => Math.abs(x - q[0]) < 1e-6) ? q[0] : null, gy: hit != null && Math.abs(dir[1]) > 0.05 && o.ys.some((y) => Math.abs(y - q[1]) < 1e-6) ? q[1] : null, rays: [{ from: a, deg: degOf(k) }], on: null };
  }
  let bestPt: V2 | null = null, bd = o.tol;
  for (const q of o.pts) { const d = len(sub(q, p)); if (d <= bd) { bd = d; bestPt = q; } }
  if (bestPt) return { p: bestPt, gx: bestPt[0], gy: bestPt[1], rays: [], on: 'corner' };
  const x = nearestLine(p[0], o.xs, o.tol), y = nearestLine(p[1], o.ys, o.tol);
  if (x != null && y != null) return { p: [x, y], gx: x, gy: y, rays: [], on: null };
  // 15-degree steps from the neighbours
  const rays: { from: V2; dir: V2; k: number; off: number }[] = [];
  for (const a of o.anchors) {
    const d = sub(p, a);
    if (len(d) < o.tol) continue;
    const k = Math.round(Math.atan2(d[1], d[0]) / step), dir: V2 = [Math.cos(k * step), Math.sin(k * step)];
    const off = Math.abs(cross(d, dir));
    if (dot(d, dir) > 0 && off <= o.tol) rays.push({ from: a, dir, k, off });
  }
  rays.sort((u, v) => u.off - v.off);
  if (rays.length) {
    const r = rays[0], R: Ray = { from: r.from, deg: degOf(r.k) };
    const r2 = rays.find((q) => q.from !== r.from && Math.abs(cross(q.dir, r.dir)) > 0.05);
    if (r2) {
      // where the two rays meet: t along r
      const t = cross(sub(r2.from, r.from), r2.dir) / cross(r.dir, r2.dir), q = add(r.from, mul(r.dir, t));
      if (t > 0 && len(sub(q, p)) <= 2 * o.tol) return { p: tidyP(q), gx: null, gy: null, rays: [R, { from: r2.from, deg: degOf(r2.k) }], on: null };
    }
    if (x != null && Math.abs(r.dir[0]) > 0.05) { const t = (x - r.from[0]) / r.dir[0], q = add(r.from, mul(r.dir, t)); if (t > 0 && len(sub(q, p)) <= 2 * o.tol) return { p: tidyP([x, q[1]]), gx: x, gy: null, rays: [R], on: null }; }
    if (y != null && Math.abs(r.dir[1]) > 0.05) { const t = (y - r.from[1]) / r.dir[1], q = add(r.from, mul(r.dir, t)); if (t > 0 && len(sub(q, p)) <= 2 * o.tol) return { p: tidyP([q[0], y]), gx: null, gy: y, rays: [R], on: null }; }
    // along the ray, a whole grid step from where it starts
    const t = g(dot(sub(p, r.from), r.dir));
    return { p: tidyP(add(r.from, mul(r.dir, t))), gx: null, gy: null, rays: [R], on: null };
  }
  // onto an edge (where it crosses the line it is lined up with, if it is)
  let be: { q: V2; d: number } | null = null;
  for (const [a, b] of o.edges) {
    let q: V2 | null = null;
    if (x != null || y != null) {
      const i = x != null ? 0 : 1, v = (x ?? y)!, da = a[i] - v, db = b[i] - v;
      if (da * db <= 0 && Math.abs(da - db) > 1e-9) { const t = da / (da - db); q = add(a, mul(sub(b, a), t)); q[i] = v; }
    } else q = segDist(p, a, b).q;
    if (!q) continue;
    const d = len(sub(q, p));
    if (d <= o.tol && (!be || d < be.d)) be = { q, d };
  }
  if (be) return { p: tidyP(be.q), gx: x, gy: y, rays: [], on: 'edge' };
  return { p: [x ?? g(p[0]), y ?? g(p[1])], gx: x, gy: y, rays: [], on: null };
}

/** The point `L` mm from `from` at `deg` degrees (0 to the right, 90 up), for typed lengths and angles. */
export const polar = (from: V2, L: number, deg: number): V2 => tidyP([from[0] + L * Math.cos(rad(deg)), from[1] + L * Math.sin(rad(deg))]);

/** The length and angle (degrees, 0 to the right, 90 up, 0..360) from one point to another. */
export function lenAng(a: V2, b: V2): { L: number; deg: number } {
  const d = sub(b, a);
  return { L: len(d), deg: ((Math.atan2(d[1], d[0]) * 180) / Math.PI + 360) % 360 };
}

// ---------------------------------------------------------------- what the shape leaves off the board

/** Holes and parts that a shape leaves off the board or cut by its edge. Plugs on an edge are meant to overhang it:
 * only one that is right off the board counts. */
export function offBoard(b: Board): { holes: string[]; comps: string[] } {
  const loops = [b.outline, ...b.cutouts];
  const onBoard = (q: V2) => inside(q, b.outline) && !b.cutouts.some((c) => inside(q, c));
  const edgeDist = (q: V2) => Math.min(...loops.map((l) => nearestEdge(q, l).d));
  const holes = b.holes.filter((h) => !onBoard([h.x, h.y]) || edgeDist([h.x, h.y]) < h.d / 2).map((h) => h.id);
  const comps = b.comps.filter((c) => {
    if (c.hidden) return false;
    const q: V2 = [c.x, c.y];
    if (onBoard(q)) return false;
    return c.conn?.entry === 'edge' ? edgeDist(q) > Math.max(c.w, c.l) / 2 : true;
  }).map((c) => c.id);
  return { holes, comps };
}
