// Dimensions in the board editor, the way you measure a board with calipers: from an edge of the board (or a hole, or
// a part) to a hole's centre or a part's side. Typing the measured value moves the thing measured to; two edges of the
// board set its width or height. Pure: they read and change a Board.
import type { Board, Comp, Dim, Feat, V2 } from './types';
import { bbox, compRect } from '../geom/poly';

const compBox = (c: Comp) => { const r = compRect(c); return { x0: Math.min(...r.map((q) => q[0])), x1: Math.max(...r.map((q) => q[0])), y0: Math.min(...r.map((q) => q[1])), y1: Math.max(...r.map((q) => q[1])) }; };

/** Where a feature is: its x and/or y (a side of a part or an edge of the board has only one of them). */
export function featAt(b: Board, f: Feat): { x?: number; y?: number } | null {
  if (f.k === 'edge') { const bb = bbox(b.outline); return f.at === 'x0' ? { x: bb.x0 } : f.at === 'x1' ? { x: bb.x1 } : f.at === 'y0' ? { y: bb.y0 } : f.at === 'y1' ? { y: bb.y1 } : null; }
  if (f.k === 'hole') { const h = b.holes.find((x) => x.id === f.id); return h ? { x: h.x, y: h.y } : null; }
  const c = b.comps.find((x) => x.id === f.id);
  if (!c) return null;
  if (f.at === 'c') return { x: c.x, y: c.y };
  const r = compBox(c);
  return f.at === 'x0' ? { x: r.x0 } : f.at === 'x1' ? { x: r.x1 } : f.at === 'y0' ? { y: r.y0 } : { y: r.y1 };
}

/** The nearest feature to a point, within tol mm: hole centres, part centres and sides, the board's edges. */
export function pickFeat(b: Board, p: V2, tol: number): Feat | null {
  let best: { f: Feat; d: number } | null = null;
  const take = (f: Feat, d: number, bias = 0) => { if (d - bias < tol && (!best || d - bias < best.d)) best = { f, d: d - bias }; };
  for (const h of b.holes) take({ k: 'hole', id: h.id, at: 'c' }, Math.hypot(p[0] - h.x, p[1] - h.y), tol * 0.3);
  for (const c of b.comps) {
    if (c.hidden) continue;
    take({ k: 'comp', id: c.id, at: 'c' }, Math.hypot(p[0] - c.x, p[1] - c.y), tol * 0.2);
    const r = compBox(c), inY = p[1] >= r.y0 - tol && p[1] <= r.y1 + tol, inX = p[0] >= r.x0 - tol && p[0] <= r.x1 + tol;
    if (inY) { take({ k: 'comp', id: c.id, at: 'x0' }, Math.abs(p[0] - r.x0)); take({ k: 'comp', id: c.id, at: 'x1' }, Math.abs(p[0] - r.x1)); }
    if (inX) { take({ k: 'comp', id: c.id, at: 'y0' }, Math.abs(p[1] - r.y0)); take({ k: 'comp', id: c.id, at: 'y1' }, Math.abs(p[1] - r.y1)); }
  }
  const bb = bbox(b.outline);
  take({ k: 'edge', at: 'x0' }, Math.abs(p[0] - bb.x0)); take({ k: 'edge', at: 'x1' }, Math.abs(p[0] - bb.x1));
  take({ k: 'edge', at: 'y0' }, Math.abs(p[1] - bb.y0)); take({ k: 'edge', at: 'y1' }, Math.abs(p[1] - bb.y1));
  return best ? (best as { f: Feat }).f : null;
}

/** The axis a dimension between two features runs along: a side or an edge fixes it, else the longer way. */
export function axisOf(b: Board, a: Feat, c: Feat): 'x' | 'y' | null {
  const pa = featAt(b, a), pc = featAt(b, c);
  if (!pa || !pc) return null;
  const has = (q: { x?: number; y?: number }, k: 'x' | 'y') => q[k] != null;
  const both = (k: 'x' | 'y') => has(pa, k) && has(pc, k);
  if (both('x') && both('y')) return Math.abs(pc.x! - pa.x!) >= Math.abs(pc.y! - pa.y!) ? 'x' : 'y';
  return both('x') ? 'x' : both('y') ? 'y' : null;
}

/** What a dimension measures now (mm, unsigned). */
export function measure(b: Board, d: Dim): number | null {
  const pa = featAt(b, d.a), pc = featAt(b, d.b);
  const va = pa?.[d.axis], vc = pc?.[d.axis];
  return va == null || vc == null ? null : Math.abs(vc - va);
}

/** Make a dimension read `value`: move what it measures to (the second feature, or the first if the second is the
 * board's edge); two edges of the board stretch the board. Mutates the board; false if nothing can move. */
export function setDim(b: Board, d: Dim, value: number): boolean {
  const pa = featAt(b, d.a), pc = featAt(b, d.b);
  const va = pa?.[d.axis], vc = pc?.[d.axis];
  if (va == null || vc == null || !(value >= 0)) return false;
  const sgn = vc - va < 0 ? -1 : 1, delta = sgn * value - (vc - va);
  const moveFeat = (f: Feat, by: number) => {
    const k = d.axis;
    if (f.k === 'hole') { const h = b.holes.find((x) => x.id === f.id); if (h) h[k] = Math.round((h[k] + by) * 100) / 100; return !!h; }
    if (f.k === 'comp') { const c = b.comps.find((x) => x.id === f.id); if (c) c[k] = Math.round((c[k] + by) * 100) / 100; return !!c; }
    return false;
  };
  if (d.b.k !== 'edge') return moveFeat(d.b, delta);
  if (d.a.k !== 'edge') return moveFeat(d.a, -delta);
  // two edges: the board gets wider or taller; everything past the middle moves with the far edge
  const i = d.axis === 'x' ? 0 : 1, bb = bbox(b.outline), mid = i ? (bb.y0 + bb.y1) / 2 : (bb.x0 + bb.x1) / 2;
  const side = Math.sign(vc - mid) || 1;
  const shift = (v: number) => ((v - mid) * side > 0 ? v + delta : v);
  b.outline = b.outline.map((q) => (i ? [q[0], shift(q[1])] : [shift(q[0]), q[1]]) as V2);
  b.cutouts = b.cutouts.map((l) => l.map((q) => (i ? [q[0], shift(q[1])] : [shift(q[0]), q[1]]) as V2));
  return true;
}
