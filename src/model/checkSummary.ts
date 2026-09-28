import type { Check, GenReport, Project } from './types';

/** A board's own note (from its template or box: "measure yours"), as the build lists it, and whose it is. */
export interface Reminder { text: string; note: string; modules: string[] }

/**
 * What the Check step, the Start page's rack card, the step bar and the 3D view's stats all count, so they agree:
 * failing checks, things to look at (warning checks and the build's own warnings) and reminders (the boards' notes,
 * less the ones ticked off). Reminders are not problems, so no badge counts them.
 */
export interface CheckSummary {
  passing: Check[];
  failing: Check[];
  look: Check[];
  warnings: string[]; // the build's warnings that are not board notes
  reminders: Reminder[];
  nLook: number; // look + warnings
}

/** The note a warning line carries: the line itself, or what follows "Pi 4B and Pi 4B #2: ". */
function noteOf(w: string, note: string): boolean {
  return w === note || w.endsWith(`: ${note}`);
}

export function summarizeChecks(p: Project | null, report: GenReport | null | undefined): CheckSummary {
  const checks = report?.checks ?? [];
  const warnings: string[] = [], reminders: Reminder[] = [];
  for (const w of report?.warnings ?? []) {
    const hit = (p?.modules ?? []).flatMap((m) => m.board.notes.filter((n) => noteOf(w, n)).map((n) => ({ m, n })));
    if (!hit.length) { warnings.push(w); continue; }
    const open = hit.filter(({ m, n }) => !(m.board.ack ?? []).includes(n));
    if (open.length) reminders.push({ text: w, note: open[0].n, modules: [...new Set(open.map(({ m }) => m.id))] });
  }
  const look = checks.filter((c) => c.status === 'warn');
  return { passing: checks.filter((c) => c.status === 'ok'), failing: checks.filter((c) => c.status === 'bad'), look, warnings, reminders, nLook: look.length + warnings.length };
}

/** Tick a board note off (or put it back): kept on the board, so it travels with the project file. */
export function ackNote(p: Project, moduleIds: string[], note: string, done = true) {
  for (const m of p.modules) {
    if (!moduleIds.includes(m.id)) continue;
    const a = new Set(m.board.ack ?? []);
    if (done) a.add(note); else a.delete(note);
    if (a.size) m.board.ack = [...a]; else delete m.board.ack;
  }
}
