import { it, expect } from 'vitest';
import { rectSection, solveFrame } from '../src/fea/frame3d';

it('frame solver matches a cantilever', () => {
  const s = rectSection(3, 4), E = 2100, L = 20, F = 10;
  for (const [f, I, c] of [[[0, 0, -F], s.Iy, s.cz], [[0, F, 0], s.Iz, s.cy]] as const) {
    const r = solveFrame([{ x: 0, y: 0, z: 0, fixed: true }, { x: L, y: 0, z: 0 }], [{ a: 0, b: 1, s, name: 'b' }], E, 0.38, [{ node: 1, f: [...f] as [number, number, number] }]);
    const defl = Math.hypot(r.u[6], r.u[7], r.u[8]);
    expect(defl).toBeCloseTo((F * L ** 3) / (3 * E * I), 6);
    expect(r.stress[0]).toBeCloseTo((F * L * c) / I, 6);
  }
  // vertical post
  const r = solveFrame([{ x: 0, y: 0, z: 0, fixed: true }, { x: 0, y: 0, z: L }], [{ a: 0, b: 1, s, name: 'p' }], E, 0.38, [{ node: 1, f: [F, 0, 0] }]);
  expect(Math.abs(r.u[6])).toBeGreaterThan(0);
});
