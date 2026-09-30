// The parts the printability audit found needing support, sliced after their fixes: guard collars with gables,
// stand sockets on their side, the tray window over a part past the edge, the probe slot's lips, the frame sill,
// flat-lying racks, and the DIN plate's slots (bridged: it says so).
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel, freeAll } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { layerCheck, verdict, type LayerReport } from '../src/cad/printcheck';
import { TEMPLATES, edgeConn } from '../src/model/templates';
import { newProject } from '../src/model/library';
import type { Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const loose = (id: string, mk: (p: Project) => void = () => {}) => { const p = newProject(T(id)); p.layout = 'loose'; p.mount.kind = 'none'; mk(p); return p; };
function holderCheck(p: Project): { r: LayerReport; checks: ReturnType<typeof generate>['report']['checks'] } {
  const g = generate(p);
  const h = g.parts.find((x) => x.tag?.kind === 'holder')!;
  const r = layerCheck(h.mesh)!;
  freeAll();
  return { r, checks: g.report.checks };
}

describe('printability fixes', () => {
  beforeAll(async () => { await initKernel(); });

  it('guard collars over wide plugs have a gable: no flat roof over 6 mm (HDMI-A was 22.2, USB-A 17.2)', () => {
    for (const type of ['hdmi_a', 'usb_a', 'usb_a_dual', 'rj45', 'usb_c', 'barrel']) {
      const p = loose('blank', (q) => { const c = edgeConn('J1', type, -90, 30, 0, 1); c.conn!.cradle = false; c.conn!.cap = false; c.conn!.guard = true; q.modules[0].board.comps = [c]; });
      const { r } = holderCheck(p);
      expect(r.bridge?.span ?? 0, type).toBeLessThan(8);
      expect(r.islands, type).toEqual([]);
      expect(verdict(r).status, type).toBe('ok');
    }
  }, 120000);

  it('a Pi 4 with its cradles off: collars and the frame under its plugs print clean', () => {
    const { r } = holderCheck(loose('rpi4', (q) => { q.modules[0].holder.feat = { cradles: false, caps: true, ties: true, guards: true }; }));
    expect(r.bridge?.span ?? 0).toBeLessThan(8); // (none at all now that clips, not snap pins, hold the board: the frame under the plugs has nothing to span)
    expect(r.cantilever?.reach ?? 0).toBeLessThan(1.2); // the stray sill under the USB/Ethernet (1.2 mm) is gone
    expect(verdict(r).status).toBe('ok');
  }, 60000);

  it('stand sockets on their side: square and hex get a 45 degree gable (square was a 10.3 mm roof)', () => {
    for (const shape of ['square', 'hex', 'round', 'd'] as const) {
      const { r } = holderCheck(loose('uno', (q) => { q.stand = { ...q.stand, enabled: true, shape, axis: 'edge' }; }));
      expect(r.bridge?.span ?? 0, shape).toBeLessThan(5);
      expect(r.slope, shape).toBeNull();
      expect(verdict(r).status, shape).toBe('ok');
    }
  }, 120000);

  it('the tray wall over a wide part hanging past the edge underneath is open to the top (was a 14.8 mm bridge)', () => {
    const p = loose('blank', (q) => { q.modules[0].holder.style = 'tray'; q.modules[0].holder.standoff = 4; q.modules[0].board.comps = [{ id: 'g1', ref: 'U9', pkg: 'box', side: 'bottom', x: 30, y: 1, rot: 0, w: 14, l: 6, h: 2.5, kind: 'generic', tht: false }]; });
    const { r } = holderCheck(p);
    expect(r.bridge?.span ?? 0).toBeLessThan(5);
    expect(verdict(r).status).toBe('ok');
  }, 60000);

  it('probe slots: the lips are flat 0.8 mm, then 45 degrees (J-Link was a 1.9 mm ledge)', () => {
    for (const id of ['jlink', 'ftdi']) {
      const { r } = holderCheck(loose(id));
      expect(r.cantilever?.reach ?? 0, id).toBeLessThan(1);
      expect(verdict(r).status, id).toBe('ok');
    }
  }, 60000);

  it('a DIN plate standing off an edge: its slots across are bridges the clip width long, and the report says so', () => {
    const p = newProject(T('uno')); p.layout = 'loose'; p.mount = { ...p.mount, kind: 'din', mode: 'rack', rotation: 90 };
    const { r, checks } = holderCheck(p);
    expect(r.islands).toEqual([]);
    expect(r.bridge!.span).toBeGreaterThan(12);
    expect(r.bridge!.span).toBeLessThan(16);
    expect(verdict(r).status).toBe('warn');
    expect(checks.find((c) => c.name === 'Plate slots')?.detail).toMatch(/hook catches on the edge beside a bridged top/);
  }, 60000);

  it('every part of racks lying flat and back to back prints without support', () => {
    const flat = newProject(T('rpi4')); flat.panel.lie = 'flat';
    for (const p of [flat, loose('pico', (q) => { q.modules.push({ ...structuredClone(q.modules[0]), id: 'b2' }); q.arrange.mode = 'back'; })]) {
      const g = generate(p);
      const seen = new Set<string>();
      for (const pt of g.parts) {
        if (seen.has(pt.name)) continue;
        seen.add(pt.name);
        const r = layerCheck(pt.mesh)!;
        freeAll();
        expect(r.islands, pt.name).toEqual([]);
        expect(verdict(r, /Rail shoe|Dock socket|DIN rail clip/.test(pt.name)).status, pt.name).not.toBe('bad');
      }
    }
  }, 300000);
});
