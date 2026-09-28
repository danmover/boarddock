import { describe, it, expect } from 'vitest';
import { initKernel, K } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { STRAP_LOOP, builtLevels, strapSpots } from '../src/cad/generate';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks } from '../src/model/links';
import { BOX_PRESETS, applyBox, makeBox } from '../src/model/boxes';
import type { Board, MeshData } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const zt = (b: Board) => builtLevels(b, newProject(b).modules[0].holder).zt;

/** Along the side the loops are on, each plug's span (mm from the side's start) on that pair of sides and on top. */
function plugSpans(b: Board, alongX: boolean) {
  const x0 = Math.min(...b.outline.map((q) => (alongX ? q[0] : q[1])));
  return b.comps.filter((c) => c.conn && (c.conn.entry === 'top' || Math.abs(alongX ? Math.sin((c.conn.angle * Math.PI) / 180) : Math.cos((c.conn.angle * Math.PI) / 180)) > 0.7))
    .map((c) => { const at = (alongX ? c.x : c.y) - x0, h = c.conn!.entry === 'top' ? Math.max(c.w, c.l, c.conn!.plug.w) / 2 : c.conn!.plug.w / 2; return [at - h, at + h]; });
}

function manifold(m: MeshData) {
  const W = K() as any;
  const mesh = new W.Mesh({ numProp: 3, vertProperties: new Float32Array(m.pos), triVerts: new Uint32Array(m.idx) });
  mesh.merge();
  return new W.Manifold(mesh);
}

describe('strap loops on boxes', () => {
  it('put the strap (or a zip tie) between the plugs on every box', () => {
    const boxes = Object.keys(BOX_PRESETS).map((k) => makeBox(k as keyof typeof BOX_PRESETS)).filter((b) => !b.box?.pack && b.thickness >= 5);
    for (const b of boxes) {
      const bb = { w: Math.max(...b.outline.map((q) => q[0])) - Math.min(...b.outline.map((q) => q[0])), h: Math.max(...b.outline.map((q) => q[1])) - Math.min(...b.outline.map((q) => q[1])) };
      const long = bb.w >= bb.h;
      const found = ([[long, false], [!long, false], [long, true], [!long, true]] as [boolean, boolean][])
        .map(([ax, tie]) => ({ ax, tie, s: strapSpots(b, zt(b), ax, tie) })).find((t) => t.s.every(Boolean));
      expect(found, b.name).toBeTruthy();
      const band = found!.tie ? STRAP_LOOP.tie : STRAP_LOOP.strap;
      for (const s of found!.s) for (const [a, c] of plugSpans(b, found!.ax)) expect(s!.at + band <= a || s!.at - band >= c, `${b.name}: loop at ${s!.at} vs plug ${a}..${c}`).toBe(true);
      // a 12 mm strap on every stock box (the 4-port hub's goes 7 mm in from each end, its loops just past the box's end)
      expect(found!.tie, b.name).toBe(false);
    }
  });

  it('keeps the USB-C hub\'s loops off its front plugs, at full height', () => {
    const b = makeBox('hubc'); // 3 USB-A and a USB-C across the front, a port in each end
    const s = strapSpots(b, zt(b), true);
    expect(s.every(Boolean)).toBe(true);
    for (const x of s) expect(x!.tall).toBe(STRAP_LOOP.tall);
    // the strap goes beside the plugs at each end of the front: the first plug starts 19.9 mm in, the last ends 90.4 mm in
    expect(s[0]!.at).toBeLessThanOrEqual(19.9 - STRAP_LOOP.strap);
    expect(s[1]!.at).toBeGreaterThanOrEqual(90.4 + STRAP_LOOP.strap);
  });

  it('lowers a loop whose ends reach under a plug', () => {
    // two USB-A 32 mm apart on the front: 16 mm between their plugs, room for the strap but not the whole loop
    const b = makeBox('hubc');
    applyBox(b, { l: 100, w: 30, h: 14, groups: [{ id: 'g1', type: 'usb_a', count: 2, face: 'front', role: 'hub-down', at: [20, 52] }] });
    const top = zt(b), s = strapSpots(b, top, true);
    expect(s[0]!.at).toBeGreaterThanOrEqual(28 + STRAP_LOOP.strap - 1e-9);
    expect(s[0]!.at).toBeLessThanOrEqual(44 - STRAP_LOOP.strap + 1e-9);
    // under the plug's bottom (and its opening), 0.8 mm clear
    const plugBottom = top - 7 - 8.5 / 2 - 0.6;
    expect(s[0]!.tall).toBeCloseTo(plugBottom - 0.8, 5);
    expect(s[0]!.tall).toBeLessThan(STRAP_LOOP.tall);
    expect(s[1]!.tall).toBe(STRAP_LOOP.tall); // the other one is clear of both plugs
  });

  it('falls back to zip ties between the plugs when no gap takes a strap', () => {
    // four USB-A 26 mm apart across the front (10 mm between plugs, 2 mm from each end) and a USB-C in each end
    const b = makeBox('hubc');
    applyBox(b, { l: 100, w: 30, h: 20, groups: [
      { id: 'g1', type: 'usb_a', count: 4, face: 'front', role: 'hub-down', at: [10, 36, 62, 88] },
      { id: 'g2', type: 'usb_c', count: 1, face: 'left', role: 'hub-up' }, { id: 'g3', type: 'usb_c', count: 1, face: 'right', role: 'power-in' }] });
    const top = zt(b);
    expect(strapSpots(b, top, true).some((s) => !s)).toBe(true);
    expect(strapSpots(b, top, false).some((s) => !s)).toBe(true);
    const tie = strapSpots(b, top, true, true);
    expect(tie.every(Boolean)).toBe(true);
    for (const s of tie) for (const [a, c] of plugSpans(b, true)) expect(s!.at + STRAP_LOOP.tie <= a || s!.at - STRAP_LOOP.tie >= c).toBe(true);
  });

  it('builds no loop into a plug, in 3D', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('usb_hubc')), newModule(T('pico')), newModule(T('uno')));
    p.links = autoLinks(p);
    const r = generate(p);
    const hub = p.modules[1].id, F = r.report.frames![hub];
    expect(r.report.warnings.filter((w) => /strap|zip tie/.test(w))).toEqual([]);
    const loops = (r.report.features ?? []).filter((f) => f.module === hub && f.refs?.includes('strap'));
    expect(loops.length).toBe(4);
    const plugs = r.ghosts.filter((g) => g.tag?.module === hub && g.tag.kind === 'plug').map((g) => manifold(g.mesh));
    expect(plugs.length).toBeGreaterThan(0);
    let v = 0;
    for (const f of loops) {
      const [x0, y0, z0, x1, y1, z1] = f.box;
      const loop = K().Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]).transform(F as any);
      for (const m of plugs) v += loop.intersect(m).volume();
    }
    expect(v).toBeLessThan(0.01); // it was 70 mm³ with the loops a quarter in, under the front plugs
  });
});
