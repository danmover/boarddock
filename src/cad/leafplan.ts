// A spring clip's leaf seen from above (plan): s along the board's edge from the leaf's root, t into the board, the
// leaf on the negative side of `face`. One outline for the model and for the FEA, so what is analysed is what prints.
import type { V2 } from '../model/types';
import type { CS } from './kernel';
import { poly, rect2, roundCS } from './kernel';
import { armT, foldOf, leafT, U_FREE, type Leaf } from './grip';

/** The plan outline of the leaf on its own, without the anchor. Straight: a taper. Hairpin: two tapering arms and a fold. */
export function leafOutline(f: Leaf, face: number): V2[] {
  if (!f.u) {
    const pts: V2[] = [[0, face]];
    for (let i = 0; i <= 24; i++) { const s = (f.L * i) / 24; pts.push([s, face - leafT(f, s)]); }
    pts.reverse();
    pts.push([f.L, face]);
    return pts;
  }
  const { Ro, sf } = foldOf(f), g0 = f.u.slot, cy = face - Ro, tO = face - 2 * Ro; // (the fold's centre; A's outer face)
  const out: V2[] = [[U_FREE, face], [sf, face]];
  const arc = (r: number, a0: number, a1: number, n: number) => { for (let i = 1; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([sf + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  arc(Ro, Math.PI / 2, -Math.PI / 2, 32); // the fold's outer side, from B round to A
  out.push([sf, tO], [0, tO], [0, tO + armT(f, 0)]);
  for (let i = 1; i <= 24; i++) { const s = (sf * i) / 24; out.push([s, tO + armT(f, s)]); } // A's inner face
  arc(g0 / 2, -Math.PI / 2, Math.PI / 2, 24); // the slot's round end
  out.push([sf, cy + g0 / 2]);
  for (let i = 24; i >= 0; i--) { const s = U_FREE + ((sf - U_FREE) * i) / 24; out.push([s, face - armT(f, s)]); } // B's outer face, back to its free end
  return out;
}

/**
 * The leaf's plan with its root fillet, as far back as s = -1.5 (into the anchor's block): `gw` the wall's outer face's
 * distance from the board edge, `gap` its inner face's. A hairpin's anchor reaches out to its outer arm's face.
 */
export function leafPlan(f: Leaf, face: number, gw: number, gap: number): CS {
  const leafCS = roundCS(poly(leafOutline(f, face), 'NonZero'), Math.min(0.25, f.tMin / 2 - 0.05));
  if (!f.u) {
    // root fillet: close the corner between the leaf and the anchor's end with a generous radius
    const rootCS = rect2(-1.5, -gw, 0.02, -gap), r = 1.2;
    return leafCS.add(rootCS).offset(r, 'Round').offset(-r, 'Round').intersect(rect2(-1.5, -gw - 1, f.L + 1, face + 0.001)).add(leafCS);
  }
  // the fold and the slot are narrower than a wide root fillet would close, so the small one is confined to the root
  const tO = face - 2 * foldOf(f).Ro, r = 0.25;
  const rootCS = rect2(-1.5, tO, 0.02, -gap);
  const near = leafCS.add(rootCS).offset(r, 'Round').offset(-r, 'Round').intersect(rect2(-1.5, tO - 1, 1.8, face + 0.001));
  return near.add(leafCS);
}
