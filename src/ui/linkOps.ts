// Cable edits (undoable).
import { autoLinks, portBudget, sameRef } from '../model/links';
import type { PlugRef } from '../model/types';
import { edit, select, store, toast } from '../state';

/** Add Auto-connect's suggestions for every plug still free. */
export function addLinks() {
  const p = store.get().project;
  if (!p) return;
  const add = autoLinks(p);
  const left = () => { const b = portBudget(store.get().project!); return [b.devices.length ? `${b.devices.length} USB device${b.devices.length > 1 ? 's have' : ' has'} no free port: add a hub or give it more ports.` : '', b.powerIns.length ? `${b.powerIns.length} board${b.powerIns.length > 1 ? 's need' : ' needs'} power: add a charger.` : ''].filter(Boolean).join(' '); };
  if (!add.length) { toast(`Every plug that has a partner is already connected. ${left() || 'Add hubs or chargers (Start › accessories) for more.'}`); return; }
  edit((q) => { q.links = [...(q.links ?? []), ...add]; });
  toast(`Connected ${add.length} cable${add.length > 1 ? 's' : ''}. ${left()} ⌘Z undoes it.`);
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
