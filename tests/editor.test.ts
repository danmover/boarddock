// The board editor's pure parts: dimension layout, the drawn-in copper, snapping, the photo underlay, the toolbox's
// demo boards and a drawn board.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { layoutDims, type DimBox } from '../src/model/dims';
import { boardCopper, partPins } from '../src/model/copper';
import { alignPhoto, fitPhoto, scalePhoto, snapBox, snapLines } from '../src/model/editorgeo';
import { PALETTE, demoBoard, paletteFor } from '../src/model/palette';
import { drawnBoard } from '../src/ui/DrawBoard';
import { bbox, inside } from '../src/geom/poly';
import type { Board, Dim } from '../src/model/types';

const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();
const hit = (p: DimBox, q: DimBox) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;

describe('dimension layout', () => {
  const pi = () => {
    const b = T('rpi4'), h = b.holes;
    b.dims = [
      { id: 'd1', a: { k: 'edge', at: 'x0' }, b: { k: 'hole', id: h[0].id, at: 'c' }, axis: 'x' },
      { id: 'd2', a: { k: 'hole', id: h[0].id, at: 'c' }, b: { k: 'hole', id: h[1].id, at: 'c' }, axis: 'x' },
      { id: 'd3', a: { k: 'edge', at: 'x0' }, b: { k: 'hole', id: h[1].id, at: 'c' }, axis: 'x' },
      { id: 'd4', a: { k: 'edge', at: 'y0' }, b: { k: 'hole', id: h[0].id, at: 'c' }, axis: 'y' },
    ];
    return b;
  };
  it('no two labels lie on top of each other', () => {
    for (const px of [0.05, 0.1, 0.2]) {
      const L = layoutDims(pi(), px);
      expect(L).toHaveLength(4);
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) expect(hit(L[i].box, L[j].box)).toBe(false);
    }
  });
  it('a short one has its label beside it, a long one in the middle', () => {
    const L = layoutDims(pi(), 0.1);
    const short = L.find((q) => q.id === 'd1')!, long = L.find((q) => q.id === 'd2')!;
    expect(short.t < 0 || short.t > 1).toBe(true);
    expect(long.t).toBe(0.5);
  });
  it('one you placed stays put; dropped on another, it steps aside', () => {
    const b = pi(), L0 = layoutDims(b, 0.1);
    const d2 = b.dims!.find((d) => d.id === 'd2')!;
    d2.off = 12; d2.t = 0.3;
    const L1 = layoutDims(b, 0.1).find((q) => q.id === 'd2')!;
    expect(L1.line).toBeCloseTo(L1.anchor + 12, 6);
    expect(L1.t).toBe(0.3);
    // now onto d1's label
    const d1 = L0.find((q) => q.id === 'd1')!;
    d2.off = d1.line - L1.anchor; d2.t = (d1.lab[0] - L1.A[0]) / (L1.B[0] - L1.A[0]);
    const L2 = layoutDims(b, 0.1, { last: 'd2' });
    const a = L2.find((q) => q.id === 'd1')!, c = L2.find((q) => q.id === 'd2')!;
    expect(hit(a.box, c.box)).toBe(false);
    expect(a.line).toBeCloseTo(d1.line, 6); // d1 did not move
  });
  it('keeps clear of labels it is told to avoid', () => {
    const b = pi(), L0 = layoutDims(b, 0.1), q = L0.find((x) => x.id === 'd2')!;
    const L1 = layoutDims(b, 0.1, { avoid: [q.box] }).find((x) => x.id === 'd2')!;
    expect(hit(L1.box, q.box)).toBe(false);
  });
  it('a dimension to a part that is gone is left out', () => {
    const b = pi();
    b.dims!.push({ id: 'dx', a: { k: 'edge', at: 'x0' }, b: { k: 'comp', id: 'nope', at: 'c' }, axis: 'x' } as Dim);
    expect(layoutDims(b, 0.1).map((q) => q.id)).not.toContain('dx');
  });
});

describe('drawn-in copper', () => {
  it('is the same every time for the same board, and on the board', () => {
    for (const id of ['rpi4', 'example_dual_swd', 'ftdi', 'jlink']) {
      const b = T(id), a = boardCopper(b), c = boardCopper(T(id));
      expect(a.tracks.length).toBeGreaterThan(3);
      expect(JSON.stringify(a)).toBe(JSON.stringify(c));
      for (const t of a.tracks) { expect(inside(t.a, b.outline)).toBe(true); expect(inside(t.b, b.outline)).toBe(true); }
    }
  });
  it('keeps off the mounting holes', () => {
    const b = T('rpi4');
    for (const t of boardCopper(b).tracks) for (const h of b.holes) {
      const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1], L = dx * dx + dy * dy;
      const s = L ? Math.max(0, Math.min(1, ((h.x - t.a[0]) * dx + (h.y - t.a[1]) * dy) / L)) : 0;
      expect(Math.hypot(h.x - t.a[0] - s * dx, h.y - t.a[1] - s * dy)).toBeGreaterThan(h.d / 2);
    }
  });
  it('runs at 0, 45 or 90 degrees between the pins, as tracks do', () => {
    for (const t of boardCopper(T('rpi4')).tracks) {
      const a = Math.abs((Math.atan2(t.b[1] - t.a[1], t.b[0] - t.a[0]) * 180) / Math.PI) % 45;
      // the short stubs off a pin follow the pin, which may be turned; the routes between are octilinear
      if (Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]) > 2.5) expect(Math.min(a, 45 - a)).toBeLessThan(0.5);
    }
  });
  it("a board's own tracks are kept as they are", () => {
    const b = T('rpi4');
    b.traces = [{ a: [10, 10], b: [20, 10], w: 0.3, side: 'top' }];
    expect(boardCopper(b).tracks).toBe(b.traces);
  });
  it('a header has a pin per pin; a plug has its pins on the side away from the edge', () => {
    const b = T('ftdi');
    const hdr = b.comps.find((c) => c.conn?.type === 'pins_ra' || c.conn?.type === 'header')!;
    expect(partPins(hdr, 0).length).toBe(6);
    const usb = b.comps.find((c) => c.conn?.entry === 'edge' && c.conn.type.startsWith('usb'))!;
    const e = [Math.cos((usb.conn!.angle * Math.PI) / 180), Math.sin((usb.conn!.angle * Math.PI) / 180)];
    for (const p of partPins(usb, 0)) expect((p.p[0] - usb.x) * e[0] + (p.p[1] - usb.y) * e[1]).toBeLessThan(0);
  });
});

describe('snapping and the photo', () => {
  it('snaps a box onto the nearest line within reach, and only then', () => {
    const b = T('rpi4'), bb = bbox(b.outline), lines = snapLines(b, new Set());
    const s = snapBox({ x0: bb.x0 + 0.4, y0: 20, x1: bb.x0 + 5.4, y1: 25 }, lines, 1);
    expect(s.dx).toBeCloseTo(-0.4, 6);
    expect(s.gx).toBeCloseTo(bb.x0, 6);
    expect(snapBox({ x0: bb.x0 + 3, y0: 20.37, x1: bb.x0 + 8, y1: 25.37 }, { xs: [bb.x0], ys: [] }, 1)).toMatchObject({ dx: 0, gx: null });
  });
  it('fits the photo in the board, scales it by two points and a distance, lines it up', () => {
    const b = T('rpi4'), bb = bbox(b.outline);
    const ph = fitPhoto(b, 'data:,', 1000, 500);
    expect(ph.w / ph.h).toBeCloseTo(2, 6);
    expect(ph.w).toBeLessThanOrEqual(bb.x1 - bb.x0 + 1e-9);
    const s = scalePhoto(ph, [ph.x, ph.y], [ph.x + 10, ph.y], 20);
    expect(s.w).toBeCloseTo(ph.w * 2, 6);
    expect(s.x).toBeCloseTo(ph.x, 6);
    expect(scalePhoto(ph, [1, 1], [1, 1], 5)).toBe(ph);
    const a = alignPhoto(ph, [5, 5], [7, 4]);
    expect([a.x - ph.x, a.y - ph.y]).toEqual([2, -1]);
  });
});

describe('the toolbox and drawing a board', () => {
  it('every toolbox item makes something on its demo board, and a plug on its edge is found again', () => {
    for (const it of PALETTE) {
      const b = demoBoard(it);
      expect(b.comps.length + b.holes.length).toBeGreaterThan(0);
      const c = b.comps[0];
      if (c?.conn) expect(paletteFor(c)).toBeDefined();
    }
  });
  it('draws a board from the form: its size, corners and holes', () => {
    const r = drawnBoard({ name: ' Mine ', shape: 'round', w: 60, h: 40, r: 3, t: 1.6, holes: 'corners', inset: 3.5, d: 3.2, sx: 0, sy: 0 });
    const bb = bbox(r.outline);
    expect([bb.x1 - bb.x0, bb.y1 - bb.y0].map((v) => Math.round(v * 10) / 10)).toEqual([60, 40]);
    expect(r.name).toBe('Mine');
    expect(r.holes.map((h) => [h.x, h.y])).toEqual([[3.5, 3.5], [56.5, 3.5], [3.5, 36.5], [56.5, 36.5]]);
    const s = drawnBoard({ name: '', shape: 'rect', w: 65, h: 56, r: 0, t: 1.6, holes: 'spacing', inset: 0, d: 2.7, sx: 58, sy: 49 });
    expect(s.name).toBe('My board');
    const xs = s.holes.map((h) => h.x), ys = s.holes.map((h) => h.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(58, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(49, 6);
    const c = drawnBoard({ name: 'Disc', shape: 'circle', w: 50, h: 0, r: 0, t: 1.6, holes: 'none', inset: 0, d: 3, sx: 0, sy: 0 });
    expect(c.holes).toHaveLength(0);
    const cb = bbox(c.outline);
    expect(cb.x1 - cb.x0).toBeCloseTo(50, 1);
  });
});
