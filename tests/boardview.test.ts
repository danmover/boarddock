// @vitest-environment happy-dom
// Board-viewer files (the formats OpenBoardView opens). The fixtures are small hand-written files, obfuscated here
// the way the real ones are where the format does that.
import { describe, it, expect } from 'vitest';
import { decodeBdv, decodeTestLink, importBoardView, sniffBoardView } from '../src/import/boardview';
import { brdKind, importFiles } from '../src/import';
import { bbox } from '../src/geom/poly';

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** Test_Link obfuscation, the other way: invert, then rotate right by two bits. */
const encodeTestLink = (s: string) => bytes(s).map((d) => (d === 13 || d === 10 ? d : (((~d & 0xff) >> 2) | ((~d & 0xff) << 6)) & 0xff));
/** .bdv obfuscation, the other way: the key starts at 160 and steps up at each CR LF. */
function encodeBdv(s: string): Uint8Array {
  const b = bytes(s), out = new Uint8Array(b.length);
  let key = 0xa0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 13 && b[i + 1] === 10) key++;
    out[i] = b[i] === 13 || b[i] === 10 ? b[i] : (key - b[i]) & 0xff;
    if (key > 285) key = 159;
  }
  return out;
}

// 2000 x 1000 mils (50.8 x 25.4 mm); a 4-pin header J1, a resistor R1 on top, a USB socket on the bottom
const TESTLINK = `str_length:
0
var_data:
5 3 9 0
Format:
0 0
2000 0
2000 1000
0 1000
0 0
Parts:
J1 1 4
R1 5 6
USB1 10 9
Pins:
900 500 -99 1 GND
1000 500 -99 1 TX
1100 500 -99 1 RX
1200 500 -99 1 VCC
300 300 -99 2 VCC
360 300 -99 2 LED
1700 100 -99 3 VBUS
1800 100 -99 3 GND
1750 250 -99 3 GND
Nails:
`;

describe('board-viewer files', () => {
  it('reads an obfuscated Test_Link .brd', () => {
    const enc = encodeTestLink(TESTLINK);
    expect(decodeTestLink(enc)).toBe(TESTLINK);
    expect(sniffBoardView(enc)).toBe('testlink');
    const b = importBoardView(enc, 'laptop.brd');
    const bb = bbox(b.outline);
    expect(bb.x1 - bb.x0).toBeCloseTo(50.8, 3);
    expect(bb.y1 - bb.y0).toBeCloseTo(25.4, 3);
    expect(b.comps.length).toBe(3);
    const j1 = b.comps.find((c) => c.ref === 'J1')!;
    expect(j1.x).toBeCloseTo(1050 * 0.0254, 3);
    expect(j1.y).toBeCloseTo(500 * 0.0254, 3);
    expect(j1.w).toBeCloseTo(300 * 0.0254 + 0.8, 3); // the spread of its pins and a pad around them
    expect(j1.tht).toBe(true);
    expect(j1.kind).toBe('connector');
    expect(j1.pins?.map((p) => p.net)).toEqual(['GND', 'TX', 'RX', 'VCC']);
    expect(b.comps.find((c) => c.ref === 'USB1')?.side).toBe('bottom');
    expect(b.comps.find((c) => c.ref === 'R1')?.tht).toBe(false);
    expect(b.holes.length).toBe(0);
    expect(b.notes.join(' ')).toMatch(/pin positions only/);
  });

  it('reads BRD2, with bottom pins stored mirrored', () => {
    const brd2 = `BRDOUT: 4 1000 800
0 0
1000 0
1000 800
0 800
NETS: 2
1 GND
2 VCC
PARTS: 2
C1 100 100 200 150 0 1
U7 500 500 700 600 2 2
PINS: 4
100 120 1 1
200 120 2 1
500 250 1 2
700 250 2 2
NAILS: 0
`;
    const f = bytes(brd2);
    expect(sniffBoardView(f)).toBe('brd2');
    const b = importBoardView(f, 'phone.brd');
    expect(bbox(b.outline).x1).toBeCloseTo(25.4, 3);
    const u7 = b.comps.find((c) => c.ref === 'U7')!;
    expect(u7.side).toBe('bottom');
    expect(u7.y).toBeCloseTo((800 - 250) * 0.0254, 3);
    expect(b.comps.find((c) => c.ref === 'C1')?.x).toBeCloseTo(150 * 0.0254, 3);
  });

  it('reads an obfuscated .bdv (inches)', () => {
    const bdv = ['<<format.asc>>', '0 0', '2 0', '2 1', '0 1', '0 0', '<<pins.asc>>', 'Part J3 (T)', '1 1 0.5 0.5 1 GND 0', '2 2 0.6 0.5 1 SDA 0', '<<nails.asc>>', ''].join('\r\n');
    const enc = encodeBdv(bdv);
    expect(String.fromCharCode(...enc.slice(0, 14))).toBe('dd:1.3?,r?-=bb'); // the header OpenBoardView looks for
    expect(decodeBdv(enc)).toBe(bdv);
    const b = importBoardView(enc, 'tablet.bdv');
    expect(bbox(b.outline).x1).toBeCloseTo(50.8, 3);
    const j3 = b.comps.find((c) => c.ref === 'J3')!;
    expect(j3.x).toBeCloseTo(0.55 * 25.4, 3);
    expect(j3.pins?.map((p) => [p.n, p.net])).toEqual([['1', 'GND'], ['2', 'SDA']]);
  });

  it('reads BVRAW_FORMAT_3 with a segmented outline, and BVRAW_FORMAT_1', () => {
    const bvr3 = `BVRAW_FORMAT_3
OUTLINE_SEGMENTED 0 0 1500 0 1500 0 1500 900 0 900 1500 900 0 0 0 900
PART_NAME CN2
PART_SIDE T
PART_ORIGIN 100 100
PART_MOUNT SMD
PIN_NUMBER 1
PIN_ORIGIN 0 0
PIN_NET VBUS
PIN_END
PIN_NUMBER 2
PIN_ORIGIN 50 0
PIN_NET GND
PIN_END
PART_END
`;
    const b = importBoardView(bytes(bvr3), 'watch.bvr');
    expect(bbox(b.outline).x1).toBeCloseTo(1500 * 0.0254, 3);
    const cn2 = b.comps.find((c) => c.ref === 'CN2')!;
    expect(cn2.x).toBeCloseTo(125 * 0.0254, 3);
    expect(cn2.pins?.length).toBe(2);

    const bvr1 = ['BVRAW_FORMAT_1', '<<Layout>>', 'X Y', '0, 0', '1, 0', '1, 1', '0, 1', '0, 0', '<<Pin>>', 'PART SIDE ID NAME X Y LAYER NET', 'R5 (B) 1 1 0.2 0.2 2 N1', 'R5 (B) 2 2 0.3 0.2 2 N2', ''].join('\n');
    const b1 = importBoardView(bytes(bvr1), 'old.bv');
    expect(bbox(b1.outline).x1).toBeCloseTo(25.4, 3);
    expect(b1.comps[0].side).toBe('bottom');
    expect(b1.comps[0].x).toBeCloseTo(0.25 * 25.4, 3);
  });

  it('draws a box around the parts when the file has no outline', () => {
    const b = importBoardView(bytes(TESTLINK.replace(/Format:[\s\S]*?Parts:/, 'Format:\nParts:')), 'bare.brd');
    const bb = bbox(b.outline);
    expect(bb.x1 - bb.x0).toBeCloseTo((1800 - 300) * 0.0254 + 4, 3);
    expect(b.notes[0]).toMatch(/no board outline/);
  });

  it('comes in through the normal import as a .brd', async () => {
    const f = { name: 'laptop.brd', bytes: encodeTestLink(TESTLINK) };
    expect(brdKind(f)).toBe('boardview');
    const b = await importFiles([f]);
    expect(b.name).toBe('Laptop'); // file names are tidied into board names
    expect(b.comps.length).toBe(3);
  });
});
