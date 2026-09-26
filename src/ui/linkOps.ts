// Cable edits (undoable).
import { autoLinks, sameRef } from '../model/links';
import type { PlugRef } from '../model/types';
import { edit, select, store, toast } from '../state';

/** Add Auto-connect's suggestions for every plug still free. */
export function addLinks() {
  const p = store.get().project;
  if (!p) return;
  const add = autoLinks(p);
  if (!add.length) { toast('Every plug that has a partner is already connected. Add hubs or chargers (Start › accessories) for more.'); return; }
  edit((q) => { q.links = [...(q.links ?? []), ...add]; });
  toast(`Connected ${add.length} cable${add.length > 1 ? 's' : ''}. ⌘Z undoes it.`);
}

export function removeLinks(ids: string[]) {
  edit((q) => { q.links = (q.links ?? []).filter((l) => !ids.includes(l.id)); });
  select([]);
}

/** Connect plug a to plug b (or disconnect a when b is null), replacing whatever either was connected to. */
export function setLink(a: PlugRef, b: PlugRef | null, kind: NonNullable<import('../model/types').Link['kind']> = 'usb') {
  edit((q) => {
    q.links = (q.links ?? []).filter((l) => !sameRef(l.a, a) && !sameRef(l.b, a) && !(b && (sameRef(l.a, b) || sameRef(l.b, b))));
    if (b) q.links.push({ id: `l${Math.random().toString(36).slice(2, 8)}`, a, b, kind });
  });
}
