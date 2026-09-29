// The buy / print / tools checklist: lines from the rack's bill of materials, ticks kept by line key, and ticks for
// lines that no longer exist dropped when the rack changes.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { checklist, lineKeys, progress, pruneTicks, setTick, setTicks } from '../src/model/checklist';
import type { GenResult, PartOut, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  // a second board of a kind is "#2", as the app names it
  p.modules.forEach((m, i) => { const n = ids.slice(0, i + 1).filter((x) => x === ids[i]).length; if (n > 1) m.board.name += ` #${n}`; });
  return p;
};
/** What the 3D build would report for a rack: a holder for each board, one rail. */
const build = (p: Project, railLen = 300): GenResult => ({
  parts: p.modules.map((m): PartOut => ({ id: m.id, name: `${m.board.name.replace(/ #\d+$/, '')} holder`, qty: 1, mesh: { pos: new Float32Array(), idx: new Uint32Array() }, toAssembly: [], volume: 20000, size: [1, 1, 1], color: '#fff', tag: { kind: 'holder', module: m.id } })),
  ghosts: [], report: { warnings: [], checks: [], levels: { base: 0, boardBottom: 0, boardTop: 0, wallTop: 0 }, clipAt: null, timeMs: 0, clipFrame: null, cables: [], features: [],
    panel: { rails: [{ id: 'r1', x: 0, y: 0, dir: 'h', length: railLen }], mounts: [], modules: [], unplaced: [], depth: 0, collisions: [] } },
}) as unknown as GenResult;
const lines = (s: ReturnType<typeof checklist>, id: string) => s.find((x) => x.id === id)?.groups.flatMap((g) => g.lines.map((l) => `${l.qty}|${l.item}`)) ?? [];

describe('checklist', () => {
  it('has what to buy, what to print and the tools, each line with a key', () => {
    const p = rack(['rpi4', 'rpi4', 'usb_charger6']);
    const s = checklist(p, build(p));
    expect(s.map((x) => x.id)).toEqual(['buy', 'print', 'tools']);
    expect(lines(s, 'buy')).toContain('1|DIN rail (TS35 top-hat, 35 × 7.5 mm), cut to 300 mm');
    expect(lines(s, 'buy').some((x) => /USB charger/.test(x))).toBe(true);
    expect(lines(s, 'buy').some((x) => /^1\|PETG, about \d+ g$/.test(x))).toBe(true);
    expect(lines(s, 'print')).toEqual(['2|Raspberry Pi 4B holder', '1|USB charger (A + C) holder']);
    expect(s.find((x) => x.id === 'print')!.groups[0].head).toBe('Holders');
    expect(lines(s, 'tools').some((x) => /3D printer/.test(x))).toBe(true);
    const keys = lineKeys(s);
    expect(new Set(keys).size).toBe(keys.length); // every line has a key of its own
  });

  it('does not list the boards themselves as something to buy, nor what comes with the parts', () => {
    const p = rack(['rpi4', 'usb_charger6']);
    const s = checklist(p, build(p));
    expect(lines(s, 'buy').some((x) => /Raspberry Pi 4B$/.test(x))).toBe(false);
    expect(s.flatMap((x) => x.groups.map((g) => g.head)).some((h) => /Comes with|^Boards$/.test(h))).toBe(false);
  });

  it('ticks stay while the line does, and drop with it when the rack changes', () => {
    const p = rack(['rpi4', 'rpi4']);
    const before = checklist(p, build(p));
    const rail = before[0].groups.flatMap((g) => g.lines).find((l) => /cut to 300 mm/.test(l.item))!.key;
    const holders = before[1].groups[0].lines[0].key;
    p.ticks = setTick(setTick(undefined, rail, true), holders, true);
    // the same rack: nothing dropped
    expect(pruneTicks(p.ticks, before)).toEqual([rail, holders]);
    // a third Pi: three holders is another line (you have printed two), the rail is as it was
    p.modules.push(newModule(T('rpi4')));
    p.modules[2].board.name = 'Raspberry Pi 4B #3';
    const after = checklist(p, build(p));
    expect(pruneTicks(p.ticks, after)).toEqual([rail]);
    // the rail gets longer: that tick goes too
    expect(pruneTicks(p.ticks, checklist(p, build(p, 420)))).toEqual([]);
  });

  it('a tick for a board taken off the rack goes with its line', () => {
    const p = rack(['rpi4', 'usb_charger6']);
    const s = checklist(p, build(p));
    const charger = s[1].groups[0].lines.find((l) => /charger/i.test(l.item))!.key;
    const ticks = setTick(undefined, charger, true);
    p.modules.pop();
    expect(pruneTicks(ticks, checklist(p, build(p)))).toEqual([]);
  });

  it('sets and clears ticks one at a time or by group, never twice, and counts them', () => {
    const p = rack(['rpi4', 'usb_charger6']);
    const s = checklist(p, build(p));
    const all = lineKeys(s), buy = s[0].groups.flatMap((g) => g.lines.map((l) => l.key));
    let t = setTick(undefined, all[0], true);
    t = setTick(t, all[0], true);
    expect(t).toEqual([all[0]]);
    t = setTicks(t, buy, true);
    expect(progress(s, t)).toMatchObject({ done: buy.length, total: all.length, by: { buy: { done: buy.length, total: buy.length }, print: { done: 0 } } });
    t = setTicks(t, buy, false);
    expect(t).toEqual([]);
    expect(progress(s, undefined).done).toBe(0);
    expect(pruneTicks(['gone', all[1], all[1]], s)).toEqual([all[1]]);
  });
});
