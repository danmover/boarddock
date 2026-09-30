// The layer check on small test shapes, one per behaviour: reach measured inside the layer and not capped,
// bridges told from one-sided overhangs by where they are held, real spans, sloped roofs, specks, tiny feet.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel, freeAll, box, unionMF, toMesh, poly, type MF } from '../src/cad/kernel';
import { layerCheck, verdict } from '../src/cad/printcheck';

const check = (m: MF) => { const r = layerCheck(toMesh(m))!; freeAll(); return r; };
// a prism of a (y, z) profile along x
const prismYZ = (pts: [number, number][], x0: number, x1: number) => poly(pts, 'NonZero').extrude(x1 - x0).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, x0, 0, 0, 1] as any) as MF;

describe('layer check on test shapes', () => {
  beforeAll(async () => { await initKernel(); });

  it('measures a long cantilever in full and fails it', () => {
    const r = check(unionMF([box(0, 0, 0, 4, 4, 6), box(0, 0, 6, 54, 4, 7)]));
    expect(r.cantilever!.reach).toBeGreaterThan(49);
    expect(r.cantilever!.reach).toBeLessThan(51);
    expect(r.bridge).toBeNull();
    expect(verdict(r).status).toBe('bad');
  });

  it('a roof held on three or four sides is a bridge, with its real span', () => {
    // 10 x 10 mm opening, walls 2 mm thick, roof 1 mm
    const walls = (open: boolean) => unionMF([box(-2, -2, 0, 0, 12, 5), box(10, -2, 0, 12, 12, 5), box(-2, -2, 0, 12, 0, 5), ...(open ? [] : [box(-2, 10, 0, 12, 12, 5)])]);
    for (const open of [true, false]) {
      const r = check(unionMF([walls(open), box(-2, -2, 5, 12, 12, 6)]));
      expect(r.cantilever?.reach ?? 0, `open ${open}`).toBeLessThan(1);
      expect(r.bridge!.span).toBeGreaterThan(9.5);
      expect(r.bridge!.span).toBeLessThan(10.6);
    }
  });

  it('a tunnel is a bridge of its whole width', () => {
    const r = check(unionMF([box(0, 0, 0, 2, 20, 4), box(12, 0, 0, 14, 20, 4), box(0, 0, 4, 14, 20, 5)]));
    expect(r.bridge!.span).toBeGreaterThan(9.7);
    expect(r.bridge!.span).toBeLessThan(10.4);
    expect(verdict(r).status).toBe('ok');
    const long = check(unionMF([box(0, 0, 0, 2, 20, 4), box(18, 0, 0, 20, 20, 4), box(0, 0, 4, 20, 20, 5)]));
    expect(verdict(long).status).toBe('warn'); // 16 mm
  });

  it('measures a finger along itself, not across the slot beside its free end', () => {
    // a wall with a 14 mm finger over a slot, free end 0.6 mm from the wall going on
    const r = check(unionMF([box(0, 0, 0, 30, 2, 3), box(0, 0, 3, 5, 2, 8), box(19.6, 0, 3, 30, 2, 8), box(5, 0, 5, 19, 2, 8)]));
    expect(r.cantilever!.reach).toBeGreaterThan(13.5);
    expect(verdict(r).status).toBe('bad');
  });

  it('sees a sloped roof the layers step over a little at a time', () => {
    for (const deg of [60, 70]) {
      const run = 5, rise = run / Math.tan((deg * Math.PI) / 180); // surface this many degrees from vertical
      const r = check(unionMF([box(0, 0, 0, 10, 2, 4), prismYZ([[2, 4], [2 + run, 4 + rise], [2 + run, 5 + rise], [0, 5 + rise], [0, 4]], 0, 10)]));
      expect(r.slope?.reach ?? 0, `${deg} degrees`).toBeGreaterThan(3);
      expect(verdict(r).status, `${deg} degrees`).not.toBe('ok');
    }
    // a 45 degree chamfer is fine
    const ok = check(unionMF([box(0, 0, 0, 10, 2, 4), prismYZ([[2, 4], [7, 9], [7, 10], [0, 10], [0, 4]], 0, 10)]));
    expect(ok.slope).toBeNull();
    expect(verdict(ok).status).toBe('ok');
  });

  it('tells a real island from a speck thinner than a line', () => {
    const island = check(unionMF([box(0, 0, 0, 4, 4, 4), box(10, 0, 2, 14, 4, 4)]));
    expect(island.islands.length).toBe(1);
    expect(verdict(island).status).toBe('bad');
    const speck = check(unionMF([box(0, 0, 0, 4, 4, 4), box(4.2, 0, 2, 4.35, 3, 2.2)]));
    expect(speck.islands).toEqual([]);
    expect(speck.specks.length).toBe(1);
    expect(verdict(speck).status).toBe('ok');
  });

  it('fails a tall part on a tiny foot, and measures from the part\'s own bottom', () => {
    const rod = unionMF([box(0, 0, 0, 1.5, 1.5, 3), box(-1, -1, 3, 2.5, 2.5, 12), box(-5, -5, 12, 6.5, 6.5, 15)]);
    const r = check(rod.translate([0, 0, -1.3]));
    expect(r.firstLayer).toBeGreaterThan(2);
    expect(r.firstLayer).toBeLessThan(2.5);
    expect(verdict(r).status).toBe('bad');
    expect(verdict(r).value).toMatch(/foot|support/);
  });

  it('sees a narrow slot by its width, however little of it there is in a layer', () => {
    // a slab with a slot cut through it, `gap` wide and `len` long
    const slab = (gap: number, len: number) => check(box(0, 0, 0, 20, 20, 4).subtract(box(5, 10, -1, 5 + len, 10 + gap, 5)));
    // 0.09 x 1.2 mm is 0.11 mm² a layer: under the 0.15 mm² the check used to need
    const thin = slab(0.09, 1.2);
    expect(thin.gaps!.width).toBeGreaterThan(0.08);
    expect(thin.gaps!.width).toBeLessThan(0.1);
    expect(verdict(thin, true).status).toBe('warn');
    expect(verdict(thin, true).detail).toMatch(/a slot 0\.09 mm wide/);
    expect(verdict(thin, false).status).toBe('ok'); // where nothing moves it only fills in
    // long and thin, or short and a little wider: seen as before
    expect(slab(0.09, 6).gaps).not.toBeNull();
    expect(slab(0.25, 1.5).gaps!.width).toBeCloseTo(0.25, 1);
    // a hairline a few mm long is not a slot, and a clearance of 0.3 mm or more stays open
    expect(slab(0.09, 0.4).gaps).toBeNull();
    expect(slab(0.35, 6).gaps).toBeNull();
  });

  it('does not take the tip of a sharp inside corner for a slot', () => {
    // a wedge cut into a slab: closing fills its last 0.5 to 0.8 mm, which tapers to nothing
    for (const deg of [30, 45, 60, 90, 120]) {
      const half = (deg / 2) * Math.PI / 180, d = 8;
      const wedge = poly([[10, 10], [10 + d, 10 + d * Math.tan(half)], [10 + d, 10 - d * Math.tan(half)]], 'NonZero').extrude(5).translate([0, 0, -0.5]) as MF;
      expect(check(box(0, 0, 0, 30, 20, 4).subtract(wedge)).gaps, `${deg} degree notch`).toBeNull();
    }
  });
});
