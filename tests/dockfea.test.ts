import { it, expect } from 'vitest';
import { initKernel, csLoops } from '../src/cad/kernel';
import { latchProfile, noseProfile, shoeProfile, shoe, socket } from '../src/cad/dock';
import { dockFea } from '../src/fea/dockfea';

it('dock parts are single solids and the 2D FEA runs', async () => {
  await initKernel();
  for (const [n, m] of [['shoe', shoe()], ['socket', socket()]] as const) {
    console.log(n, 'pieces', m.decompose().length, 'vol', (m.volume() / 1000).toFixed(2), 'cm3');
    expect(m.decompose().length).toBe(1);
  }
  const latch = csLoops(latchProfile().add(noseProfile()));
  const sh = csLoops(shoeProfile());
  for (const [mat, E] of [['PETG', 2100], ['PLA', 3500]] as const) {
    const r = dockFea(latch, sh, E, 0.38, Number(process.env.H ?? 0.1));
    for (const c of r.cases) console.log(mat, c.name, c.force.toFixed(2), 'N', (c.peakStrain * 100).toFixed(2) + '%', (c.p99Strain * 100).toFixed(2) + '%', c.notes.join('; '));
    console.log('elements', r.mesh.elements);
  }
}, 300000);

it('test-fit kit: four single-piece parts, no supports needed', async () => {
  const { testKit } = await import('../src/cad/testkit');
  const { printability } = await import('../src/cad/export');
  await initKernel();
  const parts = testKit(0.1);
  expect(parts.map((p) => p.id)).toEqual(['kit_shoe', 'kit_socket', 'kit_key', 'kit_rod']);
  for (const p of parts) {
    const q = printability(p.mesh);
    console.log(p.name, (p.volume / 1000).toFixed(2), 'cm3', p.size.map((v) => v.toFixed(1)).join(' x '), 'overhang', q.slope.toFixed(1), 'span', q.span.toFixed(1));
    expect(q.slope).toBeLessThan(8);
  }
}, 300000);
