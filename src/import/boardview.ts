// Board-viewer files: the repair-shop formats that OpenBoardView opens, often named .brd like Eagle and Allegro
// boards. They hold the board outline, every part's name and side, and the position (and net) of every pin, but no
// package names, part sizes or holes. Read here:
// - Test_Link .brd: text, usually obfuscated (each byte rotated left by 2 and inverted), sections str_length:,
//   var_data:, Format:, Parts:, Pins:, Nails:
// - BRD2: text with BRDOUT:, NETS:, PARTS:, PINS:, NAILS:
// - .bdv: text obfuscated with a key that counts up line by line, sections <<format.asc>>, <<pins.asc>>
// - .bv / .bvr: BVRAW_FORMAT_1 (<<Layout>>, <<Pin>>) and BVRAW_FORMAT_3 (PART_NAME ... PIN_END ... PART_END)
// Layouts from OpenBoardView's src/openboardview/FileFormats (BRDFile.cpp, BRD2File.cpp, BDVFile.cpp,
// BVRFile.cpp, BVR3File.cpp; https://github.com/OpenBoardView/OpenBoardView, MIT licence). Units there are mils
// (thousandths of an inch); .bdv and BVRAW_FORMAT_1 store inches.
import type { Board, Comp, Loop, Pin, V2 } from '../model/types';
import { bbox, chainLoops, outlineFromLoops, uid } from '../geom/poly';
import { finishBoard } from './common';

export type BoardViewKind = 'testlink' | 'brd2' | 'bdv' | 'bvr1' | 'bvr3';

interface BVPin { x: number; y: number; n?: string; net?: string; side?: 'top' | 'bottom' | 'both' }
interface BVPart { name: string; side: 'top' | 'bottom' | 'both'; smd: boolean; pins: BVPin[] }
interface BVData { outline: V2[]; segments: [V2, V2][]; parts: BVPart[]; mils: boolean }

const TESTLINK_MAGIC = [0x23, 0xe2, 0x63, 0x28];
const BDV_MAGIC = 'dd:1.3?,r?-=bb';

const latin1 = (b: Uint8Array) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };

/** Test_Link obfuscation: every byte but line ends and 0 is rotated left by two bits and inverted. */
export function decodeTestLink(b: Uint8Array): string {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    out[i] = x === 13 || x === 10 || x === 0 ? x : ~((x >> 6) | (x << 2)) & 0xff;
  }
  return latin1(out);
}

/** .bdv obfuscation: each byte is subtracted from a key that starts at 160 and goes up by one at each CR LF. */
export function decodeBdv(b: Uint8Array): string {
  const out = new Uint8Array(b.length);
  let key = 0xa0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 13 && b[i + 1] === 10) key++;
    const x = b[i];
    out[i] = x === 13 || x === 10 || x === 0 ? x : (key - x) & 0xff;
    if (key > 285) key = 159;
  }
  return latin1(out);
}

const startsWith = (b: Uint8Array, m: number[]) => m.every((v, i) => b[i] === v);

/** Which board-viewer format these bytes are, if any. */
export function sniffBoardView(b: Uint8Array): BoardViewKind | null {
  if (b.length < 8) return null;
  if (startsWith(b, TESTLINK_MAGIC)) return 'testlink';
  const s = latin1(b.subarray(0, Math.min(b.length, 4e6)));
  if (s.includes('str_length:') && s.includes('var_data:')) return 'testlink';
  if (s.includes('BRDOUT:') && s.includes('NETS:')) return 'brd2';
  if (s.includes(BDV_MAGIC) || (s.includes('<<format.asc>>') && s.includes('<<pins.asc>>'))) return 'bdv';
  if (s.includes('BVRAW_FORMAT_1')) return 'bvr1';
  if (s.includes('BVRAW_FORMAT_3')) return 'bvr3';
  return null;
}

const lines = (s: string) => s.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
const toks = (l: string) => l.split(/\s+/).filter(Boolean);
const num = (s: string | undefined) => (s === undefined ? NaN : Number(s));
const isNum = (s: string | undefined) => s !== undefined && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s);

function readTestLink(text: string): BVData {
  const d: BVData = { outline: [], segments: [], parts: [], mils: true };
  const pins: (BVPin & { part: number })[] = [];
  let block = '';
  for (const l of lines(text)) {
    const head = l.toLowerCase();
    if (head === 'str_length:' || head === 'var_data:' || head === 'format:' || head === 'nails:') { block = head; continue; }
    if (l === 'Parts:' || l === 'Pins1:') { block = 'parts'; continue; }
    if (l === 'Pins:' || l === 'Pins2:') { block = 'pins'; continue; }
    const t = toks(l);
    if (block === 'format:' && isNum(t[0]) && isNum(t[1])) d.outline.push([num(t[0]), num(t[1])]);
    else if (block === 'parts' && t.length >= 3) {
      // name, type and side (bit 2-3: surface mount; 1 or 4-7: top; 2 or 8 and up: bottom), index of its last pin
      const k = num(t[1]);
      const side = k === 1 || (k >= 4 && k < 8) ? 'top' : k === 2 || k >= 8 ? 'bottom' : 'both';
      d.parts.push({ name: t[0], side, smd: (k & 0xc) !== 0, pins: [] });
    } else if (block === 'pins' && t.length >= 4 && isNum(t[0]) && isNum(t[1])) {
      pins.push({ x: num(t[0]), y: num(t[1]), part: num(t[3]), net: t[4] });
    }
  }
  for (const p of pins) {
    const part = d.parts[p.part - 1];
    if (part) part.pins.push({ x: p.x, y: p.y, net: p.net });
  }
  return d;
}

function readBrd2(text: string): BVData {
  const d: BVData = { outline: [], segments: [], parts: [], mils: true };
  const nets = new Map<string, string>();
  const starts: number[] = [];
  const pins: BVPin[] = [];
  let block = '', maxY = 0;
  for (const l of lines(text)) {
    const m = /^(BRDOUT|NETS|PARTS|PINS|NAILS):(.*)$/.exec(l);
    if (m) { block = m[1]; if (block === 'BRDOUT') maxY = num(toks(m[2])[2]) || 0; continue; }
    const t = toks(l);
    if (block === 'BRDOUT' && isNum(t[0]) && isNum(t[1])) d.outline.push([num(t[0]), num(t[1])]);
    else if (block === 'NETS' && t.length >= 2) nets.set(t[0], t[1]);
    else if (block === 'PARTS' && t.length >= 7) {
      // name, x1 y1 x2 y2 (its box), index of its first pin, side (1 top, 2 bottom, 0 both)
      const side = t[6] === '1' ? 'top' : t[6] === '2' ? 'bottom' : 'both';
      d.parts.push({ name: t[0], side, smd: true, pins: [] });
      starts.push(num(t[5]));
    } else if (block === 'PINS' && t.length >= 4 && isNum(t[0])) {
      const s = t[3] === '1' ? 'top' : t[3] === '2' ? 'bottom' : 'both';
      // pins not on the top are stored mirrored top to bottom about the board's height
      pins.push({ x: num(t[0]), y: s === 'top' ? num(t[1]) : maxY - num(t[1]), net: nets.get(t[2]), side: s });
    }
  }
  d.parts.forEach((p, i) => {
    const end = i + 1 < d.parts.length ? starts[i + 1] : pins.length;
    p.pins = pins.slice(starts[i], end);
    // all pins on the other side, or on both: a through-hole part
    if (p.pins.length && !p.pins.some((q) => q.side === p.side)) { p.smd = false; p.side = 'both'; }
  });
  return d;
}

function readBdv(text: string): BVData {
  const d: BVData = { outline: [], segments: [], parts: [], mils: false };
  let block = '';
  for (const l of lines(text)) {
    if (l === '<<format.asc>>') { block = 'format'; continue; }
    if (l === '<<pins.asc>>') { block = 'pins'; continue; }
    if (l.startsWith('<<')) { block = ''; continue; }
    const t = toks(l);
    if (block === 'format' && t.length >= 2 && isNum(t[0]) && isNum(t[1])) d.outline.push([num(t[0]), num(t[1])]);
    else if (block === 'pins') {
      if (t[0] === 'Part' && t[1]) d.parts.push({ name: t[1], side: t[2] === '(T)' ? 'top' : 'bottom', smd: true, pins: [] });
      // pin number, pin name, x, y, layer, net, probe
      else if (d.parts.length && t.length >= 4 && isNum(t[2]) && isNum(t[3])) d.parts[d.parts.length - 1].pins.push({ x: num(t[2]), y: num(t[3]), n: t[1], net: t[5] });
    }
  }
  return d;
}

function readBvr1(text: string): BVData {
  const d: BVData = { outline: [], segments: [], parts: [], mils: false };
  let block = '';
  for (const l of lines(text)) {
    if (l === '<<Layout>>') { block = 'layout'; continue; }
    if (l === '<<Pin>>') { block = 'pin'; continue; }
    if (l.startsWith('<<')) { block = ''; continue; }
    const t = toks(l.replace(/,/g, ' '));
    if (block === 'layout' && t.length >= 2 && isNum(t[0]) && isNum(t[1])) d.outline.push([num(t[0]), num(t[1])]);
    else if (block === 'pin' && t.length >= 6 && isNum(t[4]) && isNum(t[5])) {
      // part name, side, pin id, pin name, x, y, layer, net
      let part = d.parts[d.parts.length - 1];
      if (!part || part.name !== t[0]) { part = { name: t[0], side: t[1] === '(T)' ? 'top' : 'bottom', smd: true, pins: [] }; d.parts.push(part); }
      part.pins.push({ x: num(t[4]), y: num(t[5]), n: t[3], net: t[7] });
    }
  }
  return d;
}

function readBvr3(text: string): BVData {
  const d: BVData = { outline: [], segments: [], parts: [], mils: true };
  const sideOf = (s: string) => (s === 'T' ? 'top' : s === 'B' ? 'bottom' : 'both');
  let part: BVPart & { at: V2 } = { name: '', side: 'top', smd: true, pins: [], at: [0, 0] };
  let pin: BVPin = { x: 0, y: 0 };
  for (const l of lines(text)) {
    const [key, ...v] = toks(l);
    const nums = v.map(Number);
    if (key === 'PART_NAME') part.name = v[0] ?? '';
    else if (key === 'PART_SIDE') part.side = sideOf(v[0]);
    else if (key === 'PART_ORIGIN') part.at = [nums[0] || 0, nums[1] || 0];
    else if (key === 'PART_MOUNT') part.smd = v[0] === 'SMD';
    else if (key === 'PIN_NUMBER') pin.n = v[0];
    else if (key === 'PIN_NET') pin.net = v[0];
    else if (key === 'PIN_ORIGIN') { pin.x = (nums[0] || 0) + part.at[0]; pin.y = (nums[1] || 0) + part.at[1]; }
    else if (key === 'PIN_END') { part.pins.push(pin); pin = { x: 0, y: 0 }; }
    else if (key === 'PART_END') { d.parts.push({ name: part.name, side: part.side, smd: part.smd, pins: part.pins }); part = { name: '', side: 'top', smd: true, pins: [], at: [0, 0] }; }
    else if (key === 'OUTLINE_POINTS') for (let k = 0; k + 1 < nums.length; k += 2) d.outline.push([nums[k], nums[k + 1]]);
    else if (key === 'OUTLINE_SEGMENTED') for (let k = 0; k + 3 < nums.length; k += 4) d.segments.push([[nums[k], nums[k + 1]], [nums[k + 2], nums[k + 3]]]);
  }
  return d;
}

/** Outline points run as loops: a loop closes where it comes back to its first point, and the next one starts. */
function pointLoops(pts: V2[], tol: number): Loop[] {
  const loops: Loop[] = [];
  let cur: V2[] = [];
  for (const p of pts) {
    if (cur.length > 2 && Math.hypot(p[0] - cur[0][0], p[1] - cur[0][1]) <= tol) { loops.push(cur); cur = []; continue; }
    if (!cur.length || Math.hypot(p[0] - cur[cur.length - 1][0], p[1] - cur[cur.length - 1][1]) > tol) cur.push(p);
  }
  if (cur.length > 2) loops.push(cur);
  return loops;
}

const PIN_PART = /^(J|P|CN|X|JP|CON|USB|HDR|HDMI)\d/i;

/** Read a board-viewer file: outline, and each part as the spread of its pins. */
export function importBoardView(bytes: Uint8Array, fileName = 'board.brd'): Board {
  const kind = sniffBoardView(bytes);
  if (!kind) throw new Error('Not a board-viewer file BoardDock knows');
  const raw = latin1(bytes);
  const text = kind === 'testlink' && startsWith(bytes, TESTLINK_MAGIC) ? decodeTestLink(bytes)
    : kind === 'bdv' && !raw.includes('<<format.asc>>') ? decodeBdv(bytes) : raw;
  const d = kind === 'testlink' ? readTestLink(text) : kind === 'brd2' ? readBrd2(text) : kind === 'bdv' ? readBdv(text) : kind === 'bvr1' ? readBvr1(text) : readBvr3(text);
  const k = d.mils ? 0.0254 : 25.4; // to mm
  const mm = (p: V2): V2 => [p[0] * k, p[1] * k];

  const comps: Comp[] = [];
  const allPins: V2[] = [];
  for (const part of d.parts) {
    if (!part.pins.length || !part.name || part.name === '...') continue;
    const pts = part.pins.map((q) => mm([q.x, q.y]));
    allPins.push(...pts);
    const bb = bbox(pts);
    // the file gives pin centres only: the body is taken as their spread plus a pad's width around them
    const pad = 0.8;
    const pins: Pin[] = [];
    part.pins.forEach((q, i) => {
      const n = q.n ?? String(i + 1);
      if (!pins.some((x) => x.n === n)) pins.push({ n, x: q.x * k, y: q.y * k, ...(q.net && !/^(unconnected|nc)$/i.test(q.net) ? { net: q.net } : {}) });
    });
    comps.push({
      id: uid('c'), ref: part.name, pkg: '', side: part.side === 'bottom' ? 'bottom' : 'top',
      x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, rot: 0, w: bb.x1 - bb.x0 + pad, l: bb.y1 - bb.y0 + pad, h: 0, kind: 'generic',
      tht: !part.smd || part.side === 'both',
      ...(PIN_PART.test(part.name) && pins.length >= 2 && pins.length <= 40 ? { pins } : {}),
    });
  }

  const tol = 0.05;
  let loops = pointLoops(d.outline.map(mm), tol);
  if (d.segments.length) loops = [...loops, ...chainLoops(d.segments.map(([a, b]) => [mm(a), mm(b)]), tol)];
  let ol = outlineFromLoops(loops);
  const notes = ['Board-viewer files hold part names and pin positions only: part sizes are the spread of their pins, heights are guessed, and there are no holes. Check connectors and add mounting holes by hand.'];
  if (!ol) {
    if (allPins.length < 2) throw new Error('This board-viewer file has no outline and no parts to read.');
    const bb = bbox(allPins), m = 2;
    ol = { outline: [[bb.x0 - m, bb.y0 - m], [bb.x1 + m, bb.y0 - m], [bb.x1 + m, bb.y1 + m], [bb.x0 - m, bb.y1 + m]], cutouts: [] };
    notes.unshift('The file has no board outline: a rectangle 2 mm around the parts was used. Change it in the board editor.');
  }
  const names = { testlink: 'Test_Link board view', brd2: 'BRD2 board view', bdv: 'BDV board view', bvr1: 'BVR board view', bvr3: 'BVR3 board view' };
  const b: Board = {
    name: fileName.replace(/\.(brd|bdv|bvr?|bv)$/i, ''), outline: ol.outline, cutouts: ol.cutouts, thickness: 1.6,
    holes: [], comps, source: `${names[kind]}: ${fileName}`, notes, // thickness: these files do not say; 1.6 mm assumed
  };
  return finishBoard(b, { sizesKnown: true });
}
