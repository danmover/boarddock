// Plates and the brim: every part's brim (its outline grown by what Kiri:Moto draws round it) has to stay on the bed,
// inside the margin packPlates keeps round the edge. Pure geometry, no kernel: parts are boxes.
import { describe, it, expect } from 'vitest';
import { BRIM_OUT, EDGE, EDGE_CLEAR, MIN_SPACING, SKIRT_OUT, fitsBed, packPlates, placedMesh } from '../src/cad/export';
import { PRINTERS } from '../src/model/library';
import { kiriProcess, roundRoom } from '../src/slice/profiles';
import { printerByName } from '../src/model/printers';
import type { MeshData, PartOut, V2 } from '../src/model/types';

/** A box part, its corner at (ox, oy) rather than the origin (parts come in anywhere). */
function part(id: string, w: number, d: number, qty = 1, ox = -10, oy = 25): PartOut {
  const p = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, 8], [w, 0, 8], [w, d, 8], [0, d, 8]];
  const pos = new Float32Array(p.flatMap(([x, y, z]) => [x + ox, y + oy, z]));
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { id, name: id, qty, mesh: { pos, idx }, toAssembly: [], volume: w * d * 8, size: [w, d, 8], color: '#fff' };
}
const bbox = (m: MeshData) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < m.pos.length; i += 3) { x0 = Math.min(x0, m.pos[i]); x1 = Math.max(x1, m.pos[i]); y0 = Math.min(y0, m.pos[i + 1]); y1 = Math.max(y1, m.pos[i + 1]); }
  return { x0, y0, x1, y1 };
};
/** How far a part's outline is from the nearest bed edge, as it sits in the plate's file. */
const gapOf = (m: MeshData, bed: V2) => { const b = bbox(m); return Math.min(b.x0, b.y0, bed[0] - b.x1, bed[1] - b.y1); };

describe('the room round a plate for a brim', () => {
  it('is what Kiri:Moto is told to draw', () => {
    const pr = printerByName('Bambu Lab A1 mini');
    const brim = kiriProcess(pr, 'PETG', true), skirt = kiriProcess(pr, 'PETG', false);
    // seven touching loops of one line width; one loop 3 mm out (both measured in Kiri's G-code: 3.15 and 3.45 mm)
    expect(brim.outputBrimOffset).toBe(0);
    expect(Number(brim.outputBrimCount) * Number(brim.sliceLineWidth)).toBeCloseTo(BRIM_OUT, 6);
    expect(skirt.outputBrimCount).toBe(1);
    expect(Number(skirt.outputBrimOffset) + Number(skirt.sliceLineWidth)).toBeCloseTo(SKIRT_OUT, 6);
    // and the margin packPlates keeps holds the widest of them with room to spare
    expect(EDGE).toBeGreaterThanOrEqual(SKIRT_OUT + EDGE_CLEAR);
    expect(roundRoom(true)).toBeLessThan(roundRoom(false));
  });
});

describe('a plate keeps its brim on the bed', () => {
  it('a part that only just fits sits on the bed, the same distance from both edges, however much spacing', () => {
    let checked = 0;
    for (const bed of [[180, 180], [256, 256], [250, 210], [210, 250]] as V2[]) {
      for (const spacing of [2, 6, 20]) {
        for (let w = bed[0] - 40; w <= bed[0] + 3; w += 0.5) {
          for (const d of [30, bed[1] - 1]) {
            const [pl, ...rest] = packPlates([part('p', w, d)], bed, spacing);
            expect(rest.length).toBe(0);
            if (!fitsBed(pl, bed)) continue;
            const m = placedMesh(pl.items[0], bed, pl.used), b = bbox(m);
            const tag = `${bed} spacing ${spacing}, ${w} x ${d}`;
            // on the bed, and centred: the plate's room to the edge is what the file has on every side
            expect(gapOf(m, bed), tag).toBeGreaterThanOrEqual(-1e-6);
            expect(b.x0, tag).toBeCloseTo(bed[0] - b.x1, 4);
            expect(b.y0, tag).toBeCloseTo(bed[1] - b.y1, 4);
            expect(pl.edge, tag).toBeCloseTo(gapOf(m, bed), 4);
            // where the app draws a brim (or a skirt), it stays on the bed with EDGE_CLEAR to spare
            for (const [brim, out] of [[true, BRIM_OUT], [false, SKIRT_OUT]] as const) {
              if (pl.edge >= roundRoom(brim)) expect(gapOf(m, bed) - out, `${tag} ${brim ? 'brim' : 'skirt'}`).toBeGreaterThanOrEqual(EDGE_CLEAR - 1e-6);
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('a part that fits only the other way round is turned to fit', () => {
    const bed: V2 = [180, 250];
    // both a little too long for the margin round a 250 mm side, so each gets a plate to itself
    const [pl] = packPlates([part('long', 30, 246)], bed, 6);
    expect(fitsBed(pl, bed)).toBe(true);
    expect(pl.items[0].rot90).toBe(false);
    const [q] = packPlates([part('wide', 246, 30)], bed, 6);
    expect(q.items[0].rot90).toBe(true);
    for (const plate of [pl, q]) expect(gapOf(placedMesh(plate.items[0], bed, plate.used), bed)).toBeGreaterThanOrEqual(-1e-6);
    // a part bigger than the bed is said not to fit
    expect(fitsBed(packPlates([part('huge', 300, 300)], bed, 6)[0], bed)).toBe(false);
  });

  it('every part on a crowded plate has its brim on the bed', () => {
    // 60 boxes of odd sizes, from a fixed seed
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const parts = Array.from({ length: 24 }, (_, i) => part(`p${i}`, 8 + Math.round(rnd() * 110), 8 + Math.round(rnd() * 110), 1 + Math.floor(rnd() * 4)));
    for (const bed of [[180, 180], [256, 256], [220, 220]] as V2[]) {
      for (const spacing of [2, 6, 12]) {
        for (const pl of packPlates(parts, bed, spacing)) {
          for (const it of pl.items) {
            const gap = gapOf(placedMesh(it, bed, pl.used), bed);
            expect(gap - BRIM_OUT, `${bed} spacing ${spacing}: ${it.part.name}`).toBeGreaterThanOrEqual(EDGE_CLEAR - 1e-6);
            expect(gap - SKIRT_OUT).toBeGreaterThanOrEqual(EDGE_CLEAR - 1e-6);
          }
          expect(pl.edge).toBeGreaterThanOrEqual(EDGE - 1e-6);
        }
      }
    }
  });
});

describe('the room between parts for two brims', () => {
  it('is never less than two brims, and the printers start with at least that', () => {
    expect(MIN_SPACING).toBeGreaterThanOrEqual(2 * BRIM_OUT + EDGE_CLEAR - 1e-9);
    for (const pr of PRINTERS) expect(pr.spacing, pr.name).toBeGreaterThanOrEqual(MIN_SPACING);
  });

  it('keeps every part two brims from its neighbours whatever spacing is asked for (older projects hold 6, the box allowed 2)', () => {
    let s = 11;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const parts = Array.from({ length: 30 }, (_, i) => part(`p${i}`, 6 + Math.round(rnd() * 50), 6 + Math.round(rnd() * 50), 1 + Math.floor(rnd() * 3)));
    let pairs = 0;
    for (const spacing of [0, 2, 6, MIN_SPACING, 12]) {
      const plates = packPlates(parts, [256, 256], spacing);
      // the same plates as with the least allowed, when less is asked for
      if (spacing <= MIN_SPACING) expect(plates.map((pl) => pl.items.map((it) => [it.part.id, it.x, it.y, it.rot90])), `spacing ${spacing}`).toEqual(packPlates(parts, [256, 256], MIN_SPACING).map((pl) => pl.items.map((it) => [it.part.id, it.x, it.y, it.rot90])));
      for (const pl of plates) {
        const boxes = pl.items.map((it) => bbox(placedMesh(it, [256, 256], pl.used)));
        for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
          const A = boxes[a], B = boxes[b];
          // the gap between two boxes: along whichever axis they are apart on
          const gap = Math.max(B.x0 - A.x1, A.x0 - B.x1, B.y0 - A.y1, A.y0 - B.y1);
          expect(gap, `spacing ${spacing}, parts ${a} and ${b}`).toBeGreaterThanOrEqual(2 * BRIM_OUT - 1e-6);
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(500);
  });
});
