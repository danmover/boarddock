// The board editor's toolbox: things to put on a board by clicking where they go. Plugs on an edge snap to the
// nearest edge, facing out; headers, debug connectors and tall parts land where you click; holes are the usual
// screw sizes. Every one of them is an ordinary part or hole afterwards, editable like one read from a file.
import type { Board, Comp, Hole, V2 } from './types';
import { CONNECTORS, connById, connSetup } from './library';
import { deg, extentAlong, nearestEdge, uid } from '../geom/poly';

export interface PaletteItem { id: string; group: string; label: string; hint?: string; make: (b: Board, at: V2) => { comp?: Comp; hole?: Hole } }

const snap = (v: number) => Math.round(v * 10) / 10;
const nextRef = (b: Board, pre: string) => { let n = 1; while (b.comps.some((c) => c.ref === `${pre}${n}`)) n++; return `${pre}${n}`; };

/** A plug on the edge nearest the click, facing out of it. */
export function edgeConnector(b: Board, typeId: string, at: V2): Comp {
  const t = connById(typeId);
  const e = nearestEdge(at, b.outline);
  const angle = Math.round(deg(Math.atan2(e.n[1], e.n[0])) * 10) / 10 + 0; // (+0: never -0)
  const c: Comp = { id: uid('c'), ref: nextRef(b, 'J'), pkg: t.name, side: 'top', x: 0, y: 0, rot: angle - 90, w: t.body.w, l: t.body.l, h: t.body.h, kind: 'connector', tht: false, conn: connSetup(t, angle) };
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

const header = (rows: number, n: number): PaletteItem => ({
  id: `hdr_${rows}x${n}`, group: 'Headers and top connectors', label: `Pin header ${rows} × ${n}`, hint: '2.54 mm, for jumper wires or a shield',
  make: (b, at) => ({ comp: topConnector(b, 'header', at, { pkg: `PinHeader_${rows}x${String(n).padStart(2, '0')}_P2.54mm_Vertical`, w: n * 2.54, l: rows * 2.54, h: 8.5, kind: 'header' }) }),
});
const jst = (kind: 'ph' | 'xh', n: number): PaletteItem => {
  const p = kind === 'ph' ? 2 : 2.5;
  return {
    id: `jst_${kind}${n}`, group: 'Headers and top connectors', label: `JST-${kind.toUpperCase()} ${n}-pin`, hint: `${p} mm pitch, plug from above`,
    make: (b, at) => ({ comp: topConnector(b, `jst_${kind}`, at, { pkg: `JST_${kind.toUpperCase()}_1x${String(n).padStart(2, '0')}_P${p.toFixed(2)}mm_Vertical`, w: (n - 1) * p + (kind === 'ph' ? 3.9 : 4.9), l: kind === 'ph' ? 4.5 : 5.75, h: kind === 'ph' ? 6 : 7 }) }),
  };
};
const hole = (name: string, d: number): PaletteItem => ({
  id: `hole_${name}`, group: 'Holes', label: `${name} hole (Ø${d})`, hint: 'a mounting hole: the holder snaps a pin into it',
  make: (_b, at) => ({ hole: { id: uid('h'), x: snap(at[0]), y: snap(at[1]), d, plated: false, use: 'auto', role: 'mount', why: 'added by hand' } }),
});
const tall = (id: string, label: string, pre: string, w: number, l: number, h: number, kind: Comp['kind'] = 'generic', hint?: string): PaletteItem => ({
  id, group: 'Parts that stand tall', label: `${label} (${w} × ${l} × ${h})`, hint: hint ?? 'the holder keeps clear of it',
  make: (b, at) => ({ comp: part(b, at, pre, label, w, l, h, kind) }),
});

export const PALETTE: PaletteItem[] = [
  ...CONNECTORS.filter((t) => t.entry === 'edge' && t.id !== 'mains_lead').map((t) => ({ id: `edge_${t.id}`, group: 'Plugs on an edge', label: t.name, hint: 'snaps to the nearest edge, facing out', make: (b: Board, at: V2) => ({ comp: edgeConnector(b, t.id, at) }) })),
  header(1, 2), header(1, 3), header(1, 4), header(1, 6), header(1, 8), header(1, 10), header(2, 5), header(2, 10), header(2, 20),
  jst('ph', 2), jst('ph', 3), jst('ph', 4), jst('xh', 2), jst('xh', 3), jst('xh', 4),
  { id: 'dbg_swd10', group: 'Headers and top connectors', label: 'Debug 10-pin, 1.27 mm (SWD)', hint: 'a J-Link plugs in with its ribbon', make: (b, at) => { const t = connById('swd10'); return { comp: { ...topConnector(b, 'swd10', at, { pkg: 'PinHeader_2x05_P1.27mm_Vertical_SMD', w: t.body.w, l: t.body.l, h: t.body.h, tht: false }), role: 'debug' } }; } },
  { id: 'dbg_jtag20', group: 'Headers and top connectors', label: 'Debug 20-pin, 2.54 mm (JTAG)', hint: 'a box header for a J-Link\'s own ribbon', make: (b, at) => { const t = connById('jtag20'); return { comp: { ...topConnector(b, 'jtag20', at, { pkg: 'IDC-Header_2x10_P2.54mm_Vertical', w: t.body.w, l: t.body.l, h: t.body.h }), role: 'debug' } }; } },
  { id: 'dbg_tag', group: 'Headers and top connectors', label: 'Tag-Connect pads', hint: 'the Tag-Connect cable clips on from above', make: (b, at) => { const t = connById('tagconnect'); return { comp: { ...topConnector(b, 'tagconnect', at, { pkg: 'Tag-Connect_TC2050', w: t.body.w, l: t.body.l, h: t.body.h, tht: false }), role: 'debug' } }; } },
  { id: 'uart6', group: 'Headers and top connectors', label: 'UART header, FTDI 6-pin', hint: 'GND CTS VCC RX TX DTR, for a USB-serial adapter', make: (b, at) => { const c = header(1, 6).make(b, at).comp!; return { comp: { ...c, value: 'FTDI', role: 'uart' } }; } },
  hole('M2', 2.2), hole('M2.5', 2.7), hole('M3', 3.2), hole('M4', 4.3),
  tall('cap6', 'Electrolytic cap Ø6.3', 'C', 6.6, 6.6, 7.7), tall('cap8', 'Electrolytic cap Ø8', 'C', 8.3, 8.3, 10.5), tall('cap10', 'Electrolytic cap Ø10', 'C', 10.3, 10.3, 12.5),
  tall('relay', 'Relay', 'K', 19, 15.5, 15.3), tall('button', 'Push button', 'SW', 6, 6, 5, 'switch'), tall('pot', 'Trimmer / pot', 'RV', 9.5, 10, 8),
  tall('heatsink', 'Heatsink', 'HS', 14, 14, 8, 'hot', 'it gets hot: the holder leaves air round it'), tall('esp32', 'ESP32 module', 'U', 18, 25.5, 3.1, 'module'), tall('buzzer', 'Buzzer Ø12', 'BZ', 12, 12, 9.5),
  tall('coin', 'Coin cell holder', 'BT', 20, 23, 5), tall('antenna', 'Antenna (keep clear)', 'AE', 10, 6, 1, 'antenna', 'nothing printed over it'),
  { id: 'keepout', group: 'Parts that stand tall', label: 'Keep-out box (5 × 5 × 5)', hint: 'size it in the inspector', make: (b, at) => ({ comp: part(b, at, 'K', 'keep-out box', 5, 5, 5, 'generic', false) }) },
];

export const PALETTE_GROUPS = [...new Set(PALETTE.map((x) => x.group))];
