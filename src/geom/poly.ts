// Plain 2D geometry helpers (no WASM). Loops are arrays of [x, y].
import type { Loop, V2, Comp } from '../model/types';

export const TAU = Math.PI * 2;
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export function area(p: Loop): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return -a / 2; // positive for counter-clockwise
}

export function ccw(p: Loop): Loop {
  return area(p) < 0 ? [...p].reverse() : p;
}

export function bbox(pts: V2[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function centroid(p: Loop): V2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f;
    cx += (p[j][0] + p[i][0]) * f;
    cy += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = bbox(p);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function inside(pt: V2, p: Loop): boolean {
  let c = false;
  const [x, y] = pt;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Distance from a point to a segment, plus the closest point. */
export function segDist(p: V2, a: V2, b: V2): { d: number; q: V2; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q: V2 = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q, t };
}

/** Closest point on a loop boundary: distance, point, outward normal (for a CCW loop) and segment index. */
export function nearestEdge(pt: V2, p: Loop): { d: number; q: V2; n: V2; i: number } {
  let best = { d: Infinity, q: [0, 0] as V2, n: [0, 1] as V2, i: 0 };
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const s = segDist(pt, a, b);
    if (s.d < best.d) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      best = { d: s.d, q: s.q, n: [(b[1] - a[1]) / L, -(b[0] - a[0]) / L], i };
    }
  }
  return best;
}

/** Distance along direction `dir` from `pt` to where the ray leaves the loop (Infinity if it never hits). */
export function rayExit(pt: V2, dir: V2, p: Loop): number {
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - pt[0]) * ey - (a[1] - pt[1]) * ex) / den;
    const s = ((a[0] - pt[0]) * dir[1] - (a[1] - pt[1]) * dir[0]) / den;
    if (t > -1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

/** Corners of a component body rectangle in the board frame. */
export function compRect(c: Pick<Comp, 'x' | 'y' | 'w' | 'l' | 'rot'>, grow = 0): Loop {
  const a = rad(c.rot), ca = Math.cos(a), sa = Math.sin(a);
  const hw = c.w / 2 + grow, hl = c.l / 2 + grow;
  return ([[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]] as V2[]).map(([u, v]) => [c.x + u * ca - v * sa, c.y + u * sa + v * ca] as V2);
}

/** Half-extent of a component body along a board-frame direction (degrees). */
export function extentAlong(c: Pick<Comp, 'w' | 'l' | 'rot'>, angDeg: number): number {
  const a = rad(angDeg - c.rot);
  return Math.abs((c.w / 2) * Math.cos(a)) + Math.abs((c.l / 2) * Math.sin(a));
}

export function rectLoop(x0: number, y0: number, x1: number, y1: number): Loop {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export function circleLoop(cx: number, cy: number, r: number, n = 48): Loop {
  const out: Loop = [];
  for (let i = 0; i < n; i++) out.push([cx + r * Math.cos((TAU * i) / n), cy + r * Math.sin((TAU * i) / n)]);
  return out;
}

export function roundedRectLoop(w: number, h: number, r: number, n = 8): Loop {
  r = Math.max(0, Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6));
  if (r <= 0) return rectLoop(-w / 2, -h / 2, w / 2, h / 2);
  const out: Loop = [];
  const cs: V2[] = [[w / 2 - r, -h / 2 + r], [w / 2 - r, h / 2 - r], [-w / 2 + r, h / 2 - r], [-w / 2 + r, -h / 2 + r]];
  cs.forEach(([cx, cy], k) => {
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 2 + (i * Math.PI) / 2 / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  });
  return out;
}

/** Tessellate an arc from start angle a0 sweeping `sweep` radians. Includes both ends. */
export function arcPts(cx: number, cy: number, r: number, a0: number, sweep: number, maxSeg = 0.4): V2[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep * r) / maxSeg), Math.ceil(Math.abs(sweep) / (TAU / 72)));
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Arc through three points. */
export function arc3(p0: V2, pm: V2, p1: V2): V2[] {
  const [ax, ay] = p0, [bx, by] = pm, [cx, cy] = p1;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [p0, p1];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  // sweep counter-clockwise from a0 to a1; if the midpoint is not on that path go clockwise
  const ccwSweep = norm(a1 - a0), mid = norm(am - a0);
  const sweep = mid <= ccwSweep ? ccwSweep : ccwSweep - TAU;
  return arcPts(ux, uy, r, a0, sweep);
}

/** Arc from centre, start point and signed sweep (degrees, CCW positive). */
export function arcCenter(c: V2, start: V2, sweepDeg: number): V2[] {
  const r = Math.hypot(start[0] - c[0], start[1] - c[1]);
  const a0 = Math.atan2(start[1] - c[1], start[0] - c[0]);
  return arcPts(c[0], c[1], r, a0, rad(sweepDeg));
}

/** Arc between two points given its signed included angle (degrees, CCW positive), as IDF/Eagle store it. */
export function arcByAngle(p0: V2, p1: V2, angDeg: number): V2[] {
  if (Math.abs(angDeg) < 1e-6) return [p0, p1];
  if (Math.abs(Math.abs(angDeg) - 360) < 1e-6) return arcCenter(p0, p1, angDeg); // p0 = centre, p1 = point on circle
  const th = rad(angDeg);
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const chord = Math.hypot(dx, dy);
  const h = chord / 2 / Math.tan(th / 2); // centre distance from chord midpoint (signed)
  const cx = mx - (dy / chord) * h, cy = my + (dx / chord) * h;
  const r = Math.hypot(p0[0] - cx, p0[1] - cy);
  return arcPts(cx, cy, r, Math.atan2(p0[1] - cy, p0[0] - cx), th);
}

/** Cubic Bezier tessellation. */
export function bezier(p0: V2, p1: V2, p2: V2, p3: V2, n = 16): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/**
 * Chain open polylines (segments, arcs...) into closed loops. Endpoints closer than `tol` are joined.
 * Returns closed loops (without repeated last point), largest first.
 */
export function chainLoops(paths: V2[][], tol = 0.05): Loop[] {
  const pool = paths.filter((p) => p.length >= 2).map((p) => [...p]);
  const loops: Loop[] = [];
  const close = (a: V2, b: V2) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  while (pool.length) {
    let cur = pool.pop()!;
    let grown = true;
    while (grown && !close(cur[0], cur[cur.length - 1])) {
      grown = false;
      const end = cur[cur.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (close(p[0], end)) cur = cur.concat(p.slice(1));
        else if (close(p[p.length - 1], end)) cur = cur.concat([...p].reverse().slice(1));
        else if (close(p[p.length - 1], cur[0])) cur = p.concat(cur.slice(1));
        else if (close(p[0], cur[0])) cur = [...p].reverse().concat(cur.slice(1));
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (cur.length >= 3 && close(cur[0], cur[cur.length - 1])) loops.push(dedupe(cur.slice(0, -1)));
    else if (cur.length >= 3 && Math.hypot(cur[0][0] - cur[cur.length - 1][0], cur[0][1] - cur[cur.length - 1][1]) < 5 * tol * 20)
      loops.push(dedupe(cur)); // nearly closed: accept, the gap is bridged
  }
  return loops.filter((l) => l.length >= 3 && Math.abs(area(l)) > 1e-3).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
}

export function dedupe(p: Loop, eps = 1e-6): Loop {
  const out: Loop = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - q[0]) > eps || Math.abs(last[1] - q[1]) > eps) out.push(q);
  }
  if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < eps && Math.abs(out[0][1] - out[out.length - 1][1]) < eps) out.pop();
  return out;
}

/** Split loops into the board outline (largest) and cutouts (loops inside it). */
export function outlineFromLoops(loops: Loop[]): { outline: Loop; cutouts: Loop[] } | null {
  if (!loops.length) return null;
  const sorted = [...loops].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const outline = ccw(sorted[0]);
  const cutouts = sorted.slice(1).filter((l) => inside(l[0], outline)).map((l) => ccw(l).reverse());
  return { outline, cutouts };
}

export function transformLoop(p: Loop, dx: number, dy: number, flipY = false): Loop {
  return p.map(([x, y]) => [x + dx, (flipY ? -y : y) + dy] as V2);
}

export function rot2(v: V2, a: number): V2 {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

export function uid(prefix = 'id'): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

export function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function round(x: number, n = 2) {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}
