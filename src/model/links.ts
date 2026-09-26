// Connections between boards: which plug goes where. Every plug gets a role from its type, name and board
// (a Pi's USB-A ports are hosts, its USB-C is its power input, a hub's ports feed devices, a charger's ports give
// power), and Auto-connect pairs them up. The panel then routes each cable and sizes it.
import type { Comp, Link, Module, PlugRef, Project } from './types';

export type PlugRole = 'host' | 'device' | 'power-in' | 'power-in-dc' | 'power-out' | 'hub-up' | 'hub-down' | 'net' | 'video' | 'audio' | 'wire' | 'other';

const ROLES: PlugRole[] = ['host', 'device', 'power-in', 'power-in-dc', 'power-out', 'hub-up', 'hub-down', 'net', 'video', 'audio', 'wire', 'other'];

export const KIND_COLOR: Record<NonNullable<Link['kind']>, string> = { usb: '#3a3f47', power: '#d0443a', net: '#3b7dd8', video: '#7a5cc7', audio: '#2fae9a', wire: '#e0a030' };
export const KIND_NAME: Record<NonNullable<Link['kind']>, string> = { usb: 'USB', power: 'power', net: 'Ethernet', video: 'video', audio: 'audio', wire: 'wires' };

const plugTypeName: Record<string, string> = {
  usb_c: 'USB-C', usb_micro_b: 'micro-USB', usb_mini_b: 'mini-USB', usb_a: 'USB-A', usb_a_dual: 'USB-A', usb_b: 'USB-B',
  hdmi_micro: 'micro-HDMI', hdmi_mini: 'mini-HDMI', hdmi_a: 'HDMI', rj45: 'RJ45', barrel: 'DC barrel', audio35: '3.5 mm', terminal: 'wires', header: 'jumper',
};

export function plugRole(m: Module, c: Comp): PlugRole {
  if (c.role && ROLES.includes(c.role as PlugRole)) return c.role as PlugRole;
  const t = c.conn?.type ?? '';
  const name = `${m.board.name}`.toLowerCase(), ref = `${c.ref} ${c.pkg} ${c.value ?? ''}`.toLowerCase();
  const box = m.board.kind === 'box';
  const hub = box && /hub/.test(name), charger = box && /charg|power|supply|psu/.test(name);
  const powerRef = /pwr|power|vin|j_pwr|\bdc\b/.test(ref);
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
  if (r.includes('power-in') || r.includes('power-out') || r.includes('power-in-dc')) return 'power';
  if (r.includes('net')) return 'net';
  if (r.includes('video')) return 'video';
  if (r.includes('audio')) return 'audio';
  if (r.includes('wire')) return 'wire';
  return 'usb';
}

/** Can these two plugs be cabled together? */
export function compatible(ra: PlugRole, rb: PlugRole): boolean {
  const pair = (x: PlugRole, y: PlugRole) => (ra === x && rb === y) || (ra === y && rb === x);
  return pair('power-in', 'power-out') || pair('power-in', 'host') || pair('power-in', 'hub-down') || pair('device', 'host') || pair('device', 'hub-down') || pair('hub-up', 'host')
    || pair('net', 'net') || pair('wire', 'wire') || pair('video', 'video') || pair('audio', 'audio') || pair('power-in-dc', 'wire');
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
  for (const pin of free('power-in')) { const src = nearest(pin, free('power-out')) ?? nearest(pin, free('hub-down')); if (src) take(pin, src); }
  for (const dev of free('device')) { const h = nearest(dev, free('hub-down')) ?? nearest(dev, free('host')); if (h) take(dev, h); }
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
  return { devices, usbPorts, powerIns, powerOuts, short: Math.max(0, devices.length + Math.max(0, powerIns.length - powerOuts.length) - usbPorts.length) };
}
