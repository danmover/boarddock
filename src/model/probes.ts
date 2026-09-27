// Debug probes (J-Link, ST-Link) and USB-serial adapters: small boards that serve one board. A board's debug headers
// (SWD, JTAG, Tag-Connect) each take a probe on its ribbon; its UART headers each take an adapter on jumper wires
// (or a serial cable with loose ends). A board's probes and adapters stack in the back slot of its dock, so the
// ribbons and wires only go round the dock, and their USB cables go to a hub like any device's.
import type { Board, Comp, Link, Module, Pin, Project, Wire } from './types';
import { connById, connSetup, newModule } from './library';
import { BOX_PRESETS, makeBox } from './boxes';
import { baseRef, DEBUG_TYPES, isAccessory, isDebugPort, isUartPort, numberLinks, plugsOf } from './links';

export { DEBUG_TYPES, isDebugPort, isUartPort } from './links';

/** A board's companion that lives in a slot behind it: a probe (a box with a debug port) or a USB-serial adapter (a box
 * with serial pins). */
export const isProbe = (m: Module) => isAccessory(m.board) && m.board.comps.some((c) => isDebugPort(c) || isUartPort(c));
/** A USB-serial adapter: a box with serial pins. */
export const isAdapter = (m: Module) => isAccessory(m.board) && m.board.comps.some(isUartPort) && !m.board.comps.some(isDebugPort);

/** A board's debug headers (a probe's own port does not count). */
export const debugHeaders = (b: Board): Comp[] => (isAccessory(b) ? [] : b.comps.filter(isDebugPort));

/** A board's UART headers. */
export const uartHeaders = (b: Board): Comp[] => (isAccessory(b) ? [] : b.comps.filter(isUartPort));

/**
 * A USB-serial cable (a USB to TTL lead: USB-A on one end, loose jumper ends for GND, RX and TX on the other) from each
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

/**
 * A header's pins on the board: from the file where it gave them (KiCad pads), else laid out from its footprint name
 * (PinHeader_1x06_P2.54mm: six in a row at 2.54 mm) along its long side, pin 1 at one end.
 */
export function headerPins(c: Comp): Pin[] {
  if (c.pins && c.pins.length >= 2) return [...c.pins].sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0));
  const m = /(\d+)x(\d+)/i.exec(c.pkg), pm = /_P(\d+(?:\.\d+)?)mm/i.exec(c.pkg);
  const pitch = pm ? Number(pm[1]) : 2.54;
  const rows = m ? Math.min(2, Math.max(1, Math.min(Number(m[1]), Number(m[2])))) : 1;
  const n = m ? Number(m[1]) * Number(m[2]) : Math.max(1, Math.round(Math.max(c.w, c.l) / pitch));
  const k = Math.ceil(n / rows), a = ((c.w >= c.l ? c.rot : c.rot + 90) * Math.PI) / 180;
  const ax = [Math.cos(a), Math.sin(a)], ac = [-Math.sin(a), Math.cos(a)];
  return Array.from({ length: n }, (_, i) => {
    const j = rows > 1 ? Math.floor(i / 2) : i, r = rows > 1 ? (i % 2) - 0.5 : 0;
    const along = (j - (k - 1) / 2) * pitch, across = r * pitch;
    return { n: String(i + 1), x: c.x + ax[0] * along + ac[0] * across, y: c.y + ax[1] * along + ac[1] * across };
  });
}

const words = (net: string) => net.split(/[^a-z0-9]+/i).filter(Boolean);
const NET = {
  gnd: (t: string) => /^d?(gnd|vss|ground)\d*$/i.test(t),
  tx: (t: string) => /^((uart|usart|ser|u)\d*)?txd?\d*o?$/i.test(t),
  rx: (t: string) => /^((uart|usart|ser|u)\d*)?rxd?\d*i?$/i.test(t),
};

/** A serial cable's loose ends (colours as on the common PL2303 / CP2102 cables): ground, and its TX onto the board's RX. */
export const UART_WIRES = [
  { key: 'gnd', colour: '#1f2124', name: 'black', what: 'GND' },
  { key: 'rx', colour: '#2f9e44', name: 'green', what: "the cable's TX" },
  { key: 'tx', colour: '#e6e6e2', name: 'white', what: "the cable's RX" },
] as const;

/**
 * Which pins of a UART header take the cable's ground, TX and RX: set by hand, else from the nets in the file (GND,
 * RX, TX), else a guess from its size (an FTDI six: GND on 1, the board's RX on 4 and TX on 5; else 1, 2, 3).
 * rx / tx are the board's own: its RX takes the cable's TX.
 */
export function uartPins(c: Comp): { gnd: Pin; rx: Pin; tx: Pin; from: 'set' | 'nets' | 'guess'; pins: Pin[] } | null {
  const pins = headerPins(c);
  if (pins.length < 3) return null;
  const byN = (n: number | string) => pins.find((q) => q.n === String(n));
  if (c.uart) {
    const [gnd, rx, tx] = [byN(c.uart.gnd), byN(c.uart.rx), byN(c.uart.tx)];
    if (gnd && rx && tx) return { gnd, rx, tx, from: 'set', pins };
  }
  const find = (f: (t: string) => boolean) => pins.find((q) => q.net && words(q.net).some(f));
  const [gnd, rx, tx] = [find(NET.gnd), find(NET.rx), find(NET.tx)];
  if (gnd && rx && tx && new Set([gnd, rx, tx]).size === 3) return { gnd, rx, tx, from: 'nets', pins };
  const six = pins.length === 6 || /ftdi/i.test(`${c.value ?? ''} ${c.ref}`);
  const [g, r, t] = six && pins.length >= 5 ? [1, 4, 5] : [1, 2, 3];
  return { gnd: byN(g) ?? pins[0], rx: byN(r) ?? pins[1], tx: byN(t) ?? pins[2], from: 'guess', pins };
}

/** Where each loose end of the serial cable goes, in words. */
export function uartWiring(c: Comp): string {
  const u = uartPins(c);
  if (!u) return 'the loose ends onto its pins';
  const pin = (q: Pin) => `pin ${q.n}${q.net ? ` (${q.net.replace(/^\//, '')})` : ''}`;
  const txt = `black (GND) on ${pin(u.gnd)}, green (the cable's TX) on the board's RX, ${pin(u.rx)}, white (the cable's RX) on its TX, ${pin(u.tx)}; leave the red (power) one off`;
  return u.from === 'guess' ? `${txt} (a guess at its pinout: check the board's markings, and set the pins under Board › Debug & UART headers)` : txt;
}

/** How long a probe's ribbon is: what the box says, else a typical J-Link cable. */
export const ribbonOf = (b: Board) => b.box?.ribbon ?? 200;

/** The probes and adapters cabled to a board's debug and UART headers, in the order of its headers. */
export function probesOf(p: Project, m: Module): Module[] {
  const out: Module[] = [];
  for (const c of [...debugHeaders(m.board), ...uartHeaders(m.board)]) {
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
    if (m && c && !isAccessory(m.board) && (isDebugPort(c) || isUartPort(c))) return m;
  }
  return null;
}

/**
 * Stack the probes and adapters of each board one on another (the first in its own holder, the next on a printed
 * layer on its corner towers, and so on), so they take one dock slot. New ones go on top of a stack already there.
 * Returns whether anything changed.
 */
export function stackProbes(p: Project): boolean {
  let changed = false;
  for (const m of p.modules) {
    if (isAccessory(m.board)) continue;
    const ps = probesOf(p, m);
    if (ps.length < 2) continue;
    // new ones go on top of the stack already there
    const stacked = ps.filter((x) => x.on || p.modules.some((y) => y.on === x.id)), loose = ps.filter((x) => !stacked.includes(x));
    if (!loose.length) continue;
    let top = stacked.length ? stacked.find((x) => !p.modules.some((y) => y.on === x.id)) : loose.shift();
    if (!top) continue;
    for (const x of loose) { x.on = top.id; x.onMode = 'towers'; top = x; }
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

/**
 * The jumper wires between an adapter's serial pins and a board's UART header: ground to ground, and each one's TX to
 * the other's RX (black, green, white, as on the common cables). `a`, `b`: the link's two ends.
 */
export function autoWires(a: Comp, b: Comp): Wire[] {
  const ua = uartPins(a), ub = uartPins(b);
  if (!ua || !ub) return [];
  return [
    { a: ua.gnd.n, b: ub.gnd.n, colour: UART_WIRES[0].colour },
    { a: ua.tx.n, b: ub.rx.n, colour: UART_WIRES[1].colour },
    { a: ua.rx.n, b: ub.tx.n, colour: UART_WIRES[2].colour },
  ];
}

/** A jumper link with its wires filled in when it has none (two UART headers: the crossover). Mutates the link. */
export function fillWires(p: Project, l: Link): Link {
  if (l.kind !== 'jumper' || l.wires?.length) return l;
  const comp = (r: { module: string; ref: string }) => p.modules.find((m) => m.id === r.module)?.board.comps.find((c) => c.ref === baseRef(r.ref));
  const a = comp(l.a), b = comp(l.b);
  if (a && b) l.wires = autoWires(a, b);
  return l;
}

/**
 * A USB-serial adapter for every UART header of a board that has nothing on it yet: jumper wires from its pins to the
 * header (the crossover), stacked with the board's probes behind it; its USB left for Auto-connect. Mutates the
 * project; returns the new adapters.
 */
export function addAdapters(p: Project, boardId: string): Module[] {
  const m = p.modules.find((x) => x.id === boardId);
  if (!m) return [];
  const taken = new Set((p.links ?? []).flatMap((l) => [`${l.a.module}/${baseRef(l.a.ref)}`, `${l.b.module}/${baseRef(l.b.ref)}`]));
  const free = uartHeaders(m.board).filter((c) => !taken.has(`${m.id}/${c.ref}`));
  const names = new Set(p.modules.map((x) => x.board.name));
  const short = m.board.name.length > 18 ? `${m.board.name.slice(0, 17)}…` : m.board.name;
  const out: Module[] = [];
  for (const c of free) {
    let name = `${BOX_PRESETS.ftdi.name} (${short} ${c.ref})`;
    for (let n = 2; names.has(name); n++) name = `${BOX_PRESETS.ftdi.name} ${n} (${short} ${c.ref})`;
    names.add(name);
    const ab = makeBox('ftdi', name), pins = ab.comps.find(isUartPort)!;
    const mod = newModule(ab, m.holder);
    // after the board and its probes
    const at = Math.max(p.modules.indexOf(m), ...probesOf(p, m).map((x) => p.modules.indexOf(x))) + 1;
    p.modules.splice(at, 0, mod);
    if (p.active >= at) p.active++;
    p.links = numberLinks([...(p.links ?? []), { id: `l${Math.random().toString(36).slice(2, 8)}`, a: { module: mod.id, ref: pins.ref }, b: { module: m.id, ref: c.ref }, kind: 'jumper', wires: autoWires(pins, c) }]);
    out.push(mod);
  }
  stackProbes(p);
  return out;
}

const COLOUR_NAME: Record<string, string> = { '#1f2124': 'black', '#2f9e44': 'green', '#e6e6e2': 'white', '#d0443a': 'red', '#e0a030': 'yellow', '#3b7dd8': 'blue' };

/** Which pin each jumper wire of a link goes between, in words. */
export function jumperWiring(p: Project, l: Link): string {
  const end = (r: { module: string; ref: string }) => { const m = p.modules.find((x) => x.id === r.module); const c = m?.board.comps.find((x) => x.ref === baseRef(r.ref)); return { m, pins: c ? headerPins(c) : [] }; };
  const A = end(l.a), B = end(l.b);
  const pin = (e: typeof A, n: string) => { const q = e.pins.find((x) => x.n === n); return `pin ${n}${q?.net ? ` (${q.net.replace(/^\//, '')})` : ''}`; };
  return (l.wires ?? []).map((w) => `${COLOUR_NAME[w.colour ?? ''] ?? 'a'} wire from ${A.m && isAccessory(A.m.board) ? '' : `${l.a.ref} `}${pin(A, w.a)} to ${B.m && isAccessory(B.m.board) ? '' : `${l.b.ref} `}${pin(B, w.b)}`).join(', ');
}

/** Jumper wires to buy: the shortest standard length that reaches. */
export const jumperToBuy = (mm: number) => [100, 150, 200, 300].find((l) => l >= mm * 1.05) ?? Math.ceil((mm * 1.05) / 100) * 100;

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
