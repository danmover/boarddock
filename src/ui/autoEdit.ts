// Automatic changes to the rack (Auto-arrange, Tidy up, Auto-connect, docks sliding to make room...): they leave what is
// locked alone and write a receipt for what they did. One undo step like any edit (or none, for a follow-up: `amend`).
import type { Project } from '../model/types';
import { addReceipts, describeMoves, enforceLocks, placesOf } from '../model/locks';
import { mountLabels } from '../model/built';
import { amend, edit, store } from '../state';

const rep = () => store.get().result?.report.panel ?? null;

/** What a dock and a rail are called on the rack ("dock 1.2", "rail 2"), from the layout as last built. */
function namer(p: Project) {
  const lab = mountLabels(rep());
  return (kind: 'dock' | 'rail', id: string) => (kind === 'dock' ? `dock ${lab.get(id) ?? id.replace(/^d/, '')}` : `rail ${p.panel.rails.findIndex((r) => r.id === id) + 1 || id.replace(/^r/, '')}`);
}

const nameOfBoard = (p: Project) => (id: string) => p.modules.find((m) => m.id === id)?.board.name ?? 'a board';

/**
 * Change the rack automatically: run `fn` on a copy, put back whatever it did to a locked dock or rail, write a receipt for
 * what it did (`texts`: its own lines; and with `layout` the boards it moved to other rails), and make it one undo
 * step (`amend`: none: a follow-up to the last change). Returns the receipts written.
 */
export function autoEdit(what: string, fn: (p: Project) => void, opts: { amend?: boolean; layout?: boolean; texts?: (before: Project, after: Project) => string[] } = {}): string[] {
  const cur = store.get().project;
  if (!cur) return [];
  const rep0 = rep();
  let out: string[] = [];
  (opts.amend ? amend : edit)((q) => {
    fn(q);
    const held = enforceLocks(cur, q, namer(cur));
    out = [
      ...(opts.texts?.(cur, q) ?? []),
      // (an automatic layout is placed only once it is built: receiptAfterBuild)
      ...(opts.layout && !q.panel.auto ? describeMoves(what, placesOf(cur, rep0), placesOf(q), nameOfBoard(q)) : []),
      ...(held.length ? [`${what} left ${held.join(' and ')} alone: ${held.length > 1 ? 'they are' : 'it is'} locked`] : []),
    ];
    addReceipts(q, what, out);
  });
  return out;
}

/** Write receipts into the rack now, with no undo step of their own (part of the change just made). */
export function noteReceipts(what: string, texts: string[]) {
  if (texts.length) amend((q) => addReceipts(q, what, texts));
}

/** Take every receipt off the list (not an undo step). */
export function clearReceipts() {
  amend((q) => { delete q.receipts; });
}
