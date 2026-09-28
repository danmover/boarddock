import { describe, it, expect } from 'vitest';
import { initKernel, freeAll } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { layerCheck, verdict } from '../src/cad/printcheck';
import { testKit } from '../src/cad/testkit';
import { labelForms } from '../src/cad/generate';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks } from '../src/model/links';
import type { PartOut } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const MOVING = /Rail shoe|Dock socket|DIN rail clip/;

describe('printability, sliced', () => {
  it('every part of a mixed rack prints without supports, and nothing that moves prints closed', async () => {
    await initKernel();
    const parts = new Map<string, { pt: PartOut }>();
    const add = (list: PartOut[]) => { for (const pt of list) { const k = `${pt.name}|${pt.size.map((v) => v.toFixed(0))}`; if (!parts.has(k)) parts.set(k, { pt }); } };
    const p = newProject(T('rpi4'));
    for (const id of ['uno', 'pico', 'rpi_zero', 'nano', 'usb_hub7', 'usb_charger']) p.modules.push(newModule(T(id)));
    p.modules[1].holder.style = 'tray';
    p.links = autoLinks(p);
    let g = generate(p); add(g.parts);
    const q = newProject(T('uno')); q.layout = 'loose'; q.mount.kind = 'din';
    g = generate(q); add(g.parts);
    add(testKit(0));
    for (const { pt } of parts.values()) {
      const r = layerCheck(pt.mesh)!;
      freeAll();
      expect(r, pt.name).not.toBeNull();
      expect(r.islands, `${pt.name} starts in mid-air`).toEqual([]);
      if (MOVING.test(pt.name)) expect(r.gaps, `${pt.name} has a slot that prints closed`).toBeNull();
      expect(r.bridge?.span ?? 0, `${pt.name} bridge`).toBeLessThan(12);
      expect(r.cantilever?.reach ?? 0, `${pt.name} overhang`).toBeLessThan(2);
      expect(verdict(r, MOVING.test(pt.name)).status, pt.name).not.toBe('bad');
    }
    expect(parts.size).toBeGreaterThan(20);
  }, 300000);

  it('sees a part that starts in mid-air', async () => {
    await initKernel();
    const { box, unionMF, toMesh } = await import('../src/cad/kernel');
    // a table: a slab on one leg reaching 10 mm out, plus a block floating 2 mm over the bed
    const m = toMesh(unionMF([box(0, 0, 0, 4, 4, 6), box(0, 0, 6, 14, 4, 7), box(20, 0, 2, 24, 4, 5)]));
    const r = layerCheck(m)!;
    freeAll();
    expect(r.islands.length).toBeGreaterThan(0);
    expect(r.cantilever!.reach).toBeGreaterThan(8);
    expect(verdict(r).status).toBe('bad');
  }, 60000);
});

describe('holder features', () => {
  it('shortens a board name to a label that still says which board it is', () => {
    expect(labelForms('Raspberry Pi Zero 2 W', 'Raspberry Pi Zero 2 W')).toContain('Pi Zero');
    expect(labelForms('Raspberry Pi Zero 2 W', 'Raspberry Pi Zero 2 W')).not.toContain('2 W');
    expect(labelForms('Raspberry Pi 4B', 'Raspberry Pi 4B')[1]).toBe('Pi 4B');
    expect(labelForms('SENSOR HUB', 'Raspberry Pi 4B')).toEqual(['SENSOR HUB']); // your own words are never cut
  });

  it('every switch does something, or says why it could not', async () => {
    await initKernel();
    const vol = (mk: (p: ReturnType<typeof newProject>) => void, id = 'rpi4', layout: 'panel' | 'loose' = 'panel') => {
      const p = newProject(T(id)); p.layout = layout; mk(p);
      const r = generate(p);
      return { v: r.parts.find((x) => x.tag?.kind === 'holder')!.volume, checks: r.report.checks };
    };
    // the label is engraved (the default is the board's name, shortened to fit)
    const on = vol(() => {}), off = vol((p) => { p.modules[0].holder.label = ''; });
    expect(on.v).not.toBe(off.v);
    expect(on.checks.find((c) => c.name === 'Label')?.value).toMatch(/^"/);
    // a short label of your own survives on a board held by pins
    expect(vol((p) => { p.modules[0].holder.label = 'NAS'; }).checks.find((c) => c.name === 'Label')?.value).toBe('"NAS"');
    // what holds the board: clips (auto, where they fit), snap pins only, or both
    const auto = vol(() => {}, 'uno', 'loose'), pins = vol((p) => { p.modules[0].holder.hold = 'pins'; }, 'uno', 'loose'), both = vol((p) => { p.modules[0].holder.hold = 'both'; }, 'uno', 'loose');
    expect(new Set([auto.v, pins.v, both.v]).size).toBe(3);
    expect(auto.checks.some((c) => /^Spring clips \(2\)/.test(c.name))).toBe(true);
    expect(pins.checks.some((c) => /^Spring clips/.test(c.name))).toBe(false);
    expect(both.checks.some((c) => /^Snap pins/.test(c.name)) && both.checks.some((c) => /^Spring clips \(/.test(c.name))).toBe(true);
    // an older project's "fingers off" still means pins
    expect(vol((p) => { p.modules[0].holder.tabs = 'off'; }, 'uno', 'loose').v).toBe(pins.v);
    // the release button says where it went and why
    const side = vol((p) => { p.modules[0].holder.release = 'side'; }, 'rpi4');
    const rel = side.checks.find((c) => c.name === 'Release button')!;
    expect(rel.value).toBe('centred');
    expect(rel.detail).toMatch(/would block/);
  }, 120000);

  it('a docked board with no pin holes is still clipped in (a Nano gets another dock edge)', async () => {
    await initKernel();
    const r = generate(newProject(T('nano')));
    expect(r.report.warnings.some((w) => /Nothing clips/.test(w))).toBe(false);
    expect(r.report.checks.find((c) => /^Spring clips \(/.test(c.name))?.name).toMatch(/\((2|3|4)\)/);
  }, 120000);
});
