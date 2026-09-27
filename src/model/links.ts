// Connections between boards: which plug goes where. Every plug gets a role from its type, name and board
// (a Pi's USB-A ports are hosts, its USB-C is its power input, a hub's ports feed devices, a charger's ports give
// power), and Auto-connect pairs them up. The panel then routes each cable and sizes it.
import type { Comp, Link, Module, PlugRef, Project } from './types';
import { needOf, portCap, poweredHub, supplyOf } from './powerdata';

export type PlugRole = 'host' | 'device' | 'power-in' | 'power-in-dc' | 'power-out' | 'hub-up' | 'hub-down' | 'net' | 'video' | 'audio' | 'wire' | 'debug' | 'uart' | 'mains-in' | 'mains-out' | 'other';

const ROLES: PlugRole[] = ['host', 'device', 'power-in', 'power-in-dc', 'power-out', 'hub-up', 'hub-down', 'net', 'video', 'audio', 'wire', 'debug', 'uart', 'mains-in', 'mains-out', 'other'];

export const KIND_COLOR: Record<NonNullable<Link['kind']>, string> = { usb: '#3a3f47', power: '#d0443a', net: '#3b7dd8', video: '#7a5cc7', audio: '#2fae9a', wire: '#e0a030', debug: '#a3a9b1', uart: '#c0772f', jumper: '#4f9d57', mains: '#8d6e63' };
export const KIND_NAME: Record<NonNullable<Link['kind']>, string> = { usb: 'USB', power: 'power', net: 'Ethernet', video: 'video', audio: 'audio', wire: 'wires', debug: 'debug ribbon', uart: 'USB-serial', jumper: 'jumper wires', mains: 'mains' };

/** Connector types that are debug connectors (a probe's ribbon plugs in). */
export const DEBUG_TYPES = new Set(['swd10', 'jtag20', 'tagconnect']);
/** A name that says debug: SWD, JTAG, a Cortex debug connector, a J-Link or another probe. */
export const DEBUG_HINT = /swd|jtag|cortex[\s_-]?debug|j[\s_-]?link|debug|\bdbg|conn_arm|st[\s_-]?link|tag[\s_-]?connect/i;
/** A name that says serial: UART, a serial console, TX/RX, an FTDI header. */
export const UART_HINT = /uart|serial|console|ftdi|\btxd?\b.*\brxd?\b|\brxd?\b.*\btxd?\b|\bttl\b/i;
const pinsOrJst = (t: string) => t === 'header' || t === 'jst_ph' || t === 'jst_xh' || t === 'qwiic';
const names = (c: Comp) => `${c.ref} ${c.pkg} ${c.value ?? ''}`;
/** A debug port: a debug connector, a box port made for one, or a pin header named for debugging (a 1 x 4 SWD header). */
export const isDebugPort = (c: Comp) =>
  !!c.conn && !c.hidden && (c.role ? c.role === 'debug' : DEBUG_TYPES.has(c.conn.type) || (c.conn.type === 'header' && DEBUG_HINT.test(names(c)) && !UART_HINT.test(names(c))));
/** A UART header: pins (or a JST) named for serial, or marked as one by hand. A USB-serial cable plugs in there. */
export const isUartPort = (c: Comp) => !!c.conn && !c.hidden && (c.role ? c.role === 'uart' : pinsOrJst(c.conn.type) && UART_HINT.test(names(c)));

const plugTypeName: Record<string, string> = {
  usb_c: 'USB-C', usb_micro_b: 'micro-USB', usb_mini_b: 'mini-USB', usb_a: 'USB-A', usb_a_dual: 'USB-A', usb_b: 'USB-B',
  hdmi_micro: 'micro-HDMI', hdmi_mini: 'mini-HDMI', hdmi_a: 'HDMI', rj45: 'RJ45', barrel: 'DC barrel', audio35: '3.5 mm', terminal: 'wires', header: 'jumper',
  swd10: '10-pin debug', jtag20: '20-pin debug', tagconnect: 'Tag-Connect', iec_c7: 'mains (C7)', pins_ra: 'pins', ac_au: 'AU outlet', ac_uk: 'UK outlet', ac_us: 'US outlet', ac_eu: 'EU outlet', mains_lead: 'mains lead',
};

export function plugRole(m: Module, c: Comp): PlugRole {
  if (c.role && ROLES.includes(c.role as PlugRole)) return c.role as PlugRole;
  const t = c.conn?.type ?? '';
  if (isDebugPort(c)) return 'debug';
  if (isUartPort(c)) return 'uart';
  const name = `${m.board.name}`.toLowerCase(), ref = `${c.ref} ${c.pkg} ${c.value ?? ''}`.toLowerCase();
  const box = m.board.kind === 'box';
  const hub = box && /hub/.test(name), charger = box && /charg|power|supply|psu/.test(name);
  const powerRef = /pwr|power|vin|j_pwr|\bdc\b/.test(ref);
  if (t.startsWith('ac_')) return 'mains-out';
  if (t === 'iec_c7' || t === 'mains_lead') return 'mains-in';
  if (t === 'rj45') return 'net';
  if (t.startsWith('hdmi')) return 'video';
  if (t === 'audio35') return 'audio';
  if (t === 'terminal' || t === 'header') return 'wire';
  // a barrel jack is a 7-12 V input: optional when the board also takes power over USB (an Arduino), and never fed from 5 V USB
  if (t === 'barrel') return charger || m.board.comps.some((x) => x.conn && /usb_(b|micro_b|mini_b|c)$/.test(x.conn.type)) ? 'other' : 'power-in-dc';
  if (t === 'usb_a' || t === 'usb_a_dual') return hub ? 'hub-down' : charger ? 'power-out' : 'host';
  if (t === 'usb_c' || t === 'usb_micro_b' || t === 'usb_mini_b' || t === 'usb_b') {
    if (hub) return 'hub-up';
    if (powerRef) return 'power-in';
    // a board that also has USB-A host ports powers itself through this one (a Raspberry Pi)
    if (m.board.comps.some((x) => x.conn && (x.conn.type === 'usb_a' || x.conn.type === 'usb_a_dual'))) return 'power-in';
    return 'device';
  }
  return 'other';
}

export function linkKind(ra: PlugRole, rb: PlugRole): Link['kind'] {
  const r = [ra, rb];
  if (r.includes('mains-in') || r.includes('mains-out')) return 'mains';
  if (r.includes('power-in') || r.includes('power-out') || r.includes('power-in-dc')) return 'power';
  if (r.includes('net')) return 'net';
  if (r.includes('video')) return 'video';
  if (r.includes('audio')) return 'audio';
  if (r.includes('debug')) return 'debug';
  if (ra === 'uart' && rb === 'uart') return 'jumper';
  if (r.includes('uart')) return 'uart';
  if (r.includes('wire')) return 'wire';
  return 'usb';
}

/** Can these two plugs be cabled together? */
export function compatible(ra: PlugRole, rb: PlugRole): boolean {
  const pair = (x: PlugRole, y: PlugRole) => (ra === x && rb === y) || (ra === y && rb === x);
  return pair('power-in', 'power-out') || pair('power-in', 'host') || pair('power-in', 'hub-down') || pair('device', 'host') || pair('device', 'hub-down') || pair('hub-up', 'host')
    || pair('net', 'net') || pair('wire', 'wire') || pair('video', 'video') || pair('audio', 'audio') || pair('power-in-dc', 'wire') || pair('debug', 'debug') || pair('uart', 'uart') || pair('uart', 'hub-down') || pair('uart', 'host') || pair('mains-in', 'mains-out');
}

export interface PlugInfo { ref: PlugRef; module: Module; comp: Comp; role: PlugRole; label: string }

export function plugsOf(p: Project): PlugInfo[] {
  const out: PlugInfo[] = [];
  for (const m of p.modules) for (const c of m.board.comps) {
    if (!c.conn || c.hidden) continue;
    const role = plugRole(m, c), nm = `${c.ref} ${plugTypeName[c.conn.type] ?? ''}`.trim();
    // a stacked pair of USB-A sockets is two ports: the second one's ref ends in ":2"
    if (c.conn.type === 'usb_a_dual') out.push({ ref: { module: m.id, ref: c.ref }, module: m, comp: c, role, label: `${nm} lower` }, { ref: { module: m.id, ref: `${c.ref}:2` }, module: m, comp: c, role, label: `${nm} upper` });
    else out.push({ ref: { module: m.id, ref: c.ref }, module: m, comp: c, role, label: nm });
  }
  return out;
}

/** The part a plug ref belongs to (the upper socket of a stacked pair is "REF:2"). */
export const baseRef = (ref: string) => ref.replace(/:2$/, '');

/** A plug ref the way a person reads it: the sockets of a stacked USB-A pair are "USB2 lower" and "USB2 upper". */
export function refText(m: Module | undefined, ref: string): string {
  const c = m?.board.comps.find((x) => x.ref === baseRef(ref));
  if (c?.conn?.type !== 'usb_a_dual') return ref;
  return `${baseRef(ref)} ${ref.endsWith(':2') ? 'upper' : 'lower'}`;
}

export const sameRef = (a: PlugRef, b: PlugRef) => a.module === b.module && a.ref === b.ref;
export const linkOf = (p: Project, r: PlugRef) => (p.links ?? []).find((l) => sameRef(l.a, r) || sameRef(l.b, r));

/**
 * Suggest cables for every plug still free: power inputs from a charger (or a hub or host port), devices to a hub
 * (or a host), a hub to a host. Boards are matched in panel order, so neighbours get each other's cables.
 */
export function autoLinks(p: Project): Link[] {
  const plugs = plugsOf(p);
  const taken = new Set((p.links ?? []).flatMap((l) => [`${l.a.module}/${l.a.ref}`, `${l.b.module}/${l.b.ref}`]));
  const free = (r: PlugRole) => plugs.filter((x) => x.role === r && !taken.has(`${x.ref.module}/${x.ref.ref}`));
  const out: Link[] = [];
  const idx = (m: Module) => p.modules.indexOf(m);
  const take = (a: PlugInfo, b: PlugInfo) => {
    taken.add(`${a.ref.module}/${a.ref.ref}`); taken.add(`${b.ref.module}/${b.ref.ref}`);
    out.push({ id: `l${Math.random().toString(36).slice(2, 8)}`, a: a.ref, b: b.ref, kind: linkKind(a.role, b.role) });
  };
  const nearest = (a: PlugInfo, pool: PlugInfo[]) => pool.filter((x) => x.module !== a.module).sort((x, y) => Math.abs(idx(x.module) - idx(a.module)) - Math.abs(idx(y.module) - idx(a.module)))[0];
  // hubs hang off a host first, so their ports can feed devices
  for (const up of free('hub-up')) { const h = nearest(up, free('host')); if (h) take(up, h); }
  // power: the hungriest boards pick first, each from a port that gives enough, on a charger with the most left over
  // (so six Pi 4s end up split over two chargers, on their USB-C ports where there are some), nearest after that
  const left = new Map<string, number>();
  const room = (x: PlugInfo) => {
    if (!left.has(x.module.id)) {
      const total = supplyOf(x.module.board, plugs.filter((q) => q.module === x.module && q.role === 'power-out').map((q) => ({ c: q.comp, role: q.role }))).total;
      // minus what the cables already on it carry
      const used = (p.links ?? []).reduce((a, l) => {
        const other = l.a.module === x.module.id ? l.b.module : l.b.module === x.module.id ? l.a.module : null;
        const om = other ? p.modules.find((m) => m.id === other) : null;
        return a + (om ? needOf(om.board, true).load : 0);
      }, 0);
      left.set(x.module.id, total - used);
    }
    return left.get(x.module.id)!;
  };
  const pins = free('power-in').map((x) => ({ x, n: needOf(x.module.board, true) })).sort((a, b) => b.n.peak - a.n.peak || idx(a.x.module) - idx(b.x.module));
  for (const { x: pin, n } of pins) {
    const outs = free('power-out').filter((o) => o.module !== pin.module);
    const score = (o: PlugInfo) => (portCap(o.module.board, o.comp, o.role) >= n.peak ? 0 : 2) + (room(o) >= n.load ? 0 : 4);
    // no charger port left: a powered hub's port will do; a hub without a supply of its own never powers a board
    // (and a Pi never powers itself through the hub it feeds)
    const src = outs.sort((a, b) => score(a) - score(b) || room(b) - room(a) || Math.abs(idx(a.module) - idx(pin.module)) - Math.abs(idx(b.module) - idx(pin.module)))[0] ?? nearest(pin, free('hub-down').filter((h) => poweredHub(h.module.board)));
    if (!src) continue;
    take(pin, src);
    if (src.role === 'power-out') left.set(src.module.id, room(src) - n.load);
  }
  for (const dev of free('device')) { const h = nearest(dev, free('hub-down')) ?? nearest(dev, free('host')); if (h) take(dev, h); }
  // mains: each charger's (or hub's) lead to the nearest free outlet of a powerboard; never a powerboard's own lead
  // into another powerboard (daisy-chained powerboards overload the first)
  const outlets = (x: Module) => x.board.comps.some((c) => c.conn?.type.startsWith('ac_'));
  for (const lead of free('mains-in').filter((x) => !outlets(x.module))) { const o = nearest(lead, free('mains-out')); if (o) take(lead, o); }
  // debug probes and serial adapters: each free one to the nearest free header of its kind on a board (never probe to
  // probe); an adapter's jumper wires are filled in by the caller
  for (const r of ['debug', 'uart'] as const) for (const pr of free(r).filter((x) => x.module.board.kind === 'box')) {
    const h = nearest(pr, free(r).filter((x) => x.module.board.kind !== 'box'));
    if (h) take(pr, h);
  }
  return out;
}

/** Shortest standard cable (m) at least as long as the route plus 10% slack. */
export function cableToBuy(mm: number): number {
  const need = (mm * 1.1) / 1000;
  return [0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1, 1.5, 2, 3, 5].find((l) => l >= need) ?? Math.ceil(need);
}

export const plugName = (t: string) => plugTypeName[t] ?? t;

/**
 * What still needs a port: USB devices with no cable against free USB ports (hub ports and host ports), boards
 * that need power against free power outputs (charger ports, then hub and host ports).
 */
export function portBudget(p: Project) {
  const plugs = plugsOf(p);
  const taken = new Set((p.links ?? []).flatMap((l) => [`${l.a.module}/${l.a.ref}`, `${l.b.module}/${l.b.ref}`]));
  const free = (roles: PlugRole[]) => plugs.filter((x) => roles.includes(x.role) && !taken.has(`${x.ref.module}/${x.ref.ref}`));
  const devices = free(['device', 'hub-up']), usbPorts = free(['hub-down', 'host']);
  const powerIns = free(['power-in']), powerOuts = free(['power-out']);
  // boards with wire terminals or jumper headers and not one of them connected (a relay board, a power distribution
  // board): Auto-connect does not guess wiring, so say which are left
  const unwired = p.modules.flatMap((m) => {
    const mine = plugs.filter((x) => x.module === m);
    const w = mine.filter((x) => x.role === 'wire' || x.role === 'power-in-dc');
    if (!w.length || mine.some((x) => taken.has(`${x.ref.module}/${x.ref.ref}`) && (x.role === 'wire' || x.role === 'power-in-dc'))) return [];
    if (w.length < mine.length && mine.some((x) => taken.has(`${x.ref.module}/${x.ref.ref}`))) return []; // a Pi with its GPIO free is fine
    const refs = w.map((x) => x.comp.ref);
    return [{ name: m.board.name, refs: refs.length > 4 ? [...refs.slice(0, 3), `${refs.length - 3} more`] : refs }];
  });
  return { devices, usbPorts, powerIns, powerOuts, unwired, short: Math.max(0, devices.length + Math.max(0, powerIns.length - powerOuts.length) - usbPorts.length) };
}


/** Every cable keeps the number it was given; cables without one get the next free numbers, in order. */
export function cableNumbers(links: Link[] = []): Map<string, number> {
  let n = Math.max(0, ...links.map((l) => l.no ?? 0));
  return new Map(links.map((l) => [l.id, l.no ?? ++n]));
}
/** The links with their numbers written in (so a printed tag keeps matching its cable after others change). */
export const numberLinks = (links: Link[] = []): Link[] => { const no = cableNumbers(links); return links.map((l) => (l.no ? l : { ...l, no: no.get(l.id)! })); };

/** A board's name without its maker: "Raspberry Pi 4B" -> "Pi 4B", "Arduino Uno R3" -> "Uno R3". */
export const shortName = (n: string) => n.replace(/^(Raspberry|Arduino|Adafruit|SparkFun|Espressif|Seeed(?: Studio)?)\s+/i, '');

const SOURCE: PlugRole[] = ['mains-out', 'power-out', 'hub-down', 'host'];
/** Which way a cable points: from the end that gives (power, a port, a probe's ribbon) to the end that takes. */
export function cableFlow(p: Project, l: Link): { from: PlugRef; to: PlugRef } {
  const role = (r: PlugRef) => { const m = p.modules.find((x) => x.id === r.module); const c = m?.board.comps.find((x) => x.ref === baseRef(r.ref)); return { role: m && c ? plugRole(m, c) : ('other' as PlugRole), box: m?.board.kind === 'box' }; };
  let a = { r: l.a, ...role(l.a) }, b = { r: l.b, ...role(l.b) };
  if (SOURCE.indexOf(b.role) >= 0 && SOURCE.indexOf(a.role) < 0) [a, b] = [b, a];
  if (a.role === 'hub-up' || (b.role === 'host' && a.role !== 'host')) [a, b] = [b, a];
  if ((a.role === 'debug' || a.role === 'uart') && b.box && !a.box) [a, b] = [b, a];
  return { from: a.r, to: b.r };
}

/** What a cable is for, from the plugs' roles, pointing from the end that gives (power, a port) to the end that takes. */
export function cablePurpose(p: Project, l: Link): { from: string; to: string; text: string } {
  const end = (r: PlugRef) => {
    const m = p.modules.find((x) => x.id === r.module);
    const c = m?.board.comps.find((x) => x.ref === baseRef(r.ref));
    return { name: m?.board.name ?? '?', ref: r.ref, role: m && c ? plugRole(m, c) : ('other' as PlugRole), box: m?.board.kind === 'box' };
  };
  let a = end(l.a), b = end(l.b);
  if (SOURCE.indexOf(b.role) >= 0 && SOURCE.indexOf(a.role) < 0) [a, b] = [b, a];
  if (a.role === 'hub-up' || (b.role === 'host' && a.role !== 'host')) [a, b] = [b, a];
  if (a.role === 'debug' && b.box && !a.box) [a, b] = [b, a]; // a debug ribbon goes from the probe to the board
  const kind = l.kind ?? 'usb';
  const what = kind === 'power' || a.role === 'power-out' ? 'Power' : a.role === 'hub-down' && b.role === 'hub-up' ? 'Hub link' : b.role === 'hub-up' ? 'Hub uplink' : KIND_NAME[kind].replace(/^./, (c) => c.toUpperCase());
  return { from: a.name, to: b.name, text: `${what}: ${shortName(a.name)} → ${shortName(b.name)}` };
}
