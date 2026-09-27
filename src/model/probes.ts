// Debug probes (J-Link, ST-Link): a box with a debug port on a ribbon and a USB port. A board's debug headers (SWD,
// JTAG, Tag-Connect) each take one probe. The probes for a board stack on one another in the back slot of that
// board's dock, so each ribbon only goes round the dock, and the probes' USB cables go to a hub like any device.
import type { Board, Comp, Module, Project } from './types';
import { connById, connSetup, newModule } from './library';
import { BOX_PRESETS, makeBox } from './boxes';
import { baseRef, DEBUG_TYPES, isDebugPort, isUartPort, numberLinks, plugsOf } from './links';

export { DEBUG_TYPES, isDebugPort, isUartPort } from './links';

/** A probe: a box with a debug port. */
export const isProbe = (m: Module) => m.board.kind === 'box' && m.board.comps.some(isDebugPort);

/** A board's debug headers (a probe's own port does not count). */
export const debugHeaders = (b: Board): Comp[] => (b.kind === 'box' ? [] : b.comps.filter(isDebugPort));

/** A board's UART headers. */
export const uartHeaders = (b: Board): Comp[] => (b.kind === 'box' ? [] : b.comps.filter(isUartPort));

/**
 * A USB-serial cable (an FTDI-style USB to TTL lead: USB-A on one end, a socket on the pins on the other) from each
 * free UART header of a board to the nearest free USB-A port: a hub's first, else a computer's (a Pi's). Nothing to
 * hold: the adapter is in the cable. Mutates the project; returns how many went in and how many found no port.
 */
export function addUartLinks(p: Project, boardId: string): { added: number; left: number } {
  const m = p.modules.find((x) => x.id === boardId);
  if (!m) return { added: 0, left: 0 };
  const key = (r: { module: string; ref: string }) => `${r.module}/${r.ref}`;
  const taken = new Set((p.links ?? []).flatMap((l) => [key(l.a), key(l.b)]));
  const heads = uartHeaders(m.board).filter((c) => !taken.has(`${m.id}/${c.ref}`));
  const at = p.modules.indexOf(m);
  const ports = plugsOf(p).filter((x) => (x.role === 'hub-down' || x.role === 'host') && x.module !== m && !taken.has(key(x.ref)))
    .sort((a, b) => Number(b.role === 'hub-down') - Number(a.role === 'hub-down') || Math.abs(p.modules.indexOf(a.module) - at) - Math.abs(p.modules.indexOf(b.module) - at));
  let added = 0;
  for (const c of heads) {
    const port = ports.shift();
    if (!port) break;
    p.links = numberLinks([...(p.links ?? []), { id: `l${Math.random().toString(36).slice(2, 8)}`, a: { module: m.id, ref: c.ref }, b: port.ref, kind: 'uart' }]);
    added++;
  }
  return { added, left: heads.length - added };
}

/** How long a probe's ribbon is: what the box says, else a typical J-Link cable. */
export const ribbonOf = (b: Board) => b.box?.ribbon ?? 200;

/** The probes cabled to a board's debug headers, in the order of its headers. */
export function probesOf(p: Project, m: Module): Module[] {
  const out: Module[] = [];
  for (const c of debugHeaders(m.board)) {
    for (const l of p.links ?? []) {
      const mine = l.a.module === m.id && baseRef(l.a.ref) === c.ref ? l.b : l.b.module === m.id && baseRef(l.b.ref) === c.ref ? l.a : null;
      const pm = mine && p.modules.find((x) => x.id === mine.module);
      if (pm && isProbe(pm) && !out.includes(pm)) out.push(pm);
    }
  }
  return out;
}

/** The board a probe is cabled to, if any. */
export function targetOf(p: Project, probe: Module): Module | null {
  for (const l of p.links ?? []) {
    const other = l.a.module === probe.id ? l.b : l.b.module === probe.id ? l.a : null;
    const m = other && p.modules.find((x) => x.id === other.module);
    const c = m?.board.comps.find((x) => x.ref === baseRef(other!.ref));
    if (m && c && m.board.kind !== 'box' && isDebugPort(c)) return m;
  }
  return null;
}

/**
 * Stack the probes of each board one on another (the first in its own holder, the next on a printed layer on its
 * corner towers, and so on), so they take one dock slot. Probes that are already in a stack are left as they are.
 * Returns whether anything changed.
 */
export function stackProbes(p: Project): boolean {
  let changed = false;
  for (const m of p.modules) {
    if (m.board.kind === 'box') continue;
    const ps = probesOf(p, m);
    if (ps.length < 2 || ps.some((x) => x.on || p.modules.some((y) => y.on === x.id))) continue;
    for (let k = 1; k < ps.length; k++) { ps[k].on = ps[k - 1].id; ps[k].onMode = 'towers'; }
    changed = true;
  }
  return changed;
}

/** A J-Link: a slim box with its 10-pin ribbon and its USB on one end. */
export const makeProbe = (name: string): Board => makeBox('jlink', name);

/**
 * A J-Link for every debug header of a board that has none yet: cabled to its header, its USB left for Auto-connect,
 * stacked in one pile. Mutates the project; returns the new probes.
 */
export function addProbes(p: Project, boardId: string): Module[] {
  const m = p.modules.find((x) => x.id === boardId);
  if (!m) return [];
  const taken = new Set((p.links ?? []).flatMap((l) => [`${l.a.module}/${baseRef(l.a.ref)}`, `${l.b.module}/${baseRef(l.b.ref)}`]));
  const free = debugHeaders(m.board).filter((c) => !taken.has(`${m.id}/${c.ref}`));
  const names = new Set(p.modules.map((x) => x.board.name));
  const out: Module[] = [];
  const short = m.board.name.length > 18 ? `${m.board.name.slice(0, 17)}…` : m.board.name;
  for (const c of free) {
    let name = `${BOX_PRESETS.jlink.name} (${short} ${c.ref})`;
    for (let n = 2; names.has(name); n++) name = `${BOX_PRESETS.jlink.name} ${n} (${short} ${c.ref})`;
    names.add(name);
    const pb = makeProbe(name);
    const port = pb.comps.find(isDebugPort)!;
    const mod = newModule(pb, m.holder);
    const at = p.modules.indexOf(m) + 1 + out.length;
    p.modules.splice(at, 0, mod);
    if (p.active >= at) p.active++; // the board being edited stays the one being edited
    p.links = numberLinks([...(p.links ?? []), { id: `l${Math.random().toString(36).slice(2, 8)}`, a: { module: mod.id, ref: port.ref }, b: { module: m.id, ref: c.ref }, kind: 'debug' }]);
    out.push(mod);
  }
  stackProbes(p);
  return out;
}

/** Debug ribbons that need an adapter: a 20-pin probe on a 10-pin header (the J-Link 9-pin Cortex-M adapter). */
export function adapterFor(probePort: Comp, header: Comp): string | null {
  const a = probePort.conn?.type, b = header.conn?.type;
  if (a === 'jtag20' && b === 'swd10') return '20-to-10-pin adapter (J-Link Cortex-M adapter) for a 1.27 mm header';
  if (a === 'jtag20' && b === 'tagconnect') return 'Tag-Connect cable for a 20-pin probe (TC2050-IDC with its adapter)';
  if (a === 'jtag20' && b === 'header') return 'jumper wires from the 20-pin connector to the pins (or a 20-pin to Dupont adapter)';
  if (a === 'swd10' && b === 'jtag20') return '10-to-20-pin adapter';
  return null;
}

export type DebugKind = 'swd10' | 'jtag20' | 'tagconnect' | 'pins' | 'uart';

/**
 * Mark a part as a debug header by hand: one of the debug connectors (sized to it, along the part's long side), or
 * plain pins for jumper wires (a 1 x 4 SWD header); or as a UART header. `null` makes it an ordinary pin header again.
 */
export function markDebug(c: Comp, kind: DebugKind | null) {
  if (!kind) {
    if (c.conn && DEBUG_TYPES.has(c.conn.type)) { c.conn = connSetup(connById('header'), 0); c.kind = 'header'; }
    c.role = 'wire';
    return;
  }
  if (kind === 'uart') {
    // a UART header: its pins stay pins (a USB-serial cable's socket goes on them)
    if (!c.conn || DEBUG_TYPES.has(c.conn.type)) c.conn = connSetup(connById('header'), 0);
    c.role = 'uart';
    if (c.conn.type === 'header') c.kind = 'header';
    return;
  }
  c.role = 'debug';
  if (kind === 'pins') {
    if (c.conn?.type !== 'header') c.conn = connSetup(connById('header'), 0);
    c.kind = 'header';
    return;
  }
  const t = connById(kind), along = c.w >= c.l;
  c.conn = connSetup(t, 0);
  c.kind = 'connector';
  c.w = along ? t.body.w : t.body.l; c.l = along ? t.body.l : t.body.w; c.h = t.body.h;
}
