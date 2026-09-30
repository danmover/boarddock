// The rivet for holders back to back: a rigid pin with a neck, and a U clip that clicks onto the neck. The old rivet's split
// barb (legs 2 to 4 mm long, springing 0.2 mm) was at 15% peak strain, 3.5% for 99% of it.
import { describe, expect, it, beforeAll } from 'vitest';
import { initKernel, csLoops, freeAll, poly } from '../src/cad/kernel';
import { RIVET, rivetClip, rivetClipMesh, rivetMove, rivetPin } from '../src/cad/rivet';
import { pushStrain } from '../src/fea/beamfea';

describe('the old snap rivet', () => {
  beforeAll(async () => { await initKernel(); });
  it('could not have been snapped in: legs of 4 mm springing 0.3 mm read over 3% for 99% of the leg', () => {
    const grip = 4, shank = grip + 0.3, slit0 = shank - 2.2, ys = 0.42;
    const loop: [number, number][] = [[-1.3, 3.2], [-1.3, -3.2], [0, -3.2], [0, -1.6], [shank, -1.6], [shank, -1.95], [shank + 2, -1.1], [shank + 2, -ys], [slit0, -ys], [slit0, ys], [shank + 2, ys], [shank + 2, 1.1], [shank, 1.95], [shank, 1.6], [0, 1.6], [0, 3.2]];
    const r = pushStrain(csLoops(poly(loop, 'NonZero')), { t: 3, h: 0.05, fixed: (x) => x < 0, load: (x, y) => x > shank && x < shank + 0.3 && y > 1.2, load2: (x, y) => x > shank && x < shank + 0.3 && y < -1.2, dir: [0, -1], probe: [shank + 0.15, 1.7], along: [0, -1], target: 0.3, region: (x) => x > -0.5 });
    console.log(`old rivet: ${(r.peak * 100).toFixed(1)}% peak, ${(r.p99 * 100).toFixed(1)}% for 99%, ${r.force.toFixed(0)} N`);
    expect(r.p99).toBeGreaterThan(0.03);
    freeAll();
  });
});

describe('the clip', () => {
  beforeAll(async () => { await initKernel(); });
  it('is one solid that prints flat, and its lips stand closer than the neck: a hook face', () => {
    const m = rivetClipMesh();
    expect(m.decompose().length).toBe(1);
    const bb = m.boundingBox();
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(RIVET.clipT, 3);
    expect(RIVET.throat).toBeLessThan(2 * RIVET.neck); // the lips overlap the neck: the catch
    expect(RIVET.cavity).toBeGreaterThan(2 * RIVET.neck); // and the neck has room in the cavity
    expect(RIVET.clipT).toBeLessThan(RIVET.neckW); // the clip sits in the groove
    freeAll();
  });

  it('clicks onto the neck at under 1% strain in the arms (2D FEA), nothing pressing at rest', () => {
    const c = RIVET.cavity / 2, y0 = RIVET.body, y1 = RIVET.body + RIVET.arm, mv = rivetMove();
    const loops = csLoops(rivetClip());
    const r = pushStrain(loops, {
      t: RIVET.clipT, h: 0.05,
      fixed: (_x, y) => y < y0 - 0.2,
      load: (x, y) => x > 0 && y > y1 - 1.0 && y < y1 - 0.5 && x < c,
      load2: (x, y) => x < 0 && y > y1 - 1.0 && y < y1 - 0.5 && x > -c,
      dir: [1, 0], probe: [RIVET.throat / 2, y1 - 0.75], along: [1, 0], target: mv,
      region: (_x, y) => y > y0 - 0.5,
    });
    console.log(`rivet clip: lips move ${mv.toFixed(2)} mm, ${r.force.toFixed(1)} N, ${(r.peak * 100).toFixed(2)}% peak, ${(r.p99 * 100).toFixed(2)}% for 99%`);
    expect(r.peak).toBeLessThan(0.01);
    freeAll();
  });
});

describe('the pin', () => {
  beforeAll(async () => { await initKernel(); });
  it('is one solid with its neck just beyond the far base, the shank a slip fit in a Ø3.5 hole', () => {
    for (const grip of [3, 4, 5]) {
      const m = rivetPin(grip);
      expect(m.decompose().length).toBe(1);
      const bb = m.boundingBox();
      expect(bb.max[0]).toBeCloseTo(grip + RIVET.tail, 2); // (the tip reaches 2.3 mm past the far base)
      expect(2 * RIVET.shank).toBeLessThan(3.5);
    }
    freeAll();
  });
});
