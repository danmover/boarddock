import { describe, it, expect } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { bestDock } from '../src/cad/dockplan';
import { writeFileSync } from 'fs';
import { writeStl } from '../src/cad/export';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('panel of DIN rail docks', () => {
  it('orients a Pi 4 so no plug faces the wall', () => {
    const p = newProject(T('rpi4'));
    for (const d of ['h', 'v'] as const) {
      const o = bestDock(p.modules[0], d);
      console.log('pi4', d, o.edge, o.turn, o.score.toFixed(1), o.access.map((a) => `${a.ref}:${a.dir}/${a.ok}`).join(' '));
      expect(o.access.some((a) => a.ok === 'blocked')).toBe(false);
    }
  });
  for (const rowDir of ['h', 'v'] as const) {
    it(`auto layout, ${rowDir} rails`, async () => {
      await initKernel();
      const p = newProject(T('rpi4'));
      p.modules.push(newModule(T('pico')), newModule(T('uno')), newModule(T('rpi_zero')), newModule(T('nano')));
      p.panel.rowDir = rowDir;
      p.panel.maxRail = 250;
      const r = generate(p);
      const pr = r.report.panel!;
      console.log(rowDir, r.report.timeMs + 'ms', 'rails', pr.rails.map((x) => `${x.id}@${x.x.toFixed(0)},${x.y.toFixed(0)} ${x.length}mm`).join(' '), '| mounts', pr.mounts.map((m) => `${m.id} t${m.turn} at${m.at.toFixed(0)} [${m.slots.map((s) => s.module ?? '-').join(',')}]`).join(' '));
      console.log(r.parts.map((x) => `${x.id}x${x.qty}:${(x.volume / 1000).toFixed(1)}`).join(' '));
      console.log(r.report.warnings.join('\n'));
      for (const m of pr.modules) console.log(m.id, m.edge, m.turn, m.access.map((a) => `${a.ref}:${a.dir}`).join(' '));
      expect(r.parts.filter((x) => x.id.endsWith('holder')).length).toBe(5);
      expect(r.parts.filter((x) => x.id.endsWith('rod')).length).toBe(5);
      expect(pr.collisions.length).toBe(0);
      expect(r.report.warnings.some((w) => /loose piece/.test(w))).toBe(false);
      if (process.env.OUT && rowDir === 'h') for (const pt of r.parts) writeFileSync(`${process.env.OUT}/${pt.id}.stl`, writeStl([pt.mesh]));
    }, 300000);
  }
});

describe('manual panel layouts', () => {
  it('vertical rail with a flat clip, turned docks and an empty dock', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('pico')), newModule(T('blank')));
    const [a, b, c] = p.modules.map((m) => m.id);
    p.panel.auto = false;
    p.panel.rails = [{ id: 'r1', x: 0, y: 0, dir: 'v', length: null }, { id: 'r2', x: 250, y: 0, dir: 'h', length: 300 }];
    p.panel.mounts = [
      { id: 'd1', rail: 'r1', at: null, kind: 'dock', turn: 90, slots: [{ module: a, edge: 'auto' }, { module: b, edge: 'left' }] },
      { id: 'd2', rail: 'r1', at: null, kind: 'dock', turn: 0, slots: [{ module: null, edge: 'auto' }, { module: null, edge: 'auto' }] },
      { id: 'f1', rail: 'r2', at: 120, kind: 'flat', turn: 90, slots: [{ module: c, edge: 'auto' }] },
    ];
    const r = generate(p);
    const pr = r.report.panel!;
    console.log(pr.mounts.map((m) => `${m.id}@${m.rail}:${m.at.toFixed(0)} (${m.x.toFixed(0)},${m.y.toFixed(0)})`).join(' '), '|', r.report.warnings.join(' / '));
    expect(pr.modules.length).toBe(3);
    expect(pr.mounts.find((m) => m.id === 'd2')!.at).toBeGreaterThan(pr.mounts.find((m) => m.id === 'd1')!.at);
    expect(r.parts.find((x) => x.id === 'dock_shoe')!.qty).toBe(2);
    expect(r.parts.some((x) => x.id.endsWith('_clip'))).toBe(true);
    // vertical rail: the dock sits on x = 0, above the rail start
    expect(Math.abs(pr.mounts[0].x)).toBeLessThan(0.01);
    expect(pr.mounts[0].y).toBeGreaterThan(0);
  }, 300000);
});
