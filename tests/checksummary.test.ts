import { describe, expect, it } from 'vitest';
import { newModule, newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { mergeNotes } from '../src/cad/assembly';
import { ackMeasuredHoles, ackNote, collapseChecks, summarizeChecks, verdictOf } from '../src/model/checkSummary';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { commitFrom, editMod, loadProject, store, undo } from '../src/state';
import type { Board, Check, GenReport } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('check summary', () => {
  it('splits board notes from real warnings, counts only what needs looking at, and forgets ticked-off notes', () => {
    const p = newProject(T('proto_5x7'));
    const b2 = { ...T('proto_5x7'), name: 'Perfboard #2' };
    p.modules.push(newModule(b2));
    const note = p.modules[0].board.notes[0];
    const names = p.modules.map((m) => m.board.name);
    const warnings = mergeNotes([`${names[0]}: ${note}`, `${names[1]}: ${note}`, 'Something is in the way.'], names);
    const report = { warnings, checks: [{ group: 'g', name: 'a', value: '', status: 'bad' }, { group: 'g', name: 'b', value: '', status: 'warn' }, { group: 'g', name: 'c', value: '', status: 'ok' }] } as unknown as GenReport;
    const s = summarizeChecks(p, report);
    expect(s.failing.length).toBe(1);
    expect(s.nLook).toBe(2); // the warn check and the one real warning
    expect(s.reminders.length).toBe(1);
    expect(s.reminders[0].modules.length).toBe(2);
    ackNote(p, [p.modules[0].id], note);
    expect(summarizeChecks(p, report).reminders[0].modules).toEqual([p.modules[1].id]);
    ackNote(p, s.reminders[0].modules, note);
    expect(summarizeChecks(p, report).reminders.length).toBe(0);
    ackNote(p, s.reminders[0].modules, note, false);
    expect(p.modules[0].board.ack).toBeUndefined();
  });
});

describe("the perfboard's 'measure the holes' reminder", () => {
  const rack = () => {
    const p = newProject(T('proto_5x7'));
    p.modules.push(newModule({ ...T('proto_5x7'), name: 'Perfboard #2' }));
    p.modules.push(newModule(T('uno')));
    return p;
  };
  const note = (p: ReturnType<typeof rack>) => p.modules[0].board.notes[0];
  const reminders = (p: ReturnType<typeof rack>) => summarizeChecks(p, { warnings: mergeNotes(p.modules.slice(0, 2).map((m) => `${m.board.name}: ${note(p)}`), p.modules.map((m) => m.board.name)), checks: [] } as unknown as GenReport).reminders.flatMap((r) => r.modules);

  it('ticks off for the board whose hole was moved, resized, added or taken away, and only that one', () => {
    for (const change of [(b: Board) => { b.holes[1].x += 0.4; }, (b: Board) => { b.holes[0].d = 2.4; }, (b: Board) => { b.holes.push({ ...b.holes[0], id: 'hx', x: 20 }); }, (b: Board) => { b.holes.pop(); }]) {
      const p = rack(), q = structuredClone(p);
      change(q.modules[0].board);
      expect(ackMeasuredHoles(p, q)).toBe(true);
      expect(q.modules[0].board.ack).toEqual([note(p)]);
      expect(q.modules[1].board.ack).toBeUndefined();
      expect(reminders(q)).toEqual([p.modules[1].id]);
    }
  });

  it('is left alone by anything that is not a hole edit: a part, a hole role, a reshaped board', () => {
    const p = rack();
    const same = (fn: (q: typeof p) => void) => { const q = structuredClone(p); fn(q); expect(ackMeasuredHoles(p, q)).toBe(false); expect(q.modules[0].board.ack).toBeUndefined(); };
    same(() => {});
    same((q) => { q.modules[0].board.holes[0].role = 'standoff'; q.modules[0].board.holes[0].use = 'none'; });
    same((q) => { q.modules[0].board.name = 'Mine'; });
    // resizing the board carries its corner holes along: nothing was measured
    same((q) => { const b = q.modules[0].board; b.outline = b.outline.map(([x, y]) => [x > 35 ? x + 5 : x, y] as [number, number]); b.holes[1].x += 5; b.holes[3].x += 5; });
    // (the Uno has no such note, whatever happens to its holes)
    const q = structuredClone(p);
    q.modules[2].board.holes[0].x += 1;
    expect(ackMeasuredHoles(p, q)).toBe(false);
  });

  it('happens on edits and on a finished drag, and one undo brings the reminder back', () => {
    const p = rack();
    loadProject(p);
    const id = p.modules[0].id;
    const open = () => reminders(store.get().project!).includes(id);
    expect(open()).toBe(true);
    editMod((m) => { m.board.name = 'Renamed'; });
    expect(open()).toBe(true);
    // a drag: shown with store.set as it goes, then made one undo step
    const pre = store.get().project!, live = structuredClone(pre);
    live.modules[0].board.holes[2].y += 1.5;
    store.set({ project: live });
    commitFrom(pre);
    expect(open()).toBe(false);
    expect(store.get().project!.modules[0].board.ack).toEqual([note(p)]);
    undo();
    expect(open()).toBe(true);
    editMod((m) => { m.board.holes[0].d = 2.2; });
    expect(open()).toBe(false);
  });
});

describe('the items to look at', () => {
  it('gives each a verdict, and folds the same line from several boards into one row with a count', () => {
    expect(verdictOf('Tongue root, 8 N push on the far edge')).toBe('OK to print');
    expect(verdictOf('Material')).toBe('OK to print');
    expect(verdictOf('DC inputs with no supply')).toBe('worth a look');
    const c = (module: string, value: string): Check => ({ group: `${module} · Dock`, name: 'Tongue root, 8 N push on the far edge', value, status: 'warn', module });
    const rows = collapseChecks([c('a', '30 MPa'), c('b', '38 MPa'), c('a', '31 MPa'), { group: 'Power', name: 'Tipping', value: '', status: 'warn' }]);
    expect(rows.map((r) => [r.c.name, r.n])).toEqual([['Tongue root, 8 N push on the far edge', 3], ['Tipping', 1]]);
    expect(rows[0].modules).toEqual(['a', 'b']);
    expect(rows[0].c.value).toBe('38 MPa'); // the worst speaks for the row
  });

  it("does not warn about a library template's standoff touching a part (the Uno's hole 14, 2.5)", async () => {
    await initKernel();
    const p = newProject(T('uno'));
    p.layout = 'loose';
    expect(generate(p).report.warnings.some((w) => /^Standoff at hole/.test(w))).toBe(false);
    p.modules[0].board.source = 'my own file';
    expect(generate(p).report.warnings.some((w) => /^Standoff at hole/.test(w))).toBe(true);
  }, 60_000);
});
