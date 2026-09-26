import { describe, it, expect } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { detectHoleRoles, stackAlign, stackLayers, stackMode } from '../src/model/holes';
import type { Board, Comp } from '../src/model/types';
import { printability } from '../src/cad/export';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

/** A Pi HAT: 65 x 56.5 with the Pi's 58 x 49 mounting pattern, lined up on the Pi's left edge. */
function hat(): Board {
  const b = T('blank');
  b.name = 'Sense HAT';
  b.outline = [[0, 0], [65, 0], [65, 56.5], [0, 56.5]];
  b.holes = [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].map(([x, y], i) => ({ id: `hh${i}`, x, y, d: 2.75, plated: true, use: 'auto' as const }));
  b.comps = [];
  return b;
}

describe('hole wizard', () => {
  it('tells mounting holes from connector pegs, header pins and stacking standoffs', () => {
    const b = T('blank');
    const conn: Comp = { id: 'j1', ref: 'J1', pkg: 'RJ45', side: 'top', x: 30, y: 30, rot: 0, w: 16, l: 21, h: 13.5, kind: 'connector', tht: true };
    b.comps.push(conn);
    b.holes.push({ id: 'peg', x: 30, y: 27, d: 3.25, plated: false, use: 'auto' });
    for (let k = 0; k < 4; k++) b.holes.push({ id: `pin${k}`, x: 12 + k * 2.54, y: 20, d: 1.0, plated: true, use: 'auto' });
    const g = new Map(detectHoleRoles(b).map((x) => [x.id, x]));
    expect(g.get('peg')!.role).toBe('plug');
    expect(g.get('pin1')!.role).toBe('lead');
    expect(b.holes.filter((h) => h.id.startsWith('h') || /^[0-9a-z]{6,}/.test(h.id)).length).toBeGreaterThan(0);
    const mounts = [...g.values()].filter((x) => x.role === 'mount');
    expect(mounts.length).toBe(4);
  });

  it('lines a HAT up on the shared holes and marks them as standoffs', () => {
    const pi = T('rpi4'), h = hat();
    const a = stackAlign(pi, h);
    expect(a.matched).toBe(4);
    expect(Math.abs(a.dx)).toBeLessThan(0.01);
    const roles = detectHoleRoles(pi, [h]);
    expect(roles.every((r) => r.role === 'standoff')).toBe(true);
  });
});

describe('stacks on the rails', () => {
  it('a bolted HAT rides on the Pi holder; a printed layer gets its own holder on towers', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    const hm = newModule(hat());
    const top = newModule(T('pico'));
    p.modules.push(hm, top);
    hm.on = p.modules[0].id;
    top.on = hm.id;
    expect(stackMode(p, hm)).toBe('bolted');
    expect(stackMode(p, top)).toBe('towers');
    const L = stackLayers(p, p.modules[0]);
    expect(L.length).toBe(2);
    expect(L[0].bolted.map((b) => b.mod.id)).toEqual([hm.id]);
    for (const h of p.modules[0].board.holes) h.role = 'standoff';
    const r = generate(p);
    const pr = r.report.panel!;
    const holders = r.parts.filter((x) => x.tag?.kind === 'holder');
    expect(holders.map((x) => x.tag!.module).sort()).toEqual([p.modules[0].id, top.id].sort());
    expect(pr.mounts.length).toBe(1);
    expect(pr.unplaced.length).toBe(0);
    expect(r.ghosts.some((g) => g.tag?.kind === 'board' && g.tag.module === hm.id)).toBe(true);
    expect(r.report.features!.some((f) => f.kind === 'tower')).toBe(true);
    for (const h of holders) expect(printability(h.mesh).slope).toBeLessThan(8);
    expect(r.report.warnings.some((w) => /loose piece/.test(w))).toBe(false);
  }, 300000);
});

describe('frame holders', () => {
  it('are one piece, need no supports and use less plastic than trays', async () => {
    await initKernel();
    for (const [id, most] of [['rpi4', 0.6], ['uno', 0.7], ['blank', 0.85]] as const) {
      const vol: Record<string, number> = {};
      for (const style of ['frame', 'tray'] as const) {
        const p = newProject(T(id));
        p.layout = 'loose';
        p.mount.kind = 'none';
        p.modules[0].holder.style = style;
        p.modules[0].holder.feat = { cradles: false, caps: false, ties: false, guards: false };
        const r = generate(p);
        const h = r.parts.find((x) => x.tag?.kind === 'holder')!;
        vol[style] = h.volume;
        expect(r.report.warnings.some((w) => /loose piece/.test(w))).toBe(false);
        if (style === 'frame') expect(printability(h.mesh).slope).toBeLessThan(8);
      }
      expect(vol.frame).toBeLessThan(vol.tray * most);
    }
  }, 300000);

  it('tags parts for picking and animation', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    const r = generate(p);
    expect(r.parts.every((x) => !!x.tag && !!x.anim)).toBe(true);
    expect(r.report.features!.some((f) => f.kind === 'cradle')).toBe(true);
    expect(Object.keys(r.report.frames!)).toEqual([p.modules[0].id]);
  }, 300000);
});
