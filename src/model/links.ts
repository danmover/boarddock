// Connections between boards: which plug goes where. Every plug gets a role from its type, name and board
// (a Pi's USB-A ports are hosts, its USB-C is its power input, a hub's ports feed devices, a charger's ports give
// power), and Auto-connect pairs them up. The panel then routes each cable and sizes it.
import type { Board, Comp, Link, Module, PlugRef, Project } from './types';
import { dcRange, hostTotal, isPlugPack, minOf, needOf, portCap, poweredHub, supplyOf, type Need } from './powerdata';
import { assign } from './assign';
import { KIND_COLOR, KIND_NAME } from './cablekinds';

export { KIND_COLOR, KIND_NAME }; // (the cable kinds' colours and names: cablekinds.ts)
import { isPoePort, poeAdvice, poeAssign, poeFedIds, poeTotal, poeWatts, takesPoe } from './poe';

export type PlugRole = 'host' | 'device' | 'power-in' | 'power-in-dc' | 'power-out' | 'dc-out' | 'hub-up' | 'hub-down' | 'net' | 'video' | 'audio' | 'wire' | 'debug' | 'uart' | 'mains-in' | 'mains-out' | 'other';

const ROLES: PlugRole[] = ['host', 'device', 'power-in', 'power-in-dc', 'power-out', 'dc-out', 'hub-up', 'hub-down', 'net', 'video', 'audio', 'wire', 'debug', 'uart', 'mains-in', 'mains-out', 'other'];

/** An accessory rather than a board being served: a box (hub, charger), or a board that serves another (a J-Link, a
 * USB-serial adapter). For wiring: which end of a debug ribbon is the probe. */
export const isAccessory = (b: Board) => b.kind === 'box' || !!b.role;
/** A closed device (hub, charger, powerboard): it lies in low guards with straps, not in a board's holder. */
export const isBox = (b: Board) => b.kind === 'box';

/** Connector types that are debug connectors (a probe's ribbon plugs in). */
export const DEBUG_TYPES = new Set(['swd10', 'cortex20', 'jtag20', 'tagconnect']);
/** A name that says debug: SWD, JTAG, a Cortex debug connector, a J-Link or another probe. */
export const DEBUG_HINT = /swd|jtag|cortex[\s_-]?debug|j[\s_-]?link|debug|\bdbg|conn_arm|st[\s_-]?link|tag[\s_-]?connect/i;
/** A name that says serial: UART, a serial console, TX/RX, an FTDI header. */
export const UART_HINT = /uart|serial|console|ftdi|\btxd?\b.*\brxd?\b|\brxd?\b.*\btxd?\b|\bttl\b/i;
/** A socket (female) header by its name: KiCad's PinSocket, "female", Samtec's and Sullins' socket series, Würth's. */
export const SOCKET_NAME = /socket|female|receptacle|\b(PPTC|PPPC|NPTC|NPPC|LPPB|SSW|SSQ|SSM|SLW|BCS|ESW|ESQ|CES|SFM|FLE|CLP)[-\d]|\b6130\d\d[12]1821\b/i;
/** A female header (a pin socket, like the Mega's J_IO): a jumper wire into it needs a male end. */
export const isSocket = (c: Comp) => SOCKET_NAME.test(`${c.pkg} ${c.ref} ${c.value ?? ''}`);
const pinsOrJst = (t: string) => ['header', 'jst_ph', 'jst_xh', 'jst_gh', 'jst_zh', 'picoblade', 'kk254', 'wtb_side', 'qwiic'].includes(t);
const names = (c: Comp) => `${c.ref} ${c.pkg} ${c.value ?? ''}`;
/** A debug port: a debug connector, a box port made for one, or a pin header named for debugging (a 1 x 4 SWD header). */
export const isDebugPort = (c: Comp) =>
  !!c.conn && !c.hidden && (c.role ? c.role === 'debug' : DEBUG_TYPES.has(c.conn.type) || (/^(header|idc)$/.test(c.conn.type) && DEBUG_HINT.test(names(c)) && !UART_HINT.test(names(c))));
/** A UART header: pins (or a JST) named for serial, or marked as one by hand. A USB-serial cable plugs in there. */
export const isUartPort = (c: Comp) => !!c.conn && !c.hidden && (c.role ? c.role === 'uart' : pinsOrJst(c.conn.type) && (UART_HINT.test(names(c)) || uartNets(c)));
/** A small connector whose pins' nets say serial (TX, RXD, UART0_TX), none of them debug. */
const uartNets = (c: Comp) => {
  const nets = (c.pins ?? []).map((q) => q.net ?? '');
  return nets.length >= 2 && nets.length <= 8 && nets.some((n) => /(^|[^a-z])(u?s?art\d?_?)?(txd?|rxd?)\d?([^a-z]|$)/i.test(n)) && !nets.some((n) => /(^|[^a-z])(swdio|swclk|tms|tck|tdi|tdo)([^a-z]|$)/i.test(n));
};

const plugTypeName: Record<string, string> = {
  usb_c: 'USB-C', usb_micro_b: 'micro-USB', usb_mini_b: 'mini-USB', usb_a: 'USB-A', usb_a_dual: 'USB-A', usb_b: 'USB-B',
  hdmi_micro: 'micro-HDMI', hdmi_mini: 'mini-HDMI', hdmi_a: 'HDMI', rj45: 'RJ45', barrel: 'DC barrel', audio35: '3.5 mm', terminal: 'wires', header: 'jumper',
  swd10: '10-pin debug', cortex20: '20-pin Cortex debug', jtag20: '20-pin debug', dsub: 'D-sub', dp: 'DisplayPort', rj11: 'RJ11', rca: 'RCA', bnc: 'BNC', sma: 'SMA', ufl: 'u.FL', xt60: 'XT60', xt30: 'XT30', sd: 'SD card', microsd: 'microSD', fpc: 'flat cable', idc: 'ribbon', idc_ra: 'ribbon', wtb_side: 'wire plug', jst_gh: 'JST-GH', jst_zh: 'JST-ZH', jst_ph: 'JST-PH', jst_xh: 'JST-XH', picoblade: 'PicoBlade', kk254: 'KK plug', microfit: 'Micro-Fit', minifit: 'Mini-Fit', tagconnect: 'Tag-Connect', iec_c7: 'mains (C7)', iec_c14: 'mains (C13)', sata: 'SATA', sfp: 'SFP', minidin: 'mini-DIN', xlr: 'XLR', banana: '4 mm plug', m12: 'M12', toslink: 'TOSLINK', sim: 'SIM card', b2b: 'board-to-board', m2: 'M.2 card', pcie: 'PCIe card', dimm: 'memory module', pogo: 'spring pins', rf_mini: 'MMCX / SMB', pins_ra: 'pins', ac_au: 'AU outlet', ac_uk: 'UK outlet', ac_us: 'US outlet', ac_eu: 'EU outlet', mains_lead: 'mains lead',
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
  if (t === 'iec_c7' || t === 'iec_c14' || t === 'mains_lead') return 'mains-in';
  if (t === 'rj45' || t === 'sfp') return 'net';
  if (t.startsWith('hdmi') || t === 'dp') return 'video';
  if (t === 'audio35' || t === 'rca' || t === 'toslink' || t === 'xlr') return 'audio';
  if (t === 'terminal' || t === 'header' || t === 'idc' || t === 'idc_ra' || t === 'banana') return 'wire';
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

/** Where a lead that leaves the rack goes, in a few words for the 3D view ("to a screen", "to the wall"...). */
export function offRackTo(m: Module, c: Comp): string {
  const t = c.conn?.type ?? '', role = plugRole(m, c);
  if (t.startsWith('hdmi') || t === 'dp') return 'to a screen';
  if (role === 'mains-in' || t.startsWith('iec') || t === 'mains_lead') return 'to the wall';
  if (t === 'rj45' || t === 'sfp') return 'to the network';
  if (t === 'audio35' || t === 'rca' || t === 'xlr') return 'to speakers';
  if (t === 'toslink') return 'to an amplifier or screen';
  if (t === 'banana') return 'to an instrument or supply';
  if (t === 'm12') return 'to a sensor or machine';
  // (a card, a board or a test fixture goes on these, not a lead)
  if (['b2b', 'm2', 'pcie', 'dimm', 'sim', 'pogo', 'sd', 'microsd'].includes(t)) return 'no cable: something plugs straight onto it';
  if (t === 'rj11') return 'to the phone line';
  if (t === 'sma' || t === 'ufl' || t === 'rf_mini') return 'to its antenna';
  if (t === 'bnc') return 'to a scope or instrument';
  if (t === 'dsub') return 'to a computer or instrument';
  if (t === 'sata') return 'to a drive';
  if (t === 'minidin') return 'to a keyboard, mouse or instrument';
  if (t === 'xt60' || t === 'xt30') return 'to its battery';
  if (t === 'fpc') return 'to its display or camera';
  if (role === 'power-in' || role === 'power-in-dc' || t === 'barrel' || role === 'other') return 'to its power supply';
  if (/usb/.test(t)) return 'to a computer';
  return 'off the rack';
}

export function linkKind(ra: PlugRole, rb: PlugRole): Link['kind'] {
  const r = [ra, rb];
  if (r.includes('mains-in') || r.includes('mains-out')) return 'mains';
  if (r.includes('power-in') || r.includes('power-out') || r.includes('power-in-dc') || r.includes('dc-out')) return 'power';
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
    || pair('net', 'net') || pair('wire', 'wire') || pair('video', 'video') || pair('audio', 'audio') || pair('power-in-dc', 'wire') || pair('debug', 'debug') || pair('uart', 'uart') || pair('uart', 'hub-down') || pair('uart', 'host') || pair('mains-in', 'mains-out') || pair('dc-out', 'power-in-dc');
}

export interface PlugInfo { ref: PlugRef; module: Module; comp: Comp; role: PlugRole; label: string }

/** A barrel jack on a board that also takes power over USB (an Arduino): a DC input it doesn't need. */
export const optionalDc = (x: { role: PlugRole; comp: Comp; module: Module }) => x.role === 'other' && x.comp.conn?.type === 'barrel' && x.module.board.kind !== 'box';
/** What a supply's DC lead puts out, in volts, when its box says. */
export const voltsOf = (x: PlugInfo): number | undefined => x.module.board.box?.groups.find((g) => g.refs?.includes(baseRef(x.ref.ref)))?.volts;
/** A board's DC jack with a known input range (an Arduino's barrel: optional beside USB power, but it takes 7 to 12 V). */
export const isRangedJack = (x: PlugInfo) => optionalDc(x) && !!dcRange(x.module.board);
/** A supply's DC lead against a board's ranged jack, whichever way round they are: null for any other pair. */
function dcJackPair(a: PlugInfo, b: PlugInfo): { src: PlugInfo; jack: PlugInfo } | null {
  return a.role === 'dc-out' && isRangedJack(b) ? { src: a, jack: b } : b.role === 'dc-out' && isRangedJack(a) ? { src: b, jack: a } : null;
}
/** Does this supply's voltage fit the jack's range? Null when either is not known. */
export function fitsJack(src: PlugInfo, jack: PlugInfo): boolean | null {
  const v = voltsOf(src), r = dcRange(jack.module.board);
  return v == null || !r ? null : v >= r.min - 1e-6 && v <= r.max + 1e-6;
}

function modulePlugs(m: Module, out: PlugInfo[] = []): PlugInfo[] {
  for (const c of m.board.comps) {
    if (!c.conn || c.hidden) continue;
    const role = plugRole(m, c), nm = `${c.ref} ${plugTypeName[c.conn.type] ?? ''}`.trim();
    // a stacked pair of USB-A sockets is two ports: the second one's ref ends in ":2"
    if (c.conn.type === 'usb_a_dual') out.push({ ref: { module: m.id, ref: c.ref }, module: m, comp: c, role, label: `${nm} lower` }, { ref: { module: m.id, ref: `${c.ref}:2` }, module: m, comp: c, role, label: `${nm} upper` });
    else out.push({ ref: { module: m.id, ref: c.ref }, module: m, comp: c, role, label: nm });
  }
  return out;
}

/** Every plug of every board and box in the rack (not "Your computer": see allPlugs). */
export function plugsOf(p: Project): PlugInfo[] {
  const out: PlugInfo[] = [];
  for (const m of p.modules) modulePlugs(m, out);
  return out;
}

/**
 * "Your computer": the one place off the rack a USB device or a hub's uplink can go (a J-Link on a bench with no Pi).
 * It isn't a board in the rack: it has as many USB ports as its cables use, and `spare` free ones.
 */
export const PC = '@pc';
export function pcModule(p: Project, spare = 1): Module {
  const used = [...new Set((p.links ?? []).flatMap((l) => [l.a, l.b]).filter((r) => r.module === PC).map((r) => r.ref))];
  const refs = [...used];
  for (let n = 1, k = 0; k < spare; n++) if (!used.includes(`USB${n}`)) { refs.push(`USB${n}`); k++; }
  refs.sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  const comps = refs.map((ref) => ({ id: `pc_${ref}`, ref, pkg: 'USB-A', side: 'top', x: 0, y: 0, rot: 0, w: 13, l: 14, h: 6, kind: 'connector', tht: false, role: 'host', conn: { type: 'usb_a' } }) as unknown as Comp);
  return { id: PC, board: { name: 'Your computer', outline: [], cutouts: [], thickness: 1, holes: [], comps, source: 'computer', notes: [], kind: 'box' }, holder: {} as Module['holder'] };
}
/**
 * "Your router": where a switch's uplink goes, off the rack, so the boards on the switch reach your network. Like your
 * computer, it has as many Ethernet ports as its cables use, and `spare` free ones.
 */
export const ROUTER = '@router';
export function routerModule(p: Project, spare = 0): Module {
  const used = [...new Set((p.links ?? []).flatMap((l) => [l.a, l.b]).filter((r) => r.module === ROUTER).map((r) => r.ref))];
  const refs = [...used];
  for (let n = 1, k = 0; k < spare; n++) if (!used.includes(`LAN${n}`)) { refs.push(`LAN${n}`); k++; }
  refs.sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  const comps = refs.map((ref) => ({ id: `rt_${ref}`, ref, pkg: 'RJ45', side: 'top', x: 0, y: 0, rot: 0, w: 16, l: 21, h: 13, kind: 'connector', tht: false, role: 'net', conn: { type: 'rj45' } }) as unknown as Comp);
  return { id: ROUTER, board: { name: 'Your router', outline: [], cutouts: [], thickness: 1, holes: [], comps, source: 'router', notes: [], kind: 'box' }, holder: {} as Module['holder'] };
}
/** A module by id: a board or box in the rack, "Your computer" or "Your router". */
export const findModule = (p: Project, id: string): Module | undefined => p.modules.find((m) => m.id === id) ?? (id === PC ? pcModule(p, 0) : id === ROUTER ? routerModule(p) : undefined);
/** The rack's plugs, your computer's and your router's (with `spare` free ports on your computer, one on your router). */
export const allPlugs = (p: Project, spare = 1): PlugInfo[] => [...plugsOf(p), ...modulePlugs(pcModule(p, spare)), ...modulePlugs(routerModule(p, 1))];
/** A plug whose other end is off the rack: on your computer or router, or on a plug pack in an outlet. */
export const offRackModule = (m: Module | undefined) => !!m && (m.id === PC || m.id === ROUTER || isPlugPack(m.board));

const ROLE_SAYS: Record<PlugRole, string> = {
  host: 'a USB port that devices plug into', device: 'a USB device plug (it goes to a hub or a computer)', 'power-in': 'a power input (it takes power from a charger)', 'power-in-dc': 'a DC power input',
  'power-out': 'a charger port (it gives power)', 'dc-out': "a supply's DC lead", 'hub-up': "a hub's uplink (it goes to a computer)", 'hub-down': 'a hub port', net: 'Ethernet', video: 'a video port', audio: 'an audio jack',
  wire: 'screw terminals or pins for wires', debug: 'a debug connector', uart: 'serial pins', 'mains-in': 'a mains plug or lead', 'mains-out': 'a mains outlet', other: 'a plug whose cable leaves the rack',
};
const hasOutlets = (m: Module) => m.board.comps.some((c) => c.conn?.type.startsWith('ac_'));
/** The board a hub's uplink is plugged into, if any (so a hub never powers the board it hangs off). */
function hostOfHub(p: Project, hub: Module, extra: Link[] = []): string | undefined {
  for (const l of [...(p.links ?? []), ...extra]) for (const [me, other] of [[l.a, l.b], [l.b, l.a]] as const) {
    if (me.module !== hub.id) continue;
    const c = hub.board.comps.find((x) => x.ref === baseRef(me.ref));
    if (c && plugRole(hub, c) === 'hub-up') return other.module;
  }
  return undefined;
}

/**
 * Why these two plugs can't be cabled together, in plain words, or null when they can. Refuses what never fits and
 * what is unsafe: a powerboard into another powerboard, a mains outlet onto wires, a board powered through the hub
 * it hosts.
 */
export function refusal(p: Project, a: PlugInfo, b: PlugInfo): string | null {
  if (a.module === b.module || a.module.id === b.module.id) return 'Pick a plug on another board.';
  const has = (r: PlugRole) => a.role === r || b.role === r;
  // a supply's lead into an Arduino's DC jack: only within the range its maker gives
  const dj = dcJackPair(a, b);
  if (dj && fitsJack(dj.src, dj.jack) === false) {
    const r = dcRange(dj.jack.module.board)!, v = voltsOf(dj.src)!;
    return `The ${shortName(dj.src.module.board.name)} puts out ${v} V, and the ${shortName(dj.jack.module.board.name)}'s DC jack takes ${r.min} to ${r.max} V (${r.usual} V is the usual pack): a ${v > r.max ? 'higher' : 'lower'} voltage would damage it or leave it off.`;
  }
  if (has('mains-in') && has('mains-out') && hasOutlets(a.module) && hasOutlets(b.module)) return "A powerboard's lead goes to the wall, never into another powerboard: plug each one into the wall.";
  if (has('mains-out') && has('wire')) return "A mains outlet only takes a mains plug. BoardDock doesn't wire mains through screw terminals or relays: that belongs in a proper enclosure, wired by someone qualified to.";
  if ((has('mains-out') || has('mains-in')) && !compatible(a.role, b.role)) return has('mains-out') ? "A mains outlet only takes a mains plug: a charger's lead or a plug pack." : "A mains lead goes into a powerboard's outlet (or the wall), nothing else.";
  // (an Arduino's barrel jack, on a board that also takes power over USB, is a DC input you may leave empty: a supply's lead goes in it)
  const dcLead = (x: PlugInfo, y: PlugInfo) => x.role === 'dc-out' && optionalDc(y);
  if (!compatible(a.role, b.role) && !dcLead(a, b) && !dcLead(b, a)) return `${a.label} is ${ROLE_SAYS[a.role]}, and ${b.label} is ${ROLE_SAYS[b.role]}: they don't plug into each other.`;
  // TOSLINK is optical digital audio: it goes to another TOSLINK, and never straight to an analog jack
  if (a.role === 'audio' && b.role === 'audio' && (a.comp.conn?.type === 'toslink') !== (b.comp.conn?.type === 'toslink')) return `${a.label} and ${b.label}: TOSLINK is optical digital audio, so it goes to another TOSLINK, not to an analog jack (that takes a converter box).`;
  // a barrel jack takes a supply's plug, or a pigtail lead to screw terminals: never header pins (a Pi's GPIO)
  const dcIn = a.role === 'power-in-dc' ? a : b.role === 'power-in-dc' ? b : null, w = a.role === 'wire' ? a : b.role === 'wire' ? b : null;
  if (dcIn && w && dcIn.comp.conn?.type === 'barrel' && w.comp.conn?.type !== 'terminal' && w.comp.conn?.type !== 'banana') return `${dcIn.label} is a barrel jack: it takes a supply's plug, or a pigtail lead to screw terminals, not header pins.`;
  const [taker, src] = a.role === 'power-in' ? [a, b] : b.role === 'power-in' ? [b, a] : [null, null];
  if (taker && src) {
    if (src.module.id === PC) return `Your computer's USB port can't power the ${shortName(taker.module.board.name)}: give it a charger port or a supply.`;
    if (src.role === 'hub-down' && hostOfHub(p, src.module) === taker.module.id) return `The ${shortName(src.module.board.name)} hangs off the ${shortName(taker.module.board.name)}: powering the ${shortName(taker.module.board.name)} from it would feed it from itself. Give it a charger port.`;
  }
  return null;
}
/** Can these two plugs be cabled together (see refusal)? */
export const canCable = (p: Project, a: PlugInfo, b: PlugInfo) => refusal(p, a, b) == null;
/** Something to check yourself after connecting these two, or null. */
export function connectNote(a: PlugInfo, b: PlugInfo): string | null {
  const dj = dcJackPair(a, b);
  if (dj) { const r = dcRange(dj.jack.module.board)!; return `The ${shortName(dj.jack.module.board.name)}'s DC jack takes ${r.min} to ${r.max} V (${r.usual} V is the usual pack). BoardDock can't check voltages or polarity beyond that: make sure the pack's label matches (centre pin positive on most) before you plug it in.`; }
  if ((a.role === 'dc-out' && (b.role === 'power-in-dc' || optionalDc(b))) || (b.role === 'dc-out' && (a.role === 'power-in-dc' || optionalDc(a)))) return "BoardDock can't check voltages or polarity: make sure the supply's label matches what the DC input takes before you plug it in.";
  return null;
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

/** Where a plug pack goes, for the steps: "the USB-C supply into Powerboard AC1, its lead to Raspberry Pi 5 J_PWR". */
export function packGoes(p: Project, m: Module): string {
  const ls = (p.links ?? []).filter((l) => l.a.module === m.id || l.b.module === m.id);
  const far = (l: Link) => (l.a.module === m.id ? l.b : l.a);
  const at = (r: PlugRef) => `${findModule(p, r.module)?.board.name ?? 'its board'} ${baseRef(r.ref)}`;
  const outlet = ls.find((l) => l.kind === 'mains'), leads = ls.filter((l) => l.kind !== 'mains');
  return `the ${m.board.name} into ${outlet ? at(far(outlet)) : 'an outlet'}${leads.length ? `, its lead to ${leads.map((l) => at(far(l))).join(' and ')}` : ''}`;
}

/** Where each plug is on the laid-out rack ("module/ref" -> panel-frame point, mm), when it has been laid out. */
export type PlugAt = (key: string) => number[] | undefined;
const keyOf = (x: PlugInfo) => `${x.ref.module}/${x.ref.ref}`;

/** A network switch or router: a box with three or more Ethernet ports. */
export const isSwitch = (b: Board) => b.kind === 'box' && b.comps.filter((c) => c.conn?.type === 'rj45' && !c.hidden).length >= 3;

const keyR = (r: PlugRef) => `${r.module}/${r.ref}`;

/**
 * How well a port powers a board: 0 when it gives the board's peak, a penalty (in mm of cable) when it gives only
 * enough for the board to run (a Pi 5 on 3 A), null when it gives too little.
 */
export function powerFit(need: Need, cap: number): number | null {
  if (cap + 1e-6 >= need.peak) return 0;
  if (cap + 1e-6 >= minOf(need)) return 1000;
  return null;
}

/** A cable that powers a board through its power input, with what the port gives against what the board wants. */
export interface PowerFeed { link: Link; take: PlugInfo; src: PlugInfo; need: Need; cap: number; weak: boolean; loop: boolean }
/**
 * Every cable that powers a board through its power input. weak: the port gives less than the board needs to run,
 * or it is a loop (a board powered through the hub it hosts); a port that gives enough to run but less than the
 * board's peak (a Pi 5 on 3 A) is not weak, only limited (cap < need.peak).
 */
export function powerFeeds(p: Project): PowerFeed[] {
  const by = new Map(plugsOf(p).map((x) => [keyOf(x), x]));
  const out: PowerFeed[] = [];
  for (const l of p.links ?? []) {
    const a = by.get(keyR(l.a)), b = by.get(keyR(l.b));
    if (!a || !b) continue;
    const [take, src] = a.role === 'power-in' ? [a, b] : b.role === 'power-in' ? [b, a] : [null, null];
    if (!take || !src || !['power-out', 'hub-down', 'host'].includes(src.role)) continue;
    const need = needOf(take.module.board, true), cap = portCap(src.module.board, src.comp, src.role);
    const loop = src.role === 'hub-down' && hostOfHub(p, src.module) === take.module.id;
    out.push({ link: l, take, src, need, cap, weak: cap + 1e-6 < minOf(need) || loop, loop });
  }
  return out;
}

/**
 * Suggest cables for every plug still free, the way you would lay them out yourself: a hub to the nearest computer
 * or board that hosts it, power only from ports that give a board what it needs, on chargers that have enough left,
 * devices to the nearest hub port (a board's own USB ports only while their shared limit allows), each board's
 * Ethernet to a switch, mains leads and plug packs to the nearest outlet, probes and adapters to the headers they
 * serve. A device or hub with nowhere on the rack to go goes to your computer. Each kind is paired all at once (the
 * cheapest pairing in all, not first come first served), by how long the cable would be on the laid-out rack (`at`),
 * else by the boards' order. Every suggestion says why it was made.
 */
export function autoLinks(p: Project, at?: PlugAt): Link[] {
  const plugs = plugsOf(p);
  const taken = new Set((p.links ?? []).flatMap((l) => [keyR(l.a), keyR(l.b)]));
  const free = (r: PlugRole) => plugs.filter((x) => x.role === r && !taken.has(keyOf(x)));
  // your computer, with a free port for every plug that might end up there
  const pc = modulePlugs(pcModule(p, plugs.filter((x) => (x.role === 'device' || x.role === 'hub-up') && !taken.has(keyOf(x))).length + 1));
  const nextPc = () => pc.find((x) => !taken.has(keyOf(x)))!;
  const out: Link[] = [];
  /** Roughly how long the cable would be: along, across and up the rack, and a hand-width out of each plug. */
  const reach = (a: PlugInfo, b: PlugInfo) => cableReach(p, a, b, at, out); // (not laid out yet: about 90 mm a board apart)
  const cm = (a: PlugInfo, b: PlugInfo) => `about ${Math.round(reach(a, b) / 10) * 1} cm`;
  const take = (a: PlugInfo, b: PlugInfo, why: string) => {
    taken.add(keyOf(a)); taken.add(keyOf(b));
    out.push({ id: `l${Math.random().toString(36).slice(2, 8)}`, a: a.ref, b: b.ref, kind: linkKind(a.role, b.role), auto: true, why });
  };
  /** The cheapest pairing of `from` with `to` (cost null: can't), never a board with itself. */
  const pairUp = (from: PlugInfo[], to: PlugInfo[], cost: (a: PlugInfo, b: PlugInfo) => number | null) => {
    const M = from.map((a) => to.map((b) => { if (a.module === b.module) return Infinity; const c = cost(a, b); return c == null ? Infinity : c; }));
    return assign(M).map((j, i) => (j >= 0 ? [from[i], to[j]] as const : null)).filter(Boolean) as (readonly [PlugInfo, PlugInfo])[];
  };
  const nm = (x: PlugInfo) => shortName(x.module.board.name);
  const hostOf = (hub: Module) => hostOfHub(p, hub, out);

  // 0. PoE: a board with a PoE HAT goes on a free PoE port of a switch, within what the switch gives, and needs no supply
  const poeFed = poeFedIds(p);
  for (const [n, sw] of poeAssign(p, plugs, taken, reach)) {
    take(n, sw, `The ${nm(n)} has a PoE HAT: its Ethernet goes to a PoE port of the ${nm(sw)} (${cm(n, sw)}), which powers it (about ${poeWatts(n.module.board)} W of the ${poeTotal(sw.module.board).total} W the switch gives), so it needs no supply.`);
    poeFed.add(n.module.id);
  }

  // 1. hubs hang off a host (a computer's or a board's USB port) first, so their ports can feed devices; a hub with
  // Ethernet or USB 3 ports goes on a USB 3 port where there is one
  const fast = (hub: Module) => /usb ?3|3\.[012]/i.test(hub.board.name) || hub.board.comps.some((c) => c.conn?.type === 'rj45' || /usb ?3/i.test(`${c.ref} ${c.value ?? ''}`));
  const usb3 = (x: PlugInfo) => /usb ?3/i.test(`${x.comp.ref} ${x.comp.value ?? ''} ${x.comp.pkg}`);
  for (const [up, h] of pairUp(free('hub-up'), free('host'), (a, b) => reach(a, b) + (fast(a.module) && !usb3(b) ? 150 : 0)))
    take(up, h, `${nm(up)} goes to the nearest free USB port of the ${nm(h)} (${cm(up, h)})${fast(up.module) && usb3(h) ? ', a USB 3 one for its fast ports' : ''}, so its ports can feed the boards round it.`);
  // nothing on the rack to host it: the hub's uplink goes to your computer
  for (const up of free('hub-up')) take(up, nextPc(), `Nothing on the rack hosts the ${nm(up)}, so its uplink goes to your computer, off the rack (a 2 m cable).`);

  // 2. power: every board that takes power over USB, from a port that gives what it needs, on a supply that still has
  // enough to give; the cheapest pairing in all, and a supply that would be overloaded gets costlier until the load
  // moves (six Pi 4s end up split over two chargers, on their USB-C ports). A port that gives less than a board needs
  // is never used: the board is left for you to give a stronger port (the Plugs step offers a charger or a supply).
  const supply = new Map<string, number>();
  const room = (m: Module) => {
    if (!supply.has(m.id)) {
      const total = supplyOf(m.board, plugs.filter((q) => q.module === m && q.role === 'power-out').map((q) => ({ c: q.comp, role: q.role }))).total;
      // minus what the cables already on it carry
      const used = (p.links ?? []).reduce((a, l) => {
        const other = l.a.module === m.id ? l.b.module : l.b.module === m.id ? l.a.module : null;
        const om = other ? p.modules.find((x) => x.id === other) : null;
        return a + (om && (l.kind === 'power' || l.kind == null) ? needOf(om.board, true).load : 0);
      }, 0);
      supply.set(m.id, total - used);
    }
    return supply.get(m.id)!;
  };
  const pins = free('power-in').filter((x) => !poeFed.has(x.module.id));
  const need = new Map(pins.map((x) => [x, needOf(x.module.board, true)]));
  const outs = free('power-out');
  const fit = (a: PlugInfo, b: PlugInfo) => powerFit(need.get(a)!, portCap(b.module.board, b.comp, b.role));
  const pairCost = (a: PlugInfo, b: PlugInfo) => { const f = fit(a, b); return f == null ? null : reach(a, b) + f; };
  // The best in all wins: the least cable, every board at its peak where a port gives it, no supply overloaded, and
  // the load spread over the chargers (an even spread is worth about 40 cm of cable, so two chargers side by side
  // share the boards, but one far away is not dragged in).
  const chargers = [...new Set(outs.map((o) => o.module.id))];
  const cost = (got: (readonly [PlugInfo, PlugInfo])[]) => {
    const load = new Map<string, number>();
    for (const [a, b] of got) load.set(b.module.id, (load.get(b.module.id) ?? 0) + need.get(a)!.load);
    const frac = chargers.map((id) => (load.get(id) ?? 0) / Math.max(0.1, room(p.modules.find((m) => m.id === id)!)));
    return got.reduce((t, [a, b]) => t + (pairCost(a, b) ?? 1e6), 0) + frac.filter((f) => f > 1 + 1e-6).length * 1000 + (frac.length > 1 ? 400 * (Math.max(...frac) - Math.min(...frac)) : 0) + (pins.length - got.length) * 2000;
  };
  // the cheapest pairing by cable and port first; then single moves and swaps while they make the whole better
  let power = pairUp(pins, outs, pairCost).map((x) => [x[0], x[1]] as [PlugInfo, PlugInfo]);
  let J = cost(power);
  for (let it = 0; it < 200; it++) {
    let better: [PlugInfo, PlugInfo][] | null = null, bJ = J;
    const usedPorts = new Set(power.map(([, b]) => b));
    for (let i = 0; i < power.length; i++) {
      // move to a free port
      for (const o of outs) {
        if (usedPorts.has(o) || o.module === power[i][0].module || fit(power[i][0], o) == null) continue;
        const cand = power.map((x, k) => (k === i ? [x[0], o] as [PlugInfo, PlugInfo] : x));
        const c = cost(cand);
        if (c < bJ - 1e-6) { bJ = c; better = cand; }
      }
      // or swap ports with another
      for (let k = i + 1; k < power.length; k++) {
        if (fit(power[i][0], power[k][1]) == null || fit(power[k][0], power[i][1]) == null) continue;
        const cand = power.map((x, q) => (q === i ? [x[0], power[k][1]] as [PlugInfo, PlugInfo] : q === k ? [x[0], power[i][1]] as [PlugInfo, PlugInfo] : x));
        const c = cost(cand);
        if (c < bJ - 1e-6) { bJ = c; better = cand; }
      }
    }
    if (!better) break;
    power = better; J = bJ;
  }
  // never past what a supply gives: the farthest boards come off an overloaded one, onto a free port with room
  // elsewhere if there is one (else they wait for a stronger supply)
  const loadOn = (id: string) => power.filter(([, b]) => b.module.id === id).reduce((t, [a]) => t + need.get(a)!.load, 0);
  for (const id of chargers) {
    const m = p.modules.find((x) => x.id === id)!;
    while (loadOn(id) > room(m) + 1e-6) {
      const far = power.filter(([, b]) => b.module.id === id).sort((x, y) => reach(y[0], y[1]) - reach(x[0], x[1]))[0];
      power = power.filter((x) => x !== far);
      const a = far[0], used = new Set(power.map(([, b]) => b));
      const alt = outs.filter((o) => !used.has(o) && o.module !== a.module && o.module.id !== id && fit(a, o) != null && loadOn(o.module.id) + need.get(a)!.load <= room(o.module) + 1e-6)
        .sort((x, y) => pairCost(a, x)! - pairCost(a, y)!)[0];
      if (alt) power.push([a, alt]);
    }
  }
  for (const [a, b] of power) {
    const n = need.get(a)!, cap = portCap(b.module.board, b.comp, b.role);
    take(a, b, `The ${nm(a)} needs about ${n.peak} A at its peak: ${b.label} on the ${nm(b)} gives ${cap} A${cap + 1e-6 < n.peak ? ', enough for it to run, with less for its own USB ports (a 5 A USB-C supply gives it the lot)' : ''}${outs.some((o) => o.module !== b.module) ? ', on the supply with room to spare nearest to it' : ''} (${cm(a, b)}).`);
  }
  // no charger port left: a powered hub's port will do when it gives the board enough (a small board, never a Pi),
  // and never the hub that hangs off that same board; a hub without a supply of its own never powers a board
  for (const [a, b] of pairUp(free('power-in').filter((x) => !poeFed.has(x.module.id)), free('hub-down').filter((h) => poweredHub(h.module.board)), (a, b) => {
    const f = powerFit(needOf(a.module.board, true), portCap(b.module.board, b.comp, b.role));
    return f == null || hostOf(b.module) === a.module.id ? null : reach(a, b) + f;
  }))
    take(a, b, `No charger port was free, so the ${nm(a)} takes power from the powered ${nm(b)} (a hub port gives about ${portCap(b.module.board, b.comp, b.role)} A, enough for it).`);

  // 3. devices (an Arduino's USB, a probe's or an adapter's USB) to the nearest hub port, else a board's own USB port
  // while what they take stays within the limit those ports share (a Pi 4's give 1.2 A between them), else your computer
  const hasPowerIn = (m: Module) => plugs.some((x) => x.module === m && x.role === 'power-in');
  const devLoad = (m: Module) => (isHub(m) ? (poweredHub(m.board) ? 0.1 : 0.5) : hasPowerIn(m) ? 0.05 : needOf(m.board, false).load);
  const feedCap = (m: Module) => {
    for (const l of [...(p.links ?? []), ...out]) for (const [me, o] of [[l.a, l.b], [l.b, l.a]] as const) {
      if (me.module !== m.id) continue;
      const c = m.board.comps.find((x) => x.ref === baseRef(me.ref)), om = p.modules.find((x) => x.id === o.module), oc = om?.board.comps.find((x) => x.ref === baseRef(o.ref));
      if (c && om && oc && plugRole(m, c) === 'power-in') return portCap(om.board, oc, plugRole(om, oc));
    }
    return undefined;
  };
  const hostLoad = (m: Module) => [...(p.links ?? []), ...out].reduce((t, l) => {
    for (const [me, o] of [[l.a, l.b], [l.b, l.a]] as const) {
      const c = me.module === m.id ? m.board.comps.find((x) => x.ref === baseRef(me.ref)) : undefined, om = p.modules.find((x) => x.id === o.module);
      if (c && om && plugRole(m, c) === 'host') return t + devLoad(om);
    }
    return t;
  }, 0);
  const devs = free('device'), banned = new Set<PlugInfo>();
  let got: (readonly [PlugInfo, PlugInfo])[] = [];
  for (let it = 0; it < 12; it++) {
    got = pairUp(devs, [...free('hub-down'), ...free('host')].filter((x) => !banned.has(x)), (a, b) => reach(a, b) + (b.role === 'host' ? 80 : 0));
    const byHost = new Map<Module, (readonly [PlugInfo, PlugInfo])[]>();
    for (const g of got) if (g[1].role === 'host') byHost.set(g[1].module, [...(byHost.get(g[1].module) ?? []), g]);
    let over = false;
    for (const [m, gs] of byHost) {
      const t = hostTotal(m.board, feedCap(m));
      if (t == null) continue;
      // the nearest devices that fit within its limit keep their ports; its other ports are off the table
      let sum = hostLoad(m);
      const keep = new Set<PlugInfo>();
      for (const [d, h] of [...gs].sort((x, y) => reach(x[0], x[1]) - reach(y[0], y[1]))) if (sum + devLoad(d.module) <= t + 1e-6) { sum += devLoad(d.module); keep.add(h); }
      if (keep.size < gs.length) { over = true; for (const x of free('host')) if (x.module === m && !keep.has(x)) banned.add(x); }
    }
    if (!over) break;
  }
  for (const [d, h] of got)
    take(d, h, `${h.role === 'hub-down' ? `The nearest free port of the ${nm(h)}` : `No hub port was free, so a USB port of the ${nm(h)}`} (${cm(d, h)}).`);
  // nowhere on the rack: your computer (not for a board powered through its own input, a Pi Zero: its data port can wait)
  for (const d of free('device').filter((x) => !hasPowerIn(x.module))) take(d, nextPc(), `No USB port on the rack was free${banned.size ? ' (the boards’ own ports are at the limit they share)' : ''}, so the ${nm(d)}'s USB goes to your computer, off the rack (a 2 m cable).`);

  // 4. each board's Ethernet to a switch in the rack, when there is one
  const sw = free('net').filter((x) => isSwitch(x.module.board));
  // (a board with an RJ45 uses that, not an SFP cage: a cage needs a module bought for it)
  const lan = (x: PlugInfo) => x.comp.conn?.type !== 'sfp' || !x.module.board.comps.some((c) => c.conn?.type === 'rj45' && !c.hidden);
  // (a board with a PoE HAT that the PoE step left out, the switch having no more to give, stays off the PoE ports: it would draw from them)
  if (sw.length) for (const [n, s] of pairUp(free('net').filter((x) => !isSwitch(x.module.board) && !isAccessory(x.module.board) && lan(x)), sw, (a, b) => (takesPoe(a.module.board) && isPoePort(b.module.board, b.comp) ? null : reach(a, b))))
    take(n, s, `The ${nm(n)}'s Ethernet to the nearest free port of the ${nm(s)} (${cm(n, s)}).`);

  // 5. a DC supply's lead to a DC input, only where both say the same voltage (BoardDock can't check the rest: those
  // you connect yourself, once you have checked the labels)
  const volts = voltsOf;
  for (const [s, d] of pairUp(free('dc-out'), free('power-in-dc'), (a, b) => (volts(a) != null && volts(a) === volts(b) ? reach(a, b) : null)))
    take(s, d, `The ${nm(s)}'s ${volts(s)} V lead to the ${nm(d)}'s ${volts(d)} V input (${cm(s, d)}).`);
  // ...then a board with a DC jack and a known input range (an Arduino: 7 to 12 V), from a pack that is left and whose voltage is
  // inside it, the one nearest the usual pick first; never a pack that came with a box of its own
  const jacks = plugs.filter((x) => isRangedJack(x) && !taken.has(keyOf(x)));
  for (const [s, d] of pairUp(free('dc-out').filter((x) => !x.module.board.box?.pack?.own), jacks, (a, b) => (fitsJack(a, b) ? reach(a, b) + Math.abs(volts(a)! - dcRange(b.module.board)!.usual) * 25 : null))) {
    const r = dcRange(d.module.board)!;
    take(s, d, `The ${nm(s)}'s ${volts(s)} V lead to the ${nm(d)}'s DC jack, which takes ${r.min} to ${r.max} V (${cm(s, d)}).`);
  }

  // 6. mains: each charger's (or hub's) lead, and each plug pack, into the nearest free outlet of a powerboard; never
  // a powerboard's own lead into another powerboard (daisy-chained powerboards overload the first)
  for (const [lead, o] of pairUp(free('mains-in').filter((x) => !hasOutlets(x.module)), free('mains-out'), reach))
    take(lead, o, isPlugPack(lead.module.board) ? `The ${nm(lead)} plugs straight into the free outlet on the ${nm(o)} nearest the board it powers.` : `The ${nm(lead)}'s mains lead to the nearest free outlet on the ${nm(o)} (${cm(lead, o)}).`);

  // 7. debug probes and serial adapters: each free one to the nearest free header of its kind on a board (never probe
  // to probe); an adapter's jumper wires are filled in by the caller
  for (const r of ['debug', 'uart'] as const)
    for (const [pr, h] of pairUp(free(r).filter((x) => isAccessory(x.module.board)), free(r).filter((x) => !isAccessory(x.module.board)), reach))
      take(pr, h, `The ${nm(pr)} ${r === 'debug' ? 'debugs' : 'is the serial console of'} the ${nm(h)} (${h.label}, ${cm(pr, h)}).`);

  // 8. each switch with boards on it: its uplink to your router, off the rack (on its last free port), unless it
  // already goes to your router or to another switch (last, so the cables before it keep the ids they had)
  const rt = modulePlugs(routerModule(p, 8)), nextRt = () => rt.find((x) => !taken.has(keyOf(x)))!;
  for (const m of new Set(plugs.filter((x) => x.role === 'net' && isSwitch(x.module.board)).map((x) => x.module))) {
    const ends = [...(p.links ?? []), ...out].filter((l) => l.a.module === m.id || l.b.module === m.id).map((l) => (l.a.module === m.id ? l.b : l.a).module);
    if (!ends.length || ends.some((id) => { const o = findModule(p, id); return id === ROUTER || (!!o && o.id !== m.id && isSwitch(o.board)); })) continue;
    const port = plugs.filter((x) => x.module === m && x.role === 'net' && !taken.has(keyOf(x))).pop();
    if (port) take(port, nextRt(), `The ${nm(port)}'s uplink goes to your router, off the rack, so the boards on it reach your network (measure the run for its cable).`);
  }
  return out;
}

const isHub = (m: Module) => m.board.kind === 'box' && /hub/i.test(m.board.name);
const dist = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/**
 * Roughly how long a cable between two plugs would be on the rack (mm): see autoLinks. A cable to your computer
 * counts as 60 cm (it leaves the rack); a plug pack sits in an outlet, so its lead runs from the outlet nearest the
 * board, and its body goes in the outlet nearest the board it powers (`extra`: cables not in the project yet).
 */
export function cableReach(p: Project, a: PlugInfo, b: PlugInfo, at?: PlugAt, extra: Link[] = []): number {
  const off = (x: PlugInfo) => x.module.id === PC || x.module.id === ROUTER || isPlugPack(x.module.board);
  if (off(a) || off(b)) {
    const [o, r] = off(a) ? [a, b] : [b, a];
    if (o.module.id === PC || o.module.id === ROUTER || !at) return 600;
    let from = at(keyOf(r));
    if (o.role === 'mains-in') {
      const l = [...(p.links ?? []), ...extra].find((x) => x.kind === 'power' && (x.a.module === o.module.id || x.b.module === o.module.id));
      const end = l && (l.a.module === o.module.id ? l.b : l.a);
      const q = end && at(keyR(end));
      return q && from ? dist(q, from) + 60 : 600;
    }
    const outlets = plugsOf(p).filter((x) => x.role === 'mains-out').map((x) => at(keyOf(x))).filter(Boolean) as number[][];
    return from && outlets.length ? Math.min(...outlets.map((q) => dist(q, from!))) + 60 : 600;
  }
  const pa = at?.(keyOf(a)), pb = at?.(keyOf(b));
  if (pa && pb) return dist(pa, pb) + 60;
  return Math.abs(p.modules.indexOf(a.module) - p.modules.indexOf(b.module)) * 90 + 60;
}

/**
 * The best plugs for this one to go to, best first: free plugs it fits (your computer's too), by how long the cable
 * would be and how well the other end suits it (power from a port that gives enough, a device on a hub rather than
 * a computer's own port). Each with a short note for the list.
 */
export function rankTargets(p: Project, ref: PlugRef, at?: PlugAt, n = 5): { plug: PlugInfo; cost: number; note: string }[] {
  const plugs = allPlugs(p), me = plugs.find((x) => sameRef(x.ref, ref));
  if (!me) return [];
  const taken = new Set((p.links ?? []).flatMap((l) => [keyR(l.a), keyR(l.b)]));
  const need = me.role === 'power-in' ? needOf(me.module.board, true) : null;
  return plugs.filter((x) => x.module.id !== me.module.id && !taken.has(keyOf(x)) && canCable(p, me, x) && !(me.role === 'power-in' && x.role === 'hub-down' && !poweredHub(x.module.board)))
    .map((x) => {
      const len = cableReach(p, me, x, at);
      const cap = need ? portCap(x.module.board, x.comp, x.role) : 0;
      const pcEnd = x.module.id === PC;
      let pen = 0, note = pcEnd ? 'off the rack (a 2 m cable)' : `about ${Math.round(len / 10)} cm`;
      if (need) {
        const f = powerFit(need, cap);
        if (f == null) { pen += 2000; note += `, gives ${cap} A of the ${need.peak} A it wants: too little`; }
        else if (f) { pen += f; note += `, gives ${cap} A: it runs, with less for its own USB`; }
        else note += `, gives ${cap} A`;
        if (x.role !== 'power-out') pen += 300;
      }
      if (pcEnd) pen += 150;
      else if ((me.role === 'device' || me.role === 'uart') && x.role === 'host') { pen += 80; note += ', a USB port of the board itself'; }
      if (me.role === 'uart' && (x.role === 'host' || x.role === 'hub-down')) note += ' (a USB-serial cable)';
      return { plug: x, cost: len + pen, note };
    })
    .sort((a, b) => a.cost - b.cost).slice(0, n);
}

/**
 * Boards still short of power: no cable yet, or on a port too weak for them (or on the hub they host), that no free
 * port could serve; and the accessory that would (a 27 W USB-C supply for each Pi 5, else chargers).
 */
export function powerShort(p: Project): { unserved: { plug: PlugInfo; need: Need; weak: boolean }[]; add: { id: string; count: number } | null } {
  const b = portBudget(p);
  const want = [...b.powerIns.map((x) => ({ plug: x, need: needOf(x.module.board, true), weak: false })), ...b.weak.map((w) => ({ plug: w.take, need: w.need, weak: true }))];
  // the hungriest first, onto the strongest free port that gives it enough to run
  const caps = b.powerOuts.map((o) => portCap(o.module.board, o.comp, o.role)).sort((x, y) => y - x);
  const unserved: typeof want = [];
  for (const w of want.sort((x, y) => minOf(y.need) - minOf(x.need))) { const i = caps.findIndex((c) => c + 1e-6 >= minOf(w.need)); if (i >= 0) caps.splice(i, 1); else unserved.push(w); }
  if (!unserved.length) return { unserved, add: null };
  const big = unserved.filter((w) => w.need.peak > 3 + 1e-6).length;
  return { unserved, add: big === unserved.length ? { id: 'psu_pi5', count: big } : { id: 'usb_charger6', count: Math.ceil(unserved.length / 6) } };
}

/**
 * The hubs that give `k` plugs a port: one 4-port hub for up to 4, else 7-port ones, as many as it takes. (Each hub's own
 * uplink goes to a free port of the rack or, with none, to your computer: `addLinks` says which.)
 */
export function hubOffer(k: number): { id: 'usb_hub' | 'usb_hub7'; count: number; ports: number } {
  return k <= 4 ? { id: 'usb_hub', count: 1, ports: 4 } : { id: 'usb_hub7', count: Math.ceil(k / 7), ports: 7 };
}

/**
 * Which of these new cables leave the rack for your computer, in words for the toast ("2 of them go to your computer:
 * Uno R3, Powered USB hub"), else '': so nothing is sent off the rack without being said.
 */
export function toComputer(p: Project, add: Link[]): string {
  const to = add.filter((l) => l.a.module === PC || l.b.module === PC).map((l) => p.modules.find((m) => m.id === (l.a.module === PC ? l.b.module : l.a.module))).filter(Boolean) as Module[];
  if (!to.length) return '';
  const names = to.map((m) => shortName(m.board.name)), list = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  return `${to.length === 1 ? 'One goes' : `${to.length} of them go`} to your computer, off the rack (a 2 m cable each): ${list}.`;
}

/** What the rack still needs, with the accessory (a library template id) that would give it. */
export function wiringAdvice(p: Project): { text: string; add?: string; count?: number }[] {
  const b = portBudget(p), out: { text: string; add?: string; count?: number }[] = [];
  const ps = powerShort(p);
  // which boards, what they need, and what the free ports give (so a charger left idle beside them makes sense)
  const capOf = (x: PlugInfo) => portCap(x.module.board, x.comp, x.role);
  const best = Math.max(0, ...b.powerOuts.map(capOf));
  if (ps.add) {
    const n = ps.unserved.length, weak = ps.unserved.filter((w) => w.weak).length;
    const who = [...new Set(ps.unserved.map((w) => kindName(shortName(w.plug.module.board.name))))].join(', '), needs = Math.min(...ps.unserved.map((w) => minOf(w.need)));
    out.push({ text: `${n} board${n > 1 ? 's need' : ' needs'} power (${who}${weak ? `, ${weak} on a port too weak for ${weak > 1 ? 'them' : 'it'}` : ''}) and no free port gives enough: ${b.powerOuts.length ? `the free ones give ${best} A at most, ${n > 1 ? 'they need' : 'it needs'} ${needs} A or more` : 'every charger port is taken'}.`, add: ps.add.id, count: ps.add.count });
  }
  // a charger or supply that powers nothing: say why, so it isn't left there without a word (two of a kind, once)
  const idle = [...new Set(b.powerOuts.map((x) => x.module))].filter((m) => !(p.links ?? []).some((l) => l.kind === 'power' && (l.a.module === m.id || l.b.module === m.id)));
  const idleCap = (m: Module) => Math.max(...b.powerOuts.filter((x) => x.module === m).map(capOf));
  for (const g of groupBy(idle, (m) => `${kindName(m.board.name)}|${idleCap(m)}`)) {
    const k = g.length, cap = idleCap(g[0]);
    out.push({ text: `The ${times(shortName(k > 1 ? kindName(g[0].board.name) : g[0].board.name), k)} ${k > 1 ? 'power' : 'powers'} nothing: ${ps.unserved.length ? `${k > 1 ? 'their' : 'its'} ports give ${cap} A, less than the boards without power need` : 'every board has its power. Keep it for boards to come, or take it off the rack'}.` });
  }
  // a Pi 5 on a 3 A port runs, with its USB held back: its own 27 W supply gives it all
  const limited = b.limited.filter((f) => !ps.unserved.some((w) => w.plug === f.take));
  if (limited.length) out.push({ text: `${groupBy(limited, (f) => kindName(f.take.module.board.name)).map((g) => times(shortName(g.length > 1 ? kindName(g[0].take.module.board.name) : g[0].take.module.board.name), g.length)).join(', ')} ${limited.length > 1 ? 'run' : 'runs'} on ${limited.length > 1 ? '3 A ports' : `a ${limited[0].cap} A port`}, with ${limited.length > 1 ? 'their' : 'its'} USB ports held to 0.6 A between them: a 27 W (5 A) USB-C supply gives the full 1.6 A.`, add: 'psu_pi5', count: limited.length });
  if (b.devices.length > b.usbPorts.length) { const k = b.devices.length - b.usbPorts.length; const h = hubOffer(k); out.push({ text: `${k} USB plug${k > 1 ? 's have' : ' has'} no free port on the rack: Auto-connect plugs ${k > 1 ? 'them' : 'it'} into your computer, or add ${h.count > 1 ? `${h.count} hubs` : 'a hub'} (${h.count * h.ports} ports, ${h.count > 1 ? 'each uplink' : 'its uplink'} to a free port or your computer).`, add: h.id, count: h.count }); }
  const net = plugsOf(p).filter((x) => x.role === 'net' && !isAccessory(x.module.board) && !linkOf(p, x.ref));
  if (net.length >= 2 && !p.modules.some((m) => isSwitch(m.board))) out.push({ text: `${net.length} boards have Ethernet and there is no switch in the rack.`, add: 'net_switch8', count: 1 });
  out.push(...poeAdvice(p));
  for (const u of b.unwired) out.push({ text: `${times(u.name, u.count)}: ${u.count > 1 ? `the ${u.refs.join(', ')} on each` : `its ${u.refs.join(', ')}`} ${u.refs.length > 1 ? 'are' : 'is'} for wires you connect yourself (click a pin, then the pin it goes to).` });
  // an Arduino's DC jack (7 to 12 V) left with only packs that don't fit it: say so, and offer the one that does
  const spare = plugsOf(p).filter((x) => x.role === 'dc-out' && !linkOf(p, x.ref) && !x.module.board.box?.pack?.own);
  if (spare.length) {
    const wrong = plugsOf(p).filter((x) => isRangedJack(x) && !linkOf(p, x.ref) && !spare.some((s) => fitsJack(s, x))), r = wrong.length ? dcRange(wrong[0].module.board)! : null;
    if (wrong.length && r) {
      const volts = [...new Set(spare.map((s) => voltsOf(s)).filter((v) => v != null))].sort((x, y) => x! - y!);
      out.push({ text: `${[...new Set(wrong.map((x) => shortName(kindName(x.module.board.name))))].join(', ')}: the DC jack takes ${r.min} to ${r.max} V, and ${volts.length ? `the plug pack${spare.length > 1 ? 's' : ''} here ${spare.length > 1 ? 'give' : 'gives'} ${volts.join(' and ')} V` : "the plug pack here doesn't say its voltage"}. A ${r.usual} V pack is the usual pick.`, add: `dcpack:${r.usual}`, count: 1 });
    }
  }
  // a switch or powered hub with nothing on its DC input: the supply it came with goes on the rack (add: own:<box>, or
  // several ids for boxes of one kind)
  const bare = p.modules.filter((m) => {
    if (m.board.kind !== 'box' || isPlugPack(m.board)) return false;
    const dc = plugsOf(p).filter((x) => x.module === m && x.role === 'power-in-dc');
    return dc.length > 0 && !dc.some((x) => linkOf(p, x.ref));
  });
  for (const g of groupBy(bare, (m) => kindName(m.board.name))) {
    const k = g.length, nm = shortName(k > 1 ? kindName(g[0].board.name) : g[0].board.name);
    out.push({ text: `${times(nm, k)}: nothing on ${k > 1 ? 'their DC inputs' : 'its DC input'}. Add the ${k > 1 ? 'supplies they' : 'supply it'} came with: ${k > 1 ? 'they go' : 'it goes'} in a free outlet, ${k > 1 ? 'each lead' : 'its lead'} to the ${nm}.`, add: `own:${g.map((m) => m.id).join(',')}` });
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
 * What still needs a port: USB devices with no cable against free USB ports on the rack (hub ports and host ports),
 * boards that need power against free power outputs (charger ports), and power cables on a port too weak for their
 * board (weak) or enough to run but short of its peak (limited: a Pi 5 on 3 A).
 */
export function portBudget(p: Project) {
  const plugs = plugsOf(p);
  const taken = new Set((p.links ?? []).flatMap((l) => [`${l.a.module}/${l.a.ref}`, `${l.b.module}/${l.b.ref}`]));
  const free = (roles: PlugRole[]) => plugs.filter((x) => roles.includes(x.role) && !taken.has(`${x.ref.module}/${x.ref.ref}`));
  const devices = free(['device', 'hub-up']), usbPorts = free(['hub-down', 'host']);
  const poeFed = poeFedIds(p); // (a board on a PoE port needs no supply)
  const powerIns = free(['power-in']).filter((x) => !poeFed.has(x.module.id)), powerOuts = free(['power-out']);
  const feeds = powerFeeds(p);
  const weak = feeds.filter((f) => f.weak), limited = feeds.filter((f) => !f.weak && f.cap + 1e-6 < f.need.peak);
  // boards with wire terminals or jumper headers and not one of them connected (a relay board, a power distribution
  // board): Auto-connect does not guess wiring, so say which are left
  const unwired0 = p.modules.flatMap((m) => {
    const mine = plugs.filter((x) => x.module === m);
    // (a box's DC input is for its own supply, not wires: wiringAdvice says to add it)
    const wired = (x: PlugInfo) => x.role === 'wire' || (x.role === 'power-in-dc' && m.board.kind !== 'box');
    const w = mine.filter(wired);
    if (!w.length || mine.some((x) => taken.has(`${x.ref.module}/${x.ref.ref}`) && wired(x))) return [];
    if (w.length < mine.length && mine.some((x) => taken.has(`${x.ref.module}/${x.ref.ref}`))) return []; // a Pi with its GPIO free is fine
    const refs = w.map((x) => x.comp.ref);
    return [{ name: m.board.name, refs: refs.length > 4 ? [...refs.slice(0, 3), `${refs.length - 3} more`] : refs }];
  });
  // two boards of one kind ("Raspberry Pi 4B" and "Raspberry Pi 4B #2", the same pins) are one entry: count 2
  const unwired = groupBy(unwired0, (u) => `${kindName(u.name)}|${u.refs.join(',')}`).map((g) => ({ name: g.length > 1 ? kindName(g[0].name) : g[0].name, refs: g[0].refs, count: g.length }));
  return { devices, usbPorts, powerIns, powerOuts, weak, limited, unwired, short: Math.max(0, devices.length + Math.max(0, powerIns.length - powerOuts.length) - usbPorts.length) };
}

/**
 * Move boards on ports too weak for them (or powered through the hub they host, or a Pi 5 on 3 A where a 5 A port is
 * free) to stronger free ports: the new cables for the project, and how many moved, or null when none can. A cable
 * that moves keeps its number; a board with nowhere better keeps the cable it has.
 */
export function strongerPower(p: Project, at?: PlugAt): { links: Link[]; moved: number } | null {
  const under = powerFeeds(p).filter((f) => f.weak || f.cap + 1e-6 < f.need.peak);
  if (!under.length) return null;
  const ids = new Set(under.map((u) => u.link.id));
  const q: Project = { ...p, links: (p.links ?? []).filter((l) => !ids.has(l.id)) };
  const add = autoLinks(q, at).filter((l) => l.kind === 'power');
  const kept: Link[] = [], moved: Link[] = [];
  for (const u of under) {
    const nl = add.find((l) => sameRef(l.a, u.take.ref) || sameRef(l.b, u.take.ref));
    const o = nl && (sameRef(nl.a, u.take.ref) ? nl.b : nl.a);
    const om = o && p.modules.find((m) => m.id === o.module), oc = om?.board.comps.find((c) => c.ref === baseRef(o!.ref));
    const cap = om && oc ? portCap(om.board, oc, plugRole(om, oc)) : 0;
    if (nl && cap > u.cap + 1e-6) moved.push({ ...nl, no: u.link.no }); else kept.push(u.link);
  }
  if (!moved.length) return null;
  return { links: numberLinks([...(q.links ?? []), ...kept, ...moved]), moved: moved.length };
}


/** Every cable keeps the number it was given; cables without one get the next free numbers, in order. */
export function cableNumbers(links: Link[] = []): Map<string, number> {
  let n = Math.max(0, ...links.map((l) => l.no ?? 0));
  return new Map(links.map((l) => [l.id, l.no ?? ++n]));
}
/** The links with their numbers written in (so a printed tag keeps matching its cable after others change). */
export const numberLinks = (links: Link[] = []): Link[] => { const no = cableNumbers(links); return links.map((l) => (l.no ? l : { ...l, no: no.get(l.id)! })); };

/** A board's name without the "#2" that tells two of a kind apart ("Raspberry Pi 4B #2" -> "Raspberry Pi 4B"). */
export const kindName = (n: string) => n.replace(/ #\d+$/, '');
/** A name for `k` boards of one kind: "Raspberry Pi 4B ×2". */
export const times = (n: string, k: number) => (k > 1 ? `${n} ×${k}` : n);
/** The items in groups by `key`, each group in the order it first came up. */
function groupBy<T>(xs: T[], key: (x: T) => string): T[][] {
  const g = new Map<string, T[]>();
  for (const x of xs) g.set(key(x), [...(g.get(key(x)) ?? []), x]);
  return [...g.values()];
}

/** A board's name without its maker: "Raspberry Pi 4B" -> "Pi 4B", "Arduino Uno R3" -> "Uno R3". */
export const shortName = (n: string) => n.replace(/^(Raspberry|Arduino|Adafruit|SparkFun|Espressif|Seeed(?: Studio)?)\s+/i, '');

const SOURCE: PlugRole[] = ['mains-out', 'power-out', 'dc-out', 'hub-down', 'host'];
/** Which way a cable points: from the end that gives (power, a port, a probe's ribbon) to the end that takes. */
export function cableFlow(p: Project, l: Link): { from: PlugRef; to: PlugRef } {
  const role = (r: PlugRef) => { const m = findModule(p, r.module); const c = m?.board.comps.find((x) => x.ref === baseRef(r.ref)); return { role: m && c ? plugRole(m, c) : ('other' as PlugRole), box: !!m && isAccessory(m.board) }; };
  let a = { r: l.a, ...role(l.a) }, b = { r: l.b, ...role(l.b) };
  if (SOURCE.indexOf(b.role) >= 0 && SOURCE.indexOf(a.role) < 0) [a, b] = [b, a];
  if (a.role === 'hub-up' || (b.role === 'host' && a.role !== 'host')) [a, b] = [b, a];
  if ((a.role === 'debug' || a.role === 'uart') && b.box && !a.box) [a, b] = [b, a];
  return { from: a.r, to: b.r };
}

/** What a cable is for, from the plugs' roles, pointing from the end that gives (power, a port) to the end that takes. */
export function cablePurpose(p: Project, l: Link): { from: string; to: string; text: string } {
  const end = (r: PlugRef) => {
    const m = findModule(p, r.module);
    const c = m?.board.comps.find((x) => x.ref === baseRef(r.ref));
    return { name: m?.board.name ?? '?', ref: r.ref, role: m && c ? plugRole(m, c) : ('other' as PlugRole), box: !!m && isAccessory(m.board) };
  };
  let a = end(l.a), b = end(l.b);
  if (SOURCE.indexOf(b.role) >= 0 && SOURCE.indexOf(a.role) < 0) [a, b] = [b, a];
  if (a.role === 'hub-up' || (b.role === 'host' && a.role !== 'host')) [a, b] = [b, a];
  if (a.role === 'debug' && b.box && !a.box) [a, b] = [b, a]; // a debug ribbon goes from the probe to the board
  const kind = l.kind ?? 'usb';
  const what = kind === 'power' || a.role === 'power-out' ? 'Power' : a.role === 'hub-down' && b.role === 'hub-up' ? 'Hub link' : b.role === 'hub-up' ? 'Hub uplink' : KIND_NAME[kind].replace(/^./, (c) => c.toUpperCase());
  return { from: a.name, to: b.name, text: `${what}: ${shortName(a.name)} → ${shortName(b.name)}` };
}
