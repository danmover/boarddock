// The bill of materials: every printed part and how many, the boards, boxes and probes, the rails, the cables, the
// hardware (straps only for boxes in a holder, a zip tie per cable-tie anchor), the filament and the tools.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { billOfMaterials, bomCsv } from '../src/model/bom';
import { strapBoxes } from '../src/model/built';
import { cableLines } from '../src/model/cablelist';
import { RACKS } from './collide/racks';

beforeAll(async () => { await initKernel(); });
const build = (name: string) => { const p = RACKS.find((r) => r.name === name)!.make(); return { p, r: generate(p) }; };
const group = (g: ReturnType<typeof billOfMaterials>, head: string) => g.find((x) => x.head === head);

describe('bill of materials', () => {
  it('lists everything on a busy rack, with quantities', () => {
    const { p, r } = build('busy mixed rack');
    const bom = billOfMaterials(p, r);
    // every printed part, as many as the build makes
    const printed = bom.filter((g) => g.head.startsWith('Print: ')).flatMap((g) => g.rows);
    expect(printed.reduce((s, x) => s + x.qty, 0)).toBe(r.parts.reduce((s, x) => s + x.qty, 0));
    // (a holder too long for the bed prints in two halves, as the powerboard's does: two lines)
    expect(bom.find((g) => g.head === 'Print: holders')!.rows.length).toBe(r.parts.filter((x) => x.tag?.kind === 'holder').length);
    expect(bom.find((g) => g.head === 'Print: holders')!.rows.map((x) => x.item)).toEqual(expect.arrayContaining(['Holder: Powerboard, 4 outlets (first half)', 'Holder: Powerboard, 4 outlets (second half)']));
    // the boards, two Pi 5s counted together
    expect(group(bom, 'Boards')!.rows).toContainEqual({ qty: 2, item: 'Raspberry Pi 5' });
    expect(group(bom, 'Boxes and supplies')!.rows.map((x) => x.item)).toEqual(expect.arrayContaining(['Powered USB hub', 'USB-C hub', 'Network switch, 5 ports']));
    // the rails as laid out, and the cables as on the shopping list
    expect(group(bom, 'Rails')!.rows.reduce((s, x) => s + x.qty, 0)).toBe(r.report.panel!.rails.length);
    const cl = cableLines(p, r.report.cables ?? []);
    expect(group(bom, 'Cables')!.rows.length).toBe(cl.buy.length);
    // straps: two for each box in a holder; a zip tie through each cable-tie anchor
    const hw = group(bom, 'Hardware')!.rows;
    expect(hw.filter((x) => /strap/.test(x.item)).reduce((s, x) => s + x.qty, 0)).toBe(2 * strapBoxes(p, r.report.panel).length);
    expect(hw.find((x) => /zip tie/.test(x.item))?.qty ?? 0).toBe((r.report.features ?? []).filter((f) => f.kind === 'tie' && !f.refs?.includes('strap')).length);
    expect(group(bom, 'Filament')!.rows[0].item).toMatch(/^PETG, about \d+ g$/);
    expect(group(bom, 'Tools')!.rows.map((x) => x.item)).toContain('a hacksaw and a file');
    // as a spreadsheet: a header and a row a line
    const csv = bomCsv(bom).trim().split('\n');
    expect(csv[0]).toBe('Group,Qty,Item,Note');
    expect(csv.length).toBe(1 + bom.reduce((s, g) => s + g.rows.length, 0));
  }, 120_000);

  it('gives plug packs no strap: they go in an outlet, not a holder', () => {
    const { p, r } = build('Pi cluster');
    const bom = billOfMaterials(p, r);
    const packs = p.modules.filter((m) => /27 W/.test(m.board.name) || /USB-C supply/.test(m.board.name));
    expect(packs.length).toBe(4);
    expect(packs.some((m) => strapBoxes(p, r.report.panel).includes(m))).toBe(false);
    const straps = group(bom, 'Hardware')!.rows.filter((x) => /strap/.test(x.item));
    expect(straps.reduce((s, x) => s + x.qty, 0)).toBe(2 * strapBoxes(p, r.report.panel).length);
    expect(straps.some((x) => /supply|27 W/.test(x.note ?? ''))).toBe(false);
    expect(group(bom, 'Boxes and supplies')!.rows.find((x) => /supply|27 W/.test(x.item))).toMatchObject({ qty: 4, note: 'plugs into an outlet' });
  }, 120_000);
});
