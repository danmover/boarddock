// Contributed connectors and part numbers: what people add under parts/ (see parts/README.md). `npm run parts` checks
// those files and writes them, compact, to parts.json (next to this file), which is all the app reads:
//  - names: part numbers or footprint names that mean an existing connector type, tried by guessPackage (library.ts);
//  - types: whole new connector types (a size, a plug, a wiring role, a look), which join the connector library and
//    the toolbox's "Contributed" group.
// Nothing here imports the library at run time (the library imports this), and the data starts empty: an app with no
// contributions carries a few hundred bytes of it.
import type { ConnType } from './library';
import type { PlugSpec } from './types';
import RAW from './parts.json';

/** Materials a look may use (the ones boardviz.ts draws parts in). */
export const LOOK_MATS = ['metal', 'black', 'gold', 'white', 'blue', 'red', 'yellow', 'tin', 'chip'] as const;
export type LookMat = (typeof LOOK_MATS)[number];
type V3 = [number, number, number];
type V2 = [number, number];
/**
 * The primitives a look is built from, in the part's own frame with every position a fraction of its body: x across
 * the mouth (0 left, 1 right), y along the plug's way in (0 the back, 1 the mouth end), z up (0 the board, 1 the top).
 * Later shapes are drawn over earlier ones, and a `mouth` cuts into every solid drawn before it.
 */
export type LookShape =
  | { box: LookMat; from: V3; to: V3 }
  | { mouth: 'rect' | 'round'; at: V2; size: V2; depth: number } // an opening in the front face: centre [x, z], size as fractions of the width and height, depth as a fraction of the length
  | { barrel: LookMat; at: V2; d: number; y: V2; bore?: number } // a round barrel along y: centre [x, z], diameter as a fraction of the smaller of width and height, from y[0] to y[1], hollow (bore = the inner diameter as a fraction of it) from the front
  | { pins: LookMat; n: number; pitch: number; d: number; at: V3; len: number; axis?: 'y' | 'z' }; // a row of n square pins d mm across, pitch mm apart across the width, centred on x = at[0], each starting at [y, z] and running len (a fraction of the length, or of the height for axis z) along its axis (z, standing up, by default)

/** How a connector takes part in wiring: which of the built-in kinds it behaves like. */
export const WIRING_ROLES = ['net', 'usb', 'power', 'audio', 'video', 'mains-in', 'wire', 'other'] as const;
export type WiringRole = (typeof WIRING_ROLES)[number];

export interface NameGroup {
  type: string; // a connector type id
  names?: string[]; // part numbers and footprint names (`*` and `?` allowed): count anywhere in a part's footprint or value
  weak?: string[]; // plain words that name it but could name a chip too: count only on a connector's reference (J1, CN2)
  pins?: number; // the contacts of these parts, for their width (types whose width follows their pins)
  rows?: number; // in this many rows (1 or 2)
  pitch?: number; // mm between them
}
export interface TypeDef {
  id: string;
  label: string;
  plugName?: string; // its mating plug, in a few words (default: the label)
  entry: 'edge' | 'top';
  body: { w: number; l: number; h: number };
  plug: PlugSpec;
  zc?: number;
  overhang?: number;
  tht?: boolean;
  role: WiringRole;
  offRack?: string; // where its lead goes when it leaves the rack ("to an amplifier")
  cradle?: boolean;
  note?: string;
  look?: LookShape[];
  names?: string[];
  weak?: string[];
}
export interface PartsData { v: 1; names: NameGroup[]; types: TypeDef[] }
export const PARTS = RAW as unknown as PartsData;

// ---- names ----

/** A name as a regular expression source: `*` any characters (not spaces), `?` one, a space, `_` or `-` any one of those; the name stands as a whole word. */
export function globSource(glob: string): string {
  let s = '';
  for (const ch of glob) s += ch === '*' ? '[^\\s]*' : ch === '?' ? '[^\\s]' : /[\s_-]/.test(ch) ? '[\\s_-]' : /[a-z0-9]/i.test(ch) ? ch : `\\${ch}`;
  return `(?<![a-z0-9])${s}(?![a-z0-9])`;
}
export const globRegex = (globs: string[]) => new RegExp(globs.map(globSource).join('|'), 'i');
const wild = (g: string) => /[*?]/.test(g);

export interface NameHit { type: string; weak: boolean; pins?: number; rows?: number; pitch?: number }
interface Rule extends NameHit { re: RegExp }
let RULES: Rule[] | undefined;
/** Rules in the order they are tried: whole names before patterns, and plain words (weak) after all the rest. */
export function compileNames(groups: { type: string; names?: string[]; weak?: string[]; pins?: number; rows?: number; pitch?: number }[]): Rule[] {
  const out: Rule[] = [];
  for (const weak of [false, true]) for (const pattern of [false, true]) for (const g of groups) {
    const list = (weak ? g.weak : g.names)?.filter((n) => wild(n) === pattern);
    if (list?.length) out.push({ type: g.type, weak, pins: g.pins, rows: g.rows, pitch: g.pitch, re: globRegex(list) });
  }
  return out;
}
const rules = () => (RULES ??= compileNames([...PARTS.names, ...PARTS.types.flatMap((t) => (t.names || t.weak ? [{ type: t.id, names: t.names, weak: t.weak }] : []))]));

/**
 * The contributed name a footprint/value text says, if any. A whole part number counts anywhere; a weak one (a bare word)
 * only when `connRef` says the part's reference is a connector's. Strong names are asked first, weak ones after the library's own.
 */
export function contribName(text: string, connRef: boolean): NameHit | undefined {
  const rs = rules();
  for (const r of rs) if ((!r.weak || connRef) && r.re.test(text)) return r;
  return undefined;
}
/** What to put before a name so the library sizes its connector by this contribution's pins and pitch (sizedConn reads a grid `2x4` and a pitch `_P2.50mm` from a name). */
export function sizeHint(h: NameHit, twoRows: boolean): string {
  if (!h.pins) return h.pitch ? `_P${h.pitch.toFixed(2)}mm ` : '';
  const rows = h.rows ?? (twoRows ? 2 : 1);
  return `${rows}x${Math.ceil(h.pins / rows)}${h.pitch ? `_P${h.pitch.toFixed(2)}mm` : ''} `;
}

// ---- types ----

export function toConnType(d: TypeDef): ConnType {
  return {
    id: d.id, name: d.label, entry: d.entry, body: { ...d.body }, zc: d.zc ?? (d.entry === 'edge' ? Math.round(d.body.h * 50) / 100 : 0), overhang: d.overhang ?? 0, plug: { ...d.plug },
    match: /$^/, cradle: !!d.cradle, ...(d.note ? { note: d.note } : {}),
  };
}
/** The contributed connector types, as the library's own kind (they follow the built-in ones in the library, before Custom). */
export const CONTRIB_TYPES: ConnType[] = PARTS.types.map(toConnType);
const BY_ID = new Map(PARTS.types.map((d) => [d.id, d]));
export const contribDef = (id: string) => BY_ID.get(id);
export const contribThtIds = () => PARTS.types.filter((d) => d.tht).map((d) => d.id);

/** The built-in type a contributed one is wired like (a `net` port is treated as an RJ45, `usb` as USB-C...), else its own id. */
const ALIAS: Record<WiringRole, string> = { usb: 'usb_c', power: 'barrel', net: 'rj45', audio: 'audio35', video: 'hdmi_a', 'mains-in': 'iec_c14', wire: 'terminal', other: '' };
export const roleAlias = (type: string) => { const d = BY_ID.get(type); return (d && ALIAS[d.role]) || type; };
const OFF: Record<WiringRole, string> = { usb: 'to a computer', power: 'to its power supply', net: 'to the network', audio: 'to speakers', video: 'to a screen', 'mains-in': 'to the wall', wire: 'off the rack', other: 'off the rack' };
/** Where a contributed connector's lead goes when it leaves the rack (undefined for the built-in types). */
export const contribOffRack = (type: string) => { const d = BY_ID.get(type); return d ? d.offRack ?? OFF[d.role] : undefined; };
/** The names of contributed types' plugs, for lists ("J3 6.35 mm plug"). */
export const contribPlugNames = (): [string, string][] => PARTS.types.map((d) => [d.id, d.plugName ?? d.label]);
/** A contributed type's drawing, for boardviz.ts (undefined: it is drawn as any unknown connector). */
export const contribLook = (type: string) => { const d = BY_ID.get(type); return d?.look?.length ? { entry: d.entry, look: d.look } : undefined; };

// ---- a picture when there is none ----

export const ICON_COLOR: Record<LookMat | 'dark', string> = { metal: '#c9d0d8', black: '#2a2e33', gold: '#d9aa3c', white: '#ece9e2', blue: '#2f5bd8', red: '#b8322b', yellow: '#e2b21c', tin: '#c9ced4', chip: '#3a3e44', dark: '#15171a' };
export interface IconShape { mat: LookMat | 'dark'; round?: boolean; x: number; y: number; w: number; h: number } // a rectangle or an ellipse, in mm within the view
/**
 * A simple picture of a contributed type made from its look, for the toolbox tile while no rendered one is shipped: a plug
 * on an edge seen from the front (width x height), a part that plugs in from above seen from above (width x length).
 */
export function iconShapes(d: TypeDef): { w: number; h: number; shapes: IconShape[] } {
  const front = d.entry === 'edge', W = d.body.w, H = front ? d.body.h : d.body.l;
  const X = (f: number) => f * W, Y = (fz: number) => (1 - fz) * H, Z = front ? d.body.h : d.body.l;
  const look = d.look?.length ? d.look : ([{ box: 'metal', from: [0, 0, 0], to: [1, 1, 1] }, { mouth: 'rect', at: [0.5, 0.5], size: [0.8, 0.5], depth: 0.6 }] as LookShape[]);
  const shapes: IconShape[] = [];
  for (const s of look) {
    if ('box' in s) { const [a, b] = front ? [[s.from[0], s.from[2]], [s.to[0], s.to[2]]] : [[s.from[0], s.from[1]], [s.to[0], s.to[1]]]; shapes.push({ mat: s.box, x: X(a[0]), y: Y(b[1]), w: X(b[0] - a[0]), h: (b[1] - a[1]) * Z }); }
    else if ('mouth' in s) { if (front) shapes.push({ mat: 'dark', round: s.mouth === 'round', x: X(s.at[0] - s.size[0] / 2), y: Y(s.at[1] + s.size[1] / 2), w: s.size[0] * W, h: s.size[1] * H }); }
    else if ('barrel' in s) {
      const r = (s.d * Math.min(d.body.w, d.body.h)) / 2;
      if (front) { shapes.push({ mat: s.barrel, round: true, x: X(s.at[0]) - r, y: Y(s.at[1]) - r, w: 2 * r, h: 2 * r }); if (s.bore) shapes.push({ mat: 'dark', round: true, x: X(s.at[0]) - r * s.bore, y: Y(s.at[1]) - r * s.bore, w: 2 * r * s.bore, h: 2 * r * s.bore }); }
      else shapes.push({ mat: s.barrel, x: X(s.at[0]) - r, y: Y(s.y[1]), w: 2 * r, h: (s.y[1] - s.y[0]) * d.body.l });
    } else {
      for (let i = 0; i < s.n; i++) {
        const cx = X(s.at[0]) + (i - (s.n - 1) / 2) * s.pitch, up = (s.axis ?? 'z') === 'z';
        if (front) shapes.push({ mat: s.pins, x: cx - s.d / 2, y: up ? Y(s.at[2] + s.len) : Y(s.at[2]) - s.d / 2, w: s.d, h: up ? s.len * H : s.d });
        else shapes.push({ mat: s.pins, x: cx - s.d / 2, y: up ? Y(s.at[1]) - s.d / 2 : Y(s.at[1] + s.len), w: s.d, h: up ? s.d : s.len * d.body.l });
      }
    }
  }
  return { w: W, h: H, shapes };
}
