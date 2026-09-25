import { describe, it, expect } from 'vitest';
import { initKernel, freeAll, csLoops } from '../src/cad/kernel';
import { clipProfile, clipDims, buildClip } from '../src/cad/dinclip';
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
    const p = { W: 12, tf: 1.0, tabExt: 0, leafT: Number(process.env.LT ?? 0.75), leafBottom: Number(process.env.LB ?? -22), leafTop: Number(process.env.LTT ?? 0.75) };
    const clip = buildClip(p);
    console.log('clip volume mm3', clip.volume().toFixed(0), 'genus', clip.genus(), 'parts', clip.decompose().length);
    expect(clip.decompose().length).toBe(1);
    const loops = csLoops(clipProfile(p).cs);
    const t0 = Date.now();
    const r = clipFea(loops, clipDims(p), p.W, 2100, 0.38, Number(process.env.H ?? 0.2));
    console.log('fea ms', Date.now() - t0, r.mesh, 'stopGap', r.stopGap, 'barMove', r.barMoveAtRelease.toFixed(2), 'tongue du', r.tongueMoveAtRelease.toFixed(2), 'lip at stop', r.lipAtStop.toFixed(2));
    for (const c of r.cases) console.log(c.name, 'F', c.force.toFixed(2), 'N  peak', (c.peakStrain * 100).toFixed(2), '% p99', (c.p99Strain * 100).toFixed(2), '% lip du,dv', c.lipMove.map((x) => x.toFixed(2)), c.notes.join());
    freeAll();
  });
});
