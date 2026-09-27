// Geometry for the board editor: where a dragged part snaps (to the board's edges and middle, and to the other parts
// and holes), how far it is from each edge, and fitting a photo of the real board under the drawing. Pure.
import type { Board, V2 } from './types';
import { bbox, compRect } from '../geom/poly';

export interface Box2 { x0: number; y0: number; x1: number; y1: number }
type Photo = NonNullable<Board['photo']>;

/** The box round some of a board's parts and holes. */
export function itemsBox(b: Board, ids: Set<string>): Box2 | null {
  const xs: number[] = [], ys: number[] = [];
  for (const c of b.comps) if (ids.has(c.id)) for (const q of compRect(c)) { xs.push(q[0]); ys.push(q[1]); }
  for (const h of b.holes) if (ids.has(h.id)) { xs.push(h.x - h.d / 2, h.x + h.d / 2); ys.push(h.y - h.d / 2, h.y + h.d / 2); }
  return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null;
}

/** Lines a moving part snaps to: the board's edges and middle, and the centres of every other part and hole. */
export function snapLines(b: Board, moving: Set<string>): { xs: number[]; ys: number[] } {
  const bb = bbox(b.outline);
  const xs = [bb.x0, bb.x1, (bb.x0 + bb.x1) / 2], ys = [bb.y0, bb.y1, (bb.y0 + bb.y1) / 2];
  for (const c of b.comps) if (!c.hidden && !moving.has(c.id)) { xs.push(c.x); ys.push(c.y); }
  for (const h of b.holes) if (!moving.has(h.id)) { xs.push(h.x); ys.push(h.y); }
  return { xs, ys };
}

/** How far to nudge a moving box so a side or its middle lies on the nearest line within tol, and which lines. */
export function snapBox(bx: Box2, lines: { xs: number[]; ys: number[] }, tol: number): { dx: number; dy: number; gx: number | null; gy: number | null } {
  const near = (vals: number[], ls: number[]) => {
    let best: { d: number; line: number } | null = null;
    for (const v of vals) for (const t of ls) { const d = t - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: t }; }
    return best;
  };
  const sx = near([bx.x0, (bx.x0 + bx.x1) / 2, bx.x1], lines.xs), sy = near([bx.y0, (bx.y0 + bx.y1) / 2, bx.y1], lines.ys);
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, gx: sx?.line ?? null, gy: sy?.line ?? null };
}

/** The box's distance to the nearer of the board's left and right edges, and of its bottom and top. */
export function edgeGaps(b: Board, bx: Box2): { x: { from: number; to: number; at: number; v: number }; y: { from: number; to: number; at: number; v: number } } {
  const bb = bbox(b.outline), cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2;
  const l = bx.x0 - bb.x0, r = bb.x1 - bx.x1, d = bx.y0 - bb.y0, u = bb.y1 - bx.y1;
  return {
    x: l <= r ? { from: bb.x0, to: bx.x0, at: cy, v: l } : { from: bx.x1, to: bb.x1, at: cy, v: r },
    y: d <= u ? { from: bb.y0, to: bx.y0, at: cx, v: d } : { from: bx.y1, to: bb.y1, at: cx, v: u },
  };
}

/** A photo fitted inside the board's outline box, its shape kept (image w x h pixels). */
export function fitPhoto(b: Board, url: string, iw: number, ih: number): Photo {
  const bb = bbox(b.outline), W = bb.x1 - bb.x0, H = bb.y1 - bb.y0;
  const s = Math.min(W / iw, H / ih), w = iw * s, h = ih * s;
  return { url, x: bb.x0 + (W - w) / 2, y: bb.y0 + (H - h) / 2, w, h, opacity: 0.7 };
}

/** Scale the photo about point a so the two points a and c on it are `real` mm apart. */
export function scalePhoto(ph: Photo, a: V2, c: V2, real: number): Photo {
  const d = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (d < 1e-6 || !(real > 0)) return ph;
  const s = real / d;
  return { ...ph, x: a[0] + (ph.x - a[0]) * s, y: a[1] + (ph.y - a[1]) * s, w: ph.w * s, h: ph.h * s };
}

/** Move the photo so the point `from` on it lies on `to` (a hole on the photo onto the hole on the drawing). */
export const alignPhoto = (ph: Photo, from: V2, to: V2): Photo => ({ ...ph, x: ph.x + to[0] - from[0], y: ph.y + to[1] - from[1] });
