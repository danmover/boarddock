import { it, expect } from 'vitest';
import { initKernel, csLoops } from '../src/cad/kernel';
import { latchProfile, noseProfile, shoeFeaProfiles, shoe, socket } from '../src/cad/dock';
import { dockFea } from '../src/fea/dockfea';

it('dock parts are single solids and the 2D FEA runs', async () => {
  await initKernel();
  for (const [n, m] of [['shoe', shoe()], ['socket', socket()]] as const) {
    console.log(n, 'pieces', m.decompose().length, 'vol', (m.volume() / 1000).toFixed(2), 'cm3');
    expect(m.decompose().length).toBe(n === 'shoe' ? 2 : 1); // the shoe's release lever is printed in place
  }
  const latch = csLoops(latchProfile().add(noseProfile()));
  const sp = shoeFeaProfiles(), sh = csLoops(sp.jaw), gr = csLoops(sp.grip);
  for (const [mat, E] of [['PETG', 2100], ['PLA', 3500]] as const) {
    const r = dockFea(latch, sh, E, 0.38, Number(process.env.H ?? 0.1), undefined, gr);
    for (const c of r.cases) console.log(mat, c.name, c.force.toFixed(2), 'N', (c.peakStrain * 100).toFixed(2) + '%', (c.p99Strain * 100).toFixed(2) + '%', c.notes.join('; '));
    console.log('elements', r.mesh.elements);
    // the release lever: a light press, about 5 mm of pad travel (the hook bears with its lower end, 8 to 11 mm under
    // the pin, not 6.9: it was given as 1.4 N and 8 mm)
    const rel = r.cases.find((c) => /release lever/.test(c.name))!;
    expect(rel.force).toBeLessThan(E > 3000 ? 5 : 3);
    expect(Number(/pad down ([\d.]+) mm/.exec(rel.notes[0])![1])).toBeGreaterThan(4);
    expect(Number(/pad down ([\d.]+) mm/.exec(rel.notes[0])![1])).toBeLessThan(6);
    // the rail grip: a real preload (about 10 N in PETG), well inside the strain limit
    const g = r.cases.find((c) => /rail grip/.test(c.name))!;
    if (E < 3000) { expect(g.force).toBeGreaterThan(7); expect(g.force).toBeLessThan(13); }
    expect(g.p99Strain).toBeLessThan(0.008);
    expect(g.peakStrain).toBeLessThan(0.015);
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

it('the 14 x 4.5 mm tongue seats in the socket, the latch nose in its groove', async () => {
  await initKernel();
  const { tongue } = await import('../src/cad/dock');
  const { box } = await import('../src/cad/kernel');
  const s = socket(), t = tongue(0.2, 0);
  // nothing of the tongue is inside the socket's plastic
  expect(s.intersect(t).volume()).toBeLessThan(0.05);
  // take the nose (its window is at z -8.15..-5.05, y 3.95..6.65) out of the picture: the rest of the socket still
  // clears the tongue by its 0.2 mm, and the nose really reaches into the groove
  const noseZone = box(-5, 3.5, -8.2, 5.3, 6.7, -5.0);
  expect(s.intersect(noseZone).volume()).toBeGreaterThan(5); // the nose is there
  // with the latch groove filled in, the tongue would hit the nose: the nose engages
  const solid = t.add(box(-4.8, 3.8, -8.25, 4.8, 5.0, -4.8));
  expect(s.intersect(solid).volume()).toBeGreaterThan(1);
  // and the tongue's cross-section at the mouth is 14 x 4.5 mm (less the corner chamfers)
  const slab = t.intersect(box(-10, -10, -1, 10, 10, -0.9));
  expect(slab.volume() / 0.1).toBeGreaterThan(14 * 4.5 - 4.5);
}, 120000);
