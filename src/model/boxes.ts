// Boxes (USB hubs, chargers, power supplies): a size and rows of ports on its faces. The outline, the height and a
// port part for every port are generated from that, and every port knows its role, so Auto-connect never has to
// guess whether a USB-A socket on a box takes a device or gives power.
import type { Board, BoxFace, BoxPortGroup, BoxSpec, Comp } from './types';
import { connById, connSetup } from './library';
import { roundedRectLoop, uid } from '../geom/poly';

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
  ['other', 'leaves the rack (supply, screen)'],
];

export const FACE_NAME: Record<BoxFace, string> = { front: 'Front', back: 'Back', left: 'Left end', right: 'Right end', top: 'Top' };
const ANGLE: Record<Exclude<BoxFace, 'top'>, number> = { front: -90, back: 90, left: 180, right: 0 };

const g = (type: string, count: number, face: BoxFace, role: string): BoxPortGroup => ({ id: uid('pg'), type, count, face, role });
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

/** Length of a face and the ports' spacing on it. */
const faceLen = (s: BoxSpec, f: BoxFace) => (f === 'left' || f === 'right' ? s.w : s.l);
const portWidth = (type: string, g?: BoxPortGroup) => (type === 'pins_ra' ? (g?.pins?.length ?? 6) * 2.54 : connById(type).body.w);

/** Port positions along each face: groups side by side, centred, 5 mm between ports (less if they don't fit). */
export function layoutPorts(s: BoxSpec): { group: BoxPortGroup; i: number; along: number; row: number }[] {
  const out: { group: BoxPortGroup; i: number; along: number; row: number }[] = [];
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    if (!gs.length) continue;
    const L = faceLen(s, face);
    const span = (gap: number, between: number) => gs.reduce((a, x) => a + x.count * portWidth(x.type, x) + (x.count - 1) * gap, 0) + (gs.length - 1) * between;
    let gap = 5, between = 9;
    if (span(gap, between) > L - 6) { gap = 1.5; between = 3; }
    // mains outlets spread evenly along the whole face, room for a plug pack on each
    const spread = gs.every((x) => x.type.startsWith('ac_'));
    if (spread) { const n = gs.reduce((a, x) => a + x.count, 0), w = gs.reduce((a, x) => a + x.count * portWidth(x.type, x), 0); gap = between = Math.max(1.5, (L - 20 - w) / Math.max(1, n)); }
    let at = spread ? 10 + gap / 2 : (L - span(gap, between)) / 2;
    for (const x of gs) for (let i = 0; i < x.count; i++) {
      const w = portWidth(x.type, x);
      out.push({ group: x, i, along: at + w / 2, row: 0 });
      at += w + (i < x.count - 1 ? gap : between);
    }
  }
  return out;
}

/** Faces whose ports need more room than the face has, and which size of the box would give it to them. */
export function tightFaces(s: BoxSpec): { face: BoxFace; need: number; have: number; dim: 'l' | 'w' }[] {
  return (Object.keys(FACE_NAME) as BoxFace[]).flatMap((face) => {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    // a bare board's header can run nearly edge to edge; a box's ports want a margin
    const bare = isBare(s), need = Math.ceil(gs.reduce((a, x) => a + x.count * (portWidth(x.type, x) + (bare ? 0 : 1.5)), 0) + (bare ? 1 : 3));
    return gs.length && need > faceLen(s, face) ? [{ face, need, have: faceLen(s, face), dim: face === 'left' || face === 'right' ? 'w' as const : 'l' as const }] : [];
  });
}

/** Ports that don't fit on their face. */
export function boxProblems(s: BoxSpec): string[] {
  const out: string[] = tightFaces(s).map((t) => `${FACE_NAME[t.face]}: the ports need about ${t.need} mm, the face is ${t.have} mm.`);
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    const hMax = Math.max(0, ...gs.map((x) => connById(x.type).body.h));
    // a slim probe's connectors stand proud of it, as on a bare board
    if (face !== 'top' && hMax > s.h - 1 && !isBare(s)) out.push(`${FACE_NAME[face]}: a ${connById(gs.find((x) => connById(x.type).body.h === hMax)!.type).name} is taller than the box.`);
  }
  return out;
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
      // across the middle, or by one long edge (a probe's ribbon socket); a probe's header stands on it, a box's port is flush
      const y = group.near === 'front' ? 3 + t.body.l / 2 : group.near === 'back' ? s.w - 3 - t.body.l / 2 : s.w / 2;
      return { id: uid('c'), ref, pkg: t.name, side: 'top', x: along, y, rot: group.rot ?? 0, w: t.body.w, l: t.body.l, h: group.role === 'debug' ? t.body.h : 0.2, kind: 'connector', tht: false, role: group.role, ...(group.switched ? { value: 'switched' } : {}),
        conn: { ...connSetup(t, 0), entry: 'top', zc: 0, cradle: false, cap: false, guard: false, tie: false } } as Comp;
    }
    const angle = ANGLE[group.face], horizontal = group.face === 'left' || group.face === 'right';
    const edge = group.face === 'front' ? 0 : group.face === 'back' ? s.w : group.face === 'left' ? 0 : s.l;
    const out = angle === 0 || angle === 90 ? 1 : -1;
    const c = edge - out * (t.body.l / 2);
    // on a bare board (a probe, an adapter: a few mm thick) a port stands on its top face at the edge; on a box it is
    // in its side
    const bare = isBare(s), bw = portWidth(group.type, group);
    const conn = { ...connSetup(t, angle), entry: 'edge' as const, zc: bare ? t.zc : -s.h / 2, cradle: false, cap: false, guard: false, tie: false };
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

/** Apply a box spec to a board: outline, height and ports (keeping the ports' refs stable so cables stay put). */
export function applyBox(b: Board, s: BoxSpec) {
  b.kind = 'box';
  b.box = s;
  b.thickness = s.h;
  b.outline = roundedRectLoop(s.l, s.w, Math.min(4, s.w / 6), 6).map(([x, y]) => [x + s.l / 2, y + s.w / 2] as [number, number]);
  b.holes = [];
  b.comps = [...b.comps.filter((c) => !c.conn), ...boxPorts(s)];
}

export function makeBox(preset: keyof typeof BOX_PRESETS, name?: string): Board {
  const P = BOX_PRESETS[preset];
  const b: Board = { name: name ?? P.name, outline: [], cutouts: [], thickness: 1, holes: [], comps: [], source: 'box', notes: [P.note ?? 'A box: set its size and ports under Box to match yours. Every port knows what it is for, so Auto-connect wires it right.'], kind: 'box', color: P.color };
  applyBox(b, P.spec());
  b.comps.push(...(P.parts?.() ?? []));
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
