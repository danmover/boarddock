import { it, expect } from 'vitest';
import { initKernel, csLoops } from '../src/cad/kernel';
import { holdFeaProfiles, latchProfile, noseProfile, shoeFeaProfiles, shoe, socket } from '../src/cad/dock';
import { dockFea, type DockFeaResult } from '../src/fea/dockfea';
import { assemble2D, meshPolygons, pcg, q6Element } from '../src/fea/fea2d';

it('dock parts are single solids and the 2D FEA runs', async () => {
  await initKernel();
  for (const [n, m] of [['shoe', shoe()], ['socket', socket()]] as const) {
    console.log(n, 'pieces', m.decompose().length, 'vol', (m.volume() / 1000).toFixed(2), 'cm3');
    expect(m.decompose().length).toBe(n === 'shoe' ? 2 : 1); // the shoe's release lever is printed in place
  }
  const latch = csLoops(latchProfile().add(noseProfile()));
  const sp = shoeFeaProfiles(), sh = csLoops(sp.jaw), gr = csLoops(sp.grip), hp = holdFeaProfiles(), hold = { side: csLoops(hp.side), lift: csLoops(hp.lift) };
  let petg: DockFeaResult | undefined;
  for (const [mat, E] of [['PETG', 2100], ['PLA', 3500]] as const) {
    const r = dockFea(latch, sh, E, 0.38, Number(process.env.H ?? 0.1), undefined, gr, undefined, hold);
    if (E < 3000) petg = r;
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
    // the anti-rattle leaves: about 1 N each at rest (the tongue's two press it back onto its divider, the pedestal's two
    // hold it up on the latch's catch), inside the strain limit at rest, at the stop and pressed home
    const sl = r.cases.find((c) => /side leaf/.test(c.name))!, ll = r.cases.find((c) => /lift leaf/.test(c.name))!;
    if (E < 3000) { expect(sl.force).toBeGreaterThan(0.6); expect(sl.force).toBeLessThan(2); expect(ll.force).toBeGreaterThan(0.8); expect(ll.force).toBeLessThan(2.2); }
    expect(sl.peakStrain).toBeLessThan(0.01);
    expect(ll.peakStrain).toBeLessThan(0.0155);
    expect(Number(/knock that closes the slot \(0\.5 mm\): ([\d.]+)% peak/.exec(sl.notes[1])![1])).toBeLessThan(2);
    // the whole shoe pulled off the rail, not only its jaw: the fixed hook's finger, the floor and the hook beams with
    // the slit walls carry it too. PETG reaches its limit at about 80 N pulling on one hook (120 N on both): the socket's
    // hook beams first, then the fixed hook's finger; the hinge is not the weakest part
    const both = r.cases.find((c) => /pull on the socket/.test(c.name))!, one = r.cases.find((c) => /pull on one hook/.test(c.name))!;
    expect(both.notes[0]).toMatch(/fixed hook takes (4\d|5\d|6\d)%/);
    expect(both.notes[1]).toMatch(/fixed hook finger/);
    if (E < 3000) { expect(both.peakStrain).toBeLessThan(0.02); expect(one.peakStrain).toBeLessThan(0.03); expect(one.peakStrain).toBeGreaterThan(both.peakStrain); }
  }
  // the pixel grid's origin no longer moves the results: half a pixel over in both directions, every force and peak
  // stays within a few percent (a third for forces and 10 to 20% for peaks before; the thin leaves' peaks a bit more)
  const moved = dockFea(latch, sh, 2100, 0.38, Number(process.env.H ?? 0.1), undefined, gr, [0.5, 0.5], hold);
  moved.cases.forEach((c, i) => {
    const a = petg!.cases[i];
    console.log(c.name, 'force', (c.force / a.force).toFixed(3), 'peak', (c.peakStrain / a.peakStrain).toFixed(3), 'p99', (c.p99Strain / a.p99Strain).toFixed(3));
    expect(Math.abs(c.force / a.force - 1), `${c.name}: force`).toBeLessThan(0.05);
    expect(Math.abs(c.peakStrain / a.peakStrain - 1), `${c.name}: peak`).toBeLessThan(0.12);
    expect(Math.abs(c.p99Strain / a.p99Strain - 1), `${c.name}: 99%`).toBeLessThan(0.12);
  });
}, 900000);

it('the FEA pixel grid sits on multiples of h, and a thin beam is as stiff whichever way the grid falls on it', () => {
  // a 0.85 mm beam on a 0.1 mm grid (8.5 pixels): its tip deflection against beam theory, at three grid phases
  const L = 20, t = 0.85, W = 4, E = 2100, h = 0.1, loop: [number, number][] = [[0, 0], [L, 0], [L, t], [0, t]];
  const tip = (phase: [number, number]) => {
    const m = meshPolygons([loop], h, phase), { Ke } = q6Element(h, E, 0.38, W), S = assemble2D(m, Ke);
    const fixed = new Uint8Array(S.n), f = new Float64Array(S.n), ids: number[] = [];
    let x0 = Infinity;
    for (let i = 0; i < m.nNodes; i++) x0 = Math.min(x0, m.nodeXY[2 * i]);
    for (let i = 0; i < m.nNodes; i++) { const x = m.nodeXY[2 * i]; if (x < x0 + 1e-9) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; } if (x > L - 0.06) ids.push(i); }
    for (const i of ids) f[2 * i + 1] = 1 / ids.length;
    const u = pcg(S, f, fixed, 1e-10).u;
    return ids.reduce((s, i) => s + u[2 * i + 1], 0) / ids.length;
  };
  const theory = L ** 3 / (3 * E * ((W * t ** 3) / 12));
  const d = ([[0, 0], [0.5, 0], [0.25, 0.75]] as [number, number][]).map(tip);
  console.log('beam tip vs theory', d.map((v) => (v / theory).toFixed(3)).join(' '));
  for (const v of d) expect(Math.abs(v / theory - 1)).toBeLessThan(0.08);
  expect(Math.max(...d) / Math.min(...d) - 1).toBeLessThan(0.06);
  // the grid does not follow the outline's bounds: the same beam with a speck of geometry far below it
  const a = meshPolygons([loop], h), b = meshPolygons([loop, [[5, -33.33], [5.2, -33.33], [5.2, -33.1]]], h);
  expect(Math.abs(b.y0 / h - Math.round(b.y0 / h))).toBeLessThan(1e-6);
  expect(Math.abs(a.x0 / h - Math.round(a.x0 / h))).toBeLessThan(1e-6);
  expect(a.x0).toBeCloseTo(b.x0, 9);
});

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
  const { tongue, holdBumps } = await import('../src/cad/dock');
  const { box } = await import('../src/cad/kernel');
  // (the corner bumps of its anti-rattle leaves are pressed into the socket's corners on purpose: dockhold.test.ts)
  const s = socket(), t = tongue(0.2, 0).subtract(holdBumps(0).all);
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
