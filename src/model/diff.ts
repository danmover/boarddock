// What changed between two versions of a project, in a few words: undo and redo say what they took back or put
// back ("Undid: removed Raspberry Pi Pico 2"), so a user stepping through the history knows where they are.
import type { Project } from './types';

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const names = (xs: string[]) => (xs.length > 2 ? `${xs.length} boards` : xs.join(' and '));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The change from `a` to `b`, e.g. "added Relay board", "holder settings of 6 boards", "rack layout". */
export function describeChange(a: Project, b: Project): string {
  const out: string[] = [];
  const ia = new Map(a.modules.map((m) => [m.id, m])), ib = new Map(b.modules.map((m) => [m.id, m]));
  const added = b.modules.filter((m) => !ia.has(m.id)).map((m) => m.board.name);
  const removed = a.modules.filter((m) => !ib.has(m.id)).map((m) => m.board.name);
  if (added.length) out.push(`added ${names(added)}`);
  if (removed.length) out.push(`removed ${names(removed)}`);
  const boards: string[] = [], holders: string[] = [];
  for (const m of b.modules) {
    const o = ia.get(m.id);
    if (!o) continue;
    if (o.board.name !== m.board.name && o.board.source !== m.board.source) out.push(`replaced ${o.board.name} with ${m.board.name}`);
    else if (o.board.name !== m.board.name && same({ ...o.board, name: '' }, { ...m.board, name: '' })) out.push(`renamed ${o.board.name} to ${m.board.name}`);
    else if (!same(o.board, m.board)) boards.push(m.board.name);
    if (!same(o.holder, m.holder)) holders.push(m.board.name);
    if (o.on !== m.on || o.onMode !== m.onMode || o.onGap !== m.onGap) out.push(`stacking of ${m.board.name}`);
  }
  if (boards.length) out.push(boards.length > 2 ? `${boards.length} boards` : `the board ${names(boards)}`);
  if (holders.length) out.push(`holder settings of ${holders.length > 2 ? `${holders.length} boards` : names(holders)}`);
  const la = a.links ?? [], lb = b.links ?? [];
  const lin = lb.filter((l) => !la.some((x) => x.id === l.id)).length, lout = la.filter((l) => !lb.some((x) => x.id === l.id)).length;
  if (lin && !added.length) out.push(`${plural(lin, 'cable')} added`);
  if (lout && !removed.length) out.push(`${plural(lout, 'cable')} removed`);
  if (!lin && !lout && !same(la, lb)) out.push('cables');
  if (a.layout !== b.layout) out.push(b.layout === 'panel' ? 'rails layout' : 'loose holders');
  else if (!same(a.panel, b.panel) && !added.length && !removed.length) out.push('rack layout');
  if (!same(a.printer, b.printer)) out.push(a.printer.name !== b.printer.name ? `printer (${b.printer.name})` : 'printer settings');
  if (!same(a.arrange, b.arrange) || !same(a.mount, b.mount) || !same(a.stand, b.stand)) out.push('layout settings');
  if (!!a.built !== !!b.built) out.push(b.built ? 'marked as built' : 'unmarked as built');
  if ((a.name ?? '') !== (b.name ?? '')) out.push('rack name');
  if (!out.length) return a.active !== b.active ? 'board selection' : 'a small change';
  return out.slice(0, 2).join(', ') + (out.length > 2 ? ` and ${out.length - 2} more` : '');
}

/** The name files are saved under: the one the user gave, or the board when there is one, or "Rack, 8 boards". */
export function rackName(p: Project): string {
  if (p.name?.trim()) return p.name.trim();
  return p.modules.length === 1 ? p.modules[0].board.name : `Rack, ${p.modules.length} boards`;
}

/** A board's kind by name: "Raspberry Pi 4B 3" is a "Raspberry Pi 4B" when the rack has one by that name. */
export function kindName(p: Project, name: string): string {
  const m = /^(.*) (\d+)$/.exec(name);
  return m && p.modules.some((x) => x.board.name === m[1]) ? m[1] : name;
}

/** The boards of the same kind as this one (itself included). */
export const sameKind = (p: Project, name: string) => p.modules.filter((x) => kindName(p, x.board.name) === kindName(p, name));
