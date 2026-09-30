// The DIN clip review (docs/din-clip-review.md), measured on the geometry: the rail shoe's release lever, what keeps
// the release rod and a flat holder's dock key in, the grip on the rail, and what each piece prints like.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel, csLoops, freeAll, K, poly, rect2, toMesh, unionCS, type CS } from '../src/cad/kernel';
import { END_POSE, flatHolderDock, holderDock, leverProfile, rod, shoe, shoeBody, shoeLever, shoeProfile, socket, SHOE_LEVER } from '../src/cad/dock';
import { buildClip, clipDims, clipProfile } from '../src/cad/dinclip';
import { GRIP, SHOE_GRIP } from '../src/cad/dockdims';
import { assemble2D, elementStrain, meshPolygons, pcg, q6Element } from '../src/fea/fea2d';
import { clipFea } from '../src/fea/clipfea';
import { layerCheck, verdict } from '../src/cad/printcheck';

const P = (pts: number[][]): CS => poly(pts as [number, number][], 'NonZero');
// the jaw (dock.ts SHOE_JAW) below its hinge leaf: what the lever pushes, and what swings about the leaf
const JAW = [[17.7, 3.9], [20.6, 3.9], [21.9, 5.2], [21.9, 33.4], [21.5, 34.2], [20.3, 34.2], [19.9, 33.8], [19.9, 9.9], [15.9, 9.9], [15.9, 8.0], [18.0, 8.0], [18.0, 6.2], [16.0, 6.2], [15.8, 6.0]];
const turn = (c: CS, deg: number, [cx, cy]: number[]) => c.translate([-cx, -cy]).rotate(deg).translate([cx, cy]);
/** The narrowest gap between two regions, to 0.01 mm. */
function gap(a: CS, b: CS): number {
  let lo = 0, hi = 2;
  for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (a.offset(m, 'Round').intersect(b).area() > 1e-6) hi = m; else lo = m; }
  return lo;
}
const rail2 = () => unionCS([rect2(-13.5, 0, 13.5, 1), rect2(-13.5, 0, -12.5, 7.5), rect2(12.5, 0, 13.5, 7.5), rect2(-17.5, 6.5, -12.5, 7.5), rect2(12.5, 6.5, 17.5, 7.5)]);

beforeAll(async () => { await initKernel(); });

describe('the rail shoe\'s release lever', () => {
  const split = () => {
    const s = shoeProfile(), jaw = s.intersect(P(JAW).offset(0.45, 'Round')).intersect(rect2(15.7, 3, 23, 35)).subtract(rect2(15.7, 10.35, 17.75, 21));
    return { jaw, body: s.subtract(jaw), lever: leverProfile() };
  };

  it('prints free: 0.35 mm round its pin and past the neck (the hub\'s open edge was 0.09 mm from the neck)', () => {
    const { jaw, body, lever } = split();
    expect(gap(lever, body)).toBeGreaterThan(0.33); // (0.35 round the pin, less a hair for the polygons)
    expect(gap(lever, jaw)).toBeGreaterThan(0.35); // the hook, 0.4 mm off the jaw's post at rest
    expect(shoe().decompose().length).toBe(2);
    freeAll();
  });

  it('can\'t lift far past rest: its hub meets the neck after a few degrees (it lifted 13.5°, its pad 3 mm, before)', () => {
    const { body, lever } = split(), pv = SHOE_LEVER.pivot;
    let lift = 0;
    for (let d = 0; d <= 20; d += 0.25) if (turn(lever, d, pv).intersect(body).area() > 1e-3) { lift = d; break; }
    console.log(`lever: hub meets the neck at ${lift}° up, the pad ${(13.6 * Math.sin((lift * Math.PI) / 180)).toFixed(1)} mm`);
    expect(lift).toBeGreaterThan(4); // (the 0.35 mm print gap at the hub's edge is 5.6° at the least)
    expect(13.6 * Math.sin((lift * Math.PI) / 180)).toBeLessThan(1.8);
    freeAll();
  });

  it('can\'t slide off its pin: a bead round the pin\'s middle runs in a groove in the hub (it could slide the whole 21 mm)', () => {
    const b = shoeBody(), l = shoeLever();
    expect(b.intersect(l).volume()).toBeLessThan(1e-3);
    // a little play along the pin, then a flank meets the other either way
    for (const dx of [0.3, -0.3]) expect(b.intersect(l.translate([dx, 0, 0])).volume()).toBeLessThan(1e-3);
    for (const dx of [1, -1, 5, -5]) expect(b.intersect(l.translate([dx, 0, 0])).volume()).toBeGreaterThan(1);
    freeAll();
  });

  it('frees the jaw before it meets its stop, and has room to spare past the stop', () => {
    const { jaw, body, lever } = split();
    // the jaw swings about the middle of its leaf (fitted to the FEA: lip 1.7 mm while the post moves 4.06 mm)
    const jp = [16.75, 13.76], pv = SHOE_LEVER.pivot;
    let clear = 0, stop = 0, free = 0;
    for (let d = 0; d <= 40; d += 0.5) {
      const L = turn(lever, -d, pv);
      if (!free && L.intersect(body).area() > 1e-3) free = d;
      let lo = 0, hi = 25;
      if (L.intersect(jaw).area() > 1e-4) for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (L.intersect(turn(jaw, m, jp)).area() > 1e-4) lo = m; else hi = m; }
      else hi = 0;
      const a = (hi * Math.PI) / 180, lip = (15.8 - jp[0]) * Math.cos(a) - (6.0 - jp[1]) * Math.sin(a) - (15.8 - jp[0]);
      if (!clear && lip >= 1.7) clear = d;
      if (!stop && d < 30 && turn(jaw, hi, jp).intersect(body).area() > 0.02) stop = d;
    }
    console.log(`lever: lip clear of the flange at ${clear}°, pad ${(13.6 * Math.sin((clear * Math.PI) / 180)).toFixed(1)} mm down; jaw on its stop at ${stop}°; the lever's own travel ends at ${free}°`);
    expect(clear).toBeGreaterThan(15);
    expect(stop).toBeGreaterThan(clear);
    expect(free).toBeGreaterThan(stop + 8);
    freeAll();
  });

  it('once the jaw is at its stop, the tower and the neck take a firm thumb (about 9 N reached the limit before)', () => {
    // the lever pushes its pin out and down: at the stop the hook bears 11.3 mm under the pin and the pad is 12.4 mm
    // out, so per newton on the pad the pin takes 1.1 N out and 1 N down
    const loops = csLoops(shoeProfile().intersect(rect2(9.5, 19, 16, 42)));
    const h = 0.05, m = meshPolygons(loops, h), { Ke, R } = q6Element(h, 2100, 0.38, 21), S = assemble2D(m, Ke);
    const fixed = new Uint8Array(S.n), f = new Float64Array(S.n), ids: number[] = [];
    for (let i = 0; i < m.nNodes; i++) if (m.nodeXY[2 * i + 1] < 21.5) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; }
    const [py, pz] = SHOE_LEVER.pivot;
    for (let i = 0; i < m.nNodes; i++) { const r = Math.hypot(m.nodeXY[2 * i] - py, m.nodeXY[2 * i + 1] - pz); if (!fixed[2 * i] && r < 1.7 && r > 1.2) ids.push(i); }
    for (const i of ids) { f[2 * i] = 1.1 / ids.length; f[2 * i + 1] = -1 / ids.length; }
    const eps = elementStrain(m, pcg(S, f, fixed, 1e-9).u, R);
    const peak = Math.max(...eps), limitAt = 0.02 / peak;
    console.log(`pad force at the stop that brings the tower or neck to 2% (PETG): ${limitAt.toFixed(0)} N`);
    expect(limitAt).toBeGreaterThan(25);
    freeAll();
  });
});

describe('what keeps the release rod and a flat holder\'s dock key in', () => {
  it('the rod clicks in and can\'t be pulled out; its whole 3.1 mm stroke is free', () => {
    const f = holderDock(40, 3, 0, 0), holder = f.add.subtract(f.cut), r = rod(f.zg1, 0).m, s = socket();
    expect(holder.intersect(r).volume()).toBeLessThan(1e-3);
    expect(s.intersect(r).volume()).toBeLessThan(1e-3);
    expect(holder.intersect(r.translate([0, 0, 0.5])).volume()).toBeGreaterThan(0.05); // (it slid straight out)
    expect(holder.intersect(r.translate([0, 0, -3.0])).volume()).toBeLessThan(1e-3);
    freeAll();
  });

  it('the dock key can\'t leave its dovetail while the rod is in (the rod locks it, and now the rod is held)', () => {
    const fl = flatHolderDock(30, 0), ear = fl.add.subtract(fl.cut), key = fl.key, r = rod(fl.top, 0).m;
    expect(ear.intersect(key).volume() + ear.intersect(r).volume() + key.intersect(r).volume()).toBeLessThan(1e-3);
    // out of the groove's open tip: free without the rod, stopped by it
    expect(ear.intersect(key.translate([0, -12, 0])).volume()).toBeLessThan(1e-3);
    expect(r.intersect(key.translate([0, -1, 0])).volume()).toBeGreaterThan(0.1);
    expect(ear.intersect(r.translate([0, 0, 0.6])).volume()).toBeGreaterThan(0.05);
    freeAll();
  });
});

describe('the grip on the rail', () => {
  it('the shoe clamps the rail\'s -y wall between its grip pad and its fixed hook; before, it only located (0.8 mm of play across)', () => {
    const sh = shoeProfile(), rl = rail2();
    const into = sh.intersect(rl);
    // only the pad is in the wall, by the 0.4 mm play to the hook plus the 0.35 mm preload
    const b = into.bounds();
    expect(into.decompose().length).toBe(1);
    expect(b.min[0]).toBeCloseTo(SHOE_GRIP.wall - SHOE_GRIP.gap - GRIP.pre, 2);
    expect(b.max[0]).toBeCloseTo(SHOE_GRIP.wall, 2);
    // moved onto its hook (0.4 mm), the pad is 0.35 mm in, and a knock back is stopped by the tooth after 0.45 mm
    const on = sh.translate([SHOE_GRIP.gap, 0]);
    expect(on.intersect(rl).intersect(rect2(-13.5, 0, 0, 7.5)).bounds().min[0]).toBeCloseTo(SHOE_GRIP.wall - GRIP.pre, 2); // (and the hook on the flange edge)
    const toothZone = rect2(-13.5, 7.0, -10, 7.5);
    expect(on.translate([-GRIP.stop + 0.03, 0]).intersect(toothZone).intersect(rl).area()).toBeLessThan(1e-4);
    expect(on.translate([-GRIP.stop - 0.05, 0]).intersect(toothZone).intersect(rl).area()).toBeGreaterThan(1e-3);
    freeAll();
  });

  it('the flat clip is held down on the top flange by its grip; before, 0.65 mm of play up and down', () => {
    for (const tf of [0.8, 1.0, 1.5]) {
      const p = { W: 14, tf, tabExt: 0 }, d = clipDims(p), cs = clipProfile(p).cs;
      // the pad reaches 0.2 mm (the top wall's play) + 0.35 mm past the top wall's inner face
      const pad = cs.intersect(rect2(0, d.gripWall, 5, 14)); // (under the top hook's lip, which starts at u 5.1)
      expect(pad.bounds().max[1]).toBeCloseTo(d.gripWall + d.gripGap + GRIP.pre, 2);
      expect(d.gripGap).toBeCloseTo(0.2, 6);
    }
    freeAll();
  });

  it('the clip\'s grip holds about 7 N on a 14 mm clip, inside the strain limit (the shoe\'s: dockfea.test.ts)', () => {
    const p = { W: 14, tf: 1.0, tabExt: 0 };
    const r = clipFea(csLoops(clipProfile(p).cs), clipDims(p), p.W, 2100, 0.38, 0.2);
    const g = r.cases.find((c) => /Rail grip/.test(c.name))!;
    console.log(`clip grip ${g.force.toFixed(1)} N, peak ${(g.peakStrain * 100).toFixed(2)}%, 99% ${(g.p99Strain * 100).toFixed(2)}%`);
    expect(g.force).toBeGreaterThan(5);
    expect(g.force).toBeLessThan(12);
    expect(g.p99Strain).toBeLessThan(0.01);
    expect(g.peakStrain).toBeLessThan(0.016);
    freeAll();
  }, 300000);
});

describe('the grip in a rack', () => {
  it('a shoe meets its rail only with its grip pad, 0.75 mm in (the collision test counts that as contact)', async () => {
    const { generate } = await import('../src/cad/assembly');
    const { newProject } = await import('../src/model/library');
    const { TEMPLATES } = await import('../src/model/templates');
    const { thicknessOf } = await import('./collide/measure');
    const r = generate(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    const W = K() as any;
    const solid = (pos: Float32Array, idx: Uint32Array, T?: number[]) => {
      const p = new Float32Array(pos);
      if (T) for (let i = 0; i < p.length; i += 3) { const [x, y, z] = [p[i], p[i + 1], p[i + 2]]; p[i] = T[0] * x + T[4] * y + T[8] * z + T[12]; p[i + 1] = T[1] * x + T[5] * y + T[9] * z + T[13]; p[i + 2] = T[2] * x + T[6] * y + T[10] * z + T[14]; }
      const mesh = new W.Mesh({ numProp: 3, vertProperties: p, triVerts: new Uint32Array(idx) }); mesh.merge();
      return new W.Manifold(mesh);
    };
    const sh = r.parts.find((x) => x.id === 'dock_shoe')!, rail = r.ghosts.find((g) => g.tag?.kind === 'rail')!;
    const a = solid(sh.mesh.pos, sh.mesh.idx, sh.toAssembly), b = solid(rail.mesh.pos, rail.mesh.idx); // (made with new: freed below)
    const hit = a.intersect(b);
    const pieces = hit.decompose().filter((q: any) => q.volume() > 1e-3);
    expect(pieces.length).toBe(1);
    const depth = thicknessOf(pieces[0]);
    console.log(`shoe into its rail: ${pieces[0].volume().toFixed(1)} mm³, ${depth.toFixed(2)} mm deep`);
    expect(depth).toBeCloseTo(SHOE_GRIP.gap + GRIP.pre, 1);
    freeAll();
    a.delete(); b.delete();
  }, 120000);
});

describe('printability of the changed pieces', () => {
  it('the shoe, the rod, the dock key and the clip print on their faces with no support, and nothing that moves closes up', () => {
    const up = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]; // socket-local y up: how the holder side prints
    const f = holderDock(40, 3, 0, 0), fl = flatHolderDock(30, 0);
    const parts: [string, ReturnType<typeof toMesh>, boolean][] = [
      ['shoe', toMesh(shoe().transform(END_POSE.pose as any)), true],
      ['rod', toMesh(rod(f.zg1, 0).m.transform(up as any)), true],
      ['holder dock', toMesh(f.add.subtract(f.cut).transform(up as any)), false],
      ['dock key', toMesh(fl.key.transform(up as any)), false],
      ['clip', toMesh(buildClip({ W: 14, tf: 1, tabExt: 0 })), true],
    ];
    freeAll();
    for (const [name, mesh, moving] of parts) {
      const q = layerCheck(mesh)!;
      const v = verdict(q, moving);
      console.log(name, v.brief);
      expect(q.islands, name).toEqual([]);
      if (moving) expect(q.gaps, `${name}: a slot that prints closed`).toBeNull();
      expect(q.bridge?.span ?? 0, name).toBeLessThan(12);
      expect(q.cantilever?.reach ?? 0, name).toBeLessThan(2);
      expect(v.status, name).not.toBe('bad');
      freeAll();
    }
  }, 120000);
});
