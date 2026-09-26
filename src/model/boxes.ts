// Boxes (USB hubs, chargers, power supplies): a size and rows of ports on its faces. The outline, the height and a
// port part for every port are generated from that, and every port knows its role, so Auto-connect never has to
// guess whether a USB-A socket on a box takes a device or gives power.
import type { Board, BoxFace, BoxPortGroup, BoxSpec, Comp } from './types';
import { connById, connSetup } from './library';
import { roundedRectLoop, uid } from '../geom/poly';

export const BOX_PORT_TYPES = ['usb_a', 'usb_c', 'usb_micro_b', 'usb_b', 'barrel', 'iec_c7', 'rj45', 'hdmi_a', 'audio35', 'terminal'] as const;

export const BOX_ROLES: [string, string][] = [
  ['hub-down', 'hub port: a device plugs in'],
  ['hub-up', 'upstream: to a computer or board'],
  ['power-out', 'power out: charges a board'],
  ['power-in', 'power in: from a USB charger'],
  ['host', 'host: devices plug in (a computer port)'],
  ['device', 'device: goes to a hub or computer'],
  ['net', 'network'],
  ['other', 'leaves the rack (mains, supply, screen)'],
];

export const FACE_NAME: Record<BoxFace, string> = { front: 'Front', back: 'Back', left: 'Left end', right: 'Right end', top: 'Top' };
const ANGLE: Record<Exclude<BoxFace, 'top'>, number> = { front: -90, back: 90, left: 180, right: 0 };

const g = (type: string, count: number, face: BoxFace, role: string): BoxPortGroup => ({ id: uid('pg'), type, count, face, role });

export const BOX_PRESETS: Record<string, { name: string; color: string; spec: () => BoxSpec }> = {
  hub4: { name: 'USB hub', color: '#2b2f36', spec: () => ({ l: 100, w: 30, h: 22, groups: [g('usb_a', 4, 'front', 'hub-down'), g('usb_micro_b', 1, 'left', 'hub-up')] }) },
  hub7: { name: 'Powered USB hub', color: '#2b2f36', spec: () => ({ l: 160, w: 48, h: 24, groups: [g('usb_a', 7, 'top', 'hub-down'), g('usb_c', 1, 'left', 'hub-up'), g('barrel', 1, 'right', 'other')] }) },
  hubc: { name: 'USB-C hub', color: '#3a3f47', spec: () => ({ l: 110, w: 32, h: 14, groups: [g('usb_a', 3, 'front', 'hub-down'), g('usb_c', 1, 'front', 'hub-down'), g('usb_c', 1, 'left', 'hub-up'), g('rj45', 1, 'right', 'net')] }) },
  charger4: { name: 'USB charger', color: '#e9e7e2', spec: () => ({ l: 90, w: 60, h: 28, groups: [g('usb_a', 4, 'back', 'power-out'), g('iec_c7', 1, 'front', 'other')] }) },
  charger6: { name: 'USB charger (A + C)', color: '#e9e7e2', spec: () => ({ l: 110, w: 70, h: 30, groups: [g('usb_a', 4, 'back', 'power-out'), g('usb_c', 2, 'back', 'power-out'), g('iec_c7', 1, 'front', 'other')] }) },
};

/** Length of a face and the ports' spacing on it. */
const faceLen = (s: BoxSpec, f: BoxFace) => (f === 'left' || f === 'right' ? s.w : s.l);
const portWidth = (type: string) => connById(type).body.w;

/** Port positions along each face: groups side by side, centred, 5 mm between ports (less if they don't fit). */
export function layoutPorts(s: BoxSpec): { group: BoxPortGroup; i: number; along: number; row: number }[] {
  const out: { group: BoxPortGroup; i: number; along: number; row: number }[] = [];
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    if (!gs.length) continue;
    const L = faceLen(s, face);
    const span = (gap: number, between: number) => gs.reduce((a, x) => a + x.count * portWidth(x.type) + (x.count - 1) * gap, 0) + (gs.length - 1) * between;
    let gap = 5, between = 9;
    if (span(gap, between) > L - 6) { gap = 1.5; between = 3; }
    let at = (L - span(gap, between)) / 2;
    for (const x of gs) for (let i = 0; i < x.count; i++) {
      const w = portWidth(x.type);
      out.push({ group: x, i, along: at + w / 2, row: 0 });
      at += w + (i < x.count - 1 ? gap : between);
    }
  }
  return out;
}

/** Ports that don't fit on their face. */
export function boxProblems(s: BoxSpec): string[] {
  const out: string[] = [];
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    const need = gs.reduce((a, x) => a + x.count * (portWidth(x.type) + 1.5), 0) + 3;
    if (gs.length && need > faceLen(s, face)) out.push(`${FACE_NAME[face]}: the ports need about ${Math.ceil(need)} mm, the face is ${faceLen(s, face)} mm.`);
    const hMax = Math.max(0, ...gs.map((x) => connById(x.type).body.h));
    if (face !== 'top' && hMax > s.h - 1) out.push(`${FACE_NAME[face]}: a ${connById(gs.find((x) => connById(x.type).body.h === hMax)!.type).name} is taller than the box.`);
  }
  return out;
}

const PREFIX: Record<string, string> = { 'hub-down': 'P', 'hub-up': 'UP', 'power-out': 'OUT', 'power-in': 'PWR', host: 'USB', device: 'USB', net: 'LAN' };
const prefixOf = (x: BoxPortGroup) => PREFIX[x.role] ?? (x.type === 'iec_c7' ? 'AC' : x.type === 'barrel' ? 'DC' : x.type === 'rj45' ? 'LAN' : 'J');

/** The port parts of a box (in board coordinates: x along its length, y across, the box standing on z = 0). */
export function boxPorts(s: BoxSpec): Comp[] {
  const count = new Map<string, number>();
  const total = new Map<string, number>();
  for (const x of s.groups) total.set(prefixOf(x), (total.get(prefixOf(x)) ?? 0) + x.count);
  return layoutPorts(s).map(({ group, along }) => {
    const pre = prefixOf(group), n = (count.get(pre) ?? 0) + 1;
    count.set(pre, n);
    const ref = total.get(pre)! > 1 ? `${pre}${n}` : pre;
    const t = connById(group.type);
    if (group.face === 'top') {
      return { id: uid('c'), ref, pkg: t.name, side: 'top', x: along, y: s.w / 2, rot: 0, w: t.body.w, l: t.body.l, h: 0.2, kind: 'connector', tht: false, role: group.role,
        conn: { ...connSetup(t, 0), entry: 'top', zc: 0, cradle: false, cap: false, guard: false, tie: false } } as Comp;
    }
    const angle = ANGLE[group.face], horizontal = group.face === 'left' || group.face === 'right';
    const edge = group.face === 'front' ? 0 : group.face === 'back' ? s.w : group.face === 'left' ? 0 : s.l;
    const out = angle === 0 || angle === 90 ? 1 : -1;
    const c = edge - out * (t.body.l / 2);
    const conn = { ...connSetup(t, angle), zc: -s.h / 2, cradle: false, cap: false, guard: false, tie: false };
    return { id: uid('c'), ref, pkg: t.name, side: 'top', x: horizontal ? c : along, y: horizontal ? along : c, rot: 0,
      w: horizontal ? 2 : t.body.w, l: horizontal ? t.body.w : 2, h: 0.2, kind: 'connector', tht: false, role: group.role, conn } as Comp;
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
  const b: Board = { name: name ?? P.name, outline: [], cutouts: [], thickness: 1, holes: [], comps: [], source: 'box', notes: ['A box: set its size and ports under Box to match yours. Every port knows what it is for, so Auto-connect wires it right.'], kind: 'box', color: P.color };
  applyBox(b, P.spec());
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
    if (same) same.count++; else groups.push({ id: uid('pg'), type: c.conn.type, count: 1, face, role: r });
  }
  return { l: Math.round(x1 - x0), w: Math.round(y1 - y0), h: b.thickness, groups };
}
