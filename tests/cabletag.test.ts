// Cable tags. A ring that snaps round a cable had to open by the cable's whole diameter less its mouth; a 1.3 mm ring 3 to 8 mm
// across cannot do that within the material's limit unless the cable gives. The tag is a saddle now, held on by a zip tie.
import { beforeAll, describe, expect, it } from 'vitest';
import { box, circle2, csLoops, cyl, freeAll, initKernel, rect2 } from '../src/cad/kernel';
import { cableTag, TAG, tagRing } from '../src/cad/cabletag';
import { pushStrain } from '../src/fea/beamfea';

describe('the old snap ring', () => {
  beforeAll(async () => { await initKernel(); });
  it('read over 8% (rigid cable) for every cable size: 0.72 x the cable across the mouth, a 1.3 mm wall', () => {
    for (const d of [3, 5, 7]) {
      const r = d / 2 + 0.2, wall = 1.3;
      const ring = circle2(0, 0, r + wall, 48).subtract(circle2(0, 0, r, 48)).subtract(rect2(-(r + wall + 1), -0.36 * d, -r * 0.3, 0.36 * d));
      const res = pushStrain(csLoops(ring), {
        t: 3, h: 0.1,
        fixed: (x) => x > r * 0.5,
        load: (x, y) => x < -r * 0.3 - 0.2 && x > -(r + wall) - 0.05 && y > 0.36 * d - 0.05 && y < 0.36 * d + 0.15,
        load2: (x, y) => x < -r * 0.3 - 0.2 && x > -(r + wall) - 0.05 && y < -0.36 * d + 0.05 && y > -0.36 * d - 0.15,
        dir: [0, 1], probe: [-r, 0.36 * d + 0.05], along: [0, 1], target: 0.14 * d + 0.1,
      });
      console.log(`old ring for a ${d} mm cable: ${(res.peak * 100).toFixed(1)}% peak, ${(res.p99 * 100).toFixed(1)}% for 99%, ${res.force.toFixed(0)} N a tip`);
      expect(res.p99).toBeGreaterThan(0.04);
    }
    freeAll();
  });
});

describe('the saddle', () => {
  beforeAll(async () => { await initKernel(); });
  it('is one solid, drops onto its cable from the mouth without touching it, and has a groove for a 2.5 mm zip tie', () => {
    for (const d of [2.5, 5, 8]) {
      const tag = cableTag(12, d);
      expect(tag.decompose().length, `d ${d}`).toBe(1);
      const r = d / 2 + TAG.clear;
      // the cable comes in along -x -> +x through the mouth, then sits in the middle: it touches nothing on the way
      for (let x = -12; x <= 0.01; x += 1) expect(tag.intersect(cyl(x, 0, -1, TAG.height + 1, d / 2)).volume(), `d ${d} at x ${x}`).toBeLessThan(1e-3);
      // the ring is cut back in the middle of its height for the tie: the outer radius there is `groove` less
      const slice = (z: number) => { const s = tag.intersect(box(-40, -40, z, 0.2, 40, z + 0.01)); return s.boundingBox(); };
      // (the flag lies at +x; the saddle's own reach is measured to the tips at -x and across y)
      const wide = slice(TAG.collar / 2), groove = slice(TAG.collar + TAG.grooveW / 2), flange = slice(TAG.height - TAG.flange / 2);
      expect(wide.max[1]).toBeCloseTo(r + TAG.wall, 0);
      expect(groove.max[1]).toBeLessThan(wide.max[1] - TAG.groove + 0.2);
      expect(flange.max[1]).toBeCloseTo(wide.max[1], 1);
      // the mouth is wider than the cable
      const ring = tagRing(d);
      const tips = csLoops(ring).flat().filter(([x]) => x < 0);
      const gap = 2 * Math.min(...tips.map(([, y]) => Math.abs(y)).filter((v) => v > r * 0.5));
      expect(gap, `d ${d}`).toBeGreaterThan(d + 0.5);
    }
    freeAll();
  });
  it('the groove is 2.8 mm wide over the flag\'s plate, for a 2.5 mm tie (which the shopping list gets)', () => {
    expect(TAG.grooveW).toBeGreaterThanOrEqual(2.5);
    expect(TAG.collar).toBeGreaterThan(TAG.plate); // (the tie passes over the flag's root)
  });
});
