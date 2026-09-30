// The holder's rattle in its socket (docs/din-clip-review.md: "seen along the way"): the play before, and what presses it
// out now. Play is measured the way the review did, by sliding the dock end until it meets the socket.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { box, freeAll, initKernel, type MF } from '../src/cad/kernel';
import { flatHolderDock, holdBumps, holderDock, socket } from '../src/cad/dock';

let s: MF;
beforeAll(async () => { await initKernel(); });
beforeEach(() => { s = socket(); }); // (freeAll below frees every solid)

/** How far `m` slides along `d` before it meets the socket (steps of 0.02 mm). */
function slide(m: MF, d: number[], max = 1.5): number {
  for (let k = 0.02; k <= max; k += 0.02) if (m.translate([d[0] * k, d[1] * k, d[2] * k]).intersect(s).volume() > 1e-3) return +(k - 0.02).toFixed(2);
  return max;
}
/** How far along `d` it has to go to be clear of the socket. */
function clear(m: MF, d: number[], max = 1.5): number {
  for (let k = 0.02; k <= max; k += 0.02) if (m.translate([d[0] * k, d[1] * k, d[2] * k]).intersect(s).volume() < 1e-4) return +k.toFixed(2);
  return max;
}

const ends: [string, () => MF][] = [
  ['a standing holder\'s dock end', () => { const f = holderDock(40, 3, 0, 0); return f.add.subtract(f.cut); }],
  ['a flat holder\'s key', () => flatHolderDock(30, 0).key],
];

describe.each(ends)('%s in its socket', (_n, make) => {
  it('had 0.3 mm of lift before the latch caught, and 0.14 and 0.2 mm across and sideways (the rigid part, bumps left off)', () => {
    const rigid = make().subtract(holdBumps(0).all);
    expect(rigid.intersect(s).volume()).toBeLessThan(1e-3);
    const play = { up: slide(rigid, [0, 0, 1]), down: slide(rigid, [0, 0, -1]), back: slide(rigid, [0, -1, 0]), front: slide(rigid, [0, 1, 0]), left: slide(rigid, [-1, 0, 0]), right: slide(rigid, [1, 0, 0]) };
    console.log('rigid play', JSON.stringify(play));
    expect(play.up).toBeGreaterThan(0.25); expect(play.up).toBeLessThan(0.35);
    expect(play.down).toBeLessThan(0.05); // (the pedestal is on the socket top)
    for (const v of [play.back, play.front]) { expect(v).toBeGreaterThan(0.1); expect(v).toBeLessThan(0.2); }
    for (const v of [play.left, play.right]) { expect(v).toBeGreaterThan(0.15); expect(v).toBeLessThan(0.25); }
    freeAll();
  });

  it('now rests held up on the latch\'s catch and back on its divider, each bump pressing the socket a little and nothing rigid touching', () => {
    const dock = make(), B = holdBumps(0), rigid = dock.subtract(B.all);
    const up = slide(rigid, [0, 0, 1]), back = slide(rigid, [0, -1, 0]);
    const rest = (m: MF) => m.translate([0, -back, up]);
    expect(rest(rigid).intersect(s).volume()).toBeLessThan(1e-3);
    // the pedestal's bumps on the socket top: pressed by what the catch's play leaves of their height
    const lift = clear(rest(B.lift), [0, 0, 1]);
    // a corner bump on its 45 degree face, the tongue centred: along the face's normal, and as the leaf sees it (x)
    const corner = rest(B.side).intersect(box(0, -20, -30, 20, 20, 10));
    const along = clear(corner, [-0.7071, -0.7071, 0]), inX = clear(corner, [-1, 0, 0]);
    console.log('pressed at rest: lift', lift, 'corner along its normal', along, 'in x', inX);
    expect(lift).toBeGreaterThan(0.07); expect(lift).toBeLessThan(0.14);
    expect(along).toBeGreaterThan(0.1); expect(along).toBeLessThan(0.22);
    expect(inX).toBeGreaterThan(0.15); expect(inX).toBeLessThan(0.3);
    // and everything that touches the socket at rest is a bump (an intersection of the whole end is only theirs)
    const all = rest(dock).intersect(s).volume(), bumps = rest(B.all).intersect(s).volume();
    expect(Math.abs(all - bumps)).toBeLessThan(0.02);
    // pressed right home (down onto the socket top) the lift bumps are flush: the pedestal seats as it always did
    expect(B.lift.intersect(s).volume()).toBeGreaterThan(0.5); // (0.4 mm proud: pressed into the socket top until the leaf gives)
    freeAll();
  });
});

describe('the tongue with its leaves', () => {
  it('is one solid at every fit, and its side leaves stay free of the tongue (0.5 mm slot behind each)', async () => {
    const { tongue } = await import('../src/cad/dock');
    for (const fit of [0, 0.2, 0.4]) {
      const t = tongue(0.2, fit);
      expect(t.decompose().length, `fit ${fit}`).toBe(1);
      // a slice across the tongue near its tip: the leaves are separate strips either side of the middle, joined to it
      // only above their roots
      const sl = t.intersect(box(-10, -10, -12.6, 10, 10, -12.5));
      expect(sl.decompose().length, `fit ${fit}: strips at z -12.5`).toBe(3);
    }
    freeAll();
  });
});
