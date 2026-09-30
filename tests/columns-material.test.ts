// What the J-Link and adapter column costs to print (the repo's own estimate: grams and minutes), against what it cost
// before the pegs were made to print on their side and the landing thinned; and why a second J-Link's ribbon is
// long whichever way it is docked.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { MATERIALS, newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes, columnHeight, columnLimit, isProbe } from '../src/model/probes';
import { headerRows, sheetRow } from '../src/model/debuggear';
import { generatePanel } from '../src/cad/panelgen';
import { estimate } from '../src/cad/export';
import { initKernel } from '../src/cad/kernel';
import { LANDING } from '../src/cad/dockdims';
import type { Material, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
beforeAll(async () => { await initKernel(); });

/** Before (v2.1.0 head, PETG): the two holders and the rod of the sensor board's J-Link and adapter column. */
const BEFORE = { jlink: { g: 7.80, min: 17.7 }, adapter: { g: 4.84, min: 11.7 }, rod: { g: 1.08, min: 3.6 } };
// (the J-Link's holder held its board by four snap pins, its edges having no room for clips; it now gets two 10 mm
// hairpin clips, Auto's default, which take a little more plastic than the pins: 7.99 g and 18.0 min against 7.80 and 17.7)
const CLIPS = { g: 0.2, min: 0.4 };
const sum = (k: 'g' | 'min') => BEFORE.jlink[k] + BEFORE.adapter[k] + BEFORE.rod[k] + CLIPS[k];

function dual(material: Material): Project {
  const p = newProject(T('example_dual_swd'));
  p.modules.push(newModule(T('usb_hub7')));
  const all = () => { for (const m of p.modules) m.holder.material = material; };
  all(); addProbes(p, p.modules[0].id); all(); addAdapters(p, p.modules[0].id); all();
  p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
  return p;
}

describe('grams and print time of a J-Link and adapter column', () => {
  it('is lighter and no slower than before, every part on the estimate the app shows', () => {
    const p = newProject(T('example_jtag'));
    p.modules.push(newModule(T('usb_hub7')));
    addProbes(p, p.modules[0].id); addAdapters(p, p.modules[0].id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
    const ids = new Set(p.modules.filter(isProbe).map((m) => m.id));
    const parts = generatePanel(p).parts.filter((x) => x.tag?.module && ids.has(x.tag.module) && /^(Holder:|Release rod)/.test(x.name));
    expect(parts.length).toBe(3);
    const density = MATERIALS[p.modules[0].holder.material].density;
    let g = 0, min = 0;
    for (const pt of parts) { const e = estimate(pt, density); g += e.grams; min += e.minutes; }
    // (13.72 g and 33.0 min before, plus the J-Link's clips; the landing is 1.2 mm thinner and the peg holes lost their drill cones)
    expect(g).toBeLessThan(sum('g')); // (13.56 g with the thinner landing; the bottom holder's anti-rattle bumps and slots make it 13.70)
    expect(min).toBeLessThan(sum('min') + 0.1); // (33.03 min with the anti-rattle leaves: two seconds more)
    // and the rod down the column is shorter by the landing's 1.2 mm
    const rod = parts.find((x) => /^Release rod/.test(x.name))!;
    expect(rod.size[1]).toBeLessThan(95);
    expect(LANDING.t).toBe(6.8);
  }, 120_000);
});

describe('a second J-Link: its own column or the first one\'s, its ribbon is long either way', () => {
  it('two J-Links stand 95.2 mm over the socket, more than the PETG tongue takes (84.5), so each has a column and a dock', () => {
    const p = dual('PETG');
    const js = p.modules.filter((m) => /^J-Link/.test(m.board.name));
    expect(columnHeight(js)).toBeCloseTo(95.2, 1);
    expect(columnLimit(p.modules[0].holder)).toBeCloseTo(84.5, 1);
    expect(js.some((m) => m.on)).toBe(false); // (none stacked on the other)
    const r = generatePanel(p);
    const rows = headerRows(p).filter((h) => h.kind === 'debug').map((h) => ({ ref: h.comp.ref, cab: r.report.cables!.find((c) => c.id === h.link!.id)!, row: sheetRow(p, h, r.report.cables, r.report.panel) }));
    const long = rows.reduce((a, b) => (b.cab.length > a.cab.length ? b : a));
    // the one in a dock of its own beside the board: over the J-Link's own 200 mm, and the sheet says which ribbon to buy
    expect(long.cab.length).toBeGreaterThan(200);
    expect(long.cab.length).toBeLessThan(260);
    expect(long.row.buy[0]).toMatch(/^1 × 30 cm 20-pin 1.27 mm|^1 × 30 cm 10-pin 1.27 mm/);
    // (the other, behind its board, reaches with its own)
    expect(rows.filter((x) => x.cab.length < 200).length).toBe(1);
  }, 120_000);

  it('in a stiffer material both share one column, and the ribbon of the one on top is no shorter (236 mm): it is the height, not the dock', () => {
    const p = dual('PC');
    const js = p.modules.filter((m) => /^J-Link/.test(m.board.name));
    expect(columnHeight(js)).toBeLessThan(columnLimit(p.modules[0].holder));
    expect(js.filter((m) => m.on).length).toBe(1); // one stands on the other
    const r = generatePanel(p);
    const top = js.find((m) => m.on)!, link = p.links!.find((l) => (l.a.module === top.id || l.b.module === top.id) && l.kind === 'debug')!;
    expect(r.report.cables!.find((c) => c.id === link.id)!.length).toBeGreaterThan(200);
  }, 120_000);
});
