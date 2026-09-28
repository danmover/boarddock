// Boards lying flat in their docks: top face up, docked by an ear on one edge, in the same shoe and socket as a
// standing board.
import { describe, it, expect } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { bestDock, bestSeat, earSite, flatFrame } from '../src/cad/dockplan';
import { EAR } from '../src/cad/dockdims';
import { dir, pt as ptM } from '../src/geom/mat';
import { bbox } from '../src/geom/poly';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('lying flat on a dock', () => {
  it('the flat frame puts the ear tip over the divider, the top face up, and the holder on the key over the socket', () => {
    const p = newProject(T('rpi4')), m = p.modules[0];
    const s = earSite(m.board, m.holder, 'left');
    const F = flatFrame('left', s.tc, s.L0);
    // up stays up
    expect(dir(F, [0, 0, 1])).toEqual([0, 0, 1].map((v) => expect.closeTo(v, 9)));
    // the holder's outer face on the ear edge is EAR.len in from the divider; its underside on the key's pedestal, EAR.ped
    // above the socket top
    const face = ptM(F, [-s.L0, s.tc, 0]);
    expect(face[1]).toBeCloseTo(EAR.len, 6);
    expect(face[2]).toBeCloseTo(EAR.ped, 6);
    // and the board's middle is further in (the holder reaches away from the socket)
    const bb = bbox(m.board.outline), mid = ptM(F, [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, 0]);
    expect(mid[1]).toBeGreaterThan(EAR.len + 10);
    // a right-handed frame (no mirrored holder)
    const a = dir(F, [1, 0, 0]), b = dir(F, [0, 1, 0]), c = dir(F, [0, 0, 1]);
    expect(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])).toBeCloseTo(1, 9);
  });
  it('keeps the ear clear of the plugs on its edge', () => {
    const b = T('rpi4');
    const p = newProject(b), m = p.modules[0];
    for (const e of ['bottom', 'top', 'left', 'right'] as const) {
      const s = earSite(m.board, m.holder, e);
      console.log('ear', e, s.tc.toFixed(1), s.conflicts.join(', '));
    }
    // the Pi's GPIO edge has no edge plugs: an ear there is clear
    expect(earSite(m.board, m.holder, 'top').conflicts).toHaveLength(0);
  });
  it('lying flat, a header points out of the wall (the easiest to reach)', () => {
    const p = newProject(T('rpi4'));
    const o = bestDock(p.modules[0], 'h', 0, undefined, undefined, 'flat');
    expect(o.lie).toBe('flat');
    expect(o.access.some((a) => a.ok === 'blocked')).toBe(false);
    const gpio = o.access.find((a) => /GPIO|J8|J1/.test(a.ref) && a.dir === 'front');
    console.log('flat pi', o.edge, o.turn, o.score.toFixed(2), o.access.map((a) => `${a.ref}:${a.dir}/${a.ok}`).join(' '));
    expect(gpio ?? o.access.find((a) => a.dir === 'front')).toBeTruthy();
    expect(bestSeat(p.modules[0], 'h', 'flat').lie).toBe('flat');
    expect(bestSeat(p.modules[0], 'h', 'up').lie).toBeUndefined();
  });
  it('a rack laid flat builds: every holder with an ear, a rod each, no collisions, nothing loose', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('pico')), newModule(T('esp32')));
    p.panel.lie = 'flat';
    p.panel.maxRail = 400;
    const r = generate(p);
    const pr = r.report.panel!;
    console.log(r.report.timeMs + 'ms', pr.mounts.map((m) => `${m.id} t${m.turn} at${m.at.toFixed(0)} [${m.slots.map((s) => `${s.module ?? '-'}${s.lie ? '/flat' : ''}:${s.edge}`).join(',')}]`).join(' '));
    console.log(r.report.warnings.join('\n'));
    for (const m of pr.modules) console.log(m.id, m.edge, m.lie, m.turn, m.z1.toFixed(0), m.access.map((a) => `${a.ref}:${a.dir}`).join(' '));
    expect(pr.modules.every((m) => m.lie === 'flat')).toBe(true);
    expect(r.parts.filter((x) => x.id.endsWith('holder')).length).toBe(4);
    expect(r.parts.filter((x) => x.id.endsWith('rod')).length).toBe(4);
    expect(pr.collisions).toEqual([]);
    expect(r.report.warnings.filter((w) => /loose piece|Dock ear|release lever/.test(w))).toEqual([]);
    // every holder prints base-down with nothing under it (the tongue is a key of its own); each flat holder has a
    // key and a rod, and both print lying down: the key with its tongue flat, the rod on its side
    const holders = r.parts.filter((x) => x.id.endsWith('holder')), keys = r.parts.filter((x) => x.id.endsWith('earkey')), rods = r.parts.filter((x) => x.id.endsWith('_rod'));
    expect(keys.length).toBe(holders.length);
    expect(rods.length).toBe(holders.length);
    for (const h of holders) {
      // the lowest layer covers much of the part's footprint: it stands on its base, not on a point
      let zmin = Infinity; const low: number[] = [];
      for (let k = 2; k < h.mesh.pos.length; k += 3) zmin = Math.min(zmin, h.mesh.pos[k]);
      for (let k = 2; k < h.mesh.pos.length; k += 3) if (h.mesh.pos[k] < zmin + 0.01) low.push(h.mesh.pos[k - 2], h.mesh.pos[k - 1]);
      expect(zmin).toBeGreaterThan(-0.01);
      const xs = low.filter((_, i) => i % 2 === 0), ys = low.filter((_, i) => i % 2 === 1);
      expect((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))).toBeGreaterThan(0.5 * h.size[0] * h.size[1]);
    }
    for (const k of keys) { expect(k.size[2]).toBeLessThan(11); expect(Math.max(k.size[0], k.size[1])).toBeGreaterThan(14); }
    for (const q of rods) expect(q.size[2]).toBeLessThan(Math.max(q.size[0], q.size[1]) / 2);
    // lying flat, the rack stands lower out of the wall than it would with the boards standing
    const q = newProject(T('rpi4'));
    q.modules.push(newModule(T('uno')), newModule(T('pico')), newModule(T('nano')));
    const up = generate(q).report.panel!;
    console.log('depth flat', pr.depth, 'standing', up.depth);
    expect(pr.depth).toBeLessThan(up.depth);
  }, 300000);
});
