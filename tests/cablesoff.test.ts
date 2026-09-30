// Cables off: a project for holders and plug covers only. Nothing is routed, drawn, tagged, listed or bought as a
// cable, the stands are plain, Auto-connect and the cable advice are silent, and a port has a plug (cradle, cap) when
// you say so. The links are kept, so switching cables back on restores them.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks, wiringAdvice } from '../src/model/links';
import { portUses } from '../src/model/portuse';
import { billOfMaterials } from '../src/model/bom';
import { cableLines } from '../src/model/cablelist';
import { checklist } from '../src/model/checklist';
import { completeRack } from '../src/model/complete';
import { generate } from '../src/cad/assembly';
import { initKernel } from '../src/cad/kernel';
import type { GenResult, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = () => {
  const p = newProject(T('rpi4'));
  // (a Zero too: the stands' combs come and go with how the rack lays out, and this one has two)
  for (const id of ['uno', 'usb_hub7', 'rpi5', 'net_switch5', 'usb_charger6', 'pico', 'esp32', 'rpi_zero']) p.modules.push(newModule(T(id)));
  p.links = numberLinks(autoLinks(p));
  return p;
};
const cableGhosts = (r: GenResult) => r.ghosts.filter((g) => g.tag?.kind === 'cable' || /^(off-rack )?cable /.test(g.name));
const combs = (r: GenResult) => r.parts.filter((x) => /comb/.test(x.name));
const caps = (r: GenResult) => r.parts.filter((x) => x.tag?.kind === 'cap');
const cableRows = (p: Project, r: GenResult) => billOfMaterials(p, r).filter((g) => /cable|lead/i.test(g.head) || g.rows.some((x) => /\b(USB|Ethernet|HDMI|power|mains)\b.*\bcable\b|\bcable\b.*\bm\b/i.test(x.item)));

describe('cables off', () => {
  beforeAll(async () => { await initKernel(); });

  it('a rack builds with no cable meshes, tags or combs, and no cables to buy; switching them back on restores them all', () => {
    const p = rack();
    const links = JSON.parse(JSON.stringify(p.links));
    const on = generate(p);
    expect(on.report.cables!.length).toBeGreaterThan(5);
    expect(cableGhosts(on).length).toBeGreaterThan(5);
    expect(combs(on).length).toBeGreaterThan(0);
    expect(on.parts.some((x) => x.tag?.kind === 'cabletag')).toBe(true);
    expect(cableLines(p, on.report.cables!).buy.length).toBeGreaterThan(0);
    expect(cableRows(p, on).length).toBeGreaterThan(0);

    p.cablesOff = true;
    const off = generate(p);
    expect(off.report.cables ?? []).toEqual([]);
    expect(cableGhosts(off)).toEqual([]);
    expect(off.parts.filter((x) => x.tag?.kind === 'cabletag')).toEqual([]);
    expect(combs(off)).toEqual([]); // the stands are plain
    expect(cableLines(p, off.report.cables ?? []).buy).toEqual([]);
    expect(cableRows(p, off)).toEqual([]);
    expect(off.report.checks.filter((c) => c.group === 'Power' || /^(Cable routes|Cables|Cables settled|Debug ribbons)$/.test(c.name)).map((c) => c.name)).toEqual([]);
    expect(off.steps!.filter((s) => /cable|Plug in the|mains/i.test(s.text)).map((s) => s.text.slice(0, 40))).toEqual([]);
    expect(off.report.warnings.filter((w) => /cable|outlet|supply/i.test(w))).toEqual([]);
    expect(checklist(p, off).flatMap((s) => s.groups.flatMap((g) => g.lines.map((l) => l.item))).filter((x) => /cable/i.test(x) && !/zip tie/i.test(x))).toEqual([]);
    // no Auto-connect, no cable advice, nothing to complete
    expect(autoLinks(p)).toEqual([]);
    expect(wiringAdvice(p)).toEqual([]);
    expect(completeRack(p)).toEqual([]);
    // the links are still there
    expect(p.links).toEqual(links);

    delete p.cablesOff;
    const again = generate(p);
    expect(again.report.cables!.map((c) => c.id).sort()).toEqual(on.report.cables!.map((c) => c.id).sort());
    expect(cableGhosts(again).length).toBe(cableGhosts(on).length);
    expect(combs(again).length).toBe(combs(on).length);
    expect(p.links).toEqual(links);
  }, 300_000);

  it('gives a cradle and cap to the ports you say get a plug, and only those', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')));
    p.cablesOff = true;
    const bare = generate(p);
    expect(caps(bare).length).toBe(0); // (nothing is assumed: no cables, no plug in anything)
    expect([...portUses(p, p.modules[0]).values()].every((w) => w === 'unused')).toBe(true);
    // say the Pi's edge ports get a plug
    const ports = p.modules[0].board.comps.filter((c) => c.conn && !c.hidden && c.conn.entry === 'edge');
    expect(ports.length).toBeGreaterThan(2);
    for (const c of ports) c.conn!.use = 'yes';
    expect([...portUses(p, p.modules[0]).values()].filter((w) => w === 'yours').length).toBe(ports.length);
    const used = generate(p);
    expect(caps(used).length).toBeGreaterThan(0);
    expect(cableGhosts(used)).toEqual([]);
    // and one that stays empty is left bare, whatever else is
    for (const c of ports) c.conn!.use = 'no';
    expect(caps(generate(p)).length).toBe(0);
  }, 300_000);
});
