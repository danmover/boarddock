// The Shape tool's pure geometry: corners, fillets and chamfers, arcs, edge lengths, the polygon boolean, the check
// that nothing crosses itself, snapping, and what a new shape leaves off the board.
import { describe, it, expect } from 'vitest';
import { area, bbox, circleLoop, inside, rectLoop } from '../src/geom/poly';
import {
  addCorner, arcThrough, bendEdge, boolean, circlePts, combine, cornerCut, cornerHoles, cornersOf, edgeLength, isCorner, lenAng,
  loopProblem, moveCorner, offBoard, polar, polygonLoop, removeCorner, selfCross, setEdgeLength, shapeProblem, slotLoop, snapPoint,
  type SnapIn,
} from '../src/geom/shape';
import { axisOf, followCorners, measure, pickFeat, setDim } from '../src/model/dims';
import { drawnBoard, drawnOutline } from '../src/ui/DrawBoard';
import type { Board, Dim, Loop, V2 } from '../src/model/types';

const sq = (x0: number, y0: number, x1: number, y1: number) => rectLoop(x0, y0, x1, y1);
const A = (ls: Loop[]) => ls.reduce((s, l) => s + area(l), 0);
const near = (a: V2, b: V2, e = 1e-6) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e;
const has = (l: Loop, p: V2) => l.some((q) => near(q, p));
const board = (outline: Loop, extra: Partial<Board> = {}): Board => ({ name: 'b', outline, cutouts: [], thickness: 1.6, holes: [], comps: [], source: 't', notes: [], ...extra });

describe('corners and edges', () => {
  it('moves, adds and removes corners', () => {
    const r = sq(0, 0, 60, 40);
    expect(moveCorner(r, 2, [70, 45])[2]).toEqual([70, 45]);
    const a = addCorner(r, 0, [30, 0]);
    expect(a).toHaveLength(5);
    expect(a[1]).toEqual([30, 0]);
    expect(removeCorner(a, 1)).toEqual(r);
    expect(removeCorner(sq(0, 0, 1, 1).slice(0, 3), 0)).toBeNull();
  });

  it('tells real corners from the steps of an arc', () => {
    expect(cornersOf(sq(0, 0, 60, 40))).toEqual([0, 1, 2, 3]);
    expect(cornersOf(circleLoop(0, 0, 10, 96))).toEqual([]);
    const r = cornerCut(sq(0, 0, 60, 40), [0], 'round', 5).loop;
    expect(cornersOf(r)).toHaveLength(3);
    expect(isCorner(addCorner(sq(0, 0, 60, 40), 0, [30, 0]), 1)).toBe(false);
  });

  it('sets an edge length; a rectangle stays a rectangle', () => {
    const r = setEdgeLength(sq(0, 0, 60, 40), 0, 75);
    expect(r).toEqual([[0, 0], [75, 0], [75, 40], [0, 40]]);
    expect(edgeLength(r, 0)).toBeCloseTo(75, 9);
    // a slanted next edge: only the end moves
    const t: Loop = [[0, 0], [10, 0], [5, 8]];
    const t2 = setEdgeLength(t, 0, 12);
    expect(t2[1]).toEqual([12, 0]);
    expect(t2[2]).toEqual([5, 8]);
  });

  it('bends an edge into an arc that bows out by the height asked', () => {
    const r = bendEdge(sq(0, 0, 60, 40), 0, 6); // the bottom edge, outwards = down
    expect(loopProblem(r)).toBeNull();
    const bb = bbox(r);
    expect(bb.y0).toBeCloseTo(-6, 6);
    expect(area(r)).toBeGreaterThan(2400);
    const inward = bendEdge(sq(0, 0, 60, 40), 0, -6);
    expect(area(inward)).toBeLessThan(2400);
    // on a clockwise cut-out, out is into the hole: the hole grows
    const hole = [...sq(20, 10, 40, 30)].reverse();
    expect(Math.abs(area(bendEdge(hole, 0, 3)))).toBeGreaterThan(400);
  });

  it('samples a three-point arc through its middle point', () => {
    const pts = arcThrough([0, 0], [10, 10], [20, 0]);
    expect(pts[pts.length - 1]).toEqual([20, 0]);
    expect(bbox(pts).y1).toBeCloseTo(10, 2);
    for (const q of pts) expect(Math.hypot(q[0] - 10, q[1])).toBeCloseTo(10, 5);
    expect(pts.length).toBeGreaterThan(20);
  });
});

describe('fillets and chamfers', () => {
  it('rounds a square corner with the radius asked, tangent to both edges', () => {
    const { loop, clamped } = cornerCut(sq(0, 0, 60, 40), [0], 'round', 5);
    expect(clamped).toBe(false);
    expect(loopProblem(loop)).toBeNull();
    expect(has(loop, [5, 0])).toBe(true);
    expect(has(loop, [0, 5])).toBe(true);
    // every arc point 5 from the centre (5, 5); area loses the corner's (1 - pi/4) r^2
    for (const q of loop.filter((q) => q[0] < 5 && q[1] < 5)) expect(Math.hypot(q[0] - 5, q[1] - 5)).toBeCloseTo(5, 5);
    expect(area(loop)).toBeCloseTo(2400 - (1 - Math.PI / 4) * 25, 1);
  });

  it('cuts a corner by the distance along each edge', () => {
    const { loop } = cornerCut(sq(0, 0, 60, 40), [2], 'cut', 4);
    expect(loop).toHaveLength(5);
    expect(has(loop, [60, 36])).toBe(true);
    expect(has(loop, [56, 40])).toBe(true);
    expect(area(loop)).toBeCloseTo(2400 - 8, 9);
  });

  it('rounds every corner at once, sharing short edges, and says when it had to make them smaller', () => {
    const all = cornerCut(sq(0, 0, 10, 6), [0, 1, 2, 3], 'round', 5);
    expect(all.clamped).toBe(true); // 6 mm tall: at most 3 mm each
    expect(loopProblem(all.loop)).toBeNull();
    const bb = bbox(all.loop);
    expect([bb.x1 - bb.x0, bb.y1 - bb.y0]).toEqual([10, 6]);
    // a 60-degree corner of a triangle, and an inside corner of an L
    const L: Loop = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]];
    const r = cornerCut(L, [3], 'round', 4).loop; // the inside corner: it fills in
    expect(loopProblem(r)).toBeNull();
    expect(area(r)).toBeGreaterThan(area(L));
    const tri: Loop = [[0, 0], [20, 0], [10, 17.320508]];
    expect(loopProblem(cornerCut(tri, [0, 1, 2], 'round', 2).loop)).toBeNull();
    expect(loopProblem(cornerCut(tri, [0, 1, 2], 'cut', 3).loop)).toBeNull();
  });

  it('leaves a straight point alone', () => {
    const l = addCorner(sq(0, 0, 60, 40), 0, [30, 0]);
    expect(cornerCut(l, [1], 'round', 3).loop).toEqual(l);
  });
});

describe('self-intersection', () => {
  it('finds edges that cross, touch or fold back', () => {
    expect(selfCross(sq(0, 0, 10, 10))).toBeNull();
    expect(selfCross([[0, 0], [10, 10], [10, 0], [0, 10]])).not.toBeNull(); // a bow tie
    expect(selfCross([[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]])).not.toBeNull(); // a corner on another edge
    expect(selfCross([[0, 0], [10, 0], [5, 0], [5, 5]])).not.toBeNull(); // folds straight back
    expect(selfCross(circleLoop(0, 0, 20, 400))).toBeNull();
    const L: Loop = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]];
    expect(selfCross(L)).toBeNull();
    expect(selfCross(moveCorner(L, 3, [-5, 20]))).not.toBeNull();
  });

  it('checks a board: cut-outs inside, apart and simple', () => {
    const o = sq(0, 0, 60, 40);
    expect(shapeProblem(o, [[...sq(10, 10, 20, 20)].reverse()])).toBeNull();
    expect(shapeProblem(o, [sq(50, 10, 70, 20)])).toMatch(/edge/);
    expect(shapeProblem(o, [sq(10, 10, 20, 20), sq(15, 15, 25, 25)])).toMatch(/overlap/);
    expect(shapeProblem([[0, 0], [10, 10], [10, 0], [0, 10]], [])).toMatch(/cross/);
    expect(loopProblem([[0, 0], [1, 0]])).toMatch(/three/);
  });
});

describe('boolean', () => {
  it('unions two overlapping squares into one loop with the right area', () => {
    const r = boolean([sq(0, 0, 10, 10)], [sq(5, 5, 15, 15)], 'union');
    expect(r).toHaveLength(1);
    expect(area(r[0])).toBeCloseTo(175, 9);
    expect(r[0]).toHaveLength(8);
    expect(selfCross(r[0])).toBeNull();
  });

  it('joins squares that share an edge into an L with six corners', () => {
    const r = boolean([sq(0, 0, 40, 20)], [sq(0, 20, 20, 40)], 'union');
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(6);
    expect(area(r[0])).toBeCloseTo(1200, 9);
    // along part of the edge only, and one inside the other along an edge
    const s = boolean([sq(0, 0, 40, 20)], [sq(10, 20, 20, 30)], 'union');
    expect(s).toHaveLength(1);
    expect(area(s[0])).toBeCloseTo(900, 9);
    expect(s[0]).toHaveLength(8);
  });

  it('cuts a notch at an edge, a notch flush with the edge, and a hole inside', () => {
    const o = sq(0, 0, 60, 40);
    const n = boolean([o], [sq(20, 30, 40, 50)], 'diff');
    expect(n).toHaveLength(1);
    expect(area(n[0])).toBeCloseTo(2400 - 200, 9);
    expect(n[0]).toHaveLength(8);
    const flush = boolean([o], [sq(20, 30, 40, 40)], 'diff'); // its top along the board's top edge
    expect(flush).toHaveLength(1);
    expect(area(flush[0])).toBeCloseTo(2200, 9);
    expect(flush[0]).toHaveLength(8);
    const h = boolean([o], [sq(10, 10, 20, 20)], 'diff');
    expect(h).toHaveLength(2);
    expect(A(h)).toBeCloseTo(2300, 9);
    expect(h.filter((l) => area(l) < 0)).toHaveLength(1); // the hole comes out clockwise
  });

  it('handles corners that only touch, identical shapes and one inside the other', () => {
    const t = boolean([sq(0, 0, 10, 10)], [sq(10, 10, 20, 20)], 'union');
    expect(t).toHaveLength(2);
    expect(t.every((l) => area(l) > 0 && l.length === 4)).toBe(true);
    const same = boolean([sq(0, 0, 10, 10)], [sq(0, 0, 10, 10)], 'union');
    expect(same).toHaveLength(1);
    expect(area(same[0])).toBeCloseTo(100, 9);
    expect(boolean([sq(0, 0, 10, 10)], [sq(0, 0, 10, 10)], 'diff')).toHaveLength(0);
    const big = boolean([sq(2, 2, 8, 8)], [sq(0, 0, 10, 10)], 'union');
    expect(big).toHaveLength(1);
    expect(area(big[0])).toBeCloseTo(100, 9);
    expect(boolean([sq(0, 0, 10, 10)], [sq(2, 2, 8, 8)], 'inter').map(area)).toEqual([36]);
  });

  it('cuts across a board in two, and a circle and a slot at its edge', () => {
    const o = sq(0, 0, 60, 40);
    expect(boolean([o], [sq(20, -5, 30, 45)], 'diff')).toHaveLength(2);
    const c = boolean([o], [circlePts([60, 20], 8)], 'diff');
    expect(c).toHaveLength(1);
    expect(area(c[0])).toBeCloseTo(2400 - area(circlePts([0, 0], 8)) / 2, 2);
    const s = boolean([o], [slotLoop([30, 45], [30, 30], 6)], 'diff');
    expect(s).toHaveLength(1);
    expect(selfCross(s[0])).toBeNull();
  });

  it('works on a board with holes: a shape over a hole fills it or joins it', () => {
    const o = sq(0, 0, 60, 40), hole = [...sq(10, 10, 20, 20)].reverse();
    const filled = boolean([o, hole], [sq(5, 5, 25, 25)], 'union');
    expect(filled).toHaveLength(1);
    expect(area(filled[0])).toBeCloseTo(2400, 9);
    const joined = boolean([o, hole], [sq(15, 15, 30, 30)], 'diff');
    expect(joined).toHaveLength(2);
    expect(A(joined)).toBeCloseTo(2400 - 100 - 225 + 25, 9);
  });

  it('agrees with a sampled area on random overlapping polygons', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const star = (cx: number, cy: number, n: number): Loop => Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2, r = 6 + rnd() * 8; return [Math.round((cx + r * Math.cos(a)) * 10) / 10, Math.round((cy + r * Math.sin(a)) * 10) / 10] as V2; });
    for (let trial = 0; trial < 12; trial++) {
      const P = star(0, 0, 7 + (trial % 5)), Q = star(4 + rnd() * 6, rnd() * 6, 5 + (trial % 4));
      if (selfCross(P) || selfCross(Q)) continue;
      for (const op of ['union', 'diff', 'inter'] as const) {
        const R = boolean([P], [Q], op);
        for (const l of R) expect(selfCross(l)).toBeNull();
        // count grid points in the result against the rule
        let agree = 0, total = 0;
        for (let x = -15; x <= 25; x += 0.73) for (let y = -15; y <= 22; y += 0.71) {
          const p: V2 = [x, y], a = inside(p, P), b = inside(p, Q);
          const want = op === 'union' ? a || b : op === 'diff' ? a && !b : a && b;
          const got = R.reduce((c, l) => (inside(p, l) ? !c : c), false);
          total++; if (want === got) agree++;
        }
        expect(agree / total).toBeGreaterThan(0.999);
      }
    }
  });
});

describe('boolean on grid-aligned shapes (shared edges and corners everywhere)', () => {
  it('builds a board up from many rectangles and keeps it right', () => {
    let seed = 11;
    const rnd = (n: number) => Math.floor(((seed = (seed * 16807) % 2147483647) / 2147483647) * n);
    let region: Loop[] = [sq(0, 0, 20, 20)];
    for (let k = 0; k < 40; k++) {
      const x = rnd(24) - 2, y = rnd(24) - 2, R = sq(x, y, x + 2 + rnd(8), y + 2 + rnd(8));
      const op = k % 3 === 0 ? 'diff' : 'union';
      const next = boolean(region, [R], op);
      for (const l of next) expect(selfCross(l)).toBeNull();
      // every unit cell's centre agrees with the rule
      for (let cx = -3.5; cx < 36; cx += 1) for (let cy = -3.5; cy < 36; cy += 1) {
        const p: V2 = [cx, cy], a = region.reduce((c, l) => (inside(p, l) ? !c : c), false), b = inside(p, R);
        const got = next.reduce((c, l) => (inside(p, l) ? !c : c), false);
        expect(got).toBe(op === 'union' ? a || b : a && !b);
      }
      region = next;
    }
  });
});

describe('combine: adding to and cutting from a board', () => {
  const o = sq(0, 0, 60, 40);
  it('adds a tab and cuts a notch and a cut-out', () => {
    const tab = combine(o, [], sq(20, 35, 40, 50), 'add');
    expect('error' in tab).toBe(false);
    if ('outline' in tab) { expect(area(tab.outline)).toBeCloseTo(2400 + 200, 9); expect(tab.cutouts).toEqual([]); }
    const hole = combine(o, [], circlePts([30, 20], 5), 'cut');
    if (!('outline' in hole)) throw new Error(hole.error);
    expect(hole.cutouts).toHaveLength(1);
    expect(area(hole.cutouts[0])).toBeLessThan(0);
    expect(shapeProblem(hole.outline, hole.cutouts)).toBeNull();
  });
  it('refuses what would not make one board', () => {
    expect(combine(o, [], sq(100, 100, 110, 110), 'add')).toEqual({ error: expect.stringMatching(/does not touch/) });
    expect(combine(o, [], sq(20, -5, 30, 45), 'cut')).toEqual({ error: expect.stringMatching(/in two/) });
    expect(combine(o, [], sq(-5, -5, 65, 45), 'cut')).toEqual({ error: expect.stringMatching(/whole board/) });
    expect(combine(o, [], sq(10, 10, 20, 20), 'add')).toEqual({ error: expect.stringMatching(/inside the board already/) });
    expect(combine(o, [], sq(100, 100, 110, 110), 'cut')).toEqual({ error: expect.stringMatching(/not on the board/) });
    expect(combine(o, [], [[0, 0], [10, 10], [10, 0], [0, 10]], 'add')).toEqual({ error: expect.stringMatching(/cross/) });
  });
});

describe('shapes', () => {
  it('makes slots, polygons and holes in their corners', () => {
    const s = slotLoop([0, 0], [20, 0], 6);
    const bb = bbox(s);
    expect(bb.x0).toBeCloseTo(-3, 6); expect(bb.x1).toBeCloseTo(23, 6); expect(bb.y1 - bb.y0).toBeCloseTo(6, 6);
    expect(selfCross(s)).toBeNull();
    expect(area(s)).toBeGreaterThan(0);
    const hex = polygonLoop(6, 20, [20, 20]);
    expect(hex).toHaveLength(6);
    expect(Math.abs(hex[0][1] - hex[1][1])).toBeLessThan(1e-6); // flat at the bottom
    expect(cornerHoles(hex, 4, 3)).toHaveLength(6);
    const L: Loop = [[0, 0], [60, 0], [60, 20], [30, 20], [30, 40], [0, 40]];
    const hs = cornerHoles(L, 3.5, 3.2);
    expect(hs).toHaveLength(5);
    expect(hs).toContainEqual([3.5, 3.5]);
    expect(hs).toContainEqual([56.5, 16.5]);
  });
});

describe('snapping', () => {
  const base = (over: Partial<SnapIn> = {}): SnapIn => ({ xs: [0, 60], ys: [0, 40], pts: [[0, 0], [60, 0], [60, 40], [0, 40]], anchors: [], edges: [], grid: 0.5, tol: 1, ...over });
  it('lands on a corner, lines up with x and y, else the grid', () => {
    expect(snapPoint([59.6, 40.3], base()).p).toEqual([60, 40]);
    const s = snapPoint([59.7, 22.34], base({ pts: [] }));
    expect(s.p).toEqual([60, 22.5]);
    expect(s.gx).toBe(60);
    expect(snapPoint([12.3, 22.2], base({ pts: [] })).p).toEqual([12.5, 22]);
    expect(snapPoint([12.34, 22.21], base({ pts: [], grid: 0 })).p).toEqual([12.34, 22.21]);
  });
  it('snaps the angle from a neighbour to 15-degree steps, and where two such lines meet', () => {
    const s = snapPoint([10.3, 10.1], base({ xs: [], ys: [], pts: [], anchors: [[0, 0]] }));
    expect(s.rays[0].deg).toBe(45);
    expect(Math.abs(s.p[0] - s.p[1])).toBeLessThan(1e-6);
    // square corner between (0, 0) and (20, 20): (20, 0) or (0, 20)
    const c = snapPoint([19.6, 0.5], base({ xs: [], ys: [], pts: [], anchors: [[0, 0], [20, 20]] }));
    expect(c.p).toEqual([20, 0]);
    expect(c.rays).toHaveLength(2);
    // Shift: the angle is forced, the length on the grid
    const f = snapPoint([10, 3], base({ xs: [], ys: [], pts: [], force15: [0, 0] }));
    expect(f.rays[0].deg).toBe(15);
    expect(Math.hypot(...f.p)).toBeCloseTo(10.5, 6);
  });
  it('lands on an edge, and where the line it lines up with crosses one', () => {
    const e = snapPoint([20.2, 0.6], base({ xs: [], ys: [], pts: [], edges: [[[0, 0], [60, 0]]], grid: 0 }));
    expect(e.p).toEqual([20.2, 0]);
    expect(e.on).toBe('edge');
    const slanted = snapPoint([10.4, 10.9], base({ xs: [10], ys: [], pts: [], edges: [[[0, 0], [40, 40]]] }));
    expect(slanted.p).toEqual([10, 10]);
  });
  it('types lengths and angles', () => {
    expect(polar([10, 10], 20, 90)).toEqual([10, 30]);
    expect(polar([0, 0], 10, 30)[1]).toBeCloseTo(5, 9);
    expect(lenAng([0, 0], [0, -5])).toEqual({ L: 5, deg: 270 });
  });
});

describe('off the board', () => {
  it('lists holes and parts a new shape leaves off the board, not plugs meant to overhang the edge', () => {
    const b = board(sq(0, 0, 60, 40), {
      holes: [{ id: 'in', x: 5, y: 5, d: 3, plated: true, use: 'auto' }, { id: 'out', x: 70, y: 5, d: 3, plated: true, use: 'auto' }, { id: 'edge', x: 59.5, y: 20, d: 3, plated: true, use: 'auto' }],
      comps: [
        { id: 'chip', ref: 'U1', pkg: '', side: 'top', x: 80, y: 20, rot: 0, w: 5, l: 5, h: 1, kind: 'generic', tht: false },
        { id: 'usb', ref: 'J1', pkg: '', side: 'top', x: 61, y: 20, rot: 0, w: 8, l: 7, h: 3, kind: 'connector', tht: false, conn: { type: 'usb_c', entry: 'edge', angle: 0, zc: 1.6, plug: { w: 8, h: 3, len: 20, cable: 4 }, cradle: false, cap: false, guard: false, tie: false } },
      ],
    });
    const o = offBoard(b);
    expect(o.holes.sort()).toEqual(['edge', 'out']);
    expect(o.comps).toEqual(['chip']);
    b.cutouts = [[...sq(2, 2, 10, 10)].reverse()];
    expect(offBoard(b).holes).toContain('in');
  });
});

describe('dimensions to the corners of an odd outline', () => {
  const L = (): Board => board([[0, 0], [60, 0], [60, 20], [30, 20], [30, 40], [0, 40]]);
  it('picks a corner ahead of the edge it sits on, measures to it and moves it when typed', () => {
    const b = L();
    expect(pickFeat(b, [30.4, 20.3], 2)).toEqual({ k: 'corner', i: 3, at: 'c' });
    expect(pickFeat(b, [0.3, 10], 2)).toEqual({ k: 'edge', at: 'x0' });
    const d: Dim = { id: 'd', a: { k: 'edge', at: 'x0' }, b: { k: 'corner', i: 3, at: 'c' }, axis: 'x' };
    expect(axisOf(b, d.a, d.b)).toBe('x');
    expect(measure(b, d)).toBe(30);
    expect(setDim(b, d, 35)).toBe(true);
    expect(b.outline[3]).toEqual([35, 20]);
    // not onto another edge, where the outline would cross itself
    expect(setDim(b, d, 0)).toBe(false);
    expect(b.outline[3]).toEqual([35, 20]);
  });
  it('dimensions follow their corner when others are added or taken away, and go with it', () => {
    const b = L(), prev = b.outline;
    b.dims = [{ id: 'd', a: { k: 'edge', at: 'x0' }, b: { k: 'corner', i: 3, at: 'c' }, axis: 'x' }];
    b.outline = addCorner(prev, 0, [30, 0]);
    followCorners(b, prev);
    expect(b.dims[0].b.i).toBe(4);
    const p2 = b.outline;
    b.outline = cornerCut(p2, [4], 'round', 3).loop;
    followCorners(b, p2);
    expect(b.dims).toEqual([]);
  });
});

describe('drawn boards of odd shapes', () => {
  const base = { name: '', w: 60, h: 40, r: 3, t: 1.6, holes: 'corners' as const, inset: 3.5, d: 3.2, sx: 50, sy: 30 };
  it('makes each shape a simple outline with its holes on the board', () => {
    for (const shape of ['rect', 'round', 'circle', 'L', 'notch', 'corner', 'poly', 'flat', 'custom'] as const) {
      const o = drawnOutline({ ...base, shape });
      if (!('outline' in o)) throw new Error(`${shape}: ${o.error}`);
      expect(loopProblem(o.outline)).toBeNull();
      expect(area(o.outline)).toBeGreaterThan(0);
      const b = drawnBoard({ ...base, shape });
      const bb = bbox(b.outline);
      expect([bb.x0, bb.y0].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0]);
      expect(offBoard(b).holes).toEqual([]);
      expect(b.holes.length).toBeGreaterThanOrEqual(shape === 'flat' ? 2 : 4);
    }
  });
  it('sizes them as asked', () => {
    const L = drawnBoard({ ...base, shape: 'L', cw: 25, ch: 18 });
    expect(area(L.outline)).toBeCloseTo(2400 - 450, 6);
    expect(L.holes).toHaveLength(5);
    const n = drawnBoard({ ...base, shape: 'notch', nw: 12, nd: 5, side: 'left' });
    expect(area(n.outline)).toBeCloseTo(2400 - 60, 6);
    expect(n.outline.some(([x, y]) => x === 5 && y === 14)).toBe(true);
    const c = drawnBoard({ ...base, shape: 'corner', c: 6, one: false });
    expect(area(c.outline)).toBeCloseTo(2400 - 4 * 18, 6);
    const hex = drawnBoard({ ...base, shape: 'poly', n: 6, w: 50 });
    expect(hex.outline).toHaveLength(6);
    expect(bbox(hex.outline).x1).toBeCloseTo(50, 6);
    const f = drawnBoard({ ...base, shape: 'flat', w: 50, f: 8 });
    expect(bbox(f.outline).y1).toBeCloseTo(42, 6);
    expect('error' in drawnOutline({ ...base, shape: 'L', cw: 70 })).toBe(true);
    expect('error' in drawnOutline({ ...base, shape: 'notch', nw: 70 })).toBe(true);
  });
});
