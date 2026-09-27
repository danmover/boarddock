// Caliper-style dimensions in the board editor, and the toolbox.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { axisOf, measure, pickFeat, setDim } from '../src/model/dims';
import { PALETTE } from '../src/model/palette';
import { bbox } from '../src/geom/poly';
import type { Dim } from '../src/model/types';

const board = () => TEMPLATES.find((t) => t.id === 'example_dual_swd')!.make();

describe('dimensions', () => {
  it('picks a hole centre, a part side or a board edge near the pointer', () => {
    const b = board(), h = b.holes[0];
    expect(pickFeat(b, [h.x + 0.3, h.y], 2)).toEqual({ k: 'hole', id: h.id, at: 'c' });
    const bb = bbox(b.outline);
    expect(pickFeat(b, [bb.x0 + 0.5, (bb.y0 + bb.y1) / 2], 2)).toEqual({ k: 'edge', at: 'x0' });
  });

  it('typing the measured value moves the hole; two edges make the board that wide', () => {
    const b = board(), h = b.holes[0];
    const d: Dim = { id: 'd1', a: { k: 'edge', at: 'x0' }, b: { k: 'hole', id: h.id, at: 'c' }, axis: axisOf(b, { k: 'edge', at: 'x0' }, { k: 'hole', id: h.id, at: 'c' })! };
    expect(d.axis).toBe('x');
    expect(measure(b, d)).toBeCloseTo(3.5);
    expect(setDim(b, d, 4.2)).toBe(true);
    expect(measure(b, d)).toBeCloseTo(4.2);
    expect(h.x).toBeCloseTo(4.2);
    const w: Dim = { id: 'd2', a: { k: 'edge', at: 'x0' }, b: { k: 'edge', at: 'x1' }, axis: 'x' };
    expect(measure(b, w)).toBeCloseTo(80);
    setDim(b, w, 85);
    const bb = bbox(b.outline);
    expect([bb.x0, bb.x1]).toEqual([0, 85]);
  });
});

describe('toolbox', () => {
  it('makes plugs on the nearest edge, headers where you click, screw-size holes', () => {
    const b = board();
    const usb = PALETTE.find((x) => x.id === 'edge_usb_c')!.make(b, [79, 30]).comp!;
    expect(usb.conn!.angle).toBe(0); // on the right edge, facing out
    const hdr = PALETTE.find((x) => x.id === 'hdr_1x6')!.make(b, [30, 30]).comp!;
    expect([hdr.x, hdr.y, hdr.w, hdr.conn!.type]).toEqual([30, 30, 15.24, 'header']);
    expect(PALETTE.find((x) => x.id === 'hole_M3')!.make(b, [10, 10]).hole!.d).toBe(3.2);
    expect(PALETTE.find((x) => x.id === 'dbg_swd10')!.make(b, [40, 40]).comp!.role).toBe('debug');
  });
});
