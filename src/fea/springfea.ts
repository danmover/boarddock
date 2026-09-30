// 2D FEA of a spring clip's leaf in plan (see cad/leafplan.ts): the leaf clamped at its root, the board pushing its lip
// aside across the leaf. Plane stress on the pixel grid the dock's FEA uses, solved for a unit load and scaled to the
// push aside wanted (linear, small displacement). The leaf is a tall plate, so `height` is its out-of-plane depth.
import type { Loop } from '../model/types';
import { assemble2D, elementStrain, meshPolygons, nearestNode, pcg, q6Element, smoothStrain } from './fea2d';
import { armT, foldOf, MU, pushForce, type Leaf } from '../cad/grip';

export interface LeafFea {
  k: number; // stiffness at the lip, N per mm across the leaf
  F: number; // force at the push aside asked for, N
  push: number; // force to press the board straight down past it (the ramp, with friction), N
  peak: number; // peak strain at that push aside (3 x 3 pixel average)
  p99: number;
  where: [number, number]; // s, t of the peak
  slotLeft: number; // a hairpin: the narrowest its slot gets at that push aside, mm (Infinity for a straight leaf)
  slots: { s: number; rest: number; left: number; moveB: number; moveA: number }[]; // a hairpin: its slot's width along it, at rest and pushed, and how far each arm moves there
  hold: number; // the lift the clip holds against with its catch `tip` deep: friction dragging the leaf off the edge, N
}

/**
 * `loops`: the leaf's plan (leafPlan, csLoops); `face`: where its board-side face stands; `lip`: the span [s0, s1]
 * along it the board pushes on; `delta`: the push aside at the lip; `tip`: the catch depth, for the hold.
 */
export function leafFea(loops: Loop[], f: Leaf, face: number, o: { E: number; nu?: number; pix?: number; lip: [number, number]; delta: number; tip: number; phase?: [number, number] }): LeafFea {
  const pix = o.pix ?? 0.1;
  const m = meshPolygons(loops, pix, o.phase);
  const { Ke, R } = q6Element(pix, o.E, o.nu ?? 0.38, f.h);
  const S = assemble2D(m, Ke);
  const fixed = new Uint8Array(S.n), load = new Float64Array(S.n);
  const ids: number[] = [];
  for (let i = 0; i < m.nNodes; i++) {
    const x = m.nodeXY[2 * i], y = m.nodeXY[2 * i + 1];
    if (x < 0.02) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; } // the anchor
    else if (x >= o.lip[0] && x <= o.lip[1] && Math.abs(y - face) < pix * 0.9) ids.push(i);
  }
  if (!ids.length) throw new Error('no load nodes on the lip');
  for (const i of ids) load[2 * i + 1] = -1 / ids.length; // outward, away from the board
  const { u } = pcg(S, load, fixed, 1e-9);
  let d = 0;
  for (const i of ids) d += -u[2 * i + 1] / ids.length;
  const k = 1 / d, sc = o.delta * k;
  const eps = smoothStrain(m, elementStrain(m, u, R).map((e) => e * sc));
  let at = 0;
  eps.forEach((e, i) => { if (e > eps[at]) at = i; });
  const sorted = Float64Array.from(eps).sort();
  const g = m.elems[at];
  const where: [number, number] = [m.x0 + ((g % m.nx) + 0.5) * m.h, m.y0 + (Math.floor(g / m.nx) + 0.5) * m.h];
  let slotLeft = Infinity;
  const slots: LeafFea['slots'] = [];
  if (f.u) {
    const { sf } = foldOf(f), tO = face - 2 * foldOf(f).Ro;
    for (let i = 1; i <= 24; i++) {
      const s = 0.6 + ((sf - 0.6 - 0.3) * i) / 24, tb = face - armT(f, s), ta = tO + armT(f, s);
      const nb = nearestNode(m, s, tb), na = nearestNode(m, s, ta);
      const w = tb - ta + (u[2 * nb + 1] - u[2 * na + 1]) * sc;
      slots.push({ s, rest: tb - ta, left: w, moveB: -u[2 * nb + 1] * sc, moveA: -u[2 * na + 1] * sc });
      slotLeft = Math.min(slotLeft, w);
    }
  }
  return { k, F: sc, push: pushForce(sc), peak: sorted[sorted.length - 1], p99: sorted[Math.floor(sorted.length * 0.99)], where, slotLeft, slots, hold: (k * o.tip) / MU };
}
