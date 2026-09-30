// Cable edits (undoable).
import { autoLinks, KIND_NAME, numberLinks, portBudget, powerShort, sameRef, strongerPower, toComputer, type PlugAt } from '../model/links';
import { TEMPLATES } from '../model/templates';
import { dcPack, ownSupply } from '../model/boxes';
import { completeRack } from '../model/complete';
import { newModule } from '../model/library';
import { addAdapters, addProbes, addUartLinks, fillWires, stackCompanions } from '../model/probes';
import { addDebugGear } from '../model/debuggear';
import type { CompanionKey } from '../model/boxes';
import { seatBoard, seatCompanion, seatCompanions, type Seated } from '../cad/dockplan';
import type { Module, PlugRef, Project } from '../model/types';
import { edit, putBoards, select, store, toast } from '../state';
import { autoEdit } from './autoEdit';
import { afterBuild, watchRelayout } from './panelOps';
import { mountLabels } from '../model/built';

/** "9 cables (4 power, 4 Ethernet, 1 mains)". */
const cablesText = (ls: { kind?: keyof typeof KIND_NAME }[]) => {
  const n = new Map<string, number>();
  for (const l of ls) n.set(KIND_NAME[l.kind ?? 'usb'], (n.get(KIND_NAME[l.kind ?? 'usb']) ?? 0) + 1);
  return `${ls.length} cable${ls.length === 1 ? '' : 's'}${n.size > 1 ? ` (${[...n].map(([k, c]) => `${c} ${k}`).join(', ')})` : n.size ? ` (${[...n.keys()][0]})` : ''}`;
};

/** Where each plug is on the rack as laid out now (for measuring cables), if it has been laid out. */
export const plugPlaces = (): PlugAt | undefined => { const m = store.get().result?.report.panel?.plugs; return m ? (k: string) => m[k] : undefined; };

/**
 * Add Auto-connect's suggestions for every plug still free (or only cables of one kind: "the same for the others").
 * `stronger`: then move boards on ports too weak for them to stronger free ones (a charger or supply just added), in
 * the same undo step.
 */
export function addLinks(only?: NonNullable<import('../model/types').Link['kind']>, stronger = false) {
  const p = store.get().project;
  if (!p) return;
  const add = autoLinks(p, plugPlaces()).filter((l) => !only || l.kind === only);
  if (stronger) {
    let moved = 0;
    const q0 = { ...p, links: numberLinks([...(p.links ?? []), ...add]) };
    const r = strongerPower(q0, plugPlaces());
    if (r || add.length) {
      let stacked = false;
      autoEdit('Auto-connect', (q) => { q.links = (r ? r.links : q0.links).map((l) => fillWires(q, l)); stacked = stackCompanions(q); moved = r?.moved ?? 0; }, { texts: () => [add.length ? `Auto-connect added ${cablesText(add)}` : '', moved ? `Auto-connect moved ${moved} board${moved > 1 ? 's' : ''} to stronger ports` : ''].filter(Boolean) });
      const pc = toComputer(p, add);
      toast(`Connected ${add.length} cable${add.length === 1 ? '' : 's'}${moved ? ` and moved ${moved} board${moved > 1 ? 's' : ''} to stronger ports` : ''}.${stacked ? ' The probes and adapters for one board stack up behind it.' : ''}${pc ? ` ${pc}` : ''} ⌘Z undoes it.`);
      return;
    }
  }
  const left = () => {
    const q = store.get().project!, b = portBudget(q), n = powerShort(q).unserved.length;
    return [b.devices.length ? `${b.devices.length} USB device${b.devices.length > 1 ? 's have' : ' has'} no free port: add a hub or give it more ports.` : '', n ? `${n} board${n > 1 ? 's need' : ' needs'} power no free port gives: add a charger or a supply (the Plugs step offers one).` : ''].filter(Boolean).join(' ');
  };
  if (!add.length) { toast(`Every plug that has a partner is already connected. ${left() || 'Add hubs or chargers (Start › accessories) for more.'}`); return; }
  let stacked = false;
  watchRelayout();
  autoEdit('Auto-connect', (q) => { q.links = numberLinks([...(q.links ?? []), ...add]).map((l) => fillWires(q, l)); stacked = stackCompanions(q); seatCompanions(q); }, { texts: () => [`Auto-connect added ${cablesText(add)}`] });
  const pc = toComputer(p, add);
  toast(`Connected ${add.length} cable${add.length > 1 ? 's' : ''}.${stacked ? ' The probes and adapters for one board stack up behind it.' : ''}${pc ? ` ${pc}` : ''} ${left()} ⌘Z undoes it.`);
}

/**
 * "Complete this rack": put on the rack what completeRack says it lacks (a supply for each Pi, a powerboard for the
 * outlets, a switch with its own supply), and connect it all the way Auto-connect would (the switch's uplink too): the
 * boards, their supplies and every cable are one undo step.
 */
export function completeThisRack() {
  const p = store.get().project;
  if (!p) return;
  const gaps = completeRack(p);
  const boards = gaps.flatMap((g) => g.add.filter((id) => !id.startsWith('own:')).map((id) => ({ id, own: !!g.own }))).flatMap((x) => { const t = TEMPLATES.find((y) => y.id === x.id); return t ? [{ board: t.make(), own: x.own }] : []; });
  const owns = gaps.flatMap((g) => g.add.filter((id) => id.startsWith('own:')).map((id) => id.slice(4)));
  if (!gaps.length) return;
  const n0 = p.modules.length;
  const put = (q: Project) => {
    // each new switch brings its own supply, and a switch or hub already there the one it came with
    const extra = [...q.modules.slice(n0).filter((_, i) => boards[i]?.own), ...owns.flatMap((id) => q.modules.filter((m) => m.id === id))];
    for (const box of extra) {
      const b = ownSupply(box);
      if (!b) continue;
      q.modules.push(newModule(b, q.modules[q.active].holder));
      if (q.layout === 'panel' && !q.panel.auto) seatBoard(q, q.modules[q.modules.length - 1].id);
    }
    // every cable Auto-connect has now, and boards on ports too weak for them moved to stronger ones
    const q0 = { ...q, links: numberLinks([...(q.links ?? []), ...autoLinks(q, plugPlaces())]) };
    const r = strongerPower(q0, plugPlaces());
    q.links = (r ? r.links : q0.links).map((l) => fillWires(q, l));
    stackCompanions(q);
  };
  if (boards.length) putBoards(boards.map((b) => b.board), false, { stay: true, keepActive: true, also: put });
  else edit(put);
  const now = store.get().project!, cables = (now.links?.length ?? 0) - (p.links?.length ?? 0);
  const added = now.modules.slice(n0).map((m) => m.board.name);
  toast(`Completed the rack: added ${added.length ? added.join(', ') : 'nothing new'} and ${cables} cable${cables === 1 ? '' : 's'}, all in one step. ⌘Z undoes it.`);
}

/**
 * Leaving the Plugs step with Next on a rack with no cables at all: Auto-connect first (one undo step, with its toast),
 * so the rack isn't built with none. A rack you have connected yourself, even in part, is left as it is. True when it
 * connected something.
 */
export function connectIfNone(): boolean {
  const p = store.get().project;
  if (!p || (p.links ?? []).length || !autoLinks(p, plugPlaces()).length) return false;
  addLinks();
  return true;
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
  autoEdit('Rewire', (q) => {
    q.links = (q.links ?? []).filter((l) => !l.auto);
    const add = autoLinks(q, plugPlaces());
    n = add.length;
    q.links = numberLinks([...q.links, ...add]).map((l) => fillWires(q, l));
    stackCompanions(q);
  }, { texts: () => [`Rewire chose ${n} cable${n === 1 ? '' : 's'} again for the rack as it is laid out now`] });
  toast(`Rewired: ${n} cable${n === 1 ? '' : 's'} chosen again for the rack as it stands now; the ones you connected yourself stayed. ⌘Z undoes it.`);
}

/** Add an accessory from the library (a charger, a hub, a switch) and connect what it was added for. */
export function addAccessory(id: string, count = 1) {
  // own:<box>: the plug pack a switch or powered hub came with, for its DC input (own:<box>,<box>: for several)
  if (id.startsWith('own:')) {
    const bs = id.slice(4).split(',').flatMap((x) => { const box = store.get().project?.modules.find((m) => m.id === x), b = box && ownSupply(box); return b ? [b] : []; });
    if (!bs.length) return;
    putBoards(bs, false, { stay: true });
    addLinks(undefined, true);
    return;
  }
  // dcpack:<volts>: a plug pack at that voltage, for a board whose DC jack takes less than 12 V
  if (id.startsWith('dcpack:')) {
    putBoards(Array.from({ length: count }, () => dcPack(Number(id.slice(7)))), false, { stay: true });
    addLinks(undefined, true);
    return;
  }
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  putBoards(Array.from({ length: count }, () => t.make()), false, { stay: true }); // staying where you are
  addLinks(undefined, true);
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
    if (kind === 'debug' || kind === 'jumper') { stackCompanions(q); seatCompanions(q); }
  });
}

/**
 * Where new probes or adapters went, in words for the toast: in a column beside the board (laid out automatically), in
 * the back slot of its dock, in a dock beside it, or in a new dock (and then, once the rack is built again, how long
 * that made the rail).
 */
function seatNote(q: Project, board: string, seats: Seated[], n: number, what: string): { text: string; fresh: Seated | undefined } {
  const lab = mountLabels(store.get().result?.report.panel);
  const they = n > 1 ? 'they' : 'it';
  const fresh = seats.find((x) => x.where === 'new');
  const near = seats.find((x) => x.where === 'near');
  const nameOf = (id?: string) => q.modules.find((m) => m.id === id)?.board.name;
  if (q.layout === 'panel' && q.panel.auto) return { text: `, standing ${n > 1 ? 'on their long edges ' : 'on its long edge '}in a column beside it`, fresh: undefined };
  if (!seats.length || seats.every((x) => x.where === 'home')) return { text: `${n > 1 ? ', in a column,' : ','} in the back slot of its dock`, fresh: undefined };
  if (near && !fresh) return { text: `: its dock had no free slot, so ${they} went in the free slot of dock ${lab.get(near.mount) ?? ''}${near.beside ? `, behind ${nameOf(near.beside)}` : ''} on the same rail`.replace(/ +/g, ' '), fresh: undefined };
  const rail = q.panel.rails.findIndex((r) => r.id === fresh?.rail) + 1;
  return { text: `: there was no free slot in the ${board}'s dock, so ${they} got a new dock${rail ? ` on rail ${rail}` : ''}, in the first gap that fits or on the end of the rail (which then gets longer). ${what === 'J-Link' ? 'Its ribbon' : 'Its jumper wires'} may not reach from there: Check says`, fresh };
}

/** Seat new companions on a laid-out rack (in their board's dock where there is room), in a column first. */
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
    toast(`${name}: no free slot in its board's dock, so it got a new dock ${mountLabels(pr).get(mt.id) ?? ''} on rail ${k}${longer ? `, which is now ${Math.round(rail.length)} mm long (it was ${Math.round(len0!)})` : ''}.${far ? ` ${far}` : ''} To keep it by its board, free that dock's back slot (drag the board there to another dock in the Rails step). ⌘Z undoes it.`);
  });
}

/**
 * J-Links for the free debug headers of a board (all of them, or just `refs`): cabled to its header and standing in
 * one column with the board's adapters, beside it (on a laid-out rack, in the back slot of its dock when that is free).
 * Their USB cables are left to Auto-connect.
 */
export function addJLinks(moduleId: string, refs?: string[], as?: CompanionKey) {
  let n = 0, name = '', note = { text: '', fresh: undefined as Seated | undefined }, first = '';
  edit((q) => {
    const m = q.modules.find((x) => x.id === moduleId);
    name = m?.board.name ?? '';
    const added = addProbes(q, moduleId, refs, as);
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

/**
 * One press: a J-Link for every free debug header and a USB-serial adapter for every free UART header, on every board
 * (or only `ids`), each cabled to its header, their USB cables to a hub, standing in a column beside its board. One
 * undo step. Says what to buy and to check the UART pin names.
 */
export function addDebugGearFor(ids?: string[]) {
  let g: ReturnType<typeof addDebugGear> | null = null, fresh = 0;
  watchRelayout();
  edit((q) => {
    g = addDebugGear(q, ids, plugPlaces());
    fresh = seatNew(q, [...g.probes, ...g.adapters]).filter((x) => x.where === 'new').length;
  });
  const r = g as ReturnType<typeof addDebugGear> | null;
  if (!r || !(r.probes.length + r.adapters.length)) { toast('Every debug and UART header already has a J-Link, an adapter or a cable on it.'); return; }
  const pl = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;
  const what = [r.probes.length ? pl(r.probes.length, 'J-Link') : '', r.adapters.length ? pl(r.adapters.length, 'USB-serial adapter') : ''].filter(Boolean).join(' and ');
  const kinds = [...new Set(r.probes.map((x) => x.board.name.replace(/\s*\(.*\)$/, '')))].join(', ');
  const q = store.get().project!;
  const where = q.layout === 'panel' && q.panel.auto ? 'each standing on its long edge in a column beside its board' : fresh ? `${fresh} in a new dock (their ribbons may not reach: see Plugs › Debug and serial)` : 'in the docks of their boards';
  toast(`Added ${what} for ${[...new Set(r.boards)].join(', ')}${kinds && r.probes.length > 1 ? ` (${kinds})` : ''}, ${where}. ${r.usb ? `Their USB cables are connected.` : 'Add a hub for their USB (Start › accessories), then Auto-connect.'}${r.guess.length ? ' The UART pin names are a guess: check yours on the board before you power it.' : ''} What to buy: Plugs › Debug and serial. ⌘Z undoes it.`);
}

/** A USB-serial cable from each free UART header of a board to the nearest free USB port. */
export function addUartCables(moduleId: string) {
  let r = { added: 0, left: 0 };
  edit((q) => { r = addUartLinks(q, moduleId); });
  if (!r.added && !r.left) { toast('Every UART header on this board already has a cable.'); return; }
  toast(`${r.added ? `Added ${r.added} USB-serial cable${r.added > 1 ? 's' : ''} (USB to TTL, 3.3 V) to the nearest free USB port${r.added > 1 ? 's' : ''}.` : ''}${r.left ? ` ${r.left} UART header${r.left > 1 ? 's' : ''} found no free USB port: add a hub (Start › accessories).` : ''} ⌘Z undoes it.`);
}

/**
 * Move the boards on ports too weak for them (or powered through the hub they host, or a Pi 5 on 3 A where a 5 A
 * port is free) to stronger free ports, in one undo step. A cable that moves keeps its number.
 */
export function rebalancePower() {
  const p = store.get().project;
  if (!p) return;
  const r = strongerPower(p, plugPlaces());
  if (!r) { toast('No free port gives those boards more: add a charger or a supply (Start › Hubs and chargers).'); return; }
  autoEdit('Auto-connect', (q) => { q.links = r.links.map((l) => fillWires(q, l)); }, { texts: () => [`Auto-connect moved ${r.moved} board${r.moved > 1 ? 's' : ''} to stronger ports`] });
  toast(`Moved ${r.moved} board${r.moved > 1 ? 's' : ''} to stronger ports. ⌘Z undoes it.`);
}
