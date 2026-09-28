// Cable edits (undoable).
import { autoLinks, numberLinks, portBudget, sameRef, type PlugAt } from '../model/links';
import { TEMPLATES } from '../model/templates';
import { addAdapters, addProbes, addUartLinks, fillWires, stackProbes } from '../model/probes';
import { seatCompanion, seatCompanions, type Seated } from '../cad/dockplan';
import type { Module, PlugRef, Project } from '../model/types';
import { edit, putBoards, select, store, toast } from '../state';
import { afterBuild, watchRelayout } from './panelOps';
import { mountLabels } from '../model/built';

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
  watchRelayout();
  edit((q) => { q.links = numberLinks([...(q.links ?? []), ...add]).map((l) => fillWires(q, l)); stacked = stackProbes(q); seatCompanions(q); });
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
  watchRelayout();
  edit((q) => {
    q.links = (q.links ?? []).filter((l) => !sameRef(l.a, a) && !sameRef(l.b, a) && !(b && (sameRef(l.a, b) || sameRef(l.b, b))));
    if (b) q.links = numberLinks([...q.links, { id: `l${Math.random().toString(36).slice(2, 8)}`, a, b, kind }]).map((l) => fillWires(q, l));
    if (kind === 'debug' || kind === 'jumper') { stackProbes(q); seatCompanions(q); }
  });
}

/**
 * Where new probes or adapters went, in words for the toast: behind the board, in a dock beside it, or in a new dock
 * (and then, once the rack is built again, how long that made the rail).
 */
function seatNote(q: Project, board: string, seats: Seated[], n: number, what: string): { text: string; fresh: Seated | undefined } {
  const lab = mountLabels(store.get().result?.report.panel);
  const they = n > 1 ? 'they' : 'it';
  const fresh = seats.find((x) => x.where === 'new');
  const near = seats.find((x) => x.where === 'near');
  const nameOf = (id?: string) => q.modules.find((m) => m.id === id)?.board.name;
  if (!seats.length || seats.every((x) => x.where === 'home')) return { text: `${n > 1 ? ', stacked,' : ','} behind it in its dock`, fresh: undefined };
  if (near && !fresh) return { text: `: its dock had no free slot, so ${they} went in the free slot of dock ${lab.get(near.mount) ?? ''}${near.beside ? `, behind ${nameOf(near.beside)}` : ''} on the same rail`.replace(/ +/g, ' '), fresh: undefined };
  const rail = q.panel.rails.findIndex((r) => r.id === fresh?.rail) + 1;
  return { text: `: there was no free slot behind the ${board}, so ${they} got a new dock${rail ? ` on rail ${rail}` : ''}, in the first gap that fits or on the end of the rail (which then gets longer). ${what === 'J-Link' ? 'Its ribbon' : 'Its jumper wires'} may not reach from there: Check says`, fresh };
}

/** Seat new companions on a laid-out rack (behind their board where there is room), stacking them first. */
function seatNew(q: Project, added: Module[]): Seated[] {
  if (q.layout !== 'panel' || q.panel.auto) return [];
  return added.filter((x) => !x.on).map((x) => seatCompanion(q, x.id));
}

/** Once the rack is built again: say how long a new dock at the end made its rail. */
function railNote(fresh: Seated | undefined, name: string) {
  if (!fresh) return;
  const len0 = store.get().result?.report.panel?.rails.find((r) => r.id === fresh.rail)?.length;
  afterBuild((r) => {
    const pr = r.report.panel, mt = pr?.mounts.find((x) => x.id === fresh.mount), rail = mt && pr?.rails.find((x) => x.id === mt.rail);
    if (!pr || !mt || !rail) return;
    const k = pr.rails.indexOf(rail) + 1;
    const longer = len0 != null && rail.length > len0 + 0.5;
    const far = (r.report.warnings ?? []).find((w) => /ribbon is .* but has to run|jumper wires from .* have to run/.test(w) && w.includes(name));
    toast(`${name}: no free slot behind its board, so it got a new dock ${mountLabels(pr).get(mt.id) ?? ''} on rail ${k}${longer ? `, which is now ${Math.round(rail.length)} mm long (it was ${Math.round(len0!)})` : ''}.${far ? ` ${far}` : ''} To keep it behind its board, free that dock's back slot (drag the board there to another dock in the Rails step). ⌘Z undoes it.`);
  });
}

/**
 * J-Links for the free debug headers of a board (all of them, or just `refs`): cabled to its header and stacked in
 * one pile, which goes in the back slot of the board's dock (on a laid-out rack, when that slot is free). Their USB
 * cables are left to Auto-connect.
 */
export function addJLinks(moduleId: string, refs?: string[]) {
  let n = 0, name = '', note = { text: '', fresh: undefined as Seated | undefined }, first = '';
  edit((q) => {
    const m = q.modules.find((x) => x.id === moduleId);
    name = m?.board.name ?? '';
    const added = addProbes(q, moduleId, refs);
    n = added.length;
    first = added[0]?.board.name ?? '';
    note = seatNote(q, name, seatNew(q, added), n, 'J-Link');
  });
  if (!n) { toast(refs ? 'That header already has a probe.' : 'Every debug header on this board already has a probe.'); return; }
  toast(`Added ${n} J-Link${n > 1 ? 's' : ''} for the ${name}${note.text}. Press Auto-connect to plug ${n > 1 ? 'their' : 'its'} USB into a hub. ⌘Z undoes it.`);
  railNote(note.fresh, first);
}

/**
 * USB-serial adapters (the FT232RL board) for the free UART headers of a board (all, or just `refs`): jumper wires
 * from its pins to the header, stacked with the board's probes behind it. Their USB cables are left to Auto-connect.
 */
export function addSerialAdapters(moduleId: string, refs?: string[]) {
  let n = 0, name = '', note = { text: '', fresh: undefined as Seated | undefined }, first = '';
  edit((q) => {
    const m = q.modules.find((x) => x.id === moduleId);
    name = m?.board.name ?? '';
    const added = addAdapters(q, moduleId, refs);
    n = added.length;
    first = added[0]?.board.name ?? '';
    note = seatNote(q, name, seatNew(q, added), n, 'adapter');
  });
  if (!n) { toast(refs ? 'That header already has something on it.' : 'Every UART header on this board already has something on it.'); return; }
  toast(`Added ${n > 1 ? `${n} USB-serial adapters` : 'a USB-serial adapter'} for the ${name}${note.text}, with jumper wires on GND, TX and RX (crossed over). Press Auto-connect to plug ${n > 1 ? 'their' : 'its'} USB into a hub. ⌘Z undoes it.`);
  railNote(note.fresh, first);
}

/** A USB-serial cable from each free UART header of a board to the nearest free USB port. */
export function addUartCables(moduleId: string) {
  let r = { added: 0, left: 0 };
  edit((q) => { r = addUartLinks(q, moduleId); });
  if (!r.added && !r.left) { toast('Every UART header on this board already has a cable.'); return; }
  toast(`${r.added ? `Added ${r.added} USB-serial cable${r.added > 1 ? 's' : ''} (USB to TTL, 3.3 V) to the nearest free USB port${r.added > 1 ? 's' : ''}.` : ''}${r.left ? ` ${r.left} UART header${r.left > 1 ? 's' : ''} found no free USB port: add a hub (Start › accessories).` : ''} ⌘Z undoes it.`);
}
