// How a holder's tongue sits in its socket (docs/din-clip-review.md, "Seen along the way" and the round after the first
// print): the play before, the crush ribs that take some of it up, and the latch nose's catch. Play is measured the way
// the review did, by sliding the dock end until it meets the socket.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { box, freeAll, initKernel, type MF } from '../src/cad/kernel';
import { crushRibs, flatHolderDock, holderDock, latchGroove, noseSolid, socket, tongue } from '../src/cad/dock';
import { CRUSH, LATCH, latchGeom, TONGUE } from '../src/cad/dockdims';

let s: MF;
beforeAll(async () => { await initKernel(); });
beforeEach(() => { s = socket(); }); // (freeAll below frees every solid)

/** How far `m` slides along `d` before it meets the socket (steps of 0.02 mm). */
function slide(m: MF, d: number[], max = 1.5, hold: MF = s): number {
  for (let k = 0.02; k <= max; k += 0.02) if (m.translate([d[0] * k, d[1] * k, d[2] * k]).intersect(hold).volume() > 1e-3) return +(k - 0.02).toFixed(2);
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
  it('is loose by a slip fit: 0.2 mm a side, 0.15 to 0.2 front and back, and 0.65 mm of lift before the nose\'s catch (the rigid part, ribs left off)', () => {
    const rigid = make().subtract(crushRibs(0));
    expect(rigid.intersect(s).volume()).toBeLessThan(1e-3);
    const play = { up: slide(rigid, [0, 0, 1]), down: slide(rigid, [0, 0, -1]), back: slide(rigid, [0, -1, 0]), front: slide(rigid, [0, 1, 0]), left: slide(rigid, [-1, 0, 0]), right: slide(rigid, [1, 0, 0]) };
    console.log('rigid play', JSON.stringify(play));
    // the lift: the nose's holding face is undercut, so the groove floor sits `play` under it (0.65 mm)
    expect(play.up).toBeGreaterThan(LATCH.play - 0.06); expect(play.up).toBeLessThan(LATCH.play + 0.06);
    expect(play.down).toBeLessThan(0.05); // (the pedestal is on the socket top)
    for (const v of [play.back, play.front]) { expect(v).toBeGreaterThan(0.1); expect(v).toBeLessThan(0.22); }
    for (const v of [play.left, play.right]) { expect(v).toBeGreaterThan(0.15); expect(v).toBeLessThan(0.25); }
    freeAll();
  });

  it('has its two crush ribs press the socket\'s chamfered corners a tenth of a millimetre, and nothing else of it touches', () => {
    const dock = make(), ribs = crushRibs(0), rigid = dock.subtract(ribs);
    // (the rigid part is measured against the socket by the test above; here what touches is only the ribs)
    expect(Math.abs(dock.intersect(s).volume() - ribs.intersect(s).volume())).toBeLessThan(0.02);
    // a rib's crest, pressed into the socket's corner face: along its normal (the faces are 0.4 x 0.707 = 0.28 mm apart)
    const corner = ribs.intersect(box(0, -20, -30, 20, 20, 10));
    const along = clear(corner, [-0.7071, -0.7071, 0]);
    console.log('rib crest pressed', along, 'along the corner face\'s normal; volume', ribs.intersect(s).volume().toFixed(2));
    expect(along).toBeGreaterThan(0.09); expect(along).toBeLessThan(0.15);
    expect(along).toBeCloseTo(CRUSH.proud - Math.SQRT1_2 * 0.4, 1);
    expect(rigid.intersect(s).volume()).toBeLessThan(1e-3);
    // pushed back onto its divider (0.15 mm) a rib is pressed less, and nothing else touches then either
    freeAll();
  });
});

describe('the tongue with its ribs', () => {
  it('is one solid at every fit, its ribs grow out of the corner faces and stay 1.8 mm wide where they do', async () => {
    for (const fit of [0, 0.2, 0.4]) {
      const t = tongue(0.2, fit);
      expect(t.decompose().length, `fit ${fit}`).toBe(1);
      // one rib a corner, 1.6 mm long down the tongue: a slice across them (z -12.5) has the tongue and, either side, its two ribs joined to it
      const sl = t.intersect(box(-10, -10, -12.5, 10, 10, -12.49));
      expect(sl.decompose().length, `fit ${fit}: the slice at z -12.5`).toBe(1);
      const bare = tongue(0.2, fit).subtract(crushRibs(fit));
      expect(t.volume() - bare.volume(), `fit ${fit}: the ribs' volume`).toBeGreaterThan(0.8);
    }
    freeAll();
  });
});

describe('the latch nose in the tongue\'s groove', () => {
  const g = () => latchGeom();
  it('sits in the groove with its holding face `play` over the floor, the groove floor undercut the same as the nose\'s face', () => {
    const p = LATCH, gm = g(), groove = latchGroove();
    // the groove's floor line at the nose's tip and root, against the nose's underside
    const b = groove.bounds();
    expect(b.min[0]).toBeCloseTo(gm.yT - 0.15, 2); // back wall 0.15 mm past the nose's tip
    expect(TONGUE.y1 - gm.yT).toBeCloseTo(p.engage, 6);
    expect(p.engage).toBeGreaterThan(1.05); // deeper than the 1.05 mm it was
    // the nose (its own solid) against the tongue: clear at rest, and a lift of `play` brings the groove floor onto its face
    const t = tongue(0.2, 0).subtract(crushRibs(0)), n = noseSolid();
    expect(t.intersect(n).volume()).toBeLessThan(1e-4);
    const lift = slide(t, [0, 0, 1], 1.5, n);
    console.log('the groove floor meets the nose after', lift);
    expect(lift).toBeGreaterThan(p.play - 0.06); expect(lift).toBeLessThan(p.play + 0.06);
    freeAll();
  });

  it('lets go when the nose is pressed out along the beam\'s arc (out, and a hair down), holder seated: the undercut needs the play', () => {
    const p = LATCH, t = tongue(0.2, 0).subtract(crushRibs(0)), n = noseSolid();
    // the nose out to the tongue's face and 0.15 past it, a beam that drops 0.1 mm doing so: nothing is caught
    const dOut = p.engage + 0.15, drop = 0.1;
    for (let k = 0; k <= 10; k++) {
      const d = (dOut * k) / 10;
      expect(t.intersect(n.translate([0, d, -drop * (d / dOut)])).volume(), `the nose out ${d.toFixed(2)} mm`).toBeLessThan(1e-3);
    }
    // and the same nose with the holder lifted off its seat by 0.35 mm would catch (the undercut wedge: it takes the lift to be out of the way first)
    expect(t.translate([0, 0, 0.62]).intersect(n.translate([0, dOut * 0.5, -drop * 0.5])).volume()).toBeGreaterThan(0.01);
    freeAll();
  });
});
