// The spring clip's leaf in plan, straight against hairpin (a leaf folded back on itself): the beam sums in grip.ts
// checked against the 2D FEA of the same outline (cad/leafplan.ts), and the two compared at the same catch depth.
import { appendFileSync } from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { csLoops, freeAll, initKernel } from '../src/cad/kernel';
import { leafPlan } from '../src/cad/leafplan';
import { bestClip, leafMech, sizeClip, uLeaf, U_ARMS, type Leaf } from '../src/cad/grip';
import { leafFea } from '../src/fea/springfea';
import { MATERIALS } from '../src/model/library';

beforeAll(async () => { await initKernel(); });

const GAP = 0.3, PLAY = 0.3, GW = 2.1, FACE = -(GAP + 0.1);
const PETG = MATERIALS.PETG;

/** FEA of a leaf pushed `delta` aside at its lip. */
function fea(f: Leaf, tip: number, delta: number, mat = PETG) {
  const s0 = f.u ? 0.9 : f.L - 0.3 - f.lipLen;
  const loops = csLoops(leafPlan(f, FACE, GW, GAP));
  const r = leafFea(loops, f, FACE, { E: mat.E, lip: [s0, s0 + f.lipLen], delta, tip });
  freeAll();
  return r;
}
const straight = (L: number, t0: number, h = 9): Leaf => ({ L, t0, tMin: Math.min(0.7, t0), h, lipLen: Math.min(5, Math.max(3, 0.38 * L)) });

describe('the beam sums follow the FEA', () => {
  it('a hairpin: stiffness within 5%, peak strain within 15% (the fold\'s round is in the sum), the slot stays open', () => {
    for (const L of [8, 10, 12, 14]) for (const t0 of [0.7, 0.8, 0.9]) {
      const f = uLeaf(L, t0, 9, Math.min(4, Math.max(3, 0.3 * L)));
      const m = leafMech(f, PETG.E, 0.9), r = fea(f, 0.6, 0.9);
      expect(Math.abs(r.k / m.k - 1), `L${L} t${t0}: stiffness`).toBeLessThan(0.05);
      expect(Math.abs(r.peak / m.eps - 1), `L${L} t${t0}: peak strain`).toBeLessThan(0.15);
      expect(r.slotLeft, `L${L} t${t0}: the arms would meet`).toBeGreaterThan(0.1);
      // the peak is at the fold, the far end of the leaf
      expect(r.where[0], `L${L} t${t0}: peak at the fold`).toBeGreaterThan(L - 3);
    }
  });

  it('a straight leaf: within 35% in stiffness (a short thin one is stiffer at its root fillet) and 20% in strain', () => {
    for (const [L, t0] of [[8, 0.6], [10, 0.6], [12, 0.8], [12, 1.15], [14, 1.4], [16, 1.6]] as const) {
      const f = straight(L, t0);
      const m = leafMech(f, PETG.E, 0.9), r = fea(f, 0.6, 0.9);
      expect(Math.abs(r.k / m.k - 1), `L${L} t${t0}: stiffness`).toBeLessThan(0.35);
      expect(Math.abs(r.peak / (1.12 * m.eps) - 1), `L${L} t${t0}: peak strain`).toBeLessThan(0.2);
    }
  });
});

describe('the hairpin against the straight clip, at the same catch depth', () => {
  // A straight leaf no thinner than 0.6 mm is as soft as it can print; the hairpin is set to the push the straight one
  // gives (the arm thickness that comes nearest), and both pushed 0.6 + 0.3 mm aside, the catch depth every clip has.
  const TIP = 0.6;
  for (const L of [8, 10, 12]) it(`${L} mm of edge: a lower peak strain and a better fatigue margin for the same push and release`, () => {
    const straightOpts = [0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3].map((t0) => ({ f: straight(L, t0), r: fea(straight(L, t0), TIP, TIP + PLAY) }));
    const hairpinOpts = [0.7, 0.75, 0.8, 0.85, 0.9].map((t0) => { const f = uLeaf(L, t0, 9, Math.min(4, Math.max(3, 0.3 * L))); return { f, r: fea(f, TIP, TIP + PLAY) }; });
    // the pair of thicknesses whose pushes are nearest each other (the straight one has to be within the strain limit of 2%)
    let best: { s: (typeof straightOpts)[number]; u: (typeof hairpinOpts)[number]; d: number } | null = null;
    for (const s of straightOpts) for (const u of hairpinOpts) {
      if (s.r.push * (TIP / (TIP + PLAY)) > 4.5) continue; // (a clip that takes more than 4.5 N to press past is not one to compare with)
      const d = Math.abs(u.r.push / s.r.push - 1);
      if (!best || d < best.d) best = { s, u, d };
    }
    const { s, u } = best!;
    const release = (o: typeof s) => (o.r.F * (TIP + 0.2)) / (TIP + PLAY);
    const fatigue = (o: typeof s) => (0.5 * PETG.strainAllow) / o.r.peak;
    const line = `L ${L}: straight t${s.f.t0} push ${(s.r.push * TIP / (TIP + PLAY)).toFixed(2)} N, release ${release(s).toFixed(2)} N, peak ${(s.r.peak * 100).toFixed(2)}%, fatigue ${fatigue(s).toFixed(2)}, hold ${s.r.hold.toFixed(1)} N | hairpin t${u.f.t0} push ${(u.r.push * TIP / (TIP + PLAY)).toFixed(2)} N, release ${release(u).toFixed(2)} N, peak ${(u.r.peak * 100).toFixed(2)}%, fatigue ${fatigue(u).toFixed(2)}, hold ${u.r.hold.toFixed(1)} N`;
    if (process.env.CLIPTABLE) appendFileSync(process.env.CLIPTABLE, line + '\n'); // (vitest hides console output)
    expect(best!.d, 'a hairpin with the same push').toBeLessThan(0.12);
    expect(Math.abs(release(u) / release(s) - 1), 'the same release').toBeLessThan(0.15);
    expect(Math.abs(u.r.hold / s.r.hold - 1), 'the same hold').toBeLessThan(0.15);
    expect(u.r.peak, 'strain at full deflection').toBeLessThan(0.85 * s.r.peak);
    expect(fatigue(u), 'fatigue margin').toBeGreaterThan(1.15 * fatigue(s));
    expect(u.r.slotLeft).toBeGreaterThan(0.1);
  }, 120000);

  it('the hairpin takes no more room across than a clip\'s reserved zone, and none of the length a straight one has', () => {
    const f = uLeaf(10, 0.9, 9, 3);
    expect(-FACE + U_ARMS).toBeLessThan(GW + 1); // its outer face is inside the 3.1 mm the zone behind a clip is kept clear to (0.7 mm past the wall's face)
    const cs = leafPlan(f, FACE, GW, GAP);
    const pts = csLoops(cs).flat();
    freeAll();
    expect(Math.max(...pts.map((p) => p[0]))).toBeLessThanOrEqual(10 + 1e-6); // no longer along the edge than its L
    expect(Math.min(...pts.map((p) => p[1]))).toBeGreaterThanOrEqual(FACE - U_ARMS - 1e-6);
  });

  it('a stretch of 14 mm or more keeps the straight clip (it is the stiffer, and holds more); a shorter one gets the hairpin', () => {
    const ask = { h: 9, mat: PETG, gap: GAP, play: PLAY, tip: 0.6, want: 3.3 };
    expect(bestClip({ ...ask, L: 16 }).kind).toBe('straight');
    expect(bestClip({ ...ask, L: 14 }).kind).toBe('straight');
    expect(bestClip({ ...ask, L: 10 }).kind).toBe('u');
    expect(bestClip({ ...ask, L: 8 }).kind).toBe('u');
    // and on the hairpin's own terms, every material at every length keeps its strain at full deflection inside half the limit
    // (PLA's limit is 1.5%: at 8 mm even the softest hairpin, at the shallowest catch, is well over half of it, and the Check step says so)
    for (const [name, mat] of Object.entries(MATERIALS)) for (const L of [8, 10, 12]) {
      if (L === 8 && mat.strainAllow < 0.02) continue;
      const c = sizeClip({ ...ask, mat, L, kind: 'u' });
      const share = L === 8 ? 0.55 : 0.5; // (8 mm is the shortest stretch a hairpin can serve: its softest, at the shallowest catch, is just over half)
      expect(c.eps, `${name} L${L}`).toBeLessThanOrEqual(share * mat.strainAllow + 1e-9);
      expect(c.fatigue, `${name} L${L}`).toBeGreaterThanOrEqual(0.5 / share - 1e-9);
    }
  });
});
