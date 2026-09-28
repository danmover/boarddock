// Binary Eagle boards: the .brd files Eagle 3, 4 and 5 wrote before Eagle 6 moved to XML, read natively.
//
// CadSoft never published this format. The record layouts here come from two open readers, whose code was studied
// for the facts about the format only (this file is written from scratch for BoardDock):
// - pyeagle by Aleksi Torhamo, eagle.py (https://github.com/alexer/pyeagle): written and checked against Eagle 5.11
//   files, with a viewer that draws them. Record fields, the 1/10000 mm unit, the packed arc encoding, the
//   direction bit of arcs and the string table at the end.
// - pcb-rnd's io_eagle plugin, eagle_bin.c (Tibor Palinkas and Erich Heinzle, GPL-2; http://repo.hu/projects/pcb-rnd),
//   which imports Eagle 3, 4 and 5 boards: which child counts are direct children and which count every record
//   below, the element -> name/value record, and a second reading of each field.
// Where the two disagree this reader says so in a comment and tries both.
//
// The file: records of 24 bytes; the first byte is the record type. Record 0 (type 0x10) holds the number of
// records and the Eagle version. Records nest: a record carries counts of the records that follow as its children
// (a library its packages, a package its lines and pads, the board its libraries, drawing, parts and signals).
// Names longer than their slot are written as a 0x7f byte and kept, in record order, in a string table after the
// last record (marked 13 12 99 19, then its length). Coordinates are signed 32-bit counts of 1/10000 mm; sizes that
// end in "_2" are halves; angles are 12-bit (4096 = 360 degrees); bit 0x1000 of an angle word is "mirrored".
import type { Board, Comp, Hole, Pin, V2 } from '../model/types';
import { arcCenter, bbox, chainLoops, deg, outlineFromLoops, rad, uid } from '../geom/poly';
import { finishBoard } from './common';

const REC = 24;
const MM = 1e-4; // one file unit in mm
const STRINGS_MARK = [0x13, 0x12, 0x99, 0x19];

// record types this reader uses
const T = {
  start: 0x10, layer: 0x13, schema: 0x14, library: 0x15, packages: 0x19, board: 0x1b, signal: 0x1c, pkg: 0x1e, polygon: 0x21,
  line: 0x22, arc: 0x24, circle: 0x25, rect: 0x26, hole: 0x28, via: 0x29, pad: 0x2a, smd: 0x2b, element: 0x2e, element2: 0x2f,
} as const;

/**
 * Where each record type keeps the counts of its children: [byte offset, byte length, direct]. Each count is of the
 * records that follow, in order. pyeagle treats every count as "all the records below"; pcb-rnd reads the ones
 * marked direct as "direct children only". They only differ where such a child has children of its own (a copper
 * pour inside a signal, say), so both readings are tried and the one that fits the file exactly is used.
 */
type Group = [off: number, len: 2 | 4, direct: boolean];
const GROUPS: Record<number, Group[]> = {
  0x15: [[4, 4, false], [8, 4, false], [12, 4, false]], // library: devices, symbols, packages
  0x17: [[4, 4, true]], // devices
  0x18: [[4, 4, false]], // symbols
  0x19: [[4, 4, false]], // packages
  0x1a: [[2, 2, true], [12, 4, false], [16, 4, false], [20, 4, false]], // schematic sheet
  0x1b: [[12, 4, false], [2, 2, true], [16, 4, false], [20, 4, false]], // board: libraries, drawing, parts, signals
  0x1c: [[2, 2, true]], // signal
  0x1d: [[2, 2, true]], // symbol
  0x1e: [[2, 2, false]], // package
  0x1f: [[2, 2, true]], // schematic net
  0x20: [[2, 2, true]], // path
  0x21: [[2, 2, true]], // polygon
  0x2e: [[2, 2, true]], // element (part placed on the board)
  0x30: [[2, 2, true]], // gate instance
  0x36: [[2, 2, true]], // package variant
  0x37: [[4, 2, false], [2, 2, false]], // device: variants, gates
  0x38: [[2, 2, true]], // schematic part
  0x3a: [[2, 2, true]], // bus
};

/**
 * The name fields of each record type, [offset, length], in the order their long names sit in the string table.
 * pyeagle reads a record's names from the last field back (as below); pcb-rnd from the first. It only matters when
 * one record has two long names (a part name over 8 characters and a value over 14); pyeagle's order is used.
 */
const TEXT: [number, number][] = [[18, 6]];
const NAMES: Record<number, [number, number][]> = {
  0x13: [[15, 9]], 0x14: [[19, 5]], 0x15: [[16, 8]], 0x17: [[16, 8]], 0x18: [[16, 8]], 0x19: [[16, 8], [10, 6]],
  0x1c: [[16, 8]], 0x1d: [[16, 8]], 0x1e: [[18, 6], [13, 5]], 0x1f: [[16, 8]], 0x2a: [[19, 5]], 0x2b: [[19, 5]],
  0x2c: [[14, 10]], 0x2d: [[16, 8]], 0x2f: [[10, 14], [2, 8]], 0x36: [[19, 5], [6, 13]], 0x37: [[18, 6], [13, 5], [8, 5]],
  0x38: [[16, 8], [11, 5]], 0x3a: [[4, 20]], 0x42: [[7, 17], [2, 5]],
  0x31: TEXT, 0x33: TEXT, 0x34: TEXT, 0x35: TEXT, 0x3f: TEXT, 0x40: TEXT, 0x41: TEXT, 0x44: TEXT,
};

/** One record and the records nested under it. `group` is which of its parent's child lists it is in. */
export interface EagleRec { t: number; i: number; group: number; kids: EagleRec[] }

export interface EagleFile {
  version: [number, number];
  records: number;
  root: EagleRec;
  bytes: Uint8Array;
  /** names by record index and field offset, long ones filled in from the string table */
  names: Map<number, Map<number, string>>;
  /** false when the string table did not match the records (long names may be on the wrong things) */
  stringsOk: boolean;
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function hasStringTable(b: Uint8Array, n: number): boolean {
  const o = n * REC;
  return o + 8 <= b.length && STRINGS_MARK.every((v, k) => b[o + k] === v);
}

/** A binary Eagle file: its first record is a start record whose record count fits the file. */
export function isEagleBinary(b: Uint8Array): boolean {
  if (b.length < 2 * REC || b[0] !== T.start || (b[1] & 0x7f) !== 0) return false;
  const n = dv(b).getUint32(4, true), major = b[8];
  if (n < 2 || n * REC > b.length) return false;
  return hasStringTable(b, n) || (major >= 3 && major <= 5);
}

function readTree(b: Uint8Array, n: number, major: number, directAware: boolean): EagleRec {
  const d = dv(b);
  let pos = 1;
  const node = (group: number, depth: number): EagleRec => {
    if (pos >= n || depth > 64) throw new Error('records overrun');
    const i = pos++, o = i * REC, t = b[o];
    const r: EagleRec = { t, i, group, kids: [] };
    let groups = GROUPS[t] ?? [];
    // the schematic record: attributes (Eagle 5 on), libraries, sheets
    if (t === T.schema) groups = major >= 5 ? [[12, 4, false], [4, 4, false], [8, 4, false]] : [[4, 4, false], [8, 4, false]];
    groups.forEach(([off, len, direct], gi) => {
      const count = len === 2 ? d.getUint16(o + off, true) : d.getUint32(o + off, true);
      if (direct && directAware) {
        for (let k = 0; k < count; k++) r.kids.push(node(gi, depth + 1));
      } else {
        const end = pos + count;
        if (end > n) throw new Error('child count past the end');
        while (pos < end) r.kids.push(node(gi, depth + 1));
        if (pos !== end) throw new Error('children overrun their count');
      }
    });
    return r;
  };
  const root: EagleRec = { t: T.start, i: 0, group: 0, kids: [] };
  while (pos < n) root.kids.push(node(0, 1));
  if (pos !== n) throw new Error('records overrun');
  return root;
}

const latin1 = (b: Uint8Array) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };

/** Read the record tree and every name. Throws when the file is not a binary Eagle file this reader can follow. */
export function parseEagleBinary(b: Uint8Array): EagleFile {
  if (!isEagleBinary(b)) throw new Error('Not a binary Eagle file');
  const n = dv(b).getUint32(4, true), major = b[8], minor = b[9];
  let root: EagleRec | null = null;
  for (const directAware of [true, false]) {
    try { root = readTree(b, n, major, directAware); break; } catch { /* try the other reading */ }
  }
  if (!root) throw new Error(`This binary Eagle ${major}.${minor} file is laid out in a way BoardDock cannot follow. Ask whoever made the board for STEP, IDF or Gerber + drill files, or draw the board in BoardDock.`);
  // the string table: long names in record order, each ended by a 0 byte, the list ended by empty strings
  let strings: string[] = [];
  if (hasStringTable(b, n)) {
    const o = n * REC, size = dv(b).getUint32(o + 4, true);
    strings = latin1(b.subarray(o + 8, Math.min(b.length, o + 8 + size))).split('\0');
    while (strings.length && strings[strings.length - 1] === '') strings.pop();
  }
  let next = 0, over = false;
  const names = new Map<number, Map<number, string>>();
  for (let i = 1; i < n; i++) {
    const o = i * REC, fields = NAMES[b[o]];
    if (!fields) continue;
    const m = new Map<number, string>();
    for (const [off, len] of fields) {
      if (b[o + off] === 0x7f) {
        if (next < strings.length) m.set(off, strings[next++]);
        else { over = true; m.set(off, ''); }
      } else {
        const raw = b.subarray(o + off, o + off + len), z = raw.indexOf(0);
        m.set(off, latin1(z >= 0 ? raw.subarray(0, z) : raw));
      }
    }
    names.set(i, m);
  }
  return { version: [major, minor], records: n, root, bytes: b, names, stringsOk: !over && next === strings.length };
}

// ---------- geometry of single records (file units -> mm, in the record's own frame) ----------

interface Shape { layer: number; pts: V2[]; closed?: boolean }

const TAU = Math.PI * 2;

/** A line or arc record as a polyline in mm; null for air wires (unrouted connections). */
function lineShape(b: Uint8Array, i: number): Shape | null {
  const o = i * REC, d = dv(b), t = b[o], layer = b[o + 3];
  const code = b[o + 23];
  let packed: boolean, quarter: number, half: number;
  if (t === T.line) {
    if (code === 0x01) return null; // air wire
    packed = code === 0x81;
    quarter = code >= 0x78 && code <= 0x7b ? code - 0x78 + 1 : 0;
    half = code >= 0x7c && code <= 0x7f ? code - 0x7c + 1 : 0;
  } else { // the Eagle 4 arc record
    packed = code === 0;
    quarter = code >= 1 && code <= 4 ? code : 0;
    half = code >= 5 && code <= 8 ? code - 4 : 0;
  }
  let x1: number, y1: number, x2: number, y2: number, cx = 0, cy = 0;
  if (packed) {
    // x1, y1, x2, y2 in 3 bytes each; the 4th byte of each of the first three words is one byte of c, the centre's
    // x or y (whichever the chord is flatter along); byte 19 holds the sign bits of c, x1, y1, x2, y2
    const neg = b[o + 19];
    const v3 = (off: number, bit: number) => (b[o + off] | (b[o + off + 1] << 8) | (b[o + off + 2] << 16)) - (neg & bit ? 0x1000000 : 0);
    x1 = v3(4, 2); y1 = v3(8, 4); x2 = v3(12, 8); y2 = v3(16, 16);
    const c = (b[o + 7] | (b[o + 11] << 8) | (b[o + 15] << 16)) - (neg & 1 ? 0x1000000 : 0);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    // the centre sits on the perpendicular bisector of the chord
    if (Math.abs(x2 - x1) < Math.abs(y2 - y1)) { cx = c; cy = ((mx - cx) * (x2 - x1)) / (y2 - y1) + my; }
    else { cy = c; cx = ((my - cy) * (y2 - y1)) / (x2 - x1) + mx; }
  } else {
    x1 = d.getInt32(o + 4, true); y1 = d.getInt32(o + 8, true); x2 = d.getInt32(o + 12, true); y2 = d.getInt32(o + 16, true);
    // quarter arcs name their centre's corner of the box the two ends make; half arcs are centred on the chord
    if (quarter) { cx = quarter === 1 || quarter === 4 ? Math.min(x1, x2) : Math.max(x1, x2); cy = quarter <= 2 ? Math.min(y1, y2) : Math.max(y1, y2); }
    if (half) { cx = (x1 + x2) / 2; cy = (y1 + y2) / 2; }
  }
  const a: V2 = [x1 * MM, y1 * MM], e: V2 = [x2 * MM, y2 * MM];
  if (!packed && !quarter && !half) return { layer, pts: [a, e] };
  const c: V2 = [cx * MM, cy * MM];
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  if (!(r > 1e-6) || !isFinite(r)) return { layer, pts: [a, e] };
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  const up = (((a1 - a0) % TAU) + TAU) % TAU || TAU; // counter-clockwise sweep, 0..360
  // bit 0x20: the arc runs counter-clockwise (pyeagle draws it with increasing angle). Quarter arcs are 90 degrees
  // by their type, so the short way round is taken whatever the bit says.
  let sweep = b[o + 22] & 0x20 ? up : up - TAU;
  if (quarter) sweep = up <= Math.PI ? up : up - TAU;
  const pts = arcCenter(c, a, deg(sweep));
  pts[pts.length - 1] = e; // end exactly on the stored end point, so outline pieces join
  return { layer, pts };
}

function circleShape(b: Uint8Array, i: number): Shape {
  const o = i * REC, d = dv(b);
  const c: V2 = [d.getInt32(o + 4, true) * MM, d.getInt32(o + 8, true) * MM], r = d.getInt32(o + 12, true) * MM;
  const pts = arcCenter(c, [c[0] + r, c[1]], 360);
  return { layer: b[o + 3], pts: pts.slice(0, -1), closed: true };
}

function rectShape(b: Uint8Array, i: number): Shape {
  const o = i * REC, d = dv(b);
  const x1 = d.getInt32(o + 4, true) * MM, y1 = d.getInt32(o + 8, true) * MM, x2 = d.getInt32(o + 12, true) * MM, y2 = d.getInt32(o + 16, true) * MM;
  const ang = rad(((d.getUint16(o + 20, true) & 0xfff) * 360) / 4096), ca = Math.cos(ang), sa = Math.sin(ang);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, hw = Math.abs(x2 - x1) / 2, hh = Math.abs(y2 - y1) / 2;
  const pts: V2[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + x * ca - y * sa, cy + x * sa + y * ca]);
  return { layer: b[o + 3], pts, closed: true };
}

const angleOf = (b: Uint8Array, o: number) => ((dv(b).getUint16(o, true) & 0xfff) * 360) / 4096;
const xy = (b: Uint8Array, o: number): V2 => [dv(b).getInt32(o + 4, true) * MM, dv(b).getInt32(o + 8, true) * MM];
const half = (b: Uint8Array, o: number) => dv(b).getUint16(o, true) * 2 * MM; // a stored half size, doubled, in mm

// ---------- packages and the board ----------

const BODY_LAYERS = new Set([21, 22, 51, 52, 39, 40]); // place, documentation and keep-out, top and bottom
const DIMENSION = 20;
const TOP_COPPER = 1, BOTTOM_COPPER = 16;

interface Pkg {
  name: string;
  dims: V2[][]; // cut-outs drawn in the package on the Dimension layer
  body: V2[]; // points of its outline drawings
  pads: { at: V2; drill: number; dia: number; name: string }[];
  smds: { at: V2; dx: number; dy: number; rot: number; name: string }[];
  holes: { at: V2; d: number }[];
}

function descendants(r: EagleRec): EagleRec[] {
  const out: EagleRec[] = [];
  const walk = (x: EagleRec) => { for (const k of x.kids) { out.push(k); walk(k); } };
  walk(r);
  return out;
}

function readPkg(f: EagleFile, p: EagleRec): Pkg {
  const b = f.bytes;
  const pk: Pkg = { name: f.names.get(p.i)?.get(18) ?? '', dims: [], body: [], pads: [], smds: [], holes: [] };
  for (const r of descendants(p)) {
    const o = r.i * REC;
    if (r.t === T.line || r.t === T.arc || r.t === T.circle || r.t === T.rect) {
      const s = r.t === T.circle ? circleShape(b, r.i) : r.t === T.rect ? rectShape(b, r.i) : lineShape(b, r.i);
      if (!s) continue;
      if (s.layer === DIMENSION && r.t !== T.rect) pk.dims.push(s.closed ? [...s.pts, s.pts[0]] : s.pts);
      if (BODY_LAYERS.has(s.layer)) pk.body.push(...s.pts);
    } else if (r.t === T.pad) {
      pk.pads.push({ at: xy(b, o), drill: half(b, o + 12), dia: half(b, o + 14), name: f.names.get(r.i)?.get(19) ?? '' });
    } else if (r.t === T.smd) {
      pk.smds.push({ at: xy(b, o), dx: half(b, o + 12), dy: half(b, o + 14), rot: angleOf(b, o + 16), name: f.names.get(r.i)?.get(19) ?? '' });
    } else if (r.t === T.hole) {
      pk.holes.push({ at: xy(b, o), d: half(b, o + 12) });
    }
  }
  return pk;
}

/** Footprint names that are headers or connectors, whose pins are worth keeping (Eagle's pin headers are "1X04", "2X05"). */
const PIN_PKG = /header|conn|socket|idc|jst|molex|uart|serial|ftdi|pinhd|^[12]x\d{2}\b|^ma\d\d-\d/i;
const MOUNT_PKG = /hole|mount|mtg|stand ?off/i;

/** Read a binary Eagle board into BoardDock's board, the same way the XML Eagle importer does. */
export function importEagleBinary(bytes: Uint8Array, fileName = 'board.brd'): Board {
  const f = parseEagleBinary(bytes);
  const b = f.bytes;
  const [major, minor] = f.version;
  const board = descendants(f.root).find((r) => r.t === T.board);
  if (!board) throw new Error('This binary Eagle file holds no board: it looks like a schematic (.sch) or a library (.lbr). Drop the .brd file.');
  const nameAt = (i: number, off: number) => f.names.get(i)?.get(off) ?? '';

  // the board's libraries, and the packages of each (parts point at them by 1-based number)
  const libs = board.kids.filter((k) => k.group === 0 && k.t === T.library).map((lib) => ({
    name: nameAt(lib.i, 16),
    pkgs: (lib.kids.find((k) => k.t === T.packages)?.kids ?? []).filter((k) => k.t === T.pkg).map((p) => readPkg(f, p)),
  }));

  const paths: V2[][] = [];
  const holes: Hole[] = [];
  const traces: NonNullable<Board['traces']> = [];
  const vias: NonNullable<Board['vias']> = [];

  // the board drawing: outline on the Dimension layer, holes
  for (const r of board.kids.filter((k) => k.group === 1)) {
    if (r.t === T.line || r.t === T.arc) { const s = lineShape(b, r.i); if (s && s.layer === DIMENSION) paths.push(s.pts); }
    else if (r.t === T.circle) { const s = circleShape(b, r.i); if (s.layer === DIMENSION) paths.push([...s.pts, s.pts[0]]); }
    else if (r.t === T.hole) { const [x, y] = xy(b, r.i * REC); holes.push({ id: uid('h'), x, y, d: half(b, r.i * REC + 12), plated: false, use: 'auto' }); }
  }

  // signals: copper tracks and vias, for the 3D view
  for (const r of board.kids.filter((k) => k.group === 3).flatMap((s) => [s, ...descendants(s)])) {
    if (r.t === T.via) {
      const o = r.i * REC, [x, y] = xy(b, o), drill = half(b, o + 12), dia = half(b, o + 14);
      vias.push({ x, y, d: dia || drill + 0.3 });
    } else if (r.t === T.line || r.t === T.arc) {
      const s = lineShape(b, r.i);
      if (!s || (s.layer !== TOP_COPPER && s.layer !== BOTTOM_COPPER)) continue;
      const w = half(b, r.i * REC + 20);
      for (let k = 1; k < s.pts.length; k++) traces.push({ a: s.pts[k - 1], b: s.pts[k], w, side: s.layer === TOP_COPPER ? 'top' : 'bottom' });
    }
  }

  // parts
  const comps: Comp[] = [];
  let missing = 0;
  for (const el of board.kids.filter((k) => k.group === 2 && k.t === T.element)) {
    const o = el.i * REC, d = dv(b);
    const [ex, ey] = xy(b, o);
    const pk = libs[d.getUint16(o + 12, true) - 1]?.pkgs[d.getUint16(o + 14, true) - 1];
    // name and value sit in the record right after the part (pcb-rnd reads it as its first child)
    const n2 = el.kids.find((k) => k.t === T.element2)?.i ?? (b[(el.i + 1) * REC] === T.element2 ? el.i + 1 : -1);
    const ref = n2 >= 0 ? nameAt(n2, 2) : '', value = n2 >= 0 ? nameAt(n2, 10) : '';
    if (!pk) { missing++; continue; }
    const ang = angleOf(b, o + 16), mirror = (d.getUint16(o + 16, true) & 0x1000) !== 0;
    // pyeagle draws a part as: rotate, then mirror left-right, then move into place
    const r0 = rad(ang), cr = Math.cos(r0), sr = Math.sin(r0), mx = mirror ? -1 : 1;
    const tf = (p: V2): V2 => [ex + mx * (p[0] * cr - p[1] * sr), ey + p[0] * sr + p[1] * cr];
    for (const dim of pk.dims) paths.push(dim.map(tf)); // cut-outs drawn in the package
    const isMount = MOUNT_PKG.test(pk.name);
    const padPts: V2[] = [], pins: Pin[] = [];
    let tht = false;
    for (const p of pk.pads) {
      const rr = (p.dia || p.drill * 1.6) / 2;
      padPts.push([p.at[0] - rr, p.at[1] - rr], [p.at[0] + rr, p.at[1] + rr]);
      if (isMount && p.drill >= 1.5) { const [x, y] = tf(p.at); holes.push({ id: uid('h'), x, y, d: p.drill, plated: true, use: 'auto' }); }
      else tht = true;
      if (p.name && !pins.some((q) => q.n === p.name)) { const [x, y] = tf(p.at); pins.push({ n: p.name, x, y }); }
    }
    for (const s of pk.smds) {
      const a = rad(s.rot), ca = Math.cos(a), sa = Math.sin(a);
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) padPts.push([s.at[0] + (u * s.dx * ca - v * s.dy * sa) / 2, s.at[1] + (u * s.dx * sa + v * s.dy * ca) / 2]);
      if (s.name && !pins.some((q) => q.n === s.name)) { const [x, y] = tf(s.at); pins.push({ n: s.name, x, y }); }
    }
    for (const h of pk.holes) {
      const [x, y] = tf(h.at);
      if (isMount || h.d >= 2.2) holes.push({ id: uid('h'), x, y, d: h.d, plated: false, use: 'auto' });
    }
    if (isMount) continue;
    const src = pk.body.length > 1 ? pk.body : padPts;
    if (src.length < 2) continue;
    const bb = bbox(src);
    const [cx, cy] = tf([(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2]);
    comps.push({
      id: uid('c'), ref: ref || '?', pkg: pk.name, value, side: mirror ? 'bottom' : 'top',
      x: cx, y: cy, rot: mirror ? -ang : ang, w: Math.max(0.3, bb.x1 - bb.x0), l: Math.max(0.3, bb.y1 - bb.y0), h: 0, kind: 'generic', tht,
      ...(PIN_PKG.test(pk.name) && pins.length >= 2 && pins.length <= 40 ? { pins } : {}),
    });
  }

  const ol = outlineFromLoops(chainLoops(paths, 0.02));
  if (!ol) throw new Error('No closed board outline on the Dimension layer (20) of this binary Eagle file.');
  const notes = [`Read from a binary Eagle ${major}.${minor} file. This format was never published, so check the outline, holes and parts against your board.`];
  if (!f.stringsOk) notes.push('Some long names in the file could not be matched up: part names or values may be wrong.');
  if (missing) notes.push(`${missing} part${missing > 1 ? 's' : ''} pointed at a package the file does not hold and ${missing > 1 ? 'were' : 'was'} left out.`);
  const out: Board = {
    name: fileName.replace(/\.brd$/i, ''), outline: ol.outline, cutouts: ol.cutouts, thickness: 1.6, // Eagle keeps the stack-up in the design rules; 1.6 mm assumed
    holes, comps, source: `Eagle ${major} (binary): ${fileName}`, notes, traces, vias,
  };
  return finishBoard(out, { sizesKnown: true });
}
