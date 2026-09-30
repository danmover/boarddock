// Cable routing with collision checks. Every cable leaves its plug, gets clear of its own board, drops to its street
// (a lane between or beside the rails), runs along it and comes back up the same way at the other end. Each end has a
// few ways out (drop straight down, reach further out first, step sideways off a board that stands on edge, slope
// straight into a lane it faces, sidestep a sleeper); every combination is checked against the bounding boxes of
// the holders, boards, plugs, docks, rails and stands, and the shortest route that hits nothing wins.
// Rack frame: u along the rails, v across them, z up. Pure functions: no geometry kernel, no DOM.
import type { MeshData } from '../model/types';

export type Box = number[]; // [u0, v0, z0, u1, v1, z1]
export type SegKind = 'exit' | 'escape' | 'cross' | 'street';

export interface Obstacle {
  box: Box;
  label: string;
  module?: string; // the board it belongs to
  plug?: string; // "module/ref" when it is a plug
  stand?: boolean; // table stand piece: streets run through their combs
  solid?: boolean; // a rail or stand piece: fills its box (the settled cable may not brush it; the router still allows the usual slack along a stand)
  src?: { mesh: MeshData; T: number[] }; // the part's own shape (and where it is), to confirm a clash with
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

/** How far a cable runs straight out of its plug before it bends: past the plug's boot, then room for a bend of about
 * four diameters (a cable bent tighter right at the plug looks and is wrong). */
export const lead = (radius: number) => Math.max(14, 10 + 8 * radius);
/** The radius a cable's bends are drawn with (about four diameters): see filletPath. */
export const bendRadius = (radius: number) => Math.min(25, Math.max(10, 8 * radius));
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
    // the first and last segments leave a plug: its own board and holder are allowed there (its board's other plugs
    // are not: a J-Link's ribbon can't lie through its own USB plug)
    const exitSeg = kind === 'exit';
    for (const ob of obs) {
      if (ob.plug && own.has(ob.plug)) continue;
      if (exitSeg && ob.module && mods.has(ob.module) && !ob.plug) continue;
      if (kind === 'street' && ob.stand) continue;
      const t = segInBox(p, q, ob.box, radius - (ob.solid && !ob.stand ? 0.1 : slack));
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
  const p1 = add(e.p, e.d, lead(radius));
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
    const h = Math.hypot(e.d[0], e.d[1]) || 1, side = [-e.d[1] / h, e.d[0] / h, 0], p0 = add(e.p, e.d, Math.max(5, lead(radius) / 2));
    for (const s of [1, -1]) for (const k of [14, 28, 44]) out.push(drop([p0, add(p0, side, s * k)]));
  } else {
    // a plug pointing up or down: go straight, or step off the board sideways at the plug's height first (just
    // clear of it, or a little further, past what stands off its face: a probe's ribbon socket)
    out.push(drop([p1]));
    if (own) for (const [k, s] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) {
      const edge = s > 0 ? own[k + 3] : own[k];
      const need = (edge - p1[k]) * s + radius + 3;
      if (need <= 0 || need > 90) continue;
      // (at least a U-turn's width: up out of the plug and back down is a bend of four diameters each way)
      for (const more of [0, 12]) { const q = [...p1]; q[k] += s * Math.max(need + more, 16 * radius + more); out.push(drop([p1, q])); }
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
 * Best route for one cable over the given streets (v of each). `others`: where the cables routed before it drop and rise
 * (each one's own place in the air). Score: length, plus 300 per obstacle hit and 4 per
 * millimetre inside one, plus a small charge for streets on the far side of a sideways plug.
 */
export function bestRoute(A: CableEnd, B: CableEnd, streets: number[], zc: number, radius: number, obs: Obstacle[], ownA: Box | null, ownB: Box | null, stations: number[], others: Obstacle[] = []): Choice | null {
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
      const h = hits(route, others.length ? [...obs, ...others] : obs, [A, B], radius);
      // (its two columns close together: the cable would lie against itself, and no tag ring would go round one leg)
      const ca = ea.pts[ea.pts.length - 1], cb = eb.pts[eb.pts.length - 1];
      const close = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < 2 * radius + 6 && Math.abs(ca[2] - cb[2]) < 1 ? 300 : 0;
      const score = len + cost * 0.2 + h.length * 300 + h.reduce((s, x) => s + x.depth, 0) * 4 + close;
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

/** How far (mm) a ribbon rising off a sideways socket may stand off the board's face first, to clear what is just above it. */
const JOGS = [6, 12];

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
    const base = add(e.p, e.d, t / 2 - 0.25); // on the socket's cable clamp (its underside on the board's face, not sunk in it)
    return { x, S: add(base, x, -e.span / 2), E: add(base, x, e.span / 2 + 2) }; // S: its cut end, at the socket's far side
  };
  const cands: { pts: number[][]; iA: number; iB: number }[] = [];
  // over the top: up (after a fold, or a bend on a board lying flat, if it left sideways), across, down. A ribbon that
  // rises off a socket facing sideways may first stand off the board's face a little (`JOGS`), to clear what stands
  // out of the board just above the socket (the housings of a header's jumper wires)
  {
    const a = lay(A, B.p, [0, 0, 1]), b = lay(B, A.p, [0, 0, 1]);
    const foot = (q: typeof a) => (q.x[2] > 0.7 ? q.E : add(q.E, q.x, 3));
    const fa = foot(a), fb = foot(b);
    const pad0 = rw / 2 + 2;
    const heightFor = (j: number) => {
      const pad = pad0 + j;
      const u0 = Math.min(fa[0], fb[0]) - pad, u1 = Math.max(fa[0], fb[0]) + pad, v0 = Math.min(fa[1], fb[1]) - pad, v1 = Math.max(fa[1], fb[1]) + pad;
      let Z = Math.max(fa[2], fb[2]) + R;
      for (const box of [...obs.map((o) => o.box), ...above]) if (!(box[3] < u0 || box[0] > u1 || box[4] < v0 || box[1] > v1)) Z = Math.max(Z, box[5] + 3 + t / 2 + R * 0.3);
      return Z;
    };
    const col = (q: typeof a, E: number[], Z: number) => (q.x[2] > 0.7 ? add(E, q.x, (Z - E[2]) / q.x[2]) : [foot(q)[0], foot(q)[1], Z]);
    const canJog = (q: typeof a, c: RibbonEnd) => q.x[2] > 0.7 && Math.abs(c.d[2]) < 0.7 && !c.straight;
    const stand = (q: typeof a, c: RibbonEnd, j: number) => (j ? add(q.E, unit([c.d[0], c.d[1], 0]), j) : q.E);
    for (const ja of [0, ...JOGS]) for (const jb of [0, ...JOGS]) {
      if ((ja && !canJog(a, A)) || (jb && !canJog(b, B))) continue;
      const Ea = stand(a, A, ja), Eb = stand(b, B, jb), Z = heightFor(Math.max(ja, jb));
      const pa = [a.S, a.E, ...(ja ? [Ea] : []), ...(a.x[2] > 0.7 ? [] : [fa]), col(a, Ea, Z)], pb = [col(b, Eb, Z), ...(b.x[2] > 0.7 ? [] : [fb]), ...(jb ? [Eb] : []), b.E, b.S];
      cands.push({ pts: [...pa, ...pb], iA: pa.length - 1, iB: pa.length });
    }
  }
  // round either end, a ribbon's width further out for each try (outside the ones already there)
  if (ownA && ownB) for (const sg of [1, -1]) for (let k = 0; k < 3; k++) {
    const a = lay(A, B.p, [sg, 0, 0]), b = lay(B, A.p, [sg, 0, 0]);
    const fa = add(a.E, a.x, 3), fb = add(b.E, b.x, 3);
    // (and no nearer than where an end has already come out to: an adapter's jumper housings stick out past its
    // holder, and going round inside them doubled the wires back over their own housings)
    const uS = sg > 0 ? Math.max(Math.max(ownA[3], ownB[3]) + rw / 2 + 3, fa[0], fb[0]) + k * (rw + 2) : Math.min(Math.min(ownA[0], ownB[0]) - rw / 2 - 3, fa[0], fb[0]) - k * (rw + 2);
    const pa = [a.S, a.E, fa, [uS, fa[1], fa[2]]], pb = [[uS, fb[1], fb[2]], fb, b.E, b.S];
    cands.push({ pts: [...pa, ...pb], iA: pa.length - 1, iB: pa.length });
  }
  let best: RibbonChoice | null = null;
  // (whether a leg runs straight out of a plug, or straight into it)
  const outOf = (p: number[], q: number[], d: number[]) => { const v = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(v[0], v[1], v[2]); return L < 1e-6 || (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / L > 0.99; };
  for (const { pts, iA, iB } of cands) {
    // along each board it may touch its own holder (it lies on it); between them it has to clear everything
    const kinds = pts.slice(1).map((_, i) => (i < iA || i >= iB ? 'exit' : 'escape') as SegKind);
    const route: Route = { pts, kinds };
    // jumper wires lie on nothing: only where they leave their housings straight out; where they turn, their own
    // board is in the way like any other (going round the end along the rail went through a board that faces along it)
    const strict = kinds.map((k, i) => (k === 'escape' || (i < iA ? !A.straight || outOf(pts[i], pts[i + 1], A.d) : !B.straight || outOf(pts[i + 1], pts[i], B.d)) ? k : 'escape'));
    const len = routeLength(route), h = hits({ pts, kinds: strict }, obs, [A, B], 1.2);
    const score = len + h.length * 300 + h.reduce((q, x2) => q + x2.depth, 0) * 4;
    if (best && score >= best.score) continue;
    const lenTo = (k: number) => pts.slice(1, k + 1).reduce((q, p2, i) => q + dist(p2, pts[i]), 0);
    best = { route, street: -1, hits: h, len, score, ea: route, eb: route, direct: true, free: [lenTo(iA) - R, lenTo(iB) + R] };
  }
  return best!;
}

interface Run { n: number; i: number; head: boolean; u: number; vc: number; vl: number; r: number; x: number }

/**
 * Cables that cross the rails run along v at the u of their plug's drop column, and two plugs' columns can be a few
 * millimetres apart: the cables would run on top of each other under the rails (8 mm of room: nothing lies over
 * another there). Every run along v (`cross`) that shares its stretch of v with another closer than the two cables
 * are wide is moved sideways, the runs of a cluster spread to the least total move that keeps them a gap apart and
 * out of the stand blocks and whatever else stands at the cable's height; the cable eases over with a slant, so its
 * column stays where its plug is. Edits the routes in place.
 */
export function spreadCrossings(items: { route: Route; d: number; zc: number }[], obs: Obstacle[], gap = 2.4): void {
  const runs: Run[] = [];
  items.forEach(({ route: { pts, kinds }, d, zc }, n) => {
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] !== 'cross') continue;
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a[2] - zc) > 0.01 || Math.abs(b[2] - zc) > 0.01 || Math.abs(a[0] - b[0]) > 0.01 || Math.abs(a[1] - b[1]) < 4) continue;
      const head = kinds[i + 1] === 'street', tail = kinds[i - 1] === 'street';
      if (head === tail) continue;
      const col = head ? a : b, lane = head ? b : a;
      runs.push({ n, i, head, u: col[0], vc: col[1], vl: lane[1], r: d / 2, x: col[0] });
    }
  });
  if (runs.length < 2) return;
  const lo = (q: Run) => Math.min(q.vc, q.vl), hi = (q: Run) => Math.max(q.vc, q.vl);
  const pitch = (p: Run, q: Run) => p.r + q.r + gap;
  // clusters: runs that share some of v and are closer in u than the two are wide (and a little more, so that a run
  // moved over does not land on one that was clear before): regrouped from where they lie now, a few times
  const clusters = () => {
    const parent = runs.map((_, k) => k);
    const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    for (let p = 0; p < runs.length; p++) for (let q = p + 1; q < runs.length; q++) {
      if (runs[p].n === runs[q].n) continue;
      if (Math.min(hi(runs[p]), hi(runs[q])) - Math.max(lo(runs[p]), lo(runs[q])) > 3 && Math.abs(runs[p].x - runs[q].x) < pitch(runs[p], runs[q]) + 8) parent[find(p)] = find(q);
    }
    const groups = new Map<number, number[]>();
    runs.forEach((_, k) => { const g = find(k); (groups.get(g) ?? groups.set(g, []).get(g)!).push(k); });
    return groups;
  };
  // the slant that eases a run over to x: the column stays, the run starts a little way along
  const slant = (q: Run, x: number) => [x, q.vc + Math.sign(q.vl - q.vc) * Math.min(Math.abs(q.vl - q.vc) * 0.6, 1.2 * Math.abs(x - q.u) + 6), items[q.n].zc];
  const STAND_ROOM = 12; // a run keeps this far from a stand piece: the cables that cross it there need room to go over each other
  // where a run may lie: at its height, clear of everything standing there along its stretch of v and along its slant
  const free = (q: Run, x: number) => {
    const zc = items[q.n].zc, s = slant(q, x), from = [q.u, q.vc, zc];
    return !obs.some((o) => o.box[2] < zc + q.r - 0.2 && o.box[5] > zc - q.r && ((o.box[1] < hi(q) - 1 && o.box[4] > lo(q) + 1 && o.box[0] < x + q.r + (o.stand ? STAND_ROOM : 0.3) && o.box[3] > x - q.r - (o.stand ? STAND_ROOM : 0.3)) || (x !== q.u && segInBox(from, s, o.box, q.r + 0.3))));
  };
  const STEP = 0.5, REACH = 60;
  let moved = true;
  for (let pass = 0; pass < 3 && moved; pass++) for (const g of (moved = false, clusters()).values()) {
    if (g.length < 2 && free(runs[g[0]], runs[g[0]].x)) continue; // (a run on its own moves only if it lies in a stand block)
    const rs = g.map((k) => runs[k]).sort((p, q) => p.x - q.x || lo(p) - lo(q));
    // least total move with every neighbour a pitch apart, over the positions where the cable can lie
    const cand = rs.map((q) => { const c: number[] = []; for (let s = -REACH; s <= REACH; s += STEP) if (free(q, q.u + s)) c.push(q.u + s); return c; });
    if (cand.some((c) => !c.length)) continue;
    const cost = cand.map((c) => c.map(() => Infinity)), from = cand.map((c) => c.map(() => -1));
    cand[0].forEach((x, a) => { cost[0][a] = Math.abs(x - rs[0].u); });
    for (let k = 1; k < rs.length; k++) {
      const need = pitch(rs[k - 1], rs[k]);
      let bi = -1, j = 0;
      cand[k].forEach((x, a) => {
        while (j < cand[k - 1].length && cand[k - 1][j] <= x - need + 1e-9) { if (bi < 0 || cost[k - 1][j] < cost[k - 1][bi]) bi = j; j++; }
        if (bi >= 0) { cost[k][a] = cost[k - 1][bi] + Math.abs(x - rs[k].u); from[k][a] = bi; }
      });
    }
    let a = -1;
    const last = rs.length - 1;
    cost[last].forEach((c, k) => { if (c < Infinity && (a < 0 || c < cost[last][a])) a = k; });
    if (a < 0) continue;
    for (let k = last; k >= 0; k--) { if (Math.abs(rs[k].x - cand[k][a]) > 0.05) moved = true; rs[k].x = cand[k][a]; a = from[k][a]; }
  }
  // the moved runs: the column stays, a slant eases over to the new line, the run goes along it
  const edits = new Map<number, Map<number, Run>>();
  for (const q of runs) if (Math.abs(q.x - q.u) > 0.4) (edits.get(q.n) ?? edits.set(q.n, new Map()).get(q.n)!).set(q.i, q);
  for (const [n, es] of edits) {
    const { route, zc } = items[n], P = route.pts, K = route.kinds, pts: number[][] = [], kinds: SegKind[] = [];
    const push = (p: number[], k: SegKind | null) => { if (pts.length && k) kinds.push(k); pts.push(p); };
    P.forEach((p0, i) => {
      const before = es.get(i - 1), here = es.get(i);
      let p = p0;
      if ((before && before.head) || (here && !here.head)) { const q = (before && before.head ? before : here)!; p = [q.x, q.vl, zc]; }
      if (before && !before.head) { push(slant(before, before.x), K[i - 1]); push(p, 'cross'); } else push(p, i ? K[i - 1] : null);
      if (here && here.head) push(slant(here, here.x), 'cross');
    });
    route.pts = pts;
    route.kinds = kinds;
  }
}

