// Where cables cross the rails: the runs along v are spread a cable's width apart (nothing lies over another under a
// rail), kept out of the stand blocks, and the cable's column stays where its plug is; the cables settle beside a rail
// or a plug, not 0.8 mm into it; and a plug pack's own lead is routed from its outlet and checked against its length.
import { describe, it, expect, beforeAll } from 'vitest';
import { ribbonRoute, spreadCrossings, type Obstacle, type RibbonEnd, type Route } from '../src/cad/cableroute';
import { settleCables } from '../src/cad/cablesim';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes, fillWires, stackCompanions } from '../src/model/probes';
import { generatePanel, laneFit } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';

const ZC = -5.5, D = 4.5;
/** A cable from a plug at (u0, v0) to one at (u1, v1): down its column, along v to the street at `lane`, along it, along v to the other column. */
function cable(u0: number, v0: number, u1: number, v1: number, lane: number): Route {
  return {
    pts: [[u0, v0, 40], [u0, v0, ZC], [u0, lane, ZC], [u1, lane, ZC], [u1, v1, ZC], [u1, v1, 40]],
    kinds: ['escape', 'cross', 'street', 'cross', 'escape'],
  };
}
const runsAlongV = (r: Route) => r.kinds.flatMap((k, i) => (k === 'cross' && Math.abs(r.pts[i][0] - r.pts[i + 1][0]) < 0.01 ? [r.pts[i][0]] : []));

describe('cables that cross the rails side by side', () => {
  it('spreads runs along v that lie closer than the cables are wide, keeping every column where it was', () => {
    // three cables crossing the same rails within a few mm of each other
    const rs = [cable(100, -200, 300, 50, -100), cable(102, -190, 320, 60, -110), cable(104.5, -205, 340, 55, -120)];
    spreadCrossings(rs.map((route) => ({ route, d: D, zc: ZC })), []);
    // the first run of each (from its column across the rails)
    const at = rs.map((r) => runsAlongV(r)[0]);
    const sorted = [...at].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(D + 2.4 - 1e-6);
    // the columns (the points the cables drop and rise at) are as they were
    expect(rs.map((r) => r.pts[1].slice(0, 2))).toEqual([[100, -200], [102, -190], [104.5, -205]]);
    expect(rs.map((r) => r.pts[r.pts.length - 2].slice(0, 2))).toEqual([[300, 50], [320, 60], [340, 55]]);
    // and the order they were laid in, so none crosses another
    expect(at[0]).toBeLessThan(at[1]);
    expect(at[1]).toBeLessThan(at[2]);
  });

  it('leaves alone runs that are already a cable width apart', () => {
    const rs = [cable(100, -200, 300, 50, -100), cable(130, -190, 320, 60, -110)];
    spreadCrossings(rs.map((route) => ({ route, d: D, zc: ZC })), []);
    expect(runsAlongV(rs[0])[0]).toBe(100);
    expect(runsAlongV(rs[1])[0]).toBe(130);
  });

  it('moves a run out of a stand block, with room to spare for cables to go over each other beside it', () => {
    const block: Obstacle = { box: [95, -150, -10, 105, -105, 2.4], label: 'table stand 1', stand: true, solid: true };
    const r = cable(100, -200, 300, 50, -100);
    spreadCrossings([{ route: r, d: D, zc: ZC }], [block]);
    const u = runsAlongV(r)[0];
    expect(u === 100).toBe(false);
    expect(Math.abs(u - 100)).toBeGreaterThan(5 + D / 2); // clear of the block's half-width and the cable's
    expect(r.pts[1].slice(0, 2)).toEqual([100, -200]);
  });
});

describe('a cable settles beside a rail or a plug', () => {
  it('a cable pressed against a rail stays out of it (no brushing into its crown)', () => {
    // a rail across at z 0..7.5, the cable laid under it at its lowest and pressed up by another laid on top
    const rail = { box: [0, -17.5, 0, 200, 17.5, 7.5], solid: true };
    const low = { id: 'a', pts: [[50, -60, -5.5], [50, 60, -5.5]], r: 2.25, pin: [5, 5] as [number, number], floor: -5.5 };
    const high = { id: 'b', pts: [[50, -60, -3], [50, 60, -3]], r: 2.25, pin: [5, 5] as [number, number] };
    const res = settleCables([low, high], [rail]);
    for (const q of res.paths[1]) if (Math.abs(q[1]) < 17) expect(q[2] + 2.25).toBeLessThan(0.3); // its top under the crown, to 0.3 mm
  });
});

describe('cables that cross settle a cable apart, not a bead apart', () => {
  // the least distance between two polylines (the tubes are drawn through the beads, straight between them)
  const segDist = (P: number[][], Q: number[][]) => {
    const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]), dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    let best = Infinity;
    for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j + 1 < Q.length; j++) {
      const d1 = sub(P[i + 1], P[i]), d2 = sub(Q[j + 1], Q[j]), r = sub(P[i], Q[j]);
      const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
      let s = den < 1e-9 ? 0 : Math.max(0, Math.min(1, (b * f - c * e) / den)), t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      best = Math.min(best, Math.hypot(...P[i].map((x, k) => x + s * d1[k] - Q[j][k] - t * d2[k])));
    }
    return best;
  };
  it('two cables laid right across each other, the beads of each half a step off the crossing, end a diameter apart (not 0.4 mm into each other)', () => {
    // beads every 2.5 mm from each end: this one's at u 0 and 2.5 either side of the crossing, that one's at v -1.25 and 1.25
    const a = { id: 'a', pts: [[-40, 0, 0], [40, 0, 0]], r: 2.25, pin: [5, 5] as [number, number] };
    const b = { id: 'b', pts: [[1.25, -38.75, 0.5], [1.25, 41.25, 0.5]], r: 2.25, pin: [5, 5] as [number, number] };
    const res = settleCables([a, b], []);
    expect(segDist(res.paths[0], res.paths[1])).toBeGreaterThan(4.5);
  });
});

describe('the lanes of a street', () => {
  it('go in the order with the fewest crossings: the cable whose plugs are both below goes in the lower lane, whatever order it is asked in', () => {
    const X = { a1: [0, -20, 0], b1: [100, -20, 0], q: { d: 4.5 } }, Y = { a1: [40, 20, 0], b1: [60, 20, 0], q: { d: 4.5 } };
    for (const ask of [[X, Y], [Y, X]]) expect(laneFit(ask, () => [-3.5, 3.5], [0]).order).toEqual([X, Y]);
  });
});

describe("a plug pack's own lead", () => {
  beforeAll(async () => { await initKernel(); });
  const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
  const rack = (lead?: number) => {
    const p = newProject(T('rpi5'));
    for (const id of ['pb4', 'psu_pi5']) p.modules.push(newModule(T(id)));
    if (lead != null) p.modules[2].board.box!.pack!.lead = lead;
    p.links = numberLinks(autoLinks(p));
    return generatePanel(p);
  };

  it('runs from the powerboard outlet it is plugged into to the board, with nothing to buy, and no lead leaving the rack', () => {
    const r = rack();
    const lead = (r.report.cables ?? []).find((c) => c.kind === 'power');
    expect(lead).toBeDefined();
    expect(lead!.buy).toBe(0);
    expect(lead!.length).toBeGreaterThan(50);
    expect(lead!.b).toMatch(/USB-C supply/); // (named for the pack and the board, though it is drawn from the outlet)
    expect(r.ghosts.some((g) => /^off-rack cable .*\/J_PWR$/.test(g.name))).toBe(false);
    expect(r.report.warnings.filter((w) => /'s own lead is/.test(w))).toEqual([]);
  }, 120_000);

  it('says when the route is longer than the lead it comes with', () => {
    const w = rack(60).report.warnings.filter((x) => /'s own lead is/.test(x));
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/USB-C supply, 27 W \(5 A\)'s own lead is 0\.1 m but has to run about \d+ mm from its outlet to Raspberry Pi 5/);
  }, 120_000);
});

describe('cable tags', () => {
  beforeAll(async () => { await initKernel(); });
  it('go round the round cables only: a flat ribbon is too wide to snap a ring round', () => {
    const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('usb_hub7')));
    addProbes(p, p.modules[0].id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
    const r = generatePanel(p);
    const tagged = new Set(r.parts.filter((x) => x.tag?.kind === 'cabletag').flatMap((x) => x.tag!.refs ?? []));
    const drawn = new Set((r.report.cables ?? []).map((c) => c.id));
    const ribbons = (p.links ?? []).filter((l) => l.kind === 'debug' && drawn.has(l.id)).map((l) => l.id), usb = (p.links ?? []).filter((l) => l.kind === 'usb' && drawn.has(l.id)).map((l) => l.id);
    expect(ribbons.length).toBeGreaterThan(0);
    expect(ribbons.filter((id) => tagged.has(id))).toEqual([]);
    expect(usb.length).toBeGreaterThan(0);
    expect(usb.every((id) => tagged.has(id))).toBe(true);
  }, 120_000);
});

describe('ribbons and jumpers keep clear of what has to move', () => {
  const end = (u: number, module: string): RibbonEnd => ({ p: [u, 0, 10], d: [0, 0, 1], module, plug: `${module}/J1`, w: [0, 1, 0], span: 5 });
  const top = (r: Route) => Math.max(...r.pts.map((q) => q[2]));

  it('rises over the way another holder lifts off, and over a release lever with a finger room above it', () => {
    const free = ribbonRoute(end(0, 'a'), end(80, 'b'), 0.9, 6, [], []);
    // a holder between them lifts off straight up: 30 mm over its top at 40
    const keep: Obstacle[] = [{ box: [30, -20, 40, 50, 20, 70], label: "the way the Pico holder lifts off", module: 'c' }];
    const over = ribbonRoute(end(0, 'a'), end(80, 'b'), 0.9, 6, [], [], null, null, keep);
    expect(top(free.route)).toBeLessThan(40);
    expect(top(over.route)).toBeGreaterThan(70);
    expect(over.hits).toEqual([]);
    // the ribbon's own boards lift off with it: their way is not kept clear
    const own: Obstacle[] = [{ box: [30, -20, 40, 50, 20, 70], label: 'the way the a holder lifts off', module: 'a' }];
    expect(top(ribbonRoute(end(0, 'a'), end(80, 'b'), 0.9, 6, [], [], null, null, own).route)).toBeLessThan(40);
  });

  it('goes beside the dock where that costs under 40 mm or a quarter more, and over it otherwise', () => {
    const own = [-5, -20, 0, 85, 20, 12]; // the two boards' envelope: round the end of it along x
    const tall: Obstacle[] = [{ box: [30, -20, 12, 50, 20, 200], label: 'the way another holder lifts off', module: 'c' }];
    const narrow = ribbonRoute(end(0, 'a'), end(80, 'b'), 1.6, 4, [], [], own, own, tall);
    // over the top is 400 mm up and down; round the end of a 90 mm envelope is short: it goes round
    expect(top(narrow.route)).toBeLessThan(40);
    // a wide ribbon takes the shortest way that hits nothing, as before
    expect(top(ribbonRoute(end(0, 'a'), end(80, 'b'), 0.9, 20, [], [], own, own, tall).route)).toBeLessThan(40);
  });
});

describe('on a rack with probes and adapters', () => {
  beforeAll(async () => { await initKernel(); });
  it('no ribbon or jumper wire lies over a release lever, where a finger presses it', () => {
    const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
    const p = newProject(T('example_dual_swd'));
    for (const id of ['usb_hub7', 'rpi4']) p.modules.push(newModule(T(id)));
    addProbes(p, p.modules[0].id);
    addAdapters(p, p.modules[0].id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
    stackCompanions(p);
    const r = generatePanel(p);
    const near = new Set((p.links ?? []).filter((l) => l.kind === 'debug' || l.kind === 'jumper').map((l) => l.id));
    const cables = r.ghosts.filter((g) => g.tag?.kind === 'cable' && near.has(g.tag.refs![0]) && !/clash/.test(g.name));
    const levers = r.display!.filter((x) => x.id === 'dock_lever');
    // (the two ends of each: the far corners of its mesh)
    const ends = new Map(cables.map((g) => {
      const v = Array.from({ length: g.mesh.pos.length / 3 }, (_, i) => [g.mesh.pos[3 * i], g.mesh.pos[3 * i + 1], g.mesh.pos[3 * i + 2]]);
      let a = v[0], b = v[0];
      for (const q of v) if (Math.hypot(q[0] - v[0][0], q[1] - v[0][1], q[2] - v[0][2]) > Math.hypot(a[0] - v[0][0], a[1] - v[0][1], a[2] - v[0][2])) a = q;
      for (const q of v) if (Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]) > Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) b = q;
      return [g, [a, b]] as const;
    }));
    expect(cables.length).toBeGreaterThan(0);
    expect(levers.length).toBeGreaterThan(0);
    for (const dl of levers) for (const T of [dl.toAssembly, ...(dl.instances ?? [])]) {
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let i = 0; i < dl.mesh.pos.length; i += 3) {
        const q = [0, 1, 2].map((k) => T[k] * dl.mesh.pos[i] + T[4 + k] * dl.mesh.pos[i + 1] + T[8 + k] * dl.mesh.pos[i + 2] + T[12 + k]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
      }
      for (const g of cables) for (let i = 0; i < g.mesh.pos.length; i += 3) {
        const q = [g.mesh.pos[i], g.mesh.pos[i + 1], g.mesh.pos[i + 2]];
        // (its own ends, plugged into the header beside the dock, are where they are)
        if (ends.get(g)!.some((e) => Math.hypot(q[0] - e[0], q[1] - e[1], q[2] - e[2]) < 20)) continue;
        const inside = q[0] > lo[0] - 1 && q[0] < hi[0] + 1 && q[1] > lo[1] - 1 && q[1] < hi[1] + 1 && q[2] > lo[2] && q[2] < hi[2] + 11;
        expect(inside, `${g.name} at ${q.map((v) => v.toFixed(0))}`).toBe(false);
      }
    }
  }, 120_000);
});
