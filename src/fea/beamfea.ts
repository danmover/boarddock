// Small helpers for the rack's own flexures (the DIN clip, the plug caps, the cable tags, the stands): Euler-Bernoulli
// beams, tapered ones integrated numerically, and one call that pushes a 2D profile through the plane-stress solver
// (fea2d.ts) until a chosen point has moved a chosen distance. The table these feed is src/fea/flexures.ts (rackflex.ts
// registers the rack's rows).
import type { Loop } from '../model/types';
import { assemble2D, elementStrain, meshPolygons, nearestNode, pcg, q6Element } from './fea2d';

// ------------------------------- beams -------------------------------

/** Peak strain of a tip-loaded cantilever of constant thickness t and length L, tip moved by d (free rotation). */
export const cantilever = (t: number, L: number, d: number) => (3 * t * d) / (2 * L * L);
/** The same for a beam whose tip is held parallel (a guided end): both ends carry a moment. */
export const guided = (t: number, L: number, d: number) => (3 * t * d) / (L * L);

/**
 * A cantilever whose thickness goes linearly from t0 at the root to t1 at the tip (constant width), tip moved by d
 * with a point load: the peak strain over its length, and the tip force per mm of width (E in MPa). Integrated
 * numerically, so it holds for any taper.
 */
export function taper(t0: number, t1: number, L: number, d: number, E = 2100, n = 400) {
  const t = (x: number) => t0 + ((t1 - t0) * x) / L;
  // unit load F = 1: curvature M / (E I) with M = L - x; tip deflection = the integral of curvature times (L - x)
  let defl = 0;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) * L) / n, I = t(x) ** 3 / 12;
    defl += ((L - x) * (L - x)) / (E * I) * (L / n);
  }
  const F = d / defl; // N per mm of width
  let peak = 0;
  for (let i = 0; i <= n; i++) {
    const x = (i * L) / n;
    peak = Math.max(peak, (F * (L - x) * (t(x) / 2)) / (E * (t(x) ** 3 / 12)));
  }
  return { peak, force: F };
}

/** Strain of a thin ring's arm or a hairpin from its unrolled length: an S-bent beam of two equal halves. */
export const sBeam = (t: number, L: number, d: number) => (3 * t * d) / (L * L);

// ------------------------------- 2D FEA of a profile -------------------------------

export interface PushOpts {
  /** Extrusion thickness (mm) along the print's z. */
  t: number;
  E?: number;
  nu?: number;
  /** Pixel size (mm). */
  h?: number;
  /** Nodes held still. */
  fixed: (x: number, y: number) => boolean;
  /** Nodes that carry the push, and its direction. */
  load: (x: number, y: number) => boolean;
  dir: [number, number];
  /** The point whose movement along `along` is set to `target` (mm). */
  probe: [number, number];
  along: [number, number];
  target: number;
  /** Strain is counted over this part of the profile only (default all). */
  region?: (x: number, y: number) => boolean;
  /** The load is spread as a pair of opposite pushes on this second set (a ring pulled open): direction reversed. */
  load2?: (x: number, y: number) => boolean;
}

/**
 * Push a profile until `probe` has moved `target` along `along`: the force needed (N) and the peak and 99th
 * percentile strain over `region`. Linear, small displacement.
 */
export function pushStrain(loops: Loop[], o: PushOpts) {
  const E = o.E ?? 2100, nu = o.nu ?? 0.38, h = o.h ?? 0.1;
  const m = meshPolygons(loops, h);
  const { Ke, R } = q6Element(h, E, nu, o.t);
  const S = assemble2D(m, Ke);
  const fixed = new Uint8Array(S.n), f = new Float64Array(S.n);
  for (let i = 0; i < m.nNodes; i++) if (o.fixed(m.nodeXY[2 * i], m.nodeXY[2 * i + 1])) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; }
  const ids: number[] = [], ids2: number[] = [];
  for (let i = 0; i < m.nNodes; i++) {
    if (fixed[2 * i]) continue;
    const x = m.nodeXY[2 * i], y = m.nodeXY[2 * i + 1];
    if (o.load(x, y)) ids.push(i); else if (o.load2?.(x, y)) ids2.push(i);
  }
  if (!ids.length) throw new Error('pushStrain: no load nodes');
  for (const i of ids) { f[2 * i] += o.dir[0] / ids.length; f[2 * i + 1] += o.dir[1] / ids.length; }
  for (const i of ids2) { f[2 * i] -= o.dir[0] / ids2.length; f[2 * i + 1] -= o.dir[1] / ids2.length; }
  const { u } = pcg(S, f, fixed, 1e-9);
  const pr = nearestNode(m, o.probe[0], o.probe[1]);
  const move = u[2 * pr] * o.along[0] + u[2 * pr + 1] * o.along[1];
  const k = o.target / move;
  const eps = elementStrain(m, u, R);
  const vals: number[] = [];
  let peak = 0, at: [number, number] = [0, 0];
  m.elems.forEach((ge, i) => {
    const x = m.x0 + ((ge % m.nx) + 0.5) * h, y = m.y0 + (Math.floor(ge / m.nx) + 0.5) * h;
    if (o.region && !o.region(x, y)) return;
    const e = eps[i] * Math.abs(k);
    vals.push(e);
    if (e > peak) { peak = e; at = [x, y]; }
  });
  vals.sort((a, b) => a - b);
  return { force: Math.abs(k), peak, at, p99: vals[Math.floor(vals.length * 0.99)] ?? 0, elements: vals.length };
}
