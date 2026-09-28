import { describe, expect, it } from 'vitest';
import { newModule, newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { mergeNotes } from '../src/cad/assembly';
import { ackNote, summarizeChecks } from '../src/model/checkSummary';
import type { GenReport } from '../src/model/types';

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
