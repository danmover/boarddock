// The fillets at the bottom of the shoe's hook slits and under each hook's tab (docs/din-clip-review.md: the pull-off
// FEA found the hook beams' roots at their slits the first place a pull on the holder reached the strain limit).
import { describe, it, expect, beforeAll } from 'vitest';
import { csLoops, freeAll, initKernel, toMesh } from '../src/cad/kernel';
import { END_POSE, shoe, shoeFeaProfiles, socket } from '../src/cad/dock';
import { HOOK_SLIT, SOCKET_Z } from '../src/cad/dockdims';
import { layerCheck, verdict } from '../src/cad/printcheck';
import { shoePullOff } from '../src/fea/dockfea';

beforeAll(async () => { await initKernel(); });

describe('the shoe\'s hook slits and tabs', () => {
  it('the fillets clear the socket seated in the shoe, and the shoe still prints without support, its lever free', () => {
    expect(HOOK_SLIT).toEqual({ inner: 0.6, outer: 0.6, tab: 0.3 });
    const sh = shoe(), so = socket().translate([0, 0, SOCKET_Z]);
    expect(sh.intersect(so).volume()).toBeLessThan(1e-3);
    expect(sh.decompose().length).toBe(2); // (the shoe and its lever, printed in place)
    const q = layerCheck(toMesh(sh.transform(END_POSE.pose as any)))!;
    expect(q.islands).toEqual([]);
    expect(q.gaps, 'a slot that prints closed').toBeNull();
    expect(q.cantilever?.reach ?? 0).toBeLessThan(2);
    expect(q.bridge?.span ?? 0).toBeLessThan(9);
    expect(verdict(q, true).status).not.toBe('bad');
    freeAll();
  });

  it('a pull on the holder reaches PETG\'s strain limit later than with the plain round bottoms: 130 N and 87 N (119 and 80 before)', () => {
    const limit = (c: { notes: string[] }) => Number(/limit at about (\d+) N/.exec(c.notes.join(' '))![1]);
    const run = () => {
      const r = shoePullOff(csLoops(shoeFeaProfiles().jaw), 2100, 0.38, 0.1);
      freeAll();
      return { both: limit(r.cases[0]), one: limit(r.cases[1]), r };
    };
    const now = run();
    const keep = { ...HOOK_SLIT };
    Object.assign(HOOK_SLIT, { inner: 0.3, outer: 0.3, tab: 0 }); // the slit's own round, no tab fillet: the old shoe
    let before;
    try { before = run(); } finally { Object.assign(HOOK_SLIT, keep); }
    console.log(`pull-off limits, N: both hooks ${before.both} -> ${now.both}, one hook ${before.one} -> ${now.one}`);
    expect(now.both).toBeGreaterThan(before.both * 1.05);
    expect(now.one).toBeGreaterThan(before.one * 1.05);
    expect(now.both).toBeGreaterThan(125);
    expect(now.one).toBeGreaterThan(84);
    // the hook beams' roots are no longer where the strain peaks under a pull on both hooks: the fixed hook's finger is,
    // at the edge of the rigid support the model holds it by (thickening it 0.6 mm did not change that reading)
    expect(now.r.cases[0].notes[1]).toMatch(/^strain by part: fixed hook finger/);
  }, 600000);
});
