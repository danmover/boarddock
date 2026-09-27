// Cable routing with collision checks. Every cable leaves its plug, gets clear of its own board, drops to its street
// (a lane between or beside the rails), runs along it and comes back up the same way at the other end. Each end has a
// few ways out (drop straight down, reach further out first, step sideways off a board that stands on edge, slope
// straight into a lane it faces, sidestep a sleeper); every combination is checked against the bounding boxes of
// the holders, boards, plugs, docks, rails and stands, and the shortest route that hits nothing wins.
// Rack frame: u along the rails, v across them, z up. Pure functions: no geometry kernel, no DOM.

export type Box = number[]; // [u0, v0, z0, u1, v1, z1]
export type SegKind = 'exit' | 'escape' | 'cross' | 'street';

export interface Obstacle {
  box: Box;
  label: string;
  module?: string; // the board it belongs to
  plug?: string; // "module/ref" when it is a plug
  stand?: boolean; // table stand piece: streets run through their combs
}

export interface CableEnd {
  p: number[]; // where the cable leaves the plug
  d: number[]; // the plug's axis, outward (unit)
  module: string;
  plug: string; // "module/ref"
}

export interface Route { pts: number[][]; kinds: SegKind[] } // kinds[i]: the segment pts[i] -> pts[i + 1]

export interface Hit { ob: Obstacle; at: number[]; depth: number; best?: number }

/** Part of segment p->q inside box b grown by pad (slab method): [t0, t1] in 0..1, or null. */
export function segInBox(p: number[], q: number[], b: Box, pad: number): [number, number] | null {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = q[k] - p[k], lo = b[k] - pad, hi = b[k + 3] + pad;
    if (Math.abs(d) < 1e-9) { if (p[k] < lo || p[k] > hi) return null; continue; }
    let a = (lo - p[k]) / d, c = (hi - p[k]) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

const add = (a: number[], b: number[], s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const routeLength = (r: Route) => r.pts.reduce((s, q, i) => (i ? s + dist(q, r.pts[i - 1]) : 0), 0);

/**
 * What a route runs into. The cable's own plugs never count; its own board only counts once the cable is clear of
 * the plug (from the second segment on); stands never count along a street (the cable lies in their combs there).
 * Touching counts only past `slack` mm of overlap, so a cable brushing a box edge is not a clash.
 */
export function hits(r: Route, obs: Obstacle[], ends: CableEnd[], radius: number, slack = 0.8): Hit[] {
  const own = new Set(ends.map((e) => e.plug)), mods = new Set(ends.map((e) => e.module));
  const out = new Map<Obstacle, Hit & { best: number }>();
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const p = r.pts[i], q = r.pts[i + 1], kind = r.kinds[i], L = dist(p, q);
    if (L < 1e-6) continue;
    // the first and last segments leave a plug: its own board and holder are allowed there
    const exitSeg = kind === 'exit';
    for (const ob of obs) {
      if (ob.plug && own.has(ob.plug)) continue;
      if (exitSeg && ob.module && mods.has(ob.module)) continue;
      if (kind === 'street' && ob.stand) continue;
      const t = segInBox(p, q, ob.box, radius - slack);
      if (!t) continue;
      const depth = (t[1] - t[0]) * L;
      if (depth < 0.5) continue;
      // depth adds up over every segment that runs through it; the marker goes where it runs deepest
      const prev = out.get(ob), at = add(p, [q[0] - p[0], q[1] - p[1], q[2] - p[2]], (t[0] + t[1]) / 2);
      out.set(ob, { ob, at: !prev || depth > prev.best ? at : prev.at, depth: (prev?.depth ?? 0) + depth, best: Math.max(prev?.best ?? 0, depth) });
    }
  }
  return [...out.values()];
}

/** Ways out of a plug to the street level zc: each ends with the drop column reaching zc. */
export function escapes(e: CableEnd, own: Box | null, zc: number, radius: number, stations: number[] = []): Route[] {
  const p1 = add(e.p, e.d, 14);
  const out: Route[] = [];
  const drop = (pts: number[][]): Route => {
    const last = pts[pts.length - 1];
    const all = [e.p, ...pts, [last[0], last[1], zc]];
    return { pts: all, kinds: all.slice(1).map((_, i) => (i === 0 ? 'exit' : 'escape') as SegKind) };
  };
  if (Math.abs(e.d[2]) < 0.7) {
    out.push(drop([p1]));
    out.push(drop([p1, add(p1, e.d, 18)]));
    // a plug facing something close (the next dock along the rail): out a little, then off to one side and down
    const h = Math.hypot(e.d[0], e.d[1]) || 1, side = [-e.d[1] / h, e.d[0] / h, 0], p0 = add(e.p, e.d, 5);
    for (const s of [1, -1]) for (const k of [14, 28, 44]) out.push(drop([p0, add(p0, side, s * k)]));
  } else {
    // a plug pointing up or down: go straight, or step off the board sideways at the plug's height first (just
    // clear of it, or a little further, past what stands off its face: a probe's ribbon socket)
    out.push(drop([p1]));
    if (own) for (const [k, s] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) {
      const edge = s > 0 ? own[k + 3] : own[k];
      const need = (edge - p1[k]) * s + radius + 3;
      if (need <= 0 || need > 90) continue;
      for (const more of [0, 12]) { const q = [...p1]; q[k] += s * (need + more); out.push(drop([p1, q])); }
    }
  }
  // a drop column that lands on a sleeper steps along the rail before it goes down
  const more: Route[] = [];
  for (const r of out) {
    const col = r.pts[r.pts.length - 1];
    const hit = stations.find((u) => Math.abs(col[0] - u) < 8);
    if (hit == null) continue;
    for (const s of [1, -1]) {
      const top = r.pts[r.pts.length - 2], moved = [hit + s * 11, top[1], top[2]];
      const pts = [...r.pts.slice(0, -1), moved, [moved[0], moved[1], zc]];
      more.push({ pts, kinds: pts.slice(1).map((_, i) => (i === 0 ? 'exit' : 'escape') as SegKind) });
    }
  }
  return [...out, ...more];
}

/** A full route: end A's way out, across to the lane, along it, and end B's way out backwards. A sideways plug
 * that faces the lane can slope straight into it instead of dropping first. */
export function assemble(a: Route, b: Route, lane: number, zc: number): Route {
  const pts: number[][] = [], kinds: SegKind[] = [];
  const push = (q: number[], k: SegKind) => { if (pts.length && dist(pts[pts.length - 1], q) < 0.3) return; if (pts.length) kinds.push(k); pts.push(q); };
  a.pts.forEach((q, i) => push(q, i === 0 ? 'exit' : a.kinds[i - 1]));
  const ca = a.pts[a.pts.length - 1], cb = b.pts[b.pts.length - 1];
  push([ca[0], lane, zc], 'cross');
  push([cb[0], lane, zc], 'street');
  push([cb[0], cb[1], zc], 'cross');
  for (let i = b.pts.length - 2; i >= 0; i--) push(b.pts[i], b.kinds[i]);
  return { pts, kinds };
}

/** Slope variant: a plug whose axis points across the rails toward the lane goes straight down into it. */
export function slope(e: CableEnd, lane: number, zc: number): Route | null {
  if (Math.abs(e.d[1]) < 0.5 || (lane - e.p[1]) * e.d[1] < 24) return null;
  const p1 = add(e.p, e.d, 14);
  return { pts: [e.p, p1, [p1[0], lane, zc]], kinds: ['exit', 'escape'] };
}

export interface Choice { route: Route; street: number; hits: Hit[]; len: number; score: number; ea: Route | 'slope'; eb: Route | 'slope'; direct?: boolean } // direct: straight across, no street (street = -1)

/**
 * Best route for one cable over the given streets (v of each). Score: length, plus 300 per obstacle hit and 4 per
 * millimetre inside one, plus a small charge for streets on the far side of a sideways plug.
 */
export function bestRoute(A: CableEnd, B: CableEnd, streets: number[], zc: number, radius: number, obs: Obstacle[], ownA: Box | null, ownB: Box | null, stations: number[]): Choice | null {
  const escA = escapes(A, ownA, zc, radius, stations), escB = escapes(B, ownB, zc, radius, stations);
  const a1 = add(A.p, A.d, 14), b1 = add(B.p, B.d, 14);
  const behind = (p: number[], d: number[], c: number) => (Math.abs(d[1]) > 0.5 && (c - p[1]) * d[1] < -5 ? 60 : 0);
  const order = streets.map((c, k) => ({ k, c, cost: Math.abs(a1[1] - c) + Math.abs(b1[1] - c) + behind(a1, A.d, c) + behind(b1, B.d, c) })).sort((x, y) => x.cost - y.cost).slice(0, 3);
  let best: Choice | null = null;
  for (const { k, c, cost } of order) {
    const sa = slope(A, c, zc), sb = slope(B, c, zc);
    for (const ea of sa ? [sa, ...escA] : escA) for (const eb of sb ? [sb, ...escB] : escB) {
      const route = assemble(ea, eb, c, zc);
      const len = routeLength(route);
      const h = hits(route, obs, [A, B], radius);
      const score = len + cost * 0.2 + h.length * 300 + h.reduce((s, x) => s + x.depth, 0) * 4;
      if (!best || score < best.score) best = { route, street: k, hits: h, len, score, ea: ea === sa ? 'slope' : ea, eb: eb === sb ? 'slope' : eb };
    }
  }
  return best;
}

/** A ribbon's end: a cable end, plus its socket's long side (the ribbon's width lies along it) and its depth across.
 * `straight`: a bundle of jumper wires instead, leaving its housings straight out. */
export interface RibbonEnd extends CableEnd { w: number[]; span: number; straight?: boolean }

export interface RibbonChoice extends Choice { free: [number, number] } // free: the stretch (mm along it) where it hangs free

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: number[]) => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / L); };

/**
 * A flat ribbon from one IDC socket to another, the way one is really laid: it leaves each socket flat over its top,
 * square to the socket's long side, and lies along its board. Then either it loops over the top from one board to
 * the other, high enough to clear everything between them and whatever is in `above` (earlier ribbons, cables rising
 * from plugs) so ribbons nest rather than cross; or it folds along its board and goes round one end of the two
 * (`ownA`, `ownB`: their envelopes), at the height of the sockets, outside the ribbons already there. The shortest
 * that hits nothing wins.
 */
export function ribbonRoute(A: RibbonEnd, B: RibbonEnd, t: number, rw: number, obs: Obstacle[], above: Box[] = [], ownA: Box | null = null, ownB: Box | null = null): RibbonChoice {
  const R = 7;
  // leave the socket flat along x (the way `pref` points where it can, else up, else towards the other end)
  const lay = (e: RibbonEnd, other: number[], pref: number[] | null) => {
    // jumper wires leave their housings straight out, then bend
    if (e.straight) return { x: unit(e.d), S: e.p, E: add(e.p, e.d, 4) };
    let x = unit(cross(e.d, e.w));
    const k = pref ? x[0] * pref[0] + x[1] * pref[1] + x[2] * pref[2] : 0;
    if (pref && Math.abs(k) > 0.3 ? k < 0 : Math.abs(x[2]) > 0.3 ? x[2] < 0 : (other[0] - e.p[0]) * x[0] + (other[1] - e.p[1]) * x[1] < 0) x = x.map((q) => -q);
    const base = add(e.p, e.d, t / 2 - 0.6); // on the socket's cable clamp
    return { x, S: add(base, x, -e.span / 2), E: add(base, x, e.span / 2 + 2) }; // S: its cut end, at the socket's far side
  };
  const cands: { pts: number[][]; iA: number; iB: number }[] = [];
  // over the top: up (after a fold, or a bend on a board lying flat, if it left sideways), across, down
  {
    const a = lay(A, B.p, [0, 0, 1]), b = lay(B, A.p, [0, 0, 1]);
    const foot = (q: typeof a) => (q.x[2] > 0.7 ? q.E : add(q.E, q.x, 3));
    const fa = foot(a), fb = foot(b);
    const pad = rw / 2 + 2;
    const u0 = Math.min(fa[0], fb[0]) - pad, u1 = Math.max(fa[0], fb[0]) + pad, v0 = Math.min(fa[1], fb[1]) - pad, v1 = Math.max(fa[1], fb[1]) + pad;
    let Z = Math.max(fa[2], fb[2]) + R;
    for (const box of [...obs.map((o) => o.box), ...above]) if (!(box[3] < u0 || box[0] > u1 || box[4] < v0 || box[1] > v1)) Z = Math.max(Z, box[5] + 3 + t / 2 + R * 0.3);
    const col = (q: typeof a) => (q.x[2] > 0.7 ? add(q.E, q.x, (Z - q.E[2]) / q.x[2]) : [foot(q)[0], foot(q)[1], Z]);
    const pa = [a.S, a.E, ...(a.x[2] > 0.7 ? [] : [fa]), col(a)], pb = [col(b), ...(b.x[2] > 0.7 ? [] : [fb]), b.E, b.S];
    cands.push({ pts: [...pa, ...pb], iA: pa.length - 1, iB: pa.length });
  }
  // round either end, a ribbon's width further out for each try (outside the ones already there)
  if (ownA && ownB) for (const sg of [1, -1]) for (let k = 0; k < 3; k++) {
    const uS = sg > 0 ? Math.max(ownA[3], ownB[3]) + rw / 2 + 3 + k * (rw + 2) : Math.min(ownA[0], ownB[0]) - rw / 2 - 3 - k * (rw + 2);
    const a = lay(A, B.p, [sg, 0, 0]), b = lay(B, A.p, [sg, 0, 0]);
    const fa = add(a.E, a.x, 3), fb = add(b.E, b.x, 3);
    const pa = [a.S, a.E, fa, [uS, fa[1], fa[2]]], pb = [[uS, fb[1], fb[2]], fb, b.E, b.S];
    cands.push({ pts: [...pa, ...pb], iA: pa.length - 1, iB: pa.length });
  }
  let best: RibbonChoice | null = null;
  for (const { pts, iA, iB } of cands) {
    // along each board it may touch its own holder (it lies on it); between them it has to clear everything
    const kinds = pts.slice(1).map((_, i) => (i < iA || i >= iB ? 'exit' : 'escape') as SegKind);
    const route: Route = { pts, kinds };
    const len = routeLength(route), h = hits(route, obs, [A, B], 1.2);
    const score = len + h.length * 300 + h.reduce((q, x2) => q + x2.depth, 0) * 4;
    if (best && score >= best.score) continue;
    const lenTo = (k: number) => pts.slice(1, k + 1).reduce((q, p2, i) => q + dist(p2, pts[i]), 0);
    best = { route, street: -1, hits: h, len, score, ea: route, eb: route, direct: true, free: [lenTo(iA) - R, lenTo(iB) + R] };
  }
  return best!;
}
