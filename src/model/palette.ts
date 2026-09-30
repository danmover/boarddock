// The board editor's toolbox: things to put on a board, each with a picture. Plugs on an edge snap to the nearest
// edge, facing out; headers, debug connectors and tall parts land where you click or drop them; holes are the usual
// screw sizes. Every one of them is an ordinary part or hole afterwards, editable like one read from a file.
// Each item also makes a small demo board with just itself on it: that is what its picture shows.
import type { Board, Comp, Hole, V2 } from './types';
import { CONNECTORS, connById, connSetup, sizedConn } from './library';
import { CONTRIB_TYPES, contribDef } from './contributed';
import { deg, extentAlong, nearestEdge, rad, roundedRectLoop, uid } from '../geom/poly';

export type PaletteGroup = 'USB and power' | 'Video, network and audio' | 'Headers and wires' | 'Debug and serial' | 'Holes' | 'Parts that stand tall' | 'Other' | 'Contributed';
export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  hint: string;
  size: string; // "8.9 × 7.4 × 3.2" (mm) or "Ø3.2"
  edge?: boolean; // snaps to the nearest edge
  make: (b: Board, at: V2) => { comp?: Comp; hole?: Hole };
}

const snap = (v: number) => Math.round(v * 10) / 10;
const nextRef = (b: Board, pre: string) => { let n = 1; while (b.comps.some((c) => c.ref === `${pre}${n}`)) n++; return `${pre}${n}`; };
const mm = (w: number, l: number, h: number) => `${+w.toFixed(1)} × ${+l.toFixed(1)} × ${+h.toFixed(1)}`;

/** A plug on the edge nearest the click, facing out of it. */
export function edgeConnector(b: Board, typeId: string, at: V2): Comp {
  const t = connById(typeId);
  const e = nearestEdge(at, b.outline);
  const angle = Math.round(deg(Math.atan2(e.n[1], e.n[0])) * 10) / 10 + 0; // (+0: never -0)
  const pre = /^usb/.test(typeId) ? 'USB' : typeId === 'barrel' ? 'DC' : /^hdmi/.test(typeId) ? 'HDMI' : typeId === 'rj45' ? 'ETH' : typeId === 'audio35' ? 'AUD' : typeId === 'microsd' ? 'SD' : typeId === 'sma' || typeId === 'rf_mini' ? 'ANT' : typeId === 'terminal' ? 'TB' : 'J';
  const c: Comp = { id: uid('c'), ref: nextRef(b, pre), pkg: t.name, side: 'top', x: 0, y: 0, rot: angle - 90, w: t.body.w, l: t.body.l, h: t.body.h, kind: 'connector', tht: false, conn: connSetup(t, angle) };
  // slide it along the edge to the click, the nearest point on that edge
  const ext = extentAlong(c, angle);
  c.x = snap(e.q[0] + e.n[0] * (t.overhang - ext));
  c.y = snap(e.q[1] + e.n[1] * (t.overhang - ext));
  return c;
}

/** A connector plugged from above (a header, a JST, a debug connector) where the click is. */
function topConnector(b: Board, typeId: string, at: V2, o: { pkg: string; w: number; l: number; h: number; kind?: Comp['kind']; tht?: boolean; pre?: string }): Comp {
  const t = connById(typeId);
  return { id: uid('c'), ref: nextRef(b, o.pre ?? 'J'), pkg: o.pkg, side: 'top', x: snap(at[0]), y: snap(at[1]), rot: 0, w: o.w, l: o.l, h: o.h, kind: o.kind ?? 'connector', tht: o.tht ?? true, conn: connSetup(t, 0) };
}

const part = (b: Board, at: V2, pre: string, pkg: string, w: number, l: number, h: number, kind: Comp['kind'] = 'generic', tht = true): Comp =>
  ({ id: uid('c'), ref: nextRef(b, pre), pkg, side: 'top', x: snap(at[0]), y: snap(at[1]), rot: 0, w, l, h, kind, tht });

const EDGE_GROUP: Record<string, PaletteGroup> = {
  usb_c: 'USB and power', usb_micro_b: 'USB and power', usb_mini_b: 'USB and power', usb_a: 'USB and power', usb_a_dual: 'USB and power', usb_b: 'USB and power', barrel: 'USB and power', terminal: 'USB and power', iec_c7: 'USB and power',
  hdmi_a: 'Video, network and audio', hdmi_mini: 'Video, network and audio', hdmi_micro: 'Video, network and audio', rj45: 'Video, network and audio', audio35: 'Video, network and audio', sma: 'Video, network and audio', microsd: 'Video, network and audio',
  xt60: 'USB and power', xt30: 'USB and power', dp: 'Video, network and audio', rj11: 'Video, network and audio', rca: 'Video, network and audio', bnc: 'Video, network and audio', sd: 'Video, network and audio',
  qwiic: 'Headers and wires', pins_ra: 'Headers and wires', wtb_side: 'Headers and wires', idc_ra: 'Headers and wires', fpc: 'Headers and wires', dsub: 'Headers and wires', custom: 'Other',
  iec_c14: 'USB and power', banana: 'USB and power', xlr: 'Video, network and audio', toslink: 'Video, network and audio', sfp: 'Video, network and audio', minidin: 'Video, network and audio',
  rf_mini: 'Video, network and audio', sim: 'Video, network and audio', m12: 'Headers and wires', sata: 'Other',
};

const header = (rows: number, n: number): PaletteItem => ({
  id: `hdr_${rows}x${n}`, group: 'Headers and wires', label: `Pin header ${rows} × ${n}`, hint: '2.54 mm pins: jumper wires, a shield or a cable plug on', size: mm(n * 2.54, rows * 2.54, 8.5),
  make: (b, at) => ({ comp: topConnector(b, 'header', at, { pkg: `PinHeader_${rows}x${String(n).padStart(2, '0')}_P2.54mm_Vertical`, w: n * 2.54, l: rows * 2.54, h: 8.5, kind: 'header' }) }),
});
const jst = (kind: 'ph' | 'xh', n: number): PaletteItem => {
  const p = kind === 'ph' ? 2 : 2.5, w = (n - 1) * p + (kind === 'ph' ? 3.9 : 4.9), l = kind === 'ph' ? 4.5 : 5.75, h = kind === 'ph' ? 6 : 7;
  return {
    id: `jst_${kind}${n}`, group: 'Headers and wires', label: `JST-${kind.toUpperCase()} ${n}-pin`, hint: `${p} mm pitch, its plug goes in from above (batteries, sensors, fans)`, size: mm(w, l, h),
    make: (b, at) => ({ comp: topConnector(b, `jst_${kind}`, at, { pkg: `JST_${kind.toUpperCase()}_1x${String(n).padStart(2, '0')}_P${p.toFixed(2)}mm_Vertical`, w, l, h }) }),
  };
};
const hole = (name: string, d: number): PaletteItem => ({
  id: `hole_${name}`, group: 'Holes', label: `${name} hole`, hint: 'a mounting hole: the holder puts a locating pin through it (or you set it to be left clear)', size: `Ø${d}`,
  make: (_b, at) => ({ hole: { id: uid('h'), x: snap(at[0]), y: snap(at[1]), d, plated: true, use: 'auto', role: 'mount', why: 'added by hand' } }),
});
const tall = (id: string, label: string, pre: string, pkg: string, w: number, l: number, h: number, kind: Comp['kind'] = 'generic', hint = 'the holder keeps clear of it'): PaletteItem => ({
  id, group: 'Parts that stand tall', label, hint, size: mm(w, l, h),
  make: (b, at) => ({ comp: part(b, at, pre, pkg, w, l, h, kind) }),
});
/** An upright connector sized for its footprint name (its pins say how wide). */
const upright = (id: string, type: string, label: string, pkg: string, hint: string, kind: Comp['kind'] = 'connector', tht = true, group: PaletteGroup = 'Headers and wires'): PaletteItem => {
  const t = sizedConn(connById(type), pkg);
  return { id, group, label, hint, size: mm(t.body.w, t.body.l, t.body.h), make: (b, at) => ({ comp: { ...topConnector(b, type, at, { pkg, w: t.body.w, l: t.body.l, h: t.body.h, kind, tht }), conn: connSetup(t, 0) } }) };
};
const debug = (id: string, type: string, label: string, pkg: string, hint: string, tht: boolean): PaletteItem => {
  const t = connById(type);
  return { id, group: 'Debug and serial', label, hint, size: mm(t.body.w, t.body.l, t.body.h), make: (b, at) => ({ comp: { ...topConnector(b, type, at, { pkg, w: t.body.w, l: t.body.l, h: t.body.h, tht }), role: 'debug' } }) };
};

/** A connector type from parts/ (npm run parts): on an edge, or plugged from above, in the toolbox's Contributed group. */
const contributed = (t: (typeof CONTRIB_TYPES)[number]): PaletteItem => {
  const size = mm(t.body.w, t.body.l, t.body.h);
  if (t.entry === 'edge') return { id: `edge_${t.id}`, group: 'Contributed', label: t.name, edge: true, size, hint: `on an edge, facing out: click near the edge it goes on${t.note ? `. ${t.note}` : ''}`, make: (b, at) => ({ comp: edgeConnector(b, t.id, at) }) };
  return { id: `top_${t.id}`, group: 'Contributed', label: t.name, size, hint: t.note ?? 'its plug goes in from above', make: (b, at) => ({ comp: topConnector(b, t.id, at, { pkg: t.name, w: t.body.w, l: t.body.l, h: t.body.h, tht: contribDef(t.id)?.tht }) }) };
};

export const PALETTE: PaletteItem[] = [
  ...CONNECTORS.filter((t) => t.entry === 'edge' && EDGE_GROUP[t.id]).map((t): PaletteItem => ({
    id: `edge_${t.id}`, group: EDGE_GROUP[t.id], label: t.name, edge: true, size: mm(t.body.w, t.body.l, t.body.h),
    hint: `on an edge, facing out: click near the edge it goes on${t.note ? `. ${t.note}` : ''}`,
    make: (b, at) => ({ comp: edgeConnector(b, t.id, at) }),
  })),
  header(1, 2), header(1, 3), header(1, 4), header(1, 6), header(1, 8), header(1, 10), header(2, 5), header(2, 10), header(2, 20),
  jst('ph', 2), jst('ph', 3), jst('ph', 4), jst('xh', 2), jst('xh', 3), jst('xh', 4),
  upright('idc10', 'idc', 'Box header 2 × 5 (ribbon)', 'IDC-Header_2x05_P2.54mm_Vertical', 'a ribbon cable pushes in from above'),
  upright('idc16', 'idc', 'Box header 2 × 8 (ribbon)', 'IDC-Header_2x08_P2.54mm_Vertical', 'a ribbon cable pushes in from above'),
  upright('gh4', 'jst_gh', 'JST-GH 4-pin', 'JST_GH_BM04B-GHS-TBT_1x04_P1.25mm_Vertical', '1.25 mm, latching (drones, flight controllers)'),
  upright('zh4', 'jst_zh', 'JST-ZH 4-pin', 'JST_ZH_B4B-ZR_1x04_P1.50mm_Vertical', '1.5 mm, its plug goes in from above'),
  upright('pico4', 'picoblade', 'Molex PicoBlade 4-pin', 'Molex_PicoBlade_53047-0410_1x04_P1.25mm_Vertical', '1.25 mm, its plug goes in from above'),
  upright('fan4', 'kk254', 'Fan header 4-pin', 'Molex_KK-254_AE-6410-04A_1x04_P2.54mm_Vertical', 'a fan or a KK plug goes in from above'),
  upright('mfjr4', 'minifit', 'Molex Mini-Fit Jr 2 × 2', 'Molex_Mini-Fit_Jr_5566-04A_2x02_P4.20mm_Vertical', 'power in from above (4.2 mm)'),
  upright('mfit4', 'microfit', 'Molex Micro-Fit 2 × 2', 'Molex_Micro-Fit_3.0_43045-0400_2x02_P3.00mm_Vertical', 'power in from above (3 mm)'),
  upright('ufl', 'ufl', 'u.FL antenna socket', 'U.FL_Hirose_U.FL-R-SMT-1_Vertical', 'a thin antenna lead snaps on from above', 'connector', false),
  upright('b2b', 'b2b', 'Board-to-board connector', 'Board-to-Board_Mezzanine_Vertical', 'another board mates on it, no cable: put the two in a stack', 'connector', false, 'Other'),
  upright('m2', 'm2', 'M.2 card socket', 'M.2_Socket_Key-M_2280', 'a card lies over the board from it: the holder keeps clear of the card (mini PCIe: name it so)', 'connector', false, 'Other'),
  upright('pcie4', 'pcie', 'PCIe slot x4', 'PCIe_x4_Slot_Vertical', 'a card stands up from it: the holder keeps clear of the card', 'connector', true, 'Other'),
  upright('sodimm', 'dimm', 'SO-DIMM socket', 'SO-DIMM_DDR4_Socket', 'a memory module lies over the board from it: the holder keeps clear of it', 'connector', false, 'Other'),
  upright('pogo', 'pogo', 'Spring-pin (pogo) pads', 'Pogo_Pads_1x04_P2.54mm', 'no connector: a test jig presses spring pins onto the pads', 'connector', false, 'Other'),
  debug('dbg_swd10', 'swd10', 'Debug 10-pin, 1.27 mm', 'PinHeader_2x05_P1.27mm_Vertical_SMD', 'SWD: a J-Link plugs in with its ribbon', false),
  debug('dbg_jtag20', 'jtag20', 'Debug 20-pin, 2.54 mm', 'IDC-Header_2x10_P2.54mm_Vertical', "JTAG box header: a J-Link's own ribbon plugs straight in", true),
  debug('dbg_cortex20', 'cortex20', 'Debug 20-pin, 1.27 mm (Cortex + trace)', 'PinHeader_2x10_P1.27mm_Vertical_SMD', 'a J-Link plugs in with a 20-pin 1.27 mm ribbon', false),
  debug('dbg_tag', 'tagconnect', 'Tag-Connect pads', 'Tag-Connect_TC2050', 'no connector: the Tag-Connect cable clips on from above', false),
  { id: 'uart6', group: 'Debug and serial', label: 'UART header, FTDI 6-pin', hint: 'GND CTS VCC RX TX DTR: a USB-serial adapter wires onto it', size: mm(15.24, 2.54, 8.5),
    // the usual FTDI order, pin 1 = GND: the board's RX on pin 4 and TX on pin 5 (set, so they are not a guess)
    make: (b, at) => { const c = header(1, 6).make(b, at).comp!; return { comp: { ...c, ref: nextRef(b, 'J_UART'), value: 'FTDI', role: 'uart', uart: { gnd: '1', rx: '4', tx: '5' } } }; } },
  { id: 'uart4', group: 'Debug and serial', label: 'UART header, 4-pin', hint: 'GND RX TX VCC is a guess: check yours against your board\'s markings. A USB-serial adapter wires onto it', size: mm(10.16, 2.54, 8.5),
    make: (b, at) => { const c = header(1, 4).make(b, at).comp!; return { comp: { ...c, ref: nextRef(b, 'J_UART'), value: 'UART', role: 'uart' } }; } },
  hole('M2', 2.2), hole('M2.5', 2.7), hole('M3', 3.2), hole('M4', 4.3),
  tall('cap6', 'Electrolytic cap Ø6.3', 'C', 'CP_Elec_6.3x7.7', 6.6, 6.6, 7.7), tall('cap8', 'Electrolytic cap Ø8', 'C', 'CP_Elec_8x10.5', 8.3, 8.3, 10.5), tall('cap10', 'Electrolytic cap Ø10', 'C', 'CP_Elec_10x12.5', 10.3, 10.3, 12.5),
  tall('relay', 'Relay', 'K', 'Relay_SPDT_SRD', 19, 15.5, 15.3), tall('button', 'Push button', 'SW', 'SW_PUSH_6mm', 6, 6, 5, 'switch', 'a button: the holder leaves room for your finger'), tall('pot', 'Trimmer pot', 'RV', 'Potentiometer_Trimmer', 9.5, 10, 8),
  tall('heatsink', 'Heatsink', 'HS', 'Heatsink_14x14', 14, 14, 8, 'hot', 'it gets hot: the holder leaves air round it'), tall('esp32', 'ESP32 module', 'U', 'ESP32-WROOM-32', 18, 25.5, 3.1, 'module'), tall('buzzer', 'Buzzer Ø12', 'BZ', 'Buzzer_12x9.5', 12, 12, 9.5),
  tall('coin', 'Coin cell holder', 'BT', 'BatteryHolder_CR2032', 20, 23, 5), tall('led5', 'LED Ø5', 'D', 'LED_D5.0mm', 5.8, 5.8, 8.6, 'led'), tall('antenna', 'Antenna area', 'AE', 'Antenna keep-out', 10, 6, 1, 'antenna', 'nothing printed over it (radio)'),
  { id: 'keepout', group: 'Parts that stand tall', label: 'Keep-out box', hint: 'anything else: size it in the inspector', size: mm(5, 5, 5), make: (b, at) => ({ comp: part(b, at, 'K', 'keep-out box', 5, 5, 5, 'generic', false) }) },
  ...CONTRIB_TYPES.map(contributed),
];

export const PALETTE_GROUPS: PaletteGroup[] = ['USB and power', 'Video, network and audio', 'Headers and wires', 'Debug and serial', 'Holes', 'Parts that stand tall', 'Other', 'Contributed'];

/** The contributed type (parts/) a toolbox entry is, if it is one. */
export const contribOf = (it: PaletteItem) => (it.group === 'Contributed' ? contribDef(it.id.replace(/^(edge|top)_/, '')) : undefined);

/** The palette item a part came from (by its connector type, footprint or role), for its picture in lists. */
export function paletteFor(c: Comp): PaletteItem | undefined {
  const t = c.conn?.type;
  if (t && PALETTE.find((x) => x.id === `edge_${t}`)) return PALETTE.find((x) => x.id === `edge_${t}`);
  if (t && PALETTE.find((x) => x.id === `top_${t}`)) return PALETTE.find((x) => x.id === `top_${t}`);
  if (t === 'swd10') return PALETTE.find((x) => x.id === 'dbg_swd10');
  if (t === 'cortex20') return PALETTE.find((x) => x.id === 'dbg_cortex20');
  if (t === 'jtag20') return PALETTE.find((x) => x.id === 'dbg_jtag20');
  if (t === 'tagconnect') return PALETTE.find((x) => x.id === 'dbg_tag');
  if (t === 'idc') return PALETTE.find((x) => x.id === (Math.max(c.w, c.l) > 24 ? 'idc16' : 'idc10'));
  const up = ({ idc: 'idc10', jst_gh: 'gh4', jst_zh: 'zh4', minifit: 'mfjr4', picoblade: 'pico4', kk254: 'fan4', microfit: 'mfit4', ufl: 'ufl', b2b: 'b2b', m2: 'm2', pcie: 'pcie4', dimm: 'sodimm', pogo: 'pogo' } as Record<string, string>)[t ?? ''];
  if (up) return PALETTE.find((x) => x.id === up);
  if (t === 'jst_ph' || t === 'jst_xh') return PALETTE.find((x) => x.id === `jst_${t.slice(4)}${Math.max(2, Math.min(4, Math.round((Math.max(c.w, c.l) - 3.9) / (t === 'jst_ph' ? 2 : 2.5)) + 1))}`) ?? PALETTE.find((x) => x.id === `jst_${t.slice(4)}3`);
  if (t === 'header' || c.kind === 'header') {
    const m = /(\d+)x(\d+)/.exec(c.pkg), rows = m ? Math.min(+m[1], +m[2]) : 1, n = m ? Math.max(+m[1], +m[2]) : Math.round(Math.max(c.w, c.l) / 2.54);
    // a UART header as the toolbox makes one (FTDI's six pins, or four)
    if (c.role === 'uart' && rows === 1 && (n === 6 || n === 4)) return PALETTE.find((x) => x.id === `uart${n}`);
    return PALETTE.find((x) => x.id === `hdr_${rows}x${n}`) ?? PALETTE.find((x) => x.id === (rows > 1 ? 'hdr_2x10' : 'hdr_1x6'));
  }
  if (/elec|\bCP_/i.test(c.pkg)) return PALETTE.find((x) => x.id === (c.w > 9 ? 'cap10' : c.w > 7 ? 'cap8' : 'cap6'));
  if (/relay/i.test(c.pkg)) return PALETTE.find((x) => x.id === 'relay');
  if (c.kind === 'switch') return PALETTE.find((x) => x.id === 'button');
  if (c.kind === 'hot') return PALETTE.find((x) => x.id === 'heatsink');
  if (c.kind === 'module') return PALETTE.find((x) => x.id === 'esp32');
  if (c.kind === 'led') return PALETTE.find((x) => x.id === 'led5');
  if (c.kind === 'antenna') return PALETTE.find((x) => x.id === 'antenna');
  // (by the names the 3D model goes by: boardviz.ts partDetail)
  if (/trimmer|pot\b|potentiometer/i.test(c.pkg)) return PALETTE.find((x) => x.id === 'pot');
  if (/buzzer|beeper/i.test(c.pkg)) return PALETTE.find((x) => x.id === 'buzzer');
  if (/coin|cr2032|battery/i.test(c.pkg)) return PALETTE.find((x) => x.id === 'coin');
  if (/keep-?out/i.test(c.pkg)) return PALETTE.find((x) => x.id === 'keepout');
  return undefined;
}

/**
 * A small board with just this item on it, made by the item itself exactly as it goes on a board (a plug on the
 * front edge, facing out; anything else upright, the way it lands): its picture is this board's 3D model.
 */
export function demoBoard(it: PaletteItem): Board {
  const probe = it.make({ name: '', outline: roundedRectLoop(40, 30, 1, 4).map(([x, y]) => [x + 20, y + 15] as V2), cutouts: [], thickness: 1.6, holes: [], comps: [], source: '', notes: [] }, [20, 0]);
  const c = probe.comp;
  // (a plug lies along the front edge, its width across; a part stands as it is made, w across and l up)
  const cw = c ? (it.edge ? Math.max(c.w, c.l) : c.w) : 8, cl = c ? (it.edge ? Math.min(c.w, c.l) : c.l) : 8;
  const W = Math.max(22, cw + 10), H = Math.max(16, cl + (it.edge ? 12 : 10));
  const b: Board = { name: '', outline: roundedRectLoop(W, H, 1.2, 4).map(([x, y]) => [x + W / 2, y + H / 2] as V2), cutouts: [], thickness: 1.6, holes: [], comps: [], source: 'toolbox', notes: [] };
  const made = it.make(b, it.edge ? [W / 2, 0] : [W / 2, H / 2]);
  if (made.comp) b.comps.push(made.comp);
  if (made.hole) b.holes.push(made.hole);
  return b;
}

/** Whether a board's part is just what this toolbox entry puts down (the same size, pins and look): then its picture is this entry's. */
export function samePart(c: Comp, it: PaletteItem): boolean {
  const d = demoBoard(it).comps[0];
  if (!d || (c.conn?.type ?? '') !== (d.conn?.type ?? '') || c.kind !== d.kind || !!c.conn?.roll) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.15, look = (x: Comp) => /socket|female/i.test(`${x.pkg} ${x.value ?? ''}`);
  const pins = (x: Comp) => x.pins?.length ?? (/(\d+)x(\d+)/.exec(x.pkg)?.slice(1).reduce((a, n) => a * +n, 1) ?? 0);
  return near(c.h, d.h) && (near(c.w, d.w) && near(c.l, d.l) || c.conn?.entry !== 'edge' && near(c.w, d.l) && near(c.l, d.w)) && look(c) === look(d) && pins(c) === pins(d);
}

/**
 * A small board with just this part on it as it is (its own size, pins and plug), laid out the way the toolbox shows
 * its parts: a plug on the front edge facing out, anything else with its long side across. Its picture is this
 * part's own 3D model, for the board's list of parts when no toolbox entry is quite it.
 */
export function partBoard(c0: Comp): Board {
  const edge = c0.conn?.entry === 'edge', a0 = rad(c0.rot);
  const across = Math.abs(Math.cos(a0)) * c0.w + Math.abs(Math.sin(a0)) * c0.l, up = Math.abs(Math.sin(a0)) * c0.w + Math.abs(Math.cos(a0)) * c0.l;
  const turn = edge ? -90 - c0.conn!.angle : up > across * 1.3 ? 90 : 0;
  const c: Comp = { ...c0, id: 'pic', ref: '', side: 'top', hidden: false, rot: c0.rot + turn, ...(c0.conn ? { conn: { ...c0.conn, angle: edge ? -90 : c0.conn.angle + turn } } : {}) };
  const ext = (ang: number) => extentAlong(c, ang);
  const W = Math.max(22, ext(0) + ext(180) + 10), H = Math.max(16, ext(90) + ext(-90) + (edge ? 12 : 10));
  // (a plug's mouth out past the front edge by its usual overhang, as the toolbox puts one on)
  c.x = W / 2; c.y = edge ? ext(-90) - connById(c.conn!.type).overhang : H / 2;
  const ct = Math.cos(rad(turn)), st = Math.sin(rad(turn));
  if (c0.pins) c.pins = c0.pins.map((q) => { const dx = q.x - c0.x, dy = q.y - c0.y; return { ...q, x: c.x + dx * ct - dy * st, y: c.y + dx * st + dy * ct }; });
  return { name: '', outline: roundedRectLoop(W, H, 1.2, 4).map(([x, y]) => [x + W / 2, y + H / 2] as V2), cutouts: [], thickness: 1.6, holes: [], comps: [c], source: 'toolbox', notes: [] };
}
