// Boxes (USB hubs, chargers, power supplies): a size and rows of ports on its faces. The outline, the height and a
// port part for every port are generated from that, and every port knows its role, so Auto-connect never has to
// guess whether a USB-A socket on a box takes a device or gives power.
import type { Board, BoxFace, BoxPortGroup, BoxSpec, Comp, ConnSetup, V2 } from './types';
import { connById, connSetup } from './library';
import { bbox, roundedRectLoop, round, uid } from '../geom/poly';

export const BOX_PORT_TYPES = ['usb_a', 'usb_c', 'usb_micro_b', 'usb_b', 'barrel', 'iec_c7', 'rj45', 'hdmi_a', 'audio35', 'terminal', 'jtag20', 'swd10', 'pins_ra', 'ac_au', 'ac_uk', 'ac_us', 'ac_eu', 'mains_lead'] as const;

export const BOX_ROLES: [string, string][] = [
  ['hub-down', 'hub port: a device plugs in'],
  ['hub-up', 'upstream: to a computer or board'],
  ['power-out', 'power out: charges a board'],
  ['power-in', 'power in: from a USB charger'],
  ['host', 'host: devices plug in (a computer port)'],
  ['device', 'device: goes to a hub or computer'],
  ['net', 'network'],
  ['debug', "debug: a ribbon to a board's debug header"],
  ['uart', "serial pins: jumper wires to a board's UART header"],
  ['mains-out', 'mains outlet: a charger\'s lead plugs in'],
  ['mains-in', 'mains in: a lead to an outlet (or the wall)'],
  ['dc-out', "DC out: a supply's DC lead to a board's DC input"],
  ['other', 'leaves the rack (supply, screen)'],
];

export const FACE_NAME: Record<BoxFace, string> = { front: 'Front', back: 'Back', left: 'Left end', right: 'Right end', top: 'Top' };
const ANGLE: Record<Exclude<BoxFace, 'top'>, number> = { front: -90, back: 90, left: 180, right: 0 };

const g = (type: string, count: number, face: BoxFace, role: string): BoxPortGroup => ({ id: uid('pg'), type, count, face, role });
const PACK = (what: string) => `A plug pack: it plugs straight into a powerboard's outlet (or the wall), so it stays off the rails, and its own lead goes to ${what}. Auto-connect plugs it in. Set its figures under Box to match the label on yours.`;
const POWERBOARD = "A powerboard: set its outlets (AU, UK, US or EU), how many, their angle and its size under Box. Auto-connect plugs the chargers' mains leads into it; its own lead goes to the wall. Never plug one powerboard into another.";

/** A small part standing on a bare board (a probe's chip, an LED): for the look of it, in 2D and 3D. */
const dp = (ref: string, pkg: string, x: number, y: number, w: number, l: number, h: number, kind: Comp['kind'] = 'generic', value?: string): Comp =>
  ({ id: uid('c'), ref, pkg, ...(value ? { value } : {}), side: 'top', x, y, rot: 0, w, l, h, kind, tht: false });

export const BOX_PRESETS: Record<string, { name: string; color: string; spec: () => BoxSpec; note?: string; parts?: () => Comp[] }> = {
  hub4: { name: 'USB hub', color: '#2b2f36', spec: () => ({ l: 100, w: 30, h: 22, groups: [g('usb_a', 4, 'front', 'hub-down'), g('usb_micro_b', 1, 'left', 'hub-up')] }) },
  hub7: { name: 'Powered USB hub', color: '#2b2f36', spec: () => ({ l: 160, w: 48, h: 24, groups: [g('usb_a', 7, 'top', 'hub-down'), g('usb_c', 1, 'left', 'hub-up'), g('barrel', 1, 'right', 'other')] }) },
  hubc: { name: 'USB-C hub', color: '#3a3f47', spec: () => ({ l: 110, w: 32, h: 14, groups: [g('usb_a', 3, 'front', 'hub-down'), g('usb_c', 1, 'front', 'hub-down'), g('usb_c', 1, 'left', 'hub-up'), g('rj45', 1, 'right', 'net')] }) },
  charger4: { name: 'USB charger', color: '#e9e7e2', spec: () => ({ l: 90, w: 60, h: 28, groups: [g('usb_a', 4, 'back', 'power-out'), g('iec_c7', 1, 'front', 'mains-in')] }) },
  charger6: { name: 'USB charger (A + C)', color: '#e9e7e2', spec: () => ({ l: 110, w: 70, h: 30, groups: [g('usb_a', 4, 'back', 'power-out'), g('usb_c', 2, 'back', 'power-out'), g('iec_c7', 1, 'front', 'mains-in')] }) },
  // a desktop network switch: its Ethernet ports along the front, its power in at the back
  switch8: { name: 'Network switch, 8 ports', color: '#2b2f36', spec: () => ({ l: 158, w: 100, h: 27, groups: [g('rj45', 8, 'front', 'net'), g('barrel', 1, 'back', 'other')] }), note: "A network switch: every board's Ethernet goes to one of its ports (Auto-connect does it), its own power supply plugs in at the back. Set its size and ports under Box to match yours." },
  switch5: { name: 'Network switch, 5 ports', color: '#2b2f36', spec: () => ({ l: 100, w: 70, h: 25, groups: [g('rj45', 5, 'front', 'net'), g('barrel', 1, 'back', 'other')] }), note: "A network switch: every board's Ethernet goes to one of its ports (Auto-connect does it), its own power supply plugs in at the back. Set its size and ports under Box to match yours." },
  // plug packs: a supply that plugs straight into an outlet, its own lead ending in its output plug. The Raspberry Pi
  // 27 W supply gives 5 A over USB-C PD (a Pi 5's full USB), the 15 W one 3 A; sizes and leads are typical, not measured
  psu_pi5: { name: 'USB-C supply, 27 W (5 A)', color: '#f4f3ef', spec: () => ({ l: 62, w: 50, h: 32, supply: 5, pack: { lead: 1200 }, groups: [{ ...g('usb_c', 1, 'right', 'power-out'), amps: 5 }, g('mains_lead', 1, 'left', 'mains-in')] }), note: PACK('a Pi 5 (5 A over USB-C PD, so its USB ports give their full 1.6 A)') },
  psu_pi4: { name: 'USB-C supply, 15 W (3 A)', color: '#f4f3ef', spec: () => ({ l: 55, w: 45, h: 28, supply: 3, pack: { lead: 1500 }, groups: [{ ...g('usb_c', 1, 'right', 'power-out'), amps: 3 }, g('mains_lead', 1, 'left', 'mains-in')] }), note: PACK('a Pi 4 (3 A over USB-C)') },
  dc_pack_12v: { name: 'DC plug pack, 12 V 2 A', color: '#2b2f36', spec: () => ({ l: 70, w: 45, h: 35, pack: { lead: 1500 }, groups: [{ ...g('barrel', 1, 'right', 'dc-out'), amps: 2, volts: 12 }, g('mains_lead', 1, 'left', 'mains-in')] }), note: PACK("a board's 12 V DC input (a barrel plug, 5.5 × 2.1 mm on most). BoardDock can't check voltages or polarity: check both labels match before you plug it in") },
  // powerboards (power strips): outlets along the top, spread evenly, their own lead out of one end
  pb4: { name: 'Powerboard, 4 outlets', color: '#f1f0eb', spec: () => ({ l: 290, w: 58, h: 40, groups: [g('ac_au', 4, 'top', 'mains-out'), g('mains_lead', 1, 'left', 'mains-in')] }), note: POWERBOARD },
  pb6: { name: 'Powerboard, 6 outlets', color: '#f1f0eb', spec: () => ({ l: 420, w: 58, h: 40, groups: [g('ac_au', 6, 'top', 'mains-out'), g('mains_lead', 1, 'left', 'mains-in')] }), note: POWERBOARD },
  pb4sw: { name: 'Powerboard, 4 switched outlets', color: '#f1f0eb', spec: () => ({ l: 330, w: 62, h: 42, groups: [{ ...g('ac_au', 4, 'top', 'mains-out'), switched: true }, g('mains_lead', 1, 'left', 'mains-in')] }), note: POWERBOARD },
  pb4ang: { name: 'Powerboard, 4 angled outlets', color: '#f1f0eb', spec: () => ({ l: 300, w: 66, h: 40, groups: [{ ...g('ac_au', 4, 'top', 'mains-out'), rot: 45 }, g('mains_lead', 1, 'left', 'mains-in')] }), note: POWERBOARD },
  pb4usb: { name: 'Powerboard, 4 outlets + USB', color: '#f1f0eb', spec: () => ({ l: 330, w: 58, h: 40, supply: 3.4, groups: [g('ac_au', 4, 'top', 'mains-out'), g('usb_a', 2, 'front', 'power-out'), g('mains_lead', 1, 'left', 'mains-in')] }), note: POWERBOARD },
  // a debug probe: a slim board about 5 cm square and 3 mm thick, the 10-pin ribbon socket on its top face by one
  // edge and the micro-USB on the edge opposite
  // a USB to TTL serial adapter (the red FT232RL board): mini-USB at one end, six right-angle pins at the other
  ftdi: { name: 'USB-serial adapter', color: '#c8201e', spec: () => ({ l: 36, w: 18, h: 1.6, groups: [{ ...g('pins_ra', 1, 'left', 'uart'), pins: ['DTR', 'RXD', 'TXD', 'VCC', 'CTS', 'GND'] }, g('usb_mini_b', 1, 'right', 'device')] }),
    // the FT232RL itself, its TX and RX LEDs, the 3.3 / 5 V solder jumper, the passives round them
    parts: () => [dp('U1', 'SSOP-28_5.3x10.2mm_P0.65mm', 17, 9, 10.2, 7.8, 1.6, 'generic', 'FT232RL'), dp('D1', 'LED_0805', 29, 3.2, 2, 1.25, 0.8, 'led', 'TX'), dp('D2', 'LED_0805', 29, 14.8, 2, 1.25, 0.8, 'led', 'RX'),
      dp('JP1', 'SolderJumper-3_3V3_5V', 7.2, 9, 1.6, 4.2, 0.1, 'generic', '3V3/5V'), dp('R1', 'R_0603', 8, 3.4, 1.6, 0.8, 0.5), dp('R2', 'R_0603', 8, 14.6, 1.6, 0.8, 0.5), dp('C1', 'C_0603', 23.5, 3.4, 1.6, 0.8, 0.8), dp('C2', 'C_0603', 23.5, 14.6, 1.6, 0.8, 0.8), dp('C3', 'C_0805', 12, 14.6, 2, 1.25, 1)],
    note: "A USB to TTL serial adapter (FT232RL): it slides into a slot behind its board, like a J-Link; jumper wires go from its pins to the board's UART header (GND to GND, its TXD to the board's RX, its RXD to the board's TX), its USB to a hub. Set its size, pins and their names under Box to match yours." },
  jlink: { name: 'J-Link', color: '#9c2b25', spec: () => ({ l: 50, w: 50, h: 3, ribbon: 200, groups: [{ ...g('swd10', 1, 'top', 'debug'), near: 'front' }, g('usb_micro_b', 1, 'back', 'device')] }),
    // its microcontroller and crystal, the regulator, the power and activity LEDs, the passives
    parts: () => [dp('U1', 'LQFP-64_10x10mm_P0.5mm', 25, 27, 12, 12, 1.6, 'generic', 'MCU'), dp('Y1', 'Crystal_SMD_3225', 36, 27, 3.2, 2.5, 0.8), dp('U2', 'SOT-223', 12, 38, 6.5, 7, 1.8, 'generic', 'LDO'),
      dp('D1', 'LED_0805', 19, 44, 2, 1.25, 0.8, 'led', 'PWR'), dp('D2', 'LED_0805', 31, 44, 2, 1.25, 0.8, 'led', 'ACT'), dp('R1', 'R_0603', 15, 18, 1.6, 0.8, 0.5), dp('R2', 'R_0603', 35, 18, 1.6, 0.8, 0.5),
      dp('C1', 'C_0603', 15, 34, 1.6, 0.8, 0.8), dp('C2', 'C_0603', 36, 33, 1.6, 0.8, 0.8), dp('C3', 'C_0805', 40, 40, 2, 1.25, 1), dp('R3', 'R_0603', 25, 40, 1.6, 0.8, 0.5)],
    note: "A debug probe: it slides down into a slot in the back of its board's dock, USB end up; its ribbon goes up over the dock to the board's debug header, its USB to a hub. Set its size, thickness (Height), ports and ribbon length under Box to match yours." },
};

/** A bare board rather than a box: a probe or an adapter a few mm thick, its ports standing on it. */
export const isBare = (s: BoxSpec) => s.h < 5;

/** Round ports look the same any way up: they have no turn to set. */
const ROUND = new Set(['barrel', 'audio35', 'mains_lead']);
/** Whether a port of this type on this face of this box can be turned in its face (upright, upside down). */
export const canTurn = (s: BoxSpec, g: Pick<BoxPortGroup, 'type' | 'face'>) => !isBare(s) && g.face !== 'top' && g.type !== 'pins_ra' && !ROUND.has(g.type) && !g.type.startsWith('ac_');
/** How a side port is turned in its face (0 when it can't be). */
export const turnOf = (s: BoxSpec, g: BoxPortGroup) => (canTurn(s, g) ? g.turn ?? 0 : 0);
const upright = (s: BoxSpec, g: BoxPortGroup) => turnOf(s, g) % 180 !== 0;

/** Length of a face and the ports' spacing on it. */
export const faceLen = (s: BoxSpec, f: BoxFace) => (f === 'left' || f === 'right' ? s.w : s.l);
/** How much of its face a port takes along it: its width, or its height when it stands on its side. */
export const portWidth = (type: string, g?: BoxPortGroup, s?: BoxSpec) => (type === 'pins_ra' ? (g?.pins?.length ?? 6) * 2.54 : s && g && upright(s, g) ? connById(type).body.h : connById(type).body.w);
/** How tall a port in a side face is: its height, or its width when it stands on its side. */
export const portHeight = (s: BoxSpec, g: BoxPortGroup) => (upright(s, g) ? connById(g.type).body.w : connById(g.type).body.h);
/** Height of a side port's centre above the bottom of the box. */
export const portUp = (s: BoxSpec, g: BoxPortGroup) => g.up ?? s.h / 2;
/** A top row's centre across the box, mm from the front edge. */
export const topAcross = (s: BoxSpec, g: BoxPortGroup, i = 0) => {
  const o = g.off?.[i];
  if (o != null && Number.isFinite(o)) return o;
  if (g.across != null) return g.across;
  const t = connById(g.type);
  return g.near === 'front' ? 3 + t.body.l / 2 : g.near === 'back' ? s.w - 3 - t.body.l / 2 : s.w / 2;
};
/** Whether a group is laid out by itself (centred with the face's other such rows) or placed from an end. */
const placed = (g: BoxPortGroup) => g.from != null;

export type PortAt = { group: BoxPortGroup; i: number; along: number; row: number };

/**
 * Port positions along each face. Rows laid out by themselves go side by side, centred, 5 mm between ports (less if
 * they don't fit; mains outlets spread along the whole face), as they always have. A row placed from an end starts
 * that far from it. A row's own spacing (pitch) replaces the 5 mm, and a port with a position of its own (dragged in
 * the editor, or typed) is exactly there; the ports after it follow at the row's spacing.
 */
export function layoutPorts(s: BoxSpec): PortAt[] {
  const out: PortAt[] = [];
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    if (!gs.length) continue;
    const L = faceLen(s, face);
    const natural = new Map<BoxPortGroup, number[]>(); // each port's centre before its own position is applied
    const step = new Map<BoxPortGroup, number>(); // centre to centre
    // the rows laid out by themselves
    const auto = gs.filter((x) => !placed(x));
    if (auto.length) {
      const inner = (x: BoxPortGroup, gap: number) => (x.pitch != null ? x.pitch - portWidth(x.type, x, s) : gap);
      const span = (gap: number, between: number) => auto.reduce((a, x) => a + x.count * portWidth(x.type, x, s) + (x.count - 1) * inner(x, gap), 0) + (auto.length - 1) * between;
      let gap = 5, between = 9;
      if (span(gap, between) > L - 6) { gap = 1.5; between = 3; }
      // mains outlets spread evenly along the whole face, room for a plug pack on each
      const spread = auto.every((x) => x.type.startsWith('ac_') && x.pitch == null);
      if (spread) { const n = auto.reduce((a, x) => a + x.count, 0), w = auto.reduce((a, x) => a + x.count * portWidth(x.type, x, s), 0); gap = between = Math.max(1.5, (L - 20 - w) / Math.max(1, n)); }
      let at = spread ? 10 + gap / 2 : (L - span(gap, between)) / 2;
      for (const x of auto) {
        const w = portWidth(x.type, x, s), g2 = inner(x, gap), list: number[] = [];
        for (let i = 0; i < x.count; i++) {
          list.push(at + w / 2);
          at += w + (i < x.count - 1 ? g2 : between);
        }
        natural.set(x, list);
        step.set(x, w + g2);
      }
    }
    // rows measured from an end of the face
    for (const x of gs.filter(placed)) {
      const w = portWidth(x.type, x, s), st = x.pitch ?? w + 5, run = (x.count - 1) * st + w;
      const first = x.from === 'end' ? L - (x.edge ?? 0) - run + w / 2 : (x.edge ?? 0) + w / 2;
      natural.set(x, Array.from({ length: x.count }, (_, i) => first + i * st));
      step.set(x, st);
    }
    for (const x of gs) {
      const nat = natural.get(x)!, st = step.get(x)!;
      let prev = NaN;
      for (let i = 0; i < x.count; i++) {
        const own = x.at?.[i];
        // a port with a position of its own is there; one after it (without) follows at the row's spacing
        const along = own != null && Number.isFinite(own) ? own : i > 0 && x.at?.some((v, k) => k < i && v != null && Number.isFinite(v)) ? prev + st : nat[i];
        out.push({ group: x, i, along, row: 0 });
        prev = along;
      }
    }
  }
  return out;
}

/** Faces whose ports need more room than the face has, and which size of the box would give it to them. */
export function tightFaces(s: BoxSpec): { face: BoxFace; need: number; have: number; dim: 'l' | 'w' }[] {
  return (Object.keys(FACE_NAME) as BoxFace[]).flatMap((face) => {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    // a bare board's header can run nearly edge to edge; a box's ports want a margin
    const bare = isBare(s), need = Math.ceil(gs.reduce((a, x) => a + x.count * (portWidth(x.type, x, s) + (bare ? 0 : 1.5)), 0) + (bare ? 1 : 3));
    return gs.length && need > faceLen(s, face) ? [{ face, need, have: faceLen(s, face), dim: face === 'left' || face === 'right' ? 'w' as const : 'l' as const }] : [];
  });
}

/** Ports that don't fit on their face, run past its ends, overlap, or stick out above or below the box. */
export function boxProblems(s: BoxSpec): string[] {
  const out: string[] = tightFaces(s).map((t) => `${FACE_NAME[t.face]}: the ports need about ${t.need} mm, the face is ${t.have} mm.`);
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    if (face === 'top' || isBare(s) || !gs.length) continue;
    // a slim probe's connectors stand proud of it, as on a bare board
    const tall = gs.reduce((a, x) => (portHeight(s, x) > portHeight(s, a) ? x : a));
    if (portHeight(s, tall) > s.h - 1) out.push(`${FACE_NAME[face]}: a ${connById(tall.type).name}${upright(s, tall) ? ' on its side' : ''} is taller than the box.`);
    else for (const x of gs) {
      const u = portUp(s, x), hh = portHeight(s, x) / 2;
      if (u - hh < -0.01 || u + hh > s.h + 0.01) out.push(`${FACE_NAME[face]}: the ${connById(x.type).name} ports ${u - hh < 0 ? 'go below the bottom' : 'stick out above the top'} of the box: set their height up the side between ${round(hh, 1)} and ${round(s.h - hh, 1)} mm.`);
    }
  }
  // only when the automatic layout isn't already reported as too tight: ports that run off the face or overlap
  const tight = new Set(tightFaces(s).map((t) => t.face));
  const lay = layoutPorts(s), name = (q: PortAt) => q.group.refs?.[q.i] ?? `${connById(q.group.type).name} ${q.i + 1}`;
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    if (tight.has(face)) continue;
    const L = faceLen(s, face), ps = lay.filter((q) => q.group.face === face);
    const half = (q: PortAt) => portWidth(q.group.type, q.group, s) / 2;
    for (const q of ps) if (q.along - half(q) < -0.01 || q.along + half(q) > L + 0.01) out.push(`${FACE_NAME[face]}: ${name(q)} runs past the ${q.along - half(q) < 0 ? (face === 'left' || face === 'right' ? 'front' : 'left end') : face === 'left' || face === 'right' ? 'back' : 'right end'}.`);
    for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
      const p = ps[a], q = ps[b];
      const apart = Math.abs(p.along - q.along) < half(p) + half(q) - 0.05;
      // top rows can also sit one behind the other
      const tA = connById(p.group.type).body.l / 2, tB = connById(q.group.type).body.l / 2;
      const behind = face === 'top' && Math.abs(topAcross(s, p.group, p.i) - topAcross(s, q.group, q.i)) >= tA + tB - 0.05;
      if (apart && !behind) { out.push(`${FACE_NAME[face]}: ${name(p)} and ${name(q)} overlap: move them apart or make the spacing bigger.`); break; }
    }
  }
  return [...new Set(out)];
}

const PREFIX: Record<string, string> = { 'hub-down': 'P', 'hub-up': 'UP', 'power-out': 'OUT', 'power-in': 'PWR', host: 'USB', device: 'USB', net: 'LAN', debug: 'DBG', uart: 'SER', 'mains-out': 'AC', 'mains-in': 'MAINS' };
const prefixOf = (x: BoxPortGroup) => PREFIX[x.role] ?? (x.type === 'iec_c7' ? 'AC' : x.type === 'barrel' ? 'DC' : x.type === 'rj45' ? 'LAN' : 'J');

/**
 * Give every port a name that sticks to its group: a group keeps its names as ports are added to it or taken away,
 * and new ports take the next free number, so cables plugged into other groups stay where they are. A spec with no
 * names yet (older projects) is numbered in layout order, as it always was.
 */
export function nameBoxPorts(s: BoxSpec) {
  const lay = layoutPorts(s);
  if (s.groups.every((g) => !g.refs)) {
    const count = new Map<string, number>(), total = new Map<string, number>();
    for (const x of s.groups) total.set(prefixOf(x), (total.get(prefixOf(x)) ?? 0) + x.count);
    for (const g of s.groups) g.refs = [];
    for (const { group } of lay) {
      const pre = prefixOf(group), n = (count.get(pre) ?? 0) + 1;
      count.set(pre, n);
      group.refs!.push(total.get(pre)! > 1 ? `${pre}${n}` : pre);
    }
    return;
  }
  const used = new Set<string>();
  for (const g of s.groups) { g.refs = (g.refs ?? []).slice(0, Math.max(0, g.count)); for (const r of g.refs) used.add(r); }
  for (const g of s.groups) {
    const pre = prefixOf(g), alone = g.count === 1 && !s.groups.some((x) => x !== g && prefixOf(x) === pre);
    while (g.refs!.length < g.count) {
      let r = alone && !used.has(pre) ? pre : '';
      for (let n = 1; !r; n++) if (!used.has(`${pre}${n}`)) r = `${pre}${n}`;
      used.add(r);
      g.refs!.push(r);
    }
  }
}

/** The port parts of a box (in board coordinates: x along its length, y across, the box standing on z = 0). */
export function boxPorts(s: BoxSpec): Comp[] {
  nameBoxPorts(s);
  return layoutPorts(s).map(({ group, i, along }) => {
    const ref = group.refs![i];
    const t = connById(group.type);
    if (group.face === 'top') {
      // across the middle, by one long edge (a probe's ribbon socket) or where it was put; a probe's header stands on
      // it, a box's port is flush
      const y = topAcross(s, group, i);
      return { id: uid('c'), ref, pkg: t.name, side: 'top', x: along, y, rot: group.rot ?? 0, w: t.body.w, l: t.body.l, h: group.role === 'debug' ? t.body.h : 0.2, kind: 'connector', tht: false, role: group.role, ...(group.switched ? { value: 'switched' } : {}),
        conn: { ...connSetup(t, 0), entry: 'top', zc: 0, cradle: false, cap: false, guard: false, tie: false } } as Comp;
    }
    const angle = ANGLE[group.face], horizontal = group.face === 'left' || group.face === 'right';
    const edge = group.face === 'front' ? 0 : group.face === 'back' ? s.w : group.face === 'left' ? 0 : s.l;
    const out = angle === 0 || angle === 90 ? 1 : -1;
    const c = edge - out * (t.body.l / 2);
    // on a bare board (a probe, an adapter: a few mm thick) a port stands on its top face at the edge; on a box it is
    // in its side, halfway up unless it was set higher or lower, and turned in its face if it was (a USB-A on its side)
    const bare = isBare(s), bw = portWidth(group.type, group, s), turn = turnOf(s, group);
    const conn: ConnSetup = { ...connSetup(t, angle), entry: 'edge' as const, zc: bare ? t.zc : portUp(s, group) - s.h, cradle: false, cap: false, guard: false, tie: false };
    if (turn) {
      conn.roll = turn;
      // the plug's size as it sits: across the face and up it
      if (turn % 180) conn.plug = { ...conn.plug, w: t.plug.h, h: t.plug.w };
    }
    const comp = { id: uid('c'), ref, pkg: t.name, side: 'top', x: horizontal ? c : along, y: horizontal ? along : c, rot: 0,
      w: horizontal ? 2 : bw, l: horizontal ? bw : 2, h: bare ? t.body.h : 0.2, kind: 'connector', tht: false, role: group.role, conn } as Comp;
    if (group.pins?.length) {
      // pin 1 at the left of the row, looking at the face from outside; each pin where it leaves the edge
      const d = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)], wv = [-d[1], d[0]], n = group.pins.length;
      comp.pins = group.pins.map((net, i) => { const a = (i - (n - 1) / 2) * -2.54; return { n: String(i + 1), x: comp.x + d[0] * (t.body.l / 2) + wv[0] * a, y: comp.y + d[1] * (t.body.l / 2) + wv[1] * a, net }; });
    }
    return comp;
  });
}

/** A box's outline seen from above: its corners rounded (or cut straight across) by its corner size. */
export function boxOutline(s: BoxSpec): V2[] {
  const r = Math.max(0, Math.min(s.corner ?? Math.min(4, s.w / 6), Math.min(s.l, s.w) / 2 - 0.05));
  if (s.chamfer && r > 0) return [[r, 0], [s.l - r, 0], [s.l, r], [s.l, s.w - r], [s.l - r, s.w], [r, s.w], [0, s.w - r], [0, r]];
  return roundedRectLoop(s.l, s.w, r, 6).map(([x, y]) => [x + s.l / 2, y + s.w / 2] as V2);
}

/** Apply a box spec to a board: outline, height and ports (keeping the ports' refs, and their ids, so cables and dimensions stay put). */
export function applyBox(b: Board, s: BoxSpec) {
  b.kind = 'box';
  b.box = s;
  b.thickness = s.h;
  b.outline = boxOutline(s);
  b.holes = [];
  const old = new Map(b.comps.filter((c) => c.conn).map((c) => [c.ref, c.id]));
  b.comps = [...b.comps.filter((c) => !c.conn), ...boxPorts(s).map((c) => (old.has(c.ref) ? { ...c, id: old.get(c.ref)! } : c))];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Every port on a face gets the position it has now, so moving one of them leaves the others where they are. */
function pinFace(s: BoxSpec, face: BoxFace, lay: PortAt[]) {
  for (const g of s.groups.filter((x) => x.face === face)) {
    const mine = lay.filter((q) => q.group.id === g.id).sort((a, b) => a.i - b.i);
    g.at = mine.map((q) => r2(q.along));
    if (face === 'top') g.off = mine.map((q) => r2(topAcross(s, q.group, q.i)));
  }
}

/**
 * What was done to a box in the board editor, written back into its spec so the next layout keeps it: a port
 * dragged (or nudged, or moved by a dimension) stays where it was put, on its face; a side port dragged over to
 * another side goes onto that side; a port deleted is taken off its row; a plug put on it from the toolbox becomes a
 * port of its own; a width or length set with a dimension between two edges becomes the box's size. Then the box is
 * laid out again. False when there was nothing to keep.
 */
export function boxFromEdits(b: Board): boolean {
  if (b.kind !== 'box' || !b.box) return false;
  const s0 = b.box, s = structuredClone(s0);
  const bb = bbox(b.outline), L = r2(bb.x1 - bb.x0), W = r2(bb.y1 - bb.y0);
  let changed = false;
  if (Math.abs(L - s.l) > 0.005 || Math.abs(W - s.w) > 0.005) { s.l = L; s.w = W; changed = true; }
  // where every port was put by the last layout, and where it is now
  const was = new Map(boxPorts(structuredClone(s0)).map((c) => [c.ref, c]));
  const now = new Map(b.comps.filter((c) => c.conn).map((c) => [c.ref, c]));
  const lay = layoutPorts(s0).map((q) => ({ ...q, group: s.groups.find((g) => g.id === q.group.id)! }));
  const pinned = new Set<BoxFace>();
  const pin = (f: BoxFace) => { if (!pinned.has(f)) { pinFace(s, f, lay); pinned.add(f); } };
  const take = (g: BoxPortGroup, ref: string) => {
    const i = g.refs!.indexOf(ref);
    g.refs!.splice(i, 1); g.at?.splice(i, 1); g.off?.splice(i, 1);
    g.count--;
  };
  for (const g0 of s0.groups) for (const ref of g0.refs ?? []) {
    const c = now.get(ref), w0 = was.get(ref), g = s.groups.find((x) => x.id === g0.id)!;
    if (!w0) continue;
    if (!c) { pin(g.face); take(g, ref); changed = true; continue; }
    // a top port turned in the editor (R) turns its row
    const deg = (v: number) => ((Math.round(v * 100) / 100) % 360 + 360) % 360;
    if (g.face === 'top' && deg(c.rot) !== deg(w0.rot)) { g.rot = deg(c.rot) || undefined; changed = true; }
    if (Math.abs(c.x - w0.x) < 0.005 && Math.abs(c.y - w0.y) < 0.005) continue;
    changed = true;
    const i = g.refs!.indexOf(ref), half = portWidth(g.type, g, s) / 2;
    const clampAlong = (v: number, face: BoxFace) => r2(Math.min(Math.max(v, half), faceLen(s, face) - half));
    if (g.face === 'top') {
      pin('top');
      const l2 = connById(g.type).body.l / 2;
      g.at![i] = clampAlong(c.x, 'top');
      g.off![i] = r2(Math.min(Math.max(c.y, l2), s.w - l2));
      continue;
    }
    // the side it is nearest now: dragged well away from its own side and over to another, it goes there
    const dist: Record<Exclude<BoxFace, 'top'>, number> = { front: Math.abs(c.y), back: Math.abs(s.w - c.y), left: Math.abs(c.x), right: Math.abs(s.l - c.x) };
    const near = (Object.keys(dist) as Exclude<BoxFace, 'top'>[]).reduce((a, f) => (dist[f] < dist[a] ? f : a), g.face as Exclude<BoxFace, 'top'>);
    const along = (f: BoxFace) => (f === 'left' || f === 'right' ? c.y : c.x);
    pin(g.face);
    if (near !== g.face && dist[g.face as Exclude<BoxFace, 'top'>] > 3) {
      pin(near);
      take(g, ref);
      const { id: _id, refs: _r, at: _a, off: _o, from: _f, edge: _e, count: _c, ...rest } = g;
      s.groups.push({ ...rest, id: uid('pg'), face: near, count: 1, refs: [ref], at: [clampAlong(along(near), near)] });
    } else g.at![i] = clampAlong(along(g.face), g.face);
  }
  // a plug put on the box from the toolbox becomes a port of its own, on the face it was put on
  const known = new Set(s0.groups.flatMap((g) => g.refs ?? []));
  for (const c of b.comps) {
    if (!c.conn || c.hidden || known.has(c.ref)) continue;
    const a = ((Math.round(c.conn.angle) % 360) + 360) % 360;
    const face: BoxFace = c.conn.entry === 'top' ? 'top' : a === 0 ? 'right' : a === 90 ? 'back' : a === 180 ? 'left' : 'front';
    const type = c.conn.type, role = c.role ?? s.groups.find((g) => g.type === type)?.role ?? (type.startsWith('usb') ? 'hub-down' : 'other');
    const half = portWidth(type) / 2, along = (face === 'left' || face === 'right' ? c.y : c.x);
    pin(face);
    s.groups.push({ id: uid('pg'), type, count: 1, face, role, refs: [c.ref], at: [r2(Math.min(Math.max(along, half), faceLen(s, face) - half))], ...(face === 'top' ? { off: [r2(Math.min(Math.max(c.y, 0), s.w))] } : {}) });
    changed = true;
  }
  if (!changed) return false;
  s.groups = s.groups.filter((g) => g.count > 0 || !s0.groups.some((x) => x.id === g.id && x.count > 0));
  const holes = b.holes; // (laying a box out clears holes; an edit elsewhere shouldn't)
  applyBox(b, s);
  b.holes = holes;
  return true;
}

export function makeBox(preset: keyof typeof BOX_PRESETS, name?: string): Board {
  const P = BOX_PRESETS[preset];
  const b: Board = { name: name ?? P.name, outline: [], cutouts: [], thickness: 1, holes: [], comps: [], source: 'box', notes: [P.note ?? 'A box: set its size and ports under Box to match yours. Every port knows what it is for, so Auto-connect wires it right.'], kind: 'box', color: P.color };
  applyBox(b, P.spec());
  b.comps.push(...(P.parts?.() ?? []));
  return b;
}

/** What you can build a box from scratch as, and what each starts with (a typical port or two, to change). */
export const BOX_KINDS: Record<'hub' | 'charger' | 'supply' | 'probe' | 'adapter', { name: string; what: string; color: string; size: [number, number, number]; groups: () => BoxPortGroup[] }> = {
  hub: { name: 'USB hub', what: 'a hub: devices plug into it, it goes to a computer or a board', color: '#2b2f36', size: [100, 30, 22], groups: () => [g('usb_a', 4, 'front', 'hub-down'), g('usb_c', 1, 'left', 'hub-up')] },
  charger: { name: 'USB charger', what: 'a charger: it powers boards over USB, its mains lead goes to an outlet', color: '#e9e7e2', size: [90, 60, 28], groups: () => [g('usb_a', 2, 'back', 'power-out'), g('iec_c7', 1, 'front', 'mains-in')] },
  supply: { name: 'Power supply', what: 'a power supply: mains in, power out to a board', color: '#3a3f47', size: [80, 50, 30], groups: () => [g('usb_c', 1, 'right', 'power-out'), g('mains_lead', 1, 'left', 'mains-in')] },
  probe: { name: 'Debug probe', what: "a debug probe: a slim board, a ribbon to a board's debug header, USB to a hub", color: '#9c2b25', size: [50, 50, 3], groups: () => [{ ...g('swd10', 1, 'top', 'debug'), near: 'front' }, g('usb_micro_b', 1, 'back', 'device')] },
  adapter: { name: 'USB-serial adapter', what: "an adapter: jumper wires to a board's UART header, USB to a hub", color: '#c8201e', size: [36, 18, 1.6], groups: () => [{ ...g('pins_ra', 1, 'left', 'uart'), pins: ['GND', 'CTS', 'VCC', 'TXD', 'RXD', 'DTR'] }, g('usb_mini_b', 1, 'right', 'device')] },
};

/** A box built from scratch: a kind, a size (length, width, height) and a name; its ports are set under Box after. */
export function newBox(kind: keyof typeof BOX_KINDS, o: { l?: number; w?: number; h?: number; name?: string; color?: string } = {}): Board {
  const K = BOX_KINDS[kind];
  const low = K.name.startsWith('USB') ? K.name : K.name[0].toLowerCase() + K.name.slice(1);
  const b: Board = { name: o.name?.trim() || `My ${low}`, outline: [], cutouts: [], thickness: 1, holes: [], comps: [], source: 'built by hand', kind: 'box', color: o.color ?? K.color,
    notes: [`Built from scratch as a ${low}: measure yours and set its size and ports under Box, or drag a port in the editor to where it really is.`] };
  applyBox(b, { l: o.l ?? K.size[0], w: o.w ?? K.size[1], h: o.h ?? K.size[2], groups: K.groups(), ...(kind === 'probe' ? { ribbon: 200 } : {}) });
  return b;
}

/** Best guess of the spec of an older box that has only port parts: grouped by face, type and role. */
export function inferBox(b: Board, role: (c: Comp) => string): BoxSpec {
  const xs = b.outline.map((p) => p[0]), ys = b.outline.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const groups: BoxPortGroup[] = [];
  for (const c of b.comps) {
    if (!c.conn || c.hidden) continue;
    const a = ((c.conn.angle % 360) + 360) % 360;
    const face: BoxFace = c.conn.entry === 'top' ? 'top' : a === 0 ? 'right' : a === 90 ? 'back' : a === 180 ? 'left' : 'front';
    const r = c.role ?? role(c);
    const same = groups.find((x) => x.face === face && x.type === c.conn!.type && x.role === r);
    if (same) { same.count++; same.refs!.push(c.ref); } else groups.push({ id: uid('pg'), type: c.conn.type, count: 1, face, role: r, refs: [c.ref] });
  }
  return { l: Math.round(x1 - x0), w: Math.round(y1 - y0), h: b.thickness, groups };
}
