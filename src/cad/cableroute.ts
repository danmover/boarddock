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
  } else {
    // a plug pointing up or down: go straight, or step off the board sideways at the plug's height first
    out.push(drop([p1]));
    if (own) for (const [k, s] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) {
      const edge = s > 0 ? own[k + 3] : own[k];
      const need = (edge - p1[k]) * s + radius + 3;
      if (need <= 0 || need > 90) continue;
      const q = [...p1]; q[k] += s * need;
      out.push(drop([p1, q]));
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

/**
 * Short ways across for a cable that stays by its boards instead of going down to a street (a probe's ribbon to the
 * board beside it): out of each plug, then over the top of both boards, round either end of them, round either side,
 * or straight across. The one that is shortest and hits least wins; `own` is the two ends' boards together.
 */
export function directRoute(A: CableEnd, B: CableEnd, radius: number, obs: Obstacle[], ownA: Box | null, ownB: Box | null): Choice | null {
  // a ribbon bends flat right behind its plug, once it is clear of its own board and holder
  const out = (e: CableEnd, ob: Box | null) => {
    let t = 5;
    if (ob && [0, 1, 2].every((k) => e.p[k] > ob[k] - 0.1 && e.p[k] < ob[k + 3] + 0.1)) {
      const k = [0, 1, 2].reduce((m, j) => (Math.abs(e.d[j]) > Math.abs(e.d[m]) ? j : m), 0);
      t = Math.min(30, Math.max(t, ((e.d[k] > 0 ? ob[k + 3] : ob[k]) - e.p[k]) / e.d[k] + radius + 1));
    }
    return add(e.p, e.d, t);
  };
  const a1 = out(A, ownA), b1 = out(B, ownB);
  const own = ownA && ownB ? [0, 1, 2].map((k) => Math.min(ownA[k], ownB[k])).concat([0, 1, 2].map((k) => Math.max(ownA[k + 3], ownB[k + 3]))) : ownA ?? ownB;
  const box = own ?? [Math.min(a1[0], b1[0]), Math.min(a1[1], b1[1]), Math.min(a1[2], b1[2]), Math.max(a1[0], b1[0]), Math.max(a1[1], b1[1]), Math.max(a1[2], b1[2])];
  const clear = radius + 6;
  const mk = (mid: number[][]): Route => {
    const pts = [A.p, a1, ...mid, b1, B.p];
    return { pts, kinds: pts.slice(1).map((_, i) => (i === 0 || i === pts.length - 2 ? 'exit' : 'escape') as SegKind) };
  };
  // across at a height: from the lower plug up to over both boards, every 6 mm (the lowest that is clear wins), straight
  // across or in two legs (across the rail first, or along it first)
  const zs: number[] = [];
  for (let z = Math.min(a1[2], b1[2]); z < box[5] + clear; z += 6) zs.push(z);
  zs.push(Math.max(box[5], a1[2], b1[2]) + clear);
  const cands: Route[] = [mk([])];
  for (const z of zs) {
    const up = [a1[0], a1[1], z], down = [b1[0], b1[1], z];
    cands.push(mk([up, down]), mk([up, [a1[0], b1[1], z], down]), mk([up, [b1[0], a1[1], z], down]));
  }
  for (const u of [box[0] - clear, box[3] + clear]) cands.push(mk([[u, a1[1], a1[2]], [u, b1[1], b1[2]]]));
  for (const v of [box[1] - clear, box[4] + clear]) cands.push(mk([[a1[0], v, a1[2]], [b1[0], v, b1[2]]]));
  let best: Choice | null = null;
  for (const route of cands) {
    const len = routeLength(route), h = hits(route, obs, [A, B], radius);
    const score = len + h.length * 300 + h.reduce((q, x) => q + x.depth, 0) * 4;
    if (!best || score < best.score) best = { route, street: -1, hits: h, len, score, ea: route, eb: route, direct: true };
  }
  return best;
}
