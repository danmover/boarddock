// A new version of a board: what changed from the old one (holes, connectors, size, tall parts), and the choices the
// user made on the old one carried over to the new one where the part is still there (plug protection, hidden
// parts, hole roles set by hand), so swapping in "rev B" is one step and the holder comes out the way it was set up.
import type { Board, Comp } from './types';
import { bbox } from '../geom/poly';

const r1 = (v: number) => Math.round(v * 10) / 10;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const plugName = (c: Comp) => c.conn?.type.replace(/_/g, ' ') ?? c.pkg;

/** What changed from `a` (the board on the rack) to `b` (its new version), in short lines. */
export function compareBoards(a: Board, b: Board): string[] {
  const out: string[] = [];
  const ba = bbox(a.outline), bb = bbox(b.outline);
  const wa = ba.x1 - ba.x0, ha = ba.y1 - ba.y0, wb = bb.x1 - bb.x0, hb = bb.y1 - bb.y0;
  if (Math.abs(wa - wb) > 0.2 || Math.abs(ha - hb) > 0.2) out.push(`Size ${r1(wa)} × ${r1(ha)} → ${r1(wb)} × ${r1(hb)} mm`);
  if (Math.abs(a.thickness - b.thickness) > 0.05) out.push(`Thickness ${r1(a.thickness)} → ${r1(b.thickness)} mm`);
  // holes: the same when one sits within 0.3 mm of the old spot with the same size
  const left = [...b.holes];
  let moved = 0, resized = 0, gone = 0;
  const shifts: number[] = [];
  for (const h of a.holes) {
    const i = left.findIndex((q) => dist(q, h) < 0.3);
    if (i >= 0) { if (Math.abs(left[i].d - h.d) > 0.1) resized++; left.splice(i, 1); continue; }
    const j = left.findIndex((q) => dist(q, h) < 5 && Math.abs(q.d - h.d) < 0.3);
    if (j >= 0) { moved++; shifts.push(dist(left[j], h)); left.splice(j, 1); } else gone++;
  }
  const holes = [moved && `${moved} moved (up to ${r1(Math.max(...shifts))} mm)`, resized && `${resized} a different size`, left.length && `${left.length} new`, gone && `${gone} gone`].filter(Boolean);
  if (holes.length) out.push(`Holes: ${holes.join(', ')}`);
  // connectors, by reference
  const ca = a.comps.filter((c) => c.conn), cb = b.comps.filter((c) => c.conn);
  const conns: string[] = [];
  for (const c of ca) {
    const n = cb.find((x) => x.ref === c.ref);
    if (!n) { conns.push(`${c.ref} gone`); continue; }
    if (n.conn!.type !== c.conn!.type) conns.push(`${c.ref} is now ${plugName(n)}`);
    else if (dist(n, c) > 0.3 || Math.abs((((n.conn!.angle - c.conn!.angle) % 360) + 360) % 360) > 1) conns.push(`${c.ref} moved ${r1(dist(n, c))} mm${Math.abs(n.conn!.angle - c.conn!.angle) > 1 ? ' and turned' : ''}`);
  }
  for (const n of cb) if (!ca.some((c) => c.ref === n.ref)) conns.push(`${n.ref} new (${plugName(n)})`);
  if (conns.length) out.push(`Connectors: ${conns.join('; ')}`);
  // what stands up above and below the board decides the walls and the clearance underneath
  const tall = (bd: Board, side: 'top' | 'bottom') => Math.max(0, ...bd.comps.filter((c) => !c.hidden && c.side === side).map((c) => c.h));
  for (const side of ['top', 'bottom'] as const) {
    const x = tall(a, side), y = tall(b, side);
    if (Math.abs(x - y) > 0.5) out.push(`Tallest part ${side === 'top' ? 'on top' : 'underneath'}: ${r1(x)} → ${r1(y)} mm`);
  }
  return out;
}

/**
 * The new board with the old one's choices kept: plug protection (cradle, cap, guard, tie) and hidden parts for
 * connectors and parts with the same reference, and hole roles or pin choices set by hand for holes in the same
 * place. Everything else comes from the new file.
 */
export function carryOver(old: Board, b: Board): Board {
  const nb = structuredClone(b);
  for (const c of nb.comps) {
    const o = old.comps.find((x) => x.ref === c.ref);
    if (!o) continue;
    if (o.hidden) c.hidden = true;
    if (o.conn && c.conn && o.conn.type === c.conn.type) {
      c.conn.cradle = o.conn.cradle; c.conn.cap = o.conn.cap; c.conn.guard = o.conn.guard; c.conn.tie = o.conn.tie;
      if (o.role) c.role = o.role;
    }
  }
  for (const h of nb.holes) {
    const o = old.holes.find((x) => dist(x, h) < 0.3 && Math.abs(x.d - h.d) < 0.1);
    if (!o) continue;
    if (o.use && o.use !== 'auto') h.use = o.use;
    if (o.role && o.why && /by hand|switched off/.test(o.why)) { h.role = o.role; h.why = o.why; }
  }
  return nb;
}
