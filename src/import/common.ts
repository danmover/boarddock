// Shared post-processing for every importer: move the board to the origin, classify components,
// point edge connectors at the nearest board edge, and drop duplicate holes.
import type { Board, Comp } from '../model/types';
import { bbox, ccw, compRect, deg, inside, nearestEdge } from '../geom/poly';
import { classify } from '../model/library';
import { applyHoleRoles } from '../model/holes';

export function finishBoard(b: Board, opts: { sizesKnown: boolean; heightsKnown?: boolean }): Board {
  b.outline = ccw(b.outline);
  const bb = bbox(b.outline);
  const dx = -bb.x0, dy = -bb.y0;
  const mv = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: o.x + dx, y: o.y + dy });
  b.outline = b.outline.map(([x, y]) => [x + dx, y + dy]);
  b.cutouts = b.cutouts.map((l) => l.map(([x, y]) => [x + dx, y + dy]));
  b.holes = dedupeHoles(b.holes.map(mv));
  if (b.traces) b.traces = b.traces.map((t) => ({ ...t, a: [t.a[0] + dx, t.a[1] + dy], b: [t.b[0] + dx, t.b[1] + dy] }));
  if (b.vias) b.vias = b.vias.map(mv);
  b.comps = b.comps.map(mv).map((c) => {
    const known = opts.heightsKnown ? c.h : 0;
    let out = classify({ ...c, h: known }, opts.sizesKnown, undefined);
    if (opts.heightsKnown && c.h > 0) out.h = c.h;
    out = aimConnector(out, b, !opts.sizesKnown);
    return out;
  });
  // components sitting on a mounting hole (mounting-hole footprints that slipped through) are removed
  b.comps = b.comps.filter((c) => c.w > 0.05 && c.l > 0.05 && !b.holes.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < 0.3 && c.w < h.d + 3));
  applyHoleRoles(b);
  return b;
}

function dedupeHoles(hs: Board['holes']): Board['holes'] {
  const out: Board['holes'] = [];
  for (const h of hs) if (!out.some((o) => Math.hypot(o.x - h.x, o.y - h.y) < 0.2)) out.push(h);
  return out;
}

/** Edge connectors: find which edge the body touches or overhangs and point the plug axis out of it. */
export function aimConnector(c: Comp, b: Board, orientBody = false): Comp {
  if (!c.conn || c.conn.entry !== 'edge') return c;
  const rect = compRect(c);
  // corner or centre closest to the edge decides it; also prefer an overhanging side
  const e = nearestEdge([c.x, c.y], b.outline);
  const reach = Math.max(c.w, c.l) / 2 + 2.5;
  const overhang = rect.some((p) => !inside(p, b.outline));
  if (e.d > reach && !overhang) return { ...c, conn: { ...c.conn, entry: 'top' } };
  // snap the angle to the edge normal
  const ang = deg(Math.atan2(e.n[1], e.n[0]));
  const angle = Math.round(ang * 10) / 10;
  // sizes guessed from a library entry: turn the body so its depth (l) runs along the plug axis
  return { ...c, rot: orientBody ? angle - 90 : c.rot, conn: { ...c.conn, angle } };
}

export function normalizeName(s: string) {
  return s.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Board';
}
