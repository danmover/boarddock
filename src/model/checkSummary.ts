import type { Board, Check, GenReport, Project } from './types';

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

/** A note that asks for the board's holes to be measured (the perfboard's): editing a hole is doing just that. */
const HOLE_NOTE = /measure the hole/i;
const holesOf = (b: Board) => b.holes.map((h) => `${h.id} ${h.x} ${h.y} ${h.d}`).join(';');
const shapeOf = (b: Board) => JSON.stringify([b.outline, b.cutouts]);

/**
 * After an edit (`next` is the copy just made from `prev`): a board whose holes were moved, resized, added or taken
 * away has had them measured, so its "measure the holes" reminder is ticked off. Not when the outline changed too:
 * reshaping a board carries its corner holes along, which measures nothing. True when it ticked something off.
 */
export function ackMeasuredHoles(prev: Project, next: Project): boolean {
  let any = false;
  for (const m of next.modules) {
    const open = m.board.notes.filter((n) => HOLE_NOTE.test(n) && !m.board.ack?.includes(n));
    const was = open.length ? prev.modules.find((x) => x.id === m.id)?.board : null;
    if (!was || holesOf(was) === holesOf(m.board) || shapeOf(was) !== shapeOf(m.board)) continue;
    for (const n of open) { ackNote(next, [m.id], n); any = true; }
  }
  return any;
}
