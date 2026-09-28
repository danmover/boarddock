// @vitest-environment happy-dom
// Binary Eagle boards. There is no freely licensed binary Eagle board to test with, so the fixtures are written here
// by a tiny encoder that follows the same record layouts (pyeagle / pcb-rnd) the reader uses.
import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { importEagleBinary, isEagleBinary, parseEagleBinary } from '../src/import/eaglebin';
import { brdKind, groupFiles, importFiles } from '../src/import';
import { area, bbox } from '../src/geom/poly';

// ---------- the encoder ----------
interface G { off: number; len: 2 | 4; direct: boolean; kids: N[] }
interface N { t: number; set?: (d: DataView, b: Uint8Array) => void; names?: [number, number, string][]; groups?: G[] }

const u = (v: number) => Math.round(v * 1e4); // mm -> 1/10000 mm
const size = (n: N): number => 1 + (n.groups ?? []).reduce((s, g) => s + g.kids.reduce((k, c) => k + size(c), 0), 0);

/** Write a record tree as a binary Eagle file. allRecursive: every child count counts all records below (pyeagle's reading). */
function encode(top: N[], settings: number, allRecursive = false, version: [number, number] = [5, 11]): Uint8Array {
  const recs: Uint8Array[] = [], strings: string[] = [];
  const write = (n: N) => {
    const b = new Uint8Array(24), d = new DataView(b.buffer);
    b[0] = n.t;
    n.set?.(d, b);
    for (const [off, len, s] of n.names ?? []) {
      if (s.length > len) { b[off] = 0x7f; strings.push(s); } else for (let k = 0; k < s.length; k++) b[off + k] = s.charCodeAt(k);
    }
    for (const g of n.groups ?? []) {
      const c = g.direct && !allRecursive ? g.kids.length : g.kids.reduce((k, x) => k + size(x), 0);
      if (g.len === 2) d.setUint16(g.off, c, true); else d.setUint32(g.off, c, true);
    }
    recs.push(b);
    for (const g of n.groups ?? []) g.kids.forEach(write);
  };
  const start = new Uint8Array(24), sd = new DataView(start.buffer);
  recs.push(start);
  top.forEach(write);
  start[0] = 0x10; sd.setUint16(2, settings, true); sd.setUint32(4, recs.length, true); start[8] = version[0]; start[9] = version[1];
  const text = strings.map((s) => s + '\0').join('') + '\0\0';
  const tail = new Uint8Array(8 + text.length);
  tail.set([0x13, 0x12, 0x99, 0x19]);
  new DataView(tail.buffer).setUint32(4, text.length, true);
  for (let k = 0; k < text.length; k++) tail[8 + k] = text.charCodeAt(k);
  const out = new Uint8Array(recs.length * 24 + tail.length);
  recs.forEach((r, i) => out.set(r, i * 24));
  out.set(tail, recs.length * 24);
  return out;
}

const xy = (d: DataView, x: number, y: number) => { d.setInt32(4, u(x), true); d.setInt32(8, u(y), true); };
const line = (layer: number, x1: number, y1: number, x2: number, y2: number, w = 0): N => ({ t: 0x22, set: (d, b) => { b[3] = layer; xy(d, x1, y1); d.setInt32(12, u(x2), true); d.setInt32(16, u(y2), true); d.setUint16(20, u(w) / 2, true); } });
/** An arc in the packed form (type 0x81): 3-byte coordinates, one coordinate of the centre spread over three bytes. */
const arcPacked = (layer: number, x1: number, y1: number, x2: number, y2: number, c: number, ccw: boolean): N => ({
  t: 0x22, set: (_d, b) => {
    b[3] = layer;
    let neg = 0;
    const put3 = (off: number, v: number, bit: number) => { const w = u(v) & 0xffffff; b[off] = w & 255; b[off + 1] = (w >> 8) & 255; b[off + 2] = (w >> 16) & 255; if (u(v) < 0) neg |= bit; };
    put3(4, x1, 2); put3(8, y1, 4); put3(12, x2, 8); put3(16, y2, 16);
    const cw = u(c) & 0xffffff; b[7] = cw & 255; b[11] = (cw >> 8) & 255; b[15] = (cw >> 16) & 255; if (u(c) < 0) neg |= 1;
    b[19] = neg; b[22] = ccw ? 0x20 : 0; b[23] = 0x81;
  },
});
const arcTyped = (layer: number, code: number, x1: number, y1: number, x2: number, y2: number): N => ({ ...line(layer, x1, y1, x2, y2), set: (d, b) => { line(layer, x1, y1, x2, y2).set!(d, b); b[23] = code; } });
const hole = (x: number, y: number, dia: number): N => ({ t: 0x28, set: (d) => { xy(d, x, y); d.setUint16(12, u(dia) / 2, true); } });
const circle = (layer: number, x: number, y: number, r: number): N => ({ t: 0x25, set: (d, b) => { b[3] = layer; xy(d, x, y); d.setInt32(12, u(r), true); d.setInt32(16, u(r), true); } });
const pad = (name: string, x: number, y: number, drill: number, dia: number): N => ({ t: 0x2a, set: (d, b) => { b[2] = 1; xy(d, x, y); d.setUint16(12, u(drill) / 2, true); d.setUint16(14, u(dia) / 2, true); }, names: [[19, 5, name]] });
const smd = (name: string, x: number, y: number, dx: number, dy: number): N => ({ t: 0x2b, set: (d, b) => { b[3] = 1; xy(d, x, y); d.setUint16(12, u(dx) / 2, true); d.setUint16(14, u(dy) / 2, true); }, names: [[19, 5, name]] });
const via = (x: number, y: number): N => ({ t: 0x29, set: (d) => { xy(d, x, y); d.setUint16(12, u(0.3) / 2, true); d.setUint16(14, u(0.6) / 2, true); } });
const pkg = (name: string, kids: N[]): N => ({ t: 0x1e, names: [[18, 6, name], [13, 5, '']], groups: [{ off: 2, len: 2, direct: false, kids }] });
const library = (name: string, pkgs: N[]): N => ({
  t: 0x15, names: [[16, 8, name]],
  groups: [{ off: 4, len: 4, direct: false, kids: [] }, { off: 8, len: 4, direct: false, kids: [] }, { off: 12, len: 4, direct: false, kids: [{ t: 0x19, names: [[16, 8, name], [10, 6, '']], groups: [{ off: 4, len: 4, direct: false, kids: pkgs }] }] }],
});
const element = (name: string, value: string, lib: number, pk: number, x: number, y: number, rotDeg = 0, mirror = false): N => ({
  t: 0x2e, set: (d) => { xy(d, x, y); d.setUint16(12, lib, true); d.setUint16(14, pk, true); d.setUint16(16, (Math.round((rotDeg * 4096) / 360) & 0xfff) | (mirror ? 0x1000 : 0), true); },
  groups: [{ off: 2, len: 2, direct: true, kids: [{ t: 0x2f, names: [[10, 14, value], [2, 8, name]] }] }],
});
const signal = (kids: N[]): N => ({ t: 0x1c, names: [[16, 8, 'GND']], groups: [{ off: 2, len: 2, direct: true, kids }] });
const board = (libs: N[], plain: N[], els: N[], sigs: N[]): N => ({
  t: 0x1b, groups: [{ off: 12, len: 4, direct: false, kids: libs }, { off: 2, len: 2, direct: true, kids: plain }, { off: 16, len: 4, direct: false, kids: els }, { off: 20, len: 4, direct: false, kids: sigs }],
});
const layer20: N = { t: 0x13, set: (_d, b) => { b[3] = 20; b[4] = 20; }, names: [[15, 9, 'Dimension']] };

// ---------- a 50 x 30 mm board ----------
const usbBody = [line(21, -3.75, -2.5, 3.75, -2.5, 0.1), line(21, 3.75, -2.5, 3.75, 3.5, 0.1), line(21, 3.75, 3.5, -3.75, 3.5, 0.1), smd('1', 0, 2, 0.4, 1.3)];
const header = [0, 1, 2, 3].map((k) => pad(String(k + 1), -3.81 + k * 2.54, 0, 1, 1.6));
function demo(allRecursive = false, polygonInSignal = false): Uint8Array {
  const plain = [
    line(20, 0, 0, 50, 0), line(20, 50, 0, 50, 25),
    arcPacked(20, 50, 25, 45, 30, 25, true), // rounded top-right corner, centre (45, 25)
    line(20, 45, 30, 5, 30),
    arcTyped(20, 0x79, 5, 30, 0, 25), // rounded top-left corner, a quarter arc centred at (5, 25)
    line(20, 0, 25, 0, 0),
    circle(20, 40, 15, 3), // a round cut-out
    hole(4, 4, 3.2),
    line(21, 10, 10, 12, 12), // silkscreen, not outline
  ];
  const libs = [library('con', [pkg('USB-MICRO-B', usbBody), pkg('1X04', header), pkg('MOUNTING-HOLE', [hole(0, 0, 3.2)])])];
  const els = [
    element('J1', 'USB-MICRO-B-5PIN-SMT', 1, 1, 25, 2), // value longer than its 14 characters: from the string table
    element('JP1', '', 1, 2, 10, 20, 90),
    element('H1', '', 1, 3, 46, 4),
    element('J2', '', 1, 1, 30, 20, 90, true), // on the bottom
  ];
  const sig = polygonInSignal ? [via(20, 10), { t: 0x21, groups: [{ off: 2, len: 2 as const, direct: true, kids: [line(1, 18, 8, 22, 8), line(1, 22, 8, 22, 12), line(1, 22, 12, 18, 8)] }] }, line(1, 20, 10, 25, 2, 0.25)]
    : [via(20, 10), line(1, 20, 10, 25, 2, 0.25)];
  return encode([layer20, board(libs, plain, els, [signal(sig)])], 1, allRecursive);
}

describe('binary Eagle boards', () => {
  it('knows the format by its first record', () => {
    expect(isEagleBinary(demo())).toBe(true);
    expect(isEagleBinary(new TextEncoder().encode('<?xml version="1.0"?><eagle version="9.6">'))).toBe(false);
    const f = parseEagleBinary(demo());
    expect(f.version).toEqual([5, 11]);
    expect(f.stringsOk).toBe(true);
  });

  it('reads the outline with its arcs, the cut-out and the holes', () => {
    const b = importEagleBinary(demo(), 'lamp.brd');
    const bb = bbox(b.outline);
    expect(bb.x1 - bb.x0).toBeCloseTo(50, 3);
    expect(bb.y1 - bb.y0).toBeCloseTo(30, 3);
    // two 5 mm fillets take 2 x (25 - 25 pi / 4) mm2 off the rectangle
    expect(Math.abs(area(b.outline))).toBeCloseTo(1500 - 2 * (25 - (25 * Math.PI) / 4), 0);
    expect(b.cutouts.length).toBe(1);
    const cb = bbox(b.cutouts[0]);
    expect(cb.x1 - cb.x0).toBeCloseTo(6, 1);
    expect(b.holes.map((h) => [h.x, h.y, h.d])).toEqual([[4, 4, 3.2], [46, 4, 3.2]]);
    expect(b.name).toBe('lamp');
    expect(b.source).toMatch(/Eagle 5 \(binary\)/);
  });

  it('places the parts, with names from the string table, and recognises connectors', () => {
    const b = importEagleBinary(demo(), 'lamp.brd');
    expect(b.comps.map((c) => c.ref).sort()).toEqual(['J1', 'J2', 'JP1']); // the mounting hole is a hole, not a part
    const j1 = b.comps.find((c) => c.ref === 'J1')!;
    expect(j1.value).toBe('USB-MICRO-B-5PIN-SMT');
    expect(j1.pkg).toBe('USB-MICRO-B');
    expect(j1.conn?.type).toBe('usb_micro_b');
    expect([j1.x, j1.y, j1.w, j1.l]).toEqual([25, 2.5, 7.5, 6].map((v) => expect.closeTo(v, 3)));
    expect(j1.side).toBe('top');
    const j2 = b.comps.find((c) => c.ref === 'J2')!;
    expect(j2.side).toBe('bottom');
    expect(j2.rot).toBeCloseTo(-90);
    // rotated, then mirrored left-right: the body's +0.5 mm offset lands on +x
    expect(j2.x).toBeCloseTo(30.5, 3);
    expect(j2.y).toBeCloseTo(20, 3);
  });

  it('gives a pin header its pins, turned with the part', () => {
    const b = importEagleBinary(demo(), 'lamp.brd');
    const jp = b.comps.find((c) => c.ref === 'JP1')!;
    expect(jp.conn?.type).toBe('header');
    expect(jp.tht).toBe(true);
    expect(jp.pins?.map((p) => p.n)).toEqual(['1', '2', '3', '4']);
    expect(jp.pins![0].x).toBeCloseTo(10, 3);
    expect(jp.pins![0].y).toBeCloseTo(20 - 3.81, 3);
    expect(jp.pins![3].y).toBeCloseTo(20 + 3.81, 3);
  });

  it('reads tracks and vias for the 3D view', () => {
    const b = importEagleBinary(demo(), 'lamp.brd');
    expect(b.vias?.length).toBe(1);
    expect(b.vias![0].d).toBeCloseTo(0.6);
    expect(b.traces?.some((t) => Math.abs(t.w - 0.25) < 1e-6)).toBe(true);
  });

  it('follows both readings of the child counts', () => {
    // a copper pour inside a signal: direct counts (pcb-rnd) and all-records counts (pyeagle) differ there
    for (const all of [false, true]) {
      const b = importEagleBinary(demo(all, true), 'pour.brd');
      expect(b.comps.length).toBe(3);
      expect(b.vias?.length).toBe(1);
      expect(b.traces!.length).toBe(4);
      expect(bbox(b.outline).x1).toBeCloseTo(50, 3);
    }
  });

  it('reads the separate arc record of Eagle 4', () => {
    const arc4: N = { ...line(20, 5, 30, 0, 25), t: 0x24, set: (d, b) => { line(20, 5, 30, 0, 25).set!(d, b); b[22] = 0x10; b[23] = 2; } };
    const plain = [line(20, 0, 0, 50, 0), line(20, 50, 0, 50, 30), line(20, 50, 30, 5, 30), arc4, line(20, 0, 25, 0, 0)];
    const b = importEagleBinary(encode([layer20, board([], plain, [], [])], 1, false, [4, 9]), 'old.brd');
    expect(Math.abs(area(b.outline))).toBeCloseTo(1500 - (25 - (25 * Math.PI) / 4), 0);
    expect(b.notes[0]).toMatch(/Eagle 4\.9/);
  });

  it('says so when the file is a schematic, not a board', () => {
    const sch = encode([layer20, { t: 0x14, groups: [] }], 1);
    expect(() => importEagleBinary(sch, 'lamp.sch')).toThrow(/schematic/);
  });

  it('comes in through the normal import, from a zip too', async () => {
    const bytes = demo();
    expect(brdKind({ name: 'lamp.brd', bytes })).toBe('eagle-bin');
    const zip = { name: 'lamp.zip', bytes: zipSync({ 'lamp/lamp.brd': bytes, 'lamp/readme.txt': new TextEncoder().encode('hello') }) };
    expect(groupFiles([zip]).length).toBe(1);
    const b = await importFiles([zip]);
    expect(b.comps.length).toBe(3);
    expect(b.holes.length).toBe(2);
  });

  it('names what to do with an Allegro board, and with a .brd it does not know', async () => {
    const allegro = new Uint8Array(0x200);
    allegro.set([0x61, 0x6c, 0x6c], 0xf8); // "all"
    await expect(importFiles([{ name: 'mainboard.brd', bytes: allegro }])).rejects.toThrow(/Allegro.*KiCad/);
    await expect(importFiles([{ name: 'odd.brd', bytes: new Uint8Array(300).fill(7) }])).rejects.toThrow(/not an Eagle board/);
  });
});
