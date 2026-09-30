// Hole wizard: sort a board's holes into what they are for. Only mounting holes get holder pins; connector
// pegs, part leads and the standoffs of a board stacked on top stay free and get clearance underneath.
import type { Board, Hole, HoleRole, Loop, Module, Project, V2 } from './types';
import { bbox, compRect, extentAlong, inside, rad, round, segDist } from '../geom/poly';
import { holderParts } from './cards';

export interface HoleGuess { id: string; role: HoleRole; why: string; sure: boolean }

export const ROLE_INFO: Record<HoleRole, { name: string; short: string; color: string; what: string }> = {
  mount: { name: 'Mounting hole', short: 'mount', color: '#46d58b', what: 'gets a locating pin from the holder' },
  standoff: { name: 'Stacking standoff', short: 'standoff', color: '#c084fc', what: 'used by a board stacked on top: left free, room for the screw head or nut below' },
  plug: { name: 'Connector peg', short: 'plug', color: '#f5a524', what: "a connector's pegs or shell tabs: left free, clearance below" },
  lead: { name: 'Part lead', short: 'lead', color: '#5aa9ff', what: "a part's pins: left free, clearance below" },
  free: { name: 'Ignored', short: 'free', color: '#6b7a88', what: 'nothing is done with it' },
};

/** True for holes that get a holder pin. */
export const isMountHole = (h: Hole) => (h.role ?? 'mount') === 'mount' && h.use !== 'none';

/** Clearance a non-mounting hole needs under the board: radius and depth, or null for none. */
export function holeKeepout(h: Hole, leadLen: number): { r: number; need: number } | null {
  const role = h.role ?? 'mount';
  if (role === 'plug') return { r: h.d / 2 + 1.0, need: Math.max(leadLen, 1.8) + 0.6 };
  if (role === 'lead') return { r: h.d / 2 + 0.9, need: leadLen + 0.4 };
  if (role === 'standoff') return { r: Math.max(3.2, h.d / 2 + 1.6), need: 2.8 };
  return null;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Holes that sit in a straight row at a header pitch with similar holes: pins, not mounting holes. */
function inRow(h: Hole, all: Hole[]): boolean {
  const mates = all.filter((o) => o !== h && near(o.d, h.d, 0.15));
  for (const pitch of [2.54, 2.0, 1.27, 3.5, 3.81, 5.0, 5.08]) {
    const next = mates.filter((o) => near(Math.hypot(o.x - h.x, o.y - h.y), pitch, 0.08));
    for (const a of next) {
      // a third hole on the same line, one pitch further either way
      const dx = a.x - h.x, dy = a.y - h.y;
      if (mates.some((o) => o !== a && (Math.hypot(o.x - (h.x - dx), o.y - (h.y - dy)) < 0.12 || Math.hypot(o.x - (a.x + dx), o.y - (a.y + dy)) < 0.12))) return true;
    }
  }
  return false;
}

/** Distance from a hole to the nearest corner of the board outline (vertices where the edge turns by 45 degrees or more). */
function cornerDist(h: Hole, b: Board): number {
  const ol = b.outline, n = ol.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = ol[(i + n - 1) % n], p = ol[i], c = ol[(i + 1) % n];
    const u = [p[0] - a[0], p[1] - a[1]], v = [c[0] - p[0], c[1] - p[1]];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
    if (cos > Math.SQRT1_2) continue;
    best = Math.min(best, Math.hypot(h.x - p[0], h.y - p[1]));
  }
  // rounded corners are many short segments: fall back to the bounding-box corners
  const bb = bbox(ol);
  for (const [x, y] of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]) best = Math.min(best, Math.hypot(h.x - x, h.y - y) * 0.85);
  return best;
}

function edgeDist(h: Hole, b: Board): number {
  let d = Infinity;
  for (let i = 0; i < b.outline.length; i++) d = Math.min(d, segDist([h.x, h.y], b.outline[i], b.outline[(i + 1) % b.outline.length]).d);
  return d;
}

/**
 * Where a board stacked on `lower` sits (offset of its frame in the lower board's frame): lined up on its mounting
 * holes when at least two of them match holes below (a HAT on a Pi, a shield on an Arduino), else centred.
 */
export function stackAlign(lower: Board, upper: Board): { dx: number; dy: number; matched: number } {
  const lb = bbox(lower.outline), ub = bbox(upper.outline);
  const centre = { dx: (lb.x0 + lb.x1) / 2 - (ub.x0 + ub.x1) / 2, dy: (lb.y0 + lb.y1) / 2 - (ub.y0 + ub.y1) / 2 };
  let best = { ...centre, matched: 0, off: Infinity };
  const L = lower.holes.filter((h) => h.d >= 1.5), U = upper.holes.filter((h) => h.d >= 1.5);
  for (const a of L) for (const q of U) {
    if (Math.abs(a.d - q.d) > 0.8) continue;
    const dx = a.x - q.x, dy = a.y - q.y;
    const matched = U.filter((u) => L.some((l) => Math.hypot(l.x - (u.x + dx), l.y - (u.y + dy)) < 0.5)).length;
    const off = Math.hypot(dx - centre.dx, dy - centre.dy);
    if (matched >= 2 && (matched > best.matched || (matched === best.matched && off < best.off))) best = { dx, dy, matched, off };
  }
  return { dx: best.dx, dy: best.dy, matched: best.matched };
}

/**
 * Guess what every hole is for. `above` = boards stacked on top of this one: holes that line up with theirs
 * (after lining the stack up the way it is built) carry the stacking hardware.
 */
export function detectHoleRoles(b: Board, above: Board[] = []): HoleGuess[] {
  const upper = above.flatMap((u) => {
    const a = stackAlign(b, u);
    return u.holes.map((q) => ({ x: q.x + a.dx, y: q.y + a.dy, name: u.name }));
  });
  return b.holes.map((h): HoleGuess => {
    const p: [number, number] = [h.x, h.y];
    const conn = b.comps.find((c) => !c.hidden && (c.conn || c.kind === 'connector' || c.kind === 'header') && inside(p, compRect(c, 0.8)));
    if (conn && (h.d < 1.5 || conn.kind === 'header' || conn.conn?.type === 'header')) return { id: h.id, role: 'lead', why: `a pin of ${conn.ref}${conn.pkg ? ` (${conn.pkg})` : ''}`, sure: true };
    if (conn) return { id: h.id, role: 'plug', why: `inside ${conn.ref}${conn.pkg ? ` (${conn.pkg})` : ''}: a peg or shell tab`, sure: true };
    const part = b.comps.find((c) => !c.hidden && c.h > 0 && c.w > h.d + 0.5 && inside(p, compRect(c, 0.3)));
    if (part) return { id: h.id, role: 'lead', why: `inside ${part.ref}: a pin or peg of that part`, sure: true };
    if (inRow(h, b.holes)) return { id: h.id, role: 'lead', why: 'in a row at header pitch: pins', sure: true };
    const up = upper.find((q) => Math.hypot(q.x - h.x, q.y - h.y) < 0.8);
    if (up) return { id: h.id, role: 'standoff', why: `lines up with a hole of ${up.name} on top: its standoff goes here`, sure: true };
    if (h.d < 1.5) return { id: h.id, role: 'free', why: `Ø${h.d.toFixed(2)} is too small for a pin`, sure: false };
    const cd = cornerDist(h, b), ed = edgeDist(h, b);
    if (cd < 9 && h.d >= 2.2 && h.d <= 4.5) return { id: h.id, role: 'mount', why: `Ø${h.d.toFixed(1)} near a corner: a mounting hole`, sure: true };
    if (h.d >= 2.2 && h.d <= 4.5 && ed < 12) return { id: h.id, role: 'mount', why: `Ø${h.d.toFixed(1)} near an edge, no part on it: a mounting hole`, sure: false };
    if (h.d >= 2.0) return { id: h.id, role: 'mount', why: `Ø${h.d.toFixed(1)}, no part on it: probably a mounting hole`, sure: false };
    return { id: h.id, role: 'mount', why: `Ø${h.d.toFixed(2)}: small, gets a locating pin`, sure: false };
  });
}

/** Apply the wizard's guesses to a board (mutates). Holes the user already set by hand are kept unless `force`. */
export function applyHoleRoles(b: Board, above: Board[] = [], force = true) {
  const g = new Map(detectHoleRoles(b, above).map((x) => [x.id, x]));
  for (const h of b.holes) {
    const x = g.get(h.id);
    if (!x || (!force && h.role)) continue;
    h.role = x.role;
    h.why = x.why;
    if (x.role !== 'mount' && h.use !== 'none') h.use = 'auto';
  }
}

/** Small boards (up to about a J-Link's size: longest side, the other side) can stand on their long edge in a column. */
export const SMALL = { long: 105, mid: 60 };

/** Whether a board is small enough to stand in a column of small boards (never a box). */
export function isSmall(b: Board): boolean {
  if (b.kind === 'box' || b.outline.length < 3) return false;
  const bb = bbox(b.outline), w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
  return Math.max(w, h) <= SMALL.long && Math.min(w, h) <= SMALL.mid;
}

/** Whether board `m` can go on `x`'s stack as part of a column: both small, and nothing on `x`'s stack but a column. */
export function columnable(p: Project, m: Module, x: Module): boolean {
  if (!isSmall(m.board) || !isSmall(x.board)) return false;
  const b = baseOf(p, x);
  return isSmall(b.board) && ridersOf(p, b).every((r) => r === m || stackMode(p, r) === 'column');
}

/** Boards stacked directly or indirectly on module `m`, bottom to top. */
export function ridersOf(p: Project, m: Module): Module[] {
  const out: Module[] = [];
  const seen = new Set([m.id]);
  let cur = m;
  for (;;) {
    const next = p.modules.find((x) => x.on === cur.id && !seen.has(x.id));
    if (!next) break;
    out.push(next);
    seen.add(next.id);
    cur = next;
  }
  return out;
}

/** The module at the bottom of the stack `m` sits in (m itself when it is not stacked). */
export function baseOf(p: Project, m: Module): Module {
  const seen = new Set<string>();
  let cur = m;
  while (cur.on && !seen.has(cur.id)) {
    seen.add(cur.id);
    const below = p.modules.find((x) => x.id === cur.on);
    if (!below) break;
    cur = below;
  }
  return cur;
}

/** How a stacked board is held: bolted to the board below on standoffs, on its own printed tower layer, or standing
 * on its long edge on the holder below (a column of small boards: J-Links, adapters). */
export function stackMode(p: Project, m: Module): 'bolted' | 'towers' | 'column' {
  if (m.onMode) return m.onMode;
  const below = p.modules.find((x) => x.id === m.on);
  // a J-Link or adapter on another small board stands in a column with it
  if (below && (m.board.role || below.board.role) && isSmall(m.board) && isSmall(below.board)) return 'column';
  return below && stackAlign(below.board, m.board).matched >= 2 ? 'bolted' : 'towers';
}

/**
 * What bolts a board onto the one below it: a standoff on each hole the two boards share, a screw into each end of
 * each standoff, and the screw size from those holes (M2.5 for a Pi's 2.7 mm holes, M3 for an Arduino's 3.2 mm
 * ones). Null when the board isn't bolted on. `shared` is false when fewer than two holes line up (bolted by hand):
 * the count is then a guess of four.
 */
export function stackHardware(p: Project, m: Module): { n: number; screws: number; size: string; gap: number; shared: boolean } | null {
  if (!m.on || stackMode(p, m) !== 'bolted') return null;
  const below = p.modules.find((x) => x.id === m.on);
  if (!below) return null;
  const a = stackAlign(below.board, m.board);
  const L = below.board.holes.filter((h) => h.d >= 1.5), U = m.board.holes.filter((h) => h.d >= 1.5);
  const hit = U.filter((u) => L.some((l) => Math.hypot(l.x - (u.x + a.dx), l.y - (u.y + a.dy)) < 0.5));
  const shared = hit.length >= 2;
  const ds = (shared ? hit : U).map((h) => h.d);
  const d = ds.length ? Math.min(...ds) : 2.7;
  const size = d < 2.4 ? 'M2' : d < 3.0 ? 'M2.5' : d < 3.6 ? 'M3' : 'M4';
  const n = shared ? hit.length : 4;
  return { n, screws: 2 * n, size, gap: stackGap(p, m), shared };
}

/** Standoffs as sold (mm): a board bolted on top gets the shortest that clears what is under it, never less than the 11 mm a Pi HAT uses. */
export const STANDOFF_LENGTHS = [11, 12, 15, 16, 18, 20, 25, 30, 35, 40];

/** Whether two outlines overlap: a corner of one inside the other, or two edges crossing. */
function overlaps(a: Loop, b: Loop): boolean {
  const A = bbox(a), B = bbox(b);
  if (A.x1 <= B.x0 || B.x1 <= A.x0 || A.y1 <= B.y0 || B.y1 <= A.y0) return false;
  if (a.some((q) => inside(q, b)) || b.some((q) => inside(q, a))) return true;
  const cross = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p1 = a[i], p2 = a[(i + 1) % a.length], q1 = b[j], q2 = b[(j + 1) % b.length];
    if (cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0) return true;
  }
  return false;
}

/**
 * What a board bolted on top has to clear, above the top of the board under it: the tallest part of that board under
 * its outline (a plug in a jack counts as far as the plug reaches, as high as it stands), and the parts and leads on
 * its own underside, plus 1 mm. `under`: the part that sets it, and how tall it stands.
 */
export function stackNeed(below: Board, upper: Board): { need: number; under: { ref: string; h: number } | null } {
  const a = stackAlign(below, upper);
  const foot = upper.outline.map(([x, y]) => [x + a.dx, y + a.dy] as V2);
  let under: { ref: string; h: number } | null = null;
  for (const c of holderParts(below)) {
    if (c.hidden || c.side !== 'top' || c.h <= 0) continue;
    const shapes: Loop[] = [compRect(c)];
    let h = c.h;
    if (c.conn?.entry === 'edge') {
      // the plug in it, out along its axis
      const d: V2 = [Math.cos(rad(c.conn.angle)), Math.sin(rad(c.conn.angle))], n: V2 = [-d[1], d[0]], e = extentAlong(c, c.conn.angle), w = c.conn.plug.w / 2;
      const at = (s2: number, t: number): V2 => [c.x + d[0] * s2 + n[0] * t, c.y + d[1] * s2 + n[1] * t];
      shapes.push([at(e, -w), at(e + c.conn.plug.len, -w), at(e + c.conn.plug.len, w), at(e, w)]);
      h = Math.max(h, c.conn.zc + c.conn.plug.h / 2);
    }
    if ((!under || h > under.h) && shapes.some((q) => overlaps(q, foot))) under = { ref: c.ref, h: round(h, 1) };
  }
  // under the top board: its parts on that side, and the leads of its through-hole parts (about 1.6 mm)
  const beneath = Math.max(0, ...holderParts(upper).filter((c) => !c.hidden && c.side === 'bottom').map((c) => c.h), ...upper.comps.filter((c) => !c.hidden && c.side === 'top' && c.tht).map(() => 1.6));
  return { need: round((under?.h ?? 0) + beneath + 1, 1), under };
}

/** How long a bolted board's standoffs are: yours if you set it, else the shortest standard length that clears what is under it. */
export function stackGap(p: Project, m: Module): number {
  if (m.onGap != null) return m.onGap;
  const below = p.modules.find((x) => x.id === m.on);
  if (!below) return 11;
  const { need } = stackNeed(below.board, m.board);
  return STANDOFF_LENGTHS.find((s) => s >= need) ?? Math.ceil(need);
}

export interface StackLayer {
  mod: Module;
  dx: number; dy: number; // this layer's board frame in the base board's frame
  // boards screwed on top: offset in this layer's frame, dz = board bottom above this board's top; gap: its standoffs,
  // need and under: what they have to clear (see stackNeed)
  bolted: { mod: Module; dx: number; dy: number; dz: number; gap: number; need: number; under: { ref: string; h: number } | null; below: string }[];
}

/** A stack from its base: printed holder layers, each with the boards bolted onto it. */
export function stackLayers(p: Project, base: Module): StackLayer[] {
  const layers: StackLayer[] = [{ mod: base, dx: 0, dy: 0, bolted: [] }];
  let prev = base, px = 0, py = 0; // previous board and its offset in the current layer's frame
  let top = 0; // top of the previous board above the current layer board's top
  for (const r of ridersOf(p, base)) {
    // a column's holders stand edge on edge, not face on face: they are laid out with the dock (see columnOf)
    if (stackMode(p, r) === 'column') break;
    const a = stackAlign(prev.board, r.board);
    const L = layers[layers.length - 1];
    if (stackMode(p, r) === 'bolted') {
      const gap = stackGap(p, r), { need, under } = stackNeed(prev.board, r.board);
      const dz = top + gap;
      L.bolted.push({ mod: r, dx: px + a.dx, dy: py + a.dy, dz, gap, need, under, below: prev.board.name });
      px += a.dx; py += a.dy;
      top = dz + r.board.thickness;
    } else {
      layers.push({ mod: r, dx: L.dx + px + a.dx, dy: L.dy + py + a.dy, bolted: [] });
      px = 0; py = 0; top = 0;
    }
    prev = r;
  }
  return layers;
}

/** The boards standing on `base` in a column (each on its long edge on the holder below), bottom to top: empty when
 * nothing stands on it that way. */
export function columnOf(p: Project, base: Module): Module[] {
  const out: Module[] = [];
  for (const r of ridersOf(p, base)) {
    if (stackMode(p, r) !== 'column') break;
    out.push(r);
  }
  return out;
}

/** Boards bolted directly onto module m. */
export const boltedOn = (p: Project, m: Module) => p.modules.filter((x) => x.on === m.id && stackMode(p, x) === 'bolted');

/** Re-mark m's stacking standoffs after a stack changed (holes that line up with a board bolted on top). */
export function refreshStandoffs(p: Project, m: Module) {
  const g = new Map(detectHoleRoles(m.board, boltedOn(p, m).map((x) => x.board)).map((x) => [x.id, x]));
  for (const h of m.board.holes) {
    const x = g.get(h.id);
    if (!x) continue;
    if (x.role === 'standoff' || h.role === 'standoff') { h.role = x.role; h.why = x.why; }
  }
}
