import { describe, it, expect } from 'vitest';
import { initKernel, freeAll, csLoops, rect2 } from '../src/cad/kernel';
import { clipProfile, clipDims, buildClip, clipSlots, hookMove, JAW_FEA, JAW_STOP_FEA } from '../src/cad/dinclip';
import { clipFea } from '../src/fea/clipfea';
import { cantileverCheck } from '../src/fea/fea2d';

describe('DIN clip', () => {
  it('2D solver matches beam theory', () => {
    const c = cantileverCheck(0.1);
    console.log('cantilever', c);
    expect(Math.abs(c.fea / c.exact - 1)).toBeLessThan(0.03);
    expect(Math.abs(c.eps / c.epsExact - 1)).toBeLessThan(0.05);
  });
  it('clip is one valid solid and releases within strain limits', async () => {
    await initKernel();
    const p = { W: 12, tf: 1.0, tabExt: 0 };
    const clip = buildClip(p);
    console.log('clip volume mm3', clip.volume().toFixed(0), 'genus', clip.genus(), 'parts', clip.decompose().length);
    expect(clip.decompose().length).toBe(1);
    const loops = csLoops(clipProfile(p).cs);
    const d = clipDims(p);
    const t0 = Date.now();
    const r = clipFea(loops, d, p.W, 2100, 0.38, Number(process.env.H ?? 0.1));
    console.log('fea ms', Date.now() - t0, r.mesh, 'stopGap', r.stopGap, 'barMove', r.barMoveAtRelease.toFixed(2), 'lip at stop', r.lipAtStop.toFixed(2), 'strain at the stop', (r.stopStrain * 100).toFixed(2), '%');
    for (const c of r.cases) console.log(c.name, 'F', c.force.toFixed(2), 'N  leaf peak', (c.flexPeak * 100).toFixed(2), '% p99', (c.flexP99 * 100).toFixed(2), '% lip du,dv', c.lipMove.map((x) => x.toFixed(2)), 'bar', c.barMove.toFixed(2), c.notes.join());
    // the jaw's leaf (17 mm, it read 2.0% at 10 mm): every way of letting go, and clipping on, under 1% at its target...
    const jaw = r.cases.filter((c) => !/Rail grip/.test(c.name));
    expect(jaw.length).toBe(4);
    for (const c of jaw) expect(c.flexPeak, c.name).toBeLessThanOrEqual(JAW_FEA);
    // ...the stop lets the lip drop the distance it needs, in the natural direction (down and back), and holds the leaf under 1% when yanked
    expect(r.lipAtStop).toBeGreaterThan(d.travel);
    for (const c of jaw.slice(0, 3)) expect(c.barMove, c.name).toBeLessThan(r.stopGap);
    expect(r.stopStrain).toBeLessThan(0.01);
    for (const c of jaw) expect(c.flexPeak * (r.stopGap / c.barMove), c.name).toBeLessThanOrEqual(JAW_STOP_FEA);
    // the release takes a couple of newtons
    expect(jaw[0].force).toBeLessThan(6);
    // the rail grip holds the 12 mm clip down on the top flange with about 6 N (it only located before)
    const g = r.cases.find((c) => /Rail grip/.test(c.name))!;
    expect(g.force).toBeGreaterThan(4);
    expect(g.force).toBeLessThan(10);
    expect(g.p99Strain).toBeLessThan(0.01);
    freeAll();
  }, 300000);

  it('the stop is stiff: the leg is a gusset, not a spring, and the leaf clears it all the way down', async () => {
    await initKernel();
    const p = { W: 14, tf: 1.0, tabExt: 0 }, d = clipDims(p), cs = clipProfile(p).cs;
    // (a plain 1.4 mm leg 19 mm long would give 0.7 mm to a 3 N knock; the gusset is 1.8 mm thick at its root, 1.0 at the bar)
    const at = (v: number) => { const b = cs.intersect(rect2(d.legU - 1.5, v, d.uF + 0.1, v + 0.01)).bounds(); return b.max[0] - b.min[0]; };
    expect(at(-13)).toBeGreaterThan(at(-30) + 0.4);
    expect(at(-30)).toBeCloseTo(d.uF - d.legU, 1); // (vertical from -22 down: the stop is exactly `stopGap` from the bar)
    expect(at(-30)).toBeGreaterThan(0.9);
    // the bar meets the leg at the stop: 2.3 mm across at the bar's height
    const bar = cs.intersect(rect2(d.barEnd, d.barV[0] + 0.3, d.legU - 0.001, d.barV[1] - 0.3));
    expect(bar.isEmpty()).toBe(true);
    freeAll();
  });

  it('the holder hooks catch behind the plate\'s slots without touching them, each a beam that clears its neighbours', async () => {
    await initKernel();
    for (const W of [8, 14, 20]) {
      const p = { W, tf: 1.0, tabExt: 0 }, d = clipDims(p), cs = clipProfile(p).cs, sl = clipSlots(W, d.HA);
      // the plate, 2 mm thick over the front face, with its two slots across the clip's width: the barbs go through them
      let plate = rect2(d.uF, -30, d.uF + sl.plateT, 40);
      for (const s of [1, -1]) { const v = d.vc + s * sl.HA; plate = plate.subtract(rect2(d.uF - 0.1, v - 0.925, d.uF + sl.plateT + 0.1, v + 0.925)); }
      expect(cs.intersect(plate).area(), `W ${W}`).toBeLessThan(1e-6); // nothing of the clip is in the plate at rest
      // a catch behind it: each barb's flat face stands `catch` mm past its slot's edge
      const back = cs.intersect(rect2(d.uF + sl.plateT, -30, d.uF + sl.plateT + 3, 40));
      const { catch: c } = hookMove();
      expect(c).toBeGreaterThan(0.25);
      for (const s of [1, -1]) {
        const v = d.vc + s * sl.HA, edge = v + s * 0.925;
        const b = back.intersect(rect2(d.uF + sl.plateT + 0.05, Math.min(v, v + s * 3), d.uF + sl.plateT + 2, Math.max(v, v + s * 3))).bounds();
        const far = s > 0 ? b.max[1] : b.min[1];
        expect(Math.abs(far - edge), `W ${W} side ${s}`).toBeCloseTo(c, 1);
      }
    }
    freeAll();
  });
});

describe('DIN clip under a box', () => {
  it('stands a box on a flat clip clear of the snap hooks that come up through its base', async () => {
    const { generate } = await import('../src/cad/assembly');
    const { newProject, setLayout } = await import('../src/model/library');
    const { makeBox } = await import('../src/model/boxes');
    const { measure } = await import('./collide/measure');
    await initKernel();
    // the hooks reach 1.9 mm above the base they grip; a box used to sit 1.2 mm up, so each went 0.7 mm into it
    for (const k of ['hub7', 'charger4', 'hub4'] as const) {
      const p = newProject(makeBox(k));
      setLayout(p, 'loose');
      p.mount = { ...p.mount, kind: 'din', mode: 'flat', picked: true };
      const r = generate(p);
      expect(r.parts.some((x) => x.tag?.kind === 'clip'), k).toBe(true);
      expect(measure(p, r).cats['holder-board'].vol, k).toBeLessThan(0.5); // (was about 23 mm³, two hooks)
    }
  }, 120_000);
});
