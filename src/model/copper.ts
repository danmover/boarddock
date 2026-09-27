// Plausible copper for boards that came without their own (the library, drawn boards, fab files without the copper
// layers): tracks under the solder mask from each plug's pins to the main chip, short hops between neighbouring parts,
// some dropping through a via to the bottom, and a row of stitching vias round the edge. Decoration only, so the 2D
// editor and the 3D view read as a real board: nothing is made from it. Pure and deterministic (same board, same
// copper), and quick enough to redo on every frame of a drag.
import type { Board, Comp, V2 } from './types';
import { bbox, compRect, inside } from '../geom/poly';
import { headerPins } from './probes';

export type Track = NonNullable<Board['traces']>[number];
export type Via = NonNullable<Board['vias']>[number];
type Pin = { p: V2; n: V2 | null; comp: number; power?: boolean };
type Obst = { comp: number; x0: number; y0: number; x1: number; y1: number };

const HEADERS = new Set(['header', 'pins_ra', 'jst_ph', 'jst_xh', 'qwiic', 'swd10', 'jtag20']);
const POWER = new Set(['usb_c', 'usb_micro_b', 'usb_mini_b', 'usb_a', 'usb_a_dual', 'usb_b', 'barrel', 'terminal']);

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const boxOf = (c: Comp, grow = 0) => { const r = compRect(c, grow); return { x0: Math.min(...r.map((q) => q[0])), y0: Math.min(...r.map((q) => q[1])), x1: Math.max(...r.map((q) => q[0])), y1: Math.max(...r.map((q) => q[1])) }; };

/** Where a part's pins are and which way a track leaves each one. */
export function partPins(c: Comp, ci: number): Pin[] {
  const a = (c.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const at = (u: number, v: number): V2 => [c.x + u * ca - v * sa, c.y + u * sa + v * ca];
  const dir = (u: number, v: number): V2 => [u * ca - v * sa, u * sa + v * ca];
  const t = c.conn?.type;
  if (t && HEADERS.has(t)) return headerPins(c).slice(0, 24).map((q) => ({ p: [q.x, q.y] as V2, n: null, comp: ci }));
  if (c.conn && c.conn.entry === 'edge') {
    // the pins are along the back of the plug, away from the edge it faces
    const e = (c.conn.angle * Math.PI) / 180, ex = Math.cos(e), ey = Math.sin(e);
    const along: V2 = [-ey, ex], bx = boxOf(c), wid = Math.abs(along[0]) * (bx.x1 - bx.x0) + Math.abs(along[1]) * (bx.y1 - bx.y0);
    const depth = Math.abs(ex) * (bx.x1 - bx.x0) + Math.abs(ey) * (bx.y1 - bx.y0);
    const n = Math.max(2, Math.min(6, Math.floor(wid / 1.4)));
    const back: V2 = [c.x - ex * depth / 2, c.y - ey * depth / 2];
    return Array.from({ length: n }, (_, k) => {
      const s = (k - (n - 1) / 2) * Math.min(1.3, (wid * 0.8) / n);
      return { p: [back[0] + along[0] * s, back[1] + along[1] * s] as V2, n: [-ex, -ey] as V2, comp: ci, power: POWER.has(t!) && (k === 0 || k === n - 1) };
    });
  }
  const area = c.w * c.l;
  if (area < 9 || c.h > 5) {
    // two-legged: a resistor, a capacitor, an LED, a can standing on the board
    const long = c.w >= c.l, s = (long ? c.w : c.l) / 2 * (c.h > 5 ? 0.45 : 1);
    return long ? [{ p: at(-s, 0), n: dir(-1, 0), comp: ci }, { p: at(s, 0), n: dir(1, 0), comp: ci }] : [{ p: at(0, -s), n: dir(0, -1), comp: ci }, { p: at(0, s), n: dir(0, 1), comp: ci }];
  }
  // a chip: pins down its sides (all four if it is squarish)
  const out: Pin[] = [];
  const four = Math.min(c.w, c.l) / Math.max(c.w, c.l) > 0.7;
  const side = (horiz: boolean, sg: number) => {
    const len = horiz ? c.w : c.l, n = Math.max(1, Math.min(8, Math.floor(len / 1.6)));
    for (let k = 0; k < n; k++) {
      const s = (k - (n - 1) / 2) * (len * 0.8 / n);
      out.push(horiz ? { p: at(s, sg * c.l / 2), n: dir(0, sg), comp: ci } : { p: at(sg * c.w / 2, s), n: dir(sg, 0), comp: ci });
    }
  };
  if (four || c.w >= c.l) { side(true, 1); side(true, -1); }
  if (four || c.l > c.w) { side(false, 1); side(false, -1); }
  return out;
}

/** Does the segment a→b cross the box (grown by r)? */
function hitsBox(a: V2, b: V2, o: { x0: number; y0: number; x1: number; y1: number }, r: number): boolean {
  let t0 = 0, t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  const lo = [o.x0 - r, o.y0 - r], hi = [o.x1 + r, o.y1 + r];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; continue; }
    let u = (lo[i] - a[i]) / d[i], v = (hi[i] - a[i]) / d[i];
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}
function segDist(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function crosses(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
}

/** A route the way a board's tracks run: straight, one 45-degree bend, straight. */
function octo(s0: V2, s1: V2, diagFirst: boolean): V2[] {
  const dx = s1[0] - s0[0], dy = s1[1] - s0[1], k = Math.min(Math.abs(dx), Math.abs(dy));
  if (k < 0.05 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.05) return [s0, s1];
  const diag: V2 = [Math.sign(dx) * k, Math.sign(dy) * k];
  return diagFirst ? [s0, [s0[0] + diag[0], s0[1] + diag[1]], s1] : [s0, [s1[0] - diag[0], s1[1] - diag[1]], s1];
}

/** The board's decorative copper: its tracks and vias. Boards with their own copper keep theirs. */
export function boardCopper(b: Board): { tracks: Track[]; vias: Via[] } {
  if (b.traces?.length) return { tracks: b.traces, vias: b.vias ?? [] };
  const R = rng(b.name + ':' + b.comps.length);
  const bb = bbox(b.outline);
  const comps = b.comps.map((c, i) => ({ c, i })).filter(({ c }) => !c.hidden && c.side !== 'bottom');
  const many = comps.length > 200;
  const obst: Obst[] = comps.map(({ c, i }) => ({ comp: i, ...boxOf(c, 0.25) }));
  const holes = b.holes.map((h) => ({ p: [h.x, h.y] as V2, r: h.d / 2 + 0.9 }));
  const tracks: Track[] = [], vias: Via[] = [];
  const onBoard = (q: V2) => inside(q, b.outline) && !b.cutouts.some((l) => inside(q, l));
  const clearHoles = (pts: V2[]) => pts.every((q, k) => k === 0 || holes.every((h) => segDist(h.p, pts[k - 1], q) > h.r));
  const clearTop = (pts: V2[], skip: Set<number>) => pts.every((q, k) => k === 0 || (obst.every((o) => skip.has(o.comp) || !hitsBox(pts[k - 1], q, o, 0)) && tracks.every((t) => t.side !== 'top' || !crosses(pts[k - 1], q, t.a, t.b))));
  const clearBottom = (pts: V2[]) => pts.every((q, k) => k === 0 || tracks.every((t) => t.side !== 'bottom' || !crosses(pts[k - 1], q, t.a, t.b)));
  const put = (pts: V2[], w: number, side: 'top' | 'bottom') => { for (let k = 1; k < pts.length; k++) tracks.push({ a: pts[k - 1], b: pts[k], w, side }); };
  const stub = (p: Pin, toward: V2, len: number): V2 => {
    let n = p.n;
    if (!n) { const dx = toward[0] - p.p[0], dy = toward[1] - p.p[1]; n = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1]; }
    return [p.p[0] + n[0] * len, p.p[1] + n[1] * len];
  };
  /** Join two pins: on top if it can go round everything, else through vias on the bottom, else not at all. */
  const join = (a: Pin, c: Pin, w: number): boolean => {
    const s0 = stub(a, c.p, 1.1 + R() * 0.6), s1 = stub(c, a.p, 1.1 + R() * 0.6);
    if (![a.p, c.p, s0, s1].every(onBoard)) return false;
    const skip = new Set([a.comp, c.comp]);
    const first = R() < 0.5;
    for (const df of [first, !first]) {
      const mid = octo(s0, s1, df), pts = [a.p, ...mid, c.p];
      if (mid.every(onBoard) && clearHoles(pts) && clearTop(pts, skip)) { put(pts, w, 'top'); return true; }
    }
    const mid = octo(s0, s1, first);
    if (!mid.every(onBoard) || !clearHoles(mid) || !clearBottom(mid) || !clearTop([a.p, s0], skip) || !clearTop([s1, c.p], skip)) return false;
    put([a.p, s0], w, 'top'); put(mid, w, 'bottom'); put([s1, c.p], w, 'top');
    vias.push({ x: s0[0], y: s0[1], d: 0.6 }, { x: s1[0], y: s1[1], d: 0.6 });
    return true;
  };

  const pins = comps.flatMap(({ c, i }) => (many && c.w * c.l < 3 ? [] : partPins(c, i)));
  const used = new Set<Pin>();
  // the main chip: the biggest part that is not a plug and not standing tall
  const chips = comps.filter(({ c }) => !c.conn && c.h <= 5 && c.w * c.l >= 16).sort((x, y) => y.c.w * y.c.l - x.c.w * x.c.l);
  const hub = chips[0];
  if (hub) {
    const hp = pins.filter((q) => q.comp === hub.i);
    // each plug's pins run as a bundle to the side of the chip that faces it, in order so they don't cross
    const plugs = comps.filter(({ c }) => c.conn).sort((x, y) => Math.hypot(x.c.x - hub.c.x, x.c.y - hub.c.y) - Math.hypot(y.c.x - hub.c.x, y.c.y - hub.c.y));
    for (const { i } of plugs) {
      const pp = pins.filter((q) => q.comp === i && !used.has(q));
      if (!pp.length) continue;
      const cx = pp.reduce((s, q) => s + q.p[0], 0) / pp.length, cy = pp.reduce((s, q) => s + q.p[1], 0) / pp.length;
      const free = hp.filter((q) => !used.has(q)).sort((x, y) => Math.hypot(x.p[0] - cx, x.p[1] - cy) - Math.hypot(y.p[0] - cx, y.p[1] - cy)).slice(0, pp.length);
      if (!free.length) continue;
      // order both ends along the line across the bundle
      const ax: V2 = [-(hub.c.y - cy), hub.c.x - cx], L = Math.hypot(ax[0], ax[1]) || 1;
      const key = (q: Pin) => (q.p[0] * ax[0] + q.p[1] * ax[1]) / L;
      const ps = [...pp].sort((x, y) => key(x) - key(y)).slice(0, free.length), fs = [...free].sort((x, y) => key(x) - key(y));
      ps.forEach((q, k) => { if (join(q, fs[k], q.power ? 0.6 : 0.25)) { used.add(q); used.add(fs[k]); } });
    }
  }
  // then short hops between neighbours: each pin to the nearest free pin on another part
  let n = 0;
  for (const pi of pins) {
    if (used.has(pi) || n > 220) continue;
    let best: Pin | null = null, bd = Infinity;
    for (const pj of pins) {
      if (pj === pi || used.has(pj) || pj.comp === pi.comp) continue;
      const d = Math.hypot(pj.p[0] - pi.p[0], pj.p[1] - pi.p[1]);
      if (d < bd) { bd = d; best = pj; }
    }
    if (!best || bd > 30 || R() < 0.3) continue;
    if (join(pi, best, R() < 0.15 ? 0.45 : 0.25)) { used.add(pi); used.add(best); n++; }
  }
  // stitching vias round the edge, a little in, where nothing else is
  if (!many) {
    const step = 6, inset = 2.2;
    const near = (q: V2) => obst.some((o) => q[0] > o.x0 - 1 && q[0] < o.x1 + 1 && q[1] > o.y0 - 1 && q[1] < o.y1 + 1) || holes.some((h) => Math.hypot(q[0] - h.p[0], q[1] - h.p[1]) < h.r + 1.5) || tracks.some((t) => segDist(q, t.a, t.b) < 0.9);
    const around = (q: V2) => [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]].every(([dx, dy]) => onBoard([q[0] + dx, q[1] + dy]));
    for (let x = bb.x0 + inset; x <= bb.x1 - inset + 1e-6; x += step) for (const y of [bb.y0 + inset, bb.y1 - inset]) { const q: V2 = [x, y]; if (onBoard(q) && around(q) && !near(q)) vias.push({ x, y, d: 0.5 }); }
    for (let y = bb.y0 + inset + step; y <= bb.y1 - inset - step + 1e-6; y += step) for (const x of [bb.x0 + inset, bb.x1 - inset]) { const q: V2 = [x, y]; if (onBoard(q) && around(q) && !near(q)) vias.push({ x, y, d: 0.5 }); }
  }
  return { tracks, vias };
}
