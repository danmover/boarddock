// Cables settling: they never pass through each other or through what they route round, keep their length and stay
// in their plugs.
import { describe, it, expect } from 'vitest';
import { resample, settleCables, type SimCable } from '../src/cad/cablesim';

const minDist = (a: number[][], b: number[][]) => { let m = Infinity; for (const p of a) for (const q of b) m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); return m; };
const length = (a: number[][]) => a.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1], q[2] - a[i - 1][2]) : 0), 0);

describe('cables settling', () => {
  it('resamples at even steps and keeps the ends', () => {
    const r = resample([[0, 0, 0], [10, 0, 0], [10, 7, 0]], 2.5);
    expect(r[0]).toEqual([0, 0, 0]);
    expect(r[r.length - 1]).toEqual([10, 7, 0]);
    expect(length(r)).toBeCloseTo(17, 0);
  });
  it('two cables crossing: one goes over the other, the ends stay in their plugs', () => {
    const a: SimCable = { id: 'a', pts: [[-60, 0, 10], [60, 0, 10]], r: 2, pin: [8, 8] };
    const b: SimCable = { id: 'b', pts: [[0, -60, 10], [0, 60, 10]], r: 2, pin: [8, 8] };
    const res = settleCables([a, b], []);
    expect(minDist(res.paths[0], res.paths[1])).toBeGreaterThan(3.8);
    expect(res.touching).toEqual([]);
    expect(res.paths[0][0]).toEqual([-60, 0, 10]);
    expect(res.paths[1][res.paths[1].length - 1]).toEqual([0, 60, 10]);
    // lying on the table (their lowest point), so the second rides up over the first rather than the first going under
    const top = (p: number[][]) => Math.max(...p.map((q) => q[2]));
    expect(top(res.paths[1])).toBeGreaterThan(top(res.paths[0]));
  });
  it('two cables laid on the same line lie side by side', () => {
    const a: SimCable = { id: 'a', pts: [[0, 0, 5], [40, 0, 5], [160, 0, 5], [200, 0, 5]], r: 2, pin: [8, 8] };
    // (two plugs side by side, 6 mm apart; the router laid both cables on the same line between them)
    const b: SimCable = { id: 'b', pts: [[0, 6, 5], [40, 0, 5], [160, 0, 5], [200, 6, 5]], r: 2, pin: [8, 8] };
    const res = settleCables([a, b], []);
    const mid = (p: number[][]) => p[Math.floor(p.length / 2)];
    expect(Math.hypot(mid(res.paths[0])[0] - mid(res.paths[1])[0], mid(res.paths[0])[1] - mid(res.paths[1])[1], mid(res.paths[0])[2] - mid(res.paths[1])[2])).toBeGreaterThan(3.8);
    expect(res.touching).toEqual([]);
  });
  it('a cable is pushed out of a holder in its way, but not out of its own plug', () => {
    const c: SimCable = { id: 'c', pts: [[0, 0, 10], [100, 0, 10]], r: 2, pin: [8, 8], plugs: ['m/J1'] };
    const res = settleCables([c], [{ box: [40, -5, 0, 60, 5, 30] }, { box: [-5, -5, 5, 3, 5, 15], plug: 'm/J1' }]);
    // (it may brush the box by 0.8 mm, as a planned route may: boxes are the parts' bounds, not their shape)
    for (const q of res.paths[0]) if (q[0] > 40 - 2 && q[0] < 60 + 2) expect(Math.abs(q[1]) > 5 + 1.1 || q[2] > 30 + 1.1).toBe(true);
    expect(res.inside).toEqual([]);
    expect(res.paths[0][0]).toEqual([0, 0, 10]);
  });
  it('a fixed run (a ribbon) does not move; the cable settles round it', () => {
    const rib: SimCable = { id: 'rib', pts: [[0, -50, 10], [0, 50, 10]], r: 3, pin: [0, 0], fixed: true };
    const c: SimCable = { id: 'c', pts: [[-50, 0, 10], [50, 0, 10]], r: 2, pin: [8, 8] };
    const res = settleCables([rib, c], []);
    expect(res.paths[0].every((q) => q[0] === 0 && q[2] === 10)).toBe(true);
    expect(minDist(res.paths[0], res.paths[1])).toBeGreaterThan(4.8);
  });
  it('keeps its length (a settled cable is no more than a little longer than it was laid)', () => {
    const a: SimCable = { id: 'a', pts: [[-60, 0, 10], [60, 0, 10]], r: 2, pin: [8, 8] };
    const b: SimCable = { id: 'b', pts: [[0, -60, 10], [0, 60, 10]], r: 2, pin: [8, 8] };
    const res = settleCables([a, b], []);
    expect(length(res.paths[1])).toBeLessThan(120 * 1.08);
  });
});

describe('cables with weight', () => {
  it('a span in the air sags towards the floor, keeps its ends in the plugs and bends no tighter than it can', () => {
    const pts = [[0, 0, 60], [200, 0, 60]];
    const res = settleCables([{ id: 'a', pts, r: 2, pin: [10, 10], floor: 0 }], []);
    const path = res.paths[0], mid = path[Math.floor(path.length / 2)];
    expect(mid[2]).toBeLessThan(55); // it sags
    expect(path[0]).toEqual([0, 0, 60]);
    expect(path[path.length - 1]).toEqual([200, 0, 60]);
    // never tighter than about three diameters (a little give for the discrete beads)
    for (let i = 1; i + 1 < path.length; i++) {
      const u = path[i].map((v, j) => v - path[i - 1][j]), w = path[i + 1].map((v, j) => path[i + 1][j] - path[i][j]);
      const a = Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w)))));
      expect(Math.hypot(...u) / Math.max(1e-6, a)).toBeGreaterThan(3 * 4 * 0.6);
    }
  });
  it('lying on the floor it stays there', () => {
    const res = settleCables([{ id: 'a', pts: [[0, 0, 5], [100, 0, 5]], r: 2, pin: [5, 5] }], []);
    expect(Math.min(...res.paths[0].map((q) => q[2]))).toBeGreaterThanOrEqual(5 - 1e-9);
  });
});

describe('a busy rack settles', () => {
  it('no two cables pass through each other and none goes through a holder', async () => {
    const { initKernel } = await import('../src/cad/kernel');
    const { generate } = await import('../src/cad/assembly');
    const { TEMPLATES } = await import('../src/model/templates');
    const { newModule, newProject } = await import('../src/model/library');
    const { autoLinks } = await import('../src/model/links');
    await initKernel();
    const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
    const p = newProject(T('rpi5'));
    for (const id of ['rpi5', 'rpi4', 'usb_hub7', 'usb_hubc', 'uno', 'pico', 'usb_charger6']) p.modules.push(newModule(T(id)));
    p.links = autoLinks(p);
    const t0 = Date.now();
    const r = generate(p);
    const cables = r.report.cables ?? [];
    console.log('cables', cables.length, 'ms', Date.now() - t0, r.report.checks.filter((c) => /Cables settled|Cable routes/.test(c.name)).map((c) => `${c.name}: ${c.value} (${(c.detail ?? "").slice(0, 80)})`).join(' | '));
    console.log(r.report.warnings.filter((w) => /cable/i.test(w)).join('\n'));
    expect(cables.length).toBeGreaterThan(5);
    expect(r.report.checks.find((c) => c.name === 'Cables settled')?.value).toBe('none through another');
  }, 600000);
});
