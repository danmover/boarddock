// Cable edits (undoable).
import { autoLinks, numberLinks, portBudget, sameRef, type PlugAt } from '../model/links';
import { TEMPLATES } from '../model/templates';
import { addAdapters, addProbes, addUartLinks, fillWires, stackProbes } from '../model/probes';
import { seatCompanion } from '../cad/dockplan';
import type { PlugRef } from '../model/types';
import { edit, putBoards, select, store, toast } from '../state';

/** Where each plug is on the rack as laid out now (for measuring cables), if it has been laid out. */
export const plugPlaces = (): PlugAt | undefined => { const m = store.get().result?.report.panel?.plugs; return m ? (k: string) => m[k] : undefined; };

/** Add Auto-connect's suggestions for every plug still free (or only cables of one kind: "the same for the others"). */
export function addLinks(only?: NonNullable<import('../model/types').Link['kind']>) {
  const p = store.get().project;
  if (!p) return;
  const add = autoLinks(p, plugPlaces()).filter((l) => !only || l.kind === only);
  const left = () => { const b = portBudget(store.get().project!); return [b.devices.length ? `${b.devices.length} USB device${b.devices.length > 1 ? 's have' : ' has'} no free port: add a hub or give it more ports.` : '', b.powerIns.length ? `${b.powerIns.length} board${b.powerIns.length > 1 ? 's need' : ' needs'} power: add a charger.` : ''].filter(Boolean).join(' '); };
  if (!add.length) { toast(`Every plug that has a partner is already connected. ${left() || 'Add hubs or chargers (Start › accessories) for more.'}`); return; }
  let stacked = false;
  edit((q) => { q.links = numberLinks([...(q.links ?? []), ...add]).map((l) => fillWires(q, l)); stacked = stackProbes(q); });
  toast(`Connected ${add.length} cable${add.length > 1 ? 's' : ''}.${stacked ? ' The probes and adapters for one board stack up behind it.' : ''} ${left()} ⌘Z undoes it.`);
}

/**
 * Rewire: take out every cable Auto-connect made (the ones you connected yourself stay) and connect again, measured on
 * the rack as it is laid out now. A built rack keeps its cables (they are bought): it asks first.
 */
export function rewire() {
  const p = store.get().project;
  if (!p) return;
  const autoOnes = (p.links ?? []).filter((l) => l.auto);
  if (p.built && autoOnes.length && !confirm('The rack is built: rewiring can change cables you have already bought and tagged. Rewire anyway?')) return;
  let n = 0;
  edit((q) => {
    q.links = (q.links ?? []).filter((l) => !l.auto);
    const add = autoLinks(q, plugPlaces());
    n = add.length;
    q.links = numberLinks([...q.links, ...add]).map((l) => fillWires(q, l));
    stackProbes(q);
  });
  toast(`Rewired: ${n} cable${n === 1 ? '' : 's'} chosen again for the rack as it stands now; the ones you connected yourself stayed. ⌘Z undoes it.`);
}

/** Add an accessory from the library (a charger, a hub, a switch) and connect what it was added for. */
export function addAccessory(id: string, count = 1) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  putBoards(Array.from({ length: count }, () => t.make()), false, { stay: true }); // staying where you are
  addLinks();
}

export function removeLinks(ids: string[]) {
  edit((q) => { q.links = (q.links ?? []).filter((l) => !ids.includes(l.id)); });
  select([]);
}

/** Connect plug a to plug b (or disconnect a when b is null), replacing whatever either was connected to. */
export function setLink(a: PlugRef, b: PlugRef | null, kind: NonNullable<import('../model/types').Link['kind']> = 'usb') {
  edit((q) => {
    q.links = (q.links ?? []).filter((l) => !sameRef(l.a, a) && !sameRef(l.b, a) && !(b && (sameRef(l.a, b) || sameRef(l.b, b))));
    if (b) q.links = numberLinks([...q.links, { id: `l${Math.random().toString(36).slice(2, 8)}`, a, b, kind }]).map((l) => fillWires(q, l));
    if (kind === 'debug' || kind === 'jumper') stackProbes(q);
  });
}

/**
 * A J-Link for each free debug header of a board: cabled to its header and stacked in one pile, which goes in the
 * back slot of the board's dock (on a laid-out rack, when that slot is free). Their USB cables are left to
 * Auto-connect.
 */
export function addJLinks(moduleId: string) {
  let n = 0, name = '';
  edit((q) => {
    const m = q.modules.find((x) => x.id === moduleId);
    name = m?.board.name ?? '';
    const added = addProbes(q, moduleId);
    n = added.length;
    if (q.layout === 'panel' && !q.panel.auto) for (const pm of added) if (!pm.on) seatCompanion(q, pm.id);
  });
  if (!n) { toast('Every debug header on this board already has a probe.'); return; }
  toast(`Added ${n} J-Link${n > 1 ? 's' : ''} for the ${name}${n > 1 ? ', stacked,' : ''} behind it in its dock. Press Auto-connect to plug ${n > 1 ? 'their' : 'its'} USB into a hub. ⌘Z undoes it.`);
}

/**
 * A USB-serial adapter (the FT232RL board) for each free UART header of a board: jumper wires from its pins to the
 * header, stacked with the board's probes behind it. Their USB cables are left to Auto-connect.
 */
export function addSerialAdapters(moduleId: string) {
  let n = 0, name = '';
  edit((q) => {
    const m = q.modules.find((x) => x.id === moduleId);
    name = m?.board.name ?? '';
    const added = addAdapters(q, moduleId);
    n = added.length;
    if (q.layout === 'panel' && !q.panel.auto) for (const am of added) if (!am.on) seatCompanion(q, am.id);
  });
  if (!n) { toast('Every UART header on this board already has something on it.'); return; }
  toast(`Added ${n > 1 ? `${n} USB-serial adapters` : 'a USB-serial adapter'} for the ${name}, behind it in its dock, with jumper wires on GND, TX and RX (crossed over). Press Auto-connect to plug ${n > 1 ? 'their' : 'its'} USB into a hub. ⌘Z undoes it.`);
}

/** A USB-serial cable from each free UART header of a board to the nearest free USB port. */
export function addUartCables(moduleId: string) {
  let r = { added: 0, left: 0 };
  edit((q) => { r = addUartLinks(q, moduleId); });
  if (!r.added && !r.left) { toast('Every UART header on this board already has a cable.'); return; }
  toast(`${r.added ? `Added ${r.added} USB-serial cable${r.added > 1 ? 's' : ''} (USB to TTL, 3.3 V) to the nearest free USB port${r.added > 1 ? 's' : ''}.` : ''}${r.left ? ` ${r.left} UART header${r.left > 1 ? 's' : ''} found no free USB port: add a hub (Start › accessories).` : ''} ⌘Z undoes it.`);
}
