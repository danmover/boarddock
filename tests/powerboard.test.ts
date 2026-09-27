// Powerboards (power strips): outlets along the top, chargers' mains leads plugged in by Auto-connect, never one
// powerboard into another; a powerboard longer than the printer bed is held by two halves, each on its own clip.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks, plugRole } from '../src/model/links';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('powerboards', () => {
  beforeAll(async () => { await initKernel(); });

  it('spread their outlets evenly, turned or switched as asked', () => {
    const b = T('pb4ang'), outs = b.comps.filter((c) => c.conn?.type === 'ac_au');
    expect(outs.map((c) => c.ref)).toEqual(['AC1', 'AC2', 'AC3', 'AC4']);
    const gaps = outs.slice(1).map((c, i) => c.x - outs[i].x);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
    expect(outs.every((c) => c.rot === 45)).toBe(true);
    expect(T('pb4sw').comps.filter((c) => c.value === 'switched').length).toBe(4);
  });

  it("take the chargers' mains leads, and are never plugged into one another", () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('usb_charger')), newModule(T('usb_charger')), newModule(T('pb4')), newModule(T('pb6')));
    p.links = numberLinks(autoLinks(p));
    const mains = p.links.filter((l) => l.kind === 'mains');
    expect(mains.length).toBe(2);
    for (const l of mains) {
      const [a, b] = [l.a, l.b].map((r) => p.modules.find((m) => m.id === r.module)!);
      const [ra, rb] = [plugRole(a, a.board.comps.find((c) => c.ref === l.a.ref)!), plugRole(b, b.board.comps.find((c) => c.ref === l.b.ref)!)];
      expect([ra, rb].sort()).toEqual(['mains-in', 'mains-out']);
      expect([a, b].some((m) => /Powerboard/.test(m.board.name)) && [a, b].some((m) => /charger/.test(m.board.name))).toBe(true);
    }
  });

  it('longer than the bed: two halves on two clips, both fitting the bed', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('usb_charger')), newModule(T('pb4')));
    p.links = numberLinks(autoLinks(p));
    const r = generatePanel(p);
    expect(r.report.warnings.filter((w) => /does not fit/.test(w))).toEqual([]);
    const pb = p.modules[2].id;
    const holders = r.parts.filter((x) => x.tag?.kind === 'holder' && x.tag.module === pb), clips = r.parts.filter((x) => x.tag?.kind === 'clip' && x.tag.module === pb);
    expect(holders.map((x) => x.name)).toEqual(['Holder: Powerboard, 4 outlets (first half)', 'Holder: Powerboard, 4 outlets (second half)']);
    expect(clips.length).toBe(2);
    for (const h of holders) expect(Math.max(h.size[0], h.size[1])).toBeLessThan(Math.max(...p.printer.bed));
    expect(r.report.cables!.filter((c) => c.kind === 'mains').length).toBe(1);
    expect((r.steps ?? []).some((s) => /both halves/.test(s.text))).toBe(true);
  }, 120_000);
});
