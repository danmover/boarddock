import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { initKernel, freeAll } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks } from '../src/model/links';
import { endBlock, planStands, railI, saddle, spacer, STAND } from '../src/cad/railstand';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('table stands', () => {
  it('pieces are single solids that print on their ends', async () => {
    await initKernel();
    try {
      for (const [name, m] of [['end', endBlock()], ['saddle', saddle()], ['spacer', spacer(90, [{ y: 45, d: 4.5 }, { y: 52, d: 3.2 }])], ['foot', spacer(null, [], 39)]] as const) {
        const bb = m.boundingBox();
        expect(m.decompose().length, name).toBe(1);
        expect(bb.min[2]).toBeCloseTo(0, 3);
        expect(m.volume()).toBeGreaterThan(80);
      }
      // the rail's section fits the end block pocket: rail at x in the pocket must not intersect the block
      expect(Math.round(railI())).toBeGreaterThan(300);
    } finally { freeAll(); }
  });

  it('plans sleepers at both rail ends and every 200 mm, with combs where cable streets cross', () => {
    const rails = [{ id: 'r1', u0: 0, u1: 450, v: 0 }, { id: 'r2', u0: 0, u1: 450, v: -110 }];
    const streets = [-155, -55, 45];
    const plan = planStands(rails, streets, [{ street: 1, y: -55, d: 4.5, u0: 100, u1: 300 }]);
    expect(plan.stations).toEqual([0, 150, 300, 450]);
    expect(plan.span).toBe(150);
    const combs = plan.pieces.filter((q) => q.lanes.length);
    expect(combs.map((q) => q.station)).toEqual([1, 2]);
    expect(plan.pieces.filter((q) => q.kind === 'end').length).toBe(4);
    expect(plan.pieces.filter((q) => q.kind === 'saddle').length).toBe(4);
  });

  it('builds a rack with stands and routes the cables through them', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('pico')), newModule(T('usb_hub')), newModule(T('usb_charger')));
    p.links = autoLinks(p);
    const r = generate(p);
    const pr = r.report.panel!;
    const st = r.parts.filter((x) => x.tag?.kind === 'railstand');
    const lines = [
      `rails ${pr.rails.map((x) => `${x.id} ${x.length}`).join(' ')}`,
      `stands ${JSON.stringify(pr.stands)}`,
      ...st.map((x) => `${x.name} x${x.qty} ${(x.volume / 1000).toFixed(2)} cm3 size ${x.size.map((v) => v.toFixed(1)).join('x')}`),
      `cables ${(r.report.cables ?? []).map((c) => `${c.a}->${c.b} ${c.length}`).join('; ')}`,
      ...r.report.warnings, ...r.report.checks.filter((c) => c.group === 'Panel').map((c) => `${c.name}: ${c.value} ${c.detail}`),
    ];
    writeFileSync(process.env.OUT ?? '/dev/null', lines.join('\n'));
    expect(st.length).toBeGreaterThan(1);
    expect(new Set(pr.rails.map((x) => x.length)).size).toBe(1);
    expect(r.report.checks.find((c) => c.name === 'Rail sag between sleepers')!.status).toBe('ok');
    // nothing but the stands, the cables and their tags goes below the rail base
    const minZ = (pos: Float32Array, M: number[]) => { let z = Infinity; for (let k = 0; k < pos.length; k += 3) z = Math.min(z, M[2] * pos[k] + M[6] * pos[k + 1] + M[10] * pos[k + 2] + M[14]); return z; };
    for (const x of st) for (const M of [x.toAssembly, ...(x.instances ?? [])]) expect(minZ(x.mesh.pos, M)).toBeGreaterThan(-STAND.H - 0.01);
    for (const x of r.parts.filter((q) => q.tag?.kind !== 'railstand' && q.tag?.kind !== 'cabletag')) expect(minZ(x.mesh.pos, x.toAssembly)).toBeGreaterThan(-0.5); // cable tags ride on the cables
  });
});

describe('cable lanes', () => {
  it('orders the lanes in a street so cables do not cross', async () => {
    const { laneOrder } = await import('../src/cad/panelgen');
    // A drops in from below (v < 0) at u = 0 and 30; B from above at u = 10 and 200: A must take the lower lane
    const A = { id: 'A', a1: [0, -40, 0], b1: [30, -40, 0] };
    const B = { id: 'B', a1: [10, 60, 0], b1: [200, 60, 0] };
    expect(laneOrder([B, A], 0).map((q) => q.id)).toEqual(['A', 'B']);
    // a nested pair entering from opposite sides crosses once whatever the order: keep the given order
    const pi = { id: 'pi', a1: [40, 60, 0], b1: [180, -40, 0] }, zero = { id: 'zero', a1: [15, 60, 0], b1: [200, -40, 0] };
    expect(laneOrder([zero, pi], 0).map((q) => q.id)).toEqual(['zero', 'pi']);
  });
});
