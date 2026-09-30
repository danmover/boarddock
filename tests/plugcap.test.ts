// Plug caps: tapered legs with fillets, a ledge on the cradle sized from the leg's length so that no cap goes over 1%
// at its click, and nothing pressing once it is on. The old legs (1.1 mm straight, a 0.7 mm ledge) read 1.2% at 9.5 mm.
import { beforeAll, describe, expect, it } from 'vitest';
import { csLoops, freeAll, initKernel, rect2 } from '../src/cad/kernel';
import { CAP, capLeg, capProfile } from '../src/cad/plugcap';
import { pushStrain } from '../src/fea/beamfea';
import { generate } from '../src/cad/assembly';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';

describe('the leg sizing', () => {
  it('a longer leg gets a deeper ledge, and every leg from 7.5 mm up reads under 1% at its click', () => {
    let last = 0;
    for (const L of [6, 7, 7.5, 8, 9.5, 12, 17.6]) {
      const c = capLeg(L);
      expect(c.ledge, `L ${L}`).toBeGreaterThanOrEqual(last);
      last = c.ledge;
      if (L >= 7.5) expect(c.strain, `L ${L}`).toBeLessThan(0.01);
    }
    // the shortest seen in the library (a micro-USB plug low on its board): the old straight 1.1 mm legs with 0.65 mm to spring read 1.2%
    expect(3 * 1.1 * 0.65 / (2 * 9.5 * 9.5)).toBeGreaterThan(0.011);
    expect(capLeg(9.5).strain).toBeLessThan(0.009);
  });
});

describe('the profile', () => {
  beforeAll(async () => { await initKernel(); });
  it('is one piece with its hooks under the ledges, legs clear of them at rest and the 2D FEA under 1% at each click', () => {
    for (const L of [9.5, 12]) {
      const leg = capLeg(L), gp = leg.ledge + CAP.gap;
      const prof = capProfile(0, 12, 0, L, leg);
      expect(prof.decompose().length).toBe(1);
      // the hook's tip stands 0.1 off the wall (x = 0) and reaches under the ledge, which reaches `ledge` from the wall
      const hookTip = prof.intersect(rect2(-gp - 2, -0.5, 1, -0.1)).bounds().max[0];
      expect(hookTip).toBeCloseTo(-CAP.wall, 1);
      const r = pushStrain(csLoops(prof), {
        t: 8, h: 0.1,
        fixed: (x, y) => y > L - 0.05 && x > -gp - CAP.root - 1 && x < 12 + gp + CAP.root + 1,
        load: (x, y) => x > -gp + (gp - CAP.wall) - 0.2 && x < -CAP.wall + 0.05 && y > -0.6 && y < 0,
        dir: [-1, 0], probe: [-CAP.wall, -0.3], along: [-1, 0], target: leg.move,
        region: (x, y) => x < -gp + 3 && y > 0.2,
      });
      expect(r.peak, `L ${L}`).toBeLessThan(0.0105);
    }
    freeAll();
  });
});

describe('in the racks', () => {
  beforeAll(async () => { await initKernel(); });
  it('every cap the templates get has legs under 1% and says how they click', () => {
    let n = 0;
    for (const id of ['rpi4', 'rpi_zero', 'pico', 'uno', 'nano', 'esp32']) {
      const p = newProject(TEMPLATES.find((t) => t.id === id)!.make());
      const r = generate(p);
      for (const c of (r.report.checks ?? []).filter((x) => /^Cap legs/.test(x.name))) {
        n++;
        expect(parseFloat(c.value), `${id} ${c.name}`).toBeLessThan(1);
        expect(c.status).toBe('ok');
        expect(c.detail).toMatch(/tapering to 0.9 mm/);
      }
      for (const pt of r.parts.filter((x) => x.tag?.kind === 'cap')) expect(pt.qty).toBe(1);
    }
    expect(n).toBeGreaterThan(3);
    freeAll();
  }, 300000);
});
