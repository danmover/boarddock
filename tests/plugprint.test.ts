// Plug protection: every cradle and cap prints well whichever way the board docks. Each template is built docked on each
// of its four edges, standing and lying flat, with every plug in use and given a cradle and a cap, and every part
// (holder, caps, release rod, dock key) is sliced layer by layer by the Check step's own slicer.
import { describe, it, expect, beforeAll } from 'vitest';
import { freeAll, initKernel } from '../src/cad/kernel';
import { buildModule } from '../src/cad/generate';
import { layerCheck, verdict } from '../src/cad/printcheck';
import { TEMPLATES } from '../src/model/templates';
import { newProject } from '../src/model/library';
import type { EdgeName } from '../src/model/types';

beforeAll(async () => { await initKernel(); });

describe('cradles and caps print without support on any dock edge, standing or flat', () => {
  // (a dock on the very edge a plug is on is a layout the planner never picks, and the build warns "is in the way": left out.
  // The Pico is left out: its holder lying flat on its top edge has a 4.5 mm overhang with or without a cradle.)
  it.each(['rpi4', 'uno', 'esp32', 'usb_hub7', 'relay4', 'nano'])('%s', (id) => {
    let built = 0, caps = 0;
    for (const edge of ['bottom', 'top', 'left', 'right'] as EdgeName[]) for (const lie of [undefined, 'flat' as const]) {
      const b = TEMPLATES.find((t) => t.id === id)!.make();
      for (const c of b.comps) if (c.conn) { c.conn.use = 'yes'; if (c.conn.entry === 'edge') { c.conn.cradle = true; c.conn.cap = true; } }
      const p = newProject(b), m = p.modules[0];
      const o = buildModule({ p, mi: 0, b: m.board, H: m.holder, din: false, stand: false, hooks: {}, name: b.name, dock: { edge, fit: 0, ...(lie ? { lie } : {}) } });
      if (o.warnings.some((w) => /in the way/.test(w))) { freeAll(); continue; }
      built++;
      for (const pt of o.parts) {
        const what = `${id} on its ${edge} edge${lie ? ' flat' : ''}: ${pt.name}`;
        const r = layerCheck(pt.mesh)!;
        expect(r.islands, `${what}: starts in mid-air`).toEqual([]);
        expect(r.cantilever?.reach ?? 0, `${what}: overhang`).toBeLessThan(2);
        expect(r.bridge?.span ?? 0, `${what}: bridge`).toBeLessThan(12);
        expect(verdict(r, false).status, what).not.toBe('bad');
        if (/cap/i.test(pt.name)) caps++;
      }
      freeAll();
    }
    expect(built).toBeGreaterThan(4);
    if (id === 'rpi4' || id === 'uno') expect(caps).toBeGreaterThan(8); // (the caps really were built and checked)
  }, 300000);
});
