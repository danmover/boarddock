// The release rod and its tunnel after the first print: the rod would not go through the holder without a hard push, and
// the push broke the button off its rod. What was wrong and what is different now: real FDM clearance (a hole prints small
// and its roof sags: 0.2 mm each way was 0.4 mm on the diameter, 0.9 now), lead-in chamfers at every mouth, a wider rod
// (3.6 wide instead of 3.2) with a filleted neck and no slot cut into the stretch a push off-centre bends, barbs that stand clear of their finger
// roots, and a rod through a column of holders that tolerates them being off each other by a quarter of a millimetre.
import { beforeAll, describe, expect, it } from 'vitest';
import { box, csLoops, extCh, circle2, freeAll, initKernel, poly, rect2, roundCS, toMesh, unionCS, unionMF, type MF } from '../src/cad/kernel';
import { extXZ, extYZ, flatHolderDock, holderDock, rod } from '../src/cad/dock';
import { HD, headSpan, LANDING } from '../src/cad/dockdims';
import { layerCheck, verdict } from '../src/cad/printcheck';
import { neckFea } from '../src/fea/dockfea';

beforeAll(async () => { await initKernel(); });
const vol = (a: MF, b: MF) => a.intersect(b).volume();
const P = (pts: number[][]) => poly(pts as [number, number][], 'NonZero');
/** how far `m` slides along `d` before it meets `hold` (steps of 0.02 mm) */
function slide(m: MF, hold: MF, d: number[], max = 1.5): number {
  for (let k = 0.02; k <= max; k += 0.02) if (vol(m.translate([d[0] * k, d[1] * k, d[2] * k]), hold) > 1e-3) return +(k - 0.02).toFixed(2);
  return max;
}
const up = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]; // socket-local y up: how the holder side prints
const OLD_HEAD_Y1 = 14; // (the button head reached to y 14 before, 12.5 now)

describe('the clearance', () => {
  it('is 0.8 mm across and 0.8 mm in y round the rod in the bore (0.4 each before), 0.6 mm across at the gate, and the whole 3.1 mm stroke is free', () => {
    expect(2 * (HD.tunnelHx - HD.rodHx)).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(2 * (HD.catch.ledge - HD.rodHx)).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(HD.tunnelY[1] - HD.tunnelY[0] - (HD.rodY[1] - HD.rodY[0])).toBeGreaterThanOrEqual(0.8 - 1e-9);
    for (const [name, mk] of [
      ['standing', () => { const f = holderDock(40, 3, 0, 0); return { hold: f.add.subtract(f.cut), r: rod(f.zg1, 0).m }; }],
      ['flat', () => { const f = flatHolderDock(30, 0); return { hold: f.add.subtract(f.cut).add(f.key), r: rod(f.top, 0).m }; }],
    ] as const) {
      const { hold, r } = mk();
      expect(vol(r, hold), name).toBeLessThan(1e-3);
      for (const dz of [0, 1.5, 3.1]) {
        const m = r.translate([0, 0, -dz]);
        expect(vol(m, hold), `${name} pressed ${dz}`).toBeLessThan(1e-3);
        const play = { px: slide(m, hold, [1, 0, 0]), nx: slide(m, hold, [-1, 0, 0]), py: slide(m, hold, [0, 1, 0]), ny: slide(m, hold, [0, -1, 0]) };
        if (dz === 0) console.log(name, 'play', JSON.stringify(play));
        // the tightest place is the gate (0.3 each side): under it the play measured is at least 0.26 each way, 0.36 up and down in y
        expect(Math.min(play.px, play.nx), `${name} across`).toBeGreaterThanOrEqual(0.26);
        expect(play.py, `${name} +y`).toBeGreaterThanOrEqual(0.36); expect(play.ny, `${name} -y`).toBeGreaterThanOrEqual(0.36);
      }
      freeAll();
    }
  });

  it('the rod is clicked in by two barbs: pulled up it stops after 0.2 to 0.3 mm on the gate, pushed in it passes it', () => {
    const f = holderDock(40, 3, 0, 0), hold = f.add.subtract(f.cut), r = rod(f.zg1, 0).m;
    expect(vol(r.translate([0, 0, 0.5]), hold)).toBeGreaterThan(0.05);
    expect(vol(r.translate([0, 0, 0.15]), hold)).toBeLessThan(1e-3);
    freeAll();
  });
});

describe('the walls round the tunnel', () => {
  it('none is under a print line (0.4 mm): the spine\'s 0.8 mm beside the bore, and 1.2 mm round the barbs\' pocket under the grip bar, whichever side the spine runs', () => {
    for (const [side, col] of [[0, undefined], [1, undefined], [-1, undefined], [1, { foot: true, landing: false }], [-1, { foot: true, landing: false }]] as const) {
      const f = holderDock(40, 3, side, 0, col as any), q = layerCheck(toMesh(f.add.subtract(f.cut).transform(up as any)))!;
      expect(q.thin, `side ${side}${col ? ', top of a column' : ''}`).toBeNull();
      freeAll();
    }
    expect(HD.spineHx - HD.tunnelHx).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(HD.collar.hx - HD.catch.pocket).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });
});

describe('the lead-ins', () => {
  it('the tunnel opens at both ends in 45 degree chamfers (the top a funnel the button\'s neck fillets sit in when pressed home), the rod\'s tip is chamfered on all sides', () => {
    const f = holderDock(40, 3, 0, 0), t = f.tunnel, wid = (m: MF, z0: number, z1: number) => { const b = m.intersect(box(-20, -20, z0, 20, 20, z1)).boundingBox(); return [b.max[0] - b.min[0], b.max[1] - b.min[1]]; };
    const [wBore, hBore] = wid(t, 20, 20.1), [wTop, hTop] = wid(t, f.zg1 - 0.05, f.zg1), [wBot, hBot] = wid(t, -0.2, -0.15);
    console.log('tunnel: bore', wBore.toFixed(2), 'x', hBore.toFixed(2), 'top', wTop.toFixed(2), 'x', hTop.toFixed(2), 'bottom', wBot.toFixed(2), 'x', hBot.toFixed(2));
    expect(wBore).toBeCloseTo(2 * HD.tunnelHx, 1);
    expect(wTop).toBeGreaterThan(2 * HD.tunnelHx + 2 * HD.mouth.x - 0.5); // the funnel's mouth
    expect(hTop).toBeGreaterThan(HD.tunnelY[1] - HD.tunnelY[0] + HD.mouth.yNeg); // wider under (the floor) and over (the roof)
    expect(wBot).toBeGreaterThan(2 * HD.tunnelHx + 2 * HD.mouth.exit - 0.5);
    const r = rod(f.zg1, 0).m, tip = r.intersect(box(-20, -20, HD.rodRest, 20, 20, HD.rodRest + 0.05)).boundingBox();
    expect(tip.max[0] - tip.min[0]).toBeLessThan(2 * HD.rodHx - 1.2); // (a 45 degree chamfer of nearly a millimetre each side)
    freeAll();
  });
});

describe('the neck under the button', () => {
  it('is 3.6 mm wide (3.2 before), solid for the stretch between the button and the tunnel\'s mouth, and filleted into the head', () => {
    const f = holderDock(40, 3, 0, 0), r = rod(f.zg1, 0).m, zh = f.zg1 + HD.stroke;
    expect(HD.rodHx * 2).toBeGreaterThanOrEqual(3.6 - 1e-9);
    // a slice across the shaft under the head: the whole rod section, no slot (the fingers' slots start 1.7 mm under the mouth)
    const full = 2 * HD.rodHx * (HD.rodY[1] - HD.rodY[0]);
    for (const d of [2.5, 3.5, 4.5]) expect(r.slice(zh - d).area(), `${d} mm under the head`).toBeGreaterThan(full - 0.1);
    // the fillets: in x the section at the head's face is wider than the shaft by twice the fillet radius (in the layers)
    expect(r.slice(zh - 0.2).area()).toBeGreaterThan(full + 2 * HD.neckFillet.x * 0.15 * 2);
    // in the print pose (y up) a slice through the shaft's middle shows shaft, fillets and head as one piece, its layers running into the head
    const sec = r.transform(up as any).slice((HD.rodY[0] + HD.rodY[1]) / 2);
    expect(sec.decompose().length).toBe(1);
    freeAll();
  });

  it('prints on its back (y up): the shaft\'s layers run into the head, no support, nothing that bridges more than a few mm', () => {
    const f = holderDock(40, 3, 0, 0), q = layerCheck(toMesh(rod(f.zg1, 0).m.transform(up as any)))!;
    const v = verdict(q, true);
    console.log('rod', v.brief);
    expect(q.islands).toEqual([]);
    expect(q.gaps).toBeNull(); // (the fingers' 0.5 mm slots stay open)
    expect(q.cantilever?.reach ?? 0).toBeLessThan(2);
    expect(v.status).not.toBe('bad');
    freeAll();
  });

  it('bends under a push off-centre (4 mm across; on the head\'s far edge along it) with less strain than the old neck', () => {
    // the old rod: 3.2 x 2.2, its slots cut right up to the head, no fillets: rebuilt here from its dimensions
    const zg1 = 54, zh = zg1 + HD.stroke, [y0, y1] = HD.rodY, [x0, x1] = headSpan(0);
    const oldRod = (() => {
      const hx = 1.6, zcat = zg1 - 2.0 - 0.2, zb = zcat - 0.4 - 0.5;
      const shaft = extYZ(P([[y0, HD.rodRest], [y0 + 0.6, HD.rodRest], [y1, HD.rodRest + 1.6], [y1, zh + 0.01], [y0, zh + 0.01]]), hx)
        .subtract(extXZ(unionCS([rect2(0.2, zb - 0.5, 0.7, zh), rect2(0.2, zb - 0.5, hx + 0.1, zb)]), y0 - 0.1, y1 + 0.1));
      const hw = (x1 - x0) / 2, dish = 0.7, R = (hw * hw + dish * dish) / (2 * dish), xc = (x0 + x1) / 2;
      const face = roundCS(rect2(x0, zh, x1, zh + HD.head.t), 1.1).subtract(circle2(xc, zh + HD.head.t + R - dish, R, 256));
      const head = extCh(face, 0, OLD_HEAD_Y1 - y0, 0.2, 0.6).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, OLD_HEAD_Y1, 0, 1] as any);
      return unionMF([shaft, head]);
    })();
    const xzRot = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1], yzRot = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    const run = (m: MF, wide: number, headY1: number) => {
      const crop = rect2(-30, -zh - 3.5, 30, -zh + 8), sx = m.transform(xzRot as any).slice((y0 + y1) / 2).intersect(crop);
      const lx = csLoops(sx).map((l) => l.map(([a, b]) => [a, -b] as [number, number]));
      const ly = csLoops(m.transform(yzRot as any).slice(0.05).intersect(rect2(0, zh - 8, 30, zh + 3.5)));
      const across = neckFea(lx, 2100, 0.38, 0.1, { t: y1 - y0, wt: (_a, z) => (z > zh ? (headY1 - y0) / (y1 - y0) : 1), zcut: zh - 3.1, load: [1, 7] });
      const along = neckFea(ly, 2100, 0.38, 0.1, { t: wide, wt: (_a, z) => (z > zh ? 16 / wide : 1), zcut: zh - 3.1, load: [headY1 - 2.5, headY1] }); // (a thumb on the head's far edge)
      return { across: across.perN, along: along.perN };
    };
    const before = run(oldRod, 3.2, OLD_HEAD_Y1), after = run(rod(zg1, 0).m, 2 * HD.rodHx, HD.head.y1);
    console.log('strain per N at the neck: across', (before.across * 100).toFixed(3), '->', (after.across * 100).toFixed(3), '%; along', (before.along * 100).toFixed(3), '->', (after.along * 100).toFixed(3), '%');
    expect(after.across).toBeLessThan(before.across * 0.9);
    expect(after.along).toBeLessThan(before.along * 0.85); // (the head is 1.5 mm shorter in y, so the far edge is nearer the shaft too)
    expect(after.across * 10).toBeLessThan(0.0105); // (10 N pushed 4 mm off-centre: about 1%)
    freeAll();
  });
});

describe('a rod down a column of three holders', () => {
  it('goes through every holder\'s tunnel with each one up to 0.25 mm off the one under it, both ways (the tunnel had 0.2 mm each side)', () => {
    const cfg = [{ far: 12, col: { foot: false, landing: true } }, { far: 10, col: { foot: true, landing: true } }, { far: 10, col: { foot: true, landing: false } }] as const;
    const fs = cfg.map((c) => holderDock(c.far, 3, 0, 0, c.col));
    const z1 = fs.map((f) => f.zg1), z = [0, z1[0], z1[0] + z1[1]]; // (each holder's socket-local origin over the one under it: a landing's top is where the next stands)
    expect(LANDING.t).toBeGreaterThan(1); // (the landing is 6.8 mm thick)
    const rd = rod(fs[2].zg1, 0, z[2]).m.translate([0, 0, z[2]]);
    for (const [dx, dy] of [[0.25, 0.25], [-0.25, 0.25], [0.25, -0.25], [-0.25, -0.25], [0, 0]]) {
      const holders = fs.map((f, i) => f.add.subtract(f.cut).translate([i ? dx : 0, i ? dy : 0, z[i]]));
      const hit = holders.map((h) => vol(rd, h));
      expect(hit.every((v) => v < 1e-3), `off by ${dx}, ${dy}: ${hit.map((v) => v.toFixed(3)).join(' ')}`).toBe(true);
    }
    freeAll();
  });
});
